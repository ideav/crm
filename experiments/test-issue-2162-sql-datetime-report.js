const fs = require('fs');
const path = require('path');
const vm = require('vm');

const template = fs.readFileSync(path.join(__dirname, '..', 'templates', 'sql.html'), 'utf8');

const helperSource = [
    extractFunction(template, 'parseSqlReportUnixTimestamp'),
    extractFunction(template, 'formatSqlReportDateTime'),
    extractFunction(template, 'formatReportCellValue')
].join('\n\n');

const context = {};
vm.createContext(context);
vm.runInContext(helperSource, context);

const expected = formatExpectedDateTime(1648545599);

assert(
    context.formatReportCellValue('1648545599', { format: 'DATETIME' }) === expected,
    'DATETIME Unix timestamp should render as DD.MM.YYYY HH:mm:ss'
);
assert(
    context.formatReportCellValue('1648545599000', { format: 'DATETIME' }) === expected,
    'DATETIME JavaScript millisecond timestamp should render as DD.MM.YYYY HH:mm:ss'
);
assert(
    context.formatReportCellValue('', { format: 'DATETIME' }) === '',
    'empty DATETIME value should stay empty'
);
assert(
    context.formatReportCellValue('not-a-timestamp', { format: 'DATETIME' }) === 'not-a-timestamp',
    'unparseable DATETIME value should fall back to the original value'
);
assert(
    context.formatReportCellValue('1648545599', { format: 'SHORT' }) === '1648545599',
    'non-DATETIME values should stay unchanged'
);
assert(
    template.includes('formatReportCellValue(json[b]["data"][j][i], json[b]["columns"][j])'),
    'ShowReport should use formatReportCellValue for each displayed cell'
);

console.log('issue 2162 sql DATETIME report formatting test passed');

function extractFunction(source, name) {
    const start = source.indexOf('function ' + name + '(');
    if (start === -1) {
        throw new Error(name + ' function was not found');
    }

    const openBrace = source.indexOf('{', start);
    if (openBrace === -1) {
        throw new Error(name + ' function body was not found');
    }

    let depth = 0;
    for (let i = openBrace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') depth--;
        if (depth === 0) {
            return source.slice(start, i + 1);
        }
    }

    throw new Error(name + ' function body was not closed');
}

function formatExpectedDateTime(seconds) {
    const date = new Date(seconds * 1000);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const secondsPart = String(date.getSeconds()).padStart(2, '0');
    return `${day}.${month}.${year} ${hours}:${minutes}:${secondsPart}`;
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}
