// Tests for ideav/crm#3934 — «495/501 минута опять, настройка в начале дня».
//
// Причина (из журнала PP_TRACE): splitMachineQueue клал в ХВОСТ дня N сегмент НАСТРОЙКИ с
// нахлёстом за конец окна, а applyDowntime при наличии простоя станка выталкивал этот хвост на
// НАЧАЛО след. дня поверх его же продолжения — «настройка в начале дня» + рост минут (495/501).
//
// Итоговый фикс (#3939, супер­седит сдвиг-подход #3937): setup-only хвост кладётся, ТОЛЬКО если
// настройка ЦЕЛИКОМ влезает до конца окна (без нахлёста). В этом раскладе (атомарная настройка 30
// при остатке 5) хвост НЕ создаётся вовсе — вся резка уходит на день N+1 одной карточкой, поэтому
// «настройке в начале дня» просто нечему взяться (день не вылезает за ёмкость). Потолок нахлёста
// применяется только к реально СДВИНУТОМУ простоем сегменту (#3937) — это по-прежнему актуально для
// ПРОХОДОВ (они могут нахлёстывать, #3847) и проверяется напрямую через shiftPlacementsPastDowntime.
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
// A (p97×5=485) заполняет день0 до 16:05 (остаток ≈5); B — та же намотка/сырьё, ДРУГИЕ ножи →
// настройка 30 (атомарная), 1 проход 6 мин. Настройка 30 не влезает в остаток 5 → хвоста НЕТ,
// вся резка B на день1 (#3939).
function queue() { return [cut('A', 'M', [30], 5), cut('B', 'M', [40], 1)]; }
function opts(extra) {
    var o = Object.assign({}, BASE, { perPassByCut: { A: 97, B: 6 }, runsByCut: { A: 5, B: 1 } });
    for (var k in (extra || {})) o[k] = extra[k];
    return o;
}
function seg(segs, id, setupOnly) { return segs.filter(function (s) { return s.cutId === id && !!s.setupOnly === setupOnly; })[0]; }

// ── ГЛАВНОЕ: при НАЛИЧИИ простоя (далёкого) «настройки в начале дня» нет — хвоста нет вовсе ──────
(function () {
    var farBlock = [[3 * 1440 + 480, 3 * 1440 + 960]];   // день3 — как реальные «Отпуска», далеко
    var segs = planning.splitMachineQueue(queue(), opts({ blockedRanges: farBlock }));
    assert(!segs.some(function (s) { return s.setupOnly; }),
        '#3934/#3939: setup-only хвоста нет (настройка 30 не влезла в остаток 5) → нечему уезжать на начало дня1');
    assertEqual(seg(segs, 'B', false) && seg(segs, 'B', false).windowStartMin, DAY1_START,
        '#3934/#3939: вся резка B — одной карточкой на 08:00 дня1 (без отдельной настройки перед ней)');
})();

// ── Тот же расклад БЕЗ простоя — так же нет хвоста, вся резка на день1 ───────────────────────────
(function () {
    var segs = planning.splitMachineQueue(queue(), opts({}));
    assert(!segs.some(function (s) { return s.setupOnly; }), '#3934/#3939: без простоя — хвоста настройки тоже нет');
    assertEqual(seg(segs, 'B', false) && seg(segs, 'B', false).windowStartMin, DAY1_START, '#3934/#3939: без простоя — B на дне1 08:00');
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
