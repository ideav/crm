/**
 * Test for issue #2160: reference links should display the requisite ALIAS
 * from attrs instead of the original requisite name.
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
            {
                id: '300',
                val: 'Original Field Name',
                attrs: ':ALIAS=Alias Field Name:',
                ref: '100'
            }
        ]
    }
];
table.rawObjectData = [{ i: '42' }];

const backRefs = table.getBackReferences();
assert.strictEqual(backRefs.length, 1, 'one back-reference should be detected');
assert.strictEqual(backRefs[0].fieldName, 'Alias Field Name', 'attrs ALIAS should be used as field name');

const html = table.renderReferencesCell(0);

assert(html.includes('Orders.Alias Field Name'), 'reference link should display the attrs ALIAS');
assert(!html.includes('Orders.Original Field Name'), 'reference link should not display the original field name when ALIAS exists');
assert(html.includes('/crm/table/200?FR_300=@42'), 'reference link href should remain unchanged');

console.log('Issue #2160 reference link alias test passed');
