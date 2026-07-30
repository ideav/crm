// #4508 (ТЗ §15) — РУЧНОЙ ПЕРЕНОС «ПО ВЕСУ» ВПРАВЕ ВСТРОИТЬСЯ ВНУТРЬ 🔒-БЛОКА.
//
// СИМПТОМ (issue #4508, боевой лог, сборка ?118.93): задание `MWR113L 25×2` перенесли «по весу» —
// оно встало ПЕРВЫМ в дне вместо соседства со своим близнецом по ножам `MWR116L 25×2`. Трасса:
//     ── задание 652518 … рассмотрено вариантов 14 (+ 29 НЕДОПУСТИМЫХ пропущено) ──
//        ВЫБРАН: поз 0 → вес 125 (knife +95, material +30)
// День — стена 🔒 (фикс 34), близнец стои́т внутри неё, а точка между двумя 🔒 одного дня
// недопустима (#4464) — значит рядом с близнецом §8 встать не мог, остались только края блока.
//
// ПРАВИЛО (ТЗ §15, 🔒-монолит): «Исключение — ручной перенос: задание, которое оператор переносит
// „по весу“ прямо сейчас, вправе встроиться внутрь блока туда, где §8 насчитал минимальный штраф;
// последовательность ОСТАЛЬНЫХ звеньев при этом не меняется». Упаковщик это исключение соблюдает
// (#4491, `monolithNext` пропускает перенесённое), слой размещения — обязан тоже.
//
// Что проверяем:
//   A — слой размещения: точка внутри 🔒-блока допустима для задания ручного переноса и недопустима
//       для всех остальных (автоматика, приезжая 🔒);
//   B — выбор по весу: ручной перенос садится РЯДОМ с близнецом по ножам (смена ножей 0), а не в
//       голову дня (там смена ножей + смена сырья);
//   C — «Сгенерировать»/«Упорядочить»: чужое задание внутрь монолита не попадает (#4464 цел);
//   D — приезжая 🔒 внутрь блока не встраивается (#4491) — только перед ним или после;
//   E — порядок остальных звеньев монолита не меняется.
//
// Run with: node experiments/atex-pp-4508-manual-into-monolith.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var TIMES = { KNIFE: 30, KNIFE_MOVE: 2, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 };
var BASE = new Date(2026, 6, 30).getTime();
var TS0 = Math.floor(BASE / 1000) + 8 * 3600;   // 30.07.2026 08:00 — начало дня 0
function K(w, n) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }

// Слот дня: id, сырьё, ножи, 🔒?, хранимое время старта (мин от начала дня), работа.
function S(id, o) {
    o = o || {};
    var s = P.slotFromCut({ id: id, slitter: { id: '1' }, materialId: o.mat || 'M1', winding: 'IN',
        batchId: 'B1', knifeWidths: o.kw || K(40, 22), knifeCount: (o.kw || K(40, 22)).length,
        rollerWidth: 0, plannedRuns: 1, isFoil: false, fixed: !!o.fixed, workMin: o.wm || 40,
        planDate: String(TS0 + (o.ts || 0) * 60) });
    if (o.manual) s.manualMove = true;
    if (o.lockDay != null) { s.lockDay = o.lockDay; s.lockSlitter = '1'; }
    return s;
}
// Боевая стена дня: все 🔒, близнец по ножам (25×2, MWR116L) — ТРЕТЬИМ, внутри блока.
function wall() {
    return [
        S('L1', { fixed: true, mat: 'MR194',   kw: K(40, 22), ts: 0 }),
        S('L2', { fixed: true, mat: 'MW308',   kw: K(150, 7), ts: 60 }),
        S('TWIN', { fixed: true, mat: 'MWR116L', kw: K(25, 2), ts: 120 }),
        S('L3', { fixed: true, mat: 'MR194',   kw: K(60, 15), ts: 180 }),
        S('L4', { fixed: true, mat: 'MW308',   kw: K(110, 8), ts: 240 })
    ];
}
var CTX = { settings: {}, times: TIMES, capacityMin: 450, perPass: 0, baseMidnightMs: BASE, slitterId: '1' };
// Переносимое: те же ножи, что у близнеца (25×2), сырьё другое (MWR113L).
function moved(o) {
    o = o || {};
    var opt = { mat: 'MWR113L', kw: K(25, 2), wm: 10, ts: -60 };
    Object.keys(o).forEach(function (k) { opt[k] = o[k]; });
    return S('X', opt);
}

// ── A. Допустимость точки внутри 🔒-блока ─────────────────────────────────────────────────────
(function () {
    var arr = wall();
    // Точка 3 = сразу ПОСЛЕ близнеца (между TWIN и L3 — два 🔒 одного дня).
    assert(P.scorePosition(arr, 3, moved({ manual: true }), CTX) !== null,
        'A1 точка внутри 🔒-блока ДОПУСТИМА для задания ручного переноса (ТЗ §15)');
    assert(P.scorePosition(arr, 3, moved({ lockDay: 0 }), CTX) !== null,
        'A2 то же по признаку замка дня «по весу» (#4221)');
    assert(P.scorePosition(arr, 3, moved({}), CTX) === null,
        'A3 для автоматики точка внутри монолита по-прежнему НЕДОПУСТИМА (#4464)');
    assert(P.scorePosition(arr, 3, moved({ fixed: true }), CTX) === null,
        'A4 приезжая 🔒 внутрь блока не встраивается (#4491) — только перед ним или после');
})();

// ── B. Выбор по весу: рядом с близнецом дешевле, чем в голову дня ─────────────────────────────
(function () {
    var arr = wall();
    // Переход «близнец ↔ перенесённое» не стои́т смены ножей — только смены сырья (15):
    // именно это «приклеивание» и обязаны обеспечивать веса.
    var toTwin = P.changeoverCost(arr[2], moved({ manual: true }), TIMES);
    var toOther = P.changeoverCost(arr[0], moved({ manual: true }), TIMES);
    assert(toTwin === 15 && toOther > toTwin,
        'B1 переход к близнецу — только смена сырья (15), к чужой конфигурации дороже',
        '(к близнецу ' + toTwin + ', к L1 ' + toOther + ')');
    // Полный перебор: placeSlot выбирает именно соседство с близнецом, и оно ДЕШЕВЛЕ головы дня.
    var occ = P.seedOccupancy(wall(), [], ['1']);
    var best = P.placeSlot(occ, moved({ manual: true, lockDay: 0 }), CTX);
    var order = occ.byMachine['1'].map(function (s) { return String(s.id); });
    var iX = order.indexOf('X'), iT = order.indexOf('TWIN');
    var atHead = P.scorePosition(wall(), 0, moved({ manual: true }), CTX);
    assert(best && Math.abs(iX - iT) === 1,
        'B2 перебор всех точек: перенесённое встало ВПЛОТНУЮ к близнецу', '(' + order.join(' → ') + ')');
    assert(best && atHead && best.weight < atHead.weight,
        'B3 выбранное место дешевле головы дня — решили веса, а не край блока',
        '(выбрано ' + (best && best.weight) + ' против ' + (atHead && atHead.weight) + ')');
    assert(iX !== 0, 'B4 и это не голова дня', '(' + order.join(' → ') + ')');
    // Замок только СТАНКА (#4225) признаком ручного переноса не является: его получают ВСЕ задания
    // scope при переносе с двумя станками — исключение по нему расползлось бы на автоматику.
    var machineLockOnly = moved({});
    machineLockOnly.lockSlitter = '1';
    assert(P.scorePosition(wall(), 3, machineLockOnly, CTX) === null,
        'B5 замок станка (#4225) исключения НЕ даёт — точка внутри монолита недопустима');
})();

// ── C. Автоматика внутрь монолита не попадает ────────────────────────────────────────────────
(function () {
    var occ = P.seedOccupancy(wall(), [], ['1']);
    P.placeSlot(occ, moved({}), CTX);   // без признака ручного переноса
    var order = occ.byMachine['1'].map(function (s) { return String(s.id); });
    var iX = order.indexOf('X'), iT = order.indexOf('TWIN');
    assert(iX === 0 || iX === order.length - 1,
        'C1 §8 положил задание НА КРАЙ блока — внутрь монолита автоматика не вставляет (#4464)',
        '(' + order.join(' → ') + ')');
    assert(!(iX > 0 && iX < order.length - 1 && Math.abs(iX - iT) === 1),
        'C2 соседства с близнецом внутри блока автоматика не получает', '(' + order.join(' → ') + ')');
})();

// ── E. Порядок остальных звеньев монолита не меняется ────────────────────────────────────────
(function () {
    var occ = P.seedOccupancy(wall(), [], ['1']);
    P.placeSlot(occ, moved({ manual: true, lockDay: 0 }), CTX);
    var links = occ.byMachine['1'].filter(function (s) { return s.fixed; }).map(function (s) { return String(s.id); });
    assert(links.join(',') === 'L1,L2,TWIN,L3,L4',
        'E1 звенья монолита идут в прежнем порядке — расступились в одной точке', '(' + links.join(',') + ')');
})();

console.log('\n' + passed + '/' + total + ' passed');
