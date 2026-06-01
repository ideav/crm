/*
 * Тест рабочего места atex «Приём и ведение заказов» (issue #2911).
 *
 * Проверяет:
 *   1. Наличие шаблона/JS/CSS в ожидаемых путях.
 *   2. Шаблон подключает версионированные CSS/JS и не содержит inline-скриптов/стилей.
 *   3. update.conf раскладывает atex-артефакты.
 *   4. Чистые помощники из download/atex/js/orders.js строят корректные запросы
 *      (приёмочный критерий: создание заказа up=1, позиции up={orderId},
 *      смена статусов через _m_set, разбор списка JSON_DATA, фильтр по статусу).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const templatePath = path.join(root, 'templates', 'atex', 'orders.html');
const scriptPath = path.join(root, 'download', 'atex', 'js', 'orders.js');
const stylePath = path.join(root, 'download', 'atex', 'css', 'orders.css');
const updateConfPath = path.join(root, 'update.conf');

assert(fs.existsSync(templatePath), 'templates/atex/orders.html exists');
assert(fs.existsSync(scriptPath), 'download/atex/js/orders.js exists');
assert(fs.existsSync(stylePath), 'download/atex/css/orders.css exists');

const template = fs.readFileSync(templatePath, 'utf8');
assert(template.includes('/download/{_global_.z}/css/orders.css?0{_global_.version}'), 'template loads versioned CSS');
assert(template.includes('/download/{_global_.z}/js/orders.js?0{_global_.version}'), 'template loads versioned JS');
assert(!/<script\b(?![^>]*\bsrc=)/i.test(template), 'template does not contain inline scripts');
assert(!/<style\b/i.test(template), 'template does not contain inline styles');
assert(template.includes('id="atex-orders-app"'), 'template contains the app root');
assert(!template.includes('data-order-table="107"'), 'template does not hardcode the order table id');
assert(!template.includes('data-position-table="108"'), 'template does not hardcode the position table id');

const updateConf = fs.readFileSync(updateConfPath, 'utf8');
assert(updateConf.includes('templates/atex/* : /var/www/www-root/data/www/ideav.ru/templates/custom/ateh/'), 'update.conf deploys atex templates to live ateh');
assert(updateConf.includes('download/atex/js/* : /var/www/www-root/data/www/ideav.ru/download/ateh/js/'), 'update.conf deploys atex js to live ateh');
assert(updateConf.includes('download/atex/css/* : /var/www/www-root/data/www/ideav.ru/download/ateh/css/'), 'update.conf deploys atex css to live ateh');

// --- Запуск исходника в песочнице без DOM/сети ---
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

// --- Метаданные из docs/atex_metadata.json (таблицы резолвятся по имени) ---
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'atex_metadata.json'), 'utf8'));
const resolvedTables = helpers.resolveTableMetadata(metadata, helpers.TABLE, {});
const orderMeta = resolvedTables.order;
const positionMeta = resolvedTables.position;
assert(orderMeta && positionMeta, 'metadata for tables 107/108 found');
assert.strictEqual(orderMeta.id, '107', 'order table id resolved from metadata');
assert.strictEqual(positionMeta.id, '108', 'position table id resolved from metadata');

// --- Привязка полей к реквизитам по имени ---
const orderColumns = helpers.buildColumns(helpers.ORDER_FIELDS, orderMeta);
const positionColumns = helpers.buildColumns(helpers.POSITION_FIELDS, positionMeta);

function reqId(columns, key) {
    return columns.filter(function(c) { return c.key === key; })[0].reqId;
}

// «Менеджер» в схеме называется «Пользователь» (alias=Менеджер) — алиас должен резолвиться.
assert.strictEqual(reqId(orderColumns, 'client'), '1052', 'client → req 1052');
assert.strictEqual(reqId(orderColumns, 'manager'), '1054', 'manager (Пользователь) → req 1054');
assert.strictEqual(reqId(orderColumns, 'status'), '1060', 'order status → req 1060');
assert.strictEqual(reqId(orderColumns, 'posCount'), '1066', 'posCount (Позиция заказа) → req 1066');
assert.strictEqual(reqId(positionColumns, 'qty'), '1067', 'qty → req 1067');
assert.strictEqual(reqId(positionColumns, 'raw'), '1069', 'raw → req 1069');
assert.strictEqual(reqId(positionColumns, 'cutType'), '1071', 'cutType → req 1071');
assert.strictEqual(reqId(positionColumns, 'status'), '1079', 'position status → req 1079');
assert.strictEqual(reqId(positionColumns, 'sleeve'), '1077', 'sleeve (Диаметр втулки) → req 1077');

// Ссылочные колонки должны помечаться как ref.
assert.strictEqual(orderColumns.filter(function(c) { return c.key === 'client'; })[0].ref, true, 'client is a reference column');
assert.strictEqual(positionColumns.filter(function(c) { return c.key === 'raw'; })[0].ref, true, 'raw is a reference column');
assert.strictEqual(positionColumns.filter(function(c) { return c.key === 'sleeve'; })[0].ref, true, 'sleeve (Диаметр втулки) is a reference column');

// --- Создание заказа: _m_new/107?JSON&up=1 + реквизиты ---
const createOrder = helpers.buildCreateOrderRequest({
    db: 'atex',
    tableId: '107',
    columns: orderColumns,
    clientId: '305',
    managerId: '42',
    created: '2026-05-29',
    status: 'Новый',
    notes: 'срочно',
    xsrf: 'TOK'
});
assert.strictEqual(createOrder.url, '/atex/_m_new/107?JSON&up=1', 'order create URL targets table 107, up=1');
const orderBody = new URLSearchParams(createOrder.body);
assert.strictEqual(orderBody.get('_xsrf'), 'TOK', 'order create carries xsrf');
assert.strictEqual(orderBody.get('t1052'), '305', 'order create sets client req');
assert.strictEqual(orderBody.get('t1054'), '42', 'order create sets manager req');
assert.strictEqual(orderBody.get('t1056'), '2026-05-29', 'order create sets created date');
assert.strictEqual(orderBody.get('t1060'), 'Новый', 'order create sets status');

// --- Создание позиции: _m_new/108?JSON&up={orderId} (привязка через up) ---
const createPos = helpers.buildCreatePositionRequest({
    db: 'atex',
    tableId: '108',
    columns: positionColumns,
    orderId: '649',
    qty: '10',
    rawId: '200',
    cutTypeId: '7',
    width: '500',
    length: '1000',
    sleeve: '210',
    status: 'Новая',
    xsrf: 'TOK'
});
assert.strictEqual(createPos.url, '/atex/_m_new/108?JSON&up=649', 'position create links to order via up=649');
const posBody = new URLSearchParams(createPos.body);
assert.strictEqual(posBody.get('t1067'), '10', 'position create sets qty');
assert.strictEqual(posBody.get('t1069'), '200', 'position create sets raw ref');
assert.strictEqual(posBody.get('t1071'), '7', 'position create sets cut type ref');
assert.strictEqual(posBody.get('t1077'), '210', 'position create sets sleeve ref (ссылка на запись справочника «Диаметр втулки»)');
assert.strictEqual(posBody.get('t1079'), 'Новая', 'position create sets status');

// --- Смена статуса заказа: _m_set/{id}?JSON (статус — не первая колонка) ---
const setOrderStatus = helpers.buildSetStatusRequest({
    db: 'atex',
    objId: '649',
    statusReqId: reqId(orderColumns, 'status'),
    statusValue: 'Согласован',
    xsrf: 'TOK'
});
assert.strictEqual(setOrderStatus.url, '/atex/_m_set/649?JSON', 'status change uses _m_set');
assert.strictEqual(new URLSearchParams(setOrderStatus.body).get('t1060'), 'Согласован', 'status change sets new value');

// --- Список заказов: object/107?JSON_DATA, позиции: F_U={orderId} ---
const listUrl = helpers.buildListUrl('atex', '107', null, null, '');
assert(listUrl.indexOf('/atex/object/107/?') === 0, 'orders list hits object/107');
assert(listUrl.indexOf('JSON_DATA') !== -1, 'orders list requests JSON_DATA');

const posListUrl = helpers.buildListUrl('atex', '108', '649', null, '');
assert(posListUrl.indexOf('F_U=649') !== -1, 'positions list filters by parent order via F_U');

// --- Разбор ответа JSON_DATA в записи (ссылки разбираются как "id:label") ---
const orders = helpers.normalizeObjects([
    { i: 649, u: 1, o: 1, r: ['Заказ 649', '305:Ромашка', '42:victor_g', '2026-05-29', '', 'Новый', '', '', '3'] }
], orderColumns);
assert.strictEqual(orders.length, 1, 'one order parsed');
assert.strictEqual(orders[0].id, '649', 'order id parsed');
assert.strictEqual(orders[0].values.client, 'Ромашка', 'client label parsed from ref');
assert.strictEqual(orders[0].refs.client, '305', 'client id parsed from ref');
assert.strictEqual(orders[0].values.status, 'Новый', 'order status parsed');
// Счётчик позиций приходит в записи заказа (ROLLUP «Позиция заказа») — список
// показывает его до ленивой загрузки самих позиций.
assert.strictEqual(orders[0].values.posCount, '3', 'order position count parsed from rollup column');

const positions = helpers.normalizeObjects([
    { i: 700, u: 649, o: 1, r: ['Позиция 700', '10', '200:Бумага', '7:Прямая', '500', '1000', '76', 'Новая'] }
], positionColumns);
assert.strictEqual(positions[0].up, '649', 'position linked to order 649 via up');
assert.strictEqual(positions[0].values.raw, 'Бумага', 'position raw label parsed');
assert.strictEqual(positions[0].values.status, 'Новая', 'position status parsed');

// --- Прочие помощники ---
assert.strictEqual(helpers.extractNewObjectId({ obj: 649 }), '649', 'new object id extracted from {obj}');
assert.strictEqual(helpers.parseRef('305:Ромашка').id, '305', 'parseRef splits id');
assert.strictEqual(helpers.parseRef('305:Ромашка').label, 'Ромашка', 'parseRef splits label');
assert.strictEqual(helpers.normalizeFieldName('Дата создания'), 'датасоздания', 'field name normalized');
assert.deepStrictEqual(helpers.DEFAULT_ORDER_STATUSES[0], 'Новый', 'default order statuses present');

console.log('issue-2911 atex orders workspace: ok');
