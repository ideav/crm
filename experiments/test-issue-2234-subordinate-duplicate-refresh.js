/**
 * Issue #2234 regression coverage.
 *
 * Duplicating a record opened from a cell-level .subordinate-modal must refresh
 * that subordinate table immediately instead of only reloading the main table.
 *
 * Run with: node experiments/test-issue-2234-subordinate-duplicate-refresh.js
 */

const assert = require('assert');

const IntegramTable = require('../js/integram-table.js');

class FakeFormData {
    constructor() {
        this.fields = [
            ['main', 'Duplicated task'],
            ['t101', 'Copied comment'],
        ];
    }

    get(name) {
        const field = this.fields.find(([key]) => key === name);
        return field ? field[1] : null;
    }

    entries() {
        return this.fields[Symbol.iterator]();
    }
}

function createModal(log) {
    const form = {
        getAttribute(name) {
            return name === 'data-original-main-value' ? 'Original task' : '';
        },
    };

    return {
        _overlayElement: {
            remove() {
                log.overlayRemoved = true;
            },
        },
        querySelector(selector) {
            if (selector === '#edit-form') return form;
            if (selector.startsWith('.form-file-upload')) return null;
            return null;
        },
        remove() {
            log.modalRemoved = true;
        },
    };
}

(async function run() {
    const originalFormData = global.FormData;
    const originalFetch = global.fetch;
    const originalWindow = global.window;

    const log = {
        fetches: [],
        loadDataCalls: 0,
        loadSubordinateTableCalls: [],
        openedRecords: [],
        toasts: [],
        modalRemoved: false,
        overlayRemoved: false,
    };

    global.FormData = FakeFormData;
    global.window = { _integramModalDepth: 2 };
    global.fetch = async (url, options) => {
        log.fetches.push({ url: String(url), options });
        return {
            ok: true,
            text: async () => JSON.stringify({ id: '9002' }),
        };
    };

    try {
        const table = Object.create(IntegramTable.prototype);
        Object.assign(table, {
            data: [['Existing row']],
            loadedRecords: 1,
            hasMore: false,
            totalRows: 1,
            cellSubordinateContext: {
                arrId: 42,
                parentRecordId: '500',
                container: { id: 'cell-subordinate-container' },
            },
            getApiBase() {
                return 'https://example.test/crm';
            },
            getServerError(result) {
                return result && result.error ? result.error : null;
            },
            showToast(message, type) {
                log.toasts.push({ message, type });
            },
            async loadData() {
                log.loadDataCalls += 1;
            },
            async loadSubordinateTable(container, arrId, parentRecordId) {
                log.loadSubordinateTableCalls.push({ container, arrId, parentRecordId });
            },
            async openEditForm(recordId, typeId, rowIndex) {
                log.openedRecords.push({ recordId, typeId, rowIndex });
            },
        });

        await table.duplicateRecord(createModal(log), '8001', '42', '500', { unique: '0' });

        assert.strictEqual(log.fetches.length, 1, 'duplicate sends one create request');
        assert.ok(log.fetches[0].url.endsWith('/_m_new/42?JSON&up=500'), 'duplicate creates in the subordinate table under the same parent');
        assert.strictEqual(log.loadSubordinateTableCalls.length, 1, 'cell-opened subordinate table is refreshed after duplicate');
        assert.strictEqual(log.loadSubordinateTableCalls[0].container.id, 'cell-subordinate-container');
        assert.strictEqual(log.loadSubordinateTableCalls[0].arrId, 42);
        assert.strictEqual(log.loadSubordinateTableCalls[0].parentRecordId, '500');
        assert.strictEqual(log.loadDataCalls, 0, 'main table reload is skipped when the subordinate modal was refreshed');
        assert.deepStrictEqual(log.openedRecords, [{ recordId: '9002', typeId: '42', rowIndex: 0 }]);
        assert.strictEqual(log.modalRemoved, true, 'old edit modal is closed');
        assert.strictEqual(log.overlayRemoved, true, 'old edit overlay is closed');

        console.log('PASS issue-2234 subordinate duplicate refresh');
    } finally {
        global.FormData = originalFormData;
        global.fetch = originalFetch;
        global.window = originalWindow;
    }
})();
