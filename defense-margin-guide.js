(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.DefenseMarginGuide=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const finite=x=>typeof x==='number'&&Number.isFinite(x);

  function better(rank,best){
    if(!best)return true;
    for(let i=0;i<rank.length;i++){
      if(rank.slice(0,i).every((x,j)=>Math.abs(x-best[j])<1e-10)&&rank[i]<best[i]-1e-10)return true;
      if(Math.abs(rank[i]-best[i])>=1e-10)return false;
    }
    return false;
  }

  function nearestLots(targetNotional,notionalPerLot){
    const idealLots=targetNotional/notionalPerLot;
    const down=Math.max(1,Math.floor(idealLots));
    const up=Math.max(1,Math.ceil(idealLots));
    const rawNearestLots=Math.abs(down*notionalPerLot-targetNotional)<=Math.abs(up*notionalPerLot-targetNotional)?down:up;
    return {idealLots,rawNearestLots};
  }

  function sameProduct(snapshot,multipliers){
    const positions=snapshot?.positions;
    if(!Array.isArray(positions)||positions.length!==1)return{status:'unavailable',reason:'mixed-or-empty'};

    const p=positions[0];
    const lots=Number(p.lots),mark=Number(p.mark),mult=Number(multipliers?.[p.product]);
    const equity=Number(snapshot.strategyEquity),target=Number(snapshot.signal?.target),targetNotional=Number(snapshot.targetNotional);

    if(!Number.isInteger(lots)||lots<=0||!finite(mark)||mark<=0||!finite(mult)||mult<=0||
      !finite(equity)||equity<=0||!finite(target)||target<=0||!finite(targetNotional)||targetNotional<=0)
      return{status:'unavailable',reason:'missing-target-input'};

    const notionalPerLot=mark*mult;
    const theoretical=nearestLots(targetNotional,notionalPerLot);
    const base={
      product:p.product,currentLots:lots,mark,notionalPerLot,target,targetNotional,
      idealLots:theoretical.idealLots,rawNearestLots:theoretical.rawNearestLots,
      theoreticalDeltaLots:theoretical.rawNearestLots-lots,
      theoreticalExposure:theoretical.rawNearestLots*notionalPerLot/equity
    };

    const im=Number(snapshot.initialMargin),mm=Number(snapshot.maintenanceMargin);
    if(!finite(im)||im<=0||!finite(mm)||mm<=0)
      return{...base,status:'theoretical-only',reason:'margin-input-missing'};

    const perLotInitial=im/lots,perLotMaintenance=mm/lots;
    if(!finite(perLotInitial)||perLotInitial<=0||!finite(perLotMaintenance)||perLotMaintenance<=0)
      return{...base,status:'theoretical-only',reason:'invalid-margin'};

    const maxSafeLots=Math.max(0,Math.floor((equity+1e-9)/(5.5*perLotInitial)));
    let best=null,bestRank=null;
    for(let n=1;n<=maxSafeLots;n++){
      const exposure=n*notionalPerLot/equity,error=exposure-target,rank=[Math.abs(error),exposure>target?1:0,n];
      if(better(rank,bestRank)){best={lots:n,exposure,error};bestRank=rank;}
    }

    const nextLots=lots+1;
    return{
      ...base,
      status:best?'ready':'margin-limited',
      perLotInitial,perLotMaintenance,maxSafeLots,
      bestSafeLots:best?.lots??null,bestSafeExposure:best?.exposure??null,bestSafeError:best?.error??null,
      deltaLots:best?best.lots-lots:null,
      rawNearestRequired550:theoretical.rawNearestLots*perLotInitial*5.5,
      nextLots,nextRequired550:nextLots*perLotInitial*5.5,currentRequired550:lots*perLotInitial*5.5,
      currentIsBest:Boolean(best&&best.lots===lots)
    };
  }

  return Object.freeze({sameProduct});
});
