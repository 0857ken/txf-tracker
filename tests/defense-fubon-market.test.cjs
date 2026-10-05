'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const root=path.resolve(__dirname,'..');
const M=require(path.join(root,'defense-market.js'));
const C=require(path.join(root,'defense-core.js'));
function load(name){return JSON.parse(fs.readFileSync(path.join(root,'data',name),'utf8'));}

test('current production Fubon close extends stale Yahoo 0050 history without changing frozen signal rules',()=>{
  const strategy=load('strategy_data.json'),price=load('market_data.json'),fubon=load('fubon_market_data.json');
  const market=M.buildMarket({strategy,price,fubon}),signal=C.signal(market.target);
  assert.equal(market.fubonStatus,'accepted');
  assert.equal(market.closed,true);
  assert.match(market.source,/Fubon Neo/);
  assert.equal(market.date,price.trend.dates.at(-1));
  assert.equal(market.target.at(-1).date,fubon.quote.date);
  assert.equal(market.target.at(-1).close,fubon.quote.closePrice);
  assert.equal(signal.date,fubon.quote.date);
  assert.equal(signal.bear,false);
  assert.equal(signal.target,2);
});

test('unclosed Fubon quote fails closed and does not become a strategy close',()=>{
  const strategy=load('strategy_data.json'),price=load('market_data.json'),fubon=load('fubon_market_data.json');
  fubon.quote.isClose=false;
  const market=M.buildMarket({strategy,price,fubon});
  assert.equal(market.fubonStatus,'not-closed');
  assert.equal(market.closed,false);
  assert.equal(market.target.at(-1).date,strategy.target.at(-1).date);
  assert.equal(market.target.length,strategy.target.length);
});

test('same-day Fubon close replaces only the last close and never duplicates the date',()=>{
  const strategy=load('strategy_data.json'),price=load('market_data.json'),fubon=load('fubon_market_data.json');
  const day=strategy.target.at(-1).date;
  fubon.quote={...fubon.quote,date:day,closePrice:123.45,isClose:true};
  const market=M.buildMarket({strategy,price,fubon});
  assert.equal(market.target.length,strategy.target.length);
  assert.equal(market.target.at(-1).date,day);
  assert.equal(market.target.at(-1).close,123.45);
  assert.equal(market.target.filter(r=>r.date===day).length,1);
});

test('older Fubon snapshot never rolls accepted history backward',()=>{
  const strategy=load('strategy_data.json'),price=load('market_data.json'),fubon=load('fubon_market_data.json');
  fubon.quote={...fubon.quote,date:'2026-09-01',closePrice:99,isClose:true};
  const market=M.buildMarket({strategy,price,fubon});
  assert.equal(market.fubonStatus,'older-than-history');
  assert.equal(market.closed,false);
  assert.deepEqual(market.target,strategy.target);
});

test('accepted Frozen strategy engines remain byte-identical',()=>{
  const expected={
    'defense-core.js':'87a76f6c4fdc2ffea2d58887e451f7e5e5d0ac58a46026ddc1cea022eaacafd8',
    'defense-governance.js':'249a1c46e69ee05e7e8ef6497bf02ec052bfccc89ee58932e6fa1b4518095513',
    'defense-ledger.js':'3697671bc785b86830e33b1c26e401c3c699591f2e45795506fdba3dcd35b5a0'
  };
  for(const [name,hash] of Object.entries(expected)){
    const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex');
    assert.equal(actual,hash,name);
  }
});


test('formal strategy dashboard links Strategy 4 to the Fubon-integrated page while keeping account mode preview',()=>{
  const html=fs.readFileSync(path.join(root,'strategy.html'),'utf8');
  const config=fs.readFileSync(path.join(root,'defense-config.js'),'utf8');
  assert.match(html,/href="defense\.html"/);
  assert.doesNotMatch(html,/href="strategy4-preview\/index\.html"/);
  assert.match(html,/Fubon 正式唯讀行情/);
  assert.match(config,/mode:\s*'preview'/);
  assert.doesNotMatch(config,/mode:\s*'production'/);
});
