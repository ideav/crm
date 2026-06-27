// Unit tests for #3764 — «Отпуск станка»: автогенерация пропускает окна простоя.
// Проверяем чистое ядро: окна «Отпуска» (unix-сек) → блокированные интервалы расписания
// (downtimeBlockedRanges), поиск свободной минуты с обходом блоков (nextFreeWorkMinute),
// общий сдвиг размещений за простой (shiftPlacementsPastDowntime) и его интеграцию в
// splitMachineQueue (blockedRanges), плюс конверсию DATETIME ↔ input[datetime-local].
//
// Run with: node experiments/atex-production-planning-3764.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

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

var BASE = Date.UTC(2026, 0, 1, 0, 0, 0);   // полночь дня 0 (мс), TZ=UTC
var BASE_SEC = BASE / 1000;
function atMin(min) { return BASE_SEC + min * 60; }   // unix-сек точки «min минут от базы»

// ── 1) downtimeBlockedRanges: unix-сек → минуты от базы, фильтр/сортировка ──
assertEqual(
    planning.downtimeBlockedRanges(
        [{ start: atMin(600), end: atMin(720) }], BASE),
    [[600, 720]],
    '#3764: окно 10:00–12:00 → [[600,720]] минут от базы');

assertEqual(
    planning.downtimeBlockedRanges([
        { start: atMin(720), end: atMin(800) },
        { start: atMin(100), end: atMin(200) }
    ], BASE),
    [[100, 200], [720, 800]],
    '#3764: несколько окон сортируются по началу');

assertEqual(
    planning.downtimeBlockedRanges([
        { start: atMin(600), end: null },        // нет «Окончания» — отброшено
        { start: atMin(700), end: atMin(650) },  // конец ≤ начала — отброшено
        { start: atMin(-600), end: atMin(-60) }, // целиком до дня 0 — отброшено
        { start: atMin(300), end: atMin(360) }   // валидное
    ], BASE),
    [[300, 360]],
    '#3764: без конца / перевёрнутые / прошедшие до базы — отброшены');

// ── 2) nextFreeWorkMinute: окно дня + обход блоков ──
var DS = 480, DE = 990;   // 08:00–16:30
assertEqual(planning.nextFreeWorkMinute(600, 60, [[660, 720]], DS, DE), 600,
    '#3764: сегмент заканчивается ровно к началу блока — не двигаем');
assertEqual(planning.nextFreeWorkMinute(600, 90, [[660, 720]], DS, DE), 720,
    '#3764: сегмент въезжает в блок — выталкиваем за его конец');
assertEqual(planning.nextFreeWorkMinute(700, 30, [[660, 720]], DS, DE), 720,
    '#3764: старт внутри блока — за конец блока');
assertEqual(planning.nextFreeWorkMinute(1000, 30, [], DS, DE), 1440 + DS,
    '#3764: после конца смены — на 08:00 следующего дня');
assertEqual(planning.nextFreeWorkMinute(300, 30, [], DS, DE), DS,
    '#3764: до начала смены — подтягиваем к 08:00');

// ── 3) shiftPlacementsPastDowntime: общий сдвиг с сохранением встык-порядка ──
var acc = {
    windowStart: function(it) { return it.ws; },
    length: function(it) { return it.len; },
    shift: function(it, d) { it.ws += d; }
};
var one = [{ ws: 0, len: 60 }];
planning.shiftPlacementsPastDowntime(one, [[20, 50]], 0, 600, acc);
assertEqual(one[0].ws, 50, '#3764: одиночное размещение, пересекающее простой, сдвигается за него');

var two = [{ ws: 0, len: 30 }, { ws: 30, len: 30 }];
planning.shiftPlacementsPastDowntime(two, [[40, 80]], 0, 600, acc);
assertEqual([two[0].ws, two[1].ws], [0, 80],
    '#3764: первая до простоя — на месте; вторая (въезжала бы в простой) — за конец блока');

var noop = [{ ws: 0, len: 60 }, { ws: 60, len: 60 }];
planning.shiftPlacementsPastDowntime(noop, [], 0, 600, acc);
assertEqual([noop[0].ws, noop[1].ws], [0, 60], '#3764: пустой blockedRanges — без сдвигов (no-op)');

// ── 4) Интеграция в splitMachineQueue: окно простоя сдвигает резку ──
function cut(id, material, knifeWidths, runs) {
    return { id: id, slitter: { id: 'm1' }, materialId: material, winding: 'OUT',
        knifeWidths: knifeWidths, knifeCount: knifeWidths.length, plannedRuns: runs };
}
var TIMES = { BETWEEN_CUTS: 0 };
var optsBase = { dayStartMin: 0, dayEndMin: 600, times: TIMES,
    perPassByCut: { A: 10 }, runsByCut: { A: 6 }, dayAnchorByCut: { A: 0 } };

var without = planning.splitMachineQueue([cut('A', 'M1', [59, 59], 6)], optsBase);
assertEqual(without[0].windowStartMin, 0, '#3764: без простоя резка A стартует в 00 (контроль)');

var withDt = planning.splitMachineQueue([cut('A', 'M1', [59, 59], 6)],
    Object.assign({}, optsBase, { blockedRanges: [[20, 50]] }));
assertEqual(withDt[0].windowStartMin, 50,
    '#3764: простой 20–50 — резка A (намотка 60) выталкивается на 50');
assertEqual(withDt[0].startMin, 50,
    '#3764: startMin сегмента тоже сдвинут на величину простоя');

// ── 5) DATETIME ↔ input[datetime-local] (TZ=UTC, минутная точность) ──
var sec = Date.UTC(2026, 5, 27, 14, 30, 0) / 1000;
assertEqual(planning.unixToDatetimeLocal(sec), '2026-06-27T14:30',
    '#3764: unix-сек → значение datetime-local');
assertEqual(planning.datetimeLocalToUnix('2026-06-27T14:30'), sec,
    '#3764: datetime-local → unix-сек (обратно)');
assertEqual(planning.unixToDatetimeLocal(0), '', '#3764: 0/пусто → ""');
assertEqual(planning.datetimeLocalToUnix(''), null, '#3764: пустая строка → null');

console.log('\n' + passed + ' assertions passed');
