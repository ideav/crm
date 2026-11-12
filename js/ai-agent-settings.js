// Issue #5498: шестерёнка ИИ-чата — какая модель отвечает: наш агент или свой LLM-прокси базы.
// Настройка — строки таблицы «Настройка» (269) с «Тип» (271) = AI_LLM_*, значение — главное
// значение строки. Читает её сервис агента (python2node agent-chat, custom_llm.py) токеном
// пользователя; окно получает от GET /{db}/ai/agent/settings только «ключ задан / нет» и id строк,
// а пишет штатными _m_set/_m_new/_m_del — право записи в 269 проверяет ядро.
(function (root, factory) {
    var core = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = core;
    else root.AiAgentSettings = core;
})(typeof window !== 'undefined' ? window : this, function () {
    'use strict';

    var TABLE = 269;
    var TYPE_REQ = 271;
    var KEYS = { provider: 'AI_LLM_PROVIDER', url: 'AI_LLM_URL', model: 'AI_LLM_MODEL', token: 'AI_LLM_TOKEN' };

    // Известные OpenAI-совместимые прокси. link — куда вести за ключом (партнёрская ссылка).
    var PROVIDERS = [
        { id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/api/v1',
          model: 'openai/gpt-4o-mini', link: 'https://openrouter.ai/keys' },
        { id: 'proxyapi', name: 'ProxyAPI (оплата из РФ)', url: 'https://api.proxyapi.ru/openai/v1',
          model: 'gpt-4o-mini', link: 'https://proxyapi.ru/' },
        { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat', link: 'https://platform.deepseek.com/api_keys' },
        { id: 'custom', name: 'Другой (свой адрес)', url: '', model: '', link: '' }
    ];

    function providerById(id) {
        for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === id) return PROVIDERS[i];
        return null;
    }

    function trim(v) { return v === undefined || v === null ? '' : String(v).trim(); }

    // Что записать в «Настройку». state — ответ GET settings ({ids, hasToken}), form — окно
    // ({mode, provider, url, model, token}). Возвращает {error} или {ops: [{path, fields}]}.
    // «Наш токен» удаляет строки AI_LLM_* целиком: ключ чужого прокси в базе не остаётся.
    // Пустой ключ при уже заданном — «не менять» (ключ во фронт не приходит).
    function planSave(state, form) {
        var ids = (state && state.ids) || {};
        var ops = [];
        var del = function (key) {
            if (ids[key]) ops.push({ path: '_m_del/' + ids[key] + '?JSON=1', fields: {} });
        };
        var put = function (key, value) {
            if (value === '') return del(key);
            ops.push(ids[key]
                ? { path: '_m_set/' + ids[key] + '?JSON=1', fields: field(TABLE, value) }
                : { path: '_m_new/' + TABLE + '?JSON=1&up=1', fields: newFields(key, value) });
        };
        if (!form || form.mode !== 'custom') {
            Object.keys(KEYS).forEach(function (k) { del(KEYS[k]); });
            return { ops: ops };
        }
        var url = trim(form.url).replace(/\/+$/, '');
        var token = trim(form.token);
        if (!/^https:\/\/[^\s\/@]+(\/\S*)?$/i.test(url)) return { error: 'Адрес прокси — https://…' };
        if (/\s/.test(token)) return { error: 'В ключе не должно быть пробелов' };
        if (!token && !(state && state.hasToken)) return { error: 'Укажите ключ прокси' };
        put(KEYS.provider, trim(form.provider));
        put(KEYS.url, url);
        put(KEYS.model, trim(form.model));
        if (token) put(KEYS.token, token);
        return { ops: ops };
    }

    function field(req, value) { var f = {}; f['t' + req] = value; return f; }
    function newFields(key, value) {
        var f = field(TABLE, value);
        f['t' + TYPE_REQ] = key;
        return f;
    }

    // Ответ _m_*: JSON с error/warning — отказ; текст «Недостаточно прав» — нет права записи.
    function responseError(status, text) {
        if (/Недостаточно прав|нет доступа|Forbidden/i.test(text || '')) {
            return 'Нет права записи в таблицу «Настройка» — сохранить может сотрудник с этим правом';
        }
        var data = null;
        try { data = JSON.parse(text); } catch (e) { data = null; }
        var first = Array.isArray(data) ? data[0] : data;
        if (first && (first.error || first.err)) return String(first.error || first.err);
        if (status >= 400) return 'Сервер ответил ' + status;
        return '';
    }

    // ───────────────────────── Окно в панели чата ─────────────────────────

    function dbPath(chat, path) {
        return '/' + encodeURIComponent(chat.getCurrentDbName() || 'my') + '/' + path;
    }

    function load(chat) {
        return fetch(dbPath(chat, 'ai/agent/settings?JSON=1'), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); });
    }

    function runOps(chat, ops) {
        return ops.reduce(function (p, op) {
            return p.then(function () {
                var fd = new FormData();
                fd.append('_xsrf', chat.getXsrfToken());
                Object.keys(op.fields).forEach(function (k) { fd.append(k, op.fields[k]); });
                return fetch(dbPath(chat, op.path), { method: 'POST', credentials: 'same-origin', body: fd })
                    .then(function (r) {
                        return r.text().then(function (text) {
                            var err = responseError(r.status, text);
                            if (err) throw new Error(err);
                        });
                    });
            });
        }, Promise.resolve());
    }

    function input(chat, type, value, placeholder) {
        var i = chat.el('input', 'ai-agent-settings-input');
        i.type = type;
        i.value = value || '';
        if (placeholder) i.placeholder = placeholder;
        return i;
    }

    function row(chat, label, control) {
        var l = chat.el('label', 'ai-agent-settings-row');
        l.appendChild(chat.el('span', 'ai-agent-settings-label', label));
        l.appendChild(control);
        return l;
    }

    function radio(chat, name, value, text, checked) {
        var l = chat.el('label', 'ai-agent-settings-mode');
        var r = chat.el('input');
        r.type = 'radio';
        r.name = name;
        r.value = value;
        r.checked = !!checked;
        l.appendChild(r);
        l.appendChild(document.createTextNode(' ' + text));
        return { label: l, input: r };
    }

    function render(chat, box, state) {
        while (box.firstChild) box.removeChild(box.firstChild);
        box.appendChild(chat.el('div', 'ai-agent-settings-title', 'Модель ИИ-чата'));
        if (!state.canRead) {
            box.appendChild(chat.el('div', 'ai-agent-settings-note',
                'Настройка модели хранится в таблице «Настройка», а у вас нет к ней доступа.'));
            return;
        }
        var ours = radio(chat, 'ai-llm-mode', 'ours', 'Наш агент (по умолчанию)', state.mode !== 'custom');
        var custom = radio(chat, 'ai-llm-mode', 'custom', 'Свой LLM-прокси', state.mode === 'custom');
        box.appendChild(ours.label);
        box.appendChild(chat.el('div', 'ai-agent-settings-note',
            'Работает с данными базы: читает таблицы, готовит и применяет изменения.'));
        box.appendChild(custom.label);
        box.appendChild(chat.el('div', 'ai-agent-settings-note',
            'OpenAI-совместимый адрес и ключ. Внешняя модель видит только вопрос и описание экрана, в базу не ходит.'));

        var fields = chat.el('div', 'ai-agent-settings-fields');
        var select = chat.el('select', 'ai-agent-settings-input');
        PROVIDERS.forEach(function (p) {
            var o = chat.el('option', '', p.name);
            o.value = p.id;
            select.appendChild(o);
        });
        select.value = providerById(state.provider) ? state.provider : (state.url ? 'custom' : PROVIDERS[0].id);
        var url = input(chat, 'url', state.url, 'https://…/v1');
        var model = input(chat, 'text', state.model, 'имя модели');
        var token = input(chat, 'password', '', state.hasToken ? 'ключ задан — пусто = не менять' : 'ключ прокси');
        token.autocomplete = 'new-password';
        var keyLink = chat.link('#', 'Получить ключ', 'ai-agent-settings-link');
        var syncProvider = function (fill) {
            var p = providerById(select.value);
            if (fill && p && p.id !== 'custom') { url.value = p.url; model.value = p.model; }
            keyLink.hidden = !(p && p.link);
            if (p && p.link) keyLink.setAttribute('href', p.link);
        };
        select.addEventListener('change', function () { syncProvider(true); });
        if (!state.url) syncProvider(true); else syncProvider(false);
        fields.appendChild(row(chat, 'Прокси', select));
        fields.appendChild(row(chat, 'Адрес', url));
        fields.appendChild(row(chat, 'Модель', model));
        fields.appendChild(row(chat, 'Ключ', token));
        fields.appendChild(keyLink);
        box.appendChild(fields);
        var toggle = function () { fields.hidden = !custom.input.checked; };
        ours.input.addEventListener('change', toggle);
        custom.input.addEventListener('change', toggle);
        toggle();

        var status = chat.el('div', 'ai-agent-settings-status');
        var save = chat.el('button', 'ai-agent-settings-save', 'Сохранить');
        save.type = 'button';
        if (!state.canEdit) {
            [ours.input, custom.input, select, url, model, token, save].forEach(function (c) { c.disabled = true; });
            status.textContent = 'Изменить может сотрудник с правом записи в таблицу «Настройка».';
        }
        save.addEventListener('click', function () {
            var plan = planSave(state, {
                mode: custom.input.checked ? 'custom' : 'ours', provider: select.value,
                url: url.value, model: model.value, token: token.value
            });
            if (plan.error) { status.textContent = plan.error; return; }
            save.disabled = true;
            status.textContent = 'Сохраняем…';
            runOps(chat, plan.ops).then(function () { return load(chat); }).then(function (fresh) {
                render(chat, box, fresh);
                box.querySelector('.ai-agent-settings-status').textContent = 'Сохранено';
            }).catch(function (e) {
                save.disabled = false;
                status.textContent = (e && e.message) || 'Не удалось сохранить';
            });
        });
        box.appendChild(save);
        box.appendChild(status);
    }

    // Открыть/закрыть окно под шапкой чата; box — узел, который создаёт ai-agent-chat.js.
    function toggle(chat, box) {
        if (!box.hidden) { box.hidden = true; return false; }
        box.hidden = false;
        while (box.firstChild) box.removeChild(box.firstChild);
        box.appendChild(chat.el('div', 'ai-agent-settings-note', 'Загрузка…'));
        load(chat).then(function (state) {
            if (state && state.error) throw new Error(state.error);
            render(chat, box, state || {});
        }).catch(function (e) {
            while (box.firstChild) box.removeChild(box.firstChild);
            box.appendChild(chat.el('div', 'ai-agent-settings-note',
                'Не удалось загрузить настройку: ' + ((e && e.message) || e)));
        });
        return true;
    }

    return { PROVIDERS: PROVIDERS, KEYS: KEYS, planSave: planSave, responseError: responseError,
             render: render, toggle: toggle };
});
