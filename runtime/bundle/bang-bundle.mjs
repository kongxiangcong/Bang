#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {read,atomic,identity,alive,snapshot,empty,log,key} from './storage.mjs';
import {locked} from './locks.mjs';
import {discover,accepted,inspect} from './transcript.mjs';
import {step,topicDir} from './engine.mjs';
import {preflight} from './model.mjs';
import {defaults,limits,lookup} from './context.mjs';
import {migrate} from './migrate.mjs';
import {assertFrontend} from './prerequisites.mjs';
import {runtimeEnv} from './runtime-paths.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const [command='up',...args]=process.argv.slice(2);
const arg=(name,fallback)=>{const n=args.indexOf(name);if(n<0)return fallback;if(!args[n+1]||args[n+1].startsWith('--'))throw Error('缺少参数 '+name);return args[n+1]};
const workspace=await fs.realpath(arg('--workspace',process.cwd())),home=path.join(workspace,'.bang'),configPath=path.join(home,'bundle.json');
const control=fn=>locked(path.join(home,'control.lock'),fn);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function launch(kind){
 const owner=await read(path.join(home,kind+'.json'),null);if(await alive(owner))return;if(kind==='server')await atomic(path.join(home,'server-failure.json'),null);
 const handle=await fs.open(path.join(home,kind+'.log'),'a',0o600);
 const script=kind==='worker'?fileURLToPath(import.meta.url):path.join(here,'server.mjs');
 const argv=kind==='worker'?['watch','--workspace',workspace]:[home];
 const child=spawn('flock',['-n','-F',path.join(home,kind+'.lock2'),process.execPath,script,...argv],{cwd:home,env:await runtimeEnv(home),detached:true,stdio:['ignore',handle.fd,handle.fd]});child.unref();await handle.close();
}
async function serviceReady(){const s=await read(path.join(home,'server.json'),null);if(!await alive(s))return false;try{const r=await fetch(`http://127.0.0.1:${s.port}/api/bang/health`,{signal:AbortSignal.timeout(2000)});return r.ok&&(await r.json()).workspace===workspace}catch{return false}}
async function start(){
 await assertFrontend();
 await fs.mkdir(home,{recursive:true});await launch('server');await launch('worker');
 for(let i=0;i<80;i++){
  if(await serviceReady()&&await alive(await read(path.join(home,'worker.json'),null))){await wait(150);if(await serviceReady()&&await alive(await read(path.join(home,'worker.json'),null)))return;}
  const error=await read(path.join(home,'failure.json'),null)??await read(path.join(home,'server-failure.json'),null);if(error)throw Error(`${error.stage}: ${error.message}`);
  if(i>0&&i%10===0){await launch('server');await launch('worker')}
  await wait(150);
 }
 throw Error('服务启动超时；见 .bang/server.log 与 .bang/worker.log');
}
async function status(){
 const c=await read(configPath,null);if(!c)return {initialized:false};const s=await snapshot(topicDir(home,c)),worker=await read(path.join(home,'worker.json'),null),server=await read(path.join(home,'server.json'),null);
 return {initialized:true,workspace,topic:c.topic,boundChatId:c.binding.chatId,currentHostChatId:process.env.CODEX_THREAD_ID??process.env.CODEX_SESSION_ID??null,boundToCurrentHost:c.binding.chatId===(process.env.CODEX_THREAD_ID??process.env.CODEX_SESSION_ID),enabled:c.enabled,workerRunning:await alive(worker),whiteboardAccessible:await serviceReady(),whiteboardUrl:server?.url??null,revision:s.revision,lastSuccessfulRound:s.round?{chatId:s.round.chatId,turnId:s.round.turnId,completedAt:s.round.completedAt}:null,completedRoundCommitted:!!s.round,verificationNote:'revision 仅证明所绑定 transcript 的完成轮已提交；真实宿主来源及启用后新轮需独立核验，不能由进程状态推断。',lastBindingTransition:c.bindings.at(-1)??null,pendingSwitch:c.pendingSwitch?{targetChatId:c.pendingSwitch.target.chatId,acceptedOldTurns:c.pendingSwitch.rounds.map(r=>r.turnId),excludedIncompleteTurnId:c.pendingSwitch.excludedIncompleteTurnId}:null,failure:await read(path.join(home,'failure.json'),null)??await read(path.join(home,'server-failure.json'),null),handoff:s.memory};
}
async function up(){
 // Verify target, invocation boundary, CLI and frontend before mutating binding.
 const target=await discover({chatId:arg('--chat'),transcript:arg('--transcript'),turnId:arg('--turn')});
 let previous=await read(configPath,null);let executable=arg('--codex',previous?.executable??process.env.BANG_CODEX??'codex');if(executable.includes('/'))executable=path.resolve(executable);await assertFrontend();const disabledFeatures=await preflight(executable,home);
 await fs.mkdir(home,{recursive:true,mode:0o700});
 await control(async()=>{
  let c=await read(configPath,null);const legacy=await read(path.join(home,'companion.json'),null);
  if(!c){
   if(legacy)await migrate(home,legacy);
   const oldState=legacy?await read(path.join(home,'topics',legacy.topic,'state.json')):null;
   c={schema:2,workspace,topic:legacy?.topic??'discussion',enabled:true,serverEnabled:true,executable,model:arg('--model',process.env.BANG_MODEL),disabledFeatures,budget:{...defaults},pollMs:1000,binding:legacy?{chatId:legacy.chatId,transcript:legacy.transcript,ignored:(oldState.ignoredTurnIds??[]).map(id=>key(legacy.chatId+'\0'+id)),startTurnId:null,boundAt:legacy.initializedAt}:target,bindings:legacy?[]:[{from:null,to:target,switchedAt:target.boundAt,acceptedOldTurnIds:[],excludedIncompleteTurnId:null}],pendingSwitch:null};
   await fs.mkdir(topicDir(home,c),{recursive:true});
  }
  if(c.pendingSwitch&&c.pendingSwitch.target.chatId!==target.chatId)throw Error('已有待完成的会话切换；先恢复或查看 status，不覆盖切换队列');
  if(c.binding.chatId!==target.chatId&&!c.pendingSwitch){const old=await inspect(c.binding);const ignored=new Set(c.binding.ignored);const rounds=old.completed.filter(r=>!ignored.has(r.id));c.pendingSwitch={target,rounds,excludedIncompleteTurnId:old.activeTurnId,requestedAt:new Date().toISOString()};}
  if(c.binding.chatId===target.chatId&&c.binding.transcript!==target.transcript)throw Error('同一会话 transcript 路径变化，拒绝静默替换');
  c.enabled=true;c.serverEnabled=true;c.executable=executable;c.disabledFeatures=disabledFeatures;if(arg('--model'))c.model=arg('--model');limits(c);await atomic(configPath,c);await atomic(path.join(home,'failure.json'),null);await log(home,'up',{requestedChatId:target.chatId,boundChatId:c.binding.chatId,pendingSwitch:!!c.pendingSwitch});
 });
 await start();
 // A long model call does not block skill invocation. The persistent transition
 // finishes in the worker, and the returned status explicitly says pending.
 for(let i=0;i<30;i++){const c=await read(configPath);if(!c.pendingSwitch)break;await wait(100)}
 const result=await status();return {...result,notice:'记录保存在本地；本轮问答、活动白板、摘要及按需回查片段会发送给配置的模型服务。没有复制凭据或修改全局模型配置。'};
}
async function watch(){
 await atomic(path.join(home,'worker.json'),await identity());let stopping=false;process.on('SIGTERM',()=>{stopping=true});process.on('SIGINT',()=>{stopping=true});
 try{while(!stopping){const outcome=await step(home,control);if(outcome==='paused')break;if(outcome==='idle')await wait((await read(configPath)).pollMs)}}catch(e){await atomic(path.join(home,'failure.json'),{at:new Date().toISOString(),stage:'worker',message:e.message});await log(home,'error',{message:e.message});throw e;}
}
try{
 let result;
 if(command==='up')result=await up();
 else if(command==='status')result=await status();
 else if(command==='watch'){
  // Internal entry must hold the flock opened by launch. Avoid a user bypass.
  const fds=await fs.readdir('/proc/self/fd');let owns=false;for(const fd of fds){try{if(await fs.readlink('/proc/self/fd/'+fd)===path.join(home,'worker.lock2'))owns=true}catch{}}
  if(!owns)throw Error('watch 是内部入口；使用 up 或 resume 获取进程锁');await watch();
 }
 else if(['pause','stop','resume'].includes(command)){
  if(command==='resume')await assertFrontend();
  await control(async()=>{const c=await read(configPath);c.enabled=command==='resume';if(command==='stop')c.serverEnabled=false;if(command==='resume')c.serverEnabled=true;await atomic(configPath,c);if(command==='resume')await atomic(path.join(home,'failure.json'),null)});
  if(command==='resume')await start();result=await status();
 }
 else if(command==='history'){
  const c=await read(configPath),dir=topicDir(home,c);result=args.includes('--index')?(await snapshot(dir)).archives:await lookup(dir,{sourceIds:args.flatMap((v,i)=>v==='--source'?[args[i+1]]:[]),archiveIds:args.flatMap((v,i)=>v==='--archive'?[args[i+1]]:[])},limits(c).historyBytes);
 }
 else throw Error('命令：up / status / pause / resume / stop / history');
 if(result)console.log(JSON.stringify(result,null,2));
}catch(e){console.error(JSON.stringify({ok:false,stage:command,error:e.message,dataPreserved:true}));process.exitCode=1}
