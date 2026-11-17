import React,{useState} from 'react';
import {Excalidraw} from '@excalidraw/excalidraw';
import {canvasFetch} from './canvas-client';
import {renderScene} from './canvas-annotations';
export function LegacyMigration(){
 const [kind,setKind]=useState('session'),[topic,setTopic]=useState(''),[report,setReport]=useState<any>(null),[result,setResult]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[offline,setOffline]=useState(false),[reviewed,setReviewed]=useState(false);
 async function request(action:string,input:unknown){const response=await canvasFetch('/api/canvas/project/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const value=await response.json();if(!response.ok)throw Error(value.error);return value;}
 async function act(action:string){setBusy(true);setError('');try{const selection={kind,...(kind==='companion'?{topic}:{})};if(action==='legacy-migrate')setResult(await request(action,{...selection,fingerprint:report.fingerprint,confirmOffline:offline,confirmReplay:reviewed,confirmUncertainties:reviewed}));else{if(action==='legacy-stop')await request(action,{...selection,confirm:true});setReport(await request('legacy-preflight',selection));setReviewed(false);}}catch(e){setError(String(e));}finally{setBusy(false);}}
 const saved=report?.replay.at(-1),current=new URLSearchParams(location.search).get('restored');
 return <details><summary>旧项目预检与迁移</summary><section aria-label="旧项目迁移">
 <p>只读取当前项目中明确选择的旧数据。先停止旧整理进程并关闭所有旧编辑页面；旧 PID 文件不能证明进程已退出。原文件保留，新项目需重新授权宿主。</p>
 <label>旧格式<select aria-label="旧格式" value={kind} onChange={e=>{setKind(e.target.value);setReport(null);}}><option value="session">旧白板 session</option><option value="companion">Companion 专题</option></select></label>
 {kind==='companion'&&<label>旧专题 ID<input aria-label="旧专题 ID" value={topic} onChange={e=>{setTopic(e.target.value);setReport(null);}}/></label>}
 <button disabled={busy} onClick={()=>act('legacy-preflight')}>只读预检</button><button disabled={busy} onClick={()=>act('legacy-stop')}>停止旧整理并重新预检</button>
 {report&&<section aria-label="迁移预检报告"><p>指纹：{report.fingerprint}</p><p>历史事件 {report.counts.events} · 来源 {report.counts.sources} · 已保存元素 {report.counts.elements} · 删除 {report.counts.deleted} · 知识卡片 {report.counts.knowledgeCards} · 待确认关系 {report.uncertainties.length}</p><p>{report.writerStopped?'旧 worker 配置停用且无锁文件；仍需确认旧页面已关闭。':'旧 worker 未排空，请停止并等待后重新预检。'}</p>
 <details><summary>历史与来源核对</summary><p>历史修订仅重建事件语义，不冒充当时保存画面。最后一版采用实际保存场景。旧来源作为历史依据保留，不冒充已认证完成轮。</p>{report.replay.map((r:any)=><section key={r.revision}><strong>修订 {r.revision} · {r.legacyHistoryKind}</strong>{r.canvas.nodes.map((n:any)=><p key={n.id}>{n.id}：{n.text}</p>)}</section>)}<pre>{JSON.stringify(saved.legacyMigration.sources,null,2)}</pre></details>
 <pre>{JSON.stringify(report.uncertainties,null,2)}</pre><p>实际保存画面预览（未知对象保留为标注）：</p><div style={{height:400}}><Excalidraw key={report.fingerprint} initialData={{elements:renderScene(saved.canvas,saved.editorExtras),appState:{viewModeEnabled:true}}} viewModeEnabled/></div>
 <label><input type="checkbox" checked={offline} onChange={e=>setOffline(e.target.checked)}/>我已停止所有旧写入者并关闭旧页面</label><label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>我已核对历史、来源和画面；同意矛盾关系保持待确认</label>
 <button disabled={busy||!offline||!reviewed||!report.writerStopped} onClick={()=>act('legacy-migrate')}>迁入独立新项目</button></section>}
 {result&&<p role="status">迁移验证通过，原文件保留。<a data-migration-link href={'canvas.html?'+new URLSearchParams({topic:'legacy',restored:[current,result.restoreId].filter(Boolean).join('/')})}>打开迁移项目</a></p>}{error&&<p role="alert">{error}</p>}
 </section></details>;
}
