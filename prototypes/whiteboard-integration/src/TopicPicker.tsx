import React,{useEffect,useState} from 'react';
import {canvasFetch,canvasWorkspaceId} from './canvas-client';
type Topic={id:string;name:string};
type Source={host:string;sessionId:string;startTurnId:string;receivedCursor:string|null;completedTurns:number;backlog:number};
type Binding={status:string;topic?:Topic;source?:Source;oldSource?:Source;backlog?:number;confirmation?:string;identity?:{host:string;sessionId:string}};
export function TopicPicker({topic}:{topic:string}){
 const [topics,setTopics]=useState<Topic[]>([]),[selected,setSelected]=useState(topic),[name,setName]=useState(''),[token,setToken]=useState(''),[binding,setBinding]=useState<Binding|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function post(action:string,input:unknown){const response=await canvasFetch('/api/canvas/session/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const data=await response.json();if(!response.ok)throw Error(data.error);return data;}
 async function reload(){const response=await canvasFetch('/api/canvas/session/topics');const data=await response.json();if(!response.ok)throw Error(data.error);setTopics(data);return data as Topic[];}
 function open(id:string){const url=new URL(location.href);url.searchParams.set('topic',id);url.hash='';location.assign(url.href);}
 useEffect(()=>{(async()=>{
  const key='bang-session:'+await canvasWorkspaceId(),fragment=new URLSearchParams(location.hash.slice(1)),incoming=fragment.get('session');
  if(incoming){sessionStorage.setItem(key,incoming);history.replaceState(null,'',location.pathname+location.search);}
  const capability=incoming||sessionStorage.getItem(key)||'';setToken(capability);
  const listed=await reload();if(!topic&&listed.length===1)setSelected(listed[0].id);
  if(capability)setBinding(await post('binding',{sessionToken:capability}));
 })().catch(e=>setError(String(e)));},[]);
 async function enable(confirmation?:string){setBusy(true);setError('');try{
  const next=await post('enable',{sessionToken:token,...(selected?{topicId:selected}:{}),...(confirmation?{confirmation}:{})});setBinding(next);await reload();
  if(next.status==='bound'){setSelected(next.topic.id);if(next.topic.id!==topic)open(next.topic.id);}
 }catch(e){setError(String(e));setBinding(null);}finally{setBusy(false);}}
 async function create(){setBusy(true);setError('');try{const created=await post('create-topic',{name});await reload();setSelected(created.id);setName('');}catch(e){setError(String(e));}finally{setBusy(false);}}
 const source=binding?.source;
 return <section aria-label="专题与来源" style={{padding:12,fontFamily:'sans-serif',borderBottom:'1px solid #ccc'}}>
  <label>专题 <select aria-label="选择专题" disabled={busy} value={selected} onChange={e=>{setSelected(e.target.value);setBinding(null);}}><option value="">{topics.length?'请选择专题':'无专题，启用时创建默认专题'}</option>{topics.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
  <button disabled={busy||!selected} onClick={()=>open(selected)}>打开专题</button>
  <label>新专题名称 <input aria-label="新专题名称" value={name} maxLength={120} onChange={e=>setName(e.target.value)}/></label><button disabled={busy||!name.trim()} onClick={create}>创建专题</button>
  <button disabled={busy||!token} onClick={()=>enable()}>启用当前会话到专题</button>
  <p role="status">{!token?'绑定不可用：请从已安装的可信宿主连接器在当前会话启用。可先创建或打开专题。':source?`已绑定 ${binding?.topic?.name} · ${source.host} / ${source.sessionId} · 起始轮 ${source.startTurnId} · 接收游标 ${source.receivedCursor??'尚未接收'} · 完成轮 ${source.completedTurns} · 积压 ${source.backlog}`:binding?.status==='selection-required'?'多个专题，请明确选择后启用。':`当前可信会话 ${binding?.identity?.host??''} / ${binding?.identity?.sessionId??''} 尚未绑定所选专题。`}</p>
  {binding?.status==='takeover-required'&&<div role="dialog" aria-label="确认接管专题"><p>接管 {binding.topic?.name}：旧来源 {binding.oldSource?.host} / {binding.oldSource?.sessionId}，积压 {binding.backlog} 轮。旧来源接收将冻结，已接收积压保留。</p><button disabled={busy} onClick={()=>enable(binding.confirmation)}>确认接管</button><button disabled={busy} onClick={()=>setBinding(null)}>取消接管</button></div>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
