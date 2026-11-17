import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {randomUUID,randomBytes,timingSafeEqual} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as store from '../canvas/store.mjs';
import {listTopics,createTopic,registerConnector,connectSession,enableBinding,bindingStatus,bindingSources} from '../canvas/binding.mjs';
const here=fileURLToPath(import.meta.url);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function location(project){const root=fs.realpathSync(project);for(const dir of [path.join(root,'.bang'),path.join(root,'.bang','runtime')]){try{if(fs.lstatSync(dir).isSymbolicLink())throw Error('Runtime path must not be a symbolic link');}catch(error){if(error.code!=='ENOENT')throw error;}}return path.join(root,'.bang','runtime');}
function privateDirectory(dir){
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 if(process.platform==='win32'){
  const identity=spawnSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});
  const sid=identity.stdout?.match(/S-1-5-[0-9-]+/)?.[0];if(!sid)throw Error('Cannot establish private runtime owner');
  const acl=spawnSync('icacls.exe',[dir,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`],{encoding:'utf8',windowsHide:true});
  if(acl.status!==0)throw Error('Cannot secure runtime permissions');
 }else fs.chmodSync(dir,0o700);
}
function metadata(dir){try{return JSON.parse(fs.readFileSync(path.join(dir,'connection.json'),'utf8'));}catch{return null;}}
async function request(connection,command,topic,input){
 const response=await fetch(connection.url+'/control',{method:'POST',headers:{'Content-Type':'application/json','x-bang-token':connection.token,'x-bang-epoch':connection.epoch},body:JSON.stringify({command,topic,input}),signal:AbortSignal.timeout(5000)});
 const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error||'Runtime request rejected'),{preview:result.preview,code:result.code});return result;
}
async function live(dir){const connection=metadata(dir);if(!connection)return null;try{await request(connection,'status');return connection;}catch{return null;}}
export async function ensureRuntime(project){
 const dir=location(project);if(!fs.existsSync(path.dirname(dir)))privateDirectory(path.dirname(dir));privateDirectory(dir);let connection=await live(dir);if(connection)return connection;
 const helper=fileURLToPath(new URL(process.platform==='win32'?'./lock-host.exe':'./lock-host',import.meta.url));
 if(!fs.existsSync(helper))throw Error('Native lock helper missing; install the prebuilt platform runtime');
 let failure,exitCode=null,signal=null,diagnostic='',child;
 const launch=()=>{
  exitCode=null;signal=null;diagnostic='';
  child=spawn(helper,[path.join(dir,'writer.lock'),process.execPath,here,'--daemon',fs.realpathSync(project)],{detached:true,stdio:['ignore','ignore','pipe'],windowsHide:true});
  child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk).slice(-2048);});
  child.on('error',error=>failure=Error(`Native runtime launch failed (code=${/^[A-Z0-9_]+$/.test(error.code)?error.code:'UNKNOWN'})`));
  child.on('close',(code,reason)=>{exitCode=code;signal=reason;});child.unref();child.stderr.unref();
 };
 const details=()=>{
  const record=diagnostic.match(/BANG_START stage=([a-z-]{1,32}) code=([A-Z0-9_]{1,32})/);
  return `exit=${exitCode??'none'}${signal?`; signal=${signal}`:''}${record?`; stage=${record[1]}; code=${record[2]}`:''}`;
 };
 launch();
 for(let i=0;i<100;i++){if(failure)throw failure;connection=await live(dir);if(connection)return connection;if(exitCode===73&&i%5===0)launch();else if((exitCode!==null&&exitCode!==73)||signal)throw Error(`Native runtime startup failed (${details()})`);await delay(50);}
 throw Error('Runtime unavailable: ownership is held or startup failed; no stale-lock takeover attempted');
}
export async function runtimeOperation(project,command,topic,input){
 const dir=location(project);
 if(command==='stop'){
  const connection=await live(dir);if(!connection)return {status:'stopped'};
  const result=await request(connection,'stop');for(let i=0;i<100;i++){if(!await live(dir)){await delay(150);return result;}await delay(50);}throw Error('Runtime stop not confirmed');
 }
 if(command==='status'){const connection=await live(dir);return connection?request(connection,'status'):{status:'unavailable',ownership:'unknown'};}
 const connection=await ensureRuntime(project);return request(connection,command==='start'?'status':command,topic,input);
}
// Only the native owner publishes these files. Retry the atomic replacement,
// never remove the destination or release ownership to recover sharing conflicts.
async function publishMetadata(temporary,destination){
 const deadline=Date.now()+2000;
 for(;;){
  try{fs.renameSync(temporary,destination);return;}catch(error){
   if(process.platform!=='win32'||!['EPERM','EBUSY','EACCES'].includes(error.code)||Date.now()>=deadline)throw error;
   await delay(50);
  }
 }
}
let startupStage='owner-check';
async function daemon(project){
 if(process.env.BANG_NATIVE_LOCK_OWNER!==String(process.platform==='win32'?process.ppid:process.pid))throw Error('Daemon must be launched by the native lock owner');
 startupStage='identity-read';
 const dir=location(project),identityFile=path.join(dir,'workspace.json');
 let identity;try{identity=JSON.parse(fs.readFileSync(identityFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;identity={workspaceId:randomUUID(),epoch:0};}
 if(typeof identity.workspaceId!=='string'||!Number.isSafeInteger(identity.epoch)||identity.epoch<0)throw Error('Invalid workspace identity; recovery required');
 startupStage='identity-publish';
 identity.epoch++;const identityTemp=path.join(dir,'workspace.tmp');const identityFd=fs.openSync(identityTemp,'w',0o600);try{fs.writeFileSync(identityFd,JSON.stringify(identity));fs.fsyncSync(identityFd);}finally{fs.closeSync(identityFd);}await publishMetadata(identityTemp,identityFile);
 const connection={workspaceId:identity.workspaceId,instanceId:randomUUID(),epoch:String(identity.epoch),pid:process.pid,token:randomBytes(32).toString('hex')};
 const status=()=>({status:'running',ownership:'os-handle',workspaceId:connection.workspaceId,instanceId:connection.instanceId,epoch:connection.epoch,pid:process.pid,supervisorPid:process.ppid,url:connection.url});
 const methods={'export-canvas':store.exportCanvas,'import-preview':store.previewImport,'import-canvas':store.importCanvas,'recovery-status':store.readRecoveryStatus,recover:store.recoverBoard,undo:store.undoBoard,history:store.readHistory,'history-preview':store.previewHistory,'history-diff':store.diffHistory,generate:store.generateBoard,read:store.readBoard,state:store.readCommitted,commit:store.commitBoard,preview:store.previewBoard,head:store.readHead,'resource-status':(project,topic,input)=>store.readResourceStatus(project,topic,input.id)};
 let stopping=false,operationQueue=Promise.resolve();
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  try{
   const supplied=Buffer.from(String(req.headers['x-bang-token']||'')),expected=Buffer.from(connection.token);
   if(req.headers.host!==new URL(connection.url).host||(req.headers.origin&&req.headers.origin!==connection.url)||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)||req.headers['x-bang-epoch']!==connection.epoch){res.statusCode=403;res.end(JSON.stringify({error:'Runtime capability, Host, Origin or epoch rejected'}));return;}
   if(req.method!=='POST'||req.url!=='/control'||!req.headers['content-type']?.startsWith('application/json')){res.statusCode=400;res.end(JSON.stringify({error:'JSON control request required'}));return;}
   req.setEncoding('utf8');let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>1024*1024)throw Error('Request too large');}
   const {command,topic,input}=JSON.parse(body);
   // One owner queue covers board publication and binding/default creation.
   // No metadata transaction is held across an asynchronous board operation.
   const execute=async()=>{let result;
   if(stopping)throw Error('Runtime stopping');
   if(command==='status')result=status();
   else if(command==='stop'){stopping=true;result={status:'stopped'};}
   else if(command==='topics')result=listTopics(project);
   else if(command==='topic-create')result=await createTopic(project,input);
   else if(command==='connector-register')result=registerConnector(project,input);
   else if(command==='session-connect')result=connectSession(project,connection.workspaceId,input);
   else if(command==='binding-enable')result=await enableBinding(project,input,connection.epoch);
   else if(command==='binding-status')result=bindingStatus(project,input);
   else if(command==='binding-sources')result=bindingSources(project,input);
   else {if(stopping)throw Error('Runtime stopping');const method=methods[command];if(!Object.hasOwn(methods,command))throw Error('Unknown runtime operation');result=await method(project,topic,input);}
   return result;};
   const pending=operationQueue.then(execute);operationQueue=pending.catch(()=>{});
   const result=await pending;
   res.end(JSON.stringify(result));if(stopping){server.close(()=>process.exit(0));server.closeIdleConnections();}
  }catch(error){res.statusCode=400;res.end(JSON.stringify({error:error.message,preview:error.preview,code:error.code}));}
 });
 startupStage='listen';
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});connection.url=`http://127.0.0.1:${server.address().port}`;
 startupStage='discovery-publish';
 const temporary=path.join(dir,'connection.tmp');fs.writeFileSync(temporary,JSON.stringify(connection),{mode:0o600});startupStage='discovery-replace';await publishMetadata(temporary,path.join(dir,'connection.json'));
}
if(process.argv[1]&&path.resolve(process.argv[1])===here&&process.argv[2]==='--daemon'){
 try{await daemon(process.argv[3]);}catch(error){
  const code=/^[A-Z0-9_]{1,32}$/.test(error.code)?error.code:error instanceof SyntaxError?'INVALID_JSON':'STARTUP_ERROR';
  process.stderr.write(`BANG_START stage=${startupStage} code=${code}\n`,()=>process.exit(1));
 }
}





