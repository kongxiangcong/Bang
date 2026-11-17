// The schema is shared by Node and the browser; types are inferred from its parsers.
type Parser<T> = (value: unknown) => T;
const string: Parser<string> = v => { if(typeof v!=='string') throw Error('Expected string'); return v; };
const id: Parser<string> = v => { const s=string(v); if(!s.length) throw Error('Empty identity'); return s; };
const number: Parser<number> = v => { if(typeof v!=='number'||!Number.isSafeInteger(v)) throw Error('Expected safe integer coordinate'); return v; };
const size: Parser<number> = v => { const n=number(v); if(n<=0) throw Error('Expected positive size'); return n; };
export const cardSchema={id,text:string,x:number,y:number,width:size,height:size};
export type Card = {[K in keyof typeof cardSchema]:ReturnType<typeof cardSchema[K]>};
export type Canvas = {nodes:(Card & {type:'text'})[];edges:never[]};
export function parseCard(value:unknown):Card {
 if(!value||typeof value!=='object'||Array.isArray(value)) throw Error('Expected card');
 const v=value as Record<string,unknown>;
 return Object.fromEntries(Object.entries(cardSchema).map(([key,parse])=>[key,parse(v[key])])) as Card;
}
export function validateCanvas(value:unknown):Canvas {
 if(!value||typeof value!=='object') throw Error('Expected Canvas');
 const v=value as Record<string,unknown>;
 if(!Array.isArray(v.nodes)||!Array.isArray(v.edges)||v.edges.length) throw Error('This runtime supports text cards and no edges');
 const ids=new Set<string>();
 for(const node of v.nodes){if(node?.type!=='text') throw Error('Expected text node');const card=parseCard(node);if(ids.has(card.id))throw Error('Duplicate identity');ids.add(card.id);}
 return value as Canvas;
}
export function compileCanvas(input:unknown):Canvas {
 if(!input||typeof input!=='object'||!Array.isArray((input as {cards?:unknown}).cards))throw Error('Expected cards array');
 const nodes=(input as {cards:unknown[]}).cards.map(value=>{const c=parseCard(value);return {id:c.id,type:'text' as const,x:c.x,y:c.y,width:c.width,height:c.height,text:c.text};});
 return validateCanvas({nodes,edges:[]});
}
