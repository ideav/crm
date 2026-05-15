'use strict';

// Issue #2679: local panelFilter parts like "Лист GS:ОПиУ" must also be
// applied when ingesting panelQuery JSON_KV rows into dashPanelValues.
//
// Before the fix, dashGetPanelValuesDone stored every row returned by
// the per-panel query, ignoring the configured local panelFilter — so a
// panel with `panelFilter: "Лист GS:ОПиУ"` would surface values from
// every sheet, not only the rows tagged with «Лист GS = ОПиУ».

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

const ctx = { require, console };
vm.createContext(ctx);
vm.runInContext(`
var dashModelData = {};
var dashPanelValues = {};
var dashPanelValueErrors = {};
var dashPanelFilters = {};
var dashAjaxes = 1;
function dashDrawPeriods() {}
function dashTrace() {}

${extractFunction('dashNormalizeNumberText')}
${extractFunction('dashGetFloat')}
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
${extractFunction('dashParseSrcValue')}
${extractFunction('dashGetPanelValuesDone')}
`, ctx);

// Model: panel 'fp1' has panelFilter = "Лист GS:ОПиУ"
ctx.dashModelData.fp1 = {
    panelFilter: 'Лист GS:ОПиУ',
    panelFilters: ctx.dashPanelLocalFilterState('Лист GS:ОПиУ')
};

// Server returned rows for several sheets — only "ОПиУ" rows should land
// in dashPanelValues.
const rows = [
    {
        item: 'Выручка',
        value: '{"date":"20260131","val":"100"}',
        RGcolumnsID: 'Факт',
        'Метка': 'поступление',
        'Лист GS': 'ОПиУ'
    },
    {
        item: 'Выручка',
        value: '{"date":"20260131","val":"50"}',
        RGcolumnsID: 'Факт',
        'Метка': 'поступление',
        'Лист GS': 'ДДС'
    },
    {
        item: 'Расходы',
        value: '{"date":"20260131","val":"30"}',
        RGcolumnsID: 'Факт',
        'Метка': '',
        'Лист GS': 'ОПиУ'
    }
];

ctx.dashGetPanelValuesDone(rows, { panelKey: 'fp1' });

const bucket = ctx.dashPanelValues.fp1;
assert.ok(bucket, 'panel bucket must be created');

const revenueKey = 'выручка:факт';
const expensesKey = 'расходы:факт';

assert.ok(Array.isArray(bucket[revenueKey]), 'Выручка bucket must exist');
assert.strictEqual(
    bucket[revenueKey].length,
    1,
    'only the "Лист GS = ОПиУ" Выручка row must be ingested'
);
assert.strictEqual(bucket[revenueKey][0].val, '100', 'kept value must be the ОПиУ row');

assert.ok(Array.isArray(bucket[expensesKey]), 'Расходы bucket must exist');
assert.strictEqual(bucket[expensesKey].length, 1, 'matching Расходы row must be ingested');

// Sanity: with no local filter, every row goes through.
ctx.dashModelData.fp2 = { panelFilter: '', panelFilters: {} };
ctx.dashGetPanelValuesDone(rows, { panelKey: 'fp2' });
assert.strictEqual(
    ctx.dashPanelValues.fp2[revenueKey].length,
    2,
    'no panelFilter must keep all rows for the same item key'
);

// Server-side panelFilter parts (with `=`) are not stripped from URL by
// dashGetPanelValues — but they also must not act as a local row filter
// here, since the server already applied them.
ctx.dashModelData.fp3 = {
    panelFilter: 'FR_dept=IN(2889)',
    panelFilters: ctx.dashPanelLocalFilterState('FR_dept=IN(2889)')
};
ctx.dashGetPanelValuesDone(rows, { panelKey: 'fp3' });
assert.strictEqual(
    ctx.dashPanelValues.fp3[revenueKey].length,
    2,
    'server-side panelFilter parts must not also filter rows on the client'
);

console.log('issue-2679 panelQuery local panelFilter: ok');
