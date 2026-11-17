import {editableFields,type BoardOperation,type Card,type CommittedBoard,type FieldRevisions} from '../../../runtime/canvas/contract';
export type Overlay=Record<string,FieldRevisions>;
const allFields=['id','type','text','x','y','width','height','file','url'];
export function edits(base:CommittedBoard,cards:Card[],overlay:Overlay):BoardOperation[]{
 const operations:BoardOperation[]=[];
 for(const card of cards){
  const old=base.canvas.nodes.find(n=>n.id===card.id);
  if(!old)operations.push({type:'create-card',card});
  else {const changed=Object.fromEntries(editableFields.filter(k=>old[k]!==card[k]).map(k=>[k,card[k]]));if(Object.keys(changed).length)operations.push({type:'edit-card',id:card.id,...changed,fieldRevisions:overlay[card.id]});}
 }
 for(const old of base.canvas.nodes)if(!cards.some(c=>c.id===old.id))operations.push({type:'delete-card',id:old.id,fieldRevisions:overlay[old.id]});
 return operations;
}
export function acknowledge(base:CommittedBoard,operations:BoardOperation[],overlay:Overlay,revision:number){
 const next=structuredClone(base),fields=structuredClone(overlay);
 for(const op of operations){
  const id=op.type==='create-card'?op.card.id:op.id;
  if(op.type==='create-card'){next.canvas.nodes.push({...op.card,type:op.card.type??'text'});fields[id]=Object.fromEntries(allFields.map(k=>[k,revision]));}
  else if(op.type==='delete-card'){next.canvas.nodes=next.canvas.nodes.filter(n=>n.id!==id);delete fields[id];}
  else {const card=next.canvas.nodes.find(n=>n.id===id)!;for(const k of editableFields)if(op[k]!==undefined){Object.assign(card,{[k]:op[k]});fields[id]={...fields[id],[k]:revision};}}
 }
 // The displayed snapshot revision is intentionally unchanged by a local receipt.
 return {base:next,overlay:fields};
}
export function keepAndMerge(base:CommittedBoard,cards:Card[],overlay:Overlay,remote:CommittedBoard){
 const operations=edits(base,cards,overlay),next=structuredClone(remote),merged=structuredClone(remote.canvas.nodes),fields:Overlay={};
 for(const op of operations){
  const id=op.type==='create-card'?op.card.id:op.id,old=base.canvas.nodes.find(n=>n.id===id);
  if(op.type==='create-card'){next.canvas.nodes=next.canvas.nodes.filter(n=>n.id!==id);const i=merged.findIndex(n=>n.id===id);if(i!==-1)merged.splice(i,1);merged.push(op.card);continue;}
  const keys=op.type==='delete-card'?allFields:['id',...editableFields.filter(k=>op[k]!==undefined)];
  fields[id]=Object.fromEntries(keys.map(k=>[k,overlay[id]?.[k]??base.revision]));
  let before=next.canvas.nodes.find(n=>n.id===id);if(!before){before={...old!};next.canvas.nodes.push(before);}
  for(const k of keys)Object.assign(before,{[k]:old?.[k as keyof Card]});
  const i=merged.findIndex(n=>n.id===id);
  if(op.type==='delete-card'){if(i!==-1)merged.splice(i,1);}
  else {const card=i===-1?{...old!}:merged[i];for(const k of editableFields)if(op[k]!==undefined)Object.assign(card,{[k]:op[k]});if(i===-1)merged.push(card);}
 }
 return {base:next,cards:merged,overlay:fields};
}
