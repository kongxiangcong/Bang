import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {runtimeOperation} from '../native/runtime.mjs';
// Explicit provisioning command; never executes DSH, reads credentials, or edits host config.
const project=fs.realpathSync(process.argv[2]??'.');
const {workspaceId}=await runtimeOperation(project,'start');
const directory=path.join(project,'.bang','runtime','dsh');fs.mkdirSync(directory,{recursive:true,mode:0o700});
const manifestFile=path.join(directory,'manifest.json');
if(!fs.existsSync(manifestFile)){
 const {privateKey,publicKey}=generateKeyPairSync('ed25519'),connectorId='dsh-'+randomUUID();
 const privateKeyFile=path.join(directory,'signing-key.pem');fs.writeFileSync(privateKeyFile,privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
 await runtimeOperation(project,'connector-register',undefined,{id:connectorId,host:'dsh',versions:['0.2.1-rc.2'],publicKey:publicKey.export({type:'spki',format:'pem'})});
 fs.writeFileSync(manifestFile,JSON.stringify({project,connectorId,instanceId:randomUUID(),hostVersion:'0.2.1-rc.2',scope:['*'],privateKeyFile}),{flag:'wx',mode:0o600});
}
const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
if(!manifest.bridgeId){
 const {privateKey,publicKey}=generateKeyPairSync('ed25519'),bridgeId='context-'+randomUUID();
 const bridgeKeyFile=path.join(directory,bridgeId+'.pem');
 fs.writeFileSync(bridgeKeyFile,privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
 await runtimeOperation(project,'context-register',undefined,{id:bridgeId,host:'dsh',versions:[manifest.hostVersion],publicKey:publicKey.export({type:'spki',format:'pem'})});
 const temp=manifestFile+'.'+randomUUID();
 fs.writeFileSync(temp,JSON.stringify({...manifest,bridgeId,bridgeKeyFile,workspaceId}),{flag:'wx',mode:0o600});
 fs.renameSync(temp,manifestFile);
}
const plugin=fileURLToPath(new URL('./plugin.mjs',import.meta.url));
const overlay=path.join(directory,'overlay.yml');
fs.writeFileSync(overlay,`- insert:\n    - id: bang-session-connector\n      name: ${JSON.stringify(plugin.replaceAll('\\','/'))}\n      config:\n        manifest: ${JSON.stringify(manifestFile.replaceAll('\\','/'))}\n`,{mode:0o600});
console.log(JSON.stringify({manifest:manifestFile,overlay,activation:'Load the reviewed overlay using dsh --patch; invoke bang_enable from the authorized root turn.'}));
