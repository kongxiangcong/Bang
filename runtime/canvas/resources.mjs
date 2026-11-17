import fs from 'node:fs';
import path from 'node:path';
import {safeResourcePath} from './contract.ts';
// Never read or download resource bytes. Reject every symlink component (including
// dangling links) so a reference cannot turn a project-relative path into an escape.
export function resourceStatus(project,reference){
 const relative=safeResourcePath(reference),root=fs.realpathSync(project);
 let current=root;
 for(const part of relative.split('/')){
  current=path.join(current,part);
  try {if(fs.lstatSync(current).isSymbolicLink())throw Error('Unsafe resource path');}
  catch(error){if(error.code==='ENOENT')return {status:'missing'};throw Error('Unsafe resource path');}
 }
 const real=fs.realpathSync(current),within=path.relative(root,real);
 if(within.startsWith('..')||path.isAbsolute(within))throw Error('Unsafe resource path');
 return {status:fs.statSync(real).isFile()?'available':'missing'};
}
export function validateResources(project,canvas){
 for(const card of canvas.nodes){if(card.type==='file')resourceStatus(project,card.file);if(card.type==='group'&&card.background)resourceStatus(project,card.background);}
}
