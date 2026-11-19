import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,randomBytes,createHash,createPublicKey} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {generateBoard,readCommitted} from './store.mjs';
import {SignedSessionConnector} from '../native/session-connector.mjs';

// Called only by the project Runtime owner. Metadata shares the board database;
// board creation always goes through the existing committed-board publisher.
export function openBindingDatabase(project){
 fs.mkdirSync(path.join(project,'.bang'),{recursive:true,mode:0o700});
 const database=path.join(project,'.bang','board.sqlite'),fresh=!fs.existsSync(database);
 const db=new DatabaseSync(database);if(fresh&&process.platform!=='win32')fs.chmodSync(database,0o600);
 db.exec('PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS topic_names(topic TEXT PRIMARY KEY, name TEXT NOT NULL)');
 db.exec(`CREATE TABLE IF NOT EXISTS session_connectors(id TEXT PRIMARY KEY, registration TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS verified_sessions(session_key TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, claims TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS session_proofs(connector TEXT NOT NULL, nonce TEXT NOT NULL, PRIMARY KEY(connector,nonce));
 CREATE TABLE IF NOT EXISTS takeover_previews(token_hash TEXT PRIMARY KEY, session_key TEXT NOT NULL, topic TEXT NOT NULL, source_id TEXT NOT NULL, observed TEXT NOT NULL, expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS binding_sources(id TEXT PRIMARY KEY, topic TEXT NOT NULL, session_key TEXT NOT NULL, metadata TEXT NOT NULL, active INTEGER NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS active_topic_source ON binding_sources(topic) WHERE active=1;
 CREATE UNIQUE INDEX IF NOT EXISTS active_session_topic ON binding_sources(session_key) WHERE active=1;`);
 return db;
}
const hash=value=>createHash('sha256').update(value).digest('hex');
export function registerConnector(project,input){
 if(!input||!/^[-a-zA-Z0-9_]+$/.test(input.id)||typeof input.host!=='string'||!input.host||input.host.length>256)throw Error('Invalid connector registration');
 if(!Array.isArray(input.versions)||!input.versions.length||input.versions.some(v=>typeof v!=='string'||!v||v.length>256))throw Error('Explicit supported connector versions required');
 if(createPublicKey(input.publicKey).asymmetricKeyType!=='ed25519')throw Error('Ed25519 connector key required');
 const db=openBindingDatabase(project);try{db.prepare('INSERT INTO session_connectors VALUES(?,?)').run(input.id,JSON.stringify({host:input.host,versions:input.versions,publicKey:input.publicKey}));}finally{db.close();}
 return {id:input.id,host:input.host};
}
export function connectSession(project,workspaceId,proof){
 const db=openBindingDatabase(project);try{
  const row=db.prepare('SELECT registration FROM session_connectors WHERE id=?').get(proof?.connectorId??'');
  if(!row)throw Error('Binding unavailable: trusted connector not installed');
  const claims=new SignedSessionConnector(JSON.parse(row.registration)).verifyProof(proof,workspaceId);
  if(db.prepare('SELECT 1 FROM session_proofs WHERE connector=? AND nonce=?').get(proof.connectorId,claims.nonce))throw Error('Session proof already used; obtain a fresh host handshake');
  const sessionKey=hash(JSON.stringify([proof.connectorId,claims.host,claims.instanceId,claims.sessionId]));
  const sessionToken=randomBytes(32).toString('hex');
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare('INSERT INTO session_proofs VALUES(?,?)').run(proof.connectorId,claims.nonce);
   db.prepare('INSERT INTO verified_sessions VALUES(?,?,?) ON CONFLICT(session_key) DO UPDATE SET token_hash=excluded.token_hash,claims=excluded.claims').run(sessionKey,hash(sessionToken),JSON.stringify(claims));
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return {sessionToken,identity:{host:claims.host,sessionId:claims.sessionId,workspaceId}};
 }finally{db.close();}
}
function session(db,input){
 if(typeof input?.sessionToken!=='string')throw Error('Binding unavailable: verified session capability required');
 const row=db.prepare('SELECT * FROM verified_sessions WHERE token_hash=?').get(hash(input.sessionToken));
 if(!row)throw Error('Binding unavailable: verified session capability rejected');
 return {...row,claims:JSON.parse(row.claims)};
}
function boundResult(project,row){return {status:'bound',topic:listTopics(project).find(t=>t.id===row.topic),source:{id:row.id,...JSON.parse(row.metadata)}};}
export function bindingStatus(project,input){
 const db=openBindingDatabase(project);try{const s=session(db,input),row=db.prepare('SELECT * FROM binding_sources WHERE session_key=? AND active=1').get(s.session_key);return row?boundResult(project,row):{status:'unbound',identity:{host:s.claims.host,sessionId:s.claims.sessionId}};}finally{db.close();}
}
export function bindingSources(project,input){
 const db=openBindingDatabase(project);try{return db.prepare('SELECT * FROM binding_sources WHERE topic=? ORDER BY rowid').all(input?.topicId??'').map(row=>({id:row.id,active:!!row.active,...JSON.parse(row.metadata)}));}finally{db.close();}
}
export async function enableBinding(project,input,epoch){
 const db=openBindingDatabase(project);try{
  const s=session(db,input),current=db.prepare('SELECT * FROM binding_sources WHERE session_key=? AND active=1').get(s.session_key);
  if(current&&(!input.topicId||input.topicId===current.topic)){
   if(!s.claims.scope.includes('*')&&!s.claims.scope.includes(current.topic))throw Error('Topic outside authorized scope');
   return boundResult(project,current);
  }
  let topics=listTopics(project),topic=input.topicId?topics.find(t=>t.id===input.topicId):undefined;
  if(input.topicId&&!topic)throw Error('Unknown topic');
  if(!topic&&topics.length===0){if(!s.claims.scope.includes('*'))throw Error('Topic outside authorized scope');topic=await createTopic(project,{name:'默认专题'});}
  if(!topic&&topics.length===1)topic=topics[0];
  if(!topic)return {status:'selection-required',topics};
  if(!s.claims.scope.includes('*')&&!s.claims.scope.includes(topic.id))throw Error('Topic outside authorized scope');
  await readCommitted(project,topic.id);
  const old=db.prepare('SELECT * FROM binding_sources WHERE topic=? AND active=1').get(topic.id);
  const observed=hash(JSON.stringify([old?.id,old?.metadata,db.prepare('SELECT revision FROM topics WHERE topic=?').get(topic.id).revision,epoch]));
  if(input.confirmation){
   const preview=db.prepare('SELECT * FROM takeover_previews WHERE token_hash=?').get(hash(String(input.confirmation)));
   if(!preview||preview.session_key!==s.session_key||preview.topic!==topic.id||preview.source_id!==old?.id||preview.observed!==observed||preview.expires<Date.now())throw Error('Takeover confirmation stale or mismatched; preview again');
  }else if(old){
   const confirmation=randomBytes(32).toString('hex'),oldSource={id:old.id,...JSON.parse(old.metadata)};
   db.prepare('INSERT INTO takeover_previews VALUES(?,?,?,?,?,?)').run(hash(confirmation),s.session_key,topic.id,old.id,observed,Date.now()+300000);
   return {status:'takeover-required',topic,oldSource,backlog:oldSource.backlog,confirmation};
  }
  const source={host:s.claims.host,version:s.claims.version,instanceId:s.claims.instanceId,sessionId:s.claims.sessionId,startTurnId:s.claims.turnId,startCursor:s.claims.cursor,receivedCursor:null,completedTurns:0,backlog:0};
  const id=randomUUID();db.exec('BEGIN IMMEDIATE');
  try{
   for(const previous of [current,old].filter(Boolean)){
    const metadata=JSON.parse(previous.metadata);metadata.endCursor=metadata.receivedCursor??metadata.startCursor;metadata.closedAt=new Date().toISOString();
    db.prepare('UPDATE binding_sources SET active=0,metadata=? WHERE id=?').run(JSON.stringify(metadata),previous.id);
   }
   db.prepare('INSERT INTO binding_sources VALUES(?,?,?,?,1)').run(id,topic.id,s.session_key,JSON.stringify(source));
   if(input.confirmation)db.prepare('DELETE FROM takeover_previews WHERE token_hash=?').run(hash(String(input.confirmation)));
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return {status:'bound',topic,source:{id,...source}};
 }finally{db.close();}
}
export function listTopics(project){
 const db=openBindingDatabase(project);
 try{
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='topics'").get())return [];
  return db.prepare("SELECT t.topic AS id, COALESCE(n.name,t.topic) AS name FROM (SELECT topic FROM topics UNION SELECT topic FROM intents WHERE status='prepared') t LEFT JOIN topic_names n ON t.topic=n.topic ORDER BY t.topic").all().map(row=>({...row}));
 }finally{db.close();}
}
export async function createTopic(project,input){
 if(typeof input?.name!=='string'||!input.name.trim()||input.name.length>120)throw Error('Topic name required (1–120 characters)');
 const id=randomUUID();
 const db=openBindingDatabase(project);try{db.prepare('INSERT INTO topic_names VALUES(?,?)').run(id,input.name.trim());}finally{db.close();}
 await generateBoard(project,id,{cards:[]});
 return {id,name:input.name.trim()};
}
