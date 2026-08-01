// Tests for ideav/crm#4555 — «ПЕРЕСЧИТАТЬ ОТСЮДА И ДО КОНЦА».
//
// Задание правят вручную (проходы, полосы, перенос), и расчёт перестаёт укладываться в рамки.
// Нужно пересчитать всё от ВЫБРАННОГО задания вперёд, не трогая ни другие станки, ни прошлое.
//
// Границы механизма (решения заказчика 01.08.2026):
//   • ПОРЯДОК СОХРАНЯЕТСЯ — меняются только времена и разбиение по дням;
//   • «до конца» = до последнего задания станка, ПРАВАЯ граница фильтра [С;По] не действует;
//   • «прошлое» = и прежние дни, и соседи ЛЕВЕЕ выбранного в его же дне;
//   • замороженный день (#4436) не трогает никакой пересчёт.
//
// Run with: node experiments/atex-pp-4555-recalc-from-cut.test.js

process.env.TZ = 'UTC';
var mod = require('../download/atex/js/production-planning.js');
var planning = mod.planning;
var Controller = mod.Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var BASE = new Date(2026, 7, 3, 0, 0, 0, 0).getTime();   // день 0 = Пн 03.08.2026
var OP_TIMES = { WIND_300: 1.2, WIND_450: 1.8, BETWEEN_CUTS: 2, MATERIAL_WINDING: 15, KNIFE_LE_59: 30 };
var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, KNIFE_MOVE: 0, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
var DAY_SETTINGS = { DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
    LUNCH_DURATION: '40', TOTAL_INTERVALS: '15' };

// задание станка sid в день dayOff со стартом startMin и занятостью knife+material+cutTime
function cutOf(id, sid, dayOff, startMin, knife, material, cutTime, over) {
    var ts = Math.floor(BASE / 1000) + dayOff * 86400 + startMin * 60;
    var c = { id: id, orderId: 'O' + id, firstPartId: id,
        slitter: { id: sid, label: 'Станок ' + sid },
        materialId: 'MW308', winding: 'OUT', knifeWidths: [110, 110], knifeCount: 2, rollerWidth: 0,
        plannedRuns: 5, isFoil: false, length: 300, status: '', fixed: false, startDate: '', endDate: '',
        planDate: String(ts), number: String(ts), duration: String(cutTime),
        storedKnifeSetupMin: String(knife), storedMaterialWindingMin: String(material),
        storedCutAndLeaderMin: String(cutTime) };
    Object.keys(over || {}).forEach(function(k) { c[k] = over[k]; });
    return c;
}

function makeController(cuts, over) {
    var c = Object.create(Controller.prototype);
    c.busy = false;
    c.cuts = cuts;
    c.meta = { cut: { id: '1078', reqs: [
        { id: '96067', val: 'Наладка ножей, мин' },
        { id: '96069', val: 'Сырье/намотка, мин' },
        { id: '96778', val: 'Резка и Лидер' }
    ] } };
    c.filter = { slitter: '', status: '', date: '2026-08-03', dateTo: '2026-08-04', query: '' };
    c.slitters = [{ id: '101', label: 'Станок 101' }, { id: '202', label: 'Станок 202' }];
    c.opTimes = OP_TIMES; c.changeTimes = TIMES; c.daySettings = DAY_SETTINGS;
    c.supplies = []; c.genPositions = []; c.positionLengthById = {};
    c.footageBySupply = {}; c.consumptionByCut = {}; c.jumboWidthByMaterial = {};
    c.downtimesBySlitter = {}; c.calendarByDay = {}; c.freezeByDay = {};
    c.prevSetupBySlitter = {}; c.plannedTailSetup = {};
    c.nowMs = function() { return BASE + 9 * 3600000; };
    c.notify = function() {}; c.render = function() {}; c.setBusy = function() {};
    Object.keys(over || {}).forEach(function(k) { c[k] = over[k]; });
    return c;
}

// День 0 Станка 101: A 08:00 (60 мин), B 09:00 (60 мин), C 10:00 (60 мин).
// День 1 Станка 101: D 08:00. Станок 202: X в день 0. За правой границей фильтра — E в день 3.
function fixture() {
    return [
        cutOf('A', '101', 0, 480, 30, 0, 30),
        cutOf('B', '101', 0, 540, 30, 0, 30),
        cutOf('C', '101', 0, 600, 30, 0, 30),
        cutOf('D', '101', 1, 480, 30, 0, 30),
        cutOf('E', '101', 3, 480, 30, 0, 30),
        cutOf('X', '202', 0, 480, 30, 0, 30)
    ];
}

// ── 1. Scope «отсюда»: выбранное + всё позже на ЕГО станке ──────────────────────────────────
(function() {
    var c = makeController(fixture());
    var ids = c.recalcScopeCutIds('101', { fromCutId: 'B', toEnd: true });
    assert(ids.indexOf('A') < 0, '#4555 прошлое дня (A левее выбранного) в пересчёт НЕ попадает', 'scope=' + ids.join(','));
    assert(ids.indexOf('B') >= 0 && ids.indexOf('C') >= 0, '#4555 выбранное (B) и следующее за ним (C) — в пересчёте');
    assert(ids.indexOf('D') >= 0, '#4555 следующие ДНИ станка — в пересчёте');
    assert(ids.indexOf('X') < 0, '#4555 другой станок не трогается', 'scope=' + ids.join(','));
})();

// ── 2. «До конца» — правая граница фильтра [С;По] не действует ──────────────────────────────
(function() {
    var c = makeController(fixture());
    var withEnd = c.recalcScopeCutIds('101', { fromCutId: 'B', toEnd: true });
    var noEnd = c.recalcScopeCutIds('101', { fromCutId: 'B' });
    assert(withEnd.indexOf('E') >= 0,
        '#4555 «до конца»: задание за правой границей фильтра (день 3 при «По» 04.08) пересчитывается');
    assert(noEnd.indexOf('E') < 0,
        '#4555 без toEnd правая граница фильтра действует — прежнее поведение «Пересчитать наладку»');
})();

// ── 3. Без fromCutId scope прежний (охрана #4401/#4408 от регресса) ─────────────────────────
(function() {
    var c = makeController(fixture());
    var all = c.recalcScopeCutIds('101');
    assert(all.indexOf('A') >= 0 && all.indexOf('D') >= 0,
        '#4555 регресс: без границы — весь станок в видимых днях, как раньше');
    assert(all.indexOf('E') < 0, '#4555 регресс: правая граница фильтра по-прежнему отсекает');
    assert(all.indexOf('X') < 0, '#4555 регресс: чужой станок по-прежнему вне scope');
})();

// ── 4. Замороженный день выбранного задания — пересчёт отказывается ─────────────────────────
(function() {
    var msgs = [];
    var c = makeController(fixture(), {
        meta: { cut: { id: '1078', reqs: [] }, freeze: { id: '999' } },
        freezeByDay: {},
        notify: function(m, k) { msgs.push({ m: m, k: k }); }
    });
    c.dayIsFrozen = function() { return true; };
    var target = c.cuts.filter(function(x) { return x.id === 'B'; })[0];
    return c.recalcFromCut(target).then(function(res) {
        assert(res === false, '#4555 замороженный день: пересчёт не выполняется (#4436)');
        assert(msgs.some(function(x) { return /заморожен/i.test(x.m); }),
            '#4555 замороженный день: оператору сказано почему', msgs.map(function(x) { return x.m; }).join(' | '));
    });
})();

// ── 5. Старты: прошлое дня стои́т, выбранное встаёт встык за ним ─────────────────────────────
// Ломаем день руками: B и C наезжают на A (все стартуют в 08:00) — как в issue #4553.
(function() {
    var cuts = [
        cutOf('A', '101', 0, 480, 30, 0, 30),   // 08:00–09:00
        cutOf('B', '101', 0, 480, 30, 0, 30),   // 08:00 — наезд
        cutOf('C', '101', 0, 480, 30, 0, 30)    // 08:00 — наезд
    ];
    var c = makeController(cuts);
    var ops = c.recalcStartUpdates('101', { updates: [], fromCutId: 'B', toEnd: true });
    var byId = {};
    ops.forEach(function(o) { byId[o.cutId] = o; });
    assert(!byId['A'], '#4555 задание ЛЕВЕЕ выбранного свой старт не меняет', 'ops=' + JSON.stringify(ops.map(function(o){return o.cutId;})));
    var mins = function(ts) { return Math.round((ts * 1000 - BASE) / 60000); };
    assert(byId['B'] && mins(byId['B'].ts) === 540,
        '#4555 выбранное встаёт ВСТЫК за нетронутым прошлым: 09:00, а не 08:00',
        byId['B'] ? ('B=' + mins(byId['B'].ts)) : 'B не пересчитан');
    assert(byId['C'] && mins(byId['C'].ts) === 600,
        '#4555 следующее за ним — встык дальше: 10:00',
        byId['C'] ? ('C=' + mins(byId['C'].ts)) : 'C не пересчитан');
})();

// ── 6. Якорь в раскладке дня — чистая функция ───────────────────────────────────────────────
(function() {
    var items = [
        { cutId: 'A', windowStartMin: 480, occMin: 60, anchored: true },
        { cutId: 'B', windowStartMin: 480, occMin: 60 },
        { cutId: 'C', windowStartMin: 480, occMin: 60 }
    ];
    var starts = planning.repackDayWindowStarts(items, { dayStartMin: 480 });
    assert(starts['A'] === 480, '#4555 anchored: якорь остаётся на своём старте');
    assert(starts['B'] === 540, '#4555 anchored: курсор продолжается ОТ якоря, а не от начала смены');
    assert(starts['C'] === 600, '#4555 anchored: дальше — встык');
    // Без якоря день пересобирается с начала смены (прежнее поведение).
    var plain = planning.repackDayWindowStarts([
        { cutId: 'A', windowStartMin: 600, occMin: 60 },
        { cutId: 'B', windowStartMin: 600, occMin: 60 }
    ], { dayStartMin: 480 });
    assert(plain['A'] === 480 && plain['B'] === 540,
        '#4555 регресс: без якорей день по-прежнему собирается с начала смены');
})();

Promise.resolve().then(function() {
    console.log('\n' + passed + '/' + total + ' проверок пройдено');
});
