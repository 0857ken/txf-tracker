'use strict';
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve('prod/tools/defense-runner/package.json'));
const {initializeApp,cert}=req('firebase-admin/app');
const {getFirestore}=req('firebase-admin/firestore');

const OP_ID='manual-tmf-20261008-reconcile-to2';
const EXPECTED={
  revision:4,
  product:'TMF',
  month:'2026-10',
  lots:3,
  mark:49949,
  equity:450000,
  outside:550000,
  oldInitial:210300,
  oldMaintenance:161400,
  newLots:2,
  newInitial:140200,
  newMaintenance:107600
};

const MANUAL_TRADES=[
  {sequence:1,action:'open',side:'buy',lots:1,price:49622,executedAt:'2026-10-07T18:42:51+08:00',tradingDate:'2026-10-08'},
  {sequence:2,action:'close',side:'sell',lots:1,price:49591,executedAt:'2026-10-07T19:02:42+08:00',tradingDate:'2026-10-08'},
  {sequence:3,action:'close',side:'sell',lots:1,price:49588,executedAt:'2026-10-07T19:02:43+08:00',tradingDate:'2026-10-08'}
];

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
    const [snap,priorOp]=await Promise.all([tx.get(accountRef),tx.get(revRef)]);
    if(!snap.exists) throw new Error('ACCOUNT_MISSING');
    const a=snap.data()||{};
    const positions=Array.isArray(a.positions)?a.positions.map(p=>({...p})):[];
    if(positions.length!==1) throw new Error('POSITION_COUNT_CHANGED_'+positions.length);
    const p=positions[0];

    const alreadyAccount=Number(p.lots)===EXPECTED.newLots
      && Number(a.initialMargin)===EXPECTED.newInitial
      && Number(a.maintenanceMargin)===EXPECTED.newMaintenance;
    const alreadyRef=Number(a.marginReference?.initial)===EXPECTED.newInitial
      && Number(a.marginReference?.maintenance)===EXPECTED.newMaintenance;
    if(priorOp.exists || (alreadyAccount&&alreadyRef)){
      return {status:'already-applied',revision:a.revision??null,lots:Number(p.lots),mark:Number(p.mark),
        equity:Number(a.equity),outside:Number(a.outside),initialMargin:Number(a.initialMargin),
        maintenanceMargin:Number(a.maintenanceMargin),marginReference:a.marginReference||null};
    }

    if(Number(a.revision)!==EXPECTED.revision) throw new Error('REVISION_CHANGED_'+a.revision);
    if(p.product!==EXPECTED.product||p.month!==EXPECTED.month||Number(p.lots)!==EXPECTED.lots||Number(p.mark)!==EXPECTED.mark)
      throw new Error('POSITION_CHANGED');
    if(Number(a.equity)!==EXPECTED.equity||Number(a.outside)!==EXPECTED.outside)
      throw new Error('CAPITAL_CHANGED');
    if(Number(a.initialMargin)!==EXPECTED.oldInitial||Number(a.maintenanceMargin)!==EXPECTED.oldMaintenance)
      throw new Error('ACCOUNT_MARGIN_CHANGED');
    if(Number(a.marginReference?.initial)!==EXPECTED.oldInitial||Number(a.marginReference?.maintenance)!==EXPECTED.oldMaintenance)
      throw new Error('REFERENCE_MARGIN_CHANGED');
    if(a.marginReference?.brokerOverride) throw new Error('BROKER_OVERRIDE_PRESENT_STOP');

    const at=new Date().toISOString();
    const before=JSON.parse(JSON.stringify(a));
    positions[0]={...p,lots:EXPECTED.newLots}; // Preserve mark: fills are not market marks.
    const nextMarginReference={...a.marginReference,initial:EXPECTED.newInitial,maintenance:EXPECTED.newMaintenance};
    const next={...a,
      positions,
      initialMargin:EXPECTED.newInitial,
      maintenanceMargin:EXPECTED.newMaintenance,
      marginReference:nextMarginReference,
      revision:Number(a.revision)+1,
      updatedAt:at
    };

    tx.set(accountRef,next);
    tx.set(revRef,{
      at,
      before,
      after:next,
      operation:'manual_position_reconciliation',
      source:'user_report_screenshot'
    });
    tx.set(eventRef,{
      kind:'account_update',
      date:'2026-10-08',
      at,
      recordedAt:at,
      accountRevision:next.revision,
      detail:{
        product:'TMF',
        month:'2026-10',
        beforeLots:3,
        intradayPeakLots:4,
        afterLots:2,
        netDeltaLots:-1,
        tradingDate:'2026-10-08',
        userReportedTrades:MANUAL_TRADES,
        markPreserved:EXPECTED.mark,
        equityPreserved:EXPECTED.equity,
        outsidePreserved:EXPECTED.outside,
        beforeInitialMargin:EXPECTED.oldInitial,
        afterInitialMargin:EXPECTED.newInitial,
        beforeMaintenanceMargin:EXPECTED.oldMaintenance,
        afterMaintenanceMargin:EXPECTED.newMaintenance,
        executionCompleteness:'manual_fills_only',
        note:'User confirmed final actual position is 2 lots. Three fills are recorded from the screenshot; no order-book/arrival data was supplied, so these are not written as full slippage executions.'
      }
    });
    return {status:'updated',revision:next.revision,lots:Number(positions[0].lots),mark:Number(positions[0].mark),
      equity:Number(next.equity),outside:Number(next.outside),
      initialMargin:Number(next.initialMargin),maintenanceMargin:Number(next.maintenanceMargin),
      marginReference:next.marginReference,trades:MANUAL_TRADES};
  });

  console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
