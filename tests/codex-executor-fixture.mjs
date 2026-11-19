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
const task=JSON.parse(input.slice(input.lastIndexOf('\n')+1));
if(mode==='selection'&&!input.startsWith('Selected reorganization mode:'))throw Error('Missing trusted selection policy');
if(mode==='tool')console.log(JSON.stringify({type:'item.completed',item:{type:'command_execution',command:'PRIVATE_TOOL'}}));
console.log(JSON.stringify({type:'thread.started',thread_id:'controlled'}));console.log(JSON.stringify({type:'turn.started'}));
const candidate=mode==='selection'?{version:1,changes:task.selection.ids.map(id=>({type:'reorganize-card',id,structure:null,reason:'No explicit structural relations; remain free'}))}:{version:1,changes:[{type:'create-card',id:'codex-card',text:task.completedTurns[0].assistant.content,conditions:[],uncertainty:'controlled external CLI',sources:[task.completedTurns[0].id],...(mode==='timeline'?{structure:{version:1,kind:'timeline',rootId:'codex-card',eventTime:null}}:{})}]};
if(mode==='timeline'||mode==='selection'){
 const schema=JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));
 function matches(s,v){if(s.anyOf)return s.anyOf.some(x=>matches(x,v));if('const'in s&&s.const!==v||s.enum&&!s.enum.includes(v))return false;const types=Array.isArray(s.type)?s.type:[s.type];if(s.type&&!types.some(t=>t==='null'?v===null:t==='array'?Array.isArray(v):t==='integer'?Number.isInteger(v):t==='object'?v!==null&&typeof v==='object'&&!Array.isArray(v):typeof v===t))return false;if(s.items&&Array.isArray(v)&&v.some(x=>!matches(s.items,x)))return false;if(s.properties){if(s.required?.some(k=>!(k in v)))return false;if(s.additionalProperties===false&&Object.keys(v).some(k=>!(k in s.properties)))return false;for(const [k,x] of Object.entries(v))if(s.properties[k]&&!matches(s.properties[k],x))return false;}return true;}
 if(!matches(schema,candidate)){console.log(JSON.stringify({type:'turn.failed',error:{message:'400 Candidate cannot satisfy requested structured output schema'}}));process.exit(1);}
}
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(candidate)}}));
if(mode==='failed-terminal')console.log(JSON.stringify({type:'turn.failed',error:{message:'unavailable'}}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:42,output_tokens:17}}));
