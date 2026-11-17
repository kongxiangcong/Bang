const args=process.argv.slice(2),mode=args.shift();
if(args.includes('--version')){console.log('0.2.1-rc.2');process.exit(0);}
let input='';for await(const chunk of process.stdin)input+=chunk;
if(mode==='hang'){setInterval(()=>{},1000);await new Promise(()=>{});}
if(['auth','budget'].includes(mode)){console.log(JSON.stringify({type:'error',message:(mode==='auth'?'401 AUTH_REQUIRED':'429 quota')+' PRIVATE_PROVIDER'}));process.exit(1);}
if(mode==='error-completed')console.log(JSON.stringify({type:'error',message:'PRIVATE_ERROR'}));
if(mode==='mixed')console.log(JSON.stringify({type:'status',phase:'turn_end',turn:'t1',reason:{kind:'error'}}));
if(mode==='tool')console.log(JSON.stringify({type:'tool_call',tool:'PRIVATE_TOOL'}));console.log(JSON.stringify({type:'thinking',text:'PRIVATE_REASONING'}));
const task=JSON.parse(input.slice(input.indexOf('\n')+1));
console.log(JSON.stringify({type:'session',sessionId:'controlled'}));
console.log(JSON.stringify({type:'status',phase:'turn_start',turn:'t1'}));
if(mode==='usage')console.log(JSON.stringify({type:'status',phase:'step_end',turn:'t1',usage:{inputTokens:10,outputTokens:3}}));
console.log(JSON.stringify({type:'status',phase:'step_end',turn:'t1',usage:{inputTokens:42,outputTokens:17}}));
if(mode!=='no-terminal')console.log(JSON.stringify({type:'status',phase:'turn_end',turn:mode==='wrong-turn'?'other':'t1',reason:{kind:'completed'}}));
console.log(JSON.stringify({type:'final',text:JSON.stringify({version:1,...(mode==='forged-usage'?{usage:{inputTokens:1,outputTokens:1}}:{}),changes:[{type:'create-card',id:'dsh-card',text:mode==='invalid'?123:task.completedTurns[0].assistant.content,conditions:[],uncertainty:'controlled external CLI',sources:[task.completedTurns[0].id]}]})}));




if(mode==='nonzero')process.exit(1);
