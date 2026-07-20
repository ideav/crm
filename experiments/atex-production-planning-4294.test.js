// #4294 — незафиксированное задание ПРОШЛОГО дня затягивалось в текущий при планировании.
// Пользователь планирует 22.07 (база «С»=22.07). Задания 21.07: зафиксированные (🔒) оставались
// на месте (движок держит их день, fixedDay<0), а НЕзафиксированное 21.07 планировщик клал от «С»
// вперёд (#3974) → оно садилось в середину 22.07.
//
// Фикс: задания прошлых дней (голова цепочки раньше «С») исключаются из ВХОДА пере-планирования
// (buildSequenceOps → planInput), кроме зафиксированных (их держит движок сам). Исключаем ВСЮ
// цепочку по дню ГОЛОВЫ, чтобы не осиротить продолжение, попавшее в окно (ср. #4292).
//
// Здесь покрываем ЧИСТЫЙ помощник cutsBeforeWindowToKeep(cuts, baseMidnightMs) — набор id записей,
// которые НЕ подаём в планировщик (остаются на своих днях).
//
// Run with: node experiments/atex-production-planning-4294.test.js

var planning = require('../download/atex/js/production-planning.js').planning;
var keep = planning.cutsBeforeWindowToKeep;

var passed = 0, total = 0;
function eq(actual, expected, name) {
    total++;
    var a = (actual || []).slice().map(String).sort();
    var e = (expected || []).slice().map(String).sort();
    var ok = JSON.stringify(a) === JSON.stringify(e);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++;
    else { console.log('  ожидалось (без порядка):', JSON.stringify(e), '\n  получено: ', JSON.stringify(a)); process.exitCode = 1; }
}
function midnight(y, m, d) { return new Date(y, m - 1, d, 0, 0, 0, 0).getTime(); }
function scut(id, dayTs, o) {
    o = o || {};
    return { id: id, firstPartId: o.fp != null ? o.fp : id, slitter: { id: o.m || 'm1' },
             materialId: o.mat || 'A', winding: o.w || 'OUT', knifeWidths: o.kw || [50], knifeCount: 1,
             rollerWidth: 0, orderId: o.ord != null ? o.ord : 'O_' + id,
             planDate: dayTs == null ? '' : String(Math.floor(dayTs / 1000)), fixed: !!o.fixed,
             plannedRuns: o.runs != null ? o.runs : 2 };
}
var BASE = midnight(2026, 7, 22);   // «С» = 22.07 = день 0
var D20 = midnight(2026, 7, 20), D21 = midnight(2026, 7, 21), D22 = midnight(2026, 7, 22), D23 = midnight(2026, 7, 23);

// ── База: незафикс прошлого дня исключаем, фикс прошлого дня и всё в окне — оставляем в входе ───────
(function () {
    var cuts = [
        scut('Ffix', D21, { fixed: true }),   // фикс 21.07 — держит движок (fixedDay<0), НЕ исключаем
        scut('Ufree', D21, {}),               // НЕзафикс 21.07 — исключаем (иначе затянет в 22.07)
        scut('Uold', D20, {}),                // НЕзафикс 20.07 — исключаем
        scut('N22', D22, {}),                 // в окне (день 0) — НЕ исключаем
        scut('N23', D23, {}),                 // в окне (день 1) — НЕ исключаем
        scut('New', null, {})                 // без «Даты план» (новое) — НЕ исключаем
    ];
    eq(keep(cuts, BASE), ['Ufree', 'Uold'],
        '#4294: исключаем ТОЛЬКО незафиксированные задания раньше «С»; фикс/в-окне/новые — остаются');
})();

// ── Цепочка дробления: голова 21.07 (незафикс) + продолжение 22.07 — исключаем ОБЕ (не осиротить) ───
(function () {
    var cuts = [
        scut('H', D21, { fp: 'H' }),          // голова 21.07
        scut('C', D22, { fp: 'H' }),          // продолжение 22.07 (в окне)
        scut('N', D22, {})                    // независимое задание в окне
    ];
    eq(keep(cuts, BASE), ['H', 'C'],
        '#4294: цепочка с головой раньше «С» исключается ЦЕЛИКОМ (голова 21.07 + продолжение 22.07)');
})();

// ── Цепочка с ЗАФИКСИРОВАННОЙ головой раньше «С» — не трогаем (движок держит) ────────────────────────
(function () {
    var cuts = [scut('Hf', D21, { fp: 'Hf', fixed: true }), scut('Cf', D22, { fp: 'Hf' })];
    eq(keep(cuts, BASE), [], '#4294: цепочка с ЗАФИКСИРОВАННОЙ головой раньше «С» — не исключаем (fixedDay держит)');
})();

// ── «С» раньше: задания 20/21.07 попадают в окно (день ≥ 0) → не исключаем ───────────────────────────
(function () {
    var earlyBase = midnight(2026, 7, 20);
    var cuts = [scut('A', D20, {}), scut('B', D21, {})];
    eq(keep(cuts, earlyBase), [], '#4294: при «С»=20.07 задания 20/21.07 в окне (день 0/1) — не исключаем');
})();

// ── Пустые/битые входы не падают ────────────────────────────────────────────────────────────────
(function () {
    eq(keep([], BASE), [], '#4294: пустой список → []');
    eq(keep(null, BASE), [], '#4294: null-список → []');
    eq(keep([scut('X', D21, {})], NaN), [], '#4294: нечисловая база → [] (offset null, ничего не исключаем)');
})();

// ── Интеграция: КОНТРАСТ на planCutOperations — без исключения незафикс-задание прошлого дня
//    затягивается в «С» (день 0); с исключением (как делает buildSequenceOps) — в план не попадает
//    (остаётся на своём дне нетронутым). ────────────────────────────────────────────────────────────
(function () {
    function pcut(id, mach, dayTs, fixed) {
        return { id: id, orderId: 'O_' + id, slitter: { id: mach }, materialId: 'A', winding: 'OUT',
                 knifeWidths: [50], knifeCount: 1, rollerWidth: 0, plannedRuns: 2, isFoil: false,
                 length: 100, planDate: String(Math.floor(dayTs / 1000)), status: '', fixed: !!fixed, firstPartId: id };
    }
    var cuts = [pcut('Ffix', 'm1', D21, true), pcut('Ufree', 'm2', D21, false), pcut('N22', 'm1', D22, false)];
    var opts = {
        planBaseMidnightMs: BASE, weights: {}, times: { MATERIAL_WINDING: 0, KNIFE: 0, KNIFE_MOVE: 0, BETWEEN_CUTS: 0, CLEANUP_SHIFT: 0 },
        dayStartMin: 480, dayEndMin: 930, dayEndHourMin: 930, maxOverworkCutsMin: 0, maxOverworkTuneMin: 0,
        lunchStartMin: 0, lunchDurationMin: 0, gapFill: true, preserveOrder: false, firstCutSetup: false,
        prevSetupBySlitter: {}, intraDayResequence: false, slotPlacement: true,
        perPassByCut: { Ffix: 30, Ufree: 30, N22: 30 }, slitterIds: ['m1', 'm2'],
        dueDayByCut: { Ffix: 99, Ufree: 99, N22: 99 }, dueKeyByCut: { Ffix: 20260731, Ufree: 20260731, N22: 20260731 },
        dayAnchorByCut: { Ffix: -1, Ufree: -1, N22: 0 }
    };
    function opCutIds(ops) {
        var s = {};
        (ops.updates || []).concat(ops.creates || []).forEach(function (x) { s[String(x.cutId != null ? x.cutId : x.parentCutId)] = 1; });
        return Object.keys(s);
    }
    // БЕЗ исключения — Ufree (21.07, незафикс) затягивается в план (баг, который контроллер теперь гасит).
    var opsAll = planning.planCutOperations(cuts, opts);
    total++;
    if (opCutIds(opsAll).indexOf('Ufree') >= 0) { console.log('PASS — #4294: (контроль) БЕЗ исключения движок затягивает незафикс-задание прошлого дня в план'); passed++; }
    else { console.log('FAIL — #4294: контроль не воспроизвёл затягивание'); process.exitCode = 1; }
    // С исключением (как buildSequenceOps): убираем keep-id из входа → Ufree в план не попадает.
    var excl = {}; keep(cuts, BASE).forEach(function (id) { excl[id] = 1; });
    var opsKept = planning.planCutOperations(cuts.filter(function (c) { return !excl[String(c.id)]; }), opts);
    total++;
    if (opCutIds(opsKept).indexOf('Ufree') < 0) { console.log('PASS — #4294: с исключением незафикс-задание прошлого дня в план НЕ попадает (остаётся на 21.07)'); passed++; }
    else { console.log('FAIL — #4294: с исключением Ufree всё ещё в плане'); process.exitCode = 1; }
})();

console.log('\n' + passed + '/' + total + ' passed');
