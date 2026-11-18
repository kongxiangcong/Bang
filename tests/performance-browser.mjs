import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createCanvasMiddleware} from '../runtime/canvas/http.mjs';
import {runtimeOperation} from '../runtime/native/runtime.mjs';
import {performanceDataset} from '../baselines/whiteboard-v1/performance-dataset.mjs';

const settings=JSON.parse(await fs.readFile(new URL('../baselines/whiteboard-v1/performance.json',import.meta.url)));
const [directory,condition,mode]=process.argv.slice(2);
assert.ok(['idle','blocked'].includes(condition));
const pilot=mode==='pilot';
assert.ok(!mode||pilot);
const warmups=pilot?1:settings.warmups, samples=pilot?2:settings.samples;
const base=path.resolve(directory,'synthetic-project');
const run=await fs.mkdtemp(path.resolve(directory,condition+'-'));
const project=path.join(run,'project'), profile=path.join(run,'chrome');
const dist=fileURLToPath(new URL('../prototypes/whiteboard-integration/dist/',import.meta.url));
const report={pilot,condition,warmups,samples,platform:os.version(),cpu:os.cpus()[0].model,logicalCPUs:os.cpus().length,ramBytes:os.totalmem(),node:process.version,realModelCalls:0,rows:[],failures:[]};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=server=>'http://127.0.0.1:'+server.address().port;
const call=(command,input)=>runtimeOperation(project,command,'t32',input);
const threshold=60000;
async function until(fn){
 const end=Date.now()+threshold;
 while(Date.now()<end){const value=await fn();if(value)return value;await pause(50);}
 throw Error('Timed out waiting for observable browser or organizer result');
}
function connect(target){
 const socket=new WebSocket(target), responses=new Map();
 let seq=0;
 socket.onmessage=e=>{const m=JSON.parse(e.data),r=responses.get(m.id);if(!r)return;responses.delete(m.id);clearTimeout(r.timeout);m.error?r.reject(Error(m.error.message)):r.resolve(m.result);};
 return new Promise((resolve,reject)=>{
  socket.onerror=()=>reject(Error('Chrome connection failed'));
  socket.onopen=()=>resolve({close:()=>socket.close(),command:(method,params={})=>new Promise((resolve,reject)=>{
   const id=++seq,timeout=setTimeout(()=>{responses.delete(id);reject(Error(method+' exceeded 60 seconds'));},threshold);
   responses.set(id,{resolve,reject,timeout});socket.send(JSON.stringify({id,method,params}));
  })});
 });
}
const middleware=createCanvasMiddleware({project});
const site=http.createServer((req,res)=>middleware(req,res,async()=>{
 try{
  const name=new URL(req.url,'http://localhost').pathname;
  const file=path.resolve(dist,'.'+name);
  if(!file.startsWith(path.resolve(dist)+path.sep))throw Error('Unknown file');
  const data=await fs.readFile(file);
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.woff2':'font/woff2'})[path.extname(file)]??'application/octet-stream');
  res.end(data);
 }catch{res.statusCode=404;res.end();}
}));
let waiting=null,began=0,modelRequests=0,disconnected=false;
const model=http.createServer(async(req,res)=>{
 for await(const chunk of req){}
 modelRequests++;waiting=res;began=performance.now();
 res.on('close',()=>{disconnected=true;});
});
let chrome,cdp,browser,originalEndpoint=process.env.BANG_ORGANIZER_ENDPOINT;
async function treeBytes(dir){
 let bytes=0,files=0;
 for(const entry of await fs.readdir(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name);
  if(entry.isDirectory()){const child=await treeBytes(file);bytes+=child.bytes;files+=child.files;}
  else if(entry.isFile()){bytes+=(await fs.stat(file)).size;files++;}
 }
 return {bytes,files};
}
function machineSample(){return {freeMemoryBytes:os.freemem(),cpuTicks:os.cpus().reduce((sum,c)=>({idle:sum.idle+c.times.idle,total:sum.total+Object.values(c.times).reduce((a,b)=>a+b,0)}),{idle:0,total:0})};}
const write=()=>fs.writeFile(path.join(run,'report.json'),JSON.stringify(report,null,2));
try{
 assert.equal((await runtimeOperation(base,'status')).status,'unavailable','Copy a stopped synthetic dataset');
 const generation=(await fs.readFile(path.join(directory,'generation.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 report.generationCompileMs=generation.findLast(r=>r.compileMs)?.compileMs;
 report.generationAndPublicationMs=generation.find(r=>r.generateAndPublishMs)?.generateAndPublishMs;
 report.snapshotSize=await treeBytes(path.join(base,'.bang'));
 report.sourceHashes={};
 for(const name of ['tests/performance-browser.mjs','baselines/whiteboard-v1/performance.json','runtime/canvas/history-storage.mjs','runtime/canvas/store.mjs','runtime/native/runtime.mjs','prototypes/whiteboard-integration/dist/canvas.html']){
  report.sourceHashes[name]=createHash('sha256').update(await fs.readFile(new URL('../'+name,import.meta.url))).digest('hex');
 }
 if(process.platform==='win32')report.powerScheme=spawnSync('powercfg.exe',['/getactivescheme'],{encoding:'utf8',windowsHide:true}).stdout.match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i)?.[0];
 await fs.cp(base,project,{recursive:true});
 await listen(model);await listen(site);
 process.env.BANG_ORGANIZER_ENDPOINT=url(model);
 assert.ok(!['BANG_ORGANIZER_NATIVE','BANG_ORGANIZER_CODEX','BANG_ORGANIZER_DSH'].some(k=>process.env[k]),'Expected isolated controlled executor configuration');
 const initial=await call('state'),start=initial.revision;
 report.startRevision=start;if(pilot)assert.ok(start>=2&&start<=10000);else assert.equal(start,10000);
 const frozen=performanceDataset();
 const expected=structuredClone(frozen.nodes);
 for(const edit of frozen.revisions.slice(0,start))expected[(edit.revision-1)%expected.length].text=edit.text;
 assert.deepEqual(initial.canvas.nodes,expected);
 assert.deepEqual(initial.canvas.edges,frozen.edges);
 assert.equal(initial.relations.length,frozen.edges.length);
 const initialHistory=await call('history');
 assert.deepEqual(initialHistory.slice(1).map(row=>row.operationId),frozen.revisions.slice(0,start).map(edit=>'frozen-'+edit.revision));
 report.frozenWorkload={nodes:expected.length,relations:initial.relations.length,edits:start,bootstrapRows:1,attachmentBytes:0};
 assert.equal((await call('history-capacity')).revisions,start+1);
 const status=await call('status');
 if(condition==='blocked'){
  await call('organizer-configure',{limits:{timeoutMs:3600000}});
  await call('reorganize-request',{baseRevision:start,ids:['n0'],intent:'reorganize-selection'});
  await until(()=>waiting);
 }
 const chromeExe=process.env.BANG_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe';
 chrome=spawn(chromeExe,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port=0','--window-size=1440,960','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
 const port=await until(async()=>Number((await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8').catch(()=>'' )).split('\n')[0]));
 const debug='http://127.0.0.1:'+port;
 const info=await (await fetch(debug+'/json/version')).json();
 report.chrome=info.Browser;browser=await connect(info.webSocketDebuggerUrl);
 const targets=await (await fetch(debug+'/json/list')).json();
 cdp=await connect(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 async function evaluate(expression){
  const value=await cdp.command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(value.exceptionDetails)throw Error(value.exceptionDetails.exception?.description??value.exceptionDetails.text);
  return value.result.value;
 }
 await cdp.command('Page.navigate',{url:url(site)+'/canvas.html?topic=t32'});
 await until(()=>evaluate('window.canvasBoard?.snapshot().length===5000'));
 await evaluate(`(async()=>{window.t32Button=(text)=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
 window.t32Wait=async(fn)=>{const end=performance.now()+40000;while(!fn()){if(performance.now()>end)throw Error('Render deadline: '+document.querySelector('[role="alert"]')?.textContent);await new Promise(requestAnimationFrame);}};
 window.t32Frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 window.t32Token=(await (await fetch('/api/canvas/session/bootstrap')).json()).token;})()`);
 report.machineStart=machineSample();
 for(let i=0;i<warmups+samples;i++){
  const revision=start+i+1,history=1+(i*97)%(start-1);
  const trial={i,phase:i<warmups?'warmup':'sample',revision,historyRevision:history};
  report.rows.push(trial);
  const text='T32 timing '+revision;
  const patch={topic:'t32',baseRevision:revision-1,operationId:'sample-'+revision,author:{kind:'manual',id:'reference'},intent:'explicit-save',readDependencies:[],operations:[{type:'edit-card',id:'n0',text}]};
  trial.save=await evaluate(`(async()=>{const body=${JSON.stringify(JSON.stringify(patch))};const t=performance.now();const response=await fetch('/api/canvas/t32/commit',{method:'POST',headers:{'Content-Type':'application/json','x-bang-browser-token':window.t32Token},body});const receipt=await response.json();if(!response.ok||receipt.revision!==${revision})throw Error(JSON.stringify(receipt));return performance.now()-t;})()`);
  trial.refresh=await evaluate(`(async()=>{performance.clearResourceTimings();t32Button('刷新').click();await t32Wait(()=>document.querySelector('header')?.textContent.includes('显示版本 ${revision} ·')&&window.canvasBoard.snapshot().length===5000&&window.canvasBoard.snapshot().some(e=>e.containerId==='n0'&&e.originalText===${JSON.stringify(text)}));await t32Frame();const timing=performance.getEntriesByName(location.origin+'/api/canvas/t32/state').at(-1);if(!timing)throw Error('Missing refresh GET');return performance.now()-timing.startTime;})()`);
  trial.history=await evaluate(`(async()=>{t32Button('查看历史').click();await t32Wait(()=>!!t32Button('预览修订 0'));const pager=document.querySelector('nav[aria-label="历史分页"] select');if(pager){pager.value=String(Math.floor(${history}/100));pager.dispatchEvent(new Event('change',{bubbles:true}));}await t32Wait(()=>!!t32Button('预览修订 ${history}'));performance.clearResourceTimings();t32Button('预览修订 ${history}').click();await t32Wait(()=>document.querySelector('[aria-label="历史版本预览"] h3')?.textContent.endsWith('修订 ${history}')&&!!document.querySelector('[aria-label="历史差异"]')&&!t32Button('预览修订 ${history}').disabled);await t32Frame();const timing=performance.getEntriesByName(location.origin+'/api/canvas/t32/history-preview?revision=${history}&details=1').at(-1);if(!timing)throw Error('Missing history GET');const elapsed=performance.now()-timing.startTime;t32Button('关闭历史').click();return elapsed;})()`);
  await write();
  if(condition==='blocked')assert.ok(waiting&&!disconnected&&modelRequests===1,'One live blocked organizer throughout measurement');
 }
 report.machineEnd=machineSample();
 report.measuredProjectSize=await treeBytes(path.join(project,'.bang'));
 // Verify the retained frozen head independently of the new sample revisions.
 const original=await call('history-preview',{revision:start});
 const lastEdit=1+1000*Math.floor((start-1)/1000);
 assert.equal(original.canvas.nodes[0].text,'Revision '+lastEdit+': condition remains unmeasured.');
 const historyRows=await call('history');
 assert.equal(historyRows.length,start+warmups+samples+1);
 const list=(await browser.command('SystemInfo.getProcessInfo')).processInfo;
 if(process.platform==='win32'){
  report.nativeOwnerPID=status.pid;report.driverPID=process.pid;report.chromeProcesses=list;
  const memory=spawnSync('powershell.exe',['-NoProfile','-Command','Get-Process -Id '+[process.pid,status.pid,...list.map(p=>p.id)].join(',')+' -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,PeakWorkingSet64 | ConvertTo-Json -Compress'],{encoding:'utf8',windowsHide:true});
  report.perProcessPeakWorkingSetBytes=JSON.parse(memory.stdout);
 }
 report.headRevision=historyRows.at(-1).revision;
 report.modelRequests=modelRequests;report.modelBoundaryWaitMs=began?performance.now()-began:0;
 if(!pilot){
  report.p95=Object.fromEntries(['save','refresh','history'].map(key=>[key,report.rows.slice(warmups).map(r=>r[key]).sort((a,b)=>a-b)[Math.ceil(samples*.95)-1]]));
  for(const [key,value] of Object.entries(report.p95)){
   const limit=settings.targetsMs[key+'P95'];
   if(value>limit)report.failures.push(key+' p95 '+value+' ms exceeds '+limit+' ms');
  }
  report.metTargets=report.failures.length===0;
  if(!report.metTargets)process.exitCode=1;
 }
 report.complete=true;
}catch(error){report.failures.push(error.stack);process.exitCode=1;}
finally{
 if(originalEndpoint===undefined)delete process.env.BANG_ORGANIZER_ENDPOINT;else process.env.BANG_ORGANIZER_ENDPOINT=originalEndpoint;
 await write();
 console.log(JSON.stringify({run,complete:report.complete,p95:report.p95,failures:report.failures}));
 cdp?.close();browser?.close();chrome?.kill();waiting?.destroy();site.closeAllConnections();site.close();model.closeAllConnections();model.close();
 await call('stop').catch(()=>{});
}
