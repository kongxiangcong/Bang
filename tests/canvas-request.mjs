export async function canvasRequest(url,options={}){
 const session=new URL('/api/canvas/session',url);const {token}=await (await fetch(session)).json();
 return fetch(url,{...options,headers:{...options.headers,'x-bang-browser-token':token}});
}
