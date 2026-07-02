// Unit tests for #3848 — «Третий станок почти не занят, пока станок 4 работает 5 дней подряд».
//
// Жадное назначение станка (chooseSlitterBySetup) группирует одно сырьё/набор ножей на ОДИН
// станок → он копит работу на много дней, пока соседний простаивает. rebalanceSlitterLoad —
// итерационный пост-проход: переносит подвижные задания с перегруженного (день ≥2) станка на
// менее загруженный, минимизируя [макс. дней, пик минут, сумма квадратов]. Журнал в opts.log,
// стоп при отсутствии прогресса, защита от циклов (Set посещённых комбинаций).
//
// Run with: node experiments/atex-production-planning-3848.test.js

process.env.TZ = 'UTC';
var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

var passed = 0, failed = 0;
function assert(cond, name) {
    if (cond) { passed++; console.log('PASS — ' + name); }
    else { failed++; console.log('FAIL — ' + name); process.exitCode = 1; }
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { passed++; console.log('PASS — ' + name); }
    else { failed++; console.log('FAIL — ' + name); console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

var CAP = 450;                          // рабочая ёмкость дня станка (мин)
var SLITTERS = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }];
function maxDays(load) { return Math.max.apply(null, Object.keys(load).map(function (k) { return load[k].days; })); }
function peakMin(load) { return Math.max.apply(null, Object.keys(load).map(function (k) { return load[k].minutes; })); }
function cutsByMachine(plans) { var o = {}; plans.forEach(function (p) { o[p.slitterId] = (o[p.slitterId] || 0) + 1; }); return o; }
// Подвижное задание: одно сырьё/ножи (переналадка между ними = 0), намотка `dur` минут.
function plan(id, slitterId, dur, mat) {
    return { id: id, slitterId: String(slitterId), materialId: mat || 'A', winding: 'OUT',
        knifeWidths: [50], knifeCount: 1, isFoil: false, duration: dur };
}

// ── Сценарий issue: все 8 заданий жадно свалены на станок 4 (5 «дней»), 1–3 простаивают ──
// 8×150 намотка + 30 настройка = 1230 мин на С4 = 3 дня; С1–С3 = 0. Должны разойтись 2/2/2/2.
(function () {
    var plans = [];
    for (var i = 1; i <= 8; i++) plans.push(plan('c' + i, '4', 150));
    var steps = [];
    var res = planning.rebalanceSlitterLoad(plans, SLITTERS, {
        weights: null, dayCapacityMin: CAP,
        log: function (ev) { steps.push(ev); }
    });
    assertEqual(maxDays(res.loadBefore), 3, '#3848 старт: С4 на 3 дня (перегруз)');
    assert(res.loadBefore['1'].minutes === 0 && res.loadBefore['3'].minutes === 0, '#3848 старт: С1 и С3 простаивают (0 мин)');
    assert(res.moves.length > 0, '#3848 есть переносы');
    assertEqual(maxDays(res.loadAfter), 1, '#3848 итог: макс. день станка снизился до 1');
    assert(peakMin(res.loadAfter) < peakMin(res.loadBefore), '#3848 итог: пик минут станка упал');
    assertEqual(cutsByMachine(plans), { '1': 2, '2': 2, '3': 2, '4': 2 }, '#3848 итог: ровно по 2 задания на станок (2/2/2/2)');
    assertEqual(res.stopReason, 'no-progress', '#3848 стоп: нет улучшающего хода (не упёрлись в лимит итераций)');
    assert(steps[0].event === 'start' && steps[steps.length - 1].event === 'stop', '#3848 журнал: первое событие start, последнее stop');
    assert(steps.filter(function (s) { return s.event === 'move'; }).length === res.moves.length, '#3848 журнал: по событию на каждый перенос');
})();

// ── Уже сбалансировано: по 1 заданию на станок (всё влезает в день) → 0 переносов ──
(function () {
    var plans = [plan('a', '1', 150), plan('b', '2', 150), plan('c', '3', 150), plan('d', '4', 150)];
    var res = planning.rebalanceSlitterLoad(plans, SLITTERS, { weights: null, dayCapacityMin: CAP });
    assertEqual(res.moves.length, 0, '#3848 сбалансировано: переносов нет');
    assertEqual(res.stopReason, 'no-progress', '#3848 сбалансировано: стоп no-progress');
})();

// ── Влезает в один день на одном станке → НЕ дробим (день <2 ⇒ не донор) ──
// 2×150+30 = 330 ≤ 450 (1 день). Простаивающие станки не должны «растащить» эту работу.
(function () {
    var plans = [plan('a', '1', 150), plan('b', '1', 150)];
    var res = planning.rebalanceSlitterLoad(plans, SLITTERS, { weights: null, dayCapacityMin: CAP });
    assertEqual(res.moves.length, 0, '#3848 1-дневная работа НЕ дробится по простаивающим станкам');
    assertEqual(cutsByMachine(plans), { '1': 2 }, '#3848 1-дневная работа осталась на С1');
})();

// ── Сырьё, запрещённое на станке (stopMaterialIds) — туда не переносим ──
// С4 перегружен 8×150; станок 3 НЕ варит сырьё 'A'. Балансировка обходит С3.
(function () {
    var blocked = [{ id: '1' }, { id: '2' }, { id: '3', stopMaterialIds: ['A'] }, { id: '4' }];
    var plans = [];
    for (var i = 1; i <= 8; i++) plans.push(plan('c' + i, '4', 150, 'A'));
    var res = planning.rebalanceSlitterLoad(plans, blocked, { weights: null, dayCapacityMin: CAP });
    var byM = cutsByMachine(plans);
    assert(!byM['3'], '#3848 блокировка сырья: на С3 (запрещён A) не попало ни одного задания');
    assert(res.loadAfter['3'].cuts === 0, '#3848 блокировка сырья: С3 остался пустым');
    assert(maxDays(res.loadAfter) < maxDays(res.loadBefore), '#3848 блокировка сырья: загрузка всё равно выровнялась по С1/С2/С4');
})();

// ── Существующие резки держат базовую загрузку (fixedByMachine), новые её учитывают ──
// С1 уже занят 6 существующими резками (6×150+30=930=3 дня). Новые 6 заданий (жадно на С4)
// балансируются с учётом базы: на С1 почти не добавляют, грузят С2/С3.
(function () {
    var fixed = [];
    for (var i = 1; i <= 6; i++) fixed.push({ id: 'f' + i, materialId: 'A', winding: 'OUT', knifeWidths: [50], knifeCount: 1, isFoil: false, duration: 150 });
    var plans = [];
    for (var j = 1; j <= 6; j++) plans.push(plan('n' + j, '4', 150));
    var res = planning.rebalanceSlitterLoad(plans, SLITTERS, {
        weights: null, dayCapacityMin: CAP, fixedByMachine: { '1': fixed }
    });
    var byM = cutsByMachine(plans);
    assert((byM['1'] || 0) <= 1, '#3848 база: на и без того занятый С1 почти ничего не доложили');
    assert(maxDays(res.loadAfter) <= maxDays(res.loadBefore), '#3848 база: макс. день не вырос');
    assert(res.loadAfter['1'].minutes >= 930, '#3848 база: существующая загрузка С1 учтена (≥930)');
})();

// ── Защита от циклов и сходимость: число ходов конечно, стоп не по лимиту итераций ──
(function () {
    var plans = [];
    for (var i = 1; i <= 12; i++) plans.push(plan('c' + i, '4', 120));
    var res = planning.rebalanceSlitterLoad(plans, SLITTERS, { weights: null, dayCapacityMin: CAP, maxIters: 1000 });
    assert(res.iterations < 1000, '#3848 сходимость: уложились в лимит итераций (нет зацикливания)');
    assertEqual(res.stopReason, 'no-progress', '#3848 сходимость: остановились по отсутствию прогресса');
    // 12×120+30=1470 на С4 = 4 дня → балансировка до ~3 заданий/станок (≤1–2 дня).
    assert(maxDays(res.loadAfter) < maxDays(res.loadBefore), '#3848 сходимость: загрузка выровнялась');
})();

// ── Без заданной ёмкости (back-compat) — переносов нет (день всегда «1», донора нет) ──
(function () {
    var plans = [];
    for (var i = 1; i <= 8; i++) plans.push(plan('c' + i, '4', 150));
    var res = planning.rebalanceSlitterLoad(plans, SLITTERS, { weights: null });
    assertEqual(res.moves.length, 0, '#3848 без ёмкости: балансировка не вмешивается (обратная совместимость)');
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
