// issue #4628: ДОЛЯ ОБЕСПЕЧЕНИЯ ЗВЕНА ИДЁТ ЗА ЕГО ПРОХОДАМИ.
//
// Боевое (ateh, 06.08.2026, сразу после «Упорядочить»): 8 звеньев в 4 цепочках хранят долю
// от ПРЕЖНЕГО разбиения, хотя проходы уже другие.
//
//   заказ 4455: проходы 13 / 142 / 45   доли 195 / 2055 / 750   (доли под 13/137/50)
//   заказ 4567: проходы  2 /   3        доли  29 /  116          (доли под 1/4)
//   заказ 4577: проходы  2 /  19        доли  17 /  340          (доли под 1/20)
//   заказ 4587: проходы 90 /  10        доли 792 /    8          (доли под 99/1)
//
// Σ по цепочке при этом верна (3000, 145, 357, 800 — ровно заказ), поэтому §15
// SUPPLY_CONSERVED молчит: он меряет ВЫПУСК позиции, а не распределение внутри цепочки.
// Расходится именно ПОЗВЕННОЕ распределение — а его читает разбиение по дням (#4536).
//
// Причина: доли раскладывает `splitSupplyShares`, но зовёт её ТОЛЬКО create-путь
// `applySplitPlan`. Когда упаковщик перекладывает проходы между УЖЕ существующими звеньями
// (creates нет, одни updates), доли не переписывает никто.
//
//   A — РЕПРО 4455: проходы 13/142/45 при Σ3000 → доли обязаны стать 195/2130/675;
//   B — РЕПРО 4567: 2/3 при Σ145 → 58/87 (а не 29/116);
//   C — Σ долей цепочки ВСЕГДА равна Σ до перераспределения (работа не создаётся и не исчезает);
//   D — доля звена == полосы × проходы, если полосы у звеньев одинаковы (мерка заказчика);
//   E — звено с нулём проходов (setup-only хвост, #3635 п.5) доли не получает;
//   F — количество неизвестно (rolls пусто) → доли рулонов остаются «не знаем», не нули (#4536);
//   H — область УЗКАЯ: цепочки со снятыми звеньями не трогаем. При схлопывании действует своё
//       правило (#4158: долю удаляемого поглощает голова, реюзнутое продолжение хранит свою),
//       и пропорциональная раскладка его ломает — на этом фикс уже ломался, пока не сузил.
//
// Run with: node experiments/atex-pp-4628-share-follows-runs.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh', xsrf: 'x' };
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
function rolls(shares) { return (shares || []).map(function (s) { return s.rolls; }); }
function sum(a) { return (a || []).reduce(function (s, x) { return s + (Number(x) || 0); }, 0); }

// ── A. Боевая цепочка 4455: 3000 рулонов, проходы 13/142/45.
(function () {
    var sh = P.splitSupplyShares(3000, 3000, [13, 142, 45]);
    assert(String(rolls(sh)) === String([195, 2130, 675]),
        'A: 4455 — доли идут за проходами 13/142/45 → 195/2130/675', JSON.stringify(rolls(sh)));
})();

// ── B. Боевая цепочка 4567: 145 рулонов, проходы 2/3. В базе лежало 29/116 (от 1/4).
(function () {
    var sh = P.splitSupplyShares(145, 450, [2, 3]);
    assert(String(rolls(sh)) === String([58, 87]),
        'B: 4567 — 2/3 при Σ145 → 58/87, а не прежние 29/116', JSON.stringify(rolls(sh)));
})();

// ── C. Работа сохраняется: Σ долей == Σ до перераспределения. Классы из боевых данных.
(function () {
    var cases = [
        { rolls: 3000, runs: [13, 142, 45] },
        { rolls: 145, runs: [2, 3] },
        { rolls: 357, runs: [2, 19] },
        { rolls: 800, runs: [90, 10] },
        { rolls: 209, runs: [15, 4] },     // #4616: та же болезнь, чинил руками
        { rolls: 7, runs: [3, 2, 2] },     // неделящееся нацело
    ];
    var bad = cases.filter(function (c) { return sum(rolls(P.splitSupplyShares(c.rolls, 100, c.runs))) !== c.rolls; });
    assert(bad.length === 0,
        'C: Σ долей цепочки == Σ рулонов позиции (работа не создаётся и не исчезает)',
        bad.length ? JSON.stringify(bad) : '6 раскладок');
})();

// ── D. Мерка заказчика: доля звена == полосы × проходы (полосы у сегментов одни и те же).
(function () {
    var STRIPS = 29, runs = [2, 3];
    var sh = rolls(P.splitSupplyShares(STRIPS * sum(runs), 450, runs));
    var want = runs.map(function (r) { return STRIPS * r; });
    assert(String(sh) === String(want),
        'D: доля == полосы × проходы звена (29 полос × 2/3 = 58/87)', JSON.stringify(sh));
})();

// ── E. Setup-only хвост (0 проходов) доли не получает — работы в нём нет (#3635 п.5).
(function () {
    var sh = rolls(P.splitSupplyShares(145, 450, [0, 5]));
    assert(sh[0] === 0 && sh[1] === 145,
        'E: звено с 0 проходов доли не получает', JSON.stringify(sh));
})();

// ── F. Количество неизвестно — не подставляем нули (#4536: «нет данных → ОРАТЬ, а не 0»).
(function () {
    var sh = P.splitSupplyShares('', 450, [2, 3]);
    assert(sh.length === 2 && sh[0].rolls === null && sh[1].rolls === null,
        'F: неизвестное количество остаётся «не знаем», а не нулём', JSON.stringify(rolls(sh)));
})();

// ── G. Фикс живёт в ОДНОМ месте: доли раскладывает splitSupplyShares, второй арифметики нет.
(function () {
    var fs = require('fs');
    var src = fs.readFileSync(__dirname + '/../download/atex/js/production-planning/20-controller.js', 'utf8');
    var block = /#4628[\s\S]*?var shareFixTasks = \(function\(\) \{[\s\S]*?\n        \}\)\(\);/.exec(src);
    assert(!!block, 'G: фаза выравнивания долей на месте (#4628)');
    if (block) {
        assert(/splitSupplyShares\(/.test(block[0]),
            'G2: доли считает splitSupplyShares — та же функция, что у create-пути');
        assert(/Object\.keys\(createsByParent\)\.forEach/.test(block[0]),
            'G3: цепочки с продолжениями пропускаются — их доли пишет create-путь (без двойной записи)');
    }
})();

// ── H. Область фикса узкая: creates и deletes — не наш случай.
(function () {
    var fs = require('fs');
    var src = fs.readFileSync(__dirname + '/../download/atex/js/production-planning/20-controller.js', 'utf8');
    var block = /#4628[\s\S]*?var shareFixTasks = \(function\(\) \{[\s\S]*?\n        \}\)\(\);/.exec(src)[0];
    assert(/#4158/.test(block) && /delete changedChains\[chainHeadById\[String\(id\)\]/.test(block),
        'H: цепочка со СНЯТЫМ звеном пропускается — там правило консервации #4158');
})();

console.log('\n' + passed + '/' + total + ' пройдено');
