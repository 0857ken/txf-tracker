'use strict';
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve('prod/tools/defense-runner/package.json'));
const {initializeApp,cert}=req('firebase-admin/app');
const {getAuth}=req('firebase-admin/auth');
async function main(){
  const credentials=JSON.parse(process.env.FIREBASE_KEY||'{}');
  initializeApp({credential:cert(credentials)});
  const auth=getAuth(); let pageToken, users=[];
  do{const p=await auth.listUsers(1000,pageToken);users.push(...p.users);pageToken=p.pageToken;}while(pageToken);
  const pw=users.filter(u=>(u.providerData||[]).some(p=>p.providerId==='password'));
  console.log('password_user_count='+pw.length);
  if(pw.length===1){
    const u=pw[0];
    console.log('created_at='+(u.metadata?.creationTime||''));
    console.log('last_sign_in='+(u.metadata?.lastSignInTime||''));
    console.log('disabled='+Boolean(u.disabled));
    console.log('email_verified='+Boolean(u.emailVerified));
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
