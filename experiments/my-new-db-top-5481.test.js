// Issue #5481: база, созданная в ЛК (ideav.ru/my#databases), встаёт в начало списка
// и подсвечивается — при любой сортировке. Счётчик «Расход» (ord) — my-new-db-ord-5481.test.php.
// rules: none (defect #5481)
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class El {
    constructor(tag, id) {
        this.tagName = tag; this.id = id || '';
        this.value = ''; this.style = {}; this.dataset = {}; this.disabled = false;
        this.textContent = ''; this.innerHTML = ''; this.children = []; this.listeners = {};
        this.cls = new Set();
        this.classList = {
            add: (...a) => a.forEach(x => this.cls.add(x)),
            remove: (...a) => a.forEach(x => this.cls.delete(x)),
            toggle: (x, on) => ((on === undefined ? !this.cls.has(x) : on) ? this.cls.add(x) : this.cls.delete(x)),
            contains: x => this.cls.has(x)
        };
        this.options = [];
    }
    get className() { return [...this.cls].join(' '); }
    set className(v) { this.cls = new Set(String(v).split(/s+/).filter(Boolean)); }
    addEventListener(t, h) { this.listeners[t] = h; }
    appendChild(c) { this.children.push(c); return c; }
    querySelector() { return new El('div'); }
    querySelectorAll() { return []; }
    setAttribute(n, v) { this[n] = v; }
    removeAttribute(n) { delete this[n]; }
    scrollIntoView() { this.scrolled = true; }
    focus() {}
    closest() { return null; }
}

const DBS = [
    { DB: 'alpha', DBID: '101', Count: '900', Date: '01.01.2026', User: 'u1' },
    { DB: 'cources', DBID: '239153', Count: '0', Date: '11.11.2026', User: 'u1' },
    { DB: 'zeta', DBID: '103', Count: '50', Date: '05.05.2026', User: 'u1' }
];

function setup() {
    const els = {};
    const byId = id => (els[id] || (els[id] = new El('div', id)));
    const doc = {
        documentElement: { setAttribute: () => {} },
        getElementById: byId,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        createElement: tag => new El(tag),
        body: new El('body'),
        cookie: ''
    };
    const calls = [];
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        document: doc,
        window: { location: { hostname: 'app.test', origin: 'https://app.test', href: '', hash: '' }, addEventListener: () => {} },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        URLSearchParams, FormData,
        setTimeout: () => 0, clearTimeout: () => {},
        xsrf: 'x1', uid: 'u1',
        fetch: async (url) => {
            calls.push(url);
            let body;
            if (url.includes('/report/292')) body = { columns: [{ name: 'DB' }], data: [['0']] };
            else if (url.includes('/_new_db/')) body = { status: 'Ok', id: 239153 };
            else if (url.includes('/report/313')) body = DBS;
            else body = [];
            return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
        }
    };
    ctx.window.document = doc;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync('js/app.js', 'utf8') + '\n' + fs.readFileSync('js/cabinet.js', 'utf8')
        + '\nthis.CabinetController = CabinetController;', ctx);
    const c = new ctx.CabinetController();
    c.apiConfig = { host: 'app.test' };
    c.showSection = () => {};
    byId('new-db-name').value = 'Cources';
    byId('new-db-template').value = 'ru';
    return { c, list: byId('databases-list'), calls };
}

const names = list => list.children.map(card => (card.innerHTML.match(/database-id-inline">#(\d+)/) || [])[1]);

test('#5481: новая база — первая в списке и подсвечена', async () => {
    const { c, list, calls } = setup();
    await c.createDatabase();
    assert.ok(calls.some(u => u.includes('/_new_db/')), 'база создаётся');
    assert.deepStrictEqual(names(list), ['239153', '101', '103']);
    assert.ok(list.children[0].classList.contains('database-card-new'), 'карточка новой базы подсвечена');
    assert.ok(!list.children[1].classList.contains('database-card-new'), 'прочие не подсвечены');
});

test('#5481: новая база остаётся первой при выбранной сортировке', async () => {
    const { c, list } = setup();
    c.dbSortField = 'count'; c.dbSortDir = 'desc';
    await c.createDatabase();
    assert.deepStrictEqual(names(list), ['239153', '101', '103']);
});

