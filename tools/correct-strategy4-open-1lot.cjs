'use strict';
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve('prod/tools/defense-runner/package.json'));
const {initializeApp,cert}=req('firebase-admin/app');
const {getFirestore}=req('firebase-admin/firestore');

const OP_ID='correction-open-tmf1-20261011';

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
    const [snap,prior]=await Promise.all([tx.get(accountRef),tx.get(revRef)]);
    if(!snap.exists) throw new Error('ACCOUNT_MISSING');
    const a=snap.data()||{};

    if(prior.exists){
      return {status:'already-applied',revision:a.revision??null,positions:a.positions||[]};
    }

    const positions=Array.isArray(a.positions)?a.positions:[];
    if(Number(a.revision)!==6) throw new Error('REVISION_CHANGED_'+a.revision);
    if(positions.length!==0) throw new Error('EXPECTED_FLAT_GOT_'+positions.length);
    if(Number(a.equity)!==450000||Number(a.outside)!==550000) throw new Error('CAPITAL_CHANGED');
    if(Number(a.initialMargin)!==0||Number(a.maintenanceMargin)!==0) throw new Error('MARGIN_CHANGED');
    if(Number(a.marginReference?.initial)!==0||Number(a.marginReference?.maintenance)!==0)
      throw new Error('REFERENCE_MARGIN_CHANGED');

    const at=new Date().toISOString();
    const before=JSON.parse(JSON.stringify(a));
    const position={product:'TMF',month:'2026-10',lots:1,mark:49357};
    const next={...a,
      positions:[position],
      initialMargin:70100,
      maintenanceMargin:53800,
      marginReference:{...a.marginReference,initial:70100,maintenance:53800},
      revision:7,
      updatedAt:at
    };

    tx.set(accountRef,next);
    tx.set(revRef,{
      at,
      before,
      after:next,
      operation:'correction_after_closed-only_statement_misread',
      source:'user_open_position_screenshot'
    });
    tx.set(eventRef,{
      kind:'account_correction',
      date:'2026-10-11',
      at,
      recordedAt:at,
      accountRevision:7,
      detail:{
        product:'TMF',
        month:'2026-10',
        correctedPriorOperation:'broker-fifo-summary-20261008-20261012',
        priorIncorrectLots:0,
        correctedLots:1,
        averageEntryPrice:48666,
        marketPrice:49357,
        unrealizedPnl:6910,
        multiplier:10,
        arithmeticCheck:(49357-48666)*10,
        initialMargin:70100,
        maintenanceMargin:53800,
        note:'Prior broker table contained closed FIFO records only and was incorrectly interpreted as complete inventory. Current open-position screenshot confirms one long lot. Entry price is not used as mark.'
      }
    });

    return {
      status:'updated',
      revision:7,
      position,
      initialMargin:70100,
      maintenanceMargin:53800,
      equity:next.equity,
      outside:next.outside,
      averageEntryPrice:48666,
      unrealizedPnl:6910
    };
  });

  console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
