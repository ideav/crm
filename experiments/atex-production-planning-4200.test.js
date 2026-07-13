// Unit tests for #4200 — просрочка ПОСЛЕ ручного ↑/↓ (moveCutInDay) + «Пересчитать наладку»
// (autoSequenceQueue preserveOrder=true). Два бага, оба подтверждены на РЕАЛЬНОМ трейсе ateh (v118.29):
//
// Bug A: доп. проход #4118 (relocateOverdueReal — тянет ПРОСРОЧЕННОЕ в наименее штрафное место) был
//        заперт за (slotPlan && !preserveOrder). «Пересчитать наладку» (preserveOrder=true) паковал в
//        ручном порядке БЕЗ единой проверки срока и БЕЗ трассы → задания уезжали за срок молча.
//        Фикс: #4118 идёт на ВСЕХ путях, где заданы сроки (opts.dueDayByCut); на preserveOrder вход —
//        занятость из текущего (ручного) порядка; двигает ТОЛЬКО просроченные, порядок задач в срок не трогает.
//
// Bug B: арбитр §12/#4118 сравнивал ЛОГИЧЕСКИЙ dayOffset (splitMachineQueue пакует по логическим дням
//        0,1,2…, а выходные/праздники сдвигают ОКНО, НЕ dayOffset) с КАЛЕНДАРНЫМ сроком (dueDayOffsetFromBase).
//        За выходными логический день < календарного → задание числилось «в срок ✓», а панель
//        (countOverdueCuts по planStart-календарю) — просроченным. Фикс: realDaysFrom/realPackFn отдают
//        КАЛЕНДАРНЫЙ день floor(windowStartMin/1440) (= день planStart).
//
// Run with: node experiments/atex-production-planning-4200.test.js

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
             knifeWidths: [50], knifeCount: 1, rollerWidth: 0, plannedRuns: 1, isFoil: false, length: 100,
             planDate: String(planOrderTs), status: '', fixed: false };
}
// день (календарный офсет от base) задания из ops.updates
function dayOf(ops, base, id) {
    var u = (ops.updates || []).filter(function (x) { return String(x.cutId) === String(id); })[0];
    if (!u) return null;
    return Math.floor((Number(u.planStartTs) * 1000 - base) / 86400000);
}
function machineOf(ops, id) {
    var u = (ops.updates || []).filter(function (x) { return String(x.cutId) === String(id); })[0];
    return u ? u.slitterId : undefined;
}
function overdueIds(ops) { return (ops.overdue || []).map(function (o) { return String(o.cutId); }); }

// Общие опции упаковки: окно 8:00–9:00 (60 мин) ⇒ 1 резка/день; без обеда/нахлёста.
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

// ── Scenario B: Bug B — задание за выходными ловится по КАЛЕНДАРЮ ─────────────────────────────────
// База — пятница 03.07.2026. 04–05.07 — выходные (блок [1д;3д)). 1 резка/день, один станок m1.
// Ручной порядок A,B,C (все срок пн 06.07). A→03.07(кал.0), B→логич.1→06.07(кал.3), C→логич.2→07.07(кал.4).
// C: логический день 2 ≤ срок(день) 3 (СТАРЫЙ арбитр «в срок»), но КАЛЕНДАРНЫЙ 4 > 3 → просрочка.
(function () {
    var base = midnight(2026, 7, 3);           // Fri
    var A = scut('A', 'm1', base + 1), B = scut('B', 'm1', base + 2), C = scut('C', 'm1', base + 3);
    var due = ymd(2026, 7, 6);                  // Mon 06.07 для всех
    var dueDayByCut = { A: 3, B: 3, C: 3 };     // dueDayOffsetFromBase(20260706, 03.07) = 3 (КАЛЕНДАРНЫХ дня)
    var dueKeyByCut = { A: due, B: due, C: due };
    var ops = P.planCutOperations([A, B, C], baseOpts(base, {
        perPassByCut: { A: 400, B: 400, C: 400 }, slitterIds: ['m1'],
        dueDayByCut: dueDayByCut, dueKeyByCut: dueKeyByCut,
        blockedRangesBySlitter: { m1: [[1 * 1440, 3 * 1440]] }   // 04–05.07 выходные
    }));
    assert(dayOf(ops, base, 'C') === 4,
        '#4200 Bug B репро: C приземляется на КАЛЕНДАРНЫЙ день 4 (07.07), за выходными (day ' + dayOf(ops, base, 'C') + ')');
    assert(overdueIds(ops).indexOf('C') >= 0,
        '#4200 Bug B фикс: C помечен просроченным по КАЛЕНДАРЮ (ops.overdue), хотя логический день 2 ≤ срок 3 — старый арбитр молчал');
})();

// ── Scenario A: Bug A — #4118 рескью РАБОТАЕТ на preserveOrder-пересчёте (кросс-станок) ────────────
// База — пн 06.07.2026 (без выходных). 1 резка/день. Два станка m1, m2 (m2 простаивает).
// m1 ручной порядок: A(срок d0), B(срок d1), C(срок d0). A→d0, B→d1, C→d2 — C ЗА сроком (d2>d0).
// Внутри m1 переставить C некуда: перед A/B она бы утопила их за срок (harm-гейт #4118 не пустит).
// Поэтому #4118 переносит C на ПУСТОЙ m2 → d0 (в срок). Проверяет и рескью, и посев пустых станков.
(function () {
    var base = midnight(2026, 7, 6);           // Mon (d0=06,d1=07,d2=08 — все будни)
    var A = scut('A', 'm1', base + 1), B = scut('B', 'm1', base + 2), C = scut('C', 'm1', base + 3);
    var d0 = ymd(2026, 7, 6), d1 = ymd(2026, 7, 7);
    var ops = P.planCutOperations([A, B, C], baseOpts(base, {
        perPassByCut: { A: 400, B: 400, C: 400 }, slitterIds: ['m1', 'm2'],
        dueDayByCut: { A: 0, B: 1, C: 0 }, dueKeyByCut: { A: d0, B: d1, C: d0 },
        blockedRangesBySlitter: {}
    }));
    assert(overdueIds(ops).length === 0,
        '#4200 Bug A фикс: после preserveOrder-пересчёта просрочек НЕТ (#4118 отработал), ops.overdue пуст — было бы [C] без фикса');
    assert(dayOf(ops, base, 'C') === 0 && machineOf(ops, 'C') === 'm2',
        '#4200 Bug A: C (срок d0) перенесён рескью на ПУСТОЙ станок m2, день 0 — В СРОК (день ' + dayOf(ops, base, 'C') + ', станок ' + machineOf(ops, 'C') + ')');
    assert(machineOf(ops, 'A') === 'm1' && machineOf(ops, 'B') === 'm1' && dayOf(ops, base, 'A') === 0 && dayOf(ops, base, 'B') === 1,
        '#4200 Bug A: задания в срок (A,B) НЕ тронуты — остались на m1 в ручном порядке (A@d0, B@d1)');
})();

// ── Scenario C: регрессия — preserveOrder БЕЗ просрочки не трогает порядок и не даёт ложных переносов ─
// Все сроки далёкие → #4118 ничего не двигает; план = ручной порядок, ops.overdue пуст.
(function () {
    var base = midnight(2026, 7, 6);
    var A = scut('A', 'm1', base + 1), B = scut('B', 'm1', base + 2), C = scut('C', 'm1', base + 3);
    var far = ymd(2026, 7, 31);
    var ops = P.planCutOperations([A, B, C], baseOpts(base, {
        perPassByCut: { A: 400, B: 400, C: 400 }, slitterIds: ['m1', 'm2'],
        dueDayByCut: { A: 25, B: 25, C: 25 }, dueKeyByCut: { A: far, B: far, C: far },
        blockedRangesBySlitter: {}
    }));
    assert(overdueIds(ops).length === 0, '#4200 регресс: далёкие сроки → просрочек нет');
    assert(dayOf(ops, base, 'A') === 0 && dayOf(ops, base, 'B') === 1 && dayOf(ops, base, 'C') === 2,
        '#4200 регресс: ручной порядok сохранён (A@d0, B@d1, C@d2), ложных переносов нет');
    assert(machineOf(ops, 'C') !== 'm2', '#4200 регресс: C НЕ уехал на m2 — рескью не сработал впустую');
})();

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
