// #5092 — ЗАДАНИЕ ЗАТАСКИВАЕТСЯ ВО ВЧЕРАШНИЙ ДЕНЬ.
//
// СИМПТОМ (боевое 06.10.2026, ateh, 12:58 МСК, Станок 1285). Задание 918853 (срок 05.10) оператор
// перенёс 🗓 в 07.10 с «Зафиксировано». При следующем переносе ДРУГОГО задания (908201) пересборка
// «по срокам» положила 918853 в 05.10 — во вчерашний день: трасса «резка 918853 05.10 12:39→14:03».
//
// ПРИЧИНА. День 0 упаковщика — дата фильтра «С» (здесь 05.10), а не сегодня. Правило ТЗ #4740
// «в отработанный станко-день обратно не кладут ничего» упаковщик держал только в режиме паровоза
// (`trainOnly`, пол #4743). Пересборка после 🗓 идёт без паровоза, пола у неё не было: 918853 —
// 🔒 в хвосте ручного сдвига (#4736, якорь дня снят) — упало на день 0, раз срок у него день 0.
//
// ЧТО ПРОВЕРЯЕМ (движок, `planCutOperations`, все режимы раскладки):
//   A — боевое воспроизведение: 🔒 хвоста ручного сдвига не попадает в отработанный день 0;
//   B — правило целиком: ни одно задание не затаскивается в отработанный день из более позднего —
//       при любом сочетании preserveOrder / trainOnly / ручного сдвига 🔒;
//   C — начатое задание в отработанном дне остаётся там, где стоит (правило не про сделанное);
//   D — 🔒 хвоста ручного сдвига (#4736) меняет день, но не порядок: никого не обгоняет и не
//       пропускает вперёд себя то, что стояло после неё.
//
// Run with: node experiments/atex-pp-5092-no-past-day.test.js

process.env.TZ = 'Europe/Moscow';

var mod = require('../download/atex/js/production-planning.js');
var planning = mod.planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var SID = '1285';
var BASE = new Date(2026, 9, 5, 0, 0, 0, 0).getTime();   // Пн 05.10.2026 = «С» = день 0 = вчера
var D0 = Math.floor(BASE / 1000) + 8 * 3600, DAY = 86400;

function widths(n, w) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
function dayOf(tsSec) { return Math.floor((Number(tsSec) * 1000 - BASE) / 86400000); }

function engCut(id, o) {
    return { id: id, slitter: { id: SID }, materialId: o.mat || 'MR192', winding: 'OUT', batchId: 'B' + (o.mat || 'MR192'),
             knifeWidths: widths(10, o.w || 59), knifeCount: 10, rollerWidth: 60, plannedRuns: o.runs,
             isFoil: false, status: '', fixed: !!o.fixed, firstPartId: id,
             startDate: o.started ? String(D0 + o.day * DAY) : '', endDate: '',
             planDate: String(D0 + o.day * DAY + (o.min || 0) * 60) };
}

// worked(d): вчерашний день (0) отработан — прошёл. Сегодня (1) и дальше открыты.
function pack(cuts, o) {
    var pp = {}, anchor = {}, due = {};
    cuts.forEach(function (c) {
        pp[String(c.id)] = 10;
        due[String(c.id)] = o.due && o.due[c.id] != null ? o.due[c.id] : 30;
        anchor[String(c.id)] = dayOf(c.planDate);
    });
    var ops = planning.planCutOperations(cuts, {
        planBaseMidnightMs: BASE, weights: {}, times: { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 },
        dayStartMin: 480, dayEndMin: 930, dayEndHourMin: 930, maxOverworkCutsMin: 5, maxOverworkTuneMin: 10,
        lunchStartMin: 740, lunchDurationMin: 40, gapFill: true, preserveOrder: !!o.preserveOrder,
        trainOnly: !!o.trainOnly, deadlineAware: !o.preserveOrder, slotPlacement: !!o.slot, firstCutSetup: false, prevSetupBySlitter: {},
        intraDayResequence: true, perPassByCut: pp, slitterIds: [SID], dueDayByCut: due, dueKeyByCut: {},
        dayAnchorByCut: anchor,
        workedDayForSlitter: function () { return function (d) { return Number(d) <= 0; }; },
        manualShiftByCut: o.shiftBy || {}
    });
    var days = {}, ts = {};
    cuts.forEach(function (c) { ts[String(c.id)] = Number(c.planDate); });
    (ops.updates || []).forEach(function (u) {
        if (u.planStartTs == null) return;
        days[String(u.cutId)] = dayOf(u.planStartTs);
        ts[String(u.cutId)] = Number(u.planStartTs);
    });
    days.order = Object.keys(ts).sort(function (x, y) { return ts[x] - ts[y]; });
    return days;
}

// ── A. БОЕВОЕ: 🔒 В ХВОСТЕ РУЧНОГО СДВИГА, СРОК — ВЧЕРА ─────────────────────────────────────────
(function () {
    var cuts = [engCut('c908248', { day: 0, runs: 3, fixed: true, started: true }),
                engCut('c918853', { day: 2, runs: 4, fixed: true }),
                engCut('c894688', { day: 1, runs: 3, mat: 'MR200' })];
    var days = pack(cuts, { due: { c918853: 0, c894688: 1 }, shiftBy: { c918853: true } });
    assert(days.c918853 == null || days.c918853 >= 1,
        'A. #5092: 🔒 из хвоста ручного сдвига не уезжает во вчерашний (отработанный) день',
        'день=' + days.c918853);
})();

// ── B. ПРАВИЛО ЦЕЛИКОМ: НИ ОДНО ЗАДАНИЕ БЕЗ ФАКТА НЕ ЛОЖИТСЯ В ОТРАБОТАННЫЙ ДЕНЬ ───────────────
(function () {
    var modes = [{ preserveOrder: false, trainOnly: false }, { preserveOrder: true, trainOnly: false },
                 { preserveOrder: true, trainOnly: true }];
    var shifts = [{}, { f2: true }, { f2: true, f3: true }];
    var bad = [];
    modes.forEach(function (m) {
        shifts.forEach(function (sh) {
            [0, 1, 2].forEach(function (startDay) {
                var cuts = [engCut('s1', { day: 0, runs: 2, fixed: true, started: true }),
                            engCut('f2', { day: startDay + 1, runs: 4, fixed: true }),
                            engCut('f3', { day: startDay + 1, min: 120, runs: 3, fixed: true, mat: 'MR200' }),
                            engCut('n4', { day: startDay, runs: 5 }),
                            engCut('n5', { day: startDay, min: 90, runs: 2, mat: 'MR200' })];
                var days = pack(cuts, { preserveOrder: m.preserveOrder, trainOnly: m.trainOnly, shiftBy: sh,
                    due: { f2: 0, f3: 0, n4: 0, n5: 0 } });
                ['f2', 'f3', 'n4', 'n5'].forEach(function (id) {
                    var own = cuts.filter(function (c) { return c.id === id; })[0];
                    if (dayOf(own.planDate) < 1) return;   // уже стоит в отработанном — правило о затаскивании
                    if (days[id] != null && days[id] < 1) {
                        bad.push(JSON.stringify(m) + ' shift=' + Object.keys(sh).join(',') + ' start=' + startDay +
                            ' ' + id + '→день ' + days[id]);
                    }
                });
            });
        });
    });
    assert(bad.length === 0, 'B. #4740/#5092: в отработанный день не затаскивают ни в одном режиме',
        bad.slice(0, 4).join('; '));
})();

// ── C. НАЧАТОЕ В ОТРАБОТАННОМ ДНЕ СТОИТ НА МЕСТЕ ────────────────────────────────────────────────
(function () {
    var cuts = [engCut('s1', { day: 0, runs: 3, fixed: true, started: true }),
                engCut('n2', { day: 1, runs: 3 })];
    var days = pack(cuts, { due: { n2: 0 } });
    assert(days.s1 == null || days.s1 === 0, 'C. начатое задание из отработанного дня не уезжает',
        'день=' + days.s1);
})();

// ── D. 🔒 ХВОСТА РУЧНОГО СДВИГА МЕНЯЕТ ДЕНЬ, НО НЕ ПОРЯДОК (#4736) ─────────────────────────────
// Хранимый порядок a, b, c, 🔒L, d; срок у L — вчера, у остальных поздний. Пересборка вправе
// переставлять свободные между собой, но L остаётся после a, b, c и перед d — в любом режиме.
(function () {
    var bad = [];
    [{ preserveOrder: false, slot: false }, { preserveOrder: false, slot: true },
     { preserveOrder: true, slot: false }, { preserveOrder: true, slot: true }].forEach(function (m) {
        var cuts = [engCut('a', { day: 1, runs: 6 }), engCut('b', { day: 1, min: 90, runs: 6, mat: 'MR200' }),
                    engCut('c', { day: 1, min: 200, runs: 6, w: 40 }),
                    engCut('L', { day: 2, runs: 4, fixed: true, mat: 'MR300' }),
                    engCut('d', { day: 2, min: 60, runs: 4 })];
        var r = pack(cuts, { preserveOrder: m.preserveOrder, slot: m.slot, shiftBy: { L: true },
            due: { a: 5, b: 5, c: 5, L: 0, d: 6 } });
        var pos = {};
        r.order.forEach(function (id, i) { pos[id] = i; });
        if (!(pos.a < pos.L && pos.b < pos.L && pos.c < pos.L && pos.L < pos.d)) {
            bad.push(JSON.stringify(m) + ' → ' + r.order.join(','));
        }
    });
    assert(bad.length === 0, 'D. #5092/#4736: 🔒 хвоста ручного сдвига не меняет порядок ни в одном режиме',
        bad.join('; '));
})();

console.log('\n' + passed + '/' + total + ' проверок прошли');
if (passed !== total) process.exitCode = 1;
