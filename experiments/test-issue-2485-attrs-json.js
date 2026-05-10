const assert = require('assert');
const IntegramTable = require('../js/integram-table.js');

const parse = IntegramTable.parseAttrsValue;
const serialize = IntegramTable.serializeAttrsValue;

assert.deepStrictEqual(parse(':!NULL::MULTI::ALIAS=Owner:[USER_ID]'), {
    required: true,
    multi: true,
    alias: 'Owner',
    defaultValue: '[USER_ID]'
});

assert.deepStrictEqual(parse('{"required":true,"multi":true,"alias":"Owner","default":"[USER_ID]"}'), {
    required: true,
    multi: true,
    alias: 'Owner',
    defaultValue: '[USER_ID]'
});

assert.deepStrictEqual(parse('{\\"required\\":true,\\"alias\\":\\"Escaped\\"}'), {
    required: true,
    multi: false,
    alias: 'Escaped',
    defaultValue: null
});

assert.deepStrictEqual(parse('{"display":"wide","required":true}'), {
    required: true,
    multi: false,
    alias: null,
    defaultValue: null,
    display: 'wide'
});

assert.strictEqual(
    serialize({ required: true, multi: true, alias: 'Owner', defaultValue: '[USER_ID]' }),
    '{"required":true,"multi":true,"alias":"Owner","default":"[USER_ID]"}'
);

assert.strictEqual(
    serialize(parse('{"display":"wide","required":true}')),
    '{"display":"wide","required":true}'
);

console.log('issue-2485 JS attrs JSON tests passed');
