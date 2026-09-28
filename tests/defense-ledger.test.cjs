'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../defense-core.js'), L = require('../defense-ledger.js'), F = require('./defense-ledger-fixtures.cjs');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
test('MA equality, strict bear direction and overlap have a total deterministic mapping', () => {
  const x = F.day().indicators;
  [[84.999999, .5], [85, .5], [85.000001, 1], [89.999999, 1], [90, 1.5], [90.000001, 1.5], [99.999999, 1.5], [100, 2], [100.000001, 2]]
    .forEach(([close, target]) => assert.equal(C.classify({...x, close}).target, target));
  assert.equal(C.classify({...x, ma60Lag20: 100}).target, 2);
  assert.equal(C.classify({...x, ma60Lag20: 99.999999}).target, 2);
  assert.equal(C.classify({...x, ma60Lag20: 100.000001}).target, .5);
  const overlap = C.classify({...x, close: 90, ma10: 95}); assert.equal(overlap.target, 1.5); assert.equal(overlap.overlap, true);
});
test('499.999999 and 500.000001 may display 500 but only raw below-500 triggers; monthly 550 independent', () => {
  const below = C.risk(499999.999, 1000000, 100000, 75000), equal = C.risk(500000, 1000000, 100000, 75000), above = C.risk(500000.001, 1000000, 100000, 75000);
  assert.equal(below.ratio.toFixed(1), '500.0'); assert.equal(above.ratio.toFixed(1), '500.0');
  assert.equal(below.topUp, 50001); assert.equal(equal.topUp, 0); assert.equal(above.topUp, 0); assert.equal(equal.monthlyTransfer, 50000);
});
test('integer allocation uses actual contract prices, documented tie rules and all three products', () => {
  assert.deepEqual(L.selectHoldings(.5, F.quotes('2026-09', 20000, 20000), '2026-09').positions, [{product: 'MTX', month: '2026-09', lots: 1}]);
  assert.deepEqual(L.selectHoldings(2, F.quotes('2026-09', 20000, 20000), '2026-09').positions, [{product: 'TX', month: '2026-09', lots: 1}]);
  const p = L.selectHoldings(1.5, F.quotes('2026-09', 23000, 23000), '2026-09');
  assert.ok(p.positions.some(p => p.product === 'TMF')); assert.ok(p.positions.every(p => Number.isInteger(p.lots)));
});
test('four-day real-contract ledger: hand-calculated first day, costs, hold band and forced roll', () => {
  const f = F.sample(), r = L.buildLedger(f.seed, f.days, f.orders); assert.equal(r.status, 'complete', JSON.stringify(r.rows));
  const a = r.rows[0]; near(a.theory.mtmPnl, 5000); near(a.theory.fee, 57); near(a.theory.tax, 60);
  near(a.theory.equity, 554883); near(a.actual.mtmPnl, 4700); near(a.actual.equity, 554583.006); near(a.gap, -299.994);
  near(a.actual.slippageCost, 300); // Already in PnL: not deducted a second time.
  assert.equal(r.rows[1].theory.trades.length, 0); near(r.rows[1].theory.mtmPnl, 5000);
  assert.equal(r.rows[2].decision.rollDue, true); assert.equal(r.rows[2].theory.trades.length, 2);
  assert.equal(r.rows[2].theory.positions[0].month, '2026-10'); assert.equal(r.rows[2].rollGroups[0].spread, -20);
  near(r.rows[2].theory.mtmPnl, 2500); near(r.rows[2].theory.tax, 40.48);
  assert.equal(r.rows[3].targetExposure, 1.5); assert.equal(r.rows[3].theory.positions[0].lots, 3);
});
test('actual roll needs leg prices; basis spread never debits account as cash loss', () => {
  const f = F.sample(), order = f.orders[1];
  const t = L.actualTradesFromExecutions([order], order.tradeDate); assert.equal(t.length, 2);
  near(t.reduce((n, x) => n + x.fee, 0), 38); near(t.reduce((n, x) => n + x.slippageCost, 0), 100);
  delete order.fills[0].nearPrice;
  const r = L.buildLedger(f.seed, f.days, f.orders); assert.equal(r.rows[2].status, 'incomplete'); assert.equal(r.rows[3].status, 'blocked_by_previous_day');
});
test('missing futures quote and pre-signal theoretical fill fail closed, no spot fallback', () => {
  const d = F.day(); d.quotes[0].ask = null;
  assert.equal(L.buildLedger(F.seed(), [d]).status, 'incomplete');
  const e = F.day(); e.referenceAt = '2026-09-16T13:29:59+08:00';
  assert.match(L.buildLedger(F.seed(), [e]).rows[0].error, /訊號確認/);
});
test('hold PnL follows futures basis even when spot does not move; internal funding conserves total', () => {
  const seed = {...F.seed(), equity: 490000, outside: 1510000, lastAppliedState: 'bear:0.5', positions: [{product: 'MTX', month: '2026-09', lots: 1, mark: 20000}]};
  const d = F.day('2026-09-16', 20000, 20010); d.quotes.forEach(q => { q.initialMargin = 100000; q.maintenanceMargin = 75000; });
  d.actualTransfer = 60000;
  const r = L.buildLedger(seed, [d]).rows[0]; near(r.theory.mtmPnl, 500); near(r.theory.transfer, 59500);
  near(r.theory.equity, 550000); near(r.theory.totalEquity, 2000500); near(r.actual.totalEquity, 2000500);
});
test('external flows are not returns; broker reconciliation and trade completeness explicit', () => {
  const seed = {...F.seed(), lastAppliedState: 'bear:0.5', positions: [{product: 'MTX', month: '2026-09', lots: 1, mark: 20000}]};
  const d = F.day('2026-09-16', 20000, 20000); d.externalFlow = 100000; d.brokerEquity = 550000; d.brokerOutside = 1550000;
  const r = L.buildLedger(seed, [d]).rows[0]; near(r.actual.dailyReturn, 0); assert.equal(r.actual.reconciled, true);
  d.actualComplete = false; assert.equal(L.buildLedger(seed, [d]).status, 'incomplete');
});
test('monthly report uses futures ledger from opening balance and includes first day PnL', () => {
  const f = F.sample(), book = L.buildLedger(f.seed, f.days, f.orders);
  const r = L.monthlyReview(book, f.orders, [], '2026-09');
  near(r.openingEquity, 2000000); near(r.endingEquity, book.rows.at(-1).actual.totalEquity);
  near(r.monthlyReturn, r.endingEquity / 2000000 - 1);
  near(r.theoreticalReturn, book.rows.at(-1).theory.totalEquity / 2000000 - 1);
  assert.deepEqual(r.exposureDays, {'0.5': 3, '1': 0, '1.5': 1, '2': 0});
  assert.equal(r.rollCount, 1); assert.equal(r.rebalanceCount, 2);
});
test('missing trading day stops ledger; monthly cleanup cannot be executed repeatedly', () => {
  const f = F.sample(); f.days.splice(1, 1);
  assert.match(L.buildLedger(f.seed, f.days, f.orders).rows[1].error, /前交易日/);
  const g = F.sample(); g.days[0].monthlyCleanup = true; g.days[1].monthlyCleanup = true;
  assert.match(L.buildLedger(g.seed, g.days, g.orders).rows[1].error, /同月份/);
});
