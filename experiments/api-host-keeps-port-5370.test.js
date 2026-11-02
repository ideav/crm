// #5370: страница открыта на нестандартном порту (on-prem Docker, :8443) —
// запросы к API обязаны идти на тот же host:port, а не на :443.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const loc = {
    protocol: 'https:', hostname: '10.10.64.7', host: '10.10.64.7:8443', port: '8443',
    origin: 'https://10.10.64.7:8443', pathname: '/r7ohr/table/18', search: '',
};

test('app.js: login/auth URL keeps the page port', () => {
    const ctx = {
        console, URLSearchParams, setTimeout,
        document: {
            addEventListener() {}, getElementById() { return null; },
            querySelectorAll() { return []; }, querySelector() { return null; },
            cookie: '', documentElement: { setAttribute() {} }, body: { appendChild() {} },
        },
        window: { location: loc },
        localStorage: { getItem() { return null; }, setItem() {} },
    };
    ctx.window.localStorage = ctx.localStorage;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/app.js'), 'utf8'), ctx);
    const base = vm.runInContext('new ApiConfig().getBaseUrl("r7ohr")', ctx);
    assert.strictEqual(base, 'https://10.10.64.7:8443/r7ohr');
});

test('integram-table: API base from page URL keeps the port', () => {
    const sb = {
        console, URLSearchParams, location: loc, history: { replaceState() {} },
        document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
                    addEventListener() {}, readyState: 'complete' },
    };
    sb.window = sb;
    sb.globalThis = sb;
    vm.createContext(sb);
    const src = fs.readFileSync(path.join(root, 'js/integram-table.js'), 'utf8');
    const IntegramTable = vm.runInContext(src + '\n;({ IntegramTable });', sb).IntegramTable;
    const t = Object.create(IntegramTable.prototype);
    t.options = {};
    assert.strictEqual(t.getApiBase(), 'https://10.10.64.7:8443/r7ohr');
});
