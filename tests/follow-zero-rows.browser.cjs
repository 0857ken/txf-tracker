// Run with Playwright installed: node tests/follow-zero-rows.browser.cjs
// All account data is synthetic. Firebase and external requests are intercepted.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const C=require('../follow-core.js');
const root=path.resolve(__dirname,'..');
const stock=(symbol,shares,price)=>({symbol,name:'測試 '+symbol,market:'TW',shares,price});
const fixture={...C.initialState(),holdingsConfirmed:true,cash:5000,
  settings:{budget:10000,threshold:5,reserve:100,minTrade:0,mode:'original'},
  snapshot:{date:'2026-09-11',items:[stock('1815',1000,100),stock('1595',10,50),stock('2351',0,200),stock('8021',500,400)]},
  holdings:[{...stock('1815',2,100),avgCost:95},{...stock('8021',1,400),avgCost:390},
    {...stock('5439',1,250),avgCost:250},{...stock('2351',0,200),avgCost:null}]};
const server=http.createServer((req,res)=>{
  const filename=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!filename.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try {
    res.setHeader('Content-Type',filename.endsWith('.js')?'application/javascript':filename.endsWith('.css')?'text/css':'text/html');
    res.end(fs.readFileSync(filename));
  } catch {res.writeHead(404);res.end();}
});
const visible=async(page,kind)=>page.locator('#'+kind+'-body tr:visible').count();
const own=(page,code)=>page.locator(`#own-body tr[data-symbol="${code}"]`);
const friend=(page,code)=>page.locator('#friend-body tr').filter({has:page.locator(`[data-key="symbol"][value="${code}"]`)});
let browser;
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({headless:true,
    executablePath:process.env.FOLLOW_BROWSER_EXECUTABLE||undefined,
    args:JSON.parse(process.env.FOLLOW_BROWSER_ARGS||'[]')});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  let promptValue='';
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.type()==='prompt'?d.accept(promptValue):d.accept());
  const origin=`http://127.0.0.1:${server.address().port}`;
  await page.route('**/*',r=>{
    const url=new URL(r.request().url());
    if(url.origin!==origin)return r.abort();
    if(url.pathname==='/follow-data.js')return r.fulfill({contentType:'application/javascript',body:`
      window.fbReady=Promise.resolve('test');window._saved=${JSON.stringify(fixture)};window._writes=0;
      window.loadFollowPortfolio=async()=>structuredClone(window._saved);
      window.saveFollowPortfolio=async(s,revision)=>{
        if(revision!==window._saved.revision)throw new Error('測試版本衝突');
        window._writes++;window._saved=structuredClone({...s,revision:revision+1,updatedAt:new Date().toISOString()});
        return structuredClone(window._saved);
      };`});
    if(url.pathname==='/data/stock_prices.json')return r.fulfill({json:{prices:{},updated_at:'2026-09-11'}});
    return r.continue();
  });
  await page.goto(origin+'/follow.html');
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已載入雲端'));
  assert.equal(await visible(page,'friend'),3);
  assert.equal(await page.locator('#friend-body tr').count(),4);
  assert.equal(await visible(page,'own'),3);
  assert.equal(await page.locator('#own-body tr').count(),5);
  assert.equal(await friend(page,'1595').isVisible(),true,'low-weight nonzero friend stock stays visible');
  assert.equal(await own(page,'1595').isVisible(),false);
  const planBefore=await page.locator('#plan-body').innerText();

  await page.locator('#own-show-zero').click();
  assert.equal(await visible(page,'own'),5);
  await own(page,'1815').locator('[data-key="shares"]').fill('3');
  await page.locator('#own-show-zero').click();
  assert.equal(await own(page,'1815').locator('[data-key="shares"]').inputValue(),'3','toggle preserves unsaved inputs');
  await page.locator('#friend-show-zero').click();
  assert.equal(await visible(page,'friend'),4);
  await page.locator('#friend-show-zero').click();
  assert.equal(await visible(page,'friend'),3);
  assert.equal(await page.locator('#plan-body').innerText(),planBefore,'filters never change the saved plan');
  assert.equal(await page.evaluate(()=>window._writes),0,'filters never write cloud data');
  await page.locator('#save-own').click();
  await page.waitForFunction(()=>window._writes===1);
  assert.equal(await page.evaluate(()=>window._saved.holdings.find(r=>r.symbol==='2351').shares),0);
  assert.equal(await page.evaluate(()=>window._saved.holdings.find(r=>r.symbol==='1815').shares),3);

  // Re-adding an existing hidden symbol reveals its form without duplicating it.
  promptValue='1595';await page.locator('#add-own').click();
  assert.equal(await own(page,'1595').isVisible(),true);
  assert.equal(await page.locator('#own-body tr').count(),5);
  await own(page,'1595').locator('[data-key="shares"]').fill('2');
  await own(page,'1595').locator('[data-key="avgCost"]').fill('50');
  await page.locator('#save-own').click();await page.waitForFunction(()=>window._writes===2);

  // A new zero-stock draft must stay editable until saved.
  promptValue='2330';await page.locator('#add-own').click();
  assert.equal(await own(page,'2330').isVisible(),true);
  await page.locator('#save-own').click();await page.waitForFunction(()=>window._writes===3);
  assert.equal(await own(page,'2330').isVisible(),false);
  assert.equal(await page.evaluate(()=>window._saved.holdings.some(r=>r.symbol==='2330')),true);

  await page.locator('#add-friend').click();
  const draft=page.locator('#friend-body tr').last();
  assert.equal(await draft.isVisible(),true);
  await draft.locator('[data-key="symbol"]').fill('2330');
  await draft.locator('[data-key="name"]').fill('測試新增');
  await draft.locator('[data-key="price"]').fill('100');
  await page.locator('#save-snapshot').click();await page.waitForFunction(()=>window._writes===4);
  assert.equal(await friend(page,'2330').isVisible(),false);
  assert.equal(await page.evaluate(()=>window._saved.snapshot.items.length),5,'hidden zero rows survive snapshot save');
  assert.equal(await page.evaluate(()=>window._saved.snapshot.items.reduce((s,r)=>s+r.shares*r.price,0)),300500);

  // Quick updates can revive hidden rows and still merge with the full snapshot.
  await page.locator('#quick-update').fill('2351 5 200');
  await page.locator('#apply-quick').click();
  assert.equal(await friend(page,'2351').isVisible(),true);
  assert.equal(await page.locator('#friend-body tr').count(),5);
  await page.locator('#save-snapshot').click();await page.waitForFunction(()=>window._writes===5);
  assert.equal(await page.evaluate(()=>window._saved.snapshot.items.find(r=>r.symbol==='2351').shares),5);

  // Selling all hides the actual holding, but leaves selected targets in the plan.
  await page.locator('#t-symbol').fill('1815');await page.locator('#t-side').selectOption('sell');
  await page.locator('#t-shares').fill('3');await page.locator('#t-price').fill('100');await page.locator('#t-fees').fill('1');
  await page.locator('#trade-form button').click();await page.waitForFunction(()=>window._writes===6);
  assert.equal(await own(page,'1815').isVisible(),false);
  assert.match(await page.locator('#plan-body').innerText(),/1815/);
  assert.equal(await page.evaluate(()=>window._saved.cash),5299);
  await page.locator('#t-side').selectOption('buy');await page.locator('#t-shares').fill('1');await page.locator('#t-price').fill('100');await page.locator('#t-fees').fill('0');
  await page.locator('#trade-form button').click();await page.waitForFunction(()=>window._writes===7);
  assert.equal(await own(page,'1815').isVisible(),true);
  assert.equal(await page.evaluate(()=>window._saved.cash),5199);
  assert.equal(await page.evaluate(()=>window._saved.trades.length),2);

  // Export still includes hidden stock rows.
  const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();
  const stream=await (await downloadPromise).createReadStream();const chunks=[];
  for await(const chunk of stream)chunks.push(chunk);
  const exported=JSON.parse(Buffer.concat(chunks).toString());
  assert.equal(exported.snapshot.items.length,5);
  assert.equal(exported.draft.items.length,5);
  assert.equal(exported.holdings.find(r=>r.symbol==='2330').shares,0);
  for(const width of [390,430]) {
    await page.setViewportSize({width,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}px`);
  }
  if(process.env.FOLLOW_SCREENSHOT) {
    await page.locator('#own-show-zero').scrollIntoViewIfNeeded();
    await page.screenshot({path:process.env.FOLLOW_SCREENSHOT});
  }
  // A cleared portfolio has a useful empty state, not a wall of zero rows.
  await page.evaluate(()=>{window._saved.holdings=[];window._saved.snapshot.items.forEach(r=>r.shares=0);});
  await page.locator('#reload').click();
  await page.waitForFunction(()=>!document.querySelector('#own-empty').hidden);
  assert.equal(await visible(page,'own'),0);assert.equal(await visible(page,'friend'),0);
  assert.equal(await page.locator('#friend-empty').isVisible(),true);
  await page.locator('#own-show-zero').click();assert.equal(await visible(page,'own'),5);
  assert.deepEqual(errors,[]);
  console.log('PASS: zero-row filters, draft retention, no filter writes, full snapshots/exports, hidden/new row entry, quick update, sell/buy lifecycle, empty state, 390/430px, no JS errors.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
