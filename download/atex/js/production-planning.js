// Рабочее место atex «Планирование производства» (роль Диспетчер).
//
// Создание производственной резки (слиттер, тип резки, партия сырья, дата
// плана, статус), очередь резок по слиттерам и привязка резки к позициям заказа
// через подчинённую таблицу «Обеспечение». Решение задачи ideav/crm#2913
// (часть #2903). Правила разработки рабочих мест — docs/WORKSPACE_DEVELOPMENT_GUIDE.md.
//
// Чтения очереди резок и их обеспечения берутся одним отчётом защищённого слоя
// `GET /{db}/report/cut_planning?JSON_KV` (Резка→Обеспечение→Позиция). Чистая
// `rowsToPlanning` разворачивает плоские строки в резки (dedup по `cut_id`) и
// обеспечения (строки с непустым `supply_id`) — один запрос вместо отдельных
// `object/`-чтений резок и обеспечения, резолв метаданных для чтения не нужен
// (правило: docs/integram-reports.md).
//
// Справочник позиций заказа (для привязки обеспечения) берётся отчётом
// `GET /{db}/report/positions_list?JSON_KV` (`rowsToPositions`): Позиция заказа —
// подчинённая таблица, прямое `object/`-чтение её не отдаёт. Партии сырья для
// формы создания резки берутся отчётом `report/material_batches?JSON_KV`
// (`rowsToBatches`). Справочник станков читается по имени из метаданных
// (`object/{table}?JSON_OBJ`, записей мало). «Тип резки» — большой справочник:
// полная выборка упирается в серверный потолок размера ответа, поэтому первая
// порция грузится ограниченным ref-search `_ref_reqs` (`loadCutTypes`), остальное
// — поиском по вводу через `AtexRefSearch`.
//
// Запись идёт прямыми командами `_m_*` (#2903): создание резки —
// `_m_new/{Производственная резка}` (Номер не задаётся, у таблицы `unique=1` —
// сервер сам считает автонумер), обеспечение — `_m_new/{Обеспечение}` с
// `up={позицияId}` и ссылкой `t{Производственная резка}`, правки — `_m_set`. ID
// таблиц и реквизитов для записи не хардкодятся: берутся по именам из
// `GET /{db}/metadata` (WORKSPACE_DEVELOPMENT_GUIDE.md, разделы 3 и 6).
//
// Чистое ядро (разбор записей, группировка очереди по слиттерам, фильтрация,
// сборка полей `t{reqId}`) вынесено в объект `planning` и экспортируется через
// module.exports для модульных тестов (experiments/atex-production-planning.test.js).

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.AtexProductionPlanning = api;
        if (typeof document !== 'undefined') {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', api.init);
            } else {
                api.init();
            }
        }
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    'use strict';

    // Имена таблиц и реквизитов схемы atex (docs/atex_metadata.json). По именам
    // рабочее место находит конкретные числовые id в метаданных текущей сборки.
    var TABLE = {
        cut: 'Производственная резка',
        supply: 'Обеспечение',
        slitter: 'Слиттер',
        cutType: 'Тип резки',
        materialBatch: 'Партия сырья'
    };
    // Реквизиты «Производственной резки» (Номер — главное значение, автонумер).
    var CUT_REQ = {
        slitter: 'Слиттер',
        cutType: 'Тип резки',
        materialBatch: 'Партия сырья',
        planDate: 'Дата план',
        status: 'Статус',
        notes: 'Примечания',
        sequence: 'Очередность'
    };
    // Реквизиты подчинённого «Обеспечения» (up = позиция заказа).
    var SUPPLY_REQ = {
        footage: 'Метраж, м',
        cut: 'Производственная резка',
        finishedBatch: 'Партия ГП',
        status: 'Статус'
    };
    // Статусы — свободный текст (тип 3); фиксируем разумные наборы по дизайн-спеке.
    var CUT_STATUSES = ['Запланирована', 'В очереди', 'В работе', 'Готова', 'Отменена'];
    var SUPPLY_STATUSES = ['Зарезервировано', 'Выполнено', 'Отменено'];

    // ───────────────────────── Чистое ядро ─────────────────────────

    // Разбор значения-ссылки из JSON_OBJ: «id:Подпись» → { id, label }.
    function parseRef(raw) {
        var m = String(raw == null ? '' : raw).match(/^(\d+):([\s\S]*)$/);
        return m ? { id: m[1], label: m[2] } : { id: null, label: String(raw == null ? '' : raw) };
    }

    // Разбор мультиссылки из JSON_OBJ: «id1,id2:Подпись1,Подпись2» → ['id1','id2'].
    // Часть до первого «:» — id через запятую; без «:» — весь raw как id-часть.
    // null / пустая строка → [].
    function parseMultiRefIds(raw) {
        var s = String(raw == null ? '' : raw);
        if (s.trim() === '') return [];
        var idsPart = s.indexOf(':') >= 0 ? s.slice(0, s.indexOf(':')) : s;
        return idsPart.split(',').map(function(x) { return x.trim(); }).filter(function(x) { return x !== ''; });
    }

    // Проверка: есть ли materialId в массиве stopMaterialIds (сравнение строковое).
    // Пустой materialId → false; пустой список → false.
    function isMaterialBlocked(stopMaterialIds, materialId) {
        var mid = String(materialId == null ? '' : materialId).trim();
        if (mid === '') return false;
        return (stopMaterialIds || []).some(function(id) { return String(id).trim() === mid; });
    }

    // Значение реквизита из метаданных по имени → его числовой id.
    function reqIdByName(meta, name) {
        var found = (meta && meta.reqs || []).filter(function(r) {
            return String(r.val).trim().toLowerCase() === String(name).trim().toLowerCase();
        })[0];
        return found ? String(found.id) : null;
    }

    // Индекс колонки реквизита в строке JSON_OBJ. Колонки идут в порядке:
    // [главное значение, ...reqs в порядке метаданных].
    function columnIndex(meta, reqName) {
        if (!meta) return -1;
        var order = [String(meta.id)].concat((meta.reqs || []).map(function(r) { return String(r.id); }));
        var rid = reqIdByName(meta, reqName);
        return rid == null ? -1 : order.indexOf(String(rid));
    }

    // Преобразование записи «Производственной резки» в плоский объект для UI.
    // record — { i, r:[...] }, meta — метаданные таблицы.
    function mapCutRecord(record, meta) {
        var r = (record && record.r) || [];
        function ref(reqName) {
            var idx = columnIndex(meta, reqName);
            return idx >= 0 ? parseRef(r[idx]) : { id: null, label: '' };
        }
        function val(reqName) {
            var idx = columnIndex(meta, reqName);
            return idx >= 0 ? (r[idx] == null ? '' : String(r[idx])) : '';
        }
        var seqRaw = val(CUT_REQ.sequence);
        return {
            id: String(record && record.i),
            number: r[0] == null ? '' : String(r[0]),
            slitter: ref(CUT_REQ.slitter),
            cutType: ref(CUT_REQ.cutType),
            materialBatch: ref(CUT_REQ.materialBatch),
            planDate: val(CUT_REQ.planDate),
            status: val(CUT_REQ.status),
            sequence: (seqRaw === '' || seqRaw == null) ? null : Number(seqRaw)
        };
    }

    // Группировка резок в очереди по слиттерам. Возвращает массив
    // [{ slitter:{id,label}, cuts:[...] }], отсортированный по подписи слиттера;
    // резки без слиттера попадают в группу с id=null («Без слиттера»).
    function groupBySlitter(cuts) {
        var groups = {};
        var order = [];
        (cuts || []).forEach(function(c) {
            var s = c.slitter || { id: null, label: '' };
            var key = s.id == null ? '\u0000none' : String(s.id);
            if (!groups[key]) {
                groups[key] = { slitter: { id: s.id, label: s.label || (s.id == null ? 'Без станка' : '#' + s.id) }, cuts: [] };
                order.push(key);
            }
            groups[key].cuts.push(c);
        });
        // Сортировка резок внутри каждой группы по sequence (возр., null/NaN — в конец, стабильно).
        function seqKey(c) { var s = c && c.sequence; var n = Number(s); return (s == null || isNaN(n)) ? Infinity : n; }
        Object.keys(groups).forEach(function(k) {
            groups[k].cuts = groups[k].cuts.map(function(c, i) { return { c: c, i: i }; })
                .sort(function(a, b) { return seqKey(a.c) - seqKey(b.c) || a.i - b.i; })
                .map(function(x) { return x.c; });
        });
        return order
            .map(function(k) { return groups[k]; })
            .sort(function(a, b) {
                // Группа «без слиттера» — в конец, остальные по подписи.
                if (a.slitter.id == null) return 1;
                if (b.slitter.id == null) return -1;
                return String(a.slitter.label).localeCompare(String(b.slitter.label), 'ru');
            });
    }

    // Фильтр очереди по слиттеру и статусу (пустой фильтр = «все»).
    function filterCuts(cuts, filters) {
        var f = filters || {};
        var slitter = f.slitter == null ? '' : String(f.slitter).trim();
        var status = f.status == null ? '' : String(f.status).trim();
        return (cuts || []).filter(function(c) {
            if (slitter && String((c.slitter && c.slitter.id) || '') !== slitter) return false;
            if (status && String(c.status || '').trim() !== status) return false;
            return true;
        });
    }

    // Сборка полей `t{reqId}` для записи. reqIds — { ключ: числовойId },
    // values — { ключ: значение }. Пустые значения (''/null/undefined) опускаются,
    // чтобы не перетирать данные и не плодить пустые реквизиты.
    function buildFields(reqIds, values) {
        var out = {};
        Object.keys(reqIds || {}).forEach(function(key) {
            var id = reqIds[key];
            if (id == null) return;
            var v = values ? values[key] : undefined;
            if (v === undefined || v === null || v === '') return;
            out['t' + id] = v;
        });
        return out;
    }

    // Плоские строки отчёта cut_planning (JSON_KV) → { cuts, supplies }.
    // Одна резка с N обеспечениями даёт N строк (LEFT JOIN) — резки dedup по
    // `cut_id`; обеспечения собираются из строк с непустым `supply_id`. Резки без
    // обеспечения (пустой `supply_id`) остаются в очереди и фантомных связей не
    // создают. Формы записей совпадают с прежними mapCutRecord/loadSupplies:
    // резка — { id, number, slitter:{id,label}, cutType:{id,label},
    // materialBatch:{id,label}, planDate, status }; обеспечение —
    // { id, positionId, cutId }.
    function rowsToPlanning(rows) {
        var cutsById = {};
        var order = [];
        var supplies = [];
        function str(v) { return v == null ? '' : String(v); }
        (rows || []).forEach(function(row) {
            var cutId = str(row.cut_id);
            if (cutId && !cutsById[cutId]) {
                var seqVal = row.cut_sequence;
                cutsById[cutId] = {
                    id: cutId,
                    number: str(row.cut_no),
                    slitter: { id: row.cut_slitter_id ? String(row.cut_slitter_id) : null, label: str(row.cut_slitter) },
                    cutType: { id: null, label: str(row.cut_type) },
                    materialBatch: { id: null, label: str(row.cut_material_batch) },
                    planDate: str(row.cut_plan_date),
                    status: str(row.cut_status),
                    sequence: (seqVal == null || seqVal === '') ? null : Number(seqVal)
                };
                order.push(cutId);
            }
            var supplyId = str(row.supply_id);
            if (supplyId) {
                supplies.push({
                    id: supplyId,
                    positionId: row.supply_position_id ? String(row.supply_position_id) : null,
                    cutId: cutId
                });
            }
        });
        return { cuts: order.map(function(id) { return cutsById[id]; }), supplies: supplies };
    }

    // Строки отчёта positions_list (JSON_KV) → [{ id, label }] для дропдауна
    // привязки. Подпись: «#id · Тип резки · Ширина · Кол-во» (пустые поля
    // пропускаются); если деталей нет — «#id · Номер».
    function rowsToPositions(rows) {
        return (rows || []).map(function(row) {
            var id = row.position_id == null ? '' : String(row.position_id);
            var parts = [row.position_cut_type, row.position_width, row.position_qty]
                .map(function(v) { return v == null ? '' : String(v).trim(); })
                .filter(function(v) { return v !== ''; });
            var main = row.position_no == null ? '' : String(row.position_no).trim();
            var label = '#' + id + (parts.length ? ' · ' + parts.join(' · ') : (main ? ' · ' + main : ''));
            return { id: id, label: label };
        });
    }

    // Строки отчёта material_batches (JSON_KV) → [{ id, label }] для дропдауна
    // «Партия сырья». Подпись обогащённая: «Номер · Вид сырья · ост. N м²»
    // (пустые части пропускаются). Дропдаун статический клиентский (см. renderForm),
    // поэтому метка единообразна и при фильтрации по вводу.
    // Остаток м² → строка: округление до 2 знаков, без незначащих нулей
    // (2440.00 → «2440», 38400.366 → «38400.37»). Нечисло/пусто → ''.
    function fmtRemainder(value) {
        var n = parseFloat(String(value == null ? '' : value).replace(',', '.'));
        return isFinite(n) ? String(Math.round(n * 100) / 100) : '';
    }

    function rowsToBatches(rows) {
        return (rows || []).map(function(row) {
            var no = row.batch_no == null ? '' : String(row.batch_no).trim();
            var material = row.batch_material == null ? '' : String(row.batch_material).trim();
            var rem = fmtRemainder(row.batch_remainder_m2);
            var parts = [];
            if (material) parts.push(material);
            if (rem) parts.push('ост. ' + rem + ' м²');
            return {
                id: row.batch_id == null ? '' : String(row.batch_id),
                label: no + (parts.length ? ' · ' + parts.join(' · ') : '')
            };
        });
    }

    var planning = {
        parseRef: parseRef,
        parseMultiRefIds: parseMultiRefIds,
        isMaterialBlocked: isMaterialBlocked,
        reqIdByName: reqIdByName,
        columnIndex: columnIndex,
        mapCutRecord: mapCutRecord,
        groupBySlitter: groupBySlitter,
        filterCuts: filterCuts,
        buildFields: buildFields,
        rowsToPlanning: rowsToPlanning,
        rowsToPositions: rowsToPositions,
        rowsToBatches: rowsToBatches
    };

    // ─────────────────────────── Браузерный слой ───────────────────────────
    // Ниже — DOM-контроллер. Требует window/document/fetch; в Node не выполняется.

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function(k) {
            if (k === 'class') node.className = attrs[k];
            else if (k === 'text') node.textContent = attrs[k];
            else if (k === 'html') node.innerHTML = attrs[k];
            else if (k === 'dataset') Object.keys(attrs[k]).forEach(function(d) { node.dataset[d] = attrs[k][d]; });
            else node.setAttribute(k, attrs[k]);
        });
        (children || []).forEach(function(c) {
            if (c == null) return;
            node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return node;
    }

    function AtexProductionPlanning(root) {
        this.root = root;
        this.db = window.db || root.getAttribute('data-db') || '';
        this.meta = { cut: null, supply: null, slitter: null, cutType: null, materialBatch: null };
        this.slitters = [];        // справочник [{ id, label, stopMaterialIds }]
        this.cutTypes = [];        // справочник [{ id, label }]
        this.materialBatches = []; // справочник [{ id, label }]
        this.batchMaterialById = {}; // карта batch_id → вид_сырья_id (для стоп-листа)
        this.positions = [];       // позиции заказа [{ id, label }]
        this.refOptions = {};      // кеш опций searchable reference inputs по reqId
        this.cuts = [];            // очередь резок [mapCutRecord]
        this.supplies = [];        // все записи «Обеспечения» (для подсчёта привязок)
        this.draft = this.blankDraft();
        this.filter = { slitter: '', status: '' };
        this.selectedCutId = null; // выбранная резка для привязки обеспечения
        this.busy = false;
    }

    AtexProductionPlanning.prototype.blankDraft = function() {
        return { slitterId: '', cutTypeId: '', materialBatchId: '', planDate: '', status: CUT_STATUSES[0], notes: '' };
    };

    AtexProductionPlanning.prototype.url = function(path) {
        return '/' + encodeURIComponent(this.db) + '/' + path;
    };

    AtexProductionPlanning.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                try { return text ? JSON.parse(text) : null; }
                catch (e) { throw new Error('Некорректный JSON: ' + text.slice(0, 200)); }
            });
        });
    };

    AtexProductionPlanning.prototype.loadRefOptions = function(reqId, query, limit) {
        return this.getJson(window.AtexRefSearch.buildRefOptionsPath(reqId, query, limit));
    };

    // POST команды `_m_*`. Токен XSRF подставляется обязательно (раздел 4 гайда).
    AtexProductionPlanning.prototype.post = function(path, params) {
        var body = new URLSearchParams();
        body.set('_xsrf', (typeof window !== 'undefined' && window.xsrf) || this.root.getAttribute('data-xsrf') || '');
        Object.keys(params || {}).forEach(function(k) {
            if (params[k] !== undefined && params[k] !== null && params[k] !== '') body.set(k, params[k]);
        });
        return fetch(this.url(path), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        }).then(function(resp) {
            return resp.text().then(function(text) {
                var result;
                try { result = text ? JSON.parse(text) : {}; } catch (e) { throw new Error('Сервер вернул не JSON: ' + text.slice(0, 200)); }
                if (result && (result.error || result.err)) throw new Error(result.error || result.err);
                return result;
            });
        });
    };

    // ── Загрузка метаданных и справочников ──

    AtexProductionPlanning.prototype.loadMetadata = function() {
        var self = this;
        return this.getJson('metadata').then(function(all) {
            var list = Array.isArray(all) ? all : [all];
            function byName(name) {
                return list.filter(function(t) {
                    return String(t.val).trim().toLowerCase() === name.trim().toLowerCase();
                })[0] || null;
            }
            self.meta.cut = byName(TABLE.cut);
            self.meta.supply = byName(TABLE.supply);
            self.meta.slitter = byName(TABLE.slitter);
            self.meta.cutType = byName(TABLE.cutType);
            self.meta.materialBatch = byName(TABLE.materialBatch);
            if (!self.meta.cut) throw new Error('В метаданных не найдена таблица «' + TABLE.cut + '»');
            if (!self.meta.supply) throw new Error('В метаданных не найдена таблица «' + TABLE.supply + '»');
        });
    };

    // Справочник: главное значение записей таблицы → [{ id, label }].
    AtexProductionPlanning.prototype.loadRef = function(meta, labelReq) {
        if (!meta) return Promise.resolve([]);
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            return (rows || []).map(function(r) {
                var label = (r.r && r.r[0]) || ('#' + r.i);
                if (labelReq) {
                    var idx = columnIndex(meta, labelReq);
                    if (idx >= 0 && r.r && r.r[idx] != null && String(r.r[idx]).trim() !== '') {
                        label = label + ' · ' + String(r.r[idx]);
                    }
                }
                return { id: String(r.i), label: label };
            });
        });
    };

    // Справочник станков (слиттеров) с их стоп-листами сырья.
    // Читает object/ с полем «Стоп-лист сырья» (мультиссылка → Вид сырья);
    // разбирает через parseMultiRefIds → stopMaterialIds: ['id1','id2',...].
    // Заменяет loadRef(meta.slitter) в начальной загрузке.
    AtexProductionPlanning.prototype.loadSlittersWithStop = function() {
        var meta = this.meta.slitter;
        if (!meta) return Promise.resolve([]);
        var stopIdx = columnIndex(meta, 'Стоп-лист сырья');
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            return (rows || []).map(function(r) {
                var raw = (stopIdx >= 0 && r.r) ? r.r[stopIdx] : '';
                return {
                    id: String(r.i),
                    label: (r.r && r.r[0]) || ('#' + r.i),
                    stopMaterialIds: parseMultiRefIds(raw)
                };
            });
        });
    };

    // Карта «партия сырья → вид сырья» (object/), только для проверки стоп-листа.
    // Дропдаун партий сырья по-прежнему берётся из отчёта material_batches — не меняем.
    AtexProductionPlanning.prototype.loadBatchMaterialMap = function() {
        var self = this;
        var meta = this.meta.materialBatch;
        if (!meta) { this.batchMaterialById = {}; return Promise.resolve(); }
        var matIdx = columnIndex(meta, 'Вид сырья');
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            var map = {};
            (rows || []).forEach(function(r) {
                var ref = (matIdx >= 0 && r.r) ? parseRef(r.r[matIdx]) : { id: null };
                map[String(r.i)] = ref.id ? String(ref.id) : '';
            });
            self.batchMaterialById = map;
        });
    };

    // Справочник позиций заказа отчётом positions_list (JSON_KV). Позиция
    // подчинённая — прямое object/-чтение её не отдаёт, отчёт возвращает все.
    AtexProductionPlanning.prototype.loadPositions = function() {
        var self = this;
        return this.getJson('report/positions_list?JSON_KV&LIMIT=0,2000').then(function(rows) {
            self.positions = rowsToPositions(rows || []);
        });
    };

    // Справочник партий сырья отчётом material_batches (JSON_KV).
    AtexProductionPlanning.prototype.loadMaterialBatches = function() {
        var self = this;
        return this.getJson('report/material_batches?JSON_KV&LIMIT=0,2000').then(function(rows) {
            self.materialBatches = rowsToBatches(rows || []);
        });
    };

    // Справочник «Тип резки» — большой (сотни записей); полная выборка
    // (`object/?JSON_OBJ` или отчёт) упирается в серверный потолок размера ответа
    // и виснет. Поэтому предзагружаем только первую порцию через ограниченный
    // ref-search `_ref_reqs/{reqId}?JSON&LIMIT` (как в остальных РМ); остальные
    // типы доступны поиском по вводу в самом поле (reqId передаётся в selectRef).
    AtexProductionPlanning.prototype.loadCutTypes = function() {
        var self = this;
        var reqId = reqIdByName(this.meta.cut, CUT_REQ.cutType);
        if (!reqId) { this.cutTypes = []; return Promise.resolve(); }
        return this.loadRefOptions(reqId, '', 50).then(function(payload) {
            var helper = (typeof window !== 'undefined' && window.AtexRefSearch) || null;
            self.cutTypes = (helper && typeof helper.parseOptionsData === 'function')
                ? helper.parseOptionsData(payload) : [];
        });
    };

    // Очередь резок и их обеспечение одним отчётом cut_planning (JSON_KV).
    // Заполняет this.cuts и this.supplies из плоских строк отчёта.
    AtexProductionPlanning.prototype.loadPlanning = function() {
        var self = this;
        return this.getJson('report/cut_planning?JSON_KV&LIMIT=0,5000').then(function(rows) {
            var p = rowsToPlanning(rows || []);
            self.cuts = p.cuts;
            self.supplies = p.supplies;
        });
    };

    // Число привязок (обеспечений) к конкретной резке.
    AtexProductionPlanning.prototype.supplyCount = function(cutId) {
        return this.supplies.filter(function(s) { return String(s.cutId) === String(cutId); }).length;
    };

    // ── Запись ──

    // Создание производственной резки. Номер не задаётся (unique сам считает).
    AtexProductionPlanning.prototype.createCut = function() {
        var self = this;
        if (this.busy) return;
        var meta = this.meta.cut;
        var d = this.draft;
        if (!d.slitterId) { this.notify('Выберите станок', 'error'); return; }
        if (!d.cutTypeId) { this.notify('Выберите тип резки', 'error'); return; }

        // Стоп-лист станка: сырьё выбранной партии не должно быть запрещено на станке.
        if (d.materialBatchId) {
            var slit = this.slitters.filter(function(s) { return String(s.id) === String(d.slitterId); })[0];
            var matId = this.batchMaterialById && this.batchMaterialById[String(d.materialBatchId)];
            var stop = (slit && slit.stopMaterialIds) || [];
            if (matId && isMaterialBlocked(stop, matId)) {
                var batch = this.materialBatches.filter(function(b) { return String(b.id) === String(d.materialBatchId); })[0];
                this.notify('Сырьё «' + ((batch && batch.label) || matId) + '» запрещено на станке «' + ((slit && slit.label) || d.slitterId) + '»', 'error');
                return;
            }
        }

        var reqIds = {
            slitter: reqIdByName(meta, CUT_REQ.slitter),
            cutType: reqIdByName(meta, CUT_REQ.cutType),
            materialBatch: reqIdByName(meta, CUT_REQ.materialBatch),
            planDate: reqIdByName(meta, CUT_REQ.planDate),
            status: reqIdByName(meta, CUT_REQ.status),
            notes: reqIdByName(meta, CUT_REQ.notes)
        };
        var fields = buildFields(reqIds, {
            slitter: d.slitterId,
            cutType: d.cutTypeId,
            materialBatch: d.materialBatchId,
            planDate: d.planDate,
            status: d.status,
            notes: d.notes
        });

        this.setBusy(true);
        // up=1 — корневой объект; full=1 — на случай длинных примечаний.
        this.post('_m_new/' + meta.id + '?JSON&up=1&full=1', fields).then(function(res) {
            var id = res && (res.obj || res.id || res.i);
            if (!id) throw new Error('Сервер не вернул id новой резки');
            return self.reload().then(function() {
                self.setBusy(false);
                self.draft = self.blankDraft();
                self.selectedCutId = String(id);
                self.notify('Производственная резка создана', 'success');
                self.render();
            });
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка создания резки: ' + err.message, 'error');
        });
    };

    // Привязка резки к позиции заказа через «Обеспечение»
    // (_m_new/{Обеспечение} с up={позицияId} и ссылкой на резку).
    AtexProductionPlanning.prototype.createSupply = function(opts) {
        var self = this;
        if (this.busy) return;
        var meta = this.meta.supply;
        if (!opts.positionId) { this.notify('Выберите позицию заказа', 'error'); return; }
        if (!opts.cutId) { this.notify('Не выбрана резка', 'error'); return; }

        var reqIds = {
            footage: reqIdByName(meta, SUPPLY_REQ.footage),
            cut: reqIdByName(meta, SUPPLY_REQ.cut),
            status: reqIdByName(meta, SUPPLY_REQ.status)
        };
        var fields = buildFields(reqIds, {
            footage: opts.footage,
            cut: opts.cutId,
            status: opts.status || SUPPLY_STATUSES[0]
        });

        this.setBusy(true);
        this.post('_m_new/' + meta.id + '?JSON&up=' + encodeURIComponent(opts.positionId), fields).then(function(res) {
            var id = res && (res.obj || res.id || res.i);
            if (!id) throw new Error('Сервер не вернул id обеспечения');
            return self.loadPlanning().then(function() {
                self.setBusy(false);
                self.notify('Обеспечение создано: позиция связана с резкой', 'success');
                self.render();
            });
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка привязки: ' + err.message, 'error');
        });
    };

    AtexProductionPlanning.prototype.reload = function() {
        return this.loadPlanning();
    };

    // ── Рендеринг ──

    AtexProductionPlanning.prototype.render = function() {
        this.renderForm();
        this.renderQueue();
        this.renderLink();
    };

    function field(label, control) {
        return el('div', { class: 'atex-pp-field' }, [
            el('label', { class: 'atex-pp-label', text: label }),
            control
        ]);
    }

    AtexProductionPlanning.prototype.selectRef = function(items, value, placeholder, onChange, reqId, opts) {
        var self = this;
        var helper = (typeof window !== 'undefined' && window.AtexRefSearch) || null;
        opts = opts || {};
        if (helper && typeof helper.createSelect === 'function') {
            return helper.createSelect({
                classPrefix: 'atex-pp',
                inputClass: 'atex-pp-input',
                options: items || [],
                value: value,
                placeholder: placeholder || '— не выбрано —',
                reqId: reqId,
                cacheKey: opts.cacheKey,
                cache: this.refOptions,
                clearOnInput: opts.clearOnInput,
                loadOptions: reqId ? function(reqId, query, limit) { return self.loadRefOptions(reqId, query, limit); } : null,
                onChange: onChange
            });
        }

        var refSelect = el('select', { class: 'atex-pp-input' });
        refSelect.appendChild(el('option', { value: '', text: placeholder || '— не выбрано —' }));
        (items || []).forEach(function(it) {
            var o = el('option', { value: it.id, text: it.label });
            if (String(value) === String(it.id)) o.selected = true;
            refSelect.appendChild(o);
        });
        refSelect.addEventListener('change', function() { onChange(refSelect.value); });
        return refSelect;
    };

    AtexProductionPlanning.prototype.selectText = function(values, value, onChange) {
        var textSelect = el('select', { class: 'atex-pp-input' });
        values.forEach(function(v) {
            var o = el('option', { value: v, text: v });
            if (String(value) === String(v)) o.selected = true;
            textSelect.appendChild(o);
        });
        if (value && values.indexOf(value) === -1) {
            var extra = el('option', { value: value, text: value });
            extra.selected = true;
            textSelect.appendChild(extra);
        }
        textSelect.addEventListener('change', function() { onChange(textSelect.value); });
        return textSelect;
    };

    AtexProductionPlanning.prototype.renderForm = function() {
        var self = this;
        var d = this.draft;
        var form = this.formEl;
        form.innerHTML = '';
        form.appendChild(el('h2', { class: 'atex-pp-form-title', text: 'Новая производственная резка' }));
        form.appendChild(el('p', { class: 'atex-pp-hint', text: 'Номер присваивается автоматически при сохранении.' }));

        form.appendChild(field('Станок', this.selectRef(this.slitters, d.slitterId, '— выберите станок —',
            function(v) { d.slitterId = v; }, reqIdByName(this.meta.cut, CUT_REQ.slitter))));
        form.appendChild(field('Тип резки', this.selectRef(this.cutTypes, d.cutTypeId, '— выберите тип резки —',
            function(v) { d.cutTypeId = v; }, reqIdByName(this.meta.cut, CUT_REQ.cutType))));
        // Партии предзагружены отчётом material_batches (обогащённые подписи) —
        // статический клиентский список (как дропдаун позиций), без серверного
        // поиска, иначе при вводе подпись свелась бы к голому номеру.
        form.appendChild(field('Партия сырья', this.selectRef(this.materialBatches, d.materialBatchId, '— не выбрано —',
            function(v) { d.materialBatchId = v; }, null, { cacheKey: 'batches' })));

        var dateInput = el('input', { class: 'atex-pp-input', type: 'date' });
        dateInput.value = d.planDate || '';
        dateInput.addEventListener('input', function() { d.planDate = dateInput.value; });
        form.appendChild(field('Дата плана', dateInput));

        form.appendChild(field('Статус', this.selectText(CUT_STATUSES, d.status, function(v) { d.status = v; })));

        var notes = el('textarea', { class: 'atex-pp-input atex-pp-textarea', rows: '2' });
        notes.value = d.notes || '';
        notes.addEventListener('input', function() { d.notes = notes.value; });
        form.appendChild(field('Примечания', notes));

        var actions = el('div', { class: 'atex-pp-actions' });
        var createBtn = el('button', { class: 'atex-pp-btn atex-pp-btn-primary', type: 'button', text: 'Создать резку' });
        createBtn.addEventListener('click', function() { self.createCut(); });
        actions.appendChild(createBtn);
        form.appendChild(actions);
    };

    AtexProductionPlanning.prototype.renderQueue = function() {
        var self = this;
        var box = this.queueEl;
        box.innerHTML = '';

        // Панель фильтров.
        var filters = el('div', { class: 'atex-pp-filters' });
        var slitterFilter = this.selectRef(this.slitters, this.filter.slitter, 'Все станки',
            function(v) { self.filter.slitter = v; self.renderQueue(); },
            reqIdByName(this.meta.cut, CUT_REQ.slitter),
            { clearOnInput: false });
        var statusFilter = this.selectText([''].concat(CUT_STATUSES), this.filter.status, function(v) { self.filter.status = v; self.renderQueue(); });
        // первый пункт статуса — «все»
        statusFilter.options[0].textContent = 'Все статусы';
        filters.appendChild(field('Станок', slitterFilter));
        filters.appendChild(field('Статус', statusFilter));
        box.appendChild(filters);

        var filtered = filterCuts(this.cuts, this.filter);
        var groups = groupBySlitter(filtered);

        if (!groups.length) {
            box.appendChild(el('div', { class: 'atex-pp-empty', text: 'Резок в очереди нет' }));
            return;
        }

        groups.forEach(function(g) {
            var groupEl = el('div', { class: 'atex-pp-queue-group' });
            groupEl.appendChild(el('div', { class: 'atex-pp-queue-head' }, [
                el('span', { class: 'atex-pp-queue-slitter', text: g.slitter.label }),
                el('span', { class: 'atex-pp-queue-count', text: g.cuts.length + ' рез.' })
            ]));
            g.cuts.forEach(function(c) {
                var active = String(self.selectedCutId) === String(c.id);
                var supplies = self.supplyCount(c.id);
                var card = el('button', { class: 'atex-pp-cut' + (active ? ' is-active' : ''), type: 'button' }, [
                    el('span', { class: 'atex-pp-cut-num', text: '№ ' + (c.number || c.id) }),
                    el('span', { class: 'atex-pp-cut-seq', text: 'Очер.: ' + (c.sequence != null && !isNaN(c.sequence) ? c.sequence : '—') }),
                    el('span', { class: 'atex-pp-cut-type', text: c.cutType.label || '—' }),
                    el('span', { class: 'atex-pp-cut-batch', text: c.materialBatch.label || '' }),
                    el('span', { class: 'atex-pp-cut-date', text: c.planDate || '' }),
                    el('span', { class: 'atex-pp-cut-status', text: c.status || '' }),
                    el('span', { class: 'atex-pp-cut-supplies', text: supplies ? ('связей: ' + supplies) : 'нет связей' })
                ]);
                card.addEventListener('click', function() { self.selectedCutId = c.id; self.render(); });
                groupEl.appendChild(card);
            });
            box.appendChild(groupEl);
        });
    };

    AtexProductionPlanning.prototype.renderLink = function() {
        var self = this;
        var box = this.linkEl;
        box.innerHTML = '';
        var cut = this.cuts.filter(function(c) { return String(c.id) === String(this.selectedCutId); }, this)[0];

        box.appendChild(el('h2', { class: 'atex-pp-form-title', text: 'Обеспечение позиций заказа' }));
        if (!cut) {
            box.appendChild(el('div', { class: 'atex-pp-empty', text: 'Выберите резку в очереди, чтобы привязать её к позиции заказа.' }));
            return;
        }

        box.appendChild(el('p', { class: 'atex-pp-hint', text: 'Резка № ' + (cut.number || cut.id) + ' · ' + (cut.cutType.label || '') }));

        var draft = { positionId: '', footage: '', status: SUPPLY_STATUSES[0] };

        box.appendChild(field('Позиция заказа', this.selectRef(this.positions, '', '— выберите позицию —',
            function(v) { draft.positionId = v; }, null, { cacheKey: 'positions' })));

        var footage = el('input', { class: 'atex-pp-input', type: 'number', min: '0', step: 'any', placeholder: 'например, 1200' });
        footage.addEventListener('input', function() { draft.footage = footage.value; });
        box.appendChild(field('Метраж, м', footage));

        box.appendChild(field('Статус обеспечения', this.selectText(SUPPLY_STATUSES, draft.status, function(v) { draft.status = v; })));

        var actions = el('div', { class: 'atex-pp-actions' });
        var linkBtn = el('button', { class: 'atex-pp-btn atex-pp-btn-primary', type: 'button', text: 'Привязать к резке' });
        linkBtn.addEventListener('click', function() {
            self.createSupply({ positionId: draft.positionId, cutId: cut.id, footage: draft.footage, status: draft.status });
        });
        actions.appendChild(linkBtn);
        box.appendChild(actions);

        // Уже привязанные позиции.
        var linked = this.supplies.filter(function(s) { return String(s.cutId) === String(cut.id); });
        var listWrap = el('div', { class: 'atex-pp-linked' });
        listWrap.appendChild(el('h3', { class: 'atex-pp-linked-title', text: 'Связанные позиции (' + linked.length + ')' }));
        if (!linked.length) {
            listWrap.appendChild(el('div', { class: 'atex-pp-empty', text: 'Пока нет связей.' }));
        } else {
            var posById = {};
            this.positions.forEach(function(p) { posById[p.id] = p.label; });
            linked.forEach(function(s) {
                listWrap.appendChild(el('div', { class: 'atex-pp-linked-item', text: posById[s.positionId] || ('позиция #' + s.positionId) }));
            });
        }
        box.appendChild(listWrap);
    };

    // ── Служебное ──

    AtexProductionPlanning.prototype.setBusy = function(on) {
        this.busy = on;
        if (this.root) this.root.classList.toggle('is-busy', !!on);
    };

    // Уведомления без alert/confirm/prompt (раздел 8 гайда): встроенный тост,
    // либо общий MainAppController, если он доступен в main.html.
    AtexProductionPlanning.prototype.notify = function(message, kind) {
        if (kind === 'error' && typeof window !== 'undefined' && window.mainAppController &&
            typeof window.mainAppController.showErrorModal === 'function') {
            window.mainAppController.showErrorModal(message);
            return;
        }
        var toast = el('div', { class: 'atex-pp-toast atex-pp-toast-' + (kind || 'info'), text: message });
        (this.toastHost || document.body).appendChild(toast);
        setTimeout(function() { toast.classList.add('is-visible'); }, 10);
        setTimeout(function() {
            toast.classList.remove('is-visible');
            setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
        }, 3500);
    };

    AtexProductionPlanning.prototype.fatal = function(message) {
        this.root.innerHTML = '';
        this.root.appendChild(el('div', { class: 'atex-pp-fatal', text: message }));
    };

    AtexProductionPlanning.prototype.start = function() {
        var self = this;
        this.root.innerHTML = '';
        var layout = el('div', { class: 'atex-pp-layout' });
        this.formEl = el('section', { class: 'atex-pp-panel atex-pp-form' });
        var queueWrap = el('section', { class: 'atex-pp-panel atex-pp-queue-panel' }, [
            el('h2', { class: 'atex-pp-form-title', text: 'Очередь резок по станкам' })
        ]);
        this.queueEl = el('div', { class: 'atex-pp-queue' });
        queueWrap.appendChild(this.queueEl);
        this.linkEl = el('section', { class: 'atex-pp-panel atex-pp-link' });
        layout.appendChild(this.formEl);
        layout.appendChild(queueWrap);
        layout.appendChild(this.linkEl);
        this.root.appendChild(layout);
        this.toastHost = this.root;

        this.formEl.appendChild(el('div', { class: 'atex-pp-loading', text: 'Загрузка…' }));

        return this.loadMetadata()
            .then(function() {
                return Promise.all([
                    self.loadSlittersWithStop().then(function(items) { self.slitters = items; }),
                    self.loadRef(self.meta.cutType).then(function(items) { self.cutTypes = items; }),
                    self.loadMaterialBatches(),
                    self.loadBatchMaterialMap(),
                    self.loadPositions(),
                    self.loadPlanning()
                ]);
            })
            .then(function() { self.render(); })
            .catch(function(err) { self.fatal('Ошибка инициализации: ' + err.message); });
    };

    function init() {
        if (typeof document === 'undefined') return;
        var root = document.getElementById('atex-production-planning');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        var controller = new AtexProductionPlanning(root);
        root._atexProductionPlanning = controller;
        controller.start();
    }

    return { planning: planning, Controller: AtexProductionPlanning, init: init };
});
