import {convertToExcalidrawElements,restoreElements} from '@excalidraw/excalidraw';
import type {Canvas,Card,EditorExtra} from '../../../runtime/canvas/contract';
import {cardLabel} from './ResourceDetails';
import {relationElements,relationsFromScene} from './canvas-relations';
export const clean=(e:any)=>{const {version,versionNonce,updated,index,...rest}=e;return structuredClone({...rest,version:1,versionNonce:0,updated:0});};
export function renderScene(board:Canvas,extras:EditorExtra[]){
 const stored=new Map(extras.map(e=>[e.id,e.element])), used=new Set<string>();
 const rendered:any[]=board.nodes.flatMap(n=>{
  const raw=stored.get(n.id),labelId=raw?.boundElements?.find((e:any)=>e.type==='text')?.id??n.id+':label';
  const generated=convertToExcalidrawElements([{type:raw?.type&&['rectangle','ellipse','diamond'].includes(raw.type)?raw.type:'rectangle',id:n.id,x:n.x,y:n.y,width:n.width,height:n.height,strokeColor:'#334155',backgroundColor:n.type==='group'?'transparent':'#f1f5f9',fillStyle:'solid',roughness:0,label:{text:cardLabel(n),fontSize:16,fontFamily:2}}] as any,{regenerateIds:false});
  return generated.map(e=>{const isShape=e.id===n.id,id=isShape?n.id:labelId,old=stored.get(id);used.add(id);return {...e,...old,id,type:e.type,...(isShape?{x:old&&Math.round(old.x)===n.x?old.x:n.x,y:old&&Math.round(old.y)===n.y?old.y:n.y,width:n.width,height:n.height,boundElements:[{id:labelId,type:'text'}]}:{containerId:n.id,text:(e as any).text,originalText:(e as any).originalText}),locked:!!n.fixed,groupIds:n.regionId?[n.regionId]:[],customData:{...old?.customData,businessId:n.id}};});
 });
 for(const e of relationElements(board)){const old=stored.get(e.id),line=e as any,same=old?.startBinding?.elementId===line.startBinding?.elementId&&old?.endBinding?.elementId===line.endBinding?.elementId;used.add(e.id);rendered.push({...e,...old,...(e.type==='arrow'?{startBinding:same?old?.startBinding:line.startBinding,endBinding:same?old?.endBinding:line.endBinding,...(!same?{x:e.x,y:e.y,points:line.points,width:e.width,height:e.height}:{}),startArrowhead:line.startArrowhead,endArrowhead:line.endArrowhead,boundElements:e.boundElements}:{text:line.text,originalText:line.originalText}),customData:line.customData} as any);}
 for(const extra of extras)if(!used.has(extra.id)&&!extra.element.customData?.businessId&&!extra.element.customData?.relationId)rendered.push(extra.element as any);
 return restoreElements(structuredClone(rendered.map(e=>({...e,x:e.x??0,y:e.y??0,width:e.width??1,height:e.height??1,angle:e.angle??0}))),null);
}
function nativeText(card:Card,shape:any,elements:readonly any[]){const label=elements.find(e=>e.type==='text'&&e.containerId===shape.id),text=label?.originalText??label?.text;if(typeof text!=='string'||text===cardLabel(card))return card.text;return text;}
export function captureScene(elements:readonly any[],board:Canvas){
 const live=elements.filter(e=>!e.isDeleted),cards=board.nodes.filter(n=>live.some(e=>e.id===n.id)).map(n=>{const e=live.find(e=>e.id===n.id);return {...n,...(n.type==='group'?{label:(live.find(t=>t.type==='text'&&t.containerId===e.id)?.originalText??cardLabel(n))===cardLabel(n)?n.label:live.find(t=>t.type==='text'&&t.containerId===e.id)?.originalText}:{text:nativeText(n,e,live)}),x:Math.round(e.x),y:Math.round(e.y),width:Math.max(1,Math.round(e.width)),height:Math.max(1,Math.round(e.height))};});
 const copies=new Map<string,string>();
 for(const e of live){const source=board.nodes.find(n=>n.id===e.customData?.businessId);if(source&&e.id!==source.id&&e.type!=='text'){cards.push({...source,text:nativeText(source,e,live),id:e.id,derivedFrom:source.id,x:Math.round(e.x),y:Math.round(e.y),width:Math.max(1,Math.round(e.width)),height:Math.max(1,Math.round(e.height))});copies.set(e.id,e.id);}}
 const normalized=live.map(e=>{const businessId=copies.get(e.id)??copies.get(e.containerId);return clean(businessId?{...e,customData:{...e.customData,businessId}}:e);});
 const edges=relationsFromScene(normalized,{nodes:cards,edges:board.edges});
 return {cards,edges,extras:normalized.map(element=>({id:element.id,element}))};
}
export function annotationCards(extras:EditorExtra[],cards:Card[]){return extras.filter(e=>!e.element.customData?.businessId&&!['line','arrow'].includes(e.element.type)&&!e.element.containerId&&!cards.some(c=>c.id===e.id));}
export function convertAnnotation(extra:EditorExtra,extras:EditorExtra[]):Card {
 const e=extra.element,label=extras.find(t=>t.element.containerId===e.id)?.element;
 return {id:e.id,text:label?.originalText??label?.text??e.originalText??e.text??'新知识卡片',x:Math.round(e.x),y:Math.round(e.y),width:Math.max(1,Math.round(e.width)),height:Math.max(1,Math.round(e.height)),type:'text'};
}

