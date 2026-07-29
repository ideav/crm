// #4461 — «задание влезло, разорвав последовательность»: 🔒 на своём дне вставало ПЕРВЫМ.
//
// БОЕВОЙ СНИМОК (ateh1, Станок 2, 29.07.2026 — 459 мин):
//   № 1  08:00–09:14  74 мин   647845  MWR200 OUT  ножи 110×2+55×12 (14 полос)   [продолжение 646473 с 28.07]
//   № 2  09:14–11:39 135 мин   647159  MW308  IN   ножи 150×5+59×2  (7 полос)    🔒 «Зафиксировано»
//   № 3  11:39–14:41 142 мин   646483  MW308  OUT  ножи 110×2+55×12 (14 полос)
//   № 4/5            52/26 мин 646890/646822 MR194 OUT ножи 30×29
// 647845 и 646483 — ОДИН набор ножей: рядом они стоят 0 мин наладки. 🔒 между ними = две смены
// ножей с нуля: 150 мин переналадки дня вместо 120.
//
// ПРИЧИНА. Слой размещения (§8) ставит 🔒 ПОСЛЕ 646483 — цена точки 47 против 179 в боевой
// (в 179 входит штраф разрыва breakKnives 50, #4454). Этот порядок выбрасывал упаковщик:
// правило #3792 брало 🔒 своего дня РАНЬШЕ свободных, как только нет незавершённого продолжения
// (`!inProgress.length` в splitMachineQueue). Правило защищало ЁМКОСТЬ (чтобы нахлёст свободных
// не вытеснил 🔒 с её дня), но диктовало и ПОЗИЦИЮ — голову дня.
//
// ФИКС: 🔒 выбирается НАРАВНЕ со свободными (тот же selectByConfig: при авторитетном порядке —
// индекс §8), а гарантия ёмкости остаётся: свободную пропускаем вперёд, лишь пока после неё 🔒
// ещё влезает в день (наладка + проход). Не влезает / день исчерпан / forceFixedDay — 🔒 берём
// сейчас, как раньше.
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
function cut(id, mat, win, batch, knives, roller, work, fixed) {
    return { id: id, materialId: mat, winding: win, batchId: batch, knifeWidths: knives,
             knifeCount: knives.length, rollerWidth: roller, isFoil: false, plannedRuns: 1,
             fixed: !!fixed, _work: work };
}
// Боевой день в ПОРЯДКЕ СЛОЯ РАЗМЕЩЕНИЯ (проверен scorePosition: 🔒 ставится после 646483).
function day29() {
    return [
        cut('647845', '1241', 'OUT', '74922', K([[110, 2], [55, 12]]), 110, 74),
        cut('646483', '1253', 'OUT', '74929', K([[110, 2], [55, 12]]), 110, 97),
        cut('647159', '1253', 'IN',  '74929', K([[150, 5], [59, 2]]),  150, 90, true),
        cut('646890', '2086', 'OUT', '74926', K([[30, 29]]),            30,  7),
        cut('646822', '2086', 'OUT', '74926', K([[30, 29]]),            30, 26)
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

// ── 1. Порядок слоя размещения (§8) упаковщик не выбрасывает ─────────────────────────────
(function () {
    var cuts = day29();
    var got = order(pack(cuts));
    assert(got.join(' → ') === '647845 → 646483 → 647159 → 646890 → 646822',
        '🔒 не выпрыгивает в голову дня — порядок §8 сохранён', '(' + got.join(' → ') + ')');
    assert(got.indexOf('647159') > got.indexOf('646483'),
        '🔒 647159 стои́т ПОСЛЕ 646483 (блок 110/55 не разорван)', '(' + got.join(' → ') + ')');
})();

// ── 2. Цена разрыва: день 135 → 105 мин переналадки ──────────────────────────────────────
// #4481: числа на 15 мин меньше прежних (150 → 135 и 120 → 105) — смена ПАРТИИ перестала
// считаться сменой сырья. Разница между порядками та же: 30 мин на смене ножей.
(function () {
    var cuts = day29();
    var wedged = ['647845', '647159', '646483', '646890', '646822'];   // как было на боевой
    var got = order(pack(cuts));
    assert(changeover(cuts, wedged) === 135, 'боевой порядок стои́т 135 мин переналадки',
        '(' + changeover(cuts, wedged) + ')');
    assert(changeover(cuts, got) === 105, 'порядок §8 стои́т 105 мин — на смену ножей меньше',
        '(' + changeover(cuts, got) + ')');
    assert(changeover(cuts, wedged) - changeover(cuts, got) === 30,
        'выигрыш порядка §8 прежний — 30 мин', '(' + (changeover(cuts, wedged) - changeover(cuts, got)) + ')');
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
    assert(day1.indexOf('647159') > day1.indexOf('646483'),
        'после продолжения идёт 646483 (те же ножи), 🔒 — за ним', '(' + day1.join(' → ') + ')');
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

// ── 5. При равной переналадке решает ПОРЯДОК §8, а не преимущество 🔒 (#4487) ─────────────
// С заправки (MWR200 110/55) и свободная MR194 30×29, и 🔒 MW308 IN 150/59 стоят одинаково
// (смена ножей + смена сырья). Прежде ничья доставалась 🔒 — она вставала первой ВСЕГДА. Но
// попарное сравнение заправки не видит, что дальше в дне стои́т близнец 🔒 по ножам: именно так
// перенесённое «По весу» задание отрывалось от своего блока (issue #4487). Порядок §8 уже сравнил
// все штрафы — при авторитетном порядке идём по нему, в обе стороны.
(function () {
    var free = cut('free', '2086', 'OUT', '74926', K([[30, 29]]), 30, 40);
    var fixed = cut('lock', '1253', 'IN', '74929', K([[150, 5], [59, 2]]), 150, 40, true);
    var lockFirst = order(pack([fixed, free]));
    assert(lockFirst.join(' → ') === 'lock → free', '§8 поставил 🔒 раньше — упаковщик это сохраняет',
        '(' + lockFirst.join(' → ') + ')');
    var got = order(pack([free, fixed]));
    assert(got.join(' → ') === 'free → lock', '§8 поставил свободную раньше — 🔒 её не обгоняет (#4487)',
        '(' + got.join(' → ') + ')');
})();

// ── 6. Контроль: без 🔒 порядок дня не меняется ──────────────────────────────────────────
(function () {
    var free = day29().map(function (c) { return Object.assign({}, c, { fixed: false }); });
    var got = order(pack(free));
    assert(got.join(' → ') === '647845 → 646483 → 647159 → 646890 → 646822',
        'без 🔒 порядок §8 сохраняется (регресс-контроль)', '(' + got.join(' → ') + ')');
})();

console.log('\n' + passed + '/' + total + ' passed');
