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

    const renderStates = [];
    const table = Object.create(IntegramTable.prototype);
    Object.assign(table, {
        options: { instanceName: 'tasksTable', tableTypeId: '100' },
        objectTableId: '100',
        columns: [
            { id: '100', name: 'Задачи', type: 3, format: 'SHORT', granted: 1, paramId: '100' }
        ],
        columnOrder: ['100'],
        visibleColumns: ['100'],
        editableColumns: new Map([['100', null]]),
        idColumns: new Set(),
        styleColumns: {},
        metadataCache: {},
        metadataFetchPromises: {},
        globalMetadata: [],
        globalMetadataPromise: null,
        async createColumn() {
            return { success: true, columnId: '200', termId: '200', refId: null };
        },
        getApiBase() {
            return '/api';
        },
        getColTypeIcon() {
            return '<span></span>';
        },
        saveColumnState() {},
        render() {
            renderStates.push({
                hasNewEditableColumn: this.editableColumns.has('200'),
                newColumn: this.columns.find(col => col.id === '200')
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

    nameInput.value = 'Срок';
    await createBtn.dispatchEventType('click');

    assert.strictEqual(renderStates.length, 1, 'add-column success should re-render once');
    assert.strictEqual(
        renderStates[0].hasNewEditableColumn,
        true,
        'newly added columns should be registered as editable before the immediate render'
    );
    assert.strictEqual(renderStates[0].newColumn.granted, 1, 'newly added columns should get write grant locally');
    assert.strictEqual(renderStates[0].newColumn.format, 'SHORT', 'newly added columns should get a render/edit format locally');
    assert.strictEqual(renderStates[0].newColumn.paramId, '200', 'inline edit should post through the new requisite id');

    console.log('PASS issue-2164 newly added columns are immediately editable');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
