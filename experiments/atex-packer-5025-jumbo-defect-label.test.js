// #5025 — «на упаковке 594 шт, а с двух джамбо получилось 592 шт». Плашка «Джамбо»
// показывает штуки за вычетом брака, а «факт» карточки — без вычета; разница не
// видна. Решение владельца: подписывать брак явно — «Z41321 — 592 шт (брак 2)».
// Правило: у каждой строки джамбо с вычтенным браком подписан этот брак, и
// «шт + брак» строки = её доля факта карточки; без брака строка без подписи.
//
// Run with: node experiments/atex-packer-5025-jumbo-defect-label.test.js

process.env.TZ = 'UTC';
global.document = {
    createElement: function() { return {}; }, createTextNode: function() { return {}; },
    body: {}, readyState: 'loading', getElementById: function() { return null; }, addEventListener: function() {}
};
global.window = { db: 'testdb' };

var core = require('../download/atex/js/packer.js').core;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

function item(over) {
    var base = { taskId: '853720', factQty: 594 };
    Object.keys(over || {}).forEach(function(k) { base[k] = over[k]; });
    return base;
}
function parse(line) {
    var m = /^(.+) — (\d+) шт(?: \(брак (\d+)\))?$/.exec(line);
    return m ? { no: m[1], qty: Number(m[2]), defect: m[3] ? Number(m[3]) : 0 } : null;
}

// ── 1) случай из тикета: 27 полос × 22 резки = 594, брак 2 на Z41321 ──
assertEqual(core.jumboQtyLines([item()], { '853720': [
    { no: 'Z41316', cuts: 11, defect: 0 }, { no: 'Z41321', cuts: 11, defect: 2 }] }),
    ['Z41316 — 297 шт', 'Z41321 — 295 шт (брак 2)'],
    '#5025: брак подписан у своего джамбо, джамбо без брака — без подписи');
assertEqual(core.jumboPlateText([item()], { '853720': [{ no: 'Z41321', cuts: 22, defect: 2 }] }),
    'Z41321 — 592 шт (брак 2)', '#5025: плашка тикета — 592 шт (брак 2), в сумме 594 = факт');

// ── 2) общее правило: шт + брак = доля факта, брак не больше доли ──
var cases = [
    { fact: 80, jumbos: [{ no: 'a', cuts: 5, defect: 1 }, { no: 'b', cuts: 5, defect: 3 }] },
    { fact: 594, jumbos: [{ no: 'a', cuts: 7, defect: 5 }, { no: 'b', cuts: 15, defect: 0 }] },
    { fact: 90, jumbos: [{ no: 'a', cuts: 3, defect: 0 }, { no: 'b', cuts: 3, defect: 0 }, { no: 'c', cuts: 3, defect: 4 }] },
    { fact: 80, jumbos: [{ no: 'a', cuts: 10, defect: 100 }] }
];
cases.forEach(function(c, i) {
    var lines = core.jumboQtyLines([item({ factQty: c.fact })], { '853720': c.jumbos });
    var sumCuts = c.jumbos.reduce(function(s, j) { return s + j.cuts; }, 0);
    lines.forEach(function(line, k) {
        var p = parse(line), j = c.jumbos[k];
        var gross = Math.round(j.cuts * c.fact / sumCuts);
        assertEqual(p && [p.no, p.qty + p.defect, p.defect > 0], [j.no, gross, j.defect > 0],
            'случай ' + (i + 1) + ': «' + line + '» — шт + брак = доля факта ' + gross);
    });
});

// ── 3) задание на два заказа: подпись — доля брака карточки (#5017) ──
(function() {
    var o1 = item({ factQty: 40 }), o2 = item({ factQty: 40 });
    var stats = { '853720': [{ no: 'qqq', cuts: 5, defect: 2 }, { no: 'www', cuts: 5, defect: 4 }] };
    assertEqual(core.jumboQtyLines([o1], stats, [o1, o2]),
        ['qqq — 19 шт (брак 1)', 'www — 18 шт (брак 2)'],
        '#5025: карточка одного из двух заказов — брак в доле её факта');
})();

console.log('\n' + passed + ' assertions passed');
