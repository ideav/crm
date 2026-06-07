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
var reportRows = [
    { cut_id: '10', cut_no: '1', cut_slitter: 'Станок 1', cut_slitter_id: '101',
      cut_type: '99мм×9', cut_material_batch: 'НК-0400', cut_plan_date: '06.05.2026',
      cut_status: 'В работе', supply_id: '900', supply_position_id: '700' },
    { cut_id: '10', cut_no: '1', cut_slitter: 'Станок 1', cut_slitter_id: '101',
      cut_type: '99мм×9', cut_material_batch: 'НК-0400', cut_plan_date: '06.05.2026',
      cut_status: 'В работе', supply_id: '901', supply_position_id: '701' },
    { cut_id: '20', cut_no: '2', cut_slitter: '', cut_slitter_id: '',
      cut_type: '25мм×35', cut_material_batch: 'НК-0118', cut_plan_date: '27.05.2026',
      cut_status: 'Ожидает', supply_id: '', supply_position_id: '' }
];
var plan = planning.rowsToPlanning(reportRows);
assertEqual(plan.cuts, [
    { id: '10', number: '1', slitter: { id: '101', label: 'Станок 1' },
      materialBatch: { id: null, label: 'НК-0400' },
      planDate: '06.05.2026', status: 'В работе', sequence: null,
      materialId: '', materialName: '', batchId: '',
      jumboRemainingM: 0, knifeCount: 0, knifeWidths: [], winding: '', rollerWidth: 0, length: 0, isFoil: false,
      orderId: '', orderApprovalDate: '' },
    { id: '20', number: '2', slitter: { id: null, label: '' },
      materialBatch: { id: null, label: 'НК-0118' },
      planDate: '27.05.2026', status: 'Ожидает', sequence: null,
      materialId: '', materialName: '', batchId: '',
      jumboRemainingM: 0, knifeCount: 0, knifeWidths: [], winding: '', rollerWidth: 0, length: 0, isFoil: false,
      orderId: '', orderApprovalDate: '' }
], 'rowsToPlanning dedups cuts by cut_id, slitter без id → {id:null}');
assertEqual(plan.supplies, [
    { id: '900', positionId: '700', cutId: '10', footage: 0, rolls: 0 },
    { id: '901', positionId: '701', cutId: '10', footage: 0, rolls: 0 }
], 'rowsToPlanning collects supplies from rows with supply_id, skips empty');
assertEqual(planning.rowsToPlanning([]).cuts.length, 0, 'rowsToPlanning empty input → no cuts');
// сценарий показа: группировка + счётчик связей поверх результата rowsToPlanning
assertEqual(planning.groupBySlitter(plan.cuts).map(function(g) { return g.slitter.label; }),
    ['Станок 1', 'Без станка'], 'groupBySlitter over rowsToPlanning cuts');

// #3209: новая модель cut_planning отдаёт cut_no как штамп времени, а метраж
// резки/обеспечения отдельными колонками. Существующая резка должна попадать в
// пульт даже без старой order_approval_date: отчёт уже является источником очереди.
var issue3209Rows = [
    { cut_id: '23316', cut_no: '1780837651', cut_slitter: 'Станок 1', cut_slitter_id: '1277',
      cut_plan_date: '', cut_status: '', supply_id: '23352', supply_position_id: '21101',
      cut_sequence: '1', cut_material: 'MR194', cut_jumbo_remaining: '13260.00',
      cut_winding: 'OUT', cut_roller_width: '60.00', cut_material_id: '2086',
      order_approval_date: '', order_id: '17990', supply_footage: '800', supply_rolls: '6',
      cut_length: '1200' },
    { cut_id: '23316', cut_no: '1780837651', cut_slitter: 'Станок 1', cut_slitter_id: '1277',
      cut_plan_date: '', cut_status: '', supply_id: '23353', supply_position_id: '21102',
      cut_sequence: '1', cut_material: 'MR194', cut_jumbo_remaining: '13260.00',
      cut_winding: 'OUT', cut_roller_width: '60.00', cut_material_id: '2086',
      order_approval_date: '', order_id: '17990', supply_footage: '600', supply_rolls: '3',
      cut_length: '1200' },
    { cut_id: '23370', cut_no: '1780837653', cut_slitter: 'Станок 2', cut_slitter_id: '1279',
      cut_plan_date: '', cut_status: '', supply_id: '', supply_position_id: '',
      cut_sequence: '2', cut_material: 'MR194', cut_material_id: '2086',
      order_approval_date: '', order_id: '17991', cut_length: '700' }
];
var issue3209Plan = planning.rowsToPlanning(issue3209Rows);
assertEqual(issue3209Plan.cuts.map(function(cut) {
    return { id: cut.id, number: cut.number, length: cut.length, visible: planning.isCutVisible(cut, '') };
}), [
    { id: '23316', number: '1780837651', length: 1200, visible: true },
    { id: '23370', number: '1780837653', length: 700, visible: true }
], 'rowsToPlanning #3209: timestamp cut_no, cut_length, and blank approval still produce visible cuts');
assertEqual(issue3209Plan.supplies, [
    { id: '23352', positionId: '21101', cutId: '23316', footage: 800, rolls: 6 },
    { id: '23353', positionId: '21102', cutId: '23316', footage: 600, rolls: 3 }
], 'rowsToPlanning #3209: carries supply footage and roll count from report rows');
assertEqual(planning.cutRunLength(issue3209Plan.cuts[0], issue3209Plan.supplies, {}), 1200,
    'cutRunLength #3209: cut_length is available as run-length fallback');
assertEqual(planning.supplyFootage(issue3209Plan.supplies[0], { '23352': 0 }), 800,
    'supplyFootage #3209: direct report footage wins over empty object fallback');
assertEqual(planning.cutRunLength({ id: 'c1', length: 0 }, [{ id: 's1', cutId: 'c1', footage: 0 }], { s1: 500 }), 500,
    'cutRunLength #3209: object footage remains fallback when report row has no footage');

// ── rowsToPositions: строки positions_list (JSON_KV) → [{id,label}] для дропдауна ──
var posRows = [
    { position_id: '8207', order_no: 'АТХ-3002', position_no: '1', position_width: '25.00', position_qty: '70' },
    { position_id: '8300', order_no: 'АТХ-3002', position_no: '2', position_width: '110.00', position_qty: '5' }
];
assertEqual(planning.rowsToPositions(posRows), [
    { id: '8207', label: 'АТХ-3002/1 · 25.00 мм' },
    { id: '8300', label: 'АТХ-3002/2 · 110.00 мм' }
], 'rowsToPositions: «<№заказа>/<№позиции> · <ширина> мм» (#3116 п.3)');
assertEqual(planning.rowsToPositions([{ position_id: '9', order_no: 'АТХ-7', position_no: '3', position_width: '' }]),
    [{ id: '9', label: 'АТХ-7/3' }], 'rowsToPositions: без ширины — заказ/позиция');
assertEqual(planning.rowsToPositions([{ position_id: '9', position_no: '3', position_width: '25.00' }]),
    [{ id: '9', label: '№3 · 25.00 мм' }], 'rowsToPositions: нет order_no (старый отчёт) — деградация до №<номер>');
assertEqual(planning.rowsToPositions([]), [], 'rowsToPositions: пустой ввод → пустой список');

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
assertEqual(g.cuts.map(function(c){return c.id;}), ['2','4','1','3'], 'сорт по sequence (возр), равные стабильно, пустые в конец');
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
// changeoverCost в минутах: сырьё/намотка/партия → MATERIAL_WINDING(15); ножи/сужение ролика → KNIFE(30)
var base = { materialId:'1', winding:'IN', batchId:'b1', jumboRemainingM:0, knifeCount:4, knifeWidths:[60,60,60,60], rollerWidth:60 };
function clone(o,patch){ var c={}; for(var k in o) c[k]=o[k]; for(var k in (patch||{})) c[k]=patch[k]; return c; }
assertEqual(planning.changeoverCost(base, clone(base), null), 0, 'cost: идентичные → 0');
assertEqual(planning.changeoverCost(base, clone(base,{materialId:'2'}), null), 15, 'cost: смена сырья = 15');
assertEqual(planning.changeoverCost(base, clone(base,{winding:'OUT'}), null), 15, 'cost: смена намотки = 15 (та же операция)');
assertEqual(planning.changeoverCost(base, clone(base,{batchId:'b2'}), null), 15, 'cost: смена партии = смена сырья = 15');
assertEqual(planning.changeoverCost(base, clone(base,{knifeCount:20, knifeWidths:[20,20,20]}), null), 30, 'cost: смена ножей = 30');
assertEqual(planning.changeoverCost(base, clone(base,{rollerWidth:40}), null), 30, 'cost: сужение ролика = смена ножей = 30');
assertEqual(planning.changeoverCost(base, clone(base,{materialId:'2', knifeCount:20, knifeWidths:[20,20,20]}), null), 45, 'cost: сырьё+ножи = 15+30 = 45');
assertEqual(planning.changeoverCost(base, clone(base,{materialId:'2'}), { MATERIAL_WINDING:7, KNIFE:99 }), 7, 'cost: времена берутся из переданной таблицы');

// ── orderCuts: жадное упорядочивание, Фольга в конец, настройка весов ──
function cut(id,o){ return { id:id, materialId:o.m, winding:o.w||'IN', batchId:o.b||('B'+id), jumboRemainingM:o.r==null?0:o.r, knifeCount:o.k||4, knifeWidths:o.kw||[60], isFoil:!!o.foil, rollerWidth:o.rw||60 }; }
// группировка по сырью (минутная модель): резки одного сырья делят партию → переход
// внутри сырья стоит 0, между сырьём = 15 → материалы не чередуются.
var inMat = [ cut('1',{m:'A',b:'bA'}), cut('2',{m:'B',b:'bB'}), cut('3',{m:'A',b:'bA'}), cut('4',{m:'B',b:'bB'}) ];
var outMat = planning.orderCuts(inMat).map(function(c){return c.materialId;});
// число границ смены сырья = (различных − 1) = 1
var bnd = 0; for (var i=1;i<outMat.length;i++) if (outMat[i]!==outMat[i-1]) bnd++;
assertEqual(bnd, 1, 'orderCuts: сырьё сгруппировано (1 граница)');
// Фольга строго в конце
var inFoil = [ cut('1',{m:'A',foil:true}), cut('2',{m:'A'}), cut('3',{m:'A'}) ];
var outFoil = planning.orderCuts(inFoil).map(function(c){return c.id;});
assertEqual(outFoil[outFoil.length-1], '1', 'orderCuts: Фольга в конце');
// нож (30) дороже смены сырья (15): смена набора ножей штрафуется сильнее, чем смена сырья.
assertEqual(planning.changeoverCost(base, clone(base,{knifeCount:9, knifeWidths:[10,10,10,10,10,10,10,10,10]}), null) >
            planning.changeoverCost(base, clone(base,{materialId:'9'}), null), true, 'changeoverCost: смена ножей (30) дороже смены сырья (15)');
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

// ── rowsToPlanning строит дескриптор движка из колонок отчёта ──
var rpd = planning.rowsToPlanning([{
  cut_id:'9', cut_no:'1', cut_slitter_id:'10', cut_slitter:'Станок 1',
  cut_material_id:'1241', cut_material:'Фольга 38', cut_batch_id:'700',
  cut_jumbo_remaining:'350', cut_knives:'14', cut_winding:'out', cut_roller_width:'60',
  cut_sequence:'', supply_id:''
}]);
var c = rpd.cuts[0];
assertEqual(c.materialId, '1241', 'descriptor materialId');
assertEqual(c.batchId, '700', 'descriptor batchId');
assertEqual(c.jumboRemainingM, 350, 'descriptor jumboRemainingM number');
assertEqual(c.knifeCount, 14, 'descriptor knifeCount number');
assertEqual(c.winding, 'OUT', 'descriptor winding normalized');
assertEqual(c.rollerWidth, 60, 'descriptor rollerWidth number');
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
assertEqual(planning.supplyRollsForPosition(layout3185, pos3185.p110, 3), 6, 'supplyRollsForPosition: runs × non-stock strips by width');
assertEqual(planning.supplyRollsForPosition(layout3185, pos3185.p70, 3), 3, 'supplyRollsForPosition: width 70 → 3 рулона');
assertEqual(planning.layoutRunLength(layout3185, pos3185), 1200, 'layoutRunLength: max length of covered positions');
assertEqual(planning.finishedBatchesForLayout(layout3185, 'cut777', 1200, 3), [
  { cutId: 'cut777', width: 55, rolls: 6, length: 1200 },
  { cutId: 'cut777', width: 44, rolls: 3, length: 1200 }
], 'finishedBatchesForLayout: stock strips become GP batches');
assertEqual(planning.sleeveTasksForLayout(layout3185, pos3185, 3), [
  { diameter: 76, qty: 6 },
  { diameter: 40, qty: 3 }
], 'sleeveTasksForLayout: sleeves planned from cut output for order strips');
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
    { id: '15018', val: 'Партия сырья' },
    { id: '8629', val: 'Полоса', arr_id: '1073' },
    { id: '16422', val: 'Кол-во факт' }
  ]
};
var sleeveMeta3189 = {
  id: '1080',
  val: 'Задача на втулки',
  attrs: '{"alias":"Задание на втулки"}',
  reqs: [
    { id: '1180', val: 'Втулкорез' },
    { id: '16399', val: 'Кол-во' },
    { id: '1183', val: 'Кол-во факт' },
    { id: '1184', val: 'Активно' }
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
assertEqual(planning.supplyCutRelation(supplyMeta3189, cutMeta3189), {
  mode: 'reference',
  reqId: '16428',
  arrId: null
}, 'supplyCutRelation: новая метасхема #3189 снова хранит ссылку на резку');
assertEqual(planning.buildSupplyFieldsForCut(supplyMeta3189, cutMeta3189, {
  footage: '1200',
  cutId: '501',
  rolls: '6',
  status: 'Зарезервировано'
}), { t1149: '1200', t16428: '501', t16424: '6' },
  'buildSupplyFieldsForCut: #3189 пишет метраж, резку и рулоны, пропускает отсутствующий статус');
assertEqual(planning.positionSleeveTasksForLayout(layout3185, pos3185, 3), [
  { positionId: 'p110', diameter: 76, qty: 6 },
  { positionId: 'p70', diameter: 40, qty: 3 }
], 'positionSleeveTasksForLayout: задачи втулок создаются под позициями заказа (#3189)');
var sleeveReqIds3189 = {
  diameter: planning.reqIdByName(sleeveMeta3189, 'Диаметр, мм'),
  actualQty: planning.reqIdByName(sleeveMeta3189, 'Кол-во факт'),
  status: planning.reqIdByName(sleeveMeta3189, 'Статус')
};
var sleeveFields3189 = planning.buildFields(sleeveReqIds3189, {
  diameter: 76,
  actualQty: 0,
  status: 'Ожидает'
});
sleeveFields3189['t' + sleeveMeta3189.id] = 6;
assertEqual(sleeveFields3189, { t1183: 0, t1080: 6 },
  'buildFields: #3189 втулки пишут факт и главное плановое количество без отсутствующих полей');

// ── Чистые хелперы плумбинга позиций/партий ──
// rowsToGenPositions: маппинг строк positions_list → дескрипторы
var grp = planning.rowsToGenPositions([
  { position_id:'10', position_material_id:'5', position_width:'60', position_qty:'30', position_length:'1200', position_sleeve:'8188:76' },
  { position_id:'11', position_material_id:'5', position_width:'', position_qty:'', position_length:'' }
]);
assertEqual(grp, [
  { id:'10', materialId:'5', width:60, qty:30, length:1200, sleeveDiameter:76, dueKey: Infinity, approved:false },
  { id:'11', materialId:'5', width:0, qty:0, length:0, sleeveDiameter:0, dueKey: Infinity, approved:false }
], 'rowsToGenPositions: маппинг + пустые ширина/кол-во/длина → 0, dueKey без срока → Infinity');

// rowsToGenPositions читает срок изготовления → dueKey (batchDateKey)
var grpDue = planning.rowsToGenPositions([
  { position_id:'10', position_material_id:'5', position_width:'60', position_qty:'30', position_due_date:'2026-06-10' }
]);
assertEqual(grpDue[0].dueKey, 20260610, 'rowsToGenPositions: position_due_date → dueKey');
// #3155: position_length → length («Длина, м» = метраж прогона джамбо обеспечения)
assertEqual(grpDue[0].length, 0, 'rowsToGenPositions: нет position_length → length 0');

// positionLengthMap (#3155): { id позиции → Длина, м } из дескрипторов genPositions.
assertEqual(planning.positionLengthMap([
  { id:'10', length:1200 },
  { id:'11', length:0 },
  { id:'', length:999 },                 // пустой id пропускается
  { id:'12' }                            // нет length → 0
]), { '10':1200, '11':0, '12':0 }, 'positionLengthMap: id→длина, пустой id пропущен');
assertEqual(planning.positionLengthMap(null), {}, 'positionLengthMap: null → {}');

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

// Расписание очереди: старт/финиш от 08:00 (480 мин) + лидер 2 + намотка по метражу.
var schedCuts = [
    { id:'A', materialId:'1', winding:'IN', batchId:'b', knifeCount:4, knifeWidths:[60], rollerWidth:60 },
    { id:'B', materialId:'1', winding:'IN', batchId:'b', knifeCount:4, knifeWidths:[60], rollerWidth:60 }
];
var sched = planning.buildSchedule(schedCuts, { windPoints: pts, runLengthByCut: { A:300, B:600 }, shiftStartMin: 480 });
assertEqual(sched[0], { cutId:'A', startMin:482, finishMin:483.2, setupMin:2, durationMin:1.2 }, 'buildSchedule: 1-я резка (лидер 2, намотка 300→1.2)');
assertEqual(sched[1], { cutId:'B', startMin:485.2, finishMin:489.2, setupMin:2, durationMin:4 }, 'buildSchedule: 2-я накопительно (идентична → переналадка 0)');
assertEqual(planning.formatClock(482), '08:02', 'formatClock: 482 → 08:02');
assertEqual(planning.formatClock(1440 + 90), '01:30 +1д', 'formatClock: за сутки → +1д');

// Рабочее окно 08:00–16:30: резка, не влезающая до конца окна, переносится на след. день.
// Узкое окно для теста (484): A влезает, B (старт 485.2 > 484) → день+1, 08:00 + setup.
var schedW = planning.buildSchedule(schedCuts, { windPoints: pts, runLengthByCut: { A:300, B:600 }, shiftStartMin: 480, shiftEndMin: 484 });
assertEqual(schedW[0].startMin, 482, 'buildSchedule(окно): A в первый день (482)');
assertEqual([schedW[1].startMin, schedW[1].finishMin], [1922, 1926], 'buildSchedule(окно): B не влез до 16:30 → след. день 08:00+setup (1922–1926)');
assertEqual(planning.SHIFT_END_MIN, 990, 'SHIFT_END_MIN = 16:30 (990)');

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

function req(id, val, extra) {
    var r = { id: id, val: val };
    Object.keys(extra || {}).forEach(function(k) { r[k] = extra[k]; });
    return r;
}

function runGenerateCutsDeferredGpTest() {
    var controller = Object.create(api.Controller.prototype);
    var posts = [];
    controller.meta = {
        cut: { id: '1078', val: 'Производственная резка', reqs: [
            req('1156', 'Слиттер'),
            req('15018', 'Партия сырья'),
            req('16403', 'Кол-во план'),
            req('24305', 'Метраж, м'),
            req('1162', 'Статус')
        ] },
        strip: { id: '1073', val: 'Полоса', reqs: [
            req('1144', 'Ширина, мм'),
            req('1146', 'Количество'),
            req('1147', 'Назначение'),
            req('1149', 'На склад')
        ] },
        supply: { id: '1077', val: 'Обеспечение', reqs: [
            req('1148', 'Метраж, м'),
            req('15015', 'Производственная резка', { ref: '1078' }),
            req('16420', 'Кол-во рулонов'),
            req('1154', 'Статус')
        ] },
        finishedBatch: { id: '1081', val: 'Партия ГП', reqs: [
            req('16428', 'Производственная резка', { ref: '1078' }),
            req('1184', 'Ширина, мм'),
            req('1185', 'Кол-во рулонов'),
            req('1186', 'Метраж, м'),
            req('1187', 'Статус'),
            req('409', 'Активно')
        ] },
        sleeveTask: null
    };
    controller.genPositions = [{ id: 'p1', materialId: 'M', width: 110, qty: 1, length: 1200 }];
    controller.genBatches = [{ id: 'b1', materialId: 'M', dateKey: 20260601, remainder: 1000, active: true }];
    controller.cuts = [];
    controller.slitters = [{ id: '10', label: 'С1', stopMaterialIds: [] }];
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
        assertEqual(posts.some(function(p) { return p.path.indexOf('_m_new/1081') === 0; }), false,
            'runGenerateCuts: GP batches are not created during planning');
        assertEqual(posts.some(function(p) { return p.path.indexOf('_m_new/1073') === 0; }), true,
            'runGenerateCuts: strips are still created during planning');
    });
}

runGenerateCutsDeferredGpTest().then(function() {
    console.log('\n' + passed + ' assertions passed');
}).catch(function(err) {
    console.error(err && err.stack || err);
    process.exitCode = 1;
});
