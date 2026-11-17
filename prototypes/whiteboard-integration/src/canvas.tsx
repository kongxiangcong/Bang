import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Excalidraw,convertToExcalidrawElements} from '@excalidraw/excalidraw';
import {validateCanvas,type Canvas} from '../../../runtime/canvas/contract';
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
 const [board,setBoard]=useState<Canvas|null>(null),[error,setError]=useState('');
 useEffect(()=>{const topic=new URLSearchParams(location.search).get('topic');if(!topic){setError('缺少专题');return;}fetch('/api/canvas/'+encodeURIComponent(topic)).then(async response=>{const value=await response.json();if(!response.ok)throw Error(value.error);setBoard(validateCanvas(value));}).catch(e=>setError(String(e)));},[]);
 return <><header style={{height:44,padding:8,fontFamily:'sans-serif'}}>Bang · 已提交白板 · 只读</header>{error?<p role="alert">{error}</p>:board?<Board board={board}/>:<p>加载中…</p>}</>;
}
createRoot(document.getElementById('root')!).render(<App/>);
