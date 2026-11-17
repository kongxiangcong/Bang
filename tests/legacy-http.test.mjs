import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createBangMiddleware} from '../prototypes/whiteboard-integration/bridge.mjs';

async function serve(t,options) {
 const middleware=createBangMiddleware(options);
 const server=http.createServer((req,res)=>middleware(req,res,()=>{res.statusCode=404;res.end();}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 return async (route,body)=>{
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/bang/${route}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {status:response.status,value:await response.json()};
 };
}

test('HTTP scene save survives reopen and a failed replacement retains the previous scene',async t=>{
 const projectRoot=await fs.mkdtemp(path.join(os.tmpdir(),'bang-http-'));
 t.after(()=>fs.rm(projectRoot,{recursive:true,force:true}));
 let fail=false;
 const request=await serve(t,{projectRoot,beforeReplace:()=>{if(fail)throw Error('synthetic disk failure')}});
 const {value:session}=await request('session');
 const scene={generation:session.generation,elements:[{id:'manual-note',type:'text',text:'Unmeasured',x:120,y:80}],appliedEventIds:[]};
 assert.equal((await request('scene',scene)).status,200);
 fail=true;
 assert.equal((await request('scene',{...scene,elements:[]})).status,400);
 const reopened=await serve(t,{projectRoot});
 const restored=(await reopened('session')).value;
 assert.deepEqual(restored.scene.elements,scene.elements);
 assert.deepEqual(restored.events,[]); // Legacy scene is deliberately not a semantic event.
 assert.equal((await reopened('scene',{...scene,generation:'stale'})).value.stale,true);
});

test('frozen legacy session opens without losing manual text, deletion or route metadata',async t=>{
 const projectRoot=await fs.mkdtemp(path.join(os.tmpdir(),'bang-legacy-fixture-'));
 t.after(()=>fs.rm(projectRoot,{recursive:true,force:true}));
 const fixture=await fs.readFile(new URL('../baselines/whiteboard-v1/legacy-session.json',import.meta.url));
 await fs.mkdir(path.join(projectRoot,'.bang/sessions'),{recursive:true});
 await fs.writeFile(path.join(projectRoot,'.bang/sessions/pim.json'),fixture);
 const request=await serve(t,{projectRoot});
 const session=(await request('session')).value;
 assert.equal(session.scene.elements[0].text,'人工保留：尚未测量');
 assert.equal(session.scene.elements[1].isDeleted,true);
 assert.equal(session.scene.elements[2].customData.manualRoute,true);
 assert.deepEqual(session.scene.elements[2].points,[[0,0],[80,40]]);
 assert.equal((await request('scene',{generation:session.generation,...session.scene})).status,200);
 const reopened=await serve(t,{projectRoot});
 assert.deepEqual((await reopened('session')).value.scene,session.scene);
});
