// Тесты для ideav/crm#4488 — перенесённое задание встаёт в день ЦЕЛИКОМ.
//
// ПРАВИЛО (заказчик, 29.07.2026): при ручном переносе задание встаёт в выбранный день ЦЕЛИКОМ,
// а на следующий день уезжают СОСЕДНИЕ задания — сначала незафиксированные, затем 🔒. Само
// перенесённое рвётся В ПОСЛЕДНЮЮ ОЧЕРЕДЬ — когда вытеснять больше некого.
//
// Симптом (#4488): оператор перенёс 649598 на 3-е место, а на выбранном дне оказался только ОДИН
// его проход (6 мин) — остальные 11 остались хвостом 650956 в следующем дне. Причина: упаковщик
// считал остаток дня БЕЗ учёта того, что это задание переносил человек, и рвал его по потолку
// (#4304/#4467) наравне с любым другим — при том, что после него в дне стояли задания, которые
// можно было подвинуть.
//
//   A — перенесённое встаёт ЦЕЛИКОМ, а сосед перед ним рвётся по потолку и уезжает;
//   B — день при этом не длиннее смены с нахлёстом (ТЗ §15, DAY_CAPACITY не нарушен);
//   C — вытесняется СНАЧАЛА незафиксированное: при выборе между свободным и 🔒 уезжает свободное;
//   D — ПОСЛЕДНЯЯ ОЧЕРЕДЬ: вытеснять некого (перенесённое одно в дне и длиннее смены) — рвётся оно;
//   E — обычные задания (без переноса) правило не трогает: рвётся хвост дня, как и раньше.
//
// Run with: node experiments/atex-production-planning-4488.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var TIMES = { KNIFE: 0, MATERIAL_WINDING: 0, BETWEEN_CUTS: 0 };   // наладки нулевые — меряем чистую ёмкость
var CAP = 450;

function cut(id, work, fixed) {
    return { id: id, materialId: 'M1', winding: 'OUT', batchId: 'B1', knifeWidths: [100],
             knifeCount: 1, rollerWidth: 100, isFoil: false, plannedRuns: 1, fixed: !!fixed, _work: work };
}
// perPass = 10 мин, проходов = work/10 — чтобы разрыв по потолку был возможен попроходно.
function pack(cuts, opts) {
    var perPass = {}, runs = {}, anchor = {};
    cuts.forEach(function (c) {
        perPass[String(c.id)] = 10; runs[String(c.id)] = Math.round(c._work / 10);
        if (c.fixed) anchor[String(c.id)] = 0;
    });
    return P.splitMachineQueue(cuts, Object.assign({
        dayStartMin: 480, dayEndMin: 480 + CAP, dayEndHourMin: 480 + CAP,
        times: TIMES, perPassByCut: perPass, runsByCut: runs, dayAnchorByCut: anchor,
        gapFill: true, orderAuthoritative: true
    }, opts || {}));
}
function segsOf(rows, id) {
    return rows.filter(function (s) { return String(s.cutId) === String(id) && !s.setupOnly; })
        .sort(function (a, b) { return a.dayOffset - b.dayOffset; });
}
function daysOf(rows, id) { return segsOf(rows, id).map(function (s) { return s.dayOffset; }); }
function runsOf(rows, id, day) {
    return segsOf(rows, id).filter(function (s) { return day == null || s.dayOffset === day; })
        .reduce(function (t, s) { return t + (Number(s.runs) || 0); }, 0);
}
function dayMinutes(rows, day) {
    return rows.filter(function (s) { return s.dayOffset === day; })
        .reduce(function (t, s) { return t + (Number(s.setupMin) || 0) + (Number(s.durationMin) || 0); }, 0);
}

// ── A/B: сосед уступает, перенесённое целиком ───────────────────────────────────────────────
// День 450 мин: A (свободное, 300) + M (перенесённое 🔒, 200) = 500. Перенесённое обязано лечь
// целиком (200) → A влезает только 250, остаток 50 уезжает на следующий день.
(function () {
    var cuts = [cut('A', 300), cut('M', 200, true)];
    var rows = pack(cuts, { wholeDayByCut: { M: 0 } });
    assert(daysOf(rows, 'M').join(',') === '0',
        '#4488-A: перенесённое M встало ЦЕЛИКОМ в выбранный день (одним сегментом)',
        '(дни M: ' + daysOf(rows, 'M').join(',') + ', проходов ' + runsOf(rows, 'M', 0) + ' из 20)');
    assert(runsOf(rows, 'M', 0) === 20,
        '#4488-A: все 20 проходов M на выбранном дне', '(' + runsOf(rows, 'M', 0) + ')');
    assert(daysOf(rows, 'A').length > 1 || daysOf(rows, 'A')[0] === 1,
        '#4488-A: сосед A уступил — часть уехала на следующий день',
        '(дни A: ' + daysOf(rows, 'A').join(',') + ')');
    assert(dayMinutes(rows, 0) <= CAP,
        '#4488-B: день не длиннее смены (ТЗ §15)', '(' + dayMinutes(rows, 0) + ' из ' + CAP + ')');
})();

// ── C: вытесняется СНАЧАЛА незафиксированное ────────────────────────────────────────────────
// День 450: F (🔒, 150) + A (свободное, 150) + M (перенесённое 🔒, 200) = 500. Уехать должно
// свободное A, а 🔒 F остаться.
(function () {
    var cuts = [cut('F', 150, true), cut('A', 150), cut('M', 200, true)];
    var rows = pack(cuts, { wholeDayByCut: { M: 0 } });
    assert(runsOf(rows, 'M', 0) === 20, '#4488-C: перенесённое M целиком на своём дне',
        '(' + runsOf(rows, 'M', 0) + ' из 20)');
    assert(runsOf(rows, 'F', 0) === 15, '#4488-C: 🔒 F осталось на своём дне целиком',
        '(' + runsOf(rows, 'F', 0) + ' из 15)');
    assert(runsOf(rows, 'A', 0) < 15,
        '#4488-C: уступило НЕзафиксированное A', '(на дне 0 проходов A: ' + runsOf(rows, 'A', 0) + ' из 15)');
    assert(dayMinutes(rows, 0) <= CAP, '#4488-C: день не длиннее смены', '(' + dayMinutes(rows, 0) + ')');
})();

// ── D: последняя очередь — вытеснять некого ─────────────────────────────────────────────────
(function () {
    var cuts = [cut('M', 600, true)];   // одно задание, длиннее смены
    var rows = pack(cuts, { wholeDayByCut: { M: 0 } });
    assert(daysOf(rows, 'M').length > 1,
        '#4488-D: вытеснять некого — перенесённое рвётся по потолку (последняя очередь)',
        '(дни M: ' + daysOf(rows, 'M').join(',') + ')');
    assert(dayMinutes(rows, 0) <= CAP, '#4488-D: день всё равно не длиннее смены', '(' + dayMinutes(rows, 0) + ')');
})();

// ── E: без переноса поведение прежнее ───────────────────────────────────────────────────────
(function () {
    var cuts = [cut('A', 300), cut('B', 200, true)];
    var rows = pack(cuts);   // wholeDayByCut не задан
    assert(runsOf(rows, 'A', 0) === 30,
        '#4488-E: обычная раскладка не изменилась — A целиком на дне 0', '(' + runsOf(rows, 'A', 0) + ' из 30)');
    assert(daysOf(rows, 'B').length > 1 || runsOf(rows, 'B', 0) < 20,
        '#4488-E: рвётся хвост дня, как и раньше', '(дни B: ' + daysOf(rows, 'B').join(',') + ')');
})();

// ── F: хвост подтягивается — задание планируется ВСЕМИ своими частями ───────────────────────
// Ровно случай тикета: голова (1 проход) в выбранном дне, хвост (11 проходов) — в следующем.
// Перенос обязан планировать задание ЦЕЛИКОМ: 12 проходов на выбранном дне, хвоста нет.
(function () {
    var BASE = new Date(2026, 6, 29, 0, 0, 0, 0).getTime();
    var DAY0 = Math.floor(BASE / 1000) + 8 * 3600;
    function qc(id, runs, off, firstPart, fixed) {
        return { id: id, slitter: { id: '1' }, materialId: 'M1', winding: 'OUT', batchId: 'B1',
                 knifeWidths: [100], knifeCount: 1, rollerWidth: 100, plannedRuns: runs,
                 isFoil: false, fixed: !!fixed, status: '', firstPartId: firstPart,
                 planDate: String(DAY0 + off) };
    }
    // H — голова на дне 0 (1 проход), T — её продолжение на дне 1 (11 проходов).
    // Сосед N набивает выбранный день почти до потолка — без правила голова снова раскололась бы.
    var cuts = [qc('H', 1, 0, 'H', true), qc('T', 11, 86400, 'H', false), qc('N', 40, 600, null, false)];
    var perPass = { H: 10, T: 10, N: 10 };
    var ops = P.planCutOperations(cuts, {
        planBaseMidnightMs: BASE, weights: {}, times: TIMES,
        dayStartMin: 480, dayEndMin: 480 + CAP, dayEndHourMin: 480 + CAP,
        maxOverworkCutsMin: 5, maxOverworkTuneMin: 10, lunchStartMin: 740, lunchDurationMin: 40,
        gapFill: true, preserveOrder: false, slotPlacement: true, firstCutSetup: false,
        prevSetupBySlitter: {}, intraDayResequence: true, perPassByCut: perPass,
        slitterIds: ['1'], dueDayByCut: {}, dueKeyByCut: {},
        dayAnchorByCut: { H: 0 }, wholeDayByCut: { H: 0 }
    });
    var upd = (ops.updates || []).filter(function (u) { return String(u.cutId) === 'H'; })[0];
    var headRuns = upd ? Number(upd.plannedRuns) : 0;
    var contOfH = (ops.creates || []).filter(function (c) { return String(c.parentCutId) === 'H'; });
    assert(headRuns === 12,
        '#4488-F: задание спланировано ВСЕМИ частями — 12 проходов на голове (хвост подтянут)',
        '(проходов у H: ' + headRuns + ')');
    assert(contOfH.length === 0,
        '#4488-F: хвоста в следующем дне не осталось — продолжений не создаётся',
        '(создано продолжений: ' + contOfH.length + ')');
    var delT = (ops.deletes || []).map(String).indexOf('T') >= 0;
    assert(delT, '#4488-F: прежняя запись хвоста удаляется', '(deletes: ' + (ops.deletes || []).join(',') + ')');
    // И уступил именно сосед: его хвост уехал на следующий день.
    var contOfN = (ops.creates || []).filter(function (c) { return String(c.parentCutId) === 'N'; });
    assert(contOfN.length > 0,
        '#4488-F: место освободил СОСЕД — его остаток уехал продолжением на следующий день',
        '(продолжений N: ' + contOfN.length + ')');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
if (passed !== total) process.exitCode = 1;
