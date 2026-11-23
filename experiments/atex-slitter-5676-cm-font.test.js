// #5676 (follow-up #5575) — пульт слиттера, цветная раскладка ножей.
//   «Занято: N мм» (.atex-sl-cm-caption-used) и ширины в легенде (.atex-sl-cm-legend-width)
//   набраны тем же кеглем, что номенклатура задания в шапке (.atex-sl-spec, 20px с #5575).
//
// Run with: node experiments/atex-slitter-5676-cm-font.test.js

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

var passed = 0, total = 0;
function assert(cond, msg) {
    total++;
    if (cond) { passed++; console.log('  ok  ' + msg); }
    else console.log('  FAIL ' + msg);
}

var sheet = fs.readFileSync(path.join(ROOT, 'download', 'atex', 'css', 'slitter.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
var flat = sheet.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
var rules = [];
var re = /([^{}]+)\{([^{}]*)\}/g, m, order = 0;
while ((m = re.exec(flat))) {
    var decls = {};
    m[2].split(';').forEach(function(p) {
        var k = p.indexOf(':');
        if (k > 0) decls[p.slice(0, k).trim()] = p.slice(k + 1).trim();
    });
    m[1].split(',').forEach(function(sel) { rules.push({ sel: sel.trim(), decls: decls, order: order++ }); });
}
// последнее по каскаду объявление font-size у класса (селектор без псевдоклассов/комбинаторов)
function fontSize(cls) {
    var best = null;
    rules.forEach(function(r) {
        var last = r.sel.split(/\s+/).pop();
        if (!('font-size' in r.decls) || last.split('.').filter(Boolean).indexOf(cls) === -1) return;
        if (/[:\[>+~*]/.test(last)) return;
        if (!best || r.order > best.order) best = r;
    });
    return best ? parseFloat(best.decls['font-size']) : null;
}
// span без своего кегля наследует его от контейнера
function effective(cls, parentCls) {
    var own = fontSize(cls);
    return own != null ? own : fontSize(parentCls);
}

var spec = fontSize('atex-sl-spec-line');
if (spec == null) spec = fontSize('atex-sl-spec');
assert(spec >= 20, 'номенклатура (.atex-sl-spec) — ' + spec + 'px');

var used = effective('atex-sl-cm-caption-used', 'atex-sl-cm-caption');
assert(used === spec, '#5676: «Занято» (.atex-sl-cm-caption-used) = кегль номенклатуры (' + used + ' vs ' + spec + 'px)');

var width = effective('atex-sl-cm-legend-width', 'atex-sl-cm-legend-item');
assert(width === spec, '#5676: ширины легенды (.atex-sl-cm-legend-width) = кегль номенклатуры (' + width + ' vs ' + spec + 'px)');

console.log('\n' + passed + '/' + total + ' assertions passed');
if (passed !== total) process.exitCode = 1;
