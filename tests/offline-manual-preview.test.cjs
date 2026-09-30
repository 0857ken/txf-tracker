'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../strategy4-preview/manual');
const H=require(path.join(root,'health.js')),O=require(path.join(root,'runtime.js')),G=require(path.join(root,'frozen/defense-governance.js'));
const p=require(path.join(root,'bootstrap-2026-09-30.json')),view={margins:p.margins,marginRevoked:false};
test('bundled Frozen modules match accepted source hashes',()=>{
 const hashes={'defense-core.js':'87a76f6c4fdc2ffea2d58887e451f7e5e5d0ac58a46026ddc1cea022eaacafd8','defense-governance.js':'249a1c46e69ee05e7e8ef6497bf02ec052bfccc89ee58932e6fa1b4518095513','defense-ledger.js':'3697671bc785b86830e33b1c26e401c3c699591f2e45795506fdba3dcd35b5a0'};
 for(const [f,h] of Object.entries(hashes))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'frozen',f))).digest('hex'),h);
});
test('health warning is presentation only; precise 7-day boundary unchanged',()=>{
 const start=Date.parse(p.margins[0].fetchedAt);
 for(const [seconds,status,color,fresh] of [[518399,'有效','ready',true],[518400,'即將過期','warning',true],[604800,'即將過期','warning',true],[604801,'已過期','blocked',false]]){
  const at=new Date(start+seconds*1000).toISOString(),h=H.marginHealth(view,at);
  assert.equal(h.status,status);assert.equal(h.className,color);assert.equal(G.validateMarginRecord(p.margins[0],at).fresh,fresh);
  assert.equal(h.records[0].fetchedAt,p.margins[0].fetchedAt);assert.equal(h.records[0].expiresAt,new Date(start+604800000).toISOString());
 }
});
test('revoked, missing and invalid margins are visibly blocked',()=>{
 const at='2026-09-30T05:40:00Z';assert.equal(H.marginHealth({},at).className,'blocked');assert.equal(H.marginHealth({...view,marginRevoked:true},at).className,'blocked');
 const invalid=structuredClone(view);invalid.margins[1].fetchedAt='invalid';assert.equal(H.marginHealth(invalid,at).className,'blocked');
});
test('static page keeps connection prohibition, bootstrap trust and separate storage',async()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.match(html,/connect-src 'none'/);assert.doesNotMatch(html,/firebase|https:\/\/.*<\/script>/i);
 const catalog=fs.readFileSync(path.join(root,'package-catalog.js'),'utf8');assert.ok(catalog.includes(await O.hash(p)));
 const state=await O.importPackage(O.blank(),p,[await O.hash(p)],'2026-09-30T05:40:00Z');assert.equal(O.project(state).margins[0].fetchedAt,p.margins[0].fetchedAt);
 assert.equal(O.KEY,'strategy4.offline-manual.v1');assert.match(html,/離線模式無法自動偵測期交所臨時調整保證金/);
});
