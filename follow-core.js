/* Pure allocation calculations; share quantities are always shares, not lots. */
(function (root) {
  'use strict';
  const clone = x => JSON.parse(JSON.stringify(x));
  function number(value, label, min = 0, integer = false) {
    if (value === '' || value === null || value === undefined) throw new Error(label + '不可空白');
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || (integer && !Number.isSafeInteger(n))) throw new Error(label + '格式不正確');
    return n;
  }
  function date(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new Error('日期格式不正確');
    return value;
  }
  function symbol(value) {
    const s = String(value || '').trim().toUpperCase();
    if (!/^[0-9A-Z]{4,8}$/.test(s)) throw new Error('請輸入正確股票代號');
    return s;
  }
  function snapshot(value) {
    if (!value || !Array.isArray(value.items) || value.items.length > 100) throw new Error('庫存必須是最多100檔的 items 陣列');
    const seen = new Set();
    return {date: date(value.date), items: value.items.map(r => {
      const code = symbol(r.symbol);
      if (seen.has(code)) throw new Error(code + ' 重複出現');
      seen.add(code);
      const market = r.market || 'TW';
      if (!['TW','TWO'].includes(market)) throw new Error(code + ' 市場必須為 TW 或 TWO');
      return {symbol: code, name: String(r.name || code).slice(0,60), market,
        shares: number(r.shares, code + '朋友股數', 0, true),
        price: number(r.price, code + '快照參考價', 0.000001)};
    })};
  }
  function settings(value) {
    const result = {
      budget: number(value.budget, '目標總資金', 1),
      threshold: number(value.threshold, '篩選門檻'),
      reserve: number(value.reserve, '費用預留'),
      minTrade: number(value.minTrade, '最小調整金額'),
      mode: value.mode
    };
    if (result.threshold > 100 || result.reserve > result.budget || !['original','normalized'].includes(result.mode)) throw new Error('配置設定超出範圍');
    return result;
  }
  function initialState() {
    return {version:1, revision:0, snapshot:null, settings:{budget:100000,threshold:5,reserve:500,minTrade:500,mode:'original'},
      cash:100000, holdings:[], holdingsConfirmed:false, snapshots:[], trades:[], events:[]};
  }
  function holdings(list) {
    if (!Array.isArray(list) || list.length > 100) throw new Error('我的庫存格式不正確');
    const seen = new Set();
    return list.map(r => {
      const code = symbol(r.symbol);
      if (seen.has(code)) throw new Error('我的庫存代號重複：' + code);
      seen.add(code);
      return {symbol:code, name:String(r.name || code).slice(0,60), market:r.market === 'TWO' ? 'TWO' : 'TW',
        shares:number(r.shares,'我的股數',0,true), avgCost:r.avgCost === '' || r.avgCost == null ? null : number(r.avgCost,'均價',0.000001)};
    });
  }
  function calculate(state, quotes = {}) {
    const cfg = settings(state.settings), snap = state.snapshot ? snapshot(state.snapshot) : {items:[]};
    const mine = holdings(state.holdings), total = snap.items.reduce((s,r)=>s+r.shares*r.price,0);
    const eligible = snap.items.filter(r => total > 0 && r.shares*r.price/total*100 > cfg.threshold);
    const selectedValue = eligible.reduce((s,r)=>s+r.shares*r.price,0);
    const spendable = cfg.budget - cfg.reserve;
    const symbols = [...new Set([...snap.items.map(r=>r.symbol),...mine.map(r=>r.symbol)])];
    const rows = symbols.map(code => {
      const source = snap.items.find(r=>r.symbol===code), own=mine.find(r=>r.symbol===code);
      const selected = eligible.some(r=>r.symbol===code);
      const sourceWeight = source && total ? source.shares*source.price/total : 0;
      const weight = !selected ? 0 : cfg.mode === 'normalized' ? source.shares*source.price/selectedValue : sourceWeight;
      const q = quotes[code];
      const quoteValid = q && Number.isFinite(q.price) && q.price > 0 && q.date && (!state.snapshot || q.date.slice(0,10) >= state.snapshot.date);
      const price = quoteValid ? q.price : source?.price || null;
      const priceDate = quoteValid ? q.date : state.snapshot?.date || '';
      const targetAmount = spendable*weight;
      const targetShares = price ? Math.floor((targetAmount+1e-8)/price) : null;
      const currentShares = own?.shares || 0;
      const delta = targetShares === null ? null : targetShares-currentShares;
      const amount = delta === null ? null : Math.abs(delta)*price;
      const small = amount !== null && amount > 0 && amount < cfg.minTrade && targetShares > 0 && currentShares > 0;
      return {symbol:code,name:source?.name || own?.name || code,market:source?.market || own?.market || 'TW',
        selected,sourceWeight,weight,price,priceDate,priceSource:quoteValid ? (q.source || '排程報價') : '庫存快照（歷史試算）',
        targetAmount,targetShares,currentShares,delta,amount,small,
        action:!state.holdingsConfirmed ? '待確認庫存' : delta===null ? '缺價待補' : delta===0 ? '不需調整' : small ? '暫緩小額調整' : delta>0 ? '買進差額' : '賣出差額'};
    }).sort((a,b)=>b.weight-a.weight || a.symbol.localeCompare(b.symbol));
    const actionable=rows.filter(r=>!r.small && r.delta !== null);
    const buy=actionable.filter(r=>r.delta>0).reduce((s,r)=>s+r.amount,0);
    const sell=actionable.filter(r=>r.delta<0).reduce((s,r)=>s+r.amount,0);
    const allocated=rows.reduce((s,r)=>s+(r.targetShares===null ? 0 : r.targetShares*r.price),0);
    return {rows,total,selectedCount:eligible.length,selectedWeight:total?selectedValue/total:0,
      topTwo:rows.slice(0,2).reduce((s,r)=>s+r.weight,0),allocated,targetCash:cfg.budget-allocated,buy,sell,
      cashAfter:state.cash+sell-buy,shortfall:Math.max(0,buy+cfg.reserve-state.cash-sell)};
  }
  function applyTrade(state, input) {
    if (!state.holdingsConfirmed) throw new Error('請先確認我的實際庫存與現金');
    const next=clone(state), code=symbol(input.symbol), qty=number(input.shares,'成交股數',1,true);
    const price=number(input.price,'成交價',0.000001), fees=number(input.fees,'手續費與稅');
    date(input.date);
    if (!['buy','sell'].includes(input.side)) throw new Error('買賣方向不正確');
    const found=next.holdings.find(r=>r.symbol===code);
    const source=next.snapshot?.items.find(r=>r.symbol===code);
    const h=found || {symbol:code,name:source?.name || code,market:source?.market || 'TW',shares:0,avgCost:null};
    let realized=null;
    if (input.side === 'buy') {
      const cost=qty*price+fees;
      if (cost > next.cash+1e-8) throw new Error('可用現金不足，請先核對現金或記錄賣出成交');
      h.avgCost=h.shares>0 && h.avgCost===null ? null : ((h.avgCost || 0)*h.shares+cost)/(h.shares+qty);
      h.shares+=qty; next.cash-=cost;
      if (!found) next.holdings.push(h);
    } else {
      if (!found || qty>h.shares) throw new Error('賣出股數超過實際庫存');
      if (h.avgCost!==null) realized=qty*(price-h.avgCost)-fees;
      h.shares-=qty; next.cash+=qty*price-fees;
      if (next.cash < -1e-8) throw new Error('費稅超過可用現金與賣出收入');
      if (!h.shares) h.avgCost=null;
    }
    next.cash=Math.round(next.cash*100)/100;
    next.trades.unshift({date:input.date,symbol:code,side:input.side,shares:qty,price,fees,realized,recordedAt:new Date().toISOString()});
    if(next.trades.length>500) throw new Error('成交紀錄已達500筆，請先匯出備份並另建帳本');
    return next;
  }
  function parseCSV(text, snapshotDate) {
    const lines=text.trim().split(/\r?\n/).filter(x=>x.trim());
    if (!lines.length) throw new Error('請貼上完整庫存');
    const items=lines.map((line,i)=>{
      const v=line.split(/\t|,/).map(x=>x.trim());
      if (i===0 && /symbol|代號/i.test(v[0])) return null;
      if (v.length!==5) throw new Error('第'+(i+1)+'行須為：代號,名稱,市場,股數,參考價（數字勿加千分位）');
      return {symbol:v[0],name:v[1],market:v[2],shares:v[3],price:v[4]};
    }).filter(Boolean);
    return snapshot({date:snapshotDate,items});
  }
  const api={clone,number,date,symbol,snapshot,settings,holdings,initialState,calculate,applyTrade,parseCSV};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.FollowCore=api;
})(typeof window!=='undefined'?window:globalThis);
