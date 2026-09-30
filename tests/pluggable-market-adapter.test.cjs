'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../strategy4-preview/manual');
const A=require(path.join(root,'market-data-adapter.js')),O=require(path.join(root,'runtime.js'));
const bootstrap=require(path.join(root,'bootstrap-2026-09-30.json'));
const NOW='2026-09-30T05:40:00.000Z'; // 13:40 Taiwan time; test clock only.
const PRODUCTS=['TX','MTX','TMF'];
const quoteAt=(ageSeconds)=>new Date(Date.parse(NOW)-ageSeconds*1000).toISOString().replace('Z','+00:00');
function input(ageSeconds=119){return {tradeDate:'2026-09-30',close:111.3,closeConfirmed:true,contractMonth:'202610',expectedCloseId:null,correctionReason:'',quotes:PRODUCTS.map((product,i)=>({product,contractMonth:'202610',session:'regular',bid:47755+i,ask:47765+i,last:47763+i,quoteAt:quoteAt(ageSeconds)}))};}
async function emptyWithBootstrap(){const hash=await O.hash(bootstrap);return O.importPackage(O.blank(),bootstrap,[hash],NOW);}
function decisionPayload(result){return result.decision?.payload||null;}

test('adapter frame satisfies the shared contract and preserves manual payload provenance',async()=>{
 const raw=input(),r=await A.ManualMarketDataAdapter.read(raw,NOW),f=r.frame;
 for(const k of ['tradeDate','source','sourceType','retrievedAt','equity','futures','provenance','rawPayloadHash','parserVersion'])assert.ok(k in f,k);
 assert.equal(f.tradeDate,raw.tradeDate);assert.equal(f.source,'manual-broker');assert.equal(f.sourceType,'manual');
 assert.deepEqual([f.equity.symbol,f.equity.close,f.equity.sourceEventAt],['0050',111.3,null]);assert.equal(f.futures.contractMonth,'202610');
 assert.deepEqual(f.futures.quotes.map(q=>q.contract),PRODUCTS);assert.ok(f.futures.quotes.every(q=>q.bid>0&&q.ask>0&&q.last>0&&q.quoteAt&&q.tradeDate===raw.tradeDate));
 for(const p of PRODUCTS)assert.ok(['bid','ask','last','quoteAt','sourceEventAt'].every(k=>k in f.futures[p]),p+' contract fields');
 assert.match(f.rawPayloadHash,/^[a-f0-9]{64}$/);assert.equal(f.parserVersion,A.PARSER_VERSION);assert.deepEqual(r.frozenInput,raw);
});

test('manual adapter and direct published path have identical strategy output and append behavior',async()=>{
 const raw=input(119),initial=await emptyWithBootstrap();
 const direct=await O.submit(structuredClone(initial),raw,NOW);
 const through=await O.submitThroughAdapter(structuredClone(initial),raw,NOW,A.ManualMarketDataAdapter);
 assert.equal(through.status,'ready');
 const a=decisionPayload(direct),b=decisionPayload(through.result);
 for(const k of ['tradeDate','contractMonth','quotes','signal','allocation','account','blockers','readinessAtSubmission'])assert.deepEqual(b[k],a[k],k);
 assert.equal(through.result.state.events.filter(e=>e.type==='close').length,1);
 const againInput={...raw,expectedCloseId:through.result.savedClose.id};
 const again=await O.submitThroughAdapter(through.result.state,againInput,NOW,A.ManualMarketDataAdapter);
 assert.equal(again.result.state.events.filter(e=>e.type==='close').length,1,'same close is not appended twice');
 const corrected=await O.submitThroughAdapter(again.result.state,{...againInput,close:112,expectedCloseId:again.result.savedClose.id,correctionReason:'券商收盤核對後訂正'},NOW,A.ManualMarketDataAdapter);
 const closeRows=corrected.result.state.events.filter(e=>e.type==='close');
 assert.equal(closeRows.length,2,'correction appends a version');assert.equal(closeRows[0].payload.close,111.3);assert.equal(closeRows[1].payload.close,112);
 assert.equal(closeRows[1].payload.supersedesId,closeRows[0].id);assert.ok(corrected.result.state.events.some(e=>e.type==='decision'),'older decision remains in audit trail');
});

test('independent freshness retains the exact 119/120/121 second boundary',()=>{
 for(const product of PRODUCTS)for(const age of [119,120,121]){
  const quotes=input(119).quotes.map(q=>q.product===product?{...q,quoteAt:quoteAt(age)}:q),r=O.quoteChecks(quotes,'202610','2026-09-30',NOW);
  assert.deepEqual(r.blockers,age===121?['STALE_'+product]:[],product+' '+age+'s');assert.equal(r.valid.length,3);
 }
});

test('missing quote, wrong month, night session, wrong date and future timestamps remain blocked',()=>{
 const all=input().quotes;
 assert.deepEqual(O.quoteChecks(all.slice(0,2),'202610','2026-09-30',NOW).blockers,['MISSING_TMF']);
 assert.ok(O.quoteChecks([{...all[0],contractMonth:'202611'},...all.slice(1)],'202610','2026-09-30',NOW).blockers.includes('TX_WRONG_MONTH'));
 assert.ok(O.quoteChecks([{...all[0],quoteAt:'2026-09-30T13:40:00+08:00',session:'night'},...all.slice(1)],'202610','2026-09-30',NOW).blockers.includes('TX_WRONG_SESSION'));
 assert.ok(O.quoteChecks([{...all[0],quoteAt:'2026-09-29T13:40:00+08:00'},...all.slice(1)],'202610','2026-09-30',NOW).blockers.includes('TX_WRONG_DATE'));
 assert.ok(O.quoteChecks([{...all[0],quoteAt:'2026-09-30T13:41:00+08:00'},...all.slice(1)],'202610','2026-09-30',NOW).blockers.includes('TX_FUTURE_TIME'));
});

test('live adapter is a hard fail-closed stub and never invokes the shared Frozen evaluator',async()=>{
 let called=0;const result=await A.run(A.LiveMarketDataAdapter,null,NOW,async()=>{called++;return {executionReady:true};});
 assert.equal(result.status,'blocked');assert.equal(result.code,'LIVE_PROVIDER_NOT_CONFIGURED');assert.equal(result.executionReady,false);assert.equal(result.frame,null);assert.equal(called,0);
 const submitted=await O.submitThroughAdapter(O.blank(),null,NOW,A.LiveMarketDataAdapter);assert.equal(submitted.code,'LIVE_PROVIDER_NOT_CONFIGURED');assert.equal(submitted.executionReady,false);
});

test('both source slots dispatch through one evaluator boundary; Frozen engine files are unchanged',async()=>{
 const frozen=async(frame,normalized)=>({engine:'shared-callback',target:2,tradeDate:frame.tradeDate,normalized});let calls=0;
 const manual=await A.run(A.ManualMarketDataAdapter,input(),NOW,(frame,normalized)=>{calls++;return frozen(frame,normalized);});
 assert.equal(manual.status,'ready');assert.equal(manual.result.engine,'shared-callback');assert.equal(calls,1);
 const live=await A.run(A.LiveMarketDataAdapter,input(),NOW,(frame,normalized)=>{calls++;return frozen(frame,normalized);});
 assert.equal(live.code,'LIVE_PROVIDER_NOT_CONFIGURED');assert.equal(calls,1);
 const hashes={'defense-core.js':'87a76f6c4fdc2ffea2d58887e451f7e5e5d0ac58a46026ddc1cea022eaacafd8','defense-governance.js':'249a1c46e69ee05e7e8ef6497bf02ec052bfccc89ee58932e6fa1b4518095513','defense-ledger.js':'3697671bc785b86830e33b1c26e401c3c699591f2e45795506fdba3dcd35b5a0'};
 for(const [name,hash] of Object.entries(hashes))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'frozen',name))).digest('hex'),hash,name);
});

test('manual contract additions keep the Preview local-only and show the exact blocked-advice warning',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),css=fs.readFileSync(path.join(root,'style.css'),'utf8'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
 assert.match(html,/connect-src 'none'/);assert.match(html,/id="advice-safety"[^>]*role="alert"[^>]*hidden>僅供參考｜目前資料未通過執行條件，請更新最新行情後重新計算。/);
 assert.match(css,/\.advice-safety[^}]*border:3px solid #ff596b/);assert.match(app,/\$\('advice-safety'\)\.hidden=Boolean\(r\.executionReady&&!dirty\)/);
 assert.ok(css.includes('@media(max-width:600px)'));assert.ok(css.includes('.grid{grid-template-columns:minmax(0,1fr)}'));assert.match(css,/\*\{box-sizing:border-box;min-width:0\}/);assert.match(css,/overflow-wrap:anywhere/);
 assert.doesNotMatch(html,/firebase/i);assert.doesNotMatch(html,/connect-src\s+(?!'none')/);
});
