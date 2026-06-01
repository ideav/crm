// Рабочее место atex «Расчёт резки» (роль Диспетчер).
//
// Подбор раскроя: для заданной ширины рулона и целевой ширины полосы
// автоматически предлагает комбинацию полос «Заказ» + «Склад» с минимальным
// отходом. Часть epic ideav/atex#52, подзадача B.
//
// Поля формы: Вид сырья (searchable-ref), целевая ширина, допуск (дефолт 20).
// Кнопка «Подобрать» → loadPreferredWidths → suggestCombination → таблица полос.
// Полосы редактируемы вручную (как в cut-calc.js). Итоги пересчитываются на лету.
// Кнопка «Сохранить как тип резки» — заглушка для Task 4.
//
// Чистое ядро расчёта вынесено в объект `calc` и экспортируется через
// module.exports для модульных тестов (experiments/atex-cut-planning.test.js).

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.AtexCutPlanning = api;
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

    // Подбор комбинации: набрать целевую ширину, добрать остаток ходовыми (min отход).
    // candidates: [{width, freq}] по убыванию freq. tolerance — допустимый |отход|.
    function suggestCombination(inputWidth, targetWidth, candidates, tolerance) {
        var W = toNumber(inputWidth), t = toNumber(targetWidth), tol = toNumber(tolerance);
        var strips = [];
        var nTarget = (t > 0) ? Math.floor(W / t) : 0;
        if (nTarget > 0) strips.push({ width: t, qty: nTarget, purpose: 'Заказ' });
        var rem = round3(W - nTarget * t);
        var fill = bestFill(rem, candidates, tol);
        fill.strips.forEach(function(s){ strips.push({ width: s.width, qty: s.qty, purpose: 'Склад' }); });
        var used = round3(strips.reduce(function(a,s){ return a + s.width*s.qty; }, 0));
        var remOut = round3(W - used);
        return { strips: strips, used: used, remainder: remOut,
                 withinTolerance: Math.abs(remOut) <= Math.abs(tol) };
    }

    // Перебор добора остатка rem ширинами candidates: {strips, leftover, freqSum}
    // с минимальным leftover (затем макс freqSum). Ограниченный поиск (rem конечен).
    function bestFill(rem, candidates, tol) {
        var cands = (candidates || []).map(function(c){ return { width: toNumber(c.width), freq: toNumber(c.freq) }; });
        // допускаем кандидатов чуть шире rem (в пределах допуска) — DFS отсеет неуместившиеся
        cands = cands.filter(function(c){ return c.width > 0 && c.width <= rem + Math.abs(toNumber(tol)); });
        var best = { strips: [], leftover: round3(rem), freqSum: 0 };
        (function dfs(i, left, acc, freqSum){
            var leftR = round3(left);
            if (leftR < best.leftover || (leftR === best.leftover && freqSum > best.freqSum)) {
                best = { strips: acc.slice(), leftover: leftR, freqSum: freqSum };
            }
            if (leftR <= Math.abs(toNumber(tol))) return;
            for (var k = i; k < cands.length; k++) {
                var c = cands[k];
                if (c.width > leftR) continue;
                var maxQ = Math.floor(leftR / c.width);
                for (var q = maxQ; q >= 1; q--) {
                    acc.push({ width: c.width, qty: q });
                    dfs(k + 1, round3(leftR - c.width * q), acc, freqSum + c.freq * q);
                    acc.pop();
                }
            }
        })(0, rem, [], 0);
        return best;
    }

    // Канонический ключ комбинации: сырьё + отсортированный мультинабор ширина×кол-во.
    function combinationSignature(materialId, strips) {
        var parts = (strips || []).map(function(s){ return round3(toNumber(s.width)) + 'x' + toNumber(s.qty); }).sort();
        return String(materialId == null ? '' : materialId) + '|' + parts.join('+');
    }

    var calc = {
        toNumber: toNumber,
        round3: round3,
        usedWidth: usedWidth,
        remainder: remainder,
        suggestCombination: suggestCombination,
        bestFill: bestFill,
        combinationSignature: combinationSignature
    };

    // ─────────────────────────── Браузерный слой ───────────────────────────
    // Ниже — DOM-контроллер. Требует window/document/fetch; в Node не выполняется.

    // Имена таблиц и реквизитов схемы atex. По именам находим числовые id в метаданных.
    var TABLE = { cutType: 'Тип резки', strip: 'Полоса', material: 'Вид сырья' };
    var MAT_REQ = { inputWidth: 'Ширина, мм' };
    var CUT_REQ = {
        material: 'Вид сырья',
        inputWidth: 'Ширина входа, мм',
        tolerance: 'Допуск, мм',
        totalKnives: 'Итого ножей',
        remainder: 'Остаток, мм'
    };
    var STRIP_REQ = { width: 'Ширина, мм', qty: 'Количество', purpose: 'Назначение' };
    var PURPOSES = ['Заказ', 'Склад', 'Отходы'];

    // ── Утилиты DOM (скопированы из cut-calc.js) ──

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

    // Значение реквизита из метаданных по имени → его числовой id.
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

    // ── Конструктор контроллера ──

    function AtexCutPlanning(root) {
        this.root = root;
        this.db = window.db || root.getAttribute('data-db') || '';
        this.meta = { cutType: null, strip: null, material: null };
        this.materials = [];   // [{ id, label, inputWidth }]
        this.cutTypes = [];    // [{ id, name, row }]  — для дедупа (Task 4)
        this.refOptions = {};  // кеш опций searchable reference inputs по reqId
        this.strips = [];      // строки полос: { id|null, width, qty, purpose }
        this.busy = false;
        // Текущие параметры формы (удобно хранить отдельно, не в current)
        this.form = { materialId: null, targetWidth: '', tolerance: '20' };
    }

    AtexCutPlanning.prototype.url = function(path) {
        return '/' + encodeURIComponent(this.db) + '/' + path;
    };

    // GET → JSON. Бросает Error при сетевой/JSON-ошибке.
    AtexCutPlanning.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                try { return JSON.parse(text); }
                catch (e) { throw new Error('Некорректный JSON: ' + text.slice(0, 200)); }
            });
        });
    };

    AtexCutPlanning.prototype.loadRefOptions = function(reqId, query, limit) {
        return this.getJson(window.AtexRefSearch.buildRefOptionsPath(reqId, query, limit));
    };

    AtexCutPlanning.prototype.refSelect = function(opts) {
        var self = this;
        var helper = (typeof window !== 'undefined' && window.AtexRefSearch) || null;
        if (helper && typeof helper.createSelect === 'function') {
            return helper.createSelect({
                classPrefix: 'atex-cp',
                inputClass: 'atex-cp-input',
                id: opts.id,
                options: opts.options || [],
                value: opts.value,
                placeholder: opts.placeholder,
                reqId: opts.reqId,
                cache: this.refOptions,
                loadOptions: function(reqId, query, limit) { return self.loadRefOptions(reqId, query, limit); },
                onChange: opts.onChange
            });
        }
        var sel = el('select', { class: 'atex-cp-input', id: opts.id });
        sel.appendChild(el('option', { value: '', text: opts.placeholder || '— не выбрано —' }));
        (opts.options || []).forEach(function(item) {
            var o = el('option', { value: item.id, text: item.label });
            if (String(opts.value) === String(item.id)) o.selected = true;
            sel.appendChild(o);
        });
        sel.addEventListener('change', function() { opts.onChange(sel.value); });
        return sel;
    };

    // POST команды `_m_*`. Токен XSRF подставляется обязательно.
    AtexCutPlanning.prototype.post = function(path, params) {
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

    AtexCutPlanning.prototype.loadMetadata = function() {
        var self = this;
        return this.getJson('metadata').then(function(all) {
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

    // Загрузка «Вид сырья» — id, label, и числовое поле «Ширина, мм» для ширины входа.
    AtexCutPlanning.prototype.loadMaterials = function() {
        var self = this;
        if (!this.meta.material) { this.materials = []; return Promise.resolve(); }
        var meta = this.meta.material;
        // Порядок колонок JSON_OBJ: [главное значение, ...reqs по порядку].
        var order = [meta.id].concat((meta.reqs || []).map(function(r) { return String(r.id); }));
        var widthReqId = reqIdByName(meta, MAT_REQ.inputWidth);
        var widthIdx = widthReqId ? order.indexOf(String(widthReqId)) : -1;
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            self.materials = (rows || []).map(function(r) {
                var rr = r.r || [];
                return {
                    id: String(r.i),
                    label: rr[0] || ('#' + r.i),
                    inputWidth: widthIdx >= 0 ? toNumber(rr[widthIdx]) : 0
                };
            });
        });
    };

    AtexCutPlanning.prototype.loadCutTypes = function() {
        var self = this;
        var meta = this.meta.cutType;
        var order = [meta.id].concat((meta.reqs || []).map(function(r) { return String(r.id); }));
        var matReqId = reqIdByName(meta, CUT_REQ.material);
        var matIdx = matReqId ? order.indexOf(String(matReqId)) : -1;
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            self.cutTypes = (rows || []).map(function(r) {
                var rr = r.r || [];
                var matRef = matIdx >= 0 ? parseRef(rr[matIdx]) : { id: null };
                return { id: String(r.i), name: rr[0] || ('#' + r.i), row: rr, materialId: matRef.id };
            });
        });
    };

    // ── Дедупликация: поиск существующего типа с той же комбинацией ──

    // Загрузить полосы одного типа резки (подчинённые записи Полоса).
    AtexCutPlanning.prototype.loadStripsForType = function(typeId) {
        var self = this;
        var sm = this.meta.strip;
        var order = [sm.id].concat((sm.reqs || []).map(function(r) { return String(r.id); }));
        function sCol(name) {
            var rid = reqIdByName(sm, name);
            var i = rid ? order.indexOf(String(rid)) : -1;
            return i >= 0 ? i : -1;
        }
        return this.getJson('object/' + sm.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(typeId) + '&LIMIT=0,1000')
            .then(function(rows) {
                return (rows || []).map(function(rec) {
                    var r = rec.r || [];
                    return {
                        width: r[sCol(STRIP_REQ.width)] || '',
                        qty: r[sCol(STRIP_REQ.qty)] || ''
                    };
                });
            });
    };

    // Найти существующий тип резки с тем же сырьём и тем же мультинабором полос.
    // Возвращает Promise<{id, name}> если дубль найден, иначе Promise<null>.
    AtexCutPlanning.prototype.findDuplicateCutType = function(materialId, strips) {
        var self = this;
        var targetSig = combinationSignature(String(materialId), strips);
        // Фильтруем по сырью (строковое сравнение id).
        var candidates = this.cutTypes.filter(function(ct) {
            return ct.materialId !== null && String(ct.materialId) === String(materialId);
        });
        if (!candidates.length) return Promise.resolve(null);
        // Последовательно проверяем каждый кандидат.
        var result = null;
        return candidates.reduce(function(chain, ct) {
            return chain.then(function() {
                if (result) return; // уже нашли дубль
                return self.loadStripsForType(ct.id).then(function(existingStrips) {
                    var sig = combinationSignature(String(materialId), existingStrips);
                    if (sig === targetSig) result = { id: ct.id, name: ct.name };
                });
            });
        }, Promise.resolve()).then(function() { return result; });
    };

    // Сгенерировать имя типа резки из полос: «60×14 + 40×1».
    function generateCutTypeName(strips) {
        var parts = (strips || []).filter(function(s) {
            return String(s.width).trim() !== '' && String(s.qty).trim() !== '';
        }).map(function(s) {
            return toNumber(s.width) + '×' + toNumber(s.qty);
        });
        return parts.length ? parts.join(' + ') : 'Без названия';
    }

    // ── Сохранение как «Тип резки» ──

    AtexCutPlanning.prototype.saveAsCutType = function() {
        var self = this;
        if (this.busy) return;
        var f = this.form;
        var materialId = f.materialId;
        var strips = this.strips;

        // Валидация
        if (!materialId) { this.notify('Укажите вид сырья', 'error'); return; }
        var hasStrips = strips.some(function(s) {
            return String(s.width).trim() !== '' && String(s.qty).trim() !== '';
        });
        if (!hasStrips) { this.notify('Нет полос для сохранения', 'error'); return; }

        var meta = this.meta.cutType;
        var sm = this.meta.strip;
        var inputWidth = this.getInputWidth(materialId);

        this.setBusy(true);

        this.findDuplicateCutType(materialId, strips).then(function(dup) {
            if (dup) {
                self.setBusy(false);
                self.notify('Такая комбинация уже есть: ' + dup.name, 'error');
                return;
            }
            // Создать тип резки
            var name = generateCutTypeName(strips);
            var totalKnivesVal = strips.reduce(function(sum, s) { return sum + toNumber(s.qty); }, 0);
            var usedW = usedWidth(strips);
            var rem = round3(toNumber(inputWidth) - usedW);

            var cutFields = {};
            cutFields['t' + meta.id] = name;
            cutFields['t' + reqIdByName(meta, CUT_REQ.material)] = materialId || '';
            var iwReqId = reqIdByName(meta, CUT_REQ.inputWidth);
            if (iwReqId) cutFields['t' + iwReqId] = inputWidth !== undefined ? inputWidth : '';
            var tkReqId = reqIdByName(meta, CUT_REQ.totalKnives);
            if (tkReqId) cutFields['t' + tkReqId] = totalKnivesVal;
            var remReqId = reqIdByName(meta, CUT_REQ.remainder);
            if (remReqId) cutFields['t' + remReqId] = rem;

            return self.post('_m_new/' + meta.id + '?JSON&up=1&full=1', cutFields).then(function(res) {
                var cutId = res && (res.obj || res.id || res.i);
                if (!cutId) throw new Error('Сервер не вернул id нового типа резки');
                cutId = String(cutId);
                // Создать полосы (только непустые)
                var widthReq = reqIdByName(sm, STRIP_REQ.width);
                var qtyReq = reqIdByName(sm, STRIP_REQ.qty);
                var purposeReq = reqIdByName(sm, STRIP_REQ.purpose);
                var ops = [];
                strips.forEach(function(s, idx) {
                    var hasData = String(s.width).trim() !== '' || String(s.qty).trim() !== '';
                    if (!hasData) return;
                    var stripName = String(idx + 1);
                    var params = {};
                    params['t' + sm.id] = stripName;
                    params['t' + widthReq] = (s.width === '' || s.width == null) ? '' : toNumber(s.width);
                    params['t' + qtyReq] = (s.qty === '' || s.qty == null) ? '' : toNumber(s.qty);
                    params['t' + purposeReq] = s.purpose || '';
                    ops.push(function() {
                        return self.post('_m_new/' + sm.id + '?JSON&up=' + encodeURIComponent(cutId), params);
                    });
                });
                return ops.reduce(function(p, op) { return p.then(op); }, Promise.resolve());
            }).then(function() {
                return self.loadCutTypes();
            }).then(function() {
                self.setBusy(false);
                self.notify('Тип резки «' + generateCutTypeName(strips) + '» сохранён', 'success');
            });
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка сохранения: ' + err.message, 'error');
        });
    };

    // ── Загрузка ходовых ширин из отчёта ──

    // Ходовые ширины выбранного сырья: отчёт preferable_widths по materialId (abn_ID).
    AtexCutPlanning.prototype.loadPreferredWidths = function(materialId) {
        if (!materialId) return Promise.resolve([]);
        var url = 'report/preferable_widths?JSON_KV&FR_position_material_id=' + encodeURIComponent(materialId) +
                  '&TO_position_material_id=' + encodeURIComponent(materialId);
        return this.getJson(url).then(function(rows) {
            return (Array.isArray(rows) ? rows : []).map(function(r) {
                return { width: parseFloat(r.position_width_mm), freq: parseFloat(r.position_qty_sum) };
            }).filter(function(c) { return isFinite(c.width) && c.width > 0; });
        });
    };

    // ── Вспомогательные методы ──

    AtexCutPlanning.prototype.setBusy = function(on) {
        this.busy = on;
        if (this.root) this.root.classList.toggle('is-busy', !!on);
    };

    // Уведомления без alert/confirm/prompt: встроенный тост или mainAppController.
    AtexCutPlanning.prototype.notify = function(message, kind) {
        if (kind === 'error' && typeof window !== 'undefined' && window.mainAppController &&
            typeof window.mainAppController.showErrorModal === 'function') {
            window.mainAppController.showErrorModal(message);
            return;
        }
        var toast = el('div', { class: 'atex-cp-toast atex-cp-toast-' + (kind || 'info'), text: message });
        (this.toastHost || document.body).appendChild(toast);
        setTimeout(function() { toast.classList.add('is-visible'); }, 10);
        setTimeout(function() {
            toast.classList.remove('is-visible');
            setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
        }, 3500);
    };

    AtexCutPlanning.prototype.fatal = function(message) {
        this.root.innerHTML = '';
        this.root.appendChild(el('div', { class: 'atex-cp-fatal', text: message }));
    };

    // Получить ширину входа для выбранного сырья.
    AtexCutPlanning.prototype.getInputWidth = function(materialId) {
        var mat = this.materials.filter(function(m) { return m.id === String(materialId); })[0];
        return mat ? mat.inputWidth : 0;
    };

    // ── Рендеринг ──

    AtexCutPlanning.prototype.render = function() {
        this.renderForm();
    };

    AtexCutPlanning.prototype.renderForm = function() {
        var self = this;
        var f = this.form;
        var form = this.formEl;
        form.innerHTML = '';

        form.appendChild(el('h2', { class: 'atex-cp-form-title', text: 'Расчёт резки' }));

        // Вид сырья (searchable-ref)
        var materialRef = this.refSelect({
            id: 'atex-cp-material',
            options: this.materials,
            value: f.materialId,
            placeholder: '— выберите сырьё —',
            reqId: reqIdByName(this.meta.cutType, CUT_REQ.material),
            onChange: function(value) { f.materialId = value || null; }
        });
        form.appendChild(field('Вид сырья', materialRef));

        // Целевая ширина + допуск — в одну строку
        var targetInput = el('input', { class: 'atex-cp-input', type: 'number', min: '0', step: 'any', placeholder: 'например, 60' });
        targetInput.value = f.targetWidth;
        targetInput.addEventListener('input', function() { f.targetWidth = targetInput.value; });

        var tolInput = el('input', { class: 'atex-cp-input', type: 'number', min: '0', step: 'any', placeholder: '20' });
        tolInput.value = f.tolerance;
        tolInput.addEventListener('input', function() { f.tolerance = tolInput.value; });

        var row = el('div', { class: 'atex-cp-fields-row' });
        row.appendChild(field('Целевая ширина, мм', targetInput));
        row.appendChild(field('Допуск, мм', tolInput));
        form.appendChild(row);

        // Кнопка «Подобрать»
        var suggestBtn = el('button', { class: 'atex-cp-btn atex-cp-btn-primary', type: 'button', text: 'Подобрать' });
        suggestBtn.addEventListener('click', function() { self.suggest(); });
        form.appendChild(el('div', { class: 'atex-cp-actions' }, [suggestBtn]));

        function field(label, control) {
            return el('div', { class: 'atex-cp-field' }, [
                el('label', { class: 'atex-cp-label', text: label }),
                control
            ]);
        }
    };

    // Запуск подбора по кнопке «Подобрать».
    AtexCutPlanning.prototype.suggest = function() {
        var self = this;
        var f = this.form;
        if (!f.materialId) { this.notify('Укажите вид сырья', 'error'); return; }
        if (!String(f.targetWidth).trim()) { this.notify('Укажите целевую ширину', 'error'); return; }
        var inputWidth = this.getInputWidth(f.materialId);
        if (!inputWidth) { this.notify('У выбранного сырья не задана «Ширина, мм»', 'error'); return; }
        if (this.busy) return;
        this.setBusy(true);
        this.loadPreferredWidths(f.materialId).then(function(candidates) {
            var result = suggestCombination(inputWidth, f.targetWidth, candidates, f.tolerance || '20');
            self.strips = result.strips.map(function(s) {
                return { id: null, width: s.width, qty: s.qty, purpose: s.purpose };
            });
            if (!self.strips.length) self.strips = [blankStrip()];
            self.setBusy(false);
            self.renderResult(inputWidth);
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка подбора: ' + err.message, 'error');
        });
    };

    // Отрисовка результата подбора (таблица полос + сводка).
    AtexCutPlanning.prototype.renderResult = function(inputWidth) {
        var self = this;
        var f = this.form;
        var iw = inputWidth !== undefined ? inputWidth : this.getInputWidth(f.materialId);
        var box = this.resultEl;
        box.innerHTML = '';
        box.style.display = '';

        box.appendChild(el('h3', { class: 'atex-cp-result-title', text: 'Предложенный раскрой' }));

        // Таблица полос
        var stripWrap = el('div', { class: 'atex-cp-strips' });
        stripWrap.appendChild(el('div', { class: 'atex-cp-strips-head' }, [
            el('span', { text: '№' }),
            el('span', { text: 'Ширина, мм' }),
            el('span', { text: 'Количество' }),
            el('span', { text: 'Назначение' }),
            el('span', { text: '' })
        ]));
        this.stripsBody = el('div', { class: 'atex-cp-strips-body' });
        stripWrap.appendChild(this.stripsBody);
        var addBtn = el('button', { class: 'atex-cp-btn atex-cp-btn-add', type: 'button', text: '+ Добавить полосу' });
        addBtn.addEventListener('click', function() {
            self.strips.push(blankStrip());
            self.renderStrips();
            self.recalc(iw);
        });
        stripWrap.appendChild(addBtn);
        box.appendChild(stripWrap);

        // Сводка
        this.summaryEl = el('div', { class: 'atex-cp-summary' });
        box.appendChild(this.summaryEl);

        // Кнопки результата
        var actions = el('div', { class: 'atex-cp-actions' });
        var saveBtn = el('button', {
            class: 'atex-cp-btn atex-cp-btn-primary',
            type: 'button',
            text: 'Сохранить как тип резки'
        });
        saveBtn.addEventListener('click', function() { self.saveAsCutType(); });
        actions.appendChild(saveBtn);
        box.appendChild(actions);

        this.renderStrips();
        this.recalc(iw);
    };

    AtexCutPlanning.prototype.renderStrips = function() {
        var self = this;
        // Захватываем inputWidth из form при каждом renderStrips через замыкание.
        var iw = this.getInputWidth(this.form.materialId);
        var body = this.stripsBody;
        body.innerHTML = '';
        this.strips.forEach(function(s, idx) {
            var row = el('div', { class: 'atex-cp-strip-row' });

            row.appendChild(el('span', { class: 'atex-cp-strip-num', text: String(idx + 1) }));

            var w = el('input', { class: 'atex-cp-input', type: 'number', min: '0', step: 'any', placeholder: '0' });
            w.value = s.width;
            w.addEventListener('input', function() { s.width = w.value; self.recalc(iw); });
            row.appendChild(w);

            var q = el('input', { class: 'atex-cp-input', type: 'number', min: '0', step: '1', placeholder: '0' });
            q.value = s.qty;
            q.addEventListener('input', function() { s.qty = q.value; self.recalc(iw); });
            row.appendChild(q);

            var p = el('select', { class: 'atex-cp-input' });
            PURPOSES.forEach(function(name) {
                var o = el('option', { value: name, text: name });
                if (s.purpose === name) o.selected = true;
                p.appendChild(o);
            });
            if (s.purpose && PURPOSES.indexOf(s.purpose) === -1) {
                var extra = el('option', { value: s.purpose, text: s.purpose });
                extra.selected = true;
                p.appendChild(extra);
            }
            p.addEventListener('change', function() { s.purpose = p.value; });
            row.appendChild(p);

            var del = el('button', { class: 'atex-cp-btn atex-cp-btn-del', type: 'button', title: 'Удалить полосу', text: '×' });
            del.addEventListener('click', function() {
                self.strips.splice(idx, 1);
                if (!self.strips.length) self.strips = [blankStrip()];
                self.renderStrips();
                self.recalc(iw);
            });
            row.appendChild(del);

            body.appendChild(row);
        });
    };

    // Пересчёт сводки (занятая ширина / остаток / в допуске).
    AtexCutPlanning.prototype.recalc = function(inputWidth) {
        if (!this.summaryEl) return;
        var iw = inputWidth !== undefined ? inputWidth : this.getInputWidth(this.form.materialId);
        var tol = this.form.tolerance || '20';
        var used = usedWidth(this.strips);
        var rem = remainder(iw, this.strips);
        var over = rem < 0;
        var within = !over && Math.abs(rem) <= Math.abs(toNumber(tol));

        this.summaryEl.innerHTML = '';
        this.summaryEl.appendChild(metric('Ширина входа, мм', iw));
        this.summaryEl.appendChild(metric('Занято, мм', used));
        var remNode = metric('Остаток, мм', rem);
        if (over || Math.abs(rem) > Math.abs(toNumber(tol))) remNode.classList.add('is-warn');
        else if (within) remNode.classList.add('is-ok');
        this.summaryEl.appendChild(remNode);
        var withinLabel = within ? 'Да' : (over ? 'Нет (перебор)' : 'Нет');
        this.summaryEl.appendChild(metric('В допуске', withinLabel));

        function metric(label, value) {
            return el('div', { class: 'atex-cp-metric' }, [
                el('span', { class: 'atex-cp-metric-label', text: label }),
                el('span', { class: 'atex-cp-metric-value', text: String(value) })
            ]);
        }
    };

    // ── Запуск ──

    AtexCutPlanning.prototype.start = function() {
        var self = this;
        this.root.innerHTML = '';
        var layout = el('div', { class: 'atex-cp-layout' });
        this.formEl = el('section', { class: 'atex-cp-form' });
        this.resultEl = el('section', { class: 'atex-cp-result' });
        this.resultEl.style.display = 'none';
        layout.appendChild(this.formEl);
        layout.appendChild(this.resultEl);
        this.root.appendChild(layout);
        this.toastHost = this.root;

        this.formEl.appendChild(el('div', { class: 'atex-cp-loading', text: 'Загрузка…' }));

        return this.loadMetadata()
            .then(function() { return Promise.all([self.loadMaterials(), self.loadCutTypes()]); })
            .then(function() { self.render(); })
            .catch(function(err) { self.fatal('Ошибка инициализации: ' + err.message); });
    };

    // Заготовка пустой полосы (module-level, не метод, чтобы не захламлять прототип).
    function blankStrip() {
        return { id: null, width: '', qty: '', purpose: PURPOSES[0] };
    }

    function init() {
        if (typeof document === 'undefined') return;
        var root = document.getElementById('atex-cut-planning');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        var controller = new AtexCutPlanning(root);
        root._atexCutPlanning = controller;
        controller.start();
    }

    return { calc: calc, Controller: AtexCutPlanning, init: init };
});
