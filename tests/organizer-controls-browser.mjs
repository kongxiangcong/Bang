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
let releaseCancelled=()=>{};
const model=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const input=JSON.parse(raw),source=input.completedTurns[0];if(source.turnId==='cancel-me')await new Promise(r=>releaseCancelled=r);res.end(JSON.stringify({version:1,changes:[{type:'create-card',id:source.turnId,text:'整理知识 '+source.turnId,conditions:['合成条件'],uncertainty:'未验证',sources:[source.id]}]}));});await new Promise(r=>model.listen(0,'127.0.0.1',r));process.env.BANG_ORGANIZER_ENDPOINT=`http://127.0.0.1:${model.address().port}`;
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
 const digest=value=>createHash('sha256').update(value).digest('hex');
 const binding=await call('binding-status',first);
 async function ingest(turnId,cursor,previousCursor,gap=false){
  const events=gap==='boundary'?[{kind:'reception-boundary',turnId,cursor}]:gap?[{kind:'gap',turnId,cursor,reason:'missing-record'}]:[{kind:'turn',role:'primary',status:'completed',turnId,versionId:'v1',cursor,user:{role:'user',content:'浏览器合成问题'},assistant:{role:'assistant',channel:'final',content:'浏览器合成回答'},sourceHash:digest(JSON.stringify(['浏览器合成问题','浏览器合成回答']))}];
  const batch={sourceId:binding.source.id,previousCursor,events},now=Date.now();
  const payload=Buffer.from(JSON.stringify({host:'controlled-browser',version:'1',instanceId:'fixture',sessionId:'current-A',workspaceId,role:'primary',scope:['*'],turnId:'enable-turn',cursor:'start',issuedAt:now,expiresAt:now+300000,nonce:randomUUID(),purpose:'completed-turn-ingestion',sourceId:binding.source.id,batchHash:digest(JSON.stringify(batch))})).toString('base64url');
  return call('turn-ingest',{batch,proof:{connectorId:'browser-controlled',payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64url')}});
 }
 await button('启用后台整理');
 await button('暂停整理');
 assert.equal((await call('organizer-status',{topicId:id})).enabled,false);
 await button('恢复整理');
 await ingest('enable-turn','c1','start');
 await until(()=>evaluate(`document.querySelector('[aria-label="整理器状态"]')?.textContent.includes('已提交')`));
 assert.equal(await evaluate(`document.querySelector('header').textContent.includes('显示版本 0')`),true);
 await button('刷新');await until(()=>evaluate(`document.querySelector('[aria-label="卡片正文 1"]')?.value==='整理知识 enable-turn'`));
 await evaluate(`[...document.querySelectorAll('details')].filter(d=>d.querySelector('summary')?.textContent==='来源与条件').forEach(d=>d.open=true)`);
 assert.equal(await evaluate(`document.body.innerText.includes('合成条件')&&document.body.innerText.includes('未验证')`),true);
 // Close the actual board tab; native receiving continues without browser JS.
 const blank=await cmd('Target.createTarget',{url:'about:blank'});
 const currentTarget=await cmd('Target.getTargetInfo');await cmd('Target.closeTarget',{targetId:currentTarget.targetInfo.targetId});ws.close();
 await ingest('after-close','c2','c1');await until(async()=> (await call('turn-status',{topicId:id})).organized===2);
 const reopened=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();ws=new WebSocket(reopened.find(t=>t.id===blank.targetId).webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
 await cmd('Page.enable');await cmd('Page.navigate',{url:url+'/canvas.html?topic='+id+'#session='+first.sessionToken});
 await until(()=>evaluate(`document.querySelector('[aria-label="完成轮接收状态"]')?.textContent.includes('已接收 2 · 已整理 2 · 积压 0')`));
 await until(()=>evaluate(`[...document.querySelectorAll('textarea')].some(t=>t.value==='整理知识 after-close')`));
 await button('暂停整理');await ingest('cancel-me','c3','c2');
 assert.equal((await call('turn-status',{topicId:id})).backlog,1);await button('恢复整理');await button('立即取消');await until(async()=> (await call('organizer-status',{topicId:id})).tasks.at(-1).status==='cancelled');releaseCancelled();await button('跳过并保留缺口');
 await until(()=>evaluate(`document.body.innerText.includes('已跳过（保留处理缺口）')`));
 assert.equal((await call('turn-status',{topicId:id})).gaps.at(-1).reason,'user-skipped');
 await button('停止接收');await ingest('disabled','c4','c3');await button('重新启用接收');
 await until(()=>evaluate(`document.body.innerText.includes('等待连接器核验当前边界')`));
 await ingest('disabled-end','c5','c4','boundary');
 await until(()=>evaluate(`document.body.innerText.includes('c3 → c5（不自动补收）')`));
 await evaluate(`[...document.querySelectorAll('details')].filter(d=>d.querySelector('summary')?.textContent.startsWith('资源预算')).forEach(d=>d.open=true)`);
 await evaluate(`document.querySelector('[aria-label="每小时调用上限"]').focus();document.querySelector('[aria-label="每小时调用上限"]').select()`);await cmd('Input.insertText',{text:'5'});await button('保存资源限制');
 await until(async()=> (await call('organizer-status',{topicId:id})).limits.callsPerHour===5);
 assert.equal((await call('turn-status',{topicId:id})).received,3);
 console.log('PASS real Chrome pause/resume, cancel/skip gap, stop/fresh boundary resume, resource configuration, close/background/reopen');}catch(error){console.log(await evaluate('document.body.innerText'));console.log(await evaluate(`[...document.querySelectorAll('textarea')].map(e=>({label:e.ariaLabel,value:e.value}))`));throw error;}finally{releaseCancelled();if(ws)ws.close();chrome.kill();model.closeAllConnections();await new Promise(r=>model.close(r));delete process.env.BANG_ORGANIZER_ENDPOINT;await new Promise(r=>server.close(r));await call('stop');await delay(800);await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}


