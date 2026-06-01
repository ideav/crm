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

assert.strictEqual(flow.total, 2, 'two order positions are represented in the production path');
assert.strictEqual(flow.done, 1, 'one position is fully shipped');
assert.strictEqual(flow.active, 1, 'one position is still active');

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

const doneRow = flow.rows[1];
assert.strictEqual(doneRow.progress, 100, 'shipped row reaches 100% progress');
assert.strictEqual(doneRow.done, true, 'shipped row is marked done');
assert.strictEqual(doneRow.stages[4].status, 'Отгружен', 'GP shipment status is visible');
assert(doneRow.stages[4].detail.includes('A-3002-01'), 'GP storage address is carried into stage details');

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
  { order_id:'10', order_no:'A-1', order_status:'Новый',
    position_id:'', provision_id:'', cut_id:'', gp_id:'' },
  { order_id:'11', order_no:'A-2', order_status:'Выполнен',
    position_id:'21', position_status:'Отгружена', position_cut_type:'TT', position_width_mm:'57', position_length_m:'10',
    provision_id:'31', provision_used_m:'1200', provision_status:'Выполнено',
    cut_id:'41', cut_no:'4', cut_slitter:'Станок 1', cut_status:'Завершён', cut_footage_m:'1300',
    gp_id:'51', gp_status:'Отгружен', gp_rolls:'10', gp_footage_m:'1200', gp_address:'A-3', gp_cut_id:'41' }
];
var ent = dashboards.rowsToEntities(PR);
assertEqual(ent.orders.length, 2, 'rowsToEntities: 2 заказа (dedup)');
assertEqual(ent.orders[0], { id:'10', number:'A-1', status:'Новый' }, 'rowsToEntities: заказ');
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
    if (pathname === 'report/order_pipeline?JSON_KV') return Promise.resolve(PR);
    if (pathname === 'report/material_stock?JSON_KV') return Promise.resolve([
        { material: 'Полиэтилен', material_received_m2: '500', material_remainder_m2: '200' }
    ]);
    throw new Error('Unexpected getJson call: ' + pathname);
};

controller.collect().then(function(result) {
    assertEqual(collectCalls.sort(), ['report/material_stock?JSON_KV', 'report/order_pipeline?JSON_KV'],
        'collect() запрашивает ровно два отчёта');
    assert.strictEqual(result.counts.order, 2, 'collect(): counts.order = число уникальных заказов');
    assert.strictEqual(result.counts.rawBatch, 1, 'collect(): counts.rawBatch = строки material_stock');
    assert(result.orders && result.orders.rows, 'collect(): поле orders присутствует');
    assert(result.materials && result.materials.rows.length === 1, 'collect(): поле materials присутствует');
    assert.strictEqual(result.materials.rows[0].key, 'Полиэтилен', 'collect(): materials группируется по полю material');
    console.log('atex dashboards production path: ok');
}).catch(function(err) {
    console.error(err && err.stack || err);
    process.exit(1);
});
