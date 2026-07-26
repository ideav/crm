// Tests for ideav/crm#4421 — «Откуда дробные тайминги 3.238 и 3.211?».
//
// РЕПРО (обе цифры из issue воспроизводятся точно): норма намотки WIND_300=1.2, лидер
// BETWEEN_CUTS=2, но модалка печатала «Намотка и лидер: 3.211 мин» и «Итого резка:
// 3.211 * 57 = 183.027 мин» при окне 183 мин. Причина — не норма:
//   • у СОХРАНЁННОГО расписания (#3862) лидер отдельно не хранится, поэтому модалка брала его
//     как ОСТАТОК окна после намотки по норме: 183 − 68.4 = 114.6 (норма 2 × 57 = 114);
//   • в остатке сидело округление «Длительности, минут» ВВЕРХ до целой минуты (#3916: 68.4 → 69);
//   • остаток делился на проходы (114.6 / 57 = 2.0105…) и складывался с намоткой → 3.211.
// То есть дробь была ЧУЖАЯ (округление намотки), приписанная лидеру и размазанная по проходам,
// а «Итого» (183.027) не сходилось с окном (183) и со строкой «готово».
//
// ЛЕЧЕНИЕ (#4421): намотка и лидер — разными строками, с явным «в плане N мин (округление)»;
// итог = намотка + лидер и сходится с окном. Норма лидера печатается, только если сходится
// с показанной суммой (иначе «2 * 23 = 47» врало бы в арифметике).
//
// Run with: node experiments/atex-4421-timing-fractions.test.js

process.env.TZ = 'UTC';

global.document = {
    createElement: function() { return {}; }, createTextNode: function() { return {}; },
    body: {}, readyState: 'complete', getElementById: function() { return null; }, addEventListener: function() {}
};

var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

var TIMES = { WIND_300: 1.2, BETWEEN_CUTS: 2 };
var POINTS = planning.windingPointsFromTimes(TIMES);

// Сохранённое расписание (#3862): лидер отдельно НЕ хранится (sc.leaderMin == null),
// окно = finish − start и включает его.
function storedCtx(runs, startMin, windowMin, storedDuration) {
    var cut = { id: 'c' + runs, plannedRuns: runs, materialName: 'MW308', winding: 'OUT',
        duration: storedDuration, knifeWidths: [90], knifeCount: 1 };
    var sc = { cutId: cut.id, startMin: startMin, finishMin: startMin + windowMin, setupMin: 0, leaderMin: null };
    return planning.buildCutTimingCtx(cut, null, sc, 300, POINTS, TIMES, { firstCutSetup: true });
}
function texts(ctx) { return planning.cutTimingTimelineLines(ctx).map(function(l) { return l.text; }); }
function lineStarting(lines, prefix) {
    return lines.filter(function(t) { return t.indexOf(prefix) === 0; })[0] || '';
}

// ── 1) Первый скриншот issue: 57 проходов, окно 183 мин (08:00–11:03) ───────
(function () {
    var ctx = storedCtx(57, 8 * 60, 183, 69);   // 69 = ceil(1.2 × 57) — то, что хранит план
    assertEqual([ctx.oneRun, ctx.total, ctx.leaderMin, ctx.leaderInWindow, ctx.plannedWindMin, ctx.leaderUnit, ctx.leaderRuns],
        [1.2, 68.4, 114.6, true, 69, 2, 57],
        'ctx: намотка по норме 68.4, «остаток окна» под лидер 114.6 (норма 2 × 57 = 114) — вот откуда дробь');

    var lines = texts(ctx);
    assertEqual(lineStarting(lines, 'Намотка:'), 'Намотка: 1.2 * 57 = 68.4 мин → в плане 69 мин (округление до целой минуты)',
        'намотка своей строкой: по норме и сколько её ДЕРЖИТ план (округление названо явно)');
    assertEqual(lineStarting(lines, 'Лидер:'), 'Лидер: 2 * 57 = 114 мин (заправка после каждой резки цуга)',
        'лидер своей строкой — ровный, по норме (в дроби он не виноват)');
    assert(lines.filter(function(t) { return /Намотка и лидер/.test(t); }).length === 0,
        'слитой строки «Намотка и лидер: 3.211 мин» больше нет');
    assert(lines.filter(function(t) { return /3\.211|183\.027/.test(t); }).length === 0,
        'дробных 3.211 и 183.027 в модалке больше нет');
    assertEqual(lineStarting(lines, '08:00 · Итого резка'), '08:00 · Итого резка: 69 + 114 = 183 мин',
        'итог = намотка + лидер и СХОДИТСЯ с окном 183 мин');
    assert(lines.indexOf('11:03 · готово') >= 0, '«готово» по-прежнему в конце окна (11:03 = 08:00 + 183)');
})();

// ── 2) Второй скриншот issue: 21 проход, окно 68 мин (10:57–12:05) ──────────
(function () {
    var ctx = storedCtx(21, 10 * 60 + 57, 68, 26);   // 26 = ceil(1.2 × 21)
    var lines = texts(ctx);
    assertEqual(lineStarting(lines, 'Намотка:'), 'Намотка: 1.2 * 21 = 25.2 мин → в плане 26 мин (округление до целой минуты)',
        'второй случай: та же норма, округление 25.2 → 26');
    assertEqual(lineStarting(lines, 'Лидер:'), 'Лидер: 2 * 21 = 42 мин (заправка после каждой резки цуга)',
        'второй случай: лидер 2 × 21 = 42');
    assert(lines.filter(function(t) { return /3\.238|67\.998/.test(t); }).length === 0,
        'дробных 3.238 и 67.998 в модалке больше нет');
    assertEqual(lineStarting(lines, '10:57 · Итого резка'), '10:57 · Итого резка: 26 + 42 = 68 мин',
        'итог сходится с окном 68 мин');
})();

// ── 3) Окно шире суммы (правили колонки руками / старый расчёт) — говорим прямо ──
(function () {
    var lines = texts(storedCtx(21, 10 * 60 + 57, 70, 26));
    assert(/сохранённое окно 70 мин, расхождение 2 мин/.test(lineStarting(lines, '10:57 · Итого резка')),
        'расхождение с сохранённым окном не прячем — печатаем в той же строке');
})();

// ── 4) Live-расписание (лидер известен отдельно) — норму не выдумываем ──────
(function () {
    // sc.leaderMin задан (47) и не равен базе × резок (2 × 23 = 46): печатаем сумму без «2 * 23 =».
    var cut = { id: 'tail', plannedRuns: 23, winding: 'OUT', duration: 58.259 };
    var sc = { cutId: 'tail', startMin: 8 * 60 + 15, finishMin: 8 * 60 + 15 + 58.259, setupMin: 0, leaderMin: 47 };
    var pts = planning.windingPointsFromTimes({ WIND_500: 2.533, BETWEEN_CUTS: 2 });
    var ctx = planning.buildCutTimingCtx(cut, null, sc, 500, pts, { WIND_500: 2.533, BETWEEN_CUTS: 2 }, { firstCutSetup: true });
    var lines = texts(ctx);
    assertEqual(lineStarting(lines, 'Лидер:'), 'Лидер: 47 мин (заправка после каждой резки цуга)',
        'лидер из расписания: печатаем сумму, а не враньё «2 * 23 = 47»');
    assertEqual(lineStarting(lines, 'Намотка:'), 'Намотка: 2.533 * 23 = 58.259 мин',
        'live-расписание: намотка по норме, приписки «в плане» нет (окно её и держит)');
    assert(/Итого резка: 58\.259 \+ 47 = 105\.259/.test(lineStarting(lines, '08:15 · Итого резка')),
        'итог = намотка + лидер');
})();

// ── 5) Текст тайминга на записи (cutTimingDetails) — тот же разбор ──────────
(function () {
    var details = planning.cutTimingDetails(300, 57, TIMES, false);
    assert(/Намотка: 1\.2 \* 57 = 68\.4 мин/.test(details), 'запись: намотка своей строкой');
    assert(/Лидер: 2 \* 57 = 114 мин/.test(details), 'запись: лидер своей строкой');
    assert(/Итого резка: 68\.4 \+ 114 = 182\.4 мин/.test(details), 'запись: итог = намотка + лидер');
    assert(!/Намотка и лидер/.test(details), 'запись: слитой строки больше нет');
})();

// ── 6) Сегмент настройки (0 проходов) — как был, без строк намотки/лидера ───
(function () {
    var ctx = storedCtx(0, 16 * 60 + 34, 45, 0);
    var lines = texts(ctx);
    assert(lines.filter(function(t) { return /^Намотка:|^Лидер:/.test(t); }).length === 0,
        'настройка (0 проходов): строк намотки и лидера нет (#3889 не тронут)');
    assert(lines.filter(function(t) { return /Только настройка станка/.test(t); }).length === 1,
        'настройка: сообщение про перенос намотки на следующий день на месте');
})();

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
