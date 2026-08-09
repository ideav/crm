// UI-тест сторожа планшета (ideav/crm#4666) поверх лёгкого DOM-стаба.
//
// Главное требование задачи: «рабочее место должно быть пустым — не успевать
// отрисоваться». Поэтому проверяем не текст на экране, а ФАКТ ЗАГРУЗКИ скрипта
// пульта: незарегистрированный планшет не должен получить его вовсе.
//
//   1) планшет найден в таблице → скрипт пульта подключается, имя уходит в
//      .navbar-workspace;
//   2) токена нет / записи нет / нет доступа к таблице / таблицы нет в базе →
//      скрипт пульта НЕ подключается, на экране отказ;
//   3) с правом WRITE на экране отказа есть поле имени и кнопка, без права —
//      только сообщение;
//   4) регистрация: POST `_m_new/{Планшет}` с _xsrf, токеном в первой колонке и
//      именем; токен уходит в localStorage, страница перезагружается;
//   5) пустое имя — ошибка на месте, без запроса.
//
// Run with: node experiments/atex-pad-guard-boot.test.js

var path = require('path');
var MODULE = path.join(__dirname, '..', 'download', 'atex', 'js', 'pad-guard.js');

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++;
    else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// ── Минимальный DOM-стаб ──
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
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); };
StubNode.prototype.focus = function() { this.focused = true; };
StubNode.prototype.click = function() { (this.handlers.click || []).forEach(function(fn) { fn({}); }); };
StubNode.prototype._all = function(acc) {
    this.childNodes.forEach(function(c) { acc.push(c); c._all(acc); });
    return acc;
};
StubNode.prototype.querySelectorAll = function(sel) {
    var cls = sel.replace(/^\./, '');
    return this._all([]).filter(function(n) {
        return String(n.attributes.class || '').split(/\s+/).indexOf(cls) !== -1;
    });
};
StubNode.prototype.querySelector = function(sel) { return this.querySelectorAll(sel)[0] || null; };

// ── Сцена: окружение одного прогона ──
function scene(opts) {
    var root = new StubNode('div');
    root.setAttribute('data-db', 'ateh');
    root.setAttribute('data-xsrf', 'XSRF-TOKEN');
    if (opts.user) root.setAttribute('data-user', opts.user);

    var navbar = new StubNode('div');
    navbar.setAttribute('class', 'navbar-workspace');
    navbar.textContent = 'slitter';

    var body = new StubNode('body');
    var currentScript = new StubNode('script');
    currentScript.setAttribute('data-pad-root', 'atex-slitter');
    currentScript.setAttribute('data-pad-app', '/download/ateh/js/slitter.js?122.11');

    var calls = [];
    var store = { data: {}, getItem: function(k) { return this.data[k] == null ? null : this.data[k]; },
        setItem: function(k, v) { this.data[k] = String(v); } };
    if (opts.token) store.data.atehPad = opts.token;

    var win = {
        document: {
            currentScript: currentScript,
            body: body,
            getElementById: function(id) { return id === 'atex-slitter' ? root : null; },
            createElement: function(tag) { return new StubNode(tag); },
            querySelector: function(sel) { return sel === '.navbar-workspace' ? navbar : null; }
        },
        localStorage: store,
        location: { reload: function() { calls.push({ reload: true }); } },
        crypto: { getRandomValues: function(arr) { for (var i = 0; i < arr.length; i++) arr[i] = (i * 7 + 3) & 0xff; return arr; } },
        URLSearchParams: URLSearchParams,
        fetch: function(url, init) {
            calls.push({ url: url, init: init });
            var reply = opts.reply(url, init);
            return Promise.resolve({
                ok: reply.ok !== false,
                status: reply.status || (reply.ok === false ? 403 : 200),
                text: function() { return Promise.resolve(JSON.stringify(reply.body)); }
            });
        }
    };

    global.window = win;
    delete require.cache[require.resolve(MODULE)];
    require(MODULE); // модуль сам вызывает boot() при загрузке в окне

    return {
        root: root, navbar: navbar, body: body, calls: calls, store: store,
        // Скрипт пульта подключается только через document.body.
        appScript: function() {
            return body.childNodes.filter(function(n) { return n.tagName === 'SCRIPT'; })[0] || null;
        },
        text: function() { return root.textContent; },
        posts: function() { return calls.filter(function(c) { return c.init && c.init.method === 'POST'; }); }
    };
}

var PAD_TABLE = {
    id: '673803', up: '0', type: '3', val: 'Планшет', unique: '1',
    granted: 'WRITE', export: '1', delete: '1',
    reqs: [{ num: 1, id: '673807', val: 'Наименование', orig: '673806', type: '3' }]
};
function metadata(granted) {
    var table = JSON.parse(JSON.stringify(PAD_TABLE));
    if (granted) table.granted = granted; else delete table.granted;
    return [{ id: '1078', val: 'Задание в производство', granted: 'WRITE', reqs: [] }, table];
}
// Промисы сторожа разрешаются в микрозадачах; даём им завершиться.
function settled() {
    return new Promise(function(r) { setImmediate(function() { setImmediate(r); }); });
}

(async function() {
    // 1) Планшет зарегистрирован → пульт грузится, имя в шапке.
    var s = scene({
        token: 'a1b2c3d4e5f6a7b8',
        reply: function(url) {
            if (url.indexOf('metadata') >= 0) return { body: metadata('WRITE') };
            return { body: [{ i: '673900', r: ['a1b2c3d4e5f6a7b8', 'Планшет слиттера №1'] }] };
        }
    });
    await settled();
    assert(!!s.appScript(), 'зарегистрированный планшет: скрипт пульта подключён');
    assertEqual(s.appScript().src, '/download/ateh/js/slitter.js?122.11', 'подключён именно скрипт из data-pad-app');
    assertEqual(s.navbar.textContent, 'Планшет слиттера №1', 'имя планшета показано в .navbar-workspace');
    assert(s.calls[1].url.indexOf('F_673803=a1b2c3d4e5f6a7b8') >= 0, 'поиск идёт фильтром по первой колонке');
    assert(s.calls[1].url.indexOf('/ateh/object/673803/') >= 0, 'запрос уходит в таблицу «Планшет» текущей базы');

    // 2) Токена нет вовсе → пульт не грузится.
    s = scene({
        token: '',
        reply: function() { return { body: metadata('WRITE') }; }
    });
    await settled();
    assert(!s.appScript(), 'без токена: скрипт пульта НЕ подключён');
    assert(s.text().indexOf('Устройство не зарегистрировано') >= 0, 'без токена: показан отказ');
    assertEqual(s.calls.length, 1, 'без токена запись не ищем — хватает метаданных');
    assertEqual(s.navbar.textContent, 'slitter', 'без регистрации шапку не трогаем');

    // 3) Токен есть, записи нет → пульт не грузится.
    s = scene({
        token: 'a1b2c3d4e5f6a7b8',
        reply: function(url) {
            if (url.indexOf('metadata') >= 0) return { body: metadata('WRITE') };
            return { body: [] };
        }
    });
    await settled();
    assert(!s.appScript(), 'чужой токен: скрипт пульта НЕ подключён');
    assert(s.text().indexOf('Устройство не зарегистрировано') >= 0, 'чужой токен: показан отказ');
    assert(!!s.root.querySelector('.atex-pad-btn'), 'с правом WRITE предложена регистрация');
    assert(!!s.root.querySelector('.atex-pad-input'), 'с правом WRITE есть поле имени');

    // 4) Без права записи кнопки регистрации нет.
    s = scene({
        token: '',
        reply: function() { return { body: metadata('READ') }; }
    });
    await settled();
    assert(!s.appScript(), 'без права записи: скрипт пульта НЕ подключён');
    assert(!s.root.querySelector('.atex-pad-btn'), 'без права записи кнопка регистрации не предлагается');

    // 4а) Гранта нет вовсе, но это владелец базы — сервер пускает его в обход
    // грантов, значит и регистрировать он может.
    s = scene({
        token: '', user: 'ateh',
        reply: function() { return { body: metadata('') }; }
    });
    await settled();
    assert(!s.appScript(), 'владелец базы без регистрации пульт тоже не получает');
    assert(!!s.root.querySelector('.atex-pad-btn'), 'владельцу базы регистрация предложена без granted');

    // 5) Таблицы «Планшет» в базе нет → пульт не грузится, причина названа.
    s = scene({
        token: 'a1b2c3d4e5f6a7b8',
        reply: function() { return { body: [{ id: '1078', val: 'Задание в производство', reqs: [] }] }; }
    });
    await settled();
    assert(!s.appScript(), 'нет таблицы: скрипт пульта НЕ подключён');
    assert(s.text().indexOf('нет таблицы') >= 0, 'нет таблицы: причина названа прямо');

    // 6) Нет доступа к таблице (403) → пульт не грузится, текст сервера показан.
    s = scene({
        token: 'a1b2c3d4e5f6a7b8',
        reply: function(url) {
            if (url.indexOf('metadata') >= 0) return { body: metadata('') };
            return { ok: false, status: 403, body: [{ error: 'У вас нет доступа к объектам этого типа' }] };
        }
    });
    await settled();
    assert(!s.appScript(), 'отказ сервера: скрипт пульта НЕ подключён');
    assert(s.text().indexOf('нет доступа') >= 0, 'отказ сервера показан пользователю дословно');

    // 7) Регистрация планшета.
    s = scene({
        token: '',
        reply: function(url, init) {
            if (url.indexOf('metadata') >= 0) return { body: metadata('WRITE') };
            if (init && init.method === 'POST') return { body: { obj: '673901' } };
            return { body: [] };
        }
    });
    await settled();
    var input = s.root.querySelector('.atex-pad-input');
    var button = s.root.querySelector('.atex-pad-btn');

    // 7a) Пустое имя — ошибка на месте, без запроса.
    button.click();
    await settled();
    assertEqual(s.posts().length, 0, 'пустое имя: запрос не отправляется');
    assert(s.root.querySelector('.atex-pad-error').textContent.indexOf('название') >= 0, 'пустое имя: сказано, чего не хватает');

    // 7b) Имя введено — планшет регистрируется.
    input.value = '  Планшет слиттера №2  ';
    button.click();
    await settled();
    var post = s.posts()[0];
    assert(!!post, 'имя введено: запрос на создание отправлен');
    assert(post.url.indexOf('/ateh/_m_new/673803?JSON&up=1') >= 0, 'запись создаётся в таблице «Планшет»');
    var body = new URLSearchParams(post.init.body);
    assertEqual(body.get('_xsrf'), 'XSRF-TOKEN', 'POST несёт XSRF-токен');
    assertEqual(body.get('t673807'), 'Планшет слиттера №2', 'имя уходит в «Наименование» без лишних пробелов');
    assert(/^[a-f0-9]{32}$/.test(body.get('t673803')), 'в первую колонку уходит случайный hex-токен');
    assertEqual(s.store.data.atehPad, body.get('t673803'), 'тот же токен сохранён в localStorage под atehPad');
    assert(s.calls.some(function(c) { return c.reload; }), 'после регистрации страница перезагружается');
    assert(!s.appScript(), 'до перезагрузки пульт всё ещё не подключён');

    console.log('\n' + passed + ' assertions passed');
})();
