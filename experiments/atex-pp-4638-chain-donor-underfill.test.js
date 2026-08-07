// #4638 — 🔒 ДЕРЖИТ ДЕНЬ ЗВЕНА, А НЕ ТОЧКУ РАЗБИЕНИЯ ЦЕПОЧКИ.
//
// СЦЕНАРИЙ ЗАКАЗЧИКА (боевая ateh, Пт 07.08.2026, после «Урегулировать»):
//   «День не набит до конца на станках 1 и 4. Неправильно разбит 4608 — не добрали полчаса из
//    завтра в сегодня. То же с 4532.»
//
// ЧТО В БАЗЕ. Ёмкость станко-дня ateh = 455 мин (08:00–16:30, TOTAL_INTERVALS 20 → потолок резки
// 16:10 + нахлёст 5 = 16:15, обед 12:20×40). Хранимые минуты 07.08:
//   Станок 1 — 425 (свободно 30), последним стои́т голова 4608 (666127, 14 проходов по 3.2 мин),
//              а первым в понедельник — ЕЁ ЖЕ продолжение 666599 на 31 проход, и оно 🔒;
//   Станок 2 — 448 (свободно 7), та же картина с 4576 (голова 662289 → продолжение 666716, 🔒);
//   Станок 4 — 404 (свободно 51), голова 4532 (663847, 11 проходов по 7 мин) → продолжение 666911
//              на 45 проходов, БЕЗ 🔒;
//   Станок 3 — 455, ровно в потолок (донор без 🔒 — день набит).
//
// КОРЕНЬ. Упаковщик тут ни при чём: `planCutOperations` сливает цепочку (`mergeContinuationChains`)
// и пере-разбивает её в 23 + 22 (день 453.6 из 455) даже при 🔒 на ОБОИХ звеньях — проверено п.3.
// Слеп был СТРАЖ: `underfilledLayoutDays` исключал донора с `fixedDayLock` (#4434) не различая,
// ЧЕЙ это замок. Исключение защищает ЧУЖОЕ задание — затянуть его во вчерашний день значит сменить
// его «Дату план». Но продолжение ТОЙ ЖЕ цепочки между днями не переезжает: голова остаётся в
// своём дне, продолжение — в своём, меняется лишь сколько проходов кому досталось (и потолок дня
// уже сегодня режет 🔒 по проходам, #4304/#4467). Пока страж молчал, дыру не видел и объектив
// «Упорядочить» (#4469, недоупаковка — член объектива выше переналадки), и закрыть её было нечем.
//
//   A — чистая underfilledLayoutDays: 🔒-продолжение СВОЕЙ цепочки — донор; чужая 🔒 — нет;
//   B — контроллер на БОЕВЫХ числах 07.08: видны Станок 1 и Станок 4, Станок 3 (455) — нет;
//   C — упаковщик на тех же числах закрывает дыру (23 прохода из 45 в день 0);
//   D — «Урегулировать» не заканчивает молча: warnUnderfilledAfterSettle называет дни.
//
// Run with: node experiments/atex-pp-4638-chain-donor-underfill.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh', xsrf: 'x' };

var mod = require('../download/atex/js/production-planning.js');
var P = mod.planning;
var Controller = mod.Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// ── A. ЧИСТОЕ ПРАВИЛО ───────────────────────────────────────────────────────────────────────────
(function () {
    function seg(cutId, day, start, runs, setup, dur, over) {
        var s = { cutId: cutId, dayOffset: day, windowStartMin: day * 1440 + start, runs: runs,
                  setupMin: setup, durationMin: dur };
        for (var k in (over || {})) s[k] = over[k];
        return s;
    }
    // День 0 набит на 425 из 455 (свободно 30), закрывает его голова цепочки CH; день 1 начинается
    // ЕЁ продолжением — 31 проход по 3.2 мин, зафиксировано 🔒.
    var free = { 0: 30, 1: 400 };
    function freeMinFor(d) { return free[d] != null ? free[d] : 0; }
    var ownChain = [
        seg('OTHER', 0, 0, 100, 0, 380),
        seg('HEAD', 0, 380, 14, 0, 44.8, { chainId: 'HEAD' }),
        seg('CONT', 1, 0, 31, 0, 99.2, { chainId: 'HEAD', fixedDayLock: true })
    ];
    var bad = P.underfilledLayoutDays(ownChain, { freeMinFor: freeMinFor });
    assertEqual(bad.map(function (u) { return u.day; }), [0],
        'A1 🔒-продолжение СВОЕЙ цепочки — донор: день 0 недоупакован (30 мин при проходе 3.2)');
    assert(bad[0] && String(bad[0].donorCutId) === 'CONT', 'A2 донором назван сегмент продолжения');

    // Чужое 🔒-задание следующего дня донором по-прежнему НЕ является (#4434 не тронут).
    var foreign = [
        seg('OTHER', 0, 0, 100, 0, 380),
        seg('HEAD', 0, 380, 14, 0, 44.8, { chainId: 'HEAD' }),
        seg('F9', 1, 0, 31, 0, 99.2, { chainId: 'F9', fixedDayLock: true })
    ];
    assertEqual(P.underfilledLayoutDays(foreign, { freeMinFor: freeMinFor }), [],
        'A3 ЧУЖАЯ 🔒 следующего дня донором не стала — замок дня абсолютен (#4434)');

    // Продолжение своей цепочки, но день закрывает ДРУГОЕ задание — замок снова в силе: затянуть
    // продолжение назад значило бы поставить его перед чужой работой, а его голова уже позади.
    var notTail = [
        seg('HEAD', 0, 0, 14, 0, 44.8, { chainId: 'HEAD' }),
        seg('OTHER', 0, 44.8, 100, 0, 380),
        seg('CONT', 1, 0, 31, 0, 99.2, { chainId: 'HEAD', fixedDayLock: true })
    ];
    assertEqual(P.underfilledLayoutDays(notTail, { freeMinFor: freeMinFor }), [],
        'A4 день закрывает чужое задание — 🔒-продолжение остаётся исключением');

    // Начатое (#4381) послаблению не подлежит: работа уже идёт, проходы не наши.
    var started = [
        seg('OTHER', 0, 0, 100, 0, 380),
        seg('HEAD', 0, 380, 14, 0, 44.8, { chainId: 'HEAD' }),
        seg('CONT', 1, 0, 31, 0, 99.2, { chainId: 'HEAD', immovable: true })
    ];
    assertEqual(P.underfilledLayoutDays(started, { freeMinFor: freeMinFor }), [],
        'A5 начатое продолжение неприкосновенно и под своей цепочкой (#4381)');

    // Замороженный день (#4436) — как прежде, ни приёмник, ни донор.
    assertEqual(P.underfilledLayoutDays(ownChain, { freeMinFor: freeMinFor, isFrozenDay: function (d) { return d === 1; } }), [],
        'A6 замороженный день-донор не отдаёт проходов и в своей цепочке (#4436)');

    // Проход атомарен (#4149): в 2 мин остатка проход 3.2 не влезает.
    assertEqual(P.underfilledLayoutDays(ownChain, { freeMinFor: function (d) { return d === 0 ? 2 : 400; } }), [],
        'A7 остаток меньше одного прохода — не нарушение (#4149)');
})();

// ── B. КОНТРОЛЛЕР НА БОЕВЫХ ЧИСЛАХ 07.08.2026 ───────────────────────────────────────────────────
var BASE = new Date(2026, 7, 7, 0, 0, 0, 0).getTime();          // «С» = Пт 07.08.2026
function tsAt(dayOffset, minutes) { return Math.floor(BASE / 1000) + dayOffset * 86400 + minutes * 60; }
var DAY_SETTINGS = { DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
    LUNCH_DURATION: '40', TOTAL_INTERVALS: '20', MAX_OVERWORK_CUTS_MN: '5', MAX_OVERWORK_TUNE_MN: '10' };
// ёмкость дня = (16:30 − 20) + 5 − 8:00 − 40 = 455 мин.

function cutOf(o) {
    return { id: o.id, orderId: o.order, firstPartId: o.chain || o.id,
        slitter: { id: o.sid, label: o.sname }, materialId: 'MW308', winding: 'OUT',
        knifeWidths: [80, 80], knifeCount: 2, rollerWidth: 0,
        plannedRuns: o.runs, isFoil: false, status: '', fixed: !!o.fixed,
        planDate: String(tsAt(o.day, o.at)), number: String(tsAt(o.day, o.at)),
        duration: String(o.work), storedKnifeSetupMin: '0',
        storedMaterialWindingMin: String(o.setup || 0), storedCutAndLeaderMin: String(o.work) };
}
// Станок 1 (1277): 380 мин чужой работы + голова 4608 (45 мин); понедельник (день 3) — 🔒-продолжение.
// Станок 3 (1282): день ровно в потолок 455 — контроль, что правило не кричит на здоровый день.
// Станок 4 (1285): 282 + голова 4532 (45 наладки + 77 резки = 122) = 404; продолжение БЕЗ 🔒.
function liveCuts() {
    return [
        cutOf({ id: 'M1-FILL', sid: '1277', sname: 'Станок 1', day: 0, at: 480, runs: 100, work: 380, fixed: true }),
        cutOf({ id: '666127', sid: '1277', sname: 'Станок 1', day: 0, at: 860, runs: 14, work: 45, fixed: true }),
        cutOf({ id: '666599', sid: '1277', sname: 'Станок 1', day: 3, at: 480, runs: 31, work: 100, fixed: true, chain: '666127' }),

        cutOf({ id: 'M3-FILL', sid: '1282', sname: 'Станок 3', day: 0, at: 480, runs: 100, work: 394, fixed: true }),
        cutOf({ id: 'M3-TAIL', sid: '1282', sname: 'Станок 3', day: 0, at: 874, runs: 4, work: 16, setup: 45, fixed: true }),
        cutOf({ id: 'M3-CONT', sid: '1282', sname: 'Станок 3', day: 3, at: 480, runs: 18, work: 69, chain: 'M3-TAIL' }),

        cutOf({ id: 'M4-FILL', sid: '1285', sname: 'Станок 4', day: 0, at: 480, runs: 100, work: 282, fixed: true }),
        cutOf({ id: '663847', sid: '1285', sname: 'Станок 4', day: 0, at: 762, runs: 11, work: 77, setup: 45 }),
        cutOf({ id: '666911', sid: '1285', sname: 'Станок 4', day: 3, at: 480, runs: 45, work: 315, chain: '663847' })
    ];
}
function ctrlSelf(cuts) {
    var self = Object.create(Controller.prototype);
    self.busy = false;
    self.meta = {};
    self.cuts = cuts;
    self.filter = { date: '2026-08-07', dateTo: '2026-08-11' };
    self.slitters = [{ id: '1277', label: 'Станок 1' }, { id: '1282', label: 'Станок 3' },
                     { id: '1285', label: 'Станок 4' }];
    self.daySettings = DAY_SETTINGS;
    self.changeTimes = { BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30, KNIFE: 30, MATERIAL_WINDING: 15 };
    self.supplies = []; self.genPositions = [];
    self.freezeByDay = {}; self.calendarByDay = {}; self.downtimesBySlitter = {};
    self.nowMs = function () { return BASE; };
    return self;
}

(function () {
    var cuts = liveCuts();
    // Контроль модели: суммы хранимых минут = бейджи «(N мин)» из боевой базы.
    var load = {};
    cuts.forEach(function (c) {
        var d = Math.floor((Number(c.planDate) * 1000 - BASE) / 86400000);
        var k = c.slitter.id + '|' + d;
        load[k] = (load[k] || 0) + Number(c.storedMaterialWindingMin) + Number(c.storedCutAndLeaderMin);
    });
    assert(load['1277|0'] === 425 && load['1282|0'] === 455 && load['1285|0'] === 404,
        'B0 модель повторяет боевые бейджи 07.08: 425 / 455 / 404 при ёмкости 455',
        '(' + load['1277|0'] + ' / ' + load['1282|0'] + ' / ' + load['1285|0'] + ')');

    assertEqual(ctrlSelf(cuts).planUnderfilledDays(cuts, null), ['1277|20260807', '1285|20260807'],
        'B1 недоупакованы Станок 1 (🔒-продолжение) и Станок 4; Станок 3 в потолок — молчим');

    // Кандидат, затянувший 9 проходов в день 0 (14 → 23, продолжение 31 → 22): дыры нет.
    var ops = { updates: [{ cutId: '666127', planStartTs: tsAt(0, 860), plannedRuns: 23 },
                          { cutId: '666599', planStartTs: tsAt(3, 480), plannedRuns: 22 },
                          { cutId: '663847', planStartTs: tsAt(0, 762), plannedRuns: 18 },
                          { cutId: '666911', planStartTs: tsAt(3, 480), plannedRuns: 38 }],
                creates: [], deletes: [] };
    assertEqual(ctrlSelf(cuts).planUnderfilledDays(cuts, ops), [],
        'B2 план, добравший проходы из понедельника, нарушением не считается');
})();

// ── C. УПАКОВЩИК ЗАКРЫВАЕТ ДЫРУ ДАЖЕ ПРИ 🔒 НА ОБОИХ ЗВЕНЬЯХ ────────────────────────────────────
// Цепочка сливается mergeContinuationChains и режется заново: 45 проходов → 23 сегодня + 22 в
// понедельник, день 0 = 453.6 из 455. Это и есть «полчаса из завтра в сегодня» из тикета.
(function () {
    var ZERO = { KNIFE: 0, KNIFE_MOVE: 0, MATERIAL_WINDING: 0, BETWEEN_CUTS: 0 };
    function rec(id, day, at, runs, fixed, chain) {
        return { id: id, slitter: { id: '1277' }, materialId: 'M1', winding: 'OUT', batchId: 'B1',
                 knifeWidths: [60], knifeCount: 1, rollerWidth: 0, plannedRuns: runs,
                 isFoil: false, status: '', fixed: !!fixed, length: '300',
                 planDate: String(tsAt(day, at)), number: String(tsAt(day, at)), firstPartId: chain || id };
    }
    var cuts = [rec('M1-FILL', 0, 480, 1, true), rec('666127', 0, 860, 14, true),
                rec('666599', 3, 480, 31, true, '666127')];
    var anchors = {};
    cuts.forEach(function (c) { anchors[String(c.id)] = Math.floor((Number(c.planDate) * 1000 - BASE) / 86400000); });
    var ops = P.planCutOperations(cuts, {
        times: ZERO, dayStartMin: 480, dayEndMin: 970, dayEndHourMin: 990,
        maxOverworkCutsMin: 5, maxOverworkTuneMin: 10,
        perPassByCut: { 'M1-FILL': 380, '666127': 3.2, '666599': 3.2 },
        planBaseMidnightMs: BASE, lunchStartMin: 740, lunchDurationMin: 40,
        preserveOrder: true, dayAnchorByCut: anchors, firstCutSetup: true, gapFill: true,
        slitterIds: ['1277'],
        blockedRangesBySlitter: { '1277': [[1440, 4320]] },   // Сб 08.08 и Вс 09.08 нерабочие
        intraDayResequence: true
    });
    var byId = {};
    (ops.updates || []).forEach(function (u) { byId[String(u.cutId)] = u; });
    assert(byId['666127'] && byId['666127'].plannedRuns === 23,
        'C1 голова 4608 забирает 23 прохода вместо 14 (день добит до потолка)',
        '(' + (byId['666127'] && byId['666127'].plannedRuns) + ')');
    assert(byId['666599'] && byId['666599'].plannedRuns === 22,
        'C2 продолжению остаётся 22 — сумма цепочки 45 сохранена',
        '(' + (byId['666599'] && byId['666599'].plannedRuns) + ')');
    assert(byId['666599'] && Math.floor((byId['666599'].planStartTs - Math.floor(BASE / 1000)) / 86400) === 3,
        'C3 продолжение осталось в СВОЁМ дне (понедельник) — замок дня не нарушен');
    assert(Math.round(Number((ops.dayLoad || {})['1277|0'])) === 454,
        'C4 день 0 набит на 454 из 455', '(' + (ops.dayLoad || {})['1277|0'] + ')');
    assertEqual(ops.dayFill || [], [], 'C5 упаковщик своё же правило не нарушает');
})();

// ── D. «УРЕГУЛИРОВАТЬ» НЕ ЗАКАНЧИВАЕТ МОЛЧА ─────────────────────────────────────────────────────
(function () {
    var cuts = liveCuts();
    var self = ctrlSelf(cuts);
    var said = [];
    self.notify = function (msg, kind) { said.push({ msg: msg, kind: kind }); };
    var n = self.warnUnderfilledAfterSettle();
    assert(n === 2, 'D1 названы оба недоупакованных станко-дня', '(' + n + ')');
    assert(said.length === 1 && said[0].kind === 'warning' && /не набит до конца/.test(said[0].msg),
        'D2 оператор получает предупреждение, а не тишину', '(' + (said[0] && said[0].msg) + ')');
    assert(/Упорядочить/.test(said[0].msg), 'D3 сказано, чем дыру закрыть');

    // Здоровый план — молчим (говорить не о чем, а не «всё скрыли»).
    var okCuts = liveCuts().filter(function (c) { return String(c.slitter.id) === '1282'; });
    var ok = ctrlSelf(okCuts);
    var quiet = [];
    ok.notify = function (m) { quiet.push(m); };
    assert(ok.warnUnderfilledAfterSettle() === 0 && quiet.length === 0,
        'D4 дыр нет → ни одного сообщения');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
if (passed !== total) process.exit(1);
