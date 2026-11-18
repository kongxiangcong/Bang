import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {compileCanvas} from '../runtime/canvas/contract.ts';
import {performanceDataset} from '../baselines/whiteboard-v1/performance-dataset.mjs';
import {runtimeOperation,ensureRuntime} from '../runtime/native/runtime.mjs';

const directory=path.resolve(process.argv[2]);
const limit=Number(process.argv[3]??10000);
assert.ok(Number.isInteger(limit)&&limit>=1&&limit<=10000);
await fs.mkdir(directory,{recursive:true});
const project=path.join(directory,'synthetic-project');
await fs.mkdir(project,{recursive:true});
const log=path.join(directory,'generation.jsonl');
const record=data=>fs.appendFile(log,JSON.stringify({at:new Date().toISOString(),...data})+'\n');
// Use one authenticated session to the actual native owner for workload setup.
const connection=await ensureRuntime(project);
async function call(command,input){
 const response=await fetch(connection.url+'/control',{method:'POST',headers:{'Content-Type':'application/json','x-bang-token':connection.token,'x-bang-epoch':connection.epoch},body:JSON.stringify({command,topic:'t32',input}),signal:AbortSignal.timeout(5000)});
 const result=await response.json();
 if(!response.ok)throw Error(result.error);
 return result;
}
const {nodes,edges,revisions}=performanceDataset();
let head=0;
try{
 const disk=await fs.statfs(directory);
 assert.ok(disk.bavail*disk.bsize>4*1024**3,'At least 4 GiB free required');
 const hashes={};
 for(const file of ['baselines/whiteboard-v1/performance-dataset.mjs','runtime/canvas/store.mjs','runtime/canvas/publication.mjs','runtime/canvas/history-storage.mjs','runtime/canvas/operations.ts']){
  hashes[file]=createHash('sha256').update(await fs.readFile(new URL('../'+file,import.meta.url))).digest('hex');
 }
 const compileStart=performance.now(),compiled=compileCanvas({cards:nodes,edges});
 const compileMs=performance.now()-compileStart;
 assert.deepEqual(compiled.edges,edges);
 await record({limit,compileMs,hashes});
 const file=path.join(project,'.bang/topics/t32/current.canvas');
 if(!await fs.stat(file).catch(error=>{if(error.code!=='ENOENT')throw error;})){
  const t=performance.now();
  const compiled=await call('generate',{cards:nodes,edges});
  assert.equal(compiled.nodes.length,nodes.length);assert.deepEqual(compiled.edges,edges);
  await record({generateAndPublishMs:performance.now()-t});
 }
 const state=await call('state');
 head=state.revision;
 assert.equal(state.canvas.nodes.length,nodes.length);
 assert.deepEqual(state.canvas.edges,edges);
 for(const [i,node] of state.canvas.nodes.entries()){
  const last=i+1+1000*Math.floor((head-i-1)/1000);
  assert.equal(node.text,last>0?revisions[last-1].text:nodes[i].text);
 }
 const started=performance.now(),initial=head;
 for(const edit of revisions.slice(head,limit)){
  const t=performance.now();
  const receipt=await call('commit',{topic:'t32',operationId:'frozen-'+edit.revision,baseRevision:head,author:{kind:'manual',id:'reference'},intent:'explicit-save',readDependencies:[],operations:[{type:'edit-card',id:edit.nodeId,text:edit.text}]});
  assert.equal(receipt.revision,edit.revision);
  head=receipt.revision;
  if(head-initial<=3||head%50===0||head===limit){
   const disk=await fs.statfs(directory);
   const elapsed=performance.now()-started;
   await record({head,lastMs:performance.now()-t,elapsedMs:elapsed,estimatedRemainingSeconds:(10000-head)*elapsed/(head-initial)/1000,dbBytes:(await fs.stat(path.join(project,'.bang/board.sqlite'))).size,freeBytes:disk.bavail*disk.bsize});
   assert.ok(disk.bavail*disk.bsize>4*1024**3,'Low free space');
   if(await fs.stat(path.join(directory,'pause-generation')).catch(e=>{if(e.code!=='ENOENT')throw e;})){await record({head,paused:true});break;}
  }
 }
}catch(error){await record({head,error:error.stack});throw error;}
finally{await runtimeOperation(project,'stop');}
