/*
 * Обфускация (обезличивание) данных при экспорте конфигурации — issue #4253.
 * Подключается в templates/migration.html и переиспользуется юнит-тестом
 * experiments/test-issue-4253-obfuscate.js (общий источник правды, без дублирования логики).
 *
 * Правила (из issue #4253), применяются только когда включена галка «обфускация»:
 *   1. Все неслужебные таблицы обезличиваются — суммы, названия и тексты заменяются.
 *   2. Из каждой таблицы выгружается не больше 200 записей.
 *   3. Суммы — умножаются на случайное число от 0.5 до 15 и обрезаются до 3 знаков
 *      слева от запятой (значение mod 1000: остаются 3 младших целых разряда, дробная
 *      часть — какая получилась, её может и не быть).
 *   4. Тексты забиваются «x» — по 4 через каждые 2 знака, с добавлением ID записи в конец,
 *      например: «Социалистическая» (id 1057) -> «Соxxxxисxxxxскxx1057».
 *   5. Категории/статусы/типы (справочники) остаются как есть. Справочник определяется
 *      структурно (на таблицу ссылается ref-колонка) либо по названию (DICT_NAME_HINTS).
 *      Если в справочнике больше 30 значений — он обфусцируется как текст.
 *
 * Базовые типы колонок — коды из $GLOBALS["basics"] (index.php):
 *   2 HTML, 3 SHORT, 8 CHARS, 12 MEMO  → текст
 *   13 NUMBER, 14 SIGNED, 15 CALCULATABLE → суммы
 *   9 DATE, 4 DATETIME, 11 BOOLEAN, 10 FILE, 17 PATH, ... → не трогаем
 */
(function(root){
    'use strict';

    var OBF_MAX_RECORDS = 200; // rule 2: потолок записей на таблицу
    var DICT_MAX_VALUES = 30;  // rule 5: справочник свыше 30 значений обфусцируется как текст

    var SUM_TYPES = { 13: 1, 14: 1, 15: 1 };        // NUMBER, SIGNED, CALCULATABLE
    var TEXT_TYPES = { 2: 1, 3: 1, 8: 1, 12: 1 };   // HTML, SHORT, CHARS, MEMO

    // «Список названий справочников» (rule 5): стеммы-подсказки для таблиц-справочников,
    // которые не привязаны структурно, но по названию являются категориями/статусами/типами.
    var DICT_NAME_HINTS = /(статус|категори|тип|вид|роль|состоян|приоритет|единиц|валют|способ|стади|этап|класс|группа|форма|отдел|должност|национальн|гражданств|разряд|марк)/i;

    function isSumType(tc){ return !!SUM_TYPES[parseInt(tc, 10)]; }
    function isTextType(tc){ return !!TEXT_TYPES[parseInt(tc, 10)]; }

    // rule 4: оставить 2 знака, забить 4 знаками «x», повторять; в конец — ID записи.
    // Длина маскируемого блока сохраняется (последний блок может быть короче 4).
    function maskText(str, id){
        var s = String(str == null ? '' : str);
        var out = '';
        var i = 0, n = s.length;
        while(i < n){
            out += s.slice(i, i + 2); // keep up to 2
            i += 2;
            if(i < n){
                var m = Math.min(4, n - i); // mask up to 4, но не длиннее остатка
                out += new Array(m + 1).join('x');
                i += 4;
            }
        }
        return out + (id == null ? '' : String(id));
    }

    // rule 3: sum × random(0.5..15), затем оставляем 3 знака слева от запятой —
    // значение mod 1000 (3 младших целых разряда). Дробная часть — какая вышла,
    // обрезается до 2 знаков и может отсутствовать.
    // rng — инъекция для детерминированных тестов (по умолчанию Math.random).
    function obfuscateSum(val, rng){
        var s = String(val == null ? '' : val).replace(/\s/g, '').replace(',', '.');
        var n = parseFloat(s);
        if(!isFinite(n) || n === 0){ return val; } // не число / ноль — как есть
        var r = (typeof rng === 'function') ? rng() : Math.random();
        var factor = 0.5 + r * 14.5;         // [0.5, 15)
        var res = (n * factor) % 1000;        // 3 знака до запятой (|res| < 1000)
        res = Math.trunc(res * 100) / 100;    // дробная часть — обрезаем до 2 знаков (без переноса), может отсутствовать
        return String(res);
    }

    // Обфускация одного значения по типу колонки.
    // isRef=true → ссылка на справочник (категория/статус/тип) → оставляем как есть (rule 5).
    function obfuscateValue(val, typeCode, isRef, id, rng){
        if(val == null || val === ''){ return val; }
        if(isRef){ return val; }                       // rule 5
        if(isSumType(typeCode)){ return obfuscateSum(val, rng); } // rule 3
        if(isTextType(typeCode)){ return maskText(val, id); }     // rule 4
        return val; // даты, булевы, файлы, пути — вне области обезличивания
    }

    // Собрать множество id таблиц, на которые ссылаются (справочники), из metadata.
    // Два сигнала: колонка-ссылка (r.ref_id -> id справочника) и серверный флаг
    // t.referenced (само его наличие означает, что таблица t — справочник; значение
    // флага — id реквизита-ссылки, поэтому в множество идёт собственный id таблицы).
    function buildRefTargets(meta){
        var set = {};
        (Array.isArray(meta) ? meta : []).forEach(function(t){
            if(!t){ return; }
            if(t.referenced){ set[String(t.id)] = true; }
            (t.reqs || []).forEach(function(r){ if(r && r.ref_id){ set[String(r.ref_id)] = true; } });
        });
        return set;
    }

    function looksLikeDictName(name){ return DICT_NAME_HINTS.test(String(name == null ? '' : name)); }

    // Таблица-справочник и значений ≤ 30 → 'keep' (как есть); иначе → 'text' (обфускация).
    function tableMode(tableId, tableName, recordCount, refTargets){
        var isDict = !!(refTargets && refTargets[String(tableId)]) || looksLikeDictName(tableName);
        if(isDict && recordCount <= DICT_MAX_VALUES){ return 'keep'; }
        return 'text';
    }

    // Обфускация одной записи. values[0] — главное поле (тип = базовый тип таблицы),
    // values[i+1] — колонка columns[i].
    function obfuscateRecord(rec, columns, tableBaseCode, rng){
        var values = (rec.values || []).slice();
        var id = rec.old_id;
        if(values.length){ values[0] = obfuscateValue(values[0], tableBaseCode, false, id, rng); }
        (columns || []).forEach(function(c, i){
            values[i + 1] = obfuscateValue(values[i + 1], c.type_code, !!c.ref_target, id, rng);
        });
        return { old_id: rec.old_id, up: rec.up, values: values };
    }

    // Точка входа: обрезает до 200 записей и, при необходимости, обфусцирует.
    // opts: { records, columns, tableId, tableName, tableBaseCode, refTargets, rng }
    // Возвращает { records, mode }.
    function processTable(opts){
        opts = opts || {};
        var all = opts.records || [];
        var mode = tableMode(opts.tableId, opts.tableName, all.length, opts.refTargets);
        var records = all.slice(0, OBF_MAX_RECORDS); // rule 2
        if(mode === 'text'){
            records = records.map(function(r){
                return obfuscateRecord(r, opts.columns, opts.tableBaseCode, opts.rng);
            });
        }
        return { records: records, mode: mode };
    }

    var api = {
        OBF_MAX_RECORDS: OBF_MAX_RECORDS,
        DICT_MAX_VALUES: DICT_MAX_VALUES,
        SUM_TYPES: SUM_TYPES,
        TEXT_TYPES: TEXT_TYPES,
        DICT_NAME_HINTS: DICT_NAME_HINTS,
        isSumType: isSumType,
        isTextType: isTextType,
        maskText: maskText,
        obfuscateSum: obfuscateSum,
        obfuscateValue: obfuscateValue,
        buildRefTargets: buildRefTargets,
        looksLikeDictName: looksLikeDictName,
        tableMode: tableMode,
        obfuscateRecord: obfuscateRecord,
        processTable: processTable
    };

    if(typeof module !== 'undefined' && module.exports){ module.exports = api; }
    if(typeof root !== 'undefined' && root){ root.MigrationObfuscate = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
