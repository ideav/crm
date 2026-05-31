// Рабочее место atex «Дашборды и отчёты» (роль Руководитель).
//
// Сводки только для чтения по живым данным: заказы по статусам, загрузка
// слиттеров, выпуск готовой продукции (ГП), остатки сырья. Решение задачи
// ideav/crm#2919 (часть #2903). Правила разработки рабочих мест —
// docs/WORKSPACE_DEVELOPMENT_GUIDE.md, раздел про дашборды — atex_workplaces.md §3.9.
//
// На этом этапе рабочее место читает данные напрямую из таблиц (#2903):
//   • счётчики    — `GET /{db}/object/{typeId}/?_count=&JSON=1` (+ фильтры F_{reqId});
//   • списки/срезы — `GET /{db}/object/{typeId}/?JSON_OBJ&LIMIT={offset},{count}`
//     постранично (WORKSPACE_DEVELOPMENT_GUIDE.md, раздел 6).
// Запись отсутствует — дашборд только читает. ID таблиц и реквизитов не
// хардкодятся: они резолвятся по именам из `GET /{db}/metadata?JSON=1`, поэтому
// код переживает пересборку базы. Перевод чтений на защищённый слой `report/` —
// следующий этап и в объём этой задачи не входит (atex_workplaces.md §3.9).
//
// Чистое ядро агрегации вынесено в объект `agg` и экспортируется через
// module.exports для модульных тестов (experiments/atex-dashboards.test.js).

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.AtexDashboards = api;
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
        order: 'Заказ',
        cut: 'Производственная резка',
        gp: 'Партия ГП',
        rawBatch: 'Партия сырья'
    };
    var ORDER_REQ = { status: 'Статус', created: 'Дата создания' };
    var CUT_REQ = { slitter: 'Слиттер', status: 'Статус', footage: 'Погонаж факт, м' };
    var GP_REQ = { status: 'Статус', rolls: 'Кол-во рулонов', footage: 'Метраж, м' };
    var RAW_REQ = { material: 'Вид сырья', received: 'Получено, м²', remainder: 'Остаток, м²' };

    // Метка для записей без значения в группирующем поле.
    var UNSET = '— не задано —';

    // ───────────────────────── Чистое ядро агрегации ─────────────────────────

    // Терпимый разбор числа: принимает запятую как десятичный разделитель,
    // отбрасывает пробелы и единицы измерения; «пусто»/мусор → 0.
    function toNumber(value) {
        if (typeof value === 'number') return isFinite(value) ? value : 0;
        var text = String(value == null ? '' : value).replace(/[^0-9,.\-]/g, '').replace(',', '.');
        var n = parseFloat(text);
        return isFinite(n) ? n : 0;
    }

    // Округление до 3 знаков, чтобы убрать артефакты float-арифметики.
    function round3(n) {
        return Math.round(n * 1000) / 1000;
    }

    function label(value) {
        var s = String(value == null ? '' : value).trim();
        return s === '' ? UNSET : s;
    }

    // Группировка записей по ключу: возвращает [{ key, count, ... }],
    // отсортированный по убыванию count, затем по ключу (стабильно).
    // accumulate(acc, item) донакапливает доп. метрики в группе.
    function groupBy(records, keyFn, accumulate) {
        var map = {};
        var order = [];
        (records || []).forEach(function(item) {
            var key = label(keyFn(item));
            if (!map[key]) { map[key] = { key: key, count: 0 }; order.push(key); }
            map[key].count += 1;
            if (accumulate) accumulate(map[key], item);
        });
        return order.map(function(k) { return map[k]; }).sort(function(a, b) {
            if (b.count !== a.count) return b.count - a.count;
            return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0);
        });
    }

    function sumBy(records, valueFn) {
        return round3((records || []).reduce(function(sum, item) {
            return sum + toNumber(valueFn(item));
        }, 0));
    }

    // «Заказы по статусам» — счётчики заказов, сгруппированные по статусу.
    // orders: [{ status }]. → { total, rows: [{ key, count }] }.
    function ordersByStatus(orders) {
        return {
            total: (orders || []).length,
            rows: groupBy(orders, function(o) { return o.status; })
        };
    }

    // «Загрузка слиттеров» — резки, сгруппированные по слиттеру, с количеством
    // и суммарным погонажем. cuts: [{ slitter, status, footage }].
    // → { total, totalFootage, rows: [{ key, count, footage }], byStatus }.
    function slitterLoad(cuts) {
        var rows = groupBy(cuts, function(c) { return c.slitter; }, function(acc, c) {
            acc.footage = round3((acc.footage || 0) + toNumber(c.footage));
        });
        return {
            total: (cuts || []).length,
            totalFootage: sumBy(cuts, function(c) { return c.footage; }),
            rows: rows,
            byStatus: groupBy(cuts, function(c) { return c.status; })
        };
    }

    // «Выпуск ГП» — партии готовой продукции: всего партий, рулонов, метража,
    // разбивка по статусу. batches: [{ status, rolls, footage }].
    function gpOutput(batches) {
        return {
            total: (batches || []).length,
            totalRolls: sumBy(batches, function(b) { return b.rolls; }),
            totalFootage: sumBy(batches, function(b) { return b.footage; }),
            byStatus: groupBy(batches, function(b) { return b.status; })
        };
    }

    // «Остатки сырья» — партии сырья, сгруппированные по виду сырья, с суммами
    // «Получено, м²» и «Остаток, м²». batches: [{ material, received, remainder }].
    function materialStock(batches) {
        var rows = groupBy(batches, function(b) { return b.material; }, function(acc, b) {
            acc.received = round3((acc.received || 0) + toNumber(b.received));
            acc.remainder = round3((acc.remainder || 0) + toNumber(b.remainder));
        });
        return {
            total: (batches || []).length,
            totalReceived: sumBy(batches, function(b) { return b.received; }),
            totalRemainder: sumBy(batches, function(b) { return b.remainder; }),
            rows: rows
        };
    }

    var agg = {
        toNumber: toNumber,
        round3: round3,
        groupBy: groupBy,
        sumBy: sumBy,
        ordersByStatus: ordersByStatus,
        slitterLoad: slitterLoad,
        gpOutput: gpOutput,
        materialStock: materialStock,
        UNSET: UNSET
    };

    // ─────────────────────────── Браузерный слой ───────────────────────────
    // Ниже — DOM-контроллер. Требует window/document/fetch; в Node не выполняется.

    var PAGE = 1000; // размер страницы для постраничного чтения списков

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function(k) {
            if (k === 'class') node.className = attrs[k];
            else if (k === 'text') node.textContent = attrs[k];
            else if (k === 'html') node.innerHTML = attrs[k];
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

    // Разбор значения-ссылки из JSON_OBJ: «id:Подпись» → подпись (или сырьё).
    function refLabel(raw) {
        var m = String(raw == null ? '' : raw).match(/^(\d+):([\s\S]*)$/);
        return m ? m[2] : String(raw == null ? '' : raw);
    }

    // Форматирование чисел для показа: целые без дробной части, иначе до 2 знаков,
    // с разделением тысяч пробелом.
    function fmt(n) {
        var v = toNumber(n);
        var rounded = Math.round(v * 100) / 100;
        var text = (rounded % 1 === 0) ? String(rounded) : rounded.toFixed(2);
        return text.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    }

    function AtexDashboards(root) {
        this.root = root;
        this.db = window.db || root.getAttribute('data-db') || '';
        this.meta = { order: null, cut: null, gp: null, rawBatch: null };
        this.busy = false;
    }

    AtexDashboards.prototype.url = function(path) {
        return '/' + encodeURIComponent(this.db) + '/' + path;
    };

    // GET → JSON. Бросает Error при сетевой/JSON-ошибке.
    AtexDashboards.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                try { return JSON.parse(text); }
                catch (e) { throw new Error('Некорректный JSON: ' + text.slice(0, 200)); }
            });
        });
    };

    // Счётчик записей таблицы: `?_count=&JSON=1` → { count: N } (index.php:6832).
    AtexDashboards.prototype.count = function(typeId) {
        return this.getJson('object/' + typeId + '/?_count=&JSON=1').then(function(res) {
            return res && typeof res.count !== 'undefined' ? Number(res.count) : 0;
        });
    };

    // Постраничное чтение всех записей таблицы через JSON_OBJ.
    AtexDashboards.prototype.loadAll = function(typeId) {
        var self = this;
        var rows = [];
        function page(offset) {
            return self.getJson('object/' + typeId + '/?JSON_OBJ&LIMIT=' + offset + ',' + PAGE).then(function(batch) {
                var list = batch || [];
                rows = rows.concat(list);
                if (list.length === PAGE) return page(offset + PAGE);
                return rows;
            });
        }
        return page(0);
    };

    // Построитель доступа к колонкам JSON_OBJ по имени реквизита.
    // Колонки идут в порядке: [главное значение, ...reqs по порядку].
    function columnReader(meta) {
        var order = [String(meta.id)].concat((meta.reqs || []).map(function(r) { return String(r.id); }));
        return function(reqName) {
            var rid = reqIdByName(meta, reqName);
            var idx = order.indexOf(String(rid));
            return function(rec) {
                var r = (rec && rec.r) || [];
                return idx >= 0 ? r[idx] : undefined;
            };
        };
    }

    // ── Загрузка метаданных ──

    AtexDashboards.prototype.loadMetadata = function() {
        var self = this;
        return this.getJson('metadata?JSON=1').then(function(all) {
            var list = Array.isArray(all) ? all : [all];
            function byName(name) {
                return list.filter(function(t) {
                    return String(t.val).trim().toLowerCase() === name.trim().toLowerCase();
                })[0] || null;
            }
            self.meta.order = byName(TABLE.order);
            self.meta.cut = byName(TABLE.cut);
            self.meta.gp = byName(TABLE.gp);
            self.meta.rawBatch = byName(TABLE.rawBatch);
            var missing = Object.keys(TABLE).filter(function(k) { return !self.meta[k]; })
                .map(function(k) { return TABLE[k]; });
            if (missing.length) throw new Error('В метаданных не найдены таблицы: ' + missing.join(', '));
        });
    };

    // ── Сбор сводок ──

    // Возвращает Promise<{ counts, orders, slitters, gp, materials }>.
    AtexDashboards.prototype.collect = function() {
        var self = this;
        var m = this.meta;

        var countsP = Promise.all([
            this.count(m.order.id), this.count(m.cut.id),
            this.count(m.gp.id), this.count(m.rawBatch.id)
        ]).then(function(c) {
            return { order: c[0], cut: c[1], gp: c[2], rawBatch: c[3] };
        });

        var ordersP = this.loadAll(m.order.id).then(function(rows) {
            var col = columnReader(m.order);
            var status = col(ORDER_REQ.status);
            return ordersByStatus(rows.map(function(rec) {
                return { status: status(rec) };
            }));
        });

        var slittersP = this.loadAll(m.cut.id).then(function(rows) {
            var col = columnReader(m.cut);
            var slitter = col(CUT_REQ.slitter), status = col(CUT_REQ.status), footage = col(CUT_REQ.footage);
            return slitterLoad(rows.map(function(rec) {
                return { slitter: refLabel(slitter(rec)), status: status(rec), footage: footage(rec) };
            }));
        });

        var gpP = this.loadAll(m.gp.id).then(function(rows) {
            var col = columnReader(m.gp);
            var status = col(GP_REQ.status), rolls = col(GP_REQ.rolls), footage = col(GP_REQ.footage);
            return gpOutput(rows.map(function(rec) {
                return { status: status(rec), rolls: rolls(rec), footage: footage(rec) };
            }));
        });

        var materialsP = this.loadAll(m.rawBatch.id).then(function(rows) {
            var col = columnReader(m.rawBatch);
            var material = col(RAW_REQ.material), received = col(RAW_REQ.received), remainder = col(RAW_REQ.remainder);
            return materialStock(rows.map(function(rec) {
                return { material: refLabel(material(rec)), received: received(rec), remainder: remainder(rec) };
            }));
        });

        return Promise.all([countsP, ordersP, slittersP, gpP, materialsP]).then(function(res) {
            return { counts: res[0], orders: res[1], slitters: res[2], gp: res[3], materials: res[4] };
        });
    };

    // ── Рендеринг ──

    AtexDashboards.prototype.render = function(data) {
        var grid = this.gridEl;
        grid.innerHTML = '';
        grid.appendChild(this.cardOrders(data.counts.order, data.orders));
        grid.appendChild(this.cardSlitters(data.counts.cut, data.slitters));
        grid.appendChild(this.cardGp(data.counts.gp, data.gp));
        grid.appendChild(this.cardMaterials(data.counts.rawBatch, data.materials));
    };

    function card(title, count, body) {
        var head = el('div', { class: 'atex-db-card-head' }, [
            el('h2', { class: 'atex-db-card-title', text: title }),
            el('span', { class: 'atex-db-card-count', text: fmt(count) })
        ]);
        return el('section', { class: 'atex-db-card' }, [head, body]);
    }

    // Горизонтальная гистограмма по строкам [{ key, count, ... }].
    function bars(rows, valueFn, formatFn) {
        if (!rows.length) return el('div', { class: 'atex-db-empty', text: 'Нет данных' });
        var max = rows.reduce(function(m, r) { return Math.max(m, toNumber(valueFn(r))); }, 0) || 1;
        var box = el('div', { class: 'atex-db-bars' });
        rows.forEach(function(r) {
            var v = toNumber(valueFn(r));
            var row = el('div', { class: 'atex-db-bar-row' }, [
                el('span', { class: 'atex-db-bar-key', text: r.key, title: r.key }),
                el('span', { class: 'atex-db-bar-track' }, [
                    el('span', { class: 'atex-db-bar-fill', style: 'width:' + Math.max(2, Math.round(v / max * 100)) + '%' })
                ]),
                el('span', { class: 'atex-db-bar-val', text: (formatFn ? formatFn(r) : fmt(v)) })
            ]);
            box.appendChild(row);
        });
        return box;
    }

    // Строка метрик «подпись: значение».
    function metrics(items) {
        return el('div', { class: 'atex-db-metrics' }, items.map(function(it) {
            return el('div', { class: 'atex-db-metric' }, [
                el('span', { class: 'atex-db-metric-value', text: fmt(it.value) }),
                el('span', { class: 'atex-db-metric-label', text: it.label })
            ]);
        }));
    }

    AtexDashboards.prototype.cardOrders = function(count, data) {
        return card('Заказы по статусам', count, el('div', {}, [
            bars(data.rows, function(r) { return r.count; })
        ]));
    };

    AtexDashboards.prototype.cardSlitters = function(count, data) {
        return card('Загрузка слиттеров', count, el('div', {}, [
            metrics([
                { label: 'резок всего', value: data.total },
                { label: 'погонаж факт, м', value: data.totalFootage }
            ]),
            el('h3', { class: 'atex-db-subhead', text: 'По слиттерам (погонаж, м)' }),
            bars(data.rows, function(r) { return r.footage; }, function(r) {
                return fmt(r.footage) + ' м · ' + fmt(r.count) + ' рез.';
            }),
            el('h3', { class: 'atex-db-subhead', text: 'По статусам' }),
            bars(data.byStatus, function(r) { return r.count; })
        ]));
    };

    AtexDashboards.prototype.cardGp = function(count, data) {
        return card('Выпуск ГП', count, el('div', {}, [
            metrics([
                { label: 'партий', value: data.total },
                { label: 'рулонов', value: data.totalRolls },
                { label: 'метраж, м', value: data.totalFootage }
            ]),
            el('h3', { class: 'atex-db-subhead', text: 'По статусам' }),
            bars(data.byStatus, function(r) { return r.count; })
        ]));
    };

    AtexDashboards.prototype.cardMaterials = function(count, data) {
        return card('Остатки сырья', count, el('div', {}, [
            metrics([
                { label: 'получено, м²', value: data.totalReceived },
                { label: 'остаток, м²', value: data.totalRemainder }
            ]),
            el('h3', { class: 'atex-db-subhead', text: 'По видам сырья (остаток, м²)' }),
            bars(data.rows, function(r) { return r.remainder; }, function(r) {
                return fmt(r.remainder) + ' / ' + fmt(r.received) + ' м²';
            })
        ]));
    };

    // ── Жизненный цикл ──

    AtexDashboards.prototype.setBusy = function(on) {
        this.busy = on;
        if (this.root) this.root.classList.toggle('is-busy', !!on);
    };

    AtexDashboards.prototype.fatal = function(message) {
        this.root.innerHTML = '';
        this.root.appendChild(el('div', { class: 'atex-db-fatal', text: message }));
    };

    AtexDashboards.prototype.refresh = function() {
        var self = this;
        if (this.busy) return Promise.resolve();
        this.setBusy(true);
        return this.collect().then(function(data) {
            self.render(data);
            self.setBusy(false);
        }).catch(function(err) {
            self.setBusy(false);
            self.fatal('Ошибка загрузки данных: ' + err.message);
        });
    };

    AtexDashboards.prototype.start = function() {
        var self = this;
        this.root.innerHTML = '';
        var toolbar = el('div', { class: 'atex-db-toolbar' }, [
            el('h1', { class: 'atex-db-heading', text: 'Дашборды и отчёты' })
        ]);
        var refreshBtn = el('button', { class: 'atex-db-btn', type: 'button', text: 'Обновить' });
        refreshBtn.addEventListener('click', function() { self.refresh(); });
        toolbar.appendChild(refreshBtn);
        this.root.appendChild(toolbar);

        this.gridEl = el('div', { class: 'atex-db-grid' });
        this.gridEl.appendChild(el('div', { class: 'atex-db-loading', text: 'Загрузка сводок…' }));
        this.root.appendChild(this.gridEl);

        return this.loadMetadata()
            .then(function() { return self.refresh(); })
            .catch(function(err) { self.fatal('Ошибка инициализации: ' + err.message); });
    };

    function init() {
        if (typeof document === 'undefined') return;
        var root = document.getElementById('atex-dashboards');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        var controller = new AtexDashboards(root);
        root._atexDashboards = controller;
        controller.start();
    }

    return { agg: agg, Controller: AtexDashboards, init: init };
});
