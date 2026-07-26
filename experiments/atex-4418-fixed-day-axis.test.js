// Tests for ideav/crm#4418 — «Бессмысленные перемещения, Станок 2».
//
// Сценарий (ateh, Станок 2): «Отпуск» 24.07 08:00–14:55 ограничил пятницу; одно задание заказа
// разорвано по дням — 1 проход на 24.07 (🔒), 57 на 27.07, 1 на 28.07. Оператор переносит хвост
// (1 проход, 4 минуты) с 28.07 на 27.07, где занято 183 минуты из ~450, — и получает
// «Пн, 27.07.2026 не вместил задание (день переполнен или заморожен) — оно осталось на 28.07».
//
// КОРЕНЬ: упаковщик считал дни ЛОГИЧЕСКИ (0, 1, 2 …), а нерабочие дни выносил ПОСТ-проходом
// (applyDowntime/shiftPlacementsPastDowntime). Оси расходились: остаток разорванной 🔒-резки
// уезжал на «логический» день 1 → после сдвига это календарное 27.07; перенесённый хвост
// зафиксирован на КАЛЕНДАРНОМ дне 3 (27.07), упаковщик клал его на логический день 3, и правило
// #3951 («сегмент более позднего исходного дня обязан лечь позже») выталкивало его на 28.07.
//
// ФИКС: день, ЦЕЛИКОМ закрытый для станка (выходной/праздник «Календаря» #3788 или «Отпуск»
// #3764 на всё рабочее окно), упаковщик ПРОПУСКАЕТ сразу — его ось дней совпадает с календарной,
// и зафиксированный день означает то, что написано на карточке.
//
// Плюс из той же задачи:
//   • тост с ошибкой/предупреждением НЕ исчезает сам и имеет кнопку «×» («не успеваю прочитать»);
//   • сообщение о неудавшемся переносе говорит правду: сколько проходов легло на выбранный день.
//
// Run with: node experiments/atex-4418-fixed-day-axis.test.js

process.env.TZ = 'UTC';

var fs = require('fs');
var path = require('path');
var mod = require('../download/atex/js/production-planning.js');
var planning = mod.planning;
var Controller = mod.Controller;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

var BASE = new Date(2026, 6, 24, 0, 0, 0, 0).getTime();   // Пт 24.07.2026 = день 0; 25–26 — выходные
var K11 = [80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80];
var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, KNIFE_MOVE: 0, BETWEEN_CUTS: 0, CLEANUP_SHIFT: 30 };
var DAY_SETTINGS = { DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
    LUNCH_DURATION: '40', TOTAL_INTERVALS: '15' };
// Отпуск 24.07 08:00–14:55 + выходные 25–26.07 (дни 1–2 целиком).
var VACATION = { '101': [[8 * 60, 14 * 60 + 55], [1440, 3 * 1440]] };
var WEEKEND_ONLY = { '101': [[1440, 3 * 1440]] };

function cut(id, head, dayOff, minute, runs, fixed) {
    return { id: id, orderId: 'ORD' + head, firstPartId: head, slitter: { id: '101' },
        materialId: 'MW308', winding: 'OUT', knifeWidths: K11, knifeCount: 11, rollerWidth: 0,
        plannedRuns: runs, isFoil: false, length: 300, status: '', fixed: !!fixed,
        planDate: String(Math.floor(BASE / 1000) + dayOff * 86400 + minute * 60) };
}
function planSelf(cuts, blocked) {
    return {
        cuts: cuts, changeTimes: TIMES, daySettings: DAY_SETTINGS, opTimes: { WIND_300: 3.2 },
        filter: { date: '2026-07-24', dateTo: '2026-08-06' },
        supplies: cuts.map(function (c) { return { cutId: c.id, positionId: 'P1', dueKey: 20260728 }; }),
        footageBySupply: {}, genPositions: [{ id: 'P1', dueKey: 20260728 }],
        slitters: [{ id: '101', label: 'Станок 2' }],
        nowMs: function () { return BASE; },
        workingWindow: Controller.prototype.workingWindow,
        slotPlacementOn: Controller.prototype.slotPlacementOn,
        dayIsWorking: function (ms) { var d = new Date(Number(ms)).getDay(); return d !== 0 && d !== 6; },
        slitterOnVacationDay: function () { return false; },
        planningPrevSetupBySlitter: function () { return {}; },
        blockedRangesBySlitter: function () { return blocked; }
    };
}
function opsFor(cuts, blocked) {
    return Controller.prototype.buildSequenceOps.call(planSelf(cuts, blocked), cuts, 'SETUP', false,
        { withinSlitterIds: ['101'] }).ops;
}
function placeOf(ops, id) {
    var u = (ops.updates || []).filter(function (x) { return String(x.cutId) === id; })[0];
    if (!u) return null;
    var m = (Number(u.planStartTs) * 1000 - BASE) / 60000;
    return { day: Math.floor(m / 1440), minute: Math.round(m % 1440), runs: Number(u.plannedRuns) };
}

// ── 1) Сценарий задачи: перенесённый 🔒-хвост встаёт на СВОЙ день ────────────
(function () {
    // Как после moveCutToDay: хвост отвязан от цепочки (#4357), «Дата план» = 27.07 (день 3), 🔒.
    var cuts = [
        cut('H', 'H', 0, 14 * 60 + 55, 1, true),     // голова: 1 проход после отпуска, 🔒
        cut('C1', 'H', 3, 480, 57, true),            // продолжение: 57 проходов на 27.07
        cut('C2', 'C2', 3, 480, 1, true)             // перенесённый хвост: 1 проход, 🔒 на 27.07
    ];
    var ops = opsFor(cuts, VACATION);
    assertEqual(placeOf(ops, 'H'), { day: 0, minute: 14 * 60 + 55, runs: 1 },
        'голова остаётся на своём дне сразу после «Отпуска» (24.07, 14:55)');
    var c1 = placeOf(ops, 'C1'), c2 = placeOf(ops, 'C2');
    assertEqual([c1.day, c1.runs], [3, 57], 'продолжение — на 27.07 (день 3), 57 проходов');
    assertEqual(c2 && c2.day, 3,
        '#4418: перенесённый хвост встаёт на ВЫБРАННЫЙ день 27.07, а не выталкивается на 28.07');
    assert(c2.minute >= c1.minute, 'и стоит после продолжения, встык в том же дне');
    assertEqual((ops.creates || []).length, 0, 'новых записей ради этого не создаём');
})();

// ── 2) Ось дней упаковщика = календарь (выходные пропускаются сразу) ─────────
(function () {
    // Один 🔒-хвост, зафиксированный на 27.07, и большая резка, разорванная с пятницы.
    var cuts = [cut('BIG', 'BIG', 0, 480, 200, false), cut('FIX', 'FIX', 3, 480, 1, true)];
    var ops = opsFor(cuts, WEEKEND_ONLY);
    var fix = placeOf(ops, 'FIX');
    assertEqual(fix && fix.day, 3, 'зафиксированный на 27.07 хвост остаётся на 27.07');
    // Ни один сегмент не должен попасть на выходные (дни 1–2).
    var all = (ops.updates || []).concat(ops.creates || []).map(function (u) {
        return Math.floor(((Number(u.planStartTs) * 1000 - BASE) / 60000) / 1440);
    });
    assertEqual(all.filter(function (d) { return d === 1 || d === 2; }), [],
        'на выходные (дни 1–2) упаковщик ничего не кладёт');
})();

// ── 3) Обычная раскладка без блокировок не изменилась ────────────────────────
(function () {
    var cuts = [cut('A', 'A', 0, 480, 10, false), cut('B', 'B', 0, 480, 10, false)];
    var ops = opsFor(cuts, {});
    var a = placeOf(ops, 'A'), b = placeOf(ops, 'B');
    assertEqual([a.day, a.minute], [0, 480], 'первое задание — начало смены дня 0');
    assertEqual(b.day, 0, 'второе — тот же день, встык (поведение прежнее)');
    assert(b.minute > a.minute, 'и позже первого');
})();

// ── 4) Чистая проверка: день целиком в «Отпуске» пропускается ────────────────
(function () {
    // Станок в отпуске ВЕСЬ день 0 → задание не должно оказаться в дне 0.
    var allDayOff = { '101': [[0, 1440]] };
    var ops = opsFor([cut('X', 'X', 0, 480, 5, false)], allDayOff);
    var x = placeOf(ops, 'X');
    assert(x && x.day >= 1, 'задание уехало с полностью закрытого дня (день ' + (x && x.day) + ')');
})();

// ── 5) Тост: ошибка/предупреждение не исчезает сам и закрывается кнопкой ─────
(function () {
    var js = fs.readFileSync(path.join(__dirname, '..', 'download', 'atex', 'js',
        'production-planning', '20-controller.js'), 'utf8');
    var css = fs.readFileSync(path.join(__dirname, '..', 'download', 'atex', 'css',
        'production-planning.css'), 'utf8');
    assert(/var sticky = \(kind === 'error' \|\| kind === 'warning'\)/.test(js),
        '#4418: «error»/«warning» помечаются как несамоисчезающие');
    assert(/if \(!sticky\) setTimeout\(dismiss, 3500\)/.test(js),
        'автозакрытие остаётся только у обычных сообщений');
    assert(/atex-pp-toast-close/.test(js) && /Закрыть сообщение/.test(js),
        'у тоста есть кнопка закрытия с подсказкой');
    assert(/\.atex-pp-toast-close\s*\{[^}]*cursor:\s*pointer/.test(css),
        'кнопка закрытия оформлена в CSS (иначе её не видно)');
    assert(/\.atex-pp-toast-text\s*\{[^}]*white-space:\s*pre-line/.test(css),
        'длинный текст переносится по строкам');
})();

// ── 6) Сообщение о переносе говорит правду про разрыв по дням ────────────────
(function () {
    var js = fs.readFileSync(path.join(__dirname, '..', 'download', 'atex', 'js',
        'production-planning', '20-controller.js'), 'utf8');
    assert(/Задание разорвано по дням: на ' \+ dateLabel \+ ' встало проходов/.test(js),
        '#4418: когда часть проходов легла на выбранный день — так и пишем, а не «не вместил»');
    assert(/runsOnTarget/.test(js) && /chainRecordIdsForCut\(self\.cuts/.test(js),
        'считаем по ЦЕПОЧКЕ задания, а не по одной записи');
})();

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
