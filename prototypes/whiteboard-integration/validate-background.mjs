import {promisify} from 'node:util';
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),evidence=path.join(root,'evidence','background-view');
await fs.mkdir(evidence,{recursive:true});
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-sandbox','--disable-extensions','--hide-scrollbars','--remote-debugging-port=9343',`--user-data-dir=${path.join(evidence,'chrome-profile')}`,'--window-size=1440,960','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let ws,nextId=0;const pending=new Map(),runtimeErrors=[],externalRequests=[];
async function connect(){let targets;for(let i=0;i<60;i++){try{targets=await(await fetch('http://127.0.0.1:9343/json/list')).json();if(targets.some(t=>t.type==='page'))break}catch{}await wait(150)}const target=targets?.find(t=>t.type==='page');if(!target)throw Error('没有 Chrome page target');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej});ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}}if(m.method==='Runtime.exceptionThrown')runtimeErrors.push(m.params.exceptionDetails);if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))externalRequests.push(m.params.request.url)}}
function cmd(method,params={}){return new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){const r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
async function click(selector){const r=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await cmd('Input.dispatchMouseEvent',{type:'mousePressed',...r,button:'left',buttons:1,clickCount:1});await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',...r,button:'left',buttons:0,clickCount:1});await wait(120)}
const {createCompanionView}=await import('../../runtime/companion/whiteboard.mjs');
const base='http://127.0.0.1:5180',topic='companion-validation';
const actual=await(await fetch(base+'/api/bang/session?topic='+topic)).json();
if(actual.mode!=='companion')throw Error('real topic API missing');
const workspace=path.join(evidence,'workspace'),dir=path.join(workspace,'.bang/topics',topic);
await fs.mkdir(dir,{recursive:true});
for(const name of ['state.json','updates.jsonl','sources.jsonl'])await fs.copyFile(path.resolve(root,'../../.bang/topics',topic,name),path.join(dir,name));
// Only the isolated view is overwritten, never the user's view or semantic data.
await fs.writeFile(path.join(dir,'view.json'),'null');
const view=createCompanionView({projectRoot:workspace,topic});
const initial=await view.read(),results=[];
function assert(v,m){if(!v)throw Error(m)}
async function until(fn){for(let i=0;i<150;i++){try{if(await fn())return}catch{}await wait(200)}throw Error('timeout')}
async function capture(name){const r=await cmd('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(evidence,name),Buffer.from(r.data,'base64'))}
try{
 await connect();await cmd('Page.enable');await cmd('Runtime.enable');await cmd('Network.enable');
 const original=ws.onmessage;ws.onmessage=async ev=>{original(ev);const m=JSON.parse(ev.data);if(m.method!=='Fetch.requestPaused')return;const {requestId,request:r}=m.params;try{const response=new URL(r.url).pathname.endsWith('/scene')?await view.saveScene(JSON.parse(r.postData)):await view.read();await cmd('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json; charset=utf-8'}],body:Buffer.from(JSON.stringify(response)).toString('base64')})}catch(e){console.error(e)}};
 await cmd('Fetch.enable',{patterns:[{urlPattern:'*/api/bang/*'}]});await cmd('Emulation.setDeviceMetricsOverride',{width:1700,height:1050,deviceScaleFactor:1,mobile:false});await cmd('Page.navigate',{url:base+'/?topic='+topic});
 await until(()=>evaluate(`window.bang?.snapshot().appliedEventIds.length===${initial.events.length}`));await wait(800);
 const count=await evaluate('bang.api.getSceneElements().filter(e=>e.customData?.bangNode).length');assert(count>0,'no nodes');assert(!await evaluate("!!document.querySelector('#restart')"),'replay controls leaked');await capture('actual-background.png');results.push({name:'真实后台产物经专题API显示',pass:true,revision:initial.revision,nodes:count});
 const nodes=await evaluate('bang.api.getSceneElements().filter(e=>e.customData?.bangNode).map(e=>e.customData.bangNode)');
 const target=nodes[0],deleted=nodes[1],untouched=nodes[2];
 // An independent copy receives one committed revision, just like the worker.
 const before=await evaluate(`(()=>{const a=bang.api,e=a.getSceneElements().find(e=>e.id===${JSON.stringify(untouched.id)});a.updateScene({elements:a.getSceneElements().map(n=>n.id===e.id?{...n,x:n.x+47,y:n.y+29,version:n.version+1,versionNonce:1111}:n)});return {x:e.x+47,y:e.y+29}})()`);await wait(800);
 const viewport=await evaluate('(()=>{const a=bang.api.getAppState();return [a.scrollX,a.scrollY,a.zoom.value]})()');
 const history=(await fs.readFile(path.join(dir,'updates.jsonl'),'utf8')).trim().split('\n').map(JSON.parse),relations=new Map();for(const r of history){for(const e of r.event.upsertRelations)relations.set(e.id,e);for(const id of r.event.removeRelationIds)relations.delete(id)}
 const event={goal:'验证否定原结论',upsertGroups:[],upsertNodes:[{...target,text:'原判断不成立',status:'rejected',sourceIds:target.sources.map(s=>s.messageId)}],upsertRelations:[],removeNodeIds:[deleted.id],removeRelationIds:[...relations.values()].filter(e=>e.from===deleted.id||e.to===deleted.id).map(e=>e.id)};
 const state=JSON.parse(await fs.readFile(path.join(dir,'state.json'),'utf8'));const revision=state.revision+1;
 await fs.appendFile(path.join(dir,'updates.jsonl'),JSON.stringify({turnId:'isolated-next',revision,event})+'\n');await fs.writeFile(path.join(dir,'state.json'),JSON.stringify({...state,revision}));
 await until(()=>evaluate(`bang.snapshot().appliedEventIds.length===${initial.events.length+1}`));
 const observed=await evaluate(`(()=>{const a=bang.api,els=a.getSceneElements(),n=els.find(e=>e.id===${JSON.stringify(target.id)}),u=els.find(e=>e.id===${JSON.stringify(untouched.id)}),s=a.getAppState();return {text:n.customData.bangNode.text,deleted:!els.some(e=>e.id===${JSON.stringify(deleted.id)}),x:u.x,y:u.y,viewport:[s.scrollX,s.scrollY,s.zoom.value]}})()`);
 assert(observed.text==='✕ 原判断不成立'&&observed.deleted,'in-place rejection/remove failed');assert(observed.x===before.x&&observed.y===before.y,'manual layout moved');assert(JSON.stringify(observed.viewport)===JSON.stringify(viewport),'viewport changed');results.push({name:'隔离副本新revision自动刷新、原位否定/删除、布局视角保留',pass:true});
 await click('#undo');assert(await evaluate(`bang.api.getSceneElements().some(e=>e.id===${JSON.stringify(deleted.id)})`),'undo deletion failed');await click('#redo');await evaluate('bang.persist()');await cmd('Page.reload');await until(()=>evaluate(`window.bang?.snapshot().appliedEventIds.length===${initial.events.length+1}`));assert(await evaluate(`bang.api.getSceneElements().find(e=>e.id===${JSON.stringify(target.id)}).customData.bangNode.text==='✕ 原判断不成立'`),'restore failed');results.push({name:'更新撤销/重做与刷新恢复',pass:true});await capture('updated-background.png');
 assert(runtimeErrors.length===0,'runtime errors');await fs.writeFile(path.join(evidence,'results.json'),JSON.stringify({results,runtimeErrors,scope:'当前后台产物副本；API写入均隔离，不改PIM或真实专题'},null,2));console.log(JSON.stringify({results,runtimeErrors},null,2));
}finally{ws?.close();chrome.kill()}
