import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const cli=new URL('../runtime/canvas/bang.mjs',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1');
function run(p,c,input){return spawnSync(process.execPath,[cli,c,'--project',p,'--topic','demo'],{input:JSON.stringify(input),encoding:'utf8'});}
const base={x:0,y:0,width:320,height:180};
const patch=cards=>({operationId:'resources',topic:'demo',baseRevision:0,author:{kind:'manual',id:'local-user'},readDependencies:[],intent:'explicit-save',operations:cards.map(card=>({type:'create-card',card}))});
test('file and link cards save as standard Canvas and reopen with complete raw text',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-resources-'));
 try { assert.equal(run(p,'generate',{cards:[]}).status,0);
 const raw='# Markdown\n```js\n<script>alert(1)</script>\n```\n$$x^2$$\n'+'长文'.repeat(5000);
 const cards=[{...base,id:'file',type:'file',file:'docs/missing.pdf'},{...base,id:'link',type:'link',url:'https://example.com/paper'},{...base,id:'raw',text:raw}];
 const saved=run(p,'commit',patch(cards));assert.equal(saved.status,0,saved.stderr);
 const state=JSON.parse(run(p,'state').stdout);assert.equal(state.canvas.nodes[0].type,'file');assert.equal(state.canvas.nodes[0].file,'docs/missing.pdf');assert.equal(state.canvas.nodes[1].url,'https://example.com/paper');assert.equal(state.canvas.nodes[2].text,raw);
 const edit={...patch([]),operationId:'edit-resource',baseRevision:1,operations:[{type:'edit-card',id:'file',text:'document',file:'docs/renamed.pdf'},{type:'edit-card',id:'link',text:'paper',url:'https://example.com/revised'}]};
 assert.equal(run(p,'commit',edit).status,0);const reopened=JSON.parse(run(p,'state').stdout);assert.equal(reopened.canvas.nodes[0].file,'docs/renamed.pdf');assert.equal(reopened.canvas.nodes[1].url,'https://example.com/revised');
 } finally {await fs.rm(p,{recursive:true,force:true});}
});
test('unsafe resources fail atomically without echoing credentials; symlink escapes cannot save',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-resource-safety-')),outside=await fs.mkdtemp(path.join(os.tmpdir(),'bang-outside-'));
 try {run(p,'generate',{cards:[]});await fs.symlink(outside,path.join(p,'escape'),'junction');
 for(const resource of [{type:'link',url:'javascript:alert(1)'},{type:'link',url:'data:text/html,<script>alert(1)</script>'},{type:'link',url:'https://user:secret@example.com/'},{type:'link',url:'https://example.com/?token=secret'},{type:'link',url:'https://example.com/#access_token=secret'},{type:'file',file:'../outside.pdf'},{type:'file',file:'C:/secret.txt'},{type:'file',file:'.env'},{type:'file',file:'escape/missing.pdf'}]){
 const result=run(p,'commit',patch([{...base,id:'unsafe',...resource}]));assert.notEqual(result.status,0,JSON.stringify(resource));assert.ok(!result.stderr.includes('user:secret'));assert.equal(JSON.parse(run(p,'state').stdout).revision,0);
 }
 }finally{await fs.rm(p,{recursive:true,force:true});await fs.rm(outside,{recursive:true,force:true});}
});
test('resource status changes to missing after removal and blocks a replaced junction',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'bang-resource-http-')),outside=await fs.mkdtemp(path.join(os.tmpdir(),'bang-outside-'));let server;
 try{await fs.mkdir(path.join(p,'docs'));await fs.writeFile(path.join(p,'docs/paper.pdf'),'local bytes');run(p,'generate',{cards:[]});assert.equal(run(p,'commit',patch([{...base,id:'file',type:'file',file:'docs/paper.pdf'}])).status,0);
 const http=await import('node:http');const {createCanvasMiddleware}=await import('../runtime/canvas/http.mjs');server=http.createServer(createCanvasMiddleware({project:p}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/api/canvas/demo/resources?id=file`;
 assert.deepEqual(await(await fetch(url)).json(),{status:'available'});await fs.unlink(path.join(p,'docs/paper.pdf'));assert.deepEqual(await(await fetch(url)).json(),{status:'missing'});await fs.rmdir(path.join(p,'docs'));await fs.symlink(outside,path.join(p,'docs'),'junction');assert.deepEqual(await(await fetch(url)).json(),{status:'blocked'});
 }finally{if(server)await new Promise(r=>server.close(r));await fs.rm(p,{recursive:true,force:true});await fs.rm(outside,{recursive:true,force:true});}
});
