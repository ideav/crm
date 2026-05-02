// Test for issue #2286: dashboard pivot rendering must wait for
// jQuery UI sortable before calling PivotTable UI.

const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/dash.js', 'utf8');

function extractFunction(name) {
    const marker = 'function ' + name + '(';
    const start = source.indexOf(marker);
    if (start === -1) return '';
    const braceStart = source.indexOf('{', start);
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') depth--;
        if (depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('Unclosed function ' + name);
}

function assert(condition, message) {
    if (!condition) throw new Error('FAIL: ' + message);
    console.log('PASS: ' + message);
}

function createDocument() {
    const elements = [];
    const byId = {};
    return {
        elements,
        head: {
            appendChild(el) {
                elements.push(el);
                if (el.id) byId[el.id] = el;
            }
        },
        createElement(tagName) {
            return {
                tagName,
                attributes: {},
                listeners: {},
                setAttribute(name, value) {
                    this.attributes[name] = String(value);
                },
                getAttribute(name) {
                    return this.attributes[name] || null;
                },
                addEventListener(name, cb) {
                    this.listeners[name] = this.listeners[name] || [];
                    this.listeners[name].push(cb);
                },
                dispatch(name) {
                    (this.listeners[name] || []).forEach(function(cb) { cb(); });
                }
            };
        },
        getElementById(id) {
            return byId[id] || null;
        }
    };
}

const code = [
    'dashLoadScriptOnce',
    'dashPivotDepsReady',
    'dashEnsurePivotJs',
    'dashRenderPivot'
].map(extractFunction).join('\n');

const document = createDocument();
let pivotCalled = false;
let pivotRows = null;

function jQuery() {
    return {
        pivotUI(records, options) {
            pivotCalled = true;
            pivotRows = options.rows;
            if (!jQuery.fn.sortable) throw new TypeError('sortable is not a function');
        }
    };
}
jQuery.fn = {
    pivotUI() {}
};

const ctx = {
    console,
    document,
    window: { jQuery }
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const pivotWrap = { innerHTML: 'old pivot' };
ctx.dashRenderPivot(
    {},
    pivotWrap,
    { labels: ['Подбор'], datasets: [{ label: 'План', data: [7] }] },
    {}
);

assert(!pivotCalled, 'pivotUI is deferred while sortable is missing');

const jqueryUiScript = document.elements.find(function(el) {
    return el.tagName === 'script' && el.id === 'jquery-ui-js';
});
assert(jqueryUiScript, 'jQuery UI script is requested');
assert(/jquery-ui/i.test(jqueryUiScript.src), 'requested script is jQuery UI');

jQuery.fn.sortable = function() {};
if (jqueryUiScript.onload) jqueryUiScript.onload();
jqueryUiScript.dispatch('load');

assert(pivotCalled, 'pivotUI is called after sortable is available');
assert(pivotWrap.innerHTML === '', 'pivot container is cleared before rendering');
assert(pivotRows[0] === 'Строка', 'default pivot rows are preserved');

console.log('issue-2286 dashboard pivot sortable dependency: ok');
