(function (root, factory) {
  'use strict';
  const api = factory(typeof require === 'function' ? require('./defense-governance.js') : root.DefenseGovernance);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DefenseCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (G) {
  'use strict';
  const VERSION = 'forward-candidate-v4-dynamic-equity';
  const START = '2026-09-16';
  const CAPITAL = 2000000;
  const MULT = Object.freeze({TX: 200, MTX: 50, TMF: 10});
  const ALIASES = Object.freeze({TX: 'TX', TXF: 'TX', 大台: 'TX', MTX: 'MTX', MXF: 'MTX', 小台: 'MTX', TMF: 'TMF', 微台: 'TMF'});
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const clone = x => JSON.parse(JSON.stringify(x));
  function assert(ok, message) { if (!ok) throw new Error(message); }
  function number(x, label, minimum) {
    assert(finite(x), label + '必須是有效數值');
    if (minimum !== undefined) assert(x >= minimum, label + '不得小於 ' + minimum);
    return x;
  }
  function date(value) {
    assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), '日期格式應為 YYYY-MM-DD');
    const d = new Date(value + 'T00:00:00Z');
    assert(Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value, '日期不存在');
    return value;
  }
  function timestamp(value) {
    assert(typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value), '時間必須包含時區');
    const t = Date.parse(value);
    assert(Number.isFinite(t), '時間無效');
    return t;
  }
  function twDate(value) {
    return new Date(timestamp(value) + 8 * 3600000).toISOString().slice(0, 10);
  }
  function product(value) {
    assert(Object.hasOwn(ALIASES, value), '未知期貨商品：' + String(value));
    return ALIASES[value];
  }
  function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
  function strategyEquity(equity, outside) {
    number(equity, '期貨帳戶權益'); number(outside, '場外資金', 0);
    const total = equity + outside;
    return total > 0 ? total : null;
  }
  function quantile(values, q) {
    if (!values.length) return null;
    const a = [...values].sort((x, y) => x - y), p = (a.length - 1) * q, i = Math.floor(p);
    return a[i] + (a[Math.min(i + 1, a.length - 1)] - a[i]) * (p - i);
  }
  function indicators(rows) {
    assert(Array.isArray(rows), '0050資料不存在');
    let previous = '';
    rows.forEach(r => {
      date(r.date);
      assert(r.date > previous, '0050交易日必須遞增且不可重複');
      previous = r.date;
      number(r.close, '0050收盤', Number.MIN_VALUE);
    });
    if (rows.length < 80) return {valid: false, reason: '至少需要80個交易日，才能計算20交易日前MA60'};
    const c = rows.map(r => r.close), average = (n, lag = 0) => mean(c.slice(c.length - lag - n, c.length - lag));
    return {valid: true, date: rows.at(-1).date, close: c.at(-1),
      ma10: average(10), ma20: average(20), ma60: average(60), ma60Lag20: average(60, 20)};
  }
  function classify(v) {
    for (const k of ['close', 'ma10', 'ma20', 'ma60', 'ma60Lag20']) number(v[k], k, Number.MIN_VALUE);
    const bear = v.close < v.ma60 && v.ma60 < v.ma60Lag20;
    if (!bear) return {...v, valid: true, bear, target: 2, state: 'nonbear:2', reason: '未確認空頭 · 2.0x'};
    // Round 3 user-confirmed ordering, including crossed MA10/MA20.
    const target = v.close >= v.ma20 ? 1.5 : v.close > v.ma10 ? 1 : 0.5;
    const overlap = v.close >= v.ma20 && v.close <= v.ma10;
    return {...v, valid: true, bear, target, state: 'bear:' + target,
      overlap, boundaryPolicy: 'MA20-first', reason: '確認空頭 · ' + target.toFixed(1) + 'x'};
  }
  function signal(rows) {
    const v = indicators(rows);
    return v.valid ? classify(v) : {...v, target: null, state: 'missing', bear: null};
  }
  function normalizeAccount(a) {
    assert(a && typeof a === 'object', '請先建立第4策略帳戶');
    timestamp(a.asof);
    date(a.equityDate);
    number(a.equity, '期貨帳戶權益');
    number(a.outside, '場外備用資金', 0);
    number(a.indexAtEquity, '權益對應加權指數', Number.MIN_VALUE);
    number(a.initialMargin, '原始保證金', 0);
    number(a.maintenanceMargin, '維持保證金', 0);
    assert(a.initialMargin >= a.maintenanceMargin, '原始保證金不得低於維持保證金');
    assert(Array.isArray(a.positions), '持倉資料必須是陣列');
    const positions = a.positions.map(p => {
      const code = product(p.product);
      assert(Number.isInteger(p.lots), '口數必須是整數');
      assert(typeof p.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p.month), '合約月份格式應為 YYYY-MM');
      if (p.mark !== null && p.mark !== undefined) number(p.mark, '期貨參考價', Number.MIN_VALUE);
      return {product: code, month: p.month, lots: p.lots, mark: p.mark ?? null};
    }).filter(p => p.lots !== 0);
    const keys = positions.map(p => p.product + p.month);
    assert(new Set(keys).size === keys.length, '同商品同月份請合併為一筆淨口數');
    if (positions.length) {
      assert(a.initialMargin > 0 && a.maintenanceMargin > 0, '有部位時必須填寫足額原始與維持保證金');
    } else assert(a.initialMargin === 0 && a.maintenanceMargin === 0, '無部位時本策略所需保證金應為0');
    if (a.nextRollDate) date(a.nextRollDate);
    return {...clone(a), positions, capitalBase: CAPITAL};
  }
  function risk(equity, outside, initialMargin, maintenanceMargin) {
    number(equity, '權益'); number(outside, '場外資金', 0);
    number(initialMargin, '原始保證金', 0); number(maintenanceMargin, '維持保證金', 0);
    assert(initialMargin >= maintenanceMargin, '保證金次序錯誤');
    const ratio = initialMargin > 0 ? equity / initialMargin * 100 : null;
    const below500 = initialMargin > 0 && equity < 5 * initialMargin;
    const to550 = initialMargin > 0 ? Math.max(0, 5.5 * initialMargin - equity) : 0;
    const suggestedDeposit = Math.ceil(to550); // Explicit whole-dollar execution amount, not the risk comparison.
    const topUp = below500 ? suggestedDeposit : 0, availableTransfer = Math.min(outside, topUp);
    return {ratio, below500, approaching: ratio !== null && ratio >= 500 && ratio < 550,
      topUp, to550, suggestedDeposit, availableTransfer, fundingShortfall: topUp - availableTransfer,
      reserveSufficient: outside >= to550, shortfallTo550: Math.max(0, to550 - outside), equityDeficit: Math.max(0, -equity),
      equityAfterTransfer: equity + availableTransfer, outsideAfterTransfer: outside - availableTransfer,
      maintenanceBuffer: equity - maintenanceMargin,
      belowMaintenance: maintenanceMargin > 0 && equity < maintenanceMargin,
      nearMaintenance: maintenanceMargin > 0 && equity >= maintenanceMargin && equity <= initialMargin,
      monthlyTransfer: initialMargin > 0 ? Math.ceil(5.5 * initialMargin - equity) : 0};
  }
  function stress(index, a) {
    number(index, '加權指數', Number.MIN_VALUE);
    const account = normalizeAccount(a), before = account.equity + account.outside;
    const lots = {TX: 0, MTX: 0, TMF: 0};
    account.positions.forEach(p => { lots[p.product] += p.lots; });
    return [-0.05, -0.10, -0.15, -0.20].map(change => {
      const pointChange = index * change, pnl = {};
      const contractPnl = account.positions.map(p => ({...p, multiplier: MULT[p.product],
        pnl: pointChange * p.lots * MULT[p.product]}));
      Object.keys(MULT).forEach(k => { pnl[k] = pointChange * lots[k] * MULT[k]; });
      const totalPnl = Object.values(pnl).reduce((s, v) => s + v, 0);
      const equity = account.equity + totalPnl, total = equity + account.outside;
      return {change, currentIndex: index, scenarioIndex: index + pointChange, pointChange, pnl, totalPnl, contractPnl,
        basis: 'actual-contracts-fixed', holdingsFixed: true, intradaySignalsApplied: false,
        initialMargin: account.initialMargin, maintenanceMargin: account.maintenanceMargin,
        marginAssumption: '持倉不變、保證金不變；不假設跌價後自動降低保證金',
        equity, outside: account.outside, total, drawdownPct: before > 0 ? (before - total) / before * 100 : null,
        ...risk(equity, account.outside, account.initialMargin, account.maintenanceMargin)};
    });
  }
  function decision(s, actual, lastAppliedState, rollDue, allocationReady = true) {
    if (actual !== null) number(actual, '實際曝險');
    const gap = s.valid && actual !== null ? s.target - actual : null;
    const insideBand = gap !== null ? Math.abs(gap) <= 0.05 + 1e-12 : null;
    const signalChanged = s.valid && lastAppliedState !== s.state;
    const actionRequired = Boolean(rollDue || (s.valid && (signalChanged || insideBand === false)));
    return {gap, insideBand, signalChanged, rollDue, allocationReady,
      rebalanceRequired: allocationReady && s.valid && (signalChanged || insideBand === false),
      actionRequired, tradeRequired: allocationReady && actionRequired,
      blockedReason: allocationReady ? null : 'valuation-unavailable'};
  }
  function buildSnapshot(market, rawAccount, now) {
    timestamp(now);
    const today = twDate(now), a = normalizeAccount(rawAccount);
    const signalWindow = G.signalEligibility(now, market.date), eodWindow = G.eodEligibility(now, market.date);
    const s = signalWindow.eligible ? signal(market.target) : {valid: false, date: market.date, target: null, bear: null, state: 'pending', reason: signalWindow.reason};
    const index = number(market.index, '加權指數', Number.MIN_VALUE);
    date(market.date);
    assert(market.date <= today, '行情日期晚於今日，停止計算');
    assert(timestamp(a.asof) <= timestamp(now), '帳戶基準時間不可晚於快照時間');
    assert(a.equityDate <= market.date, '帳戶日期晚於行情，無法倒推估值');
    const pointValue = a.positions.reduce((sum, p) => sum + p.lots * MULT[p.product], 0);
    const indexDelta = index - a.indexAtEquity;
    const confirmed = a.equityDate === market.date && Math.abs(indexDelta) < 1e-9;
    const futures = new Map((market.futures || []).filter(q => q.date === market.date && finite(q.mark))
      .map(q => [product(q.product) + ':' + q.month, q]));
    const contractsAvailable = a.positions.length > 0 && a.positions.every(p => p.mark !== null && futures.has(p.product + ':' + p.month));
    const estimatedPnl = !confirmed && contractsAvailable ? a.positions.reduce((n, p) =>
      n + (futures.get(p.product + ':' + p.month).mark - p.mark) * p.lots * MULT[p.product], 0) : 0;
    const equity = a.equity + estimatedPnl, accountNow = {...a, equity};
    const equitySource = confirmed ? 'broker_confirmed' : contractsAvailable ? 'futures_mtm' : 'last_confirmed';
    let notional = 0, grossNotional = 0;
    const lots = {TX: 0, MTX: 0, TMF: 0};
    a.positions.forEach(p => {
      const mark = futures.get(p.product + ':' + p.month)?.mark ?? p.mark;
      const n = p.lots * MULT[p.product] * mark;
      notional += n; grossNotional += Math.abs(n); lots[p.product] += p.lots;
    });
    const marksAvailable = a.positions.every(p => p.mark !== null || futures.has(p.product + ':' + p.month));
    if (!marksAvailable) { notional = null; grossNotional = null; }
    const valuedEquity = strategyEquity(equity, a.outside);
    const equityValuationAvailable = confirmed || a.positions.length === 0 || contractsAvailable;
    const allocationReady = equityValuationAvailable && marksAvailable && valuedEquity !== null && s.valid;
    const allocationStatus = allocationReady ? 'ready' : 'valuation-unavailable';
    const actual = allocationReady ? notional / valuedEquity : null;
    const targetNotional = allocationReady ? valuedEquity * s.target : null;
    const rollDue = Boolean(a.positions.length && a.nextRollDate && today >= a.nextRollDate);
    const d = decision(s, actual, a.lastAppliedState, rollDue, allocationReady);
    const r = risk(equity, a.outside, a.initialMargin, a.maintenanceMargin);
    const quality = [];
    if (!marksAvailable) quality.push('缺少實際期貨參考價，實際曝險暫不計算');
    if (valuedEquity === null) quality.push('總策略權益小於或等於0，停止配口');
    if (market.date !== today) quality.push('行情非今日收盤：' + market.date);
    if (market.closed !== true) quality.push('0050尚未確認收盤');
    if (!s.valid) quality.push(s.reason);
    if (!signalWindow.eligible) quality.push('13:30前不使用當日0050收盤訊號');
    if (!eodWindow.eligible) quality.push('13:45前不建立正式EOD MTM／snapshot');
    if (s.date && s.date !== market.date) quality.push('0050與加權指數日期未對齊');
    if (!confirmed) quality.push(contractsAvailable ? '帳戶依逐合約期貨價MTM，待券商核對' : '缺逐合約期貨價，權益保留最後核對值，不用指數代算');
    if (!allocationReady) quality.push('allocationStatus = valuation-unavailable；保留最後確認資料，不提供即時調整口數');
    if (!a.nextRollDate && a.positions.length) quality.push('尚未設定換倉日');
    if (a.positions.some(p => p.lots < 0)) quality.push('存在空單，與本策略多頭曝險規則不符');
    const marketValid = market.closed === true && market.date === today && s.date === market.date && eodWindow.eligible;
    const labels = [];
    if (r.below500) labels.push('需補款');
    if (rollDue) labels.push('需換倉');
    if (d.rebalanceRequired && market.closed === true) labels.push('需調倉');
    if (r.approaching) labels.push('接近警戒');
    if (quality.length) labels.push('資料待核對');
    if (!labels.length) labels.push('正常');
    return {schemaVersion: 1, formulaVersion: VERSION, forwardStart: START, date: today, observedAt: now,
      marketDate: market.date, marketUpdatedAt: market.updatedAt, index, signal: s,
      source: market.source || 'Yahoo Finance', accountRevision: a.revision || 0,
      accountAsOf: a.asof, equityDate: a.equityDate, positions: a.positions, lots, pointValue,
      capitalBase: CAPITAL, capitalBasePurpose: 'forward-opening-and-performance-benchmark-only',
      strategyEquity: valuedEquity, targetNotional, allocationStatus,
      notional, grossNotional, actualExposure: actual,
      exposureSource: marksAvailable ? 'futures_marks' : 'missing_futures_marks',
      equity, outside: a.outside, totalEquity: equity + a.outside, estimatedPnl,
      equitySource,
      initialMargin: a.initialMargin, maintenanceMargin: a.maintenanceMargin,
      risk: r, riskReconciliation: G.reconcileBrokerRisk({calculated: {initialMargin: a.initialMargin, maintenanceMargin: a.maintenanceMargin, ratio: r.ratio},
        broker: {initialMargin: a.brokerReportedInitialMargin, maintenanceMargin: a.brokerReportedMaintenanceMargin,
          ratio: a.brokerReportedRatio, reportedAt: a.brokerReportedAt}, asOf: now}),
      signalWindow, eodWindow, decision: d, stress: stress(index, accountNow), labels, quality,
      valuationValid: marketValid, performanceEligible: marketValid && confirmed && today >= START,
      nextRollDate: a.nextRollDate || null, monthCleanupDue: a.lastCleanupMonth !== today.slice(0, 7)};
  }
  function checkBook(levels, side) {
    assert(Array.isArray(levels) && levels.length === 5, '請記錄完整五檔' + side);
    levels.forEach((l, i) => {
      number(l.price, '五檔價'); number(l.lots, '五檔量', 1);
      assert(Number.isInteger(l.lots), '五檔口數應為整數');
      if (i > 0) assert(side === 'bid' ? levels[i - 1].price > l.price : levels[i - 1].price < l.price, '五檔價格排序或重複有誤');
    });
  }
  function analyzeExecution(raw) {
    const o = clone(raw);
    assert(typeof o.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(o.id), '委託ID格式錯誤');
    const code = product(o.product), mult = MULT[code];
    assert(['roll', 'signal'].includes(o.kind), '交易類別應為換倉或訊號調倉');
    assert(['buy', 'sell'].includes(o.side), '買賣方向無效');
    const sign = o.side === 'buy' ? 1 : -1;
    const ordered = timestamp(o.orderedAt);
    date(o.tradeDate);
    assert(twDate(o.orderedAt) === o.tradeDate, '日期與下單時間不一致，交易統計採台灣曆日');
    assert(Number.isInteger(o.requestedLots) && o.requestedLots > 0, '委託口數應為正整數');
    number(o.firstLimit, '第一筆委託價');
    if (o.abnormalThreshold !== null && o.abnormalThreshold !== undefined) number(o.abnormalThreshold, '異常滑價門檻', 0);
    assert(/^\d{4}-(0[1-9]|1[0-2])$/.test(o.nearMonth), '近月月份格式錯誤');
    if (o.kind === 'roll') {
      assert(/^\d{4}-(0[1-9]|1[0-2])$/.test(o.farMonth) && o.farMonth > o.nearMonth, '遠月必須晚於近月');
      assert(o.quoteConvention === 'far-minus-near', '換月價差統一為遠月減近月');
    }
    checkBook(o.bids, 'bid'); checkBook(o.asks, 'ask');
    assert(o.bids[0].price <= o.asks[0].price, '五檔委買不得高於委賣');
    const bookAt = timestamp(o.bookAt);
    assert(bookAt <= ordered, 'arrival五檔截圖時間不可晚於下單');
    assert(Array.isArray(o.fills) && o.fills.length > 0, '至少需要一筆實際成交');
    let lots = 0, value = 0, wait = 0, fee = 0, tax = 0, costComplete = true, last = ordered;
    o.fills.forEach(f => {
      const t = timestamp(f.at);
      assert(t >= ordered && t >= last, '成交時間必須依序，且不可早於下單');
      last = t;
      number(f.price, '成交價');
      assert(Number.isInteger(f.lots) && f.lots > 0, '成交口數應為正整數');
      lots += f.lots; value += f.price * f.lots; wait += (t - ordered) / 1000 * f.lots;
      if (f.fee === null || f.fee === undefined || f.tax === null || f.tax === undefined) costComplete = false;
      else { fee += number(f.fee, '實際手續費', 0); tax += number(f.tax, '實際交易稅', 0); }
    });
    assert(lots <= o.requestedLots, '成交口數不得大於委託口數');
    let priorTime = ordered, maxChase = 0, lastLimit = o.firstLimit;
    (o.revisions || []).forEach(x => {
      const t = timestamp(x.at); number(x.price, '改價');
      assert(t >= priorTime && t <= last, '改價須依時間順序，且在下單至最後成交之間');
      priorTime = t; lastLimit = x.price;
      maxChase = Math.max(maxChase, sign * (x.price - o.firstLimit));
    });
    const arrivalMid = (o.bids[0].price + o.asks[0].price) / 2;
    const vwap = value / lots, arrivalSlippage = sign * (vwap - arrivalMid);
    const sideBook = sign === 1 ? o.asks : o.bids;
    let remaining = lots, executableValue = 0;
    sideBook.forEach(l => {
      const n = Math.min(remaining, l.lots);
      executableValue += l.price * n; remaining -= n;
    });
    const arrivalExecutable = remaining === 0 ? executableValue / lots : null;
    return {...o, product: code, filledLots: lots, averageFill: vwap, arrivalMid,
      finalFillAt: o.fills.at(-1).at, finalFillPrice: o.fills.at(-1).price,
      arrivalExecutable, arrivalSlippage, arrivalCost: arrivalSlippage * mult * lots,
      touchSlippage: arrivalExecutable !== null ? sign * (vwap - arrivalExecutable) : null,
      averageWaitSeconds: wait / lots, firstFillSeconds: (timestamp(o.fills[0].at) - ordered) / 1000,
      lastFillSeconds: (last - ordered) / 1000, chasePoints: sign * (lastLimit - o.firstLimit), maxChasePoints: maxChase,
      fee: costComplete ? fee : null, tax: costComplete ? tax : null, costComplete,
      quoteAgeSeconds: (ordered - bookAt) / 1000,
      // Carry/roll spread cash amount is separate and NEVER added to arrival slippage.
      rollSpreadCash: o.kind === 'roll' ? sign * value * mult : null,
      executionCost: costComplete ? fee + tax + arrivalSlippage * mult * lots : null};
  }
  function executionStats(executions) {
    const orders = executions.map(analyzeExecution);
    const slips = orders.map(o => o.arrivalSlippage);
    const summarize = subset => {
      const a = subset.map(o => o.arrivalSlippage);
      return {count: a.length, mean: mean(a), median: quantile(a, 0.5), p95: quantile(a, 0.95),
        max: a.length ? Math.max(...a) : null,
        averageWaitSeconds: mean(subset.map(o => o.averageWaitSeconds)),
        slippageCost: subset.reduce((s, o) => s + o.arrivalCost, 0)};
    };
    return {...summarize(orders), byKind: {roll: summarize(orders.filter(o => o.kind === 'roll')),
      signal: summarize(orders.filter(o => o.kind === 'signal'))},
      byProduct: Object.fromEntries(Object.keys(MULT).map(k => [k, summarize(orders.filter(o => o.product === k))])),
      fee: orders.every(o => o.costComplete) ? orders.reduce((s, o) => s + o.fee, 0) : null,
      tax: orders.every(o => o.costComplete) ? orders.reduce((s, o) => s + o.tax, 0) : null,
      incompleteCostOrders: orders.filter(o => !o.costComplete).length, sampleUnit: '每筆委託；成交口數加權均價',
      rollExecutionCost: orders.filter(o => o.kind === 'roll').every(o => o.costComplete)
        ? orders.filter(o => o.kind === 'roll').reduce((s, o) => s + o.executionCost, 0) : null};
  }
  function automaticEvents(previous, current) {
    const events = [];
    function add(kind, detail) { events.push({kind, at: current.observedAt, date: current.date, detail}); }
    if (current.valuationValid && current.signal.valid && previous?.signal?.state !== current.signal.state)
      add('signal_change', {from: previous?.signal?.state || null, to: current.signal.state, target: current.signal.target});
    if (current.risk.below500 && !previous?.risk?.below500) add('risk_below500', {ratio: current.risk.ratio, topUp: current.risk.topUp});
    if (current.quality.length && JSON.stringify(current.quality) !== JSON.stringify(previous?.quality))
      add('data_quality', {issues: current.quality});
    return events;
  }
  function transfer(account, amount, at, purpose = 'topup') {
    const a = normalizeAccount(account); timestamp(at); number(amount, '移轉金額');
    assert(amount !== 0, '移轉金額不得為0');
    assert(amount <= a.outside, '場外資金不足');
    if (amount < 0) assert(a.equity + amount >= 0, '轉出後帳戶權益不得小於0');
    const next = {...a, equity: a.equity + amount, outside: a.outside - amount, asof: at};
    if (purpose === 'monthly_cleanup') next.lastCleanupMonth = twDate(at).slice(0, 7);
    return {account: next, event: {kind: purpose === 'monthly_cleanup' ? 'monthly_cleanup' : 'margin_topup',
      date: twDate(at), at, amount, externalFlow: 0, detail: {fromOutside: amount, totalBefore: a.equity + a.outside, totalAfter: next.equity + next.outside}}};
  }
  function forwardSeries(snapshots, events = []) {
    const sorted = snapshots.filter(s => s.date >= START).sort((a, b) => a.date.localeCompare(b.date));
    assert(new Set(sorted.map(s => s.date)).size === sorted.length, '每日快照不得有重複日期');
    let lastActual = null, actualIndex = 1, peak = 1;
    const out = [];
    sorted.forEach(s => {
      const r = {...s, dailyReturn: null, intervalReturn: null, cumulativeReturn: null, drawdown: null,
        theoryEquity: null, theoryReturn: null, theoryCumulativeReturn: null, theoryExposure: null, comparisonGap: null};
      if (s.performanceEligible) {
        if (lastActual && lastActual.totalEquity > 0) {
          const flow = events.filter(e => e.kind === 'external_flow' && e.date > lastActual.date && e.date <= s.date)
            .reduce((sum, e) => sum + number(e.amount, '外部資金流'), 0);
          const change = (s.totalEquity - flow) / lastActual.totalEquity - 1;
          actualIndex *= (1 + change); peak = Math.max(peak, actualIndex);
          r.intervalReturn = change;
          const intervening = out.filter(x => x.date > lastActual.date && x.marketDate > lastActual.marketDate);
          const knownDates = s.input?.market?.target?.map(x => x.date) || [];
          const missingTradingDay = knownDates.some(d => d > lastActual.marketDate && d < s.marketDate &&
            !out.some(x => x.marketDate === d && x.performanceEligible));
          if (!intervening.length && !missingTradingDay) r.dailyReturn = change;
        }
        r.cumulativeReturn = actualIndex - 1;
        r.drawdown = peak > 0 ? 1 - actualIndex / peak : null;
        lastActual = s;
      }
      // Theory must come from a complete futures ledger, never from a spot-index curve.
      if (s.ledger?.status === 'complete') {
        r.theoryEquity = s.ledger.theory.totalEquity;
        r.theoryReturn = s.ledger.theory.dailyReturn;
        r.theoryCumulativeReturn = s.ledger.theory.cumulativeReturn;
        r.theoryExposure = s.ledger.theory.exposure;
        if (s.performanceEligible) r.comparisonGap = s.totalEquity - r.theoryEquity;
      }
      out.push(r);
    });
    return out;
  }
  function monthlyReview(snapshots, executions, events, month) {
    assert(/^\d{4}-(0[1-9]|1[0-2])$/.test(month), '月份格式錯誤');
    const series = forwardSeries(snapshots, events);
    const rows = series.filter(s => s.date.startsWith(month));
    const valid = rows.filter(s => s.performanceEligible);
    const before = series.filter(s => s.date < month + '-01' && s.performanceEligible).at(-1);
    const opening = before || valid[0] || null, end = valid.at(-1) || null;
    const e = events.filter(x => x.date?.startsWith(month));
    const orders = executions.filter(x => x.tradeDate?.startsWith(month) && x.tradeDate >= START);
    const stats = executionStats(orders), states = {'0.5': 0, '1': 0, '1.5': 0, '2': 0};
    rows.filter(s => s.valuationValid && s.signal.valid).forEach(s => { states[String(s.signal.target)]++; });
    const risks = rows.map(s => s.risk.ratio).filter(finite);
    const deviations = rows.filter(s => s.valuationValid && s.signal.valid && finite(s.actualExposure)).map(s => Math.abs(s.actualExposure - s.signal.target));
    const performanceRows = opening ? series.filter(s => s.date >= opening.date && s.date <= (end?.date || '') && s.performanceEligible) : [];
    let index = 1, peak = 1, mdd = 0;
    performanceRows.slice(1).forEach(s => {
      if (s.intervalReturn !== null) { index *= 1 + s.intervalReturn; peak = Math.max(peak, index); mdd = Math.max(mdd, 1 - index / peak); }
    });
    const violations = rows.flatMap(s => {
      const v = [];
      if (s.risk.below500) v.push({date: s.date, rule: 'snapshot_below500', detail: '觀測時低於500%，需核對後續補款'});
      if (s.valuationValid && s.decision.rebalanceRequired) v.push({date: s.date, rule: 'pending_rebalance', detail: '調倉尚待核對'});
      if (s.decision.rollDue) v.push({date: s.date, rule: 'pending_roll', detail: '換倉日已到，需核對成交'});
      return v;
    });
    const theoreticalReturn = performanceRows.length >= 2 && finite(opening?.theoryCumulativeReturn) && finite(end?.theoryCumulativeReturn)
      && opening.theoryCumulativeReturn > -1 ? (1 + end.theoryCumulativeReturn) / (1 + opening.theoryCumulativeReturn) - 1 : null;
    return {schemaVersion: 1, month, coverageStart: opening?.date || null, coverageEnd: end?.date || null,
      partialMonth: !before, snapshotDays: rows.length, actualDays: valid.length, estimatedDays: rows.length - valid.length,
      openingEquity: opening?.totalEquity ?? null, endingEquity: end?.totalEquity ?? null,
      monthlyReturn: performanceRows.length >= 2 ? index - 1 : null,
      theoreticalReturn, returnGap: theoreticalReturn !== null ? index - 1 - theoreticalReturn : null,
      maxDrawdown: performanceRows.length >= 2 ? mdd : null,
      lowestRisk: risks.length ? Math.min(...risks) : null, exposureDays: states,
      meanExposureDeviation: mean(deviations), maxExposureDeviation: deviations.length ? Math.max(...deviations) : null,
      rebalanceCount: orders.filter(o => o.kind === 'signal').length, rollCount: orders.filter(o => o.kind === 'roll').length,
      topUpCount: e.filter(x => x.kind === 'margin_topup' && x.amount > 0).length,
      execution: stats, comparisonGap: end?.comparisonGap ?? null, theoreticalEquity: end?.theoryEquity ?? null,
      exceptions: e.filter(x => ['data_quality', 'risk_below500', 'abnormal_slippage', 'rule_violation'].includes(x.kind)),
      potentialViolations: violations, reviewCycle: '營運每月；核心策略每3–6個月',
      theoryLabel: '完整逐合約期貨帳本；缺少成交／期貨價格時不建立理論淨值'};
  }
  return Object.freeze({VERSION, START, CAPITAL, MULT, finite, clone, number, date, timestamp, twDate, product, mean, strategyEquity,
    quantile, indicators, classify, signal, normalizeAccount, risk, stress, decision, buildSnapshot,
    analyzeExecution, executionStats, automaticEvents, transfer, forwardSeries, monthlyReview});
});
