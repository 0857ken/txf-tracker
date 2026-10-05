'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),G=require('../defense-margin-guide.js');

test('theoretical target lots are determined before and independently of margin safety input',()=>{
  const x={strategyEquity:1000000,initialMargin:140200,maintenanceMargin:107600,targetNotional:2000000,
    signal:{target:2},positions:[{product:'TMF',month:'2026-10',lots:2,mark:49949}]};
  const r=G.sameProduct(x,{TX:200,MTX:50,TMF:10});
  assert.equal(r.rawNearestLots,4);
  assert.equal(r.theoreticalDeltaLots,2);
  assert.ok(Math.abs(r.theoreticalExposure-1.99796)<1e-9);
  assert.deepEqual([r.maxSafeLots,r.bestSafeLots,r.deltaLots],[2,2,0]);
  assert.equal(r.nextRequired550,1156650);
  assert.equal(r.rawNearestRequired550,1542200);
});

test('missing margin still preserves theoretical target lots instead of hiding or rewriting them',()=>{
  const x={strategyEquity:1000000,initialMargin:null,maintenanceMargin:null,targetNotional:2000000,
    signal:{target:2},positions:[{product:'TMF',month:'2026-10',lots:2,mark:49949}]};
  const r=G.sameProduct(x,{TX:200,MTX:50,TMF:10});
  assert.equal(r.status,'theoretical-only');
  assert.equal(r.rawNearestLots,4);
  assert.equal(r.theoreticalDeltaLots,2);
  assert.equal(r.maxSafeLots,undefined);
});

test('mixed products return unavailable because a single theoretical product lot count is ambiguous',()=>{
  const x={strategyEquity:1000000,initialMargin:200000,maintenanceMargin:150000,targetNotional:2000000,signal:{target:2},
    positions:[{product:'TMF',month:'2026-10',lots:2,mark:49949},{product:'MTX',month:'2026-10',lots:1,mark:49949}]};
  assert.equal(G.sameProduct(x,{TX:200,MTX:50,TMF:10}).status,'unavailable');
});
