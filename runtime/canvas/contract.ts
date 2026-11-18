import {parseStructure,layoutStructures,validateStructureGroups,type StructureIntent} from './structures.ts';
import {selectMixedStructures,type StructureDecision} from './mixed-structures.ts';
import {layoutCards,type Bounds,type LayoutWarning} from './layout.ts';
import {parseEdge,relationFields,validateRelationFields,semanticRelations,type Edge,type RelationOperation} from './relations.ts';
export type {Edge} from './relations.ts';
// The schema is shared by Node and the browser; types are inferred from its parsers.
type Parser<T> = (value: unknown) => T;
const string: Parser<string> = v => { if(typeof v!=='string') throw Error('Expected string'); return v; };
const id: Parser<string> = v => { const s=string(v); if(!s.length) throw Error('Empty identity'); return s; };
const number: Parser<number> = v => { if(typeof v!=='number'||!Number.isSafeInteger(v)) throw Error('Expected safe integer coordinate'); return v; };
const size: Parser<number> = v => { const n=number(v); if(n<=0) throw Error('Expected positive size'); return n; };
export const cardSchema={id,text:string,x:number,y:number,width:size,height:size};
export type Card = {structure?:StructureIntent|null;id:string;derivedFrom?:string;x:number;y:number;width:number;height:number;text:string;type?:'text'|'file'|'link'|'group';color?:string;subpath?:string;label?:string;background?:string;backgroundStyle?:'cover'|'ratio'|'contain';file?:string;url?:string;regionId?:string|null;fixed?:boolean;zIndex?:number};
export type KnowledgeCard = Card & {type?:'text'|'file'|'link'};
export function knowledgeCards(canvas:Canvas):KnowledgeCard[]{return canvas.nodes.filter((node):node is KnowledgeCard=>node.type!=='group');}
export function visualRegions(canvas:Canvas){return canvas.nodes.filter(node=>node.type==='group');}
export type Canvas = {nodes:Card[];edges:Edge[];layoutWarnings?:LayoutWarning[];structureDecisions?:StructureDecision[]};
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
export function parseStandard(v:Record<string,unknown>){
 if(v.color!==undefined&&(typeof v.color!=='string'||!(/^(#[0-9a-fA-F]{6}|[1-6])$/).test(v.color)))throw Error('Invalid Canvas color');
 if(v.backgroundStyle!==undefined&&!['cover','ratio','contain'].includes(v.backgroundStyle as string))throw Error('Invalid background style');
 return v.color!==undefined?{color:v.color as string}:{};
}
export function parseCard(value:unknown):Card {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected card');
 const v=value as Record<string,unknown>,type=v.type??'text';
 if(!['text','file','link','group'].includes(type as string))throw Error('Unknown card type');
 const geometry={id:id(v.id),x:number(v.x),y:number(v.y),width:size(v.width),height:size(v.height),...parseLayout(v),...(v.structure!==undefined?{structure:parseStructure(v.structure)}:{}),...parseStandard(v),...(v.derivedFrom!==undefined?{derivedFrom:id(v.derivedFrom)}:{})};
 if(type==='group')return {...geometry,type,text:'',...(v.label!==undefined?{label:string(v.label)}:{}),...(v.background!==undefined?{background:safeResourcePath(v.background)}:{}),...(v.backgroundStyle!==undefined?{backgroundStyle:v.backgroundStyle as 'cover'|'ratio'|'contain'}:{})};
 if(type==='file')return {...geometry,type,text:typeof v.text==='string'?v.text:'',file:safeResourcePath(v.file),...(v.subpath!==undefined?{subpath:string(v.subpath)}:{})};
 if(type==='link')return {...geometry,type,text:typeof v.text==='string'?v.text:'',url:safeResourceURL(v.url)};
 return {...geometry,type:'text',text:string(v.text)};
}
export function validateCanvas(value:unknown):Canvas {
 if(!value||typeof value!=='object')throw Error('Expected Canvas');
 const v=value as Record<string,unknown>;
 if(!Array.isArray(v.nodes)||!Array.isArray(v.edges))throw Error('Expected nodes and edges');
 const ids=new Set<string>();
 for(const node of v.nodes){const card=parseCard(node);if(ids.has(card.id))throw Error('Duplicate identity');ids.add(card.id);}
 for(const edge of v.edges){const e=parseEdge(edge);if(ids.has(e.id))throw Error('Duplicate identity');if(!v.nodes.some((n:any)=>n.id===e.fromNode)||!v.nodes.some((n:any)=>n.id===e.toNode))throw Error('Dangling relation');ids.add(e.id);}
 return value as Canvas;
}
export function validateCanvasCandidate(value:unknown):Canvas {
 const canvas=validateCanvas(value);validateStructureGroups(canvas.nodes);return canvas;
}
export function compileCanvas(input:unknown):Canvas {
 if(!input||typeof input!=='object'||!Array.isArray((input as {cards?:unknown}).cards))throw Error('Expected cards array');
 const v=input as {cards:Partial<Card>[];edges?:Edge[];previous?:Canvas;relayoutIds?:string[];bounds?:Bounds;autoStructure?:boolean};
 // Legacy group disagreement may be repaired; only the final candidate must agree.
 if(v.previous)validateCanvas(v.previous);
 const mixed=v.autoStructure?selectMixedStructures(v.cards,v.edges??v.previous?.edges??[],v.previous?.nodes):{cards:v.cards,decisions:[]};
 const result=layoutCards(mixed.cards,v.previous?.nodes,v.relayoutIds,v.bounds);
 layoutStructures(result,mixed.cards,v.edges??v.previous?.edges??[],v.previous?.nodes??[],v.relayoutIds??[],v.bounds);
 return validateCanvasCandidate({nodes:result.nodes.map(parseCard),edges:(v.edges??v.previous?.edges??[]).map(parseEdge),...(mixed.decisions.length?{structureDecisions:mixed.decisions}:{}),...(result.warnings.length?{layoutWarnings:result.warnings}:{})});
}

export const layoutFields=['structure','x','y','width','height','regionId','fixed','zIndex'] as const;
function parseLayout(v:Record<string,unknown>){
 const out:{regionId?:string|null;fixed?:boolean;zIndex?:number}={};
 if(v.regionId!==undefined)out.regionId=v.regionId===null?null:id(v.regionId);
 if(v.fixed!==undefined){if(typeof v.fixed!=='boolean')throw Error('Expected fixed boolean');out.fixed=v.fixed;}
 if(v.zIndex!==undefined)out.zIndex=number(v.zIndex);return out;
}
export const editableFields=['structure','text','x','y','width','height','regionId','fixed','zIndex','file','url','label'] as const;
export type FieldRevisions=Record<string,number>;
export type EditorExtra = {id:string;element:Record<string,any>};
export function parseExtra(value:unknown):EditorExtra {
 const v=value as EditorExtra;id(v?.id);const e=v.element;
 if(!e||typeof e!=='object'||Array.isArray(e)||e.id!==v.id||!['rectangle','ellipse','diamond','line','arrow','text','freedraw','frame','magicframe'].includes(e.type))throw Error('Invalid editor element');
 for(const key of ['x','y','width','height','angle','fontSize','strokeWidth','opacity','seed','roughness','fontFamily','lineHeight'])if(e[key]!==undefined&&(typeof e[key]!=='number'||!Number.isFinite(e[key])))throw Error('Invalid editor geometry');
 if(e.points!==undefined&&(!Array.isArray(e.points)||e.points.some((p:unknown)=>!Array.isArray(p)||p.length!==2||p.some(n=>typeof n!=='number'||!Number.isFinite(n)))))throw Error('Invalid editor route');
 if(e.width!==undefined&&e.width<0||e.height!==undefined&&e.height<0)throw Error('Invalid editor size');
 for(const key of ['strokeColor','backgroundColor','fillStyle','strokeStyle'])if(e[key]!==undefined&&typeof e[key]!=='string')throw Error('Invalid editor style');
 if(e.boundElements!=null&&(!Array.isArray(e.boundElements)||e.boundElements.some((b:any)=>!b||typeof b.id!=='string'||!['text','arrow'].includes(b.type))))throw Error('Invalid editor binding');
 for(const key of ['startBinding','endBinding'])if(e[key]!=null&&(typeof e[key]!=='object'||typeof e[key].elementId!=='string'))throw Error('Invalid editor binding');
 if(e.customData!=null&&(typeof e.customData!=='object'||Array.isArray(e.customData)))throw Error('Invalid editor metadata');
 if(e.link!=null)safeResourceURL(e.link);
 if(e.text!==undefined&&typeof e.text!=='string'||e.originalText!==undefined&&typeof e.originalText!=='string')throw Error('Invalid editor text');
 if(e.groupIds!==undefined&&(!Array.isArray(e.groupIds)||e.groupIds.some((g:unknown)=>typeof g!=='string')))throw Error('Invalid editor groups');
 return v;
}
export type ExtraOperation = {type:'create-extra';extra:EditorExtra}|{type:'edit-extra';id:string;element:Record<string,any>}|{type:'delete-extra';id:string};
export type CanvasImportPatch={operationId:string;topic:string;baseRevision:number;author:{kind:'manual';id:string};intent:'explicit-import';expectedHash:string|null;candidateHash:string;external:boolean;canvas:Canvas};
export type CanvasImportOperation={type:'replace-canvas';canvas:Canvas};
export type BoardOperation = (ExtraOperation|{type:'create-card';card:Card}|{type:'edit-card';id:string;structure?:StructureIntent|null;text?:string;label?:string;file?:string;url?:string;x?:number;y?:number;width?:number;height?:number;regionId?:string|null;fixed?:boolean;zIndex?:number}|{type:'delete-card';id:string}|RelationOperation) & {fieldRevisions?:FieldRevisions};
export type BoardPatch = {operationId:string;topic:string;baseRevision:number;author:{kind:'manual';id:string};readDependencies:string[];intent:'explicit-save';operations:BoardOperation[]};
export type CardMetadata = {semanticRevision?:number;basis?:{status:'needs-review'|'reviewed'|'retained';revision:number;changedIds:string[];withdrawnSources?:string[];history?:unknown[]};derivedFrom?:string;role?:'visual-region'|'knowledge';knowledge?:{conditions:string[];uncertainty:string;sources:string[];dependencies:string[]};organizer?:{taskId:string;attemptId:string};source:{kind:'discussion';sourceIds:string[]}|{kind:'manual';authorId:string;operationId:string}|{kind:'bootstrap'};modifiedRevision:number;fields?:Record<string,{modifiedRevision:number;authorId:string;operationId:string}>};
export type CommittedBoard = {revision:number;canvas:Canvas;editorExtras?:EditorExtra[];metadata:Record<string,CardMetadata>;relations?:ReturnType<typeof semanticRelations>;deletionIntents?:{id:string;object:Card|Edge;revision:number;authorId:string;operationId:string}[]};
export function parsePatch(value:unknown):BoardPatch {
 const p=value as BoardPatch;
 if(!p||typeof p!=='object'||!p.author||p.author.kind!=='manual'||!p.author.id||p.intent!=='explicit-save')throw Error('Expected explicit manual save');
 id(p.operationId);id(p.topic);id(p.author.id);
 if(!Number.isSafeInteger(p.baseRevision)||p.baseRevision<0||!Array.isArray(p.readDependencies)||p.readDependencies.some(d=>typeof d!=='string')||!Array.isArray(p.operations)||!p.operations.length)throw Error('Invalid patch baseline or operations');
 for(const op of p.operations){if(op?.type==='create-extra')parseExtra(op.extra);else if(op?.type==='edit-extra')parseExtra({id:op.id,element:op.element});else if(op?.type==='delete-extra')id(op.id);else if(op?.type==='create-card')parseCard(op.card);else if(op?.type==='edit-card'){id(op.id);if(!editableFields.some(k=>op[k]!==undefined))throw Error('Empty edit');parseLayout(op as unknown as Record<string,unknown>);if(op.structure!==undefined)parseStructure(op.structure);if(op.width!==undefined)size(op.width);if(op.height!==undefined)size(op.height);if(op.text!==undefined)string(op.text);if(op.label!==undefined)string(op.label);if(op.x!==undefined)number(op.x);if(op.y!==undefined)number(op.y);if(op.file!==undefined)safeResourcePath(op.file);if(op.url!==undefined)safeResourceURL(op.url);}else if(op?.type==='delete-card')id(op.id);else if(op?.type==='create-relation')parseEdge(op.edge);else if(op?.type==='edit-relation'){id(op.id);validateRelationFields(op);if(!relationFields.some(k=>op[k]!==undefined))throw Error('Empty relation edit');}else if(op?.type==='delete-relation')id(op.id);else throw Error('Unknown board operation');
  if(op.fieldRevisions!==undefined&&(!op.fieldRevisions||typeof op.fieldRevisions!=='object'||Array.isArray(op.fieldRevisions)||Object.entries(op.fieldRevisions).some(([k,v])=>!['id','type','element',...editableFields,...relationFields].includes(k)||!Number.isSafeInteger(v)||v<0)))throw Error('Invalid field baseline');
 }
 return p;
}
