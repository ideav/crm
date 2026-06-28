// Unit tests for #3820 — follow-up к #3815 (EDD): «Всё равно не планирует на 23 то, у чего
// срок 23. Планирует туда со сроком 24.»
//
// Симптом (боевой скрин): фильтр «Дата плана» сужен на один день (напр. [23.06; 23.06]).
// Задание со сроком 23.06 «застряло» на 24.06 (его «Дата план» = 24.06). #3815 ослабляет
// якорь дня до дня срока, НО только для резок, попавших в scope раскладки [scopeFromKey;
// scopeToKey] (#3660 — не трогать чужие даты). Резка с «Датой план» 24.06 в окно [23;23]
// не попадала → EDD не мог подтянуть её на 23, и день 23 заполнялся резками со сроком 24.
//
// Фикс: headInScope дополнительно берёт в раскладку НЕзафиксированную резку, чей «Срок
// изготовления» (dueKey) ≤ верхней границы окна (срок В окне или РАНЬШЕ него), но «Дата
// план» которой стоит ПОЗЖЕ окна — её затягиваем в окно (EDD), не трогая корректно
// будущие (срок позже окна) и зафиксированные (#3508) задания.
//
// Run with: node experiments/atex-production-planning-3820.test.js

process.env.TZ = 'Europe/Moscow';

var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// База — полночь 23.06.2026 (день 0 = 23.06, день 1 = 24.06).
var BASE_MS = new Date(2026, 5, 23, 0, 0, 0).getTime();
var DUE = { d23: 20260623, d24: 20260624, d25: 20260625 };
var KEY23 = 20260623;   // planDateDayKey(23.06) — границы scope в ключах YYYYMMDD

// Резка станка m4. planDay — день «Даты план» (0 = 23.06). fixed — флаг «Зафиксировано».
function cut(id, mat, runs, planDay, fixed) {
    var ms = BASE_MS + (planDay || 0) * 86400000;
    return { id: id, slitter: { id: 'm4' }, materialId: mat, winding: 'OUT', knifeWidths: [110],
        knifeCount: 1, plannedRuns: runs, planDate: String(Math.floor(ms / 1000)),
        sequence: null, isFoil: false, fixed: !!fixed };
}
function plan(cuts, dueKeyByCut, scoped) {
    var anchor = {};
    cuts.forEach(function(c) { anchor[String(c.id)] = Math.round((Number(c.planDate) * 1000 - BASE_MS) / 86400000); });
    var opts = { perPassByCut: cuts.reduce(function(o, c) { o[c.id] = 100; return o; }, {}),
        dayStartMin: 480, dayEndMin: 480 + 450, times: { BETWEEN_CUTS: 0, MATERIAL_WINDING: 15, KNIFE: 30 },
        planBaseMidnightMs: BASE_MS, preserveOrder: false, gapFill: true,
        dayAnchorByCut: anchor, dueKeyByCut: dueKeyByCut };
    if (scoped) { opts.scopeFromKey = KEY23; opts.scopeToKey = KEY23; }   // фильтр [23.06; 23.06]
    var ops = planning.planCutOperations(cuts, opts);
    var day = {};
    ops.updates.forEach(function(u) { day[u.cutId] = Math.round((Number(u.planStartTs) - Math.floor(BASE_MS / 1000)) / 86400); });
    return { touched: ops.updates.map(function(u) { return u.cutId; }).sort(), day: day };
}

// ── 1) Срок 23, «застрял» на 24, фильтр [23;23] → задание затягивается в окно (на день 0) ──
// A (срок 24) уже на 23 (день 0). B (срок 23) на 24 (день 1, вне окна [23;23]).
// До фикса: B вне scope → не трогается, остаётся на 24. После: B в scope по сроку → EDD на день 0.
var r1 = plan([ cut('A', 'matA', 2, 0), cut('Bdue23', 'matB', 2, 1) ], { A: DUE.d24, Bdue23: DUE.d23 }, true);
assertEqual(r1.touched.indexOf('Bdue23') >= 0, true,
    '#3820: задание со сроком 23, застрявшее на 24, при фильтре [23;23] берётся в раскладку');
assertEqual(r1.day.Bdue23, 0,
    '#3820: задание со сроком 23 подтянуто на день 0 (23.06), несмотря на «Дату план» 24');

// ── 2) Срок ПОЗЖЕ окна (24) на 24 → НЕ трогаем (чужая дата, #3660 в силе) ──
var r2 = plan([ cut('A', 'matA', 2, 0), cut('Cdue24', 'matC', 2, 1) ], { A: DUE.d24, Cdue24: DUE.d24 }, true);
assertEqual(r2.touched.indexOf('Cdue24') < 0, true,
    '#3820: задание со сроком 24 (позже окна [23;23]) на 24 остаётся вне scope — не перепланируется');

// ── 3) Зафиксированное задание со сроком 23 на 24 → НЕ затягиваем (пин важнее, #3508) ──
var r3 = plan([ cut('A', 'matA', 2, 0), cut('Bfix', 'matB', 2, 1, true) ], { A: DUE.d24, Bfix: DUE.d23 }, true);
assertEqual(r3.touched.indexOf('Bfix') < 0, true,
    '#3820: зафиксированное задание со сроком 23 на 24 остаётся на своём дне (пин важнее EDD)');

// ── 4) Срок РАНЬШЕ окна (просрочка, due 22 в ключах) на 25 → тоже затягиваем в окно ──
var r4 = plan([ cut('A', 'matA', 2, 0), cut('Bover', 'matB', 2, 2) ], { A: DUE.d24, Bover: 20260622 }, true);
assertEqual([r4.touched.indexOf('Bover') >= 0, r4.day.Bover], [true, 0],
    '#3820: просроченное задание (срок 22) с «Датой план» 25 затягивается в окно [23;23] на день 0');

// ── 5) Без scope (оба ключа null) — поведение #3815 не меняется (обратная совместимость) ──
var r5full = plan([ cut('A', 'matA', 2, 0), cut('Bdue23', 'matB', 2, 1) ], { A: DUE.d24, Bdue23: DUE.d23 }, false);
assertEqual(r5full.day.Bdue23, 0,
    '#3820: без scope — EDD как в #3815 (срок 23 на день 0), вся очередь станка перепланируется');

// ── 6) Нет срока у застрявшей резки → НЕ затягиваем (без dueKey scope не расширяется) ──
var r6 = plan([ cut('A', 'matA', 2, 0), cut('Bnodue', 'matB', 2, 1) ], { A: DUE.d24 /* Bnodue без срока */ }, true);
assertEqual(r6.touched.indexOf('Bnodue') < 0, true,
    '#3820: задание без «Срока изготовления» на 24 не затягивается в окно [23;23] (#3660 в силе)');

console.log('\n' + passed + ' passed');
