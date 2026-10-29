// #5295 — «Вернуть остаток» у задания, закрытого не полностью («Пропуск» на пульте слиттера).
//
// Боевое (ateh, 28.10.2026, Станок 2): заказ 6216, задание 993285 — сделано 81 из 97, оператор
// нажал «Пропуск». После #5293 недоделка видна в «Дэшборде», но вернуть 16 проходов в план было
// нечем: «Урегулировать» берёт только незакрытые задания.
//
// Правило (решение владельца 29.10.2026): ручная кнопка делит задание так же, как «Урегулировать»
// делит частично выполненное (#4564):
//   • выполненная часть — ИСХОДНАЯ запись: проходов = факту, остаётся в своём дне и со своим
//     «Закончено» (дата плана и момент закрытия не переписываются — это факт);
//   • остаток (план − факт) — НОВАЯ запись перед следующим НЕвыполненным заданием своего станка,
//     а нет его — на ближайший свободный рабочий день.
// Закрыто с нуля проходов — то же: выполненная часть остаётся с 0 проходов, остаток = весь план.
//
// Run with: node experiments/atex-pp-5295-return-short-rest.test.js

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
function tsAt(d, hh, mm) { return Math.floor(Date.UTC(2026, 9, d, hh, mm || 0, 0) / 1000); }

var TODAY = 20261028;
var S2 = { id: '2' };

function closedCut(id, day, fact, plan) {
    return { id: id, slitter: S2, planDate: String(tsAt(day, 8)), plannedRuns: plan, actualRuns: fact,
             startDate: fact > 0 ? String(tsAt(day, 8, 5)) : '', endDate: String(tsAt(day, 13, 40)) };
}
var shortCut = closedCut('993285', 28, 81, 97);
var zeroCut = closedCut('5', 27, 0, 10);
var fullCut = closedCut('6', 28, 97, 97);
var nextCut = { id: 'n1', slitter: S2, planDate: String(tsAt(29, 8)), plannedRuns: 40, actualRuns: 0,
                startDate: '', endDate: '' };
var otherSlitter = { id: 'o1', slitter: { id: '3' }, planDate: String(tsAt(29, 7)), plannedRuns: 5,
                     actualRuns: 0, startDate: '', endDate: '' };
var cuts = [shortCut, zeroCut, fullCut, nextCut, otherSlitter];
var freeDayMs = Date.UTC(2026, 9, 30);
var opts = { todayKey: TODAY, shiftStartMin: 480, freeDayMsFor: function() { return freeDayMs; } };

if (typeof planning.shortRestReturnPlan !== 'function') {
    assertEqual(typeof planning.shortRestReturnPlan, 'function', 'planning.shortRestReturnPlan существует');
}
var plan = typeof planning.shortRestReturnPlan === 'function'
    ? function(c, list, o) { return planning.shortRestReturnPlan(list || cuts, c, o || opts); }
    : function() { return { moves: [], splits: [] }; };

// ── 1) пропущено после 81 из 97: остаток 16 — перед следующим заданием станка ──
var r1 = plan(shortCut);
assertEqual(r1.splits, [{ id: '993285', doneRuns: 81, restRuns: 16, donePlanStart: tsAt(28, 8),
    doneCloseTs: null, keepFinished: true, restPlanStart: tsAt(29, 8), restReason: 'before-next' }],
    'остаток 16 проходов встаёт на место следующего задания станка; выполненная часть — в своём дне, «Закончено» не трогаем');
assertEqual(r1.moves, [{ id: 'n1', planStart: tsAt(29, 8) + 60, reason: 'shift-next' }],
    'следующее задание станка отходит на минуту дальше, само закрытое задание не переносится, чужой станок не тронут');

// ── 2) пропущено с нуля: остаток = весь план ──
var r2 = plan(zeroCut);
assertEqual(r2.splits.map(function(sp) { return [sp.id, sp.doneRuns, sp.restRuns, sp.donePlanStart, sp.restReason]; }),
    [['5', 0, 10, tsAt(27, 8), 'before-next']],
    'закрыто без единого прохода: выполненная часть 0, остаток — все 10 проходов');
assertEqual(r2.moves.filter(function(p) { return p.id === '5'; }), [],
    'закрытая запись с нуля проходов сама не переносится');

// ── 3) у станка нет следующего задания — ближайший свободный рабочий день ──
var r3 = plan(shortCut, [shortCut, otherSlitter]);
assertEqual(r3.splits.map(function(sp) { return [sp.restPlanStart, sp.restReason]; }),
    [[freeDayMs / 1000 + 480 * 60, 'free-day']],
    'следующего задания нет → остаток на ближайший свободный день, к началу смены');

// ── 4) нечего возвращать: выполнено полностью / не закрыто / факт неизвестен ──
var notShort = [fullCut, nextCut, closedCut('x', 28, null, 10)].map(function(c) {
    var r = plan(c); return r.splits.length + r.moves.length;
});
assertEqual(notShort, [0, 0, 0], 'выполненное полностью, незакрытое и с неизвестным фактом — ничего не делим и не двигаем');

// ── 5) запись: у закрытого задания «Закончено» не переписывается ──
(function() {
    var inst = Object.create(Controller.prototype);
    inst.cuts = [shortCut];
    inst.meta = { cut: { id: '1078', reqs: [{ id: '16411', val: 'Закончено' }] } };
    var applied = null, posts = [];
    inst.applySplitPlan = function(ops) {
        applied = ops;
        (ops.creates || []).forEach(function(cr) { ops.onCreated(cr, 'rest1'); });
        return Promise.resolve(true);
    };
    inst.post = function(path, fields) { posts.push({ path: path, fields: fields }); return Promise.resolve({}); };
    inst.splitPartiallyDoneCuts([{ id: '993285', doneRuns: 81, restRuns: 16, donePlanStart: tsAt(28, 8),
        doneCloseTs: null, keepFinished: true, restPlanStart: tsAt(29, 8), restReason: 'before-next' }])
        .then(function(res) {
            assertEqual(posts, [], 'у закрытого задания «Закончено» (момент с пульта) не переписывается');
            assertEqual(applied && applied.updates && applied.updates[0] && applied.updates[0].planStartTs, tsAt(28, 8),
                'дата плана выполненной части — прежняя');
            assertEqual(res && res.createdIds, ['rest1'], 'остаток создан');
            done();
        });
})();

// ── 6) контроллер: кнопка зовёт общий путь «Урегулировать» с готовым решением ──
function done() {
    var inst = Object.create(Controller.prototype);
    inst.cuts = cuts;
    inst.workingWindow = function() { return { startMin: 480, cutEndMin: 1200 }; };
    inst.shiftClosedSlittersToday = function() { return {}; };
    inst.shiftNotOpenSlittersNow = function() { return {}; };
    inst.nearestFreeDayMs = function() { return freeDayMs; };
    inst.notify = function() {};
    var seen = null;
    inst.settleDeviations = function(groups, o) { seen = o; return Promise.resolve(true); };
    var origNow = Date.now;
    Date.now = function() { return Date.UTC(2026, 9, 28, 14, 0); };
    try {
        if (typeof inst.returnShortRest === 'function') inst.returnShortRest('993285');
    } finally { Date.now = origNow; }
    var sp = seen && seen.settle && seen.settle.splits && seen.settle.splits[0];
    assertEqual(sp ? [sp.id, sp.doneRuns, sp.restRuns, sp.restReason] : null, ['993285', 81, 16, 'before-next'],
        'returnShortRest: решение «вернуть остаток» уходит в общий путь записи и пересборки');
    console.log('\n' + passed + '/' + total + ' проверок');
}
