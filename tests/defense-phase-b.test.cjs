'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../defense-core.js'), L = require('../defense-ledger.js');
const CoreF = require('./defense-fixtures.cjs'), LedgerF = require('./defense-ledger-fixtures.cjs');
const near = (a, b, eps = 1e-8) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('dynamic equity sets 2x target notional at 1.5m, 2m and 3m without changing allocator', () => {
  const quotes = LedgerF.quotes('2026-09', 20000, 20000);
  [[1500000, 3000000], [2000000, 4000000], [3000000, 6000000]].forEach(([equity, target]) => {
    const allocation = L.selectHoldings(2, quotes, '2026-09', equity);
    assert.equal(allocation.strategyEquity, equity);
    assert.equal(allocation.targetNotional, target);
  });
});

test('all four fixed target levels use the same dynamic equity denominator', () => {
  const quotes = LedgerF.quotes('2026-09', 20000, 20000), equity = 1500000;
  [[.5, 750000], [1, 1500000], [1.5, 2250000], [2, 3000000]].forEach(([targetX, targetNotional]) => {
    assert.equal(L.selectHoldings(targetX, quotes, '2026-09', equity).targetNotional, targetNotional);
  });
});

test('near-zero positive equity is explicit; zero and negative equity refuse allocation', () => {
  const quotes = LedgerF.quotes('2026-09', 20000, 20000);
  const tiny = L.selectHoldings(.5, quotes, '2026-09', .01);
  assert.equal(tiny.strategyEquity, .01); assert.equal(tiny.targetNotional, .005);
  assert.deepEqual(tiny.positions, []);
  assert.throws(() => L.selectHoldings(2, quotes, '2026-09', 0), /動態總策略權益/);
  assert.throws(() => L.selectHoldings(2, quotes, '2026-09', -1), /動態總策略權益/);
});

test('negative futures equity is allowed when futures plus outside cash remains positive', () => {
  const a = {...CoreF.account(), equity: -100000, outside: 2100000};
  const s = C.buildSnapshot(CoreF.market(), a, '2026-09-16T06:01:00Z');
  assert.equal(s.strategyEquity, 2000000); assert.equal(s.allocationStatus, 'ready');
  assert.equal(s.actualExposure, 3.3); assert.equal(s.targetNotional, 4000000);
});

test('unavailable valuation never falls back to capitalBase and blocks forced trade advice', () => {
  const a = {...CoreF.account(), equityDate: '2026-09-15', indexAtEquity: 19900,
    positions: [{product: 'MTX', month: '2026-09', lots: 1, mark: null}], lastAppliedState: 'bear:0.5'};
  const s = C.buildSnapshot(CoreF.market(), a, '2026-09-16T06:01:00Z');
  assert.equal(s.allocationStatus, 'valuation-unavailable');
  assert.equal(s.actualExposure, null); assert.equal(s.targetNotional, null);
  assert.equal(s.decision.actionRequired, true); assert.equal(s.decision.tradeRequired, false);
  assert.equal(s.decision.blockedReason, 'valuation-unavailable');
});

test('no-trade band uses inclusive exact boundaries while signal and roll remain forced', () => {
  const s = C.classify({close: 100, ma10: 90, ma20: 95, ma60: 99, ma60Lag20: 110});
  [[.05, true], [-.05, true], [.050001, false], [-.050001, false]].forEach(([gap, inside]) => {
    const actual = s.target - gap;
    assert.equal(C.decision(s, actual, s.state, false).insideBand, inside);
  });
  assert.equal(C.decision(s, s.target, 'bear:1.5', false).tradeRequired, true);
  assert.equal(C.decision(s, s.target, s.state, true).tradeRequired, true);
});

test('decision valuation applies carry MTM and external flow before sizing, never same-trade costs', () => {
  const seed = L.normalizeSeed(LedgerF.seed()), day = LedgerF.day('2026-09-16', 20200, 20210);
  const plan = L.theoreticalTrades(seed, L.validateDay(day, seed), seed);
  assert.equal(plan.valuation.carryMtm, 40000);
  assert.equal(plan.valuation.futuresEquity, 590000);
  assert.equal(plan.valuation.strategyEquity, 2040000);
  assert.equal(plan.selection.targetNotional, 1020000);
  assert.ok(plan.trades.reduce((n, t) => n + t.fee + t.tax, 0) > 0);

  const flowed = LedgerF.day('2026-09-16', 20200, 20210); flowed.externalFlow = 100000;
  const flowedPlan = L.theoreticalTrades(seed, L.validateDay(flowed, seed), seed);
  assert.equal(flowedPlan.valuation.strategyEquity, 2140000);
  assert.equal(flowedPlan.selection.targetNotional, 1070000);
});

test('internal top-up conserves strategy equity; external deposit and withdrawal change it', () => {
  const a = CoreF.account(), before = C.strategyEquity(a.equity, a.outside);
  const topped = C.transfer(a, 100000, '2026-09-16T07:00:00Z').account;
  assert.equal(C.strategyEquity(topped.equity, topped.outside), before);

  const seed = L.normalizeSeed(LedgerF.seed()), base = LedgerF.day();
  base.actualTransfer = 100000;
  const basePlan = L.theoreticalTrades(seed, L.validateDay(base, seed), seed);
  assert.equal(basePlan.valuation.strategyEquity, 2000000);
  for (const flow of [100000, -100000]) {
    const d = LedgerF.day(); d.externalFlow = flow;
    const plan = L.theoreticalTrades(seed, L.validateDay(d, seed), seed);
    assert.equal(plan.valuation.strategyEquity, 2000000 + flow);
  }
});

test('insufficient outside cash is reported without inventing strategy equity', () => {
  const r = C.risk(400000, 10000, 100000, 75000);
  assert.equal(r.topUp, 150000); assert.equal(r.availableTransfer, 10000);
  assert.equal(r.fundingShortfall, 140000); assert.equal(r.reserveSufficient, false);
  assert.equal(r.equityAfterTransfer + r.outsideAfterTransfer, 410000);
});

test('legacy and dynamic denominators diverge only when strategy equity differs from capitalBase', () => {
  const a = {...CoreF.account(), outside: 9450000};
  const s = C.buildSnapshot(CoreF.market(), a, '2026-09-16T06:01:00Z');
  const legacyExposure = s.notional / C.CAPITAL;
  assert.equal(legacyExposure, 3.3); assert.equal(s.actualExposure, .66);
  near(s.actualExposure, s.notional / s.strategyEquity);
});
