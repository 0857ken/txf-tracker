'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.resolve(__dirname,'..','assets.html'),'utf8');

test('dashboard refresh keeps all critical data bindings',()=>{
  for(const id of ['plan-networth','total-value','total-pnl','total-pct','leverage','exposure','cash','cash-pct','pie','snapshot-chart','realized-chart','pnl-detail-tbody']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
});

test('mobile app-like navigation is present without removing desktop navigation',()=>{
  assert.match(html,/class="bottom-nav"/);
  assert.match(html,/>儀表板<\/span>/);
  assert.match(html,/>策略庫<\/span>/);
  assert.match(html,/<header>/);
});

test('refresh is presentation-only and preserves production strategy links',()=>{
  assert.match(html,/href="defense\.html"/);
  assert.match(html,/href="strategy\.html"/);
  assert.match(html,/window\.fetchFuturesMaster/);
  assert.match(html,/window\.fetchStocks/);
  assert.match(html,/window\.fetchCustomAssets/);
});
