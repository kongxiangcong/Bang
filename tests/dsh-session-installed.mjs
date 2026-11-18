// Actual pinned DSH processes + controlled loopback provider. Never external inference or user credentials.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {runtimeOperation} from '../runtime/native/runtime.mjs';import {restrictedOverlay} from '../runtime/dsh/executor-config.mjs';
const executable=process.env.BANG_DSH_AUDIT_BINARY??'D:/dsh-proj/dsh-desktop/DeepSeek Harness.exe';
const prefix=JSON.parse(process.env.BANG_DSH_AUDIT_PREFIX??JSON.stringify(['--expose-internals','D:/dsh-proj/dsh-desktop/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js']));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bang-dsh-session-native-')),project=path.join(root,'project'),home=path.join(root,'home');fs.mkdirSync(project);fs.mkdirSync(home);
const call=(command,input)=>runtimeOperation(project,command,undefined,input);
const env={...(process.platform==='win32'?{SystemRoot:process.env.SystemRoot}:{}),DSH_HOME:home,ELECTRON_RUN_AS_NODE:'1',DSH_TELEMETRY_DISABLED:'1',DEEPSEEK_API_KEY:'controlled-nonsecret-placeholder'};
let activeChild;
async function run(exe,args,input,cwd=project,environment=env){return new Promise((resolve,reject)=>{const p=spawn(exe,args,{cwd,env:environment,windowsHide:true,stdio:['pipe','pipe','pipe']});activeChild=p;let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);const timer=setTimeout(()=>p.kill(),25000);p.on('close',code=>{clearTimeout(timer);resolve({code,out,err});});p.stdin.end(input);});}
let requests=0,toolCount=0,answer='',wireError,crash=false,filtering=false,childCalls=0,failProvider=false,childRejectedOnWire=false,foreignRejectedOnWire=false;
const server=http.createServer(async(req,res)=>{
 try{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests++;
 assert.equal(body.model,'deepseek-flash');
 assert.deepEqual((body.tools??[]).map(t=>t.name).sort(),toolCount>=0?(filtering?['acceptance_child','acceptance_inject','bang_enable','bang_reception_status']:['bang_enable','bang_reception_status']):[]);
 if(crash){setTimeout(()=>activeChild.kill('SIGKILL'),700);return;}
 if(failProvider){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({type:'error',error:{type:'authentication_error',message:'controlled failure, no real credential'}}));return;}
 const child=filtering&&body.messages.some(m=>m.role==='user'&&Array.isArray(m.content)&&m.content.some(b=>b.type==='text'&&b.text==='Synthetic child must not bind'));
 if(/DSH initiating root\/workspace rejected/.test(JSON.stringify(body.messages))){if(child)childRejectedOnWire=true;else foreignRejectedOnWire=true;}
 let toolName;
 if(child){if(childCalls++===0)toolName='bang_enable';}
 else if(toolCount>0){toolName=filtering?(toolCount===3?'bang_enable':toolCount===2?'acceptance_child':'acceptance_inject'):'bang_enable';toolCount--;}
 const tool=!!toolName;
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
 const send=(event,data)=>res.write(`event: ${event}\ndata: ${JSON.stringify({type:event,...data})}\n\n`);
 send('message_start',{message:{id:'controlled-'+requests,type:'message',role:'assistant',model:'deepseek-flash',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}});
 if(tool){send('content_block_start',{index:0,content_block:{type:'tool_use',id:'enable-'+requests,name:toolName,input:{}}});send('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:'{}'}});}
 else{send('content_block_start',{index:0,content_block:{type:'text',text:''}});send('content_block_delta',{index:0,delta:{type:'text_delta',text:child?'EXCLUDED_CHILD_ANSWER':answer}});}
 send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:tool?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:10}});send('message_stop',{});res.end();
 }catch(error){wireError=error;res.writeHead(400);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const version=await run(executable,[...prefix,'--version']);assert.equal(version.out.trim(),'0.2.1-rc.2');
 const prepare=await run(process.execPath,[fileURLToPath(new URL('../runtime/dsh/prepare.mjs',import.meta.url)),project],undefined);assert.equal(prepare.code,0,prepare.err);
 const prepared=JSON.parse(prepare.out);
 const guard=path.join(root,'scope.mjs');fs.writeFileSync(guard,`export const inject=['agents','tools'];\nexport function apply(ctx){ctx.on('agent/created',({agent})=>{agent.ctx.tools.restrict({allow:['bang_enable','bang_reception_status']});});}\n`);
 // credentials is explicitly disabled even though restrictedOverlay enables its isolated provider.
 const base=restrictedOverlay({model:'deepseek-flash'}).split('- insert:')[0]+`- id: credentials\n  disabled: true\n- id: permission\n  disabled: true\n- id: llm-deepseek\n  config:\n    baseURL: http://127.0.0.1:${server.address().port}\n    apiKeyEnv: DEEPSEEK_API_KEY\n`;
 const overlay=path.join(root,'overlay.yml'),offlineOverlay=path.join(root,'unloaded.yml');fs.writeFileSync(offlineOverlay,base);
 fs.writeFileSync(overlay,base+fs.readFileSync(prepared.overlay,'utf8')+`- insert:\n    - id: controlled-scope\n      name: ${JSON.stringify(guard.replaceAll('\\','/'))}\n`);
 const filterPlugin=path.join(root,'filtering.mjs');fs.writeFileSync(filterPlugin,`import {randomUUID} from 'node:crypto';
export const inject=['agents','tools','sessions'];
export function apply(ctx){
ctx.on('agent/created',({agent})=>{agent.ctx.tools.restrict({allow:['bang_enable','bang_reception_status','acceptance_child','acceptance_inject']});});
const output={schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]};
ctx.tools.register({name:'acceptance_child',description:'Controlled acceptance only',parameters:{type:'object',properties:{}},output,execute:async()=>{const parentAgent=ctx.agents.requireInitiator();const handle=await ctx.agents.create({sessionId:'child-'+randomUUID(),parentAgent,meta:{cwd:process.cwd()},agentOptions:{provider:'deepseek-official',model:'deepseek-flash'}});try{handle.agent.followup({id:randomUUID(),role:'user',source:{kind:'user'},content:[{type:'text',text:'Synthetic child must not bind'}]});await handle.agent.whenIdle();await ctx.sessions.flush(handle.agent.session);return 'child finished';}finally{await handle.dispose();}}});
ctx.tools.register({name:'acceptance_inject',description:'Controlled acceptance only',parameters:{type:'object',properties:{}},output,execute:async()=>{ctx.agents.requireInitiator().inject({id:randomUUID(),role:'user',source:{kind:'bang-context'},content:[{type:'text',text:'EXCLUDED_SELF_CONTEXT'}]});return 'injected';}});
}
`);
 const filterOverlay=path.join(root,'filter.yml');fs.writeFileSync(filterOverlay,base+fs.readFileSync(prepared.overlay,'utf8')+`- insert:\n    - id: controlled-filtering\n      name: ${JSON.stringify(filterPlugin.replaceAll('\\','/'))}\n`);
 const turns=[];
 async function discussion({sessionId,prompt,result,tools=1,loaded=true,cwd=project}){
  toolCount=loaded?tools:-1;answer=result;
  const response=await run(executable,[...prefix,'--profile','headless','--patch',loaded?(filtering?filterOverlay:overlay):offlineOverlay,...(sessionId?['--session-id',sessionId]:[]),'--json','-'],prompt,cwd);
  if(wireError)throw wireError;

  const lines=response.out.trim().split('\n').map(x=>{try{return JSON.parse(x);}catch{return {type:'invalid'};}});
  assert.equal(response.code,0,JSON.stringify({code:response.code,types:lines.map(x=>x.type),stderr:response.err.slice(0,1000)}));assert(lines.some(x=>x.type==='final'));
  turns.push({loaded,code:response.code,toolResults:lines.filter(x=>x.type==='tool_result').length});return lines.find(x=>x.type==='session').sessionId;
 }
 const sessionId=await discussion({prompt:'Enable Bang twice for this current root discussion. Synthetic question one.',result:'Controlled root answer one',tools:2});
 const topics=await call('topics');assert.equal(topics.length,1);const topicId=topics[0].id;
 let status=await call('turn-status',{topicId});assert.equal(status.received,1,'native headless must ingest its durable calling turn before exiting');
 const source=await call('turn-source',{topicId,id:status.pending[0].id});assert.equal(source.user.content,'Enable Bang twice for this current root discussion. Synthetic question one.');assert.equal(source.assistant.content,'Controlled root answer one');
 const initialBinding=(await call('binding-sources',{topicId}))[0];assert.equal(initialBinding.sessionId,sessionId);
 await call('stop');
 await discussion({sessionId,prompt:'Enable Bang again in this same persisted discussion. Synthetic question two.',result:'Controlled root answer two'});
 status=await call('turn-status',{topicId});assert.equal(status.received,2);assert.equal((await call('binding-sources',{topicId}))[0].id,initialBinding.id);
 // The bound host Session completes a turn while the plugin is unloaded, then a new host process re-enables it.
 await discussion({sessionId,prompt:'Synthetic authorized discussion while adapter is unloaded.',result:'Controlled persisted outage answer',loaded:false});
 assert.equal((await call('turn-status',{topicId})).received,2);
 await discussion({sessionId,prompt:'Enable Bang and recover this authorized Session.',result:'Controlled recovery answer'});
 status=await call('turn-status',{topicId});assert.equal(status.received,4);assert.equal(new Set(status.pending.map(x=>x.turnId)).size,4);
 const recovered=await call('turn-source',{topicId,id:status.pending[2].id});assert.equal(recovered.assistant.content,'Controlled persisted outage answer');
 filtering=true;
 await discussion({sessionId,prompt:'Enable Bang, exercise the controlled child, then inject controlled context.',result:'Controlled filtered root answer',tools:3});
 filtering=false;
 status=await call('turn-status',{topicId});assert.equal(status.received,5);assert(childCalls>=2);assert(childRejectedOnWire,'the child tool must report the exact root authorization rejection');
 const filtered=await call('turn-source',{topicId,id:status.pending[4].id});assert.equal(filtered.user.content,'Enable Bang, exercise the controlled child, then inject controlled context.');assert.equal(filtered.assistant.content,'Controlled filtered root answer');assert.doesNotMatch(JSON.stringify(filtered),/EXCLUDED/);assert.equal((await call('binding-sources',{topicId})).length,1);
 // Kill a real host after its model request begins, leaving persisted open-turn events.
 toolCount=-1;crash=true;
 const killed=await run(executable,[...prefix,'--profile','headless','--patch',offlineOverlay,'--session-id',sessionId,'--json','-'],'Synthetic interrupted turn.');assert.notEqual(killed.code,0);crash=false;
 await discussion({sessionId,prompt:'Enable Bang after the interrupted host process.',result:'Controlled post-crash answer'});
 status=await call('turn-status',{topicId});assert.equal(status.received,6);assert(status.gaps.some(g=>g.reason==='interrupted'),'durable interrupted closer must remain an interrupted gap');
 toolCount=-1;failProvider=true;
 const failed=await run(executable,[...prefix,'--profile','headless','--patch',offlineOverlay,'--session-id',sessionId,'--json','-'],'Synthetic failed provider turn.');assert.notEqual(failed.code,0);failProvider=false;
 await discussion({sessionId,prompt:'Enable Bang after a controlled provider error.',result:'Controlled post-error answer'});
 status=await call('turn-status',{topicId});assert.equal(status.received,7);assert(status.gaps.some(g=>g.reason==='error'));
 const foreign=path.join(root,'foreign');fs.mkdirSync(foreign);
 await discussion({prompt:'Enable Bang from an unauthorized different workspace.',result:'Controlled foreign answer',cwd:foreign});
 assert.equal((await call('turn-status',{topicId})).received,7);assert.equal((await call('binding-sources',{topicId})).length,1);assert(foreignRejectedOnWire);
 await call('stop');assert.equal((await call('turn-status',{topicId})).received,7);
 console.log(JSON.stringify({platform:process.platform,actualPinnedDSH:true,version:'0.2.1-rc.2',controlledLoopbackModel:true,externalInference:false,requests,received:7,exactSessionId:sessionId,duplicateEnable:true,persistedHostResume:true,adapterOutageRecovery:true,childRejected:true,injectedContextExcluded:true,interruptedRecovery:true,providerFailureGap:true,foreignWorkspaceRejected:true,turns,project}));
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await call('stop');}
