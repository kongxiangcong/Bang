// T19: 10,000 actual CompletedTurns, batches of 100, native controlled executor.
// This is deliberately not ticket 39's 1,000-node / 3,000-edge / 10,000-revision benchmark.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {generateKeyPairSync,sign,randomUUID,createHash} from 'node:crypto';
import {runtimeOperation} from '../runtime/native/runtime.mjs';
const project=await fs.mkdtemp(path.join(os.tmpdir(),'bang-10000-turns-')),started=Date.now(),hash=v=>createHash('sha256').update(v).digest('hex');
const report={workload:'10000 completed turns, 100 batches/native calls, 100 board revisions, 100 incrementally created cards, zero attachments',controlledModel:true,realModelCalls:0,project,platform:process.platform,node:process.version,os:os.version(),cpu:os.cpus()[0].model,ramBytes:os.totalmem(),progress:[],failures:[]};
report.sourceHashes=Object.fromEntries(await Promise.all(['runtime/canvas/history-storage.mjs','runtime/canvas/capacity.mjs','runtime/canvas/ingestion.mjs','runtime/canvas/publication.mjs','runtime/native/runtime.mjs','tests/history-stress-worker.mjs'].map(async file=>[file,hash(await fs.readFile(new URL('../'+file,import.meta.url)))])));
const call=(command,input,topic)=>runtimeOperation(project,command,topic,input),delay=ms=>new Promise(r=>setTimeout(r,ms));
async function files(dir){const out=[];for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())out.push(...await files(file));else out.push({path:path.relative(project,file),bytes:(await fs.stat(file)).size});}return out;}
try{
 process.env.BANG_ORGANIZER_NATIVE=JSON.stringify({version:1,executable:process.execPath,args:[fileURLToPath(new URL('./history-stress-worker.mjs',import.meta.url))],policy:'no-tools',graceMs:200});
 const {workspaceId}=await call('start');delete process.env.BANG_ORGANIZER_NATIVE;
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 await call('connector-register',{id:'capacity-controlled',host:'controlled-host',versions:['1'],publicKey:publicKey.export({format:'pem',type:'spki'})});
 const proof=(extra={})=>{const now=Date.now(),payload=Buffer.from(JSON.stringify({host:'controlled-host',version:'1',instanceId:'stress',sessionId:'capacity',workspaceId,role:'primary',scope:['*'],turnId:'calling-turn',cursor:'c0',issuedAt:now,expiresAt:now+300000,nonce:randomUUID(),...extra})).toString('base64url');return {connectorId:'capacity-controlled',payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64url')};};
 const session=await call('session-connect',proof()),bound=await call('binding-enable',session),topic=bound.topic.id;report.topic=topic;
 await call('organizer-configure',{limits:{batchSize:100,callsPerHour:1000}});
 await call('organizer-enable',{topicId:topic});
 for(let batchNumber=0;batchNumber<100;batchNumber++){
  const events=Array.from({length:100},(_,j)=>{const n=batchNumber*100+j+1,user='Synthetic capacity question '+n,answer='Synthetic capacity answer '+n;return {kind:'turn',role:'primary',status:'completed',turnId:n===1?'calling-turn':'turn-'+n,versionId:'v1',cursor:'c'+n,user:{role:'user',content:user},assistant:{role:'assistant',channel:'final',content:answer},sourceHash:hash(JSON.stringify([user,answer]))};});
  const batch={sourceId:bound.source.id,previousCursor:'c'+batchNumber*100,events},input={batch,proof:proof({purpose:'completed-turn-ingestion',sourceId:bound.source.id,batchHash:hash(JSON.stringify(batch))})};
  const received=await call('turn-ingest',input);assert.equal(received.received,100);assert.equal((await call('turn-ingest',input)).duplicate,true);
  let status;const deadline=Date.now()+120000;
  for(;;){status=await call('organizer-status',{topicId:topic});if(status.tasks.some(t=>['failed','cancelled','retry'].includes(t.status)))throw Error(JSON.stringify(status.tasks.filter(t=>t.error).map(t=>({id:t.id,error:t.error,baseRevision:t.baseRevision}))));if(status.tasks.length===batchNumber+1&&status.tasks.every(t=>t.status==='committed'))break;if(Date.now()>deadline)throw Error('Batch processing deadline');await delay(100);}
  if((batchNumber+1)%10===0||batchNumber===0){const list=await files(path.join(project,'.bang')),sample={turns:(batchNumber+1)*100,elapsedMs:Date.now()-started,fileCount:list.length,totalBytes:list.reduce((n,f)=>n+f.bytes,0)};report.progress.push(sample);console.log(JSON.stringify(sample));assert.equal(list.some(f=>f.path.includes('transient-cache')),false);}
 }
 const queue=await call('turn-status',{topicId:topic});assert.equal(queue.received,10000);assert.equal(queue.organized,10000);assert.equal(queue.backlog,0);
 const status=await call('organizer-status',{topicId:topic});assert.equal(status.tasks.length,100);assert.ok(status.tasks.every(t=>t.process.exitConfirmed));
 const capacity=await call('history-capacity',undefined,topic);assert.equal(capacity.revisions,101);assert.ok(capacity.checkpoints>=2);assert.ok(capacity.deltas>0);report.capacity=capacity;
 await call('organizer-control',{topicId:topic,action:'pause'});await call('stop');
 assert.equal((await call('history-preview',{revision:1},topic)).canvas.nodes[0].text,'Controlled batch ending turn-100');
 assert.equal((await call('history-preview',{revision:64},topic)).canvas.nodes.at(-1).text,'Controlled batch ending turn-6400');
 assert.equal((await call('state',undefined,topic)).revision,100);
 const first=queue.versions[0];assert.equal((await call('turn-source',{topicId:topic,id:first.id})).assistant.content,'Synthetic capacity answer 1');
 const preview=await call('maintenance-preview',{action:'compact'},topic);await call('maintenance-confirm',{...preview,confirm:true},topic);
 assert.equal((await call('history-preview',{revision:64},topic)).canvas.nodes.at(-1).text,'Controlled batch ending turn-6400');
 report.afterCompact=await call('history-capacity',undefined,topic);
 const archivePreview=await call('maintenance-preview',{action:'archive'},topic);const archive=await call('maintenance-confirm',{...archivePreview,confirm:true},topic);
 report.archive=await call('backup-verify',{backup:archive.backup},topic);assert.equal(report.archive.sources,10000);assert.equal(report.archive.revisions,101);
 report.files=await files(path.join(project,'.bang'));const logs=report.files.filter(f=>/events.*jsonl$/.test(f.path));assert.equal(logs.length,2);assert.ok(logs.every(f=>f.bytes<=8192));
 assert.equal(report.files.some(f=>/publish\.tmp|preserve\.tmp|transient-cache/.test(f.path)),false);
 report.elapsedMs=Date.now()-started;report.completedTurns=10000;report.modelAttempts=100;report.status='passed';
}catch(error){report.failures.push({message:error.message,stack:error.stack});report.status='failed';process.exitCode=1;}finally{delete process.env.BANG_ORGANIZER_NATIVE;await call('stop');const output=process.argv[2]??path.join(project,'stress-report.json');await fs.writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,output,project,elapsedMs:Date.now()-started}));}
