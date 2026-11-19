import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {runtimeOperation} from '../runtime/native/runtime.mjs';
import {CodexSessionConnector,CODEX_VERSION} from '../runtime/codex/connector.mjs';

async function fixture(){
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'bang-codex-'));
 const call=(command,input)=>runtimeOperation(project,command,undefined,input);
 const keys=generateKeyPairSync('ed25519');
 const turns=[{id:'before',status:'completed',completedAt:1},{id:'calling',status:'interrupted',completedAt:null}];
 const bodies=new Map([['calling',[{type:'userMessage',id:'u1',content:[{type:'text',text:'问题'}]},{type:'reasoning',summary:['SECRET_REASONING']},{type:'agentMessage',id:'a1',phase:'final_answer',text:'答案'}]]]);
 const reads=[];
 const transport={version:CODEX_VERSION,async request(method,p){
  if(method==='thread/read')return {thread:{id:p.threadId,sessionId:'main',parentThreadId:null,source:'vscode',cwd:project,cliVersion:CODEX_VERSION,historyMode:'paginated'}};
  if(method==='thread/turns/list'){
   const direction=p.sortDirection==='desc'?-1:1;
   const index=p.cursor?Number(p.cursor.slice(1))+(p.cursor[0]==='a'?0:direction):(direction===-1?turns.length-1:0);
   const t=turns[index],next=index+direction;
   return {data:t?[{...t,items:[],itemsView:'notLoaded'}]:[],backwardsCursor:t?`a${index}`:null,nextCursor:next>=0&&next<turns.length?`n${index}`:null};
  }
  if(method==='thread/items/list'){reads.push(p.turnId);return {data:bodies.get(p.turnId)??[],nextCursor:null};}
  throw Error('Unexpected host method');
 }};
 const options={project,transport,connectorId:'codex-test',privateKey:keys.privateKey,instanceId:'controlled-install'};
 const connector=new CodexSessionConnector(options);await connector.register();
 return {project,call,turns,bodies,reads,transport,options,connector,hook:{hook_event_name:'UserPromptSubmit',session_id:'main',turn_id:'calling',cwd:project,prompt:'PRIVATE_DISABLED'},async close(){await call('stop');await fs.rm(project,{recursive:true,force:true});}};
}

test('trusted current hook binds its exact calling turn; persisted completion enters native pending queue without earlier or reasoning text',async()=>{
 const f=await fixture();try{
  const bound=await f.connector.enable(f.hook,{scope:['*']});
  assert.equal(bound.source.startTurnId,'calling');
  assert.deepEqual(f.reads,[]);
  assert.equal((await f.connector.poll(bound.topic.id,bound.source.id)).status,'waiting-for-completion');
  assert.deepEqual(f.reads,[]);
  f.turns[1]={id:'calling',status:'completed',completedAt:2};
  assert.equal((await f.connector.poll(bound.topic.id,bound.source.id)).received,1);
  const status=await f.call('turn-status',{topicId:bound.topic.id});assert.equal(status.received,1);
  const source=await f.call('turn-source',{topicId:bound.topic.id,id:status.pending[0].id});
  assert.equal(source.user.content,'问题');assert.equal(source.assistant.content,'答案');
  assert.doesNotMatch(JSON.stringify(source),/SECRET|PRIVATE/);
 }finally{await f.close();}
});

test('restart resumes native durable cursor; terminal failures leave gaps and disabled sources never read bodies',async()=>{
 const f=await fixture();try{
  const bound=await f.connector.enable(f.hook,{scope:['*']});
  f.turns[1]={id:'calling',status:'completed',completedAt:2};
  await f.connector.poll(bound.topic.id,bound.source.id);
  await f.call('stop');
  const restarted=new CodexSessionConnector(f.options);
  assert.equal((await restarted.poll(bound.topic.id,bound.source.id)).received,0);
  f.turns.push({id:'cancelled',status:'interrupted',completedAt:3});
  await restarted.poll(bound.topic.id,bound.source.id);
  const status=await f.call('turn-status',{topicId:bound.topic.id});
  assert.equal(status.received,1);assert.equal(status.gaps[0].reason,'interrupted');
  const before=f.reads.length;
  assert.equal((await restarted.poll(bound.topic.id,'unbound-source')).status,'disabled');
  assert.equal(f.reads.length,before);assert.ok(!f.reads.includes('cancelled'));
 }finally{await f.close();}
});

test('untrusted events, foreign workspace, child agents, unsupported version fail before body reads',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.connector.enable({...f.hook,hook_event_name:'Stop'},{scope:['*']}),/UserPromptSubmit/);
  f.transport.version='0.130.0';await assert.rejects(f.connector.enable(f.hook,{scope:['*']}),/version/);f.transport.version=CODEX_VERSION;
  const request=f.transport.request;
  f.transport.request=async(method,p)=>{const r=await request(method,p);if(method==='thread/read')r.thread.parentThreadId='parent';return r;};
  await assert.rejects(f.connector.enable(f.hook,{scope:['*']}),/primary/);
  assert.deepEqual(f.reads,[]);assert.deepEqual(await f.call('topics'),[]);
 }finally{await f.close();}
});

test('a new final answer version remains a distinct durable source; same identity cannot silently change text',async()=>{
 const f=await fixture();try{
  const bound=await f.connector.enable(f.hook,{scope:['*']});f.turns[1]={id:'calling',status:'completed',completedAt:2};
  await f.connector.poll(bound.topic.id,bound.source.id);
  f.bodies.get('calling')[2]={type:'agentMessage',id:'a2',phase:'final_answer',text:'修订答案'};
  await f.connector.poll(bound.topic.id,bound.source.id);
  assert.equal((await f.call('turn-status',{topicId:bound.topic.id})).received,2);
  f.bodies.get('calling')[2].text='silently changed';
  await assert.rejects(f.connector.poll(bound.topic.id,bound.source.id),/version reused/);
 }finally{await f.close();}
});

test('a genuine prompt hook may precede persisted turn creation; no body or earlier history is consumed while waiting',async()=>{
 const f=await fixture();try{
  f.turns.pop();const binding=await f.connector.enable(f.hook,{scope:['*']});
  assert.equal((await f.connector.poll(binding.topic.id,binding.source.id)).status,'waiting-for-calling-turn');
  assert.deepEqual(f.reads,[]);
  f.turns.push({id:'calling',status:'completed',completedAt:4});
  assert.equal((await f.connector.poll(binding.topic.id,binding.source.id)).received,1);
 }finally{await f.close();}
});
test('stopped Codex reception skips bodies, resumes at metadata head and never backfills that turn',async()=>{
 const f=await fixture();try{const bound=await f.connector.enable(f.hook,{scope:['*']});await f.call('organizer-control',{topicId:bound.topic.id,action:'stop-reception'});f.turns[1]={id:'calling',status:'completed',completedAt:2};await f.connector.poll(bound.topic.id,bound.source.id);assert.deepEqual(f.reads,[]);await f.call('organizer-control',{topicId:bound.topic.id,action:'resume-reception'});await f.connector.poll(bound.topic.id,bound.source.id);assert.deepEqual(f.reads,[]);f.turns.push({id:'new',status:'completed',completedAt:3});f.bodies.set('new',[{type:'userMessage',id:'u2',content:[{type:'text',text:'new'}]},{type:'agentMessage',id:'a2',phase:'final_answer',text:'new answer'}]);await f.connector.poll(bound.topic.id,bound.source.id);assert.deepEqual(f.reads,['new']);assert.deepEqual((await f.call('turn-status',{topicId:bound.topic.id})).pending.map(s=>s.turnId),['new']);}finally{await f.close();}
});
