// Подбор ТИПОРАЗМЕРА упаковки ролика (ideav/crm#4665).
//
// Общий модуль для планирования производства и рабочего места упаковщика: по
// параметрам ролика находит запись справочника «Типоразмер» (670936), в которой
// написано, в какой короб и по сколько штук ролики укладываются.
//
// БОЕВАЯ СХЕМА (live ateh). Справочник «Типоразмер» читается отчётом `pack_sizes`
// (отчёт идёт под правами владельца, поэтому роли не нужен грант на сам справочник):
//   size_id/size_name — запись справочника;
//   w_from/w_to       — диапазон ШИРИНЫ ролика, мм (смежные бины: 0–20, 21–24, …, 166–220);
//   l_from/l_to       — диапазон ДЛИНЫ намотки, м (0–200, 201–320, …, 1101–1300);
//   foil              — строка для ФОЛЬГИ (у неё длины точные: 122, 183, 244, 305, 700);
//   add_sleeve        — «» | «с доп. втулкой» | «так же с доп. втулкой»;
//   rows_cnt/per_row/per_box/box — рядов, в ряду, в коробе и номер короба.
//
// Правило по доп. втулке (решение заказчика по #4665):
//   у ролика есть доп. втулка  → берём строку «с доп. втулкой», а если такой пары нет —
//                                «так же с доп. втулкой»;
//   доп. втулки нет            → берём строку без доп. втулки, а если её нет —
//                                «так же с доп. втулкой» (норма годится и без неё).
// Строку «с доп. втулкой» ролику БЕЗ доп. втулки не отдаём никогда.
//
// Шесть строк справочника привязаны к ТИПУ втулки («110х74/110 втулка 1"»,
// «втулка 0,5" 57 мм», «втулка 0,5" 110 мм») — у них диапазоны пустые, и они
// не подбираются автоматически (решение заказчика по #4665).
//
// Фольга определяется тем же правилом, что и в планировании: «Тип сырья» вида сырья
// содержит «фольг» (production-planning/00-core-data.js, `isFoil`).

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.AtexPackagingSize = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    'use strict';

    var REPORT = 'pack_sizes';
    var COL = {
        id: 'size_id', name: 'size_name', addSleeve: 'add_sleeve',
        rows: 'rows_cnt', perRow: 'per_row', perBox: 'per_box', box: 'box',
        wFrom: 'w_from', wTo: 'w_to', lFrom: 'l_from', lTo: 'l_to', foil: 'foil'
    };

    function str(value) { return value == null ? '' : String(value); }

    function toNumber(value) {
        if (typeof value === 'number') return isFinite(value) ? value : 0;
        var text = str(value).replace(/\s+/g, '').replace(',', '.');
        var n = parseFloat(text);
        return isFinite(n) ? n : 0;
    }

    // Значение поля строки отчёта: JSON_KV отдаёт либо строку, либо {val,id}.
    function kvVal(v) {
        if (v != null && typeof v === 'object') return v.val != null ? v.val : (v.id != null ? v.id : '');
        return v == null ? '' : v;
    }
    function has(value) { return str(kvVal(value)).trim() !== ''; }

    // Тип сырья говорит, что это фольга (то же правило, что в планировании).
    function isFoilType(text) {
        return /фольг/i.test(str(kvVal(text)));
    }

    // Строка отчёта `pack_sizes` → запись справочника.
    function sizeFromReportRow(row) {
        var r = row || {};
        var addSleeve = str(kvVal(r[COL.addSleeve])).trim();
        var size = {
            id: str(kvVal(r[COL.id])),
            name: str(kvVal(r[COL.name])).trim(),
            addSleeve: addSleeve,
            withAddSleeve: addSleeve !== '',
            // «так же с доп. втулкой» — одна норма и с доп. втулкой, и без неё.
            bothWays: /так\s*же/i.test(addSleeve),
            rows: toNumber(kvVal(r[COL.rows])),
            perRow: toNumber(kvVal(r[COL.perRow])),
            perBox: toNumber(kvVal(r[COL.perBox])),
            box: str(kvVal(r[COL.box])).trim(),
            wFrom: toNumber(kvVal(r[COL.wFrom])),
            wTo: toNumber(kvVal(r[COL.wTo])),
            lFrom: toNumber(kvVal(r[COL.lFrom])),
            lTo: toNumber(kvVal(r[COL.lTo])),
            foil: has(r[COL.foil])
        };
        // Диапазоны заданы, только если есть верхние границы: строки, привязанные к типу
        // втулки, оставлены пустыми и в подбор не идут.
        size.hasRange = has(r[COL.wTo]) && has(r[COL.lTo]);
        return size;
    }

    function sizesFromReport(rows) {
        return (Array.isArray(rows) ? rows : []).map(sizeFromReportRow);
    }

    function fits(size, width, length, foil) {
        if (!size.hasRange) return false;
        if (!!size.foil !== !!foil) return false;
        if (width < size.wFrom || width > size.wTo) return false;
        return length >= size.lFrom && length <= size.lTo;
    }

    // Самый узкий диапазон — самый специфичный: при пересечении строк выигрывает та,
    // что описывает более узкий кусок ширины, затем длины, затем меньший id (стабильность).
    function narrower(a, b) {
        var da = (a.wTo - a.wFrom) - (b.wTo - b.wFrom);
        if (da !== 0) return da;
        var dl = (a.lTo - a.lFrom) - (b.lTo - b.lFrom);
        if (dl !== 0) return dl;
        return toNumber(a.id) - toNumber(b.id);
    }

    // Типоразмер для ролика: {width, length, foil, addSleeve}. Ничего не подошло → null.
    function matchSize(sizes, params) {
        var p = params || {};
        var width = toNumber(p.width);
        var length = toNumber(p.length);
        var foil = !!p.foil;
        var wantAdd = str(kvVal(p.addSleeve)).trim() !== '';
        if (!(width > 0) || !(length > 0)) return null;

        var candidates = (sizes || []).filter(function(s) { return fits(s, width, length, foil); });
        if (!candidates.length) return null;

        var primary = candidates.filter(function(s) {
            return wantAdd ? s.withAddSleeve : !s.withAddSleeve;
        });
        // Пары под доп. втулку может не быть — тогда работает «так же с доп. втулкой».
        var pool = primary.length ? primary : candidates.filter(function(s) { return s.bothWays; });
        if (!pool.length) return null;
        return pool.slice().sort(narrower)[0];
    }

    // Подпись для подсказки: «№125 · 36 шт в коробе (3 × 12)».
    function describeSize(size) {
        if (!size) return '';
        var parts = [];
        if (size.box) parts.push(size.box);
        if (size.perBox > 0) {
            var layout = (size.rows > 0 && size.perRow > 0) ? ' (' + size.rows + ' × ' + size.perRow + ')' : '';
            parts.push(size.perBox + ' шт в коробе' + layout);
        }
        return parts.join(' · ');
    }

    // Сколько коробов уйдёт на количество рулонов (последний может быть неполным).
    function boxesFor(size, qty) {
        var per = size && size.perBox > 0 ? size.perBox : 0;
        var n = toNumber(qty);
        if (!per || !(n > 0)) return 0;
        return Math.ceil(n / per);
    }

    // «1 короб» / «3 короба» / «13 коробов» — счётная форма по правилам русского языка
    // (11–14 всегда «коробов»). Одна на всех потребителей: и упаковщик, и планирование.
    function boxesLabel(qty) {
        var n = Math.max(0, Math.floor(toNumber(qty)));
        var mod100 = n % 100, mod10 = n % 10;
        var word = 'коробов';
        if (mod10 === 1 && mod100 !== 11) word = 'короб';
        else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) word = 'короба';
        return n + ' ' + word;
    }

    return {
        REPORT: REPORT,
        COL: COL,
        core: {
            toNumber: toNumber,
            isFoilType: isFoilType,
            sizeFromReportRow: sizeFromReportRow,
            sizesFromReport: sizesFromReport,
            matchSize: matchSize,
            describeSize: describeSize,
            boxesFor: boxesFor,
            boxesLabel: boxesLabel
        }
    };
});
