'use strict';

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
        'Месяц': '202601',
        'Дата': '05.01.2026',
        'Тип найма': 'Штат',
        'Первый контакт': 10,
        'Оффер': 2
    },
    {
        'Вакансия': 'Менеджер',
        'Имя': 'Борис',
        'Месяц': '202601',
        'Дата': '15.01.2026',
        'Тип найма': 'Штат',
        'Первый контакт': 20,
        'Оффер': 5
    },
    {
        'Вакансия': 'Менеджер',
        'Имя': 'Вера',
        'Месяц': '202602',
        'Дата': '2026-02-03',
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

assert(source.includes('funnel-filter-date-from'), 'template must render the date-from filter');
assert(source.includes('funnel-filter-date-to'), 'template must render the date-to filter');

vm.runInNewContext(scriptFromTemplate(source), context);
context.funnelLoad();

elements['funnel-filter-date-from'].value = '2026-01-10';
elements['funnel-filter-date-to'].value = '2026-01-31';
context.funnelApplyFilters();

let html = elements['funnel-content'].innerHTML;
assert(html.includes('1 записей'), 'date range must narrow same-month rows to one record');
assert(html.includes('20'), 'date range must keep the row inside the selected date interval');
assert(!html.includes('>Дата<'), 'date column must not be rendered as a funnel stage');

elements['funnel-filter-month'].value = '202602';
context.funnelApplyFilters();
html = elements['funnel-content'].innerHTML;
assert(html.includes('Нет данных'), 'month and date range filters must be combined');

context.funnelResetFilters();
assert(elements['funnel-filter-date-from'].value === '', 'reset must clear the date-from filter');
assert(elements['funnel-filter-date-to'].value === '', 'reset must clear the date-to filter');

console.log('issue-2477 funnel date range: ok');
