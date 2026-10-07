'use strict';
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve('prod/tools/defense-runner/package.json'));
const {initializeApp,cert}=req('firebase-admin/app');
const {getFirestore}=req('firebase-admin/firestore');
const crypto=require('node:crypto');

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

  const accountRef=db.doc('defenseUsers/'+uid+'/strategies/0050-defense-v1/state/account');
  const opId='manual-add-tmf-2026-10-06-'+crypto.randomUUID();
  const revisionRef=db.doc('defenseUsers/'+uid+'/strategies/0050-defense-v1/accountRevisions/'+opId);
  const eventRef=db.doc('defenseUsers/'+uid+'/strategies/0050-defense-v1/events/'+opId);

  const result=await db.runTransaction(async tx=>{
    const snap=await tx.get(accountRef);
    if(!snap.exists) throw new Error('ACCOUNT_MISSING');
    const a=snap.data()||{};
    const positions=Array.isArray(a.positions)?a.positions:[];
    if(a.revision!==2) throw new Error('REVISION_CHANGED_'+a.revision);
    if(Number(a.equity)!==450000 || Number(a.outside)!==550000) throw new Error('CAPITAL_CHANGED');
    if(positions.length!==1) throw new Error('POSITION_COUNT_CHANGED_'+positions.length);
    const p=positions[0];
    if(p.product!=='TMF'||p.month!=='2026-10'||Number(p.lots)!==2||Number(p.mark)!==49949)
      throw new Error('POSITION_CHANGED');
    if(Number(a.initialMargin)!==140200||Number(a.maintenanceMargin)!==107600)
      throw new Error('MARGIN_CHANGED');
    if(a.marginReference?.brokerOverride) throw new Error('BROKER_OVERRIDE_PRESENT_STOP');

    const at=new Date().toISOString();
    const nextPositions=[{...p,lots:3}];
    const nextInitial=210300;
    const nextMaintenance=161400;
    const nextMarginReference=a.marginReference ? {...a.marginReference,initial:nextInitial,maintenance:nextMaintenance} : a.marginReference;
    const next={...a,
      asof:at,
      positions:nextPositions,
      initialMargin:nextInitial,
      maintenanceMargin:nextMaintenance,
      marginReference:nextMarginReference,
      revision:3,
      updatedAt:at
    };
    tx.set(accountRef,next);
    tx.set(revisionRef,{at,before:a,after:next});
    tx.set(eventRef,{
      kind:'account_update',
      amount:0,
      date:'2026-10-06',
      at,
      recordedAt:at,
      accountRevision:3,
      detail:{
        equityDate:a.equityDate||null,
        manualPositionAdjustment:{
          product:'TMF',month:'2026-10',deltaLots:1,
          fromLots:2,toLots:3,
          reportedTradeDate:'2026-10-06',
          reportedFillPrice:49888,
          markPreserved:49949,
          note:'User-reported purchase; not a full execution/slippage record.'
        },
        marginTotalsRecalculatedFromSameContractPerLot:true
      }
    });
    return next;
  });

  console.log(JSON.stringify({
    result:'PASS',
    revision:result.revision,
    asof:result.asof,
    equityDate:result.equityDate,
    equity:result.equity,
    outside:result.outside,
    position:result.positions[0],
    initialMargin:result.initialMargin,
    maintenanceMargin:result.maintenanceMargin,
    reportedTrade:{date:'2026-10-06',fillPrice:49888,deltaLots:1}
  },null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
