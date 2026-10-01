// #5046 — рабочие места пользователя ограничены списком его планшетов.
//
// У пользователя есть реквизит «Планшеты»: через запятую — коды устройств, с которых ему
// можно работать (код тот же, что у планшета оператора: localStorage `atehPad`). Список
// заполнен — код текущего устройства ищется в нём ПОДСТРОКОЙ. Совпадения нет — никакое
// рабочее место не отображается: на экране код устройства и ошибка «Устройство не найдено
// среди разрешенных для этого рабочего места», а код уходит в «Планшет-кандидат» (#4944).
//
// Значение «Планшетов» страница получает из шаблона (отчёт MyPads, templates/atex/main.html)
// в `window.atexUserPads`. Проверяем ПОВЕДЕНИЕ: грузится ли код пульта (pad-guard.boot),
// что видно на экране страницы (pad-guard.checkUserPads) и какие запросы ушли на сервер.
//
// Run with: node experiments/atex-pad-5046-user-pads.test.js

// ── стабы DOM (те же, что в atex-pad-4944-candidate.test.js) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = [];
    this.attributes = {};
    this._text = '';
    this.src = '';
    this.parentNode = null;
    this.style = {};
}
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
var CAND_TABLE = {
    id: '804338', up: '0', type: '3', val: 'Планшет-кандидат', unique: '0',
    granted: 'WRITE', export: '1', delete: '1', reqs: []
};
var METADATA = [PAD_TABLE, CAND_TABLE];
var TOKEN = 'aaaa0000bbbb1111cccc2222dddd3333';
var OTHER = '99998888777766665555444433332222';
var APP_SRC = '/download/ateh/js/slitter.js?x';
var DENIED = 'Устройство не найдено среди разрешенных для этого рабочего места';
// Зарегистрированный планшет, настроенный на станок «Слиттер 1».
var PAD_ROWS = [{ i: '700001', r: [TOKEN, 'Планшет 1', '1070:Слиттер 1', '', '', 'slitter'] }];

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
function has(text, part) { return String(text).indexOf(part) !== -1; }

global.window = undefined;
var guard = require('../download/atex/js/pad-guard.js');

function flush() { return new Promise(function(r) { setTimeout(r, 10); }); }

function makeServer(opts) {
    var srv = { posts: [] };
    global.fetch = function(url, init) {
        var path = String(url);
        if (init && init.method === 'POST') {
            srv.posts.push({ path: path, body: String(init.body || '') });
            return Promise.resolve({ ok: true,
                text: function() { return Promise.resolve(JSON.stringify({ id: '900001', obj: '900001' })); } });
        }
        var payload;
        if (path.indexOf('metadata') !== -1) payload = METADATA;
        else if (path.indexOf('object/' + CAND_TABLE.id) !== -1) payload = [];
        else payload = opts.padRows === undefined ? PAD_ROWS : opts.padRows;
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

// Страница: body, контейнер пульта и глобали шаблона main.html.
function makeEnv(opts) {
    var env = {};
    var body = new StubNode('body');
    var container = new StubNode('div');
    container.setAttribute('id', 'pult');
    container.setAttribute('data-db', 'ateh');
    container.setAttribute('data-xsrf', 'xsrf-token');
    container.setAttribute('data-user', 'operator');
    global.document = {
        readyState: 'complete',
        createElement: function(tag) { return new StubNode(tag); },
        createTextNode: function(text) { var n = new StubNode('#text'); n._text = String(text); return n; },
        getElementById: function(id) {
            if (id === 'pult') return container;
            var found = null;
            body.childNodes.forEach(function(n) { if (n.getAttribute('id') === id) found = n; });
            return found;
        },
        querySelector: function() { return null; },
        addEventListener: function() {},
        head: new StubNode('head'),
        body: body
    };
    makeStorage(opts.token === undefined ? TOKEN : opts.token);
    global.crypto = { getRandomValues: function(a) { for (var i = 0; i < a.length; i++) a[i] = (i * 7 + 3) % 256; return a; } };
    global.role = 'Оператор';
    global.roleId = '1621';
    global.xsrf = 'xsrf-token';
    global.atexUserPads = opts.pads;
    env.server = makeServer(opts);
    env.body = body;
    env.container = container;
    env.appLoaded = function() {
        return body.childNodes.some(function(n) { return n.tagName === 'SCRIPT' && n.src === APP_SRC; });
    };
    env.bootGuard = function() {
        var attrs = { 'data-pad-root': 'pult', 'data-pad-app': APP_SRC,
            'data-pad-roles': '1621', 'data-pad-kind': 'slitter' };
        guard.boot({ getAttribute: function(k) { return attrs[k] == null ? null : attrs[k]; } });
        return flush().then(flush).then(flush);
    };
    return env;
}

var scenario = Promise.resolve();

// ── 1. чистое правило: код ищется в списке подстрокой ──
scenario = scenario.then(function() {
    assertTrue(guard.isDeviceAllowed('', TOKEN), '#5046 «Планшеты» пусты — ограничения нет');
    assertTrue(guard.isDeviceAllowed('   ', TOKEN), '#5046 одни пробелы — ограничения нет');
    assertTrue(guard.isDeviceAllowed(undefined, TOKEN), '#5046 значения нет вовсе — ограничения нет');
    assertTrue(guard.isDeviceAllowed('{pads}', TOKEN), '#5046 отчёта MyPads в базе нет (плейсхолдер шаблона) — ограничения нет');
    assertTrue(guard.isDeviceAllowed(TOKEN, TOKEN), '#5046 единственный код в списке совпал — можно');
    assertTrue(guard.isDeviceAllowed(OTHER + ', ' + TOKEN, TOKEN), '#5046 код второй в списке через запятую — можно');
    assertTrue(guard.isDeviceAllowed(OTHER + ',' + TOKEN + ' ', TOKEN), '#5046 запятая без пробела — можно');
    assertTrue(guard.isDeviceAllowed('Планшет мастера: ' + TOKEN.toUpperCase(), TOKEN),
        '#5046 код в верхнем регистре и с подписью — подстрока находится');
    assertFalse(guard.isDeviceAllowed(OTHER, TOKEN), '#5046 кода нет в списке — нельзя');
    assertFalse(guard.isDeviceAllowed(OTHER, ''), '#5046 у устройства нет кода — нельзя');
    assertFalse(guard.isDeviceAllowed(OTHER, 'нет'), '#5046 мусор вместо кода — нельзя');
    assertFalse(guard.isDeviceAllowed(TOKEN.slice(0, 16), TOKEN),
        '#5046 в списке только начало кода — устройство не опознано');
});

// ── 2. пульт: устройство не из списка — код пульта не грузится, на экране код и ошибка ──
scenario = scenario.then(function() {
    var env = makeEnv({ pads: OTHER });
    return env.bootGuard().then(function() {
        assertFalse(env.appLoaded(), '#5046 устройство не из списка — код пульта не грузится');
        assertTrue(has(env.container.textContent, DENIED), '#5046 на экране пульта — ошибка из задачи');
        assertTrue(has(env.container.textContent, TOKEN), '#5046 на экране пульта — код этого устройства');
        var posts = env.server.postsTo('_m_new/' + CAND_TABLE.id);
        assertEqual(posts.length, 1, '#5046 код уходит в «Планшет-кандидат»');
        assertTrue(posts.length && has(decodeURIComponent(posts[0].body), 't804338=' + TOKEN),
            '#5046 в «Планшет-кандидат» пишется код этого устройства');
    });
});

// ── 3. пульт: устройство в списке — пульт открывается как раньше ──
scenario = scenario.then(function() {
    var env = makeEnv({ pads: OTHER + ', ' + TOKEN });
    return env.bootGuard().then(function() {
        assertTrue(env.appLoaded(), '#5046 устройство в списке — пульт грузится');
        assertFalse(has(env.container.textContent, DENIED), '#5046 устройство в списке — ошибки нет');
        assertEqual(env.server.postsTo('_m_new/' + CAND_TABLE.id).length, 0,
            '#5046 устройство в списке — в «Планшет-кандидат» ничего не пишется');
    });
});

// ── 4. пульт: «Планшеты» пусты — поведение прежнее ──
scenario = scenario.then(function() {
    var env = makeEnv({ pads: '' });
    return env.bootGuard().then(function() {
        assertTrue(env.appLoaded(), '#5046 «Планшеты» пусты — пульт грузится');
    });
});

// ── 5. пульт: у устройства ещё нет кода — код генерируется, показывается и передаётся ──
scenario = scenario.then(function() {
    var env = makeEnv({ pads: OTHER, token: '' });
    return env.bootGuard().then(function() {
        var fresh = global.localStorage.getItem('atehPad');
        assertTrue(guard.isToken(fresh), '#5046 без кода устройства код генерируется и запоминается');
        assertFalse(env.appLoaded(), '#5046 новый код в списке не значится — пульт не грузится');
        assertTrue(has(env.container.textContent, fresh), '#5046 на экране — сгенерированный код');
        assertEqual(env.server.postsTo('_m_new/' + CAND_TABLE.id).length, 1,
            '#5046 сгенерированный код уходит в «Планшет-кандидат»');
    });
});

// ── 6. любая страница базы (main.html): не из списка — экран ошибки, страница не открывается ──
scenario = scenario.then(function() {
    var env = makeEnv({ pads: OTHER });
    var ok = guard.checkUserPads({ pads: OTHER, db: 'ateh', xsrf: 'xsrf-token' });
    return flush().then(flush).then(flush).then(function() {
        assertFalse(ok, '#5046 страница: устройство не из списка — проверка не пройдена');
        var screen = global.document.getElementById('atex-pad-allow');
        assertTrue(!!screen, '#5046 страница: поверх неё экран отказа');
        assertTrue(screen && has(screen.textContent, DENIED), '#5046 страница: на экране ошибка из задачи');
        assertTrue(screen && has(screen.textContent, TOKEN), '#5046 страница: на экране код устройства');
        assertEqual(env.server.postsTo('_m_new/' + CAND_TABLE.id).length, 1,
            '#5046 страница: код уходит в «Планшет-кандидат»');
    });
});

// ── 7. любая страница базы: устройство в списке — экрана нет, запросов нет ──
scenario = scenario.then(function() {
    var env = makeEnv({ pads: TOKEN });
    var ok = guard.checkUserPads({ pads: TOKEN, db: 'ateh', xsrf: 'xsrf-token' });
    return flush().then(function() {
        assertTrue(ok, '#5046 страница: устройство в списке — проверка пройдена');
        assertEqual(global.document.getElementById('atex-pad-allow'), null, '#5046 страница: экрана отказа нет');
        assertEqual(env.server.posts.length, 0, '#5046 страница: ничего не пишется');
    });
});

// ── 8. пульт внутри страницы: отказывают оба — страница и сторож пульта, запись одна ──
scenario = scenario.then(function() {
    var env = makeEnv({ pads: OTHER });
    guard.checkUserPads({ pads: OTHER, db: 'ateh', xsrf: 'xsrf-token' });
    return env.bootGuard().then(function() {
        assertFalse(env.appLoaded(), '#5046 пульт на странице: код пульта не грузится');
        assertEqual(env.server.postsTo('_m_new/' + CAND_TABLE.id).length, 1,
            '#5046 код публикуют страница и пульт одновременно — запись в «Планшет-кандидате» одна');
    });
});

scenario.then(function() {
    console.log('\n' + passed + '/' + total + ' passed');
    if (process.exitCode) process.exit(process.exitCode);
}).catch(function(err) {
    console.log('FAIL — сценарий упал: ' + (err && err.message ? err.message : err));
    process.exitCode = 1;
});
