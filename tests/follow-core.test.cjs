const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../follow-core.js');
const row=(symbol,shares,price=100)=>({symbol,name:symbol,market:'TW',shares,price});
function state(){return {...C.initialState(),holdingsConfirmed:true,snapshot:{date:'2026-09-11',items:[row('1111',90),row('2222',5),row('3333',5)]}};}
test('strict threshold and full portfolio denominator; reserve is not overspent',()=>{
  const s=state(),p=C.calculate(s);
  assert.equal(p.selectedCount,1);assert.equal(p.rows[0].sourceWeight,.9);
  assert.equal(p.rows[0].targetAmount,89550);assert.equal(p.rows[0].targetShares,895);
  assert.equal(p.targetCash,10500);assert.equal(p.allocated+p.targetCash,100000);
  s.settings.mode='normalized';const full=C.calculate(s);assert.equal(full.rows[0].targetAmount,99500);
});
test('price changes affect share targets, not friend weights; old prices never overwrite snapshot',()=>{
  const s=state();const p=C.calculate(s,{'1111':{price:200,date:'2026-09-12'}});
  assert.equal(p.rows[0].targetShares,447);assert.equal(p.rows[0].sourceWeight,.9);
  assert.equal(C.calculate(s,{'1111':{price:1,date:'2026-09-10'}}).rows[0].price,100);
});
test('removed holdings exit and missing prices are blocked',()=>{
  const s=state();s.holdings=[{symbol:'4444',shares:2,avgCost:90}];
  let r=C.calculate(s).rows.find(r=>r.symbol==='4444');assert.equal(r.delta,null);assert.equal(r.action,'缺價待補');
  r=C.calculate(s,{'4444':{price:100,date:'2026-09-12'}}).rows.find(r=>r.symbol==='4444');
  assert.equal(r.delta,-2);assert.equal(r.small,false);
});
test('unconfirmed holdings are not presented as trades',()=>{
  const s=state();s.holdingsConfirmed=false;
  assert.ok(C.calculate(s).rows.every(r=>r.action==='待確認庫存'));
  assert.throws(()=>C.applyTrade(s,{date:'2026-09-12',symbol:'1111',side:'buy',shares:1,price:100,fees:0}));
});
test('empty eligibility and zero portfolio retain cash without NaN',()=>{
  const s=state();s.settings.threshold=100;s.settings.mode='normalized';assert.equal(C.calculate(s).targetCash,100000);
  s.snapshot.items=[];assert.equal(C.calculate(s).selectedCount,0);
});
test('buy then partial sale preserves shares, weighted cost and correct cash/fees',()=>{
  const s=state();const input={date:'2026-09-12',symbol:'1111',side:'buy',shares:10,price:100,fees:10};
  const a=C.applyTrade(s,input);assert.equal(a.cash,98990);assert.equal(a.holdings[0].avgCost,101);assert.equal(s.holdings.length,0);
  const b=C.applyTrade(a,{...input,side:'sell',shares:4,price:120,fees:5});
  assert.equal(b.holdings[0].shares,6);assert.equal(b.holdings[0].avgCost,101);assert.equal(b.cash,99465);assert.equal(b.trades[0].realized,71);
  assert.throws(()=>C.applyTrade(b,{...input,side:'sell',shares:7}),/超過/);
});
test('unknown cost stays unknown on partial sell and additional buy',()=>{
  const s=state();s.holdings=[{symbol:'1111',shares:10,avgCost:null}];
  const input={date:'2026-09-12',symbol:'1111',side:'sell',shares:2,price:120,fees:1};
  const a=C.applyTrade(s,input);assert.equal(a.trades[0].realized,null);
  assert.equal(C.applyTrade(a,{...input,side:'buy'}).holdings[0].avgCost,null);
});
test('bad dates, invalid quantities, duplicate codes and insufficient cash reject',()=>{
  assert.throws(()=>C.date('2026-02-30'));
  assert.throws(()=>C.snapshot({date:'2026-09-11',items:[row('1111',1),row('1111',2)]}));
  assert.throws(()=>C.snapshot({date:'2026-09-11',items:[row('1111',1.5)]}));
  assert.throws(()=>C.snapshot({date:'2026-09-11',items:[row('1111',1,0)]}));
  const s=state();s.cash=99;
  assert.throws(()=>C.applyTrade(s,{date:'2026-09-12',symbol:'1111',side:'buy',shares:1,price:100,fees:0}),/現金不足/);
});
test('CSV preserves leading-zero symbol; malformed thousands separated values reject',()=>{
  const s=C.parseCSV('代號,名稱,市場,股數,參考價\n0050,基金,TW,100,50','2026-09-11');
  assert.equal(s.items[0].symbol,'0050');assert.equal(s.items[0].shares,100);
  assert.throws(()=>C.parseCSV('0050,基金,TW,1,000,50','2026-09-11'));
});
test('small-drift threshold only applies to existing non-exit holdings',()=>{
  const s=state();s.holdings=[{symbol:'1111',shares:894,avgCost:100}];
  assert.equal(C.calculate(s).rows[0].small,true);
  s.holdings=[];assert.equal(C.calculate(s).rows[0].small,false);
});
