/*
 * Unit tests for the Atex director dashboards core.
 *
 * Issue #3024 adds the per-position production path so reviewers can see how a
 * product moves through order, planning, production, warehouse, and shipment
 * stages instead of only seeing aggregate counters.
 *
 * Run with: node experiments/atex-dashboards.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const api = require('../download/atex/js/dashboards.js');
const dashboards = api.agg;

function assertEqual(actual, expected, name) {
    assert.deepStrictEqual(actual, expected, name);
}

assert(dashboards, 'dashboard aggregation API is exported');

const flow = dashboards.productionFlow({
    orders: [
        { id: '1966', number: 'АТХ-3002-2026-05-31', status: 'Выполнен' },
        { id: '2100', number: 'АТХ-3024-в-работе', status: 'В производстве' }
    ],
    positions: [
        {
            id: '1974',
            orderId: '1966',
            cutType: 'TT-АТХ-3002-2026-05-31 57x10+40x8',
            width: '57',
            length: '1200',
            qty: '10',
            status: 'Отгружена'
        },
        {
            id: '2101',
            orderId: '2100',
            cutType: 'TT-3024',
            width: '40',
            length: '800',
            qty: '4',
            status: 'В работе'
        }
    ],
    provisions: [
        { id: '1993', positionId: '1974', cutId: '1982', gpId: '2012', footage: '1200', status: 'Выполнено' },
        { id: '2102', positionId: '2101', cutId: '2103', gpId: '', footage: '800', status: 'Зарезервировано' }
    ],
    cuts: [
        { id: '1982', number: '4', slitter: 'Слиттер 1', status: 'Завершён', footage: '1200' },
        { id: '2103', number: '5', slitter: 'Слиттер 2', status: 'В работе', footage: '250' }
    ],
    gpBatches: [
        { id: '2012', cutId: '1982', status: 'Отгружен', rolls: '10', footage: '1200', address: 'A-3002-01' }
    ]
});

// #3073: терминальные заказы (Выполнен/Отменён) в «путь продукции» не попадают —
// остаётся только актуальная позиция заказа 2100.
assert.strictEqual(flow.total, 1, 'terminal orders are excluded from the production path');
assert.strictEqual(flow.done, 0, 'no fully shipped (terminal) order remains in the path');
assert.strictEqual(flow.active, 1, 'one position is still active');
assert(flow.rows.every(function(r) { return r.orderId !== '1966'; }), 'completed order 1966 is not shown in the path');

const activeRow = flow.rows[0];
assert.strictEqual(activeRow.orderId, '2100', 'active/incomplete production rows are shown first');
assert.strictEqual(activeRow.progress, 40, 'active stages contribute visible in-progress movement');
assert.deepStrictEqual(
    activeRow.stages.map(function(stage) { return stage.label; }),
    ['Заказ', 'Позиция', 'Обеспечение', 'Резка', 'ГП / отгрузка'],
    'production path exposes all expected stages'
);
assert.deepStrictEqual(
    activeRow.stages.map(function(stage) { return stage.state; }),
    ['active', 'active', 'active', 'active', 'pending'],
    'active row distinguishes active stages from the missing GP/shipment stage'
);

assert.strictEqual(dashboards.stageState('Завершен', ['Завершён', 'Завершен']), 'done', 'stageState accepts e/ё variants');
assert.strictEqual(dashboards.stageState('', ['Выполнен']), 'pending', 'empty stage is pending');

const source = fs.readFileSync(path.join(root, 'download/atex/js/dashboards.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'download/atex/css/dashboards.css'), 'utf8');
const docs = fs.readFileSync(path.join(root, 'docs/atex_workplaces.md'), 'utf8');

assert(source.includes('cardProductionFlow'), 'dashboard renders the production path card');
assert(styles.includes('.atex-db-flow-stage-done'), 'dashboard CSS styles completed production stages');
assert(docs.includes('Путь продукции'), 'Atex workplace documentation mentions the production path card');

// ── rowsToEntities: строки отчёта order_pipeline → сущности ──
var PR = [
  { order_id:'10', order_no:'A-1', order_status:'Новый', order_deadline:'2026-06-10',
    position_id:'', provision_id:'', cut_id:'', gp_id:'' },
  { order_id:'11', order_no:'A-2', order_status:'Выполнен', order_deadline:'2026-06-20',
    position_id:'21', position_status:'Отгружена', position_cut_type:'TT', position_width_mm:'57', position_length_m:'10',
    provision_id:'31', provision_used_m:'1200', provision_status:'Выполнено',
    cut_id:'41', cut_no:'4', cut_slitter:'Станок 1', cut_status:'Завершён', cut_footage_m:'1300',
    gp_id:'51', gp_status:'Отгружен', gp_rolls:'10', gp_footage_m:'1200', gp_address:'A-3', gp_cut_id:'41' }
];
var ent = dashboards.rowsToEntities(PR);
assertEqual(ent.orders.length, 2, 'rowsToEntities: 2 заказа (dedup)');
assertEqual(ent.orders[0], { id:'10', number:'A-1', status:'Новый', deadline:'2026-06-10' }, 'rowsToEntities: заказ (со сроком выполнения)');
assertEqual(ent.cuts.length, 1, 'rowsToEntities: пустые стадии не создают резок');
assertEqual(ent.cuts[0], { id:'41', number:'4', slitter:'Станок 1', status:'Завершён', footage:'1300' }, 'rowsToEntities: резка');
assertEqual(ent.positions[0].orderId, '11', 'rowsToEntities: позиция знает заказ');
assertEqual(ent.provisions[0], { id:'31', positionId:'21', cutId:'41', gpId:'51', footage:'1200', status:'Выполнено' }, 'rowsToEntities: обеспечение');
assertEqual(ent.gpBatches[0], { id:'51', cutId:'41', status:'Отгружен', rolls:'10', footage:'1200', address:'A-3' }, 'rowsToEntities: ГП');

// ── collect(): два отчёта → сводки ──
global.window = { db: 'atex' };
var controller = new api.Controller({ getAttribute: function() { return 'atex'; } });
var collectCalls = [];
controller.getJson = function(pathname) {
    collectCalls.push(pathname);
    if (pathname === 'report/order_pipeline?JSON_KV&FR_order_active=%25') return Promise.resolve(PR);
    if (pathname === 'report/material_stock?JSON_KV') return Promise.resolve([
        { material: 'Полиэтилен', material_received_m2: '500', material_remainder_m2: '200' }
    ]);
    if (pathname === 'report/orders_status_count?JSON_KV') return Promise.resolve([
        { order_status: 'Выполнен', cnt: '7' },
        { order_status: 'Отменён', cnt: '3' },
        { order_status: 'Новый', cnt: '1' }
    ]);
    throw new Error('Unexpected getJson call: ' + pathname);
};

controller.collect().then(function(result) {
    assertEqual(collectCalls.sort(), ['report/material_stock?JSON_KV', 'report/order_pipeline?JSON_KV&FR_order_active=%25', 'report/orders_status_count?JSON_KV'],
        'collect() запрашивает три отчёта (order_pipeline активные + остатки + счётчик статусов)');
    assert.strictEqual(controller.statusCounts.length, 3, 'collect(): statusCounts сохранён');
    // #3073: пустой диапазон дат → только актуальные заказы (Выполнен 'A-2' отфильтрован).
    assert.strictEqual(result.counts.order, 1, 'collect(): пустой диапазон → только актуальные заказы');
    assert.strictEqual(result.counts.rawBatch, 1, 'collect(): counts.rawBatch = строки material_stock');
    assert(result.orders && result.orders.rows, 'collect(): поле orders присутствует');
    assert(result.filter && result.filter.active === true, 'collect(): фильтр по умолчанию активен (без дат)');
    assert(result.orders.rows.every(function(r) { return !dashboards.isTerminalStatus(r.key); }),
        'collect(): по умолчанию терминальные статусы не показываются');
    assert(result.materials && result.materials.rows.length === 1, 'collect(): поле materials присутствует');
    assert.strictEqual(result.materials.rows[0].key, 'Полиэтилен', 'collect(): materials группируется по полю material');
    console.log('atex dashboards production path: ok');
}).catch(function(err) {
    console.error(err && err.stack || err);
    process.exit(1);
});

// ── #3073: фильтр диапазона дат по сроку выполнения ──
// Пустой диапазон → только актуальные; заполненный → заказы со сроком в диапазоне
// (включительно), в т.ч. терминальные — для среза «заказы по статусам».
var ranged = dashboards.buildSummaries(PR, [], { from: '2026-06-15', to: '2026-06-25' });
assert.strictEqual(ranged.counts.order, 1, 'buildSummaries: диапазон выбирает заказ по сроку выполнения');
assert.strictEqual(ranged.orders.rows[0].key, 'Выполнен', 'buildSummaries: терминальный заказ попадает в срез по дате');
assert.strictEqual(ranged.flow.total, 0, 'buildSummaries: путь продукции всё равно скрывает терминальные заказы');
assert.strictEqual(ranged.filter.active, false, 'buildSummaries: при заполненном диапазоне фильтр не «активный»');

var emptyRange = dashboards.buildSummaries(PR, [], {});
assert.strictEqual(emptyRange.counts.order, 1, 'buildSummaries: пустой диапазон → только актуальные');
assert.strictEqual(emptyRange.orders.rows[0].key, 'Новый', 'buildSummaries: актуальный заказ виден без дат');

// selectOrders / dateInRange / isTerminalStatus — точечно.
assert.strictEqual(dashboards.isTerminalStatus('Отменен'), true, 'isTerminalStatus: «Отменен» (без ё) терминальный');
assert.strictEqual(dashboards.isTerminalStatus('В производстве'), false, 'isTerminalStatus: активный статус не терминальный');
assert.strictEqual(dashboards.dateInRange('2026-06-20', '2026-06-20', '2026-06-25'), true, 'dateInRange: нижняя граница включительно');
assert.strictEqual(dashboards.dateInRange('2026-06-25', '2026-06-20', '2026-06-25'), true, 'dateInRange: верхняя граница включительно');
assert.strictEqual(dashboards.dateInRange('2026-06-26', '2026-06-20', '2026-06-25'), false, 'dateInRange: вне диапазона');
assert.strictEqual(dashboards.dateInRange('', '2026-06-20', ''), false, 'dateInRange: пустая дата не входит в непустой диапазон');

// materialStock сортирует остатки по убыванию (#3073).
var ms = dashboards.materialStock([
    { material: 'Полипропилен', received: '100', remainder: '5' },
    { material: 'Полиэтилен', received: '500', remainder: '200' },
    { material: 'Лавсан', received: '300', remainder: '50' }
]);
assertEqual(ms.rows.map(function(r) { return r.key; }), ['Полиэтилен', 'Лавсан', 'Полипропилен'],
    'materialStock: остатки отсортированы по убыванию');

// materialStock округляет остаток до целых м² (суммируя точно).
var msRound = dashboards.materialStock([
    { material: 'MR132', received: '38400.366', remainder: '38400.366' },
    { material: 'MR132', received: '0', remainder: '0.5' },
    { material: 'MR194', received: '414115.10', remainder: '414115.10' }
]);
var byMat = {};
msRound.rows.forEach(function(r) { byMat[r.key] = r.remainder; });
assertEqual(byMat['MR132'], 38401, 'materialStock: остаток MR132 = round(38400.366+0.5)=38401');
assertEqual(byMat['MR194'], 414115, 'materialStock: остаток MR194 = round(414115.10)=414115');
assertEqual(msRound.totalRemainder, 452516, 'materialStock: totalRemainder округлён до целых');

// logBarWidth: логарифмическая шкала остатков [min..max] → [2..100]%.
assertEqual(dashboards.logBarWidth(100, 100, 10000), 2, 'logBarWidth: минимум диапазона → 2%');
assertEqual(dashboards.logBarWidth(10000, 100, 10000), 100, 'logBarWidth: максимум → 100%');
assertEqual(dashboards.logBarWidth(1000, 100, 10000), 51, 'logBarWidth: середина по log (10×min) → 51%');
assertEqual(dashboards.logBarWidth(0, 100, 10000), 2, 'logBarWidth: v<=0 → 2%');
assertEqual(dashboards.logBarWidth(5, 5, 5), 100, 'logBarWidth: max<=min → 100%');
// Маленькое значение (10×min) на лог-шкале заметно шире, чем было бы линейно.
var linW = Math.round(1000 / 10000 * 100);            // линейно = 10%
assert(dashboards.logBarWidth(1000, 100, 10000) > linW, 'logBarWidth: мелкое значение видимее, чем линейно (51% > 10%)');

// terminalOrderCounts: завершённые/отменённые из отчёта статусов.
var tc = dashboards.terminalOrderCounts([
    { order_status: 'Выполнен', cnt: '7' },
    { order_status: 'Отменён', cnt: '3' },
    { order_status: 'Новый', cnt: '120' }
]);
assertEqual(tc.done, 7, 'terminalOrderCounts: завершено = 7');
assertEqual(tc.cancelled, 3, 'terminalOrderCounts: отменено = 3');
assertEqual(tc.total, 10, 'terminalOrderCounts: всего терминальных = 10');
// ё/регистр и пустой ввод
assertEqual(dashboards.terminalOrderCounts([{ order_status: 'отменен', cnt: '5' }]).cancelled, 5, 'terminalOrderCounts: нормализация ё/регистра');
assertEqual(dashboards.terminalOrderCounts([]).total, 0, 'terminalOrderCounts: пустой ввод → 0');
