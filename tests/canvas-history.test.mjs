import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const cli=new URL('../runtime/canvas/bang.mjs',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1');
const cards=['a','b'].map((id,i)=>({id,text:id,x:i*400,y:0,width:240,height:160}));
function run(p,c,input){return spawnSync(process.execPath,[cli,c,'--project',p,'--topic','demo'],{input:input&&JSON.stringify(input),encoding:'utf8'});}
function patch(operationId,baseRevision,operations){return {operationId,topic:'demo',baseRevision,author:{kind:'manual',id:'client'},readDependencies:[],intent:'explicit-save',operations};}
function ok(result){assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);}
test('public history previews immutable revisions and compares content, endpoints, layout and provenance after reopen',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-history-'));
 try{
  ok(run(p,'generate',{cards,edges:[{id:'r',fromNode:'a',toNode:'b'}]}));
  ok(run(p,'commit',patch('edit',0,[{type:'edit-card',id:'a',text:'changed',x:80},{type:'edit-relation',id:'r',fromNode:'b',toNode:'a',label:'condition'}])));
  const list=ok(run(p,'history'));assert.deepEqual(list.map(r=>r.revision),[0,1]);assert.equal(list[1].operationId,'edit');assert.equal(list[1].author.id,'client');
  ok(run(p,'stop'));
  const old=ok(run(p,'history-preview',{revision:0}));assert.equal(old.canvas.nodes[0].text,'a');assert.equal(old.canvas.edges[0].fromNode,'a');
  const diff=ok(run(p,'history-diff',{fromRevision:0,toRevision:1}));
  assert.ok(diff.changes.some(c=>c.collection==='nodes'&&c.id==='a'&&c.field==='text'&&c.before==='a'&&c.after==='changed'));
  assert.ok(diff.changes.some(c=>c.field==='fromNode'&&c.before==='a'&&c.after==='b'));
  assert.ok(diff.changes.some(c=>c.field==='x'&&c.after===80));assert.ok(diff.changes.some(c=>c.collection==='metadata'));
  assert.equal(ok(run(p,'state')).revision,1);
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
function undo(operationId,revision,author='client'){return {operationId,topic:'demo',revision,author:{kind:'manual',id:author},intent:'undo-committed'};}
test('own committed undo compensates only changed fields, preserves unrelated later edits and rejects same-field changes atomically',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-undo-'));
 try{
  ok(run(p,'generate',{cards}));
  ok(run(p,'commit',patch('text',0,[{type:'edit-card',id:'a',text:'new'}])));
  ok(run(p,'commit',patch('layout',1,[{type:'edit-card',id:'a',x:99}])));
  assert.notEqual(run(p,'undo',undo('not-owner',1,'other')).status,0);
  const receipt=ok(run(p,'undo',undo('undo-text',1)));assert.equal(receipt.revision,3);
  assert.deepEqual(ok(run(p,'undo',undo('undo-text',1))),receipt);
  let state=ok(run(p,'state'));assert.equal(state.canvas.nodes[0].text,'a');assert.equal(state.canvas.nodes[0].x,99);assert.equal(state.metadata.a.source.kind,'bootstrap');
  assert.equal(ok(run(p,'history-preview',{revision:1})).canvas.nodes[0].text,'new');
  ok(run(p,'commit',patch('both',3,[{type:'edit-card',id:'a',text:'later'},{type:'edit-card',id:'b',text:'also later'}])));
  ok(run(p,'commit',patch('intervene',4,[{type:'edit-card',id:'a',text:'latest'}])));
  assert.notEqual(run(p,'undo',undo('conflict',4)).status,0);
  state=ok(run(p,'state'));assert.equal(state.revision,5);assert.equal(state.canvas.nodes[1].text,'also later');
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
import http from 'node:http';
import {createCanvasMiddleware} from '../runtime/canvas/http.mjs';
import {canvasRequest} from './canvas-request.mjs';
test('HTTP history and undo are protected; deletion compensation restores identities, relations and provenance without allowing ordinary identity reuse',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-history-http-'));let server;
 try{
  ok(run(p,'generate',{cards,edges:[{id:'r',fromNode:'a',toNode:'b',label:'basis'}]}));
  const original=ok(run(p,'state'));
  ok(run(p,'commit',patch('delete',0,[{type:'delete-card',id:'a'}])));
  server=http.createServer(createCanvasMiddleware({project:p}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/api/canvas/demo`;
  assert.equal((await fetch(url+'/history')).status,403);
  assert.equal((await fetch(url+'/undo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(undo('restore',1))})).status,403);
  const response=await canvasRequest(url+'/undo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(undo('restore',1))});assert.equal(response.status,200,await response.clone().text());
  ok(run(p,'stop'));const restored=ok(run(p,'state'));
  assert.deepEqual(restored.canvas,original.canvas);assert.deepEqual(restored.metadata,original.metadata);assert.deepEqual(restored.relations,original.relations);assert.equal(restored.revision,2);assert.equal(restored.deletionIntents.length,2);
  assert.equal((await (await canvasRequest(url+'/history-preview?revision=1')).json()).canvas.nodes.length,1);
  assert.equal((await (await canvasRequest(url+'/history-diff?from=1&to=2')).json()).changes.filter(c=>c.collection==='edges').length,1);
  assert.notEqual(run(p,'commit',patch('reuse',0,[{type:'create-card',card:cards[0]}])).status,0);
  const denied=await canvasRequest(url+'/undo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(undo('other',1,'not-client'))});assert.equal(denied.status,400);
 }finally{if(server)await new Promise(r=>server.close(r));run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
test('undo preserves later stacking choice, restores default layer position, and refuses dangling relations atomically',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-undo-order-'));
 try{
  ok(run(p,'generate',{cards:[...cards,{id:'c',text:'c',x:800,y:0,width:240,height:160}]}));
  ok(run(p,'commit',patch('front',0,[{type:'edit-card',id:'a',zIndex:100}])));
  assert.deepEqual(ok(run(p,'state')).canvas.nodes.map(n=>n.id),['b','c','a']);
  assert.ok(ok(run(p,'history-diff',{fromRevision:0,toRevision:1})).changes.some(c=>c.field==='order'));
  ok(run(p,'commit',patch('back',1,[{type:'edit-card',id:'c',zIndex:-10}])));
  ok(run(p,'undo',undo('undo-front',1)));
  assert.deepEqual(ok(run(p,'state')).canvas.nodes.map(n=>n.id),['c','a','b']);
  ok(run(p,'commit',patch('add',3,[{type:'create-card',card:{id:'d',text:'d',x:900,y:0,width:240,height:160}}])));
  ok(run(p,'commit',patch('attach',4,[{type:'create-relation',edge:{id:'attached',fromNode:'d',toNode:'a'}}])));
  assert.notEqual(run(p,'undo',undo('no-dangle',4)).status,0);
  assert.equal(ok(run(p,'state')).revision,5);
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
test('undo deletion preserves a later unrelated layer edit',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-undo-delete-order-'));
 try{
  ok(run(p,'generate',{cards:[...cards,{id:'c',text:'c',x:800,y:0,width:240,height:160}]}));
  ok(run(p,'commit',patch('delete',0,[{type:'delete-card',id:'a'}])));
  ok(run(p,'commit',patch('back',1,[{type:'edit-card',id:'c',zIndex:-10}])));
  ok(run(p,'undo',undo('restore',1)));
  assert.deepEqual(ok(run(p,'state')).canvas.nodes.map(n=>n.id),['c','a','b']);
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
test('history and compensation preserve precise annotations and copy provenance across conversion, reopen and later conflicts',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-extra-history-'));
 const element={id:'drawing',type:'line',x:12.25,y:33.75,angle:0.314159,points:[[0,0],[73.125,-19.75],[121.5,44.25]]};
 try{
  ok(run(p,'generate',{cards}));
  ok(run(p,'commit',patch('draw',0,[{type:'create-extra',extra:{id:'drawing',element}}])));
  ok(run(p,'commit',patch('convert-copy',1,[{type:'delete-extra',id:'drawing'},{type:'create-card',card:{...cards[0],id:'copy',derivedFrom:'a',text:'converted'}}])));
  assert.ok(ok(run(p,'history-diff',{fromRevision:1,toRevision:2})).changes.some(c=>c.collection==='editorExtras'&&c.before.element.angle===0.314159));
  ok(run(p,'undo',undo('undo-convert',2)));ok(run(p,'stop'));
  let state=ok(run(p,'state'));assert.deepEqual(state.editorExtras,[{id:'drawing',element}]);assert.equal(state.canvas.nodes.some(n=>n.id==='copy'),false);
  assert.equal(ok(run(p,'history-preview',{revision:2})).metadata.copy.derivedFrom,'a');
  ok(run(p,'commit',patch('rotate',3,[{type:'edit-extra',id:'drawing',element:{...element,angle:0.7}}])));
  ok(run(p,'undo',undo('undo-rotate',4)));state=ok(run(p,'state'));assert.deepEqual(state.editorExtras[0].element,element);
  assert.notEqual(run(p,'undo',undo('conflicting-annotation',1)).status,0);assert.equal(ok(run(p,'state')).revision,5);
  const metadata=state.metadata.a;
  ok(run(p,'commit',patch('card-visual',5,[{type:'create-extra',extra:{id:'a',element:{id:'a',type:'rectangle',angle:0.4}}}])));
  ok(run(p,'undo',undo('undo-card-visual',6)));assert.deepEqual(ok(run(p,'state')).metadata.a,metadata);
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
