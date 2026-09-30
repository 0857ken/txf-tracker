(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.MarketDataAdapters=factory();
})(globalThis,function(){
  'use strict';
  const PRODUCTS=['TX','MTX','TMF'];
  const PARSER_VERSION='market-data-adapter/1.0.0';
  const clone=x=>JSON.parse(JSON.stringify(x));
  const sha256=async value=>{
    const bytes=new TextEncoder().encode(JSON.stringify(value));
    return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  };
  async function frameFromManual(input,retrievedAt){
    const quotes=(input.quotes||[]).map(q=>({
      contract:q.product,contractMonth:q.contractMonth,tradeDate:input.tradeDate,session:q.session,
      bid:q.bid,ask:q.ask,last:q.last,quoteAt:q.quoteAt,sourceEventAt:null,
      provenance:{source:'manual-broker',sourceType:'manual',timestampAuthority:'user-asserted'}
    }));
    const body={schemaVersion:1,contractVersion:'market-data/v1',tradeDate:input.tradeDate,
      source:'manual-broker',sourceType:'manual',retrievedAt,
      equity:{symbol:'0050',close:input.close,sourceEventAt:null},
      futures:{contractMonth:input.contractMonth,TX:quotes.find(q=>q.contract==='TX')||null,
        MTX:quotes.find(q=>q.contract==='MTX')||null,TMF:quotes.find(q=>q.contract==='TMF')||null,quotes},
      provenance:{close:{source:'manual-broker',sourceType:'manual',timestampAuthority:'user-entered'},
        futures:quotes.map(q=>({contract:q.contract,source:'manual-broker',sourceType:'manual',timestampAuthority:'user-asserted'}))},
      parserVersion:PARSER_VERSION};
    return {...body,rawPayloadHash:await sha256({tradeDate:input.tradeDate,close:input.close,contractMonth:input.contractMonth,quotes:input.quotes||[]})};
  }
  const ManualMarketDataAdapter=Object.freeze({
    sourceType:'manual',
    async read(input,retrievedAt){
      const frame=await frameFromManual(input,retrievedAt);
      // Keep the published manual runtime's input byte-for-byte at the engine boundary.
      return {status:'ready',frame,frozenInput:clone(input)};
    }
  });
  const LiveMarketDataAdapter=Object.freeze({
    sourceType:'live',
    async read(){return {status:'blocked',code:'LIVE_PROVIDER_NOT_CONFIGURED',executionReady:false,frame:null};}
  });
  async function run(adapter,input,retrievedAt,frozenEngine){
    const adapted=await adapter.read(input,retrievedAt);
    if(adapted.status!=='ready')return {status:'blocked',code:adapted.code||'MARKET_DATA_UNAVAILABLE',executionReady:false,frame:null,result:null};
    return {status:'ready',frame:adapted.frame,result:await frozenEngine(adapted.frame,adapted.frozenInput)};
  }
  return Object.freeze({PRODUCTS,PARSER_VERSION,ManualMarketDataAdapter,LiveMarketDataAdapter,frameFromManual,run});
});
