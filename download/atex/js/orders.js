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
 *   «Клиент», «Вид сырья», «Диаметр втулки» — ссылки.
 */
(function(window, document) {
    'use strict';

    var TABLE = { order: 'Заказ', position: 'Позиция заказа' };
    var REF_OPTIONS_LIMIT = 500;
    var REF_SEARCH_LIMIT = 50;
    var REF_DROPDOWN_LIMIT = 80;
    var REF_SEARCH_DELAY = 250;
    var LIST_LIMIT = 5000;

    // Статусы — свободный текст (тип 3), поэтому фиксируем разумные наборы.
    // Их можно переопределить data-атрибутами data-order-statuses / data-position-statuses.
    var DEFAULT_ORDER_STATUS_ID = '16320';
    var DEFAULT_ORDER_STATUS_LABEL = 'Новый';
    var DEFAULT_ORDER_STATUSES = ['Новый', 'Согласован', 'К выполнению', 'Выполнен', 'Отменён'];
    var DEFAULT_POSITION_STATUSES = ['Новая', 'В работе', 'Готова', 'Отгружена'];

    // Карта полей таблицы «Заказ»: ключ → возможные имена реквизита в metadata.
    var ORDER_FIELDS = [
        { key: 'client', label: 'Клиент', names: ['Клиент'], ref: true },
        { key: 'manager', label: 'Менеджер', names: ['Менеджер', 'Пользователь'], ref: true },
        { key: 'created', label: 'Дата создания', names: ['Дата создания'] },
        { key: 'approved', label: 'Дата согласования', names: ['Дата согласования'] },
        { key: 'dueDate', label: 'Срок изготовления', names: ['Срок изготовления'] },
        { key: 'status', label: 'Статус', names: ['Статус заказа', 'Статус'], ref: true },
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
        { key: 'width', label: 'Ширина, мм', names: ['Ширина, мм', 'Ширина'] },
        { key: 'length', label: 'Длина, м', names: ['Длина, м', 'Длина'] },
        { key: 'sleeve', label: 'Диаметр втулки', names: ['Диаметр втулки'], ref: true },
        { key: 'winding', label: 'Тип намотки', names: ['Тип намотки'] },
        { key: 'status', label: 'Статус', names: ['Статус позиции', 'Статус'], ref: true },
        // Срок изготовления — только для отображения (read-only), как «Дата согласования».
        { key: 'dueDate', label: 'Срок изготовления', names: ['Срок изготовления'] }
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
        editingCell: null,          // активная ячейка поячейковой правки (DOM td) или null
        editingOrderCell: null,     // активная ячейка правки дат заказа (DOM td) или null
        draftOrderId: null,         // заказ, под которым показана черновая строка новой позиции
        draftPos: null,             // синтетическая позиция-черновик { id:'__draft__', values, refs }
        statusFilter: '',
        filterFrom: '',
        filterTo: '',
        searchQuery: '',
        sortKey: 'id',
        sortDir: 'desc',
        refOptions: {},
        refSearchSeq: 0,
        creating: false,
        metadata: []
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

    function isPositionApproved(pos) {
        return !!trimValue(pos && pos.values && pos.values.approved);
    }

    function latestPositionApprovedDate(positions) {
        var best = '';
        var bestRank = null;
        (positions || []).forEach(function(pos) {
            var value = trimValue(pos && pos.values && pos.values.approved);
            if (!value) return;
            var rank = sortKeyDate(value);
            if (isNaN(rank)) {
                if (bestRank === null && !best) best = value;
                return;
            }
            if (bestRank === null || rank >= bestRank) {
                bestRank = rank;
                best = value;
            }
        });
        return best;
    }

    function deriveOrderApproval(order) {
        var values = order && order.values ? order.values : {};
        var status = trimValue(values.status);
        var approved = trimValue(values.approved);
        var positions = order && Array.isArray(order.positions) ? order.positions : [];
        var allPositionsApproved = positions.length > 0 && positions.every(isPositionApproved);
        var positionsApproved = allPositionsApproved ? latestPositionApprovedDate(positions) : '';
        if (positionsApproved) approved = positionsApproved;
        if (approved && (!status || status === 'Новый')) status = 'Согласован';
        return {
            status: status,
            approved: approved,
            allPositionsApproved: allPositionsApproved
        };
    }

    function applyDerivedOrderApproval(order) {
        if (!order || !order.values) return order;
        var derived = deriveOrderApproval(order);
        order.values.status = derived.status;
        order.values.approved = derived.approved;
        return order;
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
                    created: s(r.order_created), approved: s(r.order_approved),
                    dueDate: s(r.order_due_date), status: s(r.order_status)
                }, positions: [] };
                order.push(oid);
            }
            var pid = s(r.position_id);
            if (oid && pid) {
                byId[oid].positions.push({ id: pid, values: {
                    qty: s(r.position_qty), raw: s(r.position_raw),
                    width: s(r.position_width), length: s(r.position_length), sleeve: s(r.position_sleeve),
                    winding: s(r.position_winding), status: s(r.position_status),
                    approved: s(r.position_approved), dueDate: s(r.position_due_date)
                }, refs: {
                    // id ссылок приходят прямо из отчёта (abn_ID-колонки) — детальная
                    // догрузка позиций (loadPositions) на каждый заказ больше не нужна.
                    raw: s(r.position_raw_id), sleeve: s(r.position_sleeve_id)
                } });
            }
        });
        return order.map(function(id) { return applyDerivedOrderApproval(byId[id]); });
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

    // Парс даты DD.MM.YYYY / YYYY-MM-DD → сортируемое число (YYYYMMDD); иначе NaN.
    function sortKeyDate(v) {
        var text = String(v == null ? '' : v);
        var m = text.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
        if (m) return Number(m[3] + m[2] + m[1]);
        m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? Number(m[1] + m[2] + m[3]) : NaN;
    }

    function dateDisplayToInputValue(value) {
        var text = trimValue(value);
        var dm = text.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
        if (dm) return dm[3] + '-' + dm[2] + '-' + dm[1];
        var iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return iso ? iso[1] + '-' + iso[2] + '-' + iso[3] : text;
    }

    function dateInputToDisplayValue(value) {
        var text = trimValue(value);
        var iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return iso ? iso[3] + '.' + iso[2] + '.' + iso[1] : text;
    }

    // Сортировка заказов по o.values[key] (id — по o.id). Возвращает новый массив.
    function sortOrders(list, key, dir) {
        var sign = dir === 'desc' ? -1 : 1;
        var get = function(o) { return key === 'id' ? o.id : (o.values ? o.values[key] : ''); };
        return (list || []).slice().sort(function(a, b) {
            var va = get(a), vb = get(b);
            var da = sortKeyDate(va), db = sortKeyDate(vb);
            if (!isNaN(da) && !isNaN(db)) return sign * (da - db);
            var na = parseFloat(va), nb = parseFloat(vb);
            if (!isNaN(na) && !isNaN(nb) && String(va).trim() !== '' && String(vb).trim() !== '') return sign * (na - nb);
            return sign * String(va).localeCompare(String(vb), 'ru');
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

    function ensureDefaultOrderStatusOption(options) {
        var list = (options || []).slice();
        if (!findRefOption(list, DEFAULT_ORDER_STATUS_ID)) {
            list.unshift({ id: DEFAULT_ORDER_STATUS_ID, text: DEFAULT_ORDER_STATUS_LABEL });
        }
        return list;
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
            var meta = all[i];
            if (normalizeFieldName(meta.val) === wanted) return meta;
            if (meta.alias && normalizeFieldName(meta.alias) === wanted) return meta;
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
        put('status', trimValue(opts.status) || DEFAULT_ORDER_STATUS_ID);
        put('dueDate', opts.dueDate);
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
        put('width', opts.width);
        put('length', opts.length);
        put('sleeve', opts.sleeve);
        put('winding', normalizeWinding(opts.winding));
        put('status', opts.status);

        var url = '/' + encodeURIComponent(opts.db) + '/_m_new/' +
            encodeURIComponent(opts.tableId) + '?JSON&up=' + encodeURIComponent(opts.orderId);
        return { url: url, body: buildFormBody(fields, opts.xsrf) };
    }

    // Запрос правки позиции: POST _m_set/{positionId} + реквизиты редактируемых полей.
    // values — { qty, raw, width, length, sleeve, winding, status }; ключи без reqId пропускаются.
    function buildSetPositionRequest(opts) {
        var fields = {};
        var cols = opts.columns || [];
        var values = opts.values || {};
        function put(key, value) {
            var col = getColumn(cols, key);
            if (col && col.reqId) fields[col.reqId] = value == null ? '' : value;
        }
        put('qty', values.qty);
        put('raw', values.raw);
        put('width', values.width);
        put('length', values.length);
        put('sleeve', values.sleeve);
        put('winding', normalizeWinding(values.winding));
        put('status', values.status);
        put('dueDate', values.dueDate);

        var url = '/' + encodeURIComponent(opts.db) + '/_m_set/' +
            encodeURIComponent(opts.objId) + '?JSON';
        return { url: url, body: buildFormBody(fields, opts.xsrf) };
    }

    function buildSetFieldRequest(opts) {
        var fields = {};
        if (opts && opts.reqId) {
            fields[opts.reqId] = opts.value == null ? '' : opts.value;
        }
        var url = '/' + encodeURIComponent(opts.db) + '/_m_set/' +
            encodeURIComponent(opts.objId) + '?JSON';
        return { url: url, body: buildFormBody(fields, opts.xsrf) };
    }

    // Запрос удаления записи: POST _m_del/{objId}.
    function buildDeleteRequest(opts) {
        var url = '/' + encodeURIComponent(opts.db) + '/_m_del/' +
            encodeURIComponent(opts.objId) + '?JSON';
        return { url: url, body: buildFormBody({}, opts.xsrf) };
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
        var statusCol = getColumn(state.orderColumns, 'status');
        var options = (statusCol && statusCol.reqId) ? (state.refOptions[statusCol.reqId] || []) : [];
        sel.innerHTML = ['<option value="">Все статусы</option>'].concat(options.map(function(opt) {
            var selected = String(opt.id) === state.statusFilter ? ' selected' : '';
            return '<option value="' + escapeHtml(opt.id) + '">' + escapeHtml(opt.text) + '</option>';
        })).join('');
    }

    function renderPositions(order) {
        var positions = state.positionsByOrder[order.id] || order.positions || [];
        var head = '<thead><tr>' +
            '<th>Кол-во</th><th>Вид сырья</th>' +
            '<th>Ширина, мм</th><th>Длина, м</th><th>Ø втулки</th><th>Тип намотки</th><th>Статус</th><th>Дата согл.</th><th>Срок изг.</th><th></th>' +
            '</tr></thead>';
        var rowsHtml = positions.map(function(pos) { return renderPositionRow(order, pos); }).join('');
        if (state.draftOrderId === String(order.id)) rowsHtml += renderDraftRow(order);
        var body = rowsHtml
            ? '<tbody>' + rowsHtml + '</tbody>'
            : '<tbody><tr><td colspan="10" class="atex-orders-empty">Позиций пока нет.</td></tr></tbody>';

        return '<div class="atex-orders-positions">' +
            '<table class="atex-orders-subtable">' + head + body + '</table>' +
            '<div class="atex-orders-position-actions">' +
            '<button type="button" class="atex-orders-btn atex-orders-btn-secondary" ' +
            'data-add-position="' + escapeHtml(order.id) + '">' +
            '<i class="pi pi-plus"></i><span>Добавить позицию</span></button>' +
            deleteOrderButtonHtml(order) +
            '</div>' +
            '</div>';
    }

    // Поячейково редактируемые столбцы позиции (по data-cell соответствует key в state.positionColumns).
    var EDITABLE_POSITION_CELLS = ['qty', 'raw', 'width', 'length', 'sleeve', 'winding', 'dueDate'];
    var POSITION_ENTRY_CELLS = ['qty', 'raw', 'width', 'length', 'sleeve', 'winding'];
    var EDITABLE_ORDER_CELLS = ['created', 'dueDate'];

    // Текст отображения значения ячейки позиции (для ref-полей — подпись из values).
    function positionCellText(pos, key) {
        return pos.values[key] || '';
    }

    // Одна ячейка-отображение: кликабельна, превращается в контрол по клику.
    function positionDisplayCell(pos, key) {
        return '<td class="atex-orders-cell" data-cell="' + escapeHtml(key) +
            '" data-position-id="' + escapeHtml(pos.id) + '" tabindex="0">' +
            escapeHtml(positionCellText(pos, key)) + '</td>';
    }

    function orderCellText(order, key) {
        return order.values[key] || '';
    }

    function orderDisplayCell(order, key) {
        return '<td class="atex-orders-cell atex-orders-order-cell" data-order-cell="' + escapeHtml(key) +
            '" data-order-id="' + escapeHtml(order.id) + '" tabindex="0">' +
            escapeHtml(orderCellText(order, key)) + '</td>';
    }

    function hasApprovalDate(record) {
        return !!(record && record.values && trimValue(record.values.approved));
    }

    function orderPositionsForDelete(order) {
        if (!order) return [];
        var loaded = state.positionsByOrder[String(order.id)];
        return loaded || order.positions || [];
    }

    function orderDeleteBlockReason(order) {
        if (!order) return 'Заказ не найден.';
        if (hasApprovalDate(order)) return 'Нельзя удалить заказ: заказ согласован.';
        var positions = orderPositionsForDelete(order);
        for (var i = 0; i < positions.length; i++) {
            if (hasApprovalDate(positions[i])) {
                return 'Нельзя удалить заказ: есть согласованные позиции.';
            }
        }
        return '';
    }

    function canDeleteOrder(order) {
        return !orderDeleteBlockReason(order);
    }

    function deleteOrderButtonHtml(order) {
        var reason = orderDeleteBlockReason(order);
        var attrs = reason
            ? ' disabled aria-disabled="true" title="' + escapeHtml(reason) + '"'
            : ' data-del-order="' + escapeHtml(order.id) + '" title="Удалить заказ"';
        return '<button type="button" class="atex-orders-btn atex-orders-btn-secondary atex-orders-btn-danger"' +
            attrs + '>' +
            '<i class="pi pi-trash"></i><span>Удалить заказ</span></button>';
    }

    // Строка позиции: все редактируемые ячейки кликабельны + кнопка удаления.
    // data-position-form на <tr> нужно делегированию ref-select (как раньше у формы).
    function renderPositionRow(order, pos) {
        return '<tr data-position-id="' + escapeHtml(pos.id) + '" data-position-form="' + escapeHtml(order.id) + '">' +
            positionDisplayCell(pos, 'qty') +
            positionDisplayCell(pos, 'raw') +
            positionDisplayCell(pos, 'width') +
            positionDisplayCell(pos, 'length') +
            positionDisplayCell(pos, 'sleeve') +
            positionDisplayCell(pos, 'winding') +
            (pos.values.status === 'Новая'
                ? '<td><button type="button" class="atex-orders-btn atex-orders-btn-secondary atex-orders-approve" data-approve-pos="' + escapeHtml(pos.id) + '">Согласовать</button></td>'
                : '<td>' + escapeHtml(pos.values.status || '') + '</td>') +
            '<td>' + escapeHtml(pos.values.approved || '') + '</td>' +
            positionDisplayCell(pos, 'dueDate') +
            '<td class="atex-orders-pos-actions">' +
            '<button type="button" class="atex-orders-icon-btn atex-orders-icon-btn--danger" title="Удалить" ' +
            'aria-label="Удалить" data-del-pos="' + escapeHtml(pos.id) + '"><i class="pi pi-trash"></i></button>' +
            '</td>' +
            '</tr>';
    }

    // Черновая строка новой позиции (до первого ввода): редактируемые пустые ячейки + отмена.
    // data-position-id="__draft__" — savePositionCell/activateCell распознают черновик через findPositionById.
    function renderDraftRow(order) {
        var draft = { id: '__draft__', values: {}, refs: {} };
        var cells = POSITION_ENTRY_CELLS.map(function(key) { return positionDisplayCell(draft, key); }).join('');
        return '<tr class="atex-orders-draft-row" data-draft-order="' + escapeHtml(order.id) +
            '" data-position-form="' + escapeHtml(order.id) + '">' + cells +
            '<td></td><td></td>' + positionDisplayCell(draft, 'dueDate') +
            '<td class="atex-orders-pos-actions">' +
            '<button type="button" class="atex-orders-icon-btn" title="Отменить черновик" ' +
            'aria-label="Отменить черновик" data-cancel-draft="1"><i class="pi pi-times"></i></button>' +
            '</td></tr>';
    }

    function renderOrders() {
        var container = document.getElementById('atex-orders-list');
        if (!container) return;

        var orders = sortOrders(searchOrders(state.orders, state.searchQuery), state.sortKey, state.sortDir);
        if (!orders.length) {
            container.innerHTML = '<div class="atex-orders-empty">' +
                (state.orders.length ? 'Ничего не найдено по поиску.' : 'Заказов нет за выбранный период.') +
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
                '<td>' + escapeHtml(order.values.no || '') + '</td>' +
                '<td>' + escapeHtml(order.values.client || '') + '</td>' +
                '<td>' + escapeHtml(order.values.manager || '') + '</td>' +
                orderDisplayCell(order, 'created') +
                '<td>' + escapeHtml(order.values.approved || '') + '</td>' +
                orderDisplayCell(order, 'dueDate') +
                '<td>' + (order.values.status === 'Новый'
                    ? '<button type="button" class="atex-orders-btn atex-orders-btn-secondary atex-orders-approve" data-approve-order="' + escapeHtml(order.id) + '">Согласовать</button>'
                    : escapeHtml(order.values.status || '')) + '</td>' +
                '<td class="atex-orders-count">' + positionCount + '</td>' +
                '</tr>';
            var detail = isOpen
                ? '<tr class="atex-orders-detail-row"><td colspan="9">' + renderPositions(order) + '</td></tr>'
                : '';
            return main + detail;
        }).join('');

        function sortableTh(key, label) {
            var cls = state.sortKey === key ? (state.sortDir === 'desc' ? ' class="is-sorted-desc"' : ' class="is-sorted-asc"') : '';
            return '<th data-sort="' + key + '"' + cls + '>' + label + '</th>';
        }
        var thead = '<thead><tr><th></th>' +
            sortableTh('id', '№') + sortableTh('client', 'Клиент') + sortableTh('manager', 'Менеджер') +
            sortableTh('created', 'Дата создания') + sortableTh('approved', 'Дата согл.') +
            sortableTh('dueDate', 'Срок изготовления') + sortableTh('status', 'Статус') +
            '<th>Позиций</th></tr></thead>';
        container.innerHTML = '<table class="atex-orders-table">' + thead +
            '<tbody>' + rows + '</tbody></table>';

        container.querySelectorAll('th[data-sort]').forEach(function(th) {
            th.style.cursor = 'pointer';
            th.addEventListener('click', function() {
                var key = th.getAttribute('data-sort');
                if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
                else { state.sortKey = key; state.sortDir = 'asc'; }
                renderOrders();
            });
        });
    }

    function renderCreateForm() {
        var clientCol = getColumn(state.orderColumns, 'client');
        var clientOptions = clientCol && clientCol.reqId ? state.refOptions[clientCol.reqId] : null;
        var statusCol = getColumn(state.orderColumns, 'status');
        var statusOptions = ensureDefaultOrderStatusOption(statusCol && statusCol.reqId ? (state.refOptions[statusCol.reqId] || []) : []);
        var panel = document.getElementById('atex-order-create-form');
        if (!panel) return;
        panel.innerHTML =
            '<div class="atex-orders-fields">' +
            '<label>Клиент' + refSelectHtml('atex-order-client', clientOptions, '', 'Выберите клиента', clientCol && clientCol.reqId) + '</label>' +
            '<label>Статус' + refSelectHtml('atex-order-status', statusOptions, DEFAULT_ORDER_STATUS_ID, 'Выберите статус', statusCol && statusCol.reqId) + '</label>' +
            '<label>Срок изготовления<input type="date" class="atex-orders-input" id="atex-order-due-date"></label>' +
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
        var params = ['JSON_KV', 'LIMIT=0,5000'];
        // Фильтр по дате создания. Обе границы заданы → диапазон без операторов
        // (FR_=С & TO_=По). Только одна граница → оператор >= / <= (без него одиночные
        // FR_/TO_ трактуются как точное совпадение и дают 0). Проверено на бою.
        if (state.filterFrom && state.filterTo) {
            params.push('FR_order_created=' + encodeURIComponent(state.filterFrom));
            params.push('TO_order_created=' + encodeURIComponent(state.filterTo));
        } else if (state.filterFrom) {
            params.push('FR_order_created=>' + encodeURIComponent(state.filterFrom));
        } else if (state.filterTo) {
            params.push('TO_order_created=<' + encodeURIComponent(state.filterTo));
        }
        // Статус — точное совпадение (FR_ по тексту работает как exact).
        if (trimValue(state.statusFilter)) params.push('FR_order_status=' + encodeURIComponent(trimValue(state.statusFilter)));
        var url = '/' + encodeURIComponent(getApiBase()) + '/report/orders_list?' + params.join('&');
        return fetchJson(url).then(function(rows) {
            state.editingCell = null;
            state.editingOrderCell = null;
            state.orders = rowsToOrders(rows || []);
            state.positionsByOrder = {};
            state.orders.forEach(function(o) { state.positionsByOrder[o.id] = o.positions; });
            renderOrders();
        });
    }

    function createOrder() {
        if (state.creating) return;
        var clientSel = document.getElementById('atex-order-client');
        var statusSel = document.getElementById('atex-order-status');
        var dueDateEl = document.getElementById('atex-order-due-date');
        var notesEl = document.getElementById('atex-order-notes');

        var req = buildCreateOrderRequest({
            db: getApiBase(),
            tableId: state.orderTable,
            columns: state.orderColumns,
            clientId: clientSel ? clientSel.value : '',
            managerId: typeof window.uid !== 'undefined' ? window.uid : (typeof uid !== 'undefined' ? uid : ''),
            created: todayIso(),
            status: statusSel && statusSel.value ? statusSel.value : DEFAULT_ORDER_STATUS_ID,
            dueDate: dueDateEl ? dueDateEl.value : '',
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
                if (newId) state.expanded[newId] = true;
            });
        }).catch(function(error) {
            setMessage('Не удалось создать заказ: ' + (error.message || error), 'error');
        }).finally(function() {
            state.creating = false;
        });
    }

    // Добавление позиции: сразу создаём пустую запись на сервере (только дефолтный
    // статус), берём id из ответа и перезагружаем отчётом — новая строка появляется
    // в таблице и редактируется поячейково, как остальные.
    // «Добавить позицию» — показываем черновую строку до первого ввода (без записи на сервер).
    // Первое сохранённое непустое поле создаёт позицию (_m_new) — см. savePositionCell.
    function createPosition(orderId) {
        var oid = String(orderId);
        state.draftOrderId = oid;
        state.draftPos = { id: '__draft__', values: {}, refs: {} };
        state.expanded[oid] = true;
        renderOrders();
        // Сразу активируем первую ячейку черновой строки для ввода.
        var firstCell = document.querySelector('tr[data-draft-order="' + cssEscape(oid) +
            '"] td.atex-orders-cell[data-cell="qty"]');
        if (firstCell) activateCell(firstCell);
    }

    // Создаёт позицию из накопленного черновика (_m_new со всеми непустыми полями).
    // Если данных нет — просто убирает черновую строку.
    function commitDraft() {
        var draft = state.draftPos;
        var orderId = state.draftOrderId;
        if (!draft || !orderId) return;
        var fields = {};
        var any = false;
        state.positionColumns.forEach(function(col) {
            if (!col || !col.reqId) return;
            var val = col.ref ? (draft.refs[col.key] || '') : (draft.values[col.key] || '');
            if (val !== '' && val != null) { fields[col.reqId] = val; any = true; }
        });
        state.draftOrderId = null;
        state.draftPos = null;
        if (!any) { renderOrders(); return; }
        var statusCol = getColumn(state.positionColumns, 'status');
        if (statusCol && statusCol.reqId && !fields[statusCol.reqId]) fields[statusCol.reqId] = state.positionStatuses[0];
        var url = '/' + encodeURIComponent(getApiBase()) + '/_m_new/' + encodeURIComponent(state.positionTable) +
            '?JSON&up=' + encodeURIComponent(orderId);
        setMessage('Добавление позиции…', 'info');
        postForm(url, buildFormBody(fields, getXsrf())).then(function() {
            setMessage('Позиция добавлена.', 'success');
            return loadOrders();
        }).catch(function(error) {
            setMessage('Не удалось добавить позицию: ' + (error.message || error), 'error');
            return loadOrders();
        });
    }

    // Находит позицию и её orderId по id позиции в state.positionsByOrder.
    function findPositionById(posId) {
        var pid = String(posId);
        if (pid === '__draft__') {
            return state.draftPos ? { orderId: state.draftOrderId, position: state.draftPos } : null;
        }
        var keys = Object.keys(state.positionsByOrder);
        for (var i = 0; i < keys.length; i++) {
            var list = state.positionsByOrder[keys[i]] || [];
            for (var j = 0; j < list.length; j++) {
                if (String(list[j].id) === pid) return { orderId: keys[i], position: list[j] };
            }
        }
        return null;
    }

    // --- Поячейковая правка ---------------------------------------------------

    // Закрывает активную ячейку без сохранения (восстанавливает её как отображение).
    function deactivateCell() {
        var td = state.editingCell;
        state.editingCell = null;
        if (!td || !td.parentNode) return;
        var key = td.getAttribute('data-cell');
        var posId = td.getAttribute('data-position-id');
        var found = posId ? findPositionById(posId) : null;
        td.classList.remove('is-editing');
        td.textContent = found ? positionCellText(found.position, key) : (td.getAttribute('data-prev') || '');
    }

    function deactivateOrderCell() {
        var td = state.editingOrderCell;
        state.editingOrderCell = null;
        if (!td || !td.parentNode) return;
        var key = td.getAttribute('data-order-cell');
        var orderId = td.getAttribute('data-order-id');
        var order = orderId ? findOrder(orderId) : null;
        td.classList.remove('is-editing');
        td.textContent = order ? orderCellText(order, key) : (td.getAttribute('data-prev') || '');
    }

    function activeCellControlValue(td) {
        if (!td) return null;
        var input = td.querySelector('input[data-field]');
        if (input) return input.value;
        var select = td.querySelector('select[data-field]');
        if (select) return select.value;
        return null;
    }

    function saveActivePositionCell() {
        var td = state.editingCell;
        if (!td) return;
        var col = getColumn(state.positionColumns, td.getAttribute('data-cell'));
        if (col && col.ref) {
            deactivateCell();
            return;
        }
        var value = activeCellControlValue(td);
        if (value == null) deactivateCell();
        else savePositionCell(td, value);
    }

    function saveActiveOrderCell() {
        var td = state.editingOrderCell;
        if (!td) return;
        var input = td.querySelector('input[data-order-field]');
        if (!input) deactivateOrderCell();
        else saveOrderCell(td, input.value);
    }

    // Переводит ячейку отображения в режим правки: подставляет контрол и даёт фокус.
    function activateCell(td) {
        if (!td || state.editingCell === td) return;
        var key = td.getAttribute('data-cell');
        var posId = td.getAttribute('data-position-id');
        var found = posId ? findPositionById(posId) : null;
        if (!found) return;
        // id ссылок (raw/sleeve) приходят прямо из отчёта orders_list —
        // отдельная догрузка позиций заказа больше не требуется.
        if (state.editingOrderCell) saveActiveOrderCell();
        if (state.editingCell && state.editingCell !== td) saveActivePositionCell();
        state.editingCell = td;
        td.classList.add('is-editing');
        var pos = found.position;
        var prevValue = positionCellText(pos, key);
        td.setAttribute('data-prev', prevValue);
        td.innerHTML = renderCellControl(found.orderId, pos, key);
        focusCellControl(td, key, found.orderId);
    }

    function activateOrderCell(td) {
        if (!td || state.editingOrderCell === td) return;
        var key = td.getAttribute('data-order-cell');
        var orderId = td.getAttribute('data-order-id');
        var order = orderId ? findOrder(orderId) : null;
        var col = getColumn(state.orderColumns, key);
        if (!order || !col || !col.reqId) return;
        if (state.editingCell) saveActivePositionCell();
        if (state.editingOrderCell && state.editingOrderCell !== td) saveActiveOrderCell();
        state.editingOrderCell = td;
        td.classList.add('is-editing');
        var prevValue = orderCellText(order, key);
        td.setAttribute('data-prev', prevValue);
        td.innerHTML = renderOrderCellControl(order, key);
        focusOrderCellControl(td);
    }

    // HTML контрола для ячейки по типу столбца.
    function renderCellControl(orderId, pos, key) {
        var col = getColumn(state.positionColumns, key);
        var refs = pos.refs || {};
        if (key === 'qty' || key === 'width' || key === 'length') {
            var step = key === 'length' ? ' step="any"' : '';
            return '<input class="atex-orders-input atex-orders-cell-input" type="number" min="0"' + step +
                ' data-field="' + escapeHtml(key) + '" value="' + escapeHtml(pos.values[key] || '') + '">';
        }
        if (key === 'dueDate') {
            return '<input class="atex-orders-input atex-orders-cell-input" type="date" ' +
                'data-field="dueDate" value="' + escapeHtml(dateDisplayToInputValue(pos.values.dueDate || '')) + '">';
        }
        if (col && col.ref) {
            var placeholder = key === 'raw' ? 'Выберите вид сырья' : 'Выберите диаметр';
            var options = col.reqId ? state.refOptions[col.reqId] : null;
            return refSelectHtml('atex-pos-' + key + '-cell-' + pos.id, options, refs[key] || '', placeholder, col.reqId);
        }
        if (key === 'winding') {
            var w = (pos.values.winding || '').toUpperCase();
            return '<select class="atex-orders-input atex-orders-cell-input atex-orders-winding" data-field="winding">' +
                '<option value=""' + (w ? '' : ' selected') + '>— не задано —</option>' +
                '<option value="IN"' + (w === 'IN' ? ' selected' : '') + '>IN</option>' +
                '<option value="OUT"' + (w === 'OUT' ? ' selected' : '') + '>OUT</option>' +
                '</select>';
        }
        // status
        return statusSelectHtml(state.positionStatuses, pos.values.status,
            ' data-field="status" class="atex-orders-status atex-orders-cell-input"');
    }

    function renderOrderCellControl(order, key) {
        return '<input class="atex-orders-input atex-orders-cell-input" type="date" ' +
            'data-order-field="' + escapeHtml(key) + '" value="' + escapeHtml(dateDisplayToInputValue(order.values[key] || '')) + '">';
    }

    // Фокус на контрол внутри активированной ячейки.
    function focusCellControl(td, key, orderId) {
        var col = getColumn(state.positionColumns, key);
        if (col && col.ref) {
            var search = td.querySelector('[data-ref-search]');
            if (search) search.focus();
            return;
        }
        var input = td.querySelector('[data-field]');
        if (input) {
            input.focus();
            if (input.select) input.select();
        }
    }

    function focusOrderCellControl(td) {
        var input = td.querySelector('[data-order-field]');
        if (input) {
            input.focus();
            if (input.select) input.select();
        }
    }

    // Значение скрытого ref-input строки по reqId (для фильтра типов резки строки).
    // В строке ref-контрол есть только у активной ячейки; если сырьё не редактируется
    // сейчас — берём id из данных позиции (refs).
    function rowRefValue(row, reqId) {
        var w = row.querySelector('[data-ref-select][data-ref-req-id="' + cssEscape(reqId) + '"]');
        var hidden = w ? w.querySelector('[data-ref-value]') : null;
        if (hidden) return hidden.value;
        var posId = row.getAttribute('data-position-id');
        var found = posId ? findPositionById(posId) : null;
        var rawCol = getColumn(state.positionColumns, 'raw');
        if (found && found.position.refs && rawCol && String(rawCol.reqId) === String(reqId)) {
            return found.position.refs.raw || '';
        }
        return '';
    }

    // Источник строки правки (позиция или черновик) — для ref-фильтров по строке.
    // В поячейковой правке активна одна ячейка, поэтому «Вид сырья»/«Ширину»
    // берём из ДАННЫХ строки, а не из DOM (контролов соседних полей на странице нет).
    function rowSourcePosition(form) {
        if (form && form.getAttribute && form.getAttribute('data-draft-order')) return state.draftPos;
        var idCell = form && form.querySelector ? form.querySelector('td[data-position-id]') : null;
        var pid = idCell ? idCell.getAttribute('data-position-id') : null;
        var f = pid ? findPositionById(pid) : null;
        return f ? f.position : null;
    }
    function rowMaterialId(form) {
        var rawCol = getColumn(state.positionColumns, 'raw');
        var dom = rawCol && rawCol.reqId ? rowRefValue(form, rawCol.reqId) : '';
        if (dom) return dom;
        var pos = rowSourcePosition(form);
        return pos && pos.refs ? (pos.refs.raw || '') : '';
    }
    function rowWidthValue(form) {
        var w = form && form.querySelector ? form.querySelector('[data-field="width"]') : null;
        if (w && w.value) return w.value;
        var pos = rowSourcePosition(form);
        return pos && pos.values ? (pos.values.width || '') : '';
    }

    // Сохранение одного поля позиции: _m_set/{posId} с единственным t{reqId}.
    // Если значение не изменилось — просто возврат отображения, без запроса.
    function savePositionCell(td, newValue) {
        if (!td) return;
        var key = td.getAttribute('data-cell');
        var posId = td.getAttribute('data-position-id');
        var col = getColumn(state.positionColumns, key);
        var found = posId ? findPositionById(posId) : null;
        state.editingCell = null;
        td.classList.remove('is-editing');
        if (!found || !col || !col.reqId) {
            if (found) td.textContent = positionCellText(found.position, key);
            return;
        }
        var pos = found.position;
        // Для ref-полей сравниваем по id (refs), не по подписи.
        var isRef = !!col.ref;
        var prevCompare = isRef ? ((pos.refs && pos.refs[key]) || '') : (pos.values[key] || '');
        var nextCompare = newValue == null ? '' : String(newValue);
        if (key === 'winding') nextCompare = normalizeWinding(nextCompare);
        if (key === 'dueDate') {
            prevCompare = dateDisplayToInputValue(prevCompare);
            nextCompare = dateDisplayToInputValue(nextCompare);
        }
        if (String(prevCompare) === String(nextCompare)) {
            // Без изменений — вернуть отображение как было.
            td.textContent = positionCellText(pos, key);
            return;
        }
        // Черновик: копим значение в памяти строки (без записи на сервер). Позиция
        // создаётся при выходе из черновой строки (commitDraft) — так ref-фильтры по
        // строке видят выбранный вид сырья ещё до создания.
        if (posId === '__draft__') {
            if (isRef) {
                state.draftPos.refs[key] = nextCompare;
                state.draftPos.values[key] = td.getAttribute('data-display') || nextCompare;
            } else {
                state.draftPos.values[key] = key === 'dueDate'
                    ? dateInputToDisplayValue(nextCompare)
                    : (key === 'winding' ? normalizeWinding(nextCompare) : nextCompare);
            }
            td.textContent = positionCellText(state.draftPos, key);
            return;
        }
        var fields = {};
        fields[col.reqId] = key === 'winding' ? normalizeWinding(nextCompare) : nextCompare;
        var url = '/' + encodeURIComponent(getApiBase()) + '/_m_set/' + encodeURIComponent(posId) + '?JSON';
        var body = buildFormBody(fields, getXsrf());
        setMessage('Сохранение…', 'info');
        var oldValue = pos.values[key] || '';
        var oldRef = pos.refs ? (pos.refs[key] || '') : '';
        if (isRef) {
            pos.refs = pos.refs || {};
            pos.refs[key] = nextCompare;
            pos.values[key] = td.getAttribute('data-display') || nextCompare;
        } else {
            pos.values[key] = key === 'dueDate'
                ? dateInputToDisplayValue(nextCompare)
                : (key === 'winding' ? normalizeWinding(nextCompare) : nextCompare);
        }
        td.textContent = positionCellText(pos, key);
        postForm(url, body).then(function() {
            setMessage('Сохранено.', 'success');
        }).catch(function(error) {
            setMessage('Не удалось сохранить: ' + (error.message || error), 'error');
            // Откат отображения.
            pos.values[key] = oldValue;
            if (isRef) pos.refs[key] = oldRef;
            td.textContent = positionCellText(pos, key);
        });
    }

    function saveOrderCell(td, newValue) {
        if (!td) return;
        var key = td.getAttribute('data-order-cell');
        var orderId = td.getAttribute('data-order-id');
        var col = getColumn(state.orderColumns, key);
        var order = orderId ? findOrder(orderId) : null;
        state.editingOrderCell = null;
        td.classList.remove('is-editing');
        if (!order || !col || !col.reqId) {
            if (order) td.textContent = orderCellText(order, key);
            return;
        }

        var prevCompare = dateDisplayToInputValue(order.values[key] || '');
        var nextCompare = dateDisplayToInputValue(newValue == null ? '' : String(newValue));
        if (String(prevCompare) === String(nextCompare)) {
            td.textContent = orderCellText(order, key);
            return;
        }

        var oldValue = order.values[key] || '';
        order.values[key] = dateInputToDisplayValue(nextCompare);
        td.textContent = orderCellText(order, key);

        var req = buildSetFieldRequest({
            db: getApiBase(),
            objId: orderId,
            reqId: col.reqId,
            value: nextCompare,
            xsrf: getXsrf()
        });
        setMessage('Сохранение…', 'info');
        postForm(req.url, req.body).then(function() {
            setMessage('Сохранено.', 'success');
        }).catch(function(error) {
            setMessage('Не удалось сохранить: ' + (error.message || error), 'error');
            order.values[key] = oldValue;
            td.textContent = orderCellText(order, key);
        });
    }

    // Удаление позиции: _m_del/{posId} → перезагрузка отчётом.
    function deletePosition(posId) {
        var req = buildDeleteRequest({ db: getApiBase(), objId: posId, xsrf: getXsrf() });
        setMessage('Удаление позиции…', 'info');
        postForm(req.url, req.body).then(function() {
            if (state.editingCell) state.editingCell = null;
            if (state.editingOrderCell) state.editingOrderCell = null;
            setMessage('Позиция удалена.', 'success');
            return loadOrders();
        }).catch(function(error) {
            setMessage('Не удалось удалить позицию: ' + (error.message || error), 'error');
        });
    }

    // Удаление заказа: _m_del/{orderId} → перезагрузка отчётом.
    function deleteOrder(orderId) {
        var order = findOrder(orderId);
        var blockReason = orderDeleteBlockReason(order);
        if (blockReason) {
            setMessage(blockReason, 'error');
            return;
        }
        var req = buildDeleteRequest({ db: getApiBase(), objId: orderId, xsrf: getXsrf() });
        setMessage('Удаление заказа…', 'info');
        postForm(req.url, req.body).then(function() {
            state.editingCell = null;
            state.editingOrderCell = null;
            if (state.draftOrderId === String(orderId)) {
                state.draftOrderId = null;
                state.draftPos = null;
            }
            delete state.expanded[String(orderId)];
            setMessage('Заказ удалён.', 'success');
            return loadOrders();
        }).catch(function(error) {
            setMessage('Не удалось удалить заказ: ' + (error.message || error), 'error');
        });
    }

    // Согласование заказа/позиции: вызов SET-отчёта approve_order / approve_position.
    // Отчёт под правами владельца ставит статус «Согласован(а)» и дату согласования = сегодня.
    function approveRecord(isOrder, recordId) {
        var report = isOrder ? 'approve_order' : 'approve_position';
        var filterKey = isOrder ? 'FR_order_id' : 'FR_position_id';
        // Тело отчёта: «сырые» имена параметров (не t{reqId}) — buildFormBody здесь не подходит,
        // т.к. он префиксует ключи 't'. Собираем application/x-www-form-urlencoded вручную.
        var xsrf = getXsrf();
        var params = [];
        if (xsrf) params.push('_xsrf=' + encodeURIComponent(xsrf));
        params.push('confirmed=1');
        params.push(filterKey + '=' + encodeURIComponent(recordId));
        var body = params.join('&');
        var url = '/' + encodeURIComponent(getApiBase()) + '/report/' + report + '?JSON_KV';
        setMessage('Согласование…', 'info');
        postForm(url, body).then(function() {
            return loadOrders();
        }).then(function() {
            setMessage('Согласовано.', 'success');
        }).catch(function(error) {
            setMessage('Не удалось согласовать: ' + (error.message || error), 'error');
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

    function selectRefOption(option) {
        var wrapper = refWrapperFrom(option);
        if (!wrapper) return;
        var hidden = wrapper.querySelector('[data-ref-value]');
        var search = wrapper.querySelector('[data-ref-search]');
        var value = option.getAttribute('data-value') || '';
        var label = option.textContent || '';
        if (hidden) hidden.value = value;
        if (search) search.value = label;
        updateRefClear(wrapper);
        closeRefSelect(wrapper);
        // Поячейковая правка: ref-select внутри активной ячейки → сохранить выбор.
        var cell = wrapper.closest ? wrapper.closest('td.atex-orders-cell') : null;
        if (cell && cell === state.editingCell) {
            cell.setAttribute('data-display', label);
            savePositionCell(cell, value);
            return;
        }
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
                loadOrders();
            });
        }

        var fromEl = document.getElementById('atex-orders-from');
        var toEl = document.getElementById('atex-orders-to');
        var searchEl = document.getElementById('atex-orders-search');
        if (fromEl) {
            var yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
            state.filterFrom = yesterday.toISOString().slice(0, 10);
            fromEl.value = state.filterFrom;
            fromEl.addEventListener('change', function() { state.filterFrom = fromEl.value; loadOrders(); });
        }
        if (toEl) toEl.addEventListener('change', function() { state.filterTo = toEl.value; loadOrders(); });
        if (searchEl) {
            var searchTimer = null;
            searchEl.addEventListener('input', function() {
                if (searchTimer) clearTimeout(searchTimer);
                searchTimer = setTimeout(function() { state.searchQuery = searchEl.value; renderOrders(); }, 200);
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
                    renderOrders();   // позиции уже загружены отчётом orders_list
                    return;
                }

                // Добавление позиции — сразу создаём пустую строку на сервере.
                var addPos = event.target.closest('[data-add-position]');
                if (addPos) {
                    createPosition(addPos.getAttribute('data-add-position'));
                    return;
                }
                var cancelDraft = event.target.closest('[data-cancel-draft]');
                if (cancelDraft) {
                    state.draftOrderId = null;
                    state.draftPos = null;
                    state.editingCell = null;
                    renderOrders();
                    return;
                }

                var delBtn = event.target.closest('[data-del-pos]');
                if (delBtn) {
                    var delId = delBtn.getAttribute('data-del-pos');
                    // Подтверждение без confirm(): первый клик переводит кнопку в режим подтверждения,
                    // второй (в течение 4с) — удаляет. Клик по другой кнопке сбрасывает состояние.
                    if (delBtn.getAttribute('data-confirm') === '1') {
                        deletePosition(delId);
                    } else {
                        resetDeleteConfirm(list);
                        delBtn.setAttribute('data-confirm', '1');
                        delBtn.classList.add('is-confirm');
                        delBtn.setAttribute('title', 'Нажмите ещё раз для удаления');
                        setMessage('Нажмите ещё раз, чтобы удалить позицию.', 'info');
                        delBtn._atexDelTimer = setTimeout(function() {
                            delBtn.removeAttribute('data-confirm');
                            delBtn.classList.remove('is-confirm');
                            delBtn.setAttribute('title', 'Удалить');
                        }, 4000);
                    }
                    return;
                }
                var delOrderBtn = event.target.closest('[data-del-order]');
                if (delOrderBtn) {
                    var delOrderId = delOrderBtn.getAttribute('data-del-order');
                    var order = findOrder(delOrderId);
                    var blockReason = orderDeleteBlockReason(order);
                    if (blockReason) {
                        resetDeleteConfirm(list);
                        setMessage(blockReason, 'error');
                        return;
                    }
                    if (delOrderBtn.getAttribute('data-confirm') === '1') {
                        deleteOrder(delOrderId);
                    } else {
                        resetDeleteConfirm(list);
                        delOrderBtn.setAttribute('data-confirm', '1');
                        delOrderBtn.classList.add('is-confirm');
                        delOrderBtn.textContent = 'Подтвердить удаление?';
                        setMessage('Нажмите ещё раз, чтобы удалить заказ.', 'info');
                        delOrderBtn._atexDelTimer = setTimeout(function() {
                            delOrderBtn.removeAttribute('data-confirm');
                            delOrderBtn.classList.remove('is-confirm');
                            delOrderBtn.innerHTML = '<i class="pi pi-trash"></i><span>Удалить заказ</span>';
                        }, 4000);
                    }
                    return;
                }
                // Кнопки «Согласовать» (заказ/позиция). Подтверждение двойным кликом, как у удаления.
                var approveBtn = event.target.closest('[data-approve-order],[data-approve-pos]');
                if (approveBtn) {
                    var isOrderApprove = approveBtn.hasAttribute('data-approve-order');
                    var approveId = approveBtn.getAttribute(isOrderApprove ? 'data-approve-order' : 'data-approve-pos');
                    if (approveBtn.getAttribute('data-confirm') === '1') {
                        approveRecord(isOrderApprove, approveId);
                    } else {
                        resetDeleteConfirm(list);
                        approveBtn.setAttribute('data-confirm', '1');
                        approveBtn.classList.add('is-confirm');
                        approveBtn.textContent = 'Подтвердить?';
                        setMessage('Нажмите ещё раз, чтобы согласовать.', 'info');
                        approveBtn._atexApproveTimer = setTimeout(function() {
                            approveBtn.removeAttribute('data-confirm');
                            approveBtn.classList.remove('is-confirm');
                            approveBtn.textContent = 'Согласовать';
                        }, 4000);
                    }
                    return;
                }
                // Клик мимо кнопки удаления/согласования — сбросить незавершённое подтверждение.
                resetDeleteConfirm(list);

                var orderCell = event.target.closest('td.atex-orders-cell[data-order-cell]');
                if (orderCell && orderCell !== state.editingOrderCell && !orderCell.classList.contains('is-editing')) {
                    activateOrderCell(orderCell);
                    return;
                }

                // Поячейковая правка: клик по ячейке-отображению переводит её в правку.
                var cell = event.target.closest('td.atex-orders-cell[data-cell]');
                if (cell && cell !== state.editingCell && !cell.classList.contains('is-editing')) {
                    activateCell(cell);
                }
            });

            // Сохранение текстовых/числовых ячеек при потере фокуса.
            // Ref-select сохраняется по выбору опции (selectRefOption), winding/status — по change.
            list.addEventListener('focusout', function(event) {
                var input = event.target.closest && event.target.closest('input[data-field]');
                if (!input) return;
                var cell = input.closest('td.atex-orders-cell');
                if (!cell || cell !== state.editingCell) return;
                // Откладываем, чтобы не перехватить переход фокуса внутри того же контрола.
                setTimeout(function() {
                    if (state.editingCell !== cell) return;
                    savePositionCell(cell, input.value);
                }, 0);
            });

            list.addEventListener('focusout', function(event) {
                var input = event.target.closest && event.target.closest('input[data-order-field]');
                if (!input) return;
                var cell = input.closest('td.atex-orders-cell');
                if (!cell || cell !== state.editingOrderCell) return;
                setTimeout(function() {
                    if (state.editingOrderCell !== cell) return;
                    saveOrderCell(cell, input.value);
                }, 0);
            });

            // Клик вне черновой строки → создаём накопленную позицию (commitDraft).
            // Клики внутри строки (правка ячеек, выбор опции, ✕) и по «Добавить» — не создают.
            document.addEventListener('click', function(event) {
                if (!state.draftOrderId) return;
                var draftRow = list.querySelector('tr[data-draft-order="' + cssEscape(state.draftOrderId) + '"]');
                if (!draftRow) return;
                if (draftRow.contains(event.target)) return;
                if (event.target.closest && event.target.closest('[data-add-position]')) return;
                commitDraft();
            });

            list.addEventListener('change', function(event) {
                // Поячейковая правка winding: <select data-field> внутри активной ячейки.
                var cellSelect = event.target.closest('select[data-field]');
                if (cellSelect) {
                    var selCell = cellSelect.closest('td.atex-orders-cell');
                    if (selCell && selCell === state.editingCell) {
                        savePositionCell(selCell, cellSelect.value);
                    }
                }
            });
        }

        attachRefSearchEvents();
    }

    // Сбрасывает все кнопки удаления из состояния «ожидание подтверждения».
    function resetDeleteConfirm(scope) {
        if (!scope) return;
        scope.querySelectorAll('[data-del-pos][data-confirm="1"]').forEach(function(btn) {
            if (btn._atexDelTimer) clearTimeout(btn._atexDelTimer);
            btn.removeAttribute('data-confirm');
            btn.classList.remove('is-confirm');
            btn.setAttribute('title', 'Удалить');
        });
        scope.querySelectorAll('[data-del-order][data-confirm="1"]').forEach(function(btn) {
            if (btn._atexDelTimer) clearTimeout(btn._atexDelTimer);
            btn.removeAttribute('data-confirm');
            btn.classList.remove('is-confirm');
            btn.innerHTML = '<i class="pi pi-trash"></i><span>Удалить заказ</span>';
        });
        scope.querySelectorAll('[data-approve-order][data-confirm="1"],[data-approve-pos][data-confirm="1"]').forEach(function(btn) {
            if (btn._atexApproveTimer) clearTimeout(btn._atexApproveTimer);
            btn.removeAttribute('data-confirm');
            btn.classList.remove('is-confirm');
            btn.textContent = 'Согласовать';
        });
    }

    function findOrder(orderId) {
        for (var i = 0; i < state.orders.length; i++) {
            if (state.orders[i].id === String(orderId)) return state.orders[i];
        }
        return null;
    }

    function renderPositionsHtml(order) {
        return renderPositions(order || { id: '', values: {}, positions: [] });
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
                var orderStatusCol = getColumn(state.orderColumns, 'status');
                var rawCol = getColumn(state.positionColumns, 'raw');
                var sleeveCol = getColumn(state.positionColumns, 'sleeve');
                var positionStatusCol = getColumn(state.positionColumns, 'status');
                return Promise.all([
                    clientCol && clientCol.reqId ? loadRefOptions(clientCol.reqId) : Promise.resolve([]),
                    orderStatusCol && orderStatusCol.reqId ? loadRefOptions(orderStatusCol.reqId) : Promise.resolve([]),
                    rawCol && rawCol.reqId ? loadRefOptions(rawCol.reqId) : Promise.resolve([]),
                    sleeveCol && sleeveCol.reqId ? loadRefOptions(sleeveCol.reqId) : Promise.resolve([]),
                    positionStatusCol && positionStatusCol.reqId ? loadRefOptions(positionStatusCol.reqId) : Promise.resolve([])
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
        rowsToOrders: rowsToOrders,
        searchOrders: searchOrders,
        sortOrders: sortOrders,
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
        buildSetPositionRequest: buildSetPositionRequest,
        buildSetFieldRequest: buildSetFieldRequest,
        buildDeleteRequest: buildDeleteRequest,
        buildSetStatusRequest: buildSetStatusRequest,
        orderDeleteBlockReason: orderDeleteBlockReason,
        canDeleteOrder: canDeleteOrder,
        searchableRefSelectHtml: searchableRefSelectHtml,
        renderPositionsHtml: renderPositionsHtml,
        dateDisplayToInputValue: dateDisplayToInputValue,
        dateInputToDisplayValue: dateInputToDisplayValue,
        TABLE: TABLE,
        ORDER_FIELDS: ORDER_FIELDS,
        POSITION_FIELDS: POSITION_FIELDS,
        EDITABLE_ORDER_CELLS: EDITABLE_ORDER_CELLS,
        EDITABLE_POSITION_CELLS: EDITABLE_POSITION_CELLS,
        DEFAULT_ORDER_STATUS_ID: DEFAULT_ORDER_STATUS_ID,
        DEFAULT_ORDER_STATUS_LABEL: DEFAULT_ORDER_STATUS_LABEL,
        DEFAULT_ORDER_STATUSES: DEFAULT_ORDER_STATUSES,
        DEFAULT_POSITION_STATUSES: DEFAULT_POSITION_STATUSES,
        REF_OPTIONS_LIMIT: REF_OPTIONS_LIMIT,
        REF_SEARCH_LIMIT: REF_SEARCH_LIMIT,
        REF_DROPDOWN_LIMIT: REF_DROPDOWN_LIMIT,
        findReqIndex: findReqIndex,
        normalizeWinding: normalizeWinding,
        WINDING_VALUES: WINDING_VALUES,
        isPositionApproved: isPositionApproved,
        latestPositionApprovedDate: latestPositionApprovedDate,
        deriveOrderApproval: deriveOrderApproval
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
