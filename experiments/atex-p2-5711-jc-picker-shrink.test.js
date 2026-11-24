// rules: none (defect #5711)
// Issue #5711: плашка карты раскроя (#atex-jc-picker) сжималась в полоску толщиной в рамку
// и не раскрывалась при выборе партии.
// Причина: .atex-jb — flex-колонка фиксированной высоты со своим скроллом; у .atex-jb-panel
// overflow-x: auto, а у flex-элемента с overflow ≠ visible минимальная высота = 0, поэтому
// flex-shrink отдавал панели всю нехватку высоты. Панель-ребёнок колонки не должна сжиматься.
'use strict';
var fs = require('fs');
var path = require('path');

var passed = 0, total = 0;
function assert(cond, msg, extra) {
    total++;
    if (cond) { passed++; console.log('  ✓ ' + msg); }
    else { console.log('  ✖ ' + msg + (extra ? ' — ' + extra : '')); process.exitCode = 1; }
}

var root = path.join(__dirname, '..');
var css = fs.readFileSync(path.join(root, 'download/atex-p2/css/jumbo.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

// Все объявления правил, селектор которых целиком равен sel (в т.ч. в списке через запятую).
function decls(sel) {
    var out = {}, re = /([^{}]+)\{([^{}]*)\}/g, m;
    while ((m = re.exec(css))) {
        var sels = m[1].split(',').map(function(s) { return s.trim(); });
        if (sels.indexOf(sel) < 0) continue;
        m[2].split(';').forEach(function(d) {
            var i = d.indexOf(':');
            if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
        });
    }
    return out;
}

var app = decls('.atex-jb');
assert(app.display === 'flex' && app['flex-direction'] === 'column',
    'предпосылка: .atex-jb — flex-колонка', JSON.stringify(app));

var panel = decls('.atex-jb-panel');
assert(/auto|hidden|scroll/.test(panel['overflow-x'] || panel.overflow || ''),
    'предпосылка: у .atex-jb-panel overflow ≠ visible (min-height: auto не держит высоту)');

var picker = decls('.atex-jc-picker');
var shrink = picker['flex-shrink'] || (/^none$|^0 0/.test(picker.flex || '') ? '0' : '');
assert(shrink === '0', '.atex-jc-picker не сжимается flex-колонкой (flex-shrink: 0)',
    JSON.stringify(picker));

console.log(passed + '/' + total + ' проверок пройдено.');
