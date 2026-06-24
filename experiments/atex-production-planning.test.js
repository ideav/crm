// Unit tests for the «Планирование производства» core (ideav/crm#2913).
// Verifies the pure helpers the workspace relies on:
//   • parseRef         — разбор значения-ссылки «id:Подпись»;
//   • reqIdByName      — поиск id реквизита в метаданных по имени;
//   • columnIndex      — индекс колонки реквизита в строке JSON_OBJ;
//   • mapCutRecord     — запись «Производственной резки» → плоский объект;
//   • groupBySlitter   — группировка очереди резок по слиттерам;
//   • filterCuts       — фильтр очереди по слиттеру/статусу;
//   • buildFields      — сборка полей t{reqId}, пропуск пустых значений.
//
// Run with: node experiments/atex-production-planning.test.js

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

// ── parseRef ──
assertEqual(planning.parseRef('101:Слиттер №1'), { id: '101', label: 'Слиттер №1' }, 'parseRef splits id:label');
assertEqual(planning.parseRef('просто текст'), { id: null, label: 'просто текст' }, 'parseRef without id keeps text');
assertEqual(planning.parseRef(null), { id: null, label: '' }, 'parseRef null → empty');

// ── Метаданные «Производственной резки» (id/реквизиты как в atex_metadata.json) ──
var cutMeta = {
    id: '110', val: 'Производственная резка', reqs: [
        { id: '1090', val: 'Слиттер' },
        { id: '1092', val: 'Очередность' },
        { id: '1094', val: 'Партия сырья' },
        { id: '1096', val: 'Дата план' },
        { id: '1098', val: 'Статус' },
        { id: '1108', val: 'Примечания' }
    ]
};

// ── reqIdByName ──
assertEqual(planning.reqIdByName(cutMeta, 'Слиттер'), '1090', 'reqIdByName finds id by name');
assertEqual(planning.reqIdByName(cutMeta, 'статус'), '1098', 'reqIdByName is case-insensitive');
assertEqual(planning.reqIdByName(cutMeta, 'Нет такого'), null, 'reqIdByName missing → null');

// ── columnIndex (0 = главное значение/Номер, далее реквизиты по порядку) ──
assertEqual(planning.columnIndex(cutMeta, 'Слиттер'), 1, 'columnIndex: first req at index 1');
assertEqual(planning.columnIndex(cutMeta, 'Статус'), 5, 'columnIndex: status at index 5');

// ── mapCutRecord ──
var rec = { i: 501, r: ['7', '101:Слиттер №1', '', '106:Партия A', '2026-06-01', 'В очереди', 'комм.'] };
assertEqual(planning.mapCutRecord(rec, cutMeta), {
    id: '501',
    number: '7',
    slitter: { id: '101', label: 'Слиттер №1' },
    materialBatch: { id: '106', label: 'Партия A' },
    planDate: '2026-06-01',
    status: 'В очереди',
    sequence: null
}, 'mapCutRecord flattens record using metadata');

// ── groupBySlitter + filterCuts ──
var cuts = [
    { id: '1', number: '1', slitter: { id: '101', label: 'Слиттер №1' }, status: 'В очереди' },
    { id: '2', number: '2', slitter: { id: '102', label: 'Слиттер №2' }, status: 'В работе' },
    { id: '3', number: '3', slitter: { id: '101', label: 'Слиттер №1' }, status: 'В работе' },
    { id: '4', number: '4', slitter: { id: null, label: '' }, status: 'В очереди' }
];

var groups = planning.groupBySlitter(cuts);
assertEqual(groups.map(function(g) { return g.slitter.label; }),
    ['Слиттер №1', 'Слиттер №2', 'Без станка'],
    'groupBySlitter orders by label, «без станка» last');
assertEqual(groups[0].cuts.length, 2, 'groupBySlitter groups two cuts under Слиттер №1');

// фильтр по слиттеру
assertEqual(planning.filterCuts(cuts, { slitter: '101' }).map(function(c) { return c.id; }),
    ['1', '3'], 'filterCuts by slitter id');
// фильтр по статусу
assertEqual(planning.filterCuts(cuts, { status: 'В работе' }).map(function(c) { return c.id; }),
    ['2', '3'], 'filterCuts by status');
// комбинированный фильтр
assertEqual(planning.filterCuts(cuts, { slitter: '101', status: 'В работе' }).map(function(c) { return c.id; }),
    ['3'], 'filterCuts by slitter + status');
// пустой фильтр — все
assertEqual(planning.filterCuts(cuts, {}).length, 4, 'empty filter returns all cuts');

// ── #3411: быстрый поиск по очереди (cutMatchesQuery / cutSearchHaystack) ──
var searchCut = { id: '7', number: '12', materialName: 'BOPP 30 прозрачный', materialId: '500', winding: 'IN', status: 'В работе' };
// пустой запрос совпадает со всем
assertEqual(planning.cutMatchesQuery(searchCut, ''), true, 'cutMatchesQuery: empty query matches everything');
assertEqual(planning.cutMatchesQuery(searchCut, '   '), true, 'cutMatchesQuery: whitespace query matches everything');
// поиск по названию сырья, регистронезависимо
assertEqual(planning.cutMatchesQuery(searchCut, 'bopp'), true, 'cutMatchesQuery: matches material name case-insensitively');
assertEqual(planning.cutMatchesQuery(searchCut, 'ПРОЗРАЧНЫЙ'), true, 'cutMatchesQuery: matches material name (upper)');
// несовпадение
assertEqual(planning.cutMatchesQuery(searchCut, 'фольга'), false, 'cutMatchesQuery: non-matching term → false');
// поиск по нескольким словам — все должны входить
assertEqual(planning.cutMatchesQuery(searchCut, 'bopp прозрачный'), true, 'cutMatchesQuery: all words must match');
assertEqual(planning.cutMatchesQuery(searchCut, 'bopp фольга'), false, 'cutMatchesQuery: one missing word → false');
// поиск по подписям связанных позиций
assertEqual(planning.cutMatchesQuery(searchCut, '1234/5', ['1234/5 · 600мм * 1000м']), true,
    'cutMatchesQuery: matches linked position label');
assertEqual(planning.cutMatchesQuery(searchCut, '1234/5'), false,
    'cutMatchesQuery: linked-only term needs linked labels');
// haystack собирает все поля
assertEqual(/bopp 30 прозрачный/.test(planning.cutSearchHaystack(searchCut, [])), true,
    'cutSearchHaystack: includes material name lowercased');
assertEqual(/1234\/5/.test(planning.cutSearchHaystack(searchCut, ['1234/5 · 600мм'])), true,
    'cutSearchHaystack: includes linked labels');

// ── buildFields: t{reqId}, пустые значения опускаются ──
assertEqual(planning.buildFields(
    { slitter: '1090', winding: '1092', materialBatch: '1094', planDate: '1096', status: '1098', notes: '1108' },
    { slitter: '101', winding: 'IN', materialBatch: '', planDate: '2026-06-01', status: 'В очереди', notes: '' }
), { t1090: '101', t1092: 'IN', t1096: '2026-06-01', t1098: 'В очереди' },
    'buildFields prefixes t{id}, skips empty material/notes');

// null id реквизита (нет в метаданных) — поле пропускается.
assertEqual(planning.buildFields(
    { footage: '1082', cut: '1084', status: null },
    { footage: '1200', cut: '501', status: 'Зарезервировано' }
), { t1082: '1200', t1084: '501' }, 'buildFields skips fields with null reqId');

// ── Обеспечение ↔ Производственная резка: резка снова самостоятельная таблица (#3185) ──
var oldSupplyMeta = {
    id: '109', val: 'Обеспечение', reqs: [
        { id: '1082', val: 'Метраж, м' },
        { id: '1084', val: 'Производственная резка', ref: '110', ref_id: '1085' },
        { id: '1088', val: 'Статус' }
    ]
};
var newSupplyMeta = {
    id: '1077', val: 'Обеспечение', reqs: [
        { id: '1149', val: 'Метраж, м' },
        { id: '1154', val: 'Статус' },
        { id: '15015', val: 'Производственная резка', arr_id: '1078' }
    ]
};
var newCutMeta = { id: '1078', val: 'Производственная резка', reqs: [] };
assertEqual(planning.supplyCutRelation(oldSupplyMeta, cutMeta), {
    mode: 'reference',
    reqId: '1084',
    arrId: null
}, 'supplyCutRelation: old metadata uses cut reference');
assertEqual(planning.supplyCutRelation(newSupplyMeta, newCutMeta), {
    mode: 'none',
    reqId: null,
    arrId: '1078'
}, 'supplyCutRelation: child-array metadata is ignored; cuts are standalone again');
assertEqual(planning.buildSupplyFieldsForCut(oldSupplyMeta, cutMeta, {
    footage: '1200',
    cutId: '501',
    rolls: '6',
    status: 'Зарезервировано'
}), { t1082: '1200', t1084: '501', t1088: 'Зарезервировано' }, 'buildSupplyFieldsForCut: reference schema writes cut reference');
assertEqual(planning.buildSupplyFieldsForCut(newSupplyMeta, newCutMeta, {
    footage: '1200',
    cutId: '501',
    status: 'Зарезервировано'
}), { t1149: '1200', t1154: 'Зарезервировано' }, 'buildSupplyFieldsForCut: child-array metadata omits cut link');
var supplyWithRollsMeta = {
    id: '109', val: 'Обеспечение', reqs: [
        { id: '1082', val: 'Метраж, м' },
        { id: '1084', val: 'Производственная резка', ref: '110', ref_id: '1085' },
        { id: '1086', val: 'Кол-во рулонов' },
        { id: '1088', val: 'Статус' }
    ]
};
assertEqual(planning.buildSupplyFieldsForCut(supplyWithRollsMeta, cutMeta, {
    footage: '1200',
    cutId: '501',
    rolls: '6',
    status: 'Зарезервировано'
}), { t1082: '1200', t1084: '501', t1086: '6', t1088: 'Зарезервировано' }, 'buildSupplyFieldsForCut: writes roll count when metadata has it');
assertEqual(planning.layoutPositionGroups([{ id: 'p1' }, { id: 'p2' }]).map(function(g) { return g.map(function(p) { return p.id; }); }),
    [['p1', 'p2']], 'layoutPositionGroups: standalone cuts keep positions in one planning group');

// ── rowsToPlanning: плоские строки отчёта cut_planning (JSON_KV) → { cuts, supplies } ──
// LEFT JOIN: резка 10 с двумя обеспечениями = две строки; резка 20 без обеспечения.
// #3242: cut_no упразднён, «номер» = плановая дата (cut_plan_date); cut_material_batch
// упразднён (materialBatch.label = ''); отчётный batch_id — «Партия ГП», в batchId не идёт.
var reportRows = [
    { cut_id: '10', cut_slitter: 'Станок 1', cut_slitter_id: '101',
      cut_plan_date: '06.05.2026', batch_id: '5001',
      cut_status: 'В работе', supply_id: '900', supply_position_id: '700' },
    { cut_id: '10', cut_slitter: 'Станок 1', cut_slitter_id: '101',
      cut_plan_date: '06.05.2026', batch_id: '5002',
      cut_status: 'В работе', supply_id: '901', supply_position_id: '701' },
    { cut_id: '20', cut_slitter: '', cut_slitter_id: '',
      cut_plan_date: '27.05.2026',
      cut_status: 'Ожидает', supply_id: '', supply_position_id: '' }
];
var plan = planning.rowsToPlanning(reportRows);
assertEqual(plan.cuts, [
    { id: '10', number: '06.05.2026', slitter: { id: '101', label: 'Станок 1' },
      materialBatch: { id: null, label: '' },
      planDate: '06.05.2026', status: 'В работе', sequence: null, fixed: false,
      materialId: '', materialName: '', batchId: '',
      jumboRemainingM: 0, knifeCount: 0, knifeWidths: [], winding: '', rollerWidth: 0, length: 0, plannedRuns: 0, duration: 0, timing: '', storedKnifeSetupMin: '', storedMaterialWindingMin: '', isFoil: false,
      orderId: '', orderApprovalDate: '', leaders: [] },
    { id: '20', number: '27.05.2026', slitter: { id: null, label: '' },
      materialBatch: { id: null, label: '' },
      planDate: '27.05.2026', status: 'Ожидает', sequence: null, fixed: false,
      materialId: '', materialName: '', batchId: '',
      jumboRemainingM: 0, knifeCount: 0, knifeWidths: [], winding: '', rollerWidth: 0, length: 0, plannedRuns: 0, duration: 0, timing: '', storedKnifeSetupMin: '', storedMaterialWindingMin: '', isFoil: false,
      orderId: '', orderApprovalDate: '', leaders: [] }
], 'rowsToPlanning dedups cuts by cut_id, slitter без id → {id:null}, #3242 number=cut_plan_date');
// #3472: cut_leader собирается в leaders[] (различные); легаси-смешение → несколько.
var leadPlan = planning.rowsToPlanning([
    { cut_id:'31', cut_plan_date:'x', supply_id:'s1', supply_position_id:'p1', cut_leader:'Софмикс' },
    { cut_id:'31', cut_plan_date:'x', supply_id:'s2', supply_position_id:'p2', cut_leader:'Софмикс' },
    { cut_id:'32', cut_plan_date:'y', supply_id:'s3', supply_position_id:'p3', cut_leader:'Этикетка37' },
    { cut_id:'32', cut_plan_date:'y', supply_id:'s4', supply_position_id:'p4', cut_leader:'MONOCHROME' },
    { cut_id:'33', cut_plan_date:'z', supply_id:'s5', supply_position_id:'p5' }
]);
assertEqual(leadPlan.cuts.map(function(c){ return c.leaders; }),
    [['Софмикс'], ['Этикетка37','MONOCHROME'], []],
    'rowsToPlanning #3472: leaders[] — различные лидеры резки (легаси-смешение видно)');
assertEqual(plan.supplies, [
    { id: '900', positionId: '700', cutId: '10', finishedBatchId: '', orderNo: '', positionWidth: 0, positionLength: 0, footage: 0, rolls: 0 },
    { id: '901', positionId: '701', cutId: '10', finishedBatchId: '', orderNo: '', positionWidth: 0, positionLength: 0, footage: 0, rolls: 0 }
], 'rowsToPlanning collects supplies from rows with supply_id, skips empty');
assertEqual(planning.rowsToPlanning([]).cuts.length, 0, 'rowsToPlanning empty input → no cuts');
// сценарий показа: группировка + счётчик связей поверх результата rowsToPlanning
assertEqual(planning.groupBySlitter(plan.cuts).map(function(g) { return g.slitter.label; }),
    ['Станок 1', 'Без станка'], 'groupBySlitter over rowsToPlanning cuts');

// #3209/#3242: cut_plan_date приходит unix-штампом (плановая дата = «номер» резки), метраж
// резки/обеспечения отдельными колонками. Существующая резка должна попадать в
// пульт даже без старой order_approval_date: отчёт уже является источником очереди.
var issue3209Rows = [
    { cut_id: '23316', cut_slitter: 'Станок 1', cut_slitter_id: '1277',
      cut_plan_date: '1780837651', cut_status: '', supply_id: '23352', supply_position_id: '21101',
      cut_sequence: '1', cut_material: 'MR194', cut_jumbo_remaining: '13260.00',
      cut_winding: 'OUT', cut_roller_width: '60.00', cut_material_id: '2086',
      order_approval_date: '', order_id: '17990', order_no: '3690', supply_footage: '800', supply_rolls: '6',
      cut_length: '1200' },
    { cut_id: '23316', cut_slitter: 'Станок 1', cut_slitter_id: '1277',
      cut_plan_date: '1780837651', cut_status: '', supply_id: '23353', supply_position_id: '21102',
      cut_sequence: '1', cut_material: 'MR194', cut_jumbo_remaining: '13260.00',
      cut_winding: 'OUT', cut_roller_width: '60.00', cut_material_id: '2086',
      order_approval_date: '', order_id: '17990', order_no: '3690', supply_footage: '600', supply_rolls: '3',
      cut_length: '1200' },
    { cut_id: '23370', cut_slitter: 'Станок 2', cut_slitter_id: '1279',
      cut_plan_date: '1780837653', cut_status: '', supply_id: '', supply_position_id: '',
      cut_sequence: '2', cut_material: 'MR194', cut_material_id: '2086',
      order_approval_date: '', order_id: '17991', cut_length: '700' }
];
var issue3209Plan = planning.rowsToPlanning(issue3209Rows);
assertEqual(issue3209Plan.cuts.map(function(cut) {
    return { id: cut.id, number: cut.number, length: cut.length, visible: planning.isCutVisible(cut, '') };
}), [
    { id: '23316', number: '1780837651', length: 1200, visible: true },
    { id: '23370', number: '1780837653', length: 700, visible: true }
], 'rowsToPlanning #3209/#3242: timestamp cut_plan_date, cut_length, and blank approval still produce visible cuts');
assertEqual(issue3209Plan.supplies, [
    { id: '23352', positionId: '21101', cutId: '23316', finishedBatchId: '', orderNo: '3690', positionWidth: 60, positionLength: 0, footage: 800, rolls: 6 },
    { id: '23353', positionId: '21102', cutId: '23316', finishedBatchId: '', orderNo: '3690', positionWidth: 60, positionLength: 0, footage: 600, rolls: 3 }
], 'rowsToPlanning #3209: carries supply footage/rolls + order_no (#3624) + position dims (#3633) from report rows');
assertEqual(planning.cutRunLength(issue3209Plan.cuts[0], issue3209Plan.supplies, {}), 1200,
    'cutRunLength #3209: cut_length is available as run-length fallback');
assertEqual(planning.supplyFootage(issue3209Plan.supplies[0], { '23352': 0 }), 800,
    'supplyFootage #3209: direct report footage wins over empty object fallback');
assertEqual(planning.cutRunLength({ id: 'c1', length: 0 }, [{ id: 's1', cutId: 'c1', footage: 0 }], { s1: 500 }), 500,
    'cutRunLength #3209: object footage remains fallback when report row has no footage');

// ── rowsToPositions: строки positions_list (JSON_KV) → [{id,label}] для дропдауна ──
var posRows = [
    { position_id: '8207', order_no: 'АТХ-3002', position_no: '1', position_width: '25.00', position_length: '450.00', position_qty: '70' },
    { position_id: '8300', order_no: 'АТХ-3002', position_no: '2', position_width: '110.00', position_length: '600.00', position_qty: '5' }
];
assertEqual(planning.rowsToPositions(posRows), [
    { id: '8207', label: 'АТХ-3002/1 · 25мм * 450м', width: 25, length: 450, qty: 70 },
    { id: '8300', label: 'АТХ-3002/2 · 110мм * 600м', width: 110, length: 600, qty: 5 }
], 'rowsToPositions #3231: «<№заказа>/<№позиции> · <ширина>мм * <метраж>м»');
assertEqual(planning.rowsToPositions([{ position_id: '9', order_no: 'АТХ-7', position_no: '3', position_width: '' }]),
    [{ id: '9', label: 'АТХ-7/3', width: 0, length: 0, qty: 0 }], 'rowsToPositions: без габаритов — заказ/позиция');
assertEqual(planning.rowsToPositions([{ position_id: '9', position_no: '3', position_width: '25.00', position_length: '450.00' }]),
    [{ id: '9', label: '№3 · 25мм * 450м', width: 25, length: 450, qty: 0 }], 'rowsToPositions: нет order_no (старый отчёт) — деградация до №<номер>');
assertEqual(planning.rowsToPositions([]), [], 'rowsToPositions: пустой ввод → пустой список');
assertEqual(planning.remainingRollsForPosition({ id: 'p1', qty: 10 }, [
    { positionId: 'p1', rolls: 4 },
    { positionId: 'p1', rolls: '2' },
    { positionId: 'p2', rolls: 100 }
]), 4, 'remainingRollsForPosition #3231: вычитает уже обеспеченные рулоны позиции');
assertEqual(planning.remainingRollsForPosition({ id: 'p1', qty: 10 }, [
    { positionId: 'p1', rolls: 15 }
]), 0, 'remainingRollsForPosition #3231: не уходит ниже нуля');

// ── formatLinkedPositionLabel (#3406 п.1): подпись плашки «Связанные позиции» ──
assertEqual(planning.formatLinkedPositionLabel(
    { id: 'p1', label: 'АТХ-3002/1 · 25мм * 450м', qty: 70 }, 'p1', 12, 0),
    'АТХ-3002/1 · 25мм * 450м · 70 шт. · 12 рул.',
    'formatLinkedPositionLabel #3406: подпись + Количество позиции (шт.) + рулоны обеспечения');
assertEqual(planning.formatLinkedPositionLabel(
    { id: 'p1', label: 'АТХ-3002/1 · 25мм * 450м', qty: 70 }, 'p1', 0, 600),
    'АТХ-3002/1 · 25мм * 450м · 70 шт. · 600 м',
    'formatLinkedPositionLabel #3406: без рулонов показывает метраж обеспечения');
assertEqual(planning.formatLinkedPositionLabel(
    { id: 'p1', label: 'АТХ-3002/1 · 450м', qty: 5 }, 'p1', 0, 450),
    'АТХ-3002/1 · 450м · 5 шт.',
    'formatLinkedPositionLabel #3406: метраж не дублируется, если уже есть в подписи');
assertEqual(planning.formatLinkedPositionLabel(
    { id: 'p1', label: 'АТХ-3002/1', qty: 0 }, 'p1', 0, 0),
    'АТХ-3002/1',
    'formatLinkedPositionLabel #3406: нулевое Количество и обеспечение → только подпись');
assertEqual(planning.formatLinkedPositionLabel(undefined, '777', 3, 0),
    'позиция #777 · 3 рул.',
    'formatLinkedPositionLabel #3406: нет позиции в списке → fallback «позиция #N»');
// #3633: позиция выпала из активного positions_list (другая дата/закрытый заказ) — подпись
// собираем из данных обеспечения: номер заказа + габариты позиции, а НЕ id записи позиции.
assertEqual(planning.formatLinkedPositionLabel(undefined, '84667', 0, 900, '3335', 25, 900),
    '3335 · 25мм * 900м',
    'formatLinkedPositionLabel #3633: позиции нет в списке → «<заказ> · <ширина>мм * <длина>м» (без id записи), метраж не дублируется');
assertEqual(planning.formatLinkedPositionLabel(undefined, '73636', 0, 450, '3690'),
    '3690 · 450 м',
    'formatLinkedPositionLabel #3633: есть order_no, но нет габаритов → «<заказ>» + метраж (без висячего id)');
assertEqual(planning.formatLinkedPositionLabel(undefined, '73636', 0, 450, ''),
    'позиция #73636 · 450 м',
    'formatLinkedPositionLabel #3633: нет ни позиции, ни order_no → прежний фолбэк «позиция #N»');
assertEqual(planning.formatLinkedPositionLabel(
    { id: 'p1', label: 'АТХ-3002/1 · 25мм * 450м', qty: 70 }, 'p1', 12, 0, '9999'),
    'АТХ-3002/1 · 25мм * 450м · 70 шт. · 12 рул.',
    'formatLinkedPositionLabel #3624: позиция в списке есть → её подпись приоритетнее order_no обеспечения');

// ── stripSupplyRolls (#3320): рулоны обеспечения полосы = min(рулоны полосы, 110% остатка) ──
assertEqual(planning.stripSupplyRolls(8, 20), 8,
    'stripSupplyRolls #3320: рулоны полосы ≤ 110% остатка → берём рулоны полосы');
assertEqual(planning.stripSupplyRolls(20, 10), 11,
    'stripSupplyRolls #3320: рулоны полосы > 110% остатка → ограничиваем 110% остатка');
assertEqual(planning.stripSupplyRolls(11, 10), 11,
    'stripSupplyRolls #3320: ровно на границе 110% остатка');
assertEqual(planning.stripSupplyRolls(12, 10), 11,
    'stripSupplyRolls #3320: чуть выше границы → 110% остатка');
assertEqual(planning.stripSupplyRolls(5, 0), 0,
    'stripSupplyRolls #3320: нет остатка → 0');
assertEqual(planning.stripSupplyRolls(0, 10), 0,
    'stripSupplyRolls #3320: нет рулонов полосы → 0');
assertEqual(planning.stripSupplyRolls(-3, 10), 0,
    'stripSupplyRolls #3320: отрицательные рулоны полосы → 0');
assertEqual(planning.stripSupplyRolls('9', '20'), 9,
    'stripSupplyRolls #3320: строковые входы парсятся как числа');

// ── rowsToBatches: строки material_batches (JSON_KV) → [{id,label}] для дропдауна ──
var batchRows = [
    { batch_id: '1946', batch_no: 'RM-АТХ-3002-2026-05-31', batch_material: 'MWR118', batch_remainder_m2: '2440.00' },
    { batch_id: '8078', batch_no: 'Начальный остаток MR131', batch_material: 'MR131', batch_remainder_m2: '4588.35' },
    { batch_id: '8082', batch_no: 'MR132', batch_material: 'MR132', batch_remainder_m2: '38400.366' }
];
assertEqual(planning.rowsToBatches(batchRows), [
    { id: '1946', label: 'RM-АТХ-3002-2026-05-31 · MWR118 · ост. 2440 м²' },
    { id: '8078', label: 'Начальный остаток MR131 · MR131 · ост. 4588.35 м²' },
    { id: '8082', label: 'MR132 · MR132 · ост. 38400.37 м²' }
], 'rowsToBatches: подпись «номер · вид · ост. N м²», остаток округлён без хвостовых нулей');
assertEqual(planning.rowsToBatches([{ batch_id: '5', batch_no: 'НК-9', batch_material: '', batch_remainder_m2: '' }]),
    [{ id: '5', label: 'НК-9' }], 'rowsToBatches: пустые вид/остаток → только номер');
// #3242: основной остаток — погонные метры (batch_remainder_m), м² справочно в скобках.
assertEqual(planning.rowsToBatches([
    { batch_id: '7', batch_no: 'RM-7', batch_material: 'MR194', batch_remainder_m: '13260.00', batch_remainder_m2: '11934.00' }
]), [{ id: '7', label: 'RM-7 · MR194 · ост. 13260 м (11934 м²)' }],
    'rowsToBatches #3242: остаток в погонных метрах, м² справочно');
assertEqual(planning.rowsToBatches([
    { batch_id: '8', batch_no: 'RM-8', batch_material: 'MR132', batch_remainder_m: '500', batch_remainder_m2: '' }
]), [{ id: '8', label: 'RM-8 · MR132 · ост. 500 м' }],
    'rowsToBatches #3242: только погонные метры, без м²');
assertEqual(planning.rowsToBatches([]), [], 'rowsToBatches: пустой ввод → пустой список');

// ── parseMultiRefIds ──
assertEqual(planning.parseMultiRefIds('1,2:Фольга,Бумага'), ['1','2'], 'parseMultiRefIds: пара id');
assertEqual(planning.parseMultiRefIds('5:Фольга'), ['5'], 'parseMultiRefIds: одиночное');
assertEqual(planning.parseMultiRefIds(''), [], 'parseMultiRefIds: пусто');
assertEqual(planning.parseMultiRefIds(null), [], 'parseMultiRefIds: null');
assertEqual(planning.parseMultiRefIds(' 1 , 2 :a,b'), ['1','2'], 'parseMultiRefIds: пробелы');
assertEqual(planning.parseMultiRefIds('7,8'), ['7','8'], 'parseMultiRefIds: без двоеточия');
// ── isMaterialBlocked ──
assertEqual(planning.isMaterialBlocked(['1','2'], '2'), true, 'isMaterialBlocked: в списке');
assertEqual(planning.isMaterialBlocked(['1','2'], 3), false, 'isMaterialBlocked: не в списке');
assertEqual(planning.isMaterialBlocked(['1','2'], 1), true, 'isMaterialBlocked: число==строка');
assertEqual(planning.isMaterialBlocked([], '1'), false, 'isMaterialBlocked: пустой список');
assertEqual(planning.isMaterialBlocked(['1'], ''), false, 'isMaterialBlocked: пустой материал');

// ── groupBySlitter сортирует резки внутри станка по sequence (возр., пустые в конец, стабильно) ──
var seqCuts = [
    { id:'1', slitter:{id:'10',label:'Станок 1'}, sequence:2 },
    { id:'2', slitter:{id:'10',label:'Станок 1'}, sequence:1 },
    { id:'3', slitter:{id:'10',label:'Станок 1'}, sequence:null },
    { id:'4', slitter:{id:'10',label:'Станок 1'}, sequence:1 }
];
var g = planning.groupBySlitter(seqCuts)[0];
assertEqual(g.cuts.map(function(c){return c.id;}), ['2','4','1','3'], 'сорт по sequence (возр), когда knifeCount не задан; равные стабильно, пустые в конец');
var gKnives = planning.groupBySlitter([
    { id:'low-seq', slitter:{id:'10',label:'Станок 1'}, planDate:'2026-06-07', sequence:1, knifeCount:3 },
    { id:'high-seq', slitter:{id:'10',label:'Станок 1'}, planDate:'2026-06-07', sequence:2, knifeCount:7 },
    { id:'mid-seq', slitter:{id:'10',label:'Станок 1'}, planDate:'2026-06-07', sequence:3, knifeCount:5 }
])[0];
assertEqual(gKnives.cuts.map(function(c){ return c.id; }), ['low-seq','high-seq','mid-seq'],
    'groupBySlitter #3268: сохранённая sequence задаёт видимый порядок и расписание');
var gKnivesFallback = planning.groupBySlitter([
    { id:'few-no-seq', slitter:{id:'11',label:'Станок 1'}, planDate:'2026-06-07', sequence:null, knifeCount:3 },
    { id:'many-no-seq', slitter:{id:'11',label:'Станок 1'}, planDate:'2026-06-07', sequence:null, knifeCount:7 }
])[0];
assertEqual(gKnivesFallback.cuts.map(function(c){ return c.id; }), ['many-no-seq','few-no-seq'],
    'groupBySlitter #3268: без sequence остаётся fallback по ножам убыв.');
// #3258: planDate — unix-штамп DATETIME (с секундами): резки одного дня различаются
// по моменту создания, но должны сортироваться по ножам убыв., а не по штампу.
var gKnivesTs = planning.groupBySlitter([
    { id:'few', slitter:{id:'20',label:'Станок 2'}, planDate:'1780919776', sequence:1, knifeCount:5 },
    { id:'many', slitter:{id:'20',label:'Станок 2'}, planDate:'1780919777', sequence:2, knifeCount:15 }
])[0];
assertEqual(gKnivesTs.cuts.map(function(c){ return c.id; }), ['few','many'],
    'groupBySlitter #3268: unix-штампы одного дня не перебивают сохранённую sequence');
var gDays = planning.groupBySlitter([
    { id:'d2-1', slitter:{id:'10',label:'Станок 1'}, planDate:'2026-06-08', sequence:1 },
    { id:'d1-2', slitter:{id:'10',label:'Станок 1'}, planDate:'2026-06-07', sequence:2 },
    { id:'d1-1', slitter:{id:'10',label:'Станок 1'}, planDate:'2026-06-07', sequence:1 }
])[0];
assertEqual(gDays.cuts.map(function(c){return c.id;}), ['d1-1','d1-2','d2-1'],
    'groupBySlitter: одинаковые sequence разных дней сортируются по дню плана');
// ── rowsToPlanning читает cut_sequence → number|null ──
var rp = planning.rowsToPlanning([
    { cut_id:'100', cut_no:'5', cut_sequence:'3', supply_id:'' },
    { cut_id:'101', cut_no:'6', cut_sequence:'', supply_id:'' }
]);
assertEqual(rp.cuts[0].sequence, 3, 'rowsToPlanning: cut_sequence 3 → 3');
assertEqual(rp.cuts[1].sequence, null, 'rowsToPlanning: пусто → null');
var runsPlan = planning.rowsToPlanning([
    { cut_id:'runs-1', cut_no:'1', cut_planned_runs:'3', cut_length:'450', supply_id:'' }
]);
assertEqual(runsPlan.cuts[0].plannedRuns, 3,
    'rowsToPlanning #3219: cut_planned_runs → plannedRuns for queue card');
assertEqual(runsPlan.cuts[0].length, 450,
    'rowsToPlanning #3226: cut_length → run length for queue card');
assertEqual(planning.formatCutRuns(runsPlan.cuts[0].plannedRuns, runsPlan.cuts[0].length), 'Проходов: 3 * 450м',
    'formatCutRuns #3226: queue card includes planned runs and run length');
assertEqual(planning.formatCutRuns(3, 0), 'Проходов: 3',
    'formatCutRuns #3226: keeps existing label when run length is missing');
var durationPlan = planning.rowsToPlanning([
    { cut_id:'duration-1', cut_no:'1', cut_duration:'12,5', supply_id:'' }
]);
assertEqual(durationPlan.cuts[0].duration, 12.5,
    'rowsToPlanning #3223: cut_duration → duration minutes for queue data');
var timingPlan = planning.rowsToPlanning([
    { cut_id:'timing-1', cut_no:'1', cut_timing:'Метраж прохода: 600 м\nИтого резка: 12 мин', supply_id:'' }
]);
assertEqual(timingPlan.cuts[0].timing, 'Метраж прохода: 600 м\nИтого резка: 12 мин',
    'rowsToPlanning #3238: cut_timing → timing details for modal');
assertEqual(planning.cutTimingModalText(timingPlan.cuts[0]), 'Метраж прохода: 600 м\nИтого резка: 12 мин',
    'cutTimingModalText #3238: показывает сохранённый тайминг резки');
assertEqual(planning.cutTimingModalText({ timing: '' }), 'Тайминг резки не заполнен',
    'cutTimingModalText #3238: пустой cut_timing получает явный fallback');
var missingCutPlanningSignals = planning.cutPlanningReportDiagnostics([
    { cut_id:'diag-1', cut_no:'1', supply_id:'s-diag', supply_position_id:'p-diag' }
]);
assertEqual(missingCutPlanningSignals.map(function(d) { return d.key; }),
    ['plannedRuns', 'duration', 'runLength'],
    'cutPlanningReportDiagnostics #3229: сообщает об отсутствующих колонках проходов, длительности и метража');
assertEqual(planning.cutPlanningReportDiagnostics([
    { cut_id:'diag-ok', cut_no:'1', cut_planned_runs:'3', cut_duration:'12', supply_id:'s-ok', supply_footage:'450' }
]), [], 'cutPlanningReportDiagnostics #3229: не ругается, когда нужные сигналы отчёта есть');
var gpPlan = planning.rowsToPlanning([
    { cut_id:'', supply_id:'s-gp', supply_position_id:'p-gp', supply_finished_batch_id:'fb-1' },
    { cut_id:'c-cut', cut_no:'1', supply_id:'s-cut', supply_position_id:'p-cut', cut_sequence:'1' },
    { cut_id:'', supply_id:'s-empty', supply_position_id:'p-empty' }
]);
assertEqual(gpPlan.supplies.map(function(s) {
    return { id: s.id, positionId: s.positionId, cutId: s.cutId, finishedBatchId: s.finishedBatchId };
}), [
    { id:'s-gp', positionId:'p-gp', cutId:'', finishedBatchId:'fb-1' },
    { id:'s-cut', positionId:'p-cut', cutId:'c-cut', finishedBatchId:'' },
    { id:'s-empty', positionId:'p-empty', cutId:'', finishedBatchId:'' }
], 'rowsToPlanning #3215: читает Партия ГП обеспечения отдельно от резки');

// widthSetDistance — симметрическая разность мультимножеств ширин
assertEqual(planning.widthSetDistance([60,60,40],[60,40,40]), 2, 'widthSetDistance: одна 60 и одна 40 расходятся');
assertEqual(planning.widthSetDistance([],[]), 0, 'widthSetDistance: пустые → 0');
assertEqual(planning.widthSetDistance(['60'],[60]), 0, 'widthSetDistance: строка==число');
// awkwardRemainder — неудобный остаток джамбо (0<m<600)
assertEqual(planning.awkwardRemainder(0), false, 'awkward: 0 → false');
assertEqual(planning.awkwardRemainder(100), true, 'awkward: 100 → true');
assertEqual(planning.awkwardRemainder(600), false, 'awkward: 600 → false');
assertEqual(planning.awkwardRemainder(1200), false, 'awkward: 1200 → false');
assertEqual(planning.awkwardRemainder(-5), false, 'awkward: отриц → false');
// DEFAULT_OP_TIMES экспортирован (минуты-фоллбэк из таблицы «Время операции»)
assertEqual(planning.DEFAULT_OP_TIMES.MATERIAL_WINDING, 15, 'дефолт: смена сырья/намотки = 15 мин');
assertEqual(planning.DEFAULT_OP_TIMES.KNIFE, 30, 'дефолт: смена ножей = 30 мин');
assertEqual(planning.DEFAULT_OP_TIMES.KNIFE_MOVE, 2, 'дефолт #3472: перемещение ножа = 2 мин');
// #3600: changeoverCost в минутах: сырьё/намотка/партия → MATERIAL_WINDING(15);
// любая смена ножей / сужение ролика → ФИКСИРОВАННО KNIFE(30), независимо от числа ножей.
var base = { materialId:'1', winding:'IN', batchId:'b1', jumboRemainingM:0, knifeCount:4, knifeWidths:[60,60,60,60], rollerWidth:60 };
function clone(o,patch){ var c={}; for(var k in o) c[k]=o[k]; for(var k in (patch||{})) c[k]=patch[k]; return c; }
assertEqual(planning.changeoverCost(base, clone(base), null), 0, 'cost: идентичные → 0');
assertEqual(planning.changeoverCost(base, clone(base,{materialId:'2'}), null), 15, 'cost: смена сырья = 15');
assertEqual(planning.changeoverCost(base, clone(base,{winding:'OUT'}), null), 15, 'cost: смена намотки = 15 (та же операция)');
assertEqual(planning.changeoverCost(base, clone(base,{batchId:'b2'}), null), 15, 'cost: смена партии = смена сырья = 15');
// #3600: 4 ножа[60] → набор 20 ножей[20] (общих ширин нет) — любая смена ножей = фикс. 30.
assertEqual(planning.changeoverCost(base, clone(base,{knifeCount:20, knifeWidths:[20,20,20]}), null), 30, 'cost #3600: смена ножей = фикс. 30 (независимо от числа)');
// #3600: ножи те же, ролик сужается → это смена ножей = фикс. 30.
assertEqual(planning.changeoverCost(base, clone(base,{rollerWidth:40}), null), 30, 'cost #3600: сужение ролика = фикс. 30');
assertEqual(planning.changeoverCost(base, clone(base,{materialId:'2', knifeCount:20, knifeWidths:[20,20,20]}), null), 45, 'cost #3600: сырьё+ножи = 15+30 = 45');
assertEqual(planning.changeoverCost(base, clone(base,{materialId:'2'}), { MATERIAL_WINDING:7, KNIFE_MOVE:99 }), 7, 'cost: времена берутся из переданной таблицы');

// ── orderCuts: жадное упорядочивание, Фольга в конец, настройка весов ──
function cut(id,o){ return { id:id, materialId:o.m, winding:o.w||'IN', batchId:o.b||('B'+id), jumboRemainingM:o.r==null?0:o.r, knifeCount:o.k||4, knifeWidths:o.kw||[60], isFoil:!!o.foil, rollerWidth:o.rw||60 }; }
// группировка по сырью (минутная модель): резки одного сырья делят партию → переход
// внутри сырья стоит 0, между сырьём = 15 → материалы не чередуются.
var inMat = [ cut('1',{m:'A',b:'bA'}), cut('2',{m:'B',b:'bB'}), cut('3',{m:'A',b:'bA'}), cut('4',{m:'B',b:'bB'}) ];
var outMat = planning.orderCuts(inMat).map(function(c){return c.materialId;});
// число границ смены сырья = (различных − 1) = 1
var bnd = 0; for (var i=1;i<outMat.length;i++) if (outMat[i]!==outMat[i-1]) bnd++;
assertEqual(bnd, 1, 'orderCuts: сырьё сгруппировано (1 граница)');
// #3568: «ножи по убыванию» (#3130) — ПЕРВИЧНЫЙ критерий очереди, даже если это
// разбивает группировку сырья (#3268). Ножи 8/7/6 различны → строгое убывание
// A-high → B-mid → A-low, хотя сырьё A при этом перестаёт быть сгруппированным
// (минимум переналадки дал бы A-high → A-low → B-mid = 4+17 мин, но он теперь
// вторичен). Минимизация переналадки (#3268/#3472) остаётся тай-брейком ТОЛЬКО
// среди резок с равным числом ножей. До #3568 правило ножей↓ было лишь мягким
// тай-брейком внутри greedy и после позиционной стоимости ножей (#3472) не
// срабатывало → очередь шла по возрастанию ножей.
var setupMinuteCuts = [
    cut('A-high', { m:'A', b:'bA', k:8, kw:[60] }),
    cut('B-mid',  { m:'B', b:'bB', k:7, kw:[60] }),
    cut('A-low',  { m:'A', b:'bA', k:6, kw:[60] })
];
assertEqual(planning.orderCuts(setupMinuteCuts).map(function(c){ return c.id; }), ['A-high', 'B-mid', 'A-low'],
    'orderCuts #3568: ножи по убыванию первичны (8,7,6), переналадка вторична');
assertEqual(planning.orderCuts(setupMinuteCuts, { strategy: planning.PLANNING_STRATEGY_SETUP }).map(function(c){ return c.knifeCount; }), [8, 7, 6],
    'orderCuts #3568: явный SETUP — число ножей строго убывает');
// Фольга строго в конце
var inFoil = [ cut('1',{m:'A',foil:true}), cut('2',{m:'A'}), cut('3',{m:'A'}) ];
var outFoil = planning.orderCuts(inFoil).map(function(c){return c.id;});
assertEqual(outFoil[outFoil.length-1], '1', 'orderCuts: Фольга в конце');
// #3600: смена набора ножей (фикс. 30) дороже смены сырья (15).
assertEqual(planning.changeoverCost(base, clone(base,{knifeCount:9, knifeWidths:[10,10,10,10,10,10,10,10,10]}), null) >
            planning.changeoverCost(base, clone(base,{materialId:'9'}), null), true, 'changeoverCost #3600: смена ножей (30) дороже смены сырья (15)');
// sequence 1..N и вход не мутируется
var src = [ cut('1',{m:'A'}), cut('2',{m:'A'}) ];
var res = planning.orderCuts(src);
assertEqual(res.map(function(c){return c.sequence;}), [1,2], 'sequence 1..N');
assertEqual(src[0].sequence, undefined, 'вход не мутируется');

// #3130: число ножей убывает по очереди станка (внутри не-Фольга группы)
var knifeCuts = [
    { id: '1', materialId: 'M', knifeCount: 3, knifeWidths: [], rollerWidth: 0 },
    { id: '2', materialId: 'M', knifeCount: 7, knifeWidths: [], rollerWidth: 0 },
    { id: '3', materialId: 'M', knifeCount: 5, knifeWidths: [], rollerWidth: 0 }
];
assertEqual(planning.orderCuts(knifeCuts).map(function(c){ return c.knifeCount; }), [7, 5, 3], 'orderCuts: ножи убывают к концу дня (7,5,3)');
assertEqual(planning.byKnifeCountDesc([{ knifeCount: 2, id: 'a' }, { knifeCount: 2, id: 'b' }, { knifeCount: 9, id: 'c' }]).map(function(x){ return x.id; }), ['c', 'a', 'b'], 'byKnifeCountDesc: ↓, равные стабильно');

// #3412: при равной суммарной переналадке очередь должна идти по ножам ↓, а не ↑.
// Сценарий со скриншота (Станок 3): резки 6, 16, 16 ножей; у малоножевой резки самый
// узкий ролик → одиночный старт (argmin startKey) выбирал её первой и давал 6,16,16.
// Цепочка 16,16,6 стоит столько же (мин. переналадка), поэтому ножи должны убывать.
function w3412(pairs){ var o = []; pairs.forEach(function(pr){ for (var i = 0; i < pr[1]; i++) o.push(pr[0]); }); return o; }
var cuts3412 = [
    { id: 'A', materialId: 'MW308', winding: 'OUT', batchId: '', knifeCount: 6,  knifeWidths: w3412([[152, 5], [110, 1]]), rollerWidth: 200 },
    { id: 'B', materialId: 'MR194', winding: 'OUT', batchId: '', knifeCount: 16, knifeWidths: w3412([[59, 14], [30, 2]]), rollerWidth: 300 },
    { id: 'C', materialId: 'MW308', winding: 'OUT', batchId: '', knifeCount: 16, knifeWidths: w3412([[59, 14], [30, 2]]), rollerWidth: 300 }
];
assertEqual(planning.orderCuts(cuts3412).map(function(c){ return c.knifeCount; }), [16, 16, 6],
    'orderCuts #3412: при равной переналадке ножи убывают (16,16,6), а не растут (6,16,16)');
// Минимизация переналадки (#3268) не страдает: цепочка по-прежнему оптимальна по минутам.
assertEqual(planning.orderedChangeoverCost(cuts3412), planning.orderedChangeoverCost(cuts3412.slice().reverse()),
    'orderCuts #3412: стоимость переналадки не зависит от исходного порядка (детерминированный минимум)');
assertEqual(planning.orderedChangeoverCost(cuts3412), 45, 'orderCuts #3412: суммарная переналадка минимальна (#3600: 15 сырьё + 30 ножи фикс = 45)');

// ── #3666: одинаковый набор ширин ножей → на ТОТ ЖЕ станок, не разносим по разным ──
assertEqual(planning.knifeWidthSig({ knifeWidths: [55, 33] }), '33,55', 'knifeWidthSig #3666: уникальные ширины ↑');
assertEqual(planning.knifeWidthSig({ knifeWidths: [55, 55, 33, 33] }), '33,55', 'knifeWidthSig #3666: дубликаты схлопываются (тот же набор)');
assertEqual(planning.knifeWidthSig({ knifeWidths: [] }), '', 'knifeWidthSig #3666: ширин нет → пусто');
var s3666 = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }];
// Станок 4 уже режет 55+33 (OUT). Новая резка 55+33 (IN, другое число ножей) — на станок 4.
var g3666 = { '4': [{ id: 'A', materialId: 'MWR116L', winding: 'OUT', batchId: 'b1', knifeCount: 2, knifeWidths: [55, 33], rollerWidth: 600 }] };
var l3666 = { '1': 0, '2': 0, '3': 0, '4': 1 };
assertEqual(
    planning.chooseSlitterBySetup({ id: 'B', materialId: 'MWR116L', winding: 'IN', batchId: 'b1', knifeCount: 4, knifeWidths: [55, 55, 33, 33], rollerWidth: 600 }, s3666, g3666, l3666, null),
    '4', 'chooseSlitterBySetup #3666: тот же набор ширин (55+33) — на занятый станок 4, а не на пустой');
// Контроль: другой набор ширин → на пустой станок (без регресса разнесения чужих конфигов).
assertEqual(
    planning.chooseSlitterBySetup({ id: 'C', materialId: 'MWR116L', winding: 'IN', batchId: 'b1', knifeCount: 2, knifeWidths: [40, 40], rollerWidth: 600 }, s3666, g3666, l3666, null),
    '1', 'chooseSlitterBySetup #3666: другой набор ширин — на пустой станок (не пихаем к чужому набору)');

// #3421: генерация хардкодила стратегию FATIGUE («сложные раньше»), которая по
// route-score выдаёт ножи по ВОЗРАСТАНИЮ (6,16,16) на данных скриншота — вопреки
// #3130. Фиксы #3412/#3415 правили SETUP-путь, до генерации не доходили. Поэтому
// генерация переключена на SETUP (минимум переналадок, ножи по убыванию).
var cuts3421 = [
    { id: 'A', materialId: 'MW308', winding: 'OUT', batchId: '', knifeCount: 6,  knifeWidths: w3412([[152, 5], [110, 1]]), rollerWidth: 0 },
    { id: 'C', materialId: 'MW308', winding: 'OUT', batchId: '', knifeCount: 16, knifeWidths: w3412([[59, 14], [30, 2]]), rollerWidth: 0 },
    { id: 'B', materialId: 'MR194', winding: 'OUT', batchId: '', knifeCount: 16, knifeWidths: w3412([[59, 14], [30, 2]]), rollerWidth: 0 }
];
assertEqual(planning.orderCuts(cuts3421, { strategy: planning.PLANNING_STRATEGY_FATIGUE }).map(function(c){ return c.knifeCount; }), [6, 16, 16],
    'orderCuts #3421: FATIGUE-стратегия (прежняя генерация) даёт 6,16,16 — почему была проблема');
assertEqual(planning.orderCuts(cuts3421, { strategy: planning.PLANNING_STRATEGY_SETUP }).map(function(c){ return c.knifeCount; }), [16, 16, 6],
    'orderCuts #3421: SETUP-стратегия (новая генерация) даёт 16,16,6');

// #3272/#3270: второй вариант планирования учитывает рост усталости к концу очереди.
assertEqual(planning.fatiguePositionWeight(0, 3, 2), 1, 'fatiguePositionWeight #3272: первая позиция без штрафа');
assertEqual(planning.fatiguePositionWeight(2, 3, 2), 3, 'fatiguePositionWeight #3272: последняя позиция = 1 + alpha');
assertEqual(planning.estimatedKnifeCount({ rollerWidth: 25 }, 1600), 64, 'estimatedKnifeCount #3272: Wmax / width');
assertEqual(planning.estimatedKnifeCount({ knifeCount: 7, rollerWidth: 25 }, 1600), 7, 'estimatedKnifeCount #3272: явное число ножей важнее оценки по ширине');
// #3472: наборы ножей заданы явно (узкая = 30 ножей по 25, широкая = 4 по 200) — стоимость
// маршрута теперь отражает реальные перестановки; estimatedKnifeCount по-прежнему от ширины ролика.
var fatigueNarrowFirst = [
    { id: 'narrow', materialId: 'M', winding: 'IN', batchId: 'b', rollerWidth: 25, knifeCount: 0, knifeWidths: w3412([[25, 30]]) },
    { id: 'wide', materialId: 'M', winding: 'IN', batchId: 'b', rollerWidth: 200, knifeCount: 0, knifeWidths: w3412([[200, 4]]) }
];
assertEqual(planning.fatigueRouteScore(fatigueNarrowFirst, { machineWidth: 1600, fatigueFactor: 2, startCost: 45 }) <
            planning.fatigueRouteScore(fatigueNarrowFirst.slice().reverse(), { machineWidth: 1600, fatigueFactor: 2, startCost: 45 }),
    true, 'fatigueRouteScore #3272: узкая/многоножевая резка дешевле в начале очереди');
var fatigueWidthCuts = [
    { id: 'wideA', materialId: 'A', winding: 'IN', batchId: 'A', rollerWidth: 200, knifeCount: 0, knifeWidths: [] },
    { id: 'narrowA', materialId: 'A', winding: 'IN', batchId: 'A', rollerWidth: 25, knifeCount: 0, knifeWidths: [] },
    { id: 'midB', materialId: 'B', winding: 'IN', batchId: 'B', rollerWidth: 60, knifeCount: 0, knifeWidths: [] }
];
assertEqual(planning.orderCuts(fatigueWidthCuts, { strategy: planning.PLANNING_STRATEGY_FATIGUE, machineWidth: 1600, fatigueFactor: 2, startCost: 45 }).map(function(c){ return c.id; }),
    ['narrowA', 'midB', 'wideA'], 'orderCuts #3272: fatigue-вариант ставит узкие резки раньше широких');
assertEqual(planning.planQueues(fatigueWidthCuts.map(function(c) {
    var copy = {}; for (var k in c) copy[k] = c[k];
    copy.slitter = { id: '10', label: 'С1' };
    copy.planDate = '2026-06-07';
    return copy;
}), { strategy: planning.PLANNING_STRATEGY_FATIGUE, machineWidth: 1600, fatigueFactor: 2, startCost: 45 }).map(function(p) {
    return [p.cutId, p.sequence];
}), [['narrowA', 1], ['midB', 2], ['wideA', 3]], 'planQueues #3272: strategy прокидывается в планирование очередей');

// ── rowsToPlanning строит дескриптор движка из колонок отчёта ──
// #3242: cut_batch_id и cut_knives упразднены в cut_planning. batchId (Партия сырья) в
// отчёте больше нет → ''; число ножей теперь из cut_strips (Партия ГП), мёрджится в
// loadPlanning, а rowsToPlanning отдаёт 0.
var rpd = planning.rowsToPlanning([{
  cut_id:'9', cut_slitter_id:'10', cut_slitter:'Станок 1',
  cut_material_id:'1241', cut_material:'Фольга 38',
  cut_jumbo_remaining:'350', cut_winding:'out', cut_roller_width:'60',
  cut_sequence:'', supply_id:''
}]);
var c = rpd.cuts[0];
assertEqual(c.materialId, '1241', 'descriptor materialId');
assertEqual(c.batchId, '', 'descriptor batchId #3242: Партия сырья id вне отчёта → пусто');
assertEqual(c.jumboRemainingM, 350, 'descriptor jumboRemainingM number');
assertEqual(c.knifeCount, 0, 'descriptor knifeCount #3242: ножи из cut_strips (Партия ГП), не из rowsToPlanning');
assertEqual(c.winding, 'OUT', 'descriptor winding normalized');
assertEqual(c.rollerWidth, 60, 'descriptor rollerWidth number');
assertEqual(c.plannedRuns, 0, 'descriptor plannedRuns defaults to 0');
assertEqual(c.duration, 0, 'descriptor duration defaults to 0');
assertEqual(c.isFoil, true, 'descriptor isFoil по имени Фольга');
assertEqual(c.knifeWidths, [], 'descriptor knifeWidths пусто');
// planQueues
var pcuts = [
  { id:'1', slitter:{id:'10',label:'С1'}, materialId:'A', winding:'IN', batchId:'b1', jumboRemainingM:0, knifeCount:4, knifeWidths:[], isFoil:false, rollerWidth:60 },
  { id:'2', slitter:{id:'10',label:'С1'}, materialId:'A', winding:'IN', batchId:'b1', jumboRemainingM:0, knifeCount:4, knifeWidths:[], isFoil:false, rollerWidth:40 },
  { id:'3', slitter:{id:null,label:''}, materialId:'A', winding:'IN', batchId:'b1', jumboRemainingM:0, knifeCount:4, knifeWidths:[], isFoil:false, rollerWidth:50 }
];
var pq = planning.planQueues(pcuts);
assertEqual(pq.length, 2, 'planQueues: «без станка» исключён');
assertEqual(pq.filter(function(x){return x.slitterId==='10';}).map(function(x){return x.sequence;}).sort(), [1,2], 'planQueues: sequence 1..N на станок');
var pday = planning.planQueues([
  { id:'d1-a', planDate:'2026-06-07', slitter:{id:'10',label:'С1'}, materialId:'A', winding:'IN', batchId:'b1', jumboRemainingM:0, knifeCount:2, knifeWidths:[], isFoil:false, rollerWidth:60 },
  { id:'d1-b', planDate:'2026-06-07', slitter:{id:'10',label:'С1'}, materialId:'A', winding:'IN', batchId:'b1', jumboRemainingM:0, knifeCount:5, knifeWidths:[], isFoil:false, rollerWidth:60 },
  { id:'d2-a', planDate:'2026-06-08', slitter:{id:'10',label:'С1'}, materialId:'A', winding:'IN', batchId:'b1', jumboRemainingM:0, knifeCount:4, knifeWidths:[], isFoil:false, rollerWidth:60 }
]);
assertEqual(pday.map(function(x){ return [x.cutId, x.sequence]; }), [['d1-b', 1], ['d1-a', 2], ['d2-a', 1]],
    'planQueues: numbering restarts per machine/day and knives descend inside each day');
assertEqual(planning.nextSequenceForCuts([
  { id:'old-1', planDate:'2026-06-07', slitter:{id:'10'}, sequence:1 },
  { id:'old-2', planDate:'2026-06-07', slitter:{id:'10'}, sequence:3 },
  { id:'other-day', planDate:'2026-06-08', slitter:{id:'10'}, sequence:9 },
  { id:'other-slitter', planDate:'2026-06-07', slitter:{id:'20'}, sequence:7 }
], '10', '2026-06-07'), 4, 'nextSequenceForCuts #3215: следующий номер внутри станка и дня');

// ── moveInQueue ──
function qc(id,seq){ return { id:id, sequence:seq }; }
function byCut(a){ return (a||[]).slice().sort(function(x,y){ return x.cutId<y.cutId?-1:x.cutId>y.cutId?1:0; }); }
// down: a/b swap → a:2, b:1 (order-independent)
assertEqual(byCut(planning.moveInQueue([qc('a',1),qc('b',2),qc('c',3)],0,1)), byCut([{cutId:'a',sequence:2},{cutId:'b',sequence:1}]), 'moveInQueue вниз: swap a/b');
// up: b/c swap → b:3, c:2
assertEqual(byCut(planning.moveInQueue([qc('a',1),qc('b',2),qc('c',3)],2,-1)), byCut([{cutId:'b',sequence:3},{cutId:'c',sequence:2}]), 'moveInQueue вверх: swap b/c');
assertEqual(planning.moveInQueue([qc('a',1),qc('b',2)], 0, -1), [], 'граница вверх → []');
assertEqual(planning.moveInQueue([qc('a',1),qc('b',2)], 1, 1), [], 'граница вниз → []');
// null normalization: a/b swap among nulls → new order [b,a,c] → b:1,a:2,c:3 (all changed)
assertEqual(byCut(planning.moveInQueue([qc('a',null),qc('b',null),qc('c',null)],0,1)), byCut([{cutId:'a',sequence:2},{cutId:'b',sequence:1},{cutId:'c',sequence:3}]), 'null → нормализация 1..N');
var src=[qc('a',1),qc('b',2)]; planning.moveInQueue(src,0,1); assertEqual(src[0].id,'a','вход не мутируется');

// ── Хелперы генерации резок ──

// unsuppliedPositions
assertEqual(planning.unsuppliedPositions([{id:'1'},{id:'2'}], [{positionId:'1'}]).map(function(p){return p.id;}), ['2'], 'unsupplied: исключает обеспеченные');
assertEqual(planning.uncoveredPositions(
    [{id:'p-cut'}, {id:'p-gp'}, {id:'p-empty'}, {id:'p-none'}],
    [
        { positionId:'p-cut', cutId:'c1' },
        { positionId:'p-gp', cutId:'', finishedBatchId:'fb1' },
        { positionId:'p-empty', cutId:'', finishedBatchId:'' }
    ]
).map(function(p){ return p.id; }), ['p-empty', 'p-none'],
    'uncoveredPositions #3215: складская Партия ГП и резка закрывают позицию, пустое обеспечение — нет');
assertEqual(planning.supplyCoverageKind({ positionId:'p1', cutId:'c1', finishedBatchId:'fb1' }), 'cut',
    'supplyCoverageKind: резка имеет приоритет над Партией ГП');
// pickSlitter: стоп-лист E + балансировка
var sl = [{id:'10',stopMaterialIds:['M']},{id:'20',stopMaterialIds:[]},{id:'30',stopMaterialIds:[]}];
assertEqual(planning.pickSlitter(sl,'M',{}), '20', 'pickSlitter: 10 запрещает M, баланс → 20 (меньший id)');
assertEqual(planning.pickSlitter(sl,'M',{'20':2}), '30', 'pickSlitter: 20 загружен → 30');
assertEqual(planning.pickSlitter([{id:'10',stopMaterialIds:['M']}],'M',{}), null, 'pickSlitter: все запрещают → null');
// pickBatchFIFO
var b = [{id:'b1',materialId:'M',dateKey:20260102,remainder:100},{id:'b2',materialId:'M',dateKey:20260101,remainder:50},{id:'b3',materialId:'M',dateKey:20251231,remainder:0}];
assertEqual(planning.pickBatchFIFO(b,'M'), 'b2', 'pickBatchFIFO: старейшая с остатком (b3 остаток 0)');
assertEqual(planning.pickBatchFIFO(b,'Z'), null, 'pickBatchFIFO: нет сырья → null');
assertEqual(planning.pickBatchFIFO([{id:'old',materialId:'M',dateKey:1,remainder:100,active:false},{id:'new',materialId:'M',dateKey:2,remainder:100,active:true}], 'M'),
    'new', 'pickBatchFIFO: неактивные партии не участвуют в подборе');

// #3185: признаки складской полосы и плановое количество прогонов.
var layout3185 = {
  positionsCovered: ['p110', 'p70'],
  strips: [
    { width: 110, qty: 2, purpose: 'Заказ', positionIds: ['p110'] },
    { width: 70, qty: 1, purpose: 'Заказ', positionIds: ['p70'] },
    { width: 55, qty: 2, toStock: 1, purpose: 'Заказ', positionIds: [] },
    { width: 44, qty: 1, purpose: 'Склад', positionIds: [] }
  ]
};
var pos3185 = {
  p110: { id: 'p110', width: 110, qty: 5, length: 1200, sleeveDiameter: 76 },
  p70: { id: 'p70', width: 70, qty: 2, length: 800, sleeveDiameter: 40 }
};
assertEqual(planning.isStockStrip({ toStock: 1, purpose: 'Заказ' }), true, 'isStockStrip: «На склад»=1');
assertEqual(planning.isStockStrip({ toStock: 0, purpose: 'Склад' }), true, 'isStockStrip: legacy purpose «Склад»');
assertEqual(planning.isStockStrip({ toStock: 0, purpose: 'Заказ' }), false, 'isStockStrip: заказная полоса не складская');
assertEqual(planning.plannedRunsForLayout(layout3185, pos3185), 3, 'plannedRunsForLayout: max ceil(demand/non-stock strips)');
// #3435: обеспечение = заказанное кол-во позиции (p110 заказал 5), но не больше
// выпуска ширины (runs 3 × 2 полосы = 6) → 5; излишек 1 рулон уходит в запас.
assertEqual(planning.supplyRollsForPosition(layout3185, pos3185.p110, 3), 5, 'supplyRollsForPosition #3435: min(заказ 5, выпуск 6) = 5');
assertEqual(planning.supplyRollsForPosition(layout3185, pos3185.p70, 3), 2, 'supplyRollsForPosition #3435: min(заказ 2, выпуск 3) = 2');
// Заказ больше выпуска ширины → ограничивается выпуском (покрытие из неск. резок).
assertEqual(planning.supplyRollsForPosition(layout3185, { id: 'big', width: 110, qty: 99 }, 3), 6, 'supplyRollsForPosition #3435: заказ 99 > выпуск 6 → 6 (остаток из другой резки)');
assertEqual(planning.supplyRollsForPosition(layout3185, { id: 'noqty', width: 110, qty: 0 }, 3), 6, 'supplyRollsForPosition #3435: qty неизвестно → весь выпуск ширины (прежнее поведение)');
assertEqual(planning.layoutRunLength(layout3185, pos3185), 1200, 'layoutRunLength: max length of covered positions');
assertEqual(planning.finishedBatchesForLayout(layout3185, 'cut777', 1200, 3), [
  { cutId: 'cut777', width: 55, rolls: 6, length: 1200 },
  { cutId: 'cut777', width: 44, rolls: 3, length: 1200 }
], 'finishedBatchesForLayout: stock strips become GP batches');
// #3242: состав резки — «Партия ГП» по КАЖДОЙ ширине (заказ+склад), Σ рулонов × прогоны.
assertEqual(planning.producedBatchesForLayout(layout3185, 1200), [
  { width: 110, strips: 2, length: 1200 },
  { width: 70, strips: 1, length: 1200 },
  { width: 55, strips: 2, length: 1200 },
  { width: 44, strips: 1, length: 1200 }
], 'producedBatchesForLayout #3253: Партия ГП по ширине — число ПОЛОС за проход (без ×проходов)');
// #3242: план обеспечений — позиция → Партия ГП своей ширины, рулоны и метраж позиции.
assertEqual(planning.supplyPlanForLayout(layout3185, pos3185, 3), [
  { positionId: 'p110', width: 110, rolls: 5, footage: 1200 },
  { positionId: 'p70', width: 70, rolls: 2, footage: 800 }
], 'supplyPlanForLayout #3242/#3435: позиция → заказанные рулоны (не весь выпуск) + метраж');
assertEqual(planning.supplyPlanForLayout(layout3185, pos3185, 3, { p110: 999, p70: 111 }), [
  { positionId: 'p110', width: 110, rolls: 5, footage: 999 },
  { positionId: 'p70', width: 70, rolls: 2, footage: 111 }
], 'supplyPlanForLayout #3242: метраж берётся из posLength, если передан');
// #3242: билдеры полей «Партия ГП» и «Обеспечение»→«Партия ГП».
var fbMeta3242 = { id: '1081', val: 'Партия ГП', reqs: [
  { id: '1186', val: 'Ширина, мм' }, { id: '1188', val: 'Кол-во рулонов' },
  { id: '1189', val: 'Метраж, м' }, { id: '1192', val: 'В работе' }
] };
assertEqual(planning.buildFinishedBatchFields(fbMeta3242, { width: 110, rolls: 6, footage: 1200, active: '1' }),
  { t1186: 110, t1188: 6, t1189: 1200, t1192: '1' },
  'buildFinishedBatchFields #3242: Ширина/Кол-во рулонов/Метраж/«В работе»');

// #3431: «Кол-во полос» = полос за проход; «Кол-во рулонов» = полосы × число резок (проходов).
assertEqual(planning.finishedBatchRolls(2, 6), 12, 'finishedBatchRolls #3431: 2 полосы × 6 проходов = 12 рулонов');
assertEqual(planning.finishedBatchRolls(2, 0), 2, 'finishedBatchRolls #3431: нет проходов → рулоны = полосам (фолбэк)');
assertEqual(planning.finishedBatchRolls(0, 6), '', 'finishedBatchRolls #3431: нет полос → пусто');
assertEqual(planning.finishedBatchRolls('', 6), '', 'finishedBatchRolls #3431: пустое число полос → пусто');
// Метаданные «Партии ГП» с колонкой «Кол-во полос» (70190).
var fbMeta3431 = { id: '1081', val: 'Партия ГП', reqs: [
  { id: '1186', val: 'Ширина, мм' }, { id: '70190', val: 'Кол-во полос' },
  { id: '1188', val: 'Кол-во рулонов' }, { id: '1189', val: 'Метраж, м' },
  { id: '1192', val: 'В работе' }
] };
assertEqual(planning.buildFinishedBatchFields(fbMeta3431, { width: 110, strips: 2, rolls: 12, footage: 1200, active: '1' }),
  { t1186: 110, t70190: 2, t1188: 12, t1189: 1200, t1192: '1' },
  'buildFinishedBatchFields #3431: Кол-во полос → t70190, Кол-во рулонов → t1188');
// Старое окружение без колонки «Кол-во полос» — поле strips пропускается (graceful).
assertEqual(planning.buildFinishedBatchFields(fbMeta3242, { width: 110, strips: 2, rolls: 12, footage: 1200, active: '1' }),
  { t1186: 110, t1188: 12, t1189: 1200, t1192: '1' },
  'buildFinishedBatchFields #3431: нет колонки «Кол-во полос» → strips пропущен, без ошибки');

// #3433: разделение план/факт — «Кол-во рулонов» (спрос), «Кол-во план» (полосы ×
// проходов), «Кол-во факт» (факт), «ID заказа». Метаданные с полными колонками.
var fbMeta3433 = { id: '1081', val: 'Партия ГП', reqs: [
  { id: '1186', val: 'Ширина, мм' }, { id: '70190', val: 'Кол-во полос' },
  { id: '1188', val: 'Кол-во рулонов' }, { id: '70575', val: 'Кол-во план' },
  { id: '70573', val: 'Кол-во факт' }, { id: '70577', val: 'ID заказа' },
  { id: '1189', val: 'Метраж, м' }, { id: '1192', val: 'В работе' }
] };
assertEqual(planning.buildFinishedBatchFields(fbMeta3433,
    { width: 110, strips: 2, rolls: 8, planned: 12, orderId: '1966', footage: 1200, active: '1' }),
  { t1186: 110, t70190: 2, t1188: 8, t70575: 12, t70577: '1966', t1189: 1200, t1192: '1' },
  'buildFinishedBatchFields #3433: спрос→t1188, план→t70575, ID заказа→t70577');
assertEqual(planning.buildFinishedBatchFields(fbMeta3433, { actual: 14 }),
  { t70573: 14 },
  'buildFinishedBatchFields #3433: «Кол-во факт» → t70573');
// Пустой спрос/заказ (запас) — поля не пишутся (buildFields пропускает '').
assertEqual(planning.buildFinishedBatchFields(fbMeta3433,
    { width: 110, strips: 2, planned: 12, rolls: '', orderId: '', active: '1' }),
  { t1186: 110, t70190: 2, t70575: 12, t1192: '1' },
  'buildFinishedBatchFields #3433: пустой спрос/ID заказа (запас) → поля пропущены');

// #3433/#3435: batchOrderId — заказы покрытых позиций; несколько → через запятую,
// спроса нет → '' (запас). Партия под заказ ОБЯЗАНА иметь непустой «ID заказа».
assertEqual(planning.batchOrderId(['7', '7', '']), '7', 'batchOrderId: один заказ (дубли/пустые свернуты)');
assertEqual(planning.batchOrderId(['7', '9']), '7,9', 'batchOrderId #3435: несколько заказов → через запятую (не пусто)');
assertEqual(planning.batchOrderId(['7', '', '9', '7']), '7,9', 'batchOrderId #3435: различные id, сохранён порядок появления');
assertEqual(planning.batchOrderId(['', '']), '', 'batchOrderId: все пустые → пусто (запас)');
assertEqual(planning.batchOrderId([]), '', 'batchOrderId: пусто → пусто (запас)');
assertEqual(planning.batchOrderId(undefined), '', 'batchOrderId: undefined → пусто');
var supMeta3242 = { id: '1077', val: 'Обеспечение', reqs: [
  { id: '1149', val: 'Метраж, м' }, { id: '1154', val: 'В работе' },
  { id: '15016', val: 'Партия ГП', ref: '1081' }, { id: '16424', val: 'Кол-во рулонов' }
] };
assertEqual(planning.buildSupplyFieldsForFinishedBatch(supMeta3242, { footage: 1200, finishedBatchId: 'gp-7', rolls: 6, active: '1', status: 'Зарезервировано' }),
  { t1149: 1200, t16424: 6, t1154: '1', t15016: 'gp-7' },
  'buildSupplyFieldsForFinishedBatch #3242: метраж/«В работе»/ссылка на Партию ГП/рулоны (нет Статуса → пропуск)');
assertEqual(planning.sleeveMinutes(9, { SLEEVE_CUT: 2.5 }), 22.5, 'sleeveMinutes: SLEEVE_CUT × qty');

// #3189: новая метасхема — «Задание на втулки» снова алиас таблицы 1080,
// таблица подчинена «Позиции заказа», а опциональные поля «Диаметр»/«Статус»
// отсутствуют в метаданных.
var positionMeta3189 = {
  id: '1076',
  val: 'Заказанное количество',
  attrs: '{"alias":"Позиция заказа"}',
  reqs: [
    { id: '13671', val: 'Задача на втулки', arr_id: '1080' }
  ]
};
var supplyMeta3189 = {
  id: '1077',
  val: 'Обеспечение',
  reqs: [
    { id: '1149', val: 'Метраж, м' },
    { id: '1154', val: 'Активно' },
    { id: '15016', val: 'Партия ГП', ref: '1081', ref_id: '1152' },
    { id: '16424', val: 'Кол-во рулонов' },
    { id: '16428', val: 'Производственная резка', ref: '1078', ref_id: '1150' }
  ]
};
var cutMeta3189 = {
  id: '1078',
  val: 'Производственная резка',
  reqs: [
    { id: '1156', val: 'Слиттер' },
    { id: '1162', val: 'Активно' },
    { id: '16403', val: 'Кол-во план' },
    { id: '24308', val: 'Очередность' },
    { id: '15018', val: 'Партия сырья' },
    { id: '8629', val: 'Полоса', arr_id: '1073' },
    { id: '26584', val: 'Длительность, минут' },
    { id: '26990', val: 'Тайминг' },
    { id: '16422', val: 'Кол-во факт' }
  ]
};
var sleeveMeta3189 = {
  id: '1080',
  val: 'Задача на втулки',
  attrs: '{"alias":"Задание на втулки"}',
  reqs: [
    { id: '1180', val: 'Втулкорез', ref: '1071' },
    { id: '16399', val: 'Кол-во' },
    { id: '1183', val: 'Кол-во факт' },
    { id: '52654', val: 'Партия сырья', ref: '1074' }
  ]
};
var metadata3189 = [positionMeta3189, supplyMeta3189, cutMeta3189, sleeveMeta3189];
assertEqual(planning.tableByName(metadata3189, 'Позиция заказа').id, '1076',
  'tableByName: находит таблицу по alias из attrs (#3189)');
assertEqual(planning.tableByName(metadata3189, 'Задание на втулки').id, '1080',
  'tableByName: находит «Задание на втулки» по alias при val=«Задача на втулки» (#3189)');
assertEqual(planning.reqIdByName(sleeveMeta3189, 'Кол-во факт'), '1183',
  'reqIdByName: поле факта втулок в новой метасхеме');
assertEqual(planning.reqIdByName(sleeveMeta3189, 'Статус'), null,
  'reqIdByName: отсутствующий опциональный статус втулок → null');
assertEqual(planning.reqIdByName(cutMeta3189, 'Очередность'), '24308',
  'reqIdByName #3215: Очередность — 24308, не Кол-во план');
assertEqual(planning.reqIdByName(cutMeta3189, 'Кол-во план'), '16403',
  'reqIdByName #3215: Кол-во план остаётся 16403');
assertEqual(planning.reqIdByName(cutMeta3189, 'Длительность, минут'), '26584',
  'reqIdByName #3223: Длительность, минут — 26584');
assertEqual(planning.reqIdByName(cutMeta3189, 'Тайминг'), '26990',
  'reqIdByName #3238: Тайминг — 26990');
var missingWriteFields = planning.cutWriteDiagnostics({
  plannedRuns: '16403',
  duration: null,
  length: '24305'
}, {
  t16403: 3
}, ['plannedRuns', 'duration', 'length']);
assertEqual(missingWriteFields.map(function(d) { return d.key + ':' + d.reason; }),
  ['duration:metadata', 'length:field'],
  'cutWriteDiagnostics #3229: отличает отсутствующий реквизит от незаписанного поля');
assertEqual(planning.supplyCutRelation(supplyMeta3189, cutMeta3189), {
  mode: 'reference',
  reqId: '16428',
  arrId: null
}, 'supplyCutRelation: новая метасхема #3189 снова хранит ссылку на резку');
assertEqual(planning.buildSupplyFieldsForCut(supplyMeta3189, cutMeta3189, {
  footage: '1200',
  cutId: '501',
  rolls: '6',
  active: '1',
  status: 'Зарезервировано'
}), { t1149: '1200', t1154: '1', t16428: '501', t16424: '6' },
  'buildSupplyFieldsForCut #3231: пишет активность, метраж, резку и рулоны, пропускает отсутствующий статус');
// #3340: задание на втулки создаётся под позициями с типом втулки (sleeveId) и не «готовых».
var posSleeve3340 = {
  p110: { id: 'p110', width: 110, qty: 5, length: 1200, sleeveId: '35561', sleeveReady: false },
  p70:  { id: 'p70',  width: 70,  qty: 2, length: 800,  sleeveId: '8192',  sleeveReady: false }
};
assertEqual(planning.positionSleeveTasksForLayout(layout3185, posSleeve3340, 3), [
  { positionId: 'p110', sleeveId: '35561', qty: 5 },
  { positionId: 'p70', sleeveId: '8192', qty: 2 }
], 'positionSleeveTasksForLayout #3340/#3435: втулок = заказ позиции (не весь выпуск ширины)');
// «Готовый» тип втулки (sleeveReady) пропускается; позиция без втулки — тоже.
var posSleeve3340b = {
  p110: { id: 'p110', width: 110, qty: 5, length: 1200, sleeveId: '35561', sleeveReady: true },
  p70:  { id: 'p70',  width: 70,  qty: 2, length: 800,  sleeveId: '', sleeveReady: false }
};
assertEqual(planning.positionSleeveTasksForLayout(layout3185, posSleeve3340b, 3), [],
  'positionSleeveTasksForLayout #3340: готовый тип и позиция без втулки → заданий нет');

// ── #3340: FIFO-партия втулок из отчёта sleeve_batches_active ──
var sleeveBatches3340 = [
  { id: 'b1', diameterId: '35561', dateKey: 1772485200, active: true },
  { id: 'b2', diameterId: '35561', dateKey: 1772312400, active: true },   // раньше → FIFO
  { id: 'b3', diameterId: '35561', dateKey: 1772100000, active: false },  // не «в работе»
  { id: 'b4', diameterId: '8192',  dateKey: 1772312400, active: true }
];
assertEqual(planning.pickSleeveBatchId(sleeveBatches3340, '35561'), 'b2',
  'pickSleeveBatchId: самая ранняя активная партия совпадающего диаметра (FIFO)');
assertEqual(planning.pickSleeveBatchId(sleeveBatches3340, '8192'), 'b4',
  'pickSleeveBatchId: партия другого диаметра');
assertEqual(planning.pickSleeveBatchId(sleeveBatches3340, '99999'), '',
  'pickSleeveBatchId: нет партии нужного диаметра → пусто');
assertEqual(planning.pickSleeveBatchId(sleeveBatches3340, ''), '',
  'pickSleeveBatchId: нет sleeveId → пусто');
assertEqual(planning.pickSleeveBatchId([{ id: 'x', diameterId: '35561', dateKey: 1, active: false }], '35561'), '',
  'pickSleeveBatchId: только неактивные партии → пусто');
// ── Чистые хелперы плумбинга позиций/партий ──
// rowsToGenPositions: маппинг строк positions_list → дескрипторы
var grp = planning.rowsToGenPositions([
  { position_id:'10', position_material_id:'5', position_width:'60', position_qty:'30', position_length:'1200', sleeve_id:'35561', sleeve_ready:'', order_id:'900' },
  { position_id:'11', position_material_id:'5', position_width:'', position_qty:'', position_length:'', sleeve_id:'8192', sleeve_ready:'X' }
]);
assertEqual(grp, [
  { id:'10', materialId:'5', width:60, qty:30, length:1200, windDir:'', windLength:1200, leader:'', sleeveId:'35561', sleeveReady:false, dueKey: Infinity, orderId:'900', approved:false },
  { id:'11', materialId:'5', width:0, qty:0, length:0, windDir:'', windLength:0, leader:'', sleeveId:'8192', sleeveReady:true, dueKey: Infinity, orderId:'', approved:false }
], 'rowsToGenPositions #3340/#3433: sleeve_id/sleeve_ready + order_id («ID заказа»); пустые ширина/кол-во/длина → 0');
// #3472: «Лидер» читается из колонки отчёта (order_leader/position_leader); нет колонки → пусто.
assertEqual(planning.rowsToGenPositions([{ position_id:'1', order_leader:'Софмикс' }])[0].leader, 'Софмикс',
    'rowsToGenPositions #3472: лидер из order_leader');
assertEqual(planning.rowsToGenPositions([{ position_id:'2' }])[0].leader, '',
    'rowsToGenPositions #3472: нет колонки лидера → пусто (без разбиения)');

// rowsToGenPositions читает срок изготовления → dueKey (batchDateKey)
var grpDue = planning.rowsToGenPositions([
  { position_id:'10', position_material_id:'5', position_width:'60', position_qty:'30', position_due_date:'2026-06-10' }
]);
assertEqual(grpDue[0].dueKey, 20260610, 'rowsToGenPositions: position_due_date → dueKey');
// #3155: position_length → length («Длина, м» = метраж прогона джамбо обеспечения)
assertEqual(grpDue[0].length, 0, 'rowsToGenPositions: нет position_length → length 0');
assertEqual(grpDue[0].windLength, 0, 'rowsToGenPositions: нет position_length/wind_length → windLength 0');

var grp3219 = planning.rowsToGenPositions([
  { position_id:'o-approved', position_material_id:'2086', position_width:'25', position_qty:'105', position_length:'450', position_winding:'out', order_approval_date:'2026-06-07' },
  { position_id:'p-approved', position_material_id:'2086', position_width:'25', position_qty:'35', wind_length:'600.00', wind_dir:'IN', item_approval_date:'2026-06-07' },
  { position_id:'not-approved', position_material_id:'2086', position_width:'25', position_qty:'35', position_winding:'OUT' }
]);
assertEqual(grp3219.map(function(p) {
  return { id:p.id, length:p.length, windDir:p.windDir, windLength:p.windLength, approved:p.approved };
}), [
  { id:'o-approved', length:450, windDir:'OUT', windLength:450, approved:true },
  { id:'p-approved', length:600, windDir:'IN', windLength:600, approved:true },
  { id:'not-approved', length:0, windDir:'OUT', windLength:0, approved:false }
], 'rowsToGenPositions #3234: wind_length fallback feeds length for generated cut payloads');
assertEqual(planning.groupPositionsByPlanningProfile([
  { id:'p1', materialId:'2086', windDir:'OUT', windLength:600 },
  { id:'p2', materialId:'2086', windDir:'OUT', windLength:600 },
  { id:'p3', materialId:'2086', windDir:'IN', windLength:600 },
  { id:'p4', materialId:'3000', windDir:'OUT', windLength:600 },
  { id:'p5', materialId:'2086', windDir:'OUT', windLength:450 }
]).map(function(g) {
  return { materialId:g.materialId, windDir:g.windDir, windLength:g.windLength, ids:g.positions.map(function(p) { return p.id; }) };
}), [
  { materialId:'2086', windDir:'OUT', windLength:600, ids:['p1','p2'] },
  { materialId:'2086', windDir:'IN', windLength:600, ids:['p3'] },
  { materialId:'3000', windDir:'OUT', windLength:600, ids:['p4'] },
  { materialId:'2086', windDir:'OUT', windLength:450, ids:['p5'] }
], 'groupPositionsByPlanningProfile #3219: сырьё+намотка+метраж должны совпадать');
// #3472: лидер — отдельное измерение профиля. Совпадают сырьё/намотка/длина, но разный
// лидер → разные группы (резка заправляется одним лидером). group.key (ходовые) без лидера.
assertEqual(planning.groupPositionsByPlanningProfile([
  { id:'l1', materialId:'2086', windDir:'OUT', windLength:600, leader:'Софмикс' },
  { id:'l2', materialId:'2086', windDir:'OUT', windLength:600, leader:'Этикетка37' },
  { id:'l3', materialId:'2086', windDir:'OUT', windLength:600, leader:'Софмикс' },
  { id:'l4', materialId:'2086', windDir:'OUT', windLength:600 }
]).map(function(g) { return { leader:g.leader, key:g.key, ids:g.positions.map(function(p) { return p.id; }) }; }), [
  { leader:'Софмикс',    key:'2086|OUT|600', ids:['l1','l3'] },
  { leader:'Этикетка37', key:'2086|OUT|600', ids:['l2'] },
  { leader:'',           key:'2086|OUT|600', ids:['l4'] }
], 'groupPositionsByPlanningProfile #3472: разный лидер → разные резки, key (ходовые) без лидера');
assertEqual(planning.preferredWidthsKey('2086', 'out', '600.00'), '2086|OUT|600',
    'preferredWidthsKey #3219: cache key normalizes material/winding/length');

// positionLengthMap (#3155): { id позиции → Длина, м } из дескрипторов genPositions.
assertEqual(planning.positionLengthMap([
  { id:'10', length:1200 },
  { id:'11', length:0 },
  { id:'', length:999 },                 // пустой id пропускается
  { id:'12' }                            // нет length → 0
]), { '10':1200, '11':0, '12':0 }, 'positionLengthMap: id→длина, пустой id пропущен');
assertEqual(planning.positionLengthMap(null), {}, 'positionLengthMap: null → {}');
var timingOpTimes = { WIND_600:4 };
var missingTiming = planning.cutGenerationTimingDiagnostics([
  { positionsCovered:['p-no-length'], strips:[{ width:25, qty:1, purpose:'Заказ' }] }
], [{ id:'p-no-length', width:25, qty:1, length:0 }], timingOpTimes);
assertEqual(missingTiming.map(function(d) { return d.key + ':' + d.reason + ':' + d.layoutIndex; }),
  ['length:value:0'], 'cutGenerationTimingDiagnostics #3234: ловит отсутствующий метраж до сохранения резки');
assertEqual(missingTiming[0].message.indexOf('p-no-length') >= 0, true,
  'cutGenerationTimingDiagnostics #3234: сообщение указывает позицию без метража');
var missingWindTime = planning.cutGenerationTimingDiagnostics([
  { positionsCovered:['p-no-time'], strips:[{ width:25, qty:1, purpose:'Заказ' }] }
], [{ id:'p-no-time', width:25, qty:1, length:600 }], {});
assertEqual(missingWindTime.map(function(d) { return d.key + ':' + d.reason + ':' + d.layoutIndex; }),
  ['duration:value:0'], 'cutGenerationTimingDiagnostics #3234: ловит отсутствующие нормы WIND_* до сохранения резки');
assertEqual(planning.cutGenerationTimingDiagnostics([
  { positionsCovered:['p-ok'], strips:[{ width:25, qty:1, purpose:'Заказ' }] }
], [{ id:'p-ok', width:25, qty:1, length:600 }], timingOpTimes), [],
  'cutGenerationTimingDiagnostics #3234: валидная раскладка не даёт ошибок подготовки');

// ── aggregateStrips: строки отчёта cut_strips (JSON_KV) → { cutId: {knifeCount, knifeWidths:[...]} } ──
var agg = planning.aggregateStrips([
  { cut_id:'10', strip_width:'110', strip_qty:'2' },
  { cut_id:'10', strip_width:'70',  strip_qty:'1' },
  { cut_id:'20', strip_width:'50',  strip_qty:'3' }
]);
assertEqual(agg['10'].knifeCount, 3, 'aggregateStrips: cut10 ножей 2+1=3');
// различные ширины ножей cut10 (knifeWidths развёрнут по qty → [110,110,70], уникальные = {70,110})
assertEqual(agg['10'].knifeWidths.slice().sort(function(a,b){return a-b;}).filter(function(v,i,a){return a.indexOf(v)===i;}), [70,110], 'aggregateStrips: cut10 различные ширины ножей');
assertEqual(agg['20'].knifeCount, 3, 'aggregateStrips: cut20 ножей 3');
assertEqual(agg['10'].knifeWidths.length, 3, 'aggregateStrips: knifeWidths развёрнут по qty (110,110,70)');
// вход не мутируется
var aggSrc = [{ cut_id:'1', strip_width:'60', strip_qty:'2' }];
planning.aggregateStrips(aggSrc);
assertEqual(aggSrc, [{ cut_id:'1', strip_width:'60', strip_qty:'2' }], 'aggregateStrips: вход не мутируется');
assertEqual(planning.aggregateStrips([]), {}, 'aggregateStrips: пусто → {}');

// batchDateKey: ISO / D.M.Y / D/M/Y → сортируемое число; пусто/мусор → Infinity (в конец FIFO)
assertEqual(planning.batchDateKey('2026-01-05'), 20260105, 'batchDateKey: ISO');
assertEqual(planning.batchDateKey('5.1.2026'), 20260105, 'batchDateKey: D.M.Y');
assertEqual(planning.batchDateKey('5/1/2026'), 20260105, 'batchDateKey: D/M/Y');
assertEqual(planning.batchDateKey('') === Infinity, true, 'batchDateKey: пусто → Infinity');
assertEqual(planning.batchDateKey('мусор') === Infinity, true, 'batchDateKey: мусор → Infinity');
assertEqual(planning.batchDateKey('2026-01-05') < planning.batchDateKey('2026-02-01'), true, 'batchDateKey: старше = меньше (FIFO)');
// #3242: первая колонка «Партии сырья» (DATETIME) приходит unix-штампом (секунды) — ключ FIFO.
assertEqual(planning.batchDateKey('1772312400'), 1772312400, 'batchDateKey #3242: unix-штамп секунд → число');
assertEqual(planning.batchDateKey('1772312400') < planning.batchDateKey('1780088400'), true, 'batchDateKey #3242: ранний приход меньше (FIFO)');

// #3217: cut_no может приходить unix-штампом; в карточке очереди показываем
// его как дату+время до минут, но обычные номера и id не превращаем в даты.
assertEqual(planning.formatCutNumber('1780837651'), '07.06.2026 13:07',
    'formatCutNumber: timestamp cut_no → ДД.ММ.ГГГГ ЧЧ:ММ');
assertEqual(planning.formatCutNumber('7'), '7',
    'formatCutNumber: обычный короткий номер не форматируется как дата');
assertEqual(planning.formatCutNumber('23316'), '23316',
    'formatCutNumber: numeric record id below timestamp range stays raw');
assertEqual(planning.formatCutNumber('АТХ-7'), 'АТХ-7',
    'formatCutNumber: non-numeric number stays raw');
var cutMainState = { last: 0 };
assertEqual(planning.nextCutMainValue([], 1780895994000, cutMainState), 1780895994,
    'nextCutMainValue #3225: пустая очередь получает unix-секунду');
assertEqual(planning.nextCutMainValue([{ number: '1780895998' }], 1780895994000, cutMainState), 1780895999,
    'nextCutMainValue #3225: существующий больший номер инкрементируется');
assertEqual(planning.nextCutMainValue([], 1780895994000, cutMainState), 1780896000,
    'nextCutMainValue #3225: повтор в том же состоянии остаётся уникальным');
assertEqual(planning.addMainValueField({ id: '1078' }, { t1156: '10' }, 1780895994),
    { t1078: 1780895994, t1156: '10' },
    'addMainValueField #3225: главное значение пишется как t{tableId}');

// ── Фильтр видимости очереди isCutVisible (статус + согласование заказа + дата плана) ──
function vc(over){ return Object.assign({ status:'Ожидает', orderApprovalDate:'31.05.2026', planDate:'02.06.2026' }, over||{}); }
assertEqual(planning.isCutVisible(vc(), '2026-06-02'), true, 'isCutVisible: согласован, не завершён, дата совпадает → видна');
assertEqual(planning.isCutVisible(vc({status:'Завершён'}), '2026-06-02'), false, 'isCutVisible: «Завершён» → скрыта');
assertEqual(planning.isCutVisible(vc({orderApprovalDate:''}), '2026-06-02'), true, 'isCutVisible: пустое согласование не скрывает существующую резку');
assertEqual(planning.isCutVisible(vc({planDate:'01.06.2026'}), '2026-06-02'), false, 'isCutVisible: дата плана ≠ выбранной → скрыта');
assertEqual(planning.isCutVisible(vc({planDate:''}), '2026-06-02'), true, 'isCutVisible: дата плана пустая → видна (ещё не запланирована)');
assertEqual(planning.isCutVisible(vc({planDate:'02.06.2026'}), ''), true, 'isCutVisible: дата не выбрана → по дате не фильтруем');
assertEqual(planning.isCutVisible(vc({planDate:''}), ''), true, 'isCutVisible: обе пусты → видна');
assertEqual(planning.isCutVisible(null, '2026-06-02'), false, 'isCutVisible: null → false');
// #3249: «Дата план» приходит unix-штампом (DATETIME) — фильтр по дню должен совпасть.
var ts3249 = 1780919776;
var dt3249 = new Date(ts3249 * 1000);
var pad3249 = function(n){ return String(n).length < 2 ? '0' + n : String(n); };
var sameDayIso3249 = dt3249.getFullYear() + '-' + pad3249(dt3249.getMonth() + 1) + '-' + pad3249(dt3249.getDate());
var dayKey3249 = dt3249.getFullYear() * 10000 + (dt3249.getMonth() + 1) * 100 + dt3249.getDate();
assertEqual(planning.isCutVisible(vc({planDate:String(ts3249)}), sameDayIso3249), true,
    'isCutVisible #3249: unix-штамп planDate совпадает с днём фильтра → видна');
assertEqual(planning.isCutVisible(vc({planDate:String(ts3249)}), '2000-01-02'), false,
    'isCutVisible #3249: unix-штамп planDate ≠ день фильтра → скрыта');
assertEqual(planning.planDateDayKey('2026-06-08'), 20260608, 'planDateDayKey: ISO-дата → YYYYMMDD');
assertEqual(planning.planDateDayKey(String(ts3249)), dayKey3249, 'planDateDayKey #3249: unix-штамп → календарный день YYYYMMDD');
assertEqual(planning.planDateDayKey('') === Infinity, true, 'planDateDayKey: пусто → Infinity');
assertEqual(planning.planDateDayKey('01.06.2026'), 20260601, 'planDateDayKey: ДД.ММ.ГГГГ → YYYYMMDD');

// ── Сводка по полосам редактора (stripsUsedWidth/stripsTotalKnives/stripsRemainder) ──
// Полосы [{width:110,qty:2},{width:70,qty:1}] при джамбо 910:
//   занято = 110*2 + 70*1 = 290; ножей = 2+1 = 3; остаток = 910 - 290 = 620.
var sStrips = [{ width: 110, qty: 2 }, { width: 70, qty: 1 }];
assertEqual(planning.stripsUsedWidth(sStrips), 290, 'stripsUsedWidth: 110*2+70*1=290');
assertEqual(planning.stripsTotalKnives(sStrips), 3, 'stripsTotalKnives: 2+1=3');
assertEqual(planning.stripsRemainder(910, sStrips), 620, 'stripsRemainder: 910-290=620');
// терпимый разбор (строки, запятая, мусор → 0) и пустой вход
assertEqual(planning.stripsUsedWidth([{ width: '25,5', qty: '2' }]), 51, 'stripsUsedWidth: запятая-десятичный, строки');
assertEqual(planning.stripsTotalKnives([]), 0, 'stripsTotalKnives: пусто → 0');
assertEqual(planning.stripsRemainder(910, []), 910, 'stripsRemainder: нет полос → весь джамбо');
assertEqual(planning.stripsUsedWidth([{ width: 'мусор', qty: 'x' }]), 0, 'stripsUsedWidth: мусор → 0');
// вход не мутируется
var sSrc = [{ width: 110, qty: 2 }];
planning.stripsUsedWidth(sSrc); planning.stripsTotalKnives(sSrc); planning.stripsRemainder(910, sSrc);
assertEqual(sSrc, [{ width: 110, qty: 2 }], 'strips-сводка: вход не мутируется');

// ── Подпись кнопки «Полосы» с количеством полос резки (#3147) ──
assertEqual(planning.stripsButtonLabel(3), 'Полосы (3)', 'stripsButtonLabel: количество полос в скобках');
assertEqual(planning.stripsButtonLabel(0), 'Полосы', 'stripsButtonLabel: 0 → без числа');
assertEqual(planning.stripsButtonLabel(undefined), 'Полосы', 'stripsButtonLabel: нет данных → без числа');
assertEqual(planning.stripsButtonLabel(null), 'Полосы', 'stripsButtonLabel: null → без числа');
assertEqual(planning.stripsButtonLabel('5'), 'Полосы (5)', 'stripsButtonLabel: строковое число → в скобках');
assertEqual(planning.stripsButtonLabel(-2), 'Полосы', 'stripsButtonLabel: отрицательное → без числа');

// ── FIFO-резерв сырья (#3120 группа C): requiredRunLengthM / reserveFifo ──
assertEqual(planning.requiredRunLengthM([100, 450, 250]), 450, 'requiredRunLengthM: max(Метраж)');
assertEqual(planning.requiredRunLengthM(['200', '', '500,5']), 500.5, 'requiredRunLengthM: строки/запятая, пустые → 0');
assertEqual(planning.requiredRunLengthM([]), 0, 'requiredRunLengthM: пусто → 0');

// две партии, FIFO по приходу: нужно 700 пог.м, ширина 0.91 м.
// b2 раньше (arrivalKey 1) даёт 500, остаток 200 добираем из b1 (arrivalKey 2).
var fifoBatches = [
    { id: '10', label: 'B1', arrivalKey: 20260201, freeLinearM: 1000 },
    { id: '7',  label: 'B2', arrivalKey: 20260115, freeLinearM: 500 }
];
var r = planning.reserveFifo(fifoBatches, 700, 0.91);
assertEqual(r.allocations, [
    { batchId: '7', label: 'B2', linearM: 500, m2: 455 },
    { batchId: '10', label: 'B1', linearM: 200, m2: 182 }
], 'reserveFifo: FIFO по приходу, добор из следующей партии');
assertEqual([r.reservedLinearM, r.shortfallLinearM, r.fullyReserved], [700, 0, true], 'reserveFifo: полностью зарезервировано');

// нехватка: нужно 2000, доступно 1500 → shortfall 500, не полностью.
var r2 = planning.reserveFifo(fifoBatches, 2000, 1);
assertEqual([r2.reservedLinearM, r2.shortfallLinearM, r2.fullyReserved], [1500, 500, false], 'reserveFifo: нехватка → shortfall, fullyReserved=false');

// нет подходящих партий → пустой резерв, вся потребность в shortfall.
var r3 = planning.reserveFifo([], 300, 0.9);
assertEqual([r3.allocations.length, r3.reservedLinearM, r3.shortfallLinearM, r3.fullyReserved], [0, 0, 300, false], 'reserveFifo: нет партий → shortfall=N');

// потребность 0 → ничего не резервируем, fullyReserved=true.
var r4 = planning.reserveFifo(fifoBatches, 0, 0.9);
assertEqual([r4.allocations.length, r4.fullyReserved], [0, true], 'reserveFifo: N=0 → пусто, fullyReserved');

// cutMissingBatch (#3120 п.4): материал задан, но нет партии с остатком → true.
var gb = [{ id: '1', materialId: '2126', dateKey: 1, remainder: 100 }, { id: '2', materialId: '900', dateKey: 1, remainder: 0 }];
assertEqual(planning.cutMissingBatch({ materialId: '2126' }, gb), false, 'cutMissingBatch: есть партия с остатком → false');
assertEqual(planning.cutMissingBatch({ materialId: '900' }, gb), true, 'cutMissingBatch: партия есть, но остаток 0 → true');
assertEqual(planning.cutMissingBatch({ materialId: '777' }, gb), true, 'cutMissingBatch: нет партий материала → true');
assertEqual(planning.cutMissingBatch({ materialId: '' }, gb), false, 'cutMissingBatch: материал не задан → false');

// вход не мутируется (порядок исходного массива сохранён).
assertEqual(fifoBatches[0].id, '10', 'reserveFifo: вход не мутируется (сортировка на копии)');

// Длительность намотки: точки из WIND_*, интерполяция метры→минуты (старт/финиш резок).
var opT = { WIND_300: 1.2, WIND_600: 4.0, WIND_900: 5.0, WIND_1100: 5.6, MATERIAL_WINDING: 15, KNIFE_220_59: 30 };
var pts = planning.windingPointsFromTimes(opT);
assertEqual(pts, [{m:300,min:1.2},{m:600,min:4.0},{m:900,min:5.0},{m:1100,min:5.6}], 'windingPointsFromTimes: только WIND_<метры>, по возрастанию');
assertEqual(planning.windingMinutes(0, pts), 0, 'windingMinutes: 0 м → 0');
assertEqual(planning.windingMinutes(300, pts), 1.2, 'windingMinutes: 300 м → 1.2 (точка)');
assertEqual(planning.windingMinutes(1100, pts), 5.6, 'windingMinutes: 1100 м → 5.6 (точка)');
assertEqual(planning.windingMinutes(150, pts), 0.6, 'windingMinutes: 150 м → 0.6 (пропорц. от 0 до первой)');
assertEqual(planning.windingMinutes(750, pts), 4.5, 'windingMinutes: 750 м → 4.5 (между 600 и 900)');
assertEqual(planning.windingMinutes(1200, pts), 5.9, 'windingMinutes: 1200 м → 5.9 (экстраполяция)');
assertEqual(planning.windingMinutes(500, []), 0, 'windingMinutes: нет точек → 0');
// #3606: фольга наматывается медленнее — серия WIND_FOIL_<метры>, «4 мин за каждые 305 м».
var opTF = { WIND_300: 1.2, WIND_600: 4.0, WIND_FOIL_305: 4.0 };
var ptsF = planning.windingPointsFromTimes(opTF);
assertEqual(planning.foilWindingPointsFromTimes(opTF), [{m:0,min:0,foil:true},{m:305,min:4,foil:true}],
    'foilWindingPointsFromTimes: WIND_FOIL_305 + опорная (0,0)');
assertEqual(JSON.stringify(ptsF.foil), JSON.stringify([{m:0,min:0,foil:true},{m:305,min:4,foil:true}]),
    'windingPointsFromTimes прикрепляет .foil');
assertEqual(planning.windingMinutes(122, ptsF.foil), 1.6, 'фольга 122 м → 1.6 (4×122/305, пропорция)');
assertEqual(planning.windingMinutes(305, ptsF.foil), 4, 'фольга 305 м → 4');
assertEqual(planning.windingMinutes(610, ptsF.foil), 8, 'фольга 610 м → 8 (4 мин за каждые 305 м, без клампа)');
assertEqual(planning.windPointsForCut(true, ptsF), ptsF.foil, 'windPointsForCut: фольга → фолье-точки');
assertEqual(planning.windPointsForCut(false, ptsF) === ptsF, true, 'windPointsForCut: не фольга → обычные');
assertEqual(planning.plannedCutDurationMinutes(122, 1, opTF, true), 1.6, 'plannedCutDuration: фольга 122 м × 1 = 1.6');
assertEqual(planning.plannedCutDurationMinutes(122, 1, opTF, false), 0.488, 'plannedCutDuration: НЕ фольга 122 м = 0.488 (обычная WIND_300)');
assertEqual(planning.foilWindingPointsFromTimes({ WIND_300: 1.2 }), [], 'foilWindingPointsFromTimes: нет WIND_FOIL_ → []');
assertEqual(planning.windPointsForCut(true, planning.windingPointsFromTimes({ WIND_300: 1.2 })),
    planning.windingPointsFromTimes({ WIND_300: 1.2 }), 'windPointsForCut: фольга без WIND_FOIL_ → обычные (фолбэк)');
assertEqual(planning.formatWindingNorms([{m:0,min:0,foil:true},{m:305,min:4,foil:true}]),
    'Норма намотки: WIND_FOIL_305=4 мин', 'formatWindingNorms: WIND_FOIL_ + опорная (0,0) скрыта');
var plannedCutDuration = typeof planning.plannedCutDurationMinutes === 'function'
    ? planning.plannedCutDurationMinutes
    : function() { return undefined; };
assertEqual(plannedCutDuration(600, 3, opT), 12,
    'plannedCutDurationMinutes #3223: общая длительность = проходы × намотка одного прогона');
assertEqual(plannedCutDuration(600, 0, opT), 0,
    'plannedCutDurationMinutes #3223: без плановых проходов длительность 0');
assertEqual(planning.cutTimingDetails(600, 3, opT),
    'Метраж прохода: 600 м\nПлановых проходов: 3\nНамотка 1 прохода: 4 мин\nИтого резка: 4 * 3 = 12 мин\nНорма намотки: WIND_600=4 мин',
    'cutTimingDetails #3240: расшифровка длительности с релевантной нормой (точное совпадение метража)');
assertEqual(planning.cutTimingDetails(750, 1, opT),
    'Метраж прохода: 750 м\nПлановых проходов: 1\nНамотка 1 прохода: 4.5 мин\nИтого резка: 4.5 * 1 = 4.5 мин\nНормы намотки: WIND_600=4 мин; WIND_900=5 мин (интерполяция)',
    'cutTimingDetails #3240: интерполяция показывает обе окружающие нормы');

// #3240: relevantWindingNorms — какие WIND_* реально применяются для метража.
assertEqual(planning.relevantWindingNorms(600, pts), [{m:600,min:4}], 'relevantWindingNorms: точное совпадение → одна точка');
assertEqual(planning.relevantWindingNorms(750, pts), [{m:600,min:4},{m:900,min:5}], 'relevantWindingNorms: между точками → нижняя+верхняя');
assertEqual(planning.relevantWindingNorms(150, pts), [{m:300,min:1.2}], 'relevantWindingNorms: ниже первой → первая (пропорция от 0)');
assertEqual(planning.relevantWindingNorms(1200, pts), [{m:900,min:5},{m:1100,min:5.6}], 'relevantWindingNorms: выше последней → последний отрезок (экстраполяция)');
assertEqual(planning.relevantWindingNorms(0, pts), [], 'relevantWindingNorms: 0 м → []');
assertEqual(planning.formatWindingNorms([{m:600,min:4}]), 'Норма намотки: WIND_600=4 мин', 'formatWindingNorms: одна норма');
assertEqual(planning.formatWindingNorms([{m:600,min:4},{m:900,min:5}]), 'Нормы намотки: WIND_600=4 мин; WIND_900=5 мин (интерполяция)', 'formatWindingNorms: две нормы — пометка интерполяции');
assertEqual(planning.formatWindingNorms([]), '', 'formatWindingNorms: пусто → пустая строка');

// #3240: changeoverParts/setupBreakdown — расшифровка переналадки и полного setup.
var toBase = { materialId:'1', winding:'IN', batchId:'b', knifeCount:4, knifeWidths:[60], rollerWidth:60 };
function toClone(extra){ var o = {}; Object.keys(toBase).forEach(function(k){ o[k] = toBase[k]; }); if (extra) Object.keys(extra).forEach(function(k){ o[k] = extra[k]; }); return o; }
assertEqual(planning.changeoverParts(toBase, toClone(), null), [], 'changeoverParts: идентичные → нет операций');
assertEqual(planning.changeoverParts(toBase, toClone({materialId:'2'}), null),
    [{code:'MATERIAL_WINDING', label:'смена сырья / намотки / партии', minutes:15}],
    'changeoverParts: смена сырья → MATERIAL_WINDING 15');
assertEqual(planning.changeoverParts(toBase, toClone({materialId:'2', knifeCount:9, knifeWidths:[10,10,10,10,10,10,10,10,10]}), null),
    [{code:'KNIFE', label:'смена ножей / сужение ролика', minutes:30}, {code:'MATERIAL_WINDING', label:'смена сырья / намотки / партии', minutes:15}],
    'changeoverParts #3688: сырьё+ножи → СНАЧАЛА ножи 30, ПОТОМ смена сырья 15');
assertEqual(planning.changeoverParts(null, toBase, null), [], 'changeoverParts: нет предыдущей → []');
// #3688: лидер вынесен в КОНЕЦ резки — в setupBreakdown (ПЕРЕД резкой) лидера больше нет.
assertEqual(planning.setupBreakdown(null, toBase, null), [],
    'setupBreakdown #3688: первая резка без флага/заправки → [] (лидер в конце)');
assertEqual(planning.setupBreakdown(toBase, toClone({materialId:'2'}), null),
    [{code:'MATERIAL_WINDING', label:'смена сырья / намотки / партии', minutes:15}],
    'setupBreakdown #3688: смена сырья (без лидера)');
// Σ minutes setupBreakdown == setupMin расписания (переналадка 15, лидер теперь в конце).
var sbSched = planning.buildSchedule([toBase, toClone({materialId:'2'})], { windPoints: pts, runLengthByCut: {}, shiftStartMin: 480 });
assertEqual(sbSched[1].setupMin, planning.setupBreakdown(toBase, toClone({materialId:'2'}), null).reduce(function(s,p){return s+p.minutes;},0),
    'setupBreakdown #3240: Σ minutes == setupMin расписания');

// ── #3669 п.2: настройка ножей первой задачи очереди (флаг firstCutSetup) ──
// Первая задача каждого дня, кроме первого, считает переналадку с последней задачей
// предыдущего дня (changeoverParts). У самой первой задачи предыдущего дня нет — настройку
// ножей резервируем по флагу. firstSetupParts: резка с ножами → KNIFE, иначе [].
assertEqual(planning.firstSetupParts({ knifeCount:4, knifeWidths:[60] }, null),
    [{code:'KNIFE', label:'настройка ножей', minutes:30}],
    'firstSetupParts #3669: резка с ножами → настройка ножей 30');
assertEqual(planning.firstSetupParts({ knifeCount:0, knifeWidths:[] }, null), [],
    'firstSetupParts #3669: без ножей → нет настройки');
assertEqual(planning.firstSetupParts({ knifeCount:4 }, { KNIFE:0 }), [],
    'firstSetupParts #3669: KNIFE=0 → нет настройки');
// #3688: лидер вынесен в конец. setupBreakdown ПЕРЕД резкой — без флага [], с флагом — настройка ножей.
assertEqual(planning.setupBreakdown(null, toBase, null), [],
    'setupBreakdown #3688: первая задача без флага → [] (лидер в конце)');
assertEqual(planning.setupBreakdown(null, toBase, null, { firstCutSetup:true }),
    [{code:'KNIFE', label:'настройка ножей', minutes:30}],
    'setupBreakdown #3688: первая задача с флагом → настройка ножей (лидер в конце)');
// buildSchedule с firstCutSetup: первая резка резервирует настройку ножей (ПЕРЕД резкой),
// лидер 2 — в конце (leaderMin); вторая (та же конфигурация) — без переналадки (setupMin 0).
var fsSched = planning.buildSchedule([toBase, toClone()],
    { windPoints: pts, runLengthByCut: {}, shiftStartMin: 480, firstCutSetup: true });
assertEqual(fsSched[0].setupMin, 30, 'buildSchedule #3688: первая резка — настройка ножей 30 (лидер 2 в конце)');
assertEqual(fsSched[0].leaderMin, 2, 'buildSchedule #3688: лидер 2 — после намотки (leaderMin)');
assertEqual(planning.setupBreakdown(null, toBase, null, { firstCutSetup:true }).reduce(function(s,p){return s+p.minutes;},0),
    fsSched[0].setupMin, 'buildSchedule #3688: Σ setupBreakdown(первая, флаг) == setupMin расписания');
assertEqual(fsSched[1].setupMin, 0, 'buildSchedule #3688: вторая (та же конфигурация) — setupMin 0 (без повторной настройки)');
// Без флага первая резка настройку ножей НЕ резервирует (как прежде) — setupMin 0.
assertEqual(planning.buildSchedule([toBase], { windPoints: pts, runLengthByCut: {}, shiftStartMin: 480 })[0].setupMin, 0,
    'buildSchedule #3688: без флага первая резка — setupMin 0 (лидер в конце)');
// splitMachineQueue с firstCutSetup: первый сегмент резервирует настройку ножей.
assertEqual(planning.splitMachineQueue([{ id:'a', knifeWidths:[100], knifeCount:1, plannedRuns:1 }],
    { dayStartMin:0, dayEndMin:1000, times:{ BETWEEN_CUTS:0 }, perPassByCut:{ a:10 }, runsByCut:{ a:1 }, firstCutSetup:true })[0].setupMin,
    30, 'splitMachineQueue #3669: первый сегмент — настройка ножей 30');
assertEqual(planning.splitMachineQueue([{ id:'a', knifeWidths:[100], knifeCount:1, plannedRuns:1 }],
    { dayStartMin:0, dayEndMin:1000, times:{ BETWEEN_CUTS:0 }, perPassByCut:{ a:10 }, runsByCut:{ a:1 } })[0].setupMin,
    0, 'splitMachineQueue #3669: без флага первый сегмент — без настройки (обратная совместимость)');

// #3240: заголовок модалки не показывает авто-номер (timestamp), а показывает сырьё/намотку.
assertEqual(planning.cutTimingModalTitle({ number:'1749375420', materialName:'MW308', winding:'IN' }),
    'Тайминг резки · MW308 · намотка IN',
    'cutTimingModalTitle #3240: timestamp-номер скрыт, показаны сырьё и намотка');
assertEqual(planning.cutTimingModalTitle({ number:'42', materialName:'MW308', winding:'OUT' }),
    'Тайминг резки · № 42 · MW308 · намотка OUT',
    'cutTimingModalTitle #3240: человекочитаемый номер сохраняется');
assertEqual(planning.cutTimingModalTitle({ materialId:5 }),
    'Тайминг резки · #5',
    'cutTimingModalTitle #3240: без номера/намотки — fallback на материал');

// #3240: buildCutTimingCtx + cutTimingTimelineLines — хронология окна с setup и жирным итогом.
var tlPrev = { materialId:'1', winding:'IN', batchId:'b', knifeCount:4, knifeWidths:[60], rollerWidth:60 };
var tlCut = { id:'X', materialId:'2', winding:'IN', batchId:'b', knifeCount:4, knifeWidths:[60], rollerWidth:60, plannedRuns:1 };
var tlSched = planning.buildSchedule([tlPrev, tlCut], { windPoints: pts, runLengthByCut: { X:600 }, shiftStartMin: 480 });
var tlSc = tlSched[1];   // #3688: вторая резка — setup = смена сырья 15 (лидер 2 в конце)
var tlCtx = planning.buildCutTimingCtx(tlCut, tlPrev, tlSc, 600, pts, null);
assertEqual([tlCtx.length, tlCtx.runs, tlCtx.oneRun, tlCtx.total], [600, 1, 4, 4], 'buildCutTimingCtx: метраж/проходы/намотка/итого');
assertEqual(tlCtx.setupParts.length, 1, 'buildCutTimingCtx #3688: setup = смена сырья (без лидера)');
assertEqual(tlCtx.leaderMin, 2, 'buildCutTimingCtx #3688: лидер 2 — в конце резки');
assertEqual(tlCtx.norms, [{m:600,min:4}], 'buildCutTimingCtx: релевантная норма 600');
var tlLines = planning.cutTimingTimelineLines(tlCtx);
var tlBold = tlLines.filter(function(l){ return l.bold; });
assertEqual(tlBold.length, 1, 'cutTimingTimelineLines: ровно одна жирная строка');
assertEqual(/^.*Итого резка: 4 \* 1 = 4 мин$/.test(tlBold[0].text), true, 'cutTimingTimelineLines: жирная строка — «Итого резка»');
var tlStart = planning.formatClock(tlSc.startMin);
var tlSetupStart = planning.formatClock(tlSc.startMin - 15);   // #3688: окно-старт = старт − переналадка (без лидера)
assertEqual(tlBold[0].text.indexOf(tlStart + ' · ') === 0, true, 'cutTimingTimelineLines: «Итого резка» начинается со старта резки');
var tlText = tlLines.map(function(l){ return l.text; }).join('\n');
assertEqual(tlText.indexOf(tlSetupStart + ' · смена сырья / намотки / партии — 15 мин') >= 0, true, 'cutTimingTimelineLines #3688: смена сырья от старта окна');
assertEqual(tlText.indexOf(planning.formatClock(tlSc.finishMin) + ' · лидер между резками — 2 мин') >= 0, true, 'cutTimingTimelineLines #3688: лидер между резками — ПОСЛЕ намотки (в конце)');
assertEqual(/Норма намотки: WIND_600=4 мин/.test(tlText), true, 'cutTimingTimelineLines: только релевантная норма');
assertEqual(tlLines[tlLines.length-1].text, planning.formatClock(tlSc.finishMin + 2) + ' · готово', 'cutTimingTimelineLines #3688: финальная строка — готово (после лидера)');

// Расписание очереди: старт/финиш от 08:00 (480 мин) + лидер 2 + намотка по метражу.
var schedCuts = [
    { id:'A', materialId:'1', winding:'IN', batchId:'b', knifeCount:4, knifeWidths:[60], rollerWidth:60 },
    { id:'B', materialId:'1', winding:'IN', batchId:'b', knifeCount:4, knifeWidths:[60], rollerWidth:60 }
];
var sched = planning.buildSchedule(schedCuts, { windPoints: pts, runLengthByCut: { A:300, B:600 }, shiftStartMin: 480 });
// #3688: лидер в конце → 1-я резка стартует в 08:00 (480) без сетапа; лидер 2 после намотки (leaderMin).
assertEqual(sched[0], { cutId:'A', startMin:480, finishMin:481.2, setupMin:0, durationMin:1.2, leaderMin:2 }, 'buildSchedule #3688: 1-я резка (старт 08:00, лидер 2 в конце)');
assertEqual(sched[1], { cutId:'B', startMin:483.2, finishMin:487.2, setupMin:0, durationMin:4, leaderMin:2 }, 'buildSchedule #3688: 2-я накопительно (идентична → переналадка 0, после лидера 1-й)');

// ── #3652: привязка резки к её рабочему дню «Даты план» (якорь) ──
// dayOffsetFromBase: смещение календарного дня от базы (полночь дня фильтра «С»).
process.env.TZ = process.env.TZ || 'UTC';
var s3652Base = Date.UTC(2026, 4, 20, 0, 0, 0); // 20.05.2026 00:00 UTC
var s3652TsSame = String(Math.floor(Date.UTC(2026, 4, 20, 8, 0, 0) / 1000));   // 20.05 08:00
var s3652Ts10 = String(Math.floor(Date.UTC(2026, 4, 30, 8, 0, 0) / 1000));     // 30.05 08:00 (+10 дней)
assertEqual(planning.dayOffsetFromBase(s3652TsSame, s3652Base), 0, 'dayOffsetFromBase #3652: тот же день → 0');
assertEqual(planning.dayOffsetFromBase(s3652Ts10, s3652Base), 10, 'dayOffsetFromBase #3652: +10 дней (30.05 от 20.05)');
assertEqual(planning.dayOffsetFromBase('', s3652Base), null, 'dayOffsetFromBase #3652: пустая дата → null (без якоря)');
assertEqual(planning.dayOffsetFromBase(String(Math.floor(Date.UTC(2026, 4, 18, 8, 0, 0) / 1000)), s3652Base), -2, 'dayOffsetFromBase #3652: раньше базы → отрицательное');
// buildSchedule с якорем: задание «30.05» (offset 10) встаёт на ДЕНЬ 10, а не под дату «С».
var s3652Sched = planning.buildSchedule([
  { id:'A', plannedRuns:1, planDate:s3652TsSame },
  { id:'B', plannedRuns:1, planDate:s3652Ts10 }
], { windPoints: pts, runLengthByCut: { A:600, B:600 }, shiftStartMin: 480, shiftEndMin: 990,
     times: { BETWEEN_CUTS: 0 }, dayAnchorByCut: { B: 10 } });
assertEqual(Math.floor(s3652Sched[0].startMin / 1440), 0, 'buildSchedule #3652: A (20.05) на дне 0');
assertEqual(Math.floor(s3652Sched[1].startMin / 1440), 10, 'buildSchedule #3652: B (30.05) привязан к дню 10, а не лёг под дату «С»');
var schedPlannedRuns = planning.buildSchedule([
  { id:'C', plannedRuns:3 }
], { windPoints: pts, runLengthByCut: { C:600 }, shiftStartMin: 480 });
// #3688: лидер 2 × 3 резки = 6 теперь в КОНЦЕ (leaderMin), не в сетапе; старт в 08:00 (480).
assertEqual(schedPlannedRuns[0], { cutId:'C', startMin:480, finishMin:492, setupMin:0, durationMin:12, leaderMin:6 },
    'buildSchedule #3688/#3401: лидер × Кол-во план (6) — в конце резки (leaderMin)');
var schedStoredDuration = planning.buildSchedule([
  { id:'D', duration:12.5 }
], { windPoints: pts, runLengthByCut: {}, shiftStartMin: 480 });
assertEqual(schedStoredDuration[0], { cutId:'D', startMin:480, finishMin:492.5, setupMin:0, durationMin:12.5, leaderMin:2 },
    'buildSchedule #3229/#3688: cut_duration fallback; лидер 2 в конце');

// ── #3401/#3688: лидер (BETWEEN_CUTS) × «Кол-во план» — в КОНЦЕ резки (leaderMin), не в сетапе ──
// setupBreakdown ПЕРЕД резкой больше не содержит лидера; для первой без флага/заправки → [].
assertEqual(planning.setupBreakdown(null, { plannedRuns:3 }, null), [],
    'setupBreakdown #3688: первая резка без заправки → [] (лидер 6 — в конце)');
assertEqual(planning.setupBreakdown(toBase, toClone({materialId:'2', plannedRuns:4}), null),
    [{code:'MATERIAL_WINDING', label:'смена сырья / намотки / партии', minutes:15}],
    'setupBreakdown #3688: смена сырья 15 (лидер 8 — в конце)');
assertEqual(planning.setupBreakdown(null, {}, null), [],
    'setupBreakdown #3688: пусто → [] (без prev/флага/заправки)');
// buildSchedule: лидер × «Кол-во план» теперь leaderMin (в конце); setupMin — только переналадка.
var sched3401 = planning.buildSchedule([
  { id:'A', materialId:'1', winding:'IN', batchId:'b', knifeCount:4, knifeWidths:[60], rollerWidth:60, plannedRuns:2 },
  { id:'B', materialId:'2', winding:'IN', batchId:'b', knifeCount:4, knifeWidths:[60], rollerWidth:60, plannedRuns:3 }
], { windPoints: pts, runLengthByCut: { A:600, B:600 }, shiftStartMin: 480 });
// A: старт 08:00 (480); намотка 4 × 2 = 8 → 480–488; лидер 2 × 2 = 4 после (leaderMin).
assertEqual(sched3401[0], { cutId:'A', startMin:480, finishMin:488, setupMin:0, durationMin:8, leaderMin:4 },
    'buildSchedule #3688: A (2 резки) — лидер 4 в конце');
// B: старт = финиш A (488) + лидер A (4) + смена сырья 15 = 507; намотка 12 → 519; лидер 6 после.
assertEqual(sched3401[1], { cutId:'B', startMin:507, finishMin:519, setupMin:15, durationMin:12, leaderMin:6 },
    'buildSchedule #3688: B (3 резки) — переналадка 15 в начале, лидер 6 в конце');
// splitMachineQueue: лидер входит в стоимость прохода (perPass + leader), раскладывается по дням.
var seg3401 = planning.splitMachineQueue([{ id:'A' }],
    { dayStartMin:0, dayEndMin:1000, times:{ BETWEEN_CUTS:3 }, perPassByCut:{ A:10 }, runsByCut:{ A:4 } });
assertEqual(seg3401.map(function(s){ return { c:s.cutId, runs:s.runs, dur:s.durationMin, setup:s.setupMin }; }),
    [{ c:'A', runs:4, dur:52, setup:0 }],
    'splitMachineQueue #3401: 4 прохода × (10 намотка + 3 лидер) = 52 мин');
// Разбиение по дням: каждый проход стоит perPass+leader, поэтому в день влезает меньше проходов.
var segDays3401 = planning.splitMachineQueue([{ id:'A' }],
    { dayStartMin:0, dayEndMin:30, times:{ BETWEEN_CUTS:5 }, perPassByCut:{ A:5 }, runsByCut:{ A:5 } });
assertEqual(segDays3401.map(function(s){ return { day:s.dayOffset, runs:s.runs }; }),
    [{ day:0, runs:3 }, { day:1, runs:2 }],
    'splitMachineQueue #3401: проход = 5+5=10 мин → в окно 30 мин влезает 3 прохода, остаток на след. день');
// #3635 п.5: настройка резки ВЛЕЗАЕТ в хвост дня, а первый проход — нет → отдельный
// сегмент настройки (runs 0, setupOnly) в конце дня N, проходы с дня N+1 (без повторной
// настройки). A заполняет день 0 до 12 мин; B (смена сырья) — переналадка влезает в
// остаток (18 мин), но проход 10 мин после неё уже нет → настройка B в хвосте дня 0.
var segP5 = planning.splitMachineQueue([
  { id:'A', materialId:'1', winding:'IN', knifeWidths:[60], knifeCount:1, plannedRuns:1 },
  { id:'B', materialId:'2', winding:'IN', knifeWidths:[60], knifeCount:1, plannedRuns:2 }
], { dayStartMin:0, dayEndMin:30, times:{ BETWEEN_CUTS:0 }, perPassByCut:{ A:12, B:10 }, runsByCut:{ A:1, B:2 } });
assertEqual(segP5.map(function(s){ return { c:s.cutId, day:s.dayOffset, runs:s.runs, setupOnly:!!s.setupOnly }; }),
  [{ c:'A', day:0, runs:1, setupOnly:false },
   { c:'B', day:0, runs:0, setupOnly:true },
   { c:'B', day:1, runs:2, setupOnly:false }],
  'splitMachineQueue #3635 п.5: настройка B в хвосте дня 0 (отдельный сегмент), проходы B с дня 1');
// #3635 п.5: setupTaskIdSet — голова разбиения «настройка» (0 проходов) опознаётся по
// цепочке (та же подпись продолжения + станок), где есть запись с проходами > 0.
function p5cut(id, mat, runs) {
    return { id: id, slitter: { id: 'm1' }, materialId: mat, winding: 'IN',
        knifeWidths: [60], knifeCount: 1, plannedRuns: runs };
}
assertEqual(planning.setupTaskIdSet([ p5cut('Bset', '2', 0), p5cut('Bcut', '2', 2), p5cut('A', '1', 1) ]),
    { Bset: true },
    'setupTaskIdSet #3635 п.5: 0-проходная голова с продолжением-резкой той же цепочки → настройка');
assertEqual(planning.setupTaskIdSet([ p5cut('X', '9', 0) ]), {},
    'setupTaskIdSet #3635 п.5: одинокая 0-проходная резка (нет резки в цепочке) — НЕ настройка');
assertEqual(planning.setupTaskIdSet([ p5cut('P', '3', 2), p5cut('Q', '3', 3) ]), {},
    'setupTaskIdSet #3635 п.5: цепочка без 0-проходных — пусто');
// #3262: строка показывает ВСЁ окно (setup+резка): старт = startMin−setupMin (08:00),
// длительность = setup(2)+12.5 = 14.5 (диапазон совпадает с числом минут).
// #3262: строка показывает ВСЁ окно (setup+резка): старт = startMin−setupMin (08:00).
// #3635 п.4: минуты окна округляем ВВЕРХ — setup(2)+12.5 = 14.5 → 15 (как диапазон по часам).
assertEqual(planning.formatScheduleLine(schedStoredDuration[0], 0, true),
    '⏱ 08:00 – 08:15 · 15 мин',
    'formatScheduleLine #3262/#3635: окно от начала setup; минуты вверх (14.5 → 15)');
assertEqual(planning.formatScheduleLine({ startMin:482, finishMin:482, durationMin:0 }, 0, true),
    '⏱ ошибка: нет метража прохода; длительность не рассчитана',
    'formatScheduleLine #3229: нулевая длительность без метража отображается как ошибка');
// #3262: пример из тикета — setup 47 мин, резка 12 мин → окно 10:34–11:33 · 59 мин
// (совпадает с первым шагом «Тайминг окна», а не со стартом резки 11:21).
assertEqual(planning.formatScheduleLine({ startMin:681, finishMin:693, setupMin:47, durationMin:12 }, 0, true),
    '⏱ 10:34 – 11:33 · 59 мин',
    'formatScheduleLine #3262: старт окна (10:34) совпадает с таймингом окна, не со стартом резки (11:21)');
assertEqual(planning.formatClock(482), '08:02', 'formatClock: 482 → 08:02');
assertEqual(planning.formatClock(1440 + 90), '01:30', 'formatClock: за сутки → только ЧЧ:ММ без +Nд (#3276)');
assertEqual(planning.formatCutStartTime({ startMin:482 }), '08:02',
    'formatCutStartTime #3236: .atex-pp-cut-num показывает плановый старт ЧЧ:ММ');
assertEqual(planning.formatCutStartTime({ startMin:1440 + 90 }), '01:30',
    'formatCutStartTime #3236: .atex-pp-cut-num остаётся только ЧЧ:ММ без суффикса дня');
assertEqual(planning.formatCutStartTime(null), '—',
    'formatCutStartTime #3236: нет расписания → прочерк');
assertEqual(planning.formatCutWindingLabel({ winding:'OUT', length:1200 }), 'Намотка: OUT',
    'formatCutWindingLabel #3236: .atex-pp-cut-winding не показывает метраж');
assertEqual(planning.formatCutWindingLabel({ winding:'', length:1200 }), 'Намотка: —',
    'formatCutWindingLabel #3236: пустая намотка → прочерк без метража');

// Рабочее окно: резка + её лидер должны влезть до конца окна, иначе перенос на след. день.
// #3688: A стартует в 08:00 (480), намотка 1.2 → 481.2, лидер 2 → 483.2 (≤484, влезает).
// B: старт 483.2, намотка 4 + лидер 2 = 489.2 > 484 → след. день 08:00 (1920–1924).
var schedW = planning.buildSchedule(schedCuts, { windPoints: pts, runLengthByCut: { A:300, B:600 }, shiftStartMin: 480, shiftEndMin: 484 });
assertEqual(schedW[0].startMin, 480, 'buildSchedule(окно) #3688: A в первый день (старт 08:00)');
assertEqual([schedW[1].startMin, schedW[1].finishMin], [1920, 1924], 'buildSchedule(окно) #3688: B (резка+лидер не влезли) → след. день 08:00 (1920–1924)');
assertEqual(planning.SHIFT_END_MIN, 990, 'SHIFT_END_MIN = 16:30 (990)');
assertEqual(planning.parseClockMinutes('8:00', 0), 480, 'parseClockMinutes #3215: 8:00 → 480');
assertEqual(planning.parseClockMinutes('17', 0), 1020, 'parseClockMinutes #3215: 17 → 1020');
assertEqual(planning.parseClockMinutes('мусор', 123), 123, 'parseClockMinutes #3215: мусор → fallback');
var win3215 = planning.resolveWorkingWindow({ DAY_START_HOUR:'8:00', DAY_END_HOUR:'17:00' }, 30);
assertEqual(win3215, { startMin:480, endMin:1020, cutEndMin:990, cleanupMin:30, lunchStartMin:null, lunchDurationMin:0 },
    'resolveWorkingWindow #3215: резки до 16:30, уборка 30 мин до 17:00');
var sched3215 = planning.buildSchedule(schedCuts, {
    windPoints: pts,
    runLengthByCut: { A:300, B:600 },
    shiftStartMin: win3215.startMin,
    shiftEndMin: 484
});
assertEqual(planning.dayCleanups(sched3215, { cleanupMin: win3215.cleanupMin, shiftEndMin: win3215.cutEndMin }), [
    { day:0, startMin:990,  finishMin:1020, durationMin:30 },
    { day:1, startMin:2430, finishMin:2460, durationMin:30 }
], 'dayCleanups #3215: DAY_END_HOUR задаёт конец уборки, не конец резок');
assertEqual(planning.resolveWorkingWindow({ DAY_START_HOUR:'9:15', DAY_END_HOUR:'18:00' }, 45),
    { startMin:555, endMin:1080, cutEndMin:1035, cleanupMin:45, lunchStartMin:null, lunchDurationMin:0 },
    'resolveWorkingWindow #3215: произвольное окно и CLEANUP_SHIFT');

// ── #3562: зафиксированные задания больше не «прикалываются» — buildSchedule пакует встык ──
// Очередь A,B,C по 60 мин, без лидера/переналадки (BETWEEN_CUTS:0): встык 480/540/600.
// B зафиксирована — слот под неё НЕ резервируется (автогенерация двигает её по времени/очереди).
var packCuts3562 = [ { id:'A', duration:60 }, { id:'B', duration:60, fixed:true }, { id:'C', duration:60 } ];
var packOpts3562 = { windPoints: pts, runLengthByCut: {}, times: { BETWEEN_CUTS: 0 }, shiftStartMin: 480 };
assertEqual(planning.buildSchedule(packCuts3562, packOpts3562).map(function(s){ return [s.startMin, s.finishMin]; }),
    [[480,540],[540,600],[600,660]],
    'buildSchedule #3562: зафиксированное B пакуется встык (слот не резервируется)');
// Прежняя опция пинов (#3508 п.6) больше не влияет на расписание — игнорируется.
assertEqual(planning.buildSchedule(packCuts3562, Object.assign({ pinnedStartMinByCut: { B: 580 } }, packOpts3562))
    .map(function(s){ return [s.startMin, s.finishMin]; }),
    [[480,540],[540,600],[600,660]],
    'buildSchedule #3562: опция pinnedStartMinByCut игнорируется (пины убраны)');
// Пин-хелперы удалены из API.
assertEqual(typeof planning.pinnedStartMinByCut, 'undefined', '#3562: pinnedStartMinByCut удалён из API');
assertEqual(typeof planning.pinTimestampSeconds, 'undefined', '#3562: pinTimestampSeconds удалён из API');

// ── #3342: плавающий обед (LUNCH_START / LUNCH_DURATION) ──
var wwLunch = planning.resolveWorkingWindow({ DAY_START_HOUR:'8:00', DAY_END_HOUR:'16:40', LUNCH_START:'12:20', LUNCH_DURATION:'40' }, 30);
assertEqual({ s:wwLunch.startMin, e:wwLunch.cutEndMin, ls:wwLunch.lunchStartMin, ld:wwLunch.lunchDurationMin },
    { s:480, e:970, ls:740, ld:40 }, 'resolveWorkingWindow #3342: LUNCH_START→740, LUNCH_DURATION→40');
assertEqual({ ls:wwLunch.lunchStartMin }, { ls:740 }, 'resolveWorkingWindow #3342: 12:20 → 740 мин');
var wwNoDur = planning.resolveWorkingWindow({ DAY_START_HOUR:'8:00', DAY_END_HOUR:'16:40', LUNCH_START:'12:20' }, 30);
assertEqual({ ls:wwNoDur.lunchStartMin, ld:wwNoDur.lunchDurationMin }, { ls:null, ld:0 },
    'resolveWorkingWindow #3342: без LUNCH_DURATION обед выключен');

// splitMachineQueue: обед-пауза перед резкой, стартующей в/после LUNCH_START; смещает следующие.
var lunchOpts3342 = { dayStartMin:480, dayEndMin:970, leader:0, times:{ BETWEEN_CUTS:0 }, lunchStartMin:740, lunchDurationMin:40 };
var segLunch3342 = planning.splitMachineQueue([{ id:'A' }, { id:'B' }],
    Object.assign({ perPassByCut:{ A:60, B:60 }, runsByCut:{ A:5, B:3 } }, lunchOpts3342));
assertEqual(segLunch3342.map(function(s){ return { c:s.cutId, ws:s.windowStartMin, runs:s.runs, cont:s.isContinuation }; }), [
    { c:'A', ws:480, runs:5, cont:false },   // 08:00–13:00
    { c:'B', ws:820, runs:2, cont:false },   // обед 13:00–13:40 → B с 13:40
    { c:'B', ws:1920, runs:1, cont:true }    // хвост B на след. день 08:00
], 'splitMachineQueue #3342: обед-пауза перед B (13:00→13:40), хвост на след. день');
// Без обеда B стартует сразу после A (13:00 = 780).
var segNoLunch3342 = planning.splitMachineQueue([{ id:'A' }, { id:'B' }],
    { dayStartMin:480, dayEndMin:970, leader:0, times:{ BETWEEN_CUTS:0 }, perPassByCut:{ A:60, B:60 }, runsByCut:{ A:5, B:3 } });
assertEqual(segNoLunch3342[1].windowStartMin, 780, 'splitMachineQueue #3342: без обеда B сразу после A (13:00)');
// Непрерывная резка через обед: день завершается раньше (резерв обеда), остаток — на след. день.
var segCont3342 = planning.splitMachineQueue([{ id:'C' }],
    Object.assign({ perPassByCut:{ C:60 }, runsByCut:{ C:10 } }, lunchOpts3342));
assertEqual(segCont3342.map(function(s){ return { c:s.cutId, runs:s.runs, day:s.dayOffset }; }), [
    { c:'C', runs:7, day:0 },   // резерв обеда: 7 проходов (вместо 8) → день кончается раньше
    { c:'C', runs:3, day:1 }
], 'splitMachineQueue #3342: непрерывная резка через обед — день кончается раньше, остаток на след. день');

// buildSchedule: тот же плавающий обед сдвигает старт резки после LUNCH_START.
var bsLunch3342 = planning.buildSchedule([{ id:'A', duration:300 }, { id:'B', duration:100 }],
    { windPoints:[], times:{ BETWEEN_CUTS:0 }, runLengthByCut:{}, shiftStartMin:480, shiftEndMin:970, lunchStartMin:740, lunchDurationMin:40 });
assertEqual([bsLunch3342[0].startMin, bsLunch3342[0].finishMin], [480, 780], 'buildSchedule #3342: A 08:00–13:00');
assertEqual([bsLunch3342[1].startMin, bsLunch3342[1].finishMin], [820, 920], 'buildSchedule #3342: обед 13:00–13:40 → B 13:40–15:20');

// dayCleanups (#3155): блок уборки CLEANUP_SHIFT в конце каждого рабочего дня с резками.
// schedW: A — день 0 (старт 482), B — день 1 (старт 1922 = 1440+482).
assertEqual(planning.dayCleanups(schedW, { cleanupMin: 30 }), [
    { day:0, startMin:990,  finishMin:1020, durationMin:30 },
    { day:1, startMin:2430, finishMin:2460, durationMin:30 }
], 'dayCleanups: по блоку уборки на каждый рабочий день (конец окна 16:30 + 30 мин)');
// sched: обе резки в день 0 → один блок уборки
assertEqual(planning.dayCleanups(sched, { cleanupMin: 30 }), [
    { day:0, startMin:990, finishMin:1020, durationMin:30 }
], 'dayCleanups: все резки в один день → один блок');
// конец смены и длительность уборки берутся из opts
assertEqual(planning.dayCleanups(sched, { cleanupMin: 15, shiftEndMin: 600 }), [
    { day:0, startMin:600, finishMin:615, durationMin:15 }
], 'dayCleanups: shiftEndMin/cleanupMin из opts');
// дефолты: CLEANUP_SHIFT=30, SHIFT_END_MIN=990
assertEqual(planning.dayCleanups(sched), [
    { day:0, startMin:990, finishMin:1020, durationMin:30 }
], 'dayCleanups: дефолты CLEANUP_SHIFT=30 / SHIFT_END_MIN=990');
// уборка ≤ 0 → нет блоков; пустое расписание → []
assertEqual(planning.dayCleanups(sched, { cleanupMin: 0 }), [], 'dayCleanups: cleanupMin 0 → нет уборки');
assertEqual(planning.dayCleanups([], { cleanupMin: 30 }), [], 'dayCleanups: пустое расписание → []');

// resolveTolerance: допуск вида сырья или дефолт (ideav/crm#3127 — «по умолчанию 20 мм»).
assertEqual(planning.resolveTolerance('', 20), 20, 'resolveTolerance: пусто → дефолт 20');
assertEqual(planning.resolveTolerance(null, 20), 20, 'resolveTolerance: null → дефолт');
assertEqual(planning.resolveTolerance('5', 20), 5, 'resolveTolerance: задано → значение');
assertEqual(planning.resolveTolerance('0', 20), 0, 'resolveTolerance: 0 — это заданное значение, не дефолт');
assertEqual(planning.resolveTolerance('2,5', 20), 2.5, 'resolveTolerance: запятая-десятичный');
assertEqual(planning.resolveTolerance('мусор', 20), 20, 'resolveTolerance: мусор → дефолт');

// fifoBatchesForMaterial (#3120 Фаза 1b): фильтр по материалу + свободный погонный остаток
// (Остаток,м − зарезервировано м² / ширина джамбо).
var gbL = [
    { id:'1', materialId:'M', label:'B1', dateKey:2, remainder:1000, remainderLinear:1000 },
    { id:'2', materialId:'M', label:'B2', dateKey:1, remainder:500, remainderLinear:500 },
    { id:'3', materialId:'X', label:'BX', dateKey:1, remainder:999, remainderLinear:999 },
    { id:'4', materialId:'M', label:'B0', dateKey:0, remainder:999, remainderLinear:999, active:false }
];
assertEqual(planning.fifoBatchesForMaterial(gbL, { '1': 91 }, 'M', 0.91), [
    { id:'1', label:'B1', arrivalKey:2, freeLinearM:900 },
    { id:'2', label:'B2', arrivalKey:1, freeLinearM:500 }
], 'fifoBatchesForMaterial: материал M, свободный остаток (b1: 1000−100=900), неактивные исключены');
assertEqual(planning.fifoBatchesForMaterial(gbL, {}, 'Z', 0.91), [], 'fifoBatchesForMaterial: нет партий материала → []');
// связка с reserveFifo: нужно 700 пог.м → FIFO берёт b2 (приход раньше) 500 + b1 200
var fbReserve = planning.reserveFifo(planning.fifoBatchesForMaterial(gbL, { '1': 91 }, 'M', 0.91), 700, 0.91);
assertEqual([fbReserve.allocations[0].batchId, fbReserve.allocations[1].batchId, fbReserve.fullyReserved], ['2', '1', true], 'fifoBatchesForMaterial → reserveFifo: FIFO по приходу, добор');

// materialByCut (#3120 Фаза 2): материал резки из обеспечиваемых позиций.
var gpM = [{ id:'p1', materialId:'M1' }, { id:'p2', materialId:'M1' }, { id:'p3', materialId:'M2' }];
var supM = [{ cutId:'c1', positionId:'p1' }, { cutId:'c1', positionId:'p2' }, { cutId:'c2', positionId:'p3' }, { cutId:'c3', positionId:'pX' }];
assertEqual(planning.materialByCut([], supM, gpM), { c1:'M1', c2:'M2' }, 'materialByCut: c1→M1 (по позициям), c2→M2, c3 без материала позиции — нет');

// progressPercent (#3148): целый процент 0..100 для окна прогресса генерации резок.
assertEqual(planning.progressPercent(0, 10), 0, 'progressPercent: 0/10 → 0');
assertEqual(planning.progressPercent(5, 10), 50, 'progressPercent: 5/10 → 50');
assertEqual(planning.progressPercent(10, 10), 100, 'progressPercent: 10/10 → 100');
assertEqual(planning.progressPercent(1, 3), 33, 'progressPercent: 1/3 → 33 (округление)');
assertEqual(planning.progressPercent(2, 3), 67, 'progressPercent: 2/3 → 67 (округление)');
assertEqual(planning.progressPercent(0, 0), 0, 'progressPercent: total 0 → 0 (без деления на ноль)');
assertEqual(planning.progressPercent(5, 0), 0, 'progressPercent: total 0 → 0 даже при done>0');
assertEqual(planning.progressPercent(20, 10), 100, 'progressPercent: done>total → клампится до 100');
assertEqual(planning.progressPercent(-3, 10), 0, 'progressPercent: done<0 → клампится до 0');
assertEqual(planning.progressPercent('абв', 10), 0, 'progressPercent: нечисло → 0');

// ── cutClickSelectsCut (#3323, #3354 п.2/п.3) ──
// Клик в любом месте карточки .atex-pp-cut должен выбирать резку (→ «Связанные
// позиции»). #3354 п.2: теперь это касается и кнопок ↑/↓/Полосы — раньше клик по
// ним не обновлял .atex-pp-link (старый дефект). Единственное исключение — клики
// ВНУТРИ панели полос .atex-pp-strip-panel (#3354 п.3): она не сворачивается и не
// меняет выбор ни от каких событий, кроме своего крестика .atex-pp-strip-close.
// Строим минимальное дерево карточки с .closest, как у реального renderQueue.
(function() {
    function dom(tag, className) {
        return {
            tag: String(tag).toUpperCase(),
            className: className || '',
            parent: null,
            child: function(tagName, cls) {
                var c = dom(tagName, cls);
                c.parent = this;
                return c;
            },
            matches: function(sel) {
                if (sel === 'button') return this.tag === 'BUTTON';
                if (sel.charAt(0) === '.') {
                    return (' ' + this.className + ' ').indexOf(' ' + sel.slice(1) + ' ') >= 0;
                }
                return false;
            },
            closest: function(sel) {
                var n = this;
                while (n) { if (n.matches(sel)) return n; n = n.parent; }
                return null;
            }
        };
    }
    // Структура карточки как в renderQueue: card > info(spans), time(div role=button),
    // controls(div > buttons ↑/↓/Полосы), strip-panel(div > input/button).
    var card = dom('div', 'atex-pp-cut is-active');
    var info = card.child('div', 'atex-pp-cut-info');
    var numSpan = info.child('span', 'atex-pp-cut-seq');
    var timeEl = card.child('div', 'atex-pp-cut-time'); // role=button, но это div
    var controls = card.child('div', 'atex-pp-cut-controls');
    var upBtn = controls.child('button', 'atex-pp-move');
    var stripsBtn = controls.child('button', 'atex-pp-strips');
    var stripPanel = card.child('div', 'atex-pp-strip-panel');
    var stripInput = stripPanel.child('input', 'atex-pp-strip-width');

    assertEqual(planning.cutClickSelectsCut(card), true, 'cutClickSelectsCut: клик по телу карточки выбирает резку');
    assertEqual(planning.cutClickSelectsCut(info), true, 'cutClickSelectsCut: клик по .atex-pp-cut-info выбирает резку');
    assertEqual(planning.cutClickSelectsCut(numSpan), true, 'cutClickSelectsCut: клик по span внутри info выбирает резку');
    assertEqual(planning.cutClickSelectsCut(timeEl), true, 'cutClickSelectsCut: клик по строке времени выбирает резку (#3309)');
    assertEqual(planning.cutClickSelectsCut(controls), true, 'cutClickSelectsCut: клик по пустой зоне .atex-pp-cut-controls выбирает резку (#3323)');
    assertEqual(planning.cutClickSelectsCut(upBtn), true, 'cutClickSelectsCut #3354 п.2: клик по кнопке ↑ выбирает резку (обновляет .atex-pp-link)');
    assertEqual(planning.cutClickSelectsCut(stripsBtn), true, 'cutClickSelectsCut #3354 п.2: клик по кнопке «Полосы» выбирает резку');
    assertEqual(planning.cutClickSelectsCut(stripPanel), false, 'cutClickSelectsCut #3354 п.3: клик по панели полос НЕ выбирает резку');
    assertEqual(planning.cutClickSelectsCut(stripInput), false, 'cutClickSelectsCut #3354 п.3: клик по полю внутри панели полос НЕ выбирает резку');
    assertEqual(planning.cutClickSelectsCut(null), true, 'cutClickSelectsCut: пустая цель → по умолчанию выбирает');
})();

// ── Редизайн карточки резки (#3354 п.1) ──
// Первая строка карточки и сводные строки полос строятся чистыми хелперами,
// поэтому их формат проверяется без DOM.
(function() {
    // cutDisplayLength: длина прогона приоритетна, иначе длина резки.
    assertEqual(planning.cutDisplayLength({ length: 200 }, 300), 300,
        'cutDisplayLength #3354: использует длину прогона, если она задана');
    assertEqual(planning.cutDisplayLength({ length: 200 }, 0), 200,
        'cutDisplayLength #3354: откатывается к cut.length при отсутствии длины прогона');
    assertEqual(planning.cutDisplayLength({}, null), 0,
        'cutDisplayLength #3354: нет данных → 0');

    // formatCutDimensions: «{длина} х {количество резок}» (х — кириллическая).
    assertEqual(planning.formatCutDimensions({ plannedRuns: 15, length: 300 }, 300), '300 х 15',
        'formatCutDimensions #3354: длина и количество резок через кириллическую х');
    assertEqual(planning.formatCutDimensions({ plannedRuns: 0 }, 0), '— х —',
        'formatCutDimensions #3354: нет данных → прочерки');

    // cutStripGroups: группировка ножевых ширин по ширине, по убыванию.
    var groups = planning.cutStripGroups({ knifeWidths: [60, 60, 100, 60, 100] });
    assertEqual(groups.length, 2, 'cutStripGroups #3354: две различные ширины');
    assertEqual(groups[0].width, 100, 'cutStripGroups #3354: ширины по убыванию (100 первой)');
    assertEqual(groups[0].count, 2, 'cutStripGroups #3354: count = число полос ширины 100');
    assertEqual(groups[1].width, 60, 'cutStripGroups #3354: вторая ширина 60');
    assertEqual(groups[1].count, 3, 'cutStripGroups #3354: count = число полос ширины 60');
    assertEqual(planning.cutStripGroups({ knifeWidths: [] }).length, 0,
        'cutStripGroups #3354: нет ножевых ширин → пусто');

    // formatStripSummaryLine: точный пример из задачи.
    // «{сырьё} {ширина} x {длина} {намотка} — {факт.ширина}мм х {резок} x {полос} = {мотков} шт.»
    var cut = { materialName: 'MW401', winding: 'OUT', plannedRuns: 15, length: 300 };
    var line = planning.formatStripSummaryLine(cut, { width: 60, count: 10 }, 59, 300);
    assertEqual(line, 'MW401 60 x 300 OUT — 59мм х 15 x 10 = 150 шт.',
        'formatStripSummaryLine #3354: формат и разделители как в примере (мотков = резок × полос)');

    // Без явной фактической ширины используется номинальная.
    var line2 = planning.formatStripSummaryLine(cut, { width: 60, count: 10 }, 0, 300);
    assertEqual(line2, 'MW401 60 x 300 OUT — 60мм х 15 x 10 = 150 шт.',
        'formatStripSummaryLine #3354: при отсутствии факт.ширины берётся номинальная');

    // Сырьё без имени, но с id → «#id»; разделители-х остаются правильными.
    var line3 = planning.formatStripSummaryLine({ materialId: 7, plannedRuns: 2, length: 100 }, { width: 50, count: 4 }, 49, 100);
    assertEqual(line3, '#7 50 x 100 — 49мм х 2 x 4 = 8 шт.',
        'formatStripSummaryLine #3354: без имени сырья → #id, без намотки');
    // Контроль Unicode-разделителей: ширина×длина и полосы — латинская x (0x78),
    // резка — кириллическая х (0x445).
    assertEqual(line.indexOf('х') > 0, true, 'formatStripSummaryLine #3354: содержит кириллическую х (резок)');
    assertEqual((line.match(/x/g) || []).length, 2, 'formatStripSummaryLine #3354: ровно две латинские x (ширина×длина и ×полос)');
})();

// #3408: в сводке полос .atex-pp-strip-row сначала номинал, потом реальные мм.
// Полосы (Партии ГП) хранят ФАКТИЧЕСКУЮ ширину (#3372: p.width = факт.), поэтому
// номинал восстанавливаем обратным резолвом resolveNominalWidth, а факт. выводим в мм.
(function() {
    var idx = planning.buildActualWidthIndex([
        { order: 60, actual: 59, code: '' },
        { order: 100, actual: 98, code: 'j>1000' },   // условное правило по джамбо
        { order: 100, actual: 99, code: '' }          // безусловное для того же номинала
    ]);

    // Прямой и обратный резолв согласованы: 60 → 59 → 60.
    assertEqual(planning.resolveCutWidth(60, {}, idx), 59,
        'resolveNominalWidth #3408: прямой резолв 60 → 59 (контроль)');
    assertEqual(planning.resolveNominalWidth(59, {}, idx), 60,
        'resolveNominalWidth #3408: обратный резолв факт.59 → номинал 60');

    // Нет правила под факт.ширину → возвращаем факт. как есть (ширина не корректировалась).
    assertEqual(planning.resolveNominalWidth(70, {}, idx), 70,
        'resolveNominalWidth #3408: нет совпадения → факт. без изменений');

    // Условное правило: при подходящем контексте приоритетнее безусловного.
    assertEqual(planning.resolveNominalWidth(98, { jumbo: 1200 }, idx), 100,
        'resolveNominalWidth #3408: факт.98 (j>1000) → номинал 100');
    assertEqual(planning.resolveNominalWidth(99, {}, idx), 100,
        'resolveNominalWidth #3408: факт.99 (безусловно) → номинал 100');
    // Условие не выполнено → правило j>1000 пропускается (жёсткий фильтр).
    assertEqual(planning.resolveNominalWidth(98, { jumbo: 500 }, idx), 98,
        'resolveNominalWidth #3408: факт.98 без контекста джамбо → факт. без изменений');

    // Интеграция всего пути: полосы хранят факт.ширину 59 → строка показывает
    // номинал 60 первым, реальные 59мм после тире (точный пример из задачи #3408).
    var cut = { materialName: 'MWR200', winding: 'OUT', plannedRuns: 4, length: 300,
        knifeWidths: [59, 59, 59, 59, 59, 59, 59, 59, 59, 59, 59, 59, 59, 59, 59] };
    var g = planning.cutStripGroups(cut)[0];
    var nominal = planning.resolveNominalWidth(g.width, {}, idx);
    var fullLine = planning.formatStripSummaryLine(cut, { width: nominal, count: g.count }, g.width, 300);
    assertEqual(fullLine, 'MWR200 60 x 300 OUT — 59мм х 4 x 15 = 60 шт.',
        'resolveNominalWidth #3408: сводка полос — сначала номинал 60, потом реальные 59мм');
})();

function req(id, val, extra) {
    var r = { id: id, val: val };
    Object.keys(extra || {}).forEach(function(k) { r[k] = extra[k]; });
    return r;
}

function runPreferredWidthsFilterTest() {
    var controller = Object.create(api.Controller.prototype);
    var paths = [];
    controller.preferredByMaterial = {};
    controller.getJson = function(path) {
        paths.push(path);
        return Promise.resolve([
            { position_width_mm: '25.00', position_qty_sum: '105', wind_dir: 'OUT', wind_length: '600.00' },
            { position_width_mm: '30.00', position_qty_sum: '70', wind_dir: 'OUT', wind_length: '450.00' },
            { position_width_mm: '40.00', position_qty_sum: '35', wind_dir: 'IN', wind_length: '600.00' }
        ]);
    };
    return controller.loadPreferredWidths('2086', 'out', '600.00').then(function(list) {
        assertEqual(paths[0],
            'report/preferable_widths?JSON_KV&FR_position_material_id=2086&FR_wind_dir=OUT&FR_wind_length=600',
            'loadPreferredWidths #3219: фильтрует ходовые по сырью, намотке и метражу');
        assertEqual(list, [{ width: 25, popularity: 105 }],
            'loadPreferredWidths #3221: отбрасывает ходовые с другой намоткой или метражом');
        return controller.loadPreferredWidths('2086', 'OUT', 600).then(function(cached) {
            assertEqual(paths.length, 1,
                'loadPreferredWidths #3219: нормализованный cache key переиспользует ответ');
            assertEqual(cached, [{ width: 25, popularity: 105 }],
                'loadPreferredWidths #3219: повторный вызов берёт кеш');
        });
    });
}

function runGenerateCutsDeferredGpTest() {
    var controller = Object.create(api.Controller.prototype);
    var posts = [];
    controller.meta = {
        cut: { id: '1078', val: 'Производственная резка', reqs: [
            req('1156', 'Слиттер'),
            req('15018', 'Партия сырья'),
            req('16403', 'Кол-во план'),
            req('24308', 'Очередность'),
            req('24305', 'Метраж, м'),
            req('26584', 'Длительность, минут'),
            req('26990', 'Тайминг'),
            req('27172', 'Тип намотки'),
            req('1162', 'Статус')
        ] },
        // #3242: «Обеспечение» ссылается на «Партию ГП» (t15016), не на резку.
        supply: { id: '1077', val: 'Обеспечение', reqs: [
            req('1149', 'Метраж, м'),
            req('1154', 'В работе'),
            req('15016', 'Партия ГП', { ref: '1081' }),
            req('16424', 'Кол-во рулонов')
        ] },
        // #3242: состав резки — «Партия ГП» (подчинённая резке). #3431: «Кол-во полос».
        finishedBatch: { id: '1081', val: 'Партия ГП', reqs: [
            req('1186', 'Ширина, мм'),
            req('70190', 'Кол-во полос'),
            req('1188', 'Кол-во рулонов'),
            req('1189', 'Метраж, м'),
            req('1191', 'Адрес хранения'),
            req('1192', 'В работе'),
            req('27171', 'Штрих-код')
        ] },
        sleeveTask: null
    };
    controller.genPositions = [{ id: 'p1', materialId: 'M', width: 110, qty: 1, length: 1200 }];
    controller.genBatches = [{ id: 'b1', materialId: 'M', dateKey: 20260601, remainder: 1000, active: true }];
    controller.cuts = [];
    controller.slitters = [{ id: '10', label: 'С1', stopMaterialIds: [] }];
    controller.opTimes = opT;
    controller.nowMs = function() { return 1780895994000; };
    controller.setBusy = function() {};
    controller.showProgress = function() {};
    controller.updateProgress = function() {};
    controller.hideProgress = function() {};
    controller.render = function() {};
    controller.reload = function() { return Promise.resolve(); };
    controller.notify = function() {};
    controller.post = function(path, fields) {
        posts.push({ path: path, fields: fields || {} });
        if (path.indexOf('_m_new/1078') === 0) return Promise.resolve({ obj: 'cut-1' });
        return Promise.resolve({ obj: 'obj-' + posts.length });
    };

    var result = controller.runGenerateCuts([{
        mat: 'M',
        windDir: 'OUT',
        windLength: 1200,
        positionsCovered: ['p1'],
        strips: [
            { width: 110, qty: 1, purpose: 'Заказ', positionIds: ['p1'] },
            { width: 55, qty: 2, purpose: 'Склад', toStock: 1, positionIds: [] }
        ]
    }], []);

    if (!result || typeof result.then !== 'function') {
        assertEqual(typeof result, 'Promise', 'runGenerateCuts: returns a Promise for verification');
        return Promise.resolve();
    }

    return result.then(function() {
        var cutPost = posts.filter(function(p) { return p.path.indexOf('_m_new/1078') === 0; })[0];
        assertEqual(cutPost.path, '_m_new/1078?JSON&up=1',
            'runGenerateCuts #3225: _m_new резки не передаёт бессмысленный full=1');
        assertEqual(cutPost.fields.t1078, 1780905600,
            'runGenerateCuts #3280: t1078 = плановое время старта (08:00 дня), а не время создания');
        assertEqual(cutPost.fields.t16403, 1,
            'runGenerateCuts #3215: t16403 пишет Кол-во план');
        assertEqual(cutPost.fields.t24308, 1,
            'runGenerateCuts #3215: t24308 пишет Очередность при создании');
        assertEqual(cutPost.fields.t26584, 6,
            'runGenerateCuts #3223/#3635: t26584 пишет Длительность, минут целой ВВЕРХ (5.9 → 6)');
        assertEqual(cutPost.fields.t26990, planning.cutTimingDetails(1200, 1, opT),
            'runGenerateCuts #3238: t26990 пишет Тайминг с деталями расчёта');
        assertEqual(cutPost.fields.t27172, 'OUT',
            'runGenerateCuts #3266: t27172 пишет Тип намотки Производственной резки');
        // #3242: состав резки создаётся как «Партия ГП» (по ширинам: 110 и 55), не «Полоса».
        var gpPosts = posts.filter(function(p) { return p.path.indexOf('_m_new/1081') === 0; });
        assertEqual(gpPosts.length, 2, 'runGenerateCuts #3242: создаются «Партии ГП» по каждой ширине');
        assertEqual(gpPosts[0].path, '_m_new/1081?JSON&up=cut-1', 'runGenerateCuts #3242: Партия ГП подчинена резке (up=cut)');
        assertEqual({ t1186: gpPosts[0].fields.t1186, t70190: gpPosts[0].fields.t70190, t1188: gpPosts[0].fields.t1188, t1189: gpPosts[0].fields.t1189, t1192: gpPosts[0].fields.t1192 },
            { t1186: 110, t70190: 1, t1188: 1, t1189: 1200, t1192: '1' },
            'runGenerateCuts #3431: Партия ГП пишет Ширину/Кол-во полос/Кол-во рулонов(=полосы×проходов)/Метраж/«В работе»');
        assertEqual(posts.some(function(p) { return p.path.indexOf('_m_new/1073') === 0; }), false,
            'runGenerateCuts #3242: «Полоса» больше не создаётся');
        // #3242: обеспечение ссылается на «Партию ГП» ширины позиции (110 → obj-2), не на резку.
        var supPost = posts.filter(function(p) { return p.path.indexOf('_m_new/1077') === 0; })[0];
        assertEqual(supPost.path, '_m_new/1077?JSON&up=p1', 'runGenerateCuts #3242: обеспечение подчинено позиции заказа');
        assertEqual({ t15016: supPost.fields.t15016, t16424: supPost.fields.t16424, t1149: supPost.fields.t1149, t1154: supPost.fields.t1154 },
            { t15016: 'obj-2', t16424: 1, t1149: 1200, t1154: '1' },
            'runGenerateCuts #3242: обеспечение пишет ссылку на Партию ГП, рулоны, метраж, «В работе»');
    });
}

function runGenerateCutsSlitterAffinityTest() {
    var controller = Object.create(api.Controller.prototype);
    var posts = [];
    controller.meta = {
        cut: { id: '1078', val: 'Производственная резка', reqs: [
            req('1156', 'Слиттер'),
            req('15018', 'Партия сырья'),
            req('16403', 'Кол-во план'),
            req('24308', 'Очередность'),
            req('24305', 'Метраж, м'),
            req('26584', 'Длительность, минут'),
            req('26990', 'Тайминг'),
            req('1162', 'Статус')
        ] },
        // #3242: обеспечение → «Партия ГП»; состав резки — «Партия ГП».
        supply: { id: '1077', val: 'Обеспечение', reqs: [
            req('1149', 'Метраж, м'),
            req('1154', 'В работе'),
            req('15016', 'Партия ГП', { ref: '1081' }),
            req('16424', 'Кол-во рулонов')
        ] },
        finishedBatch: { id: '1081', val: 'Партия ГП', reqs: [
            req('1186', 'Ширина, мм'),
            req('1188', 'Кол-во рулонов'),
            req('1189', 'Метраж, м'),
            req('1192', 'В работе')
        ] },
        sleeveTask: null
    };
    controller.genPositions = [
        { id: 'p1', materialId: 'M', width: 25, qty: 105, length: 600, windDir: 'OUT', windLength: 600 },
        { id: 'p2', materialId: 'M', width: 25, qty: 70, length: 600, windDir: 'OUT', windLength: 600 },
        { id: 'p3', materialId: 'M', width: 25, qty: 35, length: 600, windDir: 'IN', windLength: 600 },
        { id: 'p4', materialId: 'M', width: 25, qty: 35, length: 450, windDir: 'OUT', windLength: 450 }
    ];
    controller.genBatches = [{ id: 'b1', materialId: 'M', dateKey: 20260601, remainder: 999, remainderLinear: 5000, active: true }];
    controller.cuts = [];
    controller.slitters = [{ id: '10', label: 'С1', stopMaterialIds: [] }, { id: '20', label: 'С2', stopMaterialIds: [] }];
    controller.opTimes = opT;
    controller.setBusy = function() {};
    controller.showProgress = function() {};
    controller.updateProgress = function() {};
    controller.hideProgress = function() {};
    controller.render = function() {};
    controller.reload = function() { return Promise.resolve(); };
    controller.notify = function() {};
    controller.post = function(path, fields) {
        posts.push({ path: path, fields: fields || {} });
        if (path.indexOf('_m_new/1078') === 0) return Promise.resolve({ obj: 'cut-' + posts.length });
        return Promise.resolve({ obj: 'obj-' + posts.length });
    };

    return controller.runGenerateCuts([
        { mat: 'M', windDir: 'OUT', windLength: 600, positionsCovered: ['p1'], strips: [{ width: 25, qty: 36, purpose: 'Заказ', positionIds: ['p1'] }] },
        { mat: 'M', windDir: 'OUT', windLength: 600, positionsCovered: ['p2'], strips: [{ width: 25, qty: 36, purpose: 'Заказ', positionIds: ['p2'] }] },
        { mat: 'M', windDir: 'IN', windLength: 600, positionsCovered: ['p3'], strips: [{ width: 25, qty: 36, purpose: 'Заказ', positionIds: ['p3'] }] },
        { mat: 'M', windDir: 'OUT', windLength: 450, positionsCovered: ['p4'], strips: [{ width: 25, qty: 36, purpose: 'Заказ', positionIds: ['p4'] }] }
    ], []).then(function() {
        var slitters = posts.filter(function(p) { return p.path.indexOf('_m_new/1078') === 0; })
            .map(function(p) { return p.fields.t1156; });
        // #3666: все 4 резки режут ОДИН набор ширин ножей (25) → один станок, даже если
        // намотка (IN у p3) и метраж (450 у p4) отличаются. Намотка — не часть конфигурации
        // ножей, поэтому не разносим одинаковый набор ножей по станкам (раньше p3 IN уезжала
        // на станок 20 ради меньшей переналадки, хотя там пришлось бы ставить те же ножи с нуля).
        assertEqual(slitters, ['10', '10', '10', '10'],
            'runGenerateCuts #3268/#3666: один набор ширин ножей — один станок (намотка/метраж не разносят)');
    });
}

function runGenerateCutsSequenceByKnivesTest() {
    var controller = Object.create(api.Controller.prototype);
    var posts = [];
    var cutNo = 0;
    controller.meta = {
        cut: { id: '1078', val: 'Производственная резка', reqs: [
            req('1156', 'Слиттер'),
            req('15018', 'Партия сырья'),
            req('16403', 'Кол-во план'),
            req('24308', 'Очередность'),
            req('24305', 'Метраж, м'),
            req('26584', 'Длительность, минут'),
            req('26990', 'Тайминг'),
            req('1162', 'Статус')
        ] },
        supply: { id: '1077', val: 'Обеспечение', reqs: [
            req('1149', 'Метраж, м'),
            req('1154', 'В работе'),
            req('15016', 'Партия ГП', { ref: '1081' }),
            req('16424', 'Кол-во рулонов')
        ] },
        finishedBatch: { id: '1081', val: 'Партия ГП', reqs: [
            req('1186', 'Ширина, мм'),
            req('1188', 'Кол-во рулонов'),
            req('1189', 'Метраж, м'),
            req('1192', 'В работе')
        ] },
        sleeveTask: null
    };
    controller.genPositions = [
        { id: 'p-few', materialId: 'M', width: 60, qty: 5, length: 600, windDir: 'IN', windLength: 600 },
        { id: 'p-many', materialId: 'M', width: 40, qty: 15, length: 600, windDir: 'IN', windLength: 600 }
    ];
    controller.genBatches = [{ id: 'b1', materialId: 'M', dateKey: 20260601, remainder: 999, remainderLinear: 5000, active: true }];
    controller.cuts = [];
    controller.slitters = [{ id: '20', label: 'Станок 2', stopMaterialIds: [] }];
    controller.opTimes = opT;
    controller.nowMs = function() { return 1780919700000; };
    controller.setBusy = function() {};
    controller.showProgress = function() {};
    controller.updateProgress = function() {};
    controller.hideProgress = function() {};
    controller.render = function() {};
    controller.reload = function() { return Promise.resolve(); };
    controller.notify = function() {};
    controller.post = function(path, fields) {
        posts.push({ path: path, fields: fields || {} });
        if (path.indexOf('_m_new/1078') === 0) {
            cutNo += 1;
            return Promise.resolve({ obj: 'cut-' + cutNo });
        }
        return Promise.resolve({ obj: 'obj-' + posts.length });
    };

    return controller.runGenerateCuts([
        { mat: 'M', windDir: 'IN', windLength: 600, positionsCovered: ['p-few'], strips: [{ width: 60, qty: 5, purpose: 'Заказ', positionIds: ['p-few'] }] },
        { mat: 'M', windDir: 'IN', windLength: 600, positionsCovered: ['p-many'], strips: [{ width: 40, qty: 15, purpose: 'Заказ', positionIds: ['p-many'] }] }
    ], []).then(function() {
        var cutPosts = posts.filter(function(p) { return p.path.indexOf('_m_new/1078') === 0; });
        assertEqual(cutPosts.map(function(p) { return p.fields.t24308; }), [2, 1],
            'runGenerateCuts #3263: новые резки одного станка получают очередь по ножам убыв. (15 раньше 5)');
    });
}

function runGenerateCutsFatigueStrategyTest() {
    var controller = Object.create(api.Controller.prototype);
    var posts = [];
    var cutNo = 0;
    controller.meta = {
        cut: { id: '1078', val: 'Производственная резка', reqs: [
            req('1156', 'Слиттер'),
            req('15018', 'Партия сырья'),
            req('16403', 'Кол-во план'),
            req('24308', 'Очередность'),
            req('24305', 'Метраж, м'),
            req('26584', 'Длительность, минут'),
            req('26990', 'Тайминг'),
            req('1162', 'Статус')
        ] },
        supply: { id: '1077', val: 'Обеспечение', reqs: [
            req('1149', 'Метраж, м'),
            req('1154', 'В работе'),
            req('15016', 'Партия ГП', { ref: '1081' }),
            req('16424', 'Кол-во рулонов')
        ] },
        finishedBatch: { id: '1081', val: 'Партия ГП', reqs: [
            req('1186', 'Ширина, мм'),
            req('1188', 'Кол-во рулонов'),
            req('1189', 'Метраж, м'),
            req('1192', 'В работе')
        ] },
        sleeveTask: null
    };
    controller.genPositions = [
        { id: 'p-wide', materialId: 'A', width: 200, qty: 1, length: 600, windDir: 'IN', windLength: 600 },
        { id: 'p-narrow', materialId: 'A', width: 25, qty: 1, length: 600, windDir: 'IN', windLength: 600 },
        { id: 'p-mid', materialId: 'B', width: 60, qty: 1, length: 600, windDir: 'IN', windLength: 600 }
    ];
    controller.genBatches = [
        { id: 'bA', materialId: 'A', dateKey: 20260601, remainder: 999, remainderLinear: 5000, active: true },
        { id: 'bB', materialId: 'B', dateKey: 20260601, remainder: 999, remainderLinear: 5000, active: true }
    ];
    controller.cuts = [];
    controller.slitters = [{ id: '20', label: 'Станок 2', stopMaterialIds: [] }];
    controller.opTimes = opT;
    controller.changeTimes = opT;
    controller.nowMs = function() { return 1780919700000; };
    controller.setBusy = function() {};
    controller.showProgress = function() {};
    controller.updateProgress = function() {};
    controller.hideProgress = function() {};
    controller.render = function() {};
    controller.reload = function() { return Promise.resolve(); };
    controller.notify = function() {};
    controller.post = function(path, fields) {
        posts.push({ path: path, fields: fields || {} });
        if (path.indexOf('_m_new/1078') === 0) {
            cutNo += 1;
            return Promise.resolve({ obj: 'cut-' + cutNo });
        }
        return Promise.resolve({ obj: 'obj-' + posts.length });
    };

    return controller.runGenerateCuts([
        { mat: 'A', windDir: 'IN', windLength: 600, positionsCovered: ['p-wide'], strips: [{ width: 200, qty: 1, purpose: 'Заказ', positionIds: ['p-wide'] }] },
        { mat: 'A', windDir: 'IN', windLength: 600, positionsCovered: ['p-narrow'], strips: [{ width: 25, qty: 1, purpose: 'Заказ', positionIds: ['p-narrow'] }] },
        { mat: 'B', windDir: 'IN', windLength: 600, positionsCovered: ['p-mid'], strips: [{ width: 60, qty: 1, purpose: 'Заказ', positionIds: ['p-mid'] }] }
    ], [], planning.PLANNING_STRATEGY_FATIGUE).then(function() {
        var cutPosts = posts.filter(function(p) { return p.path.indexOf('_m_new/1078') === 0; });
        assertEqual(cutPosts.map(function(p) { return p.fields.t24308; }), [3, 1, 2],
            'runGenerateCuts #3272: fatigue-вариант пишет очередь «сложные раньше» при создании');
    });
}

function runCreateCutPayloadDiagnosticsTest() {
    var controller = Object.create(api.Controller.prototype);
    var posts = [];
    var notices = [];
    controller.meta = {
        cut: { id: '1078', val: 'Производственная резка', reqs: [
            req('1156', 'Слиттер'),
            req('16403', 'Кол-во план'),
            req('24308', 'Очередность'),
            req('24305', 'Метраж, м'),
            req('1162', 'Статус')
        ] },
        supply: { id: '1077', val: 'Обеспечение', reqs: [] }
    };
    controller.draft = {
        slitterId: '10',
        materialBatchId: '',
        plannedRuns: '2',
        planDate: '',
        status: 'Ожидает',
        notes: '',
        selectedPositions: ['p1']
    };
    controller.cuts = [];
    controller.genPositions = [{ id: 'p1', length: 600 }];
    controller.slitters = [{ id: '10', label: 'С1', stopMaterialIds: [] }];
    controller.opTimes = opT;
    controller.notify = function(msg, type) { notices.push({ msg: msg, type: type }); };
    controller.post = function(path, fields) {
        posts.push({ path: path, fields: fields || {} });
        return Promise.resolve({ obj: 'unexpected' });
    };

    controller.createCut();

    assertEqual(posts.length, 0,
        'createCut #3229: не отправляет резку с неполным payload');
    assertEqual(notices.length, 1,
        'createCut #3229: сообщает пользователю об ошибке payload');
    assertEqual(notices[0].type, 'error',
        'createCut #3229: ошибка payload приходит как error-notify');
    assertEqual(notices[0].msg.indexOf('Длительность, минут') >= 0, true,
        'createCut #3229: ошибка payload называет отсутствующую длительность');
}

function runCreateCutMainValueTest() {
    var controller = Object.create(api.Controller.prototype);
    var posts = [];
    controller.meta = {
        cut: { id: '1078', val: 'Производственная резка', reqs: [
            req('1156', 'Слиттер'),
            req('16403', 'Кол-во план'),
            req('24308', 'Очередность'),
            req('24305', 'Метраж, м'),
            req('26584', 'Длительность, минут'),
            req('1162', 'Статус')
        ] },
        supply: { id: '1077', val: 'Обеспечение', reqs: [] }
    };
    controller.draft = {
        slitterId: '10',
        materialBatchId: '',
        plannedRuns: '2',
        planDate: '',
        status: 'Ожидает',
        notes: '',
        selectedPositions: []
    };
    controller.cuts = [];
    controller.genPositions = [];
    controller.slitters = [{ id: '10', label: 'С1', stopMaterialIds: [] }];
    controller.opTimes = opT;
    controller.nowMs = function() { return 1780895994000; };
    controller.setBusy = function() {};
    controller.closeForm = function() {};
    controller.reload = function() { return Promise.resolve(); };
    controller.post = function(path, fields) {
        posts.push({ path: path, fields: fields || {} });
        return Promise.resolve({ obj: 'cut-manual-1' });
    };

    return new Promise(function(resolve, reject) {
        controller.notify = function(msg, type) {
            if (type === 'error') reject(new Error(msg));
        };
        controller.render = function() {
            try {
                var cutPost = posts.filter(function(p) { return p.path.indexOf('_m_new/1078') === 0; })[0];
                assertEqual(cutPost.path, '_m_new/1078?JSON&up=1',
                    'createCut #3225: _m_new резки не передаёт бессмысленный full=1');
                assertEqual(cutPost.fields.t1078, 1780895994,
                    'createCut #3225: t1078 пишет главное значение Производственной резки');
                resolve();
            } catch (err) {
                reject(err);
            }
        };
        controller.createCut();
    });
}

// #3280: saveSequences пишет очередность И плановое время старта (t1078) одним _m_set.
function runSaveSequencesT1078Test() {
    var controller = Object.create(api.Controller.prototype);
    var posts = [];
    controller.meta = {
        cut: { id: '1078', val: 'Производственная резка', reqs: [
            req('1156', 'Слиттер'),
            req('24308', 'Очередность'),
            req('1162', 'Статус')
        ] }
    };
    controller.setBusy = function() {};
    controller.reload = function() { return Promise.resolve(); };
    controller.render = function() {};
    controller.notify = function() {};
    controller.post = function(path, fields) {
        posts.push({ path: path, fields: fields || {} });
        return Promise.resolve({ obj: 'ok' });
    };
    return controller.saveSequences(
        [{ cutId: 'c1', sequence: 3, planStartTs: 1780992000 }],
        { silent: true }
    ).then(function(ok) {
        assertEqual(ok, true, 'saveSequences: успешное сохранение → true');
        assertEqual(posts.length, 1, 'saveSequences: один _m_set на резку');
        assertEqual(posts[0].path, '_m_set/c1?JSON', 'saveSequences: _m_set по cutId');
        assertEqual(posts[0].fields.t24308, '3', 'saveSequences: пишет очередность t{reqId}');
        assertEqual(posts[0].fields.t1078, '1780992000', 'saveSequences #3280: пишет время старта в t1078 (главное значение)');
    });
}

// #3280: applySplitPlan — update A + create продолжения B (копия Полос + доля Обеспечения) + delete.
function runApplySplitPlanTest() {
    var controller = Object.create(api.Controller.prototype);
    var posts = [];
    controller.meta = {
        cut: { id: '1078', val: 'Производственная резка', reqs: [
            req('1156', 'Слиттер'), req('24308', 'Очередность'), req('1162', 'Статус'),
            req('16403', 'Кол-во резок план'), req('8463', 'Тип намотки'), req('1140', 'Партия сырья')
        ] },
        finishedBatch: { id: '1081', val: 'Партия ГП', reqs: [ req('1112', 'Ширина, мм'), req('1113', 'Кол-во полос'), req('1114', 'Кол-во рулонов'), req('1115', 'Кол-во план'), req('1116', 'Кол-во факт'), req('1117', 'ID заказа') ] },
        supply: { id: '1077', val: 'Обеспечение', reqs: [
            req('1149', 'Метраж, м'), req('16424', 'Кол-во рулонов'), req('15016', 'Партия ГП'), req('1154', 'В работе')
        ] }
    };
    controller.cuts = [{ id: 'A', slitter: { id: 'm1' }, status: 'Запланирована', winding: 'OUT', batchId: '', plannedRuns: 15, number: '999' }];
    controller.supplies = [{ id: 'sup1', cutId: 'A', positionId: 'pos1', finishedBatchId: 'strip1', footage: 1500, rolls: 15 }];
    controller.loadStripsForCut = function() { return Promise.resolve([{ id: 'strip1', width: '100', qty: '2', orderId: '900' }]); };
    controller.setBusy = function() {};
    controller.reload = function() { return Promise.resolve(); };
    controller.render = function() {};
    controller.notify = function() {};
    // #3635 п.3: applySplitPlan теперь показывает прогресс — мокаем заглушками (без DOM).
    controller.showProgress = function() {};
    controller.updateProgress = function() {};
    controller.hideProgress = function() {};
    controller.post = function(path, fields) { posts.push({ path: path, fields: fields || {} }); return Promise.resolve({ obj: 'newB' }); };
    var ops = {
        updates: [{ cutId: 'A', sequence: 1, planStartTs: 1000, plannedRuns: 10 }],
        creates: [{ parentCutId: 'A', sequence: 2, planStartTs: 2000, plannedRuns: 5 }],
        deletes: ['old1']
    };
    function one(p) { return posts.filter(function(x) { return x.path === p; })[0]; }
    return controller.applySplitPlan(ops).then(function(ok) {
        assertEqual(ok, true, 'applySplitPlan → true');
        var saveA = one('_m_save/A?JSON');
        assertEqual(saveA && saveA.fields.t1078, '1000', 'applySplitPlan: A — время старта через _m_save t1078 (DATETIME первая колонка)');
        var setA = one('_m_set/A?JSON');
        assertEqual(setA && setA.fields.t24308, '1', 'applySplitPlan: A — очередность через _m_set');
        assertEqual(setA && setA.fields.t1078, undefined, 'applySplitPlan: A — t1078 НЕ через _m_set (игнорируется сервером)');
        assertEqual(setA && setA.fields.t16403, '10', 'applySplitPlan: A — проходы сегодня (10)');
        var setSup = one('_m_set/sup1?JSON');
        assertEqual(setSup && setSup.fields.t16424, 10, 'applySplitPlan: Обеспечение A уменьшено до 10 рулонов (доля сегодня)');
        // #3433: «Партия ГП» резки A пересчитана под сегмент 0.
        var setStripA = one('_m_set/strip1?JSON');
        assertEqual(setStripA && setStripA.fields.t1115, 20, 'applySplitPlan #3433: A — «Кол-во план» = полосы × проходов A (2×10=20)');
        assertEqual(setStripA && setStripA.fields.t1114, 10, 'applySplitPlan #3433: A — «Кол-во рулонов» = спрос сегмента 0 (10)');
        var newB = one('_m_new/1078?JSON&up=1');
        assertEqual(newB && newB.fields.t1078, 2000, 'applySplitPlan: B — t1078 (старт след. дня)');
        assertEqual(newB && newB.fields.t16403, 5, 'applySplitPlan: B — остаток проходов (5)');
        var newStrip = one('_m_new/1081?JSON&up=newB');
        assertEqual(newStrip && newStrip.fields.t1112, '100', 'applySplitPlan: B — копия Партии ГП (ширина 100)');
        assertEqual(newStrip && newStrip.fields.t1113, '2', 'applySplitPlan #3431: B — «Кол-во полос» за проход (2)');
        assertEqual(newStrip && newStrip.fields.t1115, 10, 'applySplitPlan #3433: B — «Кол-во план» = полосы × проходов сегмента (2×5=10)');
        assertEqual(newStrip && newStrip.fields.t1114, 5, 'applySplitPlan #3433: B — «Кол-во рулонов» = спрос сегмента (5)');
        assertEqual(newStrip && newStrip.fields.t1117, '900', 'applySplitPlan #3433: B — «ID заказа» копируется из родительской полосы');
        var newSup = one('_m_new/1077?JSON&up=pos1');
        assertEqual(newSup && newSup.fields.t16424, 5, 'applySplitPlan: B — Обеспечение 5 рулонов (доля остатка)');
        assertEqual(newSup && newSup.fields.t15016, 'newB', 'applySplitPlan: B — Обеспечение ссылается на скопированную Полосу B');
        assertEqual(posts.filter(function(x) { return x.path.indexOf('_m_del/old1') === 0; }).length, 1, 'applySplitPlan: удалена прежняя запись-продолжение');
    });
}

// ── #3280: splitMachineQueue — разбиение очереди станка по дням на уровне проходов ──
var splitTimes = { BETWEEN_CUTS: 0 };
// 1) Резка целиком влезает в день — один сегмент, без переналадки.
assertEqual(
    planning.splitMachineQueue(
        [{ id: 'c1', plannedRuns: 10 }],
        { dayStartMin: 480, dayEndMin: 990, times: splitTimes, perPassByCut: { c1: 10 } }
    ),
    [{ cutId: 'c1', dayOffset: 0, runs: 10, windowStartMin: 480, startMin: 480, setupMin: 0, durationMin: 100, isContinuation: false, parentCutId: null }],
    'splitMachineQueue: резка целиком в одном дне → один сегмент'
);
// 2) Резка не влезает — обрезается по проходам, остаток продолжается на след. день без setup.
assertEqual(
    planning.splitMachineQueue(
        [{ id: 'c1', plannedRuns: 15 }],
        { dayStartMin: 0, dayEndMin: 100, times: splitTimes, perPassByCut: { c1: 10 } }
    ),
    [
        { cutId: 'c1', dayOffset: 0, runs: 10, windowStartMin: 0, startMin: 0, setupMin: 0, durationMin: 100, isContinuation: false, parentCutId: null },
        { cutId: 'c1', dayOffset: 1, runs: 5, windowStartMin: 1440, startMin: 1440, setupMin: 0, durationMin: 50, isContinuation: true, parentCutId: 'c1' }
    ],
    'splitMachineQueue: перелив дня → продолжение на след. день, setup=0 (ножи остаются)'
);
// 3) #3401: лидер заправляют перед КАЖДОЙ резкой → каждый проход стоит perPass+leader
// (10+5=15). В окно 100 мин влезает 6 проходов (90 мин); хвост 20 проходов — на 4 дня.
assertEqual(
    planning.splitMachineQueue(
        [{ id: 'c1', plannedRuns: 20 }],
        { dayStartMin: 0, dayEndMin: 100, leader: 5, times: splitTimes, perPassByCut: { c1: 10 } }
    ),
    [
        { cutId: 'c1', dayOffset: 0, runs: 6, windowStartMin: 0, startMin: 0, setupMin: 0, durationMin: 90, isContinuation: false, parentCutId: null },
        { cutId: 'c1', dayOffset: 1, runs: 6, windowStartMin: 1440, startMin: 1440, setupMin: 0, durationMin: 90, isContinuation: true, parentCutId: 'c1' },
        { cutId: 'c1', dayOffset: 2, runs: 6, windowStartMin: 2880, startMin: 2880, setupMin: 0, durationMin: 90, isContinuation: true, parentCutId: 'c1' },
        { cutId: 'c1', dayOffset: 3, runs: 2, windowStartMin: 4320, startMin: 4320, setupMin: 0, durationMin: 30, isContinuation: true, parentCutId: 'c1' }
    ],
    'splitMachineQueue #3401: лидер на каждый проход (perPass+leader); хвост по дням, продолжения без setup'
);
// 4) Две одинаковые резки: первая заполняет день, вторая (НЕ продолжение) уходит на день 1.
var splitTwo = planning.splitMachineQueue(
    [
        { id: 'a', materialId: 'm1', winding: 'OUT', knifeWidths: [100], plannedRuns: 10 },
        { id: 'b', materialId: 'm1', winding: 'OUT', knifeWidths: [100], plannedRuns: 5 }
    ],
    { dayStartMin: 0, dayEndMin: 100, times: splitTimes, perPassByCut: { a: 10, b: 10 } }
);
assertEqual(splitTwo.length, 2, 'splitMachineQueue: 2 резки → 2 сегмента');
assertEqual(
    { cutId: splitTwo[1].cutId, dayOffset: splitTwo[1].dayOffset, isContinuation: splitTwo[1].isContinuation, parentCutId: splitTwo[1].parentCutId, windowStartMin: splitTwo[1].windowStartMin },
    { cutId: 'b', dayOffset: 1, isContinuation: false, parentCutId: null, windowStartMin: 1440 },
    'splitMachineQueue: вторая резка — новая (не продолжение), стартует в день 1 в 08:00-эквиваленте'
);
// 5) Резка без проходов/длительности — один сегмент, без раскладки.
assertEqual(
    planning.splitMachineQueue(
        [{ id: 'z', plannedRuns: 0 }],
        { dayStartMin: 480, dayEndMin: 990, times: splitTimes, perPassByCut: {} }
    ),
    [{ cutId: 'z', dayOffset: 0, runs: 0, windowStartMin: 480, startMin: 480, setupMin: 0, durationMin: 0, isContinuation: false, parentCutId: null }],
    'splitMachineQueue: нулевые проходы → один сегмент без разбиения'
);

// ── #3280: scheduleStartTimestamp — минуты расписания → Unix-штамп (секунды) ──
// Полночь 2026-06-09 UTC = 1780963200; 08:00 (+480 мин) = 1780963200 + 480*60 = 1780992000.
assertEqual(planning.scheduleStartTimestamp(1780963200000, 480), 1780992000, 'scheduleStartTimestamp: полночь + 480 мин = 08:00');
assertEqual(planning.scheduleStartTimestamp(1780963200000, 1440), 1781049600, 'scheduleStartTimestamp: +1 сутки');
assertEqual(planning.scheduleStartTimestamp('x', 480), 0, 'scheduleStartTimestamp: мусор → 0');

// ── #3280: planStartTimestamps — плановое время старта резки → штамп для t1078 ──
// windPoints WIND_100=1 мин/проход; c1 10 проходов → старт = начало смены (08:00).
// База: 2026-06-09 00:00 UTC = 1780963200000; 08:00 = +480 мин = 1780992000.
assertEqual(
    planning.planStartTimestamps(
        [{ id: 'c1', slitter: { id: 'm1' }, plannedRuns: 10 }],
        { windPoints: [{ m: 100, min: 1 }], times: { BETWEEN_CUTS: 0 }, dayStartMin: 480, dayEndMin: 990,
          runLengthByCut: { c1: 100 }, planBaseMidnightMs: 1780963200000 }
    ),
    { c1: 1780992000 },
    'planStartTimestamps: первая резка станка стартует в 08:00 → t1078-штамп'
);
var twoTs = planning.planStartTimestamps(
    [
        { id: 'c1', slitter: { id: 'm1' }, materialId: 'x', winding: 'OUT', knifeWidths: [50], plannedRuns: 10 },
        { id: 'c2', slitter: { id: 'm1' }, materialId: 'x', winding: 'OUT', knifeWidths: [50], plannedRuns: 5 }
    ],
    { windPoints: [{ m: 100, min: 1 }], times: { BETWEEN_CUTS: 0 }, dayStartMin: 480, dayEndMin: 990,
      runLengthByCut: { c1: 100, c2: 100 }, planBaseMidnightMs: 1780963200000 }
);
assertEqual(twoTs.c1, 1780992000, 'planStartTimestamps: c1 в 08:00');
assertEqual(twoTs.c2 > twoTs.c1, true, 'planStartTimestamps: c2 стартует позже c1 (последовательно)');

// ── #3280: mergeContinuationChains — слияние записей-продолжений (без маркера) ──
var sigBase = { slitter: { id: 'm1' }, materialId: 'x', winding: 'OUT', knifeWidths: [50] };
function withSig(id, planDate, runs) {
    return { id: id, slitter: sigBase.slitter, materialId: sigBase.materialId, winding: sigBase.winding, knifeWidths: sigBase.knifeWidths, plannedRuns: runs, planDate: planDate };
}
// Смежные дни (06-09 и 06-10) + одна сигнатура → одна логическая резка, продолжение в deletes.
var mc = planning.mergeContinuationChains([withSig('c1', '1780963200', 10), withSig('c2', '1781049600', 5)]);
assertEqual(mc.cuts.length, 1, 'mergeContinuationChains: смежные дни → одна логическая резка');
assertEqual({ id: mc.cuts[0].id, runs: mc.cuts[0].plannedRuns }, { id: 'c1', runs: 15 }, 'mergeContinuationChains: выживает ранняя, проходы суммируются');
assertEqual(mc.deletes, ['c2'], 'mergeContinuationChains: продолжение → в deletes');
// Несмежные дни (06-09 и 06-12) → НЕ сливаем.
var mc2 = planning.mergeContinuationChains([withSig('c1', '1780963200', 10), withSig('c2', '1781222400', 5)]);
assertEqual(mc2.cuts.length, 2, 'mergeContinuationChains: несмежные дни → не сливаем');
assertEqual(mc2.deletes, [], 'mergeContinuationChains: несмежные → нет удалений');

// ── #3280: planCutOperations — overflow-резка → update первого сегмента + create продолжения ──
var ops = planning.planCutOperations(
    [withSig('c1', '1780963200', 15)],
    { perPassByCut: { c1: 10 }, dayStartMin: 0, dayEndMin: 100, times: { BETWEEN_CUTS: 0 }, planBaseMidnightMs: 1780963200000 }
);
assertEqual(ops.updates, [{ cutId: 'c1', sequence: 1, planStartTs: 1780963200, plannedRuns: 10 }], 'planCutOperations: первый сегмент → update существующей записи (10 проходов сегодня)');
assertEqual(ops.creates, [{ parentCutId: 'c1', sequence: 2, planStartTs: 1781049600, plannedRuns: 5 }], 'planCutOperations: остаток → create продолжения на след. день (5 проходов)');
assertEqual(ops.deletes, [], 'planCutOperations: нет прежних продолжений → нет удалений');

// ── #3421: «Сгенерировать резки» пересобирает СОХРАНЁННУЮ очередь существующих резок ──
// Это ядро autoSequenceQueue: planCutOperations по умолчанию (SETUP) на трёх резках
// станко-дня, сохранённых старой генерацией по возрастанию (6,16,16), возвращает
// updates в порядке 16,16,6 — без перегенерации резок (нужно для уже «застрявших»).
function cut3421(id, knifeWidths, runs) {
    return { id: id, slitter: { id: 'm3' }, materialId: id === 'B' ? 'MR194' : 'MW308',
        winding: 'OUT', knifeWidths: knifeWidths, knifeCount: knifeWidths.length,
        plannedRuns: runs, planDate: '1780963200' };
}
function w3421(pairs) { var o = []; pairs.forEach(function(pr) { for (var i = 0; i < pr[1]; i++) o.push(pr[0]); }); return o; }
var ops3421 = planning.planCutOperations(
    [ cut3421('A', w3421([[152, 5], [110, 1]]), 1),   // 6 ножей, MW308
      cut3421('C', w3421([[59, 14], [30, 2]]), 1),    // 16 ножей, MW308
      cut3421('B', w3421([[59, 14], [30, 2]]), 1) ],  // 16 ножей, MR194
    { perPassByCut: { A: 10, B: 10, C: 10 }, dayStartMin: 0, dayEndMin: 10000,
      times: { BETWEEN_CUTS: 0 }, planBaseMidnightMs: 1780963200000 }
);
assertEqual(ops3421.updates.slice().sort(function(a, b) { return a.sequence - b.sequence; }).map(function(u) { return u.cutId; }),
    ['B', 'C', 'A'], 'planCutOperations #3421: пересборка переставляет 6,16,16 → 16,16,6 (ножи убывают)');
assertEqual(ops3421.creates, [], 'planCutOperations #3421: один день, без переноса');
assertEqual(ops3421.deletes, [], 'planCutOperations #3421: без удалений');

// ── #3635 п.1/п.2: preserveOrder сортирует ДЕНЬ-первым, затем по «Очередности» ──
// «Очередность» сбрасывается на каждый день; сортировка ТОЛЬКО по ней перемешивала дни:
// задание дня D+1 (очередь 1) вставало перед фольгой дня D (очередь 2), фольга всплывала
// в начало дня и ломала порядок ножей (#1), а вид после генерации расходился с видом
// после перезагрузки, где groupBySlitter сортирует день-первым (#2).
function cut3635(id, dayTs, seq, isFoil) {
    // materialId уникален у каждой резки — иначе mergeContinuationChains (#3280) сольёт их
    // как сегменты одной логической резки (одинаковая «подпись продолжения»).
    return { id: id, slitter: { id: 'm5' }, materialId: 'mat-' + id, winding: 'OUT',
        knifeWidths: [100], knifeCount: 1, plannedRuns: 1, isFoil: !!isFoil,
        sequence: seq, planDate: String(dayTs) };
}
var d1ts = 1780963200, d2ts = 1780963200 + 86400;
var ops3635 = planning.planCutOperations(
    // вход намеренно перемешан по дням (как могло прийти из groupBySlitter до фикса)
    [ cut3635('d2a', d2ts, 1, false), cut3635('d1foil', d1ts, 2, true),
      cut3635('d1a', d1ts, 1, false), cut3635('d2b', d2ts, 2, false) ],
    { preserveOrder: true, perPassByCut: { d2a: 1, d1foil: 1, d1a: 1, d2b: 1 },
      dayStartMin: 0, dayEndMin: 10000, times: { BETWEEN_CUTS: 0 }, planBaseMidnightMs: d1ts * 1000 }
);
assertEqual(
    ops3635.updates.slice().sort(function(a, b) { return a.sequence - b.sequence; }).map(function(u) { return u.cutId; }),
    ['d1a', 'd1foil', 'd2a', 'd2b'],
    'planCutOperations #3635: preserveOrder день-первым — день1 (вкл. фольгу очередь 2) ПЕРЕД днём2, без перемешивания');

// ── #3658: автозаполнение дней НЕ утаскивает историю в выбранную дату (якорь по «Дате план») ──
// База = 4.06 (день фильтра «С»). Задание 30.05 (раньше базы) должно остаться на 30.05,
// а не переехать в 4.06; новое задание 4.06 — на 4.06. Якорь может быть отрицательным.
function cut3658(id, mat, ts) {
    return { id: id, slitter: { id: 'm1' }, materialId: mat, winding: 'IN',
        knifeWidths: [60], knifeCount: 1, plannedRuns: 1, planDate: ts };
}
var b3658 = Date.UTC(2026, 5, 4, 0, 0, 0); // 4.06.2026 00:00 UTC
var ts3658May30 = String(Math.floor(Date.UTC(2026, 4, 30, 8, 0, 0) / 1000));
var ts3658Jun4 = String(Math.floor(Date.UTC(2026, 5, 4, 8, 0, 0) / 1000));
var anchor3658 = {
    may30: planning.dayOffsetFromBase(ts3658May30, b3658),
    jun4: planning.dayOffsetFromBase(ts3658Jun4, b3658)
};
assertEqual(anchor3658, { may30: -5, jun4: 0 }, 'dayOffsetFromBase #3658: 30.05 от базы 4.06 = −5 (раньше базы)');
var ops3658 = planning.planCutOperations(
    [ cut3658('may30', '1', ts3658May30), cut3658('jun4', '2', ts3658Jun4) ],
    { preserveOrder: true, planBaseMidnightMs: b3658, dayAnchorByCut: anchor3658,
      perPassByCut: { may30: 5, jun4: 5 }, dayStartMin: 480, dayEndMin: 990, times: { BETWEEN_CUTS: 0 } }
);
var u3658 = {}; ops3658.updates.forEach(function(u) { u3658[u.cutId] = u.planStartTs; });
assertEqual(u3658.may30, Math.floor(Date.UTC(2026, 4, 30, 8, 0, 0) / 1000),
    'planCutOperations #3658: задание 30.05 осталось на 30.05 08:00 (не уехало в 4.06)');
assertEqual(u3658.jun4, Math.floor(Date.UTC(2026, 5, 4, 8, 0, 0) / 1000),
    'planCutOperations #3658: задание 4.06 — на 4.06 08:00');

// ── #3660: scope — перепланируем ТОЛЬКО выбранный диапазон дат, не лезем в чужие даты ──
// Генерация на 31.05 (scope [31.05;31.05]) не должна трогать задание 5.06.
var ts3660May31 = String(Math.floor(Date.UTC(2026, 4, 31, 8, 0, 0) / 1000));
var ts3660Jun5 = String(Math.floor(Date.UTC(2026, 5, 5, 8, 0, 0) / 1000));
var b3660 = Date.UTC(2026, 4, 31, 0, 0, 0);
var ops3660 = planning.planCutOperations(
    [ cut3658('m31', '1', ts3660May31), cut3658('j5', '2', ts3660Jun5) ],
    { preserveOrder: true, planBaseMidnightMs: b3660,
      dayAnchorByCut: { m31: planning.dayOffsetFromBase(ts3660May31, b3660), j5: planning.dayOffsetFromBase(ts3660Jun5, b3660) },
      perPassByCut: { m31: 5, j5: 5 }, dayStartMin: 480, dayEndMin: 990, times: { BETWEEN_CUTS: 0 },
      scopeFromKey: planning.planDateDayKey('2026-05-31'), scopeToKey: planning.planDateDayKey('2026-05-31') }
);
assertEqual(ops3660.updates.map(function(u) { return u.cutId; }), ['m31'],
    'planCutOperations #3660: scope 31.05 — в ops только 31.05, задание 5.06 НЕ трогаем');
assertEqual(ops3660.creates.length === 0 && ops3660.deletes.length === 0, true,
    'planCutOperations #3660: вне scope — без creates/deletes (будущее не перепланируется)');
// Без scope (оба null) — обрабатываем оба (обратная совместимость).
var ops3660all = planning.planCutOperations(
    [ cut3658('m31', '1', ts3660May31), cut3658('j5', '2', ts3660Jun5) ],
    { preserveOrder: true, planBaseMidnightMs: b3660,
      dayAnchorByCut: { m31: 0, j5: 5 }, perPassByCut: { m31: 5, j5: 5 },
      dayStartMin: 480, dayEndMin: 990, times: { BETWEEN_CUTS: 0 } }
);
assertEqual(ops3660all.updates.map(function(u) { return u.cutId; }).sort(), ['j5', 'm31'],
    'planCutOperations #3660: без scope — обрабатываем оба (совместимость)');

// ── #3427: повторная раскладка УЖЕ разбитой цепочки идемпотентна ───────────────
// Цепочка [A(день0, 10 проходов) → B(день1, 5 проходов)] уже разбита по дням.
// Повторный planCutOperations должен ПЕРЕИСПОЛЬЗОВАТЬ запись B как update (а не
// удалить B и создать новое продолжение) — тогда autoSequenceQueue отфильтрует
// неизменившиеся update'ы и не сделает ни одной записи (нет churn, обеспечение не
// делится повторно). Прежняя версия всегда давала creates=[B'] + deletes=[B].
var ops3427 = planning.planCutOperations(
    [withSig('A', '1780963200', 10), withSig('B', '1781049600', 5)],
    { perPassByCut: { A: 10, B: 10 }, dayStartMin: 0, dayEndMin: 100,
      times: { BETWEEN_CUTS: 0 }, planBaseMidnightMs: 1780963200000 }
);
assertEqual(ops3427.updates,
    [ { cutId: 'A', sequence: 1, planStartTs: 1780963200, plannedRuns: 10 },
      { cutId: 'B', sequence: 2, planStartTs: 1781049600, plannedRuns: 5 } ],
    'planCutOperations #3427: оба сегмента → update существующих записей цепочки (B переиспользована)');
assertEqual(ops3427.creates, [], 'planCutOperations #3427: продолжение не пересоздаётся');
assertEqual(ops3427.deletes, [], 'planCutOperations #3427: запись B не удаляется');

// #3427: если раскладка изменилась и сегментов стало БОЛЬШЕ записей в цепочке —
// первые сегменты переиспользуют записи, лишний сегмент создаётся.
var ops3427grow = planning.planCutOperations(
    [withSig('A', '1780963200', 25)],   // одна запись, но 25 проходов не влезают в 2 дня по 10
    { perPassByCut: { A: 10 }, dayStartMin: 0, dayEndMin: 100,
      times: { BETWEEN_CUTS: 0 }, planBaseMidnightMs: 1780963200000 }
);
assertEqual(ops3427grow.updates, [{ cutId: 'A', sequence: 1, planStartTs: 1780963200, plannedRuns: 10 }],
    'planCutOperations #3427 (рост): голова — update');
assertEqual(ops3427grow.creates.length, 2, 'planCutOperations #3427 (рост): 2 продолжения создаются (записей цепочки нет)');
assertEqual(ops3427grow.deletes, [], 'planCutOperations #3427 (рост): без удалений');

// #3427: если сегментов стало МЕНЬШЕ записей в цепочке — лишние записи удаляются.
// Цепочка [A,B,C] на станке, но теперь всё влезает в один сегмент (день вмещает всё).
var ops3427shrink = planning.planCutOperations(
    [withSig('A', '1780963200', 3), withSig('B', '1781049600', 3), withSig('C', '1781136000', 3)],
    { perPassByCut: { A: 10, B: 10, C: 10 }, dayStartMin: 0, dayEndMin: 10000,
      times: { BETWEEN_CUTS: 0 }, planBaseMidnightMs: 1780963200000 }
);
assertEqual(ops3427shrink.updates, [{ cutId: 'A', sequence: 1, planStartTs: 1780963200, plannedRuns: 9 }],
    'planCutOperations #3427 (сжатие): один сегмент → update головы (9 проходов)');
assertEqual(ops3427shrink.creates, [], 'planCutOperations #3427 (сжатие): без создания');
assertEqual(ops3427shrink.deletes, ['B', 'C'], 'planCutOperations #3427 (сжатие): лишние записи B,C удаляются');

// ── #3280: splitSupplyShares — деление Обеспечения по проходам (рулоны целые) ──
assertEqual(planning.splitSupplyShares(15, 1500, [10, 5]), [{ rolls: 10, footage: 1000 }, { rolls: 5, footage: 500 }], 'splitSupplyShares: 15 рулонов / 1500 м по 10:5 → 10/1000 и 5/500');
assertEqual(planning.splitSupplyShares(10, 90, [1, 1, 1]), [{ rolls: 4, footage: 30 }, { rolls: 3, footage: 30 }, { rolls: 3, footage: 30 }], 'splitSupplyShares: остаток рулона по наибольшей дробной части; сумма = 10');
assertEqual(planning.splitSupplyShares(7, 700, []), [], 'splitSupplyShares: нет сегментов → []');
assertEqual(planning.splitSupplyShares(7, 700, [0, 0]), [{ rolls: 7, footage: 700 }, { rolls: 0, footage: 0 }], 'splitSupplyShares: нулевые проходы → всё в сегмент 0');

// #3457: generateCuts перезапрашивает позиции (loadPositions сбрасывает genPositions к
// НОМИНАЛЬНОЙ ширине заказа). Раньше фактическая ширина резки (#3372, справочник 66190)
// терялась, т.к. annotatePositionsCutWidth вызывался только в start(). Проверяем, что к
// моменту планирования (planAndConfirmCuts) ширина уже фактическая (60 → 59).
function runGenerateCutsReannotatesActualWidthTest() {
    var prevWindow = global.window;
    global.window = { AtexCutLayout: { layout: { planLayouts: function() {} } } };
    var controller = Object.create(api.Controller.prototype);
    controller.meta = { cut: {}, supply: {}, finishedBatch: {} };
    controller.actualWidthIndex = planning.buildActualWidthIndex([{ order: 60, actual: 59, code: '' }]);
    controller.jumboWidthByMaterial = {};
    controller.sleeveInchesById = {};
    controller.setGenBusy = function() {};
    controller.render = function() {};
    controller.reload = function() { return Promise.resolve(); };
    // Как настоящий loadPositions: пересоздаёт genPositions с НОМИНАЛЬНОЙ шириной заказа.
    controller.loadPositions = function() {
        controller.genPositions = [{ id: 'p1', materialId: 'M', width: 60, qty: 1 }];
        return Promise.resolve();
    };
    var widthsAtPlanning = null;
    controller.planAndConfirmCuts = function() {
        widthsAtPlanning = controller.genPositions.map(function(p) {
            return { width: p.width, orderWidth: p.orderWidth };
        });
    };
    controller.generateCuts({ querySelector: function() { return null; } });
    return new Promise(function(resolve) { setTimeout(resolve, 0); }).then(function() {
        assertEqual(widthsAtPlanning, [{ width: 59, orderWidth: 60 }],
            'generateCuts #3457: после перезапроса позиций фактическая ширина (60→59) проставлена до планирования');
        global.window = prevWindow;
    });
}

runSaveSequencesT1078Test()
    .then(runApplySplitPlanTest)
    .then(runPreferredWidthsFilterTest)
    .then(runGenerateCutsDeferredGpTest)
    .then(runGenerateCutsSlitterAffinityTest)
    .then(runGenerateCutsSequenceByKnivesTest)
    .then(runGenerateCutsFatigueStrategyTest)
    .then(runCreateCutPayloadDiagnosticsTest)
    .then(runCreateCutMainValueTest)
    .then(runGenerateCutsReannotatesActualWidthTest)
    .then(function() {
    console.log('\n' + passed + ' assertions passed');
}).catch(function(err) {
    console.error(err && err.stack || err);
    process.exitCode = 1;
});
