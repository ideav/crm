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
      cut_duration: '70', cut_length: '600', cut_planned_runs: '6', cut_roller_width: '88',
      cut_status: 'В работе', cut_sequence: '2',
      cut_leader: 'MONOCHROME', cut_winding: 'OUT', order_no: '3700', supply_id: '900' },
    // вторая строка той же резки (join с обеспечением) — схлопывается
    { cut_id: '10', cut_slitter: 'Станок 1', cut_slitter_id: '101', supply_id: '901' },
    { cut_id: '20', cut_slitter: '', cut_slitter_id: '',
      cut_plan_date: '27.05.2026', cut_status: 'Ожидает', order_no: '3701' }
]);
assertEqual(cuts, [
    { id: '10', number: '06.05.2026', planDate: '06.05.2026', status: 'В работе',
      startDate: '06.05.2026 08:10', endDate: '06.05.2026 09:20', duration: 70, length: 600,
      plannedRuns: 6, rollerWidth: 88, knifeWidths: [], knifeCount: 0, sequence: 2, leader: 'MONOCHROME', orderNo: '3700',
      materialId: '5', materialName: 'MR194', winding: 'OUT', storedKnifeMin: null, storedMaterialMin: null, cutTimeMin: null, slitter: { id: '101', label: 'Станок 1' } },
    { id: '20', number: '27.05.2026', planDate: '27.05.2026', status: 'Ожидает',
      startDate: '', endDate: '', duration: 0, length: 0, plannedRuns: 0, rollerWidth: 0, knifeWidths: [], knifeCount: 0,
      sequence: null, leader: '', orderNo: '3701',
      materialId: '', materialName: '', winding: '', storedKnifeMin: null, storedMaterialMin: null, cutTimeMin: null, slitter: { id: null, label: '' } }
], 'rowsToCuts: dedup, поля order/sequence/leader/намотка/length/резок/ролик, длительность');

// ── cutRowLabel (#3668 п.2, #3675 п.1/п.2): «{заказ} / {сырьё} · {намотка} · {метраж} x {резок}» ──
assertEqual(gantt.cutRowLabel({ orderNo: '3351', materialName: 'MWR116L', winding: 'OUT', length: 450 }),
    '3351 / MWR116L · OUT · 450', 'cutRowLabel: заказ / сырьё · намотка · метраж');
assertEqual(gantt.cutRowLabel({ orderNo: '3700', materialName: 'MWR116L', length: 600 }),
    '3700 / MWR116L · 600', 'cutRowLabel: без намотки');
assertEqual(gantt.cutRowLabel({ orderNo: '3701' }), '3701', 'cutRowLabel: только заказ');
// #3675 п.1: «Кол-во резок план» → « x N» после метража
assertEqual(gantt.cutRowLabel({ orderNo: '3738', materialName: 'MWR113L', winding: 'OUT', length: 700, plannedRuns: 6 }),
    '3738 / MWR113L · OUT · 700 x 6', 'cutRowLabel: метраж × кол-во резок');
assertEqual(gantt.cutRowLabel({ orderNo: '3738', materialName: 'MWR113L', winding: 'OUT', length: 700, plannedRuns: 0 }),
    '3738 / MWR113L · OUT · 700', 'cutRowLabel: без «x N», если резок нет');
// #3675 п.2: длинное имя сырья обрезаем до первого пробела
assertEqual(gantt.cutRowLabel({ orderNo: '3310', materialName: 'Фольга горячего тиснения МВ 35', winding: 'OUT', length: 300 }),
    '3310 / Фольга · OUT · 300', 'cutRowLabel: сырьё обрезано до первого пробела');

// ── ganttRange: неделя с понедельника, 7 дней ──
var weekRange = gantt.ganttRange('2026-06-11', 'week');
assertEqual({ mode: weekRange.mode, startIso: weekRange.startIso, endIso: weekRange.endIso, days: weekRange.days.length },
    { mode: 'week', startIso: '2026-06-08', endIso: '2026-06-15', days: 7 },
    'ganttRange: неделя 08–14 июня (7 дней)');

// ── shiftAnchor: неделя назад/вперёд ──
assertEqual(gantt.shiftAnchor('2026-06-11', 'week', 1), '2026-06-15', 'shiftAnchor: +1 неделя');
assertEqual(gantt.shiftAnchor('2026-06-11', 'week', -1), '2026-06-01', 'shiftAnchor: −1 неделя');

// ── #3683: период по умолчанию — «День» (пустой/неизвестный режим → 'day', один день) ──
var defRange = gantt.ganttRange('2026-06-11', '');
assertEqual({ mode: defRange.mode, startIso: defRange.startIso, endIso: defRange.endIso, days: defRange.days.length },
    { mode: 'day', startIso: '2026-06-11', endIso: '2026-06-12', days: 1 },
    'ganttRange: дефолтный режим — День (1 день)');
assertEqual(gantt.ganttRange('2026-06-11', 'неизвестно').mode, 'day', 'ganttRange: неизвестный режим → День');

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
// #3680: подпись охватывает ВСЁ задание (наладка + резка) — начало = старт задания (08:00),
// конец = после наладки 45 мин + резки 4 мин; длительность = 49 мин (а не только 4 мин резки).
assertEqual(gantt.cutBarTime({ planDate: '2026-06-10 08:00', duration: 4 }, 45),
    '08:00-08:49 (49 мин)', 'cutBarTime: наладка+резка одним окном (#3680)');

// ── cutSetupMin (#3675 п.3): минуты наладки только у запланированных (без факт. старта) ──
assertEqual(gantt.cutSetupMin({ planDate: '2026-06-10 08:00', setupKnifeMin: 30, setupMaterialMin: 15 }),
    { knife: 30, material: 15, total: 45 }, 'cutSetupMin: запланированная — ножи+сырьё');
assertEqual(gantt.cutSetupMin({ planDate: '2026-06-10 08:00', startDate: '2026-06-10 08:05',
    endDate: '2026-06-10 09:05', setupKnifeMin: 30, setupMaterialMin: 15 }),
    { knife: 0, material: 0, total: 0 }, 'cutSetupMin: начатая — наладка уже позади (0)');
assertEqual(gantt.cutSetupMin({ planDate: '2026-06-10 08:00' }),
    { knife: 0, material: 0, total: 0 }, 'cutSetupMin: нет минут (старый отчёт) → 0');

// ── cutBarSegments (#3675 п.3): ширины [наладка ножей][смена сырья][резка] в px ──
// 2 px/мин: резка 4 мин = 8px; наладка 30 мин = 60px, смена 15 мин = 30px.
assertEqual(gantt.cutBarSegments({ planDate: '2026-06-10 08:00', duration: 4, setupKnifeMin: 30, setupMaterialMin: 15 }, 2, 8),
    { knifePx: 60, materialPx: 30, cutPx: 8, totalPx: 98, knifeMin: 30, materialMin: 15, setupMin: 45 },
    'cutBarSegments: наладка слева + резка справа');
// Начатая резка — сегментов наладки нет (всё в резку).
assertEqual(gantt.cutBarSegments({ planDate: '2026-06-10 08:00', startDate: '2026-06-10 08:00',
    endDate: '2026-06-10 08:30', setupKnifeMin: 30, setupMaterialMin: 15 }, 2, 8),
    { knifePx: 0, materialPx: 0, cutPx: 60, totalPx: 60, knifeMin: 0, materialMin: 0, setupMin: 0 },
    'cutBarSegments: начатая — без наладки');
// Без минут наладки — один сегмент резки (первая резка станка / нет данных).
assertEqual(gantt.cutBarSegments({ planDate: '2026-06-10 08:00', duration: 4 }, 2, 8),
    { knifePx: 0, materialPx: 0, cutPx: 8, totalPx: 8, knifeMin: 0, materialMin: 0, setupMin: 0 },
    'cutBarSegments: без наладки — один сегмент резки');

// ── cutChangeoverMinutes (#3675 п.3): переналадка prev→next (порт changeoverParts) ──
var TIMES = { MATERIAL_WINDING: 15, KNIFE: 30 };
assertEqual(gantt.cutChangeoverMinutes(null, { materialId: '5' }, TIMES),
    { knife: 0, material: 0 }, 'cutChangeoverMinutes: первая резка станка → 0');
// Та же намотка/сырьё/ножи → 0; смена сырья → MATERIAL_WINDING; смена ножей → KNIFE.
var cutA = { materialId: '5', winding: 'OUT', rollerWidth: 88, knifeWidths: [55, 33], knifeCount: 2 };
assertEqual(gantt.cutChangeoverMinutes(cutA, { materialId: '5', winding: 'OUT', rollerWidth: 88, knifeWidths: [55, 33], knifeCount: 2 }, TIMES),
    { knife: 0, material: 0 }, 'cutChangeoverMinutes: всё совпало → 0');
assertEqual(gantt.cutChangeoverMinutes(cutA, { materialId: '7', winding: 'OUT', rollerWidth: 88, knifeWidths: [55, 33], knifeCount: 2 }, TIMES),
    { knife: 0, material: 15 }, 'cutChangeoverMinutes: другое сырьё → смена сырья 15');
assertEqual(gantt.cutChangeoverMinutes(cutA, { materialId: '5', winding: 'IN', rollerWidth: 88, knifeWidths: [55, 33], knifeCount: 2 }, TIMES),
    { knife: 0, material: 15 }, 'cutChangeoverMinutes: другая намотка → смена сырья 15');
assertEqual(gantt.cutChangeoverMinutes(cutA, { materialId: '5', winding: 'OUT', rollerWidth: 88, knifeWidths: [60, 40], knifeCount: 2 }, TIMES),
    { knife: 30, material: 0 }, 'cutChangeoverMinutes: другой набор ножей → смена ножей 30');
assertEqual(gantt.cutChangeoverMinutes(cutA, { materialId: '7', winding: 'OUT', rollerWidth: 70, knifeWidths: [55, 33], knifeCount: 2 }, TIMES),
    { knife: 30, material: 15 }, 'cutChangeoverMinutes: сырьё+сужение ролика → 30 и 15');

// ── attachStrips (#3675 п.3): cut_strips → knifeWidths/knifeCount ──
var stripCuts = [{ id: '1' }, { id: '2' }];
gantt.attachStrips(stripCuts, [
    { cut_id: '1', strip_width: '55.00', strip_qty: '2' },
    { cut_id: '1', strip_width: '33.00', strip_qty: '1' },
    { cut_id: '2', strip_width: '110.00', strip_qty: '3' }
]);
assertEqual([stripCuts[0].knifeWidths, stripCuts[0].knifeCount], [[55, 55, 33], 3], 'attachStrips: ширины развёрнуты по qty');
assertEqual([stripCuts[1].knifeWidths, stripCuts[1].knifeCount], [[110, 110, 110], 3], 'attachStrips: второе задание');

// ── attachSetupMinutes (#3675 п.3 / #3693): наладка по предыдущей резке + первая от заправки ──
function freshSeq() {
    return [
        { id: 'a', sequence: 1, slitter: { id: '10' }, materialId: '5', winding: 'OUT', rollerWidth: 88, knifeWidths: [55], knifeCount: 1 },
        { id: 'b', sequence: 2, slitter: { id: '10' }, materialId: '7', winding: 'OUT', rollerWidth: 88, knifeWidths: [55], knifeCount: 1 },
        { id: 'c', sequence: 1, slitter: { id: '20' }, materialId: '5', winding: 'OUT', rollerWidth: 88, knifeWidths: [55], knifeCount: 1 }
    ];
}
// #3693: нет данных prev_cut_setup → первая резка станка = настройка ножей с нуля (KNIFE 30), не 0.
var seqNoSetup = freshSeq();
gantt.attachSetupMinutes(seqNoSetup, TIMES);
assertEqual([seqNoSetup[0].setupKnifeMin, seqNoSetup[0].setupMaterialMin], [30, 0], 'attachSetupMinutes #3693: первая (нет заправки) → ножи с нуля 30');
assertEqual([seqNoSetup[1].setupKnifeMin, seqNoSetup[1].setupMaterialMin], [0, 15], 'attachSetupMinutes: смена сырья у второй');
assertEqual([seqNoSetup[2].setupKnifeMin, seqNoSetup[2].setupMaterialMin], [30, 0], 'attachSetupMinutes #3693: первая на станке 20 (нет заправки) → ножи 30');

// #3693: известна заправка станка 10 — тот же материал, ДРУГИЕ ножи → у первой только смена ножей 30.
var seqSameMat = freshSeq();
gantt.attachSetupMinutes(seqSameMat, TIMES, { '10': { materialId: '5', winding: 'OUT', knifeWidths: [99], knifeCount: 1 } });
assertEqual([seqSameMat[0].setupKnifeMin, seqSameMat[0].setupMaterialMin], [30, 0], 'attachSetupMinutes #3693: заправка тем же сырьём, др. ножи → смена ножей 30');
// Заправка ТОЧНО как первая резка (сырьё+намотка+ножи) → наладки нет (0).
var seqIdentical = freshSeq();
gantt.attachSetupMinutes(seqIdentical, TIMES, { '10': { materialId: '5', winding: 'OUT', knifeWidths: [55], knifeCount: 1 } });
assertEqual([seqIdentical[0].setupKnifeMin, seqIdentical[0].setupMaterialMin], [0, 0], 'attachSetupMinutes #3693: та же заправка → первая без наладки');
// Заправка другим сырьём, те же ножи → только смена сырья 15.
var seqDiffMat = freshSeq();
gantt.attachSetupMinutes(seqDiffMat, TIMES, { '10': { materialId: '999', winding: 'OUT', knifeWidths: [55], knifeCount: 1 } });
assertEqual([seqDiffMat[0].setupKnifeMin, seqDiffMat[0].setupMaterialMin], [0, 15], 'attachSetupMinutes #3693: заправка др. сырьём, те же ножи → смена сырья 15');

// ── #3693: разбор отчёта prev_cut_setup (порт prevSetupFromRows/carryOverPrevCut/firstSetup) ──
var SETUP_ROWS = [
    { task_start: '2000', slitter_id: '10', task_id: 'T2', wind_dir: 'IN', width: '55.00', material_id: '39014' },
    { task_start: '2000', slitter_id: '10', task_id: 'T2', wind_dir: 'IN', width: '33.00', material_id: '39014' },
    { task_start: '1000', slitter_id: '10', task_id: 'T1', wind_dir: 'OUT', width: '110.00', material_id: '2158' },
    { task_start: '3000', slitter_id: '20', task_id: 'T3', wind_dir: 'IN', width: '90.00', material_id: '500' }
];
assertEqual(gantt.ganttPrevSetupFromRows(SETUP_ROWS, '10'),
    { materialId: '39014', winding: 'IN', knifeWidths: [55, 33], knifeCount: 2 }, 'ganttPrevSetupFromRows: верхняя задача станка 10 (T2)');
assertEqual(gantt.ganttPrevSetupFromRows(SETUP_ROWS, '999'), null, 'ganttPrevSetupFromRows: нет задач станка → null');
assertEqual(Object.keys(gantt.ganttPrevSetupBySlitter(SETUP_ROWS)).sort(), ['10', '20'], 'ganttPrevSetupBySlitter: карта по станкам');
assertEqual(gantt.ganttCarryOverPrevCut({ materialId: '39014', winding: 'IN', knifeWidths: [55, 33] }),
    { materialId: '39014', winding: 'IN', knifeWidths: [55, 33], knifeCount: 2, rollerWidth: 0 }, 'ganttCarryOverPrevCut: из заправки');
assertEqual(gantt.ganttCarryOverPrevCut(null).knifeCount, 0, 'ganttCarryOverPrevCut: нет заправки → пустой станок');
assertEqual(gantt.ganttFirstSetupKnifeMin({ knifeCount: 2 }, TIMES), 30, 'ganttFirstSetupKnifeMin: есть ножи → 30');
assertEqual(gantt.ganttFirstSetupKnifeMin({ knifeCount: 0, knifeWidths: [] }, TIMES), 0, 'ganttFirstSetupKnifeMin: нет ножей → 0');

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
    'layoutGroups: внутри станка — по времени старта; left/width по реальному времени, разрыв виден');
// #3747: ось свёрнута к рабочим окнам [08:00;18:30]. task20 (06-11 09:00) на станке 2:
// окно 06-10 = 630 мин (08:00…18:30), затем окно 06-11 встык; 09:00 = +60 мин → left = 690.
assertEqual(laid.groups[1].tasks.map(function(t) { return [t.cut.id, t.leftPx, t.widthPx]; }),
    [['20', 690, 40]], 'layoutGroups: #3747 бар след. дня — встык за рабочим окном (ночь свёрнута)');
assertEqual(laid.trackPx, 1260, 'layoutGroups: #3747 trackPx = 2 рабочих окна × 630 мин × 1 = 1260');
assertEqual(gantt.layoutGroups(layoutCuts, weekRange, NOW, { slitter: '2' }, { pxPerMin: 1 }).groups.map(function(g) { return g.slitter.label; }),
    ['Станок 2'], 'layoutGroups: фильтр по станку');

// ── chooseHourStep (#3668 п.6): шаг 1/2/4/6/8/12/24 ч, деления не уже 50px ──
assertEqual(gantt.chooseHourStep(120), 1, 'chooseHourStep: 120px/ч ≥50 → 1 ч (День)');
assertEqual(gantt.chooseHourStep(60), 1, 'chooseHourStep: 60px/ч ≥50 → 1 ч (3 дня)');
assertEqual(gantt.chooseHourStep(24), 4, 'chooseHourStep: 24px/ч → 4 ч (96px, Неделя)');
assertEqual(gantt.chooseHourStep(4.8), 12, 'chooseHourStep: 4.8px/ч → 12 ч (57.6px, Месяц)');

// ── hourTicks (#3747): деления ТОЛЬКО внутри рабочих окон масштаба; «HH:00», дата на старте дня ──
var scale1 = gantt.ganttScale([{ startMs: gantt.parseDateTimeMs('2026-06-10 08:00'), endMs: gantt.parseDateTimeMs('2026-06-10 12:00') }], 2);
var ticks = gantt.hourTicks(scale1, 2); // 120px/ч → шаг 1 ч
assertEqual(ticks.map(function(t) { return t.label; }), ['08:00', '09:00', '10:00', '11:00', '12:00'],
    'hourTicks: метки каждый час 08:00…12:00');
assertEqual([ticks[0].leftPx, ticks[1].leftPx, ticks[4].leftPx], [0, 120, 480],
    'hourTicks: шаг 120px (2px/мин×60), 12:00→480px');
assertEqual([ticks[0].dateLabel, ticks[1].dateLabel], ['10.06', ''],
    'hourTicks: дата только на первом тике суток');

// ── #3747: рабочие окна, свёрнутая ось, захлёст, хронологический порядок ──
// workingSegments: по одному окну [08:00;18:30] на день с заданиями; ночь не входит.
var segCuts = [
    { id: 'a', planDate: '2026-06-10 09:00', duration: 60 },
    { id: 'b', planDate: '2026-06-11 10:00', duration: 30 }
];
var segs = gantt.workingSegments(segCuts, weekRange, {});
assertEqual(segs.map(function(s) { return [gantt.formatTime(s.startMs), gantt.formatTime(s.endMs)]; }),
    [['08:00', '18:30'], ['08:00', '18:30']],
    'workingSegments: окно [08:00;18:30] на каждый день с заданиями');
// Заданий нет → одно окно-смена дня периода.
assertEqual(gantt.workingSegments([], weekRange, {}).length, 1, 'workingSegments: пусто → одно окно-смена');
// Захлёст: задание стартует 18:00, длится 60 → конец 19:00 расширяет правый край окна дня.
var spill = gantt.workingSegments([{ id: 'x', planDate: '2026-06-10 18:00', duration: 60 }], weekRange, {});
assertEqual([gantt.formatTime(spill[0].startMs), gantt.formatTime(spill[0].endMs)], ['08:00', '19:00'],
    'workingSegments: захлёст за смену расширяет правый край окна дня (18:00+60 → 19:00)');
// Ранний старт (07:30) расширяет левый край.
var early = gantt.workingSegments([{ id: 'y', planDate: '2026-06-10 07:30', duration: 30 }], weekRange, {});
assertEqual(gantt.formatTime(early[0].startMs), '07:30', 'workingSegments: ранний старт расширяет левый край окна');

// ganttScale.toPx: ночь между окнами свёрнута, дни встык.
var scale2 = gantt.ganttScale(segs, 1);
assertEqual(scale2.totalPx, 1260, 'ganttScale: 2 окна × 630 мин × 1 = 1260');
assertEqual(scale2.toPx(gantt.parseDateTimeMs('2026-06-10 08:00')), 0, 'ganttScale.toPx: старт 1-го окна → 0');
assertEqual(scale2.toPx(gantt.parseDateTimeMs('2026-06-11 08:00')), 630, 'ganttScale.toPx: старт 2-го дня — встык за 1-м окном (ночь свёрнута)');
assertEqual(scale2.toPx(gantt.parseDateTimeMs('2026-06-10 23:00')), 630, 'ganttScale.toPx: ночь (вне окон) → стык дней');

// orderCutsInGroup (#3747): строки по реальному времени старта, НЕ по «Очередности»
// (она сбрасывается на день). День2-очередь1 НЕ должен вставать над днём1-очередь2.
var orderCuts = [
    { id: 'd1q2', planDate: '2026-06-10 12:00', sequence: 2 },
    { id: 'd2q1', planDate: '2026-06-11 08:00', sequence: 1 },
    { id: 'd1q1', planDate: '2026-06-10 08:00', sequence: 1 }
];
assertEqual(gantt.orderCutsInGroup(orderCuts.slice()).map(function(c) { return c.id; }),
    ['d1q1', 'd1q2', 'd2q1'],
    'orderCutsInGroup: #3747 хронологически (день1 целиком, потом день2), а не вперемешку по очередности');

// ── planningLink: ссылка на планировщик с датой/станком/заданием ──
assertEqual(gantt.planningLink({ id: '85472', planDate: '06.05.2026', slitter: { id: '1285' } }),
    '/atex/production-planning?cut=85472&date=2026-05-06&slitter=1285',
    'planningLink: cut+date+slitter');
assertEqual(gantt.planningLink({ id: '7', planDate: '', slitter: { id: null } }),
    '/atex/production-planning?cut=7',
    'planningLink: без даты/станка — только cut');
assertEqual(gantt.planningLink({ id: '7' }, '/x/pp'),
    '/x/pp?cut=7', 'planningLink: базовый URL переопределяется');

// ── parseDeepLink: #3713 Гант дополнительно понимает from/to (диапазон из «Планирования») ──
assertEqual(gantt.parseDeepLink('?cut=85472&date=2026-05-06&slitter=1285'),
    { cut: '85472', date: '2026-05-06', slitter: '1285', from: '', to: '' }, 'parseDeepLink (gantt): полный');
assertEqual(planning.parseDeepLink('?cut=85472&date=2026-05-06&slitter=1285'),
    { cut: '85472', date: '2026-05-06', slitter: '1285' }, 'parseDeepLink (planning): полный');
assertEqual(gantt.parseDeepLink('?from=2026-06-25&to=2026-06-27&slitter=1285'),
    { cut: '', date: '', slitter: '1285', from: '2026-06-25', to: '2026-06-27' }, 'parseDeepLink (gantt) #3713: диапазон from/to');
assertEqual(gantt.parseDeepLink(''), { cut: '', date: '', slitter: '', from: '', to: '' }, 'parseDeepLink: пусто');
assertEqual(gantt.parseDeepLink('?foo=1&cut=9'), { cut: '9', date: '', slitter: '', from: '', to: '' }, 'parseDeepLink: лишние параметры игнорируются');

// ── #3705: лидер «между резками» в конце задания (раньше терялся → бар короче плана) ──
// Лидер = BETWEEN_CUTS × «Кол-во план» (порт cutLeaderRuns планировщика).
assertEqual(gantt.ganttCutLeaderRuns({ plannedRuns: 8 }), 8, 'ganttCutLeaderRuns: «Кол-во план»');
assertEqual(gantt.ganttCutLeaderRuns({ plannedRuns: 0 }), 1, 'ganttCutLeaderRuns: 0 резок → 1');
assertEqual(gantt.ganttCutLeaderRuns({}), 1, 'ganttCutLeaderRuns: нет «Кол-во план» → 1');
assertEqual(gantt.ganttLeaderMin({ plannedRuns: 8 }, { BETWEEN_CUTS: 2 }), 16, 'ganttLeaderMin: 2×8=16 (как разрыв task1 на скрине)');
assertEqual(gantt.ganttLeaderMin({ plannedRuns: 10 }, { BETWEEN_CUTS: 2 }), 20, 'ganttLeaderMin: 2×10=20 (как разрыв task2 на скрине)');
assertEqual(gantt.ganttLeaderMin({ plannedRuns: 5 }), 10, 'ganttLeaderMin: дефолт BETWEEN_CUTS=2 → 2×5=10');
// attachLeaderMinutes кладёт cut.leaderMin каждому заданию.
var leadCut = { planDate: '2026-06-10 08:00', duration: 35, plannedRuns: 8 };
gantt.attachLeaderMinutes([leadCut], { BETWEEN_CUTS: 2 });
assertEqual(leadCut.leaderMin, 16, 'attachLeaderMinutes: проставляет cut.leaderMin');
// cutBarMinutes: cut_time нет → намотка + лидер; есть cut_time → берём его (уже с лидером).
assertEqual(gantt.cutBarMinutes(leadCut), 51, 'cutBarMinutes #3705: намотка(35) + лидер(16), когда нет cut_time');
assertEqual(gantt.cutBarMinutes({ planDate: '2026-06-10 08:00', duration: 35, leaderMin: 16, cutTimeMin: 50 }), 50,
    'cutBarMinutes #3705: «Резка и Лидер» (cut_time) приоритетнее фолбэка');
assertEqual(gantt.cutBarMinutes({ planDate: '2026-06-10 08:00', startDate: '2026-06-10 08:00', endDate: '2026-06-10 08:40', leaderMin: 16 }), 40,
    'cutBarMinutes #3705: у начатой — фактическое окно, лидер не добавляется');
// cutBarTime: конец задания теперь включает лидер (фикс разрыва из #3705).
assertEqual(gantt.cutBarTime(leadCut, 0), '08:00-08:51 (51 мин)', 'cutBarTime #3705: конец = старт + намотка + лидер');
assertEqual(gantt.cutBarTime(leadCut, 30), '08:00-09:21 (81 мин)', 'cutBarTime #3705: + наладка 30 → конец 09:21');

// ── #3704: зум по горизонтали + нижняя граница «вписать в экран» ──
// #3747: workMin = 2 рабочих окна × 630 мин = 1260 (раньше 1560 с ночью). trackPx и «вписать
// в экран» считаются от свёрнутой оси.
var laidZoom = gantt.layoutGroups(layoutCuts, weekRange, NOW, {}, { pxPerMin: 1, zoom: 2 });
assertEqual(laidZoom.pxPerMin, 2, 'layoutGroups #3704: зум ×2 удваивает масштаб');
assertEqual(laidZoom.trackPx, 2520, 'layoutGroups #3704: trackPx ×2 при зуме ×2 (#3747: 1260×2)');
assertEqual(laidZoom.groups[0].tasks.map(function(t) { return [t.cut.id, t.leftPx, t.widthPx]; }),
    [['11', 0, 60], ['10', 240, 120]], 'layoutGroups #3704: зум растягивает бары по горизонтали');
// fitTrackPx поднимает масштаб, чтобы дорожка заполнила экран (не уже видимой области)…
var laidFit = gantt.layoutGroups(layoutCuts, weekRange, NOW, {}, { pxPerMin: 1, fitTrackPx: 2520 });
assertEqual([laidFit.pxPerMin, laidFit.trackPx], [2, 2520], 'layoutGroups #3704: масштаб поднят до «вписать в экран» (#3747: 2520/1260=2)');
// …но НЕ опускает ниже базового (узкий экран не сжимает бары мельче масштаба режима).
var laidFitSmall = gantt.layoutGroups(layoutCuts, weekRange, NOW, {}, { pxPerMin: 1, fitTrackPx: 780 });
assertEqual(laidFitSmall.pxPerMin, 1, 'layoutGroups #3704: fitTrackPx меньше базового не сжимает масштаб');
// Зум и fit вместе: зум ниже fit перекрывается «вписать в экран».
var laidZoomFit = gantt.layoutGroups(layoutCuts, weekRange, NOW, {}, { pxPerMin: 1, zoom: 0.25, fitTrackPx: 2520 });
assertEqual(laidZoomFit.pxPerMin, 2, 'layoutGroups #3704: «−» ниже экрана упирается в «вписать в экран»');

// ── #3708: бар не заходит за старт следующего задания (округление длительностей вверх) ──
// cutBarTime с maxEndMs обрезает конец до старта следующего.
var cutOvershoot = { planDate: '2026-06-10 08:00', duration: 21, leaderMin: 16 };   // намотка 21 + лидер 16 = 37
assertEqual(gantt.cutBarTime(cutOvershoot, 30), '08:00-09:07 (67 мин)',
    'cutBarTime: без обрезки — наладка 30 + резка+лидер 37 = 67 мин (конец 09:07)');
assertEqual(gantt.cutBarTime(cutOvershoot, 30, gantt.parseDateTimeMs('2026-06-10 09:06')), '08:00-09:06 (66 мин)',
    'cutBarTime #3708: конец обрезан до старта следующего (09:06)');
assertEqual(gantt.cutBarTime(cutOvershoot, 30, gantt.parseDateTimeMs('2026-06-10 10:00')), '08:00-09:07 (67 мин)',
    'cutBarTime #3708: clamp позже конца — без изменений');
// layoutGroups: два задания подряд на станке, бар первого «перелезал» бы на 1 мин — режется встык.
var overlapCuts = [
    { id: 'A', planDate: '2026-06-10 08:00', duration: 21, plannedRuns: 8, leaderMin: 16, setupKnifeMin: 30, sequence: 1, slitter: { id: '1', label: 'Станок 1' } },
    { id: 'B', planDate: '2026-06-10 09:06', duration: 44, plannedRuns: 10, leaderMin: 20, sequence: 2, slitter: { id: '1', label: 'Станок 1' } }
];
var laidClamp = gantt.layoutGroups(overlapCuts, gantt.ganttRange('2026-06-10', 'day'),
    gantt.parseDateTimeMs('2026-06-10 07:00'), {}, { pxPerMin: 1 });
var ct = laidClamp.groups[0].tasks;
assertEqual([ct[0].cut.id, ct[0].leftPx, ct[0].widthPx], ['A', 0, 66],
    'layoutGroups #3708: бар A обрезан с 67 до 66 мин (старт B)');
assertEqual(ct[0].barText, '08:00-09:06 (66 мин)', 'layoutGroups #3708: подпись A совпадает с планом (до 09:06)');
assertEqual(ct[0].leftPx + ct[0].widthPx, ct[1].leftPx, 'layoutGroups #3708: A встык к B — налезания нет');
// Завершённое задание (есть факт. финиш) не режем — показываем реальную длительность.
var doneThenNext = [
    { id: 'D', planDate: '2026-06-10 08:00', startDate: '2026-06-10 08:00', endDate: '2026-06-10 09:10', sequence: 1, slitter: { id: '1', label: 'Станок 1' } },
    { id: 'E', planDate: '2026-06-10 09:06', duration: 30, sequence: 2, slitter: { id: '1', label: 'Станок 1' } }
];
var laidDone = gantt.layoutGroups(doneThenNext, gantt.ganttRange('2026-06-10', 'day'),
    gantt.parseDateTimeMs('2026-06-10 07:00'), {}, { pxPerMin: 1 });
assertEqual(laidDone.groups[0].tasks[0].widthPx, 70,
    'layoutGroups #3708: завершённое задание не обрезается (факт 70 мин, конфликт виден)');

// ── #3713: произвольный диапазон [С;По] из «Планирования» (deep-link from/to) ──
assertEqual(gantt.daySpanToMode('2026-06-25', '2026-06-25'), 'day', 'daySpanToMode: 1 день → day');
assertEqual(gantt.daySpanToMode('2026-06-25', '2026-06-27'), 'three', 'daySpanToMode: 3 дня → three');
assertEqual(gantt.daySpanToMode('2026-06-25', '2026-07-01'), 'week', 'daySpanToMode: 7 дней → week');
assertEqual(gantt.daySpanToMode('2026-06-25', '2026-07-10'), 'month', 'daySpanToMode: >7 дней → month');
var r3713 = gantt.ganttRangeFromTo('2026-06-25', '2026-06-27');
assertEqual([r3713.startIso, gantt.localIsoDateFromMs(r3713.endMs - 1), r3713.mode, r3713.days.length],
    ['2026-06-25', '2026-06-27', 'three', 3], 'ganttRangeFromTo #3713: 25–27 июня включительно (3 дня), mode three');
assertEqual(gantt.ganttRangeFromTo('2026-06-25', '').mode, 'day', 'ganttRangeFromTo #3713: пустой «По» → один день');
assertEqual([gantt.cutInRange({ planDate: '2026-06-26' }, r3713), gantt.cutInRange({ planDate: '2026-06-28' }, r3713)],
    [true, false], 'cutInRange #3713: 26 в диапазоне, 28 — вне (По=27 включительно)');
// planning.ganttRangeLink: иконка у фильтра дат → Гант с диапазоном.
assertEqual(planning.ganttRangeLink('2026-06-25', '2026-06-27', '/ateh/cut-gantt'),
    '/ateh/cut-gantt?from=2026-06-25&to=2026-06-27', 'ganttRangeLink #3713: from+to');
assertEqual(planning.ganttRangeLink('2026-06-25', '', '/ateh/cut-gantt'),
    '/ateh/cut-gantt?from=2026-06-25&to=2026-06-25', 'ganttRangeLink #3713: пустой «По» → to=from');
assertEqual(planning.ganttRangeLink('', '', '/ateh/cut-gantt'), '/ateh/cut-gantt',
    'ganttRangeLink #3713: без дат → базовый URL');

console.log('\n' + passed + ' assertions passed');
