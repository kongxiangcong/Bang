import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fixture} from './completed-turns.test.mjs';
import {runtimeOperation} from '../runtime/native/runtime.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<150;i++){const v=await fn();if(v)return v;await delay(50);}throw Error('Native attempt did not settle');}
async function nativeFixture(mode='success',graceMs=200){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'Bang 模型 path ')),entry=path.join(dir,'执行 entry.mjs');
 await fs.copyFile(new URL('./native-worker-fixture.mjs',import.meta.url),entry);
 process.env.BANG_ORGANIZER_NATIVE=JSON.stringify({version:1,executable:process.execPath,args:[entry,mode,dir],policy:'no-tools',graceMs});
 process.env.BANG_TEST_SECRET='MUST_NOT_REACH_WORKER';
 const f=await fixture();delete process.env.BANG_ORGANIZER_NATIVE;delete process.env.BANG_TEST_SECRET;
 const close=f.close;f.close=async()=>{await close();await fs.rm(dir,{recursive:true,force:true});};
 f.status=()=>f.call('organizer-status',{topicId:f.bound.topic.id});f.dir=dir;
 f.begin=async()=>{await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn('calling-turn','c1','v1','原文 $(echo injected) & | "秘密"')]));};return f;
}
test('native Organizer receives exact stdin in Unicode/spaced entry paths and publishes only restricted output',async()=>{
 const f=await nativeFixture();try{await f.begin();const task=await until(async()=>{const s=await f.status();return s.tasks[0]?.status==='committed'&&s.tasks[0];});const state=await runtimeOperation(f.project,'state',f.bound.topic.id);assert.equal(state.canvas.nodes[0].text,'原文 $(echo injected) & | "秘密"');assert.equal(task.process.exitConfirmed,true);assert.equal(task.process.forced,false);const observed=JSON.parse(await fs.readFile(path.join(f.dir,'observed.json'),'utf8'));assert.equal(observed.secret,undefined);assert.equal(observed.policy,'no-tools');assert.equal(observed.cwd===f.project,false);assert.equal(observed.argv.includes('秘密'),false);assert.doesNotMatch(JSON.stringify(await f.status()),/秘密|MUST_NOT_REACH_WORKER/);await f.call('stop');assert.equal((await f.status()).tasks[0].process.exitConfirmed,true);}finally{await f.close();}
});
async function treePids(f){return until(async()=>{try{return await Promise.all([0,1,2].map(async n=>Number(await fs.readFile(path.join(f.dir,`pid-${n}`),'utf8'))));}catch{return false;}}).catch(async e=>{throw Error(e.message+' '+JSON.stringify(await fs.readdir(f.dir))+' '+await fs.readFile(path.join(f.dir,'child-errors'),'utf8').catch(()=>'' )+' '+JSON.stringify(await f.status()));});}
function alive(pid){try{process.kill(pid,0);return true;}catch{return false;}}
test('cancel first requests cooperative stop then confirms forced child and grandchild exit while fencing late output',async()=>{
 const f=await nativeFixture('stubborn');try{await f.begin();const pids=await treePids(f);const cancel=await f.call('organizer-control',{topicId:f.bound.topic.id,action:'cancel'});assert.equal(cancel.tasks[0].status,'cancelled');const task=await until(async()=>{const t=(await f.status()).tasks[0];return t.process?.exitConfirmed&&t;});assert.equal(task.process.forced,true);assert.equal(task.status,'cancelled');assert.equal(await fs.readFile(path.join(f.dir,'stop-0'),'utf8'),'cooperative-stop-observed');assert.deepEqual(pids.map(alive),[false,false,false]);assert.equal((await runtimeOperation(f.project,'state',f.bound.topic.id)).revision,0);await f.call('stop');assert.equal((await f.status()).tasks[0].process.exitConfirmed,true);}finally{await f.close();}
});
test('cooperative cancellation confirms all descendants without force',async()=>{
 const f=await nativeFixture('graceful');try{await f.begin();const pids=await treePids(f);await f.call('organizer-control',{topicId:f.bound.topic.id,action:'cancel'});const task=await until(async()=>{const t=(await f.status()).tasks[0];return t.process?.exitConfirmed&&t;});assert.equal(task.process.forced,false);assert.deepEqual(pids.map(alive),[false,false,false]);}finally{await f.close();}
});
test('native timeout bounds all three attempts and confirms descendant exit before retry',async()=>{
 const f=await nativeFixture('stubborn');try{await f.call('organizer-configure',{limits:{timeoutMs:700}});await f.begin();const pids=await treePids(f);const task=await until(async()=>{const t=(await f.status()).tasks[0];return t?.status==='failed'&&t;});assert.equal(task.error.code,'ATTEMPT_TIMEOUT');assert.equal(task.attempts.length,3);assert.equal(task.process.exitConfirmed,true);assert.deepEqual(pids.map(alive),[false,false,false]);const latest=await treePids(f);assert.deepEqual(latest.map(alive),[false,false,false]);assert.equal((await runtimeOperation(f.project,'state',f.bound.topic.id)).revision,0);}finally{await f.close();}
});
test('daemon death cleans the native tree and a new epoch cannot commit its old result',async()=>{
 const f=await nativeFixture('stubborn');try{await f.begin();const pids=await treePids(f),before=await f.call('status');process.kill(before.pid,'SIGKILL');await until(()=>pids.every(p=>!alive(p)));const after=await f.call('start');assert.notEqual(after.epoch,before.epoch);const task=(await f.status()).tasks[0];assert.equal(task.error.code,'ATTEMPT_INTERRUPTED');assert.equal((await runtimeOperation(f.project,'state',f.bound.topic.id)).revision,0);assert.equal((await f.call('turn-status',{topicId:f.bound.topic.id})).backlog,1);}finally{await f.close();}
});
test('orderly daemon stop waits for native descendants and restart reports interrupted work',async()=>{
 const f=await nativeFixture('stubborn');try{await f.begin();const pids=await treePids(f);await f.call('stop');assert.deepEqual(pids.map(alive),[false,false,false]);const task=(await f.status()).tasks[0];assert.equal(task.error.code,'ATTEMPT_INTERRUPTED');assert.equal((await runtimeOperation(f.project,'state',f.bound.topic.id)).revision,0);}finally{await f.close();}
});
test('a cancelling process retains its concurrency slot without blocking other public operations',async()=>{
 const f=await nativeFixture('stubborn',1500);try{await f.begin();await treePids(f);const topic=await f.call('topic-create',{name:'next'}),session=await f.call('session-connect',f.proof({sessionId:'other'})),bound=await f.call('binding-enable',{...session,topicId:topic.id});
 const {createHash}=await import('node:crypto');const batch={sourceId:bound.source.id,previousCursor:'c0',events:[f.turn()]};await f.call('turn-ingest',{batch,proof:f.proof({sessionId:'other',purpose:'completed-turn-ingestion',sourceId:bound.source.id,batchHash:createHash('sha256').update(JSON.stringify(batch)).digest('hex')})});await f.call('organizer-enable',{topicId:topic.id});await f.call('organizer-control',{topicId:f.bound.topic.id,action:'cancel'});await delay(300);assert.equal((await f.call('organizer-status',{topicId:topic.id})).tasks.length,0);assert.equal((await f.call('status')).status,'running');await until(async()=> (await f.call('organizer-status',{topicId:topic.id})).tasks.length===1);
 }finally{await f.close();}
});

