// Тесты для ideav/crm#4487 — перенос «По весу» не встаёт рядом с той же комбинацией ножей.
//
// СИМПТОМ (боевой снимок, Ср 29.07.2026): в дне уже стои́т задание с ножами 110×8, оператор
// переносит в этот день ещё одно с ТЕМИ ЖЕ ножами, положение «По весу» — а оно встаёт через два
// чужих задания. В дне две смены ножей на 110 вместо одной; видно и по числу полос: 22 → 8 → 35
// (ножи то снимают, то доставляют — рост полос дороже убыли, ТЗ §8 п.1).
//
// ПРИЧИНА. В форме переноса галка «Зафиксировать задание» стои́т ПО УМОЛЧАНИЮ, и при ней
// `moveCutToDay` не отдаёт задание слою размещения вовсе:
//     if (position === 'weight') { if (!fix) moveScope.weightPositionCutIds = [id]; }
// Без `weightPositionCutIds` нет `dayLockByCut`, а `computeSlotPlacement` классифицирует задание
// по `c.fixed` → оно уходит в `fixedSlots` (неподвижный сосед) и НИ РАЗУ не оценивается
// `scorePosition`. Позицию в дне задаёт плейсхолдер-«Дата план», а не веса. То есть «По весу»
// при выбранной галке не работает — молча.
//
//   A — задание с ТОЙ ЖЕ комбинацией ножей встаёт РЯДОМ с ней (сосед по дню), а не через чужие;
//   B — переналадка дня от этого меньше на одну смену ножей;
//   C — галка «Зафиксировать» держит ДЕНЬ (это её работа, #4390) — задание остаётся в своём дне;
//   D — «В начало дня» / «В конец дня» по-прежнему кладут ровно туда, куда велел оператор
//       (позицию выбирает оператор, а не веса).
//
// Run with: node experiments/atex-production-planning-4487.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0, KNIFE_MOVE: 2, CLEANUP_SHIFT: 30 };
var BASE = new Date(2026, 6, 29, 0, 0, 0, 0).getTime();
var DAY0 = Math.floor(BASE / 1000) + 8 * 3600;
function K(pairs) { var a = []; pairs.forEach(function (p) { for (var i = 0; i < p[1]; i++) a.push(p[0]); }); return a; }

// День 29.07 на Станке 1 (по скрину тикета): 40×22, 110×8, 25×35 — плюс переносимое 110×8.
function cut(id, mat, win, knives, roller, startOff, fixed) {
    return { id: id, slitter: { id: '1' }, materialId: mat, winding: win, batchId: 'B1',
             knifeWidths: knives, knifeCount: knives.length, rollerWidth: roller,
             plannedRuns: 1, isFoil: false, fixed: !!fixed, status: '',
             planDate: String(DAY0 + startOff) };
}
// A — 40мм×22, B — 110мм×8 (та же комбинация, что у переносимого), C — 25мм×35.
function dayCuts() {
    return [
        cut('A', 'MR194',  'OUT', K([[40, 22]]),  40,   0),
        cut('B', 'MWR118', 'OUT', K([[110, 8]]), 110, 600),
        cut('C', 'MR194',  'OUT', K([[25, 35]]),  25, 1200)
    ];
}
// Переносимое: MW308 IN, ножи 110×8 — РОВНО как у B (наладки ножей между ними нет).
// Плейсхолдер-старт — как его кладёт moveCutToDay «По весу» (голова дня), fixed=1 — галка стои́т.
function movedCut(startOff, fixed) {
    return cut('X', 'MW308', 'IN', K([[110, 8]]), 110, startOff, fixed);
}

function runPlan(cuts, extra) {
    var perPass = {}, anchor = {};
    cuts.forEach(function (c) {
        perPass[String(c.id)] = 60;
        if (c.fixed) anchor[String(c.id)] = 0;   // 🔒 держит свой день (dayAnchorByCut)
    });
    var opts = { planBaseMidnightMs: BASE, weights: {}, times: TIMES,
        dayStartMin: 480, dayEndMin: 480 + 450, dayEndHourMin: 480 + 450,
        maxOverworkCutsMin: 5, maxOverworkTuneMin: 10, lunchStartMin: 740, lunchDurationMin: 40,
        gapFill: true, preserveOrder: false, slotPlacement: true, firstCutSetup: false,
        prevSetupBySlitter: {}, intraDayResequence: true, perPassByCut: perPass,
        slitterIds: ['1'], dueDayByCut: {}, dueKeyByCut: {}, dayAnchorByCut: anchor };
    Object.keys(extra || {}).forEach(function (k) { opts[k] = extra[k]; });
    return P.planCutOperations(cuts, opts);
}
function orderOf(ops) {
    return (ops.updates || []).slice()
        .sort(function (a, b) { return Number(a.planStartTs) - Number(b.planStartTs); })
        .map(function (u) { return String(u.cutId); });
}
function dayOf(ops, id) {
    var u = (ops.updates || []).filter(function (x) { return String(x.cutId) === id; })[0];
    if (!u) return null;
    return Math.floor((Number(u.planStartTs) * 1000 - BASE) / 86400000);
}
// Минуты наладки дня по фактическому порядку (первая резка — с нуля).
function changeover(cuts, ids) {
    var by = {}; cuts.forEach(function (c) { by[String(c.id)] = c; });
    var t = 0, prev = null;
    ids.forEach(function (id) { if (prev) t += P.changeoverCost(prev, by[id], TIMES); prev = by[id]; });
    return t;
}
function neighbours(order, id) {
    var i = order.indexOf(id);
    return [order[i - 1] || null, order[i + 1] || null];
}

// ── A/B/C: «По весу» + «Зафиксировать» ──────────────────────────────────────────────────────
(function () {
    var cuts = dayCuts().concat([movedCut(-60, true)]);   // плейсхолдер «в голову дня», 🔒
    var ops = runPlan(cuts);
    var ord = orderOf(ops);
    var nb = neighbours(ord, 'X');
    assert(nb[0] === 'B' || nb[1] === 'B',
        '#4487-A: перенесённое 110×8 стои́т РЯДОМ с таким же 110×8 (B)', '(' + ord.join(' → ') + ')');

    // Галка «Зафиксировать» держит ДЕНЬ и не должна удорожать день: цена та же, что без неё.
    var free = dayCuts().concat([movedCut(-60, false)]);
    var ordFree = orderOf(runPlan(free, { dayLockByCut: { X: 0 } }));
    var withFix = changeover(cuts, ord), withoutFix = changeover(free, ordFree);
    assert(withFix === withoutFix,
        '#4487-B: с галкой «Зафиксировать» наладка дня та же, что без неё',
        '(' + withFix + ' и ' + withoutFix + ' мин; на main было 120 против 90)');

    assert(dayOf(ops, 'X') === 0,
        '#4487-C: галка «Зафиксировать» держит ДЕНЬ — X остался в выбранном дне (#4390)',
        '(день ' + dayOf(ops, 'X') + ')');
})();

// ── A-контроль: без галки (задание подвижное) — тот же результат ─────────────────────────────
(function () {
    var cuts = dayCuts().concat([movedCut(-60, false)]);
    var ops = runPlan(cuts, { dayLockByCut: { X: 0 } });   // «По весу» без фиксации (#4221)
    var ord = orderOf(ops);
    var nb = neighbours(ord, 'X');
    assert(nb[0] === 'B' || nb[1] === 'B',
        '#4487-A контроль: без галки «По весу» ставит X рядом с B (так было и раньше)',
        '(' + ord.join(' → ') + ')');
})();

// ── D: «В начало дня» / «В конец дня» — позицию выбирает ОПЕРАТОР, не веса ───────────────────
(function () {
    var cutsEnd = dayCuts().concat([movedCut(3000, true)]);
    var opsEnd = runPlan(cutsEnd, { pinDayPosByCut: { X: 'end' } });
    var ordEnd = orderOf(opsEnd);
    assert(ordEnd[ordEnd.length - 1] === 'X',
        '#4487-D: «В конец дня» ставит X последним, весам вопреки', '(' + ordEnd.join(' → ') + ')');

    var cutsStart = dayCuts().concat([movedCut(-60, true)]);
    var opsStart = runPlan(cutsStart, { pinDayPosByCut: { X: 'start' } });
    var ordStart = orderOf(opsStart);
    assert(ordStart[0] === 'X',
        '#4487-D: «В начало дня» ставит X первым', '(' + ordStart.join(' → ') + ')');
})();

// ── E: как на боевой — у станка есть заправка с прошлого дня, часть дня уже 🔒 ───────────────
// Заправка = ножи A (40×22), поэтому день открывает A. Дальше §8 обязан поставить X рядом с B.
(function () {
    var cuts = [
        cut('A', 'MR194',  'OUT', K([[40, 22]]),  40,   0),
        cut('B', 'MWR118', 'OUT', K([[110, 8]]), 110, 600, true),   // 🔒, как на скрине
        cut('C', 'MR194',  'OUT', K([[25, 35]]),  25, 1200),
        cut('X', 'MW308',  'IN',  K([[110, 8]]), 110,  -60, true)    // перенесённое «По весу» + 🔒
    ];
    var carry = { materialId: 'MR194', winding: 'OUT', knifeWidths: K([[40, 22]]), rollerWidth: 40 };
    var ops = runPlan(cuts, { prevSetupBySlitter: { '1': carry } });
    var ord = orderOf(ops);
    var nb = neighbours(ord, 'X');
    assert(nb[0] === 'B' || nb[1] === 'B',
        '#4487-E: с заправкой станка и соседом 🔒 перенесённое всё равно встаёт рядом с B',
        '(' + ord.join(' → ') + ')');
    assert(ord[0] === 'A',
        '#4487-E: день открывает задание, продолжающее заправку станка (#4288)', '(' + ord.join(' → ') + ')');
})();

// ── F: гарантия #3792 цела — 🔒 не вытесняется с СВОЕГО дня ──────────────────────────────────
// День забит под завязку: пропустить свободную вперёд нельзя, иначе 🔒 не влезет (fixedRoomAfter).
(function () {
    var cuts = [
        cut('A', 'MR194',  'OUT', K([[40, 22]]),  40,    0),
        cut('C', 'MR194',  'OUT', K([[25, 35]]),  25,  600),
        cut('X', 'MW308',  'IN',  K([[110, 8]]), 110, 1200, true)
    ];
    var perPass = { A: 200, C: 200, X: 200 };   // 3×200 + наладки ≫ 450 мин дня
    var ops = runPlan(cuts, { perPassByCut: perPass });
    assert(dayOf(ops, 'X') === 0,
        '#4487-F: при тесной ёмкости 🔒 остаётся на СВОЁМ дне (гарантия #3792 не тронута)',
        '(день ' + dayOf(ops, 'X') + ')');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
if (passed !== total) process.exitCode = 1;
