// #4868 — операторские пульты закрыты для других ролей и ненастроенных планшетов.
//
// Пульты (slitter / sleeve-cutter / packer) открывались любому, кто знает адрес:
// проверялся только факт регистрации планшета, но не роль вошедшего и не то,
// назначен ли планшету его объект (станок / втулкорез / упаковочное место).
// Теперь сторож проверяет ДО загрузки кода пульта:
//   1) роль вошедшего — из списка, заданного шаблоном (data-pad-roles);
//   2) у планшета заполнена колонка объекта этого рабочего места (data-pad-kind).
// Отказ — экран с ошибкой вместо пульта; скрипт пульта не загружается вовсе.
//
// Проверяем ПОВЕДЕНИЕ boot(): какая разметка осталась на экране и загрузился ли
// скрипт пульта, — а не текст исходника сторожа.
//
// Run with: node experiments/atex-pad-guard-4868.test.js

// ── стабы глобаль ДО загрузки модуля (boot при загрузке не выполняется: нет currentScript) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = [];
    this.attributes = {};
    this._className = '';
    this._text = '';
    this.src = '';
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
StubNode.prototype.appendChild = function(n) { this.childNodes.push(n); return n; };
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
var METADATA = [PAD_TABLE, { id: '1078', val: 'Задание в производство', granted: 'WRITE', reqs: [] }];
var TOKEN = 'aaaa0000bbbb1111cccc2222dddd3333';
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

// Планшет для чистого слоя: как его собирает guard.padFromRows.
function padAs(name, config) {
    return { id: '1', token: TOKEN, name: name, config: {
        slitter: config.slitter || null, cutter: config.cutter || null,
        place: config.place || null, workspace: config.workspace || ''
    } };
}

function flush() { return new Promise(function(r) { setTimeout(r, 10); }); }

// Окружение boot(): контейнер пульта, fetch с метаданными и строкой планшета,
// localStorage с токеном, глобальные роль/role_id.
function makeEnv(opts) {
    var env = { created: [], appLoaded: null };
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
        body: body
    };
    global.fetch = function(url) {
        var path = String(url);
        var payload;
        if (path.indexOf('metadata') !== -1) payload = METADATA;
        else payload = opts.padRows === undefined ? [] : opts.padRows;
        return Promise.resolve({ ok: true, text: function() { return Promise.resolve(JSON.stringify(payload)); } });
    };
    global.localStorage = {
        _data: {},
        getItem: function(k) { return this._data[k] == null ? null : this._data[k]; },
        setItem: function(k, v) { this._data[k] = String(v); }
    };
    global.localStorage.setItem('atehPad', opts.token == null ? TOKEN : opts.token);
    global.crypto = { getRandomValues: function(a) { for (var i = 0; i < a.length; i++) a[i] = (i * 7 + 3) % 256; return a; } };
    if (typeof URLSearchParams === 'function') global.URLSearchParams = URLSearchParams;
    global.role = opts.role == null ? '' : opts.role;
    global.roleId = opts.roleId == null ? '' : opts.roleId;

    var attrs = { 'data-pad-root': 'pult', 'data-pad-app': APP_SRC };
    if (opts.roles !== undefined) attrs['data-pad-roles'] = opts.roles;
    if (opts.kind !== undefined) attrs['data-pad-kind'] = opts.kind;
    env.container = container;
    env.boot = function() {
        guard.boot({ getAttribute: function(k) { return attrs[k] == null ? null : attrs[k]; } });
        return flush().then(flush);
    };
    env.appWasLoaded = function() {
        return env.created.some(function(n) { return n.tagName === 'SCRIPT' && n.src === APP_SRC; });
    };
    return env;
}

// Строка JSON_OBJ планшета: [токен, Наименование, Слиттер, Втулкорез, Упаковочное место, Рабочее место]
function padRow(slitter, cutter, place, workspace) {
    return [{ i: '690292', r: [TOKEN, 'Станок 1', slitter || '', cutter || '', place || '', workspace || ''] }];
}

var scenario = Promise.resolve();

// ── 1. роль не операторская — пульт не открывается ──
scenario = scenario.then(function() {
    var env = makeEnv({ roles: '1621', roleId: '1619', role: 'Диспетчер', kind: 'slitter', padRows: padRow('1277:Станок 1') });
    return env.boot().then(function() {
        assertTrue(env.container.textContent.indexOf('операторское') !== -1,
            'чужая роль — экран «это операторское место»');
        assertFalse(env.appWasLoaded(), 'чужая роль — скрипт пульта не загружается');
    });
});

// ── 2. роль не определена — тоже отказ (строгий гейт) ──
scenario = scenario.then(function() {
    var env = makeEnv({ roles: '1621', roleId: '', role: '', kind: 'slitter', padRows: padRow('1277:Станок 1') });
    return env.boot().then(function() {
        assertTrue(env.container.textContent.indexOf('операторское') !== -1,
            'роль не определена — отказ');
        assertFalse(env.appWasLoaded(), 'роль не определена — пульт не грузится');
    });
});

// ── 3. оператор с настроенным планшетом работает как раньше ──
scenario = scenario.then(function() {
    var env = makeEnv({ roles: '1621', roleId: '1621', role: 'Оператор', kind: 'slitter', padRows: padRow('1277:Станок 1') });
    return env.boot().then(function() {
        assertTrue(env.appWasLoaded(), 'оператор на настроенном планшете — пульт грузится');
        assertTrue(env.container.textContent.indexOf('операторское') === -1,
            'оператору экран отказа не показывается');
    });
});

// ── 4. оператор, но планшету не назначен объект этого рабочего места ──
scenario = scenario.then(function() {
    var env = makeEnv({ roles: '1621', roleId: '1621', role: 'Оператор', kind: 'cutter', padRows: padRow('1277:Станок 1') });
    return env.boot().then(function() {
        assertTrue(env.container.textContent.indexOf('не настроен') !== -1,
            'нет втулкореза на планшете — экран «планшет не настроен»');
        assertTrue(env.container.textContent.indexOf('Втулкорез') !== -1,
            'в отказе названа колонка, которую надо заполнить');
        assertFalse(env.appWasLoaded(), 'ненастроенный планшет — пульт не грузится');
    });
});

// ── 5. то же для упаковщика: место не указано ──
scenario = scenario.then(function() {
    var env = makeEnv({ roles: '1621', roleId: '1621', role: 'Оператор', kind: 'place', padRows: padRow('', '', '', 'packer') });
    return env.boot().then(function() {
        assertTrue(env.container.textContent.indexOf('Упаковочное место') !== -1,
            'упаковщику в отказе названо «Упаковочное место»');
        assertFalse(env.appWasLoaded(), 'без упаковочного места пульт упаковщика не грузится');
    });
});

// ── 6. незарегистрированный планшет — прежний экран (не путать с настройкой) ──
scenario = scenario.then(function() {
    var env = makeEnv({ roles: '1621', roleId: '1621', role: 'Оператор', kind: 'slitter', padRows: [] });
    return env.boot().then(function() {
        assertTrue(env.container.textContent.indexOf('не зарегистрировано') !== -1,
            'незарегистрированный планшет — прежний экран допуска');
        assertFalse(env.appWasLoaded(), 'незарегистрированный планшет — пульт не грузится');
    });
});

// ── 7. без data-pad-roles гейт роли выключен (старые встраивания не ломаются) ──
scenario = scenario.then(function() {
    var env = makeEnv({ roleId: '1619', role: 'Диспетчер', kind: 'slitter', padRows: padRow('1277:Станок 1') });
    return env.boot().then(function() {
        assertTrue(env.appWasLoaded(), 'список ролей не задан — гейт роли не работает, прежнее поведение');
    });
});

// ── 8. без data-pad-kind гейт объекта выключен ──
scenario = scenario.then(function() {
    var env = makeEnv({ roles: '1621', roleId: '1621', role: 'Оператор', padRows: padRow('') });
    return env.boot().then(function() {
        assertTrue(env.appWasLoaded(), 'data-pad-kind не задан — объект не проверяется, прежнее поведение');
    });
});

// ── 9. чистый слой: разбор списка ролей и решения ──
assertEqual(guard.parseRoleIds(' 1621, , 1619;1623 '), ['1621', '1619', '1623'],
    '#4868 список ролей шаблона разбирается с пробелами и разделителями');
assertEqual(guard.isRoleAllowed(['1621'], '1621'), true, '#4868 оператор допущен');
assertEqual(guard.isRoleAllowed(['1621'], '1619'), false, '#4868 чужая роль не допущена');
assertEqual(guard.isRoleAllowed(['1621'], ''), false, '#4868 пустая роль не допущена');
assertEqual(guard.isRoleAllowed([], '1619'), true, '#4868 пустой список — гейт выключен');

assertEqual(guard.missingObject(null, 'slitter'), null, '#4868 нет планшета — решает другой экран');
assertEqual(guard.missingObject(padAs('Станок 1', { slitter: { id: '1277', label: 'Станок 1' } }), 'slitter'), null,
    '#4868 объект задан — отказа нет');
assertEqual(guard.missingObject(padAs('Станок 1', {}), 'workspace'), null,
    '#4868 «Рабочее место» — не объект допуска, его пустота пульт не блокирует');
var miss = guard.missingObject(padAs('Станок 1', {}), 'cutter');
assertTrue(!!miss && miss.title === 'Планшет не настроен',
    '#4868 отказ «Планшет не настроен» собран');
var refusal = miss && miss.text || '';
assertTrue(refusal.indexOf('Втулкорез') !== -1 && refusal.indexOf('Станок 1') !== -1,
    '#4868 отказ называет планшет и колонку, которую надо заполнить');

scenario.then(function() {
    console.log('\n' + passed + '/' + total + ' passed');
    if (process.exitCode) process.exit(process.exitCode);
}).catch(function(err) {
    console.log('FAIL — сценарий упал: ' + (err && err.message ? err.message : err));
    process.exitCode = 1;
});
