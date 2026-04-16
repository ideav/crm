const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('templates/dash.html', 'utf8');

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

const code = `
const itemRegex = /^\\[([A-Za-яЁё][ A-Za-яЁё0-9\\(\\)-]*)\\]$/;
let dashValues = Object.create(null);
let dashItems = Object.create(null);
let dashFormulas = Object.create(null);
function dashTrace() {}
${extractFunction('dashGetFloat')}
${extractFunction('dashNormalizeVal')}
${extractFunction('dashGetVal')}
${extractFunction('dashResolveValueCell')}

dashItems['2263'] = { name: 'Выручка' };
dashFormulas['2263'] = '[]';
dashValues['Выручка:План'] = [{ date: '20260101', val: '340434754' }];
dashValues['Выручка:Факт'] = [{ date: '20260101', val: '42' }];

const plan = dashResolveValueCell('2263', 'План');
const fact = dashResolveValueCell('2263', 'Факт');
const percent = dashResolveValueCell('2263', '%');

if (plan.value !== '340434754') {
    throw new Error('Expected План value 340434754, got ' + plan.value);
}
if (fact.value !== '42') {
    throw new Error('Expected Факт value 42, got ' + fact.value);
}
if (percent.value !== undefined) {
    throw new Error('Expected % value to stay empty without a matching group, got ' + percent.value);
}
`;

vm.runInNewContext(code, { console });
console.log('issue-1879 dashboard grouped value lookup: ok');
