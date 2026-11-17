import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runtimeOperation as op} from '../runtime/native/runtime.mjs';
import {runCompanion} from '../runtime/companion/bang.mjs';
import {createCompanionView} from '../runtime/companion/whiteboard.mjs';
import {spawn,spawnSync} from 'node:child_process';

test('public companion output migrates saved manual body, deletion, history and source provenance; stop is explicit',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-migration-companion-'));let destination;
 try{
  const transcript=path.join(p,'source.jsonl'),rows=[{payload:{id:'fixture'}}];await fs.writeFile(transcript,rows.map(JSON.stringify).join('\n')+'\n');
  const common={workspace:p,output:()=>{}};
  await runCompanion(['init','--chat','fixture','--transcript',transcript,'--codex','fixture','--topic','old'],common);
  rows.push({type:'event_msg',payload:{type:'task_started',turn_id:'t1'}},{type:'response_item',payload:{type:'message',role:'user',id:'u1',content:[{type:'input_text',text:'Original question'}]}},{type:'event_msg',payload:{type:'task_complete',turn_id:'t1',last_agent_message:'Original answer'}});await fs.writeFile(transcript,rows.map(JSON.stringify).join('\n')+'\n');
  const event={goal:'test',upsertGroups:[{id:'g',title:'group'}],upsertNodes:[{id:'a',groupId:'g',text:'Generated body',sourceIds:['u1']},{id:'b',groupId:'g',text:'Deleted body',sourceIds:['u1']}],upsertRelations:[],removeNodeIds:[],removeRelationIds:[]};
  await runCompanion(['once'],{...common,spawnModel:(_,args,options)=>spawn(process.execPath,['-e',`require('fs').writeFileSync(process.argv[1],${JSON.stringify(JSON.stringify({event,discussion:'fixture'}))})`,args[args.indexOf('-o')+1]],options)});
  const elements=[{id:'a',type:'rectangle',x:120.5,y:81.2,width:260.4,height:100.2,angle:0.3,boundElements:[{id:'label',type:'text'}],customData:{bangNode:event.upsertNodes[0]}},{id:'label',type:'text',containerId:'a',x:130,y:90,text:'Human body',originalText:'Human body'},{id:'b',type:'rectangle',isDeleted:true,customData:{bangNode:event.upsertNodes[1]}},{id:'r',type:'arrow',points:[[0,0],[12,42],[88,12]],startBinding:{elementId:'a'},endBinding:{elementId:'a'},customData:{bangRelation:{id:'r',from:'a',to:'b'},manualRoute:true}}];
  await createCompanionView({projectRoot:p,topic:'old'}).saveScene({generation:'companion:old',elements,appliedEventIds:['companion:1:t1']});
  // A legacy append-before-state crash may leave byte-identical duplicate rows.
  for(const name of ['sources.jsonl','updates.jsonl']){const file=path.join(p,'.bang/topics/old',name);await fs.appendFile(file,await fs.readFile(file));}
  const request={kind:'companion',topic:'old'};let report=await op(p,'legacy-preflight',undefined,request);assert.equal(report.writerStopped,false);
  assert.equal(report.counts.sources,1);assert.equal(report.counts.events,1);
  await op(p,'legacy-stop',undefined,{...request,confirm:true});report=await op(p,'legacy-preflight',undefined,request);assert.equal(report.writerStopped,true);
  const input={...request,fingerprint:report.fingerprint,confirmOffline:true,confirmReplay:true,confirmUncertainties:true};destination=(await op(p,'legacy-migrate',undefined,input)).projectPath;
  const state=await op(destination,'state','legacy');assert.equal(state.canvas.nodes[0].text,'Human body');assert.equal(state.canvas.nodes.length,1);assert.equal(state.canvas.edges.length,0);assert.equal(state.editorExtras.find(x=>x.id==='r').element.points[1][1],42);
  assert.equal(state.deletionIntents[0].id,'b');assert.equal((await op(destination,'history-preview','legacy',{revision:0})).canvas.nodes[0].text,'Generated body');
  const history=await op(destination,'legacy-history','legacy');assert.equal(history.sources[0].messages[0].text,'Original question');assert.equal(history.uncertainties[0].id,'r');
 }finally{if(destination)await op(destination,'stop');await op(p,'stop');await fs.rm(p,{recursive:true,force:true,maxRetries:5});}
});

test('legacy saved scene preflight is read only; confirmed migration reopens exactly and retries without duplication',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-migration-'));let destination;
 try{
  const bytes=await fs.readFile(new URL('../baselines/whiteboard-v1/legacy-session.json',import.meta.url),'utf8');
  await fs.mkdir(path.join(p,'.bang/sessions'),{recursive:true});await fs.writeFile(path.join(p,'.bang/sessions/pim.json'),bytes);
  const report=await op(p,'legacy-preflight',undefined,{kind:'session'});
  const cli=spawnSync(process.execPath,[new URL('../runtime/canvas/bang.mjs',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),'legacy-preflight','--project',p],{input:JSON.stringify({kind:'session'}),encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).fingerprint,report.fingerprint);
  assert.equal(report.counts.elements,3);assert.equal(report.counts.deleted,1);
  assert.equal(await fs.readFile(path.join(p,'.bang/sessions/pim.json'),'utf8'),bytes);
  await assert.rejects(op(p,'legacy-migrate',undefined,{kind:'session',fingerprint:report.fingerprint}),/confirm/i);
  const input={kind:'session',fingerprint:report.fingerprint,confirmOffline:true,confirmReplay:true,confirmUncertainties:true};
  const obstacle=path.join(p,'.bang/restored-projects');await fs.writeFile(obstacle,'controlled destination obstacle');
  await assert.rejects(op(p,'legacy-migrate',undefined,input),/Unsafe restore/i);assert.equal(await fs.readFile(path.join(p,'.bang/sessions/pim.json'),'utf8'),bytes);await fs.unlink(obstacle);
  const result=await op(p,'legacy-migrate',undefined,input);destination=result.projectPath;
  assert.deepEqual(await op(p,'legacy-migrate',undefined,input),result);
  const state=await op(destination,'state','legacy');assert.deepEqual(state.editorExtras.map(x=>x.element),JSON.parse(bytes).scene.elements);
  assert.equal(state.canvas.nodes.length,0);assert.equal(result.verified,true);
  const backup=await op(destination,'backup-export');assert.equal((await op(destination,'backup-verify',undefined,{backup})).valid,true);assert.equal(backup.payload.tables.topics.length,1);assert.equal(JSON.parse(backup.payload.tables.topics[0].state).legacyMigration.savedScene.elements[1].isDeleted,true);
  await assert.rejects(op(p,'legacy-archive',undefined,{kind:'session',fingerprint:report.fingerprint}),/confirm/i);
  const archived=await op(p,'legacy-archive',undefined,{kind:'session',fingerprint:report.fingerprint,confirmArchive:true});assert.equal(archived.status,'archived-copy');assert.equal(await fs.readFile(path.join(archived.archivePath,'.bang/sessions/pim.json'),'utf8'),bytes);
  assert.deepEqual(await op(p,'legacy-archive',undefined,{kind:'session',fingerprint:report.fingerprint,confirmArchive:true}),archived);
  await op(destination,'stop');assert.deepEqual((await op(destination,'state','legacy')).editorExtras,state.editorExtras);
  assert.equal(await fs.readFile(path.join(p,'.bang/sessions/pim.json'),'utf8'),bytes);
 }finally{if(destination)await op(destination,'stop');await op(p,'stop');await fs.rm(p,{recursive:true,force:true,maxRetries:5});}
});

test('preflight rejects missing provenance and stale or unsafe sources without creating a destination',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-migration-invalid-'));
 try{
  const fixture=JSON.parse(await fs.readFile(new URL('../baselines/whiteboard-v1/legacy-session.json',import.meta.url),'utf8'));const file=path.join(p,'.bang/sessions/pim.json');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(fixture));
  const report=await op(p,'legacy-preflight',undefined,{kind:'session'});
  fixture.events=[{id:'missing',changes:{upsertNodes:[{id:'known',text:'old',sources:[{messageId:'absent'}]}],upsertRelations:[]}}];await fs.writeFile(file,JSON.stringify(fixture));
  await assert.rejects(op(p,'legacy-preflight',undefined,{kind:'session'}),/source/i);
  await assert.rejects(op(p,'legacy-migrate',undefined,{kind:'session',fingerprint:report.fingerprint,confirmOffline:true,confirmReplay:true,confirmUncertainties:true}),/fingerprint/i);
  await assert.rejects(op(p,'legacy-preflight',undefined,{kind:'companion',topic:'../escape'}),/safe/i);
  assert.equal(await fs.stat(path.join(p,'.bang/restored-projects')).then(()=>true,()=>false),false);
 }finally{await op(p,'stop');await fs.rm(p,{recursive:true,force:true,maxRetries:5});}
});

test('saved deletion without an older event cannot be resurrected under the same knowledge identity',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-migration-deletion-'));let destination;
 try{
  const fixture=JSON.parse(await fs.readFile(new URL('../baselines/whiteboard-v1/legacy-session.json',import.meta.url),'utf8'));fixture.scene.elements[1].customData={bangNode:{id:'deleted',text:'Deleted knowledge'}};
  await fs.mkdir(path.join(p,'.bang/sessions'),{recursive:true});await fs.writeFile(path.join(p,'.bang/sessions/pim.json'),JSON.stringify(fixture));
  const report=await op(p,'legacy-preflight',undefined,{kind:'session'});destination=(await op(p,'legacy-migrate',undefined,{kind:'session',fingerprint:report.fingerprint,confirmOffline:true,confirmReplay:true,confirmUncertainties:true})).projectPath;
  await assert.rejects(op(destination,'commit','legacy',{operationId:'resurrect',topic:'legacy',baseRevision:0,author:{kind:'manual',id:'test'},readDependencies:[],intent:'explicit-save',operations:[{type:'create-card',card:{id:'deleted',text:'resurrection',x:0,y:0,width:100,height:100}}]}),/conflict/i);
 }finally{if(destination)await op(destination,'stop');await op(p,'stop');await fs.rm(p,{recursive:true,force:true,maxRetries:5});}
});

