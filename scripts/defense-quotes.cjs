'use strict';
const fs = require('node:fs');
const path = require('node:path');
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

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'data', name), 'utf8'));
}

function fubonTarget() {
  const strategy = readJson('strategy_data.json');
  const fubon = readJson('fubon_market_data.json');
  const target = JSON.parse(JSON.stringify(strategy.target || []));
  const q = fubon?.quote;
  if (!target.length || fubon?.schema_version !== 1 || q?.symbol !== '0050' || q?.isClose !== true ||
      !/^\d{4}-\d{2}-\d{2}$/.test(q?.date || '') || !C.finite(Number(q?.closePrice)) || Number(q.closePrice) <= 0)
    throw new Error('Fubon 0050正式收盤資料不可用');
  const last = target.at(-1);
  if (q.date < last.date) throw new Error('Fubon 0050收盤比歷史序列舊');
  const row = {date:q.date, close:Number(q.closePrice)};
  if (q.date === last.date) target[target.length - 1] = {...last, ...row};
  else target.push(row);
  return {target, date:q.date, collectedAt:fubon.collected_at || null};
}

async function fetchMarket(now, fetcher = fetch, targetProvider = fubonTarget) {
  const live = targetProvider();
  const benchmark = await yahoo('^TWII', now, fetcher);
  const b = benchmark.find(x => x.date === live.date);
  if (!b) throw new Error('Fubon 0050與加權指數缺少相同日期收盤');
  let futures = [], futuresError = null;
  try { futures = await fetchFutures(live.date, fetcher); } catch { futuresError = '逐合約期貨行情未取得，不用加權指數代替'; }
  return {date: live.date, updatedAt: live.collectedAt || now, fetchedAt: now, closed: true, index: b.close,
    target: live.target, futures, futuresError,
    source: 'Fubon Neo 0050 close; Yahoo Finance ^TWII daily close; TAIFEX contract settlements'};
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
function cleanHtmlCell(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseOfficialFuturesHtml(html, product, date) {
  C.date(date);
  if (!['TX', 'MTX', 'TMF'].includes(product)) throw new Error('期交所商品無效');
  if (typeof html !== 'string' || !html.includes(date.replaceAll('-', '/')))
    throw new Error('期交所HTML日期不符');

  const rows = [];
  for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => cleanHtmlCell(m[1]));
    if (cells.length < 12 || cells[0] !== product) continue;
    const rawMonth = cells[1].replace(/\s+/g, '');
    if (!/^\d{6}$/.test(rawMonth)) continue; // 排除週契約。
    const mark = Number(String(cells[11]).replaceAll(',', ''));
    if (!C.finite(mark) || mark <= 0) continue;
    rows.push({
      product,
      month: rawMonth.slice(0, 4) + '-' + rawMonth.slice(4),
      date,
      mark,
      markAt: date + 'T13:45:00+08:00',
      source: 'TAIFEX futDailyMarketExcel 一般時段結算價'
    });
  }
  if (!rows.length) throw new Error('期交所HTML尚無指定日結算價');
  if (new Set(rows.map(x => x.product + x.month)).size !== rows.length)
    throw new Error('期交所HTML同合約日行情重複');
  return rows;
}

async function officialProduct(product, date, fetcher = fetch) {
  const queryDate = encodeURIComponent(date.replaceAll('-', '/'));
  const url = 'https://www.taifex.com.tw/cht/3/futDailyMarketExcel?queryType=2&marketCode=0&dateaddcnt=&commodity_id=' +
    encodeURIComponent(product) + '&queryDate=' + queryDate;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetcher(url, {headers: {'User-Agent': 'TXF-Tracker/1.0'}, signal: AbortSignal.timeout(25000)});
      if (!r.ok) throw new Error('期交所HTML HTTP ' + r.status);
      if (typeof r.text !== 'function') throw new Error('期交所HTML回應格式錯誤');
      return parseOfficialFuturesHtml(await r.text(), product, date);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function fetchFuturesOfficial(date, fetcher = fetch) {
  const groups = await Promise.all(['TX', 'MTX', 'TMF'].map(product => officialProduct(product, date, fetcher)));
  const rows = groups.flat();
  if (new Set(rows.map(x => x.product + x.month)).size !== rows.length)
    throw new Error('期交所HTML逐合約行情重複');
  return rows;
}

async function fetchFuturesOpenApi(date, fetcher = fetch) {
  const r = await fetcher('https://openapi.taifex.com.tw/v1/DailyMarketReportFut', {signal: AbortSignal.timeout(25000)});
  if (!r.ok) throw new Error('期交所OpenAPI行情HTTP錯誤');
  return parseFutures(await r.json(), date);
}

async function fetchFutures(date, fetcher = fetch) {
  try {
    return await fetchFuturesOfficial(date, fetcher);
  } catch (officialError) {
    try {
      return await fetchFuturesOpenApi(date, fetcher);
    } catch (openApiError) {
      const error = new Error('期交所逐合約結算價未取得');
      error.official = officialError?.message || 'unknown';
      error.openApi = openApiError?.message || 'unknown';
      throw error;
    }
  }
}
module.exports = {yahoo, fubonTarget, fetchMarket, parseFutures, parseOfficialFuturesHtml,
  fetchFuturesOfficial, fetchFuturesOpenApi, fetchFutures};
