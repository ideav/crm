/*
 * Рабочее место atex «Приём и ведение заказов» (роль Менеджер).
 *
 * Часть #2903 — «Подключи рабочие места по API». На первом этапе рабочее место
 * обращается к таблицам напрямую командами `_m_*` (см. docs/atex_workplaces.md §3.1
 * и docs/WORKSPACE_DEVELOPMENT_GUIDE.md §3). Перевод чтений на защищённый слой
 * `report/` — следующий этап и в объём этого тикета не входит.
 *
 * Таблицы и реквизиты резолвятся из metadata по имени, чтобы не хардкодить
 * object id и t{reqId} — id зависят от сборки базы:
 *   «Заказ»            — up=1
 *   «Позиция заказа»   — up={orderId} (подчинённая Заказу)
 *   «Клиент», «Вид сырья», «Тип резки» — ссылки.
 */
(function(window, document) {
    'use strict';

    var TABLE = { order: 'Заказ', position: 'Позиция заказа' };
    var REF_OPTIONS_LIMIT = 500;
    var REF_SEARCH_LIMIT = 50;
    var REF_DROPDOWN_LIMIT = 80;
    var REF_SEARCH_DELAY = 250;
    var LIST_LIMIT = 5000;
    var STRIPS_LIMIT = 1000;

    // Статусы — свободный текст (тип 3), поэтому фиксируем разумные наборы.
    // Их можно переопределить data-атрибутами data-order-statuses / data-position-statuses.
    var DEFAULT_ORDER_STATUSES = ['Новый', 'Согласован', 'В производстве', 'Выполнен', 'Отменён'];
    var DEFAULT_POSITION_STATUSES = ['Новая', 'В работе', 'Готова', 'Отгружена'];

    // Карта полей таблицы «Заказ»: ключ → возможные имена реквизита в metadata.
    var ORDER_FIELDS = [
        { key: 'client', label: 'Клиент', names: ['Клиент'], ref: true },
        { key: 'manager', label: 'Менеджер', names: ['Менеджер', 'Пользователь'], ref: true },
        { key: 'created', label: 'Дата создания', names: ['Дата создания'] },
        { key: 'approved', label: 'Дата согласования', names: ['Дата согласования'] },
        { key: 'status', label: 'Статус', names: ['Статус'], status: true },
        { key: 'lead', label: 'Лидер', names: ['Лидер'] },
        { key: 'notes', label: 'Примечания', names: ['Примечания'] },
        // Счётчик подчинённых позиций (ROLLUP-колонка «Позиция заказа») — приходит
        // в записи заказа сразу, до ленивой загрузки самих позиций.
        { key: 'posCount', label: 'Позиций', names: ['Позиция заказа'] }
    ];

    // Карта полей подчинённой таблицы «Позиция заказа».
    var POSITION_FIELDS = [
        { key: 'qty', label: 'Кол-во', names: ['Кол-во', 'Количество'] },
        { key: 'raw', label: 'Вид сырья', names: ['Вид сырья'], ref: true },
        { key: 'cutType', label: 'Тип резки', names: ['Тип резки'], ref: true },
        { key: 'width', label: 'Ширина, мм', names: ['Ширина, мм', 'Ширина'] },
        { key: 'length', label: 'Длина, м', names: ['Длина, м', 'Длина'] },
        { key: 'sleeve', label: 'Диаметр втулки', names: ['Диаметр втулки'], ref: true },
        { key: 'winding', label: 'Тип намотки', names: ['Тип намотки'] },
        { key: 'status', label: 'Статус', names: ['Статус'], status: true }
    ];

    var state = {
        root: null,
        db: '',
        orderTable: '',
        positionTable: '',
        orderStatuses: DEFAULT_ORDER_STATUSES,
        positionStatuses: DEFAULT_POSITION_STATUSES,
        orderMeta: null,
        positionMeta: null,
        orderColumns: [],
        positionColumns: [],
        orders: [],
        positionsByOrder: {},
        expanded: {},
        statusFilter: '',
        refOptions: {},
        refSearchSeq: 0,
        creating: false,
        metadata: [],
        cutTypeIndex: {},           // { typeId: { materialId, widths? } }
        stripsLoadedMaterials: {}   // { materialId: true } — для каких сырьёв полосы уже грузили
    };

    // ------------------------------------------------------------------
    // Чистые утилиты (выносятся в AtexOrdersTesting для модульных тестов).
    // ------------------------------------------------------------------

    function trimValue(value) {
        return String(value == null ? '' : value).trim();
    }

    function normalizeSearchText(value) {
        return trimValue(value).toLowerCase().replace(/ё/g, 'е');
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

    // Терпимый разбор ширины: запятая как десятичный разделитель, пробелы прочь.
    // Пусто/мусор → NaN (чтобы «нет ширины» отличалось от 0).
    function parseWidth(value) {
        var s = String(value == null ? '' : value).replace(/\s+/g, '').replace(/,/g, '.');
        if (s === '') return NaN;
        var x = parseFloat(s);
        return isFinite(x) ? x : NaN;
    }

    // Допустимые значения «Тип намотки»; экспортируется для движка планирования (D2/D3).
    // Нормализация значения поля «Тип намотки»: IN/OUT (или пусто).
    var WINDING_VALUES = ['IN', 'OUT'];
    function normalizeWinding(value) {
        var s = String(value == null ? '' : value).trim().toUpperCase();
        return (s === 'IN' || s === 'OUT') ? s : '';
    }

    // Подбор подходящих типов резки.
    // index: { typeId: { materialId, widths:[Number,...] } } — widths может отсутствовать.
    // Фильтр по сырью; при заданной ширине — точное совпадение с одной из ширин полос
    //   (типы без загруженных полос при заданной ширине отсеиваются).
    function matchCutTypes(index, materialId, width) {
        var ids = Object.keys(index || {});
        var mat = materialId == null ? '' : String(materialId);
        if (mat !== '') {
            ids = ids.filter(function(id) { return String(index[id].materialId) === mat; });
        }
        var w = parseWidth(width);
        if (!isNaN(w)) {
            ids = ids.filter(function(id) {
                var ws = index[id].widths;
                if (!ws) return false;
                return ws.some(function(x) { return Number(x) === w; });
            });
        }
        return ids;
    }

    // Плоские строки отчёта orders_list (JSON_KV) → [{ id, values, positions:[{id,values}] }].
    // Заказы dedup по order_id; позиции из строк с непустым position_id; пустые поля LEFT JOIN ('').
    function rowsToOrders(rows) {
        var byId = {}, order = [];
        function s(v) { return v == null ? '' : String(v); }
        (rows || []).forEach(function(r) {
            var oid = s(r.order_id);
            if (oid && !byId[oid]) {
                byId[oid] = { id: oid, values: {
                    no: s(r.order_no), client: s(r.order_client), manager: s(r.order_manager),
                    created: s(r.order_created), approved: s(r.order_approved), status: s(r.order_status)
                }, positions: [] };
                order.push(oid);
            }
            var pid = s(r.position_id);
            if (oid && pid) {
                byId[oid].positions.push({ id: pid, values: {
                    qty: s(r.position_qty), raw: s(r.position_raw), cutType: s(r.position_cut_type),
                    width: s(r.position_width), length: s(r.position_length), sleeve: s(r.position_sleeve),
                    winding: s(r.position_winding), status: s(r.position_status)
                } });
            }
        });
        return order.map(function(id) { return byId[id]; });
    }

    // Клиентский поиск по всем полям заказа и его позиций.
    function searchOrders(list, query) {
        var q = normalizeSearchText(query);
        if (!q) return (list || []).slice();
        return (list || []).filter(function(o) {
            var hay = [o.id].concat(Object.keys(o.values).map(function(k){ return o.values[k]; }));
            (o.positions || []).forEach(function(p) {
                hay.push(p.id);
                Object.keys(p.values).forEach(function(k){ hay.push(p.values[k]); });
            });
            return normalizeSearchText(hay.join(' ')).indexOf(q) !== -1;
        });
    }

    // Индекс колонки JSON_OBJ по имени реквизита: позиция в [tableId, ...reqIds]; -1 если нет.
    function findReqIndex(meta, reqName) {
        if (!meta) return -1;
        var order = [String(meta.id)].concat((meta.reqs || []).map(function(r){ return String(r.id); }));
        var req = (meta.reqs || []).filter(function(r){ return String(r.val).trim().toLowerCase() === String(reqName).trim().toLowerCase(); })[0];
        return req ? order.indexOf(String(req.id)) : -1;
    }

    // Разбор ссылочного значения "id:Отображение" → {id, label}.
    function parseRef(value) {
        var text = String(value == null ? '' : value);
        var idx = text.indexOf(':');
        if (idx <= 0) return { id: text, label: text };
        return { id: text.slice(0, idx), label: text.slice(idx + 1) };
    }

    function parseRefOptionsData(data) {
        var entries = [];
        if (Array.isArray(data)) {
            data.forEach(function(item) {
                if (Array.isArray(item)) {
                    entries.push({ id: String(item[0]), text: String(item[1] == null ? item[0] : item[1]) });
                } else if (item && typeof item === 'object') {
                    var id = item.id != null ? item.id : item.i;
                    var text = item.text != null ? item.text : (item.val != null ? item.val : id);
                    if (id != null) entries.push({ id: String(id), text: String(text) });
                }
            });
        } else if (data && typeof data === 'object') {
            Object.keys(data).forEach(function(id) {
                entries.push({ id: String(id), text: String(data[id]) });
            });
        }
        return entries;
    }

    function mergeRefOptions(existing, incoming) {
        var result = (existing || []).slice();
        var known = {};
        result.forEach(function(opt) {
            known[String(opt.id)] = true;
        });
        (incoming || []).forEach(function(opt) {
            if (known[String(opt.id)]) return;
            known[String(opt.id)] = true;
            result.push(opt);
        });
        return result;
    }

    function findRefOption(options, current) {
        var wanted = String(current == null ? '' : current);
        if (!wanted) return null;
        for (var i = 0; i < (options || []).length; i++) {
            if (String(options[i].id) === wanted) return options[i];
        }
        return null;
    }

    function filterRefOptions(options, query, limit) {
        var needle = normalizeSearchText(query);
        var max = limit || REF_DROPDOWN_LIMIT;
        var result = [];
        (options || []).forEach(function(opt) {
            if (result.length >= max) return;
            var text = normalizeSearchText(opt.text);
            var id = normalizeSearchText(opt.id);
            if (!needle || text.indexOf(needle) !== -1 || id.indexOf(needle) !== -1) {
                result.push(opt);
            }
        });
        return result;
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

    // ID новой записи из ответа _m_new: { "obj": 649 }.
    function extractNewObjectId(response) {
        if (!response || typeof response !== 'object') return null;
        if (response.obj != null) return String(response.obj);
        if (response.id != null) return String(response.id);
        return null;
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

    function buildRefOptionsUrl(db, refReqId, query, limit) {
        var url = '/' + encodeURIComponent(db) + '/_ref_reqs/' + encodeURIComponent(refReqId) +
            '?JSON&LIMIT=' + encodeURIComponent(limit || REF_OPTIONS_LIMIT);
        var search = trimValue(query);
        if (search) {
            url += '&q=' + encodeURIComponent(search);
        }
        return url;
    }

    // Тело POST: {t{reqId}: value, ...} + _xsrf → application/x-www-form-urlencoded.
    function buildFormBody(fields, xsrf) {
        var params = [];
        if (xsrf) params.push('_xsrf=' + encodeURIComponent(xsrf));
        Object.keys(fields || {}).forEach(function(reqId) {
            var value = fields[reqId];
            if (value == null) return;
            params.push('t' + reqId + '=' + encodeURIComponent(value));
        });
        return params.join('&');
    }

    // Запрос на создание заказа: POST _m_new/{orderTable}?JSON&up=1 + реквизиты.
    function buildCreateOrderRequest(opts) {
        var fields = {};
        var cols = opts.columns || [];
        function put(key, value) {
            if (value == null || value === '') return;
            var col = getColumn(cols, key);
            if (col && col.reqId) fields[col.reqId] = value;
        }
        put('client', opts.clientId);
        put('manager', opts.managerId);
        put('created', opts.created);
        put('status', opts.status);
        put('notes', opts.notes);

        var url = '/' + encodeURIComponent(opts.db) + '/_m_new/' +
            encodeURIComponent(opts.tableId) + '?JSON&up=1';
        return { url: url, body: buildFormBody(fields, opts.xsrf) };
    }

    // Запрос на создание позиции: POST _m_new/{positionTable}?JSON&up={orderId} + реквизиты.
    function buildCreatePositionRequest(opts) {
        var fields = {};
        var cols = opts.columns || [];
        function put(key, value) {
            if (value == null || value === '') return;
            var col = getColumn(cols, key);
            if (col && col.reqId) fields[col.reqId] = value;
        }
        put('qty', opts.qty);
        put('raw', opts.rawId);
        put('cutType', opts.cutTypeId);
        put('width', opts.width);
        put('length', opts.length);
        put('sleeve', opts.sleeve);
        put('winding', normalizeWinding(opts.winding));
        put('status', opts.status);

        var url = '/' + encodeURIComponent(opts.db) + '/_m_new/' +
            encodeURIComponent(opts.tableId) + '?JSON&up=' + encodeURIComponent(opts.orderId);
        return { url: url, body: buildFormBody(fields, opts.xsrf) };
    }

    // Запрос смены статуса: статус — не первая колонка → _m_set.
    function buildSetStatusRequest(opts) {
        var fields = {};
        fields[opts.statusReqId] = opts.statusValue;
        var url = '/' + encodeURIComponent(opts.db) + '/_m_set/' +
            encodeURIComponent(opts.objId) + '?JSON';
        return { url: url, body: buildFormBody(fields, opts.xsrf) };
    }

    // ------------------------------------------------------------------
    // Сетевой слой
    // ------------------------------------------------------------------

    function getApiBase() {
        return state.db || window.db || '';
    }

    function getXsrf() {
        return typeof window.xsrf !== 'undefined' && window.xsrf
            ? window.xsrf
            : (typeof xsrf !== 'undefined' ? xsrf : '');
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

    function postForm(url, body) {
        return fetchJson(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body
        });
    }

    function loadAllMetadata() {
        return fetchJson('/' + encodeURIComponent(getApiBase()) + '/metadata').then(function(payload) {
            return Array.isArray(payload) ? payload : [];
        });
    }

    function loadRefOptions(reqId, query) {
        if (!reqId) return Promise.resolve([]);
        var search = trimValue(query);
        if (!search && state.refOptions[reqId]) return Promise.resolve(state.refOptions[reqId]);
        return fetchJson(buildRefOptionsUrl(getApiBase(), reqId, search, search ? REF_SEARCH_LIMIT : REF_OPTIONS_LIMIT)).then(function(data) {
            var entries = parseRefOptionsData(data);
            state.refOptions[reqId] = search
                ? mergeRefOptions(state.refOptions[reqId] || [], entries)
                : entries;
            return entries;
        });
    }

    // Индекс типов резки: { id: { materialId } }. Один запрос; ширины полос — лениво.
    function loadCutTypeIndex() {
        var meta = findMetadataByName(state.metadata, 'Тип резки');
        if (!meta) return Promise.resolve();
        var matIdx = findReqIndex(meta, 'Вид сырья');
        return fetchJson('/' + encodeURIComponent(getApiBase()) + '/object/' + encodeURIComponent(meta.id) + '/?JSON_OBJ&LIMIT=0,' + LIST_LIMIT).then(function(rows){
            (rows || []).forEach(function(rec){
                var r = rec.r || [];
                var mat = matIdx >= 0 ? parseRef(r[matIdx]) : { id: null };
                state.cutTypeIndex[String(rec.i)] = { materialId: mat.id ? String(mat.id) : '' };
            });
        });
    }

    // Грузит ширины полос для всех типов указанного сырья (один раз на сырьё).
    // Заполняет index[typeId].widths. Возвращает Promise.
    function ensureStripWidths(materialId) {
        var mat = materialId == null ? '' : String(materialId);
        if (mat === '' || state.stripsLoadedMaterials[mat]) return Promise.resolve();
        var stripMeta = findMetadataByName(state.metadata, 'Полоса');
        if (!stripMeta) return Promise.resolve();
        var wIdx = findReqIndex(stripMeta, 'Ширина, мм');
        // typeIds опирается на то, что loadCutTypeIndex завершён при инициализации,
        // поэтому пустой список означает: у данного сырья типов резки нет.
        var typeIds = Object.keys(state.cutTypeIndex).filter(function(id){ return String(state.cutTypeIndex[id].materialId) === mat; });
        return Promise.all(typeIds.map(function(id){
            return fetchJson('/' + encodeURIComponent(getApiBase()) + '/object/' + encodeURIComponent(stripMeta.id) + '/?JSON_OBJ&F_U=' + encodeURIComponent(id) + '&LIMIT=0,' + STRIPS_LIMIT).then(function(rows){
                var widths = (rows || []).map(function(rec){ var r = rec.r || []; return wIdx >= 0 ? parseWidth(r[wIdx]) : NaN; })
                    .filter(function(x){ return !isNaN(x); });
                state.cutTypeIndex[id].widths = widths;
            }).catch(function(){ /* пропускаем тип при сбое запроса полос */ });
        })).then(function(){ state.stripsLoadedMaterials[mat] = true; });
    }

    // ------------------------------------------------------------------
    // Рендеринг
    // ------------------------------------------------------------------

    function setMessage(text, kind) {
        var el = document.getElementById('atex-orders-message');
        if (!el) return;
        if (!text) {
            el.textContent = '';
            el.className = 'atex-orders-message';
            el.hidden = true;
            return;
        }
        el.textContent = text;
        el.className = 'atex-orders-message atex-orders-message--' + (kind || 'info');
        el.hidden = false;
    }

    function statusSelectHtml(statuses, current, dataAttrs) {
        var options = ['<option value="">—</option>'].concat((statuses || []).map(function(status) {
            var selected = trimValue(status) === trimValue(current) ? ' selected' : '';
            return '<option value="' + escapeHtml(status) + '"' + selected + '>' + escapeHtml(status) + '</option>';
        }));
        if (current && (statuses || []).map(trimValue).indexOf(trimValue(current)) === -1) {
            options.push('<option value="' + escapeHtml(current) + '" selected>' + escapeHtml(current) + '</option>');
        }
        return '<select class="atex-orders-status"' + (dataAttrs || '') + '>' + options.join('') + '</select>';
    }

    function renderRefOptionItems(id, options, current) {
        if (!(options || []).length) {
            return '<div class="atex-orders-ref-empty">Ничего не найдено</div>';
        }
        return (options || []).map(function(opt, index) {
            var selected = String(opt.id) === String(current);
            return '<button type="button" id="' + escapeHtml(id) + '-option-' + index + '" ' +
                'class="atex-orders-ref-option' + (selected ? ' is-selected' : '') + '" ' +
                'role="option" data-ref-option data-value="' + escapeHtml(opt.id) + '" ' +
                'aria-selected="' + (selected ? 'true' : 'false') + '">' +
                escapeHtml(opt.text) + '</button>';
        }).join('');
    }

    function searchableRefSelectHtml(id, options, current, placeholder, reqId) {
        var selected = findRefOption(options, current);
        var displayValue = selected ? selected.text : '';
        var visibleOptions = filterRefOptions(options || [], '', REF_DROPDOWN_LIMIT);
        var currentValue = trimValue(current);
        var clearHidden = currentValue ? '' : ' hidden';
        return '<div class="atex-orders-ref-select" data-ref-select data-ref-req-id="' + escapeHtml(reqId || '') + '">' +
            '<div class="atex-orders-ref-control">' +
            '<input id="' + escapeHtml(id) + '-search" class="atex-orders-input atex-orders-ref-search" ' +
            'type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" ' +
            'aria-controls="' + escapeHtml(id) + '-listbox" autocomplete="off" ' +
            'placeholder="' + escapeHtml(placeholder || 'Поиск...') + '" ' +
            'value="' + escapeHtml(displayValue) + '" data-ref-search>' +
            '<button type="button" class="atex-orders-ref-clear" data-ref-clear ' +
            'title="Очистить значение" aria-label="Очистить значение"' + clearHidden + '>' +
            '<i class="pi pi-times"></i></button>' +
            '</div>' +
            '<input type="hidden" id="' + escapeHtml(id) + '" name="' + escapeHtml(id) + '" value="' + escapeHtml(currentValue) + '" data-ref-value>' +
            '<div id="' + escapeHtml(id) + '-listbox" class="atex-orders-ref-dropdown" role="listbox" hidden>' +
            renderRefOptionItems(id, visibleOptions, current) +
            '</div>' +
            '</div>';
    }

    function refSelectHtml(id, options, current, placeholder, reqId) {
        return searchableRefSelectHtml(id, options, current, placeholder, reqId);
    }

    function renderFilter() {
        var sel = document.getElementById('atex-orders-filter');
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

    function renderPositions(order) {
        var positions = state.positionsByOrder[order.id] || [];
        var head = '<thead><tr>' +
            '<th>Кол-во</th><th>Вид сырья</th><th>Тип резки</th>' +
            '<th>Ширина, мм</th><th>Длина, м</th><th>Ø втулки</th><th>Тип намотки</th><th>Статус</th>' +
            '</tr></thead>';
        var body;
        if (!positions.length) {
            body = '<tbody><tr><td colspan="8" class="atex-orders-empty">Позиций пока нет.</td></tr></tbody>';
        } else {
            body = '<tbody>' + positions.map(function(pos) {
                return '<tr data-position-id="' + escapeHtml(pos.id) + '">' +
                    '<td>' + escapeHtml(pos.values.qty || '') + '</td>' +
                    '<td>' + escapeHtml(pos.values.raw || '') + '</td>' +
                    '<td>' + escapeHtml(pos.values.cutType || '') + '</td>' +
                    '<td>' + escapeHtml(pos.values.width || '') + '</td>' +
                    '<td>' + escapeHtml(pos.values.length || '') + '</td>' +
                    '<td>' + escapeHtml(pos.values.sleeve || '') + '</td>' +
                    '<td>' + escapeHtml(pos.values.winding || '') + '</td>' +
                    '<td>' + statusSelectHtml(state.positionStatuses, pos.values.status,
                        ' data-position-status="' + escapeHtml(pos.id) + '"') + '</td>' +
                    '</tr>';
            }).join('') + '</tbody>';
        }

        return '<div class="atex-orders-positions">' +
            '<table class="atex-orders-subtable">' + head + body + '</table>' +
            '<button type="button" class="atex-orders-btn atex-orders-btn-secondary" ' +
            'data-add-position="' + escapeHtml(order.id) + '">' +
            '<i class="pi pi-plus"></i><span>Добавить позицию</span></button>' +
            renderPositionForm(order) +
            '</div>';
    }

    function renderPositionForm(order) {
        var rawCol = getColumn(state.positionColumns, 'raw');
        var cutCol = getColumn(state.positionColumns, 'cutType');
        var sleeveCol = getColumn(state.positionColumns, 'sleeve');
        var rawOptions = rawCol && rawCol.reqId ? state.refOptions[rawCol.reqId] : null;
        var cutOptions = cutCol && cutCol.reqId ? state.refOptions[cutCol.reqId] : null;
        var sleeveOptions = sleeveCol && sleeveCol.reqId ? state.refOptions[sleeveCol.reqId] : null;
        return '<form class="atex-orders-position-form" data-position-form="' + escapeHtml(order.id) + '" hidden>' +
            '<div class="atex-orders-fields">' +
            '<label>Кол-во<input class="atex-orders-input" type="number" min="0" data-field="qty"></label>' +
            '<label>Вид сырья' + refSelectHtml('atex-pos-raw-' + order.id, rawOptions, '', 'Выберите вид сырья', rawCol && rawCol.reqId) + '</label>' +
            '<label>Тип резки' + refSelectHtml('atex-pos-cut-' + order.id, cutOptions, '', 'Выберите тип резки', cutCol && cutCol.reqId) + '</label>' +
            '<label>Ширина, мм<input class="atex-orders-input" type="number" min="0" data-field="width"></label>' +
            '<label>Длина, м<input class="atex-orders-input" type="number" min="0" step="any" data-field="length"></label>' +
            '<label>Ø втулки' + refSelectHtml('atex-pos-sleeve-' + order.id, sleeveOptions, '', 'Выберите диаметр', sleeveCol && sleeveCol.reqId) + '</label>' +
            '<label>Тип намотки<select class="atex-orders-input atex-orders-winding" data-field="winding">' +
            '<option value="">— не задано —</option>' +
            '<option value="IN">IN</option>' +
            '<option value="OUT">OUT</option>' +
            '</select></label>' +
            '</div>' +
            '<div class="atex-orders-form-actions">' +
            '<button type="submit" class="atex-orders-btn atex-orders-btn-primary"><i class="pi pi-check"></i><span>Сохранить позицию</span></button>' +
            '<button type="button" class="atex-orders-btn atex-orders-btn-secondary" data-cancel-position="' + escapeHtml(order.id) + '">Отмена</button>' +
            '</div></form>';
    }

    // Пересобирает список опций «Тип резки» формы позиции по текущему сырью/ширине.
    // Сбрасывает выбранное значение, если оно не входит в подходящие.
    // Работает с searchable-ref-select: обновляет data-atex-cuttype-allowed на обёртке
    // и переотрисовывает dropdown через renderRefSearchResults.
    function refreshCutTypeOptions(orderId, form) {
        if (!form) return;
        // Скрытые inputs searchable-ref-select для сырья и типа резки.
        var cutHidden = form.querySelector('#atex-pos-cut-' + cssEscape(orderId));
        var rawHidden = form.querySelector('#atex-pos-raw-' + cssEscape(orderId));
        var widthInput = form.querySelector('[data-field="width"]');
        if (!cutHidden) return;
        // Обёртка [data-ref-select] — родитель скрытого input типа резки.
        var cutWrapper = cutHidden.closest ? cutHidden.closest('[data-ref-select]') : null;
        if (!cutWrapper) return;
        var materialId = rawHidden ? rawHidden.value : '';
        var width = widthInput ? widthInput.value : '';
        var allowed = matchCutTypes(state.cutTypeIndex, materialId, width);
        var allowedSet = {};
        allowed.forEach(function(id){ allowedSet[String(id)] = true; });
        // Сохраняем фильтр на обёртке для renderRefSearchResults.
        cutWrapper.setAttribute('data-atex-cuttype-allowed', allowed.join(','));
        // Сброс несовместимого выбора.
        var prev = cutHidden.value;
        if (prev && !allowedSet[String(prev)]) {
            cutHidden.value = '';
            var cutSearch = cutWrapper.querySelector('[data-ref-search]');
            if (cutSearch) cutSearch.value = '';
            updateRefClear(cutWrapper);
        }
        // Переотрисовываем dropdown (только если он сейчас открыт, иначе он обновится при открытии).
        var dropdown = cutWrapper.querySelector('.atex-orders-ref-dropdown');
        if (dropdown && !dropdown.hidden) {
            var cutSearchEl = cutWrapper.querySelector('[data-ref-search]');
            renderRefSearchResults(cutWrapper, cutSearchEl ? cutSearchEl.value : '');
        }
    }

    function renderOrders() {
        var container = document.getElementById('atex-orders-list');
        if (!container) return;

        var orders = filteredOrders();
        if (!orders.length) {
            container.innerHTML = '<div class="atex-orders-empty">' +
                (state.orders.length ? 'Нет заказов с выбранным статусом.' : 'Заказов пока нет. Создайте первый.') +
                '</div>';
            return;
        }

        var rows = orders.map(function(order) {
            var loadedPositions = state.positionsByOrder[order.id];
            // Пока позиции не догружены (заказ не раскрыт) — берём счётчик из самой
            // записи заказа (ROLLUP «Позиция заказа»); после загрузки считаем по факту.
            var positionCount = loadedPositions
                ? loadedPositions.length
                : (parseInt(order.values.posCount, 10) || 0);
            var isOpen = !!state.expanded[order.id];
            var main = '<tr class="atex-orders-row" data-order-id="' + escapeHtml(order.id) + '">' +
                '<td class="atex-orders-toggle-cell"><button type="button" class="atex-orders-toggle" data-toggle="' + escapeHtml(order.id) + '" title="Позиции">' +
                '<i class="pi ' + (isOpen ? 'pi-chevron-down' : 'pi-chevron-right') + '"></i></button></td>' +
                '<td>' + escapeHtml(order.id) + '</td>' +
                '<td>' + escapeHtml(order.values.client || '') + '</td>' +
                '<td>' + escapeHtml(order.values.manager || '') + '</td>' +
                '<td>' + escapeHtml(order.values.created || '') + '</td>' +
                '<td>' + statusSelectHtml(state.orderStatuses, order.values.status,
                    ' data-order-status="' + escapeHtml(order.id) + '"') + '</td>' +
                '<td class="atex-orders-count">' + positionCount + '</td>' +
                '</tr>';
            var detail = isOpen
                ? '<tr class="atex-orders-detail-row"><td colspan="7">' + renderPositions(order) + '</td></tr>'
                : '';
            return main + detail;
        }).join('');

        container.innerHTML = '<table class="atex-orders-table">' +
            '<thead><tr><th></th><th>№</th><th>Клиент</th><th>Менеджер</th><th>Дата создания</th><th>Статус</th><th>Позиций</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table>';
    }

    function renderCreateForm() {
        var clientCol = getColumn(state.orderColumns, 'client');
        var clientOptions = clientCol && clientCol.reqId ? state.refOptions[clientCol.reqId] : null;
        var panel = document.getElementById('atex-order-create-form');
        if (!panel) return;
        panel.innerHTML =
            '<div class="atex-orders-fields">' +
            '<label>Клиент' + refSelectHtml('atex-order-client', clientOptions, '', 'Выберите клиента', clientCol && clientCol.reqId) + '</label>' +
            '<label>Статус' + statusSelectHtml(state.orderStatuses, state.orderStatuses[0], ' id="atex-order-status"') + '</label>' +
            '<label class="atex-orders-field-wide">Примечания<textarea class="atex-orders-input" id="atex-order-notes" rows="2"></textarea></label>' +
            '</div>' +
            '<div class="atex-orders-form-actions">' +
            '<button type="submit" class="atex-orders-btn atex-orders-btn-primary"><i class="pi pi-check"></i><span>Создать заказ</span></button>' +
            '<button type="button" class="atex-orders-btn atex-orders-btn-secondary" id="atex-order-cancel">Отмена</button>' +
            '</div>';
    }

    // ------------------------------------------------------------------
    // Действия
    // ------------------------------------------------------------------

    function todayIso() {
        var now = new Date();
        return now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0');
    }

    function loadOrders() {
        var statusCol = getColumn(state.orderColumns, 'status');
        var url = buildListUrl(getApiBase(), state.orderTable, null,
            null, ''); // фильтр по статусу делаем на клиенте (быстрее и переживает опечатки)
        return fetchJson(url).then(function(json) {
            state.orders = normalizeObjects(json, state.orderColumns).sort(function(a, b) {
                return Number(b.id) - Number(a.id);
            });
            renderOrders();
            return statusCol;
        });
    }

    function loadPositions(orderId) {
        var url = buildListUrl(getApiBase(), state.positionTable, orderId, null, '');
        return fetchJson(url).then(function(json) {
            state.positionsByOrder[orderId] = normalizeObjects(json, state.positionColumns);
            renderOrders();
        });
    }

    function createOrder() {
        if (state.creating) return;
        var clientSel = document.getElementById('atex-order-client');
        var statusSel = document.getElementById('atex-order-status');
        var notesEl = document.getElementById('atex-order-notes');

        var req = buildCreateOrderRequest({
            db: getApiBase(),
            tableId: state.orderTable,
            columns: state.orderColumns,
            clientId: clientSel ? clientSel.value : '',
            managerId: typeof window.uid !== 'undefined' ? window.uid : (typeof uid !== 'undefined' ? uid : ''),
            created: todayIso(),
            status: statusSel ? statusSel.value : '',
            notes: notesEl ? notesEl.value : '',
            xsrf: getXsrf()
        });

        state.creating = true;
        setMessage('Создание заказа…', 'info');
        postForm(req.url, req.body).then(function(response) {
            var newId = extractNewObjectId(response);
            setMessage(newId ? 'Заказ №' + newId + ' создан.' : 'Заказ создан.', 'success');
            closeCreateForm();
            return loadOrders().then(function() {
                if (newId) {
                    state.expanded[newId] = true;
                    return loadPositions(newId);
                }
            });
        }).catch(function(error) {
            setMessage('Не удалось создать заказ: ' + (error.message || error), 'error');
        }).finally(function() {
            state.creating = false;
        });
    }

    function createPosition(orderId, form) {
        var rawSel = form.querySelector('#atex-pos-raw-' + cssEscape(orderId));
        var cutSel = form.querySelector('#atex-pos-cut-' + cssEscape(orderId));
        var sleeveSel = form.querySelector('#atex-pos-sleeve-' + cssEscape(orderId));
        function fieldVal(name) {
            var el = form.querySelector('[data-field="' + name + '"]');
            return el ? el.value : '';
        }

        var req = buildCreatePositionRequest({
            db: getApiBase(),
            tableId: state.positionTable,
            columns: state.positionColumns,
            orderId: orderId,
            qty: fieldVal('qty'),
            rawId: rawSel ? rawSel.value : '',
            cutTypeId: cutSel ? cutSel.value : '',
            width: fieldVal('width'),
            length: fieldVal('length'),
            sleeve: sleeveSel ? sleeveSel.value : '',
            winding: fieldVal('winding'),
            status: state.positionStatuses[0],
            xsrf: getXsrf()
        });

        setMessage('Добавление позиции…', 'info');
        postForm(req.url, req.body).then(function() {
            setMessage('Позиция добавлена.', 'success');
            return loadPositions(orderId);
        }).catch(function(error) {
            setMessage('Не удалось добавить позицию: ' + (error.message || error), 'error');
        });
    }

    function changeStatus(objId, statusReqId, statusValue, onDone) {
        if (!statusReqId) {
            setMessage('Не найден реквизит «Статус» в метаданных.', 'error');
            return;
        }
        var req = buildSetStatusRequest({
            db: getApiBase(),
            objId: objId,
            statusReqId: statusReqId,
            statusValue: statusValue,
            xsrf: getXsrf()
        });
        setMessage('Сохранение статуса…', 'info');
        postForm(req.url, req.body).then(function() {
            setMessage('Статус обновлён.', 'success');
            if (onDone) onDone();
        }).catch(function(error) {
            setMessage('Не удалось обновить статус: ' + (error.message || error), 'error');
        });
    }

    function cssEscape(value) {
        return String(value).replace(/[^\w-]/g, '\\$&');
    }

    function openCreateForm() {
        var panel = document.getElementById('atex-order-create');
        if (panel) panel.hidden = false;
        renderCreateForm();
        var client = document.getElementById('atex-order-client-search') || document.getElementById('atex-order-client');
        if (client) client.focus();
    }

    function closeCreateForm() {
        var panel = document.getElementById('atex-order-create');
        if (panel) panel.hidden = true;
    }

    function refWrapperFrom(target) {
        return target && target.closest ? target.closest('[data-ref-select]') : null;
    }

    function updateRefClear(wrapper) {
        if (!wrapper) return;
        var hidden = wrapper.querySelector('[data-ref-value]');
        var clear = wrapper.querySelector('[data-ref-clear]');
        if (clear) clear.hidden = !(hidden && hidden.value);
    }

    function setRefExpanded(wrapper, expanded) {
        if (!wrapper) return;
        var dropdown = wrapper.querySelector('.atex-orders-ref-dropdown');
        var search = wrapper.querySelector('[data-ref-search]');
        if (dropdown) dropdown.hidden = !expanded;
        if (search) search.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        if (!expanded && search) search.removeAttribute('aria-activedescendant');
    }

    function closeRefSelect(wrapper) {
        setRefExpanded(wrapper, false);
    }

    function closeAllRefSelects(except) {
        if (!state.root) return;
        state.root.querySelectorAll('[data-ref-select]').forEach(function(wrapper) {
            if (wrapper !== except) closeRefSelect(wrapper);
        });
    }

    function setActiveRefOption(wrapper, index) {
        if (!wrapper) return;
        var search = wrapper.querySelector('[data-ref-search]');
        var options = Array.prototype.slice.call(wrapper.querySelectorAll('[data-ref-option]'));
        if (!options.length) {
            if (search) search.removeAttribute('aria-activedescendant');
            return;
        }
        var next = Math.max(0, Math.min(index, options.length - 1));
        options.forEach(function(option, idx) {
            option.classList.toggle('is-active', idx === next);
        });
        if (search) search.setAttribute('aria-activedescendant', options[next].id || '');
        if (options[next].scrollIntoView) {
            options[next].scrollIntoView({ block: 'nearest' });
        }
    }

    function activeRefOptionIndex(wrapper) {
        var options = Array.prototype.slice.call(wrapper.querySelectorAll('[data-ref-option]'));
        for (var i = 0; i < options.length; i++) {
            if (options[i].classList.contains('is-active')) return i;
        }
        return -1;
    }

    function renderRefSearchResults(wrapper, query) {
        if (!wrapper) return;
        var dropdown = wrapper.querySelector('.atex-orders-ref-dropdown');
        var hidden = wrapper.querySelector('[data-ref-value]');
        if (!dropdown || !hidden) return;
        var reqId = wrapper.getAttribute('data-ref-req-id');
        var options = state.refOptions[reqId] || [];
        // Ограничиваем список разрешёнными id, если выставлен фильтр типов резки.
        // Атрибут ставит только refreshCutTypeOptions (фильтр «Тип резки» по сырью/ширине); на прочих ref-select его нет.
        var allowedAttr = wrapper.getAttribute('data-atex-cuttype-allowed');
        if (allowedAttr !== null) {
            var allowedSet = {};
            allowedAttr.split(',').forEach(function(id){ if (id) allowedSet[id] = true; });
            options = options.filter(function(opt){ return allowedSet[String(opt.id)]; });
        }
        var visibleOptions = filterRefOptions(options, query, REF_DROPDOWN_LIMIT);
        dropdown.innerHTML = renderRefOptionItems(hidden.id, visibleOptions, hidden.value);
        setActiveRefOption(wrapper, 0);
    }

    function openRefSelect(wrapper) {
        if (!wrapper) return;
        var search = wrapper.querySelector('[data-ref-search]');
        var hidden = wrapper.querySelector('[data-ref-value]');
        closeAllRefSelects(wrapper);
        renderRefSearchResults(wrapper, hidden && hidden.value ? '' : (search ? search.value : ''));
        updateRefClear(wrapper);
        setRefExpanded(wrapper, true);
    }

    function scheduleRefServerSearch(wrapper, query) {
        if (!wrapper) return;
        var reqId = wrapper.getAttribute('data-ref-req-id');
        var search = trimValue(query);
        clearTimeout(wrapper._atexOrdersRefTimer);
        var seq = ++state.refSearchSeq;
        wrapper._atexOrdersRefSeq = seq;
        if (!reqId || search.length < 2) return;
        wrapper._atexOrdersRefTimer = setTimeout(function() {
            loadRefOptions(reqId, search).then(function() {
                if (wrapper._atexOrdersRefSeq !== seq) return;
                renderRefSearchResults(wrapper, search);
                setRefExpanded(wrapper, true);
            }).catch(function(error) {
                if (window.INTEGRAM_DEBUG) {
                    console.warn('Reference search failed:', error);
                }
            });
        }, REF_SEARCH_DELAY);
    }

    // Вызывается после изменения поля «Вид сырья» в форме позиции:
    // по скрытому input определяет orderId и form, затем догружает полосы и
    // обновляет список «Тип резки».
    function onRawRefChanged(wrapper) {
        if (!wrapper) return;
        var rawCol = getColumn(state.positionColumns, 'raw');
        if (!rawCol || !rawCol.reqId) return;
        // Проверяем, что это именно ref-select «Вид сырья» (по reqId обёртки).
        if (wrapper.getAttribute('data-ref-req-id') !== String(rawCol.reqId)) return;
        var form = wrapper.closest ? wrapper.closest('[data-position-form]') : null;
        if (!form) return;
        var orderId = form.getAttribute('data-position-form');
        var rawHidden = wrapper.querySelector('[data-ref-value]');
        var materialId = rawHidden ? rawHidden.value : '';
        ensureStripWidths(materialId).then(function() {
            refreshCutTypeOptions(orderId, form);
        });
    }

    function selectRefOption(option) {
        var wrapper = refWrapperFrom(option);
        if (!wrapper) return;
        var hidden = wrapper.querySelector('[data-ref-value]');
        var search = wrapper.querySelector('[data-ref-search]');
        if (hidden) hidden.value = option.getAttribute('data-value') || '';
        if (search) search.value = option.textContent || '';
        updateRefClear(wrapper);
        closeRefSelect(wrapper);
        // При выборе сырья в форме позиции — обновить список типов резки.
        onRawRefChanged(wrapper);
    }

    function clearRefSelect(wrapper) {
        if (!wrapper) return;
        var hidden = wrapper.querySelector('[data-ref-value]');
        var search = wrapper.querySelector('[data-ref-search]');
        if (hidden) hidden.value = '';
        if (search) {
            search.value = '';
            search.focus();
        }
        updateRefClear(wrapper);
        renderRefSearchResults(wrapper, '');
        setRefExpanded(wrapper, true);
        // При очистке сырья в форме позиции — обновить список типов резки.
        onRawRefChanged(wrapper);
    }

    function attachRefSearchEvents() {
        if (!state.root) return;

        state.root.addEventListener('focusin', function(event) {
            var search = event.target.closest && event.target.closest('[data-ref-search]');
            if (!search) return;
            openRefSelect(refWrapperFrom(search));
        });

        state.root.addEventListener('input', function(event) {
            var search = event.target.closest && event.target.closest('[data-ref-search]');
            if (search) {
                var wrapper = refWrapperFrom(search);
                var hidden = wrapper && wrapper.querySelector('[data-ref-value]');
                if (hidden) hidden.value = '';
                updateRefClear(wrapper);
                renderRefSearchResults(wrapper, search.value);
                setRefExpanded(wrapper, true);
                scheduleRefServerSearch(wrapper, search.value);
                return;
            }
            // При вводе ширины в форме позиции — обновить список типов резки.
            var widthInput = event.target.closest && event.target.closest('[data-field="width"]');
            if (widthInput) {
                var posForm = widthInput.closest ? widthInput.closest('[data-position-form]') : null;
                if (posForm) {
                    var posOrderId = posForm.getAttribute('data-position-form');
                    refreshCutTypeOptions(posOrderId, posForm);
                }
            }
        });

        state.root.addEventListener('keydown', function(event) {
            var search = event.target.closest && event.target.closest('[data-ref-search]');
            if (!search) return;
            var wrapper = refWrapperFrom(search);
            var dropdown = wrapper && wrapper.querySelector('.atex-orders-ref-dropdown');
            var options = wrapper ? wrapper.querySelectorAll('[data-ref-option]') : [];
            if (!wrapper) return;

            if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (dropdown && dropdown.hidden) openRefSelect(wrapper);
                setActiveRefOption(wrapper, activeRefOptionIndex(wrapper) + 1);
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveRefOption(wrapper, activeRefOptionIndex(wrapper) - 1);
            } else if (event.key === 'Enter' && dropdown && !dropdown.hidden && options.length) {
                event.preventDefault();
                var activeIndex = activeRefOptionIndex(wrapper);
                selectRefOption(options[Math.max(0, activeIndex)]);
            } else if (event.key === 'Escape') {
                closeRefSelect(wrapper);
            }
        });

        state.root.addEventListener('click', function(event) {
            var option = event.target.closest && event.target.closest('[data-ref-option]');
            if (option) {
                selectRefOption(option);
                return;
            }

            var clear = event.target.closest && event.target.closest('[data-ref-clear]');
            if (clear) {
                event.preventDefault();
                clearRefSelect(refWrapperFrom(clear));
                return;
            }

            var search = event.target.closest && event.target.closest('[data-ref-search]');
            if (search) {
                openRefSelect(refWrapperFrom(search));
            }
        });

        document.addEventListener('click', function(event) {
            if (!event.target.closest || !event.target.closest('[data-ref-select]')) {
                closeAllRefSelects();
            }
        });
    }

    // ------------------------------------------------------------------
    // События
    // ------------------------------------------------------------------

    function attachEvents() {
        var createBtn = document.getElementById('atex-orders-create');
        if (createBtn) {
            createBtn.addEventListener('click', openCreateForm);
        }

        var filter = document.getElementById('atex-orders-filter');
        if (filter) {
            filter.addEventListener('change', function() {
                state.statusFilter = filter.value || '';
                renderOrders();
            });
        }

        var refresh = document.getElementById('atex-orders-refresh');
        if (refresh) {
            refresh.addEventListener('click', function() {
                state.positionsByOrder = {};
                loadOrders();
            });
        }

        var createForm = document.getElementById('atex-order-create-form');
        if (createForm) {
            createForm.addEventListener('submit', function(event) {
                event.preventDefault();
                createOrder();
            });
            createForm.addEventListener('click', function(event) {
                if (event.target.closest('#atex-order-cancel')) {
                    closeCreateForm();
                }
            });
        }

        var list = document.getElementById('atex-orders-list');
        if (list) {
            list.addEventListener('click', function(event) {
                var toggle = event.target.closest('[data-toggle]');
                if (toggle) {
                    var orderId = toggle.getAttribute('data-toggle');
                    state.expanded[orderId] = !state.expanded[orderId];
                    if (state.expanded[orderId] && !state.positionsByOrder[orderId]) {
                        loadPositions(orderId);
                    } else {
                        renderOrders();
                    }
                    return;
                }

                var addPos = event.target.closest('[data-add-position]');
                if (addPos) {
                    var addId = addPos.getAttribute('data-add-position');
                    var form = list.querySelector('[data-position-form="' + cssEscape(addId) + '"]');
                    if (form) {
                        form.hidden = false;
                        // Фильтруем типы резки по текущему сырью (если уже выбрано).
                        var rawHiddenInit = form.querySelector('#atex-pos-raw-' + cssEscape(addId));
                        var matInit = rawHiddenInit ? rawHiddenInit.value : '';
                        ensureStripWidths(matInit).then(function() {
                            refreshCutTypeOptions(addId, form);
                        });
                    }
                    return;
                }

                var cancelPos = event.target.closest('[data-cancel-position]');
                if (cancelPos) {
                    var cancelId = cancelPos.getAttribute('data-cancel-position');
                    var cform = list.querySelector('[data-position-form="' + cssEscape(cancelId) + '"]');
                    if (cform) cform.hidden = true;
                    return;
                }
            });

            list.addEventListener('submit', function(event) {
                var form = event.target.closest('[data-position-form]');
                if (!form) return;
                event.preventDefault();
                createPosition(form.getAttribute('data-position-form'), form);
            });

            list.addEventListener('change', function(event) {
                var orderStatus = event.target.closest('[data-order-status]');
                if (orderStatus) {
                    var statusCol = getColumn(state.orderColumns, 'status');
                    var orderId = orderStatus.getAttribute('data-order-status');
                    var order = findOrder(orderId);
                    changeStatus(orderId, statusCol && statusCol.reqId, orderStatus.value, function() {
                        if (order) order.values.status = orderStatus.value;
                    });
                    return;
                }
                var posStatus = event.target.closest('[data-position-status]');
                if (posStatus) {
                    var posCol = getColumn(state.positionColumns, 'status');
                    var posId = posStatus.getAttribute('data-position-status');
                    changeStatus(posId, posCol && posCol.reqId, posStatus.value, function() {
                        updatePositionStatus(posId, posStatus.value);
                    });
                }
            });
        }

        attachRefSearchEvents();
    }

    function findOrder(orderId) {
        for (var i = 0; i < state.orders.length; i++) {
            if (state.orders[i].id === String(orderId)) return state.orders[i];
        }
        return null;
    }

    function updatePositionStatus(posId, value) {
        Object.keys(state.positionsByOrder).forEach(function(orderId) {
            state.positionsByOrder[orderId].forEach(function(pos) {
                if (pos.id === String(posId)) pos.values.status = value;
            });
        });
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
        state.root = document.getElementById('atex-orders-app');
        if (!state.root) return;

        state.db = window.db || state.root.getAttribute('data-db') || '';
        var tableOverrides = {
            order: state.root.getAttribute('data-order-table'),
            position: state.root.getAttribute('data-position-table')
        };
        state.orderStatuses = parseStatusesAttr(state.root.getAttribute('data-order-statuses'), DEFAULT_ORDER_STATUSES);
        state.positionStatuses = parseStatusesAttr(state.root.getAttribute('data-position-statuses'), DEFAULT_POSITION_STATUSES);

        attachEvents();
        renderFilter();
        setMessage('Загрузка данных…', 'info');

        loadAllMetadata()
            .then(function(allMetadata) {
                state.metadata = allMetadata;
                var metas = resolveTableMetadata(allMetadata, TABLE, tableOverrides);
                state.orderMeta = metas.order || {};
                state.positionMeta = metas.position || {};
                state.orderTable = String(state.orderMeta.id || '');
                state.positionTable = String(state.positionMeta.id || '');
                state.orderColumns = buildColumns(ORDER_FIELDS, state.orderMeta);
                state.positionColumns = buildColumns(POSITION_FIELDS, state.positionMeta);

                // Предзагрузка справочников для форм.
                var clientCol = getColumn(state.orderColumns, 'client');
                var rawCol = getColumn(state.positionColumns, 'raw');
                var cutCol = getColumn(state.positionColumns, 'cutType');
                var sleeveCol = getColumn(state.positionColumns, 'sleeve');
                return Promise.all([
                    clientCol && clientCol.reqId ? loadRefOptions(clientCol.reqId) : Promise.resolve([]),
                    rawCol && rawCol.reqId ? loadRefOptions(rawCol.reqId) : Promise.resolve([]),
                    cutCol && cutCol.reqId ? loadRefOptions(cutCol.reqId) : Promise.resolve([]),
                    sleeveCol && sleeveCol.reqId ? loadRefOptions(sleeveCol.reqId) : Promise.resolve([]),
                    loadCutTypeIndex()
                ]);
            })
            .then(function() {
                setMessage('');
                return loadOrders();
            })
            .catch(function(error) {
                setMessage('Ошибка загрузки: ' + (error.message || error), 'error');
            });
    }

    // Публичный API для отладки/тестов.
    window.AtexOrders = {
        init: init,
        reload: loadOrders
    };

    // Чистые функции — для модульных тестов (без DOM/сети).
    window.AtexOrdersTesting = {
        normalizeFieldName: normalizeFieldName,
        normalizeSearchText: normalizeSearchText,
        parseWidth: parseWidth,
        matchCutTypes: matchCutTypes,
        rowsToOrders: rowsToOrders,
        searchOrders: searchOrders,
        parseRef: parseRef,
        parseRefOptionsData: parseRefOptionsData,
        mergeRefOptions: mergeRefOptions,
        findRefOption: findRefOption,
        filterRefOptions: filterRefOptions,
        buildFieldSources: buildFieldSources,
        buildColumns: buildColumns,
        findMetadataByName: findMetadataByName,
        resolveTableMetadata: resolveTableMetadata,
        normalizeObjects: normalizeObjects,
        extractNewObjectId: extractNewObjectId,
        buildListUrl: buildListUrl,
        buildRefOptionsUrl: buildRefOptionsUrl,
        buildFormBody: buildFormBody,
        buildCreateOrderRequest: buildCreateOrderRequest,
        buildCreatePositionRequest: buildCreatePositionRequest,
        buildSetStatusRequest: buildSetStatusRequest,
        searchableRefSelectHtml: searchableRefSelectHtml,
        TABLE: TABLE,
        ORDER_FIELDS: ORDER_FIELDS,
        POSITION_FIELDS: POSITION_FIELDS,
        DEFAULT_ORDER_STATUSES: DEFAULT_ORDER_STATUSES,
        DEFAULT_POSITION_STATUSES: DEFAULT_POSITION_STATUSES,
        REF_OPTIONS_LIMIT: REF_OPTIONS_LIMIT,
        REF_SEARCH_LIMIT: REF_SEARCH_LIMIT,
        REF_DROPDOWN_LIMIT: REF_DROPDOWN_LIMIT,
        findReqIndex: findReqIndex,
        loadCutTypeIndex: loadCutTypeIndex,
        ensureStripWidths: ensureStripWidths,
        normalizeWinding: normalizeWinding,
        WINDING_VALUES: WINDING_VALUES
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
