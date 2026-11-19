export type Edge = {kind?:'classification'|'general'|'support'|'refute'|'qualify'|'precedence'|'branch'|'dependency';id:string;fromNode:string;toNode:string;label?:string;color?:string;fromEnd?:'none'|'arrow';toEnd?:'none'|'arrow';fromSide?:'top'|'right'|'bottom'|'left';toSide?:'top'|'right'|'bottom'|'left'};
export const relationFields=['kind','fromNode','toNode','label','color','fromEnd','toEnd','fromSide','toSide'] as const;
export type RelationOperation={type:'create-relation';edge:Edge}|{type:'edit-relation';id:string}&Partial<Omit<Edge,'id'>>|{type:'delete-relation';id:string};
export function parseEdge(value:unknown):Edge {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected relation');
 const e=value as Edge;
 for(const k of ['id','fromNode','toNode'] as const)if(typeof e[k]!=='string'||!e[k])throw Error('Invalid relation identity');
 validateRelationFields(e);
 return Object.fromEntries(['id',...relationFields].filter(k=>e[k as keyof Edge]!==undefined).map(k=>[k,e[k as keyof Edge]])) as Edge;
}
export function validateRelationFields(e:Partial<Edge>){
 if(e.kind!==undefined&&!['classification','general','support','refute','qualify','precedence','branch','dependency'].includes(e.kind))throw Error('Invalid relation kind');
 for(const k of ['fromNode','toNode'] as const)if(e[k]!==undefined&&(typeof e[k]!=='string'||!e[k]))throw Error('Invalid relation endpoint');
 if(e.color!==undefined&&(typeof e.color!=='string'||!(/^(#[0-9a-fA-F]{6}|[1-6])$/).test(e.color)))throw Error('Invalid Canvas color');
 if(e.label!==undefined&&typeof e.label!=='string')throw Error('Invalid relation label');
 for(const k of ['fromEnd','toEnd'] as const)if(e[k]!==undefined&&!['none','arrow'].includes(e[k]!))throw Error('Invalid relation direction');
 for(const k of ['fromSide','toSide'] as const)if(e[k]!==undefined&&!['top','right','bottom','left'].includes(e[k]!))throw Error('Invalid relation side');
}
// Labels are user data. Unknown terms (including apparent support) remain unclassified.
export function semanticRelations(edges:Edge[],nodes:{id:string;type?:string}[]){
 const knowledgeIds=new Set(nodes.filter(node=>node.type!=='group').map(node=>node.id));
 return edges.filter(e=>knowledgeIds.has(e.fromNode)&&knowledgeIds.has(e.toNode)).map(e=>({id:e.id,fromNode:e.fromNode,toNode:e.toNode,label:e.label??'',classification:e.kind&&e.kind!=='general'?e.kind:e.label?'unclassified':'related',direction:e.fromEnd==='arrow'?(e.toEnd!=='none'?'bidirectional':'reverse'):(e.toEnd==='none'?'undirected':'forward')}));}
