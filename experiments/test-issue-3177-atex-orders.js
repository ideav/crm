/*
 * Regression tests for issue #3177.
 *
 * Covers the pure helpers and rendered markup contracts used by the Atex orders
 * workplace changes: default order status, editable order/position dates, order
 * deletion action, approve button text, and borderless in-cell inputs.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const scriptPath = path.join(root, 'download', 'atex', 'js', 'orders.js');
const stylePath = path.join(root, 'download', 'atex', 'css', 'orders.css');
const source = fs.readFileSync(scriptPath, 'utf8');

const sandbox = {
    window: {},
    document: {
        readyState: 'loading',
        addEventListener: function() {},
        getElementById: function() { return null; }
    },
    console,
    URLSearchParams,
    URL,
    setTimeout,
    clearTimeout,
    fetch: function() {
        throw new Error('fetch should not be called by helper tests');
    }
};
sandbox.window.window = sandbox.window;
sandbox.window.document = sandbox.document;

vm.runInNewContext(source, sandbox, { filename: scriptPath });

const helpers = sandbox.window.AtexOrdersTesting;
assert(helpers, 'AtexOrdersTesting helper API is exposed');

const orderColumns = helpers.buildColumns(helpers.ORDER_FIELDS, {
    id: '107',
    val: 'Заказ',
    type: '3',
    reqs: [
        { id: '1056', val: 'Дата создания', type: '9' },
        { id: '1060', val: 'Статус', type: '3' },
        { id: '1158', val: 'Срок изготовления', type: '9' }
    ]
});
const positionColumns = helpers.buildColumns(helpers.POSITION_FIELDS, {
    id: '108',
    val: 'Позиция заказа',
    type: '13',
    reqs: [
        { id: '1067', val: 'Кол-во', type: '13' },
        { id: '1159', val: 'Срок изготовления', type: '9' }
    ]
});

const orderCreate = helpers.buildCreateOrderRequest({
    db: 'atex',
    tableId: '107',
    columns: orderColumns,
    created: '2026-06-06',
    status: '',
    xsrf: 'TOK'
});
const orderBody = new URLSearchParams(orderCreate.body);
assert.strictEqual(helpers.DEFAULT_ORDER_STATUS_ID, '16320', 'default order status id is exported');
assert.strictEqual(orderBody.get('t1060'), '16320', 'blank order status defaults to Новый id 16320');

assert(
    Array.isArray(helpers.EDITABLE_POSITION_CELLS) && helpers.EDITABLE_POSITION_CELLS.includes('dueDate'),
    'position due date is editable inline'
);
assert(
    Array.isArray(helpers.EDITABLE_ORDER_CELLS) &&
        helpers.EDITABLE_ORDER_CELLS.includes('created') &&
        helpers.EDITABLE_ORDER_CELLS.includes('dueDate'),
    'order created date and due date are editable inline'
);

assert.strictEqual(helpers.dateDisplayToInputValue('06.06.2026'), '2026-06-06', 'DD.MM.YYYY date converts to input value');
assert.strictEqual(helpers.dateDisplayToInputValue('2026-06-07'), '2026-06-07', 'ISO date stays suitable for input');

const setOrderCreated = helpers.buildSetFieldRequest({
    db: 'atex',
    objId: '55',
    reqId: '1056',
    value: '2026-06-06',
    xsrf: 'TOK'
});
assert.strictEqual(setOrderCreated.url, '/atex/_m_set/55?JSON', 'single-field order edit uses _m_set');
assert.strictEqual(new URLSearchParams(setOrderCreated.body).get('t1056'), '2026-06-06', 'single-field order edit sets date');

const setPositionDue = helpers.buildSetPositionRequest({
    db: 'atex',
    objId: '77',
    columns: positionColumns,
    values: { qty: '10', dueDate: '2026-06-12' },
    xsrf: 'TOK'
});
const positionBody = new URLSearchParams(setPositionDue.body);
assert.strictEqual(positionBody.get('t1067'), '10', 'position edit still sets qty');
assert.strictEqual(positionBody.get('t1159'), '2026-06-12', 'position edit sets due date');

assert.strictEqual(typeof helpers.renderPositionsHtml, 'function', 'positions renderer is exported for markup contracts');
const positionsHtml = helpers.renderPositionsHtml({
    id: '55',
    values: {},
    positions: [
        { id: '77', values: { qty: '10', status: 'Новая', dueDate: '06.06.2026' }, refs: {} }
    ]
});
assert(positionsHtml.includes('data-del-order="55"'), 'expanded order actions include delete-order button');
assert(positionsHtml.includes('Удалить заказ'), 'delete-order action is labeled');
assert(positionsHtml.includes('data-cell="dueDate"'), 'position due date is rendered as an editable cell');
assert(positionsHtml.includes('Согласовать'), 'approve action uses the requested verb label');
assert(!positionsHtml.includes('Согласовано'), 'old approve label is not rendered');

const style = fs.readFileSync(stylePath, 'utf8');
assert(/\.atex-orders-cell\s+\.atex-orders-input/.test(style), 'CSS targets inputs inside editable cells');
assert(/border:\s*0\b/.test(style), 'inputs inside editable cells are borderless');

console.log('issue-3177 atex orders regressions: ok');
