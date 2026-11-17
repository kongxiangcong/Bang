import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {locked} from './locks.mjs';
import {prepareAssets,assertAssets} from '../../prototypes/whiteboard-integration/prepare.mjs';
const exec=promisify(execFile);
const dependencies=['vite','@vitejs/plugin-react','@tailwindcss/vite','react','react-dom','elkjs','@excalidraw/excalidraw'];
const frontend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../prototypes/whiteboard-integration');
async function checkPlatform(){
 if(process.platform!=='linux'||Number(process.versions.node.split('.')[0])<22)throw Error('bang-bundle 第一版需要 Linux 和 Node.js 22+（已验证 24）');
 await exec('flock',['--version']);
}
export async function installFrontend(){
 await checkPlatform();
 await locked(path.join(frontend,'.bundle-install.lock'),async()=>{
  try{await Promise.all(dependencies.map(d=>fs.access(path.join(frontend,'node_modules',d,'package.json'))))}catch(e){if(e.code!=='ENOENT')throw e;
   try{await exec('npm',['ci','--registry=https://registry.npmjs.org','--cache',path.join(frontend,'.npm-cache'),'--no-audit','--no-fund'],{cwd:frontend,maxBuffer:8*1024*1024})}catch(error){await fs.writeFile(path.join(frontend,'.bundle-install.log'),error.stderr??error.message);throw Error('前端依赖安装失败，见 '+path.join(frontend,'.bundle-install.log'))}
  }
  await prepareAssets();
 });
}

export async function checkFrontend(directory=frontend){
 for(const dependency of dependencies){
  const file=path.join(directory,'node_modules',dependency,'package.json');
  try{await fs.access(file)}catch{throw Error('安装资源不完整，请重新运行安装器；缺失路径：'+file)}
 }
 await assertAssets(directory);
}

export async function assertFrontend(){await checkPlatform();await checkFrontend()}
