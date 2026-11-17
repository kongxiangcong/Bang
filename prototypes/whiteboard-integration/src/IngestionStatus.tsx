import React,{useEffect,useState} from 'react';
import {canvasFetch} from './canvas-client';
type Progress={received:number;frozen:number;frozenSources:{id:string;turnId:string;versionId:string}[];organized:number;backlog:number;pending:{id:string;turnId:string;versionId:string}[];gaps:{cursor:string;reason:string}[]};
export function IngestionStatus({topic}:{topic:string}){
 const [progress,setProgress]=useState<Progress|null>(null),[error,setError]=useState('');
 useEffect(()=>{let cancelled=false;
  async function refresh(){try{const response=await canvasFetch(`/api/canvas/${encodeURIComponent(topic)}/turns`);const value=await response.json();if(!response.ok)throw Error(value.error);if(!cancelled){setProgress(value);setError('');}}catch(e){if(!cancelled)setError(String(e));}}
  if(!topic)return;void refresh();const timer=setInterval(refresh,2000);return()=>{cancelled=true;clearInterval(timer);};
 },[topic]);
 if(!topic)return null;
 return <section aria-label="完成轮接收状态">
  {error&&<p role="alert">接收状态暂不可用：{error}；上次显示不代表最新状态。</p>}
  {progress?<><p role="status">已接收 {progress.received} · 已整理 {progress.organized} · 积压 {progress.backlog} · 处理缺口 {progress.gaps.length} · 冻结来源 {progress.frozen}</p>
   <p>完成轮已持久排队；整理器尚未启用。</p>
   <details><summary>待整理来源与处理缺口</summary><ul>{progress.pending.map(source=><li key={source.id}>轮次 {source.turnId} / 来源版本 {source.versionId}：待整理</li>)}{progress.frozenSources.map(source=><li key={source.id}>轮次 {source.turnId} / 来源版本 {source.versionId}：还原后冻结，未自动重放</li>)}{progress.gaps.map((gap,i)=><li key={'gap-'+i}>处理缺口 {gap.cursor}：{gap.reason}</li>)}</ul></details>
  </>:!error&&<p>正在读取接收状态…</p>}
 </section>;
}
