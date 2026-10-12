// 台指期主帳：0050 變速防守正式 Forward（唯讀）
// 實際部位只從 defenseUsers/{uid}/strategies/0050-defense-v1/state/account 讀取。
// 期貨價格優先使用正式 market/latest 的逐合約 mark；缺少時只回退帳戶核對 mark，絕不使用加權指數代替。
// 成本優先讀正式期貨交易帳本；users/me/positions 只保留切換前舊成本備份。
import { collection, doc, getDoc, getDocs } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

const MULT = Object.freeze({
  TX: 200, TXF: 200, '大台': 200,
  MTX: 50, MXF: 50, '小台': 50,
  TMF: 10, '微台': 10
});
const PRODUCT = Object.freeze({
  TX: 'TX', TXF: 'TX', '大台': 'TX',
  MTX: 'MTX', MXF: 'MTX', '小台': 'MTX',
  TMF: 'TMF', '微台': 'TMF'
});
const LEGACY_TYPE = Object.freeze({ TX: 'TXF', MTX: 'MXF', TMF: 'TMF' });
const STRATEGY_ID = '0050-defense-v1';

function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function canonicalProduct(value) {
  return PRODUCT[String(value || '').trim()] || null;
}

function defenseDoc(uid, group, id) {
  return doc(window.fbDb, 'defenseUsers', uid, 'strategies', STRATEGY_ID, group, id);
}

async function fetchStaticJson(path) {
  try {
    const r = await fetch(path + '?t=' + Date.now(), {cache: 'no-store'});
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function legacyPosCol() {
  return collection(window.fbDb, 'users', 'me', 'positions');
}

function legacyCostGroups(rows) {
  const groups = {};
  rows.forEach(row => {
    const product = canonicalProduct(row.type);
    const lots = Number(row.lots);
    const entry = finitePositive(row.entry_price);
    if (!product || !Number.isFinite(lots) || lots === 0 || entry === null) return;
    if (!groups[product]) groups[product] = { lots: 0, weighted: 0, weight: 0, dates: [], notes: [] };
    const g = groups[product];
    g.lots += lots;
    g.weighted += entry * Math.abs(lots);
    g.weight += Math.abs(lots);
    if (row.date) g.dates.push(String(row.date));
    if (row.note) g.notes.push(String(row.note));
  });
  Object.values(groups).forEach(g => {
    g.entry_price = g.weight > 0 ? g.weighted / g.weight : null;
    g.date = g.dates.sort()[0] || null;
    g.note = g.notes.filter(Boolean).join(' / ');
  });
  return groups;
}


function tradeLedgerGroups(state) {
  const groups = {};
  (Array.isArray(state?.openLots) ? state.openLots : []).forEach(row => {
    const product = canonicalProduct(row.product);
    const month = String(row.month || '');
    const lots = Number(row.lots);
    const entry = finitePositive(row.entryPrice ?? row.entry_price);
    if (!product || !/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(lots) || lots <= 0 || entry === null) return;
    const key = product + ':' + month;
    if (!groups[key]) groups[key] = { lots: 0, weighted: 0, weight: 0, dates: [] };
    const g = groups[key];
    g.lots += lots;
    g.weighted += entry * lots;
    g.weight += lots;
    if (row.openedAt) g.dates.push(String(row.openedAt).slice(0,10));
  });
  Object.values(groups).forEach(g => {
    g.entry_price = g.weight > 0 ? g.weighted / g.weight : null;
    g.date = g.dates.sort()[0] || null;
  });
  return groups;
}

async function loadMaster() {
  await window.fbReady;
  const uid = window.fbUid;
  if (!uid) throw new Error('Firebase 使用者尚未完成初始化');

  const [accountSnap, marketSnap, tradeStateSnap, legacySnap, futuresCache, fubon] = await Promise.all([
    getDoc(defenseDoc(uid, 'state', 'account')),
    getDoc(defenseDoc(uid, 'market', 'latest')),
    getDoc(defenseDoc(uid, 'state', 'tradeLedger')),
    getDocs(legacyPosCol()),
    fetchStaticJson('data/futures_market.json'),
    fetchStaticJson('data/fubon_market_data.json')
  ]);

  if (!accountSnap.exists()) {
    throw new Error('尚未建立 0050 變速防守正式帳戶，請先到策略頁核對帳戶');
  }

  const account = accountSnap.data() || {};
  const market = marketSnap.exists() ? (marketSnap.data() || {}) : null;
  const formal = Array.isArray(account.positions) ? account.positions : [];

  const fubonQuote = fubon?.schema_version === 1 ? fubon?.quote : null;
  const expectedDate = (
    fubonQuote?.symbol === '0050' &&
    fubonQuote?.isClose === true &&
    /^\d{4}-\d{2}-\d{2}$/.test(fubonQuote?.date || '')
  ) ? fubonQuote.date : null;
  const marketDate = /^\d{4}-\d{2}-\d{2}$/.test(market?.date || '') ? market.date : null;
  const acceptedDate = expectedDate || marketDate;

  const quotes = new Map();
  if (futuresCache?.schema_version === 1 && futuresCache?.date === acceptedDate) {
    (Array.isArray(futuresCache.rows) ? futuresCache.rows : []).forEach(q => {
      const product = canonicalProduct(q.product);
      const month = String(q.month || '');
      const mark = finitePositive(q.mark);
      if (product && month && mark !== null && q.date === acceptedDate) {
        quotes.set(product + ':' + month, {...q, cache: 'futures_market.json'});
      }
    });
  }
  if (marketDate === acceptedDate) {
    (Array.isArray(market?.futures) ? market.futures : []).forEach(q => {
      const product = canonicalProduct(q.product);
      const month = String(q.month || '');
      const mark = finitePositive(q.mark);
      const key = product + ':' + month;
      if (product && month && mark !== null && q.date === acceptedDate && !quotes.has(key)) {
        quotes.set(key, {...q, cache: 'firestore-market-latest'});
      }
    });
  }

  const tradeState = tradeStateSnap.exists() ? (tradeStateSnap.data() || {}) : null;
  const ledgerGroups = tradeLedgerGroups(tradeState);

  const legacyRows = [];
  legacySnap.forEach(d => legacyRows.push({ id: d.id, ...d.data() }));
  const legacyGroups = legacyCostGroups(legacyRows);

  const formalCounts = {};
  formal.forEach(p => {
    const product = canonicalProduct(p.product);
    if (product) formalCounts[product] = (formalCounts[product] || 0) + 1;
  });

  const positions = formal.map((p, index) => {
    const product = canonicalProduct(p.product);
    if (!product) throw new Error('0050 變速防守帳戶含未知期貨商品');

    const month = String(p.month || '');
    const lots = Number(p.lots);
    const accountMark = finitePositive(p.mark);
    const quote = quotes.get(product + ':' + month) || null;
    const quoteMark = finitePositive(quote?.mark);
    const currentPrice = quoteMark ?? accountMark;
    const accountDate = /^\d{4}-\d{2}-\d{2}$/.test(account.equityDate || '')
      ? account.equityDate
      : (typeof account.asof === 'string' ? account.asof.slice(0, 10) : null);
    const priceFresh = quoteMark !== null && (!acceptedDate || quote?.date === acceptedDate);

    const ledger = ledgerGroups[product + ':' + month] || null;
    const legacy = legacyGroups[product] || null;
    const ledgerCostValid = Boolean(
      tradeState &&
      ledger &&
      Number.isFinite(lots) &&
      ledger.lots === lots &&
      finitePositive(ledger.entry_price) !== null
    );
    const legacyCostValid = Boolean(
      !tradeState &&
      formalCounts[product] === 1 &&
      legacy &&
      Number.isFinite(lots) &&
      legacy.lots === lots &&
      finitePositive(legacy.entry_price) !== null
    );
    const costValid = ledgerCostValid || legacyCostValid;
    const costRow = ledgerCostValid ? ledger : legacy;

    return {
      id: product + ':' + month + ':' + index,
      product,
      type: LEGACY_TYPE[product],
      month,
      lots,
      entry_price: costValid ? costRow.entry_price : null,
      cost_valid: costValid,
      cost_source: ledgerCostValid ? 'futures-trade-ledger' : (legacyCostValid ? 'legacy-readonly-backup' : 'unavailable'),
      reference_price: accountMark,
      current_price: currentPrice,
      price_fresh: priceFresh,
      price_date: quoteMark !== null ? (quote?.date || acceptedDate || null) : accountDate,
      expected_price_date: acceptedDate,
      price_source: quoteMark !== null
        ? (quote?.source || 'TAIFEX正式逐合約結算價')
        : (accountMark !== null
          ? ('0050變速防守帳戶核對價' + (acceptedDate && accountDate !== acceptedDate ? '（待當日TAIFEX結算價）' : ''))
          : 'missing'),
      price_at: quoteMark !== null ? (quote?.markAt || futuresCache?.updated_at || market?.updatedAt || null) : (account.asof || null),
      date: costValid ? (costRow?.date || account.equityDate || '') : (account.equityDate || ''),
      note: ledgerCostValid ? '期貨成交帳本成本' : (legacyCostValid ? (legacy.note || '舊成本唯讀備份') : '交易帳本與正式主帳待核對'),
      readonly: true
    };
  });

  return {
    account,
    market,
    positions,
    source: '0050變速防守正式 Forward',
    strategyId: STRATEGY_ID,
    expectedPriceDate: acceptedDate,
    futuresCache,
    costMatched: positions.every(p => p.cost_valid || !p.lots),
    priceFresh: positions.every(p => !p.lots || p.price_fresh),
    tradeLedger: tradeState
  };
}

window.fetchFuturesMaster = loadMaster;
window.fetchPositions = async function() {
  return (await loadMaster()).positions;
};

// 主帳只能在 0050 變速防守「核對帳戶」修改。
async function readonlyWrite() {
  throw new Error('台指期主帳已統一由「0050變速防守 → 核對帳戶」管理');
}
window.addPositionFS = readonlyWrite;
window.updatePositionFS = readonlyWrite;
window.deletePositionFS = readonlyWrite;

window.calcPnl = function(pos) {
  const current = finitePositive(pos?.current_price);
  const entry = finitePositive(pos?.entry_price);
  const mult = MULT[pos?.product] || MULT[pos?.type];
  const lots = Number(pos?.lots);
  if (current === null || entry === null || !mult || !Number.isFinite(lots)) return null;
  return Math.round((current - entry) * mult * lots);
};

window.CONTRACT_MULT = MULT;
