import {canvasRequest} from './canvas-request.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const cli=new URL('../runtime/canvas/bang.mjs',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1');
const card={id:'manual',text:'人工 **知识**',x:0,y:0,width:320,height:180};
const patch={operationId:'save-1',topic:'demo',baseRevision:0,author:{kind:'manual',id:'local-user'},readDependencies:[],intent:'explicit-save',operations:[{type:'create-card',card}]};
function run(p,c,input){return spawnSync(process.execPath,[cli,c,'--project',p,'--topic','demo'],{input:JSON.stringify(input),encoding:'utf8'});}
test('explicit save returns an idempotent receipt and reopens manual knowledge at the committed revision',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-save-'));
 try{assert.equal(run(p,'generate',{cards:[]}).status,0);const saved=run(p,'commit',patch);assert.equal(saved.status,0,saved.stderr);assert.equal(JSON.parse(saved.stdout).revision,1);assert.deepEqual(JSON.parse(run(p,'commit',patch).stdout),JSON.parse(saved.stdout));const state=JSON.parse(run(p,'state').stdout);assert.equal(state.revision,1);assert.equal(state.canvas.nodes[0].text,card.text);assert.deepEqual(state.metadata.manual.source,{kind:'manual',authorId:'local-user',operationId:'save-1'});}
 finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
test('edit/delete and whole-patch validation preserve committed state on conflicts',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-atomic-'));
 try{run(p,'generate',{cards:[card]});const make=(id,base,operations)=>({...patch,operationId:id,baseRevision:base,operations});
 assert.equal(run(p,'commit',make('edit',0,[{type:'edit-card',id:'manual',text:'edited'}])).status,0);
 assert.notEqual(run(p,'commit',make('invalid',1,[{type:'edit-card',id:'manual',text:'must not appear'},{type:'delete-card',id:'missing'}])).status,0);
 assert.notEqual(run(p,'commit',make('stale',0,[{type:'delete-card',id:'manual'}])).status,0);
 assert.equal(JSON.parse(run(p,'state').stdout).canvas.nodes[0].text,'edited');
 assert.equal(run(p,'commit',make('delete',1,[{type:'delete-card',id:'manual'}])).status,0);
 assert.equal(JSON.parse(run(p,'state').stdout).revision,2);assert.deepEqual(JSON.parse(run(p,'read').stdout).nodes,[]);
 assert.notEqual(run(p,'commit',make('delete',1,[{type:'create-card',card}])).status,0);
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
test('HTTP explicit patch publishes the same revision exposed by public state',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-save-http-'));let server;
 try{run(p,'generate',{cards:[]});const http=await import('node:http');const {createCanvasMiddleware}=await import('../runtime/canvas/http.mjs');server=http.createServer(createCanvasMiddleware({project:p}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/api/canvas/demo`;
 const response=await canvasRequest(url+'/commit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)});assert.equal(response.status,200);assert.equal((await response.json()).revision,1);assert.equal((await (await canvasRequest(url+'/state')).json()).canvas.nodes[0].text,card.text);
 }finally{if(server)await new Promise(r=>server.close(r));run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});


