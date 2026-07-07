// Unit tests for #4094 — «Расширять время плашки с перерывом на размер перерыва».
// Несущая карточка обеда/перерыва удлиняет КОНЕЦ своего окна на длительность перерыва (как бар Ганта:
// диапазон = стенные часы работа+перерыв, число минут в конце = ЧИСТАЯ работа). Старт не трогаем;
// последующие карточки по-прежнему сдвигаются (shiftByCut, #4075).
// Проверяем чистое ядро: (1) computeQueueBreakMarkers.extendByCut; (2) formatScheduleLine(...,extendMin).
//
// Run with: node experiments/atex-production-planning-4094.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function eq(a, b, name) {
    var ok = JSON.stringify(a) === JSON.stringify(b);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + ' (' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ')');
    if (ok) { passed++; } else { failed++; process.exitCode = 1; }
}

// ── extendByCut: несущая удлиняется на длительность своего перерыва/обеда ──────────────────────────
//   A 08:00–10:20 [480;620]   B 10:20–12:20 [620;740]   C 13:00–16:00 [780;960]
//   перерыв 10:00 (dur10) → несёт A; обед 12:20 (dur40) → несёт B; перерыв 15:00 (dur10) → несёт C.
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
console.log('\n== extendByCut: каждая несущая удлиняется на свой перерыв/обед ==');
var r = planning.computeQueueBreakMarkers(dayGroups, schedById, breaks);
eq(r.extendByCut.A, 10, 'A (несёт перерыв 10:00) удлиняется на 10');
eq(r.extendByCut.B, 40, 'B (несёт обед) удлиняется на 40');
eq(r.extendByCut.C, 10, 'C (несёт перерыв 15:00) удлиняется на 10');

console.log('\n== длинная карточка сквозь полдень: удлиняется на обед 40 ==');
var rl = planning.computeQueueBreakMarkers(
    { '0': [{ id: 'L' }] },
    { L: { cutId: 'L', startMin: 480, setupMin: 0, finishMin: 900, leaderMin: 0 } }, // 08:00–15:00 накрывает 12:20
    [{ startMin: 740, durationMin: 40, kind: 'lunch', label: 'Обед' }]);
eq(rl.extendByCut.L, 40, 'длинная карточка (окно накрывает обед) удлиняется на 40');

console.log('\n== перерыв без несущей / пустой список → нет удлинения ==');
var ri = planning.computeQueueBreakMarkers(
    { '0': [{ id: 'X' }] },
    { X: { cutId: 'X', startMin: 480, setupMin: 0, finishMin: 560, leaderMin: 0 } }, // 08:00–09:20
    [{ startMin: 600, durationMin: 10, kind: 'break', label: 'Перерыв' }]);
eq(ri.extendByCut, {}, 'перерыв после конца резки — нет несущей → нет удлинения');
eq(planning.computeQueueBreakMarkers(dayGroups, schedById, []).extendByCut, {}, 'нет перерывов → нет удлинения');

// ── formatScheduleLine: extendMin добавляется ТОЛЬКО к концу; минуты — рабочие (прежние) ───────────
// sc: 08:00 старт, setup 0, finish 10:20 [620], leader 0, работа 140 мин.
console.log('\n== formatScheduleLine: удлинение расширяет КОНЕЦ, число минут — рабочее ==');
var sc = { startMin: 480, setupMin: 0, finishMin: 620, leaderMin: 0, durationMin: 140 };
eq(planning.formatScheduleLine(sc, 100, true, 0, 0), '⏱ 08:00 – 10:20 · 140 мин',
   'без перерыва: 08:00–10:20 · 140 мин');
eq(planning.formatScheduleLine(sc, 100, true, 0, 40), '⏱ 08:00 – 11:00 · 140 мин',
   '#4094: несёт обед 40 → конец +40 (11:00), минуты РАБОЧИЕ прежние (140) — как «(N мин)» у Ганта');
eq(planning.formatScheduleLine(sc, 100, true, 10, 40), '⏱ 08:10 – 11:10 · 140 мин',
   '#4094: сдвиг +10 двигает СТАРТ и конец, удлинение +40 — ТОЛЬКО конец');
eq(planning.formatScheduleLine(sc, 100, true, undefined, undefined), '⏱ 08:00 – 10:20 · 140 мин',
   'обратная совместимость: без 4-го/5-го аргумента — как раньше');

console.log('\n----------------------------------------');
console.log('ИТОГО: ' + passed + ' passed, ' + failed + ' failed');
