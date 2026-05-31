// Рабочее место atex «Калькулятор типов резки» (роль Диспетчер).
//
// Создание/правка типа резки, ввод полос (ширина × количество, назначение),
// расчёт «Итого ножей» и «Остаток, мм». Решение задачи ideav/crm#2912
// (часть #2903). Правила разработки рабочих мест — docs/WORKSPACE_DEVELOPMENT_GUIDE.md.
//
// На этом этапе рабочее место обращается к данным напрямую командами `_m_*`
// (#2903): создание — `_m_new/{Тип резки}`, полосы — `_m_new/{Полоса}` с
// `up={cutTypeId}`, правки — `_m_set`, удаление полос — `_m_del`. ID таблиц и
// реквизитов не хардкодятся: они берутся по именам из `GET /{db}/metadata?JSON=1`
// (WORKSPACE_DEVELOPMENT_GUIDE.md, разделы 3 и 6). Перевод чтений на защищённый
// слой `report/` — следующий этап и в объём этой задачи не входит.
//
// Формулы (дизайн-спека atex, раздел «Тип резки»):
//   • «Итого ножей»  = сумма всех количеств полос (Σ количество);
//   • «Остаток, мм»  = «Ширина входа» − Σ(ширина полосы × количество).
//
// Чистое ядро расчёта вынесено в объект `calc` и экспортируется через
// module.exports для модульных тестов (experiments/atex-cut-calc.test.js).

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.AtexCutCalc = api;
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
    var TABLE = { cutType: 'Тип резки', strip: 'Полоса', material: 'Вид сырья' };
    var CUT_REQ = {
        material: 'Вид сырья',
        inputWidth: 'Ширина входа, мм',
        tolerance: 'Допуск, мм',
        totalKnives: 'Итого ножей',
        remainder: 'Остаток, мм',
        notes: 'Примечания'
    };
    var STRIP_REQ = { width: 'Ширина, мм', qty: 'Количество', purpose: 'Назначение' };
    var PURPOSES = ['Заказ', 'Склад', 'Отходы'];

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

    // «Итого ножей» — сумма всех количеств полос.
    function totalKnives(strips) {
        return (strips || []).reduce(function(sum, s) {
            return sum + toNumber(s.qty);
        }, 0);
    }

    // Занятая полосами ширина — Σ(ширина × количество).
    function usedWidth(strips) {
        return round3((strips || []).reduce(function(sum, s) {
            return sum + toNumber(s.width) * toNumber(s.qty);
        }, 0));
    }

    // «Остаток, мм» — «Ширина входа» минус занятая ширина.
    function remainder(inputWidth, strips) {
        return round3(toNumber(inputWidth) - usedWidth(strips));
    }

    // Сводка для отображения и записи.
    function computeSummary(inputWidth, strips, tolerance) {
        var used = usedWidth(strips);
        var rem = round3(toNumber(inputWidth) - used);
        return {
            totalKnives: totalKnives(strips),
            usedWidth: used,
            remainder: rem,
            // Остаток вписывается в допуск (|остаток| ≤ допуск). Допуск ±15
            // (дизайн-спека); если не задан — признак не вычисляется (null).
            withinTolerance: (tolerance === undefined || tolerance === null || tolerance === '')
                ? null
                : Math.abs(rem) <= Math.abs(toNumber(tolerance))
        };
    }

    var calc = {
        toNumber: toNumber,
        round3: round3,
        totalKnives: totalKnives,
        usedWidth: usedWidth,
        remainder: remainder,
        computeSummary: computeSummary
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

    // Разбор значения-ссылки из JSON_OBJ: «id:Подпись» → { id, label }.
    function parseRef(raw) {
        var m = String(raw == null ? '' : raw).match(/^(\d+):([\s\S]*)$/);
        return m ? { id: m[1], label: m[2] } : { id: null, label: String(raw == null ? '' : raw) };
    }

    function AtexCutCalc(root) {
        this.root = root;
        this.db = window.db || root.getAttribute('data-db') || '';
        this.meta = { cutType: null, strip: null, material: null };
        this.materials = [];      // [{ id, label }]
        this.cutTypes = [];       // список существующих типов резки [{ id, name }]
        this.current = null;      // редактируемый тип резки: { id|null, name, ... }
        this.strips = [];         // строки полос формы: { id|null, width, qty, purpose }
        this.busy = false;
    }

    AtexCutCalc.prototype.url = function(path) {
        return '/' + encodeURIComponent(this.db) + '/' + path;
    };

    // GET → JSON. Бросает Error при сетевой/JSON-ошибке.
    AtexCutCalc.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                try { return JSON.parse(text); }
                catch (e) { throw new Error('Некорректный JSON: ' + text.slice(0, 200)); }
            });
        });
    };

    // POST команды `_m_*`. Токен XSRF подставляется обязательно (раздел 4 гайда).
    // `full=1` для длинных значений (Примечания), чтобы не обрезалось до 127.
    AtexCutCalc.prototype.post = function(path, params) {
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

    AtexCutCalc.prototype.loadMetadata = function() {
        var self = this;
        return this.getJson('metadata?JSON=1').then(function(all) {
            var list = Array.isArray(all) ? all : [all];
            function byName(name) {
                return list.filter(function(t) {
                    return String(t.val).trim().toLowerCase() === name.trim().toLowerCase();
                })[0] || null;
            }
            self.meta.cutType = byName(TABLE.cutType);
            self.meta.strip = byName(TABLE.strip);
            self.meta.material = byName(TABLE.material);
            if (!self.meta.cutType) throw new Error('В метаданных не найдена таблица «' + TABLE.cutType + '»');
            if (!self.meta.strip) throw new Error('В метаданных не найдена таблица «' + TABLE.strip + '»');
        });
    };

    AtexCutCalc.prototype.loadMaterials = function() {
        var self = this;
        if (!this.meta.material) { this.materials = []; return Promise.resolve(); }
        return this.getJson('object/' + this.meta.material.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            self.materials = (rows || []).map(function(r) {
                return { id: String(r.i), label: (r.r && r.r[0]) || ('#' + r.i) };
            });
        });
    };

    AtexCutCalc.prototype.loadCutTypes = function() {
        var self = this;
        return this.getJson('object/' + this.meta.cutType.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            self.cutTypes = (rows || []).map(function(r) {
                return { id: String(r.i), name: (r.r && r.r[0]) || ('#' + r.i), row: r.r || [] };
            });
        });
    };

    // ── Чтение одного типа резки в форму ──

    AtexCutCalc.prototype.loadCutType = function(id) {
        var self = this;
        var meta = this.meta.cutType;
        // Колонки JSON_OBJ идут в порядке: [главное значение, ...reqs по порядку].
        var order = [meta.id].concat((meta.reqs || []).map(function(r) { return String(r.id); }));
        function col(reqName) {
            var rid = reqIdByName(meta, reqName);
            var idx = order.indexOf(String(rid));
            return idx >= 0 ? idx : -1;
        }
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&F_I=' + encodeURIComponent(id)).then(function(rows) {
            var rec = (rows || [])[0];
            if (!rec) throw new Error('Тип резки #' + id + ' не найден');
            var r = rec.r || [];
            var matIdx = col(CUT_REQ.material);
            var matRef = matIdx >= 0 ? parseRef(r[matIdx]) : { id: null };
            self.current = {
                id: String(rec.i),
                name: r[0] || '',
                materialId: matRef.id,
                inputWidth: matIdx >= 0 ? '' : '',
                fields: { input: r[col(CUT_REQ.inputWidth)], tol: r[col(CUT_REQ.tolerance)], notes: r[col(CUT_REQ.notes)] }
            };
            self.current.inputWidth = self.current.fields.input || '';
            self.current.tolerance = self.current.fields.tol || '';
            self.current.notes = self.current.fields.notes || '';
            // Полосы — подчинённые записи (F_U = id типа резки).
            return self.getJson('object/' + self.meta.strip.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(id) + '&LIMIT=0,1000');
        }).then(function(stripRows) {
            var sm = self.meta.strip;
            var sOrder = [sm.id].concat((sm.reqs || []).map(function(x) { return String(x.id); }));
            function sCol(name) { var rid = reqIdByName(sm, name); var i = sOrder.indexOf(String(rid)); return i >= 0 ? i : -1; }
            self.strips = (stripRows || []).map(function(rec) {
                var r = rec.r || [];
                var pIdx = sCol(STRIP_REQ.purpose);
                return {
                    id: String(rec.i),
                    name: r[0] || '',
                    width: r[sCol(STRIP_REQ.width)] || '',
                    qty: r[sCol(STRIP_REQ.qty)] || '',
                    purpose: pIdx >= 0 ? (r[pIdx] || '') : ''
                };
            });
            if (!self.strips.length) self.strips = [self.blankStrip()];
        });
    };

    AtexCutCalc.prototype.blankStrip = function() {
        return { id: null, name: '', width: '', qty: '', purpose: PURPOSES[0] };
    };

    AtexCutCalc.prototype.newCutType = function() {
        this.current = { id: null, name: '', materialId: null, inputWidth: '', tolerance: '', notes: '' };
        this.strips = [this.blankStrip()];
    };

    // ── Рендеринг ──

    AtexCutCalc.prototype.render = function() {
        if (this.listEl) this.renderList();
        this.renderForm();
        this.recalc();
    };

    AtexCutCalc.prototype.renderList = function() {
        var self = this;
        var box = this.listEl;
        box.innerHTML = '';
        if (!this.cutTypes.length) {
            box.appendChild(el('div', { class: 'atex-cc-empty', text: 'Типов резки пока нет' }));
            return;
        }
        this.cutTypes.forEach(function(ct) {
            var active = self.current && String(self.current.id) === String(ct.id);
            var item = el('button', {
                class: 'atex-cc-list-item' + (active ? ' is-active' : ''),
                type: 'button',
                text: ct.name
            });
            item.addEventListener('click', function() { self.openCutType(ct.id); });
            box.appendChild(item);
        });
    };

    AtexCutCalc.prototype.renderForm = function() {
        var self = this;
        var c = this.current || {};
        var form = this.formEl;
        form.innerHTML = '';

        form.appendChild(el('h2', { class: 'atex-cc-form-title', text: c.id ? ('Тип резки: ' + (c.name || '#' + c.id)) : 'Новый тип резки' }));

        // Название типа резки
        form.appendChild(field('Название', this.input('name', c.name, 'text', 'например, 25мм×35 + 55мм×1')));

        // Вид сырья (ссылка)
        var sel = el('select', { class: 'atex-cc-input', id: 'atex-cc-material' });
        sel.appendChild(el('option', { value: '', text: '— не выбрано —' }));
        this.materials.forEach(function(m) {
            var o = el('option', { value: m.id, text: m.label });
            if (String(c.materialId) === String(m.id)) o.selected = true;
            sel.appendChild(o);
        });
        sel.addEventListener('change', function() { c.materialId = sel.value || null; });
        form.appendChild(field('Вид сырья', sel));

        // Ширина входа / Допуск
        var widthInput = this.input('inputWidth', c.inputWidth, 'number', '910');
        widthInput.addEventListener('input', function() { self.recalc(); });
        form.appendChild(field('Ширина входа, мм', widthInput));
        form.appendChild(field('Допуск, мм', this.input('tolerance', c.tolerance, 'number', '15')));

        // Полосы
        var stripWrap = el('div', { class: 'atex-cc-strips' });
        stripWrap.appendChild(el('div', { class: 'atex-cc-strips-head' }, [
            el('span', { text: '№' }),
            el('span', { text: 'Ширина, мм' }),
            el('span', { text: 'Количество' }),
            el('span', { text: 'Назначение' }),
            el('span', { text: '' })
        ]));
        this.stripsBody = el('div', { class: 'atex-cc-strips-body' });
        stripWrap.appendChild(this.stripsBody);
        var addBtn = el('button', { class: 'atex-cc-btn atex-cc-btn-add', type: 'button', text: '+ Добавить полосу' });
        addBtn.addEventListener('click', function() { self.strips.push(self.blankStrip()); self.renderStrips(); self.recalc(); });
        stripWrap.appendChild(addBtn);
        form.appendChild(field('Полосы', stripWrap));

        // Примечания
        var notes = el('textarea', { class: 'atex-cc-input atex-cc-textarea', id: 'atex-cc-notes', rows: '3' });
        notes.value = c.notes || '';
        notes.addEventListener('input', function() { c.notes = notes.value; });
        form.appendChild(field('Примечания', notes));

        // Итоги
        this.summaryEl = el('div', { class: 'atex-cc-summary' });
        form.appendChild(this.summaryEl);

        // Кнопки
        var actions = el('div', { class: 'atex-cc-actions' });
        var saveBtn = el('button', { class: 'atex-cc-btn atex-cc-btn-primary', type: 'button', text: 'Сохранить' });
        saveBtn.addEventListener('click', function() { self.save(); });
        var newBtn = el('button', { class: 'atex-cc-btn atex-cc-btn-secondary', type: 'button', text: 'Новый' });
        newBtn.addEventListener('click', function() { self.newCutType(); self.render(); });
        actions.appendChild(saveBtn);
        actions.appendChild(newBtn);
        form.appendChild(actions);

        this.renderStrips();

        function field(label, control) {
            return el('div', { class: 'atex-cc-field' }, [
                el('label', { class: 'atex-cc-label', text: label }),
                control
            ]);
        }
    };

    AtexCutCalc.prototype.input = function(prop, value, type, placeholder) {
        var self = this;
        var inp = el('input', { class: 'atex-cc-input', type: type || 'text', placeholder: placeholder || '' });
        inp.value = value == null ? '' : value;
        inp.addEventListener('input', function() { self.current[prop] = inp.value; });
        return inp;
    };

    AtexCutCalc.prototype.renderStrips = function() {
        var self = this;
        var body = this.stripsBody;
        body.innerHTML = '';
        this.strips.forEach(function(s, idx) {
            var row = el('div', { class: 'atex-cc-strip-row' });

            row.appendChild(el('span', { class: 'atex-cc-strip-num', text: String(idx + 1) }));

            var w = el('input', { class: 'atex-cc-input', type: 'number', min: '0', step: 'any', placeholder: '0' });
            w.value = s.width;
            w.addEventListener('input', function() { s.width = w.value; self.recalc(); });
            row.appendChild(w);

            var q = el('input', { class: 'atex-cc-input', type: 'number', min: '0', step: '1', placeholder: '0' });
            q.value = s.qty;
            q.addEventListener('input', function() { s.qty = q.value; self.recalc(); });
            row.appendChild(q);

            var p = el('select', { class: 'atex-cc-input' });
            PURPOSES.forEach(function(name) {
                var o = el('option', { value: name, text: name });
                if (s.purpose === name) o.selected = true;
                p.appendChild(o);
            });
            // Если назначение из БД отсутствует в списке — добавляем как опцию.
            if (s.purpose && PURPOSES.indexOf(s.purpose) === -1) {
                var extra = el('option', { value: s.purpose, text: s.purpose });
                extra.selected = true;
                p.appendChild(extra);
            }
            p.addEventListener('change', function() { s.purpose = p.value; });
            row.appendChild(p);

            var del = el('button', { class: 'atex-cc-btn atex-cc-btn-del', type: 'button', title: 'Удалить полосу', text: '×' });
            del.addEventListener('click', function() {
                self.strips.splice(idx, 1);
                if (!self.strips.length) self.strips = [self.blankStrip()];
                self.renderStrips();
                self.recalc();
            });
            row.appendChild(del);

            body.appendChild(row);
        });
    };

    AtexCutCalc.prototype.recalc = function() {
        if (!this.current || !this.summaryEl) return;
        var s = computeSummary(this.current.inputWidth, this.strips, this.current.tolerance);
        var within = s.withinTolerance;
        this.summaryEl.innerHTML = '';
        this.summaryEl.appendChild(metric('Итого ножей', s.totalKnives));
        this.summaryEl.appendChild(metric('Занято, мм', s.usedWidth));
        var remNode = metric('Остаток, мм', s.remainder);
        if (within === false) remNode.classList.add('is-warn');
        if (within === true) remNode.classList.add('is-ok');
        this.summaryEl.appendChild(remNode);

        function metric(label, value) {
            return el('div', { class: 'atex-cc-metric' }, [
                el('span', { class: 'atex-cc-metric-label', text: label }),
                el('span', { class: 'atex-cc-metric-value', text: String(value) })
            ]);
        }
    };

    // ── Сохранение ──

    AtexCutCalc.prototype.save = function() {
        var self = this;
        if (this.busy) return;
        var c = this.current;
        if (!c) return;
        if (!String(c.name || '').trim()) { this.notify('Укажите название типа резки', 'error'); return; }

        var meta = this.meta.cutType;
        var sm = this.meta.strip;
        var summary = computeSummary(c.inputWidth, this.strips, c.tolerance);

        // Реквизиты типа резки (t{reqId}). Названия → id из метаданных.
        var cutFields = {};
        cutFields['t' + reqIdByName(meta, CUT_REQ.material)] = c.materialId || '';
        cutFields['t' + reqIdByName(meta, CUT_REQ.inputWidth)] = nz(c.inputWidth);
        cutFields['t' + reqIdByName(meta, CUT_REQ.tolerance)] = nz(c.tolerance);
        cutFields['t' + reqIdByName(meta, CUT_REQ.totalKnives)] = summary.totalKnives;
        cutFields['t' + reqIdByName(meta, CUT_REQ.remainder)] = summary.remainder;

        this.setBusy(true);
        var chain;
        if (c.id) {
            // Правка: имя — _m_save (первая колонка), реквизиты — _m_set.
            chain = this.post('_m_save/' + c.id + '?JSON', { val: c.name })
                .then(function() { return self.post('_m_set/' + c.id + '?JSON&full=1', withNotes(cutFields)); })
                .then(function() { return c.id; });
        } else {
            // Создание: главное значение — t{typeId}; реквизиты — здесь же.
            var createParams = withNotes(cutFields);
            createParams['t' + meta.id] = c.name;
            chain = this.post('_m_new/' + meta.id + '?JSON&up=1&full=1', createParams).then(function(res) {
                var id = res && (res.obj || res.id || res.i);
                if (!id) throw new Error('Сервер не вернул id нового типа резки');
                c.id = String(id);
                return c.id;
            });
        }

        chain.then(function(cutId) {
            return self.syncStrips(cutId, sm);
        }).then(function() {
            return self.refreshAfterSave();
        }).then(function() {
            self.setBusy(false);
            self.notify('Тип резки сохранён', 'success');
            self.render();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка сохранения: ' + err.message, 'error');
        });

        function nz(v) { return (v === '' || v == null) ? '' : toNumber(v); }
        function withNotes(base) {
            var out = {};
            Object.keys(base).forEach(function(k) { out[k] = base[k]; });
            var notesReq = reqIdByName(meta, CUT_REQ.notes);
            if (notesReq) out['t' + notesReq] = c.notes || '';
            return out;
        }
    };

    // Синхронизация подчинённых полос: новые → _m_new (up=cutId),
    // изменённые существующие → _m_save/_m_set, удалённые → _m_del.
    AtexCutCalc.prototype.syncStrips = function(cutId, sm) {
        var self = this;
        var widthReq = reqIdByName(sm, STRIP_REQ.width);
        var qtyReq = reqIdByName(sm, STRIP_REQ.qty);
        var purposeReq = reqIdByName(sm, STRIP_REQ.purpose);

        // Полосы, которые были загружены, но удалены из формы.
        var keepIds = this.strips.filter(function(s) { return s.id; }).map(function(s) { return String(s.id); });
        var toDelete = (this.loadedStripIds || []).filter(function(id) { return keepIds.indexOf(String(id)) === -1; });

        var ops = [];
        this.strips.forEach(function(s, idx) {
            var hasData = String(s.width).trim() !== '' || String(s.qty).trim() !== '';
            if (!hasData && !s.id) return; // пустую новую строку не сохраняем
            var name = String(s.name || '').trim() || String(idx + 1);
            var fields = {};
            fields['t' + widthReq] = (s.width === '' || s.width == null) ? '' : toNumber(s.width);
            fields['t' + qtyReq] = (s.qty === '' || s.qty == null) ? '' : toNumber(s.qty);
            fields['t' + purposeReq] = s.purpose || '';
            if (s.id) {
                ops.push(function() {
                    return self.post('_m_save/' + s.id + '?JSON', { val: name })
                        .then(function() { return self.post('_m_set/' + s.id + '?JSON', fields); });
                });
            } else {
                var createParams = {};
                Object.keys(fields).forEach(function(k) { createParams[k] = fields[k]; });
                createParams['t' + sm.id] = name;
                ops.push(function() {
                    return self.post('_m_new/' + sm.id + '?JSON&up=' + encodeURIComponent(cutId), createParams)
                        .then(function(res) { s.id = String(res && (res.obj || res.id || res.i) || ''); });
                });
            }
        });
        toDelete.forEach(function(id) {
            ops.push(function() { return self.post('_m_del/' + id + '?JSON', {}); });
        });

        // Последовательно, чтобы не перегружать сервер и сохранить порядок.
        return ops.reduce(function(p, op) { return p.then(op); }, Promise.resolve());
    };

    AtexCutCalc.prototype.refreshAfterSave = function() {
        var self = this;
        var currentId = this.current && this.current.id;
        return this.loadCutTypes().then(function() {
            if (currentId) return self.loadCutType(currentId).then(function() { self.captureLoadedStrips(); });
        });
    };

    AtexCutCalc.prototype.captureLoadedStrips = function() {
        this.loadedStripIds = this.strips.filter(function(s) { return s.id; }).map(function(s) { return String(s.id); });
    };

    AtexCutCalc.prototype.openCutType = function(id) {
        var self = this;
        this.setBusy(true);
        this.loadCutType(id).then(function() {
            self.captureLoadedStrips();
            self.setBusy(false);
            self.render();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Не удалось открыть тип резки: ' + err.message, 'error');
        });
    };

    AtexCutCalc.prototype.setBusy = function(on) {
        this.busy = on;
        if (this.root) this.root.classList.toggle('is-busy', !!on);
    };

    // Уведомления без alert/confirm/prompt (раздел 8 гайда): встроенный тост,
    // либо общий MainAppController, если он доступен в main.html.
    AtexCutCalc.prototype.notify = function(message, kind) {
        if (kind === 'error' && typeof window !== 'undefined' && window.mainAppController &&
            typeof window.mainAppController.showErrorModal === 'function') {
            window.mainAppController.showErrorModal(message);
            return;
        }
        var toast = el('div', { class: 'atex-cc-toast atex-cc-toast-' + (kind || 'info'), text: message });
        (this.toastHost || document.body).appendChild(toast);
        setTimeout(function() { toast.classList.add('is-visible'); }, 10);
        setTimeout(function() {
            toast.classList.remove('is-visible');
            setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
        }, 3500);
    };

    AtexCutCalc.prototype.fatal = function(message) {
        this.root.innerHTML = '';
        this.root.appendChild(el('div', { class: 'atex-cc-fatal', text: message }));
    };

    AtexCutCalc.prototype.start = function() {
        var self = this;
        // Каркас разметки.
        this.root.innerHTML = '';
        var layout = el('div', { class: 'atex-cc-layout' });
        var aside = el('aside', { class: 'atex-cc-sidebar' }, [
            el('div', { class: 'atex-cc-sidebar-head' }, [
                el('h2', { text: 'Типы резки' })
            ])
        ]);
        this.listEl = el('div', { class: 'atex-cc-list' });
        aside.appendChild(this.listEl);
        this.formEl = el('section', { class: 'atex-cc-form' });
        layout.appendChild(aside);
        layout.appendChild(this.formEl);
        this.root.appendChild(layout);
        this.toastHost = this.root;

        this.newCutType();
        this.formEl.appendChild(el('div', { class: 'atex-cc-loading', text: 'Загрузка…' }));

        return this.loadMetadata()
            .then(function() { return Promise.all([self.loadMaterials(), self.loadCutTypes()]); })
            .then(function() { self.loadedStripIds = []; self.render(); })
            .catch(function(err) { self.fatal('Ошибка инициализации: ' + err.message); });
    };

    function init() {
        if (typeof document === 'undefined') return;
        var root = document.getElementById('atex-cut-calc');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        var controller = new AtexCutCalc(root);
        root._atexCutCalc = controller;
        controller.start();
    }

    return { calc: calc, Controller: AtexCutCalc, init: init };
});
