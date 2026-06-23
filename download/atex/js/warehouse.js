/*
 * Рабочее место atex «Склад готовой продукции» (роль Кладовщик).
 *
 * Часть #2903 — «Подключи рабочие места по API». На первом этапе рабочее место
 * обращается к таблицам напрямую командами `_m_*` (см. docs/atex_workplaces.md §3.8
 * и docs/WORKSPACE_DEVELOPMENT_GUIDE.md §3). Перевод чтений на защищённый слой
 * `report/` — следующий этап и в объём этого тикета не входит.
 *
 * Таблицы и реквизиты резолвятся из metadata по имени, чтобы не хардкодить
 * object id и t{reqId} — id зависят от сборки базы:
 *   «Партия ГП»             — up=1; первая колонка — «Дата прихода» (DATETIME,
 *                             проставляется сервером = now при создании);
 *                             ссылка → «Задание в производство».
 *   «Задание в производство» — источник завершённых резок для оприходования
 *                             (#3504: таблица «Производственная резка» переименована).
 *   «Обеспечение» ⊂ «Заказанное количество» — ссылка → «Партия ГП»
 *                             (FIFO-списание партии в обеспечение позиции).
 *
 * Действия (приёмочные критерии §3.8):
 *   1. Оприходовать партию ГП из завершённой резки (ширина, кол-во рулонов,
 *      метраж, адрес хранения) — `_m_new/{Партия ГП}?JSON&up=1`.
 *   2. Сменить статус партии (Есть → Зарезервирован → Отгружен) — `_m_set/{id}`.
 *   3. FIFO-списание: привязать партию ГП к обеспечению позиции — `_m_set/{id}`
 *      у «Обеспечение» (реквизит «Партия ГП»). Выбор партии — самая ранняя
 *      доступная (по дате прихода) для той же резки.
 */
(function(window, document) {
    'use strict';

    // #3504: «cutting» — массив синонимов имени таблицы (новое имя + старое запасным).
    var TABLE = { batch: 'Партия ГП', provision: 'Обеспечение', cutting: ['Задание в производство', 'Производственная резка'] };
    var LIST_LIMIT = 5000;

    // Статусы — свободный текст (тип 3). Наборы можно переопределить data-атрибутами
    // data-batch-statuses / data-provision-statuses.
    var DEFAULT_BATCH_STATUSES = ['Есть', 'Зарезервирован', 'Отгружен'];
    var DEFAULT_PROVISION_STATUSES = ['Ожидает', 'Зарезервировано', 'Отгружено'];
    // Доступной к списанию считается партия в этом статусе.
    var AVAILABLE_BATCH_STATUS = 'Есть';
    // Резку считаем готовой к оприходованию в этих статусах.
    var COMPLETED_CUTTING_STATUSES = ['Завершён', 'Завершен', 'Готово', 'Готов'];

    // Карта полей таблицы «Партия ГП». `main: true` — первая колонка (дата прихода).
    // #3433: «Кол-во рулонов» — спрос (план под заказ); «Кол-во план» — план
    // производства (полосы × проходов); «Кол-во факт» — фактически произведённые
    // рулоны (заполняется при оприходовании/списании, может отличаться из-за брака).
    var BATCH_FIELDS = [
        { key: 'arrived', label: 'Дата прихода', main: true },
        { key: 'cutting', label: 'Задание в производство', names: ['Задание в производство', 'Производственная резка'], ref: true },
        { key: 'width', label: 'Ширина, мм', names: ['Ширина, мм', 'Ширина'] },
        { key: 'rolls', label: 'Кол-во рулонов', names: ['Кол-во рулонов', 'Количество рулонов'] },
        { key: 'planned', label: 'Кол-во план', names: ['Кол-во план'] },
        { key: 'actual', label: 'Кол-во факт', names: ['Кол-во факт'] },
        { key: 'length', label: 'Метраж, м', names: ['Метраж, м', 'Метраж'] },
        { key: 'address', label: 'Адрес хранения', names: ['Адрес хранения', 'Адрес'] },
        { key: 'orderId', label: 'ID заказа', names: ['ID заказа'] },
        { key: 'status', label: 'Статус', names: ['Статус'], status: true },
        // #3242: «Активно» переименовано в «В работе».
        { key: 'active', label: 'В работе', names: ['В работе', 'Активно', 'Активная'] }
    ];

    // Карта полей подчинённой таблицы «Обеспечение».
    var PROVISION_FIELDS = [
        { key: 'length', label: 'Метраж, м', names: ['Метраж, м', 'Метраж'] },
        { key: 'cutting', label: 'Задание в производство', names: ['Задание в производство', 'Производственная резка'], ref: true },
        { key: 'batch', label: 'Партия ГП', names: ['Партия ГП'], ref: true },
        { key: 'rolls', label: 'Кол-во рулонов', names: ['Кол-во рулонов', 'Количество рулонов'] },
        { key: 'status', label: 'Статус', names: ['Статус'], status: true }
    ];

    // Карта полей таблицы «Задание в производство» — для подбора завершённых резок.
    var CUTTING_FIELDS = [
        { key: 'number', label: 'Номер', main: true },
        { key: 'slitter', label: 'Слиттер', names: ['Слиттер'], ref: true },
        { key: 'status', label: 'Статус', names: ['Статус'], status: true }
    ];

    var state = {
        root: null,
        db: '',
        batchTable: '',
        provisionTable: '',
        cuttingTable: '',
        batchStatuses: DEFAULT_BATCH_STATUSES,
        provisionStatuses: DEFAULT_PROVISION_STATUSES,
        batchMeta: null,
        provisionMeta: null,
        cuttingMeta: null,
        batchColumns: [],
        provisionColumns: [],
        cuttingColumns: [],
        batches: [],
        provisions: [],
        cuttings: [],
        cuttingById: {},
        refOptions: {},
        statusFilter: '',
        creating: false
    };

    // ------------------------------------------------------------------
    // Чистые утилиты (выносятся в AtexWarehouseTesting для модульных тестов).
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
    // Поля с `main: true` берут первую колонку (index 0) независимо от имени.
    function buildColumns(fieldDefs, metadata) {
        var sources = buildFieldSources(metadata);
        var mainSource = sources.length ? sources[0] : null;
        return fieldDefs.map(function(def) {
            var source = def.main ? mainSource : findSource(def, sources);
            return {
                key: def.key,
                label: def.label,
                ref: !!def.ref,
                status: !!def.status,
                main: !!def.main,
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
            // #3504: значение может быть строкой или массивом синонимов имени таблицы.
            var names = [].concat(tableNames[key]);
            var meta = override ? findMetadataById(all, override) : null;
            for (var i = 0; !meta && i < names.length; i++) {
                meta = findMetadataByName(all, names[i]);
            }
            if (!meta) {
                throw new Error('В метаданных не найдена таблица «' + names[0] + '»' +
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
                main: raw.length ? String(raw[0] == null ? '' : raw[0]) : '',
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

    // ID новой записи из ответа _m_new: { "obj": 649 } или { "id": 649 }.
    function extractNewObjectId(response) {
        if (!response || typeof response !== 'object') return null;
        if (response.id != null) return String(response.id);
        if (response.obj != null) return String(response.obj);
        return null;
    }

    function isCompletedCutting(cutting) {
        if (!cutting) return false;
        var wanted = COMPLETED_CUTTING_STATUSES.map(normalizeFieldName);
        return wanted.indexOf(normalizeFieldName(cutting.values && cutting.values.status)) !== -1;
    }

    function isActiveBatch(batch) {
        var value = batch && batch.values ? batch.values.active : '';
        if (value == null || trimValue(value) === '') return true;
        var s = trimValue(value).toLowerCase();
        return !(s === '0' || s === 'false' || s === 'нет' || s === 'no' || s === 'off' || s === 'неактивно');
    }

    // #3433: фактический остаток партии для списания = «Кол-во факт» (реально
    // произведено); пока факт не проставлен — фолбэк на «Кол-во рулонов» (спрос), затем
    // на «Кол-во план». Возвращает число рулонов (0, если ничего не задано).
    function batchRolls(batch) {
        var v = batch && batch.values;
        if (!v) return 0;
        var keys = ['actual', 'rolls', 'planned'];
        for (var i = 0; i < keys.length; i++) {
            var raw = v[keys[i]];
            if (raw == null || raw === '') continue;
            var n = Number(raw);
            if (!isNaN(n) && n > 0) return n;
        }
        return 0;
    }

    function batchExhaustedByProvision(batch, provision) {
        var available = batchRolls(batch);
        var provisionRolls = Number(provision && provision.values && provision.values.rolls) || 0;
        if (available <= 0 || provisionRolls <= 0) return false;
        return provisionRolls >= available;
    }

    // Список завершённых резок (FIFO-приоритет для оприходования). Если завершённых
    // нет — возвращаем все, чтобы рабочее место оставалось пригодным к работе.
    function completedCuttings(cuttings) {
        var done = (cuttings || []).filter(isCompletedCutting);
        return done.length ? done : (cuttings || []);
    }

    // FIFO-подбор партии ГП для обеспечения: самая ранняя доступная партия
    // (по дате прихода — а при равенстве по id) той же резки, что и обеспечение.
    function pickFifoBatch(batches, cuttingId, availableStatus) {
        var status = availableStatus || AVAILABLE_BATCH_STATUS;
        var candidates = (batches || []).filter(function(batch) {
            if (trimValue(batch.values && batch.values.status) !== trimValue(status)) return false;
            if (!isActiveBatch(batch)) return false;
            if (cuttingId && trimValue(batch.refs && batch.refs.cutting) !== trimValue(cuttingId)) return false;
            return true;
        });
        candidates.sort(function(a, b) {
            var byDate = arrivalKey(a) - arrivalKey(b);
            if (byDate) return byDate;
            return Number(a.id) - Number(b.id);
        });
        return candidates.length ? candidates[0] : null;
    }

    // Числовой ключ сортировки по дате прихода. Дата прихода = время создания
    // записи, поэтому при непарсируемой дате id монотонно растёт и служит прокси.
    function arrivalKey(batch) {
        var raw = batch && batch.values ? batch.values.arrived : '';
        var ts = Date.parse(raw);
        if (!isNaN(ts)) return ts;
        var num = Number(raw);
        if (!isNaN(num) && raw !== '') return num;
        return Number(batch && batch.id) || 0;
    }

    // --- Построители запросов (чистые: db/реквизиты передаются явно) ---

    function buildListUrl(db, tableId, parentId) {
        var params = ['JSON_DATA', 'LIMIT=' + LIST_LIMIT];
        if (parentId != null && parentId !== '') {
            params.push('F_U=' + encodeURIComponent(parentId));
        }
        return '/' + encodeURIComponent(db) + '/object/' + encodeURIComponent(tableId) + '/?' + params.join('&');
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

    // Запрос на оприходование партии ГП: POST _m_new/{batchTable}?JSON&up=1 + реквизиты.
    // Первая колонка (дата прихода) не задаётся — сервер ставит now (index.php DATETIME).
    function buildCreateBatchRequest(opts) {
        var fields = {};
        var cols = opts.columns || [];
        function put(key, value) {
            if (value == null || value === '') return;
            var col = getColumn(cols, key);
            if (col && col.reqId) fields[col.reqId] = value;
        }
        put('cutting', opts.cuttingId);
        put('width', opts.width);
        put('rolls', opts.rolls);
        put('planned', opts.planned);
        // #3433: оприходование фиксирует ФАКТ — введённое кол-во рулонов идёт в «Кол-во факт».
        put('actual', opts.actual);
        put('length', opts.length);
        put('address', opts.address);
        put('orderId', opts.orderId);
        put('status', opts.status);
        put('active', opts.active);

        var url = '/' + encodeURIComponent(opts.db) + '/_m_new/' +
            encodeURIComponent(opts.tableId) + '?JSON&up=1';
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

    // Запрос FIFO-списания: привязать партию ГП к обеспечению позиции.
    // Партия ГП — реквизит (не первая колонка) → _m_set. Можно заодно сменить статус.
    function buildAssignBatchRequest(opts) {
        var fields = {};
        if (opts.batchReqId) fields[opts.batchReqId] = opts.batchId;
        if (opts.statusReqId && opts.statusValue != null && opts.statusValue !== '') {
            fields[opts.statusReqId] = opts.statusValue;
        }
        var url = '/' + encodeURIComponent(opts.db) + '/_m_set/' +
            encodeURIComponent(opts.provisionId) + '?JSON';
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

    // ------------------------------------------------------------------
    // Рендеринг
    // ------------------------------------------------------------------

    function setMessage(text, kind) {
        var el = document.getElementById('atex-wh-message');
        if (!el) return;
        if (!text) {
            el.textContent = '';
            el.className = 'atex-wh-message';
            el.hidden = true;
            return;
        }
        el.textContent = text;
        el.className = 'atex-wh-message atex-wh-message--' + (kind || 'info');
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
        return '<select class="atex-wh-status"' + (dataAttrs || '') + '>' + options.join('') + '</select>';
    }

    function refSearchHelper() {
        return (typeof window !== 'undefined' && window.AtexRefSearch) || null;
    }

    // Дата прихода партии — DATETIME (type 4), приходит unix-штампом. Выводим
    // как «ДД.ММ.ГГГГ ЧЧ:ММ» через общий форматтер; без него — значение как есть.
    function fmtDate(value) {
        var helper = refSearchHelper();
        return helper && helper.formatDateTime ? helper.formatDateTime(value)
            : (value == null ? '' : String(value));
    }

    function loadRefOptions(reqId, query, limit) {
        var helper = refSearchHelper();
        if (!helper) return Promise.resolve([]);
        return fetchJson(helper.buildRefOptionsUrl(getApiBase(), reqId, query, limit));
    }

    function attachRefSearchEvents() {
        var helper = refSearchHelper();
        if (!helper || !state.root) return;
        helper.attach(state.root, {
            cache: state.refOptions,
            db: getApiBase,
            loadOptions: loadRefOptions
        });
    }

    function cuttingLabel(cutting) {
        if (!cutting) return '';
        var parts = ['Резка №' + (cutting.main || cutting.id)];
        if (cutting.values && cutting.values.slitter) parts.push(cutting.values.slitter);
        return parts.join(' · ');
    }

    function cuttingOptionsHtml(selectId) {
        var helper = refSearchHelper();
        var refOptions = completedCuttings(state.cuttings).map(function(cutting) {
            return { id: cutting.id, label: cuttingLabel(cutting) };
        });
        if (helper && typeof helper.selectHtml === 'function') {
            return helper.selectHtml({
                id: selectId,
                classPrefix: 'atex-wh',
                inputClass: 'atex-wh-input',
                options: refOptions,
                placeholder: 'Выберите резку',
                cacheKey: 'completed-cuttings',
                cache: state.refOptions,
                replaceCache: true,
                hiddenAttrs: { id: selectId }
            });
        }

        var options = ['<option value="">Выберите резку</option>'];
        refOptions.forEach(function(cutting) {
            options.push('<option value="' + escapeHtml(cutting.id) + '">' +
                escapeHtml(cutting.label) + '</option>');
        });
        return '<select id="' + escapeHtml(selectId) + '" class="atex-wh-input">' + options.join('') + '</select>';
    }

    function renderFilter() {
        var sel = document.getElementById('atex-wh-filter');
        if (!sel) return;
        sel.innerHTML = ['<option value="">Все статусы</option>'].concat(state.batchStatuses.map(function(status) {
            var selected = status === state.statusFilter ? ' selected' : '';
            return '<option value="' + escapeHtml(status) + '"' + selected + '>' + escapeHtml(status) + '</option>';
        })).join('');
    }

    function filteredBatches() {
        if (!state.statusFilter) return state.batches;
        return state.batches.filter(function(batch) {
            return trimValue(batch.values.status) === trimValue(state.statusFilter);
        });
    }

    function renderBatches() {
        var container = document.getElementById('atex-wh-batches');
        if (!container) return;

        var batches = filteredBatches();
        if (!batches.length) {
            container.innerHTML = '<div class="atex-wh-empty">' +
                (state.batches.length ? 'Нет партий с выбранным статусом.' : 'Партий ГП пока нет. Оприходуйте первую.') +
                '</div>';
            return;
        }

        var rows = batches.map(function(batch) {
            return '<tr class="atex-wh-row" data-batch-id="' + escapeHtml(batch.id) + '">' +
                '<td>' + escapeHtml(batch.id) + '</td>' +
                '<td>' + escapeHtml(fmtDate(batch.values.arrived || batch.main)) + '</td>' +
                '<td>' + escapeHtml(batch.values.cutting || '') + '</td>' +
                '<td>' + escapeHtml(batch.values.width || '') + '</td>' +
                '<td>' + escapeHtml(batch.values.planned || '') + '</td>' +
                '<td>' + escapeHtml(batch.values.actual || '') + '</td>' +
                '<td>' + escapeHtml(batch.values.length || '') + '</td>' +
                '<td>' + escapeHtml(batch.values.address || '') + '</td>' +
                '<td>' + statusSelectHtml(state.batchStatuses, batch.values.status,
                    ' data-batch-status="' + escapeHtml(batch.id) + '"') + '</td>' +
                '</tr>';
        }).join('');

        container.innerHTML = '<table class="atex-wh-table">' +
            '<thead><tr><th>№</th><th>Дата прихода</th><th>Резка</th><th>Ширина, мм</th>' +
            '<th>План</th><th>Факт</th><th>Метраж, м</th><th>Адрес хранения</th><th>Статус</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table>';
    }

    function batchOptionsHtml(provision) {
        var helper = refSearchHelper();
        var fifo = pickFifoBatch(state.batches, provision.refs.cutting, AVAILABLE_BATCH_STATUS);
        var assigned = trimValue(provision.refs.batch);
        var selectedValue = assigned || (fifo ? fifo.id : '');
        var refOptions = [];
        state.batches.forEach(function(batch) {
            var available = trimValue(batch.values.status) === trimValue(AVAILABLE_BATCH_STATUS) && isActiveBatch(batch);
            var sameCut = !provision.refs.cutting ||
                trimValue(batch.refs.cutting) === trimValue(provision.refs.cutting);
            var isAssigned = trimValue(batch.id) === assigned;
            if (!isAssigned && (!available || !sameCut)) return;
            refOptions.push({
                id: batch.id,
                label: 'Партия №' + batch.id + ' · ' + fmtDate(batch.values.arrived) +
                    ' · ' + (batch.values.length || '') + ' м'
            });
        });
        if (helper && typeof helper.selectHtml === 'function') {
            return helper.selectHtml({
                id: 'atex-wh-batch-pick-' + provision.id,
                classPrefix: 'atex-wh',
                inputClass: 'atex-wh-input',
                options: refOptions,
                value: selectedValue,
                placeholder: '— партия —',
                cacheKey: 'batch-pick-' + provision.id,
                cache: state.refOptions,
                replaceCache: true,
                hiddenAttrs: {
                    id: 'atex-wh-batch-pick-' + provision.id,
                    class: 'atex-wh-batch-pick',
                    dataset: { batchPick: provision.id }
                }
            });
        }

        var options = ['<option value="">— партия —</option>'];
        refOptions.forEach(function(batch) {
            var selected = trimValue(batch.id) === trimValue(selectedValue) ? ' selected' : '';
            options.push('<option value="' + escapeHtml(batch.id) + '"' + selected + '>' +
                escapeHtml(batch.label) + '</option>');
        });
        return '<select class="atex-wh-input atex-wh-batch-pick" data-batch-pick="' +
            escapeHtml(provision.id) + '">' + options.join('') + '</select>';
    }

    function renderProvisions() {
        var container = document.getElementById('atex-wh-provisions');
        if (!container) return;

        if (!state.provisions.length) {
            container.innerHTML = '<div class="atex-wh-empty">Обеспечений пока нет.</div>';
            return;
        }

        var rows = state.provisions.map(function(prov) {
            return '<tr class="atex-wh-row" data-provision-id="' + escapeHtml(prov.id) + '">' +
                '<td>' + escapeHtml(prov.id) + '</td>' +
                '<td>' + escapeHtml(prov.up || '') + '</td>' +
                '<td>' + escapeHtml(prov.values.cutting || '') + '</td>' +
                '<td>' + escapeHtml(prov.values.length || '') + '</td>' +
                '<td>' + (prov.values.batch ? escapeHtml(prov.values.batch) : '<span class="atex-wh-muted">не списана</span>') + '</td>' +
                '<td>' + batchOptionsHtml(prov) + '</td>' +
                '<td><button type="button" class="atex-wh-btn atex-wh-btn-primary" data-writeoff="' +
                    escapeHtml(prov.id) + '"><i class="pi pi-check"></i><span>Списать</span></button></td>' +
                '</tr>';
        }).join('');

        container.innerHTML = '<table class="atex-wh-table">' +
            '<thead><tr><th>№</th><th>Позиция</th><th>Резка</th><th>Метраж, м</th>' +
            '<th>Партия ГП</th><th>FIFO-подбор</th><th></th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table>';
    }

    function renderCreateForm() {
        var panel = document.getElementById('atex-wh-create-form');
        if (!panel) return;
        panel.innerHTML =
            '<div class="atex-wh-fields">' +
            '<label>Задание в производство' + cuttingOptionsHtml('atex-wh-cutting') + '</label>' +
            '<label>Ширина, мм<input class="atex-wh-input" type="number" min="0" id="atex-wh-width"></label>' +
            '<label>Кол-во рулонов (факт)<input class="atex-wh-input" type="number" min="0" id="atex-wh-rolls"></label>' +
            '<label>Метраж, м<input class="atex-wh-input" type="number" min="0" step="any" id="atex-wh-length"></label>' +
            '<label>Адрес хранения<input class="atex-wh-input" type="text" id="atex-wh-address"></label>' +
            '<label>Статус' + statusSelectHtml(state.batchStatuses, state.batchStatuses[0], ' id="atex-wh-status"') + '</label>' +
            '</div>' +
            '<div class="atex-wh-form-actions">' +
            '<button type="submit" class="atex-wh-btn atex-wh-btn-primary"><i class="pi pi-check"></i><span>Оприходовать</span></button>' +
            '<button type="button" class="atex-wh-btn atex-wh-btn-secondary" id="atex-wh-cancel">Отмена</button>' +
            '</div>';
    }

    // ------------------------------------------------------------------
    // Действия
    // ------------------------------------------------------------------

    function loadBatches() {
        var url = buildListUrl(getApiBase(), state.batchTable, null);
        return fetchJson(url).then(function(json) {
            // Сортировка по дате прихода (FIFO): самые ранние сверху.
            state.batches = normalizeObjects(json, state.batchColumns).sort(function(a, b) {
                var byDate = arrivalKey(a) - arrivalKey(b);
                return byDate || (Number(a.id) - Number(b.id));
            });
            renderBatches();
        });
    }

    function loadCuttings() {
        var url = buildListUrl(getApiBase(), state.cuttingTable, null);
        return fetchJson(url).then(function(json) {
            state.cuttings = normalizeObjects(json, state.cuttingColumns);
            state.cuttingById = {};
            state.cuttings.forEach(function(cutting) {
                state.cuttingById[cutting.id] = cutting;
            });
        });
    }

    function loadProvisions() {
        var url = buildListUrl(getApiBase(), state.provisionTable, null);
        return fetchJson(url).then(function(json) {
            state.provisions = normalizeObjects(json, state.provisionColumns);
            renderProvisions();
        });
    }

    function createBatch() {
        if (state.creating) return;
        var cuttingSel = document.getElementById('atex-wh-cutting');
        var widthEl = document.getElementById('atex-wh-width');
        var rollsEl = document.getElementById('atex-wh-rolls');
        var lengthEl = document.getElementById('atex-wh-length');
        var addressEl = document.getElementById('atex-wh-address');
        var statusSel = document.getElementById('atex-wh-status');

        var req = buildCreateBatchRequest({
            db: getApiBase(),
            tableId: state.batchTable,
            columns: state.batchColumns,
            cuttingId: cuttingSel ? cuttingSel.value : '',
            width: widthEl ? widthEl.value : '',
            // #3433: оприходование фиксирует фактически принятые рулоны → «Кол-во факт».
            actual: rollsEl ? rollsEl.value : '',
            length: lengthEl ? lengthEl.value : '',
            address: addressEl ? addressEl.value : '',
            status: statusSel ? statusSel.value : state.batchStatuses[0],
            active: '1',
            xsrf: getXsrf()
        });

        state.creating = true;
        setMessage('Оприходование партии…', 'info');
        postForm(req.url, req.body).then(function(response) {
            var newId = extractNewObjectId(response);
            setMessage(newId ? 'Партия ГП №' + newId + ' оприходована.' : 'Партия ГП оприходована.', 'success');
            closeCreateForm();
            return loadBatches();
        }).catch(function(error) {
            setMessage('Не удалось оприходовать партию: ' + (error.message || error), 'error');
        }).finally(function() {
            state.creating = false;
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

    // FIFO-списание: привязать выбранную партию к обеспечению и зарезервировать партию.
    function writeOff(provisionId) {
        var prov = findProvision(provisionId);
        if (!prov) return;
        var pick = document.querySelector('[data-batch-pick="' + cssEscape(provisionId) + '"]');
        var batchId = pick && pick.value
            ? pick.value
            : (function() {
                var fifo = pickFifoBatch(state.batches, prov.refs.cutting, AVAILABLE_BATCH_STATUS);
                return fifo ? fifo.id : '';
            })();
        if (!batchId) {
            setMessage('Нет доступной партии ГП для списания в это обеспечение.', 'error');
            return;
        }

        var batchCol = getColumn(state.provisionColumns, 'batch');
        var provStatusCol = getColumn(state.provisionColumns, 'status');
        if (!batchCol || !batchCol.reqId) {
            setMessage('Не найден реквизит «Партия ГП» в метаданных обеспечения.', 'error');
            return;
        }

        var req = buildAssignBatchRequest({
            db: getApiBase(),
            provisionId: provisionId,
            batchReqId: batchCol.reqId,
            batchId: batchId,
            statusReqId: provStatusCol ? provStatusCol.reqId : null,
            statusValue: provStatusCol ? state.provisionStatuses[1] : '',
            xsrf: getXsrf()
        });

        setMessage('FIFO-списание партии…', 'info');
        postForm(req.url, req.body).then(function() {
            // Партия зарезервирована под обеспечение.
            var batchStatusCol = getColumn(state.batchColumns, 'status');
            if (batchStatusCol && batchStatusCol.reqId) {
                var sreq = buildSetStatusRequest({
                    db: getApiBase(),
                    objId: batchId,
                    statusReqId: batchStatusCol.reqId,
                    statusValue: state.batchStatuses[1],
                    xsrf: getXsrf()
                });
                return postForm(sreq.url, sreq.body);
            }
        }).then(function() {
            var activeCol = getColumn(state.batchColumns, 'active');
            var pickedBatch = findBatch(batchId);
            if (activeCol && activeCol.reqId && batchExhaustedByProvision(pickedBatch, prov)) {
                var areq = buildSetStatusRequest({
                    db: getApiBase(),
                    objId: batchId,
                    statusReqId: activeCol.reqId,
                    statusValue: '0',
                    xsrf: getXsrf()
                });
                return postForm(areq.url, areq.body);
            }
        }).then(function() {
            setMessage('Партия №' + batchId + ' списана в обеспечение №' + provisionId + '.', 'success');
            return Promise.all([loadBatches(), loadProvisions()]);
        }).catch(function(error) {
            setMessage('Не удалось списать партию: ' + (error.message || error), 'error');
        });
    }

    function cssEscape(value) {
        return String(value).replace(/[^\w-]/g, '\\$&');
    }

    function findProvision(provisionId) {
        for (var i = 0; i < state.provisions.length; i++) {
            if (state.provisions[i].id === String(provisionId)) return state.provisions[i];
        }
        return null;
    }

    function findBatch(batchId) {
        for (var i = 0; i < state.batches.length; i++) {
            if (state.batches[i].id === String(batchId)) return state.batches[i];
        }
        return null;
    }

    function openCreateForm() {
        var panel = document.getElementById('atex-wh-create');
        if (panel) panel.hidden = false;
        renderCreateForm();
        var cutting = document.getElementById('atex-wh-cutting-search') || document.getElementById('atex-wh-cutting');
        if (cutting) cutting.focus();
    }

    function closeCreateForm() {
        var panel = document.getElementById('atex-wh-create');
        if (panel) panel.hidden = true;
    }

    // ------------------------------------------------------------------
    // События
    // ------------------------------------------------------------------

    function attachEvents() {
        attachRefSearchEvents();

        var createBtn = document.getElementById('atex-wh-create-btn');
        if (createBtn) {
            createBtn.addEventListener('click', openCreateForm);
        }

        var filter = document.getElementById('atex-wh-filter');
        if (filter) {
            filter.addEventListener('change', function() {
                state.statusFilter = filter.value || '';
                renderBatches();
            });
        }

        var refresh = document.getElementById('atex-wh-refresh');
        if (refresh) {
            refresh.addEventListener('click', function() {
                reloadAll();
            });
        }

        var createForm = document.getElementById('atex-wh-create-form');
        if (createForm) {
            createForm.addEventListener('submit', function(event) {
                event.preventDefault();
                createBatch();
            });
            createForm.addEventListener('click', function(event) {
                if (event.target.closest('#atex-wh-cancel')) {
                    closeCreateForm();
                }
            });
        }

        var batches = document.getElementById('atex-wh-batches');
        if (batches) {
            batches.addEventListener('change', function(event) {
                var batchStatus = event.target.closest('[data-batch-status]');
                if (batchStatus) {
                    var statusCol = getColumn(state.batchColumns, 'status');
                    var batchId = batchStatus.getAttribute('data-batch-status');
                    var batch = findBatch(batchId);
                    changeStatus(batchId, statusCol && statusCol.reqId, batchStatus.value, function() {
                        if (batch) batch.values.status = batchStatus.value;
                        renderProvisions();
                    });
                }
            });
        }

        var provisions = document.getElementById('atex-wh-provisions');
        if (provisions) {
            provisions.addEventListener('click', function(event) {
                var writeoff = event.target.closest('[data-writeoff]');
                if (writeoff) {
                    writeOff(writeoff.getAttribute('data-writeoff'));
                }
            });
        }
    }

    function reloadAll() {
        setMessage('Обновление данных…', 'info');
        return Promise.all([loadCuttings(), loadBatches(), loadProvisions()])
            .then(function() {
                setMessage('');
            })
            .catch(function(error) {
                setMessage('Ошибка загрузки: ' + (error.message || error), 'error');
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
        state.root = document.getElementById('atex-warehouse-app');
        if (!state.root) return;

        state.db = window.db || state.root.getAttribute('data-db') || '';
        var tableOverrides = {
            batch: state.root.getAttribute('data-batch-table'),
            provision: state.root.getAttribute('data-provision-table'),
            cutting: state.root.getAttribute('data-cutting-table')
        };
        state.batchStatuses = parseStatusesAttr(state.root.getAttribute('data-batch-statuses'), DEFAULT_BATCH_STATUSES);
        state.provisionStatuses = parseStatusesAttr(state.root.getAttribute('data-provision-statuses'), DEFAULT_PROVISION_STATUSES);

        attachEvents();
        renderFilter();
        setMessage('Загрузка данных…', 'info');

        loadAllMetadata().then(function(allMetadata) {
            var metas = resolveTableMetadata(allMetadata, TABLE, tableOverrides);
            state.batchMeta = metas.batch || {};
            state.provisionMeta = metas.provision || {};
            state.cuttingMeta = metas.cutting || {};
            state.batchTable = String(state.batchMeta.id || '');
            state.provisionTable = String(state.provisionMeta.id || '');
            state.cuttingTable = String(state.cuttingMeta.id || '');
            state.batchColumns = buildColumns(BATCH_FIELDS, state.batchMeta);
            state.provisionColumns = buildColumns(PROVISION_FIELDS, state.provisionMeta);
            state.cuttingColumns = buildColumns(CUTTING_FIELDS, state.cuttingMeta);
            return reloadAll();
        }).catch(function(error) {
            setMessage('Ошибка загрузки: ' + (error.message || error), 'error');
        });
    }

    // Публичный API для отладки/тестов.
    window.AtexWarehouse = {
        init: init,
        reload: reloadAll
    };

    // Чистые функции — для модульных тестов (без DOM/сети).
    window.AtexWarehouseTesting = {
        normalizeFieldName: normalizeFieldName,
        parseRef: parseRef,
        buildFieldSources: buildFieldSources,
        buildColumns: buildColumns,
        findMetadataByName: findMetadataByName,
        resolveTableMetadata: resolveTableMetadata,
        normalizeObjects: normalizeObjects,
        extractNewObjectId: extractNewObjectId,
        isCompletedCutting: isCompletedCutting,
        isActiveBatch: isActiveBatch,
        batchRolls: batchRolls,
        batchExhaustedByProvision: batchExhaustedByProvision,
        completedCuttings: completedCuttings,
        pickFifoBatch: pickFifoBatch,
        arrivalKey: arrivalKey,
        buildListUrl: buildListUrl,
        buildFormBody: buildFormBody,
        buildCreateBatchRequest: buildCreateBatchRequest,
        buildSetStatusRequest: buildSetStatusRequest,
        buildAssignBatchRequest: buildAssignBatchRequest,
        TABLE: TABLE,
        BATCH_FIELDS: BATCH_FIELDS,
        PROVISION_FIELDS: PROVISION_FIELDS,
        CUTTING_FIELDS: CUTTING_FIELDS,
        DEFAULT_BATCH_STATUSES: DEFAULT_BATCH_STATUSES,
        DEFAULT_PROVISION_STATUSES: DEFAULT_PROVISION_STATUSES,
        COMPLETED_CUTTING_STATUSES: COMPLETED_CUTTING_STATUSES
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
