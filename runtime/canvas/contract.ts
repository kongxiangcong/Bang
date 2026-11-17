import {layoutCards,type Bounds,type LayoutWarning} from './layout.ts';
// The schema is shared by Node and the browser; types are inferred from its parsers.
type Parser<T> = (value: unknown) => T;
const string: Parser<string> = v => { if(typeof v!=='string') throw Error('Expected string'); return v; };
const id: Parser<string> = v => { const s=string(v); if(!s.length) throw Error('Empty identity'); return s; };
const number: Parser<number> = v => { if(typeof v!=='number'||!Number.isSafeInteger(v)) throw Error('Expected safe integer coordinate'); return v; };
const size: Parser<number> = v => { const n=number(v); if(n<=0) throw Error('Expected positive size'); return n; };
export const cardSchema={id,text:string,x:number,y:number,width:size,height:size};
export type Card = {id:string;x:number;y:number;width:number;height:number;text:string;type?:'text'|'file'|'link';file?:string;url?:string;regionId?:string|null;fixed?:boolean;zIndex?:number};
export type Canvas = {nodes:Card[];edges:never[];layoutWarnings?:LayoutWarning[]};
export function safeResourceURL(value:unknown):string {
 const raw=string(value);let u:URL;try{u=new URL(raw);}catch{throw Error('Invalid resource URL');}
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password||/[\u0000-\u0020]/.test(raw))throw Error('Unsafe resource URL');
 const rejectCredential=(_:string,key:string)=>{if(/^(token|key|api[_-]?key|password|secret|access_token|id_token|authorization)$/i.test(key))throw Error('Credential-bearing resource URL');};
 u.searchParams.forEach(rejectCredential);new URLSearchParams(u.hash.slice(1)).forEach(rejectCredential);
 return raw;
}
export function safeResourcePath(value:unknown):string {
 const raw=string(value);
 if(!raw||raw.startsWith('/')||raw.includes('\\')||raw.includes(':')||/[\u0000-\u001f]/.test(raw)||raw.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.')||/[. ]$/.test(p)))throw Error('Unsafe resource path');
 return raw;
}
export function parseCard(value:unknown):Card {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected card');
 const v=value as Record<string,unknown>,type=v.type??'text';
 if(!['text','file','link'].includes(type as string))throw Error('Unknown card type');
 const geometry={id:id(v.id),x:number(v.x),y:number(v.y),width:size(v.width),height:size(v.height),...parseLayout(v)};
 if(type==='file')return {...geometry,type,text:typeof v.text==='string'?v.text:'',file:safeResourcePath(v.file)};
 if(type==='link')return {...geometry,type,text:typeof v.text==='string'?v.text:'',url:safeResourceURL(v.url)};
 return {...geometry,type:'text',text:string(v.text)};
}
export function validateCanvas(value:unknown):Canvas {
 if(!value||typeof value!=='object')throw Error('Expected Canvas');
 const v=value as Record<string,unknown>;
 if(!Array.isArray(v.nodes)||!Array.isArray(v.edges)||v.edges.length)throw Error('This runtime supports cards and no edges');
 const ids=new Set<string>();
 for(const node of v.nodes){const card=parseCard(node);if(ids.has(card.id))throw Error('Duplicate identity');ids.add(card.id);}
 return value as Canvas;
}
export function compileCanvas(input:unknown):Canvas {
 if(!input||typeof input!=='object'||!Array.isArray((input as {cards?:unknown}).cards))throw Error('Expected cards array');
 const v=input as {cards:Partial<Card>[];previous?:Canvas;relayoutIds?:string[];bounds?:Bounds};
 if(v.previous)validateCanvas(v.previous);
 const result=layoutCards(v.cards,v.previous?.nodes,v.relayoutIds,v.bounds);
 return validateCanvas({nodes:result.nodes.map(parseCard),edges:[],...(result.warnings.length?{layoutWarnings:result.warnings}:{})});
}

export const layoutFields=['x','y','width','height','regionId','fixed','zIndex'] as const;
function parseLayout(v:Record<string,unknown>){
 const out:{regionId?:string|null;fixed?:boolean;zIndex?:number}={};
 if(v.regionId!==undefined)out.regionId=v.regionId===null?null:id(v.regionId);
 if(v.fixed!==undefined){if(typeof v.fixed!=='boolean')throw Error('Expected fixed boolean');out.fixed=v.fixed;}
 if(v.zIndex!==undefined)out.zIndex=number(v.zIndex);return out;
}
export const editableFields=['text','x','y','width','height','regionId','fixed','zIndex','file','url'] as const;
export type FieldRevisions=Record<string,number>;
export type BoardOperation = ({type:'create-card';card:Card}|{type:'edit-card';id:string;text?:string;file?:string;url?:string;x?:number;y?:number;width?:number;height?:number;regionId?:string|null;fixed?:boolean;zIndex?:number}|{type:'delete-card';id:string}) & {fieldRevisions?:FieldRevisions};
export type BoardPatch = {operationId:string;topic:string;baseRevision:number;author:{kind:'manual';id:string};readDependencies:string[];intent:'explicit-save';operations:BoardOperation[]};
export type CardMetadata = {source:{kind:'manual';authorId:string;operationId:string}|{kind:'bootstrap'};modifiedRevision:number;fields?:Record<string,{modifiedRevision:number;authorId:string;operationId:string}>};
export type CommittedBoard = {revision:number;canvas:Canvas;metadata:Record<string,CardMetadata>};
export function parsePatch(value:unknown):BoardPatch {
 const p=value as BoardPatch;
 if(!p||typeof p!=='object'||!p.author||p.author.kind!=='manual'||!p.author.id||p.intent!=='explicit-save')throw Error('Expected explicit manual save');
 id(p.operationId);id(p.topic);id(p.author.id);
 if(!Number.isSafeInteger(p.baseRevision)||p.baseRevision<0||!Array.isArray(p.readDependencies)||p.readDependencies.some(d=>typeof d!=='string')||!Array.isArray(p.operations)||!p.operations.length)throw Error('Invalid patch baseline or operations');
 for(const op of p.operations){if(op?.type==='create-card')parseCard(op.card);else if(op?.type==='edit-card'){id(op.id);if(!editableFields.some(k=>op[k]!==undefined))throw Error('Empty edit');parseLayout(op as unknown as Record<string,unknown>);if(op.width!==undefined)size(op.width);if(op.height!==undefined)size(op.height);if(op.text!==undefined)string(op.text);if(op.x!==undefined)number(op.x);if(op.y!==undefined)number(op.y);if(op.file!==undefined)safeResourcePath(op.file);if(op.url!==undefined)safeResourceURL(op.url);}else if(op?.type==='delete-card')id(op.id);else throw Error('Unknown board operation');
  if(op.fieldRevisions!==undefined&&(!op.fieldRevisions||typeof op.fieldRevisions!=='object'||Array.isArray(op.fieldRevisions)||Object.entries(op.fieldRevisions).some(([k,v])=>!['id','type',...editableFields].includes(k)||!Number.isSafeInteger(v)||v<0)))throw Error('Invalid field baseline');
 }
 return p;
}

