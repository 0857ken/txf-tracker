(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./frozen/defense-governance.js'));
  else root.OfflineHealth=factory(root.DefenseGovernance);
})(globalThis,function(G){
  'use strict';
  // Presentation only. Does not change or supply executionReady.
  const DAY=86400000;
  function marginHealth(view,at){
    const margins=view?.margins||[];
    if(margins.length!==3)return {status:'尚未初始化',className:'blocked',records:[]};
    const records=margins.map(m=>{const result=G.validateMarginRecord(m,at);const ms=Date.parse(m.fetchedAt)+7*DAY;
      return {product:m.product,fetchedAt:m.fetchedAt,expiresAt:Number.isFinite(ms)?new Date(ms).toISOString():null,fresh:result.fresh,reasons:result.reasons};});
    if(view.marginRevoked)return {status:'已停用，請更新資料包',className:'blocked',records};
    if(records.some(r=>!r.fresh))return {status:records.some(r=>r.reasons.includes('stale-age'))?'已過期':'無效，請更新資料包',className:'blocked',records};
    const remaining=Math.min(...records.map(r=>Date.parse(r.expiresAt)-Date.parse(at)));
    return {status:remaining<=DAY?'即將過期':'有效',className:remaining<=DAY?'warning':'ready',records};
  }
  return {marginHealth};
});
