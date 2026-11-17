import React,{useEffect,useState} from 'react';
import {safeResourceURL,type Card} from '../../../runtime/canvas/contract';
// Raw text rendering deliberately avoids HTML/Markdown execution, embeds and fetches.
export function ResourceDetails({card,endpoint,committed}:{card:Card;endpoint:string;committed:boolean}){
 const [status,setStatus]=useState('');
 useEffect(()=>{let active=true;setStatus('');if(card.type==='file'&&committed)fetch(endpoint+'/resources?id='+encodeURIComponent(card.id)).then(async r=>{if(!r.ok)throw Error();return r.json();}).then(v=>{if(active)setStatus(v.status);}).catch(()=>{if(active)setStatus('blocked');});return()=>{active=false;};},[card.id,card.file,endpoint,committed]);
 let safeURL='';if(card.type==='link')try{safeURL=safeResourceURL(card.url);}catch{}
 return <details><summary>详情 · 原文</summary>{card.type==='file'&&<p role="status">文件引用：{card.file}<br/>{!committed?'保存后检查资源':status==='available'?'文件可用（不自动读取）':status==='missing'?'资源缺失 · 引用已保留':status==='blocked'?'资源不可访问 · 引用已保留':'检查资源…'}</p>}{card.type==='link'&&(safeURL?<p><a href={safeURL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">打开链接（新窗口）</a><br/>{safeURL}</p>:<p>链接不安全，无法打开</p>)}<pre aria-label={`原文 ${card.id}`} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:400,overflow:'auto'}}>{card.text}</pre></details>;
}
export function cardLabel(card:Card){const body=card.type==='file'?`文件 · ${card.file}`:card.type==='link'?`链接 · ${card.url}`:card.text;return body.length>240?body.slice(0,240)+'…（详情保留原文）':body;}
