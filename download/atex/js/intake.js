// Рабочее место atex «Движение сырья» (роли Кладовщик/Оператор, Диспетчер).
// URL — /atex/intake. Решение ideav/crm#4655 (исходно #2914). Правила разработки
// рабочих мест — docs/WORKSPACE_DEVELOPMENT_GUIDE.md, описание — docs/atex_workplaces.md §3.4.
//
// МОДЕЛЬ. Запись «Партия сырья» (1074) — карточка остатка: ровно одна на пару
// (объект, склад); в базе ateh пара уникальна для всех 97 записей, а реквизиты
// «Вид сырья», «Склад» и «Диаметр втулки» помечены `key:true`. Рабочее место
// поэтому не «создаёт партии», а проводит ТРИ операции над остатками:
//   • Приход      — сырьё поступило на склад;
//   • Перемещение — со склада на склад;
//   • Списание    — брак или отгрузка вовне (остаток уменьшается, причина обязательна).
//
// ОБЪЕКТ ПЕРЕДАЧИ выбирается из ОДНОГО списка: риббоны (справочник «Вид сырья»,
// 1069) и втулки (справочник «Диаметр втулки», 8188). Мера объекта определяется
// самим объектом, пользователь её не выбирает:
//   • риббон           → «Остаток, м²», взаимно с «Остаток, м» через «Номинальная
//                        ширина» вида сырья: S(м²) = L(м) × W(мм) / 1000;
//   • втулка с «Ширина втулки, мм» → штуки, реквизит «Кол-во», «Ед.изм.» = шт;
//   • втулка без ширины           → метры, реквизит «Кол-во», «Ед.изм.» = Метр.
//
// ЖУРНАЛ. Каждая проводка пишется в таблицу «Движение сырья» (кто/когда/откуда/
// куда/сколько/почему/было/стало). «Было»/«Стало» — остаток карточки, С КОТОРОЙ
// операция берёт (списание, перемещение) или В КОТОРУЮ кладёт (приход). Склады
// журнал хранит ТЕКСТОМ: в одной записи Интеграма не бывает двух ссылок на одну
// таблицу, а «Со склада» и «На склад» смотрят в один справочник.
//
// Чистое ядро (`calc`) и метаданные-хелперы (`helpers`) экспортируются через
// module.exports для модульных тестов (experiments/atex-intake.test.js).

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.AtexIntake = api;
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

    // Имена таблиц и реквизитов схемы atex. По именам рабочее место находит
    // числовые id в метаданных текущей сборки — код переживает пересборку базы.
    var TABLE = {
        card: 'Партия сырья',
        material: 'Вид сырья',
        sleeve: 'Диаметр втулки',
        warehouse: 'Склад',
        unit: 'Ед.изм.',
        journal: 'Движение сырья'
    };
    var CARD_REQ = {
        material: 'Вид сырья',
        sleeve: 'Диаметр втулки',
        warehouse: 'Склад',
        remainder: 'Остаток, м²',
        remainderM: 'Остаток, м',
        qty: 'Кол-во',
        unit: 'Ед.изм.',
        barcode: 'Штрих-код',
        active: 'В работе',
        note: 'Примечание'
    };
    var MATERIAL_REQ = { nominalWidth: 'Номинальная ширина' };
    var SLEEVE_REQ = { width: 'Ширина втулки, мм' };
    var JOURNAL_REQ = {
        operation: 'Операция',
        material: 'Вид сырья',
        sleeve: 'Диаметр втулки',
        from: 'Со склада',
        to: 'На склад',
        qty: 'Кол-во',
        unit: 'Ед.изм.',
        was: 'Было',
        became: 'Стало',
        reason: 'Причина',
        note: 'Примечание',
        user: 'Пользователь'
    };

    var OP = { in: 'in', move: 'move', out: 'out' };
    var OP_TITLE = { in: 'Приход', move: 'Перемещение', out: 'Списание' };
    var KIND = { ribbon: 'ribbon', sleeve: 'sleeve' };
    var UNIT = { area: 'm2', pieces: 'pcs', meters: 'm' };
    var UNIT_LABEL = { m2: 'м²', pcs: 'шт', m: 'м' };
    // Названия записей справочника «Ед.изм.» (104590) для каждой меры.
    var UNIT_REF_NAME = { m2: 'м2', pcs: 'шт', m: 'Метр' };
    var REASONS = ['Брак', 'Отгрузка вовне'];

    // ───────────────────────── Чистое ядро расчёта ─────────────────────────

    // Терпимый разбор числа: принимает запятую как десятичный разделитель,
    // отбрасывает пробелы; «пусто»/мусор → 0.
    function toNumber(value) {
        if (typeof value === 'number') return isFinite(value) ? value : 0;
        var text = String(value == null ? '' : value).replace(/\s+/g, '').replace(',', '.');
        var n = parseFloat(text);
        return isFinite(n) ? n : 0;
    }

    function roundTo(n, digits) {
        var k = Math.pow(10, digits);
        return Math.round(n * k) / k;
    }

    // Округление до 3 знаков, чтобы убрать артефакты float-арифметики.
    function round3(n) {
        return roundTo(n, 3);
    }

    function trimValue(value) {
        return String(value == null ? '' : value).trim();
    }

    // Взаимный пересчёт риббона по номинальной ширине рулона (мм) — та же
    // арифметика, что на пульте слиттера (#3861):
    //   L(м)  = S(м²) × 1000 / W(мм)
    //   S(м²) = L(м)  × W(мм) / 1000
    // Ширина ≤ 0 (не задана у вида сырья) → 0: пересчёт невозможен.
    function metersFromArea(areaM2, widthMm) {
        var w = toNumber(widthMm);
        return w > 0 ? round3(toNumber(areaM2) * 1000 / w) : 0;
    }
    function areaFromMeters(meters, widthMm) {
        var w = toNumber(widthMm);
        return w > 0 ? round3(toNumber(meters) * w / 1000) : 0;
    }

    // Мера объекта передачи. Втулка с заданной «Шириной втулки, мм» — готовая,
    // её приходуют и расходуют штуками; без ширины втулку меряют метражом.
    function unitOfItem(item) {
        if (!item) return UNIT.area;
        if (item.kind === KIND.sleeve) {
            return toNumber(item.sleeveWidth) > 0 ? UNIT.pieces : UNIT.meters;
        }
        return UNIT.area;
    }

    function unitLabel(unit) {
        return UNIT_LABEL[unit] || '';
    }

    // Остаток карточки в мере её объекта. Риббон — «Остаток, м²»; втулка —
    // «Кол-во» (см. шапку файла).
    function cardQuantity(card, item) {
        if (!card) return 0;
        var kind = (item && item.kind) || card.kind;
        return round3(toNumber(kind === KIND.sleeve ? card.qty : card.remainder));
    }

    // Карточка втулки, у которой количество ещё лежит в старых реквизитах
    // («Остаток, м²» или «Остаток, м»), а «Кол-во» пусто, — данные не
    // перенесены. Молча подставлять старое поле нельзя, показывать ноль при
    // непустом складе — тем более: рабочее место такую карточку помечает.
    function needsQtyMigration(card) {
        return !!card && card.kind === KIND.sleeve && trimValue(card.qty) === '' &&
            (toNumber(card.remainder) > 0 || toNumber(card.remainderM) > 0);
    }

    // Число для подписи: без хвостовых нулей, с разделителем тысяч и не более
    // `decimals` знаков после запятой (по умолчанию 3 — точный остаток карточки;
    // сводка складских итогов зовёт с 0, дробные доли м² в сумме по складу —
    // шум). Разделитель тысяч — НЕРАЗРЫВНЫЙ пробел: число остаётся одним словом
    // и не разваливается по строкам.
    function formatQty(value, decimals) {
        var n = roundTo(toNumber(value), decimals == null ? 3 : decimals);
        var text = String(n);
        var parts = text.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
        return parts.join(',');
    }

    // Ключ карточки остатка: пара (объект, склад).
    function cardKey(kind, itemId, warehouseId) {
        return String(kind || '') + '|' + trimValue(itemId) + '|' + trimValue(warehouseId);
    }

    // Карточка пары (объект, склад) среди загруженных остатков; нет — null.
    function findCard(cards, item, warehouseId) {
        if (!item || !item.id) return null;
        var wanted = cardKey(item.kind, item.id, warehouseId);
        var found = (cards || []).filter(function(c) {
            return cardKey(c.kind, c.itemId, c.warehouseId) === wanted;
        });
        return found.length ? found[0] : null;
    }

    // План проводки — чистая функция: на входе намерение оператора и текущие
    // остатки, на выходе шаги записи и запись журнала. Ошибки собираются все
    // сразу, чтобы форма показала их одним списком.
    //
    // input = { op, item, quantity, fromWarehouseId, toWarehouseId, fromCard,
    //           toCard, fromWarehouseLabel, toWarehouseLabel, reason, note, user, at }
    // → { errors: [строки], steps: [{ role, cardId, warehouseId, was, now }], journal }
    function planMovement(input) {
        input = input || {};
        var op = input.op;
        var item = input.item || null;
        var qty = round3(toNumber(input.quantity));
        var unit = unitOfItem(item);
        var errors = [];

        var fromId = trimValue(input.fromWarehouseId);
        var toId = trimValue(input.toWarehouseId);
        var fromCard = input.fromCard || null;
        var toCard = input.toCard || null;
        var fromLabel = trimValue(input.fromWarehouseLabel) || fromId;
        var toLabel = trimValue(input.toWarehouseLabel) || toId;

        if (!item || !item.id) errors.push('Выберите объект передачи');
        if (!(qty > 0)) errors.push('Укажите количество больше нуля');

        if (op === OP.in) {
            if (!toId) errors.push('Выберите склад прихода');
        } else if (op === OP.out) {
            if (!fromId) errors.push('Выберите склад списания');
            if (!trimValue(input.reason)) errors.push('Укажите причину списания');
        } else if (op === OP.move) {
            if (!fromId) errors.push('Выберите склад-источник');
            if (!toId) errors.push('Выберите склад-приёмник');
            if (fromId && toId && fromId === toId) errors.push('Склад-источник и склад-приёмник совпадают');
        } else {
            errors.push('Неизвестная операция');
        }

        var available = cardQuantity(fromCard, item);
        if ((op === OP.out || op === OP.move) && item && item.id && fromId) {
            if (!fromCard) {
                errors.push('На складе «' + fromLabel + '» этого сырья нет');
            } else if (needsQtyMigration(fromCard)) {
                errors.push('У карточки на складе «' + fromLabel + '» количество ещё не перенесено в «Кол-во»');
            } else if (qty > available) {
                errors.push('На складе «' + fromLabel + '» всего ' + formatQty(available) + ' ' +
                    unitLabel(unit) + ' — списать больше нельзя');
            }
        }
        if (op === OP.in && toCard && needsQtyMigration(toCard)) {
            errors.push('У карточки на складе «' + toLabel + '» количество ещё не перенесено в «Кол-во»');
        }

        if (errors.length) return { errors: errors, steps: [], journal: null };

        var steps = [];
        var journalWas = 0;
        var journalNow = 0;

        if (op === OP.out || op === OP.move) {
            var fromNow = round3(available - qty);
            steps.push({
                role: 'from', cardId: fromCard.id, warehouseId: fromId,
                was: available, now: fromNow
            });
            journalWas = available;
            journalNow = fromNow;
        }
        if (op === OP.in || op === OP.move) {
            var toWas = cardQuantity(toCard, item);
            var toNow = round3(toWas + qty);
            steps.push({
                role: 'to', cardId: toCard ? toCard.id : null, warehouseId: toId,
                was: toWas, now: toNow
            });
            if (op === OP.in) { journalWas = toWas; journalNow = toNow; }
        }

        return {
            errors: [],
            steps: steps,
            journal: {
                at: toNumber(input.at) || 0,
                operation: OP_TITLE[op],
                kind: item.kind,
                itemId: String(item.id),
                itemLabel: trimValue(item.label),
                fromWarehouseId: fromId,
                toWarehouseId: toId,
                // Названия складов журнал хранит текстом: двух ссылок на одну
                // таблицу «Склад» в записи Интеграма быть не может.
                fromWarehouseLabel: fromId ? fromLabel : '',
                toWarehouseLabel: toId ? toLabel : '',
                quantity: qty,
                unit: unit,
                was: journalWas,
                became: journalNow,
                reason: trimValue(input.reason),
                note: trimValue(input.note),
                user: trimValue(input.user)
            }
        };
    }

    // Сводка остатков по мерам: сколько карточек и сколько всего в каждой мере.
    function summarize(cards) {
        return (cards || []).reduce(function(acc, c) {
            acc.count += 1;
            var unit = unitOfItem({ kind: c.kind, sleeveWidth: c.sleeveWidth });
            var value = cardQuantity(c, { kind: c.kind });
            if (unit === UNIT.area) acc.totalM2 = round3(acc.totalM2 + value);
            else if (unit === UNIT.pieces) acc.totalPcs = round3(acc.totalPcs + value);
            else acc.totalM = round3(acc.totalM + value);
            return acc;
        }, { count: 0, totalM2: 0, totalPcs: 0, totalM: 0 });
    }

    // Фильтрация списка остатков на клиенте: весь список карточек грузится
    // одним запросом (в ateh их 97), поэтому серверные фильтры не нужны.
    function filterCards(cards, filters) {
        filters = filters || {};
        var kind = trimValue(filters.kind);
        var itemId = trimValue(filters.itemId);
        var warehouseId = trimValue(filters.warehouseId);
        var text = trimValue(filters.text).toLowerCase();
        return (cards || []).filter(function(c) {
            if (kind && c.kind !== kind) return false;
            if (itemId && String(c.itemId) !== itemId) return false;
            if (warehouseId && String(c.warehouseId) !== warehouseId) return false;
            if (text) {
                var haystack = (c.itemLabel + ' ' + c.warehouseLabel + ' ' + (c.barcode || '')).toLowerCase();
                if (haystack.indexOf(text) === -1) return false;
            }
            return true;
        });
    }

    // Единый список объектов передачи: риббоны и втулки одним алфавитом внутри
    // своей группы, риббоны первыми (их выбирают чаще).
    function mergeItems(materials, sleeves) {
        function byLabel(a, b) { return String(a.label).localeCompare(String(b.label), 'ru'); }
        return (materials || []).slice().sort(byLabel)
            .concat((sleeves || []).slice().sort(byLabel));
    }

    var calc = {
        toNumber: toNumber,
        round3: round3,
        metersFromArea: metersFromArea,
        areaFromMeters: areaFromMeters,
        unitOfItem: unitOfItem,
        unitLabel: unitLabel,
        cardQuantity: cardQuantity,
        needsQtyMigration: needsQtyMigration,
        formatQty: formatQty,
        cardKey: cardKey,
        findCard: findCard,
        planMovement: planMovement,
        summarize: summarize,
        filterCards: filterCards,
        mergeItems: mergeItems,
        OP: OP,
        OP_TITLE: OP_TITLE,
        KIND: KIND,
        UNIT: UNIT,
        REASONS: REASONS
    };

    // ──────────────────── Метаданные: чтение и запись полей ────────────────────

    // Псевдоним реквизита в конкретной таблице (attrs.alias). Реквизит с
    // псевдонимом приходит в metadata под ИМЕНЕМ ТИПА («Движение сырья.Операция»),
    // а колонка в таблице называется «Операция» — искать нужно по обоим.
    function reqAlias(req) {
        var raw = req && req.attrs;
        if (!raw) return '';
        if (typeof raw === 'object') return String(raw.alias || '');
        try { return String((JSON.parse(raw) || {}).alias || ''); }
        catch (e) { return ''; }
    }

    // Реквизит по имени → его числовой id (ключ `t{id}` в данных и фильтрах).
    function reqIdByName(meta, name) {
        var wanted = String(name).trim().toLowerCase();
        var found = (meta && meta.reqs || []).filter(function(r) {
            return String(r.val).trim().toLowerCase() === wanted ||
                reqAlias(r).trim().toLowerCase() === wanted;
        })[0];
        return found ? String(found.id) : null;
    }

    // Колонки JSON_OBJ идут в порядке: [главное значение, ...reqs по порядку].
    function columnIndex(meta, reqName) {
        var order = [String(meta && meta.id)].concat((meta && meta.reqs || []).map(function(r) { return String(r.id); }));
        var rid = reqIdByName(meta, reqName);
        var idx = order.indexOf(String(rid));
        return idx >= 0 ? idx : -1;
    }

    // Разбор значения-ссылки из JSON_OBJ: «id:Подпись» → { id, label }.
    // Мультизначение («id1,id2:зн1,зн2») сводится к первому id.
    function parseRef(raw) {
        var m = String(raw == null ? '' : raw).match(/^([\d,]+):([\s\S]*)$/);
        if (!m) return { id: null, label: String(raw == null ? '' : raw) };
        return { id: String(m[1]).split(',')[0], label: m[2] };
    }

    // Запись карточки остатка из JSON_OBJ. Объект карточки — либо вид сырья
    // (риббон), либо диаметр втулки; пустые обе колонки → карточка без объекта.
    function mapCardRecord(rec, meta) {
        var r = rec && rec.r || [];
        function at(name) {
            var i = columnIndex(meta, name);
            return i >= 0 ? (r[i] == null ? '' : r[i]) : '';
        }
        var material = parseRef(at(CARD_REQ.material));
        var sleeve = parseRef(at(CARD_REQ.sleeve));
        var warehouse = parseRef(at(CARD_REQ.warehouse));
        var unit = parseRef(at(CARD_REQ.unit));
        var kind = sleeve.id ? KIND.sleeve : KIND.ribbon;
        return {
            id: String(rec && rec.i),
            at: r[0] || '',
            kind: kind,
            itemId: kind === KIND.sleeve ? sleeve.id : material.id,
            itemLabel: kind === KIND.sleeve ? sleeve.label : material.label,
            warehouseId: warehouse.id || '',
            warehouseLabel: warehouse.label || '',
            remainder: at(CARD_REQ.remainder),
            remainderM: at(CARD_REQ.remainderM),
            qty: at(CARD_REQ.qty),
            unitId: unit.id || '',
            unitLabel: unit.label || '',
            barcode: at(CARD_REQ.barcode),
            active: at(CARD_REQ.active),
            note: at(CARD_REQ.note)
        };
    }

    // Поля остатка карточки для `_m_set`/`_m_new` — одна арифметика на все пути.
    // Риббон: «Остаток, м²» = quantity, «Остаток, м» досчитывается по номинальной
    // ширине; ширина не задана — метровый остаток НЕ трогаем (пересчитать нечем,
    // рабочее место об этом предупреждает).
    // Втулка: «Кол-во» = quantity.
    function cardQuantityFields(meta, item, quantity) {
        var fields = {};
        var value = round3(toNumber(quantity));
        function set(reqName, v) {
            var id = reqIdByName(meta, reqName);
            if (id) fields['t' + id] = v;
        }
        if (item && item.kind === KIND.sleeve) {
            set(CARD_REQ.qty, value);
        } else {
            set(CARD_REQ.remainder, value);
            var width = toNumber(item && item.nominalWidth);
            if (width > 0) set(CARD_REQ.remainderM, metersFromArea(value, width));
        }
        return fields;
    }

    // Поля новой карточки: объект, склад, остаток, единица измерения и флаг
    // «В работе» (иначе планировщик карточку не увидит). Главное значение
    // таблицы — момент заведения карточки (колонка типа «дата/время», unix).
    function buildCardCreateParams(meta, item, warehouseId, quantity, unitRefId, at) {
        var params = cardQuantityFields(meta, item, quantity);
        function set(reqName, value) {
            var id = reqIdByName(meta, reqName);
            if (id && value !== '' && value != null) params['t' + id] = value;
        }
        set(item && item.kind === KIND.sleeve ? CARD_REQ.sleeve : CARD_REQ.material, item && item.id);
        set(CARD_REQ.warehouse, warehouseId);
        set(CARD_REQ.unit, unitRefId);
        set(CARD_REQ.active, 'X');
        // Главное значение таблицы — колонка «дата/время»: пишем unix-секунды
        // строкой, как это делают остальные рабочие места atex.
        var stamp = toNumber(at);
        if (stamp > 0) params['t' + meta.id] = String(stamp);
        return params;
    }

    // Поля записи журнала «Движение сырья».
    function buildJournalFields(meta, journal) {
        if (!meta || !journal) return null;
        var fields = {};
        function set(reqName, value) {
            var id = reqIdByName(meta, reqName);
            if (!id) return;
            if (value === '' || value == null) return;
            fields['t' + id] = value;
        }
        var stamp = toNumber(journal.at);
        if (stamp > 0) fields['t' + meta.id] = String(stamp);
        set(JOURNAL_REQ.operation, journal.operation);
        set(journal.kind === KIND.sleeve ? JOURNAL_REQ.sleeve : JOURNAL_REQ.material, journal.itemId);
        set(JOURNAL_REQ.from, journal.fromWarehouseLabel);
        set(JOURNAL_REQ.to, journal.toWarehouseLabel);
        set(JOURNAL_REQ.qty, journal.quantity);
        set(JOURNAL_REQ.unit, journal.unitRefId);
        set(JOURNAL_REQ.was, journal.was);
        set(JOURNAL_REQ.became, journal.became);
        set(JOURNAL_REQ.reason, journal.reason);
        set(JOURNAL_REQ.note, journal.note);
        set(JOURNAL_REQ.user, journal.user);
        return fields;
    }

    // Запись журнала из JSON_OBJ — для ленты последних операций.
    function mapJournalRecord(rec, meta) {
        var r = rec && rec.r || [];
        function at(name) {
            var i = columnIndex(meta, name);
            return i >= 0 ? (r[i] == null ? '' : r[i]) : '';
        }
        var material = parseRef(at(JOURNAL_REQ.material));
        var sleeve = parseRef(at(JOURNAL_REQ.sleeve));
        return {
            id: String(rec && rec.i),
            at: r[0] || '',
            operation: at(JOURNAL_REQ.operation),
            itemLabel: sleeve.id ? sleeve.label : material.label,
            fromLabel: at(JOURNAL_REQ.from),
            toLabel: at(JOURNAL_REQ.to),
            quantity: at(JOURNAL_REQ.qty),
            unitLabel: parseRef(at(JOURNAL_REQ.unit)).label,
            was: at(JOURNAL_REQ.was),
            became: at(JOURNAL_REQ.became),
            reason: at(JOURNAL_REQ.reason),
            note: at(JOURNAL_REQ.note),
            user: at(JOURNAL_REQ.user)
        };
    }

    var helpers = {
        reqAlias: reqAlias,
        reqIdByName: reqIdByName,
        columnIndex: columnIndex,
        parseRef: parseRef,
        mapCardRecord: mapCardRecord,
        cardQuantityFields: cardQuantityFields,
        buildCardCreateParams: buildCardCreateParams,
        buildJournalFields: buildJournalFields,
        mapJournalRecord: mapJournalRecord
    };

    // ─────────────────────────── Браузерный слой ───────────────────────────
    // Ниже — DOM-контроллер. Требует window/document/fetch; в Node не выполняется.

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function(k) {
            if (attrs[k] === undefined || attrs[k] === null) return;
            if (k === 'class') node.className = attrs[k];
            else if (k === 'text') node.textContent = attrs[k];
            else if (k === 'dataset') Object.keys(attrs[k]).forEach(function(d) { node.dataset[d] = attrs[k][d]; });
            else node.setAttribute(k, attrs[k]);
        });
        (children || []).forEach(function(c) {
            if (c == null) return;
            node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return node;
    }

    function nowUnix() {
        return Math.floor(Date.now() / 1000);
    }

    // Unix-штамп главного значения (колонка «дата/время») → «ДД.ММ.ГГГГ ЧЧ:ММ».
    function formatStamp(value) {
        var n = toNumber(value);
        if (!(n > 0)) return '—';
        var d = new Date(n * 1000);
        var pad = function(x) { return ('0' + x).slice(-2); };
        return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() +
            ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function AtexIntake(root) {
        this.root = root;
        this.db = window.db || root.getAttribute('data-db') || '';
        this.user = root.getAttribute('data-user') || '';
        this.meta = { card: null, material: null, sleeve: null, warehouse: null, unit: null, journal: null };
        this.items = [];        // единый список объектов передачи [{ kind, id, label, nominalWidth|sleeveWidth }]
        this.itemsById = {};    // индекс по «kind|id»
        this.warehouses = [];   // [{ id, label }]
        this.units = {};        // { 'm2'|'pcs'|'m': id записи «Ед.изм.» }
        this.cards = [];        // остатки [{ id, kind, itemId, warehouseId, ... }]
        this.journal = [];      // лента последних движений
        this.filters = { kind: '', itemId: '', warehouseId: '', text: '' };
        this.refOptions = {};   // кеш опций searchable-ref по ключу
        this.form = null;       // намерение оператора
        this.busy = false;
        this.warnings = [];     // предупреждения об окружении (нет журнала, нет ширины…)
    }

    AtexIntake.prototype.url = function(path) {
        return '/' + encodeURIComponent(this.db) + '/' + path;
    };

    // GET → JSON. Бросает Error при сетевой/JSON-ошибке.
    AtexIntake.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                try { return JSON.parse(text); }
                catch (e) { throw new Error('Некорректный JSON: ' + text.slice(0, 200)); }
            });
        });
    };

    // POST команды `_m_*`. Токен XSRF подставляется обязательно (раздел 4 гайда).
    AtexIntake.prototype.post = function(path, params) {
        var body = new URLSearchParams();
        body.set('_xsrf', (typeof window !== 'undefined' && window.xsrf) || this.root.getAttribute('data-xsrf') || '');
        Object.keys(params || {}).forEach(function(k) {
            if (params[k] !== undefined && params[k] !== null) body.set(k, params[k]);
        });
        return fetch(this.url(path), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        }).then(function(resp) {
            return resp.text().then(function(text) {
                var result;
                try { result = JSON.parse(text); } catch (e) { throw new Error('Сервер вернул не JSON: ' + text.slice(0, 200)); }
                if (result && (result.error || result.err)) throw new Error(result.error || result.err);
                return result;
            });
        });
    };

    // ── Загрузка справочников ──

    AtexIntake.prototype.loadMetadata = function() {
        var self = this;
        return this.getJson('metadata').then(function(all) {
            var list = Array.isArray(all) ? all : [all];
            function byName(name) {
                return list.filter(function(t) {
                    return String(t.val).trim().toLowerCase() === name.trim().toLowerCase();
                })[0] || null;
            }
            self.meta.card = byName(TABLE.card);
            self.meta.material = byName(TABLE.material);
            self.meta.sleeve = byName(TABLE.sleeve);
            self.meta.warehouse = byName(TABLE.warehouse);
            self.meta.unit = byName(TABLE.unit);
            self.meta.journal = byName(TABLE.journal);
            if (!self.meta.card) throw new Error('В метаданных не найдена таблица «' + TABLE.card + '»');
            if (!self.meta.warehouse) throw new Error('В метаданных не найдена таблица «' + TABLE.warehouse + '»');
            if (!self.meta.journal) {
                self.warnings.push('Таблица «' + TABLE.journal + '» в этой базе не заведена — ' +
                    'операции проводятся, но в журнал не записываются');
            }
        });
    };

    // Риббоны: «Вид сырья» + «Номинальная ширина» (для пересчёта м² ↔ м).
    AtexIntake.prototype.loadMaterials = function() {
        var self = this;
        var meta = this.meta.material;
        if (!meta) return Promise.resolve([]);
        var wIdx = columnIndex(meta, MATERIAL_REQ.nominalWidth);
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,2000').then(function(rows) {
            return (rows || []).map(function(rec) {
                var r = rec.r || [];
                return {
                    kind: KIND.ribbon,
                    id: String(rec.i),
                    label: String(r[0] || ('#' + rec.i)),
                    fullName: String(r[1] || ''),
                    nominalWidth: wIdx >= 0 ? toNumber(r[wIdx]) : 0
                };
            });
        });
    };

    // Втулки: «Диаметр втулки» + «Ширина втулки, мм» (задана → считаем штуками).
    AtexIntake.prototype.loadSleeves = function() {
        var meta = this.meta.sleeve;
        if (!meta) return Promise.resolve([]);
        var wIdx = columnIndex(meta, SLEEVE_REQ.width);
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,2000').then(function(rows) {
            return (rows || []).map(function(rec) {
                var r = rec.r || [];
                return {
                    kind: KIND.sleeve,
                    id: String(rec.i),
                    label: String(r[0] || ('#' + rec.i)),
                    sleeveWidth: wIdx >= 0 ? toNumber(r[wIdx]) : 0
                };
            });
        });
    };

    AtexIntake.prototype.loadWarehouses = function() {
        var self = this;
        var meta = this.meta.warehouse;
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,200').then(function(rows) {
            self.warehouses = (rows || []).map(function(rec) {
                return { id: String(rec.i), label: String((rec.r || [])[0] || ('#' + rec.i)) };
            });
        });
    };

    // Записи справочника «Ед.изм.» по названиям мер: шт / Метр / м2.
    AtexIntake.prototype.loadUnits = function() {
        var self = this;
        var meta = this.meta.unit;
        self.units = {};
        if (!meta) {
            this.warnings.push('Справочник «' + TABLE.unit + '» недоступен — новые карточки останутся без единицы измерения');
            return Promise.resolve();
        }
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,200').then(function(rows) {
            var byName = {};
            (rows || []).forEach(function(rec) {
                byName[String((rec.r || [])[0] || '').trim().toLowerCase()] = String(rec.i);
            });
            var missing = [];
            Object.keys(UNIT_REF_NAME).forEach(function(unit) {
                var id = byName[UNIT_REF_NAME[unit].toLowerCase()];
                if (id) self.units[unit] = id;
                else missing.push(UNIT_REF_NAME[unit]);
            });
            if (missing.length) {
                self.warnings.push('В справочнике «' + TABLE.unit + '» нет записей: ' + missing.join(', ') +
                    ' — новые карточки с такой мерой останутся без единицы измерения');
            }
        });
    };

    AtexIntake.prototype.indexItems = function(materials, sleeves) {
        var self = this;
        this.items = mergeItems(materials, sleeves);
        this.itemsById = {};
        this.items.forEach(function(item) {
            self.itemsById[item.kind + '|' + item.id] = item;
        });
    };

    AtexIntake.prototype.itemOf = function(kind, id) {
        return this.itemsById[String(kind) + '|' + String(id)] || null;
    };

    // Остатки: весь список карточек одним запросом. Упёрлись в потолок выборки —
    // кричим, а не показываем часть склада как весь склад.
    AtexIntake.prototype.loadCards = function() {
        var self = this;
        var meta = this.meta.card;
        var limit = 5000;
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,' + limit).then(function(rows) {
            // Флагом, а не push в warnings: остатки перезагружаются после каждой
            // проводки, и накопленный список предупреждений размножился бы.
            self.cardsTruncated = (rows || []).length >= limit ? limit : 0;
            self.cards = (rows || []).map(function(rec) {
                var card = mapCardRecord(rec, meta);
                var item = self.itemOf(card.kind, card.itemId);
                card.sleeveWidth = item ? item.sleeveWidth : 0;
                card.nominalWidth = item ? item.nominalWidth : 0;
                return card;
            });
        });
    };

    AtexIntake.prototype.loadJournal = function() {
        var self = this;
        var meta = this.meta.journal;
        if (!meta) { this.journal = []; return Promise.resolve(); }
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,200').then(function(rows) {
            self.journal = (rows || [])
                .map(function(rec) { return mapJournalRecord(rec, meta); })
                .sort(function(a, b) { return toNumber(b.at) - toNumber(a.at); })
                .slice(0, 15);
        }).catch(function() { self.journal = []; });
    };

    // ── Состояние формы ──

    AtexIntake.prototype.newForm = function(op) {
        this.form = {
            op: op || (this.form && this.form.op) || OP.in,
            kind: null, itemId: '',
            fromWarehouseId: '', toWarehouseId: '',
            quantity: '', quantityM: '',
            reason: '', note: ''
        };
    };

    AtexIntake.prototype.formItem = function() {
        var f = this.form;
        if (!f || !f.itemId) return null;
        return this.itemOf(f.kind, f.itemId);
    };

    AtexIntake.prototype.warehouseLabel = function(id) {
        var found = this.warehouses.filter(function(w) { return String(w.id) === String(id); })[0];
        return found ? found.label : String(id || '');
    };

    // Текущий план проводки — та же чистая функция, что и при сохранении:
    // предпросмотр и запись считают ОДНУ арифметику.
    AtexIntake.prototype.currentPlan = function() {
        var f = this.form || {};
        var item = this.formItem();
        return planMovement({
            op: f.op,
            item: item,
            quantity: f.quantity,
            fromWarehouseId: f.fromWarehouseId,
            toWarehouseId: f.toWarehouseId,
            fromWarehouseLabel: this.warehouseLabel(f.fromWarehouseId),
            toWarehouseLabel: this.warehouseLabel(f.toWarehouseId),
            fromCard: findCard(this.cards, item, f.fromWarehouseId),
            toCard: findCard(this.cards, item, f.toWarehouseId),
            reason: f.reason,
            note: f.note,
            user: this.user,
            at: nowUnix()
        });
    };

    // ── Рендеринг ──

    AtexIntake.prototype.render = function() {
        this.renderWarnings();
        this.renderList();
        this.renderForm();
        this.renderJournal();
    };

    AtexIntake.prototype.renderWarnings = function() {
        var box = this.warnEl;
        if (!box) return;
        box.innerHTML = '';
        var list = this.warnings.slice();
        if (this.cardsTruncated) {
            list.push('Карточек остатка больше ' + this.cardsTruncated + ' — список показан не полностью');
        }
        var mismatched = this.unitMismatches();
        if (mismatched.length) {
            list.push('Единица измерения карточки расходится с правилом объекта у ' + mismatched.length +
                ' карточек (' + mismatched.slice(0, 3).join(', ') +
                (mismatched.length > 3 ? ', …' : '') + ') — проверьте «Ширину втулки, мм» и «Ед.изм.»');
        }
        var stale = this.cards.filter(needsQtyMigration).length;
        if (stale) {
            list.push('У ' + stale + ' карточек втулок количество лежит в старых реквизитах остатка, ' +
                'а не в «Кол-во» — операции по ним заблокированы до переноса данных ' +
                '(docs/scripts/migrate_sleeve_qty_4655.py)');
        }
        list.forEach(function(text) {
            box.appendChild(el('div', { class: 'atex-in-warn', text: text }));
        });
        box.hidden = !list.length;
    };

    // Карточки, у которых сохранённая «Ед.изм.» не та, что даёт правило объекта
    // (риббон — м², втулка с шириной — шт, без ширины — м). Такое расхождение —
    // дыра в справочнике («Ширина втулки, мм» не заполнена) или ошибка в карточке;
    // рабочее место о нём говорит вслух, а не подстраивается молча.
    AtexIntake.prototype.unitMismatches = function() {
        var self = this;
        if (!this.meta.unit) return [];
        var out = [];
        this.cards.forEach(function(c) {
            if (!c.unitId) return;
            var expected = self.units[unitOfItem(self.itemOf(c.kind, c.itemId) || c)];
            if (expected && String(expected) !== String(c.unitId)) out.push(c.itemLabel);
        });
        return out.filter(function(label, i) { return out.indexOf(label) === i; });
    };

    AtexIntake.prototype.refSelect = function(opts) {
        var helper = (typeof window !== 'undefined' && window.AtexRefSearch) || null;
        if (helper && typeof helper.createSelect === 'function') {
            return helper.createSelect({
                classPrefix: 'atex-in',
                inputClass: 'atex-in-input',
                id: opts.id,
                cacheKey: opts.id,
                replaceCache: true,
                options: opts.options || [],
                value: opts.value,
                placeholder: opts.placeholder,
                cache: this.refOptions,
                onChange: opts.onChange
            });
        }
        var sel = el('select', { class: 'atex-in-input', id: opts.id });
        sel.appendChild(el('option', { value: '', text: opts.placeholder || '— не выбрано —' }));
        (opts.options || []).forEach(function(item) {
            var o = el('option', { value: item.id, text: item.label });
            if (String(opts.value) === String(item.id)) o.selected = true;
            sel.appendChild(o);
        });
        sel.addEventListener('change', function() { opts.onChange(sel.value); });
        return sel;
    };

    // Опции единого списка объектов: id вида «kind|id», чтобы риббон и втулка с
    // одинаковым числовым id не смешивались.
    AtexIntake.prototype.itemOptions = function() {
        return this.items.map(function(item) {
            var suffix = item.kind === KIND.sleeve ? '' : (item.fullName ? ' · ' + item.fullName : '');
            return { id: item.kind + '|' + item.id, label: item.label + suffix };
        });
    };

    AtexIntake.prototype.renderFilters = function() {
        var self = this;
        var box = this.filtersEl;
        box.innerHTML = '';

        var kindSel = el('select', { class: 'atex-in-input' });
        [['', 'Всё сырьё'], [KIND.ribbon, 'Риббоны'], [KIND.sleeve, 'Втулки']].forEach(function(pair) {
            var o = el('option', { value: pair[0], text: pair[1] });
            if (self.filters.kind === pair[0]) o.selected = true;
            kindSel.appendChild(o);
        });
        kindSel.addEventListener('change', function() {
            self.filters.kind = kindSel.value;
            self.renderList();
        });
        box.appendChild(filterField('Тип сырья', kindSel));

        var whSel = el('select', { class: 'atex-in-input' });
        whSel.appendChild(el('option', { value: '', text: 'Все склады' }));
        this.warehouses.forEach(function(w) {
            var o = el('option', { value: w.id, text: w.label });
            if (String(self.filters.warehouseId) === String(w.id)) o.selected = true;
            whSel.appendChild(o);
        });
        whSel.addEventListener('change', function() {
            self.filters.warehouseId = whSel.value;
            self.renderList();
        });
        box.appendChild(filterField('Склад', whSel));

        var textInput = el('input', {
            class: 'atex-in-input', type: 'text', autocomplete: 'off',
            placeholder: 'Название или штрих-код'
        });
        textInput.value = this.filters.text || '';
        textInput.addEventListener('input', function() {
            self.filters.text = textInput.value;
            self.renderList();
        });
        box.appendChild(filterField('Поиск', textInput));

        function filterField(label, control) {
            return el('div', { class: 'atex-in-filter-field' }, [
                el('label', { class: 'atex-in-filter-label', text: label }),
                control
            ]);
        }
    };

    AtexIntake.prototype.renderList = function() {
        var self = this;
        var box = this.listEl;
        box.innerHTML = '';

        var visible = filterCards(this.cards, this.filters);
        var s = summarize(visible);
        // Итоги показываются целыми: доли м² в сумме по складу ничего не решают,
        // а разряды тысяч у соседних сумм сливались в одну строку цифр (#4662).
        // Точный остаток карточки — в строке списка ниже.
        this.summaryEl.innerHTML = '';
        this.summaryEl.appendChild(metric('Карточек', formatQty(s.count, 0)));
        this.summaryEl.appendChild(metric('Риббоны, м²', formatQty(s.totalM2, 0)));
        this.summaryEl.appendChild(metric('Втулки, шт', formatQty(s.totalPcs, 0)));
        this.summaryEl.appendChild(metric('Втулки, м', formatQty(s.totalM, 0)));

        if (!visible.length) {
            box.appendChild(el('div', { class: 'atex-in-empty', text: 'Остатков по фильтрам не найдено' }));
            return;
        }
        box.appendChild(el('div', { class: 'atex-in-row atex-in-row-head' }, [
            el('span', { text: 'Объект' }),
            el('span', { text: 'Склад' }),
            el('span', { text: 'Остаток' })
        ]));
        visible.forEach(function(c) {
            var item = self.itemOf(c.kind, c.itemId) || { kind: c.kind, sleeveWidth: c.sleeveWidth };
            var unit = unitOfItem(item);
            var stale = needsQtyMigration(c);
            var active = self.form && self.form.itemId === c.itemId && self.form.kind === c.kind;
            var row = el('button', {
                class: 'atex-in-row atex-in-row-item' + (active ? ' is-active' : '') + (stale ? ' is-stale' : ''),
                type: 'button',
                title: stale ? 'Количество не перенесено в «Кол-во»' : 'Подставить объект и склад в форму'
            }, [
                el('span', { class: 'atex-in-object' }, [
                    el('span', { class: 'atex-in-chip atex-in-chip-' + c.kind, text: c.kind === KIND.sleeve ? 'втулка' : 'риббон' }),
                    el('span', { text: c.itemLabel || ('#' + c.id) })
                ]),
                el('span', { text: c.warehouseLabel || '— не указан —' }),
                el('span', { class: 'atex-in-amount', text: stale ? 'не перенесено' : (formatQty(cardQuantity(c, item)) + ' ' + unitLabel(unit)) })
            ]);
            row.addEventListener('click', function() { self.pickCard(c); });
            box.appendChild(row);
        });

        function metric(label, value) {
            return el('div', { class: 'atex-in-metric' }, [
                el('span', { class: 'atex-in-metric-label', text: label }),
                el('span', { class: 'atex-in-metric-value', text: String(value) })
            ]);
        }
    };

    // Клик по строке остатка подставляет объект и склад в форму: приход — как
    // склад назначения, перемещение/списание — как склад-источник.
    AtexIntake.prototype.pickCard = function(card) {
        var f = this.form;
        f.kind = card.kind;
        f.itemId = card.itemId;
        if (f.op === OP.in) f.toWarehouseId = card.warehouseId;
        else f.fromWarehouseId = card.warehouseId;
        this.render();
    };

    AtexIntake.prototype.renderForm = function() {
        var self = this;
        var f = this.form;
        var form = this.formEl;
        var item = this.formItem();
        var unit = unitOfItem(item);
        form.innerHTML = '';

        // Переключатель операции.
        var tabs = el('div', { class: 'atex-in-tabs', role: 'tablist' });
        [OP.in, OP.move, OP.out].forEach(function(op) {
            var btn = el('button', {
                class: 'atex-in-tab' + (f.op === op ? ' is-active' : ''),
                type: 'button', role: 'tab', 'aria-selected': f.op === op ? 'true' : 'false',
                text: OP_TITLE[op]
            });
            btn.addEventListener('click', function() {
                self.newForm(op);
                self.render();
            });
            tabs.appendChild(btn);
        });
        form.appendChild(tabs);

        // Объект передачи — единый список риббонов и втулок.
        var itemRef = this.refSelect({
            id: 'atex-in-item',
            options: this.itemOptions(),
            value: f.itemId ? (f.kind + '|' + f.itemId) : '',
            placeholder: 'Начните вводить название',
            onChange: function(value) {
                var parts = String(value || '').split('|');
                f.kind = parts[0] || null;
                f.itemId = parts[1] || '';
                f.quantity = '';
                f.quantityM = '';
                // Пустое значение приходит, пока оператор ДОнабирает название:
                // перерисовка на каждый символ отобрала бы фокус у поиска.
                if (!f.itemId) return;
                self.focusQuantity = true;
                self.render();
            }
        });
        form.appendChild(field('Объект передачи', itemRef,
            item ? (item.kind === KIND.sleeve
                ? ('Втулка · учёт ' + (unit === UNIT.pieces ? 'штуками' : 'метражом'))
                : ('Риббон · номинальная ширина ' + (item.nominalWidth > 0 ? formatQty(item.nominalWidth) + ' мм' : 'НЕ ЗАДАНА')))
                : 'Риббоны и втулки в одном списке'));

        // Склады: набор полей зависит от операции.
        if (f.op === OP.move || f.op === OP.out) {
            form.appendChild(field(f.op === OP.move ? 'Со склада' : 'Списать со склада',
                this.warehouseSelect('atex-in-from', f.fromWarehouseId, function(value) {
                    f.fromWarehouseId = value;
                    self.render();
                }), this.stockHint(item, f.fromWarehouseId)));
        }
        if (f.op === OP.in || f.op === OP.move) {
            form.appendChild(field(f.op === OP.move ? 'На склад' : 'Принять на склад',
                this.warehouseSelect('atex-in-to', f.toWarehouseId, function(value) {
                    f.toWarehouseId = value;
                    self.render();
                }), this.stockHint(item, f.toWarehouseId)));
        }

        // Количество. Риббон вводится в м² или в метрах — поля связаны
        // номинальной шириной; втулка — одним полем в своей мере.
        if (item && item.kind === KIND.ribbon) {
            var areaInput = numberInput(f.quantity);
            var metersInput = numberInput(f.quantityM);
            var width = toNumber(item.nominalWidth);
            areaInput.addEventListener('input', function() {
                f.quantity = areaInput.value;
                f.quantityM = width > 0 && areaInput.value !== '' ? String(metersFromArea(areaInput.value, width)) : '';
                metersInput.value = f.quantityM;
                self.renderPreview();
            });
            metersInput.addEventListener('input', function() {
                f.quantityM = metersInput.value;
                f.quantity = width > 0 && metersInput.value !== '' ? String(areaFromMeters(metersInput.value, width)) : f.quantity;
                if (width > 0) areaInput.value = f.quantity;
                self.renderPreview();
            });
            if (!(width > 0)) metersInput.disabled = true;
            this.quantityInput = areaInput;
            form.appendChild(field('Количество, м²', areaInput));
            form.appendChild(field('Количество, м', metersInput, width > 0
                ? 'Пересчёт по номинальной ширине ' + formatQty(width) + ' мм'
                : 'У вида сырья не задана «Номинальная ширина» — пересчёт в метры невозможен, «Остаток, м» не изменится'));
        } else {
            var qtyInput = numberInput(f.quantity);
            qtyInput.addEventListener('input', function() {
                f.quantity = qtyInput.value;
                self.renderPreview();
            });
            this.quantityInput = qtyInput;
            form.appendChild(field('Количество' + (item ? ', ' + unitLabel(unit) : ''), qtyInput,
                item ? null : 'Мера появится после выбора объекта'));
        }

        // Причина списания — обязательна (решение по #4655).
        if (f.op === OP.out) {
            var reasonSel = el('select', { class: 'atex-in-input' });
            reasonSel.appendChild(el('option', { value: '', text: '— выберите причину —' }));
            REASONS.forEach(function(reason) {
                var o = el('option', { value: reason, text: reason });
                if (f.reason === reason) o.selected = true;
                reasonSel.appendChild(o);
            });
            reasonSel.addEventListener('change', function() {
                f.reason = reasonSel.value;
                self.renderPreview();
            });
            form.appendChild(field('Причина списания', reasonSel));
        }

        var noteInput = el('input', { class: 'atex-in-input', type: 'text', maxlength: '127', placeholder: 'Необязательно' });
        noteInput.value = f.note || '';
        noteInput.addEventListener('input', function() { f.note = noteInput.value; });
        form.appendChild(field('Комментарий', noteInput));

        this.previewEl = el('div', { class: 'atex-in-preview' });
        form.appendChild(this.previewEl);

        var actions = el('div', { class: 'atex-in-actions' });
        var saveBtn = el('button', { class: 'atex-in-btn atex-in-btn-primary', type: 'button', text: 'Провести' });
        saveBtn.addEventListener('click', function() { self.submit(); });
        var resetBtn = el('button', { class: 'atex-in-btn atex-in-btn-secondary', type: 'button', text: 'Очистить' });
        resetBtn.addEventListener('click', function() { self.newForm(f.op); self.render(); });
        actions.appendChild(saveBtn);
        actions.appendChild(resetBtn);
        form.appendChild(actions);

        this.renderPreview();
        // После выбора объекта курсор сразу в поле количества — оператор не
        // ищет, куда кликнуть дальше.
        if (this.focusQuantity && this.quantityInput) {
            this.focusQuantity = false;
            this.quantityInput.focus();
        }

        function numberInput(value) {
            var input = el('input', { class: 'atex-in-input', type: 'number', min: '0', step: 'any', placeholder: '0' });
            input.value = value == null ? '' : value;
            return input;
        }
        function field(label, control, hint) {
            return el('div', { class: 'atex-in-field' }, [
                el('label', { class: 'atex-in-label', text: label }),
                control,
                hint ? el('div', { class: 'atex-in-hint', text: hint }) : null
            ]);
        }
    };

    AtexIntake.prototype.warehouseSelect = function(id, value, onChange) {
        var sel = el('select', { class: 'atex-in-input', id: id });
        sel.appendChild(el('option', { value: '', text: '— не выбран —' }));
        this.warehouses.forEach(function(w) {
            var o = el('option', { value: w.id, text: w.label });
            if (String(value) === String(w.id)) o.selected = true;
            sel.appendChild(o);
        });
        sel.addEventListener('change', function() { onChange(sel.value); });
        return sel;
    };

    // Подсказка «сколько сейчас на этом складе».
    AtexIntake.prototype.stockHint = function(item, warehouseId) {
        if (!item || !warehouseId) return null;
        var card = findCard(this.cards, item, warehouseId);
        if (!card) return 'На складе карточки нет — приход её заведёт';
        if (needsQtyMigration(card)) return 'Количество не перенесено в «Кол-во» — операции по карточке заблокированы';
        return 'Сейчас на складе: ' + formatQty(cardQuantity(card, item)) + ' ' + unitLabel(unitOfItem(item));
    };

    // Предпросмотр: либо список ошибок, либо «склад: было → стало» по каждому шагу.
    AtexIntake.prototype.renderPreview = function() {
        var self = this;
        var box = this.previewEl;
        if (!box) return;
        box.innerHTML = '';
        var f = this.form;
        var item = this.formItem();
        // Пока объект и количество не заданы, ошибки-заглушки не показываем.
        if (!item || !(toNumber(f.quantity) > 0)) return;

        var plan = this.currentPlan();
        if (plan.errors.length) {
            plan.errors.forEach(function(text) {
                box.appendChild(el('div', { class: 'atex-in-preview-error', text: text }));
            });
            return;
        }
        var unit = unitLabel(unitOfItem(item));
        plan.steps.forEach(function(step) {
            box.appendChild(el('div', { class: 'atex-in-preview-step' }, [
                el('span', { class: 'atex-in-preview-wh', text: self.warehouseLabel(step.warehouseId) + ':' }),
                el('span', { text: formatQty(step.was) + ' → ' + formatQty(step.now) + ' ' + unit }),
                step.cardId ? null : el('span', { class: 'atex-in-preview-new', text: 'новая карточка' })
            ]));
        });
    };

    AtexIntake.prototype.renderJournal = function() {
        var box = this.journalEl;
        if (!box) return;
        box.innerHTML = '';
        box.appendChild(el('h3', { class: 'atex-in-journal-title', text: 'Последние движения' }));
        if (!this.meta.journal) {
            box.appendChild(el('div', { class: 'atex-in-empty', text: 'Журнал в этой базе не заведён' }));
            return;
        }
        if (!this.journal.length) {
            box.appendChild(el('div', { class: 'atex-in-empty', text: 'Движений пока нет' }));
            return;
        }
        this.journal.forEach(function(row) {
            var route = row.operation === OP_TITLE.move
                ? (row.fromLabel + ' → ' + row.toLabel)
                : (row.operation === OP_TITLE.in ? ('→ ' + row.toLabel) : (row.fromLabel + ' →'));
            box.appendChild(el('div', { class: 'atex-in-journal-row' }, [
                el('span', { class: 'atex-in-journal-when', text: formatStamp(row.at) }),
                el('span', { class: 'atex-in-journal-op', text: row.operation }),
                el('span', { class: 'atex-in-journal-item', text: row.itemLabel }),
                el('span', { class: 'atex-in-journal-route', text: route }),
                el('span', { class: 'atex-in-journal-qty', text: formatQty(row.quantity) + ' ' + (row.unitLabel || '') }),
                el('span', { class: 'atex-in-journal-why', text: [row.reason, row.note, row.user].filter(Boolean).join(' · ') })
            ]));
        });
    };

    // ── Проводка ──

    AtexIntake.prototype.submit = function() {
        var self = this;
        if (this.busy) return;
        var item = this.formItem();
        var plan = this.currentPlan();
        if (plan.errors.length) {
            this.notify(plan.errors[0], 'error');
            this.renderPreview();
            return;
        }

        var meta = this.meta.card;
        var unit = unitOfItem(item);
        var unitRefId = this.units[unit] || '';
        var at = plan.journal.at;

        this.setBusy(true);
        // Сначала списание с источника, потом зачисление в приёмник: при обрыве
        // связи сырьё не «размножится».
        var chain = plan.steps.reduce(function(acc, step) {
            return acc.then(function() {
                if (step.cardId) {
                    return self.post('_m_set/' + step.cardId + '?JSON',
                        cardQuantityFields(meta, item, step.now));
                }
                var params = buildCardCreateParams(meta, item, step.warehouseId, step.now, unitRefId, at);
                params.up = 1;
                return self.post('_m_new/' + meta.id + '?JSON', params);
            });
        }, Promise.resolve());

        chain.then(function() {
            if (!self.meta.journal) return null;
            var journal = plan.journal;
            journal.unitRefId = unitRefId;
            return self.post('_m_new/' + self.meta.journal.id + '?JSON',
                Object.assign({ up: 1 }, buildJournalFields(self.meta.journal, journal)));
        }).then(function() {
            return Promise.all([self.loadCards(), self.loadJournal()]);
        }).then(function() {
            self.setBusy(false);
            self.notify('Проведено · ' + OP_TITLE[self.form.op] + ' · ' +
                formatQty(plan.journal.quantity) + ' ' + unitLabel(unit) + ' · ' + item.label, 'success');
            self.newForm(self.form.op);
            self.render();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка проводки: ' + err.message, 'error');
            self.loadCards().then(function() { self.render(); });
        });
    };

    AtexIntake.prototype.setBusy = function(on) {
        this.busy = on;
        if (this.root) this.root.classList.toggle('is-busy', !!on);
    };

    // Уведомления без alert/confirm/prompt (раздел 8 гайда): встроенный тост,
    // либо общий MainAppController, если он доступен в main.html.
    AtexIntake.prototype.notify = function(message, kind) {
        if (kind === 'error' && typeof window !== 'undefined' && window.mainAppController &&
            typeof window.mainAppController.showErrorModal === 'function') {
            window.mainAppController.showErrorModal(message);
            return;
        }
        var toast = el('div', { class: 'atex-in-toast atex-in-toast-' + (kind || 'info'), text: message });
        (this.toastHost || document.body).appendChild(toast);
        setTimeout(function() { toast.classList.add('is-visible'); }, 10);
        setTimeout(function() {
            toast.classList.remove('is-visible');
            setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
        }, 4000);
    };

    AtexIntake.prototype.fatal = function(message) {
        this.root.innerHTML = '';
        this.root.appendChild(el('div', { class: 'atex-in-fatal', text: message }));
    };

    AtexIntake.prototype.start = function() {
        var self = this;
        this.root.innerHTML = '';
        var layout = el('div', { class: 'atex-in-layout' });

        var aside = el('aside', { class: 'atex-in-sidebar' }, [
            el('div', { class: 'atex-in-sidebar-head' }, [el('h2', { text: 'Остатки на складах' })])
        ]);
        this.filtersEl = el('div', { class: 'atex-in-filters' });
        aside.appendChild(this.filtersEl);
        this.summaryEl = el('div', { class: 'atex-in-summary' });
        aside.appendChild(this.summaryEl);
        this.listEl = el('div', { class: 'atex-in-list' });
        aside.appendChild(this.listEl);

        var main = el('section', { class: 'atex-in-main' });
        this.warnEl = el('div', { class: 'atex-in-warnings', hidden: 'hidden' });
        main.appendChild(this.warnEl);
        this.formEl = el('div', { class: 'atex-in-form', 'data-submit-scope': '' });
        main.appendChild(this.formEl);
        this.journalEl = el('div', { class: 'atex-in-journal' });
        main.appendChild(this.journalEl);

        layout.appendChild(aside);
        layout.appendChild(main);
        this.root.appendChild(layout);
        this.toastHost = this.root;

        this.newForm(OP.in);
        this.formEl.appendChild(el('div', { class: 'atex-in-loading', text: 'Загрузка…' }));

        return this.loadMetadata()
            .then(function() {
                return Promise.all([self.loadMaterials(), self.loadSleeves(), self.loadWarehouses(), self.loadUnits()]);
            })
            .then(function(results) {
                self.indexItems(results[0], results[1]);
                return Promise.all([self.loadCards(), self.loadJournal()]);
            })
            .then(function() {
                self.renderFilters();
                self.render();
            })
            .catch(function(err) { self.fatal('Ошибка инициализации: ' + err.message); });
    };

    function init() {
        if (typeof document === 'undefined') return;
        var root = document.getElementById('atex-intake');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        var controller = new AtexIntake(root);
        root._atexIntake = controller;
        controller.start();
    }

    return { calc: calc, helpers: helpers, Controller: AtexIntake, init: init };
});
