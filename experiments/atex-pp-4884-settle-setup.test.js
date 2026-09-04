// #4885 — урегулирование переносит выполненную настройку в день её выполнения.
//
// Боевая ateh, заказ 5100 (Станок 2): задание 771816 — 7 проходов, план 04.09 08:00.
// Вчера (03.09) оператор открыл смену, нажал «Наладка» (19:26:35), закрыл смену:
// «Начато» = 03.09 19:26:35, «В работе», проходов 0. Урегулирование («Смена закрыта»)
// двигало задание ЦЕЛИКОМ на ближайший свободный день — вместе с уже выполненной
// настройкой. Должно: настройка выделяется записью с 0 резок в день выполнения
// (03.09 — обычный setup-сегмент #3635), резки остаются на плановом времени (04.09),
// записи связываются «ID выполненной части» (#4651).
//
// Run with: node experiments/atex-pp-4884-settle-setup.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh', xsrf: 'x' };

var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

function ts(y, mo, d, h, mi) { return String(Math.round(new Date(y, mo - 1, d, h || 0, mi || 0).getTime() / 1000)); }

// Задание: наладка вчера 19:26, 7 проходов, план сегодня 08:00, факт резок 0.
var SETUP_JOB = {
    id: '771816',
    planDate: ts(2026, 9, 4, 8, 0),
    startDate: ts(2026, 9, 3, 19, 26),
    plannedRuns: 7,
    actualRuns: '',
    slitter: { id: '1279', label: 'Станок 2' },
    slitterId: '1279'
};

function settle(cuts, extraGroups) {
    var groups = extraGroups || {};
    if (!groups.shiftClosed && !groups.overdue && !groups.early && !groups.earlyRun) {
        groups = { shiftClosed: cuts.slice() };
    }
    return P.deviationSettlePlan(cuts, groups, {
        todayKey: 20260904,
        shiftStartMin: 480,
        shiftEndMin: 990
    });
}

// ── 1. боевой случай: настройка переезжает в день выполнения, резки остаются ──
(function () {
    var res = settle([SETUP_JOB]);
    var sp = (res.splits || []).filter(function (s) { return s.id === '771816'; })[0];
    assert(!!sp, 'урегулирование разделяет задание с выполненной настройкой');
    assert(sp && sp.doneRuns === 0, 'настройка — запись с 0 резок', '(' + (sp && sp.doneRuns) + ')');
    assert(sp && sp.restRuns === 7, 'проходы остаются целиком в остатке', '(' + (sp && sp.restRuns) + ')');
    assert(sp && String(sp.donePlanStart) === SETUP_JOB.startDate,
        'настройка встаёт в день выполнения (момент «Начато»)', '(' + (sp && sp.donePlanStart) + ')');
    assert(sp && String(sp.restPlanStart) === SETUP_JOB.planDate && sp.restReason === 'stay',
        'резки остаются на плановом времени задания', '(' + (sp && sp.restPlanStart) + ', ' + (sp && sp.restReason) + ')');
    var moved = (res.moves || []).filter(function (m) { return m.id === '771816'; })[0];
    assert(!moved, 'задание целиком больше никуда не двигается', '(' + JSON.stringify(moved) + ')');
})();

// ── 2. наладка в СВОЙ план-день — прежнее поведение: разделения нет (#4830) ──
(function () {
    var sameDay = { id: '880001', planDate: ts(2026, 9, 4, 8, 0), startDate: ts(2026, 9, 4, 7, 30),
        plannedRuns: 3, actualRuns: '', slitterId: '1279', slitter: { id: '1279', label: 'Станок 2' } };
    var res = settle([sameDay]);
    var sp = (res.splits || []).filter(function (s) { return s.id === '880001'; })[0];
    assert(!sp, '#4830 наладка в свой план-день не разделяется');
})();

console.log('\n' + passed + '/' + total + ' passed');
if (process.exitCode) process.exit(process.exitCode);
