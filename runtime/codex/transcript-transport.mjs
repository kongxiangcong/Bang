import fs from 'node:fs/promises';
import {CODEX_VERSION} from './executor-config.mjs';

// Adapt one exact, pinned Codex transcript to the connector's turn reader.
// The tool shell does not need to spawn another Codex App Server to bind it.
export async function openCodexTranscriptTransport({threadId,transcript}){
  const lines=(await fs.readFile(transcript,'utf8')).split('\n');
  const first=JSON.parse(lines[0]);
  const meta=first.payload;
  if(first.type!=='session_meta'||meta?.id!==threadId||meta.session_id!==threadId||
     meta.cli_version!==CODEX_VERSION||!['cli','vscode','appServer'].includes(meta.source)||meta.forked_from_id){
    throw Error('Codex transcript is not the expected primary session');
  }
  const turns=[];
  let active;
  for(const [index,line] of lines.slice(1).entries()){
    if(!line.trim())continue;
    let row;
    try{row=JSON.parse(line);}catch(error){if(index===lines.length-2)break;throw error;}
    const entry=row.payload;
    if(row.type==='event_msg'&&entry?.type==='task_started'){
      if(typeof entry.turn_id!=='string'||!entry.turn_id)throw Error('Invalid Codex turn identity');
      active={id:entry.turn_id,status:'inProgress',completedAt:null,items:[]};
      turns.push(active);
      continue;
    }
    if(!active||!entry)continue;
    if(row.type==='response_item'&&entry.type==='message'){
      if(entry.role==='user'){
        const metadata=entry.internal_chat_message_metadata_passthrough;
        const content=(entry.content??[]).flatMap((part,index)=>{
          const provenance=metadata?.content_item_metadata?.[index]?.provenance?.type;
          if(metadata?.turn_id!==active.id||provenance!=='user')return [];
          return part.type==='input_text'&&typeof part.text==='string'?[{type:'text',text:part.text}]:[{type:'unsupported'}];
        });
        if(content.length)active.items.push({type:'userMessage',content});
      }else if(entry.role==='assistant'&&entry.phase==='final_answer'&&typeof entry.id==='string'){
        const text=(entry.content??[]).filter(part=>part.type==='output_text').map(part=>part.text).join('\n');
        if(text)active.items.push({type:'agentMessage',phase:'final_answer',id:entry.id,text});
      }
    }
    if(row.type==='event_msg'&&entry.turn_id===active.id&&['task_complete','turn_aborted'].includes(entry.type)){
      active.completedAt=entry.completed_at??Date.parse(row.timestamp);
      active.status=entry.type==='turn_aborted'?'interrupted':'completed';
      if(active.status==='completed'&&entry.last_agent_message&&
         active.items.filter(item=>item.type==='agentMessage').at(-1)?.text!==entry.last_agent_message){
        active.items=active.items.filter(item=>item.type!=='agentMessage');
      }
      active=null;
    }
  }
  const thread={id:meta.id,sessionId:meta.session_id,parentThreadId:null,source:meta.source,
    cwd:meta.cwd,cliVersion:meta.cli_version,historyMode:'paginated'};
  return {version:CODEX_VERSION,close(){},activeTurnId:active?.id,async request(method,params){
    if(params.threadId!==threadId)throw Error('Codex read outside the bound transcript');
    if(method==='thread/read'&&params.includeTurns===false)return {thread};
    if(method==='thread/turns/list'&&params.itemsView==='notLoaded'){
      const descending=params.sortDirection==='desc',cursor=Number(params.cursor??(descending?turns.length-1:0));
      const turn=turns[cursor];
      if(!turn)return {data:[]};
      const next=cursor+(descending?-1:1);
      return {data:[{id:turn.id,status:turn.status,completedAt:turn.completedAt}],backwardsCursor:String(cursor),
        nextCursor:next>=0&&next<turns.length?String(next):null};
    }
    if(method==='thread/items/list'){
      const turn=turns.find(item=>item.id===params.turnId&&item.status==='completed');
      if(turn)return {data:turn.items,nextCursor:null};
    }
    throw Error('Unsupported Codex transcript read');
  }};
}
