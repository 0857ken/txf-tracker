'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../defense-core.js'), G = require('../defense-governance.js'), L = require('../defense-ledger.js');
const F = require('./defense-ledger-fixtures.cjs');

test('Phase D separates post-13:30 signal from post-13:45 day-end valuation', () => {
  const x = G.validateDecisionWindow({date: '2026-09-21', signalAt: '2026-09-21T13:30:00+08:00',
    referenceAt: '2026-09-21T13:31:00+08:00', valuationAt: '2026-09-21T13:45:00+08:00'});
  assert.equal(x.signalPhase, 'post-13:30'); assert.equal(x.valuationPhase, 'post-13:45');
  assert.throws(() => G.validateDecisionWindow({date: '2026-09-21', signalAt: '2026-09-21T13:45:00+08:00', valuationAt: '2026-09-21T13:44:59+08:00'}), /13:45/);
  assert.throws(() => G.validateDecisionWindow({date: '2026-09-21', signalAt: '2026-09-21T13:29:59+08:00', valuationAt: '2026-09-21T13:45:00+08:00'}), /13:30/);
});

test('Phase D boundary fixtures use Asia/Taipei semantics and do not pre-create signal/EOD', () => {
  assert.equal(G.signalEligibility('2026-09-21T05:29:59Z', '2026-09-21').eligible, false);
  assert.equal(G.signalEligibility('2026-09-21T05:30:00Z', '2026-09-21').eligible, true);
  assert.equal(G.signalEligibility('2026-09-21T13:30:00+08:00', '2026-09-21').eligible, true);
  assert.equal(G.eodEligibility('2026-09-21T05:44:59Z', '2026-09-21').eligible, false);
  assert.equal(G.eodEligibility('2026-09-21T05:45:00Z', '2026-09-21').eligible, true);
  const market = {date: '2026-09-21', updatedAt: '2026-09-21T05:45:00Z', closed: true, index: 20000,
    target: Array.from({length: 80}, (_, i) => {
      const d = new Date(Date.UTC(2026, 8, 21 - (79 - i)));
      return {date: d.toISOString().slice(0, 10), close: 100 + i};
    })};
  const account = {asof: '2026-09-20T08:00:00Z', equityDate: '2026-09-20', equity: 1000000, outside: 0,
    indexAtEquity: 20000, initialMargin: 0, maintenanceMargin: 0, positions: []};
  const pre = C.buildSnapshot(market, account, '2026-09-21T05:29:59Z');
  const signal = C.buildSnapshot(market, account, '2026-09-21T05:30:00Z');
  const eod = C.buildSnapshot(market, account, '2026-09-21T05:44:59Z');
  const post = C.buildSnapshot(market, account, '2026-09-21T05:45:00Z');
  assert.equal(pre.signal.state, 'pending'); assert.equal(pre.valuationValid, false);
  assert.notEqual(signal.signal.state, 'pending'); assert.equal(signal.valuationValid, false);
  assert.equal(eod.valuationValid, false); assert.equal(post.valuationValid, true);
});

test('Phase E margin provenance becomes fresh, stale, or unknown explicitly', () => {
  const fresh = G.validateMarginRecord({source: 'TAIFEX', effectiveDate: '2026-09-18', fetchedAt: '2026-09-21T08:00:00+08:00', initial: 100, maintenance: 75}, '2026-09-21T13:45:00+08:00');
  assert.equal(fresh.freshness, 'fresh');
  const stale = G.validateMarginRecord({...fresh, fetchedAt: '2026-09-01T08:00:00+08:00'}, '2026-09-21T13:45:00+08:00');
  assert.equal(stale.freshness, 'stale'); assert.ok(stale.reasons.includes('stale-age'));
  const unknownQuotes = F.quotes('2026-09', 20000, 20000).map(({margin, ...q}) => q);
  assert.equal(L.validateDay({...F.day(), quotes: unknownQuotes}, L.normalizeSeed(F.seed())).quotes[0].margin.freshness, 'unknown');
  const invalidOverride = G.validateMarginRecord({source: 'TAIFEX', effectiveDate: '2026-09-18', fetchedAt: '2026-09-21T08:00:00+08:00', initial: 100, maintenance: 75,
    brokerOverride: {initial: 110, maintenance: 80}}, '2026-09-21T13:45:00+08:00');
  assert.equal(invalidOverride.freshness, 'stale'); assert.ok(invalidOverride.reasons.includes('invalid-brokerOverride'));
  const expiredOverride = G.validateMarginRecord({source: 'TAIFEX', effectiveDate: '2026-09-18', fetchedAt: '2026-09-21T08:00:00+08:00', initial: 100, maintenance: 75,
    brokerOverride: {source: 'Broker', effectiveDate: '2026-09-18', fetchedAt: '2026-09-01T08:00:00+08:00', initial: 110, maintenance: 80}}, '2026-09-21T13:45:00+08:00');
  assert.equal(expiredOverride.freshness, 'stale'); assert.ok(expiredOverride.reasons.includes('brokerOverride-stale-age'));
  const future = G.validateMarginRecord({source: 'TAIFEX', effectiveDate: '2026-09-22', fetchedAt: '2026-09-21T08:00:00+08:00', initial: 100, maintenance: 75}, '2026-09-21T13:45:00+08:00');
  assert.equal(future.rejected, true); assert.ok(future.reasons.includes('effective-in-future'));
});

test('Phase E broker risk reconciliation does not hide mismatch', () => {
  const asOf = '2026-09-21T13:45:00+08:00';
  assert.equal(G.reconcileBrokerRisk({calculated: {initialMargin: 100, maintenanceMargin: 75, ratio: 600}, broker: {initialMargin: 100, maintenanceMargin: 75, ratio: 600, reportedAt: '2026-09-21T13:00:00+08:00'}, asOf}).status, 'matched');
  const r = G.reconcileBrokerRisk({calculated: {initialMargin: 100, maintenanceMargin: 75, ratio: 600}, broker: {initialMargin: 120, maintenanceMargin: 75, ratio: 600, reportedAt: '2026-09-21T13:00:00+08:00'}, asOf});
  assert.equal(r.status, 'mismatch'); assert.equal(r.differences.initialMargin.broker, 120);
  assert.equal(G.reconcileBrokerRisk({calculated: {ratio: 600}, broker: {ratio: 600, reportedAt: '2026-09-19T13:00:00+08:00'}, asOf}).reconciliationStatus, 'unavailable');
});

test('Phase E roll date uses the prior valid TAIFEX trading day, not calendar Wednesday', () => {
  const days = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-19', '2026-10-20'];
  const r = G.rollDate(2026, 10, days);
  assert.equal(r.thirdWednesday, '2026-10-21'); assert.equal(r.rollDate, '2026-10-20');
  assert.equal(G.rollDate(2026, 10, [...days.filter(d => d !== '2026-10-20'), '2026-10-16']).rollDate, '2026-10-19');
  assert.throws(() => G.rollDate(2026, 10, []), /日曆不可空白/);
});

test('Phase E stale or unknown margin blocks executionReady', () => {
  const base = F.quotes('2026-09', 20000, 20000);
  const unknown = L.selectHoldings(2, base.map(({margin, ...q}) => q), '2026-09', 2000000, {decisionTimeFuturesEquity: 1000000, outsideCash: 1000000, transferableOutsideCash: 1000000});
  assert.equal(unknown.executionReady, false);
  const stale = base.map(q => ({...q, margin: {...q.margin, fresh: false, freshness: 'stale'}}));
  const blocked = L.selectHoldings(2, stale, '2026-09', 2000000, {decisionTimeFuturesEquity: 1000000, outsideCash: 1000000, transferableOutsideCash: 1000000});
  assert.equal(blocked.executionReady, false);
});

test('cross-module day flow reaches allocator, theoretical trade, 13:45 MTM and ledger', () => {
  const f = F.sample(), d = L.validateDay(f.days[0], L.normalizeSeed(f.seed));
  const seed = L.normalizeSeed(f.seed), plan = L.theoreticalTrades(seed, d, seed);
  assert.equal(plan.valuation.strategyEquity, 2000000);
  assert.equal(plan.selection.executionReady, true);
  assert.ok(plan.trades.length > 0);
  const marked = L.markBook(seed, d, plan.trades, true);
  assert.equal(marked.at, d.valuationAt); assert.ok(Number.isFinite(marked.equity));
  const gMargins = {TX: [701000, 538000], MTX: [175250, 134500], TMF: [35050, 26900]}, gPrice = 47428;
  const gQuotes = Object.keys(gMargins).map(product => ({product, month: '2026-09', bid: gPrice, ask: gPrice, mark: gPrice,
    initialMargin: gMargins[product][0], maintenanceMargin: gMargins[product][1], source: 'granularity fixture',
    margin: {source: 'granularity fixture', effectiveDate: '2026-09-19', fetchedAt: '2026-09-19T08:00:00+08:00', initial: gMargins[product][0], maintenance: gMargins[product][1], fresh: true}}));
  const noTradeSeed = L.normalizeSeed({...f.seed, equity: 200000, outside: 800000,
    positions: [{product: 'TMF', month: '2026-09', lots: 2, mark: gPrice}], lastAppliedState: 'bear:1'});
  const noTradeDay = {...d, indicators: {...d.indicators, close: 88, ma10: 85, ma20: 90}, quotes: gQuotes};
  const noTrade = L.theoreticalTrades(noTradeSeed, L.validateDay(noTradeDay, noTradeSeed), noTradeSeed);
  assert.equal(noTrade.decision.actionState, 'best-feasible / granularity-limited / no-trade');
  const staleDay = {...f.days[0], quotes: f.days[0].quotes.map(q => ({...q, margin: {...q.margin, stale: true}}))};
  const stalePlan = L.theoreticalTrades(seed, L.validateDay(staleDay, seed), seed);
  assert.equal(stalePlan.decision.executionReady, false); assert.equal(stalePlan.decision.blockedReason, 'outside-cash-unavailable');
});
