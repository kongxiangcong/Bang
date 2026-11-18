import {revisionState} from './history.mjs';
import {createHash,randomBytes,createPublicKey} from 'node:crypto';
import {openBindingDatabase} from './binding.mjs';
import {SignedSessionConnector} from '../native/session-connector.mjs';
import {readCommitted} from './store.mjs';
import {knowledgeContext} from './evidence.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const digest=v=>hash(JSON.stringify(v));
function database(project){const db=openBindingDatabase(project);db.exec(`CREATE TABLE IF NOT EXISTS context_bridges(id TEXT PRIMARY KEY,registration TEXT NOT NULL); CREATE TABLE IF NOT EXISTS context_proofs(bridge TEXT NOT NULL,nonce TEXT NOT NULL,PRIMARY KEY(bridge,nonce)); CREATE TABLE IF NOT EXISTS context_turns(id TEXT PRIMARY KEY,topic TEXT NOT NULL,body TEXT NOT NULL);`);return db;}
// Provisioning is owner-only. A binding browser capability does not register bridges.
export function registerContextBridge(project,input){const db=database(project);try{if(!/^[-\w]+$/.test(input?.id))throw Error('Invalid bridge identity');let registration;if(input.publicKey){if(createPublicKey(input.publicKey).asymmetricKeyType!=='ed25519'||typeof input.host!=='string'||!input.host||!Array.isArray(input.versions)||!input.versions.length||input.versions.some(v=>typeof v!=='string'||!v))throw Error('Explicit Ed25519 ContextBridge registration required');registration={host:input.host,versions:input.versions,publicKey:input.publicKey};}else{const row=db.prepare('SELECT registration FROM session_connectors WHERE id=?').get(input.connectorId??'');if(!row)throw Error('Trusted connector registration required');registration=JSON.parse(row.registration);}db.prepare('INSERT INTO context_bridges VALUES(?,?)').run(input.id,JSON.stringify(registration));return {id:input.id};}finally{db.close();}}
function authenticate(db,workspaceId,command,input){const {proof,...data}=input??{};if(typeof proof?.payload!=='string')throw Error('Context bridge proof required');const claims=JSON.parse(Buffer.from(proof.payload,'base64url').toString('utf8')),row=db.prepare('SELECT registration FROM context_bridges WHERE id=?').get(claims.bridgeId??'');if(!row)throw Error('Trusted ContextBridge required');const c=new SignedSessionConnector(JSON.parse(row.registration)).verifyProof(proof,workspaceId,command);if(claims.requestHash!==digest(data)||c.turnId!==data.turnId||(!c.scope.includes('*')&&!c.scope.includes(data.topicId)))throw Error('Context request scope rejected');const binding=db.prepare('SELECT * FROM binding_sources WHERE topic=? AND active=1').get(data.topicId??''),m=binding&&JSON.parse(binding.metadata);if(!m||(data.bindingId!==undefined&&data.bindingId!==binding.id)||['host','version','instanceId','sessionId'].some(k=>m[k]!==c[k]))throw Error('Context bound session scope rejected');if(db.prepare('SELECT 1 FROM context_proofs WHERE bridge=? AND nonce=?').get(claims.bridgeId,c.nonce))throw Error('Context proof replay rejected');db.prepare('INSERT INTO context_proofs VALUES(?,?)').run(claims.bridgeId,c.nonce);return {data,bridgeId:claims.bridgeId,bindingId:binding.id,key:digest([workspaceId,claims.bridgeId,binding.id,c.turnId])};}
function snapshot(db,state,auth,budgetBytes){
 const projection=knowledgeContext(state);
 const priorTurn=db.prepare(`SELECT json_extract(body,'$.revision') AS revision FROM context_turns
  WHERE topic=? AND json_extract(body,'$.bindingId')=? AND json_extract(body,'$.status')=?
  ORDER BY rowid DESC LIMIT 1`);
 const fromRevision=priorTurn.get(auth.data.topicId,auth.bindingId,'delivered')?.revision??null;
 const offeredRevision=priorTurn.get(auth.data.topicId,auth.bindingId,'offered')?.revision;
 const objectsOf=board=>[...board.canvas.nodes.filter(n=>n.type!=='group'),...(board.relations??[])];
 function reference(revision){
  if(revision==null||!db.prepare('SELECT 1 FROM revisions WHERE topic=? AND revision=?').get(auth.data.topicId,revision))return {items:new Map(),metadata:{}};
  const board=revisionState(db,auth.data.topicId,revision);
  return {items:new Map(objectsOf(board).map(item=>[item.id,item])),metadata:board.metadata};
 }
 // Retain confirmed-delivery coverage while marking withdrawals from the last
 // offered snapshot too, since the host may have consumed it.
 const references=[reference(fromRevision)];
 if(offeredRevision!==undefined&&offeredRevision!==fromRevision)references.push(reference(offeredRevision));
 const objects=objectsOf(state),currentIds=new Set(objects.map(item=>item.id)),changes=[];
 for(const item of objects){
  const metadata=state.metadata[item.id];
  if(references.some(old=>!old.items.has(item.id)||digest(old.items.get(item.id))!==digest(item)||digest(old.metadata[item.id]??{})!==digest(metadata??{}))){
   changes.push({id:item.id,kind:'fromNode' in item?'relation':'card',change:references.some(old=>old.items.has(item.id))?'modified':'added',manual:metadata?.source?.kind==='manual',validity:metadata?.basis?.status??'available'});
  }
 }
 const deleted=new Set();
 for(const old of references)for(const item of old.items.values())if(!currentIds.has(item.id)&&!deleted.has(item.id)){
  deleted.add(item.id);changes.push({id:item.id,kind:'fromNode' in item?'relation':'card',change:'deleted',validity:'withdrawn'});
 }
 const sources=Object.create(null);if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='completed_sources'").get())for(const metadata of Object.values(projection.metadata))for(const id of metadata.knowledge?.sources??[]){const row=db.prepare('SELECT body FROM completed_sources WHERE id=? AND topic=?').get(id,auth.data.topicId);if(row)sources[id]=JSON.parse(row.body);}
 const envelope={version:1,kind:'sourced-state-data',instructionAuthority:'none',revision:state.revision,fromRevision,cards:[],relations:[],metadata:Object.create(null),withdrawn:[],criticalChanges:{total:changes.length,items:[],omitted:changes.length},omittedCards:projection.knowledgeCards.length,omittedRelations:projection.semanticRelations.length,omittedWithdrawals:projection.withdrawn.length,query:{operation:'context-query',kinds:['changes','item','withdrawn','source'],revision:state.revision,requiresCapability:true},modelUse:'unknown'};
 const size=()=>Buffer.byteLength(JSON.stringify(envelope));
 for(const change of changes){envelope.criticalChanges.items.push(change);envelope.criticalChanges.omitted--;if(size()>budgetBytes){envelope.criticalChanges.items.pop();envelope.criticalChanges.omitted++;break;}}
 for(const withdrawn of projection.withdrawn){envelope.withdrawn.push(withdrawn);envelope.omittedWithdrawals--;if(size()>budgetBytes){envelope.withdrawn.pop();envelope.omittedWithdrawals++;break;}}
 for(const [items,key,omitted] of [[projection.knowledgeCards,'cards','omittedCards'],[projection.semanticRelations,'relations','omittedRelations']])for(const item of items){envelope[key].push(item);envelope.metadata[item.id]=projection.metadata[item.id];envelope[omitted]--;if(size()>budgetBytes){envelope[key].pop();delete envelope.metadata[item.id];envelope[omitted]++;break;}}
 return {projection,changes,sources,envelope,objects:objects.map(item=>({item,metadata:projection.metadata[item.id]??{basis:{status:'needs-review',revision:state.metadata[item.id]?.basis?.revision},originalProvenance:state.metadata[item.id]?.source,evidenceUsable:false}}))};
}
function bounded(value,data){const text=JSON.stringify(value),offset=data.textOffset??0;if(!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid query text offset');if(Buffer.byteLength(text)<=32768&&data.textOffset===undefined)return value;return {revision:value.revision,encoding:'json-fragment',text:text.slice(offset,offset+4096),textLength:text.length,nextTextOffset:offset+4096<text.length?offset+4096:null};}
export async function contextOperation(project,workspaceId,command,input){const db=database(project);try{const auth=authenticate(db,workspaceId,command,input),{data,key}=auth;let row=db.prepare('SELECT body FROM context_turns WHERE id=?').get(key),record=row&&JSON.parse(row.body);if(command==='context-start'){
 if(!record){const budget=data.budgetBytes??16384;if(!Number.isSafeInteger(budget)||budget<2048||budget>32768)throw Error('Context budget must be 2048-32768 bytes');const state=await readCommitted(project,data.topicId),token=randomBytes(32).toString('hex');record={...auth,data:undefined,topicId:data.topicId,turnId:data.turnId,revision:state.revision,token,...snapshot(db,state,auth,budget),status:'pending',modelUse:'unknown',createdAt:Date.now(),deadline:Date.now()+2000,expiresAt:Date.now()+300000};db.prepare('INSERT INTO context_turns VALUES(?,?,?)').run(key,data.topicId,JSON.stringify(record));}
 if(record.frozen||record.expiresAt<Date.now())throw Error('Context capability expired or frozen');
 return {token:record.token,envelope:record.envelope};
 }
 if(!record||record.frozen||record.token!==data.token||record.expiresAt<Date.now())throw Error('Context capability expired or scope rejected');
 if(command==='context-query'){
 const offset=data.offset??0,limit=data.limit??20;if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>20)throw Error('Bounded read-only query required');
 if(['changes','withdrawn'].includes(data.kind)){const all=data.kind==='changes'?record.changes:record.projection.withdrawn;return bounded({revision:record.revision,total:all.length,items:all.slice(offset,offset+limit),nextOffset:offset+limit<all.length?offset+limit:null},data);}
 if(data.kind==='item'){const found=record.objects.find(n=>n.item.id===data.id);if(!found)throw Error('Context item unavailable');const item=structuredClone(found.item),text=item.text??item.label??'',field='text' in item?'text':'label';item[field]=text.slice(offset,offset+4096);return bounded({revision:record.revision,item,metadata:found.metadata,validAsKnowledge:!record.projection.withdrawn.some(n=>n.id===item.id),textLength:text.length,nextOffset:offset+4096<text.length?offset+4096:null},data);}
 if(data.kind==='source'){const source=record.sources[data.id];if(!source)throw Error('Context source outside pinned lineage');const text=JSON.stringify(source);return bounded({revision:record.revision,sourceId:data.id,text:text.slice(offset,offset+4096),textLength:text.length,nextOffset:offset+4096<text.length?offset+4096:null,independentEvidence:false},data);}
 throw Error('Unknown read-only context query');
 }
 if(command==='context-ack'){
 if(!['delivered','offered','unsynced'].includes(data.outcome)||data.envelopeHash!==digest(record.envelope))throw Error('Exact context envelope acknowledgement required');
 if(record.status==='pending'){record.status=Date.now()<=record.deadline?data.outcome:'unsynced';record.error=record.status==='unsynced'?'DELIVERY_NOT_CONFIRMED':null;record.acknowledgedAt=Date.now();db.prepare('UPDATE context_turns SET body=? WHERE id=?').run(JSON.stringify(record),key);}
 return summary(record);
 }
 throw Error('Unknown context operation');
 }finally{db.close();}}

function summary(r){return {turnId:r.turnId,revision:r.revision,status:r.frozen?'frozen':r.status==='pending'&&Date.now()>r.deadline?'unsynced':r.status,modelUse:'unknown',error:r.error??(r.status==='pending'&&Date.now()>r.deadline?'DELIVERY_NOT_CONFIRMED':null),manualFallback:'knowledge-context',createdAt:r.createdAt};}
export function contextStatus(project,topic){const db=database(project);try{return {turns:db.prepare('SELECT body FROM context_turns WHERE topic=? ORDER BY rowid DESC LIMIT 20').all(topic).map(row=>summary(JSON.parse(row.body))),manualFallback:'knowledge-context',automaticHostSupport:false};}finally{db.close();}}
