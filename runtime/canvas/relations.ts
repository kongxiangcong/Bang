export type Edge = {id:string;fromNode:string;toNode:string;label?:string;fromEnd?:'none'|'arrow';toEnd?:'none'|'arrow';fromSide?:'top'|'right'|'bottom'|'left';toSide?:'top'|'right'|'bottom'|'left'};
export const relationFields=['fromNode','toNode','label','fromEnd','toEnd','fromSide','toSide'] as const;
export type RelationOperation={type:'create-relation';edge:Edge}|{type:'edit-relation';id:string}&Partial<Omit<Edge,'id'>>|{type:'delete-relation';id:string};
export function parseEdge(value:unknown):Edge {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected relation');
 const e=value as Edge;
 for(const k of ['id','fromNode','toNode'] as const)if(typeof e[k]!=='string'||!e[k])throw Error('Invalid relation identity');
 validateRelationFields(e);
 return Object.fromEntries(['id',...relationFields].filter(k=>e[k as keyof Edge]!==undefined).map(k=>[k,e[k as keyof Edge]])) as Edge;
}
export function validateRelationFields(e:Partial<Edge>){
 for(const k of ['fromNode','toNode'] as const)if(e[k]!==undefined&&(typeof e[k]!=='string'||!e[k]))throw Error('Invalid relation endpoint');
 if(e.label!==undefined&&typeof e.label!=='string')throw Error('Invalid relation label');
 for(const k of ['fromEnd','toEnd'] as const)if(e[k]!==undefined&&!['none','arrow'].includes(e[k]!))throw Error('Invalid relation direction');
 for(const k of ['fromSide','toSide'] as const)if(e[k]!==undefined&&!['top','right','bottom','left'].includes(e[k]!))throw Error('Invalid relation side');
}
// Labels are user data. Unknown terms (including apparent support) remain unclassified.
export function semanticRelations(edges:Edge[]){return edges.map(e=>({id:e.id,fromNode:e.fromNode,toNode:e.toNode,label:e.label??'',classification:e.label?'unclassified':'related',direction:e.fromEnd==='arrow'?(e.toEnd!=='none'?'bidirectional':'reverse'):(e.toEnd==='none'?'undirected':'forward')}));}
