import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {runtimeOperation} from '../runtime/native/runtime.mjs';
import {createDshConnector} from '../runtime/dsh/session-connector.mjs';
async function fixture(){
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'bang-dsh-'));const call=(c,i)=>runtimeOperation(project,c,undefined,i);
 const keys=generateKeyPairSync('ed25519'); await call('connector-register',{id:'dsh-test',host:'dsh',versions:['0.2.1-rc.2'],publicKey:keys.publicKey.export({format:'pem',type:'spki'})});
 const events=[],listeners=new Map();let durable=true;
 const session={id:'exact-session',header:{id:'exact-session',cwd:project},get seq(){return events.length;}};
 const scoped={on(name,fn){listeners.set(name,fn);return ()=>listeners.delete(name);}};
 const agent={id:'exact-agent',session,ctx:scoped,status:'running'};
 const ctx={agents:{requireInitiator:()=>agent,get:()=>agent,roots:()=>[agent]},sessions:{flush:async()=>durable},sessionQuery:{readEvent:async({sessionId,seq})=>{assert.equal(sessionId,session.id);return {session:session.header,inheritedEventCount:0,target:events[seq]};}}};
 const connector=createDshConnector(ctx,{project,connectorId:'dsh-test',instanceId:'isolated-test',privateKey:keys.privateKey,scope:['*']});
 function append(type,data){const event={seq:events.length,type,data};events.push(event);connector.observe(session,event);return event;}
 append('turn/start',{turn:1});append('user/message',{role:'user',source:{kind:'user'},content:[{type:'text',text:'问题'}]});
 return {call,connector,session,agent,ctx,append,setDurable:v=>durable=v,close:async()=>{connector.close();await call('stop');await fs.rm(project,{recursive:true,force:true});}};
}
test('DSH calling turn enters the public durable queue only after completed and flush, repeated enable survives Runtime restart',async()=>{
 const f=await fixture();try{
 const bound=await f.connector.enable();
 f.append('assistant/message',{turn:1,message:{content:[{type:'reasoning',text:'PRIVATE'},{type:'text',text:'最终回答'}]}});
 await f.connector.poll();assert.equal((await f.call('turn-status',{topicId:bound.topic.id})).received,0);
 f.append('turn/end',{turn:1,reason:{kind:'completed'}});f.setDurable(false);
 await assert.rejects(f.connector.poll(),/durab/i);assert.equal((await f.call('turn-status',{topicId:bound.topic.id})).received,0);
 f.setDurable(true);await f.connector.poll();await f.call('stop');
 const again=await f.connector.enable();assert.equal(again.source.id,bound.source.id);await f.connector.poll();
 const status=await f.call('turn-status',{topicId:bound.topic.id});assert.equal(status.received,1);
 const source=await f.call('turn-source',{topicId:bound.topic.id,id:status.pending[0].id});assert.equal(source.user.content,'问题');assert.equal(source.assistant.content,'最终回答');assert.doesNotMatch(JSON.stringify(source),/PRIVATE/);
 }finally{await f.close();}
});
test('DSH rejects child initiators and self-origin input, and never imports historical messages before activation',async()=>{
 const f=await fixture();try{
 f.session.header.origin='subagent';await assert.rejects(f.connector.enable(),/root/);delete f.session.header.origin;
 const bound=await f.connector.enable();
 f.append('user/message',{source:{kind:'bang-context'},content:[{type:'text',text:'PRIVATE_CONTEXT'}]});
 f.append('assistant/message',{turn:1,message:{content:[{type:'text',text:'合法答案'}]}});f.append('turn/end',{turn:1,reason:{kind:'completed'}});await f.connector.poll();
 f.append('turn/start',{turn:2});f.append('user/message',{source:{kind:'bang-organizer'},content:[{type:'text',text:'SELF_LOOP'}]});f.append('assistant/message',{turn:2,message:{content:[{type:'text',text:'SELF_OUTPUT'}]}});f.append('turn/end',{turn:2,reason:{kind:'completed'}});await f.connector.poll();
 const status=await f.call('turn-status',{topicId:bound.topic.id});assert.equal(status.received,1);assert.equal(status.gaps.length,1);
 const source=await f.call('turn-source',{topicId:bound.topic.id,id:status.pending[0].id});assert.equal(source.user.content,'问题');
 f.agent.status='idle';await assert.rejects(f.connector.enable(),/active initiating turn/);
 }finally{await f.close();}
});
test('activation excludes older turns; failed turns leave public gaps and next completed root turn is received',async()=>{
 const f=await fixture();try{
 f.append('assistant/message',{turn:1,message:{content:[{type:'text',text:'HISTORY'}]}});f.append('turn/end',{turn:1,reason:{kind:'completed'}});
 f.append('turn/start',{turn:2});f.append('user/message',{source:{kind:'user'},content:[{type:'text',text:'第二轮'}]});const bound=await f.connector.enable();
 f.append('assistant/message',{turn:2,message:{content:[{type:'text',text:'截断输出'}]}});f.append('turn/end',{turn:2,reason:{kind:'aborted'}});await f.connector.poll();
 let status=await f.call('turn-status',{topicId:bound.topic.id});assert.equal(status.received,0);assert.equal(status.gaps[0].reason,'interrupted');
 f.append('turn/start',{turn:3});f.append('user/message',{source:{kind:'user'},content:[{type:'text',text:'第三轮'}]});f.append('assistant/message',{turn:3,message:{content:[{type:'text',text:'完整答复'}]}});f.append('turn/end',{turn:3,reason:{kind:'completed'}});await f.connector.poll();
 status=await f.call('turn-status',{topicId:bound.topic.id});assert.equal(status.received,1);assert.equal(status.pending[0].turnId,'3');
 }finally{await f.close();}
});
test('unsupported answer replacement fails closed without advancing the public cursor',async()=>{
 const f=await fixture();try{
 const bound=await f.connector.enable();f.append('assistant/message',{turn:1,message:{content:[{type:'text',text:'original'}]}});f.append('turn/end',{turn:1,reason:{kind:'completed'}});await f.connector.poll();
 const replacement=f.append('assistant/message',{turn:1,message:{content:[{type:'text',text:'replacement'}]}});replacement.surfaceOp={op:'replace',startSeq:2,endSeq:2};
 await assert.rejects(f.connector.poll(),/replacement/);assert.equal((await f.call('turn-status',{topicId:bound.topic.id})).received,1);
 }finally{await f.close();}
});
test('stopped DSH reception reads no bodies and a fresh durable boundary excludes the disabled interval',async()=>{
 const f=await fixture();try{const bound=await f.connector.enable();await f.call('organizer-control',{topicId:bound.topic.id,action:'stop-reception'});const original=f.ctx.sessionQuery.readEvent;f.ctx.sessionQuery.readEvent=()=>{throw Error('disabled body read');};f.append('assistant/message',{turn:1,message:{content:[{type:'text',text:'disabled'}]}});f.append('turn/end',{turn:1,reason:{kind:'completed'}});await f.connector.poll();await f.call('organizer-control',{topicId:bound.topic.id,action:'resume-reception'});await f.connector.poll();f.ctx.sessionQuery.readEvent=original;f.append('turn/start',{turn:2});f.append('user/message',{source:{kind:'user'},content:[{type:'text',text:'new'}]});f.append('assistant/message',{turn:2,message:{content:[{type:'text',text:'new answer'}]}});f.append('turn/end',{turn:2,reason:{kind:'completed'}});await f.connector.poll();const status=await f.call('turn-status',{topicId:bound.topic.id});assert.deepEqual(status.pending.map(s=>s.turnId),['2']);}finally{await f.close();}
});

test('DSH recovery drains more than one bounded batch from the durable authorized cursor after Runtime exit',async()=>{
 const f=await fixture();try{
  const bound=await f.connector.enable();await f.call('stop');
  for(let turn=1;turn<=101;turn++){
   if(turn>1){f.append('turn/start',{turn});f.append('user/message',{source:{kind:'user'},content:[{type:'text',text:'authorized '+turn}]});}
   f.append('assistant/message',{turn,message:{content:[{type:'text',text:'answer '+turn}]}});f.append('turn/end',{turn,reason:{kind:'completed'}});
  }
  await f.connector.poll();let status=await f.call('turn-status',{topicId:bound.topic.id});assert.equal(status.received,100);assert.equal(status.pending[99].turnId,'100');
  await f.call('stop');await f.connector.poll();status=await f.call('turn-status',{topicId:bound.topic.id});assert.equal(status.received,101);assert.equal(status.pending[100].turnId,'101');await f.connector.poll();assert.equal((await f.call('turn-status',{topicId:bound.topic.id})).received,101);
 }finally{await f.close();}
});
