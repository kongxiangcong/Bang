import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {snapshot,commit,commits,atomic,read,log} from './storage.mjs';
import {inputFor,limits,lookup,validateResult,validateSchema} from './context.mjs';
import {accepted,inspect} from './transcript.mjs';
import {model} from './model.mjs';
export const topicDir=(home,config)=>path.join(home,'topics',config.topic);
export async function organize(home,config,round,invoke=model) {
 const dir=topicDir(home,config),state=await snapshot(dir);
 if(state.processed.includes(round.id))return state;
 const input=await inputFor(config,dir,state,round),budget=limits(config);
 const runDir=path.join(dir,'runs',round.id,crypto.randomUUID());
 const known=new Set(round.messages.map(m=>m.id));for(const c of await commits(dir))for(const m of c.round?.messages??[])known.add(m.id);
 let result,checked;const history={sources:[],archives:[]};
 await log(home,'organizing',{chatId:round.chatId,turnId:round.turnId,revision:state.revision});
 for(let n=0;n<=budget.maxLookups+1;n++){
  result=await invoke(config,home,{...input,history},runDir,n);
  if(result.kind==='lookup'){
   validateSchema(result);
   if(n>=budget.maxLookups)throw Error('历史回查次数超限');
   const requested=await lookup(dir,{sourceIds:result.sourceIds,archiveIds:result.archiveIds},budget.historyBytes);
   for(const k of ['sources','archives'])history[k]=[...new Map([...history[k],...requested[k]].map(x=>[x.id,x])).values()];
   if(Buffer.byteLength(JSON.stringify(history))>budget.historyBytes)throw Error('累计历史回查超限');continue;
  }
  try{checked=validateResult(result,state,round,known,budget);break}catch(e){if(input.correction)throw e;input.correction={error:e.message,instruction:'修正本轮输出；保留条件，不截断；若预算无法容纳则不要伪造成功。'};}
 }
 if(!checked)throw Error('模型未返回可提交的更新');
 result.event.removeGroupIds=state.board.groups.filter(g=>!checked.board.groups.some(n=>n.id===g.id)).map(g=>g.id);
 const next={schema:2,revision:state.revision+1,board:checked.board,memory:result.memory,discussion:result.discussion,retainedConditions:result.retainedConditions,processed:[...state.processed,round.id],archives:[...state.archives,...checked.archived.map(a=>({id:a.id,title:a.node?.text??a.condition,sourceIds:a.node?.sourceIds??a.sourceIds}))],archived:checked.archived,round,event:result.event,lastCompletedAt:round.completedAt,committedAt:new Date().toISOString()};
 await commit(dir,next);
 await log(home,'organized',{chatId:round.chatId,turnId:round.turnId,revision:next.revision});return next;
}
// The caller owns the project's worker flock. pendingSwitch is immutable until
// drained. Switching cannot race the model task or the revision pointer.
export async function step(home,withControl,invoke=model) {
 // Serialize selection with switch requests: no turn completed after the frozen
 // cutoff can slip in through a previously read binding.
 const selected=await withControl(async()=>{
  const config=await read(path.join(home,'bundle.json'));
  if(!config.enabled)return {config,round:null};
  const state=await snapshot(topicDir(home,config));
  const queue=config.pendingSwitch?.rounds??await accepted(config.binding);
  return {config,round:queue.find(r=>!state.processed.includes(r.id))};
 });
 let {config,round}=selected;if(!config.enabled)return 'paused';
 if(round){await organize(home,config,round,invoke);return 'processed';}
 if(config.pendingSwitch){
  await withControl(async()=>{config=await read(path.join(home,'bundle.json'));const p=config.pendingSwitch;if(!p)return;await inspect(p.target);
   // The cutoff excludes incomplete old turns, explicitly recorded in history.
   const history={from:config.binding,to:p.target,requestedAt:p.requestedAt,switchedAt:new Date().toISOString(),acceptedOldTurnIds:p.rounds.map(r=>r.turnId),excludedIncompleteTurnId:p.excludedIncompleteTurnId};
   config.binding=p.target;config.bindings.push(history);config.pendingSwitch=null;await atomic(path.join(home,'bundle.json'),config);await log(home,'switched',{from:history.from.chatId,to:history.to.chatId,acceptedOldTurnIds:history.acceptedOldTurnIds,excludedIncompleteTurnId:history.excludedIncompleteTurnId});
  });return 'switched';
 }
 return 'idle';
}
