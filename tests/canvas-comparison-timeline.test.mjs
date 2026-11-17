import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCanvas} from '../runtime/canvas/contract.ts';
import {createServer} from 'node:http';
import {fixture} from './completed-turns.test.mjs';
import {runtimeOperation} from '../runtime/native/runtime.mjs';
const dimensions=['成本','延迟'];
const comparison=(option,dimension)=>({version:1,kind:'comparison',rootId:'a-cost',dimensions,option,dimension});
const cards=[{id:'a-cost',text:'A: 10 元，仅限本地',structure:comparison('A','成本')},{id:'b-cost',text:'B: 成本未知',structure:comparison('B','成本')},{id:'a-latency',text:'A: 5 ms，实验条件 X',structure:comparison('A','延迟')}];
test('comparison arranges explicit options by evaluation dimension without completing unknown cells or choosing winners',()=>{
 const input={cards,edges:[{id:'source-link',fromNode:'a-cost',toNode:'a-latency',label:'条件不同'}],bounds:{x:0,y:0,width:4000,height:3000}},raw=JSON.stringify(input),out=compileCanvas(input);
 assert.equal(out.nodes.length,3);assert.equal(out.nodes[0].y,out.nodes[1].y);assert.equal(out.nodes[0].x,out.nodes[2].x);assert.ok(out.nodes[1].x>out.nodes[0].x);assert.ok(out.nodes[2].y>out.nodes[0].y);
 assert.deepEqual(out.nodes.map(n=>n.text),cards.map(n=>n.text));assert.deepEqual(out.edges,input.edges);assert.equal(JSON.stringify(input),raw);assert.deepEqual(compileCanvas(input),out);
});
test('model rules and explicit comparison/timeline intent publish with sources and conditions, manual choice survives and reopens',async()=>{
 let received,attempt=0;
 const model=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;received=JSON.parse(raw);if(attempt++){res.end(JSON.stringify({version:1,changes:[{type:'supplement-card',id:'a-cost',structure:comparison('A','成本'),conditions:[],uncertainty:'',sources:[received.completedTurns[0].id]}]}));return;}res.end(JSON.stringify({version:1,changes:[...cards,{id:'event',text:'未知事件，不得从发言日期推断',structure:{version:1,kind:'timeline',rootId:'event',eventTime:null}}].map(c=>({type:'create-card',...c,conditions:['仅限测试条件'],uncertainty:'缺少 B 延迟',sources:[received.completedTurns[0].id]}))}));});
 await new Promise(r=>model.listen(0,'127.0.0.1',r));process.env.BANG_ORGANIZER_ENDPOINT=`http://127.0.0.1:${model.address().port}`;const f=await fixture();delete process.env.BANG_ORGANIZER_ENDPOINT;
 try{await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));let status;for(let i=0;i<100;i++){status=await f.call('organizer-status',{topicId:f.bound.topic.id});if(status.tasks.length&&status.tasks[0].status!=='running')break;await new Promise(r=>setTimeout(r,50));}
 assert.equal(status.tasks[0].status,'committed');assert.ok(received.structureRules.examples.some(e=>e.choice==='comparison'));assert.ok(received.structureRules.examples.some(e=>e.choice==='timeline'));
 const state=await runtimeOperation(f.project,'state',f.bound.topic.id);assert.equal(state.canvas.nodes.length,4);assert.equal(state.canvas.nodes[3].structure.eventTime,null);assert.deepEqual(state.metadata['a-cost'].knowledge.conditions,['仅限测试条件']);assert.ok(JSON.stringify(state.metadata['a-cost']).includes(received.completedTurns[0].id));
 const patch={operationId:crypto.randomUUID(),topic:f.bound.topic.id,baseRevision:state.revision,author:{kind:'manual',id:'user'},intent:'explicit-save',readDependencies:[],operations:state.canvas.nodes.slice(0,3).map(n=>({type:'edit-card',id:n.id,structure:{version:1,kind:'timeline',rootId:'a-cost',eventTime:null}}))};await runtimeOperation(f.project,'commit',f.bound.topic.id,patch);
 const saved=await runtimeOperation(f.project,'state',f.bound.topic.id);assert.deepEqual(saved.metadata['a-cost'].knowledge.conditions,state.metadata['a-cost'].knowledge.conditions);assert.deepEqual(saved.metadata['a-cost'].source,state.metadata['a-cost'].source);
 await f.call('turn-ingest',f.signed([f.turn('next','c2')],'c1'));let failed;for(let i=0;i<100;i++){failed=await f.call('organizer-status',{topicId:f.bound.topic.id});if(failed.tasks.some(t=>t.status==='failed'))break;await new Promise(r=>setTimeout(r,50));}assert.ok(failed.tasks.some(t=>t.status==='failed'));assert.deepEqual((await runtimeOperation(f.project,'state',f.bound.topic.id)).canvas,saved.canvas);
 await f.call('stop');const reopened=await runtimeOperation(f.project,'state',f.bound.topic.id);assert.deepEqual(reopened.canvas,saved.canvas);
 }finally{await f.close();model.closeAllConnections();await new Promise(r=>model.close(r));}
});
const timeline=(eventTime)=>({version:1,kind:'timeline',rootId:'later',eventTime});
test('timeline orders explicit event dates, keeps unknown dates separate and retains committed order on local additions',()=>{
 const input={cards:[{id:'later',text:'发布',structure:timeline('2025-06-01')},{id:'unknown',text:'讨论于 2024-01-01，事件时间未知',structure:timeline(null)},{id:'earlier',text:'测试',structure:timeline('2025-01-01')}],bounds:{x:0,y:0,width:4000,height:3000}},out=compileCanvas(input);
 assert.ok(out.nodes[2].x<out.nodes[0].x);assert.ok(out.nodes[1].y>out.nodes[0].y);assert.equal(out.nodes[1].structure.eventTime,null);assert.deepEqual(out.nodes.map(n=>n.id),['later','unknown','earlier']);
 const next=compileCanvas({cards:[{id:'new',text:'新增事件',structure:timeline('2025-03-01')}],previous:out,bounds:input.bounds});assert.deepEqual(next.nodes.slice(0,3),out.nodes);assert.equal(next.nodes[3].structure.eventTime,'2025-03-01');assert.deepEqual(compileCanvas(input),out);
 assert.throws(()=>compileCanvas({cards:[{id:'later',text:'invalid calendar',structure:timeline('2025-02-30')}]}),/event time/i);
});
test('comparison additions retain fixed positions, stacking, original content and unassigned cells',()=>{
 const previous=compileCanvas({cards:[...cards.map((n,i)=>({...n,zIndex:9-i})),{id:'unassigned',text:'原始条件与未知评价',structure:comparison(null,null),fixed:true,x:2700,y:1900}],bounds:{x:0,y:0,width:4000,height:3000}});
 const next=compileCanvas({cards:[{id:'b-latency',text:'B 延迟仍未测；仅讨论假设',structure:comparison('B','延迟')}],previous,bounds:{x:0,y:0,width:4000,height:3000}});
 assert.deepEqual(next.nodes.slice(0,4),previous.nodes);assert.equal(next.nodes[4].x,previous.nodes[1].x);assert.equal(next.nodes[4].y,previous.nodes[2].y);
 const moved=compileCanvas({cards:next.nodes,previous:next,relayoutIds:next.nodes.map(n=>n.id),bounds:{x:0,y:0,width:4000,height:3000}});assert.deepEqual(moved.nodes.find(n=>n.id==='unassigned'),previous.nodes[3]);
 assert.throws(()=>compileCanvas({cards:[{...cards[0],structure:{...cards[0].structure,winner:'A'}}]}),/comparison/i);
});

