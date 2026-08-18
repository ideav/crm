// #4774 — кнопка «Дэшборд»: показывается только при отклонениях и называет их детали.
//
// ТЗ (issue #4774): «Кнопка показывается только при наличии отклонений (аналогично
// Урегулировать) и показывает их детали. Следующие отклонения: 1. Разница Сделано/Упаковано в
// задании. 2. Отсутствие готовности втулок к заданиям в выбранном диапазоне по текущую дату
// включительно».
//
// Решения заказчика 17.08.2026:
//   • окно у ОБЕИХ групп одно — видимый диапазон [С; По] и плановый день не позже сегодня;
//   • «втулки готовы» = у ВСЕХ «Задач на втулки» позиции проставлено «Закончено».
//
// Run with: node experiments/atex-pp-4774-dashboard.test.js

process.env.TZ = 'UTC';

var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    var ok = a === e;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + e + ', получено ' + a + ')'));
    if (ok) passed++; else process.exitCode = 1;
}
function ts(y, m, d, hh) { return String(Math.floor(Date.UTC(y, m - 1, d, hh || 8, 0, 0) / 1000)); }
function cutIds(list) { return (list || []).map(function(x) { return x.cut.id; }); }

var TODAY = 20260817;                  // понедельник 17.08.2026
var FROM = '2026-08-10', TO = '2026-08-20';

// ── 1) Отчёт `packer` → «сделано/упаковано» по заданиям ───────────────────────
// Строка отчёта — одна «Партия ГП» задания, поэтому у задания складываются его строки.
var packRows = [
    { task_id: '100', gp_id: '1', order_no: '4600', cut_width: '80.00', cut_length: '450.00', qty_fact: '110', packed: '110' },
    { task_id: '101', gp_id: '2', order_no: '4601', cut_width: '110.00', cut_length: '300.00', qty_fact: '24', packed: '23' },
    { task_id: '101', gp_id: '3', order_no: '4601', cut_width: '60.00', cut_length: '300.00', qty_fact: '6', packed: '6' },
    { task_id: '102', gp_id: '4', order_no: '4602', cut_width: '60.00', cut_length: '300.00', qty_fact: '30', packed: '' }
];
var pack = planning.rowsToPackState(packRows);
assertEqual([pack.hasFact, pack.hasPacked, pack.rows], [true, true, 4],
    'rowsToPackState: колонки «Кол-во факт»/«Упаковано шт» на месте');
assertEqual([pack.byCut['100'].fact, pack.byCut['100'].packed], [110, 110],
    'rowsToPackState: задание 100 — сделано 110, упаковано 110');
assertEqual([pack.byCut['101'].fact, pack.byCut['101'].packed], [30, 29],
    'rowsToPackState: задание 101 — строки Партий ГП складываются (24+6 / 23+6)');
assertEqual(pack.byCut['102'].packed, 0, 'rowsToPackState: пустое «Упаковано шт» — это 0 упакованных');

// НЕТ КОЛОНКИ — НЕ ЗНАЕМ, А НЕ НОЛЬ (#4536): считать разницу не из чего, группа выключается.
var packNoCol = planning.rowsToPackState([{ task_id: '100', gp_id: '1', qty: '110' }]);
assertEqual([packNoCol.hasFact, packNoCol.hasPacked, Object.keys(packNoCol.byCut).length], [false, false, 0],
    'rowsToPackState: нет колонок факта/упаковки — состояние пустое, а не «всё по нулям»');

// ── 2) Отчёт `sleeve_tasks` → задачи на втулки по позициям ────────────────────
var sleeveRows = [
    { task_id: '10', position_id: '900', qty: '300', fact: '300', finished: '1786080420' },
    { task_id: '11', position_id: '901', qty: '208', fact: '', finished: '' },
    { task_id: '12', position_id: '901', qty: '100', fact: '', finished: '' },
    { task_id: '13', position_id: '902', qty: '110', fact: '110', finished: '1786083180' }
];
var sleeve = planning.rowsToSleeveTasks(sleeveRows);
assertEqual([sleeve.linked, sleeve.rows, Object.keys(sleeve.byPosition).sort()],
    [true, 4, ['900', '901', '902']],
    'rowsToSleeveTasks: задачи разложены по позициям (колонка position_id, #4774)');

// Колонки position_id нет (старое определение отчёта) — связать задачу с заданием нечем.
var sleeveNoLink = planning.rowsToSleeveTasks([{ task_id: '10', qty: '300', finished: '' }]);
assertEqual([sleeveNoLink.linked, Object.keys(sleeveNoLink.byPosition).length], [false, 0],
    'rowsToSleeveTasks: без position_id связи нет — linked=false, а не «втулки готовы»');

// ── 3) Готовность втулок позиции ──────────────────────────────────────────────
assertEqual(planning.sleeveReadiness(sleeve.byPosition['900'], { id: '900', sleeveId: '8190' }), null,
    'sleeveReadiness: все задачи закрыты — позиция готова');
assertEqual(planning.sleeveReadiness(sleeve.byPosition['901'], { id: '901', sleeveId: '8190' }),
    { kind: 'pending', pending: 2, total: 2, pendingQty: 308 },
    'sleeveReadiness: незакрытые задачи — не готово, и видно сколько втулок ждёт нарезки');
assertEqual(planning.sleeveReadiness(sleeve.byPosition['901'], { id: '901', sleeveId: '8190', sleeveReady: true }), null,
    'sleeveReadiness: позиция помечена «втулка уже нарезана» — задачи не спрашиваем (#3340)');
assertEqual(planning.sleeveReadiness([], { id: '903', sleeveId: '8190' }),
    { kind: 'none', pending: 0, total: 0, pendingQty: 0 },
    'sleeveReadiness: тип втулки есть, а задач нет — втулки никто не заказывал');
assertEqual(planning.sleeveReadiness([], null), null,
    'sleeveReadiness: позиции не знаем и задач нет — молчим, а не выдумываем отклонение');
assertEqual(planning.sleeveReadiness([], { id: '904', sleeveId: '' }), null,
    'sleeveReadiness: у позиции нет типа втулки — втулки ей не нужны');

// ── 4) Две группы дэшборда по ОДНОМУ окну ─────────────────────────────────────
// 100 — сделано = упаковано, втулки готовы: не отклонение вовсе.
// 101 — разница упаковки (30/29) и незакрытые задачи позиции 901.
// 102 — сделано 30, упаковано 0.
// 103 — плановый день ЗАВТРА: работа ещё не начиналась, «не упаковано» тут норма.
// 104 — плановый день РАНЬШЕ «С»: вне видимого диапазона очереди.
// 105 — «Завершён»: в очереди его нет, и в дэшборде тоже.
var cuts = [
    { id: '100', planDate: ts(2026, 8, 10), status: 'В работе', number: ts(2026, 8, 10), slitter: { id: '1', label: 'Станок 1' }, materialName: 'MR192' },
    { id: '101', planDate: ts(2026, 8, 12), status: 'В работе', number: ts(2026, 8, 12), slitter: { id: '1', label: 'Станок 1' }, materialName: 'MR194' },
    { id: '102', planDate: ts(2026, 8, 17), status: '', number: ts(2026, 8, 17), slitter: { id: '2', label: 'Станок 2' }, materialName: 'MR200' },
    { id: '103', planDate: ts(2026, 8, 18), status: '', number: ts(2026, 8, 18), slitter: { id: '2', label: 'Станок 2' }, materialName: 'MR200' },
    { id: '104', planDate: ts(2026, 8, 5), status: '', number: ts(2026, 8, 5), slitter: { id: '1', label: 'Станок 1' }, materialName: 'MR192' },
    { id: '105', planDate: ts(2026, 8, 11), status: 'Завершён', number: ts(2026, 8, 11), slitter: { id: '1', label: 'Станок 1' }, materialName: 'MR192' }
];
var packFuture = planning.rowsToPackState(packRows.concat([
    { task_id: '103', gp_id: '5', order_no: '4603', qty_fact: '0', packed: '' },
    { task_id: '104', gp_id: '6', order_no: '4604', qty_fact: '50', packed: '0' },
    { task_id: '105', gp_id: '7', order_no: '4605', qty_fact: '70', packed: '0' }
]));
var opts = {
    todayKey: TODAY, dateFrom: FROM, dateTo: TO,
    packByCut: packFuture.byCut,
    sleeveByPosition: sleeve.byPosition,
    positionsByCut: {
        '100': [{ id: '900', orderNo: '4600' }],
        '101': [{ id: '901', orderNo: '4601' }],
        '102': [{ id: '902', orderNo: '4602' }],
        '103': [{ id: '901', orderNo: '4603' }],
        '104': [{ id: '901', orderNo: '4604' }],
        '105': [{ id: '901', orderNo: '4605' }]
    },
    positionsById: {
        '900': { id: '900', sleeveId: '8190' },
        '901': { id: '901', sleeveId: '8190' },
        '902': { id: '902', sleeveId: '8190' }
    }
};
var groups = planning.dashboardGroups(cuts, opts);
assertEqual(cutIds(groups.pack), ['101', '102'],
    'dashboardGroups: разница Сделано/Упаковано — только окно [С;По] по сегодня');
assertEqual([groups.pack[0].fact, groups.pack[0].packed, groups.pack[0].diff], [30, 29, 1],
    'dashboardGroups: у задания 101 названы оба числа и разница');
assertEqual(cutIds(groups.sleeve), ['101'],
    'dashboardGroups: втулки не готовы — задание 101 (позиция 901 с незакрытыми задачами)');
assertEqual(groups.sleeve[0].positions, [{ kind: 'pending', pending: 2, total: 2, pendingQty: 308, id: '901', orderNo: '4601' }],
    'dashboardGroups: в детали попадает позиция, её заказ и сколько втулок не нарезано');

// Завтрашнее задание 103 стоит на той же неготовой позиции 901 — и всё равно молчит.
assertEqual(cutIds(groups.sleeve).indexOf('103'), -1,
    'dashboardGroups: будущее задание не отклонение — работа ещё не начиналась');

// Окно СУЖЕНО до сегодня (так стоит фильтр по умолчанию) — остаётся только сегодняшнее.
var todayOnly = planning.dashboardGroups(cuts, Object.assign({}, opts, { dateFrom: '2026-08-17', dateTo: '2026-08-17' }));
assertEqual([cutIds(todayOnly.pack), cutIds(todayOnly.sleeve)], [['102'], []],
    'dashboardGroups: диапазон «сегодня» оставляет только сегодняшние задания');

// Отчёты не прочитались — групп нет, но и вранья нет: пустой вход даёт пустой выход,
// а о причине говорит форма (packStateError/sleeveTasksError в контроллере).
var blind = planning.dashboardGroups(cuts, { todayKey: TODAY, dateFrom: FROM, dateTo: TO });
assertEqual([blind.pack.length, blind.sleeve.length], [0, 0],
    'dashboardGroups: без состояния упаковки и задач на втулки отклонений не выдумываем');

console.log('\n' + passed + '/' + total + ' проверок пройдено');
