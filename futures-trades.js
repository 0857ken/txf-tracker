import './firebase-init.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import { applyTrade, summarizeOpenLots } from './futures-trade-core.mjs';

const STRATEGY_ID = '0050-defense-v1';
const $ = id => document.getElementById(id);

function strategyDoc(uid, group, id) {
  return doc(window.fbDb, 'defenseUsers', uid, 'strategies', STRATEGY_ID, group, id);
}

function tradesCol(uid) {
  return collection(window.fbDb, 'defenseUsers', uid, 'strategies', STRATEGY_ID, 'trades');
}

function tradeDoc(uid, id) {
  return doc(window.fbDb, 'defenseUsers', uid, 'strategies', STRATEGY_ID, 'trades', id);
}

function realizedDoc(id) {
  return doc(window.fbDb, 'users', 'me', 'realizedPnl', id);
}

function fmtPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString(undefined, {maximumFractionDigits: 2}) : '—';
}

function labelProduct(product) {
  return ({TX:'TXF 大台', MTX:'MXF 小台', TMF:'TMF 微台'})[product] || product;
}

function localIso(date) {
  return date + 'T12:00:00+08:00';
}

async function loadContext(uid) {
  const [stateSnap, accountSnap, tradeSnap] = await Promise.all([
    getDoc(strategyDoc(uid, 'state', 'tradeLedger')),
    getDoc(strategyDoc(uid, 'state', 'account')),
    getDocs(tradesCol(uid))
  ]);
  const state = stateSnap.exists() ? stateSnap.data() : null;
  const account = accountSnap.exists() ? accountSnap.data() : null;
  const trades = [];
  tradeSnap.forEach(d => trades.push({id:d.id, ...d.data()}));
  trades.sort((a,b) => String(b.at || b.date || '').localeCompare(String(a.at || a.date || '')));
  return {state, account, trades};
}

function formalSummary(account) {
  const map = new Map();
  (account?.positions || []).forEach(p => {
    const key = p.product + ':' + p.month;
    map.set(key, (map.get(key) || 0) + Number(p.lots || 0));
  });
  return map;
}

function ledgerSummary(state) {
  const map = new Map();
  summarizeOpenLots(state?.openLots || []).forEach(p => {
    map.set(p.product + ':' + p.month, p);
  });
  return map;
}

function sameLots(account, state) {
  const a = formalSummary(account), b = ledgerSummary(state);
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys].every(k => Number(a.get(k) || 0) === Number(b.get(k)?.lots || 0));
}

function renderOpenLots(state) {
  const el = $('simple-trade-open-lots');
  if (!el) return;
  if (!state) {
    el.innerHTML = '<div class="muted">交易帳本尚未初始化。</div>';
    return;
  }
  const rows = summarizeOpenLots(state.openLots || []);
  if (!rows.length) {
    el.innerHTML = '<div class="muted">交易帳本目前沒有多單。</div>';
    return;
  }
  el.innerHTML = rows.map(r =>
    '<div class="metric-row"><span>' + labelProduct(r.product) + ' ' + r.month + '</span>' +
    '<strong>' + r.lots + '口 @ ' + fmtPrice(r.averageEntry) + '</strong></div>'
  ).join('');
}

function renderTrades(trades) {
  const el = $('simple-trade-list');
  if (!el) return;
  if (!trades.length) {
    el.innerHTML = '<div class="muted">起始日後尚無新成交。</div>';
    return;
  }
  el.innerHTML = trades.slice(0, 12).map(t => {
    const realized = Number.isFinite(Number(t.realizedGrossPnl))
      ? '｜已實現 ' + (Number(t.realizedGrossPnl) >= 0 ? '+' : '') + Number(t.realizedGrossPnl).toLocaleString() + '元'
      : '';
    return '<div class="execution-item" style="padding:10px 0;border-bottom:1px solid var(--border)">' +
      '<strong>' + (t.side === 'buy' ? '買進' : '賣出') + ' ' + labelProduct(t.product) + ' ' + t.month + '</strong>' +
      '<div class="muted">' + t.date + '｜' + t.lots + '口 @ ' + fmtPrice(t.price) + realized + '</div>' +
      (t.note ? '<div class="muted">' + String(t.note).replace(/[<>&]/g, '') + '</div>' : '') +
      '</div>';
  }).join('');
}

function renderStatus(account, state) {
  const el = $('simple-trade-reconcile');
  if (!el) return;
  if (!state) {
    el.textContent = '交易帳本尚未初始化';
    el.className = 'muted';
    return;
  }
  if (sameLots(account, state)) {
    el.textContent = '✅ 交易帳本口數與0050變速防守正式主帳一致';
    el.className = 'green';
  } else {
    el.innerHTML = '⚠️ 交易帳本口數與正式主帳不同，成交記錄完成後請到 <a href="#positions">核對帳戶</a> 更新總口數。';
    el.className = 'gold';
  }
}

function prefill(account) {
  const form = $('simple-trade-form');
  if (!form) return;
  const held = (account?.positions || [])[0] || null;
  if (held) {
    form.elements.product.value = held.product;
    form.elements.month.value = held.month;
  }
  if (!form.elements.date.value) {
    const d = new Date();
    const tw = new Date(d.getTime() + 8 * 3600000);
    form.elements.date.value = tw.toISOString().slice(0,10);
  }
}

async function render(uid) {
  const ctx = await loadContext(uid);
  renderOpenLots(ctx.state);
  renderTrades(ctx.trades);
  renderStatus(ctx.account, ctx.state);
  prefill(ctx.account);
  const form = $('simple-trade-form');
  if (form) {
    const enabled = Boolean(ctx.state);
    [...form.elements].forEach(el => { if (el.tagName !== 'BUTTON' || el.type === 'submit') el.disabled = !enabled; });
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = !enabled;
  }
}

async function saveTrade(uid, form) {
  const trade = {
    id: crypto.randomUUID(),
    date: form.elements.date.value,
    at: localIso(form.elements.date.value),
    product: form.elements.product.value,
    month: form.elements.month.value,
    side: form.elements.side.value,
    lots: Number(form.elements.lots.value),
    price: Number(form.elements.price.value),
    matchPolicy: form.elements.matchPolicy.value,
    fee: form.elements.fee.value === '' ? null : Number(form.elements.fee.value),
    tax: form.elements.tax.value === '' ? null : Number(form.elements.tax.value),
    note: form.elements.note.value.trim()
  };

  const stateRef = strategyDoc(uid, 'state', 'tradeLedger');
  const tRef = tradeDoc(uid, trade.id);
  const rRef = realizedDoc(trade.id);

  await runTransaction(window.fbDb, async tx => {
    const stateSnap = await tx.get(stateRef);
    if (!stateSnap.exists()) throw new Error('交易帳本尚未初始化');
    const state = stateSnap.data() || {};
    const result = applyTrade(state, trade);

    tx.set(stateRef, {
      schemaVersion: 1,
      cutoverDate: result.nextState.cutoverDate,
      revision: result.nextState.revision,
      lastTradeDate: result.nextState.lastTradeDate,
      openLots: result.nextState.openLots,
      updatedAt: serverTimestamp()
    }, {merge:true});

    tx.set(tRef, {
      schemaVersion: 1,
      date: trade.date,
      at: trade.at,
      product: trade.product,
      month: trade.month,
      side: trade.side,
      lots: trade.lots,
      price: trade.price,
      matchPolicy: trade.matchPolicy,
      fee: trade.fee,
      tax: trade.tax,
      note: trade.note,
      realizedGrossPnl: result.realized?.grossPnlTwd ?? null,
      matchedLots: result.realized?.matchedLots ?? [],
      pnlBasis: 'gross-before-fee-tax',
      createdAt: serverTimestamp()
    });

    if (result.realized) {
      tx.set(rRef, {
        date: trade.date,
        type: trade.product === 'TX' ? 'TXF' : trade.product === 'MTX' ? 'MXF' : 'TMF',
        month: trade.month,
        lots: result.realized.lots,
        entry_price: result.realized.weightedEntryPrice,
        exit_price: trade.price,
        pnl_twd: result.realized.grossPnlTwd,
        gross_pnl_twd: result.realized.grossPnlTwd,
        fee: trade.fee,
        tax: trade.tax,
        cost_complete: false,
        note: '期貨成交帳本自動產生；毛損益，費稅未自動扣除',
        source: 'futures-trade-ledger',
        trade_id: trade.id,
        matched_lots: result.realized.matchedLots,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp()
      });
    }
  });
}

async function init() {
  await window.fbReady;
  const form = $('simple-trade-form');
  if (!form) return;

  let currentUid = null;
  onAuthStateChanged(window.fbAuth, async user => {
    if (!user || user.isAnonymous) {
      currentUid = null;
      $('simple-trade-reconcile').textContent = '請先登入正式 Forward 帳戶';
      [...form.elements].forEach(el => el.disabled = true);
      return;
    }
    currentUid = user.uid;
    try { await render(currentUid); }
    catch (e) {
      console.error('成交帳本載入失敗', e);
      $('simple-trade-reconcile').textContent = '成交帳本載入失敗：' + e.message;
    }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!currentUid) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = '儲存中...';
    try {
      await saveTrade(currentUid, form);
      form.elements.lots.value = '';
      form.elements.price.value = '';
      form.elements.fee.value = '';
      form.elements.tax.value = '';
      form.elements.note.value = '';
      await render(currentUid);
      button.textContent = '記錄成交';
    } catch (e) {
      alert('成交紀錄失敗：' + e.message);
      button.textContent = '記錄成交';
    } finally {
      button.disabled = false;
    }
  });
}

init().catch(e => console.error('成交帳本初始化失敗', e));
