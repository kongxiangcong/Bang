import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {generateKeyPairSync,sign,randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createCanvasMiddleware} from '../runtime/canvas/http.mjs';
import {runtimeOperation} from '../runtime/native/runtime.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'bang-binding-browser-'));
const call=(command,input)=>runtimeOperation(temp,command,undefined,input);
const model=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const input=JSON.parse(raw),source=input.completedTurns[0];res.end(JSON.stringify({version:1,changes:[{type:'create-card',id:'finding',text:'依赖前提的结论',conditions:['合成条件'],uncertainty:'未验证',sources:[source.id]}]}));});await new Promise(r=>model.listen(0,'127.0.0.1',r));process.env.BANG_ORGANIZER_ENDPOINT=`http://127.0.0.1:${model.address().port}`;
const {workspaceId}=await call('start'),{privateKey,publicKey}=generateKeyPairSync('ed25519');
await call('connector-register',{id:'browser-controlled',host:'controlled-browser',versions:['1'],publicKey:publicKey.export({format:'pem',type:'spki'})});
async function connect(sessionId){const now=Date.now();const payload=Buffer.from(JSON.stringify({host:'controlled-browser',version:'1',instanceId:'fixture',sessionId,workspaceId,role:'primary',scope:['*'],turnId:'enable-turn',cursor:'start',issuedAt:now,expiresAt:now+300000,nonce:randomUUID()})).toString('base64url');return call('session-connect',{connectorId:'browser-controlled',payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64url')});}
const first=await connect('current-A');
const middleware=createCanvasMiddleware({project:temp}),dist=path.join(root,'prototypes/whiteboard-integration/dist');
const server=http.createServer((req,res)=>middleware(req,res,async()=>{try{const pathname=new URL(req.url,'http://localhost').pathname,file=path.join(dist,pathname);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}}));
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
const chrome=spawn(process.env.BANG_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port=0',`--user-data-dir=${path.join(temp,'chrome')}`,'--window-size=1600,1000','about:blank'],{stdio:'ignore',windowsHide:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let ws,n=0;const pending=new Map();
async function until(fn){for(let i=0;i<100;i++){try{const result=await fn();if(result)return result;}catch{}await delay(100);}throw Error('timed out');}
function cmd(method,params={}){return new Promise((resolve,reject)=>{const id=++n;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;}
async function click(x,y){await cmd('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});}
async function button(text){const p=await until(()=>evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(text)});if(!e||e.disabled)throw Error('Missing/enabled button');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`));await click(p.x,p.y);}
try{
 const port=await until(async()=>Number((await fs.readFile(path.join(temp,'chrome/DevToolsActivePort'),'utf8')).split('\n')[0]));
 const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
 await cmd('Page.enable');await cmd('Page.navigate',{url:url+'/canvas.html#session='+first.sessionToken});
 await until(()=>evaluate(`document.body.innerText.includes('current-A')`));
 await button('启用当前会话到专题');await until(()=>evaluate(`document.body.innerText.includes('已绑定 默认专题')`));
 const id=(await call('topics'))[0].id;
 await call('context-register',{id:'bridge',connectorId:'browser-controlled'});
 const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 async function bridge(command,input={},turnId='browser-turn'){const data={topicId:id,turnId,...input},now=Date.now(),payload=Buffer.from(JSON.stringify({host:'controlled-browser',version:'1',instanceId:'fixture',sessionId:'current-A',workspaceId,role:'primary',scope:[id],turnId,cursor:'start',issuedAt:now,expiresAt:now+300000,nonce:randomUUID(),purpose:command,bridgeId:'bridge',requestHash:hash(data)})).toString('base64url');return call(command,{...data,proof:{connectorId:'browser-controlled',payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64url')}});}
 const firstContext=await bridge('context-start');
 await bridge('context-ack',{token:firstContext.token,outcome:'delivered',envelopeHash:hash(firstContext.envelope)});
 await until(()=>evaluate(`document.querySelector('[aria-label="上下文递交"]')?.textContent.includes('已递交 · 修订 0')`));
 const pendingContext=await bridge('context-start',{},'failed-turn');
 await bridge('context-ack',{token:pendingContext.token,outcome:'unsynced',envelopeHash:hash(pendingContext.envelope)},'failed-turn');
 await until(()=>evaluate(`document.querySelector('[aria-label="上下文递交"]')?.textContent.includes('未同步 · 修订 0')`));
 await button('手动读取当前白板上下文');
 await until(()=>evaluate(`document.querySelector('[aria-label="手动上下文资料"]')?.textContent.includes('knowledgeCards')`));
 await cmd('Page.reload');
 await until(()=>evaluate(`document.querySelector('[aria-label="上下文递交"]')?.textContent.includes('未同步 · 修订 0')`));
 assert.equal(await evaluate(`document.querySelector('[aria-label="上下文递交"]')?.textContent.includes('模型实际使用：未知')`),true);
 console.log('PASS real Chrome controlled signed delivery/unsynced, manual read fallback and reopen');
}catch(error){console.log(await evaluate('document.body.innerText'));console.log(await evaluate(`[...document.querySelectorAll('textarea')].map(e=>({label:e.ariaLabel,value:e.value}))`));throw error;}finally{if(ws)ws.close();chrome.kill();model.closeAllConnections();await new Promise(r=>model.close(r));delete process.env.BANG_ORGANIZER_ENDPOINT;server.closeAllConnections();await new Promise(r=>server.close(r));await call('stop');await delay(800);await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
