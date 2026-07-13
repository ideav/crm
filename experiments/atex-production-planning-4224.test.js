// Unit tests for #4224 — «Просрочка недопустима никаким образом»: постпроход обязан ловить и чинить
// просрочку, ДАЖE у зафиксированного (🔒) задания, и не зацикливаться. Плюс «фольга ВСЕГДА в конец
// дня» (#3717) чинится ЖЁСТКО, а не только когда дешевле по наладке.
//
// Подтверждено на РЕАЛЬНОМ трейсе ateh (v118.36, output30): пользователь перенёс фольгу 558792
// (срок 06.07) в 06.07 и зафиксировал; перестройка увела её в просрочку на 07.07, хотя 06.07 занят
// лишь на 135 из 450 мин. Причины:
//   (1) relocateOverdueReal (#4118) и §12-релокация ПРОПУСКАЛИ зафиксированные задания (if s.fixed
//       return) → просроченную фиксированную фольгу никто не тянул обратно на день со свободным местом.
//   (2) фольга 559660 (срок 10.07) осела в СЕРЕДИНЕ 01.07 — §12-релокация впихнула нефольгу за фольгу,
//       а resequenceWithinDays применял «фольга в конец» только если СТРОГО дешевле по наладке.
//
// Run with: node experiments/atex-production-planning-4224.test.js

var mod = require('../download/atex/js/production-planning.js');
var P = mod.planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

function midnight(y, m, d) { return new Date(y, m - 1, d, 0, 0, 0, 0).getTime(); }
function ymd(y, m, d) { return y * 10000 + m * 100 + d; }
function scut(id, machine, planOrderTs, opt) {
    opt = opt || {};
    return { id: id, orderId: 'O_' + id, slitter: { id: machine }, materialId: opt.mat || 'A', winding: 'OUT',
             knifeWidths: [50], knifeCount: 1, rollerWidth: 0, plannedRuns: 1, isFoil: !!opt.foil, length: 100,
             planDate: String(planOrderTs), status: '', fixed: !!opt.fixed };
}
function dayOf(ops, base, id) {
    var u = (ops.updates || []).filter(function (x) { return String(x.cutId) === String(id); })[0];
    if (!u) return null;
    return Math.floor((Number(u.planStartTs) * 1000 - base) / 86400000);
}
function machineOf(ops, id) {
    var u = (ops.updates || []).filter(function (x) { return String(x.cutId) === String(id); })[0];
    return u ? String(u.slitterId) : undefined;
}
function overdueIds(ops) { return (ops.overdue || []).map(function (o) { return String(o.cutId); }); }

// Окно 8:00–9:00 (60 мин) ⇒ 1 резка/день; без обеда/нахлёста; preserveOrder (ручной порядок).
function baseOpts(base, extra) {
    var o = {
        planBaseMidnightMs: base, weights: {}, times: {},
        dayStartMin: 480, dayEndMin: 540, dayEndHourMin: 540, maxOverworkCutsMin: 0, maxOverworkTuneMin: 0,
        lunchStartMin: 0, lunchDurationMin: 0, gapFill: true, preserveOrder: true,
        firstCutSetup: false, prevSetupBySlitter: {}, intraDayResequence: false, slotPlacement: false
    };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
}

// ── 1) ЗАФИКСИРОВАННАЯ просроченная фольга рескьюится В СРОК, оставаясь на СВОЁМ станке ──────────────
// База пн 06.07 (будни). m1 ручной порядок P,Q,X; X — ЗАФИКСИРОВАННАЯ фольга, срок d0. 1 резка/день ⇒
// P→d0, Q→d1, X→d2 (просрочка d2>d0). P,Q — дальний срок (двигать в d1/d2 не грех). Постпроход обязан
// вернуть X в срок; станок выбрал пользователь → X держится на m1 (не мигрирует на пустой m2).
(function () {
    var base = midnight(2026, 7, 6);
    var P1 = scut('P', 'm1', base + 1), Q = scut('Q', 'm1', base + 2),
        X = scut('X', 'm1', base + 3, { foil: true, fixed: true });
    var d0 = ymd(2026, 7, 6), far = ymd(2026, 7, 31);
    var ops = P.planCutOperations([P1, Q, X], baseOpts(base, {
        perPassByCut: { P: 400, Q: 400, X: 400 }, slitterIds: ['m1', 'm2'],
        dueDayByCut: { P: 25, Q: 25, X: 0 }, dueKeyByCut: { P: far, Q: far, X: d0 },
        blockedRangesBySlitter: {}
    }));
    assert(overdueIds(ops).indexOf('X') < 0 && overdueIds(ops).length === 0,
        '#4224 фикс(1): ЗАФИКСИРОВАННАЯ просроченная фольга X рескьюнута — ops.overdue пуст (было [X] без фикса)');
    assert(dayOf(ops, base, 'X') <= 0,
        '#4224 фикс(1): X приземлилась В СРОК (день ' + dayOf(ops, base, 'X') + ' ≤ срок 0)');
    assert(machineOf(ops, 'X') === 'm1',
        '#4224 замок станка: X (🔒) осталась на СВОЁМ станке m1, не мигрировала на пустой m2 (станок ' + machineOf(ops, 'X') + ')');
})();

// ── 2) Контроль: та же фольга БЕЗ фикса мигрирует на пустой станок m2 (замок станка — только для 🔒) ─
(function () {
    var base = midnight(2026, 7, 6);
    var P1 = scut('P', 'm1', base + 1), Q = scut('Q', 'm1', base + 2),
        X = scut('X', 'm1', base + 3, { foil: true, fixed: false });
    var d0 = ymd(2026, 7, 6), far = ymd(2026, 7, 31);
    var ops = P.planCutOperations([P1, Q, X], baseOpts(base, {
        perPassByCut: { P: 400, Q: 400, X: 400 }, slitterIds: ['m1', 'm2'],
        dueDayByCut: { P: 25, Q: 25, X: 0 }, dueKeyByCut: { P: far, Q: far, X: d0 },
        blockedRangesBySlitter: {}
    }));
    assert(overdueIds(ops).length === 0, '#4224 контроль(2): без фикса X тоже рескьюнута в срок (overdue пуст)');
    assert(machineOf(ops, 'X') === 'm2' && dayOf(ops, base, 'X') === 0,
        '#4224 контроль(2): без фикса X ушла на пустой m2, день 0 (станок ' + machineOf(ops, 'X') + ', день ' + dayOf(ops, base, 'X') + ')');
})();

// ── 3) Регрессия: НЕ просроченная 🔒-фольга не двигается (постпроход трогает только просрочку) ────────
(function () {
    var base = midnight(2026, 7, 6);
    var P1 = scut('P', 'm1', base + 1), Q = scut('Q', 'm1', base + 2),
        X = scut('X', 'm1', base + 3, { foil: true, fixed: true });
    var far = ymd(2026, 7, 31);
    var ops = P.planCutOperations([P1, Q, X], baseOpts(base, {
        perPassByCut: { P: 400, Q: 400, X: 400 }, slitterIds: ['m1', 'm2'],
        dueDayByCut: { P: 25, Q: 25, X: 25 }, dueKeyByCut: { P: far, Q: far, X: far },
        blockedRangesBySlitter: {}
    }));
    assert(overdueIds(ops).length === 0, '#4224 регресс(3): дальние сроки → просрочек нет');
    // X не тронута → её slitterId в update не меняется и выпадает (machineOf ≠ 'm2' = «не мигрировала»).
    assert(machineOf(ops, 'X') !== 'm2' && dayOf(ops, base, 'X') === 2,
        '#4224 регресс(3): 🔒-фольга X в срок НЕ тронута — не мигрировала на m2, день 2 (станок ' + machineOf(ops, 'X') + ', день ' + dayOf(ops, base, 'X') + ')');
})();

// ── 4) «Фольга ВСЕГДА в конец дня» (#3717) чинится ЖЁСТКО, даже когда это ДОРОЖЕ по наладке ──────────
// resequenceWithinDays напрямую. День 0: порядок [A, F, B] — фольга F в СЕРЕДИНЕ (как после §12-релокации,
// впихнувшей нефольгу B за фольгу). A и F различаются лишь партией (A→F дёшево), B — другой материал
// (дорогой переход). Поэтому «фольга в конец» [A, B, F] ДОРОЖЕ по цели (A→B и B→F дорогие) — прежняя
// приёмка (newSeq < oldSeq) его отвергала бы. Правило #3717 жёсткое → порядок обязан стать foil-last.
(function () {
    function fcut(id, mat, wind, knives, batch, foil) {
        return { id: id, materialId: mat, winding: wind, knifeWidths: knives, knifeCount: knives.length,
                 rollerWidth: 0, isFoil: !!foil, batchId: batch, plannedRuns: 1, length: 100 };
    }
    var A = fcut('A', 'MA', 'OUT', [50], 'b1', false);
    var F = fcut('F', 'MA', 'OUT', [50], 'b2', true);    // от A отличается лишь партией → отдельная группа, дешёвый переход
    var B = fcut('B', 'MB', 'OUT', [50], 'b3', false);   // другой материал → дорогой переход
    var res = P.resequenceWithinDays([A, F, B], { A: 0, F: 0, B: 0 }, {}, null, P.DEFAULT_OP_TIMES);
    assert(!!res && res.length === 3,
        '#4224 фикс(2): resequence вернул новый порядок для foil-middle (не null, хотя foil-last дороже)');
    assert(!!res && res[res.length - 1] && String(res[res.length - 1].id) === 'F',
        '#4224 фикс(2): фольга F переставлена В КОНЕЦ дня (#3717 жёстко), порядок ' + (res ? res.map(function (c) { return c.id; }).join(',') : 'null'));
    // никакая нефольга не осталась после фольги
    var badAfterFoil = false, seenFoil = false;
    (res || []).forEach(function (c) { if (c.isFoil) seenFoil = true; else if (seenFoil) badAfterFoil = true; });
    assert(!badAfterFoil, '#4224 фикс(2): ни одной нефольги ПОСЛЕ фольги в дне');
})();

// ── 5) Регрессия: если фольга УЖЕ в конце дня — resequence не выдумывает лишних перестановок ──────────
(function () {
    function fcut(id, mat, wind, knives, batch, foil) {
        return { id: id, materialId: mat, winding: wind, knifeWidths: knives, knifeCount: knives.length,
                 rollerWidth: 0, isFoil: !!foil, batchId: batch, plannedRuns: 1, length: 100 };
    }
    var A = fcut('A', 'MA', 'OUT', [50], 'b1', false);
    var B = fcut('B', 'MB', 'OUT', [50], 'b3', false);
    var F = fcut('F', 'MA', 'OUT', [50], 'b2', true);
    var res = P.resequenceWithinDays([A, B, F], { A: 0, B: 0, F: 0 }, {}, null, P.DEFAULT_OP_TIMES);
    // foil уже последняя и порядок оптимален → null (нечего улучшать), либо тот же foil-last порядок.
    var lastFoil = !res || (res[res.length - 1] && String(res[res.length - 1].id) === 'F');
    assert(lastFoil, '#4224 регресс(5): вход уже foil-last — фольга осталась в конце (res ' + (res ? res.map(function (c) { return c.id; }).join(',') : 'null') + ')');
})();

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
