'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
test('Strategy 4 website is in production Forward mode and does not add broker trading/order APIs',()=>{
  const config=require(path.join(root,'defense-config.js'));
  const ui=fs.readFileSync(path.join(root,'defense.js'),'utf8');
  const data=fs.readFileSync(path.join(root,'defense-data.js'),'utf8');
  assert.equal(config.mode,'production');
  assert.match(data,/defenseUsers\/.*fbUid.*strategies\/.*strategyId/s);
  assert.doesNotMatch(ui,/placeOrder|submitOrder|cancelOrder|accountBalanceApi|brokerPositionsApi/i);
});
test('formal production can prefill one-time setup from preview without importing preview snapshots/events as Forward history',()=>{
  const ui=fs.readFileSync(path.join(root,'defense.js'),'utf8');
  assert.match(ui,/previewCandidate = sanitizePreviewState\(saved\)\.account/);
  assert.match(ui,/正式 Forward 尚未建立；已帶入你本機剛核對的資料/);
  assert.doesNotMatch(ui,/previewCandidate\s*=\s*saved;/);
});

test('production snapshot requires an explicit owner UID and never falls back to users/me',()=>{
  const runner=fs.readFileSync(path.join(root,'scripts/defense-snapshot.cjs'),'utf8');
  assert.match(runner,/DEFENSE_OWNER_UID/);
  assert.match(runner,/OWNER_UID_UNAVAILABLE/);
  assert.doesNotMatch(runner,/users\/me\/.*defenseStrategies/);
});
test('formal UI exposes only the current Firebase UID as the snapshot routing ID',()=>{
  const html=fs.readFileSync(path.join(root,'defense.html'),'utf8');
  const ui=fs.readFileSync(path.join(root,'defense.js'),'utf8');
  assert.match(html,/id="forward-owner-id"/);
  assert.match(ui,/navigator\.clipboard\.writeText\(window\.fbUid\)/);
});
