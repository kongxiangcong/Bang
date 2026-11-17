export const name='bang-organizer-guard';
export const inject=['tools','credentials'];
export function apply(ctx){
 ctx.tools.guard(()=> 'Bang Organizer forbids all tools');
 ctx.on('agent/pre-step',async({agent},next)=>{
  if(ctx.tools.schemas(agent).length!==0)throw Error('EXECUTOR_CONFIGURATION');
  const info=await ctx.credentials.describe('DEEPSEEK_API_KEY');
  if(!info.configured)throw Error('AUTH_REQUIRED');
  return next();
 });
}
