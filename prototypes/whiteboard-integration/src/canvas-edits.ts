import {applyOperation,orderOperations,operationIdentity as identity} from '../../../runtime/canvas/operations';
import {editableFields,type EditorExtra,type BoardOperation,type Card,type Edge,type CommittedBoard,type FieldRevisions} from '../../../runtime/canvas/contract';
import {relationFields} from '../../../runtime/canvas/relations';
export type Overlay=Record<string,FieldRevisions>;
const allFields=['id','type',...editableFields];
const keysFor=(op:BoardOperation)=>op.type.endsWith('extra')?['element']:op.type.endsWith('relation')?relationFields:editableFields;
const collection=(op:BoardOperation)=>op.type.endsWith('extra')?'extras':op.type.endsWith('relation')?'edges':'nodes';
export function edits(base:CommittedBoard,cards:Card[],overlay:Overlay,edges:Edge[]=base.canvas.edges,extras:EditorExtra[]=base.editorExtras??[]):BoardOperation[]{
 const operations:BoardOperation[]=[];
 for(const [kind,objects,oldObjects,fields] of [['card',cards,base.canvas.nodes,editableFields],['relation',edges,base.canvas.edges,relationFields]] as const){
  if(objects===oldObjects)continue;
  const previousById=new Map<string,Card|Edge>();
  for(const old of oldObjects)previousById.set(old.id,old);
  const present=new Set(objects.map(n=>n.id));
  for(const object of objects){const old=previousById.get(object.id);if(!old)operations.push(kind==='card'?{type:'create-card',card:object as Card}:{type:'create-relation',edge:object as Edge});
   else {const changed=Object.fromEntries(fields.filter(k=>JSON.stringify((old as any)[k])!==JSON.stringify((object as any)[k])).map(k=>[k,(object as any)[k]]));if(Object.keys(changed).length)operations.push({type:`edit-${kind}`,id:object.id,...changed,fieldRevisions:overlay[object.id]} as BoardOperation);}}
  for(const old of oldObjects)if(!present.has(old.id)){
   // A locally acknowledged relation carries newer field baselines than the
   // displayed board. Other incident edges remain guarded server-side cascades.
   if(kind==='relation'&&!overlay[old.id]&&(!cards.some(c=>c.id===(old as Edge).fromNode)||!cards.some(c=>c.id===(old as Edge).toNode)))continue;
   operations.push({type:`delete-${kind}`,id:old.id,fieldRevisions:overlay[old.id]} as BoardOperation);
  }
 }
 for(const extra of extras){const old=base.editorExtras?.find(e=>e.id===extra.id);if(!old)operations.push({type:'create-extra',extra});else if(JSON.stringify(old.element)!==JSON.stringify(extra.element))operations.push({type:'edit-extra',id:extra.id,element:extra.element,fieldRevisions:overlay['extra:'+extra.id]});}
 for(const old of base.editorExtras??[])if(!extras.some(e=>e.id===old.id))operations.push({type:'delete-extra',id:old.id,fieldRevisions:overlay['extra:'+old.id]});
 return orderOperations(operations);
}
export function acknowledge(base:CommittedBoard,operations:BoardOperation[],overlay:Overlay,revision:number){
 let next=structuredClone(base);const fields=structuredClone(overlay);
 for(const op of orderOperations(operations)){
  const id=identity(op),key=collection(op);
  next=applyOperation(next,op);
  if(key==='extras'){if(op.type==='delete-extra')delete fields['extra:'+id];else fields['extra:'+id]={element:revision};continue;}
  if(op.type.startsWith('create-'))fields[id]=Object.fromEntries((key==='nodes'?allFields:['id',...relationFields]).map(k=>[k,revision]));
  else if(op.type.startsWith('delete-'))delete fields[id];
  else for(const k of keysFor(op))if((op as any)[k]!==undefined)fields[id]={...fields[id],[k]:revision};
 }

 return {base:next,overlay:fields};
}
export function keepAndMerge(base:CommittedBoard,cards:Card[],overlay:Overlay,remote:CommittedBoard,edges:Edge[]=base.canvas.edges,extras:EditorExtra[]=base.editorExtras??[]){
 const operations=edits(base,cards,overlay,edges,extras),next=structuredClone(remote),fields:Overlay={};let merged={canvas:structuredClone(remote.canvas),editorExtras:structuredClone(remote.editorExtras??[])};
 for(const op of orderOperations(operations)){
  const id=identity(op),key=collection(op);
  if(key==='extras'){
   const before=next.editorExtras??=[],old=base.editorExtras?.find(e=>e.id===id),i=merged.editorExtras.findIndex(e=>e.id===id),j=before.findIndex(e=>e.id===id);
   if(j!==-1)before.splice(j,1);if(old)before.push(old);
   if(op.type==='create-extra'&&i!==-1)merged.editorExtras.splice(i,1);
   if(op.type==='edit-extra'&&i===-1&&old)merged.editorExtras.push(structuredClone(old));
   fields['extra:'+id]={element:overlay['extra:'+id]?.element??base.revision};
  }else{
   const beforeObjects=next.canvas[key] as any[],objects=merged.canvas[key] as any[],old=(base.canvas[key] as any[]).find(n=>n.id===id);
   if(op.type.startsWith('create-')){
    const b=beforeObjects.findIndex(n=>n.id===id);if(b!==-1)beforeObjects.splice(b,1);
    const i=objects.findIndex(n=>n.id===id);if(i!==-1)objects.splice(i,1);
   }else{
    const keys=op.type.startsWith('delete-')?(key==='nodes'?allFields:['id',...relationFields]):['id',...keysFor(op).filter(k=>(op as any)[k]!==undefined)];
    fields[id]=Object.fromEntries(keys.map(k=>[k,overlay[id]?.[k]??base.revision]));
    let before=beforeObjects.find(n=>n.id===id);if(!before){before={...old};beforeObjects.push(before);}for(const k of keys)before[k]=old?.[k];
    if(op.type.startsWith('edit-')&&!objects.some(n=>n.id===id))objects.push(structuredClone(old));
   }
  }
  merged=applyOperation(merged,op);
 }
 return {base:next,cards:merged.canvas.nodes,edges:merged.canvas.edges,extras:merged.editorExtras,overlay:fields};
}
