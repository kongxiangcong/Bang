import fs from 'node:fs';
import {createHash,createPublicKey,randomUUID,sign} from 'node:crypto';
import {runtimeOperation} from '../native/runtime.mjs';

export const CODEX_VERSION='0.169.0-alpha.11.1';
const hash=value=>createHash('sha256').update(value).digest('hex');
const cursor=(turnId,version=null,sourceHash=null)=>'cx1.'+Buffer.from(JSON.stringify([turnId,version,sourceHash])).toString('base64url');
const decode=value=>{try{const result=JSON.parse(Buffer.from(value.slice(4),'base64url'));if(!value.startsWith('cx1.')||result.length!==3||typeof result[0]!=='string')throw Error();return result;}catch{throw Error('Codex cursor unsupported');}};
const failure=reason=>{throw Error(`Codex source unavailable: ${reason}`);};

// Host transport and registered signing key are the trusted installation seam.
// Never construct this using browser-supplied identity or trust=true flags.
export class CodexSessionConnector {
 constructor({project,transport,connectorId,privateKey,instanceId,runtimeCall}){
  this.project=fs.realpathSync(project);this.transport=transport;
  this.connectorId=connectorId;this.privateKey=privateKey;this.instanceId=instanceId;this.runtimeCall=runtimeCall;
 }
 call(command,input){return this.runtimeCall?this.runtimeCall(command,input):runtimeOperation(this.project,command,undefined,input);}
 async register(){return this.call('connector-register',{id:this.connectorId,host:'codex',versions:[CODEX_VERSION],publicKey:createPublicKey(this.privateKey).export({format:'pem',type:'spki'})});}
 proof(claims){
  const now=Date.now(),payload=Buffer.from(JSON.stringify({host:'codex',version:CODEX_VERSION,instanceId:this.instanceId,role:'primary',issuedAt:now,expiresAt:now+60000,nonce:randomUUID(),...claims})).toString('base64url');
  return {connectorId:this.connectorId,payload,signature:sign(null,Buffer.from(payload),this.privateKey).toString('base64url')};
 }
 async identity(threadId){
  if(this.transport.version!==CODEX_VERSION)failure('unsupported host version');
  const {thread}=await this.transport.request('thread/read',{threadId,includeTurns:false});
  if(thread?.id!==threadId||thread.parentThreadId!==null||!['cli','vscode','appServer'].includes(thread.source))failure('not an exact primary thread');
  if(thread.cliVersion!==CODEX_VERSION||thread.historyMode!=='paginated')failure('unsupported source format or version');
  if(fs.realpathSync(thread.cwd)!==this.project)failure('workspace mismatch');
  return thread;
 }
 async anchor(threadId,turnId){
  let pageCursor;
  for(let page=0;page<1000;page++){
   const result=await this.transport.request('thread/turns/list',{threadId,limit:1,itemsView:'notLoaded',sortDirection:'desc',...(pageCursor?{cursor:pageCursor}:{})});
   if(!Array.isArray(result.data)||result.data.length>1)failure('invalid metadata page');
   if(result.data[0]?.id===turnId){if(typeof result.backwardsCursor!=='string')failure('missing reverse cursor');return result.backwardsCursor;}
   if(!result.nextCursor)return null;
   if(result.nextCursor===pageCursor)failure('metadata cursor did not advance');pageCursor=result.nextCursor;
  }
  failure('metadata search limit reached');
 }
 async enable(hook,{scope,topicId,confirmation}={}){
  if(hook?.hook_event_name!=='UserPromptSubmit'||typeof hook.session_id!=='string'||typeof hook.turn_id!=='string'||!hook.turn_id)failure('trusted UserPromptSubmit identity required');
  if(fs.realpathSync(hook.cwd)!==this.project)failure('workspace mismatch');
  const thread=await this.identity(hook.session_id);
  if(thread.sessionId!==hook.session_id)failure('session tree identity mismatch');
  const {workspaceId}=await this.call('start');
  const handshake=await this.call('session-connect',this.proof({workspaceId,sessionId:thread.id,turnId:hook.turn_id,cursor:cursor(hook.turn_id),scope}));
  return this.call('binding-enable',{...handshake,topicId,confirmation});
 }
 async poll(topicId,sourceId){
  const sources=await this.call('binding-sources',{topicId}),source=sources.find(s=>s.id===sourceId);
  if(!source?.active||source.host!=='codex'||source.instanceId!==this.instanceId) return {status:'disabled',received:0};
  await this.identity(source.sessionId);
  const previous=source.receivedCursor??source.startCursor,[anchorId,anchorVersion,anchorHash]=decode(previous);
  let pageCursor=await this.anchor(source.sessionId,anchorId),received=0,last=previous;
  if(!pageCursor){if(!source.receivedCursor)return {status:'waiting-for-calling-turn',received:0};failure('authorized boundary missing; explicit gap decision required');}
  const {workspaceId}=await this.call('start');
  for(let page=0;page<100;page++){
   const result=await this.transport.request('thread/turns/list',{threadId:source.sessionId,limit:1,itemsView:'notLoaded',sortDirection:'asc',cursor:pageCursor});
   if(!Array.isArray(result.data)||result.data.length>1)failure('invalid metadata page');
   const turn=result.data[0];if(!turn)return {status:'idle',received};
   // A separate stored reader reports active turns as interrupted with no
   // completedAt. Neither Stop nor that projection is terminal evidence.
   if(!['completed','failed','interrupted'].includes(turn.status)||!Number.isFinite(turn.completedAt))return {status:'waiting-for-completion',received};
   if(turn.status!=='completed'){
    const next=cursor(turn.id,`terminal:${turn.status}:${turn.completedAt}`);
    if(next!==last){
     const batch={sourceId,previousCursor:last,events:[{kind:'turn',role:'primary',status:turn.status==='failed'?'error':'interrupted',turnId:turn.id,cursor:next}]};
     const receipt=await this.call('turn-ingest',{batch,proof:this.proof({workspaceId,sessionId:source.sessionId,turnId:source.startTurnId,cursor:source.startCursor,scope:[topicId],purpose:'completed-turn-ingestion',sourceId,batchHash:hash(JSON.stringify(batch))})});
     last=receipt.receivedCursor;
    }
    if(!result.nextCursor)return {status:'idle',received};
    if(result.nextCursor===pageCursor)failure('metadata cursor did not advance');pageCursor=result.nextCursor;continue;
   }
   const items=[];let itemCursor;
   for(let n=0;n<100;n++){
    const itemPage=await this.transport.request('thread/items/list',{threadId:source.sessionId,turnId:turn.id,limit:100,sortDirection:'asc',...(itemCursor?{cursor:itemCursor}:{})});
    if(!Array.isArray(itemPage.data))failure('invalid item page');items.push(...itemPage.data);
    if(!itemPage.nextCursor)break;
    if(itemPage.nextCursor===itemCursor||n===99)failure('item pagination incomplete');itemCursor=itemPage.nextCursor;
   }
   const users=items.filter(x=>x.type==='userMessage'),finals=items.filter(x=>x.type==='agentMessage'&&x.phase==='final_answer'&&x.delivery!== 'async');
   if(users.length!==1||finals.length!==1||users[0].content.some(x=>x.type!=='text'||typeof x.text!=='string')||typeof finals[0].text!=='string'||typeof finals[0].id!=='string')failure('ambiguous or unsupported completed turn');
   const user=users[0].content.map(x=>x.text).join('\n'),assistant=finals[0].text,version=finals[0].id,sourceHash=hash(JSON.stringify([user,assistant])),next=cursor(turn.id,version,sourceHash);
   if(turn.id===anchorId&&version===anchorVersion&&sourceHash!==anchorHash)failure('source version reused for different content');
   if(next.length>256)failure('source identity too long');
   if(!(turn.id===anchorId&&version===anchorVersion)){
    const event={kind:'turn',role:'primary',status:'completed',turnId:turn.id,versionId:version,cursor:next,user:{role:'user',content:user},assistant:{role:'assistant',channel:'final',content:assistant},sourceHash:hash(JSON.stringify([user,assistant]))};
    const batch={sourceId,previousCursor:last,events:[event]};
    const receipt=await this.call('turn-ingest',{batch,proof:this.proof({workspaceId,sessionId:source.sessionId,turnId:source.startTurnId,cursor:source.startCursor,scope:[topicId],purpose:'completed-turn-ingestion',sourceId,batchHash:hash(JSON.stringify(batch))})});
    received+=receipt.received;last=receipt.receivedCursor;
   }
   if(!result.nextCursor)return {status:'idle',received};
   if(result.nextCursor===pageCursor)failure('metadata cursor did not advance');pageCursor=result.nextCursor;
  }
  return {status:'more',received};
 }
}
