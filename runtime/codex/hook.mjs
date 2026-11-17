import fs from 'node:fs';
import path from 'node:path';
import {createPrivateKey} from 'node:crypto';
import {CodexSessionConnector} from './connector.mjs';
import {openCodexStoredTransport} from './transport.mjs';
import {runtimeOperation} from '../native/runtime.mjs';

// Only the reviewed, project-scoped UserPromptSubmit hook calls this entry.
// Ignore every ordinary prompt and every Stop event without reading host state.
let transport;
try{
 process.stdin.setEncoding('utf8');let body='';for await(const chunk of process.stdin){body+=chunk;if(Buffer.byteLength(body)>1024*1024)throw Error();}
 const hook=JSON.parse(body);body='';
 if(hook.hook_event_name!=='UserPromptSubmit'||hook.prompt!=='Bang: enable current session'){process.stdout.write('{}\n');}
 else{
  const project=fs.realpathSync(process.argv[2]);
  if(fs.realpathSync(hook.cwd)!==project||process.env.CODEX_THREAD_ID!==hook.session_id||hook.agent_id||hook.agent_type)throw Error();
  const manifest=path.join(project,'.bang','runtime','codex-install.json');if(fs.lstatSync(manifest).isSymbolicLink())throw Error();
  const install=JSON.parse(fs.readFileSync(manifest,'utf8'));
  transport=await openCodexStoredTransport({executable:install.executable,threadId:hook.session_id});
  const connector=new CodexSessionConnector({project,transport,connectorId:install.connectorId,instanceId:install.instanceId,privateKey:createPrivateKey(install.privateKey)});
  const binding=await connector.enable(hook,{scope:['*']});
  if(binding.status==='bound'){
   await runtimeOperation(project,'codex-watch',undefined,{topicId:binding.topic.id,sourceId:binding.source.id});
   process.stdout.write(JSON.stringify({systemMessage:'Bang current session bound; waiting for a verifiable completed turn. Organizer and context delivery are not enabled by this hook.'})+'\n');
  }else process.stdout.write(JSON.stringify({systemMessage:'Bang needs explicit topic selection or takeover. No new source was enabled.'})+'\n');
 }
}catch{process.stdout.write(JSON.stringify({systemMessage:'Bang could not verify this session. No completion or synchronization is claimed. Check Bang connector status.'})+'\n');}
finally{transport?.close();}
