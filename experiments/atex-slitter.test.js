// Unit tests for the «Пульт слиттера» core (ideav/crm#2915, #3459).
// Verifies the design-spec behaviour from the atex spec (§3.5):
//   • статусы резки: Ожидает → В работе → Завершена (упрощённая цепочка, #3459);
//   • расход сырья уменьшает остаток партии (FIFO-подбор + списание);
//   • событие смены пишется с датой/временем (формат хронологии);
//   • погонаж вычисляемый = счётчик кон. − счётчик нач. (read-only, #3459);
//   • блокировка последующих резок в «Ожидает» (#3459).
//
// Run with: node experiments/atex-slitter.test.js

var core = require('../download/atex/js/slitter.js').core;

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

// ── toNumber: терпимый разбор ──
assertEqual(core.toNumber('120'), 120, 'toNumber parses integer string');
assertEqual(core.toNumber('12,5'), 12.5, 'toNumber accepts comma decimal');
assertEqual(core.toNumber(' 1 000 '), 1000, 'toNumber strips spaces');
assertEqual(core.toNumber(''), 0, 'toNumber empty → 0');
assertEqual(core.toNumber('abc'), 0, 'toNumber garbage → 0');

// ── #3635 п.5: isSetupTask — задание-«настройка» (явный «0» проходов) ──
assertEqual(core.isSetupTask({ plannedRuns: '0' }), true, 'isSetupTask: «Кол-во план» = «0» → настройка');
assertEqual(core.isSetupTask({ plannedRuns: '2' }), false, 'isSetupTask: проходы > 0 → резка');
assertEqual(core.isSetupTask({ plannedRuns: '' }), false, 'isSetupTask: пусто (не задано) → не настройка');
assertEqual(core.isSetupTask({}), false, 'isSetupTask: нет поля → не настройка');

// ── normalizeStatus: приведение к известным, пустое → первый статус ──
assertEqual(core.normalizeStatus(''), 'Ожидает', 'empty status → Ожидает');
assertEqual(core.normalizeStatus('  наладка '), 'наладка', 'normalizes spaces (Наладка убрана из цепочки, сохраняется как есть)');
assertEqual(core.normalizeStatus('Завершён'), 'Завершён', 'keeps terminal status');
assertEqual(core.normalizeStatus('Архив'), 'Архив', 'unknown status preserved verbatim');

// ── nextStatus: цепочка переходов Ожидает → В работе → Завершена (#3459) ──
assertEqual(core.nextStatus('Ожидает'), 'В работе', 'Ожидает → В работе');
assertEqual(core.nextStatus('В работе'), 'Завершена', 'В работе → Завершена');
assertEqual(core.nextStatus('Завершена'), 'Завершена', 'Завершена is terminal (stays)');
assertEqual(core.nextStatus(''), 'В работе', 'empty treated as Ожидает → В работе');
assertEqual(core.nextStatus('Архив'), 'Архив', 'unknown status has no next');

// ── isDone ──
assertEqual(core.isDone('Завершена'), true, 'isDone true for Завершена');
assertEqual(core.isDone('Завершён'), true, 'isDone backward-compat: Завершён');
assertEqual(core.isDone('завершена'), true, 'isDone case-insensitive');
assertEqual(core.isDone('В работе'), false, 'isDone false for В работе');

// ── meterageFromCounters: #4321 счётчик мотает НАЗАД → погонаж = нач. − кон. ──
assertEqual(core.meterageFromCounters(2000, 1500), 500, '#4321 meterage = start − end (счётчик убывает)');
assertEqual(core.meterageFromCounters('1 850,5', '1 000'), 850.5, 'meterage parses formatted input');
assertEqual(core.meterageFromCounters(1000, 1850), 0, '#4321 обратный ввод (кон. > нач.) → 0');
assertEqual(core.meterageFromCounters('', ''), 0, 'meterage of empty counters → 0');

// ── #3433: факт. проходы из погонажа и факт. рулоны полосы ──
assertEqual(core.actualRunsFromMeterage(1200, 400, 5), 3, 'actualRunsFromMeterage: 1200 ÷ 400 = 3 прохода');
assertEqual(core.actualRunsFromMeterage(1250, 400, 5), 3, 'actualRunsFromMeterage: округление до целого прохода (1250/400≈3)');
assertEqual(core.actualRunsFromMeterage(0, 400, 5), 5, 'actualRunsFromMeterage: нет погонажа → фолбэк на план (5)');
assertEqual(core.actualRunsFromMeterage(1200, 0, 5), 5, 'actualRunsFromMeterage: нет метража прогона → фолбэк на план');
assertEqual(core.actualRunsFromMeterage(0, 0, 0), 0, 'actualRunsFromMeterage: нет данных → 0');
assertEqual(core.actualRollsForStrip(2, 3), 6, 'actualRollsForStrip: 2 полосы × 3 прохода = 6 рулонов факт');
assertEqual(core.actualRollsForStrip(0, 3), '', 'actualRollsForStrip: нет полос → пусто (поле не пишем)');
assertEqual(core.actualRollsForStrip(2, 0), '', 'actualRollsForStrip: нет проходов → пусто');

// ── sumConsumption: сумма израсходованного ──
assertEqual(core.sumConsumption([
    { amount: '120,5' }, { amount: 80 }, { amount: '' }
]), 200.5, 'sumConsumption totals amounts (with comma decimals)');
assertEqual(core.sumConsumption([]), 0, 'sumConsumption of empty set → 0');

// ── sortFifo: партии раньше пришли — раньше расходуем (стабильно) ──
var batches = [
    { id: 'b3', date: '2026-05-20', remainder: 100 },
    { id: 'b1', date: '2026-05-10', remainder: 0 },
    { id: 'b2', date: '2026-05-15', remainder: 50 },
    { id: 'b4', date: '2026-05-15', remainder: 30 } // равная дата → исходный порядок
];
assertEqual(core.sortFifo(batches).map(function(b) { return b.id; }),
    ['b1', 'b2', 'b4', 'b3'], 'sortFifo orders by arrival date, stable on ties');

// ── pickFifoBatch: первая по FIFO партия с положительным остатком ──
assertEqual(core.pickFifoBatch(batches).id, 'b2', 'pickFifoBatch skips empty (b1), picks earliest with remainder');
assertEqual(core.pickFifoBatch([{ id: 'x', date: '2026-01-01', remainder: 0 }]), null,
    'pickFifoBatch → null when nothing left to consume');

// ── applyConsumption: остаток уменьшается на списанное (критерий §3.5) ──
assertEqual(core.applyConsumption(100, 30), 70, 'applyConsumption reduces remainder');
assertEqual(core.applyConsumption(50, 80), 0, 'applyConsumption clamps at zero (no negative remainder)');
assertEqual(core.applyConsumption('100,5', '0,5'), 100, 'applyConsumption parses formatted values');

// ── restoreConsumption: возврат остатка при отмене расхода ──
assertEqual(core.restoreConsumption(70, 30), 100, 'restoreConsumption adds back to remainder');

// Полный цикл: списали 30, затем правка на 50 (дельта +20), затем отмена (−50).
var rem = 100;
rem = core.applyConsumption(rem, 30);            // 70
assertEqual(rem, 70, 'cycle: consume 30 → 70');
rem = core.applyConsumption(rem, 20);            // дельта при правке 30→50
assertEqual(rem, 50, 'cycle: edit 30→50 applies delta 20 → 50');
rem = core.restoreConsumption(rem, 50);          // отмена расхода
assertEqual(rem, 100, 'cycle: cancel restores full 50 → 100');

// ── formatDateTime: дата/время события смены (хронология) ──
assertEqual(core.formatDateTime(new Date(2026, 4, 30, 9, 5, 7)), '2026-05-30 09:05:07',
    'formatDateTime pads month/day/time to YYYY-MM-DD HH:MM:SS');

// ── остаток,м по дельте погонажа (используем applyConsumption/restoreConsumption) ──
assertEqual(core.applyConsumption(4000, 300 - 0), 3700, 'остаток,м: первое списание погонажа');
assertEqual(core.restoreConsumption(3700, 300 - 250), 3750, 'остаток,м: правка погонажа вниз возвращает');
assertEqual(core.applyConsumption(100, 300), 0, 'остаток,м: не ниже нуля');

// ── defectM2: брак,м² = брак,м × ширина_мм/1000 ──
assertEqual(core.defectM2(10, 910), 9.1, 'defectM2: 10 м при 910 мм = 9.1 м²');
assertEqual(core.defectM2('5,5', 880), 4.84, 'defectM2: запятая-десятичная, 880 мм');
assertEqual(core.defectM2(0, 910), 0, 'defectM2: ноль метров → 0');
assertEqual(core.defectM2(10, 0), 0, 'defectM2: нет ширины → 0');
assertEqual(core.defectM2(-3, 910), 0, 'defectM2: отрицательные метры → 0');

// ── photoFieldKey: ключ multipart-поля для реквизита FILE ──
assertEqual(core.photoFieldKey('1118'), 't1118', 'photoFieldKey: t + reqId');
assertEqual(core.photoFieldKey(null), '', 'photoFieldKey: нет reqId → пусто');

// ── #3646/#3923: очередь слиттера — фильтр по станку/дате; завершённые видны ВСЕГДА, на своих
// местах по planStart (planDate, а не «Очередности») — не скрыты, не уходят в конец ──
var queueCuts = [
    { id: 'done-prev', slitterId: 's1', planDate: '2026-06-10 08:00:00', status: 'Завершена', startedAt: '2026-06-10 08:00:00' },
    { id: 'wait-today', slitterId: 's1', planDate: '2026-06-11 08:00:00', status: 'Ожидает', startedAt: '' },
    { id: 'run-today', slitterId: 's1', planDate: '2026-06-11 09:00:00', status: 'В работе', startedAt: '2026-06-11 09:00:00' },
    { id: 'done-today', slitterId: 's1', planDate: '2026-06-11 07:00:00', status: 'Завершена', startedAt: '2026-06-11 07:00:00' },
    { id: 'other-slitter', slitterId: 's2', planDate: '2026-06-11 08:00:00', status: 'Ожидает', startedAt: '' }
];
var q3646 = core.prepareCutQueue(queueCuts, { slitterId: 's1', date: '2026-06-11' });
assertEqual(q3646.cuts.map(function(c) { return c.id; }), ['done-today', 'wait-today', 'run-today'],
    'prepareCutQueue #3646: фильтр по станку/дате; завершённая (planStart 07:00) остаётся на своём месте, не в конце и не скрыта');
assertEqual(q3646.firstOpenCutId, 'wait-today',
    'prepareCutQueue: первая открытая = первая НЕ завершённая по planStart (завершённую пропускаем)');

// ── открытая смена: последняя отметка пользователя за день должна быть началом, не концом ──
assertEqual(core.hasOpenShift([
    { when: '2026-06-11 08:00:00', type: 'Начало смены', userId: '701' },
    { when: '2026-06-11 10:00:00', type: 'Обед', userId: '701' }
], '701', '2026-06-11'), true, 'hasOpenShift true after user opened shift today');
assertEqual(core.hasOpenShift([
    { when: '2026-06-11 08:00:00', type: 'Начало смены', userId: '701' },
    { when: '2026-06-11 16:30:00', type: 'Конец смены', userId: '701' }
], '701', '2026-06-11'), false, 'hasOpenShift false after user closed shift today');
assertEqual(core.hasOpenShift([
    { when: '2026-06-11 08:00:00', type: 'Начало смены', userId: '702' }
], '701', '2026-06-11'), false, 'hasOpenShift ignores another operator');

// ── #3522: смена отдельно для каждого станка (станок — в «Примечаниях» события) ──
assertEqual(core.shiftEventSlitterLabel({ notes: 'Станок 1 · 2026-06-11' }), 'Станок 1',
    'shiftEventSlitterLabel: первый сегмент до « · »');
assertEqual(core.shiftEventSlitterLabel({ notes: 'Станок 1' }), 'Станок 1',
    'shiftEventSlitterLabel: только метка без даты');
assertEqual(core.shiftEventSlitterLabel({ notes: '' }), '', 'shiftEventSlitterLabel: пусто → пусто');
var twoMachineEvents = [
    { when: '2026-06-11 08:00:00', type: 'Начало смены', userId: '701', notes: 'Станок 1 · 2026-06-11' },
    { when: '2026-06-11 09:00:00', type: 'Начало смены', userId: '701', notes: 'Станок 2 · 2026-06-11' },
    { when: '2026-06-11 16:30:00', type: 'Конец смены',  userId: '701', notes: 'Станок 2 · 2026-06-11' }
];
assertEqual(core.hasOpenShift(twoMachineEvents, '701', '2026-06-11', 'Станок 1'), true,
    'hasOpenShift: на «Станок 1» смена открыта (свой станок)');
assertEqual(core.hasOpenShift(twoMachineEvents, '701', '2026-06-11', 'Станок 2'), false,
    'hasOpenShift: на «Станок 2» смена закрыта (своё «Конец смены»), хотя «Станок 1» открыт');
assertEqual(core.hasOpenShift(twoMachineEvents, '701', '2026-06-11', 'Станок 3'), false,
    'hasOpenShift: на «Станок 3» смены нет (нет событий этого станка)');
assertEqual(core.hasOpenShift(twoMachineEvents, '701', '2026-06-11'), false,
    'hasOpenShift: без станка — глобально последнее событие «Конец смены» → закрыта (а per-станок «Станок 1» открыт)');

// ── партии сырья: FIFO, только В работе, остатка хватает минимум на один проход ──
var rawBatches = [
    { id: 'new', date: '2026-06-05', remainderM: 950, materialId: 'm1', active: '1', barcode: 'NEW' },
    { id: 'old', date: '2026-06-01', remainderM: 700, materialId: 'm1', active: '1', barcode: 'OLD' },
    { id: 'short', date: '2026-05-20', remainderM: 399, materialId: 'm1', active: '1', barcode: 'SHORT' },
    { id: 'inactive', date: '2026-05-01', remainderM: 1200, materialId: 'm1', active: '0', barcode: 'OFF' },
    { id: 'wrong-material', date: '2026-04-01', remainderM: 2000, materialId: 'm2', active: '1', barcode: 'M2' }
];
var cutForCoverage = { materialId: 'm1', runLength: 400, plannedRuns: 4 };
assertEqual(core.availableBatchesForCut(rawBatches, cutForCoverage).map(function(b) { return b.id; }),
    ['old', 'new'], 'availableBatchesForCut keeps active matching batches with at least one pass, FIFO');
assertEqual(core.batchCoverage(rawBatches, ['old', 'new'], cutForCoverage), {
    runLength: 400,
    neededRuns: 4,
    neededMeters: 1600,
    coveredRuns: 3,
    coveredMeters: 1200,
    complete: false,
    batches: [
        { id: 'old', passes: 1, meters: 400 },
        { id: 'new', passes: 2, meters: 800 }
    ]
}, 'batchCoverage counts whole passes and sums selected batches');

// ── #3459/#4321: погонаж вычисляемый (read-only) = счётчик нач. − счётчик кон. ──
assertEqual(core.meterageFromCounters(1850, 1000), 850, '#4321 meterage = start − end');
assertEqual(core.meterageFromCounters(500, 500), 0, '#3459 нулевой погонаж при равных счётчиках');
assertEqual(core.meterageFromCounters('', '1500'), 0, '#4321 пустой счётчик нач. → 0 (пусто = 0, счёт идёт вниз)');

// ── #3459: блокировка последующих резок в «Ожидает» — первая открытая доступна ──
var blockedCuts = [
    { id: 'c1', slitterId: 's1', planDate: '2026-06-11', status: 'Ожидает', sequence: 1, startedAt: '' },
    { id: 'c2', slitterId: 's1', planDate: '2026-06-11', status: 'Ожидает', sequence: 2, startedAt: '' },
    { id: 'c3', slitterId: 's1', planDate: '2026-06-11', status: 'Ожидает', sequence: 3, startedAt: '' }
];
var blockedQueue = core.prepareCutQueue(blockedCuts, { slitterId: 's1', date: '2026-06-11' });
assertEqual(blockedQueue.firstOpenCutId, 'c1', '#3459 only first waiting cut is firstOpenCutId');
assertEqual(blockedQueue.cuts.length, 3, '#3459 all three waiting cuts are in the queue (UI disables c2, c3)');

// ── #3646: cutQueueTime — вторая строка карточки (начало–окончание). Время форматирует
// formatClock (штамп → ЧЧ:ММ); сверяем композицию диапазона TZ-независимо. ──
var t808 = String(Math.floor(Date.UTC(2026, 5, 11, 8, 8, 0) / 1000));
var t855 = String(Math.floor(Date.UTC(2026, 5, 11, 8, 55, 0) / 1000));
assertEqual(core.cutQueueTime({ startedAt: t808, finishedAt: t855 }),
    core.formatClock(t808) + ' – ' + core.formatClock(t855),
    'cutQueueTime #3646: завершённая → «начало – окончание»');
assertEqual(core.cutQueueTime({ startedAt: t808, finishedAt: '' }),
    core.formatClock(t808) + ' – …',
    'cutQueueTime #3646: начата, не завершена → «начало – …»');
assertEqual(core.cutQueueTime({ startedAt: '', planDate: t808 }),
    core.formatClock(t808),
    'cutQueueTime #3646: не начата → плановый старт (planDate)');
assertEqual(core.cutQueueTime({ startedAt: '', planDate: '' }),
    '', 'cutQueueTime #3646: нет времён → пусто');

// ── #3459: verify new EVENT_TYPES include Пропуск and Отмена ──
assertEqual(core.EVENT_TYPES.indexOf('Пропуск') >= 0, true, '#3646 EVENT_TYPES includes Пропуск');

// ── #3459: verify STATUSES is now 3-element chain ──
assertEqual(core.STATUSES.length, 3, '#3459 STATUSES has 3 elements');
assertEqual(core.STATUSES[0], 'Ожидает', '#3459 STATUSES[0] = Ожидает');
assertEqual(core.STATUSES[1], 'В работе', '#3459 STATUSES[1] = В работе');
assertEqual(core.STATUSES[2], 'Завершена', '#3459 STATUSES[2] = Завершена');

// ─────────────────────── #3460 ───────────────────────

// ── isTimestampSeconds: распознаём unix-секунды (а не любые числа) ──
var sampleTs = Math.floor(new Date(2026, 5, 18, 14, 30, 0).getTime() / 1000); // локальный TZ
assertEqual(core.isTimestampSeconds(sampleTs), true, 'isTimestampSeconds: валидный штамп 2026 → true');
assertEqual(core.isTimestampSeconds('1781758800'), true, 'isTimestampSeconds: пример из issue → true');
assertEqual(core.isTimestampSeconds('42'), false, 'isTimestampSeconds: маленькое число → false');
assertEqual(core.isTimestampSeconds('12,5'), false, 'isTimestampSeconds: не целое → false');
assertEqual(core.isTimestampSeconds(''), false, 'isTimestampSeconds: пусто → false');
assertEqual(core.isTimestampSeconds('Резка'), false, 'isTimestampSeconds: текст → false');

// ── formatClock: штамп → ЧЧ:ММ (локальное время, как и конструкция) ──
assertEqual(core.formatClock(sampleTs), '14:30', 'formatClock: штамп → 14:30');
assertEqual(core.formatClock('Резка'), 'Резка', 'formatClock: не штамп → как есть');
assertEqual(core.formatClock(''), '', 'formatClock: пусто → пусто');

// ── formatDate: штамп → ДД.ММ.ГГГГ ──
assertEqual(core.formatDate(sampleTs), '18.06.2026', 'formatDate: штамп → 18.06.2026');
assertEqual(core.formatDate('—'), '—', 'formatDate: не штамп → как есть');

// ── cutTitle: «Резка ЧЧ:ММ» из штампа, иначе «Резка №…» ──
assertEqual(core.cutTitle(sampleTs), 'Резка 14:30', 'cutTitle: штамп → Резка 14:30');
assertEqual(core.cutTitle('7'), 'Резка №7', 'cutTitle: обычный номер → Резка №7');
assertEqual(core.cutTitle(''), 'Резка', 'cutTitle: пусто → Резка');

// ── humanizeLabel: штамп → дата, прочее → как есть ──
assertEqual(core.humanizeLabel(sampleTs), '18.06.2026', 'humanizeLabel: штамп → дата');
assertEqual(core.humanizeLabel('Партия 17'), 'Партия 17', 'humanizeLabel: текст → как есть');

// ── isForeignWarehouse: склад «Атех» — чужой (другой склад) ──
assertEqual(core.isForeignWarehouse('Атех'), true, 'isForeignWarehouse: Атех → true');
assertEqual(core.isForeignWarehouse('Склад Атех №2'), true, 'isForeignWarehouse: вхождение подстроки → true');
assertEqual(core.isForeignWarehouse('атех'), true, 'isForeignWarehouse: регистронезависимо');
assertEqual(core.isForeignWarehouse('Основной'), false, 'isForeignWarehouse: другой склад → false');
assertEqual(core.isForeignWarehouse(''), false, 'isForeignWarehouse: пусто → false');

// ── rowsToActiveBatches: разбор строк отчёта material_batches (JSON_KV) ──
var reportRows = [
    { batch_id: '10', batch_no: 'A-100', batch_material: 'ПЭТ 12', batch_remainder_m: '700', batch_warehouse: 'Основной' },
    { batch_id: '11', batch_no: 'A-101', batch_material: 'ПЭТ 12', batch_remainder_m: '950', batch_warehouse: 'Атех' }
];
var parsedBatches = core.rowsToActiveBatches(reportRows);
assertEqual(parsedBatches.map(function(b) { return b.id; }), ['10', '11'], 'rowsToActiveBatches: id из batch_id');
assertEqual(parsedBatches.map(function(b) { return b.label; }), ['A-100', 'A-101'], 'rowsToActiveBatches: label из batch_no');
assertEqual(parsedBatches.map(function(b) { return b.remainderM; }), [700, 950], 'rowsToActiveBatches: остаток,м числом');
assertEqual(parsedBatches.map(function(b) { return b.materialLabel; }), ['ПЭТ 12', 'ПЭТ 12'], 'rowsToActiveBatches: вид сырья');
assertEqual(parsedBatches.map(function(b) { return b.foreign; }), [false, true], 'rowsToActiveBatches: склад Атех → foreign');

// ── availableBatchesForCut: партии по названию вида сырья (id может отсутствовать) ──
var cutByLabel = { materialLabel: 'ПЭТ 12', runLength: 400, plannedRuns: 3 };
assertEqual(core.availableBatchesForCut(parsedBatches, cutByLabel).map(function(b) { return b.id; }),
    ['10', '11'], 'availableBatchesForCut: сопоставление по названию вида сырья');

// ── batchMatchesCut: фолбэк на название, когда нет id ──
assertEqual(core.batchMatchesCut({ materialLabel: 'ПЭТ 12' }, { materialLabel: 'ПЭТ 12' }), true,
    'batchMatchesCut: совпадение по названию');
assertEqual(core.batchMatchesCut({ materialLabel: 'БОПП 20' }, { materialLabel: 'ПЭТ 12' }), false,
    'batchMatchesCut: разные названия → false');
assertEqual(core.batchMatchesCut({ materialId: 'm1', materialLabel: 'ПЭТ 12' }, { materialId: 'm1' }), true,
    'batchMatchesCut: совпадение по id в приоритете');

// ── раскладка ножей: ножи за проход, занятая ширина, проценты, остаток ──
var strips = [
    { width: '300', qty: '2', purpose: 'заказ' },
    { width: '200', qty: '1', purpose: 'склад' }
];
assertEqual(core.totalKnives(strips), 3, 'totalKnives: Σ кол-во полос = 3 (ножа за проход)');
assertEqual(core.usedWidth(strips), 800, 'usedWidth: 300×2 + 200×1 = 800');
assertEqual(core.purposeKind('заказ'), 'order', 'purposeKind: заказ → order');
assertEqual(core.purposeKind('склад'), 'stock', 'purposeKind: склад → stock');
assertEqual(core.purposeKind('отход'), 'waste', 'purposeKind: отход → waste');
assertEqual(core.purposeKind('прочее'), 'other', 'purposeKind: иное → other');
var layout = core.computeLayout(1000, strips, null);
assertEqual(layout.usedWidth, 800, 'computeLayout: занятая ширина 800');
assertEqual(layout.remainder, 200, 'computeLayout: остаток входа 1000−800 = 200');
assertEqual(layout.overflow, false, 'computeLayout: без переполнения');
assertEqual(layout.segments.length, 3, 'computeLayout: 3 сегмента (по одному на нож)');
assertEqual(core.widthPercent(300, layout), 30, 'widthPercent: 300 из 1000 → 30%');
var overflowLayout = core.computeLayout(700, strips, null);
assertEqual(overflowLayout.overflow, true, 'computeLayout: полосы шире входа → overflow');

// ── #3557: статус резки из последнего события смены + атрибуты ──
assertEqual(core.deriveCutStatus('', {}), 'Ожидает', 'deriveCutStatus: нет событий → Ожидает');
assertEqual(core.deriveCutStatus('Начало резки', {}), 'В работе', 'deriveCutStatus: Начало резки → В работе');
assertEqual(core.deriveCutStatus('Наладка', { inWork: '1' }), 'Наладка', 'deriveCutStatus: Наладка → Наладка');
assertEqual(core.deriveCutStatus('Перерыв', { inWork: '1' }), 'Перерыв', 'deriveCutStatus: Перерыв → Перерыв');
assertEqual(core.deriveCutStatus('Возобновить', { inWork: '1' }), 'В работе', 'deriveCutStatus: Возобновить → В работе');
assertEqual(core.deriveCutStatus('Завершить', {}), 'Завершена', 'deriveCutStatus: Завершить → Завершена');
assertEqual(core.deriveCutStatus('Прекратить', {}), 'Завершена', 'deriveCutStatus: Прекратить → Завершена');
// #3646: «Пропуск» → терминальный статус «Пропущена» (приоритет события над атрибутами).
assertEqual(core.deriveCutStatus('Пропуск', {}), 'Пропущена', 'deriveCutStatus #3646: Пропуск → Пропущена');
assertEqual(core.deriveCutStatus('Пропуск', { finishedAt: '1782000000' }), 'Пропущена', 'deriveCutStatus #3646: Пропуск (с атрибутом Закончено) всё равно Пропущена');
assertEqual(core.isDone('Пропущена'), true, 'isDone #3646: Пропущена — терминальный (вышло из активной очереди)');
// Флаг «В работе» снят только завершением: Наладка/Перерыв его не трогают (опора на атрибут)
assertEqual(core.deriveCutStatus('', { inWork: '1' }), 'В работе', 'deriveCutStatus: атрибут В работе=1 без события → В работе');
assertEqual(core.deriveCutStatus('', { finishedAt: '1782000000' }), 'Завершена', 'deriveCutStatus: атрибут Закончено → Завершена');
assertEqual(core.deriveCutStatus('', { startedAt: '1782000000' }), 'В работе', 'deriveCutStatus: атрибут Начато → В работе');

// ── #3557: формат времени события и длительности ──
// (строковый ввод — без зависимости от таймзоны хоста)
assertEqual(core.formatEventWhen('2026-05-03 14:30:05'), '03.05.2026 14:30', 'formatEventWhen: строка datetime → дата+время');
assertEqual(core.eventWhenSeconds('1777756058'), 1777756058, 'eventWhenSeconds: таймштамп → секунды');
assertEqual(core.formatDuration(0), 'меньше минуты', 'formatDuration: 0 → меньше минуты');
assertEqual(core.formatDuration(45 * 60), '45 мин', 'formatDuration: 45 мин');
assertEqual(core.formatDuration(125 * 60), '2 ч 5 мин', 'formatDuration: 2 ч 5 мин');
assertEqual(core.formatDuration(120 * 60), '2 ч', 'formatDuration: ровно 2 ч');
assertEqual(core.formatDuration(NaN), '', 'formatDuration: NaN → пусто');

// ── #3560: «Событие смены» пишется в корень (up=1), резка — реквизитом, не родителем ──
// Регресс: #3346 ставил up=cutId, и Integram отказывал роли Оператора в доступе к
// поддереву объекта-резки («нет доступа к реквизиту объекта 81663, 1082 … или его
// родителю»). Резка должна уходить ТОЛЬКО реквизитом «Задание в производство».
(function() {
    var Controller = require('../download/atex/js/slitter.js').Controller;
    var eventMeta = { id: '1082', reqs: [
        { id: '16419', val: 'Тип события' },
        { id: '16415', val: 'Задание в производство' },
        { id: '1196', val: 'Пользователь' },
        { id: '1199', val: 'Значение' },
        { id: '1198', val: 'Примечания' }
    ] };
    var inst = Object.create(Controller.prototype);
    inst.meta = { event: eventMeta };
    inst.userId = '456';
    inst.eventDateTime = function() { return '2026-06-09 23:21:05'; };
    var captured = null;
    inst.post = function(path, params) { captured = { path: path, params: params }; return Promise.resolve({}); };
    inst.createEvent({ type: 'Запуск резки' }, '81663');
    assertEqual(/\?JSON&up=1$/.test(captured.path), true,
        '#3560 createEvent: up=1 (корень), резка не родитель');
    assertEqual(/up=81663/.test(captured.path), false,
        '#3560 createEvent: cutId не уходит в up (иначе отказ доступа роли Оператора)');
    assertEqual(captured.params['t16415'], '81663',
        '#3560 createEvent: резка передаётся реквизитом «Задание в производство»');
    assertEqual(captured.path.indexOf('_m_new/1082') >= 0, true,
        '#3560 createEvent: цель — таблица «Событие смены» (1082)');
})();

// ── #3621: donePassCount — число выполненных проходов = число событий «Резка» этой резки ──
// Заголовок «Резка N из M»: N = donePassCount + 1 (текущий проход), в пределах [1, M].
(function() {
    var Controller = require('../download/atex/js/slitter.js').Controller;
    var inst = Object.create(Controller.prototype);
    inst.shiftEvents = [
        { type: 'Начало смены', cutId: null },
        { type: 'Начало резки', cutId: '81663' },
        { type: 'Резка', cutId: '81663', value: '1' },
        { type: 'Резка', cutId: '81663', value: '2' },
        { type: 'Резка', cutId: '99999', value: '1' }, // другая резка — не считаем
        { type: 'Наладка', cutId: '81663' }
    ];
    assertEqual(inst.donePassCount({ id: '81663' }), 2,
        '#3621 donePassCount: считает только события «Резка» этой резки');
    assertEqual(inst.donePassCount({ id: '99999' }), 1,
        '#3621 donePassCount: фильтр по cutId');
    assertEqual(inst.donePassCount({ id: '00000' }), 0,
        '#3621 donePassCount: нет событий «Резка» → 0');
    assertEqual(inst.donePassCount(null), 0,
        '#3621 donePassCount: без резки → 0');
    var empty = Object.create(Controller.prototype);
    assertEqual(empty.donePassCount({ id: '81663' }), 0,
        '#3621 donePassCount: shiftEvents не загружены → 0');
})();

// ── #3609: бесшовное продолжение смены ──
assertEqual(core.knifeLayoutKey([{width:55,qty:10},{width:32.5,qty:10}]),
            core.knifeLayoutKey([{width:32.5,qty:10},{width:55,qty:10}]),
            'knifeLayoutKey: порядок полос не влияет');
assertEqual(core.knifeLayoutKey([{width:55,qty:10}]) === core.knifeLayoutKey([{width:55,qty:9}]), false,
            'knifeLayoutKey: разное кол-во → разный ключ');
assertEqual(core.knifeLayoutKey([{width:0,qty:0},{width:110,qty:8}]), '110x8', 'knifeLayoutKey: 0×0 отброшены');
assertEqual(core.knifeLayoutKey([]), '', 'knifeLayoutKey: нет полос → пусто');
var scCuts = [
    { id:'A', slitterId:'1', planDate:'2026-05-29', sequence:'1' },
    { id:'B', slitterId:'1', planDate:'2026-05-29', sequence:'2' },   // последняя 29-го на ст.1
    { id:'C', slitterId:'1', planDate:'2026-05-30', sequence:'1' },   // первая 30-го на ст.1
    { id:'D', slitterId:'1', planDate:'2026-05-30', sequence:'2' },
    { id:'E', slitterId:'2', planDate:'2026-05-30', sequence:'1' }    // другой станок — игнор
];
var scB = core.shiftContinuation(scCuts, scCuts[1]);
assertEqual(scB.isLast, true, 'shiftContinuation: B — последняя в смене 29-го (ст.1)');
assertEqual(scB.nextCut && scB.nextCut.id, 'C', 'shiftContinuation: первая 30-го на ст.1 = C (не E, не D)');
assertEqual(core.shiftContinuation(scCuts, scCuts[0]).isLast, false, 'shiftContinuation: A не последняя в смене');
var scD = core.shiftContinuation(scCuts, scCuts[3]);
assertEqual(scD.isLast, true, 'shiftContinuation: D — последняя 30-го');
assertEqual(scD.nextCut, null, 'shiftContinuation: нет следующего дня → nextCut null');

// ── #3674: парсеры защищённых отчётов слиттера (report/ → те же формы, что object/) ──
// rowsToSlitters: report/slitters_list → { id, label }
var sl = core.rowsToSlitters([
    { slitter_id: '1277', slitter_name: 'Станок 1' },
    { slitter_id: '1277', slitter_name: 'Станок 1' },   // дубль (N:M стоп-лист) → схлопнуть
    { slitter_id: '1279', slitter_name: '' },           // без имени → «Слиттер #id»
    { slitter_id: '', slitter_name: 'мусор' }            // без id → отброшен
]);
assertEqual(sl, [
    { id: '1277', label: 'Станок 1' },
    { id: '1279', label: 'Слиттер #1279' }
], 'rowsToSlitters: дедуп по id / фолбэк имени / без id отброшен');
assertEqual(core.rowsToSlitters([]), [], 'rowsToSlitters: пусто → []');

// rowsToCuts: report/slitter_cuts → дескриптор резки (DATETIME — unix-штамп секунд)
var cuts3674 = core.rowsToCuts([{
    cut_id: '90158', cut_plan_date: '1780203600', cut_slitter_id: '1282', cut_slitter: 'Станок 3',
    cut_batch_id: '777', cut_batch: '1781038800', cut_sequence: '1', cut_planned_runs: '1',
    cut_run_length: '600.00', cut_started: '1780253146', cut_in_work: 'X', cut_finished: '',
    cut_winding: 'OUT', cut_material_id: '55', cut_material: 'MWR116L', cut_material_width: '891.00'
}]);
assertEqual(cuts3674.length, 1, 'rowsToCuts: одна строка → одна резка');
assertEqual(cuts3674[0].id, '90158', 'rowsToCuts: id ← cut_id');
assertEqual(cuts3674[0].label, core.cutTitle('1780203600'), 'rowsToCuts: label = cutTitle(plan_date)');
assertEqual(cuts3674[0].status, 'Ожидает', 'rowsToCuts: статус по умолчанию = Ожидает (доберётся из событий)');
assertEqual(cuts3674[0].slitterId, '1282', 'rowsToCuts: slitterId ← cut_slitter_id');
assertEqual(cuts3674[0].batchId, '777', 'rowsToCuts: batchId ← cut_batch_id');
assertEqual(cuts3674[0].planDate, '1780203600', 'rowsToCuts: planDate ← cut_plan_date (штамп)');
assertEqual(cuts3674[0].runLength, '600.00', 'rowsToCuts: runLength ← cut_run_length');
assertEqual(cuts3674[0].winding, 'OUT', 'rowsToCuts: winding ← cut_winding');
assertEqual(cuts3674[0].materialId, '55', 'rowsToCuts: materialId ← cut_material_id');
assertEqual(cuts3674[0].material, 'MWR116L', 'rowsToCuts: material ← cut_material');
assertEqual(cuts3674[0].materialWidthMm, 891, 'rowsToCuts: materialWidthMm ← cut_material_width (число)');
assertEqual(core.rowsToCuts([{ cut_plan_date: '1', cut_slitter_id: '1' }]), [], 'rowsToCuts: без cut_id → отброшено');

// rowsToShiftEvents: report/slitter_shift_events → события (новые сверху), cutId ← event_cut_id
var ev3674 = core.rowsToShiftEvents([
    { event_id: '1', event_when: '1780057598', event_type: 'Начало смены', event_cut_id: '', event_user_id: '456', event_user: 'ateh', event_value: '', event_notes: 'Станок 1' },
    { event_id: '2', event_when: '1780058141', event_type: 'Начало резки', event_cut_id: '89694', event_user_id: '456', event_user: 'ateh', event_value: '', event_notes: '' }
]);
assertEqual(ev3674.map(function(e){ return e.id; }), ['2', '1'], 'rowsToShiftEvents: сортировка по when убыв. (новые сверху)');
assertEqual(ev3674[0].cutId, '89694', 'rowsToShiftEvents: cutId ← event_cut_id');
assertEqual(ev3674[1].cutId, null, 'rowsToShiftEvents: пустой event_cut_id → null');
assertEqual(ev3674[0].type, 'Начало резки', 'rowsToShiftEvents: type ← event_type');
assertEqual(ev3674[0].userId, '456', 'rowsToShiftEvents: userId ← event_user_id');
assertEqual(core.deriveCutStatus(ev3674[0].type, {}), 'В работе', 'rowsToShiftEvents+deriveCutStatus: «Начало резки» → В работе');

// ── #3861: width_mm в отчёте, взаимопересчёт остатка м↔м², расход, allCutsDone ──

// rowsToActiveBatches: width_mm → widthMm (номинальная ширина рулона из отчёта)
var batchesW = core.rowsToActiveBatches([
    { batch_id: '20', batch_no: 'B-1', batch_material: 'ПЭТ 12', batch_remainder_m: '500', width_mm: '1000', batch_warehouse: 'Основной' }
]);
assertEqual(batchesW[0].widthMm, 1000, '#3861 rowsToActiveBatches: widthMm ← width_mm');
assertEqual(parsedBatches[0].widthMm, 0, '#3861 rowsToActiveBatches: без width_mm → 0');

// metersFromArea / areaFromMeters: взаимопересчёт по ширине; ширина 0 → 0
assertEqual(core.areaFromMeters(700, 500), 350, '#3861 areaFromMeters: 700 м × 500 мм /1000 = 350 м²');
assertEqual(core.metersFromArea(350, 500), 700, '#3861 metersFromArea: 350 м² ×1000/500 = 700 м');
assertEqual(core.areaFromMeters(700, 0), 0, '#3861 areaFromMeters: ширина 0 → 0');
assertEqual(core.metersFromArea(350, 0), 0, '#3861 metersFromArea: ширина 0 → 0');

// fillBatchRemainderM: остаток м ↔ м² досчитывается по ширине (отчёт отдал одно из двух)
(function() {
    var Controller = require('../download/atex/js/slitter.js').Controller;
    var inst = Object.create(Controller.prototype);
    inst.materialWidths = {};
    inst.batches = [
        { id: 'a', materialId: 'm', remainder: 350, remainderM: 0, widthMm: 500 }, // есть м², нет м
        { id: 'b', materialId: 'm', remainder: 0, remainderM: 700, widthMm: 500 }  // есть м, нет м²
    ];
    inst.fillBatchRemainderM();
    assertEqual(inst.batches[0].remainderM, 700, '#3861 fillBatchRemainderM: метры из м² по ширине');
    assertEqual(inst.batches[1].remainder, 350, '#3861 fillBatchRemainderM: м² из метров по ширине');
})();

// allCutsDone: все резки выполнены (нет открытой) при открытой смене
(function() {
    var Controller = require('../download/atex/js/slitter.js').Controller;
    var inst = Object.create(Controller.prototype);
    inst.isShiftOpen = function() { return true; };
    inst.currentQueue = function() { return { cuts: [{}], firstOpenCutId: null }; };
    assertEqual(inst.allCutsDone(), true, '#3861 allCutsDone: смена открыта, есть резки, нет открытой → true');
    inst.currentQueue = function() { return { cuts: [{}], firstOpenCutId: '5' }; };
    assertEqual(inst.allCutsDone(), false, '#3861 allCutsDone: есть открытая резка → false');
    inst.currentQueue = function() { return { cuts: [], firstOpenCutId: null }; };
    assertEqual(inst.allCutsDone(), false, '#3861 allCutsDone: нет резок → false');
    inst.isShiftOpen = function() { return false; };
    inst.currentQueue = function() { return { cuts: [{}], firstOpenCutId: null }; };
    assertEqual(inst.allCutsDone(), false, '#3861 allCutsDone: смена закрыта → false');
})();

// applyBatchConsumption: списать расход (м), пересчитать м² по ширине, finishMode → снять «В работе»
(function() {
    var Controller = require('../download/atex/js/slitter.js').Controller;
    var inst = Object.create(Controller.prototype);
    var batch = { id: '77', materialId: 'm', remainderM: 1000, remainder: 500, widthMm: 500, active: '1' };
    inst.findBatch = function(id) { return String(id) === '77' ? batch : null; };
    inst.materialWidths = {};
    inst.meta = { batch: { id: '106', reqs: [
        { id: '1148', val: 'Остаток, м' },
        { id: '1050', val: 'Остаток, м²' },
        { id: '1160', val: 'В работе' }
    ] } };
    var captured = null;
    inst.post = function(path, params) { captured = { path: path, params: params }; return Promise.resolve({}); };
    inst.applyBatchConsumption({ batchId: '77' }, 200, false);
    assertEqual(captured.path, '_m_set/77?JSON', '#3861 applyBatchConsumption: пишет в «Партия сырья»');
    assertEqual(captured.params['t1148'], 800, '#3861 applyBatchConsumption: Остаток,м = 1000−200 (расход)');
    assertEqual(captured.params['t1050'], 400, '#3861 applyBatchConsumption: Остаток,м² = 800×500/1000 (по ширине)');
    assertEqual('t1160' in captured.params, false, '#3861 applyBatchConsumption: без finishMode «В работе» не трогаем');
    inst.applyBatchConsumption({ batchId: '77' }, 0, true);
    assertEqual(captured.params['t1160'], '', '#3861 applyBatchConsumption: finishMode → «В работе» у партии снят');
})();

// markPassDone: ✓ Готово пишет «Погонаж факт» и «Расход сырья» (погонные метры) в резку
(function() {
    var Controller = require('../download/atex/js/slitter.js').Controller;
    var inst = Object.create(Controller.prototype);
    inst.busy = false;
    inst.currentCut = { id: '90', batchId: '77', status: 'Ожидает', meterage: '0', counterStart: '1000', runLength: '600', plannedRuns: '3' };
    inst.isCutLocked = function() { return false; };
    inst.eventDateTime = function() { return '2026-06-29 10:00:00'; };
    inst.meta = { cut: { id: '110', reqs: [
        { id: '1104', val: 'Погонаж факт, м' },
        { id: '1102', val: 'Счётчик кон.' },
        { id: '1110', val: 'Расход сырья' },
        { id: '1101', val: 'Начато' },
        { id: '1162', val: 'В работе' }
    ] } };
    var posts = [];
    inst.post = function(path, params) { posts.push({ path: path, params: params }); return Promise.resolve({}); };
    inst.createEvent = function() { return Promise.resolve({}); };
    inst.applyBatchConsumption = function() { return Promise.resolve(null); };
    inst.loadEvents = function() { return Promise.resolve(); };
    inst.loadCuts = function() { return Promise.resolve(); };
    inst.applyEventStatuses = function() {};
    inst.setBusy = function(v) { this.busy = v; };
    inst.notify = function() {};
    inst.render = function() {};
    inst.markPassDone(false); // один проход: target=1, meterage=1×600
    assertEqual(posts[0].params['t1104'], 600, '#3861 markPassDone: Погонаж факт = 1×600');
    assertEqual(posts[0].params['t1110'], 600, '#3861 markPassDone: «Расход сырья» (погонные метры) = погонаж');
})();

console.log('\n' + passed + ' assertions passed');
