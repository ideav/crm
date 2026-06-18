// Рабочее место atex «Расчёт оптимальной резки» (роли Диспетчер/Администратор).
//
// Калькулятор-визуализатор: по выбранному Виду сырья (ширина джамбо и длина
// рулона), желаемым ширинам полос и количеству рулонов для каждой подбирает
// раскладку ножей с минимальным отходом и показывает, сколько рулонов получится
// максимально близко к желаемому: количество резок (проходов джамбо), полосы
// и отход. Решение задачи ideav/crm#3465. Правила разработки рабочих мест —
// docs/WORKSPACE_DEVELOPMENT_GUIDE.md, раздел 3.12 docs/atex_workplaces.md.
//
// Рабочее место читающее: единственное обращение к данным — список «Видов сырья»
// (`object/{Вид сырья}/?JSON_OBJ`) для выпадающего списка с поиском. Ширина входа
// и длина рулона берутся из выбранного Вида сырья (реквизиты «Ширина, мм» и
// «Длина рулона, м»), но остаются редактируемыми. ID таблиц/реквизитов не
// хардкодятся — резолвятся по именам из `GET /{db}/metadata`.
//
// Модель расчёта (см. docs/atex_workplaces.md §3.12):
//   • джамбо шириной W режется вдоль на полосы; один проход (одна «резка») даёт
//     набор полос по числу ножей в раскладке;
//   • раскладка одного прохода = пропорциональный желаемым количествам набор
//     полос (назначение «Заказ»), уложенный в W максимально плотно, плюс добор
//     остатка теми же ширинами для минимизации отхода (назначение «Склад»);
//   • «Отход, мм» = W − Σ(ширина × количество) — необрезаемый край;
//   • число резок P подбирается так, чтобы итог по рулонам был максимально
//     близок к желаемому.
//
// Чистое ядро расчёта вынесено в объект `core` и экспортируется через
// module.exports для модульных тестов (experiments/atex-cut-optimizer.test.js).

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.AtexCutOptimizer = api;
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

    // Имена таблиц/реквизитов схемы atex (docs/atex_metadata.json). По именам
    // рабочее место находит конкретные числовые id в метаданных текущей сборки.
    var TABLE = { material: 'Вид сырья' };
    var MATERIAL_REQ = { width: 'Ширина, мм', length: 'Длина рулона, м' };

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
        return Math.round(toNumber(n) * 1000) / 1000;
    }

    // НОД двух целых неотрицательных чисел (алгоритм Евклида).
    function gcd2(a, b) {
        a = Math.abs(Math.round(a));
        b = Math.abs(Math.round(b));
        while (b) { var t = b; b = a % b; a = t; }
        return a;
    }

    // НОД списка положительных целых. Пустой/нулевой список → 1.
    function gcdAll(nums) {
        var g = 0;
        (nums || []).forEach(function(n) { g = gcd2(g, n); });
        return g > 0 ? g : 1;
    }

    // Нормализация желаемых полос: числовые ширина/количество, отбрасываются
    // строки без положительной ширины. Количество < 1 → 1 (нельзя хотеть 0).
    function normalizeItems(items) {
        return (items || []).map(function(it) {
            return { width: round3(it && it.width), qty: Math.max(1, Math.round(toNumber(it && it.qty))) };
        }).filter(function(it) { return it.width > 0; });
    }

    // Добор остатка `rem` полосами доступных ширин с минимальным остатком.
    // Точный поиск (DFS с лимитом) по конечному набору ширин: возвращает
    // counts (по индексу ширины) и итоговый leftover. Ширины — массив чисел.
    function fillRemainder(rem, widths, limitPerWidth) {
        var R = round3(rem);
        var cands = (widths || []).map(function(w, i) { return { width: round3(w), idx: i }; })
            .filter(function(c) { return c.width > 0 && c.width <= R; });
        var maxPer = limitPerWidth || 1000;
        var best = { counts: zeros(widths), leftover: R };
        var calls = 0, LIMIT = 200000;
        (function dfs(i, left, counts) {
            if (++calls > LIMIT) return;
            var leftR = round3(left);
            if (leftR < best.leftover) best = { counts: counts.slice(), leftover: leftR };
            if (leftR <= 0) return;
            for (var k = i; k < cands.length; k++) {
                var c = cands[k];
                if (c.width > leftR) continue;
                var maxQ = Math.min(maxPer, Math.floor(round3(leftR / c.width)));
                for (var q = maxQ; q >= 1; q--) {
                    counts[c.idx] += q;
                    dfs(k + 1, round3(leftR - c.width * q), counts);
                    counts[c.idx] -= q;
                }
            }
        })(0, R, zeros(widths));
        return best;

        function zeros(arr) { return (arr || []).map(function() { return 0; }); }
    }

    // Развернуть полосы прохода в отдельные сегменты-ножи с накопленным
    // смещением слева (offset) — геометрия раскладки для визуализации. Полосы:
    // [{width, qty, purpose}].
    function expandSegments(strips) {
        var segments = [];
        var offset = 0;
        (strips || []).forEach(function(s, stripIndex) {
            var width = round3(s.width);
            var count = Math.max(0, Math.round(toNumber(s.qty)));
            for (var k = 0; k < count; k++) {
                segments.push({
                    stripIndex: stripIndex,
                    width: width,
                    purpose: s.purpose || '',
                    offset: round3(offset)
                });
                offset = round3(offset + width);
            }
        });
        return segments;
    }

    // Полный расчёт плана резки.
    //   inputWidth — ширина джамбо, мм;
    //   items — желаемые полосы [{width, qty}] (qty — желаемое число рулонов);
    //   options.rollLength — длина рулона, м (для сводки, на геометрию не влияет);
    //   options.tolerance — допустимый отход, мм (для подсветки, необязательно).
    //
    // Возвращает объект плана: раскладка одного прохода (perPass), число резок
    // (passes), произведённые количества (results) и сводка по отходу.
    function computePlan(inputWidth, items, options) {
        options = options || {};
        var W = round3(inputWidth);
        var rollLength = round3(options.rollLength);
        var tol = (options.tolerance === undefined || options.tolerance === null || options.tolerance === '')
            ? null : Math.abs(toNumber(options.tolerance));

        var all = normalizeItems(items);
        var overflow = all.filter(function(it) { return it.width > W; });
        var usable = all.filter(function(it) { return it.width <= W; });

        var base = {
            inputWidth: W,
            rollLength: rollLength,
            tolerance: tol,
            items: all,
            overflow: overflow,
            feasible: false,
            reason: '',
            proportionKept: true,
            ratio: [],
            setWidth: 0,
            setsPerPass: 0,
            passes: 0,
            perPass: [],
            segments: [],
            usedWidthPerPass: 0,
            wastePerPass: 0,
            wastePctPerPass: 0,
            stripsPerPass: 0,
            results: [],
            totalDesired: 0,
            totalProduced: 0,
            totalWasteWidth: 0,
            totalWasteAreaM2: 0
        };

        if (W <= 0) { base.reason = 'Укажите ширину входа (джамбо) больше нуля.'; return base; }
        if (!usable.length) {
            base.reason = overflow.length
                ? 'Все заданные ширины больше ширины входа — раскроить нельзя.'
                : 'Добавьте хотя бы одну полосу (ширина и количество).';
            return base;
        }

        var widths = usable.map(function(it) { return it.width; });
        var qtys = usable.map(function(it) { return it.qty; });
        var g = gcdAll(qtys);
        var ratio = qtys.map(function(q) { return q / g; });
        var setWidth = round3(ratio.reduce(function(s, r, i) { return s + r * widths[i]; }, 0));
        var sets = setWidth > 0 ? Math.floor(round3(W / setWidth)) : 0;

        var baseCounts, surplusCounts, passes, proportionKept;

        if (sets >= 1) {
            // Пропорциональный путь: sets копий желаемого набора (Заказ) +
            // добор остатка теми же ширинами (Склад) для минимизации отхода.
            proportionKept = true;
            baseCounts = ratio.map(function(r) { return sets * r; });
            var usedByBase = round3(baseCounts.reduce(function(s, c, i) { return s + c * widths[i]; }, 0));
            var fill = fillRemainder(W - usedByBase, widths);
            surplusCounts = fill.counts;
            // Число резок: sets·P ≈ g, чтобы план был ближе всего к желаемому.
            passes = Math.max(1, Math.round(g / sets));
        } else {
            // Пропорциональный набор шире джамбо — пропорции не сохранить.
            // Best-effort: плотно набить ширину доступными ширинами.
            proportionKept = false;
            var packed = fillRemainder(W, widths);
            baseCounts = packed.counts;
            surplusCounts = widths.map(function() { return 0; });
            var perPassTotal = baseCounts.reduce(function(s, c) { return s + c; }, 0);
            var desiredTotal = qtys.reduce(function(s, q) { return s + q; }, 0);
            passes = perPassTotal > 0 ? Math.max(1, Math.round(desiredTotal / perPassTotal)) : 1;
        }

        // Раскладка прохода: c_i — всего полос ширины i за резку (плановые
        // наборы + добор остатка). Классификация Заказ/Склад — по потребности:
        // на резку под заказ нужно ceil(желаемо / число резок) полос, всё сверх
        // того (лишние пропорциональные наборы и добор) уходит на склад.
        var perPass = usable.map(function(it, i) {
            var total = (baseCounts[i] || 0) + (surplusCounts[i] || 0);
            var needPerPass = Math.ceil(it.qty / passes);
            var plan = Math.min(total, needPerPass);
            var surplus = total - plan;
            return {
                width: it.width,
                plan: plan,
                surplus: surplus,
                qty: total,
                purpose: 'Заказ'
            };
        });
        // Сегменты: сначала плановые полосы (Заказ), затем доборные (Склад).
        var planStrips = perPass.map(function(p) { return { width: p.width, qty: p.plan, purpose: 'Заказ' }; });
        var surplusStrips = perPass.filter(function(p) { return p.surplus > 0; })
            .map(function(p) { return { width: p.width, qty: p.surplus, purpose: 'Склад' }; });
        var segments = expandSegments(planStrips.concat(surplusStrips));

        var usedWidthPerPass = round3(perPass.reduce(function(s, p) { return s + p.width * p.qty; }, 0));
        var wastePerPass = round3(W - usedWidthPerPass);
        var stripsPerPass = perPass.reduce(function(s, p) { return s + p.qty; }, 0);

        var results = usable.map(function(it, i) {
            var per = perPass[i];
            var produced = per.qty * passes;
            return {
                width: it.width,
                desiredQty: it.qty,
                perPass: per.qty,
                perPassPlan: per.plan,
                perPassSurplus: per.surplus,
                produced: produced,
                plannedProduced: Math.min(produced, it.qty),
                surplusProduced: Math.max(0, produced - it.qty),
                deviation: produced - it.qty
            };
        });

        var totalDesired = qtys.reduce(function(s, q) { return s + q; }, 0);
        var totalProduced = results.reduce(function(s, r) { return s + r.produced; }, 0);
        var totalWasteWidth = round3(wastePerPass * passes);
        // Площадь отхода: ширина отхода (м) × длина рулона (м) × число проходов.
        var totalWasteAreaM2 = rollLength > 0 ? round3(wastePerPass / 1000 * rollLength * passes) : 0;

        base.feasible = true;
        base.proportionKept = proportionKept;
        base.ratio = ratio;
        base.setWidth = setWidth;
        base.setsPerPass = sets;
        base.passes = passes;
        base.perPass = perPass;
        base.segments = segments;
        base.usedWidthPerPass = usedWidthPerPass;
        base.wastePerPass = wastePerPass;
        base.wastePctPerPass = W > 0 ? round3(wastePerPass / W * 100) : 0;
        base.stripsPerPass = stripsPerPass;
        base.results = results;
        base.totalDesired = totalDesired;
        base.totalProduced = totalProduced;
        base.totalWasteWidth = totalWasteWidth;
        base.totalWasteAreaM2 = totalWasteAreaM2;
        base.withinTolerance = tol === null ? null : Math.abs(wastePerPass) <= tol;
        return base;
    }

    // Доля сегмента шириной `width` в шкале карты. Шкала — максимум из ширины
    // входа и занятой ширины, чтобы overflow оставался виден. Проценты [0..100].
    function widthPercent(width, plan) {
        var scale = Math.max(toNumber(plan && plan.inputWidth), toNumber(plan && plan.usedWidthPerPass));
        if (scale <= 0) return 0;
        return round3(toNumber(width) / scale * 100);
    }

    var core = {
        toNumber: toNumber,
        round3: round3,
        gcd2: gcd2,
        gcdAll: gcdAll,
        normalizeItems: normalizeItems,
        fillRemainder: fillRemainder,
        expandSegments: expandSegments,
        computePlan: computePlan,
        widthPercent: widthPercent
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

    // Класс назначения полосы → CSS-модификатор сегмента (цвет легенды).
    function purposeKind(purpose) {
        var p = String(purpose || '').trim().toLowerCase();
        if (p.indexOf('заказ') === 0) return 'order';
        if (p.indexOf('склад') === 0) return 'stock';
        return 'other';
    }

    // Индекс колонки реквизита по имени в JSON_OBJ-строке (колонки идут в
    // порядке [главное значение, ...reqs]; раздел 6 гайда).
    function colIndex(meta, reqName) {
        if (!meta) return -1;
        var order = [String(meta.id)].concat((meta.reqs || []).map(function(r) { return String(r.id); }));
        var found = (meta.reqs || []).filter(function(r) {
            return String(r.val).trim().toLowerCase() === String(reqName).trim().toLowerCase();
        })[0];
        return found ? order.indexOf(String(found.id)) : -1;
    }

    function cellValue(rec, meta, reqName) {
        var idx = colIndex(meta, reqName);
        var r = (rec && rec.r) || [];
        return idx >= 0 ? r[idx] : undefined;
    }

    function AtexCutOptimizer(root) {
        this.root = root;
        this.db = (typeof window !== 'undefined' && window.db) || root.getAttribute('data-db') || '';
        this.meta = { material: null };
        this.materials = [];      // [{ id, label, width, length }]
        this.materialId = '';
        this.rows = [{ width: '', qty: '1' }]; // желаемые полосы (UI-состояние)
        this.plan = null;
        this.busy = false;
    }

    AtexCutOptimizer.prototype.url = function(path) {
        return '/' + encodeURIComponent(this.db) + '/' + path;
    };

    AtexCutOptimizer.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                try { return JSON.parse(text); }
                catch (e) { throw new Error('Некорректный JSON: ' + text.slice(0, 200)); }
            });
        });
    };

    AtexCutOptimizer.prototype.loadMetadata = function() {
        var self = this;
        return this.getJson('metadata').then(function(all) {
            var list = Array.isArray(all) ? all : [all];
            self.meta.material = list.filter(function(t) {
                return String(t.val).trim().toLowerCase() === TABLE.material.trim().toLowerCase();
            })[0] || null;
            if (!self.meta.material) throw new Error('В метаданных не найдена таблица «' + TABLE.material + '»');
        });
    };

    // Список «Видов сырья» с шириной и длиной рулона — для поиска и автоподстановки.
    AtexCutOptimizer.prototype.loadMaterials = function() {
        var self = this;
        var meta = this.meta.material;
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            self.materials = (rows || []).map(function(rec) {
                return {
                    id: String(rec.i),
                    label: (rec.r && rec.r[0]) || ('#' + rec.i),
                    width: cellValue(rec, meta, MATERIAL_REQ.width) || '',
                    length: cellValue(rec, meta, MATERIAL_REQ.length) || ''
                };
            });
        });
    };

    AtexCutOptimizer.prototype.materialById = function(id) {
        var wanted = String(id);
        return this.materials.filter(function(m) { return String(m.id) === wanted; })[0] || null;
    };

    // ── Рендеринг каркаса ──

    AtexCutOptimizer.prototype.start = function() {
        var self = this;
        this.root.innerHTML = '';
        var layoutEl = el('div', { class: 'atex-co-layout' });

        // Левая колонка: форма ввода.
        this.formEl = el('section', { class: 'atex-co-form' });
        layoutEl.appendChild(this.formEl);

        // Правая колонка: результат расчёта.
        this.viewEl = el('section', { class: 'atex-co-view' });
        this.viewEl.appendChild(el('div', { class: 'atex-co-placeholder', text: 'Заполните параметры слева и нажмите «Рассчитать».' }));
        layoutEl.appendChild(this.viewEl);

        this.root.appendChild(layoutEl);
        this.toastHost = this.root;

        this.formEl.appendChild(el('div', { class: 'atex-co-loading', text: 'Загрузка справочника сырья…' }));

        return this.loadMetadata()
            .then(function() { return self.loadMaterials(); })
            .then(function() { self.renderForm(); })
            .catch(function(err) { self.fatal('Ошибка инициализации: ' + err.message); });
    };

    AtexCutOptimizer.prototype.renderForm = function() {
        var self = this;
        var form = this.formEl;
        form.innerHTML = '';
        form.appendChild(el('h2', { class: 'atex-co-form-title', text: 'Параметры резки' }));

        // Вид сырья — поиск по справочнику (AtexRefSearch).
        var matField = el('div', { class: 'atex-co-field' }, [
            el('label', { class: 'atex-co-label', text: 'Вид сырья' })
        ]);
        if (typeof window !== 'undefined' && window.AtexRefSearch && window.AtexRefSearch.createSelect) {
            var select = window.AtexRefSearch.createSelect({
                classPrefix: 'atex-co',
                options: this.materials.map(function(m) { return { id: m.id, label: m.label }; }),
                value: this.materialId,
                placeholder: 'Начните вводить вид сырья…',
                onChange: function(id) { self.onMaterialChange(id); }
            });
            matField.appendChild(select);
        } else {
            // Деградация без ref-search: обычный select.
            var sel = el('select', { class: 'atex-co-input' }, [ el('option', { value: '', text: '— не выбрано —' }) ]
                .concat(this.materials.map(function(m) { return el('option', { value: m.id, text: m.label }); })));
            sel.value = this.materialId;
            sel.addEventListener('change', function() { self.onMaterialChange(sel.value); });
            matField.appendChild(sel);
        }
        form.appendChild(matField);

        // Ширина входа и длина рулона.
        var dims = el('div', { class: 'atex-co-grid2' });
        this.widthInput = el('input', { class: 'atex-co-input', type: 'text', inputmode: 'decimal',
            placeholder: 'напр. 910', value: this.widthValue || '' });
        this.lengthInput = el('input', { class: 'atex-co-input', type: 'text', inputmode: 'decimal',
            placeholder: 'напр. 4000', value: this.lengthValue || '' });
        dims.appendChild(el('div', { class: 'atex-co-field' }, [
            el('label', { class: 'atex-co-label', text: 'Ширина входа (джамбо), мм' }), this.widthInput
        ]));
        dims.appendChild(el('div', { class: 'atex-co-field' }, [
            el('label', { class: 'atex-co-label', text: 'Длина рулона, м' }), this.lengthInput
        ]));
        form.appendChild(dims);

        // Желаемые полосы (ширина + количество), редактируемый список.
        form.appendChild(el('div', { class: 'atex-co-rows-head' }, [
            el('span', { class: 'atex-co-label', text: 'Желаемые рулоны' })
        ]));
        this.rowsEl = el('div', { class: 'atex-co-rows' });
        form.appendChild(this.rowsEl);
        this.renderRows();

        var addBtn = el('button', { class: 'atex-co-btn atex-co-btn-secondary', type: 'button', text: '+ Добавить ширину' });
        addBtn.addEventListener('click', function() { self.rows.push({ width: '', qty: '1' }); self.renderRows(); });
        form.appendChild(addBtn);

        // Допуск на отход (необязательно).
        this.tolInput = el('input', { class: 'atex-co-input', type: 'text', inputmode: 'decimal',
            placeholder: 'напр. 20', value: this.tolValue || '' });
        form.appendChild(el('div', { class: 'atex-co-field' }, [
            el('label', { class: 'atex-co-label', text: 'Допустимый отход, мм (необязательно)' }), this.tolInput
        ]));

        var calcBtn = el('button', { class: 'atex-co-btn atex-co-btn-primary', type: 'button', text: 'Рассчитать' });
        calcBtn.addEventListener('click', function() { self.calculate(); });
        form.appendChild(calcBtn);

        // Ctrl+Enter из любого поля формы — рассчитать (#3096-подобный UX).
        form.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); self.calculate(); }
        });
    };

    AtexCutOptimizer.prototype.renderRows = function() {
        var self = this;
        var box = this.rowsEl;
        box.innerHTML = '';
        this.rows.forEach(function(row, idx) {
            var widthInput = el('input', { class: 'atex-co-input', type: 'text', inputmode: 'decimal',
                placeholder: 'ширина, мм', value: row.width });
            widthInput.addEventListener('input', function() { row.width = widthInput.value; });
            var qtyInput = el('input', { class: 'atex-co-input', type: 'text', inputmode: 'numeric',
                placeholder: 'кол-во', value: row.qty });
            qtyInput.addEventListener('input', function() { row.qty = qtyInput.value; });
            var del = el('button', { class: 'atex-co-row-del', type: 'button', title: 'Удалить', text: '×' });
            del.addEventListener('click', function() {
                self.rows.splice(idx, 1);
                if (!self.rows.length) self.rows.push({ width: '', qty: '1' });
                self.renderRows();
            });
            box.appendChild(el('div', { class: 'atex-co-row' }, [widthInput, qtyInput, del]));
        });
    };

    AtexCutOptimizer.prototype.onMaterialChange = function(id) {
        this.materialId = String(id || '');
        var m = this.materialById(this.materialId);
        if (m) {
            // Автоподстановка ширины и длины из Вида сырья (поля остаются редактируемыми).
            if (this.widthInput) this.widthInput.value = String(m.width || '');
            if (this.lengthInput) this.lengthInput.value = String(m.length || '');
            this.widthValue = String(m.width || '');
            this.lengthValue = String(m.length || '');
        }
    };

    // ── Расчёт ──

    AtexCutOptimizer.prototype.calculate = function() {
        var inputWidth = this.widthInput ? this.widthInput.value : '';
        var rollLength = this.lengthInput ? this.lengthInput.value : '';
        var tolerance = this.tolInput ? this.tolInput.value : '';
        var items = this.rows.map(function(r) { return { width: r.width, qty: r.qty }; });
        this.plan = computePlan(inputWidth, items, { rollLength: rollLength, tolerance: tolerance });
        this.renderResult();
    };

    AtexCutOptimizer.prototype.renderResult = function() {
        var view = this.viewEl;
        view.innerHTML = '';
        var p = this.plan;
        if (!p) {
            view.appendChild(el('div', { class: 'atex-co-placeholder', text: 'Заполните параметры слева и нажмите «Рассчитать».' }));
            return;
        }
        if (!p.feasible) {
            view.appendChild(el('div', { class: 'atex-co-warn', text: p.reason }));
            return;
        }

        var mat = this.materialById(this.materialId);
        view.appendChild(el('h2', { class: 'atex-co-result-title',
            text: 'План резки' + (mat ? ': ' + mat.label : '') }));

        if (!p.proportionKept) {
            view.appendChild(el('div', { class: 'atex-co-note',
                text: 'Заданный набор шире джамбо — пропорции желаемых количеств сохранить нельзя; ширина набита максимально плотно.' }));
        }
        if (p.overflow && p.overflow.length) {
            view.appendChild(el('div', { class: 'atex-co-note',
                text: 'Не помещаются (шире джамбо): ' + p.overflow.map(function(o) { return o.width + ' мм'; }).join(', ') }));
        }

        view.appendChild(this.renderBar(p));
        view.appendChild(this.renderTable(p));
        view.appendChild(this.renderSummary(p));
    };

    AtexCutOptimizer.prototype.renderBar = function(p) {
        var wrap = el('div', { class: 'atex-co-bar-wrap' });
        wrap.appendChild(el('div', { class: 'atex-co-bar-caption' }, [
            el('span', { text: 'Раскладка одной резки · ширина входа: ' + p.inputWidth + ' мм' }),
            el('span', { class: 'atex-co-bar-caption-used', text: 'Занято: ' + p.usedWidthPerPass + ' мм' })
        ]));
        var bar = el('div', { class: 'atex-co-bar' });
        p.segments.forEach(function(seg) {
            var pct = widthPercent(seg.width, p);
            var kind = purposeKind(seg.purpose);
            var node = el('div', {
                class: 'atex-co-seg atex-co-seg-' + kind,
                title: seg.width + ' мм · ' + (seg.purpose || '')
            });
            node.style.width = pct + '%';
            if (pct >= 6) node.appendChild(el('span', { class: 'atex-co-seg-label', text: String(seg.width) }));
            bar.appendChild(node);
        });
        if (p.wastePerPass > 0) {
            var rpct = widthPercent(p.wastePerPass, p);
            var rem = el('div', { class: 'atex-co-seg atex-co-seg-remainder',
                title: 'Отход: ' + p.wastePerPass + ' мм' });
            rem.style.width = rpct + '%';
            if (rpct >= 6) rem.appendChild(el('span', { class: 'atex-co-seg-label', text: String(p.wastePerPass) }));
            bar.appendChild(rem);
        }
        wrap.appendChild(bar);
        wrap.appendChild(el('div', { class: 'atex-co-legend-keys' }, [
            legendKey('order', 'Заказ (план)'),
            legendKey('stock', 'Склад (добор)'),
            legendKey('remainder', 'Отход')
        ]));
        return wrap;

        function legendKey(kind, label) {
            return el('span', { class: 'atex-co-legend-key' }, [
                el('span', { class: 'atex-co-swatch atex-co-seg-' + kind }),
                document.createTextNode(label)
            ]);
        }
    };

    AtexCutOptimizer.prototype.renderTable = function(p) {
        var table = el('div', { class: 'atex-co-table' });
        table.appendChild(el('div', { class: 'atex-co-table-head' }, [
            el('span', { text: 'Ширина, мм' }),
            el('span', { text: 'Желаемо' }),
            el('span', { text: 'Полос/резку' }),
            el('span', { text: 'Получится' }),
            el('span', { text: 'Δ к желаемому' })
        ]));
        p.results.forEach(function(r) {
            var dev = (r.deviation > 0 ? '+' : '') + r.deviation;
            var devCls = 'atex-co-dev' + (r.deviation === 0 ? ' is-ok' : (r.deviation > 0 ? ' is-surplus' : ' is-short'));
            table.appendChild(el('div', { class: 'atex-co-table-row' }, [
                el('span', { text: String(r.width) }),
                el('span', { text: String(r.desiredQty) }),
                el('span', { text: String(r.perPass) + (r.perPassSurplus ? ' (+' + r.perPassSurplus + ' склад)' : '') }),
                el('span', { text: String(r.produced) }),
                el('span', { class: devCls, text: dev })
            ]));
        });
        return table;
    };

    AtexCutOptimizer.prototype.renderSummary = function(p) {
        var summary = el('div', { class: 'atex-co-summary' });
        summary.appendChild(metric('Кол-во резок', p.passes));
        summary.appendChild(metric('Полос за резку', p.stripsPerPass));
        summary.appendChild(metric('Итого рулонов', p.totalProduced + ' / ' + p.totalDesired));
        var waste = metric('Отход/резку, мм', p.wastePerPass + ' (' + p.wastePctPerPass + '%)');
        if (p.withinTolerance === true) waste.classList.add('is-ok');
        else if (p.withinTolerance === false) waste.classList.add('is-warn');
        summary.appendChild(waste);
        if (p.totalWasteAreaM2 > 0) summary.appendChild(metric('Общий отход, м²', p.totalWasteAreaM2));
        return summary;

        function metric(label, value) {
            return el('div', { class: 'atex-co-metric' }, [
                el('span', { class: 'atex-co-metric-label', text: label }),
                el('span', { class: 'atex-co-metric-value', text: String(value) })
            ]);
        }
    };

    AtexCutOptimizer.prototype.setBusy = function(on) {
        this.busy = on;
        if (this.root) this.root.classList.toggle('is-busy', !!on);
    };

    AtexCutOptimizer.prototype.notify = function(message, kind) {
        if (kind === 'error' && typeof window !== 'undefined' && window.mainAppController &&
            typeof window.mainAppController.showErrorModal === 'function') {
            window.mainAppController.showErrorModal(message);
            return;
        }
        var toast = el('div', { class: 'atex-co-toast atex-co-toast-' + (kind || 'info'), text: message });
        (this.toastHost || document.body).appendChild(toast);
        setTimeout(function() { toast.classList.add('is-visible'); }, 10);
        setTimeout(function() {
            toast.classList.remove('is-visible');
            setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
        }, 3500);
    };

    AtexCutOptimizer.prototype.fatal = function(message) {
        this.root.innerHTML = '';
        this.root.appendChild(el('div', { class: 'atex-co-fatal', text: message }));
    };

    function init() {
        if (typeof document === 'undefined') return;
        var root = document.getElementById('atex-cut-optimizer');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        var controller = new AtexCutOptimizer(root);
        root._atexCutOptimizer = controller;
        controller.start();
    }

    return { core: core, Controller: AtexCutOptimizer, init: init };
});
