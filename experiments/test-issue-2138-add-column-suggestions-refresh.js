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
        this._suggestionItems = [];
    }

    set innerHTML(html) {
        this._innerHTML = html;
        this.children = [];
        this._elementsById = {};
        this._suggestionItems = [];

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

        const suggestionCount = (html.match(/class="column-suggestion-item"/g) || []).length;
        for (let i = 0; i < suggestionCount; i += 1) {
            this._suggestionItems.push(new FakeElement('div', this.documentRef));
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

    querySelectorAll(selector) {
        if (selector === '.column-suggestion-item') {
            return this._suggestionItems;
        }
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

    let metadataFetches = 0;
    global.fetch = async (url) => {
        metadataFetches += 1;
        assert.strictEqual(url, '/api/metadata');
        return {
            ok: true,
            async json() {
                return [
                    { id: 100, val: 'Задачи', type: 3 },
                    { id: 101, val: 'Статус', type: 3, referenced: true },
                    { id: 102, val: 'Проект', type: 3 }
                ];
            }
        };
    };

    const table = Object.create(IntegramTable.prototype);
    Object.assign(table, {
        options: { instanceName: 'tasksTable' },
        columns: [],
        globalMetadata: null,
        globalMetadataPromise: null,
        metadataCache: {},
        metadataFetchPromises: {},
        getApiBase() {
            return '/api';
        },
        render() {},
        escapeHtml(value) {
            return String(value);
        }
    });

    table.showAddColumnForm(null);

    const nameInput = fakeDocument.getElementById('new-column-name-tasksTable');
    const suggestions = fakeDocument.getElementById('column-name-suggestions-tasksTable');

    assert(nameInput, 'add-column modal should render the column name input');
    assert(suggestions, 'add-column modal should render the suggestions container');

    nameInput.value = 'Стат';
    await nameInput.dispatchEventType('input');

    assert.strictEqual(metadataFetches, 1, 'typing with a cleared metadata cache should reload /metadata once');
    assert.strictEqual(suggestions.style.display, 'block');
    assert(
        suggestions.innerHTML.includes('Статус'),
        'suggestions should be rendered from freshly reloaded global metadata'
    );

    console.log('PASS issue-2138 add-column suggestions reload metadata after cache clear');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
