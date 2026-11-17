import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../runtime/canvas/bang.mjs',import.meta.url));
function run(p,c,input){return spawnSync(process.execPath,[cli,c,'--project',p,'--topic','demo'],{input:JSON.stringify(input),encoding:'utf8',timeout:20000});}
function ok(p,c,input){const r=run(p,c,input);assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
test('unknown Canvas is preserved and public recovery requires the observed fingerprint',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-recovery-'));
 try{ok(p,'generate',{cards:[]});const file=path.join(p,'.bang/topics/demo/current.canvas');await fs.writeFile(file,'broken original');assert.notEqual(run(p,'state').status,0);
 const status=ok(p,'recovery-status');assert.equal(status.status,'recovery-required');assert.equal(status.reason,'invalid-canvas');assert.notEqual(run(p,'recover',{expectedHash:'wrong'}).status,0);
 const recovered=ok(p,'recover',{expectedHash:status.observedHash});assert.equal(recovered.status,'recovered');assert.equal(await fs.readFile(path.join(p,recovered.preservedFile),'utf8'),'broken original');assert.deepEqual(ok(p,'read'),{nodes:[],edges:[]});
 }finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
const patch={operationId:'interrupted-save',topic:'demo',baseRevision:0,author:{kind:'manual',id:'local-user'},readDependencies:[],intent:'explicit-save',operations:[{type:'create-card',card:{id:'one',text:'survives crash',x:0,y:0,width:100,height:100}}]};
async function crash(p,phase,command='commit',input=patch){
 ok(p,'stop');const started=spawnSync(process.execPath,[cli,'start','--project',p],{encoding:'utf8',env:{...process.env,BANG_PUBLICATION_TEST_PROJECT:p,BANG_PUBLICATION_TEST_FAULT:phase},timeout:15000});assert.equal(started.status,0,started.stderr);
 const connection=JSON.parse(await fs.readFile(path.join(p,'.bang/runtime/connection.json'),'utf8'));
 const pending=fetch(connection.url+'/control',{method:'POST',headers:{'Content-Type':'application/json','x-bang-token':connection.token,'x-bang-epoch':connection.epoch},body:JSON.stringify({command,topic:'demo',input})}).then(r=>r.json()).catch(()=>null);
 const marker=path.join(p,'.bang/runtime/publication-test.json');let seen=false;
 for(let i=0;i<80;i++){try{const record=JSON.parse(await fs.readFile(marker,'utf8'));if(record.phase===phase){seen=true;break;}}catch{}await new Promise(r=>setTimeout(r,25));}
 process.kill(connection.pid,'SIGKILL');await pending;assert.equal(seen,true,'fault phase must be reached');await fs.rm(marker,{force:true});
}
test('prepared save survives actual daemon kill with old Canvas and completes once on reopening',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-kill-'));
 try{ok(p,'generate',{cards:[]});await crash(p,'prepared');const state=ok(p,'state');assert.equal(state.revision,1);assert.equal(state.canvas.nodes[0].text,'survives crash');assert.equal(ok(p,'commit',patch).revision,1);assert.equal(ok(p,'history').length,2);}
 finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
for(const phase of ['replaced','confirmed'])test(`${phase} save survives actual process kill and fresh daemon confirms exactly once`,async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-kill-'));
 try{ok(p,'generate',{cards:[]});await crash(p,phase);assert.equal(ok(p,'state').revision,1);assert.equal(ok(p,'commit',patch).revision,1);assert.equal(ok(p,'history').length,2);}finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
for(const phase of ['prepared','replaced','confirmed'])test(`bootstrap is recoverable after process kill at ${phase}`,async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-bootstrap-'));
 try{await crash(p,phase,'generate',{cards:[]});assert.deepEqual(ok(p,'state').canvas,{nodes:[],edges:[]});assert.equal(ok(p,'history').length,1);}finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
test('acknowledged save survives daemon kill without depending on graceful stop',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-ack-'));
 try{ok(p,'generate',{cards:[]});assert.equal(ok(p,'commit',patch).status,'committed');const daemon=ok(p,'status');process.kill(daemon.pid,'SIGKILL');assert.equal(ok(p,'state').canvas.nodes[0].text,'survives crash');assert.equal(ok(p,'commit',patch).revision,1);}finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
test('unknown valid Canvas after interrupted save is not silently replaced and explicit recovery preserves it',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-unknown-'));
 try{ok(p,'generate',{cards:[]});await crash(p,'prepared');const file=path.join(p,'.bang/topics/demo/current.canvas'),external=JSON.stringify({nodes:[{id:'outside',type:'text',text:'external',x:0,y:0,width:100,height:100}],edges:[]});await fs.writeFile(file,external);assert.notEqual(run(p,'state').status,0);assert.equal(await fs.readFile(file,'utf8'),external);const status=ok(p,'recovery-status');assert.equal(status.reason,'external-change');const result=ok(p,'recover',{expectedHash:status.observedHash});assert.equal(await fs.readFile(path.join(p,result.preservedFile),'utf8'),external);assert.equal(ok(p,'state').revision,1);assert.equal(ok(p,'commit',patch).revision,1);}finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
for(const source of ['write:full','replace:busy'])test(`${source} is bounded, returns no success, keeps old Canvas, and reopens pending save`,async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-blocked-'));
 try{ok(p,'generate',{cards:[]});ok(p,'stop');const start=spawnSync(process.execPath,[cli,'start','--project',p],{encoding:'utf8',timeout:15000,env:{...process.env,BANG_PUBLICATION_TEST_PROJECT:p,BANG_PUBLICATION_TEST_FAULT:source}});assert.equal(start.status,0,start.stderr);const before=Date.now(),failed=run(p,'commit',patch);assert.notEqual(failed.status,0);assert.match(failed.stderr,/Save blocked/);assert.ok(Date.now()-before<3000);assert.deepEqual(JSON.parse(await fs.readFile(path.join(p,'.bang/topics/demo/current.canvas'),'utf8')),{nodes:[],edges:[]});assert.equal(ok(p,'recovery-status').status,'recovery-required');ok(p,'stop');assert.equal(ok(p,'state').revision,1);assert.equal(ok(p,'commit',patch).revision,1);}finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
import {canvasRequest} from './canvas-request.mjs';
import http from 'node:http';
import {createCanvasMiddleware} from '../runtime/canvas/http.mjs';
test('HTTP exposes recovery-required instead of partial state and recovers with browser capability',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-recovery-http-'));let server;
 try{ok(p,'generate',{cards:[]});await fs.writeFile(path.join(p,'.bang/topics/demo/current.canvas'),'invalid');server=http.createServer(createCanvasMiddleware({project:p}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/api/canvas/demo`;
 const response=await canvasRequest(url+'/state');assert.equal(response.status,409);const body=await response.json();assert.equal(body.code,'RECOVERY_REQUIRED');assert.equal(body.canvas,undefined);
 const status=await (await canvasRequest(url+'/recovery-status')).json();const result=await canvasRequest(url+'/recover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedHash:status.observedHash})});assert.equal(result.status,200);assert.deepEqual((await (await canvasRequest(url+'/state')).json()).canvas,{nodes:[],edges:[]});
 }finally{if(server)await new Promise(r=>server.close(r));run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
test('fresh Linux storage and recovery evidence stay private', {skip:process.platform==='win32'},async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-private-data-'));
 try{ok(p,'generate',{cards:[]});await fs.writeFile(path.join(p,'.bang/topics/demo/current.canvas'),'broken');const status=ok(p,'recovery-status'),repaired=ok(p,'recover',{expectedHash:status.observedHash});for(const relative of ['.bang','.bang/topics','.bang/topics/demo','.bang/board.sqlite','.bang/topics/demo/current.canvas',repaired.preservedFile])assert.equal((await fs.stat(path.join(p,relative))).mode&0o077,0,relative);}finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
import {spawn} from 'node:child_process';
test('real Windows sharing denial keeps old file and pending save recovers after handle release',{skip:process.platform!=='win32'},async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-sharing-'));let holder;
 try{ok(p,'generate',{cards:[]});holder=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$f=[IO.File]::Open($env:BANG_TEST_CANVAS,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite); Write-Output 'held'; Start-Sleep -Seconds 20; $f.Dispose()"],{env:{...process.env,BANG_TEST_CANVAS:path.join(p,'.bang/topics/demo/current.canvas')},windowsHide:true});await new Promise((resolve,reject)=>{holder.stdout.once('data',resolve);holder.once('error',reject);});const before=Date.now(),result=run(p,'commit',patch);assert.notEqual(result.status,0);assert.match(result.stderr,/Save blocked/);assert.ok(Date.now()-before<3000);assert.deepEqual(JSON.parse(await fs.readFile(path.join(p,'.bang/topics/demo/current.canvas'),'utf8')),{nodes:[],edges:[]});const ended=new Promise(r=>holder.once('close',r));holder.kill();await ended;assert.equal(ok(p,'state').revision,1);assert.equal(ok(p,'commit',patch).revision,1);}finally{holder?.kill();run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
test('confirmation failure returns no acknowledgement and new file hash completes after restart',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-confirm-full-'));
 try{ok(p,'generate',{cards:[]});ok(p,'stop');const start=spawnSync(process.execPath,[cli,'start','--project',p],{encoding:'utf8',timeout:15000,env:{...process.env,BANG_PUBLICATION_TEST_PROJECT:p,BANG_PUBLICATION_TEST_FAULT:'confirm:full'}});assert.equal(start.status,0,start.stderr);assert.notEqual(run(p,'commit',patch).status,0);assert.notEqual(run(p,'state').status,0);ok(p,'stop');assert.equal(ok(p,'state').revision,1);assert.equal(ok(p,'commit',patch).revision,1);assert.equal(ok(p,'history').length,2);}finally{run(p,'stop');await fs.rm(p,{recursive:true,force:true});}
});
