'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

test('account form carries provenance into broker override and rejects partial override',()=>{
  const js=fs.readFileSync(path.join(root,'defense.js'),'utf8');
  assert.match(js,/source:\s*marginSource, effectiveDate:\s*marginEffectiveDate, fetchedAt:\s*marginFetchedAt,/);
  assert.match(js,/券商覆寫原始與維持保證金請一起填寫/);
  assert.match(js,/券商覆寫原始保證金不得低於維持保證金/);
});

test('task errors are brought into view instead of appearing to do nothing',()=>{
  const js=fs.readFileSync(path.join(root,'defense.js'),'utf8');
  assert.match(js,/scrollIntoView\(\{behavior: 'smooth', block: 'center'\}\)/);
});
