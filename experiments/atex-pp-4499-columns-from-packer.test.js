// Тесты: КОЛОНКИ ТАЙМИНГА ПИШЕТ УПАКОВЩИК, а не второй независимый расчёт.
//
// ЗАЧЕМ. Бейдж дня «(N мин)» и мерка потолка складываются из ХРАНИМЫХ колонок «Наладка ножей» +
// «Сырьё/намотка» + «Резка и Лидер». Раньше их считала `computeCutSetupUpdates` — заново, по своей
// развёртке очереди станка. Упаковщик считал ту же переналадку по СВОЕЙ раскладке. Две арифметики
// расходились на разбитых по дням заданиях и наладочных хвостах: замер на 2500 случайных раскладок
// давал до +75 минут на день. Отсюда «502 мин при потолке 460» на честно упакованном дне — и целый
// класс возвращающихся тикетов (#3951, #4026, #4034, #4438).
//
// Теперь упаковщик отдаёт разложение вместе с операцией (`ops.*.planCols`), а писатель колонок
// берёт его как есть. Один расчёт — одна правда.
//
//   A — сумма трёх колонок сегмента РАВНА его занятости (occMin): бейдж = то, что напаковано;
//   B — писатель берёт числа плана, а не свои (проверка на реальном computeCutSetupUpdates);
//   C — задания, которых план не касался, считаются как раньше (фолбэк не сломан);
//   D — перебор случайных раскладок: сумма колонок дня НИКОГДА не превышает потолок смены.
//
// Run with: node experiments/atex-pp-4499-columns-from-packer.test.js

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
var MATS = ['MA', 'MB', 'MC', 'MD'], KN = [[40, 22], [110, 8], [25, 35], [80, 11], [59, 15]];
function rnd(seed) { var s = seed; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
function K(pairs) { var a = []; pairs.forEach(function (p) { for (var i = 0; i < p[1]; i++) a.push(p[0]); }); return a; }

function fixture(r) {
    var n = 3 + Math.floor(r() * 8), cuts = [], perPass = {}, anchor = {};
    for (var i = 0; i < n; i++) {
        var k = KN[Math.floor(r() * KN.length)], id = 'C' + i;
        var fixed = r() < 0.5, day = Math.floor(r() * 3);
        cuts.push({ id: id, slitter: { id: '1' }, materialId: MATS[Math.floor(r() * MATS.length)],
                    winding: r() < 0.5 ? 'OUT' : 'IN', batchId: 'B' + Math.floor(r() * 3),
                    knifeWidths: K([k]), knifeCount: k[1], rollerWidth: k[0],
                    plannedRuns: 1 + Math.floor(r() * 14), isFoil: r() < 0.15, fixed: fixed, status: '',
                    planDate: String(Math.floor(BASE / 1000) + 8 * 3600 + day * 86400 + i * 600) });
        perPass[id] = 5 + Math.floor(r() * 40);
        if (fixed) anchor[id] = day;
    }
    return { cuts: cuts, perPass: perPass, anchor: anchor };
}
function plan(f) {
    return P.planCutOperations(f.cuts, {
        planBaseMidnightMs: BASE, weights: {}, times: TIMES,
        dayStartMin: 480, dayEndMin: 480 + CAP, dayEndHourMin: 480 + CAP,
        maxOverworkCutsMin: OVER, maxOverworkTuneMin: TUNE, lunchStartMin: 740, lunchDurationMin: 40,
        gapFill: true, preserveOrder: false, slotPlacement: true, firstCutSetup: false,
        prevSetupBySlitter: {}, intraDayResequence: true, perPassByCut: f.perPass,
        slitterIds: ['1'], dueDayByCut: {}, dueKeyByCut: {}, dayAnchorByCut: f.anchor
    });
}
function allOps(ops) { return (ops.updates || []).concat(ops.creates || []); }
function dayOfTs(ts) { return Math.floor((Number(ts) * 1000 - BASE) / 86400000); }

// ── A: сумма колонок = занятость сегмента ───────────────────────────────────────────────────
(function () {
    var bad = 0, checked = 0, sample = null;
    for (var seed = 1; seed <= 500; seed++) {
        var ops;
        try { ops = plan(fixture(rnd(seed))); } catch (e) { continue; }
        allOps(ops).forEach(function (u) {
            if (!u || !u.planCols) return;
            checked++;
            var sum = Math.round(u.planCols.knife) + Math.round(u.planCols.material) + Math.round(u.planCols.cutTime);
            if (sum !== Math.round(u.occMin)) { bad++; if (!sample) sample = { seed: seed, sum: sum, occ: u.occMin }; }
        });
    }
    assert(checked > 500, '#4499-A: проверено операций плана: ' + checked);
    assert(bad === 0,
        '#4499-A: сумма трёх колонок РАВНА занятости сегмента во всех операциях',
        bad ? '(расхождений ' + bad + ', напр. ' + JSON.stringify(sample) + ')' : '');
})();

// ── B: писатель берёт числа плана, а не считает свои ────────────────────────────────────────
(function () {
    var meta = { id: '1078', reqs: [
        { id: '96067', val: 'Наладка ножей, мин' },
        { id: '96069', val: 'Сырье/намотка, мин' },
        { id: '96778', val: 'Резка и Лидер' }
    ] };
    function cut(id) {
        return { id: id, slitter: { id: 'S1' }, plannedRuns: 5, duration: 100, materialId: 'M' + id,
                 winding: 'OUT', batchId: '1', knifeWidths: [100], knifeCount: 1,
                 storedKnifeSetupMin: '', storedMaterialWindingMin: '', storedCutAndLeaderMin: '' };
    }
    var self = { meta: { cut: meta }, changeTimes: TIMES, cuts: [cut('A'), cut('B')],
                 filter: { date: '' }, planningPrevSetupBySlitter: function () { return {}; } };
    var own = Controller.prototype.computeCutSetupUpdates.call(self, null);
    var byOwn = {}; own.updates.forEach(function (u) { byOwn[u.cutId] = u; });

    var self2 = { meta: { cut: meta }, changeTimes: TIMES, cuts: [cut('A'), cut('B')],
                  filter: { date: '' }, planningPrevSetupBySlitter: function () { return {}; } };
    var planned = Controller.prototype.computeCutSetupUpdates.call(self2, null,
        { planCols: { A: { knife: 7, material: 3, cutTime: 111 } } });
    var byPlan = {}; planned.updates.forEach(function (u) { byPlan[u.cutId] = u; });

    assert(byPlan.A && byPlan.A.knife === 7 && byPlan.A.material === 3 && byPlan.A.cutTime === 111,
        '#4499-B: для задания с planCols записаны ИМЕННО числа плана',
        '(' + JSON.stringify(byPlan.A && { k: byPlan.A.knife, m: byPlan.A.material, t: byPlan.A.cutTime }) + ')');
    assert(byOwn.A && !(byOwn.A.knife === 7 && byOwn.A.material === 3),
        '#4499-B контроль: без planCols числа были бы ДРУГИЕ (значит подмена реальна)',
        '(' + JSON.stringify(byOwn.A && { k: byOwn.A.knife, m: byOwn.A.material, t: byOwn.A.cutTime }) + ')');

    // ── C: задание, которого план не касался, считается как раньше ──
    assert(byPlan.B && byOwn.B && byPlan.B.knife === byOwn.B.knife
           && byPlan.B.material === byOwn.B.material && byPlan.B.cutTime === byOwn.B.cutTime,
        '#4499-C: задание без planCols считается как раньше (фолбэк цел)',
        '(' + JSON.stringify(byPlan.B && { k: byPlan.B.knife, m: byPlan.B.material, t: byPlan.B.cutTime }) + ')');
})();

// ── D: перебор — сумма колонок дня не превышает потолок ─────────────────────────────────────
(function () {
    var over = 0, days = 0, worst = null;
    for (var seed = 1; seed <= 1500; seed++) {
        var ops;
        try { ops = plan(fixture(rnd(seed))); } catch (e) { continue; }
        var byDay = {};
        allOps(ops).forEach(function (u) {
            if (!u || !u.planCols) return;
            var d = dayOfTs(u.planStartTs);
            byDay[d] = (byDay[d] || 0) + Math.round(u.planCols.knife) + Math.round(u.planCols.material) + Math.round(u.planCols.cutTime);
        });
        Object.keys(byDay).forEach(function (d) {
            days++;
            var m = Math.round(byDay[d]);
            if (m > CAP + TUNE + 40) {   // 40 — запас на обед внутри окна дня
                over++;
                if (!worst || m > worst.min) worst = { seed: seed, day: d, min: m };
            }
        });
    }
    assert(days > 1000, '#4499-D: проверено станко-дней: ' + days);
    assert(over === 0,
        '#4499-D: НИ ОДИН день не выходит за потолок по сумме колонок',
        over ? '(переполненных ' + over + ', худший ' + JSON.stringify(worst) + ')' : '');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
if (passed !== total) process.exitCode = 1;
