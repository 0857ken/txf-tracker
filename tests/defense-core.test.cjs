'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../defense-core.js'), F = require('./defense-fixtures.cjs');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, a + ' != ' + b);
test('80 real trading rows: MA60 twenty TRADING days ago; no calendar lag or premature rounding', () => {
  const m = F.market(), v = C.indicators(m.target);
  close(v.ma60Lag20, m.target.slice(0, 60).reduce((s, r) => s + r.close, 0) / 60);
  close(v.ma60, m.target.slice(-60).reduce((s, r) => s + r.close, 0) / 60);
  assert.equal(C.signal(m.target.slice(1)).valid, false);
  assert.throws(() => C.signal([...m.target, m.target.at(-1)]), /重複/);
  m.target[2].close = null; assert.throws(() => C.signal(m.target), /數值/);
});
test('all fixed regimes, strict MA60 comparisons and MA10 equality', () => {
  const v = {close: 80, ma10: 85, ma20: 90, ma60: 100, ma60Lag20: 110};
  assert.equal(C.classify(v).target, 0.5);
  assert.equal(C.classify({...v, close: 85}).target, 0.5);
  assert.equal(C.classify({...v, close: 88}).target, 1);
  assert.equal(C.classify({...v, close: 95}).target, 1.5);
  assert.equal(C.classify({...v, close: 100}).target, 2);
  assert.equal(C.classify({...v, ma60Lag20: 100}).target, 2);
  assert.equal(C.classify({...v, close: 90}).target, 1.5);
  assert.equal(C.classify({...v, close: 95, ma10: 96, ma20: 90}).target, 1.5);
});
test('band is inclusive; signal changes and rollover override it; pending state persists across days', () => {
  const s = C.classify({close: 100, ma10: 90, ma20: 95, ma60: 99, ma60Lag20: 110});
  assert.equal(C.decision(s, 1.95, s.state, false).tradeRequired, false);
  assert.equal(C.decision(s, 2.05, s.state, false).tradeRequired, false);
  assert.equal(C.decision(s, 1.949, s.state, false).tradeRequired, true);
  assert.equal(C.decision(s, 2, 'bear:1.5', false).tradeRequired, true);
  assert.equal(C.decision(s, 2, s.state, true).tradeRequired, true);
  assert.equal(C.decision(s, 2, null, false).tradeRequired, true);
});
test('500 is not below 500; restore to 550; whole-dollar funding ceiling; finite reserves', () => {
  assert.equal(C.risk(500000, 1000000, 100000, 75000).topUp, 0);
  const r = C.risk(499999.9, 30000, 100000, 75000);
  assert.equal(r.topUp, 50001); assert.equal(r.availableTransfer, 30000); assert.equal(r.fundingShortfall, 20001);
  close(r.equityAfterTransfer + r.outsideAfterTransfer, 529999.9);
  assert.equal(C.risk(550000, 0, 100000, 75000).approaching, false);
  assert.equal(C.risk(500000, 0, 100000, 75000).approaching, true);
});
test('fixed holdings crash by 10%: independent hand calculation for all multipliers and negative equity', () => {
  const r = C.stress(20000, F.account())[1];
  assert.equal(r.scenarioIndex, 18000); assert.equal(r.pointChange, -2000);
  assert.deepEqual(r.pnl, {TX: -400000, MTX: -200000, TMF: -60000});
  assert.equal(r.totalPnl, -660000); assert.equal(r.equity, -110000);
  assert.equal(r.total, 1340000); assert.equal(r.outside, 1450000); assert.equal(r.drawdownPct, 33);
  close(r.ratio, -110); assert.equal(r.topUp, 660000);
  assert.equal(r.equityAfterTransfer, 550000); assert.equal(r.outsideAfterTransfer, 790000);
  assert.equal(r.equityAfterTransfer + r.outsideAfterTransfer, r.total);
  assert.equal(r.belowMaintenance, true);
});
test('all four stress levels scale current lots, not post-crash target exposure; no asset notional double-count', () => {
  const a = F.account(), stress = C.stress(20000, a);
  assert.deepEqual(stress.map(r => r.change), [-0.05, -0.1, -0.15, -0.2]);
  stress.forEach(r => close(r.totalPnl, 20000 * r.change * 330));
  assert.equal(stress[3].total, 680000);
  const x = C.buildSnapshot(F.market(), a, '2026-09-16T06:01:00Z');
  assert.equal(x.actualExposure, 3.3); assert.equal(x.totalEquity, 2000000);
  const richer = C.buildSnapshot(F.market(), {...a, outside: 9450000}, '2026-09-16T06:01:00Z');
  assert.equal(richer.actualExposure, 3.3);
});
test('unknown symbols, blank/bad margins, fractional lots fail closed; zero positions have N/A risk', () => {
  assert.throws(() => C.normalizeAccount({...F.account(), positions: [{product: 'bad', lots: 1, month: '2026-09'}]}), /未知/);
  assert.throws(() => C.normalizeAccount({...F.account(), initialMargin: 0}), /保證金/);
  assert.throws(() => C.normalizeAccount({...F.account(), positions: [{product: 'TX', lots: 1.5, month: '2026-09'}]}), /整數/);
  const a = {...F.account(), positions: [], initialMargin: 0, maintenanceMargin: 0};
  C.stress(20000, a).forEach(r => { assert.equal(r.ratio, null); assert.equal(r.totalPnl, 0); assert.equal(r.topUp, 0); });
  assert.equal(C.product('MXF'), 'MTX'); assert.equal(C.product('TXF'), 'TX');
});
test('missing futures quotes never use spot PnL; expired roll day remains due', () => {
  const a = {...F.account(), equityDate: '2026-09-15', indexAtEquity: 19000, nextRollDate: '2026-09-15'};
  const s = C.buildSnapshot(F.market(), a, '2026-09-16T06:01:00Z');
  assert.equal(s.equity, 550000); assert.equal(s.equitySource, 'last_confirmed');
  assert.equal(s.performanceEligible, false); assert.equal(s.decision.rollDue, true);
  assert.throws(() => C.buildSnapshot({...F.market(), date: '2026-09-17'}, F.account(), '2026-09-16T06:01:00Z'), /晚於今日/);
});
test('current futures marks used for exposure when present; signed shorts retain stress sign and warning', () => {
  const a = {...F.account(), positions: [{product: 'TX', month: '2026-09', lots: -1, mark: 20100}]};
  const s = C.buildSnapshot(F.market(), a, '2026-09-16T06:01:00Z');
  assert.equal(s.actualExposure, -2.01); assert.equal(s.exposureSource, 'futures_marks');
  assert.equal(s.stress[0].totalPnl, 200000); assert.ok(s.quality.some(x => x.includes('空單')));
});
test('partial fills: negative roll spread is not slippage; signed arrival and executable depth benchmarks', () => {
  const o = C.analyzeExecution(F.order());
  assert.equal(o.arrivalMid, -19); assert.equal(o.averageFill, -17.25);
  assert.equal(o.arrivalSlippage, 1.75); assert.equal(o.arrivalCost, 350);
  assert.equal(o.arrivalExecutable, -17.5); assert.equal(o.touchSlippage, 0.25);
  assert.equal(o.rollSpreadCash, -3450); assert.equal(o.fee, 152); assert.equal(o.tax, 160);
  assert.equal(o.executionCost, 662); assert.equal(o.averageWaitSeconds, 6);
  assert.equal(o.chasePoints, 3); assert.equal(o.maxChasePoints, 3);
});
test('sell slippage sign, improved fills, absent tax and insufficient five-level depth', () => {
  const raw = F.order(); raw.side = 'sell';
  raw.revisions = []; raw.fills = [{at: '2026-09-16T13:20:04+08:00', price: -18, lots: 1, fee: null, tax: null}];
  const o = C.analyzeExecution(raw); assert.equal(o.arrivalSlippage, -1); assert.equal(o.costComplete, false); assert.equal(o.executionCost, null);
  raw.requestedLots = 20; raw.fills[0].lots = 20;
  assert.equal(C.analyzeExecution(raw).arrivalExecutable, null);
});
test('book direction/order, reversed timestamps, overfills and far-month errors rejected', () => {
  const o = F.order();
  assert.throws(() => C.analyzeExecution({...o, farMonth: '2026-08'}), /遠月/);
  assert.throws(() => C.analyzeExecution({...o, requestedLots: 1}), /成交口數/);
  assert.throws(() => C.analyzeExecution({...o, bookAt: '2026-09-16T13:20:05+08:00'}), /截圖時間/);
  assert.throws(() => C.analyzeExecution({...o, bids: [...o.bids].reverse()}), /排序/);
  assert.throws(() => C.analyzeExecution({...o, orderedAt: '2026-09-16T13:20:01'}), /時區/);
});
test('statistics: order-level sample convention, interpolation P95, total currency cost by product', () => {
  close(C.quantile([1, 3], 0.95), 2.9); close(C.quantile([1, 2, 9], 0.5), 2);
  const a = F.order(), b = {...F.order(), id: 'other', product: 'TX'};
  const stats = C.executionStats([a, b]);
  assert.equal(stats.count, 2); assert.equal(stats.mean, 1.75); assert.equal(stats.slippageCost, 1750);
  assert.equal(stats.byKind.roll.count, 2); assert.equal(C.executionStats([]).p95, null);
});
test('internal cash transfers conserve total equity and keep source valuation date', () => {
  const a = F.account(), t = C.transfer(a, 100000, '2026-09-16T07:00:00Z');
  assert.equal(t.account.equity + t.account.outside, a.equity + a.outside);
  assert.equal(t.event.externalFlow, 0); assert.equal(t.account.equityDate, a.equityDate);
  assert.throws(() => C.transfer(a, 2000000, '2026-09-16T07:00:00Z'), /不足/);
  const clean = C.transfer(a, -100000, '2026-09-16T07:00:00Z', 'monthly_cleanup');
  assert.equal(clean.account.lastCleanupMonth, '2026-09');
});
function perf(date, equity, eligible = true, index = 20000) {
  const s = C.buildSnapshot(F.market(), F.account(), '2026-09-16T06:01:00Z');
  return {...s, date, marketDate: date, totalEquity: equity, performanceEligible: eligible, index, valuationValid: true};
}
test('forward excludes pre-start data, removes external flows and does not double-deduct fees', () => {
  const rows = [perf('2026-09-15', 1), perf('2026-09-16', 100), perf('2026-09-17', 300)];
  const s = C.forwardSeries(rows, [{kind: 'external_flow', date: '2026-09-17', amount: 200}]);
  assert.equal(s.length, 2); assert.equal(s[1].dailyReturn, 0); assert.equal(s[1].cumulativeReturn, 0);
  assert.equal(s[0].dailyReturn, null);
});
test('missing broker day is not actual performance; daily vs multi-day interval return distinct', () => {
  const s = C.forwardSeries([perf('2026-09-16', 100), perf('2026-09-17', 999999, false), perf('2026-09-18', 90)]);
  assert.equal(s[1].cumulativeReturn, null); close(s[2].intervalReturn, -0.1); assert.equal(s[2].dailyReturn, null);
  close(s[2].drawdown, 0.1);
});
test('Forward never creates theoretical futures performance from a spot-index move', () => {
  const a = perf('2026-09-16', 2000000), b = perf('2026-09-17', 1900000, true, 19000);
  b.signal = {...b.signal, target: 0.5, state: 'bear:0.5'};
  const s = C.forwardSeries([a, b]); assert.equal(s[1].theoryEquity, null);
  assert.equal(s[1].theoryExposure, null);
});
test('monthly return uses prior month end, cash-flow-adjusted drawdown and marks partial coverage', () => {
  const rows = [perf('2026-09-30', 100), perf('2026-10-01', 110), perf('2026-10-02', 99)];
  const r = C.monthlyReview(rows, [], [], '2026-10');
  assert.equal(r.openingEquity, 100); assert.equal(r.endingEquity, 99);
  close(r.monthlyReturn, -0.01); close(r.maxDrawdown, 0.1); assert.equal(r.partialMonth, false);
  assert.equal(C.monthlyReview(rows, [], [], '2026-09').partialMonth, true);
  assert.equal(C.monthlyReview([], [], [], '2026-09').monthlyReturn, null);
});
test('automatic signal/risk transition events do not repeat while state persists', () => {
  const a = C.buildSnapshot(F.market(), F.account(), '2026-09-16T06:01:00Z');
  const b = {...a, risk: {...a.risk, below500: true, ratio: 450}};
  assert.equal(C.automaticEvents(a, b).filter(e => e.kind === 'risk_below500').length, 1);
  assert.equal(C.automaticEvents(b, b).length, 0);
});
