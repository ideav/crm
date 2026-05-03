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

const monthField = {
    source: 'report',
    key: 'report:Месяц',
    field: 'Месяц',
    label: 'Месяц',
    kind: 'month',
    valueType: 'month',
    options: [
        { value: '2026-01', label: '2026-01' },
        { value: '2026-02', label: '2026-02' }
    ]
};

dashRenderPanelFilterModal({ id: 'panel-1' }, [monthField]);

assert(
    renderedContainer.html.includes('dash-panel-filter-label--with-toggle'),
    'bulk toggle must be rendered in the field header next to the field label'
);
assert(
    renderedContainer.html.indexOf('dash-panel-filter-select-all') < renderedContainer.html.indexOf('<span>Месяц</span>'),
    'bulk toggle must be placed before the field label'
);
assert(
    renderedContainer.html.includes('title="Выделить всё / снять выделение"'),
    'bulk toggle must expose the requested tooltip title'
);
assert(
    !renderedContainer.html.includes('dash-panel-filter-clear'),
    'panel filter must not render a second clear checkbox'
);
assert(
    !renderedContainer.html.includes('<span>Выделить всё</span>'),
    'bulk toggle must not have a visible select-all label'
);
assert(
    !renderedContainer.html.includes('<span>Очистить</span>'),
    'bulk toggle must not have a visible clear label'
);

const optionChecks = [
    { checked: true, value: '2026-01' },
    { checked: true, value: '2026-02' }
];
const toggle = {
    checked: false,
    indeterminate: false,
    classList: { contains: function(name) { return name === 'dash-panel-filter-select-all'; } },
    closest: function() { return fieldEl; }
};
const fieldEl = {
    querySelectorAll(selector) {
        return selector === '.dash-panel-filter-option-input' ? optionChecks : [];
    },
    querySelector(selector) {
        return selector === '.dash-panel-filter-select-all' ? toggle : null;
    }
};

dashHandlePanelFilterCheckboxChange(toggle);
assert.deepStrictEqual(
    optionChecks.map(function(check) { return check.checked; }),
    [false, false],
    'unchecking the single bulk toggle must clear every option'
);
assert.strictEqual(toggle.checked, false, 'bulk toggle stays unchecked when no options are checked');

toggle.checked = true;
dashHandlePanelFilterCheckboxChange(toggle);
assert.deepStrictEqual(
    optionChecks.map(function(check) { return check.checked; }),
    [true, true],
    'checking the single bulk toggle must select every option'
);
assert.strictEqual(toggle.checked, true, 'bulk toggle stays checked when every option is checked');
`;

vm.runInNewContext(code, { require });
console.log('issue-2318 dashboard panel filter toggle: ok');
