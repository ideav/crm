// Unit tests for ideav/crm#3700 — поле «Резка и Лидер» (намотка + лидер) и его
// использование в Ганте через хранимое поле отчёта cut_planning `cut_time`.
//   • gantt.rowsToCuts    — чтение cut_time → cutTimeMin (null, если поля нет);
//   • gantt.cutBarMinutes — длина сегмента «резка+лидер»: запланированные берут cut_time,
//                           без него — грубое окно (фолбэк), начатые/завершённые — факт.
//
// Запись поля в «Планирование производства» (persistCutSetupColumns) использует ту же
// модель лидера, что buildSchedule (BETWEEN_CUTS × cutLeaderRuns), покрытую отдельно.
//
// Run with: node experiments/atex-issue-3700-cut-and-leader.test.js

process.env.TZ = 'UTC';

var gantt = require('../download/atex/js/cut-gantt.js').gantt;

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

// ── rowsToCuts: чтение cut_time ──
var cuts = gantt.rowsToCuts([
    { cut_id: '1', cut_slitter_id: '5', cut_sequence: '1', cut_time: '22' },
    { cut_id: '2', cut_slitter_id: '5', cut_sequence: '2' }   // поля нет → null
]);
assertEqual(cuts[0].cutTimeMin, 22, 'rowsToCuts: cut_time прочитан → cutTimeMin');
assertEqual(cuts[1].cutTimeMin, null, 'rowsToCuts: нет cut_time → null');

// ── cutBarMinutes: запланированная резка берёт хранимое «Резка и Лидер» ──
var planned = { planDate: '06.05.2026 08:00', cutTimeMin: 20 };
assertEqual(gantt.cutBarMinutes(planned), 20, 'cutBarMinutes: запланированная — хранимое cut_time (20)');

// Без cut_time — фолбэк на грубое окно cutTimeRange (как раньше).
var plannedNoStore = { planDate: '06.05.2026 08:00' };
var trNo = gantt.cutTimeRange(plannedNoStore);
var winNo = (trNo.endMs - trNo.startMs) / 60000;
assertEqual(gantt.cutBarMinutes(plannedNoStore), winNo, 'cutBarMinutes: без cut_time — окно cutTimeRange (фолбэк)');
assertEqual(gantt.cutBarMinutes(plannedNoStore) !== 20, true, 'cutBarMinutes: фолбэк ≠ хранимое значение другой резки');

// Начатая резка — фактическое окло (план/cut_time игнорируем, как и наладку).
var started = { planDate: '06.05.2026 08:00', startDate: '06.05.2026 08:10', endDate: '06.05.2026 09:20', cutTimeMin: 20 };
assertEqual(gantt.cutBarMinutes(started), 70, 'cutBarMinutes: начатая — фактическое окно (70), cut_time игнорируется');

// ── cutBarSegments: ширина сегмента резки масштабирует cut_time ──
// ppm=2 px/мин, minPx=8 → 20 мин × 2 = 40px (а грубое окно дало бы иное).
var seg = gantt.cutBarSegments(planned, 2, 8);
assertEqual(seg.cutPx, 40, 'cutBarSegments: cutPx = cut_time(20) × ppm(2) = 40');

console.log('\n' + passed + ' assertions passed');
