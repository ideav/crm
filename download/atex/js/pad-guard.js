/*
 * Допуск планшета к рабочим местам оператора atex (ideav/crm#4666).
 *
 * Оператор работает с планшета в пультах «Слиттер», «Втулкорез» и «Упаковщик».
 * Работать в них можно только с планшета, ЗАРЕГИСТРИРОВАННОГО в таблице
 * «Планшет»: её первая колонка — токен устройства, он же лежит в localStorage
 * под ключом `atehPad`. Нет записи с этим токеном — рабочее место не работает.
 *
 * Модуль подключается ВМЕСТО скрипта рабочего места и сам загружает его, когда
 * планшет опознан:
 *
 *   <script src="/download/{db}/js/pad-guard.js?…"
 *           data-pad-root="atex-slitter"
 *           data-pad-app="/download/{db}/js/slitter.js?…" defer></script>
 *
 * Так выполняется требование «рабочее место должно быть пустым — не успевать
 * отрисоваться»: код пульта не грузится и не выполняется вовсе, пока проверка не
 * пройдена. Никакой флаг внутри пульта такого не гарантирует — пульт стартует по
 * DOMContentLoaded, то есть раньше, чем вернётся ответ сервера.
 *
 * Пользователю с правом записи на таблицу («granted»:«WRITE» в метаданных)
 * предлагается зарегистрировать планшет: он вводит имя, модуль генерирует
 * случайный токен, пишет запись `_m_new/{Планшет}` (токен — первая колонка, имя —
 * «Наименование»), кладёт токен в localStorage и перезагружает страницу.
 *
 * Имя зарегистрированного планшета показывается в `.navbar-workspace` верхнего
 * меню (templates/atex/main.html).
 *
 * Чистая часть (разбор метаданных, строк, сборка запросов, генерация токена)
 * экспортируется через module.exports для тестов
 * (experiments/atex-pad-guard.test.js).
 */
(function(root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.AtexPadGuard = api;
        if (root.document) api.boot(root.document.currentScript);
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(root) {
    'use strict';

    // Ключ localStorage и имена в схеме заданы задачей #4666.
    var TOKEN_KEY = 'atehPad';
    var TABLE_NAME = 'Планшет';
    var NAME_REQ = 'Наименование';
    var TOKEN_BYTES = 16;   // 32 hex-символа

    // ── Чистые функции ──

    function trimText(value) {
        return String(value == null ? '' : value).trim();
    }

    // Таблица «Планшет» из ответа `GET /{db}/metadata`.
    function findTable(metadata) {
        var list = Array.isArray(metadata) ? metadata : (metadata ? [metadata] : []);
        for (var i = 0; i < list.length; i++)
            if (list[i] && trimText(list[i].val).toLowerCase() === TABLE_NAME.toLowerCase())
                return list[i];
        return null;
    }

    // Владелец базы и админ ходят В ОБХОД грантов (index.php, Check_Grant), поэтому
    // метаданные не выдают им `granted` вовсе — по одному лишь полю они выглядели бы
    // как пользователи без прав.
    function isOwner(ctx) {
        var user = trimText(ctx && ctx.user).toLowerCase();
        var db = trimText(ctx && ctx.db).toLowerCase();
        var role = trimText(ctx && ctx.role).toLowerCase();
        if (!user) return false;
        return role === 'admin' || user === 'admin' || (!!db && user === db);
    }

    // Регистрировать планшет может тот, кому таблица открыта на запись.
    function canRegister(table, ctx) {
        if (!table) return false;
        var granted = trimText(table.granted).toUpperCase();
        if (granted) return granted === 'WRITE';
        return isOwner(ctx);
    }

    // Имя колонки живёт либо в `val` (имя ТИПА), либо в `attrs.alias` (псевдоним
    // в этой таблице) — искать надо по обоим, иначе колонка с псевдонимом не
    // находится (грабли #4655, docs/kb/schema.md).
    function reqAlias(req) {
        var raw = req && req.attrs;
        if (!raw) return '';
        if (typeof raw === 'object') return trimText(raw.alias);
        try { return trimText((JSON.parse(raw) || {}).alias); }
        catch (e) { return ''; }
    }

    function isNameReq(req) {
        var wanted = NAME_REQ.toLowerCase();
        return !!req && (trimText(req.val).toLowerCase() === wanted || reqAlias(req).toLowerCase() === wanted);
    }

    // id реквизита «Наименование» — имя планшета хранится в нём.
    function nameReqId(table) {
        var reqs = (table && table.reqs) || [];
        for (var i = 0; i < reqs.length; i++)
            if (isNameReq(reqs[i]))
                return String(reqs[i].id);
        return '';
    }

    // Токен — только hex: символы `%`, `@`, `!`, `<`, `>` меняют смысл фильтра
    // `F_{tableId}` на сервере (index.php, Construct_WHERE), а hex ищется точным
    // сравнением.
    function makeToken(cryptoObj) {
        var bytes = new Uint8Array(TOKEN_BYTES);
        if (cryptoObj && typeof cryptoObj.getRandomValues === 'function')
            cryptoObj.getRandomValues(bytes);
        else
            throw new Error('Браузер не умеет crypto.getRandomValues — токен не сгенерировать');
        var out = '';
        for (var i = 0; i < bytes.length; i++)
            out += (bytes[i] + 0x100).toString(16).slice(1);
        return out;
    }

    function isToken(value) {
        return /^[a-f0-9]{8,64}$/.test(trimText(value));
    }

    // Фильтр по ПЕРВОЙ колонке: её ключ — id самой таблицы (docs/kb/crud.md).
    function buildLookupPath(tableId, token) {
        return 'object/' + encodeURIComponent(tableId) + '/?JSON_OBJ&LIMIT=0,2' +
            '&F_' + encodeURIComponent(tableId) + '=' + encodeURIComponent(token);
    }

    // Строки JSON_OBJ: { i: id, r: [первая колонка, реквизит1, …] }. Запись
    // засчитывается только при ТОЧНОМ совпадении токена — сервер фильтрует точно,
    // но полагаться на это вслепую нельзя.
    function padFromRows(rows, token, nameIdx) {
        var list = Array.isArray(rows) ? rows : ((rows && rows.object) || []);
        for (var i = 0; i < list.length; i++) {
            var row = list[i] || {};
            var cols = row.r || [];
            if (trimText(cols[0]) !== trimText(token)) continue;
            return {
                id: String(row.i == null ? '' : row.i),
                token: trimText(cols[0]),
                name: trimText(cols[nameIdx > 0 ? nameIdx : 1])
            };
        }
        return null;
    }

    // Номер колонки «Наименование» в строке JSON_OBJ. Порядок значений тот же, что
    // и у других пультов: [первая колонка, реквизиты в порядке метаданных].
    function nameColIndex(table) {
        var reqs = (table && table.reqs) || [];
        for (var i = 0; i < reqs.length; i++)
            if (isNameReq(reqs[i]))
                return i + 1;
        return 1;
    }

    // Параметры записи нового планшета: токен — первая колонка (`t{tableId}`),
    // имя — реквизит «Наименование».
    function registerParams(table, token, name) {
        var params = {};
        params['t' + table.id] = token;
        var reqId = nameReqId(table);
        if (reqId) params['t' + reqId] = name;
        return params;
    }

    // Ошибка Integram приходит как [{error}] или {error} и часто с 4xx —
    // смотрим и на текст, и на статус (иначе отказ читается как успех).
    function apiError(resp, data) {
        var payload = Array.isArray(data) ? data[0] : data;
        var message = payload && (payload.error || payload.err || payload.message);
        if (message) return String(message);
        if (resp && !resp.ok) return 'Сервер ответил ' + resp.status;
        return '';
    }

    // ── Работа с localStorage (тихая: приватный режим не должен ломать пульт) ──

    function readToken(storage) {
        try { return trimText(storage && storage.getItem(TOKEN_KEY)); }
        catch (e) { return ''; }
    }

    function writeToken(storage, token) {
        try { storage.setItem(TOKEN_KEY, token); return true; }
        catch (e) { return false; }
    }

    // ── DOM ──

    function el(tag, attrs, children) {
        var node = root.document.createElement(tag);
        Object.keys(attrs || {}).forEach(function(k) {
            if (attrs[k] === undefined || attrs[k] === null) return;
            if (k === 'text') node.textContent = attrs[k];
            else node.setAttribute(k, attrs[k]);
        });
        (children || []).forEach(function(child) { if (child) node.appendChild(child); });
        return node;
    }

    function showNote(container, title, text) {
        container.innerHTML = '';
        container.appendChild(el('div', { class: 'atex-pad-guard' }, [
            el('div', { class: 'atex-pad-card' }, [
                el('h2', { class: 'atex-pad-title', text: title }),
                text ? el('p', { class: 'atex-pad-text', text: text }) : null
            ])
        ]));
    }

    // Экран отказа. Тому, кому таблица открыта на запись, предлагаем тут же
    // зарегистрировать планшет — остальным остаётся сообщение.
    function showBlocked(ctx, title, text) {
        var container = ctx.root;
        container.innerHTML = '';
        var card = el('div', { class: 'atex-pad-card' }, [
            el('h2', { class: 'atex-pad-title', text: title }),
            el('p', { class: 'atex-pad-text', text: text })
        ]);
        if (canRegister(ctx.table, ctx)) {
            var input = el('input', {
                class: 'atex-pad-input', id: 'atex-pad-name', type: 'text',
                placeholder: 'Например, Планшет слиттера №1', autocomplete: 'off'
            });
            var error = el('div', { class: 'atex-pad-error' });
            var button = el('button', { class: 'atex-pad-btn', type: 'button', text: 'Зарегистрировать планшет' });
            card.appendChild(el('label', { class: 'atex-pad-label', for: 'atex-pad-name', text: 'Название планшета' }));
            card.appendChild(input);
            card.appendChild(error);
            card.appendChild(button);
            button.addEventListener('click', function() {
                register(ctx, input, error, button);
            });
            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') { e.preventDefault(); register(ctx, input, error, button); }
            });
            setTimeout(function() { input.focus(); }, 0);
        }
        container.appendChild(el('div', { class: 'atex-pad-guard' }, [card]));
    }

    function register(ctx, input, error, button) {
        var name = trimText(input.value);
        error.textContent = '';
        if (!name) { error.textContent = 'Введите название планшета'; input.focus(); return; }
        button.disabled = true;
        button.textContent = 'Регистрируем…';
        var token;
        try { token = makeToken(root.crypto); }
        catch (e) {
            error.textContent = e.message;
            button.disabled = false;
            button.textContent = 'Зарегистрировать планшет';
            return;
        }
        post(ctx, '_m_new/' + ctx.table.id + '?JSON&up=1', registerParams(ctx.table, token, name))
            .then(function() {
                if (!writeToken(root.localStorage, token))
                    throw new Error('Браузер не сохранил токен (localStorage недоступен)');
                root.location.reload();
            })
            .catch(function(err) {
                error.textContent = 'Не удалось зарегистрировать: ' + err.message;
                button.disabled = false;
                button.textContent = 'Зарегистрировать планшет';
            });
    }

    function url(ctx, path) {
        return '/' + encodeURIComponent(ctx.db) + '/' + path;
    }

    function getJson(ctx, path) {
        return root.fetch(url(ctx, path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                var data;
                try { data = JSON.parse(text); }
                catch (e) { throw new Error('Сервер вернул не JSON: ' + text.slice(0, 200)); }
                var message = apiError(resp, data);
                if (message) throw new Error(message);
                return data;
            });
        });
    }

    function post(ctx, path, params) {
        var body = new root.URLSearchParams();
        body.set('_xsrf', ctx.xsrf);
        Object.keys(params || {}).forEach(function(k) {
            if (params[k] !== undefined && params[k] !== null && params[k] !== '') body.set(k, params[k]);
        });
        return root.fetch(url(ctx, path), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        }).then(function(resp) {
            return resp.text().then(function(text) {
                var data;
                try { data = JSON.parse(text); }
                catch (e) { throw new Error('Сервер вернул не JSON: ' + text.slice(0, 200)); }
                var message = apiError(resp, data);
                if (message) throw new Error(message);
                return data;
            });
        });
    }

    // Имя планшета — в шапку рабочего места. #4783: пульт слиттера дописывает к нему дату
    // и станок, поэтому опознанный планшет кладётся и в `window.atexPad` — из шапки его уже
    // не вычитать, когда пульт перерисует её своей подписью.
    function showPadName(pad) {
        var name = trimText(pad && pad.name);
        root.atexPad = pad || null;
        if (!name) return;
        var slot = root.document.querySelector('.navbar-workspace');
        if (slot) slot.textContent = name;
    }

    // Скрипт рабочего места грузим только после успешной проверки.
    function loadApp(src) {
        if (!src) return;
        var script = root.document.createElement('script');
        script.src = src;
        root.document.body.appendChild(script);
    }

    function boot(currentScript) {
        var script = currentScript || (root.document && root.document.currentScript);
        if (!script) return;
        var rootId = script.getAttribute('data-pad-root');
        var appSrc = script.getAttribute('data-pad-app');
        var container = rootId ? root.document.getElementById(rootId) : null;
        if (!container) return;
        var ctx = {
            root: container,
            db: container.getAttribute('data-db') || '',
            xsrf: container.getAttribute('data-xsrf') || (root.xsrf || ''),
            user: container.getAttribute('data-user') || (root.user || ''),
            role: root.role || '',
            table: null
        };
        showNote(container, 'Проверка устройства…', '');

        getJson(ctx, 'metadata')
            .then(function(metadata) {
                ctx.table = findTable(metadata);
                if (!ctx.table)
                    throw new Error('В базе нет таблицы «' + TABLE_NAME + '» — обратитесь к администратору');
                var token = readToken(root.localStorage);
                if (!isToken(token)) return null;
                return getJson(ctx, buildLookupPath(ctx.table.id, token)).then(function(rows) {
                    return padFromRows(rows, token, nameColIndex(ctx.table));
                });
            })
            .then(function(pad) {
                if (!pad) {
                    showBlocked(ctx, 'Устройство не зарегистрировано',
                        canRegister(ctx.table, ctx)
                            ? 'Этот планшет не значится в таблице «' + TABLE_NAME + '». Дайте ему название и зарегистрируйте — рабочее место откроется сразу после этого.'
                            : 'Этот планшет не значится в таблице «' + TABLE_NAME + '». Зарегистрировать его может сотрудник с правом записи в эту таблицу.');
                    return;
                }
                showPadName(pad);
                loadApp(appSrc);
            })
            .catch(function(err) {
                showBlocked(ctx, 'Проверка устройства недоступна', err.message);
            });
    }

    return {
        TOKEN_KEY: TOKEN_KEY,
        TABLE_NAME: TABLE_NAME,
        NAME_REQ: NAME_REQ,
        trimText: trimText,
        findTable: findTable,
        canRegister: canRegister,
        isOwner: isOwner,
        nameReqId: nameReqId,
        nameColIndex: nameColIndex,
        makeToken: makeToken,
        isToken: isToken,
        buildLookupPath: buildLookupPath,
        padFromRows: padFromRows,
        registerParams: registerParams,
        apiError: apiError,
        readToken: readToken,
        writeToken: writeToken,
        boot: boot
    };
});
