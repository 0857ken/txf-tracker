'use strict';
const C = require('../defense-core.js');
async function yahoo(symbol, now, fetcher = fetch) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1d&range=6mo';
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetcher(url, {headers: {'User-Agent': 'TXF-Tracker/1.0'}, signal: AbortSignal.timeout(25000)});
      if (!response.ok) throw new Error('行情來源HTTP ' + response.status);
      const body = await response.json();
      const r = body.chart?.result?.[0], q = r?.indicators?.quote?.[0];
      if (!r?.timestamp || !q) throw new Error('行情來源格式不完整');
      const tw = new Date(Date.parse(now) + 8 * 3600000);
      const today = C.twDate(now), afterClose = tw.getUTCHours() * 60 + tw.getUTCMinutes() >= 13 * 60 + 45;
      const price = x => C.finite(x) ? Math.round(x * 100) / 100 : null;
      const rows = r.timestamp.map((t, i) => ({date: C.twDate(new Date(t * 1000).toISOString()),
        close: price(q.close?.[i]), open: price(q.open?.[i]), high: price(q.high?.[i]), low: price(q.low?.[i]),
        volume: C.finite(q.volume?.[i]) ? q.volume[i] : 0}))
        .filter(x => C.finite(x.close) && x.close > 0 && (x.date < today || (x.date === today && afterClose)));
      if (!rows.length) throw new Error('沒有已收盤行情');
      return rows;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}
async function fetchMarket(now, fetcher = fetch) {
  const [target, benchmark] = await Promise.all([yahoo('0050.TW', now, fetcher), yahoo('^TWII', now, fetcher)]);
  const last = target.at(-1), b = benchmark.find(x => x.date === last.date);
  if (!b) throw new Error('0050與加權指數缺少相同日期行情');
  return {date: last.date, updatedAt: now, fetchedAt: now, closed: true, index: b.close, target,
    source: 'Yahoo Finance 0050.TW / ^TWII daily close'};
}
module.exports = {yahoo, fetchMarket};
