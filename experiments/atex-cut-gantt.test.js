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

// ── rowsToCuts: dedup по cut_id; order/sequence/leader/метраж; длительность ──
var cuts = gantt.rowsToCuts([
    { cut_id: '10', cut_slitter: 'Станок 1', cut_slitter_id: '101',
      cut_plan_date: '06.05.2026', cut_material: 'MR194', cut_material_id: '5',
      cut_start_date: '06.05.2026 08:10', cut_end_date: '06.05.2026 09:20',
      cut_duration: '70', cut_length: '600', cut_status: 'В работе', cut_sequence: '2',
      cut_leader: 'MONOCHROME', order_no: '3700', supply_id: '900' },
    // вторая строка той же резки (join с обеспечением) — схлопывается
    { cut_id: '10', cut_slitter: 'Станок 1', cut_slitter_id: '101', supply_id: '901' },
    { cut_id: '20', cut_slitter: '', cut_slitter_id: '',
      cut_plan_date: '27.05.2026', cut_status: 'Ожидает', order_no: '3701' }
]);
assertEqual(cuts, [
    { id: '10', number: '06.05.2026', planDate: '06.05.2026', status: 'В работе',
      startDate: '06.05.2026 08:10', endDate: '06.05.2026 09:20', duration: 70, length: 600,
      sequence: 2, leader: 'MONOCHROME', orderNo: '3700',
      materialId: '5', materialName: 'MR194', slitter: { id: '101', label: 'Станок 1' } },
    { id: '20', number: '27.05.2026', planDate: '27.05.2026', status: 'Ожидает',
      startDate: '', endDate: '', duration: 0, length: 0, sequence: null, leader: '', orderNo: '3701',
      materialId: '', materialName: '', slitter: { id: null, label: '' } }
], 'rowsToCuts: dedup, поля order/sequence/leader/length, длительность');

// ── cutRowLabel (#3648 п.1): одна строка «{заказ} / {сырьё} · {метраж}», без слова «Заказ» ──
assertEqual(gantt.cutRowLabel({ orderNo: '3700', materialName: 'MWR116L', length: 600 }),
    '3700 / MWR116L · 600', 'cutRowLabel: заказ / сырьё · метраж');
assertEqual(gantt.cutRowLabel({ orderNo: '3701' }), '3701', 'cutRowLabel: только заказ');

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

// ── cutInRange: задание в видимом периоде (по плановой дате, иначе по старту) ──
assertEqual(gantt.cutInRange({ planDate: '2026-06-10' }, weekRange), true, 'cutInRange: дата внутри недели');
assertEqual(gantt.cutInRange({ planDate: '2026-07-01' }, weekRange), false, 'cutInRange: дата вне недели');
assertEqual(gantt.cutInRange({ planDate: '', startDate: '2026-06-11' }, weekRange), true, 'cutInRange: фолбэк на старт');

// ── packGroups (#3648 п.2/п.3): группы по станку + упаковка встык по очерёдности ──
var packCuts = [
    { id: '10', planDate: '2026-06-10', duration: 60, sequence: 2, orderNo: 'A', slitter: { id: '1', label: 'Станок 1' } },
    { id: '11', planDate: '2026-06-09', duration: 30, sequence: 1, orderNo: 'B', slitter: { id: '1', label: 'Станок 1' } },
    { id: '20', planDate: '2026-06-11', duration: 40, orderNo: 'C', slitter: { id: '2', label: 'Станок 2' } },
    { id: '30', planDate: '2026-07-01', duration: 50, orderNo: 'D', slitter: { id: '1', label: 'Станок 1' } } // вне периода
];
var packed = gantt.packGroups(packCuts, weekRange, NOW, {}, { pxPerMin: 2, minPx: 20 });
assertEqual(packed.groups.map(function(g) { return g.slitter.label; }), ['Станок 1', 'Станок 2'],
    'packGroups: группы по станку, сортировка по метке');
assertEqual(packed.groups[0].tasks.map(function(t) { return [t.cut.id, t.leftPx, t.widthPx]; }),
    [['11', 0, 60], ['10', 60, 120]],
    'packGroups: внутри станка — по очерёдности, встык (left = сумма ширин), ширина = длит×px');
assertEqual(packed.trackPx, 180, 'packGroups: trackPx = ширина самого длинного станка');
assertEqual(gantt.packGroups(packCuts, weekRange, NOW, { slitter: '2' }, {}).groups.map(function(g) { return g.slitter.label; }),
    ['Станок 2'], 'packGroups: фильтр по станку');

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
