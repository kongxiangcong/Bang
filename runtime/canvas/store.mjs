import fs from 'node:fs/promises';
import path from 'node:path';
import {compileCanvas,validateCanvas} from './contract.ts';
export function topicPath(project,topic){
 if(!project||!topic||! /^[a-zA-Z0-9_-]+$/.test(topic))throw Error('Explicit project and safe topic are required');
 return path.join(path.resolve(project),'.bang','topics',topic,'current.canvas');
}
export async function readBoard(project,topic){return validateCanvas(JSON.parse(await fs.readFile(topicPath(project,topic),'utf8')));}
// Bootstrap only. Existing topics are never overwritten by generation.
export async function generateBoard(project,topic,input){
 const board=compileCanvas(input),file=topicPath(project,topic);
 await fs.mkdir(path.dirname(file),{recursive:true});
 await fs.writeFile(file,JSON.stringify(board,null,2)+'\n',{flag:'wx'});
 return board;
}
