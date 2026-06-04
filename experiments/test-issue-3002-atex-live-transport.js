/*
 * Regression test for issue #3002 live ATEH walkthrough.
 *
 * On https://ideav.ru/ateh, `GET /ateh/metadata?JSON` stays pending in the
 * browser, but index.php's `metadata` route always returns JSON via api_dump()
 * and does not need any JSON query flag. The Atex dashboard count endpoint is
 * different and still needs JSON=1; otherwise the live server returns HTML for
 * `?_count=`.
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
        !/metadata\?JSON(?:=1)?/.test(source),
        rel + ' uses the plain metadata endpoint without redundant JSON flags'
    );

    assert(
        !/\?_count=(?!&JSON=1)/.test(source),
        rel + ' uses JSON=1 for live dashboard count endpoints'
    );
});

console.log('issue-3002 atex live transport URLs: ok');
