import {editableFields,type BoardOperation,type Card,type Edge,type CommittedBoard,type FieldRevisions} from '../../../runtime/canvas/contract';
import {relationFields} from '../../../runtime/canvas/relations';
export type Overlay=Record<string,FieldRevisions>;
const allFields=['id','type','text','x','y','width','height','file','url'];
const identity=(op:BoardOperation)=>op.type==='create-card'?op.card.id:op.type==='create-relation'?op.edge.id:op.id;
const keysFor=(op:BoardOperation)=>op.type.endsWith('relation')?relationFields:editableFields;
const collection=(op:BoardOperation)=>op.type.endsWith('relation')?'edges':'nodes';
export function edits(base:CommittedBoard,cards:Card[],overlay:Overlay,edges:Edge[]=base.canvas.edges):BoardOperation[]{
 const operations:BoardOperation[]=[];
 for(const [kind,objects,oldObjects,fields] of [['card',cards,base.canvas.nodes,editableFields],['relation',edges,base.canvas.edges,relationFields]] as const){
  for(const object of objects){const old=oldObjects.find(n=>n.id===object.id);if(!old)operations.push(kind==='card'?{type:'create-card',card:object as Card}:{type:'create-relation',edge:object as Edge});
   else {const changed=Object.fromEntries(fields.filter(k=>(old as any)[k]!==(object as any)[k]).map(k=>[k,(object as any)[k]]));if(Object.keys(changed).length)operations.push({type:`edit-${kind}`,id:object.id,...changed,fieldRevisions:overlay[object.id]} as BoardOperation);}}
  for(const old of oldObjects)if(!objects.some(c=>c.id===old.id)){
   if(kind==='relation'&&(!cards.some(c=>c.id===(old as Edge).fromNode)||!cards.some(c=>c.id===(old as Edge).toNode)))continue;
   operations.push({type:`delete-${kind}`,id:old.id,fieldRevisions:overlay[old.id]} as BoardOperation);
  }
 }
 return operations;
}
export function acknowledge(base:CommittedBoard,operations:BoardOperation[],overlay:Overlay,revision:number){
 const next=structuredClone(base),fields=structuredClone(overlay);
 for(const op of operations){const id=identity(op),key=collection(op),objects=next.canvas[key] as any[];
  if(op.type.startsWith('create-')){objects.push(op.type==='create-card'?{...op.card,type:op.card.type??'text'}:(op as any).edge);fields[id]=Object.fromEntries((key==='nodes'?allFields:['id',...relationFields]).map(k=>[k,revision]));}
  else if(op.type.startsWith('delete-')){objects.splice(objects.findIndex(n=>n.id===id),1);delete fields[id];if(key==='nodes')next.canvas.edges=next.canvas.edges.filter(e=>e.fromNode!==id&&e.toNode!==id);}
  else {const object=objects.find(n=>n.id===id)!;for(const k of keysFor(op))if((op as any)[k]!==undefined){object[k]=(op as any)[k];fields[id]={...fields[id],[k]:revision};}}
 }
 return {base:next,overlay:fields};
}
export function keepAndMerge(base:CommittedBoard,cards:Card[],overlay:Overlay,remote:CommittedBoard,edges:Edge[]=base.canvas.edges){
 const operations=edits(base,cards,overlay,edges),next=structuredClone(remote),merged=structuredClone(remote.canvas),fields:Overlay={};
 for(const op of operations){const id=identity(op),key=collection(op),beforeObjects=next.canvas[key] as any[],objects=merged[key] as any[],old=(base.canvas[key] as any[]).find(n=>n.id===id);
  if(op.type.startsWith('create-')){const b=beforeObjects.findIndex(n=>n.id===id);if(b!==-1)beforeObjects.splice(b,1);const i=objects.findIndex(n=>n.id===id);if(i!==-1)objects.splice(i,1);objects.push(op.type==='create-card'?op.card:(op as any).edge);continue;}
  const keys=op.type.startsWith('delete-')?(key==='nodes'?allFields:['id',...relationFields]):['id',...keysFor(op).filter(k=>(op as any)[k]!==undefined)];
  fields[id]=Object.fromEntries(keys.map(k=>[k,overlay[id]?.[k]??base.revision]));
  let before=beforeObjects.find(n=>n.id===id);if(!before){before={...old};beforeObjects.push(before);}for(const k of keys)before[k]=old?.[k];
  const i=objects.findIndex(n=>n.id===id);
  if(op.type.startsWith('delete-')){if(i!==-1)objects.splice(i,1);if(key==='nodes')merged.edges=merged.edges.filter(e=>e.fromNode!==id&&e.toNode!==id);}
  else {const object=i===-1?{...old}:objects[i];for(const k of keysFor(op))if((op as any)[k]!==undefined)object[k]=(op as any)[k];if(i===-1)objects.push(object);}
 }
 return {base:next,cards:merged.nodes,edges:merged.edges,overlay:fields};
}
