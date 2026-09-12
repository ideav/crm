// #4944 — планшет сам кладёт свой код в таблицу «Планшет-кандидат».
//
// Код устройства (32 hex-символа) показывался только на экране планшета, и
// оператор диктовал его администратору, чтобы тот вписал код в таблицу «Планшет».
// Теперь незарегистрированный планшет пишет свой код в «Планшет-кандидат» сам:
// в таблице одна запись — новый код ложится поверх старого, а если записи нет,
// она создаётся.
//
// Проверяем ПОВЕДЕНИЕ: какие запросы ушли на сервер после boot() сторожа
// (pad-guard) и экрана входа оператора (pad-home), и что осталось на экране.
//
// Run with: node experiments/atex-pad-4944-candidate.test.js

// ── стабы DOM (те же, что в atex-pad-guard-4868.test.js) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = [];
    this.attributes = {};
    this._className = '';
    this._text = '';
    this.src = '';
    this.parentNode = null;
    var self = this;
    this.classList = {
        add: function(c) { if (self._cls().indexOf(c) === -1) self._className += ' ' + c; },
        remove: function(c) { self._className = self._cls().filter(function(x) { return x !== c; }).join(' '); },
        contains: function(c) { return self._cls().indexOf(c) !== -1; }
    };
}
StubNode.prototype._cls = function() { return this._className.split(/\s+/).filter(Boolean); };
Object.defineProperty(StubNode.prototype, 'className', {
    get: function() { return this._className; }, set: function(v) { this._className = String(v || ''); } });
Object.defineProperty(StubNode.prototype, 'textContent', {
    get: function() { return this.childNodes.length
        ? this.childNodes.map(function(c) { return c.textContent; }).join(' ') : this._text; },
    set: function(v) { this._text = String(v == null ? '' : v); this.childNodes = []; } });
Object.defineProperty(StubNode.prototype, 'innerHTML', {
    get: function() { return ''; },
    set: function() { this.childNodes = []; this._text = ''; } });
StubNode.prototype.appendChild = function(n) { n.parentNode = this; this.childNodes.push(n); return n; };
StubNode.prototype.removeChild = function(n) {
    this.childNodes = this.childNodes.filter(function(c) { return c !== n; });
    n.parentNode = null;
    return n;
};
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function() {};

var PAD_TABLE = {
    id: '673803', up: '0', type: '3', val: 'Планшет', unique: '1',
    granted: 'READ', export: '1', delete: '1',
    reqs: [
        { num: 1, id: '673807', val: 'Наименование', orig: '673806', type: '3' },
        { num: 2, id: '690313', val: 'Слиттер', type: '3' },
        { num: 3, id: '690314', val: 'Втулкорез', type: '3' },
        { num: 4, id: '690315', val: 'Упаковочное место', type: '3' },
        { num: 5, id: '690317', val: 'Рабочее место', type: '3' }
    ]
};
// Метаданные «Планшет-кандидата» — как их отдаёт база ateh (issue #4944).
var CAND_TABLE = {
    id: '804338', up: '0', type: '3', val: 'Планшет-кандидат', unique: '0',
    granted: 'WRITE', export: '1', delete: '1', reqs: []
};
var METADATA = [PAD_TABLE, CAND_TABLE];
var TOKEN = 'aaaa0000bbbb1111cccc2222dddd3333';
var OLD_TOKEN = '99998888777766665555444433332222';
var APP_SRC = '/download/ateh/js/slitter.js?x';

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name
        + (ok ? '' : ' (ожидалось ' + JSON.stringify(expected) + ', получено ' + JSON.stringify(actual) + ')'));
    if (ok) passed++; else process.exitCode = 1;
}
function assertTrue(cond, name) { assertEqual(!!cond, true, name); }
function assertFalse(cond, name) { assertEqual(!!cond, false, name); }

var guard = require('../download/atex/js/pad-guard.js');

function flush() { return new Promise(function(r) { setTimeout(r, 10); }); }

// Сервер: метаданные, строки «Планшета» по токену, строки «Планшет-кандидата»
// и журнал POST-запросов (путь + тело).
function makeServer(opts) {
    var srv = { posts: [], gets: [] };
    srv.candidateRows = opts.candidateRows === undefined ? [] : opts.candidateRows;
    global.fetch = function(url, init) {
        var path = String(url);
        srv.gets.push(path);
        if (init && init.method === 'POST') {
            srv.posts.push({ path: path, body: String(init.body || '') });
            if (opts.postFails) return Promise.resolve({ ok: false, status: 403,
                text: function() { return Promise.resolve(JSON.stringify([{ error: 'нет доступа' }])); } });
            return Promise.resolve({ ok: true,
                text: function() { return Promise.resolve(JSON.stringify({ id: '900001', obj: '900001' })); } });
        }
        var payload;
        if (path.indexOf('metadata') !== -1) payload = opts.metadata || METADATA;
        else if (path.indexOf('object/' + CAND_TABLE.id) !== -1) payload = srv.candidateRows;
        else payload = opts.padRows === undefined ? [] : opts.padRows;
        return Promise.resolve({ ok: true, text: function() { return Promise.resolve(JSON.stringify(payload)); } });
    };
    srv.postsTo = function(prefix) {
        return srv.posts.filter(function(p) { return p.path.indexOf(prefix) !== -1; });
    };
    return srv;
}

function makeStorage(token) {
    global.localStorage = {
        _data: {},
        getItem: function(k) { return this._data[k] == null ? null : this._data[k]; },
        setItem: function(k, v) { this._data[k] = String(v); }
    };
    if (token) global.localStorage.setItem('atehPad', token);
}

// Окружение boot() сторожа: контейнер пульта + глобали страницы.
function makeGuardEnv(opts) {
    var env = { created: [] };
    var container = new StubNode('div');
    container.setAttribute('id', 'pult');
    container.setAttribute('data-db', 'ateh');
    container.setAttribute('data-xsrf', 'xsrf-token');
    container.setAttribute('data-user', opts.user || 'operator');
    var body = new StubNode('body');
    global.document = {
        createElement: function(tag) { var n = new StubNode(tag); env.created.push(n); return n; },
        createTextNode: function(text) { var n = new StubNode('#text'); n._text = String(text == null ? '' : text); return n; },
        getElementById: function(id) { return id === 'pult' ? container : null; },
        querySelector: function() { return null; },
        head: new StubNode('head'),
        body: body
    };
    makeStorage(opts.token === undefined ? TOKEN : opts.token);
    global.crypto = { getRandomValues: function(a) { for (var i = 0; i < a.length; i++) a[i] = (i * 7 + 3) % 256; return a; } };
    global.role = opts.role == null ? 'Оператор' : opts.role;
    global.roleId = opts.roleId == null ? '1621' : opts.roleId;
    env.server = makeServer(opts);
    var attrs = { 'data-pad-root': 'pult', 'data-pad-app': APP_SRC };
    if (opts.roles !== undefined) attrs['data-pad-roles'] = opts.roles;
    if (opts.kind !== undefined) attrs['data-pad-kind'] = opts.kind;
    env.container = container;
    env.boot = function() {
        guard.boot({ getAttribute: function(k) { return attrs[k] == null ? null : attrs[k]; } });
        return flush().then(flush).then(flush);
    };
    return env;
}

// Окружение boot() экрана входа оператора (pad-home).
function makeHomeEnv(opts) {
    var env = { created: [] };
    var body = new StubNode('body');
    var head = new StubNode('head');
    global.document = {
        createElement: function(tag) { var n = new StubNode(tag); env.created.push(n); return n; },
        createTextNode: function(text) { var n = new StubNode('#text'); n._text = String(text == null ? '' : text); return n; },
        getElementById: function(id) {
            var found = null;
            body.childNodes.forEach(function(n) { if (n.getAttribute('id') === id) found = n; });
            return found;
        },
        querySelector: function() { return null; },
        head: head,
        body: body
    };
    makeStorage(opts.token === undefined ? TOKEN : opts.token);
    global.crypto = { getRandomValues: function(a) { for (var i = 0; i < a.length; i++) a[i] = (i * 7 + 3) % 256; return a; } };
    global.xsrf = 'xsrf-token';
    env.server = makeServer(opts);
    var attrs = {
        'data-pad-roles': '1621', 'data-pad-db': 'ateh',
        'data-pad-action': '', 'data-pad-role-id': '1621'
    };
    env.screen = body;
    env.boot = function() {
        home.boot({ getAttribute: function(k) { return attrs[k] == null ? null : attrs[k]; } });
        return flush().then(flush).then(flush);
    };
    return env;
}

// pad-home грузится после сторожа и пользуется его разбором (как в main.html).
global.window = undefined;
var home = require('../download/atex/js/pad-home.js');
global.AtexPadGuard = guard;

// Тело POST → { ключ: значение }.
function bodyParams(body) {
    var out = {};
    String(body || '').split('&').forEach(function(pair) {
        if (!pair) return;
        var i = pair.indexOf('=');
        var k = decodeURIComponent((i === -1 ? pair : pair.slice(0, i)).replace(/\+/g, ' '));
        var v = i === -1 ? '' : decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' '));
        out[k] = v;
    });
    return out;
}

var scenario = Promise.resolve();

// ── 1. незарегистрированный планшет: кода в «Планшет-кандидате» нет — запись создаётся ──
scenario = scenario.then(function() {
    var env = makeGuardEnv({ roles: '1621', kind: 'slitter', padRows: [], candidateRows: [] });
    return env.boot().then(function() {
        var posts = env.server.postsTo('_m_new/' + CAND_TABLE.id);
        assertEqual(posts.length, 1, '#4944 планшета нет в «Планшете» — код уходит в «Планшет-кандидат» новой записью');
        var params = posts.length ? bodyParams(posts[0].body) : {};
        assertEqual(params['t' + CAND_TABLE.id], TOKEN, '#4944 код пишется в первую колонку (t{id таблицы})');
        assertEqual(params._xsrf, 'xsrf-token', '#4944 запись идёт с токеном XSRF');
        assertTrue(env.container.textContent.indexOf('Планшет-кандидат') !== -1,
            '#4944 экран сообщает, что код передан администратору');
    });
});

// ── 2. в таблице уже лежит ЧУЖОЙ код — он переписывается поверх (одна запись) ──
scenario = scenario.then(function() {
    var env = makeGuardEnv({ roles: '1621', kind: 'slitter', padRows: [],
        candidateRows: [{ i: '804400', r: [OLD_TOKEN] }] });
    return env.boot().then(function() {
        assertEqual(env.server.postsTo('_m_new/' + CAND_TABLE.id).length, 0,
            '#4944 запись есть — вторая не создаётся');
        // Первая колонка правится только _m_save: _m_set её молча не меняет (#4906).
        var saves = env.server.postsTo('_m_save/804400');
        assertEqual(saves.length, 1, '#4944 старый код переписывается поверх через _m_save');
        assertEqual(env.server.postsTo('_m_set/804400').length, 0,
            '#4944 первая колонка не пишется через _m_set (#4906)');
        var params = saves.length ? bodyParams(saves[0].body) : {};
        assertEqual(params['t' + CAND_TABLE.id], TOKEN, '#4944 поверх старого кода ложится код этого планшета');
    });
});

// ── 3. в таблице уже ЭТОТ код — ничего не пишем (экран перезагружают раз за разом) ──
scenario = scenario.then(function() {
    var env = makeGuardEnv({ roles: '1621', kind: 'slitter', padRows: [],
        candidateRows: [{ i: '804400', r: [TOKEN] }] });
    return env.boot().then(function() {
        assertEqual(env.server.posts.length, 0, '#4944 код уже в таблице — записи нет');
        assertTrue(env.container.textContent.indexOf('Планшет-кандидат') !== -1,
            '#4944 экран всё равно говорит, что код передан');
    });
});

// ── 4. зарегистрированный планшет кода в кандидаты не шлёт ──
scenario = scenario.then(function() {
    var env = makeGuardEnv({ roles: '1621', kind: 'slitter',
        padRows: [{ i: '690292', r: [TOKEN, 'Станок 1', '1277:Станок 1', '', '', ''] }],
        candidateRows: [] });
    return env.boot().then(function() {
        assertEqual(env.server.postsTo(CAND_TABLE.id).length, 0,
            '#4944 планшет опознан — в «Планшет-кандидат» ничего не пишется');
    });
});

// ── 5. чужая роль: пульт закрыт (#4868) и код в кандидаты не уходит ──
scenario = scenario.then(function() {
    var env = makeGuardEnv({ roles: '1621', roleId: '1619', role: 'Диспетчер', kind: 'slitter',
        padRows: [], candidateRows: [] });
    return env.boot().then(function() {
        assertEqual(env.server.postsTo(CAND_TABLE.id).length, 0,
            '#4944 отказ по роли — код кандидатом не записывается');
    });
});

// ── 6. в базе нет таблицы кандидатов — экран работает, код виден, ошибок нет ──
scenario = scenario.then(function() {
    var env = makeGuardEnv({ roles: '1621', kind: 'slitter', padRows: [], candidateRows: [],
        metadata: [PAD_TABLE] });
    return env.boot().then(function() {
        assertEqual(env.server.posts.length, 0, '#4944 нет таблицы кандидатов — ничего не пишем');
        assertTrue(env.container.textContent.indexOf(TOKEN) !== -1,
            '#4944 код планшета на экране остаётся — его можно продиктовать');
    });
});

// ── 7. сервер отказал в записи — планшет говорит об этом, код на экране ──
scenario = scenario.then(function() {
    var env = makeGuardEnv({ roles: '1621', kind: 'slitter', padRows: [], candidateRows: [], postFails: true });
    return env.boot().then(function() {
        assertTrue(env.container.textContent.indexOf('не удалось') !== -1
            || env.container.textContent.indexOf('Не удалось') !== -1,
            '#4944 отказ сервера показан оператору');
        assertTrue(env.container.textContent.indexOf(TOKEN) !== -1,
            '#4944 при отказе код остаётся на экране');
    });
});

// ── 8. вход оператора с корня базы (pad-home): планшет не настроен — код уходит кандидатом ──
scenario = scenario.then(function() {
    var env = makeHomeEnv({ padRows: [], candidateRows: [] });
    return env.boot().then(function() {
        var posts = env.server.postsTo('_m_new/' + CAND_TABLE.id);
        assertEqual(posts.length, 1, '#4944 экран входа оператора тоже передаёт код администратору');
        assertTrue(env.screen.textContent.indexOf('Планшет-кандидат') !== -1,
            '#4944 на экране входа сказано, куда ушёл код');
    });
});

// ── 9. чистый слой: план записи ──
scenario = scenario.then(function() {
assertEqual(guard.candidateWrite(CAND_TABLE, null, TOKEN),
    { path: '_m_new/804338?JSON&up=1', params: { t804338: TOKEN }, mode: 'create' },
    '#4944 записи нет — создаём под корнем');
assertEqual(guard.candidateWrite(CAND_TABLE, { id: '804400', token: OLD_TOKEN }, TOKEN),
    { path: '_m_save/804400?JSON', params: { t804338: TOKEN }, mode: 'update' },
    '#4944 запись есть — правим её главное значение через _m_save');
assertEqual(guard.candidateWrite(CAND_TABLE, { id: '804400', token: TOKEN }, TOKEN), null,
    '#4944 код уже записан — писать нечего');
assertEqual(guard.candidateWrite(null, null, TOKEN), null, '#4944 нет таблицы — плана нет');
assertEqual(guard.candidateWrite(CAND_TABLE, null, 'не-токен'), null, '#4944 мусор вместо кода не пишем');

assertEqual(guard.candidateFromRows([{ i: '804400', r: [OLD_TOKEN] }]), { id: '804400', token: OLD_TOKEN },
    '#4944 запись кандидата разбирается из JSON_OBJ');
assertEqual(guard.candidateFromRows({ object: [{ i: '804400', r: [OLD_TOKEN] }] }), { id: '804400', token: OLD_TOKEN },
    '#4944 разбирается и обёртка { object: [...] }');
assertEqual(guard.candidateFromRows([]), null, '#4944 пустая таблица — записи нет');

assertTrue(guard.findCandidateTable(METADATA) === CAND_TABLE, '#4944 таблица кандидатов ищется по имени');
assertEqual(guard.findCandidateTable([PAD_TABLE]), null, '#4944 нет таблицы кандидатов — null');
assertTrue(guard.findTable(METADATA) === PAD_TABLE, '#4944 «Планшет» не путается с «Планшет-кандидатом»');
});

scenario.then(function() {
    console.log('\n' + passed + '/' + total + ' passed');
    if (process.exitCode) process.exit(process.exitCode);
}).catch(function(err) {
    console.log('FAIL — сценарий упал: ' + (err && err.message ? err.message : err));
    process.exitCode = 1;
});
