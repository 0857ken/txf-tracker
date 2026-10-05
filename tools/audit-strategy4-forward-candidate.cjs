'use strict';
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve('prod/tools/defense-runner/package.json'));
const {initializeApp,cert}=req('firebase-admin/app');
const {getFirestore}=req('firebase-admin/firestore');
const {getAuth}=req('firebase-admin/auth');
const crypto=require('node:crypto');

const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex').slice(0,12);

async function main(){
  const credentials=JSON.parse(process.env.FIREBASE_KEY||'{}');
  if(credentials.project_id!=='txf-tracker') throw new Error('WRONG_PROJECT');
  initializeApp({credential:cert(credentials)});
  const db=getFirestore(), auth=getAuth();
  const owner=await db.doc('strategy4System/owner').get();
  console.log('owner_exists='+owner.exists);
  let pageToken, users=[], formal=0, candidates=[];
  do{
    const page=await auth.listUsers(1000,pageToken);
    users.push(...page.users);
    pageToken=page.pageToken;
  }while(pageToken);
  for(const u of users){
    const passwordUser=(u.providerData||[]).some(p=>p.providerId==='password');
    if(!passwordUser) continue;
    formal++;
    const ref=db.doc('defenseUsers/'+u.uid+'/strategies/0050-defense-v1/state/account');
    const account=await ref.get();
    if(account.exists){
      const a=account.data()||{};
      candidates.push({uid:u.uid,revision:a.revision??null,equityDate:a.equityDate??null,hasPositions:Array.isArray(a.positions)&&a.positions.length>0});
    }
  }
  console.log('password_user_count='+formal);
  console.log('formal_account_candidate_count='+candidates.length);
  for(const c of candidates){
    console.log('candidate_uid_hash='+hash(c.uid));
    console.log('candidate_revision='+c.revision);
    console.log('candidate_equity_date='+(c.equityDate||''));
    console.log('candidate_has_positions='+c.hasPositions);
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
