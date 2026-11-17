import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const win=process.platform==='win32';
const compiler=process.env.CC||'gcc';
const source=fileURLToPath(new URL('./lock-host.c',import.meta.url));
const output=fileURLToPath(new URL(win?'./lock-host.exe':'./lock-host',import.meta.url));
const r=spawnSync(compiler,[source,'-O2','-Wall',...(win?['-municode']:[]),'-o',output],{stdio:'inherit'});
if(r.error)throw r.error;process.exitCode=r.status;
