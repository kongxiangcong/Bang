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
const delay=ms=>new Promise(r=>setTimeout(r,ms));let ws;let n=0;const pending=new Map();const requests=[];
async function until(fn){for(let i=0;i<100;i++){try{const result=await fn();if(result)return result}catch{}await delay(100)}throw Error('timed out')}
function cmd(method,params={}){return new Promise((resolve,reject)=>{const id=++n;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){const result=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value}
async function click(x,y){await cmd('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1})}
try{
 const port=await until(async()=>Number((await fs.readFile(path.join(temp,'chrome/DevToolsActivePort'),'utf8')).split('\n')[0]));
 const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
 await cmd('Page.enable');await cmd('Network.enable');await cmd('Page.navigate',{url:url+'/canvas.html?topic=demo'});
 await until(()=>evaluate('!!window.canvasBoard?.snapshot().length'));
 async function button(text){const pos=await evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(text)});if(!e)throw Error('Missing button');e.scrollIntoView();const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await click(pos.x,pos.y);}
 async function type(label,text){const pos=await evaluate(`(()=>{const e=document.querySelector('[aria-label="${label}"]');e.scrollIntoView();const r=e.getBoundingClientRect();return {x:r.x+10,y:r.y+10}})()`);await click(pos.x,pos.y);await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65,commands:['selectAll']});await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2});await cmd('Input.insertText',{text});}


 await button('生成完整项目备份');
 await until(()=>evaluate('document.body.innerText.includes("完整项目包已生成")'));
 const download=path.join(temp,'downloads');await fs.mkdir(download);await cmd('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:download});await button('下载完整项目包');
 const file=path.join(download,'bang-project.backup.json');await until(()=>fs.readFile(file,'utf8'));const backup=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(backup.format,'bang-project-backup');
 await cmd('Page.navigate',{url:url+'/canvas.html'});await until(()=>evaluate(`!!document.querySelector('[aria-label="完整项目包 JSON"]')`));
 await type('完整项目包 JSON',JSON.stringify(backup));await button('验证完整项目包');await until(()=>evaluate('document.body.innerText.includes("校验通过")'));await button('还原为独立新项目');
 const href=await until(()=>evaluate(`document.querySelector('[data-restore-link]')?.href`));const restoreId=new URL(href).searchParams.get('restored');assert.match(restoreId,/^[0-9a-f-]{36}$/);await cmd('Page.navigate',{url:href});
 await until(()=>evaluate('!!window.canvasBoard?.snapshot().length'));assert.equal(await evaluate(`document.querySelector('[aria-label="卡片正文 1"]').value`),'中文 **原文**');
 await type('卡片正文 1','restored independent edit');await button('保存');await until(()=>evaluate('document.body.innerText.includes("保存成功")||document.body.innerText.includes("已保存")'));
 const restoredState=JSON.parse(spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'state','--project',path.join(temp,'.bang/restored-projects',restoreId),'--topic','demo'],{encoding:'utf8'}).stdout);assert.equal(restoredState.canvas.nodes[0].text,'restored independent edit');assert.equal((await (await canvasRequest(url+'/api/canvas/demo/state')).json()).canvas.nodes[0].text,'中文 **原文**');
 await cmd('Page.reload');await until(()=>evaluate('!!window.canvasBoard?.snapshot().length'));
 const shot=await cmd('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(root,'canvas-backup-browser.png'),Buffer.from(shot.data,'base64'));
 console.log(JSON.stringify({pass:true,evidence:'real Chrome package download, independent package verify, restore, reopen new project and reload'}));
 }finally{ws?.close();chrome.kill();await new Promise(r=>server.close(r));await delay(500);
 const restoredDir=path.join(temp,'.bang/restored-projects');for(const id of await fs.readdir(restoredDir).catch(()=>[]))spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'stop','--project',path.join(restoredDir,id)]);
 spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'stop','--project',temp]);await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
