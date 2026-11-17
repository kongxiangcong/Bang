import {canvasRequest} from './canvas-request.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {compileCanvas} from '../runtime/canvas/contract.ts';
const cli=new URL('../runtime/canvas/bang.mjs',import.meta.url);
const cards=[{id:'后层',text:'原文 **Markdown**\n中文',x:-20,y:10,width:300,height:180},{id:'front',text:'前层',x:80,y:40,width:200,height:100}];
function run(project,command,input){return spawnSync(process.execPath,[cli.pathname.replace(/^\/([A-Z]:)/,'$1'),command,'--project',project,'--topic','demo'],{input:JSON.stringify(input),encoding:'utf8'});}
test('headless generation preserves exact body, stable identity, geometry and array stacking through a fresh runtime read',async()=>{
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'bang-canvas-'));
 try {
  const generated=run(project,'generate',{cards});assert.equal(generated.status,0,generated.stderr);
  const expected={nodes:cards.map(c=>({id:c.id,type:'text',x:c.x,y:c.y,width:c.width,height:c.height,text:c.text})),edges:[]};
  assert.deepEqual(JSON.parse(generated.stdout),expected);
  assert.deepEqual(JSON.parse(run(project,'read').stdout),expected);
  const before=await fs.readFile(path.join(project,'.bang/topics/demo/current.canvas'),'utf8');
  assert.equal(run(project,'read').status,0);
  assert.equal(await fs.readFile(path.join(project,'.bang/topics/demo/current.canvas'),'utf8'),before);
 }finally{run(project,'stop');await fs.rm(project,{recursive:true,force:true});}
});
test('compiler is deterministic and pure, and rejects invalid standard geometry and duplicate identity',()=>{
 const input=Object.freeze({cards:Object.freeze(cards.map(c=>Object.freeze({...c})))});
 const first=compileCanvas(input);assert.deepEqual(first,compileCanvas(input));assert.deepEqual(input.cards,cards);
 for(const bad of [{...cards[0],x:1.5},{...cards[0],width:0},{...cards[0],y:Infinity}])assert.throws(()=>compileCanvas({cards:[bad]}));
 assert.throws(()=>compileCanvas({cards:[cards[0],cards[0]]}));
});
test('invalid generation creates no current file and generation cannot overwrite an existing topic',async()=>{
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'bang-invalid-'));
 try{
  assert.notEqual(run(project,'generate',{cards:[{...cards[0],x:0.5}]}).status,0);
  await assert.rejects(fs.access(path.join(project,'.bang/topics/demo/current.canvas')));
  assert.equal(run(project,'generate',{cards}).status,0);
  assert.notEqual(run(project,'generate',{cards:[]}).status,0);
  assert.equal(JSON.parse(run(project,'read').stdout).nodes.length,2);
 }finally{run(project,'stop');await fs.rm(project,{recursive:true,force:true});}
});
test('HTTP read exposes the generated standard Canvas without writes, and rejects mutations',async()=>{
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'bang-http-'));
 let server;
 try{
  assert.equal(run(project,'generate',{cards}).status,0);
  const {createCanvasMiddleware}=await import('../runtime/canvas/http.mjs');
  server=http.createServer(createCanvasMiddleware({project}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}/api/canvas/demo`;
  const file=path.join(project,'.bang/topics/demo/current.canvas'),before=await fs.stat(file);
  const response=await canvasRequest(url);assert.equal(response.status,200);assert.deepEqual(await response.json(),JSON.parse(run(project,'read').stdout));
  assert.equal((await canvasRequest(url,{method:'POST',body:'{}'})).status,405);
  assert.equal((await fs.stat(file)).mtimeMs,before.mtimeMs);
 }finally{if(server)await new Promise(r=>server.close(r));run(project,'stop');await fs.rm(project,{recursive:true,force:true});}
});


