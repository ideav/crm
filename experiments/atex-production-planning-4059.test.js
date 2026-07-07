// #4059 — веса штрафов из «Настройки» доезжают до планировщика (конфигурируемость весов).
//
// makePlanningOptions(strategy, times, settings) кладёт ключи «Настройки» плоско в opts, откуда их
// читает planWeight — и жадный упаковщик, и слой размещения (модель #3985: transitionCost/scorePosition
// берут DEADLINE/EXACT_DEADLINE/FOIL_NOTEND через planWeight). ЭТА ПЛЮМБИНГ-ЧАСТЬ #4059 остаётся в силе.
//
// Прежняя часть #4059 (EDD-приоритет `dueDay×DEADLINE_COST_MN` в selectByConfig) СНЯТА #4085 — срок стал
// локальным штрафом; соблюдение срока проверяет #4050. Здесь — только что кастомные веса доходят.
//
// Run with: node experiments/atex-production-planning-4059.test.js

var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) { total++; console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (cond) passed++; else process.exitCode = 1; }

// Кастомные веса из «Настройки» → плоско в opts → planWeight.
var custom = planning.makePlanningOptions('SETUP', { BETWEEN_CUTS: 0 }, { DEADLINE_COST_MN: 200, FOIL_NOTEND_COST_MN: 77, EXACT_DEADLINE_COST_MN: 11 });
assert(planning.planWeight(custom, 'DEADLINE_COST_MN') === 200, '#4059: кастомный DEADLINE_COST_MN=200 доходит до planWeight');
assert(planning.planWeight(custom, 'FOIL_NOTEND_COST_MN') === 77, '#4059: кастомный FOIL_NOTEND_COST_MN=77 доходит до planWeight');
assert(planning.planWeight(custom, 'EXACT_DEADLINE_COST_MN') === 11, '#4059: кастомный EXACT_DEADLINE_COST_MN=11 доходит до planWeight');

// Без «Настройки» — дефолты §14.
var def = planning.makePlanningOptions('SETUP', { BETWEEN_CUTS: 0 });
assert(planning.planWeight(def, 'DEADLINE_COST_MN') === 100, '#4059: дефолт DEADLINE_COST_MN=100 (когда «Настройка» не задаёт)');
assert(planning.planWeight(def, 'EXACT_DEADLINE_COST_MN') === 33, '#4059: дефолт EXACT_DEADLINE_COST_MN=33');

console.log('\n' + passed + '/' + total + ' passed');
