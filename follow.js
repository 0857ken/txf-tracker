(function () {
  'use strict';
  const C=window.FollowCore, $=id=>document.getElementById(id);
  const money=n=>Number(n).toLocaleString('zh-TW',{maximumFractionDigits:2});
  const pct=n=>(n*100).toFixed(2)+'%';
  const esc=s=>String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date());
  let state=C.initialState(), quotes={}, connected=false, busy=false, dirty=false;
  const timeout=(promise,ms=18000)=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('連線逾時；尚未確認雲端結果。請重新載入核對後再操作')),ms);
    promise.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
  });
  function status(message,type='') {$('status').textContent=message;$('status').className='notice '+type;}
  function event(next,message) {
    next.events.unshift({at:new Date().toISOString(),message});
    next.events=next.events.slice(0,100);
    return next;
  }
  async function persist(next,message) {
    if(busy) throw new Error('上一個操作仍在處理中');
    if(!connected) throw new Error('尚未成功載入雲端。請先按「載入雲端」，避免覆蓋既有資料');
    busy=true;
    document.querySelectorAll('button').forEach(b=>b.disabled=true);
    status('儲存中…');
    try {
      state=await timeout(window.saveFollowPortfolio(event(next,message),state.revision));
      dirty=false;
      status('已同步雲端 · '+new Date(state.updatedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}),'ok');
      renderPlan(); renderHistory();
    } catch(e) {connected=false;throw e;}
    finally {busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  function handle(fn) {return async e=>{e?.preventDefault();try{await fn(e);}catch(err){status(err.message,'error');}};}
  function fillSettings() {
    for(const [key,value] of Object.entries(state.settings)) $(key).value=value;
  }
  function renderFriends(items=state.snapshot?.items || []) {
    $('friend-body').innerHTML=items.map(r=>`<tr>
      <td><input data-key="symbol" aria-label="朋友股票代號" value="${esc(r.symbol)}" maxlength="8"></td>
      <td><input data-key="name" aria-label="股票名稱" value="${esc(r.name)}" maxlength="60"></td>
      <td><select data-key="market" aria-label="股票市場"><option value="TW" ${r.market==='TW'?'selected':''}>上市</option><option value="TWO" ${r.market==='TWO'?'selected':''}>上櫃</option></select></td>
      <td><input data-key="shares" aria-label="朋友持股股數" type="number" min="0" step="1" value="${esc(r.shares)}"></td>
      <td><input data-key="price" aria-label="快照參考價" type="number" min="0.000001" step="any" value="${esc(r.price)}"></td>
      <td><button data-remove type="button" aria-label="移除 ${esc(r.symbol)}">移除</button></td></tr>`).join('');
  }
  function readFriends() {
    return [...$('friend-body').rows].map(row=>Object.fromEntries([...row.querySelectorAll('[data-key]')].map(input=>[input.dataset.key,input.value])));
  }
  function parseQuickUpdate(text, items) {
    const updates=[];
    for(const [index,raw] of text.split(/\r?\n/).entries()) {
      const line=raw.trim(); if(!line) continue;
      const parts=line.split(/[\s,;，、\t]+/).filter(Boolean);
      if(parts.length<3) throw new Error(`快速更新第 ${index+1} 行格式錯誤，請填：代號 股數 價格`);
      const code=C.symbol(parts[0]);
      const shares=C.number(parts[1],`第 ${index+1} 行股數`,0,true);
      const price=C.number(parts[2],`第 ${index+1} 行價格`,0.000001);
      if(updates.some(x=>x.symbol===code)) throw new Error(`快速更新重複代號：${code}`);
      updates.push({symbol:code,shares,price});
    }
    if(!updates.length) throw new Error('請先貼上至少一行快速更新資料');
    const next=items.map(row=>({...row}));
    for(const update of updates) {
      const row=next.find(x=>x.symbol===update.symbol);
      if(row){row.shares=update.shares;row.price=update.price;}
      else next.push({symbol:update.symbol,name:update.symbol,market:'TW',shares:update.shares,price:update.price});
    }
    return next;
  }
  function renderOwn() {
    const codes=[...new Set([...(state.snapshot?.items || []).map(x=>x.symbol),...state.holdings.map(x=>x.symbol)])];
    $('own-body').innerHTML=codes.map(code=>{
      const h=state.holdings.find(x=>x.symbol===code);
      return `<tr data-symbol="${esc(code)}"><td>${esc(code)}</td><td><input data-key="shares" aria-label="${esc(code)}實際股數" type="number" min="0" step="1" value="${h?.shares || 0}"></td><td><input data-key="avgCost" aria-label="${esc(code)}平均成本" type="number" min="0.000001" step="any" value="${h?.avgCost ?? ''}" placeholder="未知"></td></tr>`;
    }).join('');
    $('own-cash').value=state.cash;
    $('symbols').innerHTML=codes.map(code=>`<option value="${esc(code)}"></option>`).join('');
  }
  function renderPlan() {
    const p=C.calculate(state,quotes);
    $('m-budget').textContent=money(state.settings.budget);
    $('m-count').textContent=state.snapshot?p.selectedCount+' 檔':'—';
    $('m-coverage').textContent=state.snapshot?'占朋友股票市值 '+pct(p.selectedWeight):'請匯入朋友完整庫存';
    $('m-cash').textContent=state.snapshot?money(p.targetCash):'—';
    $('m-top').textContent=state.snapshot?pct(p.topTwo*(state.settings.budget-state.settings.reserve)/state.settings.budget):'—';
    $('snapshot-label').textContent=state.snapshot?'快照 '+state.snapshot.date:'尚無庫存快照';
    if(!state.snapshot){
      $('plan-body').innerHTML='<tr><td colspan="8">尚無朋友庫存。請匯入 JSON 或貼上完整庫存 CSV。</td></tr>';
      $('allocation-bars').innerHTML='';$('plan-note').textContent='先匯入朋友庫存，再確認你的實際庫存。';return;
    }
    const colors=['#68acff','#d4af37','#60d3ae','#bd9bfa','#ec8fb4','#e8ac72'];
    $('allocation-bars').innerHTML=p.rows.filter(r=>r.weight>0).map((r,i)=>`<span style="width:${r.targetAmount/state.settings.budget*100}%;background:${colors[i%colors.length]}" title="${esc(r.name)} ${pct(r.targetAmount/state.settings.budget)}"></span>`).join('');
    const shown=p.rows.filter(r=>r.selected || r.currentShares>0);
    $('plan-body').innerHTML=shown.length?shown.map(r=>{
      const change=r.delta===null?'—':r.delta===0?'0 股':(r.delta>0?'+':'−')+money(Math.abs(r.delta))+' 股';
      const cells=[`<strong>${esc(r.name)}</strong><span class="symbol">${esc(r.symbol)}${!r.selected?' · 不再入選':''}</span>`,
        pct(r.sourceWeight),pct(r.targetAmount/state.settings.budget),r.price?money(r.price)+`<small>${esc(r.priceDate)}<br>${esc(r.priceSource)}</small>`:'缺少報價',
        money(r.targetAmount),r.targetShares===null?'—':money(r.targetShares)+' 股',state.holdingsConfirmed?money(r.currentShares)+' 股':'未確認',
        `<strong class="${r.delta>0?'buy':'sell'}">${state.holdingsConfirmed?change:'待盤點'}</strong><small>${esc(r.action)}${state.holdingsConfirmed&&r.amount?' · 約 '+money(r.amount)+' 元':''}</small>`];
      const labels=['股票','朋友占比','我的目標占比','參考價 / 日期','目標金額','目標股數','實際股數','調整差額'];
      return '<tr>'+cells.map((v,i)=>`<td data-label="${labels[i]}">${v}</td>`).join('')+'</tr>';
    }).join(''):'<tr><td colspan="8">目前沒有符合門檻的股票；目標保留全部現金。</td></tr>';
    const noPrice=shown.some(r=>r.price===null);
    $('plan-note').textContent=!state.holdingsConfirmed?'請在「我的實際庫存」確認股數與可用現金；確認前只顯示目標試算，不假設你已持有或已空手。':
      (noPrice?'部分股票缺價，清單不完整。請補價後核對。 ':'')+
      `試算買進 ${money(p.buy)} 元／賣出 ${money(p.sell)} 元。可用現金 ${money(state.cash)} 元；全部差額成交後約剩 ${money(p.cashAfter)} 元（未扣實付費稅）。`+
      (p.shortfall>0?` 尚不足 ${money(p.shortfall)} 元（含費用預留），請先調整目標資金或核對現金。`:p.buy>state.cash?' 需先完成賣出並確認資金可用，再安排買進。':'');
    const historical=shown.some(r=>r.priceSource.includes('歷史'));
    const old=shown.some(r=>r.priceDate && (Date.parse(today())-Date.parse(r.priceDate.slice(0,10)))>3*86400000);
    $('quote-note').textContent=(historical?'部分價格來自庫存快照，僅供歷史試算。 ':'')+(old?'部分報價距今超過3日。 ':'')+
      '每檔價格日期列於表內，非即時報價。朋友占比固定用快照價格；刷新報價只重算目標股數，不視為朋友買賣。';
  }
  function renderHistory() {
    $('history').innerHTML=state.events.length?state.events.map(e=>`<article><small>${esc(e.at)}</small>${esc(e.message)}</article>`).join(''):'<p class="muted">尚無更新紀錄</p>';
    $('trades').innerHTML=state.trades.length?state.trades.map(t=>`<article><small>${esc(t.date)}</small>${esc(t.symbol)} ${t.side==='buy'?'買進':'賣出'} ${money(t.shares)} 股 × ${money(t.price)} 元<br>費稅 ${money(t.fees)} 元${t.side==='sell'?'<br>已實現損益：'+(t.realized===null?'成本未知，無法計算':money(t.realized)+' 元'):''}</article>`).join(''):'<p class="muted">尚無實際成交</p>';
  }
  async function load() {
    if(busy) return;
    if(dirty && !confirm('有未儲存的草稿，確定載入雲端並放棄草稿？')) return;
    busy=true; connected=false;status('正在讀取雲端…');
    try {
      await new Promise((resolve,reject)=>{
        const deadline=Date.now()+15000;
        (function waitInit(){
          if(window.loadFollowPortfolio&&window.fbReady)resolve();
          else if(Date.now()>deadline)reject(new Error('資料模組未能載入，請檢查網路後重整'));
          else setTimeout(waitInit,100);
        })();
      });
      const loaded=await timeout(window.loadFollowPortfolio());
      state=loaded?validateState(loaded):C.initialState();
      connected=true;dirty=false;
      fillSettings();renderFriends();renderOwn();renderPlan();renderHistory();
      $('snapshot-date').value=state.snapshot?.date || today();
      status(loaded?'已載入雲端帳本 · '+(state.updatedAt || ''):'雲端已連接。請先匯入朋友庫存，再確認你的實際庫存。','ok');
    }finally{busy=false;}
  }
  function validateState(s) {
    if(s.version!==1) throw new Error('不支援此帳本版本');
    const result={...C.initialState(),...s,settings:C.settings(s.settings),holdings:C.holdings(s.holdings),cash:C.number(s.cash,'現金')};
    delete result.draft;
    result.snapshot=s.snapshot?C.snapshot(s.snapshot):null;
    for(const key of ['events','snapshots','trades']) if(!Array.isArray(result[key])) throw new Error('備份紀錄格式不正確');
    if(result.events.length>100 || result.snapshots.length>50 || result.trades.length>500) throw new Error('備份超出紀錄容量');
    result.holdingsConfirmed=s.holdingsConfirmed===true;
    return result;
  }
  async function refreshPrices() {
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
    try {
      const res=await fetch('data/stock_prices.json?t='+Date.now(),{signal:controller.signal});
      if(!res.ok) throw new Error('報價檔讀取失敗');
      const json=await res.json();quotes={};
      for(const [code,q] of Object.entries(json.prices || {})) {
        if(typeof q.price==='number' && q.price>0) quotes[code.toUpperCase()]={price:q.price,date:q.as_of || json.updated_at,source:'排程報價（非即時）'};
      }
      renderPlan();
      return json.updated_at;
    }finally{clearTimeout(timer);}
  }
  $('settings-form').addEventListener('submit',handle(async()=>{
    const next=C.clone(state);next.settings=C.settings(Object.fromEntries(['budget','threshold','mode','reserve','minTrade'].map(k=>[k,$(k).value])));
    await persist(next,`規則更新：資金 ${money(next.settings.budget)}、門檻 >${next.settings.threshold}%、${next.settings.mode==='original'?'原占比留現金':'入選配滿'}`);
  }));
  $('add-friend').addEventListener('click',handle(()=>{renderFriends([...readFriends(),{symbol:'',name:'',shares:0,price:'',market:'TW'}]);dirty=true;}));
  $('friend-body').addEventListener('click',e=>{if(e.target.hasAttribute('data-remove')){e.target.closest('tr').remove();dirty=true;}});
  $('apply-quick').addEventListener('click',handle(()=>{renderFriends(parseQuickUpdate($('quick-update').value,readFriends()));$('snapshot-date').value=today();$('quick-update').value='';dirty=true;status('快速更新已套用到草稿。請核對表格後按「儲存庫存並產生調整清單」。');}));
  $('parse-csv').addEventListener('click',handle(()=>{const snap=C.parseCSV($('csv').value,$('snapshot-date').value);renderFriends(snap.items);dirty=true;status('CSV 已載入草稿，請核對後按「儲存庫存」。');}));
  $('save-snapshot').addEventListener('click',handle(async()=>{
    const snap=C.snapshot({date:$('snapshot-date').value,items:readFriends()});
    if(snap.date>today()) throw new Error('庫存日期不可晚於今天');
    if(state.snapshot && snap.date<state.snapshot.date) throw new Error('新庫存日期不可早於現有快照');
    if(!snap.items.some(r=>r.shares>0) && !confirm('朋友庫存將設為空手；所有我的持股都會列為退出差額。確定？'))return;
    const next=C.clone(state), previous=state.snapshot?.items || [];
    const codes=[...new Set([...previous.map(r=>r.symbol),...snap.items.map(r=>r.symbol)])];
    const changes=codes.map(code=>{const delta=(snap.items.find(r=>r.symbol===code)?.shares||0)-(previous.find(r=>r.symbol===code)?.shares||0);return delta?code+' '+(delta>0?'+':'')+delta+'股':null;}).filter(Boolean);
    next.snapshot=snap;next.snapshots.unshift({at:new Date().toISOString(),snapshot:snap});next.snapshots=next.snapshots.slice(0,50);
    await persist(next,'朋友庫存 '+snap.date+'：'+(changes.join('、') || '股數不變，更新參考價'));
    renderOwn();
  }));
  $('friend-trade').addEventListener('submit',handle(()=>{
    const code=C.symbol($('f-symbol').value),qty=C.number($('f-shares').value,'通知股數',1,true),price=C.number($('f-price').value,'通知價格',0.000001);
    const items=readFriends();let row=items.find(r=>r.symbol===code);
    if(!row){if($('f-side').value==='sell')throw new Error('草稿找不到這檔股票');row={symbol:code,name:code,market:'TW',shares:0,price};items.push(row);}
    row.shares=C.number(row.shares,'原持股',0,true)+($('f-side').value==='buy'?qty:-qty);
    if(row.shares<0)throw new Error('通知賣出量超過朋友持股');
    row.price=price;renderFriends(items);$('snapshot-date').value=today();dirty=true;
    status('通知已套用草稿。新股票請核對名稱／市場，並核對庫存日期及各檔參考價後儲存。');
  }));
  $('save-own').addEventListener('click',handle(async()=>{
    const next=C.clone(state);
    next.cash=C.number($('own-cash').value,'實際可用現金');
    next.holdings=C.holdings([...$('own-body').rows].map(row=>{
      const source=state.snapshot?.items.find(r=>r.symbol===row.dataset.symbol) || state.holdings.find(r=>r.symbol===row.dataset.symbol);
      return {...source,symbol:row.dataset.symbol,shares:row.querySelector('[data-key="shares"]').value,avgCost:row.querySelector('[data-key="avgCost"]').value};
    }));next.holdingsConfirmed=true;
    if(state.holdingsConfirmed && !confirm('以這次盤點校正實際股數與現金？歷史成交紀錄會保留。'))return;
    await persist(next,'我的庫存盤點確認；可用現金 '+money(next.cash)+' 元');
  }));
  $('add-own').addEventListener('click',handle(()=>{
    const entered=prompt('要加入跟單帳本的股票代號：');if(entered===null)return;
    const code=C.symbol(entered);
    if([...$('own-body').rows].some(r=>r.dataset.symbol===code))throw new Error('此股票已在庫存表中');
    $('own-body').insertAdjacentHTML('beforeend',`<tr data-symbol="${esc(code)}"><td>${esc(code)}</td><td><input data-key="shares" aria-label="${esc(code)}實際股數" type="number" min="0" step="1" value="0"></td><td><input data-key="avgCost" aria-label="${esc(code)}平均成本" type="number" min="0.000001" step="any" placeholder="未知"></td></tr>`);
    dirty=true;
  }));
  $('trade-form').addEventListener('submit',handle(async()=>{
    const input=Object.fromEntries(['date','symbol','side','shares','price','fees'].map(k=>[k,$('t-'+k).value]));
    if(input.date>today())throw new Error('成交日期不可晚於今天');
    if(state.trades[0] && input.date<state.trades[0].date) throw new Error('請依成交順序記錄；補登較早交易請先用庫存盤點校正');
    const next=C.applyTrade(state,input);
    if(!confirm(`確認已${input.side==='buy'?'買進':'賣出'} ${input.symbol} ${input.shares} 股，成交價 ${input.price} 元，費稅 ${input.fees} 元？`))return;
    await persist(next,'記錄實際成交 '+input.symbol+' '+input.shares+' 股');renderOwn();
    $('t-shares').value='';$('t-price').value='';
  }));
  $('quote-form').addEventListener('submit',handle(()=>{
    const code=C.symbol($('q-symbol').value),date=C.date($('q-date').value);
    if(date>today())throw new Error('報價日期不可晚於今天');
    quotes[code]={price:C.number($('q-price').value,'價格',0.000001),date,source:'手動報價'};renderPlan();status('已套用本次手動報價；雲端庫存未變更。');
  }));
  $('import').addEventListener('change',handle(async e=>{
    const file=e.target.files[0];if(!file)return;
    try{
      if(file.size>800000)throw new Error('匯入檔過大');
      const data=JSON.parse(await file.text());
      if(data.version===1 && data.settings){
        if(!confirm('這是完整帳本備份。確認用備份替換目前帳本？請先確保已有現存備份。'))return;
        const restored=validateState(data);restored.revision=state.revision;
        await persist(restored,'從備份還原帳本');fillSettings();renderFriends();renderOwn();$('snapshot-date').value=state.snapshot?.date||today();
      }else{
        const snap=C.snapshot(data.snapshot || data);
        renderFriends(snap.items);$('snapshot-date').value=snap.date;dirty=true;
        status('已匯入 '+snap.date+'、'+snap.items.length+' 檔至草稿。請核對後按「儲存庫存並產生調整清單」。');
      }
    }finally{e.target.value='';}
  }));
  $('export').addEventListener('click',handle(()=>{
    const backup={...state,draft:{date:$('snapshot-date').value,items:readFriends()}};
    const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='follow-backup-'+today()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
    status('已產生備份檔；包含已儲存帳本與朋友未儲存草稿。');
  }));
  $('reload').addEventListener('click',handle(load));
  $('refresh').addEventListener('click',handle(async()=>{const date=await refreshPrices();status('已刷新報價檔 · '+date+'。庫存與成交紀錄未變更。');}));
  document.addEventListener('input',e=>{if(e.target.matches('#settings-form input,#settings-form select,#friend-body input,#friend-body select,#own-body input,#own-cash,#snapshot-date'))dirty=true;});
  window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
  for(const key of ['t-date','q-date','snapshot-date'])$(key).value=today();
  renderPlan();
  load().catch(e=>status('雲端載入失敗：'+e.message,'error'));
  refreshPrices().catch(()=>{$('quote-note').textContent='報價讀取失敗，保留庫存快照價格，僅供歷史試算。';});
})();
