import fs from 'node:fs';

const source=fs.readFileSync('firebase-init.js','utf8');
const match=source.match(/apiKey:\s*"([^"]+)"/);
if(!match) throw new Error('FIREBASE_PUBLIC_API_KEY_NOT_FOUND');
const apiKey=match[1];

const auth=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key='+encodeURIComponent(apiKey),{
  method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({returnSecureToken:true})
});
if(!auth.ok) throw new Error('ANONYMOUS_AUTH_FAILED_'+auth.status);
const token=(await auth.json()).idToken;
if(!token) throw new Error('ANONYMOUS_TOKEN_MISSING');

const target='https://firestore.googleapis.com/v1/projects/txf-tracker/databases/(default)/documents/users/me/defenseStrategies/0050-defense-v1/state/account';
const response=await fetch(target,{headers:{authorization:'Bearer '+token}});
console.log('fresh_anonymous_production_read_http='+response.status);
if(response.status!==403) throw new Error('PRODUCTION_NAMESPACE_NOT_PRIVATE_TO_FRESH_ANONYMOUS_IDENTITY');
