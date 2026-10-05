'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
test('Strategy 4 website is in production Forward mode and does not add broker trading/order APIs',()=>{
  const config=require(path.join(root,'defense-config.js'));
  const ui=fs.readFileSync(path.join(root,'defense.js'),'utf8');
  const data=fs.readFileSync(path.join(root,'defense-data.js'),'utf8');
  assert.equal(config.mode,'production');
  assert.match(data,/defenseStrategies\/.*strategyId/);
  assert.doesNotMatch(ui,/placeOrder|submitOrder|cancelOrder|accountBalanceApi|brokerPositionsApi/i);
});
test('formal production can prefill one-time setup from preview without importing preview snapshots/events as Forward history',()=>{
  const ui=fs.readFileSync(path.join(root,'defense.js'),'utf8');
  assert.match(ui,/previewCandidate = sanitizePreviewState\(saved\)\.account/);
  assert.match(ui,/正式 Forward 尚未建立；已帶入你本機剛核對的資料/);
  assert.doesNotMatch(ui,/previewCandidate\s*=\s*saved;/);
});
