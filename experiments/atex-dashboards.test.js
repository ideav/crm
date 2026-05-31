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

global.window = { db: 'atex' };
const controller = new api.Controller({ getAttribute: function() { return 'atex'; } });
controller.getJson = function(pathname) {
    assert.strictEqual(pathname, 'metadata', 'dashboard controller requests metadata before reading live data');
    return Promise.resolve([
        { id: '107', val: 'Заказ' },
        { id: '108', val: 'Позиция заказа' },
        { id: '109', val: 'Обеспечение' },
        { id: '110', val: 'Производственная резка' },
        { id: '113', val: 'Партия ГП' },
        { id: '106', val: 'Партия сырья' }
    ]);
};

controller.loadMetadata().then(function() {
    assert.strictEqual(controller.meta.position.id, '108', 'metadata resolver loads order positions for the production path');
    assert.strictEqual(controller.meta.provision.id, '109', 'metadata resolver loads provisions for the production path');
    assert(source.includes('cardProductionFlow'), 'dashboard renders the production path card');
    assert(styles.includes('.atex-db-flow-stage-done'), 'dashboard CSS styles completed production stages');
    assert(docs.includes('Путь продукции'), 'Atex workplace documentation mentions the production path card');
    console.log('atex dashboards production path: ok');
}).catch(function(err) {
    console.error(err && err.stack || err);
    process.exit(1);
});
