import {createHash} from 'node:crypto';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
// This runs in the trusted main-host adapter, never the Runtime owner queue.
// call signs each command with the independently provisioned ContextBridge key.
// deliver must return an exact host receipt, not an assertion about model use.
export async function deliverContext({call,deliver,timeoutMs=1500,budgetBytes=16384}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<10||timeoutMs>1500)throw Error('Delivery timeout must be 10–1500 ms');
 let timer;const controller=new AbortController();let started;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Delivery deadline'));},timeoutMs);});
 try{
  const task=(async()=>{started=await call('context-start',{budgetBytes});if(controller.signal.aborted)throw Error('Delivery deadline');const envelopeHash=digest(started.envelope),receipt=await deliver({envelope:started.envelope,envelopeHash,query:input=>call('context-query',{...input,token:started.token}),signal:controller.signal});if(controller.signal.aborted||receipt?.envelopeHash!==envelopeHash||receipt?.accepted!==true)throw Error('Host delivery not acknowledged');const ack=await call('context-ack',{token:started.token,envelopeHash,outcome:'delivered'});return {...ack,continueConversation:true};})();
  return await Promise.race([task,deadline]);
 }catch{
  // A failed acknowledgement must not hold up conversation either. The Runtime
  // deadline independently makes an abandoned pending record visibly unsynced.
  if(started){let ackTimer;try{await Promise.race([Promise.resolve(call('context-ack',{token:started.token,envelopeHash:digest(started.envelope),outcome:'unsynced'})).catch(()=>{}),new Promise(r=>ackTimer=setTimeout(r,200))]);}finally{clearTimeout(ackTimer);}}
  return {status:'unsynced',revision:started?.envelope.revision,modelUse:'unknown',continueConversation:true,manualFallback:'knowledge-context'};
 }finally{clearTimeout(timer);}
}
