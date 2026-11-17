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
const cards=[{id:'back',text:'中文 **原文**',x:-20,y:10,width:300,height:180},{id:'front',text:'前层',x:80,y:40,width:200,height:100}];
const cli=spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'generate','--project',temp,'--topic','demo'],{input:JSON.stringify({cards}),encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);
assert.equal(spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'generate','--project',temp,'--topic','other'],{input:JSON.stringify({cards}),encoding:'utf8'}).status,0);
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
function cmd(method,params={}){return new Promise((resolve,reject)=>{const id=++n;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){const result=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value}
async function click(x,y){await cmd('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1})}
try{
 const port=await until(async()=>Number((await fs.readFile(path.join(temp,'chrome/DevToolsActivePort'),'utf8')).split('\n')[0]));
 const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
 await cmd('Page.enable');await cmd('Page.navigate',{url:url+'/canvas.html?topic=demo'});
 await until(()=>evaluate('!!window.canvasBoard?.snapshot().length'));
 async function button(text){const pos=await evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(text)});if(!e)throw Error('Missing button');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await click(pos.x,pos.y);}
 async function type(label,text){const pos=await evaluate(`(()=>{const e=document.querySelector('[aria-label="${label}"]');const r=e.getBoundingClientRect();return {x:r.x+10,y:r.y+10}})()`);await click(pos.x,pos.y);await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65,commands:['selectAll']});await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2});await cmd('Input.insertText',{text});}
 await button('新增知识卡片');await button('刷新');await until(()=>evaluate('document.body.innerText.includes("保留并合并")'));await button('取消刷新');
 const remote=(id,baseRevision,operations)=>{const r=spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'commit','--project',temp,'--topic','demo'],{input:JSON.stringify({operationId:id,topic:'demo',baseRevision,author:{kind:'manual',id:'second-client'},readDependencies:[],intent:'explicit-save',operations}),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 remote('remote-add',0,[{type:'create-card',card:{id:'remote',text:'后台新增',x:900,y:900,width:320,height:180}}]);
 await until(()=>evaluate('document.body.innerText.includes("后台头版本 1")'));
 assert.equal(await evaluate('document.querySelectorAll("textarea").length'),3);
 await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 2")'));
 assert.equal(await evaluate('document.body.innerText.includes("显示版本 0")'),true);
 assert.equal(await evaluate('document.body.innerText.includes("局部确认 2")'),true);
 assert.equal(await evaluate('document.querySelectorAll("textarea").length'),3);
 remote('remote-text',2,[{type:'edit-card',id:'back',text:'后台正文'}]);
 await type('卡片正文 1','本地竞争正文');await type('卡片正文 2','可独立保存');await button('保存');await until(()=>evaluate('document.body.innerText.includes("冲突预览")'));
 assert.equal((await (await canvasRequest(url+'/api/canvas/demo/state')).json()).canvas.nodes[1].text,'前层');
 assert.equal(await evaluate('document.querySelectorAll("textarea")[0].value'),'本地竞争正文');
 await button('另存无冲突部分');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 4")'));
 assert.equal(await evaluate('document.querySelectorAll("textarea")[0].value'),'本地竞争正文');
 await cmd('Page.reload');await delay(250);await until(()=>evaluate('document.body.innerText.includes("发现可恢复草稿")'));await button('恢复草稿');
 assert.equal(await evaluate('document.querySelectorAll("textarea")[0].value'),'本地竞争正文');
 const center=await evaluate('(()=>{const r=document.querySelector("main").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+250}})()');
 await cmd('Input.dispatchMouseEvent',{type:'mousePressed',...center,button:'middle',clickCount:1});await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:center.x+90,y:center.y+60,button:'middle',buttons:4});await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:center.x+90,y:center.y+60,button:'middle',clickCount:1});
 const viewport=await evaluate('(()=>{const a=window.canvasBoard.viewport();return {x:a.scrollX,y:a.scrollY,z:a.zoom.value}})()');
 await button('刷新');await button('保留并合并');await until(()=>evaluate('document.body.innerText.includes("显示版本 4")'));
 assert.equal(await evaluate('document.querySelectorAll("textarea")[0].value'),'本地竞争正文');assert.equal(await evaluate('document.querySelectorAll("textarea").length'),4);
 assert.deepEqual(await evaluate('(()=>{const a=window.canvasBoard.viewport();return {x:a.scrollX,y:a.scrollY,z:a.zoom.value}})()'),viewport);
 await button('保存');await until(()=>evaluate('document.body.innerText.includes("冲突预览")'));
 assert.equal((await (await canvasRequest(url+'/api/canvas/demo/state')).json()).canvas.nodes[0].text,'后台正文');
 await button('刷新');await button('放弃并刷新');await until(()=>evaluate('document.querySelectorAll("textarea")[0].value==="后台正文"'));
 await type('卡片正文 1','保存后刷新正文');await button('刷新');await button('保存并刷新');await until(()=>evaluate('document.body.innerText.includes("显示版本 5")'));
 assert.equal((await (await canvasRequest(url+'/api/canvas/demo/state')).json()).canvas.nodes[0].text,'保存后刷新正文');
 console.log('PASS real Chrome + native Runtime: status-only updates, stale save overlay, atomic conflict, legal subset, recovery, three refresh choices and viewport');
}finally{ws?.close();chrome.kill();server.closeAllConnections();await new Promise(r=>server.close(r));await delay(500);spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'stop','--project',temp],{encoding:'utf8'});spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'stop','--project',path.join(temp,'workspace-b')],{encoding:'utf8'});await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}











