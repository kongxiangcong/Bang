import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {prepareAssets,assertAssets} from '../prototypes/whiteboard-integration/prepare.mjs';
import {runtimeEnv,codexPaths} from '../runtime/bundle/runtime-paths.mjs';
test('installer prepares assets; read-only check reports each missing file without repairing',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bang-assets-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const fonts=path.join(root,'node_modules/@excalidraw/excalidraw/dist/prod/fonts/Example');await fs.mkdir(fonts,{recursive:true});await fs.writeFile(path.join(fonts,'test.woff2'),'font');
 const elk=path.join(root,'node_modules/elkjs/lib');await fs.mkdir(elk,{recursive:true});await fs.writeFile(path.join(elk,'elk-worker.min.js'),'worker');
 await assert.rejects(assertAssets(root),/安装资源不完整，请重新运行安装器.*test.woff2/);await assert.rejects(fs.access(path.join(root,'public')));
 await prepareAssets(root);await assertAssets(root);
 for(const relative of ['fonts/Example/test.woff2','elk-worker.min.js']){const file=path.join(root,'public',relative);await fs.unlink(file);await assert.rejects(assertAssets(root),e=>e.message.includes('安装资源不完整，请重新运行安装器')&&e.message.includes(file));await assert.rejects(fs.access(file));await prepareAssets(root)}
});
test('runtime paths are project isolated, private, and retain authentication home',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bang-paths-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const a=path.join(root,'a/.bang'),b=path.join(root,'b/.bang'),base={HOME:'/existing',CODEX_HOME:'/existing/codex',TMPDIR:'/installation',NODE_COMPILE_CACHE:'/installation'};
 const ea=await runtimeEnv(a,base),eb=await runtimeEnv(b,base);
 for(const key of ['TMPDIR','TMP','TEMP','XDG_CACHE_HOME','XDG_STATE_HOME','npm_config_cache','NODE_COMPILE_CACHE','CODEX_SQLITE_HOME']){assert.ok(ea[key].startsWith(a+'/'));assert.ok(eb[key].startsWith(b+'/'))}
 assert.equal(ea.HOME,base.HOME);assert.equal(ea.CODEX_HOME,base.CODEX_HOME);assert.equal((await fs.stat(a)).mode&0o777,0o700);
 assert.ok(codexPaths(a).some(x=>x.startsWith('log_dir=')));
});
