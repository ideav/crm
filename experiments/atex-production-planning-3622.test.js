// Unit tests for #3622 — «Удалить»/«Зафиксировать» ищут задания по ДИАПАЗОНУ дат.
// До #3622 кнопка «Удалить» отбирала задания только за один день (filter.date = «С»),
// а очередь после #3599 показывает диапазон [С; По] и группирует по дню РАСПИСАНИЯ.
// Из-за этого при выбранном диапазоне «Удалить» сообщало «нет заданий для удаления»,
// хотя задания видны (их «Дата план» приходилась на другой день диапазона).
// Здесь покрываем чистый отбор dayDeletionTargets(cuts, supplies, dateFrom, dateTo)
// и подпись диапазона formatPlanDayRangeLabel.
//
// Run with: node experiments/atex-production-planning-3622.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) {
        passed++;
    } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

var ts20 = Math.floor(Date.UTC(2026, 5, 20, 8, 30) / 1000);   // 2026-06-20 08:30 UTC (unix-штамп)

// Задания по дням 19/20/21 + краевые (завершён, без даты, зафиксирован, вне диапазона).
var cuts = [
    { id: '1', planDate: '2026-06-19', status: 'В очереди' },   // день 19 (строка)
    { id: '2', planDate: String(ts20), status: 'Начато' },      // день 20 (unix) — середина диапазона
    { id: '3', planDate: '2026-06-21', status: 'В очереди' },   // день 21
    { id: '4', planDate: String(ts20), status: 'Завершён' },    // день 20, но завершён — не трогаем
    { id: '5', planDate: '', status: 'В очереди' },             // без даты — к диапазону не относим
    { id: '6', planDate: '2026-06-20', status: 'В очереди', fixed: true }, // зафиксирован — пропускаем
    { id: '7', planDate: '2026-06-25', status: 'В очереди' }    // вне диапазона
];
var supplies = [
    { id: 's1', cutId: '1' }, { id: 's2', cutId: '2' }, { id: 's3', cutId: '3' },
    { id: 's4', cutId: '4' }, { id: 's5', cutId: '5' }, { id: 's6', cutId: '6' }, { id: 's7', cutId: '7' }
];

// 1) Диапазон [19; 21] — все датированные незавершённые незафиксированные задания.
var range = planning.dayDeletionTargets(cuts, supplies, '2026-06-19', '2026-06-21');
assertEqual(range.cuts.map(function(c) { return c.id; }), ['1', '2', '3'],
    '#3622: диапазон [19;21] берёт задания всех дней диапазона (без завершённых/недатированных/зафиксированных/вне диапазона)');
assertEqual(range.supplies.map(function(s) { return s.id; }), ['s1', 's2', 's3'],
    '#3622: обеспечения только по заданиям диапазона');

// 2) РЕПРО бага: задание видно на дне 20, но «С» = 19. Старый однодневный отбор по «С»
//    нашёл бы только день 19 (id 1) и упустил бы id 2/3 → «нет заданий для удаления».
//    Диапазон их находит.
var single19 = planning.dayDeletionTargets(cuts, supplies, '2026-06-19', '2026-06-19');
assertEqual(single19.cuts.map(function(c) { return c.id; }), ['1'],
    '#3622: один день 19 берёт только задания дня 19 (как было до диапазона)');
assertEqual(range.cuts.length > single19.cuts.length, true,
    '#3622: диапазон находит задания, которые однодневный отбор упускал (суть бага)');

// 3) «По» пусто → один день «С» (без перелива в соседние дни).
assertEqual(planning.dayDeletionTargets(cuts, supplies, '2026-06-20', '').cuts.map(function(c) { return c.id; }), ['2'],
    '#3622: пустое «По» → один день «С» (id 2; id 4 завершён, id 6 зафиксирован — мимо)');

// 4) Обратная совместимость: вызов с 3 аргументами (без dateTo) = один день.
assertEqual(planning.dayDeletionTargets(cuts, supplies, '2026-06-19').cuts.map(function(c) { return c.id; }), ['1'],
    '#3622: вызов без dateTo по-прежнему = один день «С»');

// 5) Зафиксированное задание (id 6, день 20) в диапазон удаления НЕ попадает.
assertEqual(range.cuts.map(function(c) { return c.id; }).indexOf('6'), -1,
    '#3622: зафиксированное задание исключено из удаления (#3508 п.3)');

// 6) Пустое «С» → удалять нечего.
assertEqual(planning.dayDeletionTargets(cuts, supplies, '', '2026-06-21'), { cuts: [], supplies: [] },
    '#3622: пустое «С» → пустой набор');

// 7) Подпись диапазона.
assertEqual(planning.formatPlanDayRangeLabel('2026-05-29', '2026-05-31'), '29.05.2026 – 31.05.2026',
    '#3622: подпись диапазона «29.05.2026 – 31.05.2026»');
assertEqual(planning.formatPlanDayRangeLabel('2026-05-29', '2026-05-29'), '29.05.2026',
    '#3622: одинаковые края → один день');
assertEqual(planning.formatPlanDayRangeLabel('2026-05-29', ''), '29.05.2026',
    '#3622: пустое «По» → один день');
assertEqual(planning.formatPlanDayRangeLabel('2026-05-29', null), '29.05.2026',
    '#3622: null «По» → один день');

console.log('\n' + passed + ' assertions passed');
