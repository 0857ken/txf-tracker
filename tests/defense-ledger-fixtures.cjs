'use strict';
const indicators = {close: 80, ma10: 85, ma20: 90, ma60: 100, ma60Lag20: 110};
function seed() { return {at: '2026-09-16T08:00:00+08:00', equity: 550000, outside: 1450000,
  positions: [{product: 'MTX', month: '2026-09', lots: 4, mark: 20000}], source: 'SYNTHETIC ACCEPTANCE FIXTURE',
  fees: {TX: 38, MTX: 19, TMF: 16}, taxRate: 0.00002, lastAppliedState: 'nonbear:2'}; }
function quotes(month, reference, mark) { return ['TX', 'MTX', 'TMF'].map((product, i) => ({product, month,
  bid: reference, ask: reference, mark, initialMargin: [100000, 25000, 5000][i],
  maintenanceMargin: [75000, 18750, 3750][i], source: 'SYNTHETIC contract quote, not index',
  margin: {source: 'SYNTHETIC margin fixture', effectiveDate: '2026-09-16', fetchedAt: '2026-09-16T08:00:00+08:00',
    initial: [100000, 25000, 5000][i], maintenance: [75000, 18750, 3750][i], fresh: true}})); }
function day(date = '2026-09-16', ref = 20000, mark = 20100, month = '2026-09') { return {date,
  previousTradingDate: {'2026-09-16': '2026-09-15', '2026-09-17': '2026-09-16', '2026-09-18': '2026-09-17', '2026-09-21': '2026-09-18'}[date] || null,
  signalDate: date, signalAt: date + 'T13:30:00+08:00', referenceAt: date + 'T13:31:00+08:00', valuationAt: date + 'T13:45:00+08:00',
  targetMonth: month, indicators: {...indicators}, quotes: quotes(month, ref, mark), actualComplete: true,
  externalFlow: 0, actualTransfer: 0, roll: false, monthlyCleanup: false}; }
function order(date, side, lots, price, month = '2026-09', reference = 20000) {
  return {id: 'ledger-' + date + '-' + side, tradeDate: date, kind: 'signal', product: 'MTX', nearMonth: month,
    side, requestedLots: lots, bookAt: date + 'T13:31:00+08:00', orderedAt: date + 'T13:31:01+08:00', firstLimit: reference,
    bids: [0, 1, 2, 3, 4].map(i => ({price: reference - i, lots: 5})),
    asks: [0, 1, 2, 3, 4].map(i => ({price: reference + i, lots: 5})), revisions: [],
    fills: [{at: date + 'T13:31:04+08:00', price, lots, fee: lots * 19, tax: price * 50 * lots * 0.00002}]};
}
function sample() {
  const first = day(), second = day('2026-09-17', 20200, 20200), third = day('2026-09-18', 20230, 20230, '2026-10');
  third.quotes.push(...quotes('2026-09', 20250, 20250)); third.roll = true;
  third.spreads = [{product: 'MTX', nearMonth: '2026-09', farMonth: '2026-10', bid: -22, ask: -20, nearReference: 20250, source: 'SYNTHETIC spread'}];
  const fourth = day('2026-09-21', 20100, 20150, '2026-10'); fourth.indicators.close = 90;
  const roll = {...order('2026-09-18', 'buy', 1, -19), id: 'ledger-roll', kind: 'roll', nearMonth: '2026-09', farMonth: '2026-10',
    quoteConvention: 'far-minus-near', firstLimit: -22,
    bids: [-22, -23, -24, -25, -26].map(price => ({price, lots: 5})),
    asks: [-20, -19, -18, -17, -16].map(price => ({price, lots: 5})),
    revisions: [{at: '2026-09-18T13:31:02+08:00', price: -19}],
    fills: [{at: '2026-09-18T13:31:04+08:00', price: -19, lots: 1, fee: 38,
      tax: (20249 + 20230) * 50 * 0.00002, nearPrice: 20249, farPrice: 20230}]};
  return {seed: seed(), days: [first, second, third, fourth], orders: [order('2026-09-16', 'sell', 3, 19998), roll,
    order('2026-09-21', 'buy', 2, 20102, '2026-10', 20100)]};
}
module.exports = {seed, quotes, day, order, sample};
