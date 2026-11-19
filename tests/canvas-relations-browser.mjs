import {canvasRequest} from './canvas-request.mjs';
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
const cards=[{id:'a',text:'A',x:0,y:0,width:200,height:120},{id:'b',text:'B',x:480,y:0,width:200,height:120},{id:'c',text:'C',x:480,y:300,width:200,height:120}];
const cli=spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'generate','--project',temp,'--topic','demo'],{input:JSON.stringify({cards}),encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);
const boardFile=path.join(temp,'.bang/topics/demo/current.canvas');const before=await fs.readFile(boardFile,'utf8');const beforeStat=await fs.stat(boardFile);
const middleware=createCanvasMiddleware({project:temp});
const dist=path.join(root,'prototypes/whiteboard-integration/dist');
const server=http.createServer((req,res)=>middleware(req,res,async()=>{
 try{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.join(dist,pathname==='/'?'index.html':pathname);const content=await fs.readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(content);}catch{res.statusCode=404;res.end();}
}));
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
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
 async function button(text){const pos=await evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(text)});if(!e)throw Error('Missing button');e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await click(pos.x,pos.y);}
 async function type(label,text){const pos=await evaluate(`(()=>{const e=document.querySelector('[aria-label="${label}"]');e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+10,y:r.y+10}})()`);await click(pos.x,pos.y);await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65,commands:['selectAll']});await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2});await cmd('Input.insertText',{text});}
 await button('新增关系');await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 1")'));
 let state=await (await canvasRequest(url+'/api/canvas/demo/state')).json();const relationId=state.canvas.edges[0].id;
 assert.equal(state.canvas.edges[0].toNode,'b');
 // Read-only scene inspection locates real pointer targets; no scene injection.
 await evaluate("document.querySelector('.excalidraw').scrollIntoView({block:'center'})");
 await evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
 const points=await evaluate(`(()=>{const es=window.canvasBoard.snapshot(),v=window.canvasBoard.viewport(),a=es.find(e=>e.id===${JSON.stringify(relationId)}),c=es.find(e=>e.id==='c');const bounds=document.querySelector('.excalidraw').getBoundingClientRect();const xy=(x,y)=>({x:(x+v.scrollX)*v.zoom.value+bounds.x,y:(y+v.scrollY)*v.zoom.value+bounds.y});return {mid:xy(a.x+a.points.at(-1)[0]/2,a.y+a.points.at(-1)[1]/2),end:xy(a.x+a.points.at(-1)[0],a.y+a.points.at(-1)[1]),target:xy(c.x-8,c.y+c.height/2)}})()`);
 await click(points.mid.x,points.mid.y);await delay(150);
 await cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:points.end.x,y:points.end.y,button:'left',clickCount:1});
 for(let i=1;i<=20;i++)await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:points.end.x+(points.target.x-points.end.x)*i/20,y:points.end.y+(points.target.y-points.end.y)*i/20,button:'left',buttons:1});
 await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:points.target.x,y:points.target.y,button:'left',clickCount:1});
 await delay(500);
 console.log(JSON.stringify(await evaluate('window.canvasBoard.snapshot().filter(e=>e.type==="arrow").map(e=>({id:e.id,start:e.startBinding,end:e.endBinding}))')));
 await until(()=>evaluate(`document.querySelector('[aria-label="关系 1 终点"]')?.value==="c"`));
 assert.equal((await (await canvasRequest(url+'/api/canvas/demo/state')).json()).canvas.edges[0].toNode,'b');
 await cmd('Page.reload');await until(()=>evaluate('document.body.innerText.includes("发现可恢复草稿")'));await button('恢复草稿');
 assert.equal(await evaluate(`document.querySelector('[aria-label="关系 1 终点"]').value`),'c');
 await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 2")'));
 await cmd('Page.reload');await until(()=>evaluate(`document.querySelector('[aria-label="关系 1 终点"]')?.value==="c"`));
 state=await (await canvasRequest(url+'/api/canvas/demo/state')).json();assert.equal(state.relations[0].toNode,'c');
 const shot=await cmd('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(root,'canvas-relations-browser.png'),Buffer.from(shot.data,'base64'));
 await type('关系标签 1','保留自定义关系');await button('反转关系 1');await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 3")'));
 state=await (await canvasRequest(url+'/api/canvas/demo/state')).json();assert.equal(state.relations[0].fromNode,'c');assert.equal(state.relations[0].toNode,'a');assert.equal(state.relations[0].classification,'unclassified');assert.equal(state.relations[0].label,'保留自定义关系');
 await button('删除关系 1');await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 4")'));
 await cmd('Page.reload');await until(()=>evaluate(`document.querySelectorAll('textarea[aria-label^="卡片正文 "]').length===3`));
 state=await (await canvasRequest(url+'/api/canvas/demo/state')).json();assert.equal(state.relations.length,0);assert.equal(state.deletionIntents[0].id,relationId);
 // An unbound arrow is annotation only, with no semantic save operation.
 await evaluate("document.querySelector('.excalidraw').scrollIntoView({block:'center'})");
 await evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
 await until(()=>evaluate('!!window.canvasBoard?.snapshot().length'));
 await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65});await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65});
 const blank=await evaluate(`(()=>{const v=window.canvasBoard.viewport();return {x:v.offsetLeft+100,y:v.offsetTop+v.height-70}})()`);
 await cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:blank.x,y:blank.y,button:'left',clickCount:1});
 await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:blank.x+100,y:blank.y,button:'left',buttons:1});
 await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:blank.x+100,y:blank.y,button:'left',clickCount:1});await delay(300);
 assert.equal(await evaluate(`document.querySelector('[aria-label="关系 1 终点"]')===null`),true);
 assert.equal((await (await canvasRequest(url+'/api/canvas/demo/state')).json()).relations.length,0);
 console.log(JSON.stringify({pass:true,evidence:'real Chrome endpoint drag A→B to A→C, draft recover, save/reopen, reverse label delete -> native Runtime'}));
 }finally{ws?.close();chrome.kill();await new Promise(r=>server.close(r));await delay(500);spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'stop','--project',temp],{encoding:'utf8'});await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}





