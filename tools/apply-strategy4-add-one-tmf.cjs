'use strict';
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve('prod/tools/defense-runner/package.json'));
const {initializeApp,cert}=req('firebase-admin/app');
const {getFirestore}=req('firebase-admin/firestore');

const OP_ID='manual-tmf-20261006-add1-49888';

async function main(){
  if(!process.env.FIREBASE_KEY) throw new Error('CREDENTIAL_UNAVAILABLE');
  const credentials=JSON.parse(process.env.FIREBASE_KEY);
  if(credentials.project_id!=='txf-tracker') throw new Error('WRONG_PROJECT');
  initializeApp({credential:cert(credentials)});
  const db=getFirestore();

  const owner=await db.doc('strategy4System/owner').get();
  if(!owner.exists) throw new Error('OWNER_MISSING');
  const uid=String(owner.data()?.uid||'');
  if(!uid) throw new Error('OWNER_UID_MISSING');

  const root='defenseUsers/'+uid+'/strategies/0050-defense-v1';
  const accountRef=db.doc(root+'/state/account');
  const revRef=db.doc(root+'/accountRevisions/'+OP_ID);
  const eventRef=db.doc(root+'/events/'+OP_ID);

  const result=await db.runTransaction(async tx=>{
    const [accountSnap,priorOp]=await Promise.all([tx.get(accountRef),tx.get(revRef)]);
    if(!accountSnap.exists) throw new Error('ACCOUNT_MISSING');
    const a=accountSnap.data()||{};
    const positions=Array.isArray(a.positions)?a.positions.map(p=>({...p})):[];
    if(positions.length!==1) throw new Error('POSITION_SHAPE_CHANGED');
    const p=positions[0];
    if(p.product!=='TMF'||p.month!=='2026-10') throw new Error('EXPECTED_TMF_2026_10');
    const lots=Number(p.lots);
    if(priorOp.exists || lots===3){
      return {status:'already-applied',revision:a.revision??null,lots,mark:p.mark??null};
    }
    if(lots!==2) throw new Error('EXPECTED_CURRENT_LOTS_2_GOT_'+lots);

    const now=new Date().toISOString();
    const before=JSON.parse(JSON.stringify(a));
    positions[0]={...p,lots:3}; // Keep existing market reference; 49,888 is the reported trade price, not mark.
    const next={...a,positions,revision:(a.revision||0)+1,updatedAt:now};

    tx.set(accountRef,next);
    tx.set(revRef,{at:now,before,after:next,operation:'manual_position_increment',source:'user_request'});
    tx.set(eventRef,{
      kind:'account_update',
      date:'2026-10-06',
      at:now,
      recordedAt:now,
      accountRevision:next.revision,
      detail:{
        equityDate:a.equityDate??null,
        product:'TMF',
        month:'2026-10',
        beforeLots:2,
        deltaLots:1,
        afterLots:3,
        userReportedTradeDate:'2026-10-06',
        userReportedTradePrice:49888,
        note:'Position-only update from user report; exact order time/fees/tax not recorded as a full execution.'
      }
    });
    return {status:'updated',revision:next.revision,lots:3,mark:positions[0].mark??null};
  });
  console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
