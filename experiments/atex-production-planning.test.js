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
        { id: '1092', val: 'Тип резки' },
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
var rec = { i: 501, r: ['7', '101:Слиттер №1', '104:25×35', '106:Партия A', '2026-06-01', 'В очереди', 'комм.'] };
assertEqual(planning.mapCutRecord(rec, cutMeta), {
    id: '501',
    number: '7',
    slitter: { id: '101', label: 'Слиттер №1' },
    cutType: { id: '104', label: '25×35' },
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
    { slitter: '1090', cutType: '1092', materialBatch: '1094', planDate: '1096', status: '1098', notes: '1108' },
    { slitter: '101', cutType: '104', materialBatch: '', planDate: '2026-06-01', status: 'В очереди', notes: '' }
), { t1090: '101', t1092: '104', t1096: '2026-06-01', t1098: 'В очереди' },
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
      cutType: { id: null, label: '99мм×9' }, materialBatch: { id: null, label: 'НК-0400' },
      planDate: '06.05.2026', status: 'В работе', sequence: null,
      materialId: '', materialName: '', batchId: '',
      jumboRemainingM: 0, knifeCount: 0, knifeWidths: [], winding: '', rollerWidth: 0, isFoil: false },
    { id: '20', number: '2', slitter: { id: null, label: '' },
      cutType: { id: null, label: '25мм×35' }, materialBatch: { id: null, label: 'НК-0118' },
      planDate: '27.05.2026', status: 'Ожидает', sequence: null,
      materialId: '', materialName: '', batchId: '',
      jumboRemainingM: 0, knifeCount: 0, knifeWidths: [], winding: '', rollerWidth: 0, isFoil: false }
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
    { position_id: '8207', position_no: '1', position_cut_type: '', position_width: '25.00', position_qty: '70' },
    { position_id: '8300', position_no: '2', position_cut_type: '110мм×8', position_width: '110.00', position_qty: '5' }
];
assertEqual(planning.rowsToPositions(posRows), [
    { id: '8207', label: '#8207 · 25.00 · 70' },
    { id: '8300', label: '#8300 · 110мм×8 · 110.00 · 5' }
], 'rowsToPositions: «#id · тип · ширина · кол-во», пустые поля пропущены');
assertEqual(planning.rowsToPositions([{ position_id: '9', position_no: '3', position_cut_type: '', position_width: '', position_qty: '' }]),
    [{ id: '9', label: '#9 · 3' }], 'rowsToPositions: без деталей — fallback на номер');
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
// PLANNING_WEIGHTS экспортирован, значения 10..100
assertEqual(planning.PLANNING_WEIGHTS.material, 100, 'вес material=100');
// changeoverCost при дефолтах: одиночная смена сырья=100 > намотки=70 > макс ножей=25; одинаковые=0
var base = { materialId:'1', winding:'IN', batchId:'b1', jumboRemainingM:0, knifeCount:4, knifeWidths:[60,60,60,60], rollerWidth:60 };
function clone(o,patch){ var c={}; for(var k in o) c[k]=o[k]; for(var k in (patch||{})) c[k]=patch[k]; return c; }
assertEqual(planning.changeoverCost(base, clone(base), null), 0, 'cost: идентичные → 0');
assertEqual(planning.changeoverCost(base, clone(base,{materialId:'2'}), null), 100, 'cost: смена сырья = 100');
assertEqual(planning.changeoverCost(base, clone(base,{winding:'OUT'}), null), 70, 'cost: смена намотки = 70');
// макс смена ножей (полностью разная конфигурация) = вес knife (25), т.к. нормировка min(1,…)
assertEqual(planning.changeoverCost(base, clone(base,{knifeCount:20, knifeWidths:[20,20,20]}), null) >= 25 - 1e-9
            && planning.changeoverCost(base, clone(base,{knifeCount:20, knifeWidths:[20,20,20]}), null) <= 25 + 1e-9, true, 'cost: макс ножи ≈ 25');

// ── orderCuts: жадное упорядочивание, Фольга в конец, настройка весов ──
function cut(id,o){ return { id:id, materialId:o.m, winding:o.w||'IN', batchId:o.b||('B'+id), jumboRemainingM:o.r==null?0:o.r, knifeCount:o.k||4, knifeWidths:o.kw||[60], isFoil:!!o.foil, rollerWidth:o.rw||60 }; }
// группировка по сырью (дефолтные веса): материалы не чередуются
var inMat = [ cut('1',{m:'A'}), cut('2',{m:'B'}), cut('3',{m:'A'}), cut('4',{m:'B'}) ];
var outMat = planning.orderCuts(inMat).map(function(c){return c.materialId;});
// число границ смены сырья = (различных − 1) = 1
var bnd = 0; for (var i=1;i<outMat.length;i++) if (outMat[i]!==outMat[i-1]) bnd++;
assertEqual(bnd, 1, 'orderCuts: сырьё сгруппировано (1 граница)');
// Фольга строго в конце
var inFoil = [ cut('1',{m:'A',foil:true}), cut('2',{m:'A'}), cut('3',{m:'A'}) ];
var outFoil = planning.orderCuts(inFoil).map(function(c){return c.id;});
assertEqual(outFoil[outFoil.length-1], '1', 'orderCuts: Фольга в конце');
// настраиваемость: winding>material → группировка сперва по намотке
var mix = [ cut('1',{m:'A',w:'IN'}), cut('2',{m:'B',w:'OUT'}), cut('3',{m:'A',w:'OUT'}), cut('4',{m:'B',w:'IN'}) ];
var byWind = planning.orderCuts(mix, { material:50, winding:100, batch:50, remainder:40, knife:25, width:10 }).map(function(c){return c.winding;});
var wb=0; for (var j=1;j<byWind.length;j++) if (byWind[j]!==byWind[j-1]) wb++;
assertEqual(wb, 1, 'orderCuts: с winding>material группировка по намотке (1 граница)');
// sequence 1..N и вход не мутируется
var src = [ cut('1',{m:'A'}), cut('2',{m:'A'}) ];
var res = planning.orderCuts(src);
assertEqual(res.map(function(c){return c.sequence;}), [1,2], 'sequence 1..N');
assertEqual(src[0].sequence, undefined, 'вход не мутируется');

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

// ── Task 1: хелперы генерации резок ──

// unsuppliedPositions
assertEqual(planning.unsuppliedPositions([{id:'1'},{id:'2'}], [{positionId:'1'}]).map(function(p){return p.id;}), ['2'], 'unsupplied: исключает обеспеченные');
// matchCutType: сырьё+ширина, выбор по макс qty
var idx = { T1:{materialId:'M', widths:[{width:60,qty:14}]}, T2:{materialId:'M', widths:[{width:60,qty:8},{width:40,qty:1}]}, T3:{materialId:'X', widths:[{width:60,qty:99}]} };
assertEqual(planning.matchCutType(idx,'M',60), 'T1', 'matchCutType: сырьё M, ширина 60, макс qty → T1');
assertEqual(planning.matchCutType(idx,'M',999), null, 'matchCutType: нет ширины → null');
assertEqual(planning.matchCutType(idx,'Z',60), null, 'matchCutType: нет сырья → null');
// rollersPerCut / cutsNeeded
assertEqual(planning.rollersPerCut(idx,'T1',60), 14, 'rollersPerCut: 14');
assertEqual(planning.cutsNeeded(30,14), 3, 'cutsNeeded: ceil(30/14)=3');
assertEqual(planning.cutsNeeded(5,0), 0, 'cutsNeeded: perCut 0 → 0');
assertEqual(planning.cutsNeeded(0,14), 1, 'cutsNeeded: qty 0 → min 1');
// pickSlitter: стоп-лист E + балансировка
var sl = [{id:'10',stopMaterialIds:['M']},{id:'20',stopMaterialIds:[]},{id:'30',stopMaterialIds:[]}];
assertEqual(planning.pickSlitter(sl,'M',{}), '20', 'pickSlitter: 10 запрещает M, баланс → 20 (меньший id)');
assertEqual(planning.pickSlitter(sl,'M',{'20':2}), '30', 'pickSlitter: 20 загружен → 30');
assertEqual(planning.pickSlitter([{id:'10',stopMaterialIds:['M']}],'M',{}), null, 'pickSlitter: все запрещают → null');
// pickBatchFIFO
var b = [{id:'b1',materialId:'M',dateKey:20260102,remainder:100},{id:'b2',materialId:'M',dateKey:20260101,remainder:50},{id:'b3',materialId:'M',dateKey:20251231,remainder:0}];
assertEqual(planning.pickBatchFIFO(b,'M'), 'b2', 'pickBatchFIFO: старейшая с остатком (b3 остаток 0)');
assertEqual(planning.pickBatchFIFO(b,'Z'), null, 'pickBatchFIFO: нет сырья → null');

console.log('\n' + passed + ' assertions passed');
