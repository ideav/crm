/*
 * Тест рабочего места atex «Клиентский портал» (issue #2920).
 *
 * Проверяет:
 *   1. Наличие шаблона/JS/CSS в ожидаемых путях.
 *   2. Шаблон подключает версионированные CSS/JS, не содержит inline-скриптов/стилей
 *      и пробрасывает логин пользователя в data-атрибут (для изоляции по клиенту).
 *   3. update.conf раскладывает atex-артефакты (js/css/templates).
 *   4. Чистые помощники из download/atex/js/portal.js:
 *      - резолвят реквизиты «Заказ»/«Позиция»/«Клиент» по имени из metadata;
 *      - сопоставляют текущего пользователя с клиентом по «Логину»;
 *      - фильтруют заказы по клиенту (приёмочный критерий: только свои заказы);
 *      - разбирают список JSON_DATA и ссылки "id:label".
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const templatePath = path.join(root, 'templates', 'atex', 'portal.html');
const scriptPath = path.join(root, 'download', 'atex', 'js', 'portal.js');
const stylePath = path.join(root, 'download', 'atex', 'css', 'portal.css');
const updateConfPath = path.join(root, 'update.conf');

assert(fs.existsSync(templatePath), 'templates/atex/portal.html exists');
assert(fs.existsSync(scriptPath), 'download/atex/js/portal.js exists');
assert(fs.existsSync(stylePath), 'download/atex/css/portal.css exists');

const template = fs.readFileSync(templatePath, 'utf8');
assert(template.includes('/download/{_global_.z}/css/portal.css?0{_global_.version}'), 'template loads versioned CSS');
assert(template.includes('/download/{_global_.z}/js/portal.js?0{_global_.version}'), 'template loads versioned JS');
assert(!/<script\b(?![^>]*\bsrc=)/i.test(template), 'template does not contain inline scripts');
assert(!/<style\b/i.test(template), 'template does not contain inline styles');
assert(template.includes('id="atex-portal-app"'), 'template contains the app root');
assert(template.includes('data-order-table="107"'), 'template wires the order table id');
assert(template.includes('data-position-table="108"'), 'template wires the position table id');
assert(template.includes('data-client-table="103"'), 'template wires the client table id');
assert(template.includes('data-user="{_global_.user}"'), 'template passes the current login for client isolation');

const updateConf = fs.readFileSync(updateConfPath, 'utf8');
assert(updateConf.includes('templates/atex/* : /var/www/www-root/data/www/ideav.ru/templates/custom/atex/'), 'update.conf deploys atex templates');
assert(updateConf.includes('download/atex/js/* : /var/www/www-root/data/www/ideav.ru/download/atex/js/'), 'update.conf deploys atex js');
assert(updateConf.includes('download/atex/css/* : /var/www/www-root/data/www/ideav.ru/download/atex/css/'), 'update.conf deploys atex css');

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

const helpers = sandbox.window.AtexPortalTesting;
assert(helpers, 'AtexPortalTesting helper API is exposed');

// --- Метаданные из docs/atex_metadata.json (таблицы 103/107/108) ---
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'atex_metadata.json'), 'utf8'));
function tableById(id) {
    return metadata.filter(function(t) { return String(t.id) === String(id); })[0];
}
const orderMeta = tableById('107');
const positionMeta = tableById('108');
const clientMeta = tableById('103');
assert(orderMeta && positionMeta && clientMeta, 'metadata for tables 103/107/108 found');

const orderColumns = helpers.buildColumns(helpers.ORDER_FIELDS, orderMeta);
const positionColumns = helpers.buildColumns(helpers.POSITION_FIELDS, positionMeta);
const clientColumns = helpers.buildColumns(helpers.CLIENT_FIELDS, clientMeta);

function reqId(columns, key) {
    return columns.filter(function(c) { return c.key === key; })[0].reqId;
}

// «Клиент» в заказе — ссылка на таблицу 103 (req 1052); «Логин» клиента — req 1017.
assert.strictEqual(reqId(orderColumns, 'client'), '1052', 'order client → req 1052');
assert.strictEqual(reqId(orderColumns, 'status'), '1060', 'order status → req 1060');
assert.strictEqual(reqId(clientColumns, 'login'), '1017', 'client login → req 1017');
assert.strictEqual(orderColumns.filter(function(c) { return c.key === 'client'; })[0].ref, true, 'client is a reference column');

// --- Список заказов: object/107?JSON_DATA (фильтр по клиенту делаем на клиенте) ---
const listUrl = helpers.buildListUrl('atex', '107', null, null, '');
assert(listUrl.indexOf('/atex/object/107/?') === 0, 'orders list hits object/107');
assert(listUrl.indexOf('JSON_DATA') !== -1, 'orders list requests JSON_DATA');

const clientListUrl = helpers.buildListUrl('atex', '103', null, null, '');
assert(clientListUrl.indexOf('/atex/object/103/?') === 0, 'clients list hits object/103');

const posListUrl = helpers.buildListUrl('atex', '108', '650', null, '');
assert(posListUrl.indexOf('F_U=650') !== -1, 'positions list filters by parent order via F_U');

// --- Разбор клиентов и сопоставление текущего пользователя по «Логину» ---
const clients = helpers.normalizeObjects([
    { i: 305, u: 1, o: 1, r: ['ООО «Ромашка»', 'client', '', 'romashka@example.com', ''] },
    { i: 306, u: 1, o: 2, r: ['АО «Лютик»', 'lutik', '', 'lutik@example.com', ''] }
], clientColumns);
assert.strictEqual(clients[0].name, 'ООО «Ромашка»', 'client main name parsed');
assert.strictEqual(clients[0].values.login, 'client', 'client login parsed');

const matched = helpers.resolveClient(clients, 'client', clientColumns);
assert(matched, 'current user matched to a client by login');
assert.strictEqual(matched.id, '305', 'client login "client" resolves to client 305');

// Сопоставление по имени клиента, если логин не задан.
const byName = helpers.resolveClient(clients, 'АО «Лютик»', clientColumns);
assert.strictEqual(byName.id, '306', 'client resolved by name fallback');

// Неизвестный пользователь не сопоставляется ни с одним клиентом.
assert.strictEqual(helpers.resolveClient(clients, 'stranger', clientColumns), null, 'unknown user resolves to null');

// --- Изоляция: фильтр заказов по клиенту (приёмочный критерий) ---
const orders = helpers.normalizeObjects([
    { i: 651, u: 1, o: 3, r: ['Заказ 651', '305:ООО «Ромашка»', '42:manager', '2026-05-28', '', 'Согласован', '', ''] },
    { i: 650, u: 1, o: 2, r: ['Заказ 650', '306:АО «Лютик»', '42:manager', '2026-05-27', '', 'В производстве', '', ''] },
    { i: 649, u: 1, o: 1, r: ['Заказ 649', '305:ООО «Ромашка»', '42:manager', '2026-05-26', '', 'Новый', '', ''] }
], orderColumns);
assert.strictEqual(orders[0].refs.client, '305', 'order client id parsed from ref');
assert.strictEqual(orders[0].values.client, 'ООО «Ромашка»', 'order client label parsed from ref');

const own = helpers.filterOrdersByClient(orders, '305');
assert.strictEqual(own.length, 2, 'client 305 sees exactly their two orders');
assert.deepStrictEqual(own.map(function(o) { return o.id; }).sort(), ['649', '651'], 'foreign order 650 is excluded');

// Без клиента — ничего не показываем (иначе утечка чужих заказов).
assert.strictEqual(helpers.filterOrdersByClient(orders, '').length, 0, 'no client → no orders');

// --- Прочие помощники ---
assert.strictEqual(helpers.parseRef('305:ООО «Ромашка»').id, '305', 'parseRef splits id');
assert.strictEqual(helpers.normalizeFieldName('Логин'), 'логин', 'field name normalized');
assert.strictEqual(helpers.DEFAULT_ORDER_STATUSES[0], 'Новый', 'default order statuses present');

console.log('issue-2920 atex client portal workspace: ok');
