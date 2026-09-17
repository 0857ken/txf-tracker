'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const C = require('../defense-core.js');
const L = require('../defense-ledger.js');
const config = require('../defense-config.js');
const {fetchMarket} = require('./defense-quotes.cjs');
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function planDaily({market, account, previous, snapshots = [], executions = [], events = [], now,
  ledgerSeed = null, ledgerInputs = [], ledgerDays = [], ledgerRevision = 0}) {
  if (C.twDate(now) < C.START) throw new Error('不可寫入forward起算日前的資料');
  if (ledgerInputs.some(d => C.timestamp(d.valuationAt) > C.timestamp(now))) throw new Error('帳本含未來日終，禁止寫入');
  let current = C.buildSnapshot(market, account, now);
  const ledger = L.buildLedger(ledgerSeed, ledgerInputs, executions);
  const currentLedger = ledger.rows.find(r => r.date === current.date) || null;
  if (currentLedger?.status === 'complete' && C.timestamp(currentLedger.at) <= C.timestamp(now)
      && C.timestamp(account.asof) <= C.timestamp(currentLedger.at)) {
    const a = currentLedger.actual;
    current = C.buildSnapshot(market, {...account, asof: a.at, equityDate: market.date, indexAtEquity: market.index,
      equity: a.equity, outside: a.outside, positions: a.positions, initialMargin: a.initialMargin, maintenanceMargin: a.maintenanceMargin}, now);
    current.equitySource = 'actual_futures_ledger';
    if (!a.reconciled) {
      current.quality.push('實際成交期貨帳本MTM，尚未與券商日結對帳');
      if (!current.labels.includes('資料待核對')) current.labels.push('資料待核對');
    }
    current.performanceEligible = current.valuationValid && a.reconciled;
  }
  current.ledger = currentLedger; current.ledgerStatus = ledger.status;
  current.kind = current.valuationValid ? 'end_of_day' : 'observation_only';
  // Same financial inputs produce the same immutable observation, even if a retry ran later.
  const input = {formulaVersion: C.VERSION, date: current.date, market: {date: market.date, index: market.index,
    target: market.target, closed: market.closed, futures: market.futures || []}, account,
    ledgerSeed, ledgerInputs, ledgerRevision,
    executions: executions.map(e => e.id).sort(),
    manualEvents: events.filter(e => !e.observationId).map(e => e.id).sort()};
  const id = digest(input), observation = {...current, observationId: id,
    input: {...input, ledgerSeed: ledgerSeed ? digest(ledgerSeed) : null,
      ledgerInputs: ledgerInputs.map(d => ({date: d.date, hash: digest(d)}))}};
  const newEvents = C.automaticEvents(previous, current).map(e => ({...e, id: digest({observationId: id, kind: e.kind}), observationId: id}));
  const daily = [...snapshots.filter(s => !current.valuationValid || s.date !== current.date),
    ...(current.valuationValid ? [observation] : [])].map(s => ({...s, ledger: ledger.rows.find(r => r.date === s.date) || s.ledger || null}));
  const allEvents = [...events, ...newEvents.filter(e => !events.some(old => old.id === e.id))];
  const months = [...new Set([current.date.slice(0, 7),
    new Date(Date.parse(current.date.slice(0, 7) + '-01T00:00:00Z') - 86400000).toISOString().slice(0, 7),
    ...executions.map(e => e.tradeDate.slice(0, 7)), ...events.filter(e => e.date >= C.START).map(e => e.date.slice(0, 7))])];
  const ledgerWrites = ledger.rows.filter(r => {
    const old = ledgerDays.find(x => x.date === r.date); if (!old) return true;
    const {id, ...value} = old; return digest(value) !== digest(r);
  });
  if (ledgerWrites.length > 400) throw new Error('帳本更正超過400日，須分期處理');
  return {id, observation, events: newEvents, daily, ledger, ledgerWrites, ledgerRevision,
    reviews: months.map(m => L.monthlyReview(ledger, executions, allEvents, m, daily))};
}
async function persistPlan(db, root, plan, expectedRevision) {
  const base = db.doc(root);
  return db.runTransaction(async tx => {
    const accountRef = base.collection('state').doc('account');
    const obsRef = base.collection('observations').doc(plan.id);
    const latestRef = base.collection('state').doc('latest');
    const [account, existing, latest, ledgerVersion] = await Promise.all([tx.get(accountRef), tx.get(obsRef), tx.get(latestRef),
      tx.get(base.collection('state').doc('ledgerVersion'))]);
    if (!account.exists || (account.data().revision || 0) !== expectedRevision) throw new Error('ACCOUNT_CHANGED');
    if ((ledgerVersion.exists ? ledgerVersion.data().revision : 0) !== plan.ledgerRevision) throw new Error('LEDGER_CHANGED');
    if (existing.exists) return {written: false, duplicate: true};
    if (latest.exists && latest.data().observedAt > plan.observation.observedAt) throw new Error('NEWER_OBSERVATION_EXISTS');
    tx.create(obsRef, plan.observation);
    // Exactly one canonical day-end document per valid trading date. Corrections keep audit observations.
    if (plan.observation.valuationValid) tx.set(base.collection('dailySnapshots').doc(plan.observation.date), plan.observation);
    tx.set(latestRef, plan.observation);
    for (const e of plan.events) tx.create(base.collection('events').doc(e.id), e);
    for (const row of plan.ledgerWrites) tx.set(base.collection('ledgerDaily').doc(row.date), row);
    for (const r of plan.reviews) tx.set(base.collection('monthlyReviews').doc(r.month), {...r, updatedAt: plan.observation.observedAt});
    tx.set(base.collection('state').doc('health'), {lastSuccessAt: plan.observation.observedAt,
      marketDate: plan.observation.marketDate, observationId: plan.id, status: plan.observation.quality.length ? 'needs_review' : 'ok'});
    return {written: true, duplicate: false};
  });
}
async function loadState(db, root) {
  const base = db.doc(root);
  const [account, previous, snapshots, executions, events, opening, inputs, ledgerDays, version] = await Promise.all([
    base.collection('state').doc('account').get(), base.collection('state').doc('latest').get(),
    base.collection('dailySnapshots').get(), base.collection('executions').get(), base.collection('events').get(),
    base.collection('ledgerSettings').doc('opening').get(), base.collection('ledgerInputs').get(),
    base.collection('ledgerDaily').get(), base.collection('state').doc('ledgerVersion').get()]);
  if (!account.exists) throw new Error('SETUP_REQUIRED');
  const unpack = snap => snap.docs.map(d => ({...d.data(), id: d.id}));
  return {account: account.data(), previous: previous.exists ? previous.data() : null,
    snapshots: unpack(snapshots), executions: unpack(executions), events: unpack(events),
    ledgerSeed: opening.exists ? opening.data() : null, ledgerInputs: unpack(inputs), ledgerDays: unpack(ledgerDays),
    ledgerRevision: version.exists ? version.data().revision : 0};
}
function errorCode(error) {
  if (['SETUP_REQUIRED', 'ACCOUNT_CHANGED', 'LEDGER_CHANGED', 'NEWER_OBSERVATION_EXISTS'].includes(error.message)) return error.message;
  return ({6: 'WRITE_ALREADY_EXISTS', 7: 'WRITE_PERMISSION_DENIED', 14: 'FIRESTORE_UNAVAILABLE'})[error.code] || 'SNAPSHOT_FAILED';
}
async function recordJobFailure(db, root, error, now, runId) {
  const record = {at: now, runId, status: 'error', code: errorCode(error)};
  // No exception text, credential, balance or portfolio is sent to public job logs.
  console.error(JSON.stringify({...record, type: 'defense_snapshot_error'}));
  try {
    const batch = db.batch();
    batch.set(db.doc(root + '/jobErrors/' + runId), record);
    batch.set(db.doc(root + '/state/health'), {lastAttemptAt: now, status: 'error', code: record.code, runId}, {merge: true});
    await batch.commit();
  } catch {
    console.error(JSON.stringify({type: 'defense_error_log_fallback', at: now, runId, code: record.code, firestoreErrorRecordWritten: false}));
  }
  return record;
}
async function runSnapshotJob({db, root, market, now, runId = crypto.randomUUID(), persist = persistPlan}) {
  try {
    const quotes = typeof market === 'function' ? await market() : market;
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = await loadState(db, root), plan = planDaily({...state, market: quotes, now});
      try {
        const result = await persist(db, root, plan, state.account.revision || 0);
        await db.doc(root + '/market/latest').set(quotes);
        return {status: 'ok', date: plan.observation.date, ...result, issues: plan.observation.quality.length};
      } catch (error) {
        if (!['ACCOUNT_CHANGED', 'LEDGER_CHANGED'].includes(error.message) || attempt === 2) throw error;
      }
    }
  } catch (error) {
    const record = await recordJobFailure(db, root, error, new Date().toISOString(), runId);
    throw new Error(record.code);
  }
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
  console.log(JSON.stringify(await runSnapshotJob({db, root, market: () => fetchMarket(now), now})));
}
if (require.main === module) main().catch(error => {
  const safe = ['SETUP_REQUIRED', 'ACCOUNT_CHANGED', 'LEDGER_CHANGED', 'NEWER_OBSERVATION_EXISTS', 'SNAPSHOT_FAILED',
    'WRITE_DISABLED', 'PRODUCTION_GUARD', 'CREDENTIAL_UNAVAILABLE', 'DRY_RUN_REQUIRES_FIXTURE'].includes(error.message) ? error.message : 'DEFENSE_JOB_FAILED';
  console.error(safe); process.exitCode = 1;
});
module.exports = {digest, planDaily, persistPlan, loadState, runSnapshotJob, recordJobFailure};
