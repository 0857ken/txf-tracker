const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('actual data layer waits for auth, persists atomically, rejects stale revision',async()=>{
  let cloud=null,writes=0,resolveAuth;
  const window={fbReady:new Promise(r=>resolveAuth=r),fbDb:{}};
  const snap=()=>({exists:()=>cloud!==null,data:()=>cloud});
  const context={window,Blob,Date,JSON,doc:(_db,...p)=>p.join('/'),getDoc:async()=>snap(),
    runTransaction:async(_db,callback)=>callback({get:async()=>snap(),set:(ref,value)=>{
      assert.equal(ref,'users/me/followPortfolios/default');cloud=value;writes++;
    }})};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../follow-data.js'),'utf8').replace(/^import[^\n]*\n/gm,''),context);
  const pending=window.saveFollowPortfolio({settings:{budget:100000}},0);
  assert.equal(writes,0);resolveAuth('test');
  const first=await pending;assert.equal(first.revision,1);assert.equal(writes,1);
  await assert.rejects(window.saveFollowPortfolio({settings:{budget:90000}},0),/另一個裝置/);
  assert.equal(writes,1);assert.equal(cloud.settings.budget,100000);
  assert.equal((await window.loadFollowPortfolio()).revision,1);
});
