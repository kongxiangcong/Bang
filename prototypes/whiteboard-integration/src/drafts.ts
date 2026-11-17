import {parseCard, validateCanvas, type Card, type CommittedBoard, type BoardPatch} from '../../../runtime/canvas/contract';
export type Draft = {base:CommittedBoard;cards:Card[];retry:BoardPatch|null;updated:number};
// Browser-local recovery material never enters the committed Runtime endpoints.
export function draftStore(topic:string){
 const prefix=`bang:draft:v1:${encodeURIComponent(topic)}:`;
 if(!window.name.startsWith('bang-editor:'))window.name='bang-editor:'+crypto.randomUUID();
 const key=prefix+window.name.slice(12);
 return {
  others():Draft[]{return Object.keys(localStorage).filter(k=>k.startsWith(prefix)&&k!==key).map(k=>{try{const d=JSON.parse(localStorage.getItem(k)!);validateCanvas(d.base.canvas);d.cards.forEach(validateDraftCard);return d as Draft;}catch{return null;}}).filter((d):d is Draft=>!!d);},
  read():Draft|null {const raw=localStorage.getItem(key);if(!raw)return null;const d=JSON.parse(raw) as Draft;validateCanvas(d.base.canvas);d.cards.forEach(validateDraftCard);return d;},
  write(d:Draft){localStorage.setItem(key,JSON.stringify(d));},
  clear(){localStorage.removeItem(key);},
 };
}


// In-progress resource strings may be incomplete; only explicit save validates
// their final safety. Recovery never navigates or reads these strings.
function validateDraftCard(card:Card){
 parseCard({...card,type:'text'});
 if(card.type!==undefined&&!['text','file','link'].includes(card.type))throw Error('Invalid draft card type');
 if(card.type==='file'&&typeof card.file!=='string'||card.type==='link'&&typeof card.url!=='string')throw Error('Invalid draft resource');
}
