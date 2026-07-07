// Unit tests for #3974 — «[С; По] — не фильтр входа, а окно РАЗМЕЩЕНИЯ».
//
// Модель (issue #3974):
//   • Вход планировщика = ВСЁ необеспеченное (открытые задания, статус ≠ «Завершён»), за ЛЮБЫЕ
//     даты. Фильтра входа по «Дате план» ∈ [С; По] (#3660) БОЛЬШЕ НЕТ.
//   • Размещение: база = «С» (day 0), дни набиваются плотно от неё и переливаются за «По».
//   • Держит день ТОЛЬКО «Зафиксировано» (🔒). Свободные задания (в т.ч. ручной перенос 🗓 без
//     🔒) при «Создать» перепаковываются от «С» — day-anchor «Даты план» (#3658) отменён.
//   • «Срок изготовления» (EDD, #3815/#3820/#3826/#3970) в раскладке НЕ участвует (только цвет).
//   • Фольга — по-прежнему в конец КАЖДОГО дня (#3717).
//
// Run with: node experiments/atex-production-planning-3974.test.js

process.env.TZ = 'Europe/Moscow';

var planning = require('../download/atex/js/production-planning.js').planning;

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

// База — полночь 01.07.2026 (день 0 = 01.07). Окно резки 08:00–15:30 = 450 мин.
var BASE_MS = new Date(2026, 6, 1, 0, 0, 0).getTime();
var BASE_SEC = Math.floor(BASE_MS / 1000);
var DAY_START = 480, CAP = 450;

// Резка станка m1. planDay — день «Даты план» (0 = 01.07). o = { foil, fixed, status }.
function cut(id, mat, runs, planDay, o) {
    o = o || {};
    var ms = BASE_MS + (planDay || 0) * 86400000;
    return {
        id: id, slitter: { id: 'm1' }, materialId: mat, winding: 'OUT',
        knifeWidths: [110], knifeCount: 1, plannedRuns: runs,
        planDate: String(Math.floor(ms / 1000)),
        isFoil: !!o.foil, fixed: !!o.fixed, status: o.status || ''
    };
}

// Прогон planCutOperations на входе cuts. extra — доп. опции (dueKeyByCut/scope*), чтобы
// доказать, что они ИГНОРИРУЮТСЯ. Вход отбираем как контроллер: статус ≠ «Завершён».
function plan(cuts, extra) {
    var input = cuts.filter(function(c) { return String(c.status || '').trim() !== 'Завершён'; });
    var anchor = {};
    cuts.forEach(function(c) { anchor[String(c.id)] = Math.round((Number(c.planDate) * 1000 - BASE_MS) / 86400000); });
    var opts = {
        perPassByCut: cuts.reduce(function(o, c) { o[c.id] = 100; return o; }, {}),
        dayStartMin: DAY_START, dayEndMin: DAY_START + CAP,
        times: { BETWEEN_CUTS: 0, MATERIAL_WINDING: 15, KNIFE: 30 },
        planBaseMidnightMs: BASE_MS, preserveOrder: false, gapFill: true,
        firstCutSetup: true, dayAnchorByCut: anchor
    };
    if (extra) { for (var k in extra) opts[k] = extra[k]; }
    var ops = planning.planCutOperations(input, opts);
    var day = {}, start = {};
    ops.updates.forEach(function(u) {
        start[u.cutId] = Number(u.planStartTs);
        day[u.cutId] = Math.floor((Number(u.planStartTs) - BASE_SEC) / 86400);
    });
    var touched = ops.updates.map(function(u) { return u.cutId; }).sort();
    var order = ops.updates.slice().sort(function(a, b) { return Number(a.planStartTs) - Number(b.planStartTs); })
        .map(function(u) { return u.cutId; });
    return { touched: touched, day: day, start: start, order: order, deletes: ops.deletes.slice().sort() };
}

// ── 1) Будущее необеспеченное СТЯГИВАЕТСЯ к «С» (фильтра входа по дате нет) ──
// A на 01.07 (день 0), B на 06.07 (день 5). Оба свободны, одно сырьё, помещаются в день 0.
// Раньше scope [01;01] выкинул бы B; теперь оба набиваются от «С» в день 0.
var r1 = plan([ cut('A', 'matA', 2, 0), cut('B', 'matA', 2, 5) ]);
assertEqual([r1.touched, r1.day.A, r1.day.B], [['A', 'B'], 0, 0],
    '#3974: свободное задание с «Датой план» в будущем (день 5) стянуто к «С» (день 0)');

// ── 2) [С; По] scope на входе ИГНОРИРУЕТСЯ (окно размещения, не фильтр) ──
// Те же данные, но с scopeFromKey/scopeToKey = 01.07 (узкое окно). Результат обязан совпасть
// с (1): B всё равно планируется и стягивается к «С».
var r2 = plan([ cut('A', 'matA', 2, 0), cut('B', 'matA', 2, 5) ],
    { scopeFromKey: 20260701, scopeToKey: 20260701 });
assertEqual([r2.touched, r2.day.B], [['A', 'B'], 0],
    '#3974: scopeFromKey/scopeToKey не фильтруют вход — B в будущем всё равно перепланирован');

// ── 3) «Срок изготовления» (EDD) НЕ влияет на раскладку (регресс-гард) ──
// Один и тот же вход, с dueKeyByCut и без. Раннему сроку НЕ отдаём ранний день — результат
// идентичен. B имеет более ранний срок, но не обгоняет A из-за срока.
var base3 = [ cut('A', 'matA', 2, 0), cut('B', 'matB', 2, 0) ];
var r3a = plan(base3);
var r3b = plan(base3, { dueKeyByCut: { A: 20260710, B: 20260701 } });
assertEqual(r3b.order, r3a.order,
    '#3974: dueKeyByCut (EDD) игнорируется — порядок такой же, как без сроков');
assertEqual(r3b.start, r3a.start,
    '#3974: dueKeyByCut (EDD) игнорируется — время старта такое же, как без сроков');

// ── 4) 🔒 «Зафиксировано» держит свой день; свободные набиваются от «С» вокруг ──
// Ffix зафиксирована на день 3. N1/N2 свободны (день 0). Nlate свободна, «Дата план» день 3,
// но БЕЗ 🔒 → стягивается к «С». Ffix остаётся на дне 3.
var r4 = plan([
    cut('N1', 'matA', 2, 0), cut('N2', 'matA', 2, 0),
    cut('Ffix', 'matC', 2, 3, { fixed: true }), cut('Nlate', 'matA', 2, 3)
]);
assertEqual([r4.day.N1, r4.day.N2, r4.day.Ffix], [0, 0, 3],
    '#3974: зафиксированная (🔒) резка остаётся на своём дне 3, свободные — на дне 0');
assertEqual(r4.day.Nlate < 3, true,
    '#3974: свободное задание с «Датой план» день 3 (без 🔒) стянуто к «С» (не держит день)');

// ── 5) Зафиксированная резка РАНЬШЕ «С» (день < 0) остаётся как есть — не двигаем/не удаляем ──
// Fpast зафиксирована на день -2 (до «С»). Цикл идёт вперёд от 0 — не размещаем её (остаётся
// в базе как есть), но и НЕ удаляем. N1 свободна (день 0).
var r5 = plan([ cut('Fpast', 'matC', 2, -2, { fixed: true }), cut('N1', 'matA', 2, 0) ]);
assertEqual([r5.touched, r5.deletes, r5.day.N1], [['N1'], [], 0],
    '#3974: 🔒-резка раньше «С» (день -2) не перепланирована и не удалена; свободная — на дне 0');

// ── 6) Плотная набивка с переливом за конец окна (нет верхней границы «По») ──
// Три резки одного сырья по 2 прохода: 45+200 + 200 = 445 ≤ 450 (две в день 0), третья — в день 1.
var r6 = plan([ cut('C1', 'matA', 2, 0), cut('C2', 'matA', 2, 0), cut('C3', 'matA', 2, 0) ]);
assertEqual([r6.day.C1, r6.day.C2, r6.day.C3], [0, 0, 1],
    '#3974: день набивается до ёмкости (2 резки в день 0), остаток переливается в день 1');

// ── 7) Фольга — в конец дня (#3717 через слой размещения #3985) ──
// N1, N2 (нефольга) и F1 (фольга), одно окно. На живом пути (slotPlacement) штраф FOIL_NOTEND уводит
// фольгу в конец дня (жёсткое правило orderCuts снято #4085 — теперь инвариант держит слой размещения).
var r7 = plan([ cut('N1', 'matA', 1, 0), cut('N2', 'matA', 1, 0), cut('F1', 'matA', 1, 0, { foil: true }) ],
    { slotPlacement: true, slitterIds: ['m1'] });
assertEqual(r7.order[r7.order.length - 1], 'F1',
    '#3974: фольга (F1) размещается в конец дня — после нефольги (#3717 через слой размещения)');
assertEqual([r7.day.N1, r7.day.N2, r7.day.F1], [0, 0, 0],
    '#3974: все три помещаются в день 0, порядок — нефольга, затем фольга');

// ── 8) «Завершён» на входе не участвует (обеспеченное не трогаем) ──
// Done (Завершён) на день 0 — контроллер его в planInput не кладёт. Остаётся как есть.
var r8 = plan([ cut('Done', 'matA', 2, 0, { status: 'Завершён' }), cut('N1', 'matA', 2, 0) ]);
assertEqual([r8.touched, r8.day.N1], [['N1'], 0],
    '#3974: «Завершён» (обеспеченное) не планируется; свободная N1 — на дне 0');

console.log('\n' + passed + ' passed');
