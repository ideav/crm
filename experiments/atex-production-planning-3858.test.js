// Unit tests — сегмент НАСТРОЙКИ в основном дроблении по дням (splitMachineQueue, #3635 п.5)
// кладёт в хвост дня N ТОЛЬКО подмножество настройки, влезающее в потолок нахлёста (как ветка
// gapFill / #3760 / #3805), а ОСТАТОК настройки переносит на продолжение дня N+1.
//
// Регресс: основной цикл клал в хвост дня N ВСЮ переналадку (ножи 30 + сырьё 15 = 45), как
// только она «влезала» в потолок нахлёста настройки. Оператору доставалось «и ножи, И сырьё в
// один день» с нахлёстом за конец смены, хотя по ограничениям влезала только часть (ножи 30 до
// «16:40»). Заказчик: «надо было сделать что-то одно — настройку ножей; сырьё и резка — завтра».
//
// Run with: node experiments/atex-production-planning-setup-split.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

// KNIFE 30 / MATERIAL_WINDING 15, лидер 0.
var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 };
function cut(id, material, kw, runs) {
    return { id: id, slitter: { id: 'm1' }, materialId: material, winding: 'OUT',
        knifeWidths: kw, knifeCount: kw.length, rollerWidth: 0, plannedRuns: runs };
}

// ── Сценарий заказчика: A заполняет окно резки до конца (clock=100=cutEnd). B — другие ножи И
// сырьё (setup = ножи 30 + сырьё 15 = 45). Потолок нахлёста НАСТРОЙКИ = +30 (до «16:40»). Ножи 30
// ровно влезают в нахлёст, сырьё 15 — уже за потолок → в хвост дня0 ТОЛЬКО ножи 30, остаток
// (сырьё 15) + проходы — на день1. ──
var A = cut('A', 'MA', [10, 10], 1);
var B = cut('B', 'MB', [20, 20], 3);
var segs = planning.splitMachineQueue([A, B], {
    dayStartMin: 0, dayEndMin: 100, dayEndHourMin: 100, maxOverworkCutsMin: 0, maxOverworkTuneMin: 30,
    times: TIMES, perPassByCut: { A: 100, B: 96 }, runsByCut: { A: 1, B: 3 }
});
var bSegs = segs.filter(function(s) { return s.cutId === 'B'; });

// День0: сегмент НАСТРОЙКИ — ТОЛЬКО ножи 30 (не 45), 0 проходов, кончается в 130 («16:40»).
assertEqual({ day: bSegs[0].dayOffset, runs: bSegs[0].runs, setupOnly: !!bSegs[0].setupOnly,
    setup: bSegs[0].setupMin, end: bSegs[0].startMin + bSegs[0].durationMin },
    { day: 0, runs: 0, setupOnly: true, setup: 30, end: 130 },
    'хвост дня0 — ТОЛЬКО ножи 30 (16:10→16:40), без сырья, без нахлёста за +30');

// День1: продолжение несёт ОСТАТОК настройки (сырьё 15) перед проходами.
assertEqual({ day: bSegs[1].dayOffset, runs: bSegs[1].runs, setup: bSegs[1].setupMin, cont: !!bSegs[1].isContinuation },
    { day: 1, runs: 1, setup: 15, cont: true },
    'день1: продолжение несёт остаток настройки (сырьё 15) + первый проход');

// Дальнейшие проходы B — без повторной настройки (ножи/сырьё уже выставлены).
assertEqual(bSegs.slice(2).map(function(s) { return s.setupMin; }), [0, 0],
    'остальные проходы B — без настройки (0)');

// Суммарная настройка цепочки сохранена: 30 (хвост) + 15 (продолжение) = 45 (полная переналадка).
assertEqual(bSegs[0].setupMin + bSegs[1].setupMin, 45, 'суммарная настройка сохранена (30 + 15 = 45)');

// ── Полная настройка влезает в нахлёст целиком → кладётся целиком (без дробления настройки) ──
// Потолок нахлёста +50: вся настройка 45 ≤ 50 → сегмент настройки = 45, остатка нет.
var segs2 = planning.splitMachineQueue([cut('A', 'MA', [10, 10], 1), cut('B', 'MB', [20, 20], 3)], {
    dayStartMin: 0, dayEndMin: 100, dayEndHourMin: 100, maxOverworkCutsMin: 0, maxOverworkTuneMin: 50,
    times: TIMES, perPassByCut: { A: 100, B: 96 }, runsByCut: { A: 1, B: 3 }
});
var b2 = segs2.filter(function(s) { return s.cutId === 'B'; });
assertEqual({ setupOnly: !!b2[0].setupOnly, setup: b2[0].setupMin, contSetup: b2[1].setupMin },
    { setupOnly: true, setup: 45, contSetup: 0 },
    'вся настройка 45 влезает в нахлёст +50 → целиком в хвост, продолжение без остатка');

// ── Не влезает даже подмножество (потолок +10 < ножи 30 и < сырьё... минимум 15>10) → вся резка
// на чистый следующий день, в хвосте дня0 настройки нет (#3847). ──
var segs3 = planning.splitMachineQueue([cut('A', 'MA', [10, 10], 1), cut('B', 'MB', [20, 20], 3)], {
    dayStartMin: 0, dayEndMin: 100, dayEndHourMin: 100, maxOverworkCutsMin: 0, maxOverworkTuneMin: 10,
    times: TIMES, perPassByCut: { A: 100, B: 96 }, runsByCut: { A: 1, B: 3 }
});
var b3 = segs3.filter(function(s) { return s.cutId === 'B'; });
assertEqual(b3.some(function(s) { return s.setupOnly; }), false,
    'потолок +10 не вмещает минимальный компонент (15) → сегмента настройки в день0 нет');
assertEqual({ day: b3[0].dayOffset, setup: b3[0].setupMin }, { day: 1, setup: 45 },
    'вся резка B (с полной настройкой 45) — на день1');

console.log('\n' + passed + ' passed');
