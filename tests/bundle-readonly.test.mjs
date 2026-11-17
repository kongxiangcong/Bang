// Synthetic host/model integration only. Real current-host turn acceptance is separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const row=(type,payload)=>JSON.stringify({type,payload})+'\n';
async function entries(root){const result=[];async function visit(dir){for(const name of await fs.readdir(dir)){const file=path.join(dir,name),s=await fs.lstat(file);result.push([path.relative(root,file),s.size,s.mtimeMs,s.mode]);if(s.isDirectory())await visit(file)}}await visit(root);return result.sort((a,b)=>a[0].localeCompare(b[0]));}
async function permissions(root,writable){for(const name of await fs.readdir(root)){const file=path.join(root,name),s=await fs.lstat(file);if(s.isSymbolicLink())continue;if(s.isDirectory())await permissions(file,writable);await fs.chmod(file,writable?s.mode|0o200:s.mode&~0o222)}await fs.chmod(root,writable?0o700:0o500)}
test('read-only installed bundle supports isolated projects and repeated up without installation writes',{timeout:120000},async t=>{
 assert.notEqual(process.getuid(),0,'run this regression as a non-root user');
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'bang-readonly-')),install=path.join(base,'install');
 await fs.mkdir(install);for(const dir of ['runtime','prototypes'])await fs.cp(path.join(source,dir),path.join(install,dir),{recursive:true,filter:file=>!['.npm-cache','.vite','.vite-temp','evidence'].includes(path.basename(file))&&file!==path.join(source,'prototypes/whiteboard-integration/dist')});
 const entry=path.join(install,'runtime/bundle/bang-bundle.mjs'),projects=[];
 const cli=async(p,command,extra=[])=>JSON.parse((await exec(process.execPath,[entry,command,'--workspace',p,...extra],{env:{...process.env,CODEX_THREAD_ID:'fixture',CODEX_SESSION_ID:'fixture',CODEX_TURN_ID:'turn1',CODEX_TRANSCRIPT_PATH:path.join(p,'fixture.jsonl')},timeout:20000})).stdout);
 t.after(async()=>{if(process.env.BANG_KEEP_READONLY_FIXTURE==='1'){console.log('Fixture retained:',base);return}for(const p of projects)await cli(p,'stop').catch(()=>{});await new Promise(r=>setTimeout(r,1500));await permissions(install,true);await fs.rm(base,{recursive:true,force:true})});
 await permissions(install,false);await assert.rejects(fs.writeFile(path.join(install,'must-not-write'),'x'),e=>['EACCES','EROFS'].includes(e.code));const before=await entries(install);
 for(const name of ['project-a','project-b']){
  const p=path.join(base,name);await fs.mkdir(p);projects.push(p);const fake=path.join(p,'fake-codex');
  await fs.writeFile(fake,"#!/usr/bin/env node\nif(process.argv.includes('--help'))console.log('--ignore-user-config --ephemeral --output-schema');else if(process.argv.includes('features'))console.log('shell_tool stable true');else process.exit(91);\n",{mode:0o700});
  await fs.writeFile(path.join(p,'fixture.jsonl'),row('session_meta',{id:'fixture'})+row('event_msg',{type:'task_started',turn_id:'turn1'}));
  const first=await cli(p,'up',['--codex',fake]);for(const key of ['initialized','boundToCurrentHost','workerRunning','whiteboardAccessible'])assert.equal(first[key],true);
  const owner=await fs.readFile(path.join(p,'.bang/worker.json'),'utf8'),server=await fs.readFile(path.join(p,'.bang/server.json'),'utf8');const again=await cli(p,'up');assert.equal(again.whiteboardUrl,first.whiteboardUrl);assert.equal(await fs.readFile(path.join(p,'.bang/worker.json'),'utf8'),owner);assert.equal(await fs.readFile(path.join(p,'.bang/server.json'),'utf8'),server);
  for(const url of ['/','/src/main.tsx','/src/scene.ts','/elk-worker.min.js','/fonts/Liberation/LiberationSans-Regular.woff2']){const response=await fetch(new URL(url,first.whiteboardUrl));assert.equal(response.status,200,url);assert.ok((await response.arrayBuffer()).byteLength>0)}
  assert.ok((await fs.readdir(path.join(p,'.bang/cache/vite'))).length>0);console.log(JSON.stringify({project:p,...first}));
 }
 assert.notEqual((await cli(projects[0],'status')).whiteboardUrl,(await cli(projects[1],'status')).whiteboardUrl);
 assert.deepEqual(await entries(install),before,'installation content sizes, mtimes and permissions remain unchanged');
});
