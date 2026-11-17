import {restoredProject} from './backup.mjs';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {runtimeOperation} from '../native/runtime.mjs';
export function createCanvasMiddleware({project:rootProject}){
 const token=randomBytes(32).toString('hex');
 return async(req,res,next=()=>{res.statusCode=404;res.end();})=>{
  const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/api/canvas/'))return next();
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  try{
   const port=req.socket.localPort,hosts=[`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`];
   if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||!hosts.includes(req.headers.host)||(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)||req.headers['sec-fetch-site']==='cross-site'){res.statusCode=403;res.end(JSON.stringify({error:'Local same-origin browser required'}));return;}
   const project=restoredProject(rootProject,req.headers['x-bang-restored-project']);
   // Bootstrap discloses only a separate browser capability, never the daemon token.
   if(req.method==='GET'&&url.pathname==='/api/canvas/session/bootstrap'){const {workspaceId}=await runtimeOperation(project,'start');res.end(JSON.stringify({token,workspaceId}));return;}
   const supplied=Buffer.from(String(req.headers['x-bang-browser-token']||'')),expected=Buffer.from(token);
   if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){res.statusCode=403;res.end(JSON.stringify({error:'Browser capability required'}));return;}
   const [topic,action,...extra]=url.pathname.slice('/api/canvas/'.length).split('/').map(decodeURIComponent);
   if(extra.length)throw Error('Unknown route');
   if(topic==='session'&&action==='topics'&&req.method==='GET'){res.end(JSON.stringify(await runtimeOperation(project,'topics')));return;}
   if(topic==='session'&&req.method==='POST'&&['context-start','context-query','context-ack','create-topic','connect','enable','binding','ingest','backfill'].includes(action)){
    if(!req.headers['content-type']?.startsWith('application/json'))throw Error('JSON content type required');
    req.setEncoding('utf8');let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>(['ingest','context-query'].includes(action)?1024*1024:20000))throw Error('Binding request too large');}
    const command={'context-start':'context-start','context-query':'context-query','context-ack':'context-ack','create-topic':'topic-create',connect:'session-connect',enable:'binding-enable',binding:'binding-status',ingest:'turn-ingest',backfill:'turn-backfill'}[action];
    res.end(JSON.stringify(await runtimeOperation(project,command,undefined,JSON.parse(body))));return;
   }
   if(['organizer-control','organizer-configure'].includes(action)&&req.method==='POST'){
    if(!req.headers['content-type']?.startsWith('application/json'))throw Error('JSON content type required');req.setEncoding('utf8');let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>20000)throw Error('Organizer request too large');}
    const input=JSON.parse(body);res.end(JSON.stringify(await runtimeOperation(project,action,undefined,{...input,topicId:topic})));return;
   }
   if(action==='organizer-enable'&&req.method==='POST'){res.end(JSON.stringify(await runtimeOperation(project,'organizer-enable',undefined,{topicId:topic})));return;}
   if(action==='organizer'&&req.method==='GET'){res.end(JSON.stringify(await runtimeOperation(project,'organizer-status',undefined,{topicId:topic})));return;}
   if(req.method==='POST'&&['restore-preview','restore-version','basis-review','proposal-reconsider-preview','proposal-reconsider','proposal-review','backup-verify','backup-restore','import-preview','import-canvas','commit','preview','undo','recover'].includes(action)){
    if(!req.headers['content-type']?.startsWith('application/json'))throw Error('JSON content type required');
    req.setEncoding('utf8');let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>(action.startsWith('backup-')?64*1024*1024:1024*1024))throw Error('Patch too large');}
    res.end(JSON.stringify(await runtimeOperation(project,action,topic,JSON.parse(body))));return;
   }
   if(req.method!=='GET'){res.statusCode=405;res.end(JSON.stringify({error:'Use explicit commit endpoint'}));return;}
   if(action==='context-status'){res.end(JSON.stringify(await runtimeOperation(project,'context-status',topic)));return;}
   if(action==='knowledge-context'){res.end(JSON.stringify(await runtimeOperation(project,'knowledge-context',topic)));return;}
   if(action==='proposals'){res.end(JSON.stringify(await runtimeOperation(project,'proposals',topic)));return;}
   if(action==='export-canvas'||action==='backup-export'){res.end(JSON.stringify(await runtimeOperation(project,action,topic)));return;}
   if(action==='recovery-status'){res.end(JSON.stringify(await runtimeOperation(project,'recovery-status',topic)));return;}
   if(action==='history'){res.end(JSON.stringify(await runtimeOperation(project,'history',topic)));return;}
   if(action==='history-preview'||action==='history-diff'){const input=action==='history-preview'?{revision:Number(url.searchParams.get('revision'))}:{fromRevision:Number(url.searchParams.get('from')),toRevision:Number(url.searchParams.get('to'))};res.end(JSON.stringify(await runtimeOperation(project,action,topic,input)));return;}
   if(action==='resources'){res.end(JSON.stringify(await runtimeOperation(project,'resource-status',topic,{id:url.searchParams.get('id')})));return;}
   if(action==='turns'){res.end(JSON.stringify(await runtimeOperation(project,'turn-status',undefined,{topicId:topic})));return;}
   if(action==='source'){res.end(JSON.stringify(await runtimeOperation(project,'turn-source',undefined,{topicId:topic,id:url.searchParams.get('id')})));return;}
   if(action==='head'){res.end(JSON.stringify(await runtimeOperation(project,'head',topic)));return;}
   if(action&&action!=='state')throw Error('Unknown route');
   res.end(JSON.stringify(await runtimeOperation(project,action==='state'?'state':'read',topic)));
  }catch(error){res.statusCode=error.code==='ENOENT'?404:error.code==='RECOVERY_REQUIRED'?409:/conflict|reused|recovery|externally/.test(error.message)?409:400;res.end(JSON.stringify({error:error.message,preview:error.preview,code:error.code}));}
 };
}
