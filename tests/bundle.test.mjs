import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {parse,discover,accepted} from '../runtime/bundle/transcript.mjs';
import {atomic,read,snapshot,commit,empty,key,alive,identity} from '../runtime/bundle/storage.mjs';
import {organize,step} from '../runtime/bundle/engine.mjs';
import {defaults,inputFor,lookup,validateResult} from '../runtime/bundle/context.mjs';
import {locked} from '../runtime/bundle/locks.mjs';
import {createCompanionView} from '../runtime/companion/whiteboard.mjs';
const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const row=(type,payload)=>JSON.stringify({type,payload,timestamp:new Date().toISOString()})+'\n';
const meta=id=>row('session_meta',{id});
const start=id=>row('event_msg',{type:'task_started',turn_id:id});
const user=text=>row('response_item',{type:'message',role:'user',content:[{type:'input_text',text}]});
const end=(id,text='已完成回答')=>row('event_msg',{type:'task_complete',turn_id:id,last_agent_message:text});
const round=(chat,turn,text='讨论')=>parse(meta(chat)+start(turn)+user(text)+end(turn),chat).completed[0];
async function fixture(t){const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'bang-test-'));t.after(()=>fs.rm(workspace,{recursive:true,force:true}));const home=path.join(workspace,'.bang'),dir=path.join(home,'topics','discussion');await fs.mkdir(dir,{recursive:true});const config={workspace,topic:'discussion',budget:{...defaults},enabled:true,pollMs:10};return {workspace,home,dir,config};}
function result(input){const source=input.latestRound.messages[0].id;return {kind:'update',event:{goal:'当前目标',upsertGroups:[{id:'g',title:'目标',goal:'整理',relation:'loose'}],upsertNodes:[{id:'n',groupId:'g',text:input.latestRound.messages[0].text,explanation:'条件：仅在输入范围内',status:'hypothesis',sourceIds:[source]}],upsertRelations:[],removeNodeIds:[],removeRelationIds:[]},discussion:'当前结论，条件：仅在输入范围内。',memory:{goal:'当前目标',conclusions:[{text:'当前结论',conditions:['仅在输入范围内'],sourceIds:[source]}],unresolved:[],nextSteps:['验证']},sourceIds:[],archiveIds:[],archiveNodeIds:[],archiveReason:'',retainedConditions:[],resolvedQuestions:[],archivedConditions:[]};}
const invoke=async(c,h,input)=>result(input);

test('only bound user + explicit completed final, never tools/reasoning/incomplete',()=>{
 const raw=meta('A')+start('t1')+user('问题')+row('response_item',{type:'message',role:'assistant',phase:'analysis',content:[{type:'text',text:'PRIVATE'}]})+row('response_item',{type:'function_call_output',output:'SECRET'})+end('wrong')+end('t1','最终回答')+start('t2')+user('未完成');
 const r=parse(raw,'A');assert.equal(r.completed.length,1);assert.deepEqual(r.completed[0].messages.map(x=>x.text),['问题','最终回答']);assert.equal(r.activeTurnId,'t2');assert.throws(()=>parse(raw,'B'),/不一致/);
});
test('binding requires exact host identity, metadata and active invocation turn',async t=>{
 const {workspace}=await fixture(t),transcript=path.join(workspace,'A.jsonl');await fs.writeFile(transcript,meta('A')+start('old')+user('历史')+end('old')+start('now')+user('调用技能'));
 const b=await discover({transcript},{CODEX_THREAD_ID:'A'});assert.equal(b.startTurnId,'now');assert.equal(b.ignored.length,1);
 await assert.rejects(discover({chatId:'B',transcript},{CODEX_THREAD_ID:'A'}),/不一致/);
 await assert.rejects(discover({transcript,turnId:'old'},{CODEX_THREAD_ID:'A'}),/当前活动轮/);
 await assert.rejects(discover({},{}),/缺少/);
 await fs.appendFile(transcript,end('now'));assert.equal((await accepted(b)).length,1);
});
test('ID discovery rejects ambiguous files and ignores unrelated transcripts',async t=>{
 const {workspace}=await fixture(t),sessions=path.join(workspace,'sessions');await fs.mkdir(sessions);await fs.writeFile(path.join(sessions,'unrelated.jsonl'),'not readable transcript');await fs.writeFile(path.join(sessions,'rollout-A.jsonl'),meta('A')+start('now'));
 const env={CODEX_HOME:workspace,CODEX_THREAD_ID:'A'};assert.equal((await discover({},env)).chatId,'A');await fs.writeFile(path.join(sessions,'second-A.jsonl'),meta('A')+start('now'));await assert.rejects(discover({},env),/2 个/);
});
test('one atomic revision, idempotent retry, sources and view persist',async t=>{
 const {home,dir,config,workspace}=await fixture(t),r=round('A','t1');await organize(home,config,r,invoke);await organize(home,config,r,()=>{throw Error('must not call')});assert.equal((await snapshot(dir)).revision,1);
 const view=createCompanionView({projectRoot:workspace,topic:'discussion'}),s=await view.read();assert.equal(s.events.length,1);assert.equal(s.messages.length,2);await view.saveScene({generation:s.generation,elements:[{id:'manual'}],appliedEventIds:[s.events[0].id],appState:{scrollX:123}});await organize(home,config,round('B','t1'),invoke);assert.equal((await view.read()).scene.appState.scrollX,123);assert.equal((await view.read()).scene.elements[0].id,'manual');
});
test('failed model/write does not advance progress; orphan revision ignored',async t=>{
 const {home,dir,config}=await fixture(t),r=round('A','t1');await assert.rejects(organize(home,config,r,()=>{throw Error('model failure')}),/model failure/);assert.equal((await snapshot(dir)).revision,0);
 await assert.rejects(organize(home,config,r,async(c,h,i)=>{await fs.mkdir(path.join(dir,'head.json'));return result(i)}));await fs.rmdir(path.join(dir,'head.json'));
 await atomic(path.join(dir,'commits','1.json'),{...empty(),revision:1,round:r});assert.equal((await snapshot(dir)).revision,0);await organize(home,config,r,invoke);assert.equal((await snapshot(dir)).revision,1);
});
test('switch drains frozen old queue, retains board, excludes later A, starts at invoking B turn',async t=>{
 const {home,dir,config,workspace}=await fixture(t),a=path.join(workspace,'A.jsonl'),b=path.join(workspace,'B.jsonl');
 await fs.writeFile(a,meta('A')+start('a1')+user('A')+end('a1')+start('a2')+user('未完成 A'));
 await fs.writeFile(b,meta('B')+start('old')+user('不回填')+end('old')+start('b1')+user('调用 B'));
 const target=await discover({transcript:b},{CODEX_THREAD_ID:'B'}),binding={chatId:'A',transcript:a,ignored:[]};const rounds=await accepted(binding);
 await atomic(path.join(home,'bundle.json'),{...config,binding,bindings:[],pendingSwitch:{target,rounds,excludedIncompleteTurnId:'a2',requestedAt:'now'}});
 const control=fn=>locked(path.join(home,'control.lock'),fn);assert.equal(await step(home,control,invoke),'processed');assert.equal(await step(home,control,invoke),'switched');
 await fs.appendFile(a,end('a2'));await fs.appendFile(b,end('b1'));assert.equal(await step(home,control,invoke),'processed');assert.equal(await step(home,control,invoke),'idle');const s=await snapshot(dir);assert.equal(s.revision,2);assert.equal(s.round.chatId,'B');assert.equal(s.board.nodes.length,1);assert.equal((await read(path.join(home,'bundle.json'))).bindings[0].excludedIncompleteTurnId,'a2');
});
test('switch arriving during a model call cannot overwrite state or drop accepted work',async t=>{
 const {home,dir,config,workspace}=await fixture(t),a=path.join(workspace,'A.jsonl');await fs.writeFile(a,meta('A')+start('a1')+user('A')+end('a1'));const binding={chatId:'A',transcript:a,ignored:[]};await fs.writeFile(path.join(workspace,'B.jsonl'),meta('B')+start('b1'));await atomic(path.join(home,'bundle.json'),{...config,binding,bindings:[],pendingSwitch:null});const control=fn=>locked(path.join(home,'control.lock'),fn);
 let release,started;const ready=new Promise(r=>started=r),gate=new Promise(r=>release=r);const work=step(home,control,async(c,h,i)=>{started();await gate;return result(i)});await ready;
 await control(async()=>{const c=await read(path.join(home,'bundle.json'));c.pendingSwitch={target:{chatId:'B',transcript:path.join(workspace,'B.jsonl')},rounds:await accepted(binding),excludedIncompleteTurnId:null};await atomic(path.join(home,'bundle.json'),c)});release();await work;assert.equal(await step(home,control,invoke),'switched');assert.equal((await snapshot(dir)).revision,1);
});
test('context omits full history, includes hand edits; lookup is scoped and bounded',async t=>{
 const {home,dir,config}=await fixture(t);const first=round('A','1','历史原文秘密');await organize(home,config,first,invoke);await atomic(path.join(dir,'view.json'),{elements:[{id:'n',customData:{bangNode:{text:'模型内容'},generatedText:'模型内容',userEdited:true}},{id:'label',type:'text',containerId:'n',originalText:'我的手改'}]});
 const input=await inputFor(config,dir,await snapshot(dir),round('A','2','新问题'));assert.equal(input.userEdits[0].text,'我的手改');assert.ok(!JSON.stringify(input).includes('最终回答'));assert.equal(input.latestRound.turnId,'2');assert.ok(!('history' in input));
 assert.equal((await lookup(dir,{sourceIds:[first.messages[0].id]},10000)).sources[0].text,'历史原文秘密');await assert.rejects(lookup(dir,{sourceIds:['../other-project']},10000),/不属于/);await assert.rejects(lookup(dir,{sourceIds:[first.messages[0].id]},1),/超出/);
});
test('condition loss, unresolved loss, invalid source and growth rejected',async t=>{
 const {home,dir,config}=await fixture(t);const r=round('A','1');await organize(home,config,r,invoke);const state=await snapshot(dir),next=round('A','2'),input=await inputFor(config,dir,state,next),known=new Set([...r.messages,...next.messages].map(m=>m.id));
 let out=result(input);out.memory.conclusions[0].conditions=[];out.discussion='无条件';assert.throws(()=>validateResult(out,state,next,known,defaults),/丢失/);
 out=result(input);out.event.upsertNodes[0].sourceIds=['unknown'];assert.throws(()=>validateResult(out,state,next,known,defaults),/来源/);
 out=result(input);out.discussion='大'.repeat(defaults.stateBytes);assert.throws(()=>validateResult(out,state,next,known,defaults),/超出/);
 state.memory.unresolved=[{text:'旧疑问',conditions:[],sourceIds:[r.messages[0].id]}];assert.throws(()=>validateResult(result(input),state,next,known,defaults),/未解决问题/);
});
test('kernel lock serializes holders and cannot be bypassed by a stale PID file',async t=>{
 const {home}=await fixture(t);let release,entered=false;const gate=new Promise(r=>release=r);const first=locked(path.join(home,'lck'),async()=>{entered=true;await gate});while(!entered)await new Promise(r=>setTimeout(r,5));let secondEntered=false;const second=locked(path.join(home,'lck'),async()=>{secondEntered=true});await new Promise(r=>setTimeout(r,30));assert.equal(secondEntered,false);release();await Promise.all([first,second]);assert.equal(secondEntered,true);assert.equal(await alive(await identity()),true);assert.equal(await alive({pid:process.pid,start:'wrong',boot:'wrong'}),false);
});

test('Linux lifecycle end-to-end: up twice, browser edits, A→B, failure and resume', {timeout:90000},async t=>{
 const workspace=await fs.mkdtemp('/tmp/bang-lifecycle-'),home=path.join(workspace,'.bang'),dir=path.join(home,'topics','discussion'),entry=path.join(root,'runtime/bundle/bang-bundle.mjs'),fake=path.join(workspace,'fake-codex');
 const wait=ms=>new Promise(r=>setTimeout(r,ms));const until=async fn=>{for(let i=0;i<180;i++){if(await fn())return;await wait(100)}throw Error('timeout')};
 const baseEnv={...process.env,CODEX_THREAD_ID:'A',CODEX_SESSION_ID:'A'};delete baseEnv.CODEX_TRANSCRIPT_PATH;delete baseEnv.CODEX_TURN_ID;
 const cli=async(command,chat='A',extra=[])=>JSON.parse((await exec(process.execPath,[entry,command,'--workspace',workspace,...extra],{env:{...baseEnv,CODEX_THREAD_ID:chat,CODEX_SESSION_ID:chat},timeout:25000})).stdout);
 let chrome,ws;const pending=new Map();let seq=0;const runtimeErrors=[];
 t.after(async()=>{for(const name of ['worker.log','server.log']){const text=await fs.readFile(path.join(home,name),'utf8').catch(()=> '');if(text.includes('Error')||text.includes('error'))console.error(name,text)}ws?.close();chrome?.kill();try{await cli('stop');await until(async()=>!await alive(await read(path.join(home,'worker.json'),null))&&!await alive(await read(path.join(home,'server.json'),null)))}finally{await fs.rm(workspace,{recursive:true,force:true})}});
 await fs.writeFile(fake,`#!/usr/bin/env node\nimport fs from 'node:fs/promises';\nconst args=process.argv.slice(2);\nif(args[0]==='features'){console.log('shell_tool stable true');process.exit(0)}\nif(args.includes('--help')){console.log('--ignore-user-config --ephemeral --output-schema');process.exit(0)}\nlet prompt='';for await(const c of process.stdin)prompt+=c;const input=JSON.parse(prompt.split('资料 JSON：\\n')[1]);\nif(input.latestRound.messages[0].text==='fail-once'){const marker=${JSON.stringify(path.join(workspace,'failed-once'))};try{await fs.access(marker)}catch{await fs.writeFile(marker,'yes');process.exit(9)}}\n${result.toString()}\nawait fs.writeFile(args[args.indexOf('-o')+1],JSON.stringify(result(input)));\n`,{mode:0o755});
 const a=path.join(workspace,'A.jsonl'),b=path.join(workspace,'B.jsonl');await fs.writeFile(a,meta('A')+start('a1')+user('首次调用'));await fs.writeFile(b,meta('B')+start('historical')+user('不应回填')+end('historical')+start('b1')+user('跨会话更新'));
 const first=await cli('up','A',['--transcript',a,'--codex',fake]);assert.equal(first.workerRunning,true);assert.equal(first.whiteboardAccessible,true);const owner=await read(path.join(home,'worker.json'));assert.equal((await cli('up','A',['--transcript',a])).whiteboardUrl,first.whiteboardUrl);assert.deepEqual(await read(path.join(home,'worker.json')),owner);
 await fs.appendFile(a,end('a1'));await until(async()=>(await snapshot(dir)).revision===1);
 const profile=path.join(workspace,'chrome');chrome=spawn('/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 let port;await until(async()=>{try{port=Number((await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);return true}catch{return false}});
 const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();ws=new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')runtimeErrors.push(m.params)};
 const cmd=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
 const ev=async expression=>{const r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 await cmd('Runtime.enable');await cmd('Page.enable');await cmd('Page.navigate',{url:first.whiteboardUrl});await until(()=>ev("!!window.bang?.api && bang.snapshot().elements.some(e=>e.customData?.bangNode?.id==='n')"));
 await ev("window.bang.select('n')");await until(()=>ev("!!document.querySelector('#edit')"));await ev("document.querySelector('#edit').focus();document.querySelector('#edit').select()");await cmd('Input.insertText',{text:'用户手改保留'});await ev("document.querySelector('#edit-save').click()");
 await ev("(()=>{const a=bang.api; a.updateScene({elements:a.getSceneElements().map(e=>e.id==='n'?{...e,x:e.x+79,y:e.y+37,version:e.version+1}:e),appState:{scrollX:123,scrollY:456}})})()");await wait(800);await ev('bang.persist()');const before=await ev("(()=>{const n=bang.snapshot().elements.find(e=>e.id==='n'),s=bang.api.getAppState();return {x:n.x,y:n.y,scrollX:s.scrollX,scrollY:s.scrollY}})()");
 const switched=await cli('up','B',['--transcript',b]);assert.equal(switched.whiteboardUrl,first.whiteboardUrl);await until(async()=>(await read(path.join(home,'bundle.json'))).binding.chatId==='B');await fs.appendFile(b,end('b1'));await fs.appendFile(a,start('a2')+user('不得进入')+end('a2'));await until(async()=>(await snapshot(dir)).revision===2);
 await until(()=>ev("!!bang.snapshot().elements.find(e=>e.id==='n')?.customData.pendingNode"));
 assert.equal(await ev("bang.snapshot().elements.find(e=>e.id==='n').customData.bangNode.text"),'用户手改保留');assert.deepEqual(await ev("(()=>{const n=bang.snapshot().elements.find(e=>e.id==='n'),s=bang.api.getAppState();return {x:n.x,y:n.y,scrollX:s.scrollX,scrollY:s.scrollY}})()"),before);
 await ev('bang.persist()');await cmd('Page.reload');await until(()=>ev("!!window.bang?.api && bang.snapshot().elements.some(e=>e.customData?.bangNode?.text==='用户手改保留')"));
 await fs.appendFile(b,start('b2')+user('fail-once')+end('b2'));await until(async()=>!!await read(path.join(home,'failure.json'),null));assert.equal((await snapshot(dir)).revision,2);await until(async()=>!await alive(await read(path.join(home,'worker.json'))));await cli('resume','B');await until(async()=>(await snapshot(dir)).revision===3);assert.equal((await snapshot(dir)).processed.length,3);
 assert.equal(runtimeErrors.length,0);await cli('pause','B');await until(async()=>!await alive(await read(path.join(home,'worker.json'))));await fs.appendFile(b,start('b3')+user('暂停后接续')+end('b3'));await wait(200);assert.equal((await snapshot(dir)).revision,3);await cli('resume','B');await until(async()=>(await snapshot(dir)).revision===4);await cli('stop','B');await until(async()=>!await alive(await read(path.join(home,'worker.json')))&&!await alive(await read(path.join(home,'server.json'))));assert.equal((await cli('resume','B')).whiteboardUrl,first.whiteboardUrl);
});

test('long discussion stays bounded and semantic archive remains retrievable',async t=>{
 const {home,dir,config}=await fixture(t);let largest=0;
 for(let i=0;i<65;i++)await organize(home,config,round('A',String(i),'新问答 '+i),async(c,h,input)=>{largest=Math.max(largest,Buffer.byteLength(JSON.stringify(input)));assert.ok(!('messages' in input));return result(input)});
 assert.ok(largest<10000);const state=await snapshot(dir);assert.equal(state.revision,65);assert.equal(state.board.nodes.length,1);
 const next=round('A','archive');await organize(home,config,next,async(c,h,input)=>{const out=result(input);out.event.upsertNodes=[];out.event.removeNodeIds=['n'];out.archiveNodeIds=['n'];out.archiveReason='阶段完成，保留条件和原文引用';out.memory.conclusions=[];out.discussion='阶段已结束';out.archivedConditions=[{condition:'仅在输入范围内',reason:'该阶段结论已归档；不再作为活动结论',sourceIds:state.board.nodes[0].sourceIds}];return out});
 const after=await snapshot(dir);assert.equal(after.board.nodes.length,0);assert.equal((await lookup(dir,{archiveIds:['66:n']},10000)).archives[0].node.text,'新问答 64');assert.equal((await lookup(dir,{archiveIds:['66:condition:0']},10000)).archives[0].condition,'仅在输入范围内');
});
test('tool-free lookup round trip sends only requested local snippets',async t=>{
 const {home,dir,config}=await fixture(t);const first=round('A','1','特定依据');await organize(home,config,first,invoke);let calls=0;
 await organize(home,config,round('A','2'),async(c,h,input)=>{calls++;const out=result(input);if(calls===1){out.kind='lookup';out.sourceIds=[first.messages[0].id];return out}assert.equal(input.history.sources.length,1);assert.equal(input.history.sources[0].text,'特定依据');return out});assert.equal(calls,2);
});
test('oversized latest round fails before launching model and is not marked processed',async t=>{
 const {home,dir,config}=await fixture(t);await assert.rejects(organize(home,config,round('A','huge','字'.repeat(30000))),/inputBytes/);assert.equal((await snapshot(dir)).revision,0);
});
test('legacy migration preserves view event IDs, source data and board edits',async t=>{
 const {workspace,home,dir}=await fixture(t);const {migrate}=await import('../runtime/bundle/migrate.mjs');const r={...round('A','old'),id:'old'},out=result({latestRound:r});
 await atomic(path.join(dir,'state.json'),{revision:1,ignoredTurnIds:[],processedTurnIds:['old']});await fs.writeFile(path.join(dir,'sources.jsonl'),JSON.stringify(r)+'\n');await fs.writeFile(path.join(dir,'updates.jsonl'),JSON.stringify({turnId:'old',revision:1,event:out.event})+'\n');await fs.writeFile(path.join(dir,'discussion.md'),'旧条件保留');await atomic(path.join(dir,'view.json'),{elements:[{id:'manual'}],appliedEventIds:['companion:1:old']});await migrate(home,{topic:'discussion',chatId:'A'});const view=await createCompanionView({projectRoot:workspace,topic:'discussion'}).read();assert.equal(view.events[0].id,'companion:1:old');assert.equal(view.scene.elements[0].id,'manual');assert.equal((await snapshot(dir)).discussion,'旧条件保留');
});

test('interrupted legacy migration resumes all remaining committed revisions',async t=>{
 const {home,dir}=await fixture(t);const {migrate}=await import('../runtime/bundle/migrate.mjs');
 const first={...round('A','one'),id:'one'},second={...round('A','two'),id:'two'},event=result({latestRound:first}).event;
 await atomic(path.join(dir,'state.json'),{revision:2,ignoredTurnIds:[],processedTurnIds:['one','two']});await fs.writeFile(path.join(dir,'sources.jsonl'),[first,second].map(JSON.stringify).join('\n')+'\n');await fs.writeFile(path.join(dir,'updates.jsonl'),[{turnId:'one',revision:1,event},{turnId:'two',revision:2,event}].map(JSON.stringify).join('\n')+'\n');
 await commit(dir,{...empty(),revision:1,migrated:true,round:{...first,id:key('A\0one')},event,processed:[key('A\0one')]});await migrate(home,{topic:'discussion',chatId:'A'});assert.equal((await snapshot(dir)).revision,2);assert.equal((await snapshot(dir)).processed.length,2);
});

test('turn selection and switch cutoff share the same control lock',async t=>{
 const {home,dir,config,workspace}=await fixture(t),a=path.join(workspace,'A.jsonl');await fs.writeFile(a,meta('A')+start('late')+user('尚未完成'));await fs.writeFile(path.join(workspace,'B.jsonl'),meta('B')+start('b1'));
 await atomic(path.join(home,'bundle.json'),{...config,binding:{chatId:'A',transcript:a,ignored:[]},bindings:[],pendingSwitch:null});const control=fn=>locked(path.join(home,'control.lock'),fn);
 let release,entered;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const switching=control(async()=>{entered();await gate;const c=await read(path.join(home,'bundle.json'));c.pendingSwitch={target:{chatId:'B',transcript:path.join(workspace,'B.jsonl')},rounds:[],excludedIncompleteTurnId:'late'};await atomic(path.join(home,'bundle.json'),c);await fs.appendFile(a,end('late'))});await ready;
 let done=false;const selecting=step(home,control,()=>{throw Error('late old turn must never reach model')}).then(value=>{done=true;return value});await new Promise(r=>setTimeout(r,30));assert.equal(done,false);release();await switching;assert.equal(await selecting,'switched');assert.equal((await snapshot(dir)).revision,0);
});
