// Serving rules for FILE-attr upload zones (hashed subdirs download/<base>/<n+8hex>/<nnn+8hex>.<ext>,
// index.php GetSubdir/GetFilename): everything except raster images must be served with
// Content-Disposition: attachment; html/svg/xml there additionally get CSP sandbox. The rules live
// in download/.htaccess (prod) and docker/apache/integram.conf (docker mirror). Apache cannot run
// in the node gate, so the test verifies the REGEXES against a URI matrix, plus that the two
// configs carry identical rules (mirror drift = prod/docker behave differently).
// TEXT-ASSERT-OK: Apache <If> rules cannot be executed in the node gate; the regex-vs-sample
// matrix is the only executable form, and mirror equality compares two config files by design.

const fs = require('fs');
const path = require('path');

function rulesOf(file, expected) {
    const s = fs.readFileSync(file, 'utf8');
    const ifs = [...s.matchAll(/<If "([^"]+)">/g)].map(m => m[1]);
    if (ifs.length !== expected) throw new Error(file + ': expected ' + expected + ' <If> rules, got ' + ifs.length);
    return ifs;
}

const ht = rulesOf(path.join(__dirname, '..', 'download', '.htaccess'), 2);
const cf = rulesOf(path.join(__dirname, '..', 'docker', 'apache', 'integram.conf'), 4);
if (ht[0] !== cf[0] || ht[1] !== cf[1] || cf[0] !== cf[2] || cf[1] !== cf[3]) {
    throw new Error('mirror drift: download/.htaccess and docker/apache/integram.conf differ');
}
console.log('PASS: mirrors identical (htaccess == docker conf, both vhosts)');

function evalIf(cond, uri) {
    const u = uri.toLowerCase();
    let v = true;
    for (const m of cond.matchAll(/(!~|=~) \/(.*?)\/(?=\)|"|$)/g)) {
        const neg = m[1] === '!~';
        const re = new RegExp(m[2].replace(/\(\?i:/g, '(?:'), '');
        v = neg ? (v && !re.test(u)) : (v && re.test(u));
    }
    return v;
}

const samples = [
    ['/download/cources/0a1b2c3d4/001e4f6a789.html', true,  true],
    ['/download/cources/0a1b2c3d4/001e4f6a789.HTML', true,  true],
    ['/download/cources/0a1b2c3d4/001e4f6a789.svg',  true,  true],
    ['/download/cources/0a1b2c3d4/001e4f6a789.PDF',  true,  false],
    ['/download/cources/0a1b2c3d4/001e4f6a789.PNG',  false, false],
    ['/download/cources/0a1b2c3d4/001e4f6a789.jpg',  false, false],
    ['/download/cources/0a1b2c3d4/001e4f6a789.',     true,  false],
    ['/download/cources/12a1b2c3d4/001e4f6a789.html', true, true],
    ['/download/atex/main.html',  false, false],
    ['/download/atex/js/05-invariants.js', false, false],
    ['/download/cources/file.html', false, false],
    ['/templates/custom/x.html',   false, false]
];
let bad = 0;
for (const [uri, attach, sandbox] of samples) {
    const got = [evalIf(ht[0], uri), evalIf(ht[1], uri)];
    if (got[0] !== attach || got[1] !== sandbox) bad++;
}
if (bad) { console.log('FAIL: ' + bad + ' of ' + samples.length + ' URI samples wrong'); process.exitCode = 1; }
else console.log('PASS: all ' + samples.length + ' URI samples behave as expected');

