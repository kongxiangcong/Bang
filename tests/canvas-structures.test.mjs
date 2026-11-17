import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCanvas} from '../runtime/canvas/contract.ts';
const structure={version:1,kind:'radial',rootId:'root'};
const cards=['root','a','b','c','d'].map(id=>({id,text:id,structure}));
const edges=['a','b','c','d'].map(id=>({id:'r-'+id,fromNode:'root',toNode:id,kind:'classification'}));
test('explicit radial intent makes a true ring around a knowledge root and preserves all cross relations',()=>{
 const input={cards,edges:[...edges,{id:'cross',fromNode:'a',toNode:'b',label:'related'},{id:'cycle',fromNode:'b',toNode:'root',label:'feedback'}],bounds:{x:0,y:0,width:3000,height:3000}};
 const snapshot=JSON.stringify(input),out=compileCanvas(input),root=out.nodes[0],children=out.nodes.slice(1);
 assert.equal(root.structure.kind,'radial');
 const centers=children.map(n=>({x:n.x+n.width/2-root.x-root.width/2,y:n.y+n.height/2-root.y-root.height/2}));
 assert.ok(centers.some(p=>p.x>100)&&centers.some(p=>p.x < -100)&&centers.some(p=>p.y>100)&&centers.some(p=>p.y < -100));
 const radius=centers.map(p=>Math.hypot(p.x,p.y));assert.ok(Math.max(...radius)-Math.min(...radius)<2);
 assert.deepEqual(out.edges,input.edges);assert.deepEqual(compileCanvas(input),out);assert.equal(JSON.stringify(input),snapshot);
});
test('classification follows only explicit backbone edges and fixes are respected by every relayout',()=>{
 const tree=cards.map(c=>({...c,structure:{...structure,kind:'classification'}}));
 const out=compileCanvas({cards:tree,edges:[edges[0],{id:'deep',fromNode:'a',toNode:'b',kind:'classification'},{id:'cycle',fromNode:'b',toNode:'root',kind:'classification'},{id:'cross',fromNode:'b',toNode:'c',label:'contains'}],bounds:{x:0,y:0,width:3000,height:3000}});
 const n=id=>out.nodes.find(n=>n.id===id);
 assert.ok(n('root').x<n('a').x&&n('a').x<n('b').x);assert.equal(n('c').x,n('a').x);assert.equal(out.edges.length,4);
 const previous=compileCanvas({cards:[{id:'fixed',text:'locked',x:800,y:700,width:320,height:120,fixed:true,zIndex:4}]});
 assert.deepEqual(compileCanvas({cards:previous.nodes,previous,relayoutIds:['fixed']}).nodes,previous.nodes);
});

test('incremental radial additions retain committed geometry, stacking and unrelated layout; cramped placement reports warnings',()=>{
 const previous=compileCanvas({cards:[...cards,{id:'outside',text:'unrelated',x:4000,y:500,width:320,height:120,zIndex:7}],edges,bounds:{x:0,y:0,width:3000,height:3000}});
 const next=compileCanvas({cards:[{id:'new',text:'new child',structure}],previous,edges:[...edges,{id:'r-new',fromNode:'root',toNode:'new',kind:'classification'}],bounds:{x:0,y:0,width:3000,height:3000}});
 assert.deepEqual(next.nodes.slice(0,6),previous.nodes);assert.ok(Number.isSafeInteger(next.nodes[6].x));
 const cramped=compileCanvas({cards:[{id:'new',text:'new child',structure}],previous,edges:next.edges,bounds:{x:0,y:0,width:100,height:100}});
 assert.deepEqual(cramped.nodes.slice(0,6),previous.nodes);assert.equal(cramped.layoutWarnings[0].id,'new');
});
import {createServer} from 'node:http';
import {fixture} from './completed-turns.test.mjs';
import {runtimeOperation} from '../runtime/native/runtime.mjs';
test('versioned model structure intent compiles, publishes and reopens without a browser',async()=>{
 let received;
 const model=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;received=JSON.parse(raw);const source=received.completedTurns[0].id;res.end(JSON.stringify({version:1,changes:[...cards.map(c=>({type:'create-card',...c,conditions:[],uncertainty:'controlled fixture',sources:[source]})),...edges.map(e=>({type:'create-relation',...e,label:'classifies',conditions:[],uncertainty:'controlled fixture',sources:[source]}))]}));});
 await new Promise(r=>model.listen(0,'127.0.0.1',r));process.env.BANG_ORGANIZER_ENDPOINT=`http://127.0.0.1:${model.address().port}`;
 const f=await fixture();delete process.env.BANG_ORGANIZER_ENDPOINT;
 try{await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));let status;for(let i=0;i<100;i++){status=await f.call('organizer-status',{topicId:f.bound.topic.id});if(status.tasks.length&&status.tasks[0].status!=='running')break;await new Promise(r=>setTimeout(r,50));}
 assert.equal(status.tasks[0].status,'committed');assert.equal(received.structureRules.version,1);assert.ok(received.structureRules.examples.length>=2);
 const before=await runtimeOperation(f.project,'state',f.bound.topic.id);assert.equal(before.canvas.nodes[0].structure.kind,'radial');assert.equal(before.relations[0].classification,'classification');assert.equal(before.canvas.nodes.length,5);
 await f.call('stop');const reopened=await runtimeOperation(f.project,'state',f.bound.topic.id);assert.deepEqual(reopened.canvas,before.canvas);
 }finally{await f.close();model.closeAllConnections();await new Promise(r=>model.close(r));}
});
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('explicit structure changes compare value baselines, preserve provenance, conflict atomically and reopen',async()=>{
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'bang-structure-save-')),topic='demo';
 const patch=(revision,operations)=>({operationId:crypto.randomUUID(),topic,baseRevision:revision,author:{kind:'manual',id:'user'},intent:'explicit-save',readDependencies:[],operations});
 try{await runtimeOperation(project,'generate',topic,{cards,edges});const before=await runtimeOperation(project,'state',topic);
 const operations=before.canvas.nodes.map(c=>({type:'edit-card',id:c.id,structure:{...structure,kind:'classification'}}));
 await runtimeOperation(project,'commit',topic,patch(0,operations));const after=await runtimeOperation(project,'state',topic);assert.deepEqual(after.metadata.root.source,before.metadata.root.source);
 await assert.rejects(runtimeOperation(project,'commit',topic,patch(0,[{type:'edit-card',id:'root',structure:null,text:'must remain atomic'}])),/conflict/i);
 await runtimeOperation(project,'stop');assert.deepEqual((await runtimeOperation(project,'state',topic)).canvas,after.canvas);
 }finally{await runtimeOperation(project,'stop');await fs.rm(project,{recursive:true,force:true});}
});
test('radial tree keeps descendants inside their parent branch sector',()=>{
 const ids=['root','a','b','a1','a2','b1','b2'];
 const out=compileCanvas({cards:ids.map(id=>({id,text:id,structure})),edges:[['root','a'],['root','b'],['a','a1'],['a','a2'],['b','b1'],['b','b2']].map(([fromNode,toNode],i)=>({id:'e'+i,fromNode,toNode,kind:'classification'})),bounds:{x:0,y:0,width:4000,height:4000}});
 const root=out.nodes[0],vector=id=>{const n=out.nodes.find(n=>n.id===id);return {x:n.x-root.x,y:n.y-root.y}};
 for(const [p,c] of [['a','a1'],['a','a2'],['b','b1'],['b','b2']]){const a=vector(p),b=vector(c);assert.ok(a.x*b.x+a.y*b.y>1000,`${c} must stay in ${p}'s half plane`);}
});
test('equivalent structure JSON key order does not create a stale-save conflict',async()=>{
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'bang-structure-order-')),topic='demo';
 const save=(revision,id,structure)=>runtimeOperation(project,'commit',topic,{operationId:id,topic,baseRevision:revision,author:{kind:'manual',id:'user'},intent:'explicit-save',readDependencies:[],operations:[{type:'edit-card',id:'root',structure}]});
 try{await runtimeOperation(project,'generate',topic,{cards,edges});await save(0,'reorder',{rootId:'root',kind:'radial',version:1});await save(0,'compatible',{kind:'classification',version:1,rootId:'root'});assert.equal((await runtimeOperation(project,'state',topic)).revision,2);
 }finally{await runtimeOperation(project,'stop');await fs.rm(project,{recursive:true,force:true});}
});
test('removing a structure root does not block subsequent unrelated knowledge additions',()=>{
 const previous=compileCanvas({cards,edges}),remaining={nodes:previous.nodes.filter(n=>n.id!=='root'),edges:[]};
 const next=compileCanvas({cards:[{id:'unrelated-new',text:'new knowledge'}],previous:remaining});
 assert.deepEqual(next.nodes.slice(0,4),remaining.nodes);assert.equal(next.nodes.length,5);assert.equal(next.layoutWarnings[0].code,'STRUCTURE_ROOT_MISSING');
});
