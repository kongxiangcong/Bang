import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const cli=new URL('../runtime/canvas/bang.mjs',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1');
const cards=['a','b','c'].map((id,i)=>({id,text:id,x:i*400,y:0,width:240,height:160}));
function run(p,c,input){return spawnSync(process.execPath,[cli,c,'--project',p,'--topic','demo'],{input:input&&JSON.stringify(input),encoding:'utf8'});}
function patch(operationId,baseRevision,operations){return {operationId,topic:'demo',baseRevision,author:{kind:'manual',id:'client'},readDependencies:[],intent:'explicit-save',operations};}
function ok(result){assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);}
test('relations create, reconnect, reverse and rename persist exact Canvas and semantic endpoints',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-relations-'));
 try{
  ok(run(p,'generate',{cards}));
  ok(run(p,'commit',patch('create',0,[{type:'create-relation',edge:{id:'r',fromNode:'a',toNode:'b'}}])));
  let state=ok(run(p,'state'));assert.deepEqual(state.relations,[{id:'r',fromNode:'a',toNode:'b',label:'',classification:'related',direction:'forward'}]);
  ok(run(p,'commit',patch('reconnect',1,[{type:'edit-relation',id:'r',toNode:'c',label:'自定义 原文'}])));
  ok(run(p,'commit',patch('reverse',2,[{type:'edit-relation',id:'r',fromNode:'c',toNode:'a',fromEnd:'arrow',toEnd:'arrow'}])));
  ok(run(p,'stop'));state=ok(run(p,'state'));
  assert.equal(state.canvas.edges[0].fromNode,'c');assert.equal(state.canvas.edges[0].toNode,'a');
  assert.deepEqual(state.relations,[{id:'r',fromNode:'c',toNode:'a',label:'自定义 原文',classification:'unclassified',direction:'bidirectional'}]);
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
test('card deletion cascades relations atomically and durable deletion intent rejects stale recreation',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-relation-delete-'));
 try{
  ok(run(p,'generate',{cards,edges:[{id:'r',fromNode:'a',toNode:'b',label:'支持'}]}));
  ok(run(p,'commit',patch('delete-edge',0,[{type:'delete-relation',id:'r'}])));
  ok(run(p,'stop'));
  assert.notEqual(run(p,'commit',patch('stale-recreate',0,[{type:'create-relation',edge:{id:'different-id',fromNode:'a',toNode:'b',label:'支持'}}])).status,0);
  ok(run(p,'commit',patch('explicit-new',1,[{type:'create-relation',edge:{id:'new',fromNode:'a',toNode:'b'}}])));
  const failed=run(p,'commit',patch('atomic-delete',2,[{type:'delete-card',id:'a'},{type:'edit-card',id:'missing',text:'fail'}]));assert.notEqual(failed.status,0);
  assert.equal(ok(run(p,'state')).canvas.edges.length,1);
  ok(run(p,'commit',patch('delete-card',2,[{type:'delete-card',id:'a'}])));
  const state=ok(run(p,'state'));assert.equal(state.canvas.edges.length,0);assert.equal(state.relations.length,0);assert.deepEqual(state.deletionIntents.map(d=>d.id),['r','new','a']);
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
