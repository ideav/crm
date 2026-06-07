/**
 * Regression test for issue #3211.
 *
 * Reference columns can have a DATETIME base type. JSON_OBJ values then arrive
 * as "recordId:timestamp" (for example "23077:1772312400"). The cell renderer
 * must keep the reference ID for links, but format the label part as DATETIME.
 */

const IntegramTable = require('../js/integram-table.js');

global.window = {
    location: { pathname: '/crm/table/1078' },
    INTEGRAM_DEBUG: false
};

const table = Object.create(IntegramTable.prototype);
Object.assign(table, {
    settings: { truncateLongValues: false },
    editableColumns: new Map(),
    styleColumns: {},
    columns: [],
    data: [],
    rawObjectData: [{ i: 23316, u: 1, o: 1, r: ['1780837651', '23077:1772312400'] }],
    objectTableId: '1078',
    options: {
        instanceName: 'table',
        dataSource: 'table',
        parentId: null
    }
});

const rawValue = '23077:1772312400';
const column = {
    id: '15018',
    type: '4',
    format: 'REF',
    name: 'Партия сырья',
    ref: '1074',
    ref_id: '1158',
    orig: '1074',
    attrs: '',
    paramId: '15018'
};

table.columns = [column];
table.data = [[rawValue]];

const expectedLabel = table.formatDateTimeDisplay(
    table.parseDDMMYYYYHHMMSS('1772312400')
);
const html = table.renderCell(column, rawValue, 0, 0);

function assert(condition, message) {
    if (!condition) {
        console.error(`FAIL: ${message}`);
        console.error(html);
        process.exit(1);
    }
    console.log(`PASS: ${message}`);
}

assert(html.includes(`F_I=23077`), 'reference link uses the record ID from the prefix');
assert(html.includes(`>${expectedLabel}</a>`), 'reference timestamp label is formatted as DATETIME');
assert(!html.includes('>1772312400</a>'), 'raw timestamp is not displayed as the link label');
