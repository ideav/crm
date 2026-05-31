// Рабочее место atex «Пульт слиттера» (роль Оператор, планшет).
//
// По назначенной производственной резке оператор: меняет статус
// (Ожидает → Наладка → В работе → Завершён), вводит показания счётчика
// (нач./кон.), погонаж факт и брак; списывает расход сырья по партиям (FIFO),
// что уменьшает остаток партии; фиксирует события смены с датой/временем.
// Решение задачи ideav/crm#2915 (часть #2903). Правила разработки рабочих мест —
// docs/WORKSPACE_DEVELOPMENT_GUIDE.md, карта рабочих мест — docs/atex_workplaces.md §3.5.
//
// На этом этапе рабочее место обращается к данным напрямую командами `_m_*`
// (#2903): статус/счётчики/погонаж/брак — `_m_set/{резкаId}`; расход —
// `_m_new/{Расход сырья}` с `up={резкаId}` (и `_m_set` остатка партии); событие —
// `_m_new/{Событие смены}`; список «мои резки» — `object/{Производственная резка}/`
// с фильтром по слиттеру/статусу. ID таблиц и реквизитов не хардкодятся: они
// берутся по именам из `GET /{db}/metadata` (WORKSPACE_DEVELOPMENT_GUIDE.md,
// разделы 3 и 6). Перевод чтений на защищённый слой `report/` — следующий этап и
// в объём этой задачи не входит.
//
// Чистое ядро (цепочка статусов, FIFO-подбор партий, списание остатка, погонаж
// из счётчиков, формат даты события) вынесено в объект `core` и экспортируется
// через module.exports для модульных тестов (experiments/atex-slitter.test.js).

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.AtexSlitter = api;
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
        consumption: 'Расход сырья',
        event: 'Событие смены',
        batch: 'Партия сырья'
    };
    var CUT_REQ = {
        slitter: 'Слиттер',
        cutType: 'Тип резки',
        batch: 'Партия сырья',
        planDate: 'Дата план',
        status: 'Статус',
        counterStart: 'Счётчик нач.',
        counterEnd: 'Счётчик кон.',
        meterage: 'Погонаж факт, м',
        defect: 'Брак, м²',
        notes: 'Примечания'
    };
    var CONS_REQ = { amount: 'Израсходовано, м²', batch: 'Партия сырья' };
    var EVENT_REQ = { type: 'Тип события', cut: 'Производственная резка', user: 'Пользователь', value: 'Значение', notes: 'Примечания' };
    var BATCH_REQ = { kind: 'Вид сырья', date: 'Дата прихода', received: 'Получено, м²', remainder: 'Остаток, м²' };

    // Статусы резки по дизайн-спеке atex (§3.5): жёсткая цепочка переходов.
    var STATUSES = ['Ожидает', 'Наладка', 'В работе', 'Завершён'];
    // Типы событий смены (дизайн-спека atex, «Событие смены»).
    var EVENT_TYPES = ['Начало смены', 'Запуск резки', 'Обед', 'Переналадка', 'Счётчик', 'Брак', 'Конец смены'];

    // ───────────────────────── Чистое ядро ─────────────────────────

    // Терпимый разбор числа: принимает запятую как десятичный разделитель,
    // отбрасывает пробелы; «пусто»/мусор → 0.
    function toNumber(value) {
        if (typeof value === 'number') return isFinite(value) ? value : 0;
        var text = String(value == null ? '' : value).replace(/\s+/g, '').replace(',', '.');
        var n = parseFloat(text);
        return isFinite(n) ? n : 0;
    }

    function round3(n) {
        return Math.round(n * 1000) / 1000;
    }

    // Приведение статуса к одному из известных; неизвестное возвращается как есть
    // (значение «Статус» — свободный текст, сохраняем без потерь).
    function normalizeStatus(status) {
        var s = String(status == null ? '' : status).trim();
        if (!s) return STATUSES[0];
        for (var i = 0; i < STATUSES.length; i++) {
            if (STATUSES[i].toLowerCase() === s.toLowerCase()) return STATUSES[i];
        }
        return s;
    }

    // Следующий статус в цепочке Ожидает → Наладка → В работе → Завершён.
    // На финальном (или неизвестном) статусе возвращает текущий — двигаться некуда.
    function nextStatus(status) {
        var s = normalizeStatus(status);
        var idx = STATUSES.indexOf(s);
        if (idx === -1 || idx === STATUSES.length - 1) return s;
        return STATUSES[idx + 1];
    }

    // Резка завершена?
    function isDone(status) {
        return normalizeStatus(status) === STATUSES[STATUSES.length - 1];
    }

    // Погонаж из показаний счётчика: кон. − нач., не меньше нуля (счётчик не
    // мотает назад; при пустом/обратном вводе подсказка = 0).
    function meterageFromCounters(start, end) {
        return round3(Math.max(0, toNumber(end) - toNumber(start)));
    }

    // Сумма израсходованного по строкам расхода (для сводки по резке).
    function sumConsumption(rows) {
        var total = 0;
        (rows || []).forEach(function(r) { total += toNumber(r.amount); });
        return round3(total);
    }

    // Сортировка партий по дате прихода (FIFO: раньше пришло — раньше расходуем).
    // Стабильная: при равных датах сохраняет исходный порядок.
    function sortFifo(batches) {
        return (batches || []).map(function(b, i) { return { b: b, i: i }; })
            .sort(function(a, c) {
                var da = String(a.b.date || '');
                var dc = String(c.b.date || '');
                if (da < dc) return -1;
                if (da > dc) return 1;
                return a.i - c.i;
            })
            .map(function(x) { return x.b; });
    }

    // Партия по умолчанию для нового расхода: первая по FIFO с положительным
    // остатком. Если таких нет — null (нечего списывать).
    function pickFifoBatch(batches) {
        var ordered = sortFifo(batches);
        for (var i = 0; i < ordered.length; i++) {
            if (toNumber(ordered[i].remainder) > 0) return ordered[i];
        }
        return null;
    }

    // Новый остаток партии после списания: остаток − израсходовано, не ниже нуля.
    function applyConsumption(remainder, consumed) {
        return round3(Math.max(0, toNumber(remainder) - toNumber(consumed)));
    }

    // Возврат остатка при отмене/уменьшении расхода: остаток + возвращаемое.
    function restoreConsumption(remainder, restored) {
        return round3(toNumber(remainder) + toNumber(restored));
    }

    // Дата-время события смены в формате «YYYY-MM-DD HH:MM:SS» (хронология,
    // первая колонка «Событие смены»). Принимает Date — детерминируется в тестах.
    function formatDateTime(date) {
        var d = (date instanceof Date) ? date : new Date(date);
        function p(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
            ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }

    var core = {
        STATUSES: STATUSES,
        EVENT_TYPES: EVENT_TYPES,
        toNumber: toNumber,
        round3: round3,
        normalizeStatus: normalizeStatus,
        nextStatus: nextStatus,
        isDone: isDone,
        meterageFromCounters: meterageFromCounters,
        sumConsumption: sumConsumption,
        sortFifo: sortFifo,
        pickFifoBatch: pickFifoBatch,
        applyConsumption: applyConsumption,
        restoreConsumption: restoreConsumption,
        formatDateTime: formatDateTime
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

    // Значение реквизита из метаданных по имени → его числовой id (t{id}).
    function reqIdByName(meta, name) {
        var found = (meta && meta.reqs || []).filter(function(r) {
            return String(r.val).trim().toLowerCase() === String(name).trim().toLowerCase();
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

    function AtexSlitter(root) {
        this.root = root;
        this.db = window.db || root.getAttribute('data-db') || '';
        this.userId = root.getAttribute('data-user-id') || '';
        this.meta = { cut: null, consumption: null, event: null, batch: null };
        this.batches = [];        // справочник партий сырья [{ id, label, date, remainder }]
        this.refOptions = {};     // кеш опций searchable reference inputs по reqId
        this.cuts = [];           // производственные резки [{ id, label, status, slitter, cutType }]
        this.currentCutId = null; // выбранная резка
        this.currentCut = null;   // полная запись выбранной резки
        this.consumptions = [];   // расход сырья выбранной резки
        this.events = [];         // события смены выбранной резки
        this.hideDone = false;    // фильтр «скрыть завершённые»
        this.busy = false;
    }

    AtexSlitter.prototype.url = function(path) {
        return '/' + encodeURIComponent(this.db) + '/' + path;
    };

    // GET → JSON. Бросает Error при сетевой/JSON-ошибке.
    AtexSlitter.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                try { return JSON.parse(text); }
                catch (e) { throw new Error('Некорректный JSON: ' + text.slice(0, 200)); }
            });
        });
    };

    AtexSlitter.prototype.loadRefOptions = function(reqId, query, limit) {
        return this.getJson(window.AtexRefSearch.buildRefOptionsPath(reqId, query, limit));
    };

    AtexSlitter.prototype.refSelect = function(opts) {
        var self = this;
        var helper = (typeof window !== 'undefined' && window.AtexRefSearch) || null;
        if (helper && typeof helper.createSelect === 'function') {
            return helper.createSelect({
                classPrefix: 'atex-sl',
                inputClass: 'atex-sl-input',
                options: opts.options || [],
                value: opts.value,
                placeholder: opts.placeholder,
                reqId: opts.reqId,
                cache: this.refOptions,
                loadOptions: function(reqId, query, limit) { return self.loadRefOptions(reqId, query, limit); },
                onChange: opts.onChange
            });
        }

        var nativeSelect = el('select', { class: 'atex-sl-input' });
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
    AtexSlitter.prototype.post = function(path, params) {
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

    AtexSlitter.prototype.loadMetadata = function() {
        var self = this;
        return this.getJson('metadata').then(function(all) {
            var list = Array.isArray(all) ? all : [all];
            function byName(name) {
                return list.filter(function(t) {
                    return String(t.val).trim().toLowerCase() === name.trim().toLowerCase();
                })[0] || null;
            }
            self.meta.cut = byName(TABLE.cut);
            self.meta.consumption = byName(TABLE.consumption);
            self.meta.event = byName(TABLE.event);
            self.meta.batch = byName(TABLE.batch);
            if (!self.meta.cut) throw new Error('В метаданных не найдена таблица «' + TABLE.cut + '»');
            if (!self.meta.consumption) throw new Error('В метаданных не найдена таблица «' + TABLE.consumption + '»');
        });
    };

    AtexSlitter.prototype.loadBatches = function() {
        var self = this;
        var meta = this.meta.batch;
        if (!meta) { this.batches = []; return Promise.resolve(); }
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            var dateIdx = colIndex(meta, BATCH_REQ.date);
            var remIdx = colIndex(meta, BATCH_REQ.remainder);
            self.batches = (rows || []).map(function(r) {
                var row = r.r || [];
                return {
                    id: String(r.i),
                    label: row[0] || ('Партия #' + r.i),
                    date: dateIdx >= 0 ? (row[dateIdx] || '') : '',
                    remainder: remIdx >= 0 ? core.toNumber(row[remIdx]) : 0
                };
            });
        });
    };

    AtexSlitter.prototype.loadCuts = function() {
        var self = this;
        var meta = this.meta.cut;
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            var statusIdx = colIndex(meta, CUT_REQ.status);
            var slitterIdx = colIndex(meta, CUT_REQ.slitter);
            var cutTypeIdx = colIndex(meta, CUT_REQ.cutType);
            self.cuts = (rows || []).map(function(r) {
                var row = r.r || [];
                return {
                    id: String(r.i),
                    label: 'Резка №' + (row[0] || r.i),
                    status: statusIdx >= 0 ? core.normalizeStatus(row[statusIdx]) : STATUSES[0],
                    slitter: slitterIdx >= 0 ? parseRef(row[slitterIdx]).label : '',
                    cutType: cutTypeIdx >= 0 ? parseRef(row[cutTypeIdx]).label : ''
                };
            });
        });
    };

    // Полная запись выбранной резки (значения полей для формы).
    AtexSlitter.prototype.loadCut = function(cutId) {
        var self = this;
        var meta = this.meta.cut;
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&F_I=' + encodeURIComponent(cutId) + '&LIMIT=0,1').then(function(rows) {
            var rec = (rows || [])[0];
            if (!rec) throw new Error('Резка не найдена');
            var row = rec.r || [];
            function val(name) { var i = colIndex(meta, name); return i >= 0 ? (row[i] || '') : ''; }
            self.currentCut = {
                id: String(rec.i),
                number: row[0] || '',
                label: 'Резка №' + (row[0] || rec.i),
                slitter: parseRef(val(CUT_REQ.slitter)).label,
                cutType: parseRef(val(CUT_REQ.cutType)).label,
                batch: parseRef(val(CUT_REQ.batch)).label,
                planDate: val(CUT_REQ.planDate),
                status: core.normalizeStatus(val(CUT_REQ.status)),
                counterStart: val(CUT_REQ.counterStart),
                counterEnd: val(CUT_REQ.counterEnd),
                meterage: val(CUT_REQ.meterage),
                defect: val(CUT_REQ.defect),
                notes: val(CUT_REQ.notes)
            };
        });
    };

    // ── Чтение расхода сырья (подчинён резке) ──

    AtexSlitter.prototype.loadConsumptions = function(cutId) {
        var self = this;
        var meta = this.meta.consumption;
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(cutId) + '&LIMIT=0,1000').then(function(rows) {
            var amountIdx = colIndex(meta, CONS_REQ.amount);
            var batchIdx = colIndex(meta, CONS_REQ.batch);
            self.consumptions = (rows || []).map(function(rec) {
                var r = rec.r || [];
                var batchRef = batchIdx >= 0 ? parseRef(r[batchIdx]) : { id: null };
                var amount = amountIdx >= 0 ? (r[amountIdx] || '') : '';
                return {
                    id: String(rec.i),
                    name: r[0] || '',
                    batchId: batchRef.id,
                    amount: amount,
                    savedAmount: core.toNumber(amount) // для дельты остатка при правке
                };
            });
        });
    };

    AtexSlitter.prototype.blankConsumption = function() {
        var fifo = core.pickFifoBatch(this.batches);
        return { id: null, name: '', batchId: fifo ? fifo.id : null, amount: '', savedAmount: 0 };
    };

    // ── Чтение событий смены (самостоятельная таблица, фильтр по ссылке клиентски) ──

    AtexSlitter.prototype.loadEvents = function(cutId) {
        var self = this;
        var meta = this.meta.event;
        if (!meta) { this.events = []; return Promise.resolve(); }
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            var typeIdx = colIndex(meta, EVENT_REQ.type);
            var cutIdx = colIndex(meta, EVENT_REQ.cut);
            var valIdx = colIndex(meta, EVENT_REQ.value);
            var notesIdx = colIndex(meta, EVENT_REQ.notes);
            self.events = (rows || []).map(function(rec) {
                var r = rec.r || [];
                return {
                    id: String(rec.i),
                    when: r[0] || '',
                    type: typeIdx >= 0 ? (r[typeIdx] || '') : '',
                    cutId: cutIdx >= 0 ? parseRef(r[cutIdx]).id : null,
                    value: valIdx >= 0 ? (r[valIdx] || '') : '',
                    notes: notesIdx >= 0 ? (r[notesIdx] || '') : ''
                };
            }).filter(function(ev) {
                return String(ev.cutId) === String(cutId);
            }).sort(function(a, b) {
                return String(b.when).localeCompare(String(a.when)); // новые сверху
            });
        });
    };

    // ── Рендеринг ──

    AtexSlitter.prototype.render = function() {
        this.renderCuts();
        this.renderMain();
    };

    AtexSlitter.prototype.visibleCuts = function() {
        var self = this;
        return this.cuts.filter(function(c) { return !self.hideDone || !core.isDone(c.status); });
    };

    AtexSlitter.prototype.renderCuts = function() {
        var self = this;
        var box = this.cutsEl;
        if (!box) return;
        box.innerHTML = '';
        var list = this.visibleCuts();
        if (!list.length) {
            box.appendChild(el('div', { class: 'atex-sl-empty', text: 'Резок пока нет' }));
            return;
        }
        list.forEach(function(cut) {
            var active = String(self.currentCutId) === String(cut.id);
            var item = el('button', {
                class: 'atex-sl-cut-item' + (active ? ' is-active' : ''),
                type: 'button'
            }, [
                el('div', { class: 'atex-sl-cut-main' }, [
                    el('span', { class: 'atex-sl-cut-label', text: cut.label }),
                    el('span', { class: 'atex-sl-cut-sub', text: [cut.slitter, cut.cutType].filter(Boolean).join(' · ') })
                ]),
                el('span', { class: 'atex-sl-badge ' + badgeClass(cut.status), text: cut.status })
            ]);
            item.addEventListener('click', function() { self.openCut(cut.id); });
            box.appendChild(item);
        });
    };

    function badgeClass(status) {
        if (core.isDone(status)) return 'atex-sl-badge-done';
        if (core.normalizeStatus(status) === 'В работе') return 'atex-sl-badge-run';
        if (core.normalizeStatus(status) === 'Наладка') return 'atex-sl-badge-setup';
        return 'atex-sl-badge-wait';
    }

    AtexSlitter.prototype.renderMain = function() {
        var host = this.mainEl;
        if (!host) return;
        host.innerHTML = '';

        if (!this.currentCutId || !this.currentCut) {
            host.appendChild(el('div', { class: 'atex-sl-placeholder', text: 'Выберите производственную резку слева, чтобы вести её на пульте.' }));
            return;
        }

        host.appendChild(this.renderHead());
        host.appendChild(this.renderStatusBar());
        host.appendChild(this.renderReadings());
        host.appendChild(this.renderConsumption());
        host.appendChild(this.renderEvents());
    };

    AtexSlitter.prototype.renderHead = function() {
        var cut = this.currentCut;
        var meta = [];
        if (cut.slitter) meta.push('Слиттер: ' + cut.slitter);
        if (cut.cutType) meta.push('Тип резки: ' + cut.cutType);
        if (cut.batch) meta.push('Партия: ' + cut.batch);
        if (cut.planDate) meta.push('План: ' + cut.planDate);
        return el('div', { class: 'atex-sl-head' }, [
            el('div', {}, [
                el('h2', { class: 'atex-sl-head-title', text: cut.label }),
                el('div', { class: 'atex-sl-head-meta', text: meta.join('   •   ') })
            ]),
            el('span', { class: 'atex-sl-badge ' + badgeClass(cut.status), text: cut.status })
        ]);
    };

    // Полоса статусов: цепочка-степпер + кнопка перехода на следующий статус.
    AtexSlitter.prototype.renderStatusBar = function() {
        var self = this;
        var cut = this.currentCut;
        var bar = el('section', { class: 'atex-sl-section' }, [
            el('h3', { class: 'atex-sl-section-title', text: 'Статус резки' })
        ]);

        var steps = el('div', { class: 'atex-sl-steps' });
        var curIdx = core.STATUSES.indexOf(core.normalizeStatus(cut.status));
        // Каждый шаг — кликабельная кнопка установки статуса.
        core.STATUSES.forEach(function(st, i) {
            var cls = 'atex-sl-step';
            if (i < curIdx) cls += ' is-past';
            else if (i === curIdx) cls += ' is-current';
            var btn = el('button', { class: cls, type: 'button', text: st });
            btn.addEventListener('click', function() { self.setStatus(st); });
            steps.appendChild(btn);
        });
        bar.appendChild(steps);

        var actions = el('div', { class: 'atex-sl-section-actions' });
        if (!core.isDone(cut.status)) {
            var next = core.nextStatus(cut.status);
            var advance = el('button', { class: 'atex-sl-btn atex-sl-btn-advance', type: 'button', text: '→ ' + next });
            advance.addEventListener('click', function() { self.setStatus(next); });
            actions.appendChild(advance);
        } else {
            actions.appendChild(el('span', { class: 'atex-sl-muted', text: 'Резка завершена' }));
        }
        bar.appendChild(actions);
        return bar;
    };

    // Показания счётчика, погонаж, брак, примечания + сохранение в резку.
    AtexSlitter.prototype.renderReadings = function() {
        var self = this;
        var cut = this.currentCut;
        var section = el('section', { class: 'atex-sl-section' }, [
            el('h3', { class: 'atex-sl-section-title', text: 'Показания и выработка' })
        ]);

        var grid = el('div', { class: 'atex-sl-grid' });

        var cStart = numInput(cut.counterStart, '0');
        cStart.addEventListener('input', function() { cut.counterStart = cStart.value; updateHint(); });
        grid.appendChild(field('Счётчик нач.', cStart));

        var cEnd = numInput(cut.counterEnd, '0');
        cEnd.addEventListener('input', function() { cut.counterEnd = cEnd.value; updateHint(); });
        grid.appendChild(field('Счётчик кон.', cEnd));

        var meterage = numInput(cut.meterage, '0');
        meterage.addEventListener('input', function() { cut.meterage = meterage.value; });
        var meterField = field('Погонаж факт, м', meterage);
        var hint = el('button', { class: 'atex-sl-hint', type: 'button' });
        meterField.appendChild(hint);
        grid.appendChild(meterField);

        var defect = numInput(cut.defect, '0');
        defect.addEventListener('input', function() { cut.defect = defect.value; });
        grid.appendChild(field('Брак, м²', defect));

        section.appendChild(grid);

        var notes = el('textarea', { class: 'atex-sl-input atex-sl-textarea', rows: '2', placeholder: 'Примечания' });
        notes.value = cut.notes || '';
        notes.addEventListener('input', function() { cut.notes = notes.value; });
        section.appendChild(field('Примечания', notes));

        var actions = el('div', { class: 'atex-sl-section-actions' });
        var saveBtn = el('button', { class: 'atex-sl-btn atex-sl-btn-primary', type: 'button', text: 'Сохранить показания' });
        saveBtn.addEventListener('click', function() { self.saveReadings(); });
        actions.appendChild(saveBtn);
        section.appendChild(actions);

        updateHint();
        return section;

        // Подсказка «погонаж из счётчиков»: показывает разницу кон.−нач. и
        // по клику подставляет её в поле погонажа.
        function updateHint() {
            var suggested = core.meterageFromCounters(cut.counterStart, cut.counterEnd);
            hint.textContent = 'из счётчиков: ' + suggested + ' м';
            hint.onclick = function() { cut.meterage = String(suggested); meterage.value = suggested; };
        }
    };

    // Расход сырья: список строк, FIFO-подсказка партии, списание остатка.
    AtexSlitter.prototype.renderConsumption = function() {
        var self = this;
        var section = el('section', { class: 'atex-sl-section' }, [
            el('h3', { class: 'atex-sl-section-title', text: 'Расход сырья (FIFO)' })
        ]);

        var total = core.sumConsumption(this.consumptions);
        section.appendChild(el('div', { class: 'atex-sl-muted', text: 'Списано всего: ' + total + ' м²' }));

        var listWrap = el('div', { class: 'atex-sl-rows' });
        if (!this.consumptions.length) {
            listWrap.appendChild(el('div', { class: 'atex-sl-empty', text: 'Расхода пока нет — добавьте списание.' }));
        } else {
            this.consumptions.forEach(function(row, idx) { listWrap.appendChild(self.renderConsumptionRow(row, idx)); });
        }
        section.appendChild(listWrap);

        var addBtn = el('button', { class: 'atex-sl-btn atex-sl-btn-add', type: 'button', text: '+ Списать партию' });
        addBtn.addEventListener('click', function() { self.consumptions.push(self.blankConsumption()); self.renderMain(); });
        section.appendChild(addBtn);
        return section;
    };

    AtexSlitter.prototype.renderConsumptionRow = function(row, idx) {
        var self = this;
        var card = el('div', { class: 'atex-sl-row' });

        var batchOptions = core.sortFifo(this.batches).map(function(b) {
            return { id: b.id, label: b.label + ' — остаток ' + core.round3(b.remainder) + ' м²' };
        });
        var batchRef = this.refSelect({
            options: batchOptions,
            value: row.batchId,
            placeholder: '— партия сырья —',
            reqId: reqIdByName(this.meta.consumption, CONS_REQ.batch),
            onChange: function(value) { row.batchId = value || null; }
        });
        card.appendChild(field('Партия сырья', batchRef));

        var amount = numInput(row.amount, '0');
        amount.addEventListener('input', function() { row.amount = amount.value; });
        card.appendChild(field('Израсходовано, м²', amount));

        var actions = el('div', { class: 'atex-sl-row-actions' });
        var saveBtn = el('button', { class: 'atex-sl-btn atex-sl-btn-primary', type: 'button', text: 'Списать' });
        saveBtn.addEventListener('click', function() { self.saveConsumption(row); });
        actions.appendChild(saveBtn);
        var delBtn = el('button', { class: 'atex-sl-btn atex-sl-btn-del', type: 'button', title: 'Удалить списание', text: '×' });
        delBtn.addEventListener('click', function() { self.deleteConsumption(row, idx); });
        actions.appendChild(delBtn);
        card.appendChild(actions);
        return card;
    };

    // События смены: быстрое добавление + хронология последних событий.
    AtexSlitter.prototype.renderEvents = function() {
        var self = this;
        var section = el('section', { class: 'atex-sl-section' }, [
            el('h3', { class: 'atex-sl-section-title', text: 'События смены' })
        ]);

        var form = el('div', { class: 'atex-sl-event-form' });
        var typeSel = el('select', { class: 'atex-sl-input' });
        core.EVENT_TYPES.forEach(function(t) { typeSel.appendChild(el('option', { value: t, text: t })); });
        form.appendChild(field('Тип события', typeSel));

        var valueInp = numInput('', '0');
        form.appendChild(field('Значение', valueInp));

        var noteInp = el('input', { class: 'atex-sl-input', type: 'text', placeholder: 'Примечания' });
        form.appendChild(field('Примечания', noteInp));

        var addBtn = el('button', { class: 'atex-sl-btn atex-sl-btn-primary', type: 'button', text: 'Зафиксировать' });
        addBtn.addEventListener('click', function() {
            self.addEvent({ type: typeSel.value, value: valueInp.value, notes: noteInp.value });
        });
        var addWrap = el('div', { class: 'atex-sl-event-add' }, [addBtn]);
        form.appendChild(addWrap);
        section.appendChild(form);

        var list = el('div', { class: 'atex-sl-events' });
        if (!this.events.length) {
            list.appendChild(el('div', { class: 'atex-sl-empty', text: 'Событий смены ещё нет.' }));
        } else {
            this.events.slice(0, 12).forEach(function(ev) {
                list.appendChild(el('div', { class: 'atex-sl-event' }, [
                    el('span', { class: 'atex-sl-event-when', text: ev.when }),
                    el('span', { class: 'atex-sl-event-type', text: ev.type }),
                    el('span', { class: 'atex-sl-event-val', text: ev.value !== '' ? String(ev.value) : '' }),
                    el('span', { class: 'atex-sl-event-note', text: ev.notes || '' })
                ]));
            });
        }
        section.appendChild(list);
        return section;
    };

    // ── Действия / сохранение ──

    // Реквизиты резки в форме _m_set (t{reqId} по именам из метаданных).
    AtexSlitter.prototype.cutFields = function(cut) {
        var meta = this.meta.cut;
        var fields = {};
        function set(reqName, value) {
            var rid = reqIdByName(meta, reqName);
            if (rid) fields['t' + rid] = value;
        }
        function num(v) { return (v === '' || v == null) ? '' : core.toNumber(v); }
        set(CUT_REQ.status, core.normalizeStatus(cut.status));
        set(CUT_REQ.counterStart, num(cut.counterStart));
        set(CUT_REQ.counterEnd, num(cut.counterEnd));
        set(CUT_REQ.meterage, num(cut.meterage));
        set(CUT_REQ.defect, num(cut.defect));
        set(CUT_REQ.notes, cut.notes || '');
        return fields;
    };

    AtexSlitter.prototype.setStatus = function(status) {
        var self = this;
        var cut = this.currentCut;
        if (this.busy || !cut) return;
        cut.status = core.normalizeStatus(status);
        this.setBusy(true);
        var rid = reqIdByName(this.meta.cut, CUT_REQ.status);
        var fields = {};
        fields['t' + rid] = cut.status;
        this.post('_m_set/' + cut.id + '?JSON', fields).then(function() {
            // Обновим статус и в списке слева.
            self.cuts.forEach(function(c) { if (String(c.id) === String(cut.id)) c.status = cut.status; });
            self.setBusy(false);
            self.notify('Статус: ' + cut.status, 'success');
            self.render();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Не удалось сменить статус: ' + err.message, 'error');
        });
    };

    AtexSlitter.prototype.saveReadings = function() {
        var self = this;
        var cut = this.currentCut;
        if (this.busy || !cut) return;
        this.setBusy(true);
        this.post('_m_set/' + cut.id + '?JSON', this.cutFields(cut)).then(function() {
            self.setBusy(false);
            self.notify('Показания сохранены', 'success');
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка сохранения: ' + err.message, 'error');
        });
    };

    // Списание расхода: создаёт/обновляет «Расход сырья» и уменьшает остаток
    // партии на разницу (дельту) израсходованного — критерий приёмки §3.5.
    AtexSlitter.prototype.saveConsumption = function(row) {
        var self = this;
        if (this.busy) return;
        if (!this.currentCutId) { this.notify('Сначала выберите резку', 'error'); return; }
        if (!row.batchId) { this.notify('Выберите партию сырья', 'error'); return; }
        var amount = core.toNumber(row.amount);
        if (amount <= 0) { this.notify('Укажите израсходовано, м² (> 0)', 'error'); return; }

        var meta = this.meta.consumption;
        var batchMeta = this.meta.batch;
        var amountReq = reqIdByName(meta, CONS_REQ.amount);
        var batchReq = reqIdByName(meta, CONS_REQ.batch);
        var delta = amount - core.toNumber(row.savedAmount); // сколько ещё списать с остатка
        var batch = this.findBatch(row.batchId);

        this.setBusy(true);
        var fields = {};
        if (amountReq) fields['t' + amountReq] = amount;
        if (batchReq) fields['t' + batchReq] = row.batchId;

        var save;
        if (row.id) {
            save = this.post('_m_set/' + row.id + '?JSON', fields).then(function() { return row.id; });
        } else {
            var createParams = {};
            Object.keys(fields).forEach(function(k) { createParams[k] = fields[k]; });
            createParams['t' + meta.id] = 'Расход ' + (this.consumptions.indexOf(row) + 1);
            save = this.post('_m_new/' + meta.id + '?JSON&up=' + encodeURIComponent(this.currentCutId), createParams)
                .then(function(res) {
                    var id = res && (res.obj || res.id || res.i);
                    if (!id) throw new Error('Сервер не вернул id записи расхода');
                    row.id = String(id);
                    return row.id;
                });
        }

        save.then(function() {
            // Списываем дельту с остатка партии (если есть метаданные партии).
            if (!batch || !batchMeta || delta === 0) return null;
            var remReq = reqIdByName(batchMeta, BATCH_REQ.remainder);
            if (!remReq) return null;
            var newRem = delta > 0
                ? core.applyConsumption(batch.remainder, delta)
                : core.restoreConsumption(batch.remainder, -delta);
            var bf = {};
            bf['t' + remReq] = newRem;
            return self.post('_m_set/' + batch.id + '?JSON', bf).then(function() { batch.remainder = newRem; });
        }).then(function() {
            row.savedAmount = amount;
            return self.loadBatches();
        }).then(function() {
            self.setBusy(false);
            self.notify('Списано ' + amount + ' м²; остаток партии уменьшен', 'success');
            self.renderMain();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка списания: ' + err.message, 'error');
        });
    };

    AtexSlitter.prototype.deleteConsumption = function(row, idx) {
        var self = this;
        if (this.busy) return;
        // Новая (несохранённая) строка — просто убираем из формы.
        if (!row.id) { this.consumptions.splice(idx, 1); this.renderMain(); return; }

        var batchMeta = this.meta.batch;
        var batch = this.findBatch(row.batchId);
        var restore = core.toNumber(row.savedAmount); // вернуть на остаток
        this.setBusy(true);
        this.post('_m_del/' + row.id + '?JSON', {}).then(function() {
            // Возвращаем списанное на остаток партии.
            if (!batch || !batchMeta || restore <= 0) return null;
            var remReq = reqIdByName(batchMeta, BATCH_REQ.remainder);
            if (!remReq) return null;
            var newRem = core.restoreConsumption(batch.remainder, restore);
            var bf = {};
            bf['t' + remReq] = newRem;
            return self.post('_m_set/' + batch.id + '?JSON', bf).then(function() { batch.remainder = newRem; });
        }).then(function() {
            return Promise.all([self.loadConsumptions(self.currentCutId), self.loadBatches()]);
        }).then(function() {
            self.setBusy(false);
            self.notify('Списание отменено, остаток партии возвращён', 'success');
            self.renderMain();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка удаления: ' + err.message, 'error');
        });
    };

    AtexSlitter.prototype.findBatch = function(batchId) {
        return this.batches.filter(function(b) { return String(b.id) === String(batchId); })[0] || null;
    };

    // Событие смены: пишется самостоятельной записью с датой/временем (главное
    // значение), типом, ссылкой на резку и оператора — критерий приёмки §3.5.
    AtexSlitter.prototype.addEvent = function(data) {
        var self = this;
        if (this.busy) return;
        if (!this.currentCutId) { this.notify('Сначала выберите резку', 'error'); return; }
        var meta = this.meta.event;
        if (!meta) { this.notify('Таблица «' + TABLE.event + '» не найдена', 'error'); return; }

        var when = core.formatDateTime(new Date());
        var params = {};
        params['t' + meta.id] = when; // главное значение — дата/время (хронология)
        var typeReq = reqIdByName(meta, EVENT_REQ.type);
        var cutReq = reqIdByName(meta, EVENT_REQ.cut);
        var userReq = reqIdByName(meta, EVENT_REQ.user);
        var valReq = reqIdByName(meta, EVENT_REQ.value);
        var notesReq = reqIdByName(meta, EVENT_REQ.notes);
        if (typeReq && data.type) params['t' + typeReq] = data.type;
        if (cutReq) params['t' + cutReq] = this.currentCutId;
        if (userReq && this.userId) params['t' + userReq] = this.userId;
        if (valReq && data.value !== '' && data.value != null) params['t' + valReq] = core.toNumber(data.value);
        if (notesReq && data.notes) params['t' + notesReq] = data.notes;

        this.setBusy(true);
        this.post('_m_new/' + meta.id + '?JSON&up=1', params).then(function() {
            return self.loadEvents(self.currentCutId);
        }).then(function() {
            self.setBusy(false);
            self.notify('Событие «' + (data.type || 'смены') + '» зафиксировано', 'success');
            self.renderMain();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Не удалось записать событие: ' + err.message, 'error');
        });
    };

    AtexSlitter.prototype.openCut = function(cutId) {
        var self = this;
        this.setBusy(true);
        this.currentCutId = String(cutId);
        Promise.all([
            this.loadCut(cutId),
            this.loadConsumptions(cutId),
            this.loadEvents(cutId)
        ]).then(function() {
            self.setBusy(false);
            self.render();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Не удалось открыть резку: ' + err.message, 'error');
        });
    };

    AtexSlitter.prototype.setBusy = function(on) {
        this.busy = on;
        if (this.root) this.root.classList.toggle('is-busy', !!on);
    };

    // Уведомления без alert/confirm/prompt (раздел 8 гайда): встроенный тост,
    // либо общий MainAppController, если он доступен в main.html.
    AtexSlitter.prototype.notify = function(message, kind) {
        if (kind === 'error' && typeof window !== 'undefined' && window.mainAppController &&
            typeof window.mainAppController.showErrorModal === 'function') {
            window.mainAppController.showErrorModal(message);
            return;
        }
        var toast = el('div', { class: 'atex-sl-toast atex-sl-toast-' + (kind || 'info'), text: message });
        (this.toastHost || document.body).appendChild(toast);
        setTimeout(function() { toast.classList.add('is-visible'); }, 10);
        setTimeout(function() {
            toast.classList.remove('is-visible');
            setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
        }, 3500);
    };

    AtexSlitter.prototype.fatal = function(message) {
        this.root.innerHTML = '';
        this.root.appendChild(el('div', { class: 'atex-sl-fatal', text: message }));
    };

    AtexSlitter.prototype.start = function() {
        var self = this;
        this.root.innerHTML = '';
        var layout = el('div', { class: 'atex-sl-layout' });

        var aside = el('aside', { class: 'atex-sl-sidebar' });
        var head = el('div', { class: 'atex-sl-sidebar-head' }, [ el('h2', { text: 'Мои резки' }) ]);
        var filter = el('label', { class: 'atex-sl-filter' });
        var cb = el('input', { type: 'checkbox' });
        cb.addEventListener('change', function() { self.hideDone = cb.checked; self.renderCuts(); });
        filter.appendChild(cb);
        filter.appendChild(el('span', { text: 'Скрыть завершённые' }));
        head.appendChild(filter);
        aside.appendChild(head);
        this.cutsEl = el('div', { class: 'atex-sl-cuts' });
        aside.appendChild(this.cutsEl);

        this.mainEl = el('section', { class: 'atex-sl-main' });
        layout.appendChild(aside);
        layout.appendChild(this.mainEl);
        this.root.appendChild(layout);
        this.toastHost = this.root;

        this.cutsEl.appendChild(el('div', { class: 'atex-sl-loading', text: 'Загрузка…' }));
        this.mainEl.appendChild(el('div', { class: 'atex-sl-placeholder', text: 'Загрузка данных…' }));

        return this.loadMetadata()
            .then(function() { return Promise.all([self.loadBatches(), self.loadCuts()]); })
            .then(function() { self.render(); })
            .catch(function(err) { self.fatal('Ошибка инициализации: ' + err.message); });
    };

    function init() {
        if (typeof document === 'undefined') return;
        var root = document.getElementById('atex-slitter');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        var controller = new AtexSlitter(root);
        root._atexSlitter = controller;
        controller.start();
    }

    // Общие мелкие фабрики DOM, используемые в нескольких методах.
    function numInput(value, placeholder) {
        var inp = el('input', { class: 'atex-sl-input', type: 'number', min: '0', step: 'any', placeholder: placeholder || '0' });
        inp.value = value == null ? '' : value;
        return inp;
    }
    function field(label, control) {
        return el('label', { class: 'atex-sl-field' }, [
            el('span', { class: 'atex-sl-label', text: label }),
            control
        ]);
    }

    return { core: core, Controller: AtexSlitter, init: init };
});
