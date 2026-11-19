import fs from 'node:fs';
import path from 'node:path';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {registerConnector} from '../canvas/binding.mjs';
import {CODEX_VERSION,codexConfiguration,projectCodexConfiguration} from './executor-config.mjs';
import {readCodexInstall} from './context-delivery.mjs';

// Called in the native owner's operation queue. Existing installations retain
// their connector identity, including keys provisioned for reviewed hooks.
export function prepareBundle(project,{executable,authHome,model}){
  const dir=path.join(project,'.bang','runtime');
  const organizer=JSON.stringify({version:1,executable,authHome,model,inheritProxy:true});
  const current=projectCodexConfiguration(project);
  if(current && current!==organizer)throw Error('Bang already has a different project Organizer configuration');
  if([process.env.BANG_ORGANIZER_ENDPOINT,process.env.BANG_ORGANIZER_NATIVE,process.env.BANG_ORGANIZER_DSH,process.env.BANG_ORGANIZER_CODEX].some(Boolean))throw Error('This Runtime has an externally configured Organizer');
  if(!codexConfiguration(organizer))throw Error('Codex Organizer configuration unavailable');

  const installPath=path.join(dir,'codex-install.json');
  if(fs.lstatSync(installPath,{throwIfNoEntry:false})){
    if(readCodexInstall(project).executable!==executable)throw Error('Existing Codex registration uses another executable');
  }else{
    const {privateKey,publicKey}=generateKeyPairSync('ed25519');
    const connectorId='codex-'+randomUUID();
    registerConnector(project,{id:connectorId,host:'codex',versions:[CODEX_VERSION],publicKey:publicKey.export({format:'pem',type:'spki'})});
    publish(installPath,{executable,connectorId,instanceId:randomUUID(),privateKey:privateKey.export({format:'pem',type:'pkcs8'})});
  }
  if(!current)publish(path.join(dir,'bundle-organizer.json'),JSON.parse(organizer));
  return {status:'prepared'};
}

function publish(file,value){
  const temporary=file+'.'+randomUUID();
  fs.writeFileSync(temporary,JSON.stringify(value),{flag:'wx',mode:0o600});
  try{fs.renameSync(temporary,file);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
