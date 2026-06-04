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

var planning = require('../download/atex/js/production-planning.js').planning;

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
      jumboRemainingM: 0, knifeCount: 0, knifeWidths: [], winding: '', rollerWidth: 0, isFoil: false,
      orderId: '', orderApprovalDate: '' },
    { id: '20', number: '2', slitter: { id: null, label: '' },
      materialBatch: { id: null, label: 'НК-0118' },
      planDate: '27.05.2026', status: 'Ожидает', sequence: null,
      materialId: '', materialName: '', batchId: '',
      jumboRemainingM: 0, knifeCount: 0, knifeWidths: [], winding: '', rollerWidth: 0, isFoil: false,
      orderId: '', orderApprovalDate: '' }
], 'rowsToPlanning dedups cuts by cut_id, slitter без id → {id:null}');
assertEqual(plan.supplies, [
    { id: '900', positionId: '700', cutId: '10' },
    { id: '901', positionId: '701', cutId: '10' }
], 'rowsToPlanning collects supplies from rows with supply_id, skips empty');
assertEqual(planning.rowsToPlanning([]).cuts.length, 0, 'rowsToPlanning empty input → no cuts');
// сценарий показа: группировка + счётчик связей поверх результата rowsToPlanning
assertEqual(planning.groupBySlitter(plan.cuts).map(function(g) { return g.slitter.label; }),
    ['Станок 1', 'Без станка'], 'groupBySlitter over rowsToPlanning cuts');

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

// ── Чистые хелперы плумбинга позиций/партий ──
// rowsToGenPositions: маппинг строк positions_list → дескрипторы
var grp = planning.rowsToGenPositions([
  { position_id:'10', position_material_id:'5', position_width:'60', position_qty:'30' },
  { position_id:'11', position_material_id:'5', position_width:'', position_qty:'' }
]);
assertEqual(grp, [
  { id:'10', materialId:'5', width:60, qty:30, dueKey: Infinity },
  { id:'11', materialId:'5', width:0, qty:0, dueKey: Infinity }
], 'rowsToGenPositions: маппинг + пустые ширина/кол-во → 0, dueKey без срока → Infinity');

// rowsToGenPositions читает срок изготовления → dueKey (batchDateKey)
var grpDue = planning.rowsToGenPositions([
  { position_id:'10', position_material_id:'5', position_width:'60', position_qty:'30', position_due_date:'2026-06-10' }
]);
assertEqual(grpDue[0].dueKey, 20260610, 'rowsToGenPositions: position_due_date → dueKey');

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
assertEqual(planning.isCutVisible(vc({orderApprovalDate:''}), '2026-06-02'), false, 'isCutVisible: заказ не согласован → скрыта');
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
    { id:'3', materialId:'X', label:'BX', dateKey:1, remainder:999, remainderLinear:999 }
];
assertEqual(planning.fifoBatchesForMaterial(gbL, { '1': 91 }, 'M', 0.91), [
    { id:'1', label:'B1', arrivalKey:2, freeLinearM:900 },
    { id:'2', label:'B2', arrivalKey:1, freeLinearM:500 }
], 'fifoBatchesForMaterial: материал M, свободный остаток (b1: 1000−100=900)');
assertEqual(planning.fifoBatchesForMaterial(gbL, {}, 'Z', 0.91), [], 'fifoBatchesForMaterial: нет партий материала → []');
// связка с reserveFifo: нужно 700 пог.м → FIFO берёт b2 (приход раньше) 500 + b1 200
var fbReserve = planning.reserveFifo(planning.fifoBatchesForMaterial(gbL, { '1': 91 }, 'M', 0.91), 700, 0.91);
assertEqual([fbReserve.allocations[0].batchId, fbReserve.allocations[1].batchId, fbReserve.fullyReserved], ['2', '1', true], 'fifoBatchesForMaterial → reserveFifo: FIFO по приходу, добор');

// materialByCut (#3120 Фаза 2): материал резки из обеспечиваемых позиций.
var gpM = [{ id:'p1', materialId:'M1' }, { id:'p2', materialId:'M1' }, { id:'p3', materialId:'M2' }];
var supM = [{ cutId:'c1', positionId:'p1' }, { cutId:'c1', positionId:'p2' }, { cutId:'c2', positionId:'p3' }, { cutId:'c3', positionId:'pX' }];
assertEqual(planning.materialByCut([], supM, gpM), { c1:'M1', c2:'M2' }, 'materialByCut: c1→M1 (по позициям), c2→M2, c3 без материала позиции — нет');

console.log('\n' + passed + ' assertions passed');
