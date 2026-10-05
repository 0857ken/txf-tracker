'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');

test('frozen strategy engines remain unchanged by valuation guidance hotfix',()=>{
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

test('account UI offers explicit current-index alignment instead of silently changing the frozen valuation rule',()=>{
  const html=fs.readFileSync(path.join(root,'defense.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'defense.js'),'utf8');
  assert.match(html,/id="use-market-index"/);
  assert.match(js,/權益對應加權指數 .* 與當日收盤 .* 不一致/);
  assert.match(js,/尚未通過權益估值核對，不作調倉依據/);
  assert.match(js,/f\.elements\.indexAtEquity\.value = Number\(market\.index\)\.toFixed\(2\)/);
});

test('preview demo no longer pre-claims signal execution or monthly cleanup',()=>{
  const js=fs.readFileSync(path.join(root,'defense.js'),'utf8');
  const demo=js.slice(js.indexOf('function demoAccount()'),js.indexOf('function sanitizePreviewState'));
  assert.doesNotMatch(demo,/lastCleanupMonth/);
  assert.doesNotMatch(demo,/lastAppliedState/);
});

test('saved preview cleanup state requires an actual monthly_cleanup event',()=>{
  const js=fs.readFileSync(path.join(root,'defense.js'),'utf8');
  assert.match(js,/e\.kind === 'monthly_cleanup'/);
  assert.match(js,/delete clean\.account\.lastCleanupMonth/);
  assert.match(js,/sanitizePreviewState\(\{\.\.\.state, account: value/);
});
