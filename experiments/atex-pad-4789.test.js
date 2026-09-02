// #4789 — планшет настраивается на рабочее место оператора, и оператор попадает в него
// прямо с логина.
//
// Что проверяем:
//   • разбор новых колонок таблицы «Планшет» («Слиттер», «Втулкорез», «Упаковочное место»,
//     «Рабочее место») и решение «куда открывать планшет» (padWorkspace);
//   • сведение объекта настройки со справочником пульта (matchPadObject): ссылкой и текстом;
//   • код устройства (ensureToken): показать можно и до регистрации, повторный вызов не
//     меняет уже показанный код;
//   • pad-home: роль планшета с КОРНЯ базы уходит в своё рабочее место, внутренние
//     страницы редиректом не перебиваются, ненастроенный планшет получает экран с кодом;
//   • templates/atex/main.html грузит pad-home.js только для роли планшета и только с корня,
//     а редирект «единственного пункта меню» (#4690) роли планшета не перебивает.
//
// Run with: node experiments/atex-pad-4789.test.js

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; return; }
    console.log('  expected:', JSON.stringify(expected));
    console.log('  actual:  ', JSON.stringify(actual));
    process.exitCode = 1;
}

var guard = require('../download/atex/js/pad-guard.js');
var home = require('../download/atex/js/pad-home.js');

// Таблица «Планшет» с колонками настройки (порядок реквизитов = порядок колонок строки).
var TABLE = { id: '673803', val: 'Планшет', granted: 'WRITE', reqs: [
    { id: '673807', val: 'Наименование' },
    { id: '673810', val: 'Слиттер' },
    { id: '673811', val: 'Втулкорез' },
    { id: '673812', val: 'Упаковочное место' },
    { id: '673813', val: 'Рабочее место' }
]};
// Строки — как в выгрузке заказчика (Планшет_2026-08-18.xlsx): ссылки приходят «id:Подпись».
function row(cols) { return { i: '900', r: cols }; }
var TOKEN = 'dc8b920daba7af5fb5065cf81abebb59';

// ── разбор настройки ────────────────────────────────────────────────────────────────────────
(function() {
    var pad = guard.padFromRows([row([TOKEN, 'MC', '1277:Станок 3', '', '', ''])], TOKEN, 1, TABLE);
    assertEqual(pad.config.slitter, { id: '1277', label: 'Станок 3' },
        '#4789: ссылка «id:Подпись» разбирается в объект настройки');
    assertEqual([pad.config.cutter, pad.config.place, pad.config.workspace], [null, null, ''],
        '#4789: незаполненные колонки — пусто, а не мусор');
    assertEqual(guard.padWorkspace(pad),
        { ok: true, action: 'slitter', kind: 'slitter', object: { id: '1277', label: 'Станок 3' }, reason: '' },
        '#4789: заполнен станок → планшет открывает пульт слиттера с этим станком');

    var cutter = guard.padFromRows([row([TOKEN, 'Test', '', 'TC-20', '', ''])], TOKEN, 1, TABLE);
    assertEqual(guard.padWorkspace(cutter).action, 'sleeve-cutter',
        '#4789: заполнен втулкорез → пульт втулкореза');
    assertEqual(cutter.config.cutter, { id: '', label: 'TC-20' },
        '#4789: объект текстом (без id) остаётся названием — пульт сведёт его по справочнику');

    var place = guard.padFromRows([row([TOKEN, 'Fold5', '', '', '1', ''])], TOKEN, 1, TABLE);
    assertEqual(guard.padWorkspace(place).action, 'packer',
        '#4789: заполнено упаковочное место → упаковка');

    // Пусто — планшет не настроен; заполнено несколько — выбор неоднозначен.
    var empty = guard.padFromRows([row([TOKEN, 'Станок 1', '', '', '', ''])], TOKEN, 1, TABLE);
    assertEqual(guard.padWorkspace(empty), { ok: false, action: '', kind: '', object: null, reason: 'none' },
        '#4789: ни одного объекта → «рабочее место не настроено»');
    var many = guard.padFromRows([row([TOKEN, 'MC', '1277:Станок 3', 'TC-20', '', ''])], TOKEN, 1, TABLE);
    assertEqual(guard.padWorkspace(many).reason, 'ambiguous',
        '#4789: два объекта сразу → выбор неоднозначен, ведём на экран настройки');

    // Колонка «Рабочее место» решает спор и работает без объекта.
    var named = guard.padFromRows([row([TOKEN, 'MC', '1277:Станок 3', 'TC-20', '', 'packer'])], TOKEN, 1, TABLE);
    assertEqual([named.config.workspace, guard.padWorkspace(named).action, guard.padWorkspace(named).object],
        ['packer', 'packer', null],
        '#4789: названное «Рабочее место» сильнее набора объектов (объекта у него может и не быть)');
    assertEqual(guard.normalizeWorkspace('Втулкорез'), 'sleeve-cutter',
        '#4789: «Рабочее место» понимается и по-русски');
    assertEqual(guard.normalizeWorkspace('какое-то'), '',
        '#4789: незнакомое слово в «Рабочем месте» — не рабочее место (решают объекты)');
})();

// ── сведение объекта со справочником пульта ─────────────────────────────────────────────────
(function() {
    var options = [{ id: '1277', label: 'Станок 1' }, { id: '1279', label: 'Станок 3' }];
    assertEqual(guard.matchPadObject(options, { id: '1279', label: 'Станок 3' }), '1279',
        '#4789: объект-ссылка сводится по id');
    assertEqual(guard.matchPadObject(options, { id: '', label: ' станок 3 ' }), '1279',
        '#4789: объект-текст сводится по названию (регистр и пробелы неважны)');
    assertEqual(guard.matchPadObject(options, { id: '', label: 'Станок 9' }), '',
        '#4789: чужого объекта в справочнике нет → пусто, свой выбор пульт не подменяет');
    assertEqual(guard.matchPadObject([], { id: '1279', label: '' }), '',
        '#4789: справочник ещё не загружен → пусто');
})();

// ── код устройства ──────────────────────────────────────────────────────────────────────────
(function() {
    var store = (function() {
        var data = {};
        return { getItem: function(k) { return data[k] == null ? null : data[k]; },
                 setItem: function(k, v) { data[k] = String(v); },
                 removeItem: function(k) { delete data[k]; } };
    })();
    var cryptoStub = { getRandomValues: function(arr) { for (var i = 0; i < arr.length; i++) arr[i] = i; return arr; } };
    var first = guard.ensureToken(store, cryptoStub);
    assert(guard.isToken(first) && first.length === 32, '#4789: код устройства генерируется (32 hex)');
    assertEqual(store.getItem('atehPad'), first, '#4789: показанный код тут же запоминается в localStorage');
    assertEqual(guard.ensureToken(store, cryptoStub), first,
        '#4789: повторный показ даёт ТОТ ЖЕ код — иначе записанный диспетчером код перестал бы работать');
    assertEqual(guard.ensureToken(store, null), first, '#4789: готовому коду генератор не нужен');
    var noCrypto = { getItem: function() { return null; }, setItem: function() {}, removeItem: function() {} };
    assertEqual(guard.ensureToken(noCrypto, null), '',
        '#4789: без crypto код не выдумываем — экран скажет, что кода нет');
})();

// ── pad-home: кого и откуда уводим ──────────────────────────────────────────────────────────
(function() {
    assertEqual(home.parseRoles('1621, 1622;1623'), ['1621', '1622', '1623'],
        '#4789: список ролей планшета читается через запятую/пробел');
    // #4852: роль планшета уводим в её пульт с ЛЮБОЙ страницы базы — оператору нельзя
    // быть нигде, кроме своего рабочего места. Цикл «уже на месте» гасит boot.
    assert(home.shouldRedirect({ action: '', roleId: '1621', roles: ['1621'] }),
        '#4789/#4852: роль планшета на корне базы — уводим в её рабочее место');
    assert(home.shouldRedirect({ action: 'object', roleId: '1621', roles: ['1621'] }),
        '#4852: роль планшета на внутренней странице — тоже уводим в её пульт');
    assert(!home.shouldRedirect({ action: '', roleId: '2', roles: ['1621'] }),
        '#4789: другая роль (диспетчер) ходит по базе как раньше');
    assertEqual(home.workspaceUrl('ateh', 'sleeve-cutter'), '/ateh/sleeve-cutter',
        '#4789: адрес рабочего места планшета');
    assert(home.reasonText('ambiguous').indexOf('несколько') >= 0 &&
           home.reasonText('none').indexOf('не заполнены') >= 0 &&
           home.reasonText('no-pad').indexOf('Планшет') >= 0,
        '#4789: экран объясняет, чего именно не хватает');
})();

// ── boot pad-home на заглушках DOM ──────────────────────────────────────────────────────────
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = [];
    this.attributes = {};
    this._text = '';
    this.id = '';
}
Object.defineProperty(StubNode.prototype, 'textContent', {
    get: function() { if (this.childNodes.length) return this.childNodes.map(function(c) { return c.textContent; }).join(' '); return this._text; },
    set: function(v) { this._text = String(v == null ? '' : v); this.childNodes = []; }
});
StubNode.prototype.appendChild = function(n) { this.childNodes.push(n); n.parentNode = this; return n; };
StubNode.prototype.removeChild = function(n) {
    this.childNodes = this.childNodes.filter(function(c) { return c !== n; }); n.parentNode = null; return n;
};
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); if (k === 'id') this.id = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };

function makeEnv(opts) {
    var o = opts || {};
    var body = new StubNode('body');
    var head = new StubNode('head');
    var byId = {};
    var doc = {
        body: body, head: head,
        createElement: function(tag) { return new StubNode(tag); },
        getElementById: function(id) { return byId[id] || null; },
        querySelector: function() { return null; }
    };
    // Регистрируем узлы по id, как это делает браузер после вставки.
    var origAppend = StubNode.prototype.appendChild;
    body.appendChild = head.appendChild = function(n) { if (n.id) byId[n.id] = n; return origAppend.call(this, n); };
    var replaced = [];
    var env = {
        document: doc,
        localStorage: (function() {
            var data = o.token ? { atehPad: o.token } : {};
            return { getItem: function(k) { return data[k] == null ? null : data[k]; },
                     setItem: function(k, v) { data[k] = String(v); },
                     removeItem: function(k) { delete data[k]; } };
        })(),
        crypto: { getRandomValues: function(arr) { for (var i = 0; i < arr.length; i++) arr[i] = 7; return arr; } },
        location: { replace: function(url) { replaced.push(url); } },
        console: { warn: function() {} },
        AtexPadGuard: guard,
        fetch: function(url) {
            var payload = /metadata/.test(url) ? [TABLE] : (o.rows || []);
            return Promise.resolve({ ok: true, status: 200, text: function() { return Promise.resolve(JSON.stringify(payload)); } });
        },
        replaced: replaced,
        screenText: function() { var n = doc.getElementById('atex-pad-home'); return n ? n.textContent : ''; }
    };
    return env;
}

function bootHome(env, attrs) {
    var script = new StubNode('script');
    Object.keys(attrs).forEach(function(k) { script.setAttribute(k, attrs[k]); });
    // Модуль читает root.document/localStorage/fetch — подсовываем окружение целиком.
    var api = require('../download/atex/js/pad-home.js');
    var factoryEnv = env;
    // pad-home.js уже загружен с реальным root; поэтому дергаем boot через новый экземпляр
    // модуля с подменённым глобальным объектом.
    delete require.cache[require.resolve('../download/atex/js/pad-home.js')];
    var saved = { window: global.window, document: global.document, localStorage: global.localStorage };
    global.window = factoryEnv;
    factoryEnv.document.currentScript = null;
    var fresh = require('../download/atex/js/pad-home.js');
    fresh.boot(script);
    global.window = saved.window;
    delete require.cache[require.resolve('../download/atex/js/pad-home.js')];
    return api;
}

function flush() { return new Promise(function(r) { setTimeout(r, 0); }); }

var pending = [];

// настроенный планшет — уводим в его рабочее место
(function() {
    var env = makeEnv({ token: TOKEN, rows: [row([TOKEN, 'MC', '1277:Станок 3', '', '', ''])] });
    bootHome(env, { 'data-pad-roles': '1621', 'data-pad-db': 'ateh', 'data-pad-action': '', 'data-pad-role-id': '1621',
        'data-pad-css': '/download/ateh/css/atex-brand.css?1.2' });
    pending.push(flush().then(flush).then(function() {
        assertEqual(env.replaced, ['/ateh/slitter'],
            '#4789: настроенный планшет с логина открывает свой пульт');
    }));
})();

// планшета нет в таблице — экран с кодом устройства
(function() {
    var env = makeEnv({ token: TOKEN, rows: [] });
    bootHome(env, { 'data-pad-roles': '1621', 'data-pad-db': 'ateh', 'data-pad-action': '', 'data-pad-role-id': '1621' });
    pending.push(flush().then(flush).then(function() {
        var screen = env.screenText();   // это НАРИСОВАННЫЙ экран, а не текст исходника
        assert(env.replaced.length === 0 && screen.indexOf('не настроено') >= 0,
            '#4789: незнакомого планшета никуда не уводим — показываем «рабочее место не настроено»');
        assert(screen.indexOf(TOKEN) >= 0,
            '#4789: на экране виден код устройства для первой колонки «Планшета»');
    }));
})();

// планшет есть, но объектов нет — та же настройка, но с именем планшета
(function() {
    var env = makeEnv({ token: TOKEN, rows: [row([TOKEN, 'Станок 1', '', '', '', ''])] });
    bootHome(env, { 'data-pad-roles': '1621', 'data-pad-db': 'ateh', 'data-pad-action': '', 'data-pad-role-id': '1621' });
    pending.push(flush().then(flush).then(function() {
        var screen = env.screenText();
        assert(env.replaced.length === 0 && screen.indexOf('Станок 1') >= 0 && screen.indexOf('не заполнены') >= 0,
            '#4789: планшет без объекта — экран называет планшет и говорит, чего не хватает');
    }));
})();

// чужая роль — pad-home молчит
(function() {
    var env = makeEnv({ token: TOKEN, rows: [row([TOKEN, 'MC', '1277:Станок 3', '', '', ''])] });
    bootHome(env, { 'data-pad-roles': '1621', 'data-pad-db': 'ateh', 'data-pad-action': '', 'data-pad-role-id': '7' });
    pending.push(flush().then(flush).then(function() {
        assert(env.replaced.length === 0 && env.screenText() === '',
            '#4789: диспетчеру на корне ничего не показываем и никуда не уводим');
    }));
})();

// ── шаблон: ИСПОЛНЯЕМ head-скрипты main.html на заглушках (как в issue-4690-single-menu) ────
// Проверяем не текст шаблона, а что он делает: кому и когда грузятся скрипты планшета и
// перебивает ли редирект «единственного пункта меню» правило планшета.
var BLOCK_RE = /<!-- Begin: MyRoleMenu -->([\s\S]*?)<!-- End: MyRoleMenu -->/;

function renderTemplate(globals, menuRows) {
    var tpl = fs.readFileSync(path.join(ROOT, 'templates/atex/main.html'), 'utf8');
    var block = tpl.match(BLOCK_RE);
    var rows = menuRows.map(function(r) {
        return block[1].replace(/\{(\w+)\}/g, function(all, key) { return r[key] !== undefined ? r[key] : ''; });
    }).join('');
    return tpl.replace(BLOCK_RE, rows).replace(/\{_global_\.(\w+)\}/g, function(all, key) {
        return globals[key] !== undefined ? globals[key] : '';
    });
}

function runHead(opts) {
    var rendered = renderTemplate({
        z: 'ateh', xsrf: 'x', id: '', token: 't', user_id: '1', user: 'u',
        role: 'Оператор', role_id: opts.roleId, action: opts.action, version: '7',
        grants: Buffer.from('[]').toString('base64')
    }, opts.menu || []);
    var head = rendered.slice(0, rendered.indexOf('</head>'));
    var scripts = [];
    var re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    var m;
    while ((m = re.exec(head)) !== null) scripts.push(m[1]);
    var appended = [];
    function makeNode() {
        var node = { attrs: {}, setAttribute: function(k, v) { node.attrs[k] = String(v); },
            appendChild: function() {}, style: { setProperty: function() {}, removeProperty: function() {} },
            classList: { add: function() {}, remove: function() {}, toggle: function() {} }, children: [] };
        return node;
    }
    var doc = {
        cookie: '', body: null,
        documentElement: { style: { setProperty: function() {}, removeProperty: function() {} },
            classList: { add: function() {}, remove: function() {} } },
        head: { appendChild: function(node) { appended.push(node); return node; } },
        createElement: makeNode,
        addEventListener: function() {}, getElementById: function() { return null; },
        querySelectorAll: function() { return []; }
    };
    var navigated = [];
    var loc = { pathname: opts.pathname, replace: function(u) { navigated.push(u); } };
    var store = { getItem: function() { return null; }, setItem: function() {} };
    new Function('document', 'window', 'localStorage', 'location', scripts.join('\n;\n'))
        (doc, {}, store, loc);
    return { appended: appended, navigated: navigated };
}

var PAD_MENU = [{ menu_id: '10', menu_up: '', name: 'Пульт слиттера', href: 'slitter', icon: '', expanded: '' }];

(function() {
    // Роль планшета на корне: грузится сторож, а pad-home — уже из его onload.
    var pad = runHead({ roleId: '1621', action: '', pathname: '/ateh', menu: PAD_MENU });
    var guardNode = pad.appended.filter(function(n) { return /pad-guard\.js/.test(n.src || ''); })[0];
    assert(!!guardNode, '#4789: роль планшета на корне грузит сторож планшета');
    assert(pad.appended.every(function(n) { return !/pad-home\.js/.test(n.src || ''); }),
        '#4789: pad-home.js не грузится, пока сторож не загрузился — он пользуется его разбором');
    assertEqual(pad.navigated, [],
        '#4690/#4789: редирект «единственного пункта меню» роль планшета не перебивает');
    if (guardNode && typeof guardNode.onload === 'function') guardNode.onload();
    var homeNode = pad.appended.filter(function(n) { return /pad-home\.js/.test(n.src || ''); })[0];
    assert(!!homeNode, '#4789: сторож загрузился → грузится pad-home.js');
    assertEqual(homeNode && homeNode.attrs['data-pad-roles'], '1621',
        '#4789: список ролей планшета уходит в pad-home атрибутом');
    assert(homeNode && homeNode.attrs['data-pad-db'] === 'ateh' && homeNode.attrs['data-pad-action'] === '',
        '#4789: база и страница тоже передаются атрибутами');
    assert(homeNode && /atex-brand\.css\?7\.\d+/.test(homeNode.attrs['data-pad-css'] || ''),
        '#4789: адрес стилей экрана — с версией (на корне базы atex-brand.css не подключён)');

    // #4852: роль планшета и на ВНУТРЕННЕЙ странице грузит скрипты планшета — оператору
    // нельзя быть нигде, кроме своего пульта: pad-home уведёт его в настроенное рабочее
    // место (или покажет экран конфигурации с кодом устройства).
    var inside = runHead({ roleId: '1621', action: 'slitter', pathname: '/ateh/slitter', menu: PAD_MENU });
    assert(inside.appended.some(function(n) { return /pad-guard\.js/.test(n.src || ''); }),
        '#4852: внутри рабочего места роль планшета тоже грузит сторож — уводим в свой пульт');

    // Другая роль — прежнее поведение: скриптов планшета нет, редирект #4690 работает.
    var dispatcher = runHead({ roleId: '2', action: '', pathname: '/ateh', menu: PAD_MENU });
    assert(dispatcher.appended.every(function(n) { return !/pad-(guard|home)\.js/.test(n.src || ''); }),
        '#4789: диспетчеру скрипты планшета не грузятся');
    assertEqual(dispatcher.navigated, ['/ateh/slitter'],
        '#4690: у обычной роли единственный пункт меню по-прежнему уводит с корня в него');
})();

Promise.all(pending).then(function() {
    console.log('\n' + passed + '/' + total + ' assertions passed');
    if (passed !== total) process.exitCode = 1;
});
