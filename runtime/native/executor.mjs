import {dshConfiguration} from '../dsh/executor-config.mjs';
import {codexConfiguration} from '../codex/executor-config.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const active=new Set();
export const nativeActiveCount=()=>active.size;
export function nativeConfiguration(){
 if([process.env.BANG_ORGANIZER_NATIVE,process.env.BANG_ORGANIZER_CODEX,process.env.BANG_ORGANIZER_DSH].filter(Boolean).length>1)throw Object.assign(Error('Conflicting native executor configuration'),{code:'EXECUTOR_CONFIGURATION'});
 if(!process.env.BANG_ORGANIZER_NATIVE)return dshConfiguration()??codexConfiguration();
 try{const c=JSON.parse(process.env.BANG_ORGANIZER_NATIVE);
  if(c.version!==1||!path.isAbsolute(c.executable)||!fs.statSync(c.executable).isFile()||!Array.isArray(c.args)||c.args.some(a=>typeof a!=='string'||a.includes('\0'))||c.policy!=='no-tools'||!Number.isInteger(c.graceMs)||c.graceMs<10||c.graceMs>2000||Object.keys(c).some(k=>!['version','executable','args','policy','graceMs'].includes(k)))throw Error();
  if(/\.(cmd|bat|ps1)$/i.test(c.executable))throw Error();
  return c;
 }catch{throw Object.assign(Error('Invalid restricted native executor configuration'),{code:'EXECUTOR_CONFIGURATION'});}
}
export async function executeNative(task,project,signal){
 const config=nativeConfiguration(),directory=path.join(project,'.bang','runtime','workers',task.attemptId);
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const environment={BANG_EXECUTOR_POLICY:'no-tools',BANG_EXECUTOR_PROTOCOL:'1'};
 // Never inherit credentials, runtime capabilities, NODE_OPTIONS or tool paths.
 for(const k of ['SystemRoot','WINDIR','TEMP','TMP','LANG','LC_ALL'])if(process.env[k])environment[k]=process.env[k];
 if(config.inheritProxy)for(const k of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])if(process.env[k])environment[k]=process.env[k];
 environment.HOME=directory;environment.USERPROFILE=directory;environment.TMPDIR=directory;environment.TEMP=directory;environment.TMP=directory;
 const helper=fileURLToPath(new URL(process.platform==='win32'?'./process-host.exe':'./process-host',import.meta.url));
 const run=new Promise((resolve,reject)=>{
  const child=spawn(helper,[String(config.graceMs),String(task.timeoutMs),config.executable,...config.args],{cwd:directory,env:environment,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
  task.process={state:'running',exitConfirmed:false,policy:'no-tools',supervision:process.platform==='win32'?'windows-job':'linux-process-group'};
  let stdout=[],bytes=0,diagnostic='',overflow=false;
  const stop=()=>child.stdin.end();signal.addEventListener('abort',stop,{once:true});
  child.stdin.on('error',()=>{});
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes<=1048576)stdout.push(chunk);else{overflow=true;stop();}});
  child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk).slice(-512);});
  child.on('error',()=>reject(Object.assign(Error('Native executor unavailable'),{code:'EXECUTOR_UNAVAILABLE'})));
  child.on('close',code=>{
   signal.removeEventListener('abort',stop);
   const receipt=diagnostic.match(/\nBANG_PROCESS exited=1 forced=([01]) stopped=([01]) timeout=([01]) code=(\d+)\s*$/);
   task.process={...task.process,state:code===0&&receipt?'exited':'unconfirmed',exitConfirmed:code===0&&!!receipt,forced:receipt?.[1]==='1',exitCode:receipt?Number(receipt[4]):null};
   if(!task.process.exitConfirmed)return reject(Object.assign(Error('Native process exit unconfirmed'),{code:'PROCESS_EXIT_UNCONFIRMED'}));
   if(signal.aborted)return reject(Object.assign(Error('Native attempt cancelled'),{code:'CANCELLED'}));
   if(receipt[3]==='1')return reject(Object.assign(Error('Native attempt timed out'),{code:'ATTEMPT_TIMEOUT'}));
   if(overflow)return reject(Object.assign(Error('Native output exceeds limit'),{code:'OUTPUT_INVALID'}));
   if(task.process.exitCode!==0)return reject(Object.assign(Error('Native executor failed'),{code:'EXECUTOR_UNAVAILABLE'}));
   try{const result=JSON.parse(Buffer.concat(stdout).toString('utf8'));if(Object.keys(result).length===1&&result.error&&Object.keys(result.error).every(k=>['code','stage','reason'].includes(k))&&['AUTH_REQUIRED','EXECUTOR_BUDGET','EXECUTOR_CONFIGURATION','OUTPUT_INVALID','EXECUTOR_UNAVAILABLE'].includes(result.error.code)){if(['input','version','authorization','catalog','model'].includes(result.error.stage)&&['unknown','authentication','budget','sandbox','network','model','configuration'].includes(result.error.reason))task.process.executor={stage:result.error.stage,reason:result.error.reason};reject(Object.assign(Error('Restricted executor failed'),{code:result.error.code}));}else resolve(result);}catch{reject(Object.assign(Error('Invalid native result'),{code:'OUTPUT_INVALID'}));}
  });
  const payload=Buffer.from(JSON.stringify(task.input)+'\n');child.stdin.write(Buffer.from(String(payload.length)+'\n'));child.stdin.write(payload);if(signal.aborted)stop();
 });
 active.add(run);try{return await run;}finally{
  // Windows may briefly retain a process cwd handle after Job accounting reaches
  // zero. Cleanup must neither block the owner nor replace the attempt outcome.
  try{await fs.promises.rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:25});}catch{if(task.process)task.process.cleanup='retained';}
  active.delete(run);
 }
}
export async function waitNativeExit(){await Promise.allSettled([...active]);}
