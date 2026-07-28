// #4464 — ЖЁСТКОЕ ПРАВИЛО (ТЗ §15): зафиксированные (🔒) задания одного дня держатся МОНОЛИТОМ.
//
//   • между двумя 🔒 одного дня ничего не вставляем;
//   • взаимный порядок 🔒 внутри дня автоматика не меняет;
//   • ДВИГАТЬ цепочку 🔒 целиком — можно;
//   • на СТЫКЕ ДНЕЙ правило не действует (хвост дня N и голова дня N+1 монолита не образуют);
//   • ручной перенос 🗓 кладёт задание туда, куда велел оператор: «в начало дня» / «в конец дня»;
//     «по весу» может встать вплотную к 🔒, но не между двумя 🔒.
//
// ДО ПРАВКИ (боевой код):
//   вход  A → F1🔒 → F2🔒 → B   →   план  F2 → F1 → B → A     (🔒 переставлены местами)
//   вход  F1🔒 → F2🔒 → X       →   план  F2 → F1 → X
//   вход  P → Q → M🔒 «в конец дня»  →  план  M → Q → P       (оказалось в НАЧАЛЕ)
//
// Run with: node experiments/atex-pp-4464-fixed-block.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var api = require('../download/atex/js/production-planning.js');
var P = api.planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var BASE = new Date(2026, 6, 1, 0, 0, 0, 0).getTime();     // ср 01.07.2026 = день 0
var D0 = Math.round(BASE / 1000) + 8 * 3600;               // день 0, 08:00
var DAY = 86400;
function W(w, n) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
// min — минуты от 08:00 дня 0 (хранимый planStart задаёт текущий порядок); knives = [ширина, число]
// firstPartId = свой id — как в базе у самостоятельного задания: иначе mergeContinuationChains
// принимает одинаковые конфигурации за звенья одной цепочки (легаси-эвристика по подписи).
function cut(id, mat, knives, min, fixed, sid) {
    return { id: id, slitter: { id: sid || '1' }, materialId: mat, winding: 'OUT', batchId: 'B' + mat,
             knifeWidths: W(knives[0], knives[1]), knifeCount: knives[1], rollerWidth: 0,
             plannedRuns: 1, isFoil: false, planDate: String(D0 + min * 60), status: '',
             fixed: !!fixed, firstPartId: id };
}
function plan(cuts, extra) {
    var pp = {}; cuts.forEach(function (c) { pp[String(c.id)] = 30; });
    var anchor = {};
    cuts.forEach(function (c) {
        if (!c.fixed) return;
        anchor[String(c.id)] = Math.floor((Number(c.planDate) * 1000 - BASE) / 86400000);
    });
    var o = { planBaseMidnightMs: BASE, weights: {}, times: { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 },
        dayStartMin: 480, dayEndMin: 480 + 450, dayEndHourMin: 480 + 450,
        maxOverworkCutsMin: 5, maxOverworkTuneMin: 10, lunchStartMin: 740, lunchDurationMin: 40,
        gapFill: true, preserveOrder: false, slotPlacement: true, firstCutSetup: false,
        prevSetupBySlitter: {}, intraDayResequence: true, perPassByCut: pp, slitterIds: ['1'],
        dueDayByCut: {}, dueKeyByCut: {}, dayAnchorByCut: anchor };
    for (var k in (extra || {})) o[k] = extra[k];
    var ops = P.planCutOperations(cuts, o);
    // Записываются только ИЗМЕНИВШИЕСЯ записи (#3427) — неизменные держат хранимый planStart.
    var byId = {};
    cuts.forEach(function (c) { byId[String(c.id)] = Number(c.planDate); });
    (ops.updates || []).forEach(function (u) { byId[String(u.cutId)] = Number(u.planStartTs); });
    (ops.deletes || []).forEach(function (id) { delete byId[String(id)]; });
    return Object.keys(byId).map(function (id) { return { id: id, ts: byId[id] }; })
        .sort(function (a, b) { return a.ts - b.ts; });
}
function ids(rows) { return rows.map(function (r) { return r.id; }); }
function dayOf(row) { return Math.floor((row.ts * 1000 - BASE) / 86400000); }
function ofDay(rows, d) { return ids(rows.filter(function (r) { return dayOf(r) === d; })); }

// ── 1. Взаимный порядок 🔒 в дне автоматика не меняет ────────────────────────────────────
(function () {
    var day = [cut('A', 'MA', [30, 29], 0), cut('F1', 'MB', [150, 7], 60, true),
               cut('F2', 'MC', [60, 15], 120, true), cut('B', 'MA', [30, 29], 180)];
    var got = ids(plan(day));
    assert(got.indexOf('F1') < got.indexOf('F2'), 'взаимный порядок 🔒 сохранён (F1 раньше F2)',
        '(' + got.join(' → ') + ')');
})();

// ── 2. Между двумя 🔒 одного дня свободное задание не встаёт ────────────────────────────
// X — та же конфигурация, что F1: по весу ему выгоднее всего именно между F1 и F2.
(function () {
    var day = [cut('F1', 'MB', [150, 7], 0, true), cut('F2', 'MC', [60, 15], 60, true),
               cut('X', 'MB', [150, 7], 120)];
    var got = ids(plan(day));
    var iF1 = got.indexOf('F1'), iF2 = got.indexOf('F2'), iX = got.indexOf('X');
    assert(Math.abs(iF1 - iF2) === 1, '🔒 остались соседями (монолит не разорван)', '(' + got.join(' → ') + ')');
    assert(!(iX > Math.min(iF1, iF2) && iX < Math.max(iF1, iF2)), 'свободное X не влезло между 🔒',
        '(' + got.join(' → ') + ')');
})();

// ── 3. Монолит из трёх 🔒 — ни порядка, ни вставок ──────────────────────────────────────
(function () {
    var day = [cut('Y', 'MA', [30, 29], 0), cut('F1', 'MB', [150, 7], 60, true),
               cut('F2', 'MC', [60, 15], 120, true), cut('F3', 'MB', [150, 7], 180, true),
               cut('Z', 'MC', [60, 15], 240)];
    var got = ids(plan(day));
    var i1 = got.indexOf('F1'), i2 = got.indexOf('F2'), i3 = got.indexOf('F3');
    assert(i2 === i1 + 1 && i3 === i2 + 1, 'три 🔒 идут подряд и в исходном порядке',
        '(' + got.join(' → ') + ')');
})();

// ── 4. Цепочку 🔒 ДВИГАТЬ можно — правило запрещает только разрыв ───────────────────────
// Свободные Y и Z (одна конфигурация) выгодно поставить рядом: монолит уезжает целиком.
(function () {
    var day = [cut('Y', 'MA', [30, 29], 0), cut('F1', 'MB', [150, 7], 60, true),
               cut('F2', 'MB', [150, 7], 120, true), cut('Z', 'MA', [30, 29], 180)];
    var got = ids(plan(day));
    var i1 = got.indexOf('F1'), i2 = got.indexOf('F2');
    assert(i2 === i1 + 1, 'монолит цел', '(' + got.join(' → ') + ')');
    assert(Math.abs(got.indexOf('Y') - got.indexOf('Z')) === 1,
        'свободные одной конфигурации сгруппированы — монолит подвинулся целиком', '(' + got.join(' → ') + ')');
})();

// ── 5. На СТЫКЕ ДНЕЙ правило не действует ───────────────────────────────────────────────
// F0🔒 — хвост дня 0, F1🔒 — голова дня 1: это НЕ монолит, между ними день.
(function () {
    var cuts = [cut('F0', 'MB', [150, 7], 0, true), cut('F1', 'MC', [60, 15], 24 * 60, true),
                cut('X', 'MB', [150, 7], 24 * 60 + 60)];
    var rows = plan(cuts);
    assert(ofDay(rows, 0).indexOf('F0') >= 0 && ofDay(rows, 1).indexOf('F1') >= 0,
        'через границу дней 🔒 остаются на своих днях', '(д0: ' + ofDay(rows, 0).join(',') + ' | д1: ' + ofDay(rows, 1).join(',') + ')');
    var chrono = ids(rows);
    assert(chrono.indexOf('F0') < chrono.indexOf('X') && chrono.indexOf('X') < chrono.indexOf('F1'),
        'через границу дней свободное задание МОЖЕТ стоять между двумя 🔒', '(' + chrono.join(' → ') + ')');
})();

// ── 6. Перенос 🗓: «в начало дня» и «в конец дня» кладут туда, куда велел оператор ──────
(function () {
    var startCase = [cut('P', 'MA', [30, 29], 60), cut('Q', 'MA', [30, 29], 120),
                     cut('M', 'MB', [150, 7], 0, true)];
    var gotStart = ids(plan(startCase, { pinDayPosByCut: { M: 'start' } }));
    assert(gotStart[0] === 'M', 'перенос «в начало дня» — задание первое', '(' + gotStart.join(' → ') + ')');

    var endCase = [cut('P', 'MA', [30, 29], 0), cut('Q', 'MA', [30, 29], 60),
                   cut('M', 'MB', [150, 7], 300, true)];
    var gotEnd = ids(plan(endCase, { pinDayPosByCut: { M: 'end' } }));
    assert(gotEnd[gotEnd.length - 1] === 'M', 'перенос «в конец дня» — задание последнее',
        '(' + gotEnd.join(' → ') + ')');
})();

// ── 7. Перенос «по весу» — вплотную к 🔒 можно, между двумя 🔒 нельзя ───────────────────
(function () {
    var day = [cut('F1', 'MB', [150, 7], 0, true), cut('F2', 'MC', [60, 15], 60, true),
               cut('M', 'MB', [150, 7], 120)];   // «по весу» — задание НЕ приколото (#4221)
    var got = ids(plan(day, { dayLockByCut: { M: 0 } }));
    var iF1 = got.indexOf('F1'), iF2 = got.indexOf('F2'), iM = got.indexOf('M');
    assert(!(iM > Math.min(iF1, iF2) && iM < Math.max(iF1, iF2)), '«по весу» не встаёт между двумя 🔒',
        '(' + got.join(' → ') + ')');
    assert(Math.abs(iM - iF1) === 1 || Math.abs(iM - iF2) === 1, '«по весу» встаёт вплотную к 🔒',
        '(' + got.join(' → ') + ')');
})();

// ── 8. Контроль: день с ОДНИМ 🔒 оптимизируется как прежде ──────────────────────────────
(function () {
    var day = [cut('A', 'MA', [30, 29], 0), cut('F', 'MB', [150, 7], 60, true),
               cut('B', 'MA', [30, 29], 120)];
    var got = ids(plan(day));
    assert(Math.abs(got.indexOf('A') - got.indexOf('B')) === 1,
        'одиночное 🔒 не мешает сгруппировать одинаковые свободные', '(' + got.join(' → ') + ')');
})();

// ── 9. Слой размещения: точка между двумя 🔒 одного дня недопустима ─────────────────────
(function () {
    function slot(id, mat, knives, fixed, work) {
        return { kind: 'cut', id: id, slitterId: '1', materialId: mat, winding: 'OUT', batchId: 'B' + mat,
                 knifeWidths: W(knives[0], knives[1]), knifeCount: knives[1], rollerWidth: 0,
                 isFoil: false, plannedRuns: 1, workMin: work, fixed: !!fixed, firstPartId: id };
    }
    var CTX = { settings: {}, times: { KNIFE: 30, MATERIAL_WINDING: 15 }, capacityMin: 450, slitterId: '1' };
    var sameDay = [slot('F1', 'MB', [150, 7], true, 60), slot('F2', 'MC', [60, 15], true, 60)];
    assert(P.scorePosition(sameDay, 1, slot('X', 'MB', [150, 7], false, 30), CTX) === null,
        'точка МЕЖДУ двумя 🔒 одного дня — недопустима');
    assert(P.scorePosition(sameDay, 2, slot('X', 'MB', [150, 7], false, 30), CTX) !== null,
        'точка ПОСЛЕ монолита — допустима');
    assert(P.scorePosition(sameDay, 0, slot('X', 'MB', [150, 7], false, 30), CTX) !== null,
        'точка ПЕРЕД монолитом — допустима');
    // Те же два 🔒, но разнесённые по дням (ёмкость 100 мин → второе уезжает в день 1).
    var crossDay = [slot('F1', 'MB', [150, 7], true, 60), slot('F2', 'MC', [60, 15], true, 60)];
    var ctxTight = { settings: {}, times: { KNIFE: 30, MATERIAL_WINDING: 15 }, capacityMin: 100, slitterId: '1' };
    assert(P.scorePosition(crossDay, 1, slot('X', 'MB', [150, 7], false, 10), ctxTight) !== null,
        'на стыке дней точка между двумя 🔒 — допустима');
})();

// ── 10. Шлюз: правило FIXED_BLOCK ловит нарушение в общем страже ────────────────────────
(function () {
    // Хранимый план дня: F1🔒(08:00) F2🔒(09:00) X(10:00). Операции предлагают вставить X между 🔒.
    var snapshot = [
        { id: 'F1', slitterId: '1', planStartTs: D0, fixed: true },
        { id: 'F2', slitterId: '1', planStartTs: D0 + 3600, fixed: true },
        { id: 'X',  slitterId: '1', planStartTs: D0 + 7200, fixed: false }
    ];
    var ctx = {
        planSnapshot: function () { return snapshot; },
        isFixedCut: function (id) { return String(id) === 'F1' || String(id) === 'F2'; },
        dayKeyOfTs: function (ts) { return Number(P.planDateDayKey(String(ts))); }
    };
    var bad = { updates: [{ cutId: 'X', slitterId: '1', planStartTs: D0 + 1800 },
                          { cutId: 'F2', slitterId: '1', planStartTs: D0 + 5400 }], creates: [], deletes: [] };
    var vBad = P.checkPlanInvariants(bad, ctx, 'auto').filter(function (v) { return v.rule === 'FIXED_BLOCK'; });
    assert(vBad.length > 0, 'шлюз ловит вставку между двумя 🔒', '(' + JSON.stringify(vBad) + ')');

    var swap = { updates: [{ cutId: 'F1', slitterId: '1', planStartTs: D0 + 3600 },
                           { cutId: 'F2', slitterId: '1', planStartTs: D0 }], creates: [], deletes: [] };
    var vSwap = P.checkPlanInvariants(swap, ctx, 'auto').filter(function (v) { return v.rule === 'FIXED_BLOCK'; });
    assert(vSwap.length > 0, 'шлюз ловит перестановку 🔒 местами', '(' + JSON.stringify(vSwap) + ')');

    // Сдвиг монолита целиком (X встал первым, 🔒 сохранили порядок и соседство) — нарушения нет.
    var ok = { updates: [{ cutId: 'X', slitterId: '1', planStartTs: D0 },
                         { cutId: 'F1', slitterId: '1', planStartTs: D0 + 3600 },
                         { cutId: 'F2', slitterId: '1', planStartTs: D0 + 7200 }], creates: [], deletes: [] };
    var vOk = P.checkPlanInvariants(ok, ctx, 'auto').filter(function (v) { return v.rule === 'FIXED_BLOCK'; });
    assert(vOk.length === 0, 'сдвиг цепочки 🔒 целиком нарушением НЕ считается', '(' + JSON.stringify(vOk) + ')');

    // Стык дней: F2 уехало бы на следующий день — это другое правило (FIXED_CUT_DAY), FIXED_BLOCK молчит.
    var nextDay = { updates: [{ cutId: 'X', slitterId: '1', planStartTs: D0 + 1800 },
                              { cutId: 'F2', slitterId: '1', planStartTs: D0 + DAY }], creates: [], deletes: [] };
    var vNext = P.checkPlanInvariants(nextDay, ctx, 'auto').filter(function (v) { return v.rule === 'FIXED_BLOCK'; });
    assert(vNext.length === 0, 'на стыке дней монолита нет — FIXED_BLOCK молчит', '(' + JSON.stringify(vNext) + ')');
})();

console.log('\n' + passed + '/' + total + ' passed');
