import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const cli=new URL('../runtime/canvas/bang.mjs',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1');
const run=(p,c,input)=>spawnSync(process.execPath,[cli,c,'--project',p,'--topic','demo'],{input:input&&JSON.stringify(input),encoding:'utf8',maxBuffer:64*1024*1024});
const ok=r=>{assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
test('full project package reopens all history, editor extras and referenced attachments without its original project',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-backup-')),other=await fs.mkdtemp(path.join(os.tmpdir(),'bang-restore-'));let restored;
 try{
 await fs.mkdir(path.join(p,'assets'));await fs.writeFile(path.join(p,'assets/note.txt'),'attachment bytes 中文');await fs.writeFile(path.join(p,'.env'),'SECRET_NEVER_EXPORT');
 ok(run(p,'generate',{cards:[{id:'first',text:'historical'}]}));
 ok(run(p,'commit',{operationId:'edited',topic:'demo',baseRevision:0,author:{kind:'manual',id:'human'},readDependencies:[],intent:'explicit-save',operations:[{type:'edit-card',id:'first',text:'current'},{type:'create-card',card:{id:'file',type:'file',file:'assets/note.txt',x:0,y:200,width:200,height:100}},{type:'create-extra',extra:{id:'free',element:{id:'free',type:'line',angle:0.3,points:[[0,0],[4,9]]}}}]}));
 ok(run(p,'commit',{operationId:'remove-file',topic:'demo',baseRevision:1,author:{kind:'manual',id:'human'},readDependencies:[],intent:'explicit-save',operations:[{type:'delete-card',id:'file'}]}));
 await runtimeOperation(p,'generate','second',{cards:[{id:'another',text:'another topic'}]});
 const state=ok(run(p,'state')),history=ok(run(p,'history')),old=ok(run(p,'history-preview',{revision:0}));
 const backup=ok(run(p,'backup-export'));assert.equal(JSON.stringify(backup).includes('SECRET_NEVER_EXPORT'),false);assert.equal(backup.payload.tables.topics.length,2);
 const damaged=structuredClone(backup);damaged.payload.attachments[0].data=Buffer.from('damaged').toString('base64');damaged.sha256=hash(JSON.stringify(damaged.payload));assert.notEqual(run(other,'backup-verify',{backup:damaged}).status,0);assert.equal(ok(run(other,'backup-verify',{backup})).valid,true);
 ok(run(p,'stop'));await fs.rename(p,p+'-offline');
 const result=ok(run(other,'backup-restore',{backup}));restored=result.projectPath;
 assert.equal((await runtimeOperation(restored,'read','second')).nodes[0].text,'another topic');assert.deepEqual(ok(run(restored,'state')),state);assert.deepEqual(ok(run(restored,'history')),history);assert.deepEqual(ok(run(restored,'history-preview',{revision:0})),old);
 assert.equal(await fs.readFile(path.join(restored,'assets/note.txt'),'utf8'),'attachment bytes 中文');assert.equal(ok(run(restored,'state')).editorExtras[0].id,'free');
 ok(run(restored,'stop'));assert.deepEqual(ok(run(restored,'state')),state);
 }finally{if(restored)run(restored,'stop');run(p,'stop');run(other,'stop');for(const dir of [p,p+'-offline',other])await fs.rm(dir,{recursive:true,force:true,maxRetries:5});}
});

import {generateKeyPairSync,sign,randomUUID,createHash} from 'node:crypto';
import {runtimeOperation} from '../runtime/native/runtime.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
async function fixture(){
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'bang-ingestion-')),call=(command,input)=>runtimeOperation(project,command,undefined,input);
 const {workspaceId}=await call('start'),{privateKey,publicKey}=generateKeyPairSync('ed25519');
 await call('connector-register',{id:'controlled',host:'controlled-host',versions:['1'],publicKey:publicKey.export({format:'pem',type:'spki'})});
 const proof=(extra={})=>{const now=Date.now();const payload=Buffer.from(JSON.stringify({host:'controlled-host',version:'1',instanceId:'fixture',sessionId:'primary-chat',workspaceId,role:'primary',scope:['*'],turnId:'calling-turn',cursor:'c0',issuedAt:now,expiresAt:now+300000,nonce:randomUUID(),...extra})).toString('base64url');return {connectorId:'controlled',payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64url')};};
 const session=await call('session-connect',proof()),bound=await call('binding-enable',session);
 const turn=(turnId='calling-turn',cursor='c1',versionId='v1',answer='合成回答')=>({kind:'turn',role:'primary',status:'completed',turnId,versionId,cursor,user:{role:'user',content:'合成问题'},assistant:{role:'assistant',channel:'final',content:answer},sourceHash:hash(JSON.stringify(['合成问题',answer]))});
 const signed=(events,previousCursor='c0',extra={})=>{const batch={sourceId:bound.source.id,previousCursor,events,...extra};return {batch,proof:proof({purpose:'completed-turn-ingestion',sourceId:bound.source.id,batchHash:hash(JSON.stringify(batch))})};};
 return {project,call,session,bound,proof,turn,signed,close:async()=>{await call('stop');await fs.rm(project,{recursive:true,force:true});}};
}

test('restored sources preserve exact versions and gaps, freeze backlog and require new host trust',async()=>{
 const f=await fixture();let restored;
 try{await f.call('turn-ingest',f.signed([f.turn(),{kind:'gap',turnId:'missing',cursor:'c2',reason:'missing-record'}]));
 const before=await f.call('turn-status',{topicId:f.bound.topic.id}),source=await f.call('turn-source',{topicId:f.bound.topic.id,id:before.pending[0].id});
 const backup=await f.call('backup-export');assert.equal(JSON.stringify(backup).includes(f.session.sessionToken),false);
 restored=(await f.call('backup-restore',{backup})).projectPath;
 const call=(c,i)=>runtimeOperation(restored,c,undefined,i),after=await call('turn-status',{topicId:f.bound.topic.id});
 assert.equal(after.received,1);assert.equal(after.backlog,0);assert.equal(after.frozen,1);assert.deepEqual(after.gaps,before.gaps);
 assert.deepEqual(await call('turn-source',{topicId:f.bound.topic.id,id:source.id}),source);
 assert.equal((await call('binding-sources',{topicId:f.bound.topic.id}))[0].active,false);
 await assert.rejects(call('binding-status',f.session),/capability rejected/);await assert.rejects(call('turn-ingest',f.signed([f.turn('late','c3')],'c2')),/trusted connector/);
 assert.equal((await call('start')).workspaceId===(await f.call('start')).workspaceId,false);
 }finally{if(restored)await runtimeOperation(restored,'stop');await f.close();}
});
import http from 'node:http';
import {createCanvasMiddleware} from '../runtime/canvas/http.mjs';
import {canvasRequest} from './canvas-request.mjs';
test('protected HTTP verifies corruption, absent entries, hostile paths and authority before creating an isolated restore',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-package-http-'));let server,restored;
 try{ok(run(p,'generate',{cards:[{id:'c',text:'safe'}]}));
 ok(run(p,'commit',{operationId:'file',topic:'demo',baseRevision:0,author:{kind:'manual',id:'human'},readDependencies:[],intent:'explicit-save',operations:[{type:'create-card',card:{id:'f',type:'file',file:'missing.pdf',x:0,y:200,width:200,height:100}}]}));
 server=http.createServer(createCanvasMiddleware({project:p}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/api/canvas/demo/`;
 assert.equal((await fetch(url+'backup-export')).status,403);
 const backup=await (await canvasRequest(url+'backup-export')).json();
 const post=async(action,value)=>{const r=await canvasRequest(url+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});return {status:r.status,value:await r.json()};};
 assert.deepEqual((await post('backup-verify',{backup})).value.missingAttachments,['missing.pdf']);
 for(const mutate of [b=>b.sha256='bad',b=>b.payload.attachments=[],b=>b.payload.attachments[0].path='../outside',b=>delete b.payload.tables.revisions,b=>b.payload.tables.binding_sources.push({id:'evil',topic:'demo',session_key:'replay',metadata:'{}',active:1})]){
 const bad=structuredClone(backup);mutate(bad);if(bad.sha256!=='bad')bad.sha256=hash(JSON.stringify(bad.payload));
 assert.equal((await post('backup-restore',{backup:bad})).status,400);
 }
 assert.equal((await post('backup-restore',{backup,destination:path.join(p,'overwrite')})).status,400);
 const currentPath=path.join(p,'.bang/topics/demo/current.canvas'),committedBytes=await fs.readFile(currentPath);await fs.writeFile(currentPath,'damaged external bytes');assert.notEqual(run(p,'backup-export').status,0);assert.equal(await fs.readFile(currentPath,'utf8'),'damaged external bytes');await fs.writeFile(currentPath,committedBytes);
 assert.equal(ok(run(p,'state')).revision,1);
 assert.equal(await fs.stat(path.join(p,'.bang/restored-projects')).then(()=>true,()=>false),false);
 const result=await post('backup-restore',{backup});assert.equal(result.status,200);restored=result.value.projectPath;
 assert.equal((await runtimeOperation(restored,'resource-status','demo',{id:'f'})).status,'missing');
 }finally{if(restored)run(restored,'stop');if(server)await new Promise(r=>server.close(r));run(p,'stop');await fs.rm(p,{recursive:true,force:true,maxRetries:5});}
});

test('restore refuses directory links and project navigation rejects caller paths',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-backup-boundary-')),outside=await fs.mkdtemp(path.join(os.tmpdir(),'bang-outside-'));let server;
 try{ok(run(p,'generate',{cards:[]}));const backup=ok(run(p,'backup-export'));await fs.writeFile(path.join(outside,'keep'),'untouched');
 await fs.symlink(outside,path.join(p,'.bang/restored-projects'),process.platform==='win32'?'junction':'dir');
 assert.notEqual(run(p,'backup-restore',{backup}).status,0);assert.deepEqual(await fs.readdir(outside),['keep']);
 server=http.createServer(createCanvasMiddleware({project:p}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/api/canvas/demo/state`;
 for(const selection of ['../outside','C:/arbitrary','00000000-0000-4000-8000-000000000000']){const r=await canvasRequest(url,{headers:{'x-bang-restored-project':selection}});assert.notEqual(r.status,200);}
 }finally{if(server)await new Promise(r=>server.close(r));run(p,'stop');await fs.rm(p,{recursive:true,force:true,maxRetries:5});await fs.rm(outside,{recursive:true,force:true});}
});
