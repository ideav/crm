/*
 * Regression/documentation test for issue #3027.
 *
 * The Atex role walkthrough must be an input workflow: test users enter values
 * and press workspace buttons to create the order, calculate a non-standard cut,
 * plan production, and cut sleeves. A read-only status/dashboard check is not
 * enough for this issue.
 *
 * Run with: node experiments/test-issue-3027-atex-role-input-walkthrough.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const docPath = path.join(root, 'docs', 'atex_role_input_walkthrough_3027.md');
const indexPath = path.join(root, 'docs', 'atex_workplaces.md');
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'atex_metadata.json'), 'utf8'));

assert(fs.existsSync(docPath), 'docs/atex_role_input_walkthrough_3027.md exists');
const doc = fs.readFileSync(docPath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');

function includes(text, message) {
    assert(doc.includes(text), message || 'document includes ' + text);
}

[
    '#3027',
    'АТХ-3027',
    'Менеджер',
    'Диспетчер',
    'Оператор',
    'нетиповая резка',
    'вводит',
    'нажимает',
    'Создать заказ',
    'Сохранить позицию',
    'Сохранить',
    'Создать резку',
    'Привязать к резке',
    '+ Добавить задание',
    '→ В работе',
    '→ Готово',
    '_m_new',
    '_m_set'
].forEach(function(text) {
    includes(text);
});

assert(
    /Менеджер[\s\S]*Создать заказ[\s\S]*Сохранить позицию/.test(doc),
    'manager section covers creating an order and saving a position'
);
assert(
    /Диспетчер[\s\S]*нетиповая резка[\s\S]*Сохранить[\s\S]*Создать резку[\s\S]*Привязать к резке/.test(doc),
    'dispatcher section covers cut calculation, production planning, and linking supply'
);
assert(
    /Оператор[\s\S]*\+ Добавить задание[\s\S]*→ В работе[\s\S]*→ Готово/.test(doc),
    'operator section covers sleeve task entry and button-driven status transitions'
);
assert(
    index.includes('atex_role_input_walkthrough_3027.md'),
    'docs/atex_workplaces.md links the issue #3027 input walkthrough'
);

function byName(name) {
    const item = metadata.find(function(t) { return t.val === name; });
    assert(item, 'metadata contains table ' + name);
    return item;
}

function reqId(meta, name) {
    const item = (meta.reqs || []).find(function(r) { return r.val === name; });
    assert(item, meta.val + ' contains requisite ' + name);
    return String(item.id);
}

// Orders workspace: manager creates a real order and a subordinate position.
const ordersSource = fs.readFileSync(path.join(root, 'download', 'atex', 'js', 'orders.js'), 'utf8');
const ordersSandbox = {
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
ordersSandbox.window.window = ordersSandbox.window;
ordersSandbox.window.document = ordersSandbox.document;
vm.runInNewContext(ordersSource, ordersSandbox, { filename: 'download/atex/js/orders.js' });

const orderHelpers = ordersSandbox.window.AtexOrdersTesting;
const orderMeta = byName('Заказ');
const positionMeta = byName('Позиция заказа');
const orderColumns = orderHelpers.buildColumns(orderHelpers.ORDER_FIELDS, orderMeta);
const positionColumns = orderHelpers.buildColumns(orderHelpers.POSITION_FIELDS, positionMeta);

const createOrder = orderHelpers.buildCreateOrderRequest({
    db: 'atex',
    tableId: orderMeta.id,
    columns: orderColumns,
    clientId: '1936',
    managerId: '1630',
    created: '2026-05-31',
    status: 'Новый',
    notes: 'АТХ-3027: клиент просит: нетиповая резка 57x10+40x8',
    xsrf: 'TOK'
});
assert.strictEqual(createOrder.url, '/atex/_m_new/' + orderMeta.id + '?JSON&up=1', 'manager order is created through _m_new on the order table');
let body = new URLSearchParams(createOrder.body);
assert.strictEqual(body.get('t' + reqId(orderMeta, 'Клиент')), '1936', 'order records the selected client');
assert.strictEqual(body.get('t' + reqId(orderMeta, 'Пользователь')), '1630', 'order records the manager user');
assert.strictEqual(body.get('t' + reqId(orderMeta, 'Примечания')), 'АТХ-3027: клиент просит: нетиповая резка 57x10+40x8', 'order carries the non-standard cut request');

const createPosition = orderHelpers.buildCreatePositionRequest({
    db: 'atex',
    tableId: positionMeta.id,
    columns: positionColumns,
    orderId: '30027',
    qty: '10',
    rawId: '1237',
    cutTypeId: '302704',
    width: '57',
    length: '1200',
    sleeve: '76',
    status: 'Новая',
    xsrf: 'TOK'
});
assert.strictEqual(createPosition.url, '/atex/_m_new/' + positionMeta.id + '?JSON&up=30027', 'position is created as a child of the manager order');
body = new URLSearchParams(createPosition.body);
assert.strictEqual(body.get('t' + reqId(positionMeta, 'Тип резки')), '302704', 'position uses the calculated non-standard cut type');
assert.strictEqual(body.get('t' + reqId(positionMeta, 'Ширина, мм')), '57', 'position records the requested roll width');

const positionStatus = orderHelpers.buildSetStatusRequest({
    db: 'atex',
    objId: '30028',
    statusReqId: reqId(positionMeta, 'Статус'),
    statusValue: 'В работе',
    xsrf: 'TOK'
});
assert.strictEqual(positionStatus.url, '/atex/_m_set/30028?JSON', 'position status transition is a write, not a dashboard read');

// Cut calculation workspace: dispatcher enters the non-standard cut geometry.
const cutCalc = require('../download/atex/js/cut-calc.js');
const cutSummary = cutCalc.calc.computeSummary('910', [
    { width: '57', qty: '10' },
    { width: '40', qty: '8' }
], '25');
assert.deepStrictEqual(cutSummary, {
    totalKnives: 18,
    usedWidth: 890,
    remainder: 20,
    withinTolerance: true
}, 'non-standard 57x10+40x8 cut is calculated from user-entered strips');

// Production planning workspace: dispatcher creates a cut and links it to the order position.
const productionPlanning = require('../download/atex/js/production-planning.js');
const planning = productionPlanning.planning;
const cutMeta = byName('Производственная резка');
const supplyMeta = byName('Обеспечение');

const cutFields = planning.buildFields({
    slitter: reqId(cutMeta, 'Слиттер'),
    cutType: reqId(cutMeta, 'Тип резки'),
    materialBatch: reqId(cutMeta, 'Партия сырья'),
    planDate: reqId(cutMeta, 'Дата план'),
    status: reqId(cutMeta, 'Статус'),
    notes: reqId(cutMeta, 'Примечания')
}, {
    slitter: '1290',
    cutType: '302704',
    materialBatch: '302706',
    planDate: '2026-06-01',
    status: 'В очереди',
    notes: 'АТХ-3027: планирование после расчета нетиповой резки'
});
assert.strictEqual(cutFields['t' + reqId(cutMeta, 'Тип резки')], '302704', 'planned production cut references the calculated cut type');
assert.strictEqual(cutFields['t' + reqId(cutMeta, 'Статус')], 'В очереди', 'planned production cut enters the queue');

const supplyFields = planning.buildFields({
    footage: reqId(supplyMeta, 'Метраж, м'),
    cut: reqId(supplyMeta, 'Производственная резка'),
    status: reqId(supplyMeta, 'Статус')
}, {
    footage: '1200',
    cut: '302710',
    status: 'Зарезервировано'
});
assert.strictEqual(supplyFields['t' + reqId(supplyMeta, 'Производственная резка')], '302710', 'supply links the order position to the created production cut');

// Sleeve cutter workspace: operator enters task data and advances by buttons.
const sleeve = require('../download/atex/js/sleeve-cutter.js');
assert.strictEqual(sleeve.core.nextStatus('Ожидает'), 'В работе', 'first sleeve button advances to work');
assert.strictEqual(sleeve.core.nextStatus('В работе'), 'Готово', 'second sleeve button finishes the task');
assert.deepStrictEqual(sleeve.core.summarize([
    { planQty: '10', factQty: '10', status: 'Готово' }
]), {
    total: 1,
    done: 1,
    planQty: 10,
    factQty: 10,
    percent: 100
}, 'sleeve task records user-entered plan/fact quantities');

console.log('issue-3027 atex role input walkthrough: ok');
