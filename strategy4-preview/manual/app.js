'use strict';
const O=globalThis.OfflineManual,$=id=>document.getElementById(id),names={TX:'大台',MTX:'小台',TMF:'微台'};
const store=new O.Store(localStorage,globalThis.OfflineTrustedPackages),form=$('daily');let state,view,head=null,closeId=null,busy=false,fault=false,pendingMessage='',dirty=false,accountDirty=false;
const now=()=>new Date().toISOString(),num=v=>v==null?'—':Number(v).toLocaleString('zh-TW',{maximumFractionDigits:2});
const reasons={BOOTSTRAP_REQUIRED:'尚未初始化，請至資料管理匯入初始化包',NOT_TODAY:'交易日期不是今天',BEFORE_1330:'13:30 後才能使用今日收盤',CALENDAR_UNVERIFIED:'當日交易日曆尚未核實',CONTRACT_CONTEXT_REQUIRED:'合約月份依據已超出涵蓋範圍',WRONG_MONTH:'期貨合約月份與已核實月份不符',INVALID_CLOSE:'請確認今日正式收盤價',CORRECTION_REASON_REQUIRED:'訂正收盤必須填寫原因',REVISION_CONFLICT:'資料版本已改變，請重新載入核對',HISTORY_GAP:'歷史收盤有缺漏，已保存今日收盤，但暫停完整計算',MARGIN_NOT_FRESH:'保證金資料已過期或無效，暫停交易建議',MARGIN_VERSION_CHANGED:'保證金版本已變更或停用，請核實後重新計算',ACCOUNT_CHANGED:'帳戶設定已變更，請重新計算',HISTORY_CHANGED:'收盤紀錄已訂正，請重新計算',SESSION_CLOSED:'一般交易時段已結束',ALLOCATION_BLOCKED:'合約配置或資金條件未通過',STORAGE_CONFLICT:'資料已在其他分頁變更，請重新載入',UNTRUSTED_PACKAGE:'資料包尚未核實或內容被更動，未匯入',RESTORE_CONFLICT:'備份會覆蓋不同或較新的紀錄，已拒絕還原',INVALID_ACCOUNT:'資金合計不一致，或超出本輪空手案例範圍',AUDIT_CORRUPT:'本機稽核紀錄驗證失敗，已停止使用',INVALID_BACKUP:'備份驗證失敗，未還原',BOOTSTRAP_ALREADY_EXISTS:'已初始化，不可覆蓋原始歷史',REASON_REQUIRED:'請填寫原因',FUTURE_PACKAGE:'資料包時間位於未來',MULTITAB_LOCK_REQUIRED:'瀏覽器不支援安全分頁鎖，請改用支援的瀏覽器'};
function message(code){for(const p of O.PRODUCTS){if(code==='MISSING_'+p)return '尚缺'+names[p]+'報價';if(code==='STALE_'+p)return names[p]+'報價已過期，請重新輸入最新報價';if(code.startsWith(p+'_'))return names[p]+({WRONG_DATE:'報價不是今日',FUTURE_TIME:'報價時間在未來',WRONG_SESSION:'報價不屬於一般交易時段',WRONG_MONTH:'合約月份錯誤',INVALID_PRICE:'買賣價或成交價無效',INVALID_TIME:'報價時間無效'}[code.slice(p.length+1)]||'報價未通過檢查');}return reasons[code]||'資料驗證或本機保存失敗，請查看技術明細';}
for(const p of O.PRODUCTS){const section=document.createElement('section');section.className='quote';const h=document.createElement('h3');h.textContent=names[p];section.append(h);const grid=document.createElement('div');grid.className='grid';for(const [key,label,type] of [['bid','買價','number'],['ask','賣價','number'],['last','成交價','number'],['quoteAt','報價時間（台灣）','datetime-local']]){const l=document.createElement('label');l.textContent=names[p]+label;const i=document.createElement('input');i.name=p+'_'+key;i.type=type;i.step='1';if(type==='number'){i.min='1';i.inputMode='numeric';i.placeholder='請填券商'+label;}l.append(i);grid.append(l);}section.append(grid);$('quotes').append(section);}
function cards(rows){$('summary').replaceChildren();for(const [label,value] of rows){const d=document.createElement('div'),s=document.createElement('small'),v=document.createElement('strong');s.textContent=label;v.textContent=value;d.append(s,v);$('summary').append(d);}}
const localTime=at=>Number.isFinite(Date.parse(at))?new Date(at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'無法確認';
function renderHealth(){
 const health=OfflineHealth.marginHealth(view,now());
 $('margin-health').textContent='保證金資料：'+health.status;$('margin-health').className='notice '+health.className;
 $('health-dates').replaceChildren();
 const uniform=new Set(health.records.map(r=>r.fetchedAt+'|'+r.expiresAt)).size===1;
 for(const row of (uniform?health.records.slice(0,1):health.records)){
  const p=document.createElement('p');p.className='fine';p.textContent=(uniform?'三商品':names[row.product])+'實際抓取時間：'+localTime(row.fetchedAt)+'；7 日到期時間：'+localTime(row.expiresAt)+'（台灣時間）';$('health-dates').append(p);
 }
 const b=view?.bootstrap,contractThrough=b?.contracts.map(r=>r.through).sort().at(-1);
 $('coverage').textContent=b?'交易日曆／合約資料涵蓋至：'+[b.calendar.through,contractThrough].sort()[0]:'交易日曆／合約資料：尚未初始化';
 $('bootstrap-date').textContent=b?'初始化歷史資料最後日期：'+b.history.at(-1).tradeDate:'初始化歷史資料：尚未匯入';
}
function show(){
 view=O.project(state);head=state.events.at(-1)?.eventHash||null;const day=form.elements.tradeDate.value;closeId=O.activeCloses(state).get(day)?.id||null;
 renderHealth();
 $('correction-label').hidden=!closeId;
 $('system').textContent=view.bootstrap?'離線資料已載入 · 收盤累積保存在此瀏覽器':'尚未初始化，請在「資料管理」匯入一次初始化包。';
 $('system').className='notice '+(view.bootstrap?'':'blocked');$('package-status').textContent=view.bootstrap?'歷史截至 '+view.bootstrap.history.at(-1).tradeDate+'；日曆涵蓋至 '+view.bootstrap.calendar.through+'。保證金抓取時間：'+view.margins[0]?.fetchedAt:'沒有本機初始化紀錄。';
 if(!form.elements.contractMonth.value){const contract=view.bootstrap?.contracts.find(r=>r.from<=O.today(now())&&O.today(now())<=r.through);if(contract)form.elements.contractMonth.value=contract.month;}
 if(!accountDirty)for(const k of ['strategyEquity','decisionTimeFuturesEquity','outsideCash'])$('account').elements[k].value=view.account[k];
 const d=view.latest?.payload;
 if(d){const r=O.readiness(d,now(),view),a=d.allocation,positions=a.positions.length?O.PRODUCTS.map(product=>names[product]+' '+(a.positions.find(p=>p.product===product)?.lots||0)+' 口').join('／'):'資料未齊';
 $('ready').className='notice '+(r.executionReady&&!dirty?'ready':'blocked');$('ready').textContent=dirty?'暫停執行｜輸入尚未保存，請重新計算':r.executionReady?'可以執行｜本地預覽，未下單':'暫停執行｜'+message(r.blockers[0]||'ALLOCATION_BLOCKED');$('advice-safety').hidden=Boolean(r.executionReady&&!dirty);
 cards([['今日目標曝險',num(d.signal.target)+' 倍'],['建議持倉',positions],['目前持倉','空手（本輪設定）'],['是否需要調整',a.positions.length?'需建立建議持倉':'暫不提供建議'],['需轉入期貨帳戶',a.requiredInternalTopUp==null?'—':'NT$ '+num(a.requiredInternalTopUp)],['500% 安全底線',a.required500Equity==null?'待核實':num(a.required500Equity)+' 元'+(d.account.decisionTimeFuturesEquity<a.required500Equity?'｜建倉前不足':'｜資金足夠')],['550% 目標資金',a.required550Equity==null?'待核實':num(a.required550Equity)+' 元'+(d.account.strategyEquity>=a.required550Equity?'｜總資金足夠':'｜總資金不足')]]);
 }else{$('ready').textContent='尚未計算，或必要歷史資料尚未齊備';$('ready').className='notice';$('advice-safety').hidden=true;cards([]);}
 $('technical').textContent=JSON.stringify({currentTime:now(),account:view.account,latestDecision:d||null,currentReadiness:d?O.readiness(d,now(),view):null,marginHealth:OfflineHealth.marginHealth(view,now()),audit:state.events},null,2);
 $('audit-history').replaceChildren();
 for(const e of [...state.events].reverse()){const item=document.createElement('li');item.textContent='第 '+e.sequence+' 筆｜'+({'package-import':'資料包匯入',close:e.payload.supersedesId?'收盤訂正':'收盤新增',decision:'策略計算',account:'帳戶設定','margin-revoked':'保證金停用',reconciliation:'盤後對帳'}[e.type]||'稽核紀錄')+'｜'+localTime(e.recordedAt);$('audit-history').append(item);}
}
async function transaction(action){
 if(busy)return;busy=true;$('calculate').disabled=true;
 try{if(!navigator.locks)throw Object.assign(new Error(),{code:'MULTITAB_LOCK_REQUIRED'});
  await navigator.locks.request(O.KEY,async()=>{const current=await store.load();if((current.events.at(-1)?.eventHash||null)!==head)throw Object.assign(new Error(),{code:'STORAGE_CONFLICT'});const next=await action(current);if(next){await store.save(next);state=next;}else state=await store.load();fault=false;dirty=false;show();if(pendingMessage){$('message').textContent=$('manage-message').textContent=pendingMessage;pendingMessage='';}});
 }catch(e){fault=true;pendingMessage='';$('message').textContent=$('manage-message').textContent=message(e.code);$('ready').className='notice blocked';$('ready').textContent='暫停執行｜'+message(e.code);$('technical').textContent+='\n'+JSON.stringify({error:e.code||e.message});}
 finally{busy=false;$('calculate').disabled=false;}
}
form.addEventListener('submit',e=>{e.preventDefault();transaction(async current=>{const f=form.elements,quotes=[];
 for(const p of O.PRODUCTS){if(['bid','ask','last','quoteAt'].some(k=>f[p+'_'+k].value)){let at=f[p+'_quoteAt'].value;if(at.length===16)at+=':00';quotes.push({product:p,contractMonth:f.contractMonth.value,session:'regular',bid:Number(f[p+'_bid'].value),ask:Number(f[p+'_ask'].value),last:Number(f[p+'_last'].value),quoteAt:at?at+'+08:00':''});}}
 const result=await O.submitThroughAdapter(current,{tradeDate:f.tradeDate.value,close:Number(f.close.value),closeConfirmed:f.closeConfirmed.checked,contractMonth:f.contractMonth.value,quotes,expectedCloseId:closeId,correctionReason:f.correctionReason.value},now(),O.adapters.ManualMarketDataAdapter);const r=result.result||{state:current,blocked:result.code};
 pendingMessage=r.blocked?message(r.blocked):'已追加保存；原始紀錄與舊決策保留。';setTimeout(()=>$('result-card').scrollIntoView({block:'start',behavior:'smooth'}),50);return r.state;});});
async function readFile(input){const file=input.files[0];if(!file)return null;if(file.size>8*1024*1024)throw new Error('FILE_TOO_LARGE');return JSON.parse(await file.text());}
$('package-file').addEventListener('change',()=>transaction(async current=>{const p=await readFile($('package-file'));if(!p)return current;const next=p.kind==='eod'?await O.reconcile(current,p,store.catalog,now()):await O.importPackage(current,p,store.catalog,now());pendingMessage='資料包已核實匯入；原始抓取時間未變。';return next;}));
$('account').addEventListener('input',()=>{accountDirty=true;});
$('account').addEventListener('submit',e=>{e.preventDefault();transaction(async current=>{const f=$('account').elements;const next=await O.saveAccount(current,{strategyEquity:Number(f.strategyEquity.value),decisionTimeFuturesEquity:Number(f.decisionTimeFuturesEquity.value),outsideCash:Number(f.outsideCash.value),startingPositions:[]},now());accountDirty=false;return next;});});
$('correction').addEventListener('submit',e=>{e.preventDefault();transaction(current=>{const f=$('correction').elements;return O.correctClose(current,{tradeDate:f.day.value,close:Number(f.value.value),reason:f.reason.value,expectedCloseId:O.activeCloses(state).get(f.day.value)?.id},now());});});
$('revoke').addEventListener('click',()=>transaction(current=>O.revokeMargin(current,$('revoke-reason').value,now())));
$('export').addEventListener('click',()=>transaction(async current=>{const backup=await store.backup(current),a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));a.href=url;a.download='第四策略離線備份.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return current;}));
$('backup-file').addEventListener('change',()=>transaction(async current=>{const b=await readFile($('backup-file'));if(!b)return current;await store.restore(b,current);return b.state;}));
form.elements.tradeDate.value=O.today(now());form.elements.tradeDate.addEventListener('change',()=>{closeId=O.activeCloses(state).get(form.elements.tradeDate.value)?.id||null;});
form.addEventListener('input',()=>{dirty=true;});
store.load().then(s=>{state=s;view=O.project(state);const contract=view.bootstrap?.contracts.find(r=>r.from<=O.today(now())&&O.today(now())<=r.through);if(contract)form.elements.contractMonth.value=contract.month;show();}).catch(e=>{$('system').textContent=message(e.code);$('system').className='notice blocked';$('calculate').disabled=true;});
async function refresh(){if(busy||fault)return;try{const current=await store.load();if(!current.events.length&&state?.events.length){state=current;show();$('system').textContent='本機資料已被清除，請還原備份或重新初始化。';return;}if((current.events.at(-1)?.eventHash||null)!==head){$('ready').textContent='暫停執行｜其他分頁資料已變更，請重新載入';$('ready').className='notice blocked';return;}state=current;if(!dirty)show();else{$('ready').textContent='輸入尚未保存｜請重新計算';$('ready').className='notice blocked';}}catch(e){fault=true;$('ready').textContent='暫停執行｜'+message(e.code);$('ready').className='notice blocked';}}
setInterval(refresh,1000);addEventListener('storage',refresh);addEventListener('pageshow',refresh);
setInterval(()=>{if(view)renderHealth();},1000);
