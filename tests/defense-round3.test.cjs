'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../defense-core.js'), F = require('./defense-realistic-fixture.cjs');
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-7, `${a} != ${b}`);
test('current margin fixture is feasible and reserve plus futures equity equals total, both portfolios', () => {
  for (const mixed of [false,true]) {
    const a = F.account(mixed); assert.ok(a.initialMargin <= a.equity);
    assert.deepEqual(F.margins(a.positions), {initialMargin:a.initialMargin, maintenanceMargin:a.maintenanceMargin});
    assert.ok(C.risk(a.equity,a.outside,a.initialMargin,a.maintenanceMargin).ratio > 500);
    near(a.equity+a.outside,mixed?7500000:2000000);
  }
});
test('all four shocks use current per-product margins and restore ACCOUNT equity, not total or loss', () => {
  const a = F.account(); const rows = C.stress(F.indexReference.close,a);
  rows.forEach((r,i) => {
    const points = -F.indexReference.close*[.05,.1,.15,.2][i];
    near(r.pnl.TX,0); near(r.pnl.MTX,points*50); near(r.pnl.TMF,points*30);
    near(r.equity,1450000+points*80); near(r.total,2000000+points*80);
    near(r.initialMargin,280400); near(r.maintenanceMargin,215200);
    near(r.ratio,r.equity/280400*100); near(r.to550,1542200-r.equity);
    near(r.to550,-r.totalPnl+92200); assert.notEqual(r.to550,-r.totalPnl);
    near(r.shortfallTo550,Math.max(0,r.to550-550000)); assert.equal(r.reserveSufficient,r.to550<=550000);
  });
  assert.equal(rows[1].reserveSufficient,true); assert.equal(rows[2].reserveSufficient,false);
});
test('mixed contracts preserve negative futures equity and show reserve insufficiency even if total stays positive', () => {
  const a = {...F.account(true),equity:1200000,outside:800000};
  assert.ok(a.equity>=a.initialMargin);
  const r = C.stress(F.indexReference.close,a)[1];
  assert.ok(r.equity<0); assert.ok(r.total>0); near(r.equityDeficit,-r.equity);
  near(r.to550,5.5*a.initialMargin-r.equity); assert.equal(r.reserveSufficient,false); assert.ok(r.belowMaintenance);
});
test('550% raw amount is separate from whole-dollar deposit and strict emergency trigger', () => {
  const r = C.risk(500000.001,1000,100000,75000);
  near(r.to550,49999.999); assert.equal(r.suggestedDeposit,50000); assert.equal(r.topUp,0);
  assert.equal(r.reserveSufficient,false); near(r.shortfallTo550,48999.999);
  const below = C.risk(499999.999,100000,100000,75000); assert.equal(below.topUp,50001);
});
for (const [ma10,ma20] of [[85,90],[95,90],[90,90]]) test(`MA ordering is exhaustive with MA10=${ma10}, MA20=${ma20}`, () => {
  const values = [...new Set([80,ma10-1e-6,ma10,ma10+1e-6,ma20-1e-6,ma20,ma20+1e-6,99.999999,100])];
  values.forEach(close => {
    const s = C.classify({close,ma10,ma20,ma60:100,ma60Lag20:110});
    const expected = close>=100?2:close>=ma20?1.5:close>ma10?1:.5;
    assert.equal(s.target,expected); assert.ok(s.valid); assert.notEqual(s.target,null);
  });
});
