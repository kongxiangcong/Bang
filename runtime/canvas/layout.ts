import type {Card} from './contract';
export type Bounds={x:number;y:number;width:number;height:number};
export type LayoutWarning={code:'NO_LOCAL_SPACE'|'STRUCTURE_ROOT_MISSING';id:string;message:string};
// Text is measured headlessly with a fixed conservative character budget. Raw text
// remains intact; height is bounded for usable cards, with detail reading available.
export function estimateSize(text:string){return {width:320,height:Math.min(600,Math.max(120,48+text.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil([...line].length/32)),0)*24))};}
const intersects=(a:Bounds,b:Bounds)=>a.x<b.x+b.width+24&&a.x+a.width+24>b.x&&a.y<b.y+b.height+24&&a.y+a.height+24>b.y;
export function layoutCards(cards:Partial<Card>[],previous:Card[]=[],relayoutIds:string[]=[],bounds:Bounds={x:0,y:0,width:1920,height:1080}){
 if(![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isSafeInteger)||bounds.width<=0||bounds.height<=0)throw Error('Invalid placement bounds');
 if(!Array.isArray(relayoutIds)||relayoutIds.some(id=>typeof id!=='string'||!cards.some(c=>c.id===id)))throw Error('Invalid relayout selection');
 if(new Set(cards.map(c=>c.id)).size!==cards.length)throw Error('Duplicate identity');
 const selected=new Set(relayoutIds),warnings:LayoutWarning[]=[],pending=new Set<string>();
 const ordered=[...previous.map(old=>({...old,...cards.find(c=>c.id===old.id)})),...cards.filter(c=>!previous.some(old=>old.id===c.id))];
 const nodes=ordered.map(c=>{
  const old=previous.find(n=>n.id===c.id),node={...estimateSize(c.text??''),...c} as Card;
  if(old)for(const key of ['x','y','width','height','regionId','fixed','zIndex'] as const)Object.assign(node,{[key]:old[key]});
  if((selected.has(node.id)&&!node.fixed)||node.x===undefined||node.y===undefined)pending.add(node.id);
  return node;
 });
 const occupied=nodes.filter(n=>!pending.has(n.id));
 for(const node of nodes){if(!pending.has(node.id))continue;
  let placed=false;
  const xs=[bounds.x,...occupied.map(n=>n.x+n.width+24)].sort((a,b)=>a-b);
  const ys=[bounds.y,...occupied.map(n=>n.y+n.height+24)].sort((a,b)=>a-b);
  for(const y of ys){for(const x of xs){const candidate={...node,x,y};if(x>=bounds.x&&y>=bounds.y&&x+node.width<=bounds.x+bounds.width&&y+node.height<=bounds.y+bounds.height&&!occupied.some(n=>intersects(candidate,n))){node.x=x;node.y=y;placed=true;break;}}if(placed)break;}
  if(!placed){node.x=Math.max(bounds.x+bounds.width+24,...occupied.map(n=>n.x+n.width+24));node.y=bounds.y;warnings.push({code:'NO_LOCAL_SPACE',id:node.id,message:'局部区域无空间；新增内容置于区域外。可扩大区域或显式重新布局选区。'});}
  occupied.push(node);
 }
 return {nodes,warnings};
}
