// Issue #5654: страж данных ИИ-чата в ЛК (ideav.ru/my#databases) — кнопка «Страж данных» в карточке
// базы, панель с тарифами, оплатой с баланса, тематиками, режимом и переключателем в чате.
// Проверяется отрисованная разметка renderGuard() по ответу /my/_guard_status, сбор выбора из панели
// и запрос guardCall() к /my/_guard_* (POST, _xsrf).
// rules: none (defect #5654)
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class El {
    constructor(tag, id) {
        this.tagName = tag; this.id = id || '';
        this.value = ''; this.style = {}; this.dataset = {}; this.disabled = false; this.checked = false;
        this.textContent = ''; this.innerHTML = ''; this.children = []; this.listeners = {};
        this.cls = new Set();
        this.classList = {
            add: (...a) => a.forEach(x => this.cls.add(x)),
            remove: (...a) => a.forEach(x => this.cls.delete(x)),
            toggle: (x, on) => ((on === undefined ? !this.cls.has(x) : on) ? this.cls.add(x) : this.cls.delete(x)),
            contains: x => this.cls.has(x)
        };
        this.sel = {};
        this.options = [];
    }
    get className() { return [...this.cls].join(' '); }
    set className(v) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    addEventListener(t, h) { this.listeners[t] = h; }
    appendChild(c) { this.children.push(c); return c; }
    querySelector(s) { const v = this.sel[s]; return Array.isArray(v) ? (v[0] || null) : (v || null); }
    querySelectorAll(s) { const v = this.sel[s]; return Array.isArray(v) ? v : (v ? [v] : []); }
    setAttribute(n, v) { this[n] = v; }
    removeAttribute(n) { delete this[n]; }
    scrollIntoView() {}
    focus() {}
    closest() { return null; }
}

function controller(fetchImpl) {
    const els = {};
    const byId = id => (els[id] || (els[id] = new El('div', id)));
    const doc = {
        documentElement: { setAttribute: () => {} }, getElementById: byId,
        querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {},
        createElement: tag => new El(tag), body: new El('body'), cookie: ''
    };
    const toasts = [];
    const ctx = {
        console: { log() {}, warn() {}, error() {} }, document: doc,
        window: { location: { hostname: 'app.test', origin: 'https://app.test', href: '', hash: '' }, addEventListener: () => {} },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        URLSearchParams, FormData, setTimeout: () => 0, clearTimeout: () => {},
        fetch: fetchImpl || (async () => ({ ok: true, status: 200, json: async () => [], text: async () => '[]' }))
    };
    ctx.window.document = doc;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync('js/app.js', 'utf8') + '\n' + fs.readFileSync('js/cabinet.js', 'utf8')
        + '\nthis.CabinetController = CabinetController; showToast = (m, t) => this.__toasts.push([m, t]); xsrf = "X1";', Object.assign(ctx, { __toasts: toasts }));
    const c = new ctx.CabinetController();
    c.apiConfig = { host: 'app.test' };
    c.aiIncluded = null;
    return { c, byId, toasts };
}

const PRICES = { start: { month: 1490, year: 15190 }, pro: { month: 2990, year: 30490 } };
const LIMITS = { start: 5000, pro: 20000 };
const PLANS = { start: { actions: ['mask', 'audit'], topics: false }, pro: { actions: ['mask', 'block', 'audit'], topics: true } };
const st = over => Object.assign({ db: 'acme', state: 'none', plan: '', until: 0, agent: true, available: true,
    settings: null, prices: PRICES, limits: LIMITS, plans: PLANS, over_price: 150, over_unit: 1000,
    topics: ['bank', 'finance', 'realtor', 'hr', 'medical'], used: null }, over);
const render = (s, db) => { const { c } = controller(); const body = new El('div'); c.renderGuard('acme', body, s, db || {}); return body.innerHTML; };
const plain = h => h.replace(/ /g, ' ');

test('#5654: в карточке базы — кнопка «Страж данных» среди действий и скрытая панель', () => {
    const { c, byId } = controller();
    c.databases = [{ DB: 'acme', DBID: '501', Template: 'ru', Count: '0', AIUnits: '0', AgentRuns: '0', 'Plan date': '', Date: '' }];
    c.populateDatabases();
    const card = byId('databases-list').children[0].innerHTML;
    const actions = card.slice(card.indexOf('database-card-actions'));
    assert.ok(/database-guard-toggle[^>]*>Страж данных</.test(actions), 'кнопка в группе действий');
    assert.ok(/class="database-guard-body" hidden/.test(card), 'панель скрыта до нажатия');
});

test('#5654: нет оплаты — кнопки обоих тарифов на месяц и год с ценами, текст про баланс, ссылка на статью', () => {
    const h = plain(render(st({})));
    for (const [plan, period] of [['start', 'month'], ['start', 'year'], ['pro', 'month'], ['pro', 'year']]) {
        assert.ok(new RegExp('data-act="pay" data-plan="' + plan + '" data-period="' + period + '"').test(h), 'кнопка ' + plan + ' ' + period);
    }
    assert.ok(h.includes('1 490 ₽') && h.includes('15 190 ₽') && h.includes('2 990 ₽') && h.includes('30 490 ₽'), 'цены');
    assert.ok(h.includes('Оплата списывается с баланса личного кабинета'));
    assert.ok(h.includes('https://ideav.ru/help.html#api-ai-data-guard'));
    assert.ok(h.includes('150 ₽'), 'сверх лимита — 150 ₽ за 1000 вопросов');
});

test('#5654: сервис агента не настроен — оплаты нет', () => {
    const h = render(st({ agent: false }));
    assert.ok(!h.includes('data-act="pay"'), 'без кнопок оплаты');
});

test('#5654: Старт — запрет и тематики недоступны с подсказкой, mask и audit доступны', () => {
    const h = render(st({ state: 'active', plan: 'start', until: 1900000000,
        settings: { enabled: true, topics: [], action: 'mask', user_toggle: true, until: 1900000000 } }));
    const opt = v => (h.match(new RegExp('<option value="' + v + '"[^>]*>')) || [''])[0];
    assert.ok(/disabled/.test(opt('block')), 'block disabled');
    assert.ok(!/disabled/.test(opt('mask')) && !/disabled/.test(opt('audit')), 'mask и audit доступны');
    const topics = h.match(/<input type="checkbox" class="database-guard-topic"[^>]*>/g) || [];
    assert.strictEqual(topics.length, 5, 'пять тематик');
    assert.ok(topics.every(t => /disabled/.test(t)), 'на Старте тематики disabled');
    for (const ru of ['Банк', 'Финансы', 'Риелтор', 'HR', 'Медицина']) assert.ok(h.includes(ru), ru);
    assert.ok(/title="[^"]*Профи/.test(h), 'подсказка про Профи');
    assert.ok(h.includes('data-act="set"'), 'кнопка сохранения');
});

test('#5654: Профи — всё доступно, выбор из настроек отмечен', () => {
    const h = render(st({ state: 'active', plan: 'pro', until: 1900000000,
        settings: { enabled: true, topics: ['bank', 'hr'], action: 'block', user_toggle: false, until: 1900000000 } }));
    const topics = h.match(/<input type="checkbox" class="database-guard-topic"[^>]*>/g) || [];
    assert.ok(topics.every(t => !/disabled/.test(t)), 'тематики доступны');
    assert.deepStrictEqual(topics.filter(t => /checked/.test(t)).map(t => t.match(/value="(\w+)"/)[1]), ['bank', 'hr']);
    assert.ok(/<option value="block" selected/.test(h), 'режим block выбран');
    assert.ok(!/class="database-guard-usertoggle"[^>]*checked/.test(h), 'переключатель в чате выключен');
    assert.ok(h.includes('Выключить'), 'страж включён — есть «Выключить»');
});

test('#5654: сервис не ответил — настройки не показываются, включить вслепую нельзя', () => {
    const h = render(st({ state: 'active', plan: 'pro', until: 1900000000, settings: null, service_ok: false }));
    assert.ok(!h.includes('data-act="set"') && !h.includes('data-act="power"'), 'нет кнопок сохранения');
    assert.ok(h.includes('не отвечает'));
});

test('#5654: «использовано N из лимита (+пакеты)» — из счётчика сервиса, не из GuardRuns', () => {
    const active = st({ state: 'active', plan: 'start', until: 1900000000, limit: 5000, used: 1234, packs: 0, pack_size: 1000 });
    const h = plain(render(active, {}));
    assert.ok(h.includes('1 234 из 5 000'), h);
    assert.ok(!h.includes('куплено пакетов'), 'пакетов нет — про купленные не пишем');
    const over = plain(render(st({ state: 'active', plan: 'start', until: 1900000000, limit: 5000, used: 5600, packs: 1, pack_size: 1000 }), {}));
    assert.ok(over.includes('5 600 из 5 000 + 1 000'), over);
    assert.ok(over.includes('куплено пакетов: 1'), over);
    assert.ok(!plain(render(st({ state: 'active', plan: 'start', until: 1900000000, limit: 5000 }), { GuardRuns: '1234' })).includes('из 5 000 вопросов'),
        'сервис не прислал счётчик — GuardRuns отчёта не подставляется');
});

test('#5654: сбор выбора из панели', () => {
    const { c } = controller();
    const body = new El('div');
    const cb = (v, on) => Object.assign(new El('input'), { value: v, checked: on });
    body.sel['input.database-guard-topic'] = [cb('bank', true), cb('finance', false), cb('hr', true)];
    body.sel['select.database-guard-action'] = Object.assign(new El('select'), { value: 'audit' });
    body.sel['input.database-guard-usertoggle'] = Object.assign(new El('input'), { checked: false });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(c.guardCollect(body, true))),
        { enabled: '1', topics: 'bank,hr', action: 'audit', user_toggle: '0' });
});

test('#5654: guardCall — POST /my/_guard_pay с тарифом, периодом и _xsrf', async () => {
    const calls = [];
    const { c, toasts } = controller(async (url, opt) => {
        calls.push({ url, opt });
        return { ok: true, status: 200, json: async () => st({ state: 'active', plan: 'pro', until: 1900000000, applied: true }) };
    });
    const body = new El('div');
    await c.guardCall('acme', '_guard_pay', body, { plan: 'pro', period: 'year' });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'https://app.test/my/_guard_pay?JSON&db=acme');
    assert.strictEqual(calls[0].opt.method, 'POST');
    const fd = calls[0].opt.body;
    assert.strictEqual(fd.get('plan'), 'pro');
    assert.strictEqual(fd.get('period'), 'year');
    assert.strictEqual(fd.get('_xsrf'), 'X1');
    assert.ok(toasts.some(t => t[1] === 'success'), 'тост об оплате');
    assert.ok(body.innerHTML.includes('Профи'), 'панель перерисована');
});

test('#5654: ответ без применения настройки — предупреждение', async () => {
    const { c, toasts } = controller(async () => ({ ok: true, status: 200,
        json: async () => st({ state: 'active', plan: 'start', until: 1900000000, applied: false, notice: 'Настройка не применилась' }) }));
    await c.guardCall('acme', '_guard_pay', new El('div'), { plan: 'start', period: 'month' });
    assert.ok(toasts.some(t => t[1] === 'error' && /не применилась/.test(t[0])), JSON.stringify(toasts));
});

test('#5654: ошибка сервера — тост с текстом ошибки', async () => {
    const { c, toasts } = controller(async () => ({ ok: true, status: 200, json: async () => [{ error: 'Недостаточно средств' }] }));
    await c.guardCall('acme', '_guard_pay', new El('div'), { plan: 'pro', period: 'month' });
    assert.ok(toasts.some(t => t[1] === 'error' && t[0].includes('Недостаточно средств')));
});
