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
const cards=[{id:'back',text:'布局一',x:0,y:0,width:300,height:180},{id:'front',text:'布局二',x:450,y:0,width:200,height:120}];
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
const chrome=spawn(process.env.BANG_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port=0',`--user-data-dir=${path.join(temp,'chrome')}`,'--window-size=1440,1200','about:blank'],{stdio:'ignore',windowsHide:true});
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

 async function control(label){const p=await evaluate(`(()=>{const e=document.querySelector('[aria-label="${label}"]');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await click(p.x,p.y);}
 const geometry=()=>evaluate('(()=>{const e=window.canvasBoard.snapshot().find(e=>e.id==="back");const a=window.canvasBoard.viewport();return {x:(e.x+a.scrollX)*a.zoom.value+a.offsetLeft,y:(e.y+a.scrollY)*a.zoom.value+a.offsetTop,w:e.width*a.zoom.value,h:e.height*a.zoom.value,bx:e.x,by:e.y,width:e.width,height:e.height}})()');
 let p=await geometry();
 await cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x+20,y:p.y+20,button:'left',clickCount:1});
 await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+80,y:p.y+60,button:'left',buttons:1});await delay(200);
 assert.equal((await (await canvasRequest(url+'/api/canvas/demo/state')).json()).revision,0);
 await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+80,y:p.y+60,button:'left',clickCount:1});await delay(150);
 const moved=await geometry();assert.notEqual(moved.bx,p.bx);
 // Actual Excalidraw resize handle gesture; no editor state injection.
 await cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:moved.x+moved.w+4,y:moved.y+moved.h+4,button:'left',clickCount:1});
 await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:moved.x+moved.w+84,y:moved.y+moved.h+64,button:'left',buttons:1});await delay(150);
 await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:moved.x+moved.w+84,y:moved.y+moved.h+64,button:'left',clickCount:1});await delay(150);
 const resized=await geometry();if(resized.width<=moved.width)console.error({moved,resized});assert.ok(resized.width>moved.width,'resize width');assert.ok(resized.height>moved.height,'resize height');
 await control('布局选择 1');await button('选区置顶');await control('布局选择 1');await button('选区视觉分组');await button('固定选区位置');
 assert.equal((await (await canvasRequest(url+'/api/canvas/demo/state')).json()).revision,0);
 await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 1")'));
 const saved=await (await canvasRequest(url+'/api/canvas/demo/state')).json();assert.deepEqual(saved.canvas.nodes.map(n=>n.id),['front','back']);assert.equal(saved.canvas.edges.length,0);assert.equal(saved.canvas.nodes[0].regionId,saved.canvas.nodes[1].regionId);assert.equal(saved.canvas.nodes[0].fixed,true);
 const original=saved.canvas.nodes.find(n=>n.id==='back');assert.equal(original.width,resized.width);assert.equal(original.x,resized.bx);
 await cmd('Page.reload');await delay(250);await until(()=>evaluate('!!window.canvasBoard?.snapshot().length'));
 const reopened=await geometry();assert.equal(reopened.width,resized.width);assert.equal(reopened.bx,resized.bx);
 assert.equal(await evaluate('window.canvasBoard.snapshot().find(e=>e.id==="back").locked'),true);
 await button('新增知识卡片');await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 2")'));
 const added=await (await canvasRequest(url+'/api/canvas/demo/state')).json();assert.deepEqual(added.canvas.nodes.find(n=>n.id==='back'),original);
 await button('刷新');await until(()=>evaluate('document.body.innerText.includes("显示版本 2")'));
 await control('布局选择 2');await button('显式重新布局选区');assert.equal((await geometry()).bx,original.x);await button('解除位置固定');await button('显式重新布局选区');await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 3")'));
 const relayout=await (await canvasRequest(url+'/api/canvas/demo/state')).json();assert.deepEqual(relayout.canvas.nodes.find(n=>n.id==='front'),added.canvas.nodes.find(n=>n.id==='front'));
 console.log(JSON.stringify({pass:true,evidence:'real Chrome drag/resize, visual grouping, fixed position, layering, explicit save/reload, local insertion and selected relayout; real native HTTP; no interception'}));
}finally{ws?.close();chrome.kill();server.closeAllConnections();await new Promise(r=>server.close(r));await delay(500);spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'stop','--project',temp],{encoding:'utf8'});await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}

