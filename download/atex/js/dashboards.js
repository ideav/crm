// Рабочее место atex «Дашборды и отчёты» (роль Руководитель).
//
// Сводки только для чтения по живым данным: путь продукции по этапам, заказы по
// статусам, загрузка слиттеров, выпуск готовой продукции (ГП), остатки сырья.
// Решение задачи
// ideav/crm#2919 (часть #2903). Правила разработки рабочих мест —
// docs/WORKSPACE_DEVELOPMENT_GUIDE.md, раздел про дашборды — atex_workplaces.md §3.9.
//
// Данные берутся двумя отчётами (`report/`), агрегации считаются на клиенте —
// минимум серверных запросов (правило: docs/integram-reports.md):
//   • `GET /{db}/report/order_pipeline?JSON_KV`  — плоская цепочка
//     Заказ→Позиция→Обеспечение→Резка→ГП; `rowsToEntities` разворачивает строки
//     в сущности (dedup по *_id) → заказы по статусам, загрузка слиттеров,
//     выпуск ГП, путь продукции;
//   • `GET /{db}/report/material_stock?JSON_KV` — остатки сырья (Партия сырья).
// Запись отсутствует — дашборд только читает. Счётчики берутся как длины
// массивов сущностей; отдельные `_count`/`object/`-чтения и резолв метаданных
// больше не нужны.
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
        // #3073: остатки сырья сортируем по убыванию остатка (а не по count),
        // ключ — вторичный для стабильности.
        rows.sort(function(a, b) {
            if (b.remainder !== a.remainder) return b.remainder - a.remainder;
            return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0);
        });
        return {
            total: (batches || []).length,
            totalReceived: sumBy(batches, function(b) { return b.received; }),
            totalRemainder: sumBy(batches, function(b) { return b.remainder; }),
            rows: rows
        };
    }

    function normalizeStatus(value) {
        return String(value == null ? '' : value)
            .trim()
            .toLowerCase()
            .replace(/ё/g, 'е');
    }

    function statusIn(status, list) {
        var wanted = normalizeStatus(status);
        return (list || []).map(normalizeStatus).indexOf(wanted) !== -1;
    }

    // Терминальные статусы заказа (#3073): из «пути продукции» исключаются совсем,
    // а в «заказах по статусам» показываются в конце серыми барами.
    var TERMINAL_STATUSES = ['Выполнен', 'Отменён'];

    function isTerminalStatus(status) {
        return statusIn(status, TERMINAL_STATUSES);
    }

    // Дата (ISO YYYY-MM-DD) в диапазоне [from, to] включительно; пустые границы
    // открыты, пустая дата не входит ни в какой непустой диапазон.
    function dateInRange(date, from, to) {
        var d = String(date == null ? '' : date).trim();
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
    }

    // Выбор заказов под фильтр диапазона дат (#3073):
    //   • обе границы пустые → только актуальные (не Выполнен/Отменён);
    //   • иначе → заказы, чей «срок выполнения» (deadline) в диапазоне включительно.
    function selectOrders(orders, from, to) {
        var f = from ? String(from).trim() : '';
        var t = to ? String(to).trim() : '';
        if (!f && !t) {
            return (orders || []).filter(function(o) { return !isTerminalStatus(o.status); });
        }
        return (orders || []).filter(function(o) { return dateInRange(o.deadline, f, t); });
    }

    function stageState(status, doneStatuses) {
        var text = String(status == null ? '' : status).trim();
        if (!text) return 'pending';
        return statusIn(text, doneStatuses) ? 'done' : 'active';
    }

    function stage(key, labelText, status, doneStatuses, detail) {
        var text = String(status == null ? '' : status).trim();
        return {
            key: key,
            label: labelText,
            status: text || 'нет данных',
            state: stageState(text, doneStatuses),
            detail: String(detail == null ? '' : detail).trim()
        };
    }

    function first(list) {
        return list && list.length ? list[0] : null;
    }

    function byParent(list, parentKey) {
        var map = {};
        (list || []).forEach(function(item) {
            var key = String(item && item[parentKey] != null ? item[parentKey] : '');
            if (!key) return;
            if (!map[key]) map[key] = [];
            map[key].push(item);
        });
        return map;
    }

    function byId(list) {
        var map = {};
        (list || []).forEach(function(item) {
            if (item && item.id != null) map[String(item.id)] = item;
        });
        return map;
    }

    function productionFlow(data) {
        var orders = data && data.orders || [];
        var positionsByOrder = byParent(data && data.positions, 'orderId');
        var provisionsByPosition = byParent(data && data.provisions, 'positionId');
        var cutsById = byId(data && data.cuts);
        var gpById = byId(data && data.gpBatches);
        var gpByCut = byParent(data && data.gpBatches, 'cutId');
        var rows = [];

        function makeRow(order, position, provision) {
            var cut = provision && provision.cutId ? cutsById[String(provision.cutId)] : null;
            var gp = provision && provision.gpId ? gpById[String(provision.gpId)] : null;
            if (!gp && cut) gp = first(gpByCut[String(cut.id)]);

            var positionLabel = position
                ? [
                    position.cutType || ('позиция #' + position.id),
                    position.width ? position.width + ' мм' : '',
                    position.length ? position.length + ' м' : ''
                ].filter(Boolean).join(' · ')
                : 'позиция не создана';

            var stages = [
                stage('order', 'Заказ', order.status, ['Выполнен'], order.number || ('#' + order.id)),
                stage('position', 'Позиция', position && position.status,
                    ['Отгружена'], positionLabel),
                stage('provision', 'Обеспечение', provision && provision.status,
                    ['Выполнено'], provision && provision.footage ? provision.footage + ' м' : ''),
                stage('cut', 'Резка', cut && cut.status,
                    ['Завершён', 'Завершен', 'Готово', 'Готова'],
                    cut ? [cut.number ? '№ ' + cut.number : '', cut.slitter || '', cut.footage ? cut.footage + ' м' : ''].filter(Boolean).join(' · ') : ''),
                stage('gp', 'ГП / отгрузка', gp && gp.status,
                    ['Отгружен', 'Отгружено'],
                    gp ? [gp.rolls ? gp.rolls + ' рул.' : '', gp.footage ? gp.footage + ' м' : '', gp.address || ''].filter(Boolean).join(' · ') : '')
            ];
            var done = stages.filter(function(s) { return s.state === 'done'; }).length;
            var active = stages.filter(function(s) { return s.state === 'active'; }).length;
            var percent = Math.round((done + active * 0.5) / stages.length * 100);

            return {
                orderId: String(order.id),
                positionId: position ? String(position.id) : '',
                provisionId: provision ? String(provision.id) : '',
                cutId: cut ? String(cut.id) : '',
                gpId: gp ? String(gp.id) : '',
                product: position ? positionLabel : (order.number || ('Заказ #' + order.id)),
                order: order.number || ('Заказ #' + order.id),
                stages: stages,
                completeStages: done,
                activeStages: active,
                progress: percent,
                done: done === stages.length
            };
        }

        orders.forEach(function(order) {
            // #3073: заказы Выполнен/Отменён в «пути продукции» не показываем — неактуально.
            if (isTerminalStatus(order.status)) return;
            var positions = positionsByOrder[String(order.id)] || [null];
            positions.forEach(function(position) {
                var provisions = position ? (provisionsByPosition[String(position.id)] || [null]) : [null];
                provisions.forEach(function(provision) {
                    rows.push(makeRow(order, position, provision));
                });
            });
        });

        rows.sort(function(a, b) {
            if (a.done !== b.done) return a.done ? 1 : -1;
            if (b.activeStages !== a.activeStages) return b.activeStages - a.activeStages;
            return Number(b.orderId) - Number(a.orderId);
        });

        return {
            total: rows.length,
            done: rows.filter(function(row) { return row.done; }).length,
            active: rows.filter(function(row) { return !row.done; }).length,
            rows: rows
        };
    }

    // Плоские строки отчёта order_pipeline → массивы сущностей (dedup по *_id),
    // под ключи существующих агрегаторов и productionFlow. Пустые поздние стадии
    // (LEFT JOIN) не создают фантомных записей.
    function rowsToEntities(rows) {
        var orders = {}, positions = {}, provisions = {}, cuts = {}, gp = {};
        function vals(o) { return Object.keys(o).map(function(k) { return o[k]; }); }
        (rows || []).forEach(function(r) {
            if (r.order_id && !orders[r.order_id]) {
                orders[r.order_id] = { id: r.order_id, number: r.order_no || ('#' + r.order_id), status: r.order_status, deadline: r.order_deadline || '' };
            }
            if (r.position_id && !positions[r.position_id]) {
                positions[r.position_id] = { id: r.position_id, orderId: r.order_id || '', cutType: r.position_cut_type, width: r.position_width_mm, length: r.position_length_m, status: r.position_status };
            }
            if (r.provision_id && !provisions[r.provision_id]) {
                provisions[r.provision_id] = { id: r.provision_id, positionId: r.position_id || '', cutId: r.cut_id || '', gpId: r.gp_id || '', footage: r.provision_used_m, status: r.provision_status };
            }
            if (r.cut_id && !cuts[r.cut_id]) {
                cuts[r.cut_id] = { id: r.cut_id, number: r.cut_no || ('#' + r.cut_id), slitter: r.cut_slitter, status: r.cut_status, footage: r.cut_footage_m };
            }
            if (r.gp_id && !gp[r.gp_id]) {
                gp[r.gp_id] = { id: r.gp_id, cutId: r.gp_cut_id || '', status: r.gp_status, rolls: r.gp_rolls, footage: r.gp_footage_m, address: r.gp_address };
            }
        });
        return { orders: vals(orders), positions: vals(positions), provisions: vals(provisions), cuts: vals(cuts), gpBatches: vals(gp) };
    }

    // Сводки из строк отчётов под фильтр диапазона дат (#3073). Заказы отбираются
    // через selectOrders (пустой диапазон → актуальные; заполненный → по сроку
    // выполнения), затем плоские строки order_pipeline сужаются до отобранных
    // заказов — так все зависимые агрегации (статусы, слиттеры, ГП, путь) считаются
    // по одному и тому же срезу. Остатки сырья не привязаны к заказу — не фильтруются.
    function buildSummaries(pipelineRows, materialRows, filter) {
        filter = filter || {};
        var from = filter.from ? String(filter.from).trim() : '';
        var to = filter.to ? String(filter.to).trim() : '';
        var allOrders = rowsToEntities(pipelineRows || []).orders;
        var allowed = {};
        selectOrders(allOrders, from, to).forEach(function(o) { allowed[String(o.id)] = true; });
        var rows = (pipelineRows || []).filter(function(r) { return allowed[String(r.order_id)]; });
        var e = rowsToEntities(rows);
        var rawBatches = (materialRows || []).map(function(r) {
            return { material: r.material, received: r.material_received_m2, remainder: r.material_remainder_m2 };
        });
        return {
            counts: { order: e.orders.length, cut: e.cuts.length, gp: e.gpBatches.length, rawBatch: rawBatches.length },
            orders: ordersByStatus(e.orders),
            slitters: slitterLoad(e.cuts),
            gp: gpOutput(e.gpBatches),
            materials: materialStock(rawBatches),
            flow: productionFlow({ orders: e.orders, positions: e.positions, provisions: e.provisions, cuts: e.cuts, gpBatches: e.gpBatches }),
            filter: { from: from, to: to, active: !from && !to }
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
        productionFlow: productionFlow,
        stageState: stageState,
        rowsToEntities: rowsToEntities,
        buildSummaries: buildSummaries,
        selectOrders: selectOrders,
        isTerminalStatus: isTerminalStatus,
        dateInRange: dateInRange,
        TERMINAL_STATUSES: TERMINAL_STATUSES,
        UNSET: UNSET
    };

    // ─────────────────────────── Браузерный слой ───────────────────────────
    // Ниже — DOM-контроллер. Требует window/document/fetch; в Node не выполняется.

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
        this.busy = false;
        // Фильтр диапазона дат (#3073): пустой → только актуальные заказы.
        this.filter = { from: '', to: '' };
        // Сырые строки отчётов — чтобы перефильтровывать по датам без перезапроса.
        this.raw = null;
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

    // ── Сбор сводок ──

    // Сбор сводок из двух отчётов (минимум запросов; агрегации — на клиенте).
    // Сырые строки сохраняются, чтобы фильтр дат перестраивал сводки без перезапроса.
    AtexDashboards.prototype.collect = function() {
        var self = this;
        return Promise.all([
            this.getJson('report/order_pipeline?JSON_KV'),
            this.getJson('report/material_stock?JSON_KV')
        ]).then(function(res) {
            self.raw = { pipelineRows: res[0] || [], materialRows: res[1] || [] };
            return buildSummaries(self.raw.pipelineRows, self.raw.materialRows, self.filter);
        });
    };

    // Перестроить сводки из уже загруженных строк под текущий фильтр и перерисовать.
    // Используется при смене диапазона дат — без повторного запроса к серверу.
    AtexDashboards.prototype.applyFilter = function() {
        if (!this.raw) return;
        this.render(buildSummaries(this.raw.pipelineRows, this.raw.materialRows, this.filter));
    };

    // ── Рендеринг ──

    AtexDashboards.prototype.render = function(data) {
        var grid = this.gridEl;
        grid.innerHTML = '';
        grid.appendChild(this.cardProductionFlow(data.flow));
        grid.appendChild(this.cardOrders(data.counts.order, data.orders));
        grid.appendChild(this.cardSlitters(data.counts.cut, data.slitters));
        grid.appendChild(this.cardGp(data.counts.gp, data.gp));
        grid.appendChild(this.cardMaterials(data.counts.rawBatch, data.materials));
    };

    function card(title, count, body, className) {
        var head = el('div', { class: 'atex-db-card-head' }, [
            el('h2', { class: 'atex-db-card-title', text: title }),
            el('span', { class: 'atex-db-card-count', text: fmt(count) })
        ]);
        return el('section', { class: 'atex-db-card' + (className ? ' ' + className : '') }, [head, body]);
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

    // «Заказы по статусам» (#3073): активные статусы рисуются как обычно, масштаб
    // баров считается только по ним; терминальные (Выполнен/Отменён) выводятся в
    // конце серыми барами и не влияют на пропорции остальных.
    function ordersBars(rows) {
        var all = rows || [];
        if (!all.length) return el('div', { class: 'atex-db-empty', text: 'Нет данных' });
        var active = all.filter(function(r) { return !isTerminalStatus(r.key); });
        var terminal = all.filter(function(r) { return isTerminalStatus(r.key); });
        var max = active.reduce(function(m, r) { return Math.max(m, toNumber(r.count)); }, 0) || 1;
        var box = el('div', { class: 'atex-db-bars' });
        function addRow(r, muted) {
            var pct = Math.max(2, Math.min(100, Math.round(toNumber(r.count) / max * 100)));
            box.appendChild(el('div', { class: 'atex-db-bar-row' }, [
                el('span', { class: 'atex-db-bar-key', text: r.key, title: r.key }),
                el('span', { class: 'atex-db-bar-track' }, [
                    el('span', { class: 'atex-db-bar-fill' + (muted ? ' atex-db-bar-fill-muted' : ''), style: 'width:' + pct + '%' })
                ]),
                el('span', { class: 'atex-db-bar-val', text: fmt(r.count) })
            ]));
        }
        active.forEach(function(r) { addRow(r, false); });
        terminal.forEach(function(r) { addRow(r, true); });
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

    AtexDashboards.prototype.cardProductionFlow = function(data) {
        var rows = data && data.rows || [];
        var body = el('div', {}, [
            metrics([
                { label: 'позиций в пути', value: data ? data.total : 0 },
                { label: 'активных', value: data ? data.active : 0 },
                { label: 'завершено', value: data ? data.done : 0 }
            ])
        ]);

        if (!rows.length) {
            body.appendChild(el('div', { class: 'atex-db-empty', text: 'Нет данных по позициям заказа' }));
            return card('Путь продукции', 0, body, 'atex-db-card-wide');
        }

        var list = el('div', { class: 'atex-db-flow-list' });
        rows.slice(0, 8).forEach(function(row) {
            var stages = el('div', { class: 'atex-db-flow-stages' });
            row.stages.forEach(function(st) {
                stages.appendChild(el('div', {
                    class: 'atex-db-flow-stage atex-db-flow-stage-' + st.state,
                    title: st.detail || st.status
                }, [
                    el('span', { class: 'atex-db-flow-stage-label', text: st.label }),
                    el('span', { class: 'atex-db-flow-stage-status', text: st.status }),
                    st.detail ? el('span', { class: 'atex-db-flow-stage-detail', text: st.detail }) : null
                ]));
            });

            list.appendChild(el('article', { class: 'atex-db-flow-row' }, [
                el('div', { class: 'atex-db-flow-row-head' }, [
                    el('div', {}, [
                        el('div', { class: 'atex-db-flow-order', text: row.order }),
                        el('div', { class: 'atex-db-flow-product', text: row.product })
                    ]),
                    el('span', { class: 'atex-db-flow-progress', text: row.progress + '%' })
                ]),
                stages
            ]));
        });
        body.appendChild(list);
        if (rows.length > 8) {
            body.appendChild(el('div', { class: 'atex-db-flow-more', text: 'Показаны 8 из ' + rows.length }));
        }

        return card('Путь продукции', data.total, body, 'atex-db-card-wide');
    };

    AtexDashboards.prototype.cardOrders = function(count, data) {
        return card('Заказы по статусам', count, el('div', {}, [
            ordersBars(data.rows)
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
        // #3073: показываем только остаток сырья (без «получено»), отсортированный
        // по убыванию (сортировка — в agg.materialStock).
        return card('Остатки сырья', count, el('div', {}, [
            metrics([
                { label: 'остаток, м²', value: data.totalRemainder }
            ]),
            el('h3', { class: 'atex-db-subhead', text: 'По видам сырья (остаток, м²)' }),
            bars(data.rows, function(r) { return r.remainder; }, function(r) {
                return fmt(r.remainder) + ' м²';
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

    // Поле «дата» с подписью для диапазона дат (#3073). При изменении меняет фильтр
    // и перестраивает сводки из уже загруженных строк, без повторного запроса.
    AtexDashboards.prototype.dateField = function(labelText, key) {
        var self = this;
        var input = el('input', { type: 'date', class: 'atex-db-date', value: this.filter[key] || '', 'aria-label': 'Срок выполнения ' + labelText });
        input.addEventListener('change', function() {
            self.filter[key] = input.value || '';
            self.applyFilter();
        });
        return el('label', { class: 'atex-db-filter' }, [
            el('span', { class: 'atex-db-filter-label', text: labelText }),
            input
        ]);
    };

    AtexDashboards.prototype.start = function() {
        var self = this;
        this.root.innerHTML = '';
        var toolbar = el('div', { class: 'atex-db-toolbar' }, [
            el('h1', { class: 'atex-db-heading', text: 'Дашборды и отчёты' })
        ]);
        // #3073: диапазон дат по сроку выполнения. Пусто → только актуальные заказы.
        toolbar.appendChild(el('div', { class: 'atex-db-range', title: 'Срок выполнения заказа' }, [
            this.dateField('С', 'from'),
            this.dateField('По', 'to')
        ]));
        var refreshBtn = el('button', { class: 'atex-db-btn', type: 'button', text: 'Обновить' });
        refreshBtn.addEventListener('click', function() { self.refresh(); });
        toolbar.appendChild(refreshBtn);
        this.root.appendChild(toolbar);

        this.gridEl = el('div', { class: 'atex-db-grid' });
        this.gridEl.appendChild(el('div', { class: 'atex-db-loading', text: 'Загрузка сводок…' }));
        this.root.appendChild(this.gridEl);

        return this.refresh()
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
