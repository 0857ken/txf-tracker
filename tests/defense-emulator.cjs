'use strict';
// Real Admin SDK transactions against a local demo emulator, never production.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {createRequire} = require('node:module');
const sdk = createRequire(path.resolve(__dirname, '../tools/defense-runner/package.json'));
const {initializeApp, deleteApp} = sdk('firebase-admin/app'), {getFirestore} = sdk('firebase-admin/firestore');
const {planDaily, persistPlan, loadState} = require('../scripts/defense-snapshot.cjs');
const F = require('./defense-fixtures.cjs'), LF = require('./defense-ledger-fixtures.cjs');
async function main() {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8089', 'Emulator host must be explicit');
  const app = initializeApp({projectId: 'demo-txf-defense'}), db = getFirestore(app);
  const root = 'users/acceptance/defensePreviews/round2', base = db.doc(root);
  const account = {...F.account(), asof: LF.seed().at};
  await base.collection('state').doc('account').set(account);
  await base.collection('ledgerSettings').doc('opening').set(LF.seed());
  await base.collection('ledgerInputs').doc('2026-09-16').set(LF.day());
  const order = LF.sample().orders[0];
  await base.collection('executions').doc(order.id).set(order);
  const make = async (now = '2026-09-16T06:01:00Z') => planDaily({...await loadState(db, root), market: F.market(), now});
  const first = await make();
  assert.equal(first.ledger.rows[0].status, 'complete');
  const writes = await Promise.all([persistPlan(db, root, first, 1), persistPlan(db, root, first, 1)]);
  assert.equal(writes.filter(x => x.written).length, 1);
  assert.equal((await persistPlan(db, root, await make('2026-09-16T07:00:00Z'), 1)).duplicate, true);
  assert.equal((await base.collection('dailySnapshots').get()).size, 1);
  assert.equal((await base.collection('observations').get()).size, 1);
  assert.equal((await base.collection('ledgerDaily').get()).size, 1);
  const prior = await make('2026-09-16T07:01:00Z');
  await base.collection('state').doc('ledgerVersion').set({revision: 1});
  await assert.rejects(persistPlan(db, root, prior, 1), /LEDGER_CHANGED/);
  await base.collection('ledgerInputs').doc('2026-09-16').update({brokerEquity: 554583.006, brokerOutside: 1450000});
  const corrected = await make('2026-09-16T07:02:00Z');
  assert.equal(corrected.ledger.rows[0].actual.reconciled, true);
  assert.equal((await persistPlan(db, root, corrected, 1)).written, true);
  assert.equal((await base.collection('dailySnapshots').get()).size, 1);
  assert.equal((await base.collection('observations').get()).size, 2);
  const collections = {};
  for (const name of ['dailySnapshots', 'observations', 'events', 'ledgerDaily', 'monthlyReviews']) {
    collections[name] = (await base.collection(name).get()).docs.map(d => ({id: d.id, ...d.data()}));
  }
  assert.equal(collections.dailySnapshots[0].ledger.actual.reconciled, true);
  assert.equal(collections.ledgerDaily[0].theory.mtmPnl, 5000);
  assert.equal(collections.ledgerDaily[0].actual.mtmPnl, 4700);
  fs.mkdirSync(path.resolve(__dirname, '../test-results'), {recursive: true});
  fs.writeFileSync(path.resolve(__dirname, '../test-results/defense-firestore-example.json'), JSON.stringify({
    label: 'SYNTHETIC ACCEPTANCE: real writes/readback in local Firestore emulator, not production',
    project: 'demo-txf-defense', root, checks: {concurrentWrites: 'PASS', identicalRetry: 'PASS',
      staleLedgerRevision: 'PASS', correctedDayCount: 1, auditObservations: 2}, collections}, null, 2));
  console.log('PASS: emulator concurrent/idempotent writes, revision guard, correction audit, full ledger readback');
  await db.terminate(); await deleteApp(app);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
