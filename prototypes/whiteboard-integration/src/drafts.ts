import {parseEdge} from '../../../runtime/canvas/relations';
import {parseExtra,parseCard, validateCanvas, type EditorExtra, type Card, type Edge, type CommittedBoard, type BoardPatch} from '../../../runtime/canvas/contract';
export type Draft = {base:CommittedBoard;cards:Card[];extras?:EditorExtra[];edges?:Edge[];retry:BoardPatch|null;updated:number;overlay?:Record<string,Record<string,number>>;ackRevision?:number};
async function editorIdentity():Promise<string>{
 if(!window.name.startsWith('bang-editor:'))window.name='bang-editor:'+crypto.randomUUID();
 // A duplicated tab can inherit window.name. A document-lifetime lock makes
 // an inherited identity a new editor while reload retains an unclaimed one.
 if(!navigator.locks){window.name='bang-editor:'+crypto.randomUUID();return window.name;}
 return new Promise((resolve,reject)=>{
  navigator.locks.request(window.name,{ifAvailable:true},lock=>{
   if(!lock){window.name='bang-editor:'+crypto.randomUUID();editorIdentity().then(resolve,reject);return;}
   resolve(window.name);return new Promise<void>(()=>{});
  }).catch(reject);
 });
}
// Browser-local recovery material never enters the committed Runtime endpoints.
export async function draftStore(workspace:string,topic:string){
 if(typeof workspace!=='string'||!workspace)throw Error('Workspace identity unavailable');
 const prefix=`bang:draft:v2:${encodeURIComponent(workspace)}:${encodeURIComponent(topic)}:`;
 if(!window.name.startsWith('bang-editor:'))window.name='bang-editor:'+crypto.randomUUID();
 const key=prefix+(await editorIdentity());
 return {
  others():Draft[]{return Object.keys(localStorage).filter(k=>k.startsWith(prefix)&&k!==key).map(k=>{try{return parseDraft(localStorage.getItem(k)!);}catch{return null;}}).filter((d):d is Draft=>!!d);},
  read():Draft|null {const raw=localStorage.getItem(key);if(!raw)return null;return parseDraft(raw);},
  write(d:Draft){localStorage.setItem(key,JSON.stringify(d));},
  clear(){localStorage.removeItem(key);},
 };
}


// In-progress resource strings may be incomplete; only explicit save validates
// their final safety. Recovery never navigates or reads these strings.
function validateDraftCard(card:Card){
 parseCard({...card,type:'text'});
 if(card.type!==undefined&&!['text','file','link','group'].includes(card.type))throw Error('Invalid draft card type');
 if(card.type==='file'&&typeof card.file!=='string'||card.type==='link'&&typeof card.url!=='string')throw Error('Invalid draft resource');
}

function parseDraft(raw:string):Draft {
 const d=JSON.parse(raw) as Draft;
 validateCanvas(d.base.canvas);d.cards.forEach(validateDraftCard);d.edges?.forEach(parseEdge);d.extras?.forEach(parseExtra);d.base.editorExtras?.forEach(parseExtra);
 return d;
}
