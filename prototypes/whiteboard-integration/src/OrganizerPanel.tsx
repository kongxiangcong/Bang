import React,{useEffect,useState} from 'react';
import {canvasFetch} from './canvas-client';
type Task={id:string;status:string;receipt?:{revision:number};error?:{code:string;message:string}};
export function OrganizerPanel({topic}:{topic:string}){
 const [state,setState]=useState<{executor:string;enabled:boolean;tasks:Task[]}|null>(null),[error,setError]=useState('');
 const endpoint='/api/canvas/'+encodeURIComponent(topic);
 useEffect(()=>{if(!topic)return;let active=true;const poll=async()=>{try{const response=await canvasFetch(endpoint+'/organizer'),value=await response.json();if(!response.ok)throw Error(value.error);if(active){setState(value);setError('');}}catch(e){if(active)setError(String(e));}};poll();const timer=setInterval(poll,1000);return()=>{active=false;clearInterval(timer);};},[topic]);
 async function enable(){try{const response=await canvasFetch(endpoint+'/organizer-enable',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),value=await response.json();if(!response.ok)throw Error(value.error);setState(value);}catch(e){setError(String(e));}}
 if(!topic)return null;
 const labels:Record<string,string>={running:'整理中',committed:'已提交','no-change':'无新知识',failed:'整理失败'};
 return <section aria-label="整理器状态" style={{padding:8}}><span>整理器：{state?.executor==='configured'?'已配置':'不可用'} · {state?.enabled?'已启用':'未启用'}</span> <button disabled={state?.enabled||state?.executor!=='configured'} onClick={enable}>启用后台整理</button>{error&&<p role="alert">{error}</p>}<details open><summary>最近整理回执</summary>{state?.tasks.slice(-5).map(t=><p key={t.id}>{labels[t.status]??t.status} · {t.id}{t.receipt&&` · 修订 ${t.receipt.revision}`}{t.error&&` · ${t.error.code} · ${t.error.message}`}</p>)}</details></section>;
}
