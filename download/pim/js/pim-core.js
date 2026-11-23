/* PIM (демо-копия, ideav/backlogram#989): чистые функции расчёта полноты карточки по площадкам,
   перевода значений в справочники площадок, импорта файла поставщика, массового заполнения и файлов выгрузки.
   Работает в браузере (window.PimCore) и в Node (module.exports). Данных не читает и не пишет. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PimCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function num(x) { var n = parseFloat(String(x === undefined || x === null ? '' : x).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; }
    function isNum(x) { return /^-?\d+([.,]\d+)?$/.test(String(x === undefined || x === null ? '' : x).trim()); }
    function empty(v) { return v === undefined || v === null || String(v).trim() === ''; }
    function norm(s) { return String(s === undefined || s === null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase(); }
    function round1(x) { return Math.round(x * 10) / 10; }

    /* Контрольная цифра EAN-13. Excel превращает длинные коды в 4.6E+12 и съедает нули: такие строки отклоняются. */
    function eanValid(code) {
        var s = String(code === undefined || code === null ? '' : code).trim();
        if (!/^\d{13}$/.test(s)) return false;
        var sum = 0, i;
        for (i = 0; i < 12; i++) sum += (+s[i]) * (i % 2 ? 3 : 1);
        return (10 - sum % 10) % 10 === +s[12];
    }
    function eanProblem(code) {
        var s = String(code === undefined || code === null ? '' : code).trim();
        if (s === '') return 'пусто';
        if (/e\+?\d+/i.test(s)) return 'Excel превратил код в число (' + s + ')';
        if (!/^\d+$/.test(s)) return 'в коде есть не цифры';
        if (s.length !== 13) return 'длина ' + s.length + ' вместо 13';
        return eanValid(s) ? '' : 'не сходится контрольная цифра';
    }

    /* ---------- значения карточки ---------- */
    /* attr = {name, type, field}; field - ключ системного поля карточки (name, desc, brand, country, barcode, weight) */
    function getValue(p, attr) {
        if (!attr) return '';
        if (attr.field) {
            var m = { name: p.name, desc: p.desc, brand: p.brand, country: p.country, barcode: p.barcode, weight: p.weight };
            var v = m[attr.field];
            if (attr.field === 'weight') return num(v) > 0 ? String(v) : '';
            return empty(v) ? '' : String(v);
        }
        var x = p.values ? p.values[attr.name] : '';
        return empty(x) ? '' : String(x);
    }

    /* Перевод нашего значения в значение справочника площадки: совпадение без учёта регистра или строка соответствия.
       valueMap: { <ключ атрибута площадки>: { <наше значение в нижнем регистре>: <значение площадки> } } */
    function translate(ca, ours, valueMap) {
        if (!ca.values || !ca.values.length) return { ok: true, value: ours };
        var n = norm(ours), i;
        for (i = 0; i < ca.values.length; i++) if (norm(ca.values[i]) === n) return { ok: true, value: ca.values[i] };
        var m = valueMap && valueMap[ca.key] && valueMap[ca.key][n];
        if (m) return { ok: true, value: m, mapped: true };
        return { ok: false, value: ours };
    }

    /* Проверка одной карточки под одну площадку.
       ch = {name, minPhotos}; chanAttrs - строки справочника атрибутов площадки (все; фильтруются здесь);
       M = {attrs: {имя: {name,type,field}}, valueMap}.
       Результат: {pct, required, ok, items[], blockers[]}; item.state: ok | missing | invalid | long | unmapped. */
    function checkChannel(p, ch, chanAttrs, M) {
        var items = [], reqTotal = 0, reqOk = 0;
        function push(it) { items.push(it); if (it.required) { reqTotal++; if (it.state === 'ok') reqOk++; } }
        chanAttrs.filter(function (a) { return a.channel === ch.name && a.category === p.category; })
            .sort(function (a, b) { return (a.order || 0) - (b.order || 0); })
            .forEach(function (ca) {
                var base = { key: ca.key, label: ca.title, ours: ca.ours, required: !!ca.required };
                var attr = M.attrs[ca.ours];
                if (!ca.ours || !attr) { push(Object.assign(base, { state: 'unmapped', msg: ca.title + ': нет соответствия нашему атрибуту' })); return; }
                var raw = getValue(p, attr);
                if (raw === '') { push(Object.assign(base, { state: 'missing', msg: 'не заполнено: ' + ca.title })); return; }
                if (attr.field === 'barcode') {
                    var pr = eanProblem(raw);
                    if (pr) { push(Object.assign(base, { state: 'invalid', msg: ca.title + ': ' + pr })); return; }
                }
                if (ca.limit && raw.length > ca.limit) {
                    push(Object.assign(base, { state: 'long', msg: ca.title + ': ' + raw.length + ' симв. при лимите ' + ca.limit, len: raw.length, limit: ca.limit })); return;
                }
                if (attr.type === 'number' && !isNum(raw)) { push(Object.assign(base, { state: 'invalid', msg: ca.title + ': «' + raw + '» не число' })); return; }
                var t = translate(ca, raw, M.valueMap);
                if (!t.ok) { push(Object.assign(base, { state: 'invalid', msg: ca.title + ': значение «' + raw + '» не из справочника ' + ch.name + ' (нужно соответствие)' })); return; }
                push(Object.assign(base, { state: 'ok', value: t.value, raw: raw }));
            });
        if (num(ch.minPhotos) > 0) {
            var ph = num(p.photos), okp = ph >= num(ch.minPhotos);
            push({ key: '_photos', label: 'Фото', required: true, state: okp ? 'ok' : 'missing', msg: okp ? '' : 'фото: ' + ph + ' из ' + ch.minPhotos + ' (минимум площадки)' });
        }
        var pct = reqTotal ? Math.round(100 * reqOk / reqTotal) : 100;
        return { channel: ch.name, pct: pct, required: reqTotal, ok: reqOk, items: items, blockers: items.filter(function (i) { return i.required && i.state !== 'ok'; }) };
    }
    function checkAll(p, channels, chanAttrs, M) {
        var out = {};
        channels.forEach(function (ch) { out[ch.name] = checkChannel(p, ch, chanAttrs, M); });
        return out;
    }
    function level(pct) { return pct >= 100 ? 'ok' : pct >= 70 ? 'warn' : 'bad'; }

    /* ---------- название по шаблону ---------- */
    /* Шаблон: {Тип} {Бренд} {Материал}, {Цвет}. Токен - тип товара категории, бренд, артикул или имя нашего атрибута. */
    function buildTitle(tpl, p, typeName) {
        var s = String(tpl || '').replace(/\{([^}]+)\}/g, function (_, k) {
            k = k.trim();
            if (k === 'Тип') return typeName || '';
            if (k === 'Бренд') return p.brand || '';
            if (k === 'Артикул') return p.sku || '';
            var v = p.values && p.values[k]; if (empty(v) && /^[А-Яа-я]+$/.test(k)) { var keys = Object.keys(p.values || {}); for (var i = 0; i < keys.length; i++) if (keys[i].indexOf(k) === 0) { v = p.values[keys[i]]; break; } }
            return empty(v) ? '' : String(v).toLowerCase() === String(v) ? v : (/^[А-ЯЁ][а-яё]+$/.test(v) ? v.toLowerCase() : v);
        });
        return s.replace(/\s+,/g, ',').replace(/(,\s*)+/g, ', ').replace(/^[,\s]+|[,\s]+$/g, '').replace(/\s+/g, ' ');
    }

    /* ---------- переходы статусов ---------- */
    var STATUSES = ['Черновик', 'На проверке', 'Готово к выгрузке'];
    /* Что мешает перевести карточку в статус. Для «На проверке» хватает общих данных; «Готово к выгрузке» - 100% хотя бы по одной площадке. */
    function statusBlockers(p, target, results, commonOk) {
        var b = [];
        if (target === 'На проверке') {
            if (empty(p.name)) b.push('нет названия');
            if (empty(p.category)) b.push('не выбрана категория');
            if (empty(p.brand)) b.push('не указан бренд');
        } else if (target === 'Готово к выгрузке') {
            var any = Object.keys(results || {}).some(function (k) { return results[k].pct >= 100; });
            if (!any) b.push('нет ни одной площадки с полнотой 100%');
        }
        return b;
    }

    /* ---------- массовое заполнение ---------- */
    /* cards - карточки; opt = {attr: {name,type,field}, value, mode: 'empty'|'all', filter(p)} -> [{id, sku, from, to}] */
    function planMassFill(cards, opt) {
        var out = [];
        cards.forEach(function (p) {
            if (opt.filter && !opt.filter(p)) return;
            var cur = getValue(p, opt.attr);
            if (opt.mode !== 'all' && cur !== '') return;
            if (cur === String(opt.value)) return;
            out.push({ id: p.id, sku: p.sku, from: cur, to: String(opt.value) });
        });
        return out;
    }

    /* ---------- импорт файла поставщика ---------- */
    function parseDelimited(text) {
        var t = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
        var first = t.split('\n')[0] || '';
        var cand = ['\t', ';', ','], d = cand[0], best = -1;
        cand.forEach(function (c) { var n = first.split(c).length - 1; if (n > best) { best = n; d = c; } });
        var rows = [], row = [], cur = '', q = false, i, ch;
        for (i = 0; i < t.length; i++) {
            ch = t[i];
            if (q) { if (ch === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
            else if (ch === '"' && cur === '') q = true;
            else if (ch === d) { row.push(cur); cur = ''; }
            else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
            else cur += ch;
        }
        if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
        rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
        return { delimiter: d === '\t' ? 'tab' : d, rows: rows };
    }
    var SYN = {
        sku: ['артикул', 'арт', 'арт.', 'артикул поставщика', 'sku', 'код товара', 'код'],
        name: ['название', 'наименование', 'название товара', 'наименование товара', 'товар'],
        brand: ['бренд', 'производитель', 'торговая марка', 'марка'],
        country: ['страна', 'страна производства', 'страна происхождения', 'страна-изготовитель'],
        barcode: ['штрихкод', 'штрих-код', 'ean', 'ean13', 'gtin', 'баркод'],
        desc: ['описание', 'аннотация', 'краткое описание'],
        weightKg: ['вес, кг', 'вес кг', 'вес нетто, кг'],
        weight: ['вес', 'вес, г', 'вес г', 'вес брутто', 'масса'],
        photos: ['фото', 'кол-во фото', 'фото, шт'],
        price: ['цена', 'цена, ₽', 'цена руб', 'розничная цена']
    };
    /* Подбор соответствия колонок файла нашим полям и атрибутам категории. attrNames - имена атрибутов выбранной категории. */
    function mapColumns(headers, attrNames) {
        var map = {}, used = {};
        headers.forEach(function (h, idx) {
            var n = norm(h).replace(/^кол-во/, 'количество'), hit = '';
            Object.keys(SYN).forEach(function (k) { if (!hit && SYN[k].indexOf(n) >= 0 && !used[k]) hit = 'f:' + k; });
            if (!hit) (attrNames || []).forEach(function (a) {
                if (hit) return;
                var an = norm(a).replace(/,.*$/, '').trim();
                if (n === norm(a) || n === an || (an.length > 3 && n.indexOf(an) === 0) || (n.length >= 4 && norm(a).indexOf(n) === 0)) hit = 'a:' + a;
            });
            if (hit) { used[hit.slice(2)] = 1; map[idx] = hit; }
        });
        return map;
    }
    /* Строка файла -> {sku, fields, values, issues}. issues: [{col, level, msg}] */
    function importRow(row, map, ctx) {
        var rec = { fields: {}, values: {}, issues: [] }, attrsByName = ctx.attrs || {};
        Object.keys(map).forEach(function (idx) {
            var tgt = map[idx], raw = row[idx] === undefined ? '' : String(row[idx]).trim(), kind = tgt.slice(0, 1), key = tgt.slice(2);
            if (raw === '') return;
            if (kind === 'f') {
                if (key === 'desc') raw = raw.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
                if (key === 'weightKg') { key = 'weight'; raw = String(Math.round(num(raw) * 1000)); }
                if (key === 'weight' || key === 'price') raw = String(num(raw));
                if (key === 'barcode') { var pr = eanProblem(raw); if (pr) { rec.issues.push({ col: 'Штрихкод', level: 'bad', msg: 'штрихкод: ' + pr }); if (/Excel/.test(pr)) return; } }
                rec.fields[key] = raw;
            } else {
                var a = attrsByName[key];
                if (a && a.type === 'list' && a.values && a.values.length) {
                    var hit = a.values.filter(function (v) { return norm(v) === norm(raw); })[0];
                    if (hit) raw = hit; else rec.issues.push({ col: key, level: 'warn', msg: key + ': «' + raw + '» нет в нашем справочнике' });
                }
                if (a && a.type === 'bool') { var b = norm(raw); raw = /^(да|1|true|yes|y|\+)$/.test(b) ? 'Да' : /^(нет|0|false|no|n|-)$/.test(b) ? 'Нет' : raw; }
                rec.values[key] = raw;
            }
        });
        rec.sku = rec.fields.sku || '';
        if (!rec.sku) rec.issues.push({ col: 'Артикул', level: 'bad', msg: 'нет артикула' });
        if (!rec.fields.name) rec.issues.push({ col: 'Название', level: 'warn', msg: 'нет названия' });
        if (!rec.fields.country) rec.issues.push({ col: 'Страна', level: 'warn', msg: 'нет страны производства' });
        return rec;
    }
    /* Статистика по колонкам до записи: сколько пустых, сколько невалидных. */
    function columnStats(recs) {
        var st = {};
        recs.forEach(function (r) { r.issues.forEach(function (i) { var s = st[i.col] || (st[i.col] = { bad: 0, warn: 0 }); s[i.level === 'bad' ? 'bad' : 'warn']++; }); });
        return st;
    }

    /* ---------- выгрузка в шаблон площадки ---------- */
    /* Колонки: артикул, категория площадки, затем по порядку все названия атрибутов площадки (объединение по категориям). */
    function exportColumns(ch, chanAttrs) {
        var cols = [], seen = {};
        chanAttrs.filter(function (a) { return a.channel === ch.name; }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); })
            .forEach(function (a) { if (!seen[a.title]) { seen[a.title] = 1; cols.push(a.title); } });
        if (num(ch.minPhotos) > 0) cols.push('Количество фото');
        return ['Артикул', 'Категория'].concat(cols);
    }
    /* cards - выбранные карточки. Результат: {columns, ok:[{p,cells}], bad:[{p,reasons[]}]}. Строка с блокером не попадает в файл. */
    function buildExport(cards, ch, chanAttrs, M) {
        var cols = exportColumns(ch, chanAttrs), ok = [], bad = [];
        cards.forEach(function (p) {
            var r = checkChannel(p, ch, chanAttrs, M);
            if (r.blockers.length) { bad.push({ p: p, reasons: r.blockers.map(function (b) { return b.msg; }), pct: r.pct }); return; }
            var cell = { 'Артикул': p.sku, 'Категория': r.items.length && chanAttrs.filter(function (a) { return a.channel === ch.name && a.category === p.category; })[0].catTitle || p.category };
            r.items.forEach(function (it) { if (it.key === '_photos') return; cell[it.label] = it.value !== undefined ? it.value : ''; });
            if (num(ch.minPhotos) > 0) cell['Количество фото'] = String(num(p.photos));
            ok.push({ p: p, cells: cols.map(function (c) { return cell[c] === undefined ? '' : cell[c]; }) });
        });
        return { columns: cols, ok: ok, bad: bad };
    }
    function csvEscape(v, sep) { var s = String(v === undefined || v === null ? '' : v); return (s.indexOf(sep) >= 0 || /["\n\r]/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s; }
    function toCsv(columns, rows, sep) { sep = sep || ';'; return [columns].concat(rows).map(function (r) { return r.map(function (v) { return csvEscape(v, sep); }).join(sep); }).join('\r\n') + '\r\n'; }
    function xmlEsc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    /* Excel XML (SpreadsheetML 2003): открывается в Excel, значения как текст, чтобы не съедать нули и не портить штрихкоды. */
    function toSpreadsheetXml(columns, rows, sheet) {
        var cell = function (v) { return '<Cell><Data ss:Type="String">' + xmlEsc(v) + '</Data></Cell>'; };
        var row = function (r) { return '<Row>' + r.map(cell).join('') + '</Row>'; };
        return '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>' +
            '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
            '<Worksheet ss:Name="' + xmlEsc((sheet || 'Товары').slice(0, 31)) + '"><Table>' + [columns].concat(rows).map(row).join('') + '</Table></Worksheet></Workbook>';
    }

    /* ---------- сводка для дашборда ---------- */
    /* cards: [{p, res}] res = checkAll. Возвращает статусы, среднюю полноту, «готово к площадке» и частоты причин. */
    function summarize(cards, channels) {
        var out = { total: cards.length, byStatus: {}, channels: {}, reasons: {}, almost: [] };
        STATUSES.forEach(function (s) { out.byStatus[s] = 0; });
        channels.forEach(function (c) { out.channels[c.name] = { sum: 0, full: 0, avg: 0, share: 0 }; });
        cards.forEach(function (c) {
            out.byStatus[c.p.status] = (out.byStatus[c.p.status] || 0) + 1;
            channels.forEach(function (ch) {
                var r = c.res[ch.name], o = out.channels[ch.name]; o.sum += r.pct; if (r.pct >= 100) o.full++;
                r.blockers.forEach(function (b) { var key = b.key === '_photos' ? 'Фото' : b.label; var e = out.reasons[key] || (out.reasons[key] = { n: 0, byCh: {} }); e.n++; e.byCh[ch.name] = (e.byCh[ch.name] || 0) + 1; });
            });
        });
        channels.forEach(function (ch) { var o = out.channels[ch.name]; o.avg = cards.length ? Math.round(o.sum / cards.length) : 0; o.share = cards.length ? Math.round(100 * o.full / cards.length) : 0; });
        return out;
    }
    function topReasons(sum, n) {
        return Object.keys(sum.reasons).map(function (k) { return { label: k, n: sum.reasons[k].n, byCh: sum.reasons[k].byCh }; }).sort(function (a, b) { return b.n - a.n || (a.label < b.label ? -1 : 1); }).slice(0, n || 6);
    }
    /* Почти готовые: хотя бы на одной площадке не хватает 1-2 пунктов. */
    function almostReady(cards, channelName, maxMissing) {
        return cards.filter(function (c) { var r = c.res[channelName]; return r.blockers.length > 0 && r.blockers.length <= (maxMissing || 2) && c.p.status !== 'Готово к выгрузке'; })
            .sort(function (a, b) { return a.res[channelName].blockers.length - b.res[channelName].blockers.length; });
    }

    return { num: num, isNum: isNum, empty: empty, norm: norm, round1: round1, eanValid: eanValid, eanProblem: eanProblem, getValue: getValue, translate: translate, checkChannel: checkChannel,
        checkAll: checkAll, level: level, buildTitle: buildTitle, STATUSES: STATUSES, statusBlockers: statusBlockers, planMassFill: planMassFill, parseDelimited: parseDelimited,
        mapColumns: mapColumns, importRow: importRow, columnStats: columnStats, exportColumns: exportColumns, buildExport: buildExport, toCsv: toCsv, toSpreadsheetXml: toSpreadsheetXml,
        summarize: summarize, topReasons: topReasons, almostReady: almostReady };
});
