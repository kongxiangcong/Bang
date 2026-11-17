import {readBoard} from './store.mjs';
export function createCanvasMiddleware({project}){
 return async(req,res,next=()=>{res.statusCode=404;res.end();})=>{
  const url=new URL(req.url,'http://localhost');
  if(!url.pathname.startsWith('/api/canvas/'))return next();
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){res.statusCode=405;res.end(JSON.stringify({error:'Read only'}));return;}
  try{res.end(JSON.stringify(await readBoard(project,decodeURIComponent(url.pathname.slice('/api/canvas/'.length)))));}
  catch(error){res.statusCode=error.code==='ENOENT'?404:400;res.end(JSON.stringify({error:error.message}));}
 };
}
