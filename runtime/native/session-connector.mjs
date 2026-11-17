import {createPublicKey,verify} from 'node:crypto';

// SessionConnector boundary: a host adapter vouches for identity using its
// independently provisioned signing key. A caller-supplied session ID is not proof.
export class SessionConnector {
 verifyProof(){throw Error('Binding unavailable: connector has no trusted verifier');}
}
export class SignedSessionConnector extends SessionConnector {
 constructor(registration){super();this.registration=registration;}
 verifyProof(proof,workspaceId,purpose='session-binding'){
  const failure=()=>{throw Error('Binding unavailable: session proof rejected');};
  try{
   if(typeof proof?.payload!=='string'||typeof proof.signature!=='string'||proof.payload.length>16000)failure();
   const key=createPublicKey(this.registration.publicKey);
   if(key.asymmetricKeyType!=='ed25519'||!verify(null,Buffer.from(proof.payload),key,Buffer.from(proof.signature,'base64url')))failure();
   const c=JSON.parse(Buffer.from(proof.payload,'base64url').toString('utf8'));
   if((c.purpose??'session-binding')!==purpose)failure();
   for(const field of ['host','version','instanceId','sessionId','workspaceId','turnId','cursor','nonce'])if(typeof c[field]!=='string'||!c[field]||c[field].length>256)failure();
   if(c.host!==this.registration.host||!this.registration.versions.includes(c.version)||c.workspaceId!==workspaceId||c.role!=='primary')failure();
   if(!Array.isArray(c.scope)||!c.scope.length||c.scope.some(s=>typeof s!=='string'||!/^([a-zA-Z0-9_-]+|\*)$/.test(s)))failure();
   if(!Number.isSafeInteger(c.issuedAt)||!Number.isSafeInteger(c.expiresAt)||c.issuedAt>Date.now()+10000||c.expiresAt<=Date.now()||c.expiresAt-c.issuedAt>300000)failure();
   // Whitelist metadata: never persist caller text, tools or other message bodies.
   return Object.fromEntries(['host','version','instanceId','sessionId','workspaceId','turnId','cursor','scope','nonce','expiresAt'].map(k=>[k,c[k]]));
  }catch{failure();}
 }
}
