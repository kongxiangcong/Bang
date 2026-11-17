import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../runtime/canvas/bang.mjs',import.meta.url));
function run(p,c,input){const r=spawnSync(process.execPath,[cli,c,'--project',p,'--topic','demo'],{input:JSON.stringify(input),encoding:'utf8',timeout:15000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
test('project daemon reuses ownership across CLI launches and survives independent clients',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'Bang 中文 空格 '));
 try{const a=run(p,'start'),b=run(p,'start');assert.equal(a.instanceId,b.instanceId);assert.equal(a.workspaceId,b.workspaceId);assert.equal(a.epoch,b.epoch);run(p,'generate',{cards:[]});assert.deepEqual(run(p,'read').nodes,[]);run(p,'stop');const c=run(p,'start');assert.equal(c.workspaceId,a.workspaceId);assert.notEqual(c.epoch,a.epoch);assert.deepEqual(run(p,'read').nodes,[]);}
 finally{try{run(p,'stop');}finally{await fs.rm(p,{recursive:true,force:true});}}
});

test('browser proxy rejects missing capability, forged Host and foreign Origin before reading board',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-proxy-'));let server;
 try{run(p,'generate',{cards:[]});const {createServer}=await import('node:http');const {createCanvasMiddleware}=await import('../runtime/canvas/http.mjs');server=createServer(createCanvasMiddleware({project:p}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(base+'/api/canvas/demo/state')).status,403);
 const {token}=await (await fetch(base+'/api/canvas/session/bootstrap')).json();assert.equal(typeof token,'string');
 const sessionTopic=spawnSync(process.execPath,[cli,'generate','--project',p,'--topic','session'],{input:JSON.stringify({cards:[]}),encoding:'utf8'});assert.equal(sessionTopic.status,0,sessionTopic.stderr);assert.deepEqual(await (await fetch(base+'/api/canvas/session',{headers:{'x-bang-browser-token':token}})).json(),{nodes:[],edges:[]});
 assert.equal((await fetch(base+'/api/canvas/demo/state',{headers:{'x-bang-browser-token':token}})).status,200);
 for(const headers of [{Origin:'http://evil.invalid'},{Host:'evil.invalid'},{'Sec-Fetch-Site':'cross-site'}])assert.equal(await new Promise((resolve,reject)=>{http.get(base+'/api/canvas/session/bootstrap',{headers},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);}),403,JSON.stringify(headers));
 }finally{if(server)await new Promise(r=>server.close(r));run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});



test('different projects isolate writes and capabilities; daemon loss releases ownership with a fresh epoch',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-owner-')),q=await fs.mkdtemp(path.join(os.tmpdir(),'bang-other-'));
 try{
  const a=run(p,'start'),b=run(q,'start');assert.notEqual(a.workspaceId,b.workspaceId);assert.notEqual(a.url,b.url);
  run(p,'generate',{cards:[{id:'one',text:'只属于甲',x:0,y:0,width:100,height:100}]});run(q,'generate',{cards:[]});assert.deepEqual(run(q,'read').nodes,[]);
  const connection=JSON.parse(await fs.readFile(path.join(p,'.bang/runtime/connection.json'),'utf8'));
  const control=(url,headers)=>fetch(url+'/control',{method:'POST',headers:{'content-type':'application/json','x-bang-token':connection.token,'x-bang-epoch':connection.epoch,...headers},body:JSON.stringify({command:'status'})});
  assert.equal((await control(b.url)).status,403);assert.equal((await control(a.url,{'x-bang-epoch':'stale'})).status,403);assert.equal((await control(a.url,{Origin:'http://evil.invalid'})).status,403);
  process.kill(a.pid);const c=run(p,'start');assert.notEqual(c.epoch,a.epoch);assert.equal(c.workspaceId,a.workspaceId);assert.equal(run(p,'read').nodes[0].text,'只属于甲');
  if(process.platform==='win32'){process.kill(c.supervisorPid);const d=run(p,'start');assert.notEqual(d.epoch,c.epoch);assert.equal(run(p,'read').nodes[0].text,'只属于甲');}
 }finally{run(p,'stop');run(q,'stop');await fs.rm(p,{recursive:true,force:true});await fs.rm(q,{recursive:true,force:true});}
});

test('stale discovery does not steal a live OS lock',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-stale-'));let original;
 try{const a=run(p,'start'),file=path.join(p,'.bang/runtime/connection.json');original=await fs.readFile(file,'utf8');const stale=JSON.parse(original);stale.pid=99999999;stale.url='http://127.0.0.1:1';await fs.writeFile(file,JSON.stringify(stale));
 const refused=spawnSync(process.execPath,[cli,'start','--project',p],{encoding:'utf8',timeout:15000});assert.notEqual(refused.status,0);assert.match(refused.stderr,/ownership|takeover/);
 await fs.writeFile(file,original);assert.equal(run(p,'start').instanceId,a.instanceId);
 }finally{if(original)await fs.writeFile(path.join(p,'.bang/runtime/connection.json'),original);run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});

test('helper death closes an in-flight client before a new owner can commit',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-inflight-'));
 try{run(p,'generate',{cards:[]});const owner=run(p,'start'),connection=JSON.parse(await fs.readFile(path.join(p,'.bang/runtime/connection.json'),'utf8'));
 const patch={operationId:'after-crash',topic:'demo',baseRevision:0,author:{kind:'manual',id:'test'},readDependencies:[],intent:'explicit-save',operations:[{type:'create-card',card:{id:'safe',text:'恢复后保存',x:0,y:0,width:100,height:100}}]};
 const partial=http.request(owner.url+'/control',{method:'POST',headers:{'content-type':'application/json','x-bang-token':connection.token,'x-bang-epoch':connection.epoch}});const closed=new Promise(resolve=>{partial.on('error',resolve);partial.on('response',r=>{r.resume();resolve();});});partial.write('{"command":"commit","topic":"demo","input":');await new Promise(r=>setTimeout(r,100));process.kill(process.platform==='win32'?owner.supervisorPid:owner.pid);await closed;
 const next=run(p,'start');assert.notEqual(next.epoch,owner.epoch);assert.equal(run(p,'commit',patch).revision,1);assert.equal(run(p,'state').canvas.nodes[0].text,'恢复后保存');
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});

test('read-only installation keeps runtime state in the private project directory',{skip:process.platform!=='win32'},async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'bang-readonly-')),install=path.join(temp,'只读 安装'),project=path.join(temp,'项目 数据');await fs.mkdir(install);await fs.mkdir(project);
 const sid=spawnSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8'}).stdout.match(/S-1-5-[0-9-]+/)[0];
 try{await fs.cp(new URL('../runtime/',import.meta.url),path.join(install,'runtime'),{recursive:true});const acl=spawnSync('icacls.exe',[install,'/deny',`*${sid}:(OI)(CI)(WD,AD,WEA,WA)`],{encoding:'utf8'});assert.equal(acl.status,0,acl.stderr);
 const installedCli=path.join(install,'runtime/canvas/bang.mjs');const generated=spawnSync(process.execPath,[installedCli,'generate','--project',project,'--topic','demo'],{input:JSON.stringify({cards:[]}),encoding:'utf8',timeout:15000});assert.equal(generated.status,0,generated.stderr);assert.deepEqual(run(project,'read').nodes,[]);
 const permissions=spawnSync('icacls.exe',[path.join(project,'.bang/runtime')],{encoding:'utf8'});assert.equal(permissions.status,0);assert.doesNotMatch(permissions.stdout,/\(I\)/);assert.equal((await fs.stat(path.join(project,'.bang/runtime/connection.json'))).isFile(),true);
 }finally{run(project,'stop');spawnSync('icacls.exe',[install,'/remove:d',`*${sid}`],{encoding:'utf8'});await fs.rm(temp,{recursive:true,force:true});}
});



test('simultaneous public starts converge on one native writer',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-race-'));
 try{const starts=await Promise.all(Array.from({length:6},()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,'start','--project',p],{windowsHide:true});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',code=>code===0?resolve(JSON.parse(out)):reject(Error(err)));const timeout=setTimeout(()=>{child.kill();reject(Error('start deadline'));},15000);child.on('close',()=>clearTimeout(timeout));})));
 assert.equal(new Set(starts.map(s=>s.instanceId)).size,1);assert.equal(new Set(starts.map(s=>s.epoch)).size,1);assert.equal(run(p,'status').instanceId,starts[0].instanceId);
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});



test('split UTF-8 request bodies retain exact Chinese text at both public HTTP boundaries',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-utf8-'));let server;
 async function splitRequest(url,headers,value){const body=Buffer.from(JSON.stringify(value)),offset=body.indexOf(Buffer.from('中文'))+1;assert.ok(offset>0);return new Promise((resolve,reject)=>{const request=http.request(url,{method:'POST',headers:{'content-type':'application/json',...headers}},response=>{let text='';response.setEncoding('utf8');response.on('data',b=>text+=b);response.on('end',()=>resolve({status:response.statusCode,data:JSON.parse(text)}));});request.on('error',reject);request.write(body.subarray(0,offset));setTimeout(()=>request.end(body.subarray(offset)),30);});}
 try{run(p,'generate',{cards:[]});const {createCanvasMiddleware}=await import('../runtime/canvas/http.mjs');server=http.createServer(createCanvasMiddleware({project:p}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,{token}=await (await fetch(base+'/api/canvas/session/bootstrap')).json();
 const patch={operationId:'utf8-first',topic:'demo',baseRevision:0,author:{kind:'manual',id:'test'},readDependencies:[],intent:'explicit-save',operations:[{type:'create-card',card:{id:'unicode',text:'中文第一版',x:0,y:0,width:100,height:100}}]};
 assert.equal((await splitRequest(base+'/api/canvas/demo/commit',{'x-bang-browser-token':token},patch)).status,200);assert.equal(run(p,'state').canvas.nodes[0].text,'中文第一版');
 const c=JSON.parse(await fs.readFile(path.join(p,'.bang/runtime/connection.json'),'utf8'));const next={...patch,operationId:'utf8-second',baseRevision:1,operations:[{type:'edit-card',id:'unicode',text:'中文第二版'}]};
 assert.equal((await splitRequest(c.url+'/control',{'x-bang-token':c.token,'x-bang-epoch':c.epoch},{command:'commit',topic:'demo',input:next})).status,200);assert.equal(run(p,'state').canvas.nodes[0].text,'中文第二版');
 }finally{if(server)await new Promise(r=>server.close(r));run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});

test('failed public start reports bounded nonsecret startup stage and exit code',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-start-error-'));
 try{
  await fs.mkdir(path.join(p,'.bang/runtime'),{recursive:true});
  await fs.writeFile(path.join(p,'.bang/runtime/workspace.json'),'secret-sentinel-not-json');
  const result=spawnSync(process.execPath,[cli,'start','--project',p],{encoding:'utf8',timeout:15000});
  assert.equal(result.status,1);assert.match(result.stderr,/exit=1/);assert.match(result.stderr,/stage=identity-read/);
  assert.ok(result.stderr.length<512);assert.doesNotMatch(result.stderr,/secret-sentinel|bang-start-error-/);
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});

test('rapid public stop and restart preserves ownership and saved data',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-restarts-'));
 try{
  run(p,'generate',{cards:[{id:'kept',text:'preserved',x:0,y:0,width:100,height:100}]});
  let previous=run(p,'start');
  for(let cycle=0;cycle<12;cycle++){
   run(p,'stop');const current=run(p,'start');
   assert.equal(current.workspaceId,previous.workspaceId);assert.notEqual(current.epoch,previous.epoch);
   assert.equal(run(p,'read').nodes[0].text,'preserved');previous=current;
  }
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});

test('native setup failure reports OS error stage without exposing project paths',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-lock-error-'));
 try{
  await fs.mkdir(path.join(p,'.bang/runtime/writer.lock'),{recursive:true});
  const result=spawnSync(process.execPath,[cli,'start','--project',p],{encoding:'utf8',timeout:15000});
  assert.equal(result.status,1);assert.match(result.stderr,/exit=74/);assert.match(result.stderr,/stage=lock-open; code=\d+/);
  assert.ok(result.stderr.length<512);assert.doesNotMatch(result.stderr,/bang-lock-error-/);
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});

for(const holdMs of [1800,8000])test(`restart ${holdMs===1800?'waits for transient':'bounds persistent'} Windows discovery sharing conflict`,{skip:process.platform!=='win32'},async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-discovery-sharing-'));let holder;
 try{
  const before=run(p,'start');run(p,'stop');
  holder=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$f=[IO.File]::Open($env:BANG_TEST_DESCRIPTOR,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite); Write-Output 'held'; Start-Sleep -Milliseconds $env:BANG_TEST_HOLD_MS; $f.Dispose()"],{env:{...process.env,BANG_TEST_HOLD_MS:String(holdMs),BANG_TEST_DESCRIPTOR:path.join(p,'.bang/runtime/connection.json')},windowsHide:true});
  await new Promise((resolve,reject)=>{holder.stdout.once('data',resolve);holder.once('error',reject);holder.once('exit',code=>{if(code!==0)reject(Error('sharing fixture failed'));});});
  if(holdMs===1800){const after=run(p,'start');assert.equal(after.workspaceId,before.workspaceId);assert.notEqual(after.epoch,before.epoch);}
  else{
   const began=Date.now(),result=spawnSync(process.execPath,[cli,'start','--project',p],{encoding:'utf8',timeout:10000});
   assert.equal(result.status,1);assert.match(result.stderr,/stage=discovery-replace; code=EPERM/);assert.ok(Date.now()-began<6000);
  }
 }finally{if(holder&&holder.exitCode===null){const closed=new Promise(resolve=>holder.once('close',resolve));holder.kill();await closed;}run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
