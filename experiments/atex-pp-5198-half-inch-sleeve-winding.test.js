// Tests for ideav/crm#5198 — намотка на втулку 0.5″ идёт по своей норме WIND_05_<метры>.
//
// ПРАВИЛО (ТЗ §6): задание на втулке 0.5 дюйма наматывается медленно, его проход стоит норму серии
// `WIND_05_<метры>` («Намотка 0,5 до 110 метров», WIND_05_110 = 4 мин) при ЛЮБОЙ длине: 74 м → 4,
// 300 м → 4, 600 м → 4. Серия читается тем же порогом, что базовая: заведут WIND_05_300 — проходы до
// 300 м встанут на неё. Втулка 0.5″ старше узкой серии и фольги. Втулка 1″ / неизвестна — как раньше.
//
// Шлюз один — `windPointsForCut`; признак берётся из `sleeveInches` резки/плана/раскладки.
//
// Run with: node experiments/atex-pp-5198-half-inch-sleeve-winding.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { failed++; console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

// Нормы ateh на 19.10.2026.
var TIMES = {
    WIND_300: 1.5, WIND_450: 1.8, WIND_600: 4, WIND_900: 5, WIND_1000: 5.3, WIND_1100: 5.6,
    WIND_FOIL_305: 4, WIND_05_110: 4, WIND_W30_300: 2.25, WIND_W30_450: 2.7, WIND_W30_600: 6,
    BETWEEN_CUTS: 2
};
var pts = planning.windingPointsFromTimes(TIMES);
function cut(o) { return { isFoil: !!o.foil, knifeWidths: o.kw || [57, 57], sleeveInches: o.inch }; }

// ── 1. Любая длина на втулке 0.5″ → WIND_05_110 ──
[30, 74, 100, 110, 300, 450, 600, 1000].forEach(function (L) {
    assertEqual(planning.windingMinutes(L, planning.windPointsForCut(cut({ inch: 0.5 }), pts)), 4,
        'втулка 0.5″, проход ' + L + ' м → 4 мин (WIND_05_110)');
});
assertEqual(planning.plannedCutDurationMinutes(74, 10, TIMES, cut({ inch: 0.5 })), 40,
    'втулка 0.5″: 74 м × 10 проходов → 40 мин намотки');
assertEqual(planning.cutTimingDetails(74, 10, TIMES, cut({ inch: '0.50' })),
    'Метраж прохода: 74 м\nПлановых проходов: 10\nНорма намотки: WIND_05_110=4 мин\nНамотка: 4 * 10 = 40 мин\nЛидер: 2 * 10 = 20 мин\nИтого резка: 40 + 20 = 60 мин',
    'тайминг: подпись нормы WIND_05_110 (дюймы строкой из отчёта)');

// ── 2. Старшинство: 0.5″ старше узкой серии и фольги ──
assertEqual(planning.windingMinutes(300, planning.windPointsForCut(cut({ inch: 0.5, kw: [25, 57] }), pts)), 4,
    'втулка 0.5″ + узкая полоса → WIND_05_110, не WIND_W30_300');
assertEqual(planning.windingMinutes(610, planning.windPointsForCut(cut({ inch: 0.5, foil: true }), pts)), 4,
    'втулка 0.5″ + фольга → WIND_05_110, не блоки фольги (8)');

// ── 3. Остальные втулки — без изменений ──
assertEqual(planning.windingMinutes(74, planning.windPointsForCut(cut({ inch: 1 }), pts)), 1.5, 'втулка 1″, 74 м → WIND_300');
assertEqual(planning.windingMinutes(74, planning.windPointsForCut(cut({}), pts)), 1.5, 'дюймы неизвестны, 74 м → WIND_300');
assertEqual(planning.windingMinutes(300, planning.windPointsForCut(cut({ inch: 1, kw: [25] }), pts)), 2.25, 'втулка 1″ + узкая → WIND_W30_300');
assertEqual(planning.windingMinutes(74, planning.windPointsForCut(true, pts)), 4, 'старый булев isFoil → фольга');

// ── 4. Серия порогом: заведена WIND_05_300 ──
var pts2 = planning.windingPointsFromTimes(Object.assign({}, TIMES, { WIND_05_300: 6 }));
var half2 = planning.windPointsForCut(cut({ inch: 0.5 }), pts2);
assertEqual(planning.windingMinutes(100, half2), 4, 'WIND_05_110+WIND_05_300: 100 м → 4');
assertEqual(planning.windingMinutes(200, half2), 6, 'WIND_05_110+WIND_05_300: 200 м → 6 (порог 300)');
assertEqual(planning.windingMinutes(900, half2), 6, 'WIND_05_110+WIND_05_300: 900 м → 6 (последняя)');

// ── 5. Нет строки WIND_05_ → втулка 0.5″ на базовой серии ──
var noHalf = planning.windingPointsFromTimes({ WIND_300: 1.5, WIND_600: 4 });
assertEqual(planning.windingMinutes(74, planning.windPointsForCut(cut({ inch: 0.5 }), noHalf)), 1.5,
    'нет WIND_05_ в справочнике → базовая серия');

// ── 6. Загрузка из cut_planning: колонка «Дюймы» → sleeveInches задания ──
function row(id, inch) { return { cut_id: id, cut_plan_date: '1784610000', cut_length: '74', cut_planned_runs: '3', 'Дюймы': inch }; }
var parsed = planning.rowsToPlanning([row('1', '0.50'), row('2', '1.00'), row('3', ''), row('4', '1.00'), row('4', '0.50')]);
var byId = {};
parsed.cuts.forEach(function (c) { byId[c.id] = c; });
assertEqual(byId['1'].sleeveInches, 0.5, 'cut_planning «Дюймы» = 0.50 → sleeveInches 0.5');
assertEqual(byId['2'].sleeveInches, 1, 'cut_planning «Дюймы» = 1.00 → sleeveInches 1');
assertEqual(byId['3'].sleeveInches == null, true, 'cut_planning «Дюймы» пусто → дюймы неизвестны');
assertEqual(byId['4'].sleeveInches, 0.5, 'смешанные втулки в одном задании → 0.5 (медленная намотка)');
assertEqual(planning.plannedCutDurationMinutes(74, 3, TIMES, byId['1']), 12, 'задание из cut_planning на 0.5″: 74 м × 3 → 12 мин');

// ── 7. Генерация: позиции 0.5″ → группа профиля несёт sleeveInches ──
var groups = planning.groupPositionsByPlanningProfile([
    { id: 'a', materialId: 'm', windDir: 'OUT', windLength: 74, sleeveId: 's05', sleeveInches: 0.5 },
    { id: 'b', materialId: 'm', windDir: 'OUT', windLength: 74, sleeveId: 's1', sleeveInches: 1 }
]);
var gHalf = groups.filter(function (g) { return g.sleeveId === 's05'; })[0];
var gOne = groups.filter(function (g) { return g.sleeveId === 's1'; })[0];
assertEqual(gHalf.sleeveInches, 0.5, 'группа позиций на втулке 0.5″ → sleeveInches 0.5');
assertEqual(planning.plannedCutDurationMinutes(74, 3, TIMES, { isFoil: gHalf.isFoil, sleeveInches: gHalf.sleeveInches }), 12,
    'раскладка группы 0.5″: 74 м × 3 → 12 мин');
assertEqual(planning.plannedCutDurationMinutes(74, 3, TIMES, { isFoil: gOne.isFoil, sleeveInches: gOne.sleeveInches }), 4.5,
    'раскладка группы 1″: 74 м × 3 → 4.5 мин');

// ── 8. «Расчёт оптимальной резки»: та же норма по выбранной втулке ──
var core = require('../download/atex/js/cut-optimizer.js').core;
assertEqual(core.windingMinutes(74, core.windingPointsFromTimes(TIMES, '0.5')), 4, 'калькулятор: втулка 0.5″, 74 м → 4 мин');
assertEqual(core.windingMinutes(600, core.windingPointsFromTimes(TIMES, 0.5)), 4, 'калькулятор: втулка 0.5″, 600 м → 4 мин');
assertEqual(core.windingMinutes(74, core.windingPointsFromTimes(TIMES, '1')), 1.5, 'калькулятор: втулка 1″, 74 м → 1.5 мин');
assertEqual(core.windingMinutes(74, core.windingPointsFromTimes(TIMES)), 1.5, 'калькулятор: втулка не выбрана → 1.5 мин');
assertEqual(core.planningMinutes(10, 74, core.windingPointsFromTimes(TIMES, '0.5'), 2), 105, 'калькулятор: 45 + 10 × (4 + 2) = 105');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
