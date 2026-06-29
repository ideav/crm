// Unit tests for #3853 — Гант и production-planning: разрывы/перекрытия заданий, времена
// расходятся на ~минуту, значок перехода дня ←/→ ложный.
//
// Корень «разрывов и перекрытий»: ПЛАНОВОЕ ВРЕМЯ старта (t1078, главное значение) и
// СОХРАНЁННОЕ ОКНО (Наладка ножей + Сырьё/намотка + «Резка и Лидер») пишутся ДВУМЯ
// независимыми расчётами:
//   • positions: planCutOperations → splitMachineQueue (раскладка по дням/проходам);
//   • окно:      computeCutSetupUpdates → setupActivityColumns (отдельный проход).
// Обе РМ (#3846) рисуют ОКНО = setup + cut_time, позиционируя его по planStart. Если
// окно ≠ шаг planStart — между баром и следующим появляется разрыв (окно короче шага)
// или перекрытие (окно длиннее).
//
// Главное расхождение — ПЕРВАЯ резка станка: splitMachineQueue считала её настройку
// «ножи с нуля» (firstCutSetup), а setupActivityColumns — переналадкой от РЕАЛЬНОЙ
// заправки станка (prev_cut_setup → carryPrevCut). Разные минуты → разрыв/перекрытие
// ровно на первой карточке каждого дня.
//
// Run with: node experiments/atex-production-planning-3853.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

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

var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0, CLEANUP_SHIFT: 30 };
var DAY_START = 480, CUT_END = 970;

function cut(id, material, knives, runs) {
    return { id: id, materialId: material, winding: 'IN', batchId: 'b-' + material,
        knifeCount: (knives || [50]).length, knifeWidths: (knives || [50]), rollerWidth: 0,
        isFoil: false, plannedRuns: runs == null ? 5 : runs, slitter: { id: '1', label: 'Станок 1' },
        sequence: null, planDate: '', duration: 0 };
}

// Заправка станка (prev_cut_setup): ТЕ ЖЕ ножи [50], но ДРУГОЕ сырьё 'B'. Переналадка
// первой резки 'A' от этой заправки = смена сырья 15 мин (ножи не трогаем).
var threading = { materialId: 'B', winding: 'IN', knifeWidths: [50], knifeCount: 1 };

// ────────────────────────────────────────────────────────────────────────────────────
// 1. Базовая демонстрация расхождения на УРОВНЕ функций (splitMachineQueue vs
//    setupActivityColumns), без БД. Это «истина», против которой проверяем интеграцию.
// ────────────────────────────────────────────────────────────────────────────────────
var queue = [cut('c1', 'A'), cut('c2', 'A')];   // оба сырьё A, ножи [50] — между собой переналадки нет
var perPass = { c1: 10, c2: 10 }, runsBy = { c1: 5, c2: 5 };

// Как СЕЙЧАС считает planStart генерация: firstCutSetup, БЕЗ заправки станка.
var genBuggy = planning.splitMachineQueue(queue, {
    dayStartMin: DAY_START, dayEndMin: CUT_END, leader: 0, times: TIMES,
    perPassByCut: perPass, runsByCut: runsBy, firstCutSetup: true, gapFill: true
});
// Как считает ОКНО persistence: переналадка от заправки станка (carryPrevCut).
var carry = planning.carryOverPrevCut(threading, queue[0]);
var storedSetup = planning.setupActivityColumns(queue, TIMES, carry);

// Шаг planStart первой резки (окно c1, использованное генерацией для постановки c2).
var genStep = genBuggy[1].windowStartMin - genBuggy[0].windowStartMin;
// Сохранённое окно c1 = setup(stored) + cut_time(=ceil(dur)+leader). dur c1 = 10×5 = 50.
var storedWindowC1 = storedSetup.c1.knifeMin + storedSetup.c1.materialWindingMin + (50 + 0);
assertEqual(storedSetup.c1, { knifeMin: 0, materialWindingMin: 15 }, '#3853 окно: первая резка несёт смену сырья 15 (от заправки станка)');
assert(genBuggy[0].setupMin === 30, '#3853 баг: генерация ставит первой резке «ножи с нуля» = 30');
assert(genStep - storedWindowC1 === 15, '#3853 баг: шаг planStart (95) − окно (80) = 15 мин разрыва на первой карточке');

// ────────────────────────────────────────────────────────────────────────────────────
// 2. ФИКС: splitMachineQueue получает заправку станка (carryPrevSetup) и считает первую
//    резку переналадкой от неё — ровно как setupActivityColumns. Разрыв исчезает.
// ────────────────────────────────────────────────────────────────────────────────────
var genFixed = planning.splitMachineQueue(queue, {
    dayStartMin: DAY_START, dayEndMin: CUT_END, leader: 0, times: TIMES,
    perPassByCut: perPass, runsByCut: runsBy, firstCutSetup: true, gapFill: true,
    carryPrevSetup: threading   // #3853: заправка станка для первой резки
});
assert(genFixed[0].setupMin === 15, '#3853 фикс: первая резка = смена сырья 15 (как в окне)');
var genStepFixed = genFixed[1].windowStartMin - genFixed[0].windowStartMin;
assert(genStepFixed - storedWindowC1 === 0, '#3853 фикс: шаг planStart == окно — разрыва нет');

// Базовая ветка (генерация без gapFill) — тот же фикс.
var genFixedBase = planning.splitMachineQueue(queue, {
    dayStartMin: DAY_START, dayEndMin: CUT_END, leader: 0, times: TIMES,
    perPassByCut: perPass, runsByCut: runsBy, firstCutSetup: true,
    carryPrevSetup: threading
});
assert(genFixedBase[0].setupMin === 15, '#3853 фикс (база): первая резка = 15');

// carryPrevSetup отсутствует → поведение прежнее (ножи с нуля 30) — обратная совместимость.
assert(genBuggy[0].setupMin === 30, '#3853 совместимость: без carryPrevSetup — firstCutSetup как раньше');

// ────────────────────────────────────────────────────────────────────────────────────
// 3. Интеграция: planCutOperations с prevSetupBySlitter кладёт planStart так, что окно
//    каждой резки (setup из setupActivityColumns + cut_time) встаёт встык к следующей.
// ────────────────────────────────────────────────────────────────────────────────────
var base = Date.UTC(2026, 5, 29, 0, 0, 0);   // 29.06.2026 полночь
var ops = planning.planCutOperations(queue, {
    times: TIMES, dayStartMin: DAY_START, dayEndMin: CUT_END,
    perPassByCut: perPass, planBaseMidnightMs: base,
    preserveOrder: false, firstCutSetup: true, gapFill: true,
    prevSetupBySlitter: { '1': threading }   // #3853
});
// updates → planStartTs по возрастанию; реконструируем шаг и сравниваем с окном.
var byId = {}; ops.updates.forEach(function(u){ byId[u.cutId] = u; });
var step = (byId.c2.planStartTs - byId.c1.planStartTs) / 60;   // минут
assert(step - storedWindowC1 === 0, '#3853 интеграция: planStart-шаг planCutOperations == сохранённое окно (нет разрыва)');

// ────────────────────────────────────────────────────────────────────────────────────
// 4. Худший случай: заправка станка ПОЛНОСТЬЮ совпадает с первой резкой (та же сырьё+ножи)
//    → переналадки нет (0). Старый код резервировал «ножи с нуля» (30) → 30-минутный разрыв
//    на первой карточке И раздутая сумма минут дня (→ ложное переполнение/дробление/значок ←/→).
// ────────────────────────────────────────────────────────────────────────────────────
var sameThreading = { materialId: 'A', winding: 'IN', knifeWidths: [50], knifeCount: 1 };
var qSame = [cut('s1', 'A'), cut('s2', 'A')];
var carrySame = planning.carryOverPrevCut(sameThreading, qSame[0]);
var storedSame = planning.setupActivityColumns(qSame, TIMES, carrySame);
assertEqual(storedSame.s1, { knifeMin: 0, materialWindingMin: 0 }, '#3853 худший: совпадающая заправка → окно первой резки 0 настройки');

var genSameBuggy = planning.splitMachineQueue(qSame, {
    dayStartMin: DAY_START, dayEndMin: CUT_END, leader: 0, times: TIMES,
    perPassByCut: { s1: 10, s2: 10 }, runsByCut: { s1: 5, s2: 5 }, firstCutSetup: true, gapFill: true });
assert(genSameBuggy[0].setupMin === 30, '#3853 худший (баг): firstCutSetup резервирует 30 — фантомный разрыв');

var genSameFixed = planning.splitMachineQueue(qSame, {
    dayStartMin: DAY_START, dayEndMin: CUT_END, leader: 0, times: TIMES,
    perPassByCut: { s1: 10, s2: 10 }, runsByCut: { s1: 5, s2: 5 }, firstCutSetup: true, gapFill: true,
    carryPrevSetup: sameThreading });
assert(genSameFixed[0].setupMin === 0, '#3853 худший (фикс): первая резка 0 настройки — встык, без фантомного разрыва');
// Сумма минут дня (бейдж) больше не раздувается на 30 фантомных минут.
function daySum(segs){ return segs.reduce(function(s, x){ return s + x.setupMin + x.durationMin; }, 0); }
assert(daySum(genSameBuggy) - daySum(genSameFixed) === 30, '#3853 худший: фикс убирает 30 фантомных минут из суммы дня (меньше ложных переполнений/дроблений)');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
