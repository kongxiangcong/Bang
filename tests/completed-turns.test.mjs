import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,sign,randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runtimeOperation} from '../runtime/native/runtime.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
export async function fixture(){
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'bang-ingestion-')),call=(command,input)=>runtimeOperation(project,command,undefined,input);
 const {workspaceId}=await call('start'),{privateKey,publicKey}=generateKeyPairSync('ed25519');
 await call('connector-register',{id:'controlled',host:'controlled-host',versions:['1'],publicKey:publicKey.export({format:'pem',type:'spki'})});
 const proof=(extra={})=>{const now=Date.now();const payload=Buffer.from(JSON.stringify({host:'controlled-host',version:'1',instanceId:'fixture',sessionId:'primary-chat',workspaceId,role:'primary',scope:['*'],turnId:'calling-turn',cursor:'c0',issuedAt:now,expiresAt:now+300000,nonce:randomUUID(),...extra})).toString('base64url');return {connectorId:'controlled',payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64url')};};
 const session=await call('session-connect',proof()),bound=await call('binding-enable',session);
 const turn=(turnId='calling-turn',cursor='c1',versionId='v1',answer='合成回答')=>({kind:'turn',role:'primary',status:'completed',turnId,versionId,cursor,user:{role:'user',content:'合成问题'},assistant:{role:'assistant',channel:'final',content:answer},sourceHash:hash(JSON.stringify(['合成问题',answer]))});
 const signed=(events,previousCursor='c0',extra={})=>{const batch={sourceId:bound.source.id,previousCursor,events,...extra};return {batch,proof:proof({purpose:'completed-turn-ingestion',sourceId:bound.source.id,batchHash:hash(JSON.stringify(batch))})};};
 return {project,call,session,bound,proof,turn,signed,close:async()=>{await call('stop');await fs.rm(project,{recursive:true,force:true});}};
}
test('authorized calling turn is durable, exact versions deduplicate, and browser-free restart continues the queue',async()=>{
 const f=await fixture();try{
  const first=f.signed([f.turn()]);const received=await f.call('turn-ingest',first);
  assert.equal(received.received,1);assert.equal(received.receivedCursor,'c1');
  assert.equal((await f.call('turn-ingest',first)).duplicate,true);
  await f.call('stop');
  await f.call('turn-ingest',f.signed([f.turn('next-turn','c2')],'c1'));
  const queue=await f.call('turn-status',{topicId:f.bound.topic.id});
  assert.equal(queue.received,2);assert.equal(queue.organized,0);assert.equal(queue.backlog,2);
  assert.deepEqual(queue.pending.map(s=>s.turnId),['calling-turn','next-turn']);
  const source=await f.call('turn-source',{topicId:f.bound.topic.id,id:queue.pending[0].id});
  assert.equal(source.assistant.content,'合成回答');assert.equal(source.versionId,'v1');
  assert.equal((await f.call('binding-status',f.session)).source.receivedCursor,'c2');
 }finally{await f.close();}
});
test('ingestion requires its own signed scope, filters internal output, preserves versions and exposes missing records',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.call('turn-ingest',{...f.session,batch:{sourceId:f.bound.source.id,events:[f.turn()]}}),/connector/);
  const tampered=f.signed([f.turn()]);tampered.batch.events[0].assistant.content='tampered';await assert.rejects(f.call('turn-ingest',tampered),/proof/);
  const foreign=f.signed([f.turn()]);foreign.proof=f.proof({purpose:'completed-turn-ingestion',sourceId:f.bound.source.id,batchHash:hash(JSON.stringify(foreign.batch)),sessionId:'foreign'});await assert.rejects(f.call('turn-ingest',foreign),/scope/);
  await assert.rejects(f.call('turn-ingest',f.signed([f.turn('historical') ])),/Calling turn/);
  await assert.rejects(f.call('turn-ingest',f.signed([{...f.turn(),status:'incomplete'}])),/Incomplete/);
  assert.equal((await f.call('turn-status',{topicId:f.bound.topic.id})).received,0);
  await f.call('turn-ingest',f.signed([f.turn()]));
  await f.call('turn-ingest',f.signed([{...f.turn('child','c2'),role:'subagent'},{...f.turn('organizer','c3'),role:'organizer'},{...f.turn('tool','c4'),kind:'tool'},{...f.turn('reasoning','c5'),assistant:{role:'assistant',channel:'analysis',content:'PRIVATE_INTERNAL'}},{...f.turn('failed','c6'),status:'error'},{...f.turn('stopped','c7'),status:'interrupted'},{kind:'gap',turnId:'missing',cursor:'c8',reason:'missing-record'}],'c1'));
  await f.call('turn-ingest',f.signed([f.turn('calling-turn','c9','v2')],'c8'));
  await f.call('turn-ingest',f.signed([f.turn('calling-turn','c10','v2')],'c9'));
  const status=await f.call('turn-status',{topicId:f.bound.topic.id});
  assert.equal(status.received,2);assert.equal(status.backlog,2);assert.equal(status.organized,0);assert.equal(status.ignored.length,6);assert.equal(status.gaps.length,3);
  assert.deepEqual(status.pending.map(s=>s.versionId),['v1','v2']);assert.equal(status.pending[0].sourceHash,status.pending[1].sourceHash);
  assert.doesNotMatch(JSON.stringify(status),/PRIVATE_INTERNAL/);
  await assert.rejects(f.call('turn-ingest',f.signed([f.turn('calling-turn','c11','v2','different')],'c10')),/reused/);
  assert.equal((await f.call('binding-status',f.session)).source.receivedCursor,'c10');
 }finally{await f.close();}
});
test('history requires an explicit range and never rewinds the live cursor; switched source is frozen',async()=>{
 const f=await fixture();try{
  await f.call('turn-ingest',f.signed([f.turn()]));
  await assert.rejects(f.call('turn-ingest',f.signed([f.turn('old','h1')],'h0',{backfillId:'invented'})),/backfill/);
  await assert.rejects(f.call('turn-backfill',{...f.session,sourceId:f.bound.source.id,startCursor:'h0',startTurnId:'old'}),/Explicit/);
  const range=await f.call('turn-backfill',{...f.session,sourceId:f.bound.source.id,startCursor:'h0',startTurnId:'old',confirmHistory:true});
  await f.call('turn-ingest',f.signed([f.turn('old','c0')],'h0',{backfillId:range.id}));
  assert.equal((await f.call('binding-status',f.session)).source.receivedCursor,'c1');
  assert.equal((await f.call('turn-status',{topicId:f.bound.topic.id})).received,2);
  const another=await f.call('topic-create',{name:'第二专题'});await f.call('binding-enable',{...f.session,topicId:another.id});
  await assert.rejects(f.call('turn-ingest',f.signed([f.turn('late','c2')],'c1')),/frozen/);
  const sources=await f.call('binding-sources',{topicId:f.bound.topic.id});assert.equal(sources[0].endCursor,'c1');assert.equal(sources[0].backlog,2);
 }finally{await f.close();}
});
test('a process death after source insert cannot expose an advanced cursor or lose a retried source',async()=>{
 const f=await fixture();try{
  await f.call('stop');
  const started=spawnSync(process.execPath,[fileURLToPath(new URL('../runtime/canvas/bang.mjs',import.meta.url)),'start','--project',f.project],{encoding:'utf8',env:{...process.env,BANG_INGESTION_TEST_PROJECT:f.project,BANG_INGESTION_TEST_FAULT:'after-source'}});
  assert.equal(started.status,0,started.stderr);
  await assert.rejects(f.call('turn-ingest',f.signed([f.turn()])));
  const status=await f.call('turn-status',{topicId:f.bound.topic.id});assert.equal(status.received,0);assert.equal(status.backlog,0);
  assert.equal((await f.call('binding-status',f.session)).source.receivedCursor,null);
  await f.call('turn-ingest',f.signed([f.turn()]));
  assert.equal((await f.call('turn-status',{topicId:f.bound.topic.id})).received,1);
  assert.equal((await f.call('binding-status',f.session)).source.receivedCursor,'c1');
 }finally{await f.close();}
});
test('HTTP exposes received versus organized and gaps while browser tokens cannot ingest',async()=>{
 const f=await fixture();let server;try{
  const {createServer}=await import('node:http'),{createCanvasMiddleware}=await import('../runtime/canvas/http.mjs');
  server=createServer(createCanvasMiddleware({project:f.project}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/api/canvas/`;
  assert.equal((await fetch(base+f.bound.topic.id+'/turns')).status,403);
  const {token}=await (await fetch(base+'session/bootstrap')).json(),headers={'x-bang-browser-token':token,'Content-Type':'application/json'};
  const forged=await fetch(base+'session/ingest',{method:'POST',headers,body:JSON.stringify({...f.session,batch:{sourceId:f.bound.source.id,events:[f.turn()]}})});assert.equal(forged.status,400);
  const signed=f.signed([f.turn()]);await assert.rejects(f.call('session-connect',signed.proof),/proof rejected/);
  const accepted=await fetch(base+'session/ingest',{method:'POST',headers,body:JSON.stringify(signed)});assert.equal(accepted.status,200);
  const status=await (await fetch(base+f.bound.topic.id+'/turns',{headers})).json();assert.equal(status.received,1);assert.equal(status.organized,0);assert.equal(status.backlog,1);
  const source=await (await fetch(base+f.bound.topic.id+'/source?id='+status.pending[0].id,{headers})).json();assert.equal(source.user.content,'合成问题');
  const cli=spawnSync(process.execPath,[fileURLToPath(new URL('../runtime/canvas/bang.mjs',import.meta.url)),'turn-status','--project',f.project],{encoding:'utf8',input:JSON.stringify({topicId:f.bound.topic.id})});assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).backlog,1);
 }finally{if(server)await new Promise(r=>server.close(r));await f.close();}
});
test('concurrent duplicate delivery queues once and ignored internal records cannot bypass the calling turn',async()=>{
 const f=await fixture();try{
  await f.call('turn-ingest',f.signed([{...f.turn('child','internal'),role:'subagent'}]));
  await assert.rejects(f.call('turn-ingest',f.signed([f.turn('older','wrong')],'internal')),/Calling turn/);
  const batch=f.signed([f.turn()],'internal'),results=await Promise.all([f.call('turn-ingest',batch),f.call('turn-ingest',batch)]);
  assert.equal(results.filter(r=>r.duplicate).length,1);
  const status=await f.call('turn-status',{topicId:f.bound.topic.id});assert.equal(status.received,1);assert.equal(status.backlog,1);assert.equal(status.ignored.length,1);
 }finally{await f.close();}
});
