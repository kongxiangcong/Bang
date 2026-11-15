import fs from 'node:fs/promises';
import path from 'node:path';

// Consume only revisions committed in state.json, never a partially-written run.
export function createCompanionView({projectRoot,topic}) {
  if(!/^[a-z0-9_-]+$/i.test(topic))throw Error('Invalid topic');
  const directory=path.join(projectRoot,'.bang','topics',topic);
  const generation=`companion:${topic}`;
  const json=async(name,fallback)=>{try{return JSON.parse(await fs.readFile(path.join(directory,name),'utf8'))}catch(e){if(e.code==='ENOENT'&&fallback!==undefined)return fallback;throw e}};
  const lines=async(name)=>{const raw=await fs.readFile(path.join(directory,name),'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e});return raw.split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)]}catch{return []}})};
  return {
    async read(){
      const state=await json('state.json');
      const updates=(await lines('updates.jsonl')).filter(e=>e.revision<=state.revision);
      const included=new Set(updates.map(e=>e.turnId));
      const sources=(await lines('sources.jsonl')).filter(r=>included.has(r.id));
      let nextLine=1;
      const messages=sources.flatMap((r,i)=>r.messages.map(m=>{const startLine=nextLine;const endLine=startLine+m.text.split(/\r?\n/).length-1;nextLine=endLine+1;return {...m,startLine,endLine,round:i+1}}));
      const byId=new Map(messages.map(m=>[m.id,m]));
      const events=updates.map(({turnId,revision,event},i)=>({id:`companion:${revision}:${turnId}`,throughRound:i+1,goal:event.goal,changes:{
        upsertGroups:event.upsertGroups.map(g=>({...g,explanation:g.goal})),
        upsertNodes:event.upsertNodes.map(n=>({...n,text:n.status==='rejected'?`✕ ${n.text.replace(/^✕\s*/, '')}`:n.text,sources:n.sourceIds.map(id=>{const m=byId.get(id);if(!m)throw Error(`Missing source ${id}`);return {messageId:id,startLine:m.startLine,endLine:m.endLine}})})),
        upsertRelations:event.upsertRelations,removeNodeIds:event.removeNodeIds,removeRelationIds:event.removeRelationIds,
      }}));
      return {id:topic,generation,mode:'companion',revision:state.revision,messages,visibleCount:messages.length,roundsPerUpdate:1,events,scene:await json('view.json',null)};
    },
    async saveScene(snapshot){
      if(snapshot.generation!==generation)return {stale:true,generation};
      if(!Array.isArray(snapshot.elements)||!Array.isArray(snapshot.appliedEventIds))throw Error('Invalid scene');
      const {generation:ignored,...scene}=snapshot;
      await fs.writeFile(path.join(directory,'view.json.tmp'),JSON.stringify(scene));
      await fs.rename(path.join(directory,'view.json.tmp'),path.join(directory,'view.json'));
      return {saved:true};
    },
  };
}
