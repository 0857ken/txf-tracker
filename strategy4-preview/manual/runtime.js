(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./frozen/defense-core.js'),require('./frozen/defense-governance.js'),require('./frozen/defense-ledger.js'),require('./market-data-adapter.js'));
  else root.OfflineManual=factory(root.DefenseCore,root.DefenseGovernance,root.DefenseLedger,root.MarketDataAdapters);
})(globalThis,function(C,G,L,A){
  'use strict';
  const KEY='strategy4.offline-manual.v1',PRODUCTS=['TX','MTX','TMF'];
  const DEFAULT_ACCOUNT={strategyEquity:1000000,decisionTimeFuturesEquity:300000,outsideCash:700000,startingPositions:[]};
  const clone=x=>JSON.parse(JSON.stringify(x));
  function check(ok,code){if(!ok){const e=new Error(code);e.code=code;throw e;}}
  async function hash(value){const b=new TextEncoder().encode(JSON.stringify(value));return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');}
  const time=x=>{check(typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&Number.isFinite(Date.parse(x)),'INVALID_TIME');return Date.parse(x);};
  const date=x=>{check(typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x,'INVALID_DATE');return x;};
  const today=at=>new Date(time(at)+8*3600000).toISOString().slice(0,10);
  const minutes=at=>{const d=new Date(time(at)+8*3600000);return d.getUTCHours()*60+d.getUTCMinutes()+d.getUTCSeconds()/60;};
  function sortedDates(rows){rows.forEach((r,i)=>check(date(r)&&(!i||r>rows[i-1]),'DATE_ORDER'));}
  function accountValid(a){check(a&&[a.strategyEquity,a.decisionTimeFuturesEquity,a.outsideCash].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0)&&a.strategyEquity>0&&a.strategyEquity===a.decisionTimeFuturesEquity+a.outsideCash&&Array.isArray(a.startingPositions)&&a.startingPositions.length===0,'INVALID_ACCOUNT');return a;}
  function marginShape(m){check(m&&PRODUCTS.includes(m.product)&&/^https:\/\/www\.taifex\.com\.tw\//.test(m.source)&&/^[a-f0-9]{64}$/.test(m.rawPayloadHash)&&m.fetchedAt===m.retrievedAt&&m.initial>0&&m.maintenance>0&&m.initial>=m.maintenance,'INVALID_MARGIN');time(m.fetchedAt);date(m.effectiveDate);}
  function packageShape(p){
    check(p&&p.schemaVersion===1&&p.scope==='isolated-preview'&&['bootstrap','margin','eod'].includes(p.kind),'INVALID_PACKAGE');time(p.evidenceAsOf);
    if(p.kind==='bootstrap'){
      check(p.priceBasis==='TWSE-unadjusted-close'&&p.history.length>=79,'INSUFFICIENT_HISTORY');
      sortedDates(p.history.map(r=>r.tradeDate));sortedDates(p.calendar.signalDays);sortedDates(p.calendar.futuresDays);
      for(const r of p.history){check(r.symbol==='0050'&&r.close>0&&/^https:\/\/www\.twse\.com\.tw\//.test(r.source)&&/^[a-f0-9]{64}$/.test(r.rawPayloadHash),'INVALID_HISTORY');time(r.retrievedAt);}
      check(JSON.stringify(p.history.map(r=>r.tradeDate))===JSON.stringify(p.calendar.signalDays.filter(d=>d>=p.history[0].tradeDate&&d<=p.history.at(-1).tradeDate)),'HISTORY_GAP');
      check(p.calendar.source&&/^[a-f0-9]{64}$/.test(p.calendar.rawPayloadHash),'INVALID_CALENDAR');
      for(const row of p.contracts){date(row.from);date(row.through);check(row.from<=row.through&&/^\d{4}(0[1-9]|1[0-2])$/.test(row.month)&&PRODUCTS.every(v=>row.products.includes(v))&&row.basis&&row.rollDate,'INVALID_CONTRACT_CONTEXT');}
    }
    if(p.kind==='margin'||p.kind==='bootstrap'){check(Array.isArray(p.margins)&&p.margins.length===3&&new Set(p.margins.map(m=>m.product)).size===3,'INVALID_MARGIN');p.margins.forEach(marginShape);}
    return p;
  }
  function blank(){return {schemaVersion:1,scope:'isolated-preview',events:[]};}
  async function verify(state,catalog){
    check(state?.schemaVersion===1&&state.scope==='isolated-preview'&&Array.isArray(state.events),'INVALID_BACKUP');let prev=null;
    for(const [i,e] of state.events.entries()){
      const {eventHash,...body}=e;check(body.sequence===i+1&&body.previousHash===prev&&await hash(body)===eventHash,'AUDIT_CORRUPT');time(e.recordedAt);
      check(['package-import','close','decision','account','margin-revoked','reconciliation'].includes(e.type),'UNKNOWN_EVENT');
      if(e.type==='package-import'){packageShape(e.payload.package);check(catalog.includes(await hash(e.payload.package)),'UNTRUSTED_PACKAGE');}
      if(e.type==='reconciliation'){packageShape(e.payload.package);check(catalog.includes(await hash(e.payload.package)),'UNTRUSTED_PACKAGE');}
      if(e.type==='account')accountValid(e.payload.account);
      if(e.type==='close')check(date(e.payload.tradeDate)&&e.payload.close>0&&e.payload.source==='manual-broker'&&e.payload.enteredAt===e.recordedAt,'INVALID_CLOSE');
      prev=eventHash;
    }
    return state;
  }
  async function append(state,type,payload,at){const body={sequence:state.events.length+1,id:globalThis.crypto.randomUUID(),previousHash:state.events.at(-1)?.eventHash||null,type,recordedAt:at,payload:clone(payload)};const event={...body,eventHash:await hash(body)};state.events.push(event);return event;}
  function project(state){
    const imports=state.events.filter(e=>e.type==='package-import'),boot=imports.find(e=>e.payload.package.kind==='bootstrap');
    const margin=imports.filter(e=>['bootstrap','margin'].includes(e.payload.package.kind)).at(-1);
    const account=state.events.filter(e=>e.type==='account').at(-1);
    const revoked=state.events.filter(e=>e.type==='margin-revoked'&&e.payload.marginImportId===margin?.id).at(-1);
    return {bootstrap:boot?.payload.package,marginImport:margin,margins:margin?.payload.package.margins||[],marginRevoked:Boolean(revoked),marginRevokedAt:revoked?.recordedAt||null,
      account:account?.payload.account||clone(DEFAULT_ACCOUNT),accountId:account?.id||'default-user-case',closeVersion:state.events.filter(e=>e.type==='close').map(e=>e.id).join(','),latest:state.events.filter(e=>e.type==='decision').at(-1)};
  }
  async function importPackage(state,p,catalog,at){
    packageShape(p);const digest=await hash(p);check(catalog.includes(digest),'UNTRUSTED_PACKAGE');check(time(p.evidenceAsOf)<=time(at),'FUTURE_PACKAGE');
    const next=clone(state),view=project(next);if(next.events.some(e=>e.type==='package-import'&&e.payload.packageHash===digest))return next;
    if(p.kind==='bootstrap')check(!view.bootstrap,'BOOTSTRAP_ALREADY_EXISTS');
    if(p.kind==='margin')check(view.bootstrap,'BOOTSTRAP_REQUIRED');
    if(p.kind==='margin')check(p.margins.every(m=>time(m.fetchedAt)>time(view.margins.find(old=>old.product===m.product).fetchedAt)),'MARGIN_VERSION_NOT_NEWER');
    if(p.kind==='margin'&&view.marginRevokedAt)check(p.margins.every(m=>time(m.fetchedAt)>time(view.marginRevokedAt)),'MARGIN_VERSION_NOT_NEWER');
    if(p.kind==='bootstrap'||p.kind==='margin')check(p.margins.every(m=>G.validateMarginRecord(m,at).fresh),'MARGIN_NOT_FRESH');
    check(p.kind!=='eod','USE_RECONCILE_IMPORT');
    await append(next,'package-import',{package:p,packageHash:digest,importedAt:at},at);return next;
  }
  function activeCloses(state){const map=new Map();for(const e of state.events.filter(e=>e.type==='close'))map.set(e.payload.tradeDate,e);return map;}
  function dailyContext(view,day){
    check(view.bootstrap,'BOOTSTRAP_REQUIRED');const b=view.bootstrap;check(b.calendar.signalDays.includes(day)&&b.calendar.futuresDays.includes(day),'CALENDAR_UNVERIFIED');
    const contracts=b.contracts.filter(r=>r.from<=day&&day<=r.through);check(contracts.length===1,'CONTRACT_CONTEXT_REQUIRED');return contracts[0];
  }
  function mergedHistory(state,day){
    const b=project(state).bootstrap,map=new Map(b.history.map(r=>[r.tradeDate,{date:r.tradeDate,close:r.close,provenance:r}]));
    for(const [d,e] of activeCloses(state))map.set(d,{date:d,close:e.payload.close,provenance:{source:'manual-broker',recordId:e.id,recordHash:e.eventHash,enteredAt:e.recordedAt}});
    const expected=b.calendar.signalDays.filter(d=>d>=b.history[0].tradeDate&&d<=day);
    check(expected.at(-1)===day&&expected.every(d=>map.has(d)),'HISTORY_GAP');
    return expected.map(d=>map.get(d));
  }
  function quoteChecks(quotes,month,day,now){
    const blockers=[],valid=[];check(Array.isArray(quotes)&&new Set(quotes.map(q=>q.product)).size===quotes.length&&quotes.every(q=>PRODUCTS.includes(q.product)),'INVALID_QUOTES');
    for(const product of PRODUCTS){
      const q=quotes.find(q=>q.product===product);if(!q){blockers.push('MISSING_'+product);continue;}
      try{
        check(q.contractMonth===month,'WRONG_MONTH');check(today(q.quoteAt)===day,'WRONG_DATE');check(time(q.quoteAt)<=time(now),'FUTURE_TIME');
        check(q.session==='regular'&&minutes(q.quoteAt)>=810&&minutes(q.quoteAt)<=825,'WRONG_SESSION');
        check([q.bid,q.ask,q.last].every(n=>Number.isInteger(n)&&n>0)&&q.bid<=q.ask,'INVALID_PRICE');
        valid.push({...q,source:'manual-broker',timestampAuthority:'user-asserted'});
        if(time(now)-time(q.quoteAt)>120000)blockers.push('STALE_'+product);
      }catch(e){blockers.push(product+'_'+e.code);}
    }
    return {blockers,valid};
  }
  function readiness(decision,now,view){
    const blockers=[...decision.blockers];
    if(today(now)!==decision.tradeDate)blockers.push('NOT_TODAY');
    if(!G.signalEligibility(now,decision.tradeDate).eligible)blockers.push('BEFORE_1330');
    if(minutes(now)>825)blockers.push('SESSION_CLOSED');
    const q=quoteChecks(decision.quotes,decision.contractMonth,decision.tradeDate,now);blockers.push(...q.blockers);
    if(decision.margins.length!==3||decision.margins.some(m=>!G.validateMarginRecord(m,now).fresh))blockers.push('MARGIN_NOT_FRESH');
    if(view?.marginRevoked||view?.marginImport?.id!==decision.marginImportId)blockers.push('MARGIN_VERSION_CHANGED');
    if(view?.accountId!==decision.accountId)blockers.push('ACCOUNT_CHANGED');
    if(view?.closeVersion!==decision.closeVersion)blockers.push('HISTORY_CHANGED');
    if(decision.allocation.executionReady!==true)blockers.push('ALLOCATION_BLOCKED');
    return {executionReady:blockers.length===0,blockers:[...new Set(blockers)],evaluatedAt:now,productionAuthorized:false};
  }
  async function submit(state,raw,at){
    check(raw.tradeDate===today(at),'NOT_TODAY');check(G.signalEligibility(at,raw.tradeDate).eligible,'BEFORE_1330');
    check(raw.closeConfirmed===true&&typeof raw.close==='number'&&Number.isFinite(raw.close)&&raw.close>0,'INVALID_CLOSE');
    const next=clone(state),view=project(next),contract=dailyContext(view,raw.tradeDate);check(raw.contractMonth===contract.month,'WRONG_MONTH');
    check(raw.enteredAt===undefined,'TIMESTAMP_NOT_EDITABLE');
    const previous=activeCloses(next).get(raw.tradeDate);
    check(raw.expectedCloseId===(previous?.id||null),'REVISION_CONFLICT');
    let closeEvent=previous;
    if(!previous||previous.payload.close!==raw.close){
      if(previous)check(typeof raw.correctionReason==='string'&&raw.correctionReason.trim().length>=2,'CORRECTION_REASON_REQUIRED');
      closeEvent=await append(next,'close',{tradeDate:raw.tradeDate,close:raw.close,source:'manual-broker',enteredAt:at,supersedesId:previous?.id||null,reason:previous?raw.correctionReason.trim():null},at);
    }
    let rows;
    try{rows=mergedHistory(next,raw.tradeDate);}catch(e){return {state:next,decision:null,savedClose:closeEvent,blocked:e.code};}
    const q=quoteChecks(raw.quotes,contract.month,raw.tradeDate,at),signal=C.signal(rows.map(r=>({date:r.date,close:r.close})));
    check(signal.valid,'INSUFFICIENT_HISTORY');
    const mapped=q.valid.map(q=>{const m=view.margins.find(m=>m.product===q.product);return {product:q.product,month:q.contractMonth.slice(0,4)+'-'+q.contractMonth.slice(4),bid:q.bid,ask:q.ask,mark:q.last,initialMargin:m?.initial,maintenanceMargin:m?.maintenance,margin:m?G.validateMarginRecord(m,at):{fresh:false}};});
    const allocation=L.selectHoldings(signal.target,mapped,contract.month.slice(0,4)+'-'+contract.month.slice(4),view.account.strategyEquity,view.account);
    const decision={tradeDate:raw.tradeDate,enteredAt:at,source:'manual-broker',closeId:closeEvent.id,closeHash:closeEvent.eventHash,contractMonth:contract.month,
      quotes:clone(raw.quotes),signal,allocation,account:clone(view.account),accountId:view.accountId,closeVersion:project(next).closeVersion,marginImportId:view.marginImport?.id||null,margins:clone(view.margins),blockers:q.blockers,
      historyHash:await hash(rows),historyRecords:rows.map(r=>({date:r.date,...r.provenance})),productionAuthorized:false};
    decision.readinessAtSubmission=readiness(decision,at,project(next));
    const event=await append(next,'decision',decision,at);return {state:next,decision:event,savedClose:closeEvent};
  }
  async function submitThroughAdapter(state,raw,at,adapter=A.ManualMarketDataAdapter){
    return A.run(adapter,raw,at,(_frame,frozenInput)=>submit(state,frozenInput,at));
  }
  async function correctClose(state,{tradeDate,close,reason,expectedCloseId},at){
    const next=clone(state),old=activeCloses(next).get(tradeDate);check(old&&old.id===expectedCloseId,'REVISION_CONFLICT');
    check(tradeDate<=today(at)&&Number.isFinite(close)&&close>0&&typeof reason==='string'&&reason.trim().length>=2,'INVALID_CORRECTION');
    await append(next,'close',{tradeDate,close,source:'manual-broker',enteredAt:at,supersedesId:old.id,reason:reason.trim()},at);return next;
  }
  async function saveAccount(state,account,at){accountValid(account);const next=clone(state);await append(next,'account',{account,source:'manual-account-input'},at);return next;}
  async function revokeMargin(state,reason,at){check(reason?.trim().length>=2,'REASON_REQUIRED');const next=clone(state);await append(next,'margin-revoked',{marginImportId:project(next).marginImport?.id,reason},at);return next;}
  async function reconcile(state,p,catalog,at){
    packageShape(p);check(p.kind==='eod'&&catalog.includes(await hash(p)),'UNTRUSTED_PACKAGE');const next=clone(state),d=project(next).latest;
    check(d&&p.tradeDate===d.payload.tradeDate&&time(at)>=time(p.tradeDate+'T16:00:00+08:00')&&time(p.evidenceAsOf)<=time(at),'EOD_NOT_DUE');
    const fields=[{field:'0050.close',manual:d.payload.signal.close,official:p.close??null}];
    for(const q of d.payload.quotes){const official=p.quotes?.find(o=>o.product===q.product&&o.contractMonth===q.contractMonth&&o.tradeDate===p.tradeDate&&o.session==='regular');for(const k of ['bid','ask','last'])fields.push({field:q.product+'.'+k,manual:q[k],official:official?.[k]??null});}
    for(const f of fields)f.status=f.official===null?'OFFICIAL_DATA_UNAVAILABLE':f.manual===f.official?'MATCH':'MISMATCH';
    const status=fields.some(f=>f.status==='OFFICIAL_DATA_UNAVAILABLE')?'OFFICIAL_DATA_UNAVAILABLE':fields.some(f=>f.status==='MISMATCH')?'MISMATCH':'MATCH';
    await append(next,'reconciliation',{subjectId:d.id,package:p,packageHash:await hash(p),status,fields,originalDecisionChanged:false},at);return next;
  }
  class Store{
    constructor(storage,catalog=[]){this.storage=storage;this.catalog=catalog;this.original=null;}
    async load(){this.original=this.storage.getItem(KEY);return verify(this.original?JSON.parse(this.original):blank(),this.catalog);}
    async save(state){await verify(state,this.catalog);check(this.storage.getItem(KEY)===this.original,'STORAGE_CONFLICT');const raw=JSON.stringify(state);this.storage.setItem(KEY,raw);check(this.storage.getItem(KEY)===raw,'STORAGE_WRITE_FAILED');this.original=raw;}
    async backup(state){await verify(state,this.catalog);return {kind:'offline-manual-backup',state:clone(state),hash:await hash(state)};}
    async restore(backup,current){check(backup?.kind==='offline-manual-backup'&&await hash(backup.state)===backup.hash,'INVALID_BACKUP');await verify(backup.state,this.catalog);
      check(current.events.length<=backup.state.events.length&&current.events.every((e,i)=>JSON.stringify(e)===JSON.stringify(backup.state.events[i])),'RESTORE_CONFLICT');await this.save(backup.state);return backup.state;}
  }
  return {KEY,PRODUCTS,DEFAULT_ACCOUNT,hash,blank,verify,project,importPackage,submit,submitThroughAdapter,correctClose,saveAccount,revokeMargin,reconcile,readiness,quoteChecks,mergedHistory,activeCloses,Store,today,packageShape,adapters:A};
});
