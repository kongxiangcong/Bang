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
 async function type(label,text){const pos=await evaluate(`(()=>{const e=document.querySelector('[aria-label="${label}"]');e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect();return {x:r.x+10,y:r.y+10}})()`);await click(pos.x,pos.y);await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65,commands:['selectAll']});await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2});await cmd('Input.insertText',{text});}


 const state=async()=> (await (await canvasRequest(url+'/api/canvas/demo/state')).json());
 async function key(key,code,modifiers=0){await cmd('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0)});await cmd('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});}
 async function drag(x,y,dx,dy){await cmd('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});for(let i=1;i<=12;i++)await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+dx*i/12,y:y+dy*i/12,buttons:1,button:'left'});await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+dx,y:y+dy,button:'left',clickCount:1});await delay(600);}
 const blank=await evaluate('(()=>{const v=window.canvasBoard.viewport();return {x:v.offsetLeft+300,y:v.offsetTop+v.height-230}})()');
 await click(blank.x,blank.y);await key('r','KeyR');await delay(150);await drag(blank.x,blank.y,150,70);
 await key('l','KeyL');await delay(100);await click(blank.x+200,blank.y+20);await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:blank.x+250,y:blank.y+80});await click(blank.x+250,blank.y+80);await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:blank.x+320,y:blank.y+30});await cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:blank.x+320,y:blank.y+30,button:'left',clickCount:2});await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:blank.x+320,y:blank.y+30,button:'left',clickCount:2});await key('Escape','Escape');await delay(500);
 await key('v','KeyV');const rotate=await evaluate(`(()=>{const e=window.canvasBoard.snapshot().find(e=>e.type==='rectangle'&&!e.customData?.businessId),v=window.canvasBoard.viewport();return {x:(e.x+v.scrollX)*v.zoom.value+v.offsetLeft,y:(e.y+v.scrollY)*v.zoom.value+v.offsetTop,w:e.width*v.zoom.value,h:e.height*v.zoom.value}})()`);await click(rotate.x,rotate.y+rotate.h/2);await delay(150);await drag(rotate.x+rotate.w/2,rotate.y-20,50,20);
 await until(()=>evaluate('document.body.innerText.includes("转换标注 1")'));
 assert.equal((await state()).revision,0);
 await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 1")'));
 let saved=await state();assert.equal(saved.canvas.nodes.length,2);assert.equal(saved.canvas.edges.length,0);
 const annotation=saved.editorExtras.find(e=>e.element.type==='rectangle'&&!e.element.customData?.businessId);assert.ok(annotation);const route=saved.editorExtras.find(e=>e.element.type==='line');assert.ok(route);assert.ok(route.element.points.length>=3,'native multi-point route');assert.notEqual(annotation.element.angle,0,'native rotation');
 await cmd('Page.reload');await until(()=>evaluate('document.body.innerText.includes("转换标注 1")'));
 assert.ok(await evaluate(`window.canvasBoard.snapshot().some(e=>e.id===${JSON.stringify(annotation.id)})`));

 const reopened=await evaluate('window.canvasBoard.snapshot()');assert.equal(reopened.find(e=>e.id===annotation.id).angle,annotation.element.angle);assert.deepEqual(reopened.find(e=>e.id===route.id).points,route.element.points);
 await button('转换标注 1 为知识卡片');await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 2")'));
 assert.equal((await state()).canvas.nodes.length,3);
 await key('v','KeyV');
 const position=await evaluate(`(()=>{const e=window.canvasBoard.snapshot().find(e=>e.id===${JSON.stringify(annotation.id)}),v=window.canvasBoard.viewport();return {x:(e.x+10+v.scrollX)*v.zoom.value+v.offsetLeft,y:(e.y+10+v.scrollY)*v.zoom.value+v.offsetTop}})()`);
 await click(position.x,position.y);await key('d','KeyD',2);
 await until(()=>evaluate('document.querySelectorAll("textarea").length===4'));
 await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 3")'));
 saved=await state();const copy=saved.canvas.nodes.find(n=>n.derivedFrom===annotation.id);assert.ok(copy);assert.equal(saved.metadata[copy.id].derivedFrom,annotation.id);
 await type('卡片正文 4','独立副本');await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 4")'));
 saved=await state();assert.equal(saved.canvas.nodes.find(n=>n.id===copy.id).text,'独立副本');assert.notEqual(saved.canvas.nodes.find(n=>n.id===annotation.id).text,'独立副本');
 const labelPosition=await evaluate(`(()=>{const e=window.canvasBoard.snapshot().find(e=>e.type==='text'&&e.containerId===${JSON.stringify(copy.id)}),v=window.canvasBoard.viewport();return {x:(e.x+e.width/2+v.scrollX)*v.zoom.value+v.offsetLeft,y:(e.y+e.height/2+v.scrollY)*v.zoom.value+v.offsetTop}})()`);
 await cmd('Input.dispatchMouseEvent',{type:'mousePressed',...labelPosition,button:'left',clickCount:2});await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',...labelPosition,button:'left',clickCount:2});await key('a','KeyA',2);await cmd('Input.insertText',{text:'原生独立正文'});await key('Escape','Escape');await delay(600);
 await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 5")'));
 saved=await state();assert.equal(saved.canvas.nodes.find(n=>n.id===copy.id).text,'原生独立正文');assert.notEqual(saved.canvas.nodes.find(n=>n.id===annotation.id).text,'原生独立正文');
 await cmd('Page.reload');await until(()=>evaluate('document.querySelectorAll("textarea").length===4'));
 console.log(JSON.stringify({pass:true,evidence:'real Chrome native free rectangle/line, explicit save/reopen, explicit conversion, Ctrl+D identity/provenance and independent editing'}));
}finally{ws?.close();chrome.kill();server.closeAllConnections();await new Promise(r=>server.close(r));await delay(500);spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'stop','--project',temp],{encoding:'utf8'});await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}





