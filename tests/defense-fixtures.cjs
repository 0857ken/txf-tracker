'use strict';
const dates = [];
for (let day = new Date('2026-09-16T00:00:00Z'); dates.length < 80; day.setUTCDate(day.getUTCDate() - 1))
  if (![0, 6].includes(day.getUTCDay())) dates.unshift(day.toISOString().slice(0, 10));
function market() { return {date: '2026-09-16', updatedAt: '2026-09-16T06:00:00Z', closed: true, index: 20000,
  target: dates.map((date, i) => ({date, close: 100 + i / 10})), source: 'TEST FIXTURE — NOT REAL FORWARD'}; }
function account() { return {asof: '2026-09-16T05:45:00Z', equityDate: '2026-09-16', equity: 550000, outside: 1450000,
  indexAtEquity: 20000, initialMargin: 100000, maintenanceMargin: 75000, revision: 1,
  positions: [{product: 'TX', month: '2026-09', lots: 1, mark: 20000}, {product: 'MTX', month: '2026-09', lots: 2, mark: 20000},
    {product: 'TMF', month: '2026-09', lots: 3, mark: 20000}], lastAppliedState: 'nonbear:2', nextRollDate: '2026-09-17'}; }
function order() { return {id: 'test-order-1', tradeDate: '2026-09-16', kind: 'roll', product: 'MTX',
  nearMonth: '2026-09', farMonth: '2026-10', side: 'buy', quoteConvention: 'far-minus-near', requestedLots: 4,
  bookAt: '2026-09-16T13:20:00+08:00', orderedAt: '2026-09-16T13:20:01+08:00', firstLimit: -20,
  bids: [-20, -21, -22, -23, -24].map(price => ({price, lots: 2})),
  asks: [-18, -17, -16, -15, -14].map(price => ({price, lots: 2})),
  revisions: [{at: '2026-09-16T13:20:02+08:00', price: -18}, {at: '2026-09-16T13:20:03+08:00', price: -17}],
  fills: [{at: '2026-09-16T13:20:04+08:00', price: -18, lots: 1, fee: 38, tax: 40},
    {at: '2026-09-16T13:20:08+08:00', price: -17, lots: 3, fee: 114, tax: 120}]}; }
module.exports = {market, account, order};
