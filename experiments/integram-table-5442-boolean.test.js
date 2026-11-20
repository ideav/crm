// Unit-тесты для ideav/crm#5442 — BOOLEAN в трёх состояниях: '1' (да), '-1' (нет), пусто (не задано).
//
// Ядро хранит «нет» как '-1' и отдаёт его в API, поэтому «непусто» больше не значит «да»:
// '-1' должен показываться снятой галкой во всех путях вывода компонента — ячейка подчинённой
// таблицы формы (IntegramTable.formatSubordinateCellValue), standalone-форма
// (IntegramCreateFormHelper.formatSubordinateCellDisplay) и общий признак integramBooleanIsTrue.
//
// Run with: node experiments/integram-table-5442-boolean.test.js

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
const sandbox = { console, location: { pathname: '/db/table/1' } };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const { IntegramTable, IntegramCreateFormHelper } = vm.runInContext(
    source + '\n;({ IntegramTable, IntegramCreateFormHelper });', sandbox, { filename: 'integram-table.js' }
);

const BOOLEAN = 11;
// Входы × «да ли это»: API ядра ('1' / '-1'), интерфейс ('X'), прежние клиенты ('0', 'false', true/false)
const CASES = [
    ['1', true], ['X', true], [true, true], [1, true],
    ['-1', false], [-1, false], ['0', false], ['false', false], [false, false], [0, false],
];

function shownAsYes(html) {
    if (html.indexOf('boolean-check') !== -1) return true;
    if (html.indexOf('boolean-uncheck') !== -1) return false;
    return 'не галка: ' + html;
}

// На ядре без #5442 общего признака нет — проверки ячеек всё равно идут и краснеют по поведению
const isTrue = typeof sandbox.integramBooleanIsTrue === 'function' ? sandbox.integramBooleanIsTrue : () => 'нет integramBooleanIsTrue';
const table = Object.create(IntegramTable.prototype);
const helper = Object.create(IntegramCreateFormHelper.prototype);
for (const [value, yes] of CASES) {
    const name = JSON.stringify(value) + ' — ' + (yes ? 'да' : 'нет');
    assertEqual(isTrue(value), yes, 'integramBooleanIsTrue ' + name);
    assertEqual(shownAsYes(table.formatSubordinateCellValue(value, { type: BOOLEAN })), yes, 'ячейка формы ' + name);
    assertEqual(shownAsYes(helper.formatSubordinateCellDisplay(value, BOOLEAN)), yes, 'standalone-форма ' + name);
}
assertEqual(isTrue(''), false, 'пусто (не задано) — не «да»');
assertEqual(isTrue(null), false, 'null (не задано) — не «да»');

console.log(`\n${passed}/${total} passed`);
if (passed !== total) process.exitCode = 1;
