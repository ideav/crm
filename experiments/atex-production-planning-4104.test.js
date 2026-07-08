// Тест #4104 — §12-релокация СХОДИТСЯ: каждый слот релоцируем не более раза за проход.
//
// Симптом (issue #4104, лог реальной генерации ateh): «§12 релокация … переносов 2000» =
// 4 раунда × cap 500 переносов/раунд — релокация упиралась в потолок КАЖДЫЙ раунд, а не сходилась
// («он правит время»). Причина: в relocatePass цена «ОСТАТЬСЯ» (cur) считается со штрафом срока по
// РЕАЛЬНОМУ дню (selfKey, #4098), а цена «ПЕРЕЕХАТЬ» (alt) — по ОПТИМИСТИЧНОЙ оценке дня без этого
// штрафа. dayByCut (реальные дни) — фиксированный снимок на весь проход. Для задания, которое
// реально ЗА сроком на ЛЮБОМ доступном станке, cur всегда «дорого», alt всегда «дёшево» → оно
// пинг-понгует между станками до cap.
//
// Фикс (#4104): слот релоцируем НЕ БОЛЕЕ раза за проход (movedIds). Внешний цикл §12 пере-пакует и
// обновляет реальные дни между раундами — слот получает следующий шанс на СВЕЖИХ данных.
//
// Run with: node experiments/atex-production-planning-4104.test.js

process.env.TZ = 'UTC';
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) { total++; console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (cond) passed++; else process.exitCode = 1; }

var ZERO = { KNIFE: 0, KNIFE_MOVE: 0, MATERIAL_WINDING: 0, BETWEEN_CUTS: 0 };
var BASE = Date.UTC(2026, 6, 1);
var K0 = P.dayKeyFromOffset(BASE, 0);   // срок U = day0
var K1 = P.dayKeyFromOffset(BASE, 1);
function C(id, wm, due) {
    return P.slotFromCut({ id: id, materialId: 'M1', winding: 'OUT', knifeWidths: [50], knifeCount: 1,
        rollerWidth: 0, plannedRuns: 1, workMin: wm }, due);
}

// ── 1) МУЛЬТИ-СТАНОК: просроченное на любом станке НЕ пинг-понгует, релокация сходится до cap ──
(function () {
    // U (срок day0) стоит за тяжёлым A → реально на day1 (за сроком) где угодно. Два годных станка:
    // без фикса cur(selfKey day1, штраф DEADLINE) > alt(оценка day0, без штрафа) на ОБОИХ → бесконечный
    // перелёт m1↔m2 до maxIters. С фиксом — слот замораживается после первого переноса → сходится.
    var occ = { byMachine: { m1: [C('A', 60, K1), C('U', 1, K0)], m2: [C('B', 60, K1)] } };
    var dayByCut = { A: 0, B: 0, U: 1 };   // фиксированный снимок реальных дней: U на day1 (≥ его срок 0)
    var ctx = { settings: {}, times: ZERO, capacityMin: 60, baseMidnightMs: BASE,
                dueDayByCut: { A: 1, B: 1, U: 0 }, feasibleMachine: function () { return true; },
                maxIters: 60 };
    var rel = P.relocatePass(occ, dayByCut, ctx);
    assert(rel.moves.length < ctx.maxIters, '#4104: релокация СОШЛАСЬ (' + rel.moves.length + ' переносов < cap ' + ctx.maxIters + '), не упёрлась в потолок');
    // нет пинг-понга: ни один слот не двигали более раза за проход
    var cnt = {}; rel.moves.forEach(function (m) { cnt[m.id] = (cnt[m.id] || 0) + 1; });
    var maxPerId = Object.keys(cnt).reduce(function (mx, id) { return Math.max(mx, cnt[id]); }, 0);
    assert(maxPerId <= 1, '#4104: каждый слот перенесён ≤ 1 раза за проход (макс ' + maxPerId + ') — пинг-понга нет');
})();

// ── 2) БЕЗ фикса тот же вход давал бы 60/60 (характеризация: cur со штрафом, alt без) ──
(function () {
    // Демонстрируем, что вход РЕАЛЬНО оскилляционный: U реально за сроком на обоих станках.
    // packReal кладёт U за тяжёлым A/B → day1 > срок day0 на любом станке.
    function cutObj(id) { return { id: id, slitter: { id: 'm1' }, materialId: 'M1', winding: 'OUT',
        knifeWidths: [50], knifeCount: 1, rollerWidth: 0, plannedRuns: 1 }; }
    // A заполняет весь день0 (work 100 = окно) → U (срок day0) реально спиливается на day1 (за сроком).
    var segs = P.splitMachineQueue([cutObj('A'), cutObj('U')],
        { dayStartMin: 0, dayEndMin: 100, times: ZERO, perPassByCut: { A: 100, U: 1 }, runsByCut: { A: 1, U: 1 } });
    var uDay = segs.filter(function (s) { return s.cutId === 'U'; }).reduce(function (mn, s) { return Math.min(mn, Number(s.dayOffset)); }, 9);
    assert(uDay >= 1, '#4104: вход валиден — U (срок day0) реально переливается на day' + uDay + ' (за сроком), провоцируя релокацию');
})();

// ── 3) НЕ РЕГРЕСС #4098: просроченное всё равно уводится в срок за один проход ──
(function () {
    var perPass = { A: 60, B: 60, U: 1 };
    function cutObj(id) { return { id: id, slitter: { id: 'm1' }, materialId: 'M1', winding: 'OUT',
        knifeWidths: [50], knifeCount: 1, rollerWidth: 0, plannedRuns: 1 }; }
    function packReal(order) {
        var segs = P.splitMachineQueue(order.map(cutObj),
            { dayStartMin: 0, dayEndMin: 100, times: ZERO, perPassByCut: perPass, runsByCut: { A: 1, B: 1, U: 1 } });
        var d = {}; segs.forEach(function (s) { var o = Number(s.dayOffset), id = String(s.cutId); if (d[id] == null || o < d[id]) d[id] = o; });
        return d;
    }
    var occ = { byMachine: { m1: [C('A', 60, K1), C('B', 60, K1), C('U', 1, K0)] } };
    var ctx = { settings: {}, times: ZERO, capacityMin: 200, baseMidnightMs: BASE,
                dueDayByCut: { A: 1, B: 1, U: 0 }, feasibleMachine: function () { return true; } };
    P.relocatePass(occ, packReal(['A', 'B', 'U']), ctx);
    var after = packReal(occ.byMachine.m1.map(function (s) { return s.id; }));
    assert(after.U <= 0, '#4104/#4098: просроченное U уведено в срок (day ' + after.U + ' ≤ 0) — фикс не сломал #4098');
})();

console.log('\n' + passed + '/' + total + ' passed');
