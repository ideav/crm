// Tests for ideav/crm#5508 — пункты меню, заканчивающиеся одинаково, подсвечивались вместе.
//
// Симптом: на /ateh1/label-orders активными горели и «label-orders», и «orders».
// Корень: highlightActiveMenuItem сравнивал путь подстрокой (`currentPath.includes(dataHref)`),
// а "/ateh1/label-orders" содержит "orders".
// Правило: адрес пункта совпадает с путём только целыми сегментами.
//
// rules: none (defect #5508)
// Run with: node experiments/issue-5508-menu-suffix-highlight.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'main-app.js'), 'utf8');

function makeItem(href) {
    const classes = new Set();
    const attrs = { 'data-href': href, 'data-menu-id': href };
    return {
        href,
        classList: { add: c => classes.add(c), contains: c => classes.has(c) },
        getAttribute: k => (k in attrs ? attrs[k] : null),
        querySelector: () => ({ textContent: href }),
        isActive: () => classes.has('active'),
    };
}

// Возвращает список активных пунктов для заданного адреса.
function activeFor(hrefs, pathname, search, action) {
    const items = hrefs.map(makeItem);
    const document = {
        addEventListener() {},
        querySelector: () => null,
        querySelectorAll: sel => (sel === '.app-menu-item' ? items
            : sel === '.app-menu-item.active' ? items.filter(i => i.isActive()) : []),
        getElementById: () => null,
    };
    const ctx = vm.createContext({
        document, window: { location: { pathname, search: search || '' } },
        console, setTimeout() {},
    });
    if (action !== undefined) ctx.action = action;
    vm.runInContext(src + '\n;this.__C = MainAppController;', ctx);
    ctx.__C.prototype.highlightActiveMenuItem.call({ expandParentMenus() {} });
    return items.filter(i => i.isActive()).map(i => i.href);
}

const results = [];
function check(name, fn) {
    try { fn(); results.push(['ok', name]); }
    catch (e) { results.push(['FAIL', name + ': ' + e.message]); }
}

const MENU = ['orders', 'label-orders'];

check('на /ateh1/label-orders горит только label-orders', () => {
    assert.deepStrictEqual(activeFor(MENU, '/ateh1/label-orders'), ['label-orders']);
});
check('на /ateh1/orders горит только orders', () => {
    assert.deepStrictEqual(activeFor(MENU, '/ateh1/orders'), ['orders']);
});
check('action label-orders не зажигает orders', () => {
    assert.deepStrictEqual(activeFor(MENU, '/ateh1/label-orders', '', 'label-orders'), ['label-orders']);
});
check('пункт с запросом: forms?EDIT не горит на xforms?EDIT', () => {
    assert.deepStrictEqual(activeFor(['forms?EDIT', 'xforms?EDIT'], '/ateh1/xforms', '?EDIT'), ['xforms?EDIT']);
});
check('многосегментный адрес table/123 горит на /ateh1/table/123', () => {
    assert.deepStrictEqual(activeFor(['table/123', 'table/1234'], '/ateh1/table/123'), ['table/123']);
});
check('адрес со слешем в начале и в конце совпадает', () => {
    assert.deepStrictEqual(activeFor(['/orders/'], '/ateh1/orders'), ['/orders/']);
});
check('пустой адрес не горит', () => {
    assert.deepStrictEqual(activeFor(['', 'orders'], '/ateh1/orders'), ['orders']);
});

let failed = 0;
for (const [s, n] of results) { console.log((s === 'ok' ? '✓ ' : '✗ ') + n); if (s !== 'ok') failed++; }
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
