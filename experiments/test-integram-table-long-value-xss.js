/*
 * Regression test: long cell values must remain inert data all the way from
 * rendering, through delegated click handling, to the full-value modal.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const bundle = fs.readFileSync(path.join(__dirname, '..', 'js', 'integram-table.js'), 'utf8');
const documentListeners = new Map();
const appendedElements = [];

function makeControl() {
    return {
        innerHTML: '',
        listeners: new Map(),
        addEventListener(type, handler) { this.listeners.set(type, handler); }
    };
}

function makeModal() {
    const pre = { textContent: '' };
    const closeButton = makeControl();
    const copyButton = makeControl();
    const contentArea = makeControl();
    return {
        className: '',
        innerHTML: '',
        isConnected: true,
        removed: false,
        listeners: new Map(),
        addEventListener(type, handler) { this.listeners.set(type, handler); },
        matches: () => false,
        querySelector(selector) {
            if (selector === 'pre') return pre;
            if (selector === '.full-value-close-btn') return closeButton;
            if (selector === '.full-value-copy-btn') return copyButton;
            if (selector === '.full-value-content') return contentArea;
            return null;
        },
        remove() { this.removed = true; this.isConnected = false; },
        _pre: pre
    };
}

const documentStub = {
    activeElement: null,
    cookie: '',
    readyState: 'complete',
    body: {
        classList: { add() {}, remove() {} },
        appendChild(element) { appendedElements.push(element); }
    },
    documentElement: null,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement(tagName) {
        return tagName === 'div' ? makeModal() : makeControl();
    },
    addEventListener(type, handler) { documentListeners.set(type, handler); },
    removeEventListener(type, handler) {
        if (documentListeners.get(type) === handler) documentListeners.delete(type);
    }
};

const sandbox = {
    console,
    URL,
    URLSearchParams,
    document: documentStub,
    location: { pathname: '/demo/table/1', search: '', hostname: 'localhost', origin: 'http://localhost' },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    setTimeout: () => 0
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const { IntegramTable } = vm.runInContext(
    bundle + '\n;({ IntegramTable });',
    sandbox,
    { filename: 'integram-table.js' }
);

const originalInit = IntegramTable.prototype.init;
IntegramTable.prototype.init = function () {};
const table = new IntegramTable('table', { apiUrl: '/demo/object/1', instanceName: 'table' });
IntegramTable.prototype.init = originalInit;

table.settings.truncateLongValues = true;
table.columns = [{ id: '10', name: 'Описание', format: 'SHORT', attrs: '' }];
table.columnOrder = ['10'];
table.visibleColumns = ['10'];
table.data = [[]];
table.rawObjectData = [];
table.styleColumns = {};
table.editableColumns = new Map();

const dangerousValue = 'Длинное значение '.repeat(12) + '"><img src=x onerror=alert(1)>\' onclick=\'alert(2)';
const renderedCell = table.renderCell(table.columns[0], dangerousValue, 0, 0);

assert.match(renderedCell, /class="show-full-value"/,
    'long text renders an explicit full-value affordance');
assert.match(renderedCell, /data-full-value="[^"]+"/,
    'the complete value is carried by a data attribute');
assert.doesNotMatch(renderedCell, /<img\b|\sonclick\s*=\s*["']/i,
    'rendering a long value cannot create executable markup');

let delegatedClick = null;
const container = {
    listeners: new Map(),
    contains: node => node === delegatedClick,
    addEventListener(type, handler) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(handler);
    },
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    classList: { add() {}, remove() {} }
};
table.container = container;
table.columnOrder = [];
table.visibleColumns = [];
table.attachEventListeners();

let openedValue = null;
table.showFullValue = (_event, value) => { openedValue = value; };
delegatedClick = { dataset: { fullValue: dangerousValue } };
const clickEvent = {
    target: { closest: selector => selector === '.show-full-value' ? delegatedClick : null },
    preventDefault() {},
    stopImmediatePropagation() {}
};
table._fullValueClickHandler(clickEvent);
assert.strictEqual(openedValue, dangerousValue,
    'delegated clicks deliver the original value without evaluating it');

table.showFullValue = IntegramTable.prototype.showFullValue;
table.showFullValue({ preventDefault() {} }, dangerousValue);
const displayedModal = appendedElements.find(element => element.className === 'column-settings-modal');
assert.ok(displayedModal, 'the full-value modal is appended to the document');
assert.strictEqual(displayedModal._pre.textContent, dangerousValue,
    'the modal assigns untrusted content as text');
assert.doesNotMatch(displayedModal.innerHTML, /<img\b|onclick=/i,
    'untrusted content is never interpolated into the modal markup');

console.log('PASS long table values stay inert through render, click and modal display');
