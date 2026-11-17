import {editableFields,type BoardOperation,type Canvas,type EditorExtra,type CanvasImportOperation} from './contract.ts';
import {relationFields} from './relations.ts';

export const operationIdentity=(op:BoardOperation):string=>op.type==='create-card'?op.card.id:op.type==='create-relation'?op.edge.id:op.type==='create-extra'?op.extra.id:op.id;
// Relationships settle before endpoint deletion; constraints apply to the final graph.
export function orderOperations(operations:BoardOperation[]):BoardOperation[]{
 const rank=(op:BoardOperation)=>op.type==='create-card'?0:op.type==='delete-card'?2:1;
 return [...operations].sort((a,b)=>rank(a)-rank(b));
}
// Pure application: no input mutation, validation, I/O or collaboration bookkeeping.
// Draft merging may already have lost a deleted object to a remote cascade.
export function applyOperation<T extends {canvas:Canvas;editorExtras?:EditorExtra[]}>(input:T,op:BoardOperation|CanvasImportOperation):T{
 const board=structuredClone(input);
 if(op.type==='replace-canvas'){board.canvas=structuredClone(op.canvas);return board;}
 const id=operationIdentity(op),extra=op.type.endsWith('extra'),relation=op.type.endsWith('relation');
 const objects:any[]=extra?(board.editorExtras??=[]):relation?board.canvas.edges:board.canvas.nodes;
 const index=objects.findIndex(object=>object.id===id);
 if(op.type.startsWith('create-'))objects.push(structuredClone(op.type==='create-card'?{...op.card,type:op.card.type??'text'}:op.type==='create-relation'?op.edge:(op as Extract<BoardOperation,{type:'create-extra'}>).extra));
 else if(op.type.startsWith('delete-')){
  if(index!==-1)objects.splice(index,1);
  if(op.type==='delete-card')board.canvas.edges=board.canvas.edges.filter(edge=>edge.fromNode!==id&&edge.toNode!==id);
 }else{
  if(index===-1)throw Error('Object deleted');
  for(const field of extra?['element']:relation?relationFields:editableFields)if((op as any)[field]!==undefined)objects[index][field]=structuredClone((op as any)[field]);
 }
 if(!extra&&!relation&&'zIndex' in op&&op.zIndex!==undefined){
  const ranks=new Map(board.canvas.nodes.map((node,i)=>[node.id,node.zIndex??i]));
  board.canvas.nodes.sort((a,b)=>ranks.get(a.id)!-ranks.get(b.id)!);
 }
 return board;
}
