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
async function button(text){const p=await until(()=>evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(text)});if(!e||e.disabled)throw Error('Missing/enabled button');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`));await click(p.x,p.y);}
try{
 const port=await until(async()=>Number((await fs.readFile(path.join(temp,'chrome/DevToolsActivePort'),'utf8')).split('\n')[0]));
 const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
 await cmd('Page.enable');await cmd('Page.navigate',{url:url+'/canvas.html#session='+first.sessionToken});
 await until(()=>evaluate(`document.body.innerText.includes('current-A')`));
 assert.equal(await evaluate('location.hash'),'');
 await button('启用当前会话到专题');await until(()=>evaluate(`document.body.innerText.includes('已绑定 默认专题')`));
 const topics=await call('topics');assert.equal(topics.length,1);const id=topics[0].id;
 const oldBinding=await call('binding-status',first),now=Date.now();
 const batch={sourceId:oldBinding.source.id,previousCursor:'start',events:[{kind:'turn',role:'primary',status:'completed',turnId:'enable-turn',versionId:'v1',cursor:'accepted',user:{role:'user',content:'controlled question'},assistant:{role:'assistant',channel:'final',content:'controlled answer'},sourceHash:createHash('sha256').update(JSON.stringify(['controlled question','controlled answer'])).digest('hex')}]};
 const payload=Buffer.from(JSON.stringify({host:'controlled-browser',version:'1',instanceId:'fixture',sessionId:'current-A',workspaceId,role:'primary',scope:[id],turnId:'enable-turn',cursor:'start',issuedAt:now,expiresAt:now+300000,nonce:randomUUID(),purpose:'completed-turn-ingestion',sourceId:oldBinding.source.id,batchHash:createHash('sha256').update(JSON.stringify(batch)).digest('hex')})).toString('base64url');
 await call('turn-ingest',{batch,proof:{connectorId:'browser-controlled',payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64url')}});
 const second=await connect('current-B');await cmd('Page.navigate',{url:'about:blank'});await cmd('Page.navigate',{url:url+'/canvas.html?topic='+id+'#session='+second.sessionToken});
 await until(()=>evaluate(`document.body.innerText.includes('current-B')`));await button('启用当前会话到专题');
 await until(()=>evaluate(`document.querySelector('[aria-label="确认接管专题"]')?.textContent.includes('current-A')`));
 assert.ok(await evaluate(`document.querySelector('[aria-label="确认接管专题"]')?.textContent.includes('积压 1 轮')`));
 assert.equal((await call('binding-status',first)).status,'bound');
 await button('取消接管');assert.equal((await call('binding-status',first)).status,'bound');
 await button('启用当前会话到专题');await until(()=>evaluate(`!!document.querySelector('[aria-label="确认接管专题"]')`));await button('确认接管');
 await until(()=>evaluate(`document.body.innerText.includes('已绑定 默认专题')&&document.body.innerText.includes('current-B')`));
 assert.equal((await call('binding-status',first)).status,'unbound');
 assert.equal((await call('binding-sources',{topicId:id}))[0].endCursor,'accepted');
 assert.equal((await call('turn-status',{topicId:id})).backlog,1);
 const pos=await evaluate(`(()=>{const r=document.querySelector('[aria-label="新专题名称"]').getBoundingClientRect();return {x:r.x+10,y:r.y+10}})()`);await click(pos.x,pos.y);await cmd('Input.insertText',{text:'第二专题'});await button('创建专题');
 await until(async()=>(await call('topics')).length===2);await button('启用当前会话到专题');
 await until(()=>evaluate(`document.body.innerText.includes('已绑定 第二专题')`));
 await cmd('Page.reload');await until(()=>evaluate(`document.body.innerText.includes('已绑定 第二专题')`));
 assert.equal((await call('binding-status',second)).topic.name,'第二专题');
 console.log('PASS real Chrome topic create/default/picker/switch, precise controlled identity, takeover preview/cancel/confirm and reload');
}finally{if(ws)ws.close();chrome.kill();await new Promise(r=>server.close(r));await call('stop');await delay(800);await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
