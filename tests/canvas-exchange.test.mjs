import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const cli=new URL('../runtime/canvas/bang.mjs',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1');
const run=(p,c,input)=>spawnSync(process.execPath,[cli,c,'--project',p,'--topic','demo'],{input:input&&JSON.stringify(input),encoding:'utf8'});
const ok=r=>{assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
const fixture={nodes:[{id:'group',type:'group',x:-100,y:-100,width:900,height:700,label:'Visual only',color:'2',background:'assets/background.png',backgroundStyle:'contain'},{id:'text',type:'text',x:0,y:0,width:220,height:180,text:'# Exact\n\n**raw**',color:'#abcdef'},{id:'file',type:'file',x:300,y:0,width:200,height:200,file:'assets/missing.pdf',subpath:'#page=2'},{id:'link',type:'link',x:0,y:300,width:200,height:200,url:'https://example.com/'}],edges:[{id:'edge',fromNode:'text',toNode:'file',fromSide:'right',toSide:'left',fromEnd:'arrow',toEnd:'none',label:'custom unchanged',color:'6'},{id:'visual',fromNode:'group',toNode:'link'}]};
test('standard four node types and visual group roundtrip through explicit manual import and reopen',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-exchange-'));
 try{ok(run(p,'generate',{cards:[]}));const preview=ok(run(p,'import-preview',{canvas:fixture}));assert.equal(preview.baseRevision,0);assert.equal(preview.changes.added.length,6);
 ok(run(p,'import-canvas',{...preview,operationId:'import-one',author:{kind:'manual',id:'human'},intent:'explicit-import'}));ok(run(p,'stop'));
 const exported=ok(run(p,'export-canvas'));assert.deepEqual(exported.canvas,fixture);const state=ok(run(p,'state'));assert.equal(state.metadata.group.role,'visual-region');assert.equal(state.metadata.text.source.kind,'manual');assert.equal(state.relations.length,1);assert.equal(state.relations[0].classification,'unclassified');
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
import http from 'node:http';
import {createCanvasMiddleware} from '../runtime/canvas/http.mjs';
import {canvasRequest} from './canvas-request.mjs';
test('HTTP external-file adoption preserves original and rejects raced, unsafe, damaged and stale imports',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-external-'));let server;
 try{ok(run(p,'generate',{cards:[{id:'old',text:'committed'}]}));server=http.createServer(createCanvasMiddleware({project:p}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/api/canvas/demo`;
 const post=async(action,value)=>{const r=await canvasRequest(url+'/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});return {status:r.status,value:await r.json()};};
 const file=path.join(p,'.bang/topics/demo/current.canvas'),original=JSON.stringify(fixture);await fs.writeFile(file,original);
 assert.notEqual(run(p,'state').status,0);const preview=await post('import-preview',{external:true});assert.equal(preview.status,200);assert.ok(preview.value.changes.removed.includes('old'));
 const request={...preview.value,operationId:'external',author:{kind:'manual',id:'human'},intent:'explicit-import'};
 await fs.appendFile(file,' ');assert.equal((await post('import-canvas',request)).status,409);assert.equal(await fs.readFile(file,'utf8'),original+' ');
 await fs.writeFile(file,original);const adopted=await post('import-canvas',request);assert.equal(adopted.status,200,JSON.stringify(adopted));assert.equal(await fs.readFile(path.join(p,adopted.value.preservedFile),'utf8'),original);
 assert.deepEqual((await (await canvasRequest(url+'/export-canvas')).json()).canvas,fixture);assert.deepEqual((await post('import-canvas',request)).value,adopted.value);
 await fs.writeFile(file,'{damaged');assert.equal((await post('import-preview',{external:true})).status,400);assert.equal(await fs.readFile(file,'utf8'),'{damaged');
 }finally{if(server)await new Promise(r=>server.close(r));run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
test('single Canvas export reports lost editor extras and retains standard-only fields after ordinary save',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-degradation-'));
 try{ok(run(p,'generate',{cards:[]}));const preview=ok(run(p,'import-preview',{canvas:fixture}));ok(run(p,'import-canvas',{...preview,operationId:'import',author:{kind:'manual',id:'human'},intent:'explicit-import'}));
 ok(run(p,'commit',{operationId:'edit',topic:'demo',baseRevision:1,author:{kind:'manual',id:'human'},readDependencies:[],intent:'explicit-save',operations:[{type:'edit-card',id:'text',text:'new raw'},{type:'create-extra',extra:{id:'free',element:{id:'free',type:'line',angle:0.3,points:[[0,0],[5.5,7],[8,9]]}}}]}));
 const result=ok(run(p,'export-canvas'));assert.equal(result.degradation[0].id,'free');assert.equal(result.canvas.nodes[0].backgroundStyle,'contain');assert.equal(result.canvas.nodes[2].subpath,'#page=2');assert.equal(result.canvas.nodes[1].text,'new raw');assert.equal(result.canvas.editorExtras,undefined);assert.equal(ok(run(p,'state')).relations.length,1);
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
test('unsafe resources and stale baseline imports leave the committed board and original external bytes unchanged',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-exchange-safe-'));
 try{ok(run(p,'generate',{cards:[]}));const preview=ok(run(p,'import-preview',{canvas:fixture}));
 for(const node of [{id:'bad',type:'link',url:'javascript:alert(1)'},{id:'bad',type:'file',file:'../secret'},{id:'bad',type:'group',background:'../secret'}]){const canvas={nodes:[{...node,x:0,y:0,width:100,height:100}],edges:[]};assert.notEqual(run(p,'import-preview',{canvas}).status,0);assert.equal(ok(run(p,'state')).revision,0);}
 ok(run(p,'commit',{operationId:'advance',topic:'demo',baseRevision:0,author:{kind:'manual',id:'human'},readDependencies:[],intent:'explicit-save',operations:[{type:'create-card',card:{id:'new',text:'keep new head',x:0,y:0,width:100,height:100}}]}));
 assert.notEqual(run(p,'import-canvas',{...preview,operationId:'stale',author:{kind:'manual',id:'human'},intent:'explicit-import'}).status,0);assert.equal(ok(run(p,'state')).canvas.nodes[0].text,'keep new head');
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
