import React,{useEffect,useState} from 'react';
import {canvasFetch} from './canvas-client';
type Receipt={turnId:string;revision:number;status:string;modelUse:string};
export function ContextDelivery({topic}:{topic:string}){
 const [receipts,setReceipts]=useState<Receipt[]>([]),[error,setError]=useState(''),[manual,setManual]=useState('');
 const endpoint='/api/canvas/'+encodeURIComponent(topic);
 useEffect(()=>{if(!topic)return;let active=true;setReceipts([]);setManual('');const poll=async()=>{try{const response=await canvasFetch(endpoint+'/context-status'),value=await response.json();if(!response.ok)throw Error(value.error);if(active){setReceipts(value.turns);setError('');}}catch(e){if(active)setError(String(e));}};poll();const timer=setInterval(poll,1000);return()=>{active=false;clearInterval(timer);};},[topic]);
 async function read(){try{const response=await canvasFetch(endpoint+'/knowledge-context'),value=await response.json();if(!response.ok)throw Error(value.error);setManual(JSON.stringify(value,null,2));}catch(e){setError(String(e));}}
 if(!topic)return null;
 const labels:Record<string,string>={pending:'等待递交',delivered:'已递交',unsynced:'未同步',frozen:'恢复后冻结'};
 return <section aria-label="上下文递交" style={{padding:8}}><details open><summary>主对话上下文递交</summary>{receipts.length===0&&<p>尚无递交回执</p>}{receipts.slice(0,5).map(r=><p key={r.turnId}>{labels[r.status]??r.status} · 修订 {r.revision} · 发言 {r.turnId} · 模型实际使用：未知</p>)}<p>发言开始固定白板版本，此后的保存进入下一轮。未同步时可继续对话并手动读取。当前真实宿主自动回送尚未验收。</p><button onClick={read}>手动读取当前白板上下文</button>{manual&&<><p>手动资料：当前已提交版本；不表示已自动递交。</p><pre aria-label="手动上下文资料" style={{maxHeight:200,overflow:'auto',whiteSpace:'pre-wrap'}}>{manual}</pre></>}{error&&<p role="alert">{error}</p>}</details></section>;
}
