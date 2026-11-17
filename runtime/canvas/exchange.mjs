import {parseCard,validateCanvas} from './contract.ts';
import {parseEdge} from './relations.ts';
const nodeFields=['id','type','x','y','width','height','color'];
export function standardCanvas(canvas){
 validateCanvas(canvas);
 return {nodes:canvas.nodes.map(n=>{const type=n.type??'text';const fields=[...nodeFields,...(type==='text'?['text']:type==='file'?['file','subpath']:type==='link'?['url']:['label','background','backgroundStyle'])];return Object.fromEntries(fields.filter(k=>k==='type'||n[k]!==undefined).map(k=>[k,k==='type'?type:n[k]]));}),edges:canvas.edges.map(parseEdge)};
}
export function parseImport(value){
 validateCanvas(value);
 return {nodes:value.nodes.map(parseCard),edges:value.edges.map(parseEdge)};
}
export function importChanges(before,after){
 const old=[...standardCanvas(before).nodes,...before.edges],next=[...standardCanvas(after).nodes,...after.edges];
 return {added:next.filter(n=>!old.some(o=>o.id===n.id)).map(n=>n.id),removed:old.filter(n=>!next.some(o=>o.id===n.id)).map(n=>n.id),changed:next.filter(n=>old.some(o=>o.id===n.id&&JSON.stringify(o)!==JSON.stringify(n))).map(n=>n.id),nodeOrder:after.nodes.map(n=>n.id),edgeOrder:after.edges.map(n=>n.id)};
}
export function exchangeDegradation(state){
 const result=(state.editorExtras??[]).map(e=>({id:e.id,reason:'Editor-only annotation, precise route, rotation and appearance are omitted from standard Canvas; use full backup to retain them.'}));
 for(const node of state.canvas.nodes){const fields=['regionId','fixed','zIndex','derivedFrom',...(node.type&&node.type!=='text'&&node.text?['text']:[])].filter(key=>node[key]!==undefined);if(fields.length)result.push({id:node.id,reason:'Nonstandard node information omitted: '+fields.join(', ')});}
 return result;
}
