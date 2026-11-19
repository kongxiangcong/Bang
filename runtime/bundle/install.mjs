#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {installFrontend} from './prerequisites.mjs';
import {fileURLToPath} from 'node:url';
await installFrontend();
const here=path.dirname(fileURLToPath(import.meta.url));
const at=process.argv.indexOf('--skills-dir');
const base=at<0?path.join(os.homedir(),'.agents','skills'):path.resolve(process.argv[at+1]);
const destination=path.join(base,'bang-bundle');
const template=await fs.readFile(path.join(here,'legacy-skill.md'),'utf8');
const text=template.replaceAll('@BUNDLE@',JSON.stringify(path.join(here,'bang-bundle.mjs')));
await fs.mkdir(destination,{recursive:true});
const file=path.join(destination,'SKILL.md');
try{const current=await fs.readFile(file,'utf8');if(current!==text)throw Error('目标技能已存在且内容不同；保留原文件，请检查后显式更新：'+file)}catch(e){if(e.code!=='ENOENT')throw e;await fs.writeFile(file,text,{flag:'wx',mode:0o644})}
console.log(JSON.stringify({installed:file,entry:path.join(here,'bang-bundle.mjs'),note:'新会话发现全局技能；需保持 Bang 安装目录可读。没有修改模型配置或凭据。'}));
