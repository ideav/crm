// Repro / regression for #4225 — доработка галки переноса «В пределах одного станка» (к #4221).
// При переносе на ДРУГОЙ станок галка должна затрагивать исходный И целевой станок, но НЕ кидать
// задания между станками. Ядро — новый примитив слоя размещения `machineLockByCut`: задание
// «замкнуто» на СВОЙ станок (lockSlitter без lockDay) — миграция на другой станок запрещена, а
// позиция/день внутри своего станка по-прежнему выбираются по весу.
//
// Run with: node experiments/atex-production-planning-4225.test.js

var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var BASE = new Date(2026, 6, 1, 0, 0, 0, 0).getTime();
function cut(id, mat, sid) {
    return { id: id, slitter: { id: sid }, materialId: mat, winding: 'OUT', batchId: 'B',
             knifeWidths: [100], knifeCount: 4, rollerWidth: 0, plannedRuns: 1, isFoil: false,
             planDate: '', status: '', fixed: false };
}
function opts(extra) {
    var o = { planBaseMidnightMs: BASE, weights: {}, times: {},
        dayStartMin: 480, dayEndMin: 840, dayEndHourMin: 840,
        maxOverworkCutsMin: 5, maxOverworkTuneMin: 10, lunchStartMin: 740, lunchDurationMin: 40,
        gapFill: true, preserveOrder: false, slotPlacement: true, firstCutSetup: false,
        prevSetupBySlitter: {}, intraDayResequence: true,
        perPassByCut: { A1: 60, A2: 60, X: 60, B1: 60, B2: 60 }, slitterIds: ['1', '2'],
        dueDayByCut: {}, dueKeyByCut: {} };
    for (var k in (extra || {})) o[k] = extra[k];
    return o;
}
function machineOf(ops, id) {
    var u = (ops.updates || []).filter(function (o) { return String(o.cutId) === id; })[0];
    return u ? String(u.slitterId) : '?';
}
// Сцена: A1,A2 на станке 1 (сырьё MA); B1,B2 на станке 2 (сырьё MB); X на станке 1, но сырьё MB —
// по весу X дешевле встал бы на станке 2 (рядом с MB). Замок станка обязан удержать X на станке 1.
function scene() {
    return [cut('A1', 'MA', '1'), cut('A2', 'MA', '1'), cut('X', 'MB', '1'), cut('B1', 'MB', '2'), cut('B2', 'MB', '2')];
}

// ── 1) Без замка X мигрирует на станок 2 (контроль) ───────────────────────────────────────────────
(function () {
    var m = machineOf(P.planCutOperations(scene(), opts()), 'X');
    console.log('  X без замка → станок', m);
    assert(m === '2', '#4225 контроль: без замка X мигрирует на станок 2 (сырьё MB) — = ' + m);
})();

// ── 2) Замок станка держит X на станке 1 (миграция запрещена) ──────────────────────────────────────
(function () {
    var m = machineOf(P.planCutOperations(scene(), opts({ machineLockByCut: { X: '1' } })), 'X');
    console.log('  X замок m1 → станок', m);
    assert(m === '1', '#4225 замок СТАНКА: X удержан на станке 1 (не мигрирует) — = ' + m);
})();

// ── 3) Полный scope {1,2} с замком каждого задания на свой станок — ни одно не мигрирует ───────────
(function () {
    var lock = { A1: '1', A2: '1', X: '1', B1: '2', B2: '2' };
    var ops = P.planCutOperations(scene(), opts({ machineLockByCut: lock }));
    var ok = Object.keys(lock).every(function (id) { return machineOf(ops, id) === lock[id]; });
    var got = Object.keys(lock).map(function (id) { return id + '@' + machineOf(ops, id); }).join(' ');
    console.log('  scope {1,2} c замками:', got);
    assert(ok, '#4225 без миграции между станками: каждое задание осталось на своём станке (' + got + ')');
})();

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
