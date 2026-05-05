// Issue #2392: PR #2391 решал #2390 неверно.
//
// Спецификация из issue #2385 однозначна:
//   В запросе object/1010 передавать значение метки в качестве параметра:
//   1. если она непустая, то F_155556=%
//   2. если непустая [пустая], то F_155556=!%
//
// То есть серверный фильтр — литеральный `%` / `!%` (any-label / no-label
// bucket), а клиент уже применяет правила сопоставления (а/б/в) по
// подстроке. PR #2391 поменял URL на `%<label>%` — это не соответствует
// спеке и теряет правило (а): запись с меткой "вводные" не нашлась бы
// для строки дэшборда с меткой "вводные кв1".
//
// Корень проблемы #2390: ответ object/<type>?JSON_OBJ — позиционные
// массивы `r`, у `rec['Метка']` всегда undefined. Правильное решение —
// читать метку из `r[index]`, где index определяется по `metadata.reqs`
// (r[0] = main value, r[1..N] = reqs). Тогда серверный фильтр остаётся
// `%`/`!%`, а клиентский фильтр корректно сравнивает реальные метки.
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/dash.js', 'utf8');

function extractFunction(name) {
    const marker = 'function ' + name + '(';
    const start = source.indexOf(marker);
    if (start === -1) throw new Error('Missing function ' + name);
    const braceStart = source.indexOf('{', start);
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') depth--;
        if (depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('Unclosed function ' + name);
}

function extractWindowFn(name) {
    const marker = 'window.' + name + ' = function';
    const start = source.indexOf(marker);
    if (start === -1) throw new Error('Missing window fn ' + name);
    const braceStart = source.indexOf('{', start);
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') depth--;
        if (depth === 0) {
            const fnStart = source.indexOf('function', start);
            const argsStart = source.indexOf('(', fnStart);
            return 'function ' + name + source.slice(argsStart, i + 1);
        }
    }
    throw new Error('Unclosed window fn ' + name);
}

const harness = `
function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const DASH_VALUE_LABEL_FIELD_ID = '155556';
const DASH_MATRIX_LABEL_FIELD_ID = '155557';
const DASH_MATRIX_DATE_FIELD_ID = '155552';
const DASH_MATRIX_LINE_FIELD_ID = '155553';
const DASH_MATRIX_COL_FIELD_ID = '155554';

let dashMetadata = null;

const callRecord = [];
function newApi(method, url, callback, params, ctx) {
    callRecord.push({ method, url, callback, params, ctx });
}
function dashSetStatus() {}
function dashFormatNumberText(v) { return v; }
function dashCalcCells() {}
function dashCalcRGFormulas() {}
function dashShowMultivalModal() { callRecord.push({ method: 'MODAL' }); }
function dashTodayYMD() { return '20260101'; }
function dashCellItemRef(td) { return td.dataset.itemRef || ''; }
function dashCellRgHead(td) { return td.dataset.rgHead || ''; }
function dashCellDateFr(td) { return td.dataset.fr || null; }
function dashCellDateTo(td) { return td.dataset.to || null; }
function dashMatrixUsesDates() { return false; }
function dashMatrixSheetInputValue() { return ''; }

${extractFunction('dashNormalizeMatrixKey')}
${extractFunction('dashMatrixLabelScore')}
${extractFunction('dashMatrixLabelMatches')}
${extractFunction('dashFindTypeMetadata')}
${extractFunction('dashRecordReqIndex')}
${extractFunction('dashRecordLabel')}
${extractFunction('dashMatrixDashLabel')}
${extractFunction('dashMatrixSearchUrl')}
${extractFunction('dashMatrixValueSearchDone')}
${extractFunction('dashValueSearchUrl')}
${extractWindowFn('dashValueSearchDone')}

function makeCell(opts) {
    const dataset = Object.assign({}, opts || {});
    return {
        dataset,
        style: {},
        textContent: '',
        setAttribute() {},
        getAttribute() { return null; },
        closest() { return null; }
    };
}

const ISSUE_PAYLOAD = [{
    "i": 159454, "u": 1, "o": 1,
    "r": ["2", "01.01.2026", "2811:сайт", "", "", "", "1974:Кол-во", "вводные"]
}];
const VALUE_METADATA_1010 = {
    id: '1010', val: 'Значение',
    reqs: [
        { num: 1, id: '1039',   val: 'Дата' },
        { num: 2, id: '1042',   val: 'Строка бюджета' },
        { num: 3, id: '2012',   val: 'Столбец' },
        { num: 4, id: '1047',   val: 'Факт' },
        { num: 5, id: '1048',   val: 'Ед.изм.' },
        { num: 6, id: '1104',   val: 'Колонка группы' },
        { num: 7, id: '155556', val: 'Метка' }
    ]
};

// === Case 1: server URL keeps literal '%' (NOT '%вводные%') per spec ===
let td = makeCell({
    valueItemId: '2811',
    fr: '20260101', to: '20260131',
    rgHead: 'Кол-во',
    dashLabel: 'вводные'
});
let url = dashValueSearchUrl(td);
assert(/[?&]F_155556=%(&|$)/.test(url),
    'value URL must use literal F_155556=% per #2385 spec, got: ' + url);
assert(url.indexOf('%' + encodeURIComponent('вводные')) === -1,
    'value URL must NOT include %<label>% (regression of #2391), got: ' + url);

// === Case 2: empty label still uses literal '!%' ===
td = makeCell({ valueItemId: '2811', fr: '20260101', to: '20260131' });
url = dashValueSearchUrl(td);
assert(/[?&]F_155556=!%(&|$)/.test(url),
    'value URL with empty label must use F_155556=!%, got: ' + url);

// === Case 3: matrix URL mirrors the same spec ===
td = makeCell({ matrixLine: 'L', matrixCol: 'C', dashLabel: 'вводные' });
url = dashMatrixSearchUrl(td);
assert(/[?&]F_155557=%(&|$)/.test(url),
    'matrix URL must use literal F_155557=%, got: ' + url);

td = makeCell({ matrixLine: 'L', matrixCol: 'C' });
url = dashMatrixSearchUrl(td);
assert(/[?&]F_155557=!%(&|$)/.test(url),
    'matrix URL with empty label must use F_155557=!%, got: ' + url);

// === Case 4: post-filter reads label via metadata.reqs index, not rec['Метка'] ===
dashMetadata = [VALUE_METADATA_1010];
const idx = dashRecordReqIndex('1010', '155556');
assert(idx === 7, 'expected reqs index 7 for Метка via metadata, got: ' + idx);
assert(dashRecordLabel(ISSUE_PAYLOAD[0], '1010', '155556') === 'вводные',
    'must read "вводные" from r[7] via metadata');

// === Case 5: end-to-end "clear value with label" → _m_del fires ===
const cell = makeCell({
    valueItemId: '2811',
    fr: '20260101', to: '20260131',
    rgHead: 'Кол-во',
    dashLabel: 'вводные',
    src: 'rg'
});
callRecord.length = 0;
dashValueSearchDone(ISSUE_PAYLOAD, {
    td: cell, newVal: '', originalVal: '2',
    itemRef: 'сайт', fr: null, to: null, rgHead: 'Кол-во',
    dashLabel: 'вводные'
});
assert(callRecord.length === 1, 'expected one POST after search, got: ' + callRecord.length);
assert(callRecord[0].method === 'POST', 'expected POST, got: ' + callRecord[0].method);
assert(callRecord[0].url.indexOf('_m_del/159454') === 0,
    'expected _m_del/159454 (post-filter must keep the matching record), got: ' + callRecord[0].url);

// === Case 6: with NO metadata cached, fallback to last r element still works ===
dashMetadata = null;
assert(dashRecordLabel(ISSUE_PAYLOAD[0], '1010', '155556') === 'вводные',
    'fallback to r[r.length - 1] must yield "вводные"');

// === Case 7: rule (а) — empty stored label vs non-empty dashLabel — should NOT match ===
dashMetadata = [VALUE_METADATA_1010];
const empty = { i: 1, r: ['', '', '', '', '', '', '', ''] };
assert(!dashMatrixLabelMatches('вводные', dashRecordLabel(empty, '1010', '155556')),
    'empty stored label must not match non-empty dash label');

// === Case 8: rule (а) — substring direction "stored ⊂ dash" ===
const partial = { i: 2, r: ['', '', '', '', '', '', '', 'ввод'] };
assert(dashMatrixLabelMatches('вводные', dashRecordLabel(partial, '1010', '155556')),
    'rule (а): stored "ввод" ⊂ dash "вводные" must match');

// === Case 9: rule (б) — substring direction "dash ⊂ stored" ===
const longer = { i: 3, r: ['', '', '', '', '', '', '', 'вводные кв1'] };
assert(dashMatrixLabelMatches('вводные', dashRecordLabel(longer, '1010', '155556')),
    'rule (б): dash "вводные" ⊂ stored "вводные кв1" must match');

// === Case 10: rule (в) — both empty ===
const both = { i: 4, r: ['', '', '', '', '', '', '', ''] };
assert(dashMatrixLabelMatches('', dashRecordLabel(both, '1010', '155556')),
    'rule (в): both empty must match');
`;

vm.runInNewContext(harness, { console });
console.log('issue-2392 jsonobj label positional: ok');
