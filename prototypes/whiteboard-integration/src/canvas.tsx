import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Excalidraw,convertToExcalidrawElements} from '@excalidraw/excalidraw';
import {validateCanvas,type Canvas,type Card,type CommittedBoard,type BoardOperation,type BoardPatch} from '../../../runtime/canvas/contract';
import {ResourceDetails,cardLabel} from './ResourceDetails';
import {draftStore,type Draft} from './drafts';
import {canvasFetch,canvasWorkspaceId} from './canvas-client';
import '@excalidraw/excalidraw/index.css';
(window as any).EXCALIDRAW_ASSET_PATH='/';
function Board({board,onMove,disabled}:{board:Canvas;onMove:(positions:Map<string,{x:number;y:number}>)=>void;disabled:boolean}){
 const api=useRef<any>(null);
 const [initial]=useState(()=>({elements:board.nodes.flatMap(n=>{
  const elements=convertToExcalidrawElements([{type:'rectangle',id:n.id,x:n.x,y:n.y,width:n.width,height:n.height,strokeColor:'#334155',backgroundColor:'#f1f5f9',fillStyle:'solid',roughness:0,label:{text:cardLabel(n),fontSize:16,fontFamily:2}}],{regenerateIds:false});
  return elements.map(e=>e.id===n.id?{...e,x:n.x,y:n.y,width:n.width,height:n.height}:e);
 }),scrollToContent:true}));
 return <div style={{height:'calc(100vh - 60px)'}}><Excalidraw initialData={initial} viewModeEnabled={disabled} langCode="zh-CN" onPointerUp={()=>{if(!disabled)onMove(new Map(api.current.getSceneElements().map((e:any)=>[e.id,{x:Math.round(e.x),y:Math.round(e.y)}])));}} excalidrawAPI={value=>{api.current=value;(window as any).canvasBoard={snapshot:()=>value.getSceneElements(),viewport:()=>value.getAppState()};}} UIOptions={{canvasActions:{loadScene:false,saveToActiveFile:false,export:false}}}/></div>;
}
function App(){
 const topic=new URLSearchParams(location.search).get('topic')||'';
 const storage=useRef<Awaited<ReturnType<typeof draftStore>>|null>(null);
 const [state,setState]=useState<CommittedBoard|null>(null),[draft,setDraft]=useState<Card[]>([]),[error,setError]=useState(''),[receipt,setReceipt]=useState(''),[busy,setBusy]=useState(false);
 const [otherDrafts,setOtherDrafts]=useState<Draft[]>([]);
 const [recovery,setRecovery]=useState<Draft|null>(null),[epoch,setEpoch]=useState(0),[composing,setComposing]=useState(false);
 const latest=useRef<Draft|null>(null), composition=useRef(false), timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [retry,setRetry]=useState<BoardPatch|null>(null);
 const endpoint='/api/canvas/'+encodeURIComponent(topic);
 function persist(){if(timer.current)clearTimeout(timer.current);if(composition.current||!latest.current)return;try{storage.current!.write(latest.current);setReceipt('草稿已保留在此浏览器');}catch(e){setError('草稿保留失败：'+String(e));}}
 useEffect(()=>{if(!topic){setError('缺少专题');return;}canvasFetch(endpoint+'/state').then(async response=>{const value=await response.json();if(!response.ok)throw Error(value.error);validateCanvas(value.canvas);storage.current=await draftStore(await canvasWorkspaceId(),topic);setState(value);setDraft(value.canvas.nodes);try{setRecovery(storage.current!.read());setOtherDrafts(storage.current!.others());}catch(e){setError('无法读取草稿：'+String(e));}}).catch(e=>setError(String(e)));
 const unload=()=>persist();window.addEventListener('beforeunload',unload);return()=>{window.removeEventListener('beforeunload',unload);if(timer.current)clearTimeout(timer.current);};},[]);
 const operations:BoardOperation[]=[];
 if(state){for(const c of draft){const old=state.canvas.nodes.find(n=>n.id===c.id);if(!old)operations.push({type:'create-card',card:c});else if(old.text!==c.text||old.x!==c.x||old.y!==c.y||old.file!==c.file||old.url!==c.url)operations.push({type:'edit-card',id:c.id,text:c.text,x:c.x,y:c.y,...(c.type==='file'?{file:c.file}:c.type==='link'?{url:c.url}:{})});}for(const old of state.canvas.nodes)if(!draft.some(c=>c.id===old.id))operations.push({type:'delete-card',id:old.id});}
 function change(cards:Card[],immediate=true){if(!state)return;setDraft(cards);setRetry(null);setReceipt('');latest.current={base:state,cards,retry:null,updated:Date.now()};if(timer.current)clearTimeout(timer.current);if(!composition.current){if(immediate)persist();else timer.current=setTimeout(persist,450);}}
 async function save(){
  if(!state||!operations.length||composition.current||recovery)return;persist();setBusy(true);setError('');
  const patch=retry??{operationId:crypto.randomUUID(),topic,baseRevision:state.revision,author:{kind:'manual' as const,id:'local-user'},readDependencies:[],intent:'explicit-save' as const,operations};setRetry(patch);latest.current={base:state,cards:draft,retry:patch,updated:Date.now()};persist();
  try{const response=await canvasFetch(endpoint+'/commit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)});const result=await response.json();if(!response.ok)throw Error(result.error);
   const canvas={nodes:draft.map(c=>({...c,type:c.type??'text'})),edges:[] as never[]};setState({...state,revision:result.revision,canvas});setRetry(null);latest.current=null;storage.current!.clear();setReceipt(`已保存 · 修订 ${result.revision} · ${result.operationId}`);
  }catch(e){setError(String(e));}finally{setBusy(false);}
 }
 function createResource(type:'file'|'link'){change([...draft,{id:crypto.randomUUID(),type,text:'',...(type==='file'?{file:'docs/document.pdf'}:{url:'https://example.com/'}),x:draft.length*40,y:draft.length*40,width:320,height:180}]);}
 const disabled=busy||!!recovery;
 return <><header style={{padding:12,fontFamily:'sans-serif'}}>Bang · 已提交白板 · 修订 {state?.revision??'…'} <button disabled={disabled||!state||composing} onClick={()=>change([...draft,{id:crypto.randomUUID(),text:'新知识卡片',x:draft.length*40,y:draft.length*40,width:320,height:180}])}>新增知识卡片</button> <button disabled={disabled||!state||composing} onClick={()=>createResource('file')}>新增文件卡片</button> <button disabled={disabled||!state||composing} onClick={()=>createResource('link')}>新增链接卡片</button> <button disabled={disabled||composing||!operations.length} onClick={save}>保存</button> <span role="status">{receipt|| (operations.length?'有未保存编辑':'')}</span></header>{!recovery&&otherDrafts.length>0&&<details><summary>其他编辑页的可恢复草稿（复制到本页）</summary>{otherDrafts.map((d,i)=><button key={i} onClick={()=>setRecovery(d)}>{new Date(d.updated).toLocaleString()} · 基线 {d.base.revision}</button>)}</details>}{error&&<p role="alert">{error}</p>}{recovery&&<div role="alert">发现可恢复草稿 · 基线修订 {recovery.base.revision}。恢复后仍需显式保存。<button onClick={()=>{setState(recovery.base);setDraft(recovery.cards);setRetry(recovery.retry);latest.current=recovery;persist();setRecovery(null);setEpoch(v=>v+1);}}>恢复草稿</button><button onClick={()=>{try{storage.current!.clear();setRecovery(null);}catch(e){setError(String(e));}}}>放弃草稿</button></div>}{state?<div style={{display:'flex'}}><aside style={{width:320,padding:12,maxHeight:'85vh',overflow:'auto'}}><p>编辑和拖动结束后保留草稿，点击保存后生效。</p>{draft.map((c,i)=><section key={c.id} style={{marginBottom:16}}>{(c.type==='file'||c.type==='link')&&<label>{c.type==='file'?'文件路径':'链接地址'}<input aria-label={`${c.type==='file'?'文件路径':'链接地址'} ${i+1}`} disabled={disabled} value={c.type==='file'?c.file:c.url} onCompositionStart={()=>{composition.current=true;setComposing(true);if(timer.current)clearTimeout(timer.current);}} onCompositionEnd={e=>{composition.current=false;setComposing(false);change(draft.map(n=>n.id===c.id?{...n,[c.type==='file'?'file':'url']:e.currentTarget.value}:n));}} onBlur={()=>persist()} onChange={e=>change(draft.map(n=>n.id===c.id?{...n,[c.type==='file'?'file':'url']:e.target.value}:n),false)} style={{width:'95%'}}/></label>}<label>卡片 {i+1}<textarea aria-label={`卡片正文 ${i+1}`} disabled={disabled} value={c.text} onCompositionStart={()=>{composition.current=true;setComposing(true);if(timer.current)clearTimeout(timer.current);}} onCompositionEnd={e=>{composition.current=false;setComposing(false);change(draft.map(n=>n.id===c.id?{...n,text:e.currentTarget.value}:n));}} onBlur={()=>persist()} onChange={e=>change(draft.map(n=>n.id===c.id?{...n,text:e.target.value}:n),false)} style={{display:'block',width:'95%',height:100}}/></label><button disabled={disabled||composing} onClick={()=>change(draft.filter(n=>n.id!==c.id))}>删除卡片 {i+1}</button><ResourceDetails card={c} endpoint={endpoint} committed={state.canvas.nodes.some(n=>n.id===c.id&&n.file===c.file)}/></section>)}</aside><main style={{flex:1,minWidth:0}}><Board key={`${state.revision}:${epoch}`} board={{...state.canvas,nodes:draft.map(c=>({...c,type:c.type??'text'}))}} disabled={disabled||composing} onMove={positions=>{const moved=draft.map(c=>({...c,...positions.get(c.id)}));if(moved.some((c,i)=>c.x!==draft[i].x||c.y!==draft[i].y))change(moved);}}/></main></div>:<p>加载中…</p>}</>;
}
createRoot(document.getElementById('root')!).render(<App/>);


