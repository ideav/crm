// #4566/#4569 — «Урегулировать» и ЗАМОРОЖЕННЫЙ день.
//
// ПРАВИЛО (решение заказчика 02.08.2026): «Урегулировать» — ручное действие и однозначная команда
// «сдвинуть всё». Остаток разделения и просроченные задания встают ПЕРЕД СЛЕДУЮЩИМ заданием своего
// станка, в каком бы дне оно ни стояло, — включая замороженный. Пропускать замороженный день
// нельзя: очередь сдвигается подряд, и пропуск оставил бы РАЗРЫВ (дыру в дне, а работу — за ним).
//
// ПОЧЕМУ ЭТО БЕЗОПАСНО. Прежде поставленное в замороженный день там и застревало: планировщик
// пришпиливал такие задания временным `c.fixed`, а страж отбрасывал все операции по ним — отсюда
// боевое #4566 (остаток встал на 03.08 07:59 поверх двух 🔒-заданий, день показал 521 мин при
// потолке 455). Теперь ручное действие обоими механизмами не ограничено (#4569): задания команды
// не пришпиливаются и их операции не отбрасываются, поэтому день раскладывается как надо.
//
// ЧТО ЗАМОРОЗКА ЗАЩИЩАЕТ: ЧУЖИЕ задания замороженного дня. Автоматика их не двигает, не удаляет и
// новых туда не ставит; `nearestFreeDayMs` («куда положить, когда сдвигать НЕ ОТ ЧЕГО» — у станка
// нет следующего задания) замороженные дни по-прежнему пропускает.
//
// Run with: node experiments/atex-production-planning-4566.test.js

process.env.TZ = 'Europe/Moscow';

global.document = {
    createElement: function() { return { style: {}, classList: { add: function() {}, remove: function() {}, contains: function() { return false; } },
        appendChild: function() {}, addEventListener: function() {}, setAttribute: function() {} }; },
    body: {}, readyState: 'loading', getElementById: function() { return null; }, addEventListener: function() {}
};
global.window = { db: 'testdb' };

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

function tsAt(y, m, d, hh, mm) { return Math.floor(new Date(y, m - 1, d, hh, mm, 0, 0).getTime() / 1000); }
function dayKey(y, m, d) { return y * 10000 + m * 100 + d; }
var TODAY = dayKey(2026, 8, 2);
var SHIFT_START = 480;   // 08:00

// ── 1) боевой случай #4566: следующее задание станка стои́т в ЗАМОРОЖЕННОМ дне ──
// Станок 1: частично выполненное 25 из 43 (просрочено, «Начато» 01.08); ближайшее задание станка —
// 03.08 08:00, день заморожен. Остаток обязан встать ПЕРЕД ним, в тот же день: очередь сдвигается
// подряд, «перепрыгнуть» через 03.08 значило бы оставить разрыв.
var cuts = [
    { id: 'part', slitter: { id: '1' }, plannedRuns: 43, actualRuns: 25,
      planDate: String(tsAt(2026, 7, 31, 9, 6)), startDate: String(tsAt(2026, 8, 1, 20, 30)), endDate: '' },
    { id: 'frozenday', slitter: { id: '1' }, plannedRuns: 100, actualRuns: 0, fixed: true,
      planDate: String(tsAt(2026, 8, 3, 8, 0)), startDate: '', endDate: '' },
    { id: 'openday', slitter: { id: '1' }, plannedRuns: 5, actualRuns: 0,
      planDate: String(tsAt(2026, 8, 4, 8, 0)), startDate: '', endDate: '' }
];
var groups = planning.deviationGroups(cuts, TODAY);
assertEqual(groups.overdue.map(function(c) { return c.id; }), ['part'],
    'просрочено — частично выполненное');

var settle = planning.deviationSettlePlan(cuts, groups, {
    todayKey: TODAY, shiftStartMin: SHIFT_START,
    freeDayMsFor: function() { return new Date(2026, 7, 4, 0, 0, 0, 0).getTime(); }
});
assertEqual(settle.splits.length, 1, 'разделение делаем — заморозка ему не помеха');
var sp = settle.splits[0];
assertEqual([sp.doneRuns, sp.restRuns], [25, 18], 'сделано 25 из 43 → выполненная часть 25, остаток 18');
assertEqual(sp.restPlanStart, tsAt(2026, 8, 3, 8, 0),
    '#4569/#4574 остаток занимает ВРЕМЯ следующего задания — в замороженном дне, без разрыва');
assertEqual(planning.planDateDayKey(sp.restPlanStart), dayKey(2026, 8, 3),
    'и это именно тот день, а не следующий за ним');
assertEqual(sp.restReason, 'before-next', 'причина места — «перед следующим заданием станка»');

// ── 2) фактический день заморожен — разделение всё равно делается ───────────
(function() {
    var factFrozen = [
        { id: 'partF', slitter: { id: '1' }, plannedRuns: 43, actualRuns: 25,
          planDate: String(tsAt(2026, 7, 31, 9, 6)), startDate: String(tsAt(2026, 8, 3, 10, 0)), endDate: '' },
        { id: 'openday', slitter: { id: '1' }, plannedRuns: 5, actualRuns: 0,
          planDate: String(tsAt(2026, 8, 4, 8, 0)), startDate: '', endDate: '' }
    ];
    var s = planning.deviationSettlePlan(factFrozen, planning.deviationGroups(factFrozen, TODAY), {
        todayKey: TODAY, shiftStartMin: SHIFT_START,
        freeDayMsFor: function() { return new Date(2026, 7, 4, 0, 0, 0, 0).getTime(); }
    });
    assertEqual(s.splits.length, 1, '#4569 фактический день заморожен → разделение всё равно делаем');
    assertEqual(planning.planDateDayKey(s.splits[0].donePlanStart), dayKey(2026, 8, 3),
        'выполненная часть остаётся в СВОЁМ фактическом дне, даже если он заморожен');
})();

// ── 3) порядок сохраняется и разрывов нет: два просроченных встают подряд ───
(function() {
    var many = [
        { id: 'late1', slitter: { id: '1' }, plannedRuns: 10, actualRuns: 0,
          planDate: String(tsAt(2026, 7, 30, 8, 0)), startDate: '', endDate: '' },
        { id: 'late2', slitter: { id: '1' }, plannedRuns: 10, actualRuns: 0,
          planDate: String(tsAt(2026, 7, 31, 8, 0)), startDate: '', endDate: '' },
        { id: 'frozenday', slitter: { id: '1' }, plannedRuns: 100, actualRuns: 0,
          planDate: String(tsAt(2026, 8, 3, 8, 0)), startDate: '', endDate: '' }
    ];
    var s = planning.deviationSettlePlan(many, planning.deviationGroups(many, TODAY), {
        todayKey: TODAY, shiftStartMin: SHIFT_START,
        freeDayMsFor: function() { return new Date(2026, 7, 4, 0, 0, 0, 0).getTime(); }
    });
    assertEqual(s.moves.map(function(m) { return m.id; }), ['late1', 'late2', 'frozenday'],
        'оба просроченных получают место, «следующее» подвинуто ими');
    assertEqual([s.moves[0].planStart, s.moves[1].planStart, s.moves[2].planStart],
        [tsAt(2026, 8, 3, 8, 0), tsAt(2026, 8, 3, 8, 0) + 60, tsAt(2026, 8, 3, 8, 0) + 120],
        '#4574 встают вплотную друг за другом с ВРЕМЕНИ следующего задания — без разрывов');
})();

// ── 4) «когда сдвигать НЕ ОТ ЧЕГО» — свободный день по-прежнему НЕ замороженный ──
// У станка нет следующего задания: двигать нечего, значит это ВЫБОР дня, а не сдвиг очереди.
(function() {
    var c = Object.create(Controller.prototype);
    c.meta = { calendar: { id: '123162' }, freeze: { id: '633483' } };
    c.freezeByDay = { 20260803: { id: '656165' } };
    c.calendarByDay = {};
    c.downtimesBySlitter = {};
    c.daySettings = {};
    c.dayIsWorking = function() { return true; };
    // #4622: ПИНИМ «СЕГОДНЯ». dayOpenForWork спрашивает dayIsOverForSlitter (#4596), а тот меряет
    // день относительно текущей даты — без пина тест протухал: 04.08.2026 переставал быть будущим,
    // и «незамороженный рабочий день — открыт» падал у всех, кто запускал сеть после 04.08.2026.
    c.nowMs = function() { return new Date(2026, 7, 2, 9, 0, 0, 0).getTime(); };
    assertEqual(c.dayOpenForWork('1', new Date(2026, 7, 3, 0, 0, 0, 0).getTime()), false,
        'замороженный день закрыт для выбора «ближайшего свободного»');
    assertEqual(c.dayOpenForWork('1', new Date(2026, 7, 4, 0, 0, 0, 0).getTime()), true,
        'незамороженный рабочий день — открыт');
})();

// ── 5) #4572: ВЫПОЛНЕННОЕ задание — факт, а не план ─────────────────────────
// Выполненная часть встаёт в свой ФАКТИЧЕСКИЙ день, а он бывает выходным: работу делали в
// субботу 01.08. Планировщик такой день удержать не может («не удержало свой день — день
// нерабочий», #4434) и уносил задание вперёд — план оказывался в будущем при факте в прошлом,
// и задание тут же становилось «выполнено досрочно» (issue #4572).
// Правило: у выполненного («Закончено» заполнено) планировщику решать нечего — его во входе нет.
(function() {
    var c = Object.create(Controller.prototype);
    var done = { id: 'done', slitter: { id: '1' }, plannedRuns: 25, status: '',
        planDate: String(tsAt(2026, 8, 1, 8, 0)), startDate: String(tsAt(2026, 8, 1, 20, 30)),
        endDate: String(tsAt(2026, 8, 1, 16, 30)) };
    var open1 = { id: 'open', slitter: { id: '1' }, plannedRuns: 18, status: '',
        planDate: String(tsAt(2026, 8, 3, 8, 0)), startDate: '', endDate: '' };
    var started = { id: 'run', slitter: { id: '1' }, plannedRuns: 40, status: '',
        planDate: String(tsAt(2026, 8, 3, 9, 0)), startDate: String(tsAt(2026, 8, 3, 9, 0)), endDate: '' };
    c.cuts = [done, open1, started];
    // Тот же отбор, что делает buildSequenceOps.
    var planInput = c.cuts.filter(function(x) {
        if (String(x && x.status || '').trim() === 'Завершён') return false;
        return planning.planTsSeconds(x && x.endDate) == null;
    });
    assertEqual(planInput.map(function(x) { return x.id; }), ['open', 'run'],
        '#4572 выполненное задание («Закончено» заполнено) в планировщик не попадает');
    assertEqual(planInput.indexOf(done), -1,
        'его фактический день — суббота — больше не «решение планировщика», которое можно отменить');
})();

console.log('\n' + passed + '/' + total + ' passed');
if (passed !== total) process.exitCode = 1;
