/*
 * Regression test for issue #3002 live ATEH walkthrough.
 *
 * On https://ideav.ru/ateh, `GET /ateh/metadata?JSON` stays pending in the
 * browser, while `GET /ateh/metadata?JSON=1` returns immediately. The Atex
 * dashboard count endpoint also needs JSON=1; otherwise the live server returns
 * HTML for `?_count=`. The Atex workplaces must use explicit JSON flags so role
 * screens can load during the production-path walkthrough.
 *
 * Run with: node experiments/test-issue-3002-atex-live-transport.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const scriptsDir = path.join(root, 'download', 'atex', 'js');

const scripts = fs.readdirSync(scriptsDir)
    .filter(function(file) { return file.endsWith('.js'); })
    .map(function(file) { return path.join(scriptsDir, file); })
    .sort();

assert(scripts.length > 0, 'Atex workspace scripts exist');

scripts.forEach(function(file) {
    const rel = path.relative(root, file);
    const source = fs.readFileSync(file, 'utf8');

    assert(
        !/metadata\?JSON(?![=A-Za-z0-9_])/.test(source),
        rel + ' does not use the live-blocking metadata?JSON form'
    );

    assert(
        !/\?_count=(?!&JSON=1)/.test(source),
        rel + ' uses JSON=1 for live dashboard count endpoints'
    );
});

console.log('issue-3002 atex live transport URLs: ok');
