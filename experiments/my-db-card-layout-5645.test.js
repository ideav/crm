// Issue #5645: карточка базы в ЛК (ideav.ru/my#databases) разложена по блокам, а не «всё в кучу»:
// шапка → показатели → «Настройки» (все редактируемые поля) → низ карточки (сохранение и действия).
// Проверяется отрисованная разметка populateDatabases(): какие элементы в каком блоке и в каком порядке.
// rules: none (defect #5645)
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
    scrollIntoView() {}
    focus() {}
    closest() { return null; }
}

function render(dbs) {
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
    c.aiIncluded = null;
    c.populateDatabases();
    return byId('databases-list').children.map(card => card.innerHTML);
}

// Блок <div class="… cls …">…</div> целиком (с вложенными div) и его начало в html; нет блока — null.
function block(html, cls) {
    const open = new RegExp('<div class="(?:[^"]*\\s)?' + cls + '(?:\\s[^"]*)?"[^>]*>');
    const m = open.exec(html);
    if (!m) return null;
    const tag = /<div\b|<\/div>/g;
    tag.lastIndex = m.index + m[0].length;
    let depth = 1, t;
    while ((t = tag.exec(html))) {
        depth += t[0] === '</div>' ? -1 : 1;
        if (depth === 0) return { start: m.index, html: html.slice(m.index, t.index + 6) };
    }
    return null;
}

const DB = { DB: 'solutions', DBID: '239536', Template: 'ru', Count: '0', AIUnits: '0', AgentRuns: '0',
    'Plan date': '23.12.2026', Date: '23.11.2026', Description: '', PublicName: '', Register: '', TTL: '' };

test('#5645: блоки карточки идут по порядку: шапка, показатели, настройки, низ', () => {
    const [card] = render([DB]);
    const names = ['database-name-row', 'database-stats', 'database-settings', 'database-card-footer'];
    const starts = names.map(n => {
        const b = block(card, n);
        assert.ok(b, 'нет блока ' + n);
        return b.start;
    });
    for (let i = 1; i < starts.length; i++) {
        assert.ok(starts[i - 1] < starts[i], names[i - 1] + ' должен идти раньше ' + names[i]);
    }
    const settings = block(card, 'database-settings').html;
    assert.ok(/class="database-section-title"[^>]*>Настройки</.test(settings), 'у блока настроек есть заголовок');
});

test('#5645: все редактируемые поля — в настройках, все кнопки — внизу карточки', () => {
    const [card] = render([DB]);
    const settings = block(card, 'database-settings').html;
    const footer = block(card, 'database-card-footer').html;
    for (const f of ['t276', 't305', 't367', 't369']) {
        assert.ok(settings.includes('data-field="' + f + '"'), 'поле ' + f + ' в настройках');
        assert.ok(!footer.includes('data-field="' + f + '"'), 'поле ' + f + ' не внизу');
    }
    assert.ok(!/<button\b/.test(settings), 'в настройках нет кнопок');
    for (const b of ['database-save-btn', 'database-restore-admin-btn', 'database-domain-toggle']) {
        assert.ok(footer.includes(b), b + ' внизу карточки');
    }
    // Действия с базой — отдельной группой справа от сохранения, обе кнопки рядом.
    const actions = block(footer, 'database-card-actions');
    assert.ok(actions, 'группа действий внизу');
    assert.ok(actions.html.includes('database-restore-admin-btn') && actions.html.includes('database-domain-toggle'));
    assert.ok(!actions.html.includes('database-save-btn'), 'сохранение не смешано с действиями');
});

test('#5645: подпись каждого поля настроек стоит над полем в своей группе', () => {
    const [card] = render([DB]);
    const settings = block(card, 'database-settings').html;
    const field = (label, f) => {
        const i = settings.indexOf(label);
        const j = settings.indexOf('data-field="' + f + '"');
        assert.ok(i >= 0 && j > i, label + ' — подпись перед полем ' + f);
    };
    field('Описание', 't276');
    field('Публичное имя', 't305');
    field('Время жизни токена, минут', 't369');
    // Короткие поля — в одном ряду, а не прижаты к разным краям карточки.
    const row = block(settings, 'database-settings-row');
    assert.ok(row, 'ряд коротких полей');
    assert.ok(row.html.includes('data-field="t367"') && row.html.includes('data-field="t369"'));
});

test('#5645: показатели — плитками, подпись и значение каждой в своей плитке', () => {
    const [card] = render([DB]);
    const stats = block(card, 'database-stats').html;
    const tiles = stats.match(/<div class="database-stat[ "]/g) || [];
    assert.strictEqual(tiles.length, 6, 'шесть плиток');
    assert.ok(/Оплачено до:<\/span>\s*<strong[^>]*>23 декабря 2026</.test(stats));
});
