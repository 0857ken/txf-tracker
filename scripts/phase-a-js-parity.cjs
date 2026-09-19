'use strict';

const fs = require('node:fs');
const C = require('../defense-core.js');

const rows = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = [];
for (let i = 79; i < rows.length; i++) {
  const s = C.signal(rows.slice(0, i + 1));
  out.push({date: s.date, close: s.close, ma10: s.ma10, ma20: s.ma20,
    ma60: s.ma60, ma60_20ago: s.ma60Lag20, bear: s.bear, target_x: s.target});
}
process.stdout.write(JSON.stringify(out));
