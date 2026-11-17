import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCanvas} from '../runtime/canvas/contract.ts';
const structure=kind=>({version:1,kind,rootId:'claim'});
const cards=kind=>['claim','e1','e2','step'].map(id=>({id,text:id,structure:structure(kind)}));
const edges=[{id:'s1',fromNode:'e1',toNode:'claim',kind:'support',label:'仅在条件 X 下'},{id:'s2',fromNode:'e2',toNode:'claim',kind:'refute'},{id:'q',fromNode:'step',toNode:'e1',kind:'qualify'},{id:'multi',fromNode:'step',toNode:'e2',kind:'support'},{id:'cross',fromNode:'e1',toNode:'e2',label:'自定义未知关系'}];
test('argument uses directed evidence layers without collapsing multiple parents or custom labels',()=>{
 const input={cards:cards('argument'),edges,bounds:{x:0,y:0,width:4000,height:3000}},out=compileCanvas(input),n=id=>out.nodes.find(n=>n.id===id);
 assert.ok(n('step').x<n('e1').x&&n('e1').x<n('claim').x);assert.equal(n('e1').x,n('e2').x);assert.deepEqual(out.edges,edges);assert.deepEqual(out.nodes.map(n=>n.text),['claim','e1','e2','step']);assert.deepEqual(compileCanvas(input),out);
});
test('flow lays out branches downward and keeps feedback cycles and cross-region dependencies',()=>{
 const flowEdges=[{id:'p',fromNode:'claim',toNode:'e1',kind:'precedence'},{id:'b',fromNode:'claim',toNode:'e2',kind:'branch',label:'失败时'},{id:'d',fromNode:'e1',toNode:'step',kind:'dependency'},{id:'loop',fromNode:'step',toNode:'claim',kind:'precedence',label:'反馈重试'}];
 const input={cards:cards('flow').map((c,i)=>({...c,regionId:i%2?'one':'two'})),edges:flowEdges,bounds:{x:0,y:0,width:4000,height:3000}},out=compileCanvas(input),n=id=>out.nodes.find(n=>n.id===id);
 assert.ok(n('claim').y<n('e1').y&&n('e1').y<n('step').y);assert.equal(n('e1').y,n('e2').y);assert.notEqual(n('e1').x,n('e2').x);assert.deepEqual(out.edges,flowEdges);assert.deepEqual(compileCanvas(input),out);
});
import {resultSchema} from '../runtime/codex/result-schema.mjs';
import {createServer} from 'node:http';
import {fixture} from './completed-turns.test.mjs';
import {runtimeOperation} from '../runtime/native/runtime.mjs';
function matches(v,s){if(s.anyOf)return s.anyOf.some(x=>matches(v,x));if(s.const!==undefined&&v!==s.const)return false;if(s.enum&&!s.enum.includes(v))return false;const type=v===null?'null':Array.isArray(v)?'array':typeof v==='number'&&Number.isInteger(v)?'integer':typeof v;if(!(Array.isArray(s.type)?s.type:[s.type]).includes(type))return false;if(type==='object')return s.required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>s.properties[k]&&matches(v[k],s.properties[k]));if(type==='array')return v.every(x=>matches(x,s.items));return true;}
test('live executor grammar and model rules admit argument and flow while public saves preserve original evidence and reopen',async()=>{
 let received;
 const model=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;received=JSON.parse(raw);const provenance={conditions:['条件 X'],uncertainty:'尚未验证',sources:[received.completedTurns[0].id]};const output={version:1,changes:[...cards('argument').map(c=>({type:'create-card',...c,...provenance})),...edges.map(e=>({type:'create-relation',...e,label:e.label??'',...provenance})),{type:'create-card',id:'flow-root',text:'流程假设',structure:{version:1,kind:'flow',rootId:'flow-root'},...provenance}]};res.end(JSON.stringify(output));});
 const sample={version:1,changes:[{type:'create-card',id:'claim',text:'claim',structure:structure('argument'),conditions:[],uncertainty:'',sources:[]},{type:'create-relation',...edges[0],conditions:[],uncertainty:'',sources:[]}]};assert.ok(matches(sample,resultSchema),'provider output grammar must match the actual executor');for(const kind of ['argument','flow'])assert.ok(matches({...sample,changes:[{...sample.changes[0],structure:structure(kind)}]},resultSchema));for(const kind of ['support','refute','qualify','precedence','branch','dependency'])assert.ok(matches({...sample,changes:[{...sample.changes[1],kind}]},resultSchema));
 await new Promise(r=>model.listen(0,'127.0.0.1',r));process.env.BANG_ORGANIZER_ENDPOINT=`http://127.0.0.1:${model.address().port}`;const f=await fixture();delete process.env.BANG_ORGANIZER_ENDPOINT;
 try{await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));let status;for(let i=0;i<100;i++){status=await f.call('organizer-status',{topicId:f.bound.topic.id});if(status.tasks.length&&status.tasks[0].status!=='running')break;await new Promise(r=>setTimeout(r,50));}assert.equal(status.tasks[0].status,'committed');assert.ok(received.structureRules.examples.some(e=>e.choice==='argument'));assert.ok(received.structureRules.examples.some(e=>e.choice==='flow'));
 const before=await runtimeOperation(f.project,'state',f.bound.topic.id);assert.deepEqual(before.relations.map(r=>r.classification),['support','refute','qualify','support','unclassified']);assert.deepEqual(before.metadata.claim.knowledge.conditions,['条件 X']);assert.equal(before.metadata.claim.knowledge.uncertainty,'尚未验证');
 await runtimeOperation(f.project,'commit',f.bound.topic.id,{operationId:crypto.randomUUID(),topic:f.bound.topic.id,baseRevision:before.revision,author:{kind:'manual',id:'test'},intent:'explicit-save',readDependencies:[],operations:[{type:'edit-relation',id:'s1',kind:'qualify',label:'人工限定原文'}]});const after=await runtimeOperation(f.project,'state',f.bound.topic.id);assert.equal(after.relations[0].classification,'qualify');assert.equal(after.relations[0].label,'人工限定原文');assert.deepEqual(after.metadata.claim.knowledge,before.metadata.claim.knowledge);assert.notEqual(after.metadata.claim.basis?.status,'reviewed');
 await f.call('stop');assert.deepEqual((await runtimeOperation(f.project,'state',f.bound.topic.id)).canvas,after.canvas);
 }finally{await f.close();model.closeAllConnections();await new Promise(r=>model.close(r));}
});
test('argument and flow retain fixed and unrelated geometry, stacking and stable order with bounded no-space fallback',()=>{
 for(const kind of ['argument','flow']){const previous=compileCanvas({cards:[...cards(kind).map((c,i)=>({...c,zIndex:9-i})),{id:'outside',text:'untouched',x:4500,y:200,width:320,height:120,zIndex:30}],edges,bounds:{x:0,y:0,width:4000,height:3000}});const fixed={...previous,nodes:previous.nodes.map((n,i)=>i===0?{...n,fixed:true}:n)};const next=compileCanvas({cards:[{id:'new',text:'new unknown',structure:structure(kind)}],previous:fixed,bounds:{x:0,y:0,width:10,height:10}});assert.deepEqual(next.nodes.slice(0,5),fixed.nodes);assert.equal(next.layoutWarnings.find(w=>w.id==='new').code,'NO_LOCAL_SPACE');assert.deepEqual(next.edges,edges);const moved=compileCanvas({cards:next.nodes,previous:next,relayoutIds:next.nodes.map(n=>n.id),bounds:{x:0,y:0,width:4000,height:3000}});assert.deepEqual(moved.nodes[0],fixed.nodes[0]);assert.deepEqual(moved.nodes.map(n=>n.id),next.nodes.map(n=>n.id));
 for(const invalid of [{...structure(kind),verified:true},{...structure(kind),rootId:''}])assert.throws(()=>compileCanvas({cards:[{...fixed.nodes[0],structure:invalid}],previous:fixed}),/structure/i);
 assert.throws(()=>compileCanvas({cards:[],previous:fixed,edges:[{...edges[0],kind:'verified'}]}),/relation kind/i);
 }
});
