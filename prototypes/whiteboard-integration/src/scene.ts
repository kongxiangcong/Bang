import {route} from './routing';
import ELK from 'elkjs/lib/elk-api.js';
import {convertToExcalidrawElements} from '@excalidraw/excalidraw';
import {hierarchy, tree} from 'd3-hierarchy';
import type {ExcalidrawElement} from '@excalidraw/excalidraw/element/types';
export type Source = {messageId:string;startLine:number;endLine:number};
export type Thought = {id:string;groupId:string;text:string;explanation:string;sources:Source[];status:'reported'|'hypothesis'|'open'|'inferred'|'supported'|'rejected'|'disputed'};
export type Group = {id:string;title:string;goal:string;relation:'loose'|'hierarchy'|'radial'|'sequence';explanation:string};
export type Relation = {id:string;from:string;to:string;kind:'contains'|'sequence'|'association'|'supports'|'revises';label?:string};
export type Change = {id:string;throughRound:number;goal:string;changes:{upsertGroups?:Group[];upsertNodes?:Thought[];upsertRelations?:Relation[];removeNodeIds?:string[];removeRelationIds?:string[]}};
export type Meta = {bangNode?:Thought;bangGroup?:Group;bangRelation?:Relation;generatedText?:string;generatedPosition?:{x:number;y:number};pendingNode?:Thought;pendingRemoval?:boolean;userEdited?:boolean;eventId?:string;manualRoute?:boolean;routeVersion?:number};
export const metadata=(e:ExcalidrawElement):Meta=>(e.customData??{}) as Meta;
const style={roughness:0,fontFamily:2,fontSize:18,strokeColor:'#364c43',strokeWidth:1};
const colors={loose:'#fff0ba',hierarchy:'#e7edfa',radial:'#e0f1e9',sequence:'#eee5f9'};
const bump=(e:ExcalidrawElement,patch:Record<string,unknown>)=>({...e,...patch,version:e.version+1,versionNonce:Math.floor(Math.random()*2e9),updated:Date.now()}) as ExcalidrawElement;
function renderNode(node:Thought,x:number,y:number,color:string,eventId:string){
 return convertToExcalidrawElements([{id:node.id,type:'rectangle',x,y,width:260,height:100,backgroundColor:color,fillStyle:'solid',roundness:{type:3},...style,customData:{bangNode:node,generatedText:node.text,generatedPosition:{x,y},eventId},label:{text:node.text,...style}}],{regenerateIds:false});
}
function replaceNode(elements:readonly ExcalidrawElement[],node:Thought,eventId:string,force=false){
 const owner=elements.find(e=>e.id===node.id);if(!owner)return [...elements];
 const meta=metadata(owner),label=elements.find(e=>e.type==='text'&&e.containerId===node.id);
 const edited=meta.userEdited||(label?.type==='text'&&label.originalText!==meta.generatedText);
 if(edited&&!force)return elements.map(e=>e.id===node.id?bump(e,{customData:{...meta,pendingNode:node,eventId}}):e);
 const generated=renderNode(node,owner.x,owner.y,owner.backgroundColor,eventId);
 const generatedText=generated.find(e=>e.type==='text');
 return elements.map(e=>{
  if(e.id===node.id)return bump(e,{customData:{...meta,bangNode:node,generatedText:node.text,pendingNode:undefined,userEdited:false,eventId}});
  if(e===label&&generatedText)return bump(e,{...generatedText,id:e.id,containerId:node.id});
  return e;
 });
}
async function positions(group:Group,nodes:Thought[],edges:Relation[]){
 const result=new Map<string,{x:number;y:number}>();
 if(group.relation==='sequence'){
  const elk=new ELK({workerUrl:'/elk-worker.min.js'});
  try{
   const ids=new Set(nodes.map(n=>n.id));
   const graph=await elk.layout({id:group.id,layoutOptions:{'elk.algorithm':'layered','elk.direction':'DOWN','elk.layered.spacing.nodeNodeBetweenLayers':'65','elk.spacing.nodeNode':'50'},children:nodes.map(n=>({id:n.id,width:260,height:100})),edges:edges.filter(e=>ids.has(e.from)&&ids.has(e.to)).map(e=>({id:e.id,sources:[e.from],targets:[e.to]}))});
   for(const n of graph.children??[])result.set(n.id,{x:n.x??0,y:n.y??0});
  }finally{elk.terminateWorker()}
 }else if(group.relation==='hierarchy'||group.relation==='radial'){
  const ids=new Set(nodes.map(n=>n.id)),parent=new Map<string,string>();
  for(const edge of edges)if(ids.has(edge.from)&&ids.has(edge.to)&&!parent.has(edge.to))parent.set(edge.to,edge.from);
  const visited=new Set<string>();
  const branch=(id:string):any=>{visited.add(id);return {id,children:nodes.filter(n=>parent.get(n.id)===id&&!visited.has(n.id)).map(n=>branch(n.id))}};
  const data={id:'$root',children:nodes.filter(n=>!parent.has(n.id)).map(n=>branch(n.id))};
  for(const n of nodes)if(!visited.has(n.id))data.children.push(branch(n.id));
  const layout=tree<any>().nodeSize([150,330])(hierarchy(data));
  const min=Math.min(0,...layout.descendants().filter(n=>n.depth>0).map(n=>n.x));
  layout.descendants().filter(n=>n.depth>0).forEach(n=>result.set(n.data.id,{x:(n.depth-1)*330,y:n.x-min}));
 }else nodes.forEach((n,i)=>result.set(n.id,{x:(i%3)*300,y:Math.floor(i/3)*145}));
 return result;
}
function edgeElement(relation:Relation,elements:readonly ExcalidrawElement[],eventId:string){
 const a=elements.find(e=>e.id===relation.from&&!e.isDeleted),b=elements.find(e=>e.id===relation.to&&!e.isDeleted);if(!a||!b)return null;
 const absolute=route(a,b,elements.filter(e=>!e.isDeleted&&metadata(e).bangNode));
 const [x,y]=absolute[0],points=absolute.map(p=>[p[0]-x,p[1]-y] as [number,number]);
 const width=Math.max(...absolute.map(p=>p[0]))-Math.min(...absolute.map(p=>p[0])),height=Math.max(...absolute.map(p=>p[1]))-Math.min(...absolute.map(p=>p[1]));
 const result=convertToExcalidrawElements([{id:relation.id,type:'arrow',x,y,width,height,points,strokeColor:relation.kind==='revises'?'#bd795f':'#8a9d93',strokeWidth:1.5,roughness:0,endArrowhead:relation.kind==='contains'||relation.kind==='association'?null:'arrow',customData:{bangRelation:relation,eventId,routeVersion:1},...(relation.label?{label:{text:relation.label,fontSize:14,fontFamily:2}}:{})}],{regenerateIds:false});
 result[0]={...result[0],x,y,width,height,points,startBinding:{elementId:a.id,focus:0,gap:8},endBinding:{elementId:b.id,focus:0,gap:8}} as typeof result[0];
 return result;
}
export function repairConnections(elements:readonly ExcalidrawElement[],force=false){
 let output=[...elements];
 for(const arrow of elements){const meta=metadata(arrow),relation=meta.bangRelation;if(arrow.isDeleted||arrow.type!=='arrow'||!relation||meta.manualRoute)continue;
  if(!force&&meta.routeVersion===1)continue;
  const generated=edgeElement(relation,output,meta.eventId??'repair');if(!generated)continue;
  const next=generated[0],oldLabel=output.find(e=>e.type==='text'&&e.containerId===arrow.id),newLabel=generated.find(e=>e.type==='text');
  const geometry=(e:any)=>JSON.stringify([e.x,e.y,e.width,e.height,e.points,e.startBinding,e.endBinding]);
  if(geometry(arrow)!==geometry(next)||meta.routeVersion!==1){output=output.map(e=>e.id===arrow.id?bump(e,{x:next.x,y:next.y,width:next.width,height:next.height,points:(next as any).points,startBinding:(next as any).startBinding,endBinding:(next as any).endBinding,customData:{...meta,routeVersion:1}}):e===oldLabel&&newLabel?bump(e,{x:newLabel.x,y:newLabel.y}):e);}
 }
 return output;
}
export const nodeGeometry=(elements:readonly ExcalidrawElement[])=>JSON.stringify(elements.filter(e=>!e.isDeleted&&metadata(e).bangNode).map(e=>[e.id,e.x,e.y,e.width,e.height,e.angle]));
export function preserveManualRoutes(elements:readonly ExcalidrawElement[],selected:Record<string,boolean>){return elements.map(e=>e.type==='arrow'&&selected[e.id]&&metadata(e).bangRelation&&!metadata(e).manualRoute?bump(e,{customData:{...metadata(e),manualRoute:true}}):e)}
export async function applyChange(current:readonly ExcalidrawElement[],event:Change):Promise<ExcalidrawElement[]>{
 let output=[...current];
 const moved=new Set<string>();
 const groups=new Map(output.filter(e=>!e.isDeleted&&metadata(e).bangGroup).map(e=>[metadata(e).bangGroup!.id,metadata(e).bangGroup!]));
 const nodes=new Map(output.filter(e=>!e.isDeleted&&metadata(e).bangNode).map(e=>[e.id,metadata(e).bangNode!]));
 const relations=new Map(output.filter(e=>!e.isDeleted&&metadata(e).bangRelation).map(e=>[e.id,metadata(e).bangRelation!]));
 for(const group of event.changes.upsertGroups??[])groups.set(group.id,group);
 for(const node of event.changes.upsertNodes??[])nodes.set(node.id,node);
 for(const edge of event.changes.upsertRelations??[])relations.set(edge.id,edge);
 const removed=new Set(event.changes.removeNodeIds??[]);
 for(const id of [...removed]){const owner=output.find(e=>e.id===id&&!e.isDeleted);if(!owner)continue;const meta=metadata(owner),label=output.find(e=>e.type==='text'&&e.containerId===id);if(meta.userEdited||(label?.type==='text'&&label.originalText!==meta.generatedText)){removed.delete(id);output=output.map(e=>e.id===id?bump(e,{customData:{...meta,pendingRemoval:true,eventId:event.id}}):e)}}
 for(const id of removed)nodes.delete(id);
 for(const [id,e]of relations)if(removed.has(e.from)||removed.has(e.to)||(event.changes.removeRelationIds??[]).includes(id))relations.delete(id);
 const removedElements=new Set([...removed,...output.filter(e=>metadata(e).bangRelation&&!relations.has(e.id)).map(e=>e.id)]);
 output=output.map(e=>removedElements.has(e.id)||(e.type==='text'&&e.containerId&&removedElements.has(e.containerId))?bump(e,{isDeleted:true}):e);
 for(const group of groups.values()){
  let heading=output.find(e=>metadata(e).bangGroup?.id===group.id&&!e.isDeleted);
  if(!heading){
   const existing=output.filter(e=>!e.isDeleted),count=existing.filter(e=>metadata(e).bangGroup).length;
   const x=count%2===0?0:1200;
   const y=count%2===0?Math.max(-140,...existing.map(e=>e.y+e.height))+180:(existing.filter(e=>metadata(e).bangGroup).at(-1)?.y??40);
   const items=convertToExcalidrawElements([{id:'group-'+group.id,type:'text',x,y,text:group.title,fontSize:25,fontFamily:2,strokeColor:'#355848',customData:{bangGroup:group,eventId:event.id}}],{regenerateIds:false});
   heading=items[0];output.push(...items);
  }else if(event.changes.upsertGroups?.some(g=>g.id===group.id))output=output.map(e=>e.id===heading!.id?bump(e,{text:group.title,originalText:group.title,customData:{...metadata(e),bangGroup:group,eventId:event.id}}):e);
  const members=[...nodes.values()].filter(n=>n.groupId===group.id),additions=members.filter(n=>!output.some(e=>e.id===n.id));
  const previous=current.find(e=>metadata(e).bangGroup?.id===group.id);
  const changedForm=previous&&metadata(previous).bangGroup!.relation!==group.relation;
  if(!additions.length&&!changedForm)continue;
  const layout=await positions(group,members,[...relations.values()]);
  if(changedForm)for(const node of members){
   const owner=output.find(e=>e.id===node.id),pos=layout.get(node.id);if(!owner||!pos)continue;
   const generated=metadata(owner).generatedPosition;
   if(generated&&(Math.abs(owner.x-generated.x)>.1||Math.abs(owner.y-generated.y)>.1))continue;
   const x=heading.x+pos.x,y=heading.y+70+pos.y,dx=x-owner.x,dy=y-owner.y;
   moved.add(owner.id);
   output=output.map(e=>e.id===owner.id?bump(e,{x,y,backgroundColor:colors[group.relation],customData:{...metadata(e),generatedPosition:{x,y}}}):e.type==='text'&&e.containerId===owner.id?bump(e,{x:e.x+dx,y:e.y+dy}):e);
  }
  for(const node of additions){
   const pos=layout.get(node.id)??{x:0,y:0};const x=heading.x+pos.x;let y=heading.y+70+pos.y;
   while(output.some(e=>!e.isDeleted&&metadata(e).bangNode&&x<e.x+e.width+20&&x+280>e.x&&y<e.y+e.height+25&&y+125>e.y))y+=145;
   output.push(...renderNode(node,x,y,colors[group.relation],event.id));
  }
 }
 for(const node of event.changes.upsertNodes??[])if(current.some(e=>e.id===node.id))output=replaceNode(output,node,event.id);
 const changedRelations=new Set((event.changes.upsertRelations??[]).map(e=>e.id));
 for(const relation of relations.values())if(moved.has(relation.from)||moved.has(relation.to))changedRelations.add(relation.id);
 for(const id of changedRelations){
  const relation=relations.get(id);if(!relation)continue;
  const generated=edgeElement(relation,output,event.id);if(!generated)continue;
  const old=output.find(e=>e.id===relation.id);
  if(old&&metadata(old).manualRoute&&metadata(old).bangRelation?.from===relation.from&&metadata(old).bangRelation?.to===relation.to){output=output.map(e=>e.id===old.id?bump(e,{customData:{...metadata(e),bangRelation:relation}}):e);continue;}
  if(old){
   const oldLabel=output.find(e=>e.type==='text'&&e.containerId===old.id),newLabel=generated.find(e=>e.type==='text');
   if(oldLabel&&newLabel){generated[0]={...generated[0],boundElements:[{id:oldLabel.id,type:'text'}]};output=output.map(e=>e.id===oldLabel.id?bump(e,{...newLabel,id:oldLabel.id}):e)}
   else if(newLabel)output.push(newLabel);
   else if(oldLabel)output=output.map(e=>e.id===oldLabel.id?bump(e,{isDeleted:true}):e);
   output=output.map(e=>e.id===old.id?bump(e,{...generated[0],id:old.id}):e);
  }else output.push(...generated);
 }
 output=output.map(e=>{const bound=e.boundElements?.filter(b=>b.type!=='arrow'||(relations.has(b.id)&&((relations.get(b.id)!.from===e.id)||(relations.get(b.id)!.to===e.id))));return bound&&bound.length!==e.boundElements?.length?bump(e,{boundElements:bound}):e});
 for(const relation of relations.values()){
  const arrow=output.find(e=>e.id===relation.id);if(!arrow)continue;
  output=output.map(e=>{
   if(e.id===arrow.id&&e.type==='arrow'&&(!e.startBinding||!e.endBinding))return bump(e,{startBinding:{elementId:relation.from,focus:0,gap:8},endBinding:{elementId:relation.to,focus:0,gap:8}});
   if((e.id===relation.from||e.id===relation.to)&&!e.boundElements?.some(b=>b.id===relation.id))return bump(e,{boundElements:[...(e.boundElements??[]),{id:relation.id,type:'arrow'}]});
   return e;
  });
 }
 return repairConnections(output,true);
}
export function editThought(elements:readonly ExcalidrawElement[],id:string,text:string){
 const owner=elements.find(e=>e.id===id),node=owner&&metadata(owner).bangNode;if(!node)return [...elements];
 return replaceNode(elements,{...node,text},'manual',true).map(e=>e.id===id?bump(e,{customData:{...metadata(e),userEdited:true,pendingNode:metadata(owner).pendingNode}}):e);
}
export function acceptProposal(elements:readonly ExcalidrawElement[],id:string){const e=elements.find(e=>e.id===id);if(e&&metadata(e).pendingRemoval){const removed=new Set([id,...elements.filter(x=>metadata(x).bangRelation?.from===id||metadata(x).bangRelation?.to===id).map(x=>x.id)]);return elements.map(x=>removed.has(x.id)||(x.type==='text'&&x.containerId&&removed.has(x.containerId))?bump(x,{isDeleted:true}):x)}const proposal=e&&metadata(e).pendingNode;return proposal?replaceNode(elements,proposal,'accepted',true):[...elements];}
