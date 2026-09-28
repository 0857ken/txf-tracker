'use strict';
const fs = require('node:fs'), path = require('node:path');
const C = require('../defense-core.js'), L = require('../defense-ledger.js');
const F = require('../tests/defense-fixtures.cjs'), LF = require('../tests/defense-ledger-fixtures.cjs');
const RF = require('../tests/defense-realistic-fixture.cjs');
const f = LF.sample(), ledger = L.buildLedger(f.seed, f.days, f.orders);
const boundaries = [84.999999, 85, 85.000001, 89.999999, 90, 90.000001, 99.999999, 100, 100.000001]
  .map(close => ({...LF.day().indicators, close}));
boundaries.push({...LF.day().indicators, ma60Lag20: 100}, {...LF.day().indicators, ma60Lag20: 99.999999},
  {...LF.day().indicators, ma60Lag20: 100.000001}, {...LF.day().indicators, close: 90, ma10: 95});
const data = {label: 'ROUND3 SYNTHETIC ACCOUNTS; VERIFIED MARGIN AND INDEX REFERENCE — NOT REAL FORWARD',
  capitalBase: C.CAPITAL, contractMultipliers: C.MULT,
  marginReference: RF.marginReference, indexReference: RF.indexReference,
  stressInput: {index: RF.indexReference.close, account: RF.account()}, stress: C.stress(RF.indexReference.close, RF.account()),
  mixedContractInput: RF.account(true), mixedContractStress: C.stress(RF.indexReference.close, RF.account(true)),
  negativeEquityInput: {...RF.account(true), equity: 1200000, outside: 800000},
  negativeEquityStress: C.stress(RF.indexReference.close, {...RF.account(true), equity: 1200000, outside: 800000}),
  riskBoundaries: [490000, 499999.999, 500000, 500000.001, 550000].map(equity =>
    ({equity, outside: 1450000, initialMargin: 100000, maintenanceMargin: 75000, ...C.risk(equity, 1450000, 100000, 75000)})),
  maBoundaries: boundaries.map(indicators => ({indicators, result: C.classify(indicators)})),
  execution: C.analyzeExecution(F.order()), ledgerInputs: f, ledger,
  monthlyReview: L.monthlyReview(ledger, f.orders, [], '2026-09'),
  limitations: ['四日合成帳本含未來示範日期，不會寫入正式排程', '理論稅為逐腿名目金額乘設定稅率；實際稅以成交紀錄為準',
    'MA交錯重疊MA20優先已由使用者正式確認', '真實Firestore另见defense-live-round3.json；GitHub cron尚待預設分支授權', '無iPhone真機或瀏覽器排版截圖，不以DOM測試替代',
    '舊20,000點及10萬元保證金僅保留代數單元測試，不作為實務保證金fixture；本例不使用其壓測结果']};
const out = path.resolve(__dirname, '../test-results/defense-round3-examples.json');
fs.mkdirSync(path.dirname(out), {recursive: true}); fs.writeFileSync(out, JSON.stringify(data, null, 2));
console.log(out);
