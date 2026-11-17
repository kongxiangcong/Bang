import fs from 'node:fs';
const args=process.argv.slice(2),mode=args.shift();
if(args.includes('--version')){console.log('codex-cli 0.169.0-alpha.11.1');process.exit(0);}
if(args[0]==='debug'){console.log(JSON.stringify({models:[{slug:'gpt-6.1-sol',apply_patch_tool_type:'freeform',experimental_supported_tools:['clock'],supports_search_tool:true}]}));process.exit(0);}
if(args[0]==='login'&&mode==='preflight-auth'){console.error('Not logged in');process.exit(1);}
if(args[0]==='login'){console.error('Logged in using ChatGPT');process.exit(0);}
let input='';for await(const chunk of process.stdin)input+=chunk;
if(mode==='hang'){setInterval(()=>{},1000);await new Promise(()=>{});}
if(mode==='budget'){console.log(JSON.stringify({type:'turn.failed',error:{message:'429 usage limit reached PRIVATE_PROVIDER_DETAIL'}}));process.exit(1);}
if(mode==='auth'){console.log(JSON.stringify({type:'turn.failed',error:{message:'401 Unauthorized PRIVATE_PROVIDER_DETAIL'}}));process.exit(1);}
if(mode==='proxy'&&process.env.HTTPS_PROXY!=='http://127.0.0.1:12345')process.exit(1);
if(mode==='strict-schema'){const schema=JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));const visit=v=>{if(!v||typeof v!=='object')return;if(('const' in v||'enum' in v)&&!v.type)throw Error('type required');for(const x of Object.values(v))visit(x);};try{visit(schema);}catch{console.log(JSON.stringify({type:'turn.failed',error:{message:'400 Invalid schema: type required'}}));process.exit(1);}}
const task=JSON.parse(input.slice(input.indexOf('\n')+1));
if(mode==='tool')console.log(JSON.stringify({type:'item.completed',item:{type:'command_execution',command:'PRIVATE_TOOL'}}));
console.log(JSON.stringify({type:'thread.started',thread_id:'controlled'}));console.log(JSON.stringify({type:'turn.started'}));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({version:1,changes:[{type:'create-card',id:'codex-card',text:task.completedTurns[0].assistant.content,conditions:[],uncertainty:'controlled external CLI',sources:[task.completedTurns[0].id]}]})}}));
if(mode==='failed-terminal')console.log(JSON.stringify({type:'turn.failed',error:{message:'unavailable'}}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:42,output_tokens:17}}));
