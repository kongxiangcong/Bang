import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createCanvasMiddleware} from '../runtime/canvas/http.mjs';
import {canvasRequest} from './canvas-request.mjs';
const cli=new URL('../runtime/canvas/bang.mjs',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1');
const card={id:'a',text:'original',x:0,y:0,width:320,height:180};
function run(p,c,input){return spawnSync(process.execPath,[cli,c,'--project',p,'--topic','demo'],{input:input&&JSON.stringify(input),encoding:'utf8'});}
function patch(id,baseRevision,operations){return {operationId:id,topic:'demo',baseRevision,author:{kind:'manual',id:'client'},readDependencies:[],intent:'explicit-save',operations};}
function ok(result){assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);}
test('two clients merge independent fields and additions without replacing the stale scene',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-merge-'));
 try{
  ok(run(p,'generate',{cards:[card]}));
  ok(run(p,'commit',patch('remote',0,[{type:'edit-card',id:'a',text:'remote text'},{type:'create-card',card:{...card,id:'remote'}}])));
  assert.equal(ok(run(p,'commit',patch('local-move',0,[{type:'edit-card',id:'a',x:100}]))).revision,2);
  const state=ok(run(p,'state'));assert.equal(state.canvas.nodes.length,2);assert.equal(state.canvas.nodes[0].text,'remote text');assert.equal(state.canvas.nodes[0].x,100);
  ok(run(p,'stop')); // Historical field baselines survive a fresh native Runtime.
  // Acknowledging x at revision 2 must not pretend the client has read text at 2.
  const stale=run(p,'commit',patch('unseen-text',0,[{type:'edit-card',id:'a',text:'stale text',fieldRevisions:{x:2}}]));assert.notEqual(stale.status,0);
  assert.equal(ok(run(p,'commit',patch('move-again',0,[{type:'edit-card',id:'a',x:120,fieldRevisions:{x:2}}]))).revision,3);
  assert.equal(ok(run(p,'state')).canvas.nodes[0].text,'remote text');
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
test('preview excludes unsafe resource operations and deleted identities cannot be recreated by a stale client',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-legal-subset-')),outside=await fs.mkdtemp(path.join(os.tmpdir(),'bang-outside-'));
 try{
  ok(run(p,'generate',{cards:[card]}));await fs.symlink(outside,path.join(p,'escape'),'junction');
  const full=patch('unsafe-subset',0,[{type:'edit-card',id:'a',text:'legal'},{type:'create-card',card:{...card,id:'file',type:'file',file:'escape/file.pdf'}}]);
  const preview=ok(run(p,'preview',full));assert.deepEqual(preview.legalOperations,[full.operations[0]]);assert.equal(preview.conflicts.length,1);
  ok(run(p,'commit',patch('delete',0,[{type:'delete-card',id:'a'}])));
  assert.notEqual(run(p,'commit',patch('resurrect',0,[{type:'create-card',card}])).status,0);
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});await fs.rm(outside,{recursive:true,force:true});}
});
test('HTTP conflict preview leaves the full save atomic and a separate legal subset is rechecked',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-preview-'));let server;
 try{
  ok(run(p,'generate',{cards:[card,{...card,id:'b'}]}));
  server=http.createServer(createCanvasMiddleware({project:p}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/api/canvas/demo`;
  const post=(action,p)=>canvasRequest(url+'/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});
  ok(run(p,'commit',patch('other-client',0,[{type:'edit-card',id:'a',text:'remote'}])));
  const full=patch('full',0,[{type:'edit-card',id:'a',text:'local'},{type:'edit-card',id:'b',text:'independent'}]);
  const response=await post('commit',full);assert.equal(response.status,409);
  assert.equal(ok(run(p,'state')).canvas.nodes[1].text,'original');
  const preview=await (await post('preview',full)).json();assert.equal(preview.conflicts[0].field,'text');assert.equal(preview.conflicts[0].base,'original');assert.equal(preview.conflicts[0].current,'remote');assert.equal(preview.conflicts[0].proposed,'local');assert.deepEqual(preview.legalOperations,[full.operations[1]]);
  assert.equal((await (await canvasRequest(url+'/head')).json()).revision,1);
  const subset=patch('subset',0,preview.legalOperations);assert.equal((await post('commit',subset)).status,200);
  assert.equal(ok(run(p,'state')).canvas.nodes[0].text,'remote');assert.equal(ok(run(p,'state')).canvas.nodes[1].text,'independent');
  assert.notEqual(run(p,'commit',patch('stale-delete',0,[{type:'delete-card',id:'a'}])).status,0);
  ok(run(p,'commit',patch('race',2,[{type:'edit-card',id:'b',text:'new competitor'}])));
  assert.equal((await post('commit',patch('subset-raced',0,preview.legalOperations))).status,409);
 }finally{if(server)await new Promise(r=>server.close(r));run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
