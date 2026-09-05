/**
 * Regression coverage for duplicate automatic initialization.
 * Run with: node experiments/test-integram-table-auto-init-idempotent.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.join(__dirname, '..');
const sourcePath = path.join(rootDir, 'js', 'integram-table.js');
const source = fs.readFileSync(sourcePath, 'utf8');

const element = {
    id: 'orders-table',
    dataset: { instanceName: 'location' }
};
let domReadyHandler = null;

const documentStub = {
    readyState: 'loading',
    getElementById(id) { return id === element.id ? element : null; },
    querySelectorAll(selector) {
        return selector === '[data-integram-table]' ? [element] : [];
    },
    addEventListener(type, handler) {
        if (type === 'DOMContentLoaded') domReadyHandler = handler;
    },
    removeEventListener() {}
};
const originalLocation = { search: '', pathname: '/db/', hostname: 'localhost' };
const windowStub = {
    location: originalLocation,
    _integramTableInstances: []
};

const sandbox = {
    console,
    window: windowStub,
    document: documentStub,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    Date,
    Math,
    JSON
};
sandbox.window.window = sandbox.window;
sandbox.window.document = sandbox.document;
sandbox.globalThis = sandbox;
sandbox.self = sandbox.window;

vm.createContext(sandbox);
vm.runInContext(
    source + '\nthis.IntegramTable = IntegramTable; this.autoInitTables = autoInitTables;',
    sandbox,
    { filename: sourcePath }
);

assert.strictEqual(typeof domReadyHandler, 'function', 'DOM-ready initialization should be registered');

let initCalls = 0;
sandbox.IntegramTable.prototype.init = function initStub() {
    initCalls += 1;
};

domReadyHandler();
sandbox.autoInitTables();

assert.strictEqual(initCalls, 1, 'the same element should initialize only once');
assert.strictEqual(windowStub._integramTableInstances.length, 1, 'the global registry should not contain duplicates');
const instance = element._integramTableInstance;
assert.strictEqual(windowStub.location, originalLocation, 'an existing window global should not be overwritten');
assert.strictEqual(instance.options.instanceName, 'location_2', 'a collision should receive a unique safe alias');
assert.strictEqual(windowStub.location_2, instance, 'the unique alias should expose the instance to inline handlers');
assert.ok(instance._globalAliases.includes('location_2'), 'registered aliases should be tracked for cleanup');

console.log('PASS: automatic initialization is idempotent and collision-safe');
