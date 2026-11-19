import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createPrivateKey} from 'node:crypto';
import {locateTranscript} from '../runtime/bundle/transcript.mjs';
import {CodexSessionConnector} from '../runtime/codex/connector.mjs';
import {readCodexInstall} from '../runtime/codex/context-delivery.mjs';
import {openCodexTranscriptTransport} from '../runtime/codex/transcript-transport.mjs';
import {runtimeOperation} from '../runtime/native/runtime.mjs';

export async function installSkill(root,skillsDirectory){
  const dir=path.join(skillsDirectory??path.join(os.homedir(),'.agents','skills'),'bang-bundle');
  const file=path.join(dir,'SKILL.md');
  const code=JSON.stringify([process.execPath,path.join(root,'release','bang.mjs'),'up','--project']);
  const template=await fs.readFile(path.join(root,'skills','bang-bundle','SKILL.md'),'utf8');
  const content=template.replace('@@BANG_COMMAND@@',()=>code);
  await fs.mkdir(dir,{recursive:true});
  try{await fs.writeFile(file,content,{flag:'wx',mode:0o644});}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    if(await fs.readFile(file,'utf8')!==content)throw Error('已有不同的 bang-bundle 技能，请先审阅并迁移：'+file);
  }
  return {installed:file};
}

export async function startBundle(project,{executable,model,topicId}){
  const authHome=await fs.realpath(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'));
  const target=await locateTranscript({}, {...process.env,CODEX_HOME:authHome});
  const call=(command,input)=>runtimeOperation(project,command,undefined,input);
  const transport=await openCodexTranscriptTransport({threadId:target.chatId,transcript:target.transcript});
  const turnId=transport.activeTurnId;
  if(!turnId||(process.env.CODEX_TURN_ID&&process.env.CODEX_TURN_ID!==turnId))throw Error('无法核对调用技能的当前 Codex 活动轮');
  try{
    const thread=await new CodexSessionConnector({project,transport}).identity(target.chatId);
    if(thread.sessionId!==target.chatId)throw Error('Host session identity does not match the current chat');
    if(process.platform==='win32'){
      // The independent CLI also uses its authenticated home for host state.
      // A Runtime launched with the restricted shell token inherits that token.
      let probe;
      try{probe=await fs.mkdtemp(path.join(authHome,'bang-access-'));}
      catch(error){
        if(['EACCES','EPERM'].includes(error.code))throw Error('BANG_WINDOWS_HOST_ACCESS: use Codex approval to run this exact initialization command with normal Windows user access');
        throw error;
      }
      await fs.rmdir(probe);
    }
    const {status,ownership}=await call('start');
    if(status!=='running'||ownership!=='os-handle')throw Error('Bang Runtime did not start');
    await call('bundle-prepare',{executable,authHome,model});
    const install=readCodexInstall(project);
    const connector=new CodexSessionConnector({project,transport,connectorId:install.connectorId,
      instanceId:install.instanceId,privateKey:createPrivateKey(install.privateKey),runtimeCall:call});
    const session={sessionId:target.chatId,turnId};
    let binding=await connector.enableSession(session,{scope:['*'],topicId});
    if(binding.status==='takeover-required'&&binding.oldSource.host==='codex'&&binding.oldSource.instanceId===install.instanceId){
      binding=await connector.enableSession(session,{scope:['*'],topicId:binding.topic.id,confirmation:binding.confirmation});
    }
    if(binding.status!=='bound'){
      return {initialized:false,status:binding.status,topics:binding.topics??[binding.topic]};
    }
    const topic=binding.topic.id;
    await call('codex-watch',{topicId:topic,sourceId:binding.source.id,transcript:target.transcript});
    let organizer=await call('organizer-status',{topicId:topic});
    if(!organizer.enabled&&!organizer.pauseReason)organizer=await call('organizer-enable',{topicId:topic});
    const editor=await call('bundle-editor');
    const whiteboardUrl=new URL(editor.url);
    whiteboardUrl.searchParams.set('topic',topic);
    return {initialized:true,topic,whiteboardUrl:whiteboardUrl.href,boundToCurrentHost:true,
      startTurnId:binding.source.startTurnId,workerRunning:true,organizerEnabled:organizer.enabled,
      organizerPauseReason:organizer.pauseReason,completedTurns:binding.source.completedTurns};
  }finally{transport.close();}
}
