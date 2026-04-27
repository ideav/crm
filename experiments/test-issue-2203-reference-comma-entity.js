/**
 * Issue #2203: reference labels returned as &comma; should display as commas
 * in table cells, while still escaping decoded HTML-sensitive characters.
 */
const assert = require('assert');

global.window = {
    location: { pathname: '/crm/table/100', search: '' },
    _integramTableInstances: []
};
global.document = {
    readyState: 'loading',
    addEventListener() {},
    querySelectorAll() { return []; }
};

const IntegramTable = require('../js/integram-table.js');

const table = Object.create(IntegramTable.prototype);
table.columns = [];
table.data = [[]];
table.rawObjectData = [];
table.styleColumns = {};
table.settings = { truncateLongValues: false };
table.editableColumns = new Map();
table.options = { instanceName: 'testTable' };
table.getDataSourceType = () => 'table';

const column = {
    id: '10',
    name: 'Client',
    format: 'SHORT',
    ref_id: '100',
    ref: '100',
    orig: '100'
};

const html = table.renderCell(column, '42:Safe &lt;b&gt;&comma; Inc', 0, 0);

assert(html.includes('Safe &lt;b&gt;, Inc'), 'decoded comma should be displayed and decoded < should be escaped');
assert(!html.includes('&amp;comma;'), 'encoded comma entity should not be rendered as visible text');
assert(!html.includes('&amp;lt;'), 'decoded HTML entity should not be double-escaped');
assert(!html.includes('<b>'), 'decoded HTML-sensitive text must not become markup');

assert.strictEqual(
    table.parseReferenceDisplayValue('42:Safe &lt;b&gt;&comma; Inc', column),
    'Safe <b>, Inc',
    'reference display helper should decode comma entities consistently'
);

console.log('Issue #2203 reference comma entity test passed');
