/*
 * Test for issue #2978: the atex templates need a full-cycle tester scenario
 * with concrete copy/paste and selection data.
 *
 * Run with: node experiments/test-issue-2978-atex-full-cycle-scenario.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const docPath = path.join(root, 'docs', 'atex_full_cycle_test_scenario.md');
const relDocPath = 'docs/atex_full_cycle_test_scenario.md';

assert(fs.existsSync(docPath), `${relDocPath} exists`);

const doc = fs.readFileSync(docPath, 'utf8');

function includes(text, message) {
    assert(doc.includes(text), message || `document includes ${text}`);
}

[
    '#2978',
    'Полный цикл тестирования atex',
    'Тестовые учётные записи',
    'Копипаст-набор',
    'Выбор из списков',
    'Сценарий полного цикла',
    'Критерии приёмки'
].forEach(function(text) {
    includes(text);
});

[
    'manager / manager_atex_2026',
    'dispatcher / dispatcher_atex_2026',
    'operator / operator_atex_2026',
    'director / director_atex_2026',
    'client / client_atex_2026'
].forEach(function(login) {
    includes(login, `tester account is documented: ${login}`);
});

[
    'templates/atex/orders.html',
    'templates/atex/cut-calc.html',
    'templates/atex/production-planning.html',
    'templates/atex/intake.html',
    'templates/atex/slitter.html',
    'templates/atex/sleeve-cutter.html',
    'templates/atex/cut-map.html',
    'templates/atex/warehouse.html',
    'templates/atex/dashboards.html',
    'templates/atex/portal.html'
].forEach(function(template) {
    includes(template, `full-cycle scenario covers ${template}`);
});

[
    'ООО "Ромашка-Термолента"',
    'client',
    'АТХ-2026-0001',
    'Jumbo Thermal 910/4000',
    'ТТ-58 ECO 57x40',
    'SL-01',
    'TC-76',
    'A-01-03'
].forEach(function(value) {
    includes(value, `copy/paste value is documented: ${value}`);
});

[
    'Новый',
    'Согласован',
    'Запланирована',
    'В очереди',
    'Ожидает',
    'Наладка',
    'В работе',
    'Завершён',
    'Есть',
    'Зарезервирован',
    'Отгружен'
].forEach(function(status) {
    includes(status, `selection/status is documented: ${status}`);
});

const copyBlocks = doc.match(/```(?:text|csv)\n[\s\S]*?\n```/g) || [];
assert(copyBlocks.length >= 4, 'document has at least four fenced copy/paste data blocks');

console.log('issue-2978 atex full-cycle scenario doc: ok');
