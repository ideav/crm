// #4529 (ТЗ §15) — РАСЧЁТ РЕЗКИ У ПЛАНИРОВЩИКА И У ПРОВЕРКИ ОДИН.
//
// СИМПТОМ (issue #4529, БД ateh, журнал кнопки «Сгенерировать»). Сразу ПОСЛЕ того, как
// «Сгенерировать» записала план, экран сообщает о двух расхождениях с только что записанным:
//   1. тост «наладка ножей посчитана дважды: по цепочке 652635 сумма 45 мин при одной смене
//      30 мин (звенья: 652635, 652635)» — наблюдатель CHAIN_SETUP_ONCE (§15, #4524);
//   2. красная «↻ Пересчитать наладку (заданий: 1)» и бейдж «НАЛАДКА» с подсказкой
//      «Расхождение с текущим порядком заданий: резка и лидер 20 → 14 мин».
//
// ПРИЧИНЫ — две разные арифметики на один и тот же вопрос.
//   1. Хвост дня N (setup-only сегмент) забрал НОЖИ (30), а смена сырья (15) уехала на
//      продолжение. Продолжению остаток приходил ОДНИМ ЧИСЛОМ, без кодов, и раскладывался
//      целиком в «Наладку ножей»: по цепочке выходило 30+15=45 минут НОЖЕЙ при одной смене 30.
//      План был верен, врали колонки — и наблюдатель честно сообщал о двойной наладке.
//   2. «Резка и Лидер» = намотка + BETWEEN_CUTS × проходов. Упаковщик считает намотку по ЖИВОЙ
//      норме «Времени операции», а `computeCutSetupUpdates` брала её из ХРАНИМОЙ «Длительности,
//      минут», которую переписывают только при смене числа проходов. После #4501 (полоса
//      ≤ 30 мм наматывается по своей серии: WIND_W30_600=8 против WIND_900=5) хранимое описывало
//      прежний мир: план писал 20, детектор требовал 14. Нажать «Пересчитать наладку» — значит
//      записать 14 и получить дыру в дне; не нажимать — красная кнопка навсегда.
//
// ПРАВИЛО (ТЗ §15): «Резка и Лидер» и «Длительность, минут» — одно число в двух видах, обе
// пишет ОДИН расчёт по живой норме намотки; остаток наладки, унесённый хвостом дня на
// продолжение, ложится в СВОИ колонки (ножи — в ножи, сырьё — в сырьё).
//
// Что проверяем:
//   A — остаток наладки продолжения ложится по своим кодам, сумма по цепочке = одна смена ножей
//       + одна смена сырья (наблюдатель CHAIN_SETUP_ONCE молчит на верно упакованном плане);
//   B — «Резка и Лидер» считается по живой норме: узкая полоса (#4501) даёт 20, а не 14;
//   C — записанный план детектор НЕ переспрашивает: колонки упаковщика → расхождений ноль;
//   D — «Длительность, минут» пишется вместе с «Резкой и Лидером» (пара не разъезжается);
//   E — нет норм намотки / длины прогона — хранимое держим (молча не обнуляем);
//   F — перебор раскладок: наблюдатель CHAIN_SETUP_ONCE не срабатывает ни на одной.
//
// Run with: node experiments/atex-pp-4529-one-cut-arithmetic.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh', xsrf: 'x' };
var mod = require('../download/atex/js/production-planning.js');
var P = mod.planning, Controller = mod.Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
var CAP = 450, OVER = 5, TUNE = 10;
var BASE = new Date(2026, 6, 29, 0, 0, 0, 0).getTime();
// Нормы намотки боевого справочника (#4501): узкая серия обрывается на 600 м и выше клампится.
var OP_TIMES = { WIND_300: 1.2, WIND_450: 1.8, WIND_600: 4, WIND_900: 5,
                 WIND_W30_300: 2.4, WIND_W30_450: 3.6, WIND_W30_600: 8 };

function plan(cuts, perPass, opts) {
    var o = opts || {};
    return P.planCutOperations(cuts, {
        planBaseMidnightMs: BASE, weights: {}, times: TIMES,
        dayStartMin: 480, dayEndMin: 480 + CAP, dayEndHourMin: 480 + CAP,
        maxOverworkCutsMin: OVER, maxOverworkTuneMin: TUNE, lunchStartMin: 740, lunchDurationMin: 40,
        gapFill: o.gapFill !== false, preserveOrder: o.preserveOrder !== false,
        slotPlacement: !!o.slotPlacement, firstCutSetup: true,
        prevSetupBySlitter: {}, intraDayResequence: false, perPassByCut: perPass,
        slitterIds: ['1'], dueDayByCut: {}, dueKeyByCut: {}, dayAnchorByCut: o.anchor || {}
    });
}
function allOps(ops) { return (ops.updates || []).concat(ops.creates || []); }

// Наблюдатель §15 на операциях плана: цепочка = «ID первой части» (для create — родитель).
function chainViolations(ops) {
    var res = P.guardPlanOps({ updates: (ops.updates || []).slice(), creates: (ops.creates || []).slice(), deletes: [] }, {
        knifeSetupMin: function () { return TIMES.KNIFE; },
        materialSetupMin: function () { return TIMES.MATERIAL_WINDING; },
        chainIdOfCut: function (id) { return String(id); }
    }, 'auto');
    return (res.violations || []).filter(function (v) { return v.rule === 'CHAIN_SETUP_ONCE'; });
}

// ── A. Остаток наладки продолжения ложится в СВОИ колонки ────────────────────────────────────
// A забивает день так, что у B в хвост влезают только ножи (30); смена сырья (15) — на продолжение.
(function () {
    var cuts = [
        { id: 'A', slitter: { id: '1' }, materialId: 'MA', winding: 'OUT', batchId: 'B1',
          knifeWidths: [40, 40], knifeCount: 2, plannedRuns: 10, planDate: String(BASE / 1000 + 8 * 3600) },
        { id: 'B', slitter: { id: '1' }, materialId: 'MB', winding: 'IN', batchId: 'B2',
          knifeWidths: [110], knifeCount: 1, plannedRuns: 10, planDate: String(BASE / 1000 + 8 * 3600 + 600) }
    ];
    var ops = plan(cuts, { A: 32, B: 100 });
    var tail = (ops.updates || []).filter(function (u) { return u.cutId === 'B'; })[0];
    var cont = (ops.creates || []).filter(function (cr) { return cr.parentCutId === 'B'; })[0];
    assert(tail && tail.plannedRuns === 0 && cont,
        '#4529-A предпосылка: у B хвост-настройка в дне N и продолжение в дне N+1',
        '(хвост ' + JSON.stringify(tail && tail.planCols) + ', продолжение ' + JSON.stringify(cont && cont.planCols) + ')');
    assert(tail && tail.planCols.knife === 30 && tail.planCols.material === 0,
        '#4529-A: в хвосте дня N — НОЖИ 30', '(' + JSON.stringify(tail && tail.planCols) + ')');
    assert(cont && cont.planCols.knife === 0 && cont.planCols.material === 15,
        '#4529-A: остаток на продолжении — СМЕНА СЫРЬЯ 15, а не «ещё ножи»',
        '(' + JSON.stringify(cont && cont.planCols) + ')');
    var sum = allOps(ops).filter(function (u) { return u.cutId === 'B' || u.parentCutId === 'B'; })
        .reduce(function (a, u) { return { k: a.k + u.planCols.knife, m: a.m + u.planCols.material }; }, { k: 0, m: 0 });
    assert(sum.k === TIMES.KNIFE && sum.m === TIMES.MATERIAL_WINDING,
        '#4529-A: по цепочке — ОДНА смена ножей и ОДНА смена сырья', '(ножи ' + sum.k + ', сырьё ' + sum.m + ')');
    var v = chainViolations(ops);
    assert(v.length === 0, '#4529-A: наблюдатель CHAIN_SETUP_ONCE молчит',
        v.length ? '(' + v.map(function (x) { return x.message; }).join('; ') + ')' : '');
})();

// ── B/C/D/E. «Резка и Лидер» — по живой норме, «Длительность» пишется вместе с ней ───────────
var META = { id: '1078', reqs: [
    { id: '96067', val: 'Наладка ножей, мин' },
    { id: '96069', val: 'Сырье/намотка, мин' },
    { id: '96778', val: 'Резка и Лидер' },
    { id: '96000', val: 'Длительность, минут' }
] };
// Карточка №4 из issue #4529: полосы 25 мм (узкие, #4501), прогон 900 м, 2 прохода.
// Норма до #4501: WIND_900=5 → намотка 10, «Резка и Лидер» 10+2×2=14.
// Норма после #4501: узкая серия клампится на WIND_W30_600=8 → намотка 16, «Резка и Лидер» 20.
function narrowCut(over) {
    var c = { id: 'N1', slitter: { id: 'S1' }, plannedRuns: 2, duration: '10', length: '900',
              materialId: 'MWR113L', winding: 'IN', batchId: '1',
              knifeWidths: [25, 25, 25], knifeCount: 3,
              storedKnifeSetupMin: '30', storedMaterialWindingMin: '15', storedCutAndLeaderMin: '20' };
    Object.keys(over || {}).forEach(function (k) { c[k] = over[k]; });
    return c;
}
function controller(cut, extra) {
    var self = { meta: { cut: META }, changeTimes: TIMES, opTimes: OP_TIMES, cuts: [cut],
                 supplies: [], positionLengthById: {},
                 filter: { date: '' }, planningPrevSetupBySlitter: function () { return {}; } };
    Object.keys(extra || {}).forEach(function (k) { self[k] = extra[k]; });
    return self;
}

(function () {
    var self = controller(narrowCut());
    var res = Controller.prototype.computeCutSetupUpdates.call(self, null, { dryRun: true });
    var u = res.updates[0];
    assert(!u || u.cutTime === 20,
        '#4529-B: «Резка и Лидер» считается по ЖИВОЙ норме узкой полосы = 20, а не 14 из хранимой «Длительности»',
        '(' + (u ? u.cutTime : 'расхождений нет — 20 уже записано') + ')');

    // C — записанный план детектор не переспрашивает: «Резка и Лидер» уже 20.
    var mismatch = res.updates.filter(function (x) {
        return Math.round(Number(x.cutTime)) !== Math.round(Number(x.wasCutTime));
    });
    assert(mismatch.length === 0,
        '#4529-C: после записи плана детектор НЕ просит пересчитать «Резку и Лидер»',
        mismatch.length ? '(' + JSON.stringify(mismatch.map(function (m) { return m.wasCutTime + '→' + m.cutTime; })) + ')' : '');

    // D — «Длительность» едет вместе: хранимые 10 подтягиваются к 16 (=20−лидер 4).
    var d = res.updates[0];
    assert(d && d.duration === 16,
        '#4529-D: «Длительность, минут» пишется вместе с «Резкой и Лидером» (16 = 20 − лидер 4)',
        '(' + JSON.stringify(d && { dur: d.duration, was: d.wasDuration, t: d.cutTime }) + ')');
    var fields = Controller.prototype.computeCutSetupUpdates.call(controller(narrowCut()), null).reqs;
    assert(fields.durationReq === '96000', '#4529-D: реквизит «Длительность, минут» найден в метаданных',
        '(' + fields.durationReq + ')');
})();

(function () {
    // #4529-B контроль: широкая полоса той же длины идёт по базовой норме WIND_900=5 → 14.
    var self = controller(narrowCut({ knifeWidths: [110], knifeCount: 1, storedCutAndLeaderMin: '20' }));
    var u = Controller.prototype.computeCutSetupUpdates.call(self, null, { dryRun: true }).updates[0];
    assert(u && u.cutTime === 14,
        '#4529-B контроль: широкая полоса — базовая норма, «Резка и Лидер» 14 (значит норму реально спрашивают)',
        '(' + (u && u.cutTime) + ')');
})();

(function () {
    // E — норм намотки нет: хранимое держим, ничего не обнуляем.
    var noNorms = controller(narrowCut(), { opTimes: {} });
    var uN = Controller.prototype.computeCutSetupUpdates.call(noNorms, null, { dryRun: true }).updates
        .filter(function (x) { return String(x.cutId) === 'N1'; })[0];
    assert(!uN || (uN.cutTime === 14 && uN.duration == null),
        '#4529-E: нет норм намотки — «Длительность» не трогаем, считаем как раньше (из хранимой)',
        '(' + JSON.stringify(uN && { t: uN.cutTime, dur: uN.duration }) + ')');

    // E2 — длины прогона нет: тоже держим хранимое.
    var noLen = controller(narrowCut({ length: '' }));
    var uL = Controller.prototype.computeCutSetupUpdates.call(noLen, null, { dryRun: true }).updates
        .filter(function (x) { return String(x.cutId) === 'N1'; })[0];
    assert(!uL || (uL.cutTime === 14 && uL.duration == null),
        '#4529-E2: нет длины прогона — «Длительность» не трогаем',
        '(' + JSON.stringify(uL && { t: uL.cutTime, dur: uL.duration }) + ')');
})();

// ── F. Перебор раскладок: двойной наладки по цепочке не бывает ────────────────────────────────
(function () {
    var MATS = ['MA', 'MB', 'MC'], KN = [[40, 22], [110, 8], [25, 35], [80, 11]];
    function rnd(seed) { var s = seed; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
    function K(pair) { var a = []; for (var i = 0; i < pair[1]; i++) a.push(pair[0]); return a; }
    var bad = 0, checked = 0, chains = 0, sample = null;
    for (var seed = 1; seed <= 600; seed++) {
        var r = rnd(seed), n = 2 + Math.floor(r() * 5), cuts = [], perPass = {};
        for (var i = 0; i < n; i++) {
            var k = KN[Math.floor(r() * KN.length)], id = 'C' + i;
            cuts.push({ id: id, slitter: { id: '1' }, materialId: MATS[Math.floor(r() * MATS.length)],
                        winding: r() < 0.5 ? 'OUT' : 'IN', batchId: 'B' + Math.floor(r() * 3),
                        knifeWidths: K(k), knifeCount: k[1], rollerWidth: k[0],
                        plannedRuns: 1 + Math.floor(r() * 12), status: '',
                        planDate: String(BASE / 1000 + 8 * 3600 + i * 600) });
            perPass[id] = 10 + Math.floor(r() * 90);
        }
        var ops;
        try { ops = plan(cuts, perPass); } catch (e) { continue; }
        checked++;
        if ((ops.creates || []).length) chains++;
        var v = chainViolations(ops);
        if (v.length) { bad++; if (!sample) sample = { seed: seed, msg: v[0].message }; }
    }
    assert(checked > 400 && chains > 50,
        '#4529-F: проверено раскладок ' + checked + ', из них с разорванными по дням заданиями ' + chains);
    assert(bad === 0, '#4529-F: НИ НА ОДНОЙ раскладке наблюдатель CHAIN_SETUP_ONCE не срабатывает',
        bad ? '(срабатываний ' + bad + ', напр. ' + JSON.stringify(sample) + ')' : '');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
if (passed !== total) process.exitCode = 1;
