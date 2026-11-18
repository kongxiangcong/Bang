import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {historyStatistics,revisionText,encodeRevision} from './history-storage.mjs';
import {readCommitted} from './store.mjs';
import {exportProject} from './backup.mjs';

const database=project=>path.join(project,'.bang','board.sqlite');
const warningBytes=256*1024*1024;
export const logLimit=8192;
// Operational diagnostics contain no user text, prompts, credentials or source IDs.
// Two reserved files; history remains in SQLite and is never subject to rotation.
export function logPublication(project,revision){
 try{
  const dir=path.join(project,'.bang','runtime'),file=path.join(dir,'events.jsonl'),old=path.join(dir,'events.previous.jsonl');
  for(const reserved of [file,old])if(fs.existsSync(reserved)&&fs.lstatSync(reserved).isSymbolicLink())return;
  const line=JSON.stringify({at:new Date().toISOString(),event:'publication-confirmed',revision})+'\n';
  if(fs.existsSync(file)&&fs.statSync(file).size+Buffer.byteLength(line)>logLimit){if(fs.existsSync(old))fs.unlinkSync(old);fs.renameSync(file,old);}
  fs.appendFileSync(file,line,{mode:0o600});
 }catch{/* Diagnostics must not turn a committed save into failure. */}
}
function temporaryFiles(project,db){
 // Only publisher-owned scratch with no pending publication can be discarded.
 const ownedDirectory=topic=>{
  try{return ['.bang',path.join('.bang','topics'),path.join('.bang','topics',topic)].every(relative=>{const stat=fs.lstatSync(path.join(project,relative));return stat.isDirectory()&&!stat.isSymbolicLink();});}catch{return false;}
 };
 return db.prepare('SELECT topic FROM topics').all().filter(({topic})=>ownedDirectory(topic)&&!db.prepare("SELECT 1 FROM intents WHERE topic=? AND status='prepared'").get(topic)).flatMap(({topic})=>['publish.tmp','preserve.tmp'].map(name=>path.join('.bang','topics',topic,name))).filter(relative=>{try{return fs.lstatSync(path.join(project,relative)).isFile()&&!fs.lstatSync(path.join(project,relative)).isSymbolicLink();}catch{return false;}}).map(relative=>({path:relative,bytes:fs.statSync(path.join(project,relative)).size}));
}
export async function historyCapacity(project,topic){
 await readCommitted(project,topic);const db=new DatabaseSync(database(project),{readOnly:true});
 try{
  const bytes=fs.statSync(database(project)).size,pageSize=db.prepare('PRAGMA page_size').get().page_size,freePages=db.prepare('PRAGMA freelist_count').get().freelist_count;
  const hasTasks=db.prepare("SELECT 1 FROM sqlite_master WHERE name='organizer_tasks'").get();
  const tasks=hasTasks?db.prepare('SELECT body FROM organizer_tasks WHERE topic=?').all(topic).map(r=>JSON.parse(r.body)):[];
  const attempts=tasks.flatMap(t=>t.attempts??[]),reported=attempts.filter(a=>a.usage);
  return {...historyStatistics(db,topic),databaseBytes:bytes,reclaimableBytes:pageSize*freePages,warningBytes,warning:bytes>=warningBytes?'capacity-warning':'within-limit',temporaryFiles:temporaryFiles(project,db),logs:{files:2,maxBytesEach:logLimit},modelUsage:{attempts:attempts.length,reportedAttempts:reported.length,inputTokens:reported.reduce((n,a)=>n+(a.usage.inputTokens??0),0),outputTokens:reported.reduce((n,a)=>n+(a.usage.outputTokens??0),0),unreportedAttempts:attempts.length-reported.length}};
 }finally{db.close();}
}
const fingerprint=project=>createHash('sha256').update(fs.readFileSync(database(project))).digest('hex');
export async function maintenancePreview(project,topic,input){
 if(!['compact','archive'].includes(input?.action))throw Error('Select archive or compact explicitly');
 const capacity=await historyCapacity(project,topic);
 const backup=input.action==='archive'?await exportProject(project):null;
 return {action:input.action,topic,fingerprint:fingerprint(project),...(backup?{archiveSha256:backup.sha256,archiveBytes:Buffer.byteLength(JSON.stringify(backup)),archiveLimitBytes:48*1024*1024}:{}),revisionsRetained:capacity.revisions,historyDeleted:0,sourcesDeleted:0,temporaryFiles:input.action==='compact'?capacity.temporaryFiles:[],reclaimableBytes:capacity.reclaimableBytes,scope:input.action==='archive'?'complete-project-copy':'lossless-project-compaction',warning:'All history and sources retained. Archive copies require explicit download; compaction removes only reserved scratch and unused database pages.'};
}
export async function maintenanceConfirm(project,topic,input){
 if(input?.confirm!==true)throw Error('Explicit maintenance confirmation required');
 const preview=await maintenancePreview(project,topic,input);
 if(input.topic!==topic||input.fingerprint!==preview.fingerprint)throw Error('Maintenance preview conflict; inspect again');
 if(input.action==='archive'){
  const backup=await exportProject(project);
  if(input.archiveSha256!==backup.sha256)throw Error('Archive preview conflict; inspect again');
  return {status:'archived-copy',historyDeleted:0,backup};
 }
 const db=new DatabaseSync(database(project));
 try{
  if(db.prepare("SELECT 1 FROM intents WHERE status='prepared'").get())throw Error('Publication recovery required before compaction');
  db.exec('BEGIN IMMEDIATE');
  try{
   for(const {topic:id} of db.prepare('SELECT topic FROM topics').all()){
    let previous=null;
    for(const {revision} of db.prepare('SELECT revision FROM revisions WHERE topic=? ORDER BY revision').all(id)){
     const state=JSON.parse(revisionText(db,id,revision));
     db.prepare('UPDATE revisions SET state=? WHERE topic=? AND revision=?').run(encodeRevision(db,id,state,previous),id,revision);previous=state;
    }
   }
   for(const row of db.prepare("SELECT topic,operation,receipt FROM intents WHERE status='confirmed'").all())db.prepare('UPDATE intents SET state=? WHERE topic=? AND operation=?').run(JSON.stringify({encoding:'bang-revision-reference-v1',revision:JSON.parse(row.receipt).revision}),row.topic,row.operation);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  for(const file of temporaryFiles(project,db))fs.unlinkSync(path.join(project,file.path));
  db.exec('VACUUM');
 }finally{db.close();}
 return {status:'compacted',historyDeleted:0,sourcesDeleted:0,capacity:await historyCapacity(project,topic)};
}
