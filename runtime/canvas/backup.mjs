import {revisionText} from './history-storage.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readCommitted} from './store.mjs';
import {validateCanvas,safeResourcePath,parseExtra} from './contract.ts';
import {resourceStatus} from './resources.mjs';

// Logical SQLite snapshot: fixed schemas, parameterized values, no SQL from a package.
// One native owner queue + one read transaction establishes the database cut.
const schemas={
 context_turns:'id TEXT PRIMARY KEY,topic TEXT NOT NULL,body TEXT NOT NULL',
 organizer_project:'id INTEGER PRIMARY KEY,body TEXT NOT NULL',
 organizer_topics:'topic TEXT PRIMARY KEY,enabled INTEGER NOT NULL',
 organizer_tasks:'id TEXT PRIMARY KEY,topic TEXT NOT NULL,source_id TEXT NOT NULL UNIQUE,body TEXT NOT NULL',
 topics:'topic TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL, hash TEXT NOT NULL',
 revisions:'topic TEXT, revision INTEGER, state TEXT NOT NULL, PRIMARY KEY(topic,revision)',
 intents:'topic TEXT, operation TEXT, request TEXT NOT NULL, state TEXT NOT NULL, hash TEXT NOT NULL, receipt TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(topic,operation)',
 topic_names:'topic TEXT PRIMARY KEY, name TEXT NOT NULL',
 binding_sources:'id TEXT PRIMARY KEY, topic TEXT NOT NULL, session_key TEXT NOT NULL, metadata TEXT NOT NULL, active INTEGER NOT NULL',
 completed_sources:'id TEXT PRIMARY KEY, binding TEXT NOT NULL, topic TEXT NOT NULL, turn_id TEXT NOT NULL, version_id TEXT NOT NULL, source_hash TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(binding,turn_id,version_id)',
 ingestion_queue:'source_id TEXT PRIMARY KEY, topic TEXT NOT NULL, state TEXT NOT NULL',
 ingestion_gaps:'id TEXT PRIMARY KEY, binding TEXT NOT NULL, topic TEXT NOT NULL, cursor TEXT NOT NULL, reason TEXT NOT NULL',
 ingestion_ignored:'id TEXT PRIMARY KEY, binding TEXT NOT NULL, topic TEXT NOT NULL, cursor TEXT NOT NULL, reason TEXT NOT NULL',
};
const excluded=new Set(['context_bridges','context_proofs','session_connectors','verified_sessions','session_proofs','takeover_previews','ingestion_backfills','ingestion_batches']);
const digest=value=>createHash('sha256').update(value).digest('hex');
const hashJSON=value=>digest(JSON.stringify(value));
// Internal migration boundary: the normal closed-schema verifier and independent
// restore publisher still validate every generated package.
export function legacyBackup(topic,states){
 const tables=Object.fromEntries(Object.keys(schemas).map(k=>[k,[]]));
 const current=states.at(-1),state=JSON.stringify(current);
 tables.topics=[{topic,revision:current.revision,state,hash:digest(JSON.stringify(current.canvas,null,2)+'\n')}];
 tables.revisions=states.map(s=>({topic,revision:s.revision,state:JSON.stringify(s)}));
 tables.topic_names=[{topic,name:'旧项目迁移'}];
 const payload={tables,attachments:[]},backup={format:'bang-project-backup',version:1,payload,sha256:hashJSON(payload)};inspect(backup);return backup;
}
const limit=48*1024*1024;
function resourcePath(value){
 const relative=safeResourcePath(value);
 // Portable destination names; no credentials, runtime files, hidden configuration,
 // Windows aliases, alternate streams or device names, even on Linux.
 if(relative.split('/').some(p=>p.startsWith('.')||/[ .]$/.test(p)||/[<>:"|?*]/.test(p)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)))throw Error('Backup resource outside authorized portable attachment paths');
 return relative;
}
function references(tables){
 const paths=new Set();
 for(const row of [...tables.topics,...tables.revisions,...tables.intents]){
  const state=JSON.parse(row.state);validateCanvas(state.canvas);for(const extra of state.editorExtras??[])parseExtra(extra);
  if(!Number.isSafeInteger(state.revision)||state.revision<0)throw Error('Invalid backup revision');
  for(const n of state.canvas.nodes){if(n.type==='file')paths.add(resourcePath(n.file));if(n.type==='group'&&n.background)paths.add(resourcePath(n.background));}
 }
 return [...paths].sort();
}
function createDatabase(file,tables){
 const db=new DatabaseSync(file);
 try{
  db.exec('PRAGMA synchronous=FULL; BEGIN');
  for(const [name,schema] of Object.entries(schemas)){
   db.exec(`CREATE TABLE ${name}(${schema})`);
   const columns=db.prepare(`PRAGMA table_info(${name})`).all().map(c=>c.name),insert=db.prepare(`INSERT INTO ${name} VALUES(${columns.map(()=>'?').join(',')})`);
   if(!Array.isArray(tables[name]))throw Error('Missing backup table');
   for(const row of tables[name]){
    if(!row||Object.keys(row).length!==columns.length||columns.some(c=>!Object.hasOwn(row,c)))throw Error('Invalid backup row');
    insert.run(...columns.map(c=>row[c]));
   }
  }
  db.exec('COMMIT');return db;
 }catch(e){db.close();throw e;}
}
function inspect(backup){
 if(!backup||backup.format!=='bang-project-backup'||backup.version!==1||!backup.payload||hashJSON(backup.payload)!==backup.sha256)throw Error('Backup manifest missing or corrupt');
 if(Buffer.byteLength(JSON.stringify(backup))>limit)throw Error('Backup exceeds 48 MiB package limit');
 const {tables,attachments}=backup.payload;
 if(!tables||Object.keys(tables).sort().join()!==Object.keys(schemas).sort().join()||!Array.isArray(attachments))throw Error('Backup tables or attachments missing');
 const db=createDatabase(':memory:',tables);
 try{
  if(!tables.topics.length)throw Error('Backup contains no committed topics');
  for(const row of tables.topics){
   if(!/^[a-zA-Z0-9_-]+$/.test(row.topic))throw Error('Unsafe backup topic');
   const state=JSON.parse(row.state),revision=db.prepare('SELECT state FROM revisions WHERE topic=? AND revision=?').get(row.topic,row.revision);
   if(state.revision!==row.revision||revision?.state!==row.state||digest(JSON.stringify(state.canvas,null,2)+'\n')!==row.hash)throw Error('Backup current revision or Canvas hash mismatch');
  }
  for(const row of [...tables.revisions,...tables.intents])if(!tables.topics.some(t=>t.topic===row.topic)||!/^[a-zA-Z0-9_-]+$/.test(row.topic))throw Error('Backup references unknown topic');
  if(tables.context_turns.some(r=>{const c=JSON.parse(r.body);return c.frozen!==true||c.token!==undefined||c.projection!==undefined||c.objects!==undefined||c.sources!==undefined||c.expiresAt!==0||!tables.topics.some(t=>t.topic===r.topic);}))throw Error('Backup ContextBridge authority must be frozen');
  if(tables.binding_sources.some(r=>r.active!==0)||tables.ingestion_queue.some(r=>!['frozen','organized'].includes(r.state)))throw Error('Backup authority must be frozen');
  for(const row of tables.organizer_project){const config=JSON.parse(row.body),bounds={concurrency:[1,8],timeoutMs:[10,3600000],callsPerHour:[1,10000],batchSize:[1,100]};if(row.id!==1||config.pauseReason!=='RESTORED_FROZEN'||!Array.isArray(config.calls)||config.calls.length>10000||config.calls.some(t=>!Number.isSafeInteger(t)||t<0)||!config.limits||Object.keys(config.limits).sort().join()!==Object.keys(bounds).sort().join()||Object.entries(bounds).some(([k,[min,max]])=>!Number.isSafeInteger(config.limits[k])||config.limits[k]<min||config.limits[k]>max))throw Error('Backup Organizer policy invalid or unfrozen');}
  if(tables.organizer_topics.some(r=>r.enabled!==0)||tables.organizer_tasks.some(r=>{const t=JSON.parse(r.body);return !['committed','no-change','failed','cancelled','skipped','frozen','superseded'].includes(t.status)||t.input!==undefined||t.baseline!==undefined||t.reorganization&&!t.reorganization.frozen||(t.proposals??[]).some(p=>p.status==='pending'&&!p.frozen);}))throw Error('Backup Organizer authority must be frozen');
  if(tables.completed_sources.some(r=>{const s=JSON.parse(r.body);return s.humanIntent?.classification==='explicit'&&!s.humanIntent.frozen;}))throw Error('Backup conversational authority must be frozen');
  if(tables.intents.some(r=>r.status!=='confirmed'))throw Error('Backup contains uncommitted publication');
  const refs=references(tables),seen=new Set();
  for(const a of attachments){
   resourcePath(a.path);const identity=a.path.toLowerCase();
   if(seen.has(identity)||!refs.includes(a.path))throw Error('Duplicate or unauthorized backup attachment');seen.add(identity);
   if(a.status==='missing'){if(a.data!==undefined||a.sha256!==undefined)throw Error('Invalid missing attachment');}
   else if(a.status!=='included'||typeof a.data!=='string'||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.data)||digest(Buffer.from(a.data,'base64'))!==a.sha256)throw Error('Backup attachment corrupt');
  }
  if(refs.length!==attachments.length||refs.some(r=>!attachments.some(a=>a.path===r)))throw Error('Backup attachment missing from manifest');
  return {valid:true,topics:tables.topics.map(t=>({id:t.topic,revision:t.revision})),revisions:tables.revisions.length,sources:tables.completed_sources.length,attachments:attachments.filter(a=>a.status==='included').length,missingAttachments:attachments.filter(a=>a.status==='missing').map(a=>a.path),sha256:backup.sha256};
 }finally{db.close();}
}
export async function exportProject(project){
 const file=path.join(project,'.bang','board.sqlite');
 if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw Error('Unsafe project database path');
 if(!fs.existsSync(file))throw Error('No project database to back up');
 let db=new DatabaseSync(file,{readOnly:true}),topics;
 try{topics=db.prepare('SELECT topic FROM topics').all();}finally{db.close();}
 for(const {topic} of topics)await readCommitted(project,topic);
 db=new DatabaseSync(file,{readOnly:true});let tables={};
 try{
  db.exec('BEGIN');const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name);
  if(names.some(n=>!Object.hasOwn(schemas,n)&&!excluded.has(n)))throw Error('Backup schema version unsupported; upgrade exporter');
  for(const name of Object.keys(schemas))tables[name]=names.includes(name)?db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all():[];
  for(const row of tables.revisions)row.state=revisionText(db,row.topic,row.revision);
  for(const row of tables.intents)if(JSON.parse(row.state).encoding==='bang-revision-reference-v1')row.state=revisionText(db,row.topic,JSON.parse(row.state).revision);
  db.exec('COMMIT');
 }finally{db.close();}
 for(const row of tables.context_turns){const c=JSON.parse(row.body);c.frozen=true;c.expiresAt=0;delete c.token;delete c.projection;delete c.objects;delete c.sources;row.body=JSON.stringify(c);}
 // A migration never carries authority to resume a host or replay old work.
 for(const row of tables.binding_sources){row.active=0;const m=JSON.parse(row.metadata);m.endCursor=m.receivedCursor??m.startCursor;m.restoredFrozen=true;m.frozenBacklog=m.backlog??0;m.backlog=0;row.metadata=JSON.stringify(m);}
 for(const row of tables.organizer_project){const config=JSON.parse(row.body);config.pauseReason='RESTORED_FROZEN';row.body=JSON.stringify(config);}
 for(const row of tables.organizer_topics)row.enabled=0;
 for(const row of tables.organizer_tasks){const task=JSON.parse(row.body);delete task.input;delete task.baseline;if(task.reorganization)task.reorganization.frozen=true;for(const proposal of task.proposals??[])if(proposal.status==='pending')proposal.frozen=true;if(['running','retry'].includes(task.status)){task.status='failed';task.error={code:'ATTEMPT_INTERRUPTED',message:'Restored attempt cannot resume'};}row.body=JSON.stringify(task);}
 for(const row of tables.completed_sources){const source=JSON.parse(row.body);if(source.humanIntent?.classification==='explicit')source.humanIntent.frozen=true;row.body=JSON.stringify(source);}
 for(const row of tables.ingestion_queue)if(row.state!=='organized')row.state='frozen';
 let size=Buffer.byteLength(JSON.stringify(tables));
 const captured=[];
 const attachments=references(tables).map(relative=>{
  const status=resourceStatus(project,relative).status;
  if(status==='missing')return {path:relative,status:'missing'};
  const file=path.join(project,relative),before=fs.statSync(file);size+=Math.ceil(before.size/3)*4;if(size>limit)throw Error('Backup exceeds 48 MiB package limit');
  const bytes=fs.readFileSync(file),after=fs.statSync(file);captured.push({file,size:after.size,mtimeMs:after.mtimeMs});
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('Attachment changed during backup; retry');
  return {path:relative,status:'included',sha256:digest(bytes),data:bytes.toString('base64')};
 });
 // Reject an external writer racing the committed snapshot. No current.canvas
 // bytes are copied: they are deterministically reconstructed from committed state.
 for(const capture of captured){const current=fs.statSync(capture.file);if(current.size!==capture.size||current.mtimeMs!==capture.mtimeMs)throw Error('Attachment changed during backup; retry');}
 for(const row of tables.topics)if(digest(fs.readFileSync(path.join(project,'.bang','topics',row.topic,'current.canvas')))!==row.hash)throw Error('Canvas changed during backup; retry');
 const payload={tables,attachments},backup={format:'bang-project-backup',version:1,payload,sha256:hashJSON(payload)};inspect(backup);return backup;
}
export function verifyProject(_project,_topic,input){return inspect(input?.backup);}
export function restoreProject(project,_topic,input,allocationId){
 if(!input||Object.keys(input).some(k=>k!=='backup'))throw Error('Restore accepts a package only; arbitrary destination paths are forbidden');
 const backup=input.backup,report=inspect(backup),parent=path.join(project,'.bang','restored-projects');
 try{if(fs.lstatSync(parent).isSymbolicLink()||!fs.statSync(parent).isDirectory())throw Error('Unsafe restore directory');}catch(e){if(e.code!=='ENOENT')throw e;fs.mkdirSync(parent,{mode:0o700});}
 const id=allocationId??randomUUID();if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))throw Error('Invalid restore allocation');
 const staging=path.join(parent,'.pending-'+randomUUID()),destination=path.join(parent,id);
 fs.mkdirSync(staging,{mode:0o700});
 try{
  const data=path.join(staging,'.bang');fs.mkdirSync(data,{mode:0o700});
  const file=path.join(data,'board.sqlite'),db=createDatabase(file,backup.payload.tables);db.close();if(process.platform!=='win32')fs.chmodSync(file,0o600);
  for(const row of backup.payload.tables.topics){const dir=path.join(data,'topics',row.topic);fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(path.join(dir,'current.canvas'),JSON.stringify(JSON.parse(row.state).canvas,null,2)+'\n',{mode:0o600,flag:'wx'});}
  for(const a of backup.payload.attachments)if(a.status==='included'){const file=path.join(staging,a.path);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,Buffer.from(a.data,'base64'),{mode:0o600,flag:'wx'});}
  fs.renameSync(staging,destination);
  return {status:'restored',projectPath:destination,restoreId:id,...report,requiresNewHostAuthorization:true,frozenSources:backup.payload.tables.ingestion_queue.filter(r=>r.state==='frozen').length};
 }catch(e){fs.rmSync(staging,{recursive:true,force:true});throw e;}
}

// Only allocated UUID project directories are navigable; no caller paths.
export function restoredProject(root,selection){
 if(!selection)return root;
 const ids=String(selection).split('/');if(ids.length>8||ids.some(id=>! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)))throw Error('Invalid restored project selection');
 let current=root;
 for(const id of ids)for(const part of ['.bang','restored-projects',id]){current=path.join(current,part);const stat=fs.lstatSync(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Unsafe restored project selection');}
 return current;
}
