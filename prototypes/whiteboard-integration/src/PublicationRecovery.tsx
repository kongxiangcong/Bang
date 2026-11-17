import React,{useEffect,useState} from 'react';
import {canvasFetch} from './canvas-client';
type Recovery={status:string;reason?:string;revision?:number;observedHash?:string|null;pendingOperation?:string|null};
export function PublicationRecovery({endpoint,trigger}:{endpoint:string;trigger:string}){
 const [status,setStatus]=useState<Recovery|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function inspect(){try{const response=await canvasFetch(endpoint+'/recovery-status');if(response.ok)setStatus(await response.json());}catch{ /* Existing connection error remains visible in the caller. */ }}
 useEffect(()=>{if(trigger)void inspect();},[endpoint,trigger]);
 if(status?.status!=='recovery-required')return null;
 async function recover(){setBusy(true);setError('');try{const response=await canvasFetch(endpoint+'/recover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedHash:status!.observedHash})});const result=await response.json();if(!response.ok)throw Error(result.error);location.reload();}catch(e){setError(String(e));await inspect();}finally{setBusy(false);}}
 return <section role="alert" aria-label="白板保存恢复"><h2>白板需要恢复</h2><p>原因：{status.reason}。当前文件不会作为完整提交读取。恢复会先保留当前文件，再{status.pendingOperation?'完成中断的保存':'重新发布最后完整提交'}。浏览器草稿仍会保留。</p><p>已提交修订：{status.revision??'尚未生成'}{status.pendingOperation&&` · 待确认操作：${status.pendingOperation}`}</p><button disabled={busy} onClick={()=>recover()}>保留现场并恢复白板</button><button disabled={busy} onClick={()=>inspect()}>重新检查恢复状态</button>{error&&<p>{error}</p>}</section>;
}
