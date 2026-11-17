// Real Chrome gestures -> real HTTP middleware -> real filesystem -> fresh page.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createBangMiddleware} from '../prototypes/whiteboard-integration/bridge.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'bang-browser-'));
const middleware=createBangMiddleware({projectRoot:temp});
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
 await cmd('Page.enable');await cmd('Page.navigate',{url});await until(()=>evaluate('!!window.bang?.api'));
 await delay(500);
 const rectangle=await evaluate('(()=>{const e=document.querySelector("[data-testid=toolbar-rectangle]");if(!e)throw Error("rectangle toolbar missing");const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');await click(rectangle.x,rectangle.y);
 await cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:650,y:350,button:'left',buttons:1,clickCount:1});await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:850,y:480,button:'left',buttons:1});await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:850,y:480,button:'left',clickCount:1});
 await until(()=>evaluate('window.bang.snapshot().elements.some(e=>e.type==="rectangle")'));
 const button=await evaluate('(()=>{const r=document.querySelector("#save").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');await click(button.x,button.y);
 const saved=await until(async()=>{const s=await(await fetch(url+'/api/bang/session')).json();return s.scene?.elements.some(e=>e.type==='rectangle')&&s.scene});
 await cmd('Page.reload');await until(()=>evaluate('!!window.bang?.api'));await until(()=>evaluate('window.bang.snapshot().elements.some(e=>e.type==="rectangle")'));
 const restored=await evaluate('window.bang.snapshot()');const a=saved.elements.find(e=>e.type==='rectangle'),b=restored.elements.find(e=>e.id===a.id);assert.ok(b);for(const key of ['x','y','width','height'])assert.equal(b[key],a[key]);
 console.log(JSON.stringify({pass:true,evidence:'real Chrome rectangle gesture, save HTTP, page reload',semanticSave:false}));
 }catch(error){console.error(await evaluate('JSON.stringify({body:document.body.innerText.slice(0,500),at:document.elementFromPoint(500,350)?.outerHTML.slice(0,250),snapshot:window.bang.snapshot()})'));const shot=await cmd('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(root,'browser-failure.png'),Buffer.from(shot.data,'base64'));throw error;
}finally{ws?.close();chrome.kill();await new Promise(r=>server.close(r));await delay(500);await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
