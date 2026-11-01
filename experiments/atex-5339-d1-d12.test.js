// ideav/crm#5339 — D1 и D12 (файлы Фазы 1, едут на бой).
//
// D1. Экран «Рабочее место не настроено» показывался при заполненной колонке «Станок высечки»:
//     метаданные таблицы «Планшет» не прочитались целиком, и колонка «не нашлась». Теперь:
//       - сбой чтения / колонка не найдена в метаданных → повтор (2 раза), затем экран ошибки
//         загрузки с кнопкой «Повторить» и console.error, НЕ «не настроено»;
//       - «не настроено» — только когда метаданные целы, колонка есть, значение пусто.
//     Проверяется поведение: сторож пульта (pad-guard boot) и вход с корня (pad-home boot).
// D12. Время старта задания втулкорезов — по Europe/Moscow, а не по часовому поясу браузера.
//
// Run with: node experiments/atex-5339-d1-d12.test.js

process.env.TZ = 'America/New_York';
var path = require('path');

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// ── D12 ─────────────────────────────────────────────────────────────────────
var core = require('../download/atex/js/sleeve-cutter.js').core;
// 2026-06-01 05:00 UTC = 08:00 MSK = 01:00 в New York.
var unix = Date.UTC(2026, 5, 1, 5, 0, 0) / 1000;
assert(core.unixToLocalTime(unix) === '08:00', 'D12: старт задачи показан по Москве при TZ=America/New_York', 'actual=' + core.unixToLocalTime(unix));
// 2026-06-01 02:30 UTC = 05:30 MSK, в New York это ещё 31 мая.
var early = Date.UTC(2026, 5, 1, 2, 30, 0) / 1000;
assert(core.unixToLocalIso(early) === '2026-06-01', 'D12: дата задачи по Москве, не по браузеру', 'actual=' + core.unixToLocalIso(early));
assert(core.unixToLocalTime(unix * 1000) === '08:00', 'D12: Unix в миллисекундах - то же время');
var b = core.dayBoundsUnix('2026-06-01');
assert(b && b.start === Date.UTC(2026, 4, 31, 21, 0, 0) / 1000 && b.end - b.start === 86400,
    'D12: границы дня - московская полночь', 'start=' + (b && b.start));
assert(core.shiftIso('2026-06-01', -1) === '2026-05-31', 'D12: сдвиг даты на день назад');
assert(core.dayHeading('2026-06-01', '2026-06-01') === 'Сегодня, 01.06', 'D12: заголовок «Сегодня»');
assert(core.dayHeading('2026-06-05', '2026-06-01') === 'пт, 05.06', 'D12: день недели по дате');

// ── Минимальный DOM-стаб ────────────────────────────────────────────────────
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.handlers = {}; this.value = ''; this._text = '';
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
StubNode.prototype.removeChild = function(n) { this.childNodes = this.childNodes.filter(function(c) { return c !== n; }); };
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); };
StubNode.prototype.focus = function() {};
StubNode.prototype.click = function() { (this.handlers.click || []).forEach(function(fn) { fn({}); }); };
StubNode.prototype._all = function(acc) { this.childNodes.forEach(function(c) { acc.push(c); c._all(acc); }); return acc; };
StubNode.prototype.byClass = function(cls) {
    return this._all([]).filter(function(n) { return String(n.attributes['class'] || '').split(/\s+/).indexOf(cls) !== -1; });
};
// Промисы и повторы (паузы 0 мс) успевают отработать за реальное время.
function settled() { return new Promise(function(r) { setTimeout(r, 80); }); }

var GUARD = path.join(__dirname, '..', 'download', 'atex', 'js', 'pad-guard.js');
var HOME = path.join(__dirname, '..', 'download', 'atex', 'js', 'pad-home.js');
var TOKEN = 'a1b2c3d4e5f6a7b8';

function padTable(withDieCutterColumn) {
    var reqs = [{ num: 1, id: '10', val: 'Наименование', orig: '1', type: '3' },
        { num: 2, id: '11', val: 'Слиттер', orig: '2', type: '3' }];
    if (withDieCutterColumn) reqs.push({ num: 3, id: '12', val: 'Станок высечки', orig: '3', type: '3' });
    return { id: '673803', up: '0', type: '3', val: 'Планшет', unique: '1', granted: 'READ', reqs: reqs };
}
// opts.metadata(callNo) → тело метаданных; opts.row → значения r строки; opts.failMetadata(callNo) → true: сеть упала
function scene(opts) {
    var errors = [];
    var origError = console.error, origWarn = console.warn;
    console.error = function() { errors.push([].slice.call(arguments).join(' ')); };
    console.warn = function() {};
    var root = new StubNode('div');
    root.setAttribute('data-db', 'ateh');
    root.setAttribute('data-xsrf', 'X');
    var body = new StubNode('body');
    var currentScript = new StubNode('script');
    if (opts.home) {
        currentScript.setAttribute('data-pad-db', 'ateh');
        currentScript.setAttribute('data-pad-roles', '1621');
        currentScript.setAttribute('data-pad-role-id', '1621');
    } else {
        currentScript.setAttribute('data-pad-root', 'pad-root');
        currentScript.setAttribute('data-pad-app', '/app.js');
        if (opts.kind) currentScript.setAttribute('data-pad-kind', opts.kind);
    }
    var calls = { metadata: 0, rows: 0, replaced: [] };
    var store = { data: { atehPad: TOKEN }, getItem: function(k) { return this.data[k] == null ? null : this.data[k]; },
        setItem: function(k, v) { this.data[k] = String(v); } };
    var doc = {
        currentScript: currentScript, body: body, head: new StubNode('head'),
        getElementById: function(id) {
            if (id === 'pad-root') return root;
            return body._all([]).filter(function(n) { return n.attributes.id === id; })[0] || null;
        },
        createElement: function(tag) { return new StubNode(tag); },
        querySelector: function() { return null; }
    };
    var win = {
        document: doc, localStorage: store, crypto: { getRandomValues: function(a) { return a; } },
        URLSearchParams: URLSearchParams, roleId: '1621', action: '', db: 'ateh',
        atexPadRetryDelays: [0, 0],
        location: { replace: function(u) { calls.replaced.push(u); }, reload: function() {} },
        fetch: function(url) {
            var isMeta = url.indexOf('metadata') >= 0;
            var n = isMeta ? ++calls.metadata : ++calls.rows;
            if (isMeta && opts.failMetadata && opts.failMetadata(n)) return Promise.reject(new Error('Failed to fetch'));
            var bodyJson = isMeta ? opts.metadata(n) : [{ i: '900', r: opts.row }];
            return Promise.resolve({ ok: true, status: 200, text: function() { return Promise.resolve(JSON.stringify(bodyJson)); } });
        }
    };
    global.window = win;
    delete require.cache[require.resolve(GUARD)];
    delete require.cache[require.resolve(HOME)];
    require(GUARD);
    if (opts.home) require(HOME);
    return {
        root: root, body: body, calls: calls, errors: errors,
        restore: function() { console.error = origError; console.warn = origWarn; },
        appLoaded: function() { return body.childNodes.some(function(n) { return n.tagName === 'SCRIPT'; }); },
        text: function() { return opts.home ? (doc.getElementById('atex-pad-home') ? doc.getElementById('atex-pad-home').textContent : '') : root.textContent; },
        buttons: function() { return (opts.home ? body : root).byClass('atex-pad-btn'); }
    };
}

(async function() {
    var s;
    // ── D1, сторож пульта (kind=dieCutter) ──
    // Колонка заполнена в строке (3 значения), а метаданные пришли БЕЗ колонки «Станок высечки».
    s = scene({ kind: 'dieCutter', metadata: function() { return [padTable(false)]; }, row: [TOKEN, 'Высечка 1', '', '7:Станок 7'] });
    await settled();
    assert(!s.appLoaded(), 'D1 guard: колонка не найдена в метаданных - пульт не открыт');
    assert(s.text().indexOf('Планшет не настроен') < 0, 'D1 guard: сбой чтения НЕ выдаётся за «Планшет не настроен»', s.text().slice(0, 120));
    assert(s.text().indexOf('Не удалось загрузить настройку планшета') >= 0, 'D1 guard: экран ошибки загрузки');
    assert(s.buttons().some(function(b) { return b.textContent === 'Повторить'; }), 'D1 guard: есть кнопка «Повторить»');
    assert(s.errors.length > 0 && s.errors[0].indexOf('Станок высечки') >= 0 || s.errors.join(' ').indexOf('Станок высечки') >= 0, 'D1 guard: console.error с деталями');
    assert(s.calls.metadata === 3, 'D1 guard: метаданные прочитаны 3 раза (запрос + 2 повтора)', 'actual=' + s.calls.metadata);
    s.restore();

    // Повтор помогает: первая загрузка метаданных упала, вторая прошла.
    s = scene({ kind: 'dieCutter', failMetadata: function(n) { return n === 1; },
        metadata: function() { return [padTable(true)]; }, row: [TOKEN, 'Высечка 1', '', '7:Станок 7'] });
    await settled();
    assert(s.appLoaded(), 'D1 guard: после разового сбоя метаданных повтор открывает пульт');
    s.restore();

    // Сеть лежит все три раза → ошибка загрузки, не «не настроено».
    s = scene({ kind: 'dieCutter', failMetadata: function() { return true; },
        metadata: function() { return [padTable(true)]; }, row: [] });
    await settled();
    assert(!s.appLoaded() && s.text().indexOf('Планшет не настроен') < 0 && s.buttons().some(function(b) { return b.textContent === 'Повторить'; }),
        'D1 guard: сеть недоступна - ошибка с «Повторить»');
    s.restore();

    // Кнопка «Повторить» перечитывает данные.
    var flaky = true;
    s = scene({ kind: 'dieCutter', metadata: function() { return [padTable(!flaky)]; }, row: [TOKEN, 'Высечка 1', '', '7:Станок 7'] });
    await settled();
    flaky = false;
    var retryBtn = s.buttons().filter(function(b) { return b.textContent === 'Повторить'; })[0];
    if (retryBtn) retryBtn.click();
    await settled();
    assert(!!retryBtn && s.appLoaded(), 'D1 guard: «Повторить» после починки открывает пульт');
    s.restore();

    // Честное «не настроено»: метаданные целы, колонка есть, значение пусто.
    s = scene({ kind: 'dieCutter', metadata: function() { return [padTable(true)]; }, row: [TOKEN, 'Высечка 1', '', ''] });
    await settled();
    assert(!s.appLoaded() && s.text().indexOf('Планшет не настроен') >= 0, 'D1 guard: колонка есть и пуста - «Планшет не настроен»');
    assert(s.calls.metadata === 1, 'D1 guard: честное «не настроено» без повторов');
    s.restore();

    // ── D1, вход с корня (pad-home) ──
    s = scene({ home: true, metadata: function() { return [padTable(false)]; }, row: [TOKEN, 'Высечка 1', '', '7:Станок 7'] });
    await settled();
    assert(s.text().indexOf('Рабочее место не настроено') < 0, 'D1 home: лишние значения в строке - не «не настроено»', s.text().slice(0, 100));
    assert(s.text().indexOf('Не удалось загрузить настройку планшета') >= 0 && s.buttons().some(function(b) { return b.textContent === 'Повторить'; }),
        'D1 home: ошибка загрузки с «Повторить»');
    s.restore();

    s = scene({ home: true, metadata: function() { return [padTable(true)]; }, row: [TOKEN, 'Высечка 1', '', ''] });
    await settled();
    assert(s.text().indexOf('Рабочее место не настроено') >= 0, 'D1 home: данные целы, ничего не заполнено - «не настроено»');
    s.restore();

    s = scene({ home: true, metadata: function() { return [padTable(true)]; }, row: [TOKEN, 'Высечка 1', '', '7:Станок 7'] });
    await settled();
    assert(s.calls.replaced.length === 1 && s.calls.replaced[0] === '/ateh/die-cutter', 'D1 home: цела настройка - переход в пульт высечки', JSON.stringify(s.calls.replaced));
    s.restore();

    console.log('\n' + passed + '/' + total + ' passed');
})();
