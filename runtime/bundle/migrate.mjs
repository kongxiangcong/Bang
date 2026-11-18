import fs from 'node:fs/promises';
import path from 'node:path';
import {read,empty,commit,key,snapshot} from './storage.mjs';
export async function migrate(home,legacy){
 if(!/^[a-zA-Z0-9_-]+$/.test(legacy.topic))throw Error('旧 topic 无效');
 const lock=await fs.readFile(path.join(home,'worker.lock'),'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e});
 if(lock.trim()){const pid=Number(lock.trim());if(!Number.isSafeInteger(pid)||pid<1)throw Error('旧 worker.lock 无效，需要人工检查');try{process.kill(pid,0);throw Error('旧 companion 仍在运行；先用旧入口 stop 并等待完成，不能并发迁移')}catch(e){if(e.code!=='ESRCH')throw e}}
 const dir=path.join(home,'topics',legacy.topic),old=await read(path.join(dir,'state.json'));
 const existing=await snapshot(dir);
 if(existing.revision>old.revision||existing.revision&&!existing.migrated)throw Error('已有非迁移 bundle 修订；拒绝覆盖');
 if(existing.revision===old.revision&&existing.revision>0)return;
 const lines=async name=>(await fs.readFile(path.join(dir,name),'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e})).split('\n').filter(Boolean).map(JSON.parse);
 const updates=(await lines('updates.jsonl')).filter(x=>x.revision<=old.revision),sources=await lines('sources.jsonl');
 if(updates.length!==old.revision||new Set(updates.map(x=>x.revision)).size!==updates.length)throw Error('旧增量有重复或缺失；保留原数据，拒绝自动迁移');
 let state=empty();const discussion=await fs.readFile(path.join(dir,'discussion.md'),'utf8').catch(()=> '');
 for(const u of updates){if(u.revision!==state.revision+1)throw Error('旧 revision 不连续');const raw=sources.find(s=>s.id===u.turnId);if(!raw)throw Error('旧增量缺少原文');const round={...raw,turnId:raw.id,chatId:legacy.chatId,id:key(legacy.chatId+'\0'+raw.id)};
  const merge=(old,items,removed=[])=>{const m=new Map(old.map(x=>[x.id,x]));for(const x of items)m.set(x.id,x);for(const id of removed)m.delete(id);return [...m.values()]};const e=u.event;
  const board={goal:e.goal,groups:merge(state.board.groups,e.upsertGroups),nodes:merge(state.board.nodes,e.upsertNodes,e.removeNodeIds),relations:merge(state.board.relations,e.upsertRelations,e.removeRelationIds)};
  state={...state,revision:u.revision,board,discussion,memory:{goal:board.goal,conclusions:[],unresolved:[],nextSteps:['已迁移旧白板；按现有 discussion 和节点条件继续整理。']},round,event:e,viewEventId:`companion:${u.revision}:${u.turnId}`,processed:[...state.processed,round.id],archived:[],lastCompletedAt:round.completedAt,migrated:true};if(state.revision>existing.revision)await commit(dir,state);
 }
}
