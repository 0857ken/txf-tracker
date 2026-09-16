'use strict';
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const strategy = JSON.parse(read('data/strategy_data.json'));
const market = {date: strategy.target.at(-1).date, index: strategy.benchmark_close.at(-1),
  target: strategy.target, updatedAt: strategy.updated_at.replace(' ', 'T') + '+08:00',
  closed: true, source: 'Repo行情 · 獨立示範預覽，非真實帳戶'};
let html = read('defense.html');
html = html.replace('<link rel="stylesheet" href="defense.css">', () => '<style>' + read('defense.css') + '</style>');
html = html.replace(/  <script defer src="defense-(?:config|core)\.js"><\/script>\n/g, '')
  .replace(/  <script defer src="defense\.js"><\/script>\n/g, '');
html = html.replace(/href="(index|stocks|assets|strategy|follow)\.html"/g, 'href="https://0857ken.github.io/txf-tracker/$1.html"');
const script = code => '<script>\n' + code.replace(/<\/script/gi, '<\\/script') + '\n</script>\n';
html = html.replace('</body>', () => script(read('defense-config.js').replace(/mode: '(preview|production)'/, "mode: 'preview'")) +
  script(read('defense-core.js')) + script('window.DEFENSE_INLINE_DATA=' + JSON.stringify(market).replace(/</g, '\\u003c') + ';') +
  script(read('defense.js')) + '</body>');
const output = path.join(root, 'test-results/defense-preview.html');
fs.mkdirSync(path.dirname(output), {recursive: true}); fs.writeFileSync(output, html);
console.log('Created test-results/defense-preview.html (synthetic account, cloud disabled)');
