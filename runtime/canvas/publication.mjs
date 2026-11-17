import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateCanvas} from './contract.ts';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const bytes=canvas=>JSON.stringify(canvas,null,2)+'\n';
export function observed(file){try{return hash(fs.readFileSync(file));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
export function recoveryError(message){return Object.assign(Error(message),{code:'RECOVERY_REQUIRED'});}
export function recoveryStatus(db,topic,file){
 const row=db.prepare('SELECT * FROM topics WHERE topic=?').get(topic),pending=db.prepare("SELECT * FROM intents WHERE topic=? AND status='prepared'").get(topic),observedHash=observed(file);
 if(!row&&!pending)throw Error('Unknown topic');
 if(row&&row.hash===observedHash&&!pending)return {status:'healthy',revision:row.revision};
 let reason=pending&&(observedHash===pending.hash||observedHash===(row?.hash??null))?'publication-pending':observedHash===null?'missing-canvas':'external-change';
 if(observedHash!==null){try{validateCanvas(JSON.parse(fs.readFileSync(file,'utf8')));}catch{reason='invalid-canvas';}}
 return {status:'recovery-required',reason,observedHash,revision:row?.revision??null,pendingOperation:pending?.operation??null};
}
// User authorization is bound to the exact bytes inspected. Preserve them before
// replacement; never delete an unknown file to make publication succeed.
export function recoverUnknown(db,project,topic,file,input){
 const status=recoveryStatus(db,topic,file);if(status.status==='healthy')return {status:'healthy'};
 if(!input||!Object.hasOwn(input,'expectedHash')||input.expectedHash!==status.observedHash)throw recoveryError('Recovery fingerprint changed; inspect recovery-status again');
 const row=db.prepare('SELECT * FROM topics WHERE topic=?').get(topic),pending=db.prepare("SELECT * FROM intents WHERE topic=? AND status='prepared'").get(topic);
 let preservedFile=null;
 if(status.observedHash!==null){
  const destination=path.join(path.dirname(file),`preserved-${status.observedHash}.canvas`);
  if(!fs.existsSync(destination)){
   const temporary=path.join(path.dirname(file),'preserve.tmp');
   bounded(()=>{const fd=fs.openSync(temporary,'w',0o600);try{fs.writeFileSync(fd,fs.readFileSync(file));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}});
   if(observed(temporary)!==status.observedHash)throw recoveryError('Canvas changed while preserving; inspect recovery-status again');
   bounded(()=>fs.renameSync(temporary,destination));syncDirectory(path.dirname(file));
  }
  if(observed(destination)!==status.observedHash)throw recoveryError('Preservation failed; original left untouched');preservedFile=path.relative(project,destination);
 }
 const target=pending??{state:row.state,hash:row.hash,operation:'$repair',receipt:JSON.stringify({topic,revision:row.revision,status:'committed'})};
 finishPublication(db,project,topic,file,target,status.observedHash);
 return {status:'recovered',revision:JSON.parse(target.state).revision,preservedFile};
}
// Fault sources are opt-in, restricted to one exact test workspace, never HTTP
// commands or arbitrary output paths. The real persistence chain remains intact.
function fault(project,phase){
 if(process.env.BANG_PUBLICATION_TEST_PROJECT!==path.resolve(project))return;
 const selected=process.env.BANG_PUBLICATION_TEST_FAULT;
 if(selected===phase){fs.writeFileSync(path.join(project,'.bang/runtime/publication-test.json'),JSON.stringify({phase,pid:process.pid}));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}
 if(selected===phase+':busy')throw Object.assign(Error('Injected sharing violation'),{code:'EBUSY'});
 if(selected===phase+':full')throw Object.assign(Error('Injected disk full'),{code:'ENOSPC'});
}
function bounded(action){for(let attempt=0;;attempt++){try{return action();}catch(error){if(!['EBUSY','EPERM','EACCES','ENOSPC','EDQUOT'].includes(error.code))throw error;if(attempt===3)throw Object.assign(Error(`Save blocked (${error.code}); recovery required`),{code:'SAVE_BLOCKED',cause:error});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,40);}}}
function syncDirectory(directory){if(process.platform==='win32')return;const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function confirm(db,topic,intent){
 const state=JSON.parse(intent.state);db.exec('BEGIN IMMEDIATE');
 try{db.prepare('INSERT INTO topics VALUES(?,?,?,?) ON CONFLICT(topic) DO UPDATE SET revision=excluded.revision,state=excluded.state,hash=excluded.hash').run(topic,state.revision,intent.state,intent.hash);db.prepare('INSERT OR IGNORE INTO revisions VALUES(?,?,?)').run(topic,state.revision,intent.state);db.prepare("UPDATE intents SET status='confirmed' WHERE topic=? AND operation=?").run(topic,intent.operation);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
}
export function finishPublication(db,project,topic,file,intent,baseline){
 let content;
 try{const state=JSON.parse(intent.state);validateCanvas(state.canvas);if(!Number.isSafeInteger(state.revision)||state.revision<0||JSON.parse(intent.receipt).revision!==state.revision)throw Error('Invalid revision');content=bytes(state.canvas);if(hash(content)!==intent.hash)throw Error('Hash mismatch');}catch{throw recoveryError('Prepared recovery material invalid; recovery required');}
 const current=observed(file);
 if(current!==intent.hash){
  if(current!==baseline)throw recoveryError('Canvas externally changed; recovery required');
  const temporary=path.join(path.dirname(file),'publish.tmp');
  // This reserved scratch filename belongs to the single writer. Interrupted
  // scratch bytes may be regenerated from the durable prepared material.
  bounded(()=>{fault(project,'write');const fd=fs.openSync(temporary,'w',0o600);try{fs.writeFileSync(fd,content);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}});
  bounded(()=>{fault(project,'replace');if(observed(file)!==baseline)throw recoveryError('Canvas changed during preparation; recovery required');fs.renameSync(temporary,file);});syncDirectory(path.dirname(file));
 }
 fault(project,'replaced');bounded(()=>{fault(project,'confirm');confirm(db,topic,intent);});fault(project,'confirmed');return JSON.parse(intent.receipt);
}
export function reconcile(db,project,topic,file){
 const pending=db.prepare("SELECT * FROM intents WHERE topic=? AND status='prepared'").get(topic);if(!pending)return;
 const row=db.prepare('SELECT * FROM topics WHERE topic=?').get(topic);
 finishPublication(db,project,topic,file,pending,row?.hash??null);
}
export function preparePublication(db,topic,{operation,request,state,receipt}){
 const content=bytes(state.canvas),serialized=JSON.stringify(state),digest=hash(content);
 db.prepare('INSERT INTO intents VALUES(?,?,?,?,?,?,?)').run(topic,operation,request,serialized,digest,JSON.stringify(receipt),'prepared');
 return {operation,state:serialized,hash:digest,receipt:JSON.stringify(receipt)};
}
export function publish(db,project,topic,file,material,baseline){
 const intent=preparePublication(db,topic,material);fault(project,'prepared');return finishPublication(db,project,topic,file,intent,baseline);
}
