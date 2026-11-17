import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runtimeOperation} from '../runtime/native/runtime.mjs';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {createCanvasMiddleware} from '../runtime/canvas/http.mjs';

async function fixture(){
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'bang-binding-'));
 const call=(command,input)=>runtimeOperation(project,command,undefined,input);
 const {workspaceId}=await call('start'),{privateKey,publicKey}=generateKeyPairSync('ed25519');
 await call('connector-register',{id:'controlled',host:'controlled-host',versions:['1'],publicKey:publicKey.export({format:'pem',type:'spki'})});
 function proof(sessionId,overrides={}){
  const claims={host:'controlled-host',version:'1',instanceId:'test-instance',sessionId,workspaceId,role:'primary',scope:['*'],turnId:'calling-turn',cursor:'cursor-7',issuedAt:Date.now(),expiresAt:Date.now()+300000,nonce:randomUUID(),...overrides};
  const payload=Buffer.from(JSON.stringify(claims)).toString('base64url');
  return {connectorId:'controlled',payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64url')};
 }
 return {project,call,proof,close:async()=>{await call('stop');await fs.rm(project,{recursive:true,force:true});}};
}

test('public topics create one committed board and survive a fresh native owner',async()=>{
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'bang-topics-'));
 const call=(command,input)=>runtimeOperation(project,command,undefined,input);
 try{
  assert.deepEqual(await call('topics'),[]);
  const created=await call('topic-create',{name:'中文专题'});
  assert.equal(created.name,'中文专题');
  assert.deepEqual((await runtimeOperation(project,'state',created.id)).canvas,{nodes:[],edges:[]});
  await call('stop');
  assert.deepEqual(await call('topics'),[created]);
 }finally{await call('stop');await fs.rm(project,{recursive:true,force:true});}
});

test('single named topic auto-selects; HTTP preserves browser capabilities and cannot install its own trust anchor',async()=>{
 const f=await fixture();let server;try{
  const topic=await f.call('topic-create',{name:'现有专题'}),s=await f.call('session-connect',f.proof('single'));
  assert.equal((await f.call('binding-enable',s)).topic.name,'现有专题');
  const restricted=await f.call('session-connect',f.proof('single',{scope:['other']}));
  await assert.rejects(f.call('binding-enable',restricted),/authorized scope/);
  server=createServer(createCanvasMiddleware({project:f.project}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}/api/canvas/session/`;
  assert.equal((await fetch(url+'topics')).status,403);
  const {token}=await (await fetch(url+'bootstrap')).json();const headers={'x-bang-browser-token':token,'Content-Type':'application/json'};
  assert.deepEqual(await (await fetch(url+'topics',{headers})).json(),[topic]);
  assert.notEqual((await fetch(url+'connector-register',{method:'POST',headers,body:JSON.stringify({id:'evil'})})).status,200);
  assert.equal((await fetch(url+'enable',{method:'POST',headers,body:JSON.stringify({verified:true,sessionId:'single'})})).status,400);
  const response=await fetch(url+'connect',{method:'POST',headers,body:JSON.stringify(f.proof('http-current'))});assert.equal(response.status,200);
  const handshake=await response.json();const preview=await (await fetch(url+'enable',{method:'POST',headers,body:JSON.stringify(handshake)})).json();assert.equal(preview.oldSource.sessionId,'single');
 }finally{if(server)await new Promise(r=>server.close(r));await f.close();}
});

test('concurrent verified enables create only one default and require takeover; owner restart invalidates its preview',async()=>{
 const f=await fixture();try{
  const a=await f.call('session-connect',f.proof('race-a')),b=await f.call('session-connect',f.proof('race-b'));
  const results=await Promise.all([f.call('binding-enable',a),f.call('binding-enable',b)]);
  assert.deepEqual(results.map(r=>r.status).sort(),['bound','takeover-required']);
  assert.equal((await f.call('topics')).length,1);
  const loser=results[0].status==='takeover-required'?a:b,preview=results.find(r=>r.status==='takeover-required');
  await f.call('stop');
  await assert.rejects(f.call('binding-enable',{...loser,topicId:preview.topic.id,confirmation:preview.confirmation}),/confirmation stale/);
  assert.equal((await f.call('binding-sources',{topicId:preview.topic.id})).filter(s=>s.active).length,1);
 }finally{await f.close();}
});

test('unverified identities, foreign workspaces, child agents and proof replay cannot authorize a source or store message bodies',async()=>{
 const f=await fixture();try{
  const topic=await f.call('topic-create',{name:'scope'});
  for(const proof of [
   {connectorId:'controlled',sessionId:'forged',verified:true,messageBody:'PRIVATE_SENTINEL'},
   f.proof('wrong-workspace',{workspaceId:'foreign'}),f.proof('unsupported',{version:'999'}),f.proof('child',{role:'subagent'}),f.proof('organizer',{role:'organizer'}),
   f.proof('expired',{issuedAt:Date.now()-600000,expiresAt:Date.now()-1000}),
  ])await assert.rejects(f.call('session-connect',proof),/proof rejected/);
  const forged=f.proof('victim');const claims=JSON.parse(Buffer.from(forged.payload,'base64url'));claims.sessionId='other-session';forged.payload=Buffer.from(JSON.stringify(claims)).toString('base64url');
  await assert.rejects(f.call('session-connect',forged),/proof rejected/);
  await assert.rejects(f.call('binding-enable',{sessionToken:'arbitrary-session',topicId:topic.id,messageBody:'PRIVATE_SENTINEL'}),/capability rejected/);
  const proof=f.proof('restricted',{scope:['not-this-topic'],messageBody:'PRIVATE_SENTINEL'}),session=await f.call('session-connect',proof);
  await assert.rejects(f.call('session-connect',proof),/already used/);
  await assert.rejects(f.call('binding-enable',{...session,topicId:topic.id}),/authorized scope/);
  assert.deepEqual(await f.call('binding-sources',{topicId:topic.id}),[]);
  assert.equal((await f.call('binding-status',session)).status,'unbound');
  assert.doesNotMatch(JSON.stringify(await f.call('binding-status',session)),/PRIVATE_SENTINEL/);
  assert.deepEqual((await runtimeOperation(f.project,'state',topic.id)).canvas,{nodes:[],edges:[]});
 }finally{await f.close();}
});

test('multiple topics require selection; takeover previews old source and requires a fresh explicit confirmation',async()=>{
 const f=await fixture();try{
  const a=await f.call('topic-create',{name:'甲'}),b=await f.call('topic-create',{name:'乙'});
  const first=await f.call('session-connect',f.proof('first')),second=await f.call('session-connect',f.proof('second'));
  assert.equal((await f.call('binding-enable',first)).status,'selection-required');
  const original=await f.call('binding-enable',{...first,topicId:a.id});
  const preview=await f.call('binding-enable',{...second,topicId:a.id,confirm:true});
  assert.equal(preview.status,'takeover-required');assert.equal(preview.oldSource.sessionId,'first');assert.equal(preview.backlog,0);
  assert.equal((await f.call('binding-status',first)).source.id,original.source.id);
  await assert.rejects(f.call('binding-enable',{...second,topicId:b.id,confirmation:preview.confirmation}),/confirmation/);
  const taken=await f.call('binding-enable',{...second,topicId:a.id,confirmation:preview.confirmation});
  assert.equal(taken.source.sessionId,'second');assert.equal((await f.call('binding-status',first)).status,'unbound');
  assert.equal((await f.call('binding-enable',{...second,topicId:b.id})).topic.id,b.id);
  const history=await f.call('binding-sources',{topicId:a.id});
  assert.equal(history.filter(s=>s.active).length,0);assert.equal(history.length,2);assert.equal(history[0].endCursor,'cursor-7');
  const third=await f.call('session-connect',f.proof('third'));
  const fresh=await f.call('binding-enable',{...third,topicId:b.id});
  await f.call('binding-enable',{...second,topicId:a.id});
  await assert.rejects(f.call('binding-enable',{...third,topicId:b.id,confirmation:fresh.confirmation}),/confirmation/);
 }finally{await f.close();}
});

test('verified current session creates default topic, repeats idempotently and persists its calling-turn boundary',async()=>{
 const f=await fixture();try{
  const handshake=await f.call('session-connect',f.proof('exact-session'));
  const bound=await f.call('binding-enable',{sessionToken:handshake.sessionToken});
  assert.equal(bound.status,'bound');assert.equal(bound.topic.name,'默认专题');
  assert.equal(bound.source.sessionId,'exact-session');assert.equal(bound.source.startTurnId,'calling-turn');assert.equal(bound.source.startCursor,'cursor-7');
  const again=await f.call('session-connect',f.proof('exact-session',{turnId:'later-turn',cursor:'cursor-9'}));
  assert.deepEqual(await f.call('binding-enable',{sessionToken:again.sessionToken}),bound);
  assert.equal((await f.call('topics')).length,1);
  await f.call('stop');
  assert.deepEqual(await f.call('binding-status',{sessionToken:again.sessionToken}),bound);
 }finally{await f.close();}
});
