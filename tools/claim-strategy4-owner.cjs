'use strict';
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve('prod/tools/defense-runner/package.json'));
const {initializeApp,cert}=req('firebase-admin/app');
const {getFirestore,FieldValue}=req('firebase-admin/firestore');
const {getAuth}=req('firebase-admin/auth');
const crypto=require('node:crypto');
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex').slice(0,12);

async function main(){
  const credentials=JSON.parse(process.env.FIREBASE_KEY||'{}');
  if(credentials.project_id!=='txf-tracker') throw new Error('WRONG_PROJECT');
  initializeApp({credential:cert(credentials)});
  const db=getFirestore(),auth=getAuth(),ownerRef=db.doc('strategy4System/owner');
  const prior=await ownerRef.get();
  if(prior.exists){
    const uid=String(prior.data()?.uid||'');
    console.log('owner_already_exists=true');
    console.log('owner_uid_hash='+hash(uid));
    return;
  }
  let pageToken,users=[];
  do{const p=await auth.listUsers(1000,pageToken);users.push(...p.users);pageToken=p.pageToken;}while(pageToken);
  const pw=users.filter(u=>!u.disabled&&(u.providerData||[]).some(p=>p.providerId==='password'));
  if(pw.length!==1) throw new Error('OWNER_CANDIDATE_COUNT_'+pw.length);
  const uid=pw[0].uid;
  await db.runTransaction(async tx=>{
    const fresh=await tx.get(ownerRef);
    if(fresh.exists) return;
    tx.create(ownerRef,{uid,strategyId:'0050-defense-v1',claimedAt:FieldValue.serverTimestamp(),source:'guarded-single-password-user'});
  });
  const check=await ownerRef.get();
  if(!check.exists||check.data()?.uid!==uid) throw new Error('OWNER_CLAIM_VERIFY_FAILED');
  console.log('owner_claimed=true');
  console.log('owner_uid_hash='+hash(uid));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
