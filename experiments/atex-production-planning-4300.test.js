// #4300 — «после первого задания дня ВСЕГДА стоит дырка в полчаса» (появилась после ручного переноса).
//
// Диагноз (по реальным данным ateh, Станок 1 22.07): первое задание дня MW308 (08:00–09:30, окно 90,
// хранимая наладка k0+m0), следующее задание MR194 стоит с 10:15 — «дыра» 45 мин. На Станке 2 первое
// задание MW308 (окно 207, наладка k0+m15), следующее — с задержкой 30 мин.
//
// Корень: #4294 (cutsBeforeWindowToKeep) убирает задания ПРОШЛЫХ дней из planInput. Станок к началу
// окна уже несёт наладку вчерашней резки ПЛАНА, но prevSetupBySlitter остаётся из prev_cut_setup —
// слепка ПОСЛЕДНЕЙ ФИЗИЧЕСКИ НАЧАТОЙ резки станка (обычно НЕ пустого, но и НЕ вчерашней резки плана).
// splitMachineQueue заряжает ПЕРВОЙ резке окна переналадку от этой СТАРОЙ конфигурации, а
// computeCutSetupUpdates (по ВСЕЙ группе станка: вчера MW308 → сегодня MW308) считает её near-zero
// переналадкой. Окно упаковщика длиннее хранимой наладки → «дыра» размером changeover(prev_cut_setup,
// перваяРезка) после первого задания.
//
// Фикс #4300: prevSetupFromExcludedCuts восстанавливает заправку станка = конфигурация ПОСЛЕДНЕЙ (по
// planStart) исключённой резки; ею переопределяем prevSetupBySlitter. Первая резка окна той же
// конфигурации получает 0 наладки — упаковщик и хранимые колонки сходятся, дыры нет.
//
// Run with: node experiments/atex-production-planning-4300.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function eqo(a, e, name) {
    var ok = JSON.stringify(a) === JSON.stringify(e);
    assert(ok, name + (ok ? '' : '\n  ожидалось ' + JSON.stringify(e) + '\n  получено  ' + JSON.stringify(a)));
}

var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, KNIFE_MOVE: 0, BETWEEN_CUTS: 0 };
var DAY = 1440;

// Конфигурация резок станка m1. planDate — unix-сек (день·сутки). База «С» = день 1 (22.07-аналог).
// A — вчерашняя резка (день 0, раньше «С»), исключается #4294. B — первое задание окна той же
// конфигурации (MW308, те же ножи). C — следующее задание (MR194, другие ножи+сырьё).
function cut(id, dayOffset, mat, kw, runs) {
    return { id: id, slitter: { id: 'm1' }, materialId: mat, winding: 'OUT', batchId: '',
        knifeWidths: kw, knifeCount: kw.length, rollerWidth: 0, plannedRuns: runs,
        planDate: String(dayOffset * DAY * 60), duration: String(runs * 30) };
}
var A = cut('A', 0, 'MW308', [59, 59], 2);   // вчера (исключается)
var B = cut('B', 1, 'MW308', [59, 59], 3);   // первое задание окна: та же конфигурация → наладки НЕТ
var C = cut('C', 1, 'MR194', [50], 1);       // следующее: смена сырья + ножей

// ── 1) prevSetupFromExcludedCuts: заправка = конфигурация последней исключённой резки станка ─────────
(function () {
    var carry = planning.prevSetupFromExcludedCuts([A, B, C], ['A']);
    eqo(carry.m1, { materialId: 'MW308', winding: 'OUT', knifeWidths: [59, 59], knifeCount: 2 },
        '#4300: заправка m1 восстановлена из исключённой вчерашней резки A (MW308, ножи 59,59)');
    // Несколько исключённых — берём ПОСЛЕДНЮЮ (макс. planStart).
    var A0 = cut('A0', -2, 'MR300', [70], 1), A1 = cut('A1', 0, 'MW308', [59, 59], 1);
    var carry2 = planning.prevSetupFromExcludedCuts([A0, A1, B], ['A0', 'A1']);
    eqo(carry2.m1.materialId, 'MW308', '#4300: при нескольких исключённых берём позднейшую (MW308, не MR300)');
    // Пустой keepIds → никого не трогаем.
    eqo(planning.prevSetupFromExcludedCuts([A, B, C], []), {}, '#4300: пустой keepIds → {}');
})();

// ── 2) Инвариант «нет дыры»: окно упаковщика первой резки = хранимой наладке (setupActivityColumns) ──
// Хранимые колонки считаются по ВСЕЙ группе станка (как computeCutSetupUpdates): A=firstSetup, B=0, C=45.
var stored = planning.setupActivityColumns([A, B, C], TIMES, null);
eqo(stored.B, { knifeMin: 0, materialWindingMin: 0 },
    '#4300: хранимая наладка B (та же конфигурация, что вчера) = 0 (ножи/сырьё уже на станке)');

function runsMap(arr) { var m = {}; arr.forEach(function (c) { m[c.id] = c.plannedRuns; }); return m; }
function perPassMap(arr) { var m = {}; arr.forEach(function (c) { m[c.id] = 30; }); return m; }

// Окно резки в рендере (#4099 «как есть»): [windowStart, windowStart + хранимая_наладка + хранимая_намотка].
// storedDur = duration (намотка+лидер); при BETWEEN_CUTS=0 совпадает с проходами упаковщика (runs·perPass).
function gapAfterFirst(segs) {
    var byId = {}; segs.forEach(function (s) { byId[s.cutId] = s; });
    var b = byId.B, c = byId.C;
    var bSetup = stored.B.knifeMin + stored.B.materialWindingMin;
    var bDur = Number(B.duration);
    var bWindowEnd = b.windowStartMin + bSetup + bDur;   // конец окна B по ХРАНИМЫМ полям (что рисует Гант/очередь)
    return c.windowStartMin - bWindowEnd;                // >0 → «дыра» после первого задания
}

var packOpts = {
    dayStartMin: 0, dayEndMin: 600, times: TIMES,
    perPassByCut: perPassMap([B, C]), runsByCut: runsMap([B, C]),
    dayAnchorByCut: {}, firstCutSetup: true, gapFill: true
};

// prev_cut_setup — слепок СТАРОЙ (физически начатой) конфигурации станка: НЕпустой, но не MW308 плана.
// Отличается и сырьём, и ножами от B → changeover 45 (как на Станке 1).
var STALE_PREV = { materialId: 'MWR999', winding: 'OUT', knifeWidths: [80], knifeCount: 1 };

// (a) БЕЗ восстановления заправки (баг): B заряжается переналадкой от СТАРОГО prev_cut_setup (45) → дыра 45.
var segsBug = planning.splitMachineQueue([B, C],
    Object.assign({}, packOpts, { carryPrevSetup: STALE_PREV }));
assert(gapAfterFirst(segsBug) === 45,
    '#4300 (демонстрация бага): stale prev_cut_setup (чужая конфигурация) → первое задание заряжает переналадку 45 → дыра 45 мин');

// (b) С восстановленной заправкой (фикс): B — переналадка 0 от вчерашней MW308 → дыры нет.
var carry = planning.prevSetupFromExcludedCuts([A, B, C], ['A']);
var segsFix = planning.splitMachineQueue([B, C],
    Object.assign({}, packOpts, { carryPrevSetup: carry.m1 }));
assert(gapAfterFirst(segsFix) === 0,
    '#4300 (фикс): заправка из исключённой вчерашней резки → первое задание без наладки → дыры нет');

// ── 3) Смена сырья у первой резки окна (аналог Станка 2: вчера MR194 → сегодня MW308) — дыра = ножи 30 ─
(function () {
    var Ay = cut('Ay', 0, 'MR194', [59, 59], 2);   // вчера MR194
    var By = cut('By', 1, 'MW308', [59, 59], 3);    // сегодня MW308: смена СЫРЬЯ (ножи те же) → наладка 15
    var storedY = planning.setupActivityColumns([Ay, By], TIMES, null);
    eqo(storedY.By, { knifeMin: 0, materialWindingMin: 15 },
        '#4300: хранимая наладка первой резки при смене сырья (ножи те же) = 15');
    var carryY = planning.prevSetupFromExcludedCuts([Ay, By], ['Ay']);
    var optsY = {
        dayStartMin: 0, dayEndMin: 600, times: TIMES,
        perPassByCut: { By: 30 }, runsByCut: { By: 3 },
        dayAnchorByCut: {}, firstCutSetup: true, gapFill: true
    };
    // Баг: переналадка от СТАРОГО prev_cut_setup 45 (чужие сырьё+ножи) против хранимых 15 → дыра 30
    // (ровно «полчаса», как на Станке 2: старая конфигурация отличается ножами от сегодняшней).
    var bug = planning.splitMachineQueue([By], Object.assign({}, optsY, { carryPrevSetup: STALE_PREV }));
    assert(bug[0].startMin - (bug[0].windowStartMin + storedY.By.knifeMin + storedY.By.materialWindingMin) === 30,
        '#4300 (демонстрация): stale prev_cut_setup 45 vs хранимые 15 → дыра 30 мин (полчаса)');
    // Фикс: переналадка от вчерашней MR194 = смена сырья 15 → совпадает с хранимым → дыры нет.
    var fix = planning.splitMachineQueue([By], Object.assign({}, optsY, { carryPrevSetup: carryY.m1 }));
    assert(fix[0].startMin - (fix[0].windowStartMin + storedY.By.knifeMin + storedY.By.materialWindingMin) === 0,
        '#4300 (фикс): смена сырья — наладка упаковщика = хранимой (15) → дыры нет');
})();

console.log('\n' + passed + '/' + total + ' passed');
