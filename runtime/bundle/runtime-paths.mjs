import fs from 'node:fs/promises';
import path from 'node:path';
// Never change HOME/CODEX_HOME: credentials and user config are not copied.
// All disposable runtime paths belong to this project's .bang directory.
export async function runtimeEnv(home,base=process.env){
 await fs.mkdir(home,{recursive:true,mode:0o700});
 const tmp=path.join(home,'tmp'),cache=path.join(home,'cache'),logs=path.join(home,'logs');
 await Promise.all([tmp,cache,logs].map(p=>fs.mkdir(p,{recursive:true,mode:0o700})));
 return {...base,TMPDIR:tmp,TMP:tmp,TEMP:tmp,XDG_CACHE_HOME:cache,
  XDG_STATE_HOME:path.join(home,'state'),npm_config_cache:path.join(cache,'npm'),
  NODE_COMPILE_CACHE:path.join(cache,'node'),CODEX_SQLITE_HOME:path.join(home,'state','codex')};
}

export function codexPaths(home){
 return ['-c','log_dir='+JSON.stringify(path.join(home,'logs','codex')),
  '-c','sqlite_home='+JSON.stringify(path.join(home,'state','codex'))];
}
