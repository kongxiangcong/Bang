import {canvasFetch} from './canvas-client';
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Excalidraw,convertToExcalidrawElements} from '@excalidraw/excalidraw';
import {validateCanvas,type Canvas,type Card,type CommittedBoard,type BoardOperation,type BoardPatch} from '../../../runtime/canvas/contract';
import '@excalidraw/excalidraw/index.css';
(window as any).EXCALIDRAW_ASSET_PATH='/';
function Board({board}:{board:Canvas}){
 const [initial]=useState(()=>({elements:board.nodes.flatMap(n=>{
  const elements=convertToExcalidrawElements([{type:'rectangle',id:n.id,x:n.x,y:n.y,width:n.width,height:n.height,strokeColor:'#334155',backgroundColor:'#f1f5f9',fillStyle:'solid',roughness:0,label:{text:n.text,fontSize:16,fontFamily:2}}],{regenerateIds:false});
  // Text measurement may enlarge containers; standard Canvas geometry remains authoritative.
  return elements.map(e=>e.id===n.id?{...e,x:n.x,y:n.y,width:n.width,height:n.height}:e);
 }),scrollToContent:true}));
 return <div style={{height:'calc(100vh - 60px)'}}><Excalidraw initialData={initial} viewModeEnabled langCode="zh-CN" excalidrawAPI={api=>{(window as any).canvasBoard={snapshot:()=>api.getSceneElements()};}} UIOptions={{canvasActions:{loadScene:false,saveToActiveFile:false,export:false}}}/></div>;
}
function App(){
 const topic=new URLSearchParams(location.search).get('topic')||'';
 const [state,setState]=useState<CommittedBoard|null>(null),[draft,setDraft]=useState<Card[]>([]),[error,setError]=useState(''),[receipt,setReceipt]=useState(''),[busy,setBusy]=useState(false);
 const [retry,setRetry]=useState<BoardPatch|null>(null);
 const endpoint='/api/canvas/'+encodeURIComponent(topic);
 useEffect(()=>{if(!topic){setError('缺少专题');return;}canvasFetch(endpoint+'/state').then(async response=>{const value=await response.json();if(!response.ok)throw Error(value.error);validateCanvas(value.canvas);setState(value);setDraft(value.canvas.nodes);}).catch(e=>setError(String(e)));},[]);
 const operations:BoardOperation[]=[];
 if(state){for(const c of draft){const old=state.canvas.nodes.find(n=>n.id===c.id);if(!old)operations.push({type:'create-card',card:c});else if(old.text!==c.text)operations.push({type:'edit-card',id:c.id,text:c.text});}for(const old of state.canvas.nodes)if(!draft.some(c=>c.id===old.id))operations.push({type:'delete-card',id:old.id});}
 function change(cards:Card[]){setDraft(cards);setRetry(null);setReceipt('');}
 async function save(){
  if(!state||!operations.length)return;setBusy(true);setError('');
  const patch=retry??{operationId:crypto.randomUUID(),topic,baseRevision:state.revision,author:{kind:'manual' as const,id:'local-user'},readDependencies:[],intent:'explicit-save' as const,operations};setRetry(patch);
  try{const response=await canvasFetch(endpoint+'/commit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)});const result=await response.json();if(!response.ok)throw Error(result.error);
   const canvas={nodes:draft.map(c=>({...c,type:'text' as const})),edges:[] as never[]};setState({...state,revision:result.revision,canvas});setRetry(null);setReceipt(`已保存 · 修订 ${result.revision} · ${result.operationId}`);
  }catch(e){setError(String(e));}finally{setBusy(false);}
 }
 return <><header style={{padding:12,fontFamily:'sans-serif'}}>Bang · 已提交白板 · 修订 {state?.revision??'…'} <button disabled={busy||!state} onClick={()=>change([...draft,{id:crypto.randomUUID(),text:'新知识卡片',x:draft.length*40,y:draft.length*40,width:320,height:180}])}>新增知识卡片</button> <button disabled={busy||!operations.length} onClick={save}>保存</button> <span role="status">{receipt|| (operations.length?'有未保存编辑':'')}</span></header>{error&&<p role="alert">{error}</p>}{state?<div style={{display:'flex'}}><aside style={{width:320,padding:12,maxHeight:'85vh',overflow:'auto'}}><p>编辑知识卡片，点击保存后生效。</p>{draft.map((c,i)=><section key={c.id} style={{marginBottom:16}}><label>卡片 {i+1}<textarea aria-label={`卡片正文 ${i+1}`} disabled={busy} value={c.text} onChange={e=>change(draft.map(n=>n.id===c.id?{...n,text:e.target.value}:n))} style={{display:'block',width:'95%',height:100}}/></label><button disabled={busy} onClick={()=>change(draft.filter(n=>n.id!==c.id))}>删除卡片 {i+1}</button></section>)}</aside><main style={{flex:1,minWidth:0}}><Board key={state.revision} board={state.canvas}/></main></div>:<p>加载中…</p>}</>;
}
createRoot(document.getElementById('root')!).render(<App/>);

