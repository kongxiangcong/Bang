import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fixture} from './completed-turns.test.mjs';
import {runtimeOperation} from '../runtime/native/runtime.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){const v=await fn();if(v)return v;await delay(50);}throw Error('condition timed out');}
async function controlled(handler){const server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;await handler(JSON.parse(raw),res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));process.env.BANG_ORGANIZER_ENDPOINT=`http://127.0.0.1:${server.address().port}`;const f=await fixture();delete process.env.BANG_ORGANIZER_ENDPOINT;f.status=()=>f.call('organizer-status',{topicId:f.bound.topic.id});f.control=action=>f.call('organizer-control',{topicId:f.bound.topic.id,action});const close=f.close;f.close=async()=>{await close();server.closeAllConnections();await new Promise(r=>server.close(r));};return f;}
test('pause keeps reception and allows in-flight completion; cancel fences late publication and skip preserves a durable gap',async()=>{
 let release,started;const gate=new Promise(r=>release=r),entered=new Promise(r=>started=r);
 const f=await controlled(async(input,res)=>{started();await gate;res.end(JSON.stringify({version:1,changes:[]}));});
 try{await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));await entered;await f.control('pause');await f.call('turn-ingest',f.signed([f.turn('second','c2')],'c1'));release();await until(async()=> (await f.status()).tasks[0]?.status==='no-change');assert.equal((await f.call('turn-status',{topicId:f.bound.topic.id})).backlog,1);assert.equal((await f.status()).enabled,false);
 await f.control('resume');await until(async()=> (await f.call('turn-status',{topicId:f.bound.topic.id})).organized===2);
 }finally{release();await f.close();}
});
test('cancel immediately revokes publication and explicit skip retains source plus processing gap on reopen',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const f=await controlled(async(input,res)=>{entered();await gate;res.end(JSON.stringify({version:1,changes:[{type:'create-card',id:'late',text:'late',conditions:[],uncertainty:'',sources:[input.completedTurns[0].id]}]}));});
 try{await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));await started;await f.control('cancel');release();await delay(200);assert.equal((await runtimeOperation(f.project,'state',f.bound.topic.id)).revision,0);assert.equal((await f.status()).tasks[0].status,'cancelled');await f.control('skip');await f.call('stop');const queue=await f.call('turn-status',{topicId:f.bound.topic.id});assert.equal(queue.received,1);assert.equal(queue.organized,0);assert.equal(queue.backlog,0);assert.equal(queue.gaps[0].reason,'user-skipped');assert.equal((await f.status()).tasks[0].status,'skipped');}finally{release();await f.close();}
});
test('project limits count retries, persist exhaustion, and require explicit resume after budget reset',async()=>{
 const f=await controlled(async(input,res)=>{res.statusCode=503;res.end('{}');});
 try{const configured=await f.call('organizer-configure',{limits:{callsPerHour:2,timeoutMs:500,concurrency:1,batchSize:1}});assert.equal(configured.limits.callsPerHour,2);await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));const s=await until(async()=>{const s=await f.status();return s.pauseReason==='BUDGET_EXHAUSTED'&&s;});assert.equal(s.callsLastHour,2);assert.equal(s.tasks[0].attempts.length,2);await f.call('stop');assert.equal((await f.status()).pauseReason,'BUDGET_EXHAUSTED');assert.equal((await f.status()).callsLastHour,2);assert.equal((await f.call('turn-status',{topicId:f.bound.topic.id})).backlog,1);
 }finally{await f.close();}
});
test('transport timeout retries at most twice, authentication pauses immediately, and manual saves stay available',async()=>{
 const f=await controlled(async()=>{});
 try{await f.call('organizer-configure',{limits:{timeoutMs:30}});await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));const status=await until(async()=>{const s=await f.status();return s.tasks[0]?.status==='failed'&&s;});assert.equal(status.tasks[0].attempts.length,3);assert.equal(status.tasks[0].error.code,'ATTEMPT_TIMEOUT');await delay(300);assert.equal((await f.status()).callsLastHour,3);await runtimeOperation(f.project,'commit',f.bound.topic.id,{operationId:'manual-after-timeout',topic:f.bound.topic.id,baseRevision:0,author:{kind:'manual',id:'user'},intent:'explicit-save',readDependencies:[],operations:[{type:'create-card',card:{id:'manual',text:'still editable',x:0,y:0,width:320,height:120}}]});assert.equal((await runtimeOperation(f.project,'state',f.bound.topic.id)).revision,1);
 }finally{await f.close();}
 const auth=await controlled(async(input,res)=>{res.statusCode=401;res.end('{}');});try{await auth.call('organizer-enable',{topicId:auth.bound.topic.id});await auth.call('turn-ingest',auth.signed([auth.turn()]));const s=await until(async()=>{const s=await auth.status();return s.pauseReason==='AUTH_REQUIRED'&&s;});assert.equal(s.callsLastHour,1);assert.equal(s.tasks[0].status,'failed');}finally{await auth.close();}
});
test('stopped reception freezes accepted cursor, discards interval, and only signed fresh boundary resumes',async()=>{
 const f=await controlled(async(input,res)=>res.end(JSON.stringify({version:1,changes:[]})));
 try{await f.call('turn-ingest',f.signed([f.turn()]));await f.control('stop-reception');await f.call('turn-ingest',f.signed([f.turn('disabled','c2')],'c1'));let bound=await f.call('binding-status',f.session);assert.equal(bound.source.receivedCursor,'c1');assert.equal(bound.source.discardCursor,'c2');assert.equal((await f.call('turn-status',{topicId:f.bound.topic.id})).received,1);await f.control('resume-reception');await f.call('turn-ingest',f.signed([{kind:'reception-boundary',cursor:'c3',turnId:'disabled-end'}],'c2'));await f.call('turn-ingest',f.signed([f.turn('enabled-again','c4')],'c3'));const q=await f.call('turn-status',{topicId:f.bound.topic.id});assert.equal(q.received,2);assert.deepEqual(q.pending.map(t=>t.turnId),['calling-turn','enabled-again']);await f.call('stop');bound=await f.call('binding-status',f.session);assert.equal(bound.source.receptionStopped,false);assert.equal(bound.source.receptionIntervals[0].startCursor,'c1');assert.equal(bound.source.receptionIntervals[0].endCursor,'c3');}finally{await f.close();}
});
test('backlog batching preserves every completed source and acknowledges each independently',async()=>{
 const f=await controlled(async(input,res)=>{assert.equal(input.completedTurns.length,2);res.end(JSON.stringify({version:1,changes:[{type:'create-card',id:'batch',text:'joint finding',conditions:[],uncertainty:'',sources:input.completedTurns.map(t=>t.id)}]}));});
 try{await f.call('organizer-configure',{limits:{batchSize:2}});await f.call('turn-ingest',f.signed([f.turn(),f.turn('second','c2')]));await f.call('organizer-enable',{topicId:f.bound.topic.id});await until(async()=> (await f.call('turn-status',{topicId:f.bound.topic.id})).organized===2);const status=await f.status();assert.equal(status.tasks.length,1);assert.equal(status.tasks[0].sourceIds.length,2);const board=await runtimeOperation(f.project,'state',f.bound.topic.id);assert.deepEqual(board.metadata.batch.knowledge.sources,status.tasks[0].sourceIds);assert.equal(status.callsLastHour,1);}finally{await f.close();}
});
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
test('one project slot isolates a failed topic from another topic',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const f=await controlled(async(input,res)=>{if(input.completedTurns[0].assistant.content==='first'){entered();await gate;res.end('{}');}else res.end(JSON.stringify({version:1,changes:[]}));});
 try{const topic=await f.call('topic-create',{name:'other'}),session=await f.call('session-connect',f.proof({sessionId:'other'})),bound=await f.call('binding-enable',{...session,topicId:topic.id});await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('organizer-enable',{topicId:topic.id});await f.call('turn-ingest',f.signed([f.turn('calling-turn','c1','v1','first')]));await started;const batch={sourceId:bound.source.id,previousCursor:'c0',events:[f.turn()]};await f.call('turn-ingest',{batch,proof:f.proof({sessionId:'other',purpose:'completed-turn-ingestion',sourceId:bound.source.id,batchHash:createHash('sha256').update(JSON.stringify(batch)).digest('hex')})});await delay(250);assert.equal((await f.call('organizer-status',{topicId:topic.id})).tasks.length,0);release();await until(async()=> (await f.call('turn-status',{topicId:topic.id})).organized===1);assert.equal((await f.status()).tasks[0].status,'failed');assert.equal((await f.call('turn-status',{topicId:f.bound.topic.id})).backlog,1);
 }finally{release();await f.close();}
});
test('controlled hourly clock expires usage without silently resuming budget pause',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bang-clock-')),clock=path.join(dir,'clock.json');await fs.writeFile(clock,'10000000');process.env.BANG_ORGANIZER_TEST_CLOCK_FILE=clock;
 const f=await controlled(async(input,res)=>res.end(JSON.stringify({version:1,changes:[]})));delete process.env.BANG_ORGANIZER_TEST_CLOCK_FILE;
 try{await f.call('organizer-configure',{limits:{callsPerHour:1}});await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn(),f.turn('second','c2')]));await until(async()=> (await f.status()).pauseReason==='BUDGET_EXHAUSTED');await fs.writeFile(clock,'13600001');await delay(200);const s=await f.status();assert.equal(s.callsLastHour,0);assert.equal(s.pauseReason,'BUDGET_EXHAUSTED');assert.equal((await f.call('turn-status',{topicId:f.bound.topic.id})).organized,1);await f.control('resume');await until(async()=> (await f.call('turn-status',{topicId:f.bound.topic.id})).organized===2);}finally{await f.close();await fs.rm(dir,{recursive:true});}
});
test('executor reported usage is visible and survives reopen without prompts',async()=>{
 const f=await controlled(async(input,res)=>res.end(JSON.stringify({version:1,changes:[],usage:{inputTokens:12,outputTokens:4}})));
 try{await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));await until(async()=> (await f.status()).tasks[0]?.status==='no-change');await f.call('stop');assert.deepEqual((await f.status()).tasks[0].usage,{inputTokens:12,outputTokens:4});}finally{await f.close();}
});
