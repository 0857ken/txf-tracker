'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const base = path.resolve(__dirname, '..'), manifest = require('./defense-legacy-hashes.json');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
test('legacy three-strategy calculators, LINE, account costs, asynchronous init and follow portfolio remain byte-identical', () => {
  for (const [file, hash] of Object.entries(manifest.files)) assert.equal(sha(fs.readFileSync(path.join(base, file))), hash, file);
});
test('legacy strategy page script is untouched; fourth strategy only adds a separate entry', () => {
  const html = fs.readFileSync(path.join(base, 'strategy.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(x => x[0]).join('\n');
  assert.equal(sha(scripts), manifest.strategyScripts);
  assert.match(html, /href="defense\.html"/);
  for (const id of ['panel-rs', 'panel-line', 'panel-grid']) assert.ok(html.includes('id="' + id + '"'));
});
test('valid release modes, isolated legacy collections and production namespace cannot be toggled by query', () => {
  const config = require('../defense-config.js');
  assert.ok(['preview', 'production'].includes(config.mode));
  const source = fs.readFileSync(path.join(base, 'defense-data.js'), 'utf8');
  assert.match(source, /defensePreviews/); assert.match(source, /location\.hostname !== '0857ken\.github\.io'/);
  assert.doesNotMatch(source, /URLSearchParams|['"]positions['"]|['"]stocks['"]|['"]customAssets['"]/);
});
