import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {atomic} from './storage.mjs';
import {bytes} from './context.mjs';
import {runtimeEnv,codexPaths} from './runtime-paths.mjs';
const run=promisify(execFile),here=path.dirname(fileURLToPath(import.meta.url));
// Fail closed if the installed CLI cannot disable filesystem execution.
const disabled=['shell_tool','unified_exec','apps','browser_use','browser_use_external','computer_use','view_image','multi_agent','js_repl','code_mode','code_mode_host','skill_search','remote_plugin','artifact','image_generation','plugins','multi_agent_v2','multi_agent_v2_dynamic_tools','agent_message_board','agent_message_board_mcp','memory_tool','context_management'];
export async function preflight(executable='codex',home) {
 const options=home?{cwd:home,env:await runtimeEnv(home)}:{};
 const [{stdout:help},{stdout:features}]=await Promise.all([run(executable,['exec',...(home?codexPaths(home):[]),'--help'],options),run(executable,['features','list',...(home?codexPaths(home):[])],options)]);
 for(const option of ['--ignore-user-config','--ephemeral','--output-schema'])if(!help.includes(option))throw Error('Codex CLI 不兼容：缺少 '+option);
 if(!/^shell_tool\s/m.test(features))throw Error('Codex CLI 无法核对 shell_tool 禁用能力');
 return disabled.filter(name=>new RegExp('^'+name+'\\s','m').test(features));
}
export async function model(config,home,input,runDir,attempt) {
 const instructions=await fs.readFile(path.join(here,'organizer.md'),'utf8');
 const prompt=instructions+'\n\n资料 JSON：\n'+JSON.stringify(input);
 if(bytes(prompt)>input.limits.inputBytes)throw Error('模型输入超出 inputBytes；整轮保留未处理，请调整预算或减少活动上下文，不截断问答');
 await fs.mkdir(runDir,{recursive:true});await atomic(path.join(runDir,`input-${attempt}.json`),input);
 const output=path.join(runDir,`output-${attempt}.json`),stdout=await fs.open(path.join(runDir,`model-${attempt}.jsonl`),'w',0o600),stderr=await fs.open(path.join(runDir,`stderr-${attempt}.log`),'w',0o600);
 const env=await runtimeEnv(home);for(const k of ['CODEX_THREAD_ID','CODEX_SESSION_ID','CODEX_TURN_ID','CODEX_TRANSCRIPT_PATH'])delete env[k];
 const args=['exec',...codexPaths(home),'--ignore-user-config','--ephemeral','--skip-git-repo-check','-s','read-only','--json','--output-schema',path.join(here,'output.schema.json'),'-o',output,'-c','web_search="disabled"','-c','mcp_servers={}','-c','project_doc_max_bytes=0','-c','features.skip_host_skill_discovery=true',...(config.disabledFeatures??[]).flatMap(n=>['-c',`features.${n}=false`]),...(config.model?['-m',config.model]:[]),'-'];
 // Dedicated empty working directory. No project source is sent or mounted as input.
 const cwd=await fs.mkdtemp(path.join(home,'tmp','model-'));
 env.GIT_CEILING_DIRECTORIES=path.dirname(cwd);
 let child,timer,killTimer;
 try{
  child=spawn('flock',['-x',path.join(home,'model.lock'),config.executable,...args],{cwd,env,detached:true,stdio:['pipe',stdout.fd,stderr.fd]});
  child.stdin.on('error',()=>{});child.stdin.end(prompt);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGTERM')}catch{};killTimer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}},5000)},input.limits.modelTimeoutMs)});
  if(code!==0)throw Error(`模型调用失败或超时 (${code})；详见 ${runDir}`);
  const events=(await fs.readFile(path.join(runDir,`model-${attempt}.jsonl`),'utf8')).split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line)}catch{return {}}});
  if(events.some(e=>['command_execution','mcp_tool_call','web_search','file_change'].includes(e.item?.type)))throw Error('整理模型意外使用了工具，拒绝提交；请核对 CLI 工具隔离能力');
  return JSON.parse(await fs.readFile(output,'utf8'));
 }finally{clearTimeout(timer);clearTimeout(killTimer);await stdout.close();await stderr.close();await fs.rm(cwd,{recursive:true,force:true})}
}
