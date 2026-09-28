'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const C = require('../defense-core.js'), F = require('./defense-fixtures.cjs');
const L = require('../defense-ledger.js'), LF = require('./defense-ledger-fixtures.cjs');
function setup(mode = 'preview', hostname = 'preview.invalid') {
  let resolveReady, reads = 0;
  const db = new Map(), ready = new Promise(r => { resolveReady = r; });
  const doc = (_, p) => ({path: p}), collection = doc;
  const snap = p => ({id: p.split('/').at(-1), exists: () => db.has(p), data: () => structuredClone(db.get(p))});
  const getDoc = async r => { reads++; return snap(r.path); };
  const getDocs = async r => { reads++; return {docs: [...db.keys()].filter(p => p.startsWith(r.path + '/') &&
    p.slice(r.path.length + 1).indexOf('/') === -1).map(snap)}; };
  const runTransaction = async (_, fn) => {
    const writes = [], result = await fn({get: getDoc, set: (r, v) => writes.push([r.path, structuredClone(v)])});
    writes.forEach(([p, v]) => db.set(p, v)); return result;
  };
  const writeBatch = () => { const writes = []; return {set: (r, v) => writes.push([r.path, structuredClone(v)]),
    commit: async () => { writes.forEach(([p, v]) => db.set(p, v)); }}; };
  const context = vm.createContext({window: {DefenseCore: C, DefenseLedger: L, DefenseConfig: {mode, strategyId: '0050-defense-v1',
    previewId: '0050-defense-candidate-v1'}, fbReady: ready, fbDb: {}},
    location: {hostname, pathname: '/txf-tracker/defense.html'}, doc, collection, getDoc, getDocs, runTransaction, writeBatch,
    setTimeout, clearTimeout, Blob, crypto: {randomUUID: crypto.randomUUID, subtle: crypto.webcrypto.subtle},
    Date: class extends Date { static now() { return Date.parse('2026-09-17T12:00:00Z'); } }, Uint8Array, btoa, atob, console});
  const source = fs.readFileSync(path.resolve(__dirname, '../defense-data.js'), 'utf8')
    .replace(/^import .*$/gm, '').replace(/^export /gm, '') + '\nglobalThis.api={load,saveAccount,saveExecution,loadAttachment,saveLedgerSeed,saveLedgerDay};';
  vm.runInContext(source, context);
  return {db, api: context.api, resolveReady, reads: () => reads, root: 'users/me/defensePreviews/0050-defense-candidate-v1'};
}
test('new data adapter waits for async auth and reads only isolated fourth-strategy namespace', async () => {
  const s = setup(), pending = s.api.load();
  assert.equal(s.reads(), 0); s.resolveReady('test-user');
  const data = await pending; assert.equal(data.account, null); assert.equal(data.snapshots.length, 0);
  const a = await s.api.saveAccount({...F.account(), revision: 0}, 0, [
    {kind: 'account_update', date: '2026-09-16'}, {kind: 'risk_below500', date: '2026-09-16'}]);
  assert.equal(a.revision, 1); assert.ok([...s.db.keys()].every(p => p.startsWith(s.root + '/')));
  assert.ok([...s.db.keys()].some(p => p.includes('/accountRevisions/')));
  assert.equal([...s.db.keys()].filter(p => p.includes('/events/')).length, 2);
});
test('client optimistic revision prevents stale browser overwrite and partial audit writes', async () => {
  const s = setup(); s.resolveReady('test-user');
  await s.api.saveAccount({...F.account(), revision: 0}, 0);
  const count = s.db.size;
  await assert.rejects(s.api.saveAccount({...F.account(), equity: 123}, 0), /另一裝置/);
  assert.equal(s.db.size, count); assert.equal(s.db.get(s.root + '/state/account').equity, 550000);
});
test('production namespace rejects non-production host before reading account documents', async () => {
  const s = setup('production', 'preview.invalid'); s.resolveReady('test-user');
  await assert.rejects(s.api.load(), /正式資料僅限/);
  assert.equal(s.reads(), 0);
});
test('execution save is idempotent; screenshot bytes round-trip with hash, no public repo/storage writes', async () => {
  const s = setup(); s.resolveReady('test-user');
  const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]); // Byte fixture, not a rendered image.
  const file = {name: 'book.png', type: 'image/png', size: bytes.length, arrayBuffer: async () => bytes.buffer};
  const raw = {...F.order(), abnormalThreshold: 1};
  const saved = await s.api.saveExecution(raw, [file]);
  assert.equal(saved.attachments.length, 1);
  const loaded = await s.api.loadAttachment(saved.attachments[0].id);
  assert.deepEqual(new Uint8Array(await loaded.blob.arrayBuffer()), bytes);
  const count = s.db.size;
  const again = await s.api.saveExecution(raw, [file]); assert.equal(again.attachments[0].sha256, saved.attachments[0].sha256);
  assert.equal(s.db.size, count);
  assert.equal([...s.db.keys()].filter(p => p.includes('/events/')).length, 2);
  assert.ok([...s.db.keys()].every(p => p.startsWith(s.root + '/')));
});
test('ledger adapter protects opening, rejects stale/future inputs and keeps one daily document on retry', async () => {
  const s = setup(); s.resolveReady('test-user');
  await s.api.saveLedgerSeed(LF.seed());
  await assert.rejects(s.api.saveLedgerSeed(LF.seed()), /不能覆寫/);
  await s.api.saveLedgerDay(LF.day(), 1);
  const size = s.db.size;
  await s.api.saveLedgerDay(LF.day(), 2);
  assert.equal(s.db.size, size);
  await assert.rejects(s.api.saveLedgerDay(LF.day(), 1), /另一裝置/);
  await assert.rejects(s.api.saveLedgerDay(LF.day('2026-09-18'), 2), /尚未發生/);
  const state = await s.api.load(); assert.equal(state.ledgerInputs.length, 1); assert.equal(state.ledgerRevision, 2);
});
