/*
 * Test for issue #2986: the docs need one minimal end-to-end project example
 * that connects user spreadsheets, business entities, roles, screens, data, and
 * acceptance criteria without requiring the reader to assemble Atex fragments.
 *
 * Run with: node experiments/test-issue-2986-minimal-full-cycle-doc.js
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

[
    '#2986',
    '#3137',
    'Заявка клиента: Мини-Atex - резка рулонов',
    'Как у нас сейчас',
    'Что хотим получить',
    'Файлы, которые мы дадим',
    'Что должно получиться из файлов',
    'Кто будет пользоваться',
    'Полный проверочный сценарий',
    'Что считаем готовым'
].forEach(function(text) {
    includes(text);
});

[
    'Заказы.xlsx',
    'Справочники.xlsx',
    'Клиент',
    'Вид сырья',
    'Заказ',
    'Позиция заказа',
    'Производственная резка',
    'общих списков',
    'Позиции должны быть внутри своего заказа',
    'Производственная резка должна быть привязана к конкретной позиции заказа'
].forEach(function(text) {
    includes(text, `domain concept is documented: ${text}`);
});

[
    'templates/mini-atex/orders.html',
    'templates/mini-atex/planning.html',
    'templates/mini-atex/operator.html',
    'templates/mini-atex/dashboard.html'
].forEach(function(template) {
    includes(template, `minimal screen is documented: ${template}`);
});

[
    'docs/atex_metadata.json',
    'docs/atex_full_cycle_test_scenario.md',
    'docs/atex_workplaces.md',
    'docs/integram-minimal-full-cycle-tz.md',
    'docs/integram-app-workflow.md'
].forEach(function(reference) {
    includes(reference, `Atex reference is documented: ${reference}`);
});

const fencedTables = doc.match(/```(?:csv|text|markdown)\n[\s\S]*?\n```/g) || [];
assert(fencedTables.length >= 5, 'document has at least five fenced examples');

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
assert(readme.includes(docRelPath), 'README links the minimal full-cycle project doc');

const workflow = fs.readFileSync(path.join(root, 'docs', 'integram-app-workflow.md'), 'utf8');
assert(workflow.includes(docRelPath.split('/')[1]), 'workflow guide links the minimal full-cycle project doc');

const atexWorkplaces = fs.readFileSync(path.join(root, 'docs', 'atex_workplaces.md'), 'utf8');
assert(atexWorkplaces.includes(docRelPath.split('/')[1]), 'Atex workspaces guide links the minimal full-cycle project doc');

console.log('issue-2986 minimal full-cycle documentation checks passed.');
