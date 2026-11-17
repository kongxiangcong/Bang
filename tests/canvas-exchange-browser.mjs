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

 const standard={nodes:[{id:'g',type:'group',x:-50,y:-50,width:600,height:500,label:'Visual only'},{id:'t',type:'text',x:0,y:0,width:240,height:140,text:'# Full raw\n\n**body**'},{id:'f',type:'file',x:300,y:0,width:200,height:120,file:'missing.pdf',subpath:'#page=1'},{id:'l',type:'link',x:0,y:250,width:200,height:100,url:'https://example.com/'}],edges:[{id:'r',fromNode:'t',toNode:'f',label:'unknown term',fromEnd:'arrow',toEnd:'none'}]};
 async function exchange(){await evaluate(`(()=>{const e=[...document.querySelectorAll('summary')].find(e=>e.textContent==='标准 Canvas 导入导出');e.click();})()`);}
 await exchange();await type('Canvas JSON',JSON.stringify(standard));await button('预览 Canvas 导入');await until(()=>evaluate('document.body.innerText.includes("人工导入 · 基线修订")'));assert.equal((await (await canvasRequest(url+'/api/canvas/demo/state')).json()).revision,0);await button('确认人工导入');await until(()=>evaluate('document.body.innerText.includes("视觉区域（不参与知识）")'));
 const state=await (await canvasRequest(url+'/api/canvas/demo/state')).json();assert.equal(state.revision,1);assert.equal(state.metadata.g.role,'visual-region');assert.equal(state.canvas.nodes.length,4);assert.equal(state.relations[0].classification,'unclassified');
 await exchange();await button('预览标准导出');await until(()=>evaluate('document.body.innerText.includes("不能代替完整备份")'));
 const download=path.join(temp,'downloads');await fs.mkdir(download);await cmd('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:download});await button('下载标准 Canvas');await until(()=>fs.readFile(path.join(download,'board.canvas'),'utf8'));assert.deepEqual(JSON.parse(await fs.readFile(path.join(download,'board.canvas'),'utf8')),standard);
 standard.nodes[1].text='external editor exact raw';await fs.writeFile(boardFile,JSON.stringify(standard));await cmd('Page.reload');await delay(700);await until(()=>evaluate('document.body.innerText.includes("recovery required")'));
 await exchange();await button('预览外部文件修改');await until(()=>evaluate('document.body.innerText.includes("完整候选内容")'));await button('确认人工导入');await until(()=>evaluate('[...document.querySelectorAll("textarea")].some(e=>e.value==="external editor exact raw")'));
 assert.deepEqual((await (await canvasRequest(url+'/api/canvas/demo/export-canvas')).json()).canvas,standard);assert.ok((await fs.readdir(path.dirname(boardFile))).some(n=>n.startsWith('preserved-')));assert.ok(!requests.some(u=>u.startsWith('https://example.com/')));
 const shot=await cmd('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(root,'canvas-exchange-browser.png'),Buffer.from(shot.data,'base64'));
 console.log(JSON.stringify({pass:true,evidence:'real Chrome JSON import preview/confirm, visual group, standard download exact equality, external current.canvas edit and explicit adoption; no automatic URL fetch'}));
 }finally{ws?.close();chrome.kill();await new Promise(r=>server.close(r));await delay(500);spawnSync(process.execPath,[path.join(root,'runtime/canvas/bang.mjs'),'stop','--project',temp]);await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
