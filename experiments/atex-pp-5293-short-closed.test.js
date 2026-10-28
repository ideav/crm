// #5293 — задание закрыли не полностью («Пропуск» на пульте слиттера) — планировщик это видит.
//
// Боевое (ateh, 28.10.2026, Станок 2): заказ 6216, задание 993285 — сделано 81 проход из 97,
// оператор нажал «Пропуск». Пульт пишет «Закончено», и для планирования задание выглядит
// выполненным: ни на карточке, ни в «Дэшборде отклонений» недоделанных 16 проходов не видно.
//
// Правило: задание с заполненным «Закончено», у которого «Кол-во резок факт» меньше
// «Кол-во резок план», — ЗАКРЫТО НЕ ПОЛНОСТЬЮ. Оно идёт третьей группой дэшборда (то же окно
// [С; По] ≤ сегодня) и подписывается на карточке. Факт неизвестен (колонки нет) — молчим.
//
// Run with: node experiments/atex-pp-5293-short-closed.test.js

process.env.TZ = 'UTC';

var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    var ok = a === e;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + e + ', получено ' + a + ')'));
    if (ok) passed++; else process.exitCode = 1;
}
function ts(y, m, d, hh) { return String(Math.floor(Date.UTC(y, m - 1, d, hh || 8, 0, 0) / 1000)); }

var TODAY = 20261028;
var FROM = '2026-10-26', TO = '2026-10-30';

function cut(id, day, fact, plan, ended) {
    return {
        id: id, planDate: ts(2026, 10, day), startDate: fact != null && fact > 0 ? ts(2026, 10, day) : '',
        endDate: ended ? ts(2026, 10, day, 15) : '', actualRuns: fact, plannedRuns: plan
    };
}
var cuts = [
    cut('993285', 28, 81, 97, true),     // заказ 6216: пропущено после 81 из 97
    cut('2', 28, 97, 97, true),          // сделано всё
    cut('3', 27, 100, 97, true),         // сделано больше плана — не недоделка
    cut('4', 28, 50, 97, false),         // ещё в работе — не закрыто
    cut('5', 27, 0, 10, true),           // пропущено, не начав
    cut('6', 29, 3, 10, true),           // плановый день завтра — вне окна
    cut('7', 20, 3, 10, true),           // до «С» — вне окна
    cut('8', 28, null, 10, true)         // факт неизвестен — молчим
];
var opts = {
    todayKey: TODAY, dateFrom: FROM, dateTo: TO,
    positionsByCut: { '993285': [{ id: '900', orderNo: '6216' }] }
};

var groups = planning.dashboardGroups(cuts, opts);
assertEqual((groups.short || []).map(function(x) { return x.cut.id; }), ['5', '993285'],
    'dashboardGroups: «закрыто не полностью» — пропущенное после 81 из 97 и пропущенное с нуля, по плану');
var it = (groups.short || []).filter(function(x) { return x.cut.id === '993285'; })[0] || {};
assertEqual([it.done, it.planned, it.rest, it.orders], [81, 97, 16, ['6216']],
    'dashboardGroups: у пропущенного задания — сделано, план, недоделано и номер заказа');

assertEqual(planning.shortClosedRuns(cuts[0]), { done: 81, planned: 97, rest: 16 },
    'shortClosedRuns: закрыто с фактом меньше плана → сколько недоделано');
assertEqual([cuts[1], cuts[2], cuts[3], cuts[7]].map(planning.shortClosedRuns), [null, null, null, null],
    'shortClosedRuns: сделано всё / больше / ещё в работе / факт неизвестен → null');

var note = planning.shortClosedNote(cuts[0]);
assertEqual(note && note.text, 'закрыто не полностью: сделано 81 из 97 проходов · не сделано 16',
    'shortClosedNote: подпись карточки называет недоделку');
assertEqual(planning.shortClosedNote(cuts[1]), null, 'shortClosedNote: выполненное полностью — без подписи');

console.log('\n' + passed + '/' + total + ' проверок');
