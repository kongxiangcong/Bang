import {convertToExcalidrawElements} from '@excalidraw/excalidraw';
import type {Canvas,Edge} from '../../../runtime/canvas/contract';
export function relationElements(board:Canvas){return board.edges.flatMap(e=>{
 const a=board.nodes.find(n=>n.id===e.fromNode),b=board.nodes.find(n=>n.id===e.toNode);if(!a||!b)return [];
 const x=a.x+a.width+8,y=a.y+a.height/2,dx=b.x-8-x,dy=b.y+b.height/2-y;
 const result=convertToExcalidrawElements([{type:'arrow',id:e.id,x,y,width:Math.abs(dx),height:Math.abs(dy),points:[[0,0],[dx,dy]],roughness:0,startArrowhead:e.fromEnd==='arrow'?'arrow':null,endArrowhead:e.toEnd==='none'?null:'arrow',...(e.label?{label:{text:e.label,fontSize:14,fontFamily:2}}:{})}],{regenerateIds:false});
 return result.map(n=>n.id===e.id?{...n,startBinding:{elementId:e.fromNode,focus:0,gap:8},endBinding:{elementId:e.toNode,focus:0,gap:8}}:n);
});}
export function relationsFromScene(elements:readonly any[],board:Canvas):Edge[]{
 const ids=new Set(board.nodes.map(n=>n.id));
 return elements.filter(e=>!e.isDeleted&&e.type==='arrow'&&ids.has(e.startBinding?.elementId)&&ids.has(e.endBinding?.elementId)).map(e=>{
  const old=board.edges.find(n=>n.id===e.id),label=elements.find(t=>!t.isDeleted&&t.type==='text'&&t.containerId===e.id);
  return {...old,id:e.id,fromNode:e.startBinding.elementId,toNode:e.endBinding.elementId,label:label?.originalText??label?.text??'',fromEnd:e.startArrowhead?'arrow':'none',toEnd:e.endArrowhead?'arrow':'none'};
 });
}
