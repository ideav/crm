// Unit-тесты фактической ширины резки (ideav/crm#3372).
// Справочник «Фактическая ширина резки» (table 66190) задаёт пары
// номинал → факт с условием в поле «Код». Жёсткий фильтр: факт. ширина
// применяется ТОЛЬКО при выполнении условия, иначе берётся номинал.
//
// Проверяем чистые помощники:
//   • parseActualWidthCode   — разбор кода условия (j/s, операторы = > < >= <=);
//   • actualWidthCodeMatches — проверка условия по контексту {jumbo, inches};
//   • buildActualWidthIndex  — индекс по номиналу (условные строки раньше);
//   • resolveCutWidth        — номинал + контекст → фактическая ширина.
//
// Run with: node experiments/test-issue-3372-actual-cut-width.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) {
        passed++;
    } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// ── Реальный датасет справочника 66190 (с проставленными кодами, бой) ──
var ROWS = [
    { actual: 32.5,  order: 33,  code: 'j=910' },
    { actual: 33,    order: 33,  code: 'j>1000' },
    { actual: 44,    order: 45,  code: '' },
    { actual: 49,    order: 50,  code: '' },
    { actual: 55,    order: 57,  code: 's=0.5' },
    { actual: 59,    order: 60,  code: '' },
    { actual: 63.5,  order: 64,  code: 's=1' },
    { actual: 63.5,  order: 65,  code: 's=1' },
    { actual: 74,    order: 75,  code: '' },
    { actual: 89,    order: 90,  code: '' },
    { actual: 99,    order: 100, code: '' },
    { actual: 103.5, order: 104, code: '' }
];
var INDEX = planning.buildActualWidthIndex(ROWS);

// ── parseActualWidthCode ──
assertEqual(planning.parseActualWidthCode(''),        { key: '', op: '', val: 0 },          'parseCode: пусто → безусловно');
assertEqual(planning.parseActualWidthCode(null),      { key: '', op: '', val: 0 },          'parseCode: null → безусловно');
assertEqual(planning.parseActualWidthCode('j=910'),   { key: 'j', op: '=', val: 910 },       'parseCode: j=910');
assertEqual(planning.parseActualWidthCode('j>1000'),  { key: 'j', op: '>', val: 1000 },      'parseCode: j>1000');
assertEqual(planning.parseActualWidthCode('s=0.5'),   { key: 's', op: '=', val: 0.5 },       'parseCode: s=0.5');
assertEqual(planning.parseActualWidthCode(' S = 1 '), { key: 's', op: '=', val: 1 },         'parseCode: пробелы/регистр нормализуются');
assertEqual(planning.parseActualWidthCode('j>=900'),  { key: 'j', op: '>=', val: 900 },      'parseCode: оператор >=');
assertEqual(planning.parseActualWidthCode('бред'),    { key: '?', op: '', val: 0 },          'parseCode: нераспознан → ?');

// ── actualWidthCodeMatches ──
var P = planning.parseActualWidthCode;
assertEqual(planning.actualWidthCodeMatches(P(''),      { jumbo: 999 }),        true,  'match: безусловно → true');
assertEqual(planning.actualWidthCodeMatches(P('бред'),  { jumbo: 910 }),        false, 'match: нераспознан → false');
assertEqual(planning.actualWidthCodeMatches(P('j=910'), { jumbo: 910 }),        true,  'match: j=910 при jumbo 910');
assertEqual(planning.actualWidthCodeMatches(P('j=910'), { jumbo: 1000 }),       false, 'match: j=910 при jumbo 1000 → false');
assertEqual(planning.actualWidthCodeMatches(P('j>1000'),{ jumbo: 1050 }),       true,  'match: j>1000 при jumbo 1050');
assertEqual(planning.actualWidthCodeMatches(P('j>1000'),{ jumbo: 1000 }),       false, 'match: j>1000 при ровно 1000 → false');
assertEqual(planning.actualWidthCodeMatches(P('s=1'),   { inches: 1.0 }),       true,  'match: s=1 при втулке 1.0');
assertEqual(planning.actualWidthCodeMatches(P('s=0.5'), { inches: 0.5 }),       true,  'match: s=0.5 при втулке 0.5');
assertEqual(planning.actualWidthCodeMatches(P('s=1'),   { inches: 0.5 }),       false, 'match: s=1 при втулке 0.5 → false');
assertEqual(planning.actualWidthCodeMatches(P('j=910'), {}),                    false, 'match: нет jumbo в контексте → false');
assertEqual(planning.actualWidthCodeMatches(P('s=1'),   { inches: '' }),        false, 'match: пустые дюймы → false');

// ── buildActualWidthIndex: условные строки идут раньше безусловных ──
assertEqual(INDEX['33'].map(function(r){ return r.parsed.op + r.parsed.val; }), ['=910', '>1000'], 'index[33]: две условные строки');
assertEqual(INDEX['45'].length, 1, 'index[45]: одна безусловная строка');
assertEqual(INDEX['45'][0].actual, 44, 'index[45]: факт 44');

// ── resolveCutWidth (главный сценарий) ──
function R(nominal, ctx) { return planning.resolveCutWidth(nominal, ctx, INDEX); }

// Номинал 33 различается по ширине джамбо
assertEqual(R(33, { jumbo: 910 }),            32.5, '33 + джамбо 910 → 32.5');
assertEqual(R(33, { jumbo: 1050 }),           33,   '33 + джамбо 1050 → 33');
assertEqual(R(33, { jumbo: 950 }),            33,   '33 + джамбо 950 (между) → номинал 33 (жёсткий фильтр)');
assertEqual(R(33, { jumbo: 800 }),            33,   '33 + джамбо 800 (<910) → номинал 33');
assertEqual(R(33, {}),                        33,   '33 без ширины джамбо → номинал 33');

// Номинал по втулке (жёсткий фильтр: нет втулки → номинал)
assertEqual(R(57, { inches: 0.5 }),           55,   '57 + втулка 0.5" → 55');
assertEqual(R(57, { inches: 1.0 }),           57,   '57 + втулка 1" → номинал 57 (условие не выполнено)');
assertEqual(R(57, {}),                        57,   '57 без втулки → номинал 57');
assertEqual(R(64, { inches: 1.0 }),           63.5, '64 + втулка 1" → 63.5');
assertEqual(R(64, { inches: 0.5 }),           64,   '64 + втулка 0.5" → номинал 64');
assertEqual(R(65, { inches: 1.0 }),           63.5, '65 + втулка 1" → 63.5');
assertEqual(R(65, {}),                        65,   '65 без втулки → номинал 65');

// Безусловные строки применяются всегда
assertEqual(R(45, {}),                        44,   '45 → 44 (безусловно)');
assertEqual(R(50, { jumbo: 910, inches: 1 }), 49,   '50 → 49 (безусловно, контекст игнорируется)');
assertEqual(R(60, {}),                        59,   '60 → 59');
assertEqual(R(75, {}),                        74,   '75 → 74');
assertEqual(R(90, {}),                        89,   '90 → 89');
assertEqual(R(100, {}),                       99,   '100 → 99');
assertEqual(R(104, {}),                       103.5, '104 → 103.5');

// Нет правила → номинал как есть
assertEqual(R(999, { jumbo: 910 }),           999,  'нет правила → номинал 999');
assertEqual(R(0, {}),                         0,    'вырожденная ширина 0 → 0');

console.log('\n' + passed + ' проверок прошло.');
if (process.exitCode === 1) {
    console.log('ЕСТЬ ПАДЕНИЯ — см. выше.');
} else {
    console.log('Все проверки #3372 зелёные.');
}
