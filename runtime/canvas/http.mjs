import {randomBytes,timingSafeEqual} from 'node:crypto';
import {runtimeOperation} from '../native/runtime.mjs';
export function createCanvasMiddleware({project}){
 const token=randomBytes(32).toString('hex');
 return async(req,res,next=()=>{res.statusCode=404;res.end();})=>{
  const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/api/canvas/'))return next();
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  try{
   const port=req.socket.localPort,hosts=[`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`];
   if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||!hosts.includes(req.headers.host)||(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)||req.headers['sec-fetch-site']==='cross-site'){res.statusCode=403;res.end(JSON.stringify({error:'Local same-origin browser required'}));return;}
   // Bootstrap discloses only a separate browser capability, never the daemon token.
   if(req.method==='GET'&&url.pathname==='/api/canvas/session/bootstrap'){const {workspaceId}=await runtimeOperation(project,'start');res.end(JSON.stringify({token,workspaceId}));return;}
   const supplied=Buffer.from(String(req.headers['x-bang-browser-token']||'')),expected=Buffer.from(token);
   if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){res.statusCode=403;res.end(JSON.stringify({error:'Browser capability required'}));return;}
   const [topic,action,...extra]=url.pathname.slice('/api/canvas/'.length).split('/').map(decodeURIComponent);
   if(extra.length)throw Error('Unknown route');
   if(req.method==='POST'&&['commit','preview','undo'].includes(action)){
    if(!req.headers['content-type']?.startsWith('application/json'))throw Error('JSON content type required');
    req.setEncoding('utf8');let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>1024*1024)throw Error('Patch too large');}
    res.end(JSON.stringify(await runtimeOperation(project,action,topic,JSON.parse(body))));return;
   }
   if(req.method!=='GET'){res.statusCode=405;res.end(JSON.stringify({error:'Use explicit commit endpoint'}));return;}
   if(action==='history'){res.end(JSON.stringify(await runtimeOperation(project,'history',topic)));return;}
   if(action==='history-preview'||action==='history-diff'){const input=action==='history-preview'?{revision:Number(url.searchParams.get('revision'))}:{fromRevision:Number(url.searchParams.get('from')),toRevision:Number(url.searchParams.get('to'))};res.end(JSON.stringify(await runtimeOperation(project,action,topic,input)));return;}
   if(action==='resources'){res.end(JSON.stringify(await runtimeOperation(project,'resource-status',topic,{id:url.searchParams.get('id')})));return;}
   if(action==='head'){res.end(JSON.stringify(await runtimeOperation(project,'head',topic)));return;}
   if(action&&action!=='state')throw Error('Unknown route');
   res.end(JSON.stringify(await runtimeOperation(project,action==='state'?'state':'read',topic)));
  }catch(error){res.statusCode=error.code==='ENOENT'?404:/conflict|reused|recovery|externally/.test(error.message)?409:400;res.end(JSON.stringify({error:error.message,preview:error.preview}));}
 };
}




