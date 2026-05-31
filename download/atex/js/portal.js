/*
 * Рабочее место atex «Клиентский портал» (роль Клиент).
 *
 * Часть #2903 — «Подключи рабочие места по API». На первом этапе рабочее место
 * обращается к таблицам напрямую командами `_m_*`/`object/` (см.
 * docs/atex_workplaces.md §3.10 и docs/WORKSPACE_DEVELOPMENT_GUIDE.md §6).
 *
 * Портал — ТОЛЬКО ЧТЕНИЕ: клиент видит исключительно свои заказы и их статусы.
 * Самостоятельное создание заказа и полноценная изоляция данных через права роли
 * «Клиент» + защищённый слой `report/` — следующая фаза (в объём тикета не входят).
 *
 * Текущий клиент резолвится сопоставлением логина пользователя ({_global_.user})
 * с реквизитом «Логин» таблицы «Клиент»; заказы фильтруются по ссылке «Клиент».
 *
 * Таблицы и реквизиты резолвятся из metadata по имени, чтобы не хардкодить
 * object id и t{reqId} — id зависят от сборки базы:
 *   «Заказ»          — ссылка «Клиент» → «Клиент»
 *   «Позиция заказа» — up={orderId} (подчинённая Заказу)
 *   «Клиент»         — реквизит «Логин» для сопоставления с пользователем.
 */
(function(window, document) {
    'use strict';

    var TABLE = { order: 'Заказ', position: 'Позиция заказа', client: 'Клиент' };
    var LIST_LIMIT = 5000;

    // Статусы заказа — свободный текст (тип 3). Набор для фильтра можно
    // переопределить data-атрибутом data-order-statuses.
    var DEFAULT_ORDER_STATUSES = ['Новый', 'Согласован', 'В производстве', 'Выполнен', 'Отменён'];

    // Карта полей таблицы «Заказ» (только нужное порталу — чтение).
    var ORDER_FIELDS = [
        { key: 'client', label: 'Клиент', names: ['Клиент'], ref: true },
        { key: 'created', label: 'Дата создания', names: ['Дата создания'] },
        { key: 'approved', label: 'Дата согласования', names: ['Дата согласования'] },
        { key: 'status', label: 'Статус', names: ['Статус'], status: true },
        { key: 'notes', label: 'Примечания', names: ['Примечания'] }
    ];

    // Карта полей подчинённой таблицы «Позиция заказа».
    var POSITION_FIELDS = [
        { key: 'qty', label: 'Кол-во', names: ['Кол-во', 'Количество'] },
        { key: 'raw', label: 'Вид сырья', names: ['Вид сырья'], ref: true },
        { key: 'cutType', label: 'Тип резки', names: ['Тип резки'], ref: true },
        { key: 'width', label: 'Ширина, мм', names: ['Ширина, мм', 'Ширина'] },
        { key: 'length', label: 'Длина, м', names: ['Длина, м', 'Длина'] },
        { key: 'sleeve', label: 'Диаметр втулки', names: ['Диаметр втулки'] },
        { key: 'status', label: 'Статус', names: ['Статус'], status: true }
    ];

    // Карта полей таблицы «Клиент» — нужен «Логин» для сопоставления с пользователем.
    var CLIENT_FIELDS = [
        { key: 'login', label: 'Логин', names: ['Логин'] },
        { key: 'email', label: 'Email', names: ['Email', 'E-mail'] }
    ];

    var state = {
        root: null,
        db: '',
        orderTable: '',
        positionTable: '',
        clientTable: '',
        orderStatuses: DEFAULT_ORDER_STATUSES,
        user: '',
        userId: '',
        clientId: '',
        clientLabel: '',
        orderColumns: [],
        positionColumns: [],
        clientColumns: [],
        orders: [],
        positionsByOrder: {},
        expanded: {},
        statusFilter: ''
    };

    // ------------------------------------------------------------------
    // Чистые утилиты (выносятся в AtexPortalTesting для модульных тестов).
    // ------------------------------------------------------------------

    function trimValue(value) {
        return String(value == null ? '' : value).trim();
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeFieldName(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/ё/g, 'е')
            .replace(/[\s_\-\/,.]+/g, '')
            .replace(/[^\wа-я0-9]/g, '');
    }

    function mapTypeToFormat(typeId) {
        var map = {
            '3': 'SHORT', '4': 'DATETIME', '6': 'PWD', '9': 'DATE',
            '12': 'MEMO', '13': 'NUMBER', '14': 'SIGNED'
        };
        return map[String(typeId)] || 'SHORT';
    }

    // Разбор ссылочного значения "id:Отображение" → {id, label}.
    function parseRef(value) {
        var text = String(value == null ? '' : value);
        var idx = text.indexOf(':');
        if (idx <= 0) return { id: text, label: text };
        return { id: text.slice(0, idx), label: text.slice(idx + 1) };
    }

    // Источники реквизитов из metadata: первая колонка (main) + reqs по порядку.
    function buildFieldSources(metadata) {
        var sources = [];
        if (!metadata) return sources;

        sources.push({
            id: String(metadata.id),
            index: 0,
            name: metadata.val || '',
            format: mapTypeToFormat(metadata.type || '3'),
            ref_id: metadata.ref_id || null,
            kind: 'main'
        });

        (metadata.reqs || []).forEach(function(req, idx) {
            sources.push({
                id: String(req.id),
                index: idx + 1,
                name: req.val || '',
                format: req.ref || req.ref_id ? 'REF' : mapTypeToFormat(req.type || '3'),
                ref_id: req.ref_id || (req.ref ? req.id : null),
                arr_id: req.arr_id || null,
                kind: 'req'
            });
        });

        return sources;
    }

    function findSource(def, sources) {
        var wanted = (def.names || []).map(normalizeFieldName);
        for (var i = 0; i < sources.length; i++) {
            if (wanted.indexOf(normalizeFieldName(sources[i].name)) !== -1) {
                return sources[i];
            }
        }
        return null;
    }

    // Привязка карты полей к metadata → массив колонок с источником.
    function buildColumns(fieldDefs, metadata) {
        var sources = buildFieldSources(metadata);
        return fieldDefs.map(function(def) {
            var source = findSource(def, sources);
            return {
                key: def.key,
                label: def.label,
                ref: !!def.ref,
                status: !!def.status,
                source: source,
                reqId: source ? source.id : null
            };
        });
    }

    function findMetadataById(all, id) {
        var wanted = trimValue(id);
        if (!wanted) return null;
        for (var i = 0; i < (all || []).length; i++) {
            if (String(all[i].id) === wanted) return all[i];
        }
        return null;
    }

    function findMetadataByName(all, name) {
        var wanted = normalizeFieldName(name);
        for (var i = 0; i < (all || []).length; i++) {
            if (normalizeFieldName(all[i].val) === wanted) return all[i];
        }
        return null;
    }

    function resolveTableMetadata(all, tableNames, overrides) {
        var resolved = {};
        Object.keys(tableNames || {}).forEach(function(key) {
            var override = trimValue(overrides && overrides[key]);
            var meta = override ? findMetadataById(all, override) : findMetadataByName(all, tableNames[key]);
            if (!meta) {
                throw new Error('В метаданных не найдена таблица «' + tableNames[key] + '»' +
                    (override ? ' (id ' + override + ')' : ''));
            }
            resolved[key] = meta;
        });
        return resolved;
    }

    function getColumn(columns, key) {
        for (var i = 0; i < columns.length; i++) {
            if (columns[i].key === key) return columns[i];
        }
        return null;
    }

    // Нормализация компактного формата JSON_DATA ([{i,u,o,r}]) в записи.
    function normalizeObjects(json, columns) {
        if (!Array.isArray(json)) return [];
        return json.map(function(item) {
            var raw = item && Array.isArray(item.r) ? item.r : [];
            var rec = {
                id: item && item.i != null ? String(item.i) : '',
                up: item && item.u != null ? String(item.u) : '',
                ord: item && item.o != null ? item.o : 0,
                name: raw.length ? String(raw[0] == null ? '' : raw[0]) : '',
                values: {},
                refs: {}
            };
            (columns || []).forEach(function(column) {
                if (!column.source) return;
                var cell = raw[column.source.index];
                cell = cell == null ? '' : String(cell);
                if (column.ref || (column.source && column.source.ref_id)) {
                    var parsed = parseRef(cell);
                    rec.values[column.key] = parsed.label;
                    rec.refs[column.key] = parsed.id;
                } else {
                    rec.values[column.key] = cell;
                }
            });
            return rec;
        });
    }

    // --- Построители запросов (чистые: db/реквизиты передаются явно) ---

    function buildListUrl(db, tableId, parentId, statusReqId, statusValue) {
        var params = ['JSON_DATA', 'LIMIT=' + LIST_LIMIT];
        if (parentId != null && parentId !== '') {
            params.push('F_U=' + encodeURIComponent(parentId));
        }
        if (statusReqId && trimValue(statusValue)) {
            params.push('F_' + statusReqId + '=' + encodeURIComponent(trimValue(statusValue)));
        }
        return '/' + encodeURIComponent(db) + '/object/' + encodeURIComponent(tableId) + '/?' + params.join('&');
    }

    // Сопоставление текущего пользователя с записью «Клиент».
    // Приоритет: реквизит «Логин» === логин пользователя; затем имя клиента
    // (первая колонка) === логин пользователя. Возвращает {id, label} или null.
    function resolveClient(clients, user, columns) {
        var wanted = normalizeFieldName(user);
        if (!wanted) return null;

        var loginCol = getColumn(columns || [], 'login');
        var loginKey = loginCol ? loginCol.key : null;

        // 1) по реквизиту «Логин».
        if (loginKey) {
            for (var i = 0; i < (clients || []).length; i++) {
                var byLogin = clients[i].values ? clients[i].values[loginKey] : '';
                if (byLogin && normalizeFieldName(byLogin) === wanted) {
                    return { id: clients[i].id, label: clients[i].name || byLogin };
                }
            }
        }

        // 2) по имени клиента (первая колонка).
        for (var j = 0; j < (clients || []).length; j++) {
            if (clients[j].name && normalizeFieldName(clients[j].name) === wanted) {
                return { id: clients[j].id, label: clients[j].name };
            }
        }

        return null;
    }

    // Фильтр заказов по клиенту: оставляем только заказы выбранного клиента.
    function filterOrdersByClient(orders, clientId) {
        var id = trimValue(clientId);
        if (!id) return [];
        return (orders || []).filter(function(order) {
            return trimValue(order.refs && order.refs.client) === id;
        });
    }

    // ------------------------------------------------------------------
    // Сетевой слой
    // ------------------------------------------------------------------

    function getApiBase() {
        return state.db || window.db || '';
    }

    function fetchJson(url, options) {
        return fetch(url, options || { credentials: 'same-origin' }).then(function(response) {
            return response.text().then(function(text) {
                var data = null;
                if (text) {
                    try {
                        data = JSON.parse(text);
                    } catch (err) {
                        throw new Error('Сервер вернул ответ не в формате JSON');
                    }
                }
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }
                if (data && typeof data === 'object' && (data.error || data.err)) {
                    throw new Error(String(data.error || data.err));
                }
                return data;
            });
        });
    }

    function loadAllMetadata() {
        return fetchJson('/' + encodeURIComponent(getApiBase()) + '/metadata?JSON=1').then(function(payload) {
            return Array.isArray(payload) ? payload : [];
        });
    }

    // ------------------------------------------------------------------
    // Рендеринг
    // ------------------------------------------------------------------

    function setMessage(text, kind) {
        var el = document.getElementById('atex-portal-message');
        if (!el) return;
        if (!text) {
            el.textContent = '';
            el.className = 'atex-portal-message';
            el.hidden = true;
            return;
        }
        el.textContent = text;
        el.className = 'atex-portal-message atex-portal-message--' + (kind || 'info');
        el.hidden = false;
    }

    function renderFilter() {
        var sel = document.getElementById('atex-portal-filter');
        if (!sel) return;
        sel.innerHTML = ['<option value="">Все статусы</option>'].concat(state.orderStatuses.map(function(status) {
            var selected = status === state.statusFilter ? ' selected' : '';
            return '<option value="' + escapeHtml(status) + '"' + selected + '>' + escapeHtml(status) + '</option>';
        })).join('');
    }

    function filteredOrders() {
        if (!state.statusFilter) return state.orders;
        return state.orders.filter(function(order) {
            return trimValue(order.values.status) === trimValue(state.statusFilter);
        });
    }

    function statusBadge(status) {
        var text = trimValue(status);
        if (!text) return '<span class="atex-portal-badge atex-portal-badge--none">—</span>';
        var cls = 'atex-portal-badge--' + normalizeFieldName(text);
        return '<span class="atex-portal-badge ' + cls + '">' + escapeHtml(text) + '</span>';
    }

    function renderPositions(order) {
        var positions = state.positionsByOrder[order.id] || [];
        var head = '<thead><tr>' +
            '<th>Кол-во</th><th>Вид сырья</th><th>Тип резки</th>' +
            '<th>Ширина, мм</th><th>Длина, м</th><th>Ø втулки</th><th>Статус</th>' +
            '</tr></thead>';
        var body;
        if (!positions.length) {
            body = '<tbody><tr><td colspan="7" class="atex-portal-empty">Позиций пока нет.</td></tr></tbody>';
        } else {
            body = '<tbody>' + positions.map(function(pos) {
                return '<tr data-position-id="' + escapeHtml(pos.id) + '">' +
                    '<td>' + escapeHtml(pos.values.qty || '') + '</td>' +
                    '<td>' + escapeHtml(pos.values.raw || '') + '</td>' +
                    '<td>' + escapeHtml(pos.values.cutType || '') + '</td>' +
                    '<td>' + escapeHtml(pos.values.width || '') + '</td>' +
                    '<td>' + escapeHtml(pos.values.length || '') + '</td>' +
                    '<td>' + escapeHtml(pos.values.sleeve || '') + '</td>' +
                    '<td>' + statusBadge(pos.values.status) + '</td>' +
                    '</tr>';
            }).join('') + '</tbody>';
        }

        return '<div class="atex-portal-positions">' +
            '<table class="atex-portal-subtable">' + head + body + '</table>' +
            '</div>';
    }

    function renderOrders() {
        var container = document.getElementById('atex-portal-list');
        if (!container) return;

        var orders = filteredOrders();
        if (!orders.length) {
            container.innerHTML = '<div class="atex-portal-empty">' +
                (state.orders.length ? 'Нет заказов с выбранным статусом.' : 'У вас пока нет заказов.') +
                '</div>';
            return;
        }

        var rows = orders.map(function(order) {
            var positions = state.positionsByOrder[order.id] || [];
            var isOpen = !!state.expanded[order.id];
            var main = '<tr class="atex-portal-row" data-order-id="' + escapeHtml(order.id) + '">' +
                '<td class="atex-portal-toggle-cell"><button type="button" class="atex-portal-toggle" data-toggle="' + escapeHtml(order.id) + '" title="Позиции">' +
                '<i class="pi ' + (isOpen ? 'pi-chevron-down' : 'pi-chevron-right') + '"></i></button></td>' +
                '<td>' + escapeHtml(order.id) + '</td>' +
                '<td>' + escapeHtml(order.values.created || '') + '</td>' +
                '<td>' + statusBadge(order.values.status) + '</td>' +
                '<td class="atex-portal-count">' + (state.positionsByOrder[order.id] ? positions.length : '…') + '</td>' +
                '</tr>';
            var detail = isOpen
                ? '<tr class="atex-portal-detail-row"><td colspan="5">' + renderPositions(order) + '</td></tr>'
                : '';
            return main + detail;
        }).join('');

        container.innerHTML = '<table class="atex-portal-table">' +
            '<thead><tr><th></th><th>№</th><th>Дата создания</th><th>Статус</th><th>Позиций</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table>';
    }

    // ------------------------------------------------------------------
    // Загрузка данных
    // ------------------------------------------------------------------

    function loadOrders() {
        var url = buildListUrl(getApiBase(), state.orderTable, null, null, '');
        return fetchJson(url).then(function(json) {
            var all = normalizeObjects(json, state.orderColumns);
            // Изоляция данных клиента: оставляем только свои заказы. Полноценная
            // защита (права роли + report/) — следующая фаза (см. docs §3.10/§4).
            state.orders = filterOrdersByClient(all, state.clientId).sort(function(a, b) {
                return Number(b.id) - Number(a.id);
            });
            renderOrders();
        });
    }

    function loadPositions(orderId) {
        var url = buildListUrl(getApiBase(), state.positionTable, orderId, null, '');
        return fetchJson(url).then(function(json) {
            state.positionsByOrder[orderId] = normalizeObjects(json, state.positionColumns);
            renderOrders();
        });
    }

    function loadClient() {
        // Явная привязка имеет приоритет над сопоставлением по логину.
        if (state.clientId) return Promise.resolve(state.clientId);
        if (!state.user) return Promise.resolve('');
        var url = buildListUrl(getApiBase(), state.clientTable, null, null, '');
        return fetchJson(url).then(function(json) {
            var clients = normalizeObjects(json, state.clientColumns);
            var match = resolveClient(clients, state.user, state.clientColumns);
            if (match) {
                state.clientId = match.id;
                state.clientLabel = match.label;
            }
            return state.clientId;
        });
    }

    // ------------------------------------------------------------------
    // События
    // ------------------------------------------------------------------

    function attachEvents() {
        var filter = document.getElementById('atex-portal-filter');
        if (filter) {
            filter.addEventListener('change', function() {
                state.statusFilter = filter.value || '';
                renderOrders();
            });
        }

        var refresh = document.getElementById('atex-portal-refresh');
        if (refresh) {
            refresh.addEventListener('click', function() {
                state.positionsByOrder = {};
                state.expanded = {};
                loadOrders();
            });
        }

        var list = document.getElementById('atex-portal-list');
        if (list) {
            list.addEventListener('click', function(event) {
                var toggle = event.target.closest('[data-toggle]');
                if (!toggle) return;
                var orderId = toggle.getAttribute('data-toggle');
                state.expanded[orderId] = !state.expanded[orderId];
                if (state.expanded[orderId] && !state.positionsByOrder[orderId]) {
                    loadPositions(orderId);
                } else {
                    renderOrders();
                }
            });
        }
    }

    // ------------------------------------------------------------------
    // Инициализация
    // ------------------------------------------------------------------

    function parseStatusesAttr(value, fallback) {
        var text = trimValue(value);
        if (!text) return fallback;
        var list = text.split(',').map(trimValue).filter(Boolean);
        return list.length ? list : fallback;
    }

    function init() {
        state.root = document.getElementById('atex-portal-app');
        if (!state.root) return;

        state.db = window.db || state.root.getAttribute('data-db') || '';
        var tableOverrides = {
            order: state.root.getAttribute('data-order-table'),
            position: state.root.getAttribute('data-position-table'),
            client: state.root.getAttribute('data-client-table')
        };
        state.orderStatuses = parseStatusesAttr(state.root.getAttribute('data-order-statuses'), DEFAULT_ORDER_STATUSES);
        state.user = trimValue(state.root.getAttribute('data-user')) ||
            (typeof window.user !== 'undefined' ? trimValue(window.user) : '');
        state.userId = trimValue(state.root.getAttribute('data-user-id'));
        state.clientId = trimValue(state.root.getAttribute('data-client-id'));

        attachEvents();
        renderFilter();
        setMessage('Загрузка данных…', 'info');

        loadAllMetadata().then(function(allMetadata) {
            var metas = resolveTableMetadata(allMetadata, TABLE, tableOverrides);
            state.orderTable = String(metas.order.id || '');
            state.positionTable = String(metas.position.id || '');
            state.clientTable = String(metas.client.id || '');
            state.orderColumns = buildColumns(ORDER_FIELDS, metas.order || {});
            state.positionColumns = buildColumns(POSITION_FIELDS, metas.position || {});
            state.clientColumns = buildColumns(CLIENT_FIELDS, metas.client || {});
            return loadClient();
        }).then(function(clientId) {
            if (!clientId) {
                setMessage('Не удалось определить клиента для пользователя «' +
                    (state.user || '—') + '». Обратитесь к менеджеру.', 'error');
                renderOrders();
                return;
            }
            setMessage('');
            return loadOrders();
        }).catch(function(error) {
            setMessage('Ошибка загрузки: ' + (error.message || error), 'error');
        });
    }

    // Публичный API для отладки/тестов.
    window.AtexPortal = {
        init: init,
        reload: loadOrders
    };

    // Чистые функции — для модульных тестов (без DOM/сети).
    window.AtexPortalTesting = {
        normalizeFieldName: normalizeFieldName,
        parseRef: parseRef,
        buildFieldSources: buildFieldSources,
        buildColumns: buildColumns,
        findMetadataByName: findMetadataByName,
        resolveTableMetadata: resolveTableMetadata,
        normalizeObjects: normalizeObjects,
        buildListUrl: buildListUrl,
        resolveClient: resolveClient,
        filterOrdersByClient: filterOrdersByClient,
        TABLE: TABLE,
        ORDER_FIELDS: ORDER_FIELDS,
        POSITION_FIELDS: POSITION_FIELDS,
        CLIENT_FIELDS: CLIENT_FIELDS,
        DEFAULT_ORDER_STATUSES: DEFAULT_ORDER_STATUSES
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
