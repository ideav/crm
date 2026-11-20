// Общие функции рабочих мест: чтение данных постранично и маршрут карточки (issue #5268).
// Подключение в шаблоне: <script src="/js/workspace-data.js?1"></script> → window.WorkspaceData.
// Правила применения — docs/integram-app-workflow.md, 4.3.4–4.3.6.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WorkspaceData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Дописать LIMIT=offset,count к адресу object/… или report/…; прежний LIMIT убирается.
    function pageUrl(url, offset, count) {
        var q = url.indexOf('?');
        var base = q < 0 ? url : url.slice(0, q);
        var params = q < 0 ? [] : url.slice(q + 1).split('&').filter(function (p) {
            return p !== '' && p.split('=')[0] !== 'LIMIT';
        });
        params.push('LIMIT=' + offset + ',' + count);
        return base + '?' + params.join('&');
    }

    function defaultId(row) {
        if (row == null) return undefined;
        if (row.i != null) return String(row.i);
        if (row.id != null) return String(row.id);
        return undefined;
    }

    // Загрузить все строки: страницы по pageSize до первой короткой, но не больше maxRows.
    //   fetchPage(offset, count) → Promise<массив строк>;
    //   opts.pageSize (1000), opts.maxRows (20000), opts.idOf(row) — ключ склейки без дублей,
    //   opts.total — число или функция → Promise<число> (например запрос с RECORD_COUNT=1).
    // Результат: { rows, truncated, total }. truncated = true значит «показаны не все записи»:
    // экран обязан сказать это пользователю и предложить сузить фильтр.
    function loadAll(fetchPage, opts) {
        opts = opts || {};
        var pageSize = opts.pageSize || 1000;
        var maxRows = opts.maxRows || 20000;
        var idOf = opts.idOf || defaultId;
        var rows = [];
        var seen = {};
        var offset = 0;

        function add(page) {
            for (var k = 0; k < page.length && rows.length < maxRows; k++) {
                var id = idOf(page[k]);
                if (id !== undefined) {
                    if (seen[id]) continue;
                    seen[id] = true;
                }
                rows.push(page[k]);
            }
        }

        function step() {
            var count = Math.min(pageSize, maxRows - rows.length);
            // Упёрлись в maxRows: одна строка сверх лимита скажет, есть ли ещё записи.
            var probe = count === 0;
            return Promise.resolve(fetchPage(offset, probe ? 1 : count)).then(function (page) {
                if (!Array.isArray(page)) {
                    throw new Error('WorkspaceData.loadAll: ответ не массив: ' + JSON.stringify(page).slice(0, 200));
                }
                if (probe) return page.length > 0;
                offset += page.length;
                add(page);
                if (page.length < count) return false;
                return step();
            });
        }

        var totalP = typeof opts.total === 'function' ? Promise.resolve(opts.total())
            : Promise.resolve(opts.total);
        return Promise.all([step(), totalP]).then(function (res) {
            var total = res[1] == null ? null : Number(res[1]);
            var truncated = res[0] || (total != null && rows.length < total);
            return { rows: rows, truncated: !!truncated, total: total };
        });
    }

    // ── Карточка поверх списка: состояние «открыта запись N» живёт в адресе как #card=N ──
    function splitHash(hash) {
        var s = String(hash || '');
        if (s.charAt(0) === '#') s = s.slice(1);
        return s === '' ? [] : s.split('&');
    }

    function parse(hash) {
        var parts = splitHash(hash);
        for (var k = 0; k < parts.length; k++) {
            var kv = parts[k].split('=');
            if (kv[0] === 'card') return kv[1] ? decodeURIComponent(kv[1]) : null;
        }
        return null;
    }

    function build(hash, id) {
        var parts = splitHash(hash).filter(function (p) { return p.split('=')[0] !== 'card'; });
        if (id != null && id !== '') parts.push('card=' + encodeURIComponent(id));
        return parts.length ? '#' + parts.join('&') : '';
    }

    // Связать карточку с адресом окна. handlers.open(id) рисует карточку, handlers.close() убирает.
    // Открытие пишет запись в историю (кнопка «Назад» закрывает карточку), ссылку с #card=N
    // можно отправить коллеге — карточка откроется при загрузке страницы.
    function bind(win, handlers) {
        var current = null;
        function apply() {
            var id = parse(win.location.hash);
            if (id === current) return;
            current = id;
            if (id == null) handlers.close();
            else handlers.open(id);
        }
        function url(hash) {
            var loc = win.location;
            return (loc.pathname || '') + (loc.search || '') + hash;
        }
        win.addEventListener('hashchange', apply);
        apply();
        return {
            open: function (id) {
                win.history.pushState(null, '', url(build(win.location.hash, String(id))));
                apply();
            },
            close: function () {
                var h = win.history;
                (h.replaceState || h.pushState).call(h, null, '', url(build(win.location.hash, null)));
                apply();
            },
            current: function () { return current; },
            destroy: function () { win.removeEventListener('hashchange', apply); }
        };
    }

    return {
        pageUrl: pageUrl,
        loadAll: loadAll,
        cardRoute: { parse: parse, build: build, bind: bind }
    };
});
