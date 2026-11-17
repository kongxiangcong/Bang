import {generateBoard,readBoard,readCommitted,commitBoard} from './store.mjs';
const [command,...args]=process.argv.slice(2);
const option=name=>args[args.indexOf(name)+1];
try{
 if(!args.includes('--project')||!args.includes('--topic'))throw Error('Usage: bang.mjs generate|read|state|commit --project DIR --topic ID');
 const project=option('--project'),topic=option('--topic');
 let result;
 if(command==='generate'||command==='commit'){let input='';for await(const chunk of process.stdin)input+=chunk;result=command==='generate'?await generateBoard(project,topic,JSON.parse(input)):await commitBoard(project,topic,JSON.parse(input));}
 else if(command==='read')result=await readBoard(project,topic);
 else if(command==='state')result=await readCommitted(project,topic);
 else throw Error('Unknown command');
 process.stdout.write(JSON.stringify(result)+'\n');
}catch(error){process.stderr.write(String(error.message)+'\n');process.exitCode=1;}
