const assert = require('assert');

const IntegramTable = require('../js/integram-table.js');

class FakeElement {
    constructor(tagName, documentRef) {
        this.tagName = tagName;
        this.documentRef = documentRef;
        this.children = [];
        this.parentElement = null;
        this.style = {};
        this.dataset = {};
        this.events = {};
        this.className = '';
        this.id = '';
        this.value = '';
        this.checked = false;
        this.disabled = false;
        this.textContent = '';
        this._innerHTML = '';
        this._elementsById = {};
    }

    set innerHTML(html) {
        this._innerHTML = html;
        this.children = [];
        this._elementsById = {};

        const elementWithIdPattern = /<([a-zA-Z]+)([^>]*?)\sid="([^"]+)"([^>]*)>/g;
        let match;
        while ((match = elementWithIdPattern.exec(html)) !== null) {
            const [, tagName, beforeIdAttrs, id, afterIdAttrs] = match;
            const child = new FakeElement(tagName.toLowerCase(), this.documentRef);
            child.id = id;
            child.parentElement = this;

            const attrs = `${beforeIdAttrs} ${afterIdAttrs}`;
            const classMatch = attrs.match(/\sclass="([^"]+)"/);
            if (classMatch) {
                child.className = classMatch[1];
            }
            if (tagName.toLowerCase() === 'select') {
                const optionMatch = html.slice(match.index).match(/<option value="([^"]+)"/);
                child.value = optionMatch ? optionMatch[1] : '';
            }

            this.children.push(child);
            this._elementsById[id] = child;
            this.documentRef.registerElement(child);
        }
    }

    get innerHTML() {
        return this._innerHTML;
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        if (child.id) {
            this.documentRef.registerElement(child);
        }
        return child;
    }

    remove() {
        if (this.parentElement) {
            this.parentElement.children = this.parentElement.children.filter(child => child !== this);
        }
    }

    addEventListener(type, handler) {
        if (!this.events[type]) {
            this.events[type] = [];
        }
        this.events[type].push(handler);
    }

    async dispatchEventType(type, event = {}) {
        const handlers = this.events[type] || [];
        for (const handler of handlers) {
            await handler({ target: this, ...event });
        }
    }

    focus() {
        this.documentRef.activeElement = this;
    }

    contains(target) {
        if (target === this) {
            return true;
        }
        return this.children.some(child => child.contains(target));
    }

    querySelector(selector) {
        if (selector.startsWith('#')) {
            return this._findById(selector.slice(1));
        }
        if (selector === 'input[type="checkbox"]') {
            return this._findFirst(child => child.tagName === 'input');
        }
        return null;
    }

    querySelectorAll() {
        return [];
    }

    _findById(id) {
        if (this.id === id) {
            return this;
        }
        if (this._elementsById[id]) {
            return this._elementsById[id];
        }
        for (const child of this.children) {
            const result = child._findById(id);
            if (result) {
                return result;
            }
        }
        return null;
    }

    _findFirst(predicate) {
        if (predicate(this)) {
            return this;
        }
        for (const child of this.children) {
            const result = child._findFirst(predicate);
            if (result) {
                return result;
            }
        }
        return null;
    }
}

class FakeDocument {
    constructor() {
        this.elementsById = {};
        this.events = {};
        this.activeElement = null;
        this.body = new FakeElement('body', this);
    }

    createElement(tagName) {
        return new FakeElement(tagName, this);
    }

    getElementById(id) {
        return this.elementsById[id] || null;
    }

    registerElement(element) {
        this.elementsById[element.id] = element;
    }

    addEventListener(type, handler) {
        if (!this.events[type]) {
            this.events[type] = [];
        }
        this.events[type].push(handler);
    }

    removeEventListener(type, handler) {
        if (!this.events[type]) {
            return;
        }
        this.events[type] = this.events[type].filter(current => current !== handler);
    }

    querySelectorAll() {
        return [];
    }
}

async function run() {
    const fakeDocument = new FakeDocument();
    global.document = fakeDocument;
    global.window = {
        location: {
            pathname: '/crm/table/100',
            search: '',
            origin: 'https://example.test'
        }
    };

    const metadataFetches = [];
    const renderStates = [];
    const table = Object.create(IntegramTable.prototype);
    Object.assign(table, {
        options: { instanceName: 'tasksTable', tableTypeId: '100', dataSource: 'table' },
        objectTableId: '100',
        tableGranted: 'WRITE',
        columns: [
            { id: '100', name: 'События', type: 3, format: 'SHORT', granted: 1, paramId: '100' }
        ],
        data: [['Событие 1']],
        rawObjectData: [{ i: '900', r: ['Событие 1'] }],
        columnOrder: ['100'],
        visibleColumns: ['100'],
        editableColumns: new Map([['100', null]]),
        idColumns: new Set(),
        styleColumns: {},
        settings: { truncateLongValues: true },
        metadataCache: { 100: { stale: true } },
        metadataFetchPromises: {},
        globalMetadata: [{ id: 100, val: 'События', reqs: [] }],
        globalMetadataPromise: Promise.resolve(),
        async createColumn() {
            return { success: true, columnId: '200', termId: '300', refId: null };
        },
        async fetchMetadata(typeId) {
            metadataFetches.push({
                typeId,
                globalMetadata: this.globalMetadata,
                cachedMetadata: this.metadataCache[typeId]
            });
            return {
                id: '100',
                val: 'События',
                type: '3',
                reqs: [
                    {
                        id: '200',
                        val: 'Дата события',
                        type: '9',
                        arr_id: '300',
                        granted: 'WRITE'
                    }
                ]
            };
        },
        getApiBase() {
            return '/api';
        },
        getColTypeIcon() {
            return '<span></span>';
        },
        saveColumnState() {},
        render() {
            const newColumn = this.columns.find(col => col.id === '200');
            renderStates.push({
                newColumn,
                cellHtml: this.renderCell(newColumn, '', 0, 1)
            });
        },
        async loadGlobalMetadata() {
            return undefined;
        },
        escapeHtml(value) {
            return String(value);
        }
    });

    table.showAddColumnForm(null);

    const nameInput = fakeDocument.getElementById('new-column-name-tasksTable');
    const createBtn = fakeDocument.getElementById('create-column-btn-tasksTable');
    assert(nameInput, 'add-column modal should render the column name input');
    assert(createBtn, 'add-column modal should render the create button');

    nameInput.value = 'Дата события';
    await createBtn.dispatchEventType('click');

    assert.strictEqual(metadataFetches.length, 1, 'created columns should be resolved through fresh table metadata');
    assert.strictEqual(metadataFetches[0].typeId, '100');
    assert.strictEqual(metadataFetches[0].globalMetadata, null, 'stale global metadata should be cleared before refresh');
    assert.strictEqual(metadataFetches[0].cachedMetadata, undefined, 'stale table metadata should be cleared before refresh');
    assert.strictEqual(renderStates.length, 1, 'add-column success should re-render once');
    assert.strictEqual(renderStates[0].newColumn.arr_id, '300', 'newly added subordinate columns should keep arr_id immediately');
    assert(
        renderStates[0].cellHtml.includes('class="subordinate-link-cell"'),
        'newly added subordinate columns should render as subordinate-link-cell before page reload'
    );
    assert(
        renderStates[0].cellHtml.includes('data-arr-id="300"'),
        'subordinate cell should carry the subordinate table id'
    );

    console.log('PASS issue-2216 newly added subordinate columns render immediately');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
