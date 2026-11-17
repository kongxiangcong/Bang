import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {runtimeOperation} from '../runtime/native/runtime.mjs';
import {compileCanvas} from '../runtime/canvas/contract.ts';
import {fixture} from './completed-turns.test.mjs';
import {resultSchema} from '../runtime/codex/result-schema.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('mixed rules select separate typed regions, retain uncertain free cards and never retype committed cards',()=>{
 const cards=['category','member','claim','reason','start','end','uncertain'].map(id=>({id,text:id}));
 const edges=[{id:'c',fromNode:'category',toNode:'member',kind:'classification'},{id:'a',fromNode:'reason',toNode:'claim',kind:'support'},{id:'f',fromNode:'start',toNode:'end',kind:'precedence'},{id:'cross',fromNode:'claim',toNode:'start',kind:'general'}];
 const result=compileCanvas({cards,edges,autoStructure:true});
 assert.equal(result.nodes[0].structure?.kind,'classification');assert.equal(result.nodes[2].structure?.kind,'argument');assert.equal(result.nodes[4].structure?.kind,'flow');assert.equal(result.nodes[6].structure??null,null);
 assert.deepEqual(result.edges,edges);assert.ok(result.structureDecisions.every(d=>d.reason&&d.scope.length&&d.rulesRevision===4));
 const again=compileCanvas({cards:[],previous:result,autoStructure:true});assert.deepEqual(again.nodes,result.nodes);
 const ambiguous=compileCanvas({cards:cards.slice(0,2),edges:[edges[0],{id:'other',fromNode:'member',toNode:'category',kind:'support'}],autoStructure:true});assert.ok(ambiguous.nodes.every(n=>!n.structure));
});

test('automatic Organizer publication uses mixed rules and the shared provider admits only scoped reorganization fields',async()=>{
 const grammar=resultSchema.properties.changes.items.anyOf.find(s=>s.properties.type.const==='reorganize-card');assert.deepEqual(grammar.required,['type','id','structure','reason']);assert.equal(grammar.additionalProperties,false);
 const model=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const input=JSON.parse(body),common={sources:[input.completedTurns[0].id],conditions:[],uncertainty:'controlled evidence'};res.end(JSON.stringify({version:1,changes:[...['category','member','claim','reason','unknown'].map(id=>({type:'create-card',id,text:id,...common})),{type:'create-relation',id:'c',fromNode:'category',toNode:'member',kind:'classification',label:'contains',...common},{type:'create-relation',id:'a',fromNode:'reason',toNode:'claim',kind:'support',label:'supports',...common}]}));});
 await new Promise(r=>model.listen(0,'127.0.0.1',r));process.env.BANG_ORGANIZER_ENDPOINT=`http://127.0.0.1:${model.address().port}`;const f=await fixture();delete process.env.BANG_ORGANIZER_ENDPOINT;
 try{await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));let task;for(let i=0;i<100;i++){task=(await f.call('organizer-status',{topicId:f.bound.topic.id})).tasks[0];if(task&&task.status!=='running')break;await new Promise(r=>setTimeout(r,50));}assert.equal(task.status,'committed');assert.ok(task.diagnostics.some(d=>d.kind==='free'&&d.reason&&d.scope.includes('unknown')));
  const state=await runtimeOperation(f.project,'state',f.bound.topic.id);assert.deepEqual(state.canvas.nodes.map(n=>n.structure?.kind??'free'),['classification','classification','argument','argument','free']);assert.equal(state.canvas.edges.length,2);
 }finally{await f.close();model.closeAllConnections();await new Promise(r=>model.close(r));}
});

test('model cannot retype committed structure, invent relations, change geometry or touch unselected cards',async()=>{
 let output;
 const model=createServer(async(req,res)=>{for await(const c of req){}res.end(JSON.stringify({version:1,changes:output}));});
 await new Promise(r=>model.listen(0,'127.0.0.1',r));process.env.BANG_ORGANIZER_ENDPOINT=`http://127.0.0.1:${model.address().port}`;
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'bang-reorganize-invalid-'));
 try{for(const [i,change] of [
  {type:'reorganize-card',id:'a',structure:{version:1,kind:'radial',rootId:'a'},reason:'model whim'},
  {type:'reorganize-card',id:'outside',structure:null,reason:'outside'},
  {type:'reorganize-card',id:'a',structure:null,reason:'move',x:50},
  {type:'create-relation',id:'invented',fromNode:'a',toNode:'outside',label:'claim'}
 ].entries()){const topic='case'+i,call=(op,input)=>runtimeOperation(project,op,topic,input);output=[change];const structure={version:1,kind:'classification',rootId:'a'};await call('generate',{cards:[{id:'a',text:'A',structure},{id:'outside',text:'Unselected'}]});const before=await call('state'),request=await call('reorganize-request',{ids:['a'],baseRevision:0,intent:'reorganize-selection'});let preview;for(let n=0;n<100;n++){preview=await call('reorganize-preview',{id:request.id});if(preview.status==='failed')break;await new Promise(r=>setTimeout(r,40));}assert.equal(preview.status,'failed');assert.deepEqual(await call('state'),before);}
 }finally{delete process.env.BANG_ORGANIZER_ENDPOINT;await runtimeOperation(project,'stop');model.closeAllConnections();await new Promise(r=>model.close(r));await fs.rm(project,{recursive:true,force:true});}
});

test('selected reorganization runs an executor, previews without saving, commits locally and reopens',async()=>{
 let received;
 const model=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;received=JSON.parse(body);res.end(JSON.stringify({version:1,changes:['root','child'].map(id=>({type:'reorganize-card',id,structure:{version:1,kind:'classification',rootId:'root'},reason:'Explicit category relation'}))}));});
 await new Promise(r=>model.listen(0,'127.0.0.1',r));
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'bang-reorganize-')),topic='demo',call=(op,input)=>runtimeOperation(project,op,topic,input);
 process.env.BANG_ORGANIZER_ENDPOINT=`http://127.0.0.1:${model.address().port}`;
 try{
  await call('generate',{cards:[{id:'root',text:'Category',fixed:true,zIndex:9},{id:'child',text:'Member',zIndex:3},...Array.from({length:105},(_,i)=>({id:'outside'+i,text:'Unseen '+i,x:8000+i*400,y:0}))],edges:[{id:'edge',fromNode:'root',toNode:'child',kind:'classification'}]});
  const before=await call('state');
  const request=await call('reorganize-request',{ids:['root','child'],baseRevision:before.revision,intent:'reorganize-selection'});
  let preview;for(let i=0;i<100;i++){preview=await call('reorganize-preview',{id:request.id});if(preview.status==='ready')break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(preview.status,'ready');assert.equal((await call('state')).revision,before.revision);
  assert.equal((await runtimeOperation(project,'organizer-status',undefined,{topicId:topic})).enabled,false,'selected analysis must not enable automatic discussion processing');
  assert.deepEqual(received.selection.ids,['root','child']);assert.equal(received.activeContext.knowledgeCards.length,2);
  assert.equal(preview.decisions[0].reason,'Explicit category relation');
  await assert.rejects(call('reorganize-accept',{id:request.id,previewKey:'invalid'}),/preview acceptance/);
  const accepted={id:request.id,previewKey:preview.previewKey},cli=spawnSync(process.execPath,[fileURLToPath(new URL('../runtime/canvas/bang.mjs',import.meta.url)),'reorganize-accept','--project',project,'--topic',topic],{input:JSON.stringify(accepted),encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);const receipt=JSON.parse(cli.stdout);assert.equal(receipt.status,'committed');assert.deepEqual(await call('reorganize-accept',accepted),receipt);
  const saved=await call('state');assert.equal(saved.canvas.nodes[1].structure.kind,'classification');
  assert.deepEqual(saved.canvas.nodes.slice(2),before.canvas.nodes.slice(2));assert.equal(saved.canvas.nodes[0].x,before.canvas.nodes[0].x);assert.equal(saved.canvas.nodes[0].zIndex,9);assert.deepEqual(saved.canvas.edges,before.canvas.edges);
  assert.deepEqual(saved.metadata.root.source,before.metadata.root.source);
  await call('stop');assert.deepEqual((await call('state')).canvas,saved.canvas);
 }finally{delete process.env.BANG_ORGANIZER_ENDPOINT;await call('stop');model.closeAllConnections();await new Promise(r=>model.close(r));await fs.rm(project,{recursive:true,force:true});}
});

test('reorganization previews are fenced by manual ABA, historical restore and frozen complete backup',async()=>{
 const model=createServer(async(req,res)=>{for await(const c of req){}res.end(JSON.stringify({version:1,changes:[{type:'reorganize-card',id:'a',structure:null,reason:'Uncertain, retain free grouping'}]}));});
 await new Promise(r=>model.listen(0,'127.0.0.1',r));process.env.BANG_ORGANIZER_ENDPOINT=`http://127.0.0.1:${model.address().port}`;
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'bang-reorganize-fence-')),topic='demo',call=(op,input)=>runtimeOperation(project,op,topic,input);
 async function ready(){const state=await call('state'),r=await call('reorganize-request',{ids:['a'],baseRevision:state.revision,intent:'reorganize-selection'});for(let i=0;i<100;i++){const p=await call('reorganize-preview',{id:r.id});if(p.status==='ready')return p;await new Promise(r=>setTimeout(r,40));}throw Error('Timed out');}
 async function edit(text){const s=await call('state');return call('commit',{operationId:crypto.randomUUID(),topic,baseRevision:s.revision,author:{kind:'manual',id:'user'},intent:'explicit-save',readDependencies:[],operations:[{type:'edit-card',id:'a',text}]});}
 try{await call('generate',{cards:[{id:'a',text:'A'}]});const old=await ready();await edit('B');await edit('A');await assert.rejects(call('reorganize-accept',{id:old.id,previewKey:old.previewKey}),/baseline conflict/);
  const current=await ready(),backup=await call('backup-export');assert.equal((await call('backup-verify',{backup})).valid,true);assert.ok(backup.payload.tables.organizer_tasks.every(r=>JSON.parse(r.body).reorganization.frozen));
  const preview=await call('restore-preview',{revision:0});await call('restore-version',{...preview,operationId:crypto.randomUUID(),author:{kind:'manual',id:'user'},intent:'restore-version'});
  await assert.rejects(call('reorganize-accept',{id:current.id,previewKey:current.previewKey}),/frozen/);
  await call('stop');await assert.rejects(call('reorganize-preview',{id:current.id}),/frozen/);assert.equal((await call('state')).canvas.nodes[0].text,'A');
 }finally{delete process.env.BANG_ORGANIZER_ENDPOINT;await call('stop');model.closeAllConnections();await new Promise(r=>model.close(r));await fs.rm(project,{recursive:true,force:true});}
});

test('restore revokes a running selected analysis before its late model result can become a preview',async()=>{
 let release,received=false;const gate=new Promise(r=>release=r);
 const model=createServer(async(req,res)=>{for await(const c of req){}received=true;await gate;res.end(JSON.stringify({version:1,changes:[{type:'reorganize-card',id:'a',structure:null,reason:'Late candidate'}]}));});
 await new Promise(r=>model.listen(0,'127.0.0.1',r));process.env.BANG_ORGANIZER_ENDPOINT=`http://127.0.0.1:${model.address().port}`;
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'bang-reorganize-late-')),call=(op,input)=>runtimeOperation(project,op,'demo',input);
 try{await call('generate',{cards:[{id:'a',text:'A'}]});const request=await call('reorganize-request',{ids:['a'],baseRevision:0,intent:'reorganize-selection'});for(let i=0;i<100&&!received;i++)await new Promise(r=>setTimeout(r,30));assert.equal(received,true);
  const preview=await call('restore-preview',{revision:0});await call('restore-version',{...preview,operationId:crypto.randomUUID(),author:{kind:'manual',id:'user'},intent:'restore-version'});const restored=await call('state');release();await new Promise(r=>setTimeout(r,200));await assert.rejects(call('reorganize-preview',{id:request.id}),/frozen/);assert.deepEqual(await call('state'),restored);
 }finally{release();delete process.env.BANG_ORGANIZER_ENDPOINT;await call('stop');model.closeAllConnections();await new Promise(r=>model.close(r));await fs.rm(project,{recursive:true,force:true});}
});
