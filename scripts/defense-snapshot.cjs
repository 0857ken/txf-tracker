'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const C = require('../defense-core.js');
const config = require('../defense-config.js');
const {fetchMarket} = require('./defense-quotes.cjs');
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function planDaily({market, account, previous, snapshots = [], executions = [], events = [], now}) {
  if (C.twDate(now) < C.START) throw new Error('不可寫入forward起算日前的資料');
  const current = C.buildSnapshot(market, account, now);
  // Same financial inputs produce the same immutable observation, even if a retry ran later.
  const input = {formulaVersion: C.VERSION, date: current.date, market: {date: market.date, index: market.index,
    target: market.target, closed: market.closed}, account,
    executions: executions.map(e => e.id).sort(),
    manualEvents: events.filter(e => !e.observationId).map(e => e.id).sort()};
  const id = digest(input), observation = {...current, observationId: id, input};
  const newEvents = C.automaticEvents(previous, current).map(e => ({...e, id: digest({observationId: id, kind: e.kind}), observationId: id}));
  const daily = [...snapshots.filter(s => s.date !== current.date), observation];
  const allEvents = [...events, ...newEvents.filter(e => !events.some(old => old.id === e.id))];
  const months = [...new Set([current.date.slice(0, 7),
    new Date(Date.parse(current.date.slice(0, 7) + '-01T00:00:00Z') - 86400000).toISOString().slice(0, 7),
    ...executions.map(e => e.tradeDate.slice(0, 7)), ...events.filter(e => e.date >= C.START).map(e => e.date.slice(0, 7))])];
  return {id, observation, events: newEvents, daily,
    reviews: months.map(m => C.monthlyReview(daily, executions, allEvents, m))};
}
async function persistPlan(db, root, plan, expectedRevision) {
  const base = db.doc(root);
  return db.runTransaction(async tx => {
    const accountRef = base.collection('state').doc('account');
    const obsRef = base.collection('observations').doc(plan.id);
    const latestRef = base.collection('state').doc('latest');
    const [account, existing, latest] = await Promise.all([tx.get(accountRef), tx.get(obsRef), tx.get(latestRef)]);
    if (!account.exists || (account.data().revision || 0) !== expectedRevision) throw new Error('ACCOUNT_CHANGED');
    if (existing.exists) return {written: false, duplicate: true};
    if (latest.exists && latest.data().observedAt > plan.observation.observedAt) throw new Error('NEWER_OBSERVATION_EXISTS');
    tx.create(obsRef, plan.observation);
    tx.set(base.collection('dailySnapshots').doc(plan.observation.date), plan.observation);
    tx.set(latestRef, plan.observation);
    for (const e of plan.events) tx.create(base.collection('events').doc(e.id), e);
    for (const r of plan.reviews) tx.set(base.collection('monthlyReviews').doc(r.month), {...r, updatedAt: plan.observation.observedAt});
    tx.set(base.collection('state').doc('health'), {lastSuccessAt: plan.observation.observedAt,
      marketDate: plan.observation.marketDate, observationId: plan.id, status: plan.observation.quality.length ? 'needs_review' : 'ok'});
    return {written: true, duplicate: false};
  });
}
async function loadState(db, root) {
  const base = db.doc(root);
  const [account, previous, snapshots, executions, events] = await Promise.all([
    base.collection('state').doc('account').get(), base.collection('state').doc('latest').get(),
    base.collection('dailySnapshots').get(), base.collection('executions').get(), base.collection('events').get()]);
  if (!account.exists) throw new Error('SETUP_REQUIRED');
  const unpack = snap => snap.docs.map(d => ({...d.data(), id: d.id}));
  return {account: account.data(), previous: previous.exists ? previous.data() : null,
    snapshots: unpack(snapshots), executions: unpack(executions), events: unpack(events)};
}
async function main() {
  const args = process.argv.slice(2), now = new Date().toISOString();
  if (!args.includes('--write')) {
    const fixture = args.indexOf('--fixture');
    if (fixture < 0 || !args[fixture + 1]) throw new Error('DRY_RUN_REQUIRES_FIXTURE');
    const data = JSON.parse(fs.readFileSync(args[fixture + 1], 'utf8'));
    const p = planDaily({...data, now: data.now || now});
    console.log(JSON.stringify({dryRun: true, observationId: p.id, date: p.observation.date,
      labels: p.observation.labels, stressScenarios: p.observation.stress.length,
      eventCount: p.events.length, reviewMonths: p.reviews.map(r => r.month)}));
    return;
  }
  const scope = process.env.DEFENSE_SCOPE;
  if (process.env.DEFENSE_ENABLE_WRITE !== 'true' || !['preview', 'production'].includes(scope)) throw new Error('WRITE_DISABLED');
  if (scope === 'production' && (config.mode !== 'production' || process.env.GITHUB_REPOSITORY !== '0857ken/txf-tracker'
      || process.env.GITHUB_REF !== 'refs/heads/main')) throw new Error('PRODUCTION_GUARD');
  const sdk = createRequire(path.resolve(__dirname, '../tools/defense-runner/package.json'));
  const {initializeApp, cert} = sdk('firebase-admin/app'), {getFirestore} = sdk('firebase-admin/firestore');
  const key = process.env.FIREBASE_KEY;
  if (!key) throw new Error('CREDENTIAL_UNAVAILABLE');
  initializeApp({credential: cert(JSON.parse(key))});
  const db = getFirestore();
  const root = 'users/me/' + (scope === 'production' ? 'defenseStrategies/' + config.strategyId : 'defensePreviews/' + config.previewId);
  try {
    const market = await fetchMarket(now);
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = await loadState(db, root);
      const plan = planDaily({...state, market, now});
      try {
        const result = await persistPlan(db, root, plan, state.account.revision || 0);
        await db.doc(root + '/market/latest').set(market);
        // Only identifiers and quality counts are logged; no balance, positions or credential content.
        console.log(JSON.stringify({status: 'ok', date: plan.observation.date, ...result, issues: plan.observation.quality.length}));
        return;
      } catch (error) {
        if (error.message !== 'ACCOUNT_CHANGED' || attempt === 2) throw error;
      }
    }
  } catch (error) {
    const code = ['SETUP_REQUIRED', 'ACCOUNT_CHANGED', 'NEWER_OBSERVATION_EXISTS'].includes(error.message) ? error.message : 'SNAPSHOT_FAILED';
    await db.doc(root + '/state/health').set({lastAttemptAt: now, status: 'error', code}, {merge: true});
    throw new Error(code);
  }
}
if (require.main === module) main().catch(error => {
  const safe = ['SETUP_REQUIRED', 'ACCOUNT_CHANGED', 'NEWER_OBSERVATION_EXISTS', 'SNAPSHOT_FAILED',
    'WRITE_DISABLED', 'PRODUCTION_GUARD', 'CREDENTIAL_UNAVAILABLE', 'DRY_RUN_REQUIRES_FIXTURE'].includes(error.message) ? error.message : 'DEFENSE_JOB_FAILED';
  console.error(safe); process.exitCode = 1;
});
module.exports = {digest, planDaily, persistPlan, loadState};
