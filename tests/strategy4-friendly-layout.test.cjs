'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');

test('strategy dashboard places Strategy 4 in the same strategy row',()=>{
  const html=fs.readFileSync(path.join(root,'strategy.html'),'utf8');
  assert.match(html,/耀的 RS 訊號/);
  assert.match(html,/橘太郎三條線/);
  assert.match(html,/月波動網格/);
  assert.match(html,/<a class="strategy-link" href="defense\.html">0050 變速防守 ↗<\/a>/);
  assert.doesNotMatch(html,/④ 0050訊號 × 台指期防守反攻策略/);
});

test('Strategy 4 uses the friendly production name without implying automatic orders',()=>{
  const html=fs.readFileSync(path.join(root,'defense.html'),'utf8');
  assert.match(html,/<title>0050 變速防守 · 投資秘書<\/title>/);
  assert.match(html,/<h1>0050 變速防守<\/h1>/);
  assert.match(html,/0\.5x～2\.0x 台指期曝險檔位；不自動下單/);
  assert.match(html,/>四策略<\/a>/);
});
