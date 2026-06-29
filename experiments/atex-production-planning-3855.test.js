// Unit tests for #3855 — «Почему опять минуты не сходятся?»
//
// Корень ±1–2 мин между Гантом и страницей: planStart (главное значение «Задания в производство»)
// получался из дробного окна расписания и НЁС СЕКУНДЫ. Гант обрезал :SS вниз, страница округляла
// вверх → расхождение. splitMachineQueue остаётся ЕДИНСТВЕННЫМ источником planStart (только он
// знает про нахлёст настройки #3805 и разрыв по дням #3635 п.5); фикс — снап штампа к ЦЕЛОЙ
// минуте (округление ВВЕРХ) в scheduleStartTimestamp. (Прежний подход #3855 — пересчитывать
// planStart по сохранённым окнам в computeCutSetupUpdates — ОТМЕНЁН: он ломал #3805/#3635 п.5,
// перекладывая всю настройку setup-only-сегмента в один день.)
//
// Run with: node experiments/atex-production-planning-3855.test.js

process.env.TZ = 'UTC';
var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

var passed = 0, failed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { passed++; console.log('PASS — ' + name); }
    else { failed++; console.log('FAIL — ' + name); console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

var base = Date.UTC(2026, 5, 29, 0, 0, 0);   // полночь 29.06.2026 (мс)

// ── scheduleStartTimestamp снапит planStart к ЦЕЛОЙ минуте (округление ВВЕРХ) ──
// Дробное окно (33.8 мин) раньше давало штамп с секундами (:48). Теперь — ровно 34-я минута.
var tsFrac = planning.scheduleStartTimestamp(base, 33.8);
assertEqual(tsFrac % 60, 0, 'штамп без секунд (кратен 60) при дробном окне 33.8');
assertEqual(tsFrac, Math.floor(base / 1000) + 34 * 60, 'окно 33.8 → 34-я минута (вверх)');

// Целое окно — на своей минуте (округление вверх ничего не двигает).
var tsInt = planning.scheduleStartTimestamp(base, 480);
assertEqual(tsInt, Math.floor(base / 1000) + 480 * 60, 'целое окно 480 → ровно 480-я минута (08:00)');
assertEqual(tsInt % 60, 0, 'целое окно — штамп без секунд');

// Соседние ЦЕЛЫЕ окна тиляются встык на целых минутах (нет ±1 мин между РМ).
var s1 = planning.scheduleStartTimestamp(base, 480);        // старт окна 1
var s2 = planning.scheduleStartTimestamp(base, 480 + 19);   // старт окна 2 (окно1 = 19 мин)
assertEqual((s2 - s1) / 60, 19, 'встык: шаг между целыми окнами = ровно 19 мин');

// Несколько дробных окон подряд — каждый штамп на целой минуте (Гант и страница совпадут).
[0.1, 12.4, 45.5, 59.9, 130.6].forEach(function(m, i) {
    assertEqual(planning.scheduleStartTimestamp(base, m) % 60, 0, 'штамп ' + (i + 1) + ' (окно ' + m + ') на целой минуте');
});

// ── computeCutSetupUpdates БОЛЬШЕ НЕ трогает planStart (источник — splitMachineQueue) ──
// Контракт: в updates есть тайминг (knife/material/cutTime), НЕТ planStartTs.
var cutMeta = { id: '110', val: 'Задание в производство', reqs: [
    { id: '96067', val: 'Наладка ножей, мин' },
    { id: '96069', val: 'Сырье/намотка, мин' },
    { id: '96778', val: 'Резка и Лидер' }
] };
function icut(id, seq) {
    return { id: id, slitter: { id: '1', label: 'Станок 1' }, materialId: 'A', winding: 'OUT',
        batchId: 'b', knifeWidths: [50], knifeCount: 1, rollerWidth: 0, isFoil: false,
        plannedRuns: 2, duration: 10, sequence: seq, planDate: String(Math.floor(base / 1000)),
        number: String(Math.floor(base / 1000)),
        storedKnifeSetupMin: '', storedMaterialWindingMin: '', storedCutAndLeaderMin: '' };
}
var ctrl = Object.create(api.Controller.prototype);
ctrl.meta = { cut: cutMeta };
ctrl.cuts = [icut('i1', 1), icut('i2', 2)];
ctrl.changeTimes = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0, CLEANUP_SHIFT: 30 };
ctrl.prevSetupBySlitter = {};
var res = ctrl.computeCutSetupUpdates(null);
assertEqual(res.updates.length > 0, true, 'computeCutSetupUpdates даёт обновления тайминга');
assertEqual(res.updates.every(function(u) { return !('planStartTs' in u); }), true,
    'computeCutSetupUpdates НЕ возвращает planStartTs (planStart пишет splitMachineQueue)');
assertEqual(res.updates[0].knife, 30, 'первая резка — настройка ножей 30 (тайминг считается как прежде)');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
