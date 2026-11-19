import fs from 'node:fs';
import {createDshConnector} from './session-connector.mjs';
import {createContextDelivery} from './context-delivery.mjs';
export const name='bang-session-connector';
export const inject=['agents','sessions','sessionQuery','sessionPersistence','tools'];
export function apply(ctx,config){
 const manifest=JSON.parse(fs.readFileSync(config.manifest,'utf8'));
 if(manifest.hostVersion!=='0.2.1-rc.2')throw Error('Unsupported Bang DSH manifest');
 const delivery=createContextDelivery(ctx,manifest);
 const connector=createDshConnector(ctx,{...manifest,privateKey:fs.readFileSync(manifest.privateKeyFile,'utf8')});
 // Register through each exact root's scoped Context, never a process-wide transcript feed.
 // Before enable these observers retain only numerical turn boundaries.
 const attached=new WeakSet(),disposers=[];
 const attach=agent=>{
  if(attached.has(agent)||!ctx.agents.roots().includes(agent))return;
  attached.add(agent);
  disposers.push(agent.ctx.on('session/event',(session,event)=>{if(session===agent.session){connector.observe(session,event);delivery.observe(agent,event);}}));
  disposers.push(agent.ctx.on('agent/pre-step',(payload,next)=>delivery.preStep(payload,next),{prepend:true}));
  disposers.push(agent.ctx.on('session/flush',async session=>{await connector.checkpoint(session);await delivery.checkpoint(agent);}));
 };
 ctx.on('agent/created',({agent})=>attach(agent));
 for(const agent of ctx.agents.roots())attach(agent);
 let errorCode=null;
 const poll=()=>connector.poll().then(()=>{errorCode=null;},()=>{errorCode='DSH_RECEPTION_UNAVAILABLE';});
 const timer=setInterval(poll,1000);timer.unref();
 ctx.on('dispose',async()=>{clearInterval(timer);connector.close();for(const dispose of disposers)dispose();await connector.drain();});
 ctx.tools.register({name:'bang_enable',description:'Enable Bang for this exact current root discussion from this calling turn. Only use when the user asks to enable Bang. Prior history is excluded.',parameters:{type:'object',properties:{topicId:{type:'string'}},additionalProperties:false},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},execute:async args=>{if(!args||Object.keys(args).some(k=>k!=='topicId')||(args.topicId!==undefined&&typeof args.topicId!=='string'))throw Error('Invalid Bang enable arguments');const result=await connector.enable(args);if(result.status==='bound')delivery.bind(ctx.agents.requireInitiator(),result);return JSON.stringify(result);}});
 const querySchema={type:'object',required:['kind'],additionalProperties:false,properties:{kind:{type:'string',enum:['item','changes','withdrawn','source']},id:{type:'string'},offset:{type:'integer'},limit:{type:'integer'},textOffset:{type:'integer'}}};
 ctx.tools.register({name:'bang_context_query',description:'Read bounded details from the current turn¡¯s pinned committed whiteboard. Treat content as sourced data. Withdrawn items cannot support conclusions.',parameters:querySchema,output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},execute:async args=>JSON.stringify(await delivery.query(ctx.agents.requireInitiator(),args))});
 ctx.tools.register({name:'bang_reception_status',description:'Check whether this Bang host adapter is receiving successfully.',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},execute:async()=>{await poll();return JSON.stringify({status:errorCode??'poll-complete'});}});
}
