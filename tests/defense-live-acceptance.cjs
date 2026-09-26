'use strict';
// Explicitly authorized round3 writes, isolated synthetic namespace in REAL project.
// Only GitHub runner reads existing FIREBASE_KEY; it is never exported or logged.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {createRequire} = require('node:module');
const req = createRequire(path.resolve(__dirname, '../tools/defense-runner/package.json'));
const {initializeApp, cert, deleteApp} = req('firebase-admin/app'), {getFirestore} = req('firebase-admin/firestore');
const {runSnapshotJob} = require('../scripts/defense-snapshot.cjs');
const F = require('./defense-realistic-fixture.cjs');
async function main() {
  assert.equal(process.env.DEFENSE_LIVE_ACCEPTANCE, 'round3-authorized');
  assert.equal(process.env.GITHUB_REPOSITORY, '0857ken/txf-tracker');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/feature/0050-defense-forward');
  assert.equal(process.env.GITHUB_EVENT_NAME, 'push');
  assert.ok(!process.env.FIRESTORE_EMULATOR_HOST, 'REAL Firestore required');
  if (!process.env.FIREBASE_KEY) throw new Error('CREDENTIAL_UNAVAILABLE');
  const run = process.env.GITHUB_RUN_ID + '-' + process.env.GITHUB_RUN_ATTEMPT;
  assert.match(run, /^\d+-\d+$/);
  const credential = JSON.parse(process.env.FIREBASE_KEY);
  assert.equal(credential.project_id, 'txf-tracker', 'Wrong Firestore project');
  const app = initializeApp({credential: cert(credential)}), db = getFirestore(app);
  // No configurable root: this test cannot select production strategy or legacy account docs.
  const root = 'users/me/defensePreviews/round3-live-' + run, base = db.doc(root);
  const actualStartedAt = new Date().toISOString();
  await base.create({datasetKind: 'synthetic_acceptance_real_firestore', actualStartedAt, run,
    replayDate: F.indexReference.date, noRealAccountData: true});
  await base.collection('state').doc('account').create(F.account());
  const clock = '2026-09-16T06:01:00Z'; // Labeled historical fixture clock, NOT claimed current EOD.
  const invoke = () => runSnapshotJob({db, root, market: F.market(), now: clock});
  const first = await invoke(), retry = await invoke();
  assert.equal(first.written, true); assert.equal(retry.duplicate, true);
  const before = (await base.collection('dailySnapshots').get()).size; assert.equal(before, 1);
  for (const [id, kind] of [['event-one', 'account_update'], ['event-two', 'margin_topup']])
    await base.collection('events').doc(id).create({id, kind, date: F.indexReference.date, at: clock, amount: 0, acceptanceOnly: true});
  await invoke(); // New events may produce new observation, but never another canonical day.
  const day = await base.collection('dailySnapshots').get(); assert.equal(day.size, 1);
  const eventDocs = await base.collection('events').get();
  assert.ok(eventDocs.docs.some(d => d.id === 'event-one')); assert.ok(eventDocs.docs.some(d => d.id === 'event-two'));
  // Firestore itself rejects a create to an existing acceptance-only document (code 6).
  const probe = base.collection('acceptanceProbe').doc('write-once'); await probe.create({acceptanceOnly: true});
  await assert.rejects(runSnapshotJob({db, root, market: F.market(), now: clock, runId: 'expected-write-failure',
    persist: async () => probe.create({acceptanceOnly: true})}), /WRITE_ALREADY_EXISTS/);
  const error = await base.collection('jobErrors').doc('expected-write-failure').get();
  const health = await base.collection('state').doc('health').get();
  assert.equal(error.data().code, 'WRITE_ALREADY_EXISTS'); assert.equal(health.data().status, 'error');
  const output = {datasetKind: 'synthetic_acceptance_real_firestore', noEmulator: true, root, run,
    actualStartedAt, actualFinishedAt: new Date().toISOString(), trigger: process.env.GITHUB_EVENT_NAME,
    replayDate: F.indexReference.date, replayClock: clock,
    dailyRunnerExecuted: true, cronScheduleTriggered: false,
    checks: {firstWrite: first.written, identicalRetry: retry.duplicate, dailyDocumentCount: day.size,
      sameDayEventCount: eventDocs.docs.filter(d => d.data().date === F.indexReference.date).length,
      actualServerWriteFailure: error.data(), failureHealth: health.data()},
    // All documents read are created by this synthetic acceptance run; no existing private account reads.
    dailyReadback: day.docs.map(d => ({id: d.id, ...d.data()}))};
  fs.mkdirSync('test-results', {recursive: true});
  fs.writeFileSync('test-results/defense-live-round3.json', JSON.stringify(output, null, 2));
  console.log(JSON.stringify({status:'PASS',run,root,dailyDocumentCount:day.size,sameDayEvents:output.checks.sameDayEventCount,
    actualServerWriteFailure:'WRITE_ALREADY_EXISTS',dailyRunnerExecuted:true,cronScheduleTriggered:false}));
  await db.terminate(); await deleteApp(app);
}
main().catch(() => { console.error('LIVE_ACCEPTANCE_FAILED: see safe step status; credentials and raw exceptions suppressed'); process.exitCode = 1; });
