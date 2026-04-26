const assert = require('assert');

const IntegramTable = require('../js/integram-table.js');

const table = Object.create(IntegramTable.prototype);

function resolve(options, rawValue) {
    return table.resolveCurrentFormReferenceOption(options, rawValue);
}

{
    const staleOptions = [
        ['101', 'Старая строка бюджета'],
        ['102', 'Старая колонка бюджета'],
    ];

    const result = resolve(staleOptions, '155560:NPS родителей');

    assert.strictEqual(result.id, '155560');
    assert.strictEqual(result.text, 'NPS родителей');
    assert.deepStrictEqual(result.options[0], ['155560', 'NPS родителей']);
    assert.strictEqual(staleOptions.length, 2, 'helper should not mutate cached option arrays');
}

{
    const freshOptions = [
        ['155560', 'NPS родителей'],
        ['102', 'Старая колонка бюджета'],
    ];

    const result = resolve(freshOptions, '155560:NPS родителей');

    assert.strictEqual(result.id, '155560');
    assert.strictEqual(result.text, 'NPS родителей');
    assert.strictEqual(result.options.length, 2, 'current option already present should not be duplicated');
}

{
    const result = resolve([['101', 'Старая строка бюджета']], '155560');

    assert.strictEqual(result.id, '155560');
    assert.strictEqual(result.text, '');
    assert.deepStrictEqual(result.options, [['101', 'Старая строка бюджета']]);
}

{
    const result = resolve([['101', 'Старая строка бюджета']], '');

    assert.strictEqual(result.id, '');
    assert.strictEqual(result.text, '');
    assert.deepStrictEqual(result.options, [['101', 'Старая строка бюджета']]);
}

console.log('PASS issue-2144 form reference current value survives stale options');
