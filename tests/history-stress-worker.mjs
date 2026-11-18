// Controlled native model boundary. No real model, tools, credentials or network.
import fs from 'node:fs';
import {createInterface} from 'node:readline';
const lines=createInterface({input:process.stdin});
lines.once('line',line=>{
 const input=JSON.parse(line),last=input.completedTurns.at(-1);
 fs.writeFileSync('transient-cache.bin',Buffer.alloc(4096,7));
 process.stdout.write(JSON.stringify({version:1,changes:[{type:'create-card',id:'stress-'+last.turnId,text:'Controlled batch ending '+input.completedTurns.at(-1).turnId,conditions:['Synthetic capacity workload; not model quality'],uncertainty:'controlled',sources:[last.id]}],usage:{inputTokens:0,outputTokens:0}}));
 process.exit(0);
});
