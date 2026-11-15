import {promisify} from 'node:util';
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),evidence=path.join(root,'evidence','replay');
await fs.mkdir(evidence,{recursive:true});
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-sandbox','--disable-extensions','--hide-scrollbars','--remote-debugging-port=9340',`--user-data-dir=${path.join(evidence,'chrome-profile')}`,'--window-size=1440,960','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let ws,nextId=0;const pending=new Map(),runtimeErrors=[],externalRequests=[];
async function connect(){let targets;for(let i=0;i<60;i++){try{targets=await(await fetch('http://127.0.0.1:9340/json/list')).json();if(targets.some(t=>t.type==='page'))break}catch{}await wait(150)}const target=targets?.find(t=>t.type==='page');if(!target)throw Error('没有 Chrome page target');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej});ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}}if(m.method==='Runtime.exceptionThrown')runtimeErrors.push(m.params.exceptionDetails);if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))externalRequests.push(m.params.request.url)}}
function cmd(method,params={}){return new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){const r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
async function click(selector){const r=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await cmd('Input.dispatchMouseEvent',{type:'mousePressed',...r,button:'left',buttons:1,clickCount:1});await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',...r,button:'left',buttons:0,clickCount:1});await wait(120)}


const run=promisify(execFile),base=process.env.BANG_URL??'http://127.0.0.1:5180';
const results=[];
function assert(v,m){if(!v)throw Error(m)}
async function until(fn){for(let i=0;i<100;i++){try{if(await fn())return}catch{}await wait(150)}throw Error('等待状态超时')}
async function cli(...args){const {stdout}=await run(process.execPath,['bang.mjs',...args],{cwd:root,env:{...process.env,BANG_URL:base}});return JSON.parse(stdout)}
async function snapshot(){return evaluate('window.bang.snapshot()')}
async function record(name,fn){try{results.push({name,pass:true,detail:await fn()})}catch(e){results.push({name,pass:false,error:e.message});throw e}}
async function screenshot(name){const r=await cmd('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(evidence,name),Buffer.from(r.data,'base64'))}
try{
 await cli('reset');await connect();await cmd('Page.enable');await cmd('Runtime.enable');await cmd('Network.enable');await cmd('Emulation.setDeviceMetricsOverride',{width:1700,height:1050,deviceScaleFactor:1,mobile:false});await cmd('Page.navigate',{url:base});await until(()=>evaluate('!!window.bang?.api'));await wait(500);
 await record('34条原文逐条回放；每两轮更新；奇数尾轮收尾；来源不超前',async()=>{
  const checkpoints=[];
  for(let i=1;i<=34;i++){console.log('message',i);
   await until(()=>evaluate("!document.querySelector('#next').disabled"));await click('#next');await until(async()=> (await snapshot()).visibleCount===i);
   const expected=Math.floor(i/4)+(i===34?1:0);
   await until(async()=> (await snapshot()).appliedEventIds.length===expected);
   const state=await snapshot();
   for(const el of state.elements){const n=el.customData?.bangNode;if(n)for(const src of n.sources)assert(Number(src.messageId.slice(1))<=i,'未来来源泄露')}
   if(i%4===0||i===34){checkpoints.push({messages:i,events:state.appliedEventIds.length,nodes:state.elements.filter(e=>e.customData?.bangNode).length});if(i===4){await click('#overview');await wait(300);await screenshot('first-batch.png')}}
  }
  const state=await snapshot();assert(state.appliedEventIds.length===9,'应为9批');assert(state.elements.filter(e=>e.customData?.bangNode).length===30,'节点数量不符');assert(state.elements.filter(e=>e.customData?.bangGroup).length===5,'区域不符');
  const groups=state.elements.filter(e=>e.customData?.bangGroup).map(e=>e.customData.bangGroup);
  assert(groups.find(g=>g.id==='evidence')?.relation==='sequence','证据未从散放转为时序');
  await click('#overview');await wait(300);await screenshot('full-replay.png');return checkpoints;
 });
 await record('技能CLI追加真实后续对话；浏览器局部更新；重试幂等；文字依据一起撤销',async()=>{
  const context=await cli('context');assert(context.appliedEventIds.length===9,'CLI未读到浏览器快照');
  const target=context.objects.find(o=>o.bangNode?.id==='goal-next');assert(target,'目标节点缺失');
  const before=await snapshot();const oldNode=target.bangNode;
  const payload={messages:[{id:'m035',role:'user',text:'接下来保留现有结论，只补充：我仍没有端到端耗时数据，不能把触发数下降直接称为加速。'},{id:'m036',role:'assistant',text:'将端到端收益标为待测，并保留四组映射的功能验证与触发数证据。'}],event:{id:'continuation-18',goal:'明确触发数与端到端收益的区别',changes:{upsertNodes:[{...oldNode,text:'理解与建模\n端到端收益仍待测',explanation:oldNode.explanation+'\n\n后续讨论：触发数下降与端到端时间是不同指标，当前仍缺后者，不能推导加速。',sources:[...oldNode.sources,{messageId:'m035'}]}]}}};
  const submission=path.join(evidence,'continuation.json');await fs.writeFile(submission,JSON.stringify(payload));await cli('submit',submission);await until(async()=> (await snapshot()).appliedEventIds.includes('continuation-18'));
  const after=await snapshot(),node=after.elements.find(e=>e.id===oldNode.id);assert(node.customData.bangNode.explanation.includes('后续讨论'),'CLI提交未渲染');
  const unrelated=s=>s.elements.filter(e=>e.id!==oldNode.id&&e.containerId!==oldNode.id);
  assert(JSON.stringify(unrelated(before))===JSON.stringify(unrelated(after)),'无关区域被更改');
  await cli('submit',submission);assert((await cli('status')).eventIds.length===10,'重复提交不幂等');
  await click('#undo');await wait(100);assert((await snapshot()).elements.find(e=>e.id===oldNode.id).customData.bangNode.explanation===oldNode.explanation,'撤销未恢复依据');await click('#redo');
  return {messages:36,events:10,unrelated:'unchanged',undo:'text + explanation'};
 });
 await record('手改与后续增量形成建议；采用后保存刷新恢复',async()=>{
  await evaluate("window.bang.select('goal-next')");await wait(150);await evaluate("document.querySelector('#edit').focus();document.querySelector('#edit').select()");await cmd('Input.insertText',{text:'我的判断：先保留测量边界'});await click('#edit-save');await wait(600);
  const ctx=await cli('context'),node=ctx.objects.find(o=>o.id==='goal-next').bangNode;
  const payload={messages:[{id:'m037',role:'user',text:'新增问题：端到端测量应明确是否包含 CPU Runtime 的成本。'}],event:{id:'continuation-19',goal:'继续澄清测量边界',changes:{upsertNodes:[{...node,text:'端到端测量边界\nCPU Runtime 是否计入？',explanation:node.explanation+'\n\n新增疑问：端到端测量是否包含 CPU Runtime 成本仍需界定。',sources:[...node.sources,{messageId:'m037'}]}]}}};
  const file=path.join(evidence,'continuation-19.json');await fs.writeFile(file,JSON.stringify(payload));await cli('submit',file);await until(async()=> (await snapshot()).appliedEventIds.includes('continuation-19'));
  let state=await snapshot();assert(state.elements.find(e=>e.containerId==='goal-next').originalText==='我的判断：先保留测量边界','手改被覆盖');assert(state.elements.find(e=>e.id==='goal-next').customData.pendingNode,'新证据被丢弃');await click('#accept');await click('#save');await wait(200);
  const before=await snapshot();await cmd('Page.reload');await until(()=>evaluate('!!window.bang?.api'));await wait(600);const after=await snapshot();
  const sig=s=>s.elements.map(({id,x,y,customData,text})=>({id,x,y,customData,text}));await fs.writeFile(path.join(evidence,'restore-diff.json'),JSON.stringify({before:sig(before),after:sig(after)},null,2));for(const a of before.elements){const b=after.elements.find(b=>b.id===a.id);assert(b,'恢复缺少对象');assert(JSON.stringify(a.customData)===JSON.stringify(b.customData),'元数据未恢复');assert(a.text===b.text,'文字未恢复');const tolerance=a.type==='arrow'?1:0.001;assert(Math.abs(a.x-b.x)<=tolerance&&Math.abs(a.y-b.y)<=tolerance,'位置未恢复');}assert(after.appliedEventIds.length===11,'事件游标未恢复');return {manual:'preserved until accepted',events:11,refresh:'restored'};
 });
 await screenshot('continuation.png');
}catch(e){console.error(e.message);try{await screenshot('failure.png');console.error(await evaluate('document.body.innerText.slice(0,1000)'));console.error(await snapshot())}catch{};process.exitCode=1}
finally{
 await fs.writeFile(path.join(evidence,'results.json'),JSON.stringify({results,runtimeErrors,externalRequests:externalRequests.filter(u=>!u.startsWith(base))},null,2));console.log(JSON.stringify({results,runtimeErrors:runtimeErrors.length},null,2));if(runtimeErrors.length)process.exitCode=1;ws?.close();chrome.kill();
}
