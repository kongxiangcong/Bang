// Actual pinned Windows DSH, controlled loopback provider. No real credential or inference.
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {restrictedOverlay} from '../runtime/dsh/executor-config.mjs';
const executable=process.env.BANG_DSH_AUDIT_BINARY??'D:/dsh-proj/dsh-desktop/DeepSeek Harness.exe';
const prefix=JSON.parse(process.env.BANG_DSH_AUDIT_PREFIX??JSON.stringify(['--expose-internals','D:/dsh-proj/dsh-desktop/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js']));
const cwd=fs.mkdtempSync(path.resolve('.scratch/dsh-audit-'));let observed=[];
const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);observed.push({tools:body.tools??[],model:body.model});res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({type:'error',error:{type:'authentication_error',message:'controlled rejection'}}));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const overlay=path.join(cwd,'overlay.yml');fs.writeFileSync(overlay,restrictedOverlay({model:'deepseek-flash'})+`- id: llm-deepseek\n  config:\n    baseURL: http://127.0.0.1:${server.address().port}\n    apiKeyEnv: DEEPSEEK_API_KEY\n`);
try{const env={SystemRoot:process.env.SystemRoot,DSH_HOME:path.join(cwd,'home'),ELECTRON_RUN_AS_NODE:'1',DSH_TELEMETRY_DISABLED:'1',DEEPSEEK_API_KEY:'controlled-nonsecret-placeholder'};
 const p=spawn(executable,[...prefix,'--profile','headless','--patch',overlay,'--json','-'],{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.stdin.end('Return only {"version":1,"changes":[]}');const timer=setTimeout(()=>p.kill(),15000);await new Promise(r=>p.on('close',r));clearTimeout(timer);
 assert.equal(observed.length,1,`Expected one loopback request; stream types: ${out.split('\n').filter(Boolean).map(s=>{try{const v=JSON.parse(s);return v.type+':'+(v.reason?.error?.code??v.message??'');}catch{return 'non-json';}})}`);assert.deepEqual(observed[0].tools,[]);console.log(JSON.stringify({actualPinnedDSH:true,requests:observed.length,tools:0,model:observed[0].model}));
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
