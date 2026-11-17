import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runtimeOperation} from '../runtime/native/runtime.mjs';
import {fixture} from './completed-turns.test.mjs';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const cli=fileURLToPath(new URL('../runtime/canvas/bang.mjs',import.meta.url));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<150;i++){const value=await fn();if(value)return value;await delay(40);}throw Error('Timed out');}
async function setup(handler){const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;res.end(JSON.stringify(await handler(JSON.parse(body))));});await new Promise(r=>server.listen(0,'127.0.0.1',r));process.env.BANG_ORGANIZER_ENDPOINT=`http://127.0.0.1:${server.address().port}`;const f=await fixture();delete process.env.BANG_ORGANIZER_ENDPOINT;const close=f.close;f.close=async()=>{await close();server.closeAllConnections();await new Promise(r=>server.close(r));};f.board=(command,input)=>runtimeOperation(f.project,command,f.bound.topic.id,input);return f;}
const patch=(topic,operationId,baseRevision,operations)=>({topic,operationId,baseRevision,operations,author:{kind:'manual',id:'user'},intent:'explicit-save',readDependencies:[]});
async function restore(call,revision,operationId='restore'){
 const preview=await call('restore-preview',{revision});
 return call('restore-version',{...preview,operationId,author:{kind:'manual',id:'user'},intent:'restore-version'});
}
test('previewed historical content becomes a new durable revision with retained history and idempotent receipt',async()=>{
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'bang-restore-')),call=(command,input)=>runtimeOperation(project,command,'demo',input);
 try{
 await call('generate',{cards:[{id:'a',text:'A'},{id:'b',text:'B'}],edges:[{id:'ab',fromNode:'a',toNode:'b',label:'basis'}]});
 await call('commit',patch('demo','draw',0,[{type:'create-extra',extra:{id:'drawing',element:{id:'drawing',type:'line',x:3.25,y:4.5,angle:0.7,points:[[0,0],[40,50]]}}}]));
 const original=await call('state');
 await call('commit',patch('demo','edit',1,[{type:'edit-card',id:'a',text:'Later',x:800},{type:'edit-relation',id:'ab',label:'later'},{type:'delete-extra',id:'drawing'}]));
 const preview=await call('restore-preview',{revision:1});assert.equal(preview.baseRevision,2);assert.equal((await call('state')).revision,2);
 const request={...preview,operationId:'restore',author:{kind:'manual',id:'user'},intent:'restore-version'};
 const receipt=await call('restore-version',request);assert.equal(receipt.revision,3);assert.deepEqual(await call('restore-version',request),receipt);
 await call('stop');const state=await call('state');
 for(const key of ['canvas','relations','editorExtras'])assert.deepEqual(state[key],original[key]);
 assert.deepEqual(state.metadata.a.source,original.metadata.a.source);assert.equal(state.restoration.fromRevision,1);
 assert.deepEqual((await call('history')).map(v=>v.revision),[0,1,2,3]);assert.equal((await call('history-preview',{revision:2})).canvas.nodes[0].text,'Later');
 await assert.rejects(call('restore-version',{...request,operationId:'stale'}),/baseline|preview/i);
 }finally{await call('stop');await fs.rm(project,{recursive:true,force:true});}
});
test('restore and its undo never revive old proposal or conversational replacement authority',async()=>{
 const f=await setup(input=>({version:1,changes:[{type:'edit-card',id:'a',text:'Proposed',conditions:[],uncertainty:'',sources:[input.completedTurns[0].id]}]})),topic=f.bound.topic.id;
 try{
 await f.board('commit',patch(topic,'seed',0,[{type:'create-card',card:{id:'a',text:'Human',x:0,y:0,width:200,height:100}}]));
 await f.call('organizer-enable',{topicId:topic});await f.call('turn-ingest',f.signed([f.turn()]));await until(async()=>(await f.board('proposals')).length===1);
 await f.call('organizer-control',{topicId:topic,action:'pause'});const old=(await f.board('proposals'))[0];
 await restore(f.board,0);await f.board('undo',{operationId:'undo',topic,revision:2,author:{kind:'manual',id:'user'},intent:'undo-committed'});
 await assert.rejects(f.board('proposal-review',{id:old.id,decision:'accept'}),/frozen/);assert.equal((await f.board('state')).canvas.nodes[0].text,'Human');
 const turn=f.turn('command','c2');turn.user.content='请将白板卡片「a」正文改为「Proposed」';turn.sourceHash=createHash('sha256').update(JSON.stringify([turn.user.content,turn.assistant.content])).digest('hex');
 await f.call('turn-ingest',f.signed([turn],'c1'));const id=(await f.call('turn-status',{topicId:topic})).pending[0].id;
 await restore(f.board,3,'freeze-command');await f.call('organizer-control',{topicId:topic,action:'reanalyze',sourceIds:[id]});await f.call('organizer-enable',{topicId:topic});
 await until(async()=>(await f.call('turn-status',{topicId:topic})).organized===2);
 assert.equal((await f.call('turn-source',{topicId:topic,id})).humanIntent.frozen,true);assert.equal((await f.board('state')).canvas.nodes[0].text,'Human');assert.equal((await f.board('proposals')).filter(p=>!p.frozen&&p.status==='pending').length,1);
 }finally{await f.close();}
});
test('board restore preserves pinned context and delivered receipts while the next utterance sees the restored revision',async()=>{
 const f=await fixture(),topic=f.bound.topic.id,call=(c,i)=>runtimeOperation(f.project,c,topic,i),digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const context=(command,input={},turnId='pinned')=>{const data={topicId:topic,turnId,...input};return f.call(command,{...data,proof:f.proof({purpose:command,turnId,bridgeId:'bridge',requestHash:digest(data)})});};
 try{
 await f.call('context-register',{id:'bridge',connectorId:'controlled'});
 await call('commit',patch(topic,'card',0,[{type:'create-card',card:{id:'a',text:'Pinned',x:0,y:0,width:200,height:100}}]));
 const started=await context('context-start');await context('context-ack',{token:started.token,outcome:'delivered',envelopeHash:digest(started.envelope)});
 await restore(call,0);assert.equal((await context('context-query',{token:started.token,kind:'item',id:'a'})).item.text,'Pinned');
 assert.equal((await call('context-status')).turns[0].status,'delivered');assert.equal((await context('context-start')).envelope.revision,1);
 const next=await context('context-start',{},'next');assert.equal(next.envelope.revision,2);assert.deepEqual(next.envelope.cards,[]);
 }finally{await f.close();}
});
test('historical support never reselects a superseded answer; source cursor and withdrawn context survive restore and undo',async()=>{
 const f=await setup(input=>({version:1,changes:[{type:'create-card',id:'finding',text:'Old conclusion',conditions:['original condition'],uncertainty:'unverified',sources:[input.completedTurns[0].id]}]})),topic=f.bound.topic.id;
 try{
 await f.call('organizer-enable',{topicId:topic});await f.call('turn-ingest',f.signed([f.turn()]));await until(async()=>(await f.board('state')).revision===1);await f.call('organizer-control',{topicId:topic,action:'pause'});
 await f.call('turn-ingest',f.signed([f.turn('calling-turn','c2','v2','Revised answer')],'c1'));assert.equal((await f.board('state')).revision,2);
 await restore(f.board,1);const state=await f.board('state');assert.equal(state.canvas.nodes[0].text,'Old conclusion');assert.deepEqual(state.metadata.finding.knowledge.conditions,['original condition']);assert.equal(state.metadata.finding.basis.status,'needs-review');assert.deepEqual((await f.board('knowledge-context')).knowledgeCards,[]);
 let versions=(await f.call('turn-status',{topicId:topic})).versions;assert.deepEqual(versions.map(v=>v.current),[false,true]);assert.equal(versions[1].processing,'frozen');
 await assert.rejects(f.call('organizer-control',{topicId:topic,action:'reanalyze',sourceIds:[versions[0].id]}),/frozen current/);
 await f.board('undo',{operationId:'undo',topic,revision:3,author:{kind:'manual',id:'user'},intent:'undo-committed'});
 assert.deepEqual((await f.board('knowledge-context')).knowledgeCards,[]);assert.equal((await f.call('turn-status',{topicId:topic})).frozen,1);
 assert.equal((await f.call('binding-status',f.session)).source.receivedCursor,'c2');
 }finally{await f.close();}
});
test('actual process kill recovers restore and frozen backlog together; JSON stdin retry returns the same revision',async()=>{
 const f=await fixture(),topic=f.bound.topic.id,call=(c,i)=>runtimeOperation(f.project,c,topic,i);
 try{
 await call('commit',patch(topic,'human',0,[{type:'create-card',card:{id:'a',text:'A',x:0,y:0,width:200,height:100}}]));await f.call('turn-ingest',f.signed([f.turn()]));
 const request={...await call('restore-preview',{revision:0}),operationId:'crash-restore',author:{kind:'manual',id:'user'},intent:'restore-version'};
 await f.call('stop');const started=spawnSync(process.execPath,[cli,'start','--project',f.project],{encoding:'utf8',env:{...process.env,BANG_PUBLICATION_TEST_PROJECT:f.project,BANG_PUBLICATION_TEST_FAULT:'replaced'}});assert.equal(started.status,0,started.stderr);
 const pending=call('restore-version',request).catch(e=>e);
 const marker=await until(async()=>{try{return JSON.parse(await fs.readFile(path.join(f.project,'.bang/runtime/publication-test.json'),'utf8'));}catch{return null;}});process.kill(marker.pid,'SIGKILL');await pending;
 const state=await call('state');assert.equal(state.revision,2);assert.deepEqual(state.canvas.nodes,[]);assert.equal((await f.call('turn-status',{topicId:topic})).frozen,1);
 const retry=spawnSync(process.execPath,[cli,'restore-version','--project',f.project,'--topic',topic],{input:JSON.stringify(request),encoding:'utf8'});assert.equal(retry.status,0,retry.stderr);assert.equal(JSON.parse(retry.stdout).revision,2);assert.equal((await call('history')).length,3);
 }finally{await f.close();}
});
test('explicit reanalysis selects frozen current source identities, retains frozen authorization and does not reingest',async()=>{
 const inputs=[],f=await setup(input=>{inputs.push(input);return {version:1,changes:[]};}),topic=f.bound.topic.id;
 try{
 await f.call('turn-ingest',f.signed([f.turn()]));await restore(f.board,0);
 const status=await f.call('turn-status',{topicId:topic}),id=status.frozenSources[0].id;
 await f.call('organizer-control',{topicId:topic,action:'reanalyze',sourceIds:[id]});
 await f.call('organizer-enable',{topicId:topic});await until(async()=>(await f.call('turn-status',{topicId:topic})).organized===1);
 assert.equal(inputs[0].completedTurns[0].id,id);assert.equal(inputs[0].completedTurns[0].humanIntent.frozen,true);
 assert.equal((await f.call('turn-status',{topicId:topic})).received,1);
 await assert.rejects(f.call('organizer-control',{topicId:topic,action:'reanalyze',sourceIds:[id]}),/frozen/i);
 await restore(f.board,0,'again');
 const backup=await f.call('backup-export');await f.call('backup-verify',{backup});
 }finally{await f.close();}
});
test('undo of restore compensates knowledge and basis as well as content, preserving later layout and refusing later human text',async()=>{
 const f=await setup(input=>({version:1,changes:[{type:'create-card',id:'finding',text:'Finding',conditions:['only under A'],uncertainty:'untested',sources:[input.completedTurns[0].id]}]})),topic=f.bound.topic.id;
 try{
 await f.call('organizer-enable',{topicId:topic});await f.call('turn-ingest',f.signed([f.turn()]));await until(async()=>(await f.board('state')).revision===1);await f.call('organizer-control',{topicId:topic,action:'pause'});
 await f.board('commit',patch(topic,'human',1,[{type:'edit-card',id:'finding',text:'Human conclusion'}]));
 const before=await f.board('state');assert.equal(before.metadata.finding.basis.status,'needs-review');
 await restore(f.board,1);await f.board('commit',patch(topic,'move',3,[{type:'edit-card',id:'finding',x:999}]));
 await f.board('undo',{operationId:'undo-restore',topic,revision:3,author:{kind:'manual',id:'user'},intent:'undo-committed'});
 const after=await f.board('state');assert.equal(after.canvas.nodes[0].text,'Human conclusion');assert.equal(after.canvas.nodes[0].x,999);assert.deepEqual(after.metadata.finding.knowledge,before.metadata.finding.knowledge);assert.deepEqual(after.metadata.finding.basis,before.metadata.finding.basis);
 await restore(f.board,1,'restore-again');await f.board('commit',patch(topic,'latest-human',6,[{type:'edit-card',id:'finding',text:'Latest human'}]));
 await assert.rejects(f.board('undo',{operationId:'no-overwrite',topic,revision:6,author:{kind:'manual',id:'user'},intent:'undo-committed'}),/conflict/i);assert.equal((await f.board('state')).canvas.nodes[0].text,'Latest human');
 }finally{await f.close();}
});
test('restore fences in-flight attempts and pending sources without rewinding reception; new turns use the restored board',async()=>{
 let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r),inputs=[];
 const f=await setup(async input=>{inputs.push(input);if(inputs.length===1){enter();await gate;}return {version:1,changes:[{type:'create-card',id:'result-'+inputs.length,text:'result',conditions:['conditional'],uncertainty:'unverified',sources:[input.completedTurns[0].id]}]};});
 const topic=f.bound.topic.id;
 try{
 await f.board('commit',patch(topic,'seed',0,[{type:'create-card',card:{id:'a',text:'Restored',x:0,y:0,width:200,height:100}}]));
 await f.board('commit',patch(topic,'later',1,[{type:'edit-card',id:'a',text:'Later'}]));
 await f.call('organizer-enable',{topicId:topic});const delivery=f.signed([f.turn()]);await f.call('turn-ingest',delivery);await entered;
 await f.call('turn-ingest',f.signed([f.turn('pending','c2')],'c1'));
 const receipt=await restore(f.board,1);assert.equal(receipt.revision,3);
 let status=await f.call('turn-status',{topicId:topic});assert.equal(status.frozen,2);assert.equal(status.backlog,0);
 assert.equal((await f.call('organizer-status',{topicId:topic})).tasks[0].status,'frozen');
 assert.equal((await f.call('binding-status',f.session)).source.receivedCursor,'c2');assert.equal((await f.call('turn-ingest',delivery)).duplicate,true);
 release();await delay(250);assert.equal((await f.board('state')).revision,3);
 await f.call('turn-ingest',f.signed([f.turn('new','c3')],'c2'));
 await until(async()=>{const s=await f.board('state');return s.revision===4;});
 assert.equal(inputs[1].activeContext.knowledgeCards[0].text,'Restored');
 assert.equal(inputs.length,2);assert.equal((await f.call('turn-status',{topicId:topic})).received,3);
 status=await f.call('turn-status',{topicId:topic});assert.equal(status.frozen,2);assert.equal(status.organized,1);
 const backup=await f.call('backup-export');assert.equal((await f.call('backup-verify',{backup})).valid,true);
 // Explicitly select a source whose previous attempt was running when restored.
 // Its old attempt remains visible, with a distinct new task and same source.
 await f.call('organizer-control',{topicId:topic,action:'reanalyze',sourceIds:[status.frozenSources[0].id]});
 await until(async()=>(await f.call('turn-status',{topicId:topic})).organized===2);
 assert.equal(inputs[2].completedTurns[0].id,status.frozenSources[0].id);assert.equal(inputs.length,3);
 assert.equal((await f.call('organizer-status',{topicId:topic})).tasks[0].archived,true);
 await f.call('stop');const selected=await f.call('turn-status',{topicId:topic});assert.equal(selected.received,3);assert.equal(selected.frozen,1);assert.equal(selected.organized,2);
 }finally{release();await f.close();}
});
