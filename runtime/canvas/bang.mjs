import {runtimeOperation} from '../native/runtime.mjs';
const [command,...args]=process.argv.slice(2);
const option=name=>args[args.indexOf(name)+1];
try{
 if(!args.includes('--project'))throw Error('Usage: bang.mjs start|status|stop|generate|read|state|head|preview|commit|history|history-preview|history-diff|undo --project DIR [--topic ID]');
 const project=option('--project'),topic=args.includes('--topic')?option('--topic'):undefined;
 let input;
 if(['recover','generate','commit','preview','history-preview','history-diff','undo'].includes(command)){process.stdin.setEncoding('utf8');let body='';for await(const chunk of process.stdin)body+=chunk;input=JSON.parse(body);}
 process.stdout.write(JSON.stringify(await runtimeOperation(project,command,topic,input))+'\n');
}catch(error){process.stderr.write(String(error.message)+'\n');process.exitCode=1;}


