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
 await type('卡片正文 1','尚未提交的中文草稿');await button('新增知识卡片');
 assert.equal((await (await canvasRequest(url+'/api/canvas/demo/state')).json()).revision,0);
 await cmd('Page.reload');await delay(250);await until(()=>evaluate('document.body.innerText.includes("发现可恢复草稿")'));
 assert.equal(await evaluate('document.querySelectorAll("textarea")[0].value'),'中文 **原文**');
 await button('恢复草稿');assert.equal(await evaluate('document.querySelectorAll("textarea")[0].value'),'尚未提交的中文草稿');
 await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 1")'));
 await cmd('Page.reload');await delay(250);await until(()=>evaluate('document.querySelectorAll("textarea").length===3'));
 assert.equal(await evaluate('document.body.innerText.includes("发现可恢复草稿")'),false);
 // Browser composition driven by Chromium's IME API; not a physical OS IME.
 await type('卡片正文 1','已完成输入');await button('新增知识卡片');await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 2")'));
 await type('卡片正文 1','');await cmd('Input.imeSetComposition',{text:'候选中间态',selectionStart:0,selectionEnd:6});await delay(700);
 assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="保存").disabled'),true);
 await cmd('Page.reload');await delay(250);await until(()=>evaluate('document.querySelectorAll("textarea").length===4'));
 assert.equal(await evaluate('document.body.innerText.includes("发现可恢复草稿")'),false);
 await type('卡片正文 1','');await cmd('Input.imeSetComposition',{text:'中文候选',selectionStart:0,selectionEnd:4});await cmd('Input.insertText',{text:'中文确认'});await button('新增知识卡片');
 await cmd('Page.reload');await delay(250);await until(()=>evaluate('document.body.innerText.includes("发现可恢复草稿")'));await button('恢复草稿');
 assert.equal(await evaluate('document.querySelector("textarea").value'),'中文确认');
 await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 3")'));
 // Real mouse drag on the current Canvas becomes a draft only at pointer-up.
 let pos=await evaluate('(()=>{const e=window.canvasBoard.snapshot().find(e=>e.id==="back");const a=window.canvasBoard.viewport();return {x:(e.x+a.scrollX+20)*a.zoom.value+a.offsetLeft,y:(e.y+a.scrollY+20)*a.zoom.value+a.offsetTop,bx:e.x,by:e.y}})()');
 await cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:pos.x,y:pos.y,button:'left',clickCount:1});await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:pos.x+40,y:pos.y+30,button:'left',buttons:1});await delay(600);
 await cmd('Page.reload');await delay(250);await until(()=>evaluate('!!window.canvasBoard?.snapshot().length'));assert.equal(await evaluate('document.body.innerText.includes("发现可恢复草稿")'),false);
 await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:pos.x+40,y:pos.y+30,button:'left',clickCount:1});
 pos=await evaluate('(()=>{const e=window.canvasBoard.snapshot().find(e=>e.id==="back");const a=window.canvasBoard.viewport();return {x:(e.x+a.scrollX+20)*a.zoom.value+a.offsetLeft,y:(e.y+a.scrollY+20)*a.zoom.value+a.offsetTop,bx:e.x,by:e.y}})()');
 await cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:pos.x,y:pos.y,button:'left',clickCount:1});
 await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:pos.x+70,y:pos.y+50,button:'left',buttons:1});await delay(600);
 assert.equal((await (await canvasRequest(url+'/api/canvas/demo/state')).json()).revision,3);
 await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:pos.x+70,y:pos.y+50,button:'left',clickCount:1});await delay(100);
 const moved=await evaluate('window.canvasBoard.snapshot().find(e=>e.id==="back").x');assert.notEqual(moved,pos.bx);
 await cmd('Page.reload');await delay(250);await until(()=>evaluate('document.body.innerText.includes("发现可恢复草稿")'));await button('恢复草稿');await until(()=>evaluate(`window.canvasBoard.snapshot().find(e=>e.id==="back").x===${moved}`));
 await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 4")'));
 assert.equal((await (await canvasRequest(url+'/api/canvas/demo/state')).json()).canvas.nodes[0].x,moved);
 await button('新增知识卡片');
 await type('卡片正文 1','第一页竞争草稿');
 // A separate tab starts with committed content; concurrent save makes this page stale.
 const first=ws;const inheritedName=await evaluate('window.name');const target=await cmd('Target.createTarget',{url:'about:blank'});
 const tabs=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();ws=new WebSocket(tabs.find(t=>t.id===target.targetId).webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
 await cmd('Page.enable');await evaluate(`window.name=${JSON.stringify(inheritedName)}`);await cmd('Page.navigate',{url:url+'/canvas.html?topic=demo'});await until(()=>evaluate('document.querySelectorAll("textarea").length===5'));assert.notEqual(await evaluate('window.name'),inheritedName);
 assert.equal(await evaluate('document.body.innerText.includes("发现可恢复草稿")'),false);
 await type('卡片正文 1','第二页已提交');await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 5")'));
 await type('卡片正文 1','第二页独立草稿');await button('新增知识卡片');const second=ws;ws=first;
 await button('保存');await until(()=>evaluate('document.body.innerText.includes("Baseline conflict")'));
 await cmd('Page.reload');await delay(250);await until(()=>evaluate('document.body.innerText.includes("发现可恢复草稿")'));await button('恢复草稿');assert.equal(await evaluate('document.querySelector("textarea").value'),'第一页竞争草稿');
 assert.equal((await (await canvasRequest(url+'/api/canvas/demo/state')).json()).canvas.nodes[0].text,'第二页已提交');
 ws=second;await cmd('Page.reload');await delay(250);await until(()=>evaluate('document.body.innerText.includes("发现可恢复草稿")'));await button('恢复草稿');assert.equal(await evaluate('document.querySelector("textarea").value'),'第二页独立草稿');
 await cmd('Page.reload');await delay(250);await until(()=>evaluate('document.body.innerText.includes("发现可恢复草稿")'));await button('放弃草稿');await cmd('Page.reload');await delay(250);await until(()=>evaluate('document.querySelectorAll("textarea").length===5'));assert.equal(await evaluate('document.body.innerText.includes("发现可恢复草稿")'),false);
 const summary=await evaluate('(()=>{const r=document.querySelector("summary").getBoundingClientRect();return {x:r.x+20,y:r.y+10}})()');await click(summary.x,summary.y);await button(await evaluate('document.querySelector("details button").textContent'));await button('恢复草稿');assert.equal(await evaluate('document.querySelector("textarea").value'),'第一页竞争草稿');
 ws=first;await cmd('Page.navigate',{url:url+'/canvas.html?topic=other'});await delay(250);await until(()=>evaluate('document.querySelectorAll("textarea").length===2'));assert.equal(await evaluate('document.body.innerText.includes("发现可恢复草稿")'),false);
 await type('卡片正文 1','其他专题草稿');await button('新增知识卡片');await cmd('Page.navigate',{url:url+'/canvas.html?topic=demo'});await delay(250);await until(()=>evaluate('document.body.innerText.includes("发现可恢复草稿")'));await button('恢复草稿');assert.equal(await evaluate('document.querySelector("textarea").value'),'第一页竞争草稿');
 const otherProject=path.join(temp,'workspace-b');await fs.mkdir(otherProject);assert.equal(spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'generate','--project',otherProject,'--topic','demo'],{input:JSON.stringify({cards}),encoding:'utf8'}).status,0);
 middleware=createCanvasMiddleware({project:otherProject});await cmd('Page.reload');await delay(250);await until(()=>evaluate('document.querySelectorAll("textarea").length===2'));assert.equal(await evaluate('document.body.innerText.includes("发现可恢复草稿")'),false);assert.equal(await evaluate('document.body.innerText.includes("其他编辑页的可恢复草稿")'),false);
 middleware=createCanvasMiddleware({project:temp});await cmd('Page.reload');await delay(250);await until(()=>evaluate('document.body.innerText.includes("发现可恢复草稿")'));await button('恢复草稿');assert.equal(await evaluate('document.querySelector("textarea").value'),'第一页竞争草稿');
 spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'stop','--project',otherProject],{encoding:'utf8'});
 second.close();console.log(JSON.stringify({pass:true,evidence:'real Chrome two tabs/topics/workspaces, simulated inherited tab name, pointer drag, Chromium simulated IME, reload recovery/discard, stale save retains draft; no API interception or editor state injection'})); }catch(error){console.error(error);throw error;}finally{ws?.close();chrome.kill();server.closeAllConnections();await new Promise(r=>server.close(r));await delay(500);spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'stop','--project',temp],{encoding:'utf8'});spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'stop','--project',path.join(temp,'workspace-b')],{encoding:'utf8'});await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}











