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

// Regexes are parsed the way the ap_expr lexer does: /.../ ends at the FIRST '/', a backslash does
// not escape it ("\/" inside /.../ = "Failed to compile regular expression" -> 500 on every file
// under download/). So rules use m#...#, and a /.../ regex containing "\/" is a failure here.
// Parens must balance: a stray ")" is a parse error as well.
function regexesOf(cond) {
    const out = [];
    const rx = /(!~|=~)\s+(?:m#([^#]*)#|\/([^\/]*)\/)/g;
    for (const m of cond.matchAll(rx)) {
        const body = m[2] !== undefined ? m[2] : m[3];
        if (m[3] !== undefined && body.endsWith('\\')) throw new Error('"\\/" inside /.../ — Apache cannot compile it: ' + cond);
        // (?i:...) — case-insensitive group (PCRE); Node 20 lacks modifiers, so spell letters as [xX].
        // Outside the group matching stays case-sensitive, as in Apache.
        const src = body.replace(/\(\?i:([^()]*)\)/g, (_, g) => '(?:' + g.replace(/[a-z]/gi, c => '[' + c.toLowerCase() + c.toUpperCase() + ']') + ')');
        out.push({ neg: m[1] === '!~', re: new RegExp(src) });
    }
    const rest = cond.replace(rx, 'R');
    if (/\\\//.test(rest)) throw new Error('"\\/" inside /.../ — Apache cannot compile it: ' + cond);
    let depth = 0;
    for (const ch of rest) { depth += ch === '(' ? 1 : ch === ')' ? -1 : 0; if (depth < 0) break; }
    if (depth !== 0) throw new Error('unbalanced parens in <If>: ' + cond);
    if (!out.length) throw new Error('no regex parsed in <If>: ' + cond);
    return out;
}
for (const c of ht) regexesOf(c);
console.log('PASS: <If> conditions are in a form the ap_expr lexer compiles');

function evalIf(cond, uri) {
    return regexesOf(cond).every(({ neg, re }) => neg !== re.test(uri));
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
    // extension with non-alnum chars passes BlackList and is stored as-is — still attachment
    ['/download/cources/0a1b2c3d4/001e4f6a789.ht-ml', true,  false],
    ['/download/cources/0a1b2c3d4/001e4f6a789.svg_',  true,  false],
    ['/download/cources/0a1b2c3d4/001e4f6a789.файл',  true,  false],
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

