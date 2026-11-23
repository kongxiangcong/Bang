import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {CODEX_VERSION} from '../runtime/codex/executor-config.mjs';
import {openCodexTranscriptTransport} from '../runtime/codex/transcript-transport.mjs';
import {CodexSessionConnector} from '../runtime/codex/connector.mjs';

const row=(type,payload)=>JSON.stringify({type,payload,timestamp:'2026-11-18T00:00:00Z'});
const event=(type,turn_id,more)=>row('event_msg',{type,turn_id,...more});
const user=(text,type)=>row('response_item',{type:'message',role:'user',content:[{type:'input_text',text}],
  internal_chat_message_metadata_passthrough:{turn_id:'one',content_item_metadata:[{provenance:{type}}]}});
const assistant=(id,phase,text)=>row('response_item',{type:'message',role:'assistant',id,phase,content:[{type:'output_text',text}]});

test('transcript excludes injected instructions and requires the exact completed final answer',async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'bang-codex-transcript-'));
  t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const transcript=path.join(folder,'session.jsonl');
  const version=process.platform==='linux'?'0.171.0':CODEX_VERSION;
  await fs.writeFile(transcript,[
    row('session_meta',{id:'session',session_id:'session',source:'vscode',cwd:folder,cli_version:version}),
    event('task_started','one'),user('repository instructions','agents_md'),user('skill text','skills'),
    user('what was agreed?','user'),assistant('aside','commentary','working'),assistant('final-one','final_answer','Use grams'),
    event('task_complete','one',{last_agent_message:'Use grams'}),event('task_started','two'),
    assistant('final-two','final_answer','Do not organize yet'),
  ].join('\n')+'\n');

  const reader=await openCodexTranscriptTransport({threadId:'session',transcript});
  assert.equal(reader.activeTurnId,'two');
  assert.equal((await new CodexSessionConnector({project:folder,transport:reader}).identity('session')).cliVersion,version);
  const read=(method,args)=>reader.request(method,{threadId:'session',...args});
  const reverse=await read('thread/turns/list',{itemsView:'notLoaded',sortDirection:'desc'});
  assert.equal(reverse.data[0].status,'inProgress');
  const previous=await read('thread/turns/list',{itemsView:'notLoaded',sortDirection:'desc',cursor:reverse.nextCursor});
  assert.equal(previous.data[0].status,'completed');
  assert.deepEqual((await read('thread/items/list',{turnId:'one'})).data,[
    {type:'userMessage',content:[{type:'text',text:'what was agreed?'}]},
    {type:'agentMessage',phase:'final_answer',id:'final-one',text:'Use grams'},
  ]);
  await assert.rejects(read('thread/items/list',{turnId:'two'}),/Unsupported/);
  await assert.rejects(openCodexTranscriptTransport({threadId:'another',transcript}),/primary session/);
});
