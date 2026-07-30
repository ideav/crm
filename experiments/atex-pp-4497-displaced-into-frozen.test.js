// Тесты: вытесненное потолком задание не уезжает в ЗАМОРОЖЕННЫЙ день.
//
// СИМПТОМ (боевое, ateh, Станок 1, Ср 29.07.2026 — 502 мин при потолке 460): оператор перенёс
// задание вручную из 30-го в 29-е. Соседям 29-го надо было уступить место (#4488: перенесённое
// встаёт в день ЦЕЛИКОМ), и упаковщик отправил их «на следующий день». А следующий день — 30-е —
// ЗАМОРОЖЕН. Автоматика замороженный день не трогает (ТЗ §15, #4326/#4347), поэтому запись по
// такому заданию страж отбрасывает — и оно молча остаётся в 29-м. День так и стои́т переполненным,
// причём НИКТО об этом не говорит: `levelDayLoad` на пути ручного переноса 🗓 не вызывается.
//
// ПРИЧИНА в одной строке: ветка #4467 («не влезает в остаток дня — уезжает целиком») ставила
// `st.fixedDay = day + 1` не глядя, заморожен ли этот день. Едем к ближайшему СВОБОДНОМУ — то же
// решение, что #4494 принял для остатка задания ручного переноса.
//
//   A — вытесненное задание не встаёт в замороженный день;
//   B — день-донор при этом реально разгружается (≤ потолка), а не остаётся переполненным;
//   C — задание доезжает до ближайшего свободного дня, а не теряется;
//   D — без заморозки поведение прежнее: следующий день (регресс-контроль #4467).
//
// Run with: node experiments/atex-pp-4497-displaced-into-frozen.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh', xsrf: 'x' };
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 };
var CAP = 450, OVER = 5, TUNE = 10;   // потолок резки 455, настройки 460
function K(pairs) { var a = []; pairs.forEach(function (p) { for (var i = 0; i < p[1]; i++) a.push(p[0]); }); return a; }
function cut(id, mat, knives, runs) {
    return { id: id, materialId: mat, winding: 'OUT', batchId: 'B1', knifeWidths: knives,
             knifeCount: knives.length, rollerWidth: knives[0], plannedRuns: runs, isFoil: false, fixed: true };
}
// День 0 = 29.07: свои 🔒 A и B по 200 мин + перенесённое вручную M (200 мин) = 600 при потолке 460.
// M по правилу #4488 ложится целиком → кому-то из соседей придётся уехать.
function pack(frozenDays) {
    var cuts = [cut('A', 'MA', K([[40, 22]]), 20), cut('B', 'MB', K([[110, 8]]), 20), cut('M', 'MC', K([[25, 35]]), 20)];
    var o = { dayStartMin: 480, dayEndMin: 480 + CAP, dayEndHourMin: 480 + CAP,
              maxOverworkCutsMin: OVER, maxOverworkTuneMin: TUNE, times: TIMES,
              perPassByCut: { A: 10, B: 10, M: 10 }, runsByCut: { A: 20, B: 20, M: 20 },
              dayAnchorByCut: { A: 0, B: 0, M: 0 }, wholeDayByCut: { M: 0 },
              gapFill: true, orderAuthoritative: true };
    if (frozenDays && frozenDays.length) {
        o.frozenDayFor = function (d) { return frozenDays.indexOf(d) >= 0; };
    }
    return P.splitMachineQueue(cuts, o);
}
function minutesByDay(segs) {
    var out = {};
    segs.forEach(function (s) { out[s.dayOffset] = (out[s.dayOffset] || 0) + (Number(s.setupMin) || 0) + (Number(s.durationMin) || 0); });
    Object.keys(out).forEach(function (d) { out[d] = Math.round(out[d]); });
    return out;
}
function dayOf(segs, id) {
    var s = segs.filter(function (x) { return String(x.cutId) === id && !x.setupOnly; })[0];
    return s ? s.dayOffset : null;
}
function daysUsed(segs) { return Object.keys(minutesByDay(segs)).map(Number).sort(function (a, b) { return a - b; }); }

// ── A/B/C: следующий день заморожен ─────────────────────────────────────────────────────────
(function () {
    var segs = pack([1]);   // день 1 (=30.07) заморожен
    var mins = minutesByDay(segs);
    var used = daysUsed(segs);
    assert(used.indexOf(1) < 0,
        '#4497-A: в замороженный день ничего не поставлено', '(занятые дни: ' + used.join(',') + ')');
    assert((mins[0] || 0) <= CAP + TUNE,
        '#4497-B: день-донор разгружен — ' + (mins[0] || 0) + ' мин при потолке ' + (CAP + TUNE));
    assert(dayOf(segs, 'M') === 0,
        '#4497-B: перенесённое вручную осталось в выбранном дне (#4488)', '(день ' + dayOf(segs, 'M') + ')');
    // ОЖИДАНИЕ ИЗМЕНЕНО (#4512, решение заказчика 30.07.2026). Здесь все три задания 🔒, и
    // утверждалось, что один сосед УЕЗЖАЕТ целиком, уступая место ручному переносу. Теперь
    // зафиксированных не вытесняют ни при каких обстоятельствах: вместо переезда соседа срабатывает
    // разрыв по потолку (#4304) — ГОЛОВЫ всех трёх остаются в дне 0, а остаток уезжает к ближайшему
    // СВОБОДНОМУ дню, перескакивая замороженный (это и проверяет #4497-A выше).
    var moved = ['A', 'B'].filter(function (id) { return dayOf(segs, id) !== 0; });
    assert(moved.length === 0,
        '#4497-C: ни один 🔒-сосед не уехал целиком — вместо вытеснения сработал разрыв (#4512)',
        '(' + (moved.map(function (id) { return id + '→д' + dayOf(segs, id); }).join(', ') || 'никто') + ')');
    assert(daysUsed(segs).indexOf(2) >= 0,
        '#4497-C: остаток разрыва доехал до ближайшего СВОБОДНОГО дня (2)',
        '(занятые дни: ' + daysUsed(segs).join(',') + ')');
})();

// ── подряд идущие замороженные дни ──────────────────────────────────────────────────────────
(function () {
    var segs = pack([1, 2, 3]);
    var used = daysUsed(segs);
    assert(used.indexOf(1) < 0 && used.indexOf(2) < 0 && used.indexOf(3) < 0,
        '#4497-A: перескакиваем ВСЮ череду замороженных дней', '(занятые дни: ' + used.join(',') + ')');
    assert((minutesByDay(segs)[0] || 0) <= CAP + TUNE,
        '#4497-B: день-донор всё равно в пределах потолка', '(' + (minutesByDay(segs)[0] || 0) + ')');
})();

// ── D: без заморозки — прежнее поведение (#4467) ────────────────────────────────────────────
(function () {
    var segs = pack(null);
    // ОЖИДАНИЕ ИЗМЕНЕНО там же (#4512): без заморозки — то же правило, только остаток уезжает на
    // СЛЕДУЮЩИЙ день (пропускать нечего). Целиком по-прежнему не уезжает никто.
    var moved = ['A', 'B'].filter(function (id) { return dayOf(segs, id) !== 0; });
    assert(moved.length === 0,
        '#4497-D: без заморозки 🔒-соседи тоже не уезжают целиком (#4512)',
        '(' + (moved.map(function (id) { return id + '→д' + dayOf(segs, id); }).join(', ') || 'никто') + ')');
    assert(daysUsed(segs).indexOf(1) >= 0,
        '#4497-D: остаток разрыва уехал на следующий день (1)',
        '(занятые дни: ' + daysUsed(segs).join(',') + ')');
    assert((minutesByDay(segs)[0] || 0) <= CAP + TUNE,
        '#4497-D: и день-донор в пределах потолка', '(' + (minutesByDay(segs)[0] || 0) + ')');
})();

// ── E: ШЛЮЗ — переполнение по ХРАНИМЫМ минутам не проходит молча ────────────────────────────
// Правило `DAY_CAPACITY` реестра меряет числа САМОГО упаковщика (`ops.dayLoad`) — они всегда в
// пределах потолка, поэтому поймать раздутый бейдж оно не может в принципе. Проверять надо то же,
// что видит оператор: сумму хранимых колонок. И делать это в ОБЩЕЙ точке записи (applySplitPlan),
// а не только на путях ↑↓/перетаскивания.
(function () {
    var Controller = require('../download/atex/js/production-planning.js').Controller;
    var said = [];
    var self = {
        slitters: [{ id: '1', label: 'Станок 1' }, { id: '2', label: 'Станок 2' }],
        overfilledDaysOf: function (sid) {
            return sid === '1' ? [{ dayOffset: 0, endMin: 502, overMin: 42 }] : [];
        },
        warnOverfilledDays: function (sid) { said.push(String(sid)); return []; }
    };
    var hit = Controller.prototype.reportOverfilledDays.call(self);
    assert(hit.join(',') === '1',
        '#4497-E: шлюз называет станок с переполненным днём', '(' + hit.join(',') + ')');
    assert(said.join(',') === '1',
        '#4497-E: и говорит оператору — молча переполнение не проходит', '(' + said.join(',') + ')');

    var quiet = { slitters: [{ id: '1' }], overfilledDaysOf: function () { return []; },
                  warnOverfilledDays: function () { said.push('нет'); return []; } };
    assert(Controller.prototype.reportOverfilledDays.call(quiet).length === 0,
        '#4497-E: когда всё в пределах смены — молчит (не шумим на ровном месте)');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
if (passed !== total) process.exitCode = 1;
