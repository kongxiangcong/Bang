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
const fixture=JSON.parse(await fs.readFile(path.join(root,'baselines/whiteboard-v1/legacy-session.json'),'utf8'));
fixture.scene.elements.push({id:'known',type:'rectangle',x:100.5,y:100.2,width:260.4,height:100.2,angle:0.3,boundElements:[{id:'known-label',type:'text'}],customData:{bangNode:{id:'known',text:'stale generated'}}},{id:'known-label',type:'text',containerId:'known',x:110,y:120,text:'Saved human body',originalText:'Saved human body'});
fixture.scene.elements[2].customData.bangRelation={id:'route',from:'known',to:'deleted'};
await fs.mkdir(path.join(temp,'.bang/sessions'),{recursive:true});await fs.writeFile(path.join(temp,'.bang/sessions/pim.json'),JSON.stringify(fixture));
const middleware=createCanvasMiddleware({project:temp});
const dist=path.join(root,'prototypes/whiteboard-integration/dist');
const server=http.createServer((req,res)=>middleware(req,res,async()=>{
 try{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.join(dist,pathname==='/'?'index.html':pathname);const content=await fs.readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(content);}catch{res.statusCode=404;res.end();}
}));
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
const chrome=spawn(process.env.BANG_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port=0',`--user-data-dir=${path.join(temp,'chrome')}`,'--window-size=1440,960','about:blank'],{stdio:'ignore',windowsHide:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let ws;let n=0;const pending=new Map();const requests=[];
async function until(fn){for(let i=0;i<100;i++){try{const result=await fn();if(result)return result}catch{}await delay(100)}throw Error('timed out')}
function cmd(method,params={}){return new Promise((resolve,reject)=>{const id=++n;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},15000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});ws.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){const result=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value}
async function click(x,y){await cmd('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1})}
try{
 const port=await until(async()=>Number((await fs.readFile(path.join(temp,'chrome/DevToolsActivePort'),'utf8')).split('\n')[0]));
 const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
 await cmd('Page.enable');await cmd('Network.enable');await cmd('Page.navigate',{url:url+'/canvas.html'});
 await until(()=>evaluate('document.body.innerText.includes("旧项目预检与迁移")'));
 async function button(text){const pos=await evaluate(`(()=>{const e=[...document.querySelectorAll('button,summary')].find(e=>e.textContent===${JSON.stringify(text)});if(!e)throw Error('Missing button');e.scrollIntoView();const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await click(pos.x,pos.y);}
 async function type(label,text){const pos=await evaluate(`(()=>{const e=document.querySelector('[aria-label="${label}"]');e.scrollIntoView();const r=e.getBoundingClientRect();return {x:r.x+10,y:r.y+10}})()`);await click(pos.x,pos.y);await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65,commands:['selectAll']});await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2});await cmd('Input.insertText',{text});}


 await button('旧项目预检与迁移');await button('只读预检');await until(()=>evaluate('document.body.innerText.includes("实际保存画面预览")'));
 assert.equal(await evaluate('document.body.innerText.includes("知识卡片 1")'),true);
 for(const label of ['我已停止所有旧写入者并关闭旧页面','我已核对历史、来源和画面；同意矛盾关系保持待确认']){const pos=await evaluate(`(()=>{const e=[...document.querySelectorAll('label')].find(e=>e.textContent===${JSON.stringify(label)}).querySelector('input');e.scrollIntoView();const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await click(pos.x,pos.y);}
 await button('迁入独立新项目');const href=await until(()=>evaluate(`document.querySelector('[data-migration-link]')?.href`));await cmd('Page.navigate',{url:href});
 await until(()=>evaluate(`document.querySelector('[aria-label="卡片正文 1"]')?.value==='Saved human body'`));
 assert.equal(await evaluate('document.body.innerText.includes("旧迁移依据 · 1 条关系待确认")'),true);
 const snapshot=await evaluate('window.canvasBoard.snapshot()');assert.equal(snapshot.find(e=>e.id==='known').angle,0.3);assert.equal(snapshot.find(e=>e.id==='known').width,260.4);
 await cmd('Page.reload');await until(()=>evaluate(`document.querySelector('[aria-label="卡片正文 1"]')?.value==='Saved human body'`));
 assert.equal(await fs.readFile(path.join(temp,'.bang/sessions/pim.json'),'utf8'),JSON.stringify(fixture));
 console.log(JSON.stringify({pass:true,evidence:'actual Chrome preflight, saved visual preview, explicit offline/replay confirmation, migration, retained manual knowledge body and exact rotation/width, reload'}));
 }finally{ws?.close();chrome.kill();await new Promise(r=>{server.close(r);server.closeAllConnections();});await delay(500);
 const restoredDir=path.join(temp,'.bang/restored-projects');for(const id of await fs.readdir(restoredDir).catch(()=>[]))spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'stop','--project',path.join(restoredDir,id)]);
 spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'stop','--project',temp]);await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
