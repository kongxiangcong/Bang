import {invalidateBasis,parseBasisReview,applyBasisReview,knowledgeContext} from './evidence.mjs';
import {isDeepStrictEqual} from 'node:util';
import {standardCanvas,parseImport,importChanges,exchangeDegradation} from './exchange.mjs';
import {applyOperation as applyParsedOperation,orderOperations,operationIdentity} from './operations.ts';
import {recoveryStatus,recoverUnknown,reconcile,publish,observed,recoveryError,hash} from './publication.mjs';
import {revisionState,revisionList,boardDiff,parseUndo,compensate} from './history.mjs';
import {parseEdge,relationFields,semanticRelations} from './relations.ts';
import {validateResources,resourceStatus} from './resources.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {compileCanvas,validateCanvas,parsePatch,parseCard,editableFields,layoutFields} from './contract.ts';
export function topicPath(project,topic){
 if(!project||!topic||! /^[a-zA-Z0-9_-]+$/.test(topic))throw Error('Explicit project and safe topic are required');
 return path.join(path.resolve(project),'.bang','topics',topic,'current.canvas');
}
function open(project,readonly=false){
 const database=path.join(path.resolve(project),'.bang','board.sqlite'),fresh=!fs.existsSync(database);
 const db=new DatabaseSync(database,{readOnly:readonly});if(fresh&&process.platform!=='win32')fs.chmodSync(database,0o600);
 if(!readonly){db.exec(`PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS topics(topic TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL, hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS revisions(topic TEXT, revision INTEGER, state TEXT NOT NULL, PRIMARY KEY(topic,revision)); CREATE TABLE IF NOT EXISTS intents(topic TEXT, operation TEXT, request TEXT NOT NULL, state TEXT NOT NULL, hash TEXT NOT NULL, receipt TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(topic,operation));`);}
 return db;
}
export async function readBoard(project,topic){return (await readCommitted(project,topic)).canvas;}
export async function readCommitted(project,topic){
 const file=topicPath(project,topic),db=open(project);
 try{reconcile(db,project,topic,file);const row=db.prepare('SELECT * FROM topics WHERE topic=?').get(topic);if(!row)throw Error('Unknown topic');if(observed(file)!==row.hash)throw recoveryError('Canvas publication pending or externally changed; recovery required');return JSON.parse(row.state);}finally{db.close();}
}
export async function generateBoard(project,topic,input){
 const board=compileCanvas(input),file=topicPath(project,topic);validateResources(project,board);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const state={revision:0,canvas:board,relations:semanticRelations(board.edges,board.nodes),deletionIntents:[],editorExtras:[],metadata:Object.fromEntries([...board.nodes,...board.edges].map(n=>[n.id,{role:n.type==='group'?'visual-region':'knowledge',source:{kind:'bootstrap'},modifiedRevision:0}]))},db=open(project);
 try{reconcile(db,project,topic,file);if(db.prepare('SELECT 1 FROM topics WHERE topic=?').get(topic)||observed(file)!==null)throw Error('Topic already exists; refusing overwrite');publish(db,project,topic,file,{operation:'$bootstrap',request:JSON.stringify(input),state,receipt:{topic,revision:0,status:'committed'}},null);}finally{db.close();}return board;
}
// Persistence canonicalizes newly supplied objects; draft merging deliberately
// permits incomplete resource strings until an explicit save validates them.
function applyOperation(board,op){
 const parsed=op.type==='create-card'?{...op,card:parseCard(op.card)}:op.type==='create-relation'?{...op,edge:parseEdge(op.edge)}:op;
 return applyParsedOperation(board,parsed);
}
// All comparisons use persisted historical fields, including local acknowledged overlays.
function inspectPatch(db,topic,patch,row,project){
 const snapshots=new Map(),current=JSON.parse(row.state),conflicts=[],legalOperations=[],touched=new Set();
 const baseline=revision=>{if(revision>row.revision)throw Error('Unknown baseline');if(!snapshots.has(revision)){const old=db.prepare('SELECT state FROM revisions WHERE topic=? AND revision=?').get(topic,revision);if(!old)throw Error('Unknown baseline');snapshots.set(revision,JSON.parse(old.state));}return snapshots.get(revision);};
 const original=baseline(patch.baseRevision);
 const dependencyConflict=patch.readDependencies.some(id=>{const old=[...original.canvas.nodes,...original.canvas.edges].find(n=>n.id===id),now=[...current.canvas.nodes,...current.canvas.edges].find(n=>n.id===id);return !old||JSON.stringify(old)!==JSON.stringify(now);});
 for(const [operationIndex,op] of patch.operations.entries()){
  if(op.type.endsWith('extra')){
   const id=op.extra?.id??op.id,now=(current.editorExtras??[]).find(e=>e.id===id),old=(baseline(op.fieldRevisions?.element??patch.baseRevision).editorExtras??[]).find(e=>e.id===id);
   const failed=touched.has('extra:'+id)||dependencyConflict||(op.type==='create-extra'?!!now:!now||JSON.stringify(old)!==JSON.stringify(now));touched.add('extra:'+id);
   if(failed)conflicts.push({operationIndex,id,field:'element',base:old?.element??null,current:now?.element??null,proposed:op.element??op.extra?.element??null,reason:'Editor element changed'});continue;
  }
  const relation=op.type.endsWith('relation'),collection=relation?'edges':'nodes',creating=op.type.startsWith('create-'),deleting=op.type.startsWith('delete-');
  const id=creating?(relation?op.edge.id:op.card.id):op.id,now=current.canvas[collection].find(n=>n.id===id);
  const conflict=(field,base,current,proposed,reason)=>conflicts.push({operationIndex,id,field,base:base??null,current:current??null,proposed:proposed??null,reason});
  if(touched.has(id))conflict('id',id,id,id,'Repeated object operation');touched.add(id);
  if(dependencyConflict)conflict('$dependency',null,null,null,'Read dependency changed');
  if(creating){
   const existed=db.prepare("SELECT 1 FROM revisions, json_each(revisions.state, '$.canvas.nodes') AS node WHERE topic=? AND json_extract(node.value,'$.id')=? LIMIT 1").get(topic,id);
   const edgeExisted=db.prepare("SELECT 1 FROM revisions, json_each(revisions.state, '$.canvas.edges') AS edge WHERE topic=? AND json_extract(edge.value,'$.id')=? LIMIT 1").get(topic,id);
   if(op.card?.derivedFrom&&!current.canvas.nodes.some(n=>n.id===op.card.derivedFrom))conflict('derivedFrom',null,null,op.card.derivedFrom,'Unknown derivation source');
   if(existed||edgeExisted)conflict('id',null,now,op.card??op.edge,now?'Identity already exists':'Deleted identity cannot be reused');
   if(relation&&(current.deletionIntents??[]).some(d=>d.revision>patch.baseRevision&&d.object.fromNode===op.edge.fromNode&&d.object.toNode===op.edge.toNode))conflict('$deletion',null,null,op.edge,'Relation deletion intent is newer than baseline');
  }
  else if(!now)conflict('id',id,null,op.type==='delete-card'?null:op,'Card deleted');
  else {
   const fields=deleting?(relation?['id',...relationFields]:['id','type',...editableFields]):['id',...(relation?relationFields:editableFields).filter(k=>op[k]!==undefined)];
   for(const field of fields){const old=baseline(op.fieldRevisions?.[field]??patch.baseRevision).canvas[collection].find(n=>n.id===id);if(!old||!isDeepStrictEqual(old[field],now[field]))conflict(field,old?.[field],now[field],op.type==='delete-card'?null:op[field],'Field changed');}
   if(op.type==='edit-card'&&((op.file!==undefined&&now.type!=='file')||(op.url!==undefined&&now.type!=='link')))conflict('type',null,now.type,null,'Resource type mismatch');
  }
 }
 // Group only structural dependencies. A failed rewire must not leave its former
 // endpoint deletion in a supposedly safe subset. Independent field edits survive.
 const groups=patch.operations.map((op,i)=>new Set([i]));
 const join=(a,b)=>{const combined=new Set([...groups[a],...groups[b]]);for(const i of combined)groups[i]=combined;};
 for(const [i,card] of patch.operations.entries())if(card.type==='create-card'||card.type==='delete-card'){
  const id=operationIdentity(card);
  for(const [j,relation] of patch.operations.entries())if(relation.type.endsWith('relation')){
   const edgeId=operationIdentity(relation),old=original.canvas.edges.find(e=>e.id===edgeId),now=current.canvas.edges.find(e=>e.id===edgeId);
   const proposed=relation.type==='create-relation'?relation.edge:relation;
   const historical=['id','fromNode','toNode'].map(field=>baseline(relation.fieldRevisions?.[field]??patch.baseRevision).canvas.edges.find(e=>e.id===edgeId));
   if([old,now,proposed,...historical].some(e=>e&&(e.fromNode===id||e.toNode===id)))join(i,j);
  }
 }
 for(const group of new Set(groups)){
  const reject=(reason)=>{for(const operationIndex of group)if(!conflicts.some(c=>c.operationIndex===operationIndex))conflicts.push({operationIndex,id:operationIdentity(patch.operations[operationIndex]),field:'$constraints',base:null,current:null,proposed:null,reason});};
  if(conflicts.some(c=>group.has(c.operationIndex))){reject('Dependent operation conflicts; structural intent retained');continue;}
  const operations=orderOperations([...group].map(i=>patch.operations[i]));let candidate=current;
  try{
   for(const accepted of orderOperations(legalOperations))candidate=applyOperation(candidate,accepted);
   for(const op of operations){
    if(op.type==='delete-card'){
     const oldEdges=baseline(op.fieldRevisions?.id??patch.baseRevision).canvas.edges;
     for(const edge of candidate.canvas.edges.filter(e=>e.fromNode===op.id||e.toNode===op.id)){
      const old=oldEdges.find(e=>e.id===edge.id),now=current.canvas.edges.find(e=>e.id===edge.id);
      // New relations intentionally created in this transaction have no competing head.
      if(now&&JSON.stringify(old)!==JSON.stringify(now)){
       conflicts.push({operationIndex:patch.operations.indexOf(op),id:op.id,field:'$incidentRelations',base:old??null,current:now,proposed:null,reason:'Incident relation changed since deletion baseline'});
      }
     }
    }
    candidate=applyOperation(candidate,op);
   }
   if(conflicts.some(c=>group.has(c.operationIndex))){reject('Dependent operation conflicts; structural intent retained');continue;}
   if(operations.some(op=>(op.type==='create-relation'||op.type==='edit-relation')&&!candidate.canvas.edges.some(edge=>edge.id===operationIdentity(op))))throw Error('Explicit relation intent would be removed by endpoint deletion');
   validateCanvas(candidate.canvas);validateResources(project,candidate.canvas);legalOperations.push(...operations);
  }catch(error){reject(error.message);}
 }
 // A preview never publishes. A subsequent subset commit repeats every check.
 return {headRevision:row.revision,conflicts,legalOperations};
}
export async function previewBoard(project,topic,value){
 const patch=parsePatch(value);if(patch.topic!==topic)throw Error('Patch topic mismatch');
 await readCommitted(project,topic);const db=open(project,true);
 try{const row=db.prepare('SELECT * FROM topics WHERE topic=?').get(topic);return inspectPatch(db,topic,patch,row,project);}finally{db.close();}
}
export async function readHead(project,topic){const state=await readCommitted(project,topic);return {revision:state.revision};}
// Native Runtime ownership supplies the single writer; synchronous publication
// keeps comparison and publication together without another request interleaving.
export async function commitBoard(project,topic,value){return publishPatch(project,topic,value,false);}
export async function undoBoard(project,topic,value){return publishPatch(project,topic,value,true);}
export async function commitOrganizerBoard(project,topic,value,organizer){return publishPatch(project,topic,value,false,organizer);}
export async function reviewBasis(project,topic,value){return publishPatch(project,topic,value,false,undefined,true);}
async function publishPatch(project,topic,value,undo,organizer,review){
 if(organizer&&(value.author?.kind!=='organizer'||value.author.id!=='organizer:'+organizer.taskId||value.intent!=='incremental-organize'))throw Error('Invalid Organizer authority');
 const patch=review?parseBasisReview(value,topic):undo?parseUndo(value):organizer?{...parsePatch({...value,author:{kind:'manual',id:value.author.id},intent:'explicit-save'}),author:value.author,intent:value.intent,taskId:organizer.taskId,attemptId:organizer.attemptId}:parsePatch(value),file=topicPath(project,topic);if(patch.topic!==topic)throw Error('Patch topic mismatch');
 const db=open(project);const request=JSON.stringify(patch);
 try{
  reconcile(db,project,topic,file);
  const prior=db.prepare('SELECT * FROM intents WHERE topic=? AND operation=?').get(topic,patch.operationId);
  if(prior){if(prior.request!==request)throw Error('Operation identity reused for different content');if(prior.status==='confirmed')return JSON.parse(prior.receipt);throw Error('Prepared publication requires recovery');}
  if(db.prepare("SELECT 1 FROM intents WHERE topic=? AND status='prepared'").get(topic))throw Error('Prepared publication requires recovery');
  const row=db.prepare('SELECT * FROM topics WHERE topic=?').get(topic);if(!row)throw Error('Unknown topic');
  if(observed(file)!==row.hash)throw recoveryError('Canvas externally changed; recovery required');
  let next;
  if(review)next=applyBasisReview(JSON.parse(row.state),patch);
  else if(undo)next=compensate(db,topic,patch,JSON.parse(row.state));
  else {
  const preview=inspectPatch(db,topic,patch,row,project);
  if(preview.conflicts.length)throw Object.assign(Error('Baseline conflict; full draft retained'),{preview});
  next=JSON.parse(row.state);next.revision++;
  for(const dependency of patch.readDependencies)if(![...next.canvas.nodes,...next.canvas.edges].some(n=>n.id===dependency))throw Error('Missing read dependency');
  const touched=new Set();
  for(const op of orderOperations(patch.operations)){
   if(op.type.endsWith('extra')){next=applyOperation(next,op);continue;}
   const identity=op.type==='create-card'?op.card.id:op.type==='create-relation'?op.edge.id:op.id;
   if(touched.has(identity))throw Error('Repeated object operation');touched.add(identity);
   const deleted=op.type==='delete-card'?[...next.canvas.edges.filter(e=>e.fromNode===identity||e.toNode===identity),next.canvas.nodes.find(n=>n.id===identity)]:op.type==='delete-relation'?[next.canvas.edges.find(e=>e.id===identity)]:[];
   for(const object of deleted){(next.deletionIntents??=[]).push({id:object.id,object,revision:next.revision,authorId:patch.author.id,operationId:patch.operationId});delete next.metadata[object.id];}
   next=applyOperation(next,op);
   if(op.type.startsWith('delete-'))delete next.metadata[identity];
   else {
    const previous=next.metadata[identity]??{},changed=op.type==='create-card'?Object.keys(op.card):op.type==='create-relation'?Object.keys(op.edge):(op.type==='edit-relation'?relationFields:editableFields).filter(k=>op[k]!==undefined);
    const layoutOnly=op.type==='edit-card'&&changed.every(k=>layoutFields.includes(k));
    const source=layoutOnly||organizer?.knowledge[identity]?.supplement?previous.source:organizer?.knowledge[identity]?.humanIntent?{kind:'manual',authorization:organizer.knowledge[identity].humanIntent}:organizer?{kind:'discussion',sourceIds:[organizer.sourceId]}:{kind:'manual',authorId:patch.author.id,operationId:patch.operationId};
    Object.defineProperty(next.metadata,identity,{value:{...previous,...(organizer?{organizer:{taskId:organizer.taskId,attemptId:organizer.attemptId},knowledge:organizer.knowledge[identity]}:{}),...(op.type==='create-card'?{role:op.card.type==='group'?'visual-region':'knowledge'}:{}),...(op.type==='create-card'&&op.card.derivedFrom?{derivedFrom:op.card.derivedFrom}:{}),source,modifiedRevision:next.revision,fields:{...previous.fields,...Object.fromEntries(changed.map(k=>[k,{modifiedRevision:next.revision,authorId:patch.author.id,operationId:patch.operationId}]))}},enumerable:true,configurable:true,writable:true});
   }
  }
  }
  invalidateBasis(JSON.parse(row.state),next);
  next.relations=semanticRelations(next.canvas.edges,next.canvas.nodes);
  validateCanvas(next.canvas);validateResources(project,next.canvas);
  const receipt={operationId:patch.operationId,topic,revision:next.revision,status:'committed'};
  publish(db,project,topic,file,{operation:patch.operationId,request,state:next,receipt},row.hash);
  return receipt;
 }finally{db.close();}
}

export async function readResourceStatus(project,topic,id){
 const state=await readCommitted(project,topic),card=state.canvas.nodes.find(n=>n.id===id);
 if(!card||card.type!=='file')throw Error('Unknown file resource');
 try{return resourceStatus(project,card.file);}catch{return {status:'blocked'};}
}

export async function readHistory(project,topic){await readCommitted(project,topic);const db=open(project,true);try{return revisionList(db,topic);}finally{db.close();}}
export async function previewHistory(project,topic,input){await readCommitted(project,topic);const db=open(project,true);try{return revisionState(db,topic,input?.revision);}finally{db.close();}}
export async function diffHistory(project,topic,input){await readCommitted(project,topic);const db=open(project,true);try{return boardDiff(revisionState(db,topic,input?.fromRevision),revisionState(db,topic,input?.toRevision));}finally{db.close();}}


export async function readRecoveryStatus(project,topic){const file=topicPath(project,topic),db=open(project);try{return recoveryStatus(db,topic,file);}finally{db.close();}}
export async function recoverBoard(project,topic,input){const file=topicPath(project,topic),db=open(project);try{return recoverUnknown(db,project,topic,file,input);}finally{db.close();}}

// Explicit exchange is also a typed board operation; all application is performed
// by operations.ts and all durable writes by the common publication protocol.
export async function exportCanvas(project,topic){const state=await readCommitted(project,topic);return {revision:state.revision,canvas:standardCanvas(state.canvas),degradation:exchangeDegradation(state)};}
function inspectImport(db,project,topic,file,input){
 if(!input||typeof input!=='object')throw Error('Expected Canvas import');
 if(db.prepare("SELECT 1 FROM intents WHERE topic=? AND status='prepared'").get(topic))throw recoveryError('Prepared publication requires recovery before import');
 const row=db.prepare('SELECT * FROM topics WHERE topic=?').get(topic);if(!row)throw Error('Unknown topic');
 const expectedHash=observed(file),external=input.external===true;
 if(expectedHash!==row.hash&&!external)throw recoveryError('External Canvas changed; preview external import explicitly');
 const canvas=parseImport(external?JSON.parse(fs.readFileSync(file,'utf8')):input.canvas);validateResources(project,canvas);
 const baseline=JSON.parse(row.state),changes=importChanges(baseline.canvas,canvas);
 for(const id of changes.added){const existed=db.prepare("SELECT 1 FROM revisions, json_each(revisions.state, '$.canvas.nodes') AS object WHERE topic=? AND json_extract(object.value,'$.id')=? UNION ALL SELECT 1 FROM revisions, json_each(revisions.state, '$.canvas.edges') AS object WHERE topic=? AND json_extract(object.value,'$.id')=? LIMIT 1").get(topic,id,topic,id);if(existed)throw Error('Deleted identity cannot be reused by import');}
 return {topic,baseRevision:row.revision,expectedHash,external,canvas:standardCanvas(canvas),changes,degradation:exchangeDegradation(baseline),candidateHash:hash(JSON.stringify(standardCanvas(canvas)))};
}
export async function previewImport(project,topic,input){const file=topicPath(project,topic),db=open(project);try{return inspectImport(db,project,topic,file,input);}finally{db.close();}}
export async function importCanvas(project,topic,input){
 if(!input||input.intent!=='explicit-import'||input.author?.kind!=='manual'||typeof input.author.id!=='string'||!input.author.id||typeof input.operationId!=='string'||!input.operationId||input.operationId.startsWith('$'))throw Error('Explicit manual import authorization required');
 if(input.topic!==topic)throw Error('Import topic mismatch');
 const file=topicPath(project,topic),db=open(project),request=JSON.stringify(input);
 try{
 const prior=db.prepare('SELECT * FROM intents WHERE topic=? AND operation=?').get(topic,input.operationId);
 if(prior){if(prior.request!==request)throw Error('Operation identity reused for different content');reconcile(db,project,topic,file);return JSON.parse(prior.receipt);}
 const preview=inspectImport(db,project,topic,file,input);
 if(input.baseRevision!==preview.baseRevision||input.expectedHash!==preview.expectedHash||input.candidateHash!==preview.candidateHash)throw recoveryError('Import fingerprint or baseline changed; preview again');
 const row=db.prepare('SELECT * FROM topics WHERE topic=?').get(topic),before=JSON.parse(row.state);
 let next=applyParsedOperation(before,{type:'replace-canvas',canvas:parseImport(preview.canvas)});next.revision++;
 const changed=new Set([...preview.changes.added,...preview.changes.changed]);
 for(const object of [...before.canvas.nodes,...before.canvas.edges])if(![...next.canvas.nodes,...next.canvas.edges].some(n=>n.id===object.id)){(next.deletionIntents??=[]).push({id:object.id,object,revision:next.revision,authorId:input.author.id,operationId:input.operationId});delete next.metadata[object.id];}
 for(const object of [...next.canvas.nodes,...next.canvas.edges]){
  const old=before.canvas.nodes.find(n=>n.id===object.id)??before.canvas.edges.find(n=>n.id===object.id);
  if(old&&((old.type??'text')!==(object.type??'text')||('fromNode' in old)!==('fromNode' in object)))throw Error('Import cannot change identity kind');
  if(changed.has(object.id))Object.defineProperty(next.metadata,object.id,{value:{...next.metadata[object.id],role:object.type==='group'?'visual-region':'knowledge',source:{kind:'manual',authorId:input.author.id,operationId:input.operationId},modifiedRevision:next.revision},enumerable:true,writable:true,configurable:true});
 }
 invalidateBasis(JSON.parse(row.state),next);
  next.relations=semanticRelations(next.canvas.edges,next.canvas.nodes);
 // Preserve exact external bytes before publication; the publisher rechecks the
 // fingerprint immediately before replacement. Concurrent applications aren't locked.
 let preservedFile=null;
 if(preview.external&&preview.expectedHash!==row.hash){
  const dest=path.join(path.dirname(file),`preserved-${preview.expectedHash}.canvas`),content=fs.readFileSync(file);
  if(hash(content)!==preview.expectedHash)throw recoveryError('External Canvas changed while preserving');
  if(!fs.existsSync(dest)){const fd=fs.openSync(dest,'wx',0o600);try{fs.writeFileSync(fd,content);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  if(observed(dest)!==preview.expectedHash)throw recoveryError('Preserved Canvas fingerprint mismatch');preservedFile=path.relative(project,dest);
 }
 const receipt={operationId:input.operationId,topic,revision:next.revision,status:'committed',preservedFile};
 publish(db,project,topic,file,{operation:input.operationId,request,state:next,receipt},preview.expectedHash);return receipt;
 }finally{db.close();}
}

export async function readOperationReceipt(project,topic,operation){await readCommitted(project,topic);const db=open(project,true);try{const row=db.prepare("SELECT receipt FROM intents WHERE topic=? AND operation=? AND status='confirmed'").get(topic,operation);return row?JSON.parse(row.receipt):null;}finally{db.close();}}



export async function readKnowledgeContext(project,topic){return knowledgeContext(await readCommitted(project,topic));}
