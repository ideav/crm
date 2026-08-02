// #4564 — «Урегулировать» РАЗДЕЛЯЕТ частично выполненное задание.
//
// Правило (issue #4564 + уточнение заказчика 02.08.2026): выполненная часть остаётся отдельным
// заданием, её первая колонка = МОМЕНТ ФАКТИЧЕСКОГО НАЧАЛА («Начато»), а длительность считается по
// настройке и ФАКТИЧЕСКОМУ числу резок. Остаток остаётся в плане, и всё последующее двигает общий
// механизм.
// Сколько сделано — «Кол-во резок факт» задания (реквизит 657315, #4564); журнал событий смены
// на этот вопрос не отвечает, погонаж — тем более (#4351: у не начатой резки он равен остатку партии).
//
// Покрываем:
//   • deviationSettlePlan → { moves, splits }: кого двигаем, кого разделяем и на какие числа;
//   • splitPartiallyDoneCuts → какие операции уходят в общий путь записи (applySplitPlan),
//     закрытие выполненной части и передача цепочки дробления остатку.
//
// Run with: node experiments/atex-production-planning-4564.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;
var Controller = api.Controller;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    var ok = a === e;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + e + ', получено ' + a + ')'));
    if (ok) passed++; else process.exitCode = 1;
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

function tsAt(y, m, d, hh, mm) { return Math.floor(Date.UTC(y, m - 1, d, hh, mm, 0) / 1000); }
var TODAY = 20260803;

// ── 1) чистое решение: кого двигаем, кого делим ───────────────────────────────
// Станок 1, 31.07: задание на 45 проходов начато и сделано 8 — оно и есть «частично выполненное».
// Выполненная часть остаётся на своём фактическом начале (08:05), соседи по дню на это не влияют.
var cuts = [
    { id: 'part', slitter: { id: '1' }, plannedRuns: 45, actualRuns: 8,
      planDate: String(tsAt(2026, 7, 31, 8, 0)), startDate: String(tsAt(2026, 7, 31, 8, 5)), endDate: '' },
    { id: 'sameday', slitter: { id: '1' }, plannedRuns: 5, actualRuns: 5,
      planDate: String(tsAt(2026, 7, 31, 10, 0)), startDate: String(tsAt(2026, 7, 31, 10, 0)),
      endDate: String(tsAt(2026, 7, 31, 12, 0)) },
    { id: 'plain', slitter: { id: '1' }, plannedRuns: 12, actualRuns: 0,
      planDate: String(tsAt(2026, 8, 1, 8, 0)), startDate: '', endDate: '' },
    { id: 'next', slitter: { id: '1' }, plannedRuns: 7, actualRuns: 0,
      planDate: String(tsAt(2026, 8, 5, 8, 0)), startDate: '', endDate: '' }
];
var groups = planning.deviationGroups(cuts, TODAY);
assertEqual(groups.overdue.map(function(c) { return c.id; }), ['part', 'plain'],
    'просрочены оба: частично выполненное и нетронутое');

var settle = planning.deviationSettlePlan(cuts, groups, { todayKey: TODAY, shiftStartMin: 480 });
assertEqual(settle.splits.length, 1, 'разделяем ровно одно задание — частично выполненное');
var sp = settle.splits[0];
assertEqual([sp.id, sp.doneRuns, sp.restRuns], ['part', 8, 37],
    'сделано 8 из 45 → выполненная часть 8, остаток 37 (работа сохранена)');
assertEqual(sp.donePlanStart, tsAt(2026, 7, 31, 8, 5),
    '#4572 первая колонка выполненной части = МОМЕНТ ФАКТИЧЕСКОГО НАЧАЛА («Начато»)');

// Остаток занимает место просроченного — перед следующим заданием станка; порядок с 'plain' прежний.
assertEqual(settle.moves.map(function(m) { return m.id; }), ['plain', 'next'],
    'сама разделяемая запись в переносах не участвует — вместо неё едет остаток; «next» подвинут');
assertEqual(sp.restPlanStart, tsAt(2026, 8, 5, 8, 0),
    '#4574 остаток занимает ВРЕМЯ следующего задания станка');
assertEqual(settle.moves[0].planStart, tsAt(2026, 8, 5, 8, 0) + 60,
    'нетронутое просроченное встаёт следом (взаимный порядок сохранён)');
assertEqual(settle.moves[1].planStart, tsAt(2026, 8, 5, 8, 0) + 120,
    '#4574 само «следующее» отходит за ними');
assertEqual([sp.restReason, settle.moves[0].reason], ['before-next', 'before-next'], 'причина места — «перед следующим»');

// ── 2) краевые случаи факта ───────────────────────────────────────────────────
function overdueCut(over) {
    var base = { id: 'x', slitter: { id: '9' }, plannedRuns: 10,
        planDate: String(tsAt(2026, 7, 30, 8, 0)), startDate: String(tsAt(2026, 7, 30, 8, 0)), endDate: '' };
    return Object.assign(base, over);
}
function settleOne(cut) {
    var g = { overdue: [cut], early: [] };
    return planning.deviationSettlePlan([cut], g, { todayKey: TODAY, shiftStartMin: 480,
        freeDayMsFor: function() { return Date.UTC(2026, 7, 4); } });
}
var allDone = settleOne(overdueCut({ actualRuns: 10 }));
assertEqual([allDone.splits.length, allDone.splits[0].restRuns, allDone.moves.length], [1, 0, 0],
    'сделаны ВСЕ проходы, но не закрыто → остатка нет: работа целиком уезжает в свой день и закрывается');
var over = settleOne(overdueCut({ actualRuns: 14 }));
assertEqual([over.splits[0].doneRuns, over.splits[0].restRuns], [10, 0],
    'факт больше плана → выполненная часть не больше плана, остатка нет');
var none = settleOne(overdueCut({ actualRuns: 0 }));
assertEqual([none.splits.length, none.moves.length], [0, 1],
    'проходов ноль → делить нечего, задание просто переезжает');
var unknown = settleOne(overdueCut({}));
assertEqual([unknown.splits.length, unknown.moves.length], [0, 0],
    'факт НЕИЗВЕСТЕН у начатого → не делим и не двигаем (#4381 в силе)');
var setupOnly = settleOne(overdueCut({ plannedRuns: 0, actualRuns: 0, startDate: '' }));
assertEqual(setupOnly.splits.length, 0, 'сегмент-настройка (0 проходов) не разделяется');

// Первая колонка — сам момент «Начато», без оглядки на соседей по дню и окно смены: это запись
// о том, ЧТО БЫЛО. Пульт пишет «Начато» по нажатию ✓ Готово, и оно бывает и после смены.
var alone = settleOne(overdueCut({ actualRuns: 4,
    startDate: String(tsAt(2026, 7, 30, 20, 34)) }));
assertEqual(alone.splits[0].donePlanStart, tsAt(2026, 7, 30, 20, 34),
    '#4572 фактическое начало как есть — 20:34, а не начало смены и не хвост дня');

assertEqual(planning.cutDoneRuns({ actualRuns: 8 }), 8, 'cutDoneRuns: «Кол-во резок факт» = 8');
assertEqual(planning.cutDoneRuns({ actualRuns: 0 }), 0, 'cutDoneRuns: известный ноль');
assertEqual(planning.cutDoneRuns({}), null, 'cutDoneRuns: колонки нет → null («не знаем»), а не 0');

// ── 4) #4572: окончание выполненной части не налезает на следующее задание ────
// Начало у неё фактическое, значит и окончание — факт того же ряда: не позже, чем НАЧАЛОСЬ
// следующее задание станка. Иначе выполненные куски накладываются друг на друга.
(function() {
    function withNeighbours(neigh) {
        var part = { id: 'p', slitter: { id: '1' }, plannedRuns: 20, actualRuns: 5,
            planDate: String(tsAt(2026, 7, 30, 8, 0)), startDate: String(tsAt(2026, 7, 30, 8, 0)), endDate: '' };
        var all = [part].concat(neigh || []);
        return planning.deviationSettlePlan(all, { overdue: [part], early: [] },
            { todayKey: TODAY, shiftStartMin: 480, shiftEndMin: 970,
              freeDayMsFor: function() { return Date.UTC(2026, 7, 4); } }).splits[0];
    }
    // Следующее задание станка началось по факту в 11:00 — закрываемся им, а не концом смены.
    var withNext = withNeighbours([{ id: 'n', slitter: { id: '1' }, plannedRuns: 3,
        planDate: String(tsAt(2026, 7, 30, 11, 0)), startDate: String(tsAt(2026, 7, 30, 11, 0)), endDate: '' }]);
    assertEqual(withNext.doneCloseTs, tsAt(2026, 7, 30, 11, 0),
        '#4572 закрываем моментом фактического начала СЛЕДУЮЩЕГО задания — наложения нет');
    // Следующего нет — конец смены того дня (16:10).
    assertEqual(withNeighbours([]).doneCloseTs, tsAt(2026, 7, 30, 16, 10),
        'следующего задания нет → конец смены того дня');
    // Чужой станок «следующим» не считается.
    assertEqual(withNeighbours([{ id: 'other', slitter: { id: '2' }, plannedRuns: 3,
        planDate: String(tsAt(2026, 7, 30, 9, 0)), startDate: String(tsAt(2026, 7, 30, 9, 0)), endDate: '' }]).doneCloseTs,
        tsAt(2026, 7, 30, 16, 10), 'задание ДРУГОГО станка на окончание не влияет');
    // «Начато» позже конца смены (пульт пишет его по нажатию ✓ Готово) — закрытие не уходит назад.
    var late = planning.deviationSettlePlan(
        [{ id: 'late', slitter: { id: '1' }, plannedRuns: 20, actualRuns: 5,
           planDate: String(tsAt(2026, 7, 30, 8, 0)), startDate: String(tsAt(2026, 7, 30, 20, 34)), endDate: '' }],
        { overdue: [{ id: 'late', slitter: { id: '1' }, plannedRuns: 20, actualRuns: 5,
           planDate: String(tsAt(2026, 7, 30, 8, 0)), startDate: String(tsAt(2026, 7, 30, 20, 34)), endDate: '' }], early: [] },
        { todayKey: TODAY, shiftStartMin: 480, shiftEndMin: 970,
          freeDayMsFor: function() { return Date.UTC(2026, 7, 4); } }).splits[0];
    assertEqual(late.doneCloseTs, tsAt(2026, 7, 30, 20, 34),
        '#4572 закрытие НЕ раньше собственного начала (начало 20:34 при смене до 16:10)');
})();

// ── 5) #4584: «делается раньше плана» — третий вид отклонения ─────────────────
// Задание не просрочено (его день ещё не настал) и не завершено, но проходы уже отмечены:
// оператор делает его сегодня, а план говорит «позже». До #4584 такое задание не попадало ни
// в одну группу и в форме отклонений его не было вовсе (боевое: 5 из 45 сделано, план 03.08,
// сегодня 02.08 — «почему его нет в отклонениях?»).
(function() {
    var TODAY_2 = 20260802;
    var cuts2 = [
        { id: 'running', slitter: { id: '1' }, plannedRuns: 45, actualRuns: 5,
          planDate: String(tsAt(2026, 8, 3, 8, 0)), startDate: String(tsAt(2026, 8, 2, 18, 33)), endDate: '' },
        { id: 'untouched', slitter: { id: '1' }, plannedRuns: 10, actualRuns: 0,
          planDate: String(tsAt(2026, 8, 3, 12, 0)), startDate: '', endDate: '' }
    ];
    var g = planning.deviationGroups(cuts2, TODAY_2);
    assertEqual(g.earlyRun.map(function(c) { return c.id; }), ['running'],
        '#4584 частично выполненное с планом в БУДУЩЕМ — отклонение «делается раньше плана»');
    assertEqual([g.overdue.length, g.early.length], [0, 0],
        'в «просрочено»/«выполнено досрочно» оно не попадает — там другие условия');
    assertEqual(g.earlyRun.indexOf(cuts2[1]), -1,
        'нетронутое задание того же будущего дня отклонением не считается');

    // Разделяется ТАК ЖЕ, как частично выполненное просроченное, только в обратную сторону:
    // выполненное отрезается в день выполнения, остаток стои́т на своём плановом времени.
    var s = planning.deviationSettlePlan(cuts2, g, { todayKey: TODAY_2, shiftStartMin: 480 });
    assertEqual(s.splits.length, 1, '#4584 разделяем — как недоделанное, только зеркально');
    var sp2 = s.splits[0];
    assertEqual([sp2.id, sp2.doneRuns, sp2.restRuns], ['running', 5, 40],
        'сделано 5 из 45 → выполненная часть 5, остаток 40');
    assertEqual(sp2.donePlanStart, tsAt(2026, 8, 2, 18, 33),
        '#4584 выполненная часть кладётся в ДЕНЬ ВЫПОЛНЕНИЯ («Начато» 02.08)');
    assertEqual([sp2.restPlanStart, sp2.restReason], [tsAt(2026, 8, 3, 8, 0), 'stay'],
        '#4584 остаток остаётся на СВОЁМ плановом времени (03.08) — освободившееся закроет сдвиг влево');
    assertEqual(s.moves.length, 0, 'ничего не переносим целиком: место остатка не меняется');
})();

// ── 3) применение: какие операции уходят в общий путь записи ──────────────────
(function() {
    var inst = Object.create(Controller.prototype);
    inst.cuts = [
        // разделяемое задание — ГОЛОВА цепочки дробления (сама себе «ID первой части»)
        { id: 'part', slitter: { id: '1' }, plannedRuns: 45, actualRuns: 8, firstPartId: 'part',
          planDate: String(tsAt(2026, 7, 31, 8, 0)), startDate: String(tsAt(2026, 7, 31, 8, 5)), endDate: '' },
        // её продолжение следующего дня — после разделения должно смотреть на ОСТАТОК
        { id: 'tail', slitter: { id: '1' }, plannedRuns: 6, actualRuns: 0, firstPartId: 'part',
          planDate: String(tsAt(2026, 8, 1, 8, 0)), startDate: '', endDate: '' }
    ];
    inst.meta = { cut: { id: '1078', reqs: [
        { id: '16411', val: 'Закончено' },
        { id: '196458', val: 'ID первой части' }
    ] } };
    var applied = null, posts = [];
    inst.applySplitPlan = function(ops) {
        applied = ops;
        // общий путь записи возвращает id созданной записи через onCreated
        (ops.creates || []).forEach(function(cr) { ops.onCreated(cr, 'rest1'); });
        return Promise.resolve(true);
    };
    inst.post = function(path, fields) { posts.push({ path: path, fields: fields }); return Promise.resolve({}); };

    inst.splitPartiallyDoneCuts([{ id: 'part', doneRuns: 8, restRuns: 37,
        donePlanStart: tsAt(2026, 7, 31, 8, 5), doneCloseTs: tsAt(2026, 7, 31, 16, 10),
        restPlanStart: tsAt(2026, 8, 5, 8, 0) - 60 }]);

    assertEqual(applied.updates, [{ cutId: 'part', planStartTs: tsAt(2026, 7, 31, 8, 5),
        plannedRuns: 8, firstPartId: 'part' }],
        'исходная запись остаётся ВЫПОЛНЕННОЙ частью: 8 проходов, фактическое начало, из цепочки вышла');
    assertEqual(applied.creates.length, 1, 'остаток — одна новая запись');
    assertEqual([applied.creates[0].parentCutId, applied.creates[0].plannedRuns,
                 applied.creates[0].planStartTs, applied.creates[0].firstPartSelf],
        ['part', 37, tsAt(2026, 8, 5, 8, 0) - 60, true],
        'остаток создаётся от исходной записи, на своё место в плане, САМОСТОЯТЕЛЬНЫМ заданием');
    assertEqual(applied.updates[0].plannedRuns + applied.creates[0].plannedRuns, 45,
        'работа сохранена: выполненная часть + остаток = прежний план (SUPPLY_CONSERVED, ТЗ §15)');

    return new Promise(function(resolve) { setTimeout(resolve, 0); }).then(function() {
        var closed = posts.filter(function(p) { return p.path.indexOf('_m_set/part') === 0; });
        assertEqual(closed.length, 1, 'выполненную часть закрываем ОДНОЙ записью');
        assertEqual(closed[0].fields['t16411'], '2026-07-31 16:10:00',
            '#4572 «Закончено» = момент, посчитанный правилом (не позже начала следующего задания)');
        var repointed = posts.filter(function(p) { return p.path.indexOf('_m_set/tail') === 0; });
        assertEqual(repointed.length, 1, 'продолжение цепочки перецеплено');
        assertEqual(repointed[0].fields['t196458'], 'rest1',
            'прежнее продолжение смотрит теперь на ОСТАТОК — он занял место в цепочке дробления');
        console.log('\n' + passed + '/' + total + ' passed');
        if (passed !== total) process.exitCode = 1;
    });
})();

