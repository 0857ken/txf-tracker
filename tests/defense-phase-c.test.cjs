'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../defense-core.js'), L = require('../defense-ledger.js');

const PRICE = 47428;
const margins = {TX: [701000, 538000], MTX: [175250, 134500], TMF: [35050, 26900]};
const quotes = (month = '2026-10') => Object.keys(C.MULT).map(product => ({product, month,
  bid: PRICE, ask: PRICE, mark: PRICE, initialMargin: margins[product][0], maintenanceMargin: margins[product][1],
  source: 'PHASE C0 FROZEN ACCEPTANCE FIXTURE', margin: {source: 'PHASE C0 FROZEN ACCEPTANCE FIXTURE', effectiveDate: '2026-09-19',
    fetchedAt: '2026-09-19T08:00:00+08:00', initial: margins[product][0], maintenance: margins[product][1], fresh: true}}));
const funding = (futures = 200000, outside = 800000, transferable = outside) =>
  ({decisionTimeFuturesEquity: futures, outsideCash: outside, transferableOutsideCash: transferable});

test('v1.27 frozen 1m acceptance cases and formal granularity states', () => {
  const expected = [[.5, 1, 'within-band'], [1, 2, 'granularity-limited'],
    [1.5, 3, 'granularity-limited'], [2, 4, 'granularity-limited']];
  for (const [target, lots, status] of expected) {
    const r = L.selectHoldings(target, quotes(), '2026-10', 1000000, funding());
    assert.deepEqual(r.positions, [{product: 'TMF', month: '2026-10', lots}]);
    assert.equal(r.allocationStatus, status);
    assert.equal(r.requiredInitialMargin, 35050 * lots);
    assert.equal(r.requiredMaintenanceMargin, 26900 * lots);
    assert.equal(r.required500Equity, 175250 * lots);
    assert.equal(r.required550Equity, 192775 * lots);
    assert.equal(r.requiredInternalTopUp, Math.max(0, 192775 * lots - 200000));
    assert.equal(r.executionReady, true);
  }
});

test('missing or stale valuation returns formal fail-closed status without suggested lots', () => {
  const missing = L.selectHoldings(2, quotes().slice(1), '2026-10', 1000000, funding());
  assert.equal(missing.allocationStatus, 'valuation-unavailable');
  assert.deepEqual(missing.positions, []); assert.equal(missing.executionReady, false);
  const staleQuotes = quotes(); staleQuotes[0].stale = true;
  assert.equal(L.selectHoldings(2, staleQuotes, '2026-10', 1000000, funding()).allocationStatus,
    'valuation-unavailable');
});

test('550 gate excludes TX at 1m while safe MTX never wins the four fixed targets', () => {
  for (const target of [.5, 1, 1.5, 2]) {
    const r = L.selectHoldings(target, quotes(), '2026-10', 1000000, funding());
    assert.equal(r.positions.some(p => p.product === 'TX' || p.product === 'MTX'), false);
    assert.ok(r.required550Equity <= 1000000);
  }
  assert.ok(5.5 * margins.TX[0] > 1000000);
  assert.ok(5.5 * margins.MTX[0] <= 1000000);
});

test('product eligibility is dynamically derived, never a fixed capital ban', () => {
  const equity = PRICE * C.MULT.TX / 2;
  const r = L.selectHoldings(2, quotes(), '2026-10', equity, funding(1000000, equity - 1000000));
  assert.deepEqual(r.positions, [{product: 'TX', month: '2026-10', lots: 1}]);
  assert.equal(r.exposure, 2); assert.equal(r.allocationStatus, 'within-band');
  assert.ok(r.required550Equity <= equity);
});

test('no safe non-zero tuple is margin-limited and returns no suggested lots', () => {
  const r = L.selectHoldings(.5, quotes(), '2026-10', 100000, funding(50000, 50000));
  assert.equal(r.allocationStatus, 'margin-limited'); assert.deepEqual(r.positions, []);
  assert.equal(r.notional, null); assert.equal(r.executionReady, false);
});

test('immediately transferable cash, not total accounting cash, controls executionReady', () => {
  const blocked = L.selectHoldings(2, quotes(), '2026-10', 1000000, funding(200000, 800000, 100000));
  assert.equal(blocked.required550Equity, 771100); assert.equal(blocked.requiredInternalTopUp, 571100);
  assert.equal(blocked.executionReady, false);
  const ready = L.selectHoldings(2, quotes(), '2026-10', 1000000, funding(200000, 800000, 571100));
  assert.equal(ready.executionReady, true);
});

test('best feasible granularity holding does not create a daily fake rebalance', () => {
  const seed = L.normalizeSeed({at: '2026-09-19T08:00:00+08:00', equity: 400000, outside: 600000,
    positions: [{product: 'TMF', month: '2026-10', lots: 2, mark: PRICE}], source: 'PHASE C TEST',
    fees: {TX: 38, MTX: 19, TMF: 16}, taxRate: .00002, lastAppliedState: 'bear:1'});
  const day = L.validateDay({date: '2026-09-19', previousTradingDate: '2026-09-18', signalDate: '2026-09-19',
    signalAt: '2026-09-19T13:30:00+08:00', referenceAt: '2026-09-19T13:31:00+08:00',
    valuationAt: '2026-09-19T13:45:00+08:00', targetMonth: '2026-10',
    indicators: {close: 88, ma10: 85, ma20: 90, ma60: 100, ma60Lag20: 110}, quotes: quotes(),
    externalFlow: 0, actualTransfer: 0, transferableOutsideCash: 600000,
    roll: false, monthlyCleanup: false, actualComplete: true}, seed);
  const plan = L.theoreticalTrades(seed, day, seed);
  assert.equal(plan.selection.allocationStatus, 'granularity-limited');
  assert.equal(plan.decision.insideBand, false); assert.equal(plan.decision.sameAsBest, true);
  assert.equal(plan.decision.tradeRequired, false); assert.equal(plan.trades.length, 0);
  assert.equal(plan.decision.actionState, 'best-feasible / granularity-limited / no-trade');
});

test('same-decision internal top-up does not increase strategy equity', () => {
  const r = L.selectHoldings(2, quotes(), '2026-10', 1000000, funding(200000, 800000));
  const futuresAfter = 200000 + r.requiredInternalTopUp;
  const outsideAfter = 800000 - r.requiredInternalTopUp;
  assert.equal(futuresAfter + outsideAfter, 1000000);
  assert.equal(futuresAfter, r.required550Equity);
});
