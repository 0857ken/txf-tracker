import './firebase-init.js';
import {doc, collection, getDoc, getDocs, runTransaction, writeBatch} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

const C = window.DefenseCore, L = window.DefenseLedger, config = window.DefenseConfig;
function timeout(p, ms = 15000) {
  let timer;
  return Promise.race([p, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('連線逾時，請保留輸入再重試')), ms); })])
    .finally(() => clearTimeout(timer));
}
function namespace() {
  if (config.mode === 'production') {
    if (location.hostname !== '0857ken.github.io' || !location.pathname.startsWith('/txf-tracker/'))
      throw new Error('正式資料僅限正式投資秘書網址存取');
    return 'defenseStrategies/' + config.strategyId;
  }
  if (config.mode !== 'preview') throw new Error('模式不明，停止連線');
  return 'defensePreviews/' + config.previewId;
}
function base() { return 'users/me/' + namespace(); }
function ref(group, id) { return doc(window.fbDb, base() + '/' + group + '/' + id); }
function col(group) { return collection(window.fbDb, base() + '/' + group); }
async function ready() {
  // Preserve asynchronous ES module / Firebase readiness, with a bounded error path.
  await timeout(window.fbReady);
  if (!window.fbDb) throw new Error('Firebase尚未完成初始化');
}
export async function load() {
  await ready();
  const [account, snapshots, executions, events, health, market, opening, inputs, ledgerDays, version] = await timeout(Promise.all([
    getDoc(ref('state', 'account')), getDocs(col('dailySnapshots')), getDocs(col('executions')),
    getDocs(col('events')), getDoc(ref('state', 'health')), getDoc(ref('market', 'latest')),
    getDoc(ref('ledgerSettings', 'opening')), getDocs(col('ledgerInputs')), getDocs(col('ledgerDaily')), getDoc(ref('state', 'ledgerVersion'))]));
  const list = s => s.docs.map(d => ({...d.data(), id: d.id}));
  return {account: account.exists() ? account.data() : null, snapshots: list(snapshots),
    executions: list(executions), events: list(events), health: health.exists() ? health.data() : null,
    market: market.exists() ? market.data() : null, ledgerSeed: opening.exists() ? opening.data() : null,
    ledgerInputs: list(inputs), ledgerDays: list(ledgerDays), ledgerRevision: version.exists() ? version.data().revision : 0};
}
export async function saveLedgerSeed(raw) {
  await ready(); const value = L.normalizeSeed(raw);
  return timeout(runTransaction(window.fbDb, async tx => {
    const [prior, version] = await Promise.all([tx.get(ref('ledgerSettings', 'opening')), tx.get(ref('state', 'ledgerVersion'))]);
    if (prior.exists()) throw new Error('期初帳本已建立，不能覆寫已開始的Forward；更正須另留版本');
    tx.set(ref('ledgerSettings', 'opening'), value);
    tx.set(ref('state', 'ledgerVersion'), {revision: (version.exists() ? version.data().revision : 0) + 1});
    return value;
  }));
}
export async function saveLedgerDay(raw, expectedRevision) {
  await ready(); const at = new Date().toISOString(), operationId = crypto.randomUUID();
  return timeout(runTransaction(window.fbDb, async tx => {
    const [opening, version, prior] = await Promise.all([tx.get(ref('ledgerSettings', 'opening')),
      tx.get(ref('state', 'ledgerVersion')), tx.get(ref('ledgerInputs', C.date(raw.date)))]);
    if (!opening.exists()) throw new Error('請先建立期初帳本');
    const revision = version.exists() ? version.data().revision : 0;
    if (revision !== expectedRevision) throw new Error('另一裝置已更新帳本或成交，請重新載入');
    const value = L.validateDay(raw, opening.data());
    if (C.timestamp(value.valuationAt) > Date.now()) throw new Error('不得保存尚未發生的日終行情');
    if (prior.exists() && JSON.stringify(prior.data()) === JSON.stringify(value)) return value;
    tx.set(ref('ledgerInputs', value.date), value);
    tx.set(ref('state', 'ledgerVersion'), {revision: revision + 1});
    tx.set(ref('events', operationId), {kind: 'ledger_input', date: value.date, at,
      detail: {before: prior.exists() ? prior.data() : null, after: value}});
    return value;
  }));
}
export async function saveAccount(value, expectedRevision, event = null, operationId = crypto.randomUUID()) {
  await ready();
  const valid = C.normalizeAccount(value), at = new Date().toISOString();
  return timeout(runTransaction(window.fbDb, async tx => {
    const current = await tx.get(ref('state', 'account'));
    const revision = current.exists() ? current.data().revision || 0 : 0;
    if (revision !== expectedRevision) throw new Error('另一裝置已更新帳戶，請重新載入再核對，避免覆蓋');
    const next = {...valid, revision: revision + 1, updatedAt: at};
    tx.set(ref('state', 'account'), next);
    tx.set(ref('accountRevisions', operationId), {at, before: current.exists() ? current.data() : null, after: next});
    const events = event ? (Array.isArray(event) ? event : [event]) : [];
    events.forEach((e, i) => tx.set(ref('events', operationId + (i ? '-' + i : '')),
      {...e, accountRevision: next.revision, recordedAt: at}));
    return next;
  }));
}
export async function saveExecution(raw, attachments = []) {
  await ready();
  const analyzed = C.analyzeExecution(raw);
  if (new Blob([JSON.stringify(raw)]).size > 600000) throw new Error('成交紀錄過大');
  const priorOrder = await timeout(getDoc(ref('executions', raw.id)));
  if (priorOrder.exists()) return priorOrder.data();
  // Original image bytes are split into bounded Firestore documents; no public storage.
  const metadata = [];
  for (const file of attachments) {
    if (file.size === 0) throw new Error('截圖檔案不可為空');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('截圖請使用PNG、JPEG或WebP');
    if (file.size > 10000000) throw new Error('每張截圖上限10MB');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    const id = raw.id + '-' + hash;
    const parts = [];
    for (let start = 0; start < bytes.length; start += 300000) {
      const chunk = bytes.subarray(start, start + 300000);
      let binary = '';
      for (let i = 0; i < chunk.length; i += 8192) binary += String.fromCharCode(...chunk.subarray(i, i + 8192));
      parts.push(btoa(binary));
    }
    const meta = {id, name: file.name, mime: file.type, size: file.size, sha256: hash, chunks: parts.length};
    for (let start = 0; start < parts.length; start += 20) {
      const batch = writeBatch(window.fbDb);
      parts.slice(start, start + 20).forEach((data, offset) => batch.set(doc(window.fbDb, base() + '/attachments/' + id + '/chunks/' + String(start + offset).padStart(4, '0')), {data}));
      if (start + 20 >= parts.length) batch.set(ref('attachments', id), meta);
      await timeout(batch.commit(), 45000);
    }
    metadata.push(meta);
  }
  return timeout(runTransaction(window.fbDb, async tx => {
    const executionRef = ref('executions', raw.id);
    const existing = await tx.get(executionRef);
    if (existing.exists()) return existing.data();
    const version = await tx.get(ref('state', 'ledgerVersion'));
    const value = {...raw, attachments: metadata, recordedAt: new Date().toISOString(), formulaVersion: C.VERSION};
    tx.set(executionRef, value);
    tx.set(ref('state', 'ledgerVersion'), {revision: (version.exists() ? version.data().revision : 0) + 1});
    tx.set(ref('events', raw.id), {kind: raw.kind === 'roll' ? 'roll' : 'rebalance', at: raw.orderedAt, date: raw.tradeDate,
      executionId: raw.id, detail: {product: raw.product, lots: analyzed.filledLots}});
    const threshold = raw.abnormalThreshold;
    if (C.finite(threshold) && analyzed.arrivalSlippage > threshold)
      tx.set(ref('events', raw.id + '-slippage'), {kind: 'abnormal_slippage', at: raw.orderedAt, date: raw.tradeDate,
        executionId: raw.id, detail: {arrivalSlippage: analyzed.arrivalSlippage, threshold}});
    return value;
  }));
}
export async function loadAttachment(id) {
  await ready();
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('截圖ID無效');
  const [meta, chunks] = await Promise.all([getDoc(ref('attachments', id)),
    getDocs(collection(window.fbDb, base() + '/attachments/' + id + '/chunks'))]);
  if (!meta.exists()) throw new Error('找不到截圖');
  const m = meta.data(), data = chunks.docs.sort((a, b) => a.id.localeCompare(b.id)).map(d => d.data().data);
  if (data.length !== m.chunks) throw new Error('截圖片段不足');
  const arrays = data.map(s => Uint8Array.from(atob(s), c => c.charCodeAt(0)));
  const blob = new Blob(arrays, {type: m.mime});
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== m.sha256) throw new Error('截圖校驗失敗');
  return {blob, name: m.name};
}
