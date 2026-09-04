// #4883 — факт наладки в планировщике: оператор наладил станок под завтрашнюю
// резку (кнопка «Наладка» в пульте вчера вечером), и планировщик должен показать
// наладку в ДНЕ НАЛАДКИ, а проходы — оставить в план-дне.
//
// Чистая функция setupFactNotes отбирает задания, у которых «Начато» датировано
// РАНЬШЕ план-дня (маркер наладки из пульта: её ставит только кнопка «Наладка»),
// и отдаёт по одному факту на задание. На бой: заказ 5100 — «Наладка» 03.09 19:26,
// план 04.09 08:00, проходов 0 — планировщик показывал задание без каких-либо
// следов наладки.
//
// Run with: node experiments/atex-pp-4883-setup-fact.test.js

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
function clockOf(started) {
    var s = P.planTsSeconds(started);
    var dt = new Date(s * 1000);
    return (dt.getHours() < 10 ? '0' : '') + dt.getHours() + ':' + (dt.getMinutes() < 10 ? '0' : '') + dt.getMinutes();
}
function notes(cuts) {
    return P.setupFactNotes(cuts, { dayIso: P.planDateIso, dayLabel: P.formatPlanDayLabel, clock: clockOf });
}

// Боевой случай: заказ 5100 — наладка вчера (03.09 19:26) под план сегодня (04.09 08:00).
var CUT = { id: '771816', planDate: ts(2026, 9, 4, 8, 0), startDate: ts(2026, 9, 3, 19, 26), orderNo: '5100' };

(function () {
    var list = notes([CUT]);
    assert(list.length === 1, 'задание с наладкой накануне план-дня даёт ровно один факт', '(' + list.length + ')');
    var f = list[0];
    assert(!!f && f.cutId === '771816', '#4883 факт ссылается на задание');
    assert(!!f && f.factDayIso === '2026-09-03', '#4883 день наладки — вчера (ISO)', '(' + (f && f.factDayIso) + ')');
    assert(!!f && f.factDayLabel === '03.09.2026', '#4878 день наладки — в подписи «ДД.ММ.ГГГГ»', '(' + (f && f.factDayLabel) + ')');
    assert(!!f && f.clock === '19:26', '#4883 время наладки — ЧЧ:ММ', '(' + (f && f.clock) + ')');
})();

// ── мимо: штатные случаи фактом наладки не считаются ──
(function () {
    var list = notes([
        { id: 'a', planDate: ts(2026, 9, 3, 8, 0), startDate: ts(2026, 9, 3, 7, 30), orderNo: '5099' },  // наладка в свой план-день
        { id: 'b', planDate: ts(2026, 9, 2, 8, 0), startDate: ts(2026, 9, 3, 19, 26), orderNo: '5098' }, // начато ПОЗЖЕ плана
        { id: 'c', planDate: ts(2026, 9, 4, 8, 0), startDate: '', orderNo: '5097' },                     // не начато
        { id: 'd', planDate: ts(2026, 9, 4, 8, 0), orderNo: '5096' }                                     // «Начато» нет вовсе
    ]);
    assert(list.length === 0, '#4883 штатные случаи (наладка в свой день, позже плана, не начато) — фактов нет', '(' + list.length + ')');
})();

// ── несколько фактов: сортировка по дню наладки, затем по времени ──
(function () {
    var list = notes([
        { id: 'late', planDate: ts(2026, 9, 5, 8, 0), startDate: ts(2026, 9, 4, 20, 10), orderNo: '6002' },
        { id: 'early', planDate: ts(2026, 9, 4, 8, 0), startDate: ts(2026, 9, 3, 19, 26), orderNo: '6001' },
        { id: 'early2', planDate: ts(2026, 9, 4, 9, 0), startDate: ts(2026, 9, 3, 18, 5), orderNo: '6000' }
    ]);
    assert(list.length === 3, '#4878 оба наканунных факта собраны', '(' + list.length + ')');
    assert(list[0] && list[0].cutId === 'early2' && list[1] && list[1].cutId === 'early' && list[2] && list[2].cutId === 'late',
        '#4878 сортировка: день наладки, затем время', '(' + list.map(function (f) { return f.cutId; }).join(',') + ')');
    assert(list[0] && list[0].orderNo === '6000', '#4878 номер заказа при себе — для подписи в доске');
})();

console.log('\n' + passed + '/' + total + ' passed');
if (process.exitCode) process.exit(process.exitCode);
