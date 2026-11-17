import fs from 'node:fs';
import {createHash,randomUUID,sign} from 'node:crypto';
import {runtimeOperation} from '../native/runtime.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const text=blocks=>Array.isArray(blocks)?blocks.filter(b=>b.type==='text'&&typeof b.text==='string').map(b=>b.text).join(''):'';
const cursor=n=>`dsh:${n}`;
function offset(value){if(!/^dsh:\d+$/.test(value))throw Error('Unsupported DSH cursor');return Number(value.slice(4));}
// Public in-host adapter: all host reads use SessionQuery, never synchronous log readers.
export function createDshConnector(ctx,config){
 const project=fs.realpathSync(config.project),starts=new WeakMap();let active,flight,closed=false;
 const call=(command,input)=>runtimeOperation(project,command,undefined,input);
 function observe(session,event){if(event.type==='turn/start')starts.set(session,{turnId:String(event.data.turn),cursor:cursor(event.seq)});}
 function proof(identity,extra={}){const now=Date.now();const payload=Buffer.from(JSON.stringify({...identity,host:'dsh',version:'0.2.1-rc.2',instanceId:config.instanceId,role:'primary',scope:config.scope,issuedAt:now,expiresAt:now+300000,nonce:randomUUID(),...extra})).toString('base64url');return {connectorId:config.connectorId,payload,signature:sign(null,Buffer.from(payload),config.privateKey).toString('base64url')};}
 async function enable(options={}){
  if(closed)throw Error('DSH connector closed');
  const agent=ctx.agents.requireInitiator(),session=agent.session;
  if(ctx.agents.get(agent.id)!==agent||!ctx.agents.roots().includes(agent)||session.header.origin==='subagent'||session.header.parentSession!==undefined||session.header.cwd===undefined||fs.realpathSync(session.header.cwd)!==project)throw Error('DSH initiating root/workspace rejected');
  if(agent.status!=='running')throw Error('DSH active initiating turn required');
  const boundary=starts.get(session);if(!boundary)throw Error('DSH initiating turn unavailable; enable after plugin activation in a new turn');
  const {workspaceId}=await call('start');const identity={workspaceId,sessionId:session.id,...boundary};
  const capability=await call('session-connect',proof(identity));const result=await call('binding-enable',{...capability,...options});
  if(result.status==='bound')active={agent,session,identity,capability,sourceId:result.source.id,topicId:result.topic.id};
  return result;
 }
 async function receive(){
  if(!active||closed)return;
  const a=active;if(ctx.agents.get(a.agent.id)!==a.agent)throw Error('DSH initiating Agent no longer live');
  const bound=await call('binding-status',a.capability);if(bound.status!=='bound'||bound.source.id!==a.sourceId)return;
  if(bound.source.receptionStopped){
   if(!bound.source.resumeRequested)return;
   const cut=a.session.seq;if(await ctx.sessions.flush(a.session)!==true)throw Error('DSH durability listener unavailable');
   const turnId=starts.get(a.session)?.turnId;if(!turnId)throw Error('DSH current boundary unavailable');
   const batch={sourceId:a.sourceId,previousCursor:bound.source.discardCursor??bound.source.receivedCursor??bound.source.startCursor,events:[{kind:'reception-boundary',cursor:cursor(cut),turnId}]};
   await call('turn-ingest',{batch,proof:proof(a.identity,{purpose:'completed-turn-ingestion',sourceId:a.sourceId,batchHash:hash(JSON.stringify(batch))})});return;
  }
  const previousCursor=bound.source.receivedCursor??bound.source.startCursor;
  // Capture the cut BEFORE flush: later appends may not be part of this receipt.
  const cut=a.session.seq;if(await ctx.sessions.flush(a.session)!==true)throw Error('DSH durability listener unavailable');
  let turn,events=[];
  for(let seq=offset(previousCursor);seq<cut;seq++){
   const read=await ctx.sessionQuery.readEvent({sessionId:a.session.id,seq,before:0,after:0});
   if(read.session.id!==a.session.id||read.inheritedEventCount>seq||!read.target||read.target.seq!==seq)throw Error('DSH scoped record unavailable');
   const e=read.target;
   if(['user/message','assistant/message'].includes(e.type)&&typeof e.surfaceOp==='object')throw Error('DSH source replacement requires a verified version mapping');
   if(e.type==='turn/start'){if(turn)throw Error('DSH turn boundary unsupported');turn={id:String(e.data.turn),users:[],assistant:''};}
   else if(turn&&e.type==='user/message'&&e.data.source?.kind==='user')turn.users.push(text(e.data.content));
   else if(turn&&e.type==='assistant/message'&&String(e.data.turn)===turn.id){const blocks=e.data.message?.content;turn.assistant=blocks?.some(b=>b.type==='tool-call')?'':text(blocks);}
   else if(turn&&e.type==='turn/end'){
    if(String(e.data.turn)!==turn.id)throw Error('DSH turn identity mismatch');
    const kind=e.data.reason?.kind,user=turn.users.join('\n\n'),assistant=turn.assistant;
    if(kind==='completed'&&user&&assistant)events.push({kind:'turn',role:'primary',status:'completed',turnId:turn.id,versionId:`end:${seq}`,cursor:cursor(seq+1),user:{role:'user',content:user},assistant:{role:'assistant',channel:'final',content:assistant},sourceHash:hash(JSON.stringify([user,assistant]))});
    else if(kind!=='completed')events.push({kind:'turn',role:'primary',status:kind==='aborted'?'interrupted':'error',turnId:turn.id,cursor:cursor(seq+1)});
    else events.push({kind:'gap',turnId:turn.id,cursor:cursor(seq+1),reason:'missing-record'});
    turn=undefined;
   }
  }
  if(events.length){const batch={sourceId:a.sourceId,previousCursor,events};await call('turn-ingest',{batch,proof:proof(a.identity,{purpose:'completed-turn-ingestion',sourceId:a.sourceId,batchHash:hash(JSON.stringify(batch))})});}
 }
 function poll(){if(!flight)flight=receive().finally(()=>flight=undefined);return flight;}
 return {observe,enable,poll,close(){closed=true;},async drain(){await flight;}};
}



