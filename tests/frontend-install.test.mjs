import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
const exec=promisify(execFile);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('runtime frontend check succeeds without any filesystem write permission',async()=>{
 const module=pathToFileURL(path.join(root,'runtime/bundle/prerequisites.mjs')).href;
 await exec(process.execPath,['--permission','--allow-fs-read=*','--input-type=module','-e',`const {checkFrontend}=await import(${JSON.stringify(module)});await checkFrontend();`]);
});
test('incomplete installation reports the missing asset and leaves it untouched',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bang-assets-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const {checkFrontend}=await import('../runtime/bundle/prerequisites.mjs');
 await assert.rejects(checkFrontend(dir),/安装资源不完整，请重新运行安装器.*node_modules/s);
 assert.deepEqual(await fs.readdir(dir),[]);
});
