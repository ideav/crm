(function(window, document) {
    'use strict';

    // РМ «Разметка токенов» (issue #4953): пользователь отмечает, чем является токен —
    // товаром, маркой или моделью. Признаки лежат булевыми реквизитами справочника
    // «Токен» и участвуют в подборе: совпадение по всем трём даёт ТММ, а каждый
    // признак добавляет слагаемое в «Вес» отчёта mass_match. Без разметки ТММ всегда
    // ноль — подбор работает, но ранжирует только по числу общих токенов.
    //
    // Список берётся из отчёта token_usage: он же считает частотность, поэтому
    // сверху оказываются токены, которые влияют на результат сильнее всего.

    var USAGE_REPORT = 'token_usage';
    var TOKEN_TABLE_NAME = 'Токен';
    var FLAGS = [
        { key: 'Товар', column: 'Товар' },
        { key: 'Бренд', column: 'Бренд' },
        { key: 'Модель', column: 'Модель' }
    ];

    var state = {
        root: null,
        db: '',
        flagReqIds: {},     // имя признака → id реквизита
        rows: [],           // { id, token, sku, rfp, flags: {Товар,Бренд,Модель} }
        changed: {},        // id → flags, отложенные до «Сохранить»
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
        var el = document.getElementById('xcom-tokens-status');
        if (!el) return;
        el.textContent = text || '';
        el.className = 'xcom-tokens-status' + (kind === 'error' ? ' xcom-tokens-status-error' : (kind === 'ok' ? ' xcom-tokens-status-ok' : ''));
    }

    // Булев реквизит приходит из отчёта по-разному ('1', 'X', 'true', ''), поэтому
    // истинность определяется явным списком, а не приведением строки к Boolean:
    // непустая строка '0' иначе читалась бы как «отмечено».
    function isTruthyFlag(value) {
        var text = normalizeName(value);
        return text === '1' || text === 'x' || text === 'true' || text === 'да';
    }

    function toNumber(value) {
        var number = Number(String(value == null ? '' : value).replace(',', '.'));
        return isFinite(number) ? number : 0;
    }

    // --- Чистые преобразования (тестируются отдельно) -----------------------

    // Строка отчёта → модель строки РМ.
    function rowFromReport(record) {
        var flags = {};
        FLAGS.forEach(function(flag) { flags[flag.key] = isTruthyFlag(record && record[flag.column]); });
        return {
            id: trimValue(record && record.ID),
            token: trimValue(record && record['Токен']),
            sku: toNumber(record && record['Номенклатур']),
            rfp: toNumber(record && record['Заявок']),
            flags: flags
        };
    }

    // Отбор строк под фильтры интерфейса.
    function filterRows(rows, options) {
        var needle = normalizeName(options && options.search);
        var onlyEmpty = !!(options && options.onlyEmpty);
        var hideRare = !!(options && options.hideRare);
        return (rows || []).filter(function(row) {
            if (needle && normalizeName(row.token).indexOf(needle) === -1) return false;
            if (onlyEmpty && FLAGS.some(function(flag) { return row.flags[flag.key]; })) return false;
            if (hideRare && row.sku + row.rfp <= 1) return false;
            return true;
        });
    }

    // Значения для записи: булев снимается явным нулём, иначе пустое поле
    // выбрасывается из тела запроса и признак остаётся прежним.
    function flagsToForm(flags, reqIds) {
        var parts = [];
        FLAGS.forEach(function(flag) {
            var reqId = reqIds && reqIds[flag.key];
            if (!reqId) return;
            parts.push('t' + encodeURIComponent(reqId) + '=' + (flags[flag.key] ? '1' : '0'));
        });
        return parts.join('&');
    }

    function countMarked(rows) {
        return (rows || []).reduce(function(sum, row) {
            return sum + (FLAGS.some(function(flag) { return row.flags[flag.key]; }) ? 1 : 0);
        }, 0);
    }

    // --- Сеть ---------------------------------------------------------------

    function fetchJson(url) {
        return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
            .then(function(response) {
                return response.text().then(function(text) {
                    if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + text.slice(0, 180));
                    try { return JSON.parse(text); }
                    catch (e) { throw new Error('Ответ не JSON: ' + text.slice(0, 180)); }
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

    // --- Отрисовка ----------------------------------------------------------

    function currentOptions() {
        return {
            search: (document.getElementById('xcom-tokens-search') || {}).value,
            onlyEmpty: !!(document.getElementById('xcom-tokens-only-empty') || {}).checked,
            hideRare: !!(document.getElementById('xcom-tokens-hide-rare') || {}).checked
        };
    }

    function render() {
        var body = document.getElementById('xcom-tokens-rows');
        var empty = document.getElementById('xcom-tokens-empty');
        if (!body) return;
        var visible = filterRows(state.rows, currentOptions());
        body.innerHTML = visible.map(function(row) {
            var cells = FLAGS.map(function(flag) {
                return '<td class="xcom-tokens-col-flag">'
                    + '<input type="checkbox" data-token-id="' + escapeHtml(row.id) + '" data-flag="' + escapeHtml(flag.key) + '"'
                    + (row.flags[flag.key] ? ' checked' : '') + '></td>';
            }).join('');
            return '<tr' + (state.changed[row.id] ? ' class="xcom-tokens-row-changed"' : '') + '>'
                + '<td class="xcom-tokens-col-token">' + escapeHtml(row.token) + '</td>'
                + '<td class="xcom-tokens-col-num">' + row.sku + '</td>'
                + '<td class="xcom-tokens-col-num">' + row.rfp + '</td>'
                + cells + '</tr>';
        }).join('');
        if (empty) empty.hidden = visible.length > 0;

        var progress = document.getElementById('xcom-tokens-progress');
        if (progress) {
            var marked = countMarked(state.rows);
            progress.textContent = 'Размечено ' + marked + ' из ' + state.rows.length
                + (visible.length !== state.rows.length ? ' · показано ' + visible.length : '');
        }
        var save = document.getElementById('xcom-tokens-save');
        if (save) {
            var pending = Object.keys(state.changed).length;
            save.disabled = state.saving || pending === 0;
            save.textContent = pending ? 'Сохранить (' + pending + ')' : 'Сохранить';
        }
    }

    // --- Загрузка и сохранение ----------------------------------------------

    function loadFlagRequisites() {
        return fetchJson('/' + encodePathSegment(state.db) + '/metadata').then(function(payload) {
            var list = Array.isArray(payload) ? payload : [payload];
            var table = null;
            list.some(function(item) {
                if (normalizeName(item && item.val) === normalizeName(TOKEN_TABLE_NAME)) { table = item; return true; }
                return false;
            });
            if (!table) throw new Error('Таблица «' + TOKEN_TABLE_NAME + '» не найдена: разверните шаблон инсталлятором.');
            state.flagReqIds = {};
            (Array.isArray(table.reqs) ? table.reqs : []).forEach(function(req) {
                FLAGS.forEach(function(flag) {
                    if (normalizeName(req && req.val) === normalizeName(flag.key)) state.flagReqIds[flag.key] = String(req.id);
                });
            });
            var missing = FLAGS.filter(function(flag) { return !state.flagReqIds[flag.key]; });
            if (missing.length) {
                throw new Error('У справочника «' + TOKEN_TABLE_NAME + '» нет признаков: '
                    + missing.map(function(flag) { return flag.key; }).join(', ') + '. Обновите схему инсталлятором.');
            }
        });
    }

    function load() {
        setStatus('Загрузка…');
        state.changed = {};
        return loadFlagRequisites().then(function() {
            return fetchJson('/' + encodePathSegment(state.db) + '/report/' + USAGE_REPORT + '?JSON_KV&LIMIT=0,2000');
        }).then(function(payload) {
            if (!Array.isArray(payload)) throw new Error('Отчёт ' + USAGE_REPORT + ' ответил не списком: ' + String(payload).slice(0, 180));
            state.rows = payload.map(rowFromReport).filter(function(row) { return row.id; });
            render();
            setStatus(state.rows.length ? '' : 'Справочник токенов пуст: сначала прогоните токенизацию.', state.rows.length ? '' : 'error');
        }).catch(function(error) {
            setStatus(error.message, 'error');
        });
    }

    function save() {
        var ids = Object.keys(state.changed);
        if (!ids.length || state.saving) return Promise.resolve();
        state.saving = true;
        render();
        setStatus('Сохранение ' + ids.length + '…');
        var failed = [];
        return ids.reduce(function(chain, id) {
            return chain.then(function() {
                return post('/' + encodePathSegment(state.db) + '/_m_set/' + encodePathSegment(id) + '?JSON=1',
                    flagsToForm(state.changed[id], state.flagReqIds))
                    .then(function() { delete state.changed[id]; })
                    .catch(function(error) { failed.push(id + ': ' + error.message); });
            });
        }, Promise.resolve()).then(function() {
            state.saving = false;
            if (failed.length) setStatus('Не сохранено ' + failed.length + ' — ' + failed[0], 'error');
            else setStatus('Сохранено. Признаки подхватит следующий подбор.', 'ok');
            render();
        });
    }

    function onToggle(event) {
        var input = event.target;
        if (!input || input.type !== 'checkbox' || !input.getAttribute('data-token-id')) return;
        var id = input.getAttribute('data-token-id');
        var flag = input.getAttribute('data-flag');
        var row = null;
        state.rows.some(function(item) { if (item.id === id) { row = item; return true; } return false; });
        if (!row) return;
        row.flags[flag] = !!input.checked;
        state.changed[id] = { 'Товар': row.flags['Товар'], 'Бренд': row.flags['Бренд'], 'Модель': row.flags['Модель'] };
        render();
    }

    function bindEvents() {
        var body = document.getElementById('xcom-tokens-rows');
        if (body) body.addEventListener('change', onToggle);
        ['xcom-tokens-search', 'xcom-tokens-only-empty', 'xcom-tokens-hide-rare'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('input', render);
            if (el) el.addEventListener('change', render);
        });
        var save_button = document.getElementById('xcom-tokens-save');
        if (save_button) save_button.addEventListener('click', save);
        var reload = document.getElementById('xcom-tokens-reload');
        if (reload) reload.addEventListener('click', function() { load(); });
    }

    function init() {
        state.root = document.getElementById('xcom-tokens-app');
        if (!state.root) return;
        state.db = state.root.getAttribute('data-db') || window.db || '';
        bindEvents();
        load();
    }

    window.XcomTokensWorkspace = {
        rowFromReport: rowFromReport,
        filterRows: filterRows,
        flagsToForm: flagsToForm,
        countMarked: countMarked,
        isTruthyFlag: isTruthyFlag,
        init: init
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = window.XcomTokensWorkspace;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else if (document.getElementById) {
        init();
    }
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : {});
