import {canvasRequest} from './canvas-request.mjs';
// Real Chrome gestures -> real HTTP middleware -> real filesystem -> fresh page.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createCanvasMiddleware} from '../runtime/canvas/http.mjs';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await fs.mkdtemp(path.join(process.env.BANG_BROWSER_WORKSPACE??os.tmpdir(),'项目 浏览器 '));
const installed=process.env.BANG_BROWSER_PACKAGED_ROOT;
const node=installed?path.join(installed,process.platform==='win32'?'node/node.exe':'node/bin/node'):process.execPath;
const launcher=path.join(installed??root,'runtime/canvas/bang.mjs');
const cards=[{id:'back',text:'中文 **原文**',x:-20,y:10,width:300,height:180},{id:'front',text:'前层',x:80,y:40,width:200,height:100}];
let chrome, ws, packaged, server, url;
const delay=ms=>new Promise(r=>setTimeout(r,ms));let n=0;const pending=new Map();
try{
const cli=spawnSync(node,[launcher,'generate','--project',temp,'--topic','demo'],{input:JSON.stringify({cards}),encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);
if (installed) {
 packaged=spawn(node,[path.join(installed,'release/bang.mjs'),'serve','--project',temp],{stdio:['ignore','pipe','inherit'],windowsHide:true});
 const [data]=await Promise.race([
  once(packaged.stdout,'data'),
  once(packaged,'exit').then(([code])=>{throw Error('Packaged editor exited '+code)}),
 ]);
 url=new URL(JSON.parse(data.toString()).url).origin;
 const unauthorized=await fetch(url+'/api/canvas/demo/state');
 assert.equal(unauthorized.status,403);
 const crossOrigin=await fetch(url+'/api/canvas/session/bootstrap',{headers:{origin:'https://example.test'}});
 assert.equal(crossOrigin.status,403);
 assert.equal((await fetch(url+'/package-manifest.json')).status,404);
 assert.equal((await fetch(url+'/elk-worker.min.js')).status,200);
 const font=await fetch(url+'/fonts/Virgil/Virgil-Regular.woff2');
 assert.equal(font.status,200);
 assert.equal(font.headers.get('content-type'),'font/woff2');
 const css=(await (await fetch(url+'/canvas.html')).text()).match(/href="([^"]+\.css)"/)?.[1];
 assert.ok(css);
 assert.match((await fetch(url+css)).headers.get('content-type'),/^text\/css/);
} else {
 const middleware=createCanvasMiddleware({project:temp});
 const dist=path.join(root,'prototypes/whiteboard-integration/dist');
 server=http.createServer((req,res)=>middleware(req,res,async()=>{
  try{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.join(dist,pathname==='/'?'index.html':pathname);const content=await fs.readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(content);}catch{res.statusCode=404;res.end();}
 }));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 url='http://127.0.0.1:'+server.address().port;
}
chrome=spawn(process.env.BANG_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port=0',`--user-data-dir=${path.join(temp,'chrome')}`,'--window-size=1440,960','about:blank'],{stdio:'ignore',windowsHide:true});

async function until(fn){for(let i=0;i<100;i++){try{const result=await fn();if(result)return result}catch{}await delay(100)}throw Error('timed out')}
function cmd(method,params={}){return new Promise((resolve,reject)=>{const id=++n;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){const result=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value}
async function click(x,y){await cmd('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1})}
 const port=await until(async()=>Number((await fs.readFile(path.join(temp,'chrome/DevToolsActivePort'),'utf8')).split('\n')[0]));
 const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
 await cmd('Page.enable');await cmd('Page.navigate',{url:url+'/canvas.html?topic=demo'});
 await until(()=>evaluate('!!window.canvasBoard?.snapshot().length'));
 async function button(text) {
  const pos=await evaluate(`(() => {
   const element=[...document.querySelectorAll('button')].find(button=>button.textContent===${JSON.stringify(text)});
   if (!element) throw Error('Missing button');
   element.scrollIntoView({block:'nearest',inline:'nearest'});
   const bounds=element.getBoundingClientRect();
   return {x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};
  })()`);
  await click(pos.x,pos.y);
 }
 async function type(label,text) {
  const pos=await evaluate(`(() => {
   const element=document.querySelector('[aria-label="${label}"]');
   if (!element) throw Error('Missing card input');
   element.scrollIntoView({block:'nearest',inline:'nearest'});
   const bounds=element.getBoundingClientRect();
   return {x:bounds.x+10,y:bounds.y+10};
  })()`);
  await click(pos.x,pos.y);
  assert.equal(await evaluate('document.activeElement?.getAttribute("aria-label")'),label);
  await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65,commands:['selectAll']});
  await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});
  await cmd('Input.insertText',{text});
  assert.equal(await evaluate('document.activeElement.value'),text);
 }
 await button('新增知识卡片');await type('卡片正文 3','无聊天来源的人工知识');
 assert.equal((await (await canvasRequest(url+'/api/canvas/demo/state')).json()).revision,0);
 await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 1")'));
 let state=await (await canvasRequest(url+'/api/canvas/demo/state')).json();const manualId=state.canvas.nodes[2].id;assert.equal(state.metadata[manualId].source.kind,'manual');assert.equal(state.canvas.nodes[2].text,'无聊天来源的人工知识');
 await cmd('Page.reload');await until(()=>evaluate(`document.querySelectorAll('textarea[aria-label^="卡片正文 "]').length===3`));
 assert.equal(await evaluate(`document.querySelectorAll('textarea[aria-label^="卡片正文 "]')[2].value`),'无聊天来源的人工知识');
 await type('卡片正文 3','人工改写');await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 2")'));
 await button('删除卡片 3');await button('保存');await until(()=>evaluate('document.body.innerText.includes("已保存 · 修订 3")'));
 await cmd('Page.reload');await until(()=>evaluate(`document.querySelectorAll('textarea[aria-label^="卡片正文 "]').length===2`));
 state=await (await canvasRequest(url+'/api/canvas/demo/state')).json();assert.equal(state.revision,3);assert.equal(state.canvas.nodes.length,2); const shot=await cmd('Page.captureScreenshot',{format:'png'});await fs.writeFile(process.env.BANG_BROWSER_SCREENSHOT??path.join(root,'canvas-save-browser.png'),Buffer.from(shot.data,'base64'));
 console.log(JSON.stringify({pass:true,packaged:Boolean(installed),evidence:'real Chrome, real mouse/text create, explicit save, reopen, edit, delete -> HTTP -> disk'}));
 }finally{ws?.close();chrome?.kill();if(server)await new Promise(r=>server.close(r));packaged?.kill();await delay(500);spawnSync(node,[launcher,'stop','--project',temp],{encoding:'utf8'});await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}




