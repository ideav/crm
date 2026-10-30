// Unit-тесты для ideav/crm#5313 — ссылочная колонка на справочник с DATE/DATETIME-главным
// значением в подчинённой таблице формы.
//
// object/{arr}/?JSON_OBJ отдаёт такую ссылку как "id:метка", а метка у DATETIME-справочника —
// unix-штамп: "1001353:1790226000" (24.09.2026 08:00 МСК; ateh1, таблица 1000009, колонка «Задание высечки»,
// type=4, ref=1000019). Ячейка должна показать «24.09.2026 08:00:00», как основная таблица
// (#3211) и список опций (#3454), а не «1790226000».
//
// Проверяются все пути вывода подчинённой таблицы: ячейка в форме IntegramTable
// (formatSubordinateCellValue), копирование в буфер (subordinateCellToPlainText) и
// standalone-форма (IntegramCreateFormHelper.renderSubordinateTableStandalone).
//
// Run with: node experiments/integram-table-5313-ref-datetime.test.js

process.env.TZ = 'Europe/Moscow';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'integram-table.js'), 'utf8');
const sandbox = { console, location: { pathname: '/ateh1/table/1000009' } };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const { IntegramTable, IntegramCreateFormHelper } = vm.runInContext(
    source + '\n;({ IntegramTable, IntegramCreateFormHelper });', sandbox, { filename: 'integram-table.js' }
);

// Типы колонок Integram (normalizeFormat): 4 = DATETIME, 9 = DATE, 3 = SHORT.
const DATETIME = 4, DATE = 9, SHORT = 3;

const refDatetime = { val: 'Задание высечки', type: DATETIME, ref: '1000019', ref_id: '1000041' };
const refDate     = { val: 'День',            type: DATE,     ref: '1000020', ref_id: '1000045' };
const refShort    = { val: 'Партия ГП',       type: SHORT,    ref: '1000021', ref_id: '1000043' };
const plainDatetime = { val: 'Начато', type: DATETIME };

// Входы × ожидаемый видимый текст — одна таблица для всех путей вывода
const CASES = [
    [refDatetime,   '1001353:1790226000',  '24.09.2026 08:00:00', 'ссылка на DATETIME-справочник — датой-временем'],
    [refDate,       '1001354:20260924',    '24.09.2026',          'ссылка на DATE-справочник — датой'],
    [refShort,      '1001355:ГП-17',       'ГП-17',               'ссылка на текстовый справочник — меткой'],
    [refShort,      '1001356:12:30',       '12:30',               'метка с двоеточием не режется'],
    [plainDatetime, '1790226000',          '24.09.2026 08:00:00', 'обычная DATETIME-колонка не сломана'],
];

// ── Ячейка подчинённой таблицы в форме IntegramTable ─────────────────────────
const table = Object.create(IntegramTable.prototype);
for (const [req, value, expected, name] of CASES) {
    assertEqual(table.formatSubordinateCellValue(value, req), expected, 'ячейка формы: ' + name);
}

// ── Копирование подчинённой таблицы в буфер (IntegramTable) ──────────────────
for (const [req, value, expected, name] of CASES) {
    assertEqual(table.subordinateCellToPlainText(value, req.type), expected, 'буфер формы: ' + name);
}

// ── Standalone-форма (window.openEditRecordForm вне экземпляра) ──────────────
const helper = Object.create(IntegramCreateFormHelper.prototype);
for (const [req, value, expected, name] of CASES) {
    assertEqual(helper.subordinateCellToPlainText(value, req.type), expected, 'буфер standalone: ' + name);
}

const container = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
helper.renderSubordinateTableStandalone(container, {
    val: 'Обеспечение этикетки', type: 13, reqs: [
        { ...refDatetime, attrs: '' },
        { ...refShort,    attrs: '' },
    ],
}, [{ i: 1001401, r: ['50', '1001353:1790226000', ''] }], 1000009, 1000470);
const body = container.innerHTML.split('<tbody>')[1] || '';
const cells = (body.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [])
    .map(td => td.replace(/^<td[^>]*>/, '').replace(/<\/td>$/, ''))
    .map(td => td.replace(/<span class="subordinate-row-number">\d+<\/span>/, ''));
assertEqual(cells, ['50', '24.09.2026 08:00:00', ''],
    'standalone: строка ateh1 1001401 — «Задание высечки» датой-временем');

console.log(`\n${passed}/${total} passed`);
if (passed !== total) process.exitCode = 1;
