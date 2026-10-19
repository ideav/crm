// Tests for ideav/crm#5198 — норма намотки берётся ПОРОГОМ, без пропорции и интерполяции.
//
// ПРАВИЛО (ТЗ §6): время намотки одного прохода = минуты БЛИЖАЙШЕЙ НЕ МЕНЬШЕЙ точки серии
// «Время операции, мин» (`WIND_<метры>`, `WIND_W30_<метры>`): «до 300 м — WIND_300, до 450 м —
// WIND_450» и т. д. Проход 250 м при WIND_300=1.5 стоит 1.5 мин, а не 1.25. Выше последней точки —
// последняя норма (не экстраполируем). Фольга остаётся на блочной модели (#3742).
//
// Тест общий: перебирает метраж 1…1300 м и сверяет все публичные расчёты планирования и
// калькулятора резки с эталоном «порог вверх».
//
// Run with: node experiments/atex-pp-5198-winding-thresholds.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;
var core = require('../download/atex/js/cut-optimizer.js').core;

var passed = 0, failed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok || /^#/.test(name)) console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { failed++; console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

// Нормы ateh на момент #5198 (WIND_300 поднята до 1.5) + узкая серия #4501.
var TIMES = {
    WIND_300: 1.5, WIND_450: 1.8, WIND_600: 4, WIND_900: 5, WIND_1000: 5.3, WIND_1100: 5.6,
    WIND_FOIL_305: 4, WIND_W30_300: 2.25, WIND_W30_450: 3.6, WIND_W30_600: 8,
    BETWEEN_CUTS: 2
};
var BASE = [[300, 1.5], [450, 1.8], [600, 4], [900, 5], [1000, 5.3], [1100, 5.6]];
var NARROW = [[300, 2.25], [450, 3.6], [600, 8]];

function expectedStep(series, x) {
    for (var i = 0; i < series.length; i++) if (x <= series[i][0]) return series[i][1];
    return series[series.length - 1][1];
}

var pts = planning.windingPointsFromTimes(TIMES);
var narrowPts = planning.windPointsForCut({ isFoil: false, knifeWidths: [30, 100] }, pts);
var corePts = core.windingPointsFromTimes(TIMES);

// ── 1. Кейс из задачи: 959660, 250 м × 13 проходов ──
assertEqual(planning.windingMinutes(250, pts), 1.5, '#5198: 250 м → 1.5 мин (порог WIND_300), не 1.25');
assertEqual(planning.plannedCutDurationMinutes(250, 13, TIMES, false), 19.5, '#5198: 250 м × 13 → 19.5 мин намотки');
assertEqual(planning.cutTimingDetails(250, 13, TIMES, false),
    'Метраж прохода: 250 м\nПлановых проходов: 13\nНорма намотки: WIND_300=1.5 мин\nНамотка: 1.5 * 13 = 19.5 мин\nЛидер: 2 * 13 = 26 мин\nИтого резка: 19.5 + 26 = 45.5 мин',
    '#5198: тайминг оператору — полная норма WIND_300');
assertEqual(planning.windingMinutes(50, narrowPts), 2.25, '#5198: узкая 50 м → 2.25 мин (порог WIND_W30_300), не 0.375');
assertEqual(planning.windingMinutes(550, pts), 4, '#5198: 550 м → 4 мин (порог WIND_600), без интерполяции');
assertEqual(core.windingMinutes(250, corePts), 1.5, '#5198: калькулятор резки: 250 м → 1.5 мин');

// ── 2. Общее правило: все метражи 1…1300 м ──
for (var x = 1; x <= 1300; x++) {
    var base = expectedStep(BASE, x);
    assertEqual(planning.windingMinutes(x, pts), base, 'windingMinutes(' + x + ') — базовая серия, порог');
    assertEqual(core.windingMinutes(x, corePts), base, 'core.windingMinutes(' + x + ') — порог');
    assertEqual(planning.windingMinutes(x, narrowPts), expectedStep(NARROW, x), 'windingMinutes(' + x + ') — узкая серия, порог');
    var norms = planning.relevantWindingNorms(x, pts);
    assertEqual(norms.length === 1 && norms[0].min === base, true, 'relevantWindingNorms(' + x + ') — одна применённая норма');
}

// ── 3. Фольга не тронута: блоки по 305 м ──
var foilPts = planning.windPointsForCut(true, pts);
assertEqual(planning.windingMinutes(122, foilPts), 4, '#5198: фольга 122 м → 4 (блок)');
assertEqual(planning.windingMinutes(610, foilPts), 8, '#5198: фольга 610 м → 8 (два блока)');
assertEqual(planning.windingMinutes(0, pts), 0, '#5198: 0 м → 0');
assertEqual(planning.windingMinutes(250, []), 0, '#5198: нет норм → 0');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
