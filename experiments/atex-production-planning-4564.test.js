// #4564 — «Урегулировать» РАЗДЕЛЯЕТ частично выполненное задание.
//
// Правило (issue #4564): выполненная часть уезжает отдельным заданием в конец дня, в котором её
// фактически делали; остаток остаётся в плане, и всё последующее двигает общий механизм.
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
// В том же дне стоит соседнее задание (10:00) — выполненная часть должна встать ПОСЛЕ него.
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
assertEqual(sp.donePlanStart, tsAt(2026, 7, 31, 10, 0) + 60,
    'выполненная часть встаёт в КОНЕЦ своего фактического дня — после последнего задания того дня');

// Остаток занимает место просроченного — перед следующим заданием станка; порядок с 'plain' прежний.
assertEqual(settle.moves.map(function(m) { return m.id; }), ['plain'],
    'сама разделяемая запись в переносах не участвует — вместо неё едет остаток');
assertEqual(sp.restPlanStart, tsAt(2026, 8, 5, 8, 0) - 120, 'остаток — перед следующим заданием станка');
assertEqual(settle.moves[0].planStart, tsAt(2026, 8, 5, 8, 0) - 60,
    'нетронутое просроченное встаёт следом (взаимный порядок сохранён)');
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

// Задание в своём фактическом дне ОДНО: становиться «в конец» не за кем → начало смены того дня,
// а не момент «Начато» (пульт пишет его по нажатию ✓ Готово, оно бывает и после смены).
var alone = settleOne(overdueCut({ actualRuns: 4,
    startDate: String(tsAt(2026, 7, 30, 20, 34)) }));
assertEqual(alone.splits[0].donePlanStart, tsAt(2026, 7, 30, 8, 0),
    'в дне никого больше нет → выполненная часть встаёт на начало смены СВОЕГО фактического дня');

assertEqual(planning.cutDoneRuns({ actualRuns: 8 }), 8, 'cutDoneRuns: «Кол-во резок факт» = 8');
assertEqual(planning.cutDoneRuns({ actualRuns: 0 }), 0, 'cutDoneRuns: известный ноль');
assertEqual(planning.cutDoneRuns({}), null, 'cutDoneRuns: колонки нет → null («не знаем»), а не 0');

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
        donePlanStart: tsAt(2026, 7, 31, 16, 0), restPlanStart: tsAt(2026, 8, 5, 8, 0) - 60 }],
        { endMin: 970 });   // смена до 16:10

    assertEqual(applied.updates, [{ cutId: 'part', planStartTs: tsAt(2026, 7, 31, 16, 0),
        plannedRuns: 8, firstPartId: 'part' }],
        'исходная запись остаётся ВЫПОЛНЕННОЙ частью: 8 проходов, конец своего дня, из цепочки вышла');
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
            '«Закончено» = конец смены того дня, в котором её фактически делали');
        var repointed = posts.filter(function(p) { return p.path.indexOf('_m_set/tail') === 0; });
        assertEqual(repointed.length, 1, 'продолжение цепочки перецеплено');
        assertEqual(repointed[0].fields['t196458'], 'rest1',
            'прежнее продолжение смотрит теперь на ОСТАТОК — он занял место в цепочке дробления');
        console.log('\n' + passed + '/' + total + ' passed');
        if (passed !== total) process.exitCode = 1;
    });
})();
