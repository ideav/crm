const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const templatePath = path.join(__dirname, '..', 'templates', 'upload.html');
const source = fs.readFileSync(templatePath, 'utf8');

function extractFunction(name) {
    const start = source.indexOf('function ' + name + '(');
    assert(start !== -1, name + ' must be defined in templates/upload.html');

    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let i = bodyStart; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error('Unable to extract ' + name);
}

const context = {};
vm.runInNewContext([
    extractFunction('serializeUploadCellValue'),
    extractFunction('normalizeUploadJsonRecord'),
    extractFunction('normalizeUploadJsonRows'),
    extractFunction('getUploadParseText')
].join('\n'), context);

const issueRows = [{
    ID: '1',
    ENTITY_ID: 'STATUS',
    EXTRA: { SEMANTICS: 'process', COLOR: '#fff55a' }
}];

const normalized = context.normalizeUploadJsonRows(issueRows);
context.Papa = {
    unparse(rows) {
        assert.strictEqual(rows[0].EXTRA, '{"SEMANTICS":"process","COLOR":"#fff55a"}');
        return 'ID,ENTITY_ID,EXTRA\r\n1,STATUS,"{""SEMANTICS"":""process"",""COLOR"":""#fff55a""}"';
    }
};

assert.strictEqual(
    context.serializeUploadCellValue(issueRows[0].EXTRA),
    '{"SEMANTICS":"process","COLOR":"#fff55a"}',
    'plain object cell values are serialized as JSON'
);
assert.strictEqual(
    normalized[0].EXTRA,
    '{"SEMANTICS":"process","COLOR":"#fff55a"}',
    'JSON import rows preserve nested object contents before Papa.unparse'
);
assert.strictEqual(
    context.serializeUploadCellValue(null),
    '',
    'null cell values keep existing empty-cell behavior'
);
assert.notStrictEqual(
    normalized[0].EXTRA,
    '[object Object]',
    'object cells must not collapse to [object Object]'
);
assert.strictEqual(
    context.getUploadParseText(JSON.stringify(issueRows)),
    'ID,ENTITY_ID,EXTRA\r\n1,STATUS,"{""SEMANTICS"":""process"",""COLOR"":""#fff55a""}"',
    'JSON text is normalized before Papa parses the generated CSV'
);

console.log('issue 2705 upload object serialization checks passed');
