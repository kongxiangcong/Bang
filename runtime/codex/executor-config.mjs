import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const CODEX_VERSION='0.169.0-alpha.11.1';
export function codexConfiguration(){
 if(!process.env.BANG_ORGANIZER_CODEX)return null;
 try{
  if(process.env.BANG_ORGANIZER_NATIVE)throw Error();
  const c=JSON.parse(process.env.BANG_ORGANIZER_CODEX);
  if(c.version!==1||!path.isAbsolute(c.executable)||!fs.statSync(c.executable).isFile()||/\.(cmd|bat|ps1)$/i.test(c.executable)||!path.isAbsolute(c.authHome)||typeof c.model!=='string'||!/^[-a-zA-Z0-9._]+$/.test(c.model)||Object.keys(c).some(k=>!['version','executable','prefixArgs','authHome','model','inheritProxy'].includes(k)))throw Error();
  if(c.inheritProxy!==undefined&&typeof c.inheritProxy!=='boolean')throw Error();
  if(c.prefixArgs!==undefined&&(!Array.isArray(c.prefixArgs)||c.prefixArgs.some(a=>typeof a!=='string'||a.includes('\0'))))throw Error();
  return {version:1,executable:process.execPath,args:[fileURLToPath(new URL('./executor.mjs',import.meta.url)),JSON.stringify(c)],policy:'no-tools',graceMs:200,inheritProxy:c.inheritProxy===true};
 }catch{throw Object.assign(Error('Invalid Codex executor configuration'),{code:'EXECUTOR_CONFIGURATION'});}
}
export const disabledFeatures=['shell_tool','shell_snapshot','unified_exec','apps','plugins','remote_plugin','hooks','memories','view_image','image_generation','browser_use','browser_use_external','computer_use','in_app_browser','multi_agent','multi_agent_v2','goals','sleep_tool','workspace_dependencies','skill_search','tool_suggest','code_mode','code_mode_host','code_mode_only','deferred_executor','request_permissions_tool','send_message_to_user_async','token_budget'];
export function restrictedArguments(config,catalogFile,schemaFile){
 const overrides=['approval_policy="never"','web_search="disabled"','project_doc_max_bytes=0','skills.include_instructions=false','tools.update_plan.enabled=false','agents.enabled=false',`model_catalog_json=${JSON.stringify(catalogFile)}`,`log_dir=${JSON.stringify(path.join(process.cwd(),'logs'))}`];
 return [...(config.prefixArgs??[]),'exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--json','--strict-config','-m',config.model,...disabledFeatures.flatMap(f=>['--disable',f]),...overrides.flatMap(c=>['-c',c]),'--output-schema',schemaFile,'-'];
}
