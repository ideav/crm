// Unit tests for scheduleFromStored ordering by stored planStart (ideav/crm#3920).
//
// Симптом (#3920): «Овертайм» — станко-день на странице планирования уезжал далеко за смену
// (напр. до 23:15), день показывал < 450 мин («недопланирование») либо переполнение, а часть
// заданий уезжала под соседний день.
//
// Причина: с #3846 очередь показывает СОХРАНЁННЫЙ план (scheduleFromStored). Резки приходят из
// groupBySlitter в порядке «Очередности». После scope-ограниченной пересборки (#3660) «Очерёд-
// ность» и planStart могут разойтись: «застрявшая» резка с РАННЕЙ «Очередностью», но ПОЗДНИМ
// planStart (напр. хвостовая настройка на 15:58, тогда как остальные резки дня стоят с 08:00).
// Анти-нахлёст (#3885) forward-only: попав в обработку ПЕРВОЙ (по «Очередности»), такая резка
// выталкивала за собой ВСЕ резки дня в овертайм.
//
// Фикс: scheduleFromStored обрабатывает резки СТРОГО ПО ВРЕМЕНИ сохранённого planStart, а не в
// порядке «Очередности». Резка стоит там, где записана (как на РМ «Диаграмма Ганта», #3846), и
// не выталкивает соседей. #4099: реальные нахлёсты БОЛЬШЕ НЕ устраняются встык — рисуем как есть.
//
// Run with: node experiments/atex-production-planning-3920.test.js

process.env.TZ = 'UTC';

var planning = require('../download/atex/js/production-planning.js').planning;
var scheduleFromStored = planning.scheduleFromStored;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

var BASE = 0;
function cut(id, startMin, setupKnife, setupMaterial, cutAndLeader) {
    return {
        id: id,
        planDate: String(startMin * 60),                 // unix-секунды старта окна
        storedKnifeSetupMin: String(setupKnife),
        storedMaterialWindingMin: String(setupMaterial),
        storedCutAndLeaderMin: String(cutAndLeader)
    };
}
function windows(sched) {
    return sched.map(function (sc) {
        return { id: sc.cutId, ws: sc.startMin - sc.setupMin, we: sc.finishMin };
    });
}
function dayWork(sched) {
    return sched.reduce(function (s, sc) { return s + (sc.setupMin || 0) + (sc.durationMin || 0); }, 0);
}
function lastFinish(sched) {
    return sched.reduce(function (m, sc) { return Math.max(m, sc.finishMin); }, 0);
}

// ── 1. Реальный кейс #3920 (Станок 1, Чт 02.07): застрявшая резка 238013 (45 настр + 2 намотка)
// сохранена на 15:58, но по «Очередности» (стала 8, тогда как соседи 12–14) приходит ПЕРВОЙ.
// Остальные резки дня стоят с 08:00. Порядок ВХОДА — по «Очередности» (стрелая первой). ──
(function () {
    var input = [
        cut('238013', 958, 30, 15, 2),   // 15:58, настр 45 + намотка 2 (застряла, «Очередность» 8)
        cut('239630', 480, 0, 15, 167),  // 08:00, намотка 167
        cut('238161', 647, 0, 15, 84),   // 10:47, намотка 84
        cut('237845', 785, 0, 0, 109)    // 13:05, намотка 109
    ];
    var sched = scheduleFromStored(input, BASE);
    // #4099: каждая резка стоит на своём СОХРАНЁННОМ planStart как есть (перекрытия видны).
    assertEqual(windows(sched), [
        { id: '239630', ws: 480, we: 662 },   // 08:00 → 11:02
        { id: '238161', ws: 647, we: 746 },   // #4099: 10:47 как есть (нахлёст с 239630 виден)
        { id: '237845', ws: 785, we: 894 },   // 13:05 → 14:54
        { id: '238013', ws: 958, we: 1005 }   // 15:58 → 16:45 (застрявшая — на своём месте)
    ], '#4099 резки стоят на сохранённых стартах как есть (порядок по времени, без выталкивания)');
    // День НЕ уезжает в 23:15 — последний финиш в пределах смены+нахлёст, сумма = фактическая.
    assertEqual(lastFinish(sched) <= 1010, true, '#3920 последний финиш ≤ 16:50 (нет овертайма до 23:15)');
    assertEqual(Math.round(dayWork(sched)), 437, '#3920 сумма минут дня = фактическая работа (не размазана по дням)');
})();

// ── 2. Тот же набор в ПРАВИЛЬНОМ (по времени) порядке входа даёт тот же результат ──
// (устойчивость: результат зависит от сохранённого planStart, а не от порядка входа).
(function () {
    var byTime = [
        cut('239630', 480, 0, 15, 167),
        cut('238161', 647, 0, 15, 84),
        cut('237845', 785, 0, 0, 109),
        cut('238013', 958, 30, 15, 2)
    ];
    var byStale = [
        cut('238013', 958, 30, 15, 2),
        cut('239630', 480, 0, 15, 167),
        cut('238161', 647, 0, 15, 84),
        cut('237845', 785, 0, 0, 109)
    ];
    assertEqual(windows(scheduleFromStored(byStale, BASE)), windows(scheduleFromStored(byTime, BASE)),
        '#3920 результат не зависит от порядка входа (только от сохранённого planStart)');
})();

// ── 3. #4099: настоящий нахлёст (#3885) показываем КАК ЕСТЬ — обе резки на своих стартах ──
(function () {
    var sched = scheduleFromStored([
        cut('188600', 480, 30, 15, 475),   // 08:00, окно до 16:40
        cut('191769', 480, 30, 15, 16)     // тоже 08:00 → остаётся 08:00 (как есть)
    ], BASE);
    assertEqual(windows(sched), [
        { id: '188600', ws: 480, we: 1000 },
        { id: '191769', ws: 480, we: 541 }
    ], '#4099 две резки на 08:00 — обе остаются на 08:00 (перекрытие как есть)');
})();

console.log('\n' + passed + ' assertions passed.');
