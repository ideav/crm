const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function extractBrandBgScript(templatePath) {
    const html = fs.readFileSync(templatePath, 'utf8');
    const scriptMatch = html.match(/<script>\s*\/\/ Brand background opacity[\s\S]*?<\/script>/);
    assert(scriptMatch, `Brand background script not found in ${templatePath}`);
    return scriptMatch[0].replace(/^<script>\s*/, '').replace(/\s*<\/script>$/, '');
}

function runBrandBgScript(script, cookie) {
    const listeners = {};
    const documentElement = {
        style: {
            props: {},
            setProperty(name, value) {
                this.props[name] = value;
            },
            removeProperty(name) {
                delete this.props[name];
            }
        }
    };
    const body = {
        classes: new Set(),
        classList: {
            add(name) {
                body.classes.add(name);
            },
            remove(name) {
                body.classes.delete(name);
            }
        }
    };
    const select = { value: null };
    const context = {
        window: {},
        document: {
            cookie,
            body,
            documentElement,
            addEventListener(event, handler) {
                listeners[event] = handler;
            },
            getElementById(id) {
                return id === 'brand-bg-select' ? select : null;
            }
        },
        parseFloat,
        RegExp,
        decodeURIComponent,
        encodeURIComponent
    };

    vm.runInNewContext(script, context);
    assert.strictEqual(documentElement.style.props['--brand-bg-opacity'], 0.2);
    assert(body.classes.has('brand-bg-on'));

    listeners.DOMContentLoaded();
    assert.strictEqual(select.value, '0.2');
    assert.strictEqual(documentElement.style.props['--brand-bg-opacity'], 0.2);
    assert(body.classes.has('brand-bg-on'));
}

[
    'templates/main.html',
    'templates/sportzania/main.html'
].forEach((template) => {
    const script = extractBrandBgScript(path.join(__dirname, '..', template));
    runBrandBgScript(script, '');
});

console.log('Issue 1966 brand background default verified.');
