import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
export const key = value => crypto.createHash('sha256').update(value).digest('hex');
export async function read(file, fallback) { try { return JSON.parse(await fs.readFile(file,'utf8')); } catch(e) { if(e.code==='ENOENT' && fallback!==undefined)return fallback; throw e; } }
export async function atomic(file, value) {
 await fs.mkdir(path.dirname(file),{recursive:true});
 const tmp=file+'.'+crypto.randomUUID()+'.tmp';
 const handle=await fs.open(tmp,'wx',0o600);
 try { await handle.writeFile(JSON.stringify(value,null,2));await handle.sync(); } finally { await handle.close(); }
 await fs.rename(tmp,file);
 const dir=await fs.open(path.dirname(file),'r');try{await dir.sync()}finally{await dir.close()}
}
export async function identity(pid=process.pid) {
 try { const stat=await fs.readFile(`/proc/${pid}/stat`,'utf8');if(stat.slice(stat.lastIndexOf(')')+2).split(' ')[0]==='Z')return null;return {pid,start:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19],boot:(await fs.readFile('/proc/sys/kernel/random/boot_id','utf8')).trim()}; } catch(e) { if(e.code==='ENOENT'||e.code==='ESRCH')return null;throw e; }
}
export async function alive(owner) { const current=owner && await identity(owner.pid);return !!current && current.start===owner.start && current.boot===owner.boot; }
// flock is held by the parent of the Node command for its complete lifetime.
// No stale PID-file deletion can release an active kernel lock.
export async function log(home,type,data={}) { await fs.mkdir(path.join(home,'logs'),{recursive:true});await fs.appendFile(path.join(home,'logs','bundle.jsonl'),JSON.stringify({at:new Date().toISOString(),type,...data})+'\n',{mode:0o600}); }
export const empty = () => ({schema:2,revision:0,board:{goal:'',groups:[],nodes:[],relations:[]},discussion:'',memory:{goal:'',conclusions:[],unresolved:[],nextSteps:[]},processed:[],archives:[],lastCompletedAt:null});
export async function snapshot(dir) {const head=await read(path.join(dir,'head.json'),null);return head ? read(path.join(dir,'commits',head.file)) : empty();}
export async function commits(dir) {const head=await snapshot(dir),out=[];for(let n=1;n<=head.revision;n++)out.push(await read(path.join(dir,'commits',`${n}.json`)));return out;}
export async function commit(dir,value) {
 // Immutable revisions + one durable atomic pointer. Unreferenced revisions may be
 // replaced on retry; readers never consume them before head is advanced.
 await atomic(path.join(dir,'commits',`${value.revision}.json`),value);
 await atomic(path.join(dir,'head.json'),{file:`${value.revision}.json`,revision:value.revision});
}
