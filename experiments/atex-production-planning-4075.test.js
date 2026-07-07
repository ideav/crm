// Unit tests for #4075 — обед/перерывы в очереди РМ «Планирование»: серый значок на несущей
// карточке (той, чьё сохранённое окно накрывает перерыв/обед) + сдвиг последующих окон дня.
// Проверяем чистое ядро computeQueueBreakMarkers (DOM-рендер не тестируем). Правила:
//   • несущая = первая карточка, чьё окно [start−setup; finish+leader] накрывает время;
//   • обед (kind 'lunch') зашит в planStart зазором → значок БЕЗ сдвига; окно несущей кончается
//     ровно на LUNCH_START → фолбэк: последняя карточка, закончившаяся к обеду;
//   • перерыв (kind 'break') не зашит → значок + сдвиг ВСЕХ последующих карточек дня;
//   • перерыв без несущей (простой/после последней резки) — не рисуется и не сдвигает.
//
// Run with: node experiments/atex-production-planning-4075.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function eq(a, b, name) {
    var ok = JSON.stringify(a) === JSON.stringify(b);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + ' (' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ')');
    if (ok) { passed++; } else { failed++; process.exitCode = 1; }
}

// ── День 0, три карточки (setup=0, leader=0 → окно = [startMin; finishMin]) ────────────────────
//   A 08:00–10:20 [480;620]   B 10:20–12:20 [620;740]   C 13:00–16:00 [780;960]
// Перерывы/обед: 10:00 (600, break), 12:20 (740, lunch), 15:00 (900, break); длит. перерыва 10, обеда 40.
var schedById = {
    A: { cutId: 'A', startMin: 480, setupMin: 0, finishMin: 620, leaderMin: 0 },
    B: { cutId: 'B', startMin: 620, setupMin: 0, finishMin: 740, leaderMin: 0 },
    C: { cutId: 'C', startMin: 780, setupMin: 0, finishMin: 960, leaderMin: 0 }
};
var dayGroups = { '0': [{ id: 'A' }, { id: 'B' }, { id: 'C' }] };
var breaks = [
    { startMin: 600, durationMin: 10, kind: 'break', label: 'Перерыв' },
    { startMin: 740, durationMin: 40, kind: 'lunch', label: 'Обед' },
    { startMin: 900, durationMin: 10, kind: 'break', label: 'Перерыв' }
];

console.log('\n== несущие карточки: A←перерыв 10:00, B←обед 12:20 (фолбэк «кончилась к обеду»), C←перерыв 15:00 ==');
var r = planning.computeQueueBreakMarkers(dayGroups, schedById, breaks);
eq(r.markersByCut.A, [{ label: 'Перерыв', startMin: 600, endMin: 610, kind: 'break' }], 'A несёт перерыв 10:00');
eq(r.markersByCut.B, [{ label: 'Обед', startMin: 740, endMin: 780, kind: 'lunch' }], 'B несёт обед (окно кончается на 12:20)');
eq(r.markersByCut.C, [{ label: 'Перерыв', startMin: 900, endMin: 910, kind: 'break' }], 'C несёт перерыв 15:00');

console.log('\n== сдвиг: перерыв 10:00 двигает B и C на +10; обед НЕ двигает; перерыв 15:00 — после C некого ==');
eq(r.shiftByCut.B, 10, 'B сдвинута на перерыв до неё (+10)');
eq(r.shiftByCut.C, 10, 'C сдвинута на перерыв 10:00 (+10), обед и перерыв 15:00 её не двигают');
eq(r.shiftByCut.A === undefined, true, 'A (несущая первого перерыва) не сдвинута');

console.log('\n== длинная карточка сквозь полдень: обед ВНУТРИ окна (строгое накрытие, без фолбэка) ==');
var longCard = { '0': [{ id: 'L' }] };
var schedLong = { L: { cutId: 'L', startMin: 480, setupMin: 0, finishMin: 900, leaderMin: 0 } }; // 08:00–15:00
var rl = planning.computeQueueBreakMarkers(longCard, schedLong, [{ startMin: 740, durationMin: 40, kind: 'lunch', label: 'Обед' }]);
eq(rl.markersByCut.L, [{ label: 'Обед', startMin: 740, endMin: 780, kind: 'lunch' }], 'обед на длинной карточке (окно накрывает 12:20)');

console.log('\n== перерыв в простое/после последней резки — не рисуется и не сдвигает ==');
var idle = { '0': [{ id: 'X' }] };
var schedIdle = { X: { cutId: 'X', startMin: 480, setupMin: 0, finishMin: 560, leaderMin: 0 } }; // 08:00–09:20
var ri = planning.computeQueueBreakMarkers(idle, schedIdle, [{ startMin: 600, durationMin: 10, kind: 'break', label: 'Перерыв' }]);
eq(ri.markersByCut, {}, 'перерыв 10:00 после конца резки (09:20) — нет несущей → нет значка');
eq(ri.shiftByCut, {}, 'нет сдвига без несущей');

console.log('\n== многодневность: время перерыва берётся ОТ ПОЛУНОЧИ каждого дня (base = day*1440) ==');
var d2 = { '1': [{ id: 'D' }] };
var schedD2 = { D: { cutId: 'D', startMin: 1440 + 480, setupMin: 0, finishMin: 1440 + 620, leaderMin: 0 } }; // день 1, 08:00–10:20
var rd = planning.computeQueueBreakMarkers(d2, schedD2, [{ startMin: 600, durationMin: 10, kind: 'break', label: 'Перерыв' }]);
eq(rd.markersByCut.D, [{ label: 'Перерыв', startMin: 600, endMin: 610, kind: 'break' }], 'день 1: окно 08:00–10:20 (по своей полуночи) накрывает 10:00');

console.log('\n== нет перерывов в настройках → пусто ==');
var re = planning.computeQueueBreakMarkers(dayGroups, schedById, []);
eq(re.markersByCut, {}, 'пустой список перерывов → нет значков');
eq(re.shiftByCut, {}, 'пустой список перерывов → нет сдвигов');

console.log('\n== intraDayBreaks: из «Настройки» получаем 2 перерыва + обед (обе орфографии SECCOND/SECOND) ==');
var br = planning.intraDayBreaks({
    FIRST_INTERVAL: '10:00', SECCOND_INTERVAL: '15:00', INTERVAL_DURATION: '10',
    LUNCH_START: '12:20', LUNCH_DURATION: '40'
});
eq(br.length, 3, 'три записи (2 перерыва + обед)');
eq(br.map(function(b) { return [b.startMin, b.kind, b.label]; }),
   [[600, 'break', 'Перерыв'], [740, 'lunch', 'Обед'], [900, 'break', 'Перерыв']],
   'отсортированы по времени, kind/label верны');

console.log('\n----------------------------------------');
console.log('ИТОГО: ' + passed + ' passed, ' + failed + ' failed');
