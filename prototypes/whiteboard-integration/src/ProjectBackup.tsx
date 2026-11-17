import React,{useState} from 'react';
import {canvasFetch} from './canvas-client';
export function ProjectBackup(){
 const [raw,setRaw]=useState(''),[backup,setBackup]=useState<any>(null),[report,setReport]=useState<any>(null),[restored,setRestored]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function request(action:string,value?:unknown){const response=await canvasFetch('/api/canvas/project/'+action,value?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}:undefined);const result=await response.json();if(!response.ok)throw Error(result.error);return result;}
 async function act(action:'export'|'verify'|'restore'){
  setBusy(true);setError('');try{
   if(action==='export'){setBackup(await request('backup-export'));}
   if(action==='verify'){setReport(null);setRestored(null);setReport(await request('backup-verify',{backup:JSON.parse(raw)}));}
   if(action==='restore')setRestored(await request('backup-restore',{backup:JSON.parse(raw)}));
  }catch(e){setError(String(e));}finally{setBusy(false);}
 }
 function download(){const url=URL.createObjectURL(new Blob([JSON.stringify(backup)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='bang-project.backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const current=new URLSearchParams(location.search).get('restored');
 const restoredQuery=restored?new URLSearchParams({restored:[current,restored.restoreId].filter(Boolean).join('/'),topic:restored.topics[0].id}).toString():'';
 return <details><summary>完整项目备份与还原</summary><section aria-label="完整项目备份">
 <p>备份整个项目的已提交内容、来源、全部历史、附件和编辑器附加信息。浏览器草稿请先保存；标准 Canvas 文件仅用于内容交换。项目包上限 48 MiB。</p>
 <button disabled={busy} onClick={()=>act('export')}>生成完整项目备份</button>
 {backup&&<section><p>完整项目包已生成。<button onClick={download}>下载完整项目包</button></p>{backup.payload.attachments.some((a:any)=>a.status==='missing')&&<p role="status">导出时已缺失的附件：{backup.payload.attachments.filter((a:any)=>a.status==='missing').map((a:any)=>a.path).join('、')}。包内保留缺失记录；不会凭空补齐文件。</p>}</section>}
 <label>选择项目包<input type="file" accept=".json,application/json" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];if(file){setRaw(await file.text());setReport(null);setRestored(null);}}}/></label>
 <label>完整项目包 JSON<textarea aria-label="完整项目包 JSON" disabled={busy} value={raw} onChange={e=>{setRaw(e.target.value);setReport(null);setRestored(null);}}/></label>
 <button disabled={busy||!raw} onClick={()=>act('verify')}>验证完整项目包</button>
 {report&&<section><p>校验通过：{report.topics.length} 个专题 · {report.revisions} 个历史修订 · {report.sources} 个讨论来源 · {report.attachments} 个附件。</p>
 {report.missingAttachments.length>0&&<p role="status">导出时已缺失的附件（还原后仍显示缺失）：{report.missingAttachments.join('、')}</p>}
 <p>还原到本项目备份区域中的独立新目录，当前项目保持不变。旧来源和积压冻结，宿主需重新授权；不会自动重放旧讨论。</p>
 <button disabled={busy} onClick={()=>act('restore')}>还原为独立新项目</button></section>}
 {restored&&<section aria-label="还原完成"><p>还原完成，新项目位置：<code>{restored.projectPath}</code></p><a data-restore-link href={'canvas.html?'+restoredQuery}>打开还原项目</a><p>也可使用此位置作为 Bang 的项目目录重新启动。</p></section>}
 {error&&<p role="alert">{error}</p>}
 </section></details>;
}
