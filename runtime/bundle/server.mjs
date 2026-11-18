import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {atomic,read,identity} from './storage.mjs';
import {assertFrontend} from './prerequisites.mjs';
import {runtimeEnv} from './runtime-paths.mjs';
import {createBangMiddleware} from '../../prototypes/whiteboard-integration/bridge.mjs';
async function main(){
const home=path.resolve(process.argv[2]);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../prototypes/whiteboard-integration');
await assertFrontend();Object.assign(process.env,await runtimeEnv(home));
const {createServer,react,tailwind}=await import('../../prototypes/whiteboard-integration/bundle-vite.mjs');
const config=await read(path.join(home,'bundle.json'));
const previous=await read(path.join(home,'server.json'),null);
// Vite 6 treats port:0 as its default 5173. Reserve an OS-selected port
// for first launch; strictPort still fails safely if another process wins the race.
const requestedPort=previous?.port??await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(error=>error?reject(error):resolve(port))})});
const middleware=createBangMiddleware({projectRoot:config.workspace});
const server=await createServer({root,cacheDir:path.join(home,'cache','vite'),configFile:false,plugins:[react(),tailwind(),{name:'bang-project',configureServer(s){s.middlewares.use((req,res,next)=>{
 if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}`){res.statusCode=403;res.end('Origin not allowed');return;}
 if(req.url==='/api/bang/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({workspace:config.workspace,topic:config.topic}));return;}
 middleware(req,res,next);
})}}],server:{host:'127.0.0.1',port:requestedPort,strictPort:true,fs:{allow:[root,path.join(home,'cache','vite')]},watch:{ignored:['**/evidence/**','**/.bang/**']}}});
await server.listen();const port=server.httpServer.address().port;
await atomic(path.join(home,'server.json'),{...await identity(),port,url:`http://127.0.0.1:${port}/?topic=${config.topic}`,workspace:config.workspace});
const timer=setInterval(async()=>{try{if(!(await read(path.join(home,'bundle.json'))).serverEnabled)await close()}catch(e){console.error(e)}},500);
async function close(){clearInterval(timer);await server.close();process.exit(0)}
process.on('SIGTERM',close);process.on('SIGINT',close);

}
main().catch(async error=>{await atomic(path.join(path.resolve(process.argv[2]),'server-failure.json'),{at:new Date().toISOString(),stage:'whiteboard',message:error.message});console.error(error);process.exitCode=1});
