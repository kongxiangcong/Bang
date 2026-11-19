import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './completed-turns.test.mjs';

test('answer versions expose durable current pointer and history without reselecting an older duplicate',async()=>{
 const f=await fixture();try{
 await f.call('turn-ingest',f.signed([f.turn()]));
 await f.call('turn-ingest',f.signed([f.turn('calling-turn','c2','v2')],'c1'));
 await f.call('turn-ingest',f.signed([f.turn('calling-turn','c3','v1')],'c2'));
 let status=await f.call('turn-status',{topicId:f.bound.topic.id});
 assert.equal(status.versions.length,2);assert.deepEqual(status.versions.map(v=>v.current),[false,true]);
 assert.equal(status.versions[0].processing,'superseded');assert.equal(status.pending.length,1);
 const source=await f.call('turn-source',{topicId:f.bound.topic.id,id:status.versions[0].id});
 assert.equal(source.currentVersionId,'v2');assert.deepEqual(source.history.map(v=>v.versionId),['v1','v2']);
 await f.call('stop');assert.deepEqual(await f.call('turn-status',{topicId:f.bound.topic.id}),status);
 }finally{await f.close();}
});
import {createServer} from 'node:http';
import {runtimeOperation} from '../runtime/native/runtime.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(f,count){for(let i=0;i<150;i++){const s=await f.call('organizer-status',{topicId:f.bound.topic.id});if(s.tasks.length===count&&s.tasks.every(t=>!['running','retry'].includes(t.status)))return s;await delay(40);}throw Error('Organizer timeout');}
async function setup(handler){const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;res.end(JSON.stringify(await handler(JSON.parse(body))));});await new Promise(r=>server.listen(0,'127.0.0.1',r));process.env.BANG_ORGANIZER_ENDPOINT=`http://127.0.0.1:${server.address().port}`;const f=await fixture();delete process.env.BANG_ORGANIZER_ENDPOINT;const close=f.close;f.close=async()=>{await close();server.closeAllConnections();await new Promise(r=>server.close(r));};f.state=()=>runtimeOperation(f.project,'state',f.bound.topic.id);return f;}
const result=(input,id,type='create-card')=>({version:1,changes:[{type,id,...(type==='create-card'?{text:'结论'+id}:{}),conditions:[],uncertainty:'未验证',sources:[input.completedTurns[0].id]}]});
test('new answer withdraws exclusive old support, keeps independent support and manual body, and survives reopen',async()=>{
 let count=0;const f=await setup(input=>++count===1?{version:1,changes:[...result(input,'exclusive').changes,...result(input,'shared').changes]}:result(input,'shared','supplement-card'));
 try{await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));await wait(f,1);
 await f.call('turn-ingest',f.signed([f.turn('independent','c2')],'c1'));await wait(f,2);
 await f.call('organizer-control',{topicId:f.bound.topic.id,action:'pause'});
 const before=await f.state();await f.call('turn-ingest',f.signed([f.turn('calling-turn','c3','v2','修正回答')],'c2'));
 const after=await f.state();assert.equal(after.metadata.exclusive.basis?.status,'needs-review');assert.notEqual(after.metadata.shared.basis?.status,'needs-review');
 assert.deepEqual(after.canvas,before.canvas);assert.deepEqual(after.metadata.exclusive.knowledge,before.metadata.exclusive.knowledge);
 const context=await runtimeOperation(f.project,'knowledge-context',f.bound.topic.id);assert.deepEqual(context.knowledgeCards.map(n=>n.id),['shared']);assert.equal(JSON.stringify(context.metadata.shared).includes(before.metadata.exclusive.knowledge.sources[0]),false);
 await f.call('stop');assert.deepEqual(await f.state(),after);
 }finally{await f.close();}
});
test('superseded failed work cannot block the new answer and obsolete in-flight output cannot commit',async()=>{
 let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);let count=0;
 const f=await setup(async input=>{if(++count===1){enter();await gate;}return result(input,'answer-'+input.completedTurns[0].versionId);});
 try{await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));await Promise.race([entered,delay(5000).then(async()=>{throw Error(JSON.stringify(await f.call('organizer-status',{topicId:f.bound.topic.id})));})]);
 await f.call('turn-ingest',f.signed([f.turn('calling-turn','c2','v2','新回答')],'c1'));release();
 const status=await wait(f,2);assert.equal(status.tasks[0].status,'superseded');assert.equal(status.tasks[1].status,'committed');assert.deepEqual((await f.state()).canvas.nodes.map(n=>n.id),['answer-v2']);
 }finally{release();await f.close();}
});
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../runtime/canvas/bang.mjs',import.meta.url));
test('source and invalidation recover together after actual publication kill; retry never duplicates a revision; backup retains versions frozen',async()=>{
 const f=await setup(input=>result(input,'finding'));let restored;
 try{await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));await wait(f,1);await f.call('organizer-control',{topicId:f.bound.topic.id,action:'pause'});
 const before=await f.state();await f.call('stop');
 const started=spawnSync(process.execPath,[cli,'start','--project',f.project],{encoding:'utf8',env:{...process.env,BANG_PUBLICATION_TEST_PROJECT:f.project,BANG_PUBLICATION_TEST_FAULT:'replaced'},timeout:15000});assert.equal(started.status,0,started.stderr);
 const delivery=f.signed([f.turn('calling-turn','c2','v2','修订回答')],'c1');const pending=f.call('turn-ingest',delivery).catch(e=>e);
 let marker;for(let i=0;i<100;i++){try{marker=JSON.parse(await fs.readFile(path.join(f.project,'.bang/runtime/publication-test.json'),'utf8'));break;}catch{}await delay(25);}assert.equal(marker?.phase,'replaced');process.kill(marker.pid,'SIGKILL');await pending;
 const after=await f.state();assert.equal(after.revision,before.revision+1);assert.equal(after.metadata.finding.basis.status,'needs-review');assert.deepEqual(after.canvas,before.canvas);
 assert.equal((await f.call('turn-ingest',delivery)).duplicate,true);assert.equal((await f.state()).revision,after.revision);
 const backup=await f.call('backup-export');restored=(await f.call('backup-restore',{backup})).projectPath;const status=await runtimeOperation(restored,'turn-status',undefined,{topicId:f.bound.topic.id});assert.deepEqual(status.versions.map(s=>s.current),[false,true]);assert.equal(status.backlog,0);assert.equal(status.versions[1].processing,'frozen');assert.deepEqual(await runtimeOperation(restored,'state',f.bound.topic.id),after);
 }finally{if(restored)await runtimeOperation(restored,'stop');await f.close();}
});
test('regeneration preserves a reviewed human body while retaining original answer history',async()=>{
 const f=await setup(input=>result(input,'finding'));
 try{await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));await wait(f,1);await f.call('organizer-control',{topicId:f.bound.topic.id,action:'pause'});
 await runtimeOperation(f.project,'commit',f.bound.topic.id,{operationId:'human',topic:f.bound.topic.id,baseRevision:1,author:{kind:'manual',id:'user'},readDependencies:[],intent:'explicit-save',operations:[{type:'edit-card',id:'finding',text:'人工保留的独立断言'}]});
 await runtimeOperation(f.project,'basis-review',f.bound.topic.id,{operationId:'review',baseRevision:2,id:'finding',dependencies:[],note:'明确作为人工断言',authorId:'user'});
 await f.call('turn-ingest',f.signed([f.turn('calling-turn','c2','v2','重生成回答')],'c1'));const state=await f.state();assert.equal(state.canvas.nodes[0].text,'人工保留的独立断言');assert.equal(state.metadata.finding.basis.status,'reviewed');assert.equal(state.metadata.finding.source.kind,'manual');assert.equal((await f.call('turn-status',{topicId:f.bound.topic.id})).versions.length,2);
 }finally{await f.close();}
});
test('a pending proposal cannot adopt an obsolete answer after regeneration',async()=>{
 const f=await setup(input=>({version:1,changes:[{type:'edit-card',id:'manual',text:'旧回答建议',conditions:[],uncertainty:'',sources:[input.completedTurns[0].id]}]}));
 try{await runtimeOperation(f.project,'commit',f.bound.topic.id,{operationId:'seed',topic:f.bound.topic.id,baseRevision:0,author:{kind:'manual',id:'user'},readDependencies:[],intent:'explicit-save',operations:[{type:'create-card',card:{id:'manual',text:'人工正文',x:0,y:0,width:320,height:120}}]});await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));await wait(f,1);await f.call('organizer-control',{topicId:f.bound.topic.id,action:'pause'});const proposal=(await runtimeOperation(f.project,'proposals',f.bound.topic.id))[0];await f.call('turn-ingest',f.signed([f.turn('calling-turn','c2','v2','新回答')],'c1'));await assert.rejects(runtimeOperation(f.project,'proposal-review',f.bound.topic.id,{id:proposal.id,decision:'accept'}),/source.*superseded/i);assert.equal((await f.state()).canvas.nodes[0].text,'人工正文');
 }finally{await f.close();}
});
import {createCanvasMiddleware} from '../runtime/canvas/http.mjs';
test('protected HTTP and JSON stdin CLI expose source version history with distinct current and processing identities',async()=>{
 const f=await fixture(),server=createServer(createCanvasMiddleware({project:f.project}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{await f.call('turn-ingest',f.signed([f.turn()]));await f.call('turn-ingest',f.signed([f.turn('calling-turn','c2','v2','new')],'c1'));const base=`http://127.0.0.1:${server.address().port}/api/canvas/`,url=base+f.bound.topic.id;
 assert.equal((await fetch(url+'/turns')).status,403);const {token}=await (await fetch(base+'session/bootstrap')).json(),headers={'x-bang-browser-token':token};const status=await (await fetch(url+'/turns',{headers})).json();assert.deepEqual(status.versions.map(s=>[s.versionId,s.current,s.processing]),[['v1',false,'superseded'],['v2',true,'pending']]);
 const source=spawnSync(process.execPath,[cli,'turn-source','--project',f.project],{encoding:'utf8',input:JSON.stringify({topicId:f.bound.topic.id,id:status.versions[0].id})});assert.equal(source.status,0,source.stderr);const value=JSON.parse(source.stdout);assert.equal(value.currentVersionId,'v2');assert.equal(value.assistant.content,'合成回答');assert.deepEqual(value.history.map(s=>s.versionId),['v1','v2']);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await f.close();}
});
test('replacement propagates through dependent conclusions even when the later turn remains current',async()=>{
 let count=0;const f=await setup(input=>result(input,++count===1?'premise':'derived'));
 try{await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));await wait(f,1);await f.call('turn-ingest',f.signed([f.turn('later','c2')],'c1'));await wait(f,2);await f.call('organizer-control',{topicId:f.bound.topic.id,action:'pause'});await f.call('turn-ingest',f.signed([f.turn('calling-turn','c3','v2','修订')],'c2'));const state=await f.state();assert.equal(state.metadata.premise.basis.status,'needs-review');assert.equal(state.metadata.derived.basis.status,'needs-review');assert.equal(state.canvas.nodes[1].text,'结论derived');
 }finally{await f.close();}
});
