import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fixture} from './completed-turns.test.mjs';
import {runtimeOperation} from '../runtime/native/runtime.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function settled(f){for(let i=0;i<100;i++){const s=await f.call('organizer-status',{topicId:f.bound.topic.id});if(s.tasks.length&&s.tasks.every(t=>t.status!=='running'))return s;await delay(50);}throw Error('Task did not settle');}
test('received CompletedTurn produces sourced conditional knowledge through common publisher without a browser',async()=>{
 const server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const input=JSON.parse(raw);assert.equal(input.completedTurns[0].assistant.content,'合成回答');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:1,changes:[{type:'create-card',id:'finding',text:'可能有效，仅限样本A',conditions:['仅限样本A'],uncertainty:'尚未验证',sources:[input.completedTurns[0].id]}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 process.env.BANG_ORGANIZER_ENDPOINT=`http://127.0.0.1:${server.address().port}`;
 const f=await fixture();delete process.env.BANG_ORGANIZER_ENDPOINT;
 try{
 await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));
 const status=await settled(f);assert.equal(status.tasks[0].status,'committed');
 const state=await runtimeOperation(f.project,'state',f.bound.topic.id);assert.equal(state.canvas.nodes[0].text,'可能有效，仅限样本A');assert.equal(state.metadata.finding.source.kind,'discussion');assert.deepEqual(state.metadata.finding.knowledge.conditions,['仅限样本A']);assert.equal(state.metadata.finding.knowledge.uncertainty,'尚未验证');
 assert.equal((await f.call('turn-status',{topicId:f.bound.topic.id})).organized,1);
 assert.equal((await runtimeOperation(f.project,'history',f.bound.topic.id))[1].author.kind,'organizer');
 await f.call('stop');assert.equal((await runtimeOperation(f.project,'state',f.bound.topic.id)).revision,1);assert.equal((await f.call('organizer-status',{topicId:f.bound.topic.id})).tasks[0].receipt.revision,1);
 }finally{await f.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
async function controlled(handler){const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;try{const value=await handler(JSON.parse(body));res.end(JSON.stringify(value));}catch{res.statusCode=503;res.end('{}');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));process.env.BANG_ORGANIZER_ENDPOINT=`http://127.0.0.1:${server.address().port}`;const f=await fixture();delete process.env.BANG_ORGANIZER_ENDPOINT;const close=f.close;f.close=async()=>{await close();server.closeAllConnections();await new Promise(r=>server.close(r));};return f;}
const manual=(f,baseRevision,operations)=>runtimeOperation(f.project,'commit',f.bound.topic.id,{operationId:crypto.randomUUID(),topic:f.bound.topic.id,baseRevision,author:{kind:'manual',id:'user'},readDependencies:[],intent:'explicit-save',operations});
test('a running Organizer permits manual layout saves and compatible evidence supplement without replacing manual text',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const f=await controlled(async input=>{entered(input);await gate;return {version:1,changes:[{type:'supplement-card',id:'manual',conditions:['样本条件'],uncertainty:'未验证',sources:[input.completedTurns[0].id]}]};});
 try{await manual(f,0,[{type:'create-card',card:{id:'manual',text:'人工前提',x:0,y:0,width:320,height:120}}]);await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));const input=await started;assert.equal(input.activeContext.knowledgeCards[0].text,'人工前提');
 await manual(f,1,[{type:'edit-card',id:'manual',x:600,y:400}]);release();const status=await settled(f);assert.equal(status.tasks[0].status,'committed');const state=await runtimeOperation(f.project,'state',f.bound.topic.id);assert.equal(state.canvas.nodes[0].x,600);assert.equal(state.canvas.nodes[0].text,'人工前提');assert.equal(state.metadata.manual.source.kind,'manual');assert.deepEqual(state.metadata.manual.knowledge.conditions,['样本条件']);
 }finally{release();await f.close();}
});
test('protected HTTP exposes no-change receipts without leaking active input and consumes each version only once',async()=>{
 let calls=0;const f=await controlled(()=>{calls++;return {version:1,changes:[]};});let server;
 try{const {createCanvasMiddleware}=await import('../runtime/canvas/http.mjs');server=createServer(createCanvasMiddleware({project:f.project}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/api/canvas/`,token=(await (await fetch(base+'session/bootstrap')).json()).token,headers={'x-bang-browser-token':token,'Content-Type':'application/json'};
 assert.equal((await fetch(base+f.bound.topic.id+'/organizer')).status,403);
 const enabled=await fetch(base+f.bound.topic.id+'/organizer-enable',{method:'POST',headers,body:'{}'});assert.equal(enabled.status,200);
 await f.call('turn-ingest',f.signed([f.turn()]));const s=await settled(f);assert.equal(s.tasks[0].status,'no-change');assert.equal((await runtimeOperation(f.project,'state',f.bound.topic.id)).revision,0);await delay(250);assert.equal(calls,1);
 const visible=await (await fetch(base+f.bound.topic.id+'/organizer',{headers})).json();assert.equal(visible.tasks[0].receipt.status,'no-change');assert.equal(visible.tasks[0].input,undefined);assert.equal(visible.tasks[0].baseline,undefined);
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await f.close();}
});
test('manual semantic changes fence stale reasoning while unrelated topics and saves remain responsive',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);const f=await controlled(async input=>{entered();await gate;return {version:1,changes:[{type:'create-card',id:'late',text:'过时结论',conditions:[],uncertainty:'推测',sources:[input.completedTurns[0].id]}]};});
 try{await manual(f,0,[{type:'create-card',card:{id:'premise',text:'前提A',x:0,y:0,width:320,height:120}}]);await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));await started;const other=await f.call('topic-create',{name:'other'});assert.ok(other.id);await manual(f,1,[{type:'edit-card',id:'premise',text:'撤回前提A'}]);release();const s=await settled(f);assert.equal(s.tasks[0].error.code,'REASONING_INVALIDATED');assert.equal((await runtimeOperation(f.project,'state',f.bound.topic.id)).canvas.nodes.length,1);assert.equal((await f.call('turn-status',{topicId:f.bound.topic.id})).backlog,1);
 }finally{release();await f.close();}
});
test('a newer received answer version invalidates the older running inference without losing either source',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);const f=await controlled(async input=>{entered();await gate;return {version:1,changes:[{type:'create-card',id:'old-answer',text:'旧答案',conditions:[],uncertainty:'不确定',sources:[input.completedTurns[0].id]}]};});
 try{await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));await started;await f.call('turn-ingest',f.signed([f.turn('calling-turn','c2','v2','新版本')],'c1'));await f.call('organizer-control',{topicId:f.bound.topic.id,action:'pause'});release();const s=await settled(f);assert.equal(s.tasks[0].error.code,'SOURCE_SUPERSEDED');assert.equal((await runtimeOperation(f.project,'state',f.bound.topic.id)).revision,0);const q=await f.call('turn-status',{topicId:f.bound.topic.id});assert.equal(q.received,2);assert.equal(q.backlog,1);
 }finally{release();await f.close();}
});
for(const [name,change,code] of [
 ['fabricated source',()=>({type:'create-card',id:'new',text:'伪造',conditions:[],uncertainty:'',sources:['invented']}),'OUTPUT_INVALID'],
 ['arbitrary command',id=>({type:'exec',id:'cmd',command:'write board',conditions:[],uncertainty:'',sources:[id]}),'OUTPUT_INVALID'],
 ['visual region as fact endpoint',id=>({type:'create-relation',id:'edge',fromNode:'manual',toNode:'region',label:'supports',conditions:[],uncertainty:'',sources:[id]}),'OUTPUT_INVALID']
])test(`restricted result rejects ${name} atomically and preserves manual state`,async()=>{
 const f=await controlled(input=>{assert.deepEqual(input.activeContext.knowledgeCards.map(c=>c.id),['manual']);assert.deepEqual(input.activeContext.visualRegions.map(c=>c.id),['region']);assert.equal(input.activeContext.semanticRelations.length,0);return {version:1,changes:[change(input.completedTurns[0].id)]};});
 try{await manual(f,0,[{type:'create-card',card:{id:'manual',text:'人工原文',x:0,y:0,width:320,height:120}},{type:'create-card',card:{id:'region',type:'group',label:'视觉区域',text:'',x:500,y:0,width:320,height:120}}]);await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));const s=await settled(f);assert.equal(s.tasks[0].error.code,code);const state=await runtimeOperation(f.project,'state',f.bound.topic.id);assert.equal(state.revision,1);assert.equal(state.canvas.nodes[0].text,'人工原文');assert.equal((await f.call('turn-status',{topicId:f.bound.topic.id})).organized,0);await manual(f,1,[{type:'edit-card',id:'manual',text:'失败后仍可保存'}]);
 }finally{await f.close();}
});
test('restart fences a running attempt and keeps its unorganized source available',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);const f=await controlled(async input=>{entered();await gate;return {version:1,changes:[{type:'create-card',id:'stale-instance',text:'不能提交',conditions:[],uncertainty:'',sources:[input.completedTurns[0].id]}]};});
 try{await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));await started;await f.call('stop');release();const s=await f.call('organizer-status',{topicId:f.bound.topic.id});assert.equal(s.tasks[0].error.code,'ATTEMPT_INTERRUPTED');assert.equal((await runtimeOperation(f.project,'state',f.bound.topic.id)).revision,0);assert.equal((await f.call('turn-status',{topicId:f.bound.topic.id})).backlog,1);
 }finally{release();await f.close();}
});
test('bounded active context excludes unconverted annotations and preserves unseen persistent knowledge',async()=>{
 const f=await controlled(input=>{assert.equal(input.activeContext.knowledgeCards.length,100);assert.equal(JSON.stringify(input).includes('PRIVATE_ANNOTATION'),false);return {version:1,changes:[{type:'create-card',id:'increment',text:'增量',conditions:[],uncertainty:'',sources:[input.completedTurns[0].id]}]};});
 try{const operations=Array.from({length:101},(_,i)=>({type:'create-card',card:{id:'card-'+i,text:'知识'+i,x:i*344,y:0,width:320,height:120}}));operations.push({type:'create-extra',extra:{id:'annotation',element:{id:'annotation',type:'text',text:'PRIVATE_ANNOTATION',x:0,y:900,width:100,height:50}}});await manual(f,0,operations);await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));assert.equal((await settled(f)).tasks[0].status,'committed');const state=await runtimeOperation(f.project,'state',f.bound.topic.id);assert.equal(state.canvas.nodes.length,102);assert.equal(state.canvas.nodes.find(n=>n.id==='card-100').text,'知识100');assert.equal(state.editorExtras[0].element.text,'PRIVATE_ANNOTATION');
 }finally{await f.close();}
});
test('backup freezes a running Organizer in the restored project while the original finishes independently',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);const f=await controlled(async input=>{entered();await gate;return {version:1,changes:[{type:'create-card',id:'original-only',text:'仅原项目',conditions:[],uncertainty:'',sources:[input.completedTurns[0].id]}]};});let restored;
 try{await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));await started;const backup=await f.call('backup-export');restored=(await f.call('backup-restore',{backup})).projectPath;const status=await runtimeOperation(restored,'organizer-status',undefined,{topicId:f.bound.topic.id});assert.equal(status.enabled,false);assert.equal(status.tasks[0].error.code,'ATTEMPT_INTERRUPTED');assert.equal(status.tasks[0].input,undefined);release();assert.equal((await settled(f)).tasks[0].status,'committed');assert.equal((await runtimeOperation(restored,'state',f.bound.topic.id)).revision,0);const q=await runtimeOperation(restored,'turn-status',undefined,{topicId:f.bound.topic.id});assert.equal(q.frozen,1);assert.equal(q.organized,0);
 }finally{release();if(restored)await runtimeOperation(restored,'stop');await f.close();}
});
