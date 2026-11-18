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
const model=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const input=JSON.parse(raw);res.end(JSON.stringify({version:1,changes:input.selection.ids.map(id=>({type:'reorganize-card',id,structure:{version:1,kind:'classification',rootId:'root'},reason:'Explicit category/member relation'}))}));});
await new Promise(r=>model.listen(0,'127.0.0.1',r));process.env.BANG_ORGANIZER_ENDPOINT=`http://127.0.0.1:${model.address().port}`;
const cards=['root','a','b','c','d'].map((id,i)=>({id,text:id,x:i*350,y:0,width:320,height:120}));
const edges=['a','b','c','d'].map(id=>({id:'r-'+id,fromNode:'root',toNode:id,kind:'classification'}));
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
 await button('授权重新整理选区');await until(()=>evaluate('document.body.innerText.includes("已授权分析选区")'));
 await delay(600);await button('查看重新整理候选');await until(()=>evaluate('document.body.innerText.includes("候选已就绪")'));
 assert.equal((await state()).revision,0);assert.ok(await evaluate('document.querySelector("svg[aria-label=选区结构候选预览]")!==null'));
 assert.ok(await evaluate('document.body.innerText.includes("Explicit category/member relation")'));
 await cmd('Page.reload');await delay(400);await until(()=>evaluate('!!window.canvasBoard?.snapshot().length'));await button('查看重新整理候选');await until(()=>evaluate('document.body.innerText.includes("候选已就绪")'));assert.equal((await state()).revision,0);
 await button('采纳重新整理候选');await until(()=>evaluate('document.body.innerText.includes("重新整理已保存：修订 1")'));
 const saved=await state();assert.ok(saved.canvas.nodes.every(n=>n.structure.kind==='classification'));assert.deepEqual(saved.canvas.edges,edges);
 assert.ok(await evaluate('document.body.innerText.includes("显示版本 0")'));
 await button('刷新');await until(()=>evaluate('document.body.innerText.includes("显示版本 1")'));
 for(const n of saved.canvas.nodes){const e=await evaluate(`window.canvasBoard.snapshot().find(e=>e.id===${JSON.stringify(n.id)})`);assert.equal(Math.round(e.x),n.x);assert.equal(Math.round(e.y),n.y);}
 await cmd('Page.reload');await delay(400);await until(()=>evaluate('!!window.canvasBoard?.snapshot().length'));assert.deepEqual((await state()).canvas,saved.canvas);
 console.log('PASS actual Chrome selection authorization → controlled executor → compiled preview → acceptance receipt → manual refresh → reopen');

}catch(error){console.error(await evaluate('document.body.innerText').catch(()=>''));throw error;}finally{delete process.env.BANG_ORGANIZER_ENDPOINT;model.closeAllConnections();await new Promise(r=>model.close(r));ws?.close();chrome.kill();server.closeAllConnections();await new Promise(r=>server.close(r));await delay(500);spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'stop','--project',temp],{encoding:'utf8'});await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
