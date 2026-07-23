// #4330 — после ПЕРЕНОСА заданий (moveCutToDay) на Ганте/в очереди появлялись дыры 15/30 и
// НАХЛЁСТЫ (до 45) мин; при генерации их не было. Причина — «тайминги считаются несинхронно»:
//   • planStart пишет УПАКОВЩИК (splitMachineQueue): резервирует переналадку changeoverParts(prev,c);
//   • колонки «Наладка ножей»/«Сырьё-намотка» пишет computeCutSetupUpdates (setupActivityColumns) —
//     ОТДЕЛЬНЫМ проходом по всей сохранённой очереди.
// scheduleFromStored рисует окно [planStart; planStart + колонки + намотка] «как есть» (#4099) →
// если два прохода разошлись на величину переналадки, между окнами видна дыра (упаковщик зарезервировал
// больше) или нахлёст (меньше): 15 (сырьё), 30 (ножи), 45 (оба).
//
// Корень регрессии: buildSequenceOps держал carry-override (#4300/#4312 prevSetupBeforeWindow) и
// исключение прошлых дней (#4294 cutsBeforeWindowToKeep) ПОД `if (!moveScope)` — ручной перенос 🗓 их
// ПРОПУСКАЛ. Тогда на move-пути упаковщик нёс заправку от СЫРОГО prev_cut_setup (и пере-паковал прошлые
// дни), а колонки считались от вчерашней резки плана → расхождение. PR #4316 изменил величину сырой
// заправки (prevSetupFromRows × batch_count) → расхождение всплыло именно после переноса.
//
// Фикс: применяем carry-override + исключение прошлых дней НА ВСЕХ путях, включая перенос (снят гейт
// `if (!moveScope)`). Тогда planStart упаковщика и хранимые колонки сходятся, как при генерации.
//
// Тест повторяет ровно то, что делают buildSequenceOps (упаковщик) и computeCutSetupUpdates (колонки)
// на MOVE-пути, и меряет зазор между нарисованными окнами (как #4312). movePathFixed=false — старое
// поведение переноса (гейт пропускал carry/keepIds) → дыра; true — после фикса #4330 → 0.
//
// Run with: node experiments/atex-production-planning-4330.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, KNIFE_MOVE: 0, BETWEEN_CUTS: 0, CLEANUP_SHIFT: 0 };
function midnight(y, m, d) { return new Date(y, m - 1, d, 0, 0, 0, 0).getTime(); }
var BASE = midnight(2026, 7, 22);                       // «С» = 22.07 (день 0)
var D21 = midnight(2026, 7, 21), D22 = midnight(2026, 7, 22);
var K8 = [110, 110, 110, 110, 110, 110, 110, 110];

// prev_cut_setup из отчёта — СТАРАЯ конфигурация станка (последняя физически начатая резка): то же
// сырьё, но другие ножи → changeover(STALE, первая резка окна) = 30 мин (ножи). Именно эту «сырую»
// заправку move-путь брал без carry-override.
var STALE_KNIFE = { materialId: 'MWR113L', winding: 'OUT', knifeWidths: [80], knifeCount: 1 };
// Вариант с расхождением по СЫРЬЮ (15 мин): старое сырьё другое.
var STALE_MAT = { materialId: 'MOTHER', winding: 'OUT', knifeWidths: K8, knifeCount: 8 };

function cut(id, dayMs, mat, kw, runs, o) {
    o = o || {};
    return { id: id, firstPartId: o.fp != null ? o.fp : id, slitter: { id: o.m || 'm3' },
        materialId: mat, winding: 'OUT', batchId: '', knifeWidths: kw, knifeCount: kw.length,
        rollerWidth: 0, plannedRuns: runs, isFoil: false, length: 100, orderId: 'O_' + id,
        planDate: String(Math.floor((dayMs + 8 * 3600000 + (o.minute || 0) * 60000) / 1000)),
        duration: String(runs * 22), status: o.status || '', fixed: !!o.fixed };
}

// Повторяем move-путь buildSequenceOps + колонки computeCutSetupUpdates; меряем зазор окон T1→T2.
// stale — prev_cut_setup станка; movePathFixed — применяет ли move-путь carry-override + keepIds (#4330).
function gapAfterMove(stale, movePathFixed) {
    // Вчера станок резал ТУ ЖЕ конфигурацию, что T1 (наладки быть не должно). «Завершён» — как на ateh.
    var Y = cut('Y', D21, 'MWR113L', K8, 3, { status: 'Завершён' });
    var T1 = cut('T1', D22, 'MWR113L', K8, 3, { minute: 0 });          // перенесённое первое задание окна
    var T2 = cut('T2', D22, 'MW308', [95, 95, 95, 95], 4, { minute: 100 });
    var all = [Y, T1, T2];

    // — как buildSequenceOps на move-пути —
    var planInput = all.filter(function (c) { return String(c.status || '').trim() !== 'Завершён'; });
    var prevSetupBySlitter = { m3: stale };                            // #3853: заправка из prev_cut_setup
    if (movePathFixed) {                                               // #4330: move-путь теперь как генерация
        var carry = planning.prevSetupBeforeWindow(all, BASE);        // #4300/#4312
        Object.keys(carry).forEach(function (sid) { prevSetupBySlitter[sid] = carry[sid]; });
        var keepIds = planning.cutsBeforeWindowToKeep(all, BASE);      // #4294
        var keepSet = {}; keepIds.forEach(function (id) { keepSet[String(id)] = true; });
        planInput = planInput.filter(function (c) { return !keepSet[String(c.id)]; });
    }

    var perPass = {}, dueDay = {}, dueKey = {};
    all.forEach(function (c) { perPass[c.id] = 22; dueDay[c.id] = 9; dueKey[c.id] = 20260731; });
    var ops = planning.planCutOperations(planInput, {
        planBaseMidnightMs: BASE, weights: {}, times: TIMES,
        dayStartMin: 480, dayEndMin: 930, dayEndHourMin: 990, maxOverworkCutsMin: 0, maxOverworkTuneMin: 0,
        lunchStartMin: 0, lunchDurationMin: 0, gapFill: true, preserveOrder: false, firstCutSetup: true,
        prevSetupBySlitter: prevSetupBySlitter, intraDayResequence: false, slotPlacement: false,
        perPassByCut: perPass, slitterIds: ['m3'], dueDayByCut: dueDay, dueKeyByCut: dueKey, dayAnchorByCut: {}
    });

    // — как computeCutSetupUpdates: колонки по ВСЕЙ группе станка, заправка — prev_cut_setup —
    var arr = planning.groupBySlitter(all)[0].cuts;
    var cols = planning.setupActivityColumns(arr, TIMES, planning.carryOverPrevCut(stale, arr[0]));

    var startById = {};
    (ops.updates || []).forEach(function (u) { startById[String(u.cutId)] = u.planStartTs; });
    function windowOf(c) {
        var ts = startById[String(c.id)];
        if (ts == null) return null;
        var start = (ts * 1000 - BASE) / 60000;
        var col = cols[String(c.id)] || {};
        return { start: start, end: start + (col.knifeMin || 0) + (col.materialWindingMin || 0) + Number(c.duration) };
    }
    var w1 = windowOf(T1), w2 = windowOf(T2);
    return (w1 && w2) ? Math.round(w2.start - w1.end) : NaN;
}

// ── Расхождение по НОЖАМ (30 мин) ────────────────────────────────────────────────────────────────
assert(gapAfterMove(STALE_KNIFE, false) === 30,
    '#4330 (регрессия): move-путь без carry/keepIds → упаковщик зарядил переналадку ножей 30 мин, ' +
    'колонки — 0 → дыра/нахлёст 30 мин между заданиями');
assert(gapAfterMove(STALE_KNIFE, true) === 0,
    '#4330 (фикс): move-путь применяет carry-override + исключение прошлых дней → planStart и колонки сходятся, зазор 0');

// ── Расхождение по СЫРЬЮ (15 мин) ────────────────────────────────────────────────────────────────
assert(gapAfterMove(STALE_MAT, false) === 15,
    '#4330 (регрессия): «сырая» заправка иного сырья → расхождение 15 мин (смена сырья/намотки)');
assert(gapAfterMove(STALE_MAT, true) === 0,
    '#4330 (фикс): та же заправка из очереди станка → зазор 0 и по сырью');

console.log('\n' + passed + '/' + total + ' passed');
if (passed !== total) process.exitCode = 1;
