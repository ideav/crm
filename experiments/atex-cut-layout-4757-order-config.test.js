// #4757 — КОНФИГУРАЦИЯ ЗАКАЗА ИМЕЕТ ПРИОРИТЕТ: 4 ПОЗИЦИИ РАЗНОЙ ШИРИНЫ = ОДНА РЕЗКА.
//
// ПРАВИЛО (решение заказчика 14.08.2026, ТЗ §7/§15). Если под заказом указаны позиции с разными
// ширинами — эти ширины и будут взяты, одной резкой. Конфигурацию задаёт ЗАКАЗ, а не перебор
// выгоды.
//
// ЧТО БЫЛО. Seed раскроя группировал по ключу (ЗАКАЗ, ШИРИНА): каждая ширина заказа уходила СВОЕЙ
// резкой, а обратно они собирались только «по выгоде» в refine. Замер на 400 случайных заказах:
// конфигурация сохранялась в 21% случаев при 2 позициях, 3% при 3 и 0% при 4–5. То есть правило
// не выполнялось практически никогда.
//
// ЦЕНА, КОТОРУЮ ЗАКАЗЧИК ПРИНЯЛ. Выделенная резка даёт за проход 4–6 рулонов ОДНОЙ ширины, а
// комбинированная — по одному рулону каждой. Поэтому «одна резка на заказ» стои́т прогонов:
// +4.6 / +9.8 / +17.0 при 3 / 4 / 5 позициях (резок при этом меньше на 1.5 / 2.1 / 2.7).
// Это осознанный размен: целостность заказа важнее прогонов.
//
// ЧТО НЕЛЬЗЯ СЛОМАТЬ — ГЛАВНОЕ В ЭТОМ ТИКЕТЕ. Одноширинный seed ГАРАНТИРОВАЛ, что composeLayout
// ничего не сбросит в `overflow`: одна ширина всегда влезает в джамбо. Многоширинный seed такой
// гарантии не даёт, а `overflow` эмитится в `skipped` с причиной «шире джамбо» — то есть позиции,
// не влезшие ВМЕСТЕ, молча выпали бы из плана, да ещё с ложной причиной. Поэтому заказ, чьи ширины
// вместе не помещаются (или которых больше лимита ширин), ОТКАТЫВАЕТСЯ на разбиение по ширинам.
//
// ЧТО ПРОВЕРЯЕМ:
//   A — четыре позиции разной ширины одного заказа дают ОДНУ резку со всеми четырьмя ширинами;
//   B — то же для двух, трёх и пяти позиций (правило не про частный случай «4»);
//   C — РАБОТА НЕ ТЕРЯЕТСЯ: заказ, чьи ширины вместе не влезают, разложен несколькими резками,
//       все позиции покрыты, `skipped` пуст;
//   D — позиция ШИРЕ джамбо по-прежнему уходит в `skipped` с причиной «шире джамбо» (настоящий
//       случай ложной причиной не подменяется);
//   E — заказ с числом ширин больше лимита (#4755) откатывается на разбиение, не теряя позиций;
//   F — разные заказы принудительно не склеиваются (#3684) и «≤3 заказов» соблюдается;
//   G — ширины заказа не подменяются складским добором: `preferred` добирает только ОСТАТОК.
//
// Run with: node experiments/atex-cut-layout-4757-order-config.test.js

var layout = require('../download/atex/js/cut-layout.js').layout;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var JUMBO = 910;
function plan(pos, opts) {
    return layout.planLayouts({ jumboWidth: JUMBO, positions: pos,
        preferred: (opts && opts.preferred) || [],
        options: Object.assign({ windowDays: 3, tolerance: 0 }, (opts && opts.options) || {}) });
}
function orderWidths(l) {
    var w = {};
    (l.strips || []).forEach(function(s) { if (s.purpose === 'Заказ') w[s.width] = 1; });
    return Object.keys(w).map(Number).sort(function(a, b) { return b - a; });
}
function cutsOf(res) { return (res.layouts || []).length; }
function coveredOf(res) {
    var c = {};
    (res.layouts || []).forEach(function(l) { (l.positionsCovered || []).forEach(function(p) { c[p] = 1; }); });
    return Object.keys(c).sort();
}
// Заказ из n позиций: ширины заведомо влезают в 910 вместе.
function order(n, widths, qty) {
    return widths.slice(0, n).map(function(w, i) {
        return { id: 'p' + i, orderId: 'ORD-1', width: w, qty: (qty && qty[i]) || 30, dueKey: 1 };
    });
}

// ── A. ЧЕТЫРЕ ПОЗИЦИИ РАЗНОЙ ШИРИНЫ — ОДНА РЕЗКА ────────────────────────────────────────────
var W4 = [214, 191, 189, 143];           // сумма 737 ≤ 910
var four = order(4, W4, [15, 32, 67, 50]);
var r4 = plan(four);
assert(cutsOf(r4) === 1,
    'A. четыре позиции разной ширины одного заказа дают ОДНУ резку',
    'резок: ' + cutsOf(r4));
assert(cutsOf(r4) === 1 && String(orderWidths(r4.layouts[0])) === String([214, 191, 189, 143]),
    'A2. и в ней ровно те ширины, что указаны в позициях заказа',
    'ширины: ' + JSON.stringify(cutsOf(r4) === 1 ? orderWidths(r4.layouts[0]) : null));

// ── B. ПРАВИЛО НЕ ПРО ЧАСТНЫЙ СЛУЧАЙ «4» ────────────────────────────────────────────────────
var W5 = [214, 191, 189, 143, 130];      // сумма 867 ≤ 910
[[2, W4], [3, W4], [5, W5]].forEach(function(c) {
    var res = plan(order(c[0], c[1]));
    assert(cutsOf(res) === 1 && orderWidths(res.layouts[0]).length === c[0],
        'B. заказ из ' + c[0] + ' позиций — тоже одна резка со всеми его ширинами',
        'резок: ' + cutsOf(res) + ', ширин: ' + (cutsOf(res) === 1 ? orderWidths(res.layouts[0]).length : '—'));
});

// ── C. РАБОТА НЕ ТЕРЯЕТСЯ, ЕСЛИ ШИРИНЫ ВМЕСТЕ НЕ ВЛЕЗАЮТ ────────────────────────────────────
// Каждая ширина по отдельности в джамбо помещается, но вместе — нет (сумма 1290 > 910).
var wide = [
    { id: 'w0', orderId: 'ORD-2', width: 450, qty: 20, dueKey: 1 },
    { id: 'w1', orderId: 'ORD-2', width: 430, qty: 20, dueKey: 1 },
    { id: 'w2', orderId: 'ORD-2', width: 410, qty: 20, dueKey: 1 }
];
var rw = plan(wide);
assert(coveredOf(rw).join(',') === 'w0,w1,w2',
    'C. заказ, чьи ширины вместе не влезают, разложен НЕСКОЛЬКИМИ резками — ни одна позиция не потеряна',
    'покрыто: ' + JSON.stringify(coveredOf(rw)) + ', резок: ' + cutsOf(rw));
assert((rw.skipped || []).length === 0,
    'C2. и ничего не ушло в skipped — «не влезли вместе» не то же самое, что «шире джамбо»',
    'skipped: ' + JSON.stringify(rw.skipped || []));

// ── D. НАСТОЯЩИЙ «ШИРЕ ДЖАМБО» СОХРАНЯЕТСЯ ──────────────────────────────────────────────────
var tooWide = [
    { id: 'b0', orderId: 'ORD-3', width: 1200, qty: 5, dueKey: 1 },
    { id: 'b1', orderId: 'ORD-3', width: 200, qty: 20, dueKey: 1 }
];
var rb = plan(tooWide);
assert((rb.skipped || []).length === 1 && String(rb.skipped[0].positionId) === 'b0'
       && /шире джамбо/.test(rb.skipped[0].reason || ''),
    'D. позиция ШИРЕ джамбо по-прежнему уходит в skipped с честной причиной',
    JSON.stringify(rb.skipped || []));
assert(coveredOf(rb).join(',') === 'b1',
    'D2. а годная позиция того же заказа разложена, а не утянута за ней',
    'покрыто: ' + JSON.stringify(coveredOf(rb)));

// ── E. ШИРИН БОЛЬШЕ ЛИМИТА (#4755) — ОТКАТ НА РАЗБИЕНИЕ, БЕЗ ПОТЕРЬ ─────────────────────────
var W6 = [160, 155, 150, 145, 140, 135];   // сумма 885 ≤ 910, но ширин 6 > 5
var six = order(6, W6);
var r6 = plan(six);
assert(coveredOf(r6).length === 6,
    'E. заказ с 6 ширинами (лимит 5) разложен целиком — работа не потеряна',
    'покрыто: ' + coveredOf(r6).length + ', резок: ' + cutsOf(r6));
assert((r6.layouts || []).every(function(l) { return orderWidths(l).length <= 5; }),
    'E2. и лимит ширин при этом соблюдён',
    'ширины по резкам: ' + JSON.stringify((r6.layouts || []).map(function(l) { return orderWidths(l).length; })));

// ── F. РАЗНЫЕ ЗАКАЗЫ НЕ СКЛЕИВАЮТСЯ ПРИНУДИТЕЛЬНО (#3684) ───────────────────────────────────
var mixed = [
    { id: 'm0', orderId: 'A', width: 214, qty: 30, dueKey: 1 },
    { id: 'm1', orderId: 'B', width: 214, qty: 30, dueKey: 1 },
    { id: 'm2', orderId: 'C', width: 214, qty: 30, dueKey: 1 },
    { id: 'm3', orderId: 'D', width: 214, qty: 30, dueKey: 1 }
];
var rm = plan(mixed);
var ordersPerCut = (rm.layouts || []).map(function(l) {
    var o = {};
    (l.positionsCovered || []).forEach(function(p) { o[({ m0: 'A', m1: 'B', m2: 'C', m3: 'D' })[p]] = 1; });
    return Object.keys(o).length;
});
assert(Math.max.apply(null, ordersPerCut.concat([0])) <= 3,
    'F. «≤3 заказов на резку» соблюдается — одинаковая ширина разных заказов не склеивается принудительно',
    'заказов по резкам: ' + JSON.stringify(ordersPerCut));
assert(coveredOf(rm).length === 4, 'F2. и все четыре позиции покрыты', 'покрыто: ' + coveredOf(rm).length);

// ── G. СКЛАДСКОЙ ДОБОР НЕ ПОДМЕНЯЕТ ШИРИНЫ ЗАКАЗА ───────────────────────────────────────────
var rp = plan(order(4, W4, [15, 32, 67, 50]), { preferred: [{ width: 100, popularity: 9 }] });
assert(cutsOf(rp) === 1 && String(orderWidths(rp.layouts[0])) === String([214, 191, 189, 143]),
    'G. preferred добирает только ОСТАТОК — ширины заказа не подменяются',
    'ширины «Заказ»: ' + JSON.stringify(cutsOf(rp) === 1 ? orderWidths(rp.layouts[0]) : null));

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
