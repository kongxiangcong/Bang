import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {compileCanvas,validateCanvas,parsePatch,parseCard} from './contract.ts';
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
 const board=compileCanvas(input),file=topicPath(project,topic);fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,bytes(board),{flag:'wx'});
 const state={revision:0,canvas:board,metadata:Object.fromEntries(board.nodes.map(n=>[n.id,{source:{kind:'bootstrap'},modifiedRevision:0}]))},db=open(project);
 try{db.exec('BEGIN IMMEDIATE');db.prepare('INSERT INTO topics VALUES(?,?,?,?)').run(topic,0,JSON.stringify(state),hash(bytes(board)));db.prepare('INSERT INTO revisions VALUES(?,?,?)').run(topic,0,JSON.stringify(state));db.exec('COMMIT');}finally{db.close();}return board;
}
// Synchronous publication prevents interleaving within this process. Cross-process
// ownership is the native single-writer ticket; do not run competing writers yet.
export async function commitBoard(project,topic,value){
 const patch=parsePatch(value),file=topicPath(project,topic);if(patch.topic!==topic)throw Error('Patch topic mismatch');
 const db=open(project);const request=JSON.stringify(patch);
 try{
  const prior=db.prepare('SELECT * FROM intents WHERE topic=? AND operation=?').get(topic,patch.operationId);
  if(prior){if(prior.request!==request)throw Error('Operation identity reused for different content');if(prior.status==='confirmed')return JSON.parse(prior.receipt);throw Error('Prepared publication requires recovery');}
  if(db.prepare("SELECT 1 FROM intents WHERE topic=? AND status='prepared'").get(topic))throw Error('Prepared publication requires recovery');
  const row=db.prepare('SELECT * FROM topics WHERE topic=?').get(topic);if(!row)throw Error('Unknown topic');
  if(hash(fs.readFileSync(file))!==row.hash)throw Error('Canvas externally changed; refusing overwrite');
  if(row.revision!==patch.baseRevision)throw Error('Baseline conflict; reload and compare before saving');
  const next=JSON.parse(row.state);next.revision++;
  for(const dependency of patch.readDependencies)if(!next.canvas.nodes.some(n=>n.id===dependency))throw Error('Missing read dependency');
  const touched=new Set();
  for(const op of patch.operations){
   const identity=op.type==='create-card'?op.card.id:op.id;
   if(touched.has(identity))throw Error('Repeated object operation');touched.add(identity);
   const index=next.canvas.nodes.findIndex(n=>n.id===identity);
   if(op.type==='create-card'){if(index!==-1)throw Error('Card already exists');next.canvas.nodes.push({...parseCard(op.card),type:'text'});}
   else {if(index===-1)throw Error('Card not found');if(op.type==='edit-card')next.canvas.nodes[index].text=op.text;else next.canvas.nodes.splice(index,1);}
   if(op.type==='delete-card')delete next.metadata[identity];
   else Object.defineProperty(next.metadata,identity,{value:{source:{kind:'manual',authorId:patch.author.id,operationId:patch.operationId},modifiedRevision:next.revision},enumerable:true,configurable:true,writable:true});
  }
  validateCanvas(next.canvas);
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
