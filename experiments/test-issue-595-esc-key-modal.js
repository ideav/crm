/**
 * Regression test for issue #595 and modal keydown-listener cleanup.
 *
 * Verifies that the shared modal stack:
 * 1. Installs only one document-level Escape listener.
 * 2. Closes only the most recently opened (topmost) modal.
 * 3. Unregisters after button/programmatic close and external DOM removal.
 * 4. Covers every modal creation site in the modular source.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourceDir = path.join(__dirname, '..', 'js', 'integram-table');
const bootstrapPath = path.join(sourceDir, '00-class-open.js');
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8').split('class IntegramTable{')[0];

const listeners = new Map();
let addCount = 0;
let removeCount = 0;
const observers = [];

const document = {
    documentElement: {
        contains(modal) {
            return modal.isConnected !== false;
        }
    },
    addEventListener(type, listener) {
        addCount++;
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
        removeCount++;
        if (listeners.has(type)) listeners.get(type).delete(listener);
    }
};

class MutationObserver {
    constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        observers.push(this);
    }

    observe() {}

    disconnect() {
        this.disconnected = true;
    }
}

const context = vm.createContext({ document, MutationObserver });
vm.runInContext(bootstrap, context);

context.parentModal = { isConnected: true };
context.childModal = { isConnected: true };
context.closed = [];
vm.runInContext(`
    const closeParent = itCreateModalCloseHandler(parentModal, () => {
        closed.push('parent');
        parentModal.isConnected = false;
    });
    const closeChild = itCreateModalCloseHandler(childModal, () => {
        closed.push('child');
        childModal.isConnected = false;
    });
`, context);

assert.strictEqual(addCount, 1, 'two open modals share one document keydown listener');
assert.strictEqual(listeners.get('keydown').size, 1, 'only one keydown listener is active');

const dispatchKey = (key, defaultPrevented = false) => {
    for (const listener of [...(listeners.get('keydown') || [])]) listener({ key, defaultPrevented });
};

dispatchKey('Enter');
assert.deepStrictEqual(context.closed, [], 'non-Escape keys do not close modals');
dispatchKey('Escape', true);
assert.deepStrictEqual(context.closed, [], 'an inner control can consume Escape without closing its modal');

dispatchKey('Escape');
assert.deepStrictEqual(context.closed, ['child'], 'first Escape closes only the topmost modal');
assert.strictEqual(listeners.get('keydown').size, 1, 'listener remains while the parent modal is open');

dispatchKey('Escape');
assert.deepStrictEqual(context.closed, ['child', 'parent'], 'second Escape closes the parent modal');
assert.strictEqual(listeners.get('keydown').size, 0, 'listener is removed when the stack becomes empty');
assert.strictEqual(removeCount, 1, 'shared listener is removed exactly once for the first stack');

context.buttonModal = { isConnected: true };
context.buttonCloseCount = 0;
context.outsideClickCount = 0;
vm.runInContext(`
    const closeFromButton = itCreateModalCloseHandler(buttonModal, () => {
        buttonCloseCount++;
        buttonModal.isConnected = false;
    });
    itAddModalDocumentListener(buttonModal, 'click', () => outsideClickCount++);
`, context);
assert.strictEqual(listeners.get('click').size, 1, 'modal-scoped document listener is registered');
for (const listener of [...listeners.get('click')]) listener({});
assert.strictEqual(context.outsideClickCount, 1, 'modal-scoped document listener remains functional');
vm.runInContext('closeFromButton(); closeFromButton();', context);
assert.strictEqual(context.buttonCloseCount, 1, 'managed close callback is idempotent');
assert.strictEqual(listeners.get('keydown').size, 0, 'button close unregisters Escape immediately');
assert.strictEqual(listeners.get('click').size, 0, 'button close removes modal-scoped document listeners');

context.externallyRemovedModal = { isConnected: true };
vm.runInContext(`
    itCreateModalCloseHandler(externallyRemovedModal, () => {
        throw new Error('detached modal must not be closed again');
    });
    externallyRemovedModal.isConnected = false;
`, context);
for (const observer of observers) {
    if (!observer.disconnected) observer.callback();
}
assert.strictEqual(listeners.get('keydown').size, 0, 'external DOM removal unregisters the modal');
vm.runInContext("itAddModalDocumentListener(externallyRemovedModal, 'click', () => {});", context);
assert.strictEqual(listeners.get('click').size, 0,
    'async work finishing after modal removal cannot register a stale document listener');

const moduleFiles = fs.readdirSync(sourceDir)
    .filter(name => name.endsWith('.js'))
    .sort();
const modularSource = moduleFiles
    .map(name => fs.readFileSync(path.join(sourceDir, name), 'utf8'))
    .join('\n');
const creationCount = (modularSource.match(/appendChild\((?:modal|\w*Modal)\)|insertAdjacentHTML\('beforeend', modalHtml\)/g) || []).length;
const registrationCount = (modularSource.match(/itCreateModalCloseHandler\(/g) || []).length - 1;

assert.strictEqual(creationCount, 23, 'known modal creation sites are accounted for');
assert.strictEqual(registrationCount, creationCount, 'every modal creation site joins the shared Escape stack');
assert.ok(!modularSource.includes('const handleEscape ='), 'legacy per-modal Escape handlers are gone');
assert.ok(!modularSource.includes("document.addEventListener('click', (e) =>"),
    'modal-owned document click handlers must use lifecycle cleanup');
assert.ok(!modularSource.includes("window.addEventListener('resize', () => this.updateContainerHeight())"),
    'rendering must not accumulate anonymous fallback resize handlers');
assert.ok(modularSource.includes("this.container.removeEventListener('click', this._cellClickHandler)"),
    're-rendering must remove the previous delegated cell-click handler');
assert.strictEqual((modularSource.match(/addEventListener\('click', this\._cellClickHandler\)/g) || []).length, 1,
    'the table has one controlled cell-click delegation site');

console.log('✓ Modal and table lifecycles clean up global and delegated listeners');
