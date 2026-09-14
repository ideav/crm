/*
 * РМ «Разметка токенов» (issue #4953): человек отмечает, чем является токен —
 * товаром, маркой или моделью, и от этого зависит признак ТММ и вес в подборе.
 *
 * Проверяется поведение чистых функций: разбор строки отчёта частотности, отбор
 * под фильтрами интерфейса и формирование значений записи. Последнее — самое
 * важное: снятый флажок обязан уезжать явным нулём, иначе пустое значение
 * выбрасывается из тела запроса и признак молча остаётся прежним.
 */
const assert = require('assert');
const path = require('path');

const workspace = require(path.join(__dirname, '..', 'download/xcom/js/xcom-tokens.js'));

// --- Разбор строки отчёта ---------------------------------------------------

const parsed = workspace.rowFromReport({
    'Токен': 'Картридж', ID: '811', 'Товар': 'X', 'Бренд': '', 'Модель': '',
    'Номенклатур': '3', 'Заявок': '2'
});
assert.strictEqual(parsed.id, '811');
assert.strictEqual(parsed.token, 'Картридж');
assert.strictEqual(parsed.sku, 3, 'частотность по номенклатуре — число');
assert.strictEqual(parsed.rfp, 2);
assert.deepStrictEqual(parsed.flags, { 'Товар': true, 'Бренд': false, 'Модель': false });

// Ядро отдаёт булев как 'X'; строка '0' — это СНЯТЫЙ флаг, а не «непустая строка».
assert.strictEqual(workspace.isTruthyFlag('X'), true);
assert.strictEqual(workspace.isTruthyFlag('1'), true);
assert.strictEqual(workspace.isTruthyFlag('0'), false, "'0' не должен читаться как отмеченный");
assert.strictEqual(workspace.isTruthyFlag(''), false);

// --- Фильтры интерфейса -----------------------------------------------------

const rows = [
    { id: '1', token: 'Картридж', sku: 3, rfp: 3, flags: { 'Товар': true, 'Бренд': false, 'Модель': false } },
    { id: '2', token: 'HP', sku: 3, rfp: 3, flags: { 'Товар': false, 'Бренд': false, 'Модель': false } },
    { id: '3', token: '2700стр', sku: 1, rfp: 0, flags: { 'Товар': false, 'Бренд': false, 'Модель': false } }
];

const names = (list) => list.map(row => row.token);
assert.deepStrictEqual(names(workspace.filterRows(rows, {})), ['Картридж', 'HP', '2700стр']);
assert.deepStrictEqual(names(workspace.filterRows(rows, { onlyEmpty: true })), ['HP', '2700стр'],
    'размеченные уходят из очереди работы');
assert.deepStrictEqual(names(workspace.filterRows(rows, { hideRare: true })), ['Картридж', 'HP'],
    'одиночные токены прячутся: на результат они почти не влияют');
assert.deepStrictEqual(names(workspace.filterRows(rows, { search: 'кар' })), ['Картридж'],
    'поиск без учёта регистра по подстроке');
assert.deepStrictEqual(names(workspace.filterRows(rows, { search: 'hp', onlyEmpty: true })), ['HP'],
    'фильтры складываются');

// --- Значения для записи ----------------------------------------------------

const reqIds = { 'Товар': '508', 'Бренд': '506', 'Модель': '510' };
const form = workspace.flagsToForm({ 'Товар': true, 'Бренд': false, 'Модель': false }, reqIds);
const pairs = Object.fromEntries(new URLSearchParams(form));
assert.strictEqual(pairs.t508, '1', 'отмеченный признак пишется единицей');
assert.strictEqual(pairs.t506, '0', 'снятый признак пишется НУЛЁМ, а не пустым значением');
assert.strictEqual(pairs.t510, '0');
assert.strictEqual(Object.keys(pairs).length, 3, 'лишних полей в запрос не уходит');

// Реквизита нет в схеме — поле молча пропускается, а не уезжает как 'tundefined='.
const partial = Object.fromEntries(new URLSearchParams(workspace.flagsToForm({ 'Товар': true }, { 'Товар': '508' })));
assert.deepStrictEqual(partial, { t508: '1' });

// --- Счётчик прогресса ------------------------------------------------------

assert.strictEqual(workspace.countMarked(rows), 1);
assert.strictEqual(workspace.countMarked([]), 0);

console.log('OK: test-issue-4953-xcom-tokens');
