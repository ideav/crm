/**
 * Test for issue #2132: links in .references-column-cell should be light gray.
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
table.options = { tableTypeId: '100' };
table.objectTableId = null;
table.globalMetadata = [
    { id: '100', val: 'Products', reqs: [] },
    {
        id: '200',
        val: 'Orders',
        reqs: [
            { id: '300', val: 'Product', ref: '100' }
        ]
    }
];
table.rawObjectData = [{ i: '42' }];

const html = table.renderReferencesCell(0);

assert(html.includes('class="references-column-cell"'), 'references cell should be rendered');
assert(html.includes('class="reference-link"'), 'reference link should be rendered');
assert(html.includes('style="color: #9ca3af;"'), 'reference links should be light gray');
assert(html.includes('/crm/table/200?FR_300=@42'), 'reference link href should remain unchanged');

console.log('Issue #2132 reference link color test passed');
