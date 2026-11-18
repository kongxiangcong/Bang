import fs from 'node:fs/promises';
import path from 'node:path';
import {commits,read} from './storage.mjs';
const schema=JSON.parse(await fs.readFile(new URL('./output.schema.json',import.meta.url),'utf8'));
export function validateSchema(value, spec=schema, at='output') {
 if(spec.type==='object'){if(!value||typeof value!=='object'||Array.isArray(value))throw Error(at+' 需要 object');for(const k of spec.required??[])if(!(k in value))throw Error(at+' 缺少 '+k);for(const k of Object.keys(value)){if(!spec.properties[k])throw Error(at+' 未知字段 '+k);validateSchema(value[k],spec.properties[k],at+'.'+k)}}
 else if(spec.type==='array'){if(!Array.isArray(value))throw Error(at+' 需要 array');value.forEach((v,i)=>validateSchema(v,spec.items,at+'['+i+']'))}
 else if(typeof value!==spec.type)throw Error(at+' 类型错误');
 if(spec.enum&&!spec.enum.includes(value))throw Error(at+' 枚举错误');
}
export const defaults={inputBytes:64000,stateBytes:24000,historyBytes:12000,maxNodes:60,maxGroups:12,maxRelations:100,handoffBytes:6000,maxLookups:2,modelTimeoutMs:180000};
export const bytes=v=>Buffer.byteLength(typeof v==='string'?v:JSON.stringify(v));
export function limits(config){const out={...defaults,...config.budget};for(const [k,v] of Object.entries(out))if(!Number.isSafeInteger(v)||v<1)throw Error(`无效预算 ${k}`);if(out.stateBytes+out.historyBytes+4000>=out.inputBytes)throw Error('inputBytes 必须大于 stateBytes + historyBytes + 4000');return out;}
export async function lookup(dir,{sourceIds=[],archiveIds=[]},budget) {
 if(sourceIds.length+archiveIds.length>20)throw Error('每次最多回查 20 个来源/归档');
 const sources=new Map(),archives=new Map();
 for(const c of await commits(dir)){for(const m of c.round?.messages??[])sources.set(m.id,m);for(const a of c.archived??[])archives.set(a.id,a);}
 const result={sources:sourceIds.map(id=>{if(!sources.has(id))throw Error('来源不属于当前项目已接收记录：'+id);return sources.get(id)}),archives:archiveIds.map(id=>{if(!archives.has(id))throw Error('未知项目归档：'+id);return archives.get(id)})};
 if(bytes(result)>budget)throw Error('相关历史片段超出 historyBytes；减少请求数量或显式增大预算，不截断原文');return result;
}
export async function inputFor(config,dir,state,round){
 const view=await read(path.join(dir,'view.json'),null);
 const edits=(view?.elements??[]).filter(e=>!e.isDeleted&&e.customData?.bangNode).flatMap(e=>{
  const m=e.customData,label=view.elements.find(l=>l.type==='text'&&l.containerId===e.id&&!l.isDeleted);
  const text=label?.originalText??m.bangNode.text;
  return m.userEdited||text!==m.generatedText?[{id:e.id,text,userEdited:true,pendingNode:m.pendingNode??null}]:[];
 });
 return {revision:state.revision,board:state.board,memory:state.memory,previousDiscussion:state.discussion,retainedConditions:state.retainedConditions??[],userEdits:edits,latestRound:round,archiveIndex:state.archives.slice(-20),archiveIndexOmitted:Math.max(0,state.archives.length-20),limits:limits(config)};
}
function strings(value,name){if(!Array.isArray(value)||value.some(x=>typeof x!=='string'))throw Error(name+' 必须是字符串数组');}
function string(value,name){if(typeof value!=='string')throw Error(name+' 必须是字符串');}
export function validateResult(result,state,round,knownSources,budget){
 validateSchema(result);
 if(result.kind!=='update')throw Error('预期 update');
 const e=result.event,m=result.memory;
 if(!e||!m)throw Error('缺少 event/memory');
 string(e.goal,'goal');string(result.discussion,'discussion');string(m.goal,'memory.goal');strings(m.nextSteps,'nextSteps');
 for(const k of ['conclusions','unresolved']){if(!Array.isArray(m[k]))throw Error(k+' 必须是数组');for(const item of m[k]){string(item.text,k);strings(item.conditions,'conditions');strings(item.sourceIds,'sourceIds');if(!item.sourceIds.length||item.sourceIds.some(id=>!knownSources.has(id)))throw Error('memory 引用未知来源');}}
 for(const k of ['upsertGroups','upsertNodes','upsertRelations','removeNodeIds','removeRelationIds'])if(!Array.isArray(e[k]))throw Error(k+' 必须是数组');
 strings(e.removeNodeIds,'removeNodeIds');strings(e.removeRelationIds,'removeRelationIds');strings(result.archiveNodeIds,'archiveNodeIds');strings(result.retainedConditions,'retainedConditions');string(result.archiveReason,'archiveReason');
 for(const g of e.upsertGroups){if(!g.id||!g.title||!g.goal||!['loose','hierarchy','radial','sequence'].includes(g.relation))throw Error('无效 group');}
 for(const n of e.upsertNodes){for(const k of ['id','groupId','text','explanation','status'])string(n[k],k);strings(n.sourceIds,'sourceIds');if(!n.id||!n.sourceIds.length||n.sourceIds.some(id=>!knownSources.has(id))||!['open','supported','hypothesis','disputed','rejected'].includes(n.status))throw Error('无效节点或来源');}
 for(const r of e.upsertRelations){for(const k of ['id','from','to','label'])string(r[k],k);if(!r.id)throw Error('无效 relation');}
 for(const list of [e.upsertGroups,e.upsertNodes,e.upsertRelations])if(new Set(list.map(x=>x.id)).size!==list.length)throw Error('重复对象 ID');
 const old=new Map(state.board.nodes.map(n=>[n.id,n]));
 for(const id of result.archiveNodeIds){if(!old.has(id)||!result.archiveReason||!e.removeNodeIds.includes(id))throw Error('归档必须指向旧节点并显式移除、说明原因');}
 // Every still-relevant condition/unresolved item must remain verbatim or have an
 // explicit resolution record. This makes silent truncation fail validation.
 const nextText=JSON.stringify({memory:m,discussion:result.discussion,retainedConditions:result.retainedConditions});
 const conditionArchived=condition=>result.archivedConditions.some(a=>a.condition===condition&&a.reason&&a.sourceIds.length&&a.sourceIds.every(id=>knownSources.has(id)));
 for(const condition of state.retainedConditions??[])if(!nextText.includes(JSON.stringify(condition).slice(1,-1))&&!conditionArchived(condition))throw Error('丢失归档条件：'+condition);
 for(const item of [...state.memory.conclusions,...state.memory.unresolved])for(const condition of item.conditions)if(!nextText.includes(JSON.stringify(condition).slice(1,-1))&&!conditionArchived(condition))throw Error('压缩丢失既有条件：'+condition);
 for(const item of state.memory.unresolved)if(!m.unresolved.some(x=>x.text===item.text)&&!result.resolvedQuestions.some(x=>x.question===item.text&&x.reason&&x.sourceIds?.length&&x.sourceIds.every(id=>knownSources.has(id))))throw Error('未解决问题被丢弃而没有解决依据');
 const update=(old,items,removed=[])=>{const map=new Map(old.map(x=>[x.id,x]));for(const x of items)map.set(x.id,x);for(const id of removed)map.delete(id);return [...map.values()]};
 const nodes=update(state.board.nodes,e.upsertNodes,e.removeNodeIds),ids=new Set(nodes.map(n=>n.id));
 const relations=update(state.board.relations,e.upsertRelations,e.removeRelationIds);
 if(relations.some(r=>!ids.has(r.from)||!ids.has(r.to)))throw Error('关系引用缺失节点；需显式删除失效关系');
 const groups=update(state.board.groups,e.upsertGroups).filter(g=>nodes.some(n=>n.groupId===g.id));
 if(nodes.some(n=>!groups.some(g=>g.id===n.groupId)))throw Error('节点引用缺失区域');
 const board={goal:e.goal,groups,nodes,relations};
 if(nodes.length>budget.maxNodes||groups.length>budget.maxGroups||relations.length>budget.maxRelations)throw Error('活动白板容量超限；需语义压缩或归档');
 if(bytes({board,memory:m,discussion:result.discussion,retainedConditions:result.retainedConditions})>budget.stateBytes)throw Error('活动上下文超出 stateBytes；不会截断后提交');
 // Handoff is structured and bounded independently; no blindly sliced conclusions.
 if(bytes(m)>budget.handoffBytes)throw Error('交接摘要超出 handoffBytes');
 for(const a of result.archivedConditions)if(!conditionArchived(a.condition))throw Error('归档条件缺少依据');
 return {board,archived:[...result.archiveNodeIds.map(id=>({id:`${state.revision+1}:${id}`,node:old.get(id),reason:result.archiveReason,conditions:result.retainedConditions})),...result.archivedConditions.map((a,i)=>({id:`${state.revision+1}:condition:${i}`,...a}))]};
}
