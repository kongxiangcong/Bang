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
 async function button(text){const pos=await evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(text)});if(!e)throw Error('Missing button');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await click(pos.x,pos.y);}
 async function type(label,text){const pos=await evaluate(`(()=>{const e=document.querySelector('[aria-label="${label}"]');e.scrollIntoView();const r=e.getBoundingClientRect();return {x:r.x+10,y:r.y+10}})()`);await click(pos.x,pos.y);await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65,commands:['selectAll']});await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2});await cmd('Input.insertText',{text});}
 const raw='# 原文\n<script>window.unsafeExecuted=true</script>\n```js\nalert(1)\n```\n$$x^2$$\n'+'完整长文'.repeat(1500);
 await button('新增文件卡片');await type('文件路径 3','docs/missing.pdf');
 await button('新增链接卡片');await type('链接地址 4','https://example.com/paper');
 await button('新增知识卡片');await type('卡片正文 5',raw);
 assert.equal((await (await fetch(url+'/api/canvas/demo/state')).json()).revision,0);
 await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 1")'));
 await cmd('Page.reload');await until(()=>evaluate('document.querySelectorAll("textarea").length===5'));
 assert.equal(await evaluate('document.querySelectorAll("textarea")[4].value'),raw);
 async function openDetails(index){const pos=await evaluate(`(()=>{const e=document.querySelectorAll('summary')[${index}];e.scrollIntoView();const r=e.getBoundingClientRect();return {x:r.x+20,y:r.y+10};})()`);await click(pos.x,pos.y);}
 await openDetails(2);await until(()=>evaluate('document.body.innerText.includes("资源缺失 · 引用已保留")'));
 await openDetails(4);assert.equal(await evaluate('document.querySelectorAll("pre")[4].textContent'),raw);
 assert.equal(await evaluate('!!window.unsafeExecuted'),false);
 assert.equal(await evaluate('document.querySelectorAll("iframe,img[src*=example],script[src*=example]").length'),0);
 const state=await (await fetch(url+'/api/canvas/demo/state')).json();assert.equal(state.canvas.nodes[2].type,'file');assert.equal(state.canvas.nodes[3].url,'https://example.com/paper');assert.equal(state.canvas.nodes[4].text,raw);
 const shot=await cmd('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(root,'canvas-resources-browser.png'),Buffer.from(shot.data,'base64'));
 console.log(JSON.stringify({pass:true,evidence:'real Chrome create file/link/raw cards, explicit save and reopen, missing placeholder, safe complete raw details'}));

 }finally{ws?.close();chrome.kill();await new Promise(r=>server.close(r));await delay(500);await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}


