'use strict';
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve('prod/tools/defense-runner/package.json'));
const {initializeApp,cert}=req('firebase-admin/app');
const {getFirestore}=req('firebase-admin/firestore');

const OP_ID='manual-margin-sync-tmf3-20261007';
const EXPECTED={
  revision:3,
  product:'TMF',
  month:'2026-10',
  lots:3,
  mark:49949,
  equity:450000,
  outside:550000,
  oldInitial:140200,
  oldMaintenance:107600,
  newInitial:210300,
  newMaintenance:161400
};

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
    const positions=Array.isArray(a.positions)?a.positions:[];
    if(positions.length!==1) throw new Error('POSITION_COUNT_CHANGED_'+positions.length);
    const p=positions[0];

    if(p.product!==EXPECTED.product||p.month!==EXPECTED.month||Number(p.lots)!==EXPECTED.lots||Number(p.mark)!==EXPECTED.mark)
      throw new Error('POSITION_CHANGED');
    if(Number(a.equity)!==EXPECTED.equity||Number(a.outside)!==EXPECTED.outside)
      throw new Error('CAPITAL_CHANGED');

    const alreadyAccount=Number(a.initialMargin)===EXPECTED.newInitial&&Number(a.maintenanceMargin)===EXPECTED.newMaintenance;
    const alreadyRef=Number(a.marginReference?.initial)===EXPECTED.newInitial&&Number(a.marginReference?.maintenance)===EXPECTED.newMaintenance;
    if(priorOp.exists || (alreadyAccount&&alreadyRef)){
      return {status:'already-applied',revision:a.revision??null,lots:Number(p.lots),mark:Number(p.mark),
        initialMargin:Number(a.initialMargin),maintenanceMargin:Number(a.maintenanceMargin),
        marginReference:a.marginReference||null};
    }

    if(Number(a.revision)!==EXPECTED.revision) throw new Error('REVISION_CHANGED_'+a.revision);
    if(Number(a.initialMargin)!==EXPECTED.oldInitial||Number(a.maintenanceMargin)!==EXPECTED.oldMaintenance)
      throw new Error('ACCOUNT_MARGIN_CHANGED');
    if(Number(a.marginReference?.initial)!==EXPECTED.oldInitial||Number(a.marginReference?.maintenance)!==EXPECTED.oldMaintenance)
      throw new Error('REFERENCE_MARGIN_CHANGED');
    if(a.marginReference?.brokerOverride) throw new Error('BROKER_OVERRIDE_PRESENT_STOP');

    const at=new Date().toISOString();
    const before=JSON.parse(JSON.stringify(a));
    const nextMarginReference={...a.marginReference,initial:EXPECTED.newInitial,maintenance:EXPECTED.newMaintenance};
    const next={...a,
      initialMargin:EXPECTED.newInitial,
      maintenanceMargin:EXPECTED.newMaintenance,
      marginReference:nextMarginReference,
      revision:Number(a.revision)+1,
      updatedAt:at
    };

    tx.set(accountRef,next);
    tx.set(revRef,{at,before,after:next,operation:'margin_sync_after_position_increment',source:'user_request'});
    tx.set(eventRef,{
      kind:'account_update',
      date:'2026-10-07',
      at,
      recordedAt:at,
      accountRevision:next.revision,
      detail:{
        product:EXPECTED.product,
        month:EXPECTED.month,
        lots:EXPECTED.lots,
        markPreserved:EXPECTED.mark,
        equityPreserved:EXPECTED.equity,
        outsidePreserved:EXPECTED.outside,
        beforeInitialMargin:EXPECTED.oldInitial,
        afterInitialMargin:EXPECTED.newInitial,
        beforeMaintenanceMargin:EXPECTED.oldMaintenance,
        afterMaintenanceMargin:EXPECTED.newMaintenance,
        note:'Margin-only sync after TMF position increased from 2 to 3 lots; no position, mark, equity, outside, broker position, or order API changes.'
      }
    });
    return {status:'updated',revision:next.revision,lots:Number(p.lots),mark:Number(p.mark),
      equity:Number(next.equity),outside:Number(next.outside),
      initialMargin:Number(next.initialMargin),maintenanceMargin:Number(next.maintenanceMargin),
      marginReference:next.marginReference};
  });

  console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
