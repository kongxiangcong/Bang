import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const cli=new URL('../runtime/canvas/bang.mjs',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1');
function run(p,c,input){return spawnSync(process.execPath,[cli,c,'--project',p,'--topic','demo'],{input:input&&JSON.stringify(input),encoding:'utf8'});}
function ok(r){assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
const patch=(operationId,baseRevision,operations)=>({operationId,topic:'demo',baseRevision,author:{kind:'manual',id:'user'},readDependencies:[],intent:'explicit-save',operations});
test('free annotation and precise route survive explicit save and Runtime reopen without semantic content',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-annotations-'));
 try {ok(run(p,'generate',{cards:[]}));
 const element={id:'drawing',type:'line',x:12.25,y:33.75,angle:0.314159,points:[[0,0],[73.125,-19.75],[121.5,44.25]]};
 ok(run(p,'commit',patch('draw',0,[{type:'create-extra',extra:{id:'drawing',element}}])));
 ok(run(p,'stop'));const state=ok(run(p,'state'));
 assert.deepEqual(state.editorExtras,[{id:'drawing',element}]);assert.deepEqual(state.canvas.nodes,[]);assert.deepEqual(state.relations,[]);
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
test('native copy provenance survives independent edits and annotation conflicts reject the whole save',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-extra-conflict-'));
 try{ok(run(p,'generate',{cards:[{id:'a',text:'original',x:0,y:0,width:200,height:100}]}));
 ok(run(p,'commit',patch('copy',0,[{type:'create-card',card:{id:'copy',derivedFrom:'a',text:'copy',x:300,y:0,width:200,height:100}},{type:'create-extra',extra:{id:'shape',element:{id:'shape',type:'ellipse',angle:0.2}}}])));
 assert.equal(ok(run(p,'state')).metadata.copy.derivedFrom,'a');
 ok(run(p,'commit',patch('remote',1,[{type:'edit-extra',id:'shape',element:{id:'shape',type:'ellipse',angle:0.7}}])));
 assert.notEqual(run(p,'commit',patch('stale',1,[{type:'edit-extra',id:'shape',element:{id:'shape',type:'ellipse',angle:0.4}},{type:'edit-card',id:'a',text:'must not publish'}])).status,0);
 ok(run(p,'commit',patch('independent',1,[{type:'edit-card',id:'copy',text:'independent copy'}])));
 const state=ok(run(p,'state'));assert.equal(state.canvas.nodes[0].text,'original');assert.equal(state.canvas.nodes[1].text,'independent copy');assert.equal(state.metadata.copy.derivedFrom,'a');assert.equal(state.editorExtras[0].element.angle,0.7);
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
import http from 'node:http';
import {createCanvasMiddleware} from '../runtime/canvas/http.mjs';
import {canvasRequest} from './canvas-request.mjs';
test('HTTP annotation rejects unsafe links and nonfinite geometry atomically',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-extra-safe-'));let server;
 try{ok(run(p,'generate',{cards:[]}));server=http.createServer(createCanvasMiddleware({project:p}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/api/canvas/demo`;
 for(const [i,element] of [{id:'bad',type:'rectangle',link:'javascript:alert(1)'},{id:'bad',type:'rectangle',x:'invalid'},{id:'bad',type:'iframe',link:'https://example.com/'},{id:'bad',type:'line',points:[[0,0],['bad',1]]}].entries()){
 const r=await canvasRequest(url+'/commit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch('unsafe'+i,0,[{type:'create-extra',extra:{id:'good',element:{id:'good',type:'ellipse',angle:0.1}}},{type:'create-extra',extra:{id:'bad',element}}]))});assert.equal(r.status,400);assert.equal(ok(run(p,'state')).revision,0);}
 }finally{if(server)await new Promise(r=>server.close(r));run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
test('annotation connector becomes semantic only after both endpoints are explicitly converted',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-conversion-'));
 try{ok(run(p,'generate',{cards:[]}));const shape=id=>({id,element:{id,type:'rectangle',x:0,y:0,width:100,height:100,angle:0}});
 ok(run(p,'commit',patch('draw',0,[{type:'create-extra',extra:shape('one')},{type:'create-extra',extra:shape('two')},{type:'create-extra',extra:{id:'line',element:{id:'line',type:'arrow',points:[[0,0],[150,0]],startBinding:{elementId:'one'},endBinding:{elementId:'two'}}}}])));
 const card=id=>({id,text:id,x:0,y:0,width:100,height:100});
 ok(run(p,'commit',patch('convert-first',1,[{type:'create-card',card:card('one')}])));assert.deepEqual(ok(run(p,'state')).relations,[]);
 assert.notEqual(run(p,'commit',patch('premature-edge',2,[{type:'create-relation',edge:{id:'line',fromNode:'one',toNode:'two'}}])).status,0);
 ok(run(p,'commit',patch('convert-second',2,[{type:'create-card',card:card('two')},{type:'create-relation',edge:{id:'line',fromNode:'one',toNode:'two'}}])));
 const state=ok(run(p,'state'));assert.equal(state.relations.length,1);assert.equal(state.relations[0].fromNode,'one');assert.equal(state.relations[0].toNode,'two');assert.equal(state.editorExtras.length,3);
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
