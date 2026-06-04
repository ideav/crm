// Рабочее место atex «Карта раскроя» (роль Оператор).
//
// Визуализация раскроя выбранной производственной резки: её полосы
// (ширина × количество, назначение) на ширине входа плюс остаток. Решение
// задачи ideav/crm#2917 (часть #2903). Правила разработки рабочих мест —
// docs/WORKSPACE_DEVELOPMENT_GUIDE.md, раздел 3.7 docs/atex_workplaces.md.
//
// Рабочее место преимущественно читающее. На этом этапе оно обращается к данным
// напрямую командами `_m_*`/`object` (#2903): список резок и одна резка —
// `object/{Производственная резка}/?JSON_OBJ[&F_I=…]`; полосы резки — её
// подчинённые записи `object/{Полоса}/?F_U={резкаId}` (после упразднения «Типа
// резки» «Полоса» подчинена напрямую «Производственной резке»). Ширина входа
// (джамбо) берётся из Партии сырья резки → Вид сырья «Ширина, мм». ID таблиц и
// реквизитов не хардкодятся: они берутся по именам из `GET /{db}/metadata`
// (WORKSPACE_DEVELOPMENT_GUIDE.md, разделы 3 и 6). Перевод чтений на защищённый
// слой `report/` — следующий этап и в объём этой задачи не входит.
//
// Геометрия карты (дизайн-спека atex, раздел «Полоса»):
//   • ширина входа — общая ширина рулона на входе слиттера;
//   • каждая полоса даёт «количество» ножей по «ширине»;
//   • «Занято, мм» = Σ(ширина полосы × количество);
//   • «Остаток, мм» = «Ширина входа» − «Занято, мм» (обрезь / непокрытая часть).
//
// Чистое ядро раскладки вынесено в объект `layout` и экспортируется через
// module.exports для модульных тестов (experiments/atex-cut-map.test.js).

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.AtexCutMap = api;
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
        strip: 'Полоса',
        materialBatch: 'Партия сырья',
        material: 'Вид сырья'
    };
    var CUT_REQ = { materialBatch: 'Партия сырья', slitter: 'Слиттер', status: 'Статус', planDate: 'Дата план' };
    var BATCH_REQ = { material: 'Вид сырья' };
    var MATERIAL_REQ = { width: 'Ширина, мм' };
    var STRIP_REQ = { width: 'Ширина, мм', qty: 'Количество', purpose: 'Назначение' };

    // ───────────────────────── Чистое ядро раскладки ─────────────────────────

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

    // Каждая полоса даёт «количество» отдельных ножей шириной «ширина». Карта
    // раскроя показывает каждый нож отдельным сегментом, поэтому ядро
    // разворачивает полосы в последовательность сегментов с накопленным
    // смещением слева (offset) — это и есть геометрия раскладки по ширине входа.
    function expandSegments(strips) {
        var segments = [];
        var offset = 0;
        (strips || []).forEach(function(s, stripIndex) {
            var width = round3(toNumber(s.width));
            var count = Math.max(0, Math.round(toNumber(s.qty)));
            for (var k = 0; k < count; k++) {
                segments.push({
                    stripIndex: stripIndex,
                    indexInStrip: k,
                    width: width,
                    purpose: s.purpose || '',
                    label: (s.name == null ? '' : String(s.name)),
                    offset: round3(offset)
                });
                offset = round3(offset + width);
            }
        });
        return segments;
    }

    // Полная раскладка резки: сегменты ножей, занятая ширина, остаток и флаги.
    //   • remainder < 0  → полосы превышают ширину входа (overflow);
    //   • withinTolerance — |остаток| ≤ допуск (null, если допуск не задан).
    function computeLayout(inputWidth, strips, tolerance) {
        var W = round3(toNumber(inputWidth));
        var segments = expandSegments(strips);
        var used = usedWidth(strips);
        var rem = round3(W - used);
        var tol = (tolerance === undefined || tolerance === null || tolerance === '')
            ? null : Math.abs(toNumber(tolerance));
        return {
            inputWidth: W,
            usedWidth: used,
            remainder: rem,
            totalKnives: totalKnives(strips),
            stripKinds: (strips || []).length,
            segments: segments,
            overflow: rem < 0,
            tolerance: tol,
            withinTolerance: tol === null ? null : Math.abs(rem) <= tol
        };
    }

    // Доля сегмента шириной `width` в общей шкале карты. Шкала — максимум из
    // ширины входа и занятой ширины, чтобы при overflow карта не «вылезала» за
    // 100 %, а наглядно показывала превышение. Возвращает проценты [0..100].
    function widthPercent(width, layoutResult) {
        var scale = Math.max(toNumber(layoutResult && layoutResult.inputWidth),
            toNumber(layoutResult && layoutResult.usedWidth));
        if (scale <= 0) return 0;
        return round3(toNumber(width) / scale * 100);
    }

    var layout = {
        toNumber: toNumber,
        round3: round3,
        totalKnives: totalKnives,
        usedWidth: usedWidth,
        expandSegments: expandSegments,
        computeLayout: computeLayout,
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

    // Класс назначения полосы → CSS-модификатор сегмента (цвет легенды).
    function purposeKind(purpose) {
        var p = String(purpose || '').trim().toLowerCase();
        if (p.indexOf('заказ') === 0) return 'order';
        if (p.indexOf('склад') === 0) return 'stock';
        if (p.indexOf('отход') === 0) return 'waste';
        return 'other';
    }

    function AtexCutMap(root) {
        this.root = root;
        this.db = window.db || root.getAttribute('data-db') || '';
        this.meta = { cut: null, strip: null, materialBatch: null, material: null };
        this.cuts = [];          // список производственных резок [{ id, name, statusLabel }]
        this.current = null;     // выбранная резка с раскладкой
        this.busy = false;
    }

    AtexCutMap.prototype.url = function(path) {
        return '/' + encodeURIComponent(this.db) + '/' + path;
    };

    // GET → JSON. Бросает Error при сетевой/JSON-ошибке.
    AtexCutMap.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                try { return JSON.parse(text); }
                catch (e) { throw new Error('Некорректный JSON: ' + text.slice(0, 200)); }
            });
        });
    };

    // Индекс колонки реквизита `reqName` в массиве r из JSON_OBJ. Колонки идут
    // в порядке [главное значение, ...reqs по порядку] (раздел 6 гайда).
    function colIndex(meta, reqName) {
        var order = [String(meta.id)].concat((meta.reqs || []).map(function(r) { return String(r.id); }));
        var rid = reqIdByName(meta, reqName);
        var idx = order.indexOf(String(rid));
        return idx >= 0 ? idx : -1;
    }

    function cellValue(rec, meta, reqName) {
        var idx = colIndex(meta, reqName);
        var r = (rec && rec.r) || [];
        return idx >= 0 ? r[idx] : undefined;
    }

    // ── Загрузка метаданных ──

    AtexCutMap.prototype.loadMetadata = function() {
        var self = this;
        return this.getJson('metadata').then(function(all) {
            var list = Array.isArray(all) ? all : [all];
            function byName(name) {
                return list.filter(function(t) {
                    return String(t.val).trim().toLowerCase() === name.trim().toLowerCase();
                })[0] || null;
            }
            self.meta.cut = byName(TABLE.cut);
            self.meta.strip = byName(TABLE.strip);
            // Партия сырья / Вид сырья нужны для ширины входа (джамбо). Опциональны:
            // если их нет в метаданных — сработает fallback по сумме ширин полос.
            self.meta.materialBatch = byName(TABLE.materialBatch);
            self.meta.material = byName(TABLE.material);
            if (!self.meta.cut) throw new Error('В метаданных не найдена таблица «' + TABLE.cut + '»');
            if (!self.meta.strip) throw new Error('В метаданных не найдена таблица «' + TABLE.strip + '»');
        });
    };

    // ── Список производственных резок ──

    AtexCutMap.prototype.loadCuts = function() {
        var self = this;
        var meta = this.meta.cut;
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            self.cuts = (rows || []).map(function(rec) {
                return {
                    id: String(rec.i),
                    name: (rec.r && rec.r[0]) || ('#' + rec.i),
                    statusLabel: parseRef(cellValue(rec, meta, CUT_REQ.status)).label || ''
                };
            });
        });
    };

    // ── Чтение одной резки: её полосы (F_U) + ширина входа из сырья ──
    // «Полоса» подчинена напрямую «Производственной резке», поэтому полосы
    // грузятся по F_U={резкаId}. Ширина входа (джамбо) берётся из Партии сырья
    // резки → Вид сырья «Ширина, мм» (как в F3); если её не достать — fallback
    // на сумму ширин полос (визуализация без остатка).

    AtexCutMap.prototype.loadCut = function(id) {
        var self = this;
        var cutMeta = this.meta.cut;
        return this.getJson('object/' + cutMeta.id + '/?JSON_OBJ&F_I=' + encodeURIComponent(id)).then(function(rows) {
            var rec = (rows || [])[0];
            if (!rec) throw new Error('Производственная резка #' + id + ' не найдена');
            var batchRef = parseRef(cellValue(rec, cutMeta, CUT_REQ.materialBatch));
            self.current = {
                id: String(rec.i),
                name: (rec.r && rec.r[0]) || ('#' + rec.i),
                slitter: parseRef(cellValue(rec, cutMeta, CUT_REQ.slitter)).label || '',
                status: parseRef(cellValue(rec, cutMeta, CUT_REQ.status)).label || '',
                planDate: cellValue(rec, cutMeta, CUT_REQ.planDate) || '',
                materialBatchId: batchRef.id,
                material: batchRef.label || '',
                inputWidth: '',
                tolerance: '',
                strips: [],
                layout: null
            };
            return self.loadStrips(self.current.id);
        }).then(function() {
            // Ширина входа: Партия сырья → Вид сырья «Ширина, мм». Best-effort.
            return self.loadJumboWidth(self.current.materialBatchId);
        }).then(function() {
            var c = self.current;
            if (!c) return;
            // Fallback: нет ширины джамбо из сырья → берём сумму ширин полос,
            // тогда остаток нулевой и карта показывает только сами полосы.
            var inputWidth = layout.toNumber(c.inputWidth);
            if (inputWidth <= 0) inputWidth = layout.usedWidth(c.strips);
            c.layout = computeLayout(inputWidth, c.strips, c.tolerance);
        });
    };

    // Полосы резки — её подчинённые записи по F_U={резкаId}.
    AtexCutMap.prototype.loadStrips = function(cutId) {
        var self = this;
        var meta = this.meta.strip;
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(cutId) + '&LIMIT=0,1000').then(function(rows) {
            self.current.strips = (rows || []).map(function(rec) {
                return {
                    id: String(rec.i),
                    name: (rec.r && rec.r[0]) || '',
                    width: cellValue(rec, meta, STRIP_REQ.width) || '',
                    qty: cellValue(rec, meta, STRIP_REQ.qty) || '',
                    purpose: cellValue(rec, meta, STRIP_REQ.purpose) || ''
                };
            });
        });
    };

    // Ширина входа (джамбо) из сырья: Партия сырья (batchId) → Вид сырья → «Ширина,
    // мм». Best-effort: при отсутствии метаданных/записей/ссылок тихо выходит,
    // оставляя current.inputWidth пустым (сработает fallback в loadCut).
    AtexCutMap.prototype.loadJumboWidth = function(batchId) {
        var self = this;
        var batchMeta = this.meta.materialBatch;
        var materialMeta = this.meta.material;
        if (!batchId || !batchMeta || !materialMeta) return Promise.resolve();
        return this.getJson('object/' + batchMeta.id + '/?JSON_OBJ&F_I=' + encodeURIComponent(batchId)).then(function(rows) {
            var rec = (rows || [])[0];
            if (!rec) return null;
            var materialRef = parseRef(cellValue(rec, batchMeta, BATCH_REQ.material));
            if (self.current && materialRef.label) self.current.material = materialRef.label;
            if (!materialRef.id) return null;
            return self.getJson('object/' + materialMeta.id + '/?JSON_OBJ&F_I=' + encodeURIComponent(materialRef.id)).then(function(mrows) {
                var mrec = (mrows || [])[0];
                if (!mrec || !self.current) return;
                self.current.inputWidth = cellValue(mrec, materialMeta, MATERIAL_REQ.width) || '';
            });
        });
    };

    // ── Рендеринг ──

    AtexCutMap.prototype.render = function() {
        this.renderList();
        this.renderMap();
    };

    AtexCutMap.prototype.renderList = function() {
        var self = this;
        var box = this.listEl;
        box.innerHTML = '';
        if (!this.cuts.length) {
            box.appendChild(el('div', { class: 'atex-cm-empty', text: 'Производственных резок пока нет' }));
            return;
        }
        this.cuts.forEach(function(cut) {
            var active = self.current && String(self.current.id) === String(cut.id);
            var item = el('button', {
                class: 'atex-cm-list-item' + (active ? ' is-active' : ''),
                type: 'button'
            }, [
                el('span', { class: 'atex-cm-list-name', text: cut.name }),
                cut.statusLabel ? el('span', { class: 'atex-cm-list-status', text: cut.statusLabel }) : null
            ]);
            item.addEventListener('click', function() { self.openCut(cut.id); });
            box.appendChild(item);
        });
    };

    AtexCutMap.prototype.renderMap = function() {
        var view = this.viewEl;
        view.innerHTML = '';
        var c = this.current;
        if (!c) {
            view.appendChild(el('div', { class: 'atex-cm-placeholder', text: 'Выберите производственную резку слева, чтобы увидеть карту раскроя.' }));
            return;
        }

        // Шапка резки.
        view.appendChild(this.renderHeader(c));

        if (!c.strips || !c.strips.length) {
            view.appendChild(el('div', { class: 'atex-cm-placeholder', text: 'У этой резки нет полос — раскраивать нечего.' }));
            return;
        }

        var lay = c.layout;
        // Карта-полоса.
        view.appendChild(this.renderBar(lay));
        // Легенда по типам полос.
        view.appendChild(this.renderLegend(c.strips, lay));
        // Сводка.
        view.appendChild(this.renderSummary(lay));
    };

    AtexCutMap.prototype.renderHeader = function(c) {
        var rows = [
            ['Резка', c.name],
            ['Вид сырья', c.material || '—'],
            ['Слиттер', c.slitter || '—'],
            ['Статус', c.status || '—']
        ];
        var head = el('div', { class: 'atex-cm-header' });
        head.appendChild(el('h2', { class: 'atex-cm-header-title', text: 'Карта раскроя: ' + c.name }));
        var grid = el('div', { class: 'atex-cm-header-grid' });
        rows.forEach(function(pair) {
            grid.appendChild(el('div', { class: 'atex-cm-header-cell' }, [
                el('span', { class: 'atex-cm-header-label', text: pair[0] }),
                el('span', { class: 'atex-cm-header-value', text: String(pair[1]) })
            ]));
        });
        head.appendChild(grid);
        return head;
    };

    AtexCutMap.prototype.renderBar = function(lay) {
        var wrap = el('div', { class: 'atex-cm-bar-wrap' });
        wrap.appendChild(el('div', { class: 'atex-cm-bar-caption' }, [
            el('span', { text: 'Ширина входа: ' + lay.inputWidth + ' мм' }),
            el('span', { class: 'atex-cm-bar-caption-used', text: 'Занято: ' + lay.usedWidth + ' мм' })
        ]));

        var bar = el('div', { class: 'atex-cm-bar' + (lay.overflow ? ' is-overflow' : '') });
        lay.segments.forEach(function(seg) {
            var pct = widthPercent(seg.width, lay);
            var kind = purposeKind(seg.purpose);
            var title = (seg.label ? seg.label + ' · ' : '') + seg.width + ' мм' + (seg.purpose ? ' · ' + seg.purpose : '');
            var segNode = el('div', {
                class: 'atex-cm-seg atex-cm-seg-' + kind,
                title: title,
                dataset: { width: String(seg.width) }
            });
            segNode.style.width = pct + '%';
            if (pct >= 6) segNode.appendChild(el('span', { class: 'atex-cm-seg-label', text: String(seg.width) }));
            bar.appendChild(segNode);
        });

        // Остаток-обрезь: рисуется хвостом, только если ширина входа не превышена.
        if (lay.remainder > 0) {
            var rpct = widthPercent(lay.remainder, lay);
            var rem = el('div', {
                class: 'atex-cm-seg atex-cm-seg-remainder',
                title: 'Остаток (обрезь): ' + lay.remainder + ' мм'
            });
            rem.style.width = rpct + '%';
            if (rpct >= 6) rem.appendChild(el('span', { class: 'atex-cm-seg-label', text: String(lay.remainder) }));
            bar.appendChild(rem);
        }
        wrap.appendChild(bar);

        if (lay.overflow) {
            wrap.appendChild(el('div', { class: 'atex-cm-warn', text: 'Полосы превышают ширину входа на ' + Math.abs(lay.remainder) + ' мм.' }));
        }
        return wrap;
    };

    AtexCutMap.prototype.renderLegend = function(strips, lay) {
        var legend = el('div', { class: 'atex-cm-legend' });
        legend.appendChild(el('div', { class: 'atex-cm-legend-head' }, [
            el('span', { text: '№' }),
            el('span', { text: 'Ширина, мм' }),
            el('span', { text: 'Кол-во' }),
            el('span', { text: 'Назначение' }),
            el('span', { text: 'Итого, мм' })
        ]));
        (strips || []).forEach(function(s, idx) {
            var w = toNumber(s.width);
            var n = toNumber(s.qty);
            var kind = purposeKind(s.purpose);
            legend.appendChild(el('div', { class: 'atex-cm-legend-row' }, [
                el('span', { class: 'atex-cm-legend-num' }, [
                    el('span', { class: 'atex-cm-swatch atex-cm-seg-' + kind }),
                    document.createTextNode(String(idx + 1))
                ]),
                el('span', { text: String(s.width || 0) }),
                el('span', { text: String(s.qty || 0) }),
                el('span', { text: s.purpose || '—' }),
                el('span', { text: String(round3(w * n)) })
            ]));
        });
        if (!(strips || []).length) {
            legend.appendChild(el('div', { class: 'atex-cm-empty', text: 'У резки нет полос' }));
        }
        return legend;
    };

    AtexCutMap.prototype.renderSummary = function(lay) {
        var summary = el('div', { class: 'atex-cm-summary' });
        summary.appendChild(metric('Ширина входа, мм', lay.inputWidth));
        summary.appendChild(metric('Итого ножей', lay.totalKnives));
        summary.appendChild(metric('Занято, мм', lay.usedWidth));
        var rem = metric('Остаток, мм', lay.remainder);
        if (lay.overflow || lay.withinTolerance === false) rem.classList.add('is-warn');
        else if (lay.withinTolerance === true) rem.classList.add('is-ok');
        summary.appendChild(rem);
        return summary;

        function metric(label, value) {
            return el('div', { class: 'atex-cm-metric' }, [
                el('span', { class: 'atex-cm-metric-label', text: label }),
                el('span', { class: 'atex-cm-metric-value', text: String(value) })
            ]);
        }
    };

    // ── Действия ──

    AtexCutMap.prototype.openCut = function(id) {
        var self = this;
        this.setBusy(true);
        this.loadCut(id).then(function() {
            self.setBusy(false);
            self.render();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Не удалось открыть резку: ' + err.message, 'error');
        });
    };

    AtexCutMap.prototype.refresh = function() {
        var self = this;
        var currentId = this.current && this.current.id;
        this.setBusy(true);
        this.loadCuts().then(function() {
            if (currentId && self.cuts.some(function(c) { return String(c.id) === String(currentId); })) {
                return self.loadCut(currentId);
            }
            self.current = null;
        }).then(function() {
            self.setBusy(false);
            self.render();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Не удалось обновить список: ' + err.message, 'error');
        });
    };

    AtexCutMap.prototype.setBusy = function(on) {
        this.busy = on;
        if (this.root) this.root.classList.toggle('is-busy', !!on);
    };

    // Уведомления без alert/confirm/prompt (раздел 8 гайда): встроенный тост,
    // либо общий MainAppController, если он доступен в main.html.
    AtexCutMap.prototype.notify = function(message, kind) {
        if (kind === 'error' && typeof window !== 'undefined' && window.mainAppController &&
            typeof window.mainAppController.showErrorModal === 'function') {
            window.mainAppController.showErrorModal(message);
            return;
        }
        var toast = el('div', { class: 'atex-cm-toast atex-cm-toast-' + (kind || 'info'), text: message });
        (this.toastHost || document.body).appendChild(toast);
        setTimeout(function() { toast.classList.add('is-visible'); }, 10);
        setTimeout(function() {
            toast.classList.remove('is-visible');
            setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
        }, 3500);
    };

    AtexCutMap.prototype.fatal = function(message) {
        this.root.innerHTML = '';
        this.root.appendChild(el('div', { class: 'atex-cm-fatal', text: message }));
    };

    AtexCutMap.prototype.start = function() {
        var self = this;
        // Каркас разметки: список резок слева, карта справа.
        this.root.innerHTML = '';
        var layoutEl = el('div', { class: 'atex-cm-layout' });
        var aside = el('aside', { class: 'atex-cm-sidebar' });
        var head = el('div', { class: 'atex-cm-sidebar-head' }, [ el('h2', { text: 'Резки' }) ]);
        var refreshBtn = el('button', { class: 'atex-cm-btn atex-cm-btn-secondary', type: 'button', title: 'Обновить список', text: '⟳' });
        refreshBtn.addEventListener('click', function() { self.refresh(); });
        head.appendChild(refreshBtn);
        aside.appendChild(head);
        this.listEl = el('div', { class: 'atex-cm-list' });
        aside.appendChild(this.listEl);

        this.viewEl = el('section', { class: 'atex-cm-view' });
        layoutEl.appendChild(aside);
        layoutEl.appendChild(this.viewEl);
        this.root.appendChild(layoutEl);
        this.toastHost = this.root;

        this.listEl.appendChild(el('div', { class: 'atex-cm-empty', text: 'Загрузка…' }));
        this.viewEl.appendChild(el('div', { class: 'atex-cm-placeholder', text: 'Загрузка карты раскроя…' }));

        return this.loadMetadata()
            .then(function() { return self.loadCuts(); })
            .then(function() { self.render(); })
            .catch(function(err) { self.fatal('Ошибка инициализации: ' + err.message); });
    };

    function init() {
        if (typeof document === 'undefined') return;
        var root = document.getElementById('atex-cut-map');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        var controller = new AtexCutMap(root);
        root._atexCutMap = controller;
        controller.start();
    }

    return { layout: layout, Controller: AtexCutMap, init: init };
});
