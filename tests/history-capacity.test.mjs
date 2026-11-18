import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runtimeOperation} from '../runtime/native/runtime.mjs';
import http from 'node:http';
import {createCanvasMiddleware} from '../runtime/canvas/http.mjs';
import {canvasRequest} from './canvas-request.mjs';
import {createHash} from 'node:crypto';

test('capacity reports retained history and compact revisions remain inspectable after reopening',async()=>{
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'bang-capacity-'));
 const call=(command,input)=>runtimeOperation(project,command,'demo',input);
 try{
  await call('generate',{cards:[{id:'a',text:'original '.repeat(500),x:0,y:0,width:240,height:160}]});
  for(let i=1;i<=70;i++)await call('commit',{operationId:'edit-'+i,topic:'demo',baseRevision:i-1,author:{kind:'manual',id:'human'},intent:'explicit-save',readDependencies:[],operations:[{type:'edit-card',id:'a',x:i}]});
  await call('stop');
  const capacity=await call('history-capacity');
  assert.equal(capacity.revisions,71);
  assert.equal(capacity.historyPolicy,'retain-until-explicit-action');
  assert.ok(capacity.historyBytes<capacity.expandedHistoryBytes/2);
  assert.ok(capacity.checkpoints>=2);assert.ok(capacity.deltas>0);
  assert.equal((await call('history-preview',{revision:1})).canvas.nodes[0].x,1);
  assert.equal((await call('history-preview',{revision:64})).canvas.nodes[0].x,64);
  const backup=await call('backup-export');assert.equal((await call('backup-verify',{backup})).revisions,71);
  const restored=(await call('backup-restore',{backup})).projectPath;
  const restoredCall=(command,input)=>runtimeOperation(restored,command,'demo',input);
  try{
   const before=await restoredCall('history-capacity'),preview=await restoredCall('maintenance-preview',{action:'compact'});
   const cleaned=await restoredCall('maintenance-confirm',{...preview,confirm:true});
   assert.ok(cleaned.capacity.databaseBytes<before.databaseBytes,'lossless compaction must actually reclaim expanded legacy snapshot storage');
   assert.equal((await restoredCall('history-preview',{revision:64})).canvas.nodes[0].x,64);
   assert.equal((await restoredCall('history')).length,71);
  }finally{await restoredCall('stop');}
 }finally{await call('stop');await fs.rm(project,{recursive:true,force:true});}
});

test('legacy JSON property ordering remains exact across restored history checkpoints',async()=>{
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'bang-history-order-'));let destination;
 const call=(command,input)=>runtimeOperation(project,command,'demo',input);
 try{
  await call('generate',{cards:[{id:'a',text:'first',x:0,y:0,width:240,height:160}]});
  await call('commit',{operationId:'edit',topic:'demo',baseRevision:0,author:{kind:'manual',id:'human'},intent:'explicit-save',readDependencies:[],operations:[{type:'edit-card',id:'a',text:'second'}]});
  const backup=await call('backup-export');
  // A valid legacy package can serialize equivalent state keys in another order.
  for(const rows of [backup.payload.tables.topics,backup.payload.tables.revisions,backup.payload.tables.intents])for(const row of rows){const state=JSON.parse(row.state);if(state.revision===1){const {metadata,...rest}=state;row.state=JSON.stringify({metadata,...rest});}}
  backup.sha256=createHash('sha256').update(JSON.stringify(backup.payload)).digest('hex');
  destination=(await call('backup-restore',{backup})).projectPath;
  const restored=(command,input)=>runtimeOperation(destination,command,'demo',input);
  const preview=await restored('restore-preview',{revision:0});
  await restored('restore-version',{...preview,operationId:'restore',author:{kind:'manual',id:'human'},intent:'restore-version'});
  assert.deepEqual(await restored('history-preview',{revision:2}),await restored('state'));
  assert.equal((await restored('backup-verify',{backup:await restored('backup-export')})).valid,true);
 }finally{if(destination)await runtimeOperation(destination,'stop');await call('stop');await fs.rm(project,{recursive:true,force:true});}
});

test('archive confirmation rejects attachments changed since the reviewed package',async()=>{
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'bang-archive-preview-'));
 const call=(command,input)=>runtimeOperation(project,command,'demo',input);
 try{
  await fs.mkdir(path.join(project,'assets'));await fs.writeFile(path.join(project,'assets/note.txt'),'reviewed bytes');
  await call('generate',{cards:[{id:'file',type:'file',file:'assets/note.txt',x:0,y:0,width:240,height:160}]});
  const preview=await call('maintenance-preview',{action:'archive'});
  await fs.writeFile(path.join(project,'assets/note.txt'),'changed after preview');
  await assert.rejects(call('maintenance-confirm',{...preview,confirm:true}),/preview conflict/);
 }finally{await call('stop');await fs.rm(project,{recursive:true,force:true});}
});

test('protected maintenance requires an exact explicit preview and preserves history, references and undo',async()=>{
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'bang-maintenance-'));let server;
 const call=(command,input)=>runtimeOperation(project,command,'demo',input);
 try{
  await call('generate',{cards:[{id:'a',text:'原文😀',x:0,y:0,width:240,height:160}]});
  const save=revision=>call('commit',{operationId:'edit-'+revision,topic:'demo',baseRevision:revision-1,author:{kind:'manual',id:'human'},intent:'explicit-save',readDependencies:[],operations:[{type:'edit-card',id:'a',text:'改文😎'+revision}]});
  await save(1);
  // Controlled interrupted publisher scratch; no database rows are injected.
  const scratch=path.join(project,'.bang/topics/demo/publish.tmp'),userFile=path.join(project,'.bang/topics/demo/user-notes.txt');
  await fs.writeFile(scratch,Buffer.alloc(32768,7));await fs.writeFile(userFile,'retain user content');
  server=http.createServer(createCanvasMiddleware({project}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}/api/canvas/demo`;
  assert.equal((await fetch(url+'/maintenance-preview',{method:'POST'})).status,403);
  const post=async(action,input)=>{const r=await canvasRequest(url+'/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:r.status,body:await r.json()};};
  const preview=(await post('maintenance-preview',{action:'compact'})).body;
  assert.equal(preview.revisionsRetained,2);assert.equal(preview.historyDeleted,0);
  assert.equal(preview.temporaryFiles.length,1);assert.equal(preview.temporaryFiles[0].bytes,32768);
  assert.equal((await post('maintenance-confirm',{...preview})).status,400);
  await save(2);
  assert.equal((await post('maintenance-confirm',{...preview,confirm:true})).status,409);
  await fs.writeFile(scratch,Buffer.alloc(32768,7));
  const current=(await post('maintenance-preview',{action:'compact'})).body;
  assert.equal(current.temporaryFiles[0].bytes,32768);
  assert.equal((await post('maintenance-confirm',{...current,confirm:true})).status,200);
  await assert.rejects(fs.stat(scratch),{code:'ENOENT'});assert.equal(await fs.readFile(userFile,'utf8'),'retain user content');
  const archive=(await post('maintenance-preview',{action:'archive'})).body;
  const exported=(await post('maintenance-confirm',{...archive,confirm:true})).body;
  assert.equal((await call('backup-verify',{backup:exported.backup})).revisions,3);
  await call('stop');assert.equal((await call('history-preview',{revision:1})).canvas.nodes[0].text,'改文😎1');
  await call('undo',{operationId:'undo',topic:'demo',revision:2,author:{kind:'manual',id:'human'},intent:'undo-committed'});
  assert.equal((await call('state')).canvas.nodes[0].text,'改文😎1');
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await call('stop');await fs.rm(project,{recursive:true,force:true});}
});
