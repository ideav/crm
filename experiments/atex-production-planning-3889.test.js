// Unit tests — #3889: модалка тайминга для задания-«настройки» (последняя резка смены,
// не успевшая начаться) и тег продолжения по дням.
//
// Симптом (#3889): у последней резки дня, которую планировщик дробит на «настройку в хвосте
// дня N» (0 проходов) + «намотку с дня N+1», модалка печатала бессмысленное
// «Итого резка: 2.533 * 0 = 2.533 мин» и не объясняла, что задание продолжится. Заказчик:
// «Куда делась намотка? … почему не вижу, что резка продолжится в следующем дне?».
//
// Фикс: для сегмента-«настройки» (0 проходов, ctx.setupOnly) модалка НЕ показывает
// «Намотка 1 прохода» / «Итого резка X*0», а пишет «Только настройка станка — намотка
// начнётся в следующем рабочем дне» + тег продолжения. Для продолжения предыдущего дня
// (ctx.continuesFromPrevDay) — тег «↩ Продолжение резки предыдущего рабочего дня».
//
// Сценарий = скриншот issue #3889: метраж прохода 500 м, нормы намотки WIND_450=1.8,
// WIND_600=4 → намотка 1 прохода = 2.533 мин; голова — 0 проходов, продолжение — 23 прохода.
//
// Run with: node experiments/atex-production-planning-3889.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function ok(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function texts(lines) { return lines.map(function (l) { return l.text; }); }
function has(arr, sub) { return arr.some(function (t) { return t.indexOf(sub) !== -1; }); }

// Нормы намотки как на скриншоте: WIND_450=1.8, WIND_600=4 → для 500 м интерполяция = 2.533 мин.
var POINTS = [{ m: 450, min: 1.8 }, { m: 600, min: 4 }];
var base = Date.UTC(2026, 5, 29);          // полночь дня, мс
var ts = base / 1000 + 8 * 3600;           // 08:00, сек (авто-номер резки)

// ── Голова цепочки: сегмент НАСТРОЙКИ (0 проходов), хвост дня N ──
var headCut = {
    id: 'head', plannedRuns: 0, isFoil: false,
    knifeWidths: [30, 30, 30], knifeCount: 3,
    planDate: String(ts), number: String(ts)
};
// sc настройки: окно 16:34, длительность 0 (намотки нет), startMin == finishMin.
var scHead = { cutId: 'head', startMin: 16 * 60 + 34, finishMin: 16 * 60 + 34, setupMin: 45, durationMin: 0, leaderMin: 0 };
var ctxHead = planning.buildCutTimingCtx(headCut, null, scHead, 500, POINTS, {}, { firstCutSetup: true });

ok(ctxHead.setupOnly === true, 'настройка: ctx.setupOnly = true (0 проходов)');
ok(ctxHead.runs === 0, 'настройка: ctx.runs = 0');
ok(ctxHead.total === 0, 'настройка: ctx.total = 0 (намотки в этот день нет, не oneRun)');

var linesHead = texts(planning.cutTimingTimelineLines(ctxHead));
ok(!has(linesHead, 'Намотка 1 прохода'), 'настройка: НЕТ строки «Намотка 1 прохода»');
ok(!has(linesHead, 'Итого резка'), 'настройка: НЕТ строки «Итого резка»');
ok(!has(linesHead, '* 0 ='), 'настройка: НЕТ бессмысленного «… * 0 = …»');
ok(has(linesHead, '16:34 · Только настройка станка'), 'настройка: «Только настройка станка — намотка начнётся в следующем рабочем дне»');
ok(has(linesHead, '16:34 · готово (настройка)'), 'настройка: «готово (настройка)» в конце окна настройки');
ok(has(linesHead, 'продолжение в следующем рабочем дне'), 'настройка: тег продолжения резки в следующем дне');
ok(has(linesHead, 'Плановых проходов: 0'), 'настройка: «Плановых проходов: 0» сохраняется');

// ── Продолжение (день N+1): обычная резка с проходами, намотка считается ──
var tailCut = {
    id: 'tail', plannedRuns: 23, isFoil: false,
    knifeWidths: [30, 30, 30], knifeCount: 3,
    planDate: String(ts + 86400), number: String(ts + 86400), winding: 'OUT'
};
var scTail = { cutId: 'tail', startMin: 8 * 60 + 15, finishMin: 8 * 60 + 15 + 58.259, setupMin: 15, durationMin: 58.259, leaderMin: 47 };
var ctxTail = planning.buildCutTimingCtx(tailCut, null, scTail, 500, POINTS, {}, { firstCutSetup: true });

ok(ctxTail.setupOnly === false, 'продолжение: ctx.setupOnly = false (есть проходы)');
var linesTail = texts(planning.cutTimingTimelineLines(ctxTail));
ok(has(linesTail, 'Намотка и лидер: 4.576'), 'продолжение: «Намотка и лидер: 4.576 мин» (#4006: намотка 2.533 + лидер 47/23)');
ok(has(linesTail, 'Итого резка: 4.576 * 23 = 105.248'), 'продолжение: «Итого резка: 4.576 * 23 = 105.248» (#4006: лидер включён в итог)');
ok(!has(linesTail, 'Только настройка станка'), 'продолжение: НЕТ строки настройки');
ok(!has(linesTail, 'Продолжение резки предыдущего'), 'продолжение: без флага — тега «вчера» нет');

// ── Тот же tail, но помечен как продолжение предыдущего дня (renderQueue: spans.fromPrev) ──
ctxTail.continuesFromPrevDay = true;
var linesCont = texts(planning.cutTimingTimelineLines(ctxTail));
ok(has(linesCont, '↩ Продолжение резки предыдущего рабочего дня (ножи на станке).'), 'продолжение+флаг: тег «↩ предыдущего рабочего дня»');
ok(has(linesCont, 'Итого резка: 4.576 * 23 = 105.248'), 'продолжение+флаг: намотка по-прежнему считается (#4006: с лидером)');

// ── Обычная резка с проходами, остаток которых уходит на след. день (дробление по проходам) ──
ctxTail.continuesFromPrevDay = false;
ctxTail.continuesNextDay = true;
var linesNext = texts(planning.cutTimingTimelineLines(ctxTail));
ok(has(linesNext, '↪ Остаток проходов — продолжение в следующем рабочем дне.'),
    'продолжение вперёд: тег «↪ остаток проходов в следующем дне»');
ok(has(linesNext, 'Итого резка: 4.576 * 23 = 105.248'), 'продолжение вперёд: намотка считается (#4006: с лидером)');

// ── Прямой ctx без buildCutTimingCtx: setupOnly выводится и из runs=0 ──
var bare = planning.cutTimingTimelineLines({
    length: 500, runs: 0, oneRun: 2.533, total: 0,
    setupParts: [{ label: 'смена ножей / сужение ролика', minutes: 30 }],
    startMin: 994, finishMin: 994
});
var bareTexts = texts(bare);
ok(!has(bareTexts, 'Итого резка'), 'прямой ctx runs=0: «Итого резка» не печатается даже без флага setupOnly');
ok(has(bareTexts, 'Только настройка станка'), 'прямой ctx runs=0: распознан как настройка');

console.log('\n' + passed + ' passed');
