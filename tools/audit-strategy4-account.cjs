'use strict';
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve('prod/tools/defense-runner/package.json'));
const {initializeApp,cert}=req('firebase-admin/app');
const {getFirestore}=req('firebase-admin/firestore');

async function main(){
  if(!process.env.FIREBASE_KEY) throw new Error('CREDENTIAL_UNAVAILABLE');
  const credentials=JSON.parse(process.env.FIREBASE_KEY);
  initializeApp({credential:cert(credentials)});
  const db=getFirestore();
  const owner=await db.doc('strategy4System/owner').get();
  if(!owner.exists) throw new Error('OWNER_MISSING');
  const uid=String(owner.data()?.uid||'');
  const ref=db.doc('defenseUsers/'+uid+'/strategies/0050-defense-v1/state/account');
  const snap=await ref.get();
  if(!snap.exists) throw new Error('ACCOUNT_MISSING');
  const a=snap.data()||{};
  console.log(JSON.stringify({
    revision:a.revision??null,
    asof:a.asof??null,
    equityDate:a.equityDate??null,
    equity:a.equity??null,
    outside:a.outside??null,
    positions:(a.positions||[]).map(p=>({product:p.product,month:p.month,lots:p.lots,mark:p.mark})),
    updatedAt:a.updatedAt??null
  },null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
