// #4542 — ЖЁСТКОЕ ПРАВИЛО (ТЗ §15): автоматика НЕ ОБГОНЯЕТ зафиксированные (🔒) задания.
//
// СИМПТОМ (боевое, ateh, 31.07.2026). Диспетчер добавил задания по позициям на 3.08 — они «всплыли»
// в 31.07 перед зафиксированными. Станко-день 20260731 стал 580 мин при потолке 460 ровно на
// занятость двух пришедших заданий. В журнале видно и решение слоя размещения, и итог упаковщика:
//   ВЫБРАН: станок 1277 поз 18 → вес 15 (день~20260803)
//   РЕАЛЬНЫЙ день (splitMachineQueue, арбитр §12): 0
// Удержать задания на 3.08 удалось только фиксацией — то есть замок работал, а всё незамкнутое
// автоматика тянула в ранние дни, обгоняя 🔒 более поздних дней (gap-fill «тянем будущее вперёд»,
// #3739/#4469). Правило #4497 защищало место 🔒 ТОЛЬКО ВНУТРИ ЕЁ ДНЯ и такой обгон не ловило.
//
// ПРАВИЛО (решение заказчика 31.07.2026): подвижное задание не встаёт РАНЬШЕ 🔒 своего станка.
// Новая работа («Сгенерировать», «по позициям») идёт ПОСЛЕ последнего замка станка.
// Исключения (прежние, ТЗ §15): задание, стоявшее перед этой 🔒 в ХРАНИМОМ плане, своё место
// сохраняет; ручное действие оператора правилом не связано.
//
//   A — задание, хранящееся ПОЗЖЕ 🔒, не уезжает в день раньше неё (боевой случай);
//   B — новое задание (места в плане ещё нет) встаёт после ПОСЛЕДНЕГО 🔒 станка;
//   C — стоявшее ПЕРЕД 🔒 в хранимом плане остаётся в СВОЁМ дне (правило не выталкивает его за замок);
//   D — ручной перенос оператора правилом не связан;
//   E — на станке БЕЗ 🔒 ранние дни по-прежнему набиваются (регресс #3739/#4469);
//   F — правило есть в реестре инвариантов (§15) и ловит нарушение на шлюзе записи.
//
// Run with: node experiments/atex-pp-4542-no-overtake-fixed.test.js

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

var BASE = new Date(2026, 6, 30, 0, 0, 0, 0).getTime();   // чт 30.07.2026 = день 0
var D0 = Math.round(BASE / 1000) + 8 * 3600;
var DAY = 86400, CAP = 450;
function W(w, n) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
// dayOff/min — ХРАНИМОЕ место задания (planDate); dayOff === null — задания в плане ещё нет.
function cut(id, mat, kn, dayOff, min, fixed, runs, sid) {
    return { id: id, slitter: { id: sid || '1' }, materialId: mat, winding: 'OUT', batchId: 'B' + mat,
             knifeWidths: W(kn[0], kn[1]), knifeCount: kn[1], rollerWidth: 0,
             plannedRuns: runs, isFoil: false, status: '', fixed: !!fixed, firstPartId: id,
             planDate: dayOff == null ? '' : String(D0 + dayOff * DAY + min * 60) };
}
function plan(cuts, perPass, extra) {
    var pp = {}, anchor = {}, due = {};
    cuts.forEach(function (c) {
        pp[String(c.id)] = perPass[String(c.id)] != null ? perPass[String(c.id)] : 10;
        due[String(c.id)] = 30;                       // сроки далеко — на раскладку не влияют
        if (c.fixed && c.planDate !== '') anchor[String(c.id)] = Math.floor((Number(c.planDate) * 1000 - BASE) / 86400000);
    });
    var sids = {}; cuts.forEach(function (c) { sids[String(c.slitter.id)] = 1; });
    var o = { planBaseMidnightMs: BASE, weights: {}, times: { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 },
        dayStartMin: 480, dayEndMin: 480 + CAP, dayEndHourMin: 480 + CAP,
        maxOverworkCutsMin: 5, maxOverworkTuneMin: 10, lunchStartMin: 740, lunchDurationMin: 40,
        gapFill: true, preserveOrder: false, slotPlacement: true, firstCutSetup: false,
        prevSetupBySlitter: {}, intraDayResequence: true, perPassByCut: pp, slitterIds: Object.keys(sids),
        dueDayByCut: due, dueKeyByCut: {}, dayAnchorByCut: anchor };
    for (var k in (extra || {})) o[k] = extra[k];
    var ops = P.planCutOperations(cuts, o);
    var byId = {}, sidOf = {};
    cuts.forEach(function (c) {
        if (c.planDate !== '') byId[String(c.id)] = Number(c.planDate);
        sidOf[String(c.id)] = String(c.slitter.id);
    });
    (ops.updates || []).forEach(function (u) {
        byId[String(u.cutId)] = Number(u.planStartTs);
        if (u.slitterId != null) sidOf[String(u.cutId)] = String(u.slitterId);
    });
    (ops.deletes || []).forEach(function (id) { delete byId[String(id)]; });
    return { byId: byId, sidOf: sidOf, ops: ops };
}
function dayOfTs(ts) { return Math.floor((ts * 1000 - BASE) / 86400000); }
function place(out, id) {
    var ts = out.byId[String(id)];
    return ts == null ? null : { ts: ts, day: dayOfTs(ts), sid: out.sidOf[String(id)] };
}
function layout(out) {
    return Object.keys(out.byId).sort(function (a, b) { return out.byId[a] - out.byId[b]; })
        .map(function (id) { return id + '@д' + dayOfTs(out.byId[id]); }).join(' ');
}

// Боевая форма: день 0 (30.07) — 🔒 с запасом, день 1 (31.07) — 🔒 плотно,
// X1/X2 хранятся на дне 4 (03.08) и никого не обгоняют.
function fieldCase(extra) {
    var cuts = [
        cut('D0a', 'MA', [110, 8], 0, 0, true, 4),
        cut('D0b', 'MA', [110, 8], 0, 120, true, 4),
        cut('F1', 'MB', [90, 10], 1, 0, true, 2),
        cut('F2', 'MC', [60, 15], 1, 65, true, 2),
        cut('F3', 'MD', [150, 7], 1, 100, true, 2),
        cut('X1', 'MB', [90, 10], 4, 0, false, 1),
        cut('X2', 'MC', [60, 15], 4, 60, false, 2)
    ];
    var pp = { D0a: 20, D0b: 20, F1: 10, F2: 10, F3: 8, X1: 10, X2: 11 };
    return { cuts: cuts, out: plan(cuts, pp, extra) };
}

// ── A: задание с более позднего дня не обгоняет 🔒 ───────────────────────────────────────────
(function () {
    var f = fieldCase();
    var x1 = place(f.out, 'X1'), x2 = place(f.out, 'X2');
    var lastFixedDay = 1;   // 🔒F1..F3 стоят на дне 1
    assert(x1 && x1.day >= lastFixedDay, '#4542-A: X1 (хранился на дне 4) не уехал раньше 🔒 дня 1',
        '(день ' + (x1 && x1.day) + ' | ' + layout(f.out) + ')');
    assert(x2 && x2.day >= lastFixedDay, '#4542-A: X2 — тоже', '(день ' + (x2 && x2.day) + ')');
    // и внутри дня 🔒 остались впереди
    var f3 = place(f.out, 'F3');
    assert(!x1 || !f3 || x1.day > f3.day || x1.ts > f3.ts,
        '#4542-A: и в самом дне 🔒 X1 стои́т после неё, а не перед');
})();

// ── B: новое задание встаёт после ПОСЛЕДНЕГО 🔒 станка ──────────────────────────────────────
(function () {
    var cuts = [
        cut('F1', 'MB', [90, 10], 0, 0, true, 2),
        cut('F2', 'MC', [60, 15], 2, 0, true, 2),
        cut('NEW', 'MB', [90, 10], null, 0, false, 2)      // места в плане ещё нет
    ];
    var out = plan(cuts, { F1: 10, F2: 10, NEW: 10 });
    var n = place(out, 'NEW'), f2 = place(out, 'F2');
    assert(n && f2 && (n.day > f2.day || n.ts > f2.ts),
        '#4542-B: новое задание встало ПОСЛЕ последнего 🔒 станка (день 2), а не в свободный день 0',
        '(' + layout(out) + ')');
})();

// ── C: стоявшее перед 🔒 в хранимом плане не выталкивается за неё ────────────────────────────
// Место E ВНУТРИ дня — дело #3792/#4461 (🔒 своего дня берётся раньше свободных). Здесь важно
// другое: новое правило не имеет права УВЕЗТИ E из его дня за день замка.
(function () {
    var cuts = [
        cut('E', 'MB', [90, 10], 0, 0, false, 2),          // стои́т ПЕРЕД 🔒 и в хранимом плане
        cut('F1', 'MB', [90, 10], 0, 120, true, 2),
        cut('F2', 'MC', [60, 15], 1, 0, true, 2)
    ];
    var out = plan(cuts, { E: 10, F1: 10, F2: 10 });
    var e = place(out, 'E'), f1 = place(out, 'F1');
    assert(e && f1 && e.day === f1.day && e.day === 0,
        '#4542-C: E осталось в своём дне 0 — правило не переворачивает уже сложившиеся дни',
        '(' + layout(out) + ')');
})();

// ── D: ручной перенос оператора правилом не связан (ТЗ §15) ─────────────────────────────────
(function () {
    var cuts = [
        cut('F1', 'MB', [90, 10], 2, 0, true, 2),
        cut('M', 'MB', [90, 10], 4, 0, false, 2)
    ];
    var lock = { M: 0 }, mm = { M: 1 };
    var out = plan(cuts, { F1: 10, M: 10 },
        { dayLockByCut: lock, manualMoveByCut: mm, wholeDayCutIds: ['M'], pinCutIds: ['M'] });
    var m = place(out, 'M');
    assert(m && m.day === 0,
        '#4542-D: перенесённое оператором задание встало в выбранный день 0, хотя 🔒 стои́т на дне 2',
        '(' + layout(out) + ')');
})();

// ── E: на станке БЕЗ 🔒 ранние дни по-прежнему набиваются ────────────────────────────────────
(function () {
    var cuts = [
        cut('A', 'MB', [90, 10], 0, 0, false, 2),
        cut('B', 'MB', [90, 10], 4, 0, false, 2)           // хранится на дне 4, замков нет
    ];
    var out = plan(cuts, { A: 10, B: 10 });
    var b = place(out, 'B');
    assert(b && b.day === 0,
        '#4542-E: без 🔒 задание с дня 4 по-прежнему подтягивается в день 0 (#3739/#4469 цел)',
        '(' + layout(out) + ')');
})();

// ── F: правило в реестре инвариантов (§15) ───────────────────────────────────────────────────
(function () {
    var reg = P.invariants || [];
    var rule = reg.filter(function (r) { return r && r.id === 'FIXED_NO_OVERTAKE'; })[0];
    assert(!!rule, '#4542-F: правило FIXED_NO_OVERTAKE есть в реестре ТЗ §15');
    if (!rule) return;
    assert(rule.actor === 'auto' && /§15/.test(String(rule.tz || '')),
        '#4542-F: оно про автоматику и сослано на §15', '(' + rule.actor + ', ' + rule.tz + ')');

    // Шлюз записи видит обгон: X стои́т на дне 0, 🔒F — на дне 1, в хранимом плане X был на дне 4.
    var d = function (day, min) { return (D0 + day * DAY + (min || 0) * 60); };
    var snapshot = [
        { id: 'F', slitterId: '1', planStartTs: d(1), fixed: true },
        { id: 'X', slitterId: '1', planStartTs: d(4), fixed: false }
    ];
    var ctx = {
        planSnapshot: function () { return snapshot; },
        dayKeyOfTs: function (ts) { return 20260730 + Math.floor((ts * 1000 - BASE) / 86400000); },
        isFixedCut: function (id) { return String(id) === 'F'; },
        isManualMoveCut: function () { return false; }
    };
    var ops = { updates: [{ cutId: 'X', planStartTs: d(0), slitterId: '1' }], creates: [], deletes: [] };
    var got = rule.check(ops, ctx) || [];
    assert(got.length === 1 && String(got[0].cutId) === 'X',
        '#4542-F: шлюз ловит обгон замка на любом пути записи',
        '(' + JSON.stringify(got.map(function (v) { return v.cutId + ':' + v.rule; })) + ')');

    var okOps = { updates: [{ cutId: 'X', planStartTs: d(2), slitterId: '1' }], creates: [], deletes: [] };
    assert((rule.check(okOps, ctx) || []).length === 0,
        '#4542-F: после 🔒 — не нарушение (правило не кричит на ровном месте)');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
if (passed !== total) process.exitCode = 1;
