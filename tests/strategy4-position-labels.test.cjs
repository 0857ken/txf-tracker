'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'defense.js'),'utf8');
const html=fs.readFileSync(path.join(root,'defense.html'),'utf8');
test('position form makes total lots explicit',()=>{
  assert.match(js,/目前總口數/);
  assert.match(js,/填加碼後的總口數，不是本次新增口數/);
});
test('position mark is explicitly current market reference, not trade price',()=>{
  assert.match(js,/目前市價／收盤價（非成交價）/);
  assert.match(js,/買進成交價請不要填在這裡/);
  assert.match(html,/口數是目前總持倉/);
});

test('closed FIFO or realized-PnL statements cannot be used as current inventory',()=>{
  assert.match(html,/目前持倉核對來源/);
  assert.match(html,/留倉／未平倉／庫存畫面/);
  assert.match(html,/沖銷／已實現損益明細（不可更新目前口數）/);
  assert.match(js,/positionSource === 'closed_only'/);
  assert.match(js,/沖銷／已實現損益明細不能用來更新目前口數/);
  assert.match(js,/positionSource: a\.positionSource/);
});
