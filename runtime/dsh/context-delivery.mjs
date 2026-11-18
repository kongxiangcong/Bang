import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID,sign} from 'node:crypto';
import {runtimeOperation} from '../native/runtime.mjs';
import {deliverContext} from '../native/context-bridge.mjs';

const digest=text=>createHash('sha256').update(text).digest('hex');
const message=text=>({id:randomUUID(),role:'user',source:{kind:'bang-context'},content:[{type:'text',text}]});
const unavailable='Bang whiteboard is unsynced. The current committed board is available with the manual knowledge-context operation.';

export function createContextDelivery(ctx,manifest){
 const states=new WeakMap(), project=fs.realpathSync(manifest.project);
 let key;
 const locator=agent=>path.join(project,'.bang','runtime','dsh','bound-'+digest(agent.session.id)+'.json');
 function authorized(agent){
  const h=agent.session.header;
  return ctx.agents.get(agent.id)===agent && ctx.agents.roots().includes(agent) &&
   h.origin!=='subagent' && h.parentSession===undefined && h.cwd && fs.realpathSync(h.cwd)===project;
 }
 function bind(agent,result){
  if(!manifest.bridgeId||!authorized(agent))return;
  const file=locator(agent),tmp=file+'.'+randomUUID();
  fs.writeFileSync(tmp,JSON.stringify({topicId:result.topic.id}),{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,file);
 }
 function begin(agent,event){
  states.delete(agent);
  if(!manifest.bridgeId||!authorized(agent))return;
  const file=locator(agent);
  if(!fs.existsSync(file))return;
  const {topicId}=JSON.parse(fs.readFileSync(file,'utf8'));
  key??=fs.readFileSync(manifest.bridgeKeyFile,'utf8');
  const turnId=String(event.data.turn),ready=Promise.withResolvers(),receipt=Promise.withResolvers();
  const state={turnId,ready,receipt};
  states.set(agent,state);
  function call(command,fields){
   const data={topicId,turnId,...fields},now=Date.now();
   const payload=Buffer.from(JSON.stringify({host:'dsh',version:manifest.hostVersion,instanceId:manifest.instanceId,
    workspaceId:manifest.workspaceId,sessionId:agent.session.id,turnId,cursor:'dsh:'+event.seq,scope:[topicId],role:'primary',
    issuedAt:now,expiresAt:now+300000,nonce:randomUUID(),purpose:command,bridgeId:manifest.bridgeId,requestHash:digest(JSON.stringify(data))})).toString('base64url');
   return runtimeOperation(project,command,undefined,{...data,proof:{payload,signature:sign(null,Buffer.from(payload),key).toString('base64url')}});
  }
  // Start the single-writer cut from turn/start, before pre-step middleware or model assembly.
  state.finished=deliverContext({call,deliver:({envelope,envelopeHash,query,signal})=>{
   state.query=query;
   const note=message('Bang committed whiteboard data\n'+JSON.stringify(envelope)+'\nThis revision supersedes earlier whiteboard data. Use bang_context_query for pinned details.');
   Object.assign(state,{note,envelopeHash,signal});
   ready.resolve(note);
   return receipt.promise;
  }}).finally(()=>ready.resolve());
 }
 function observe(agent,event){
  if(event.type==='turn/start'){
   try{begin(agent,event);}catch{states.set(agent,{failed:true,turnId:String(event.data.turn)});}
   return;
  }
  const state=states.get(agent);
  if(event.type==='user/message'&&state?.note && event.data.id===state.note.id &&
   event.data.source?.kind==='bang-context' && event.data.content?.[0]?.text===state.note.content[0].text){
   state.receipt.resolve({accepted:true,envelopeHash:state.envelopeHash});
  }
 }
 async function preStep({agent,turn,messages,signal},next){
  const decision=await next(),state=states.get(agent);
  if(!state||state.offered||state.turnId!==String(turn)||signal.aborted||decision.kind!=='enter'||
    !messages.some(m=>m.source?.kind==='user'))return decision;
  state.offered=true;
  const note=await state.ready?.promise;
  if(signal.aborted)return decision;
  return {...decision,messages:[...decision.messages,note&&!state.signal.aborted?note:message(unavailable)]};
 }
 async function query(agent,args){
  const state=states.get(agent);
  if(!authorized(agent)||!state?.offered||!state.query||state.signal.aborted||!args||
    Object.keys(args).some(k=>!['kind','id','offset','limit','textOffset'].includes(k)))throw Error('No authorized pinned whiteboard query for this turn');
  return state.query(args);
 }
 return {bind,observe,preStep,query,checkpoint:async agent=>{const state=states.get(agent);if(state?.offered)await state.finished;}};
}
