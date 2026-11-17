import type {Card} from './contract';
import type {Edge} from './relations';
import type {Bounds,LayoutWarning} from './layout';
export type StructureIntent={version:1;kind:'classification'|'radial';rootId:string};
export function parseStructure(value:unknown):StructureIntent|null{
 if(value===null)return null;
 const v=value as StructureIntent;
 if(!v||v.version!==1||!['classification','radial'].includes(v.kind)||typeof v.rootId!=='string'||!v.rootId||Object.keys(v).some(k=>!['version','kind','rootId'].includes(k)))throw Error('Invalid structure intent');
 return {version:1,kind:v.kind,rootId:v.rootId};
}
const overlaps=(a:Bounds,b:Bounds)=>a.x<b.x+b.width+24&&a.x+a.width+24>b.x&&a.y<b.y+b.height+24&&a.y+a.height+24>b.y;
// Version 1: stable input order chooses a spanning forest. Only explicit classification
// edges enter that forest; extra parents and cycles remain unchanged Canvas edges.
export function layoutStructures(result:{nodes:Card[];warnings:LayoutWarning[]},input:Partial<Card>[],edges:Edge[],previous:Card[],selected:string[],bounds:Bounds={x:0,y:0,width:1920,height:1080}){
 const nodes=result.nodes,groups=new Map<string,Card[]>();
 for(const n of nodes){const intent=parseStructure(n.structure??null);if(!intent)continue;if(n.type==='group')throw Error('Visual regions cannot define knowledge structure');const key=intent.rootId+'\0'+intent.kind;groups.set(key,[...(groups.get(key)??[]),n]);}
 for(const members of groups.values()){
  const intent=members[0].structure!,root=members.find(n=>n.id===intent.rootId);if(!root){if(members.some(n=>selected.includes(n.id)||JSON.stringify(parseStructure(previous.find(p=>p.id===n.id)?.structure??null))!==JSON.stringify(parseStructure(n.structure))))throw Error('Structure root must be a member knowledge card');result.warnings.push({code:'STRUCTURE_ROOT_MISSING',id:intent.rootId,message:'结构中心已删除或改变；保留剩余卡片位置，请重新选择结构中心。'});continue;}
  const movable=new Set(members.filter(n=>!n.fixed&&(selected.includes(n.id)||(!previous.some(p=>p.id===n.id)&&input.some(p=>p.id===n.id&&(p.x===undefined||p.y===undefined))))).map(n=>n.id));
  if(!movable.size)continue;
  result.warnings=result.warnings.filter(w=>!movable.has(w.id));
  const depth=new Map<string,number>([[root.id,0]]),parents=new Map<string,string>(),queue=[root];
  for(let i=0;i<queue.length;i++){const parent=queue[i];for(const edge of edges.filter(e=>e.kind==='classification'&&e.fromNode===parent.id)){const child=members.find(n=>n.id===edge.toNode);if(child&&!depth.has(child.id)){depth.set(child.id,depth.get(parent.id)!+1);parents.set(child.id,parent.id);queue.push(child);}}}
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
    }else{x=bounds.x+level*step;y=bounds.y+(index+attempt)*(Math.max(...siblings.map(n=>n.height))+48);}
    const proposed={...node,x:Math.round(x),y:Math.round(y)};
    if(proposed.x>=bounds.x&&proposed.y>=bounds.y&&proposed.x+node.width<=bounds.x+bounds.width&&proposed.y+node.height<=bounds.y+bounds.height&&!occupied.some(n=>overlaps(proposed,n))){candidate=proposed;break;}
   }
   if(candidate){node.x=candidate.x;node.y=candidate.y;}
   else{const old=previous.find(n=>n.id===node.id);node.x=old?.x??Math.max(bounds.x+bounds.width+24,...occupied.map(n=>n.x+n.width+24));node.y=old?.y??bounds.y;result.warnings.push({code:'NO_LOCAL_SPACE',id:node.id,message:'结构布局空间不足；保留已有位置或将新增卡片置于区域外。请扩大区域或减少选区。'});}
   occupied.push(node);
  }
 }
}

