// Issue #691: при сбросе пароля базу можно не указывать или ввести любую. Если такой
// базы у пользователя нет, пароль уходит от ЛК (my), а имя базы запоминается в
// localStorage; ЛК при входе проверяет, свободно ли имя, и спрашивает, создать ли её.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class FakeElement {
    constructor(id) {
        this.id = id;
        this.value = '';
        this.style = {};
        this.dataset = {};
        this.disabled = false;
        this.textContent = '';
        this.className = '';
        this.listeners = {};
        this.classList = { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false };
        this.options = [{ value: 'my' }];
    }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    dispatchEvent(ev) { if (this.listeners[ev.type]) this.listeners[ev.type](ev); }
    removeAttribute(name) { this[name] = false; }
    setAttribute(name, value) { this[name] = value === '' ? true : value; }
    focus() { this.focused = true; }
    matches() { return false; }
    closest() { return null; }
    querySelectorAll() { return []; }
}

function makeStorage(initial) {
    const map = new Map(Object.entries(initial || {}));
    return {
        map,
        getItem: k => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: k => map.delete(k)
    };
}

function makeContext(ids, storage, fetchImpl) {
    const elements = {};
    ids.forEach(id => { elements[id] = new FakeElement(id); });
    const documentStub = {
        documentElement: { setAttribute: () => {} },
        getElementById: id => elements[id] || null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        createElement: tag => new FakeElement(tag),
        body: new FakeElement('body'),
        cookie: ''
    };
    const fetchCalls = [];
    const context = {
        console,
        document: documentStub,
        window: { location: { hostname: 'app.test', origin: 'https://app.test', href: '', hash: '' }, addEventListener: () => {} },
        localStorage: storage,
        URLSearchParams,
        FormData,
        Event: class { constructor(type) { this.type = type; } },
        setTimeout: () => {},
        xsrf: 'xsrf1',
        fetch: async (url, options) => {
            fetchCalls.push(url);
            const r = fetchImpl(url, options);
            return { ok: r.status === undefined || r.status < 400, status: r.status || 200,
                async text() { return r.body; }, async json() { return JSON.parse(r.body); } };
        }
    };
    context.window.document = documentStub;
    context.window.localStorage = storage;
    vm.createContext(context);
    vm.runInContext(`${fs.readFileSync('js/app.js', 'utf8')}; this.App = App;`, context);
    return { context, elements, fetchCalls };
}

// ---------- start.html: сброс пароля ----------

const RESET_IDS = ['auth-db-select', 'auth-db-custom', 'auth-db-custom-group', 'login-email', 'login-password',
    'login-password-group', 'login-submit-btn', 'reset-link', 'back-to-login-link', 'reset-submit-btn',
    'reset-hint', 'login-email-label', 'reset-message'];

const MAIL_OK = JSON.stringify({ message: 'MAIL', db: 'my', login: 'apit', details: 'Пароль отправлен по почте' });
const NOT_FOUND = JSON.stringify([{ error: 'База «fn» не найдена' }]);

async function runReset(typedDb, routes) {
    const storage = makeStorage();
    const { context, elements, fetchCalls } = makeContext(RESET_IDS, storage, url => {
        const db = decodeURIComponent(url.split('/')[0]);
        return routes[db] || { status: 404, body: NOT_FOUND };
    });
    const app = new context.App();
    await app.init();
    elements['login-email'].value = 'apit@apit.ru';
    elements['auth-db-select'].value = '__other__';
    elements['auth-db-custom'].value = typedDb;
    await elements['reset-submit-btn'].listeners.click();
    return { storage, elements, dbs: fetchCalls.map(u => decodeURIComponent(u.split('/')[0])) };
}

test('#691 start: базы нет — пароль от ЛК, имя базы запомнено', async () => {
    const r = await runReset('fn', { my: { body: MAIL_OK } });
    assert.deepStrictEqual(r.dbs, ['fn', 'my']);
    assert.strictEqual(r.storage.getItem('integram_wanted_db'), 'fn');
    assert.match(r.elements['reset-message'].textContent, /Базы «fn» у вас нет/);
    assert.strictEqual(r.elements['reset-message'].className, 'success-message');
    assert.strictEqual(r.elements['auth-db-select'].value, 'my');
});

test('#691 start: пользователя нет в чужой базе (WRONG_CONT) — тоже в ЛК', async () => {
    const r = await runReset('other', {
        other: { body: JSON.stringify({ message: 'WRONG_CONT', details: 'нет' }) },
        my: { body: MAIL_OK }
    });
    assert.deepStrictEqual(r.dbs, ['other', 'my']);
    assert.strictEqual(r.storage.getItem('integram_wanted_db'), 'other');
});

test('#691 start: пустое поле базы — сброс пароля ЛК без запоминания', async () => {
    const r = await runReset('', { my: { body: MAIL_OK } });
    assert.deepStrictEqual(r.dbs, ['my']);
    assert.strictEqual(r.storage.getItem('integram_wanted_db'), null);
    assert.strictEqual(r.elements['reset-message'].textContent, 'Пароль отправлен по почте');
});

test('#691 start: своя база — обычный сброс, без отката в ЛК', async () => {
    const r = await runReset('mine', { mine: { body: JSON.stringify({ message: 'NEW_PWD', details: 'Пароль отправлен' }) } });
    assert.deepStrictEqual(r.dbs, ['mine']);
    assert.strictEqual(r.storage.getItem('integram_wanted_db'), null);
});

test('#691 start: нет ни базы, ни учётки в ЛК — ошибка, имя не запоминается', async () => {
    const r = await runReset('fn', { my: { body: JSON.stringify({ message: 'WRONG_CONT', details: 'Неверное имя' }) } });
    assert.deepStrictEqual(r.dbs, ['fn', 'my']);
    assert.strictEqual(r.storage.getItem('integram_wanted_db'), null);
    assert.strictEqual(r.elements['reset-message'].textContent, 'База «fn» не найдена');
    assert.notStrictEqual(r.elements['reset-message'].className, 'success-message');
});

// ---------- ЛК: предложение создать базу ----------

const CABINET_IDS = ['wanted-db-offer', 'wanted-db-name', 'wanted-db-yes', 'wanted-db-no', 'create-db-form', 'new-db-name'];

function loadCabinet(wanted, { taken = false, databases = [], planId = '1146' } = {}) {
    const storage = makeStorage(wanted === undefined ? {} : { integram_wanted_db: wanted });
    const env = makeContext(CABINET_IDS, storage, () => ({ body: JSON.stringify({ columns: [{ name: 'DB' }], data: [[taken ? '1' : '0']] }) }));
    env.context.ApiConfig = class { constructor() { this.host = 'app.test'; } };
    vm.runInContext(`${fs.readFileSync('js/cabinet.js', 'utf8')}; this.CabinetController = CabinetController;`, env.context);
    const cab = new env.context.CabinetController();
    cab.databases = databases;
    cab.userData = { PlanID: planId };
    cab.showSection = () => {};
    env.elements['wanted-db-offer'].style.display = 'none';
    env.elements['create-db-form'].style.display = 'none';
    return { cab, storage, ...env };
}

test('#691 ЛК: свободное имя — спрашиваем, «Да» открывает форму с именем', async () => {
    const t = loadCabinet('newdb');
    await t.cab.offerWantedDb();
    assert.ok(t.fetchCalls.some(u => u.includes('report/292') && u.includes('FR_DB=newdb')));
    assert.strictEqual(t.elements['wanted-db-offer'].style.display, '');
    assert.strictEqual(t.elements['wanted-db-name'].textContent, 'newdb');
    t.elements['wanted-db-yes'].onclick();
    assert.strictEqual(t.elements['create-db-form'].style.display, '');
    assert.strictEqual(t.elements['new-db-name'].value, 'newdb');
    assert.strictEqual(t.storage.getItem('integram_wanted_db'), null);
});

test('#691 ЛК: «Нет» — имя забыто, формы нет', async () => {
    const t = loadCabinet('newdb');
    await t.cab.offerWantedDb();
    t.elements['wanted-db-no'].onclick();
    assert.strictEqual(t.elements['wanted-db-offer'].style.display, 'none');
    assert.strictEqual(t.elements['create-db-form'].style.display, 'none');
    assert.strictEqual(t.storage.getItem('integram_wanted_db'), null);
});

test('#691 ЛК: имя занято, своя база или лимит — не спрашиваем и забываем', async () => {
    for (const opts of [{ taken: true }, { databases: [{ DB: 'NewDb' }] },
        { databases: [{ DB: 'a1a' }, { DB: 'b1b' }, { DB: 'c1c' }] }]) {
        const t = loadCabinet('newdb', opts);
        await t.cab.offerWantedDb();
        assert.strictEqual(t.elements['wanted-db-offer'].style.display, 'none', JSON.stringify(opts));
        assert.strictEqual(t.storage.getItem('integram_wanted_db'), null, JSON.stringify(opts));
    }
});

test('#691 ЛК: без запомненного имени ничего не происходит', async () => {
    const t = loadCabinet(undefined);
    await t.cab.offerWantedDb();
    assert.strictEqual(t.fetchCalls.length, 0);
    assert.strictEqual(t.elements['wanted-db-offer'].style.display, 'none');
});
