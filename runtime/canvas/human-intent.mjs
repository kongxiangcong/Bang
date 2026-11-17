// Deliberately bounded direct-command grammar. Anything else remains a proposal.
// Only signed primary USER text is parsed; model/assistant text never grants authority.
export function captureHumanIntent(content,state){
 const command=content.trim(),edit=/^(?:请)?将白板卡片「([^「」\n]+)」正文改为「([^「」]+)」[。！]?$/u.exec(command),remove=/^(?:请)?删除白板关系「([^「」\n]+)」[。！]?$/u.exec(command);
 const object=edit?state.canvas.nodes.find(n=>n.id===edit[1]&&n.type==='text'):remove?state.canvas.edges.find(n=>n.id===remove[1]):null;
 if(!object)return {classification:/考虑|假设|如果|也许|是否/.test(content)?'hypothetical':'unspecified'};
 const operation=edit?{type:'edit-card',id:object.id,text:edit[2]}:{type:'delete-relation',id:object.id};
 const fields=edit?['text']:Object.keys(object);
 return {classification:'explicit',baseRevision:state.revision,operation,fieldVersions:Object.fromEntries(fields.map(k=>[k,state.metadata[object.id]?.fields?.[k]?.modifiedRevision??0]))};
}
export function authorizeChange(task,change,current){
 const intent=task.input.completedTurns.find(s=>s.id===change.sources?.[0])?.humanIntent;
 if(intent?.classification!=='explicit'||intent.frozen||Object.entries(intent.operation).some(([k,v])=>change[k]!==v))return false;
 if(Object.entries(intent.fieldVersions).some(([k,v])=>(current.metadata[change.id]?.fields?.[k]?.modifiedRevision??0)!==v))throw Object.assign(Error('Newer human intent supersedes conversational authorization'),{code:'AUTHORIZATION_STALE'});
 return true;
}
