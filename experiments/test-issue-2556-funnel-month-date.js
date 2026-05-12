'use strict';

// Verifies issue #2556 requirements for templates/funnel.html:
//   1. Changing date-from / date-to resets the month filter to "Все".
//   2. Month options are rendered in the human-readable form ("янв 2025").
//   3. Selecting a month sets date-from / date-to to that month's start/end.

const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('templates/funnel.html', 'utf8');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function scriptFromTemplate(html) {
    const match = html.match(/<script>([\s\S]*)<\/script>\s*$/);
    if (!match) throw new Error('Unable to extract funnel script');
    return match[1];
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function createElement(tagName) {
    const element = {
        tagName: String(tagName || '').toUpperCase(),
        _textContent: '',
        _innerHTML: '',
        value: '',
        options: [],
        classList: {
            toggle: function() {}
        },
        appendChild: function(child) {
            this.options.push(child);
            return child;
        },
        remove: function(index) {
            this.options.splice(index, 1);
        },
        setAttribute: function() {},
        querySelector: function() {
            return null;
        }
    };

    Object.defineProperty(element, 'textContent', {
        get: function() { return this._textContent; },
        set: function(value) { this._textContent = String(value || ''); }
    });
    Object.defineProperty(element, 'innerHTML', {
        get: function() {
            return this._innerHTML || escapeHtml(this._textContent);
        },
        set: function(value) { this._innerHTML = String(value || ''); }
    });

    return element;
}

function createSelect() {
    const select = createElement('select');
    select.options.push({ value: '', textContent: '— Все —' });
    return select;
}

const elements = {
    'funnel-content': createElement('div'),
    'funnel-filter-vacancy': createSelect(),
    'funnel-filter-name': createSelect(),
    'funnel-filter-month': createSelect(),
    'funnel-filter-hire-type': createSelect(),
    'funnel-filter-date-from': createElement('input'),
    'funnel-filter-date-to': createElement('input'),
    'funnel-view-chart': createElement('button'),
    'funnel-view-table': createElement('button'),
    'funnel-container': createElement('div')
};

const rows = [
    {
        'Вакансия': 'Менеджер',
        'Имя': 'Алина',
        'Месяц': '202501',
        'Дата': '05.01.2025',
        'Тип найма': 'Штат',
        'Первый контакт': 10,
        'Оффер': 2
    },
    {
        'Вакансия': 'Менеджер',
        'Имя': 'Борис',
        'Месяц': '202501',
        'Дата': '20.01.2025',
        'Тип найма': 'Штат',
        'Первый контакт': 20,
        'Оффер': 5
    },
    {
        'Вакансия': 'Менеджер',
        'Имя': 'Вера',
        'Месяц': '202502',
        'Дата': '2025-02-03',
        'Тип найма': 'Штат',
        'Первый контакт': 30,
        'Оффер': 8
    }
];

function FakeXHR() {}
FakeXHR.prototype.open = function() {};
FakeXHR.prototype.send = function() {
    this.responseText = JSON.stringify(rows);
    this.onload();
};

const context = {
    console: console,
    db: 'crm',
    XMLHttpRequest: FakeXHR,
    document: {
        getElementById: function(id) {
            if (!elements[id]) throw new Error('Missing fake element #' + id);
            return elements[id];
        },
        createElement: createElement,
        addEventListener: function() {},
        querySelector: function() {
            return null;
        }
    },
    window: {}
};
context.window = context;

// The template's filter handlers must call the new functions.
assert(/onchange="funnelMonthChanged\(\)"/.test(source), 'month filter must call funnelMonthChanged');
assert(/onchange="funnelDateChanged\(\)"/.test(source), 'date filters must call funnelDateChanged');

vm.runInNewContext(scriptFromTemplate(source), context);
context.funnelLoad();

// Requirement 2: month options are rendered in human-readable form.
const monthSelect = elements['funnel-filter-month'];
const monthOptions = monthSelect.options
    .filter(function(opt) { return opt.value; })
    .map(function(opt) { return opt.textContent; });
assert(monthOptions.indexOf('янв 2025') !== -1, 'month option for 202501 must read "янв 2025"');
assert(monthOptions.indexOf('фев 2025') !== -1, 'month option for 202502 must read "фев 2025"');

// Requirement 3: picking a month sets date-from / date-to to that month's bounds.
elements['funnel-filter-month'].value = '202501';
context.funnelMonthChanged();
assert(
    elements['funnel-filter-date-from'].value === '2025-01-01',
    'date-from must equal first day of selected month, got ' + elements['funnel-filter-date-from'].value
);
assert(
    elements['funnel-filter-date-to'].value === '2025-01-31',
    'date-to must equal last day of selected month, got ' + elements['funnel-filter-date-to'].value
);
let html = elements['funnel-content'].innerHTML;
assert(html.includes('2 записей'), 'month picker must narrow data to January rows, got: ' + html.slice(0, 200));

// Requirement 1: changing date-from resets month filter to "Все".
elements['funnel-filter-date-from'].value = '2025-01-15';
context.funnelDateChanged();
assert(
    elements['funnel-filter-month'].value === '',
    'changing date-from must reset month filter, got "' + elements['funnel-filter-month'].value + '"'
);
html = elements['funnel-content'].innerHTML;
assert(html.includes('1 записей'), 'date-from must narrow to one row in mid-January');

// And changing date-to with an empty date-from also resets the month filter.
elements['funnel-filter-month'].value = '202502';
elements['funnel-filter-date-from'].value = '';
elements['funnel-filter-date-to'].value = '2025-02-28';
context.funnelDateChanged();
assert(
    elements['funnel-filter-month'].value === '',
    'changing date-to must reset month filter, got "' + elements['funnel-filter-month'].value + '"'
);

// Picking the empty "— Все —" month must not overwrite manually entered dates.
elements['funnel-filter-date-from'].value = '2025-03-01';
elements['funnel-filter-date-to'].value = '2025-03-31';
elements['funnel-filter-month'].value = '';
context.funnelMonthChanged();
assert(
    elements['funnel-filter-date-from'].value === '2025-03-01'
        && elements['funnel-filter-date-to'].value === '2025-03-31',
    'choosing "— Все —" month must not overwrite manually entered dates'
);

// February (non-31-day month) must compute the correct last day.
elements['funnel-filter-month'].value = '202502';
context.funnelMonthChanged();
assert(
    elements['funnel-filter-date-to'].value === '2025-02-28',
    'February 2025 last day must be 28, got ' + elements['funnel-filter-date-to'].value
);

console.log('issue-2556 funnel month/date sync: ok');
