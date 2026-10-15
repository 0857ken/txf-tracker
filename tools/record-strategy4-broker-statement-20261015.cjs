'use strict';
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve('prod/tools/defense-runner/package.json'));
const {initializeApp,cert}=req('firebase-admin/app');
const {getFirestore}=req('firebase-admin/firestore');

const ID='broker-fifo-statement-20261012-20261016-20261015';
const PAIRS=[
  {
    "id": "fifo-1012-a",
    "prior": true,
    "direction": "long",
    "openDate": "2026-10-06",
    "open": 49888,
    "openNet": -25,
    "closeDate": "2026-10-12",
    "close": 49031,
    "closeNet": -8595
  },
  {
    "id": "fifo-1012-b",
    "prior": true,
    "direction": "long",
    "openDate": "2026-10-08",
    "open": 49622,
    "openNet": -25,
    "closeDate": "2026-10-12",
    "close": 48531,
    "closeNet": -10935
  },
  {
    "id": "fifo-1012-c",
    "prior": true,
    "direction": "long",
    "openDate": "2026-10-12",
    "open": 49130,
    "openNet": -25,
    "closeDate": "2026-10-12",
    "close": 48531,
    "closeNet": -6015
  },
  {
    "id": "fifo-1014-a",
    "prior": false,
    "direction": "long",
    "openDate": "2026-10-12",
    "open": 48666,
    "openNet": -25,
    "closeDate": "2026-10-14",
    "close": 48966,
    "closeNet": 2975
  },
  {
    "id": "fifo-1014-b",
    "prior": false,
    "direction": "short",
    "openDate": "2026-10-14",
    "open": 48988,
    "openNet": -25,
    "closeDate": "2026-10-14",
    "close": 49150,
    "closeNet": -1645
  },
  {
    "id": "fifo-1014-c",
    "prior": false,
    "direction": "short",
    "openDate": "2026-10-14",
    "open": 49008,
    "openNet": -25,
    "closeDate": "2026-10-14",
    "close": 49192,
    "closeNet": -1865
  },
  {
    "id": "fifo-1015-a",
    "prior": false,
    "direction": "short",
    "openDate": "2026-10-14",
    "open": 48864,
    "openNet": -25,
    "closeDate": "2026-10-15",
    "close": 48008,
    "closeNet": 8535
  },
  {
    "id": "fifo-1015-b",
    "prior": false,
    "direction": "short",
    "openDate": "2026-10-14",
    "open": 48796,
    "openNet": -25,
    "closeDate": "2026-10-15",
    "close": 47888,
    "closeNet": 9055
  },
  {
    "id": "fifo-1015-c",
    "prior": false,
    "direction": "short",
    "openDate": "2026-10-15",
    "open": 48911,
    "openNet": -25,
    "closeDate": "2026-10-15",
    "close": 47179,
    "closeNet": 17296
  }
];
const sum=xs=>xs.reduce((s,x)=>s+x,0);
async function main(){
 if(!process.env.FIREBASE_KEY)throw new Error('CREDENTIAL_UNAVAILABLE');
 const credentials=JSON.parse(process.env.FIREBASE_KEY);
 if(credentials.project_id!=='txf-tracker')throw new Error('WRONG_PROJECT');
 initializeApp({credential:cert(credentials)});
 const db=getFirestore();
 const owner=await db.doc('strategy4System/owner').get();
 if(!owner.exists||!owner.data()?.uid)throw new Error('OWNER_MISSING');
 const root='defenseUsers/'+owner.data().uid+'/strategies/0050-defense-v1';
 const event=db.doc(root+'/events/'+ID);
 const statement=db.doc(root+'/brokerStatements/'+ID);
 const prior=db.doc(root+'/events/broker-fifo-summary-20261008-20261012');
 const account=db.doc(root+'/state/account');
 const totals={
  allRows:PAIRS.length*2,
  allPairs:PAIRS.length,
  overlapRows:PAIRS.filter(p=>p.prior).length*2,
  overlapNet:sum(PAIRS.filter(p=>p.prior).map(p=>p.openNet+p.closeNet)),
  incrementalRows:PAIRS.filter(p=>!p.prior).length*2,
  incrementalPairs:PAIRS.filter(p=>!p.prior).length,
  incrementalNet:sum(PAIRS.filter(p=>!p.prior).map(p=>p.openNet+p.closeNet)),
  displayedStatementNet:sum(PAIRS.map(p=>p.openNet+p.closeNet))
 };
 if(JSON.stringify(totals)!==JSON.stringify({allRows:18,allPairs:9,overlapRows:6,overlapNet:-25620,incrementalRows:12,incrementalPairs:6,incrementalNet:34201,displayedStatementNet:8581}))
  throw new Error('STATEMENT_TOTALS_FAILED');
 const rows=PAIRS.flatMap(p=>[
  {pairId:p.id,side:p.direction==='long'?'buy':'sell',role:'open',tradeDate:p.openDate,price:p.open,lots:1,reportedNet:p.openNet},
  {pairId:p.id,side:p.direction==='long'?'sell':'buy',role:'close',tradeDate:p.closeDate,price:p.close,lots:1,reportedNet:p.closeNet}
 ]);
 const result=await db.runTransaction(async tx=>{
  const [prevEvent,prevStatement,prevPrior,current]=await Promise.all([
   tx.get(event),tx.get(statement),tx.get(prior),tx.get(account)
  ]);
  if(prevEvent.exists||prevStatement.exists){
   if(prevEvent.exists&&prevStatement.exists) return {status:'already-recorded',totals,accountUnchanged:true};
   throw new Error('PARTIAL_DUPLICATE_STOPS');
  }
  if(!prevPrior.exists||Number(prevPrior.data()?.detail?.netPnl)!==-35300)throw new Error('PRIOR_STATEMENT_MISSING_OR_CHANGED');
  if(!current.exists)throw new Error('ACCOUNT_MISSING');
  const a=current.data()||{}, ps=a.positions||[];
  if(a.revision!==7||ps.length!==1||ps[0].product!=='TMF'||ps[0].month!=='2026-10'||ps[0].lots!==1)
   throw new Error('ACCOUNT_CHANGED_REAUDIT_REQUIRED');
  const at=new Date().toISOString();
  tx.set(statement,{
   schemaVersion:1,recordedAt:at,source:'user_broker_futures_closed_fifo_screenshots',
   product:'TMF',contractMonth:'2026-10',
   queryFrom:'2026-10-12',queryTo:'2026-10-16',lastObservedTradeDate:'2026-10-15',
   sourceRows:rows,
   fifoPairs:PAIRS.map(p=>({...p,net:p.openNet+p.closeNet})),
   totals,
   priorReconciliationId:'broker-fifo-summary-20261008-20261012',
   inventoryStatus:'not_proven_by_closed_fifo_statement',
   classification:'broker_reported_net_after_broker_charges',
   note:'18 rows cover both screenshots pages with one overlapping row removed. 10/12 closes already recorded, so only six new FIFO pair totals are incremental. No fee/tax split, intraday times or slippage values are assumed.'
  });
  tx.set(event,{
   kind:'broker_statement_addendum',date:'2026-10-15',at,recordedAt:at,
   accountRevisionAtReview:a.revision,
   detail:{statementId:ID,totals,alreadyRecordedPeriod:'2026-10-12',
    newCloseDates:['2026-10-14','2026-10-15'],
    netByCloseDate:{'2026-10-14':-610,'2026-10-15':34811},
    source:'broker_closed_fifo_statement',inventoryRequiresSeparateOpenPositionConfirmation:true,
    note:'Add six newly closed FIFO pairs without changing current positions, margin, mark, equity, outside or ledger snapshots.'}
  });
  return {status:'recorded',totals,accountRevision:a.revision,accountPositions:ps,accountUnchanged:true};
 });
 console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
