// #4497 (ТЗ §15) — ПЕРЕД ЗАФИКСИРОВАННЫМ (🔒) ЗАДАНИЕМ АВТОМАТИКА НИЧЕГО НЕ СТАВИТ.
//
// СИМПТОМ (issue #4497): «кнопка Сгенерировать вставляет задание в начало дня, двигая весь
// паровоз зафиксированных заданий после него». Замок 🔒 держал ДЕНЬ, но не место в дне: новое
// задание садилось в голову дня, и все 🔒 дня уезжали на своё время + его длительность.
//
// ПРАВИЛО. Если задание зафиксировано, вставлять можно только ПОСЛЕ него:
//   1. в дне — точка вставки перед 🔒 недопустима (как уже недопустима точка между двумя 🔒, #4464);
//   2. на стыке дней — задание рвётся по потолку, только если голова следующего дня НЕ 🔒; иначе
//      уезжает ЦЕЛИКОМ на ближайшее свободное место (этот или другой станок), потому что хвост
//      разбиения занял бы голову дня и сдвинул бы 🔒.
// Ручной перенос 🗓 правило не ограничивает (ТЗ §15: ручное действие оператора не ограничено;
// #4487/#4491 — задание, которое оператор несёт «по весу», вправе встроиться туда, где §8 дешевле).
//
// Что проверяем:
//   A — упаковщик: новое задание не встаёт в начало дня с паровозом 🔒; времена старта 🔒 те же;
//   B — упаковщик: свободное не обгоняет 🔒 своего дня, но СТОЯВШЕЕ перед ней в хранимом плане
//       остаётся на месте (пути ручного порядка / «Пересчитать наладку» день не переворачивают);
//   C — слой размещения §8: точка перед 🔒 её дня даёт null, задание уходит ПОСЛЕ 🔒;
//       на стыке дней (🔒 в следующем дне) точка законна — там между ними ночь;
//   D — стык дней: задание не рвётся в день, чья голова 🔒 — уезжает целиком; без 🔒 в следующем
//       дне разбиение прежнее (регресс-контроль #4304/#4467);
//   E — реестр PP_INVARIANTS (FIXED_NO_PUSH) на всех входах автоматики: create-хвост и приезжее
//       задание перед 🔒 — нарушение; стоявшее перед ней раньше, вторая 🔒, переезд 🔒 в другой
//       день и ручной перенос — не нарушение;
//   F — упаковщик: ручной перенос 🗓 встраивает задание перед 🔒 по порядку §8 (правило не про него).
//
// Run with: node experiments/atex-pp-4497-fixed-insert-after.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// Настройка обнулена: порядок дня решает правило, а не арифметика переналадки.
var TIMES = { KNIFE: 0, KNIFE_MOVE: 0, MATERIAL_WINDING: 0, BETWEEN_CUTS: 0 };
var CARRY = { materialId: 'M1', winding: 'OUT', knifeWidths: [50], rollerWidth: 0 };

// c._work — минут на проход; c._anchor — день 🔒 (замок дня); c._day/_ts — ХРАНИМЫЙ день и время старта.
function cut(id, work, o) {
    o = o || {};
    return { id: id, materialId: 'M1', winding: 'OUT', batchId: 'B1', knifeWidths: [50], knifeCount: 1,
             rollerWidth: 0, isFoil: false, plannedRuns: o.runs || 1, fixed: !!o.fixed,
             planDate: o.ts != null ? String(o.ts) : undefined,
             _work: work, _anchor: o.fixed ? (o.anchor != null ? o.anchor : 0) : null, _day: o.day };
}
function pack(cuts, opts) {
    var perPass = {}, runs = {}, anchor = {}, storedDay = {};
    cuts.forEach(function (c) {
        perPass[String(c.id)] = c._work;
        runs[String(c.id)] = Number(c.plannedRuns) || 1;
        if (c._anchor != null) anchor[String(c.id)] = c._anchor;
        if (c._day != null) storedDay[String(c.id)] = c._day;
    });
    var o = {
        dayStartMin: 480, dayEndMin: 480 + 450, dayEndHourMin: 480 + 450,
        times: TIMES, perPassByCut: perPass, runsByCut: runs, dayAnchorByCut: anchor,
        storedDayByCut: storedDay, carryPrevSetup: CARRY, gapFill: true, orderAuthoritative: true
    };
    Object.keys(opts || {}).forEach(function (k) { o[k] = opts[k]; });
    return P.splitMachineQueue(cuts, o);
}
// Порядок дня (без setup-only хвостов): [{id, day, start}] в хронологии.
function layout(segs) {
    return segs.slice().filter(function (s) { return !s.setupOnly; })
        .sort(function (a, b) { return (a.dayOffset - b.dayOffset) || (a.windowStartMin - b.windowStartMin); })
        .map(function (s) { return { id: String(s.cutId), day: s.dayOffset, start: s.windowStartMin, runs: s.runs }; });
}
function ids(segs, day) {
    return layout(segs).filter(function (s) { return day == null || s.day === day; }).map(function (s) { return s.id; });
}
function startOf(segs, id) {
    var l = layout(segs).filter(function (s) { return s.id === String(id); })[0];
    return l ? l.start : null;
}

// ── A. Новое задание не встаёт в начало дня с паровозом 🔒 ────────────────────────────────────
(function () {
    var F1 = cut('F1', 90, { fixed: true, anchor: 0, day: 0, ts: 1000 });
    var F2 = cut('F2', 90, { fixed: true, anchor: 0, day: 0, ts: 2000 });
    var X = cut('X', 60, {});                                  // новое задание: хранимого дня нет
    var alone = pack([F1, F2]);                                // паровоз 🔒 сам по себе
    var withNew = pack([X, F1, F2]);                           // §8 поставил новое ПЕРВЫМ
    assert(ids(withNew, 0).join(' → ') === 'F1 → F2 → X',
        'A1 новое задание встаёт ПОСЛЕ паровоза 🔒, а не в голову дня', '(' + ids(withNew, 0).join(' → ') + ')');
    assert(startOf(withNew, 'F1') === startOf(alone, 'F1') && startOf(withNew, 'F2') === startOf(alone, 'F2'),
        'A2 времена старта 🔒 не изменились',
        '(F1 ' + startOf(alone, 'F1') + '→' + startOf(withNew, 'F1') + ', F2 ' + startOf(alone, 'F2') + '→' + startOf(withNew, 'F2') + ')');
})();

// ── B. Свободное не обгоняет 🔒, но стоявшее перед ней — остаётся ─────────────────────────────
(function () {
    var A = cut('A', 90, {});                                  // приезжее/новое (хранимого дня нет)
    var B = cut('B', 90, {});
    var L = cut('L', 90, { fixed: true, anchor: 0, day: 0, ts: 5000 });
    assert(ids(pack([A, B, L]), 0).join(' → ') === 'L → A → B',
        'B1 §8 поставил свободные раньше 🔒 — упаковщик кладёт 🔒 первой', '(' + ids(pack([A, B, L]), 0).join(' → ') + ')');
    // Хранимый план: A стоял в этом дне ПЕРЕД 🔒 (planDate раньше) — его место не переворачиваем.
    var A2 = cut('A', 90, { day: 0, ts: 4000 });
    assert(ids(pack([A2, B, L]), 0).join(' → ') === 'A → L → B',
        'B2 стоявшее перед 🔒 в хранимом плане остаётся перед ней', '(' + ids(pack([A2, B, L]), 0).join(' → ') + ')');
})();

// ── C. Слой размещения §8: точка перед 🔒 её дня недопустима ──────────────────────────────────
(function () {
    // ts — ХРАНИМОЕ время старта («Дата план», сек): у 🔒 оно и есть её место в дне.
    var TS0 = Math.floor(new Date(2026, 6, 29, 8, 0, 0).getTime() / 1000);
    function S(id, o) {
        o = o || {};
        return P.slotFromCut({ id: id, materialId: 'M1', winding: 'OUT', knifeWidths: [50], knifeCount: 1,
                               rollerWidth: 0, plannedRuns: 1, isFoil: false, fixed: !!o.fixed, workMin: o.wm,
                               planDate: o.ts != null ? String(TS0 + o.ts) : undefined });
    }
    var ctx = { settings: {}, capacityMin: 450, times: TIMES, perPass: 0, baseMidnightMs: new Date(2026, 6, 29).getTime() };
    var arr = [S('A', { wm: 90, ts: 0 }), S('L', { fixed: true, wm: 90, ts: 5400 })];   // оба в дне 0
    assert(P.scorePosition(arr, 0, S('X', { wm: 60 }), ctx) === null,
        'C1 точка в голове дня перед 🔒 — недопустима (null)');
    assert(P.scorePosition(arr, 1, S('X', { wm: 60 }), ctx) === null,
        'C2 точка между свободным и 🔒 того же дня — недопустима (null)');
    assert(P.scorePosition(arr, 2, S('X', { wm: 60 }), ctx) !== null,
        'C3 точка ПОСЛЕ 🔒 — допустима');
    // Стык дней: 🔒 лежит в дне 1 (день 0 добит) — точка в конце дня 0 законна.
    var full = [S('A', { wm: 400, ts: 0 }), S('L', { fixed: true, wm: 90, ts: 86400 })];
    var sc = P.scorePosition(full, 1, S('X', { wm: 40 }), ctx);
    assert(sc !== null && sc.dayOffset === 0, 'C4 на стыке дней (🔒 в следующем дне) точка законна',
        '(' + (sc ? 'день ' + sc.dayOffset : 'null') + ')');
    // Ручной перенос «по весу» (замок дня/станка) правилом не ограничен.
    var moved = P.slotFromCut({ id: 'M', materialId: 'M1', winding: 'OUT', knifeWidths: [50], knifeCount: 1,
                               rollerWidth: 0, plannedRuns: 1, workMin: 60 });
    moved.lockDay = 0; moved.lockSlitter = 'm1';
    assert(P.scorePosition(arr, 0, moved, ctx) !== null, 'C5 ручной перенос: точка перед 🔒 остаётся допустимой');
    // Задание не теряется: когда все точки перед 🔒 закрыты, оно уходит в конец очереди станка.
    var occ = P.seedOccupancy([P.slotFromCut({ id: 'A', slitter: { id: 'm1' }, materialId: 'M1', winding: 'OUT',
                                               knifeWidths: [50], knifeCount: 1, rollerWidth: 0, plannedRuns: 1, workMin: 90,
                                               planDate: String(TS0) }),
                               P.slotFromCut({ id: 'L', slitter: { id: 'm1' }, materialId: 'M1', winding: 'OUT',
                                               knifeWidths: [50], knifeCount: 1, rollerWidth: 0, plannedRuns: 1,
                                               fixed: true, workMin: 90, planDate: String(TS0 + 5400) })], [], ['m1']);
    var best = P.placeSlot(occ, S('X', { wm: 60 }), { settings: {}, capacityMin: 450, times: TIMES, perPass: 0,
                                                      baseMidnightMs: ctx.baseMidnightMs });
    assert(best && best.index === 2 && occ.byMachine.m1.map(function (s) { return s.id; }).join(',') === 'A,L,X',
        'C6 placeSlot кладёт задание ПОСЛЕ 🔒 (не перед)', '(' + occ.byMachine.m1.map(function (s) { return s.id; }).join(',') + ')');
})();

// ── D. Стык дней: не рвём задание в день, чья голова 🔒 ───────────────────────────────────────
(function () {
    // День 0: свободное H на 300 мин. Y — 6 проходов × 50 мин: 150 влезает в день 0, 150 — нет.
    // День 1 несёт 🔒 M (замок дня 1) → рвать Y нельзя: хвост занял бы голову дня 1.
    var H = cut('H', 300, {});
    var Y = cut('Y', 50, { runs: 6 });
    var M = cut('M', 90, { fixed: true, anchor: 1, day: 1, ts: 9000 });
    var segs = pack([H, Y, M]);
    assert(ids(segs, 0).join(' → ') === 'H',
        'D1 задание не рвётся в день с 🔒 — в дне 0 остаётся только H', '(' + ids(segs, 0).join(' → ') + ')');
    assert(ids(segs, 1).join(' → ') === 'M → Y',
        'D2 задание уехало ЦЕЛИКОМ и встало ПОСЛЕ 🔒 дня 1', '(' + ids(segs, 1).join(' → ') + ')');
    var yseg = layout(segs).filter(function (s) { return s.id === 'Y'; });
    assert(yseg.length === 1 && yseg[0].runs === 6, 'D3 задание не разорвано: один сегмент, все 6 проходов',
        '(сегментов ' + yseg.length + ', проходов ' + (yseg[0] || {}).runs + ')');
    // Регресс-контроль: без 🔒 в следующем дне разбиение по потолку прежнее (#4304/#4467).
    var free = pack([H, Y, cut('M', 90, { day: 1, ts: 9000 })]);
    var yfree = layout(free).filter(function (s) { return s.id === 'Y'; });
    assert(yfree.length === 2 && yfree[0].day === 0,
        'D4 без 🔒 в следующем дне задание рвётся по потолку как прежде',
        '(сегментов ' + yfree.length + ', первый день ' + (yfree[0] || {}).day + ')');
})();

// ── E. Реестр PP_INVARIANTS: FIXED_NO_PUSH на всех входах автоматики ──────────────────────────
(function () {
    var DAY = 20260729, NEXT = 20260730;
    function ts(dayKey, hh, mm) {
        var y = Math.floor(dayKey / 10000), m = Math.floor(dayKey / 100) % 100, d = dayKey % 100;
        return Date.UTC(y, m - 1, d, hh, mm || 0);
    }
    var dayKeyOf = function (t) {
        var d = new Date(Number(t));
        return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    };
    // Хранимый план Станка 1 на 29.07: свободное A (08:00), 🔒 F (10:00), свободное B (12:00).
    var SNAP = [
        { id: 'A', slitterId: '1', planStartTs: ts(DAY, 8), fixed: false, chainId: '' },
        { id: 'F', slitterId: '1', planStartTs: ts(DAY, 10), fixed: true, chainId: '' },
        { id: 'B', slitterId: '1', planStartTs: ts(DAY, 12), fixed: false, chainId: '' },
        { id: 'G', slitterId: '1', planStartTs: ts(NEXT, 8), fixed: true, chainId: '' },
        { id: 'Y', slitterId: '1', planStartTs: ts(NEXT, 10), fixed: false, chainId: '' }
    ];
    var CUT_DAY = { A: DAY, F: DAY, B: DAY, G: NEXT, Y: NEXT };
    function ctx(extra) {
        var c = {
            planSnapshot: function () { return SNAP.map(function (r) { var o = {}; Object.keys(r).forEach(function (k) { o[k] = r[k]; }); return o; }); },
            isFixedCut: function (id) { return String(id) === 'F' || String(id) === 'G'; },
            dayKeyOfCut: function (id) { return CUT_DAY[String(id)] == null ? null : CUT_DAY[String(id)]; },
            dayKeyOfTs: function (t) { return dayKeyOf(t); }
        };
        Object.keys(extra || {}).forEach(function (k) { c[k] = extra[k]; });
        return c;
    }
    function ops() { return { updates: [], deletes: [], creates: [] }; }
    function pushed(o, c) {
        return P.checkPlanInvariants(o, c || ctx(), 'auto').filter(function (v) { return v.rule === 'FIXED_NO_PUSH'; });
    }
    ['generate', 'order', 'recalc-setup', 'auto-split'].forEach(function (input) {
        var o = ops();
        o.updates.push({ cutId: 'B', slitterId: '1', planStartTs: ts(DAY, 9) });   // B — перед 🔒 F
        var v = pushed(o);
        assert(v.length === 1 && v[0].cutId === 'F',
            'E1 × ' + input + ': задание, стоявшее ПОСЛЕ 🔒, встало перед ней — нарушение', '(' + v.length + ')');
    });
    (function () {
        var o = ops();
        o.creates.push({ parentCutId: 'Y', slitterId: '1', planStartTs: ts(NEXT, 7, 30) });   // хвост в голову дня с 🔒 G
        var v = pushed(o);
        assert(v.length === 1 && v[0].cutId === 'G', 'E2 хвост разбиения перед 🔒 следующего дня — нарушение', '(' + v.length + ')');
    })();
    (function () {
        var o = ops();
        o.updates.push({ cutId: 'A', slitterId: '1', planStartTs: ts(DAY, 8, 30) });   // A стоял перед F и остался
        assert(pushed(o).length === 0, 'E3 стоявшее перед 🔒 в хранимом плане остаётся перед — не нарушение');
    })();
    (function () {
        var o = ops();
        o.updates.push({ cutId: 'G', slitterId: '1', planStartTs: ts(DAY, 9) });   // приезжая 🔒 перед 🔒 F
        assert(pushed(o).length === 0, 'E4 🔒 сдвинута другой 🔒 — не нарушение (переезд по потолку, #4467/#4491)');
    })();
    (function () {
        var o = ops();
        o.updates.push({ cutId: 'B', slitterId: '1', planStartTs: ts(DAY, 9) });
        var v = P.checkPlanInvariants(o, ctx({ isManualMoveCut: function (id) { return String(id) === 'B'; } }), 'auto')
            .filter(function (x) { return x.rule === 'FIXED_NO_PUSH'; });
        assert(v.length === 0, 'E5 ручной перенос оператора правилом не ограничен');
    })();
    (function () {
        var o = ops();
        o.updates.push({ cutId: 'F', slitterId: '1', planStartTs: ts(NEXT, 14) });   // 🔒 уехала в другой день
        o.updates.push({ cutId: 'B', slitterId: '1', planStartTs: ts(DAY, 9) });
        assert(pushed(o).length === 0, 'E6 🔒 уехала в другой день — судит FIXED_CUT_DAY, не это правило');
    })();
    (function () {
        // Идемпотентная пересборка: хвост той же ЦЕПОЧКИ уже стоял в этом дне перед 🔒.
        var snap = SNAP.concat([{ id: 'Y2', slitterId: '1', planStartTs: ts(NEXT, 7, 30), fixed: false, chainId: 'Y' }]);
        var c = ctx({ planSnapshot: function () { return snap; } });
        var o = ops();
        o.creates.push({ parentCutId: 'Y', slitterId: '1', planStartTs: ts(NEXT, 7, 30) });
        o.deletes.push('Y2');
        var v = P.checkPlanInvariants(o, c, 'auto').filter(function (x) { return x.rule === 'FIXED_NO_PUSH'; });
        assert(v.length === 0, 'E7 хвост цепочки, уже стоявшей перед 🔒, пересоздан на том же месте — не нарушение');
    })();
    (function () {
        var o = ops();
        o.updates.push({ cutId: 'B', slitterId: '1', planStartTs: ts(DAY, 9) });
        var v = P.checkPlanInvariants(o, ctx(), 'human').filter(function (x) { return x.rule === 'FIXED_NO_PUSH'; });
        assert(v.length === 0, 'E8 правило — про автоматику: человеку не выставляется');
    })();
    (function () {
        var o = ops();
        o.updates.push({ cutId: 'B', slitterId: '1', planStartTs: ts(DAY, 9) });
        var v = P.checkPlanInvariants(o, ctx(), 'auto').filter(function (x) { return x.rule === 'FIXED_NO_PUSH'; })[0];
        assert(v && v.slitterId === '1' && v.dayKey === DAY && (v.beforeIds || []).indexOf('B') >= 0,
            'E9 нарушение несёт СТРУКТУРУ (станок, день, кто встал перед 🔒) — фразу собирает интерфейс',
            '(' + JSON.stringify(v) + ')');
    })();
})();

// ── F. Ручной перенос 🗓: правило не про него ─────────────────────────────────────────────────
(function () {
    var A = cut('A', 90, { day: 0, ts: 1000 });
    var L = cut('L', 90, { fixed: true, anchor: 0, day: 0, ts: 2000 });
    var X = cut('X', 60, {});                                   // его переносит оператор «по весу»
    // §8 поставил X перед 🔒 — ручной перенос вправе там встать (#4487/#4491).
    var segs = pack([A, X, L], { wholeDayByCut: { X: 0 } });
    assert(ids(segs, 0).join(' → ') === 'A → X → L',
        'F1 ручной перенос встраивается перед 🔒 по порядку §8', '(' + ids(segs, 0).join(' → ') + ')');
    // Та же расстановка БЕЗ ручного переноса — X уходит за 🔒.
    assert(ids(pack([A, X, L]), 0).join(' → ') === 'A → L → X',
        'F2 без ручного переноса то же задание встаёт после 🔒', '(' + ids(pack([A, X, L]), 0).join(' → ') + ')');
})();

console.log('\n' + passed + '/' + total + ' passed');
