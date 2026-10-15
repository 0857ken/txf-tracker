'use strict';
const path = require('node:path');
const {createRequire} = require('node:module');
const req = createRequire(path.resolve('prod/tools/defense-runner/package.json'));
const {initializeApp, cert} = req('firebase-admin/app');
const {getFirestore} = req('firebase-admin/firestore');
const OP = 'manual-confirmed-flat-tmf-20261015';

async function main() {
  if (!process.env.FIREBASE_KEY) throw new Error('CREDENTIAL_UNAVAILABLE');
  const credentials = JSON.parse(process.env.FIREBASE_KEY);
  if (credentials.project_id !== 'txf-tracker') throw new Error('WRONG_PROJECT');
  initializeApp({credential: cert(credentials)});
  const db = getFirestore();
  const owner = await db.doc('strategy4System/owner').get();
  if (!owner.exists || !owner.data()?.uid) throw new Error('OWNER_MISSING');
  const root = 'defenseUsers/' + owner.data().uid + '/strategies/0050-defense-v1';
  const accountRef = db.doc(root + '/state/account');
  const revisionRef = db.doc(root + '/accountRevisions/' + OP);
  const eventRef = db.doc(root + '/events/' + OP);
  const statementRef = db.doc(root + '/events/broker-fifo-statement-20261012-20261016-20261015');

  const result = await db.runTransaction(async tx => {
    const [accountSnap, previousOp, eventSnap, statement] = await Promise.all([
      tx.get(accountRef), tx.get(revisionRef), tx.get(eventRef), tx.get(statementRef)
    ]);
    if (!accountSnap.exists) throw new Error('ACCOUNT_MISSING');
    const a = accountSnap.data() || {};
    if (previousOp.exists && eventSnap.exists) {
      return {status: 'already-applied', revision: a.revision, positions: a.positions || [],
        initialMargin: a.initialMargin, maintenanceMargin: a.maintenanceMargin};
    }
    if (previousOp.exists || eventSnap.exists) throw new Error('PARTIAL_PRIOR_OPERATION');
    if (!statement.exists || statement.data()?.detail?.totals?.incrementalNet !== 34201)
      throw new Error('LATEST_STATEMENT_NOT_CONFIRMED');
    if (a.revision !== 7) throw new Error('REVISION_CHANGED_' + a.revision);
    const p = Array.isArray(a.positions) && a.positions.length === 1 ? a.positions[0] : null;
    if (!p || p.product !== 'TMF' || p.month !== '2026-10' || Number(p.lots) !== 1 || Number(p.mark) !== 49357)
      throw new Error('POSITION_CHANGED');
    if (Number(a.initialMargin) !== 70100 || Number(a.maintenanceMargin) !== 53800)
      throw new Error('TOTAL_MARGIN_CHANGED');
    if (Number(a.marginReference?.initial) !== 70100 ||
        Number(a.marginReference?.maintenance) !== 53800 ||
        a.marginReference?.brokerOverride)
      throw new Error('REFERENCE_MARGIN_CHANGED');
    if (Number(a.equity) !== 450000 || Number(a.outside) !== 550000)
      throw new Error('CAPITAL_CHANGED');

    const at = new Date().toISOString();
    const before = JSON.parse(JSON.stringify(a));
    const next = {...a,
      positions: [],
      initialMargin: 0,
      maintenanceMargin: 0,
      marginReference: {...a.marginReference, initial: 0, maintenance: 0},
      positionSource: 'manual_confirmed',
      positionVerifiedAt: at,
      revision: 8,
      updatedAt: at
    };
    tx.set(accountRef, next);
    tx.set(revisionRef, {at, before, after: next,
      operation: 'manual_confirmed_flat_position_correction',
      source: 'user_explicit_inventory_confirmation'});
    tx.set(eventRef, {kind: 'account_update', date: '2026-10-15', at, recordedAt: at,
      accountRevision: next.revision,
      detail: {product: 'TMF', month: '2026-10', beforeLots: 1, afterLots: 0,
        beforeInitialMargin: 70100, afterInitialMargin: 0,
        beforeMaintenanceMargin: 53800, afterMaintenanceMargin: 0,
        positionSource: 'manual_confirmed',
        statementId: 'broker-fifo-statement-20261012-20261016-20261015',
        note: 'User explicitly confirmed current inventory is zero. Closed FIFO statement was recorded separately and was not used to infer zero inventory; no duplicate fills, slippage, or broker positions created. Equity and outside remain last confirmed values.'}});
    return {status: 'updated', revision: 8, positions: next.positions,
      initialMargin: next.initialMargin, maintenanceMargin: next.maintenanceMargin,
      marginReference: {initial: next.marginReference.initial,
        maintenance: next.marginReference.maintenance},
      equity: next.equity, outside: next.outside,
      positionSource: next.positionSource, accountUpdatedAt: at};
  });
  console.log(JSON.stringify(result, null, 2));
}
main().catch(err => {console.error(err.message); process.exitCode = 1;});
