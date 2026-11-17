type BrowserSession={token:string;workspaceId:string};
let session:Promise<BrowserSession>|undefined;
export function canvasSession():Promise<BrowserSession>{
 return session??=fetch('/api/canvas/session/bootstrap',{cache:'no-store'}).then(async response=>{if(!response.ok)throw Error('无法连接本地白板');return await response.json() as BrowserSession;}).catch(error=>{session=undefined;throw error;});
}
export async function canvasFetch(url:string,options:RequestInit={}):Promise<Response>{
 const headers=new Headers(options.headers);headers.set('x-bang-browser-token',(await canvasSession()).token);
 return fetch(url,{...options,headers});
}
export async function canvasWorkspaceId():Promise<string>{return (await canvasSession()).workspaceId;}

