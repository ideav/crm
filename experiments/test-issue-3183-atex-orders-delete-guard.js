/*
 * Regression tests for issue #3183.
 *
 * Orders may be deleted only while neither the order itself nor any of its
 * positions has a filled "Дата согласования" value.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const scriptPath = path.join(root, 'download', 'atex', 'js', 'orders.js');
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
assert.strictEqual(typeof helpers.orderDeleteBlockReason, 'function', 'delete guard reason helper is exported');
assert.strictEqual(typeof helpers.canDeleteOrder, 'function', 'delete guard boolean helper is exported');

const orders = helpers.rowsToOrders([
    {
        order_id: '10',
        order_no: '10',
        order_client: 'ООО Ромашка',
        order_manager: 'Менеджер',
        order_created: '01.06.2026',
        order_approved: '',
        order_status: 'Новый',
        position_id: '100',
        position_qty: '5',
        position_status: 'Новая',
        position_approved: ''
    },
    {
        order_id: '20',
        order_no: '20',
        order_client: 'ООО Ландыш',
        order_manager: 'Менеджер',
        order_created: '01.06.2026',
        order_approved: '02.06.2026',
        order_status: 'Согласован',
        position_id: '',
        position_qty: '',
        position_status: '',
        position_approved: ''
    },
    {
        order_id: '30',
        order_no: '30',
        order_client: 'ООО Василек',
        order_manager: 'Менеджер',
        order_created: '01.06.2026',
        order_approved: '',
        order_status: 'Новый',
        position_id: '300',
        position_qty: '1',
        position_status: 'В работе',
        position_approved: '03.06.2026'
    },
    {
        order_id: '30',
        order_no: '30',
        order_client: 'ООО Василек',
        order_manager: 'Менеджер',
        order_created: '01.06.2026',
        order_approved: '',
        order_status: 'Новый',
        position_id: '301',
        position_qty: '2',
        position_status: 'Новая',
        position_approved: ''
    }
]);

assert.strictEqual(orders.length, 3, 'fixtures produce three orders');
assert.strictEqual(orders[2].positions[0].values.approved, '03.06.2026', 'position approval date is parsed from report rows');
assert.strictEqual(orders[2].values.approved, '', 'partially approved positions do not derive order approval');

assert.strictEqual(helpers.orderDeleteBlockReason(orders[0]), '', 'unapproved order with unapproved positions is deletable');
assert.strictEqual(helpers.canDeleteOrder(orders[0]), true, 'canDeleteOrder allows clean order');

assert.match(helpers.orderDeleteBlockReason(orders[1]), /заказ согласован/i, 'approved order is blocked');
assert.strictEqual(helpers.canDeleteOrder(orders[1]), false, 'canDeleteOrder blocks approved order');

assert.match(helpers.orderDeleteBlockReason(orders[2]), /согласованные позиции/i, 'order with approved positions is blocked');
assert.strictEqual(helpers.canDeleteOrder(orders[2]), false, 'canDeleteOrder blocks order with approved positions');

const allowedHtml = helpers.renderPositionsHtml(orders[0]);
assert(allowedHtml.includes('data-del-order="10"'), 'clean order renders active delete action');
assert(!allowedHtml.includes('disabled'), 'clean order delete action is not disabled');

const approvedOrderHtml = helpers.renderPositionsHtml(orders[1]);
assert(approvedOrderHtml.includes('disabled'), 'approved order delete action is disabled');
assert(approvedOrderHtml.includes('Нельзя удалить заказ: заказ согласован.'), 'approved order explains why delete is disabled');
assert(!approvedOrderHtml.includes('data-del-order="20"'), 'approved order does not expose delete action data attribute');

const approvedPositionHtml = helpers.renderPositionsHtml(orders[2]);
assert(approvedPositionHtml.includes('disabled'), 'order with approved positions delete action is disabled');
assert(approvedPositionHtml.includes('Нельзя удалить заказ: есть согласованные позиции.'), 'approved position explains why delete is disabled');
assert(!approvedPositionHtml.includes('data-del-order="30"'), 'order with approved positions does not expose delete action data attribute');

console.log('issue-3183 atex orders delete guard: ok');
