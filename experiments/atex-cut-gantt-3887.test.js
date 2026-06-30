// Unit tests for the cut-gantt anti-overlap guard (ideav/crm#3887).
//
// Sibling of the production-planning queue guard #3885/#3886. Both РМ — the queue
// («Планирование производства», scheduleFromStored) and the Gantt diagram («Диаграмма
// Ганта», layoutGroups) — draw ONE saved plan (planStart = t1078). When two cuts of the
// SAME machine on one day carry the same / overlapping stored planStart (a leftover of an
// incomplete start re-pack: a move before #3840, or a re-sequence limited to the filter
// scope #3660), their bars land on the same axis point → they overlap. #3886 fixed the
// queue; this fixes the Gantt track the same way.
//
// dedupeBarStarts lays same-day cuts edge to edge: a cut's window (setup + cut) never
// starts before the previous same-day cut's window ends. Only PLANNED bars are moved —
// started/finished cuts show real time as-is, but their window still pushes the next
// planned bar. Non-overlapping saved starts (incl. lunch gaps) and cuts on different days
// stay exactly as stored (display == saved, #3846 philosophy). layoutGroups then positions
// and labels each bar by the deduped start, so two collided cuts no longer stack.
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
// Главное значение planStart = planDate; нет факт. старта → бар плановый (его и двигаем).
function cut(id, planDate, knife, material, cutAndLeader, seq) {
    return {
        id: id, number: planDate, planDate: planDate,
        sequence: seq == null ? null : seq,
        slitter: { id: '4', label: 'Станок 4' },
        setupKnifeMin: knife, setupMaterialMin: material, cutTimeMin: cutAndLeader
    };
}
// Начатая резка: есть факт. старт → cutSetupMin/cutBarMinutes берут фактическое окно, бар
// показывает реальное время и сдвигу не подлежит.
function runningCut(id, startDate, endDate) {
    return {
        id: id, number: startDate, planDate: startDate,
        startDate: startDate, endDate: endDate,
        slitter: { id: '4', label: 'Станок 4' }
    };
}

// ── 1. Коллизия #3885 в Ганте: обе резки Станка 4 / 03.07 сохранены на 08:00 ──
// 188600: наладка 45 (30+15), резка+лидер 475 → окно 08:00–16:40.
// 191769: наладка 45, резка+лидер 16 → сохранено тоже 08:00, должно встать на 16:40.
(function () {
    var starts = gantt.dedupeBarStarts([
        cut('188600', '03.07.2026 08:00', 30, 15, 475, 1),
        cut('191769', '03.07.2026 08:00', 30, 15, 16, 25)
    ]);
    assertEqual(starts, [ms('03.07.2026 08:00'), ms('03.07.2026 16:40')],
        '#3887 коллизия — вторая резка встаёт за концом окна первой (не две в 08:00)');
})();

// ── 2. Непересекающиеся старты (в т.ч. обеденный зазор) не трогаем (#3846) ──
(function () {
    var starts = gantt.dedupeBarStarts([
        cut('A', '03.07.2026 08:00', 0, 0, 200),   // 08:00–11:20
        cut('B', '03.07.2026 12:20', 0, 0, 60)     // 12:20–13:20 (зазор 11:20→12:20 = обед, сохраняем)
    ]);
    assertEqual(starts, [ms('03.07.2026 08:00'), ms('03.07.2026 12:20')],
        'непересечение — разные старты и обеденный зазор не трогаются');
})();

// ── 3. Одинаковое 08:00, но РАЗНЫЕ дни — не объединяем ──
(function () {
    var starts = gantt.dedupeBarStarts([
        cut('D0', '03.07.2026 08:00', 0, 0, 60),
        cut('D1', '04.07.2026 08:00', 0, 0, 60)
    ]);
    assertEqual(starts, [ms('03.07.2026 08:00'), ms('04.07.2026 08:00')],
        'разные дни — оба в 08:00 остаются раздельными');
})();

// ── 4. Каскад: три резки сохранены на 08:00 — встают встык в порядке очереди ──
(function () {
    var starts = gantt.dedupeBarStarts([
        cut('C1', '03.07.2026 08:00', 0, 0, 100),   // 08:00–09:40
        cut('C2', '03.07.2026 08:00', 0, 0, 50),    // → 09:40–10:30
        cut('C3', '03.07.2026 08:00', 0, 0, 30)     // → 10:30–11:00
    ]);
    assertEqual(starts, [ms('03.07.2026 08:00'), ms('03.07.2026 09:40'), ms('03.07.2026 10:30')],
        'каскад — три резки с общим стартом встают встык');
})();

// ── 5. Частичный нахлёст (не точное совпадение старта) тоже снимается ──
(function () {
    var starts = gantt.dedupeBarStarts([
        cut('P1', '03.07.2026 08:00', 0, 0, 120),   // 08:00–10:00
        cut('P2', '03.07.2026 09:00', 0, 0, 40)     // сохранено 09:00 (нахлёст) → на 10:00
    ]);
    assertEqual(starts, [ms('03.07.2026 08:00'), ms('03.07.2026 10:00')],
        'частичный нахлёст — поздняя резка вытолкнута за конец окна предыдущей');
})();

// ── 6. Начатую резку (есть факт. старт) НЕ двигаем — реальное время как есть ──
// Плановая 08:00–16:40 ставит prevEnd=16:40, но начатая в 08:00 показывает свой реальный
// старт и сдвигу не подлежит (хотя и пересекается — конфликт виден, время не искажаем).
(function () {
    var starts = gantt.dedupeBarStarts([
        cut('PLAN', '03.07.2026 08:00', 30, 15, 475),
        runningCut('RUN', '03.07.2026 08:00', '03.07.2026 08:40')
    ]);
    assertEqual(starts, [ms('03.07.2026 08:00'), ms('03.07.2026 08:00')],
        'начатая резка не сдвигается — бар по факт. времени');
})();

// ── 7. Интеграция layoutGroups: коллизия → разные leftPx, встык, подпись по сдвигу ──
// На дорожке Станка 4 две резки должны идти встык (вторая после первой), а не в одной точке.
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
    // 1-я резка: 08:00, окно 520 мин × 2 = 1040 px (наладка 60+30 + резка 950); подпись 08:00–16:40.
    // 2-я резка: сдвинута на 16:40 → leftPx 1040 (= конец 1-й), без наложения; подпись 16:40–17:41.
    assertEqual(tasks, [
        ['188600', 0, 1040, '08:00-16:40 (520 мин)'],
        ['191769', 1040, 122, '16:40-17:41 (61 мин)']
    ], 'layoutGroups #3887 — бары встык, leftPx и подпись по сдвинутому старту');
    // Инвариант «нет наложения»: вторая начинается не раньше конца первой.
    var t0 = laid.groups[0].tasks[0], t1 = laid.groups[0].tasks[1];
    assertEqual(t1.leftPx >= t0.leftPx + t0.widthPx, true,
        'layoutGroups #3887 — нет наложения: leftPx 2-й ≥ правый край 1-й');
})();

console.log('\n' + passed + ' assertions passed.');
