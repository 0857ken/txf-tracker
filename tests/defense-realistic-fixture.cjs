'use strict';
// Verified public market data; account and holdings are synthetic, never user balances.
const marginReference = Object.freeze({checkedOn: '2026-09-17', publishedUpdate: '2026-08-12',
  source: 'https://www.taifex.com.tw/cht/5/indexMarging',
  rates: {TX: {initial: 701000, maintenance: 538000}, MTX: {initial: 175250, maintenance: 134500}, TMF: {initial: 35050, maintenance: 26900}}});
const indexReference = Object.freeze({date: '2026-09-16', close: 45848.90,
  source: 'https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX', sourceDate: '1150916', label: '發行量加權股價指數'});
function margins(positions) { return positions.reduce((a, p) => ({initialMargin: a.initialMargin + Math.abs(p.lots) * marginReference.rates[p.product].initial,
  maintenanceMargin: a.maintenanceMargin + Math.abs(p.lots) * marginReference.rates[p.product].maintenance}), {initialMargin: 0, maintenanceMargin: 0}); }
function account(mixed = false) {
  const positions = mixed ? [{product: 'TX', month: '2026-10', lots: 1, mark: null}, {product: 'MTX', month: '2026-10', lots: 2, mark: null}, {product: 'TMF', month: '2026-10', lots: 3, mark: null}]
    : [{product: 'MTX', month: '2026-10', lots: 1, mark: null}, {product: 'TMF', month: '2026-10', lots: 3, mark: null}];
  return {asof: '2026-09-16T13:45:00+08:00', equityDate: indexReference.date,
    equity: mixed ? 6000000 : 1450000, outside: mixed ? 1500000 : 550000,
    indexAtEquity: indexReference.close, ...margins(positions), positions, revision: 1,
    lastAppliedState: 'nonbear:2', nextRollDate: '2026-10-20',
    datasetKind: 'synthetic-realistic-acceptance', marginReference, indexReference};
}
function market() {
  const s = require('../data/strategy_data.json');
  return {date: indexReference.date, updatedAt: '2026-09-16T18:34:11+08:00', closed: true, index: indexReference.close,
    target: s.target.filter(r => r.date <= indexReference.date), source: 'TWSE verified close; repository 0050 history; synthetic account'};
}
module.exports = {marginReference, indexReference, margins, account, market};
