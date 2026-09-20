'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const G = require('../defense-governance.js'), L = require('../defense-ledger.js');
const F = require('./defense-ledger-fixtures.cjs');

test('Phase D separates post-13:30 signal from post-13:45 day-end valuation', () => {
  const x = G.validateDecisionWindow({date: '2026-09-21', signalAt: '2026-09-21T13:30:00+08:00',
    referenceAt: '2026-09-21T13:31:00+08:00', valuationAt: '2026-09-21T13:45:00+08:00'});
  assert.equal(x.signalPhase, 'post-13:30'); assert.equal(x.valuationPhase, 'post-13:45');
  assert.throws(() => G.validateDecisionWindow({date: '2026-09-21', signalAt: '2026-09-21T13:45:00+08:00', valuationAt: '2026-09-21T13:44:59+08:00'}), /13:45/);
  assert.throws(() => G.validateDecisionWindow({date: '2026-09-21', signalAt: '2026-09-21T13:29:59+08:00', valuationAt: '2026-09-21T13:45:00+08:00'}), /13:30/);
});

test('Phase E margin provenance becomes fresh, stale, or unknown explicitly', () => {
  const fresh = G.validateMarginRecord({source: 'TAIFEX', effectiveDate: '2026-09-18', fetchedAt: '2026-09-21T08:00:00+08:00', initial: 100, maintenance: 75}, '2026-09-21T13:45:00+08:00');
  assert.equal(fresh.freshness, 'fresh');
  const stale = G.validateMarginRecord({...fresh, fetchedAt: '2026-09-01T08:00:00+08:00'}, '2026-09-21T13:45:00+08:00');
  assert.equal(stale.freshness, 'stale'); assert.ok(stale.reasons.includes('stale-age'));
  assert.equal(L.validateDay({...F.day(), quotes: F.quotes('2026-09', 20000, 20000)}, L.normalizeSeed(F.seed())).quotes[0].margin.freshness, 'unknown');
});

test('Phase E broker risk reconciliation does not hide mismatch', () => {
  assert.equal(G.reconcileBrokerRisk({calculated: {initialMargin: 100, maintenanceMargin: 75, ratio: 600}, broker: {initialMargin: 100, maintenanceMargin: 75, ratio: 600}}).status, 'matched');
  const r = G.reconcileBrokerRisk({calculated: {initialMargin: 100, maintenanceMargin: 75, ratio: 600}, broker: {initialMargin: 120, maintenanceMargin: 75, ratio: 600}});
  assert.equal(r.status, 'mismatch'); assert.equal(r.differences.initialMargin.broker, 120);
});

test('Phase E roll date uses the prior valid TAIFEX trading day, not calendar Wednesday', () => {
  const days = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-19', '2026-10-20'];
  const r = G.rollDate(2026, 10, days);
  assert.equal(r.thirdWednesday, '2026-10-21'); assert.equal(r.rollDate, '2026-10-20');
  assert.equal(G.rollDate(2026, 10, [...days.filter(d => d !== '2026-10-20'), '2026-10-16']).rollDate, '2026-10-19');
});
