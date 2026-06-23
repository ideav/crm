// Рабочее место atex «Пульт втулкореза» (роль Оператор, планшет).
//
// По заданию на втулки оператор выбирает втулкорез, вводит количество факт и
// меняет статус задания (Ожидает → В работе → Готово). Задания подчинены
// «Заказанному количеству»: втулки для одной позиции могут планироваться общей партией,
// даже если сама позиция обеспечивается несколькими производственными резками.
// Решение задачи ideav/crm#2916 (часть #2903), актуализация #3139, #3159. Правила
// разработки рабочих мест — docs/WORKSPACE_DEVELOPMENT_GUIDE.md, карта рабочих
// мест — docs/atex_workplaces.md §3.6.
//
// Таблица «Задание на втулки» теперь идентифицируется по alias, а её главное
// значение (первая колонка) — это плановое количество втулок «К-во план» (#3159).
// Поэтому таблицы ищутся в метаданных и по `val` (первая колонка), и по `alias`
// (отображаемое имя), а план берётся/пишется как главное значение, а не реквизит.
//
// На этом этапе рабочее место обращается к данным напрямую командами `_m_*`
// (#2903): чтение заданий — `object/{Задание на втулки}/?F_U={позицияId}`,
// правки — `_m_set/{заданиеId}`, новые задания — `_m_new/{Задание на втулки}`
// с `up={позицияId}`. Список позиций берётся отчётом `orders_list`, с fallback на
// `positions_list`. ID таблиц и реквизитов не хардкодятся: они берутся по именам
// из `GET /{db}/metadata` (WORKSPACE_DEVELOPMENT_GUIDE.md, разделы 3 и 6).
//
// Чистое ядро (статусы заданий и сводка) вынесено в объект `core` и
// экспортируется через module.exports для модульных тестов
// (experiments/atex-sleeve-cutter.test.js).

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.AtexSleeveCutter = api;
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
    var TABLE = { position: ['Заказанное количество', 'Позиция заказа'], task: 'Задание на втулки', cutter: 'Втулкорез' };
    // Реквизиты задания. Плановое количество втулок («К-во план») — это главное
    // значение таблицы (первая колонка), а не реквизит, поэтому в списке его нет
    // (#3159): оно читается/пишется через `core.taskMainValue`.
    var TASK_REQ = {
        cutter: 'Втулкорез',
        diameter: 'Диаметр, мм',
        factQty: 'Кол-во факт',
        status: 'Статус'
    };
    var CUTTER_REQ = { diaMin: 'Диаметр min, мм', diaMax: 'Диаметр max, мм' };

    // Статусы задания по дизайн-спеке atex (§3.6): жёсткая цепочка переходов.
    var STATUSES = ['Ожидает', 'В работе', 'Готово'];

    // ───────────────────────── Чистое ядро ─────────────────────────

    // Терпимый разбор числа: принимает запятую как десятичный разделитель,
    // отбрасывает пробелы; «пусто»/мусор → 0.
    function toNumber(value) {
        if (typeof value === 'number') return isFinite(value) ? value : 0;
        var text = String(value == null ? '' : value).replace(/\s+/g, '').replace(',', '.');
        var n = parseFloat(text);
        return isFinite(n) ? n : 0;
    }

    // Приведение статуса к одному из известных; неизвестное возвращается как есть
    // (значение из БД сохраняем без потерь — поле «Статус» это свободный текст).
    function normalizeStatus(status) {
        var s = String(status == null ? '' : status).trim();
        if (!s) return STATUSES[0];
        for (var i = 0; i < STATUSES.length; i++) {
            if (STATUSES[i].toLowerCase() === s.toLowerCase()) return STATUSES[i];
        }
        return s;
    }

    // Следующий статус в цепочке Ожидает → В работе → Готово.
    // На финальном (или неизвестном) статусе возвращает текущий — двигаться некуда.
    function nextStatus(status) {
        var s = normalizeStatus(status);
        var idx = STATUSES.indexOf(s);
        if (idx === -1 || idx === STATUSES.length - 1) return s;
        return STATUSES[idx + 1];
    }

    // Задание завершено?
    function isDone(status) {
        return normalizeStatus(status) === STATUSES[STATUSES.length - 1];
    }

    // Сводка по заданиям позиции: сколько план/факт суммарно, сколько готово,
    // и процент выполнения (по факту от плана). Для шапки и прогресса.
    function summarize(tasks) {
        var list = tasks || [];
        var plan = 0, fact = 0, done = 0;
        list.forEach(function(t) {
            plan += toNumber(t.planQty);
            fact += toNumber(t.factQty);
            if (isDone(t.status)) done++;
        });
        return {
            total: list.length,
            done: done,
            planQty: round3(plan),
            factQty: round3(fact),
            // Процент выполнения по факту от плана (0..100, без плана → 0).
            percent: plan > 0 ? Math.min(100, Math.round((fact / plan) * 100)) : 0
        };
    }

    function round3(n) {
        return Math.round(n * 1000) / 1000;
    }

    function str(value) {
        return value == null ? '' : String(value);
    }

    // ── Поиск сущностей метаданных по имени (val/alias) ──

    // alias таблицы/реквизита: берём из готового поля `alias`, иначе разбираем
    // `attrs` (JSON со свойством alias). Таблицы получили alias в #3159.
    function aliasOf(entry) {
        if (!entry) return '';
        if (entry.alias != null && entry.alias !== '') return String(entry.alias);
        if (entry.attrs) {
            try {
                var a = JSON.parse(entry.attrs);
                if (a && a.alias != null) return String(a.alias);
            } catch (e) { /* attrs не JSON — alias нет */ }
        }
        return '';
    }

    // Совпадение сущности с искомым именем: и по `val` (первая колонка),
    // и по `alias` (отображаемое имя). Регистр и пробелы игнорируются (#3159).
    function matchesName(entry, name) {
        if (!entry) return false;
        var target = String(name == null ? '' : name).trim().toLowerCase();
        if (!target) return false;
        if (String(entry.val == null ? '' : entry.val).trim().toLowerCase() === target) return true;
        return aliasOf(entry).trim().toLowerCase() === target;
    }

    // Таблица из метаданных по имени (val или alias); нет → null.
    function tableByName(list, name) {
        var arr = Array.isArray(list) ? list : (list == null ? [] : [list]);
        var names = Array.isArray(name) ? name : [name];
        for (var i = 0; i < arr.length; i++) {
            for (var j = 0; j < names.length; j++) {
                if (matchesName(arr[i], names[j])) return arr[i];
            }
        }
        return null;
    }

    // Значение реквизита из метаданных по имени (val/alias) → его числовой id.
    function reqIdByName(meta, name) {
        var found = (meta && meta.reqs || []).filter(function(r) {
            return matchesName(r, name);
        })[0];
        return found ? String(found.id) : null;
    }

    // Индекс колонки JSON_OBJ по имени реквизита. Колонки идут в порядке
    // [главное значение, ...reqs по порядку метаданных].
    function colIndex(meta, reqName) {
        var order = [String(meta.id)].concat((meta.reqs || []).map(function(r) { return String(r.id); }));
        var rid = reqIdByName(meta, reqName);
        var idx = order.indexOf(String(rid));
        return idx >= 0 ? idx : -1;
    }

    // Разбор значения-ссылки из JSON_OBJ: «id:Подпись» → { id, label }.
    function parseRef(raw) {
        var m = String(raw == null ? '' : raw).match(/^(\d+):([\s\S]*)$/);
        return m ? { id: m[1], label: m[2] } : { id: null, label: String(raw == null ? '' : raw) };
    }

    function refLabel(value) {
        var ref = parseRef(value);
        return ref.label || ref.id || '';
    }

    // ── Маппинг строк задания на втулки ──

    // Строка JSON_OBJ задания → объект задания. Плановое количество — это
    // главное значение (первая колонка r[0]), остальное — реквизиты (#3159).
    function taskFromRow(meta, rec) {
        var r = (rec && rec.r) || [];
        var cutterIdx = colIndex(meta, TASK_REQ.cutter);
        var diamIdx = colIndex(meta, TASK_REQ.diameter);
        var factIdx = colIndex(meta, TASK_REQ.factQty);
        var statusIdx = colIndex(meta, TASK_REQ.status);
        var cutterRef = cutterIdx >= 0 ? parseRef(r[cutterIdx]) : { id: null };
        return {
            id: rec && rec.i != null ? String(rec.i) : null,
            planQty: r[0] || '',
            cutterId: cutterRef.id,
            cutterAuto: false,
            diameter: diamIdx >= 0 ? (r[diamIdx] || '') : '',
            factQty: factIdx >= 0 ? (r[factIdx] || '') : '',
            status: statusIdx >= 0 ? normalizeStatus(r[statusIdx]) : STATUSES[0]
        };
    }

    // Главное значение задания для записи (_m_save / t{tableId}) — план втулок.
    // Пусто → '' (команда такие поля не отправляет), иначе число.
    function taskMainValue(task) {
        var v = task ? task.planQty : '';
        return (v === '' || v == null) ? '' : toNumber(v);
    }

    // Реквизиты задания для _m_set/_m_new в форме `t{reqId}` (по именам из
    // метаданных). Без главного значения — его пишем отдельно (taskMainValue).
    function taskReqFields(meta, task) {
        var fields = {};
        function set(reqName, value) {
            var rid = reqIdByName(meta, reqName);
            if (rid) fields['t' + rid] = value;
        }
        function num(v) { return (v === '' || v == null) ? '' : toNumber(v); }
        set(TASK_REQ.cutter, (task && task.cutterId) || '');
        set(TASK_REQ.diameter, num(task && task.diameter));
        set(TASK_REQ.factQty, num(task && task.factQty));
        set(TASK_REQ.status, normalizeStatus(task && task.status));
        return fields;
    }

    function positionLabel(position) {
        var p = position || {};
        var orderNo = str(p.orderNo).trim();
        var no = str(p.no).trim();
        var width = str(p.width).trim();
        var head = '';
        if (orderNo && no) head = orderNo + '/' + no;
        else if (orderNo) head = orderNo;
        else if (no) head = '№' + no;
        else head = 'Позиция #' + str(p.id);
        return head + (width ? ' · ' + width + ' мм' : '');
    }

    // Плоские строки отчётов orders_list/positions_list → позиции для пульта.
    // Задания на втулки подчинены позиции (#3139), поэтому повторные строки
    // отчёта по одной позиции дедуплицируются.
    function rowsToPositions(rows) {
        var byId = {};
        var order = [];
        (rows || []).forEach(function(row) {
            var id = str(row.position_id);
            if (!id || byId[id]) return;
            var p = {
                id: id,
                orderNo: str(row.order_no),
                no: str(row.position_no),
                qty: str(row.position_qty),
                width: str(row.position_width) || str(row.position_width_mm),
                length: str(row.position_length) || str(row.position_length_m),
                sleeve: str(row.position_sleeve),
                status: str(row.position_status)
            };
            p.label = positionLabel(p);
            byId[id] = p;
            order.push(id);
        });
        return order.map(function(id) { return byId[id]; });
    }

    // Значения новой строки задания из выбранной позиции: план = кол-во позиции,
    // диаметр = справочное значение «Диаметр втулки», если отчёт его отдаёт.
    function taskDefaultsFromPosition(position) {
        var qty = position && position.qty != null ? str(position.qty) : '';
        var sleeve = position && position.sleeve != null ? refLabel(position.sleeve) : '';
        return {
            planQty: qty,
            diameter: sleeve === '' ? '' : toNumber(sleeve)
        };
    }

    // Подбор втулкореза по диаметру задания: запись, чей диапазон
    // [diaMin..diaMax] покрывает diameter (границы включительно); при нескольких —
    // с самым узким диапазоном; нет подходящего → null. Пустой диаметр → null.
    function pickCutter(diameter, cutters) {
        var d = toNumber(diameter);
        if (!d || !cutters) return null;
        var best = null, bestWidth = Infinity;
        cutters.forEach(function(c) {
            var min = (c.diaMin === '' || c.diaMin == null) ? -Infinity : toNumber(c.diaMin);
            var max = (c.diaMax === '' || c.diaMax == null) ? Infinity : toNumber(c.diaMax);
            if (d < min || d > max) return;
            var width = max - min;
            if (best === null || width < bestWidth) { best = c; bestWidth = width; }
        });
        return best;
    }

    // Подпись диапазона диаметров: «20–25 мм», «от 20 мм», «до 76 мм» или ''.
    function formatRange(min, max) {
        var hasMin = !(min === '' || min == null);
        var hasMax = !(max === '' || max == null);
        if (hasMin && hasMax) return toNumber(min) + '–' + toNumber(max) + ' мм';
        if (hasMin) return 'от ' + toNumber(min) + ' мм';
        if (hasMax) return 'до ' + toNumber(max) + ' мм';
        return '';
    }

    // Авто-назначение втулкореза заданию по диаметру. Ручной выбор оператора
    // (cutterId задан и не авто) не перетирается. Иначе — pickCutter и признак
    // cutterAuto. Мутирует и возвращает задание.
    function autoAssignCutter(task, cutters) {
        if (!task) return task;
        if (task.cutterId && !task.cutterAuto) return task;
        var picked = pickCutter(task.diameter, cutters);
        task.cutterId = picked ? picked.id : null;
        task.cutterAuto = !!picked;
        return task;
    }

    var core = {
        STATUSES: STATUSES,
        toNumber: toNumber,
        normalizeStatus: normalizeStatus,
        nextStatus: nextStatus,
        isDone: isDone,
        summarize: summarize,
        pickCutter: pickCutter,
        formatRange: formatRange,
        autoAssignCutter: autoAssignCutter,
        rowsToPositions: rowsToPositions,
        taskDefaultsFromPosition: taskDefaultsFromPosition,
        aliasOf: aliasOf,
        matchesName: matchesName,
        tableByName: tableByName,
        reqIdByName: reqIdByName,
        colIndex: colIndex,
        parseRef: parseRef,
        taskFromRow: taskFromRow,
        taskMainValue: taskMainValue,
        taskReqFields: taskReqFields
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

    // Метаданные-хелперы (reqIdByName, colIndex, parseRef) и маппинг строк
    // задания вынесены в core (см. выше) — браузерный слой использует их оттуда.

    function AtexSleeveCutter(root) {
        this.root = root;
        this.db = window.db || root.getAttribute('data-db') || '';
        this.meta = { position: null, task: null, cutter: null };
        this.cutters = [];        // справочник втулкорезов [{ id, label }]
        this.refOptions = {};     // кеш опций searchable reference inputs по reqId
        this.positions = [];      // позиции заказа [{ id, label, qty, sleeve, status }]
        this.currentPositionId = null; // выбранная позиция заказа
        this.currentPosition = null;   // { id, label, qty, sleeve, status }
        this.tasks = [];          // задания выбранной позиции [{ id, planQty, cutterId, diameter, factQty, status }]
        this.busy = false;
    }

    AtexSleeveCutter.prototype.url = function(path) {
        return '/' + encodeURIComponent(this.db) + '/' + path;
    };

    // GET → JSON. Бросает Error при сетевой/JSON-ошибке.
    AtexSleeveCutter.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                try { return JSON.parse(text); }
                catch (e) { throw new Error('Некорректный JSON: ' + text.slice(0, 200)); }
            });
        });
    };

    AtexSleeveCutter.prototype.loadRefOptions = function(reqId, query, limit) {
        return this.getJson(window.AtexRefSearch.buildRefOptionsPath(reqId, query, limit));
    };

    AtexSleeveCutter.prototype.refSelect = function(opts) {
        var self = this;
        var helper = (typeof window !== 'undefined' && window.AtexRefSearch) || null;
        if (helper && typeof helper.createSelect === 'function') {
            return helper.createSelect({
                classPrefix: 'atex-sc',
                inputClass: 'atex-sc-input',
                options: opts.options || [],
                value: opts.value,
                placeholder: opts.placeholder,
                reqId: opts.reqId,
                cache: this.refOptions,
                loadOptions: function(reqId, query, limit) { return self.loadRefOptions(reqId, query, limit); },
                onChange: opts.onChange
            });
        }

        var nativeSelect = el('select', { class: 'atex-sc-input' });
        nativeSelect.appendChild(el('option', { value: '', text: opts.placeholder || '— не выбрано —' }));
        (opts.options || []).forEach(function(item) {
            var o = el('option', { value: item.id, text: item.label });
            if (String(opts.value) === String(item.id)) o.selected = true;
            nativeSelect.appendChild(o);
        });
        nativeSelect.addEventListener('change', function() { opts.onChange(nativeSelect.value); });
        return nativeSelect;
    };

    // POST команды `_m_*`. Токен XSRF подставляется обязательно (раздел 4 гайда).
    AtexSleeveCutter.prototype.post = function(path, params) {
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
                try { result = JSON.parse(text); } catch (e) { throw new Error('Сервер вернул не JSON: ' + text.slice(0, 200)); }
                if (result && (result.error || result.err)) throw new Error(result.error || result.err);
                return result;
            });
        });
    };

    // ── Загрузка метаданных и справочников ──

    AtexSleeveCutter.prototype.loadMetadata = function() {
        var self = this;
        return this.getJson('metadata').then(function(all) {
            var list = Array.isArray(all) ? all : [all];
            // Таблицы ищем по имени с учётом alias (#3159): «Задание на втулки» —
            // это alias таблицы, чьё главное значение называется «К-во план».
            function byName(name) {
                return core.tableByName(list, name);
            }
            self.meta.position = byName(TABLE.position);
            self.meta.task = byName(TABLE.task);
            self.meta.cutter = byName(TABLE.cutter);
            if (!self.meta.task) throw new Error('В метаданных не найдена таблица «' + TABLE.task + '»');
            if (!self.meta.position) throw new Error('В метаданных не найдена таблица «' + TABLE.position + '»');
        });
    };

    AtexSleeveCutter.prototype.loadCutters = function() {
        var self = this;
        if (!this.meta.cutter) { this.cutters = []; return Promise.resolve(); }
        var meta = this.meta.cutter;
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            var minIdx = colIndex(meta, CUTTER_REQ.diaMin);
            var maxIdx = colIndex(meta, CUTTER_REQ.diaMax);
            self.cutters = (rows || []).map(function(r) {
                var row = r.r || [];
                return {
                    id: String(r.i),
                    label: row[0] || ('#' + r.i),
                    diaMin: minIdx >= 0 ? (row[minIdx] || '') : '',
                    diaMax: maxIdx >= 0 ? (row[maxIdx] || '') : ''
                };
            });
        });
    };

    // Опции выпадающего списка втулкорезов с подписью диапазона.
    AtexSleeveCutter.prototype.cutterOptions = function() {
        return (this.cutters || []).map(function(c) {
            var range = core.formatRange(c.diaMin, c.diaMax);
            return { id: c.id, label: range ? (c.label + ' (' + range + ')') : c.label };
        });
    };

    AtexSleeveCutter.prototype.loadPositions = function() {
        var self = this;
        return this.getJson('report/orders_list?JSON_KV&LIMIT=0,5000').catch(function() {
            return self.getJson('report/positions_list?JSON_KV&LIMIT=0,5000');
        }).then(function(rows) {
            self.positions = core.rowsToPositions(rows);
        });
    };

    // ── Чтение заданий выбранной позиции заказа ──

    AtexSleeveCutter.prototype.loadTasks = function(positionId) {
        var self = this;
        var meta = this.meta.task;
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(positionId) + '&LIMIT=0,1000').then(function(rows) {
            self.tasks = (rows || []).map(function(rec) { return core.taskFromRow(meta, rec); });
        });
    };

    AtexSleeveCutter.prototype.blankTask = function() {
        var defaults = core.taskDefaultsFromPosition(this.currentPosition);
        var task = {
            id: null,
            planQty: defaults.planQty,
            cutterId: null,
            cutterAuto: false,
            diameter: defaults.diameter,
            factQty: '',
            status: STATUSES[0]
        };
        core.autoAssignCutter(task, this.cutters);
        return task;
    };

    // ── Рендеринг ──

    AtexSleeveCutter.prototype.render = function() {
        this.renderPositions();
        this.renderTasks();
    };

    AtexSleeveCutter.prototype.renderPositions = function() {
        var self = this;
        var box = this.positionsEl;
        if (!box) return;
        box.innerHTML = '';
        if (!this.positions.length) {
            box.appendChild(el('div', { class: 'atex-sc-empty', text: 'Позиций пока нет' }));
            return;
        }
        this.positions.forEach(function(position) {
            var active = String(self.currentPositionId) === String(position.id);
            var item = el('button', {
                class: 'atex-sc-cut-item' + (active ? ' is-active' : ''),
                type: 'button'
            }, [
                el('span', { class: 'atex-sc-cut-label', text: position.label }),
                position.status ? el('span', { class: 'atex-sc-badge', text: core.normalizeStatus(position.status) }) : null
            ]);
            item.addEventListener('click', function() { self.openPosition(position.id); });
            box.appendChild(item);
        });
    };

    AtexSleeveCutter.prototype.renderTasks = function() {
        var self = this;
        var host = this.tasksEl;
        if (!host) return;
        host.innerHTML = '';

        if (!this.currentPositionId) {
            host.appendChild(el('div', { class: 'atex-sc-placeholder', text: 'Выберите позицию заказа слева, чтобы увидеть задания на втулки.' }));
            return;
        }

        var position = this.currentPosition || {};
        var head = el('div', { class: 'atex-sc-head' }, [
            el('h2', { class: 'atex-sc-head-title', text: position.label || ('Позиция #' + this.currentPositionId) }),
            position.status ? el('span', { class: 'atex-sc-badge', text: core.normalizeStatus(position.status) }) : null
        ]);
        host.appendChild(head);

        // Сводка по заданиям.
        var s = core.summarize(this.tasks);
        var summary = el('div', { class: 'atex-sc-summary' }, [
            metric('Заданий', s.total),
            metric('Готово', s.done + ' / ' + s.total),
            metric('План, шт', s.planQty),
            metric('Факт, шт', s.factQty),
            metric('Выполнено', s.percent + '%')
        ]);
        host.appendChild(summary);

        var listWrap = el('div', { class: 'atex-sc-tasks' });
        if (!this.tasks.length) {
            listWrap.appendChild(el('div', { class: 'atex-sc-empty', text: 'Заданий нет — добавьте первое.' }));
        } else {
            this.tasks.forEach(function(task, idx) { listWrap.appendChild(self.renderTaskCard(task, idx)); });
        }
        host.appendChild(listWrap);

        var addBtn = el('button', { class: 'atex-sc-btn atex-sc-btn-add', type: 'button', text: '+ Добавить задание' });
        addBtn.addEventListener('click', function() { self.tasks.push(self.blankTask()); self.renderTasks(); });
        host.appendChild(addBtn);

        function metric(label, value) {
            return el('div', { class: 'atex-sc-metric' }, [
                el('span', { class: 'atex-sc-metric-label', text: label }),
                el('span', { class: 'atex-sc-metric-value', text: String(value) })
            ]);
        }
    };

    AtexSleeveCutter.prototype.renderTaskCard = function(task, idx) {
        var self = this;
        var card = el('div', { class: 'atex-sc-card' + (core.isDone(task.status) ? ' is-done' : ''), 'data-submit-scope': '' });

        card.appendChild(el('div', { class: 'atex-sc-card-head' }, [
            el('span', { class: 'atex-sc-card-num', text: '№ ' + (idx + 1) }),
            el('span', { class: 'atex-sc-badge atex-sc-badge-' + (core.isDone(task.status) ? 'done' : 'wip'), text: core.normalizeStatus(task.status) })
        ]));

        var grid = el('div', { class: 'atex-sc-card-grid' });

        // Втулкорез (ссылка). Подписи с диапазоном; ручной выбор снимает авто-признак.
        var cutterRef = this.refSelect({
            options: this.cutterOptions(),
            value: task.cutterId,
            placeholder: '— втулкорез —',
            reqId: reqIdByName(this.meta.task, TASK_REQ.cutter),
            onChange: function(value) { task.cutterId = value || null; task.cutterAuto = false; }
        });
        var cutterField = this.cardField('Втулкорез', cutterRef);
        if (task.diameter !== '' && task.diameter != null && !core.pickCutter(task.diameter, this.cutters)) {
            cutterField.appendChild(el('span', { class: 'atex-sc-hint', text: 'нет втулкореза под Ø' + core.toNumber(task.diameter) }));
        }
        grid.appendChild(cutterField);

        // Диаметр. По завершении ввода — авто-подбор втулкореза.
        var diam = numInput(task.diameter, '76');
        diam.addEventListener('input', function() { task.diameter = diam.value; });
        diam.addEventListener('change', function() {
            task.diameter = diam.value;
            core.autoAssignCutter(task, self.cutters);
            self.renderTasks();
        });
        grid.appendChild(this.cardField('Диаметр, мм', diam));

        // Кол-во план.
        var plan = numInput(task.planQty, '0');
        plan.addEventListener('input', function() { task.planQty = plan.value; });
        grid.appendChild(this.cardField('Кол-во план', plan));

        // Кол-во факт.
        var fact = numInput(task.factQty, '0');
        fact.addEventListener('input', function() { task.factQty = fact.value; });
        grid.appendChild(this.cardField('Кол-во факт', fact));

        // Статус.
        var statusSel = el('select', { class: 'atex-sc-input' });
        var statuses = core.STATUSES.slice();
        if (task.status && statuses.indexOf(task.status) === -1) statuses.push(task.status);
        statuses.forEach(function(st) {
            var o = el('option', { value: st, text: st });
            if (task.status === st) o.selected = true;
            statusSel.appendChild(o);
        });
        statusSel.addEventListener('change', function() { task.status = statusSel.value; self.renderTasks(); });
        grid.appendChild(this.cardField('Статус', statusSel));

        card.appendChild(grid);

        // Действия: «дальше по статусу», сохранить, удалить.
        var actions = el('div', { class: 'atex-sc-card-actions' });

        if (!core.isDone(task.status)) {
            var next = core.nextStatus(task.status);
            var advance = el('button', { class: 'atex-sc-btn atex-sc-btn-advance', type: 'button', text: '→ ' + next });
            advance.addEventListener('click', function() { task.status = next; self.saveTask(task); });
            actions.appendChild(advance);
        }

        var saveBtn = el('button', { class: 'atex-sc-btn atex-sc-btn-primary', type: 'button', text: 'Сохранить' });
        saveBtn.addEventListener('click', function() { self.saveTask(task); });
        actions.appendChild(saveBtn);

        var delBtn = el('button', { class: 'atex-sc-btn atex-sc-btn-del', type: 'button', title: 'Удалить задание', text: '×' });
        delBtn.addEventListener('click', function() { self.deleteTask(task, idx); });
        actions.appendChild(delBtn);

        card.appendChild(actions);
        return card;

        function numInput(value, placeholder) {
            var inp = el('input', { class: 'atex-sc-input', type: 'number', min: '0', step: 'any', placeholder: placeholder || '0' });
            inp.value = value == null ? '' : value;
            return inp;
        }
    };

    AtexSleeveCutter.prototype.cardField = function(label, control) {
        return el('label', { class: 'atex-sc-field' }, [
            el('span', { class: 'atex-sc-label', text: label }),
            control
        ]);
    };

    // ── Сохранение / удаление задания ──

    AtexSleeveCutter.prototype.saveTask = function(task) {
        var self = this;
        if (this.busy) return;
        if (!this.currentPositionId) { this.notify('Сначала выберите позицию заказа', 'error'); return; }
        var meta = this.meta.task;
        // Реквизиты (втулкорез, диаметр, факт, статус) и главное значение —
        // плановое количество втулок «К-во план» (первая колонка, #3159).
        var fields = core.taskReqFields(meta, task);
        var planValue = core.taskMainValue(task);

        this.setBusy(true);
        var chain;
        if (task.id) {
            chain = this.post('_m_save/' + task.id + '?JSON', { val: planValue })
                .then(function() { return self.post('_m_set/' + task.id + '?JSON', fields); })
                .then(function() { return task.id; });
        } else {
            var createParams = {};
            Object.keys(fields).forEach(function(k) { createParams[k] = fields[k]; });
            createParams['t' + meta.id] = planValue;
            chain = this.post('_m_new/' + meta.id + '?JSON&up=' + encodeURIComponent(this.currentPositionId), createParams)
                .then(function(res) {
                    var id = res && (res.obj || res.id || res.i);
                    if (!id) throw new Error('Сервер не вернул id нового задания');
                    task.id = String(id);
                    return task.id;
                });
        }

        chain.then(function() {
            return self.loadTasks(self.currentPositionId);
        }).then(function() {
            self.setBusy(false);
            self.notify('Задание сохранено', 'success');
            self.renderTasks();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка сохранения: ' + err.message, 'error');
        });
    };

    AtexSleeveCutter.prototype.deleteTask = function(task, idx) {
        var self = this;
        if (this.busy) return;
        // Новая (несохранённая) строка — просто убираем из формы.
        if (!task.id) {
            this.tasks.splice(idx, 1);
            this.renderTasks();
            return;
        }
        this.setBusy(true);
        this.post('_m_del/' + task.id + '?JSON', {}).then(function() {
            return self.loadTasks(self.currentPositionId);
        }).then(function() {
            self.setBusy(false);
            self.notify('Задание удалено', 'success');
            self.renderTasks();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка удаления: ' + err.message, 'error');
        });
    };

    AtexSleeveCutter.prototype.openPosition = function(positionId) {
        var self = this;
        this.setBusy(true);
        this.currentPositionId = String(positionId);
        this.currentPosition = this.positions.filter(function(p) { return String(p.id) === String(positionId); })[0] || null;
        this.loadTasks(positionId).then(function() {
            self.setBusy(false);
            self.render();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Не удалось открыть задания: ' + err.message, 'error');
        });
    };

    AtexSleeveCutter.prototype.setBusy = function(on) {
        this.busy = on;
        if (this.root) this.root.classList.toggle('is-busy', !!on);
    };

    // Уведомления без alert/confirm/prompt (раздел 8 гайда): встроенный тост,
    // либо общий MainAppController, если он доступен в main.html.
    AtexSleeveCutter.prototype.notify = function(message, kind) {
        if (kind === 'error' && typeof window !== 'undefined' && window.mainAppController &&
            typeof window.mainAppController.showErrorModal === 'function') {
            window.mainAppController.showErrorModal(message);
            return;
        }
        var toast = el('div', { class: 'atex-sc-toast atex-sc-toast-' + (kind || 'info'), text: message });
        (this.toastHost || document.body).appendChild(toast);
        setTimeout(function() { toast.classList.add('is-visible'); }, 10);
        setTimeout(function() {
            toast.classList.remove('is-visible');
            setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
        }, 3500);
    };

    AtexSleeveCutter.prototype.fatal = function(message) {
        this.root.innerHTML = '';
        this.root.appendChild(el('div', { class: 'atex-sc-fatal', text: message }));
    };

    AtexSleeveCutter.prototype.start = function() {
        var self = this;
        this.root.innerHTML = '';
        var layout = el('div', { class: 'atex-sc-layout' });
        var aside = el('aside', { class: 'atex-sc-sidebar' }, [
            el('div', { class: 'atex-sc-sidebar-head' }, [ el('h2', { text: 'Позиции' }) ])
        ]);
        this.positionsEl = el('div', { class: 'atex-sc-cuts' });
        aside.appendChild(this.positionsEl);
        this.tasksEl = el('section', { class: 'atex-sc-main' });
        layout.appendChild(aside);
        layout.appendChild(this.tasksEl);
        this.root.appendChild(layout);
        this.toastHost = this.root;

        this.positionsEl.appendChild(el('div', { class: 'atex-sc-loading', text: 'Загрузка…' }));
        this.tasksEl.appendChild(el('div', { class: 'atex-sc-placeholder', text: 'Загрузка данных…' }));

        return this.loadMetadata()
            .then(function() { return Promise.all([self.loadCutters(), self.loadPositions()]); })
            .then(function() { self.render(); })
            .catch(function(err) { self.fatal('Ошибка инициализации: ' + err.message); });
    };

    function init() {
        if (typeof document === 'undefined') return;
        var root = document.getElementById('atex-sleeve-cutter');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        var controller = new AtexSleeveCutter(root);
        root._atexSleeveCutter = controller;
        controller.start();
    }

    return { core: core, Controller: AtexSleeveCutter, init: init };
});
