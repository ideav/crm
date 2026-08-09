// Счётчик времени активности в пультах оператора atex (ideav/crm#4682).
//
// Требование задачи: человек зашёл в пульт слиттера, втулкореза или упаковки —
// включается счётчик; через 3 часа БЕЗ ДЕЙСТВИЙ кука с токеном удаляется, и
// человек уезжает на форму входа.
//
// Проверяем:
//   1) чистый слой — срок по умолчанию, ключ хранилища, адрес формы входа,
//      строки удаления кук, разбор атрибута `data-idle-minutes`;
//   2) ядро счётчика — сброс по действию, срабатывание ровно на сроке, один
//      выход на все тики, общий отсчёт между вкладками;
//   3) загрузка в окне — действия сбрасывают счётчик, по сроку удаляются куки и
//      идёт переход на `/start.html`, ключ хранилища при этом СНИМАЕТСЯ (иначе
//      повторный вход тут же выкидывало бы обратно), протухший отсчёт выкидывает
//      сразу при открытии;
//   4) шаблоны всех трёх пультов подключают модуль с версией ресурса.
//
// Run with: node experiments/atex-idle-logout.test.js

var fs = require('fs');
var path = require('path');
var MODULE = path.join(__dirname, '..', 'download', 'atex', 'js', 'idle-logout.js');

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

var idle = require(MODULE);

var HOUR = 60 * 60 * 1000;

// ── 1. Чистый слой ──

assertEqual(idle.IDLE_MS, 3 * HOUR, 'срок бездействия по умолчанию — 3 часа');
assertEqual(idle.storageKey('ateh'), 'atehIdle_ateh', 'ключ отсчёта привязан к базе');
assert(idle.storageKey('ateh') !== idle.storageKey('atex'), 'у разных баз отсчёт разный');

assertEqual(idle.logoutUrl('ateh', 'operator'), '/start.html?db=ateh&u=operator',
    'выход ведёт на форму входа с базой и именем');
assertEqual(idle.logoutUrl('ateh', ''), '/start.html?db=ateh', 'без имени — только база');

assertEqual(idle.cookieClearStrings('ateh'), [
    'idb_ateh=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/',
    'ateh=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/'
], 'снимаются те же куки, что и кнопкой «Выйти»');

assertEqual(idle.idleMsFromAttr(null), 3 * HOUR, 'атрибута нет — 3 часа');
assertEqual(idle.idleMsFromAttr(''), 3 * HOUR, 'пустой атрибут — 3 часа');
assertEqual(idle.idleMsFromAttr('abc'), 3 * HOUR, 'не число — 3 часа');
assertEqual(idle.idleMsFromAttr('0'), 3 * HOUR, 'ноль — 3 часа');
assertEqual(idle.idleMsFromAttr('-5'), 3 * HOUR, 'отрицательное — 3 часа');
assertEqual(idle.idleMsFromAttr('30'), 30 * 60 * 1000, '30 минут — для приёмки, ждать 3 часа не нужно');
assertEqual(idle.idleMsFromAttr('9999'), 3 * HOUR, 'дольше 3 часов выставить нельзя');

// ── 2. Ядро счётчика ──

function memStore() {
    return {
        data: {},
        getItem: function(k) { return this.data[k] == null ? null : this.data[k]; },
        setItem: function(k, v) { this.data[k] = String(v); },
        removeItem: function(k) { delete this.data[k]; }
    };
}

function watchAt(t0, opts) {
    opts = opts || {};
    var out = { fired: 0 };
    out.store = opts.store || memStore();
    out.watch = idle.createWatch({
        idleMs: opts.idleMs || 3 * HOUR,
        storage: out.store,
        key: 'atehIdle_ateh',
        onExpire: function() { out.fired++; }
    });
    out.watch.touch(t0);
    return out;
}

var T0 = 1754700000000;   // произвольная точка отсчёта, часовой пояс роли не играет

var w = watchAt(T0);
assertEqual(w.watch.check(T0 + 3 * HOUR - 1), false, 'за минуту до срока выхода нет');
assertEqual(w.fired, 0, 'до срока выход не звался');
assertEqual(w.watch.check(T0 + 3 * HOUR), true, 'ровно на сроке — выход');
assertEqual(w.fired, 1, 'выход сработал');
w.watch.check(T0 + 4 * HOUR);
assertEqual(w.fired, 1, 'выход зовётся ОДИН раз, сколько бы тиков ни прошло');

w = watchAt(T0);
w.watch.touch(T0 + 2 * HOUR);                     // действие человека
assertEqual(w.watch.check(T0 + 4 * HOUR), false, 'действие сбрасывает счётчик');
assertEqual(w.watch.check(T0 + 5 * HOUR), true, 'от последнего действия срок снова 3 часа');

// Отсчёт общий: работа во второй вкладке пульта не даёт выкинуть из первой.
var shared = memStore();
var a = watchAt(T0, { store: shared });
var b = watchAt(T0, { store: shared });
b.watch.touch(T0 + 2 * HOUR);
assertEqual(a.watch.check(T0 + 4 * HOUR), false, 'действие в соседней вкладке продлевает обе');
assertEqual(a.fired, 0, 'соседняя вкладка не даёт выкинуть');

// Отсчёт переживает перезагрузку страницы: новый счётчик поднимает запись из хранилища.
var stale = memStore();
stale.data['atehIdle_ateh'] = String(T0);
var fresh = idle.createWatch({
    idleMs: 3 * HOUR, storage: stale, key: 'atehIdle_ateh', onExpire: function() {}
});
assertEqual(fresh.lastActivity(), T0, 'счётчик читает запись прошлой сессии страницы');

// Приватный режим: хранилище швыряется — счётчик работает в памяти и не падает.
var angry = {
    getItem: function() { throw new Error('denied'); },
    setItem: function() { throw new Error('denied'); },
    removeItem: function() { throw new Error('denied'); }
};
var mem = idle.createWatch({ idleMs: 3 * HOUR, storage: angry, key: 'k', onExpire: function() {} });
mem.touch(T0);
assertEqual(mem.check(T0 + HOUR), false, 'недоступное хранилище: счётчик считает в памяти');
assertEqual(mem.check(T0 + 3 * HOUR), true, 'недоступное хранилище: срок всё равно наступает');

// Данные сайта запрещены — обращение к localStorage бросает ещё до getItem, счётчику
// достаётся null.
var none = idle.createWatch({ idleMs: 3 * HOUR, storage: null, key: 'k', onExpire: function() {} });
assertEqual(none.check(T0), false, 'хранилища нет вовсе: до первого действия выхода нет');
none.touch(T0);
assertEqual(none.check(T0 + 3 * HOUR), true, 'хранилища нет вовсе: срок наступает');

// ── 3. Загрузка в окне ──

function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.attributes = {};
}
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };

function scene(opts) {
    opts = opts || {};
    var clock = { t: opts.start == null ? T0 : opts.start };

    var root = new StubNode('div');
    root.setAttribute('data-db', 'ateh');
    root.setAttribute('data-user', 'operator');
    if (opts.minutes) root.setAttribute('data-idle-minutes', opts.minutes);

    var currentScript = new StubNode('script');
    currentScript.setAttribute('data-idle-root', 'atex-slitter');

    var handlers = {};
    var cookies = [];
    var ticks = [];
    var store = opts.store || memStore();
    var navigated = [];

    var win = {
        document: {
            currentScript: currentScript,
            getElementById: function(id) { return id === 'atex-slitter' ? root : null; },
            addEventListener: function(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
            removeEventListener: function(type, fn) {
                handlers[type] = (handlers[type] || []).filter(function(f) { return f !== fn; });
            }
        },
        localStorage: store,
        location: { replace: function(url) { navigated.push(url); } },
        Date: { now: function() { return clock.t; } },
        URLSearchParams: URLSearchParams,
        setInterval: function(fn) { ticks.push(fn); return ticks.length; },
        clearInterval: function() {}
    };
    Object.defineProperty(win.document, 'cookie', {
        set: function(v) { cookies.push(v); },
        get: function() { return ''; }
    });

    global.window = win;
    delete require.cache[require.resolve(MODULE)];
    require(MODULE);   // модуль сам вызывает boot() при загрузке в окне

    return {
        win: win, store: store, cookies: cookies, navigated: navigated,
        // Сдвинуть часы и прогнать все тики счётчика — так же, как это делает setInterval.
        advance: function(ms) {
            clock.t += ms;
            ticks.forEach(function(fn) { fn(); });
        },
        // Действие человека: любое из событий, на которые подписан модуль.
        act: function(type) {
            (handlers[type] || []).forEach(function(fn) { fn({}); });
        },
        handlers: handlers
    };
}

var s = scene();
idle.ACTIVITY_EVENTS.forEach(function(type) {
    assert((s.handlers[type] || []).length === 1, 'подписка на действие «' + type + '»');
});
assertEqual(s.store.data['atehIdle_ateh'], String(T0), 'вход в пульт включает счётчик');

s.advance(3 * HOUR - 60 * 1000);
assertEqual(s.navigated, [], 'за минуту до срока пульт работает');
assertEqual(s.cookies, [], 'за минуту до срока куки на месте');

s.act('touchstart');
s.advance(3 * HOUR - 60 * 1000);
assertEqual(s.navigated, [], 'касание экрана продлило сессию ещё на 3 часа');

s.advance(2 * 60 * 1000);
assertEqual(s.cookies, [
    'idb_ateh=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/',
    'ateh=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/'
], '3 часа без действий — кука с токеном удалена');
assertEqual(s.navigated, ['/start.html?db=ateh&u=operator'], 'человек отправлен на форму входа');
assertEqual(s.store.data['atehIdle_ateh'], undefined,
    'отсчёт снят: после нового входа пульт не выкидывает сразу');

s.advance(3 * HOUR);
assertEqual(s.navigated.length, 1, 'после выхода счётчик остановлен — второго перехода нет');

// Действие после выхода уже ничего не пишет: пульт покинут.
s.act('keydown');
assertEqual(s.store.data['atehIdle_ateh'], undefined, 'после выхода счётчик не воскресает');

// Пульт открыт заново, а в хранилище лежит отсчёт четырёхчасовой давности —
// значит бездействие уже случилось, вход недействителен.
var old = memStore();
old.data['atehIdle_ateh'] = String(T0 - 4 * HOUR);
var s2 = scene({ store: old });
assertEqual(s2.navigated, ['/start.html?db=ateh&u=operator'],
    'протухший отсчёт выкидывает сразу при открытии пульта');
assertEqual(s2.store.data['atehIdle_ateh'], undefined, 'протухший отсчёт снят');

// Атрибут срока — для приёмки: 30 минут вместо трёх часов.
var s3 = scene({ minutes: '30' });
s3.advance(29 * 60 * 1000);
assertEqual(s3.navigated, [], 'с data-idle-minutes=30 до срока пульт работает');
s3.advance(2 * 60 * 1000);
assertEqual(s3.navigated, ['/start.html?db=ateh&u=operator'], 'с data-idle-minutes=30 выход через 30 минут');

// Адрес формы входа берётся у оболочки, если она загружена: один источник истины.
global.MainAppController = {
    getLogoutStartUrl: function(db, user) { return '/start.html?db=' + db + '&u=' + user + '&via=shell'; },
    deleteCurrentDbCookies: function(db) { global.window.document.cookie = 'shell_' + db; }
};
var s4 = scene();
s4.advance(3 * HOUR);
assertEqual(s4.cookies, ['shell_ateh'], 'куки снимает оболочка, если она загружена');
assertEqual(s4.navigated, ['/start.html?db=ateh&u=operator&via=shell'], 'адрес входа берётся у оболочки');
delete global.MainAppController;

delete global.window;

// ── 4. Подключение в шаблонах ──

[
    { file: 'templates/atex/slitter.html', root: 'atex-slitter' },
    { file: 'templates/atex/sleeve-cutter.html', root: 'atex-sleeve-cutter' },
    { file: 'templates/atex/packer.html', root: 'atex-packer' }
].forEach(function(tpl) {
    var html = fs.readFileSync(path.join(__dirname, '..', tpl.file), 'utf8');
    var tag = (html.match(/<script[^>]*idle-logout\.js[^>]*>/) || [])[0] || '';
    assert(!!tag, tpl.file + ': счётчик активности подключён');
    assert(/idle-logout\.js\?\{_global_\.version\}\.\d+/.test(tag), tpl.file + ': у ресурса есть версия');
    assert(tag.indexOf('data-idle-root="' + tpl.root + '"') >= 0, tpl.file + ': счётчик привязан к корню пульта');
    assert(tag.indexOf('data-idle-minutes') < 0, tpl.file + ': на бою срок не переопределён — 3 часа');
});

console.log('\n' + passed + ' проверок прошло' + (process.exitCode ? ' (есть падения)' : ''));
