import React,{useState} from 'react';
import type {Card} from '../../../runtime/canvas/contract';
import {layoutCards} from '../../../runtime/canvas/layout';
export function LayoutControls({cards,disabled,onChange}:{cards:Card[];disabled:boolean;onChange:(cards:Card[])=>void}){
 const [selected,setSelected]=useState<string[]>([]),[warning,setWarning]=useState('');
 const ids=selected.filter(id=>cards.some(c=>c.id===id));
 function update(values:Partial<Card>){onChange(cards.map(c=>ids.includes(c.id)?{...c,...values}:c));}
 return <section aria-label="布局与讨论区域"><h3>布局与讨论区域</h3>{cards.map((c,i)=><label key={c.id} style={{display:'block'}}><input type="checkbox" aria-label={`布局选择 ${i+1}`} disabled={disabled} checked={ids.includes(c.id)} onChange={e=>setSelected(e.target.checked?[...ids,c.id]:ids.filter(id=>id!==c.id))}/>卡片 {i+1} · {c.regionId?'已分组':'未分组'} · {c.fixed?'位置固定':'可移动'}</label>)}<button disabled={disabled||!ids.length} onClick={()=>update({regionId:crypto.randomUUID()})}>选区视觉分组</button><button disabled={disabled||!ids.length} onClick={()=>update({regionId:null})}>解除选区分组</button><button disabled={disabled||!ids.length} onClick={()=>update({fixed:true})}>固定选区位置</button><button disabled={disabled||!ids.length} onClick={()=>update({fixed:false})}>解除位置固定</button><button disabled={disabled||!ids.length} onClick={()=>{const top=Math.max(0,...cards.map((c,i)=>c.zIndex??i))+1;onChange(cards.map((c,i)=>ids.includes(c.id)?{...c,zIndex:top+i}:c));}}>选区置顶</button><button disabled={disabled||!ids.length} onClick={()=>{const result=layoutCards(cards,cards,ids);onChange(result.nodes);setWarning(result.warnings.map(w=>w.message).join(' '));}}>显式重新布局选区</button><p>视觉分组不新增知识关系；重新布局仅授权所选卡片移动。</p>{warning&&<p role="alert">{warning}</p>}</section>;
}
