// Real Chrome gestures -> real HTTP middleware -> real filesystem -> fresh page.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createCanvasMiddleware} from '../runtime/canvas/http.mjs';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'bang-browser-'));
const cards=['root','a','b','c','d'].map((id,i)=>({id,text:id,x:i*350,y:0,width:320,height:120}));
const edges=['a','b','c','d'].map(id=>({id:'r-'+id,fromNode:'root',toNode:id,kind:'classification'}));
if(process.env.BANG_LEGACY_RUNTIME){
 const oldCLI=path.join(process.env.BANG_LEGACY_RUNTIME,'runtime/canvas/bang.mjs');const legacyCards=[{...cards[0],text:'旧版A成本',structure:{version:1,kind:'comparison',rootId:'root',dimensions:['成本'],option:'A',dimension:'成本'}},{...cards[1],text:'旧版B延迟原文条件不能遗漏',structure:{version:1,kind:'comparison',rootId:'root',dimensions:['延迟'],option:'B',dimension:'延迟'}}];
 const generated=spawnSync(process.execPath,[oldCLI,'generate','--project',temp,'--topic','legacy'],{input:JSON.stringify({cards:legacyCards}),encoding:'utf8'});assert.equal(generated.status,0,generated.stderr);assert.equal(spawnSync(process.execPath,[oldCLI,'stop','--project',temp],{encoding:'utf8'}).status,0);
}
const cli=spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'generate','--project',temp,'--topic','demo'],{input:JSON.stringify({cards,edges}),encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);
assert.equal(spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'generate','--project',temp,'--topic','other'],{input:JSON.stringify({cards,edges}),encoding:'utf8'}).status,0);
const boardFile=path.join(temp,'.bang/topics/demo/current.canvas');const before=await fs.readFile(boardFile,'utf8');const beforeStat=await fs.stat(boardFile);
let middleware=createCanvasMiddleware({project:temp});
const dist=path.join(root,'prototypes/whiteboard-integration/dist');
const server=http.createServer((req,res)=>middleware(req,res,async()=>{
 try{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.join(dist,pathname==='/'?'index.html':pathname);const content=await fs.readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(content);}catch{res.statusCode=404;res.end();}
}));
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
async function canvasRequest(endpoint){const {token}=await (await fetch(url+'/api/canvas/session/bootstrap')).json();return fetch(endpoint,{headers:{'x-bang-browser-token':token}});}
const chrome=spawn(process.env.BANG_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port=0',`--user-data-dir=${path.join(temp,'chrome')}`,'--window-size=1440,960','about:blank'],{stdio:'ignore',windowsHide:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let ws;let n=0;const pending=new Map();
async function until(fn){for(let i=0;i<100;i++){try{const result=await fn();if(result)return result}catch{}await delay(100)}throw Error('timed out')}
function cmd(method,params={}){return new Promise((resolve,reject)=>{const id=++n;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},15000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});ws.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){const result=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value}
async function click(x,y){await cmd('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1})}
try{
 const port=await until(async()=>Number((await fs.readFile(path.join(temp,'chrome/DevToolsActivePort'),'utf8')).split('\n')[0]));
 const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
 await cmd('Page.enable');await cmd('Page.navigate',{url:url+'/canvas.html?topic=demo'});await until(()=>evaluate('!!window.canvasBoard?.snapshot().length'));
 async function press(selector){const p=await until(()=>evaluate(`(()=>{const e=${selector};if(!e||e.disabled)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`));await click(p.x,p.y);}
 const button=text=>press(`[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(text)})`);
 const state=async()=> (await (await canvasRequest(url+'/api/canvas/demo/state')).json());
 for(let i=1;i<=5;i++)await press(`document.querySelector('[aria-label="布局选择 ${i}"]')`);
 async function fill(selector,text){await press(selector);await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2});await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2});await cmd('Input.insertText',{text});}
 await fill(`document.querySelector('[aria-label="评价维度"]')`,'成本\n延迟');
 for(const [id,option,dimension] of [['root','A','成本'],['a','B','成本'],['b','A','延迟']]){await fill(`document.querySelector('[aria-label="option ${id}"]')`,option);await fill(`document.querySelector('[aria-label="dimension ${id}"]')`,dimension);}
 await button('预览对比结构');await until(()=>evaluate('document.body.innerText.includes("对比结构预览")'));
 assert.equal((await state()).revision,0);assert.ok(await evaluate('document.body.innerText.includes("未知／未提供")'));await button('保存');await until(async()=> (await state()).revision===1);
 const comparison=await state();assert.equal(comparison.canvas.nodes[0].structure.kind,'comparison');assert.equal(comparison.canvas.nodes[0].structure.option,'A');assert.equal(comparison.canvas.nodes[0].x,comparison.canvas.nodes[2].x);assert.equal(comparison.canvas.nodes[0].y,comparison.canvas.nodes[1].y);assert.equal(comparison.canvas.nodes.length,5);
 await cmd('Page.reload');await delay(400);await until(()=>evaluate('!!window.canvasBoard?.snapshot().length'));assert.deepEqual((await state()).canvas,comparison.canvas);
 for(let i=1;i<=5;i++)await press(`document.querySelector('[aria-label="布局选择 ${i}"]')`);
 await fill(`document.querySelector('[aria-label="eventTime root"]')`,'2025-06-01');await fill(`document.querySelector('[aria-label="eventTime a"]')`,'2025-01-01');
 await button('预览事件时间线');await until(()=>evaluate('document.body.innerText.includes("事件时间线预览")'));assert.equal((await state()).revision,1);
 await button('保存');await until(async()=> (await state()).revision===2);const timeline=await state();assert.equal(timeline.canvas.nodes[0].structure.eventTime,'2025-06-01');assert.equal(timeline.canvas.nodes[2].structure.eventTime,null);assert.ok(timeline.canvas.nodes[1].x<timeline.canvas.nodes[0].x);assert.deepEqual(timeline.canvas.edges,comparison.canvas.edges);
 await cmd('Page.reload');await delay(400);await until(()=>evaluate('!!window.canvasBoard?.snapshot().length'));assert.deepEqual((await state()).canvas,timeline.canvas);assert.ok(await evaluate('document.body.innerText.includes("事件时间未知")'));
 assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent==='保存').disabled`),true);
 const {runtimeOperation}=await import('../runtime/native/runtime.mjs');
 await runtimeOperation(temp,'commit','demo',{operationId:crypto.randomUUID(),topic:'demo',baseRevision:2,author:{kind:'manual',id:'another-page'},intent:'explicit-save',readDependencies:[],operations:[{type:'edit-card',id:'root',text:'后台新增条件，需手动刷新'}]});
 assert.equal(await evaluate('document.body.innerText.includes("后台新增条件，需手动刷新")'),false);await until(()=>evaluate('document.body.innerText.includes("后台头版本 3")'));await button('刷新');await until(()=>evaluate('document.body.innerText.includes("后台新增条件，需手动刷新")'));
 await cmd('Page.reload');await delay(400);await until(()=>evaluate('document.body.innerText.includes("后台新增条件，需手动刷新")'));assert.equal((await state()).canvas.nodes[0].structure.eventTime,'2025-06-01');
 if(process.env.BANG_LEGACY_RUNTIME){await cmd('Page.navigate',{url:url+'/canvas.html?topic=legacy'});await until(()=>evaluate('!!window.canvasBoard?.snapshot().length'));assert.ok(await evaluate(`document.querySelector('[aria-label="方案对比与事件时间线"]').innerText.includes('维度不一致：延迟 · 旧版B延迟原文条件不能遗漏')`));for(let i=1;i<=2;i++)await press(`document.querySelector('[aria-label="布局选择 ${i}"]')`);await fill(`document.querySelector('[aria-label="评价维度"]')`,'成本\n延迟');await button('预览对比结构');await button('保存');await until(async()=>(await (await canvasRequest(url+'/api/canvas/legacy/state')).json()).revision===1);await cmd('Page.reload');await until(()=>evaluate(`document.querySelector('[aria-label="方案对比与事件时间线"]')?.innerText.includes('旧版B延迟原文条件不能遗漏')`));assert.equal(await evaluate(`document.querySelector('[aria-label="方案对比与事件时间线"]').innerText.includes('维度不一致：')`),false);}
 console.log('PASS real Chrome comparison/timeline preview, unknown values, save and reopen; real native HTTP');
}catch(error){console.error(await evaluate('document.body.innerText').catch(()=>''));throw error;}finally{ws?.close();chrome.kill();server.closeAllConnections();await new Promise(r=>server.close(r));await delay(500);spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'stop','--project',temp],{encoding:'utf8'});await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
