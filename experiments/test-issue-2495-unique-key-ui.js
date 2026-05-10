const assert = require('assert');

const IntegramTable = require('../js/integram-table.js');

class FakeElement {
    constructor(tagName, documentRef) {
        this.tagName = tagName.toLowerCase();
        this.documentRef = documentRef;
        this.children = [];
        this.parentElement = null;
        this.style = {};
        this.dataset = {};
        this.events = {};
        this.className = '';
        this.id = '';
        this.type = '';
        this.value = '';
        this.checked = false;
        this.disabled = false;
        this.textContent = '';
        this._innerHTML = '';
    }

    set innerHTML(html) {
        this._innerHTML = html;
        this.children = [];

        const tagPattern = /<([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
        let match;
        while ((match = tagPattern.exec(html)) !== null) {
            const tagName = match[1].toLowerCase();
            const attrs = match[2] || '';
            const child = new FakeElement(tagName, this.documentRef);
            child.parentElement = this;

            const idMatch = attrs.match(/\sid="([^"]+)"/);
            if (idMatch) child.id = idMatch[1];

            const classMatch = attrs.match(/\sclass="([^"]+)"/);
            if (classMatch) child.className = classMatch[1];

            const typeMatch = attrs.match(/\stype="([^"]+)"/);
            if (typeMatch) child.type = typeMatch[1];

            const valueMatch = attrs.match(/\svalue="([^"]*)"/);
            if (valueMatch) child.value = valueMatch[1];

            const columnIdMatch = attrs.match(/\sdata-column-id="([^"]+)"/);
            if (columnIdMatch) child.dataset.columnId = columnIdMatch[1];

            const colIdMatch = attrs.match(/\sdata-col-id="([^"]+)"/);
            if (colIdMatch) child.dataset.colId = colIdMatch[1];

            child.checked = /\schecked\b/.test(attrs);
            child.disabled = /\sdisabled\b/.test(attrs);

            if (tagName === 'select') {
                const selectEnd = html.indexOf('</select>', match.index);
                const selectHtml = html.slice(match.index, selectEnd === -1 ? undefined : selectEnd);
                const selectedOption = selectHtml.match(/<option value="([^"]+)"[^>]*selected/);
                const firstOption = selectHtml.match(/<option value="([^"]+)"/);
                child.value = selectedOption ? selectedOption[1] : (firstOption ? firstOption[1] : '');
            }

            if (child.id || child.className || tagName === 'input' || tagName === 'button') {
                this.children.push(child);
                this.documentRef.registerElement(child);
            }
        }
    }

    get innerHTML() {
        return this._innerHTML;
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        if (child.id) this.documentRef.registerElement(child);
        return child;
    }

    remove() {
        if (this.parentElement) {
            this.parentElement.children = this.parentElement.children.filter(child => child !== this);
        }
    }

    addEventListener(type, handler) {
        if (!this.events[type]) this.events[type] = [];
        this.events[type].push(handler);
    }

    async dispatchEventType(type, event = {}) {
        const handlers = this.events[type] || [];
        for (const handler of handlers) {
            await handler({
                target: this,
                preventDefault() {},
                stopPropagation() {},
                ...event
            });
        }
    }

    querySelector(selector) {
        if (selector.startsWith('#')) {
            return this._findById(selector.slice(1));
        }
        if (selector.startsWith('.')) {
            return this._findFirstByClass(selector.slice(1));
        }
        return null;
    }

    querySelectorAll(selector) {
        const matches = [];
        this._collectMatches(selector, matches);
        return matches;
    }

    _findById(id) {
        if (this.id === id) return this;
        for (const child of this.children) {
            const result = child._findById(id);
            if (result) return result;
        }
        return null;
    }

    _findFirstByClass(className) {
        if (this.className.split(/\s+/).includes(className)) return this;
        for (const child of this.children) {
            const result = child._findFirstByClass(className);
            if (result) return result;
        }
        return null;
    }

    _collectMatches(selector, matches) {
        if (this._matches(selector)) matches.push(this);
        this.children.forEach(child => child._collectMatches(selector, matches));
    }

    _matches(selector) {
        if (selector === 'input[type="checkbox"]') {
            return this.tagName === 'input' && this.type === 'checkbox';
        }
        if (selector.startsWith('.')) {
            return this.className.split(/\s+/).includes(selector.slice(1));
        }
        return false;
    }
}

class FakeDocument {
    constructor() {
        this.elementsById = {};
        this.events = {};
        this.body = new FakeElement('body', this);
    }

    createElement(tagName) {
        return new FakeElement(tagName, this);
    }

    getElementById(id) {
        return this.elementsById[id] || null;
    }

    registerElement(element) {
        if (element.id) this.elementsById[element.id] = element;
    }

    addEventListener(type, handler) {
        if (!this.events[type]) this.events[type] = [];
        this.events[type].push(handler);
    }

    removeEventListener(type, handler) {
        if (!this.events[type]) return;
        this.events[type] = this.events[type].filter(current => current !== handler);
    }

    querySelectorAll() {
        return [];
    }
}

function setupTable() {
    const fakeDocument = new FakeDocument();
    global.document = fakeDocument;
    global.window = {
        grants: { '1': 'WRITE' },
        location: { pathname: '/crm/table/100' },
        open() {}
    };
    global.setTimeout = () => 0;

    const table = Object.create(IntegramTable.prototype);
    Object.assign(table, {
        options: { instanceName: 'issue2495Table', tableTypeId: '100' },
        objectTableId: '100',
        tableGranted: 'WRITE',
        columnOrder: ['100', '200', '300'],
        visibleColumns: ['100', '200', '300'],
        columns: [
            { id: '100', name: 'Заявки', val: 'Заявки', type: '3', orig: '100', attrs: '', unique: '1' },
            { id: '200', name: 'Email', val: 'Email', type: '3', orig: '201', attrs: '{"key":true}', unique: '0' },
            { id: '300', name: 'Телефон', val: 'Телефон', type: '3', orig: '301', attrs: '', unique: '0' }
        ],
        keyToggleCalls: [],
        getApiBase() { return '/crm'; },
        getColTypeIcon() { return '<span class="col-type-icon"></span>'; },
        saveColumnState() {},
        render() {},
        closeColumnSettings() {},
        async loadData() {},
        async renameColumn() { return { success: true }; },
        async saveColumnType() { return { success: true }; },
        async setColumnRequired() { return { success: true }; },
        async setColumnAlias() { return { success: true }; },
        async toggleColumnMulti() { return { success: true }; },
        async toggleColumnKey(colId) {
            this.keyToggleCalls.push(colId);
            return { success: true };
        }
    });

    return { table, fakeDocument };
}

async function testColumnSettingsShowsUniqueKeyMarker() {
    const { table, fakeDocument } = setupTable();

    table.openColumnSettings();

    const modal = fakeDocument.body.children.find(el => el.className === 'column-settings-modal');
    assert(modal, 'column settings modal should be rendered');
    assert(
        modal.innerHTML.includes('col-key-badge'),
        'column settings modal should show a marker for fields included in the uniqueness check'
    );
    assert(
        modal.innerHTML.includes('Поле входит в проверку уникальности'),
        'key marker should explain that the field participates in uniqueness validation'
    );
}

async function testColumnEditCanToggleUniqueKey() {
    const { table, fakeDocument } = setupTable();
    const column = table.columns[1];

    table.showColumnEditForm(column);

    const modal = fakeDocument.body.children.find(el => el.className.includes('col-edit-modal'));
    const uniqueKeyTitle = 'Система контролирует уникальность комбинации первой колонки и всех ключей';
    assert(
        modal.innerHTML.includes(`title="${uniqueKeyTitle}"`),
        'uniqueness-check checkbox label should explain the full composite uniqueness rule'
    );

    const keyCheckbox = fakeDocument.getElementById('col-edit-key-issue2495Table');
    assert(keyCheckbox, 'column edit modal should render the uniqueness-check checkbox for requisites');
    assert.strictEqual(keyCheckbox.checked, true, 'checkbox should reflect the current attrs.key state');

    keyCheckbox.checked = false;
    await fakeDocument.getElementById('col-edit-save-issue2495Table').dispatchEventType('click');

    assert.deepStrictEqual(table.keyToggleCalls, ['200'], 'saving a changed key checkbox should call _d_key for the column');
    assert.strictEqual(table.parseAttrs(column.attrs).key, false, 'local column attrs should reflect the saved key state');
}

(async () => {
    await testColumnSettingsShowsUniqueKeyMarker();
    await testColumnEditCanToggleUniqueKey();
    console.log('PASS issue-2495 unique key UI');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
