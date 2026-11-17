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
 assert.equal(await evaluate('location.hash'),'');
 await button('启用当前会话到专题');await until(()=>evaluate(`document.body.innerText.includes('已绑定 默认专题')`));
 const topics=await call('topics');assert.equal(topics.length,1);const id=topics[0].id;
 const digest=value=>createHash('sha256').update(value).digest('hex');
 const binding=await call('binding-status',first);
 async function ingest(turnId,cursor,previousCursor,versionId='v1'){
  const events=[{kind:'turn',role:'primary',status:'completed',turnId,versionId,cursor,user:{role:'user',content:'浏览器合成问题'},assistant:{role:'assistant',channel:'final',content:'浏览器合成回答 '+versionId},sourceHash:digest(JSON.stringify(['浏览器合成问题','浏览器合成回答 '+versionId]))}];
  const batch={sourceId:binding.source.id,previousCursor,events},now=Date.now();
  const payload=Buffer.from(JSON.stringify({host:'controlled-browser',version:'1',instanceId:'fixture',sessionId:'current-A',workspaceId,role:'primary',scope:['*'],turnId:'enable-turn',cursor:'start',issuedAt:now,expiresAt:now+300000,nonce:randomUUID(),purpose:'completed-turn-ingestion',sourceId:binding.source.id,batchHash:digest(JSON.stringify(batch))})).toString('base64url');
  return call('turn-ingest',{batch,proof:{connectorId:'browser-controlled',payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64url')}});
 }
 await ingest('enable-turn','c1','start');
 await ingest('enable-turn','c2','c1','v2');
 await until(()=>evaluate(`document.querySelector('[aria-label="来源版本历史"]')!==null`));
 await evaluate(`document.querySelector('[aria-label="来源版本历史"]').open=true`);
 await button('查看回答 enable-turn / v1');
 await until(()=>evaluate(`document.querySelector('[aria-label="回答原文"]')?.textContent.includes('浏览器合成回答 v1')`));
 assert.equal(await evaluate(`document.querySelector('[aria-label="回答原文"]').textContent.includes('历史回答 · 当前版本 v2')`),true);
 await button('查看回答 enable-turn / v2');
 await until(()=>evaluate(`document.querySelector('[aria-label="回答原文"]')?.textContent.includes('浏览器合成回答 v2')`));
 await call('stop');await cmd('Page.reload');
 await until(()=>evaluate(`document.querySelector('[aria-label="来源版本历史"]')?.textContent.includes('当前回答')`));
 assert.equal((await call('turn-status',{topicId:id})).received,2);
 console.log('PASS real Chrome historical/current answer selection, preserved text, superseded processing and Runtime reopen');}finally{if(ws)ws.close();chrome.kill();await new Promise(r=>server.close(r));await call('stop');await delay(800);await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}


