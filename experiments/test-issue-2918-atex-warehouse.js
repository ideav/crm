/*
 * Тест рабочего места atex «Склад готовой продукции» (issue #2918).
 *
 * Проверяет:
 *   1. Наличие шаблона/JS/CSS в ожидаемых путях.
 *   2. Шаблон подключает версионированные CSS/JS и не содержит inline-скриптов/стилей.
 *   3. update.conf раскладывает atex-артефакты.
 *   4. Чистые помощники из download/atex/js/warehouse.js (приёмочные критерии §3.8):
 *        - привязка полей таблиц 113/109/110 к реквизитам по имени;
 *        - оприходование партии ГП: _m_new/113?JSON&up=1 + реквизиты,
 *          первая колонка (дата прихода) НЕ задаётся (сервер ставит now);
 *        - смена статуса партии (Есть → Зарезервирован → Отгружен) через _m_set;
 *        - FIFO-списание: _m_set у «Обеспечение», реквизит «Партия ГП»;
 *        - FIFO-подбор партии (самая ранняя доступная для нужной резки);
 *        - разбор ответа JSON_DATA в записи (ссылки "id:label").
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const templatePath = path.join(root, 'templates', 'atex', 'warehouse.html');
const scriptPath = path.join(root, 'download', 'atex', 'js', 'warehouse.js');
const stylePath = path.join(root, 'download', 'atex', 'css', 'warehouse.css');
const updateConfPath = path.join(root, 'update.conf');

assert(fs.existsSync(templatePath), 'templates/atex/warehouse.html exists');
assert(fs.existsSync(scriptPath), 'download/atex/js/warehouse.js exists');
assert(fs.existsSync(stylePath), 'download/atex/css/warehouse.css exists');

const template = fs.readFileSync(templatePath, 'utf8');
assert(template.includes('/download/{_global_.z}/css/warehouse.css?0{_global_.version}'), 'template loads versioned CSS');
assert(template.includes('/download/{_global_.z}/js/warehouse.js?0{_global_.version}'), 'template loads versioned JS');
assert(!/<script\b(?![^>]*\bsrc=)/i.test(template), 'template does not contain inline scripts');
assert(!/<style\b/i.test(template), 'template does not contain inline styles');
assert(template.includes('id="atex-warehouse-app"'), 'template contains the app root');
assert(!template.includes('data-batch-table="113"'), 'template does not hardcode the GP batch table id');
assert(!template.includes('data-provision-table="109"'), 'template does not hardcode the provision table id');
assert(!template.includes('data-cutting-table="110"'), 'template does not hardcode the cutting table id');

const updateConf = fs.readFileSync(updateConfPath, 'utf8');
assert(updateConf.includes('templates/atex/* : /var/www/www-root/data/www/ideav.ru/templates/custom/ateh/'), 'update.conf deploys atex templates');
assert(updateConf.includes('download/atex/js/* : /var/www/www-root/data/www/ideav.ru/download/ateh/js/'), 'update.conf deploys atex js');
assert(updateConf.includes('download/atex/css/* : /var/www/www-root/data/www/ideav.ru/download/ateh/css/'), 'update.conf deploys atex css');

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
    Date,
    setTimeout,
    clearTimeout,
    fetch: function() {
        throw new Error('fetch should not be called by helper tests');
    }
};
sandbox.window.window = sandbox.window;
sandbox.window.document = sandbox.document;

vm.runInNewContext(source, sandbox, { filename: scriptPath });

const helpers = sandbox.window.AtexWarehouseTesting;
assert(helpers, 'AtexWarehouseTesting helper API is exposed');

// --- Метаданные из docs/atex_metadata.json (таблицы резолвятся по имени) ---
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'atex_metadata.json'), 'utf8'));
const resolvedTables = helpers.resolveTableMetadata(metadata, helpers.TABLE, {});
const batchMeta = resolvedTables.batch;
const provisionMeta = resolvedTables.provision;
const cuttingMeta = resolvedTables.cutting;
assert(batchMeta && provisionMeta && cuttingMeta, 'metadata for tables 113/109/110 found');
assert.strictEqual(batchMeta.id, '113', 'GP batch table id resolved from metadata');
assert.strictEqual(provisionMeta.id, '109', 'provision table id resolved from metadata');
assert.strictEqual(cuttingMeta.id, '110', 'cutting table id resolved from metadata');

const batchColumns = helpers.buildColumns(helpers.BATCH_FIELDS, batchMeta);
const provisionColumns = helpers.buildColumns(helpers.PROVISION_FIELDS, provisionMeta);
const cuttingColumns = helpers.buildColumns(helpers.CUTTING_FIELDS, cuttingMeta);

function reqId(columns, key) {
    return columns.filter(function(c) { return c.key === key; })[0].reqId;
}
function column(columns, key) {
    return columns.filter(function(c) { return c.key === key; })[0];
}

// «Дата прихода» — первая колонка таблицы 113 (main), её reqId = id таблицы.
assert.strictEqual(column(batchColumns, 'arrived').main, true, 'arrived is the main (first) column');
assert.strictEqual(reqId(batchColumns, 'arrived'), '113', 'arrived main column maps to the table id source');

// Привязка реквизитов партии ГП по имени.
assert.strictEqual(reqId(batchColumns, 'cutting'), '1126', 'batch cutting → req 1126');
assert.strictEqual(reqId(batchColumns, 'width'), '1128', 'batch width → req 1128');
assert.strictEqual(reqId(batchColumns, 'rolls'), '1130', 'batch rolls → req 1130');
assert.strictEqual(reqId(batchColumns, 'length'), '1132', 'batch length → req 1132');
assert.strictEqual(reqId(batchColumns, 'address'), '1134', 'batch address → req 1134');
assert.strictEqual(reqId(batchColumns, 'status'), '1136', 'batch status → req 1136');
assert.strictEqual(reqId(batchColumns, 'active'), null, 'batch active is optional in the old fixture metadata');
assert.strictEqual(column(batchColumns, 'cutting').ref, true, 'batch cutting is a reference column');

// Привязка реквизитов обеспечения.
assert.strictEqual(reqId(provisionColumns, 'length'), '1082', 'provision length → req 1082');
assert.strictEqual(reqId(provisionColumns, 'cutting'), '1084', 'provision cutting → req 1084');
assert.strictEqual(reqId(provisionColumns, 'batch'), '1086', 'provision batch → req 1086');
assert.strictEqual(reqId(provisionColumns, 'rolls'), null, 'provision rolls is optional in the old fixture metadata');
assert.strictEqual(reqId(provisionColumns, 'status'), '1088', 'provision status → req 1088');
assert.strictEqual(column(provisionColumns, 'batch').ref, true, 'provision batch is a reference column');

// Привязка реквизитов резки.
assert.strictEqual(reqId(cuttingColumns, 'status'), '1098', 'cutting status → req 1098');

// --- Оприходование партии ГП: _m_new/113?JSON&up=1 + реквизиты ---
const createBatch = helpers.buildCreateBatchRequest({
    db: 'atex',
    tableId: '113',
    columns: batchColumns,
    cuttingId: '210',
    width: '500',
    rolls: '4',
    length: '1200',
    address: 'A-12',
    status: 'Есть',
    xsrf: 'TOK'
});
assert.strictEqual(createBatch.url, '/atex/_m_new/113?JSON&up=1', 'batch create URL targets table 113, up=1');
const batchBody = new URLSearchParams(createBatch.body);
assert.strictEqual(batchBody.get('_xsrf'), 'TOK', 'batch create carries xsrf');
assert.strictEqual(batchBody.get('t1126'), '210', 'batch create sets cutting ref');
assert.strictEqual(batchBody.get('t1128'), '500', 'batch create sets width');
assert.strictEqual(batchBody.get('t1130'), '4', 'batch create sets rolls');
assert.strictEqual(batchBody.get('t1132'), '1200', 'batch create sets length');
assert.strictEqual(batchBody.get('t1134'), 'A-12', 'batch create sets storage address');
assert.strictEqual(batchBody.get('t1136'), 'Есть', 'batch create sets status');
// Дата прихода (первая колонка) НЕ передаётся — сервер ставит now.
assert.strictEqual(batchBody.get('t113'), null, 'batch create does not set the arrival datetime (server defaults it)');

const batchColumnsWithActive = batchColumns.map(function(c) {
    return c.key === 'active'
        ? Object.assign({}, c, { reqId: '1999' })
        : c;
});
const createActiveBatch = helpers.buildCreateBatchRequest({
    db: 'atex',
    tableId: '113',
    columns: batchColumnsWithActive,
    cuttingId: '210',
    width: '500',
    rolls: '4',
    length: '1200',
    address: 'A-12',
    status: 'Есть',
    active: '1',
    xsrf: 'TOK'
});
assert.strictEqual(new URLSearchParams(createActiveBatch.body).get('t1999'), '1', 'batch create sets active=1 when the field exists');

// --- #3433: оприходование фиксирует ФАКТ в «Кол-во факт»; FIFO-остаток по факту ---
const batchColumns3433 = helpers.BATCH_FIELDS.map(function(c) {
    var ids = { actual: '2001', planned: '2002', orderId: '2003' };
    return ids[c.key] ? Object.assign({}, c, { reqId: ids[c.key] }) : c;
});
const createFactBatch = helpers.buildCreateBatchRequest({
    db: 'atex', tableId: '113', columns: batchColumns3433,
    cuttingId: '210', width: '500', actual: '4', length: '1200', address: 'A-12', status: 'Есть', xsrf: 'TOK'
});
const factBody = new URLSearchParams(createFactBatch.body);
assert.strictEqual(factBody.get('t2001'), '4', '#3433: оприходование пишет введённое кол-во в «Кол-во факт» (t2001)');
assert.strictEqual(factBody.get('t1130'), null, '#3433: «Кол-во рулонов» (спрос) при оприходовании не задаётся');

// batchRolls: фактический остаток = факт; фолбэк рулоны(спрос) → план.
assert.strictEqual(helpers.batchRolls({ values: { actual: '4', rolls: '9', planned: '12' } }), 4, '#3433: batchRolls — приоритет «Кол-во факт»');
assert.strictEqual(helpers.batchRolls({ values: { rolls: '9', planned: '12' } }), 9, '#3433: batchRolls — фолбэк на «Кол-во рулонов»');
assert.strictEqual(helpers.batchRolls({ values: { planned: '12' } }), 12, '#3433: batchRolls — фолбэк на «Кол-во план»');
assert.strictEqual(helpers.batchRolls({ values: {} }), 0, '#3433: batchRolls — ничего не задано → 0');
// FIFO-списание учитывает факт (а не спрос): партия с фактом 4 исчерпывается обеспечением 4.
assert.strictEqual(helpers.batchExhaustedByProvision({ values: { actual: '4', rolls: '99' } }, { values: { rolls: '4' } }), true, '#3433: batchExhaustedByProvision по «Кол-во факт»');

// --- Смена статуса партии: _m_set/{id}?JSON (статус — не первая колонка) ---
const setStatus = helpers.buildSetStatusRequest({
    db: 'atex',
    objId: '900',
    statusReqId: reqId(batchColumns, 'status'),
    statusValue: 'Зарезервирован',
    xsrf: 'TOK'
});
assert.strictEqual(setStatus.url, '/atex/_m_set/900?JSON', 'status change uses _m_set');
assert.strictEqual(new URLSearchParams(setStatus.body).get('t1136'), 'Зарезервирован', 'status change sets new value');
// Полный цикл статусов из приёмки.
assert.deepStrictEqual(Array.from(helpers.DEFAULT_BATCH_STATUSES), ['Есть', 'Зарезервирован', 'Отгружен'], 'batch statuses cover Есть → Зарезервирован → Отгружен');

// --- FIFO-списание: _m_set у «Обеспечение», реквизит «Партия ГП» ---
const assign = helpers.buildAssignBatchRequest({
    db: 'atex',
    provisionId: '720',
    batchReqId: reqId(provisionColumns, 'batch'),
    batchId: '900',
    statusReqId: reqId(provisionColumns, 'status'),
    statusValue: 'Зарезервировано',
    xsrf: 'TOK'
});
assert.strictEqual(assign.url, '/atex/_m_set/720?JSON', 'write-off uses _m_set on the provision');
const assignBody = new URLSearchParams(assign.body);
assert.strictEqual(assignBody.get('t1086'), '900', 'write-off references the GP batch on the provision');
assert.strictEqual(assignBody.get('t1088'), 'Зарезервировано', 'write-off updates provision status');

// --- FIFO-подбор партии: самая ранняя доступная для нужной резки ---
const batches = helpers.normalizeObjects([
    { i: 901, u: 1, o: 1, r: ['2026-05-20 10:00', '210:Резка №210', '500', '4', '1200', 'A-12', 'Есть'] },
    { i: 902, u: 1, o: 2, r: ['2026-05-18 09:00', '210:Резка №210', '500', '3', '900', 'A-13', 'Есть'] },
    { i: 903, u: 1, o: 3, r: ['2026-05-15 09:00', '210:Резка №210', '500', '2', '600', 'A-14', 'Отгружен'] },
    { i: 904, u: 1, o: 4, r: ['2026-05-10 09:00', '211:Резка №211', '400', '1', '300', 'B-01', 'Есть'] }
], batchColumns);
const fifo = helpers.pickFifoBatch(batches, '210', 'Есть');
assert(fifo, 'FIFO picks a batch');
assert.strictEqual(fifo.id, '902', 'FIFO picks the earliest available batch for cutting 210 (902, not the shipped 903 nor the later 901)');
const batchesWithInactive = batches.concat([{
    id: '890',
    values: { arrived: '2026-05-01 09:00', cutting: 'Резка №210', status: 'Есть', active: '0' },
    refs: { cutting: '210' }
}]);
assert.strictEqual(helpers.pickFifoBatch(batchesWithInactive, '210', 'Есть').id, '902', 'FIFO skips inactive GP batches');
// Резка без доступных партий → null.
assert.strictEqual(helpers.pickFifoBatch(batches, '999', 'Есть'), null, 'FIFO returns null when no available batch matches the cutting');
assert.strictEqual(helpers.isActiveBatch({ values: { active: '0' } }), false, 'isActiveBatch: 0 → false');
assert.strictEqual(helpers.isActiveBatch({ values: { active: '' } }), true, 'isActiveBatch: empty active flag defaults to true');
assert.strictEqual(helpers.batchExhaustedByProvision({ values: { rolls: '4' } }, { values: { rolls: '4' } }), true, 'batchExhaustedByProvision: equal rolls exhaust the batch');
assert.strictEqual(helpers.batchExhaustedByProvision({ values: { rolls: '4' } }, { values: { rolls: '2' } }), false, 'batchExhaustedByProvision: partial rolls do not exhaust the batch');

// --- Разбор ответа JSON_DATA (ссылки разбираются как "id:label") ---
assert.strictEqual(batches[0].values.cutting, 'Резка №210', 'batch cutting label parsed from ref');
assert.strictEqual(batches[0].refs.cutting, '210', 'batch cutting id parsed from ref');
assert.strictEqual(batches[0].values.address, 'A-12', 'batch storage address parsed');
assert.strictEqual(batches[0].values.status, 'Есть', 'batch status parsed');
assert.strictEqual(batches[0].values.arrived, '2026-05-20 10:00', 'batch arrival datetime parsed from main column');

const provisions = helpers.normalizeObjects([
    { i: 720, u: 660, o: 1, r: ['Обеспечение 720', '1200', '210:Резка №210', '900:Партия 900', 'Зарезервировано'] }
], provisionColumns);
assert.strictEqual(provisions[0].up, '660', 'provision linked to order position 660 via up');
assert.strictEqual(provisions[0].refs.batch, '900', 'provision GP batch id parsed from ref');
assert.strictEqual(provisions[0].values.cutting, 'Резка №210', 'provision cutting label parsed');

// --- Завершённые резки имеют приоритет для оприходования ---
const cuttings = helpers.normalizeObjects([
    { i: 210, u: 1, o: 1, r: ['210', '1:Слиттер-1', '2:Прямая', '5:Партия', '2026-05-01', 'Завершён', '', '', '', '', '', '', '', ''] },
    { i: 211, u: 1, o: 2, r: ['211', '1:Слиттер-1', '2:Прямая', '6:Партия', '2026-05-02', 'В работе', '', '', '', '', '', '', '', ''] }
], cuttingColumns);
assert.strictEqual(helpers.isCompletedCutting(cuttings[0]), true, 'cutting 210 recognised as completed');
assert.strictEqual(helpers.isCompletedCutting(cuttings[1]), false, 'cutting 211 not completed');
const done = helpers.completedCuttings(cuttings);
assert.strictEqual(done.length, 1, 'only the completed cutting is offered for receiving');
assert.strictEqual(done[0].id, '210', 'completed cutting 210 offered');

// --- Прочие помощники ---
assert.strictEqual(helpers.extractNewObjectId({ obj: 900 }), '900', 'new object id extracted from {obj}');
assert.strictEqual(helpers.extractNewObjectId({ id: 901 }), '901', 'new object id extracted from {id}');
assert.strictEqual(helpers.parseRef('210:Резка №210').id, '210', 'parseRef splits id');
assert.strictEqual(helpers.normalizeFieldName('Адрес хранения'), 'адресхранения', 'field name normalized');

console.log('issue-2918 atex warehouse workspace: ok');
