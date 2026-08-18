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
 * #4789: в таблице «Планшет» появились колонки настройки — «Слиттер», «Втулкорез»,
 * «Упаковочное место» и «Рабочее место». Ими планшет привязан к рабочему месту
 * оператора и к его объекту (станку, втулкорезу, упаковочному месту): по ним
 * `pad-home.js` уводит оператора прямо в это рабочее место, а сами пульты открываются
 * с уже выбранным объектом. Настраивает планшет диспетчер — выбор объекта в пульте
 * пишется в его запись (`setObject`), поэтому таблица заполняется сама собой; править
 * её руками тоже можно, лишь бы в записи остались токен и имя.
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
    // #4789: колонки настройки планшета. Имена — как в таблице «Планшет» (ateh).
    var CONFIG_REQS = {
        slitter: 'Слиттер',
        cutter: 'Втулкорез',
        place: 'Упаковочное место',
        workspace: 'Рабочее место'
    };
    // Объект настройки → рабочее место оператора (хвост URL `/{db}/{action}`).
    var WORKSPACE_ACTION = { slitter: 'slitter', cutter: 'sleeve-cutter', place: 'packer' };
    // Обратная карта: по рабочему месту — какой колонкой задан его объект.
    var ACTION_KIND = { slitter: 'slitter', 'sleeve-cutter': 'cutter', packer: 'place' };
    // Как в колонке «Рабочее место» может быть записано само рабочее место. Пусто —
    // не задано; неизвестное слово — тоже (тогда решает набор заполненных объектов).
    var WORKSPACE_ALIASES = {
        'slitter': 'slitter', 'слиттер': 'slitter', 'резка': 'slitter', 'пульт слиттера': 'slitter',
        'sleeve-cutter': 'sleeve-cutter', 'sleevecutter': 'sleeve-cutter', 'втулкорез': 'sleeve-cutter',
        'втулки': 'sleeve-cutter', 'пульт втулкореза': 'sleeve-cutter',
        'packer': 'packer', 'упаковка': 'packer', 'упаковщик': 'packer', 'упаковочное место': 'packer'
    };

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

    // #4789: реквизит по имени ТИПА или псевдониму в этой таблице (грабли #4655).
    function reqByName(table, name) {
        var reqs = (table && table.reqs) || [];
        var wanted = trimText(name).toLowerCase();
        for (var i = 0; i < reqs.length; i++) {
            var req = reqs[i];
            if (trimText(req.val).toLowerCase() === wanted || reqAlias(req).toLowerCase() === wanted)
                return { req: req, index: i + 1 };   // +1: нулевая колонка строки — первая колонка таблицы
        }
        return null;
    }

    function configReqId(table, kind) {
        var found = reqByName(table, CONFIG_REQS[kind]);
        return found ? String(found.req.id) : '';
    }

    // Ссылочное значение JSON_OBJ («id:Подпись») → { id, label }. Не ссылка (число или
    // текст) остаётся подписью без id — пульт сведёт такое значение по названию.
    function parseRefValue(raw) {
        var s = trimText(raw);
        var m = s.match(/^(\d+):([\s\S]*)$/);
        return m ? { id: m[1], label: trimText(m[2]) } : { id: '', label: s };
    }

    function hasObject(obj) {
        return !!(obj && (obj.id || obj.label));
    }

    // Значение колонки «Рабочее место» → 'slitter' | 'sleeve-cutter' | 'packer' | ''.
    function normalizeWorkspace(value) {
        var s = parseRefValue(value).label.toLowerCase();
        return WORKSPACE_ALIASES[s] || '';
    }

    // Настройка планшета из строки JSON_OBJ.
    function padConfigFromRow(table, cols) {
        var config = { slitter: null, cutter: null, place: null, workspace: '' };
        Object.keys(CONFIG_REQS).forEach(function(kind) {
            var found = reqByName(table, CONFIG_REQS[kind]);
            if (!found) return;
            var raw = (cols || [])[found.index];
            if (kind === 'workspace') { config.workspace = normalizeWorkspace(raw); return; }
            var obj = parseRefValue(raw);
            config[kind] = hasObject(obj) ? obj : null;
        });
        return config;
    }

    // Куда планшет открывается. Рабочее место названо колонкой «Рабочее место» —
    // берём его; иначе решает набор заполненных объектов: ровно один → его рабочее
    // место, ни одного → планшет не настроен, больше одного → выбор неоднозначен.
    // Объект может быть не задан (рабочее место названо, станок нет) — тогда пульт
    // откроется и попросит выбрать объект сам.
    function padWorkspace(pad) {
        var config = (pad && pad.config) || {};
        var filled = Object.keys(WORKSPACE_ACTION).filter(function(kind) { return hasObject(config[kind]); });
        if (config.workspace) {
            var kind = ACTION_KIND[config.workspace];
            return { ok: true, action: config.workspace, kind: kind, object: config[kind] || null, reason: '' };
        }
        if (!filled.length) return { ok: false, action: '', kind: '', object: null, reason: 'none' };
        if (filled.length > 1) return { ok: false, action: '', kind: '', object: null, reason: 'ambiguous' };
        return { ok: true, action: WORKSPACE_ACTION[filled[0]], kind: filled[0], object: config[filled[0]], reason: '' };
    }

    // #4789: объект настройки планшета → id записи из справочника пульта. В «Планшете»
    // объект лежит либо ссылкой (id известен), либо текстом (только название) — сводим и
    // то, и другое: сперва по id, затем по названию (регистр и пробелы неважны).
    // Не нашли — пусто: пульт попросит выбрать объект сам, а не подставит чужой.
    function matchPadObject(options, obj) {
        var list = options || [];
        var id = trimText(obj && obj.id);
        var label = trimText(obj && obj.label).toLowerCase();
        var i;
        if (id) {
            for (i = 0; i < list.length; i++)
                if (trimText(list[i] && list[i].id) === id) return id;
        }
        if (label) {
            for (i = 0; i < list.length; i++)
                if (trimText(list[i] && list[i].label).toLowerCase() === label) return trimText(list[i].id);
        }
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
    function padFromRows(rows, token, nameIdx, table) {
        var list = Array.isArray(rows) ? rows : ((rows && rows.object) || []);
        for (var i = 0; i < list.length; i++) {
            var row = list[i] || {};
            var cols = row.r || [];
            if (trimText(cols[0]) !== trimText(token)) continue;
            return {
                id: String(row.i == null ? '' : row.i),
                token: trimText(cols[0]),
                name: trimText(cols[nameIdx > 0 ? nameIdx : 1]),
                config: padConfigFromRow(table, cols)   // #4789: настройка планшета
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

    // #4789: код устройства, который диспетчер вписывает в первую колонку «Планшета»
    // руками. Токена ещё нет — генерируем и запоминаем: показанный код должен быть тем
    // самым, с которым устройство потом придёт (иначе запись в таблице ни к чему не
    // привяжется). Генератор недоступен (нет crypto) → пусто, и об этом скажет экран.
    function ensureToken(storage, cryptoObj) {
        var token = readToken(storage);
        if (isToken(token)) return token;
        try { token = makeToken(cryptoObj); }
        catch (e) { return ''; }
        writeToken(storage, token);
        return token;
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
        // #4789: код устройства виден всегда — по нему планшет заводят в таблице руками
        // (первая колонка «Планшета»), даже если у вошедшего нет прав на запись.
        var padToken = ensureToken(root.localStorage, root.crypto);
        if (padToken) {
            card.appendChild(el('div', { class: 'atex-pad-label', text: 'Код этого планшета (первая колонка таблицы «' + TABLE_NAME + '»)' }));
            card.appendChild(el('div', { class: 'atex-pad-token', text: padToken }));
        } else {
            card.appendChild(el('div', { class: 'atex-pad-error', text: 'Код устройства не сгенерировать: браузер не умеет crypto.getRandomValues' }));
        }
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
        // #4789: код устройства мог быть уже показан на этом экране (и записан диспетчером
        // руками) — берём его, а не новый, иначе показанный код перестанет быть верным.
        try { token = ensureToken(root.localStorage, root.crypto) || makeToken(root.crypto); }
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

    // #4789: пульт сообщает планшету выбранный объект — станок, втулкорез или
    // упаковочное место. Пишем ОДНОЙ записью: колонку объекта, ПУСТЫЕ остальные две
    // (планшет стоит у одного рабочего места, и выбор должен остаться однозначным) —
    // и следом, отдельной записью, колонку «Рабочее место». Отдельной потому, что тип
    // этой колонки в базе может оказаться ссылкой: её отказ не должен отменять главное.
    // Прав на запись нет (оператор) — молча не пишем: выбор всё равно живёт в
    // localStorage пульта, а настраивает планшет диспетчер.
    function makeSetObject(ctx, pad) {
        return function(kind, obj) {
            var action = WORKSPACE_ACTION[kind];
            if (!action) return Promise.resolve({ saved: false, reason: 'unknown-kind' });
            if (!pad || !pad.id) return Promise.resolve({ saved: false, reason: 'no-pad' });
            if (!canRegister(ctx.table, ctx)) return Promise.resolve({ saved: false, reason: 'no-write' });
            var objReq = configReqId(ctx.table, kind);
            var value = trimText(obj && (obj.id || obj.label));
            if (!objReq) return Promise.resolve({ saved: false, reason: 'no-column' });
            if (!value) return Promise.resolve({ saved: false, reason: 'no-object' });
            var params = {};
            params['t' + objReq] = value;
            Object.keys(WORKSPACE_ACTION).forEach(function(other) {
                if (other === kind) return;
                var rid = configReqId(ctx.table, other);
                if (rid) params['t' + rid] = '';   // пустое значение стирает реквизит (#4366)
            });
            return post(ctx, '_m_set/' + pad.id + '?JSON', params, true).then(function() {
                pad.config[kind] = { id: trimText(obj && obj.id), label: trimText(obj && obj.label) };
                Object.keys(WORKSPACE_ACTION).forEach(function(other) {
                    if (other !== kind) pad.config[other] = null;
                });
                var wsReq = configReqId(ctx.table, 'workspace');
                if (!wsReq) return { saved: true, reason: '' };
                var wsParams = {};
                wsParams['t' + wsReq] = action;
                return post(ctx, '_m_set/' + pad.id + '?JSON', wsParams)
                    .then(function() { pad.config.workspace = action; return { saved: true, reason: '' }; })
                    .catch(function(err) {
                        // Объект записан — этого хватает, чтобы планшет открылся куда надо.
                        if (root.console) root.console.warn('[pad] «' + CONFIG_REQS.workspace + '» не записано:', err && err.message);
                        return { saved: true, reason: 'workspace-not-written' };
                    });
            });
        };
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

    // keepEmpty — пустое значение уходит на сервер и СТИРАЕТ реквизит (#4366); без
    // флага пустые поля просто не отправляются (регистрация нового планшета).
    function post(ctx, path, params, keepEmpty) {
        var body = new root.URLSearchParams();
        body.set('_xsrf', ctx.xsrf);
        Object.keys(params || {}).forEach(function(k) {
            if (params[k] === undefined || params[k] === null) return;
            if (params[k] === '' && !keepEmpty) return;
            body.set(k, params[k]);
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
    // не вычитать, когда пульт перерисует её своей подписью. #4789: там же настройка
    // планшета (какое рабочее место и какой объект) и запись выбора обратно в таблицу.
    function publishPad(ctx, pad) {
        if (!pad) { root.atexPad = null; return; }
        pad.canWrite = canRegister(ctx.table, ctx);
        pad.workspace = padWorkspace(pad);
        pad.setObject = makeSetObject(ctx, pad);
        root.atexPad = pad;
        var slot = root.document.querySelector('.navbar-workspace');
        if (slot && pad.name) slot.textContent = pad.name;
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
                    return padFromRows(rows, token, nameColIndex(ctx.table), ctx.table);
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
                publishPad(ctx, pad);
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
        CONFIG_REQS: CONFIG_REQS,          // #4789
        WORKSPACE_ACTION: WORKSPACE_ACTION, // #4789
        reqByName: reqByName,               // #4789
        configReqId: configReqId,           // #4789
        parseRefValue: parseRefValue,       // #4789
        normalizeWorkspace: normalizeWorkspace, // #4789
        padConfigFromRow: padConfigFromRow, // #4789
        padWorkspace: padWorkspace,         // #4789
        matchPadObject: matchPadObject,     // #4789
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
        ensureToken: ensureToken,   // #4789: код устройства для записи руками
        boot: boot
    };
});
