// Unit tests for ideav/crm#3876 — не планировать задание на станок, у которого в этот день
// отпуск (станок без сырья и ножей на время отпуска).
//
//   • slitterDownOnDay        — на отпуске ли станок в КАЛЕНДАРНЫЙ день (закрытое окно);
//   • chooseSlitterBySetup    — исключает станки в отпуске (unavailableSlitterIds), откат если все;
//   • rebalanceSlitterLoad    — не переносит задание на станок в отпуске (opts.slitterDayBlocked);
//   • заправка после отпуска  — пустой prevSetup → первая резка считает полную настройку
//                               (смена сырья + ножи с нуля) через setupActivityColumns.
//
// Run with: node experiments/atex-production-planning-3876.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++; else { failed++; console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

// День (полночь, UTC=TZ): 2026-06-10 → мс.
function dayMs(y, m, d) { return Date.UTC(y, m - 1, d); }
function sec(ms) { return Math.floor(ms / 1000); }

// ── slitterDownOnDay: окно отпуска пересекает сутки ──
(function () {
    var WS = 480, WE = 970;   // рабочее окно резки 08:00–16:10 (#3883: проверяем ПОЛНОЕ покрытие)
    // Отпуск 10–12 июня (закрытое окно: начало 10-го 00:00, конец 12-го 23:59) — покрывает
    // рабочее окно всех трёх дней целиком.
    var dt = [{ start: sec(dayMs(2026, 6, 10)), end: sec(dayMs(2026, 6, 12) + 86399000) }];
    assert(planning.slitterDownOnDay(dt, dayMs(2026, 6, 10), WS, WE), 'slitterDownOnDay: 10 июня — отпуск');
    assert(planning.slitterDownOnDay(dt, dayMs(2026, 6, 11), WS, WE), 'slitterDownOnDay: 11 июня — отпуск');
    assert(planning.slitterDownOnDay(dt, dayMs(2026, 6, 12), WS, WE), 'slitterDownOnDay: 12 июня — отпуск');
    assert(!planning.slitterDownOnDay(dt, dayMs(2026, 6, 9), WS, WE), 'slitterDownOnDay: 9 июня — не отпуск');
    assert(!planning.slitterDownOnDay(dt, dayMs(2026, 6, 13), WS, WE), 'slitterDownOnDay: 13 июня — не отпуск');
    assert(!planning.slitterDownOnDay([], dayMs(2026, 6, 10), WS, WE), 'slitterDownOnDay: нет окон — не отпуск');
    // Окно без «Окончания» — не блокируем (как в расписании, downtimeBlockedRanges).
    assert(!planning.slitterDownOnDay([{ start: sec(dayMs(2026, 6, 10)) }], dayMs(2026, 6, 11), WS, WE),
        'slitterDownOnDay: окно без «Окончания» — не блокирует');
    // #3883: ЧАСТИЧНЫЙ отпуск (2 часа 08:00–10:00) рабочий день НЕ блокирует.
    var part = [{ start: sec(dayMs(2026, 6, 10) + 8 * 3600000), end: sec(dayMs(2026, 6, 10) + 10 * 3600000) }];
    assert(!planning.slitterDownOnDay(part, dayMs(2026, 6, 10), WS, WE),
        'slitterDownOnDay: частичный отпуск 2 часа → НЕ весь день (станок работает)');
})();

// ── chooseSlitterBySetup: станок в отпуске исключается ──
(function () {
    var slitters = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }];
    var cut = { id: 'c1', materialId: 'A', winding: 'OUT', knifeWidths: [50], knifeCount: 1, duration: 100 };
    // Без отпусков — выбирается наименее загруженный (станок 1, load 0).
    var load = { '1': 0, '2': 1, '3': 2, '4': 3 };
    assertEqual(planning.chooseSlitterBySetup(cut, slitters, {}, load, null, 0, {}), '1',
        'chooseSlitterBySetup: без отпусков — наименее загруженный (1)');
    // Станок 1 в отпуске → исключается, выбирается следующий наименее загруженный (2).
    assertEqual(planning.chooseSlitterBySetup(cut, slitters, {}, load, null, 0, { '1': true }), '2',
        'chooseSlitterBySetup: станок 1 в отпуске → выбираем 2');
    // Все станки в отпуске → откат к полному списку (резку не теряем).
    assertEqual(planning.chooseSlitterBySetup(cut, slitters, {}, load, null, 0, { '1': true, '2': true, '3': true, '4': true }), '1',
        'chooseSlitterBySetup: все в отпуске → откат (выбираем как обычно, 1)');
})();

// ── rebalanceSlitterLoad: не переносит задание на станок в отпуске ──
(function () {
    var CAP = 450;
    var SLITTERS = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }];
    function plan(id, sid, dur) {
        return { id: id, slitterId: String(sid), materialId: 'A', winding: 'OUT', knifeWidths: [50], knifeCount: 1, isFoil: false, duration: dur, planDate: sec(dayMs(2026, 6, 10)) };
    }
    // 8×150 на станке 4 (перегруз, 3 дня); 1–3 простаивают. Балансировка раскидала бы 2/2/2/2.
    var plans = [];
    for (var i = 1; i <= 8; i++) plans.push(plan('c' + i, '4', 150));
    // Станок 3 — в отпуске в день этих заданий → балансировка его обходит.
    var res = planning.rebalanceSlitterLoad(plans, SLITTERS, {
        weights: null, dayCapacityMin: CAP,
        slitterDayBlocked: function (sid) { return String(sid) === '3'; }
    });
    var byMachine = {};
    plans.forEach(function (p) { byMachine[p.slitterId] = (byMachine[p.slitterId] || 0) + 1; });
    assertEqual(byMachine['3'] || 0, 0, 'rebalanceSlitterLoad: на станок 3 (отпуск) НЕ перенесли ни одного задания');
    assert(res.moves.length > 0, 'rebalanceSlitterLoad: переносы были (на станки 1/2)');
    assert((byMachine['1'] || 0) > 0 && (byMachine['2'] || 0) > 0, 'rebalanceSlitterLoad: задания ушли на свободные 1 и 2');
    // Контроль: без блокировки станок 3 задействован.
    var plans2 = [];
    for (var j = 1; j <= 8; j++) plans2.push(plan('d' + j, '4', 150));
    planning.rebalanceSlitterLoad(plans2, SLITTERS, { weights: null, dayCapacityMin: CAP });
    var by2 = {};
    plans2.forEach(function (p) { by2[p.slitterId] = (by2[p.slitterId] || 0) + 1; });
    assert((by2['3'] || 0) > 0, 'rebalanceSlitterLoad: без блокировки станок 3 задействован (контроль)');
})();

// ── Заправка после отпуска: пустой prevSetup → полная настройка первой резки ──
(function () {
    var times = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 };
    var cut0 = { id: 'c1', materialId: 'A', winding: 'OUT', knifeWidths: [50], knifeCount: 1, batchId: 'b1' };
    // Станок «как был» (та же заправка, что и резка) → переналадки у первой резки нет.
    var sameSetup = { materialId: 'A', winding: 'OUT', knifeWidths: [50] };
    var colsSame = planning.setupActivityColumns([cut0], times, planning.carryOverPrevCut(sameSetup, cut0));
    assertEqual(colsSame['c1'], { knifeMin: 0, materialWindingMin: 0 },
        'заправка совпадает → первая резка без настройки (контроль)');
    // Станок ПУСТ (отпуск обнулил заправку) → carryOverPrevCut(пусто) → смена сырья + ножи с нуля.
    var emptySetup = { materialId: '', winding: '', knifeWidths: [] };
    var colsEmpty = planning.setupActivityColumns([cut0], times, planning.carryOverPrevCut(emptySetup, cut0));
    assertEqual(colsEmpty['c1'], { knifeMin: 30, materialWindingMin: 15 },
        'станок пуст после отпуска → первая резка: ножи 30 + сырьё 15 (полная настройка)');
})();

console.log('\n' + passed + ' проверок прошло' + (failed ? ', ' + failed + ' упало' : '') + '.');
if (!failed) console.log('Все проверки #3876 зелёные.');
