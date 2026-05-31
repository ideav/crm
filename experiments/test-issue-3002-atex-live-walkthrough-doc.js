/*
 * Regression/documentation test for issue #3002.
 *
 * The live ATEH walkthrough must document the exact scenario records and keep
 * the captured Playwright screenshots available as valid PNG files.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const docPath = path.join(root, 'docs', 'atex_live_full_cycle_ateh_2026-05-31.md');
const indexPath = path.join(root, 'docs', 'atex_workplaces.md');
const relDocPath = 'docs/atex_live_full_cycle_ateh_2026-05-31.md';

assert(fs.existsSync(docPath), relDocPath + ' exists');

const doc = fs.readFileSync(docPath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');

function includes(text, message) {
    assert(doc.includes(text), message || 'document includes ' + text);
}

[
    '#3002',
    'https://ideav.ru/ateh/',
    '31.05.2026',
    'metadata',
    '?_count=&JSON=1',
    'АТХ-3002-2026-05-31'
].forEach(function(text) {
    includes(text);
});

assert(!doc.includes('metadata?JSON=1'), 'metadata route is documented without redundant JSON=1');

[
    '1936',
    '1946',
    '1951',
    '1966',
    '1974',
    '1982',
    '1993',
    '2006',
    '2012'
].forEach(function(id) {
    includes(id, 'scenario id is documented: ' + id);
});

[
    'Менеджер',
    'Диспетчер',
    'Оператор',
    'Кладовщик',
    'Руководитель',
    'Клиент'
].forEach(function(role) {
    includes(role, 'role is documented: ' + role);
});

const screenshotNames = [
    'issue-3002-00-before-orders-loading.png',
    'issue-3002-01-manager-orders.png',
    'issue-3002-02-dispatcher-cut-calc.png',
    'issue-3002-03-dispatcher-planning.png',
    'issue-3002-04-operator-intake.png',
    'issue-3002-05-operator-cut-map.png',
    'issue-3002-06-operator-slitter.png',
    'issue-3002-07-operator-sleeve-cutter.png',
    'issue-3002-08-operator-warehouse.png',
    'issue-3002-09-director-dashboards.png',
    'issue-3002-10-client-portal.png'
];

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

screenshotNames.forEach(function(fileName) {
    const relPath = path.join('screenshots', fileName);
    const fullPath = path.join(root, 'docs', relPath);

    includes(relPath, 'screenshot is linked: ' + relPath);
    assert(fs.existsSync(fullPath), relPath + ' exists');

    const signature = fs.readFileSync(fullPath).subarray(0, pngSignature.length);
    assert(signature.equals(pngSignature), relPath + ' is a valid PNG');
});

assert(
    index.includes('atex_live_full_cycle_ateh_2026-05-31.md'),
    'docs/atex_workplaces.md links the issue #3002 live walkthrough'
);

console.log('issue-3002 atex live walkthrough doc: ok');
