/*
 * Test for issue #3137: the minimal full-cycle project document should read
 * like a simple client request, not like an internal implementation guide.
 *
 * Run with: node experiments/test-issue-3137-client-style-doc.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const docRelPath = 'docs/integram-minimal-full-cycle-project.md';
const docPath = path.join(root, docRelPath);

assert(fs.existsSync(docPath), `${docRelPath} exists`);

const doc = fs.readFileSync(docPath, 'utf8');

function includes(text, message) {
    assert(doc.includes(text), message || `document includes ${text}`);
}

function excludes(text, message) {
    assert(!doc.includes(text), message || `document does not include ${text}`);
}

[
    '#3137',
    '# Заявка клиента: Мини-Atex - резка рулонов',
    'Пишу простыми словами, как мы обычно объясняем задачу подрядчику',
    'Как у нас сейчас',
    'Что хотим получить',
    'Файлы, которые мы дадим',
    'Как должна идти работа',
    'Кто будет пользоваться',
    'Что считаем готовым'
].forEach(function(text) {
    includes(text);
});

[
    'Справочники.xlsx',
    'Заказы.xlsx',
    'Клиент',
    'Вид сырья',
    'Заказ',
    'Позиция заказа',
    'Производственная резка',
    'Менеджер',
    'Диспетчер',
    'Оператор',
    'Руководитель'
].forEach(function(text) {
    includes(text, `client request keeps domain detail: ${text}`);
});

[
    'для ИИ-агента',
    'metadata?JSON=1',
    '_d_new',
    '_d_ref',
    '_m_new',
    'ref ->',
    'arr ->'
].forEach(function(text) {
    excludes(text, `client-style request should not use implementation wording: ${text}`);
});

console.log('issue-3137 client-style documentation checks passed.');
