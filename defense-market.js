(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DefenseMarket = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const clone = value => JSON.parse(JSON.stringify(value));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

  function taipeiTimestamp(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    let normalized = value.trim().replace(' ', 'T');
    if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)) normalized += '+08:00';
    return Number.isFinite(Date.parse(normalized)) ? normalized : null;
  }

  function assertBase(strategy, price) {
    if (!strategy || !Array.isArray(strategy.target) || !strategy.target.length)
      throw new Error('尚無0050歷史收盤資料');
    if (!price || !price.market || !finite(Number(price.market.current_price)))
      throw new Error('加權指數資料不存在');
    const date = price.trend?.dates?.at(-1);
    if (!validDate(date)) throw new Error('加權指數交易日不存在');
  }

  function fubonClose(fubon) {
    const q = fubon?.quote;
    if (!fubon || fubon.schema_version !== 1 || !q) return {accepted:false, status:'missing'};
    if (q.symbol !== '0050' || !validDate(q.date) || !finite(Number(q.closePrice)) || Number(q.closePrice) <= 0)
      return {accepted:false, status:'invalid'};
    if (q.isClose !== true) return {accepted:false, status:'not-closed'};
    return {
      accepted:true,
      status:'accepted',
      date:q.date,
      close:Number(q.closePrice),
      collectedAt:taipeiTimestamp(fubon.collected_at),
      closeTime:q.closeTime ?? null,
      lastUpdated:q.lastUpdated ?? null,
      serial:q.serial ?? null
    };
  }

  function buildMarket({strategy, price, fubon}) {
    assertBase(strategy, price);
    const target = clone(strategy.target);
    const last = target.at(-1);
    if (!validDate(last?.date) || !finite(Number(last?.close)) || Number(last.close) <= 0)
      throw new Error('0050歷史資料最後一筆無效');

    let closed = false;
    let fubonStatus = 'missing';
    let signalUpdatedAt = taipeiTimestamp(strategy.updated_at);
    let source = 'Yahoo Finance · 0050歷史 + 加權指數';
    const live = fubonClose(fubon);

    if (live.accepted) {
      if (live.date < last.date) {
        fubonStatus = 'older-than-history';
      } else {
        const provenance = {
          source:'Fubon Neo / Fugle Market Data',
          collectedAt:live.collectedAt,
          closeTime:live.closeTime,
          lastUpdated:live.lastUpdated,
          serial:live.serial
        };
        if (live.date === last.date) target[target.length - 1] = {...last, close:live.close, provenance};
        else target.push({date:live.date, close:live.close, provenance});
        closed = true;
        fubonStatus = 'accepted';
        signalUpdatedAt = live.collectedAt || signalUpdatedAt;
        source = 'Fubon Neo 0050收盤 + Yahoo Finance 加權指數';
      }
    } else {
      fubonStatus = live.status;
    }

    const priceDate = price.trend.dates.at(-1);
    const updatedAt = taipeiTimestamp(price.updated_at);

    return {
      date:priceDate,
      index:Number(price.market.current_price),
      target,
      updatedAt,
      signalUpdatedAt,
      closed,
      source,
      currentIndex:Number(price.market.current_price),
      currentIndexDate:priceDate,
      currentIndexUpdatedAt:price.updated_at,
      fubonStatus
    };
  }

  return Object.freeze({buildMarket, fubonClose, taipeiTimestamp});
});
