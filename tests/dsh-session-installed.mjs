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
let expectBoard=false, observedRevision, observedAnswer, raceSave, querySeen=false, fallbackSeen=false;
let checkWithdrawal=false;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const server=http.createServer(async(req,res)=>{
 try{
 if(req.url==='/pause-step'){await delay(1800);res.end();return;}
 if(req.url==='/race-save'){await raceSave();res.end();return;}
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
 if(req.url==='/organize'){
  res.end(JSON.stringify({version:1,changes:[{type:'create-card',id:'derived',text:'Prior decision supports deployment',conditions:[],uncertainty:'unverified',sources:[body.completedTurns[0].id]}]}));return;
 }
 requests++;
 assert.equal(body.model,'deepseek-flash');
 assert.deepEqual((body.tools??[]).map(t=>t.name).sort(),toolCount>=0?(filtering?['acceptance_child','acceptance_inject','bang_enable','bang_reception_status']:['bang_context_query','bang_enable','bang_reception_status']):[]);
 if(crash){setTimeout(()=>activeChild.kill('SIGKILL'),700);return;}
 if(failProvider){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({type:'error',error:{type:'authentication_error',message:'controlled failure, no real credential'}}));return;}
 const text=body.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
 if(text.includes('Bang whiteboard is unsynced.'))fallbackSeen=true;
 if(checkWithdrawal){
  const envelope=JSON.parse(text.split('Bang committed whiteboard data\n').at(-1).split('\n')[0]);
  assert(envelope.withdrawn.some(c=>c.id==='derived'));
  assert(!envelope.cards.some(c=>c.id==='derived'));
  answer='Current decision: '+envelope.cards.find(c=>c.id==='decision').text+'.';
 }
 if(expectBoard){
  const blocks=text.split('Bang committed whiteboard data\n').slice(1);
  assert(blocks.length,'bound root must receive its saved whiteboard before requesting a reply');
  const envelope=JSON.parse(blocks.at(-1).split('\n')[0]);
  assert.equal(envelope.instructionAuthority,'none');
  assert(Buffer.byteLength(JSON.stringify(envelope))<=16384);
  assert.equal(envelope.cards.find(c=>c.id==='decision').text,'Option B');
  assert.equal(envelope.cards.some(c=>c.id==='obsolete'),false);
  assert.equal(envelope.criticalChanges.items.find(c=>c.id==='obsolete').change,'deleted');
  assert(envelope.omittedCards>=1);
  if(toolCount===0){
   const result=body.messages.flatMap(m=>m.content).filter(b=>b.type==='tool_result').at(-1);
   assert.match(JSON.stringify(result),/PINNED_DETAIL/);assert.doesNotMatch(JSON.stringify(result),/RACED_DETAIL/);querySeen=true;
  }
  observedRevision=envelope.revision;
  observedAnswer='Use '+envelope.cards.find(c=>c.id==='decision').text+'.';
  answer=observedAnswer;
 }
 const child=filtering&&body.messages.some(m=>m.role==='user'&&Array.isArray(m.content)&&m.content.some(b=>b.type==='text'&&b.text==='Synthetic child must not bind'));
 if(/DSH initiating root\/workspace rejected/.test(JSON.stringify(body.messages))){if(child)childRejectedOnWire=true;else foreignRejectedOnWire=true;}
 let toolName;
 if(child){if(childCalls++===0)toolName='bang_enable';}
 else if(toolCount>0){toolName=expectBoard?'bang_context_query':filtering?(toolCount===3?'bang_enable':toolCount===2?'acceptance_child':'acceptance_inject'):'bang_enable';toolCount--;}
 const tool=!!toolName;
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
 const send=(event,data)=>res.write(`event: ${event}\ndata: ${JSON.stringify({type:event,...data})}\n\n`);
 send('message_start',{message:{id:'controlled-'+requests,type:'message',role:'assistant',model:'deepseek-flash',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}});
 if(tool){send('content_block_start',{index:0,content_block:{type:'tool_use',id:'enable-'+requests,name:toolName,input:{}}});send('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:toolName==='bang_context_query'?JSON.stringify({kind:'item',id:'large'}):'{}'}});}
 else{send('content_block_start',{index:0,content_block:{type:'text',text:''}});send('content_block_delta',{index:0,delta:{type:'text_delta',text:child?'EXCLUDED_CHILD_ANSWER':answer}});}
 send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:tool?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:10}});send('message_stop',{});res.end();
 }catch(error){wireError=error;res.writeHead(400);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const version=await run(executable,[...prefix,'--version']);assert.equal(version.out.trim(),'0.2.1-rc.2');
 const prepare=await run(process.execPath,[fileURLToPath(new URL('../runtime/dsh/prepare.mjs',import.meta.url)),project],undefined);assert.equal(prepare.code,0,prepare.err);
 const prepared=JSON.parse(prepare.out);
 const guard=path.join(root,'scope.mjs');fs.writeFileSync(guard,`export const inject=['agents','tools'];\nexport function apply(ctx){ctx.on('agent/created',({agent})=>{agent.ctx.tools.restrict({allow:['bang_context_query','bang_enable','bang_reception_status']});agent.ctx.on('agent/pre-step',async({messages},next)=>{const prompt=messages.flatMap(m=>m.content).map(b=>b.text).join(' ');let route;if(prompt==='What should we use?')route='race-save';if(prompt==='Enable Bang after the interrupted host process.')route='pause-step';if(route)await fetch('http://127.0.0.1:${server.address().port}/'+route);return next();});});}\n`);
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
  if(expectBoard)assert.equal(lines.find(x=>x.type==='final').text,'Use Option B.');
  if(checkWithdrawal)assert.equal(lines.find(x=>x.type==='final').text,'Current decision: Option D.');
  turns.push({loaded,code:response.code,toolResults:lines.filter(x=>x.type==='tool_result').length});return lines.find(x=>x.type==='session').sessionId;
 }
 const sessionId=await discussion({prompt:'Enable Bang twice for this current root discussion. Synthetic question one.',result:'Controlled root answer one',tools:2});
 const topics=await call('topics');assert.equal(topics.length,1);const topicId=topics[0].id;
 let status=await call('turn-status',{topicId});assert.equal(status.received,1,'native headless must ingest its durable calling turn before exiting');
 const source=await call('turn-source',{topicId,id:status.pending[0].id});assert.equal(source.user.content,'Enable Bang twice for this current root discussion. Synthetic question one.');assert.equal(source.assistant.content,'Controlled root answer one');
 const save=async operations=>{const state=await runtimeOperation(project,'state',topicId);return runtimeOperation(project,'commit',topicId,{topic:topicId,operationId:crypto.randomUUID(),baseRevision:state.revision,author:{kind:'manual',id:'user'},readDependencies:[],intent:'explicit-save',operations});};
 const card=(id,text)=>({type:'create-card',card:{id,text,x:0,y:0,width:300,height:100}});
 await save([card('decision','Option A'),card('obsolete','Use the obsolete premise')]);
 const initialBinding=(await call('binding-sources',{topicId}))[0];assert.equal(initialBinding.sessionId,sessionId);
 await call('stop');
 await discussion({sessionId,prompt:'Enable Bang again in this same persisted discussion. Synthetic question two.',result:'Controlled root answer two'});
 status=await call('turn-status',{topicId});assert.equal(status.received,2);assert.equal((await call('binding-sources',{topicId}))[0].id,initialBinding.id);
 await save([{type:'edit-card',id:'decision',text:'Option B'},{type:'delete-card',id:'obsolete'},card('large','PINNED_DETAIL'+'x'.repeat(18000))]);
 raceSave=()=>save([{type:'edit-card',id:'large',text:'RACED_DETAIL'}]);
 expectBoard=true;
 await discussion({sessionId,prompt:'What should we use?',result:'missing context',tools:1});
 expectBoard=false;
 const receipt=(await runtimeOperation(project,'context-status',topicId)).turns[0];
 assert.equal(receipt.revision,2);assert.equal(receipt.status,'delivered');assert.equal(receipt.modelUse,'unknown');
 assert(querySeen);assert.equal(observedRevision,2);assert.equal(observedAnswer,'Use Option B.');
 // The bound host Session completes a turn while the plugin is unloaded, then a new host process re-enables it.
 await discussion({sessionId,prompt:'Synthetic authorized discussion while adapter is unloaded.',result:'Controlled persisted outage answer',loaded:false});
 assert.equal((await call('turn-status',{topicId})).received,2);
 await discussion({sessionId,prompt:'Enable Bang and recover this authorized Session.',result:'Controlled recovery answer'});
 status=await call('turn-status',{topicId});assert.equal(status.received,5);assert.equal(new Set(status.pending.map(x=>x.turnId)).size,5);
 const recovered=await call('turn-source',{topicId,id:status.pending[3].id});assert.equal(recovered.assistant.content,'Controlled persisted outage answer');
 filtering=true;
 await discussion({sessionId,prompt:'Enable Bang, exercise the controlled child, then inject controlled context.',result:'Controlled filtered root answer',tools:3});
 filtering=false;
 status=await call('turn-status',{topicId});assert.equal(status.received,6);assert(childCalls>=2);assert(childRejectedOnWire,'the child tool must report the exact root authorization rejection');
 const filtered=await call('turn-source',{topicId,id:status.pending[5].id});assert.equal(filtered.user.content,'Enable Bang, exercise the controlled child, then inject controlled context.');assert.equal(filtered.assistant.content,'Controlled filtered root answer');assert.doesNotMatch(JSON.stringify(filtered),/EXCLUDED/);assert.equal((await call('binding-sources',{topicId})).length,1);
 // Kill a real host after its model request begins, leaving persisted open-turn events.
 toolCount=-1;crash=true;
 const killed=await run(executable,[...prefix,'--profile','headless','--patch',offlineOverlay,'--session-id',sessionId,'--json','-'],'Synthetic interrupted turn.');assert.notEqual(killed.code,0);crash=false;
 await discussion({sessionId,prompt:'Enable Bang after the interrupted host process.',result:'Controlled post-crash answer'});
 assert(fallbackSeen);assert.equal((await runtimeOperation(project,'context-status',topicId)).turns[0].status,'unsynced');
 status=await call('turn-status',{topicId});assert.equal(status.received,7);assert(status.gaps.some(g=>g.reason==='interrupted'),'durable interrupted closer must remain an interrupted gap');
 toolCount=-1;failProvider=true;
 const failed=await run(executable,[...prefix,'--profile','headless','--patch',offlineOverlay,'--session-id',sessionId,'--json','-'],'Synthetic failed provider turn.');assert.notEqual(failed.code,0);failProvider=false;
 await discussion({sessionId,prompt:'Enable Bang after a controlled provider error.',result:'Controlled post-error answer'});
 status=await call('turn-status',{topicId});assert.equal(status.received,8);assert(status.gaps.some(g=>g.reason==='error'));
 const foreign=path.join(root,'foreign');fs.mkdirSync(foreign);
 await discussion({prompt:'Enable Bang from an unauthorized different workspace.',result:'Controlled foreign answer',cwd:foreign});
 assert.equal((await call('turn-status',{topicId})).received,8);assert.equal((await call('binding-sources',{topicId})).length,1);assert(foreignRejectedOnWire);
 await call('stop');assert.equal((await call('turn-status',{topicId})).received,8);
 // Exercise actual dependency withdrawal on a synthetic Organizer result.
 await call('stop');process.env.BANG_ORGANIZER_ENDPOINT='http://127.0.0.1:'+server.address().port+'/organize';
 await call('start');delete process.env.BANG_ORGANIZER_ENDPOINT;
 await call('organizer-enable',{topicId});
 for(let i=0;i<120;i++){if((await call('organizer-status',{topicId})).tasks.some(t=>t.status==='committed'))break;await delay(50);}
 await call('organizer-control',{topicId,action:'pause'});
 assert((await runtimeOperation(project,'knowledge-context',topicId)).knowledgeCards.some(c=>c.id==='derived'));
 await save([{type:'edit-card',id:'decision',text:'Option D'}]);
 checkWithdrawal=true;
 await discussion({sessionId,prompt:'Which decision applies now?',tools:0});checkWithdrawal=false;
 console.log(JSON.stringify({platform:process.platform,actualPinnedDSH:true,version:'0.2.1-rc.2',controlledLoopbackModel:true,externalInference:false,requests,querySeen,fallbackSeen,withdrawalVerified:true,observedRevision,observedAnswer,received:8,exactSessionId:sessionId,duplicateEnable:true,persistedHostResume:true,adapterOutageRecovery:true,childRejected:true,injectedContextExcluded:true,interruptedRecovery:true,providerFailureGap:true,foreignWorkspaceRejected:true,turns,project}));
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await call('stop');}
