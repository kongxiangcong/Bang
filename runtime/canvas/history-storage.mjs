import {deflateSync,inflateSync} from 'node:zlib';

// Existing databases contain plain JSON snapshots. New rows use bounded chains;
// prepared publication material and the current head remain standalone snapshots.
export const checkpointInterval=64;
const encoding='bang-history-v1';
const pack=value=>deflateSync(Buffer.from(value,'utf16le')).toString('base64');
const unpack=value=>inflateSync(Buffer.from(value,'base64'),{maxOutputLength:64*1024*1024}).toString('utf16le');
export function storedRevision(db,topic,revision){
 const row=db.prepare('SELECT state FROM revisions WHERE topic=? AND revision=?').get(topic,revision);
 if(!row)throw Error('Unknown history revision');return row.state;
}
export function revisionText(db,topic,revision){
 let cursor=revision,parts=[],text;
 for(let depth=0;depth<=checkpointInterval;depth++){
  const raw=storedRevision(db,topic,cursor),entry=JSON.parse(raw);
  if(entry.encoding!==encoding){text=raw;break;}
  if(entry.kind==='checkpoint'){text=unpack(entry.data);break;}
  if(entry.kind!=='delta'||entry.base!==cursor-1||cursor<1)throw Error('Invalid history chain');
  parts.push(entry);cursor--;
 }
 if(text===undefined)throw Error('History checkpoint missing');
 for(const entry of parts.reverse()){
  const state=JSON.parse(text);
  for(const [keys,value,remove] of JSON.parse(unpack(entry.data))){
   let target=state;for(const key of keys.slice(0,-1)){if(!Object.hasOwn(target,key))throw Error('Invalid history path');target=target[key];}
   const key=keys.at(-1);if(remove)delete target[key];else Object.defineProperty(target,key,{value,enumerable:true,writable:true,configurable:true});
  }
  text=JSON.stringify(state);
 }
 return text;
}
export function encodeRevision(db,topic,state,previous){
 const text=JSON.stringify(state),ids=[...state.canvas.nodes,...state.canvas.edges].map(n=>n.id),priorIds=new Set(previous?[...previous.canvas.nodes,...previous.canvas.edges].map(n=>n.id):[]);
 const entry={encoding,kind:'checkpoint',expandedBytes:Buffer.byteLength(text),ids:ids.filter(id=>!priorIds.has(id)),data:pack(text)};
 if(state.revision%checkpointInterval&&previous){
  const changes=[];
  const visit=(before,after,keys)=>{
   if(JSON.stringify(before)===JSON.stringify(after))return;
   if(before&&after&&typeof before==='object'&&typeof after==='object'&&Array.isArray(before)===Array.isArray(after)&&JSON.stringify([...Object.keys(before).filter(k=>Object.hasOwn(after,k)),...Object.keys(after).filter(k=>!Object.hasOwn(before,k))])===JSON.stringify(Object.keys(after))&&(!Array.isArray(before)||before.length===after.length)){
    for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
     if(!Object.hasOwn(after,key))changes.push([[...keys,key],null,true]);
     else if(!Object.hasOwn(before,key))changes.push([[...keys,key],after[key]]);
     else visit(before[key],after[key],[...keys,key]);
    }
   }else changes.push([keys,after]);
  };
  visit(previous,state,[]);
  const delta={...entry,kind:'delta',base:state.revision-1,data:pack(JSON.stringify(changes))};
  if(JSON.stringify(delta).length<JSON.stringify(entry).length)return JSON.stringify(delta);
 }
 return JSON.stringify(entry);
}
export function identityExists(db,topic,id){
 return !!db.prepare(`SELECT 1 FROM revisions r WHERE r.topic=? AND (
 EXISTS(SELECT 1 FROM json_each(r.state,'$.ids') WHERE value=?) OR
 EXISTS(SELECT 1 FROM json_each(r.state,'$.canvas.nodes') WHERE json_extract(value,'$.id')=?) OR
 EXISTS(SELECT 1 FROM json_each(r.state,'$.canvas.edges') WHERE json_extract(value,'$.id')=?)) LIMIT 1`).get(topic,id,id,id);
}
export function historyStatistics(db,topic){
 const result=db.prepare(`SELECT count(*) AS revisions,coalesce(sum(length(CAST(state AS BLOB))),0) AS historyBytes,
 coalesce(sum(coalesce(json_extract(state,'$.expandedBytes'),length(CAST(state AS BLOB)))),0) AS expandedHistoryBytes,
 sum(CASE WHEN json_extract(state,'$.kind')='delta' THEN 1 ELSE 0 END) AS deltas,
 sum(CASE WHEN json_extract(state,'$.kind')='delta' THEN 0 ELSE 1 END) AS checkpoints
 FROM revisions WHERE topic=?`).get(topic);
 return {...result,checkpointInterval,historyPolicy:'retain-until-explicit-action'};
}
