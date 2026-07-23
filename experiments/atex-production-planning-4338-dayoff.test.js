// #4338 — контроль: упаковщик splitMachineQueue считает КАЛЕНДАРНЫЙ день ВЕРНО при блокировке дня 0
// (нет off-by-one). Заблокирован день 0 → задание встаёт на день 1; дни 0-1 → день 2. Это доказывает,
// что просрочка при заморозке/блоке дня 0 — НЕ ошибка подсчёта дня, а следствие раскладки (жадный
// проход застревает в локальном минимуме), см. docs/atex_planning_actual_behavior.md §7.
//
// Run with: node experiments/atex-production-planning-4338-dayoff.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;
var passed = 0, total = 0;
function eq(actual, expected, name) {
    total++;
    var ok = actual === expected;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (получено ' + actual + ', ожидалось ' + expected + ')'));
    if (ok) passed++; else process.exitCode = 1;
}

function cut(id) { return { id: id, slitter: { id: 'm1' }, materialId: 'M1', winding: 'OUT', knifeWidths: [59, 59], knifeCount: 2, plannedRuns: 4 }; }
var DS = 480, DE = 990;
var opts = { dayStartMin: DS, dayEndMin: DE, times: { BETWEEN_CUTS: 0 }, perPassByCut: { A: 10 }, runsByCut: { A: 4 } };
function dayOf(res) { return Math.floor(res[0].windowStartMin / 1440); }

eq(dayOf(planning.splitMachineQueue([cut('A')], opts)), 0,
    '#4338: без блока — задание на дне 0');
eq(dayOf(planning.splitMachineQueue([cut('A')], Object.assign({}, opts, { blockedRanges: [[0, 1440]] }))), 1,
    '#4338: блок ТОЛЬКО дня 0 → задание на дне 1 (нет off-by-one)');
eq(dayOf(planning.splitMachineQueue([cut('A')], Object.assign({}, opts, { blockedRanges: [[0, 2880]] }))), 2,
    '#4338: блок дней 0-1 → задание на дне 2');

console.log('\n' + passed + '/' + total + ' passed');
if (passed !== total) process.exitCode = 1;
