import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function locked(file,fn){
 await fs.mkdir(path.dirname(file),{recursive:true});
 const child=spawn('flock',['-x',file,'sh','-c','printf "locked\\n"; cat >/dev/null'],{stdio:['pipe','pipe','pipe']});
 await new Promise((resolve,reject)=>{child.once('error',reject);child.stdout.once('data',resolve);child.once('exit',code=>reject(Error('flock acquisition failed: '+code)))});
 try{return await fn()}finally{child.stdin.end();await new Promise(resolve=>child.once('exit',resolve))}
}
