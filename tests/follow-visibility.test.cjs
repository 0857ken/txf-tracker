const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const C=require('../follow-core.js');
const source=fs.readFileSync(require.resolve('../follow.js'),'utf8');
const start=source.indexOf('  function updateInventoryVisibility(kind)');
const end=source.indexOf('  function renderFriends',start);
function fixture(values) {
  const rows=values.map(value=>({hidden:false,keep:false,
    querySelector:()=>({value:String(value)}),hasAttribute(){return this.keep;}}));
  const nodes={'own-body':{rows},'own-show-zero':{setAttribute(){}},'own-visibility':{},'own-empty':{}};
  const showZero={own:false};
  const context=vm.createContext({$:id=>nodes[id],showZero});
  vm.runInContext(source.slice(start,end),context);
  return {rows,nodes,showZero,update:()=>context.updateInventoryVisibility('own')};
}
test('zero positions hide without removing data; blank drafts and nonzero positions stay',()=>{
  const f=fixture([0,310,9,64,8,64,'']);f.update();
  assert.deepEqual(f.rows.map(r=>r.hidden),[true,false,false,false,false,false,false]);
  assert.equal(f.rows.length,7);
  f.showZero.own=true;f.update();assert.ok(f.rows.every(r=>!r.hidden));
  f.showZero.own=false;f.rows[0].keep=true;f.update();assert.equal(f.rows[0].hidden,false);
});
test('all sold out produces empty state, while records remain available',()=>{
  const f=fixture([0,0]);f.update();assert.equal(f.nodes['own-empty'].hidden,false);
  f.showZero.own=true;f.update();assert.equal(f.nodes['own-empty'].hidden,true);
});
test('full sale clears position and cost, preserves trade history; rebuy restores visibility',()=>{
  const s={...C.initialState(),holdingsConfirmed:true,cash:1000,
    holdings:[{symbol:'1815',shares:2,avgCost:100}],trades:[]};
  const input={date:'2026-10-05',symbol:'1815',shares:2,price:120,fees:1,side:'sell'};
  const sold=C.applyTrade(s,input);
  assert.equal(sold.holdings[0].shares,0);assert.equal(sold.holdings[0].avgCost,null);
  assert.equal(sold.trades.length,1);assert.equal(sold.cash,1239);
  const view=fixture([sold.holdings[0].shares]);view.update();assert.equal(view.rows[0].hidden,true);
  const bought=C.applyTrade(sold,{...input,side:'buy',shares:1});
  assert.equal(bought.trades.length,2);assert.equal(bought.holdings[0].shares,1);
  const next=fixture([bought.holdings[0].shares]);next.update();assert.equal(next.rows[0].hidden,false);
  assert.equal(s.holdings[0].shares,2);
});
