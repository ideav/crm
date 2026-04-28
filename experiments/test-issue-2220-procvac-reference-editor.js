/**
 * Issue #2220 regression coverage for ProcVac reference editors.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.join(__dirname, '..');
const sourcePath = path.join(rootDir, 'js', 'procvac.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

const body = {
    children: [],
    appendChild(node) {
        node.parentNode = this;
        this.children.push(node);
    },
    removeChild(node) {
        const index = this.children.indexOf(node);
        if (index !== -1) this.children.splice(index, 1);
        node.parentNode = null;
    },
};

const sandbox = {
    console,
    window: {
        innerWidth: 472,
        innerHeight: 268,
        addEventListener() {},
        removeEventListener() {},
    },
    document: {
        addEventListener() {},
        cookie: '',
        body,
        documentElement: {
            clientWidth: 472,
            clientHeight: 268,
        },
    },
    setTimeout,
    clearTimeout,
    URLSearchParams,
    Date,
};

vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: sourcePath });

const helpers = sandbox.window.ProcVacTesting;
if (!helpers) {
    throw new Error('window.ProcVacTesting is not exposed');
}

const css = fs.readFileSync(path.join(rootDir, 'css', 'procvac.css'), 'utf8');
assert(/\.procvac-editor--floating\s*{[^}]*position:\s*fixed;/.test(css), 'reference select is fixed-positioned over the table');
assert(/\.procvac-editor--floating\s*{[^}]*z-index:\s*20;/.test(css), 'reference select renders above sticky table chrome');
assert(/\.procvac-editor--floating\s*{[^}]*box-shadow:/.test(css), 'floating reference select has visible separation from table cells');

const narrowCellRect = {
    left: 323,
    top: 102,
    bottom: 126,
    width: 62,
};
const layout = helpers.getFloatingReferenceEditorLayout(narrowCellRect, 472, 268, 180);
assertEqual(layout.width, 260, 'narrow table cells do not make the reference list too narrow');
assert(layout.left < narrowCellRect.left, 'wide floating lists shift left to stay inside the viewport');
assert(layout.left + layout.width <= 464, 'floating list stays inside the viewport right edge');
assert(layout.top >= 8, 'floating list keeps a viewport margin above');
assert(layout.top + 180 <= 260, 'floating list keeps a viewport margin below');

const editor = {
    classList: {
        values: [],
        add(value) {
            this.values.push(value);
        },
    },
    style: {},
    offsetHeight: 180,
    parentNode: null,
};
const cell = {
    getBoundingClientRect() {
        return narrowCellRect;
    },
};
const cleanup = helpers.attachFloatingReferenceEditor(editor, cell);

assert(editor.classList.values.includes('procvac-editor--floating'), 'reference select receives the floating class');
assertEqual(body.children[0], editor, 'floating reference select is appended outside the table cell');
assertEqual(editor.style.width, '260px', 'floating reference select width is applied inline');
assertEqual(editor.style.left, `${layout.left}px`, 'floating reference select left position is applied');
assertEqual(editor.style.top, `${layout.top}px`, 'floating reference select top position is applied');
assertEqual(editor.style.maxHeight, '252px', 'floating reference select height is constrained to the viewport');

cleanup();
assertEqual(body.children.length, 0, 'floating reference select is removed on cleanup');

console.log('issue-2220 procvac reference editor: ok');
