// Issue #5206: карточка базы в ЛК (ideav.ru/my#databases) показывает счётчики биллинга —
// ИИ-токены (единицы) и запуски агента. Источник — колонки AIUnits / AgentRuns отчёта my/report/313
// (ord строк-реквизитов 239405 / 239407 записи базы). Нет счётчика — 0.
// rules: none (defect #5206)
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
    set className(v) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
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

function render(dbs, included) {
    const els = {};
    const byId = id => (els[id] || (els[id] = new El('div', id)));
    const doc = {
        documentElement: { setAttribute: () => {} }, getElementById: byId,
        querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {},
        createElement: tag => new El(tag), body: new El('body'), cookie: ''
    };
    const ctx = {
        console: { log() {}, warn() {}, error() {} }, document: doc,
        window: { location: { hostname: 'app.test', origin: 'https://app.test', href: '', hash: '' }, addEventListener: () => {} },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        URLSearchParams, FormData, setTimeout: () => 0, clearTimeout: () => {},
        fetch: async () => ({ ok: true, status: 200, json: async () => [], text: async () => '[]' })
    };
    ctx.window.document = doc;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync('js/app.js', 'utf8') + '\n' + fs.readFileSync('js/cabinet.js', 'utf8')
        + '\nthis.CabinetController = CabinetController;', ctx);
    const c = new ctx.CabinetController();
    c.apiConfig = { host: 'app.test' };
    c.databases = dbs;
    c.aiIncluded = included || null;
    c.populateDatabases();
    return byId('databases-list').children.map(card => card.innerHTML);
}

// Текст статы по подписи: «<span>Подпись:</span> <strong>значение</strong>».
const stat = (html, label) => {
    const m = html.match(new RegExp('<span>' + label + ':</span>\\s*<strong[^>]*>([^<]*)</strong>'));
    return m ? m[1] : null;
};

test('#5206: счётчики ИИ-токенов и запусков агента в карточке базы', () => {
    const [withCounters, without] = render([
        { DB: 'alpha', DBID: '101', Count: '9', AIUnits: '1234', AgentRuns: '17' },
        { DB: 'beta', DBID: '102', Count: '0', AIUnits: '', AgentRuns: '' }
    ]);
    assert.strictEqual(stat(withCounters, 'ИИ-токены'), '1234');
    assert.strictEqual(stat(withCounters, 'Запуски агента'), '17');
    assert.strictEqual(stat(without, 'ИИ-токены'), '0', 'нет счётчика — 0');
    assert.strictEqual(stat(without, 'Запуски агента'), '0');
    assert.strictEqual(stat(withCounters, 'Расход'), '9', 'прежняя стата на месте');
});

test('#5206: значение счётчика экранируется', () => {
    const [card] = render([{ DB: 'alpha', DBID: '101', AIUnits: '<b>x</b>', AgentRuns: '1' }]);
    assert.ok(!card.includes('<b>x</b>'));
});

// #5637: вместо рублей — «использовано N из M ед.»; M — включённый объём базы с сервера (loadAiIncluded).
// Нет включённого объёма (M = 0) — «N ед.» и подсказка про лимит 3 вопроса в час.
test('#5637: ИИ — использовано N из M ед., M = 0 — подсказка про лимит', () => {
    const dbs = [
        { DB: 'alpha', DBID: '101', AIUnits: '1234', AgentRuns: '17' },
        { DB: 'beta', DBID: '102', AIUnits: '', AgentRuns: '' },
        { DB: 'gamma', DBID: '103', AIUnits: '<b>x</b>', AgentRuns: '' },
        { DB: 'delta', DBID: '104', AIUnits: '5', AgentRuns: '' }
    ];
    const [a, b, g, d] = render(dbs, { alpha: 1652, beta: 0, gamma: 3472 });
    assert.strictEqual(stat(a, 'ИИ'), 'использовано 1234 из 1652 ед.');
    assert.strictEqual(stat(b, 'ИИ'), '0 ед.');
    assert.ok(b.includes('title="Включённого объёма нет — действует лимит 3 вопроса в час"'));
    assert.strictEqual(stat(g, 'ИИ'), 'использовано 0 из 3472 ед.', 'не число — 0');
    assert.ok(!g.includes('<b>x</b>'));
    assert.strictEqual(stat(d, 'ИИ'), '5 ед.', 'нет данных сервера по базе — только расход');
    assert.ok(!d.includes('Включённого объёма нет'), 'без данных подсказка про лимит не показывается');
    assert.strictEqual(stat(a, 'Стоимость ИИ'), null, 'рублей в карточке больше нет');
});

// #5633: цена единицы — одна на систему; серверное значение (window.AI_UNIT_PRICE_RUB из
// {_global_.ai_unit_price} в шаблоне) важнее запасной константы в cabinet.js.
test('#5633: цена ИИ берётся из серверного значения, мусор — запасная 0,36', () => {
    const run = price => {
        const src = fs.readFileSync('js/cabinet.js', 'utf8');
        const ctx = { window: { AI_UNIT_PRICE_RUB: price }, document: { addEventListener() {} }, console };
        vm.createContext(ctx);
        vm.runInContext(src.split('\n// Имя базы')[0] + '\nthis.cost = cabinetAiCost;', ctx);
        return ctx.cost('1000');
    };
    assert.strictEqual(run('0.5'), '500,00 ₽');
    assert.strictEqual(run('{_global_.ai_unit_price}'), '360,00 ₽', 'шаблон не подставлен — запасная');
    assert.strictEqual(run(undefined), '360,00 ₽');
});
