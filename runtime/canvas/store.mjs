import {parseEdge,relationFields,semanticRelations} from './relations.ts';
import {validateResources,resourceStatus} from './resources.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {compileCanvas,validateCanvas,parsePatch,parseCard,editableFields} from './contract.ts';
export function topicPath(project,topic){
 if(!project||!topic||! /^[a-zA-Z0-9_-]+$/.test(topic))throw Error('Explicit project and safe topic are required');
 return path.join(path.resolve(project),'.bang','topics',topic,'current.canvas');
}
const hash=s=>createHash('sha256').update(s).digest('hex');
const bytes=board=>JSON.stringify(board,null,2)+'\n';
function open(project,readonly=false){
 const db=new DatabaseSync(path.join(path.resolve(project),'.bang','board.sqlite'),{readOnly:readonly});
 if(!readonly){db.exec(`PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS topics(topic TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL, hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS revisions(topic TEXT, revision INTEGER, state TEXT NOT NULL, PRIMARY KEY(topic,revision)); CREATE TABLE IF NOT EXISTS intents(topic TEXT, operation TEXT, request TEXT NOT NULL, state TEXT NOT NULL, hash TEXT NOT NULL, receipt TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(topic,operation));`);}
 return db;
}
export async function readBoard(project,topic){return (await readCommitted(project,topic)).canvas;}
export async function readCommitted(project,topic){
 const file=topicPath(project,topic),db=open(project,true);
 try{const row=db.prepare('SELECT * FROM topics WHERE topic=?').get(topic);if(!row)throw Error('Unknown topic');if(hash(fs.readFileSync(file))!==row.hash)throw Error('Canvas publication pending or externally changed; recovery required');return JSON.parse(row.state);}finally{db.close();}
}
export async function generateBoard(project,topic,input){
 const board=compileCanvas(input),file=topicPath(project,topic);validateResources(project,board);fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,bytes(board),{flag:'wx'});
 const state={revision:0,canvas:board,relations:semanticRelations(board.edges),deletionIntents:[],metadata:Object.fromEntries([...board.nodes,...board.edges].map(n=>[n.id,{source:{kind:'bootstrap'},modifiedRevision:0}]))},db=open(project);
 try{db.exec('BEGIN IMMEDIATE');db.prepare('INSERT INTO topics VALUES(?,?,?,?)').run(topic,0,JSON.stringify(state),hash(bytes(board)));db.prepare('INSERT INTO revisions VALUES(?,?,?)').run(topic,0,JSON.stringify(state));db.exec('COMMIT');}finally{db.close();}return board;
}
function applyOperation(canvas,op){
 if(op.type.endsWith('relation')){const i=canvas.edges.findIndex(e=>e.id===op.id);if(op.type==='create-relation')canvas.edges.push(parseEdge(op.edge));else if(op.type==='delete-relation')canvas.edges.splice(i,1);else for(const field of relationFields)if(op[field]!==undefined)canvas.edges[i][field]=op[field];return;}
 const id=op.type==='create-card'?op.card.id:op.id,index=canvas.nodes.findIndex(n=>n.id===id);
 if(op.type==='create-card')canvas.nodes.push(parseCard(op.card));
 else if(op.type==='delete-card'){canvas.nodes.splice(index,1);canvas.edges=canvas.edges.filter(e=>e.fromNode!==id&&e.toNode!==id);}
 else for(const field of editableFields)if(op[field]!==undefined)canvas.nodes[index][field]=op[field];
}
// All comparisons use persisted historical fields, including local acknowledged overlays.
function inspectPatch(db,topic,patch,row,project){
 const snapshots=new Map(),current=JSON.parse(row.state),conflicts=[],legalOperations=[],touched=new Set();
 const baseline=revision=>{if(revision>row.revision)throw Error('Unknown baseline');if(!snapshots.has(revision)){const old=db.prepare('SELECT state FROM revisions WHERE topic=? AND revision=?').get(topic,revision);if(!old)throw Error('Unknown baseline');snapshots.set(revision,JSON.parse(old.state));}return snapshots.get(revision);};
 const original=baseline(patch.baseRevision);
 const dependencyConflict=patch.readDependencies.some(id=>{const old=[...original.canvas.nodes,...original.canvas.edges].find(n=>n.id===id),now=[...current.canvas.nodes,...current.canvas.edges].find(n=>n.id===id);return !old||JSON.stringify(old)!==JSON.stringify(now);});
 for(const [operationIndex,op] of patch.operations.entries()){
  const relation=op.type.endsWith('relation'),collection=relation?'edges':'nodes',creating=op.type.startsWith('create-'),deleting=op.type.startsWith('delete-');
  const id=creating?(relation?op.edge.id:op.card.id):op.id,now=current.canvas[collection].find(n=>n.id===id),before=conflicts.length;
  const conflict=(field,base,current,proposed,reason)=>conflicts.push({operationIndex,id,field,base:base??null,current:current??null,proposed:proposed??null,reason});
  if(touched.has(id))conflict('id',id,id,id,'Repeated object operation');touched.add(id);
  if(dependencyConflict)conflict('$dependency',null,null,null,'Read dependency changed');
  if(creating){
   const existed=db.prepare("SELECT 1 FROM revisions, json_each(revisions.state, '$.canvas.nodes') AS node WHERE topic=? AND json_extract(node.value,'$.id')=? LIMIT 1").get(topic,id);
   const edgeExisted=db.prepare("SELECT 1 FROM revisions, json_each(revisions.state, '$.canvas.edges') AS edge WHERE topic=? AND json_extract(edge.value,'$.id')=? LIMIT 1").get(topic,id);
   if(existed||edgeExisted)conflict('id',null,now,op.card??op.edge,now?'Identity already exists':'Deleted identity cannot be reused');
   if(relation&&(current.deletionIntents??[]).some(d=>d.revision>patch.baseRevision&&d.object.fromNode===op.edge.fromNode&&d.object.toNode===op.edge.toNode))conflict('$deletion',null,null,op.edge,'Relation deletion intent is newer than baseline');
  }
  else if(!now)conflict('id',id,null,op.type==='delete-card'?null:op,'Card deleted');
  else {
   const fields=deleting?(relation?['id',...relationFields]:['id','type','text','x','y','width','height','file','url']):['id',...(relation?relationFields:editableFields).filter(k=>op[k]!==undefined)];
   for(const field of fields){const old=baseline(op.fieldRevisions?.[field]??patch.baseRevision).canvas[collection].find(n=>n.id===id);if(!old||old[field]!==now[field])conflict(field,old?.[field],now[field],op.type==='delete-card'?null:op[field],'Field changed');}
   if(op.type==='edit-card'&&((op.file!==undefined&&now.type!=='file')||(op.url!==undefined&&now.type!=='link')))conflict('type',null,now.type,null,'Resource type mismatch');
  }
  if(conflicts.length===before){
   try{const candidate=structuredClone(current.canvas);for(const accepted of [...legalOperations,op])applyOperation(candidate,accepted);validateCanvas(candidate);validateResources(project,candidate);legalOperations.push(op);}
   catch(error){conflict('$constraints',null,null,null,error.message);}
  }
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
export async function commitBoard(project,topic,value){
 const patch=parsePatch(value),file=topicPath(project,topic);if(patch.topic!==topic)throw Error('Patch topic mismatch');
 const db=open(project);const request=JSON.stringify(patch);
 try{
  const prior=db.prepare('SELECT * FROM intents WHERE topic=? AND operation=?').get(topic,patch.operationId);
  if(prior){if(prior.request!==request)throw Error('Operation identity reused for different content');if(prior.status==='confirmed')return JSON.parse(prior.receipt);throw Error('Prepared publication requires recovery');}
  if(db.prepare("SELECT 1 FROM intents WHERE topic=? AND status='prepared'").get(topic))throw Error('Prepared publication requires recovery');
  const row=db.prepare('SELECT * FROM topics WHERE topic=?').get(topic);if(!row)throw Error('Unknown topic');
  if(hash(fs.readFileSync(file))!==row.hash)throw Error('Canvas externally changed; refusing overwrite');
  const preview=inspectPatch(db,topic,patch,row,project);
  if(preview.conflicts.length)throw Object.assign(Error('Baseline conflict; full draft retained'),{preview});
  const next=JSON.parse(row.state);next.revision++;
  for(const dependency of patch.readDependencies)if(!next.canvas.nodes.some(n=>n.id===dependency))throw Error('Missing read dependency');
  const touched=new Set();
  for(const op of patch.operations){
   const identity=op.type==='create-card'?op.card.id:op.type==='create-relation'?op.edge.id:op.id;
   if(touched.has(identity))throw Error('Repeated object operation');touched.add(identity);
   const deleted=op.type==='delete-card'?[...next.canvas.edges.filter(e=>e.fromNode===identity||e.toNode===identity),next.canvas.nodes.find(n=>n.id===identity)]:op.type==='delete-relation'?[next.canvas.edges.find(e=>e.id===identity)]:[];
   for(const object of deleted){(next.deletionIntents??=[]).push({id:object.id,object,revision:next.revision,authorId:patch.author.id,operationId:patch.operationId});delete next.metadata[object.id];}
   applyOperation(next.canvas,op);
   if(op.type.startsWith('delete-'))delete next.metadata[identity];
   else Object.defineProperty(next.metadata,identity,{value:{source:{kind:'manual',authorId:patch.author.id,operationId:patch.operationId},modifiedRevision:next.revision},enumerable:true,configurable:true,writable:true});
  }
  next.relations=semanticRelations(next.canvas.edges);
  validateCanvas(next.canvas);validateResources(project,next.canvas);
  const content=bytes(next.canvas),digest=hash(content),state=JSON.stringify(next);
  const receipt={operationId:patch.operationId,topic,revision:next.revision,status:'committed'};
  db.prepare('INSERT INTO intents VALUES(?,?,?,?,?,?,?)').run(topic,patch.operationId,request,state,digest,JSON.stringify(receipt),'prepared');
  const temporary=path.join(path.dirname(file),'publish.tmp');
  const fd=fs.openSync(temporary,'wx');try{fs.writeFileSync(fd,content);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  if(hash(fs.readFileSync(file))!==row.hash)throw Error('Canvas externally changed during preparation; recovery required');
  fs.renameSync(temporary,file);
  db.exec('BEGIN IMMEDIATE');
  try{db.prepare('UPDATE topics SET revision=?,state=?,hash=? WHERE topic=?').run(next.revision,state,digest,topic);db.prepare('INSERT INTO revisions VALUES(?,?,?)').run(topic,next.revision,state);db.prepare("UPDATE intents SET status='confirmed' WHERE topic=? AND operation=?").run(topic,patch.operationId);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  return receipt;
 }finally{db.close();}
}

export async function readResourceStatus(project,topic,id){
 const state=await readCommitted(project,topic),card=state.canvas.nodes.find(n=>n.id===id);
 if(!card||card.type!=='file')throw Error('Unknown file resource');
 try{return resourceStatus(project,card.file);}catch{return {status:'blocked'};}
}
