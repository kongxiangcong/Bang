import fs from 'node:fs';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const [mode,dir]=process.argv.slice(2);
const level=Number(process.argv[4]??0);
let descendant;
const stopped=()=>{descendant?.stdin.end();fs.writeFileSync(path.join(dir,`stop-${level}`),'cooperative-stop-observed');if(mode==='graceful')process.exit(0);};
if(mode!=='success'){process.on('SIGTERM',stopped);process.stdin.on('end',stopped);setInterval(()=>{},1000);}
function tree(){fs.writeFileSync(path.join(dir,`pid-${level}`),String(process.pid));if(level<2)descendant=spawn(process.execPath,[fileURLToPath(import.meta.url),mode,dir,String(level+1)],{stdio:['pipe','ignore',fs.openSync(path.join(dir,'child-errors'),'a')]}).on('error',e=>fs.appendFileSync(path.join(dir,'child-errors'),String(e))).on('exit',(c,s)=>fs.appendFileSync(path.join(dir,'child-errors'),String(c)+' '+String(s)));}
if(level){tree();process.stdin.resume();}else{
const lines=createInterface({input:process.stdin});
lines.once('line',line=>{const input=JSON.parse(line);fs.writeFileSync(path.join(dir,'observed.json'),JSON.stringify({secret:process.env.BANG_TEST_SECRET,policy:process.env.BANG_EXECUTOR_POLICY,cwd:process.cwd(),argv:process.argv.join(' '),pid:process.pid}));const output=()=>process.stdout.write(JSON.stringify({version:1,changes:[{type:'create-card',id:'native',text:input.completedTurns[0].assistant.content,conditions:[],uncertainty:'',sources:[input.completedTurns[0].id]}]}));if(mode==='success'){output();process.exit(0);}tree();process.stdin.on('end',output);});
}



