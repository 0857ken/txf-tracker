'use strict';
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve('prod/tools/defense-runner/package.json'));
const {initializeApp,cert}=req('firebase-admin/app');
const {getFirestore}=req('firebase-admin/firestore');

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
  const opId='broker-fifo-summary-20261008-20261012';
  const revRef=db.doc(root+'/accountRevisions/'+opId);
  const eventRef=db.doc(root+'/events/'+opId);

  const result=await db.runTransaction(async tx=>{
    const [snap,prior]=await Promise.all([tx.get(accountRef),tx.get(revRef)]);
    if(!snap.exists) throw new Error('ACCOUNT_MISSING');
    const a=snap.data()||{};
    if(prior.exists) return {status:'already-applied',revision:a.revision??null,positions:a.positions||[]};

    const positions=Array.isArray(a.positions)?a.positions:[];
    if(Number(a.revision)!==5) throw new Error('REVISION_CHANGED_'+a.revision);
    if(positions.length!==1) throw new Error('POSITION_COUNT_CHANGED_'+positions.length);
    const p=positions[0];
    if(p.product!=='TMF'||p.month!=='2026-10'||Number(p.lots)!==2||Number(p.mark)!==49949)
      throw new Error('POSITION_CHANGED');
    if(Number(a.equity)!==450000||Number(a.outside)!==550000) throw new Error('CAPITAL_CHANGED');
    if(Number(a.initialMargin)!==140200||Number(a.maintenanceMargin)!==107600) throw new Error('MARGIN_CHANGED');
    if(Number(a.marginReference?.initial)!==140200||Number(a.marginReference?.maintenance)!==107600)
      throw new Error('REFERENCE_MARGIN_CHANGED');

    const at=new Date().toISOString();
    const before=JSON.parse(JSON.stringify(a));
    const next={...a,
      positions:[],
      initialMargin:0,
      maintenanceMargin:0,
      marginReference:{...a.marginReference,initial:0,maintenance:0},
      revision:6,
      updatedAt:at
    };

    tx.set(accountRef,next);
    tx.set(revRef,{at,before,after:next,operation:'broker_fifo_reconciliation',source:'user_uploaded_broker_statement'});
    tx.set(eventRef,{
      kind:'broker_fifo_reconciliation',
      date:'2026-10-12',
      at,
      recordedAt:at,
      accountRevision:6,
      detail:{
        product:'TMF',
        month:'2026-10',
        beforeLots:2,
        afterLots:0,
        brokerQueryFrom:'2026-10-08',
        brokerQueryTo:'2026-10-12',
        brokerRows:10,
        fifoRoundTrips:5,
        grossPnl:-35050,
        fees:150,
        tax:100,
        netPnl:-35300,
        fills:[
          {openDate:'2026-10-05',buy:50073,closeDate:'2026-10-08',sell:49591,lots:1,netPnl:-4870},
          {openDate:'2026-10-05',buy:50064,closeDate:'2026-10-08',sell:49588,lots:1,netPnl:-4810},
          {openDate:'2026-10-06',buy:49888,closeDate:'2026-10-12',sell:49031,lots:1,netPnl:-8620},
          {openDate:'2026-10-08',buy:49622,closeDate:'2026-10-12',sell:48531,lots:1,netPnl:-10960},
          {openDate:'2026-10-12',buy:49130,closeDate:'2026-10-12',sell:48531,lots:1,netPnl:-6040}
        ],
        completeness:'broker FIFO dates/prices/fees/tax/PnL only; no wall-clock times or order-book data',
        note:'Trade dates preserved exactly as shown on the broker statement. No full slippage executions were created.'
      }
    });
    return {status:'updated',revision:6,positions:[],initialMargin:0,maintenanceMargin:0,
      equity:next.equity,outside:next.outside,grossPnl:-35050,fees:150,tax:100,netPnl:-35300};
  });

  console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
