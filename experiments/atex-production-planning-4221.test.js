// Repro / regression for #4221 — форма «Перенести задание на другой день»: положение «По весу» и
// «В пределах этого станка». Ядро — новый примитив слоя размещения `dayLockByCut`: перенесённое
// задание «замыкается» на ВЫБРАННЫЙ день и станок (держит их), а ПОЗИЦИЮ в дне выбирает по наилучшему
// весу scorePosition (полный набор штрафов) — в отличие от 🔒-прикола (pinCutIds), который сажает
// задание неподвижным соседом в плейсхолдер-позицию «в начало/в конец дня».
//
// Проверяем три гарантии замка:
//   1) позиция в дне — по весу (задание встаёт рядом с одноимённым сырьём, а не в индекс 0);
//   2) замок ДНЯ — задание остаётся на выбранном дне, даже когда по весу выгоднее другой день;
//   3) замок СТАНКА — задание не мигрирует на другой станок, где вставка дешевле.
//
// Run with: node experiments/atex-production-planning-4221.test.js

var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var BASE = new Date(2026, 6, 1, 0, 0, 0, 0).getTime();   // ср 01.07.2026 = день 0
var DAY0 = Math.round(BASE / 1000) + 8 * 3600;           // день 0, 08:00 (unix-сек) — плейсхолдер переноса

function cut(id, mat, sid, planTs, fixed) {
    return { id: id, slitter: { id: sid || '1' }, materialId: mat, winding: 'OUT', batchId: 'B',
             knifeWidths: [100], knifeCount: 4, rollerWidth: 0, plannedRuns: 1, isFoil: false,
             planDate: planTs != null ? String(planTs) : '', status: '', fixed: !!fixed };
}
function opts(extra, perPass, slitterIds) {
    var o = { planBaseMidnightMs: BASE, weights: {}, times: {},
        dayStartMin: 480, dayEndMin: 840, dayEndHourMin: 840,
        maxOverworkCutsMin: 5, maxOverworkTuneMin: 10, lunchStartMin: 740, lunchDurationMin: 40,
        gapFill: true, preserveOrder: false, slotPlacement: true, firstCutSetup: false,
        prevSetupBySlitter: {}, intraDayResequence: true,
        perPassByCut: perPass, slitterIds: slitterIds || ['1'], dueDayByCut: {}, dueKeyByCut: {} };
    for (var k in (extra || {})) o[k] = extra[k];
    return o;
}
function calDay(ts) { return Math.floor((Number(ts) * 1000 - BASE) / 86400000); }
function seq(ops) {
    return (ops.updates || []).slice().sort(function (a, b) { return Number(a.planStartTs) - Number(b.planStartTs); })
        .map(function (u) { return { id: String(u.cutId), day: calDay(u.planStartTs), sid: String(u.slitterId == null ? '' : u.slitterId) }; });
}

// ── 1) Позиция в дне по весу: M(MB) встаёт рядом с Q(MB), а не в индекс 0 ──────────────────────────
(function () {
    var pp = { P: 30, Q: 30, R: 30, M: 30 };
    var cuts = [cut('P', 'MA'), cut('Q', 'MB'), cut('R', 'MA'), cut('M', 'MB', '1', DAY0, false)];
    var s = seq(P.planCutOperations(cuts, opts({ dayLockByCut: { M: 0 } }, pp)));
    var ids = s.map(function (o) { return o.id; });
    var iM = ids.indexOf('M'), iQ = ids.indexOf('Q');
    var allDay0 = s.every(function (o) { return o.day === 0; });
    console.log('  По весу порядок:', ids.join(','));
    assert(allDay0 && Math.abs(iM - iQ) === 1,
        '#4221 «По весу»: M(MB) встаёт рядом с одноимённым Q(MB), все на дне 0 (порядок ' + ids.join(',') + ')');

    // Контраст: 🔒-прикол (fixed) сажает M неподвижным в плейсхолдер — в НАЧАЛО дня (индекс 0).
    var cutsPin = [cut('P', 'MA'), cut('Q', 'MB'), cut('R', 'MA'), cut('M', 'MB', '1', DAY0, true)];
    var sp = seq(P.planCutOperations(cutsPin, opts({ dayAnchorByCut: { M: 0 } }, pp)));
    var idsPin = sp.map(function (o) { return o.id; });
    console.log('  Прикол (в начало):', idsPin.join(','));
    assert(idsPin[0] === 'M',
        '#4221 контраст: 🔒-прикол сажает M в начало дня (индекс 0) — не по весу (порядок ' + idsPin.join(',') + ')');
})();

// ── 2) Замок ДНЯ: M держится на ВЫБРАННОМ дне, куда без замка не встал бы ───────────────────────────
(function () {
    // 6 резок MA + M; per-pass 90 (ёмкость ≈320 → ~3 резки/день) — очередь растекается на 3 дня.
    // Без замка M садится на день 0 (betterCand предпочитает меньший день-смещение). Пользователь
    // выбрал ДЕНЬ 1 → замок дня 1 обязан удержать M на дне 1 (иначе «перенёс на день 1, а оно на дне 0»).
    var pp = { A1: 90, A2: 90, A3: 90, A4: 90, A5: 90, A6: 90, M: 90 };
    var cuts = [cut('A1', 'MA'), cut('A2', 'MA'), cut('A3', 'MA'), cut('A4', 'MA'), cut('A5', 'MA'), cut('A6', 'MA'),
                cut('M', 'MA', '1', DAY0, false)];
    var mFree = seq(P.planCutOperations(cuts.map(function (c) { return c; }), opts({}, pp)))
        .filter(function (o) { return o.id === 'M'; })[0];
    var mLock = seq(P.planCutOperations(cuts.map(function (c) { return c; }), opts({ dayLockByCut: { M: 1 } }, pp)))
        .filter(function (o) { return o.id === 'M'; })[0];
    console.log('  M без замка → день', mFree && mFree.day, '; замок дня 1 → день', mLock && mLock.day);
    assert(mLock && mLock.day === 1, '#4221 замок ДНЯ: M удержан на выбранном дне 1 (= ' + (mLock && mLock.day) + ')');
    assert(mFree && mFree.day === 0, '#4221 контроль: без замка M сел бы на день 0 (= ' + (mFree && mFree.day) + ')');
})();

// ── 3) Замок СТАНКА: M(MB) удержан на станке 1, хотя на станке 2 всё MB (вставка там дешевле) ──────
(function () {
    var pp = { A1: 60, A2: 60, B1: 60, B2: 60, M: 60 };
    var cuts = [cut('A1', 'MA', '1'), cut('A2', 'MA', '1'),
                cut('B1', 'MB', '2'), cut('B2', 'MB', '2'),
                cut('M', 'MB', '1', DAY0, false)];   // M на станке 1 (сырьё MB как у станка 2)
    var sFree = seq(P.planCutOperations(cuts.map(function (c) { return c; }), opts({}, pp, ['1', '2'])));
    var mFree = sFree.filter(function (o) { return o.id === 'M'; })[0];
    var sLock = seq(P.planCutOperations(cuts.map(function (c) { return c; }), opts({ dayLockByCut: { M: 0 } }, pp, ['1', '2'])));
    var mLock = sLock.filter(function (o) { return o.id === 'M'; })[0];
    console.log('  M без замка → станок', mFree && mFree.sid, '; замок → станок', mLock && mLock.sid);
    assert(mLock && mLock.sid === '1', '#4221 замок СТАНКА: M удержан на станке 1 (= ' + (mLock && mLock.sid) + ')');
    assert(mFree && mFree.sid === '2', '#4221 контроль: без замка M мигрировал бы к MB на станок 2 (= ' + (mFree && mFree.sid) + ')');
})();

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
