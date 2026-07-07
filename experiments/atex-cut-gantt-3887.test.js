// Unit tests for cut-gantt bar placement — «РИСУЕМ КАК ЕСТЬ» (ideav/crm#4099, ревизия #3887).
//
// Both РМ — the queue (scheduleFromStored) and the Gantt (layoutGroups/dedupeBarStarts) —
// draw ONE saved plan (planStart = t1078). #3887 used to lay same-day cuts EDGE TO EDGE
// (anti-overlap), which hid an over-booked day behind a continuous train running far past
// the shift end (#4099). The customer asked to draw AS IS: dedupeBarStarts now returns the
// SAVED start of every bar verbatim (no shift). Because each cut is its own Gantt row,
// overlapping windows are shown honestly (bars share the same left edge) instead of being
// serialized into the night.
//
// Run with: node experiments/atex-cut-gantt-3887.test.js

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

var ms = gantt.parseDateTimeMs;

// Планируемая резка: окно = (наладка ножей + смена сырья) + «Резка и Лидер» (cutTimeMin).
function cut(id, planDate, knife, material, cutAndLeader, seq) {
    return {
        id: id, number: planDate, planDate: planDate,
        sequence: seq == null ? null : seq,
        slitter: { id: '4', label: 'Станок 4' },
        setupKnifeMin: knife, setupMaterialMin: material, cutTimeMin: cutAndLeader
    };
}
// Начатая резка: есть факт. старт → бар по фактическому времени.
function runningCut(id, startDate, endDate) {
    return {
        id: id, number: startDate, planDate: startDate,
        startDate: startDate, endDate: endDate,
        slitter: { id: '4', label: 'Станок 4' }
    };
}

// ── 1. #4099: коллизия (обе на 08:00) — старты КАК ЕСТЬ (обе остаются на 08:00) ──
(function () {
    var starts = gantt.dedupeBarStarts([
        cut('188600', '03.07.2026 08:00', 30, 15, 475, 1),
        cut('191769', '03.07.2026 08:00', 30, 15, 16, 25)
    ]);
    assertEqual(starts, [ms('03.07.2026 08:00'), ms('03.07.2026 08:00')],
        '#4099 коллизия — обе резки остаются на сохранённом 08:00 (не разносятся встык)');
})();

// ── 2. Непересекающиеся старты (в т.ч. обеденный зазор) — как есть (#3846) ──
(function () {
    var starts = gantt.dedupeBarStarts([
        cut('A', '03.07.2026 08:00', 0, 0, 200),   // 08:00–11:20
        cut('B', '03.07.2026 12:20', 0, 0, 60)     // 12:20–13:20
    ]);
    assertEqual(starts, [ms('03.07.2026 08:00'), ms('03.07.2026 12:20')],
        'непересечение — разные старты не трогаются');
})();

// ── 3. Одинаковое 08:00, но РАЗНЫЕ дни — раздельно ──
(function () {
    var starts = gantt.dedupeBarStarts([
        cut('D0', '03.07.2026 08:00', 0, 0, 60),
        cut('D1', '04.07.2026 08:00', 0, 0, 60)
    ]);
    assertEqual(starts, [ms('03.07.2026 08:00'), ms('04.07.2026 08:00')],
        'разные дни — оба в 08:00 остаются раздельными');
})();

// ── 4. #4099: три резки на 08:00 — все остаются на 08:00 (как есть) ──
(function () {
    var starts = gantt.dedupeBarStarts([
        cut('C1', '03.07.2026 08:00', 0, 0, 100),
        cut('C2', '03.07.2026 08:00', 0, 0, 50),
        cut('C3', '03.07.2026 08:00', 0, 0, 30)
    ]);
    assertEqual(starts, [ms('03.07.2026 08:00'), ms('03.07.2026 08:00'), ms('03.07.2026 08:00')],
        '#4099 каскад — три резки с общим стартом остаются на 08:00');
})();

// ── 5. #4099: частичный нахлёст сохраняется как есть ──
(function () {
    var starts = gantt.dedupeBarStarts([
        cut('P1', '03.07.2026 08:00', 0, 0, 120),   // 08:00–10:00
        cut('P2', '03.07.2026 09:00', 0, 0, 40)     // 09:00 → остаётся 09:00 (нахлёст виден)
    ]);
    assertEqual(starts, [ms('03.07.2026 08:00'), ms('03.07.2026 09:00')],
        '#4099 частичный нахлёст — поздняя резка остаётся на своём сохранённом старте');
})();

// ── 6. Начатую резку (есть факт. старт) показываем по её реальному времени (как есть) ──
(function () {
    var starts = gantt.dedupeBarStarts([
        cut('PLAN', '03.07.2026 08:00', 30, 15, 475),
        runningCut('RUN', '03.07.2026 08:00', '03.07.2026 08:40')
    ]);
    assertEqual(starts, [ms('03.07.2026 08:00'), ms('03.07.2026 08:00')],
        'начатая резка — бар по факт. времени (как есть)');
})();

// ── 7. Интеграция layoutGroups: коллизия рисуется КАК ЕСТЬ — оба бара с одного левого края,
//      реальной ширины, подпись по сохранённому старту; перекрытие видно (#4099). ──
(function () {
    var range = gantt.ganttRange('2026-07-03', 'day');
    var now = ms('2026-07-03 09:00');
    var laid = gantt.layoutGroups([
        cut('188600', '03.07.2026 08:00', 30, 15, 475, 1),
        cut('191769', '03.07.2026 08:00', 30, 15, 16, 25)
    ], range, now, {}, { pxPerMin: 2 });
    var tasks = laid.groups[0].tasks.map(function (t) {
        return [t.cut.id, t.leftPx, t.widthPx, t.barText];
    });
    // Обе резки — 08:00 (leftPx 0). Ширина реальная: 520 мин × 2 = 1040 px и 61 мин × 2 = 122 px.
    // Подпись — по сохранённому старту 08:00.
    assertEqual(tasks, [
        ['188600', 0, 1040, '08:00-16:40 (520 мин)'],
        ['191769', 0, 122, '08:00-09:01 (61 мин)']
    ], 'layoutGroups #4099 — бары как есть: общий левый край, реальная ширина, подпись по старту');
    // Инвариант «как есть»: перекрытие ВИДНО — 2-я начинается внутри окна 1-й (не вытолкнута).
    var t0 = laid.groups[0].tasks[0], t1 = laid.groups[0].tasks[1];
    assertEqual(t1.leftPx < t0.leftPx + t0.widthPx, true,
        'layoutGroups #4099 — перекрытие показано как есть (2-я в пределах окна 1-й)');
})();

console.log('\n' + passed + ' assertions passed.');
