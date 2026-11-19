import {openBindingDatabase} from './binding.mjs';
import {topicPath,readCommitted} from './store.mjs';
import {revisionState} from './history.mjs';
import {hash,preparePublication,reconcile,observed,recoveryError} from './publication.mjs';
import {invalidateSourceBasis} from './evidence.mjs';
import {validateCanvasCandidate} from './contract.ts';
import {validateResources} from './resources.mjs';
const has=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
// These revocations share the durable prepared-intent transaction. A failed file
// replacement can only leave old work frozen, never able to overwrite recovery.
function freezeOldWork(db,topic,revision){
 if(has(db,'ingestion_queue'))db.prepare("UPDATE ingestion_queue SET state='frozen' WHERE topic=? AND state='pending'").run(topic);
 if(has(db,'completed_sources'))for(const row of db.prepare('SELECT id,body FROM completed_sources WHERE topic=?').all(topic)){
  const source=JSON.parse(row.body);if(source.humanIntent){source.humanIntent.frozen=true;source.humanIntent.frozenAtRevision=revision;db.prepare('UPDATE completed_sources SET body=? WHERE id=?').run(JSON.stringify(source),row.id);}
 }
 if(has(db,'binding_sources'))for(const row of db.prepare('SELECT id,metadata FROM binding_sources WHERE topic=?').all(topic)){
  const metadata=JSON.parse(row.metadata);metadata.backlog=0;db.prepare('UPDATE binding_sources SET metadata=? WHERE id=?').run(JSON.stringify(metadata),row.id);
 }
 if(has(db,'organizer_tasks'))for(const row of db.prepare('SELECT id,body FROM organizer_tasks WHERE topic=?').all(topic)){
  const task=JSON.parse(row.body);
  if(['running','retry','failed','cancelled'].includes(task.status)){task.status='frozen';task.error={code:'BOARD_RESTORED',message:'Historical restore revoked this attempt'};delete task.input;delete task.baseline;}
  for(const proposal of [...(task.proposals??[]),...(task.suppressedProposals??[])])proposal.frozen=true;
  task.frozenAtRevision=revision;db.prepare('UPDATE organizer_tasks SET body=? WHERE id=?').run(JSON.stringify(task),row.id);
 }
}
export function currentSourceIds(db,topic){
 if(!has(db,'completed_sources'))return new Set();
 const rows=db.prepare('SELECT id,body FROM completed_sources WHERE topic=? ORDER BY rowid').all(topic);
 return new Set(rows.filter((r,i)=>{const s=JSON.parse(r.body);return s.current??!rows.slice(i+1).some(n=>{const v=JSON.parse(n.body);return v.bindingId===s.bindingId&&v.turnId===s.turnId;});}).map(r=>r.id));
}
export function reconcileRestoredEvidence(db,topic,state){
 const revised=invalidateSourceBasis(state,currentSourceIds(db,topic));
 if(!revised)return state;
 revised.revision=state.revision;
 for(const m of Object.values(revised.metadata))if(m.basis?.revision>state.revision)m.basis.revision=state.revision;
 return revised;
}
export function restoreFingerprint(topic,current,state){
 return {topic,revision:state.revision,baseRevision:current.revision,previewKey:hash(JSON.stringify([topic,current,state]))};
}
export async function previewRestore(project,topic,input){
 const current=await readCommitted(project,topic),db=openBindingDatabase(project);
 try{const state=revisionState(db,topic,input?.revision);return restoreFingerprint(topic,current,state);}finally{db.close();}
}
export async function restoreVersion(project,topic,input){
 if(input?.intent!=='restore-version'||input.topic!==topic||input.author?.kind!=='manual'||typeof input.author.id!=='string'||!input.author.id||typeof input.operationId!=='string'||!input.operationId||input.operationId.startsWith('$'))throw Error('Explicit manual restore and preview required');
 const request=JSON.stringify(input),db=openBindingDatabase(project),file=topicPath(project,topic);
 try{
 reconcile(db,project,topic,file);
 const prior=db.prepare('SELECT request,receipt FROM intents WHERE topic=? AND operation=?').get(topic,input.operationId);
 if(prior){if(prior.request!==request)throw Error('Operation identity reused for different content');return JSON.parse(prior.receipt);}
 const row=db.prepare('SELECT * FROM topics WHERE topic=?').get(topic);if(!row)throw Error('Unknown topic');
 if(observed(file)!==row.hash)throw recoveryError('Canvas externally changed; recovery required');
 const current=JSON.parse(row.state),historical=revisionState(db,topic,input.revision);
 if(input.baseRevision!==current.revision||input.previewKey!==restoreFingerprint(topic,current,historical).previewKey)throw Error('Restore baseline changed; preview again');
 let next=structuredClone(historical);next.revision=current.revision+1;
 next.restoration={fromRevision:input.revision,previousRevision:current.revision,operationId:input.operationId};
 next.deletionIntents=[...new Map([...(historical.deletionIntents??[]),...(current.deletionIntents??[])].map(d=>[JSON.stringify(d),d])).values()];
 for(const m of Object.values(next.metadata)){m.modifiedRevision=next.revision;m.semanticRevision=next.revision;}
 next=reconcileRestoredEvidence(db,topic,next);validateCanvasCandidate(next.canvas);validateResources(project,next.canvas);
 const receipt={operationId:input.operationId,topic,revision:next.revision,status:'committed',restoredFrom:input.revision};
 db.exec('BEGIN IMMEDIATE');
 try{freezeOldWork(db,topic,next.revision);preparePublication(db,topic,{operation:input.operationId,request,state:next,receipt});db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 reconcile(db,project,topic,file);return receipt;
 }finally{db.close();}
}
