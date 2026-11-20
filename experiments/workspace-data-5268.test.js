// Общий модуль чтения данных и маршрута карточки для рабочих мест (issue #5268).
//   • pageUrl     — дописывает LIMIT=offset,count к адресу object/… или report/…;
//   • loadAll     — постраничная загрузка до короткой страницы, склейка без дублей по id,
//                   признак truncated при упоре в maxRows или при расхождении с total;
//   • cardRoute   — карточка поверх списка: #card=<id> в адресе, «Назад» закрывает.
//
// Run with: node experiments/workspace-data-5268.test.js

var wd = require('../js/workspace-data.js');

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// Сервер-заглушка: n записей {i}, отдаёт срез [offset, offset+min(count, cap)).
function fakeServer(n, cap) {
    var calls = [];
    var fetchPage = function (offset, count) {
        calls.push([offset, count]);
        var take = Math.min(count, cap || count);
        var rows = [];
        for (var k = offset; k < Math.min(n, offset + take); k++) rows.push({ i: k + 1 });
        return Promise.resolve(rows);
    };
    return { fetchPage: fetchPage, calls: calls };
}

// ── pageUrl ──
assertEqual(wd.pageUrl('object/469/?JSON_OBJ', 0, 500), 'object/469/?JSON_OBJ&LIMIT=0,500', 'pageUrl: к адресу с ? — через &');
assertEqual(wd.pageUrl('report/cut_planning', 1000, 500), 'report/cut_planning?LIMIT=1000,500', 'pageUrl: без ? — через ?');
assertEqual(wd.pageUrl('object/469/?JSON_OBJ&LIMIT=0,20000&F_U=7', 500, 500), 'object/469/?JSON_OBJ&F_U=7&LIMIT=500,500', 'pageUrl: старый LIMIT заменяется');

(async function () {
    // ── loadAll: все строки приходят, сколько бы их ни было ──
    for (var n of [0, 1, 499, 500, 501, 1234, 2000]) {
        var s = fakeServer(n);
        var res = await wd.loadAll(s.fetchPage, { pageSize: 500, maxRows: 100000 });
        assertEqual([res.rows.length, res.truncated], [n, false], 'loadAll: n=' + n + ' → все строки, не усечено');
    }

    // ── loadAll: упор в maxRows — truncated, лишнего не грузим ──
    var big = fakeServer(5000);
    var cut = await wd.loadAll(big.fetchPage, { pageSize: 500, maxRows: 1200 });
    assertEqual([cut.rows.length, cut.truncated], [1200, true], 'loadAll: maxRows=1200 из 5000 → 1200 строк, truncated');
    assertEqual(big.calls.slice(-2), [[1000, 200], [1200, 1]], 'loadAll: последняя страница добирает до maxRows, затем проба одной строкой');

    // ── ровно maxRows записей: усечения нет, нужна проверочная страница ──
    var exact = fakeServer(1000);
    var ex = await wd.loadAll(exact.fetchPage, { pageSize: 500, maxRows: 1000 });
    assertEqual([ex.rows.length, ex.truncated], [1000, false], 'loadAll: ровно maxRows записей → не усечено');

    // ── дубли между страницами склеиваются по id ──
    var dupFetch = function (offset, count) {
        var rows = [];
        for (var k = Math.max(0, offset - 2); k < Math.min(7, offset + count); k++) rows.push({ i: k + 1 });
        return Promise.resolve(rows.slice(0, count));
    };
    var dd = await wd.loadAll(dupFetch, { pageSize: 3 });
    assertEqual(dd.rows.map(function (r) { return r.i; }), [1, 2, 3, 4, 5, 6, 7], 'loadAll: дубли на стыке страниц убраны');

    // ── отчёт со своим LIMIT (REP_LIMIT) режет страницу молча: total ловит усечение ──
    var capped = fakeServer(5000, 300);
    var cr = await wd.loadAll(capped.fetchPage, { pageSize: 500, total: function () { return Promise.resolve(5000); } });
    assertEqual([cr.rows.length, cr.truncated, cr.total], [300, true, 5000], 'loadAll: короткая страница при total=5000 → truncated');
    var okTotal = await wd.loadAll(fakeServer(42).fetchPage, { pageSize: 500, total: 42 });
    assertEqual([okTotal.rows.length, okTotal.truncated], [42, false], 'loadAll: total совпал → не усечено');

    // ── ответ-не-массив = ошибка, а не пустой список ──
    var err = null;
    try { await wd.loadAll(function () { return Promise.resolve({ error: 'HTTP 403' }); }); } catch (e) { err = e; }
    assertEqual(!!err, true, 'loadAll: ответ сервера не массив → исключение');

    // ── cardRoute.parse / build ──
    var cr2 = wd.cardRoute;
    assertEqual(cr2.parse(''), null, 'cardRoute.parse: пустой hash → null');
    assertEqual(cr2.parse('#card=812'), '812', 'cardRoute.parse: #card=812');
    assertEqual(cr2.parse('#tab=2&card=812'), '812', 'cardRoute.parse: среди других параметров');
    assertEqual(cr2.parse('#card='), null, 'cardRoute.parse: пустое значение → null');
    assertEqual(cr2.build('', '812'), '#card=812', 'cardRoute.build: открыть');
    assertEqual(cr2.build('#tab=2', '812'), '#tab=2&card=812', 'cardRoute.build: остальные параметры сохраняются');
    assertEqual(cr2.build('#tab=2&card=812', '9'), '#tab=2&card=9', 'cardRoute.build: смена карточки');
    assertEqual(cr2.build('#tab=2&card=812', null), '#tab=2', 'cardRoute.build: закрыть');
    for (var h of ['', '#tab=2', '#a=1&b=2']) {
        for (var id of ['1', '812', 'abc']) {
            assertEqual(cr2.parse(cr2.build(h, id)), id, 'cardRoute: parse(build(' + JSON.stringify(h) + ', ' + id + ')) = id');
        }
    }

    // ── cardRoute.bind: открытие по адресу, «Назад», ссылка извне ──
    var listeners = {};
    var win = {
        location: { hash: '#card=5' },
        history: {
            pushState: function (s, t, url) { setUrl(url); },
            replaceState: function (s, t, url) { setUrl(url); },
            back: function () { win.location.hash = ''; listeners.hashchange(); }
        },
        addEventListener: function (ev, fn) { listeners[ev] = fn; },
        removeEventListener: function (ev) { delete listeners[ev]; }
    };
    function setUrl(url) { var k = url.indexOf('#'); win.location.hash = k < 0 ? '' : url.slice(k); }
    var log = [];
    var route = cr2.bind(win, {
        open: function (id) { log.push('open ' + id); },
        close: function () { log.push('close'); }
    });
    assertEqual(log, ['open 5'], 'bind: карточка из адреса открывается при старте');
    route.open('7');
    assertEqual([win.location.hash, log[log.length - 1]], ['#card=7', 'open 7'], 'bind: open пишет #card в адрес');
    win.history.back();
    assertEqual(log[log.length - 1], 'close', 'bind: «Назад» закрывает карточку');
    win.location.hash = '#card=9'; listeners.hashchange();
    assertEqual(log[log.length - 1], 'open 9', 'bind: смена hash извне открывает карточку');
    route.close();
    assertEqual([win.location.hash, log[log.length - 1]], ['', 'close'], 'bind: close убирает #card');
    route.destroy();
    assertEqual(listeners.hashchange, undefined, 'bind: destroy снимает обработчик');

    console.log('\n' + passed + ' passed' + (process.exitCode ? ', FAILURES' : ''));
})().catch(function (e) { console.log('FAIL — ' + (e && e.stack || e)); process.exitCode = 1; });
