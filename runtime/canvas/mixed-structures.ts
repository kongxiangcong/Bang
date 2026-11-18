import type {Card} from './contract';
import type {Edge} from './relations';
export type StructureDecision={scope:string[];kind:string;reason:string;rulesRevision:number};
// A typed connected component is one region. General cross links never join
// regions. Conflicting families are deliberately left free, without new edges.
export function selectMixedStructures(cards:Partial<Card>[],edges:Edge[],previous:Card[]=[]){
 const fresh=cards.filter(c=>!previous.some(p=>p.id===c.id)&&!c.structure&&c.type!=='group'),available=new Set(fresh.map(c=>c.id));
 const family=(kind:string|undefined)=>kind==='classification'?'classification':['support','refute','qualify'].includes(kind??'')?'argument':['precedence','branch','dependency'].includes(kind??'')?'flow':null;
 const typed=edges.filter(e=>available.has(e.fromNode)&&available.has(e.toNode)&&family(e.kind)),seen=new Set<string>(),assigned=new Map<string,Card['structure']>(),decisions:StructureDecision[]=[];
 for(const card of fresh){if(!card.id||seen.has(card.id))continue;const scope=[card.id];seen.add(card.id);
  for(let i=0;i<scope.length;i++)for(const e of typed)if(e.fromNode===scope[i]||e.toNode===scope[i])for(const id of [e.fromNode,e.toNode])if(!seen.has(id)){seen.add(id);scope.push(id);}
  scope.sort((a,b)=>fresh.findIndex(c=>c.id===a)-fresh.findIndex(c=>c.id===b));
  const local=typed.filter(e=>scope.includes(e.fromNode)&&scope.includes(e.toNode)),families=[...new Set(local.map(e=>family(e.kind)))];
  const familyKind=families.length===1?families[0]:null;
  // Reachability identifies the unique source component (classification/flow)
  // or sink component (argument). A cyclic component has multiple equivalent
  // representatives: committed card order chooses one, never relation order.
  const adjacent=new Map(scope.map(id=>[id,new Set<string>()]));for(const e of local)adjacent.get(familyKind==='argument'?e.toNode:e.fromNode)!.add(familyKind==='argument'?e.fromNode:e.toNode);
  const roots=familyKind?scope.filter(id=>{const reachable=new Set([id]),queue=[id];for(let i=0;i<queue.length;i++)for(const next of adjacent.get(queue[i])!)if(!reachable.has(next)){reachable.add(next);queue.push(next);}return reachable.size===scope.length;}):[];
  const kind=roots.length?familyKind:null,rootId=roots[0];
  if(kind)for(const id of scope)assigned.set(id,{version:1,kind,rootId});
  decisions.push({scope,kind:kind??'free',reason:kind?`Explicit ${kind} relations define this local region; ${roots.length>1?'cyclic root component uses stable card order':'unique directed root'}; cross links and original wording retained.`:familyKind?'No common directed root; retain free grouping.':'No unique explicit relation family; retain free grouping.',rulesRevision:5});
 }
 const explicit=new Map<string,Partial<Card>[]>();for(const c of cards)if(c.structure&&!previous.some(p=>p.id===c.id)){const key=c.structure.kind+'\0'+c.structure.rootId;explicit.set(key,[...(explicit.get(key)??[]),c]);}
 for(const members of explicit.values())decisions.push({scope:members.map(c=>c.id!),kind:members[0].structure!.kind,reason:'Explicit new-card structure intent; original conditions and cross-region relations retained. This is presentation, not verification.',rulesRevision:5});
 return {cards:cards.map(c=>assigned.has(c.id!)?{...c,structure:assigned.get(c.id!)}:c),decisions};
}
