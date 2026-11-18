import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {legacyBackup,restoreProject,exportProject,restoredProject} from './backup.mjs';
import {readCommitted} from './store.mjs';
import {parseExtra,validateCanvas} from './contract.ts';
import {semanticRelations} from './relations.ts';
import {runCompanion} from '../companion/bang.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const jsonHash=x=>hash(JSON.stringify(x));
const safeId=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]+$/.test(x);
function capture(project,input){
 if(!input||!['session','companion'].includes(input.kind)||input.kind==='companion'&&!safeId(input.topic))throw Error('Select session or an explicit safe companion topic');
 const files=[];let size=0;
 const read=(relative,optional=false)=>{
  let file=project;for(const part of relative.split('/')){file=path.join(file,part);try{if(fs.lstatSync(file).isSymbolicLink())throw Error('Legacy symlink refused');}catch(e){if(e.code==='ENOENT'&&optional)return null;throw e;}}
  const stat=fs.statSync(file);if(!stat.isFile()||(size+=stat.size)>32*1024*1024)throw Error('Legacy input exceeds bounded 32 MiB files');
  const bytes=fs.readFileSync(file);files.push({path:relative,sha256:hash(bytes),bytes:bytes.length});return bytes.toString('utf8');
 };
 const decode=(relative,optional=false)=>{const raw=read(relative,optional);return raw===null?null:JSON.parse(raw);};
 const dedupe=(records,key)=>{const found=new Map();for(const r of records){const id=key(r);if(typeof id!=='string'||!id)throw Error('Legacy identity missing');if(found.has(id)&&jsonHash(found.get(id))!==jsonHash(r))throw Error('Conflicting duplicate legacy identity');found.set(id,r);}return [...found.values()];};
 let scene,events,sources,state=null,legacyBoard=null,discussion=null;
 if(input.kind==='session'){
  const s=decode('.bang/sessions/pim.json');if(!Array.isArray(s.events)||!Array.isArray(s.messages))throw Error('Unsupported legacy session');
  scene=s.scene;events=dedupe(s.events,e=>e.id);sources=dedupe(s.messages,m=>m.id);
 }else{
  const dir='.bang/topics/'+input.topic+'/';state=decode(dir+'state.json');
  const lines=name=>(read(dir+name,true)??'').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
  const updates=dedupe(lines('updates.jsonl'),r=>String(r.revision));sources=dedupe(lines('sources.jsonl'),r=>r.id);
  if(!Number.isSafeInteger(state.revision)||state.revision<0||updates.length!==state.revision||updates.some((r,i)=>r.revision!==i+1)||sources.length!==new Set(updates.map(r=>r.turnId)).size||updates.some(r=>!sources.some(s=>s.id===r.turnId)))throw Error('Legacy committed revision/source counts disagree; repair interrupted legacy writes before migration');
  events=updates.map(r=>({id:'companion:'+r.revision+':'+r.turnId,turnId:r.turnId,changes:r.event}));
  if(!Array.isArray(state.processedTurnIds)||jsonHash([...new Set(updates.map(r=>r.turnId))])!==jsonHash(state.processedTurnIds))throw Error('Legacy processed-turn counts disagree');
  scene=decode(dir+'view.json',true);legacyBoard=decode(dir+'board.json');discussion=read(dir+'discussion.md',true);
 }
 if(!scene||!Array.isArray(scene.elements)||!Array.isArray(scene.appliedEventIds))throw Error('Actual saved scene required; open and save the legacy view first');
 const ids=new Set();for(const e of scene.elements){parseExtra({id:e.id,element:e});if(ids.has(e.id))throw Error('Duplicate saved element identity');ids.add(e.id);}
 const config=decode('.bang/companion.json',true);
 // Never inspect/kill a PID, follow transcript paths, or read model-run logs.
 const lock=read('.bang/worker.lock',true);
 const writerStopped=config?.enabled!==true&&lock===null;
 const fingerprint=jsonHash({kind:input.kind,topic:input.topic??null,files});
 return {fingerprint,files,scene,events,sources,state,legacyBoard,discussion,writerStopped};
}
function replay(data){
 let nodes=new Map(),relations=new Map(),groups=new Map(),goal='';const states=[];
 const messages=data.sources.flatMap(s=>s.messages??[s]),sourceIds=new Set(messages.map(m=>m.id));
 if(messages.some(m=>typeof m.id!=='string'||typeof m.text!=='string'))throw Error('Invalid legacy source message');
 const metadata=cards=>Object.fromEntries(cards.map(n=>[n.id,{role:'knowledge',source:{kind:'manual',authorId:'legacy-migration',operationId:data.fingerprint},modifiedRevision:0,basis:{status:'needs-review',revision:0,changedIds:[]}}]));
 const make=(cards,edges,extra=[],kind='event-reconstruction')=>({revision:states.length,canvas:{nodes:cards,edges},relations:semanticRelations(edges,cards),metadata:metadata(cards),editorExtras:extra,deletionIntents:[],legacyHistoryKind:kind});
 for(const event of data.events){
  const c=event.changes;if(!c||!Array.isArray(c.upsertNodes)||!Array.isArray(c.upsertRelations))throw Error('Unsupported legacy event');
  goal=c.goal??event.goal??'';for(const g of c.upsertGroups??[])groups.set(g.id,g);
  for(const n of c.upsertNodes){if(typeof n.id!=='string'||typeof n.text!=='string')throw Error('Invalid legacy node');if((n.sourceIds??n.sources?.map(s=>s.messageId)??[]).some(id=>!sourceIds.has(id)))throw Error('Missing legacy source reference');nodes.set(n.id,n);}
  for(const id of c.removeNodeIds??[])nodes.delete(id);
  for(const r of c.upsertRelations)relations.set(r.id,r);for(const id of c.removeRelationIds??[])relations.delete(id);
  relations=new Map([...relations].filter(([,r])=>nodes.has(r.from)&&nodes.has(r.to)));
  const cards=[...nodes.values()].map((n,i)=>({id:n.id,type:'text',text:n.text,x:(i%4)*300,y:Math.floor(i/4)*160,width:260,height:100}));
  const edges=[...relations.values()].filter(r=>nodes.has(r.from)&&nodes.has(r.to)).map(r=>({id:r.id,fromNode:r.from,toNode:r.to,label:r.label??'',toEnd:'arrow'}));
  states.push(make(cards,edges));
 }
 if(data.legacyBoard&&jsonHash(data.legacyBoard)!==jsonHash({goal,groups:[...groups.values()],nodes:[...nodes.values()],relations:[...relations.values()]}))throw Error('Legacy board differs from committed event replay');
 const elements=data.scene.elements,cards=[],edges=[],uncertainties=[],deleted=[];
 for(const e of elements){
  const n=e.customData?.bangNode;if(!n)continue;
  if(n.id!==e.id)throw Error('Legacy node identity disagrees with saved shape');
  const labels=elements.filter(t=>t.type==='text'&&t.containerId===e.id&&!t.isDeleted);
  if(e.isDeleted){deleted.push(e.id);continue;}
  if(labels.length!==1||!['rectangle','ellipse','diamond'].includes(e.type))throw Error('Saved knowledge node needs exactly one live bound text label');
  const text=labels[0].originalText??labels[0].text;if(typeof text!=='string')throw Error('Saved knowledge body missing');
  const card={id:e.id,type:'text',text,x:Math.round(e.x),y:Math.round(e.y),width:Math.max(1,Math.round(e.width)),height:Math.max(1,Math.round(e.height)),...(e.locked?{fixed:true}:{})};cards.push(card);
 }
 for(const e of elements){
  const r=e.customData?.bangRelation;if(!r||e.isDeleted)continue;
  const from=e.startBinding?.elementId,to=e.endBinding?.elementId;
  if(from!==r.from||to!==r.to||!cards.some(n=>n.id===from)||!cards.some(n=>n.id===to)){uncertainties.push({id:e.id,reason:'visual-semantic-endpoints-need-confirmation',visual:{from:from??null,to:to??null},semantic:{from:r.from,to:r.to}});continue;}
  const labels=elements.filter(t=>t.type==='text'&&t.containerId===e.id&&!t.isDeleted);
  const references=(e.boundElements??[]).filter(b=>b.type==='text');
  if(labels.length>1||references.length>1||references.some(b=>!elements.some(t=>t.id===b.id&&t.type==='text'&&t.containerId===e.id))||labels.length===1&&references.length===1&&references[0].id!==labels[0].id||labels.some(t=>typeof (t.originalText??t.text)!=='string'))throw Error('Ambiguous saved relationship label; inspect original scene before migration');
  const label=labels[0]?.originalText??labels[0]?.text??'';
  edges.push({id:e.id,fromNode:from,toNode:to,label,fromEnd:e.startArrowhead?'arrow':'none',toEnd:e.endArrowhead?'arrow':'none'});
 }
 const extras=elements.map(e=>({id:e.id,element:structuredClone(e)}));
 for(const extra of extras){const e=extra.element;if(cards.some(n=>n.id===e.id||n.id===e.containerId))e.customData={...e.customData,businessId:e.containerId??e.id};const relation=edges.find(r=>r.id===e.id||r.id===e.containerId);if(relation)e.customData={...e.customData,relationId:relation.id};}
 const current=make(cards,edges,extras,'actual-saved-scene');
 current.deletionIntents=deleted.map(id=>({id,object:{id,type:'text',text:elements.find(e=>e.id===id).customData.bangNode.text??'',x:0,y:0,width:1,height:1},revision:current.revision,authorId:'legacy-migration',operationId:data.fingerprint}));
 for(const e of elements){const r=e.customData?.bangRelation;if(!e.isDeleted||!r)continue;if(typeof r.from!=='string'||typeof r.to!=='string')throw Error('Invalid deleted legacy relationship');const label=elements.find(t=>t.type==='text'&&t.containerId===e.id);current.deletionIntents.push({id:e.id,object:{id:e.id,fromNode:r.from,toNode:r.to,label:label?.originalText??label?.text??''},revision:current.revision,authorId:'legacy-migration',operationId:data.fingerprint});}
 current.legacyMigration={fingerprint:data.fingerprint,files:data.files,events:data.events,sources:data.sources,savedScene:data.scene,legacyState:data.state,discussion:data.discussion,uncertainties,historyNote:'Event revisions reconstruct semantic content only; no historical saved geometry existed. Final revision uses actual saved scene. Sources are legacy provenance, not newly authenticated CompletedTurns.'};
 states.push(current);for(const s of states)validateCanvas(s.canvas);
 return {states,uncertainties,counts:{events:data.events.length,sources:data.sources.length,elements:elements.length,deleted:elements.filter(e=>e.isDeleted).length,knowledgeCards:cards.length,knowledgeRelations:edges.length,annotations:elements.filter(e=>!e.isDeleted&&!cards.some(n=>n.id===e.id||n.id===e.containerId)&&!edges.some(r=>r.id===e.id)).length}};
}
export function preflightLegacy(project,_topic,input){
 const data=capture(project,input),result=replay(data);
 return {fingerprint:data.fingerprint,files:data.files,counts:result.counts,writerStopped:data.writerStopped,uncertainties:result.uncertainties,replay:result.states,requiresOfflineConfirmation:true,archive:false};
}
export async function stopLegacy(project,_topic,input){
 if(input?.confirm!==true)throw Error('Explicit stop confirmation required');
 capture(project,input); // Validate only the selected bounded legacy paths first.
 if(fs.existsSync(path.join(project,'.bang/companion.json')))await runCompanion(['stop'],{workspace:project,output:()=>{}});
 return {status:'stop-requested',workerDrained:capture(project,input).writerStopped,browserWriterMustBeClosed:true};
}
export async function migrateLegacy(project,_topic,input){
 if(input?.confirmOffline!==true||input.confirmReplay!==true||input.confirmUncertainties!==true)throw Error('Confirm all legacy writers offline, visual replay and uncertainties before migration');
 const data=capture(project,input);if(!data.writerStopped)throw Error('Stop legacy companion and wait for worker lock to disappear; never infer death from PID');
 if(data.fingerprint!==input.fingerprint)throw Error('Legacy source fingerprint changed; repeat preflight');
 const result=replay(data),backup=legacyBackup('legacy',result.states),h=data.fingerprint,id=h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);
 const destination=path.join(project,'.bang/restored-projects',id);
 if(fs.existsSync(destination)){
  restoredProject(project,id);
  const restored=await exportProject(destination);if(restored.sha256!==backup.sha256)throw Error('Existing migrated destination changed; refusing overwrite');
 }else{
  if(capture(project,input).fingerprint!==data.fingerprint)throw Error('Legacy changed during verification');
  restoreProject(project,undefined,{backup},id);
 }
 const current=await readCommitted(destination,'legacy');
 if(jsonHash(current)!==jsonHash(result.states.at(-1)))throw Error('Migrated replay verification failed');
 if(capture(project,input).fingerprint!==data.fingerprint)throw Error('Legacy changed during migration; repeat preflight before switching');
 return {status:'migrated',projectPath:destination,restoreId:id,fingerprint:data.fingerprint,verified:true,counts:result.counts,requiresNewHostAuthorization:true,originalsPreserved:true};
}
export async function legacyHistory(project,topic){const state=await readCommitted(project,topic);if(!state.legacyMigration)throw Error('No legacy migration provenance');return state.legacyMigration;}
export async function archiveLegacy(project,_topic,input){
 if(input?.confirmArchive!==true)throw Error('Explicit archive confirmation required');
 const data=capture(project,input);if(!data.writerStopped||data.fingerprint!==input.fingerprint)throw Error('Legacy source changed or writer still active; repeat preflight');
 const h=data.fingerprint,id=h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);
 if((await readCommitted(restoredProject(project,id),'legacy')).legacyMigration?.fingerprint!==h)throw Error('Verified migration required before archive');
 const parent=path.join(project,'.bang/legacy-archives');
 if(fs.existsSync(parent)){if(fs.lstatSync(parent).isSymbolicLink()||!fs.statSync(parent).isDirectory())throw Error('Unsafe archive directory');}else fs.mkdirSync(parent,{mode:0o700});
 const archivePath=path.join(parent,h),receipt={status:'archived-copy',archivePath,fingerprint:h,originalsPreserved:true};
 if(fs.existsSync(archivePath)){
  if(fs.lstatSync(archivePath).isSymbolicLink())throw Error('Unsafe archive directory');
  for(const f of data.files){let file=archivePath;for(const part of f.path.split('/')){file=path.join(file,part);if(fs.lstatSync(file).isSymbolicLink())throw Error('Unsafe archive file');}if(hash(fs.readFileSync(file))!==f.sha256)throw Error('Archive hash mismatch');}
  return receipt;
 }
 const staging=path.join(parent,'.pending-'+randomUUID());fs.mkdirSync(staging,{mode:0o700});
 try{
  for(const f of data.files){const bytes=fs.readFileSync(path.join(project,f.path));if(hash(bytes)!==f.sha256)throw Error('Legacy changed during archive');const file=path.join(staging,f.path);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});}
  if(capture(project,input).fingerprint!==h)throw Error('Legacy changed during archive');
  fs.writeFileSync(path.join(staging,'manifest.json'),JSON.stringify({fingerprint:h,files:data.files}),{flag:'wx',mode:0o600});fs.renameSync(staging,archivePath);return receipt;
 }catch(e){fs.rmSync(staging,{recursive:true,force:true});throw e;}
}
