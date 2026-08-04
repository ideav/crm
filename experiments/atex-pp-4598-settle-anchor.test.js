// issue #4598 (часть 1): КУДА «Урегулировать» ставит остаток просроченного задания.
//
// Тикет: «Доделывание заказа уехало в конец дня… такого не должно быть — заказы должны
// сдвигаться, невзирая на заморозки, фиксирование и видимый диапазон» (заказ 4461, Станок 1).
//
// Правило (#4564/#4574): остаток встаёт НА МЕСТО СЛЕДУЮЩЕГО задания своего станка, в каком бы дне
// оно ни стояло, а само оно отходит на минуту дальше. Здесь мерим, что «следующим» считается
// на самом деле — по каждому из трёх названных заказчиком признаков.
//
// Run with: node experiments/atex-pp-4598-settle-anchor.test.js

process.env.TZ = 'Europe/Moscow';
global.window = { db: 'ateh', xsrf: 'x' };
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var DAY = 86400;
function ts(dd, hh, mm) {   // август 2026, Europe/Moscow
    return Math.floor(new Date(2026, 7, dd, hh, mm || 0, 0, 0).getTime() / 1000);
}
var TODAY = 20260804;

// Просроченное частично выполненное задание: план 03.08, сделано 70 из 125.
function overdue() {
    return { id: 'OVER', slitter: { id: 'S1' }, plannedRuns: 125, actualRuns: 70,
             planDate: String(ts(3, 8, 0)), startDate: String(ts(3, 16, 32)), endDate: '' };
}
// Кандидаты в «следующее задание станка» на 04.08.
function next(id, hh, extra) {
    var c = { id: id, slitter: { id: 'S1' }, plannedRuns: 5, actualRuns: null,
              planDate: String(ts(4, hh, 0)), startDate: '', endDate: '' };
    for (var k in (extra || {})) c[k] = extra[k];
    return c;
}

function settle(cuts) {
    var groups = { overdue: cuts.filter(function(c) { return c.id === 'OVER'; }), early: [], earlyRun: [] };
    return P.deviationSettlePlan(cuts, groups, {
        todayKey: TODAY, shiftStartMin: 480, shiftEndMin: 970,
        freeDayMsFor: function() { return new Date(2026, 7, 6, 0, 0, 0, 0).getTime(); }
    });
}
function restOf(res) { return (res.splits || [])[0]; }
function hhmm(t) {
    if (t == null) return '—';
    var d = new Date(t * 1000);
    return String(d.getDate()) + '.08 ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}

// ── Базовый случай: следующее задание — обычное, свободное ────────────────────────────────────
(function() {
    var early = next('A', 9), late = next('B', 14);
    var res = settle([overdue(), early, late]);
    var rest = restOf(res);
    assert(rest && rest.restRuns === 55, 'остаток = план − сделано = 55 проходов',
           rest ? ('restRuns=' + rest.restRuns) : 'разделения нет');
    assert(rest && rest.restPlanStart === Number(early.planDate),
        'остаток встаёт на место САМОГО РАННЕГО задания станка (09:00), а не в конец дня',
        rest ? ('получили ' + hhmm(rest.restPlanStart)) : '');
})();

// ── Признак 1: следующее задание ЗАФИКСИРОВАНО (🔒) ───────────────────────────────────────────
(function() {
    var early = next('A', 9, { fixed: true }), late = next('B', 14);
    var rest = restOf(settle([overdue(), early, late]));
    assert(rest && rest.restPlanStart === Number(early.planDate),
        '🔒 на следующем задании не мешает: остаток всё равно встаёт перед ним (09:00)',
        rest ? ('получили ' + hhmm(rest.restPlanStart)) : '');
})();

// ── Признак 2: следующее задание стои́т ПОЗЖЕ видимого диапазона [С;По] ────────────────────────
// Окно фильтра — вход не ограничивает (#3974), поэтому задание другого дня обязано считаться.
(function() {
    var far = { id: 'FAR', slitter: { id: 'S1' }, plannedRuns: 5, actualRuns: null,
                planDate: String(ts(6, 8, 0)), startDate: '', endDate: '' };
    var rest = restOf(settle([overdue(), far]));
    assert(rest && rest.restPlanStart === Number(far.planDate),
        'задание ЗА видимым диапазоном (06.08) всё равно считается «следующим»',
        rest ? ('получили ' + hhmm(rest.restPlanStart)) : '');
})();

// ── Признак 3: следующее задание НАЧАТО ───────────────────────────────────────────────────────
// #4381: перед начатым не встаём — оно бы сдвинулось. Тогда «следующим» становится СЛЕДУЮЩЕЕ
// за ним, и остаток уезжает ПОЗЖЕ. Именно это выглядит как «уехало в конец дня».
(function() {
    var started = next('A', 9, { startDate: String(ts(4, 9, 5)) });
    var late = next('B', 14);
    var rest = restOf(settle([overdue(), started, late]));
    assert(rest && rest.restPlanStart === Number(late.planDate),
        'начатое задание пропускается (#4381) — остаток уезжает за него, на 14:00',
        rest ? ('получили ' + hhmm(rest.restPlanStart)) : '');
})();

// ── Признак 4: ВСЕ задания станка начаты — якоря нет вовсе ────────────────────────────────────
(function() {
    var s1 = next('A', 9, { startDate: String(ts(4, 9, 5)) });
    var s2 = next('B', 14, { startDate: String(ts(4, 14, 5)) });
    var rest = restOf(settle([overdue(), s1, s2]));
    var freeDay = Math.floor(new Date(2026, 7, 6, 0, 0, 0, 0).getTime() / 1000) + 480 * 60;
    assert(rest && rest.restPlanStart === freeDay,
        'якоря нет — остаток едет на начало ближайшего свободного дня (06.08 08:00)',
        rest ? ('получили ' + hhmm(rest.restPlanStart)) : '');
})();

console.log('\n' + passed + '/' + total + ' passed');
