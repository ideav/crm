// Импорт из 1С (Фаза 2 atex, этикетка; ideav/crm#5308): заказы этикетки и база ножей.
//
// Чистая модель импорта без DOM — её зовут рабочее место «Импорт из 1С» (label-import.js) и тест
// experiments/atex-p2-5308-label-import.test.js. Порядок работы:
//   1. разбор листа выгрузки (сетка ячеек, первая строка с нужными заголовками — шапка):
//      parseKnifeSheet (лист «Ножи», пробег — из колонки «Пробег» или из «Суммарного пробега ножа»
//      листа «План»), parseOrderSheet («Выгруженные заказы этикетка»);
//   2. сверка с базой по ключу — нож = «Номер ножа», позиция = «Заказ клиента» + артикул:
//      planKnives / planOrders → строки предпросмотра (новая / обновится / без изменений / дубль /
//      ошибка) и список операций. Ни разбор, ни план ничего не пишут;
//   3. запись после «Подтвердить»: runBatches шлёт операции пакетами _m_batch (до 1000 операций в
//      пакете у ядра; запись и её подчинённые — в одном пакете, ссылки внутри пакета — ":idN").
//
// Правила повторного импорта (ТЗ Фазы 2 §5.6, docs/atex_phase2_labels_tz.md):
//   - пустое значение в файле поле не стирает: вал, заполненный в Интеграме у ножа с валом «0»
//     в 1С, переживает повторный импорт;
//   - состояние ножа пишется только при создании ножа — дальше его ведёт рабочее место «Ножи и
//     валы» (списанный нож из «Списан» не выходит);
//   - пробег из 1С — одна запись «начальный остаток» на нож (initialRunPlan): повторный импорт
//     её перезаписывает, движения «вырубка» не трогает; пробег ножа = начальный остаток + вырубка;
//   - у позиции заказа примечание и статус пишутся только при создании.
//
// Таблицы и колонки — по именам из /metadata (resolveImportTables), id в коде нет.

(function(root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.AtexLabelImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
    'use strict';

    var LP = (root && root.AtexLabelProduction) ||
        (typeof require === 'function' ? require('../../atex/js/label-production.js') : null);
    var lp = LP ? LP.core : null;

    // ── Таблицы ──────────────────────────────────────────────────────────────────────────

    // ключ → { name: имя таблицы, reqs: { ключ: имя колонки | [имена] } }. Имя колонки —
    // псевдоним или имя реквизита (для ссылки без псевдонима — имя таблицы-цели).
    var IMPORT_TABLES = {
        die: { name: 'Нож', reqs: {
            delivered: 'Дата поставки', labelWidth: 'Ширина этикетки, мм', labelLength: 'Длина этикетки, мм',
            streams: 'Ручьёв', labelsPerRepeat: 'Этикеток на раппорте', labelGap: 'М/э расстояние, мм',
            streamGap: 'Между ручьями, мм', edge: 'Ширина кромки, мм', cylinder: 'Вал', base: ['Основа', 'Основа сырья'],
            minFormat: 'Минимальный формат, мм', optFormat: 'Оптимальный формат, мм', usedFormat: 'Исп. формат, мм',
            sleeveWidth: 'Ширина втулки, мм', height: 'Высота ножа, мкм', angle: 'Угол заточки',
            brand: 'Марка ножа', state: 'Состояние ножа'
        } },
        dieRun: { name: 'Движение пробега', reqs: { meters: 'Метры пробега', kind: 'Вид движения пробега' } },
        cylinder: { name: 'Вал', reqs: { repeat: 'Раппорт, мм' } },
        base: { name: 'Основа сырья', reqs: {} },
        brand: { name: 'Марка ножа', reqs: {} },
        state: { name: 'Состояние ножа', reqs: {} },
        runKind: { name: 'Вид движения пробега', reqs: {} },
        order: { name: 'Заказ', reqs: {
            client: 'Клиент', created: 'Дата создания', status: ['Статус заказа', 'Статус'], note: 'Примечания'
        } },
        position: { name: 'Заказанное количество', reqs: {
            productKind: 'Вид продукции', article: 'Артикул', clientOrder: 'Заказ клиента',
            labelWidth: 'Ширина этикетки, мм', labelLength: 'Длина этикетки, мм', labelsPerRoll: 'Этикеток в рулоне',
            knifeType: 'Тип ножей', core: 'Диаметр втулки', winding: 'Тип намотки', unit: 'Ед.изм.',
            status: ['Статус позиции', 'Статус'], note: 'Примечание',
            material: 'Сырьё этикетки', due: 'Срок изготовления'
        }, optionalReqs: ['material', 'due'] },
        material: { name: 'Сырьё этикетки', optional: true, reqs: { base: ['Основа сырья', 'Основа'], glue: 'Клей' }, optionalReqs: ['base', 'glue'] },
        setting: { name: 'Настройка', optional: true, reqs: { type: 'Тип', value: 'Значение' }, optionalReqs: ['type', 'value'] },
        client: { name: 'Клиент', reqs: {} },
        article: { name: 'Артикул', reqs: {} },
        productKind: { name: 'Вид продукции', reqs: {} },
        orderStatus: { name: 'Статус заказа', reqs: {} },
        positionStatus: { name: 'Статус позиции', reqs: {} },
        core: { name: 'Диаметр втулки', reqs: {} },
        unit: { name: 'Ед.изм.', reqs: {} }
    };

    // Без этих таблиц и колонок вкладка не работает; остальные — необязательные (поле не пишется).
    var REQUIRED = {
        knives: ['die', 'dieRun', 'cylinder', 'base', 'brand', 'state', 'runKind',
            'die.labelWidth', 'die.labelLength', 'dieRun.meters', 'dieRun.kind'],
        orders: ['order', 'position', 'client', 'article', 'productKind',
            'order.client', 'position.productKind', 'position.article', 'position.labelWidth', 'position.labelLength']
    };

    function norm(s) {
        return String(s == null ? '' : s).replace(/ё/g, 'е').replace(/Ё/g, 'Е').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function aliasOf(entry) {
        if (!entry) return '';
        if (entry.alias != null && entry.alias !== '') return String(entry.alias);
        if (entry.field_attrs && entry.field_attrs.alias != null) return String(entry.field_attrs.alias);
        if (entry.attrs) {
            try {
                var a = typeof entry.attrs === 'string' ? JSON.parse(entry.attrs) : entry.attrs;
                if (a && a.alias != null) return String(a.alias);
            } catch (e) { /* attrs — не JSON */ }
        }
        return '';
    }

    function findByNames(list, names) {
        var arr = Array.isArray(list) ? list : [];
        var wanted = (Array.isArray(names) ? names : [names]).map(norm);
        for (var w = 0; w < wanted.length; w++) {
            for (var i = 0; i < arr.length; i++) if (norm(aliasOf(arr[i])) === wanted[w]) return arr[i];
            for (var j = 0; j < arr.length; j++) if (norm(arr[j] && arr[j].val) === wanted[w]) return arr[j];
        }
        return null;
    }

    // /metadata → { ok, tables: { ключ: { id, name, reqs: { ключ: id }, reqNames: { ключ: имя } } }, missing }
    function resolveImportTables(metadata) {
        var meta = Array.isArray(metadata) ? metadata : [];
        var tables = {}, missing = [];
        Object.keys(IMPORT_TABLES).forEach(function(key) {
            var spec = IMPORT_TABLES[key];
            var t = findByNames(meta, spec.name);
            if (!t) { if (!spec.optional) missing.push(key); return; }
            var reqs = {}, reqNames = {};
            Object.keys(spec.reqs).forEach(function(rk) {
                var r = findByNames(t.reqs, spec.reqs[rk]);
                var first = Array.isArray(spec.reqs[rk]) ? spec.reqs[rk][0] : spec.reqs[rk];
                reqNames[rk] = first;
                if (r) reqs[rk] = String(r.id);
                else if (!(spec.optionalReqs && spec.optionalReqs.indexOf(rk) >= 0)) missing.push(key + '.' + rk);
            });
            tables[key] = { id: String(t.id), name: spec.name, reqs: reqs, reqNames: reqNames };
        });
        return { ok: missing.length === 0, tables: tables, missing: missing };
    }

    // Чего не хватает вкладке `tab` ('knives' | 'orders') → [«Таблица» / «Таблица → колонка»].
    function missingFor(resolved, tab) {
        return (REQUIRED[tab] || []).filter(function(k) { return resolved.missing.indexOf(k) >= 0; }).map(function(k) {
            var p = k.split('.');
            var spec = IMPORT_TABLES[p[0]];
            if (p.length === 1) return spec.name;
            var r = spec.reqs[p[1]];
            return spec.name + ' → ' + (Array.isArray(r) ? r[0] : r);
        });
    }

    // Ответ object/{t}/?JSON_KV → [{ id, up, val, reqs }].
    function kvRecords(json) {
        var reqs = (json && json.reqs) || {};
        return ((json && json.object) || []).map(function(o) {
            return { id: String(o.id), up: o.up == null ? '' : String(o.up), val: o.val == null ? '' : String(o.val), reqs: reqs[o.id] || {} };
        });
    }

    // Значение ссылки записи: id цели из `ref_{req}` («таблица:id»), иначе — сырое значение.
    function refId(rec, reqId) {
        if (!rec || !rec.reqs || !reqId) return '';
        var raw = rec.reqs['ref_' + reqId];
        if (raw != null && String(raw).trim() !== '') return String(raw).replace(/^\s*\d+:/, '').split(',')[0].trim();
        var v = rec.reqs[reqId];
        return v == null ? '' : String(v).trim();
    }

    function reqText(rec, reqId) {
        var v = rec && rec.reqs && reqId ? rec.reqs[reqId] : null;
        return v == null ? '' : String(v).trim();
    }

    // ── Ячейки ───────────────────────────────────────────────────────────────────────────

    function cellText(v) {
        if (v == null) return '';
        if (v instanceof Date) return excelDate(v);
        return String(v).trim();
    }

    function isErrorCell(s) { return /^#[A-ZА-Я0-9\/]+[!?]?$/i.test(String(s).trim()) && /[!?]|N\/A/i.test(s); }

    // Число ячейки: null — пусто (или ошибка формулы Excel «#VALUE!»), NaN — не число.
    function cellNum(v) {
        if (v == null) return null;
        if (typeof v === 'number') return isFinite(v) ? v : NaN;
        var s = String(v).replace(/[\s ]+/g, '').replace(',', '.');
        if (s === '' || isErrorCell(s)) return null;
        return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
    }

    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    // Дата: число — серийный номер Excel (1 = 01.01.1900, система 1900), «ДД.ММ.ГГГГ», Date.
    // → «ДД.ММ.ГГГГ» или «» (не дата).
    function excelDate(v) {
        if (v == null || v === '') return '';
        if (v instanceof Date) return isNaN(v.getTime()) ? '' : pad2(v.getUTCDate()) + '.' + pad2(v.getUTCMonth() + 1) + '.' + v.getUTCFullYear();
        var s = String(v).trim();
        var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
        if (m) return pad2(+m[1]) + '.' + pad2(+m[2]) + '.' + m[3];
        var n = cellNum(v);
        if (!(n > 0)) return '';
        var d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
        return excelDate(d);
    }

    function fmtNum(n) { return String(Math.round(Number(n) * 1000) / 1000); }

    // ── Шапка листа ──────────────────────────────────────────────────────────────────────

    // cols — { ключ: [заголовки] }; заголовок с «*» на конце — по началу. Шапка — первая строка
    // (из первых 30), где нашлись все `required`. → { ok, row, cols: { ключ: индекс } } | { ok:false, error }
    function findHeader(grid, cols, required) {
        var rows = Array.isArray(grid) ? grid : [];
        for (var r = 0; r < Math.min(rows.length, 30); r++) {
            var cells = (rows[r] || []).map(norm);
            var map = {};
            Object.keys(cols).forEach(function(key) {
                var names = cols[key];
                for (var i = 0; i < names.length && map[key] == null; i++) {
                    var n = norm(names[i]);
                    var prefix = /\*$/.test(n);
                    if (prefix) n = n.slice(0, -1).trim();
                    for (var c = 0; c < cells.length; c++) {
                        if (prefix ? cells[c].indexOf(n) === 0 : cells[c] === n) { map[key] = c; break; }
                    }
                }
            });
            if (required.every(function(k) { return map[k] != null; })) return { ok: true, row: r, cols: map };
        }
        return { ok: false, error: 'не найдена строка заголовков: нужны колонки ' + required.map(function(k) { return '«' + cols[k][0] + '»'; }).join(', ') };
    }

    function cell(row, cols, key) {
        var i = cols[key];
        return i == null || !row ? '' : row[i];
    }

    // ── Лист «Ножи» ─────────────────────────────────────────────────────────────────────

    var KNIFE_COLS = {
        no: ['Номер ножа'], delivered: ['Дата поставки'], labelWidth: ['Ширина этикетки'],
        labelLength: ['Длинна этикетки', 'Длина этикетки'], streams: ['кол-во ручев', 'кол-во ручьев', 'Ручьев'],
        labelsPerRepeat: ['этикеток на раппорте'], labelGap: ['м/э расстояние, мм'], streamGap: ['между ручьями, мм'],
        edge: ['ширина кромки, мм'], cylinder: ['Вал'], repeat: ['раппорт'], height: ['высота ножа, мкм'],
        angle: ['угол заточки'], base: ['сырье', 'Основа'], brand: ['Доп', 'Марка ножа'], state: ['Состояние ножа*'],
        mileage: ['Пробег'], minFormat: ['Минимальный формат'], optFormat: ['Оптимальный формат'],
        sleeveWidth: ['ширина втулки'], usedFormat: ['Исп. формат']
    };

    var PLAN_COLS = { no: ['номер ножа'], total: ['Суммарный пробег ножа'] };

    // Поля ножа: ключ реквизита, вид значения, только при создании.
    var KNIFE_FIELDS = [
        { key: 'delivered', kind: 'date' }, { key: 'labelWidth', kind: 'num' }, { key: 'labelLength', kind: 'num' },
        { key: 'streams', kind: 'int' }, { key: 'labelsPerRepeat', kind: 'int' }, { key: 'labelGap', kind: 'num' },
        { key: 'streamGap', kind: 'num' }, { key: 'edge', kind: 'num' }, { key: 'cylinder', kind: 'ref' },
        { key: 'base', kind: 'ref' }, { key: 'minFormat', kind: 'int' }, { key: 'optFormat', kind: 'int' },
        { key: 'usedFormat', kind: 'int' }, { key: 'sleeveWidth', kind: 'num' }, { key: 'height', kind: 'int' },
        { key: 'angle', kind: 'text' }, { key: 'brand', kind: 'ref' }, { key: 'state', kind: 'ref', createOnly: true }
    ];

    var NUM_LABEL = {
        labelWidth: 'ширина этикетки', labelLength: 'длина этикетки', streams: 'ручьёв', labelsPerRepeat: 'этикеток на раппорте',
        labelGap: 'м/э расстояние', streamGap: 'между ручьями', edge: 'ширина кромки', minFormat: 'минимальный формат',
        optFormat: 'оптимальный формат', usedFormat: 'исп. формат', sleeveWidth: 'ширина втулки', height: 'высота ножа'
    };

    // Пробег по листу «План»: «Суммарный пробег ножа» — одно значение на нож во всех его строках.
    // → { номер: { meters } | { error } }
    function planMileage(planGrid) {
        var out = {};
        if (!planGrid) return out;
        var h = findHeader(planGrid, PLAN_COLS, ['no', 'total']);
        if (!h.ok) return out;
        var seen = {};
        for (var r = h.row + 1; r < planGrid.length; r++) {
            var no = cellText(cell(planGrid[r], h.cols, 'no'));
            var m = cellNum(cell(planGrid[r], h.cols, 'total'));
            if (no === '' || m == null || isNaN(m)) continue;
            m = Math.round(m);
            (seen[no] = seen[no] || {})[m] = true;
        }
        Object.keys(seen).forEach(function(no) {
            var vals = Object.keys(seen[no]).map(Number);
            out[no] = vals.length === 1 ? { meters: vals[0] }
                : { error: 'в листе «План» у ножа разный «Суммарный пробег ножа» (' + vals.join(', ') + ' м) — пробег не импортирован' };
        });
        return out;
    }

    // Лист «Ножи» (+ необязательный лист «План») → { ok, error, items, duplicates, empty }.
    // item — { row, key, values, mileage, mileageSource, warnings, errors }; row — номер строки
    // листа с 1. Пустая строка (нет номера ножа) — в `empty`; повтор номера — в `duplicates`.
    function parseKnifeSheet(grid, planGrid) {
        var h = findHeader(grid, KNIFE_COLS, ['no', 'labelWidth', 'labelLength']);
        if (!h.ok) return { ok: false, error: 'лист «Ножи»: ' + h.error, items: [], duplicates: [], empty: 0 };
        var plan = planMileage(planGrid);
        var items = [], duplicates = [], empty = 0, firstRow = {};
        for (var r = h.row + 1; r < grid.length; r++) {
            var row = grid[r] || [];
            var key = cellText(cell(row, h.cols, 'no')).replace(/\.0+$/, '');
            if (key === '') {
                // Шаблонная строка листа (« х », нули формул) — пустая; строка с размером этикетки —
                // нож без номера: ключа сверки нет, это ошибка строки.
                var w = cellText(cell(row, h.cols, 'labelWidth')), l = cellNum(cell(row, h.cols, 'labelLength'));
                if ((w !== '' && w !== '0') || l > 0) {
                    items.push({ row: r + 1, key: '', values: {}, mileage: null, mileageSource: '', warnings: [],
                        errors: ['нет номера ножа — без ключа сверки строка не импортируется'] });
                } else empty++;
                continue;
            }
            if (firstRow[key] != null) { duplicates.push({ row: r + 1, key: key, firstRow: firstRow[key] }); continue; }
            firstRow[key] = r + 1;
            items.push(parseKnifeRow(row, h.cols, key, r + 1, plan));
        }
        return { ok: true, items: items, duplicates: duplicates, empty: empty };
    }

    function parseKnifeRow(row, cols, key, rowNo, plan) {
        var v = {}, warnings = [], errors = [];
        var get = function(k) { return cell(row, cols, k); };

        var wRaw = cellText(get('labelWidth'));
        var round = /^[dд]$/i.test(wRaw) || /круг/i.test(wRaw);
        var len = cellNum(get('labelLength'));
        if (len == null) errors.push('нет длины этикетки');
        else if (isNaN(len) || !(len > 0)) errors.push('длина этикетки «' + cellText(get('labelLength')) + '» — не число больше нуля');
        else v.labelLength = len;
        if (round) { if (v.labelLength != null) v.labelWidth = v.labelLength; }
        else {
            var w = cellNum(get('labelWidth'));
            if (w == null) errors.push('нет ширины этикетки');
            else if (isNaN(w) || !(w > 0)) errors.push('ширина этикетки «' + wRaw + '» — не число больше нуля');
            else v.labelWidth = w;
        }

        ['streams', 'labelsPerRepeat', 'labelGap', 'streamGap', 'edge', 'minFormat', 'optFormat', 'usedFormat', 'sleeveWidth', 'height'].forEach(function(k) {
            var n = cellNum(get(k));
            if (n == null) return;
            if (isNaN(n)) { warnings.push(NUM_LABEL[k] + ' «' + cellText(get(k)) + '» — не число, поле не заполняется'); return; }
            v[k] = n;
        });
        KNIFE_FIELDS.forEach(function(f) { if (f.kind === 'int' && v[f.key] != null) v[f.key] = Math.round(v[f.key]); });

        var d = excelDate(get('delivered'));
        if (d) v.delivered = d;
        else if (cellText(get('delivered')) !== '') warnings.push('дата поставки «' + cellText(get('delivered')) + '» не разобрана');

        // Вал: «0» и пусто — нож без вала (решение #5308); раппорт 1С сверяется с валом и не берётся.
        var teeth = cellNum(get('cylinder'));
        if (teeth == null) warnings.push('вал не указан — нож без вала, подбор его не возьмёт, пока вал не заполнят');
        else if (teeth === 0) warnings.push('вал «0» — нож импортируется без вала; подбор его не возьмёт, пока вал не заполнят');
        else if (isNaN(teeth) || !(teeth > 0) || Math.round(teeth) !== teeth) warnings.push('вал «' + cellText(get('cylinder')) + '» — не целое число зубьев, нож без вала');
        else {
            v.cylinder = String(teeth);
            var rep = cellNum(get('repeat'));
            if (rep != null && !isNaN(rep) && lp) {
                var chk = lp.checkDieRepeat(fmtNum(rep), teeth);   // ячейка Excel: 419.00300000000004
                if (!chk.ok) warnings.push(chk.error + ' — раппорт 1С не берётся, вал — по номеру');
            }
        }

        var base = cellText(get('base'));
        if (base) v.base = base;
        var brand = cellText(get('brand'));
        if (brand && norm(brand) !== 'нет') v.brand = brand;
        var state = cellText(get('state'));
        if (state) {
            var st = lp ? lp.dieStateOf(state) : state;
            if (st) v.state = st;
            else warnings.push('состояние «' + state + '» — пустое; подбор берёт только «Рабочий»');
        }
        var angle = cellNum(get('angle'));
        if (angle != null && !isNaN(angle)) v.angle = fmtNum(angle) + '°';
        else if (cellText(get('angle'))) v.angle = cellText(get('angle'));

        var mileage = null, source = '';
        var own = cellNum(get('mileage'));
        if (own != null && !isNaN(own)) { mileage = Math.round(own); source = 'Ножи'; }
        else if (plan[key]) {
            if (plan[key].error) warnings.push(plan[key].error);
            else { mileage = plan[key].meters; source = 'План'; }
        }
        if (mileage != null && mileage < 0) { warnings.push('пробег ' + mileage + ' м меньше нуля — не импортирован'); mileage = null; source = ''; }

        return { row: rowNo, key: key, values: v, mileage: mileage, mileageSource: source, warnings: warnings, errors: errors };
    }

    // ── Лист заказов ─────────────────────────────────────────────────────────────────────

    var ORDER_COLS = {
        partner: ['Партнер', 'Партнёр'], order: ['Заказ Клиента'], supplierOrder: ['Заказ поставщику'],
        article: ['Артикул'], nomenclature: ['Номенклатура'], comment: ['Заказ.Комментарий', 'Комментарий'],
        received: ['Заказ.Дата поступления', 'Дата поступления'], knifeType: ['Тип ножей'], box: ['Короб'],
        unit: ['Единица хранения'], qty: ['Заказано количество']
    };

    // «85 х 38 5000 шт. П/Гл каучук намотка внутрь вт 76 (П)» → { width, length, perRoll, core, winding }
    // или null. «D х 40 …» — круглая этикетка, ширина = длине.
    var NOMEN_RE = /^\s*([DДdд]|\d+(?:[.,]\d+)?)\s*[хХxX×*]\s*(\d+(?:[.,]\d+)?)\s+(\d[\d\s]*?)\s*шт/;
    function parseNomenclature(s) {
        var m = NOMEN_RE.exec(String(s == null ? '' : s));
        if (!m) return null;
        var length = Number(m[2].replace(',', '.'));
        var width = /^[DДdд]$/.test(m[1]) ? length : Number(m[1].replace(',', '.'));
        var perRoll = Number(m[3].replace(/\s+/g, ''));
        if (!(width > 0) || !(length > 0) || !(perRoll > 0)) return null;
        var core = /вт\.?\s*(\d+)/i.exec(s);
        var winding = /намотка\s+внутрь/i.test(s) ? 'внутрь' : (/намотка\s+наруж/i.test(s) ? 'наружу' : '');
        // Сырьё — слово сразу за «шт.» («П/Гл», «П/П»), клей — по списку известных («каучук», «акрил»).
        var mat = /шт\.?\s+(\S+)/i.exec(s);
        var material = mat && !/^(намотка|вт\.?|каучук|акрил)/i.test(mat[1]) ? mat[1] : '';
        var gl = /(каучук|акрил\S*|hot\s*melt)/i.exec(s);
        return { width: width, length: length, perRoll: perRoll, core: core ? core[1] : '', winding: winding,
            material: material, glue: gl ? gl[1] : '' };
    }

    // Лист заказов → { ok, error, items, duplicates, skipped }. Строки «Итого» и строки партнёра
    // без заказа и артикула — в `skipped`; повтор пары «Заказ клиента» + артикул — в `duplicates`.
    function parseOrderSheet(grid) {
        var h = findHeader(grid, ORDER_COLS, ['order', 'article', 'nomenclature', 'qty']);
        if (!h.ok) return { ok: false, error: 'лист заказов: ' + h.error, items: [], duplicates: [], skipped: 0 };
        var items = [], duplicates = [], skipped = 0, firstRow = {};
        for (var r = h.row + 1; r < grid.length; r++) {
            var row = grid[r] || [];
            var get = function(k) { return cellText(cell(row, h.cols, k)); };
            var order = get('order').replace(/\.0+$/, ''), article = get('article');
            if (/^итого/i.test(cellText(row[0])) || (order === '' && article === '')) { skipped++; continue; }
            var key = order + ' / ' + article;
            if (order !== '' && article !== '' && firstRow[key] != null) {
                duplicates.push({ row: r + 1, key: key, firstRow: firstRow[key] });
                continue;
            }
            firstRow[key] = r + 1;
            var errors = [], warnings = [];
            if (order === '') errors.push('нет «Заказ клиента»');
            if (article === '') errors.push('нет артикула');
            var qty = cellNum(cell(row, h.cols, 'qty'));
            if (qty == null || isNaN(qty) || !(qty > 0) || Math.round(qty) !== qty) {
                errors.push('количество «' + get('qty') + '» — нужно целое число рулонов больше нуля');
            }
            var nom = get('nomenclature');
            var p = parseNomenclature(nom);
            if (!p) errors.push('номенклатура «' + nom + '» не разобрана: нужен вид «Ш х Д N шт. …», например «85 х 38 5000 шт.»');
            var received = excelDate(cell(row, h.cols, 'received'));
            if (!received && get('received')) warnings.push('дата поступления «' + get('received') + '» не разобрана');
            items.push({
                row: r + 1, key: key, order: order, article: article, partner: get('partner'),
                supplierOrder: get('supplierOrder'), nomenclature: nom, comment: get('comment'), received: received,
                knifeType: get('knifeType'), box: get('box'), unit: get('unit'), rolls: qty,
                label: p, warnings: warnings, errors: errors
            });
        }
        return { ok: true, items: items, duplicates: duplicates, skipped: skipped };
    }

    // ── Справочники ──────────────────────────────────────────────────────────────────────

    function dictByLabel(recs) {
        var out = {};
        (recs || []).forEach(function(r) { var k = norm(r.val); if (k !== '' && out[k] == null) out[k] = r.id; });
        return out;
    }

    // «Диаметр втулки»: «вт 40» → запись с «(40мм» в названии; из нескольких — для этикеток.
    function coreDict(recs) {
        var by = {};
        (recs || []).forEach(function(r) {
            var m = /\((\d+)\s*мм/i.exec(r.val);
            if (m) (by[m[1]] = by[m[1]] || []).push(r);
        });
        var out = {};
        Object.keys(by).forEach(function(d) {
            var list = by[d].length > 1 ? by[d].filter(function(r) { return /этикет/i.test(r.val); }) : by[d];
            if (list.length === 1) out[d] = list[0].id;
        });
        return out;
    }

    function valuesOf(rec, table, fields) {
        var out = {};
        fields.forEach(function(f) {
            var rid = table.reqs[f.key];
            if (!rid) return;
            out[f.key] = f.kind === 'ref' ? refId(rec, rid) : reqText(rec, rid);
        });
        return out;
    }

    // Данные базы для сверки ножей. data — { dies, runs (строки отчёта die_runs), cylinders, bases,
    // brands, states, runKinds }: записи — kvRecords.
    function knifeContext(tables, data) {
        var d = data || {};
        var dies = {}, dupInBase = {};
        (d.dies || []).forEach(function(r) {
            var key = String(r.val).trim();
            if (dies[key]) dupInBase[key] = true;
            else dies[key] = { id: r.id, values: valuesOf(r, tables.die, KNIFE_FIELDS), labels: r.reqs };
        });
        var runsByDie = {};
        (d.runs || []).forEach(function(r) {
            var id = String(r.die_id == null ? '' : r.die_id).trim();
            if (id) (runsByDie[id] = runsByDie[id] || []).push({ id: r.run_id, date: r.run_date, kind: r.run_kind, meters: r.meters });
        });
        var cylinder = {};
        (d.cylinders || []).forEach(function(r) { var n = cellNum(r.val); if (n > 0 && cylinder[String(n)] == null) cylinder[String(n)] = r.id; });
        var state = {};
        (d.states || []).forEach(function(r) { var k = norm(lp ? (lp.dieStateOf(r.val) || r.val) : r.val); if (state[k] == null) state[k] = r.id; });
        var initialKindId = '';
        (d.runKinds || []).forEach(function(r) { if (lp && lp.runKindOf(r.val) === lp.RUN_KIND.INITIAL) initialKindId = r.id; });
        return {
            tables: tables, dies: dies, dupInBase: dupInBase, runsByDie: runsByDie, initialKindId: initialKindId,
            dict: { cylinder: cylinder, base: dictByLabel(d.bases), brand: dictByLabel(d.brands), state: state },
            labels: {
                cylinder: labelIndex(d.cylinders), base: labelIndex(d.bases), brand: labelIndex(d.brands), state: labelIndex(d.states)
            }
        };
    }

    function labelIndex(recs) {
        var out = {};
        (recs || []).forEach(function(r) { out[r.id] = r.val; });
        return out;
    }

    function sameValue(kind, a, b) {
        var x = String(a == null ? '' : a).trim(), y = String(b == null ? '' : b).trim();
        if (kind === 'num' || kind === 'int') {
            var nx = cellNum(x), ny = cellNum(y);
            if (nx != null && ny != null && !isNaN(nx) && !isNaN(ny)) return Math.abs(nx - ny) < 1e-6;
        }
        if (kind === 'text') return norm(x.replace(/°/g, '')) === norm(y.replace(/°/g, ''));
        return x === y;
    }

    function counts0() { return { new: 0, update: 0, same: 0, duplicate: 0, error: 0, warnings: 0 }; }

    // План импорта ножей. → { rows, counts, ops }. rows — по строкам файла: { row, key, status
    // ('new'|'update'|'same'|'duplicate'|'error'), summary, changes: [{ field, from, to }], warnings,
    // errors, mileage, mileageSource }. ops — операции для runBatches; значение ссылки на запись,
    // создаваемую этим же импортом, — { ref }.
    function planKnives(parsed, ctx, opts) {
        var o = opts || {};
        var now = String(o.now != null ? o.now : Math.floor(Date.now() / 1000));
        var t = ctx.tables;
        var rows = [], ops = [], counts = counts0();
        var newCyl = {};

        (parsed.items || []).forEach(function(item) {
            var row = { row: item.row, key: item.key, status: '', summary: knifeSummary(item.values), changes: [],
                warnings: item.warnings.slice(), errors: item.errors.slice(), mileage: item.mileage, mileageSource: item.mileageSource };
            rows.push(row);
            if (ctx.dupInBase[item.key]) row.errors.push('в базе несколько ножей с номером ' + item.key + ' — какой обновлять, не угадываем');
            var existing = ctx.dies[item.key] || null;
            var runPlan = null;
            if (!row.errors.length && item.mileage != null) {
                if (!ctx.initialKindId) row.errors.push('в справочнике «Вид движения пробега» нет «начальный остаток»');
                else {
                    runPlan = lp.initialRunPlan(existing ? ctx.runsByDie[existing.id] : [], item.mileage);
                    if (runPlan.op === 'error') row.errors.push(runPlan.error);
                }
            }
            if (row.errors.length) { row.status = 'error'; counts.error++; return; }

            var target = {}, labels = {};
            KNIFE_FIELDS.forEach(function(f) {
                var val = item.values[f.key];
                if (val == null || val === '' || !t.die.reqs[f.key]) return;
                if (f.kind !== 'ref') { target[f.key] = f.kind === 'date' || f.kind === 'text' ? String(val) : fmtNum(val); labels[f.key] = target[f.key]; return; }
                var id = f.key === 'cylinder' ? ctx.dict.cylinder[val] : ctx.dict[f.key][norm(val)];
                if (id) { target[f.key] = id; labels[f.key] = val; return; }
                if (f.key === 'cylinder') {
                    if (!newCyl[val]) {
                        newCyl[val] = { op: 'new', table: t.cylinder.id, up: 1, ref: 'cylinder:' + val, group: 'cylinder:' + val, fields: {} };
                        newCyl[val].fields['t' + t.cylinder.id] = val;
                        if (t.cylinder.reqs.repeat && lp) newCyl[val].fields['t' + t.cylinder.reqs.repeat] = fmtNum(lp.cylinderRepeatMm(val));
                        ops.push(newCyl[val]);
                        row.warnings.push('вала ' + val + ' нет в справочнике — будет создан (раппорт ' + fmtNum(lp.cylinderRepeatMm(val)) + ' мм)');
                    }
                    target[f.key] = { ref: newCyl[val].ref }; labels[f.key] = val;
                    return;
                }
                var what = { base: 'основа', brand: 'марка', state: 'состояние' }[f.key];
                row.warnings.push(what + ' «' + val + '» — нет в справочнике «' + IMPORT_TABLES[f.key].name + '», поле не заполняется');
            });

            var dieRef = 'die:' + item.key;
            var group = dieRef;
            if (!existing) {
                var op = { op: 'new', table: t.die.id, up: 1, ref: dieRef, group: group, fields: {} };
                op.fields['t' + t.die.id] = item.key;
                Object.keys(target).forEach(function(k) { op.fields['t' + t.die.reqs[k]] = target[k]; });
                ops.push(op);
                row.status = 'new';
            } else {
                var set = { op: 'set', id: existing.id, group: group, fields: {} };
                KNIFE_FIELDS.forEach(function(f) {
                    if (f.createOnly || !(f.key in target)) return;
                    var want = target[f.key];
                    if (typeof want !== 'object' && sameValue(f.kind, existing.values[f.key], want)) return;
                    set.fields['t' + t.die.reqs[f.key]] = want;
                    var from = f.kind === 'ref' ? ((ctx.labels[f.key] || {})[existing.values[f.key]] || existing.values[f.key]) : existing.values[f.key];
                    row.changes.push({ field: t.die.reqNames[f.key], from: from || '—', to: labels[f.key] });
                });
                if (Object.keys(set.fields).length) ops.push(set);
            }
            if (runPlan && runPlan.op === 'new') {
                var run = { op: 'new', table: t.dieRun.id, up: existing ? existing.id : { ref: dieRef }, group: group, fields: {} };
                run.fields['t' + t.dieRun.id] = now;
                run.fields['t' + t.dieRun.reqs.meters] = fmtNum(runPlan.meters);
                run.fields['t' + t.dieRun.reqs.kind] = ctx.initialKindId;
                ops.push(run);
                if (existing) row.changes.push({ field: 'Начальный остаток, м', from: '—', to: fmtNum(runPlan.meters) });
            } else if (runPlan && runPlan.op === 'set') {
                var rs = { op: 'set', id: runPlan.id, group: group, fields: {} };
                rs.fields['t' + t.dieRun.reqs.meters] = fmtNum(runPlan.meters);
                ops.push(rs);
                var old = (ctx.runsByDie[existing.id] || []).filter(function(x) { return String(x.id) === runPlan.id; })[0];
                row.changes.push({ field: 'Начальный остаток, м', from: old ? fmtNum(cellNum(old.meters) || 0) : '?', to: fmtNum(runPlan.meters) });
            }
            if (!row.status) row.status = row.changes.length ? 'update' : 'same';
            counts[row.status]++;
            if (row.warnings.length) counts.warnings++;
        });
        (parsed.duplicates || []).forEach(function(d) {
            rows.push({ row: d.row, key: d.key, status: 'duplicate', summary: '', changes: [], warnings: ['повтор номера ножа — первое вхождение в строке ' + d.firstRow + ', эта строка пропущена'], errors: [] });
            counts.duplicate++;
        });
        rows.sort(function(a, b) { return a.row - b.row; });
        return { rows: rows, counts: counts, ops: ops };
    }

    function knifeSummary(v) {
        var parts = [];
        if (v.labelWidth != null && v.labelLength != null) parts.push(fmtNum(v.labelWidth) + '×' + fmtNum(v.labelLength));
        if (v.cylinder) parts.push('вал ' + v.cylinder);
        if (v.base) parts.push(v.base);
        if (v.state) parts.push(v.state);
        return parts.join(', ');
    }

    // ── Заказы ───────────────────────────────────────────────────────────────────────────

    var POSITION_FIELDS = [
        { key: 'productKind', kind: 'ref' }, { key: 'article', kind: 'ref' }, { key: 'clientOrder', kind: 'text' },
        { key: 'labelWidth', kind: 'num' }, { key: 'labelLength', kind: 'num' }, { key: 'labelsPerRoll', kind: 'int' },
        { key: 'knifeType', kind: 'text' }, { key: 'core', kind: 'ref' }, { key: 'winding', kind: 'text' },
        { key: 'unit', kind: 'ref' }, { key: 'status', kind: 'ref', createOnly: true }, { key: 'note', kind: 'text', createOnly: true },
        // Сырьё и срок подбирает импорт, но выбор менеджера не затирает: у существующей позиции они пишутся, только если пусты.
        { key: 'material', kind: 'ref', fillOnly: true }, { key: 'due', kind: 'text', fillOnly: true }
    ];

    // Настройка «срок = поступление + N дней»: допущение тест-цикла (14), владелец подтвердит.
    var DUE_DAYS_KEY = 'LABEL_DUE_DAYS';
    var DUE_DAYS_DEFAULT = 14;

    // Значение настройки по ключу: строки { key, type, value }; приоритет — тип = база, ATEH, любой.
    function settingValue(recs, key, db) {
        var dbKey = String(db || '').trim().toUpperCase();
        var best = null, bestRank = 0;
        (recs || []).forEach(function(r) {
            if (String(r.key || '').replace(/^\ufeff/, '').trim() !== key) return;
            var v = String(r.value == null ? '' : r.value).trim();
            if (v === '') return;
            var type = String(r.type || '').trim().toUpperCase();
            var rank = dbKey && type === dbKey ? 3 : (type === 'ATEH' ? 2 : 1);
            if (rank >= bestRank) { best = v; bestRank = rank; }
        });
        return best == null ? '' : best;
    }

    // «ДД.ММ.ГГГГ» + N дней → «ДД.ММ.ГГГГ»; '' — даты нет.
    function addDays(ruDate, days) {
        var m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(ruDate || '').trim());
        if (!m || !isFinite(days)) return '';
        var d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1] + Math.round(days)));
        return pad2(d.getUTCDate()) + '.' + pad2(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear();
    }

    // Основа по обозначению сырья из номенклатуры 1С: «П/П» — полипропилен, «П/Гл», «П/М» (глянец, матовая) — бумага.
    // Допущение тест-цикла (cycle.py); остальные обозначения не угадываются.
    function baseHint(token) {
        var t = norm(token);
        if (/^п\/п$|^пп$/.test(t)) return 'пп';
        if (/^п\/(гл|м|мат)$|^бумага$/.test(t)) return 'бумага';
        return '';
    }

    // Сырьё позиции по обозначению и клею из номенклатуры. materials — [{ id, name, base, glue }].
    // → { ok, id, name, base } | { ok:false, reason }
    function matchMaterial(label, materials) {
        var token = label && label.material ? String(label.material).trim() : '';
        var glue = label && label.glue ? norm(label.glue) : '';
        var list = materials || [];
        if (!token) return { ok: false, reason: 'в номенклатуре 1С нет обозначения материала' };
        if (!list.length) return { ok: false, reason: 'справочник «Сырьё этикетки» пуст' };
        var exact = list.filter(function(m) { return norm(m.name) === norm(token) || (glue && norm(m.name) === norm(token + ' ' + glue)); });
        if (exact.length === 1) return { ok: true, id: exact[0].id, name: exact[0].name, base: exact[0].base };
        var hint = baseHint(token);
        if (!hint) return { ok: false, reason: 'материал «' + token + '» из 1С не опознан' };
        var cand = list.filter(function(m) { return norm(m.base) === hint; });
        if (glue) cand = cand.filter(function(m) { return !m.glue || norm(m.glue) === glue; });
        if (cand.length === 1) return { ok: true, id: cand[0].id, name: cand[0].name, base: cand[0].base };
        return { ok: false, reason: cand.length
            ? 'материалу «' + token + '» подходит несколько записей сырья (' + cand.map(function(m) { return m.name; }).join(', ') + ')'
            : 'материалу «' + token + '» (основа «' + hint + '») нет сырья в справочнике' };
    }

    // Предупреждения по типам: текст без чисел и названий в «…» → { type, count, rows: [номер строки], samples: [текст] }.
    function warningType(text) {
        return String(text).replace(/«[^»]*»/g, '«…»').replace(/\d+(?:[.,]\d+)?/g, 'N').replace(/\s+/g, ' ').trim();
    }
    function groupWarnings(rows) {
        var by = {}, order = [];
        (rows || []).forEach(function(r) {
            (r.warnings || []).forEach(function(w) {
                var k = warningType(w);
                if (!by[k]) { by[k] = { type: k, count: 0, rows: [], samples: [] }; order.push(k); }
                by[k].count++;
                by[k].rows.push({ row: r.row, key: r.key, text: w });
            });
        });
        return order.map(function(k) { return by[k]; }).sort(function(a, b) { return b.count - a.count; });
    }
    var ORDER_FIELDS = [
        { key: 'client', kind: 'ref' }, { key: 'created', kind: 'date', createOnly: true },
        { key: 'status', kind: 'ref', createOnly: true }, { key: 'note', kind: 'text', createOnly: true }
    ];

    // Данные базы для сверки заказов. data — { orders, positions (с up = заказ), clients, articles,
    // productKinds, orderStatuses, positionStatuses, cores, units }: записи — kvRecords.
    function orderContext(tables, data) {
        var d = data || {};
        var orders = {}, dupInBase = {};
        (d.orders || []).forEach(function(r) {
            var key = String(r.val).trim();
            if (orders[key]) dupInBase[key] = true;
            else orders[key] = { id: r.id, values: valuesOf(r, tables.order, ORDER_FIELDS) };
        });
        var positions = {};
        var artReq = tables.position.reqs.article;
        (d.positions || []).forEach(function(r) {
            var art = norm(reqText(r, artReq));
            var byArt = positions[r.up] = positions[r.up] || {};
            (byArt[art] = byArt[art] || []).push({ id: r.id, val: r.val, values: valuesOf(r, tables.position, POSITION_FIELDS) });
        });
        var statusNew = function(recs, label) {
            var hit = (recs || []).filter(function(r) { return norm(r.val) === label; })[0];
            return hit ? hit.id : '';
        };
        var materials = [];
        if (tables.material) {
            (d.materials || []).forEach(function(r) {
                var baseCol = tables.material.reqs.base, glueCol = tables.material.reqs.glue;
                materials.push({ id: r.id, name: r.val, base: baseCol ? reqText(r, baseCol) : '', glue: glueCol ? reqText(r, glueCol) : '' });
            });
        }
        var dueDays = DUE_DAYS_DEFAULT;
        if (tables.setting && tables.setting.reqs.value) {
            var raw = settingValue((d.settings || []).map(function(r) {
                return { key: r.val, type: tables.setting.reqs.type ? reqText(r, tables.setting.reqs.type) : '', value: reqText(r, tables.setting.reqs.value) };
            }), DUE_DAYS_KEY, d.db);
            var n = cellNum(raw);
            if (n != null && !isNaN(n) && n >= 0) dueDays = Math.round(n);
        }
        return {
            tables: tables, orders: orders, dupInBase: dupInBase, positions: positions, materials: materials, dueDays: dueDays,
            dict: {
                client: dictByLabel(d.clients), article: dictByLabel(d.articles), productKind: dictByLabel(d.productKinds),
                core: coreDict(d.cores), unit: dictByLabel(d.units)
            },
            labels: { client: labelIndex(d.clients), article: labelIndex(d.articles), productKind: labelIndex(d.productKinds), core: labelIndex(d.cores), unit: labelIndex(d.units) },
            orderStatusNew: statusNew(d.orderStatuses, 'новый'),
            positionStatusNew: statusNew(d.positionStatuses, 'новая')
        };
    }

    // План импорта заказов. → { rows, counts (+ ordersNew, ordersUpdate), ops }. Строка — позиция
    // файла: { row, key, order, status, summary, changes, warnings, errors }.
    function planOrders(parsed, ctx, opts) {
        var t = ctx.tables;
        var rows = [], ops = [], counts = counts0();
        counts.ordersNew = 0; counts.ordersUpdate = 0;
        var refOps = {};
        function ensure(dictKey, label) {
            var id = ctx.dict[dictKey][norm(label)];
            if (id) return id;
            var ref = dictKey + ':' + norm(label);
            if (!refOps[ref]) {
                refOps[ref] = { op: 'new', table: t[dictKey].id, up: 1, ref: ref, group: ref, fields: {} };
                refOps[ref].fields['t' + t[dictKey].id] = label;
                ops.push(refOps[ref]);
            }
            return { ref: ref };
        }
        var kindId = ctx.dict.productKind[norm(lp ? lp.PRODUCT_KIND.LABEL : 'этикетка')] || '';

        var groups = [], byOrder = {};
        (parsed.items || []).forEach(function(item) {
            if (!byOrder[item.order]) { byOrder[item.order] = { order: item.order, items: [] }; groups.push(byOrder[item.order]); }
            byOrder[item.order].items.push(item);
        });

        groups.forEach(function(g) {
            var ok = [];
            g.items.forEach(function(item) {
                var row = { row: item.row, key: item.key, order: item.order, status: '', summary: orderSummary(item), changes: [],
                    warnings: item.warnings.slice(), errors: item.errors.slice() };
                rows.push(row);
                if (!item.errors.length && g.order !== '' && ctx.dupInBase[g.order]) row.errors.push('в базе несколько заказов с номером ' + g.order);
                if (!kindId) row.errors.push('в справочнике «Вид продукции» нет «этикетка»');
                if (row.errors.length) { row.status = 'error'; counts.error++; return; }
                ok.push({ item: item, row: row });
            });
            if (!ok.length) return;

            var first = ok[0].item;
            var existing = ctx.orders[g.order] || null;
            var orderRef = 'order:' + g.order, group = orderRef;
            var target = {};
            var partner = ok.map(function(x) { return x.item.partner; }).filter(Boolean)[0] || '';
            if (partner) target.client = ensure('client', partner);
            if (first.received && t.order.reqs.created) target.created = first.received;
            if (ctx.orderStatusNew && t.order.reqs.status) target.status = ctx.orderStatusNew;
            var comment = ok.map(function(x) { return x.item.comment; }).filter(Boolean)[0] || '';
            if (comment && t.order.reqs.note) target.note = comment;
            var orderChanges = [];
            if (existing && partner && t.order.reqs.client) {
                var curClient = (ctx.labels.client || {})[existing.values.client] || '';
                if (curClient && norm(curClient) !== norm(partner)) {
                    ok[0].row.warnings.push('номер заказа ' + g.order + ' уже есть в базе у клиента «' + curClient + '», в файле — «' + partner +
                        '»: клиент заказа будет заменён; проверьте, что это тот же заказ, а не совпадение номера со старым');
                }
            }
            if (!existing) {
                var on = { op: 'new', table: t.order.id, up: 1, ref: orderRef, group: group, fields: {} };
                on.fields['t' + t.order.id] = g.order;
                Object.keys(target).forEach(function(k) { if (t.order.reqs[k]) on.fields['t' + t.order.reqs[k]] = target[k]; });
                ops.push(on);
                counts.ordersNew++;
            } else {
                var os = { op: 'set', id: existing.id, group: group, fields: {} };
                ORDER_FIELDS.forEach(function(f) {
                    if (f.createOnly || !(f.key in target) || !t.order.reqs[f.key]) return;
                    var want = target[f.key];
                    if (typeof want !== 'object' && sameValue(f.kind, existing.values[f.key], want)) return;
                    os.fields['t' + t.order.reqs[f.key]] = want;
                    orderChanges.push({ field: 'Заказ: ' + t.order.reqNames[f.key], from: (ctx.labels[f.key] || {})[existing.values[f.key]] || existing.values[f.key] || '—', to: f.key === 'client' ? partner : want });
                });
                if (Object.keys(os.fields).length) { ops.push(os); counts.ordersUpdate++; }
            }

            ok.forEach(function(x, i) {
                var item = x.item, row = x.row;
                if (i === 0) row.changes = row.changes.concat(orderChanges);
                var lab = item.label;
                var pt = {}, plabels = {};
                var matchRes = t.position.reqs.material ? matchMaterial(lab, ctx.materials) : null;
                var put = function(k, v, label) { if (v == null || v === '' || !t.position.reqs[k]) return; pt[k] = v; plabels[k] = label != null ? label : v; };
                put('productKind', kindId, lp ? lp.PRODUCT_KIND.LABEL : 'этикетка');
                put('article', ensure('article', item.article), item.article);
                put('clientOrder', item.order);
                put('labelWidth', fmtNum(lab.width));
                put('labelLength', fmtNum(lab.length));
                put('labelsPerRoll', fmtNum(lab.perRoll));
                put('knifeType', item.knifeType);
                if (lab.core) {
                    if (ctx.dict.core[lab.core]) put('core', ctx.dict.core[lab.core], 'вт ' + lab.core);
                    else row.warnings.push('втулка «вт ' + lab.core + '» — в справочнике «Диаметр втулки» нет одной записи на ' + lab.core + ' мм, поле не заполняется');
                }
                put('winding', lab.winding);
                var due = t.position.reqs.due ? addDays(item.received, ctx.dueDays) : '';
                put('due', due);
                if (matchRes && matchRes.ok) put('material', matchRes.id, matchRes.name);
                if (item.unit) {
                    if (ctx.dict.unit[norm(item.unit)]) put('unit', ctx.dict.unit[norm(item.unit)], item.unit);
                    else row.warnings.push('единица «' + item.unit + '» — нет в справочнике «Ед.изм.»');
                }
                put('status', ctx.positionStatusNew);
                put('note', ['Номенклатура 1С: ' + item.nomenclature, item.supplierOrder ? 'заказ поставщику ' + item.supplierOrder : '',
                    item.box ? 'короб ' + item.box : ''].filter(Boolean).join('; '));

                var rolls = fmtNum(item.rolls);
                var posList = existing ? ((ctx.positions[existing.id] || {})[norm(item.article)] || []) : [];
                if (posList.length > 1) {
                    row.errors.push('в заказе ' + item.order + ' несколько позиций с артикулом ' + item.article + ' — какую обновлять, не угадываем');
                    row.status = 'error'; counts.error++; return;
                }
                var pos = posList[0];
                if (matchRes) {
                    var hasMat = pos && pos.values.material;
                    if (!hasMat && !matchRes.ok) row.warnings.push('позиция не готова к подбору ножа: нет сырья — ' + matchRes.reason + '; выберите сырьё в «Заказах этикетки»');
                    else if (!hasMat && !matchRes.base) row.warnings.push('позиция не готова к подбору ножа: у сырья «' + matchRes.name + '» не задана основа');
                }
                if (t.position.reqs.due && !due && !(pos && pos.values.due)) row.warnings.push('нет даты поступления — срок изготовления не заполнен');
                if (!pos) {
                    var pn = { op: 'new', table: t.position.id, up: existing ? existing.id : { ref: orderRef }, group: group, fields: {} };
                    pn.fields['t' + t.position.id] = rolls;
                    Object.keys(pt).forEach(function(k) { pn.fields['t' + t.position.reqs[k]] = pt[k]; });
                    ops.push(pn);
                    row.status = 'new';
                } else {
                    if (!sameValue('num', pos.val, rolls)) {
                        var sv = { op: 'save', id: pos.id, group: group, fields: {} };
                        sv.fields['t' + t.position.id] = rolls;
                        ops.push(sv);
                        row.changes.push({ field: 'Заказано, рулонов', from: pos.val || '—', to: rolls });
                    }
                    var ps = { op: 'set', id: pos.id, group: group, fields: {} };
                    POSITION_FIELDS.forEach(function(f) {
                        if (f.createOnly || !(f.key in pt)) return;
                        if (f.fillOnly && pos.values[f.key]) return;
                        var want = pt[f.key];
                        if (typeof want !== 'object' && sameValue(f.kind, pos.values[f.key], want)) return;
                        ps.fields['t' + t.position.reqs[f.key]] = want;
                        var from = f.kind === 'ref' ? ((ctx.labels[f.key] || {})[pos.values[f.key]] || pos.values[f.key]) : pos.values[f.key];
                        row.changes.push({ field: t.position.reqNames[f.key], from: from || '—', to: plabels[f.key] });
                    });
                    if (Object.keys(ps.fields).length) ops.push(ps);
                    row.status = row.changes.length ? 'update' : 'same';
                }
                counts[row.status]++;
                if (row.warnings.length) counts.warnings++;
            });
        });
        (parsed.duplicates || []).forEach(function(d) {
            rows.push({ row: d.row, key: d.key, order: d.key.split(' / ')[0], status: 'duplicate', summary: '', changes: [],
                warnings: ['повтор пары «Заказ клиента» + артикул — первое вхождение в строке ' + d.firstRow + ', эта строка пропущена'], errors: [] });
            counts.duplicate++;
        });
        rows.sort(function(a, b) { return a.row - b.row; });
        return { rows: rows, counts: counts, ops: ops };
    }

    function orderSummary(item) {
        var l = item.label;
        return (l ? fmtNum(l.width) + '×' + fmtNum(l.length) + ', ' + l.perRoll + ' шт/рул' : '') +
            (item.rolls > 0 ? ', ' + item.rolls + ' рул.' : '');
    }

    // ── Запись пакетами ──────────────────────────────────────────────────────────────────

    // Пакеты _m_batch из операций плана: операции одной группы (запись + её подчинённые) — в одном
    // пакете; { ref } → ":idN" внутри пакета или id, созданный прошлым пакетом.
    // send(ops) → Promise<{ results: [{ n, ok, id, error }] }>.
    // → Promise<{ ok, failed: [{ op, error }], created: { ref: id }, batches, ms }>.
    function runBatches(ops, send, opts) {
        var o = opts || {};
        var size = Math.max(1, Math.min(o.batchSize || 500, 1000));
        var groups = [], byKey = {};
        (ops || []).forEach(function(op) {
            var k = op.group || ('#' + groups.length);
            if (!byKey[k] || byKey[k] !== groups[groups.length - 1]) { byKey[k] = []; groups.push(byKey[k]); }
            byKey[k].push(op);
        });
        var batches = [], cur = [];
        groups.forEach(function(g) {
            if (cur.length && cur.length + g.length > size) { batches.push(cur); cur = []; }
            cur = cur.concat(g);
        });
        if (cur.length) batches.push(cur);

        var created = {}, failed = [], t0 = Date.now(), done = 0, total = (ops || []).length;
        function translate(v, local) {
            if (v && typeof v === 'object' && v.ref) {
                if (local[v.ref] != null) return ':id' + local[v.ref];
                if (created[v.ref] != null) return String(created[v.ref]);
                throw new Error('запись «' + v.ref + '» не создана');
            }
            return v;
        }
        var chain = Promise.resolve();
        batches.forEach(function(batch, bi) {
            chain = chain.then(function() {
                var local = {}, payload = [], sent = [];
                batch.forEach(function(op) {
                    try {
                        var p = { op: op.op, fields: {} };
                        if (op.op === 'new') { p.id = op.table; p.up = translate(op.up == null ? 1 : op.up, local); }
                        else p.id = translate(op.id, local);
                        Object.keys(op.fields || {}).forEach(function(k) { p.fields[k] = translate(op.fields[k], local); });
                        if (op.op === 'new' && op.ref) local[op.ref] = payload.length;
                        payload.push(p); sent.push(op);
                    } catch (e) { failed.push({ op: op, error: e.message }); }
                });
                if (!payload.length) return;
                return Promise.resolve(send(payload)).then(function(res) {
                    var results = res && Array.isArray(res.results) ? res.results : null;
                    if (!results) throw new Error('пакет ' + (bi + 1) + ': ответ без results — ' + JSON.stringify(res).slice(0, 200));
                    var byN = {};
                    results.forEach(function(r) { byN[r.n] = r; });
                    sent.forEach(function(op, n) {
                        var r = byN[n];
                        if (!r || !r.ok) { failed.push({ op: op, error: r ? (r.error || 'ошибка') : 'нет ответа на операцию' }); return; }
                        if (op.op === 'new' && op.ref && r.id != null) created[op.ref] = String(r.id);
                    });
                    done += batch.length;
                    if (o.onProgress) o.onProgress({ done: done, total: total, batch: bi + 1, batches: batches.length });
                });
            });
        });
        return chain.then(function() {
            return { ok: failed.length === 0, failed: failed, created: created, batches: batches.length, ms: Date.now() - t0 };
        });
    }

    return {
        IMPORT_TABLES: IMPORT_TABLES,
        resolveImportTables: resolveImportTables,
        missingFor: missingFor,
        kvRecords: kvRecords,
        refId: refId,
        cellNum: cellNum,
        excelDate: excelDate,
        findHeader: findHeader,
        parseNomenclature: parseNomenclature,
        matchMaterial: matchMaterial,
        addDays: addDays,
        settingValue: settingValue,
        groupWarnings: groupWarnings,
        warningType: warningType,
        DUE_DAYS_KEY: DUE_DAYS_KEY,
        DUE_DAYS_DEFAULT: DUE_DAYS_DEFAULT,
        parseKnifeSheet: parseKnifeSheet,
        parseOrderSheet: parseOrderSheet,
        planMileage: planMileage,
        knifeContext: knifeContext,
        orderContext: orderContext,
        planKnives: planKnives,
        planOrders: planOrders,
        runBatches: runBatches
    };
});
