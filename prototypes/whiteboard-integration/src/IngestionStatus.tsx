import React,{useEffect,useState} from 'react';
import {canvasFetch} from './canvas-client';
type Version={id:string;bindingId:string;turnId:string;versionId:string;current:boolean;processing:string};
type Answer=Version&{history:Version[];user:{content:string};assistant:{content:string}};
type Progress={versions:Version[];received:number;frozen:number;frozenSources:{id:string;turnId:string;versionId:string}[];organized:number;backlog:number;pending:{id:string;turnId:string;versionId:string}[];gaps:{cursor:string;reason:string}[]};
export function IngestionStatus({topic}:{topic:string}){
 const [progress,setProgress]=useState<Progress|null>(null),[error,setError]=useState(''),[answer,setAnswer]=useState<Answer|null>(null);
 async function inspect(id:string){try{const response=await canvasFetch(`/api/canvas/${encodeURIComponent(topic)}/source?id=${encodeURIComponent(id)}`),value=await response.json();if(!response.ok)throw Error(value.error);setAnswer(value);setError('');}catch(e){setError(String(e));}}
 useEffect(()=>{let cancelled=false;
  async function refresh(){try{const response=await canvasFetch(`/api/canvas/${encodeURIComponent(topic)}/turns`);const value=await response.json();if(!response.ok)throw Error(value.error);if(!cancelled){setProgress(value);setError('');}}catch(e){if(!cancelled)setError(String(e));}}
  setAnswer(null);setProgress(null);if(!topic)return;void refresh();const timer=setInterval(refresh,2000);return()=>{cancelled=true;clearInterval(timer);};
 },[topic]);
 if(!topic)return null;
 const visibleHistory=answer?(progress?.versions.filter(v=>v.bindingId===answer.bindingId&&v.turnId===answer.turnId)??[]):[];
 const current=answer&&(visibleHistory.length>=answer.history.length?visibleHistory:answer.history).find(v=>v.current);
 const labels:Record<string,string>={pending:'待整理',organized:'已整理',superseded:'已被新回答替代',frozen:'还原后冻结',skipped:'已跳过'};
 return <section aria-label="完成轮接收状态">
  {error&&<p role="alert">接收状态暂不可用：{error}；上次显示不代表最新状态。</p>}
  {progress?<><p role="status">已接收 {progress.received} · 已整理 {progress.organized} · 积压 {progress.backlog} · 处理缺口 {progress.gaps.length} · 冻结来源 {progress.frozen}</p>
   <p>接收、来源版本与整理进度分别记录；历史回答保留供追溯。</p>
   <details><summary>待整理来源与处理缺口</summary><ul>{progress.pending.map(source=><li key={source.id}>轮次 {source.turnId} / 来源版本 {source.versionId}：待整理</li>)}{progress.frozenSources.map(source=><li key={source.id}>轮次 {source.turnId} / 来源版本 {source.versionId}：还原后冻结，未自动重放</li>)}{progress.gaps.map((gap,i)=><li key={'gap-'+i}>处理缺口 {gap.cursor}：{gap.reason}</li>)}</ul></details>
   <details aria-label="来源版本历史"><summary>来源版本历史</summary><ul>{progress.versions.map(v=><li key={v.id}>来源 {v.bindingId} · 轮次 {v.turnId} · {v.current?'当前回答':'历史回答'} · {labels[v.processing]??v.processing} <button onClick={()=>inspect(v.id)}>查看回答 {v.turnId} / {v.versionId}</button></li>)}</ul></details>
   {answer&&<section aria-label="回答原文"><h3>{current?.id===answer.id?'当前回答':`历史回答 · 当前版本 ${current?.versionId??'未知'}`}</h3><p>轮次 {answer.turnId} / 版本 {answer.versionId} · 仅查看，不切换当前来源。</p><h4>用户原文</h4><pre style={{whiteSpace:'pre-wrap'}}>{answer.user.content}</pre><h4>回答原文</h4><pre style={{whiteSpace:'pre-wrap'}}>{answer.assistant.content}</pre></section>}
  </>:!error&&<p>正在读取接收状态…</p>}
 </section>;
}
