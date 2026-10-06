'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.resolve(__dirname,'..','stocks.html'),'utf8');

test('stocks mobile page is contained to viewport',()=>{
  assert.ok(html.includes('html, body { max-width:100%; overflow-x:hidden; }'));
  assert.ok(html.includes('main { width:100%; max-width:100%;'));
  assert.ok(html.includes('dialog { width:calc(100vw - 28px)'));
});
test('wide tables collapse on mobile',()=>{
  assert.ok(html.includes('<table class="mobile-cards">'));
  assert.ok(html.includes('<table class="add-position">'));
  assert.ok(html.includes('table.mobile-cards td:nth-child(9)'));
  assert.ok(html.includes('table.add-position input, table.add-position select'));
});
test('mobile navigation exists and production hooks remain',()=>{
  assert.ok(html.includes('class="app-topbar"'));
  assert.ok(html.includes('class="bottom-nav"'));
  for(const s of ['index.html','stocks.html','assets.html','strategy.html','follow.html','defense.html#positions','window.fetchFuturesMaster','window.fetchStocks']) assert.ok(html.includes(s),s);
});
