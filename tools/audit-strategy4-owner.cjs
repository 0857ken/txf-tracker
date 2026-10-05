'use strict';
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve('prod/tools/defense-runner/package.json'));
const {initializeApp,cert,deleteApp}=req('firebase-admin/app');
const {getFirestore}=req('firebase-admin/firestore');
const {getAuth}=req('firebase-admin/auth');

async function main(){
  if(!process.env.FIREBASE_KEY) throw new Error('CREDENTIAL_UNAVAILABLE');
  const credential=JSON.parse(process.env.FIREBASE_KEY);
  if(credential.project_id!=='txf-tracker') throw new Error('WRONG_PROJECT');
  const app=initializeApp({credential:cert(credential)});
  const db=getFirestore(app);
  const snap=await db.doc('strategy4System/owner').get();
  if(!snap.exists){
    console.log(JSON.stringify({ownerPinned:false,stableOwner:false,status:'OWNER_NOT_PINNED'}));
    await db.terminate(); await deleteApp(app); return;
  }
  const uid=String(snap.data().uid||'');
  if(!/^[A-Za-z0-9_-]{8,128}$/.test(uid)) throw new Error('OWNER_UID_INVALID');
  let stable=false,providerIds=[];
  try{
    const user=await getAuth(app).getUser(uid);
    providerIds=(user.providerData||[]).map(x=>x.providerId).sort();
    stable=!user.disabled && providerIds.includes('password') && !!user.email;
  }catch(error){
    if(error?.code!=='auth/user-not-found') throw error;
  }
  console.log(JSON.stringify({ownerPinned:true,stableOwner:stable,passwordProvider:providerIds.includes('password'),status:stable?'READY':'OWNER_NOT_STABLE'}));
  await db.terminate(); await deleteApp(app);
}
main().catch(e=>{console.error(String(e.message||e));process.exitCode=1;});
