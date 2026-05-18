'use strict';

// Issue #2718: when a dashboard row formula references the same query as the
// panelQuery, formula cells must use the already loaded panel JSON report after
// panelFilter, even when the panel query is configured by ID and the formula
// names the report by its JSON `header`.

const assert = require('assert');
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

assert(
    source.includes('dashUsePanelReportForFormula(panelKey'),
    'dashGetModel must route matching row formulas through the panel query report'
);

const ctx = { require, console };
vm.createContext(ctx);
vm.runInContext(`
const repRegex = /^\\[([^\\].]+)(\\.[^\\].]+)(\\.[^\\].]+)?\\]$/;

var calls = [];
var dashReports = {};
var dashReportNames = {};
var dashReportKeys = {};
var dashReportSources = {};
var dashFormulas = {};
var dashModelData = {};
var dashPanelFilters = {};
var dashVizReports = {};
var dashPanelReportFormulas = {};
var dashAjaxes = 0;

function newApi(method, url, callback, vars, ctx) {
    calls.push({ method, url, callback, vars, ctx });
}
function dashDrawPeriods() {}

${extractFunction('dashNormalizeNumberText')}
${extractFunction('dashFormatNumberText')}
${extractFunction('dashGetFloat')}
${extractFunction('dashNormalizeVal')}
${extractFunction('dashReportRefId')}
${extractFunction('dashCleanReportRef')}
${extractFunction('dashNormalizeReportRef')}
${extractFunction('dashReportRefIsNumeric')}
${extractFunction('dashSameReportRef')}
${extractFunction('dashPanelDateValue')}
${extractFunction('dashPanelMonthValue')}
${extractFunction('dashPanelFilterValueKey')}
${extractFunction('dashPanelFilterIsActive')}
${extractFunction('dashPanelReportRowPassesFilter')}
${extractFunction('dashFilterReportRowsForPanel')}
${extractFunction('dashPanelFilterPartIsLocal')}
${extractFunction('dashPanelFilterParts')}
${extractFunction('dashDecodePanelFilterPart')}
${extractFunction('dashPanelLocalFilterState')}
${extractFunction('dashMergePanelFilterState')}
${extractFunction('dashPanelFiltersFor')}
${extractFunction('dashNormalizePanelFilter')}
${extractFunction('dashReportKey')}
${extractFunction('dashReportUrl')}
${extractFunction('dashVizReportKey')}
${extractFunction('dashVizReportUrl')}
${extractFunction('dashNormalizeReportJson')}
${extractFunction('dashParseReportFormula')}
${extractFunction('dashReportFieldName')}
${extractFunction('dashReportHasField')}
${extractFunction('dashReportSumField')}
${extractFunction('dashNormalizeGroupName')}
${extractFunction('dashSameGroupName')}
${extractFunction('dashReportGroupMatches')}
${extractFunction('dashCellRgColumn')}
${extractFunction('dashCellReportGroup')}
${extractFunction('dashCollectReportGroups')}
${extractFunction('dashResolveReportCellValue')}
${extractFunction('dashBindPanelReportFormulaRows')}
${extractFunction('dashQueuePanelReportFormula')}
${extractFunction('dashFlushPanelReportFormulas')}
${extractFunction('dashUsePanelReportForFormula')}
${extractFunction('dashGetRepVals')}
${extractFunction('dashGetRepDone')}
${extractFunction('dashGetRep')}
${extractFunction('dashGetVizReportDone')}
${extractFunction('dashGetVizReport')}
`, ctx);

function makeFormulaCell(panel, range) {
    return {
        innerHTML: '',
        attrs: { range: range || '20260101-20261231' },
        dataset: {},
        getAttribute(name) { return this.attrs[name]; },
        setAttribute(name, value) { this.attrs[name] = value; },
        closest(selector) { return selector === '.f-panel' ? panel : null; }
    };
}

function installFormulaRow(ctx, rowId, formula, reportKey, cell) {
    ctx.dashFormulas[rowId] = formula;
    ctx.dashReportKeys[rowId] = reportKey;
    ctx.dashReportSources[rowId] = [{ formula, reportKey }];
    ctx.document = {
        getElementById(id) {
            if (id !== rowId) return null;
            return {
                querySelectorAll(selector) {
                    return selector === '.f-rg-cell[data-src="report"],.f-values[data-src="report"]' ? [cell] : [];
                }
            };
        }
    };
}

const panel = { id: 'fp1' };
const panelFilter = 'Лист GS:ОПиУ';
const panelReportKey = ctx.dashVizReportKey('155675', panelFilter);
const formula = '[Операционные результаты.В работе]';
const parsed = ctx.dashParseReportFormula(formula);
const formulaReportKey = ctx.dashReportKey(parsed.report, panelFilter);

ctx.dashModelData.fp1 = {
    vizReportId: '155675',
    vizReportKey: panelReportKey,
    panelFilters: ctx.dashPanelLocalFilterState(panelFilter)
};

const reportKeyFromGet = ctx.dashGetVizReport('155675', '01.01.2026', '31.12.2026', panelFilter);
assert.strictEqual(reportKeyFromGet, panelReportKey, 'panel JSON report key is stable');
assert.deepStrictEqual(
    Array.from(ctx.calls).map(call => call.url),
    ['report/155675?JSON&FR_Date=01.01.2026&TO_Date=31.12.2026'],
    'panel JSON request strips local panelFilter and is the only request so far'
);

assert.strictEqual(
    ctx.dashUsePanelReportForFormula('fp1', parsed.report, formulaReportKey, '01.01.2026', '31.12.2026', panelFilter),
    true,
    'formula with report name should wait for panel JSON header when panelQuery is an ID'
);
assert.strictEqual(
    ctx.calls.some(call => call.url.indexOf('JSON_KV') !== -1),
    false,
    'matching formula must not start a separate JSON_KV report request'
);

ctx.dashGetVizReportDone({
    header: 'Операционные результаты',
    columns: [
        { id: 'date', name: 'Date', format: 'DATE' },
        { id: 'work', name: 'В работе', format: 'NUMBER' },
        { id: 'sheet', name: 'Лист GS', format: 'SHORT' }
    ],
    data: [
        ['20260110', '5', 'ОПиУ'],
        ['20260110', '9', 'ДДС']
    ]
}, { key: panelReportKey });

assert.ok(Array.isArray(ctx.dashReports[formulaReportKey]), 'panel JSON rows must be cached as formula report rows');
assert.strictEqual(ctx.dashReportNames[formulaReportKey], 'Операционные результаты', 'formula report name comes from JSON header');

const idFormulaReportKey = ctx.dashReportKey('155675', panelFilter);
assert.strictEqual(
    ctx.dashUsePanelReportForFormula('fp1', '155675', idFormulaReportKey, '01.01.2026', '31.12.2026', panelFilter),
    true,
    'formula with report ID should directly reuse the loaded panel JSON report'
);
assert.ok(Array.isArray(ctx.dashReports[idFormulaReportKey]), 'ID-based formula report uses panel JSON rows');

const cell = makeFormulaCell(panel);
installFormulaRow(ctx, 'item1', formula, formulaReportKey, cell);
ctx.dashGetRepVals();
assert.strictEqual(cell.innerHTML, '5', 'formula cell uses panel JSON rows after local panelFilter');
assert.strictEqual(cell.attrs.ready, '1', 'formula cell is marked ready after resolving panel JSON data');

ctx.calls = [];
const mismatchPanelKey = ctx.dashVizReportKey('200', '');
const mismatchFormulaKey = ctx.dashReportKey('Другой запрос', '');
ctx.dashModelData.fp2 = {
    vizReportId: '200',
    vizReportKey: mismatchPanelKey,
    panelFilters: {}
};
ctx.dashGetVizReport('200', '01.01.2026', '31.12.2026', '');
assert.strictEqual(
    ctx.dashUsePanelReportForFormula('fp2', 'Другой запрос', mismatchFormulaKey, '01.01.2026', '31.12.2026', ''),
    true,
    'non-ID formula names are delayed until the panel JSON header is known'
);
ctx.dashGetVizReportDone({
    header: 'Операционные результаты',
    columns: [{ id: 'date', name: 'Date', format: 'DATE' }],
    data: [['20260110']]
}, { key: mismatchPanelKey });
assert.ok(
    ctx.calls.some(call => call.url === 'report/Другой запрос?JSON_KV&FR_Date=01.01.2026&TO_Date=31.12.2026'),
    'header mismatch falls back to the normal formula JSON_KV request'
);

assert.strictEqual(
    JSON.stringify(ctx.dashParseReportFormula('[155675.В работе]')),
    JSON.stringify({ report: '155675', field: 'В работе', group: '', fullField: 'В работе' }),
    'formula parser accepts query IDs in the report position'
);

console.log('issue-2718 panelQuery formula source: ok');
