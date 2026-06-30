// Unit tests for ideav/crm#3883 — частичный отпуск станка (напр. 2 часа) не должен блокировать
// станок на ВЕСЬ день.
//
// Баг: slitterDownOnDay считал «весь день в отпуске» при ЛЮБОМ пересечении суток, поэтому
// 2-часовой отпуск (30.06 08:00–10:00) исключал станок из планирования совсем — Гант пустой во
// все дни. Фикс: «отпуск на день» = окна простоя ПОЛНОСТЬЮ покрывают рабочее окно [startMin;
// cutEndMin]. Частичный отпуск день не блокирует — станок работает остаток дня, а расписание
// сдвигает резки за окно простоя (#3764).
//
// Run with: node experiments/atex-production-planning-3883.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++; else { failed++; console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

function dayMs(y, m, d) { return Date.UTC(y, m - 1, d); }
function hMs(y, m, d, h) { return Date.UTC(y, m - 1, d, h); }   // час дня в UTC
function sec(ms) { return Math.floor(ms / 1000); }

var WS = 480, WE = 970;   // рабочее окно резки 08:00–16:10 (мин от полуночи)
var DAY = dayMs(2026, 6, 30);

// ── Сценарий issue: отпуск 30.06 08:00–10:00 (2 часа) → станок НЕ в отпуске на день ──
(function () {
    var dt = [{ start: sec(hMs(2026, 6, 30, 8)), end: sec(hMs(2026, 6, 30, 10)) }];
    assert(!planning.slitterDownOnDay(dt, DAY, WS, WE),
        '#3883 отпуск 2 часа (08:00–10:00) → станок РАБОТАЕТ в этот день (не весь день)');
})();

// ── Частичные окна в любой части дня → день не блокируется ──
(function () {
    assert(!planning.slitterDownOnDay([{ start: sec(hMs(2026, 6, 30, 12)), end: sec(hMs(2026, 6, 30, 14)) }], DAY, WS, WE),
        '#3883 отпуск в середине дня (12:00–14:00) → не весь день');
    assert(!planning.slitterDownOnDay([{ start: sec(hMs(2026, 6, 30, 14)), end: sec(hMs(2026, 6, 30, 20)) }], DAY, WS, WE),
        '#3883 отпуск во второй половине (14:00–20:00, конец до cutEnd? покрыт хвост) → есть рабочее время утром → не весь день');
})();

// ── Полное покрытие рабочего окна → станок в отпуске на день ──
(function () {
    // Окно 06:00–18:00 покрывает [08:00; 16:10] целиком.
    assert(planning.slitterDownOnDay([{ start: sec(hMs(2026, 6, 30, 6)), end: sec(hMs(2026, 6, 30, 18)) }], DAY, WS, WE),
        '#3883 отпуск 06:00–18:00 (покрывает рабочее окно) → весь день в отпуске');
    // Окно ровно по рабочему окну [08:00; 16:10] — тоже полное покрытие.
    assert(planning.slitterDownOnDay([{ start: sec(DAY + WS * 60000), end: sec(DAY + WE * 60000) }], DAY, WS, WE),
        '#3883 отпуск ровно 08:00–16:10 → весь день в отпуске');
    // Многодневное окно (29.06 00:00 – 02.07 00:00) покрывает рабочий день 30.06.
    assert(planning.slitterDownOnDay([{ start: sec(dayMs(2026, 6, 29)), end: sec(dayMs(2026, 7, 2)) }], DAY, WS, WE),
        '#3883 многодневный отпуск → внутренний день полностью в отпуске');
})();

// ── Почти полное окно (не дотягивает до cutEnd) → есть рабочее время → не весь день ──
(function () {
    // 08:00–16:00 не покрывает 16:00–16:10 → остаётся 10 минут резки → не весь день.
    assert(!planning.slitterDownOnDay([{ start: sec(DAY + WS * 60000), end: sec(hMs(2026, 6, 30, 16)) }], DAY, WS, WE),
        '#3883 отпуск 08:00–16:00 (не до cutEnd) → есть рабочее время → не весь день');
})();

// ── Два окна, вместе покрывающие рабочее окно → весь день в отпуске ──
(function () {
    var dt = [
        { start: sec(DAY + WS * 60000), end: sec(hMs(2026, 6, 30, 12)) },   // 08:00–12:00
        { start: sec(hMs(2026, 6, 30, 12)), end: sec(DAY + WE * 60000) }    // 12:00–16:10
    ];
    assert(planning.slitterDownOnDay(dt, DAY, WS, WE), '#3883 два смежных окна покрывают рабочее окно → весь день');
    // Два окна с ДЫРОЙ между ними → есть рабочее время → не весь день.
    var gap = [
        { start: sec(DAY + WS * 60000), end: sec(hMs(2026, 6, 30, 11)) },   // 08:00–11:00
        { start: sec(hMs(2026, 6, 30, 13)), end: sec(DAY + WE * 60000) }    // 13:00–16:10 (дыра 11–13)
    ];
    assert(!planning.slitterDownOnDay(gap, DAY, WS, WE), '#3883 два окна с дырой (11:00–13:00) → есть рабочее время → не весь день');
})();

console.log('\n' + passed + ' проверок прошло' + (failed ? ', ' + failed + ' упало' : '') + '.');
if (!failed) console.log('Все проверки #3883 зелёные.');
