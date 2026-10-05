'use strict';
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve('prod/tools/defense-runner/package.json'));
const {initializeApp,cert}=req('firebase-admin/app');
const {getFirestore,FieldPath}=req('firebase-admin/firestore');
const crypto=require('node:crypto');

async function main(){
  if(!process.env.FIREBASE_KEY) throw new Error('CREDENTIAL_UNAVAILABLE');
  const credentials=JSON.parse(process.env.FIREBASE_KEY);
  if(credentials.project_id!=='txf-tracker') throw new Error('WRONG_PROJECT');
  initializeApp({credential:cert(credentials)});
  const db=getFirestore();

  const existing=await db.doc('strategy4System/owner').get();
  if(existing.exists){
    const uid=String(existing.data()?.uid||'');
    console.log('owner_already_locked=true');
    console.log('owner_uid_hash='+crypto.createHash('sha256').update(uid).digest('hex').slice(0,12));
    return;
  }

  const snap=await db.collectionGroup('state').where(FieldPath.documentId(),'==','account').get();
  const candidates=[];
  for(const d of snap.docs){
    const m=d.ref.path.match(/^defenseUsers\/([^/]+)\/strategies\/0050-defense-v1\/state\/account$/);
    if(!m) continue;
    const a=d.data()||{};
    if((Number(a.equity)||0)+(Number(a.outside)||0)<=0) continue;
    candidates.push({uid:m[1],path:d.ref.path,revision:a.revision??0,equityDate:a.equityDate??null});
  }
  console.log('formal_account_candidates='+candidates.length);
  if(candidates.length!==1) throw new Error('OWNER_CANDIDATE_COUNT_'+candidates.length);

  const c=candidates[0];
  await db.doc('strategy4System/owner').create({
    uid:c.uid,
    strategyId:'0050-defense-v1',
    lockedAt:new Date().toISOString(),
    source:'guarded-single-formal-account'
  });
  console.log('owner_locked=true');
  console.log('owner_uid_hash='+crypto.createHash('sha256').update(c.uid).digest('hex').slice(0,12));
  console.log('account_revision='+c.revision);
  console.log('account_equity_date='+(c.equityDate||''));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
