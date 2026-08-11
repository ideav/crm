// Unit-тесты для ideav/crm#4390 — перенос «По весу» + «Зафиксировать» на выбранный день, а задание
// уезжает на СЛЕДУЮЩИЙ день (27.07 → 28.07). Из трейса: слой размещения ставит его на «день~20260727»
// по ЭВРИСТИКЕ ёмкости (prefixDayOffset/capacityMin), которая НЕ видит «Заморозку» (#4326) и точную
// ёмкость дня; а точный упаковщик (splitMachineQueue, арбитр §12) переливает ПОДВИЖНОЕ задание за
// замороженный/переполненный день на следующий. При этом «Зафиксировать» игнорировалось: мягкий замок
// дня «по весу» (weightPositionCutIds → dayLockByCut) кладёт задание в раскладке ПОДВИЖНЫМ (см.
// computeSlotPlacement: ветка dayLock проверяется РАНЬШЕ `else if (c.fixed)`), переопределяя фиксацию.
//
// Часть A (движок): на ЗАМОРОЖЕННОМ целевом дне ДЕНЬ держит ФИКС-якорь, а мягкий замок дня сам по
//   себе (без «Зафиксировано») — нет. Поэтому «Зафиксировать» и удерживает выбранный день.
// Часть B (контроллер): moveCutToDay при fix=true отдаёт задание в weightPositionCutIds — МЕСТО в дне
//   выбирают веса (#4506), а ДЕНЬ держит фикс-якорь (Зафиксировано=1 + «Дата план»); тост печатается
//   по ФАКТИЧЕСКОМУ дню после раскладки (при сдвиге — предупреждение).
//
// Run with: node experiments/atex-production-planning-4390.test.js

var mod = require('../download/atex/js/production-planning.js');
var planning = mod.planning;
var Controller = mod.Controller;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// ── Часть A: движок — замороженный день держит ФИКС, но не мягкий замок «по весу» ─────────────────
var BASE = new Date(2026, 6, 1, 0, 0, 0, 0).getTime();   // день 0
var DAY = function (off) { return Math.round(BASE / 1000) + off * 86400 + 8 * 3600; };
function cut(id, mat, planOff, fixed) {
    return { id: id, slitter: { id: '1' }, materialId: mat, winding: 'OUT', batchId: 'B',
             knifeWidths: [100], knifeCount: 4, rollerWidth: 0, plannedRuns: 1, isFoil: false,
             planDate: planOff != null ? String(DAY(planOff)) : '', status: '', fixed: !!fixed };
}
function opts(extra, perPass) {
    var o = { planBaseMidnightMs: BASE, weights: {}, times: {},
        dayStartMin: 480, dayEndMin: 840, dayEndHourMin: 840,
        maxOverworkCutsMin: 5, maxOverworkTuneMin: 10, lunchStartMin: 740, lunchDurationMin: 40,
        gapFill: true, preserveOrder: false, slotPlacement: true, firstCutSetup: false,
        prevSetupBySlitter: {}, intraDayResequence: true,
        perPassByCut: perPass, slitterIds: ['1'], dueDayByCut: {}, dueKeyByCut: {} };
    for (var k in (extra || {})) o[k] = extra[k];
    return o;
}
function calDay(ts) { return Math.floor((Number(ts) * 1000 - BASE) / 86400000); }
function dayOfCut(ops, id) {
    var u = (ops.updates || []).filter(function (x) { return String(x.cutId) === id; })[0];
    return u ? calDay(u.planStartTs) : null;
}

// 6 ПОДВИЖНЫХ резок MA + M (per-pass 90 → ёмкость ~320 = ~3/день), очередь растекается на 3 дня —
// как #4221: без замка M сел бы на день 0, замок обязан удержать выбранный день. День 1 ЗАМОРОЖЕН.
var pp = { A1: 90, A2: 90, A3: 90, A4: 90, A5: 90, A6: 90, M: 90 };
var frozenDay1 = { frozenDayFor: function (d) { return d === 1; } };
var fillers = function () {
    return [cut('A1', 'MA'), cut('A2', 'MA'), cut('A3', 'MA'), cut('A4', 'MA'), cut('A5', 'MA'), cut('A6', 'MA')];
};

// M как ФИКС-якорь (Зафиксировано=1, «Дата план» = день 1) — новый путь переноса с «Зафиксировать».
var mFixedDay = dayOfCut(
    planning.planCutOperations(fillers().concat([cut('M', 'MA', 1, true)]),
        opts(Object.assign({ dayAnchorByCut: { M: 1 } }, frozenDay1), pp)),
    'M');
// M как мягкий замок дня «по весу» (подвижное) — старый путь; на замороженный день не встаёт.
var mLockDay = dayOfCut(
    planning.planCutOperations(fillers().concat([cut('M', 'MA', 1, false)]),
        opts(Object.assign({ dayLockByCut: { M: 1 } }, frozenDay1), pp)),
    'M');
// Контроль без заморозки: мягкий замок дня 1 держит день 1 (как #4221) — виноват именно замороженный день.
var mLockNoFreeze = dayOfCut(
    planning.planCutOperations(fillers().concat([cut('M', 'MA', 1, false)]),
        opts({ dayLockByCut: { M: 1 } }, pp)),
    'M');

console.log('  A: fixed→день', mFixedDay, '; softlock+freeze→день', mLockDay, '; softlock no-freeze→день', mLockNoFreeze);
assert(mFixedDay === 1,
    '#4390-A: ФИКС-якорь держит M на выбранном (замороженном) дне 1 (= ' + mFixedDay + ')');
assert(mLockDay !== 1,
    '#4390-A: мягкий замок дня «по весу» НЕ удерживает M на замороженном дне 1 — уезжает (день ' + mLockDay + ')');
assert(mLockNoFreeze === 1,
    '#4390-A контроль: без заморозки тот же мягкий замок держит день 1 (= ' + mLockNoFreeze + ') — виноват замороженный день');

// #4506: боевая комбинация «Зафиксировать» + «По весу» — фикс-якорь И замок дня вместе. День держит
// якорь (даже замороженный), место в дне выбирают веса.
var mBothFrozen = dayOfCut(
    planning.planCutOperations(fillers().concat([cut('M', 'MA', 1, true)]),
        opts(Object.assign({ dayAnchorByCut: { M: 1 }, dayLockByCut: { M: 1 }, wholeDayByCut: { M: 1 } }, frozenDay1), pp)),
    'M');
assert(mBothFrozen === 1,
    '#4506: «Зафиксировать» + «По весу» вместе — выбранный (замороженный) день удержан фикс-якорем (= ' + mBothFrozen + ')');

// ── Часть B: контроллер moveCutToDay — fix ⇒ ФИКС-якорь (без weightPositionCutIds) + честный тост ──
function stubSelf(movedCut, landDayOff, capture) {
    return {
        busy: false,
        meta: { cut: { id: '1078', reqs: [] } },   // reqs пуст → reqIdByName вернёт null (фикс-запись пропустится, но moveScope зависит от fix, не от неё)
        cuts: [movedCut],
        slitters: [{ id: '1', label: 'Станок 1' }],
        filter: { date: '2026-07-20', dateTo: '2026-07-31' },
        changeTimes: {}, daySettings: {}, opTimes: {},
        nowMs: function () { return new Date(2026, 6, 20, 0, 0, 0, 0).getTime(); },
        workingWindow: function () { return { startMin: 480, cutEndMin: 990, endMin: 990, lunchStartMin: 0, lunchDurationMin: 0, cleanupMin: 30, maxOverworkTuneMin: 10, maxOverworkCutsMin: 5 }; },
        slitterOnVacationDay: function () { return false; },
        setBusy: function () {}, showProgress: function () {}, updateProgress: function () {}, hideProgress: function () {}, render: function () {},
        post: function () { return Promise.resolve({}); },
        reload: function () {
            // Эмуляция раскладки: задание оказывается на дне landDayOff (27=цель, 28=сдвиг).
            movedCut.planDate = String(Math.floor(new Date(2026, 6, landDayOff, 8, 0, 0, 0).getTime() / 1000));
            return Promise.resolve();
        },
        notify: function (msg, kind) { capture.notify = { msg: msg, kind: kind }; },
        autoSequenceQueue: function (strategy, preserve, moveScope) { capture.moveScope = moveScope; return Promise.resolve(true); }
    };
}
function newCut() { return { id: 'C1', slitter: { id: '1' }, materialId: 'MB', winding: 'OUT', plannedRuns: 1, planDate: String(Math.floor(new Date(2026, 6, 28, 8, 0, 0, 0).getTime() / 1000)), status: '' }; }

function runMove(fix, position, landDay) {
    var capture = {};
    var c = newCut();
    var self = stubSelf(c, landDay, capture);
    return Controller.prototype.moveCutToDay.call(self, c, '2026-07-27', position, fix, '', true)
        .then(function () { return capture; });
}

Promise.resolve()
    .then(function () { return runMove(true, 'weight', 27); })   // «Зафиксировать» + «По весу», легло на цель 27
    .then(function (cap) {
        var wlFix = cap.moveScope && cap.moveScope.weightPositionCutIds;
        assert(!!(wlFix && wlFix.length === 1 && String(wlFix[0]) === 'C1'),
            '#4506: fix=true + «По весу» — задание отдано в замок дня (место в дне выбирают веса), день держит фикс-якорь');
        // #4693 (решение заказчика 11.08.2026, отменяет #4488): «У всех перестановок единое
        // правило» — день не превышает потолок, а перенесённое берёт столько, сколько в дне
        // осталось; хвост уезжает в следующий день. Резерв «целиком» не выдаётся ни при каком
        // положении: с ним упаковщик, которому вытеснять некого (соседи под 🔒), крошил их по
        // одному проходу — боевая ateh1 10.08.2026: 492 мин при потолке 455, 🔒-задания 2→1,
        // 7→1 и 27→1 прохода.
        assert(!(cap.moveScope && cap.moveScope.wholeDayCutIds && cap.moveScope.wholeDayCutIds.length),
            '#4693: резерв «целиком» перенесённому НЕ выдаётся — задание берёт остаток дня');
        assert(cap.notify && cap.notify.kind === 'success' && /27\.07\.2026/.test(cap.notify.msg),
            '#4390-B: легло на целевой день → тост success с датой 27.07 (' + (cap.notify && cap.notify.msg) + ')');
    })
    .then(function () { return runMove(false, 'weight', 27); })  // без фиксации — мягкий замок как прежде
    .then(function (cap) {
        var wl = cap.moveScope && cap.moveScope.weightPositionCutIds;
        assert(!!(wl && wl.length === 1 && String(wl[0]) === 'C1'),
            '#4390-B: fix=false + «По весу» — прежнее поведение: weightPositionCutIds = [C1]');
    })
    .then(function () { return runMove(true, 'weight', 28); })   // фикс, но упаковщик всё же сдвинул на 28 (день переполнен)
    .then(function (cap) {
        assert(cap.notify && cap.notify.kind === 'warning' && /28\.07\.2026/.test(cap.notify.msg),
            '#4390-B: если после раскладки задание всё же на 28 — НЕ молчим, тост warning с фактическим днём (' + (cap.notify && cap.notify.msg) + ')');
        assert(cap.notify && /не удал|не вмест|переполн|заморож/i.test(cap.notify.msg),
            '#4390-B: предупреждение объясняет причину (день не вместил/переполнен/заморожен)');
    })
    .then(function () {
        console.log('\n' + passed + '/' + total + ' проверок прошло');
        if (passed !== total) process.exitCode = 1;
    })
    .catch(function (e) { console.error(e); process.exitCode = 1; });
