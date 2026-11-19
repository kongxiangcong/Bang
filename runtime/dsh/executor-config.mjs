import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
export const DSH_VERSION='0.2.1-rc.2';
export function dshConfiguration(){
 if(!process.env.BANG_ORGANIZER_DSH)return null;
 try{const c=JSON.parse(process.env.BANG_ORGANIZER_DSH);
 if(c.version!==1||!path.isAbsolute(c.executable)||!fs.statSync(c.executable).isFile()||/\.(cmd|bat|ps1)$/i.test(c.executable)||typeof c.model!=='string'||!/^[-a-zA-Z0-9._]+$/.test(c.model)||Object.keys(c).some(k=>!['version','executable','prefixArgs','model','inheritProxy','electron','credentialStore'].includes(k)))throw Error();
 if(c.credentialStore!==undefined&&!path.isAbsolute(c.credentialStore))throw Error();
 for(const k of ['inheritProxy','electron'])if(c[k]!==undefined&&typeof c[k]!=='boolean')throw Error();
 if(c.prefixArgs!==undefined&&(!Array.isArray(c.prefixArgs)||c.prefixArgs.some(a=>typeof a!=='string'||a.includes('\0'))))throw Error();
 return {version:1,executable:process.execPath,args:[fileURLToPath(new URL('./executor.mjs',import.meta.url)),JSON.stringify(c)],policy:'no-tools',graceMs:200,inheritProxy:c.inheritProxy===true};
 }catch{throw Object.assign(Error('Invalid DSH executor configuration'),{code:'EXECUTOR_CONFIGURATION'});}
}
export function restrictedOverlay(config){
 const disabled=['tool-plugin-manager','plugin-manager','hmr','session-title-llm','settings','config-editor','llm-pi-ai','llm-deepseek-account','authorization','deepseek-account','agent-instructions','skill','skill-filesystem','subagent','subagent-spawn-in-process','subagent-fork-in-process','ptc-runtime','workflow-ptc','compaction-basic','command-compact','image-offload','goal','goal-round-driver','command-goal','plan-mode','llm-retry','session-telemetry-otel','otel','web','web-search-deepseek','web-deepseek-api','web-fetch-http','mcp-resources','shell-env','tool-working-directory','tool-bash','tool-pwsh','tool-jobs','tool-fs','tool-fs-search','tool-skill','tool-subagent-control','tool-subagent-list-agents','tool-subagent','tool-subagent-fork','tool-workflow','tool-todo','tool-goal','tool-web'];
 return disabled.map(id=>`- id: ${id}\n  disabled: true\n`).join('')+`- id: credentials\n  disabled: false\n  config:\n    watch: false\n${config.credentialStore?'    path: '+JSON.stringify(config.credentialStore)+'\n':''}- id: agent-default-model\n  config:\n    provider: deepseek-official\n    model: ${JSON.stringify(config.model)}\n- id: sandbox-policy\n  config:\n    mode: read-only\n- id: approval\n  config:\n    policy: never\n- id: tools\n  config:\n    mode: native\n- id: system-prompt\n  config:\n    personaPrefix: You are the Bang Organizer. Return only the requested JSON.\n- insert:\n    - id: bang-organizer-guard\n      name: ${JSON.stringify(fileURLToPath(new URL('./executor-guard.mjs',import.meta.url)).replaceAll('\\','/'))}\n`;
}
