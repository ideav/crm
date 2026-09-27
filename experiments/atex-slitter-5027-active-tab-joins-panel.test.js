// #5027 — в пульте слиттера активный корешок «Номера джамбо» слит с панелью показаний:
// разделяющей линии под ним нет, иначе не видно, какой корешок выбран.
//
// Правило проверяется по вычисленному стилю (каскад slitter.css по специфичности и порядку),
// а не по тексту: активный корешок
//   1) наезжает на верхнюю грань панели (отрицательный нижний отступ не меньше её толщины);
//   2) его нижняя грань окрашена в фон панели;
//   3) рисуется ПОВЕРХ панели. Панель — следующий flex-элемент той же колонки
//      .atex-sl-readings и в порядке отрисовки идёт после строки корешков, поэтому
//      непозиционированный корешок она перекрывает своей верхней линией. Поверх неё
//      корешок оказывается, только если он (или строка корешков) поднят:
//      position не static либо z-index не auto (у flex-элемента z-index работает и так).
//
// Файл можно запустить на другом CSS: node <тест> <путь к slitter.css>.
// Run with: node experiments/atex-slitter-5027-active-tab-joins-panel.test.js

var fs = require('fs');
var path = require('path');

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    var ok = a === e;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + e + ', получено ' + a + ')'));
    if (ok) passed++; else process.exitCode = 1;
}
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var cssPath = process.argv[2] || path.join(__dirname, '..', 'download', 'atex', 'css', 'slitter.css');
var sheet = fs.readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// ── Разбор: правила верхнего уровня (внутри @media — не берём: пульт на планшете в
//    альбомной ориентации, узкие брейкпоинты корешков не касаются) ──
var rules = [];
(function parse() {
    var depth = 0, start = 0, order = 0;
    for (var i = 0; i < sheet.length; i++) {
        var ch = sheet[i];
        if (ch === '{') {
            if (depth === 0) {
                var prelude = sheet.slice(start, i).trim();
                var close = i, d = 0;
                for (; close < sheet.length; close++) {
                    if (sheet[close] === '{') d++;
                    else if (sheet[close] === '}' && --d === 0) break;
                }
                if (prelude[0] !== '@') {
                    var decls = {};
                    sheet.slice(i + 1, close).split(';').forEach(function(pair) {
                        var k = pair.indexOf(':');
                        if (k < 0) return;
                        decls[pair.slice(0, k).trim()] = pair.slice(k + 1).trim();
                    });
                    prelude.split(',').forEach(function(sel) {
                        rules.push({ sel: sel.trim(), decls: decls, order: order++ });
                    });
                }
                i = close; start = close + 1;
            }
        }
    }
})();

// ── Модель DOM конструкции «корешки + панель» (slitter.js, строка корешков #4916) ──
function node(tag, classes, parent) { return { tag: tag, classes: classes, parent: parent || null }; }
var root = node('div', ['atex-sl', 'atex-brand']);
var readings = node('div', ['atex-sl-readings'], root);
var tabsRow = node('div', ['atex-sl-jumbo-tabs'], readings);
var activeTab = node('input', ['atex-sl-jumbo-tab', 'is-active', 'atex-sl-jumbo-tab-input'], tabsRow);
var panel = node('div', ['atex-sl-section'], readings);

// Сопоставление: цепочка составных селекторов из классов/тега через пробел (потомок).
function matchCompound(compound, el) {
    if (/[:\[>+~*]/.test(compound)) return false;          // псевдоклассы/атрибуты — не наш случай
    var tag = compound.match(/^[a-z]+/i);
    if (tag && tag[0].toLowerCase() !== el.tag) return false;
    var cls = compound.match(/\.[\w-]+/g) || [];
    return cls.every(function(c) { return el.classes.indexOf(c.slice(1)) !== -1; });
}
function matches(sel, el) {
    var parts = sel.split(/\s+/);
    if (!matchCompound(parts[parts.length - 1], el)) return false;
    var cur = el.parent;
    for (var p = parts.length - 2; p >= 0; p--) {
        while (cur && !matchCompound(parts[p], cur)) cur = cur.parent;
        if (!cur) return false;
        cur = cur.parent;
    }
    return true;
}
function specificity(sel) {
    return (sel.match(/\.[\w-]+/g) || []).length * 100 + (sel.match(/(^|\s)[a-z]+/gi) || []).length;
}
// Вычисленное значение свойства (с раскрытием border / border-bottom в border-bottom-color).
function computed(el, prop) {
    var best = null;
    rules.filter(function(r) { return matches(r.sel, el); }).forEach(function(r) {
        var v = null;
        if (r.decls[prop] != null) v = r.decls[prop];
        else if (prop === 'border-bottom-color') {
            var sh = r.decls['border-bottom'] != null ? r.decls['border-bottom'] : r.decls.border;
            if (sh != null) v = sh.replace(/^\s*\S+\s+\S+\s+/, '');
        } else if (prop === 'border-top-width') {
            var shT = r.decls['border-top'] != null ? r.decls['border-top'] : r.decls.border;
            if (shT != null) v = shT.split(/\s+/)[0];
        }
        if (v == null) return;
        var rank = specificity(r.sel) * 100000 + r.order;
        if (!best || rank > best.rank) best = { rank: rank, v: v };
    });
    return best ? best.v : null;
}
function px(v) { var m = /^(-?\d+(?:\.\d+)?)px$/.exec(String(v || '').trim()); return m ? +m[1] : (v === '0' ? 0 : null); }
function raised(el) {
    var pos = computed(el, 'position') || 'static';
    var z = computed(el, 'z-index') || 'auto';
    return pos !== 'static' || z !== 'auto';
}

// ── 1) Наезд на верхнюю грань панели ──
var panelTop = px(computed(panel, 'border-top-width'));
var tabShift = px(computed(activeTab, 'margin-bottom'));
assert(panelTop > 0, 'у панели показаний есть верхняя грань (иначе тест бессмысленен): ' + panelTop + 'px');
assert(tabShift != null && tabShift <= -panelTop,
    'активный корешок заходит на верхнюю грань панели: margin-bottom ' + tabShift + 'px');

// ── 2) Нижняя грань корешка — цвета фона панели ──
assertEqual(computed(activeTab, 'border-bottom-color'), computed(panel, 'background'),
    'нижняя грань активного корешка окрашена в фон панели');
assertEqual(computed(activeTab, 'background'), computed(panel, 'background'),
    'фон активного корешка = фон панели (корешок и вкладка — одно целое)');

// ── 3) Корешок рисуется поверх панели, а не под её верхней линией ──
assert(!raised(panel), 'панель показаний не поднята над потоком (иначе правило ниже не про то)');
assert(raised(activeTab) || raised(tabsRow),
    'активный корешок (или строка корешков) поднят над панелью — её линия не режет корешок снизу (#5027)');

console.log('\n' + passed + '/' + total + ' проверок прошло');
