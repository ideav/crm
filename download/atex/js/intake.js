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
        arrivedAt: 'Дата прихода',
        received: 'Получено, м²',
        remainder: 'Остаток, м²'
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

    // Разбор значения-ссылки из JSON_OBJ: «id:Подпись» → { id, label }.
    function parseRef(raw) {
        var m = String(raw == null ? '' : raw).match(/^(\d+):([\s\S]*)$/);
        return m ? { id: m[1], label: m[2] } : { id: null, label: String(raw == null ? '' : raw) };
    }

    function AtexIntake(root) {
        this.root = root;
        this.db = window.db || root.getAttribute('data-db') || '';
        this.meta = { batch: null, material: null };
        this.materials = [];   // [{ id, label }]
        this.batches = [];     // загруженные партии [{ id, name, materialId, materialLabel, arrivedAt, received, remainder }]
        this.current = null;   // редактируемая/новая партия
        this.remainderTouched = false; // пользователь вручную правил «Остаток»?
        this.busy = false;
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

    // POST команды `_m_*`. Токен XSRF подставляется обязательно (раздел 4 гайда).
    AtexIntake.prototype.post = function(path, params) {
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
            self.materials = (rows || []).map(function(r) {
                return { id: String(r.i), label: (r.r && r.r[0]) || ('#' + r.i) };
            });
        });
    };

    // Колонки JSON_OBJ идут в порядке: [главное значение, ...reqs по порядку].
    AtexIntake.prototype.colIndex = function(meta, reqName) {
        var order = [meta.id].concat((meta.reqs || []).map(function(r) { return String(r.id); }));
        var rid = reqIdByName(meta, reqName);
        var idx = order.indexOf(String(rid));
        return idx >= 0 ? idx : -1;
    };

    AtexIntake.prototype.loadBatches = function() {
        var self = this;
        var meta = this.meta.batch;
        var iMat = this.colIndex(meta, BATCH_REQ.material);
        var iArr = this.colIndex(meta, BATCH_REQ.arrivedAt);
        var iRec = this.colIndex(meta, BATCH_REQ.received);
        var iRem = this.colIndex(meta, BATCH_REQ.remainder);
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            var list = (rows || []).map(function(rec) {
                var r = rec.r || [];
                var matRef = iMat >= 0 ? parseRef(r[iMat]) : { id: null, label: '' };
                return {
                    id: String(rec.i),
                    name: r[0] || '',
                    materialId: matRef.id,
                    materialLabel: matRef.label,
                    arrivedAt: iArr >= 0 ? (r[iArr] || '') : '',
                    received: iRec >= 0 ? (r[iRec] || '') : '',
                    remainder: iRem >= 0 ? (r[iRem] || '') : ''
                };
            });
            // FIFO: старые партии — первыми (сортировка по дате прихода).
            self.batches = sortFifo(list);
        });
    };

    // ── Состояние формы ──

    AtexIntake.prototype.newBatch = function() {
        this.current = {
            id: null, name: '', materialId: null,
            arrivedAt: todayIso(), received: '', remainder: ''
        };
        this.remainderTouched = false;
    };

    AtexIntake.prototype.openBatch = function(id) {
        var b = this.batches.filter(function(x) { return String(x.id) === String(id); })[0];
        if (!b) return;
        this.current = {
            id: b.id, name: b.name, materialId: b.materialId,
            arrivedAt: toIsoDate(b.arrivedAt) || b.arrivedAt,
            received: b.received, remainder: b.remainder
        };
        this.remainderTouched = true; // у существующей партии остаток уже задан
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
            box.appendChild(el('div', { class: 'atex-in-empty', text: 'Партий сырья пока нет' }));
            return;
        }
        // Шапка таблицы FIFO.
        box.appendChild(el('div', { class: 'atex-in-row atex-in-row-head' }, [
            el('span', { text: '№' }),
            el('span', { text: 'Вид сырья' }),
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
        var sel = el('select', { class: 'atex-in-input', id: 'atex-in-material' });
        sel.appendChild(el('option', { value: '', text: '— не выбрано —' }));
        this.materials.forEach(function(m) {
            var o = el('option', { value: m.id, text: m.label });
            if (String(c.materialId) === String(m.id)) o.selected = true;
            sel.appendChild(o);
        });
        sel.addEventListener('change', function() { c.materialId = sel.value || null; });
        form.appendChild(field('Вид сырья', sel));

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
        // Критерий приёмки #2914: если остаток не задан — он равен «Получено».
        var remainder = (c.remainder === '' || c.remainder == null)
            ? initialRemainder(c.received)
            : round3(toNumber(c.remainder));

        var fields = {};
        fields['t' + reqIdByName(meta, BATCH_REQ.material)] = c.materialId;
        fields['t' + reqIdByName(meta, BATCH_REQ.arrivedAt)] = c.arrivedAt || todayIso();
        fields['t' + reqIdByName(meta, BATCH_REQ.received)] = round3(toNumber(c.received));
        fields['t' + reqIdByName(meta, BATCH_REQ.remainder)] = remainder;

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
            .then(function() { self.render(); })
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

    return { calc: calc, Controller: AtexIntake, init: init };
});
