import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const frontendRoot=path.dirname(fileURLToPath(import.meta.url));
async function fontFiles(dir,prefix=''){
 const entries=await fs.readdir(dir,{withFileTypes:true});
 return (await Promise.all(entries.map(async e=>e.isDirectory()?fontFiles(path.join(dir,e.name),path.join(prefix,e.name)):path.join(prefix,e.name)))).flat();
}
export async function assertAssets(root=frontendRoot){
 const source=path.join(root,'node_modules/@excalidraw/excalidraw/dist/prod/fonts');
 let files;try{files=await fontFiles(source)}catch{throw Error('安装资源不完整，请重新运行安装器；缺失路径：'+source)}
 if(!files.length)throw Error('安装资源不完整，请重新运行安装器；缺失路径：'+source+'（字体目录为空）');
 const required=[...files.map(f=>path.join(root,'public/fonts',f)),path.join(root,'public/elk-worker.min.js')];
 const missing=[];for(const file of required){try{if(!(await fs.stat(file)).isFile()||(await fs.stat(file)).size===0)missing.push(file);await fs.access(file,fs.constants.R_OK)}catch{missing.push(file)}}
 if(missing.length)throw Error('安装资源不完整，请重新运行安装器；缺失路径：'+missing.join(', '));
}
export async function prepareAssets(root=frontendRoot){
 await fs.mkdir(path.join(root,'public'),{recursive:true});
 await fs.cp(path.join(root,'node_modules/@excalidraw/excalidraw/dist/prod/fonts'),path.join(root,'public/fonts'),{recursive:true});
 await fs.copyFile(path.join(root,'node_modules/elkjs/lib/elk-worker.min.js'),path.join(root,'public/elk-worker.min.js'));
 await assertAssets(root);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await prepareAssets();
