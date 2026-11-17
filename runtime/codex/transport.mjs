import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {CODEX_VERSION} from './connector.mjs';

// A separate read-only client of the public persisted-history API. This does
// not attach to a running desktop turn and never starts/resumes a thread.
export async function openCodexStoredTransport({executable=process.env.CODEX_APP_RUNTIME_CLI_PATH,threadId}){
 if(!executable||!path.isAbsolute(executable)||typeof threadId!=='string'||!threadId)throw Error('Codex exact executable and thread identity required');
 let version;
 try{version=(await promisify(execFile)(executable,['--version'],{timeout:10000,windowsHide:true,maxBuffer:65536})).stdout.trim();}catch{throw Error('Codex executable unavailable');}
 if(version!==`codex-cli ${CODEX_VERSION}`)throw Error('Codex unsupported executable version');
 const child=spawn(executable,['app-server','--stdio'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 let sequence=0,buffer='',closed=false;const pending=new Map();
 const terminate=()=>{if(!closed){closed=true;child.stdin.end();const timer=setTimeout(()=>child.kill(),1500);timer.unref();child.once('close',()=>clearTimeout(timer));}for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(Error('Codex read channel closed'));}pending.clear();};
 child.stderr.resume();child.stdin.on('error',terminate);child.on('error',terminate);child.on('close',terminate);
 child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
  buffer+=chunk;if(Buffer.byteLength(buffer)>16*1024*1024){terminate();return;}
  for(;;){const end=buffer.indexOf('\n');if(end<0)break;const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let message;try{message=JSON.parse(line);}catch{terminate();return;}
   const waiter=pending.get(message.id);if(!waiter)continue;pending.delete(message.id);clearTimeout(waiter.timer);
   if(message.error)waiter.reject(Error(`Codex public read rejected (code ${Number.isInteger(message.error.code)?message.error.code:'unknown'})`));else if(waiter.method==='thread/read'){const t=message.result?.thread;waiter.resolve({thread:t?Object.fromEntries(['id','sessionId','parentThreadId','source','cwd','cliVersion','historyMode'].map(k=>[k,t[k]])):null});}else waiter.resolve(message.result);
  }
 });
 const rpc=(method,params)=>new Promise((resolve,reject)=>{
  if(closed){reject(Error('Codex read channel closed'));return;}
  const id=++sequence,timer=setTimeout(()=>{terminate();},10000);
  pending.set(id,{resolve,reject,timer,method});child.stdin.write(JSON.stringify({id,method,params})+'\n');
 });
 try{
  const initialized=await rpc('initialize',{clientInfo:{name:'bang-stored-session-reader',version:'0.1'},capabilities:null});
  if(typeof initialized.userAgent!=='string'||!initialized.userAgent.includes(`/${CODEX_VERSION} `))throw Error('Codex server version mismatch');
  child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 }catch(error){terminate();throw error;}
 return {version:CODEX_VERSION,close:terminate,async request(method,params){
  if(!['thread/read','thread/turns/list','thread/items/list'].includes(method)||params.threadId!==threadId)throw Error('Codex read outside authorized session');
  if(method==='thread/read'&&params.includeTurns!==false)throw Error('Codex full-history read prohibited');
  if(method==='thread/turns/list'&&params.itemsView!=='notLoaded')throw Error('Codex turn metadata only');
  if(method==='thread/items/list'&&!params.turnId)throw Error('Codex exact turn required');
  return rpc(method,params);
 }};
}
