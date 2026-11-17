import fs from 'node:fs';
import path from 'node:path';
import {createPrivateKey} from 'node:crypto';
import {CodexSessionConnector} from './connector.mjs';
import {openCodexStoredTransport} from './transport.mjs';

const statuses=new Map();
export function codexWatchStatus(project){return statuses.get(project)??{status:'idle'};}
const file=(project,name)=>path.join(project,'.bang','runtime',name);
function read(project,name){const target=file(project,name);if(fs.lstatSync(target).isSymbolicLink())throw Error('Codex configuration symlink rejected');return JSON.parse(fs.readFileSync(target,'utf8'));}
function save(project,value){const target=file(project,'codex-watch.json'),temp=file(project,'codex-watch.tmp');fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600});fs.renameSync(temp,target);}
export function configureCodexWatch(project,input){
 if(typeof input?.topicId!=='string'||typeof input.sourceId!=='string')throw Error('Codex exact binding required');
 read(project,'codex-install.json');
 let state={sources:[]};try{state=read(project,'codex-watch.json');}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!state.sources.some(x=>x.sourceId===input.sourceId))state.sources.push({topicId:input.topicId,sourceId:input.sourceId});
 if(state.sources.length>100)throw Error('Codex watch capacity reached');save(project,state);return {status:'watching'};
}
export function startCodexWatch(project,runtimeCall){
 let stopped=false,running=false,transport;
 const tick=async()=>{
  if(stopped||running)return;running=true;
  try{
   let state;try{state=read(project,'codex-watch.json');}catch(e){if(e.code==='ENOENT')return;throw e;}
   const install=read(project,'codex-install.json');
   for(const entry of state.sources){
    if(stopped)break;
    const sources=await runtimeCall('binding-sources',{topicId:entry.topicId}),source=sources.find(s=>s.id===entry.sourceId);
    if(!source?.active||source.instanceId!==install.instanceId)continue;
    if(source.receptionStopped&&!source.resumeRequested){statuses.set(project,{status:'reception-stopped',sourceId:entry.sourceId});continue;}
    try{
     transport=await openCodexStoredTransport({executable:install.executable,threadId:source.sessionId});
     if(stopped){transport.close();break;}
     const connector=new CodexSessionConnector({project,transport,connectorId:install.connectorId,privateKey:createPrivateKey(install.privateKey),instanceId:install.instanceId,runtimeCall});
     const result=await connector.poll(entry.topicId,entry.sourceId);statuses.set(project,{...result,topicId:entry.topicId,sourceId:entry.sourceId});
    }catch{statuses.set(project,{status:'unavailable',reason:'source-read-failed',sourceId:entry.sourceId});}
    finally{transport?.close();transport=null;}
   }
  }finally{running=false;}
 };
 const timer=setInterval(()=>{void tick().catch(()=>{});},10000);timer.unref();
 return ()=>{stopped=true;clearInterval(timer);transport?.close();};
}
