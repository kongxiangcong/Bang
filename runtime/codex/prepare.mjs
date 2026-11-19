import fs from 'node:fs';
import path from 'node:path';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import { codexHookFiles } from './hook-config.mjs';
import {runtimeOperation} from '../native/runtime.mjs';
import {CodexSessionConnector,CODEX_VERSION} from './connector.mjs';
import {readCodexInstall} from './context-delivery.mjs';

const project=fs.realpathSync(process.argv[2]),review=path.resolve(process.argv[3]??path.join(project,'.scratch','codex-hook-review'));
const executable=process.env.CODEX_APP_RUNTIME_CLI_PATH;
if(!executable||!path.isAbsolute(executable))throw Error('Pinned Codex executable required');
const {workspaceId}=await runtimeOperation(project,'start');
const manifest=path.join(project,'.bang','runtime','codex-install.json');
if(!fs.existsSync(manifest)){
 const {privateKey}=generateKeyPairSync('ed25519'),instanceId=randomUUID(),connectorId='codex-'+randomUUID();
 await new CodexSessionConnector({project,transport:null,connectorId,instanceId,privateKey}).register();
 fs.writeFileSync(manifest,JSON.stringify({executable,connectorId,instanceId,privateKey:privateKey.export({format:'pem',type:'pkcs8'})}),{mode:0o600,flag:'wx'});
}
const install=readCodexInstall(project);
if(install.bridge?.workspaceId!==workspaceId){
 const {publicKey,privateKey}=generateKeyPairSync('ed25519'),id='codex-context-'+randomUUID();
 await runtimeOperation(project,'context-register',undefined,{id,host:'codex',versions:[CODEX_VERSION],publicKey:publicKey.export({type:'spki',format:'pem'})});
 const bridge={id,workspaceId,privateKey:privateKey.export({type:'pkcs8',format:'pem'})},temporary=manifest+'.'+randomUUID();
 fs.writeFileSync(temporary,JSON.stringify({...install,bridge}),{flag:'wx',mode:0o600});
 try{fs.renameSync(temporary,manifest);}
 finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
fs.mkdirSync(review,{recursive:true});
const {command, hooks} = codexHookFiles(project);
fs.writeFileSync(path.join(review,'command.txt'),command);
fs.writeFileSync(path.join(review,'hooks.json'),hooks);
console.log(JSON.stringify({status:'prepared-not-installed',review,hostTrust:'required',activationPrompt:'Bang: enable current session'}));
