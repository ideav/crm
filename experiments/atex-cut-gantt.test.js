// Unit tests for the «Диаграмма Ганта (задания)» core (ideav/crm#3638, доработки #3668).
// Проверяет чистое ядро автономного рабочего места cut-gantt:
//   • rowsToCuts     — строки отчёта cut_planning → задания (order/sequence/leader/намотка);
//   • cutRowLabel    — подпись строки «{заказ} / {сырьё} · {намотка} · {метраж}» (#3668 п.2);
//   • ganttRange     — интервал по режиму (день/3 дня/неделя/месяц);
//   • shiftAnchor    — сдвиг периода назад/вперёд;
//   • cutStatus      — статус задания (в срок / с опозданием / запланировано …);
//   • cutInRange     — задание в видимом периоде;
//   • ganttWindow    — временнóе окно дорожки (#3668 п.1/п.7);
//   • layoutGroups   — группы по станку, бары по РЕАЛЬНОМУ времени (left/width, #3668 п.1/п.7);
//   • cutBarTime     — текст бара «11:19-11:23 (4 мин)» (#3668 п.4);
//   • chooseHourStep — интервал часовой сетки (#3668 п.6);
//   • hourTicks      — деления окна (метки «HH:00», дата суток);
//   • planningLink   — ссылка на «Планирование производства» (дата/станок/задание);
//   • parseDeepLink  — разбор ?cut=..&date=..&slitter=.. (и в cut-gantt, и в planning).
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

// ── rowsToCuts: dedup по cut_id; order/sequence/leader/намотка/метраж; длительность ──
var cuts = gantt.rowsToCuts([
    { cut_id: '10', cut_slitter: 'Станок 1', cut_slitter_id: '101',
      cut_plan_date: '06.05.2026', cut_material: 'MR194', cut_material_id: '5',
      cut_start_date: '06.05.2026 08:10', cut_end_date: '06.05.2026 09:20',
      cut_duration: '70', cut_length: '600', cut_status: 'В работе', cut_sequence: '2',
      cut_leader: 'MONOCHROME', cut_winding: 'OUT', order_no: '3700', supply_id: '900' },
    // вторая строка той же резки (join с обеспечением) — схлопывается
    { cut_id: '10', cut_slitter: 'Станок 1', cut_slitter_id: '101', supply_id: '901' },
    { cut_id: '20', cut_slitter: '', cut_slitter_id: '',
      cut_plan_date: '27.05.2026', cut_status: 'Ожидает', order_no: '3701' }
]);
assertEqual(cuts, [
    { id: '10', number: '06.05.2026', planDate: '06.05.2026', status: 'В работе',
      startDate: '06.05.2026 08:10', endDate: '06.05.2026 09:20', duration: 70, length: 600,
      sequence: 2, leader: 'MONOCHROME', orderNo: '3700',
      materialId: '5', materialName: 'MR194', winding: 'OUT', slitter: { id: '101', label: 'Станок 1' } },
    { id: '20', number: '27.05.2026', planDate: '27.05.2026', status: 'Ожидает',
      startDate: '', endDate: '', duration: 0, length: 0, sequence: null, leader: '', orderNo: '3701',
      materialId: '', materialName: '', winding: '', slitter: { id: null, label: '' } }
], 'rowsToCuts: dedup, поля order/sequence/leader/намотка/length, длительность');

// ── cutRowLabel (#3668 п.2): «{заказ} / {сырьё} · {намотка} · {метраж}» без слова «Заказ» ──
assertEqual(gantt.cutRowLabel({ orderNo: '3351', materialName: 'MWR116L', winding: 'OUT', length: 450 }),
    '3351 / MWR116L · OUT · 450', 'cutRowLabel: заказ / сырьё · намотка · метраж');
assertEqual(gantt.cutRowLabel({ orderNo: '3700', materialName: 'MWR116L', length: 600 }),
    '3700 / MWR116L · 600', 'cutRowLabel: без намотки');
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

// ── cutBarTime (#3668 п.4): диапазон времени + минуты ──
assertEqual(gantt.cutBarTime({ planDate: '2026-06-10 11:19', duration: 4 }),
    '11:19-11:23 (4 мин)', 'cutBarTime: «11:19-11:23 (4 мин)»');
assertEqual(gantt.cutBarTime({ planDate: '2026-06-10 08:00', startDate: '2026-06-10 08:05', endDate: '2026-06-10 09:05' }),
    '08:05-09:05 (60 мин)', 'cutBarTime: по факту старт/финиш');

// ── ganttWindow (#3668 п.1/п.7): окно = первое…последнее задание (снап до часа) ──
assertEqual(
    [gantt.ganttWindow([], weekRange).startMs, gantt.ganttWindow([], weekRange).endMs],
    [gantt.parseDateTimeMs('2026-06-08 08:00'), gantt.parseDateTimeMs('2026-06-08 18:00')],
    'ganttWindow: заданий нет → смена 08:00–18:00 дня периода');
assertEqual(
    [gantt.ganttWindow([{ planDate: '2026-06-10 11:19', duration: 4 }, { planDate: '2026-06-10 13:14', duration: 9 }], weekRange).startMs,
     gantt.ganttWindow([{ planDate: '2026-06-10 11:19', duration: 4 }, { planDate: '2026-06-10 13:14', duration: 9 }], weekRange).endMs],
    [gantt.parseDateTimeMs('2026-06-10 11:00'), gantt.parseDateTimeMs('2026-06-10 14:00')],
    'ganttWindow: 11:19…13:23 → окно 11:00…14:00 (снап до часа)');

// ── layoutGroups (#3668 п.1/п.7): группы по станку, бары по реальному времени ──
var layoutCuts = [
    { id: '10', planDate: '2026-06-10 10:00', duration: 60, sequence: 2, orderNo: 'A', slitter: { id: '1', label: 'Станок 1' } },
    { id: '11', planDate: '2026-06-10 08:00', duration: 30, sequence: 1, orderNo: 'B', slitter: { id: '1', label: 'Станок 1' } },
    { id: '20', planDate: '2026-06-11 09:00', duration: 40, orderNo: 'C', slitter: { id: '2', label: 'Станок 2' } },
    { id: '30', planDate: '2026-07-01', duration: 50, orderNo: 'D', slitter: { id: '1', label: 'Станок 1' } } // вне периода
];
var laid = gantt.layoutGroups(layoutCuts, weekRange, NOW, {}, { pxPerMin: 1 });
assertEqual(laid.groups.map(function(g) { return g.slitter.label; }), ['Станок 1', 'Станок 2'],
    'layoutGroups: группы по станку, сортировка по метке');
// окно: 2026-06-10 08:00 … 2026-06-11 10:00 (06-10 08:00 — старт task11; 06-11 09:40 — финиш task20, снап вверх)
assertEqual([laid.window.startMs, laid.window.endMs],
    [gantt.parseDateTimeMs('2026-06-10 08:00'), gantt.parseDateTimeMs('2026-06-11 10:00')],
    'layoutGroups: окно от первого до последнего задания');
// task11 (08:00) left=0 w=30; task10 (10:00) left=120мин w=60 — между ними виден разрыв (10:00−08:30)
assertEqual(laid.groups[0].tasks.map(function(t) { return [t.cut.id, t.leftPx, t.widthPx]; }),
    [['11', 0, 30], ['10', 120, 60]],
    'layoutGroups: внутри станка — по очерёдности; left/width по реальному времени, разрыв виден');
// task20 (06-11 09:00) на другом станке: left = 25 ч × 60 = 1500 мин
assertEqual(laid.groups[1].tasks.map(function(t) { return [t.cut.id, t.leftPx, t.widthPx]; }),
    [['20', 1500, 40]], 'layoutGroups: бар на следующих сутках смещён по реальному времени');
assertEqual(laid.trackPx, 1560, 'layoutGroups: trackPx = длительность окна × масштаб (26 ч × 60)');
assertEqual(gantt.layoutGroups(layoutCuts, weekRange, NOW, { slitter: '2' }, { pxPerMin: 1 }).groups.map(function(g) { return g.slitter.label; }),
    ['Станок 2'], 'layoutGroups: фильтр по станку');

// ── chooseHourStep (#3668 п.6): шаг 1/2/4/6/8/12/24 ч, деления не уже 50px ──
assertEqual(gantt.chooseHourStep(120), 1, 'chooseHourStep: 120px/ч ≥50 → 1 ч (День)');
assertEqual(gantt.chooseHourStep(60), 1, 'chooseHourStep: 60px/ч ≥50 → 1 ч (3 дня)');
assertEqual(gantt.chooseHourStep(24), 4, 'chooseHourStep: 24px/ч → 4 ч (96px, Неделя)');
assertEqual(gantt.chooseHourStep(4.8), 12, 'chooseHourStep: 4.8px/ч → 12 ч (57.6px, Месяц)');

// ── hourTicks: деления окна; метки «HH:00», дата на первом тике суток ──
var win = { startMs: gantt.parseDateTimeMs('2026-06-10 08:00'), endMs: gantt.parseDateTimeMs('2026-06-10 12:00') };
var ticks = gantt.hourTicks(win, 2); // 120px/ч → шаг 1 ч
assertEqual(ticks.map(function(t) { return t.label; }), ['08:00', '09:00', '10:00', '11:00', '12:00'],
    'hourTicks: метки каждый час 08:00…12:00');
assertEqual([ticks[0].leftPx, ticks[1].leftPx, ticks[4].leftPx], [0, 120, 480],
    'hourTicks: шаг 120px (2px/мин×60), 12:00→480px');
assertEqual([ticks[0].dateLabel, ticks[1].dateLabel], ['10.06', ''],
    'hourTicks: дата только на первом тике суток');

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
