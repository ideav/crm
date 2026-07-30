// #4461 — МЕСТО 🔒 В ЕЁ ДНЕ И ГАРАНТИЯ ЁМКОСТИ (#3792), с правилом #4497.
//
// БОЕВОЙ СНИМОК (ateh1, Станок 2, 29.07.2026), он же ХРАНИМЫЙ план дня:
//   № 1  08:00–09:14  74 мин   647845  MWR200 OUT  ножи 110×2+55×12 (14 полос)   [продолжение 646473 с 28.07]
//   № 2  09:14–11:39 135 мин   647159  MW308  IN   ножи 150×5+59×2  (7 полос)    🔒 «Зафиксировано»
//   № 3  11:39–14:41 142 мин   646483  MW308  OUT  ножи 110×2+55×12 (14 полос)
//   № 4/5            52/26 мин 646890/646822 MR194 OUT ножи 30×29
//
// ПРАВИЛО (ТЗ §15, #4497, решение заказчика 29.07.2026): перед 🔒 автоматика ничего не ставит —
// замок держит и МЕСТО в дне. 647845 стоял ПЕРЕД 🔒 в хранимом плане, поэтому остаётся впереди;
// 646483 стоял ПОСЛЕ неё и перед неё не переносится, хотя у него те же ножи, что у 647845, и
// группировка сэкономила бы 30 мин переналадки: группировка — штраф §8.2, замок оператора жёстче.
//
// ГАРАНТИЯ ЁМКОСТИ #3792 при этом отдельная и целая: нахлёст свободных не вытесняет 🔒 с её дня
// (`fixedRoomAfter` — после свободной каждая 🔒 дня ещё начинается в пределах ёмкости).
//
// Run with: node experiments/atex-pp-4461-fixed-day-position.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 };
function K(pairs) { var a = []; pairs.forEach(function (p) { for (var i = 0; i < p[1]; i++) a.push(p[0]); }); return a; }
// ХРАНИМОЕ время старта («Дата план», сек) — им и задано место 🔒 в дне (#4497).
var D0 = Math.floor(new Date(2026, 6, 29, 0, 0, 0, 0).getTime() / 1000) + 8 * 3600;
function cut(id, mat, win, batch, knives, roller, work, fixed, storedMin) {
    return { id: id, materialId: mat, winding: win, batchId: batch, knifeWidths: knives,
             knifeCount: knives.length, rollerWidth: roller, isFoil: false, plannedRuns: 1,
             fixed: !!fixed, _work: work,
             planDate: storedMin != null ? String(D0 + storedMin * 60) : undefined };
}
// Боевой день в ПОРЯДКЕ СЛОЯ РАЗМЕЩЕНИЯ (проверен scorePosition: 🔒 ставится после 646483).
function day29() {
    return [
        cut('647845', '1241', 'OUT', '74922', K([[110, 2], [55, 12]]), 110, 74, false,   0),   // хранимо 08:00
        cut('646483', '1253', 'OUT', '74929', K([[110, 2], [55, 12]]), 110, 97, false, 219),   // хранимо 11:39
        cut('647159', '1253', 'IN',  '74929', K([[150, 5], [59, 2]]),  150, 90, true,    74),   // 🔒 хранимо 09:14
        cut('646890', '2086', 'OUT', '74926', K([[30, 29]]),            30,  7, false, 401),
        cut('646822', '2086', 'OUT', '74926', K([[30, 29]]),            30, 26, false, 408)
    ];
}
// Заправка станка на утро 29.07 — хвост 28.07 (тот же MWR200 110/55, что у 647845).
var CARRY = { materialId: '1241', winding: 'OUT', knifeWidths: K([[110, 2], [55, 12]]), rollerWidth: 110 };

function pack(cuts, opts) {
    var perPass = {}, runs = {}, anchor = {};
    cuts.forEach(function (c) {
        perPass[String(c.id)] = c._work; runs[String(c.id)] = 1;
        if (c.fixed) anchor[String(c.id)] = (c._anchor != null ? c._anchor : 0);
    });
    return P.splitMachineQueue(cuts, Object.assign({
        dayStartMin: 480, dayEndMin: 480 + 450, dayEndHourMin: 480 + 450,
        times: TIMES, perPassByCut: perPass, runsByCut: runs, dayAnchorByCut: anchor,
        carryPrevSetup: CARRY, gapFill: true, orderAuthoritative: true
    }, opts || {}));
}
function order(segs) {
    return segs.slice().sort(function (a, b) {
        return (a.dayOffset - b.dayOffset) || (a.windowStartMin - b.windowStartMin);
    }).filter(function (s) { return !s.setupOnly; }).map(function (s) { return String(s.cutId); });
}
function dayOf(segs, cutId) {
    var s = segs.filter(function (x) { return String(x.cutId) === String(cutId); })[0];
    return s ? s.dayOffset : null;
}
// Переналадка дня по фактическому порядку (changeoverCost, первая — от заправки станка).
function changeover(cuts, ids) {
    var by = {}; cuts.forEach(function (c) { by[String(c.id)] = c; });
    var t = 0, prev = CARRY;
    ids.forEach(function (id) { t += P.changeoverCost(prev, by[id], TIMES); prev = by[id]; });
    return t;
}

// ── 1. Место 🔒 в дне: кто стоял перед ней — впереди, кто после — за ней (#4497) ─────────
(function () {
    var cuts = day29();
    var got = order(pack(cuts));
    assert(got.join(' → ') === '647845 → 647159 → 646483 → 646890 → 646822',
        'хранимое место 🔒 сохранено: 647845 впереди (стоял перед ней), 646483 — за ней',
        '(' + got.join(' → ') + ')');
    assert(got.indexOf('647159') < got.indexOf('646483'),
        '#4497: 646483 не переносится ПЕРЕД 🔒 ради своего блока ножей', '(' + got.join(' → ') + ')');
    assert(got.indexOf('647845') < got.indexOf('647159'),
        '#4497: 647845, стоявший перед 🔒 в хранимом плане, остался впереди неё', '(' + got.join(' → ') + ')');
})();

// ── 2. ЦЕНА решения известна: 135 мин переналадки вместо 105 ──────────────────────────────
// Замок оператора стои́т 30 мин лишней наладки (лишняя смена ножей 110). Это осознанная цена
// правила #4497: жёсткое правило бьёт штраф §8.2. Числа с #4481 (смена ПАРТИИ наладкой не считается).
(function () {
    var cuts = day29();
    var got = order(pack(cuts));
    var grouped = ['647845', '646483', '647159', '646890', '646822'];   // если бы блок 110/55 склеили
    assert(changeover(cuts, got) === 135, 'день с замком стои́т 135 мин переналадки',
        '(' + changeover(cuts, got) + ')');
    assert(changeover(cuts, grouped) === 105, 'склеенный блок стоил бы 105 мин — на смену ножей меньше',
        '(' + changeover(cuts, grouped) + ')');
    assert(changeover(cuts, got) - changeover(cuts, grouped) === 30,
        'цена замка — 30 мин; правило про место 🔒 сильнее экономии наладки',
        '(' + (changeover(cuts, got) - changeover(cuts, grouped)) + ')');
})();

// ── 3. Как на экране: день открывает НЕЗАВЕРШЁННОЕ продолжение ───────────────────────────
// 646473 (35 проходов) не влезает в день 0 → остаток продолжается в дне 1, где стои́т 🔒.
(function () {
    var cont = cut('646473', '1241', 'OUT', '74922', K([[110, 2], [55, 12]]), 110, 12);
    cont.plannedRuns = 45;   // 540 мин работы — день 0 переполнен, остаток продолжается в дне 1
    var cuts = [cont].concat(day29().filter(function (c) { return c.id !== '647845'; }));
    cuts.forEach(function (c) { if (c.fixed) c._anchor = 1; });
    var perPass = {}, runs = {}, anchor = {};
    cuts.forEach(function (c) {
        perPass[String(c.id)] = c._work; runs[String(c.id)] = Number(c.plannedRuns) || 1;
        if (c.fixed) anchor[String(c.id)] = 1;
    });
    var segs = P.splitMachineQueue(cuts, {
        dayStartMin: 480, dayEndMin: 480 + 450, dayEndHourMin: 480 + 450,
        times: TIMES, perPassByCut: perPass, runsByCut: runs, dayAnchorByCut: anchor,
        carryPrevSetup: CARRY, gapFill: true, orderAuthoritative: true
    });
    var day1 = segs.filter(function (s) { return s.dayOffset === 1 && !s.setupOnly; })
        .sort(function (a, b) { return a.windowStartMin - b.windowStartMin; })
        .map(function (s) { return String(s.cutId); });
    assert(day1[0] === '646473', 'день открывает незавершённое продолжение (как на боевой)', '(' + day1.join(' → ') + ')');
    assert(day1.indexOf('647159') < day1.indexOf('646483'),
        '#4497: после продолжения идёт 🔒 — 646483 перед неё не переносится', '(' + day1.join(' → ') + ')');
})();

// ── 4. Гарантия #3792 жива: 🔒 не вытесняется с СВОЕГО дня ───────────────────────────────
// Ёмкость дня 200 мин: свободные (74 + 112) съели бы день, и 🔒 (135) не влезла бы → 🔒 берётся
// раньше свободных, её день сохраняется.
(function () {
    var cuts = day29();
    var segs = (function () {
        var perPass = {}, runs = {}, anchor = {};
        cuts.forEach(function (c) { perPass[String(c.id)] = c._work; runs[String(c.id)] = 1;
                                    if (c.fixed) anchor[String(c.id)] = 0; });
        return P.splitMachineQueue(cuts, {
            dayStartMin: 480, dayEndMin: 480 + 200, dayEndHourMin: 480 + 200,
            times: TIMES, perPassByCut: perPass, runsByCut: runs, dayAnchorByCut: anchor,
            carryPrevSetup: CARRY, gapFill: true, orderAuthoritative: true
        });
    })();
    assert(dayOf(segs, '647159') === 0, '🔒 осталась на своём дне 0 при тесной ёмкости',
        '(день ' + dayOf(segs, '647159') + ')');
    var day0 = segs.filter(function (s) { return s.dayOffset === 0 && !s.setupOnly; })
        .sort(function (a, b) { return a.windowStartMin - b.windowStartMin; })
        .map(function (s) { return String(s.cutId); });
    assert(day0.indexOf('647159') >= 0, '🔒 стои́т в дне 0', '(' + day0.join(' → ') + ')');
})();

// ── 5. Кто впереди 🔒 — решает ХРАНИМЫЙ план, а не порядок §8 (#4497) ─────────────────────
// С заправки (MWR200 110/55) и свободная MR194 30×29, и 🔒 MW308 IN 150/59 стоят одинаково
// (смена ножей + смена сырья) — ничья по наладке. Решает хранимое место: стоял перед 🔒 — идёшь
// впереди; стоял после (или хранимого места нет — новое задание) — за ней, как бы §8 ни упорядочил.
(function () {
    var fixed = cut('lock', '1253', 'IN', '74929', K([[150, 5], [59, 2]]), 150, 40, true, 60);
    var freeBefore = cut('free', '2086', 'OUT', '74926', K([[30, 29]]), 30, 40, false, 0);
    var freeAfter = cut('free', '2086', 'OUT', '74926', K([[30, 29]]), 30, 40, false, 120);
    var got = order(pack([freeBefore, fixed]));
    assert(got.join(' → ') === 'free → lock', 'стоявшее ПЕРЕД 🔒 остаётся впереди неё',
        '(' + got.join(' → ') + ')');
    var after = order(pack([freeAfter, fixed]));
    assert(after.join(' → ') === 'lock → free', 'стоявшее ПОСЛЕ 🔒 её не обгоняет, даже если §8 поставил раньше',
        '(' + after.join(' → ') + ')');
    var fresh = order(pack([cut('new', '2086', 'OUT', '74926', K([[30, 29]]), 30, 40), fixed]));
    assert(fresh.join(' → ') === 'lock → new', 'новое задание (без хранимого места) — только ПОСЛЕ 🔒',
        '(' + fresh.join(' → ') + ')');
})();

// ── 6. Контроль: без 🔒 порядок дня не меняется ──────────────────────────────────────────
(function () {
    var free = day29().map(function (c) { return Object.assign({}, c, { fixed: false }); });
    var got = order(pack(free));
    assert(got.join(' → ') === '647845 → 646483 → 647159 → 646890 → 646822',
        'без 🔒 порядок §8 сохраняется целиком — блок 110/55 склеен (регресс-контроль)',
        '(' + got.join(' → ') + ')');
})();

console.log('\n' + passed + '/' + total + ' passed');
