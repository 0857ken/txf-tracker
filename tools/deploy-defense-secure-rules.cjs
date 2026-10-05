'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve('prod/tools/defense-runner/package.json'));
const {GoogleAuth}=req('google-auth-library');

async function api(url,options={}){
  const r=await fetch(url,options);
  if(!r.ok) throw new Error('HTTP_'+r.status+'_'+url.split('/').at(-1));
  return r.json();
}
async function patchRelease(headers,rulesetName){
  const url='https://firebaserules.googleapis.com/v1/projects/txf-tracker/releases/cloud.firestore?updateMask=rulesetName';
  const r=await fetch(url,{method:'PATCH',headers:{...headers,'content-type':'application/json'},
    body:JSON.stringify({name:'projects/txf-tracker/releases/cloud.firestore',rulesetName})});
  if(!r.ok) throw new Error('RELEASE_PATCH_'+r.status);
  return r.json();
}
async function probe(apiKey){
  const auth=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key='+encodeURIComponent(apiKey),{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({returnSecureToken:true})
  });
  if(!auth.ok) throw new Error('ANON_AUTH_'+auth.status);
  const a=await auth.json(),token=a.idToken,uid=a.localId;
  if(!token||!uid) throw new Error('ANON_AUTH_INCOMPLETE');
  const base='https://firestore.googleapis.com/v1/projects/txf-tracker/databases/(default)/documents/';
  const get=async p=>(await fetch(base+p,{headers:{authorization:'Bearer '+token}})).status;
  const legacy=await get('users/me/defensePreviews/privacy-probe/state/account');
  const own=await get('defenseUsers/'+encodeURIComponent(uid)+'/strategies/0050-defense-v1/state/account');
  const other=await get('defenseUsers/not-'+encodeURIComponent(uid)+'/strategies/0050-defense-v1/state/account');
  const unauth=(await fetch(base+'defenseUsers/'+encodeURIComponent(uid)+'/strategies/0050-defense-v1/state/account')).status;
  return {legacy,own,other,unauth};
}
async function main(){
  if(!process.env.FIREBASE_KEY) throw new Error('CREDENTIAL_UNAVAILABLE');
  const credentials=JSON.parse(process.env.FIREBASE_KEY);
  if(credentials.project_id!=='txf-tracker') throw new Error('WRONG_PROJECT');
  const candidate=fs.readFileSync('firestore.rules','utf8');
  if(!candidate.includes('match /defenseUsers/{userId}/{document=**}')||
     !candidate.includes('request.auth.uid == userId')||
     !candidate.includes('match /users/me/{document=**}')) throw new Error('CANDIDATE_RULE_GUARD');

  const auth=new GoogleAuth({credentials,scopes:['https://www.googleapis.com/auth/cloud-platform']});
  const client=await auth.getClient(),rawHeaders=await client.getRequestHeaders();
  const headers=typeof rawHeaders.entries==='function'?Object.fromEntries(rawHeaders.entries()):Object.fromEntries(Object.entries(rawHeaders));
  const rel=await api('https://firebaserules.googleapis.com/v1/projects/txf-tracker/releases/cloud.firestore',{headers});
  const oldRuleset=rel.rulesetName;
  const old=await api('https://firebaserules.googleapis.com/v1/'+oldRuleset,{headers});
  const oldText=(old.source?.files||[]).map(f=>f.content||'').join('\n');
  if(!oldText.includes('match /users/me/{document=**}')||
     !oldText.includes('allow read, write: if request.auth != null;')||
     !oldText.includes('allow read, write: if false;')) throw new Error('CURRENT_RULES_CHANGED_STOP');

  const created=await api('https://firebaserules.googleapis.com/v1/projects/txf-tracker/rulesets',{
    method:'POST',headers:{...headers,'content-type':'application/json'},
    body:JSON.stringify({source:{files:[{name:'firestore.rules',content:candidate}]}})
  });
  let activated=false;
  try{
    await patchRelease(headers,created.name); activated=true;
    const source=fs.readFileSync('prod/firebase-init.js','utf8');
    const m=source.match(/apiKey:\s*"([^"]+)"/); if(!m) throw new Error('PUBLIC_FIREBASE_KEY_NOT_FOUND');
    const p=await probe(m[1]);
    console.log(JSON.stringify({rulesActivated:true,legacyAuthenticatedAccess:p.legacy,secureSelfAccess:p.own,secureOtherAccess:p.other,secureUnauthenticatedAccess:p.unauth}));
    if(![200,404].includes(p.legacy)||![200,404].includes(p.own)||p.other!==403||p.unauth!==403)
      throw new Error('SECURITY_PROBE_FAILED');
  }catch(e){
    if(activated) await patchRelease(headers,oldRuleset);
    throw e;
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
