// Рабочее место atex «Приёмка сырья» (роль Кладовщик).
//
// Оприходование партии сырья (вид сырья, дата прихода, получено м²) и ведение
// остатка с FIFO-порядком по дате прихода. Решение задачи ideav/crm#2914
// (часть #2903). Правила разработки рабочих мест — docs/WORKSPACE_DEVELOPMENT_GUIDE.md,
// описание рабочего места — docs/atex_workplaces.md §3.4.
//
// На этом этапе рабочее место обращается к данным напрямую командами `_m_*`
// (#2903): создание — `_m_new/{Партия сырья}`, правки и остаток — `_m_set`,
// чтение — `object/{Партия сырья}/?JSON_OBJ` (сортировка по дате прихода для
// FIFO делается на клиенте). ID таблиц и реквизитов не хардкодятся: они берутся
// по именам из `GET /{db}/metadata` (WORKSPACE_DEVELOPMENT_GUIDE.md,
// разделы 3 и 6). Перевод чтений на защищённый слой `report/` — следующий этап
// и в объём этой задачи не входит.
//
// Ключевое правило (дизайн-спека atex / критерии приёмки #2914):
//   • при оприходовании «Остаток, м²» инициализируется значением «Получено, м²».
//
// Чистое ядро (объект `calc`) экспортируется через module.exports для модульных
// тестов (experiments/atex-intake.test.js).

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.AtexIntake = api;
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
    var TABLE = { batch: 'Партия сырья', material: 'Вид сырья' };
    var BATCH_REQ = {
        material: 'Вид сырья',
        barcode: 'Штрих-код',
        arrivedAt: 'Дата прихода',
        received: 'Получено, м²',
        remainder: 'Остаток, м²',
        lengthM: 'Длина, м',
        remainderM: 'Остаток, м'
    };

    // ───────────────────────── Чистое ядро расчёта ─────────────────────────

    // Терпимый разбор числа: принимает запятую как десятичный разделитель,
    // отбрасывает пробелы; «пусто»/мусор → 0.
    function toNumber(value) {
        if (typeof value === 'number') return isFinite(value) ? value : 0;
        var text = String(value == null ? '' : value).replace(/\s+/g, '').replace(',', '.');
        var n = parseFloat(text);
        return isFinite(n) ? n : 0;
    }

    // Округление до 3 знаков, чтобы убрать артефакты float-арифметики.
    function round3(n) {
        return Math.round(n * 1000) / 1000;
    }

    // Критерий приёмки #2914: «Остаток, м²» при оприходовании равен «Получено, м²».
    function initialRemainder(received) {
        return round3(toNumber(received));
    }

    // Длина джамбо по умолчанию: «Длина рулона, м» выбранного вида сырья.
    // materials: [{ id, label, rollLength }]. Нет данных → 0.
    function materialDefaultLength(materials, materialId) {
        if (materialId == null) return 0;
        var m = (materials || []).filter(function(x) {
            return String(x.id) === String(materialId);
        })[0];
        return m ? round3(toNumber(m.rollLength)) : 0;
    }

    // Сортировочный ключ даты для FIFO: ISO (YYYY-MM-DD) и Д.М.Г → число.
    // Пустая/непарсируемая дата → +∞ (такие партии уходят в конец очереди).
    function dateKey(value) {
        var s = String(value == null ? '' : value).trim();
        if (!s) return Infinity;
        var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return Number(iso[1]) * 10000 + Number(iso[2]) * 100 + Number(iso[3]);
        var dmy = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
        if (dmy) return Number(dmy[3]) * 10000 + Number(dmy[2]) * 100 + Number(dmy[1]);
        var t = Date.parse(s);
        return isNaN(t) ? Infinity : t;
    }

    // FIFO-порядок: по возрастанию даты прихода (старые — первыми). Стабильна
    // (равные даты сохраняют исходный порядок). Не мутирует входной массив.
    function sortFifo(batches) {
        return (batches || [])
            .map(function(b, i) { return { b: b, i: i, k: dateKey(b && b.arrivedAt) }; })
            .sort(function(a, c) { return a.k - c.k || a.i - c.i; })
            .map(function(x) { return x.b; });
    }

    // Сводка по партиям: количество, получено всего, остаток всего.
    function summarize(batches) {
        return (batches || []).reduce(function(acc, b) {
            acc.count += 1;
            acc.totalReceived = round3(acc.totalReceived + toNumber(b.received));
            acc.totalRemaining = round3(acc.totalRemaining + toNumber(b.remainder));
            return acc;
        }, { count: 0, totalReceived: 0, totalRemaining: 0 });
    }

    var calc = {
        toNumber: toNumber,
        round3: round3,
        initialRemainder: initialRemainder,
        materialDefaultLength: materialDefaultLength,
        dateKey: dateKey,
        sortFifo: sortFifo,
        summarize: summarize
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

    // ISO-дата для <input type="date">. Приводит Д.М.Г к YYYY-MM-DD; иначе ''.
    function toIsoDate(value) {
        var s = String(value == null ? '' : value).trim();
        if (!s) return '';
        var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
        var dmy = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
        if (dmy) {
            var pad = function(n) { return ('0' + n).slice(-2); };
            return dmy[3] + '-' + pad(dmy[2]) + '-' + pad(dmy[1]);
        }
        return '';
    }

    function todayIso() {
        var now = new Date();
        var pad = function(n) { return ('0' + n).slice(-2); };
        return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    }

    // Значение реквизита из метаданных по имени → его числовой id (t{id}).
    function reqIdByName(meta, name) {
        var found = (meta && meta.reqs || []).filter(function(r) {
            return String(r.val).trim().toLowerCase() === String(name).trim().toLowerCase();
        })[0];
        return found ? String(found.id) : null;
    }

    // Колонки JSON_OBJ идут в порядке: [главное значение, ...reqs по порядку].
    function columnIndex(meta, reqName) {
        var order = [String(meta && meta.id)].concat((meta && meta.reqs || []).map(function(r) { return String(r.id); }));
        var rid = reqIdByName(meta, reqName);
        var idx = order.indexOf(String(rid));
        return idx >= 0 ? idx : -1;
    }

    // Разбор значения-ссылки из JSON_OBJ: «id:Подпись» → { id, label }.
    function parseRef(raw) {
        var m = String(raw == null ? '' : raw).match(/^(\d+):([\s\S]*)$/);
        return m ? { id: m[1], label: m[2] } : { id: null, label: String(raw == null ? '' : raw) };
    }

    function trimValue(value) {
        return String(value == null ? '' : value).trim();
    }

    function appendQueryPart(parts, name, value) {
        parts.push(encodeURIComponent(name) + '=' + encodeURIComponent(value));
    }

    function hasBatchFilters(filters) {
        filters = filters || {};
        return !!(trimValue(filters.materialId) || trimValue(filters.barcode) || trimValue(filters.arrivedAt));
    }

    function buildBatchListPath(meta, filters, limit) {
        filters = filters || {};
        var parts = ['JSON_OBJ', 'LIMIT=0,' + (limit || 5000)];
        var materialReqId = reqIdByName(meta, BATCH_REQ.material);
        var barcodeReqId = reqIdByName(meta, BATCH_REQ.barcode);
        var arrivedReqId = reqIdByName(meta, BATCH_REQ.arrivedAt);
        var materialId = trimValue(filters.materialId);
        var barcode = trimValue(filters.barcode);
        var arrivedAt = toIsoDate(filters.arrivedAt) || trimValue(filters.arrivedAt);

        if (materialReqId && materialId) appendQueryPart(parts, 'FR_' + materialReqId, '@' + materialId);
        if (barcodeReqId && barcode) appendQueryPart(parts, 'FR_' + barcodeReqId, barcode + '%');
        if (arrivedReqId && arrivedAt) appendQueryPart(parts, 'FR_' + arrivedReqId, arrivedAt);
        return 'object/' + encodeURIComponent(meta.id) + '/?' + parts.join('&');
    }

    function mapBatchRecord(rec, meta) {
        var iMat = columnIndex(meta, BATCH_REQ.material);
        var iBarcode = columnIndex(meta, BATCH_REQ.barcode);
        var iArr = columnIndex(meta, BATCH_REQ.arrivedAt);
        var iRec = columnIndex(meta, BATCH_REQ.received);
        var iRem = columnIndex(meta, BATCH_REQ.remainder);
        var iLen = columnIndex(meta, BATCH_REQ.lengthM);
        var iRemM = columnIndex(meta, BATCH_REQ.remainderM);
        var r = rec && rec.r || [];
        var matRef = iMat >= 0 ? parseRef(r[iMat]) : { id: null, label: '' };
        return {
            id: String(rec && rec.i),
            name: r[0] || '',
            materialId: matRef.id,
            materialLabel: matRef.label,
            barcode: iBarcode >= 0 ? (r[iBarcode] || '') : '',
            arrivedAt: iArr >= 0 ? (r[iArr] || '') : '',
            received: iRec >= 0 ? (r[iRec] || '') : '',
            remainder: iRem >= 0 ? (r[iRem] || '') : '',
            lengthM: iLen >= 0 ? (r[iLen] || '') : '',
            remainderM: iRemM >= 0 ? (r[iRemM] || '') : ''
        };
    }

    function buildBatchFields(meta, c) {
        c = c || {};
        var fields = {};
        function setReq(reqName, value, includeEmpty) {
            var id = reqIdByName(meta, reqName);
            if (!id) return;
            if (value === undefined || value === null) return;
            if (!includeEmpty && value === '') return;
            fields['t' + id] = value;
        }

        setReq(BATCH_REQ.material, c.materialId);
        setReq(BATCH_REQ.barcode, trimValue(c.barcode), true);
        setReq(BATCH_REQ.arrivedAt, c.arrivedAt || todayIso());
        setReq(BATCH_REQ.received, round3(toNumber(c.received)));

        var remainder = (c.remainder === '' || c.remainder == null)
            ? initialRemainder(c.received)
            : round3(toNumber(c.remainder));
        setReq(BATCH_REQ.remainder, remainder);

        var lengthM = round3(toNumber(c.lengthM));
        var remainderM = (c.remainderM === '' || c.remainderM == null)
            ? lengthM
            : round3(toNumber(c.remainderM));
        setReq(BATCH_REQ.lengthM, lengthM);
        setReq(BATCH_REQ.remainderM, remainderM);

        return fields;
    }

    function AtexIntake(root) {
        this.root = root;
        this.db = window.db || root.getAttribute('data-db') || '';
        this.meta = { batch: null, material: null };
        this.materials = [];   // [{ id, label, rollLength }]
        this.batches = [];     // загруженные партии [{ id, name, materialId, materialLabel, barcode, arrivedAt, received, remainder }]
        this.filters = { materialId: '', barcode: '', arrivedAt: '' };
        this.refOptions = {};  // кеш опций searchable reference inputs по reqId
        this.current = null;   // редактируемая/новая партия
        this.remainderTouched = false; // пользователь вручную правил «Остаток»?
        this.remainderMTouched = false; // пользователь вручную правил «Остаток, м»?
        this.busy = false;
        this.filterTimer = null;
        this.batchLoadSeq = 0;
    }

    AtexIntake.prototype.url = function(path) {
        return '/' + encodeURIComponent(this.db) + '/' + path;
    };

    // GET → JSON. Бросает Error при сетевой/JSON-ошибке.
    AtexIntake.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                try { return JSON.parse(text); }
                catch (e) { throw new Error('Некорректный JSON: ' + text.slice(0, 200)); }
            });
        });
    };

    AtexIntake.prototype.loadRefOptions = function(reqId, query, limit) {
        return this.getJson(window.AtexRefSearch.buildRefOptionsPath(reqId, query, limit));
    };

    AtexIntake.prototype.refSelect = function(opts) {
        var self = this;
        var helper = (typeof window !== 'undefined' && window.AtexRefSearch) || null;
        if (helper && typeof helper.createSelect === 'function') {
            return helper.createSelect({
                classPrefix: 'atex-in',
                inputClass: 'atex-in-input',
                id: opts.id,
                options: opts.options || [],
                value: opts.value,
                placeholder: opts.placeholder,
                reqId: opts.reqId,
                cache: this.refOptions,
                loadOptions: function(reqId, query, limit) { return self.loadRefOptions(reqId, query, limit); },
                onChange: opts.onChange,
                clearOnInput: opts.clearOnInput
            });
        }

        var sel = el('select', { class: 'atex-in-input', id: opts.id });
        sel.appendChild(el('option', { value: '', text: opts.placeholder || '— не выбрано —' }));
        (opts.options || []).forEach(function(item) {
            var o = el('option', { value: item.id, text: item.label });
            if (String(opts.value) === String(item.id)) o.selected = true;
            sel.appendChild(o);
        });
        sel.addEventListener('change', function() { opts.onChange(sel.value); });
        return sel;
    };

    // POST команды `_m_*`. Токен XSRF подставляется обязательно (раздел 4 гайда).
    AtexIntake.prototype.post = function(path, params) {
        var body = new URLSearchParams();
        body.set('_xsrf', (typeof window !== 'undefined' && window.xsrf) || this.root.getAttribute('data-xsrf') || '');
        Object.keys(params || {}).forEach(function(k) {
            if (params[k] !== undefined && params[k] !== null) body.set(k, params[k]);
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

    AtexIntake.prototype.loadMetadata = function() {
        var self = this;
        return this.getJson('metadata').then(function(all) {
            var list = Array.isArray(all) ? all : [all];
            function byName(name) {
                return list.filter(function(t) {
                    return String(t.val).trim().toLowerCase() === name.trim().toLowerCase();
                })[0] || null;
            }
            self.meta.batch = byName(TABLE.batch);
            self.meta.material = byName(TABLE.material);
            if (!self.meta.batch) throw new Error('В метаданных не найдена таблица «' + TABLE.batch + '»');
        });
    };

    AtexIntake.prototype.loadMaterials = function() {
        var self = this;
        if (!this.meta.material) { this.materials = []; return Promise.resolve(); }
        return this.getJson('object/' + this.meta.material.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            var lenIdx = self.colIndex(self.meta.material, 'Длина рулона, м');
            self.materials = (rows || []).map(function(r) {
                var row = r.r || [];
                return {
                    id: String(r.i),
                    label: row[0] || ('#' + r.i),
                    rollLength: lenIdx >= 0 ? (row[lenIdx] || '') : ''
                };
            });
        });
    };

    AtexIntake.prototype.colIndex = function(meta, reqName) {
        return columnIndex(meta, reqName);
    };

    AtexIntake.prototype.fetchBatches = function() {
        var meta = this.meta.batch;
        return this.getJson(buildBatchListPath(meta, this.filters, 5000)).then(function(rows) {
            return sortFifo((rows || []).map(function(rec) { return mapBatchRecord(rec, meta); }));
        });
    };

    AtexIntake.prototype.loadBatches = function() {
        var self = this;
        return this.fetchBatches().then(function(list) {
            self.batches = list;
        });
    };

    AtexIntake.prototype.reloadBatches = function() {
        var self = this;
        var ticket = ++this.batchLoadSeq;
        if (this.listEl) this.listEl.classList.add('is-loading');
        return this.fetchBatches().then(function(list) {
            if (ticket !== self.batchLoadSeq) return;
            self.batches = list;
            if (self.listEl) self.listEl.classList.remove('is-loading');
            self.renderList();
        }).catch(function(err) {
            if (ticket !== self.batchLoadSeq) return;
            if (self.listEl) self.listEl.classList.remove('is-loading');
            self.notify('Ошибка фильтра: ' + err.message, 'error');
        });
    };

    AtexIntake.prototype.scheduleBatchReload = function(delay) {
        var self = this;
        if (this.filterTimer) clearTimeout(this.filterTimer);
        this.filterTimer = setTimeout(function() {
            self.reloadBatches();
        }, delay || 0);
    };

    // ── Состояние формы ──

    AtexIntake.prototype.newBatch = function() {
        this.current = {
            id: null, name: '', materialId: null, barcode: '',
            arrivedAt: todayIso(), received: '', remainder: '',
            lengthM: '', remainderM: ''
        };
        this.remainderTouched = false;
        this.remainderMTouched = false;
    };

    AtexIntake.prototype.openBatch = function(id) {
        var b = this.batches.filter(function(x) { return String(x.id) === String(id); })[0];
        if (!b) return;
        this.current = {
            id: b.id, name: b.name, materialId: b.materialId, barcode: b.barcode,
            arrivedAt: toIsoDate(b.arrivedAt) || b.arrivedAt,
            received: b.received, remainder: b.remainder,
            lengthM: b.lengthM, remainderM: b.remainderM
        };
        this.remainderTouched = true; // у существующей партии остаток уже задан
        this.remainderMTouched = true;
        this.render();
    };

    // Автоимя партии, если кладовщик не задал свой ярлык: «<вид> от <дата>».
    AtexIntake.prototype.autoName = function(c) {
        var mat = (this.materials.filter(function(m) { return String(m.id) === String(c.materialId); })[0] || {}).label;
        var date = c.arrivedAt || todayIso();
        return (mat ? mat + ' ' : 'Партия ') + 'от ' + date;
    };

    // ── Рендеринг ──

    AtexIntake.prototype.render = function() {
        if (this.listEl) this.renderList();
        this.renderForm();
    };

    AtexIntake.prototype.renderFilters = function() {
        if (!this.filtersEl || this.filtersRendered) return;
        var self = this;
        this.filtersRendered = true;
        this.filtersEl.innerHTML = '';

        var materialRef = this.refSelect({
            id: 'atex-in-filter-material',
            options: this.materials,
            value: this.filters.materialId,
            placeholder: 'Все виды сырья',
            reqId: reqIdByName(this.meta.batch, BATCH_REQ.material),
            onChange: function(value) {
                self.filters.materialId = value || '';
                self.scheduleBatchReload(0);
            }
        });
        this.filtersEl.appendChild(filterField('Вид сырья', materialRef));

        var barcodeInput = el('input', {
            class: 'atex-in-input',
            type: 'text',
            autocomplete: 'off',
            inputmode: 'text',
            placeholder: 'Штрих-код'
        });
        barcodeInput.value = this.filters.barcode || '';
        barcodeInput.addEventListener('input', function() {
            self.filters.barcode = barcodeInput.value;
            self.scheduleBatchReload(250);
        });
        this.filtersEl.appendChild(filterField('Штрих-код', barcodeInput));

        var dateInput = el('input', { class: 'atex-in-input', type: 'date' });
        dateInput.value = toIsoDate(this.filters.arrivedAt) || '';
        dateInput.addEventListener('input', function() {
            self.filters.arrivedAt = dateInput.value;
            self.scheduleBatchReload(0);
        });
        this.filtersEl.appendChild(filterField('Дата прихода', dateInput));

        var reset = el('button', { class: 'atex-in-btn atex-in-btn-secondary atex-in-filter-reset', type: 'button', text: 'Сбросить' });
        reset.addEventListener('click', function() {
            self.filters = { materialId: '', barcode: '', arrivedAt: '' };
            self.filtersRendered = false;
            self.renderFilters();
            self.scheduleBatchReload(0);
        });
        this.filtersEl.appendChild(el('div', { class: 'atex-in-filter-action' }, [reset]));

        function filterField(label, control) {
            return el('div', { class: 'atex-in-filter-field' }, [
                el('label', { class: 'atex-in-filter-label', text: label }),
                control
            ]);
        }
    };

    AtexIntake.prototype.renderList = function() {
        var self = this;
        var box = this.listEl;
        box.innerHTML = '';

        var s = summarize(this.batches);
        this.summaryEl.innerHTML = '';
        this.summaryEl.appendChild(metric('Партий', s.count));
        this.summaryEl.appendChild(metric('Получено, м²', s.totalReceived));
        this.summaryEl.appendChild(metric('Остаток, м²', s.totalRemaining));

        if (!this.batches.length) {
            box.appendChild(el('div', {
                class: 'atex-in-empty',
                text: hasBatchFilters(this.filters) ? 'Партий по фильтрам не найдено' : 'Партий сырья пока нет'
            }));
            return;
        }
        // Шапка таблицы FIFO.
        box.appendChild(el('div', { class: 'atex-in-row atex-in-row-head' }, [
            el('span', { text: '№' }),
            el('span', { text: 'Вид сырья' }),
            el('span', { text: 'Штрих-код' }),
            el('span', { text: 'Дата прихода' }),
            el('span', { text: 'Получено, м²' }),
            el('span', { text: 'Остаток, м²' })
        ]));
        this.batches.forEach(function(b, idx) {
            var active = self.current && String(self.current.id) === String(b.id);
            var row = el('button', {
                class: 'atex-in-row atex-in-row-item' + (active ? ' is-active' : ''),
                type: 'button'
            }, [
                el('span', { class: 'atex-in-num', text: String(idx + 1) }),
                el('span', { text: b.materialLabel || b.name || ('#' + b.id) }),
                el('span', { class: 'atex-in-code', text: b.barcode || '—' }),
                el('span', { text: toIsoDate(b.arrivedAt) || b.arrivedAt || '—' }),
                el('span', { class: 'atex-in-amount', text: String(b.received || '—') }),
                el('span', { class: 'atex-in-amount', text: String(b.remainder || '—') })
            ]);
            row.addEventListener('click', function() { self.openBatch(b.id); });
            box.appendChild(row);
        });

        function metric(label, value) {
            return el('div', { class: 'atex-in-metric' }, [
                el('span', { class: 'atex-in-metric-label', text: label }),
                el('span', { class: 'atex-in-metric-value', text: String(value) })
            ]);
        }
    };

    AtexIntake.prototype.renderForm = function() {
        var self = this;
        var c = this.current || {};
        var form = this.formEl;
        form.innerHTML = '';

        form.appendChild(el('h2', { class: 'atex-in-form-title', text: c.id ? ('Партия: ' + (c.name || '#' + c.id)) : 'Оприходовать партию сырья' }));

        // Вид сырья (ссылка)
        var materialRef = this.refSelect({
            id: 'atex-in-material',
            options: this.materials,
            value: c.materialId,
            placeholder: '— не выбрано —',
            reqId: reqIdByName(this.meta.batch, BATCH_REQ.material),
            onChange: function(value) {
                c.materialId = value || null;
                // подставляем дефолт длины только если длина ещё не задана (вручную не трогали)
                if (!self.remainderMTouched && (c.lengthM === '' || c.lengthM == null)) {
                    var def = calc.materialDefaultLength(self.materials, c.materialId);
                    if (def > 0) {
                        c.lengthM = String(def);
                        c.remainderM = String(def);
                        if (self.lengthInput) self.lengthInput.value = c.lengthM;
                        if (self.remainderMInput) self.remainderMInput.value = c.remainderM;
                    }
                }
            }
        });
        form.appendChild(field('Вид сырья', materialRef));

        // Штрих-код — короткая строка для сканера barcode-reader.
        var barcodeInput = el('input', {
            class: 'atex-in-input',
            type: 'text',
            autocomplete: 'off',
            inputmode: 'text',
            maxlength: '127',
            placeholder: 'Отсканируйте или введите'
        });
        barcodeInput.value = c.barcode == null ? '' : c.barcode;
        barcodeInput.addEventListener('input', function() { c.barcode = barcodeInput.value; });
        form.appendChild(field('Штрих-код', barcodeInput));

        // Дата прихода
        var dateInput = el('input', { class: 'atex-in-input', type: 'date' });
        dateInput.value = toIsoDate(c.arrivedAt) || c.arrivedAt || '';
        dateInput.addEventListener('input', function() { c.arrivedAt = dateInput.value; });
        form.appendChild(field('Дата прихода', dateInput));

        // Получено, м² — при вводе автоматически инициализирует остаток (если
        // его ещё не правили вручную): критерий приёмки #2914.
        var recInput = el('input', { class: 'atex-in-input', type: 'number', min: '0', step: 'any', placeholder: '0' });
        recInput.value = c.received == null ? '' : c.received;
        recInput.addEventListener('input', function() {
            c.received = recInput.value;
            if (!self.remainderTouched) {
                c.remainder = recInput.value;
                if (self.remainderInput) self.remainderInput.value = recInput.value;
            }
        });
        form.appendChild(field('Получено, м²', recInput));

        // Длина, м — метраж джамбо. Дефолт из «Длина рулона, м» вида сырья.
        var lenInput = el('input', { class: 'atex-in-input', type: 'number', min: '0', step: 'any', placeholder: '0' });
        lenInput.value = c.lengthM == null ? '' : c.lengthM;
        lenInput.addEventListener('input', function() {
            c.lengthM = lenInput.value;
            if (!self.remainderMTouched) {
                c.remainderM = lenInput.value;
                if (self.remainderMInput) self.remainderMInput.value = lenInput.value;
            }
        });
        this.lengthInput = lenInput;
        form.appendChild(field('Длина, м', lenInput, 'Метраж рулона Jumbo Roll'));

        // Остаток, м — по умолчанию = длине; правка фиксирует ручной режим.
        var remMInput = el('input', { class: 'atex-in-input', type: 'number', min: '0', step: 'any', placeholder: '0' });
        remMInput.value = c.remainderM == null ? '' : c.remainderM;
        remMInput.addEventListener('input', function() {
            c.remainderM = remMInput.value;
            self.remainderMTouched = true;
        });
        this.remainderMInput = remMInput;
        form.appendChild(field('Остаток, м', remMInput, 'Инициализируется значением «Длина, м»'));

        // Остаток, м² — по умолчанию = получено; правка фиксирует ручной режим.
        var remInput = el('input', { class: 'atex-in-input', type: 'number', min: '0', step: 'any', placeholder: '0' });
        remInput.value = c.remainder == null ? '' : c.remainder;
        remInput.addEventListener('input', function() {
            c.remainder = remInput.value;
            self.remainderTouched = true;
        });
        this.remainderInput = remInput;
        form.appendChild(field('Остаток, м²', remInput, 'Инициализируется значением «Получено, м²»'));

        // Кнопки
        var actions = el('div', { class: 'atex-in-actions' });
        var saveBtn = el('button', { class: 'atex-in-btn atex-in-btn-primary', type: 'button', text: c.id ? 'Сохранить' : 'Оприходовать' });
        saveBtn.addEventListener('click', function() { self.save(); });
        var newBtn = el('button', { class: 'atex-in-btn atex-in-btn-secondary', type: 'button', text: 'Новая партия' });
        newBtn.addEventListener('click', function() { self.newBatch(); self.render(); });
        actions.appendChild(saveBtn);
        actions.appendChild(newBtn);
        form.appendChild(actions);

        function field(label, control, hint) {
            return el('div', { class: 'atex-in-field' }, [
                el('label', { class: 'atex-in-label', text: label }),
                control,
                hint ? el('div', { class: 'atex-in-hint', text: hint }) : null
            ]);
        }
    };

    // ── Сохранение ──

    AtexIntake.prototype.save = function() {
        var self = this;
        if (this.busy) return;
        var c = this.current;
        if (!c) return;
        if (!c.materialId) { this.notify('Выберите вид сырья', 'error'); return; }
        if (String(c.received).trim() === '') { this.notify('Укажите «Получено, м²»', 'error'); return; }

        var meta = this.meta.batch;
        var name = String(c.name || '').trim() || this.autoName(c);
        var fields = buildBatchFields(meta, c);

        this.setBusy(true);
        var chain;
        if (c.id) {
            // Правка: имя — _m_save (первая колонка), реквизиты — _m_set.
            chain = this.post('_m_save/' + c.id + '?JSON', { val: name })
                .then(function() { return self.post('_m_set/' + c.id + '?JSON', fields); })
                .then(function() { return c.id; });
        } else {
            // Создание: главное значение — t{batchTableId}; реквизиты — здесь же.
            var createParams = {};
            Object.keys(fields).forEach(function(k) { createParams[k] = fields[k]; });
            createParams['t' + meta.id] = name;
            chain = this.post('_m_new/' + meta.id + '?JSON&up=1', createParams).then(function(res) {
                var id = res && (res.obj || res.id || res.i);
                if (!id) throw new Error('Сервер не вернул id новой партии');
                c.id = String(id);
                return c.id;
            });
        }

        chain.then(function() {
            return self.loadBatches();
        }).then(function() {
            self.setBusy(false);
            self.notify('Партия сырья оприходована', 'success');
            self.newBatch();
            self.render();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка сохранения: ' + err.message, 'error');
        });
    };

    AtexIntake.prototype.setBusy = function(on) {
        this.busy = on;
        if (this.root) this.root.classList.toggle('is-busy', !!on);
    };

    // Уведомления без alert/confirm/prompt (раздел 8 гайда): встроенный тост,
    // либо общий MainAppController, если он доступен в main.html.
    AtexIntake.prototype.notify = function(message, kind) {
        if (kind === 'error' && typeof window !== 'undefined' && window.mainAppController &&
            typeof window.mainAppController.showErrorModal === 'function') {
            window.mainAppController.showErrorModal(message);
            return;
        }
        var toast = el('div', { class: 'atex-in-toast atex-in-toast-' + (kind || 'info'), text: message });
        (this.toastHost || document.body).appendChild(toast);
        setTimeout(function() { toast.classList.add('is-visible'); }, 10);
        setTimeout(function() {
            toast.classList.remove('is-visible');
            setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
        }, 3500);
    };

    AtexIntake.prototype.fatal = function(message) {
        this.root.innerHTML = '';
        this.root.appendChild(el('div', { class: 'atex-in-fatal', text: message }));
    };

    AtexIntake.prototype.start = function() {
        var self = this;
        // Каркас разметки.
        this.root.innerHTML = '';
        var layout = el('div', { class: 'atex-in-layout' });
        var aside = el('aside', { class: 'atex-in-sidebar' }, [
            el('div', { class: 'atex-in-sidebar-head' }, [
                el('h2', { text: 'Партии сырья (FIFO)' })
            ])
        ]);
        this.filtersEl = el('div', { class: 'atex-in-filters' });
        aside.appendChild(this.filtersEl);
        this.summaryEl = el('div', { class: 'atex-in-summary' });
        aside.appendChild(this.summaryEl);
        this.listEl = el('div', { class: 'atex-in-list' });
        aside.appendChild(this.listEl);
        this.formEl = el('section', { class: 'atex-in-form' });
        layout.appendChild(aside);
        layout.appendChild(this.formEl);
        this.root.appendChild(layout);
        this.toastHost = this.root;

        this.newBatch();
        this.formEl.appendChild(el('div', { class: 'atex-in-loading', text: 'Загрузка…' }));

        return this.loadMetadata()
            .then(function() { return Promise.all([self.loadMaterials(), self.loadBatches()]); })
            .then(function() { self.renderFilters(); self.render(); })
            .catch(function(err) { self.fatal('Ошибка инициализации: ' + err.message); });
    };

    function init() {
        if (typeof document === 'undefined') return;
        var root = document.getElementById('atex-intake');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        var controller = new AtexIntake(root);
        root._atexIntake = controller;
        controller.start();
    }

    var helpers = {
        reqIdByName: reqIdByName,
        columnIndex: columnIndex,
        parseRef: parseRef,
        hasBatchFilters: hasBatchFilters,
        buildBatchListPath: buildBatchListPath,
        mapBatchRecord: mapBatchRecord,
        buildBatchFields: buildBatchFields
    };

    return { calc: calc, helpers: helpers, Controller: AtexIntake, init: init };
});
