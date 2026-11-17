// Explicit actual-binary empty-home check; no model dispatch or existing credentials.
import test from 'node:test';import assert from 'node:assert/strict';import {fixture} from './completed-turns.test.mjs';
test('actual pinned DSH empty-home authorization failure pauses without model dispatch',{skip:!process.env.BANG_DSH_ACTUAL_CONFIG},async()=>{
 process.env.BANG_ORGANIZER_DSH=process.env.BANG_DSH_ACTUAL_CONFIG;
 const f=await fixture();delete process.env.BANG_ORGANIZER_DSH;
 try{await f.call('organizer-configure',{limits:{timeoutMs:15000,callsPerHour:1}});await f.call('organizer-enable',{topicId:f.bound.topic.id});await f.call('turn-ingest',f.signed([f.turn()]));let task;for(let i=0;i<250;i++){task=(await f.call('organizer-status',{topicId:f.bound.topic.id})).tasks[0];if(task?.status==='failed')break;await new Promise(r=>setTimeout(r,100));}assert.equal(task?.error?.code,'AUTH_REQUIRED');assert.equal(task.attempts.length,1);assert.equal(task.process.exitConfirmed,true);assert.equal((await f.call('organizer-status',{topicId:f.bound.topic.id})).pauseReason,'AUTH_REQUIRED');}finally{await f.close();}
});
