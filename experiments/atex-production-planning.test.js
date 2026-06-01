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
    status: 'В очереди'
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
      planDate: '06.05.2026', status: 'В работе' },
    { id: '20', number: '2', slitter: { id: null, label: '' },
      cutType: { id: null, label: '25мм×35' }, materialBatch: { id: null, label: 'НК-0118' },
      planDate: '27.05.2026', status: 'Ожидает' }
], 'rowsToPlanning dedups cuts by cut_id, slitter без id → {id:null}');
assertEqual(plan.supplies, [
    { id: '900', positionId: '700', cutId: '10' },
    { id: '901', positionId: '701', cutId: '10' }
], 'rowsToPlanning collects supplies from rows with supply_id, skips empty');
assertEqual(planning.rowsToPlanning([]).cuts.length, 0, 'rowsToPlanning empty input → no cuts');
// сценарий показа: группировка + счётчик связей поверх результата rowsToPlanning
assertEqual(planning.groupBySlitter(plan.cuts).map(function(g) { return g.slitter.label; }),
    ['Станок 1', 'Без станка'], 'groupBySlitter over rowsToPlanning cuts');

console.log('\n' + passed + ' assertions passed');
