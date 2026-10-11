export const MULT = Object.freeze({ TX: 200, MTX: 50, TMF: 10 });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function finitePositive(value, label) {
  const n = Number(value);
  assert(Number.isFinite(n) && n > 0, label + '必須大於0');
  return n;
}

function integerPositive(value, label) {
  const n = Number(value);
  assert(Number.isInteger(n) && n > 0, label + '必須為正整數');
  return n;
}

function normalizeLot(raw) {
  const product = String(raw.product || '').trim();
  const month = String(raw.month || '').trim();
  const lots = integerPositive(raw.lots, '持倉口數');
  const entryPrice = finitePositive(raw.entryPrice ?? raw.entry_price, '成本價');
  const openedAt = String(raw.openedAt || raw.opened_at || raw.openedDate || raw.opened_date || '');
  assert(MULT[product], '未知期貨商品');
  assert(/^\d{4}-\d{2}$/.test(month), '合約月份格式錯誤');
  assert(openedAt, '持倉開倉時間不可空白');
  return {
    id: String(raw.id || ''),
    product,
    month,
    lots,
    entryPrice,
    openedAt,
    tag: String(raw.tag || 'trade')
  };
}

export function normalizeState(raw) {
  const state = raw || {};
  const cutoverDate = String(state.cutoverDate || state.cutover_date || '');
  assert(validDate(cutoverDate), '交易帳本起始日格式錯誤');
  const openLots = Array.isArray(state.openLots) ? state.openLots.map(normalizeLot) : [];
  return {
    schemaVersion: 1,
    cutoverDate,
    revision: Number.isInteger(state.revision) ? state.revision : 0,
    openLots
  };
}

function sortLots(openLots, policy) {
  const direction = policy === 'fifo' ? 1 : -1;
  return [...openLots].sort((a, b) => {
    const c = String(a.openedAt).localeCompare(String(b.openedAt));
    if (c !== 0) return c * direction;
    return String(a.id).localeCompare(String(b.id)) * direction;
  });
}

export function summarizeOpenLots(openLots) {
  const map = new Map();
  (openLots || []).forEach(raw => {
    const lot = normalizeLot(raw);
    const key = lot.product + ':' + lot.month;
    const prev = map.get(key) || { product: lot.product, month: lot.month, lots: 0, weighted: 0 };
    prev.lots += lot.lots;
    prev.weighted += lot.entryPrice * lot.lots;
    map.set(key, prev);
  });
  return [...map.values()].map(x => ({
    product: x.product,
    month: x.month,
    lots: x.lots,
    averageEntry: x.lots ? x.weighted / x.lots : null
  })).sort((a, b) => (a.product + a.month).localeCompare(b.product + b.month));
}

export function applyTrade(rawState, rawTrade) {
  const state = normalizeState(rawState);
  const trade = {
    id: String(rawTrade.id || ''),
    date: String(rawTrade.date || ''),
    at: String(rawTrade.at || rawTrade.date || ''),
    product: String(rawTrade.product || '').trim(),
    month: String(rawTrade.month || '').trim(),
    side: String(rawTrade.side || '').trim(),
    lots: integerPositive(rawTrade.lots, '成交口數'),
    price: finitePositive(rawTrade.price, '成交價'),
    matchPolicy: rawTrade.matchPolicy === 'fifo' ? 'fifo' : 'lifo'
  };

  assert(trade.id, '成交ID不可空白');
  assert(validDate(trade.date), '成交日期格式錯誤');
  assert(trade.date >= state.cutoverDate, '成交日期早於交易帳本起始日');
  assert(MULT[trade.product], '未知期貨商品');
  assert(/^\d{4}-\d{2}$/.test(trade.month), '合約月份格式錯誤');
  assert(['buy', 'sell'].includes(trade.side), '成交方向錯誤');

  if (trade.side === 'buy') {
    const next = {
      ...state,
      revision: state.revision + 1,
      openLots: [
        ...state.openLots,
        {
          id: trade.id,
          product: trade.product,
          month: trade.month,
          lots: trade.lots,
          entryPrice: trade.price,
          openedAt: trade.at,
          tag: 'trade'
        }
      ]
    };
    return {
      nextState: next,
      realized: null,
      openSummary: summarizeOpenLots(next.openLots)
    };
  }

  const matching = sortLots(
    state.openLots.filter(x => x.product === trade.product && x.month === trade.month),
    trade.matchPolicy
  );
  const available = matching.reduce((sum, x) => sum + x.lots, 0);
  assert(available >= trade.lots, '賣出口數超過交易帳本可用多單，禁止建立空單');

  let remaining = trade.lots;
  const matched = [];
  const remainingById = new Map(state.openLots.map(x => [x.id, x.lots]));

  for (const lot of matching) {
    if (remaining <= 0) break;
    const closeLots = Math.min(remaining, lot.lots);
    matched.push({
      sourceLotId: lot.id,
      product: lot.product,
      month: lot.month,
      lots: closeLots,
      entryPrice: lot.entryPrice,
      exitPrice: trade.price,
      pnlTwd: Math.round((trade.price - lot.entryPrice) * MULT[lot.product] * closeLots)
    });
    remainingById.set(lot.id, lot.lots - closeLots);
    remaining -= closeLots;
  }

  const nextLots = state.openLots
    .map(x => ({ ...x, lots: remainingById.get(x.id) ?? x.lots }))
    .filter(x => x.lots > 0);

  const realizedGrossPnl = matched.reduce((sum, x) => sum + x.pnlTwd, 0);
  const weightedEntry = matched.reduce((sum, x) => sum + x.entryPrice * x.lots, 0) / trade.lots;

  const next = {
    ...state,
    revision: state.revision + 1,
    openLots: nextLots
  };

  return {
    nextState: next,
    realized: {
      lots: trade.lots,
      weightedEntryPrice: weightedEntry,
      exitPrice: trade.price,
      grossPnlTwd: realizedGrossPnl,
      matchedLots: matched
    },
    openSummary: summarizeOpenLots(next.openLots)
  };
}
