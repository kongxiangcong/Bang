import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const cli=new URL('../runtime/canvas/bang.mjs',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1');
const card={id:'a',text:'original knowledge',x:10,y:20,width:320,height:180};
function run(p,c,input){const r=spawnSync(process.execPath,[cli,c,'--project',p,'--topic','demo'],{input:input&&JSON.stringify(input),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout?JSON.parse(r.stdout):null;}
const patch=(id,baseRevision,operations)=>({operationId:id,topic:'demo',baseRevision,author:{kind:'manual',id:'layout-user'},readDependencies:[],intent:'explicit-save',operations});
test('manual layout survives reopen without inventing relations or replacing knowledge provenance',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-layout-'));
 try{
  run(p,'generate',{cards:[card,{...card,id:'b',x:500}]});
  const initial=run(p,'state');
  run(p,'commit',patch('layout',0,[{type:'edit-card',id:'a',x:70,y:90,width:400,height:240,regionId:'group-1',fixed:true,zIndex:3},{type:'edit-card',id:'b',regionId:'group-1',zIndex:1}]));
  run(p,'stop');const result=run(p,'state');const node=result.canvas.nodes.find(n=>n.id==='a');
  assert.deepEqual(result.canvas.nodes.map(n=>n.id),['b','a']);assert.equal(node.width,400);assert.equal(node.height,240);assert.equal(node.regionId,'group-1');assert.equal(node.fixed,true);assert.equal(node.zIndex,3);assert.deepEqual(result.canvas.edges,[]);
  assert.deepEqual(result.metadata.a.source,initial.metadata.a.source);assert.equal(result.metadata.a.fields.width.modifiedRevision,1);
  run(p,'commit',patch('compatible-text',0,[{type:'edit-card',id:'a',text:'new compatible evidence'}]));
  assert.equal(run(p,'state').canvas.nodes.find(n=>n.id==='a').x,70);
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});

import {compileCanvas} from '../runtime/canvas/contract.ts';
test('compiler places additions deterministically, preserves old layout and warns without silently moving fixed cards',()=>{
 const previous=compileCanvas({cards:[{...card,fixed:true,zIndex:5,regionId:'analysis'}]});
 const input={previous,cards:[{...card,x:999,y:999},{id:'new',text:'second card'}],bounds:{x:0,y:0,width:400,height:250}};
 const snapshot=JSON.stringify(input);const a=compileCanvas(input),b=compileCanvas(input);
 assert.deepEqual(a,b);assert.equal(JSON.stringify(input),snapshot);
 assert.deepEqual(a.nodes[0],previous.nodes[0]);assert.equal(a.nodes[1].width,320);assert.equal(a.nodes[1].height,120);
 assert.equal(a.layoutWarnings[0].code,'NO_LOCAL_SPACE');assert.equal(a.layoutWarnings[0].id,'new');
 const selected=compileCanvas({...input,relayoutIds:['a'],bounds:{x:0,y:0,width:1500,height:1000}});
 assert.equal(selected.nodes[0].x,10);assert.equal(selected.nodes[0].fixed,true);
 assert.equal(selected.nodes[0].zIndex,5);
});

test('compiler preserves prior stacking and unseen cards when input order or active context changes',()=>{
 const previous=compileCanvas({cards:[card,{...card,id:'b',x:500},{...card,id:'c',x:1000}]});
 const next=compileCanvas({previous,cards:[{id:'b',text:'updated'},{id:'a',text:'original knowledge'}]});
 assert.deepEqual(next.nodes.map(n=>n.id),['a','b','c']);assert.equal(next.nodes[1].text,'updated');assert.deepEqual(next.nodes[2],previous.nodes[2]);
});

test('layout fields merge independently while competing size edits remain atomic conflicts',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-layout-conflict-'));
 try{
  run(p,'generate',{cards:[card]});
  run(p,'commit',patch('size',0,[{type:'edit-card',id:'a',width:410}]));
  run(p,'commit',patch('group',0,[{type:'edit-card',id:'a',regionId:'region-2',fixed:true}]));
  const proposed=patch('stale-size',0,[{type:'edit-card',id:'a',width:500,x:700}]);
  const preview=run(p,'preview',proposed);assert.equal(preview.conflicts[0].field,'width');assert.equal(preview.legalOperations.length,0);
  const r=spawnSync(process.execPath,[cli,'commit','--project',p,'--topic','demo'],{input:JSON.stringify(proposed),encoding:'utf8'});assert.notEqual(r.status,0);
  const state=run(p,'state');assert.equal(state.revision,2);assert.equal(state.canvas.nodes[0].x,10);assert.equal(state.canvas.nodes[0].width,410);assert.equal(state.canvas.nodes[0].regionId,'region-2');
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
