// Regression test for ideav/crm#4021 — «почему 47 мин, а не 45?» на дне с ОДНОЙ наладкой.
//
// setup-only сегмент (0 проходов, «Только настройка станка», хвост дня #3635 п.5) намотки не
// несёт → и лидера (BETWEEN_CUTS) у него нет. Но computeCutSetupUpdates (#3698, пишет «Резка и
// Лидер») считал лидер как BETWEEN_CUTS × cutLeaderRuns(c), а cutLeaderRuns() при 0 проходов
// возвращает 1 (фолбэк для реальной резки с несохранённым «Кол-во план»). Итог: «Резка и Лидер»
// = 0 + 2 = 2 сохранялось у наладочного сегмента; scheduleFromStored читает это как durationMin,
// и бейдж дня = наладка 45 + фантомный лидер 2 = 47 вместо 45.
//
// Фикс: лидер учитываем ТОЛЬКО при реальных проходах (plannedRuns > 0) — и в computeCutSetupUpdates
// (хранимое «Резка и Лидер»), и в buildSchedule (leaderMin сегмента, гейт по setupTaskIds).
//
// Run with: node experiments/atex-production-planning-4021.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh' };
var mod = require('../download/atex/js/production-planning.js');
var planning = mod.planning;
var Controller = mod.Controller;

var passed = 0, failed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) { passed++; } else { failed++; process.exitCode = 1; }
}
function eq(a, b, name) { assert(a === b, name + ' (' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ')'); }

// ---------------------------------------------------------------------------
// Часть 1 — computeCutSetupUpdates: «Резка и Лидер» наладочного сегмента = 0, не 2.
console.log('\n== #4021: «Резка и Лидер» setup-only = 0 (не фантомный лидер 2) ==');
var meta = { id: '1078', reqs: [
    { id: '96067', val: 'Наладка ножей, мин' },
    { id: '96069', val: 'Сырье/намотка, мин' },
    { id: '96778', val: 'Резка и Лидер' }
] };
function cut(id, plannedRuns, duration) {
    return { id: id, slitter: { id: 'S1' }, plannedRuns: plannedRuns, duration: duration,
             materialId: 'M' + id, winding: 'OUT', batchId: '1', knifeWidths: [], knifeCount: 0,
             storedKnifeSetupMin: '', storedMaterialWindingMin: '', storedCutAndLeaderMin: '' };
}
var fake = {
    meta: { cut: meta },
    changeTimes: { BETWEEN_CUTS: 2, KNIFE: 30, MATERIAL_WINDING: 15 },
    // setup-only задание (наладка, 0 проходов, «Длительность» 0) + обычная резка (5 проходов, 10 мин намотки)
    cuts: [ cut('SETUP', 0, 0), cut('REAL', 5, 10) ],
    filter: { date: '' },
    planningPrevSetupBySlitter: function() { return {}; }   // нет реальной заправки станка
};
var res = Controller.prototype.computeCutSetupUpdates.call(fake);
var byId = {};
res.updates.forEach(function(u) { byId[u.cutId] = u; });
assert(byId['SETUP'] != null, 'наладочный сегмент попал в updates');
eq(byId['SETUP'] && byId['SETUP'].cutTime, 0, 'SETUP: «Резка и Лидер» = 0 (0 проходов → без лидера)');
// Обычная резка: «Резка и Лидер» = намотка 10 + лидер 2×5 = 20 (лидер сохранён при реальных проходах).
eq(byId['REAL'] && byId['REAL'].cutTime, 20, 'REAL: «Резка и Лидер» = 10 + 2×5 = 20 (лидер при проходах сохранён)');

// ---------------------------------------------------------------------------
// Часть 2 — buildSchedule: leaderMin наладочного сегмента = 0 → окно/бейдж не раздуваются.
console.log('\n== #4021: buildSchedule — setup-only leaderMin = 0 ==');
var times = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
var wind = [{ m: 200, min: 1 }];
var sched = planning.buildSchedule(
    [ { id: 'A', plannedRuns: 50, materialId: 'M1', winding: 'OUT', batchId: '1' },
      { id: 'B', plannedRuns: 0,  materialId: 'M2', winding: 'OUT', batchId: '1' } ],
    { windPoints: wind, times: times, shiftStartMin: 480, shiftEndMin: 970,
      runLengthByCut: { A: 200, B: 200 }, setupTaskIds: { B: true } }
);
var segB = sched.filter(function(s) { return s.cutId === 'B'; })[0];
assert(segB != null, 'наладочный сегмент B есть в расписании');
eq(segB && segB.leaderMin, 0, 'B (setup-only): leaderMin = 0');
eq(segB && segB.durationMin, 0, 'B (setup-only): durationMin = 0');
var badgeB = (Number(segB.setupMin) || 0) + (Number(segB.durationMin) || 0) + (Number(segB.leaderMin) || 0);
eq(badgeB, 15, 'вклад B в бейдж дня = только наладка сырья 15 (без фантомного лидера)');

// ---------------------------------------------------------------------------
// Часть 3 (Q2) — «день недогружен, сделана только наладка»: setup-only хвост НЕ выталкивается
// потолком нахлёста за выходные (иначе оседает одинокой наладкой на понедельник).
//
// Реал (issue #4021): Станок 1, база Вт 23.06, выходные Сб/Вс (дни 4-5). Наладочный хвост
// резки MR314L стоял в конце пятницы (день 3, 16:03, нахлёст #3635 п.5). Предыдущая резка
// кончалась на минуту ПОЗЖЕ логического старта хвоста → встык-курсор нудживал хвост
// (cursorMoved=true) → потолок #3907/#3934 выталкивал его за конец смены, а перед выходными —
// за все выходные, на 08:00 понедельника (день 6) ОДИНОКОЙ наладкой; #3951 сдвигал весь
// дневной объём на вторник. Итог: день 6 «Пн 29.06» = 47 мин (одна наладка), день 7 = 427.
// Фикс: setup-only хвост (acc.overhangTail) освобождён от потолка — остаётся в пятнице;
// блоки простоя он по-прежнему обходит.
console.log('\n== #4021 (Q2): setup-only хвост не выталкивается за выходные ==');
function clk(m){ var d=Math.floor(m/1440), t=m-d*1440; return '+'+d+'д '+String(Math.floor(t/60)).padStart(2,'0')+':'+String(Math.round(t%60)).padStart(2,'0'); }
var weekend = [[4 * 1440, 6 * 1440]];   // Сб(4)+Вс(5) целиком (как calendarBlockedRanges)
function shiftScenario(withOverhangGuard) {
    // Пятница (день 3): предыдущая резка C кончается 16:05 (курсор двигает хвост); наладочный
    // хвост Btail в 16:03; продолжение Bcont в субботу (день 4) 08:00.
    var items = [
        { id: 'C',     ws: 3 * 1440 + 931, len: 34, so: false },  // 15:31..16:05 (курсор двигает хвост)
        { id: 'Btail', ws: 3 * 1440 + 963, len: 15, so: true  },  // 16:03 наладочный хвост (setup-only)
        { id: 'Bcont', ws: 4 * 1440 + 480, len: 38, so: false }   // Сб 08:00 продолжение
    ];
    planning.shiftPlacementsPastDowntime(items, weekend, 480, 970, {
        windowStart: function(s){ return s.ws; }, length: function(s){ return s.len; },
        shift: function(s, d){ s.ws += d; },
        overhangTail: function(s){ return withOverhangGuard && !!s.so; }
    }, 975);   // fitEnd = 16:15
    var by = {}; items.forEach(function(s){ by[s.id] = Math.floor(s.ws / 1440); });
    return by;
}
var before = shiftScenario(false);   // без фикса — старое поведение (баг)
var after  = shiftScenario(true);    // с фиксом
// Демонстрация бага (до фикса): наладочный хвост уезжал на понедельник (день 6) один.
eq(before.Btail, 6, 'ДО фикса: setup-only хвост выталкивался на понедельник (день 6) — баг');
// С фиксом: хвост остаётся в пятнице (день 3), продолжение — на понедельник (день 6).
eq(after.Btail, 3, 'setup-only хвост ОСТАЁТСЯ в пятнице (день 3) — не выталкивается за выходные');
eq(after.Bcont, 6, 'продолжение (намотка) уезжает на понедельник (день 6) — как и должно');
assert(after.Btail !== after.Bcont, 'наладка и намотка на РАЗНЫХ днях — понедельник не занят одной наладкой');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
