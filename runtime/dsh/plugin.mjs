import fs from 'node:fs';
import {createDshConnector} from './session-connector.mjs';
export const name='bang-session-connector';
export const inject=['agents','sessions','sessionQuery','sessionPersistence','tools'];
export function apply(ctx,config){
 const manifest=JSON.parse(fs.readFileSync(config.manifest,'utf8'));
 if(manifest.hostVersion!=='0.2.1-rc.2')throw Error('Unsupported Bang DSH manifest');
 const connector=createDshConnector(ctx,{...manifest,privateKey:fs.readFileSync(manifest.privateKeyFile,'utf8')});
 // This observer retains only numerical boundaries, never pre-authorization bodies.
 ctx.on('session/event',(session,event)=>connector.observe(session,event));
 let errorCode=null;
 const poll=()=>connector.poll().then(()=>{errorCode=null;},()=>{errorCode='DSH_RECEPTION_UNAVAILABLE';});
 const timer=setInterval(poll,1000);timer.unref();
 ctx.on('dispose',async()=>{clearInterval(timer);connector.close();await connector.drain();});
 ctx.tools.register({name:'bang_enable',description:'Enable Bang for this exact current root discussion from this calling turn. Only use when the user asks to enable Bang. Prior history is excluded.',parameters:{type:'object',properties:{topicId:{type:'string'}},additionalProperties:false},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},execute:async args=>{if(!args||Object.keys(args).some(k=>k!=='topicId')||(args.topicId!==undefined&&typeof args.topicId!=='string'))throw Error('Invalid Bang enable arguments');return JSON.stringify(await connector.enable(args));}});
 ctx.tools.register({name:'bang_reception_status',description:'Check whether this Bang host adapter is receiving successfully.',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},execute:async()=>{await poll();return JSON.stringify({status:errorCode??'poll-complete'});}});
}

