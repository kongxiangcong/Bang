import {editableFields,type EditorExtra,type BoardOperation,type Card,type Edge,type CommittedBoard,type FieldRevisions} from '../../../runtime/canvas/contract';
import {relationFields} from '../../../runtime/canvas/relations';
export type Overlay=Record<string,FieldRevisions>;
const allFields=['id','type',...editableFields];
const identity=(op:BoardOperation)=>op.type==='create-extra'?op.extra.id:op.type==='create-card'?op.card.id:op.type==='create-relation'?op.edge.id:op.id;
const keysFor=(op:BoardOperation)=>op.type.endsWith('extra')?['element']:op.type.endsWith('relation')?relationFields:editableFields;
const collection=(op:BoardOperation)=>op.type.endsWith('extra')?'extras':op.type.endsWith('relation')?'edges':'nodes';
export function edits(base:CommittedBoard,cards:Card[],overlay:Overlay,edges:Edge[]=base.canvas.edges,extras:EditorExtra[]=base.editorExtras??[]):BoardOperation[]{
 const operations:BoardOperation[]=[];
 for(const [kind,objects,oldObjects,fields] of [['card',cards,base.canvas.nodes,editableFields],['relation',edges,base.canvas.edges,relationFields]] as const){
  for(const object of objects){const old=oldObjects.find(n=>n.id===object.id);if(!old)operations.push(kind==='card'?{type:'create-card',card:object as Card}:{type:'create-relation',edge:object as Edge});
   else {const changed=Object.fromEntries(fields.filter(k=>(old as any)[k]!==(object as any)[k]).map(k=>[k,(object as any)[k]]));if(Object.keys(changed).length)operations.push({type:`edit-${kind}`,id:object.id,...changed,fieldRevisions:overlay[object.id]} as BoardOperation);}}
  for(const old of oldObjects)if(!objects.some(c=>c.id===old.id)){
   if(kind==='relation'&&(!cards.some(c=>c.id===(old as Edge).fromNode)||!cards.some(c=>c.id===(old as Edge).toNode)))continue;
   operations.push({type:`delete-${kind}`,id:old.id,fieldRevisions:overlay[old.id]} as BoardOperation);
  }
 }
 for(const extra of extras){const old=base.editorExtras?.find(e=>e.id===extra.id);if(!old)operations.push({type:'create-extra',extra});else if(JSON.stringify(old.element)!==JSON.stringify(extra.element))operations.push({type:'edit-extra',id:extra.id,element:extra.element,fieldRevisions:overlay['extra:'+extra.id]});}
 for(const old of base.editorExtras??[])if(!extras.some(e=>e.id===old.id))operations.push({type:'delete-extra',id:old.id,fieldRevisions:overlay['extra:'+old.id]});
 return operations;
}
export function acknowledge(base:CommittedBoard,operations:BoardOperation[],overlay:Overlay,revision:number){
 const next=structuredClone(base),fields=structuredClone(overlay);
 for(const op of operations){const id=identity(op),key=collection(op);if(key==='extras'){const objects=next.editorExtras??=[],i=objects.findIndex(e=>e.id===id);if(op.type==='create-extra')objects.push(op.extra);else if(op.type==='delete-extra')objects.splice(i,1);else objects[i]={id,element:(op as any).element};fields['extra:'+id]={element:revision};continue;}const objects=next.canvas[key] as any[];
  if(op.type.startsWith('create-')){objects.push(op.type==='create-card'?{...op.card,type:op.card.type??'text'}:(op as any).edge);fields[id]=Object.fromEntries((key==='nodes'?allFields:['id',...relationFields]).map(k=>[k,revision]));}
  else if(op.type.startsWith('delete-')){objects.splice(objects.findIndex(n=>n.id===id),1);delete fields[id];if(key==='nodes')next.canvas.edges=next.canvas.edges.filter(e=>e.fromNode!==id&&e.toNode!==id);}
  else {const object=objects.find(n=>n.id===id)!;for(const k of keysFor(op))if((op as any)[k]!==undefined){object[k]=(op as any)[k];fields[id]={...fields[id],[k]:revision};}}
 }
 return {base:next,overlay:fields};
}
export function keepAndMerge(base:CommittedBoard,cards:Card[],overlay:Overlay,remote:CommittedBoard,edges:Edge[]=base.canvas.edges,extras:EditorExtra[]=base.editorExtras??[]){
 const operations=edits(base,cards,overlay,edges,extras),next=structuredClone(remote),merged=structuredClone(remote.canvas),fields:Overlay={},mergedExtras=structuredClone(remote.editorExtras??[]);
 for(const op of operations){const id=identity(op),key=collection(op);if(key==='extras'){const before=next.editorExtras??=[],old=base.editorExtras?.find(e=>e.id===id),i=mergedExtras.findIndex(e=>e.id===id),j=before.findIndex(e=>e.id===id);if(j!==-1)before.splice(j,1);if(old)before.push(old);if(i!==-1)mergedExtras.splice(i,1);if(op.type==='create-extra')mergedExtras.push(op.extra);else if(op.type==='edit-extra')mergedExtras.push({id,element:op.element});fields['extra:'+id]={element:overlay['extra:'+id]?.element??base.revision};continue;}const beforeObjects=next.canvas[key] as any[],objects=merged[key] as any[],old=(base.canvas[key] as any[]).find(n=>n.id===id);
  if(op.type.startsWith('create-')){const b=beforeObjects.findIndex(n=>n.id===id);if(b!==-1)beforeObjects.splice(b,1);const i=objects.findIndex(n=>n.id===id);if(i!==-1)objects.splice(i,1);objects.push(op.type==='create-card'?op.card:(op as any).edge);continue;}
  const keys=op.type.startsWith('delete-')?(key==='nodes'?allFields:['id',...relationFields]):['id',...keysFor(op).filter(k=>(op as any)[k]!==undefined)];
  fields[id]=Object.fromEntries(keys.map(k=>[k,overlay[id]?.[k]??base.revision]));
  let before=beforeObjects.find(n=>n.id===id);if(!before){before={...old};beforeObjects.push(before);}for(const k of keys)before[k]=old?.[k];
  const i=objects.findIndex(n=>n.id===id);
  if(op.type.startsWith('delete-')){if(i!==-1)objects.splice(i,1);if(key==='nodes')merged.edges=merged.edges.filter(e=>e.fromNode!==id&&e.toNode!==id);}
  else {const object=i===-1?{...old}:objects[i];for(const k of keysFor(op))if((op as any)[k]!==undefined)object[k]=(op as any)[k];if(i===-1)objects.push(object);}
 }
 return {base:next,cards:merged.nodes,edges:merged.edges,extras:mergedExtras,overlay:fields};
}
