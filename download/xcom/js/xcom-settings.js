(function(window, document) {
    'use strict';

    // РМ «Настройки сопоставления» (issue #4817, ТЗ #4816 §3.8): партнёр правит конфиг категории
    // номенклатуры формой, не кодом и не запросами. Конфиг хранится строкой 'config' в таблице
    // «Настройка сопоставления» (главное значение — ключ, реквизит «Значение» — JSON); валидация —
    // тем же validateMatchingConfig, что работает в массовом подборе (скрипт подключён раньше),
    // поэтому невалидное просто не сохранится и не доедет до подбора.
    //
    // На базе без таблицы (свежая, до инсталлятора шаблона) форма показывается, но сохранение
    // выключено с внятным объяснением — паттерн «не молчим» из #4059.

    var SETTINGS_TABLE_NAME = 'Настройка сопоставления';
    var SETTINGS_CONFIG_KEY = 'config';
    var VALUE_REQ_NAME = 'Значение';   // реквизит таблицы с JSON-конфигом

    var state = {
        root: null,
        db: '',
        tableId: null,
        valueReqId: null,
        recordId: null,   // строка 'config' (null — ещё не создана)
        config: null,
        saving: false
    };

    function trimValue(value) {
        return String(value == null ? '' : value).trim();
    }

    function normalizeName(value) {
        return trimValue(value).toLowerCase();
    }

    function encodePathSegment(value) {
        return encodeURIComponent(String(value == null ? '' : value));
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function setStatus(text, kind) {
        var el = document.getElementById('xcom-settings-status');
        if (!el) return;
        el.textContent = text || '';
        el.className = 'xcom-settings-status' + (kind === 'error' ? ' xcom-settings-status-error' : (kind === 'ok' ? ' xcom-settings-status-ok' : ''));
    }

    // --- Чистые преобразования форма ↔ конфиг (тестируются отдельно) ---------

    // Конфиг → поля формы: дефолты достаются явно, чтобы форма не показывала пустоту
    // на конфиге без ключей (частичный override в таблице).
    function formFromConfig(config) {
        var cfg = config && typeof config === 'object' ? config : {};
        var weight = (typeof cfg.tma_weight === 'number' && isFinite(cfg.tma_weight))
            ? Math.max(0, Math.min(1, cfg.tma_weight))
            : 0.5;
        var attrs = Array.isArray(cfg.required_attributes)
            ? cfg.required_attributes.map(function(attr) {
                return {
                    rfp_key: trimValue(attr && attr.rfp_key),
                    sku_key: trimValue(attr && attr.sku_key)
                };
            })
            : [];
        if (!attrs.length) attrs.push({ rfp_key: '', sku_key: '' });
        return { tma_weight: weight, required_attributes: attrs };
    }

    // Поля формы → конфиг: пустые строки атрибутов отбрасываются (незаконченную строку
    // партнёр не должен превращать в невалидную запись схемы).
    function configFromForm(form) {
        var attrs = (form.required_attributes || []).filter(function(attr) {
            return trimValue(attr.rfp_key) && trimValue(attr.sku_key);
        }).map(function(attr) {
            return { rfp_key: trimValue(attr.rfp_key), sku_key: trimValue(attr.sku_key) };
        });
        return {
            tma_weight: Math.max(0, Math.min(1, Number(form.tma_weight))),
            required_attributes: attrs
        };
    }

    // --- Рендер формы ---------------------------------------------------------

    function attrRow(attr) {
        var row = document.createElement('div');
        row.className = 'xcom-settings-attr';
        row.innerHTML =
            '<input class="xcom-settings-input xcom-settings-attr-rfp" type="text" placeholder="Колонка RFP (например, Бренд RFP)" value="' + escapeHtml(attr.rfp_key) + '">' +
            '<span class="xcom-settings-attr-sep">↔</span>' +
            '<input class="xcom-settings-input xcom-settings-attr-sku" type="text" placeholder="Колонка SKU (например, Бренд SKU)" value="' + escapeHtml(attr.sku_key) + '">' +
            '<button class="xcom-settings-btn xcom-settings-btn-danger xcom-settings-attr-remove" type="button" title="Убрать атрибут">×</button>';
        row.querySelector('.xcom-settings-attr-remove').addEventListener('click', function() {
            row.parentNode.removeChild(row);
        });
        return row;
    }

    function renderForm() {
        var form = formFromConfig(state.config);
        var weight = document.getElementById('xcom-settings-tma-weight');
        if (weight) weight.value = String(form.tma_weight);
        var list = document.getElementById('xcom-settings-attrs-list');
        if (list) {
            list.innerHTML = '';
            form.required_attributes.forEach(function(attr) {
                list.appendChild(attrRow(attr));
            });
        }
    }

    function collectForm() {
        var weight = document.getElementById('xcom-settings-tma-weight');
        var rows = (document.querySelectorAll('#xcom-settings-attrs-list .xcom-settings-attr') || []);
        var attrs = [];
        Array.prototype.forEach.call(rows, function(row) {
            var rfp = row.querySelector('.xcom-settings-attr-rfp');
            var sku = row.querySelector('.xcom-settings-attr-sku');
            attrs.push({ rfp_key: rfp ? rfp.value : '', sku_key: sku ? sku.value : '' });
        });
        return configFromForm({ tma_weight: weight ? weight.value : 0.5, required_attributes: attrs });
    }

    // --- HTTP ------------------------------------------------------------------

    function fetchJson(url) {
        return fetch(url, { credentials: 'same-origin' }).then(function(response) {
            return response.text().then(function(text) {
                if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + text.slice(0, 180));
                try { return JSON.parse(text); } catch (e) { throw new Error('Сервер вернул ответ не в формате JSON'); }
            });
        });
    }

    function post(url, params) {
        var body = '_xsrf=' + encodeURIComponent((window.xsrf || '')) + '&' + params;
        return fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body
        }).then(function(response) {
            return response.text().then(function(text) {
                if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + text.slice(0, 180));
                return text;
            });
        });
    }

    // --- Загрузка -------------------------------------------------------------

    function load() {
        setStatus('Загрузка…');
        var metaUrl = '/' + encodePathSegment(state.db) + '/metadata';
        return fetchJson(metaUrl).then(function(payload) {
            var list = Array.isArray(payload) ? payload : [payload];
            var overrideId = trimValue(state.root.getAttribute('data-settings-table'));
            var table = null;
            list.some(function(item) {
                var names = [item && item.val, item && item.name, item && item.value];
                var byName = names.some(function(n) { return normalizeName(n) === normalizeName(SETTINGS_TABLE_NAME); });
                if (byName || (overrideId && item && String(item.id) === overrideId)) { table = item; return true; }
                return false;
            });
            if (!table || !table.id) {
                state.tableId = null;
                renderForm();
                var save = document.getElementById('xcom-settings-save');
                if (save) save.disabled = true;
                setStatus('Таблица «' + SETTINGS_TABLE_NAME + '» не найдена: добавьте её в базу (инсталлятор шаблона или docs/kb/schema.md) и обновите страницу.', 'error');
                return;
            }
            state.tableId = String(table.id);
            var reqs = (table && Array.isArray(table.reqs)) ? table.reqs : [];
            var overrideReq = trimValue(state.root.getAttribute('data-value-field-id'));
            reqs.some(function(req) {
                if (overrideReq && String(req.id) === overrideReq) { state.valueReqId = String(req.id); return true; }
                var attrs = req && typeof req.attrs === 'string' ? req.attrs : '';
                var m = attrs.match(/alias\s*=\s*([^;\s]+)/);
                var alias = (m && m[1]) || (req && (req.val || req.name)) || '';
                if (normalizeName(alias) === normalizeName(VALUE_REQ_NAME)) { state.valueReqId = String(req.id); return true; }
                return false;
            });

            var rowsUrl = '/' + encodePathSegment(state.db) + '/object/' + encodePathSegment(state.tableId) + '/?JSON_OBJ&LIMIT=0,20';
            return fetchJson(rowsUrl).then(function(rows) {
                state.recordId = null;
                state.config = {};
                (Array.isArray(rows) ? rows : []).some(function(rec) {
                    if (normalizeName(rec && rec.r && rec.r[0]) !== SETTINGS_CONFIG_KEY) return false;
                    state.recordId = String(rec.i != null ? rec.i : '');
                    var raw = rec.r && rec.r[1] != null ? String(rec.r[1]) : '';
                    if (raw.trim()) {
                        try { state.config = JSON.parse(raw); } catch (e) {
                            setStatus('Строка «config» не JSON (' + e.message + ') — форма показывает дефолты, сохранение исправит.', 'error');
                        }
                    }
                    return true;
                });
                renderForm();
                var save = document.getElementById('xcom-settings-save');
                if (save) save.disabled = !state.valueReqId;
                if (!state.valueReqId) {
                    setStatus('В таблице не найден реквизит «' + VALUE_REQ_NAME + '» (или задайте data-value-field-id).', 'error');
                } else {
                    setStatus('');
                }
            });
        }).catch(function(error) {
            setStatus(error && error.message ? error.message : 'Не удалось загрузить настройки.', 'error');
        });
    }

    function save() {
        if (state.saving) return;
        var config = collectForm();
        var validate = window.XcomMassMatchWorkspace && window.XcomMassMatchWorkspace.validateMatchingConfig;
        var errors = validate ? Array.prototype.slice.call(validate(config)) : [];
        if (errors.length) {
            setStatus('Конфиг не сохранён — ' + errors.join('; '), 'error');
            return;
        }
        state.saving = true;
        setStatus('Сохранение…');
        var json = JSON.stringify(config);
        var url;
        var params;
        if (state.recordId) {
            url = '/' + encodePathSegment(state.db) + '/_m_set/' + encodePathSegment(state.recordId) + '?JSON';
            params = 't' + encodeURIComponent(state.valueReqId) + '=' + encodeURIComponent(json);
        } else {
            // строки ещё нет — создаём: главное значение = ключ 'config' (t{tableId}), значение — JSON
            url = '/' + encodePathSegment(state.db) + '/_m_new/' + encodePathSegment(state.tableId) + '?JSON=1';
            params = 'up=1&t' + encodeURIComponent(state.tableId) + '=' + encodeURIComponent(SETTINGS_CONFIG_KEY) +
                '&t' + encodeURIComponent(state.valueReqId) + '=' + encodeURIComponent(json);
        }
        post(url, params).then(function() {
            state.config = config;
            setStatus('Сохранено. Массовый подбор возьмёт конфиг при следующем открытии страницы.', 'ok');
        }).catch(function(error) {
            setStatus(error && error.message ? error.message : 'Не удалось сохранить.', 'error');
        }).then(function() {
            state.saving = false;
        });
    }

    function bindEvents() {
        var form = document.getElementById('xcom-settings-form');
        if (form) form.addEventListener('submit', function(event) {
            event.preventDefault();
            save();
        });
        var add = document.getElementById('xcom-settings-add-attr');
        if (add) add.addEventListener('click', function() {
            var list = document.getElementById('xcom-settings-attrs-list');
            if (list) list.appendChild(attrRow({ rfp_key: '', sku_key: '' }));
        });
    }

    function init() {
        state.root = document.getElementById('xcom-matching-settings-app');
        if (!state.root) return;
        state.db = state.root.getAttribute('data-db') || window.db || '';
        bindEvents();
        load();
    }

    window.XcomMatchingSettingsWorkspace = {
        formFromConfig: formFromConfig,
        configFromForm: configFromForm,
        init: init
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : {});
