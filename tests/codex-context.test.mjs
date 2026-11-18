import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {runtimeOperation} from '../runtime/native/runtime.mjs';
import {CodexSessionConnector, CODEX_VERSION} from '../runtime/codex/connector.mjs';
import {runCodexHook} from '../runtime/codex/hook.mjs';

const exec = promisify(execFile);
const hookFile = fileURLToPath(new URL('../runtime/codex/hook.mjs', import.meta.url));

async function fixture(t){
 const project = await fs.mkdtemp(path.join(os.tmpdir(), 'bang-codex-context-'));
 const call = (command, input, topic) => runtimeOperation(project, command, topic, input);
 t.after(async () => {
  await call('stop');
  await fs.rm(project, {recursive:true, force:true});
 });
 const connector = generateKeyPairSync('ed25519');
 const bridge = generateKeyPairSync('ed25519');
 const {workspaceId} = await call('start');
 const install = {
  executable:process.execPath, connectorId:'codex-connector', instanceId:'isolated',
  privateKey:connector.privateKey.export({type:'pkcs8',format:'pem'}),
  bridge:{id:'codex-bridge', workspaceId, privateKey:bridge.privateKey.export({type:'pkcs8',format:'pem'})},
 };
 await new CodexSessionConnector({project, connectorId:install.connectorId, instanceId:install.instanceId, privateKey:connector.privateKey}).register();
 await call('context-register', {id:install.bridge.id, host:'codex', versions:[CODEX_VERSION], publicKey:bridge.publicKey.export({type:'spki',format:'pem'})});
 await fs.writeFile(path.join(project,'.bang','runtime','codex-install.json'),JSON.stringify(install));
 const topic = await call('topic-create',{name:'Pinhole'});
 const event = (turnId, prompt, sessionId='root') => ({
  hook_event_name:'UserPromptSubmit', session_id:sessionId, turn_id:turnId, cwd:project, prompt,
 });
 let hostReads = 0;
 const options = {
  project, contextEnabled:true, threadId:'root',
  async openTransport(){
   return {version:CODEX_VERSION, close(){}, async request(method,input){
    assert.equal(method,'thread/read');
    assert.deepEqual(input,{threadId:'root',includeTurns:false});
    hostReads++;
    return {thread:{id:'root',sessionId:'root',parentThreadId:null,source:'cli',cwd:project,cliVersion:CODEX_VERSION,historyMode:'paginated'}};
   }};
  },
 };
 const run = async (input, overrides) => {
  const results=[];
  await runCodexHook(input,{...options, emit:async output=>results.push(output),...overrides});
  assert.equal(results.length,1);
  return results[0];
 };
 const query = async (reference, kind, extra=[], threadId='root') => {
  const result=await exec(process.execPath,[hookFile,project,'--query',reference,kind,...extra],
   {cwd:project,env:{...process.env,CODEX_THREAD_ID:threadId,CODEX_VERSION},encoding:'utf8'});
  return JSON.parse(result.stdout);
 };
 const submit = async input => {
  const result=exec(process.execPath,[hookFile,project,'--context-v1'],
   {cwd:project,env:{...process.env,CODEX_THREAD_ID:'root',CODEX_VERSION},encoding:'utf8'});
  result.child.stdin.end(JSON.stringify(input));
  return JSON.parse((await result).stdout);
 };
 const edit = async (baseRevision, operations) => call('commit',{
  operationId:crypto.randomUUID(),topic:topic.id,baseRevision,author:{kind:'manual',id:'user'},
  readDependencies:[],intent:'explicit-save',operations,
 },topic.id);
 return {call,topic,event,options,run,query,submit,edit,hostReads:()=>hostReads};
}

function readOutput(output){
 assert.equal(output.hookSpecificOutput.hookEventName,'UserPromptSubmit');
 const lines=output.hookSpecificOutput.additionalContext.split('\n');
 return {data:JSON.parse(lines.find(line=>line.startsWith('{"version"'))),reference:/--query ([0-9a-f]{64}) /.exec(lines.join('\n'))[1]};
}

test('normal trusted project hook pins committed wording and relation endpoints, with read-only detail after a later save',async t=>{
 const f=await fixture(t);
 const card=(id,text)=>({type:'create-card',card:{id,text,x:0,y:0,width:320,height:120}});
 await f.edit(0,[card('premise','Manual premise A'),card('first','Option A'),card('second','Option B'),
  {type:'create-relation',edge:{id:'choice',fromNode:'premise',toNode:'first',label:'supports'}}]);
 assert.deepEqual(await f.submit(f.event('disabled','ordinary prompt')), {});
 assert.equal(f.hostReads(),0);
 await f.run(f.event('enable','Bang: enable current session'));
 const first = readOutput(await f.submit(f.event('first','Which option now?')));
 assert.equal(first.data.revision,1);
 assert.equal(first.data.cards.find(item=>item.id==='premise').text,'Manual premise A');
 assert.equal(first.data.relations[0].toNode,'first');
 await f.edit(1,[{type:'edit-card',id:'premise',text:'Manual replacement B'},
  {type:'edit-relation',id:'choice',fromNode:'premise',toNode:'second'},{type:'delete-card',id:'first'}]);
 assert.equal((await f.query(first.reference,'item',['premise'])).item.text,'Manual premise A');
 assert.equal((await f.query(first.reference,'item',['choice'])).item.toNode,'first');
 const next=readOutput(await f.submit(f.event('next','Which option now?')));
 assert.equal(next.data.revision,2);
 assert.equal(next.data.relations[0].toNode,'second');
 assert.equal(next.data.cards.find(item=>item.id==='premise').text,'Manual replacement B');
 assert.deepEqual(next.data.criticalChanges.items.find(item=>item.id==='first'),
  {id:'first',kind:'card',change:'deleted',validity:'withdrawn'});
 assert.equal(next.data.fromRevision,null);
 assert.equal(next.data.instructionAuthority,'none');
 assert.equal(f.hostReads(),1);
 await assert.rejects(f.query(first.reference,'item',['premise']),/pinned/);
 const receipts=(await f.call('context-status',undefined,f.topic.id)).turns;
 assert.deepEqual(receipts.map(r=>[r.turnId,r.revision,r.status,r.modelUse]),[['next',2,'offered','unknown'],['first',1,'offered','unknown']]);
});

test('ordinary prompts fail closed across unreviewed mode, child, foreign workspace, wrong host version, and topic takeover',async t=>{
 const f=await fixture(t);
 await f.run(f.event('enable','Bang: enable current session'),{contextEnabled:false});
 assert.deepEqual(await f.run(f.event('no-context-opt-in','Ordinary prompt')), {});
 await f.run(f.event('enable-again','Bang: enable current session'));
 const prompt=f.event('valid','Ordinary prompt');
 const first=readOutput(await f.run(prompt));
 assert.deepEqual(await f.run({...prompt,agent_id:'subagent'}),{});
 assert.deepEqual(await f.run({...prompt,session_id:'foreign'},{threadId:'foreign'}),{});
 assert.deepEqual(await f.run({...prompt,cwd:os.tmpdir()}),{});
 assert.deepEqual(await f.run(prompt,{hostVersion:'0.130.0'}),{});
 assert.deepEqual(await f.run(prompt,{contextEnabled:false}),{});
 await assert.rejects(f.query(first.reference,'changes',[],'foreign'),/pinned/);
 await assert.rejects(f.query(first.reference,'commit'),/pinned/);
 const {workspaceId}=await f.call('start');
 const alternate=generateKeyPairSync('ed25519');
 const connector=new CodexSessionConnector({project:f.options.project,connectorId:'alternate',instanceId:'alternate',
  privateKey:alternate.privateKey});
 await connector.register();
 const session=await f.call('session-connect',connector.proof({workspaceId,sessionId:'new-root',turnId:'new-turn',cursor:'new-cursor',scope:[f.topic.id]}));
 const confirmation=await f.call('binding-enable',{...session,topicId:f.topic.id});
 await f.call('binding-enable',{...session,topicId:f.topic.id,confirmation:confirmation.confirmation});
 await assert.rejects(f.query(first.reference,'changes'),/pinned/);
 const output=await f.run(f.event('after-takeover','Ordinary prompt'));
 assert.match(output.systemMessage,/not synchronized/);
 assert.doesNotMatch(JSON.stringify(output),/<bang-board-data>/);
 assert.equal((await f.call('context-status',undefined,f.topic.id)).turns.length,1);
});

test('retries preserve the same bounded cut and stopped Runtime gives immediate manual fallback without starting the owner',async t=>{
 const f=await fixture(t);
 await f.run(f.event('enable','Bang: enable current session'));
 const card=(id,text)=>({type:'create-card',card:{id,text,x:0,y:0,width:320,height:120}});
 await f.edit(0,Array.from({length:35},(_,i)=>card('item'+i,'隐'.repeat(500))));
 const prompt=f.event('bounded-turn','Ordinary prompt');
 const first=readOutput(await f.run(prompt));
 assert.ok(Buffer.byteLength(JSON.stringify(first.data))<=4096);
 assert.ok(first.data.omittedCards>0);
 assert.equal((await f.query(first.reference,'changes',['20','15'])).items.length,15);
 await f.edit(1,[{type:'edit-card',id:'item34',text:'updated'}]);
 const retry=readOutput(await f.run(prompt));
 assert.equal(retry.data.revision,1);
 assert.equal((await f.query(retry.reference,'item',['item34'])).item.text,'隐'.repeat(500));
 await f.call('stop');
 const start=performance.now(),unavailable=await f.run(f.event('later','Ordinary prompt'));
 assert.ok(performance.now()-start<1800);
 assert.match(unavailable.systemMessage,/manual knowledge-context/);
 assert.match(unavailable.hookSpecificOutput.additionalContext,/stale/);
 assert.equal((await f.call('status')).status,'unavailable');
});

test('an unresponsive Runtime cannot stall the next prompt or expose the previous query',async t=>{
 const f=await fixture(t);
 await f.run(f.event('enable','Bang: enable current session'));
 const first=readOutput(await f.run(f.event('first','Ordinary prompt')));
 await f.call('stop');
 let requests=0;
 const stalled=createServer(()=>requests++);
 await new Promise(resolve=>stalled.listen(0,'127.0.0.1',resolve));
 const metadata=path.join(f.options.project,'.bang','runtime','connection.json');
 await fs.writeFile(metadata,JSON.stringify({url:`http://127.0.0.1:${stalled.address().port}`,token:'fixture',epoch:'0'}));
 try{
  const before=performance.now();
  const fallback=await f.run(f.event('timeout','Ordinary prompt'));
  assert.ok(performance.now()-before<2000);
  assert.equal(requests,1);
  assert.match(fallback.systemMessage,/not synchronized/);
  assert.doesNotMatch(JSON.stringify(fallback),/<bang-board-data>/);
  await assert.rejects(f.query(first.reference,'changes'),/pinned/);
 }finally{
  stalled.closeAllConnections();
  await new Promise(resolve=>stalled.close(resolve));
  await fs.rm(metadata,{force:true});
 }
});

test('activation and prompts missing a turn identity invalidate the previous turn query',async t=>{
 const f=await fixture(t);
 await f.run(f.event('enable','Bang: enable current session'));
 const first=readOutput(await f.run(f.event('first','Ordinary prompt')));
 await f.run(f.event('enable-again','Bang: enable current session'));
 await assert.rejects(f.query(first.reference,'changes'),/pinned/);
 const next=readOutput(await f.run(f.event('next','Ordinary prompt')));
 assert.equal((await f.query(next.reference,'changes')).revision,next.data.revision);
 const unavailable=await f.run(f.event(undefined,'Ordinary prompt'));
 assert.match(unavailable.systemMessage,/manual knowledge-context/);
 await assert.rejects(f.query(next.reference,'changes'),/pinned/);
});
