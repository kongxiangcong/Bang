import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {generateKeyPairSync,randomUUID,sign,createHash} from 'node:crypto';
import {fixture} from './completed-turns.test.mjs';
import {runtimeOperation} from '../runtime/native/runtime.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<120;n++){const value=await fn();if(value)return value;await delay(50);}throw Error('public condition timed out');}

test('failed old namespace backlog survives immediate source takeover and is processed before identical new turn identities',async()=>{
 let available=false;const seen=[];
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);seen.push(input.completedTurns.map(s=>s.assistant.content));if(!available){res.statusCode=401;res.end('{}');}else res.end(JSON.stringify({version:1,changes:[]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));process.env.BANG_ORGANIZER_ENDPOINT=`http://127.0.0.1:${server.address().port}`;
 const f=await fixture();delete process.env.BANG_ORGANIZER_ENDPOINT;
 try{
  const topicId=f.bound.topic.id;
  await runtimeOperation(f.project,'commit',topicId,{operationId:'manual-before-switch',topic:topicId,baseRevision:0,author:{kind:'manual',id:'user'},intent:'explicit-save',readDependencies:[],operations:[{type:'create-card',card:{id:'stable',text:'manual knowledge',x:10,y:20,width:320,height:120}}]});
  await f.call('turn-ingest',f.signed([f.turn('calling-turn','c1','v1','old first'),f.turn('old-next','c2','v1','old second')]));
  await f.call('organizer-enable',{topicId});await until(async()=> (await f.call('organizer-status',{topicId})).pauseReason==='AUTH_REQUIRED');
  const {workspaceId}=await f.call('start'),keys=generateKeyPairSync('ed25519');
  await f.call('connector-register',{id:'other-namespace',host:'controlled-dsh',versions:['1'],publicKey:keys.publicKey.export({format:'pem',type:'spki'})});
  const proof=(extra={})=>{const now=Date.now(),payload=Buffer.from(JSON.stringify({host:'controlled-dsh',version:'1',instanceId:'fixture',sessionId:'primary-chat',workspaceId,role:'primary',scope:[topicId],turnId:'calling-turn',cursor:'c0',issuedAt:now,expiresAt:now+300000,nonce:randomUUID(),...extra})).toString('base64url');return {connectorId:'other-namespace',payload,signature:sign(null,Buffer.from(payload),keys.privateKey).toString('base64url')};};
  const session=await f.call('session-connect',proof()),preview=await f.call('binding-enable',{...session,topicId});assert.equal(preview.backlog,2);
  const bound=await f.call('binding-enable',{...session,topicId,confirmation:preview.confirmation});assert.equal(bound.status,'bound');
  const batch={sourceId:bound.source.id,previousCursor:'c0',events:[f.turn('calling-turn','c1','v1','new first')]};
  await f.call('turn-ingest',{batch,proof:proof({purpose:'completed-turn-ingestion',sourceId:bound.source.id,batchHash:hash(JSON.stringify(batch))})});
  await assert.rejects(f.call('turn-ingest',f.signed([f.turn('late','c3')],'c2')),/frozen/);
  await f.call('stop');
  const queue=await f.call('turn-status',{topicId});assert.equal(queue.received,3);assert.equal(queue.backlog,3);assert.deepEqual(queue.pending.map(s=>s.turnId),['calling-turn','old-next','calling-turn']);assert.notEqual(queue.pending[0].bindingId,queue.pending[2].bindingId);
  const sources=await f.call('binding-sources',{topicId});assert.equal(sources[0].endCursor,'c2');assert.equal(sources[0].active,false);assert.equal(sources[1].active,true);
  available=true;process.env.BANG_ORGANIZER_ENDPOINT=`http://127.0.0.1:${server.address().port}`;await f.call('stop');await f.call('start');delete process.env.BANG_ORGANIZER_ENDPOINT;
  await f.call('organizer-control',{topicId,action:'retry'});await f.call('organizer-control',{topicId,action:'resume'});await until(async()=> (await f.call('turn-status',{topicId})).organized===3);
  assert.deepEqual(seen,[['old first'],['old first'],['old second'],['new first']]);
  const board=await runtimeOperation(f.project,'state',topicId);assert.equal(board.revision,1);assert.equal(board.canvas.nodes[0].id,'stable');assert.equal(board.canvas.nodes[0].text,'manual knowledge');
 }finally{delete process.env.BANG_ORGANIZER_ENDPOINT;await f.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});


test('takeover freezes reception while an old Organizer attempt waits and preserves its commit eligibility',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const server=createServer(async(req,res)=>{for await(const chunk of req){}entered();await gate;res.end(JSON.stringify({version:1,changes:[]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));process.env.BANG_ORGANIZER_ENDPOINT=`http://127.0.0.1:${server.address().port}`;
 const f=await fixture();delete process.env.BANG_ORGANIZER_ENDPOINT;
 try{
  const topicId=f.bound.topic.id;await f.call('organizer-enable',{topicId});await f.call('turn-ingest',f.signed([f.turn()]));await started;
  const session=await f.call('session-connect',f.proof({sessionId:'replacement'})),preview=await f.call('binding-enable',{...session,topicId});
  const bound=await f.call('binding-enable',{...session,topicId,confirmation:preview.confirmation});assert.equal(bound.status,'bound');assert.equal((await f.call('organizer-status',{topicId})).tasks[0].status,'running');
  await assert.rejects(f.call('turn-ingest',f.signed([f.turn('late','c2')],'c1')),/frozen/);
  release();await until(async()=> (await f.call('turn-status',{topicId})).organized===1);assert.equal((await f.call('binding-sources',{topicId}))[0].backlog,0);
 }finally{release();await f.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
