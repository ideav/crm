const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('templates/dash.html', 'utf8');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

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

assert(source.includes("DASH_MATRIX_TYPE_ID = '155551'"),
    'matrix saves must target object type 155551');
assert(source.includes("DASH_MATRIX_LINE_FIELD_ID = '155553'") && source.includes("DASH_MATRIX_COL_FIELD_ID = '155554'"),
    'matrix search must use row and column field ids');
assert(source.includes("records.slice(0, 10)"),
    'multiple value modal must show the first 10 records');

const code = `
let calls = [];
let statuses = [];
let modal = null;
let dashMatrixValues = [];
let dashModelData = { fp1904: { noDates: '' } };
const DASH_MATRIX_TYPE_ID = '155551';
const DASH_MATRIX_DATE_FIELD_ID = '155552';
const DASH_MATRIX_LINE_FIELD_ID = '155553';
const DASH_MATRIX_COL_FIELD_ID = '155554';

function newApi(method, url, callback, vars, index) {
    calls.push({ method, url, callback, vars, index });
}

function dashSetStatus(message) {
    statuses.push(message);
}

function dashCalcCells() {}
function dashCalcRGFormulas() {}
function dashShowMultivalModal(records, baseUrl, td, newVal, options) {
    modal = { records, baseUrl, td, newVal, options };
}

function makeCell(dataset) {
    const panel = { id: 'fp1904' };
    const sheet = {
        querySelector(selector) {
            if (selector === '.dash-fr-input') return { value: '2026-04-01' };
            if (selector === '.dash-to-input') return { value: '2026-04-30' };
            return null;
        }
    };
    const row = { querySelectorAll() { return []; } };
    return {
        dataset: Object.assign({}, dataset),
        style: {},
        attrs: {},
        textContent: '',
        setAttribute(name, value) { this.attrs[name] = value; },
        closest(selector) {
            if (selector === '.f-panel') return panel;
            if (selector === '.f-sheet') return sheet;
            if (selector === 'tr') return row;
            return null;
        }
    };
}

${extractFunction('dashTodayYMD')}
${extractFunction('dashMatrixRecordIds')}
${extractFunction('dashMatrixUsesDates')}
${extractFunction('dashMatrixSheetInputValue')}
${extractFunction('dashMatrixSearchUrl')}
${extractFunction('dashMatrixListUrl')}
${extractFunction('dashMatrixCreateParams')}
${extractFunction('dashMatrixUpsertCache')}
${extractFunction('dashSaveMatrixExisting')}
${extractFunction('dashSaveMatrixValue')}
${extractFunction('dashMatrixValueSearchDone')}
${extractFunction('dashMatrixValueSaveDone')}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

let td = makeCell({
    matrixValId: '155560',
    matrixLine: 'NPS родителей',
    matrixCol: '17-19 апреля'
});

calls = [];
dashSaveMatrixValue(td, '888');
assert(calls.length === 1, 'single id save should make one API call');
assert(calls[0].method === 'POST', 'single id save should use POST');
assert(calls[0].url === '_m_save/155560?JSON', 'single id save should use _m_save/{id}');
assert(calls[0].vars === 't155551=888', 'single id save should pass t155551');

calls = [];
dashSaveMatrixValue(td, '');
assert(calls[0].url === '_m_del/155560?JSON', 'clearing a single id should delete that record');

td = makeCell({
    matrixValId: '101,105',
    matrixLine: 'NPS родителей',
    matrixCol: '17-19 апреля'
});

calls = [];
dashSaveMatrixValue(td, '333');
assert(calls[0].method === 'GET', 'multiple ids should search before saving');
assert(calls[0].url === 'object/155551?JSON_OBJ&FR_155552=2026-04-01&TO_155552=2026-04-30&F_155553=NPS%20%D1%80%D0%BE%D0%B4%D0%B8%D1%82%D0%B5%D0%BB%D0%B5%D0%B9&F_155554=17-19%20%D0%B0%D0%BF%D1%80%D0%B5%D0%BB%D1%8F',
    'matrix search should include date, row, and column filters');

dashModelData.fp1904.noDates = '1';
calls = [];
dashSaveMatrixValue(td, '333');
assert(calls[0].url === 'object/155551?JSON_OBJ&F_155553=NPS%20%D1%80%D0%BE%D0%B4%D0%B8%D1%82%D0%B5%D0%BB%D0%B5%D0%B9&F_155554=17-19%20%D0%B0%D0%BF%D1%80%D0%B5%D0%BB%D1%8F',
    'matrix search should omit date filters unless panel NoDates is an empty string');

dashModelData.fp1904.noDates = '';
calls = [];
dashMatrixValueSearchDone([], { td, newVal: '999', searchUrl: dashMatrixSearchUrl(td) });
assert(calls[0].url === '_m_new/155551?JSON&up=1', 'missing matrix row should create object 155551');
assert(calls[0].vars.includes('t155551=999'), 'create should include t155551');
assert(/(^|&)t155552=\\d{8}(&|$)/.test(calls[0].vars), 'create should include current date when NoDates is empty');
assert(calls[0].vars.includes('t155553=NPS%20%D1%80%D0%BE%D0%B4%D0%B8%D1%82%D0%B5%D0%BB%D0%B5%D0%B9'), 'create should include row value');
assert(calls[0].vars.includes('t155554=17-19%20%D0%B0%D0%BF%D1%80%D0%B5%D0%BB%D1%8F'), 'create should include column value');

dashModelData.fp1904.noDates = '1';
calls = [];
dashMatrixValueSearchDone([], { td, newVal: '999', searchUrl: dashMatrixSearchUrl(td) });
assert(!calls[0].vars.includes('t155552='), 'create should omit date when NoDates is not empty');

calls = [];
dashMatrixValueSearchDone([{ i: 155561, r: ['old'] }], { td, newVal: '444', searchUrl: dashMatrixSearchUrl(td) });
assert(calls[0].url === '_m_save/155561?JSON', 'single search result should be updated');
assert(calls[0].vars === 't155551=444', 'single search result update should pass t155551');

calls = [];
dashMatrixValueSearchDone([{ i: 155561, r: ['old'] }], { td, newVal: '', searchUrl: dashMatrixSearchUrl(td) });
assert(calls[0].url === '_m_del/155561?JSON', 'single search result should be deleted when cleared');

modal = null;
dashMatrixValueSearchDone([{ i: 1 }, { i: 2 }], { td, newVal: '5', searchUrl: dashMatrixSearchUrl(td) });
assert(modal && modal.baseUrl.indexOf('JSON_OBJ') === -1, 'multiple search results should link to non-JSON object list');
assert(modal.options.saveCallback === 'dashMatrixValueSaveDone', 'matrix multivalue modal should save through matrix callback');
assert(modal.options.saveParam === 't155551', 'matrix multivalue modal should save t155551 after deleting duplicates');

dashMatrixValueSaveDone({ obj: 155580 }, { td, newVal: '123', recId: '' });
assert(td.dataset.matrixValId === '155580', 'matrix save should remember obj id from _m_new response');
assert(td.textContent === '123', 'matrix save should update displayed value');
`;

vm.runInNewContext(code, { console });
console.log('issue-2152 dashboard matrix save: ok');
