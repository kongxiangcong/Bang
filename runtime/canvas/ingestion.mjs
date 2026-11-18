import {invalidateSourceBasis} from './evidence.mjs';
import {topicPath} from './store.mjs';
import {reconcile,preparePublication,observed,recoveryError} from './publication.mjs';
import {captureHumanIntent} from './human-intent.mjs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {openBindingDatabase} from './binding.mjs';
import {SignedSessionConnector} from '../native/session-connector.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
function open(project){
 const db=openBindingDatabase(project);
 db.exec(`CREATE TABLE IF NOT EXISTS completed_sources(id TEXT PRIMARY KEY, binding TEXT NOT NULL, topic TEXT NOT NULL, turn_id TEXT NOT NULL, version_id TEXT NOT NULL, source_hash TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(binding,turn_id,version_id));
 CREATE TABLE IF NOT EXISTS ingestion_queue(source_id TEXT PRIMARY KEY, topic TEXT NOT NULL, state TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS ingestion_backfills(id TEXT PRIMARY KEY, binding TEXT NOT NULL, metadata TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS ingestion_batches(hash TEXT PRIMARY KEY, receipt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS ingestion_gaps(id TEXT PRIMARY KEY, binding TEXT NOT NULL, topic TEXT NOT NULL, cursor TEXT NOT NULL, reason TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS ingestion_ignored(id TEXT PRIMARY KEY, binding TEXT NOT NULL, topic TEXT NOT NULL, cursor TEXT NOT NULL, reason TEXT NOT NULL);`);
 return db;
}
function string(value){return typeof value==='string'&&value.length>0&&value.length<=256;}
export function ingestTurns(project,workspaceId,input){
 const db=open(project);try{
  const {proof,batch}=input??{},registration=db.prepare('SELECT registration FROM session_connectors WHERE id=?').get(proof?.connectorId??'');
  if(!registration)throw Error('Ingestion trusted connector required');
  const claims=new SignedSessionConnector(JSON.parse(registration.registration)).verifyProof(proof,workspaceId,'completed-turn-ingestion');
  const signed=JSON.parse(Buffer.from(proof.payload,'base64url').toString('utf8'));
  if(signed.purpose!=='completed-turn-ingestion'||!batch||signed.sourceId!==batch.sourceId||signed.batchHash!==hash(JSON.stringify(batch)))throw Error('Ingestion scoped proof rejected');
  const binding=db.prepare('SELECT * FROM binding_sources WHERE id=?').get(batch.sourceId);
  const sessionKey=hash(JSON.stringify([proof.connectorId,claims.host,claims.instanceId,claims.sessionId]));
  if(!binding||binding.session_key!==sessionKey||(!claims.scope.includes('*')&&!claims.scope.includes(binding.topic)))throw Error('Ingestion source outside authorized scope');
  const file=topicPath(project,binding.topic);reconcile(db,project,binding.topic,file);
  const board=db.prepare('SELECT * FROM topics WHERE topic=?').get(binding.topic);if(observed(file)!==board.hash)throw recoveryError('Canvas externally changed; recovery required');
  const metadata=JSON.parse(binding.metadata),batchHash=hash(JSON.stringify(batch));
  const previous=db.prepare('SELECT receipt FROM ingestion_batches WHERE hash=?').get(batchHash);
  if(previous)return {...JSON.parse(previous.receipt),duplicate:true};
  if(!binding.active)throw Error('Source reception frozen');
  if(metadata.receptionStopped){
   if(batch.backfillId)throw Error('Reception stopped; historical backfill disabled');
   if(batch.previousCursor!==(metadata.discardCursor??metadata.receivedCursor??metadata.startCursor))throw Error('Disabled interval observation cursor mismatch');
   if(!Array.isArray(batch.events)||!batch.events.length||batch.events.length>100||batch.events.some(e=>!string(e.cursor)))throw Error('Bounded checkpoint events required');
   const event=batch.events[0],resume=batch.events.length===1&&event.kind==='reception-boundary';
   if(resume&&!string(event.turnId))throw Error('Verified resume turn identity required');
   if(resume&&!metadata.resumeRequested)throw Error('Explicit reception resume required');
   if(resume){metadata.receptionStopped=false;metadata.resumeRequested=false;metadata.receivedCursor=event.cursor;metadata.callingTurnObserved=true;const interval=metadata.receptionIntervals.at(-1);interval.endCursor=event.cursor;interval.resumedAt=new Date().toISOString();delete metadata.discardCursor;}
   else metadata.discardCursor=batch.events.at(-1).cursor;
   const receipt={received:0,ignored:batch.events.length,gaps:0,receivedCursor:metadata.receivedCursor??metadata.startCursor,discardCursor:metadata.discardCursor,receptionStopped:metadata.receptionStopped,duplicate:false};
   db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE binding_sources SET metadata=? WHERE id=?').run(JSON.stringify(metadata),binding.id);db.prepare('INSERT INTO ingestion_batches VALUES(?,?)').run(batchHash,JSON.stringify(receipt));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return receipt;
  }
  if(batch.events?.some(e=>e.kind==='reception-boundary'))throw Error('No stopped interval to resume');
  const rangeRow=batch.backfillId?db.prepare('SELECT metadata FROM ingestion_backfills WHERE id=? AND binding=?').get(batch.backfillId,binding.id):null;
  if(batch.backfillId&&!rangeRow)throw Error('Explicit historical backfill authorization required');
  const range=rangeRow?JSON.parse(rangeRow.metadata):null,boundary=range??metadata;
  if(range?.complete)throw Error('Historical backfill range complete');
  if(batch.previousCursor!==(boundary.receivedCursor??boundary.startCursor))throw Error('Ingestion cursor mismatch; replay from durable boundary');
  if(!Array.isArray(batch.events)||batch.events.length<1||batch.events.length>100)throw Error('Bounded ingestion events required');
  let received=0,ignored=0,gaps=0,cursor=batch.previousCursor;
  db.exec('BEGIN IMMEDIATE');
  try{
   for(const event of batch.events){
    if(!string(event.cursor)||event.cursor===cursor)throw Error('Distinct event cursor required');
    if(!(boundary.callingTurnObserved??(!range&&metadata.completedTurns>0))&&(event.kind==='gap'||(event.kind==='turn'&&event.role==='primary'&&event.status==='completed'&&event.assistant?.channel==='final'))&&event.turnId!==boundary.startTurnId)throw Error('Calling turn boundary required; missing record must be explicit');
    if(event.kind==='gap'){
     if(event.reason!=='missing-record')throw Error('Explicit missing-record gap required');
     db.prepare('INSERT INTO ingestion_gaps VALUES(?,?,?,?,?)').run(randomUUID(),binding.id,binding.topic,event.cursor,'missing-record');gaps++;boundary.callingTurnObserved=true;
    }else if(event.kind!=='turn'||event.role!=='primary'||event.status!=='completed'||event.user?.role!=='user'||event.assistant?.role!=='assistant'||event.assistant?.channel!=='final'){
     // Metadata only: ignored outputs never become source text. An incomplete
     // primary turn keeps its cursor so its later verified completion can retry.
     if(event.kind==='turn'&&event.role==='primary'&&event.status==='incomplete')throw Error('Incomplete primary turn; completion boundary retained');
     const reason=event.role!=='primary'?'non-primary':event.kind!=='turn'?'non-turn':event.status!=='completed'?'not-completed':'non-final';
     db.prepare('INSERT INTO ingestion_ignored VALUES(?,?,?,?,?)').run(randomUUID(),binding.id,binding.topic,event.cursor,reason);ignored++;
     if(event.kind==='turn'&&event.role==='primary'&&['error','interrupted'].includes(event.status)){db.prepare('INSERT INTO ingestion_gaps VALUES(?,?,?,?,?)').run(randomUUID(),binding.id,binding.topic,event.cursor,event.status);gaps++;if(event.turnId===boundary.startTurnId)boundary.callingTurnObserved=true;}
    }else{
     if(!string(event.turnId)||!string(event.versionId)||typeof event.user.content!=='string'||typeof event.assistant.content!=='string'||event.sourceHash!==hash(JSON.stringify([event.user.content,event.assistant.content])))throw Error('Verified source version and content hash required');
     boundary.callingTurnObserved=true;
     const old=db.prepare('SELECT source_hash FROM completed_sources WHERE binding=? AND turn_id=? AND version_id=?').get(binding.id,event.turnId,event.versionId);
     if(old&&old.source_hash!==event.sourceHash)throw Error('Source version reused for different content');
     if(!old){
      const id=randomUUID(),body={id,bindingId:binding.id,topicId:binding.topic,turnId:event.turnId,versionId:event.versionId,sourceHash:event.sourceHash,cursor:event.cursor,user:{role:'user',content:event.user.content},assistant:{role:'assistant',channel:'final',content:event.assistant.content}};
      body.current=true;
      for(const prior of db.prepare('SELECT id,body FROM completed_sources WHERE binding=? AND turn_id=?').all(binding.id,event.turnId)){const previous=JSON.parse(prior.body);previous.current=false;previous.supersededBy=id;db.prepare('UPDATE completed_sources SET body=? WHERE id=?').run(JSON.stringify(previous),prior.id);db.prepare("UPDATE ingestion_queue SET state='superseded' WHERE source_id=? AND state='pending'").run(prior.id);}
      body.humanIntent=captureHumanIntent(event.user.content,JSON.parse(db.prepare('SELECT state FROM topics WHERE topic=?').get(binding.topic).state));
      db.prepare('INSERT INTO completed_sources VALUES(?,?,?,?,?,?,?)').run(id,binding.id,binding.topic,event.turnId,event.versionId,event.sourceHash,JSON.stringify(body));
      db.prepare("INSERT INTO ingestion_queue VALUES(?,?,'pending')").run(id,binding.topic);received++;
     }
    }
    if(range&&cursor===range.endCursor)throw Error('Historical backfill exceeds selected boundary');
    cursor=event.cursor;
   }
   // Fault seam is restricted to an explicitly selected synthetic project.
   if(process.env.BANG_INGESTION_TEST_PROJECT&&path.resolve(process.env.BANG_INGESTION_TEST_PROJECT)===path.resolve(project)&&process.env.BANG_INGESTION_TEST_FAULT==='after-source')process.exit(86);
   boundary.receivedCursor=cursor;
   if(range){range.complete=cursor===range.endCursor;db.prepare('UPDATE ingestion_backfills SET metadata=? WHERE id=?').run(JSON.stringify(range),batch.backfillId);}
   metadata.completedTurns+=received;metadata.backlog=db.prepare("SELECT count(*) AS n FROM ingestion_queue q JOIN completed_sources s ON s.id=q.source_id WHERE s.binding=? AND q.state='pending'").get(binding.id).n;metadata.gaps=(metadata.gaps??0)+gaps;metadata.ignored=(metadata.ignored??0)+ignored;
   db.prepare('UPDATE binding_sources SET metadata=? WHERE id=?').run(JSON.stringify(metadata),binding.id);
   const receipt={received,ignored,gaps,receivedCursor:cursor,duplicate:false};
   const currentRows=db.prepare('SELECT id,body FROM completed_sources WHERE topic=? ORDER BY rowid').all(binding.topic);
   const currentIds=new Set(currentRows.filter((r,i)=>{const s=JSON.parse(r.body);return s.current??!currentRows.slice(i+1).some(n=>{const v=JSON.parse(n.body);return v.bindingId===s.bindingId&&v.turnId===s.turnId;});}).map(r=>r.id));
   const next=invalidateSourceBasis(JSON.parse(board.state),currentIds);
   if(next)preparePublication(db,binding.topic,{operation:'source-version-'+batchHash,request:JSON.stringify({batchHash}),state:next,receipt:{operationId:'source-version-'+batchHash,topic:binding.topic,revision:next.revision,status:'committed'}});
   db.prepare('INSERT INTO ingestion_batches VALUES(?,?)').run(batchHash,JSON.stringify(receipt));db.exec('COMMIT');
   reconcile(db,project,binding.topic,file);return receipt;
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
 }finally{db.close();}
}
export function turnStatus(project,input){
 const db=open(project);try{
  const topic=input?.topicId??'',rows=db.prepare('SELECT s.id,s.binding,s.turn_id,s.version_id,s.source_hash,s.body,q.state FROM completed_sources s JOIN ingestion_queue q ON q.source_id=s.id WHERE s.topic=? ORDER BY s.rowid').all(topic);
  const versions=rows.map((s,i)=>({id:s.id,bindingId:s.binding,turnId:s.turn_id,versionId:s.version_id,sourceHash:s.source_hash,processing:s.state,current:JSON.parse(s.body).current??!rows.slice(i+1).some(n=>n.binding===s.binding&&n.turn_id===s.turn_id)}));
  // Legacy rows predate explicit current flags. Their last received version is
  // current, and an obsolete pending version must never be scheduled again.
  versions.forEach((v,i)=>{if(!v.current&&rows[i].state==='pending'){rows[i].state='superseded';v.processing='superseded';}});
  return {versions,received:rows.length,frozen:rows.filter(s=>s.state==='frozen').length,frozenSources:rows.filter(s=>s.state==='frozen').map(s=>({id:s.id,bindingId:s.binding,turnId:s.turn_id,versionId:s.version_id,sourceHash:s.source_hash})),organized:rows.filter(s=>s.state==='organized').length,backlog:rows.filter(s=>s.state==='pending').length,pending:rows.filter(s=>s.state==='pending').map(s=>({id:s.id,bindingId:s.binding,turnId:s.turn_id,versionId:s.version_id,sourceHash:s.source_hash})),gaps:db.prepare('SELECT binding AS bindingId,cursor,reason FROM ingestion_gaps WHERE topic=? ORDER BY rowid').all(topic),ignored:db.prepare('SELECT binding AS bindingId,cursor,reason FROM ingestion_ignored WHERE topic=? ORDER BY rowid').all(topic)};
 }finally{db.close();}
}
function sourceFromDatabase(db,input){
 const row=db.prepare('SELECT body FROM completed_sources WHERE topic=? AND id=?').get(input?.topicId??'',input?.id??'');if(!row)throw Error('Unknown source in topic');const source=JSON.parse(row.body);
 // The existing (binding,turn_id,version_id) index bounds this lookup to one
 // source identity. Loading every topic version for each batch member makes
 // CompletedTurn preparation grow with unrelated retained history.
 const rows=db.prepare('SELECT s.id,s.binding,s.turn_id,s.version_id,s.source_hash,s.body FROM completed_sources s JOIN ingestion_queue q ON q.source_id=s.id WHERE s.topic=? AND s.binding=? AND s.turn_id=? ORDER BY s.rowid').all(input.topicId,source.bindingId,source.turnId);
 const versions=rows.map((s,i)=>({id:s.id,bindingId:s.binding,turnId:s.turn_id,versionId:s.version_id,sourceHash:s.source_hash,current:JSON.parse(s.body).current??(i===rows.length-1)}));return {...source,current:versions.find(v=>v.id===source.id).current,currentVersionId:versions.find(v=>v.current)?.versionId,history:versions};
}

// One read connection for the Organizer's bounded source batch; source identity,
// lineage and currentness are still resolved by the exact same scalar reader.
export function turnSources(project,topicId,ids){
 const db=open(project);try{return ids.map(id=>sourceFromDatabase(db,{topicId,id}));}finally{db.close();}
}
export function turnSource(project,input){
 const db=open(project);try{return sourceFromDatabase(db,input);}finally{db.close();}
}

export function authorizeBackfill(project,input){
 if(input?.confirmHistory!==true||!string(input.startCursor)||!string(input.startTurnId))throw Error('Explicit historical range confirmation required');
 const db=open(project);try{
  const session=db.prepare('SELECT * FROM verified_sessions WHERE token_hash=?').get(hash(String(input.sessionToken??'')));
  const source=db.prepare('SELECT * FROM binding_sources WHERE id=? AND active=1').get(input.sourceId??'');
  if(!session||!source||source.session_key!==session.session_key)throw Error('Historical backfill capability rejected');
  const claims=JSON.parse(session.claims);if(!claims.scope.includes('*')&&!claims.scope.includes(source.topic))throw Error('Historical backfill outside authorized scope');
  const metadata=JSON.parse(source.metadata);
  if(input.startCursor===metadata.startCursor)throw Error('Historical start must precede calling turn');
  const range={id:randomUUID(),startCursor:input.startCursor,startTurnId:input.startTurnId,endCursor:metadata.startCursor,receivedCursor:null,callingTurnObserved:false,complete:false};
  db.prepare('INSERT INTO ingestion_backfills VALUES(?,?,?)').run(range.id,source.id,JSON.stringify(range));return range;
 }finally{db.close();}
}

