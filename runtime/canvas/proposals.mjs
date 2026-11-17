import {createHash,randomUUID} from 'node:crypto';
import {openBindingDatabase} from './binding.mjs';
import {readCommitted,commitOrganizerBoard,readOperationReceipt} from './store.mjs';
import {layoutFields} from './contract.ts';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const semanticObject=object=>Object.fromEntries(Object.entries(object).filter(([k])=>!layoutFields.includes(k)));
function tasks(project,topic){const db=openBindingDatabase(project);try{return db.prepare('SELECT body FROM organizer_tasks WHERE topic=? ORDER BY rowid').all(topic).map(r=>JSON.parse(r.body));}finally{db.close();}}
export function proposals(project,topic){return tasks(project,topic).flatMap(t=>(t.proposals??[]).map(({dependencies,...p})=>p));}
export function makeProposal(project,task,change,current,knowledge,read){
 const before=[...current.canvas.nodes,...current.canvas.edges].find(n=>n.id===change.id),operation=change.type==='delete-relation'?{type:'delete-relation',id:change.id}:{type:'edit-card',id:change.id,text:change.text};
 const source=task.input.completedTurns.find(s=>s.id===change.sources[0]);
 const evidence={assistant:source.assistant.content,conditions:change.conditions,uncertainty:change.uncertainty};
 const intentKey=digest([{type:operation.type,id:operation.id},semanticObject(before),current.metadata[before.id]?.fields?.text?.modifiedRevision??0]);
 const evidenceHash=digest(evidence.assistant.trim().replace(/\s+/g,' ')),prior=proposals(project,task.topic).filter(p=>p.intentKey===intentKey);
 if(prior.some(p=>!p.frozen&&p.evidenceHash===evidenceHash&&['pending','rejected','accepted'].includes(p.status)))return null;
 return {id:randomUUID(),taskId:task.id,status:'pending',intentKey,evidenceHash,evidence,sourceId:source.id,classification:source.humanIntent?.classification??'unspecified',baseRevision:current.revision,before,operation,knowledge,dependencies:read.map(n=>({object:semanticObject(n),knowledge:current.metadata[n.id]?.knowledge,fields:current.metadata[n.id]?.fields})),evidenceDifference:prior.length?{previousSourceId:prior.at(-1).sourceId,currentSourceId:source.id,previous:prior.at(-1).evidence,current:evidence}:null};
}
export async function reviewProposal(project,topic,input){
 if(!input||!['accept','reject'].includes(input.decision)||typeof input.id!=='string')throw Error('Explicit proposal decision required');
 const task=tasks(project,topic).find(t=>t.proposals?.some(p=>p.id===input.id)),proposal=task?.proposals.find(p=>p.id===input.id);if(!proposal)throw Error('Unknown proposal');
 if(proposal.frozen)throw Error('Restored proposal is frozen; request fresh analysis');
 if(proposal.status!=='pending'){if(proposal.status===(input.decision==='accept'?'accepted':'rejected'))return proposal.receipt;throw Error('Proposal already decided');}
 const operationId='proposal-'+proposal.id;
 // Recover the narrow publication-before-decision crash interval idempotently.
 const prior=await readOperationReceipt(project,topic,operationId);
 if(prior&&input.decision!=='accept')throw Error('Proposal already committed');
 let receipt=prior;
 if(!receipt){const current=await readCommitted(project,topic);
  if(input.decision==='reject')receipt={status:'rejected',proposalId:proposal.id,revision:current.revision,baseRevision:proposal.baseRevision};
  else {
   for(const dep of proposal.dependencies){const now=[...current.canvas.nodes,...current.canvas.edges].find(n=>n.id===dep.object.id),metadata=current.metadata[dep.object.id];const semanticFields=Object.keys(dep.object).filter(k=>!layoutFields.includes(k));if(!now||JSON.stringify(semanticObject(now))!==JSON.stringify(dep.object)||JSON.stringify(metadata?.knowledge)!==JSON.stringify(dep.knowledge)||semanticFields.some(k=>(metadata?.fields?.[k]?.modifiedRevision??0)!==(dep.fields?.[k]?.modifiedRevision??0)))throw Object.assign(Error('Proposal baseline conflict; compare fresh evidence'),{code:'PROPOSAL_STALE'});}
   receipt=await commitOrganizerBoard(project,topic,{operationId,topic,baseRevision:current.revision,author:{kind:'organizer',id:'organizer:'+task.id},readDependencies:[],intent:'incremental-organize',operations:[proposal.operation]},{taskId:task.id,attemptId:task.attemptId,sourceId:proposal.sourceId,knowledge:{[proposal.operation.id]:{...proposal.knowledge,humanIntent:{proposalId:proposal.id,baseRevision:proposal.baseRevision}}}});
  }
 }
 proposal.status=input.decision==='accept'?'accepted':'rejected';proposal.receipt=receipt;
 const db=openBindingDatabase(project);try{db.prepare('UPDATE organizer_tasks SET body=? WHERE id=?').run(JSON.stringify(task),task.id);}finally{db.close();}return receipt;
}
