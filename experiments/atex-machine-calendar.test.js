// Unit tests for the «Календарь занятости станков» core (ideav/crm#3339).
// Проверяет чистое ядро автономного рабочего места:
//   • rowsToCuts          — строки отчёта cut_planning → резки для календаря;
//   • calendarRange       — интервал по режиму (день/3 дня/неделя/месяц);
//   • shiftCalendarAnchor — сдвиг периода назад/вперёд;
//   • cutCalendarStatus   — статус резки (в срок / с опозданием / не завершено …);
//   • cutCalendarItem     — позиция/ширина плашки на шкале + статус;
//   • machineCalendarGroups — раскладка резок по станкам и дорожкам.
//
// Логика перенесена из «Планирования производства» (#3334/#3335), значения сверены
// с тем же тестом. Run with: node experiments/atex-machine-calendar.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/machine-calendar.js');
var calendar = api.calendar;

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

// ── rowsToCuts: dedup по cut_id, выбор нужных полей, длительность ──
var cuts = calendar.rowsToCuts([
    { cut_id: '10', cut_slitter: 'Станок 1', cut_slitter_id: '101',
      cut_plan_date: '06.05.2026', cut_material: 'MR194', cut_material_id: '5',
      cut_start_date: '06.05.2026 08:10', cut_end_date: '06.05.2026 09:20',
      cut_duration: '70', cut_status: 'В работе', supply_id: '900' },
    // вторая строка той же резки (join с обеспечением) — схлопывается
    { cut_id: '10', cut_slitter: 'Станок 1', cut_slitter_id: '101',
      cut_plan_date: '06.05.2026', cut_status: 'В работе', supply_id: '901' },
    { cut_id: '20', cut_slitter: '', cut_slitter_id: '',
      cut_plan_date: '27.05.2026', cut_status: 'Ожидает', supply_id: '' }
]);
assertEqual(cuts, [
    { id: '10', number: '06.05.2026', planDate: '06.05.2026', status: 'В работе',
      startDate: '06.05.2026 08:10', endDate: '06.05.2026 09:20', duration: 70,
      materialId: '5', materialName: 'MR194', slitter: { id: '101', label: 'Станок 1' } },
    { id: '20', number: '27.05.2026', planDate: '27.05.2026', status: 'Ожидает',
      startDate: '', endDate: '', duration: 0,
      materialId: '', materialName: '', slitter: { id: null, label: '' } }
], 'rowsToCuts: dedup по cut_id, нужные поля и длительность');

// ── calendarRange: неделя начинается с понедельника и длится 7 дней ──
var weekRange = calendar.calendarRange('2026-06-11', 'week');
assertEqual({
    mode: weekRange.mode,
    startIso: weekRange.startIso,
    endIso: weekRange.endIso,
    days: weekRange.days.map(function(day) { return day.iso; })
}, {
    mode: 'week',
    startIso: '2026-06-08',
    endIso: '2026-06-15',
    days: ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13', '2026-06-14']
}, 'calendarRange: неделя с понедельника, 7 дней');

assertEqual(calendar.shiftCalendarAnchor('2026-06-11', 'three', 1), '2026-06-14',
    'shiftCalendarAnchor: режим «3 дня» сдвигает на три дня');

// ── cutCalendarStatus ──
assertEqual(calendar.cutCalendarStatus({
    planDate: '2026-06-11 08:00', startDate: '2026-06-11 08:05',
    endDate: '2026-06-11 08:45', duration: 60, status: ''
}, Date.parse('2026-06-11T08:30:00Z')), { key: 'on-time', label: 'В срок' },
    'cutCalendarStatus: фактический финиш в пределах план+длительность → в срок');

assertEqual(calendar.cutCalendarStatus({
    planDate: '2026-06-11 08:00', startDate: '2026-06-11 08:05',
    endDate: '2026-06-11 09:30', duration: 60, status: ''
}, Date.parse('2026-06-11T09:40:00Z')), { key: 'late', label: 'С опозданием' },
    'cutCalendarStatus: финиш позже дедлайна → с опозданием');

assertEqual(calendar.cutCalendarStatus({
    planDate: '2026-06-11 08:00', startDate: '2026-06-11 08:05',
    endDate: '', duration: 60, status: '1'
}, Date.parse('2026-06-11T08:30:00Z')), { key: 'unfinished', label: 'Не завершено' },
    'cutCalendarStatus: непустой статус резки → не завершено');

// ── cutCalendarItem: плашка по факт. старту/финишу + статус по дедлайну ──
var dayRange = calendar.calendarRange('2026-06-11', 'day');
var item = calendar.cutCalendarItem({
    id: 'calendar-1', number: '2026-06-11 08:00', slitter: { id: '101', label: 'Станок 1' },
    materialName: 'MR194', planDate: '2026-06-11 08:00',
    startDate: '2026-06-11 08:05', endDate: '2026-06-11 09:05', duration: 60, status: ''
}, dayRange, Date.parse('2026-06-11T09:10:00Z'));
assertEqual({
    cutId: item.cutId, leftPct: item.leftPct, widthPct: item.widthPct, status: item.status.key
}, { cutId: 'calendar-1', leftPct: 33.681, widthPct: 4.167, status: 'late' },
    'cutCalendarItem: плашка по факт. старту/финишу, статус по дедлайну');

// ── machineCalendarGroups: станки в строки, простаивающие тоже видны ──
var groups = calendar.machineCalendarGroups(
    [{ id: '10', planDate: '2026-06-11 08:00', startDate: '2026-06-11 08:00',
       endDate: '2026-06-11 09:00', duration: 60, status: '',
       slitter: { id: '101', label: 'Станок 1' } }],
    [{ id: '101', label: 'Станок 1' }, { id: '102', label: 'Станок 2' }],
    dayRange, Date.parse('2026-06-11T12:00:00Z'), {});
assertEqual(groups.map(function(g) { return { label: g.slitter.label, cuts: g.items.length }; }),
    [{ label: 'Станок 1', cuts: 1 }, { label: 'Станок 2', cuts: 0 }],
    'machineCalendarGroups: простаивающий станок показан пустой строкой');

// ── фильтр по станку ──
var filtered = calendar.machineCalendarGroups(
    [{ id: '10', planDate: '2026-06-11 08:00', startDate: '2026-06-11 08:00',
       endDate: '2026-06-11 09:00', duration: 60, status: '',
       slitter: { id: '101', label: 'Станок 1' } }],
    [{ id: '101', label: 'Станок 1' }, { id: '102', label: 'Станок 2' }],
    dayRange, Date.parse('2026-06-11T12:00:00Z'), { slitter: '101' });
assertEqual(filtered.map(function(g) { return g.slitter.label; }), ['Станок 1'],
    'machineCalendarGroups: фильтр по станку оставляет один станок');

console.log('\n' + passed + ' assertions passed');
