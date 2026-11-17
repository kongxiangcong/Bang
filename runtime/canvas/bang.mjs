import {generateBoard,readBoard} from './store.mjs';
const [command,...args]=process.argv.slice(2);
const option=name=>args[args.indexOf(name)+1];
try{
 if(!args.includes('--project')||!args.includes('--topic'))throw Error('Usage: bang.mjs generate|read --project DIR --topic ID');
 const project=option('--project'),topic=option('--topic');
 let result;
 if(command==='generate'){let input='';for await(const chunk of process.stdin)input+=chunk;result=await generateBoard(project,topic,JSON.parse(input));}
 else if(command==='read') result=await readBoard(project,topic);
 else throw Error('Unknown command');
 process.stdout.write(JSON.stringify(result)+'\n');
}catch(error){process.stderr.write(String(error.message)+'\n');process.exitCode=1;}
