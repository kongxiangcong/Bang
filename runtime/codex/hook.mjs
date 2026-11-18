import fs from 'node:fs';
import path from 'node:path';
import {createPrivateKey} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {CodexSessionConnector,CODEX_VERSION} from './connector.mjs';
import {openCodexStoredTransport} from './transport.mjs';
import {runtimeOperation} from '../native/runtime.mjs';
import {enablePromptContext,offerPromptContext,queryPromptContext,readCodexInstall,revokePromptContext} from './context-delivery.mjs';

const activationPrompt='Bang: enable current session';
const unverified={systemMessage:'Bang could not verify this session. No completion or synchronization is claimed. Check Bang connector status.'};

// The entry path and arguments are reviewed in Codex project Hook trust.
// Older reviewed commands omit --context-v1 and retain activation-only behavior.
export async function runCodexHook(hook,{project,threadId,hostVersion,contextEnabled,emit,openTransport=openCodexStoredTransport}){
 if(hook?.hook_event_name!=='UserPromptSubmit'||typeof hook.prompt!=='string')return emit({});
 const activating=hook.prompt===activationPrompt;
 if(!activating&&!contextEnabled)return emit({});
 let transport;
 try{
  if(typeof threadId!=='string'||!threadId||threadId.length>256||threadId!==hook.session_id||
   hook.agent_id!=null||hook.agent_type!=null||(hostVersion&&hostVersion!==CODEX_VERSION))return emit(activating?unverified:{});
  project=fs.realpathSync(project);
  if(fs.realpathSync(hook.cwd)!==project)return emit(activating?unverified:{});
  if(!activating)return offerPromptContext({project,sessionId:threadId,turnId:hook.turn_id,emit});

  if(contextEnabled)revokePromptContext(project,threadId);
  const install=readCodexInstall(project);
  transport=await openTransport({executable:install.executable,threadId});
  const connector=new CodexSessionConnector({project,transport,connectorId:install.connectorId,
   instanceId:install.instanceId,privateKey:createPrivateKey(install.privateKey)});
  const binding=await connector.enable(hook,{scope:['*']});
  if(binding.status!=='bound')return emit({systemMessage:'Bang needs explicit topic selection or takeover. No new source was enabled.'});

  await runtimeOperation(project,'codex-watch',undefined,{topicId:binding.topic.id,sourceId:binding.source.id});
  const enabled=contextEnabled&&enablePromptContext(project,install,threadId,binding);
  const context=enabled?'Committed whiteboard context is enabled for subsequent prompts.':
   'Automatic whiteboard context requires the updated reviewed hook.';
  return emit({systemMessage:'Bang current session bound; waiting for a verifiable completed turn. '+context});
 }catch{
  return emit(activating?unverified:{});
 }finally{transport?.close();}
}

async function main(){
 const [project,mode,...args]=process.argv.slice(2);
 const threadId=process.env.CODEX_THREAD_ID,hostVersion=process.env.CODEX_VERSION;
 const emit=output=>new Promise((resolve,reject)=>{
  process.stdout.write(JSON.stringify(output)+'\n',error=>error?reject(error):resolve());
 });
 if(mode==='--query'){
  try{
   if(fs.realpathSync(process.cwd())!==fs.realpathSync(project)||(hostVersion&&hostVersion!==CODEX_VERSION))throw Error();
   await emit(await queryPromptContext(fs.realpathSync(project),threadId,args));
  }catch{
   process.stderr.write('No authorized pinned whiteboard query. Use the reference for the current Bang turn, or the manual knowledge-context operation.\n');
   process.exitCode=1;
  }
  return;
 }
 let hook;
 try{
  process.stdin.setEncoding('utf8');
  let body='';
  for await(const chunk of process.stdin){
   body+=chunk;
   if(Buffer.byteLength(body)>1024*1024)throw Error();
  }
  hook=JSON.parse(body);
 }catch{return emit({});}
 await runCodexHook(hook,{project,threadId,hostVersion,contextEnabled:mode==='--context-v1',emit});
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
