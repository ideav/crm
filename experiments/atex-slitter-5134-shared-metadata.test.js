// #5134 — дублирующиеся запросы на пульте слиттера: GET /{db}/metadata уходит
// ТРИжды, GET /{db}/object/673803/?JSON_OBJ&LIMIT=0,2&F_673803={токен} — дважды.
//
// Стреляют все трое, живущие на одной странице:
//   • pad-home.js (main.html, голова, только для роли планшета) — читает
//     метаданные и ищет планшет по токену, чтобы увести оператора в ЕГО пульт;
//     когда открытая страница и есть пульт планшета (#4852), оба ответа
//     выбрасываются — запросы потрачены впустую;
//   • pad-guard.js (шаблон пульта) — та же пара запросов ради допуска; сам
//     модуль при этом исполняется на странице ДВАЖДЫ: из головы main.html
//     (библиотека для pad-home, без data-pad-root) и из шаблона пульта
//     (с data-pad-root);
//   • slitter.js — loadMetadata читает метаданные в третий раз.
//
// Фикс: общая шина GET на window — pad-guard.sharedGet. Идентичный запрос на
// странице исполняется один раз, остальные читают тот же ответ; неудача кеш
// вымывает (повтор возможен). Кеш живёт на window, а не в замке модуля: второе
// исполнение pad-guard.js создаёт новый api, и кеш в замке первой копии умер бы
// вместе с ней.
//
// Проверяется поведение (факты запросов), а не текст исходника.
//
// Run with: node experiments/atex-slitter-5134-shared-metadata.test.js

var path = require('path');
var GUARD = path.join(__dirname, '..', 'download', 'atex', 'js', 'pad-guard.js');
var HOME = path.join(__dirname, '..', 'download', 'atex', 'js', 'pad-home.js');
var SLITTER = path.join(__dirname, '..', 'download', 'atex', 'js', 'slitter.js');

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    assert(ok, name + (ok ? '' : '\n  ожидалось ' + JSON.stringify(expected) + '\n  получено  ' + JSON.stringify(actual)));
}

// ── Минимальный DOM-стаб (по образцу atex-pad-guard-boot.test.js) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = [];
    this.attributes = {};
    this.handlers = {};
    this.value = '';
    this.disabled = false;
    this._text = '';
}
Object.defineProperty(StubNode.prototype, 'textContent', {
    get: function() {
        if (this.childNodes.length) return this.childNodes.map(function(c) { return c.textContent; }).join(' ');
        return this._text;
    },
    set: function(v) { this._text = String(v == null ? '' : v); this.childNodes = []; }
});
Object.defineProperty(StubNode.prototype, 'innerHTML', {
    get: function() { return ''; },
    set: function(v) { if (v === '') { this.childNodes = []; this._text = ''; } }
});
StubNode.prototype.appendChild = function(n) { this.childNodes.push(n); n.parentNode = this; return n; };
StubNode.prototype.removeChild = function(n) {
    var i = this.childNodes.indexOf(n);
    if (i >= 0) this.childNodes.splice(i, 1);
    n.parentNode = null;
    return n;
};
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); };

// ── Схема «Планшета» и ответ метаданных — сверены с pad-guard-тестами ──
var TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
var PAD_TABLE = {
    id: '673803', up: '0', type: '3', val: 'Планшет', unique: '1',
    granted: 'WRITE', export: '1', delete: '1',
    reqs: [
        { num: 1, id: '673807', val: 'Наименование', type: '3' },
        { num: 2, id: '673808', val: 'Слиттер', type: '2' },
        { num: 3, id: '673809', val: 'Втулкорез', type: '2' },
        { num: 4, id: '673810', val: 'Упаковочное место', type: '2' },
        { num: 5, id: '673811', val: 'Рабочее место', type: '3' }
    ]
};
// r[0] — токен, r[1] — имя, r[2] — «Слиттер», r[5] — «Рабочее место».
var PAD_ROW = { i: '673900', r: [TOKEN, 'Планшет слиттера №1', '501:Слиттер №1', '', '', 'слиттер'] };
var METADATA = [
    { id: '1078', val: 'Задание в производство', granted: 'WRITE', reqs: [{ id: '1', val: 'Номер' }] },
    PAD_TABLE,
    { id: '1080', val: 'Партия ГП', granted: 'WRITE', reqs: [] },          // packer
    { id: '1081', val: 'Событие смены', granted: 'WRITE', reqs: [] },      // packer
    { id: '1082', val: 'Задание на втулки', granted: 'WRITE', reqs: [] },  // sleeve-cutter
    { id: '1083', val: 'Втулкорез', granted: 'WRITE', reqs: [] }           // sleeve-cutter
];

function freshRequire(p) {
    delete require.cache[require.resolve(p)];
    return require(p);
}
function settled() {
    return new Promise(function(r) { setImmediate(function() { setImmediate(r); }); });
}
function cleanup() {
    delete global.window;
    delete global.document;
    delete global.fetch;
}
function countUrl(calls, frag) {
    return calls.filter(function(c) { return c.url && c.url.indexOf(frag) >= 0; }).length;
}

// Сцена «страница пульта»: окно с fetch-журналом; ответы — метаданные и строка планшета.
function page() {
    var rootEl = new StubNode('div');
    rootEl.setAttribute('data-db', 'ateh');
    rootEl.setAttribute('data-xsrf', 'XSRF');
    rootEl.setAttribute('data-user', 'op');
    var navbar = new StubNode('div');
    navbar.setAttribute('class', 'navbar-workspace');
    var body = new StubNode('body');
    var head = new StubNode('head');
    var doc = {
        currentScript: null,
        body: body,
        head: head,
        getElementById: function(id) { return id === 'atex-slitter' ? rootEl : null; },
        createElement: function(tag) { return new StubNode(tag); },
        querySelector: function(sel) {
            return sel === '.navbar-workspace' ? navbar : null;
        }
    };
    var store = { data: {}, getItem: function(k) { return this.data[k] == null ? null : this.data[k]; },
        setItem: function(k, v) { this.data[k] = String(v); } };
    store.data.atehPad = TOKEN;
    var calls = [];
    var win = {
        document: doc,
        localStorage: store,
        roleId: '1621',
        role: 'Оператор',
        location: { replace: function(href) { calls.push({ replace: href }); } },
        crypto: { getRandomValues: function(arr) { for (var i = 0; i < arr.length; i++) arr[i] = (i * 7 + 3) & 0xff; return arr; } },
        URLSearchParams: URLSearchParams
    };
    win.fetch = function(url, init) {
        calls.push({ url: String(url), init: init });
        var payload = String(url).indexOf('/metadata') >= 0 ? METADATA : [PAD_ROW];
        return Promise.resolve({ ok: true, status: 200,
            text: function() { return Promise.resolve(JSON.stringify(payload)); } });
    };
    global.window = win;
    global.document = doc;
    global.fetch = win.fetch;   // slitter.getJson зовёт голый fetch
    return {
        win: win, calls: calls, body: body, navbar: navbar, rootEl: rootEl,
        script: function(attrs) {
            var s = new StubNode('script');
            Object.keys(attrs || {}).forEach(function(k) { s.setAttribute(k, attrs[k]); });
            return s;
        },
        appScript: function() {
            return body.childNodes.filter(function(n) { return n.tagName === 'SCRIPT'; })[0] || null;
        }
    };
}

// Исполнение pad-guard.js как в голове main.html: currentScript без data-pad-root —
// boot выходит сразу, модуль остаётся библиотекой для pad-home.
function loadGuardAsLibrary(s) {
    s.win.document.currentScript = s.win.document.createElement('script');
    return freshRequire(GUARD);
}
// Исполнение pad-guard.js из шаблона пульта: currentScript с data-pad-root —
// модуль сам вызывает boot.
function loadGuardAsWorkspace(s, appSrc) {
    s.win.document.currentScript = s.script({
        'data-pad-root': 'atex-slitter',
        'data-pad-app': appSrc || '/download/ateh/js/slitter.js?122.16',
        'data-pad-roles': '1621',
        'data-pad-kind': 'slitter'
    });
    return freshRequire(GUARD);
}
// pad-home.js: подключается из main.html после guard.onload — атрибуты на теге
// скрипта, boot модуль зовёт сам по currentScript. Воспроизводим ровно так:
// перед require кладём в document.currentScript тег pad-home с его атрибутами.
function bootPadHome(s) {
    s.win.document.currentScript = s.script({
        'data-pad-db': 'ateh',
        'data-pad-action': 'slitter',
        'data-pad-role-id': '1621',
        'data-pad-roles': '1621',
        'data-pad-css': ''
    });
    freshRequire(HOME);
}

(async function() {
    // ── 1) Страница слиттера, pad-home успел раньше сторожа ──────────────────────
    cleanup();
    var s = page();
    loadGuardAsLibrary(s);
    bootPadHome(s);
    await settled();
    assertEqual(countUrl(s.calls, '/ateh/metadata'), 1, '#5134: pad-home запросил метаданные один раз');
    assertEqual(countUrl(s.calls, '/ateh/object/673803/'), 1, '#5134: pad-home искал планшет один раз');

    loadGuardAsWorkspace(s);
    await settled();
    assertEqual(countUrl(s.calls, '/ateh/metadata'), 1,
        '#5134: сторож (второе исполнение модуля) переиспользовал метаданные pad-home');
    assertEqual(countUrl(s.calls, '/ateh/object/673803/'), 1,
        '#5134: сторож переиспользовал поиск планшета — GET object/673803 уходит один раз');
    assert(!!s.appScript(), 'поведение #4666 сохранилось: скрипт пульта подключён');
    assertEqual(s.appScript() && s.appScript().src, '/download/ateh/js/slitter.js?122.16', 'подключён скрипт из data-pad-app');
    assertEqual(s.navbar.textContent, 'Планшет слиттера №1', 'имя планшета показано в .navbar-workspace');
    assertEqual(s.calls.filter(function(c) { return c.replace; }).length, 0,
        'поведение #4852 сохранилось: свой пульт — остаёмся, без редиректа');

    // ── 2) Обратный порядок гонки: сторож успел раньше pad-home ──────────────────
    cleanup();
    s = page();
    loadGuardAsLibrary(s);
    loadGuardAsWorkspace(s);
    await settled();
    assertEqual(countUrl(s.calls, '/ateh/metadata'), 1, '#5134 (гонка B): метаданные запрошены один раз');
    assertEqual(countUrl(s.calls, '/ateh/object/673803/'), 1, '#5134 (гонка B): поиск планшета один раз');
    assert(!!s.appScript(), '#5134 (гонка B): скрипт пульта подключён');
    bootPadHome(s);
    await settled();
    assertEqual(countUrl(s.calls, '/ateh/metadata'), 1, '#5134 (гонка B): pad-home переиспользовал метаданные сторожа');
    assertEqual(countUrl(s.calls, '/ateh/object/673803/'), 1, '#5134 (гонка B): pad-home переиспользовал поиск планшета');
    assertEqual(s.calls.filter(function(c) { return c.replace; }).length, 0,
        '#5134 (гонка B): редиректа по-прежнему нет');

    // ── 3) slitter.js: loadMetadata читает общие метаданные, без третьего GET ────
    cleanup();
    s = page();
    s.rootEl.dataset = { initialized: '1' };   // авто-init пульта в стабе не нужен
    var guard = loadGuardAsLibrary(s);
    await guard.sharedGet({ db: 'ateh' }, 'metadata');   // на странице метаданные уже читали
    assertEqual(countUrl(s.calls, '/ateh/metadata'), 1, '#5134: подогрев шины — один GET metadata');
    var slitter = freshRequire(SLITTER);
    var c = Object.create(slitter.Controller.prototype);
    c.root = s.rootEl;
    c.db = 'ateh';
    c.meta = {};
    await c.loadMetadata();
    assertEqual(countUrl(s.calls, '/ateh/metadata'), 1,
        '#5134: loadMetadata пульта взял метаданные из шины — третий GET не ушёл');
    assert(!!c.meta.cut, 'loadMetadata нашла таблицу «Задание в производство»');

    // ── 3б) то же у упаковщика и втулкореза («то же у упаковщика», комментарий к #5134) ──
    var packer = freshRequire(path.join(__dirname, '..', 'download', 'atex', 'js', 'packer.js'));
    var pc = Object.create(packer.Controller.prototype);
    pc.root = s.rootEl;
    pc.db = 'ateh';
    pc.meta = {};
    await pc.loadMetadata();
    assertEqual(countUrl(s.calls, '/ateh/metadata'), 1, '#5134: loadMetadata упаковщика взяла метаданные из шины');
    assert(!!pc.meta.gp && !!pc.meta.event, 'loadMetadata упаковщика нашла «Партию ГП» и «Событие смены»');
    var cutter = freshRequire(path.join(__dirname, '..', 'download', 'atex', 'js', 'sleeve-cutter.js'));
    var cc = Object.create(cutter.Controller.prototype);
    cc.root = s.rootEl;
    cc.db = 'ateh';
    cc.meta = {};
    await cc.loadMetadata();
    assertEqual(countUrl(s.calls, '/ateh/metadata'), 1, '#5134: loadMetadata втулкореза взяла метаданные из шины');
    assert(!!cc.meta.task && !!cc.meta.cutter, 'loadMetadata втулкореза нашла «Задание на втулки» и «Втулкорез»');

    // ── 4) без pad-guard на странице пульт по-прежнему сам читает метаданные ─────
    cleanup();
    s = page();
    s.rootEl.dataset = { initialized: '1' };   // авто-init пульта в стабе не нужен
    slitter = freshRequire(SLITTER);
    delete s.win.AtexPadGuard;   // пульт открыт вне связки со сторожем
    c = Object.create(slitter.Controller.prototype);
    c.root = s.rootEl;
    c.db = 'ateh';
    c.meta = {};
    await c.loadMetadata();
    assertEqual(countUrl(s.calls, '/ateh/metadata'), 1, '#5134: без сторожа loadMetadata читает метаданные сама');
    assert(!!c.meta.cut, 'без сторожа таблица «Задание в производство» найдена');

    // ── 5) неудача вымывается из шины: повторный GET не получает закешированный отказ ──
    cleanup();
    s = page();
    var fail = true;
    s.win.fetch = function(url) {
        s.calls.push({ url: String(url) });
        if (fail) return Promise.resolve({ ok: false, status: 500,
            text: function() { return Promise.resolve(JSON.stringify({ error: 'недоступно' })); } });
        return Promise.resolve({ ok: true, status: 200,
            text: function() { return Promise.resolve(JSON.stringify(METADATA)); } });
    };
    var guard2 = loadGuardAsLibrary(s);
    var first = guard2.sharedGet({ db: 'ateh' }, 'metadata');
    var second = guard2.sharedGet({ db: 'ateh' }, 'metadata');   // в полёте — тот же промис
    await first.then(function() { assert(false, '#5134: отказ должен был прийти ошибкой'); },
        function(err) { assert(/недоступно/.test(String(err.message)), '#5134: отказ доходит до всех читателей шины: ' + err.message); });
    await second.then(function() { assert(false, '#5134: отказ должен был прийти ошибкой (второй читатель)'); },
        function() { /* ок — тот же отказ */ });
    assertEqual(countUrl(s.calls, '/ateh/metadata'), 1, '#5134: в полёте дедуп — один GET и при отказе');
    fail = false;
    var third = await guard2.sharedGet({ db: 'ateh' }, 'metadata');
    assertEqual(countUrl(s.calls, '/ateh/metadata'), 2, '#5134: после отказа шина повторяет GET');
    assert(Array.isArray(third) && third.some(function(t) { return t && t.val === 'Планшет'; }),
        '#5134: повторный GET возвращает данные (в них есть таблица «Планшет»)');

    cleanup();
    console.log('\nИтого: ' + passed + '/' + total);
})();
