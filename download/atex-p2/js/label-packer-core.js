// Упаковка этикетки — ядро (ideav/crm#5348, Фаза 2 atex, шаг 10).
//
// Чистые функции рабочего места «Упаковка этикетки»; экран — label-packer.js.
// Источник — «Партия ГП этикетки», которую пульт высечки создаёт на каждый съём (статус
// «к упаковке», «Количество» = рулонов). Одна строка отчёта label_packer — одна партия вместе
// с заданием высечки, позицией заказа, заказом и клиентом.
//   - рулон: длина = этикеток в рулоне × (длина этикетки + м/э расстояние ножа); диаметр
//     = √(d² + 4·L·t/π), d — диаметр втулки, L — длина намотки, t — толщина материала;
//     ширина рулона — «Ширина втулки, мм» позиции. Нет данных — рулон «не определён»,
//     короб выбирает упаковщик;
//   - короб: функции Фазы 1 download/atex/js/packaging-size.js (matchSize, boxesFor) — только
//     вызов, файл не меняется; справочник «Типоразмер» читает отчёт pack_sizes;
//   - склад НК (#5086 Фазы 1): неполный короб уходит на «Склад НК»; движение — число в партии
//     («Склад НК, рулонов»: + на склад, − со склада), сальдо — по артикулу по всем партиям;
//   - запись: партия получает «Упаковано, рулонов», статус «упаковано», короб, место, НК;
//     журнал — «Событие смены высечки» типа «Упаковка» со ссылкой на задание.
// Таблицы и реквизиты — по именам из /metadata, id в коде нет.
// Покрыто experiments/atex-p2-5348-label-packer.test.js.

(function(root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.AtexLabelPackerCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
    'use strict';

    var PS = ((root && root.AtexPackagingSize) || (typeof require === 'function' ? require('../../atex/js/packaging-size.js') : null)).core;

    var STATUS = { TODO: 'к упаковке', PACKED: 'упаковано' };
    var EVENT_TYPE_PACK = 'Упаковка';
    var REPORT = 'label_packer';

    // Таблицы и реквизиты: ключ → имя (или список имён: псевдоним, затем имя типа).
    var TABLES = {
        gp: { name: 'Партия ГП этикетки', reqs: {
            job: 'Задание высечки', qty: 'Количество', size: 'Типоразмер', status: 'Статус упаковки',
            packed: 'Упаковано, рулонов', nk: 'Склад НК, рулонов', notes: 'Примечание', place: 'Упаковочное место'
        }, required: ['qty', 'status', 'packed'] },
        event: { name: 'Событие смены высечки', reqs: {
            type: 'Тип события высечки', operator: ['Оператор', 'Пользователь'], notes: 'Примечание', job: 'Задание высечки'
        }, required: ['type', 'job'] },
        eventType: { name: 'Тип события высечки', reqs: {}, required: [] }
    };

    function norm(s) { return String(s == null ? '' : s).replace(/^\s*\d+:/, '').trim().toLowerCase(); }
    function str(v) { return v == null ? '' : String(v); }
    function kvVal(v) {
        if (v != null && typeof v === 'object') return v.val != null ? v.val : (v.id != null ? v.id : '');
        return v == null ? '' : v;
    }
    function num(v) {
        var n = parseFloat(str(kvVal(v)).replace(/\s/g, '').replace(',', '.'));
        return isFinite(n) ? n : 0;
    }
    function cell(r, k) { return str(kvVal(r && r[k])).trim(); }

    // ── Строка отчёта → партия ──

    function itemFromReportRow(r) {
        var row = r || {};
        return {
            gpId: cell(row, 'gp_id'),
            name: cell(row, 'gp_name'),
            qty: num(row.qty),
            status: cell(row, 'pack_status'),
            packed: num(row.packed),
            nk: num(row.nk),
            notes: cell(row, 'notes'),
            sizeId: cell(row, 'size_id'),
            sizeName: cell(row, 'size_name'),
            placeId: cell(row, 'place_id'),
            jobId: cell(row, 'job_id'),
            jobStart: num(row.job_start),
            orderNo: cell(row, 'order_no'),
            client: cell(row, 'client'),
            orderClient: cell(row, 'order_client'),
            art: cell(row, 'art'),
            positionId: cell(row, 'position_id'),
            labelWidth: num(row.label_width),
            labelLength: num(row.label_length),
            perRoll: num(row.labels_per_roll),
            sleeveWidth: num(row.sleeve_width),
            sleeve: cell(row, 'sleeve'),
            sleeveInch: num(row.sleeve_inch),
            material: cell(row, 'material'),
            thickness: num(row.thickness),
            dieGap: num(row.die_gap)
        };
    }

    // ── Рулон ──

    // Диаметр втулки, мм: «(76мм/5мм/1000мм)» в названии точнее дюймов (1,5" = 40 мм).
    function sleeveDiameterMm(name, inches) {
        var m = /\(\s*(\d+(?:[.,]\d+)?)\s*мм/i.exec(str(name));
        if (m) return parseFloat(m[1].replace(',', '.'));
        var inch = num(inches);
        return inch > 0 ? Math.round(inch * 25.4 * 10) / 10 : 0;
    }

    function rollParams(item) {
        var it = item || {};
        var missing = [];
        var pitch = num(it.labelLength) > 0 ? num(it.labelLength) + Math.max(0, num(it.dieGap)) : 0;
        if (!(num(it.perRoll) > 0)) missing.push('этикеток в рулоне');
        if (!(num(it.labelLength) > 0)) missing.push('длина этикетки');
        var lengthM = pitch > 0 && num(it.perRoll) > 0 ? num(it.perRoll) * pitch / 1000 : 0;
        var widthMm = num(it.sleeveWidth) > 0 ? num(it.sleeveWidth) : 0;
        if (!widthMm) missing.push('ширина рулона');
        var sleeveMm = sleeveDiameterMm(it.sleeve, it.sleeveInch);
        if (!sleeveMm) missing.push('диаметр втулки');
        var thickness = num(it.thickness);
        if (!(thickness > 0)) missing.push('толщина');
        var diameterMm = 0;
        if (lengthM > 0 && sleeveMm > 0 && thickness > 0) {
            // Намотка: площадь сечения кольца = длина × толщина слоя.
            diameterMm = Math.round(Math.sqrt(sleeveMm * sleeveMm + 4 * lengthM * 1000 * (thickness / 1000) / Math.PI));
        }
        return { ok: lengthM > 0 && widthMm > 0, lengthM: lengthM, widthMm: widthMm, sleeveMm: sleeveMm, diameterMm: diameterMm, missing: missing };
    }

    function describeRoll(roll) {
        if (!roll || !roll.ok) return 'размер рулона не определён' + (roll && roll.missing && roll.missing.length ? ' (нет: ' + roll.missing.join(', ') + ')' : '');
        var parts = ['ширина ' + roll.widthMm + ' мм', 'длина ' + (Math.round(roll.lengthM * 10) / 10) + ' м'];
        parts.push(roll.diameterMm ? 'диаметр ' + roll.diameterMm + ' мм' : 'диаметр не определён');
        return parts.join(' · ');
    }

    // ── Короб ──

    // Типоразмер по ширине и длине намотки рулона (функции Фазы 1); этикетка без доп. втулки и не фольга.
    function pickSize(sizes, item) {
        var roll = rollParams(item);
        if (!roll.ok) return null;
        return PS.matchSize(sizes, { width: roll.widthMm, length: roll.lengthM, foil: false, addSleeve: '' });
    }

    // Ручной выбор: все записи справочника, у которых есть короб и норма укладки.
    function manualSizes(sizes) {
        return (sizes || []).filter(function(s) { return s && s.box && s.perBox > 0; }).slice().sort(function(a, b) {
            var c = String(a.box).localeCompare(String(b.box), 'ru', { numeric: true });
            return c || String(a.name).localeCompare(String(b.name), 'ru', { numeric: true });
        });
    }

    // Список ручного выбора: сначала короба, подходящие рулону по ширине (не фольга), затем остальные.
    function splitSizes(sizes, item) {
        var roll = rollParams(item);
        var all = manualSizes(sizes);
        if (!(roll.widthMm > 0)) return { near: [], rest: all };
        var near = all.filter(function(z) { return z.hasRange && !z.foil && roll.widthMm >= z.wFrom && roll.widthMm <= z.wTo; });
        return { near: near, rest: all.filter(function(z) { return near.indexOf(z) === -1; }) };
    }

    function packPlan(size, qty) {
        var perBox = size && size.perBox > 0 ? size.perBox : 0;
        var n = Math.max(0, Math.floor(num(qty)));
        if (!perBox || !n) return { perBox: perBox, boxes: 0, full: 0, rest: 0 };
        var full = Math.floor(n / perBox);
        return { perBox: perBox, boxes: PS.boxesFor(size, n), full: full, rest: n - full * perBox };
    }

    function describePlan(plan) {
        if (!plan || !plan.boxes) return '';
        var text = PS.boxesLabel(plan.boxes) + ' по ' + plan.perBox + ' рул.';
        if (plan.rest > 0) text += ' (' + (plan.full ? plan.full + ' полн. + ' : '') + 'неполный на ' + plan.rest + ')';
        return text;
    }

    // ── Проверки форм ──

    function validatePack(form) {
        var f = form || {};
        var raw = str(f.qty).trim().replace(',', '.');
        var qty = Number(raw);
        if (raw === '' || !isFinite(qty) || !(qty > 0)) return 'Количество должно быть больше нуля';
        if (Math.floor(qty) !== qty) return 'Рулонов — целое число';
        if (qty !== num(f.suggested) + num(f.nkFrom) && !str(f.note).trim()) return 'Количество изменено — напишите примечание';
        return '';
    }

    function nkValue(to, from) {
        var t = num(to), f = num(from);
        if (t > 0) return t;
        if (f > 0) return -f;
        return 0;
    }

    function validateNk(form) {
        var f = form || {};
        var to = str(f.to).trim(), from = str(f.from).trim();
        if (to && from) return 'Заполните только одно поле: «На склад НК» или «Со склада НК»';
        var raw = to || from;
        if (!raw) return '';
        var n = Number(raw.replace(',', '.'));
        if (!(n > 0) || Math.floor(n) !== n) return 'Склад НК: целое число больше нуля';
        if (from && n > num(f.available)) return 'На складе НК только ' + num(f.available) + ' рул.';
        return '';
    }

    function nkOf(item) {
        var it = item || {};
        return it.editedNk != null ? num(it.editedNk) : num(it.nk);
    }

    // Сальдо склада НК по артикулу: сумма движений всех партий. Партия без артикула не участвует.
    function nkStockByArt(items) {
        var stock = {};
        (items || []).forEach(function(it) {
            var art = str(it && it.art).trim();
            if (!art) return;
            stock[art] = (stock[art] || 0) + nkOf(it);
        });
        return stock;
    }

    function nkNote(nk) {
        var n = num(nk);
        if (n > 0) return 'на склад НК ' + n + ' рул.';
        if (n < 0) return 'со склада НК ' + (-n) + ' рул.';
        return '';
    }

    // ── Очередь ──

    function byJob(a, b) {
        return a.jobStart - b.jobStart || num(a.jobId) - num(b.jobId) || num(a.gpId) - num(b.gpId);
    }

    function buildQueue(items) {
        var todo = [], done = [], other = [];
        (items || []).forEach(function(it) {
            var s = norm(it.status);
            if (s === norm(STATUS.TODO)) todo.push(it);
            else if (s === norm(STATUS.PACKED)) done.push(it);
            else other.push(it);
        });
        todo.sort(byJob);
        done.sort(function(a, b) { return -byJob(a, b); });
        return { todo: todo, done: done, other: other };
    }

    // Партии одного заказа — одна плашка. Без номера заказа чужие партии не склеиваются.
    function groupByOrder(items) {
        var order = [], byKey = {};
        (items || []).forEach(function(it, idx) {
            var key = it.orderNo ? 'o:' + it.orderNo : 'i:' + idx;
            if (!byKey[key]) {
                byKey[key] = { orderNo: it.orderNo, client: it.client, orderClient: it.orderClient, items: [], qty: 0 };
                order.push(key);
            }
            byKey[key].items.push(it);
            byKey[key].qty += it.qty;
        });
        return order.map(function(k) { return byKey[k]; });
    }

    // Упаковочное место из настройки планшета (pad-guard.js): { id, label } или null.
    function padPlace(pad) {
        var obj = pad && pad.config && pad.config.place;
        var id = str(obj && obj.id).trim();
        var label = str(obj && obj.label).trim();
        if (!id && !label) return null;
        return { id: id || label, label: label || id };
    }

    // ── Записи ──

    function gpFields(gp, d) {
        var data = d || {}, r = (gp && gp.reqs) || {}, f = {};
        if (r.packed) f['t' + r.packed] = String(num(data.qty));
        if (r.status) f['t' + r.status] = STATUS.PACKED;
        if (r.size && str(data.sizeId).trim()) f['t' + r.size] = str(data.sizeId).trim();
        if (data.nk != null && r.nk) f['t' + r.nk] = num(data.nk) ? String(num(data.nk)) : '';
        if (r.notes && str(data.note).trim()) f['t' + r.notes] = str(data.note).trim();
        if (r.place && str(data.placeId).trim()) f['t' + r.place] = str(data.placeId).trim();
        return f;
    }

    function eventNote(d) {
        var data = d || {};
        var parts = ['упаковано ' + num(data.qty) + ' рул.'];
        if (data.box) parts.push('короб ' + data.box + (data.boxes ? ' × ' + data.boxes : ''));
        if (data.nk) parts.push(nkNote(data.nk));
        if (str(data.place).trim()) parts.push('место ' + str(data.place).trim());
        if (str(data.note).trim()) parts.push(str(data.note).trim());
        return parts.filter(Boolean).join('; ');
    }

    function eventFields(event, d) {
        var data = d || {}, r = (event && event.reqs) || {}, f = {};
        f['t' + (event && event.id)] = String(data.now);
        if (r.type && data.typeId) f['t' + r.type] = str(data.typeId);
        if (r.operator && data.userId) f['t' + r.operator] = str(data.userId);
        if (r.job && data.jobId) f['t' + r.job] = str(data.jobId);
        if (r.notes) f['t' + r.notes] = eventNote(data);
        return f;
    }

    // ── Метаданные ──

    function aliasOf(e) {
        if (!e) return '';
        if (e.field_attrs && e.field_attrs.alias) return String(e.field_attrs.alias);
        if (e.alias) return String(e.alias);
        if (e.attrs) { try { var a = JSON.parse(e.attrs); if (a && a.alias) return String(a.alias); } catch (x) { /* не JSON */ } }
        return '';
    }
    function findByName(list, names) {
        var arr = Array.isArray(list) ? list : [];
        var wanted = [].concat(names);
        for (var n = 0; n < wanted.length; n++) {
            var t = norm(wanted[n]);
            for (var i = 0; i < arr.length; i++) if (norm(aliasOf(arr[i])) === t) return arr[i];
            for (var j = 0; j < arr.length; j++) if (norm(arr[j] && arr[j].val) === t) return arr[j];
        }
        return null;
    }

    // → { tables: { gp, event, eventType: { id, reqs } }, missing: ['Таблица → Реквизит'], fatal }
    function resolvePackTables(metadata) {
        var meta = Array.isArray(metadata) ? metadata : [];
        var tables = {}, missing = [], fatal = false;
        Object.keys(TABLES).forEach(function(key) {
            var spec = TABLES[key];
            var t = findByName(meta, spec.name);
            if (!t) { missing.push(spec.name); fatal = true; return; }
            var reqs = {};
            Object.keys(spec.reqs).forEach(function(rk) {
                var e = findByName(t.reqs, spec.reqs[rk]);
                if (e) reqs[rk] = String(e.id);
                else {
                    missing.push(spec.name + ' → ' + [].concat(spec.reqs[rk])[0]);
                    if (spec.required.indexOf(rk) !== -1) fatal = true;
                }
            });
            tables[key] = { id: String(t.id), reqs: reqs };
        });
        return { tables: tables, missing: missing, fatal: fatal };
    }

    return {
        STATUS: STATUS,
        EVENT_TYPE_PACK: EVENT_TYPE_PACK,
        REPORT: REPORT,
        TABLES: TABLES,
        core: {
            norm: norm,
            num: num,
            itemFromReportRow: itemFromReportRow,
            sleeveDiameterMm: sleeveDiameterMm,
            rollParams: rollParams,
            describeRoll: describeRoll,
            pickSize: pickSize,
            manualSizes: manualSizes,
            splitSizes: splitSizes,
            packPlan: packPlan,
            describePlan: describePlan,
            validatePack: validatePack,
            nkValue: nkValue,
            validateNk: validateNk,
            nkOf: nkOf,
            nkStockByArt: nkStockByArt,
            nkNote: nkNote,
            buildQueue: buildQueue,
            groupByOrder: groupByOrder,
            padPlace: padPlace,
            gpFields: gpFields,
            eventNote: eventNote,
            eventFields: eventFields,
            resolvePackTables: resolvePackTables
        }
    };
});
