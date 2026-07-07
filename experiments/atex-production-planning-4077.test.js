// Unit tests for #4077 — «rebalanceSlitterLoad не учитывает сырьевую однородность».
//
// Балансировщик минимизировал только РОВНОСТЬ загрузки [макс. дней, пик минут, сумма квадратов] и
// брал ЛЮБОЙ ход, флаттерящий пик/квадраты, — даже «косметический» перенос, кладущий ДРУГОЕ сырьё
// на уже занятый станок и не сокращающий дату окончания. Оценка настройки идёт по orderCuts
// (группировка БЕЗ срока), а реальное расписание (selectByConfig) упорядочивает по сроку (EDD,
// #4059) и чередует разные сырья с соседними сроками → лишние смены сырья (issue #4077: Станок 1 —
// 22 факт. смены на 10 разных сырья).
//
// Фикс: в счёт добавлен член «разнородность сырья ВНУТРИ станка» matHetero = Σ max(0, разных
// сигнатур − 1), рангом НИЖЕ даты окончания (срок/финиш — святое, не жертвуем сроком ради
// группировки), но ВЫШЕ пика/квадратов. Косметический перенос, разбивающий сырьё, отвергается;
// перенос, реально сокращающий дату окончания (перегруз/срок), — берётся.
//
// Run with: node experiments/atex-production-planning-4077.test.js

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
function plan(id, slitterId, mat, dur) {
    return { id: id, slitterId: String(slitterId), materialId: mat, winding: 'OUT',
        knifeWidths: [50], knifeCount: 1, isFoil: false, duration: dur || 150 };
}
// Сырья, реально стоящие на станке (по факту итогового slitterId в мутированных plans).
function materialsOn(plans, sid) {
    var set = {};
    plans.forEach(function (p) { if (String(p.slitterId) === String(sid)) set[p.materialId] = 1; });
    return Object.keys(set).sort();
}
function countOn(plans, sid, mat) {
    return plans.filter(function (p) { return String(p.slitterId) === String(sid) && p.materialId === mat; }).length;
}
function maxDays(load) { return Math.max.apply(null, Object.keys(load).map(function (k) { return load[k].days; })); }

// ── Тест A. Косметический перенос, РАЗБИВАЮЩИЙ сырьё, отвергается ────────────────────────────────
// 2 станка, оба заняты, загрузка уже на «полу» по дням (сократить maxDays нельзя):
//   С1 = 5×сырьё A (на «полу» = 2 дня), С2 = 1×сырьё B (1 день).
// Единственный улучшающий пик/квадраты ход — перекинуть A с С1 на С2. Но он кладёт A на станок с B
// (разнородность +1) и НЕ сокращает дату окончания → должен быть ОТВЕРГНУТ. Сырьё остаётся
// сгруппированным: на С2 только B, все 5 A на С1.
(function () {
    var plans = [];
    for (var i = 1; i <= 5; i++) plans.push(plan('a' + i, '1', 'A'));
    plans.push(plan('b1', '2', 'B'));
    var res = planning.rebalanceSlitterLoad(plans, [{ id: '1' }, { id: '2' }], {
        weights: null, dayCapacityMin: CAP, log: function () {}
    });
    assertEqual(res.moves.length, 0, '#4077 A: косметический перенос (разбивка сырья без выигрыша по дате) НЕ выполнен');
    assertEqual(res.stopReason, 'no-progress', '#4077 A: стоп по отсутствию прогресса');
    assertEqual(materialsOn(plans, '2'), ['B'], '#4077 A: на С2 осталось ТОЛЬКО сырьё B (A не разбросано)');
    assertEqual(countOn(plans, '1', 'A'), 5, '#4077 A: все 5 заданий сырья A остались сгруппированными на С1');
})();

// ── Тест B. Срок/финиш — святое: перенос, сокращающий дату окончания, берётся, даже разбивая сырьё ─
// 2 станка: С1 = 6×A (реальный перегруз, 3 дня), С2 = 1×B (1 день). Разгрузить С1 можно ТОЛЬКО
// перекинув A на С2 (других станков нет). Ход добавляет разнородность (A на станок с B), но
// сокращает maxDays 3→2 — дата окончания доминирует над группировкой → ход ВЫПОЛНЯЕТСЯ.
(function () {
    var plans = [];
    for (var i = 1; i <= 6; i++) plans.push(plan('a' + i, '1', 'A'));
    plans.push(plan('b1', '2', 'B'));
    var res = planning.rebalanceSlitterLoad(plans, [{ id: '1' }, { id: '2' }], {
        weights: null, dayCapacityMin: CAP, log: function () {}
    });
    assert(res.moves.length > 0, '#4077 B: перенос ради сокращения даты окончания выполнен');
    assert(maxDays(res.loadAfter) < maxDays(res.loadBefore), '#4077 B: макс. число дней станка снизилось (срок/финиш важнее группировки)');
    assert(countOn(plans, '2', 'A') > 0, '#4077 B: сырьё A перенесено на С2 — разнородность принята ради даты окончания');
})();

// ── Тест C. Инвариант #3848 цел: ОДНО сырьё по простаивающим станкам размазывается свободно ──────
// 8×A свалены на С4; matHetero=0 при ЛЮБОМ распределении одного сырья (каждый станок однороден) →
// член разнородности не мешает выравниванию → работа расходится по 4 станкам (пик/дни падают).
(function () {
    var plans = [];
    for (var i = 1; i <= 8; i++) plans.push(plan('c' + i, '4', 'A'));
    var res = planning.rebalanceSlitterLoad(plans, [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }], {
        weights: null, dayCapacityMin: CAP, log: function () {}
    });
    var used = {};
    plans.forEach(function (p) { used[p.slitterId] = 1; });
    assert(res.moves.length > 0, '#4077 C: одно сырьё — выравнивание всё равно переносит задания');
    assert(Object.keys(used).length >= 3, '#4077 C: одно сырьё размазано по ≥3 станкам (инвариант #3848 не сломан членом однородности)');
    assert(maxDays(res.loadAfter) < maxDays(res.loadBefore), '#4077 C: макс. число дней станка снизилось');
})();

console.log('\n' + passed + ' проверок прошло' + (failed ? (', ' + failed + ' упало.') : '.'));
