// Frozen deterministic workload, no randomness or attachment IO.
export function performanceDataset() {
 const nodes=Array.from({length:1000},(_,i)=>({id:`n${i}`,type:'text',text:`Knowledge ${i}: condition remains unmeasured.`,x:(i%25)*320,y:Math.floor(i/25)*180,width:280,height:140}));
 const edges=Array.from({length:3000},(_,i)=>({id:`e${i}`,fromNode:`n${i%1000}`,toNode:`n${(i%1000+1+Math.floor(i/1000))%1000}`}));
 const revisions=Array.from({length:10000},(_,i)=>({revision:i+1,nodeId:`n${i%1000}`,text:`Revision ${i+1}: condition remains unmeasured.`}));
 return {nodes,edges,revisions};
}
