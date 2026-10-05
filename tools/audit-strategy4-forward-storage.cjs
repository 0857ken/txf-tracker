'use strict';
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve('prod/tools/defense-runner/package.json'));
const {initializeApp,cert}=req('firebase-admin/app');
const {getFirestore}=req('firebase-admin/firestore');
const {getAuth}=req('firebase-admin/auth');

async function main(){
  const credentials=JSON.parse(process.env.FIREBASE_KEY||'{}');
  initializeApp({credential:cert(credentials)});
  const db=getFirestore(),auth=getAuth();
  let pageToken,users=[];
  do{const page=await auth.listUsers(1000,pageToken);users.push(...page.users);pageToken=page.pageToken;}while(pageToken);
  const pw=users.filter(u=>(u.providerData||[]).some(p=>p.providerId==='password'));
  console.log('password_user_count='+pw.length);
  if(pw.length===1){
    const uid=pw[0].uid, root='defenseUsers/'+uid+'/strategies/0050-defense-v1';
    for(const [label,path] of [
      ['uid_account',root+'/state/account'],
      ['uid_health',root+'/state/health'],
      ['uid_market',root+'/market/latest']
    ]){
      const d=await db.doc(path).get();
      console.log(label+'_exists='+d.exists);
      if(d.exists){
        const x=d.data()||{};
        console.log(label+'_revision='+(x.revision??''));
        console.log(label+'_updatedAt='+(x.updatedAt??x.asof??''));
      }
    }
  }
  for(const [label,path] of [
    ['legacy_prod','users/me/defenseStrategies/0050-defense-v1/state/account'],
    ['legacy_preview','users/me/defensePreviews/0050-defense-v1-preview/state/account']
  ]){
    const d=await db.doc(path).get();
    console.log(label+'_exists='+d.exists);
    if(d.exists){
      const x=d.data()||{};
      console.log(label+'_revision='+(x.revision??''));
      console.log(label+'_updatedAt='+(x.updatedAt??x.asof??''));
      console.log(label+'_equityDate='+(x.equityDate??''));
    }
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
