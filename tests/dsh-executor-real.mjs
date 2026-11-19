// Explicit opt-in real Organizer request, synthetic signed acceptance source; never current chat.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID,generateKeyPairSync,sign,createHash} from 'node:crypto';import {runtimeOperation} from '../runtime/native/runtime.mjs';
if(!process.env.BANG_DSH_REAL_CONFIG)throw Error('Explicit reviewed DSH configuration required');
const config=JSON.parse(process.env.BANG_DSH_REAL_CONFIG),project=fs.mkdtempSync(path.join(os.tmpdir(),'bang-dsh-real-')),call=(command,input)=>runtimeOperation(project,command,undefined,input),hash=x=>createHash('sha256').update(x).digest('hex');
let started=false;
try{
 process.env.BANG_ORGANIZER_DSH=JSON.stringify(config);const {workspaceId}=await call('start');started=true;delete process.env.BANG_ORGANIZER_DSH;
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');await call('connector-register',{id:'controlled-acceptance-source',host:'synthetic-acceptance-source',versions:['1'],publicKey:publicKey.export({format:'pem',type:'spki'})});
 const proof=(extra={})=>{const now=Date.now(),payload=Buffer.from(JSON.stringify({host:'synthetic-acceptance-source',version:'1',instanceId:'explicit-isolated-test',sessionId:'synthetic',workspaceId,role:'primary',scope:['*'],turnId:'source-turn',cursor:'c0',issuedAt:now,expiresAt:now+300000,nonce:randomUUID(),...extra})).toString('base64url');return {connectorId:'controlled-acceptance-source',payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64url')};};
 const session=await call('session-connect',proof()),bound=await call('binding-enable',session),topicId=bound.topic.id;
 await call('organizer-configure',{limits:{callsPerHour:1,timeoutMs:60000}});await call('organizer-enable',{topicId});
 const user='Create a project knowledge card named Rainwater barrel. This is a design intention, not a verified installation.',assistant='The planned Rainwater barrel stores roof runoff for garden irrigation. Its contents are not drinking water.';
 const batch={sourceId:bound.source.id,previousCursor:'c0',events:[{kind:'turn',role:'primary',status:'completed',turnId:'source-turn',versionId:'v1',cursor:'c1',user:{role:'user',content:user},assistant:{role:'assistant',channel:'final',content:assistant},sourceHash:hash(JSON.stringify([user,assistant]))}]};await call('turn-ingest',{batch,proof:proof({purpose:'completed-turn-ingestion',sourceId:bound.source.id,batchHash:hash(JSON.stringify(batch))})});
 let status;for(let i=0;i<140;i++){status=await call('organizer-status',{topicId});if(status.pauseReason||status.tasks[0]&&!['running','retry'].includes(status.tasks[0].status))break;await new Promise(r=>setTimeout(r,500));}
 const task=status.tasks[0],state=await runtimeOperation(project,'state',topicId);await call('stop');started=false;const reopened=await runtimeOperation(project,'state',topicId);started=true;
 console.log(JSON.stringify({platform:process.platform,version:'0.2.1-rc.2',source:'synthetic-signed-acceptance-not-current-chat',project,topicId,task,revision:state.revision,cards:state.canvas.nodes.length,reopenedRevision:reopened.revision}));
 if(task?.status!=='committed'||!task.process?.exitConfirmed||state.revision!==reopened.revision)process.exitCode=1;
}catch(e){console.log(JSON.stringify({platform:process.platform,error:e.code??e.message,project}));process.exitCode=1;}finally{if(started)await call('stop');delete process.env.BANG_ORGANIZER_DSH;}
