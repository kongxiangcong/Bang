import {readBoard,readCommitted,commitBoard} from './store.mjs';
export function createCanvasMiddleware({project}){
 return async(req,res,next=()=>{res.statusCode=404;res.end();})=>{
  const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/api/canvas/'))return next();
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  const [topic,action,...extra]=url.pathname.slice('/api/canvas/'.length).split('/').map(decodeURIComponent);
  try{
   if(extra.length)throw Error('Unknown route');
   if(req.method==='POST'&&action==='commit'){
    if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)throw Error('Cross-origin save rejected');
    if(!req.headers['content-type']?.startsWith('application/json'))throw Error('JSON content type required');
    let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>1024*1024)throw Error('Patch too large');}
    res.end(JSON.stringify(await commitBoard(project,topic,JSON.parse(body))));return;
   }
   if(req.method!=='GET'){res.statusCode=405;res.end(JSON.stringify({error:'Use explicit commit endpoint'}));return;}
   if(action&&action!=='state')throw Error('Unknown route');
   res.end(JSON.stringify(action==='state'?await readCommitted(project,topic):await readBoard(project,topic)));
  }catch(error){res.statusCode=error.code==='ENOENT'?404:/conflict|reused|recovery|externally/.test(error.message)?409:400;res.end(JSON.stringify({error:error.message}));}
 };
}
