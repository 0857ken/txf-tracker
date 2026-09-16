'use strict';
// DOM unit tests, NOT a browser/layout/iPhone rendering test.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {createRequire} = require('node:module'), crypto = require('node:crypto');
const req = createRequire(path.resolve(__dirname, '../tools/defense-runner/package.json'));
const {JSDOM, VirtualConsole} = req('jsdom');
const F = require('./defense-fixtures.cjs');
async function until(condition) {
  for (let i = 0; i < 200; i++) { if (condition()) return; await new Promise(r => setTimeout(r, 5)); }
  throw new Error('UI state did not settle');
}
async function page(saved) {
  const html = fs.readFileSync(path.resolve(__dirname, '../test-results/defense-preview.html'), 'utf8'), errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(html, {url: 'https://local-unit-test.invalid/', runScripts: 'dangerously', virtualConsole: vc,
    beforeParse(w) {
      w.crypto.randomUUID = crypto.randomUUID;
      w.HTMLElement.prototype.scrollIntoView = function () {};
      w.fetch = () => { throw new Error('UNEXPECTED_NETWORK'); };
      if (saved) w.localStorage.setItem('txf-defense-preview-v1', saved);
    }});
  await until(() => dom.window.DefenseUI || dom.window.document.querySelector('#notice.error'));
  assert.ok(dom.window.DefenseUI, dom.window.document.getElementById('notice').textContent);
  return {dom, w: dom.window, d: dom.window.document, errors};
}
test('preview DOM creates eight sections, four stress cards and no fabricated Forward history; no external data access', async () => {
  const {dom, w, d, errors} = await page();
  try {
    assert.equal(d.querySelectorAll('main>section').length, 8); assert.equal(d.querySelectorAll('.stress-card').length, 4);
    assert.equal(w.DefenseUI.getState().snapshots.length, 0);
    assert.match(d.querySelector('#forward-content').textContent, /等待真正 Forward/);
    assert.equal(d.querySelector('#execution-form').elements.screenshots.disabled, true);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});
test('account and funding form flows recompute known 490→550 funding gap and conserve total equity on transfer', async () => {
  const {dom, w, d} = await page();
  try {
    const f = d.getElementById('account-form');
    for (const [key, value] of Object.entries({equity: '490000', outside: '1000', initialMargin: '100000', maintenanceMargin: '75000'})) f.elements[key].value = value;
    f.dispatchEvent(new w.Event('submit', {bubbles: true, cancelable: true}));
    await until(() => w.DefenseUI.getSnapshot().risk.topUp === 60000);
    await until(() => !d.querySelector('#transfer-form button[type="submit"]').disabled);
    assert.equal(w.DefenseUI.getSnapshot().risk.fundingShortfall, 59000);
    assert.equal(w.DefenseUI.getState().events.filter(e => e.kind === 'risk_below500').length, 1);
    const transfer = d.getElementById('transfer-form'); transfer.elements.amount.value = '1000';
    transfer.dispatchEvent(new w.Event('submit', {bubbles: true, cancelable: true}));
    await until(() => w.DefenseUI.getSnapshot().outside === 0);
    assert.equal(w.DefenseUI.getSnapshot().totalEquity, 491000);
    const saved = w.localStorage.getItem('txf-defense-preview-v1');
    const reloaded = await page(saved);
    try { assert.equal(reloaded.w.DefenseUI.getState().account.outside, 0); } finally { reloaded.dom.window.close(); }
  } finally { dom.window.close(); }
});
test('execution form captures partial fills, price changes, five levels, slippage and anomaly; unsafe notes are escaped', async () => {
  const {dom, w, d} = await page(), o = F.order();
  try {
    const f = d.getElementById('execution-form');
    const fields = {kind: 'roll', product: 'MTX', side: 'buy', nearMonth: '2026-09', farMonth: '2026-10', requestedLots: '4',
      orderedAt: '2026-09-16T13:20:01', bookAt: '2026-09-16T13:20:00', firstLimit: '-20', abnormalThreshold: '1',
      revisions: o.revisions.map(r => r.at.slice(0, 19) + ', ' + r.price).join('\n'),
      fills: o.fills.map(r => [r.at.slice(0, 19), r.price, r.lots, r.fee, r.tax].join(', ')).join('\n'),
      note: '<img src=x onerror="window.badInjection=true">'};
    for (const [key, value] of Object.entries(fields)) f.elements[key].value = value;
    for (const [side, levels] of [['bid', o.bids], ['ask', o.asks]]) levels.forEach((l, i) => {
      f.elements[side + '-price-' + (i + 1)].value = l.price; f.elements[side + '-lots-' + (i + 1)].value = l.lots;
    });
    f.dispatchEvent(new w.Event('submit', {bubbles: true, cancelable: true}));
    await until(() => w.DefenseUI.getState().executions.length === 1);
    const state = w.DefenseUI.getState(), result = w.DefenseCore.analyzeExecution(state.executions[0]);
    assert.equal(result.arrivalSlippage, 1.75); assert.equal(result.rollSpreadCash, -3450);
    assert.equal(result.averageWaitSeconds, 6); assert.equal(state.events.filter(e => e.kind === 'abnormal_slippage').length, 1);
    assert.equal(d.querySelectorAll('#execution-list img').length, 0); assert.equal(w.badInjection, undefined);
    assert.equal(state.account.positions.length, 2); // Logging an execution never silently overwrites holdings.
  } finally { dom.window.close(); }
});
