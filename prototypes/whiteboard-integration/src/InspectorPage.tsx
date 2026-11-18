import React,{useState} from 'react';

// Keep the whole scene and draft available while bounding the editable controls
// mounted in the inspector. The index passed to children is always board-wide.
export function InspectorPage<T>({items,label,size,children}:{items:T[];label:string;size:number;children:(item:T,index:number)=>React.ReactNode}){
 const [requested,setRequested]=useState(0);
 const pages=Math.max(1,Math.ceil(items.length/size));
 const page=Math.min(requested,pages-1);
 return <>{pages>1&&<nav aria-label={label+'分页'}>
  <button disabled={!page} onClick={()=>setRequested(page-1)}>上一页</button>
  <label>{label}页码 <select value={page} onChange={e=>setRequested(Number(e.target.value))}>
   {Array.from({length:pages},(_,i)=><option key={i} value={i}>{i+1} / {pages}</option>)}
  </select></label>
  <button disabled={page+1>=pages} onClick={()=>setRequested(page+1)}>下一页</button>
 </nav>}{items.slice(page*size,(page+1)*size).map((item,i)=>children(item,page*size+i))}</>;
}
