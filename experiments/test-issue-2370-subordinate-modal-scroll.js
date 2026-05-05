/**
 * Issue #2370 regression coverage.
 *
 * Subordinate tables shown inside an expanded edit form use the same
 * .edit-form-body scroll area as .subordinate-modal, but the modal itself does
 * not always have the .subordinate-modal class. Infinite scroll must attach to
 * the nearest edit form body and must ignore inactive subordinate tabs so row
 * ordering by drag-and-drop stays tied to the active visible table.
 *
 * Run with: node experiments/test-issue-2370-subordinate-modal-scroll.js
 */

const assert = require('assert');

const IntegramTable = require('../js/integram-table.js');

class ClassList {
    constructor(classes = []) {
        this.classes = new Set(classes);
    }

    contains(name) {
        return this.classes.has(name);
    }

    add(name) {
        this.classes.add(name);
    }

    remove(name) {
        this.classes.delete(name);
    }
}

function makeScrollBody() {
    return {
        scrollHeight: 1000,
        scrollTop: 750,
        clientHeight: 200,
        listeners: [],
        addEventListener(type, listener) {
            if (type === 'scroll') this.listeners.push(listener);
        },
        removeEventListener(type, listener) {
            if (type === 'scroll') {
                this.listeners = this.listeners.filter(existing => existing !== listener);
            }
        },
        dispatchScroll() {
            this.listeners.forEach(listener => listener());
        }
    };
}

function makeModal(scrollBody) {
    return {
        classList: new ClassList(['edit-form-modal', 'expanded']),
        querySelector(selector) {
            return selector === '.edit-form-body' ? scrollBody : null;
        }
    };
}

function makeTabContent(active) {
    return {
        classList: new ClassList(active ? ['edit-form-tab-content', 'active'] : ['edit-form-tab-content'])
    };
}

function makeContainer(modal, tabContent) {
    return {
        _subordinateIsLoading: false,
        _subordinateHasMore: true,
        closest(selector) {
            if (selector === '.edit-form-modal') return modal;
            if (selector === '.edit-form-modal.subordinate-modal') return null;
            if (selector === '.edit-form-tab-content') return tabContent;
            return null;
        }
    };
}

(async function run() {
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => {
        fn();
        return 0;
    };

    try {
        const scrollBody = makeScrollBody();
        const modal = makeModal(scrollBody);
        const activeTab = makeTabContent(true);
        const hiddenTab = makeTabContent(false);
        const activeContainer = makeContainer(modal, activeTab);
        const hiddenContainer = makeContainer(modal, hiddenTab);

        const loadCalls = [];
        const table = Object.create(IntegramTable.prototype);
        table.loadMoreSubordinateRows = async (container) => {
            loadCalls.push(container);
        };

        table.attachSubordinateScrollListener(activeContainer);
        assert.strictEqual(scrollBody.listeners.length, 1, 'active subordinate tab should attach one scroll listener');
        assert.deepStrictEqual(loadCalls, [activeContainer], 'active tab should auto-load when already near the bottom');

        table.attachSubordinateScrollListener(hiddenContainer);
        assert.strictEqual(scrollBody.listeners.length, 2, 'another tab can keep its own listener without replacing the active tab listener');
        assert.deepStrictEqual(loadCalls, [activeContainer], 'inactive tab must not auto-load while hidden');

        scrollBody.dispatchScroll();
        assert.deepStrictEqual(loadCalls, [activeContainer, activeContainer], 'scrolling should load only the active visible subordinate table');

        console.log('PASS issue-2370 subordinate modal infinite scroll');
    } finally {
        global.setTimeout = originalSetTimeout;
    }
})();
