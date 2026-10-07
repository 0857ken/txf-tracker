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
