import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {locked} from './locks.mjs';
const exec=promisify(execFile);
const frontend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../prototypes/whiteboard-integration');
export async function ensureFrontend(){
 if(process.platform!=='linux'||Number(process.versions.node.split('.')[0])<22)throw Error('bang-bundle 第一版需要 Linux 和 Node.js 22+（已验证 24）');
 await exec('flock',['--version']);
 await locked(path.join(frontend,'.bundle-install.lock'),async()=>{
  try{await fs.access(path.join(frontend,'node_modules/vite/package.json'))}catch(e){if(e.code!=='ENOENT')throw e;
   try{await exec('npm',['ci','--registry=https://registry.npmjs.org','--cache',path.join(frontend,'.npm-cache'),'--no-audit','--no-fund'],{cwd:frontend,maxBuffer:8*1024*1024})}catch(error){await fs.writeFile(path.join(frontend,'.bundle-install.log'),error.stderr??error.message);throw Error('前端依赖安装失败，见 '+path.join(frontend,'.bundle-install.log'))}
  }
 });
}
