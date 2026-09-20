(function (root, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./defense-core.js'), require('./defense-governance.js'));
  else root.DefenseLedger = factory(root.DefenseCore, root.DefenseGovernance);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C, G) {
  'use strict';
  const VERSION = 'futures-ledger-v3-v127-margin-aware';
  const key = p => C.product(p.product) + ':' + p.month;
  const sum = a => a.reduce((s, v) => s + v, 0);
  function check(ok, text) { if (!ok) throw new Error(text); }
  function month(x) { check(/^\d{4}-(0[1-9]|1[0-2])$/.test(x), '合約月份無效'); return x; }
  function positive(x, label) { return C.number(x, label, Number.MIN_VALUE); }
  function source(x) { check(typeof x === 'string' && x.trim().length > 0, '期貨價格須有來源說明'); return x.trim(); }
  function normalizeSeed(raw) {
    const s = C.clone(raw);
    C.timestamp(s.at); check(C.twDate(s.at) >= C.START, '帳本起始不可早於Forward起算日');
    C.number(s.equity, '期初期貨權益'); C.number(s.outside, '期初場外資金', 0);
    check(s.equity + s.outside > 0, '期初總權益須大於0');
    check(Array.isArray(s.positions), '期初持倉不存在');
    s.positions = s.positions.map(p => {
      check(Number.isInteger(p.lots), '期初口數必須是整數');
      positive(p.mark, '期初每口期貨估值價');
      return {product: C.product(p.product), month: month(p.month), lots: p.lots, mark: p.mark};
    }).filter(p => p.lots !== 0);
    check(new Set(s.positions.map(key)).size === s.positions.length, '期初合約不可重複');
    s.source = source(s.source);
    check(s.fees && Object.keys(C.MULT).every(p => C.finite(s.fees[p]) && s.fees[p] >= 0), '請設定TX／MTX／TMF單邊理論手續費');
    C.number(s.taxRate, '理論交易稅率', 0); check(s.taxRate <= 0.01, '稅率請輸入小數，例0.00002');
    return {...s, schemaVersion: 1, formulaVersion: VERSION, capitalBase: C.CAPITAL};
  }
  function validateDay(raw, seed) {
    const d = C.clone(raw); C.date(d.date); month(d.targetMonth);
    const signalAt = C.timestamp(d.signalAt), referenceAt = C.timestamp(d.referenceAt), valuationAt = C.timestamp(d.valuationAt);
    G.validateDecisionWindow({date: d.date, signalAt: d.signalAt, referenceAt: d.referenceAt, valuationAt: d.valuationAt});
    check(C.twDate(d.signalAt) === d.date && C.twDate(d.valuationAt) === d.date, '訊號／估值時間須屬於帳本當日');
    if (d.previousTradingDate) { C.date(d.previousTradingDate); check(d.previousTradingDate < d.date, '前交易日必須早於當日'); }
    check(referenceAt >= signalAt && valuationAt >= referenceAt, '理論成交必須在訊號確認之後，且不得晚於日終估值');
    check(C.twDate(d.signalAt) >= C.START && signalAt >= C.timestamp(seed.at), '帳本日期不可早於期初');
    check(d.signalDate === d.date, '0050訊號日期與帳本不一致');
    d.signal = C.classify(d.indicators);
    check(Array.isArray(d.quotes) && d.quotes.length > 0, '缺少逐合約期貨行情，禁止使用指數代替');
    d.quotes = d.quotes.map(q => {
      positive(q.mark, '期貨日終估值價');
      C.number(q.initialMargin, '每口原始保證金', 0); C.number(q.maintenanceMargin, '每口維持保證金', 0);
      check(q.initialMargin >= q.maintenanceMargin, '每口保證金次序錯誤');
      if (q.bid != null || q.ask != null) {
        positive(q.bid, '期貨委買'); positive(q.ask, '期貨委賣'); check(q.bid <= q.ask, '期貨買賣報價顛倒');
      }
      const value = {...q, product: C.product(q.product), month: month(q.month), source: source(q.source)};
      if (q.margin) value.margin = G.validateMarginRecord(q.margin, d.valuationAt);
      else value.margin = {freshness: 'unknown', fresh: false, reasons: ['missing-margin-provenance']};
      return value;
    });
    check(new Set(d.quotes.map(key)).size === d.quotes.length, '每日逐合約行情不可重複');
    C.number(d.externalFlow || 0, '外部淨入金'); C.number(d.actualTransfer || 0, '實際帳戶間移轉');
    if (d.transferableOutsideCash != null) C.number(d.transferableOutsideCash, '可立即轉入場外資金', 0);
    return d;
  }
  function quoteMap(day) { return new Map(day.quotes.map(q => [key(q), q])); }
  function quote(qm, p) { const q = qm.get(key(p)); check(q, '缺少期貨合約行情：' + key(p)); return q; }
  function executable(q, signedLots) {
    const price = signedLots > 0 ? q.ask : q.bid;
    positive(price, '缺少期貨可成交參考價：' + key(q)); return price;
  }
  function exposure(positions, qm, strategyEquity, reference = false) {
    positive(strategyEquity, '動態總策略權益');
    return sum(positions.map(p => { const q = quote(qm, p); const price = reference ? (positive(q.bid, '委買') + positive(q.ask, '委賣')) / 2 : q.mark;
      return p.lots * C.MULT[p.product] * price; })) / strategyEquity;
  }
  function selectHoldings(target, quotes, targetMonth, strategyEquity, funding = {}) {
    check([0.5, 1, 1.5, 2].includes(target), '目標曝險不是固定四級');
    const unavailable = allocationStatus => ({positions: [], notional: null, exposure: null,
      exposureError: null, strategyEquity: C.finite(strategyEquity) ? strategyEquity : null,
      targetNotional: C.finite(strategyEquity) ? target * strategyEquity : null,
      allocationStatus, executionReady: false, requiredInitialMargin: null,
      requiredMaintenanceMargin: null, required500Equity: null, required550Equity: null,
      requiredInternalTopUp: null, safeCandidateCount: 0, withinBandCandidateCount: 0,
      policy: allocationStatus === 'infeasible' ? '動態總策略權益不大於0，不產生目標口數。'
        : '必要逐合約估值或保證金資料不可用，不產生目標口數。'});
    if (!C.finite(strategyEquity)) return unavailable('valuation-unavailable');
    if (strategyEquity <= 0) return unavailable('infeasible');
    if (!Array.isArray(quotes) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonth)) return unavailable('valuation-unavailable');
    const qs = Object.keys(C.MULT).map(p => quotes.find(q => q.product === p && q.month === targetMonth));
    if (!qs.every(Boolean) || qs.some(q => q.stale === true || !C.finite(q.ask) || q.ask <= 0 ||
      !C.finite(q.initialMargin) || q.initialMargin <= 0 || !C.finite(q.maintenanceMargin) ||
      q.maintenanceMargin <= 0 || q.initialMargin < q.maintenanceMargin)) return unavailable('valuation-unavailable');
    const notionals = qs.map(q => C.MULT[q.product] * executable(q, 1));
    const targetValue = target * strategyEquity;
    const bounds = qs.map(q => Math.floor(strategyEquity / (5.5 * q.initialMargin)));
    check(bounds[0] * bounds[1] * bounds[2] < 1000000, '報價異常，配口範圍過大');
    let best = null, safeCount = 0, withinBandCount = 0;
    for (let tx = 0; tx <= bounds[0]; tx++) for (let mtx = 0; mtx <= bounds[1]; mtx++) {
      for (let tmf = 0; tmf <= bounds[2]; tmf++) {
        const counts = [tx, mtx, tmf], value = sum(counts.map((n, i) => n * notionals[i]));
        if (!sum(counts)) continue;
        const initialMargin = sum(counts.map((n, i) => n * qs[i].initialMargin));
        const maintenanceMargin = sum(counts.map((n, i) => n * qs[i].maintenanceMargin));
        const required550Equity = 5.5 * initialMargin;
        if (required550Equity > strategyEquity + 1e-9) continue;
        const exposure = value / strategyEquity, error = exposure - target;
        safeCount++; if (Math.abs(error) <= 0.05 + 1e-12) withinBandCount++;
        const rank = [Math.abs(error), exposure > target ? 1 : 0, sum(counts), -tx, -mtx];
        const better = !best || rank.some((x, i) => x < best.rank[i] - 1e-8 && rank.slice(0, i).every((a, j) => Math.abs(a - best.rank[j]) < 1e-8));
        if (better) best = {rank, counts, value, exposure, error, initialMargin, maintenanceMargin, required550Equity};
      }
    }
    if (!best) return {positions: [], notional: null, exposure: null, exposureError: null, strategyEquity,
      targetNotional: targetValue, allocationStatus: 'margin-limited', executionReady: false,
      requiredInitialMargin: null, requiredMaintenanceMargin: null, required500Equity: null, required550Equity: null,
      requiredInternalTopUp: null, safeCandidateCount: 0, withinBandCandidateCount: 0,
      policy: '550%安全門檻內無任何非零整數組合；不產生目標口數。'};
    const futuresEquity = funding.decisionTimeFuturesEquity;
    const availableOutside = funding.transferableOutsideCash ?? funding.outsideCash;
    const requiredInternalTopUp = C.finite(futuresEquity) ? Math.max(0, best.required550Equity - futuresEquity) : null;
    const marginFresh = qs.every(q => q.margin?.fresh === true);
    const executionReady = marginFresh && requiredInternalTopUp !== null && C.finite(availableOutside) && availableOutside >= requiredInternalTopUp;
    return {positions: best.counts.map((lots, i) => ({product: qs[i].product, month: targetMonth, lots})).filter(p => p.lots),
      notional: best.value, exposure: best.exposure, exposureError: best.error,
      strategyEquity, targetNotional: targetValue,
      allocationStatus: withinBandCount ? 'within-band' : 'granularity-limited',
      requiredInitialMargin: best.initialMargin, requiredMaintenanceMargin: best.maintenanceMargin,
      required500Equity: 5 * best.initialMargin, required550Equity: best.required550Equity,
      requiredInternalTopUp, executionReady,
      marginFresh,
      safeCandidateCount: safeCount, withinBandCandidateCount: withinBandCount,
      policy: 'v1.27：先550%安全過濾；再依絕對曝險誤差、不超標、總口數、TX→MTX→TMF固定順序排名。'};
  }
  function decisionValuation(previous, day, qm) {
    const outside = previous.outside + (day.externalFlow || 0);
    check(outside >= 0, '外部提領超過場外資金');
    const carryMtm = sum(previous.positions.map(p => {
      const q = quote(qm, p), mid = (positive(q.bid, '委買') + positive(q.ask, '委賣')) / 2;
      return p.lots * C.MULT[p.product] * (mid - p.mark);
    }));
    const futuresEquity = previous.equity + carryMtm;
    const total = futuresEquity + outside;
    positive(total, '決策時動態總策略權益');
    return {futuresEquity, outside, strategyEquity: total, carryMtm,
      timing: 'previous positions MTM at reference quote, before current trades/fees/internal transfer'};
  }
  function theoreticalTrades(previous, day, seed) {
    const qm = quoteMap(day), valuation = decisionValuation(previous, day, qm);
    const currentExposure = exposure(previous.positions, qm, valuation.strategyEquity, true);
    const availableOutside = day.transferableOutsideCash ?? valuation.outside;
    const best = selectHoldings(day.signal.target, day.quotes, day.targetMonth, valuation.strategyEquity,
      {decisionTimeFuturesEquity: valuation.futuresEquity, outsideCash: valuation.outside, transferableOutsideCash: availableOutside});
    const baseDecision = C.decision(day.signal, currentExposure, previous.lastAppliedState, Boolean(day.roll));
    const normalized = positions => positions.filter(p => p.lots).map(p => [p.product, p.month, p.lots]).sort();
    const sameAsBest = best.positions.length > 0 && JSON.stringify(normalized(previous.positions)) === JSON.stringify(normalized(best.positions));
    const currentInitialMargin = previous.positions.every(p => p.lots >= 0 && qm.has(key(p)))
      ? sum(previous.positions.map(p => p.lots * quote(qm, p).initialMargin)) : Infinity;
    const currentSafe = 5.5 * currentInitialMargin <= valuation.strategyEquity + 1e-9;
    const selectable = ['within-band', 'granularity-limited'].includes(best.allocationStatus);
    const forced = Boolean(day.roll || baseDecision.signalChanged || !currentSafe);
    const tradeRequired = selectable && !sameAsBest && (forced || baseDecision.insideBand === false);
    const blocked = tradeRequired && !best.executionReady;
    const actionState = !selectable ? best.allocationStatus : blocked ? 'execution-blocked'
      : tradeRequired ? 'rebalance-to-best-feasible'
      : sameAsBest && best.allocationStatus === 'granularity-limited' ? 'best-feasible / granularity-limited / no-trade'
      : 'within-band / no-trade';
    const decision = {...baseDecision, tradeRequired: blocked ? false : tradeRequired, rebalanceRequired: tradeRequired,
      allocationStatus: best.allocationStatus, sameAsBest, currentSafe, actionState,
      executionReady: best.executionReady, blockedReason: tradeRequired && !best.executionReady ? 'outside-cash-unavailable' : null};
    const selection = blocked ? {...best, positions: previous.positions.map(p => ({product: p.product, month: p.month, lots: p.lots})),
        policy: 'execution blocked: margin provenance or immediately transferable outside cash unavailable'}
      : tradeRequired ? best
      : {positions: previous.positions.map(p => ({product: p.product, month: p.month, lots: p.lots})), exposure: currentExposure,
        exposureError: currentExposure - day.signal.target, strategyEquity: valuation.strategyEquity,
        targetNotional: valuation.strategyEquity * day.signal.target, allocationStatus: best.allocationStatus,
        requiredInitialMargin: best.requiredInitialMargin, requiredMaintenanceMargin: best.requiredMaintenanceMargin,
        required500Equity: best.required500Equity, required550Equity: best.required550Equity,
        requiredInternalTopUp: best.requiredInternalTopUp,
        executionReady: best.executionReady, safeCandidateCount: best.safeCandidateCount,
        withinBandCandidateCount: best.withinBandCandidateCount,
        policy: actionState};
    if (!day.roll) check(previous.positions.every(p => p.month === day.targetMonth), '合約月份改變必須明確指定換倉');
    const deltas = new Map(previous.positions.map(p => [key(p), {...p, lots: -p.lots}]));
    for (const p of selection.positions) deltas.set(key(p), {...p, lots: (deltas.get(key(p))?.lots || 0) + p.lots});
    const trades = [], rollGroups = [];
    function add(p, lots, price, kind, slippageCost, groupId = null) {
      if (!lots) return;
      positive(price, '理論成交價'); const mult = C.MULT[p.product];
      trades.push({id: day.date + '-theory-' + trades.length, product: p.product, month: p.month, signedLots: lots,
        at: day.referenceAt, price, kind, groupId, fee: Math.abs(lots) * seed.fees[p.product],
        tax: Math.abs(lots) * price * mult * seed.taxRate, slippageCost,
        priceSource: quote(qm, p).source});
    }
    if (day.roll) for (const p of [...deltas.values()].filter(p => p.lots < 0 && p.month !== day.targetMonth)) {
      const far = deltas.get(p.product + ':' + day.targetMonth), n = Math.min(-p.lots, far?.lots || 0);
      if (!n) continue;
      const spread = (day.spreads || []).find(s => s.product === p.product && s.nearMonth === p.month && s.farMonth === day.targetMonth);
      check(spread, '換倉理論成交需要跨月價差報價：' + p.product);
      C.number(spread.bid, '價差委買'); C.number(spread.ask, '價差委賣'); positive(spread.nearReference, '價差近月分腿參考價');
      check(spread.bid <= spread.ask, '價差五檔方向錯誤'); source(spread.source);
      const groupId = day.date + '-roll-' + p.product + '-' + p.month;
      const slip = (spread.ask - (spread.bid + spread.ask) / 2) * n * C.MULT[p.product];
      add(p, -n, spread.nearReference, 'roll', 0, groupId);
      add(far, n, spread.nearReference + spread.ask, 'roll', slip, groupId);
      rollGroups.push({groupId, product: p.product, lots: n, spread: spread.ask, arrivalMid: (spread.bid + spread.ask) / 2,
        slippageCost: slip, source: spread.source});
      p.lots += n; far.lots -= n;
    }
    for (const p of deltas.values()) if (p.lots) {
      const q = quote(qm, p), price = executable(q, p.lots);
      add(p, p.lots, price, 'signal', (price - (q.bid + q.ask) / 2) * p.lots * C.MULT[p.product]);
    }
    return {trades, decision, selection, rollGroups, valuation};
  }
  function actualTradesFromExecutions(orders, date) {
    const trades = [];
    orders.filter(o => o.tradeDate === date).forEach(raw => {
      const o = C.analyzeExecution(raw), sign = o.side === 'buy' ? 1 : -1;
      check(o.costComplete, '成交費稅不完整：' + o.id);
      o.fills.forEach((f, i) => {
        const common = {at: f.at, kind: o.kind, executionId: o.id, groupId: o.kind === 'roll' ? o.id + '-' + i : null,
          priceSource: '使用者成交紀錄', slippageCost: (f.price - o.arrivalMid) * sign * f.lots * C.MULT[o.product]};
        if (o.kind === 'roll') {
          positive(f.nearPrice, '換倉須補近月實際分腿成交價'); positive(f.farPrice, '換倉須補遠月實際分腿成交價');
          check(Math.abs(f.farPrice - f.nearPrice - f.price) < 1e-7, '近遠月分腿價與成交價差不符');
          trades.push({...common, id: o.id + '-' + i + '-near', product: o.product, month: o.nearMonth,
            signedLots: -sign * f.lots, price: f.nearPrice, fee: f.fee, tax: f.tax, slippageCost: 0});
          trades.push({...common, id: o.id + '-' + i + '-far', product: o.product, month: o.farMonth,
            signedLots: sign * f.lots, price: f.farPrice, fee: 0, tax: 0});
        } else trades.push({...common, id: o.id + '-' + i, product: o.product, month: o.nearMonth,
          signedLots: sign * f.lots, price: f.price, fee: f.fee, tax: f.tax});
      });
    });
    return trades.sort((a, b) => C.timestamp(a.at) - C.timestamp(b.at));
  }
  function markBook(previous, day, trades, theoretical) {
    const qm = quoteMap(day), positionMap = new Map(previous.positions.map(p => [key(p), {...p}]));
    let carryPnl = 0, tradePnl = 0;
    const contractPnl = new Map();
    const addPnl = (p, amount) => contractPnl.set(key(p), (contractPnl.get(key(p)) || 0) + amount);
    previous.positions.forEach(p => { const pnl = p.lots * C.MULT[p.product] * (quote(qm, p).mark - p.mark); carryPnl += pnl; addPnl(p, pnl); });
    const seen = new Set();
    trades.forEach(t => {
      check(!seen.has(t.id), '成交明細ID重複'); seen.add(t.id);
      check(Number.isInteger(t.signedLots) && t.signedLots !== 0, '成交口數必須為非零整數');
      positive(t.price, '成交價'); C.number(t.fee, '手續費', 0); C.number(t.tax, '交易稅', 0);
      const time = C.timestamp(t.at);
      check(time > C.timestamp(previous.at) && time <= C.timestamp(day.valuationAt), '成交不在前次估值至本次日終的期間內');
      if (theoretical) check(time >= C.timestamp(day.signalAt), '不得使用訊號確認前的理論成交');
      const p = {product: C.product(t.product), month: month(t.month)}, q = quote(qm, p);
      const pnl = t.signedLots * C.MULT[p.product] * (q.mark - t.price); tradePnl += pnl; addPnl(p, pnl);
      const existing = positionMap.get(key(p));
      positionMap.set(key(p), {...p, lots: (existing?.lots || 0) + t.signedLots, mark: q.mark});
    });
    const positions = [...positionMap.values()].filter(p => p.lots !== 0).map(p => ({...p, mark: quote(qm, p).mark}));
    const fee = sum(trades.map(t => t.fee)), tax = sum(trades.map(t => t.tax)), mtmPnl = carryPnl + tradePnl;
    const initialMargin = sum(positions.map(p => Math.abs(p.lots) * quote(qm, p).initialMargin));
    const maintenanceMargin = sum(positions.map(p => Math.abs(p.lots) * quote(qm, p).maintenanceMargin));
    if (positions.length) check(initialMargin > 0 && maintenanceMargin > 0, '持倉保證金不可缺漏');
    let equity = previous.equity + mtmPnl - fee - tax, outside = previous.outside + (day.externalFlow || 0);
    check(outside >= 0, '外部提領超過場外資金');
    const preTransferRisk = C.risk(equity, outside, initialMargin, maintenanceMargin);
    let transfer = day.actualTransfer || 0;
    const monthlyCleanup = Boolean(day.monthlyCleanup || C.twDate(previous.at).slice(0, 7) !== day.date.slice(0, 7));
    if (theoretical) {
      check(!monthlyCleanup || previous.lastCleanupMonth !== day.date.slice(0, 7), '同月份已完成資金整理，不得重複執行');
      const wanted = monthlyCleanup ? preTransferRisk.monthlyTransfer : preTransferRisk.topUp;
      transfer = wanted > 0 ? Math.min(wanted, outside) : Math.max(wanted, -Math.max(equity, 0));
    }
    check(transfer <= outside, '帳本場外補款不足');
    if (transfer < 0) check(equity + transfer >= 0, '帳本轉出超過期貨權益');
    equity += transfer; outside -= transfer;
    const totalEquity = equity + outside, beforeTotal = previous.equity + previous.outside;
    return {at: day.valuationAt, positions, equity, outside, totalEquity, initialMargin, maintenanceMargin,
      carryPnl, tradePnl, mtmPnl, fee, tax, netPnl: mtmPnl - fee - tax,
      dailyReturn: beforeTotal > 0 ? (totalEquity - (day.externalFlow || 0)) / beforeTotal - 1 : null,
      slippageCost: sum(trades.map(t => t.slippageCost || 0)), transfer, externalFlow: day.externalFlow || 0,
      preTransferRisk, risk: C.risk(equity, outside, initialMargin, maintenanceMargin), monthlyCleanup,
      lastCleanupMonth: monthlyCleanup ? day.date.slice(0, 7) : previous.lastCleanupMonth || null,
      exposure: totalEquity > 0 ? exposure(positions, qm, totalEquity) : null,
      allocationStatus: totalEquity > 0 ? 'ready' : 'valuation-unavailable',
      trades, contractPnl: Object.fromEntries(contractPnl),
      lastAppliedState: theoretical ? day.signal.state : null,
      source: theoretical ? 'futures-theory' : 'actual-fills-and-futures-marks'};
  }
  function buildLedger(rawSeed, rawDays, orders = []) {
    if (!rawSeed) return {version: VERSION, rows: [], status: 'setup_required'};
    const seed = normalizeSeed(rawSeed), days = [...rawDays].sort((a, b) => a.date.localeCompare(b.date));
    check(new Set(days.map(d => d.date)).size === days.length, '帳本每日輸入不得重複');
    let theory = C.clone(seed), actual = C.clone(seed), halted = false, actualIndex = 1, theoryIndex = 1, peakA = 1, peakT = 1;
    const rows = [];
    for (const raw of days) {
      if (halted) { rows.push({date: raw.date, status: 'blocked_by_previous_day', error: '前日帳本缺資料，不能跳過損益續算'}); continue; }
      try {
        const d = validateDay(raw, seed);
        check(C.twDate(theory.at) === d.date || d.previousTradingDate === C.twDate(theory.at), '缺少前交易日帳本或previousTradingDate，禁止跨日缺口續算');
        check(C.timestamp(d.valuationAt) > C.timestamp(theory.at), '日終估值時間須遞增');
        check(d.actualComplete === true, '請核對當日實際成交完整性（無成交也需確認）');
        const plan = theoreticalTrades(theory, d, seed), actualTrades = actualTradesFromExecutions(orders, d.date);
        const nextTheory = markBook(theory, d, plan.trades, true), nextActual = markBook(actual, d, actualTrades, false);
        const reconciliation = {equityGap: C.finite(d.brokerEquity) ? d.brokerEquity - nextActual.equity : null,
          outsideGap: C.finite(d.brokerOutside) ? d.brokerOutside - nextActual.outside : null};
        if (d.brokerPositions) {
          const normalize = a => JSON.stringify(a.filter(p => p.lots).map(p => [key(p), p.lots]).sort());
          reconciliation.positionsMatch = normalize(d.brokerPositions) === normalize(nextActual.positions);
        }
        const reconciled = reconciliation.equityGap !== null && Math.abs(reconciliation.equityGap) < 0.011 &&
          reconciliation.outsideGap !== null && Math.abs(reconciliation.outsideGap) < 0.011 && reconciliation.positionsMatch !== false;
        actualIndex *= 1 + (nextActual.dailyReturn || 0); theoryIndex *= 1 + (nextTheory.dailyReturn || 0);
        peakA = Math.max(peakA, actualIndex); peakT = Math.max(peakT, theoryIndex);
        Object.assign(nextActual, {cumulativeReturn: actualIndex - 1, drawdown: 1 - actualIndex / peakA, reconciled, reconciliation});
        Object.assign(nextTheory, {cumulativeReturn: theoryIndex - 1, drawdown: 1 - theoryIndex / peakT});
        rows.push({date: d.date, at: d.valuationAt, signalAt: d.signalAt, referenceAt: d.referenceAt,
          status: 'complete', formulaVersion: VERSION, signal: d.signal, targetExposure: d.signal.target,
          theoreticalLots: plan.selection.positions, actualLots: nextActual.positions,
          allocationPolicy: plan.selection.policy, decision: plan.decision, rollGroups: plan.rollGroups,
          decisionStrategyEquity: plan.valuation.strategyEquity,
          decisionFuturesEquity: plan.valuation.futuresEquity, decisionOutsideCash: plan.valuation.outside,
          targetNotional: plan.selection.targetNotional,
          allocationStatus: plan.selection.allocationStatus, executionReady: plan.selection.executionReady,
          requiredInitialMargin: plan.selection.requiredInitialMargin,
          requiredMaintenanceMargin: plan.selection.requiredMaintenanceMargin,
          required500Equity: plan.selection.required500Equity,
          required550Equity: plan.selection.required550Equity,
          requiredInternalTopUp: plan.selection.requiredInternalTopUp,
          theory: nextTheory, actual: nextActual, gap: nextActual.totalEquity - nextTheory.totalEquity,
          returnGap: nextActual.cumulativeReturn - nextTheory.cumulativeReturn,
          priceSources: d.quotes.map(q => ({contract: key(q), source: q.source})),
          costPolicy: '理論費依設定、稅按逐腿名目金額精算；實際費稅依成交原始紀錄。滑價已反映成交價，不再扣一次。'});
        theory = nextTheory; actual = nextActual;
      } catch (error) { rows.push({date: raw.date, status: 'incomplete', error: error.message}); halted = true; }
    }
    return {version: VERSION, rows, status: halted ? 'incomplete' : 'complete', seed};
  }
  function monthlyReview(ledger, orders, events, month, snapshots = []) {
    const base = C.monthlyReview(snapshots, orders, events, month);
    const all = ledger.rows.filter(r => r.status === 'complete');
    const rows = all.filter(r => r.date.startsWith(month));
    if (!rows.length) return base;
    const first = rows[0], last = rows.at(-1), prior = all.filter(r => r.date < first.date).at(-1);
    const opening = prior?.actual || ledger.seed;
    let ai = 1, ti = 1, peak = 1, mdd = 0;
    rows.forEach(r => { ai *= 1 + r.actual.dailyReturn; ti *= 1 + r.theory.dailyReturn;
      peak = Math.max(peak, ai); mdd = Math.max(mdd, 1 - ai / peak); });
    const deviations = rows.map(r => Math.abs(r.actual.exposure - r.targetExposure));
    const risks = rows.flatMap(r => [r.actual.preTransferRisk.ratio, r.actual.risk.ratio]).filter(C.finite);
    const exposureDays = {'0.5': 0, '1': 0, '1.5': 0, '2': 0};
    rows.forEach(r => exposureDays[String(r.targetExposure)]++);
    return {...base, source: 'dual-futures-ledger', coverageStart: first.date, coverageEnd: last.date,
      partialMonth: !prior, openingEquity: opening.equity + opening.outside, endingEquity: last.actual.totalEquity,
      monthlyReturn: ai - 1, theoreticalReturn: ti - 1, returnGap: ai - ti, maxDrawdown: mdd,
      actualDays: rows.filter(r => r.actual.reconciled).length, estimatedDays: rows.filter(r => !r.actual.reconciled).length,
      lowestRisk: risks.length ? Math.min(...risks) : null, exposureDays,
      meanExposureDeviation: C.mean(deviations), maxExposureDeviation: Math.max(...deviations),
      topUpCount: rows.filter(r => r.actual.transfer > 0).length,
      theoreticalEquity: last.theory.totalEquity, comparisonGap: last.gap,
      potentialViolations: [...base.potentialViolations, ...rows.flatMap(r => {
        const warnings = [];
        if (r.actual.risk.below500) warnings.push({date: r.date, detail: '日終實際帳本低於500%，需核對補款'});
        if (Math.abs(r.actual.exposure - r.theory.exposure) > 0.05) warnings.push({date: r.date, detail: '實際與理論曝險差超過0.05x，需核對成交'});
        return warnings;
      })], reviewCycle: base.reviewCycle + '；未券商對帳者為待核對MTM，非已驗證實績'};
  }
  return Object.freeze({VERSION, key, normalizeSeed, validateDay, exposure, selectHoldings, decisionValuation,
    theoreticalTrades, actualTradesFromExecutions, markBook, buildLedger, monthlyReview});
});
