import {parseCard, validateCanvas, type Card, type CommittedBoard, type BoardPatch} from '../../../runtime/canvas/contract';
export type Draft = {base:CommittedBoard;cards:Card[];retry:BoardPatch|null;updated:number};
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
  others():Draft[]{return Object.keys(localStorage).filter(k=>k.startsWith(prefix)&&k!==key).map(k=>{try{const d=JSON.parse(localStorage.getItem(k)!);validateCanvas(d.base.canvas);d.cards.forEach(parseCard);return d as Draft;}catch{return null;}}).filter((d):d is Draft=>!!d);},
  read():Draft|null {const raw=localStorage.getItem(key);if(!raw)return null;const d=JSON.parse(raw) as Draft;validateCanvas(d.base.canvas);d.cards.forEach(parseCard);return d;},
  write(d:Draft){localStorage.setItem(key,JSON.stringify(d));},
  clear(){localStorage.removeItem(key);},
 };
}




