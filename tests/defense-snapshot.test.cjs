'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {planDaily, persistPlan} = require('../scripts/defense-snapshot.cjs');
const {yahoo, fetchMarket} = require('../scripts/defense-quotes.cjs');
const F = require('./defense-fixtures.cjs');
function fakeDb(account) {
  const data = new Map([['root/state/account', account]]);
  function ref(path) { return {path, collection(name) { return {doc: id => ref(path + '/' + name + '/' + id)}; }}; }
  return {data, doc: ref, async runTransaction(fn) {
    const pending = [];
    const result = await fn({get: async r => ({exists: data.has(r.path), data: () => structuredClone(data.get(r.path))}),
      create(r, value) { if (data.has(r.path)) throw new Error('ALREADY_EXISTS'); pending.push([r.path, value]); },
      set(r, value) { pending.push([r.path, value]); }});
    pending.forEach(([key, value]) => data.set(key, structuredClone(value)));
    return result;
  }};
}
const input = () => ({market: F.market(), account: F.account(), now: '2026-09-16T06:01:00Z'});
test('input hash idempotency excludes retry time; month-end rollover produces previous calendar month', () => {
  const p = planDaily(input()), again = planDaily({...input(), now: '2026-09-16T07:01:00Z'});
  assert.equal(p.id, again.id); assert.equal(p.observation.stress.length, 4);
  const q = planDaily({...input(), now: '2026-10-01T07:01:00Z'});
  assert.deepEqual(q.reviews.map(r => r.month), ['2026-10', '2026-09']);
});
test('execution/manual event changes cause new review observations even with unchanged quotes', () => {
  const p = planDaily(input()), q = planDaily({...input(), executions: [F.order()]});
  assert.notEqual(p.id, q.id); assert.equal(q.reviews[0].execution.count, 1);
  const again = planDaily({...input(), previous: p.observation, events: p.events});
  assert.equal(p.id, again.id);
});
test('transaction writes immutable observation once and preserves revision guard on stale account', async () => {
  const p = planDaily(input()), db = fakeDb(F.account());
  assert.equal((await persistPlan(db, 'root', p, 1)).written, true);
  const count = db.data.size;
  assert.equal((await persistPlan(db, 'root', p, 1)).duplicate, true);
  assert.equal(db.data.size, count);
  const changed = fakeDb({...F.account(), revision: 2});
  await assert.rejects(persistPlan(changed, 'root', p, 1), /ACCOUNT_CHANGED/);
  assert.equal(changed.data.size, 1);
});
test('new daily revision keeps prior immutable observation and cannot overwrite a newer run', async () => {
  const db = fakeDb(F.account()), p = planDaily(input());
  await persistPlan(db, 'root', p, 1);
  const next = planDaily({...input(), executions: [F.order()], previous: p.observation, now: '2026-09-16T07:01:00Z'});
  await persistPlan(db, 'root', next, 1);
  assert.ok(db.data.has('root/observations/' + p.id)); assert.ok(db.data.has('root/observations/' + next.id));
  const old = planDaily({...input(), events: [{id: 'older', kind: 'account_update', date: '2026-09-16'}]});
  await assert.rejects(persistPlan(db, 'root', old, 1), /NEWER_OBSERVATION_EXISTS/);
});
test('Yahoo parser excludes unclosed current bar, aligns target/index, missing data fails', async () => {
  const body = {chart: {result: [{timestamp: [Date.parse('2026-09-15T01:00:00Z') / 1000, Date.parse('2026-09-16T01:00:00Z') / 1000],
    indicators: {quote: [{close: [100, 101], open: [99, 100], high: [101, 102], low: [99, 100], volume: [1000, 1000]}]}}]}};
  const fetcher = async () => ({ok: true, json: async () => structuredClone(body)});
  const early = await yahoo('0050.TW', '2026-09-16T04:00:00Z', fetcher); assert.equal(early.at(-1).date, '2026-09-15');
  const m = await fetchMarket('2026-09-16T06:00:00Z', fetcher); assert.equal(m.date, '2026-09-16'); assert.equal(m.index, 101);
});
