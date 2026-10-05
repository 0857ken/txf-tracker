'use strict';
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve('prod/tools/defense-runner/package.json'));
const {initializeApp,cert}=req('firebase-admin/app');
const {getFirestore}=req('firebase-admin/firestore');
const {getAuth}=req('firebase-admin/auth');
const crypto=require('node:crypto');

async function main(){
  if(!process.env.FIREBASE_KEY) throw new Error('CREDENTIAL_UNAVAILABLE');
  const credentials=JSON.parse(process.env.FIREBASE_KEY);
  if(credentials.project_id!=='txf-tracker') throw new Error('WRONG_PROJECT');
  initializeApp({credential:cert(credentials)});
  const db=getFirestore();
  const owner=await db.doc('strategy4System/owner').get();
  console.log('owner_exists='+owner.exists);
  if(!owner.exists) return;
  const uid=String(owner.data()?.uid||'');
  console.log('owner_uid_valid='+/^[A-Za-z0-9_-]{8,128}$/.test(uid));
  console.log('owner_uid_hash='+crypto.createHash('sha256').update(uid).digest('hex').slice(0,12));
  const root='defenseUsers/'+uid+'/strategies/0050-defense-v1';
  const [account,snaps,health]=await Promise.all([
    db.doc(root+'/state/account').get(),
    db.collection(root+'/dailySnapshots').get(),
    db.doc(root+'/state/health').get()
  ]);
  console.log('account_exists='+account.exists);
  console.log('snapshot_count='+snaps.size);
  console.log('health_exists='+health.exists);
  if(account.exists){
    const a=account.data()||{};
    console.log('account_revision='+(a.revision??''));
    console.log('account_equity_date='+(a.equityDate??''));
  }
  try{
    const user=await getAuth().getUser(uid);
    console.log('auth_user_exists=true');
    console.log('auth_disabled='+Boolean(user.disabled));
    console.log('auth_providers='+(user.providerData||[]).map(p=>p.providerId).sort().join(','));
  }catch(e){
    console.log('auth_user_exists=false');
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
