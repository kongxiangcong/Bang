import type {Card} from './contract';
import type {Edge} from './relations';
import type {Bounds,LayoutWarning} from './layout';
type TreeIntent={version:1;kind:'classification'|'radial'|'argument'|'flow';rootId:string};
export type ComparisonIntent={version:1;kind:'comparison';rootId:string;dimensions:string[];option:string|null;dimension:string|null};
export type TimelineIntent={version:1;kind:'timeline';rootId:string;eventTime:string|null};
export type StructureIntent=TreeIntent|ComparisonIntent|TimelineIntent;
export function parseStructure(value:unknown):StructureIntent|null{
 if(value===null)return null;
 const v=value as StructureIntent;
 if(!v||v.version!==1||!['classification','radial','argument','flow','comparison','timeline'].includes(v.kind)||typeof v.rootId!=='string'||!v.rootId)throw Error('Invalid structure intent');
 if(v.kind==='timeline'){
  const t=v.eventTime;
  if(t!==null&&(typeof t!=='string'||!/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\d(?:\.\d{3})?Z)?$/.test(t)||!Number.isFinite(Date.parse(t))||new Date(t).toISOString().slice(0,10)!==t.slice(0,10))||Object.keys(v).some(k=>!['version','kind','rootId','eventTime'].includes(k)))throw Error('Invalid event time: explicit ISO date or UTC timestamp required; unknown is null');
  return {...v};
 }
 if(v.kind==='comparison'){
  const valid=(s:unknown)=>s===null||typeof s==='string'&&!!s.trim();
  if(!Array.isArray(v.dimensions)||v.dimensions.some(d=>typeof d!=='string'||!d.trim())||new Set(v.dimensions).size!==v.dimensions.length||!valid(v.option)||!valid(v.dimension)||v.dimension!==null&&!v.dimensions.includes(v.dimension)||Object.keys(v).some(k=>!['version','kind','rootId','dimensions','option','dimension'].includes(k)))throw Error('Invalid comparison dimensions');
  return {...v,dimensions:[...v.dimensions]};
 }
 if(Object.keys(v).some(k=>!['version','kind','rootId'].includes(k)))throw Error('Invalid structure intent');
 return {version:1,kind:v.kind,rootId:v.rootId};
}
const overlaps=(a:Bounds,b:Bounds)=>a.x<b.x+b.width+24&&a.x+a.width+24>b.x&&a.y<b.y+b.height+24&&a.y+a.height+24>b.y;
// Semantic agreement is independent of placement, fixed state and root presence.
export function validateStructureGroups(nodes:Card[]){
 const dimensions=new Map<string,string>();
 for(const node of nodes){const intent=parseStructure(node.structure??null);if(!intent)continue;
  if(node.type==='group')throw Error('Visual regions cannot define knowledge structure');
  if(intent.kind!=='comparison')continue;
  const value=JSON.stringify(intent.dimensions),previous=dimensions.get(intent.rootId);
  if(previous!==undefined&&previous!==value)throw Error('Comparison dimensions must agree');
  dimensions.set(intent.rootId,value);
 }
}
// Version 1: stable input order chooses a spanning forest. Only explicit classification
// edges enter classification/radial forests. Argument follows incoming reasons;
// flow follows outgoing process edges. BFS ranks project a general graph: extra
// parents, cross-region edges and feedback cycles remain unchanged Canvas edges.
export function layoutStructures(result:{nodes:Card[];warnings:LayoutWarning[]},input:Partial<Card>[],edges:Edge[],previous:Card[],selected:string[],bounds:Bounds={x:0,y:0,width:1920,height:1080}){
 validateStructureGroups(result.nodes);
 const nodes=result.nodes,groups=new Map<string,Card[]>();
 for(const n of nodes){const intent=parseStructure(n.structure??null);if(!intent)continue;if(n.type==='group')throw Error('Visual regions cannot define knowledge structure');const key=intent.rootId+'\0'+intent.kind;groups.set(key,[...(groups.get(key)??[]),n]);}
 for(const members of groups.values()){
  const intent=members[0].structure!,root=members.find(n=>n.id===intent.rootId);if(!root){if(members.some(n=>selected.includes(n.id)||JSON.stringify(parseStructure(previous.find(p=>p.id===n.id)?.structure??null))!==JSON.stringify(parseStructure(n.structure))))throw Error('Structure root must be a member knowledge card');result.warnings.push({code:'STRUCTURE_ROOT_MISSING',id:intent.rootId,message:'结构中心已删除或改变；保留剩余卡片位置，请重新选择结构中心。'});continue;}
  const movable=new Set(members.filter(n=>!n.fixed&&(selected.includes(n.id)||(!previous.some(p=>p.id===n.id)&&input.some(p=>p.id===n.id&&(p.x===undefined||p.y===undefined))))).map(n=>n.id));
  if(!movable.size)continue;
  result.warnings=result.warnings.filter(w=>!movable.has(w.id));
  if(intent.kind==='timeline'){
   const dated=members.filter(n=>(n.structure as TimelineIntent).eventTime!==null).sort((a,b)=>Date.parse((a.structure as TimelineIntent).eventTime!)-Date.parse((b.structure as TimelineIntent).eventTime!)),unknown=members.filter(n=>(n.structure as TimelineIntent).eventTime===null);
   const step=Math.max(...members.map(n=>n.width))+48,rowHeight=Math.max(...members.map(n=>n.height))+64,occupied=nodes.filter(n=>!movable.has(n.id));
   for(const node of [...dated,...unknown]){if(!movable.has(node.id))continue;const isUnknown=unknown.includes(node),x=bounds.x+(isUnknown?unknown:dated).indexOf(node)*step,y=bounds.y+(isUnknown?rowHeight:0),proposed={...node,x,y};
    if(x+node.width<=bounds.x+bounds.width&&y+node.height<=bounds.y+bounds.height&&!occupied.some(n=>overlaps(proposed,n))){node.x=x;node.y=y;}
    else{const old=previous.find(n=>n.id===node.id);node.x=old?.x??Math.max(bounds.x+bounds.width+24,...occupied.map(n=>n.x+n.width+24));node.y=old?.y??bounds.y;result.warnings.push({code:'NO_LOCAL_SPACE',id:node.id,message:'事件时间线空间不足；保留原位置或置于区域外。可显式重新布局；时间标签仍为事件时间。'});}
    occupied.push(node);
   }
   continue;
  }
  if(intent.kind==='comparison'){
   const options=[...new Set(members.map(n=>(n.structure as ComparisonIntent).option))],rowHeight=Math.max(...members.map(n=>n.height))+48,colWidth=Math.max(...members.map(n=>n.width))+48;
   const occupied=nodes.filter(n=>!movable.has(n.id));
   for(const node of members){if(!movable.has(node.id))continue;const s=node.structure as ComparisonIntent;
    const x=bounds.x+options.indexOf(s.option)*colWidth,y=bounds.y+(s.dimension===null?intent.dimensions.length:intent.dimensions.indexOf(s.dimension))*rowHeight;
    const proposed={...node,x,y};
    if(x+node.width<=bounds.x+bounds.width&&y+node.height<=bounds.y+bounds.height&&!occupied.some(n=>overlaps(proposed,n))){node.x=x;node.y=y;}
    else{const old=previous.find(n=>n.id===node.id);node.x=old?.x??Math.max(bounds.x+bounds.width+24,...occupied.map(n=>n.x+n.width+24));node.y=old?.y??bounds.y;result.warnings.push({code:'NO_LOCAL_SPACE',id:node.id,message:'对比单元已有内容或空间不足；保留原位置或置于区域外，未合并或补全事实。'});}
    occupied.push(node);
   }
   continue;
  }
  const depth=new Map<string,number>([[root.id,0]]),parents=new Map<string,string>(),queue=[root];
  for(let i=0;i<queue.length;i++){const parent=queue[i];for(const edge of edges.filter(e=>intent.kind==='argument'?['support','refute','qualify'].includes(e.kind??'')&&e.toNode===parent.id:(intent.kind==='flow'?['precedence','branch','dependency'].includes(e.kind??''):e.kind==='classification')&&e.fromNode===parent.id)){const child=members.find(n=>n.id===(intent.kind==='argument'?edge.fromNode:edge.toNode));if(child&&!depth.has(child.id)){depth.set(child.id,depth.get(parent.id)!+1);parents.set(child.id,parent.id);queue.push(child);}}}
  // Unconnected members are separate visual branches, never inferred semantic edges.
  for(const n of members)if(!depth.has(n.id)){depth.set(n.id,1);parents.set(n.id,root.id);}
  const sectors=new Map<string,{angle:number;width:number}>();
  function branch(parent:string,angle:number,width:number){const children=members.filter(n=>parents.get(n.id)===parent);children.forEach((n,i)=>{const span=width/children.length,center=parent===intent.rootId?2*Math.PI*i/children.length:angle-width/2+span*(i+0.5);sectors.set(n.id,{angle:center,width:span});branch(n.id,center,span);});}
  branch(root.id,0,2*Math.PI);
  const step=Math.max(...members.map(n=>Math.hypot(n.width,n.height)))+80;
  const center=movable.has(root.id)?{x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2}:{x:root.x+root.width/2,y:root.y+root.height/2};
  const occupied=nodes.filter(n=>!movable.has(n.id));
  for(const node of members){if(!movable.has(node.id))continue;
   const level=depth.get(node.id)!,siblings=members.filter(n=>depth.get(n.id)===level),index=siblings.indexOf(node);
   let candidate:Card|undefined;
   for(let attempt=0;attempt<64;attempt++){
    let x:number,y:number;
    if(intent.kind==='radial'){
     const sector=sectors.get(node.id)??{angle:0,width:0},angle=sector.angle+(attempt%2?1:-1)*Math.ceil(attempt/2)*sector.width/64;
     x=center.x+Math.cos(angle)*level*step-node.width/2;y=center.y+Math.sin(angle)*level*step-node.height/2;
    }else if(intent.kind==='flow'){x=bounds.x+(index+attempt)*(Math.max(...members.map(n=>n.width))+48);y=bounds.y+level*(Math.max(...members.map(n=>n.height))+80);
    }else{x=bounds.x+(intent.kind==='argument'?Math.max(...depth.values())-level:level)*step;y=bounds.y+(index+attempt)*(Math.max(...siblings.map(n=>n.height))+48);}
    const proposed={...node,x:Math.round(x),y:Math.round(y)};
    if(proposed.x>=bounds.x&&proposed.y>=bounds.y&&proposed.x+node.width<=bounds.x+bounds.width&&proposed.y+node.height<=bounds.y+bounds.height&&!occupied.some(n=>overlaps(proposed,n))){candidate=proposed;break;}
   }
   if(candidate){node.x=candidate.x;node.y=candidate.y;}
   else{const old=previous.find(n=>n.id===node.id);node.x=old?.x??Math.max(bounds.x+bounds.width+24,...occupied.map(n=>n.x+n.width+24));node.y=old?.y??bounds.y;result.warnings.push({code:'NO_LOCAL_SPACE',id:node.id,message:'结构布局空间不足；保留已有位置或将新增卡片置于区域外。请扩大区域或减少选区。'});}
   occupied.push(node);
  }
 }
}

