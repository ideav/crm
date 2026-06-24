/*
 * Regression tests for issue #3682.
 *
 * На боевой схеме atex таблица позиций — «Заказанное количество», а её qty («Кол-во»)
 * хранится в ПЕРВОЙ колонке записи (главное значение), отдельного реквизита нет.
 * Первую колонку ставит только _m_save (t{id_типа}); _m_set к ней неприменим
 * (docs/MCP.md §6–7). Раньше правка ячейки qty уходила в _m_set и молча не сохранялась —
 * savePositionCell теперь выбирает команду через positionWriteCommand.
 *
 * Проверяем:
 *   • новая схема: qty → writeKey == id таблицы → команда _m_save;
 *   • реквизиты (dueDate, raw, …) → _m_set, и резолвятся в реальные id;
 *   • старая схема («Позиция заказа», «Кол-во» = реквизит 1067) → _m_set (как раньше).
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
    document: { readyState: 'loading', addEventListener: function() {}, getElementById: function() { return null; } },
    console, URLSearchParams, URL, setTimeout, clearTimeout,
    fetch: function() { throw new Error('fetch should not be called by helper tests'); }
};
sandbox.window.window = sandbox.window;
sandbox.window.document = sandbox.document;
vm.runInNewContext(source, sandbox, { filename: scriptPath });

const h = sandbox.window.AtexOrdersTesting;
assert(h, 'AtexOrdersTesting helper API is exposed');

function writeKey(cols, key, tableId) { return h.positionWriteKey(h.getColumn(cols, key), tableId); }
function cmd(cols, key, tableId) { return h.positionWriteCommand(writeKey(cols, key, tableId), tableId); }

// positionWriteCommand: первую колонку (writeKey == tableId) — только _m_save; иначе _m_set.
assert.strictEqual(h.positionWriteCommand('1076', '1076'), '_m_save', 'первая колонка → _m_save');
assert.strictEqual(h.positionWriteCommand('8627', '1076'), '_m_set', 'реквизит → _m_set');

// ── Новая схема: «Заказанное количество» (id 1076), qty = первая колонка (реквизита нет) ──
// Реквизиты — реальные id из metadata ateh (сверено с записью 82754).
const NEW_TABLE = '1076';
const newCols = h.buildColumns(h.POSITION_FIELDS, {
    id: NEW_TABLE, val: 'Заказанное количество', type: '13',
    reqs: [
        { id: '1138', val: 'Вид сырья', type: '3', ref: '1069', ref_id: '1100' },
        { id: '1141', val: 'Ширина, мм', type: '14' },
        { id: '1143', val: 'Длина, м', type: '14' },
        { id: '16325', val: 'Статус позиции', type: '3', ref: '16323', ref_id: '16324' },
        { id: '8194', val: 'Диаметр втулки', type: '3', ref: '8188', ref_id: '8193' },
        { id: '8463', val: 'Тип намотки', type: '3' },
        { id: '8627', val: 'Срок изготовления', type: '9' }
    ]
});

// qty не имеет собственного реквизита → writeKey == id таблицы → _m_save (это и есть фикс).
assert.strictEqual(writeKey(newCols, 'qty', NEW_TABLE), NEW_TABLE, 'new: qty writeKey == tableId (первая колонка)');
assert.strictEqual(cmd(newCols, 'qty', NEW_TABLE), '_m_save', 'new: правка qty идёт через _m_save');

// Прочие поля позиции существуют в БД, резолвятся по смыслу и пишутся через _m_set.
const reqMap = { raw: '1138', width: '1141', length: '1143', sleeve: '8194', winding: '8463', status: '16325', dueDate: '8627' };
Object.keys(reqMap).forEach(function(k) {
    assert.strictEqual(writeKey(newCols, k, NEW_TABLE), reqMap[k], 'new: ' + k + ' → реквизит ' + reqMap[k]);
    assert.strictEqual(cmd(newCols, k, NEW_TABLE), '_m_set', 'new: ' + k + ' (реквизит) → _m_set');
});

// ── Старая схема: «Позиция заказа», «Кол-во» = реквизит 1067 → _m_set (поведение не меняется) ──
const OLD_TABLE = '108';
const oldCols = h.buildColumns(h.POSITION_FIELDS, {
    id: OLD_TABLE, val: 'Позиция заказа', type: '13',
    reqs: [ { id: '1067', val: 'Кол-во', type: '13' }, { id: '1159', val: 'Срок изготовления', type: '9' } ]
});
assert.strictEqual(writeKey(oldCols, 'qty', OLD_TABLE), '1067', 'old: qty → реквизит 1067');
assert.strictEqual(cmd(oldCols, 'qty', OLD_TABLE), '_m_set', 'old: qty-реквизит → _m_set (как раньше)');

console.log('issue-3682 atex orders qty save: ok');
