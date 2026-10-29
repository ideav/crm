// Производство этикетки (Фаза 2 atex): модель данных (ideav/crm#5301, шаг 1 состава решения).
//
// Общий модуль для рабочих мест обоих производств. Отвечает на три вопроса:
//   1. какие таблицы и реквизиты у производства «этикетка» и какие у них id в текущей
//      базе — имена резолвятся из `GET /{db}/metadata`, id в коде не хранятся
//      (docs/atex_phase2_solution_composition.md §7);
//   2. к какому производству относится позиция заказа — реквизит «Вид продукции»
//      «Заказанного количества» (1076): `рулон` или `этикетка`, пусто = `рулон`
//      (позиции, заведённые до Фазы 2). Позиция `этикетка` не попадает в планирование
//      резок Фазы 1, позиция `рулон` — в планирование высечки (§1.3 состава);
//   3. сколько пробега у ножа: сумма движений «Движения пробега» после последней
//      «заточки»; «начальный остаток» у ножа один, повторный импорт его перезаписывает
//      (docs/atex_phase2_solution_composition.md §1.1);
//   4. согласован ли раппорт: раппорт — свойство вала (зубья × 3.175 мм), у ножа своего
//      раппорта нет, раппорт ножа из базы 1С сверяется с раппортом его вала;
//   5. что написано в «Типе ножей» выгрузки 1С: «85 х 38 (80)» — этикетка 85×38 мм,
//      втулка 80 мм; «18 х 18 (80)15 ручъев» — ещё и число ручьёв; «D х 40 (76)» —
//      круглая этикетка диаметром 40 мм.
//
// Структура таблиц описана в docs/atex_phase2_schema.json (накат —
// docs/scripts/apply_label_schema_5301.py); конфигурация ниже называет те же имена,
// это сверяет experiments/atex-p2-step1-model.test.js.

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.AtexLabelProduction = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    'use strict';

    var PRODUCT_KIND = { ROLL: 'рулон', LABEL: 'этикетка' };

    // Колонка вида продукции в отчётах позиций (`positions_list`, `label_positions`).
    var PRODUCT_KIND_COLUMNS = ['product_kind', 'position_product_kind'];

    // Набор таблиц производства: ключ → { name, reqs: { ключ: имя колонки } }.
    // Имя колонки — псевдоним реквизита или имя его типа (для ссылки без псевдонима —
    // имя таблицы-цели), как их отдаёт /metadata.
    var PRODUCTION_CONFIGS = {};
    PRODUCTION_CONFIGS[PRODUCT_KIND.LABEL] = {
        tables: {
            order: { name: 'Заказ', reqs: {} },
            position: { name: 'Заказанное количество', reqs: {
                productKind: 'Вид продукции',
                material: 'Сырьё этикетки',
                labelWidth: 'Ширина этикетки, мм',
                labelLength: 'Длина этикетки, мм',
                labelsPerRoll: 'Этикеток в рулоне',
                knifeType: 'Тип ножей',
                sleeveWidth: 'Ширина втулки, мм',
                supply: 'Обеспечение этикетки'
            } },
            sleeveTask: { name: 'Задача на втулки', reqs: {} },
            productKind: { name: 'Вид продукции', reqs: {} },
            dieState: { name: 'Состояние ножа', reqs: { selectable: 'Нож подбирается' } },
            dieEventType: { name: 'Тип события высечки', reqs: {} },
            runKind: { name: 'Вид движения пробега', reqs: {} },
            materialBase: { name: 'Основа сырья', reqs: {} },
            material: { name: 'Сырьё этикетки', reqs: {
                base: 'Основа',
                glue: 'Клей',
                linerThickness: 'Толщина подложки, мкм',
                jumboWidth: 'Ширина джамбо, мм',
                jumboLength: 'Длина джамбо, м'
            } },
            jumboBatch: { name: 'Партия джамбо', reqs: {
                material: 'Сырьё этикетки',
                arrived: 'Дата прихода',
                width: 'Ширина факт, мм',
                length: 'Длина факт, м',
                rest: 'Остаток, м',
                warehouse: 'Склад'
            } },
            cylinder: { name: 'Вал', reqs: {
                repeat: 'Раппорт, мм'
            } },
            machine: { name: 'Станок высечки', reqs: {
                status: 'Статус станка высечки',
                // Совместимость вала со станком хранится только здесь: станков мало, валов
                // десятки и сотни. Пустой список — на станок встаёт любой вал.
                cylinders: 'Допустимые валы',
                stopMaterials: 'Стоп-лист сырья',
                packPlace: 'Упаковочное место'
            } },
            die: { name: 'Нож', reqs: {
                delivered: 'Дата поставки',
                labelWidth: 'Ширина этикетки, мм',
                labelLength: 'Длина этикетки, мм',
                streams: 'Ручьёв',
                labelsPerRepeat: 'Этикеток на раппорте',
                labelGap: 'М/э расстояние, мм',
                streamGap: 'Между ручьями, мм',
                edge: 'Ширина кромки, мм',
                cylinder: 'Вал',
                base: 'Основа',
                minFormat: 'Минимальный формат, мм',
                optFormat: 'Оптимальный формат, мм',
                usedFormat: 'Исп. формат, мм',
                sleeveWidth: 'Ширина втулки, мм',
                height: 'Высота ножа, мкм',
                angle: 'Угол заточки',
                state: 'Состояние ножа',
                runs: 'Движение пробега'
            } },
            dieRun: { name: 'Движение пробега', reqs: {
                job: 'Задание высечки',
                meters: 'Метры пробега',
                kind: 'Вид движения пробега',
                operator: 'Оператор'
            } },
            jumboJob: { name: 'Задание первичной резки', reqs: {
                jumboBatch: 'Партия джамбо',
                duration: 'Длительность, минут',
                status: 'Статус задания этикетки',
                edgeWaste: 'Отход кромки, мм',
                strips: 'Полоса раскроя'
            } },
            jumboStrip: { name: 'Полоса раскроя', reqs: {
                count: 'Количество полос',
                purpose: 'Назначение полосы'
            } },
            masterRoll: { name: 'Мастер-рулон', reqs: {
                format: 'Формат, мм',
                length: 'Длина, м',
                material: 'Сырьё этикетки',
                jumboJob: 'Задание первичной резки',
                rest: 'Остаток, м',
                status: 'Статус мастер-рулона',
                warehouse: 'Склад'
            } },
            dieJob: { name: 'Задание высечки', reqs: {
                position: 'Позиция заказа',
                die: 'Нож',
                cylinder: 'Вал',
                machine: 'Станок высечки',
                masterRoll: 'Мастер-рулон',
                pullsPlan: 'Съёмов план',
                pullsFact: 'Съёмов факт',
                footage: 'Метраж, м',
                duration: 'Длительность, минут',
                setup: 'Наладка, мин',
                status: 'Статус задания этикетки',
                events: 'Событие смены высечки'
            } },
            dieEvent: { name: 'Событие смены высечки', reqs: {
                type: 'Тип события высечки',
                operator: 'Оператор',
                photo: 'Фото брака',
                notes: 'Примечание'
            } },
            labelSupply: { name: 'Обеспечение этикетки', reqs: {
                job: 'Задание высечки',
                finishedBatch: 'Партия ГП этикетки'
            } },
            finishedBatch: { name: 'Партия ГП этикетки', reqs: {
                job: 'Задание высечки',
                qty: 'Количество',
                size: 'Типоразмер',
                packStatus: 'Статус упаковки',
                warehouse: 'Склад'
            } }
        }
    };

    function norm(s) {
        return String(s == null ? '' : s).trim().toLowerCase();
    }

    // Псевдоним реквизита/таблицы: `alias`, `field_attrs.alias` или `attrs` (JSON).
    function aliasOf(entry) {
        if (!entry) return '';
        if (entry.alias != null && entry.alias !== '') return String(entry.alias);
        if (entry.field_attrs && entry.field_attrs.alias != null) return String(entry.field_attrs.alias);
        if (entry.attrs) {
            try {
                var attrs = typeof entry.attrs === 'string' ? JSON.parse(entry.attrs) : entry.attrs;
                if (attrs && attrs.alias != null) return String(attrs.alias);
            } catch (e) { /* attrs — не JSON: псевдонима нет */ }
        }
        return '';
    }

    // Сущность из списка по имени: сначала по псевдониму, затем по имени типа (`val`).
    // Псевдоним первым — у ссылки `val` равен имени таблицы-цели, и две ссылки с разными
    // псевдонимами различаются только им.
    function findByName(list, name) {
        var target = norm(name);
        if (target === '') return null;
        var arr = Array.isArray(list) ? list : [];
        for (var i = 0; i < arr.length; i++) if (norm(aliasOf(arr[i])) === target) return arr[i];
        for (var j = 0; j < arr.length; j++) if (norm(arr[j] && arr[j].val) === target) return arr[j];
        return null;
    }

    // Таблицы и реквизиты производства `kind` по метаданным базы.
    // → { ok, tables: { ключ: { id, name, reqs: { ключ: id } } }, missing: [имена] }.
    // Не найденная таблица в `tables` не попадает; не найденный реквизит — в `reqs`;
    // и то и другое называется в `missing` («Таблица» / «Таблица → колонка»).
    function resolveProductionTables(metadata, kind) {
        var cfg = PRODUCTION_CONFIGS[kind];
        if (!cfg) return { ok: false, tables: {}, missing: ['конфигурация производства «' + kind + '»'] };
        var meta = Array.isArray(metadata) ? metadata : (metadata == null ? [] : [metadata]);
        var tables = {};
        var missing = [];
        Object.keys(cfg.tables).forEach(function(key) {
            var spec = cfg.tables[key];
            var table = findByName(meta, spec.name);
            if (!table) { missing.push(spec.name); return; }
            var reqs = {};
            Object.keys(spec.reqs).forEach(function(rk) {
                var req = findByName(table.reqs, spec.reqs[rk]);
                if (req) reqs[rk] = String(req.id);
                else missing.push(spec.name + ' → ' + spec.reqs[rk]);
            });
            tables[key] = { id: String(table.id), name: spec.name, reqs: reqs };
        });
        return { ok: missing.length === 0, tables: tables, missing: missing };
    }

    // Вид продукции по значению реквизита: «этикетка» / «рулон»; пусто — «рулон»
    // (позиция заведена до Фазы 2); иное — «» (неизвестный вид, не угадываем).
    // Значение ссылки приходит подписью или парой «id:подпись».
    function productKindOf(raw) {
        var s = norm(String(raw == null ? '' : raw).replace(/^\s*\d+:/, ''));
        if (s === '' || s === PRODUCT_KIND.ROLL || s === 'рулоны') return PRODUCT_KIND.ROLL;
        if (s === PRODUCT_KIND.LABEL) return PRODUCT_KIND.LABEL;
        return '';
    }

    function rowProductKind(row) {
        for (var i = 0; i < PRODUCT_KIND_COLUMNS.length; i++) {
            var v = row ? row[PRODUCT_KIND_COLUMNS[i]] : null;
            if (v != null && String(v).trim() !== '') return productKindOf(v);
        }
        return PRODUCT_KIND.ROLL;
    }

    // Строки отчёта позиций → только позиции производства `kind`.
    // → { rows, unknown } — `unknown` — позиции с видом, которого нет в PRODUCT_KIND:
    // их не получает ни один планировщик, вызывающий называет их вслух.
    function filterPositionRows(rows, kind) {
        var out = { rows: [], unknown: [] };
        (rows || []).forEach(function(row) {
            var k = rowProductKind(row);
            if (k === '') out.unknown.push(row);
            else if (k === kind) out.rows.push(row);
        });
        return out;
    }

    // Виды «Движения пробега» — записи справочника «Вид движения пробега».
    var RUN_KIND = { CUT: 'вырубка', SHARPEN: 'заточка', INITIAL: 'начальный остаток' };

    // Вид движения по значению ссылки (подпись или «id:подпись») → RUN_KIND или «».
    function runKindOf(raw) {
        var s = norm(String(raw == null ? '' : raw).replace(/^\s*\d+:/, '')).replace(/\s+/g, ' ');
        for (var k in RUN_KIND) if (RUN_KIND[k] === s) return s;
        return '';
    }

    // Пробег ножа по его движениям [{ id, date, kind, meters }]: сумма «вырубки» и
    // «начального остатка» после последней «заточки» (заточка обнуляет счёт, история
    // остаётся). → { meters, errors } — движение неизвестного вида в сумму не идёт и
    // называется в errors.
    function dieMileage(runs) {
        var list = (runs || []).slice().sort(function(a, b) { return Number(a.date) - Number(b.date); });
        var errors = [];
        var start = 0;
        list.forEach(function(r, i) {
            var k = runKindOf(r.kind);
            if (k === '') errors.push('движение ' + (r.id != null ? r.id : '?') + ': неизвестный вид «' + r.kind + '»');
            else if (k === RUN_KIND.SHARPEN) start = i + 1;
        });
        var meters = 0;
        for (var i = start; i < list.length; i++) {
            var k = runKindOf(list[i].kind);
            if (k === RUN_KIND.CUT || k === RUN_KIND.INITIAL) meters += Number(list[i].meters) || 0;
        }
        return { meters: meters, errors: errors };
    }

    // Что сделать с «начальным остатком» ножа при импорте пробега из 1С:
    //   { op: 'new', meters }        — записи нет, создать;
    //   { op: 'none' }               — запись есть с тем же пробегом;
    //   { op: 'set', id, meters }    — перезаписать существующую запись;
    //   { op: 'error', ids, error }  — записей несколько, какую править — не угадываем.
    function initialRunPlan(runs, meters) {
        var initial = (runs || []).filter(function(r) { return runKindOf(r.kind) === RUN_KIND.INITIAL; });
        var m = Number(meters) || 0;
        if (initial.length === 0) return { op: 'new', meters: m };
        if (initial.length > 1) {
            var ids = initial.map(function(r) { return String(r.id); });
            return { op: 'error', ids: ids, error: 'у ножа несколько записей «начальный остаток»: ' + ids.join(', ') };
        }
        if ((Number(initial[0].meters) || 0) === m) return { op: 'none' };
        return { op: 'set', id: String(initial[0].id), meters: m };
    }

    // Раппорт вала: шаг зуба 1/8″ = 3.175 мм (вал 96 → 304.8 мм).
    var TOOTH_PITCH_MM = 3.175;
    var REPEAT_TOLERANCE_MM = 0.06;   // раппорт в базе 1С округлён до десятых мм

    function toNumLoose(v) {
        return Number(String(v == null ? '' : v).replace(',', '.'));
    }

    function cylinderRepeatMm(teeth) {
        return Math.round(toNumLoose(teeth) * TOOTH_PITCH_MM * 1000) / 1000;
    }

    // Пара «зубья ↔ раппорт» вала. → { ok } | { ok: false, error }.
    function checkCylinderRepeat(teeth, repeat) {
        var t = toNumLoose(teeth);
        if (String(teeth == null ? '' : teeth).trim() === '' || !(t > 0) || Math.round(t) !== t) {
            return { ok: false, error: 'вал «' + teeth + '»: число зубьев должно быть целым и больше нуля' };
        }
        var want = cylinderRepeatMm(t);
        if (!(Math.abs(toNumLoose(repeat) - want) <= REPEAT_TOLERANCE_MM)) {
            return { ok: false, error: 'вал ' + t + ': раппорт ' + repeat + ' мм не сходится с ' + t + ' × 3.175 = ' + want + ' мм' };
        }
        return { ok: true };
    }

    // Раппорт ножа из базы 1С против раппорта его вала. Пустой раппорт ножа — не ошибка:
    // раппорт берётся из вала. → { ok } | { ok: false, error }.
    function checkDieRepeat(dieRepeat, cylinderTeeth) {
        if (dieRepeat == null || String(dieRepeat).trim() === '') return { ok: true };
        var want = cylinderRepeatMm(cylinderTeeth);
        if (!(Math.abs(toNumLoose(dieRepeat) - want) <= REPEAT_TOLERANCE_MM)) {
            return { ok: false, error: 'раппорт ножа ' + dieRepeat + ' мм не сходится с раппортом вала ' + cylinderTeeth + ' (' + want + ' мм)' };
        }
        return { ok: true };
    }

    var NUM = '(\\d+(?:[.,]\\d+)?)';
    var KNIFE_TYPE_RE = new RegExp('^([DДдd]|' + NUM.slice(1, -1) + ')\\s*[хХxX×*]\\s*' + NUM +
        '\\s*\\(\\s*' + NUM + '\\s*\\)\\s*(?:(\\d+)\\s*руч\\S*)?$');

    function toNum(s) {
        return Number(String(s).replace(',', '.'));
    }

    // «Тип ножей» из 1С → { ok: true, width, length, sleeveWidth, streams, round }
    // или { ok: false, error } без чисел: кривая строка — ошибка этой строки, а не нули.
    //   «85 х 38 (80)»          → 85 × 38, втулка 80, ручьёв не указано (null);
    //   «18 х 18 (80)15 ручъев» → 18 × 18, втулка 80, 15 ручьёв;
    //   «D х 40 (76)»           → круглая, диаметр 40 (width = length = 40).
    function parseKnifeType(raw) {
        var src = String(raw == null ? '' : raw).trim();
        var m = KNIFE_TYPE_RE.exec(src);
        if (!m) {
            return { ok: false, error: 'тип ножей «' + src + '» не разобран: нужен вид «Ш х Д (ширина втулки)», например «85 х 38 (80)»' };
        }
        var round = /^[DДдd]$/.test(m[1]);
        var length = toNum(m[2]);
        var width = round ? length : toNum(m[1]);
        var sleeveWidth = toNum(m[3]);
        var streams = m[4] != null ? Number(m[4]) : null;
        if (!(width > 0) || !(length > 0) || !(sleeveWidth > 0) || (streams !== null && !(streams > 0))) {
            return { ok: false, error: 'тип ножей «' + src + '»: размер этикетки, ширина втулки и число ручьёв должны быть больше нуля' };
        }
        return { ok: true, width: width, length: length, sleeveWidth: sleeveWidth, streams: streams, round: round };
    }

    return {
        PRODUCT_KIND: PRODUCT_KIND,
        core: {
            PRODUCT_KIND: PRODUCT_KIND,
            PRODUCT_KIND_COLUMNS: PRODUCT_KIND_COLUMNS,
            PRODUCTION_CONFIGS: PRODUCTION_CONFIGS,
            resolveProductionTables: resolveProductionTables,
            RUN_KIND: RUN_KIND,
            runKindOf: runKindOf,
            dieMileage: dieMileage,
            initialRunPlan: initialRunPlan,
            cylinderRepeatMm: cylinderRepeatMm,
            checkCylinderRepeat: checkCylinderRepeat,
            checkDieRepeat: checkDieRepeat,
            productKindOf: productKindOf,
            rowProductKind: rowProductKind,
            filterPositionRows: filterPositionRows,
            parseKnifeType: parseKnifeType
        }
    };
});
