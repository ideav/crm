// Unit tests for #4121 — «сквозной» обед в очереди РМ «Планирование» должен двигать последующие
// карточки дня, как перерыв.
//
// Симптом (комментарий к issue, Станок 2, 02.07.2026 с «Отпуском» 08:00–10:00 «ТО»): карточка №2
// растянута обедом до 13:46, а №3 начинается в 13:06 — на 40 минут РАНЬШЕ конца №2.
//
// Причина: обед генерация ЗАШИВАЕТ в planStart зазором, поэтому #4075 сдвигал карточки только за
// перерывы (kind 'break'). Но на дне после «Отпуска» станка зазора нет: сдвиг за простой (#3764
// shiftPlacementsPastDowntime) пакует резки встык и обеденный зазор схлопывается. Такой обед —
// реальный простой, которого нет в сохранённых стартах: он обязан двигать всё после несущей.
//
// Правило #4121: обед сдвигает последующие карточки дня, ТОЛЬКО если он не зашит в planStart
// (в дне нет зазора ≈ его длительности перед карточкой, стартующей не раньше LUNCH_START).
//
// Run with: node experiments/atex-production-planning-4121.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function eq(a, b, name) {
    var ok = JSON.stringify(a) === JSON.stringify(b);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected: ' + JSON.stringify(b) + '\n  actual:   ' + JSON.stringify(a)); failed++; process.exitCode = 1; }
}

var BREAKS = [
    { startMin: 600, durationMin: 10, kind: 'break', label: 'Перерыв' },   // 10:00
    { startMin: 740, durationMin: 40, kind: 'lunch', label: 'Обед' },      // 12:20
    { startMin: 900, durationMin: 10, kind: 'break', label: 'Перерыв' }    // 15:00
];
function sc(id, startMin, workMin) {
    return { cutId: id, startMin: startMin, setupMin: 0, finishMin: startMin + workMin,
             leaderMin: 0, durationMin: workMin };
}

// ── День после «Отпуска» 08:00–10:00: цуг встык от 10:00, обеденного зазора в planStart НЕТ ──
var afterVacation = {
    '4008': sc('4008', 600, 120),   // 10:00–12:00 (несёт перерыв 10:00)
    '3948': sc('3948', 720, 56),    // 12:00–12:56 (несёт обед 12:20)
    '3992': sc('3992', 776, 4),
    '3941': sc('3941', 780, 37),
    '3968': sc('3968', 817, 31),
    '3997': sc('3997', 848, 38),
    '3971': sc('3971', 886, 23),    // 14:46–15:09 (несёт перерыв 15:00)
    '4023': sc('4023', 909, 17),
    '3972': sc('3972', 926, 15)
};
// Порядок дорожки задаём явно: у объекта числовые ключи JS отдаёт по возрастанию, а очередь
// нумерует карточки по расписанию (№1 4008 … №9 3972).
var TRACK = ['4008', '3948', '3992', '3941', '3968', '3997', '3971', '4023', '3972'];
var vacDayGroups = { '0': TRACK.map(function(id) { return { id: id }; }) };
var rv = planning.computeQueueBreakMarkers(vacDayGroups, afterVacation, BREAKS);

eq(rv.markersByCut['3948'], [{ label: 'Обед', startMin: 740, endMin: 780, kind: 'lunch' }],
    '#4121: обед несёт 3948 — её окно 12:00–12:56 накрывает 12:20');
eq(rv.extendByCut['3948'], 40, '#4121: окно несущей удлиняется на обед (как было в #4094)');

// Ключевое: обед двигает всё после несущей (+40), накапливаясь с перерывами (+10 / +10).
eq(rv.shiftByCut['3948'], 10, '#4121: несущая обеда сдвинута только перерывом 10:00');
eq(rv.shiftByCut['3992'], 50, '#4121: 3992 сдвинута на перерыв 10:00 + обед (было 10 → наезд на №2)');
eq(rv.shiftByCut['3941'], 50, '#4121: 3941 — тоже +50');
eq(rv.shiftByCut['3971'], 50, '#4121: несущая перерыва 15:00 сдвинута на +50');
eq(rv.shiftByCut['4023'], 60, '#4121: после перерыва 15:00 — +60');
eq(rv.shiftByCut['3972'], 60, '#4121: последняя карточка дня — +60');
eq(rv.shiftByCut['4008'] === undefined, true, '#4121: первая карточка дня не сдвигается');

// ── Подписи карточек: №3 больше не начинается раньше конца №2 ──
function line(id) {
    return planning.formatScheduleLine(afterVacation[id], 1000, true, rv.shiftByCut[id], rv.extendByCut[id]);
}
eq(line('4008'), '⏱ 10:00 – 12:10 · 120 мин', '#4121: №1 — окно с перерывом 10:00');
eq(line('3948'), '⏱ 12:10 – 13:46 · 56 мин', '#4121: №2 — окно с обедом');
eq(line('3992'), '⏱ 13:46 – 13:50 · 4 мин', '#4121: №3 начинается ровно там, где кончилась №2 (было 13:06)');
eq(line('3941'), '⏱ 13:50 – 14:27 · 37 мин', '#4121: №4 — встык за №3');
eq(line('3971'), '⏱ 15:36 – 16:09 · 23 мин', '#4121: несущая перерыва 15:00 — окно +10');

// ── Контроль: обед ЗАШИТ в planStart зазором → сдвига нет (поведение #4075 не изменилось) ──
//   A 08:00–10:20, B 10:20–12:20, зазор 40 мин, C 13:00–16:00.
var gapDay = {
    A: sc('A', 480, 140),   // 08:00–10:20
    B: sc('B', 620, 120),   // 10:20–12:20
    C: sc('C', 780, 180)    // 13:00–16:00 (после обеденного зазора)
};
var rg = planning.computeQueueBreakMarkers({ '0': [{ id: 'A' }, { id: 'B' }, { id: 'C' }] }, gapDay, BREAKS);
eq(rg.markersByCut.B, [{ label: 'Обед', startMin: 740, endMin: 780, kind: 'lunch' }],
    '#4121 контроль: обед-зазор несёт B (кончилась ровно к 12:20)');
eq(rg.shiftByCut.C, 10, '#4121 контроль: C сдвинута только перерывом 10:00 — обед уже в planStart');

// Зазор есть, но ДО обеда (утренний простой) — обед всё равно сквозной и двигает.
var morningGap = {
    M1: sc('M1', 480, 60),    // 08:00–09:00
    M2: sc('M2', 620, 180),   // 10:20–13:20 (зазор 80 мин до неё, но старт < 12:20) — несёт обед
    M3: sc('M3', 800, 30)     // 13:20–13:50
};
var rm = planning.computeQueueBreakMarkers({ '0': [{ id: 'M1' }, { id: 'M2' }, { id: 'M3' }] }, morningGap,
    [{ startMin: 740, durationMin: 40, kind: 'lunch', label: 'Обед' }]);
eq(rm.markersByCut.M2, [{ label: 'Обед', startMin: 740, endMin: 780, kind: 'lunch' }],
    '#4121: обед на M2 (её окно накрывает 12:20)');
eq(rm.shiftByCut.M3, 40, '#4121: утренний зазор — не обед; обед сквозной → M3 сдвинута на 40');

// Сквозной обед + ПОЗДНИЙ простой того же дня (второй «Отпуск» 15:00–16:00): поздний зазор не
// имеет права забрать себе роль обеда — иначе карточки после обеда снова не сдвинутся.
var lateGap = {
    L1: sc('L1', 600, 120),   // 10:00–12:00
    L2: sc('L2', 720, 60),    // 12:00–13:00 (несёт обед 12:20)
    L3: sc('L3', 780, 120),   // 13:00–15:00
    L4: sc('L4', 960, 30)     // 16:00–16:30 — перед ним зазор 60 мин (ТО), старт ≥ 12:20
};
var rlg = planning.computeQueueBreakMarkers({ '0': [{ id: 'L1' }, { id: 'L2' }, { id: 'L3' }, { id: 'L4' }] },
    lateGap, [{ startMin: 740, durationMin: 40, kind: 'lunch', label: 'Обед' }]);
eq(rlg.shiftByCut.L3, 40, '#4121: поздний простой (ТО) — не обед; сквозной обед двигает L3');
eq(rlg.shiftByCut.L4, 40, '#4121: и L4 тоже сдвинута обедом');

// Порядок карточек в дне может расходиться с временем (#3920): детектор ищет зазоры по времени.
var unsorted = { U1: sc('U1', 620, 120), U2: sc('U2', 780, 180), U3: sc('U3', 480, 140) };
var ru = planning.computeQueueBreakMarkers({ '0': [{ id: 'U1' }, { id: 'U2' }, { id: 'U3' }] }, unsorted,
    [{ startMin: 740, durationMin: 40, kind: 'lunch', label: 'Обед' }]);
eq(ru.shiftByCut.U2 === undefined, true,
    '#4121: обед-зазор (U1 10:20–12:20 → U2 13:00) распознан, хотя карточки идут не по времени');

// ── #4121: карточка НАСТРОЙКИ (setup-only, 0 проходов) пишет время начала и окончания ──
// Хвост дня: настройка 16:15–16:45 (setupMin 30, проходов нет → durationMin 0, finish = start).
var setupSc = { cutId: 'S', startMin: 1005, setupMin: 30, finishMin: 1005, leaderMin: 0, durationMin: 0 };
eq(planning.formatSetupScheduleLine(setupSc), '⚙ Настройка ножей и сырья · 16:15 – 16:45 · 30 мин',
    '#4121: у настройки в строке есть окно (было только «· 30 мин»)');
eq(planning.formatSetupScheduleLine(setupSc, 10), '⚙ Настройка ножей и сырья · 16:25 – 16:55 · 30 мин',
    '#4121: настройку двигает перерыв/обед до неё (shiftMin)');
eq(planning.formatSetupScheduleLine(setupSc, 0, 10), '⚙ Настройка ножей и сырья · 16:15 – 16:55 · 30 мин',
    '#4121: настройка, несущая перерыв, удлиняется на него (extendMin), минуты остаются рабочими');
eq(planning.formatSetupScheduleLine(null), '', '#4121: нет расписания → пустая строка');

console.log('\n----------------------------------------');
console.log('ИТОГО: ' + passed + ' passed, ' + failed + ' failed');
