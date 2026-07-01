// Tests for ideav/crm#3934 — «495/501 минута опять, настройка в начале дня».
//
// Причина (из журнала PP_TRACE): splitMachineQueue кладёт в ХВОСТ дня N сегмент НАСТРОЙКИ с
// намеренным нахлёстом (#3635 п.5/#3739/#3805: «настройка в хвосте дня N, резка с дня N+1»).
// Но applyDowntime, когда у станка ЕСТЬ хоть один блок простоя («Отпуск» — в реальном плане их
// 53, все далеко), прогонял ВСЕ сегменты через nextFreeWorkMinute, а тот применял потолок нахлёста
// (fitEnd = cutEnd+MAX_OVERWORK_CUTS) к КАЖДОМУ сегменту — даже не тронутому простоем. Хвостовая
// настройка кончается за потолком → её выталкивало на НАЧАЛО след. дня ПОВЕРХ её же продолжения:
// «настройка в начале дня» + минуты росли (бейдж 495/501). Без простоя (shiftPlacementsPastDowntime
// выходит сразу) того же не было — отсюда «то есть, то нет».
//
// Фикс #3934: nextFreeWorkMinute применяет потолок нахлёста (#3907) ТОЛЬКО к сегменту, реально
// СДВИНУТОМУ простоем (блоком или встык-курсором). Не тронутый простоем хвост остаётся в конце дня N.
//
// Run with: node experiments/atex-production-planning-3934.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++;
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0, CLEANUP_SHIFT: 30 };
// Окно 08:00(480)…cutEnd 16:10(970); DAY_END_HOUR 16:30(990); нахлёст резки 5, настройки 10.
var BASE = { dayStartMin: 480, dayEndMin: 970, dayEndHourMin: 990, maxOverworkCutsMin: 5, maxOverworkTuneMin: 10,
    leader: 0, times: TIMES, gapFill: true };
var DAY1_START = 1440 + 480;   // 08:00 следующего дня = 1920
function cut(id, mat, knives, runs) {
    return { id: id, materialId: mat, winding: 'IN', batchId: 'b',
        knifeCount: (knives || [30]).length, knifeWidths: (knives || [30]), isFoil: false, plannedRuns: runs };
}
// A (p97×5=485) заполняет день0 до 16:05; B — та же намотка/сырьё, ДРУГИЕ ножи → настройка 30
// (атомарная), 1 проход 6 мин; проход не влезает → хвост настройки в конец дня0, проход — день1.
function queue() { return [cut('A', 'M', [30], 5), cut('B', 'M', [40], 1)]; }
function opts(extra) {
    var o = Object.assign({}, BASE, { perPassByCut: { A: 97, B: 6 }, runsByCut: { A: 5, B: 1 } });
    for (var k in (extra || {})) o[k] = extra[k];
    return o;
}
function seg(segs, id, setupOnly) { return segs.filter(function (s) { return s.cutId === id && !!s.setupOnly === setupOnly; })[0]; }

// ── ГЛАВНОЕ: при НАЛИЧИИ простоя (далёкого) хвост настройки НЕ уезжает на начало след. дня ──────
(function () {
    var farBlock = [[3 * 1440 + 480, 3 * 1440 + 960]];   // день3 — как реальные «Отпуска», далеко
    var segs = planning.splitMachineQueue(queue(), opts({ blockedRanges: farBlock }));
    var bSetup = seg(segs, 'B', true), bCut = seg(segs, 'B', false);
    assert(bSetup && bSetup.windowStartMin < 1440,
        '#3934: хвост настройки B остаётся в ДНЕ0 (ws<1440), не сдвинут на начало дня1');
    assert(bSetup && bSetup.windowStartMin !== DAY1_START,
        '#3934: хвост настройки B НЕ на 08:00 дня1 (не «настройка в начале дня»)');
    assertEqual(bCut && bCut.windowStartMin, DAY1_START,
        '#3934: проход B — на 08:00 дня1 (одна карточка резки в начале дня, без отдельной настройки перед ней)');
})();

// ── Тот же расклад БЕЗ простоя — поведение не изменилось (хвост в конце дня0) ───────────────────
(function () {
    var segs = planning.splitMachineQueue(queue(), opts({}));
    var bSetup = seg(segs, 'B', true), bCut = seg(segs, 'B', false);
    assert(bSetup && bSetup.windowStartMin < 1440, '#3934: без простоя — хвост настройки тоже в дне0 (как и было)');
    assertEqual(bCut && bCut.windowStartMin, DAY1_START, '#3934: без простоя — проход B на дне1 08:00');
})();

// ── #3907 сохранён: сегмент, РЕАЛЬНО сдвинутый простоем за конец окна, уезжает на следующий день ──
// Блок закрывает почти весь день0 (с 09:00), длинную резку сдвигает на старт 09:00, конец за
// потолком → на день1. Проверяем через shiftPlacementsPastDowntime напрямую.
(function () {
    var items = [{ ws: 480, len: 460 }];   // старт 08:00, длина 460 (влезает в окно 495, но не после сдвига)
    var block = [[480, 540]];              // 08:00..09:00 блок → сдвиг старта на 09:00 (конец 16:40 > потолок 16:15)
    planning.shiftPlacementsPastDowntime(items, block, 480, 970, {
        windowStart: function (s) { return s.ws; },
        length: function (s) { return s.len; },
        shift: function (s, d) { s.ws += d; }
    }, 975);
    assert(items[0].ws >= 1440, '#3907: сегмент, сдвинутый простоем и вылезающий за смену, уезжает на следующий день');
})();

console.log('\n' + passed + ' assertions passed');
