// Unit test — «всего заданий» в панели «Качество плана» считается ЗА ОКНО [С;По], а не по
// всему плану. Изначально (PR #4070) число бралось из self.cuts.length (весь горизонт) и не
// совпадало с оконными метриками (переналадки/сырьё/идеал считаются по [С;По]). Теперь
// planQuality.actualFor возвращает window.taskCount / all.taskCount по тому же оконному
// предикату (inWin по dayKey), что и переналадки.
//
// Run with: node experiments/atex-production-planning-window-taskcount.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function eq(a, b, name) {
    var ok = a === b;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + ' (' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ')');
    if (ok) { passed++; } else { failed++; process.exitCode = 1; }
}

var SETTINGS = { KNIVES_CHANGE_COST_MN: 30, KNIVES_INCREASE_COST_MN: 50, MATERIAL_CHANGE_COST_MN: 15 };
function ctlCut(o) {
    return {
        id: o.id, slitter: { id: String(o.s != null ? o.s : 7) }, planDate: o.planDate, planStart: o.ps,
        knifeWidths: o.kw, knifeCount: o.kw.length, materialId: o.m, winding: 'IN', batchId: ''
    };
}

// 2 станка. 03.07: t1,t2 (станок 7) + t4 (станок 8). 04.07: t3 (станок 7). Итого 4 задания.
var cuts = [
    ctlCut({ id: 1, s: 7, planDate: '2026-07-03', ps: 100, kw: [100], m: 'A' }),
    ctlCut({ id: 2, s: 7, planDate: '2026-07-03', ps: 200, kw: [100], m: 'B' }),
    ctlCut({ id: 4, s: 8, planDate: '2026-07-03', ps: 100, kw: [50], m: 'A' }),
    ctlCut({ id: 3, s: 7, planDate: '2026-07-04', ps: 100, kw: [60, 60], m: 'B' })
];

function view(from, to) {
    return planning.planQualityView(cuts, { settings: SETTINGS, scopeFromKey: from, scopeToKey: to });
}

console.log('\n== окно 03.07..03.07 → только задания 03.07 ==');
var d0703 = view(20260703, 20260703);
eq(d0703.window.taskCount, 3, 'окно 03.07: 3 задания (t1,t2,t4), НЕ 4');

console.log('\n== окно 04.07..04.07 → только задания 04.07 ==');
var d0704 = view(20260704, 20260704);
eq(d0704.window.taskCount, 1, 'окно 04.07: 1 задание (t3)');

console.log('\n== окно 03.07..04.07 → оба дня ==');
var both = view(20260703, 20260704);
eq(both.window.taskCount, 4, 'окно 03–04.07: все 4 задания');

console.log('\n== пустое окно 06.07 → 0 заданий (как остальные оконные метрики) ==');
var empty = view(20260706, 20260706);
eq(empty.window.taskCount, 0, 'пустое окно: 0 заданий');
eq(empty.window.changeoverCount, 0, 'пустое окно: 0 переналадок (консистентно)');

console.log('\n== без фильтра (null;null) → окно = весь план ==');
var all = planning.planQualityView(cuts, { settings: SETTINGS, scopeFromKey: null, scopeToKey: null });
eq(all.window.taskCount, 4, 'без фильтра: 4 задания (окно охватывает всё)');
eq(all.all.taskCount, 4, 'all.taskCount = 4 (весь горизонт)');

console.log('\n----------------------------------------');
console.log('ИТОГО: ' + passed + ' passed, ' + failed + ' failed');
