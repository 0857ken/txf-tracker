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
  let futures = [], futuresError = null;
  try { futures = await fetchFutures(last.date, fetcher); } catch { futuresError = '逐合約期貨行情未取得，不用加權指數代替'; }
  return {date: last.date, updatedAt: now, fetchedAt: now, closed: true, index: b.close, target, futures, futuresError,
    source: 'Yahoo Finance 0050.TW / ^TWII daily close; TAIFEX contract settlements'};
}
function parseFutures(rows, date) {
  C.date(date); if (!Array.isArray(rows)) throw new Error('期交所行情格式錯誤');
  const wanted = date.replaceAll('-', '');
  const values = rows.filter(r => String(r.Date).replaceAll('/', '').replaceAll('-', '') === wanted &&
    ['TX', 'MTX', 'TMF'].includes(r.Contract?.trim()) && /^\d{6}$/.test(r['ContractMonth(Week)']) &&
    ['一般', 'Regular'].includes(r.TradingSession) && Number(r.SettlementPrice) > 0)
    .map(r => ({product: r.Contract.trim(), month: r['ContractMonth(Week)'].slice(0, 4) + '-' + r['ContractMonth(Week)'].slice(4),
      date, mark: Number(r.SettlementPrice), markAt: date + 'T13:45:00+08:00', source: 'TAIFEX DailyMarketReportFut 一般時段結算價'}));
  if (!values.length) throw new Error('期交所尚無指定日結算價');
  if (new Set(values.map(x => x.product + x.month)).size !== values.length) throw new Error('期交所同合約日行情重複');
  return values;
}
async function fetchFutures(date, fetcher = fetch) {
  const r = await fetcher('https://openapi.taifex.com.tw/v1/DailyMarketReportFut', {signal: AbortSignal.timeout(25000)});
  if (!r.ok) throw new Error('期交所行情HTTP錯誤');
  return parseFutures(await r.json(), date);
}
module.exports = {yahoo, fetchMarket, parseFutures, fetchFutures};
