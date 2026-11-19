import {isDeepStrictEqual} from 'node:util';
// Layout and visual membership do not establish or revoke evidence.
const semantic=object=>object&&Object.fromEntries(Object.entries(object).filter(([k])=>!['x','y','width','height','regionId','fixed','zIndex','color','fromSide','toSide'].includes(k)));
const objects=state=>[...state.canvas.nodes,...state.canvas.edges];
export function invalidateBasis(before,after,retainedSources=new Set()){
 const byId=new Map(objects(after).map(object=>[object.id,object]));
 const changed=new Set(objects(before).filter(old=>!isDeepStrictEqual(semantic(old),semantic(byId.get(old.id)))).map(n=>n.id));
 for(const id of changed)if(after.metadata[id])after.metadata[id].semanticRevision=after.revision;
 for(const [id,m] of Object.entries(after.metadata))if(m.basis?.status==='needs-review'&&basisUsable(before.metadata[id]))changed.add(id);
 const mark=(id,causes)=>{const m=after.metadata[id];if(!m)return;const previous=m.basis;m.basis={status:'needs-review',revision:after.revision,changedIds:[...new Set([...(previous?.changedIds??[]),...causes])],...(previous?.history?{history:previous.history}:{})};};
 // The old references remain an audit trail, never support for replacement wording.
 for(const id of changed)if(before.metadata[id]?.knowledge)mark(id,[id]);
 let progress=true;while(progress){progress=false;for(const [id,meta] of Object.entries(after.metadata)){
  const causes=(meta.knowledge?.dependencies??[]).filter(dep=>dep!==id&&changed.has(dep));
  if(causes.length&&!retainedSources.has(id)){mark(id,causes);if(!changed.has(id)){changed.add(id);progress=true;}}
 }}
 return after;
}
export const basisUsable=metadata=>metadata?.basis?.status!=='needs-review';
export function parseBasisReview(value,topic){
 if(!value||Object.keys(value).some(k=>!['operationId','baseRevision','id','dependencies','note','authorId'].includes(k))||['operationId','id','note','authorId'].some(k=>typeof value[k]!=='string'||!value[k].trim())||!Number.isSafeInteger(value.baseRevision)||value.baseRevision<0||!Array.isArray(value.dependencies)||value.dependencies.some(id=>typeof id!=='string'||!id||id===value.id)||new Set(value.dependencies).size!==value.dependencies.length)throw Error('Explicit basis review requires identity, baseline, dependencies and review note');
 return {...value,topic,author:{kind:'manual',id:value.authorId},intent:'basis-review'};
}
export function applyBasisReview(current,request){
 if(current.revision!==request.baseRevision)throw Error('Basis review baseline changed');
 const next=structuredClone(current),metadata=next.metadata[request.id];
 if(!metadata||metadata.basis?.status!=='needs-review')throw Error('Object does not need basis review');
 for(const id of request.dependencies)if(!next.metadata[id]||next.canvas.nodes.some(n=>n.id===id&&n.type==='group')||!basisUsable(next.metadata[id]))throw Error('Review dependency missing or needs review');
 next.revision++;
 const {history=[],...prior}=metadata.basis;
 metadata.modifiedRevision=next.revision;
 metadata.basis={status:'reviewed',revision:next.revision,changedIds:[],history:[...history,{...prior,knowledge:metadata.knowledge,review:{authorId:request.authorId,note:request.note,operationId:request.operationId}}]};
 // Review is a human assertion about the current basis, not new discussion evidence.
 metadata.knowledge={conditions:metadata.knowledge?.conditions??[],uncertainty:metadata.knowledge?.uncertainty??'',sources:[],dependencies:request.dependencies};
 return next;
}
export function knowledgeContext(state,limit=Infinity){
 const knowledgeCards=state.canvas.nodes.filter(n=>n.type!=='group'&&basisUsable(state.metadata[n.id])).slice(0,limit),ids=new Set(knowledgeCards.map(n=>n.id));
 const semanticRelations=(state.relations??[]).filter(e=>ids.has(e.fromNode)&&ids.has(e.toNode)&&basisUsable(state.metadata[e.id]));
 const metadata=Object.fromEntries([...knowledgeCards,...semanticRelations].map(n=>{const m=structuredClone(state.metadata[n.id]??{});if(m.basis){const withdrawn=new Set(m.basis.withdrawnSources??[]);if(m.knowledge)m.knowledge.sources=(m.knowledge.sources??[]).filter(s=>!withdrawn.has(s));delete m.basis.withdrawnSources;delete m.basis.history;delete m.source;}return [n.id,m];}));
 const withdrawn=Object.entries(state.metadata).filter(([,m])=>!basisUsable(m)).map(([id,m])=>({id,basis:{status:m.basis.status,revision:m.basis.revision,changedIds:m.basis.changedIds}}));
 return {revision:state.revision,knowledgeCards,visualRegions:state.canvas.nodes.filter(n=>n.type==='group'),semanticRelations,metadata,withdrawn};
}

// Source replacement retains an independently supported assertion. It never rewrites its body.
export function invalidateSourceBasis(before,currentSources){
 const next=structuredClone(before),retained=new Set();let affected=false;
 for(const [id,m] of Object.entries(next.metadata)){
  const sources=m.knowledge?.sources??[];
  if(sources.some(s=>currentSources.has(s))){const withdrawn=sources.filter(s=>!currentSources.has(s));if(withdrawn.length)retained.add(id);if(withdrawn.length&&!isDeepStrictEqual(withdrawn,m.basis?.withdrawnSources)){m.basis={revision:before.revision+1,changedIds:[],...m.basis,status:m.basis?.status??'retained',withdrawnSources:withdrawn};affected=true;}continue;}
  if(sources.length&&basisUsable(m)){m.basis={status:'needs-review',revision:before.revision+1,changedIds:sources,...(m.basis?.history?{history:m.basis.history}:{})};affected=true;}
 }
 if(!affected)return null;
 next.revision++;return invalidateBasis(before,next,retained);
}
