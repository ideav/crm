// #4467 — ЖЁСТКОЕ ПРАВИЛО (ТЗ §15): день упирается в ПОТОЛОК (ёмкость + нахлёст), а не разбухает.
//
// Оператор сам отвечает за наполнение дня: напихал ручным переносом больше, чем влезает, — лишнее
// уезжает на следующий день. Вытесняются СНАЧАЛА незафиксированные, а когда их нет — и 🔒, не меняя
// своего порядка (#4464). 🔒, влезающий в ПУСТОЙ день, но не в остаток занятого, разрывается по
// потолку (#4304); не влезает ни один проход — уезжает целиком.
//
// ДО ПРАВКИ: ветка `fitsEmptyF` клала 🔒 на его день ЦЕЛИКОМ С ПЕРЕГРУЗОМ («замок дня абсолютен»,
// #4434 п.1) — день на 690 мин при потолке 455, а трасса лишь предупреждала.
//
// Run with: node experiments/atex-pp-4467-day-ceiling.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 };
var DAY_START = 480, CAP = 450;                 // окно смены 08:00–15:30 = 450 мин «резки»
var OVER_CUTS = 5, OVER_TUNE = 10;              // нахлёст (#3847): резка 5, настройка 10
function W(w, n) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
// runs × perPass минут работы; fixedDay — день якоря 🔒 (null → свободное задание)
function cut(id, mat, knives, runs, perPass, fixedDay) {
    return { id: id, materialId: mat, winding: 'OUT', batchId: 'B' + mat,
             knifeWidths: W(knives[0], knives[1]), knifeCount: knives[1], rollerWidth: 0,
             plannedRuns: runs, isFoil: false, fixed: fixedDay != null, firstPartId: id,
             _perPass: perPass, _fixedDay: fixedDay };
}
function pack(cuts, opts) {
    var perPass = {}, runs = {}, anchor = {};
    cuts.forEach(function (c) {
        perPass[String(c.id)] = c._perPass; runs[String(c.id)] = c.plannedRuns;
        if (c._fixedDay != null) anchor[String(c.id)] = c._fixedDay;
    });
    return P.splitMachineQueue(cuts, Object.assign({
        dayStartMin: DAY_START, dayEndMin: DAY_START + CAP, dayEndHourMin: DAY_START + CAP,
        maxOverworkCutsMin: OVER_CUTS, maxOverworkTuneMin: OVER_TUNE,
        times: TIMES, perPassByCut: perPass, runsByCut: runs, dayAnchorByCut: anchor,
        gapFill: true, orderAuthoritative: true, firstCutSetup: true
    }, opts || {}));
}
// Занятость станко-дня по сегментам: настройка + намотка (лидер внутри perPass) — как бейдж «(N мин)».
function loadByDay(segs) {
    var out = {};
    segs.forEach(function (s) {
        var d = Number(s.dayOffset);
        out[d] = (out[d] || 0) + (Number(s.setupMin) || 0) + (Number(s.durationMin) || 0);
    });
    return out;
}
function orderOfDay(segs, d) {
    return segs.filter(function (s) { return Number(s.dayOffset) === d; })
        .sort(function (a, b) { return a.windowStartMin - b.windowStartMin; })
        .map(function (s) { return String(s.cutId); });
}
var CEILING = CAP + OVER_TUNE;   // потолок дня с нахлёстом (455–460 в боевых настройках)

// ── 1. Напихали 🔒 больше ёмкости — день не разбухает ────────────────────────────────────
// Три 🔒 по 200 мин работы на день 0: 3 × (30 наладки + 200) = 690 при потолке 460.
(function () {
    var segs = pack([cut('F1', 'MA', [30, 29], 1, 200, 0),
                     cut('F2', 'MB', [60, 15], 1, 200, 0),
                     cut('F3', 'MC', [150, 7], 1, 200, 0)]);
    var load = loadByDay(segs);
    assert((load[0] || 0) <= CEILING + 1e-6, 'день 0 не превышает потолок',
        '(' + Math.round(load[0] || 0) + ' при потолке ' + CEILING + ')');
    assert(Object.keys(load).length > 1, 'лишнее уехало на следующий день',
        '(' + JSON.stringify(load) + ')');
})();

// ── 2. Вытесняются 🔒 в СВОЁМ порядке (#4464 не нарушено) ───────────────────────────────
(function () {
    var segs = pack([cut('F1', 'MA', [30, 29], 1, 200, 0),
                     cut('F2', 'MB', [60, 15], 1, 200, 0),
                     cut('F3', 'MC', [150, 7], 1, 200, 0)]);
    var chrono = segs.slice().sort(function (a, b) {
        return (a.dayOffset - b.dayOffset) || (a.windowStartMin - b.windowStartMin);
    }).map(function (s) { return String(s.cutId); });
    var seen = chrono.filter(function (id, i) { return chrono.indexOf(id) === i; });
    assert(seen.join(',') === 'F1,F2,F3', 'порядок 🔒 при вытеснении сохранён', '(' + seen.join(' → ') + ')');
})();

// ── 3. Сначала вытесняются НЕзафиксированные ────────────────────────────────────────────
// 🔒 F (300 мин) + свободные X, Y (по 150): всё вместе 690 > потолка. Уехать должны свободные.
(function () {
    var segs = pack([cut('F', 'MA', [30, 29], 1, 300, 0),
                     cut('X', 'MB', [60, 15], 1, 150, null),
                     cut('Y', 'MC', [150, 7], 1, 150, null)]);
    var d0 = orderOfDay(segs, 0);
    assert(d0.indexOf('F') >= 0, '🔒 осталось на своём дне', '(день 0: ' + d0.join(' → ') + ')');
    assert((loadByDay(segs)[0] || 0) <= CEILING + 1e-6, 'день 0 в пределах потолка',
        '(' + Math.round(loadByDay(segs)[0] || 0) + ')');
    assert(orderOfDay(segs, 1).length > 0, 'незафиксированное вытеснено на день 1',
        '(день 1: ' + orderOfDay(segs, 1).join(' → ') + ')');
})();

// ── 4. 🔒 влезает в ПУСТОЙ день, но не в остаток занятого — РВЁТСЯ по потолку ───────────
// F1🔒 занимает 345 мин дня, следом F2🔒 на 8×30 + 45 наладки (в пустой день влезло бы целиком).
(function () {
    var segs = pack([cut('F1', 'MA', [30, 29], 1, 300, 0),
                     cut('F2', 'MB', [60, 15], 8, 30, 0)]);
    var fSegs = segs.filter(function (s) { return String(s.cutId) === 'F2'; })
        .sort(function (a, b) { return a.dayOffset - b.dayOffset; });
    assert(fSegs.length >= 2, '🔒 разорвано по границе дня (голова + продолжение)',
        '(сегментов ' + fSegs.length + ')');
    assert(Number(fSegs[0].dayOffset) === 0 && Number(fSegs[0].runs) >= 1,
        'голова 🔒 с проходами осталась на своём дне', '(день ' + fSegs[0].dayOffset + ', проходов ' + fSegs[0].runs + ')');
    assert((loadByDay(segs)[0] || 0) <= CEILING + 1e-6, 'день 0 в пределах потолка',
        '(' + Math.round(loadByDay(segs)[0] || 0) + ')');
})();

// ── 5. В остаток дня не влезает НИ ОДНОГО прохода — 🔒 уезжает целиком ──────────────────
// F1🔒 съедает день (445 мин), F2🔒 — один проход 120 мин: 45 наладки + 120 в остаток не влезут.
(function () {
    var segs = pack([cut('F1', 'MA', [30, 29], 1, 400, 0),
                     cut('F2', 'MB', [60, 15], 1, 120, 0)]);
    var fSegs = segs.filter(function (s) { return String(s.cutId) === 'F2'; });
    assert(fSegs.length === 1, '🔒 не разрезано на «1 проход ради дня»', '(сегментов ' + fSegs.length + ')');
    assert(Number(fSegs[0].dayOffset) === 1, '🔒 уехало на следующий день целиком',
        '(день ' + fSegs[0].dayOffset + ')');
    assert((loadByDay(segs)[0] || 0) <= CEILING + 1e-6, 'день 0 в пределах потолка',
        '(' + Math.round(loadByDay(segs)[0] || 0) + ')');
})();

// ── 6. Контроль: место есть — 🔒 держит свой день целиком (#4434) ───────────────────────
(function () {
    var segs = pack([cut('X', 'MA', [30, 29], 1, 100, null),
                     cut('F', 'MB', [60, 15], 1, 120, 0)]);
    var fSegs = segs.filter(function (s) { return String(s.cutId) === 'F'; });
    assert(fSegs.length === 1 && Number(fSegs[0].dayOffset) === 0,
        '🔒 целиком на своём дне, когда место есть', '(сегментов ' + fSegs.length + ', день ' + fSegs[0].dayOffset + ')');
})();

// ── 7. Контроль: резка длиннее целой смены рвётся с головой ≥1 прохода (#4304) ──────────
(function () {
    var segs = pack([cut('F', 'MB', [60, 15], 10, 120, 0)]);   // 1200 мин работы — шире смены
    var fSegs = segs.filter(function (s) { return String(s.cutId) === 'F'; });
    assert(fSegs.length >= 2, 'длинная 🔒 разорвана по дням', '(сегментов ' + fSegs.length + ')');
    assert(Number(fSegs[0].dayOffset) === 0 && Number(fSegs[0].runs) >= 1,
        'голова с ≥1 проходом осталась на зафиксированном дне', '(проходов ' + fSegs[0].runs + ')');
    var load = loadByDay(segs);
    Object.keys(load).forEach(function (d) {
        assert(load[d] <= CEILING + 1e-6, 'день ' + d + ' в пределах потолка', '(' + Math.round(load[d]) + ')');
    });
})();

// ── 8. Шлюз: правило DAY_CAPACITY ловит переполненный день ──────────────────────────────
(function () {
    var ctxOver = {
        dayLoadMinutes: function () { return { '1|20260729': 690, '1|20260730': 120 }; },
        dayCapacityMin: function () { return CEILING; }
    };
    var v = P.checkPlanInvariants({ updates: [], creates: [], deletes: [] }, ctxOver, 'auto')
        .filter(function (x) { return x.rule === 'DAY_CAPACITY'; });
    assert(v.length === 1, 'шлюз ловит день сверх потолка', '(' + JSON.stringify(v) + ')');

    var ctxOk = {
        dayLoadMinutes: function () { return { '1|20260729': 455, '1|20260730': 120 }; },
        dayCapacityMin: function () { return CEILING; }
    };
    var v2 = P.checkPlanInvariants({ updates: [], creates: [], deletes: [] }, ctxOk, 'auto')
        .filter(function (x) { return x.rule === 'DAY_CAPACITY'; });
    assert(v2.length === 0, 'день в пределах потолка нарушением не считается', '(' + JSON.stringify(v2) + ')');

    var vNo = P.checkPlanInvariants({ updates: [], creates: [], deletes: [] }, {}, 'auto')
        .filter(function (x) { return x.rule === 'DAY_CAPACITY'; });
    assert(vNo.length === 0, 'без предикатов правило молчит (конвенция реестра)');
})();

// ── 9. Движок отдаёт нагрузку по дням вместе с планом (источник для шлюза) ──────────────
(function () {
    var BASE = new Date(2026, 6, 1, 0, 0, 0, 0).getTime();
    var D0 = Math.round(BASE / 1000) + 8 * 3600;
    var cuts = [{ id: 'A', slitter: { id: '1' }, materialId: 'MA', winding: 'OUT', batchId: 'B',
                  knifeWidths: W(30, 29), knifeCount: 29, rollerWidth: 0, plannedRuns: 1, isFoil: false,
                  planDate: String(D0), status: '', fixed: false, firstPartId: 'A' }];
    var ops = P.planCutOperations(cuts, {
        planBaseMidnightMs: BASE, weights: {}, times: TIMES,
        dayStartMin: DAY_START, dayEndMin: DAY_START + CAP, dayEndHourMin: DAY_START + CAP,
        maxOverworkCutsMin: OVER_CUTS, maxOverworkTuneMin: OVER_TUNE,
        lunchStartMin: 740, lunchDurationMin: 40,
        gapFill: true, preserveOrder: false, slotPlacement: true, firstCutSetup: true,
        prevSetupBySlitter: {}, perPassByCut: { A: 100 }, slitterIds: ['1'],
        dueDayByCut: {}, dueKeyByCut: {}
    });
    assert(ops.dayLoad && typeof ops.dayLoad === 'object', 'planCutOperations отдаёт dayLoad',
        '(' + JSON.stringify(ops.dayLoad) + ')');
    var keys = Object.keys(ops.dayLoad || {});
    assert(keys.length === 1 && ops.dayLoad[keys[0]] > 0, 'нагрузка дня посчитана',
        '(' + keys[0] + ' = ' + (ops.dayLoad || {})[keys[0]] + ')');
})();

console.log('\n' + passed + '/' + total + ' passed');
