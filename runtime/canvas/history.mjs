// History compares persisted committed states; previews never become the current board.
export function revisionState(db,topic,revision){
 if(!Number.isSafeInteger(revision)||revision<0)throw Error('Invalid history revision');
 const row=db.prepare('SELECT state FROM revisions WHERE topic=? AND revision=?').get(topic,revision);
 if(!row)throw Error('Unknown history revision');return JSON.parse(row.state);
}
export function revisionList(db,topic){
 const operations=new Map(db.prepare("SELECT request,receipt FROM intents WHERE topic=? AND status='confirmed'").all(topic).map(row=>{const request=JSON.parse(row.request),receipt=JSON.parse(row.receipt);return [receipt.revision,{operationId:request.operationId,author:request.author,intent:request.intent,undoOf:request.undoOf}];}));
 return db.prepare('SELECT revision FROM revisions WHERE topic=? ORDER BY revision').all(topic).map(({revision})=>({revision,...operations.get(revision)}));
}
export const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function boardDiff(before,after){
 const changes=[];
 for(const collection of ['nodes','edges','relations','editorExtras','metadata']){
  const values=state=>collection==='metadata'?Object.entries(state.metadata??{}).map(([id,value])=>({id,...value})):collection==='nodes'||collection==='edges'?state.canvas[collection]:state[collection]??[];
  const old=new Map(values(before).map(v=>[v.id,v])),now=new Map(values(after).map(v=>[v.id,v]));
  for(const id of new Set([...old.keys(),...now.keys()])){
   const a=old.get(id),b=now.get(id);
   if(!a||!b){changes.push({collection,id,field:'$object',before:a??null,after:b??null});continue;}
   for(const field of new Set([...Object.keys(a),...Object.keys(b)]))if(!equal(a[field],b[field]))changes.push({collection,id,field,before:a[field]??null,after:b[field]??null});
  }
 }
 const oldOrder=before.canvas.nodes.map(n=>n.id),newOrder=after.canvas.nodes.map(n=>n.id);
 if(!equal(oldOrder,newOrder))changes.push({collection:'layout',id:'$nodes',field:'order',before:oldOrder,after:newOrder});
 return {fromRevision:before.revision,toRevision:after.revision,changes};
}
export function parseUndo(value){
 if(!value||value.intent!=='undo-committed'||value.author?.kind!=='manual'||typeof value.author.id!=='string'||!value.author.id||typeof value.operationId!=='string'||!value.operationId||typeof value.topic!=='string'||!Number.isSafeInteger(value.revision)||value.revision<1)throw Error('Expected explicit committed undo');
 return {operationId:value.operationId,topic:value.topic,author:value.author,intent:'undo-committed',revision:value.revision,undoOf:value.revision};
}
// A compensation restores the affected fields into the current board, never an old snapshot.
export function compensate(db,topic,request,current){
 const entry=revisionList(db,topic).find(e=>e.revision===request.revision);
 if(!entry||entry.author?.kind!=='manual'||entry.author.id!==request.author.id)throw Error('Only the author can undo a committed operation');
 const before=revisionState(db,topic,request.revision-1),after=revisionState(db,topic,request.revision);
 if(entry.intent==='restore-version'){
  for(const c of boardDiff(before,after).changes.filter(c=>c.collection==='metadata'&&!['fields','modifiedRevision','semanticRevision'].includes(c.field))){
   const states=db.prepare('SELECT state FROM revisions WHERE topic=? AND revision>? ORDER BY revision').all(topic,request.revision).map(r=>JSON.parse(r.state));
   for(const state of states){const m=state.metadata[c.id],original=after.metadata[c.id];if(c.field==='$object'?!equal(m,original):!equal(m?.[c.field],original?.[c.field]))throw Error('Undo conflict; restored knowledge changed after restore');}
  }
 }
 if(entry.intent==='basis-review'){
  const next=structuredClone(current);next.revision++;
  for(const id of Object.keys(after.metadata).filter(id=>!equal(before.metadata[id]?.basis,after.metadata[id]?.basis))){
   const old=before.metadata[id],reviewed=after.metadata[id],now=current.metadata[id];
   if(!now||!equal(now.basis,reviewed.basis)||!equal(now.knowledge,reviewed.knowledge)||(now.semanticRevision??0)!==(reviewed.semanticRevision??0))throw Error('Undo conflict; basis changed after review');
   next.metadata[id].basis=structuredClone(old.basis);next.metadata[id].knowledge=structuredClone(old.knowledge);next.metadata[id].modifiedRevision=next.revision;
  }
  next.compensation={operationId:request.operationId,undoOf:request.revision,authorId:request.author.id};return next;
 }
 const changes=boardDiff(before,after).changes.filter(c=>['nodes','edges','editorExtras'].includes(c.collection));
 const later=db.prepare('SELECT state FROM revisions WHERE topic=? AND revision>? ORDER BY revision').all(topic,request.revision).map(r=>JSON.parse(r.state));
 const values=(state,collection)=>collection==='editorExtras'?(state.editorExtras??=[]):state.canvas[collection];
 const lookup=(state,c)=>values(state,c.collection).find(n=>n.id===c.id);
 const conflicts=[];
 for(const c of changes){
  const original=lookup(after,c);
  for(const state of later){const object=lookup(state,c);if(c.field==='$object'?!equal(original,object):!object||!equal(original?.[c.field],object[c.field])||(c.collection!=='editorExtras'&&(state.metadata?.[c.id]?.fields?.[c.field]?.modifiedRevision??0)>request.revision)){
   conflicts.push({id:c.id,field:c.field,base:c.after,current:c.field==='$object'?object??null:object?.[c.field]??null,proposed:c.before,reason:'Later modification conflicts with undo'});break;
  }}
 }
 if(conflicts.length)throw Object.assign(Error('Undo conflict; no changes committed'),{preview:{headRevision:current.revision,conflicts,legalOperations:[]}});
 const next=structuredClone(current);next.revision++;
 for(const c of changes){
  const list=values(next,c.collection),index=list.findIndex(n=>n.id===c.id),old=lookup(before,c);
  if(c.field==='$object'){
   if(old){const sourceList=values(before,c.collection),oldIndex=sourceList.findIndex(n=>n.id===c.id);list.splice(Math.min(oldIndex,list.length),0,structuredClone(old));if(c.collection!=='editorExtras'&&Object.hasOwn(before.metadata,c.id))Object.defineProperty(next.metadata,c.id,{value:structuredClone(before.metadata[c.id]),enumerable:true,configurable:true,writable:true});}
   else {const removed=list.splice(index,1)[0];if(c.collection!=='editorExtras'){(next.deletionIntents??=[]).push({id:c.id,object:removed,revision:next.revision,authorId:request.author.id,operationId:request.operationId});delete next.metadata[c.id];}}
  }else{
   if(Object.hasOwn(old,c.field))list[index][c.field]=structuredClone(old[c.field]);else delete list[index][c.field];
   if(c.collection==='editorExtras')continue;
   if(!Object.hasOwn(next.metadata,c.id))Object.defineProperty(next.metadata,c.id,{value:{},enumerable:true,configurable:true,writable:true});
   const metadata=next.metadata[c.id];
   if(equal(metadata.source,after.metadata[c.id]?.source)){if(before.metadata[c.id]?.source)metadata.source=structuredClone(before.metadata[c.id].source);else delete metadata.source;}
   metadata.fields??={};metadata.fields[c.field]={modifiedRevision:next.revision,authorId:request.author.id,operationId:request.operationId};metadata.modifiedRevision=next.revision;
  }
 }
 if(changes.some(c=>c.collection==='nodes'&&(c.field==='zIndex'||c.field==='$object'))){
  const ranks=new Map(before.canvas.nodes.map((n,i)=>[n.id,i]));
  const currentRanks=new Map(next.canvas.nodes.map((n,i)=>[n.id,n.zIndex??ranks.get(n.id)??i]));
  next.canvas.nodes.sort((a,b)=>currentRanks.get(a.id)-currentRanks.get(b.id));
 }
 // Retain deletion intent audit records: explicit compensation is the sole identity-reuse path.
 next.compensation={operationId:request.operationId,undoOf:request.revision,authorId:request.author.id};
 return next;
}

// Apply after semantic invalidation so exact historical basis/conditions can be
// compensated, while newly derived dependants remain withdrawn by that pass.
export function compensateRestorationMetadata(db,topic,request,next){
 if(revisionList(db,topic).find(r=>r.revision===request.revision)?.intent!=='restore-version')return false;
 const before=revisionState(db,topic,request.revision-1),after=revisionState(db,topic,request.revision);
 for(const c of boardDiff(before,after).changes.filter(c=>c.collection==='metadata'&&!['fields','modifiedRevision','semanticRevision'].includes(c.field))){
  if(c.field==='$object')continue; // Object compensation already restores/removes its metadata.
  const target=next.metadata[c.id];if(!target)continue;
  if(Object.hasOwn(before.metadata[c.id]??{},c.field))target[c.field]=structuredClone(before.metadata[c.id][c.field]);else delete target[c.field];
  target.modifiedRevision=next.revision;target.semanticRevision=next.revision;
 }
 return true;
}
