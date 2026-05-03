'use strict';

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

const code = `
let dashPanelFilters = {};
const CSS = { escape: function(value) { return String(value); } };

${extractFunction('dashAttr')}
${extractFunction('dashPanelFiltersFor')}
${extractFunction('dashPanelFilterSelectedMap')}
${extractFunction('dashPanelFilterOptionChecks')}
${extractFunction('dashSetPanelFilterOptionChecks')}
${extractFunction('dashSyncPanelFilterBulkControls')}
${extractFunction('dashHandlePanelFilterCheckboxChange')}
${extractFunction('dashRenderPanelFilterModal')}
${extractFunction('dashReadPanelFilterState')}

const assert = require('assert');

const renderedContainer = {
    html: '',
    set innerHTML(value) { this.html = value; },
    get innerHTML() { return this.html; },
    insertAdjacentHTML(position, html) { this.html += html; },
    querySelectorAll() { return []; }
};

const document = {
    getElementById(id) {
        assert.strictEqual(id, 'dash-panel-filter-fields');
        return renderedContainer;
    }
};

const valuesField = {
    source: 'report',
    key: 'report:client',
    field: 'Клиент',
    label: 'Клиент',
    kind: 'values',
    valueType: 'text',
    options: [
        { value: 'alpha', label: 'Альфа' },
        { value: 'beta', label: 'Бета' }
    ]
};
const rangeField = {
    source: 'report',
    key: 'report:amount',
    field: 'Сумма',
    label: 'Сумма',
    kind: 'range',
    valueType: 'number',
    min: '1',
    max: '9'
};

dashRenderPanelFilterModal({ id: 'panel-1' }, [valuesField, rangeField]);

assert(
    renderedContainer.html.includes('dash-panel-filter-label--with-toggle'),
    'multi-value panel filters must render a bulk checkbox control in the field label'
);
assert(
    renderedContainer.html.includes('title="Выделить всё / снять выделение"'),
    'bulk control must include the select/clear tooltip'
);
assert(
    !renderedContainer.html.includes('dash-panel-filter-clear'),
    'multi-value panel filters must not render a second clear checkbox'
);
assert(
    renderedContainer.html.includes('dash-panel-filter-option-input'),
    'value option checkboxes must be distinguishable from bulk-control checkboxes'
);

const optionChecks = [
    { checked: true, value: 'alpha' },
    { checked: false, value: 'beta' }
];
const fakeFieldEl = {
    querySelectorAll(selector) {
        if (selector === '.dash-panel-filter-option-input') return optionChecks;
        return [];
    },
    querySelector() {
        return null;
    }
};
const readContainer = {
    querySelector() {
        return fakeFieldEl;
    }
};
document.getElementById = function(id) {
    assert.strictEqual(id, 'dash-panel-filter-fields');
    return readContainer;
};

const state = dashReadPanelFilterState([valuesField]);
assert.deepStrictEqual(
    state['report:client'].selected,
    ['alpha'],
    'reading panel filter state must ignore bulk-control checkboxes'
);

const eventOptionChecks = [
    { checked: false, value: 'alpha' },
    { checked: false, value: 'beta' }
];
const selectAll = {
    checked: true,
    indeterminate: false,
    classList: { contains: function(name) { return name === 'dash-panel-filter-select-all'; } },
    closest: function() { return eventFieldEl; }
};
const eventFieldEl = {
    querySelectorAll(selector) {
        return selector === '.dash-panel-filter-option-input' ? eventOptionChecks : [];
    },
    querySelector(selector) {
        if (selector === '.dash-panel-filter-select-all') return selectAll;
        return null;
    }
};

dashHandlePanelFilterCheckboxChange(selectAll);
assert.deepStrictEqual(
    eventOptionChecks.map(function(check) { return check.checked; }),
    [true, true],
    'select-all checkbox must check every value option'
);
assert.strictEqual(selectAll.checked, true, 'select-all stays checked when all options are checked');
assert.strictEqual(selectAll.indeterminate, false, 'select-all is not indeterminate when all options are checked');

selectAll.checked = false;
dashHandlePanelFilterCheckboxChange(selectAll);
assert.deepStrictEqual(
    eventOptionChecks.map(function(check) { return check.checked; }),
    [false, false],
    'select-all checkbox must uncheck every value option'
);
assert.strictEqual(selectAll.checked, false, 'select-all stays unchecked when no options are checked');
`;

vm.runInNewContext(code, { require });
console.log('issue-2312 dashboard panel filter bulk controls: ok');
