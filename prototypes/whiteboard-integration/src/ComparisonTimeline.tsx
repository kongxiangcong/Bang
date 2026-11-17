import React,{useState} from 'react';
import {compileCanvas,type Card,type Edge} from '../../../runtime/canvas/contract';
import type {ComparisonIntent,TimelineIntent,StructureIntent} from '../../../runtime/canvas/structures';
const unknown='未知／未提供';
export function ComparisonTimeline({cards,edges,ids,disabled,onChange}:{cards:Card[];edges:Edge[];ids:string[];disabled:boolean;onChange:(cards:Card[])=>void}){
 const [dimensions,setDimensions]=useState<string|null>(null),[fields,setFields]=useState<Record<string,{option?:string;dimension?:string;eventTime?:string}>>({}),[message,setMessage]=useState('');
 const selected=cards.filter(c=>ids.includes(c.id)&&c.type!=='group');
 const existing=selected.find(c=>c.structure?.kind==='comparison')?.structure as ComparisonIntent|undefined;
 const dimText=dimensions??existing?.dimensions.join('\n')??'';
 function field(c:Card,k:'option'|'dimension'|'eventTime'){return fields[c.id]?.[k]??(c.structure&&k in c.structure?(c.structure as unknown as Record<string,string|null>)[k]??'':'');}
 function preview(kind:'comparison'|'timeline'){
  if(!selected.length)return;
  try{const dims=dimText.split('\n').map(s=>s.trim()).filter(Boolean);
   const result=compileCanvas({cards:cards.map(c=>{
    if(!selected.includes(c))return c;
    const base={version:1 as const,rootId:selected[0].id};
    const structure:StructureIntent=kind==='comparison'?{...base,kind,dimensions:dims,option:field(c,'option').trim()||null,dimension:field(c,'dimension').trim()||null}:{...base,kind,eventTime:field(c,'eventTime').trim()||null};return {...c,structure};
   }),edges,previous:{nodes:cards,edges},relayoutIds:selected.map(c=>c.id)});
   onChange(result.nodes);setMessage(`${kind==='comparison'?'对比结构':'事件时间线'}预览：原文与关系保留；空缺保持未知，不选择赢家，不以发言时间替代事件时间。固定位置不动，保存后生效。 ${result.layoutWarnings?.map(w=>w.message).join(' ')??''}`);
  }catch(e){setMessage(String(e));}
 }
 const roots=[...new Set(cards.filter(c=>['comparison','timeline'].includes(c.structure?.kind??'')).map(c=>c.structure!.kind+'\0'+c.structure!.rootId))];
 return <div aria-label="方案对比与事件时间线">
  <label>评价维度（每行一项）<textarea aria-label="评价维度" disabled={disabled} value={dimText} onChange={e=>setDimensions(e.target.value)}/></label>
  {selected.map((c,i)=><fieldset key={c.id} disabled={disabled}><legend>选中卡片 {i+1} · {c.text.slice(0,60)}</legend>{(['option','dimension','eventTime'] as const).map(k=><label key={k}>{k==='option'?'方案':k==='dimension'?'所属评价维度':'事件时间（明确日期或 UTC 时间；未知留空）'}<input aria-label={`${k} ${c.id}`} value={field(c,k)} onChange={e=>setFields({...fields,[c.id]:{...fields[c.id],[k]:e.target.value}})}/></label>)}</fieldset>)}
  <button disabled={disabled||!selected.length} onClick={()=>preview('comparison')}>预览对比结构</button><button disabled={disabled||!selected.length} onClick={()=>preview('timeline')}>预览事件时间线</button>
  <p>对比按明确的方案与维度组织；事件时间线按事件先后排列，不表示等比例时长。模糊时间保留在原文，事件时间留空。</p>{message&&<p role="alert">{message}</p>}
  {roots.map(key=>{const [kind,root]=key.split('\0');const members=cards.filter(c=>c.structure?.rootId===root&&c.structure?.kind===kind),s=members[0]?.structure;if(s?.kind==='comparison'){
   const options=[...new Set(members.map(c=>(c.structure as ComparisonIntent).option))];return <div key={key}><h4>方案对比 · {root}</h4>{members.some(c=>JSON.stringify((c.structure as ComparisonIntent).dimensions)!==JSON.stringify(s.dimensions))&&<p role="status">已保存的评价维度不一致；未匹配内容完整列在表格后，请统一整组维度后保存。</p>}<table><thead><tr><th>评价维度</th>{options.map((o,i)=><th key={i}>{o??'方案未指定'}</th>)}</tr></thead><tbody>{s.dimensions.map(d=><tr key={d}><th>{d}</th>{options.map((o,i)=><td key={i}>{members.filter(c=>{const v=c.structure as ComparisonIntent;return v.option===o&&v.dimension===d}).map(c=><p key={c.id}>{c.text}</p>).length?members.filter(c=>{const v=c.structure as ComparisonIntent;return v.option===o&&v.dimension===d}).map(c=><p key={c.id}>{c.text}</p>):unknown}</td>)}</tr>)}</tbody></table>{members.filter(c=>{const d=(c.structure as ComparisonIntent).dimension;return d===null||!s.dimensions.includes(d)}).map(c=><p key={c.id}>{(c.structure as ComparisonIntent).dimension===null?'评价维度未指定':'维度不一致：'+(c.structure as ComparisonIntent).dimension} · {c.text}</p>)}</div>;
   }if(s?.kind==='timeline')return <div key={key}><h4>事件时间线 · {root}</h4><ol>{[...members].sort((a,b)=>{const x=(a.structure as TimelineIntent).eventTime,y=(b.structure as TimelineIntent).eventTime;return (x?Date.parse(x):Infinity)-(y?Date.parse(y):Infinity)}).map(c=><li key={c.id}>{(c.structure as TimelineIntent).eventTime??'事件时间未知'} · {c.text}</li>)}</ol></div>;return null;})}
 </div>;
}
