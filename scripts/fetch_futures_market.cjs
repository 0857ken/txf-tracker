'use strict';
const fs = require('node:fs');
const path = require('node:path');
const C = require('../defense-core.js');
const {fetchFutures} = require('./defense-quotes.cjs');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'futures_market.json');
const FUBON = path.join(ROOT, 'data', 'fubon_market_data.json');
const PRODUCT_ORDER = {TX: 0, MTX: 1, TMF: 2};

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function stableRows(rows) {
  return [...rows]
    .map(x => ({
      product: x.product,
      month: x.month,
      date: x.date,
      mark: Number(x.mark),
      markAt: x.markAt,
      source: x.source
    }))
    .sort((a, b) => (PRODUCT_ORDER[a.product] - PRODUCT_ORDER[b.product]) || a.month.localeCompare(b.month));
}
function sameRows(a, b) {
  return JSON.stringify(stableRows(a || [])) === JSON.stringify(stableRows(b || []));
}
async function main() {
  const strict = process.argv.includes('--strict');
  const fubon = loadJson(FUBON);
  const q = fubon?.quote;
  if (fubon?.schema_version !== 1 || q?.symbol !== '0050' || q?.isClose !== true ||
      !/^\d{4}-\d{2}-\d{2}$/.test(q?.date || '')) {
    const msg = 'Fubon 0050正式收盤日期尚不可用';
    if (strict) throw new Error(msg);
    console.log('SKIP_FUTURES_MARKET=' + msg);
    return;
  }
  const date = q.date;
  try {
    const rows = stableRows(await fetchFutures(date));
    for (const p of ['TX','MTX','TMF']) {
      if (!rows.some(x => x.product === p && x.date === date && C.finite(x.mark) && x.mark > 0))
        throw new Error('缺少' + p + '逐合約結算價');
    }
    const existing = fs.existsSync(OUT) ? loadJson(OUT) : null;
    if (existing?.schema_version === 1 && existing.date === date && sameRows(existing.rows, rows)) {
      console.log('FUTURES_MARKET_UNCHANGED=' + date);
      return;
    }
    const payload = {
      schema_version: 1,
      date,
      updated_at: new Date().toISOString(),
      source: 'TAIFEX official same-day contract settlements',
      fubon_close_date: date,
      fubon_collected_at: fubon.collected_at || null,
      rows
    };
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
    console.log('FUTURES_MARKET_UPDATED=' + date);
    console.log('FUTURES_MARKET_ROWS=' + rows.length);
  } catch (error) {
    if (strict) throw error;
    console.log('SKIP_FUTURES_MARKET=' + (error?.message || 'unknown'));
  }
}
if (require.main === module) main().catch(error => {
  console.error('FUTURES_MARKET_FAILED=' + (error?.message || 'unknown'));
  process.exitCode = 1;
});
module.exports = {stableRows, sameRows};
