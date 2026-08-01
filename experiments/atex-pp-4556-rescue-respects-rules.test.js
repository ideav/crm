// #4556 — «Задание влезло в начало дня, нарушив сразу 3 святых правила»
//
// СИМПТОМ (боевое, ateh, 01.08.2026, трасса ideav.ru-1785571538039.log). Оператор удалил задание;
// хвостовой шаг удаления (`runDeleteCutTask` → `autoSequenceQueue(SETUP, preserveOrder)`) пересобрал
// очередь — и в начало станко-дня встало задание, нарушив жёсткие правила ТЗ §15 разом:
//   ⛔ #4497: зафиксированное задание сдвинуто вставкой — перед зафиксированным 655426 встало: 652452
//   ⚠️ CHAIN_CONTIGUOUS #655426: части задания разорваны — между 655366 и 655426 вклинилось 652452
//   ⛔ #4497 станко-день ДЛИННЕЕ смены по ХРАНИМЫМ минутам (Пн 03.08.2026 — 526 мин при потолке 450)
// В той же трассе прямо перед нарушением работал доп. проход спасения просрочки:
//   [pp-slot] #4200 доп. проход #4118 (пересчёт наладки / ручной порядок): переносов 1
//   [pp-slot]   ↳ перенос просроченного 655576: станок 1282 → 1277
//
// ПРИЧИНА. `relocateOverdueReal` (#4118) перебирает точки вставки САМ и проверяет лишь ДВА запрета
// (`canInsertAt` — §9, `pushesFixedSameDay` — #4497). Вес точки он спрашивает у `scorePosition`, но
// НУЛЕВОЙ ответ («точка запрещена») трактует как `penalty = 0`:
//     var sc = scorePosition(tarr, idx, slot, …);
//     var penalty = (sc ? sc.weight : 0) + moveWeight(ctx, sid, tid);
// Все прочие потребители пишут `if (!sc) continue;`. Из-за этого спасение просрочки:
//   • проходит МИМО запретов, которые знает только `scorePosition`, — «не обгонять 🔒» (#4542
//     `overtakesFixed`) и «не вставать между двумя 🔒 одного дня» (#4464, монолит);
//   • и вдобавок ПРЕДПОЧИТАЕТ запрещённую точку: 0 — самый дешёвый вес из возможных, поэтому в
//     сравнении она обыгрывает любое законное место.
// Просрочка — ИНФОРМАЦИЯ (панель #4161, лог #4200), замок 🔒 — ЖЁСТКОЕ ПРАВИЛО, и правило сильнее
// срока: ровно так уже решено и для заморозки дня, и для `pushesFixedSameDay` (см. #4497 в коде).
//
//   A — РЕПРО: просроченное задание НЕ обгоняет 🔒 более позднего дня, даже ценой своей просрочки;
//   B — РЕПРО: при живой законной альтернативе рескью уходит НА НЕЁ, а не в запрещённую точку;
//   C — регресс #4118: законное спасение просрочки (свободный станок) продолжает работать;
//   D — регресс: запрет по-прежнему знает про исключения — стоявшее ПЕРЕД 🔒 в хранимом плане
//       на том же станке спасается на своё же место (правило его не выталкивает).
//
// Run with: node experiments/atex-pp-4556-rescue-respects-rules.test.js

process.env.TZ = 'UTC';
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var ZERO = { KNIFE: 0, KNIFE_MOVE: 0, MATERIAL_WINDING: 0, BETWEEN_CUTS: 0 };   // чистая ёмкость/срок
var BASE = Date.UTC(2026, 6, 1);                 // 2026-07-01 (день 0)
var K0 = P.dayKeyFromOffset(BASE, 0);
var K1 = P.dayKeyFromOffset(BASE, 1);
var DAY = 86400, T0 = Math.floor(BASE / 1000) + 8 * 3600;   // 08:00 дня 0, сек

// резка-слот: wm — рабочие минуты, due — срок YYYYMMDD; storedDay/storedMin — ХРАНИМОЕ место
// («Дата план»), по нему правила решают, чьё место в дне защищать и кто перед кем стоял.
function C(id, wm, due, opts) {
    opts = opts || {};
    return P.slotFromCut({ id: id, slitter: { id: opts.sid || 'm1' },
        materialId: 'M1', winding: 'OUT', knifeWidths: [50], knifeCount: 1,
        rollerWidth: 0, plannedRuns: 1, workMin: wm, fixed: !!opts.fixed,
        planDate: opts.storedDay == null ? '' : String(T0 + opts.storedDay * DAY + (opts.storedMin || 0) * 60) }, due);
}
function cutObj(id) { return { id: id, slitter: { id: 'x' }, materialId: 'M1', winding: 'OUT',
    knifeWidths: [50], knifeCount: 1, rollerWidth: 0, plannedRuns: 1 }; }

// realDayFn(orderIds, machineId) → { id: dayOffset } — РЕАЛЬНЫЙ день реальной упаковкой
// splitMachineQueue (окно 100 мин, обеда/переналадок нет). perPass — минуты одного прохода.
function makeRealDayFn(perPass) {
    return function (orderIds, _machineId) {
        var runs = {}; orderIds.forEach(function (id) { runs[id] = 1; });
        var segs = P.splitMachineQueue(orderIds.map(cutObj),
            { dayStartMin: 0, dayEndMin: 100, times: ZERO, perPassByCut: perPass, runsByCut: runs });
        var d = {}; segs.forEach(function (s) { var o = Number(s.dayOffset), id = String(s.cutId);
            if (d[id] == null || o < d[id]) d[id] = o; });
        return d;
    };
}
function ctxOf() {
    return { settings: {}, times: ZERO, capacityMin: 100, baseMidnightMs: BASE,
             feasibleMachine: function () { return true; } };
}
function idsAt(occ, sid) {
    return (occ.byMachine[sid] || []).filter(function (s) { return s && s.kind === 'cut'; })
        .map(function (s) { return String(s.id); });
}
// Станко-день: A (день 0) → 🔒 F (день 1) → просроченное U в хвосте дня 1.
// Спасти U можно только встав ПЕРЕД 🔒 F — а это запрещено (#4542): дни РАЗНЫЕ, поэтому
// pushesFixedSameDay (#4497) молчит, и ловит точку только scorePosition.
function occOvertake(extraMachines) {
    var by = { m1: [C('A', 90, K1, { storedDay: 0, storedMin: 0 }),
                    C('F', 90, K1, { storedDay: 1, storedMin: 0, fixed: true }),
                    C('U', 5, K0, { storedDay: 1, storedMin: 60 })] };
    (extraMachines || []).forEach(function (sid) { by[sid] = []; });
    return { byMachine: by };
}
var DUE_OVERTAKE = { A: 1, F: 1, U: 0 };
var PP_OVERTAKE = { A: 90, F: 90, U: 5 };

// ── A) РЕПРО #4556: спасение просрочки НЕ обгоняет 🔒 ────────────────────────────────────────────
(function () {
    var realDayFn = makeRealDayFn(PP_OVERTAKE);
    var occ = occOvertake();
    assert(realDayFn(['A', 'F', 'U'], 'm1').U > 0,
        'A0 ДО: U (срок день 0) реально уезжает на день ' + realDayFn(['A', 'F', 'U'], 'm1').U + ' → просрочено');
    assert(P.scorePosition(occ.byMachine.m1.slice(0, 2), 0, occ.byMachine.m1[2],
            { settings: {}, times: ZERO, capacityMin: 100, baseMidnightMs: BASE, slitterId: 'm1' }) === null,
        'A1 точка ПЕРЕД 🔒 F запрещена правилом (scorePosition → null: обгон 🔒, #4542)');

    P.relocateOverdueReal(occ, DUE_OVERTAKE, realDayFn, ctxOf());
    var m1 = idsAt(occ, 'm1');
    var uAt = m1.indexOf('U'), fAt = m1.indexOf('F');
    assert(uAt > fAt, 'A2 U осталось ПОСЛЕ 🔒 F — правило сильнее срока (ТЗ §15)',
        'm1 = [' + m1.join(', ') + ']');
})();

// ── B) РЕПРО #4556: при законной альтернативе рескью уходит на неё ──────────────────────────────
// Тот же расклад + свободный станок m3. Законная точка на m3 стои́т 3 (перенос на другой станок),
// запрещённая на m1 — тоже 3 (вес 0 + смена дня): запрещённая выигрывает по порядку перебора и
// забирает U себе. С фиксом сравниваются только законные точки, и U спасается на m3.
(function () {
    var realDayFn = makeRealDayFn(PP_OVERTAKE);
    var occ = occOvertake(['m3']);
    var res = P.relocateOverdueReal(occ, DUE_OVERTAKE, realDayFn, ctxOf());
    var m1 = idsAt(occ, 'm1');
    assert(m1.indexOf('U') < 0 || m1.indexOf('U') > m1.indexOf('F'),
        'B1 U не встало перед 🔒 F', 'm1 = [' + m1.join(', ') + ']');
    assert(idsAt(occ, 'm3').indexOf('U') >= 0,
        'B2 U спаслось на свободный станок m3 — законным местом (регресс #4118 цел)',
        'm3 = [' + idsAt(occ, 'm3').join(', ') + '], переносов ' + (res.moves || []).length);
})();

// ── C) РЕГРЕСС #4118: законное спасение просрочки продолжает работать ───────────────────────────
// m1 забит A,B (срок день 1), крошечное U (срок день 0) в конце реально переливается на день 1.
// Замков в дне нет — ни один запрет не мешает, и рескью обязан увести U в срок.
(function () {
    var realDayFn = makeRealDayFn({ A: 60, B: 60, U: 1 });
    var occ = { byMachine: { m1: [C('A', 60, K1), C('B', 60, K1), C('U', 1, K0)], m2: [] } };
    assert(realDayFn(['A', 'B', 'U'], 'm1').U > 0, 'C0 ДО: U реально просрочено');

    var res = P.relocateOverdueReal(occ, { A: 1, B: 1, U: 0 }, realDayFn, ctxOf());
    assert(res.moves.length > 0, 'C1 доп. проход #4118 перенёс просроченное (переносов ' + res.moves.length + ')');
    var realNow = {};
    Object.keys(occ.byMachine).forEach(function (k) {
        var d = realDayFn(idsAt(occ, k), k);
        Object.keys(d).forEach(function (id) { realNow[id] = d[id]; });
    });
    assert(realNow.U === 0, 'C2 U реально в срок (день ' + realNow.U + ' ≤ 0)',
        'm1 = [' + idsAt(occ, 'm1').join(', ') + '], m2 = [' + idsAt(occ, 'm2').join(', ') + ']');
})();

// ── D) РЕГРЕСС: исключение «стояло перед 🔒 в хранимом плане» живо ──────────────────────────────
// Тот же расклад, но ХРАНИМОЕ место U — раньше 🔒 F на ТОМ ЖЕ станке. Правило #4542 такое задание
// не выталкивает (его место не переворачиваем), и рескью обязан им воспользоваться.
(function () {
    var realDayFn = makeRealDayFn(PP_OVERTAKE);
    var occ = { byMachine: { m1: [C('A', 90, K1, { storedDay: 0, storedMin: 0 }),
                                  C('F', 90, K1, { storedDay: 1, storedMin: 30, fixed: true }),
                                  C('U', 5, K0, { storedDay: 0, storedMin: 10 })] } };
    P.relocateOverdueReal(occ, DUE_OVERTAKE, realDayFn, ctxOf());
    var m1 = idsAt(occ, 'm1');
    assert(m1.indexOf('U') < m1.indexOf('F'),
        'D1 стоявшее перед 🔒 в хранимом плане спаслось на своё место (исключение ТЗ §15 цело)',
        'm1 = [' + m1.join(', ') + ']');
})();

// ── E) ОДИН ПРЕДИКАТ НА ВСЕ ПРОХОДЫ ────────────────────────────────────────────────────────────
// Жадный проход (#4338, `greedyRefine`) веса не считает — он сравнивает штраф очереди, поэтому
// гейтом ему служит тот же `positionAllowed`, что и внутри `scorePosition`. Проверяем, что предикат
// действительно знает ВСЕ четыре жёстких запрета §15 и что `scorePosition` отбрасывает точку ровно
// тогда, когда предикат сказал «нельзя» (иначе проходы снова разъедутся).
(function () {
    var ctx = { settings: {}, times: ZERO, capacityMin: 100, baseMidnightMs: BASE, slitterId: 'm1' };
    var moving = C('U', 5, K0, { storedDay: 1, storedMin: 60 });
    var cases = [
        // §9: между двумя частями одной цепочки дробления
        { name: '§9 цепочка дробления', arr: (function () {
            var h = C('H', 20, K1, { storedDay: 0, storedMin: 0 });
            var t = C('H2', 20, K1, { storedDay: 0, storedMin: 30 }); t.firstPartId = h.firstPartId;
            return [h, t]; })(), idx: 1 },
        // #4542: обгон 🔒 (замок приземляется ДНЁМ ПОЗЖЕ — #4497 такое не ловит)
        { name: '#4542 обгон 🔒', arr: [C('A', 90, K1, { storedDay: 0, storedMin: 0 }),
                                        C('F', 90, K1, { storedDay: 1, storedMin: 0, fixed: true })], idx: 0 },
        // #4497: перед 🔒 в ЕЁ дне
        { name: '#4497 перед 🔒 её дня', arr: [C('F', 20, K1, { storedDay: 0, storedMin: 30, fixed: true })], idx: 0 },
        // #4464: внутрь 🔒-монолита одного дня
        { name: '#4464 🔒-монолит', arr: [C('F1', 20, K1, { storedDay: 0, storedMin: 0, fixed: true }),
                                          C('F2', 20, K1, { storedDay: 0, storedMin: 30, fixed: true })], idx: 1 }
    ];
    cases.forEach(function (c, i) {
        assert(P.positionAllowed(c.arr, c.idx, moving, ctx) === false,
            'E' + (i + 1) + ' positionAllowed запрещает точку — ' + c.name);
    });
    var agree = cases.every(function (c) { return P.scorePosition(c.arr, c.idx, moving, ctx) === null; })
        && P.positionAllowed([C('A', 20, K1, { storedDay: 0, storedMin: 0 })], 1, moving, ctx) === true
        && P.scorePosition([C('A', 20, K1, { storedDay: 0, storedMin: 0 })], 1, moving, ctx) !== null;
    assert(agree, 'E5 scorePosition отбрасывает точку РОВНО тогда, когда positionAllowed сказал «нельзя»');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
if (passed !== total) process.exit(1);
