// #5075 — время пульта слиттера: часы планшета не в счёт, только серверное (московское) время.
// Решение владельца: «пофиг на часы планшета, пиши серверное время. Планшетов десятки, мы не
// будем за ними бегать». На планшете chernov часы убегали на ~5 ч вперёд сервера.
//   1) ПОКАЗ: все времена и даты пульта (события смены, время резки, дата партии, день в
//      шапке) — по Москве (UTC+3, пояс сервера), а не по поясу устройства;
//   2) ЗАПИСЬ: «Начато»/«Закончено», события смены — серверное «сейчас»: часы устройства +
//      сдвиг, измеренный по заголовку `Date` ответов сервера (getJson и post);
//   3) «Сегодня» пульта (selectedDate) — московская дата по серверному времени.
//
// Run with: node experiments/atex-slitter-5075-server-time.test.js

// Устройство в чужом поясе: по Лос-Анджелесу 1791176243 — это ещё 04.10.2026 21:57.
process.env.TZ = 'America/Los_Angeles';

var SERVER_MS = 1791176243 * 1000;               // 05.10.2026 07:57:23 МСК = 04:57:23 UTC
var DEVICE_SKEW_MS = -10 * 3600 * 1000;          // часы планшета отстают на 10 ч (другие сутки)
var realNow = Date.now;
Date.now = function() { return SERVER_MS + DEVICE_SKEW_MS; };

global.document = {
    createElement: function() { return { classList: { add: function() {}, toggle: function() {} }, appendChild: function() {}, setAttribute: function() {} }; },
    createTextNode: function() { return {}; },
    body: {}, readyState: 'loading',
    getElementById: function() { return null; }, addEventListener: function() {},
    querySelector: function() { return null; }
};
global.window = { db: 'ateh' };

function response(body) {
    return {
        ok: true, status: 200,
        headers: { get: function(name) { return /^date$/i.test(name) ? new Date(SERVER_MS).toUTCString() : null; } },
        text: function() { return Promise.resolve(JSON.stringify(body)); }
    };
}
global.fetch = function() { return Promise.resolve(response({})); };

var api = require('../download/atex/js/slitter.js');
var core = api.core, Controller = api.Controller;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; return; }
    console.log('  expected:', JSON.stringify(expected));
    console.log('  actual:  ', JSON.stringify(actual));
    process.exitCode = 1;
}

// ── 1) Показ по Москве, а не по поясу устройства ───────────────────────────────────────────────
assertEqual(core.formatClock('1791176243'), '07:57', '#5075: время резки (штамп) — по Москве');
assertEqual(core.formatDate('1791176243'), '05.10.2026', '#5075: дата (штамп) — по Москве');
assertEqual(core.formatEventWhen('1791176243'), '05.10.2026 07:57', '#5075: время события смены — по Москве');
assertEqual(core.formatBatchLabel('1791176243'), '05.10.2026 07:57', '#5075: дата партии — по Москве');
assertEqual(core.dateKey('1791176243'), 20261005, '#5075: календарный ключ штампа — московский день');
assertEqual(core.dayStartTimestamp('1791176243'), 1791147600, '#5075: начало дня — московская полночь (05.10 00:00 МСК)');
assertEqual(core.eventWhenSeconds('2026-10-05 07:57:23'), 1791176243,
    '#5075: «YYYY-MM-DD HH:MM:SS» события — московское время сервера');
assertEqual(core.formatDateTime(new Date(SERVER_MS)), '2026-10-05 07:57:23', '#5075: formatDateTime — московские часы');

// ── 2) Серверное «сейчас» по заголовку Date ────────────────────────────────────────────────────
var inst = Object.create(Controller.prototype);
inst.db = 'ateh';
inst.root = { getAttribute: function() { return ''; } };
inst.url = function(p) { return '/ateh/' + p; };
inst.getJson('metadata?JSON').then(function() {
    assertEqual(Math.round(core.serverNowMs() / 1000), 1791176243,
        '#5075: после ответа сервера serverNowMs = часы устройства + сдвиг по заголовку Date');
    assertEqual(inst.eventDateTime(), '2026-10-05 07:57:23',
        '#5075: «Начато»/«Закончено»/событие смены пишутся серверным московским временем, а не часами планшета');
    assertEqual(core.todayISO(), '2026-10-05', '#5075: «сегодня» пульта — московская дата сервера');

    // Часы планшета «уехали» ещё на 5 ч — следующий ответ (post) пересчитывает сдвиг.
    DEVICE_SKEW_MS = 5 * 3600 * 1000;
    return inst.post('_m_set/1?JSON', { t1: 1 });
}).then(function() {
    assertEqual(inst.eventDateTime(), '2026-10-05 07:57:23', '#5075: сдвиг уточняется по каждому ответу (post)');
}).then(function() {
    // ── 3) День пульта при запуске — по серверу ─────────────────────────────────────────────
    var c = Object.create(Controller.prototype);
    c.root = { innerHTML: '', appendChild: function() {}, getAttribute: function() { return ''; } };
    c.dateFromQuery = false;
    c.selectedDate = '2026-10-04';   // посчитано при создании по часам устройства
    c.syncSelectedDateWithServer();
    assertEqual(c.selectedDate, '2026-10-05', '#5075: после первого ответа сервера день пульта — серверный');
    c.dateFromQuery = true;
    c.selectedDate = '2026-08-23';
    c.syncSelectedDateWithServer();
    assertEqual(c.selectedDate, '2026-08-23', '#5075: день из адреса (?date=, #4808) не трогаем');
}).catch(function(e) {
    console.log('FAIL — исключение: ' + (e && e.stack || e));
    process.exitCode = 1;
}).then(function() {
    Date.now = realNow;
    console.log('\n' + passed + '/' + total + ' passed');
});
