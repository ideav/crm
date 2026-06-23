// Unit tests for the «Диаграмма Ганта (задания)» core (ideav/crm#3638).
// Проверяет чистое ядро автономного рабочего места cut-gantt:
//   • rowsToCuts        — строки отчёта cut_planning → задания (с order/sequence/leader);
//   • ganttRange        — интервал по режиму (день/3 дня/неделя/месяц);
//   • shiftAnchor       — сдвиг периода назад/вперёд;
//   • cutStatus         — статус задания (в срок / с опозданием / запланировано …);
//   • cutBar            — позиция/ширина бара на шкале;
//   • orderCutsForGantt — порядок строк (станок → старт → очередность → id);
//   • ganttRows         — видимые строки с фильтрами станка/статуса;
//   • planningLink      — ссылка на «Планирование производства» (дата/станок/задание);
//   • parseDeepLink     — разбор ?cut=..&date=..&slitter=.. (и в cut-gantt, и в planning).
//
// Run with: node experiments/atex-cut-gantt.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/cut-gantt.js');
var gantt = api.gantt;
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// ── rowsToCuts: dedup по cut_id; order/sequence/leader; длительность ──
var cuts = gantt.rowsToCuts([
    { cut_id: '10', cut_slitter: 'Станок 1', cut_slitter_id: '101',
      cut_plan_date: '06.05.2026', cut_material: 'MR194', cut_material_id: '5',
      cut_start_date: '06.05.2026 08:10', cut_end_date: '06.05.2026 09:20',
      cut_duration: '70', cut_status: 'В работе', cut_sequence: '2',
      cut_leader: 'MONOCHROME', order_no: '3700', supply_id: '900' },
    // вторая строка той же резки (join с обеспечением) — схлопывается
    { cut_id: '10', cut_slitter: 'Станок 1', cut_slitter_id: '101', supply_id: '901' },
    { cut_id: '20', cut_slitter: '', cut_slitter_id: '',
      cut_plan_date: '27.05.2026', cut_status: 'Ожидает', order_no: '3701' }
]);
assertEqual(cuts, [
    { id: '10', number: '06.05.2026', planDate: '06.05.2026', status: 'В работе',
      startDate: '06.05.2026 08:10', endDate: '06.05.2026 09:20', duration: 70,
      sequence: 2, leader: 'MONOCHROME', orderNo: '3700',
      materialId: '5', materialName: 'MR194', slitter: { id: '101', label: 'Станок 1' } },
    { id: '20', number: '27.05.2026', planDate: '27.05.2026', status: 'Ожидает',
      startDate: '', endDate: '', duration: 0, sequence: null, leader: '', orderNo: '3701',
      materialId: '', materialName: '', slitter: { id: null, label: '' } }
], 'rowsToCuts: dedup, поля order/sequence/leader, длительность');

// ── ganttRange: неделя с понедельника, 7 дней ──
var weekRange = gantt.ganttRange('2026-06-11', 'week');
assertEqual({ mode: weekRange.mode, startIso: weekRange.startIso, endIso: weekRange.endIso, days: weekRange.days.length },
    { mode: 'week', startIso: '2026-06-08', endIso: '2026-06-15', days: 7 },
    'ganttRange: неделя 08–14 июня (7 дней)');

// ── shiftAnchor: неделя назад/вперёд ──
assertEqual(gantt.shiftAnchor('2026-06-11', 'week', 1), '2026-06-15', 'shiftAnchor: +1 неделя');
assertEqual(gantt.shiftAnchor('2026-06-11', 'week', -1), '2026-06-01', 'shiftAnchor: −1 неделя');

// ── cutStatus ──
var NOW = gantt.parseDateTimeMs('2026-06-10 12:00');
assertEqual(gantt.cutStatus({ planDate: '2026-06-20' }, NOW).key, 'planned', 'cutStatus: будущее → запланировано');
assertEqual(gantt.cutStatus({ planDate: '2026-06-10 08:00', duration: 60, startDate: '2026-06-10 08:00', endDate: '2026-06-10 08:40' }, NOW).key,
    'on-time', 'cutStatus: финиш до дедлайна → в срок');
assertEqual(gantt.cutStatus({ planDate: '2026-06-10 08:00', duration: 60, endDate: '2026-06-10 10:00' }, NOW).key,
    'late', 'cutStatus: финиш позже дедлайна → с опозданием');

// ── cutBar: позиция/ширина на недельной шкале ──
var bar = gantt.cutBar({ id: '10', planDate: '2026-06-10' }, weekRange, NOW);
assertEqual({ left: bar.leftPct, width: bar.widthPct, cutId: bar.cutId },
    { left: 28.571, width: 0.6, cutId: '10' },
    'cutBar: вторник недели → left 2/7, ширина минимальная');
assertEqual(gantt.cutBar({ id: '99', planDate: '2026-07-01' }, weekRange, NOW), null,
    'cutBar: вне периода → null');

// ── orderCutsForGantt: по станку, затем старту ──
var ordered = gantt.orderCutsForGantt([
    { id: 'A', planDate: '2026-06-10', slitter: { id: '2', label: 'Станок 2' } },
    { id: 'B', planDate: '2026-06-11', slitter: { id: '1', label: 'Станок 1' } }
]).map(function(c) { return c.id; });
assertEqual(ordered, ['B', 'A'], 'orderCutsForGantt: Станок 1 раньше Станка 2');

// ── ganttRows: фильтры станка/статуса + только видимые ──
var rowCuts = [
    { id: '10', planDate: '2026-06-10', slitter: { id: '1', label: 'Станок 1' } },
    { id: '20', planDate: '2026-06-11', slitter: { id: '2', label: 'Станок 2' } },
    { id: '30', planDate: '2026-07-01', slitter: { id: '1', label: 'Станок 1' } } // вне периода
];
assertEqual(gantt.ganttRows(rowCuts, weekRange, NOW, {}).map(function(r) { return r.cut.id; }),
    ['10', '20'], 'ganttRows: вне периода (30) отброшено');
assertEqual(gantt.ganttRows(rowCuts, weekRange, NOW, { slitter: '2' }).map(function(r) { return r.cut.id; }),
    ['20'], 'ganttRows: фильтр по станку');

// ── planningLink: ссылка на планировщик с датой/станком/заданием ──
assertEqual(gantt.planningLink({ id: '85472', planDate: '06.05.2026', slitter: { id: '1285' } }),
    '/atex/production-planning?cut=85472&date=2026-05-06&slitter=1285',
    'planningLink: cut+date+slitter');
assertEqual(gantt.planningLink({ id: '7', planDate: '', slitter: { id: null } }),
    '/atex/production-planning?cut=7',
    'planningLink: без даты/станка — только cut');
assertEqual(gantt.planningLink({ id: '7' }, '/x/pp'),
    '/x/pp?cut=7', 'planningLink: базовый URL переопределяется');

// ── parseDeepLink: cut-gantt и planning разбирают одинаково ──
var expectDL = { cut: '85472', date: '2026-05-06', slitter: '1285' };
assertEqual(gantt.parseDeepLink('?cut=85472&date=2026-05-06&slitter=1285'), expectDL, 'parseDeepLink (gantt): полный');
assertEqual(planning.parseDeepLink('?cut=85472&date=2026-05-06&slitter=1285'), expectDL, 'parseDeepLink (planning): полный');
assertEqual(gantt.parseDeepLink(''), { cut: '', date: '', slitter: '' }, 'parseDeepLink: пусто');
assertEqual(gantt.parseDeepLink('?foo=1&cut=9'), { cut: '9', date: '', slitter: '' }, 'parseDeepLink: лишние параметры игнорируются');

console.log('\n' + passed + ' assertions passed');
