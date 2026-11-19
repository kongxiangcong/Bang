import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {key} from './storage.mjs';
export function parse(raw,chatId) {
 const rows=[];const lines=raw.split('\n');
 for(let i=0;i<lines.length;i++){if(!lines[i].trim())continue;try{rows.push(JSON.parse(lines[i]))}catch{if(i===lines.length-1)break;throw Error('transcript 中存在损坏的完整记录')}}
 if(rows[0]?.type!=='session_meta'||rows[0]?.payload?.id!==chatId)throw Error('聊天 ID 与 transcript session_meta 不一致');
 let active=null;const completed=[];let lastStarted=null;
 for(const row of rows){const p=row.payload;
  if(row.type==='event_msg'&&p?.type==='task_started'){if(!p.turn_id)throw Error('task_started 缺少 turn_id');active={turnId:p.turn_id,startedAt:row.timestamp,messages:[]};lastStarted=p.turn_id;}
  if(!active)continue;
  if(row.type==='response_item'&&p?.type==='message'&&p.role==='user'){
   const text=(p.content??[]).filter(c=>['input_text','text'].includes(c.type)).map(c=>c.text??'').join('\n');
   if(text&&!/^<(environment_context|send_user_message_question_reply)>/.test(text))active.messages.push({id:`${chatId}/${active.turnId}/user/${active.messages.length}`,role:'user',text});
  }
  if(row.type==='response_item'&&p?.type==='message'&&p.role==='assistant'&&p.phase==='final_answer')active.finalAnswer=(p.content??[]).filter(c=>['output_text','text'].includes(c.type)).map(c=>c.text??'').join('\n');
  if(row.type==='event_msg'&&p?.type==='task_complete'&&p.turn_id===active.turnId){
   const final=p.last_agent_message||active.finalAnswer;if(active.messages.length&&!final)throw Error('完成标记没有可验证的助手最终回答；需要核对宿主 transcript 格式');
   if(active.messages.length&&typeof final==='string'&&final){delete active.finalAnswer;active.messages.push({id:`${chatId}/${active.turnId}/assistant`,role:'assistant',text:final});completed.push({...active,id:key(chatId+'\0'+active.turnId),chatId,completedAt:row.timestamp});}active=null;
  }
 }
 return {completed,activeTurnId:active?.turnId??null,lastStarted,metadata:rows[0].payload};
}
export async function inspect(binding) {return parse(await fs.readFile(binding.transcript,'utf8'),binding.chatId);}
async function matchingFiles(dir,id,out=[]) {
 for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await matchingFiles(file,id,out);else if(entry.isFile()&&entry.name.endsWith('.jsonl')&&entry.name.includes(id))out.push(file);}return out;
}
export async function locateTranscript({chatId,transcript}={},env=process.env) {
 chatId??=env.CODEX_THREAD_ID??env.CODEX_SESSION_ID;
 if(!chatId||!/^[a-zA-Z0-9_-]+$/.test(chatId))throw Error('缺少可验证的当前会话 ID（CODEX_THREAD_ID / CODEX_SESSION_ID）');
 if(env.CODEX_THREAD_ID&&chatId!==env.CODEX_THREAD_ID)throw Error('显式聊天 ID 与宿主当前会话不一致');
 transcript??=env.CODEX_TRANSCRIPT_PATH;
 if(!transcript){const sessions=path.join(env.CODEX_HOME??path.join(os.homedir(),'.codex'),'sessions');let matches;
  try{matches=await matchingFiles(sessions,chatId)}catch(e){if(e.code==='ENOENT')throw Error('宿主未提供当前 transcript 路径，且本地 sessions 目录不存在；无法准确绑定');throw e}
  if(matches.length!==1)throw Error(`当前 ID 对应 ${matches.length} 个 transcript；需要宿主提供唯一准确路径`);transcript=matches[0];
 }
 return {chatId,transcript:await fs.realpath(transcript)};
}
export async function discover({chatId,transcript,turnId}={},env=process.env) {
 const binding=await locateTranscript({chatId,transcript},env);const info=await inspect(binding);
 turnId??=env.CODEX_TURN_ID??info.activeTurnId;
 if(!turnId||turnId!==info.activeTurnId)throw Error('无法核对调用技能的当前活动轮；不会从历史完成轮猜测接收起点');
 return {...binding,startTurnId:turnId,ignored:info.completed.map(r=>r.id),boundAt:new Date().toISOString()};
}
export async function accepted(binding) {const info=await inspect(binding);const ignored=new Set(binding.ignored);return info.completed.filter(r=>!ignored.has(r.id));}
