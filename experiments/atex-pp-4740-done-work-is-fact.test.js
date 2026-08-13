// #4740 — СДЕЛАННАЯ РАБОТА — ФАКТ, А НЕ ДЕФЕКТ ПЛАНА.
//
// ПРАВИЛО (решение заказчика 13.08.2026, тело #4740): «Эти задания выполнены, с ними вообще уже
// ничего не сделать никак, вот эти надо оставлять как есть».
//
// СИМПТОМ (боевое 13.08.2026, ateh1, после «Урегулировать»):
//   • «Не помещается в смену: Станок 1, Ср, 12.08.2026 — до 18:20 при потолке 16:15 (+125 мин),
//     последнее задание № 15 «Фольга горячего тиснения MB IN — 183 х 2»; Станок 3, Чт, 13.08.2026 —
//     до 17:23 при потолке 16:15 (+68 мин)… перенесите лишнее вручную (🗓) или «Упорядочить»» —
//     оба перебора создали ВЫПОЛНЕННЫЕ задания, переносить нечего;
//   • «День не набит до конца: смен, не набитых до потолка, — 3… нажмите «Упорядочить», чтобы
//     затянуть её сюда» — дни кончались сделанной работой, дописать в них нечего.
//
// ПОЧЕМУ ФАКТ, А НЕ КАЛЕНДАРЬ. «Вчера» и «сегодня» — свойство момента, когда смотрят: та же
// раскладка назавтра сменила бы вердикт, а окно фильтра [С;По] у оператора обычно начинается со
// вчерашнего дня. Сделанная работа остаётся сделанной всегда, поэтому меряем «Начато»/«Закончено».
//
// ЧТО ПРОВЕРЯЕМ:
//   A — перебор смены, набранный ВЫПОЛНЕННЫМ последним заданием, мерка не считает нарушением;
//   A2 — тот же день с ПЛАНОВЫМ последним заданием по-прежнему считается (молчания не завели);
//   A3 — начатое последнее задание считается так же, как выполненное (работа уже идёт);
//   B — недобор дня, который КОНЧАЕТСЯ сделанной работой, не называется;
//   B2 — недобор обычного дня называется, как и раньше (регрессия #4469);
//   C — «выполнено» читаем по «Закончено», а не по колонке статуса (#4572: отчёт её не отдаёт).
//
// Run with: node experiments/atex-pp-4740-done-work-is-fact.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var mod = require('../download/atex/js/production-planning.js');
var P = mod.planning;
var Controller = mod.Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var BASE = new Date(2026, 7, 12, 0, 0, 0, 0).getTime();   // Ср 12.08.2026 = день 0
var D0 = Math.round(BASE / 1000) + 8 * 3600;
var DAY = 86400;
var WIN = { baseMidnightMs: BASE, dayStartMin: 480, cutEndMin: 480 + 450,
            maxOverworkCutsMin: 5, lunchStartMin: 740, lunchDurationMin: 40 };

// Задание очереди: хранимые минуты (их и складывает мерка дня), «Начато»/«Закончено» — факт.
function cut(id, o) {
    return { id: id, slitter: { id: '1279' }, materialId: o.mat || 'MW308', status: o.status || '',
             planDate: String(D0 + (o.day || 0) * DAY + (o.min || 0) * 60),
             storedKnifeSetupMin: o.knife || 0, storedMaterialWindingMin: o.material || 0,
             storedCutAndLeaderMin: o.work || 0,
             startDate: o.startDate || '', endDate: o.endDate || '' };
}

// ── A. ПЕРЕБОР СМЕНЫ, НАБРАННЫЙ СДЕЛАННОЙ РАБОТОЙ ───────────────────────────────────────────
// День 0: 300 + 305 = 605 мин при потолке 450 — перебор +155. Последнее задание ВЫПОЛНЕНО.
function overfilledDay(lastExtra) {
    var last = { day: 0, min: 300, work: 305 };
    Object.keys(lastExtra || {}).forEach(function (k) { last[k] = lastExtra[k]; });
    return [ cut('a1', { day: 0, min: 0, work: 300 }), cut('a2', last) ];
}
var doneTail = P.overfilledDaysFromCuts(overfilledDay({ endDate: String(D0 + 9 * 3600) }), WIN);
assert(doneTail.length === 0,
    'A. перебор смены создан ВЫПОЛНЕННЫМ последним заданием — это факт, а не нарушение',
    'дней в мерке: ' + doneTail.length);

var openTail = P.overfilledDaysFromCuts(overfilledDay({}), WIN);
assert(openTail.length === 1 && openTail[0].overMin > 0,
    'A2. тот же день с ПЛАНОВЫМ последним заданием считается по-прежнему — молчания не завели',
    'дней: ' + openTail.length + (openTail[0] ? ', перебор +' + openTail[0].overMin + ' мин' : ''));

var startedTail = P.overfilledDaysFromCuts(overfilledDay({ startDate: String(D0 + 3600) }), WIN);
assert(startedTail.length === 0,
    'A3. НАЧАТОЕ последнее задание — тот же случай: работа уже идёт, увозить нечего',
    'дней в мерке: ' + startedTail.length);

// ── C. «ВЫПОЛНЕНО» ЧИТАЕМ ПО «Закончено», А НЕ ПО СТАТУСУ ───────────────────────────────────
// #4572: колонку статуса отчёт `cut_planning` не отдаёт — в боевой базе у всех приходит ''/'X'.
var byStatusOnly = P.overfilledDaysFromCuts(overfilledDay({ status: 'Завершён' }), WIN);
assert(byStatusOnly.length === 1,
    'C. один статус «Завершён» без «Закончено» фактом не считается — отчёт статус не отдаёт (#4572)',
    'дней: ' + byStatusOnly.length);

// ── B. НЕДОБОР ДНЯ, КОТОРЫЙ КОНЧАЕТСЯ СДЕЛАННОЙ РАБОТОЙ ────────────────────────────────────
// Считаем через planUnderfilledDays на стаб-контроллере: он собирает сегменты из очереди
// (planLayoutItems) и зовёт ту же чистую мерку, что и упаковщик.
function underfillSelf(lastDone) {
    var self = Object.create(Controller.prototype);
    self.filter = { date: '2026-08-12' };
    self.nowMs = function () { return BASE; };
    self.meta = {};
    self.supplies = [];
    self.workingWindow = function () {
        return { startMin: 480, cutEndMin: 480 + 450, endMin: 480 + 510,
                 maxOverworkCutsMin: 5, maxOverworkTuneMin: 10,
                 lunchStartMin: 740, lunchDurationMin: 40 };
    };
    // День 0 занят на 100 мин из 450 — места вдоволь; в дне 1 стои́т задание на 4 прохода по 20 мин.
    self.cuts = [
        cut('u1', { day: 0, min: 0, work: 100, endDate: lastDone ? String(D0 + 2 * 3600) : '' }),
        cut('u2', { day: 1, min: 0, work: 80 })
    ];
    self.cuts[0].plannedRuns = 5;
    self.cuts[1].plannedRuns = 4;
    return self;
}
// planLayoutItems читает набор ИЗ АРГУМЕНТА (как зовёт warnUnderfilledAfterSettle: `this.cuts`).
var openSelf = underfillSelf(false);
var openDay = openSelf.planUnderfilledDays(openSelf.cuts, null);
assert(openDay.length === 1,
    'B2. обычный недобранный день называется, как и раньше (регрессия #4469)',
    'дни: ' + JSON.stringify(openDay));

var workedSelf = underfillSelf(true);
var workedDay = workedSelf.planUnderfilledDays(workedSelf.cuts, null);
assert(workedDay.length === 0,
    'B. день, который КОНЧАЕТСЯ сделанной работой, не добиваем и о нём не говорим',
    'дни: ' + JSON.stringify(workedDay));

// ── E. ЗАКРЫТАЯ СМЕНА И ПРОШЕДШИЙ ДЕНЬ: В НИХ НИЧЕГО НЕ ЗАТАСКИВАЮТ ────────────────────────
// Решение заказчика 13.08.2026: «Если смена закрыта — это триггер для „Урегулировать“ — то в этот
// день ничего уже не затаскивать». Прошедший день — тот же случай (#4596: кончился для всех).
function fillSelf(nowDayOffset, closedIds) {
    var self = underfillSelf(false);
    self.nowMs = function () { return BASE + nowDayOffset * 86400000 + 9 * 3600000; };
    self.shiftClosedSlittersToday = function () { return closedIds || {}; };
    return self;
}
var todayOpen = fillSelf(0, {});
assert(todayOpen.planUnderfilledDays(todayOpen.cuts, null).length === 1,
    'E. смена идёт — день добираем, недобор называем (поведение #4469 прежнее)',
    'дни: ' + JSON.stringify(todayOpen.planUnderfilledDays(todayOpen.cuts, null)));

var todayClosed = fillSelf(0, { '1279': 1 });
assert(todayClosed.planUnderfilledDays(todayClosed.cuts, null).length === 0,
    'E2. смена ЗАКРЫТА — в этот день больше ничего не затаскиваем и о недоборе не говорим',
    'дни: ' + JSON.stringify(todayClosed.planUnderfilledDays(todayClosed.cuts, null)));

var dayPassed = fillSelf(1, {});
assert(dayPassed.planUnderfilledDays(dayPassed.cuts, null).length === 0,
    'E3. день ПРОШЁЛ — то же самое: писать работу во вчерашнюю смену нельзя',
    'дни: ' + JSON.stringify(dayPassed.planUnderfilledDays(dayPassed.cuts, null)));

var otherClosed = fillSelf(0, { '9999': 1 });
assert(otherClosed.planUnderfilledDays(otherClosed.cuts, null).length === 1,
    'E4. закрытая смена ЧУЖОГО станка этот день не закрывает — «кончился» считается по станку (#4596)',
    'дни: ' + JSON.stringify(otherClosed.planUnderfilledDays(otherClosed.cuts, null)));

// ── D. ПРАВИЛО ЖИВЁТ В ОДНОМ ПРЕДИКАТЕ ─────────────────────────────────────────────────────
var src = require('fs').readFileSync(
    __dirname + '/../download/atex/js/production-planning/20-controller.js', 'utf8');
assert(/immovable: cutWorkIsFact\(cut\)/.test(src),
    'D. «работа — факт» у сегментов раскладки читается тем же предикатом, что у мерки и у ручного сдвига');

console.log('\n' + passed + '/' + total + ' проверок пройдено');
