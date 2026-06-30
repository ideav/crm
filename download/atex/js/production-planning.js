// Рабочее место atex «Планирование производства» (роль Диспетчер).
//
// Создание производственной резки (слиттер, тип резки, партия сырья, дата
// плана, статус), очередь резок по слиттерам и привязка резки к позициям заказа
// через подчинённую таблицу «Обеспечение». Решение задачи ideav/crm#2913
// (часть #2903). Правила разработки рабочих мест — docs/WORKSPACE_DEVELOPMENT_GUIDE.md.
//
// Чтения очереди резок и их обеспечения берутся одним отчётом защищённого слоя
// `GET /{db}/report/cut_planning?JSON_KV` (Резка→Обеспечение→Позиция). Чистая
// `rowsToPlanning` разворачивает плоские строки в резки (dedup по `cut_id`) и
// обеспечения (строки с непустым `supply_id`) — один запрос вместо отдельных
// `object/`-чтений резок и обеспечения, резолв метаданных для чтения не нужен
// (правило: docs/integram-reports.md).
//
// Справочник позиций заказа (для привязки обеспечения) берётся отчётом
// `GET /{db}/report/positions_list?JSON_KV` (`rowsToPositions`): «Заказанное количество» —
// подчинённая таблица, прямое `object/`-чтение её не отдаёт. Партии сырья для
// формы создания резки берутся отчётом `report/material_batches?JSON_KV`
// (`rowsToBatches`). Справочник станков читается по имени из метаданных
// (`object/{table}?JSON_OBJ`, записей мало).
//
// Запись идёт прямыми командами `_m_*` (#2903): создание резки —
// `_m_new/{Задание в производство}` с главным значением `t{tableId}` (#3225).
// Резка снова является самостоятельной таблицей (#3185), а «Обеспечение»
// ссылается на неё реквизитом «Задание в производство» (#3504: таблица
// «Производственная резка» переименована в «Задание в производство»).
// ID таблиц и реквизитов для записи не хардкодятся: берутся по именам из
// `GET /{db}/metadata` (WORKSPACE_DEVELOPMENT_GUIDE.md, разделы 3 и 6).
//
// Чистое ядро (разбор записей, группировка очереди по слиттерам, фильтрация,
// сборка полей `t{reqId}`) вынесено в объект `planning` и экспортируется через
// module.exports для модульных тестов (experiments/atex-production-planning.test.js).

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.AtexProductionPlanning = api;
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
        cut: 'Задание в производство',   // #3504: таблица «Производственная резка» переименована
        supply: 'Обеспечение',
        slitter: 'Слиттер',
        materialBatch: 'Партия сырья',
        strip: 'Полоса',
        finishedBatch: 'Партия ГП',
        sleeveTask: 'Задание на втулки',
        settings: 'Настройка',
        maxStock: 'Максимальный запас',  // #3391: какие номенклатуры «Партии ГП» целесообразно нарезать впрок
        leader: 'Лидер',                 // #3569: справочник «Лидер» (1132) — резолв метки лидера в id для записи в задание
        downtime: 'Отпуск',              // #3764: подчинённая станку таблица «Отпуск» (122572) — окна простоя станка
        calendar: 'Календарь'            // #3788: таблица «Календарь» (123162) — праздничные/рабочие дни (исключения)
    };
    // #3764: реквизиты подчинённой «Отпуск» (up = Слиттер). Главное значение записи —
    // НАЧАЛО окна простоя (DATETIME, unix-сек); «Окончание» — конец окна (DATETIME);
    // «Примечания» — причина (ТО и т.п.). В это время автогенерация не ставит задания.
    var DOWNTIME_REQ = {
        end: 'Окончание',
        notes: 'Примечания'
    };
    // #3788: «Календарь» (123162, тип DATE). Главное значение записи — дата (ДД.ММ.ГГГГ);
    // реквизит «Тип дня» (ссылка) задаёт исключение из обычного правила выходных:
    //   «Праздничный день» — нерабочий (даже будни), «Рабочий день» — рабочий (даже Сб/Вс).
    // По умолчанию (нет записи в календаре) Сб/Вс — выходные, будни — рабочие.
    var CALENDAR_REQ = { dayType: 'Тип дня' };
    var DAY_TYPE_HOLIDAY = 'Праздничный день';
    var DAY_TYPE_WORKING = 'Рабочий день';
    // #3788: горизонт расчёта нерабочих дней расписания (дней вперёд от базы). Покрывает
    // годовой набор праздников; дальше плановой очереди не бывает.
    var CALENDAR_HORIZON_DAYS = 366;
    // Реквизиты «Максимального запаса» (#3391, table/67113). Главное значение записи —
    // максимально допустимый запас (число); реквизиты задают комбинацию параметров
    // «Партии ГП», для которой имеет смысл создавать запас. Резолв по имени.
    var MAX_STOCK_REQ = {
        material: 'Вид сырья',
        width: 'Ширина, мм',
        length: 'Длина, м',
        winding: 'Тип намотки',
        sleeve: 'Диаметр втулки',
        leader: 'Лидер'
    };
    // Реквизиты подчинённой «Полосы» (up = резка). Резолв по имени.
    var STRIP_REQ = {
        width: 'Ширина, мм',
        qty: 'Количество',
        purpose: 'Назначение',
        toStock: 'На склад'
    };
    // Реквизиты «Производственной резки» (Номер — главное значение, автонумер).
    var CUT_REQ = {
        slitter: 'Слиттер',
        materialBatch: 'Партия сырья',
        planDate: 'Дата план',
        status: 'Статус',
        notes: 'Примечания',
        sequence: 'Очередность',
        plannedRuns: 'Кол-во план',
        duration: 'Длительность, минут',
        timing: 'Тайминг',
        actualRuns: 'Кол-во факт',
        length: 'Метраж, м',
        winding: 'Тип намотки',
        leader: 'Лидер',         // #3569: ссылка на «Лидер» (82519); при планировании копируется из позиции
        material: 'Вид сырья',   // #3688: ссылка на «Вид сырья» (95358→1069); пишется при планировании — нужна prev_cut_setup
        fixed: 'Зафиксировано',  // #3508: булев флаг (id 81530, type 11) — задание нельзя менять/удалять
        knifeSetupMin: 'Наладка ножей, мин',      // #3698: расчётная наладка ножей (KNIFE), мин (id 96067)
        materialWindingMin: 'Сырье/намотка, мин', // #3698: расчётная смена сырья/намотки (MATERIAL_WINDING), мин (id 96069)
        cutAndLeader: 'Резка и Лидер',            // #3700: намотка («Длительность, минут») + лидер (BETWEEN_CUTS × резок), мин (id 96778)
        // #3892: ЯВНАЯ ссылка на голову цепочки дробления — id ПЕРВОГО сегмента логической резки
        // (id 196458, type 3/string). Все сегменты одной резки (голова + продолжения по дням)
        // несут одинаковый «ID первой части» = id головы; голова ссылается на саму себя. Заменяет
        // прежнюю эвристику continuationSignature (станок|сырьё|намотка|ножи + смежные дни),
        // которая рвалась при пустом «Виде сырья»/несовпадении сигнатуры (#3795/#3808/#3781) и
        // утекала делёными метражами/настройкой в очередь. Пустой (легаси-запись до миграции) →
        // откат на эвристику в mergeContinuationChains; следующее сохранение проставит маркер.
        firstPart: 'ID первой части'
    };
    var CUT_PLANNED_RUN_COLUMNS = [
        'cut_planned_runs',
        'cut_plan_runs',
        'cut_planned_qty',
        'cut_plan_qty',
        'cut_planned_count',
        'cut_plan_count',
        'cut_qty_plan'
    ];
    var CUT_DURATION_COLUMNS = ['cut_duration', 'cut_duration_min', 'cut_duration_minutes'];
    var CUT_TIMING_COLUMNS = ['cut_timing'];
    // #3698: хранимые активности переналадки (отчёт cut_planning — добавить колонки на сервере).
    var CUT_KNIFE_SETUP_COLUMNS = ['cut_knife_setup_min', 'cut_knife_setup', 'cut_setup_knife_min'];
    var CUT_MATERIAL_WINDING_COLUMNS = ['cut_material_winding_min', 'cut_material_setup_min', 'cut_setup_material_min'];
    // #3700: хранимое «Резка и Лидер» (намотка + лидер), в отчёте cut_planning — поле cut_time.
    var CUT_TIME_COLUMNS = ['cut_time', 'cut_cut_leader_min', 'cut_run_leader_min'];
    // #3892: «ID первой части» (голова цепочки) из отчёта cut_planning. Колонку на сервере в
    // отчёт добавить (как #3698 добавил cut_knife_setup_min); нет колонки → пусто → откат на
    // эвристику цепочки (mergeContinuationChains), запись маркера при этом не ломается.
    var CUT_FIRST_PART_COLUMNS = ['cut_first_part', 'cut_first_part_id', 'cut_head_id', 'cut_chain_head'];
    var CUT_RUN_LENGTH_COLUMNS = ['cut_length', 'cut_footage', 'cut_footage_m'];
    var SUPPLY_FOOTAGE_COLUMNS = ['supply_footage', 'supply_length', 'supply_length_m'];
    var CUT_WRITE_LABELS = {
        slitter: CUT_REQ.slitter,
        materialBatch: CUT_REQ.materialBatch,
        plannedRuns: CUT_REQ.plannedRuns,
        duration: CUT_REQ.duration,
        timing: CUT_REQ.timing,
        length: CUT_REQ.length,
        planDate: CUT_REQ.planDate,
        status: CUT_REQ.status,
        notes: CUT_REQ.notes,
        sequence: CUT_REQ.sequence,
        winding: CUT_REQ.winding,
        leader: CUT_REQ.leader   // #3569: лидер задания (ссылка)
    };
    // Реквизиты «Обеспечения» (up = позиция заказа).
    var SUPPLY_REQ = {
        footage: 'Метраж, м',
        cut: 'Задание в производство',   // #3504: реквизит-ссылка переименован вслед за таблицей
        finishedBatch: 'Партия ГП',
        rolls: 'Кол-во рулонов',
        active: 'В работе',   // #3242: «Активно» переименовано в «В работе»
        status: 'Статус'
    };
    // Реквизиты «Партии ГП» (#3242: состав резки, up = резка). Резолв по имени.
    // #3431: «Кол-во полос» = число полос за проход (геометрия раскроя, число ножей).
    // #3433: разделение план/факт рулонов:
    //   «Кол-во рулонов» — СПРОС (рулоны из связанного «Обеспечения», под заказ);
    //   «Кол-во план»    — план производства = полосы × число резок (проходов);
    //   «Кол-во факт»    — фактически произведённые рулоны (пишется в производстве/
    //                      на складе, может отличаться от плана из-за брака и пр.);
    //   «ID заказа»      — заказ, под который создана партия; пусто = в запас (склад).
    var FINISHED_BATCH_REQ = {
        width: 'Ширина, мм',
        strips: 'Кол-во полос',
        rolls: 'Кол-во рулонов',
        planned: 'Кол-во план',
        actual: 'Кол-во факт',
        orderId: 'ID заказа',
        footage: 'Метраж, м',
        active: 'В работе'
    };
    // #3242: «Кол-во план» переименовано в «Кол-во резок план» (fallback на старое имя).
    var CUT_PLANNED_RUNS_NAMES = ['Кол-во резок план', 'Кол-во план'];
    // #3340: реальная схема «Задача на втулки» (1080, up=позиция). Главное значение
    // (t1080) = запланированный старт (Unix, как у «Производственной резки»). Тип
    // втулки определяется родительской позицией («Диаметр втулки»), в задании его нет.
    var SLEEVE_TASK_REQ = {
        cutter: 'Втулкорез',     // ref → «Втулкорез»; по диаметру подходит только TC-20
        qty: 'Кол-во',           // плановое кол-во втулок (= кол-во рулонов позиции)
        batch: 'Партия сырья'    // FIFO-партия втулок (ref → «Партия сырья»)
    };
    var SLEEVE_CUTTER_NAME = 'TC-20'; // #3340: единственный подходящий втулкорез
    // Статусы — свободный текст (тип 3); фиксируем разумные наборы по дизайн-спеке.
    var CUT_STATUSES = ['Запланирована', 'В очереди', 'В работе', 'Готова', 'Отменена'];
    var SUPPLY_STATUSES = ['Зарезервировано', 'Выполнено', 'Отменено'];
    // Параметры раскладки cut-layout при генерации резок.
    var WINDOW_DAYS = 3;      // окно по сроку изготовления — позиции группируются в кластеры
    var DEFAULT_TOLERANCE_MM = 21; // допуск остатка джамбо по умолчанию (мм), если у «Вида сырья» «Допуск, мм» не задан

    // ───────────────────────── Чистое ядро ─────────────────────────

    // Разбор значения-ссылки из JSON_OBJ: «id:Подпись» → { id, label }.
    function parseRef(raw) {
        var m = String(raw == null ? '' : raw).match(/^(\d+):([\s\S]*)$/);
        return m ? { id: m[1], label: m[2] } : { id: null, label: String(raw == null ? '' : raw) };
    }

    // Разбор мультиссылки из JSON_OBJ: «id1,id2:Подпись1,Подпись2» → ['id1','id2'].
    // Часть до первого «:» — id через запятую; без «:» — весь raw как id-часть.
    // null / пустая строка → [].
    function parseMultiRefIds(raw) {
        var s = String(raw == null ? '' : raw);
        if (s.trim() === '') return [];
        var idsPart = s.indexOf(':') >= 0 ? s.slice(0, s.indexOf(':')) : s;
        return idsPart.split(',').map(function(x) { return x.trim(); }).filter(function(x) { return x !== ''; });
    }

    // Проверка: есть ли materialId в массиве stopMaterialIds (сравнение строковое).
    // Пустой materialId → false; пустой список → false.
    function isMaterialBlocked(stopMaterialIds, materialId) {
        var mid = String(materialId == null ? '' : materialId).trim();
        if (mid === '') return false;
        return (stopMaterialIds || []).some(function(id) { return String(id).trim() === mid; });
    }

    // alias таблицы/реквизита: берём из готового поля `alias`, иначе разбираем
    // `attrs` (JSON со свойством alias). Часть новых таблиц atex называется через
    // alias, а в `val` хранит техническое/главное значение (#3159, #3189).
    function aliasOf(entry) {
        if (!entry) return '';
        if (entry.alias != null && entry.alias !== '') return String(entry.alias);
        if (entry.attrs) {
            try {
                var attrs = typeof entry.attrs === 'string' ? JSON.parse(entry.attrs) : entry.attrs;
                if (attrs && attrs.alias != null) return String(attrs.alias);
            } catch (e) { /* attrs не JSON — alias нет */ }
        }
        return '';
    }

    // Совпадение метасущности с именем по `val` или `alias`.
    function matchesName(entry, name) {
        if (!entry) return false;
        var target = String(name == null ? '' : name).trim().toLowerCase();
        if (target === '') return false;
        if (String(entry.val == null ? '' : entry.val).trim().toLowerCase() === target) return true;
        return aliasOf(entry).trim().toLowerCase() === target;
    }

    // Таблица из массива метаданных по имени (val/alias); нет → null.
    function tableByName(list, name) {
        var arr = Array.isArray(list) ? list : (list == null ? [] : [list]);
        for (var i = 0; i < arr.length; i++) {
            if (matchesName(arr[i], name)) return arr[i];
        }
        return null;
    }

    // Значение реквизита из метаданных по имени (val/alias) → его числовой id.
    function reqByName(meta, name) {
        return tableByName((meta && meta.reqs) || [], name);
    }

    function reqIdByName(meta, name) {
        var found = reqByName(meta, name);
        return found ? String(found.id) : null;
    }

    // Первый найденный reqId по списку имён-синонимов (для переименованных колонок).
    function reqIdByAnyName(meta, names) {
        for (var i = 0; i < (names || []).length; i++) {
            var id = reqIdByName(meta, names[i]);
            if (id) return id;
        }
        return null;
    }

    // Как «Обеспечение» связано с «Производственной резкой» в текущей метасхеме:
    // reference — поле-ссылка. Child-array из временной схемы #3180 не используем:
    // по #3185 резка снова самостоятельная таблица.
    function supplyCutRelation(supplyMeta, cutMeta) {
        var req = reqByName(supplyMeta, SUPPLY_REQ.cut) || reqByName(supplyMeta, 'Производственная резка'); // #3504: старое имя запасным
        if (!req) return { mode: 'none', reqId: null, arrId: null };
        var arrId = req.arr_id == null ? null : String(req.arr_id);
        if (arrId) return { mode: 'none', reqId: null, arrId: arrId };
        return { mode: 'reference', reqId: req.id == null ? null : String(req.id), arrId: null };
    }

    // Поля записи «Обеспечение» для привязки/создания резки.
    function buildSupplyFieldsForCut(supplyMeta, cutMeta, values) {
        var relation = supplyCutRelation(supplyMeta, cutMeta);
        var reqIds = {
            footage: reqIdByName(supplyMeta, SUPPLY_REQ.footage),
            active: activeReqId(supplyMeta),
            cut: relation.mode === 'reference' ? relation.reqId : null,
            rolls: reqIdByName(supplyMeta, SUPPLY_REQ.rolls)
        };
        reqIds.status = reqIdByName(supplyMeta, SUPPLY_REQ.status);
        return buildFields(reqIds, {
            footage: values && values.footage,
            rolls: values && values.rolls,
            active: values && values.active,
            status: values && values.status,
            cut: values && values.cutId
        });
    }

    // #3431/#3433: ПЛАН производства «Партии ГП» = «Кол-во полос» (за проход) × число
    // резок (повторов = «Кол-во резок план»). Пишется в «Кол-во план». Пусто/0 полос →
    // '' (поле не пишем). Без проходов (0) план = полосам (фолбэк, чтобы не записать 0).
    function finishedBatchRolls(stripsPerPass, plannedRuns) {
        var s = stripNum(stripsPerPass);
        if (!(s > 0)) return '';
        var runs = stripNum(plannedRuns);
        return round3(s * (runs > 0 ? runs : 1));
    }

    // #3433/#3435: «ID заказа» партии = заказы покрытых позиций (под заказ). Партия,
    // покрывающая спрос, ДОЛЖНА иметь непустой «ID заказа», иначе её ошибочно сочтут
    // свободной (запас) и переиспользуют. Один заказ → его id; несколько разных →
    // через запятую (партия делится между заказами); спроса нет (запас) → '' (заполнится
    // при подхватывании свободной партии). orderIds — список id заказов покрытых позиций.
    function batchOrderId(orderIds) {
        var seen = [];
        var list = orderIds || [];
        for (var i = 0; i < list.length; i++) {
            var id = String(list[i] == null ? '' : list[i]).trim();
            if (id !== '' && seen.indexOf(id) === -1) seen.push(id);
        }
        return seen.join(',');
    }

    // #3242/#3431/#3433: поля записи «Партия ГП» (состав резки): Ширина, Кол-во полос
    // (за проход), Кол-во рулонов (спрос), Кол-во план (полосы × проходов), Кол-во факт
    // (факт производства), ID заказа, Метраж, «В работе». Пустые значения и колонки,
    // отсутствующие в метаданных (старое окружение), просто пропускаются (buildFields).
    function buildFinishedBatchFields(finishedBatchMeta, values) {
        var reqIds = {
            width: reqIdByName(finishedBatchMeta, FINISHED_BATCH_REQ.width),
            strips: reqIdByName(finishedBatchMeta, FINISHED_BATCH_REQ.strips),
            rolls: reqIdByName(finishedBatchMeta, FINISHED_BATCH_REQ.rolls),
            planned: reqIdByName(finishedBatchMeta, FINISHED_BATCH_REQ.planned),
            actual: reqIdByName(finishedBatchMeta, FINISHED_BATCH_REQ.actual),
            orderId: reqIdByName(finishedBatchMeta, FINISHED_BATCH_REQ.orderId),
            footage: reqIdByName(finishedBatchMeta, FINISHED_BATCH_REQ.footage),
            active: activeReqId(finishedBatchMeta)
        };
        return buildFields(reqIds, {
            width: values && values.width,
            strips: values && values.strips,
            rolls: values && values.rolls,
            planned: values && values.planned,
            actual: values && values.actual,
            orderId: values && values.orderId,
            footage: values && values.footage,
            active: values && values.active
        });
    }

    // #3242: поля записи «Обеспечение» со ссылкой на «Партию ГП» (вместо ссылки на резку):
    // Метраж, Кол-во рулонов, «В работе», Статус, ссылка на «Партию ГП».
    function buildSupplyFieldsForFinishedBatch(supplyMeta, values) {
        var reqIds = {
            footage: reqIdByName(supplyMeta, SUPPLY_REQ.footage),
            rolls: reqIdByName(supplyMeta, SUPPLY_REQ.rolls),
            active: activeReqId(supplyMeta),
            status: reqIdByName(supplyMeta, SUPPLY_REQ.status),
            finishedBatch: reqIdByName(supplyMeta, SUPPLY_REQ.finishedBatch)
        };
        return buildFields(reqIds, {
            footage: values && values.footage,
            rolls: values && values.rolls,
            active: values && values.active,
            status: values && values.status,
            finishedBatch: values && values.finishedBatchId
        });
    }

    // Резка самостоятельная, поэтому одна раскладка может покрывать несколько позиций.
    function layoutPositionGroups(positions) {
        var list = (positions || []).slice();
        if (!list.length) return [];
        var groups = {}, order = [];
        list.forEach(function(p) {
            var key = String(p && p.sleeveId != null ? p.sleeveId : '');
            if (!groups[key]) { groups[key] = []; order.push(key); }
            groups[key].push(p);
        });
        return order.map(function(k) { return groups[k]; });
    }
    
    // Индекс колонки реквизита в строке JSON_OBJ. Колонки идут в порядке:
    // [главное значение, ...reqs в порядке метаданных].
    function columnIndex(meta, reqName) {
        if (!meta) return -1;
        var order = [String(meta.id)].concat((meta.reqs || []).map(function(r) { return String(r.id); }));
        var rid = reqIdByName(meta, reqName);
        return rid == null ? -1 : order.indexOf(String(rid));
    }

    // Преобразование записи «Производственной резки» в плоский объект для UI.
    // record — { i, r:[...] }, meta — метаданные таблицы.
    function mapCutRecord(record, meta) {
        var r = (record && record.r) || [];
        function ref(reqName) {
            var idx = columnIndex(meta, reqName);
            return idx >= 0 ? parseRef(r[idx]) : { id: null, label: '' };
        }
        function val(reqName) {
            var idx = columnIndex(meta, reqName);
            return idx >= 0 ? (r[idx] == null ? '' : String(r[idx])) : '';
        }
        var seqRaw = val(CUT_REQ.sequence);
        return {
            id: String(record && record.i),
            number: r[0] == null ? '' : String(r[0]),
            slitter: ref(CUT_REQ.slitter),
            materialBatch: ref(CUT_REQ.materialBatch),
            planDate: val(CUT_REQ.planDate),
            status: val(CUT_REQ.status),
            sequence: (seqRaw === '' || seqRaw == null) ? null : Number(seqRaw)
        };
    }

    // Группировка резок в очереди по слиттерам. Возвращает массив
    // [{ slitter:{id,label}, cuts:[...] }], отсортированный по подписи слиттера;
    // резки без слиттера попадают в группу с id=null («Без слиттера»).
    function groupBySlitter(cuts) {
        var groups = {};
        var order = [];
        (cuts || []).forEach(function(c) {
            var s = c.slitter || { id: null, label: '' };
            var key = s.id == null ? '\u0000none' : String(s.id);
            if (!groups[key]) {
                groups[key] = { slitter: { id: s.id, label: s.label || (s.id == null ? 'Без станка' : '#' + s.id) }, cuts: [] };
                order.push(key);
            }
            groups[key].cuts.push(c);
        });
        // Сортировка резок внутри каждой группы: день плана, затем сохранённая
        // sequence (возр., null/NaN — в конец), затем ножи по убыванию как
        // fallback для ещё не пронумерованных резок. Sequence теперь сбрасывается
        // на каждый день, поэтому дата нужна, чтобы одинаковые номера разных дней
        // не перемешивались при снятом фильтре даты.
        function seqKey(c) { var s = c && c.sequence; var n = Number(s); return (s == null || isNaN(n)) ? Infinity : n; }
        function knifeKey(c) { var n = Number(c && c.knifeCount); return isFinite(n) ? n : 0; }
        function cmpCutPlanDay(a, b) {
            // #3258: planDate — unix-штамп DATETIME (с секундами). Сравниваем по
            // КАЛЕНДАРНОМУ дню (planDateDayKey), иначе резки одного дня различаются по
            // моменту создания и сортировка «ножи по убыванию» (#3130) не срабатывает.
            var ak = planDateDayKey(a && a.planDate), bk = planDateDayKey(b && b.planDate);
            if (ak === Infinity && bk !== Infinity) return 1;
            if (bk === Infinity && ak !== Infinity) return -1;
            if (ak < bk) return -1;
            if (ak > bk) return 1;
            return 0;
        }
        Object.keys(groups).forEach(function(k) {
            groups[k].cuts = groups[k].cuts.map(function(c, i) { return { c: c, i: i }; })
                .sort(function(a, b) {
                    return cmpCutPlanDay(a.c, b.c)
                        || seqKey(a.c) - seqKey(b.c)
                        || (knifeKey(b.c) - knifeKey(a.c))
                        || a.i - b.i;
                })
                .map(function(x) { return x.c; });
        });
        return order
            .map(function(k) { return groups[k]; })
            .sort(function(a, b) {
                // Группа «без слиттера» — в конец, остальные по подписи.
                if (a.slitter.id == null) return 1;
                if (b.slitter.id == null) return -1;
                return String(a.slitter.label).localeCompare(String(b.slitter.label), 'ru');
            });
    }

    // #3535: вкладки очереди по станкам. Возвращает [{ slitter:{id,label}, cuts }]
    // для КАЖДОГО станка справочника (slitters) в порядке справочника — даже если
    // у станка нет резок в этот день (тогда cuts:[]). Иначе вкладки «съезжают» и
    // человек принимает первую вкладку за первый станок. Группы groupBySlitter с
    // резками без станка (id=null) или с удалённым из справочника станком
    // дописываются в конце в порядке groupBySlitter, чтобы не потерять задания.
    //   slitters — справочник [{ id, label, ... }];
    //   groups   — результат groupBySlitter(filtered).
    function mergeStationTabs(slitters, groups) {
        // id станков — числовые строки, поэтому строковый sentinel для «без станка»
        // (id=null) с ними не коллизит; ключ внутренний, наружу не уходит.
        function key(g) { return g.slitter.id == null ? 'no-station' : String(g.slitter.id); }
        var byKey = {};
        (groups || []).forEach(function(g) { byKey[key(g)] = g; });
        var tabs = [];
        var seen = {};
        (slitters || []).forEach(function(s) {
            var k = String(s.id);
            seen[k] = true;
            tabs.push(byKey[k] || { slitter: { id: s.id, label: s.label }, cuts: [] });
        });
        (groups || []).forEach(function(g) {
            if (!seen[key(g)]) tabs.push(g);
        });
        return tabs;
    }

    // Фильтр очереди по слиттеру и статусу (пустой фильтр = «все»).
    function filterCuts(cuts, filters) {
        var f = filters || {};
        var slitter = f.slitter == null ? '' : String(f.slitter).trim();
        var status = f.status == null ? '' : String(f.status).trim();
        return (cuts || []).filter(function(c) {
            if (slitter && String((c.slitter && c.slitter.id) || '') !== slitter) return false;
            if (status && String(c.status || '').trim() !== status) return false;
            return true;
        });
    }

    // #3411: быстрый поиск по очереди резок. Сводит резку к строке поиска: название
    // сырья, номер, намотка, статус и подписи связанных позиций (linkedLabels — из
    // rowsToPositions, напр. «1234/5 · 600мм * 1000м»). Совпадение — вхождение КАЖДОГО
    // слова запроса (регистронезависимо), пустой запрос совпадает со всем. Чистая
    // функция — связи передаются параметром, чтобы тестировать без контроллера.
    function cutSearchHaystack(cut, linkedLabels) {
        var parts = [];
        if (cut) {
            if (cut.materialName) parts.push(String(cut.materialName));
            if (cut.materialId != null && cut.materialId !== '') parts.push('#' + cut.materialId);
            if (cut.number != null && cut.number !== '') parts.push(String(cut.number));
            if (cut.winding != null && cut.winding !== '') parts.push(String(cut.winding));
            if (cut.status != null && cut.status !== '') parts.push(String(cut.status));
        }
        (linkedLabels || []).forEach(function(l) { if (l != null && l !== '') parts.push(String(l)); });
        return parts.join(' ').toLowerCase();
    }

    function cutMatchesQuery(cut, query, linkedLabels) {
        var q = String(query == null ? '' : query).trim().toLowerCase();
        if (q === '') return true;
        var hay = cutSearchHaystack(cut, linkedLabels);
        return q.split(/\s+/).every(function(tok) { return tok === '' || hay.indexOf(tok) !== -1; });
    }

    // Видимость резки в очереди диспетчера (за сегодня и позже / по выбранной дате).
    // Резка показывается, если ВСЕ условия выполнены:
    //  1) статус не «Завершён» (выполненные резки в очередь не показываем);
    //  2) «Дата план» совпадает с выбранной датой ИЛИ пустая (ещё не запланирована —
    //     напр. только что сгенерированная резка). selectedDate пустая → дата не фильтрует.
    // Согласование заказа/позиции фильтрует создание новых резок, но уже попавшие в
    // cut_planning резки считаются рабочей очередью (#3209: очищенная новая модель).
    // Форматы дат разные («ДД.ММ.ГГГГ» из отчёта, «ГГГГ-ММ-ДД» из <input type=date>) —
    // нормализуем общим batchDateKey.
    // Календарный день плановой даты как YYYYMMDD (#3249). «Дата план» — первая колонка
    // «Производственной резки» (DATETIME) и приходит unix-штампом (секунды/мс), а фильтр
    // <input type=date> даёт «ГГГГ-ММ-ДД». batchDateKey сводит дату-строку к YYYYMMDD, но
    // unix-штамп (≈1.7e9) к нему несравним — приводим штамп к календарному дню той же шкалы.
    function planDateDayKey(value) {
        var s = String(value == null ? '' : value).trim();
        if (s === '') return Infinity;
        if (/^\d{9,13}$/.test(s)) {
            var num = Number(s);
            var ms = num >= 1e12 ? num : num * 1000;
            var d = new Date(ms);
            var year = d.getFullYear();
            if (!isNaN(d.getTime()) && year >= 2001 && year <= 2100) {
                return year * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
            }
        }
        return batchDateKey(s);
    }

    // #3652: смещение РАБОЧЕГО ДНЯ резки относительно базы расписания (планБаза = день
    // фильтра «С»), в днях. Нужно, чтобы buildSchedule привязывал резку к её «Дате план», а
    // не паковал встык от дня «С»: при ДИАПАЗОНЕ дат задания 30.05 не должны ложиться под
    // 20.05. Пустая «Дата план» → null (без якоря: день 0, как раньше). Считаем по полуночи
    // календарного дня (как planDateDayKey), чтобы час старта не сбивал день.
    function dayOffsetFromBase(planDate, baseMidnightMs) {
        var base = Number(baseMidnightMs);
        if (!isFinite(base)) return null;
        var s = String(planDate == null ? '' : planDate).trim();
        if (s === '') return null;
        var ms;
        if (/^\d{9,13}$/.test(s)) { var num = Number(s); ms = num >= 1e12 ? num : num * 1000; }
        else {
            var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
            if (!m) return null;
            ms = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0).getTime();
        }
        var d = new Date(ms);
        if (isNaN(d.getTime())) return null;
        var cutMid = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
        return Math.round((cutMid - base) / 86400000);
    }

    // #3815: «Срок изготовления» (dueKey, YYYYMMDD) → смещение дня от базы — той же базой и в той
    // же (локальной) полночи, что dayOffsetFromBase для «Даты план», поэтому смещения напрямую
    // сравнимы. Нет срока/Infinity/невалидный/нет базы → null.
    function dueDayOffsetFromBase(dueKey, baseMidnightMs) {
        var k = Number(dueKey);
        if (!isFinite(k) || k < 10000101 || k > 99991231) return null;
        var y = Math.floor(k / 10000), m = Math.floor(k / 100) % 100, d = k % 100;
        if (m < 1 || m > 12 || d < 1 || d > 31) return null;
        var iso = y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
        return dayOffsetFromBase(iso, baseMidnightMs);
    }

    // #3599: видимость по ДИАПАЗОНУ дат [dateFrom; dateTo] (раньше — один день). Пустые
    // оба → дата не фильтрует; задан один край → открытый интервал. Резка без «Дата план»
    // (ещё не запланирована) видна всегда. Сравнение по календарному дню (planDateDayKey).
    function isCutVisible(cut, dateFrom, dateTo) {
        if (!cut) return false;
        if (String(cut.status || '').trim() === 'Завершён') return false;
        var pd = String(cut.planDate || '').trim();
        if (pd === '') return true;
        var fromStr = String(dateFrom == null ? '' : dateFrom).trim();
        var toStr = String(dateTo == null ? '' : dateTo).trim();
        if (fromStr === '' && toStr === '') return true;
        var pk = planDateDayKey(pd);
        var fromK = fromStr === '' ? -Infinity : planDateDayKey(fromStr);
        var toK = toStr === '' ? Infinity : planDateDayKey(toStr);
        if (fromK > toK) { var t = fromK; fromK = toK; toK = t; }  // «По» раньше «С» → меняем местами
        return pk >= fromK && pk <= toK;
    }

    // #3475/#3622: задания и обеспечения для кнопки «Удалить». Берём резки с непустой
    // плановой датой В ДИАПАЗОНЕ фильтра [dateFrom; dateTo] — тот же набор, что показан в
    // очереди (isCutVisible, #3599). До #3622 отбирали только один день (dateFrom), из-за
    // чего при выбранном диапазоне «Удалить» не находило видимых заданий, чья «Дата план»
    // приходилась на другой день диапазона («нет заданий для удаления, хотя вот они»).
    // Незавершённые, незафиксированные (#3508 п.3), датированные. Обеспечения — все, чьё
    // cutId входит в набор. Чистая функция — покрывается тестами. dateTo пуст → один день
    // dateFrom (без перелива в соседние).
    function dayDeletionTargets(cuts, supplies, dateFrom, dateTo) {
        var fromStr = String(dateFrom == null ? '' : dateFrom).trim();
        var toStr = String(dateTo == null ? '' : dateTo).trim();
        if (fromStr === '') return { cuts: [], supplies: [] };
        if (toStr === '') toStr = fromStr;
        var dayCuts = (cuts || []).filter(function(c) {
            if (!c) return false;
            if (c.fixed) return false;   // #3508 п.3: зафиксированные при удалении пропускаем
            if (String(c.planDate || '').trim() === '') return false;   // недатированные к диапазону не относим
            return isCutVisible(c, fromStr, toStr);   // #3599: тот же диапазон, что и видимость очереди (отсеивает «Завершён»)
        });
        var cutIds = {};
        dayCuts.forEach(function(c) { cutIds[String(c.id)] = true; });
        var daySupplies = (supplies || []).filter(function(s) {
            return s && cutIds[String(s.cutId)] === true;
        });
        return { cuts: dayCuts, supplies: daySupplies };
    }

    // #3486: строки отчёта 81463 (cut → fulfillment, JSON_KV) → массив id «Обеспечений»
    // удаляемой резки. Отчёт фильтруется серверно (FR_cutID), но если cutId передан —
    // подстраховываемся и отбрасываем чужие строки. Берём колонку fulfillmentID,
    // дедуплицируем и пропускаем пустые. Чистая функция — покрывается тестами.
    function fulfillmentIdsFromRows(rows, cutId) {
        var want = (cutId == null || cutId === '') ? null : String(cutId);
        var seen = {};
        var out = [];
        (rows || []).forEach(function(row) {
            if (!row) return;
            if (want != null) {
                var rc = row.cutID != null ? row.cutID : (row.cut_id != null ? row.cut_id : row.cutId);
                if (rc != null && rc !== '' && String(rc) !== want) return;
            }
            var fid = row.fulfillmentID != null ? row.fulfillmentID
                    : (row.fulfillment_id != null ? row.fulfillment_id : row.fulfillmentId);
            fid = (fid == null) ? '' : String(fid).trim();
            if (fid === '' || fid === 'null' || seen[fid]) return;
            seen[fid] = true;
            out.push(fid);
        });
        return out;
    }

    // #3691: id «Обеспечений» резки из УЖЕ ЗАГРУЖЕННЫХ supplies (this.supplies из cut_planning,
    // у каждого есть cutId). Отчёт 81463 (cut→fulfillment) оказался ненадёжным (зависел от
    // совпадения дат резки/Партии ГП/Обеспечения и возвращал пусто) → удаление резки слало
    // _m_del, не сняв ссылки Обеспечений на Партии ГП → 409. Берём связи из состояния очереди,
    // дедупликация по id, пустые/чужие пропускаем. Чистая функция — покрывается тестами.
    function cutFulfillmentIds(supplies, cutId) {
        var want = (cutId == null || cutId === '') ? null : String(cutId);
        var seen = {};
        var out = [];
        (supplies || []).forEach(function(s) {
            if (!s) return;
            if (want != null && String(s.cutId == null ? '' : s.cutId) !== want) return;
            var fid = (s.id == null) ? '' : String(s.id).trim();
            if (fid === '' || fid === 'null' || seen[fid]) return;
            seen[fid] = true;
            out.push(fid);
        });
        return out;
    }

    // Сообщение об ошибке из ответа API. Команды `_m_*` и отчёты при отказе отдают
    // `[{"error":"…"}]` (массив; см. my_die/api_dump в index.php) с HTTP-кодом 4xx,
    // успех — данные без ключа `error`. Разворачиваем обе формы (массив-обёртку и
    // объект), `err` поддерживаем синонимом. Пусто — ошибки нет. Вызывать только при
    // !resp.ok, чтобы строки данных с колонкой «error» не принять за сбой. Чистая —
    // покрывается тестом.
    function extractApiError(result) {
        var obj = Array.isArray(result) ? result[0] : result;
        if (!obj || typeof obj !== 'object') return '';
        var msg = obj.error != null ? obj.error : (obj.err != null ? obj.err : '');
        return msg == null ? '' : String(msg).trim();
    }

    // Текущая дата как «ГГГГ-ММ-ДД» для <input type=date> (только браузер).
    function todayISO() {
        var d = new Date();
        var m = String(d.getMonth() + 1); if (m.length < 2) m = '0' + m;
        var day = String(d.getDate()); if (day.length < 2) day = '0' + day;
        return d.getFullYear() + '-' + m + '-' + day;
    }

    // #3602: миллисекунды → «ГГГГ-ММ-ДД» (локальный день) для значения фильтра дат.
    function isoDateFromMs(ms) {
        var d = new Date(Number(ms));
        if (isNaN(d.getTime())) return '';
        var m = String(d.getMonth() + 1); if (m.length < 2) m = '0' + m;
        var day = String(d.getDate()); if (day.length < 2) day = '0' + day;
        return d.getFullYear() + '-' + m + '-' + day;
    }

    // #3508 п.1: сдвиг даты фильтра «ГГГГ-ММ-ДД» на ±N дней (стрелки листания).
    // Пустую/чужую дату трактуем как сегодня — первый клик задаёт конкретный день.
    function shiftPlanDate(dateStr, deltaDays) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
        var d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0) : new Date();
        d.setDate(d.getDate() + deltaDays);
        var mm = String(d.getMonth() + 1); if (mm.length < 2) mm = '0' + mm;
        var dd = String(d.getDate()); if (dd.length < 2) dd = '0' + dd;
        return d.getFullYear() + '-' + mm + '-' + dd;
    }

    // #3475: «ГГГГ-ММ-ДД» → «ДД.ММ.ГГГГ» для подписей (подтверждение/тост удаления дня).
    // Чужой формат не трогаем — возвращаем как есть.
    function formatPlanDayLabel(dateStr) {
        var s = String(dateStr == null ? '' : dateStr).trim();
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        return m ? (m[3] + '.' + m[2] + '.' + m[1]) : s;
    }

    // #3622: подпись диапазона дат плана для тостов/подтверждений: «ДД.ММ.ГГГГ» для
    // одного дня (или пустого «По»), «ДД.ММ.ГГГГ – ДД.ММ.ГГГГ» для диапазона.
    function formatPlanDayRangeLabel(dateFrom, dateTo) {
        var from = formatPlanDayLabel(dateFrom);
        var to = formatPlanDayLabel(dateTo);
        if (from === '') return to;
        if (to === '' || to === from) return from;
        return from + ' – ' + to;
    }

    // #3616: дата-заголовок рабочего дня очереди. baseMidnightMs — полночь дня 0 расписания
    // (planBaseMidnightFrom: день фильтра), dayOffset — номер дня расписания (schedDay).
    // → «Пн, 23.06.2026». Пусто при нечисловой базе. Чистая → покрывается тестом.
    function formatPlanDayHeading(baseMidnightMs, dayOffset) {
        if (baseMidnightMs == null || baseMidnightMs === '') return '';
        var base = Number(baseMidnightMs);
        if (!isFinite(base)) return '';
        var d = new Date(base + (Number(dayOffset) || 0) * 86400000);
        if (isNaN(d.getTime())) return '';
        var wd = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][d.getDay()];
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        return wd + ', ' + pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
    }

    // Полночь (мс) базовой даты планирования: дата из фильтра «.atex-pp-input»
    // («ГГГГ-ММ-ДД»), даже если в прошлом; без выбранной даты — сегодня (nowMs).
    function planBaseMidnightFrom(dateStr, nowMs) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
        var d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0)
                  : new Date(Number(nowMs) || Date.now());
        return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
    }

    // #3764: unix-секунды → значение `<input type="datetime-local">` («ГГГГ-ММ-ДДTЧЧ:ММ»,
    // локальное время — как и отображение DATETIME через new Date(sec*1000)). Пусто/мусор → ''.
    function unixToDatetimeLocal(sec) {
        var n = Number(sec);
        if (!isFinite(n) || n <= 0) return '';
        var d = new Date(n * 1000);
        if (isNaN(d.getTime())) return '';
        function pad(x) { return (x < 10 ? '0' : '') + x; }
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
            'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    // #3764: значение `<input type="datetime-local">` → unix-секунды (локальное время). null —
    // пусто/нераспознано. Секунды обнуляем (поле даёт минутную точность).
    function datetimeLocalToUnix(value) {
        var s = String(value == null ? '' : value).trim();
        var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
        if (!m) return null;
        var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
        if (isNaN(d.getTime())) return null;
        return Math.floor(d.getTime() / 1000);
    }

    // #3787: unix-секунды → «DD.MM.YYYY» (время дописываем, только если не полночь — отпуск
    // обычно цельными днями, «00:00» был бы шумом). Пусто/мусор → ''.
    function formatDowntimeBound(sec) {
        var n = Number(sec);
        if (!isFinite(n) || n <= 0) return '';
        var d = new Date(n * 1000);
        if (isNaN(d.getTime())) return '';
        function pad(x) { return (x < 10 ? '0' : '') + x; }
        var s = pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
        if (d.getHours() || d.getMinutes()) s += ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        return s;
    }

    // #3787: «ГГГГ-ММ-ДД» → полночь (мс, локально); null при нераспознанном (без подмены «сегодня»).
    function isoDayMidnightMs(dateStr) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
        if (!m) return null;
        return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0).getTime();
    }

    // #3787: подпись об отпуске(ах) станка, пересекающих отображаемый диапазон [dateFrom; dateTo]
    // (фильтр «Дата плана», 'ГГГГ-ММ-ДД'; пустой dateTo = один день dateFrom). downtimes — строки
    // окон простоя [{ start, end, notes }] (unix-сек, как this.downtimesBySlitter[slitterId]).
    // → «отпуск с DD.MM.YYYY по DD.MM.YYYY» (несколько — через запятую; причина из «Примечаний» в
    // скобках — «все детали»). Открытое окно (нет «Окончания») → «отпуск с DD.MM.YYYY». Нет
    // пересечений / нераспознанная дата → ''. Чистая — тестируется без DOM.
    function downtimeRangeNote(downtimes, dateFrom, dateTo) {
        var list = downtimes || [];
        if (!list.length) return '';
        var fromMs = isoDayMidnightMs(dateFrom);
        if (fromMs == null) return '';
        var toMid = isoDayMidnightMs(String(dateTo || '').trim() || dateFrom);
        var winEndMs = (toMid == null ? fromMs : toMid) + 86400000;   // конец последнего дня диапазона (исключит.)
        var parts = list.filter(function(d) {
            var startMs = (d && d.start != null && d.start !== '') ? Number(d.start) * 1000 : null;
            if (startMs == null || !isFinite(startMs)) return false;
            var endMs = (d.end != null && d.end !== '') ? Number(d.end) * 1000 : null;
            // пересечение [startMs; endMs|∞) с отображаемым окном [fromMs; winEndMs)
            return startMs < winEndMs && (endMs == null || endMs > fromMs);
        }).sort(function(a, b) {
            return (Number(a.start) || 0) - (Number(b.start) || 0);
        }).map(function(d) {
            var s = 'с ' + formatDowntimeBound(d.start);
            var e = formatDowntimeBound(d.end);
            if (e) s += ' по ' + e;
            var notes = d.notes == null ? '' : String(d.notes).trim();
            if (notes) s += ' (' + notes + ')';
            return s;
        });
        return parts.length ? ('отпуск ' + parts.join(', ')) : '';
    }

    // Сборка полей `t{reqId}` для записи. reqIds — { ключ: числовойId },
    // values — { ключ: значение }. Пустые значения (''/null/undefined) опускаются,
    // чтобы не перетирать данные и не плодить пустые реквизиты.
    function buildFields(reqIds, values) {
        var out = {};
        Object.keys(reqIds || {}).forEach(function(key) {
            var id = reqIds[key];
            if (id == null) return;
            var v = values ? values[key] : undefined;
            if (v === undefined || v === null || v === '') return;
            out['t' + id] = v;
        });
        return out;
    }

    function hasOwn(obj, key) {
        return Object.prototype.hasOwnProperty.call(obj || {}, key);
    }

    function rowsHaveAnyColumn(rows, names) {
        var list = rows || [];
        for (var i = 0; i < list.length; i++) {
            for (var j = 0; j < names.length; j++) {
                if (hasOwn(list[i], names[j])) return true;
            }
        }
        return false;
    }

    function cutPlanningReportDiagnostics(rows) {
        var list = rows || [];
        var hasCutRows = list.some(function(row) {
            return row && row.cut_id != null && String(row.cut_id).trim() !== '';
        });
        if (!hasCutRows) return [];
        var specs = [
            { key: 'plannedRuns', label: CUT_REQ.plannedRuns, columns: CUT_PLANNED_RUN_COLUMNS },
            { key: 'duration', label: CUT_REQ.duration, columns: CUT_DURATION_COLUMNS },
            { key: 'runLength', label: CUT_REQ.length + ' / ' + SUPPLY_REQ.footage, columns: CUT_RUN_LENGTH_COLUMNS.concat(SUPPLY_FOOTAGE_COLUMNS) }
        ];
        return specs.filter(function(spec) {
            return !rowsHaveAnyColumn(list, spec.columns);
        }).map(function(spec) {
            return {
                key: spec.key,
                label: spec.label,
                columns: spec.columns.slice(),
                reason: 'report-column',
                message: 'В отчёте cut_planning нет колонки для «' + spec.label + '» (' + spec.columns.join(' | ') + ')'
            };
        });
    }

    function cutWriteDiagnostics(reqIds, fields, requiredKeys, labels) {
        var out = [];
        (requiredKeys || []).forEach(function(key) {
            var id = reqIds && reqIds[key] != null ? String(reqIds[key]) : '';
            var label = (labels && labels[key]) || key;
            if (id === '') {
                out.push({
                    key: key,
                    label: label,
                    reason: 'metadata',
                    message: 'Не найден реквизит «' + label + '» в метаданных'
                });
                return;
            }
            var fieldKey = 't' + id;
            if (!hasOwn(fields, fieldKey)) {
                out.push({
                    key: key,
                    label: label,
                    reason: 'field',
                    field: fieldKey,
                    message: 'Не записано поле «' + label + '» (' + fieldKey + ')'
                });
            }
        });
        return out;
    }

    function cutWriteDiagnosticSummary(diagnostics) {
        return (diagnostics || []).map(function(d) { return d.message; }).join('; ');
    }

    // #3851: обязательные поля payload «Производственной резки». Обычная резка (есть
    // проходы) обязана нести намотку «Длительность, минут» и «Тайминг» — это страховка от
    // несконфигурированных норм намотки (иначе вся очередь «0 мин»). Сегмент НАСТРОЙКИ
    // (#3635 п.5: «настройка в хвосте дня N, проходы с дня N+1») создаётся с «Кол-во резок
    // план»=0; намотки у него нет, поэтому «Длительность, минут»/«Тайминг» пусты ПО ЗАМЫСЛУ
    // (расписание форсит его намотку в 0 по 0 проходов). Требовать их у него нельзя — иначе
    // генерация падает «Неполный payload задания» на хвостовом сегменте настройки.
    function cutCreateRequiredKeys(plannedRuns) {
        return (Number(plannedRuns) > 0)
            ? ['plannedRuns', 'duration', 'timing', 'length']
            : ['plannedRuns', 'length'];
    }

    function maxNumericCutNumber(cuts) {
        var max = 0;
        (cuts || []).forEach(function(cut) {
            var raw = cut && cut.number;
            if (raw == null || raw === '') return;
            var n = Number(String(raw).trim());
            if (isFinite(n) && n > max) max = n;
        });
        return max;
    }

    function nextCutMainValue(cuts, nowMs, state) {
        var ms = Number(nowMs);
        if (!isFinite(ms) || ms <= 0) ms = Date.now();
        var byTime = Math.floor(ms / 1000);
        var byExisting = maxNumericCutNumber(cuts) + 1;
        var byState = state && isFinite(Number(state.last)) ? Number(state.last) + 1 : 1;
        var value = Math.max(byTime, byExisting, byState);
        if (state) state.last = value;
        return value;
    }

    function addMainValueField(meta, fields, value) {
        var out = {};
        if (meta && meta.id != null && value !== undefined && value !== null && value !== '') {
            out['t' + meta.id] = value;
        }
        Object.keys(fields || {}).forEach(function(k) { out[k] = fields[k]; });
        return out;
    }

    function controllerNowMs(controller) {
        if (controller && typeof controller.nowMs === 'function') return controller.nowMs();
        return Date.now();
    }

    function traceCutCreatePayload(scope, meta, reqIds, fields, controller, requiredKeys) {
        var win = typeof window !== 'undefined' ? window : null;
        var diagnostics = cutWriteDiagnostics(reqIds, fields, requiredKeys || [], CUT_WRITE_LABELS);
        if (diagnostics.length && typeof console !== 'undefined' && console.error) {
            console.error('[pp] ❌ ' + scope + ': неполный payload резки — ' + cutWriteDiagnosticSummary(diagnostics), {
                diagnostics: diagnostics,
                fields: fields || {},
                reqIds: reqIds || {}
            });
        }
        var enabled = (controller && controller.traceCutPayloads) || (win && win.ATEX_PP_TRACE_PAYLOADS);
        if (!enabled) return diagnostics;
        if (typeof console === 'undefined' || !console.log) return diagnostics;
        var mainKey = meta && meta.id != null ? 't' + meta.id : '';
        var fieldKeys = Object.keys(fields || {}).sort();
        var missing = [];
        if (mainKey && !hasOwn(fields, mainKey)) {
            missing.push('main:' + mainKey);
        }
        Object.keys(reqIds || {}).forEach(function(key) {
            var id = reqIds[key];
            var fieldKey = id == null ? '' : 't' + id;
            if (fieldKey && !hasOwn(fields, fieldKey)) {
                missing.push(key + ':' + fieldKey);
            }
            if (!fieldKey) missing.push(key + ':metadata');
        });
        console.log('[pp] 🧾 ' + scope + ': _m_new/' + ((meta && meta.id) || '?') + ' поля', {
            main: mainKey ? (mainKey + '=' + ((fields || {})[mainKey] == null ? '' : (fields || {})[mainKey])) : '',
            fieldKeys: fieldKeys,
            missing: missing,
            diagnostics: diagnostics
        });
        return diagnostics;
    }

    // Плоские строки отчёта cut_planning (JSON_KV) → { cuts, supplies }.
    // Одна резка с N обеспечениями даёт N строк (LEFT JOIN) — резки dedup по
    // `cut_id`; обеспечения собираются из строк с непустым `supply_id`. Резки без
    // обеспечения (пустой `supply_id`) остаются в очереди и фантомных связей не
    // создают. Формы записей совпадают с прежними mapCutRecord/loadSupplies:
    // резка — { id, number, slitter:{id,label},
    // materialBatch:{id,label}, planDate, status }; обеспечение —
    // { id, positionId, cutId, finishedBatchId }.
    function rowsToPlanning(rows) {
        var cutsById = {};
        var order = [];
        var supplies = [];
        function str(v) { return v == null ? '' : String(v); }
        function rowValue(row, names) {
            for (var i = 0; i < names.length; i++) {
                if (row && row[names[i]] != null && row[names[i]] !== '') return row[names[i]];
            }
            return '';
        }
        function rowNum(row, names) {
            return stripNum(rowValue(row, names));
        }
        (rows || []).forEach(function(row) {
            var cutId = str(row.cut_id);
            if (cutId && !cutsById[cutId]) {
                var seqVal = row.cut_sequence;
                cutsById[cutId] = {
                    id: cutId,
                    // #3242: cut_no упразднён; «номер» резки = плановая дата начала
                    // (первая колонка «Производственной резки» — DATETIME, отчёт отдаёт cut_plan_date).
                    number: str(row.cut_plan_date),
                    slitter: { id: row.cut_slitter_id ? String(row.cut_slitter_id) : null, label: str(row.cut_slitter) },
                    // #3242: отдельной «партии сырья» в cut_planning больше нет (видна как
                    // cut_material/cut_jumbo_remaining). Отчётный batch_id — это «Партия ГП»
                    // (готовая продукция, по одной на полосу), не «партия сырья» → в batchId не кладём,
                    // иначе сломается оценка переналадки «смена партии» (changeoverParts).
                    materialBatch: { id: null, label: '' },
                    planDate: str(row.cut_plan_date),
                    status: str(row.cut_status),
                    sequence: (seqVal == null || seqVal === '') ? null : Number(seqVal),
                    fixed: false,   // #3508: уточняется из object/ в loadPlanning (отчёт флаг не отдаёт)
                    materialId: str(row.cut_material_id),
                    materialName: str(row.cut_material),
                    batchId: '',
                    jumboRemainingM: (row.cut_jumbo_remaining == null || row.cut_jumbo_remaining === '') ? 0 : Number(row.cut_jumbo_remaining),
                    knifeCount: (row.cut_knives == null || row.cut_knives === '') ? 0 : Number(row.cut_knives),
                    knifeWidths: [],
                    winding: normWinding(row.cut_winding),
                    rollerWidth: (row.cut_roller_width == null || row.cut_roller_width === '') ? 0 : Number(row.cut_roller_width),
                    length: rowNum(row, CUT_RUN_LENGTH_COLUMNS),
                    plannedRuns: rowNum(row, CUT_PLANNED_RUN_COLUMNS),
                    duration: rowNum(row, CUT_DURATION_COLUMNS),
                    timing: str(rowValue(row, CUT_TIMING_COLUMNS)),
                    // #3698: уже сохранённые активности переналадки ('' — колонки ещё нет/пусто),
                    // нужны для diff в persistCutSetupColumns (пишем только изменившиеся).
                    storedKnifeSetupMin: rowValue(row, CUT_KNIFE_SETUP_COLUMNS),
                    storedMaterialWindingMin: rowValue(row, CUT_MATERIAL_WINDING_COLUMNS),
                    storedCutAndLeaderMin: rowValue(row, CUT_TIME_COLUMNS),   // #3700: «Резка и Лидер» (cut_time)
                    // #3892: «ID первой части» (голова цепочки дробления). Пусто (нет колонки/легаси) →
                    // mergeContinuationChains откатывается на эвристику continuationSignature.
                    firstPartId: rowValue(row, CUT_FIRST_PART_COLUMNS),
                    isFoil: /фольг/i.test(str(row.cut_material)),
                    orderId: str(row.order_id),
                    orderApprovalDate: str(row.order_approval_date || row.item_approval_date),
                    // #3472: лидеры резки (из cut_leader по всем строкам). Новые резки —
                    // один лидер; легаси (до ограничения по лидеру) могут мешать несколько.
                    leaders: [],
                    // #3738: втулки резки (из cut_sleeve по всем строкам). Резка
                    // единодиаметровая (layoutPositionGroups разбивает позиции по втулке) —
                    // обычно одна; несколько (легаси-смешение) выделяем предупреждением.
                    sleeves: []
                };
                order.push(cutId);
            }
            if (cutId && cutsById[cutId]) {
                var leaderVal = str(row.cut_leader).trim();
                if (leaderVal && cutsById[cutId].leaders.indexOf(leaderVal) < 0) cutsById[cutId].leaders.push(leaderVal);
                // #3738: втулка из cut_sleeve (имя «Диаметр втулки» позиции). trim() —
                // в справочнике встречается ведущий таб у некоторых названий.
                var sleeveVal = str(row.cut_sleeve).trim();
                if (sleeveVal && cutsById[cutId].sleeves.indexOf(sleeveVal) < 0) cutsById[cutId].sleeves.push(sleeveVal);
            }
            var supplyId = str(row.supply_id);
            if (supplyId) {
                var finishedBatchId = str(rowValue(row, [
                    'supply_finished_batch_id',
                    'supply_gp_id',
                    'finished_batch_id',
                    'gp_id',
                    'supply_batch_id'
                ]));
                supplies.push({
                    id: supplyId,
                    positionId: row.supply_position_id ? String(row.supply_position_id) : null,
                    cutId: cutId,
                    finishedBatchId: finishedBatchId,
                    // #3624: номер заказа позиции прямо из cut_planning — нужен подписи
                    // «Связанные позиции», когда позиция выпала из активного positions_list.
                    orderNo: str(row.order_no),
                    // #3633: габариты позиции обеспечения прямо из cut_planning — чтобы
                    // подпись «Связанные позиции» для позиции вне активного positions_list
                    // была полной («<заказ> · <ширина>мм * <длина>м»), а не id записи + метраж.
                    // Ширина = cut_roller_width (Заказанное количество → Ширина, мм), длина —
                    // добавленная колонка position_length (Заказанное количество → Длина, м).
                    positionWidth: (row.cut_roller_width == null || row.cut_roller_width === '') ? 0 : Number(row.cut_roller_width),
                    positionLength: (row.position_length == null || row.position_length === '') ? 0 : Number(row.position_length),
                    footage: rowNum(row, SUPPLY_FOOTAGE_COLUMNS),
                    rolls: rowNum(row, ['supply_rolls', 'supply_qty', 'supply_quantity', 'supply_roll_count'])
                });
            }
        });
        return { cuts: order.map(function(id) { return cutsById[id]; }), supplies: supplies };
    }

    function formatPositionDimensionValue(value) {
        var n = stripNum(value);
        return n > 0 ? String(round3(n)) : '';
    }

    function positionDimensionsLabel(width, length) {
        var w = formatPositionDimensionValue(width);
        var len = formatPositionDimensionValue(length);
        if (w !== '' && len !== '') return w + 'мм * ' + len + 'м';
        if (w !== '') return w + 'мм';
        if (len !== '') return len + 'м';
        return '';
    }

    // Строки отчёта positions_list (JSON_KV) → [{ id, label, width, length, qty }]
    // для дропдауна привязки и плашек «Связанные позиции». Подпись:
    // «<номер заказа>/<номер позиции> · <ширина>мм * <метраж>м» (#3231).
    // Номер заказа берётся из колонки `order_no` отчёта; если её нет (старый
    // отчёт) — деградирует до «№<номер>». Габариты пропускаются, если пустые.
    function rowsToPositions(rows) {
        return (rows || []).map(function(row) {
            var id = row.position_id == null ? '' : String(row.position_id);
            var orderNo = row.order_no == null ? '' : String(row.order_no).trim();
            var no = row.position_no == null ? '' : String(row.position_no).trim();
            var width = stripNum(row.position_width);
            var length = stripNum(rowFirstValue(row, ['position_length', 'position_length_m', 'position_wind_length', 'wind_length']));
            var qty = stripNum(row.position_qty);
            // #3633: positions_list не отдаёт номер позиции (no обычно пусто) — тогда не
            // оставляем «висячий» слэш «<заказ>/», а показываем просто «<заказ>». Если номер
            // когда-нибудь появится — подпись снова «<заказ>/<номер>».
            var head = orderNo !== ''
                ? (no !== '' ? orderNo + '/' + no : orderNo)
                : (no !== '' ? '№' + no : '');
            var dims = positionDimensionsLabel(width, length);
            var label = head + (dims !== '' ? ' · ' + dims : '');
            return { id: id, label: label, width: width, length: length, qty: qty };
        });
    }

    function suppliedRollsForPosition(positionId, supplies) {
        var id = String(positionId == null ? '' : positionId);
        var total = 0;
        var hasRolls = false;
        var hasCoverage = false;
        (supplies || []).forEach(function(s) {
            if (!s || String(s.positionId == null ? '' : s.positionId) !== id) return;
            if (s.rolls !== undefined && s.rolls !== null && String(s.rolls).trim() !== '') {
                hasRolls = true;
                total += stripNum(s.rolls);
            }
            if (supplyCoverageKind(s)) hasCoverage = true;
        });
        return { rolls: round3(total), hasRolls: hasRolls, hasCoverage: hasCoverage };
    }

    function remainingRollsForPosition(position, supplies) {
        var qty = stripNum(position && position.qty);
        if (qty <= 0) return 0;
        var supplied = suppliedRollsForPosition(position && position.id, supplies);
        if (!supplied.hasRolls && supplied.hasCoverage) return 0;
        var remaining = qty - supplied.rolls;
        return remaining > 0 ? round3(remaining) : 0;
    }

    // Подпись плашки «Связанные позиции» (#3406 п.1): подпись позиции +
    // её «Количество» (qty шт. — сколько рулонов в позиции заказа) + рулоны/метраж
    // обеспечения. position — объект из rowsToPositions (может отсутствовать →
    // fallbackId для «позиция #N»). Чистая (DOM не трогает), проверяется модульно.
    function formatLinkedPositionLabel(position, fallbackId, supplyRolls, footage, fallbackOrderNo, fallbackWidth, fallbackLength) {
        var posId = position && position.id != null ? position.id : fallbackId;
        var label;
        if (position && position.label) {
            label = position.label;
        } else {
            // #3633: позиция выпала из активного positions_list (заказ закрыт/выполнен) —
            // собираем полную подпись из данных обеспечения (cut_planning): номер заказа
            // (order_no) + габариты позиции (cut_roller_width × position_length), т.е.
            // «<заказ> · <ширина>мм * <длина>м», а НЕ id записи позиции. Нет order_no —
            // прежний фолбэк «позиция #N»; нет габаритов — просто «<заказ>».
            var on = String(fallbackOrderNo == null ? '' : fallbackOrderNo).trim();
            var dims = positionDimensionsLabel(fallbackWidth, fallbackLength);
            var base = on !== '' ? on : ('позиция #' + posId);
            label = base + (dims !== '' ? ' · ' + dims : '');
        }
        var qty = stripNum(position && position.qty);
        if (qty > 0) label += ' · ' + round3(qty) + ' шт.';
        var rolls = stripNum(supplyRolls);
        var foot = stripNum(footage);
        if (rolls > 0) label += ' · ' + round3(rolls) + ' рул.';
        else if (foot > 0 && label.indexOf(String(round3(foot)) + 'м') < 0) label += ' · ' + foot + ' м';
        return label;
    }

    // #3320: кол-во рулонов обеспечения для привязки полосы к позиции заказа.
    // База — рулоны полосы (Кол-во полос × проходов), но не больше 110% от
    // необеспеченного остатка позиции. Отрицательные/нулевые входы → 0.
    function stripSupplyRolls(stripRolls, remaining) {
        var base = stripNum(stripRolls);
        var rem = stripNum(remaining);
        if (base <= 0 || rem <= 0) return 0;
        var cap = rem * 1.1;
        return round3(base < cap ? base : cap);
    }

    // Строки отчёта positions_list (JSON_KV) → [{ id, materialId, width, qty, length, sleeveId, sleeveReady, dueKey }]
    // для генерации резок. position_material_id (добавлен в отчёт), position_width,
    // position_qty, position_length/wind_length → числа; пустые значения → 0/'' но объект всегда
    // присутствует. length — «Длина, м» позиции (длина прогона джамбо = «Метраж, м»
    // создаваемого обеспечения, #3155); нет колонки в отчёте → 0 (длительность намотки 0).
    // dueKey — числовой ключ «Срока изготовления» (position_due_date) через
    // batchDateKey (для оконного отбора по сроку при генерации); нет срока → Infinity.
    function rowsToGenPositions(rows) {
        return (rows || []).map(function(row) {
            // Позиция считается согласованной, если утверждён заказ (order_approval_date)
            // ИЛИ утверждена сама позиция (item_approval_date).
            var orderApproved = !!(String(row.order_approval_date || row.order_approved || '').trim());
            var itemApproved = !!(String(row.item_approval_date || row.position_approved || row.position_approval_date || '').trim());
            var lengthRaw = rowFirstValue(row, ['position_length', 'position_length_m', 'position_wind_length', 'wind_length']);
            var length = stripNum(lengthRaw);
            var windLengthRaw = (row.wind_length != null && String(row.wind_length).trim() !== '')
                ? row.wind_length
                : ((row.position_wind_length != null && String(row.position_wind_length).trim() !== '') ? row.position_wind_length : lengthRaw);
            return {
                id: row.position_id == null ? '' : String(row.position_id),
                materialId: row.position_material_id == null ? '' : String(row.position_material_id),
                width: stripNum(row.position_width),
                qty: stripNum(row.position_qty),
                length: length,
                windDir: normWinding(row.wind_dir || row.position_wind_dir || row.position_winding),
                windLength: windLengthValue(windLengthRaw),
                // #3472: «Лидер» заказа — отдельное измерение профиля планирования (заказы
                // с разным лидером нельзя класть в одну резку, она заправляется одним
                // лидером). Отчёт positions_list пока может не отдавать колонку — тогда
                // пусто и разбиения по лидеру нет (как order_id в #3433).
                leader: rowFirstValue(row, ['position_leader', 'order_leader']),
                // #3340: тип втулки и готовность приходят прямо из positions_list:
                // sleeve_id — id записи «Диаметр втулки»; sleeve_ready (непустое) — уже нарезано.
                sleeveId: row.sleeve_id == null ? '' : String(row.sleeve_id).trim(),
                sleeveReady: String(row.sleeve_ready == null ? '' : row.sleeve_ready).trim() !== '',
                dueKey: batchDateKey(row.position_due_date),
                // #3433: заказ позиции — для «ID заказа» создаваемой «Партии ГП». Если
                // отчёт positions_list ещё не отдаёт order_id, остаётся пусто (в запас).
                orderId: row.order_id == null ? '' : String(row.order_id).trim(),
                approved: orderApproved || itemApproved,
                // #3599: тип сырья из отчёта (Вид сырья → «Тип сырья»). «Фольга» — грязное
                // сырьё, его ставим в конец смены (после неё сложная уборка).
                materialType: rowFirstValue(row, ['position_material_type']),
                isFoil: /фольг/i.test(rowFirstValue(row, ['position_material_type']))
            };
        });
    }

    function windLengthValue(value) {
        var n = stripNum(value);
        return n > 0 ? round3(n) : 0;
    }

    function windLengthKey(value) {
        var n = windLengthValue(value);
        return n > 0 ? String(n) : '';
    }

    function preferredWidthsKey(materialId, windDir, windLength) {
        return String(materialId == null ? '' : materialId).trim() + '|' +
            normWinding(windDir) + '|' + windLengthKey(windLength);
    }

    function rowFirstValue(row, names) {
        for (var i = 0; i < names.length; i++) {
            if (row && row[names[i]] != null && String(row[names[i]]).trim() !== '') return row[names[i]];
        }
        return '';
    }

    function preferredWidthMatchesProfile(row, windDir, windLength) {
        if (windDir && normWinding(rowFirstValue(row, ['wind_dir', 'position_wind_dir', 'position_winding'])) !== windDir) {
            return false;
        }
        if (windLength && windLengthKey(rowFirstValue(row, ['wind_length', 'position_wind_length', 'position_length'])) !== windLength) {
            return false;
        }
        return true;
    }

    function planningLeaderKey(p) {
        return String(p && p.leader != null ? p.leader : '').trim();
    }

    // #3472: профиль планирования = сырьё + намотка + длина + ЛИДЕР. Лидер добавлен как
    // отдельное измерение — заказы с разным лидером идут в разные резки (резка заправляется
    // одним лидером). group.key (для добора ходовыми) остаётся БЕЗ лидера: ходовые ширины
    // от лидера не зависят. Пустой лидер у всех (отчёт ещё не отдаёт колонку) → разбиения нет.
    function groupPositionsByPlanningProfile(positions) {
        var groups = {};
        var order = [];
        (positions || []).forEach(function(p) {
            var prefKey = preferredWidthsKey(p && p.materialId, p && p.windDir, p && p.windLength);
            var leader = planningLeaderKey(p);
            // #3812: число втулочных полос (0/1/2) — отдельное измерение профиля: позиции
            // с разной потребностью в полосах 110 мм идут в разные резки (своя резервируемая
            // ширина джамбо). Для не-0.5″/не-110 count=0 у всех → разбиения нет.
            var coreCount = Number(p && p.coreStripCount) || 0;
            var groupKey = prefKey + '|L=' + leader + '|S=' + (p.sleeveId || '') + '|C=' + coreCount;
            if (!groups[groupKey]) {
                groups[groupKey] = {
                    key: prefKey,
                    leader: leader,
                    sleeveId: p.sleeveId || '',
                    coreStripCount: coreCount,                       // #3812
                    coreStripWidth: Number(p && p.coreStripWidth) || 0,  // #3812
                    materialId: p && p.materialId != null ? String(p.materialId) : '',
                    windDir: normWinding(p && p.windDir),
                    windLength: windLengthValue(p && p.windLength),
                    isFoil: !!(p && p.isFoil),   // #3599: фольга (тип сырья) — в конец смены
                    positions: []
                };
                order.push(groupKey);
            }
            groups[groupKey].positions.push(p);
        });
        return order.map(function(key) { return groups[key]; });
    }

    // Карта «id позиции → Длина, м» из genPositions (#3155): «Метраж, м» создаваемого
    // обеспечения при генерации резок = длина прогона позиции. Пустая/нулевая длина —
    // ключ всё равно есть (значение 0): buildFields опустит пустой реквизит.
    function positionLengthMap(genPositions) {
        var out = {};
        (genPositions || []).forEach(function(p) {
            if (p && p.id != null && String(p.id) !== '') out[String(p.id)] = Number(p.length) || 0;
        });
        return out;
    }

    function cutGenerationTimingDiagnostics(layouts, positions, opTimes) {
        var byId = positionMap(positions);
        var windPoints = windingPointsFromTimes(opTimes || {});
        var out = [];
        (layouts || []).forEach(function(layout, index) {
            var covered = (layout && layout.positionsCovered) || [];
            var plannedRuns = plannedRunsForLayout(layout, byId);
            var runLength = layoutRunLength(layout, byId);
            var layoutNo = index + 1;
            if (!(plannedRuns > 0)) {
                out.push({
                    key: 'plannedRuns',
                    label: CUT_REQ.plannedRuns,
                    reason: 'value',
                    layoutIndex: index,
                    message: 'Не рассчитано поле «' + CUT_REQ.plannedRuns + '» для задания ' + layoutNo
                });
                return;
            }
            if (!(runLength > 0)) {
                var missingIds = covered.filter(function(positionId) {
                    var p = byId[String(positionId)];
                    return !(Number(p && p.length) > 0);
                }).map(function(positionId) { return String(positionId); });
                out.push({
                    key: 'length',
                    label: CUT_REQ.length,
                    reason: 'value',
                    layoutIndex: index,
                    positionIds: missingIds,
                    message: 'Не рассчитано поле «' + CUT_REQ.length + '» для задания ' + layoutNo +
                        (missingIds.length ? ': нет длины у позиций ' + missingIds.join(', ') : ': нет длины прогона') +
                        '. Проверьте positions_list: position_length / wind_length'
                });
                return;
            }
            if (!(plannedCutDurationMinutes(runLength, plannedRuns, opTimes) > 0)) {
                out.push({
                    key: 'duration',
                    label: CUT_REQ.duration,
                    reason: 'value',
                    layoutIndex: index,
                    runLength: runLength,
                    plannedRuns: plannedRuns,
                    message: 'Не рассчитано поле «' + CUT_REQ.duration + '» для задания ' + layoutNo +
                        (windPoints.length ? ': длительность 0 при метраже ' + runLength + ' м и проходах ' + plannedRuns : ': нет норм WIND_* в «Время операции, мин»')
                });
            }
        });
        return out;
    }

    // Преобразование «Дата прихода» в числовой ключ для FIFO-сортировки.
    // ISO YYYY-MM-DD → YYYYMMDD; D.M.Y / D/M/Y → YYYYMMDD; пустое → Infinity.
    function batchDateKey(value) {
        var s = String(value == null ? '' : value).trim();
        if (!s) return Infinity;
        var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return Number(iso[1]) * 10000 + Number(iso[2]) * 100 + Number(iso[3]);
        var dmy = s.match(/^(\d{1,2})[.\\/](\d{1,2})[.\\/](\d{4})/);
        if (dmy) return Number(dmy[3]) * 10000 + Number(dmy[2]) * 100 + Number(dmy[1]);
        // #3242: «Партия сырья» хранит дату прихода в первой колонке (DATETIME) —
        // приходит unix-штампом в секундах; используем его как ключ FIFO (по возрастанию).
        if (/^\d{9,11}$/.test(s)) return Number(s);
        var t = Date.parse(s);
        return isNaN(t) ? Infinity : t;
    }

    // #3769: YYYYMMDD-ключ (как у planDateDayKey/batchDateKey для дат) → Date (полночь
    // местного времени) для арифметики по календарным дням. Невалидный/Infinity → null.
    function dayKeyToDate(key) {
        var n = Number(key);
        if (!isFinite(n) || n < 10000101 || n > 99991231) return null;
        var y = Math.floor(n / 10000), m = Math.floor(n / 100) % 100, d = n % 100;
        if (m < 1 || m > 12 || d < 1 || d > 31) return null;
        var dt = new Date(y, m - 1, d);
        return isNaN(dt.getTime()) ? null : dt;
    }

    // #3769: YYYYMMDD-ключ → «DD.MM.YYYY» для подписи срока. Невалидный → ''.
    function formatDayKey(key) {
        var dt = dayKeyToDate(key);
        if (!dt) return '';
        var p2 = function(x) { return (x < 10 ? '0' : '') + x; };
        return p2(dt.getDate()) + '.' + p2(dt.getMonth() + 1) + '.' + dt.getFullYear();
    }

    // #3769: класс расцветки строки .atex-pp-strip-row по «Сроку изготовления» позиции
    // (dueKey, YYYYMMDD) относительно «Даты план» задания (planKey, YYYYMMDD):
    //   срок РАНЬШЕ планы            → 'is-overdue' (красный — не успеваем);
    //   срок дальше планы+forecast   → 'is-far'     (жёлтый — делаем сильно заранее);
    //   срок в окне [план; план+forecast] включительно → '' (без изменения цвета).
    // forecastDays === null/отрицательный → жёлтый отключён (нет настройки), красный работает.
    function dueColorClass(dueKey, planKey, forecastDays) {
        var due = dayKeyToDate(dueKey), plan = dayKeyToDate(planKey);
        if (!due || !plan) return '';
        var diffDays = Math.round((due.getTime() - plan.getTime()) / 86400000);
        if (diffDays < 0) return 'is-overdue';
        if (forecastDays != null && forecastDays >= 0 && diffDays > forecastDays) return 'is-far';
        return '';
    }

    // #3769: отсортированные уникальные ключи «Срока изготовления» позиций, которые
    // обеспечивает резка (supplies cutId→positionId → genPositions[pos].dueKey).
    // Позиции без срока или выпавшие из активного positions_list — пропускаются.
    function cutDueKeys(cut, supplies, genPositions) {
        var posMap = positionMap(genPositions);
        var seen = {}, keys = [];
        (supplies || []).forEach(function(s) {
            if (!cut || !s || String(s.cutId) !== String(cut.id)) return;
            var p = s.positionId != null ? posMap[String(s.positionId)] : null;
            var k = p && p.dueKey;
            if (k == null || !isFinite(k) || k === Infinity) return;
            if (!seen[k]) { seen[k] = true; keys.push(k); }
        });
        return keys.sort(function(a, b) { return a - b; });
    }

    // Отображение «Номера» резки: «номер» = плановая дата начала (cut_plan_date, #3242),
    // приходит unix-штампом (секунды) → форматируем как дату-время. Короткие record id
    // и не-штампы не форматируем как 1970-дату.
    function isTimestampCutNumber(value) {
        var s = String(value == null ? '' : value).trim();
        if (!/^\d+$/.test(s)) return false;
        var n = Number(s);
        if (!isFinite(n) || n < 1000000000) return false;
        var d = new Date(n * 1000);
        if (isNaN(d.getTime())) return false;
        var year = d.getFullYear();
        return year >= 2001 && year <= 2100;
    }

    function formatDateTimeMinute(date) {
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        return pad(date.getDate()) + '.' + pad(date.getMonth() + 1) + '.' + date.getFullYear() +
            ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    }

    function refSearchHelper() {
        if (typeof window !== 'undefined' && window.AtexRefSearch) return window.AtexRefSearch;
        if (typeof globalThis !== 'undefined' && globalThis.AtexRefSearch) return globalThis.AtexRefSearch;
        return null;
    }

    function formatCutNumber(value) {
        if (value == null || value === '') return '';
        var s = String(value).trim();
        if (s === '' || !isTimestampCutNumber(s)) return s;
        var helper = refSearchHelper();
        if (helper && typeof helper.formatDateTime === 'function') {
            var formatted = helper.formatDateTime(s);
            return formatted == null || formatted === '' ? s : String(formatted);
        }
        return formatDateTimeMinute(new Date(Number(s) * 1000));
    }

    // Строки отчёта material_batches (JSON_KV) → [{ id, label }] для дропдауна
    // «Партия сырья». Подпись обогащённая: «Номер · Вид сырья · ост. N м²»
    // (пустые части пропускаются). Дропдаун статический клиентский (см. renderForm),
    // поэтому метка единообразна и при фильтрации по вводу.
    // Остаток м² → строка: округление до 2 знаков, без незначащих нулей
    // (2440.00 → «2440», 38400.366 → «38400.37»). Нечисло/пусто → ''.
    function fmtRemainder(value) {
        var n = parseFloat(String(value == null ? '' : value).replace(',', '.'));
        return isFinite(n) ? String(Math.round(n * 100) / 100) : '';
    }

    function rowsToBatches(rows) {
        return (rows || []).map(function(row) {
            var no = row.batch_no == null ? '' : String(row.batch_no).trim();
            var material = row.batch_material == null ? '' : String(row.batch_material).trim();
            // #3242: основной остаток — погонные метры (batch_remainder_m), которых хватит
            // на отмотку нужной длины; кв.м. (batch_remainder_m2) — только справочно.
            var remM = fmtRemainder(row.batch_remainder_m);
            var remM2 = fmtRemainder(row.batch_remainder_m2);
            var parts = [];
            if (material) parts.push(material);
            if (remM) parts.push('ост. ' + remM + ' м' + (remM2 ? ' (' + remM2 + ' м²)' : ''));
            else if (remM2) parts.push('ост. ' + remM2 + ' м²');
            return {
                id: row.batch_id == null ? '' : String(row.batch_id),
                label: no + (parts.length ? ' · ' + parts.join(' · ') : '')
            };
        });
    }

    // Времена переналадок (мин) — по умолчанию (fallback). Реальные берутся из таблицы
    // «Время операции, мин» (13588) по кодам (loadOperationTimes → this.changeTimes):
    //   MATERIAL_WINDING — смена сырья/намотки/партии/неудобный остаток (одна операция);
    //   KNIFE_MOVE — стоимость ОДНОГО перемещения ножа (#3472, позиционная модель: цена
    //     ножей = KNIFE_MOVE × число переставленных ножей; идентичные полосы → 0);
    //   KNIFE — устар.: прежняя плоская «смена ножей» (оставлен для совместимости настроек);
    //   BETWEEN_CUTS — лидер между резками (база);
    //   CLEANUP_SHIFT — уборка в конце рабочего дня (#3155, ставится после последней резки дня).
    // #3472: приоритет — неизменность полос (0), затем меньше перемещений (2×ножи),
    // смена сырья (15); полная смена ~16 ножей ≈ 32 ≈ прежняя «смена ножей» 30.
    var DEFAULT_OP_TIMES = { MATERIAL_WINDING: 15, KNIFE: 30, KNIFE_MOVE: 2, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
    var KNIFE_SCALE = 8;     // нормировка ножевой компоненты (переставленных ножей до «максимума»)
    var WIDTH_SCALE = 100;   // нормировка ширины (мм «сужения» до «максимума»)
    var REMAINDER_OK_M = 600;
    var FATIGUE_MACHINE_WIDTH_MM = 1600;  // базовая ширина вала для оценки числа ножей (#3270/#3272)
    var FATIGUE_FACTOR = 2.0;             // alpha: штраф последней позиции = 1 + alpha
    var FATIGUE_START_COST_MIN = 45;      // условная стоимость старта маршрута, мин
    var PLANNING_STRATEGY_SETUP = 'setup';
    var PLANNING_STRATEGY_FATIGUE = 'fatigue';

    function normWinding(v){ var s = String(v == null ? '' : v).trim().toUpperCase(); return (s === 'IN' || s === 'OUT') ? s : ''; }

    // Симметрическая разность мультимножеств ширин (сколько ножей переставить). Терпимо к числам/строкам.
    function widthSetDistance(a, b){
        function tally(arr){ var m = {}; (arr || []).forEach(function(x){ var k = String(Number(x)); m[k] = (m[k] || 0) + 1; }); return m; }
        var ma = tally(a), mb = tally(b), keys = {}, d = 0;
        Object.keys(ma).forEach(function(k){ keys[k] = 1; });
        Object.keys(mb).forEach(function(k){ keys[k] = 1; });
        Object.keys(keys).forEach(function(k){ d += Math.abs((ma[k] || 0) - (mb[k] || 0)); });
        return d;
    }

    // #3472: число НОЖЕЙ для перестановки prev→next. Нож, чья ширина есть в ОБОИХ
    // наборах, сохраняется (не двигается) — это приоритет неизменности полос. Поэтому
    // moves = max(|prev|, |next|) − |пересечение мультимножеств ширин|: добавить/убрать
    // нож = 1 перемещение, сменить ширину = 1, идентичный набор = 0. (Смена количества —
    // частный случай перемещений, отдельно не штрафуем.)
    function knifeMoves(prevWidths, nextWidths){
        function tally(arr){ var m = {}; (arr || []).forEach(function(x){ var k = String(x); m[k] = (m[k] || 0) + 1; }); return m; }
        var a = prevWidths || [], b = nextWidths || [];
        var ta = tally(a), tb = tally(b), inter = 0;
        Object.keys(ta).forEach(function(k){ if (tb[k]) inter += Math.min(ta[k], tb[k]); });
        return Math.max(a.length, b.length) - inter;
    }

    // Ширины ножей резки для knifeMoves. В реальных данных knifeWidths развёрнут по числу
    // ножей (длина == knifeCount, см. aggregateStrips). Если ширины не развёрнуты
    // (placeholder/пусто), а число ножей задано — дополняем сентинелом «нож без известной
    // ширины», чтобы перестановка считалась по числу ножей (фоллбэк совместимости).
    function effKnifeWidths(cut){
        var w = (cut && cut.knifeWidths) || [];
        var keys = w.map(function(x){ return String(Number(x)); });
        var n = Number(cut && cut.knifeCount) || 0;
        while (keys.length < n) keys.push('·');
        return keys;
    }

    // #3666: подпись НАБОРА ШИРИН ножей резки (уникальные ширины ↑, через запятую) — «та же
    // конфигурация ножей» в терминах оператора. Нужна для выбора станка: резки с одинаковым
    // набором ширин кладём на ОДИН станок (оператор работает тем же набором ножей, а не
    // настраивает их с нуля на другом станке), даже если число ножей/намотка отличаются.
    // Ширин нет (неизвестны) → '' (без группировки по ножам).
    function knifeWidthSig(cut){
        var set = {};
        ((cut && cut.knifeWidths) || []).forEach(function(x){ var n = Number(x); if (isFinite(n) && n > 0) set[String(n)] = 1; });
        return Object.keys(set).map(Number).sort(function(a, b){ return a - b; }).join(',');
    }

    // Неудобный остаток джамбо: 0 < m < REMAINDER_OK_M (не дорезан до ≈0 и не оставлен крупным).
    function awkwardRemainder(m){ var x = Number(m); return !isNaN(x) && x > 1e-6 && x < REMAINDER_OK_M; }

    // Компоненты переналадки prev→next (МИНУТЫ, БЕЗ лидера BETWEEN_CUTS) — те операции,
    // что реально применились, для расшифровки тайминга (#3240):
    //   смена сырья ИЛИ намотки ИЛИ партии → MATERIAL_WINDING (одна операция «смена
    //   сырья/намотки»; неудобный остаток — её же частный случай, отдельно не считаем);
    //   смена набора ножей ИЛИ сужение ролика → KNIFE. Бинарно (изменилось/нет), без
    //   нормировок. prev/next отсутствует → [] (первой резке переналадка не нужна).
    //   → [{ code, label, minutes }] (только применившиеся, с minutes > 0).

    // #3871: ускорение выравнивания загрузки станков (rebalanceSlitterLoad). Пост-проход
    // на каждую пробу переноса пересчитывал переналадку по ПОЛНЫМ наборам станка
    // (orderedChangeoverCost → greedySequence c перебором стартов, O(n³)). При ~170 резках это
    // ≈40 с на перенос — «Создать» висел минутами, окно прогресса не успевало отрисоваться.
    // На время выравнивания включаются два упрощения: changeoverCost кэшируется по паре id
    // (в пределах прохода times постоянен, объекты резок по id не меняются), а greedySequence
    // строит цепочку от ОДНОГО старта (O(n²)) вместо перебора всех. Оценка переналадки тут
    // нужна лишь как ориентир баланса — финальную очередь всё равно собирает planCutOperations.
    // Вне выравнивания (false/null) планировщик считает переналадку как прежде, побайтово.
    var balanceFastChangeover = false;   // greedySequence: цепочка от одного старта (без перебора)
    var balancePairCostMemo = null;      // changeoverCost: кэш по паре id { 'prevId>nextId': минуты }

    function changeoverParts(prev, next, times){
        var t = times || DEFAULT_OP_TIMES;
        var matWind = Number(t.MATERIAL_WINDING != null ? t.MATERIAL_WINDING : DEFAULT_OP_TIMES.MATERIAL_WINDING) || 0;
        var knifeTime = Number(t.KNIFE != null ? t.KNIFE : DEFAULT_OP_TIMES.KNIFE) || 0; // #3600: фикс. время любой смены ножей (по умолч. 30 мин), независимо от числа ножей
        var parts = [];
        if (!prev || !next) return parts;
        var matWindChange = String(prev.materialId) !== String(next.materialId)
            || normWinding(prev.winding) !== normWinding(next.winding)
            || String(prev.batchId) !== String(next.batchId);
        // #3600: любая смена набора ножей ИЛИ сужение ролика → ФИКСИРОВАННО KNIFE (30 мин)
        // «на всё вместе», независимо от числа переставленных ножей (раньше #3472: стоимость =
        // KNIFE_MOVE × число перестановок). Смена сырья/намотки считается отдельно (ниже).
        // Бинарно: изменился набор ножей (knifeMoves>0) ИЛИ сузился ролик → одна переналадка ножей.
        // #3688: порядок операций — СНАЧАЛА настройка ножей, ПОТОМ смена сырья (так на станке).
        var moves = knifeMoves(effKnifeWidths(prev), effKnifeWidths(next));
        var knifeChanged = moves > 0 || (Number(prev.rollerWidth) || 0) > (Number(next.rollerWidth) || 0);
        if (knifeChanged && knifeTime > 0) parts.push({ code: 'KNIFE', label: 'смена ножей / сужение ролика', minutes: round3(knifeTime) });
        if (matWindChange && matWind > 0) parts.push({ code: 'MATERIAL_WINDING', label: 'смена сырья / намотки / партии', minutes: round3(matWind) });
        return parts;
    }

    // #3688: текущая заправка станка из отчёта prev_cut_setup → { materialId, winding,
    // knifeWidths, knifeCount } по верхней (последней по task_start) задаче станка. rows —
    // строки отчёта (фильтруем по slitterId, если задан). Сравниваем материал/намотку/набор
    // ножей (НЕ партию). Нет строк → null. Вход не мутируется.
    function prevSetupFromRows(rows, slitterId) {
        var sid = String(slitterId == null ? '' : slitterId);
        var byTask = {};
        (rows || []).forEach(function(r) {
            if (sid !== '' && String(r.slitter_id) !== sid) return;
            var tid = String(r.task_id == null ? '' : r.task_id);
            if (tid === '') return;
            var ts = Number(r.task_start) || 0;
            if (!byTask[tid]) byTask[tid] = { start: ts, widths: [], material: '', winding: '' };
            var rec = byTask[tid];
            if (ts > rec.start) rec.start = ts;
            var w = Number(r.width) || 0;
            if (w > 0) rec.widths.push(w);
            if (rec.material === '' && r.material_id != null && String(r.material_id) !== '') rec.material = String(r.material_id);
            if (rec.winding === '' && r.wind_dir) rec.winding = normWinding(r.wind_dir);
        });
        var top = null;
        Object.keys(byTask).forEach(function(tid) {
            if (top === null || byTask[tid].start > byTask[top].start) top = tid;
        });
        if (top === null) return null;
        var rec = byTask[top];
        return { materialId: rec.material, winding: rec.winding, knifeWidths: rec.widths.slice(), knifeCount: rec.widths.length };
    }

    // #3688: синтетическая «предыдущая резка» для расчёта переналадки ПЕРВОЙ резки очереди
    // станка от его текущей заправки (prevSetup, из prev_cut_setup). Партию нейтрализуем
    // (= как у next) — сравниваем лишь материал/намотку/ножи, как задаёт отчёт. Нет данных
    // (null) → пустой станок: материал/намотка/ножи отличны → полный сетап (смена сырья +
    // настройка ножей с нуля). nextCut нужен только для нейтрализации партии.
    function carryOverPrevCut(prevSetup, nextCut) {
        if (!nextCut) return null;
        var batchId = (nextCut.batchId == null ? '' : nextCut.batchId);
        if (!prevSetup) {
            return { materialId: ' none', winding: ' none', batchId: batchId,
                     knifeWidths: [], knifeCount: 0, rollerWidth: 0 };
        }
        return { materialId: prevSetup.materialId, winding: prevSetup.winding, batchId: batchId,
                 knifeWidths: (prevSetup.knifeWidths || []).slice(),
                 knifeCount: (prevSetup.knifeWidths || []).length, rollerWidth: 0 };
    }

    // Стоимость перехода prev→next в МИНУТАХ переналадки (Σ компонентов changeoverParts;
    // две операции — обе вычитают время смены).
    function changeoverCost(prev, next, times){
        // #3871: во время выравнивания загрузки — кэш по паре id (тот же переход считается
        // тысячи раз по разным наборам станка). Объекты резок и times в проходе неизменны.
        if (balancePairCostMemo && prev && next && prev.id != null && next.id != null) {
            var ck = String(prev.id) + '>' + String(next.id);
            if (balancePairCostMemo[ck] !== undefined) return balancePairCostMemo[ck];
            return (balancePairCostMemo[ck] = round3(changeoverParts(prev, next, times).reduce(function(sum, p){ return sum + (Number(p.minutes) || 0); }, 0)));
        }
        return round3(changeoverParts(prev, next, times).reduce(function(sum, p){ return sum + (Number(p.minutes) || 0); }, 0));
    }

    // #3669 п.2: первая задача дня требует НАСТРОЙКИ НОЖЕЙ (их ставят с нуля). Для первой
    // задачи каждого дня, кроме первого, настройка уже считается переналадкой с последней
    // задачей предыдущего дня (changeoverParts) — «той же конфигурацией → 0». А у самой
    // первой задачи загруженной очереди предыдущего дня нет (история не подгружена), поэтому
    // настройку планируем консервативно (лучше учесть время, чем потерять). Включается флагом
    // firstCutSetup (см. buildSchedule/splitMachineQueue/setupBreakdown); возвращает компонент
    // KNIFE как у changeoverParts. [] — если у резки нет ножей или время KNIFE = 0.
    function firstSetupParts(next, times){
        var t = times || DEFAULT_OP_TIMES;
        var knifeTime = Number(t.KNIFE != null ? t.KNIFE : DEFAULT_OP_TIMES.KNIFE) || 0;
        if (!next || !(knifeTime > 0)) return [];
        var hasKnives = (Number(next.knifeCount) || 0) > 0 || ((next.knifeWidths || []).length > 0);
        return hasKnives ? [{ code: 'KNIFE', label: 'настройка ножей', minutes: round3(knifeTime) }] : [];
    }

    function firstSetupCost(next, times){
        return round3(firstSetupParts(next, times).reduce(function(sum, p){ return sum + (Number(p.minutes) || 0); }, 0));
    }

    // #3698: расщепить переналадку prev→next на ДВЕ активности (минуты) для хранения в
    // «Задание в производство»: «Наладка ножей, мин» (KNIFE) и «Сырье/намотка, мин»
    // (MATERIAL_WINDING). Та же логика, что setupBreakdown, но числом по каждой активности.
    // → { knifeMin, materialWindingMin }. Чистая (тест).
    function setupActivityMinutes(prev, next, times, opts){
        var knife = 0, matWind = 0;
        setupBreakdown(prev, next, times, opts).forEach(function(p){
            if (p.code === 'KNIFE') knife += Number(p.minutes) || 0;
            else if (p.code === 'MATERIAL_WINDING') matWind += Number(p.minutes) || 0;
        });
        return { knifeMin: round3(knife), materialWindingMin: round3(matWind) };
    }

    // #3760: какие компоненты настройки положить в хвост смены, когда настройка целиком
    // не влезает. Берём ПОДМНОЖЕСТВО компонентов с суммой ≥ остатка дня (дотягивает до конца
    // смены) и МИНИМАЛЬНОЙ суммой (минимальный нахлёст). Остальное — на следующий день.
    //   parts — [{minutes}], avail — остаток дня (мин), total — сумма всех компонентов.
    // Примеры (ножи 30, сырьё 15): avail 8 → сырьё 15 (нахлёст 7); avail 20 → ножи 30
    // (сырьё 15 < 20 не дотягивает, оставило бы простой); avail 35 → ножи+сырьё 45.
    // Полный набор (сумма total ≥ avail в этой ветке) всегда годится; компонентов мало —
    // полный перебор подмножеств. → минуты настройки в хвост (round3).
    function minOverlapTailSetupMinutes(parts, avail, total) {
        var mins = (parts || []).map(function(p){ return Number(p && p.minutes) || 0; })
            .filter(function(m){ return m > 0; });
        var tot = Number(total) || mins.reduce(function(s, m){ return s + m; }, 0);
        if (!mins.length) return round3(tot);
        var a = Number(avail) || 0, n = mins.length, best = tot;
        if (n <= 16) {
            for (var mask = 1; mask < (1 << n); mask++) {
                var s = 0;
                for (var b = 0; b < n; b++) if (mask & (1 << b)) s += mins[b];
                if (s >= a && s < best) best = s;
            }
        } else {
            var sorted = mins.slice().sort(function(x, y){ return y - x; }), acc = 0;
            for (var i = 0; i < sorted.length && acc < a; i++) acc += sorted[i];
            best = acc || tot;
        }
        return round3(best);
    }

    // #3698: активности переналадки на каждую резку упорядоченной очереди ОДНОГО станка
    // (порядок исполнения — по «Очередности», как в Ганте orderCutsInGroup). Первая резка —
    // от текущей заправки станка (carryPrevCut из prev_cut_setup, строится вызывающим через
    // carryOverPrevCut); нет заправки (carryPrevCut=null) → настройка ножей с нуля
    // (firstCutSetup). Зеркалит ветку setup в buildSchedule. → { cutId: { knifeMin, materialWindingMin } }.
    // Чистая (тест).
    function setupActivityColumns(orderedCuts, times, carryPrevCut){
        var out = {};
        (orderedCuts || []).forEach(function(c, i){
            var prev = i > 0 ? orderedCuts[i - 1] : (carryPrevCut || null);
            var opts = (i === 0 && !carryPrevCut) ? { firstCutSetup: true } : null;
            out[String(c.id)] = setupActivityMinutes(prev, c, times, opts);
        });
        return out;
    }

    // #3401: число резок в цуге (в терминологии заказчика общая «резка» состоит из
    // множества резок — бывших «проходов», см. «Кол-во резок план»). Лидер BETWEEN_CUTS
    // («лидер между резками») заправляется ПЕРЕД КАЖДОЙ резкой, поэтому его множим на это
    // число. Нет «Кол-во план»/0 → 1 (как раньше — один лидер на резку без проходов).
    function cutLeaderRuns(cut){
        var r = stripNum(cut && cut.plannedRuns);
        return r > 0 ? Math.round(r) : 1;
    }

    // Полный setup перед резкой (#3240): лидер между резками (BETWEEN_CUTS, база × число
    // резок цуга, #3401) + переналадка с предыдущей (changeoverParts). prev=null (первая
    // резка очереди/дня) → только лидер. Σ minutes == setupMin расписания buildSchedule.
    // → [{ code, label, minutes }].
    function setupBreakdown(prev, next, times, opts){
        var parts = [];
        // #3688: лидер вынесен в КОНЕЦ резки (см. cutTimingTimelineLines) — в стартовый сетап
        // он больше не входит. Здесь только переналадка ПЕРЕД резкой (ножи + смена сырья).
        // #3669 п.2: первая задача (нет предыдущей) с флагом firstCutSetup → настройка ножей с
        // нуля; иначе — переналадка с предыдущей резкой (changeoverParts, [] для первой). Для
        // первой резки с известной заправкой станка (#3688) вызывающий передаёт carry-over как
        // prev — тогда сюда приходит непустой prev и считается обычная переналадка.
        if (!prev && opts && opts.firstCutSetup) {
            Array.prototype.push.apply(parts, firstSetupParts(next, times));
        } else {
            Array.prototype.push.apply(parts, changeoverParts(prev, next, times));
        }
        return parts;
    }

    function planningStrategy(options){
        var raw = options;
        if (options && typeof options === 'object') {
            raw = options.strategy || options.planningStrategy || options.queueStrategy || options.mode || '';
        }
        var s = String(raw == null ? '' : raw).trim().toLowerCase();
        return s === PLANNING_STRATEGY_FATIGUE ? PLANNING_STRATEGY_FATIGUE : PLANNING_STRATEGY_SETUP;
    }

    function planningStrategyLabel(strategy){
        return planningStrategy(strategy) === PLANNING_STRATEGY_FATIGUE ? 'сложные резки раньше' : 'минимум переналадок';
    }

    function fatigueOptionNumber(options, keys, fallback){
        var opts = options || {};
        for (var i = 0; i < keys.length; i++) {
            var n = Number(opts[keys[i]]);
            if (isFinite(n) && n > 0) return n;
        }
        return fallback;
    }

    function fatigueChangeTimes(options){
        if (!options) return null;
        if (options.times) return options.times;
        if (options.changeTimes) return options.changeTimes;
        if (options.opTimes) return options.opTimes;
        if (options.MATERIAL_WINDING != null || options.KNIFE != null || options.BETWEEN_CUTS != null) return options;
        return null;
    }

    function planningChangeTimes(options){
        return fatigueChangeTimes(options) || options || null;
    }

    function makePlanningOptions(strategyOrOptions, times){
        var opts = {};
        if (strategyOrOptions && typeof strategyOrOptions === 'object') {
            for (var k in strategyOrOptions) {
                if (Object.prototype.hasOwnProperty.call(strategyOrOptions, k)) opts[k] = strategyOrOptions[k];
            }
        } else if (strategyOrOptions != null && String(strategyOrOptions).trim() !== '') {
            opts.strategy = strategyOrOptions;
        }
        if (times) opts.times = times;
        opts.strategy = planningStrategy(opts);
        return opts;
    }

    function fatigueJobWidth(cut){
        var candidates = cut ? [cut.width, cut.rollerWidth, cut.widthMm, cut.rollerWidthMm] : [];
        for (var i = 0; i < candidates.length; i++) {
            var n = stripNum(candidates[i]);
            if (isFinite(n) && n > 0) return n;
        }
        return 0;
    }

    // Оценка сложности резки по ножам. Если strip-агрегация ещё не влита в очередь,
    // используем приближение из задачи: N_j ~= Wmax / W_j.
    function estimatedKnifeCount(cut, machineWidth){
        var explicit = Number(cut && cut.knifeCount);
        if (isFinite(explicit) && explicit > 0) return explicit;
        var width = fatigueJobWidth(cut);
        if (!(width > 0)) return 999;
        var maxWidth = Number(machineWidth);
        if (!isFinite(maxWidth) || maxWidth <= 0) maxWidth = FATIGUE_MACHINE_WIDTH_MM;
        return Math.max(1, Math.floor(maxWidth / width));
    }

    function fatiguePositionWeight(positionIndex, totalPositions, fatigueFactor){
        var total = Number(totalPositions) || 0;
        if (total <= 1) return 1;
        var alpha = Number(fatigueFactor);
        if (!isFinite(alpha)) alpha = FATIGUE_FACTOR;
        var idx = Number(positionIndex) || 0;
        if (idx < 0) idx = 0;
        if (idx > total - 1) idx = total - 1;
        return round3(1 + alpha * (idx / (total - 1)));
    }

    function fatigueRouteScore(route, options){
        var list = route || [];
        if (!list.length) return 0;
        var opts = options || {};
        var machineWidth = fatigueOptionNumber(opts, ['machineWidth', 'machineWidthMm', 'Wmax'], FATIGUE_MACHINE_WIDTH_MM);
        var alpha = fatigueOptionNumber(opts, ['fatigueFactor', 'alpha'], FATIGUE_FACTOR);
        var startCost = fatigueOptionNumber(opts, ['startCost', 'startCostMin'], FATIGUE_START_COST_MIN);
        var times = fatigueChangeTimes(opts);
        var total = 0;
        for (var i = 0; i < list.length; i++) {
            var transitionCost = i === 0 ? startCost : changeoverCost(list[i - 1], list[i], times);
            var knifeFactor = 1 + estimatedKnifeCount(list[i], machineWidth) / 100;
            total += transitionCost * fatiguePositionWeight(i, list.length, alpha) * knifeFactor;
        }
        return round3(total);
    }

    // ───────────────────── Хелперы генерации резок ─────────────────────

    // Строки отчёта cut_strips (JSON_KV) → { cutId: {knifeCount, knifeWidths:[...]} }.
    // cut_id — abn «Производственной резки»; strip_width — «Партия ГП» «Ширина, мм»;
    // strip_qty — число ПОЛОС за проход. #3431: источник strip_qty в серверном отчёте
    // cut_strips (queryId 8656) — «Партия ГП» «Кол-во полос» (а НЕ «Кол-во рулонов»,
    // которое теперь = полосы × проходов). Группировка по cut_id:
    //   knifeCount += Number(strip_qty);
    //   knifeWidths — Number(strip_width), развёрнутый по qty (полоса 110×2 → [110,110]),
    //   нужен для widthSetDistance в changeoverCost. Заменяет удалённую в F2 колонку
    //   cut_knives отчёта cut_planning (knifeCount теперь считается клиентом).
    // Вход не мутируется.
    function aggregateStrips(rows) {
        var out = {};
        (rows || []).forEach(function(row) {
            var cutId = String(row.cut_id == null ? '' : row.cut_id);
            if (cutId === '') return;
            if (!out[cutId]) out[cutId] = { knifeCount: 0, knifeWidths: [] };
            var qty = Number(row.strip_qty) || 0;
            var width = Number(row.strip_width) || 0;
            out[cutId].knifeCount += qty;
            for (var n = 0; n < qty; n++) out[cutId].knifeWidths.push(width);
        });
        return out;
    }

    // ── Чистая сводка по полосам редактора (зеркало cut-calc calc.*) ──
    // Модули самостоятельны: дублируем формулы из cut-calc, чтобы редактор полос
    // не зависел от загрузки cut-calc.js. Вход — массив полос [{width, qty}];
    // значения терпимо приводятся к числу (запятая → точка, мусор → 0), вход не мутируется.

    // Терпимый разбор числа: запятая как десятичный разделитель, мусор/пусто → 0.
    function stripNum(value) {
        if (typeof value === 'number') return isFinite(value) ? value : 0;
        var text = String(value == null ? '' : value).replace(/\s+/g, '').replace(',', '.');
        var n = parseFloat(text);
        return isFinite(n) ? n : 0;
    }

    // Округление до 3 знаков — убрать артефакты float-арифметики.
    function round3(n) { return Math.round(n * 1000) / 1000; }

    function truthyFlag(value) {
        if (value === true) return true;
        if (value === false || value == null) return false;
        if (typeof value === 'number') return isFinite(value) && value !== 0;
        var s = String(value).trim().toLowerCase();
        if (s === '') return false;
        if (s === '0' || s === 'false' || s === 'нет' || s === 'no' || s === 'off') return false;
        return true;
    }

    function batchIsActive(batch) {
        if (!batch || batch.active === undefined || batch.active === null || String(batch.active).trim() === '') return true;
        if (batch.active === true) return true;
        if (batch.active === false) return false;
        var s = String(batch.active).trim().toLowerCase();
        return !(s === '0' || s === 'false' || s === 'нет' || s === 'no' || s === 'off' || s === 'неактивно');
    }

    function activeReqId(meta) {
        return reqIdByName(meta, 'В работе') ||   // #3242: «Активно» переименовано в «В работе»
            reqIdByName(meta, 'Активно') ||
            reqIdByName(meta, 'Активная') ||
            reqIdByName(meta, 'Действует');
    }

    function stockPurpose(value) {
        var s = String(value == null ? '' : value).trim().toLowerCase();
        return s === 'склад' || s === 'на склад';
    }

    function isStockStrip(strip) {
        if (!strip) return false;
        return truthyFlag(strip.toStock) || stockPurpose(strip.purpose);
    }

    // ───────── «Максимальный запас» (#3391, table/67113) ─────────
    // Таблица перечисляет номенклатуры «Партии ГП», которые целесообразно нарезать
    // впрок. Излишек резки (полоса «Склад»), номенклатуры которого нет в списке,
    // на склад не идёт — это отход. Чистое ядро ниже классифицирует номенклатуру.

    // Канонический ключ номенклатуры запаса: вид сырья + ширина + длина + намотка.
    // Диаметр втулки и Лидер в ключ не входят — в контексте добора планирования они,
    // как правило, неизвестны; на них только доуточняем при наличии у обеих сторон
    // (см. maxStockMatches). Числа округляются (round3), намотка нормализуется.
    function maxStockKey(nom) {
        nom = nom || {};
        var mat = String(nom.material == null ? '' : nom.material).trim();
        var w = stripNum(nom.width);
        var len = windLengthValue(nom.length);
        return mat + '|' + (w > 0 ? round3(w) : '') + '|' +
            (len > 0 ? round3(len) : '') + '|' + normWinding(nom.winding);
    }

    // Разбор строк таблицы «Максимальный запас» (JSON_OBJ) → номенклатуры запаса.
    // Главное значение (r[0]) — максимально допустимый запас (число); реквизиты —
    // параметры «Партии ГП». Ссылочные поля (Вид сырья/Втулка/Лидер) разбираем parseRef.
    function parseMaxStockRows(rows, meta) {
        if (!meta) return [];
        var iMat = columnIndex(meta, MAX_STOCK_REQ.material);
        var iWidth = columnIndex(meta, MAX_STOCK_REQ.width);
        var iLength = columnIndex(meta, MAX_STOCK_REQ.length);
        var iWind = columnIndex(meta, MAX_STOCK_REQ.winding);
        var iSleeve = columnIndex(meta, MAX_STOCK_REQ.sleeve);
        var iLeader = columnIndex(meta, MAX_STOCK_REQ.leader);
        return (rows || []).map(function(rec) {
            var r = (rec && rec.r) || [];
            function refId(idx) { return (idx >= 0 ? (parseRef(r[idx]).id || '') : ''); }
            return {
                material: refId(iMat),
                width: iWidth >= 0 ? stripNum(r[iWidth]) : 0,
                length: iLength >= 0 ? windLengthValue(r[iLength]) : 0,
                winding: iWind >= 0 ? normWinding(r[iWind]) : '',
                sleeve: refId(iSleeve),
                leader: refId(iLeader),
                limit: stripNum(r[0])
            };
        }).filter(function(n) { return n.material !== '' || n.width > 0; });
    }

    // Индекс таблицы: { list: [номенклатуры], byKey: {ключ→макс. лимит} }.
    // empty=true → таблица не настроена/пуста, фича выключена (поведение не меняем).
    function buildMaxStockIndex(rows, meta) {
        var list = parseMaxStockRows(rows, meta);
        var byKey = {};
        list.forEach(function(n) {
            var k = maxStockKey(n);
            if (byKey[k] == null || n.limit > byKey[k]) byKey[k] = n.limit;
        });
        return { list: list, byKey: byKey, empty: list.length === 0 };
    }

    // Настроена ли таблица «Максимальный запас» (есть хотя бы одна номенклатура).
    function maxStockConfigured(index) {
        return !!(index && index.list && index.list.length);
    }

    // Строки таблицы, совпадающие с номенклатурой nom. Совпадение — по ключу
    // (сырьё/ширина/длина/намотка); втулка/лидер доуточняют, только если заданы
    // у обеих сторон (иначе игнорируются — мы их в планировании обычно не знаем).
    function maxStockMatches(index, nom) {
        if (!index || !index.list) return [];
        var key = maxStockKey(nom);
        var sleeve = String((nom && nom.sleeve) == null ? '' : nom.sleeve).trim();
        var leader = String((nom && nom.leader) == null ? '' : nom.leader).trim();
        return index.list.filter(function(n) {
            if (maxStockKey(n) !== key) return false;
            if (sleeve && n.sleeve && String(n.sleeve) !== sleeve) return false;
            if (leader && n.leader && String(n.leader) !== leader) return false;
            return true;
        });
    }

    // Максимально допустимый запас для номенклатуры nom (макс. лимит среди совпавших
    // строк) или null, если номенклатуры нет в списке (нарезать впрок нельзя).
    function maxStockLimit(index, nom) {
        var m = maxStockMatches(index, nom);
        if (!m.length) return null;
        return m.reduce(function(max, n) {
            var v = stripNum(n.limit);
            return v > max ? v : max;
        }, 0);
    }

    // Можно ли нарезать номенклатуру nom впрок (на склад). Если таблица не настроена —
    // true (фича выключена, поведение прежнее). Иначе — есть ли совпадение в списке.
    function isStockableNomenclature(index, nom) {
        if (!maxStockConfigured(index)) return true;
        return maxStockMatches(index, nom).length > 0;
    }

    // Назначение складской (необеспеченной) полосы с учётом «Максимального запаса»:
    // «Склад», если номенклатуру целесообразно хранить, иначе «Отходы».
    function stockStripPurpose(index, nom) {
        return isStockableNomenclature(index, nom) ? 'Склад' : 'Отходы';
    }

    // Фильтр ходовых ширин (добор джамбо) по «Максимальному запасу»: оставляем только
    // те, чья номенклатура (профиль резки + ширина) целесообразна к хранению. Если
    // таблица не настроена — список не меняем. profile = { material, winding, length }.
    function filterStockableWidths(index, preferred, profile) {
        if (!maxStockConfigured(index)) return (preferred || []).slice();
        profile = profile || {};
        return (preferred || []).filter(function(p) {
            return isStockableNomenclature(index, {
                material: profile.material,
                width: p && p.width,
                length: profile.length,
                winding: profile.winding
            });
        });
    }

    // ───────── Лимит запаса (#3445): остаток склада + capping ─────────
    // PR #3395/#3391 решал ЧЛЕНСТВО (Склад vs Отходы). #3445 добавляет КОЛИЧЕСТВЕННЫЙ
    // лимит: на склад по номенклатуре нельзя нарезать больше «Максимального запаса»
    // (первая колонка) с учётом того, что уже лежит на складе.

    // Текущий остаток ГП: суммарные рулоны «Партий ГП», физически лежащих на складе
    // (статус не «Отгружен»), по номенклатуре. batches: [{ material, width, length,
    // winding, rolls, shipped }]; ключ — тот же maxStockKey (сырьё|ширина|длина|намотка).
    function buildStockBalanceIndex(batches) {
        var byKey = {};
        (batches || []).forEach(function(b) {
            if (!b || b.shipped) return;
            var rolls = stripNum(b.rolls);
            if (!(rolls > 0)) return;
            var k = maxStockKey(b);
            byKey[k] = round3((byKey[k] || 0) + rolls);
        });
        return { byKey: byKey };
    }

    // Текущий остаток (рулонов) по номенклатуре nom; 0, если на складе ничего нет.
    function currentStock(balanceIndex, nom) {
        if (!balanceIndex || !balanceIndex.byKey) return 0;
        var v = balanceIndex.byKey[maxStockKey(nom)];
        return v > 0 ? v : 0;
    }

    // Свободный остаток лимита (рулонов) — на сколько ещё можно нарезать впрок:
    // maxStockLimit − текущий остаток (не отрицателен). null — если номенклатуры нет
    // в «Максимальном запасе» (количественного лимита нет; членство решает #3391).
    function stockHeadroom(maxStockIndex, balanceIndex, nom) {
        var limit = maxStockLimit(maxStockIndex, nom);
        if (limit == null) return null;
        var head = round3(limit - currentStock(balanceIndex, nom));
        return head > 0 ? head : 0;
    }

    // Обрезать планируемые НА СКЛАД рулоны по «Максимальному запасу» (#3445, capping).
    // Складские рулоны = перепроизводство заказных ширин (qty×проходов − спрос) + добор
    // ходовыми (полосы «Склад»). По каждой номенклатуре их суммарно (по всем раскладкам)
    // ≤ headroom (свободный остаток лимита). Заказное покрытие НЕ трогаем — режем только
    // излишек впрок; добор режем раньше перепроизводства (ходовые наиболее спекулятивны).
    // Лишнее не нарезается (уходит в остаток джамбо). МУТИРУЕТ strip.qty и убирает
    // обнулённые складские полосы. ctx:
    //   runsForLayout(layout)          → число проходов (≥1);
    //   demandRollsForWidth(layout, w) → рулонов заказа по ширине w в этой раскладке;
    //   headroomForNom(nom)            → рулонов | null (null = без лимита, ширину пропускаем).
    // → { trimmed: [{ key, width, kind:'добор'|'перепроизводство', droppedRolls }] }.
    function capStockToHeadroom(layouts, ctx) {
        var remaining = {};   // key → остаток лимита (рулонов), копится по раскладкам
        var trimmed = [];
        function ensure(key, head) {
            if (!(key in remaining)) remaining[key] = head > 0 ? head : 0;
            return remaining[key];
        }
        (layouts || []).forEach(function(layout) {
            var runs = Math.ceil(Number(ctx.runsForLayout(layout)) || 1);
            if (!(runs >= 1)) runs = 1;
            var strips = (layout && layout.strips) || [];
            // Сгруппировать полосы раскладки по ширине: заказная + складская.
            var byWidth = {};
            var order = [];
            strips.forEach(function(s) {
                if (s && s.core) return;   // #3812: втулочные полосы не урезаются по запасу
                var w = round3(Number(s.width) || 0);
                if (w <= 0) return;
                var key = String(w);
                if (!byWidth[key]) { byWidth[key] = { width: w, order: null, stock: null }; order.push(key); }
                if (isStockStrip(s)) byWidth[key].stock = s; else byWidth[key].order = s;
            });
            order.forEach(function(wKey) {
                var g = byWidth[wKey];
                var nom = { material: layout.mat, width: g.width, length: layout.windLength, winding: layout.windDir };
                var head = ctx.headroomForNom(nom);
                if (head == null) return;   // нет количественного лимита — ширину не трогаем
                var key = maxStockKey(nom);
                ensure(key, head);
                // 1) добор (полосы «Склад»): весь объём — впрок, режем первым.
                if (g.stock) {
                    var producedS = round3((Number(g.stock.qty) || 0) * runs);
                    if (producedS > remaining[key]) {
                        var allowedQtyS = Math.floor(remaining[key] / runs);
                        if (allowedQtyS < 0) allowedQtyS = 0;
                        var droppedS = round3((Number(g.stock.qty) || 0) * runs - allowedQtyS * runs);
                        g.stock.qty = allowedQtyS;
                        if (droppedS > 0) trimmed.push({ key: key, width: g.width, kind: 'добор', droppedRolls: droppedS });
                        remaining[key] = round3(remaining[key] - allowedQtyS * runs);
                    } else {
                        remaining[key] = round3(remaining[key] - producedS);
                    }
                }
                // 2) перепроизводство заказной ширины (qty×проходов − спрос): режем до
                //    минимума, покрывающего заказ (ceil(спрос/проходов)).
                if (g.order) {
                    var demand = round3(Number(ctx.demandRollsForWidth(layout, g.width)) || 0);
                    var qtyO = Number(g.order.qty) || 0;
                    var producedO = round3(qtyO * runs);
                    var excess = round3(producedO - demand);
                    if (excess > 0) {
                        if (excess > remaining[key]) {
                            var minQty = Math.ceil(demand / runs);
                            if (!(minQty >= 1)) minQty = (demand > 0 ? 1 : 0);
                            var allowedQtyO = minQty + Math.floor(remaining[key] / runs);
                            if (allowedQtyO < minQty) allowedQtyO = minQty;
                            if (allowedQtyO > qtyO) allowedQtyO = qtyO;
                            var droppedO = round3((qtyO - allowedQtyO) * runs);
                            if (droppedO > 0) {
                                g.order.qty = allowedQtyO;
                                trimmed.push({ key: key, width: g.width, kind: 'перепроизводство', droppedRolls: droppedO });
                            }
                            var newExcess = round3(Math.max(0, allowedQtyO * runs - demand));
                            remaining[key] = round3(remaining[key] - newExcess);
                        } else {
                            remaining[key] = round3(remaining[key] - excess);
                        }
                    }
                }
                if (remaining[key] < 0) remaining[key] = 0;
            });
            // Убрать обнулённые складские полосы (заказные с qty≥1 сохраняем).
            if (layout && layout.strips) {
                layout.strips = layout.strips.filter(function(s) {
                    return !(isStockStrip(s) && (Number(s.qty) || 0) <= 0);
                });
            }
        });
        return { trimmed: trimmed };
    }

    function positionMap(positions) {
        if (!positions) return {};
        if (!Array.isArray(positions)) return positions;
        var map = {};
        positions.forEach(function(p) {
            if (p && p.id != null && String(p.id) !== '') map[String(p.id)] = p;
        });
        return map;
    }

    function stripWidthKey(width) {
        return String(round3(Number(width) || 0));
    }

    // ── #3372: фактическая ширина резки ──────────────────────────────────────
    // Справочник «Фактическая ширина резки» (table 66190) задаёт пары
    // номинал («Ширина в заказе») → факт (главное значение записи) с условием в
    // поле «Код»: '' (пусто) — безусловно; 'j=910'/'j>1000' — по ширине джамбо
    // вида сырья; 's=0.5'/'s=1' — по диаметру втулки в дюймах (8188 «Дюймы»).
    // Поддержаны операторы = > < >= <=. ⚠️ Жёсткий фильтр (#3372): факт. ширина
    // применяется ТОЛЬКО при выполнении условия, иначе берётся номинал заказа.
    function parseActualWidthCode(code) {
        var c = String(code == null ? '' : code).trim().toLowerCase().replace(/\s+/g, '');
        if (!c) return { key: '', op: '', val: 0 };           // безусловно
        var m = c.match(/^([js])(>=|<=|=|>|<)(\d+(?:\.\d+)?)$/);
        if (!m) return { key: '?', op: '', val: 0 };          // нераспознан → не применяем
        return { key: m[1], op: m[2], val: Number(m[3]) };
    }

    // ctx: { jumbo, inches } (любое поле может быть null/undefined). key 'j' →
    // сверяем с jumbo (ширина джамбо), 's' → с inches (дюймы втулки).
    // '' → всегда true; '?' → всегда false (жёсткий фильтр).
    function actualWidthCodeMatches(parsed, ctx) {
        if (!parsed || parsed.key === '') return true;
        if (parsed.key === '?') return false;
        var v = parsed.key === 'j' ? (ctx && ctx.jumbo) : (ctx && ctx.inches);
        if (v == null || v === '' || !isFinite(Number(v))) return false;
        v = Number(v);
        switch (parsed.op) {
            case '=':  return Math.abs(v - parsed.val) < 1e-6;
            case '>':  return v > parsed.val + 1e-9;
            case '<':  return v < parsed.val - 1e-9;
            case '>=': return v >= parsed.val - 1e-9;
            case '<=': return v <= parsed.val + 1e-9;
        }
        return false;
    }

    // rows: [{ actual, order, code }] из справочника → индекс
    // { stripWidthKey(order): [{ actual, parsed }] }. Условные строки идут раньше
    // безусловных — приоритет более специфичного правила при совпадении номинала.
    function buildActualWidthIndex(rows) {
        var index = {};
        (rows || []).forEach(function(row) {
            var order = Number(row && row.order);
            var actual = Number(row && row.actual);
            if (!isFinite(order) || order <= 0 || !isFinite(actual) || actual <= 0) return;
            var key = stripWidthKey(order);
            // #3408: храним и сам номинал (order), чтобы по факт.ширине восстановить
            // номинал в сводке полос (resolveNominalWidth) — полосы хранят факт.ширину.
            (index[key] || (index[key] = [])).push({ order: order, actual: actual, parsed: parseActualWidthCode(row.code) });
        });
        Object.keys(index).forEach(function(key) {
            index[key].sort(function(a, b) {
                return (b.parsed.key !== '' ? 1 : 0) - (a.parsed.key !== '' ? 1 : 0);
            });
        });
        return index;
    }

    // Фактическая ширина резки для номинальной ширины заказа с учётом контекста
    // позиции (ширина джамбо вида сырья, диаметр втулки в дюймах). Нет правила или
    // ни одно условие не выполнено → возвращаем номинал как есть (жёсткий фильтр).
    function resolveCutWidth(nominalWidth, ctx, index) {
        var n = Number(nominalWidth);
        if (!isFinite(n) || n <= 0) return nominalWidth;
        var rows = (index && index[stripWidthKey(n)]) || [];
        for (var i = 0; i < rows.length; i++) {
            if (actualWidthCodeMatches(rows[i].parsed, ctx)) {
                var w = Number(rows[i].actual);
                return isFinite(w) && w > 0 ? w : n;
            }
        }
        return n;
    }

    // #3408: обратный резолв к resolveCutWidth — по ФАКТИЧЕСКОЙ ширине вернуть номинал
    // заказа. Полосы резки (Партии ГП) хранят факт.ширину (#3372: p.width = факт.),
    // поэтому в сводке полос («сначала номинал, потом реальные мм») номинал нужно
    // восстановить. Берём правило справочника, чья факт.ширина равна заданной и условие
    // выполнено в этом контексте; условные правила приоритетнее безусловных (как в
    // прямом резолве). Нет совпадения — возвращаем факт. как есть (ширина не
    // корректировалась → номинал == факт.).
    function resolveNominalWidth(actualWidth, ctx, index) {
        var a = Number(actualWidth);
        if (!isFinite(a) || a <= 0) return actualWidth;
        var best = null, bestConditional = -1;
        Object.keys(index || {}).forEach(function(key) {
            (index[key] || []).forEach(function(entry) {
                if (Math.abs(Number(entry.actual) - a) > 1e-6) return;
                if (!actualWidthCodeMatches(entry.parsed, ctx)) return;
                var cond = (entry.parsed && entry.parsed.key !== '') ? 1 : 0;
                if (cond > bestConditional) { bestConditional = cond; best = entry.order; }
            });
        });
        return best != null ? best : a;
    }

    // ── #3812: втулочные полосы для втулки 0.5″ шириной 110 мм ────────────────
    // На втулке 0.5″ риббон у́же 55 мм не производится (ограниченная размерная
    // сетка). При ширине втулки 110 мм в раскрой добавляются полосы 110 мм:
    // продуктовая ширина 55–57 → 2 полосы; 63–64 → 1 полоса; иначе (58–62, 65–70,
    // >70) — полос нет (>70 режется по обычному правилу втулки 1″). Полосы 110 мм
    // занимают ширину джамбо той же резки (резервируются ДО укладки продукта).

    // Ширина втулки из названия записи «Диаметр втулки» (фолбэк к реквизиту):
    // «Втулка картонная 0.5" ширина 110 мм» → 110. Нет шаблона → null.
    function parseSleeveWidthFromName(name) {
        var m = String(name == null ? '' : name).match(/ширина\s*(\d+(?:[.,]\d+)?)\s*мм/i);
        if (!m) return null;
        var n = Number(m[1].replace(',', '.'));
        return isFinite(n) && n > 0 ? n : null;
    }

    // Позицию можно произвести? Втулка 0.5″ запрещает ширину < 55 мм.
    function isSleeveWidthProducible(inches, orderWidth) {
        var w = Number(orderWidth);
        if (Number(inches) === 0.5 && isFinite(w) && w < 55) return false;
        return true;
    }

    // План втулочных полос для раскроя: { stripWidth, count }. Срабатывает только
    // для втулки 0.5″ шириной 110 мм. orderWidths — НОМИНАЛЬНЫЕ ширины продукта в
    // раскрое (резка разбита по count в профиле, поэтому ширины одного диапазона).
    function sleeveCoreStripPlan(inches, coreWidthMm, orderWidths) {
        var none = { stripWidth: 0, count: 0 };
        if (Number(inches) !== 0.5 || Number(coreWidthMm) !== 110) return none;
        var ws = (orderWidths || []).map(Number).filter(function(w) { return isFinite(w) && w > 0; });
        if (!ws.length) return none;
        var allIn = function(lo, hi) {
            return ws.every(function(w) { return w >= lo - 1e-9 && w <= hi + 1e-9; });
        };
        if (allIn(55, 57)) return { stripWidth: 110, count: 2 };
        if (allIn(63, 64)) return { stripWidth: 110, count: 1 };
        return none;
    }

    // Дописать в раскрой втулочные полосы (#3812). Помечаем core:true — раскрой их
    // показывает «Партией ГП» (Σ ширина×полос ≤ ширина джамбо), но capStockToHeadroom
    // их не урезает и не считает перепроизводством, а число проходов от них не зависит
    // (проходы по продукту, см. plannedRunsForLayout). Идемпотентно: повторная ширина не двоится.
    //
    // #3872: если 110-мм втулки уже заказаны (есть позиции заказа той же ширины — обычно в том
    // же заказе), полосы ПРИВЯЗЫВАЮТСЯ к этим позициям (fillerPositionIds): полоса несёт их id,
    // а сами позиции добавляются в positionsCovered — резка их обеспечивает (на произведённое
    // min(заказ, полосы×проходов), излишек в запас). Нет таких позиций → fillerPositionIds пуст,
    // полоса синтетическая (positionIds: []), поведение #3812. core:true остаётся в обоих случаях
    // (проходы не растут от 110 мм — фикс. число полос задаёт продукт-носитель).
    function appendCoreStrip(layout, coreWidth, count, fillerPositionIds) {
        if (!layout || !(count > 0) || !(coreWidth > 0)) return layout;
        layout.strips = layout.strips || [];
        var w = round3(coreWidth);
        var ids = (fillerPositionIds || []).map(String);
        if (ids.length) {
            layout.positionsCovered = layout.positionsCovered || [];
            ids.forEach(function(id) { if (layout.positionsCovered.indexOf(id) < 0) layout.positionsCovered.push(id); });
        }
        for (var i = 0; i < layout.strips.length; i++) {
            var s = layout.strips[i];
            if (s && s.core && round3(s.width) === w) {
                s.qty = count;
                if (ids.length) s.positionIds = ids.slice();
                return layout;
            }
        }
        layout.strips.push({ width: w, qty: count, purpose: 'Заказ', core: true, positionIds: ids.slice() });
        return layout;
    }

    // #3872: позиция заказа подходит под «втулочную полосу» носителя (group), если её можно
    // отрезать тем же джамбо (то же сырьё/намотка/длина), её фактическая ширина = ширине полосы
    // (coreStripWidth, 110 мм), она производима и сама не требует втулочных полос. Такие позиции
    // резка-носитель использует вместо синтетических полос. Чистая (тест).
    function isCoreStripFiller(position, group) {
        if (!position || !group) return false;
        if (!(Number(group.coreStripCount) > 0) || !(Number(group.coreStripWidth) > 0)) return false;
        if (position.producible === false) return false;
        if (Number(position.coreStripCount) > 0) return false;   // сам носитель — не филлер
        if (round3(Number(position.width) || 0) !== round3(Number(group.coreStripWidth) || 0)) return false;
        if (String(position.materialId == null ? '' : position.materialId) !== String(group.materialId == null ? '' : group.materialId)) return false;
        if (normWinding(position.windDir) !== normWinding(group.windDir)) return false;
        if (windLengthValue(position.windLength) !== windLengthValue(group.windLength)) return false;
        return true;
    }

    // #3872: выбрать позиции заказа, которые раскладка-носитель забирает под втулочные полосы.
    // Кандидаты — необеспеченные позиции (candidates); берём подходящие группе (isCoreStripFiller),
    // чей заказ ПОКРЫТ этой раскладкой (coveredOrderIds), и ещё не забранные (claimed). Помечает
    // выбранные в claimed (мутирует), чтобы одна 110-мм позиция не ушла в две резки. → [positionId].
    function selectCoreStripFillers(candidates, group, coveredOrderIds, claimed) {
        var picked = [];
        var orders = coveredOrderIds || {};
        var taken = claimed || {};
        (candidates || []).forEach(function(p) {
            if (!p || p.id == null) return;
            var id = String(p.id);
            if (taken[id]) return;
            if (!orders[String(p.orderId)]) return;
            if (!isCoreStripFiller(p, group)) return;
            taken[id] = true;
            picked.push(id);
        });
        return picked;
    }

    function nonStockStripQtyForWidth(layout, width) {
        var key = stripWidthKey(width);
        return (layout && layout.strips || []).reduce(function(sum, s) {
            if (isStockStrip(s)) return sum;
            return stripWidthKey(s.width) === key ? sum + (Number(s.qty) || 0) : sum;
        }, 0);
    }

    // #3812/#3872: ширины, обслуживаемые ТОЛЬКО втулочными полосами (core) и ни одной обычной
    // полосой. Их потребность не определяет число проходов: фикс. число полос задаёт продукт-
    // носитель, а позиции 110 мм обеспечиваются на произведённое (см. plannedRunsForLayout).
    function coreOnlyStripWidths(layout) {
        var core = {}, nonCore = {};
        (layout && layout.strips || []).forEach(function(s) {
            if (!s) return;
            var key = stripWidthKey(s.width);
            if (s.core) core[key] = true;
            else if (!isStockStrip(s)) nonCore[key] = true;
        });
        var out = {};
        Object.keys(core).forEach(function(k) { if (!nonCore[k]) out[k] = true; });
        return out;
    }

    function plannedRunsForLayout(layout, positions) {
        var direct = Number(layout && (layout.plannedRuns || layout.runCount || layout.runs));
        if (isFinite(direct) && direct > 0) return Math.ceil(direct);
        var byId = positionMap(positions);
        var coreOnly = coreOnlyStripWidths(layout);   // #3872: 110-мм позиции не двигают проходы
        var demandByWidth = {};
        (layout && layout.positionsCovered || []).forEach(function(pid) {
            var p = byId[String(pid)];
            if (!p) return;
            var w = Number(p.width) || 0;
            var qty = Number(p.qty) || 0;
            if (w <= 0 || qty <= 0) return;
            var key = stripWidthKey(w);
            if (coreOnly[key]) return;   // #3872: ширина только из втулочных полос — проходы по продукту
            demandByWidth[key] = (demandByWidth[key] || 0) + qty;
        });
        var runs = 1;
        Object.keys(demandByWidth).forEach(function(key) {
            var out = nonStockStripQtyForWidth(layout, key);
            if (out > 0) runs = Math.max(runs, Math.ceil(demandByWidth[key] / out));
        });
        return runs;
    }

    // #3435: рулоны обеспечения позиции = её заказанное кол-во, НО не больше выпуска
    // этой ширины (runs × полос). Несколько позиций одной ширины делят выпуск по своему
    // заказу, а не получают каждая полный выпуск (иначе спрос/обеспечение задваивались —
    // у партии на 2 заказа «Кол-во рулонов» = 2 × «Кол-во план»). Излишек выпуска над
    // заказом — в запас. qty неизвестно (≤0) → весь выпуск ширины (прежнее поведение).
    function supplyRollsForPosition(layout, position, plannedRuns) {
        if (!position) return 0;
        var runs = Number(plannedRuns) || 0;
        if (runs <= 0) runs = plannedRunsForLayout(layout, [position]);
        var strips = nonStockStripQtyForWidth(layout, position.width);
        var produced = round3(runs * strips);
        var qty = Number(position.qty) || 0;
        return qty > 0 ? Math.min(qty, produced) : produced;
    }

    function layoutRunLength(layout, positions) {
        var direct = Number(layout && (layout.runLength || layout.length));
        if (isFinite(direct) && direct > 0) return direct;
        var byId = positionMap(positions);
        var out = 0;
        (layout && layout.positionsCovered || []).forEach(function(pid) {
            var p = byId[String(pid)];
            var len = Number(p && p.length) || 0;
            if (len > out) out = len;
        });
        return out;
    }

    // #3242/#3253: состав резки = «Партия ГП» по каждой РАЗЛИЧНОЙ ширине. Храним
    // «количество ПОЛОС за один проход» (Σ полос этой ширины), БЕЗ умножения на проходы —
    // это геометрия раскроя (Σ ширина×полос ≤ ширина джамбо). Число рулонов (полос ×
    // проходов) — производная величина, отдельно не храним. → [{ width, strips, length }]
    // по порядку первого появления ширины.
    function producedBatchesForLayout(layout, runLength) {
        var len = Number(runLength) || 0;
        var byWidth = {};
        var order = [];
        (layout && layout.strips || []).forEach(function(s) {
            var width = Number(s.width) || 0;
            var qty = Number(s.qty) || 0;
            if (width <= 0 || qty <= 0) return;
            var key = stripWidthKey(width);
            if (!(key in byWidth)) { byWidth[key] = { width: width, strips: 0, length: len }; order.push(key); }
            byWidth[key].strips = round3(byWidth[key].strips + qty);
        });
        return order.map(function(k) { return byWidth[k]; });
    }

    // #3242: план обеспечений резки — каждая покрытая позиция ссылается на «Партию ГП»
    // своей ширины, забирая supplyRollsForPosition рулонов и метраж позиции (posLength).
    // → [{ positionId, width, rolls, footage }] (позиции с нулевыми рулонами пропускаются).
    function supplyPlanForLayout(layout, positions, plannedRuns, posLength) {
        var byId = positionMap(positions);
        var out = [];
        (layout && layout.positionsCovered || []).forEach(function(pid) {
            var p = byId[String(pid)];
            if (!p) return;
            var rolls = supplyRollsForPosition(layout, p, plannedRuns);
            if (!(rolls > 0)) return;
            var len = posLength ? (Number(posLength[String(pid)]) || 0) : (Number(p.length) || 0);
            out.push({ positionId: String(pid), width: Number(p.width) || 0, rolls: rolls, footage: len });
        });
        return out;
    }

    function finishedBatchesForLayout(layout, cutId, runLength, plannedRuns) {
        var runs = Number(plannedRuns) || plannedRunsForLayout(layout, {});
        var len = Number(runLength) || 0;
        var out = [];
        (layout && layout.strips || []).forEach(function(s) {
            if (!isStockStrip(s)) return;
            var width = Number(s.width) || 0;
            var rolls = round3((Number(s.qty) || 0) * runs);
            if (width <= 0 || rolls <= 0) return;
            out.push({ cutId: String(cutId), width: width, rolls: rolls, length: len });
        });
        return out;
    }

    // #3340: задание на втулки нужно позициям, у которых есть тип втулки (sleeveId)
    // и он НЕ «готов» (sleeveReady пуст). qty = кол-во рулонов покрытия позиции.
    // → [{ positionId, sleeveId, qty }].
    function positionSleeveTasksForLayout(layout, positions, plannedRuns) {
        var byId = positionMap(positions);
        var out = [];
        (layout && layout.positionsCovered || []).forEach(function(pid) {
            var positionId = String(pid);
            var p = byId[positionId];
            if (!p) return;
            var sleeveId = p.sleeveId == null ? '' : String(p.sleeveId).trim();
            if (!sleeveId) return;        // у позиции нет втулки
            if (p.sleeveReady) return;    // тип втулки уже нарезан — задание не нужно
            var qty = supplyRollsForPosition(layout, p, plannedRuns);
            if (qty <= 0) return;
            out.push({ positionId: positionId, sleeveId: sleeveId, qty: qty });
        });
        return out;
    }

    // #3340: FIFO-партия втулок для типа sleeveId из отчёта sleeve_batches_active.
    // Отбираем партии «в работе» с совпадающим «Диаметр втулки», берём самую раннюю
    // по дате (dateKey, Unix). batches: [{ id, diameterId, dateKey, active }].
    // → id партии (строка) или '' если подходящей нет.
    function pickSleeveBatchId(batches, sleeveId) {
        var sid = sleeveId == null ? '' : String(sleeveId).trim();
        if (!sid) return '';
        var best = null;
        (batches || []).forEach(function(b) {
            if (!b || !b.active) return;
            if (String(b.diameterId == null ? '' : b.diameterId).trim() !== sid) return;
            if (best == null || (Number(b.dateKey) || 0) < (Number(best.dateKey) || 0)) best = b;
        });
        return best ? String(best.id) : '';
    }

    function sleeveMinutes(qty, opTimes) {
        var one = Number(opTimes && opTimes.SLEEVE_CUT) || 0;
        return round3((Number(qty) || 0) * one);
    }

    // Точки «намотка N метров → минуты» из кодов WIND_<метры> таблицы времён операций
    // (WIND_300=1.2 … WIND_1100=5.6). Спец-коды (WIND_FOIL_305, WIND_05_110) не парсятся
    // как серия — это отдельные режимы (учтём позже). → [{m, min}] по возрастанию метров.
    function windingPointsFromTimes(opTimes){
        var pts = [];
        Object.keys(opTimes || {}).forEach(function(code){
            var m = /^WIND_(\d+)$/.exec(code);
            if (m) pts.push({ m: Number(m[1]), min: Number(opTimes[code]) || 0 });
        });
        pts.sort(function(a, b){ return a.m - b.m; });
        // #3606: фольга наматывается медленнее — отдельная серия WIND_FOIL_<метры>
        // (в данных только WIND_FOIL_305=4). Прикрепляем её к набору, чтобы выбирать
        // для резок-фольги (cut.isFoil по position_material_type), не меняя сигнатуры.
        pts.foil = foilWindingPointsFromTimes(opTimes);
        return pts;
    }

    // #3606: точки намотки ФОЛЬГИ из кодов WIND_FOIL_<метры>. #3742: норма «4 мин за каждые
    // 305 м» считается БЛОКАМИ (foilWindingMinutes), а не пропорцией: проход короче нормы всё
    // равно стоит полную норму (122м→4, 305→4, 400→8, 610→8). Помечаем foil:true — по флагу
    // windingMinutes выбирает блочную модель и подпись нормы. Нет кодов WIND_FOIL_ → [].
    function foilWindingPointsFromTimes(opTimes){
        var pts = [];
        Object.keys(opTimes || {}).forEach(function(code){
            var m = /^WIND_FOIL_(\d+)$/.exec(code);
            if (m) pts.push({ m: Number(m[1]), min: Number(opTimes[code]) || 0, foil: true });
        });
        pts.sort(function(a, b){ return a.m - b.m; });
        return pts;
    }

    // #3606: точки намотки для конкретной резки — фольговые при cut.isFoil (если серия
    // WIND_FOIL_ задана), иначе обычные. windPoints.foil прикреплён в windingPointsFromTimes.
    function windPointsForCut(isFoil, windPoints){
        if (isFoil && windPoints && windPoints.foil && windPoints.foil.length) return windPoints.foil;
        return windPoints || [];
    }

    // #3742: намотка ФОЛЬГИ — БЛОКАМИ, не пропорцией. Норма WIND_FOIL_<метры>=<мин> читается
    // как «<мин> за каждые НАЧАТЫЕ <метры>»: время прохода = ceil(метраж / <метры>) × <мин>.
    // Короткий проход всё равно стоит полную норму (122 м при норме 305 м = 4 мин, а не 1.6;
    // 400 м = 8 мин — начат второй блок). Блок = наименьшая по метражу точка серии. Нет
    // нормы / метраж ≤ 0 → 0.
    function foilWindingMinutes(runMeters, foilPoints){
        var x = Number(runMeters) || 0;
        if (x <= 0) return 0;
        var ref = (foilPoints || []).filter(function(p){ return Number(p.m) > 0; })
            .sort(function(a, b){ return a.m - b.m; })[0];
        if (!ref) return 0;
        return round3(Math.ceil(x / Number(ref.m)) * (Number(ref.min) || 0));
    }

    // Время намотки runMeters (мин) по точкам — кусочно-линейно: ниже первой точки —
    // пропорционально от 0; между точками — линейно; выше последней — экстраполяция по
    // последнему отрезку (при одной точке — клампим). #3742: точки фольги (флаг foil) —
    // блочная модель foilWindingMinutes, а не интерполяция. Нет точек / runMeters≤0 → 0.
    function windingMinutes(runMeters, points){
        var x = Number(runMeters) || 0;
        var p = (points || []).slice().sort(function(a, b){ return a.m - b.m; });
        if (!p.length || x <= 0) return 0;
        if (p.some(function(q){ return q.foil; })) return foilWindingMinutes(x, p);   // #3742: фольга — блоками
        if (x <= p[0].m) return round3(p[0].min * (x / p[0].m));
        for (var i = 1; i < p.length; i++){
            if (x <= p[i].m){
                var t = (x - p[i-1].m) / (p[i].m - p[i-1].m);
                return round3(p[i-1].min + t * (p[i].min - p[i-1].min));
            }
        }
        if (p.length < 2) return round3(p[p.length-1].min);
        var a = p[p.length-2], b = p[p.length-1];
        var slope = (b.min - a.min) / (b.m - a.m);
        return round3(b.min + slope * (x - b.m));
    }

    function plannedCutDurationMinutes(runMeters, plannedRuns, opTimes, isFoil) {
        var runs = Number(plannedRuns) || 0;
        if (runs <= 0) return 0;
        var pts = windPointsForCut(isFoil, windingPointsFromTimes(opTimes || {})); // #3606: фольга — своя норма
        return round3(windingMinutes(runMeters, pts) * runs);
    }

    // Норма(ы) намотки, реально применённые для метража runMeters (зеркало windingMinutes,
    // #3240 «привести только ту, которая здесь подходит»):
    //   точное совпадение точки → [та точка]; ниже первой → [первая] (пропорция от 0);
    //   между точками → [нижняя, верхняя] (интерполяция); выше последней → [предпоследняя,
    //   последняя] (экстраполяция). Нет точек / runMeters≤0 → []. → подмножество points.
    function relevantWindingNorms(runMeters, points){
        var x = Number(runMeters) || 0;
        var p = (points || []).slice().sort(function(a, b){ return a.m - b.m; });
        if (!p.length || x <= 0) return [];
        for (var k = 0; k < p.length; k++){ if (p[k].m === x) return [p[k]]; }
        if (x <= p[0].m) return [p[0]];
        for (var i = 1; i < p.length; i++){ if (x <= p[i].m) return [p[i-1], p[i]]; }
        return p.length >= 2 ? [p[p.length-2], p[p.length-1]] : [p[p.length-1]];
    }

    // norms → строка «Норма намотки: WIND_600=4 мин» (одна) либо «Нормы намотки:
    // WIND_600=4 мин; WIND_900=5 мин (интерполяция)» (две). Пусто → ''.
    function formatWindingNorms(norms){
        var items = (norms || []).filter(function(n){ return Number(n.m) > 0; }) // пропускаем нулевые опорные точки
            .map(function(n){ return (n.foil ? 'WIND_FOIL_' : 'WIND_') + formatTimingNumber(n.m) + '=' + formatTimingNumber(n.min) + ' мин'; });
        if (!items.length) return '';
        if (items.length === 1) return 'Норма намотки: ' + items[0];
        return 'Нормы намотки: ' + items.join('; ') + ' (интерполяция)';
    }

    function formatTimingNumber(value) {
        return String(round3(Number(value) || 0));
    }

    function cutTimingDetails(runMeters, plannedRuns, opTimes, isFoil) {
        var length = stripNum(runMeters);
        var runs = stripNum(plannedRuns);
        if (!(length > 0) || !(runs > 0)) return '';
        var points = windPointsForCut(isFoil, windingPointsFromTimes(opTimes || {})); // #3606: фольга — своя норма
        if (!points.length) return '';
        var oneRun = windingMinutes(length, points);
        var total = round3(oneRun * runs);
        if (!(oneRun > 0) || !(total > 0)) return '';
        return [
            'Метраж прохода: ' + formatTimingNumber(length) + ' м',
            'Плановых проходов: ' + formatTimingNumber(runs),
            'Намотка 1 прохода: ' + formatTimingNumber(oneRun) + ' мин',
            'Итого резка: ' + formatTimingNumber(oneRun) + ' * ' + formatTimingNumber(runs) + ' = ' + formatTimingNumber(total) + ' мин',
            formatWindingNorms(relevantWindingNorms(length, points))
        ].join('\n');
    }

    function cutTimingModalText(cut) {
        var text = String(cut && cut.timing != null ? cut.timing : '').trim();
        return text || 'Тайминг резки не заполнен';
    }

    // Заголовок модалки тайминга (#3240). Авто-номер резки = метка времени создания
    // («08.06.2026 11:37») — для пользователя это шум, поэтому такой номер не показываем;
    // вместо него — сырьё и намотка для опознания резки. Человекочитаемый номер (не
    // timestamp) оставляем. → «Тайминг резки · MW308 · намотка IN».
    function cutTimingModalTitle(cut) {
        var rawNo = cut && cut.number;
        var s = rawNo == null ? '' : String(rawNo).trim();
        var no = (s !== '' && !isTimestampCutNumber(s)) ? formatCutNumber(rawNo) : '';
        var material = (cut && (cut.materialName || (cut.materialId ? '#' + cut.materialId : ''))) || '';
        var winding = normWinding(cut && cut.winding);
        var parts = ['Тайминг резки'];
        if (no) parts.push('№ ' + no);
        if (material) parts.push(material);
        if (winding) parts.push('намотка ' + winding);
        return parts.join(' · ');
    }

    // Строки тайминга окна резки для модалки (#3240, DOM-независимо — рендер в openCutTiming).
    // Включает время на смену сырья/типа/ножи и лидер (setupParts) хронологически от старта
    // окна, «Итого резка» выделяется жирным (bold). ctx: { length, runs, oneRun, total,
    // setupParts:[{label,minutes}], norms:[{m,min}], startMin, finishMin }. → [{ text, bold }].
    function cutTimingTimelineLines(ctx) {
        ctx = ctx || {};
        var length = stripNum(ctx.length);
        var runs = stripNum(ctx.runs);
        var oneRun = round3(Number(ctx.oneRun) || 0);
        var total = round3(Number(ctx.total) || 0);
        var setupParts = ctx.setupParts || [];
        // #3889: сегмент НАСТРОЙКИ (0 проходов) — последняя резка смены, не успевшая начаться:
        // в этот день делается только переналадка (ножи/сырьё), а намотка переносится на
        // продолжение следующего рабочего дня. Раньше модалка печатала «Итого резка: X * 0 = X»
        // (бессмысленно) и не объясняла, что задание продолжится — отсюда вопросы заказчика #3889.
        var setupOnly = ctx.setupOnly === true || !(runs > 0);
        var lines = [];
        // #3889: продолжение предыдущего рабочего дня (тот же логический задание, ножи на станке) —
        // тег сверху, чтобы было видно, что настройка уже выполнена накануне (см. daySplitBadges).
        if (ctx.continuesFromPrevDay) {
            lines.push({ text: '↩ Продолжение резки предыдущего рабочего дня (ножи на станке).', bold: true });
        }
        lines.push({ text: 'Метраж прохода: ' + formatTimingNumber(length) + ' м' });
        lines.push({ text: 'Плановых проходов: ' + formatTimingNumber(runs) });
        if (!setupOnly) {
            lines.push({ text: 'Намотка 1 прохода: ' + formatTimingNumber(oneRun) + ' мин' });
            var normLine = formatWindingNorms(ctx.norms);
            if (normLine) lines.push({ text: normLine });
        }
        lines.push({ text: '' });
        lines.push({ text: 'Тайминг окна:' });
        var setupTotal = setupParts.reduce(function(sum, p){ return sum + (Number(p.minutes) || 0); }, 0);
        var hasStart = ctx.startMin != null && isFinite(Number(ctx.startMin));
        var clock = hasStart ? round3(Number(ctx.startMin) - setupTotal) : null;
        setupParts.forEach(function(p){
            var mins = round3(Number(p.minutes) || 0);
            var prefix = clock != null ? (formatClock(clock) + ' · ') : '';
            lines.push({ text: prefix + p.label + ' — ' + formatTimingNumber(mins) + ' мин' });
            if (clock != null) clock += mins;
        });
        var cutPrefix = hasStart ? (formatClock(ctx.startMin) + ' · ') : '';
        if (setupOnly) {
            // #3889: вместо «Итого резка: X * 0» — только настройка; намотка пойдёт с дня N+1.
            // Лидер не показываем (он заправляется в конце намотки, которой в этот день нет).
            lines.push({ text: cutPrefix + 'Только настройка станка — намотка начнётся в следующем рабочем дне', bold: true });
            if (hasStart) lines.push({ text: formatClock(ctx.startMin) + ' · готово (настройка)' });
            lines.push({ text: '' });
            lines.push({ text: '↪ Это последняя резка смены. Намотка (резка) — продолжение в следующем рабочем дне.' });
            return lines;
        }
        lines.push({
            text: cutPrefix + 'Итого резка: ' + formatTimingNumber(oneRun) + ' * ' + formatTimingNumber(runs) + ' = ' + formatTimingNumber(total) + ' мин',
            bold: true
        });
        // #3688: лидер между резками заправляют ПОСЛЕ намотки (в конце резки), не на старте окна.
        // #3862: если расписание СОХРАНЁННОЕ (scheduleFromStored), лидер ВХОДИТ в окно — finishMin
        // уже конец лидера. Тогда строка лидера = от (finishMin − лидер), а «готово» = finishMin (тот
        // же конец окна, что у карточки/Ганта; раньше модалка прибавляла лидер ВТОРОЙ раз → «готово»
        // выезжало за окно, напр. 08:55 против 08:51). Для live-расписания (buildSchedule, leaderMin
        // задан числом отдельно) лидер идёт ПОСЛЕ окна намотки: «готово» = finishMin + лидер (как раньше).
        var hasFinish = ctx.finishMin != null && isFinite(Number(ctx.finishMin));
        var leaderMin = round3(Number(ctx.leaderMin) || 0);
        var leaderInWindow = ctx.leaderInWindow === true;
        if (hasFinish && leaderMin > 0) {
            var leaderClock = leaderInWindow ? round3(Number(ctx.finishMin) - leaderMin) : Number(ctx.finishMin);
            lines.push({ text: formatClock(leaderClock) + ' · лидер между резками — ' + formatTimingNumber(leaderMin) + ' мин' });
        }
        if (hasFinish) {
            var doneClock = leaderInWindow ? Number(ctx.finishMin) : round3(Number(ctx.finishMin) + leaderMin);
            lines.push({ text: formatClock(doneClock) + ' · готово' });
        }
        // #3889: обычная резка с проходами, у которой остаток проходов уходит на следующий день
        // (дробление по проходам, не по настройке) — поясняем, что задание продолжится.
        if (ctx.continuesNextDay) {
            lines.push({ text: '' });
            lines.push({ text: '↪ Остаток проходов — продолжение в следующем рабочем дне.' });
        }
        return lines;
    }

    // #3862: разбивка setup для модалки из СОХРАНЁННЫХ колонок резки («Наладка ножей»+«Сырьё-
    // намотка»), а не пересчётом на лету. Минуты — из хранимого (сумма точно = sc.setupMin окна
    // карточки/Ганта, иначе модалка рисовала setup короче окна и оставляла зазор перед настройкой,
    // напр. начало в 08:15 вместо 08:00). Метки — из live-разбивки (firstSetupParts/changeoverParts),
    // по коду компонента; если live не дал компонент (расходится с хранимым) — метка по умолчанию.
    function storedSetupBreakdown(cut, prevCut, times, opts) {
        function num(v) { return (v == null || v === '') ? 0 : (Number(v) || 0); }
        var knife = round3(num(cut && cut.storedKnifeSetupMin));
        var matWind = round3(num(cut && cut.storedMaterialWindingMin));
        var liveLabel = {};
        setupBreakdown(prevCut, cut, times, opts).forEach(function(p) { liveLabel[p.code] = p.label; });
        var parts = [];
        if (knife > 0) parts.push({ code: 'KNIFE', label: liveLabel.KNIFE || 'настройка ножей', minutes: knife });
        if (matWind > 0) parts.push({ code: 'MATERIAL_WINDING', label: liveLabel.MATERIAL_WINDING || 'смена сырья / намотки / партии', minutes: matWind });
        return parts;
    }

    // Контекст тайминга одной резки для модалки (#3240): метраж/проходы/намотка, разбивка
    // setup (prevCut — предыдущая резка очереди или null для первой), релевантные нормы и
    // старт/финиш из расписания sc. → объект для cutTimingTimelineLines.
    function buildCutTimingCtx(cut, prevCut, sc, runMeters, windPoints, times, opts) {
        var t = times || DEFAULT_OP_TIMES;
        var length = stripNum(runMeters);
        var runs = stripNum(cut && cut.plannedRuns);
        var pts = windPointsForCut(cut && cut.isFoil, windPoints); // #3606: фольга — своя норма намотки
        var oneRun = windingMinutes(length, pts);
        // #3889: сегмент НАСТРОЙКИ (хвост дня N перед намоткой дня N+1) — «Кол-во план» = 0.
        // У него намотки нет (вся намотка переносится на продолжение след. дня), поэтому total = 0,
        // а не oneRun: модалка не печатает «Итого резка: X * 0 = X» (бессмысленное «namotka * 0»).
        var setupOnly = !(runs > 0);
        var total = setupOnly ? 0 : round3(oneRun * runs);
        // #3688: лидер после намотки — из расписания (sc.leaderMin) либо считаем сами.
        // #3862: сохранённое расписание (scheduleFromStored) НЕ хранит лидер отдельно — он входит в
        // окно (durationMin = намотка+лидер, finishMin = конец лидера, sc.leaderMin == null). Тогда
        // лидер для разбивки = остаток окна после намотки = (finishMin − startMin) − намотка, чтобы
        // «готово» совпало с finishMin карточки/Ганта (а не пересчитывался независимо и не выезжал за окно).
        var leaderUnit = Number(t.BETWEEN_CUTS != null ? t.BETWEEN_CUTS : DEFAULT_OP_TIMES.BETWEEN_CUTS) || 0;
        var leaderInWindow = !!(sc && sc.leaderMin == null && sc.finishMin != null && sc.startMin != null);
        var leaderMin = leaderInWindow
            ? round3(Math.max(0, (Number(sc.finishMin) - Number(sc.startMin)) - round3(total)))
            : ((sc && sc.leaderMin != null) ? round3(Number(sc.leaderMin) || 0) : round3(leaderUnit * cutLeaderRuns(cut)));
        return {
            length: length,
            runs: runs,
            oneRun: round3(oneRun),
            total: round3(total),
            // #3862: при сохранённом расписании setup берём из хранимых колонок (sum = sc.setupMin),
            // иначе — live-разбивка (buildSchedule). Так модалка не расходится с карточкой/Гантом.
            setupParts: leaderInWindow ? storedSetupBreakdown(cut, prevCut, times, opts) : setupBreakdown(prevCut, cut, times, opts),
            leaderMin: leaderMin,   // #3688: лидер в конце резки
            leaderInWindow: leaderInWindow,   // #3862: лидер входит в окно (сохранённое расписание) → «готово» = finishMin
            norms: relevantWindingNorms(length, pts),
            setupOnly: setupOnly,   // #3889: 0 проходов — только настройка, намотка с дня N+1
            startMin: sc ? sc.startMin : null,
            finishMin: sc ? sc.finishMin : null
        };
    }

    function scheduleDurationMinutes(cut, runMeters, windPoints) {
        var oneRun = windingMinutes(runMeters, windPointsForCut(cut && cut.isFoil, windPoints)); // #3606: фольга — своя норма
        var runs = stripNum(cut && cut.plannedRuns);
        var computed = runs > 0 ? round3(oneRun * runs) : oneRun;
        if (computed > 0) return computed;
        var stored = stripNum(cut && cut.duration);
        return stored > 0 ? round3(stored) : 0;
    }

    // #3635 п.5: id сегментов НАСТРОЙКИ — резки с 0 проходов (голова разбиения «настройка в
    // конце дня N → намотка с дня N+1»): у них намотки нет, поэтому в расписании их длительность
    // 0 (а не оценка «1 проход» из scheduleDurationMinutes), и карточка показывает «Настройка».
    function setupTaskIdSet(cuts) {
        // #3635 п.5: запись «Задание в производство» с «Кол-во план» = 0 — это сегмент НАСТРОЙКИ
        // (настройка в хвосте дня N, намотка-продолжение с дня N+1). Помечаем её setup-only по
        // самому признаку «0 проходов».
        // #3827: НЕ требуем, чтобы продолжение (с проходами) той же цепочки присутствовало в
        // наборе. Раньше setup-сегмент опознавался лишь когда в загруженных резках была и резка
        // той же цепочки (slitter|материал|намотка|ножи). При УЗКОМ фильтре дат продолжение
        // (на след. дне) в набор не попадало → сегмент настройки оставался «одиноким», терял
        // признак и в расписании считался обычной задачей с ПОЛНОЙ переналадкой в хвосте дня:
        // #3805 не дробил его настройку по концу смены, и сумма дня прыгала (бейдж 483 при
        // фильтре «23», но 467 при «23–30» — #3827). 0-проходную резку всегда создаёт только
        // планировщик как разрыв настройки (splitMachineQueue, setupOnly) — другого источника нет,
        // поэтому опознаём её независимо от того, виден ли её «хвост»-продолжение.
        var ids = {};
        (cuts || []).forEach(function(c) {
            if (c && (Number(c.plannedRuns) || 0) <= 0) ids[String(c.id)] = true;
        });
        return ids;
    }

    var DAY_START_MIN = 8 * 60;          // DAY_START_HOUR по умолчанию: 08:00
    var DAY_END_MIN = 17 * 60;           // DAY_END_HOUR по умолчанию: 17:00
    var SHIFT_START_MIN = DAY_START_MIN; // старый экспорт: начало окна резок
    var SHIFT_END_MIN = DAY_END_MIN - DEFAULT_OP_TIMES.CLEANUP_SHIFT; // старый экспорт: 16:30

    function parseClockMinutes(value, fallback) {
        var fb = Number(fallback);
        if (!isFinite(fb)) fb = 0;
        var s = String(value == null ? '' : value).trim();
        if (s === '') return fb;
        var hm = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
        if (hm) {
            var h = Number(hm[1]);
            var m = Number(hm[2] || 0);
            if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return h * 60 + m;
            return fb;
        }
        var n = Number(s.replace(',', '.'));
        if (!isFinite(n) || n < 0) return fb;
        return n <= 24 ? Math.round(n * 60) : Math.round(n);
    }

    // #3342: длительность обеда из настройки LUNCH_DURATION — целое число минут
    // (например «40»). Пусто/некорректно/≤0 → 0 (обед выключен).
    function parseDurationMinutes(value) {
        var n = Number(String(value == null ? '' : value).replace(',', '.').trim());
        return isFinite(n) && n > 0 ? Math.round(n) : 0;
    }

    // #3847: лимит нахлёста из настройки (MAX_OVERWORK_CUTS/MAX_OVERWORK_TUNE) — целое число
    // минут ≥ 0. В отличие от parseDurationMinutes, ОТЛИЧАЕТ отсутствие (пусто/некорректно → null,
    // фича выключена) от заданного «0» (нахлёст запрещён, но ограничение активно). Отрицательное → null.
    function parseOverworkMinutes(value) {
        var s = String(value == null ? '' : value).replace(',', '.').trim();
        if (s === '') return null;
        var n = Number(s);
        return isFinite(n) && n >= 0 ? Math.round(n) : null;
    }

    function resolveWorkingWindow(settings, cleanupMin) {
        var cfg = settings || {};
        var start = parseClockMinutes(cfg.DAY_START_HOUR, DAY_START_MIN);
        var end = parseClockMinutes(cfg.DAY_END_HOUR, DAY_END_MIN);
        if (end <= start) end = DAY_END_MIN > start ? DAY_END_MIN : start + 1;
        var cleanup = Number(cleanupMin != null ? cleanupMin : DEFAULT_OP_TIMES.CLEANUP_SHIFT);
        if (!isFinite(cleanup) || cleanup < 0) cleanup = DEFAULT_OP_TIMES.CLEANUP_SHIFT;
        // #3599: резку планируем вплотную до DAY_END_HOUR − TOTAL_INTERVALS (буфер из
        // Настройки), а блок уборки идёт ПОСЛЕ DAY_END_HOUR (см. dayCleanups). Нет
        // TOTAL_INTERVALS → прежнее поведение (буфер = длительность уборки).
        var totalIntervals = parseDurationMinutes(cfg.TOTAL_INTERVALS);
        if (!(totalIntervals > 0)) totalIntervals = cleanup;
        var cutEnd = end - totalIntervals;
        if (cutEnd < start) cutEnd = start;
        // #3342: плавающий обед. LUNCH_START задан (HH:MM) → minutes, иначе null (обед выкл).
        var lunchDur = parseDurationMinutes(cfg.LUNCH_DURATION);
        var lunchStart = (cfg.LUNCH_START != null && String(cfg.LUNCH_START).trim() !== '' && lunchDur > 0)
            ? parseClockMinutes(cfg.LUNCH_START, NaN) : NaN;
        var hasLunch = isFinite(lunchStart) && lunchDur > 0;
        // #3847: максимальный нахлёст за конец рабочего дня (DAY_END_HOUR=endMin). Резку (проход)
        // можно положить с нахлёстом, только если она кончится ≤ DAY_END_HOUR+MAX_OVERWORK_CUTS;
        // настройку (ножи/смена сырья) — ≤ DAY_END_HOUR+MAX_OVERWORK_TUNE. Пусто/некорректно →
        // null (фича выключена: планировщик пакует до cutEndMin без сверхнормативного нахлёста).
        var overCuts = parseOverworkMinutes(cfg.MAX_OVERWORK_CUTS);
        var overTune = parseOverworkMinutes(cfg.MAX_OVERWORK_TUNE);
        return {
            startMin: round3(start),
            endMin: round3(end),
            cutEndMin: round3(cutEnd),
            cleanupMin: round3(cleanup),
            lunchStartMin: hasLunch ? round3(lunchStart) : null,  // #3342: начало окна обеда (мин от полуночи)
            lunchDurationMin: hasLunch ? round3(lunchDur) : 0,    // #3342: длительность обеда (мин)
            // #3847: лимиты нахлёста (мин за DAY_END_HOUR); null = фича выключена. Если задан только
            // один — второй наследует его (общий смысл «допустимый нахлёст»), чтобы частичная
            // настройка не отключала ограничение целиком.
            maxOverworkCutsMin: overCuts != null ? overCuts : overTune,
            maxOverworkTuneMin: overTune != null ? overTune : overCuts
        };
    }

    // #3764: окна «Отпуска» станка → блокированные интервалы в МИНУТАХ от полуночи дня 0
    // (той же оси, что startMin/windowStartMin расписания). downtimes — [{ start, end }]
    // в unix-секундах (start — главное значение записи, end — «Окончание»). baseMidnightMs —
    // полночь дня 0 (planBaseMidnightFrom). Возвращает отсортированный по началу массив
    // [[startMin, endMin], …]; пустые/перевёрнутые/полностью прошедшие до базы окна отброшены.
    function downtimeBlockedRanges(downtimes, baseMidnightMs) {
        var base = Number(baseMidnightMs);
        if (!isFinite(base)) return [];
        var out = [];
        (downtimes || []).forEach(function(d) {
            var s = Number(d && d.start), e = Number(d && d.end);
            if (!isFinite(s) || s <= 0) return;
            // Без «Окончания» окно не ограничено по верху — игнорируем (нечего блокировать осмысленно).
            if (!isFinite(e) || e <= s) return;
            var sMin = (s * 1000 - base) / 60000;
            var eMin = (e * 1000 - base) / 60000;
            if (eMin <= 0) return;   // окно целиком до дня 0 — на план не влияет
            out.push([sMin, eMin]);
        });
        out.sort(function(a, b) { return a[0] - b[0]; });
        return out;
    }

    // #3876: на отпуске ли станок ВЕСЬ рабочий день. downtimes — окна простоя [{ start, end }]
    // в unix-секундах (start — начало «Отпуска», end — «Окончание»), как
    // this.downtimesBySlitter[slitterId]. dayMidnightMs — полночь дня (локально). workStartMin/
    // workEndMin — рабочее окно резки (мин от полуночи: startMin..cutEndMin).
    //
    // #3883: true ТОЛЬКО если закрытые окна отпуска ПОЛНОСТЬЮ покрывают рабочее окно [workStart;
    // workEnd] этого дня. ЧАСТИЧНЫЙ отпуск (напр. 2 часа 08:00–10:00) день НЕ блокирует — станок
    // работает остаток дня, а расписание само сдвигает резки за окно простоя (#3764,
    // shiftPlacementsPastDowntime). Раньше любое пересечение суток считалось «весь день в отпуске»,
    // и 2-часовое окно исключало станок из планирования совсем (Гант пустой во все дни). Окна без
    // «Окончания» игнорируем (как в расписании). Рабочее окно не задано → проверяем сутки [0;1440].
    function slitterDownOnDay(downtimes, dayMidnightMs, workStartMin, workEndMin) {
        var base = Number(dayMidnightMs);
        if (!isFinite(base)) return false;
        var wsMin = isFinite(Number(workStartMin)) ? Number(workStartMin) : 0;
        var weMin = isFinite(Number(workEndMin)) ? Number(workEndMin) : 1440;
        var ws = base + wsMin * 60000, we = base + weMin * 60000;
        if (!(we > ws)) return false;
        var ivs = [];
        (downtimes || []).forEach(function(d) {
            var s = Number(d && d.start), e = Number(d && d.end);
            if (!isFinite(s) || s <= 0 || !isFinite(e) || e <= s) return;   // без «Окончания» — не учитываем
            var a = Math.max(ws, s * 1000), b = Math.min(we, e * 1000);
            if (b > a) ivs.push([a, b]);
        });
        if (!ivs.length) return false;
        ivs.sort(function(x, y) { return x[0] - y[0]; });
        var cur = ws;
        for (var i = 0; i < ivs.length; i++) {
            if (ivs[i][0] > cur) return false;     // дыра в покрытии → есть рабочее время
            if (ivs[i][1] > cur) cur = ivs[i][1];
            if (cur >= we) return true;
        }
        return cur >= we;
    }

    // #3788: «ДД.ММ.ГГГГ» → числовой ключ дня ГГГГММДД (для карты календаря). null — мусор.
    function parseDmyKey(str) {
        var m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(str == null ? '' : str).trim());
        return m ? (Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1])) : null;
    }

    // #3788: миллисекунды → ключ дня ГГГГММДД (локальный день).
    function dayKeyFromMs(ms) {
        var d = new Date(Number(ms));
        if (isNaN(d.getTime())) return null;
        return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    }

    // #3788: рабочий ли день. calendarByDay: { ГГГГММДД: 'Праздничный день'|'Рабочий день' }
    // (исключения); dow — день недели (0=Вс … 6=Сб). «Рабочий день» делает выходной рабочим,
    // «Праздничный день» — будни нерабочим; иначе обычное правило (Сб/Вс — выходные).
    function dayTypeWorking(dayKey, dow, calendarByDay) {
        var t = calendarByDay && calendarByDay[dayKey];
        if (t === DAY_TYPE_WORKING) return true;
        if (t === DAY_TYPE_HOLIDAY) return false;
        return dow !== 0 && dow !== 6;
    }

    // #3788: рабочий ли календарный день (по мс). Пустая/битая дата → считаем рабочим (не блокируем).
    function dayIsWorking(ms, calendarByDay) {
        var d = new Date(Number(ms));
        if (isNaN(d.getTime())) return true;
        return dayTypeWorking(dayKeyFromMs(d.getTime()), d.getDay(), calendarByDay);
    }

    // #3788: нерабочие (выходные/праздничные) дни горизонта [0..horizonDays] от базы →
    // блокированные интервалы в МИНУТАХ от полуночи дня 0 (та же ось, что blockedRanges #3764).
    // Каждый нерабочий день — целиком [d*1440, (d+1)*1440]; смежные дни СЛИВАЮТСЯ в один
    // интервал (выходные+праздники подряд → один блок, меньше работы свипу). Пустой calendarByDay
    // → блокируются только Сб/Вс. baseMidnightMs нечисловой → []. Вход не мутирует.
    function calendarBlockedRanges(calendarByDay, baseMidnightMs, horizonDays) {
        var base = Number(baseMidnightMs);
        if (!isFinite(base)) return [];
        var bd = new Date(base);
        if (isNaN(bd.getTime())) return [];
        var H = Math.max(0, Number(horizonDays) || 0);
        var offs = [];
        for (var d = 0; d <= H; d++) {
            // setDate(+d) — корректный календарный день (без накопления через DST, в МСК DST нет).
            var day = new Date(bd.getFullYear(), bd.getMonth(), bd.getDate() + d, 0, 0, 0, 0);
            if (!dayTypeWorking(dayKeyFromMs(day.getTime()), day.getDay(), calendarByDay)) offs.push(d);
        }
        var out = [];
        for (var i = 0; i < offs.length; ) {
            var s = offs[i], e = offs[i];
            while (i + 1 < offs.length && offs[i + 1] === e + 1) { e = offs[++i]; }
            out.push([s * 1440, (e + 1) * 1440]);   // целые сутки; стык на полуночь сольёт соседние
            i++;
        }
        return out;
    }

    // #3788: слить два набора блокированных интервалов (минуты от базы) в один отсортированный
    // массив (окна простоя станка #3764 ∪ нерабочие дни календаря). Дубли не схлопываем —
    // свип (nextFreeWorkMinute) корректно работает с перекрытиями.
    function mergeBlockedRanges(a, b) {
        var out = (a || []).concat(b || []);
        out.sort(function(x, y) { return x[0] - y[0]; });
        return out;
    }

    // #3764: рабочее окно дня для абсолютной минуты от полуночи дня 0. Если минута до начала
    // окна (ночь/утро) — подтягиваем к dayStart; если в/после конца окна — к dayStart следующего
    // дня. blocked — отсортированные [[s,e],…]. Возвращает ближайшую минуту ≥ from, которая
    // (а) внутри рабочего окна и (б) не попадает в блокированный интервал; для сегмента длиной
    // len ещё и (в) ни один блок не НАЧИНАЕТСЯ внутри [m, m+len) (иначе сегмент въехал бы в
    // простой — выталкиваем целиком за конец блока). Итераций ≤ числа блоков + дни (ограничено).
    function nextFreeWorkMinute(from, len, blocked, dayStart, dayEnd) {
        var m = Number(from);
        var L = Number(len) || 0;
        var guard = 0, guardMax = (blocked || []).length * 2 + 8;
        while (guard++ < guardMax) {
            var day = Math.floor(m / 1440);
            var within = m - day * 1440;
            if (within < dayStart) { m = day * 1440 + dayStart; continue; }
            if (within >= dayEnd) { m = (day + 1) * 1440 + dayStart; continue; }
            var bumped = false;
            for (var i = 0; i < (blocked || []).length; i++) {
                var bS = blocked[i][0], bE = blocked[i][1];
                // m внутри блока, либо блок начинается в пределах занимаемого сегментом окна.
                if ((bS <= m && m < bE) || (m < bS && bS < m + L)) {
                    if (bE > m) { m = bE; bumped = true; break; }
                }
            }
            if (!bumped) return m;
        }
        return m;
    }

    // #3764: общий проход — сдвигает уже построенные размещения за окна «Отпуска» станка,
    // сохраняя порядок. items — массив; acc — аксессоры { windowStart, length, shift } чтения
    // окна-старта (минуты), длины (setup+намотка) и применения сдвига (delta) к элементу. blocked
    // — отсортированные [[s,e],…] (минуты от полуночи дня 0). Сохраняет встык-упаковку (курсор =
    // конец предыдущего): резку, сдвинутую простоем, догоняют следующие. Пустой blocked → no-op.
    function shiftPlacementsPastDowntime(items, blocked, dayStart, dayEnd, acc) {
        if (!blocked || !blocked.length || !items || !items.length) return items;
        var cursor = -Infinity;
        items.forEach(function(it) {
            var ws = acc.windowStart(it);
            if (ws < cursor) ws = cursor;
            var len = acc.length(it);
            var placed = nextFreeWorkMinute(ws, len, blocked, dayStart, dayEnd);
            var delta = placed - acc.windowStart(it);
            if (delta !== 0) acc.shift(it, delta);
            cursor = placed + len;
        });
        return items;
    }

    // Расписание очереди (по порядку): для каждой резки — старт/финиш в минутах от
    // полуночи дня 0 (через сутки — следующий рабочий день). setup перед резкой = лидер
    // (BETWEEN_CUTS × число резок цуга, #3401) + переналадка с предыдущей (changeoverCost, мин); длительность =
    // намотка прогона × «Кол-во план» либо сохранённая «Длительность, минут» как
    // fallback. Рабочее окно дня — [shiftStartMin, shiftEndMin] (08:00–16:30);
    // резка, не влезающая до конца окна, переносится на 08:00 следующего дня.
    // opts: { windPoints, times, shiftStartMin, shiftEndMin,
    // runLengthByCut:{cutId:метры}, blockedRanges:[[s,e],…] (#3764) }. Вход не мутирует.
    function buildSchedule(cuts, opts){
        opts = opts || {};
        var wind = opts.windPoints || [];
        var times = opts.times || DEFAULT_OP_TIMES;
        var leader = Number(times.BETWEEN_CUTS != null ? times.BETWEEN_CUTS : DEFAULT_OP_TIMES.BETWEEN_CUTS) || 0;
        var runLen = opts.runLengthByCut || {};
        var shiftStart = Number(opts.shiftStartMin != null ? opts.shiftStartMin : SHIFT_START_MIN) || 0;
        var shiftEnd = Number(opts.shiftEndMin != null ? opts.shiftEndMin : SHIFT_END_MIN) || 0;
        var hasWindow = shiftEnd > shiftStart;
        // #3342: плавающий обед. Пока обед дня не вставлен, в конце окна резервируем
        // lunchDur (день закончится раньше, если обед не удалось встроить между резками).
        var lunch = lunchParams(opts, shiftStart, shiftEnd);
        var lunchDone = {};
        var t = shiftStart;   // день 0, начало смены
        var out = [];
        var setupIds = opts.setupTaskIds || {};   // #3635 п.5: сегменты настройки — намотка 0
        var anchorByCut = opts.dayAnchorByCut || {};   // #3652: якорь дня по «Дате план»
        // #3805: остаток настройки setup-only-сегмента (хвост дня N), который переносится на
        // его продолжение (день N+1) — keyed по continuationSignature цепочки.
        var carrySetupBySig = {};
        (cuts || []).forEach(function(c, i){
            // #3652: привязать резку к её рабочему дню «Даты план» — если очередь не дотянула
            // до этого дня, прыгаем вперёд к его началу (08:00). Иначе при ДИАПАЗОНЕ дат «С–По»
            // задания одного дня (напр. 30.05) ложились под дату «С» (напр. 20.05). Назад не
            // двигаем (переполнение предыдущих сохраняется); резки без «Даты план» — без якоря.
            var anchorDay = anchorByCut[String(c && c.id)];
            if (anchorDay != null && anchorDay > Math.floor(t / 1440)) {
                t = anchorDay * 1440 + shiftStart;
            }
            // #3688: ПЕРЕД резкой — только переналадка (ножи + смена сырья), БЕЗ лидера. Лидер
            // («лидер между резками») заправляют В КОНЦЕ каждой резки → он добавляется ПОСЛЕ
            // намотки (leaderMin), а не в стартовый сетап. Для первой резки очереди (i===0)
            // переналадка считается от текущей заправки станка (opts.carryPrevCut — из отчёта
            // prev_cut_setup: тот же материал/намотка/ножи → 0); нет данных → настройка ножей
            // с нуля (#3669, firstCutSetup).
            var setup = i > 0
                ? changeoverCost(cuts[i-1], c, times)
                : (opts.carryPrevCut ? changeoverCost(opts.carryPrevCut, c, times)
                                     : (opts.firstCutSetup ? firstSetupCost(c, times) : 0));
            // #3805: продолжение setup-only-сегмента (тот же день N+1) несёт остаток настройки,
            // не уместившийся в хвост дня N (changeoverCost между ними = 0, т.к. конфигурация та же).
            var carrySig = continuationSignature(c);
            if (carrySetupBySig[carrySig] != null) {
                setup = round3(setup + carrySetupBySig[carrySig]);
                delete carrySetupBySig[carrySig];
            }
            var leaderMin = leader * cutLeaderRuns(c);   // #3688: лидер в конце резки
            var dur = setupIds[String(c && c.id)] ? 0 : scheduleDurationMinutes(c, Number(runLen[String(c.id)]) || 0, wind);
            // #3562: задания пакуются встык по очереди. Зафиксированные больше не «прикалываются»
            // к плановому старту — автогенерация двигает их по времени в течение дня и меняет
            // очередность (пины #3508 п.6 убраны).
            var start = t + setup;
            var day = Math.floor(start / 1440);
            if (start < day * 1440 + shiftStart) start = day * 1440 + shiftStart;   // до 08:00 → ждём открытия
            // #3342: резка стартует в/после LUNCH_START и обед ещё не был → пауза перед ней.
            if (lunch && !lunchDone[day] && (start - day * 1440) >= lunch.startMin) {
                start += lunch.durationMin;
                lunchDone[day] = true;
            }
            // не влезает до конца окна (резерв обеда, если не вставлен) → 08:00 след. дня.
            // #3688: в окно должны влезть резка И лидер после неё (станок занят до конца лидера).
            // #3739/#3760: при gapFill нахлёст за конец смены ограничен ОДНИМ шагом — резку,
            // чьё ОКНО (начало настройки = start − setup) уже за концом смены, выталкиваем на
            // следующий день; резка, начавшаяся в пределах смены, может выйти за край (один
            // нахлёст), но следующая за ней уйдёт на завтра. Так тайминг не накапливается в ночь.
            var fitEnd = day * 1440 + shiftEnd - ((lunch && !lunchDone[day]) ? lunch.durationMin : 0);
            var pushNextDay = opts.gapFill ? ((start - setup) >= fitEnd) : (start + dur + leaderMin > fitEnd);
            if (hasWindow && pushNextDay) {
                day += 1;
                start = day * 1440 + shiftStart + setup;
                if (lunch && !lunchDone[day] && (start - day * 1440) >= lunch.startMin) {
                    start += lunch.durationMin;
                    lunchDone[day] = true;
                }
            }
            // #3805: setup-only-сегмент (#3635 п.5), чья настройка вылезает за конец смены, —
            // в хвост дня кладём только МИНИМАЛЬНОЕ подмножество компонентов настройки
            // (minOverlapTailSetupMinutes, как splitMachineQueue), а остаток переносим на
            // продолжение (день N+1). Иначе вся настройка (напр. ножи+сырьё=45) копилась бы в
            // дне N, и сумма за день вылетала за рамки «смена + один шаг наладки» (#3805: 495
            // мин при максимуме ~480). Считаем по окну ДО смещения на след. день (pushNextDay
            // не сработал, иначе настройка влезает целиком в свежий день — дробить нечего).
            var fitEndForDay = day * 1440 + shiftEnd - ((lunch && !lunchDone[day]) ? lunch.durationMin : 0);
            if (hasWindow && setupIds[String(c && c.id)] && setup > 0 && start > fitEndForDay) {
                var windowStartMin = start - setup;            // начало настройки (= t после якоря)
                var availTail = fitEndForDay - windowStartMin; // остаток смены до её конца
                if (availTail > 0) {
                    var setupParts = i > 0 ? changeoverParts(cuts[i-1], c, times)
                        : (opts.carryPrevCut ? changeoverParts(opts.carryPrevCut, c, times)
                            : (opts.firstCutSetup ? firstSetupParts(c, times) : []));
                    var tailSetup = minOverlapTailSetupMinutes(setupParts, availTail, setup);
                    if (tailSetup < setup) {
                        carrySetupBySig[carrySig] = round3(setup - tailSetup);
                        setup = round3(tailSetup);
                        start = round3(windowStartMin + setup);
                    }
                }
            }
            // #3816: резка, ПЕРЕСЕКАЮЩАЯ окно обеда (намотка стартует ДО LUNCH_START и идёт
            // через него), — станок паузит на обед В ХОДЕ намотки. Раньше обед вставлялся
            // паузой только перед резкой, СТАРТУЮЩЕЙ в/после LUNCH_START (см. выше), поэтому
            // длинная резка через обед шла без паузы: день «работал сквозь обед», конец дня
            // приходился на ~16:22 вместо ~17:00, а сумма за день получалась как целое окно без
            // вычета обеда (#3816: 502 мин при ёмкости 450). Сдвигаем финиш намотки на
            // длительность обеда (намотка прерывается на обед), обед помечаем вставленным;
            // durationMin (минуты РАБОТЫ, основа бейджа дня) не меняется — захлёст #3760 сохранён.
            var lunchGap = 0;
            if (lunch && !lunchDone[day] && dur > 0) {
                var nStartInDay = start - day * 1440;
                if (nStartInDay < lunch.startMin && (nStartInDay + dur) > lunch.startMin) {
                    lunchGap = lunch.durationMin;
                    lunchDone[day] = true;
                }
            }
            var finish = start + dur + lunchGap;
            // #3688: окно-старт = startMin − setupMin (без лидера); leaderMin — лидер после намотки.
            out.push({ cutId: String(c.id), startMin: round3(start), finishMin: round3(finish), setupMin: round3(setup), durationMin: dur, leaderMin: round3(leaderMin) });
            t = finish + leaderMin;   // #3688: следующая резка стартует после лидера текущей (#3816: после обеда, если он попал в эту резку)
        });
        // #3764: вынести задания за окна «Отпуска» станка (ТО и т.п.). Окно занимает
        // [windowStart, +setup+намотка+лидер]; пустой blockedRanges → no-op (поведение прежнее).
        // #3816: длину окна берём из finishMin (= setup + намотка + ОБЕД, если он попал в резку)
        // + лидер, иначе у резки через обед окно занятости было бы на длительность обеда короче.
        // Для резок без обеда finishMin − startMin = durationMin — поведение прежнее.
        if (hasWindow) shiftPlacementsPastDowntime(out, opts.blockedRanges, shiftStart, shiftEnd, {
            windowStart: function(o) { return o.startMin - o.setupMin; },
            length: function(o) { return o.setupMin + (o.finishMin - o.startMin) + o.leaderMin; },
            shift: function(o, delta) { o.startMin = round3(o.startMin + delta); o.finishMin = round3(o.finishMin + delta); }
        });
        return out;
    }

    // #3846: показываем СОХРАНЁННЫЙ план БЕЗ live-пересчёта. Единый источник правды с РМ
    // «Диаграмма Ганта (задания)»: и очередь production-planning, и cut-gantt берут одни и те
    // же записанные поля резки, поэтому времена/минуты ВСЕГДА совпадают (раньше очередь
    // пересчитывала расписание через buildSchedule на каждый рендер и расходилась с сохранённым:
    // другая наладка — firstCutSetup вместо реальной заправки станка — и неучтённый обед).
    // Тайминг строим из полей, записанных ГЕНЕРАЦИЕЙ: planStart (главное значение, t1078 —
    // окно/начало настройки), сохранённая наладка (ножи + смена сырья) и «Резка и Лидер»
    // (#3700: намотка + лидер). Обед (#3342) уже учтён в сохранённых planStart (генерация
    // сдвинула старты послеобеденных резок) — на показе он отдельный блок (lunchBlocksFromSchedule).
    // Форма результата совпадает с buildSchedule: { cutId, startMin, finishMin, setupMin,
    // durationMin, leaderMin } в минутах от полуночи дня 0 (baseMidnightMs); лидер входит в
    // durationMin (отдельной leaderMin нет — окно = setup + durationMin).
    function scheduleFromStored(cuts, baseMidnightMs) {
        var base = Number(baseMidnightMs);
        function num(v) { return (v == null || v === '') ? 0 : (Number(v) || 0); }
        var out = [];
        // #3885: сохранённые planStart двух резок ОДНОГО станка в один день могут совпасть
        // (напр. обе t1078 = 08:00) — след незавершённой пересборки времени старта: перенос
        // до #3840 не пересобирал planStart, а пересборка #3660 идёт только в scope фильтра, и
        // «осиротевший» старт остаётся прежним. Раньше очередь пересчитывала расписание на лету
        // (buildSchedule) и нахлёст не показывала; с #3846 (показ сохранённого) две карточки
        // вставали в одно время. Резки приходят в порядке очереди (день → «Очередность»),
        // поэтому раскладываем встык: старт ОКНА резки не раньше конца окна предыдущей резки
        // ЭТОГО дня. Непересекающиеся сохранённые старты не трогаем (display == сохранённое).
        var prevWindowEndByDay = {};
        (cuts || []).forEach(function(c) {
            if (!c) return;
            var tsSec = Number(c.planDate != null && c.planDate !== '' ? c.planDate : c.number);
            if (!isFinite(tsSec) || tsSec <= 0 || !isFinite(base)) return;   // нет planStart — нечего ставить на ось
            var windowStartMin = round3((tsSec * 1000 - base) / 60000);     // окно = начало настройки
            var setupMin = round3(num(c.storedKnifeSetupMin) + num(c.storedMaterialWindingMin));
            var durationMin = round3(num(c.storedCutAndLeaderMin) || num(c.duration));   // намотка + лидер
            // #3885: устранить нахлёст с предыдущей резкой того же дня — сдвинуть начало окна к
            // её концу. День берём по СОХРАНЁННОМУ старту (до сдвига), чтобы группировка по дате
            // (заголовок/минуты дня) не уезжала; сдвиг лечит только нахлёст внутри дня.
            var day = Math.floor(windowStartMin / 1440);
            var prevEnd = prevWindowEndByDay[day];
            if (prevEnd != null && windowStartMin < prevEnd) windowStartMin = prevEnd;
            var startMin = round3(windowStartMin + setupMin);               // старт намотки (после настройки)
            var finishMin = round3(startMin + durationMin);
            prevWindowEndByDay[day] = finishMin;   // окно занятости = setup + намотка (лидер уже в durationMin)
            out.push({
                cutId: String(c.id),
                startMin: startMin,
                finishMin: finishMin,
                setupMin: setupMin,
                durationMin: durationMin,
                // Лидер уже включён в durationMin (storedCutAndLeaderMin = намотка + лидер, #3700) —
                // отдельной величины в сохранённом нет. null (а не 0): окно/минуты считают его 0
                // (не двойной счёт), а модалка тайминга (buildCutTimingCtx) оценивает лидер для
                // СВОЕЙ разбивки, не трогая расписание очереди/Ганта.
                leaderMin: null
            });
        });
        return out;
    }

    // #3846: блоки «Обед» для отображения — выводим обед как видимый разрыв между резками
    // одного рабочего дня (раньше cut-gantt/очередь его не рисовали → выглядел как пустая
    // «дыра в планировании»). Обед уже сидит в сохранённых planStart: между концом окна одной
    // резки и началом окна следующей в ТОМ ЖЕ дне образуется зазор ≈ длительности обеда вокруг
    // LUNCH_START. Берём такой зазор как обед. schedule — из scheduleFromStored/buildSchedule
    // (отсортируем сами). opts: { lunchStartMin, lunchDurationMin, shiftStartMin }. Пустой обед
    // (lunchDurationMin ≤ 0) → []. → [{ day, startMin, finishMin, durationMin }] (минуты от
    // полуночи дня 0), по одному на день, где обед реально вставлен.
    function lunchBlocksFromSchedule(schedule, opts) {
        opts = opts || {};
        var lunchDur = Number(opts.lunchDurationMin) || 0;
        if (!(lunchDur > 0)) return [];
        var segs = (schedule || []).slice().filter(function(s) {
            return s && isFinite(Number(s.startMin));
        }).sort(function(a, b) { return a.startMin - b.startMin; });
        var byDay = {};
        var lunchByDay = {};
        segs.forEach(function(s) {
            var winStart = Number(s.startMin) - (Number(s.setupMin) || 0);   // начало окна (настройки)
            var winEnd = Number(s.finishMin) + (Number(s.leaderMin) || 0);
            var day = Math.floor(winStart / 1440);
            var prevEnd = byDay[day];
            // Зазор внутри дня после предыдущей резки = обед (учтён только раз на день).
            if (prevEnd != null && !lunchByDay[day]) {
                var gap = winStart - prevEnd;
                // Зазор сопоставим с обедом (терпимо к округлению; «через обед» режется по
                // длительности): берём, если он не меньше почти полного обеда. Обед привязываем к
                // НАЧАЛУ послеобеденной резки (finishMin = winStart) — так блок всегда прилегает к
                // следующей карточке (надёжный матч при рендере), а любой остаточный простой (если
                // зазор > обеда) остаётся ДО обеда.
                if (gap >= lunchDur - 1) {
                    lunchByDay[day] = { day: day, startMin: round3(winStart - lunchDur), finishMin: round3(winStart), durationMin: lunchDur };
                }
            }
            if (byDay[day] == null || winEnd > byDay[day]) byDay[day] = winEnd;
        });
        return Object.keys(lunchByDay).map(function(d) { return lunchByDay[d]; });
    }

    // #3342: параметры плавающего обеда из opts, валидные только если обед попадает
    // в рабочее окно и помещается в нём. → { startMin, durationMin } | null.
    function lunchParams(opts, shiftStart, shiftEnd) {
        var ls = Number(opts && opts.lunchStartMin);
        var ld = Number(opts && opts.lunchDurationMin) || 0;
        if (!isFinite(ls) || ld <= 0) return null;
        if (!(shiftEnd > shiftStart) || (shiftEnd - shiftStart) <= ld) return null;
        if (ls < shiftStart || ls >= shiftEnd) return null;
        return { startMin: ls, durationMin: ld };
    }

    // Уборка в конце рабочего дня (#3155, код CLEANUP_SHIFT): для каждого дня, где есть
    // хотя бы одна резка, — блок уборки длиной cleanupMin, начинающийся в конце рабочего
    // окна (shiftEnd, 16:30) и идущий до 17:00. Вход — расписание buildSchedule
    // (по startMin определяем день каждой резки). opts: { cleanupMin, shiftEndMin }.
    // cleanupMin ≤ 0 → нет уборки ([]). → [{ day, startMin, finishMin, durationMin }] по дням ↑.
    function dayCleanups(schedule, opts){
        opts = opts || {};
        var cleanup = Number(opts.cleanupMin != null ? opts.cleanupMin : DEFAULT_OP_TIMES.CLEANUP_SHIFT) || 0;
        var shiftEnd = Number(opts.shiftEndMin != null ? opts.shiftEndMin : SHIFT_END_MIN) || 0;
        if (cleanup <= 0) return [];
        var days = {};
        (schedule || []).forEach(function(sc){
            if (!sc) return;
            days[Math.floor((Number(sc.startMin) || 0) / 1440)] = true;
        });
        return Object.keys(days).map(Number).sort(function(a, b){ return a - b; }).map(function(day){
            var start = day * 1440 + shiftEnd;
            return { day: day, startMin: round3(start), finishMin: round3(start + cleanup), durationMin: round3(cleanup) };
        });
    }

    // #3280: разбиение очереди ОДНОГО станка по рабочим дням на уровне проходов.
    // Длительность резки линейна по проходам (windingMinutes × «Кол-во план»), поэтому
    // резку, упирающуюся в конец рабочего окна, обрезаем по числу влезающих проходов;
    // остаток проходов — продолжение с 08:00 следующего дня ТОЙ ЖЕ резки без переналадки
    // (ножи остаются на станке → setup продолжения = 0).
    // #3401: лидер (BETWEEN_CUTS) заправляют ПЕРЕД КАЖДОЙ резкой цуга — он входит в стоимость
    // одного прохода (perPass + leader), а не в одноразовый setup. Так лидеры раскладываются
    // по дням вместе с проходами (а не упираются все в первый день/переполняют окно).
    //   orderedCuts — уже упорядоченная очередь станка (как из orderCuts).
    //   opts: { dayStartMin, dayEndMin, leader, times, perPassByCut:{cutId:мин/проход},
    //           runsByCut:{cutId:проходов} } (perPass/runs можно не задавать — берём из резки).
    // → массив сегментов [{ cutId, dayOffset, runs, windowStartMin, startMin, setupMin,
    //    durationMin, isContinuation, parentCutId }] (windowStartMin = первый шаг окна =
    //    startMin − setupMin; именно его выводим в .atex-pp-cut-num и пишем в t1078).
    // Вход не мутирует.
    function splitMachineQueue(orderedCuts, opts){
        opts = opts || {};
        var dayStart = Number(opts.dayStartMin != null ? opts.dayStartMin : SHIFT_START_MIN) || 0;
        var dayEnd = Number(opts.dayEndMin != null ? opts.dayEndMin : SHIFT_END_MIN) || 0;
        var times = opts.times || DEFAULT_OP_TIMES;
        var leader = Number(opts.leader != null ? opts.leader : (times.BETWEEN_CUTS != null ? times.BETWEEN_CUTS : DEFAULT_OP_TIMES.BETWEEN_CUTS)) || 0;
        var perPassByCut = opts.perPassByCut || {};
        var runsByCut = opts.runsByCut || {};
        var capacity = dayEnd - dayStart;            // минут резки в рабочем окне дня
        var hasWindow = capacity > 0;
        // #3847: лимиты нахлёста за конец рабочего дня. dayEndHour = реальный конец смены
        // (DAY_END_HOUR, обычно > dayEnd = cutEndMin = DAY_END_HOUR−TOTAL_INTERVALS). Резку (проход)
        // можно положить с нахлёстом, только если она кончится ≤ dayEndHour+maxOverworkCuts;
        // настройку — ≤ dayEndHour+maxOverworkTune. Лимит не задан (null) → фича выключена: пакуем
        // как раньше, до cutEndMin (effCapacity), без сверхнормативного нахлёста.
        var dayEndHour = Number(opts.dayEndHourMin != null ? opts.dayEndHourMin : dayEnd) || 0;
        var maxOverworkCuts = (opts.maxOverworkCutsMin != null && isFinite(Number(opts.maxOverworkCutsMin)))
            ? Math.max(0, Number(opts.maxOverworkCutsMin)) : null;
        var maxOverworkTune = (opts.maxOverworkTuneMin != null && isFinite(Number(opts.maxOverworkTuneMin)))
            ? Math.max(0, Number(opts.maxOverworkTuneMin)) : maxOverworkCuts;
        var overworkOn = maxOverworkCuts != null;
        // #3764: вынести сегменты за окна «Отпуска» станка (общий проход по результату, как в
        // buildSchedule). Окно сегмента — [windowStartMin, +setup+намотка]; пустой blockedRanges
        // → no-op. Вызываем перед каждым return (gapFill-ветка и базовая).
        function applyDowntime(segs) {
            if (hasWindow) shiftPlacementsPastDowntime(segs, opts.blockedRanges, dayStart, dayEnd, {
                windowStart: function(s) { return s.windowStartMin; },
                length: function(s) { return (Number(s.setupMin) || 0) + (Number(s.durationMin) || 0); },
                shift: function(s, delta) { s.windowStartMin = round3(s.windowStartMin + delta); s.startMin = round3(s.startMin + delta); }
            });
            return segs;
        }
        // #3342: плавающий обед. lunch.startMin — минуты от полуночи; durationMin — длина.
        var lunch = lunchParams(opts, dayStart, dayEnd);
        var lunchDone = {};
        // До вставки обеда доступную ёмкость дня уменьшаем на длительность обеда (резерв):
        // если обед не получится поставить паузой между резками, день закончится раньше.
        function effCapacity(d) { return (lunch && !lunchDone[d]) ? (capacity - lunch.durationMin) : capacity; }
        // #3847: доступные минуты от текущего clock до потолка нахлёста для дня d. kind='cuts' —
        // потолок DAY_END_HOUR+maxOverworkCuts (для проходов), 'tune' — DAY_END_HOUR+maxOverworkTune
        // (для настройки). Минус резерв обеда (как effCapacity). Фича выключена → обычная ёмкость до
        // cutEndMin (effCapacity−clock), поведение не меняется. clock/lunchDone — из замыкания.
        function availFor(d, kind) {
            var base = effCapacity(d) - clock;
            if (!overworkOn || !hasWindow) return base;
            var lunchRes = (lunch && !lunchDone[d]) ? lunch.durationMin : 0;
            var margin = (kind === 'tune') ? maxOverworkTune : maxOverworkCuts;
            return (dayEndHour - dayStart) + margin - lunchRes - clock;
        }
        // #3658: якорь дня по «Дате план» — резка ложится на СВОЙ рабочий день, а не паком от
        // дня «С». Иначе автозаполнение дней (#3619) при генерации с другой даты переписывало
        // planStartTs истории (задания 30.05 уезжали в выбранную 4.06). Якорь может быть
        // отрицательным (день раньше базы=дня «С»), поэтому стартовый день = минимальный якорь.
        var anchorByCut = opts.dayAnchorByCut || {};
        var dueDayByCut = opts.dueDayByCut || {};   // #3826: день срока (смещение от базы) на резку
        var minAnchor = null;
        (orderedCuts || []).forEach(function(c){
            var a = anchorByCut[String(c && c.id)];
            if (a != null && (minAnchor == null || a < minAnchor)) minAnchor = a;
        });
        var segments = [];
        var day = (minAnchor != null ? minAnchor : 0), clock = 0;   // clock — минут занято в текущем дне (от dayStart)
        var prevPhysical = null;                     // предыдущая ФИЗИЧЕСКАЯ резка (для переналадки)
        // Обед как пауза перед НОВОЙ резкой: если в этот день он ещё не был и время дня
        // (dayStart+clock) дошло до LUNCH_START — вставляем паузу (clock += длительность).
        function insertLunchBefore() {
            if (lunch && !lunchDone[day] && clock > 0 && (dayStart + clock) >= lunch.startMin) {
                clock += lunch.durationMin;
                lunchDone[day] = true;
            }
        }
        // #3739: setup (минуты) и его компоненты для переналадки prev→c с учётом первой
        // резки/заправки станка. cost == changeoverCost(...) — единый источник.
        // #3853: первая резка станка считается переналадкой от РЕАЛЬНОЙ заправки станка
        // (carryPrevSetup из prev_cut_setup) — ровно как окно резки в setupActivityColumns
        // (persistence). Раньше генерация planStart брала здесь «ножи с нуля» (firstCutSetup),
        // а окно — переналадку от заправки → на первой карточке дня возникал разрыв/перекрытие.
        // carryOverPrevCut нейтрализует партию ИМЕННО первой резки c (как arr[0] в persistence),
        // поэтому батч не считается ложной сменой даже при gapFill-перестановке.
        function setupPartsFor(prev, c) {
            if (prev) return changeoverParts(prev, c, times);
            if (opts.carryPrevCut) return changeoverParts(opts.carryPrevCut, c, times);   // #3688
            if (opts.carryPrevSetup) return changeoverParts(carryOverPrevCut(opts.carryPrevSetup, c), c, times);   // #3853
            if (opts.firstCutSetup) return firstSetupParts(c, times);                     // #3669
            return [];
        }
        function setupCostFor(prev, c) {
            return setupPartsFor(prev, c).reduce(function(s, p){ return s + (Number(p.minutes) || 0); }, 0);
        }
        // #3739: gap-fill. Вместо простоя в хвосте смены тянем будущую резку вперёд (раньше
        // срока — допустимо, «с запасом по сроку») и заполняем день; нахлёст за конец смены
        // разрешён. Выбор следующей резки — по НЕПРЕРЫВНОСТИ КОНФИГУРАЦИИ (минимальная
        // переналадка от предыдущей): «начинать с той конфигурации, на которой закончили».
        // Когда в хвост влезает только настройка — кладём КРУПНЕЙШИЙ её компонент (ножи/сырьё)
        // с минимальным нахлёстом, остаток настройки — на след. день перед проходами.
        if (opts.gapFill) {
            var state = {};
            var poolOrder = [];
            (orderedCuts || []).forEach(function(c, i){
                var id = String(c && c.id);
                state[id] = {
                    cut: c, idx: i,
                    remaining: Math.round(Number(runsByCut[id] != null ? runsByCut[id] : c && c.plannedRuns) || 0),
                    perPass: Number(perPassByCut[id] != null ? perPassByCut[id] : 0) || 0,
                    anchor: anchorByCut[id] != null ? anchorByCut[id] : null,
                    // #3792: «Зафиксировано» — замок на ДЕНЬ. Якорь дня обязателен (без «Даты
                    // план» закрепить день нельзя → трактуем как свободную). Внутри дня резку
                    // оптимизатор переставлять может, на другой день/в разбивку — нет.
                    fixedDay: (c && c.fixed && anchorByCut[id] != null) ? anchorByCut[id] : null,
                    dueDay: dueDayByCut[id] != null ? dueDayByCut[id] : null,   // #3826: день «Срока изготовления»
                    isCont: false, pendingSetup: 0
                };
                poolOrder.push(id);
            });
            function pending() {
                return poolOrder.filter(function(id){ return state[id].remaining > 0 || (state[id].perPass <= 0 && !state[id].placedEmpty); });
            }
            // R3: среди кандидатов — приоритет (по убыванию): фольга в конец дня (#3717), затем
            // более ранний «Срок изготовления» (#3815, EDD: раннему сроку — ранний день), затем
            // минимальная переналадка от prevPhysical (непрерывность конфигурации, «начинать с той
            // конфигурации, на которой закончили»), затем исходный порядок очереди. Так срок
            // определяет ДЕНЬ задания, а переналадка — порядок ВНУТРИ одного срока.
            function selectByConfig(ids) {
                var best = null;
                ids.forEach(function(id){
                    var c = state[id].cut;
                    var due = (c && isFinite(c.dueKey)) ? Number(c.dueKey) : Infinity;   // #3815: нет срока → в конец
                    var key = [ (c && c.isFoil) ? 1 : 0, due, setupCostFor(prevPhysical, c), state[id].idx ];
                    if (!best) { best = { id: id, key: key }; return; }
                    for (var k = 0; k < key.length; k++) {
                        if (key[k] < best.key[k]) { best = { id: id, key: key }; return; }
                        if (key[k] > best.key[k]) return;
                    }
                });
                return best && best.id;
            }
            // #3826: среди фольги «своего срока» (срок ≤ дня) — крупнейшая, чья настройка+намотка
            // ЦЕЛИКОМ влезает в остаток дня. Кладём такую (фольга — в конец дня, #3717), не дробя
            // её настройку в хвост (иначе намотка-продолжение встала бы в НАЧАЛО следующего дня
            // перед нефольгой — нарушение #3717). Ничего не влезает → null (день закрываем).
            function bestFittingFoil(ids) {
                var avail = effCapacity(day) - clock;
                var best = null, bestDur = -1;
                ids.forEach(function(id){
                    var st = state[id], c = st.cut;
                    if (!(st.remaining > 0) || !(st.perPass > 0)) return;
                    var setup = st.isCont ? (Number(st.pendingSetup) || 0) : setupCostFor(prevPhysical, c);
                    var dur = st.remaining * (st.perPass + leader);
                    if (setup + dur <= avail && dur > bestDur) { best = id; bestDur = dur; }
                });
                return best;
            }
            // Предохранитель от зацикливания: каждая итерация уменьшает remaining либо
            // ставит настройку и двигает день (после чего проход точно ложится). Верхняя
            // оценка — по суммарным проходам + запас на дни/настройки. На практике не срабатывает.
            var totalRuns = 0;
            poolOrder.forEach(function(id){ totalRuns += Math.max(0, state[id].remaining); });
            var guard = 0, guardMax = (totalRuns + (orderedCuts || []).length + 8) * 8 + 1024;
            while (guard++ < guardMax) {
                var rem = pending();
                if (!rem.length) break;
                // Незавершённая резка (продолжение, ножи на станке) — доводим её первой.
                var inProgress = rem.filter(function(id){ return state[id].isCont && state[id].remaining > 0; });
                // #3792: «Зафиксировано» — замок на день. Фиксированная резка ложится ТОЛЬКО на
                // свой день (fixedDay === day): в пул «тянуть будущее вперёд» (#3739) не попадает,
                // а на своём дне берётся раньше свободных, чтобы её не вытеснил их нахлёст. Свободные
                // (fixedDay == null) — как прежде: по сроку (anchor ≤ day), иначе тянем будущую вперёд.
                var fixedToday = rem.filter(function(id){ return state[id].fixedDay != null && state[id].fixedDay === day; });
                var freeDue = rem.filter(function(id){ return state[id].fixedDay == null && (state[id].anchor == null || state[id].anchor <= day); });
                var freeAny = rem.filter(function(id){ return state[id].fixedDay == null; });
                var pick;
                if (inProgress.length) pick = selectByConfig(inProgress);
                else if (fixedToday.length) pick = selectByConfig(fixedToday);
                else if (freeDue.length) {
                    // #3826: фольга всегда в конце дня (#3717) → внутри дня не может вытеснить
                    // нефольгу. Поэтому если на ЭТОТ день приходится фольга СВОЕГО срока (срок ≤
                    // дня), нельзя тянуть вперёд будущую (срок > дня) нефольгу: она съедала хвост,
                    // и фольга своего срока переливалась на следующий день (баг #3826 — фольга со
                    // сроком 23 уезжала на 24, хотя в дне 23 было место). Резервируем хвост дня под
                    // работу своего срока: сперва нефольга своего срока, затем фольга своего срока —
                    // крупнейшая ЦЕЛИКОМ влезающая (без дробления настройки). Когда ни одна фольга
                    // не влезает в остаток — закрываем день (фольга остаётся в конце), хвост фольги
                    // переедет на завтра. Нет фольги своего срока → прежнее поведение (можно тянуть).
                    var dueTodayFoil = freeDue.filter(function(id){
                        return state[id].cut && state[id].cut.isFoil && state[id].dueDay != null && state[id].dueDay <= day;
                    });
                    // фольга уже стоит на этом дне → нефольгу после неё не кладём (#3717).
                    var foilOnDay = segments.some(function(s){
                        var ss = state[String(s.cutId)];
                        return s.dayOffset === day && ss && ss.cut && ss.cut.isFoil;
                    });
                    if (!dueTodayFoil.length) {
                        pick = selectByConfig(freeDue);
                    } else {
                        var dueTodayNonFoil = freeDue.filter(function(id){
                            return !(state[id].cut && state[id].cut.isFoil) && state[id].dueDay != null && state[id].dueDay <= day;
                        });
                        if (dueTodayNonFoil.length && !foilOnDay) {
                            pick = selectByConfig(dueTodayNonFoil);   // сперва нефольга своего срока
                        } else {
                            pick = bestFittingFoil(dueTodayFoil);   // фольга своего срока — крупнейшая целиком влезающая
                            if (pick == null) {
                                // ни одна фольга своего срока целиком не влезла в остаток дня.
                                var foilBiggerThanDay = dueTodayFoil.filter(function(id){
                                    return (state[id].remaining * (state[id].perPass + leader)) > capacity;
                                });
                                if (foilBiggerThanDay.length) {
                                    pick = selectByConfig(foilBiggerThanDay);   // крупнее целого дня → дробим (заполнит остаток)
                                } else if (!foilOnDay) {
                                    // фольги на дне ещё нет → остаток дозаполняем нефольгой (тянем
                                    // вперёд будущую) — фольга уедет на след. день в конец, «фольга в
                                    // конце» не нарушается (на этом дне фольги нет).
                                    var fillNonFoil = freeDue.filter(function(id){ return !(state[id].cut && state[id].cut.isFoil); });
                                    if (fillNonFoil.length) pick = selectByConfig(fillNonFoil);
                                    else if (clock > 0) { day += 1; clock = 0; continue; }
                                    else pick = selectByConfig(dueTodayFoil);
                                } else if (clock > 0) { day += 1; clock = 0; continue; }   // фольга уже на дне → закрываем день
                                else pick = selectByConfig(dueTodayFoil);
                            }
                        }
                    }
                }
                else if (freeAny.length) pick = selectByConfig(freeAny);   // нет «по сроку» → тянем будущую свободную вперёд
                else {
                    // Остались только будущие зафиксированные — прыгаем к ближайшему их дню
                    // (свободных в пуле нет, нахлёст-простой заполнять некем).
                    var nextFixedDay = null;
                    rem.forEach(function(id){
                        var fd = state[id].fixedDay;
                        if (fd != null && fd > day && (nextFixedDay == null || fd < nextFixedDay)) nextFixedDay = fd;
                    });
                    if (nextFixedDay == null) break;
                    day = nextFixedDay; clock = 0; continue;
                }
                var st = state[pick], c = st.cut;
                // #3792: фиксированная резка — один сегмент на своём дне, без разбивки; нахлёст за
                // конец смены допустим (как обычный gapFill-нахлёст). Настройка — переналадка с
                // предыдущей физической резкой. День не двигаем: переполнение само вытолкнет
                // следующие свободные на завтра (avail < 0 → ветка-страж ниже).
                if (st.fixedDay != null) {
                    insertLunchBefore();
                    var setupF = setupCostFor(prevPhysical, c);
                    var perPassF = st.perPass + leader;
                    var wsF = day * 1440 + dayStart + clock;
                    var durF = (st.remaining > 0 && st.perPass > 0 && hasWindow) ? st.remaining * perPassF : 0;
                    segments.push({ cutId: pick, dayOffset: day, runs: st.remaining,
                        windowStartMin: round3(wsF), startMin: round3(wsF + setupF), setupMin: round3(setupF),
                        durationMin: round3(durF), isContinuation: false, parentCutId: null });
                    clock += setupF + durF;
                    prevPhysical = c; st.remaining = 0; st.placedEmpty = true;
                    continue;
                }
                // #3792: предыдущая фикс-резка могла переполнить день (нахлёст) — свободные тогда
                // начинают со следующего дня, без хвостовой настройки на уже переполненном дне.
                if (clock > 0 && (effCapacity(day) - clock) < 0) { day += 1; clock = 0; continue; }
                insertLunchBefore();
                // Резка без проходов/окна — один сегментик (как базовая ветка).
                if (!(st.remaining > 0) || !(st.perPass > 0) || !hasWindow) {
                    var s0 = leader + setupCostFor(prevPhysical, c);
                    var w0 = day * 1440 + dayStart + clock;
                    segments.push({ cutId: pick, dayOffset: day, runs: st.remaining,
                        windowStartMin: round3(w0), startMin: round3(w0 + s0), setupMin: round3(s0),
                        durationMin: 0, isContinuation: false, parentCutId: null });
                    clock += s0;
                    prevPhysical = c; st.remaining = 0; st.placedEmpty = true;
                    continue;
                }
                var perPassEffG = st.perPass + leader;
                var setupG = st.isCont ? (Number(st.pendingSetup) || 0) : setupCostFor(prevPhysical, c);
                var availG = effCapacity(day) - clock;
                // #3847: ёмкость хвоста с учётом разрешённого нахлёста. Для проходов потолок —
                // DAY_END_HOUR+MAX_OVERWORK_CUTS, для настройки — DAY_END_HOUR+MAX_OVERWORK_TUNE
                // (фича выкл → обычная ёмкость до cutEndMin, как #3821).
                var availCutsG = availFor(day, 'cuts');
                var availTuneG = availFor(day, 'tune');
                // #3821/#3847: в хвост дня кладём проходы, влезающие в ёмкость С УЧЁТОМ нахлёста —
                // последний проход обязан кончиться ≤ DAY_END_HOUR+MAX_OVERWORK_CUTS (нахлёст за
                // конец смены ограничен, а не «один любой проход» #3760 и не «строго встык» #3821:
                // короткий хвост проходит, длинный — на следующий день). Остаток проходов — на завтра;
                // не влезает ни один — настройку в хвост (ветка ниже), проходы — на завтра.
                var fittingG = (availCutsG >= setupG) ? Math.floor((availCutsG - setupG) / perPassEffG) : 0;
                if (fittingG < 0) fittingG = 0;
                if (fittingG > 0) {
                    var passesNowG = Math.min(st.remaining, fittingG);
                    var wsG = day * 1440 + dayStart + clock, durG = passesNowG * perPassEffG;
                    segments.push({ cutId: pick, dayOffset: day, runs: passesNowG,
                        windowStartMin: round3(wsG), startMin: round3(wsG + setupG), setupMin: round3(setupG),
                        durationMin: round3(durG), isContinuation: st.isCont, parentCutId: st.isCont ? pick : null });
                    st.remaining -= passesNowG; st.isCont = true; st.pendingSetup = 0; prevPhysical = c;
                    if (st.remaining > 0) { day += 1; clock = 0; }     // остаток проходов — на следующий день
                    else { clock += setupG + durG; }
                } else if (clock > 0) {
                    // #3760/#3805/#3821: в хвост дня не влезает ни один проход. ЕСТЬ настройка — кладём её
                    // в хвост: ПОДМНОЖЕСТВО компонентов, дотягивающее до конца смены с минимальным
                    // нахлёстом (minOverlapTailSetupMinutes); влезает целиком (availG≥setupG) — всю.
                    // Остаток настройки + проходы — на следующий день. НЕТ настройки (та же конфигурация,
                    // #3821: setupG=0) — ничего в хвост не кладём (иначе пустой сегмент), резка целиком
                    // на следующий день; небольшой простой в хвосте допустим (без нахлёстного прохода).
                    var partsG = st.isCont ? [{ minutes: setupG }] : setupPartsFor(prevPhysical, c);
                    // #3847: настройку в хвост — до потолка DAY_END_HOUR+MAX_OVERWORK_TUNE (availTuneG),
                    // не до cutEndMin: настройка может нахлестнуть за конец смены сильнее, чем резка.
                    var tailSetup = minOverlapTailSetupMinutes(partsG, availTuneG, setupG);
                    if (tailSetup > 0) {
                        var wsS = day * 1440 + dayStart + clock;
                        segments.push({ cutId: pick, dayOffset: day, runs: 0,
                            windowStartMin: round3(wsS), startMin: round3(wsS + tailSetup), setupMin: round3(tailSetup),
                            durationMin: 0, isContinuation: false, parentCutId: null, setupOnly: true });
                        clock += tailSetup; prevPhysical = c;
                        st.isCont = true; st.pendingSetup = round3(setupG - tailSetup);
                    }
                    day += 1; clock = 0;
                } else {
                    // Вырожденно: даже ПУСТОЙ день не вмещает настройку + один проход (настройка или
                    // одиночный проход длиннее целого окна). Разбить одиночный проход нельзя — кладём
                    // настройку + 1 проход с нахлёстом, остальное на следующий день (#3821: единственный
                    // случай, где нахлёстный проход сохраняется, иначе резка не разместилась бы никогда).
                    var wsO = day * 1440 + dayStart + clock, durO = 1 * perPassEffG;
                    segments.push({ cutId: pick, dayOffset: day, runs: 1,
                        windowStartMin: round3(wsO), startMin: round3(wsO + setupG), setupMin: round3(setupG),
                        durationMin: round3(durO), isContinuation: st.isCont, parentCutId: st.isCont ? pick : null });
                    st.remaining -= 1; st.isCont = true; st.pendingSetup = 0; prevPhysical = c;
                    day += 1; clock = 0;
                }
            }
            return applyDowntime(segments);   // #3764
        }
        (orderedCuts || []).forEach(function(c){
            var cid = c && c.id;
            // #3658: если очередь не дотянула до рабочего дня этой резки — прыгаем вперёд к
            // нему (08:00). Назад не двигаем (переполнение предыдущих дней сохраняется).
            var anchorDay = anchorByCut[String(cid)];
            if (anchorDay != null && anchorDay > day) { day = anchorDay; clock = 0; }
            var runs = Math.round(Number(runsByCut[String(cid)] != null ? runsByCut[String(cid)] : c && c.plannedRuns) || 0);
            var perPass = Number(perPassByCut[String(cid)] != null ? perPassByCut[String(cid)] : 0) || 0;
            var remaining = runs;
            var isCont = false;
            var pendingSetup = 0;   // #3635 п.5: остаток настройки, перенесённый на продолжение след. дня
            insertLunchBefore();  // #3342: обед перед началом этой резки
            // Резка без проходов/длительности — один сегментик без раскладки по проходам.
            if (!(runs > 0) || !(perPass > 0) || !hasWindow) {
                var setup0 = leader + setupCostFor(prevPhysical, c);   // #3688/#3853: первая резка — от заправки станка (carryPrevSetup)
                var ws0 = day * 1440 + dayStart + clock;
                segments.push({ cutId: String(cid), dayOffset: day, runs: runs, windowStartMin: round3(ws0),
                    startMin: round3(ws0 + setup0), setupMin: round3(setup0),
                    durationMin: round3((runs > 0 && perPass > 0) ? runs * perPass : 0),
                    isContinuation: false, parentCutId: null });
                clock += setup0 + ((runs > 0 && perPass > 0) ? runs * perPass : 0);
                prevPhysical = c;
                return;
            }
            // #3401: каждая резка цуга включает свой лидер — добавляем его к стоимости прохода.
            var perPassEff = perPass + leader;
            while (remaining > 0) {
                // #3401: setup сегмента — переналадка с предыдущей резкой; лидер уже в perPassEff.
                // #3635 п.5: у продолжения после сегмента настройки setup = ОСТАТОК настройки
                // (pendingSetup), перенесённый с дня N (а не 0 — иначе остаток настройки терялся).
                var setup = isCont ? pendingSetup : setupCostFor(prevPhysical, c);   // #3688/#3853: первая резка — от заправки станка (carryPrevSetup)
                var avail = effCapacity(day) - clock;
                // #3847: проходы — до потолка DAY_END_HOUR+MAX_OVERWORK_CUTS, настройка-хвост — до
                // DAY_END_HOUR+MAX_OVERWORK_TUNE (фича выкл → обычная ёмкость до cutEndMin).
                var maxPasses = Math.floor((availFor(day, 'cuts') - setup) / perPassEff);
                if (maxPasses < 1) {
                    // #3635 п.5: первый проход в остаток дня уже не влезает → в хвост дня N кладём
                    // отдельный сегмент НАСТРОЙКИ, а намотку начинаем с дня N+1 как продолжение.
                    // #3760/#3805: в хвост — НЕ всю переналадку, а ПОДМНОЖЕСТВО её компонентов
                    // (ножи/сырьё), заполняющее окно резки до конца смены с минимальным нахлёстом
                    // (minOverlapTailSetupMinutes по остатку cut-окна effCapacity−clock). Остаток
                    // настройки (pendingSetup) переносим на продолжение дня N+1. Раньше тут клалась
                    // ВСЯ настройка (ножи+сырьё), нахлёстывая за конец смены: оператору доставалось
                    // «и ножи, и сырьё в один день», хотя влезала только часть (заказчик: «надо было
                    // сделать что-то одно — настройку ножей, остальное завтра»).
                    if (clock > 0 && !isCont && setup > 0) {
                        // #3847: в хвост кладём подмножество настройки, заполняющее ОСТАТОК ДО ПОТОЛКА
                        // нахлёста настройки (availFor 'tune'), с минимальным нахлёстом. Остаток — завтра.
                        var tailAvail = availFor(day, 'tune');
                        var setupParts = setupPartsFor(prevPhysical, c);
                        var tailSetup = minOverlapTailSetupMinutes(setupParts, tailAvail, setup);
                        // кладём хвост, только если выбранное подмножество реально помещается в потолок
                        // нахлёста настройки (#3847); иначе — вся резка на чистый следующий день.
                        // pendingSetup = setup − tailSetup: 0, если влезла вся настройка; >0 — остаток на завтра.
                        if (tailSetup > 0 && tailAvail >= tailSetup) {
                            var wsSet = day * 1440 + dayStart + clock;
                            segments.push({ cutId: String(cid), dayOffset: day, runs: 0,
                                windowStartMin: round3(wsSet), startMin: round3(wsSet + tailSetup),
                                setupMin: round3(tailSetup), durationMin: 0,
                                isContinuation: false, parentCutId: null, setupOnly: true });
                            clock += tailSetup;
                            prevPhysical = c;
                            isCont = true;                          // проходы дня N+1 — продолжение
                            pendingSetup = round3(setup - tailSetup);   // остаток настройки → на продолжение
                            day += 1; clock = 0; continue;
                        }
                    }
                    if (clock > 0) { day += 1; clock = 0; continue; }   // переносим на чистый след. день
                    maxPasses = 1;   // целый день не вмещает даже setup+1 проход — кладём 1 (переполнение)
                }
                var passesNow = Math.min(remaining, maxPasses);
                var windowStart = day * 1440 + dayStart + clock;
                var segDur = passesNow * perPassEff;
                segments.push({ cutId: String(cid), dayOffset: day, runs: passesNow,
                    windowStartMin: round3(windowStart), startMin: round3(windowStart + setup),
                    setupMin: round3(setup), durationMin: round3(segDur),
                    isContinuation: isCont, parentCutId: isCont ? String(cid) : null });
                clock += setup + segDur;
                remaining -= passesNow;
                prevPhysical = c;
                isCont = true;   // дальнейшие сегменты этой резки — продолжения (ножи остаются)
                pendingSetup = 0;   // #3635 п.5: остаток настройки применён к этому сегменту — больше не добавляем
            }
        });
        return applyDowntime(segments);   // #3764
    }

    // #3280: минуты расписания (от полуночи дня планирования) → Unix-штамп (секунды).
    // dayMidnightMs — полночь дня планирования (мс); windowStartMin — минуты окна резки.
    function scheduleStartTimestamp(dayMidnightMs, windowStartMin){
        var base = Number(dayMidnightMs);
        var min = Number(windowStartMin);
        if (!isFinite(base) || !isFinite(min)) return 0;
        // planStart всегда на ЦЕЛОЙ минуте, округление ВВЕРХ. Иначе при дробном окне (раздроблённая
        // намотка) в штампе оставались секунды, и Гант (обрезает :SS вниз) расходился со страницей
        // (округляет вверх) на ±1 мин. splitMachineQueue остаётся ЕДИНСТВЕННЫМ источником planStart
        // (он же знает про нахлёст настройки #3805 и разрыв по дням #3635 п.5) — здесь только снап к
        // минуте, без отдельного пересчёта по сохранённым окнам.
        return Math.floor((base + Math.ceil(min) * 60000) / 1000);
    }

    // #3280: плановое время старта каждой резки как Unix-штамп (для записи в t1078 —
    // главное значение «Производственной резки»). Группируем по станку, упорядочиваем
    // очередь (orderCuts), строим расписание (buildSchedule) и берём начало окна
    // (startMin − setupMin) — то же время, что в .atex-pp-cut-num / .atex-pp-cut-time.
    //   opts: { weights, windPoints, times, dayStartMin, dayEndMin, runLengthByCut,
    //           planBaseMidnightMs }. → { cutId: штамп(сек) }. Вход не мутирует.
    function planStartTimestamps(cuts, opts){
        opts = opts || {};
        var base = Number(opts.planBaseMidnightMs);
        var byMachine = {};
        var order = [];
        (cuts || []).forEach(function(c){
            var sid = c && c.slitter && c.slitter.id;
            if (sid == null) return;
            var key = String(sid);
            if (!byMachine[key]) { byMachine[key] = []; order.push(key); }
            byMachine[key].push(c);
        });
        var out = {};
        order.forEach(function(key){
            var ordered = orderCuts(byMachine[key], opts.weights);
            var sched = buildSchedule(ordered, {
                windPoints: opts.windPoints || [],
                times: opts.times || DEFAULT_OP_TIMES,
                runLengthByCut: opts.runLengthByCut || {},
                shiftStartMin: opts.dayStartMin,
                shiftEndMin: opts.dayEndMin,
                lunchStartMin: opts.lunchStartMin,
                lunchDurationMin: opts.lunchDurationMin,
                firstCutSetup: opts.firstCutSetup,   // #3669 п.2: настройка ножей первой задачи (от вызывающего)
                blockedRanges: (opts.blockedRangesBySlitter || {})[key]   // #3764: окна «Отпуска» этого станка
            });
            sched.forEach(function(sc){
                var windowStart = stripNum(sc.startMin) - stripNum(sc.setupMin);
                out[String(sc.cutId)] = scheduleStartTimestamp(base, windowStart);
            });
        });
        return out;
    }

    // Ближайшее свободное окно станка для НОВОЙ резки. Повторяет расписание очереди
    // (buildSchedule по порядку), добавляя проспект-резку в КОНЕЦ очереди станка, и
    // возвращает окно последнего сегмента — то же время, что покажет очередь после
    // создания (резка станет последней в своём дне). Вход не мутирует.
    //   stationCuts — резки станка в порядке очереди (как из groupBySlitter);
    //   prospect — { id, plannedRuns, materialId, winding, knifeWidths, runLength };
    //   opts — { windPoints, times, runLengthByCut:{cutId:м}, shiftStartMin, shiftEndMin }.
    // → { windowStartMin, startMin, finishMin, durationMin, setupMin, day } | null.
    function freeSlotForQueue(stationCuts, prospect, opts){
        opts = opts || {};
        if (!prospect) return null;
        var runLen = {};
        var src = opts.runLengthByCut || {};
        Object.keys(src).forEach(function(k){ runLen[k] = src[k]; });
        runLen[String(prospect.id)] = Number(prospect.runLength) || Number(runLen[String(prospect.id)]) || 0;
        var queue = (stationCuts || []).concat([prospect]);
        var sched = buildSchedule(queue, {
            windPoints: opts.windPoints || [],
            times: opts.times,
            runLengthByCut: runLen,
            shiftStartMin: opts.shiftStartMin,
            shiftEndMin: opts.shiftEndMin,
            lunchStartMin: opts.lunchStartMin,
            lunchDurationMin: opts.lunchDurationMin,
            firstCutSetup: opts.firstCutSetup   // #3669 п.2: настройка ножей первой задачи (от вызывающего)
        });
        var sc = sched.length ? sched[sched.length - 1] : null;
        if (!sc) return null;
        var setup = stripNum(sc.setupMin);
        var startMin = stripNum(sc.startMin);
        return {
            windowStartMin: round3(startMin - setup),
            startMin: round3(startMin),
            finishMin: round3(stripNum(sc.finishMin)),
            durationMin: round3(stripNum(sc.durationMin)),
            setupMin: round3(setup),
            day: Math.floor(startMin / 1440)
        };
    }

    // #3280: номер календарного дня плановой даты (для смежности «продолжений»). null — нет даты.
    function planDayNumber(c){
        var s = String(c && c.planDate != null && c.planDate !== '' ? c.planDate : (c && c.number)).trim();
        if (!/^\d{9,13}$/.test(s)) return null;
        var num = Number(s);
        var ms = num >= 1e12 ? num : num * 1000;
        return Math.floor(ms / 86400000);
    }

    // #3280: сигнатура «той же резки на станке» — станок|сырьё|намотка|набор ножей.
    // По ней распознаём цепочки записей-продолжений (без схемного маркера).
    function continuationSignature(c){
        var ks = ((c && c.knifeWidths) || []).slice().map(Number).sort(function(a, b){ return a - b; });
        return [
            (c && c.slitter && c.slitter.id) == null ? '' : String(c.slitter.id),
            (c && c.materialId) == null ? '' : String(c.materialId),
            normWinding(c && c.winding),
            ks.join(',')
        ].join('|');
    }

    // #3613: две соседние карточки очереди — один и тот же логический «задание»,
    // физически разрезанный по рабочим дням (задание не влезло в день — нормально
    // дробить). Объединяющий признак: идентичная конфигурация резки (станок|сырьё|
    // намотка|ножи — continuationSignature) и единый номер заказа (orderId). По нему
    // renderQueue рисует значок смежности «←»/«→» на первой/последней карточке дня.
    function isDaySplitSibling(a, b){
        if (!a || !b) return false;
        if (continuationSignature(a) !== continuationSignature(b)) return false;
        return String((a && a.orderId) || '') === String((b && b.orderId) || '');
    }

    // #3613: какие значки смежности дня показать на карточке очереди. Карточка —
    // первая в своём рабочем дне, если сосед слева (prev) попал в другой день; последняя —
    // если сосед справа (next) в другом дне. Значок ставим только когда соседний сегмент
    // через границу дня — тот же логический задание (isDaySplitSibling): задание не влезло
    // в день и его раздробили. Дни берём из расписания (schedDay) — те же, что разделяют
    // дни блоком уборки. → { fromPrev, toNext }. Чистая (без DOM) → проверяется тестом.
    function daySplitBadges(prevCut, prevDay, cut, myDay, nextCut, nextDay){
        if (myDay == null) return { fromPrev: false, toNext: false };
        return {
            fromPrev: prevDay != null && prevDay !== myDay && isDaySplitSibling(prevCut, cut),
            toNext: nextDay != null && nextDay !== myDay && isDaySplitSibling(cut, nextCut)
        };
    }

    // #3737: недостающий сосед карточки через ВНЕШНЮЮ границу выбранного диапазона дат.
    // Сегмент-продолжение задания за границей диапазона лежит в дне ВНЕ фильтра — в очередь
    // он не попадает, но присутствует в полном наборе резок (cut_planning грузится целиком).
    // Поэтому у первой/последней карточки диапазона соседа через границу дня нет и значок
    // ←/→ не рисуется (баг при выборе одного дня). Возвращает ближайший по КАЛЕНДАРНОМУ дню
    // смежный по заданию (isDaySplitSibling) сегмент того же станка в более раннем (dir<0, ←)
    // либо позднем (dir>0, →) дне, чем у `cut`; null — нет такого. Чистая → покрыта тестом.
    function boundaryDaySibling(cuts, cut, dir){
        if (!cut) return null;
        var d0 = planDateDayKey(cut.planDate);
        if (d0 === Infinity) return null;
        var sid = String((cut.slitter && cut.slitter.id) || '');
        var best = null, bestKey = dir < 0 ? -Infinity : Infinity;
        (cuts || []).forEach(function(o){
            if (!o || String(o.id) === String(cut.id)) return;
            if (String((o.slitter && o.slitter.id) || '') !== sid) return;
            if (!isDaySplitSibling(o, cut)) return;
            var k = planDateDayKey(o.planDate);
            if (k === Infinity) return;
            if (dir < 0 ? (k < d0 && k > bestKey) : (k > d0 && k < bestKey)) { bestKey = k; best = o; }
        });
        return best;
    }

    // #3280: слить записи-продолжения обратно в логические резки перед пере-разбиением.
    // Эвристика (без маркера): одинаковая сигнатура continuationSignature + смежные
    // календарные дни (разница 1) → одна цепочка; выживает самая ранняя запись (её id),
    // её «Кол-во план» = сумма проходов цепочки; остальные записи — в deletes.
    // → { cuts:[логические резки], deletes:[id записей-продолжений], chainByLogical:{logicalId:[id…]} }.
    // Вход не мутирует.
    function mergeContinuationChains(cuts){
        var logical = [], deletes = [], chainByLogical = {};
        function sortByDay(arr){
            return arr.slice().sort(function(a, b){
                var da = planDayNumber(a), db = planDayNumber(b);
                if (da == null && db == null) return 0;
                if (da == null) return 1;
                if (db == null) return -1;
                return da - db;
            });
        }
        // chain — записи одной логической резки по возрастанию дня (chain[0] = голова).
        function emitChain(chain){
            var head = chain[0];
            var lg = {};
            for (var k in head) { if (Object.prototype.hasOwnProperty.call(head, k)) lg[k] = head[k]; }
            lg.plannedRuns = chain.reduce(function(sum, c){ return sum + (Number(c.plannedRuns) || 0); }, 0);
            logical.push(lg);
            chainByLogical[String(head.id)] = chain.map(function(c){ return String(c.id); });
            for (var m = 1; m < chain.length; m++) deletes.push(String(chain[m].id));
        }
        // #3892: основной признак цепочки — ЯВНЫЙ «ID первой части» (firstPartId = id головы).
        // Записи с непустым маркером группируем по нему (надёжно: не зависит от совпадения
        // сигнатуры/сырья и не склеивает разные заказы одной конфигурации соседних дней).
        // Записи без маркера (легаси до миграции) — прежней эвристикой (сигнатура + смежные дни).
        var explicitGroups = {}, explicitOrder = [], legacyCuts = [];
        (cuts || []).forEach(function(c){
            var fp = (c && c.firstPartId != null) ? String(c.firstPartId).trim() : '';
            if (fp !== '') {
                if (!explicitGroups[fp]) { explicitGroups[fp] = []; explicitOrder.push(fp); }
                explicitGroups[fp].push(c);
            } else {
                legacyCuts.push(c);
            }
        });
        explicitOrder.forEach(function(fp){
            var arr = sortByDay(explicitGroups[fp]);
            // Голова = запись, чей id == маркеру (ссылается на себя). Нет такой (голову удалили/
            // перенесли) → самый ранний сегмент становится головой; следующее сохранение
            // перепроставит маркер на его id. Голову держим первой, остальное — по дню.
            var headIdx = -1;
            for (var i = 0; i < arr.length; i++) { if (String(arr[i].id) === fp) { headIdx = i; break; } }
            if (headIdx > 0) { var h = arr.splice(headIdx, 1)[0]; arr.unshift(h); }
            emitChain(arr);
        });
        // Легаси-эвристика (#3280): одинаковая continuationSignature + смежные календарные дни.
        var groups = {}, order = [];
        legacyCuts.forEach(function(c){
            var s = continuationSignature(c);
            if (!groups[s]) { groups[s] = []; order.push(s); }
            groups[s].push(c);
        });
        order.forEach(function(s){
            var arr = sortByDay(groups[s]);
            var i = 0;
            while (i < arr.length) {
                var chain = [arr[i]];
                var j = i + 1;
                while (j < arr.length) {
                    var prevDay = planDayNumber(arr[j - 1]);
                    var curDay = planDayNumber(arr[j]);
                    if (prevDay == null || curDay == null || (curDay - prevDay) !== 1) break;
                    chain.push(arr[j]);
                    j++;
                }
                emitChain(chain);
                i = j;
            }
        });
        return { cuts: logical, deletes: deletes, chainByLogical: chainByLogical };
    }

    // #3280: план операций физического разбиения резок по дням. Сливает цепочки-продолжения
    // (mergeContinuationChains), упорядочивает очередь каждого станка (orderCuts) и
    // раскладывает по дням на уровне проходов (splitMachineQueue). →
    //   { updates:[{cutId, sequence, planStartTs, plannedRuns}],            // сегменты, легшие на существующие записи цепочки
    //     creates:[{parentCutId, sequence, planStartTs, plannedRuns}],       // сегменты сверх имеющихся записей → новые
    //     deletes:[cutId…] }                                                 // лишние записи цепочки (сегментов стало меньше)
    // #3427: ИДЕМПОТЕНТНОСТЬ. Сегменты-продолжения переиспользуют УЖЕ существующие записи
    // цепочки (chainByLogical: голова + продолжения по дням), а не пересоздаются каждый раз.
    // Поэтому повторный прогон при неизменной раскладке даёт те же записи с теми же
    // очередностью/временем/проходами → autoSequenceQueue отфильтрует их как «без изменений»
    // и не сделает ни одной записи. Прежняя версия всегда удаляла продолжения и создавала их
    // заново, а аппликатор при этом повторно делил уже делённое Обеспечение головы (метраж
    // усыхал на каждый повтор). Новые записи — только если сегментов стало БОЛЬШЕ, чем записей
    // в цепочке; удаления — только лишние записи, когда сегментов стало МЕНЬШЕ.
    // Деление Обеспечения и копию Полос на новые продолжения выполняет аппликатор (нужны id
    // новых записей и метаданные ссылок) — здесь только очередь/время/проходы. Вход не мутирует.
    function planCutOperations(cuts, opts){
        opts = opts || {};
        var base = Number(opts.planBaseMidnightMs);
        var merged = mergeContinuationChains(cuts);
        var chainByLogical = merged.chainByLogical || {};
        // #3815: проставить «Срок изготовления» (самый ранний срок обеспечиваемых позиций,
        // dueKeyByCut по id головы) на логические резки — чтобы упорядочивание (orderCuts) и
        // по-дневная раскладка (splitMachineQueue/selectByConfig) ставили задания с более ранним
        // сроком на более ранние дни (EDD). Нет срока → Infinity (в конец). merged.cuts — копии
        // голов, поэтому self.cuts не мутируем.
        var dueKeyByCut = opts.dueKeyByCut || {};
        merged.cuts.forEach(function(c){
            var dk = (c && c.id != null) ? dueKeyByCut[String(c.id)] : null;
            c.dueKey = (dk != null && isFinite(dk)) ? Number(dk) : Infinity;
        });
        // #3815: задание не должно «застревать» позже своего «Срока изготовления» из-за прежней
        // «Даты план». Для НЕзафиксированных резок нижняя граница дня (anchor) ослабляется до дня
        // срока (но не раньше начала окна, day 0): EDD сможет подтянуть задание с ранним сроком на
        // ранний день, даже если прежняя раскладка поставила его позже (иначе при по-требованию
        // пересборке «Упорядочить»/генерации старый якорь дня держал бы баг: на дне N — срок N+1,
        // на N+1 — срок N). Зафиксированные задания (#3508) остаются на своём дне — якорь не трогаем.
        // Активно только при наличии срока (есть dueKeyByCut); без сроков effAnchor == исходный.
        var anchorIn = opts.dayAnchorByCut || {};
        var effAnchorByCut = {};
        merged.cuts.forEach(function(c){
            var id = String(c && c.id);
            var a = anchorIn[id];
            if (a == null) return;   // нет «Даты план» — без якоря (как было)
            if (c && c.fixed) { effAnchorByCut[id] = a; return; }   // фикс — на своём дне
            var dueOff = dueDayOffsetFromBase(c && c.dueKey, base);
            effAnchorByCut[id] = (dueOff != null) ? Math.min(a, Math.max(0, dueOff)) : a;
        });
        // #3826: день «Срока изготовления» (смещение от базы) на каждую резку — нужен
        // splitMachineQueue, чтобы отличить «резку этого дня по сроку» (срок ≤ дня) от «тянем
        // вперёд будущую» (срок > дня) и зарезервировать хвост дня под фольгу своего срока.
        var dueDayByCut = {};
        merged.cuts.forEach(function(c){
            var off = dueDayOffsetFromBase(c && c.dueKey, base);
            if (off != null) dueDayByCut[String(c && c.id)] = off;
        });
        var perPass = opts.perPassByCut || {};
        // #3660: НЕ перепланировать чужие даты — обрабатываем только цепочки, чья ГОЛОВА в
        // выбранном диапазоне «Дата плана» [scopeFromKey; scopeToKey] (ключи YYYYMMDD). Иначе
        // генерация на 31.05 переписывала очередь/время ВСЕХ будущих заданий. Переполнение дня
        // (продолжение цепочки на следующий день) сохраняется — это сегменты той же головы.
        // Без scope (оба ключа null) — обрабатываем все (обратная совместимость/тесты).
        var scopeFrom = opts.scopeFromKey, scopeTo = opts.scopeToKey;
        var hasScope = scopeFrom != null || scopeTo != null;
        function headInScope(c){
            if (!hasScope) return true;
            var fromK = scopeFrom == null ? -Infinity : scopeFrom;
            var toK = scopeTo == null ? Infinity : scopeTo;
            if (fromK > toK) { var t = fromK; fromK = toK; toK = t; }
            var k = planDateDayKey(c && c.planDate);
            if (k === Infinity) return true;   // без «Дата план» (новая, ещё не датирована) — в scope
            if (k >= fromK && k <= toK) return true;   // «Дата план» в окне фильтра (#3660)
            // #3820: EDD — НЕзафиксированную резку, чей «Срок изготовления» приходится НА окно
            // фильтра или РАНЬШЕ него (dueKey ≤ верхняя граница), но «Дата план» которой стоит
            // ПОЗЖЕ окна (k > toK), всё равно берём в раскладку — иначе задание со сроком 23,
            // «застрявшее» на 24, при фильтре [23;23] не попадало в scope и EDD не могло подтянуть
            // его на 23 (#3815 ослабляет якорь до дня срока, но только для резок В scope). Так
            // просроченное/срочное по сроку задание затягивается в окно; зафиксированное (#3508)
            // и задание со сроком ПОЗЖЕ окна — остаются на своих днях (#3660 для чужих дат в силе).
            if (scopeTo != null && k > toK && c && !c.fixed && isFinite(c.dueKey) && Number(c.dueKey) <= toK) return true;
            return false;
        }
        var byMachine = {}, mOrder = [];
        merged.cuts.forEach(function(c){
            var sid = c && c.slitter && c.slitter.id;
            if (sid == null) return;
            if (!headInScope(c)) return;   // #3660: чужая дата — не трогаем
            var key = String(sid);
            if (!byMachine[key]) { byMachine[key] = []; mOrder.push(key); }
            byMachine[key].push(c);
        });
        var updates = [], creates = [], deletes = [];
        // headId → число использованных записей цепочки (голова + переиспользованные продолжения).
        var usedByHead = {};
        mOrder.forEach(function(key){
            // #3619: preserveOrder — расщеплять задания по дням, СОХРАНЯЯ текущий порядок
            // очереди (сортировка по «Очередности»), а не пересобирая её по стратегии
            // (orderCuts). Нужно, чтобы автозаполнение дней после генерации не перетасовывало
            // ручной порядок оператора (#3449). Без флага — обычная пересборка по весам (#3421).
            // #3635 п.1/п.2: сортируем СПЕРВА по дню «Даты план», затем по «Очередности» —
            // как groupBySlitter (#3616) и planQueues. «Очередность» сбрасывается на каждый
            // день, поэтому сортировка только по ней перемешивала дни: задание дня D+1 с
            // очередью 1 вставало перед фольгой дня D с очередью 2 → splitMachineQueue
            // переупаковывал перемешанную очередь, фольга всплывала в начало дня и ломала
            // порядок ножей (#3130/#3568), а вид «сразу после планирования» расходился с
            // видом после перезагрузки (groupBySlitter сортирует день-первым).
            // #3717: фольга ВСЕГДА в конец дня — критично (медленная намотка, отдельная норма).
            // preserveOrder сохраняет ручной порядок ВНУТРИ группы (день, фольга?), но фольгу
            // принудительно отправляет за все обычные резки того же дня. Без этого «Очередность»
            // (сбрасывается на день) могла поставить фольгу в начало/середину дня (orderCuts при
            // генерации делает фольгу последней ПО ИСХОДНОМУ дню, но кросс-дневный re-pack и
            // посменная сборка перемешивали её обратно).
            var ordered = opts.preserveOrder
                ? byMachine[key].slice().sort(function(a, b){
                      return comparePlanDayKeys(cutPlanDayKey(a), cutPlanDayKey(b))
                          || (((a && a.isFoil) ? 1 : 0) - ((b && b.isFoil) ? 1 : 0))   // #3717: фольга — в конец дня
                          || ((Number(a.sequence) || 0) - (Number(b.sequence) || 0));
                  })
                : orderCuts(byMachine[key], opts.weights);
            var runsByCut = {};
            ordered.forEach(function(c){ runsByCut[String(c.id)] = Number(c.plannedRuns) || 0; });
            var segs = splitMachineQueue(ordered, {
                dayStartMin: opts.dayStartMin, dayEndMin: opts.dayEndMin,
                dayEndHourMin: opts.dayEndHourMin,   // #3847: DAY_END_HOUR (реальный конец смены) для лимита нахлёста
                maxOverworkCutsMin: opts.maxOverworkCutsMin,   // #3847: макс. нахлёст резки за DAY_END_HOUR
                maxOverworkTuneMin: opts.maxOverworkTuneMin,   // #3847: макс. нахлёст настройки за DAY_END_HOUR
                leader: opts.leader, times: opts.times,
                perPassByCut: perPass, runsByCut: runsByCut,
                lunchStartMin: opts.lunchStartMin, lunchDurationMin: opts.lunchDurationMin,
                dayAnchorByCut: effAnchorByCut,   // #3658: привязка к дню «Даты план» (#3815: ослаблена до дня срока для нефикс.)
                dueDayByCut: dueDayByCut,   // #3826: день срока — резерв хвоста дня под фольгу своего срока
                firstCutSetup: opts.firstCutSetup,   // #3669 п.2: настройка ножей первой задачи (от вызывающего)
                carryPrevSetup: (opts.prevSetupBySlitter || {})[key],   // #3853: реальная заправка станка для первой резки (как окно в setupActivityColumns)
                gapFill: opts.gapFill,   // #3739: заполнять хвосты смены будущими резками, нахлёст разрешён
                blockedRanges: (opts.blockedRangesBySlitter || {})[key]   // #3764: окна «Отпуска» этого станка
            });
            // headId → индекс продолжения в цепочке (0=голова, 1,2,… — продолжения по дням).
            var contIndexByHead = {};
            segs.forEach(function(seg, idx){
                var ts = scheduleStartTimestamp(base, seg.windowStartMin);
                if (!seg.isContinuation) {
                    var head0 = String(seg.cutId);
                    contIndexByHead[head0] = 0;
                    usedByHead[head0] = 1;   // голова цепочки всегда занята первым сегментом
                    updates.push({ cutId: head0, sequence: idx + 1, planStartTs: ts, plannedRuns: seg.runs });
                } else {
                    var head = String(seg.parentCutId);
                    var k = (contIndexByHead[head] = (contIndexByHead[head] || 0) + 1);
                    var chain = chainByLogical[head] || [head];
                    var reuseId = chain[k];   // chain[0]=голова, chain[1..]=записи-продолжения
                    if (reuseId != null) {
                        usedByHead[head] = k + 1;
                        updates.push({ cutId: String(reuseId), sequence: idx + 1, planStartTs: ts, plannedRuns: seg.runs });
                    } else {
                        creates.push({ parentCutId: head, sequence: idx + 1, planStartTs: ts, plannedRuns: seg.runs });
                    }
                }
                // #3892: «ID первой части» (голова цепочки) НЕ кладём в ops — applySplitPlan
                // выводит её из chainHeadById (для update) / parentCutId (для create), чтобы не
                // менять контракт planCutOperations (строгие сравнения ops в тестах #3280/#3427).
            });
        });
        // Лишние записи цепочки (сегментов стало меньше, чем записей) — на удаление. Цепочки
        // станков, которые мы НЕ раскладывали (usedByHead нет), не трогаем — данные не теряем.
        Object.keys(chainByLogical).forEach(function(head){
            var chain = chainByLogical[head];
            var used = usedByHead[head];
            if (used == null) return;
            for (var k = used; k < chain.length; k++) deletes.push(String(chain[k]));
        });
        return { updates: updates, creates: creates, deletes: deletes };
    }

    // #3280: разделить рулоны/метраж одной строки Обеспечения между сегментами резки
    // ПРОПОРЦИОНАЛЬНО проходам. Рулоны — целые, сумма долей = исходным рулонам
    // (остаток по наибольшей дробной части). Метраж — дробно, последняя доля = остаток.
    //   rolls, footage — исходные; runs — массив проходов по сегментам (сегмент 0 = «сегодня»).
    // → [{ rolls, footage }] длиной runs.length. runs пуст/сумма 0 → всё в сегмент 0.
    function splitSupplyShares(rolls, footage, runs){
        var r = (runs || []).map(function(x){ return Number(x) || 0; });
        var n = r.length;
        var R = Math.round(Number(rolls) || 0);
        var F = Number(footage) || 0;
        if (n === 0) return [];
        var total = r.reduce(function(s, x){ return s + x; }, 0);
        var out = [];
        if (!(total > 0)) {
            for (var z = 0; z < n; z++) out.push({ rolls: z === 0 ? R : 0, footage: z === 0 ? round3(F) : 0 });
            return out;
        }
        // Рулоны: floor + раздача остатка по наибольшей дробной части.
        var base = [], rem = [], used = 0;
        for (var i = 0; i < n; i++) {
            var exact = R * r[i] / total;
            var fl = Math.floor(exact);
            base.push(fl); rem.push({ idx: i, frac: exact - fl }); used += fl;
        }
        var left = R - used;
        rem.sort(function(a, b){ return b.frac - a.frac; });
        for (var k = 0; k < left; k++) base[rem[k % n].idx] += 1;
        // Метраж: пропорционально, последняя ненулевая доля добирает остаток (точная сумма).
        var fAcc = 0, lastIdx = -1;
        for (var j = 0; j < n; j++) if (r[j] > 0) lastIdx = j;
        for (var m2 = 0; m2 < n; m2++) {
            var fv;
            if (r[m2] <= 0) fv = 0;
            else if (m2 === lastIdx) fv = round3(F - fAcc);
            else { fv = round3(F * r[m2] / total); fAcc += fv; }
            out.push({ rolls: base[m2], footage: fv });
        }
        return out;
    }

    // Минуты от полуночи → «ЧЧ:ММ» (с «+Nд», если перевалило за сутки). Терпимо к числам.
    function formatClock(min){
        var m = Math.round(Number(min) || 0);
        var hm = ((m % 1440) + 1440) % 1440;
        var h = Math.floor(hm / 60), mm = hm % 60;
        return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
    }

    function formatClockHHMM(min){
        var m = Math.round(Number(min) || 0);
        var hm = ((m % 1440) + 1440) % 1440;
        var h = Math.floor(hm / 60), mm = hm % 60;
        return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
    }

    // #3280: на карточке (.atex-pp-cut-num) показываем то же время, что и начало
    // окна в .atex-pp-cut-time — первый шаг тайминга (startMin − setupMin), ЧЧ:ММ.
    function cutStartWindowMin(sc) {
        return stripNum(sc && sc.startMin) - stripNum(sc && sc.setupMin);
    }
    function formatCutStartTime(sc) {
        return sc ? formatClock(cutStartWindowMin(sc)) : '—';
    }
    // #3280: title карточки — плановая дата+время старта до минут. baseMidnightMs —
    // полночь дня планирования (день 0 расписания); сегмент сдвинут на windowStartMin.
    function formatCutStartTitle(sc, baseMidnightMs) {
        if (!sc) return '';
        return formatCutNumber(scheduleStartTimestamp(baseMidnightMs, cutStartWindowMin(sc)));
    }

    // Свободное окно для опции станка / превью: «дата ЧЧ:ММ (старт–финиш)».
    function formatFreeSlot(slot) {
        if (!slot) return 'нет данных';
        return formatCutNumber(slot.startTs) + ' (' + formatClock(slot.startMin) + '–' + formatClock(slot.finishMin) + ')';
    }

    function formatCutWindingLabel(cut) {
        var raw = cut && cut.winding;
        var winding = normWinding(raw) || String(raw == null ? '' : raw).trim() || '—';
        return 'Намотка: ' + winding;
    }

    function formatScheduleLine(sc, runLength, hasWindingPoints) {
        if (!sc) return '';
        var dur = stripNum(sc.durationMin);
        if (dur <= 0) {
            if (stripNum(runLength) <= 0) return '⏱ ошибка: нет метража прохода; длительность не рассчитана';
            if (!hasWindingPoints) return '⏱ ошибка: нет норм WIND_*; длительность не рассчитана';
            return '⏱ ошибка: длительность 0 мин; проверьте проходы и нормы намотки';
        }
        // #3262: показываем всё ОКНО (setup + резка + лидер), как «Тайминг окна» в модалке —
        // старт = начало setup (startMin − setupMin), длительность = setup + резка + лидер
        // (диапазон совпадает с числом минут, как у блока уборки). Так начало в карточке
        // равно первому шагу тайминга окна, а не старту самой резки.
        // #3688: лидер заправляют В КОНЦЕ резки — он входит в окно станка (после намотки).
        var setup = stripNum(sc.setupMin);
        var leaderMin = stripNum(sc.leaderMin);
        var windowStart = stripNum(sc.startMin) - setup;
        var windowEnd = stripNum(sc.finishMin) + leaderMin;
        // #3635 п.4: минуты окна показываем ЦЕЛЫМ числом, округляя ВВЕРХ (36.264 → 37) —
        // совпадает с диапазоном по часам (09:03–09:40 ≈ 37 мин), без дробного «хвоста».
        return '⏱ ' + formatClock(windowStart) + ' – ' + formatClock(windowEnd) + ' · ' + Math.ceil(setup + dur + leaderMin) + ' мин';
    }

    // Допуск остатка джамбо (мм): если задан (непустая строка) — берём его (терпимо
    // к запятой), иначе дефолт. «0» считается заданным значением. #3120 + ideav/crm#3127.
    function resolveTolerance(rawValue, defaultMm) {
        var s = String(rawValue == null ? '' : rawValue).trim();
        if (s === '') return Number(defaultMm) || 0;
        var n = Number(s.replace(',', '.'));
        return isFinite(n) ? n : (Number(defaultMm) || 0);
    }

    // Занятая полосами ширина — Σ(ширина × количество).
    function stripsUsedWidth(strips) {
        return round3((strips || []).reduce(function(sum, s) {
            return sum + stripNum(s.width) * stripNum(s.qty);
        }, 0));
    }

    // «Итого ножей» — сумма всех количеств полос (Σ qty).
    function stripsTotalKnives(strips) {
        return (strips || []).reduce(function(sum, s) { return sum + stripNum(s.qty); }, 0);
    }

    function knifeWidthsForStrips(strips) {
        var out = [];
        (strips || []).forEach(function(s) {
            var width = stripNum(s.width);
            var qty = Math.max(0, Math.floor(stripNum(s.qty)));
            for (var i = 0; i < qty; i++) out.push(width);
        });
        return out;
    }

    // «Остаток, мм» — ширина джамбо минус занятая полосами ширина.
    function stripsRemainder(jumboWidth, strips) {
        return round3(stripNum(jumboWidth) - stripsUsedWidth(strips));
    }

    // #3706: статус остатка джамбо резки относительно допуска — для подсветки кнопки
    // «Полосы» в очереди (та же логика, что у бейджа «вне допуска» в панели полос).
    //   jumboWidth  — «Ширина, мм» сырья (факт. ширина джамбо);
    //   knifeWidths — факт.ширины полос резки, развёрнутые по qty (cut.knifeWidths);
    //   tolerance   — допуск остатка (мм) вида сырья.
    // → 'warn' (|остаток| > допуска), 'ok' (в допуске), 'unknown' (джамбо не задан —
    //   не сигналим ложный негатив, #3116 п.5).
    function cutRemainderStatus(jumboWidth, knifeWidths, tolerance) {
        var jumbo = stripNum(jumboWidth);
        if (!(jumbo > 0)) return 'unknown';
        var used = (knifeWidths || []).reduce(function(sum, w) {
            var n = stripNum(w);
            return sum + (n > 0 ? n : 0);
        }, 0);
        var rem = round3(jumbo - used);
        return Math.abs(rem) <= Math.abs(stripNum(tolerance)) ? 'ok' : 'warn';
    }

    // Подпись кнопки «Полосы» в строке резки: показывает количество полос резки
    // (Σ qty = knifeCount). При нуле/некорректном значении — без числа (#3147).
    function stripsButtonLabel(knifeCount) {
        var n = Number(knifeCount);
        return (isFinite(n) && n > 0) ? ('Полосы (' + n + ')') : 'Полосы';
    }

    function formatCutRuns(plannedRuns, runLength) {
        var runs = stripNum(plannedRuns);
        var text = 'Проходов: ' + (runs > 0 ? String(round3(runs)) : '—');
        var length = stripNum(runLength);
        if (length > 0) text += ' * ' + round3(length) + 'м';
        return text;
    }

    // ── #3354: компактная шапка карточки и сводка полос ──────────────────────
    // Метраж прохода для показа: фактический runLength (учёт обеспечения), а при
    // его отсутствии — сохранённый «Метраж, м» резки.
    function cutDisplayLength(cut, runLength) {
        var len = stripNum(runLength);
        if (len <= 0) len = stripNum(cut && cut.length);
        return len;
    }

    // Хвост первой строки карточки: «{длина} х {количество резок}» (#3354 п.1).
    // Разделитель — кириллическая «х», как в постановке задачи.
    function formatCutDimensions(cut, runLength) {
        var len = cutDisplayLength(cut, runLength);
        var runs = stripNum(cut && cut.plannedRuns);
        var lenText = len > 0 ? String(round3(len)) : '—';
        var runsText = runs > 0 ? String(round3(runs)) : '—';
        return lenText + ' х ' + runsText;
    }

    // Полосы резки, сгруппированные по ширине → [{ width, count }] (#3354 п.1).
    // Источник — knifeWidths (развёрнут по qty из cut_strips «Партия ГП»); count —
    // «кол-во полос» этой ширины. Сортировка по ширине убыв., как в раскладке.
    function cutStripGroups(cut) {
        var byKey = {}, order = [];
        ((cut && cut.knifeWidths) || []).forEach(function(wRaw) {
            var w = stripNum(wRaw);
            if (!(w > 0)) return;
            var key = stripWidthKey(w);
            if (!byKey[key]) { byKey[key] = { width: w, count: 0 }; order.push(key); }
            byKey[key].count += 1;
        });
        return order.map(function(k) { return byKey[k]; })
            .sort(function(a, b) { return b.width - a.width; });
    }

    // Сводная строка полосы данной ширины (#3354 п.1), формат из постановки:
    // «{сырьё} {ширина} x {длина} {намотка} — {факт.ширина}мм х {резок} x {полос} = {мотков} шт.»
    // actualWidth — фактическая ширина резки (#3372; при отсутствии правила = номинал);
    // мотков = резок × полос. Чистая (DOM не трогает) → проверяется модульно.
    function formatStripSummaryLine(cut, group, actualWidth, runLength) {
        var material = (cut && cut.materialName) || (cut && cut.materialId != null && String(cut.materialId) !== '' ? '#' + cut.materialId : '—');
        var width = stripNum(group && group.width);
        var count = Math.max(0, Math.floor(stripNum(group && group.count)));
        var len = cutDisplayLength(cut, runLength);
        var winding = normWinding(cut && cut.winding) || String((cut && cut.winding) == null ? '' : cut.winding).trim();
        var runs = stripNum(cut && cut.plannedRuns);
        var actual = stripNum(actualWidth);
        if (!(actual > 0)) actual = width;
        var rolls = round3((runs > 0 ? runs : 0) * count);
        var line = material + ' ' + round3(width) + ' x ' + (len > 0 ? round3(len) : '—');
        if (winding) line += ' ' + winding;
        // «х» между мм и резками — кириллическая; «x» между резками и полосами — латинская.
        line += ' — ' + round3(actual) + 'мм х ' + (runs > 0 ? round3(runs) : '—') +
                ' x ' + count + ' = ' + rolls + ' шт.';
        return line;
    }

    // Позиции, не имеющие ни одной записи обеспечения. supplies — [{positionId}].
    function unsuppliedPositions(positions, supplies){
        var sup = {}; (supplies || []).forEach(function(s){ if (s && s.positionId != null) sup[String(s.positionId)] = true; });
        return (positions || []).filter(function(p){ return !sup[String(p.id)]; });
    }

    function supplyCoverageKind(supply) {
        if (!supply || supply.positionId == null || String(supply.positionId) === '') return '';
        if (supply.cutId != null && String(supply.cutId) !== '') return 'cut';
        if (supply.finishedBatchId != null && String(supply.finishedBatchId) !== '') return 'finishedBatch';
        if (supply.finishedBatch && supply.finishedBatch.id != null && String(supply.finishedBatch.id) !== '') return 'finishedBatch';
        return '';
    }

    // Позиции, не обеспеченные ни резкой, ни складской партией ГП.
    function uncoveredPositions(positions, supplies){
        var covered = {};
        (supplies || []).forEach(function(s) {
            var kind = supplyCoverageKind(s);
            if (kind) covered[String(s.positionId)] = true;
        });
        return (positions || []).filter(function(p){ return !covered[String(p.id)]; });
    }

    // Выбрать станок: исключить запрещённые (стоп-лист), среди допустимых —
    // с наименьшей загрузкой (loadBySlitterId: {id→count}), тайбрейк — меньший id.
    // Возвращает String(id) или null если все запрещены.
    function pickSlitter(slitters, materialId, loadBySlitterId){
        var load = loadBySlitterId || {};
        var allowed = (slitters || []).filter(function(s){ return !isMaterialBlocked(s.stopMaterialIds, materialId); });
        if (!allowed.length) return null;
        allowed.sort(function(a, b){
            var la = Number(load[String(a.id)]) || 0, lb = Number(load[String(b.id)]) || 0;
            return la - lb || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
        });
        return String(allowed[0].id);
    }

    // FIFO-партия: среди активных партий нужного сырья с остатком > 0 выбрать с наименьшим dateKey.
    // batches — [{id, materialId, dateKey (число), remainder, active}]. null если нет подходящей.
    function pickBatchFIFO(batches, materialId){
        var mat = String(materialId == null ? '' : materialId).trim();
        var avail = (batches || []).filter(function(b){ return batchIsActive(b) && String(b.materialId) === mat && (Number(b.remainder) || 0) > 0; });
        if (!avail.length) return null;
        avail.sort(function(a, b){ return (Number(a.dateKey) || 0) - (Number(b.dateKey) || 0) || (String(a.id) < String(b.id) ? -1 : 1); });
        return String(avail[0].id);
    }

    function pickBatchFIFOForRun(batches, materialId, requiredLinearM, remainingByBatch) {
        var mat = String(materialId == null ? '' : materialId).trim();
        var avail = (batches || []).filter(function(b) {
            if (!batchIsActive(b) || String(b.materialId) !== mat || (Number(b.remainder) || 0) <= 0) return false;
            var id = String(b.id);
            if (remainingByBatch && remainingByBatch.hasOwnProperty(id)) {
                return (Number(remainingByBatch[id]) || 0) > 0;
            }
            return true;
        });
        if (!avail.length) return null;
        avail.sort(function(a, b){ return (Number(a.dateKey) || 0) - (Number(b.dateKey) || 0) || (String(a.id) < String(b.id) ? -1 : 1); });
        var picked = avail[0];
        var pickedId = String(picked.id);
        if (remainingByBatch && remainingByBatch.hasOwnProperty(pickedId)) {
            var free = Number(remainingByBatch[pickedId]) || 0;
            var need = Number(requiredLinearM) || 0;
            if (need > 0) remainingByBatch[pickedId] = Math.max(0, free - need);
        }
        return pickedId;
    }

    function slitterAffinityKey(materialId, windDir, windLength, batchId) {
        return String(materialId == null ? '' : materialId).trim() + '|' +
            normWinding(windDir) + '|' + windLengthKey(windLength) + '|' +
            String(batchId == null ? '' : batchId);
    }

    // #3120 группа C (Фаза 1a, п.4): у резки задан материал, но нет ни одной подходящей
    // партии сырья с остатком (pickBatchFIFO === null) → резку нельзя обеспечить сырьём.
    // Резки без материала (materialId пуст) не помечаем. genBatches — [{id,materialId,...,remainder}].
    function cutMissingBatch(cut, genBatches){
        var mat = cut && cut.materialId != null ? String(cut.materialId) : '';
        if (mat === '') return false;
        return pickBatchFIFO(genBatches || [], mat) === null;
    }

    // Потребность резки в погонных метрах (#3120 группа C): длина прогона джамбо =
    // самая длинная обеспечиваемая позиция (параллельный слиттинг — все полосы режутся
    // за один прогон). supplyFootages — массив «Метраж, м» обеспечений резки.
    function requiredRunLengthM(supplyFootages){
        return (supplyFootages || []).reduce(function(m, f){ var n = stripNum(f); return n > m ? n : m; }, 0);
    }

    function supplyFootage(supply, footageBySupply){
        var direct = stripNum(supply && supply.footage);
        if (direct > 0) return direct;
        return stripNum(footageBySupply && supply && footageBySupply[String(supply.id)]);
    }

    function cutRunLength(cut, supplies, footageBySupply){
        var maxF = stripNum(cut && cut.length);
        (supplies || []).forEach(function(s) {
            if (String(s.cutId) !== String(cut && cut.id)) return;
            var f = supplyFootage(s, footageBySupply);
            if (f > maxF) maxF = f;
        });
        return maxF;
    }

    // FIFO-резерв сырья из партий (#3120 группа C). batches — [{id, label, arrivalKey, freeLinearM}]
    // (freeLinearM — СВОБОДНЫЙ погонный остаток партии: Остаток,м − Σ чужих резервов); сортируются
    // внутри по приходу (arrivalKey ↑, тай-брейк меньший id). requiredLinearM — потребность, пог.м;
    // widthM — ширина джамбо, м (для справочного м²). Вход не мутируется.
    // → { allocations:[{batchId,label,linearM,m2}], reservedLinearM, shortfallLinearM, fullyReserved }.
    function reserveFifo(batches, requiredLinearM, widthM){
        var need = Math.max(0, Number(requiredLinearM) || 0);
        var w = Number(widthM) || 0;
        var sorted = (batches || []).slice().sort(function(a, b){
            return (Number(a.arrivalKey) || 0) - (Number(b.arrivalKey) || 0) ||
                   (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
        });
        var allocs = [], reserved = 0;
        for (var i = 0; i < sorted.length && need > 1e-9; i++){
            var free = Math.max(0, Number(sorted[i].freeLinearM) || 0);
            if (free <= 0) continue;
            var take = Math.min(free, need);
            allocs.push({ batchId: String(sorted[i].id), label: sorted[i].label || '', linearM: round3(take), m2: round3(take * w) });
            reserved += take; need -= take;
        }
        return {
            allocations: allocs,
            reservedLinearM: round3(reserved),
            shortfallLinearM: round3(Math.max(0, need)),
            fullyReserved: need <= 1e-9
        };
    }

    // Кандидаты-партии для FIFO-резерва вида сырья (Фаза 1b): из genBatches берём партии
    // нужного материала со СВОБОДНЫМ погонным остатком = Остаток,м − (зарезервировано м² по
    // партии / ширина джамбо в м). reservedM2ByBatch — карта чужих резервов «Расход сырья».
    // → [{id,label,arrivalKey,freeLinearM}] для reserveFifo. Вход не мутирует.
    function fifoBatchesForMaterial(genBatches, reservedM2ByBatch, materialId, widthM){
        var mat = String(materialId == null ? '' : materialId);
        var w = Number(widthM) || 0;
        var res = reservedM2ByBatch || {};
        return (genBatches || []).filter(function(b){ return batchIsActive(b) && String(b.materialId) === mat; }).map(function(b){
            var reservedLin = w > 0 ? ((Number(res[String(b.id)]) || 0) / w) : 0;
            var free = (Number(b.remainderLinear) || 0) - reservedLin;
            return { id: String(b.id), label: b.label || '', arrivalKey: Number(b.dateKey) || 0, freeLinearM: free > 0 ? round3(free) : 0 };
        });
    }

    // Материал резки из обеспечиваемых позиций (#3120 Фаза 2): cutId → вид сырья (id) её
    // позиций (все позиции резки — один вид сырья; берём первый непустой). Демэнд-источник
    // материала вместо ссылки «Партия сырья» (1159). genPositions — [{id, materialId}];
    // supplies — [{cutId, positionId}]. → { cutId: materialId }.
    function materialByCut(cuts, supplies, genPositions){
        var posMat = {};
        (genPositions || []).forEach(function(p){ posMat[String(p.id)] = String(p.materialId == null ? '' : p.materialId); });
        var out = {};
        (supplies || []).forEach(function(s){
            if (s == null || s.positionId == null) return;
            var cutId = String(s.cutId), m = posMat[String(s.positionId)] || '';
            if (m && !out[cutId]) out[cutId] = m;
        });
        return out;
    }

    // #3808: восстановить «Вид сырья» переходящих сегментов с ПУСТЫМ материалом. Сегмент-
    // продолжение дробления по дням физически тот же, что и голова цепочки (станок|намотка|
    // набор ножей) — отличается только днём. `continuationSignature` ВКЛЮЧАЕТ materialId,
    // поэтому пустой материал продолжения не давал ему слиться с головой в
    // `mergeContinuationChains` → `materialForCutId` (#3795) не находил голову и не лечил его:
    // переходящее задание оставалось без сырья («—»). Группируем материал-АГНОСТИЧНО
    // (станок|намотка|набор ножей — это `continuationSignature` без materialId) и, если в
    // группе ровно одно непустое сырьё, проставляем его сегментам с пустым. Неоднозначные
    // группы (несколько разных сырьёв) не трогаем — лечим только безопасные случаи. Мутирует
    // `c.materialId`; → массив id вылеченных резок. Чистая (тест).
    function healContinuationMaterials(cuts){
        var groups = {};
        (cuts || []).forEach(function(c){
            var ks = ((c && c.knifeWidths) || []).slice().map(Number).sort(function(a, b){ return a - b; }).join(',');
            var key = [
                (c && c.slitter && c.slitter.id) == null ? '' : String(c.slitter.id),
                normWinding(c && c.winding),
                ks
            ].join('|');
            (groups[key] = groups[key] || []).push(c);
        });
        var healed = [];
        Object.keys(groups).forEach(function(key){
            var arr = groups[key];
            var mats = {};
            arr.forEach(function(c){
                var m = c && c.materialId != null ? String(c.materialId).trim() : '';
                if (m) mats[m] = true;
            });
            var distinct = Object.keys(mats);
            if (distinct.length !== 1) return;   // нет источника / неоднозначно — не трогаем
            var mat = distinct[0];
            arr.forEach(function(c){
                var m = c && c.materialId != null ? String(c.materialId).trim() : '';
                if (m === '') { c.materialId = mat; healed.push(String(c.id)); }
            });
        });
        return healed;
    }

    // #3785: при равной стоимости перехода тай-брейк — число полос (ножей) ПО УБЫВАНИЮ
    // («при прочих равных» больше полос — раньше), затем уже ширина ролика и id.
    function startKey(c){ return [-(Number(c.knifeCount) || 0), Number(c.rollerWidth) || 0, String(c.id)]; }
    function cmpKey(a, b){ for (var i = 0; i < a.length; i++){ if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; }

    function fatigueComplexityKey(c, machineWidth){
        var width = fatigueJobWidth(c);
        return [
            -estimatedKnifeCount(c, machineWidth),
            width > 0 ? width : Number.MAX_VALUE
        ];
    }

    // Жадная цепочка от заданного старта: далее argmin changeoverCost, tie-break startKey.
    function greedyFromStart(start, rest, weights){
        var pool = (rest || []).slice();
        var result = [start];
        while (pool.length){
            var cur = result[result.length - 1], bestI = 0, bestCost = Infinity, bestKey = null;
            for (var i = 0; i < pool.length; i++){
                var c = changeoverCost(cur, pool[i], weights), k = startKey(pool[i]);
                if (c < bestCost || (c === bestCost && cmpKey(k, bestKey) < 0)){ bestCost = c; bestI = i; bestKey = k; }
            }
            result.push(pool.splice(bestI, 1)[0]);
        }
        return result;
    }
    // Суммарная переналадка цепочки (Σ changeoverCost соседей).
    function chainChangeoverCost(seq, weights){
        var total = 0;
        for (var i = 1; i < (seq || []).length; i++) total += changeoverCost(seq[i - 1], seq[i], weights);
        return round3(total);
    }
    // Ряд числа ножей по порядку — критерий «ножи по убыванию» (#3130). Среди равных по
    // стоимости цепочек предпочитаем ту, чей ряд knifeCount лексикографически больше
    // (много ножей раньше). Возвращает <0, если ряд a предпочтительнее ряда b.
    function knifeDescSeq(seq){ return (seq || []).map(function(c){ return Number(c && c.knifeCount) || 0; }); }
    function cmpKnifeDescSeq(a, b){
        var n = Math.max(a.length, b.length);
        for (var i = 0; i < n; i++){ var av = a[i] || 0, bv = b[i] || 0; if (av !== bv) return bv - av; }
        return 0;
    }
    // Лимит полного перебора стартов: при больших очередях остаёмся на одиночном старте
    // (argmin startKey), чтобы не уходить в O(n³). На станко-день очередь маленькая.
    var GREEDY_MULTISTART_LIMIT = 60;
    // Жадная последовательность. Раньше старт жёстко брался argmin startKey (узкий
    // ролик), из-за чего setup-оптимальная цепочка могла идти по ВОЗРАСТАНИЮ ножей
    // (6,16,16) вопреки правилу #3130 «много ножей в начале смены» (ideav/crm#3412).
    // Теперь перебираем все старты, берём минимум суммарной переналадки (#3268), а
    // среди равных по стоимости — цепочку с ножами по убыванию.
    function greedySequence(cuts, weights){
        var pool = (cuts || []).slice();
        if (pool.length <= 1) return pool;
        pool.sort(function(a, b){ return cmpKey(startKey(a), startKey(b)); });
        // #3871: при выравнивании загрузки — цепочка от одного старта (перебор стартов даёт
        // O(n³) и делал «Создать» очень медленным); как и при больших очередях (>limit).
        if (pool.length > GREEDY_MULTISTART_LIMIT || balanceFastChangeover) return greedyFromStart(pool[0], pool.slice(1), weights);
        var best = null, bestCost = Infinity, bestKnife = null;
        for (var s = 0; s < pool.length; s++){
            var seq = greedyFromStart(pool[s], pool.slice(0, s).concat(pool.slice(s + 1)), weights);
            var cost = chainChangeoverCost(seq, weights), knife = knifeDescSeq(seq);
            if (best === null || cost < bestCost || (cost === bestCost && cmpKnifeDescSeq(knife, bestKnife) < 0)){
                best = seq; bestCost = cost; bestKnife = knife;
            }
        }
        return best;
    }
    // Внутри последовательности станка число ножей должно убывать к концу дня
    // (ideav/crm#3130): в начале смены ножей много, к вечеру меньше — переналаживать
    // тяжелее. Стабильная сортировка по knifeCount ↓; равные — в порядке жадной
    // последовательности (минимизация переналадок остаётся вторичным критерием).
    function byKnifeCountDesc(seq){
        return (seq || []).map(function(c, i){ return { c: c, i: i }; })
            .sort(function(a, b){ return ((Number(b.c.knifeCount) || 0) - (Number(a.c.knifeCount) || 0)) || (a.i - b.i); })
            .map(function(x){ return x.c; });
    }

    // #3272: второй вариант очереди учитывает усталость к концу дня. Жадная цепочка
    // по переналадкам остаётся стабильной базой, но внутри неё более сложные резки
    // (много ножей / узкая ширина) ставятся раньше, если weighted score не хуже.
    function fatigueAwareSequence(cuts, options){
        var input = (cuts || []).slice();
        if (input.length <= 1) return input;
        var opts = options || {};
        var times = planningChangeTimes(opts);
        var machineWidth = fatigueOptionNumber(opts, ['machineWidth', 'machineWidthMm', 'Wmax'], FATIGUE_MACHINE_WIDTH_MM);
        var base = greedySequence(input, times);
        var complexFirst = base.map(function(c, i){ return { c: c, i: i, key: fatigueComplexityKey(c, machineWidth) }; })
            .sort(function(a, b){ return cmpKey(a.key, b.key) || (a.i - b.i); })
            .map(function(x){ return x.c; });
        var simpleFirst = complexFirst.slice().reverse();
        return fatigueRouteScore(complexFirst, opts) <= fatigueRouteScore(simpleFirst, opts)
            ? complexFirst : simpleFirst;
    }

    function sequenceForStrategy(cuts, options){
        var opts = options || {};
        if (planningStrategy(opts) === PLANNING_STRATEGY_FATIGUE) return fatigueAwareSequence(cuts, opts);
        // SETUP (#3783/#3785): ПЕРВИЧНО — минимум суммарной переналадки (greedySequence
        // группирует одно сырьё/набор ножей, переход внутри группы дешевле), поэтому сырьё
        // не идёт вперемешку (#3783). ТАЙ-БРЕЙК «при прочих равных» — число полос по убыванию
        // (#3785) — заложен в startKey жадной цепочки. Прежний враппер byKnifeCountDesc
        // (#3568) пересортировывал всю цепочку по knifeCount↓ ГЛОБАЛЬНО, разбивая группы
        // сырья и увеличивая переналадку — убран; «много ножей раньше» остаётся стратегией
        // FATIGUE (сложные раньше) для тех, кому важна усталость, а не минимум переналадок.
        return greedySequence(cuts, planningChangeTimes(opts));
    }

    // Упорядочить резки станка: не-Фольга, затем Фольга; внутри каждой группы —
    // выбранный оператором вариант (#3272). По умолчанию — реальные минуты
    // переналадки (#3268); fatigue-вариант ставит сложные резки раньше.
    // Проставить sequence; вход не мутировать.
    // #3815: EDD — задания с более ранним «Сроком изготовления» (c.dueKey, YYYYMMDD) идут
    // раньше, чтобы по-дневная раскладка ставила их на более ранние дни. Резки группируются по
    // сроку (по возрастанию), ВНУТРИ каждого срока — выбранная стратегия (минимум переналадок,
    // #3783). Резки без срока (dueKey не число → Infinity) собираются в последнюю группу. Если
    // ни у одной резки срока нет — одна группа = прежнее поведение (полная обратная совместимость).
    function sequenceByDue(list, opts){
        var byDue = {}, order = [];
        (list || []).forEach(function(c){
            var k = (c && isFinite(c.dueKey)) ? Number(c.dueKey) : Infinity;
            var sk = String(k);
            if (!byDue[sk]) { byDue[sk] = { key: k, items: [] }; order.push(sk); }
            byDue[sk].items.push(c);
        });
        order.sort(function(a, b){ return byDue[a].key - byDue[b].key; });
        var out = [];
        order.forEach(function(sk){ out = out.concat(sequenceForStrategy(byDue[sk].items, opts)); });
        return out;
    }

    function orderCuts(cuts, weights){
        var rest = [], foil = [];
        (cuts || []).forEach(function(c){ (c && c.isFoil ? foil : rest).push(c); });
        var opts = makePlanningOptions(weights);
        // #3717: фольга — отдельной группой в конец. #3815: внутри rest и foil — по сроку (EDD).
        var seq = sequenceByDue(rest, opts).concat(sequenceByDue(foil, opts));
        return seq.map(function(c, i){
            var copy = {}; for (var k in c){ if (Object.prototype.hasOwnProperty.call(c, k)) copy[k] = c[k]; }
            copy.sequence = i + 1;
            return copy;
        });
    }

    function orderedChangeoverCost(cuts, weights) {
        var seq = orderCuts(cuts || [], weights);
        var times = planningChangeTimes(weights);
        var total = 0;
        for (var i = 1; i < seq.length; i++) total += changeoverCost(seq[i - 1], seq[i], times);
        return round3(total);
    }

    function bestExistingTransitionCost(group, cut, weights) {
        if (!group || !group.length || !cut) return Infinity;
        var times = planningChangeTimes(weights);
        var best = Infinity;
        group.forEach(function(prev) {
            best = Math.min(best, changeoverCost(prev, cut, times), changeoverCost(cut, prev, times));
        });
        return best === Infinity ? Infinity : round3(best);
    }

    // Выбрать станок для новой резки по приросту минут переналадки (#3268).
    // #3666: ГЛАВНЫЙ критерий — станок, который уже режет ТОТ ЖЕ набор ширин ножей
    // (knifeWidthSig). Одинаковую конфигурацию ножей не разносим по разным станкам: на
    // пустом станке прирост переналадки = 0 (у одиночной резки нет переходов), и прежде он
    // обыгрывал занятый совместимый (delta которого = переналадка), хотя физически пустой
    // станок тоже требует настройки ножей с нуля.
    //
    // #3801: «прицепиться» к станку можно по ножам (тот же набор ширин) ИЛИ по сырью (то же
    // сырьё + намотка — резка идёт без смены сырья). Логика выбора:
    //   • есть куда прицепиться → держим группировку: тот же набор ножей → то же сырьё →
    //     минимум прироста переналадки (delta ↑) → аффинность ↑ → НАИМЕНЕЕ загруженный
    //     совместимый станок (не сваливаем всё на один из нескольких совместимых) → id;
    //   • прицепиться негде (ни по ножам, ни по сырью — везде холодная настройка) → выбираем
    //     НАИМЕНЕЕ ЗАГРУЖЕННЫЙ станок (балансировка), затем delta ↑, аффинность ↑, id.
    // Так одинаковое сырьё/ножи объединяются на одном станке, а несовместимые задания
    // распределяются ровно, а не копятся на одном (неравномерная загрузка станков).
    //
    // #3830: НЕ сваливать резку на станок, чей рабочий день уже ПЕРЕПОЛНЕН, когда есть другой
    // допустимый станок со свободным местом. Раньше группировка по сырью (attach) была выше
    // загрузки → вся фольга (общее сырьё «Фольга …») копилась на одном станке и вылетала за
    // ёмкость дня (≈514 мин при 450), хотя у соседнего станка день был пуст. Признак overflow
    // (рабочие минуты дня станка с этой резкой > ёмкости) стал ПЕРВЫМ критерием: при равных
    // overflow держим прежнюю группировку/балансировку. Активно только когда задана ёмкость
    // (dayCapacityMin, генерация); без неё (тесты/обратная совместимость) overflow всегда 0.
    //   dayCapacityMin — рабочая ёмкость дня станка (мин); опционально.
    // #3876: unavailableSlitterIds (опц.) — { slitterId: true } станков, у которых в день этой
    // резки отпуск; их не выбираем (станок без сырья и ножей). Если после исключения не остаётся
    // ни одного станка (все в отпуске) — откатываемся к полному списку, чтобы не «потерять» резку.
    function chooseSlitterBySetup(cut, slitters, groupsBySlitterId, loadBySlitterId, weights, dayCapacityMin, unavailableSlitterIds) {
        var groups = groupsBySlitterId || {};
        var load = loadBySlitterId || {};
        var cap = Number(dayCapacityMin);
        var capActive = isFinite(cap) && cap > 0;   // #3830: учитывать ёмкость только если задана
        var unavail = unavailableSlitterIds || {};
        var allowed = (slitters || []).filter(function(s){ return !isMaterialBlocked(s.stopMaterialIds, cut && cut.materialId); });
        if (!allowed.length) return null;
        var available = allowed.filter(function(s){ return !unavail[String(s.id)]; });   // #3876: не в отпуске в этот день
        if (available.length) allowed = available;   // все в отпуске → оставляем как было (резку не теряем)
        function cmpNumber(a, b) {
            if (a === b) return 0;
            if (a === Infinity) return 1;
            if (b === Infinity) return -1;
            return a - b;
        }
        function cmpId(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
        // #3830: рабочие минуты резки за день — намотка (+ лидер, если хранится). Переналадка
        // считается отдельно (через прирост orderedChangeoverCost). Нет данных → 0.
        function cutWorkMinutes(c) {
            var cl = Number(c && c.storedCutAndLeaderMin);
            if (isFinite(cl) && cl > 0) return cl;   // #3700: «Резка и Лидер» (намотка + лидер)
            return Number(c && c.duration) || 0;     // намотка («Длительность, минут»)
        }
        var cutSig = knifeWidthSig(cut);
        var cutMat = String(cut && cut.materialId == null ? '' : cut.materialId).trim();
        var cutWind = normWinding(cut && cut.winding);
        var cutWork = cutWorkMinutes(cut);
        var candidates = allowed.map(function(s) {
            var id = String(s.id);
            var group = groups[id] || [];
            var before = orderedChangeoverCost(group, weights);
            var after = orderedChangeoverCost(group.concat([cut]), weights);
            // #3666: 0 — станок уже режет тот же набор ширин ножей (приоритет), иначе 1.
            var sameKnives = (cutSig !== '' && group.some(function(g){ return knifeWidthSig(g) === cutSig; })) ? 0 : 1;
            // #3801: 0 — станок уже режет то же сырьё + намотку (можно прицепиться по сырью), иначе 1.
            var sameMaterial = (cutMat !== '' && group.some(function(g){
                return String(g.materialId == null ? '' : g.materialId).trim() === cutMat && normWinding(g.winding) === cutWind;
            })) ? 0 : 1;
            // #3830: рабочие минуты дня станка с этой резкой = переналадки (after) + намотки всех.
            var dayWork = round3(after + group.reduce(function(s2, g){ return s2 + cutWorkMinutes(g); }, 0) + cutWork);
            return {
                id: id,
                // #3830: 1 — день станка с этой резкой ВЫЛЕЗАЕТ за ёмкость (переполнен), иначе 0.
                overflow: (capActive && dayWork > cap) ? 1 : 0,
                // #3801: 0 — есть к чему прицепиться (ножи ИЛИ сырьё), иначе 1 (холодная настройка).
                attach: (sameKnives === 0 || sameMaterial === 0) ? 0 : 1,
                sameKnives: sameKnives,
                sameMaterial: sameMaterial,
                delta: round3(after - before),
                affinity: bestExistingTransitionCost(group, cut, weights),
                load: Number(load[id]) || 0
            };
        });
        // #3801: есть ли хоть один станок, к которому новая резка цепляется по ножам/сырью.
        var anyAttach = candidates.some(function(c){ return c.attach === 0; });
        candidates.sort(function(a, b) {
            // #3830: станок, где резка ВЛЕЗАЕТ в день, — всегда первым (не переполняем станок,
            // если есть свободный). При равных overflow — прежняя логика группировки/балансировки.
            var byOverflow = cmpNumber(a.overflow, b.overflow);
            if (byOverflow) return byOverflow;
            if (anyAttach) {
                return cmpNumber(a.attach, b.attach)            // #3801: совместимые станки — первыми
                    || cmpNumber(a.sameKnives, b.sameKnives)    // #3666: тот же набор ножей — на тот же станок
                    || cmpNumber(a.sameMaterial, b.sameMaterial)// #3801: то же сырьё — на тот же станок
                    || cmpNumber(a.delta, b.delta)              // #3268: минимум прироста переналадки
                    || cmpNumber(a.affinity, b.affinity)
                    || cmpNumber(a.load, b.load)                // #3801: при равенстве — наименее загруженный
                    || cmpId(a.id, b.id);
            }
            // #3801: прицепиться негде — выбираем наименее загруженный станок (балансировка).
            return cmpNumber(a.load, b.load)
                || cmpNumber(a.delta, b.delta)
                || cmpNumber(a.affinity, b.affinity)
                || cmpId(a.id, b.id);
        });
        return candidates[0].id;
    }

    // #3848: выравнивание загрузки станков ПОСЛЕ жадного назначения (chooseSlitterBySetup) и
    // распределения по срокам. Жадность группирует одно сырьё/набор ножей на ОДИН станок —
    // он может скопить работу на 5 дней, пока соседний простаивает. Здесь итеративно переносим
    // ПОДВИЖНЫЕ задания (новые, plans) с ПЕРЕГРУЖЕННОГО (день ≥2) станка на менее загруженный,
    // минимизируя ЛЕКСИКОГРАФИЧЕСКИ [макс. число дней, пик минут станка, сумма квадратов минут].
    // Существующие резки (opts.fixedByMachine) держат базовую загрузку своих станков, но НЕ двигаются.
    //
    // Свойства, требуемые #3848:
    //  • итерационный — по одному переносу за шаг, лучший улучшающий ход;
    //  • журнал (opts.log) — старт / каждый перенос / стоп с причиной (в консоль — «панель отладки»);
    //  • стоп при ОТСУТСТВИИ ПРОГРЕССА — нет хода, строго улучшающего счёт;
    //  • без цикличных перестановок — Set посещённых КОМБИНАЦИЙ (stateHash): идентичное назначение
    //    не повторяем. Плюс ходы только СТРОГО улучшающие счёт ⇒ счёт монотонно падает (циклы
    //    «переставили-вернули» невозможны и без Set, но Set — явная страховка по требованию #3848).
    //
    // Мутирует plan.slitterId у перенесённых. Чистая (детерминированная) — тест.
    // opts: { weights, dayCapacityMin, fixedByMachine:{slitterId:[cut…]}, log:fn(ev), maxIters }.
    // → { moves:[{cutId,from,to}], iterations, stopReason, loadBefore, loadAfter }.
    function rebalanceSlitterLoad(plans, slitters, opts) {
        opts = opts || {};
        var weights = opts.weights;
        var times = planningChangeTimes(weights);
        var cap = Number(opts.dayCapacityMin);
        var hasCap = isFinite(cap) && cap > 0;
        var log = typeof opts.log === 'function' ? opts.log : function(){};
        var maxIters = isFinite(Number(opts.maxIters)) ? Number(opts.maxIters) : 1000;
        var movablePlans = (plans || []).filter(function(p){ return p && p.slitterId != null && String(p.slitterId) !== ''; });
        var machineList = (slitters || []).map(function(s){ return String(s.id); });
        var fixedBy = opts.fixedByMachine || {};
        if (machineList.length < 2 || !movablePlans.length) {
            return { moves: [], iterations: 0, stopReason: 'nothing-to-balance', loadBefore: {}, loadAfter: {} };
        }
        var stopBlock = {};   // slitterId → stopMaterialIds (станок не варит это сырьё — туда не переносим)
        (slitters || []).forEach(function(s){ stopBlock[String(s.id)] = s.stopMaterialIds; });
        // #3876: не переносить задание на станок, у которого в день этого задания отпуск.
        // opts.slitterDayBlocked(slitterId, plan) → bool (контроллер даёт по downtimesBySlitter +
        // plan.planDate). Не задан → null (поведение прежнее; тесты/обратная совместимость).
        var slitterDayBlocked = typeof opts.slitterDayBlocked === 'function' ? opts.slitterDayBlocked : null;

        // Рабочие минуты задания (намотка + лидер, если хранится; иначе «Длительность»).
        function workMin(m){
            var cl = Number(m && m.storedCutAndLeaderMin);
            if (isFinite(cl) && cl > 0) return cl;
            return Number(m && m.duration) || 0;
        }
        // Минуты станка по его участникам (постоянные + подвижные) = намотка всех +
        // переналадки очереди (orderedChangeoverCost учитывает порядок/фольгу/EDD) + настройка
        // первой резки с нуля. Мемоизация по сигнатуре набора — orderCuts/переналадка дороги́е.
        var minutesMemo = {};
        function poolMinutes(members){
            if (!members.length) return 0;
            var ids = members.map(function(m){ return String(m.id); }); ids.sort();
            var sig = ids.join(',');
            if (minutesMemo[sig] != null) return minutesMemo[sig];
            var work = 0; members.forEach(function(m){ work += workMin(m); });
            var v = round3(work + orderedChangeoverCost(members, weights) + firstSetupCost(members[0], times));
            minutesMemo[sig] = v;
            return v;
        }
        function daysOf(min){ return (min > 0) ? (hasCap ? Math.ceil(min / cap) : 1) : 0; }   // содержимое в рабочих днях
        // #3881: «загруженность» станка = ДАТА ОКОНЧАНИЯ последней задачи (у кого позже — тот
        // загружен сильнее). Содержимое (daysOf рабочих дней) кладём по дням от базы, ПРОПУСКАЯ
        // дни отпуска станка → станок с отпуском заканчивает ПОЗЖЕ при тех же минутах (его не
        // грузят на послеотпускное время, пока другие простаивают). Дни отпуска тоже считаются
        // ЗАНЯТЫМИ: станок в отпуске без задач после него «занят» до конца отпуска (уточнение
        // заказчика — «дату окончания отпуска считать последней датой задач, если после него
        // задач нет»). span = число календарных дней от дня 0 до последнего занятого включительно.
        // opts.machineDayOff(id, dayOffset)→bool — день-смещение от базы у станка нерабочий (отпуск);
        // не задан → span == daysOf (нет инфо об отпусках; тесты/обратная совместимость).
        var machineDayOff = typeof opts.machineDayOff === 'function' ? opts.machineDayOff : null;
        var spanMemo = {};
        function spanDays(machineId, min){
            var content = daysOf(min);
            if (!machineDayOff) return content;   // нет отпусков-инфо — прежнее поведение
            var memoKey = machineId + ':' + content;
            if (memoKey in spanMemo) return spanMemo[memoKey];
            var remaining = content, lastBusy = -1, guard = content + 731;   // защита от зацикливания
            for (var d = 0; d <= guard; d++){
                if (machineDayOff(machineId, d)) { lastBusy = d; continue; }   // день отпуска — занят
                if (remaining > 0) { remaining--; lastBusy = d; continue; }    // рабочий день — кладём содержимое
                break;   // свободный день, содержимого больше нет → станок свободен
            }
            var span = lastBusy + 1;
            spanMemo[memoKey] = span;
            return span;
        }

        // Назначение подвижных: slitterId → [plan]. Полный набор станка = fixed + movable.
        var byMachine = {};
        machineList.forEach(function(id){ byMachine[id] = []; });
        movablePlans.forEach(function(p){ (byMachine[String(p.slitterId)] = byMachine[String(p.slitterId)] || []).push(p); });
        function membersOf(id){ return (fixedBy[id] || []).concat(byMachine[id] || []); }
        function curMinutes(){ var o = {}; Object.keys(byMachine).forEach(function(id){ o[id] = poolMinutes(membersOf(id)); }); return o; }
        function snapshot(){
            var snap = {};
            Object.keys(byMachine).forEach(function(id){
                var m = poolMinutes(membersOf(id));
                snap[id] = { minutes: m, days: spanDays(id, m), cuts: (byMachine[id] || []).length };   // #3881: span с учётом отпуска
            });
            return snap;
        }
        // Счёт состояния = [макс. дней, пик минут станка, сумма квадратов минут]; меньше — лучше
        // (лексикографически). Сумма КВАДРАТОВ (а не просто сумма) штрафует перекос: при равном
        // пике она ниже у РОВНОГО распределения — это и выталкивает работу на простаивающий
        // станок. Простая сумма минут, наоборот, росла бы от лишних настроек и склеивала всё на
        // меньшем числе станков (застревание в духе 4/4/0/0) — поэтому не она.
        function scoreFrom(minById){
            var maxDays = 0, peak = 0, sumSq = 0;
            Object.keys(minById).forEach(function(id){
                var m = minById[id];
                sumSq = round3(sumSq + m * m);
                if (m > peak) peak = m;
                var d = spanDays(id, m); if (d > maxDays) maxDays = d;   // #3881: дата окончания (span с учётом отпуска)
            });
            return [maxDays, round3(peak), sumSq];
        }
        function lexLess(a, b){
            for (var i = 0; i < a.length; i++){ if (a[i] < b[i]) return true; if (a[i] > b[i]) return false; }
            return false;
        }
        // Хэш комбинации — по ТЕКУЩЕМУ plan.slitterId каждого подвижного задания (а не по
        // byMachine): пробный перенос временно ставит plan.slitterId = to, и хэш обязан это
        // отражать, иначе все кандидаты выглядят «уже посещёнными» (был баг 0 переносов).
        function stateHash(){
            var byId = {};
            machineList.forEach(function(id){ byId[id] = []; });
            movablePlans.forEach(function(p){ (byId[String(p.slitterId)] = byId[String(p.slitterId)] || []).push(String(p.id)); });
            return machineList.map(function(id){
                return id + ':' + (byId[id] || []).slice().sort().join('+');
            }).join('|');
        }

        // #3871: на время прохода считаем переналадку быстро (кэш по паре id + одностартовая
        // цепочка). Сбрасываем флаги в finally, чтобы планировщик дальше считал как обычно.
        var prevFast = balanceFastChangeover, prevMemo = balancePairCostMemo;
        balanceFastChangeover = true; balancePairCostMemo = {};
        try {
        var loadBefore = snapshot();
        var visited = {}; visited[stateHash()] = true;
        var moves = [], iter = 0, stopReason = 'no-progress';
        log({ event: 'start', load: loadBefore, score: scoreFrom(curMinutes()) });

        while (iter < maxIters){
            var baseMin = curMinutes();
            var baseScore = scoreFrom(baseMin);
            var best = null;   // { plan, from, to, score, hash }
            Object.keys(byMachine).forEach(function(from){
                // Переносим ТОЛЬКО со станка, заканчивающего на 2-й день и позже (#3881:
                // дата окончания с учётом отпуска — станок с отпуском кончает позже и потому
                // донор, его задания уезжают на простаивающие станки). Вся работа влезает в один
                // день (и без отпуска) — дробить незачем (лишние настройки). Без заданной ёмкости
                // (тесты/обратная совместимость) день всегда «1» ⇒ переносов нет, поведение прежнее.
                if (spanDays(from, baseMin[from]) < 2) return;
                (byMachine[from] || []).forEach(function(plan){
                    machineList.forEach(function(to){
                        if (to === from) return;
                        if (isMaterialBlocked(stopBlock[to], plan.materialId)) return;   // станок не варит это сырьё
                        if (slitterDayBlocked && slitterDayBlocked(to, plan)) return;     // #3876: станок в отпуске в день задания
                        // пробный перенос: меняются минуты только from и to.
                        var fromMembers = (fixedBy[from] || []).concat((byMachine[from] || []).filter(function(x){ return x !== plan; }));
                        var trial = {}; Object.keys(baseMin).forEach(function(id){ trial[id] = baseMin[id]; });
                        trial[from] = poolMinutes(fromMembers);
                        trial[to] = poolMinutes(membersOf(to).concat([plan]));
                        var sc = scoreFrom(trial);
                        if (!lexLess(sc, best ? best.score : baseScore)) return;   // не лучше базы/текущего лучшего
                        // не повторяем ранее посещённую комбинацию (страховка от циклов).
                        var keep = plan.slitterId; plan.slitterId = to; var h = stateHash(); plan.slitterId = keep;
                        if (visited[h]) return;
                        best = { plan: plan, from: from, to: to, score: sc, hash: h };
                    });
                });
            });
            if (!best){ stopReason = 'no-progress'; break; }
            byMachine[best.from] = (byMachine[best.from] || []).filter(function(x){ return x !== best.plan; });
            best.plan.slitterId = best.to;
            (byMachine[best.to] = byMachine[best.to] || []).push(best.plan);
            visited[best.hash] = true;
            iter++;
            moves.push({ cutId: best.plan.id, from: best.from, to: best.to });
            log({ event: 'move', step: iter, cutId: best.plan.id, from: best.from, to: best.to, score: best.score, load: snapshot() });
        }
        if (iter >= maxIters) stopReason = 'max-iters';
        var loadAfter = snapshot();
        log({ event: 'stop', reason: stopReason, iterations: iter, load: loadAfter });
        return { moves: moves, iterations: iter, stopReason: stopReason, loadBefore: loadBefore, loadAfter: loadAfter };
        } finally {
            balanceFastChangeover = prevFast; balancePairCostMemo = prevMemo;
        }
    }

    // Переставить резку в очереди станка: swap с соседом (dir -1 вверх / +1 вниз) +
    // нормализация «Очередности» 1..N по новому порядку. → изменённые [{cutId, sequence}].
    // На границе → []. Вход не мутирует.
    function moveInQueue(orderedCuts, index, dir){
        var arr = (orderedCuts || []).slice();
        var target = index + dir;
        if (index < 0 || index >= arr.length || target < 0 || target >= arr.length) return [];
        // #3508 п.3: зафиксированные задания — «стены». Нельзя двигать сам зафиксированный
        // и нельзя перепрыгивать через зафиксированного соседа: их относительный порядок и
        // «Очередность» неизменны, нумерация остальных 1..N остаётся сплошной (без дублей).
        if ((arr[index] && arr[index].fixed) || (arr[target] && arr[target].fixed)) return [];
        var tmp = arr[index]; arr[index] = arr[target]; arr[target] = tmp;
        var changed = [];
        arr.forEach(function(c, i){ var seq = i + 1; if (Number(c.sequence) !== seq) changed.push({ cutId: c.id, sequence: seq }); });
        return changed;
    }

    // #3602: перенос задания на другой день. Целевой день — отдельный «бакет» очереди
    // станка (groupBySlitter сортирует сперва по хранимой «Дате план», затем по
    // «Очередности»). Чтобы поставить задание В НАЧАЛО/КОНЕЦ дня, достаточно положить его
    // в этот бакет и пронумеровать «Очередность» 1..N: жадная упаковка buildSchedule сама
    // сдвинет остальные позже и перельёт переполнение на следующий день (а те задания,
    // что переехали, имеют меньшую «Дату план» и встают в начало следующего дня — каскад).
    // Перенос имеет наивысший приоритет: фиксация заданий цели НЕ мешает (перенумеровываем
    // и зафиксированные), в отличие от ↑↓ (moveInQueue).
    //   cutId    — перемещаемое задание;
    //   dayCuts  — задания того же станка на целевом дне (без перемещаемого), любой порядок;
    //   position — 'start' (в начало) | 'end' (в конец).
    // → { ordered:[id…], seqByCut:{ id: seq 1..N } }. Вход не мутирует.
    function planMoveSequences(cutId, dayCuts, position) {
        var sorted = (dayCuts || []).slice().sort(function(a, b) {
            var an = Number(a && a.sequence), bn = Number(b && b.sequence);
            if (!isFinite(an)) an = Infinity;
            if (!isFinite(bn)) bn = Infinity;
            return an - bn || ((Number(b && b.knifeCount) || 0) - (Number(a && a.knifeCount) || 0));
        });
        var ids = sorted.map(function(c) { return String(c.id); })
            .filter(function(id) { return id !== String(cutId); });
        var ordered = position === 'end' ? ids.concat([String(cutId)]) : [String(cutId)].concat(ids);
        var seqByCut = {};
        ordered.forEach(function(id, i) { seqByCut[id] = i + 1; });
        return { ordered: ordered, seqByCut: seqByCut };
    }

    function cutPlanDayKey(c) {
        // #3249: planDate приходит unix-штампом (DATETIME) — группируем по календарному дню.
        var key = planDateDayKey(c && c.planDate);
        return key === Infinity ? '' : String(key);
    }

    function nextSequenceForCuts(cuts, slitterId, planDate) {
        var sid = String(slitterId == null ? '' : slitterId);
        if (sid === '') return '';
        var day = cutPlanDayKey({ planDate: planDate || '' });
        var max = 0;
        (cuts || []).forEach(function(c) {
            var csid = c && c.slitter && c.slitter.id;
            if (String(csid == null ? '' : csid) !== sid) return;
            if (cutPlanDayKey(c) !== day) return;
            var n = Number(c.sequence);
            if (isFinite(n) && n > max) max = n;
        });
        return max + 1;
    }

    function comparePlanDayKeys(a, b) {
        if (a === '' && b !== '') return 1;
        if (b === '' && a !== '') return -1;
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
    }

    // Сгруппировать резки по станкам и дням, упорядочить каждую группу через orderCuts,
    // пронумеровать 1..N внутри каждого станка/дня. Резки без станка (slitter.id == null) пропускаются.
    // Возвращает плоский массив [{cutId, slitterId, sequence}].
    function planQueues(cuts, weights) {
        var groups = {};
        var slitterOrder = [];
        (cuts || []).forEach(function(c) {
            var sid = c && c.slitter && c.slitter.id;
            if (sid == null) return; // пропускаем «без станка»
            var key = String(sid);
            if (!groups[key]) { groups[key] = { days: {}, dayOrder: [] }; slitterOrder.push(key); }
            var day = cutPlanDayKey(c);
            if (!groups[key].days[day]) { groups[key].days[day] = []; groups[key].dayOrder.push(day); }
            groups[key].days[day].push(c);
        });
        var result = [];
        slitterOrder.forEach(function(sid) {
            groups[sid].dayOrder.slice().sort(comparePlanDayKeys).forEach(function(day) {
                var ordered = orderCuts(groups[sid].days[day], weights);
                ordered.forEach(function(c) {
                    result.push({ cutId: c.id, slitterId: sid, sequence: c.sequence });
                });
            });
        });
        return result;
    }

    // Прогресс длительной генерации резок (#3148): целое значение процента 0..100.
    // total ≤ 0 или нечисловые входы → 0; результат клампится в [0, 100].
    function progressPercent(done, total) {
        var d = Number(done), t = Number(total);
        if (!isFinite(d) || !isFinite(t) || t <= 0) return 0;
        var p = Math.round((d / t) * 100);
        if (p < 0) return 0;
        if (p > 100) return 100;
        return p;
    }

    // #3323/#3354 п.2: клик по ЛЮБОМУ месту карточки резки .atex-pp-cut выбирает её
    // (→ боковая панель «Связанные позиции»). Раньше исключались и кнопки ↑/↓/Полосы —
    // из-за этого клик по ним не обновлял .atex-pp-link (старый дефект п.2). Теперь
    // выбор резки идёт через лёгкий selectCut (без пересборки очереди), поэтому клики по
    // кнопкам тоже могут выбирать резку, не закрывая панель полос. Единственное
    // исключение — клики ВНУТРИ самой панели полос .atex-pp-strip-panel (#3354 п.3): она
    // не должна сворачиваться/менять выбор ни от каких событий, кроме своего крестика
    // .atex-pp-strip-close. Чистая (принимает цель клика с .closest) → проверяется
    // модульным тестом без DOM-движка.
    function cutClickSelectsCut(target) {
        if (!target || typeof target.closest !== 'function') return true;
        return !target.closest('.atex-pp-strip-panel');
    }

    // #3638: разбор deep-link из строки запроса (?cut=..&date=..&slitter=..). Ганта
    // (cut-gantt) шлёт сюда дату/станок/задание, чтобы открыть очередь на нужной
    // резке. Чистая → проверяется тестом. Возвращает {cut,date,slitter} (строки).
    function parseDeepLink(search) {
        var s = String(search == null ? '' : search);
        var qm = s.indexOf('?');
        if (qm >= 0) s = s.slice(qm + 1);
        var out = { cut: '', date: '', slitter: '' };
        s.split('&').forEach(function(pair) {
            if (!pair) return;
            var eq = pair.indexOf('=');
            var key = eq >= 0 ? pair.slice(0, eq) : pair;
            var val = eq >= 0 ? pair.slice(eq + 1) : '';
            try { val = decodeURIComponent(val.replace(/\+/g, ' ')); } catch (e) {}
            if (key === 'cut' || key === 'date' || key === 'slitter') out[key] = val;
        });
        return out;
    }

    // #3713: URL рабочего места «Диаграмма Ганта» относительно текущего пути (последний
    // сегмент → cut-gantt). /ateh/production-planning → /ateh/cut-gantt. Вне браузера — дефолт.
    var DEFAULT_GANTT_URL = '/atex/cut-gantt';
    function ganttBaseFromLocation() {
        if (typeof window === 'undefined' || !window.location || !window.location.pathname) return DEFAULT_GANTT_URL;
        var path = String(window.location.pathname).replace(/\/+$/, '');
        var idx = path.lastIndexOf('/');
        return (idx >= 0 ? path.slice(0, idx) : '') + '/cut-gantt';
    }

    // #3713: ссылка на Гант с диапазоном дат фильтра «Дата плана» (?from=..&to=..). Гант
    // открывается ровно этим диапазоном (см. ganttRangeFromTo в cut-gantt). Пустой «По» →
    // to = from (один день). Чистая → проверяется тестом.
    function ganttRangeLink(fromIso, toIso, baseUrl) {
        var base = baseUrl || DEFAULT_GANTT_URL;
        var from = String(fromIso == null ? '' : fromIso).trim();
        var to = String(toIso == null ? '' : toIso).trim();
        var params = [];
        if (from) params.push('from=' + encodeURIComponent(from));
        if (to) params.push('to=' + encodeURIComponent(to));
        else if (from) params.push('to=' + encodeURIComponent(from));
        return params.length ? base + '?' + params.join('&') : base;
    }

    // #3713: иконка-Гант (горизонтальные полосы) для ссылки у фильтра дат.
    var GANTT_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
        '<rect x="1" y="2.5" width="8" height="2.6" rx="1"></rect>' +
        '<rect x="4" y="6.7" width="9" height="2.6" rx="1"></rect>' +
        '<rect x="2" y="10.9" width="6" height="2.6" rx="1"></rect></svg>';

    var planning = {
        parseDeepLink: parseDeepLink,
        ganttRangeLink: ganttRangeLink,                 // #3713
        ganttBaseFromLocation: ganttBaseFromLocation,   // #3713
        cutClickSelectsCut: cutClickSelectsCut,
        parseRef: parseRef,
        parseMultiRefIds: parseMultiRefIds,
        isMaterialBlocked: isMaterialBlocked,
        aliasOf: aliasOf,
        matchesName: matchesName,
        tableByName: tableByName,
        reqIdByName: reqIdByName,
        columnIndex: columnIndex,
        parseActualWidthCode: parseActualWidthCode,      // #3372
        actualWidthCodeMatches: actualWidthCodeMatches,  // #3372
        buildActualWidthIndex: buildActualWidthIndex,    // #3372
        resolveCutWidth: resolveCutWidth,                // #3372
        resolveNominalWidth: resolveNominalWidth,        // #3408
        parseSleeveWidthFromName: parseSleeveWidthFromName, // #3812
        isSleeveWidthProducible: isSleeveWidthProducible, // #3812
        sleeveCoreStripPlan: sleeveCoreStripPlan,        // #3812
        appendCoreStrip: appendCoreStrip,                // #3812
        isCoreStripFiller: isCoreStripFiller,            // #3872
        selectCoreStripFillers: selectCoreStripFillers,  // #3872
        coreOnlyStripWidths: coreOnlyStripWidths,        // #3872
        mapCutRecord: mapCutRecord,
        groupBySlitter: groupBySlitter,
        mergeStationTabs: mergeStationTabs,
        filterCuts: filterCuts,
        cutSearchHaystack: cutSearchHaystack,
        cutMatchesQuery: cutMatchesQuery,
        isCutVisible: isCutVisible,
        dayDeletionTargets: dayDeletionTargets,
        formatPlanDayLabel: formatPlanDayLabel,
        formatPlanDayRangeLabel: formatPlanDayRangeLabel,   // #3622
        fulfillmentIdsFromRows: fulfillmentIdsFromRows,   // #3486
        cutFulfillmentIds: cutFulfillmentIds,             // #3691
        extractApiError: extractApiError,
        planDateDayKey: planDateDayKey,
        dayKeyToDate: dayKeyToDate,             // #3769
        formatDayKey: formatDayKey,             // #3769
        dueColorClass: dueColorClass,           // #3769
        cutDueKeys: cutDueKeys,                 // #3769
        dayOffsetFromBase: dayOffsetFromBase,   // #3652
        formatPlanDayHeading: formatPlanDayHeading,
        buildFields: buildFields,
        maxNumericCutNumber: maxNumericCutNumber,
        nextCutMainValue: nextCutMainValue,
        splitMachineQueue: splitMachineQueue,
        scheduleStartTimestamp: scheduleStartTimestamp,
        planStartTimestamps: planStartTimestamps,
        downtimeBlockedRanges: downtimeBlockedRanges,             // #3764
        slitterDownOnDay: slitterDownOnDay,                       // #3876
        parseDmyKey: parseDmyKey,                                 // #3788
        dayKeyFromMs: dayKeyFromMs,                               // #3788
        dayTypeWorking: dayTypeWorking,                           // #3788
        dayIsWorking: dayIsWorking,                               // #3788
        calendarBlockedRanges: calendarBlockedRanges,             // #3788
        mergeBlockedRanges: mergeBlockedRanges,                   // #3788
        nextFreeWorkMinute: nextFreeWorkMinute,                   // #3764
        shiftPlacementsPastDowntime: shiftPlacementsPastDowntime, // #3764
        unixToDatetimeLocal: unixToDatetimeLocal,                 // #3764
        datetimeLocalToUnix: datetimeLocalToUnix,                 // #3764
        downtimeRangeNote: downtimeRangeNote,                     // #3787
        formatDowntimeBound: formatDowntimeBound,                 // #3787
        continuationSignature: continuationSignature,
        isDaySplitSibling: isDaySplitSibling,
        daySplitBadges: daySplitBadges,
        boundaryDaySibling: boundaryDaySibling,   // #3737
        mergeContinuationChains: mergeContinuationChains,
        planCutOperations: planCutOperations,
        splitSupplyShares: splitSupplyShares,
        addMainValueField: addMainValueField,
        cutWriteDiagnostics: cutWriteDiagnostics,
        cutCreateRequiredKeys: cutCreateRequiredKeys,   // #3851
        cutGenerationTimingDiagnostics: cutGenerationTimingDiagnostics,
        supplyCutRelation: supplyCutRelation,
        buildSupplyFieldsForCut: buildSupplyFieldsForCut,
        buildSupplyFieldsForFinishedBatch: buildSupplyFieldsForFinishedBatch,
        buildFinishedBatchFields: buildFinishedBatchFields,
        finishedBatchRolls: finishedBatchRolls,
        batchOrderId: batchOrderId,
        layoutPositionGroups: layoutPositionGroups,
        rowsToPlanning: rowsToPlanning,
        cutPlanningReportDiagnostics: cutPlanningReportDiagnostics,
        rowsToPositions: rowsToPositions,
        positionDimensionsLabel: positionDimensionsLabel,
        remainingRollsForPosition: remainingRollsForPosition,
        formatLinkedPositionLabel: formatLinkedPositionLabel,
        stripSupplyRolls: stripSupplyRolls,
        rowsToGenPositions: rowsToGenPositions,
        preferredWidthsKey: preferredWidthsKey,
        groupPositionsByPlanningProfile: groupPositionsByPlanningProfile,
        positionLengthMap: positionLengthMap,
        batchDateKey: batchDateKey,
        formatCutNumber: formatCutNumber,
        rowsToBatches: rowsToBatches,
        DEFAULT_OP_TIMES: DEFAULT_OP_TIMES,
        KNIFE_SCALE: KNIFE_SCALE,
        WIDTH_SCALE: WIDTH_SCALE,
        REMAINDER_OK_M: REMAINDER_OK_M,
        FATIGUE_MACHINE_WIDTH_MM: FATIGUE_MACHINE_WIDTH_MM,
        FATIGUE_FACTOR: FATIGUE_FACTOR,
        FATIGUE_START_COST_MIN: FATIGUE_START_COST_MIN,
        PLANNING_STRATEGY_SETUP: PLANNING_STRATEGY_SETUP,
        PLANNING_STRATEGY_FATIGUE: PLANNING_STRATEGY_FATIGUE,
        normWinding: normWinding,
        widthSetDistance: widthSetDistance,
        knifeMoves: knifeMoves,
        awkwardRemainder: awkwardRemainder,
        changeoverParts: changeoverParts,
        changeoverCost: changeoverCost,
        prevSetupFromRows: prevSetupFromRows,     // #3688
        carryOverPrevCut: carryOverPrevCut,       // #3688
        firstSetupParts: firstSetupParts,
        firstSetupCost: firstSetupCost,
        setupBreakdown: setupBreakdown,
        setupActivityMinutes: setupActivityMinutes,   // #3698
        minOverlapTailSetupMinutes: minOverlapTailSetupMinutes,   // #3760
        setupActivityColumns: setupActivityColumns,   // #3698
        planningStrategy: planningStrategy,
        planningStrategyLabel: planningStrategyLabel,
        makePlanningOptions: makePlanningOptions,
        estimatedKnifeCount: estimatedKnifeCount,
        fatiguePositionWeight: fatiguePositionWeight,
        fatigueRouteScore: fatigueRouteScore,
        fatigueAwareSequence: fatigueAwareSequence,
        greedySequence: greedySequence,
        orderCuts: orderCuts,
        orderedChangeoverCost: orderedChangeoverCost,
        bestExistingTransitionCost: bestExistingTransitionCost,
        chooseSlitterBySetup: chooseSlitterBySetup,
        rebalanceSlitterLoad: rebalanceSlitterLoad,   // #3848: выравнивание загрузки станков
        knifeWidthSig: knifeWidthSig,   // #3666
        byKnifeCountDesc: byKnifeCountDesc,
        planQueues: planQueues,
        moveInQueue: moveInQueue,
        planMoveSequences: planMoveSequences,   // #3602
        unsuppliedPositions: unsuppliedPositions,
        supplyCoverageKind: supplyCoverageKind,
        uncoveredPositions: uncoveredPositions,
        nextSequenceForCuts: nextSequenceForCuts,
        pickSlitter: pickSlitter,
        pickBatchFIFO: pickBatchFIFO,
        pickBatchFIFOForRun: pickBatchFIFOForRun,
        slitterAffinityKey: slitterAffinityKey,
        batchIsActive: batchIsActive,
        isStockStrip: isStockStrip,
        maxStockKey: maxStockKey,
        parseMaxStockRows: parseMaxStockRows,
        buildMaxStockIndex: buildMaxStockIndex,
        maxStockConfigured: maxStockConfigured,
        maxStockMatches: maxStockMatches,
        maxStockLimit: maxStockLimit,
        isStockableNomenclature: isStockableNomenclature,
        stockStripPurpose: stockStripPurpose,
        filterStockableWidths: filterStockableWidths,
        buildStockBalanceIndex: buildStockBalanceIndex,
        currentStock: currentStock,
        stockHeadroom: stockHeadroom,
        capStockToHeadroom: capStockToHeadroom,
        plannedRunsForLayout: plannedRunsForLayout,
        supplyRollsForPosition: supplyRollsForPosition,
        layoutRunLength: layoutRunLength,
        finishedBatchesForLayout: finishedBatchesForLayout,
        producedBatchesForLayout: producedBatchesForLayout,
        supplyPlanForLayout: supplyPlanForLayout,
        positionSleeveTasksForLayout: positionSleeveTasksForLayout,
        pickSleeveBatchId: pickSleeveBatchId,
        sleeveMinutes: sleeveMinutes,
        cutMissingBatch: cutMissingBatch,
        requiredRunLengthM: requiredRunLengthM,
        supplyFootage: supplyFootage,
        cutRunLength: cutRunLength,
        reserveFifo: reserveFifo,
        fifoBatchesForMaterial: fifoBatchesForMaterial,
        materialByCut: materialByCut,
        healContinuationMaterials: healContinuationMaterials,   // #3808
        windingPointsFromTimes: windingPointsFromTimes,
        foilWindingPointsFromTimes: foilWindingPointsFromTimes,
        foilWindingMinutes: foilWindingMinutes,   // #3742
        windPointsForCut: windPointsForCut,
        windingMinutes: windingMinutes,
        relevantWindingNorms: relevantWindingNorms,
        formatWindingNorms: formatWindingNorms,
        plannedCutDurationMinutes: plannedCutDurationMinutes,
        cutTimingDetails: cutTimingDetails,
        cutTimingModalText: cutTimingModalText,
        cutTimingModalTitle: cutTimingModalTitle,
        cutTimingTimelineLines: cutTimingTimelineLines,
        buildCutTimingCtx: buildCutTimingCtx,
        scheduleDurationMinutes: scheduleDurationMinutes,
        setupTaskIdSet: setupTaskIdSet,   // #3635 п.5
        parseClockMinutes: parseClockMinutes,
        resolveWorkingWindow: resolveWorkingWindow,
        buildSchedule: buildSchedule,
        scheduleFromStored: scheduleFromStored,   // #3846: показ из сохранённого плана (без live-пересчёта)
        lunchBlocksFromSchedule: lunchBlocksFromSchedule,   // #3846: блоки обеда для отображения
        freeSlotForQueue: freeSlotForQueue,
        dayCleanups: dayCleanups,
        formatClock: formatClock,
        formatClockHHMM: formatClockHHMM,
        formatCutStartTime: formatCutStartTime,
        formatCutStartTitle: formatCutStartTitle,
        cutStartWindowMin: cutStartWindowMin,
        formatCutWindingLabel: formatCutWindingLabel,
        formatScheduleLine: formatScheduleLine,
        formatFreeSlot: formatFreeSlot,
        DAY_START_MIN: DAY_START_MIN,
        DAY_END_MIN: DAY_END_MIN,
        SHIFT_START_MIN: SHIFT_START_MIN,
        SHIFT_END_MIN: SHIFT_END_MIN,
        aggregateStrips: aggregateStrips,
        stripsUsedWidth: stripsUsedWidth,
        stripsTotalKnives: stripsTotalKnives,
        knifeWidthsForStrips: knifeWidthsForStrips,
        stripsRemainder: stripsRemainder,
        cutRemainderStatus: cutRemainderStatus,
        progressPercent: progressPercent,
        stripsButtonLabel: stripsButtonLabel,
        formatCutRuns: formatCutRuns,
        cutDisplayLength: cutDisplayLength,
        formatCutDimensions: formatCutDimensions,
        cutStripGroups: cutStripGroups,
        formatStripSummaryLine: formatStripSummaryLine,
        resolveTolerance: resolveTolerance
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

    function AtexProductionPlanning(root) {
        this.root = root;
        this.db = window.db || root.getAttribute('data-db') || '';
        this.meta = {
            cut: null,
            supply: null,
            slitter: null,
            materialBatch: null,
            strip: null,
            finishedBatch: null,
            sleeveTask: null,
            settings: null,
            downtime: null        // #3764: подчинённая «Отпуск» (окна простоя станка)
        };
        this.downtimesBySlitter = {};  // #3764: карта slitterId → [{ id, start, end, notes }] (start/end — unix-сек)
        this.calendarByDay = {};       // #3788: карта ГГГГММДД → 'Праздничный день'|'Рабочий день' (исключения календаря)
        this.sleeveBatches = [];   // #3340: партии втулок «в работе» (отчёт sleeve_batches_active) для FIFO
        this.sleeveCutterId = '';  // #3340: id втулкореза TC-20 (резолв по имени)
        this.slitters = [];        // справочник [{ id, label, stopMaterialIds }]
        this.materialBatches = []; // справочник [{ id, label }]
        this.batchMaterialById = {}; // карта batch_id → вид_сырья_id (для стоп-листа)
        this.positions = [];       // позиции заказа [{ id, label }]
        this.refOptions = {};      // кеш опций searchable reference inputs по reqId
        this.cuts = [];            // очередь резок [mapCutRecord]
        this.supplies = [];        // все записи «Обеспечения» (для подсчёта привязок)
        // Данные для генерации резок:
        this.genPositions = [];    // [{ id, materialId, width, qty, dueKey }] — все позиции
        this.genBatches = [];      // [{ id, materialId, dateKey, remainder }]
        this.stripAgg = {};        // карта cutId → { knifeCount, knifeWidths } (отчёт cut_strips)
        this.jumboWidthByMaterial = {}; // карта materialId → ширина джамбо «Вид сырья» («Ширина, мм» — геометрия реза)
        this.nominalWidthByMaterial = {}; // #3686: materialId → «Номинальная ширина» (рулон) для условий j= фактической ширины
        this.prevSetupBySlitter = {};   // #3688: текущая заправка станков (prev_cut_setup) для первой резки
        this.preferredByMaterial = {};  // кеш ходовых ширин: materialId|windDir|windLength → [{width, popularity}]
        this.maxStockIndex = planning.buildMaxStockIndex([], null);  // #3391: индекс «Максимального запаса» (пуст до загрузки)
        this.stockBalanceIndex = planning.buildStockBalanceIndex([]); // #3445: текущий остаток ГП по номенклатуре (пуст до загрузки)
        this.draft = this.blankDraft();
        // #3599: дата плана диапазоном [date; dateTo] — фильтр отображения очереди; date
        // («С») остаётся базой генерации/планирования. По умолчанию оба = сегодня (один день).
        this.filter = { slitter: '', status: '', date: todayISO(), dateTo: todayISO(), query: '' };  // query — быстрый поиск (#3411)
        this.selectedCutId = null; // выбранная резка для привязки обеспечения
        this.stripEditCutId = null; // резка с открытым инлайн-редактором полос (одна за раз)
        this.lastCutMainValue = 0;  // последний t{Задание в производство}, выданный клиентом
        this.busy = false;
        this.progressEl = null;     // окно прогресса генерации резок (#3148)
        this.progressTotal = 0;
        this.timingModalEl = null;
        this.timingModalTitleEl = null;
        this.timingModalBodyEl = null;
        this._timingByCut = {};     // #3240: контекст тайминга на резку (setup+нормы+старт) для модалки
        this.daySettings = {};      // DAY_START_HOUR/DAY_END_HOUR из таблицы «Настройка»
        this._lastCutPlanningDiagnosticKey = '';
    }

    AtexProductionPlanning.prototype.blankDraft = function() {
        return { positionId: '', qty: '', footage: '', slitterId: '', materialBatchId: '', plannedRuns: '1', planDate: '', status: CUT_STATUSES[0], active: true, notes: '', selectedPositions: [], prospect: null };
    };

    AtexProductionPlanning.prototype.url = function(path) {
        return '/' + encodeURIComponent(this.db) + '/' + path;
    };

    AtexProductionPlanning.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                var data;
                try { data = text ? JSON.parse(text) : null; }
                catch (e) {
                    if (!resp.ok) throw new Error('Сервер вернул ошибку ' + resp.status + ': ' + text.slice(0, 200));
                    throw new Error('Некорректный JSON: ' + text.slice(0, 200));
                }
                // Сервер сигналит отказ кодом 4xx и телом `[{"error":"…"}]` (my_die).
                if (!resp.ok) throw new Error(extractApiError(data) || ('Сервер вернул ошибку ' + resp.status));
                return data;
            });
        });
    };

    AtexProductionPlanning.prototype.loadRefOptions = function(reqId, query, limit) {
        return this.getJson(window.AtexRefSearch.buildRefOptionsPath(reqId, query, limit));
    };

    // POST команды `_m_*`. Токен XSRF подставляется обязательно (раздел 4 гайда).
    AtexProductionPlanning.prototype.post = function(path, params) {
        var body = new URLSearchParams();
        body.set('_xsrf', (typeof window !== 'undefined' && window.xsrf) || this.root.getAttribute('data-xsrf') || '');
        Object.keys(params || {}).forEach(function(k) {
            if (params[k] !== undefined && params[k] !== null && params[k] !== '') body.set(k, params[k]);
        });
        return fetch(this.url(path), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        }).then(function(resp) {
            return resp.text().then(function(text) {
                var result;
                try { result = text ? JSON.parse(text) : {}; }
                catch (e) {
                    if (!resp.ok) throw new Error('Сервер вернул ошибку ' + resp.status + ': ' + text.slice(0, 200));
                    throw new Error('Сервер вернул не JSON: ' + text.slice(0, 200));
                }
                // #3486/#3475: отказ команды `_m_*` приходит телом `[{"error":"…"}]` (массив,
                // my_die) с HTTP-кодом 4xx/409. Прежняя проверка `result.error` у массива не
                // срабатывала и не смотрела статус — отказ (напр. 409 «есть ссылки» при удалении)
                // молча считался успехом, запись оставалась, а тост рапортовал «удалено».
                if (!resp.ok) throw new Error(extractApiError(result) || ('Сервер вернул ошибку ' + resp.status));
                return result;
            });
        });
    };

    // ── Загрузка метаданных и справочников ──

    AtexProductionPlanning.prototype.loadMetadata = function() {
        var self = this;
        return this.getJson('metadata').then(function(all) {
            var list = Array.isArray(all) ? all : [all];
            self._metaAll = list; // кеш полного списка метаданных (резолв таблиц по имени)
            function byName(name) {
                return tableByName(list, name);
            }
            self.meta.cut = byName(TABLE.cut) || byName('Производственная резка'); // #3504: старое имя запасным
            self.meta.supply = byName(TABLE.supply);
            self.meta.slitter = byName(TABLE.slitter);
            self.meta.materialBatch = byName(TABLE.materialBatch);
            self.meta.strip = byName(TABLE.strip); // подчинённая «Производственной резки» (Task 3)
            self.meta.finishedBatch = byName(TABLE.finishedBatch);
            self.meta.sleeveTask = byName(TABLE.sleeveTask);
            self.meta.settings = byName(TABLE.settings);
            self.meta.maxStock = byName(TABLE.maxStock);   // #3391: необязательная — фича включается её наличием
            self.meta.leader = byName(TABLE.leader);        // #3569: справочник «Лидер» (резолв метки → id)
            self.meta.downtime = byName(TABLE.downtime);    // #3764: необязательная — кнопка/пропуск простоя включаются её наличием
            self.meta.calendar = byName(TABLE.calendar);    // #3788: необязательная — пропуск выходных/праздников включается её наличием
            if (!self.meta.cut) throw new Error('В метаданных не найдена таблица «' + TABLE.cut + '»');
            if (!self.meta.supply) throw new Error('В метаданных не найдена таблица «' + TABLE.supply + '»');
        });
    };

    AtexProductionPlanning.prototype.loadDaySettings = function() {
        var self = this;
        var meta = this.meta.settings;
        if (!meta) { this.daySettings = {}; return Promise.resolve(); }
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            var dbKey = String(self.db || '').trim().toUpperCase();
            var values = {};
            var score = {};
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                var key = String(r[0] == null ? '' : r[0]).replace(/^\uFEFF/, '').trim();
                // #3342: \u043F\u043E\u043C\u0438\u043C\u043E \u0440\u0430\u0431\u043E\u0447\u0435\u0433\u043E \u043E\u043A\u043D\u0430 \u0447\u0438\u0442\u0430\u0435\u043C \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u043E\u0431\u0435\u0434\u0430 LUNCH_START/LUNCH_DURATION.
                if (key !== 'DAY_START_HOUR' && key !== 'DAY_END_HOUR' &&
                    key !== 'LUNCH_START' && key !== 'LUNCH_DURATION' &&
                    key !== 'TOTAL_INTERVALS' &&        // #3599: буфер перед уборкой (мин)
                    key !== 'MAX_OVERWORK_CUTS' &&      // #3847: макс. нахлёст резки за DAY_END_HOUR (мин)
                    key !== 'MAX_OVERWORK_TUNE' &&      // #3847: макс. нахлёст настройки за DAY_END_HOUR (мин)
                    key !== 'DAYS_FORECAST') return;    // #3769: окно срока изготовления (дни) для расцветки строк
                var type = String(r[1] == null ? '' : r[1]).trim().toUpperCase();
                var val = String(r[2] == null ? '' : r[2]).trim();
                if (val === '') return;
                var rank = 1;
                if (dbKey && type === dbKey) rank = 3;
                else if (type === 'ATEH') rank = 2;
                if (!score[key] || rank >= score[key]) {
                    score[key] = rank;
                    values[key] = val;
                }
            });
            self.daySettings = values;
        });
    };

    // #3769: DAYS_FORECAST из «Настройки» — окно срока изготовления (дни) для расцветки
    // строк .atex-pp-strip-row. Нет/некорректно → null (жёлтый отключён, красный работает).
    AtexProductionPlanning.prototype.daysForecast = function() {
        var v = this.daySettings ? this.daySettings.DAYS_FORECAST : null;
        var n = Number(v);
        return (isFinite(n) && n >= 0) ? n : null;
    };

    AtexProductionPlanning.prototype.workingWindow = function() {
        return resolveWorkingWindow(this.daySettings, this.changeTimes && this.changeTimes.CLEANUP_SHIFT);
    };

    // Справочник: главное значение записей таблицы → [{ id, label }].
    AtexProductionPlanning.prototype.loadRef = function(meta, labelReq) {
        if (!meta) return Promise.resolve([]);
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            return (rows || []).map(function(r) {
                var label = (r.r && r.r[0]) || ('#' + r.i);
                if (labelReq) {
                    var idx = columnIndex(meta, labelReq);
                    if (idx >= 0 && r.r && r.r[idx] != null && String(r.r[idx]).trim() !== '') {
                        label = label + ' · ' + String(r.r[idx]);
                    }
                }
                return { id: String(r.i), label: label };
            });
        });
    };

    // Справочник станков (слиттеров) с их стоп-листами сырья.
    // Читает object/ с полем «Стоп-лист сырья» (мультиссылка → Вид сырья);
    // разбирает через parseMultiRefIds → stopMaterialIds: ['id1','id2',...].
    // Заменяет loadRef(meta.slitter) в начальной загрузке.
    AtexProductionPlanning.prototype.loadSlittersWithStop = function() {
        var meta = this.meta.slitter;
        if (!meta) return Promise.resolve([]);
        var stopIdx = columnIndex(meta, 'Стоп-лист сырья');
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            return (rows || []).map(function(r) {
                var raw = (stopIdx >= 0 && r.r) ? r.r[stopIdx] : '';
                return {
                    id: String(r.i),
                    label: (r.r && r.r[0]) || ('#' + r.i),
                    stopMaterialIds: parseMultiRefIds(raw)
                };
            });
        });
    };

    // #3764: окна «Отпуска» (простоя) по станкам. Подчинённая «Отпуск» (up = Слиттер),
    // главное значение записи — НАЧАЛО (DATETIME, unix-сек), «Окончание» — конец, «Примечания» —
    // причина. Читаем по каждому станку отдельно (F_U=slitterId, как полосы по резке). Таблицы
    // нет в метаданных (старое окружение) → пустая карта, фича выключена (кнопка не рисуется,
    // расписание прежнее). Ошибка чтения не валит загрузку — лишь логируется.
    AtexProductionPlanning.prototype.loadDowntimes = function() {
        var self = this;
        this.downtimesBySlitter = {};
        var meta = this.meta.downtime;
        if (!meta || !(this.slitters || []).length) return Promise.resolve();
        var endIdx = columnIndex(meta, DOWNTIME_REQ.end);
        var notesIdx = columnIndex(meta, DOWNTIME_REQ.notes);
        return Promise.all(this.slitters.map(function(s) {
            return self.getJson('object/' + meta.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(s.id) + '&LIMIT=0,500')
                .then(function(rows) {
                    self.downtimesBySlitter[String(s.id)] = (rows || []).map(function(rec) {
                        var r = rec.r || [];
                        return {
                            id: String(rec.i),
                            start: (r[0] == null || r[0] === '') ? null : Number(r[0]),
                            end: (endIdx >= 0 && r[endIdx] != null && r[endIdx] !== '') ? Number(r[endIdx]) : null,
                            notes: (notesIdx >= 0 && r[notesIdx] != null) ? String(r[notesIdx]) : ''
                        };
                    });
                });
        })).then(function() {
            console.log('[pp] 🛠 loadDowntimes: окон простоя по станкам:',
                Object.keys(self.downtimesBySlitter).reduce(function(n, k) { return n + self.downtimesBySlitter[k].length; }, 0));
        }).catch(function(err) {
            console.warn('[pp] 🛠 loadDowntimes: не удалось прочитать «' + TABLE.downtime + '»:', err && err.message);
            self.downtimesBySlitter = {};
        });
    };

    // #3788: «Календарь» — исключения из обычных выходных. Таблица 123162 (тип DATE): главное
    // значение — дата (ДД.ММ.ГГГГ), «Тип дня» (ссылка) = «Праздничный день»/«Рабочий день».
    // Строим карту ГГГГММДД → тип. Таблицы нет в метаданных (старое окружение) → пустая карта,
    // фича выключена (выходные/праздники не пропускаются, разметка дней не рисуется). Ошибка
    // чтения не валит загрузку.
    AtexProductionPlanning.prototype.loadCalendar = function() {
        var self = this;
        this.calendarByDay = {};
        var meta = this.meta.calendar;
        if (!meta) return Promise.resolve();
        var typeIdx = columnIndex(meta, CALENDAR_REQ.dayType);
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,2000').then(function(rows) {
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                var key = parseDmyKey(r[0]);
                if (key == null) return;
                // «Тип дня» — ссылка «id:Метка»; берём метку (parseRef.label).
                var typeLabel = (typeIdx >= 0 && r[typeIdx] != null) ? parseRef(r[typeIdx]).label : '';
                if (typeLabel) self.calendarByDay[key] = typeLabel;
            });
            console.log('[pp] 📅 loadCalendar: дней-исключений в календаре:', Object.keys(self.calendarByDay).length);
        }).catch(function(err) {
            console.warn('[pp] 📅 loadCalendar: не удалось прочитать «' + TABLE.calendar + '»:', err && err.message);
            self.calendarByDay = {};
        });
    };

    // #3788: нерабочие дни (выходные/праздники) горизонта → блокированные интервалы (минуты от
    // базы). Фича включается наличием таблицы «Календарь»: без неё [] (расписание прежнее, дни
    // не блокируются). baseMidnightMs — база расписания (день фильтра «С»). Глобальны для всех станков.
    AtexProductionPlanning.prototype.calendarBlockedRanges = function(baseMidnightMs) {
        if (!this.meta.calendar) return [];
        return calendarBlockedRanges(this.calendarByDay, baseMidnightMs, CALENDAR_HORIZON_DAYS);
    };

    // #3788: рабочий ли день (по мс). Фича выключена (нет «Календаря») → всегда рабочий, чтобы
    // разметка выходных не появлялась в старом окружении.
    AtexProductionPlanning.prototype.dayIsWorking = function(ms) {
        if (!this.meta.calendar) return true;
        return dayIsWorking(ms, this.calendarByDay);
    };

    // #3764+#3788: блокированные интервалы станка = окна «Отпуска» этого станка ∪ нерабочие дни
    // календаря (глобальные). baseMidnightMs — база расписания (день фильтра «С»).
    AtexProductionPlanning.prototype.blockedRangesForSlitter = function(slitterId, baseMidnightMs) {
        return mergeBlockedRanges(
            downtimeBlockedRanges((this.downtimesBySlitter || {})[String(slitterId)], baseMidnightMs),
            this.calendarBlockedRanges(baseMidnightMs)
        );
    };

    // #3876: на отпуске ли станок slitterId ВЕСЬ рабочий день dayMidnightMs (полночь дня, мс).
    // Календарь (выходные/праздники) сюда НЕ входит — он глобален и не делает станок «недоступным»
    // в смысле этой проверки; речь именно об «Отпуске» конкретного станка (он без сырья и ножей).
    // #3883: частичный отпуск (не на весь рабочий день) станок НЕ блокирует — отдаём рабочее окно
    // [startMin; cutEndMin], slitterDownOnDay требует ПОЛНОГО покрытия (2-часовой отпуск → false).
    AtexProductionPlanning.prototype.slitterOnVacationDay = function(slitterId, dayMidnightMs) {
        var w = this.workingWindow();
        return slitterDownOnDay((this.downtimesBySlitter || {})[String(slitterId)], dayMidnightMs,
            w && w.startMin, w && w.cutEndMin);
    };

    // #3876: id станков, у которых в день dayMidnightMs отпуск → { slitterId: true }. Для
    // исключения таких станков при выборе/балансировке (не ставить задание на станок в отпуске).
    AtexProductionPlanning.prototype.vacationSlitterIdsForDay = function(dayMidnightMs) {
        var self = this, out = {};
        (this.slitters || []).forEach(function(s) {
            if (self.slitterOnVacationDay(s.id, dayMidnightMs)) out[String(s.id)] = true;
        });
        return out;
    };

    // #3876: заправка станков для расчёта настройки. У станка, который НА отпуске в день базы
    // плана (baseMidnightMs), сырья и ножей нет — его заправку обнуляем (пустой объект). Тогда
    // первая резка станка ПОСЛЕ отпуска считает ПОЛНУЮ настройку (смена сырья + ножи с нуля,
    // changeoverParts от пустого станка), а не наследует prev_cut_setup, бывший ДО отпуска.
    // Прочие станки — как есть (#3853/#3862). Применяется и в плане (splitMachineQueue), и в
    // хранимых колонках (computeCutSetupUpdates) — один источник, тайминги совпадают.
    AtexProductionPlanning.prototype.planningPrevSetupBySlitter = function(baseMidnightMs) {
        var self = this, src = this.prevSetupBySlitter || {}, out = {};
        Object.keys(src).forEach(function(k) { out[k] = src[k]; });
        (this.slitters || []).forEach(function(s) {
            var key = String(s.id);
            if (self.slitterOnVacationDay(key, baseMidnightMs)) out[key] = { materialId: '', winding: '', knifeWidths: [] };
        });
        return out;
    };

    // #3764+#3788: карта slitterId → blockedRanges по ВСЕМ станкам (для planCutOperations).
    // Нерабочие дни календаря добавляем КАЖДОМУ станку (глобальны), поэтому строим по полному
    // справочнику станков, а не только по тем, у кого есть отпуск.
    AtexProductionPlanning.prototype.blockedRangesBySlitter = function(baseMidnightMs) {
        var self = this, out = {};
        var calBlocks = this.calendarBlockedRanges(baseMidnightMs);
        var keys = {};
        (this.slitters || []).forEach(function(s) { keys[String(s.id)] = true; });
        Object.keys(this.downtimesBySlitter || {}).forEach(function(k) { keys[k] = true; });
        Object.keys(keys).forEach(function(key) {
            var ranges = mergeBlockedRanges(
                downtimeBlockedRanges(self.downtimesBySlitter[key], baseMidnightMs), calBlocks);
            if (ranges.length) out[key] = ranges;
        });
        return out;
    };

    // Справочник позиций заказа отчётом positions_list (JSON_KV). Позиция
    // подчинённая — прямое object/-чтение её не отдаёт, отчёт возвращает все.
    // Параллельно строит this.genPositions = [{ id, materialId, width, qty }]
    // для генерации резок: использует те же строки, не нужен доп. запрос.
    AtexProductionPlanning.prototype.loadPositions = function() {
        var self = this;
        console.log('[pp] 📋 loadPositions: запрос positions_list...');
        return this.getJson('report/positions_list?JSON_KV&LIMIT=0,2000').then(function(rows) {
            self.positions = rowsToPositions(rows || []);
            self.genPositions = rowsToGenPositions(rows || []);
            var approvedCnt = self.genPositions.filter(function(p) { return p.approved; }).length;
            console.log('[pp] 📋 loadPositions: загружено позиций для дропдауна:', self.positions.length, ', для генерации:', self.genPositions.length, ', согласованных:', approvedCnt);
        });
    };

    // Справочник партий сырья отчётом material_batches (JSON_KV).
    AtexProductionPlanning.prototype.loadMaterialBatches = function() {
        var self = this;
        return this.getJson('report/material_batches?JSON_KV&LIMIT=0,2000').then(function(rows) {
            self.materialBatches = rowsToBatches(rows || []);
        });
    };

    // #3391: таблица «Максимальный запас» (object/{id}) → индекс целесообразных к
    // хранению номенклатур. Таблица необязательна: если её нет в метаданных —
    // индекс пуст (фича выключена, поведение прежнее). Ошибка чтения не валит
    // загрузку — лишь логируется (планирование работает и без таблицы).
    AtexProductionPlanning.prototype.loadMaxStock = function() {
        var self = this;
        var meta = this.meta.maxStock;
        this.maxStockIndex = planning.buildMaxStockIndex([], meta);
        if (!meta) return Promise.resolve();
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            self.maxStockIndex = planning.buildMaxStockIndex(rows || [], meta);
            console.log('[pp] 📦 loadMaxStock: номенклатур запаса:', self.maxStockIndex.list.length);
        }).catch(function(err) {
            console.warn('[pp] 📦 loadMaxStock: не удалось прочитать «Максимальный запас»:', err && err.message);
            self.maxStockIndex = planning.buildMaxStockIndex([], meta);
        });
    };

    // #3445: текущий остаток ГП по номенклатуре — суммарные рулоны «Партий ГП»,
    // физически лежащих на складе (статус не «Отгружен»). Номенклатуру берём из
    // родительской «Производственной резки» (up): сырьё через batchMaterialById
    // (Партия сырья → Вид сырья), намотка/длина — поля резки; ширина — у партии.
    // Кол-во рулонов: «Кол-во факт» → «Кол-во рулонов» → «Кол-во план» (как в
    // warehouse.js: факт реален, иначе план/спрос). Нужен ПОСЛЕ loadGenBatches
    // (batchMaterialById). Graceful: ошибка чтения → пустой остаток (фича не блокирует).
    AtexProductionPlanning.prototype.loadStockBalance = function() {
        var self = this;
        this.stockBalanceIndex = planning.buildStockBalanceIndex([]);
        var fbMeta = this.meta.finishedBatch;
        var cutMeta = this.meta.cut;
        // Фича выключена без таблицы «Максимальный запас» — остаток не нужен (лишние запросы).
        if (!fbMeta || !cutMeta || !this.meta.maxStock) return Promise.resolve();
        var iWidth = columnIndex(fbMeta, FINISHED_BATCH_REQ.width);
        var iActual = columnIndex(fbMeta, FINISHED_BATCH_REQ.actual);
        var iRolls = columnIndex(fbMeta, FINISHED_BATCH_REQ.rolls);
        var iPlanned = columnIndex(fbMeta, FINISHED_BATCH_REQ.planned);
        var iStatus = columnIndex(fbMeta, CUT_REQ.status);   // «Статус»
        var iCutMat = columnIndex(cutMeta, CUT_REQ.materialBatch);
        var iCutWind = columnIndex(cutMeta, CUT_REQ.winding);
        var iCutLen = columnIndex(cutMeta, CUT_REQ.length);
        return Promise.all([
            this.getJson('object/' + fbMeta.id + '/?JSON_OBJ&LIMIT=0,5000'),
            this.getJson('object/' + cutMeta.id + '/?JSON_OBJ&LIMIT=0,5000')
        ]).then(function(res) {
            var fbRows = res[0] || [];
            var cutRows = res[1] || [];
            var matById = self.batchMaterialById || {};
            // Карта резки → { material, winding, length }.
            var cutById = {};
            cutRows.forEach(function(rec) {
                var r = rec.r || [];
                var matBatch = iCutMat >= 0 ? parseRef(r[iCutMat]) : { id: null };
                var matBatchId = matBatch.id ? String(matBatch.id) : '';
                cutById[String(rec.i)] = {
                    material: matById[matBatchId] || '',
                    winding: iCutWind >= 0 ? r[iCutWind] : '',
                    length: iCutLen >= 0 ? r[iCutLen] : 0
                };
            });
            var batches = fbRows.map(function(rec) {
                var r = rec.r || [];
                var cut = cutById[String(rec.u)] || { material: '', winding: '', length: 0 };
                // Рулоны: факт → рулоны (спрос) → план (см. warehouse.js:286-288).
                var rolls = 0;
                [iActual, iRolls, iPlanned].some(function(idx) {
                    if (idx < 0) return false;
                    var v = stripNum(r[idx]);
                    if (v > 0) { rolls = v; return true; }
                    return false;
                });
                var status = iStatus >= 0 ? String(r[iStatus] == null ? '' : r[iStatus]) : '';
                return {
                    material: cut.material,
                    width: iWidth >= 0 ? r[iWidth] : 0,
                    length: cut.length,
                    winding: cut.winding,
                    rolls: rolls,
                    shipped: /отгру/i.test(status)
                };
            });
            self.stockBalanceIndex = planning.buildStockBalanceIndex(batches);
            console.log('[pp] 📦 loadStockBalance: номенклатур на складе:',
                Object.keys(self.stockBalanceIndex.byKey).length);
        }).catch(function(err) {
            console.warn('[pp] 📦 loadStockBalance: не удалось прочитать остаток ГП:', err && err.message);
            self.stockBalanceIndex = planning.buildStockBalanceIndex([]);
        });
    };

    // #3569: справочник «Лидер» (1132) → карта { метка(lower) → id }. Отчёт
    // positions_list отдаёт лидера позиции меткой («Глобал Принтинг»), а реквизит
    // «Лидер» задания — ссылка: при записи нужен id записи справочника, а не метка
    // (docs/kb/crud.md: ref-поле = id). Таблица необязательна — нет её → карта пуста.
    AtexProductionPlanning.prototype.loadLeaders = function() {
        var self = this;
        this.leaderIdByLabel = {};
        var meta = this.meta.leader;
        if (!meta) return Promise.resolve();
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            var map = {};
            (rows || []).forEach(function(r) {
                var label = ((r.r || [])[0] == null ? '' : String((r.r || [])[0])).trim();
                if (label) map[label.toLowerCase()] = String(r.i);
            });
            self.leaderIdByLabel = map;
            console.log('[pp] 🏷️ loadLeaders: лидеров в справочнике:', Object.keys(map).length);
        }).catch(function(err) {
            console.warn('[pp] 🏷️ loadLeaders: не удалось прочитать «Лидер»:', err && err.message);
            self.leaderIdByLabel = {};
        });
    };

    // #3569: id записи справочника «Лидер» по метке (для записи ссылки в задание).
    // Нет справочника / метки / совпадения → '' (buildFields опустит пустой реквизит).
    AtexProductionPlanning.prototype.resolveLeaderId = function(label) {
        var key = (label == null ? '' : String(label)).trim().toLowerCase();
        if (!key) return '';
        return (this.leaderIdByLabel || {})[key] || '';
    };

    // ── Загрузчики для генерации резок ──

    // Загружает «Партия сырья» через object/ и заполняет this.genBatches.
    // Результат: [{ id, materialId, dateKey (число), remainder }] для pickBatchFIFO.
    // Вид сырья: parseRef(«Вид сырья»).id; Дата прихода → batchDateKey;
    // Остаток, м² → Number (ключевое поле для FIFO-выбора).
    // Заодно строит this.batchMaterialById = { партия → вид сырья } для проверки стоп-листа
    // станка: это подмножество тех же строк, поэтому отдельный запрос к таблице
    // «Партия сырья» (бывш. loadBatchMaterialMap, LIMIT 1000) не нужен — экономим чтение
    // и убираем рассинхрон лимитов (1000 vs 5000).
    AtexProductionPlanning.prototype.loadGenBatches = function() {
        var self = this;
        var meta = this.meta.materialBatch;
        if (!meta) { this.genBatches = []; this.batchMaterialById = {}; return Promise.resolve(); }
        var matIdx = columnIndex(meta, 'Вид сырья');
        // #3242: отдельной «Даты прихода» у «Партии сырья» нет — дата прихода = первая
        // колонка (DATETIME). Фоллбэк на неё, чтобы FIFO-резерв сортировался по приходу.
        var dateIdx = columnIndex(meta, 'Дата прихода');
        var dateFromMain = dateIdx < 0;
        var remIdx = columnIndex(meta, 'Остаток, м²');
        var remLinIdx = columnIndex(meta, 'Остаток, м');   // погонный остаток — для FIFO-резерва (Фаза 1b)
        var activeIdx = columnIndex(meta, 'В работе');     // #3242: «Активно» переименовано в «В работе»
        if (activeIdx < 0) activeIdx = columnIndex(meta, 'Активно');
        if (activeIdx < 0) activeIdx = columnIndex(meta, 'Активная');
        if (activeIdx < 0) activeIdx = columnIndex(meta, 'Действует');
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            var matById = {};
            self.genBatches = (rows || []).map(function(rec) {
                var r = rec.r || [];
                var mat = matIdx >= 0 ? parseRef(r[matIdx]) : { id: null };
                var materialId = mat.id ? String(mat.id) : '';
                matById[String(rec.i)] = materialId;
                return {
                    id: String(rec.i),
                    label: r[0] == null ? '' : String(r[0]),
                    materialId: materialId,
                    dateKey: dateFromMain ? batchDateKey(r[0]) : batchDateKey(r[dateIdx]),
                    remainder: remIdx >= 0 ? (Number(r[remIdx]) || 0) : 0,
                    remainderLinear: remLinIdx >= 0 ? (Number(r[remLinIdx]) || 0) : 0,
                    active: activeIdx >= 0 ? r[activeIdx] : ''
                };
            });
            self.batchMaterialById = matById;
        });
    };

    // Расход сырья (1079, подчинён резке): this.consumptionByCut = {cutId:[{id,batchId,m2}]},
    // this.reservedM2ByBatch = {batchId: Σ Израсходовано, м²}. Источник «зарезервированного»
    // сырья для FIFO-резерва (Фаза 1b) и подсветки. Таблица резолвится по имени из _metaAll.
    AtexProductionPlanning.prototype.loadConsumption = function() {
        var self = this;
        var list = this._metaAll || [];
        var meta = tableByName(list, 'Расход сырья');
        if (!meta) { this.consumptionByCut = {}; this.reservedM2ByBatch = {}; this.consumptionMeta = null; return Promise.resolve(); }
        this.consumptionMeta = meta;
        var batchIdx = columnIndex(meta, 'Партия сырья');
        var m2Idx = columnIndex(meta, 'Израсходовано, м²');
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            var byCut = {}, byBatch = {};
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                var cutId = String(rec.u);   // up = резка
                var batch = batchIdx >= 0 ? parseRef(r[batchIdx]) : { id: null };
                var m2 = m2Idx >= 0 ? (Number(r[m2Idx]) || 0) : 0;
                if (!byCut[cutId]) byCut[cutId] = [];
                byCut[cutId].push({ id: String(rec.i), batchId: batch.id ? String(batch.id) : '', m2: m2 });
                if (batch.id) byBatch[String(batch.id)] = (byBatch[String(batch.id)] || 0) + m2;
            });
            self.consumptionByCut = byCut;
            self.reservedM2ByBatch = byBatch;
        });
    };

    // FIFO-резерв сырья резки в «Расход сырья» (Фаза 1b): требуемый прогон (max «Метраж, м»
    // обеспечений) набираем по партиям вида сырья (FIFO по приходу), исключая чужие резервы;
    // прежние записи расхода этой резки удаляем и создаём заново (идемпотентно). Триггер —
    // явное действие (кнопка/планирование). Возвращает Promise.
    AtexProductionPlanning.prototype.reserveCutMaterial = function(cut) {
        var self = this;
        var meta = this.consumptionMeta;
        if (!meta || !cut) return Promise.resolve();
        if (this.busy) return Promise.resolve();
        var materialId = cut.materialId ? String(cut.materialId) : '';
        if (materialId === '') { this.notify('У задания не задано сырьё — резерв невозможен', 'error'); return Promise.resolve(); }
        var widthM = (Number(this.jumboWidthByMaterial[materialId]) || 0) / 1000;
        var requiredLin = cutRunLength(cut, this.supplies, this.footageBySupply);
        // свободный остаток без учёта собственных прежних резервов этой резки (их перезапишем)
        var existing = (this.consumptionByCut && this.consumptionByCut[String(cut.id)]) || [];
        var reservedExcl = {};
        for (var k in this.reservedM2ByBatch) { if (Object.prototype.hasOwnProperty.call(this.reservedM2ByBatch, k)) reservedExcl[k] = this.reservedM2ByBatch[k]; }
        existing.forEach(function(e) { if (e.batchId) reservedExcl[e.batchId] = (reservedExcl[e.batchId] || 0) - e.m2; });
        var batches = fifoBatchesForMaterial(this.genBatches, reservedExcl, materialId, widthM);
        var plan = reserveFifo(batches, requiredLin, widthM);
        var reqBatch = reqIdByName(meta, 'Партия сырья');
        var reqM2 = reqIdByName(meta, 'Израсходовано, м²');
        var rawActiveReq = activeReqId(this.meta.materialBatch);
        var freeByBatch = {};
        batches.forEach(function(b) { freeByBatch[String(b.id)] = Number(b.freeLinearM) || 0; });
        var ops = [];
        existing.forEach(function(e) { ops.push(function() { return self.post('_m_del/' + e.id + '?JSON', {}); }); });
        plan.allocations.forEach(function(a) {
            var fields = {};
            if (reqBatch) fields['t' + reqBatch] = a.batchId;
            if (reqM2) fields['t' + reqM2] = a.m2;
            ops.push(function() { return self.post('_m_new/' + meta.id + '?JSON&up=' + encodeURIComponent(cut.id), fields); });
            if (rawActiveReq && (Number(a.linearM) || 0) >= (freeByBatch[String(a.batchId)] || 0) - 1e-6) {
                ops.push(function() {
                    var activeFields = {};
                    activeFields['t' + rawActiveReq] = '0';
                    return self.post('_m_set/' + encodeURIComponent(a.batchId) + '?JSON', activeFields);
                });
            }
        });
        this.setBusy(true);
        return ops.reduce(function(p, op) { return p.then(op); }, Promise.resolve())
            .then(function() { return self.loadConsumption(); })
            .then(function() { return self.loadGenBatches(); })
            .then(function() {
                self.setBusy(false);
                self.notify(plan.fullyReserved
                    ? ('Зарезервировано сырьё: ' + plan.allocations.length + ' партий(и)')
                    : ('Не хватило сырья: дефицит ' + plan.shortfallLinearM + ' м'),
                    plan.fullyReserved ? 'success' : 'error');
                self.render();
            })
            .catch(function(err) { self.setBusy(false); self.notify('Ошибка резерва: ' + err.message, 'error'); });
    };

    // Полосы всех резок отчётом cut_strips (JSON_KV) → this.stripAgg
    // (карта cutId → {knifeCount, knifeWidths}). knifeCount/knifeWidths влиты в
    // дескриптор каждой резки в loadPlanning (колонка cut_knives отчёта cut_planning
    // удалена в F2 — knifeCount теперь считается клиентом из Полос).
    AtexProductionPlanning.prototype.loadCutStrips = function() {
        var self = this;
        return this.getJson('report/cut_strips?JSON_KV&LIMIT=0,5000').then(function(rows) {
            self.stripAgg = aggregateStrips(rows || []);
        });
    };

    // Метраж обеспечений: this.footageBySupply = { supplyId: «Метраж, м» }. Нужен для
    // длины прогона резки (макс по её обеспечениям) → длительность намотки (расписание).
    // cut_planning может отдавать supply_footage; object/ по «Обеспечение» остаётся
    // полным источником и мержится, потому загрузки идут параллельно.
    AtexProductionPlanning.prototype.loadSupplyFootage = function() {
        var self = this;
        var meta = this.meta.supply;
        if (!meta) { this.footageBySupply = this.footageBySupply || {}; return Promise.resolve(); }
        var footIdx = columnIndex(meta, SUPPLY_REQ.footage);
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            var map = self.footageBySupply || {};
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                var key = String(rec.i);
                var value = footIdx >= 0 ? (Number(r[footIdx]) || 0) : 0;
                if (value > 0 || stripNum(map[key]) <= 0) map[key] = value;
            });
            self.footageBySupply = map;
        });
    };

    // Прямые карты очередности и флага «Зафиксировано» из object/ «Задание в
    // производство». Нужны как источник истины после _m_set: отчёт cut_planning может
    // отставать/отдать старый alias и вовсе НЕ содержит «Зафиксировано» (#3508).
    // Возвращает { seq: { cutId: число|строка }, fixed: { cutId: bool } }.
    AtexProductionPlanning.prototype.loadCutSequences = function() {
        var meta = this.meta.cut;
        if (!meta) return Promise.resolve({ seq: {}, fixed: {} });
        var seqIdx = columnIndex(meta, CUT_REQ.sequence);
        var fixedIdx = columnIndex(meta, CUT_REQ.fixed);   // #3508
        if (seqIdx < 0 && fixedIdx < 0) return Promise.resolve({ seq: {}, fixed: {} });
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            var seq = {}, fixed = {};
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                var id = String(rec.i);
                if (seqIdx >= 0) {
                    var raw = r[seqIdx];
                    if (raw != null && String(raw).trim() !== '') {
                        var n = Number(raw);
                        seq[id] = isFinite(n) ? n : String(raw);
                    }
                }
                if (fixedIdx >= 0) fixed[id] = truthyFlag(r[fixedIdx]);   // #3508
            });
            return { seq: seq, fixed: fixed };
        });
    };

    // Ширина джамбо по виду сырья: this.jumboWidthByMaterial = { materialId: ширина }.
    // Таблица «Вид сырья» резолвится по имени из закешированного списка метаданных
    // (this._metaAll); ширина — поле «Ширина, мм» (columnIndex по имени). Ключ карты —
    // abn записи (r.i как String) = тот же id, что приходит в position_material_id /
    // cut_material_id. Нужна как jumboWidth для cut-layout.planLayouts (Task 3).
    AtexProductionPlanning.prototype.loadJumboWidths = function() {
        var self = this;
        var list = this._metaAll || [];
        var meta = tableByName(list, 'Вид сырья');
        if (!meta) { this.jumboWidthByMaterial = {}; this.nominalWidthByMaterial = {}; this.toleranceByMaterial = {}; return Promise.resolve(); }
        var widthIdx = columnIndex(meta, 'Ширина, мм');
        // #3686: «Номинальная ширина» — физический размер рулона (напр. 910). Именно с ней
        // сверяются условия j= справочника «Фактическая ширина резки», а НЕ с «Ширина, мм»
        // (полезная ширина реза после кромки, напр. 891) — иначе правило j=910 не срабатывает.
        var nomIdx = columnIndex(meta, 'Номинальная ширина');
        var tolIdx = columnIndex(meta, 'Допуск, мм');   // #3120: допуск по виду сырья (иначе дефолт)
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            var map = {}, nom = {}, tol = {}, names = {};
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                var w = widthIdx >= 0 ? (Number(r[widthIdx]) || 0) : 0;
                map[String(rec.i)] = w;
                // #3686: номинал для условий j=; нет колонки/значения → деградируем к «Ширина, мм»
                // (прежнее поведение), чтобы не потерять резолв у видов сырья без номинала.
                var nw = nomIdx >= 0 ? (Number(r[nomIdx]) || 0) : 0;
                nom[String(rec.i)] = nw > 0 ? nw : w;
                // сырое значение допуска (пустое — если не задано): resolveTolerance даст дефолт
                tol[String(rec.i)] = tolIdx >= 0 ? r[tolIdx] : '';
                names[String(rec.i)] = r[0] == null ? '' : String(r[0]);   // имя вида сырья (для подписи)
            });
            self.jumboWidthByMaterial = map;
            self.nominalWidthByMaterial = nom;   // #3686
            self.toleranceByMaterial = tol;
            self.materialNameById = names;
        });
    };

    // #3688/#3862: текущая заправка каждого станка из отчёта prev_cut_setup → this.prevSetupBySlitter
    // = { slitterId: { materialId, winding, knifeWidths, knifeCount } } по ПОСЛЕДНЕЙ задаче станка
    // СТРОГО ДО начала окна планирования. Нужна для переналадки ПЕРВОЙ резки очереди: если перед
    // планируемым днём на станке осталось другое сырьё/намотка/набор ножей (или ничего) — бронируем
    // настройку ножей и смену сырья; нет данных → firstCutSetup (ножи с нуля).
    //
    // #3862 (issue #3737): «предыдущая заправка» берётся из отчёта prev_cut_setup (report 93371)
    // с фильтрами FR_slitter_id={станок} и FR_task_start=<{планБаза} — ОДИН лёгкий запрос на
    // станок. Раньше тянули отчёт ЦЕЛИКОМ (LIMIT 5000, без фильтров) и брали «верхнюю по task_start»
    // на клиенте; но после генерации в отчёте уже лежат задачи ЭТОГО же нового плана (их task_start
    // в будущем), и «верхняя» оказывалась будущей задачей плана → ложная конфигурация → лишняя смена
    // сырья → окно первой резки 51 вместо 36 (расхождение карточки и модалки). Фильтр
    // task_start<планБаза эти задачи отсекает: остаётся только реальная заправка ДО дня.
    AtexProductionPlanning.prototype.loadPrevCutSetup = function() {
        var self = this;
        this.prevSetupBySlitter = {};
        var slitters = this.slitters || [];
        if (!slitters.length) return Promise.resolve();
        // База планирования (полночь дня «С» из фильтра, без него — сегодня), сек.
        var planBaseSec = Math.floor(Number(planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this))) / 1000);
        if (!isFinite(planBaseSec) || planBaseSec <= 0) return Promise.resolve();
        var map = {};
        return Promise.all(slitters.map(function(s) {
            var sid = String(s && s.id == null ? '' : s.id);
            if (sid === '') return Promise.resolve();
            // FR_task_start=%3C{планБаза} = task_start < планБаза (только задачи ДО планируемого дня).
            return self.getJson('report/prev_cut_setup?JSON_KV&FR_slitter_id=' + encodeURIComponent(sid) +
                    '&FR_task_start=%3C' + planBaseSec)
                .then(function(rows) {
                    // prevSetupFromRows берёт верхнюю по task_start = ПОСЛЕДНЮЮ задачу станка до дня.
                    var setup = prevSetupFromRows(rows, sid);
                    if (setup) map[sid] = setup;
                })
                .catch(function() { /* нет отчёта/данных по станку — без заправки (firstCutSetup) */ });
        })).then(function() { self.prevSetupBySlitter = map; });
    };

    // #3372: справочник «Фактическая ширина резки» → this.actualWidthIndex.
    // Таблица/колонки резолвятся по имени из _metaAll (схемоустойчиво при пересборке
    // БД). Главное значение записи (r[0]) — фактическая ширина; «Ширина в заказе» —
    // номинал; «Код» — условие применения. Нет таблицы/доступа → пустой индекс
    // (фича тихо деградирует к номиналу).
    AtexProductionPlanning.prototype.loadActualWidths = function() {
        var self = this;
        this.actualWidthIndex = {};
        var meta = tableByName(this._metaAll || [], 'Фактическая ширина резки');
        if (!meta) return Promise.resolve();
        var orderIdx = columnIndex(meta, 'Ширина в заказе');
        var codeIdx = columnIndex(meta, 'Код');
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            var list = (rows || []).map(function(rec) {
                var r = rec.r || [];
                return {
                    actual: r[0],
                    order: orderIdx >= 0 ? r[orderIdx] : null,
                    code: codeIdx >= 0 ? r[codeIdx] : ''
                };
            });
            self.actualWidthIndex = buildActualWidthIndex(list);
        }).catch(function() { self.actualWidthIndex = {}; });
    };

    // #3372: диаметр втулки в дюймах по id записи «Диаметр втулки» (8188 «Дюймы»)
    // → this.sleeveInchesById = { sleeveId: дюймы }. Контекст для условия 's=…'
    // фактической ширины. Нет колонки/доступа → пустая карта.
    AtexProductionPlanning.prototype.loadSleeveInches = function() {
        var self = this;
        this.sleeveInchesById = {};
        var meta = tableByName(this._metaAll || [], 'Диаметр втулки');
        if (!meta) return Promise.resolve();
        var inchIdx = columnIndex(meta, 'Дюймы');
        if (inchIdx < 0) return Promise.resolve();
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,2000').then(function(rows) {
            var map = {};
            (rows || []).forEach(function(rec) {
                var raw = (rec.r || [])[inchIdx];
                if (raw == null || String(raw).trim() === '') return;
                var n = Number(raw);
                if (isFinite(n)) map[String(rec.i)] = n;
            });
            self.sleeveInchesById = map;
        }).catch(function() { self.sleeveInchesById = {}; });
    };

    // #3812: ширина втулки в мм по id записи «Диаметр втулки» → this.sleeveWidthById =
    // { sleeveId: мм }. Источник: реквизит «Ширина втулки, мм» (если заведён), иначе
    // фолбэк — ширина из НАЗВАНИЯ записи («… ширина 110 мм», parseSleeveWidthFromName).
    // Контекст для втулочных полос (57 vs 110). Нет данных → запись без ширины (полосы
    // не добавляются; обратная совместимость).
    AtexProductionPlanning.prototype.loadSleeveWidths = function() {
        var self = this;
        this.sleeveWidthById = {};
        var meta = tableByName(this._metaAll || [], 'Диаметр втулки');
        if (!meta) return Promise.resolve();
        var wIdx = columnIndex(meta, 'Ширина втулки, мм');
        if (wIdx < 0) wIdx = columnIndex(meta, 'Ширина втулки');
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,2000').then(function(rows) {
            var map = {};
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                var raw = wIdx >= 0 ? r[wIdx] : null;
                var n = (raw != null && String(raw).trim() !== '') ? Number(raw) : NaN;
                if (!isFinite(n) || !(n > 0)) n = parseSleeveWidthFromName(r[0]); // r[0] — название записи
                if (isFinite(n) && n > 0) map[String(rec.i)] = Number(n);
            });
            self.sleeveWidthById = map;
        }).catch(function() { self.sleeveWidthById = {}; });
    };

    // #3372: проставить позициям фактическую ширину резки. Номинал заказа
    // сохраняется в orderWidth (для отображения), а width становится фактической —
    // её используют раскладка, полосы, Партии ГП и обеспечение (вся геометрия
    // раскроя). Идемпотентно: резолв всегда от orderWidth. Вызывается после загрузки
    // позиций, ширин джамбо и справочников 66190/8188.
    AtexProductionPlanning.prototype.annotatePositionsCutWidth = function() {
        var self = this;
        (this.genPositions || []).forEach(function(p) {
            if (p.orderWidth == null) p.orderWidth = p.width;   // номинал из заказа
            var ctx = {
                // #3686: условие j= сверяется с «Номинальной шириной» рулона, не с «Ширина, мм»
                jumbo: self.nominalWidthByMaterial ? self.nominalWidthByMaterial[String(p.materialId)] : null,
                inches: self.sleeveInchesById ? self.sleeveInchesById[String(p.sleeveId)] : null
            };
            p.width = resolveCutWidth(p.orderWidth, ctx, self.actualWidthIndex);
            // #3812: контекст втулки 0.5″ — производимость и план втулочных полос 110 мм.
            // Считаем по НОМИНАЛЬНОЙ ширине заказа (диапазоны 55–57/63–64 заданы в ней).
            p.sleeveInches = ctx.inches == null ? null : Number(ctx.inches);
            p.sleeveWidth = (self.sleeveWidthById && self.sleeveWidthById[String(p.sleeveId)] != null)
                ? Number(self.sleeveWidthById[String(p.sleeveId)]) : null;
            p.producible = isSleeveWidthProducible(p.sleeveInches, p.orderWidth);
            var corePlan = sleeveCoreStripPlan(p.sleeveInches, p.sleeveWidth, [p.orderWidth]);
            p.coreStripCount = corePlan.count;
            p.coreStripWidth = corePlan.count > 0 ? corePlan.stripWidth : 0;
        });
    };

    // #3340: партии втулок «в работе» из отчёта sleeve_batches_active (для FIFO-подбора
    // «Партии сырья» при создании «Задачи на втулки») + резолв id втулкореза TC-20.
    // → this.sleeveBatches = [{ id, diameterId, dateKey, remaining, active }].
    AtexProductionPlanning.prototype.loadSleeveBatches = function() {
        var self = this;
        var batches = this.getJson('report/sleeve_batches_active?JSON_KV&LIMIT=0,5000').then(function(rows) {
            self.sleeveBatches = (rows || []).map(function(row) {
                return {
                    id: row.batch_id == null ? '' : String(row.batch_id),
                    diameterId: row.sleeve_diameter_id == null ? '' : String(row.sleeve_diameter_id).trim(),
                    dateKey: Number(row.batch_date) || 0,
                    remaining: stripNum(row.remaining_m),
                    active: String(row.active == null ? '' : row.active).trim() !== ''
                };
            });
        }).catch(function() { self.sleeveBatches = []; });
        return Promise.all([batches, this.resolveSleeveCutterId()]);
    };

    // #3340: id втулкореза TC-20 — резолв по имени из ref-таблицы реквизита «Втулкорез»
    // задания (схемоустойчиво при пересборке БД). Не найден → '' (поле пропускается).
    AtexProductionPlanning.prototype.resolveSleeveCutterId = function() {
        var self = this;
        self.sleeveCutterId = '';
        var meta = this.meta.sleeveTask;
        if (!meta) return Promise.resolve();
        var cutterReq = reqByName(meta, SLEEVE_TASK_REQ.cutter);
        var refTable = cutterReq && cutterReq.ref;
        if (!refTable) return Promise.resolve();
        return this.getJson('object/' + refTable + '/?JSON_DATA&LIMIT=0,200').then(function(rows) {
            (rows || []).forEach(function(rec) {
                var name = String(((rec.r || [])[0]) == null ? '' : (rec.r || [])[0]).trim();
                if (name === SLEEVE_CUTTER_NAME) self.sleeveCutterId = String(rec.i);
            });
        }).catch(function() {});
    };

    // #3340: поля создаваемой «Задачи на втулки» (1080). Главное значение t1080 =
    // запланированный старт (Unix, как у резки); «Кол-во» = qty; «Втулкорез» = TC-20;
    // «Партия сырья» = FIFO-партия втулок по типу. Отсутствующие реквизиты/значения — пропуск.
    AtexProductionPlanning.prototype.buildSleeveTaskFields = function(reqIds, task, plannedStart) {
        var meta = this.meta.sleeveTask;
        var fields = {};
        if (reqIds.qty && task.qty) fields['t' + reqIds.qty] = task.qty;
        if (reqIds.cutter && this.sleeveCutterId) fields['t' + reqIds.cutter] = this.sleeveCutterId;
        var batchId = pickSleeveBatchId(this.sleeveBatches, task.sleeveId);
        if (reqIds.batch && batchId) fields['t' + reqIds.batch] = batchId;
        return addMainValueField(meta, fields, plannedStart);  // t1080 = запланированный старт
    };

    // #3340: id реквизитов задания на втулки (по именам реальной схемы). Нет таблицы → null.
    AtexProductionPlanning.prototype.sleeveTaskReqIds = function() {
        var meta = this.meta.sleeveTask;
        if (!meta) return null;
        return {
            cutter: reqIdByName(meta, SLEEVE_TASK_REQ.cutter),
            qty: reqIdByName(meta, SLEEVE_TASK_REQ.qty),
            batch: reqIdByName(meta, SLEEVE_TASK_REQ.batch)
        };
    };

    // Времена операций из таблицы «Время операции, мин» (13588) по кодам (колонка
    // «Код операции»; главное значение записи = минуты). this.opTimes = {КОД: мин},
    // this.changeTimes = веса переналадок для changeoverCost. Если таблицы/кодов нет —
    // changeTimes=null (changeoverCost берёт DEFAULT_OP_TIMES).
    AtexProductionPlanning.prototype.loadOperationTimes = function() {
        var self = this;
        var list = this._metaAll || [];
        var meta = tableByName(list, 'Время операции, мин');
        if (!meta) { this.opTimes = {}; this.changeTimes = null; return Promise.resolve(); }
        var codeIdx = columnIndex(meta, 'Код операции');
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,200').then(function(rows) {
            var raw = {};
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                var code = codeIdx >= 0 ? String(r[codeIdx] == null ? '' : r[codeIdx]).trim() : '';
                if (code) raw[code] = Number(r[0]) || 0;   // r[0] — главное значение = минуты
            });
            self.opTimes = raw;
            self.changeTimes = {
                MATERIAL_WINDING: raw.MATERIAL_WINDING != null ? raw.MATERIAL_WINDING : DEFAULT_OP_TIMES.MATERIAL_WINDING,
                KNIFE: Math.max(Number(raw.KNIFE_220_59) || 0, Number(raw.KNIFE_LE_59) || 0) || DEFAULT_OP_TIMES.KNIFE,
                // #3472: стоимость одного перемещения ножа (код «KNIFE_MOVE»); дефолт 2 мин.
                KNIFE_MOVE: raw.KNIFE_MOVE != null ? raw.KNIFE_MOVE : DEFAULT_OP_TIMES.KNIFE_MOVE,
                BETWEEN_CUTS: raw.BETWEEN_CUTS != null ? raw.BETWEEN_CUTS : DEFAULT_OP_TIMES.BETWEEN_CUTS,
                CLEANUP_SHIFT: raw.CLEANUP_SHIFT != null ? raw.CLEANUP_SHIFT : DEFAULT_OP_TIMES.CLEANUP_SHIFT
            };
            self.defaultToleranceMm = raw.DEFAULT_DEVIATION != null ? raw.DEFAULT_DEVIATION : DEFAULT_TOLERANCE_MM;
        });
    };

    // Допуск остатка для вида сырья: «Допуск, мм» из справочника, иначе DEFAULT_TOLERANCE_MM.
    AtexProductionPlanning.prototype.resolveToleranceMm = function(materialId) {
        var raw = this.toleranceByMaterial ? this.toleranceByMaterial[String(materialId)] : '';
        var def = (this.defaultToleranceMm != null) ? this.defaultToleranceMm : DEFAULT_TOLERANCE_MM;
        return resolveTolerance(raw, def);
    };

    // #3706: статус остатка джамбо резки относительно допуска — для цвета кнопки
    // «Полосы» в очереди. Тонкая обёртка над чистой planning.cutRemainderStatus:
    // джамбо — «Ширина, мм» вида сырья, допуск — resolveToleranceMm.
    AtexProductionPlanning.prototype.cutRemainderStatus = function(cut) {
        var jumbo = (this.jumboWidthByMaterial || {})[String(cut.materialId)];
        return planning.cutRemainderStatus(jumbo, cut.knifeWidths, this.resolveToleranceMm(cut.materialId));
    };

    // Ходовые ширины для сырья отчётом preferable_widths (JSON_KV, фильтр по сырью,
    // направлению и длине намотки).
    // → [{ width:Number(position_width_mm), popularity:Number(position_qty_sum) }];
    // кешируется в this.preferredByMaterial[materialId|windDir|windLength].
    // (Task 3/4 — генерация и панель ходовых). Возвращает Promise с массивом.
    AtexProductionPlanning.prototype.loadPreferredWidths = function(materialId, windDir, windLength) {
        var self = this;
        var mat = String(materialId == null ? '' : materialId).trim();
        var dir = normWinding(windDir);
        var lenKey = windLengthKey(windLength);
        var cacheKey = preferredWidthsKey(mat, dir, lenKey);
        if (mat === '') return Promise.resolve([]);
        if (this.preferredByMaterial[cacheKey]) return Promise.resolve(this.preferredByMaterial[cacheKey]);
        var params = ['JSON_KV', 'FR_position_material_id=' + encodeURIComponent(mat)];
        if (dir) params.push('FR_wind_dir=' + encodeURIComponent(dir));
        if (lenKey) params.push('FR_wind_length=' + encodeURIComponent(lenKey));
        console.log('[pp] 📏 loadPreferredWidths: запрос для сырья id=' + mat + ', намотка=' + dir + ', длина=' + lenKey + '...');
        return this.getJson('report/preferable_widths?' + params.join('&')).then(function(rows) {
            var list = (rows || []).filter(function(row) {
                return preferredWidthMatchesProfile(row, dir, lenKey);
            }).map(function(row) {
                return {
                    width: Number(row.position_width_mm) || 0,
                    popularity: Number(row.position_qty_sum) || 0
                };
            });
            self.preferredByMaterial[cacheKey] = list;
            console.log('[pp] 📏 loadPreferredWidths: для ключа ' + cacheKey + ' получено ширин:', list.length, list.slice(0,5));
            return list;
        });
    };

    AtexProductionPlanning.prototype.reportCutPlanningDiagnostics = function(rows) {
        var diagnostics = cutPlanningReportDiagnostics(rows);
        if (!diagnostics.length) {
            this._lastCutPlanningDiagnosticKey = '';
            return;
        }
        var columns = rows && rows[0] ? Object.keys(rows[0]).sort() : [];
        var key = diagnostics.map(function(d) { return d.key; }).join('|');
        if (typeof console !== 'undefined' && console.error) {
            console.error('[pp] ❌ cut_planning: не хватает данных отчёта — ' + cutWriteDiagnosticSummary(diagnostics), {
                diagnostics: diagnostics,
                columns: columns
            });
        }
        if (key !== this._lastCutPlanningDiagnosticKey) {
            this._lastCutPlanningDiagnosticKey = key;
            this.notify('Ошибка отчёта cut_planning: ' + diagnostics.map(function(d) {
                return d.label;
            }).join(', '), 'error');
        }
    };

    // Очередь резок и их обеспечение одним отчётом cut_planning (JSON_KV).
    // Заполняет this.cuts и this.supplies из плоских строк отчёта; вливает
    // knifeCount/knifeWidths из this.stripAgg (cut_strips) в каждую резку.
    AtexProductionPlanning.prototype.loadPlanning = function() {
        var self = this;
        console.log('[pp] 📅 loadPlanning: запрос cut_planning...');
        return Promise.all([
            this.getJson('report/cut_planning?JSON_KV&LIMIT=0,5000'),
            this.loadCutSequences()
        ]).then(function(results) {
            var rows = results[0];
            var seqResult = results[1] || {};
            var sequenceByCut = seqResult.seq || {};
            var fixedByCut = seqResult.fixed || {};   // #3508
            self.reportCutPlanningDiagnostics(rows || []);
            var p = rowsToPlanning(rows || []);
            var agg = self.stripAgg || {};
            p.cuts.forEach(function(cut) {
                var a = agg[String(cut.id)] || {};
                cut.knifeCount = a.knifeCount || 0;
                cut.knifeWidths = a.knifeWidths || [];
                if (Object.prototype.hasOwnProperty.call(sequenceByCut, String(cut.id))) {
                    cut.sequence = sequenceByCut[String(cut.id)];
                }
                cut.fixed = !!fixedByCut[String(cut.id)];   // #3508: флаг «Зафиксировано»
            });
            if (!self.footageBySupply) self.footageBySupply = {};
            p.supplies.forEach(function(supply) {
                var f = supplyFootage(supply, null);
                if (f > 0) self.footageBySupply[String(supply.id)] = f;
            });
            self.cuts = p.cuts;
            self.supplies = p.supplies;
            console.log('[pp] 📅 loadPlanning: загружено резок:', p.cuts.length, ', обеспечений:', p.supplies.length);
        });
    };

    // Применить материал из обеспечиваемых позиций к this.cuts (#3120 Фаза 2): приоритет —
    // демэнд (позиции, materialByCut); если у резки нет таких позиций — остаётся материал из
    // cut_planning (ссылка «Партия сырья» 1159 как fallback, пока она есть). Вызывать после
    // загрузки позиций и очереди.
    AtexProductionPlanning.prototype.resolveCutMaterials = function() {
        var self = this;
        if (!this.cuts) return;
        var byCut = materialByCut(this.cuts, this.supplies, this.genPositions);
        this.cuts.forEach(function(c) {
            var m = byCut[String(c.id)];
            if (m) {
                c.materialId = m;
                c.materialName = (self.materialNameById && self.materialNameById[m]) || c.materialName || '';
            }
        });
        // #3808: переходящие сегменты с пустым «Видом сырья» (обеспечения которых ведут на
        // НЕактивную позицию → materialByCut их не восстановил) лечим по цепочке станок|намотка|
        // ножи (см. healContinuationMaterials). После этого materialId согласован у всей цепочки,
        // поэтому continuationSignature снова объединяет сегменты, и applySplitPlan (#3795) при
        // ближайшем сохранении пропишет «Вид сырья» в БД (т.е. лечение и отображается, и
        // персистится).
        var healed = healContinuationMaterials(this.cuts);
        healed.forEach(function(id) {
            var c = self.cuts.filter(function(x) { return String(x.id) === String(id); })[0];
            if (c && !c.materialName) {
                c.materialName = (self.materialNameById && self.materialNameById[String(c.materialId)]) || c.materialName || '';
            }
        });
    };

    // Число привязок (обеспечений) к конкретной резке.
    AtexProductionPlanning.prototype.supplyCount = function(cutId) {
        return this.supplies.filter(function(s) { return String(s.cutId) === String(cutId); }).length;
    };

    // ── Запись ──

    // Создание производственной резки. Главное значение пишется как `t{tableId}` (#3225).
    AtexProductionPlanning.prototype.createCut = function() {
        var self = this;
        if (this.busy) return;
        var meta = this.meta.cut;
        var d = this.draft;
        console.log('[pp] 🔪 createCut: начало. станок=', d.slitterId, 'план.прогонов=', d.plannedRuns, 'статус=', d.status, 'выбрано позиций:', (d.selectedPositions||[]).length);
        if (!d.slitterId) { this.notify('Выберите станок', 'error'); return; }
        var selectedPositions = d.selectedPositions || [];
        var posById = positionMap(this.genPositions);
        var runLength = layoutRunLength({ positionsCovered: selectedPositions }, posById);

        // Стоп-лист станка: сырьё выбранной партии не должно быть запрещено на станке.
        if (d.materialBatchId) {
            var slit = this.slitters.filter(function(s) { return String(s.id) === String(d.slitterId); })[0];
            var matId = this.batchMaterialById && this.batchMaterialById[String(d.materialBatchId)];
            var stop = (slit && slit.stopMaterialIds) || [];
            if (matId && isMaterialBlocked(stop, matId)) {
                var batch = this.materialBatches.filter(function(b) { return String(b.id) === String(d.materialBatchId); })[0];
                this.notify('Сырьё «' + ((batch && batch.label) || matId) + '» запрещено на станке «' + ((slit && slit.label) || d.slitterId) + '»', 'error');
                return;
            }
        }

        var reqIds = {
            slitter: reqIdByName(meta, CUT_REQ.slitter),
            materialBatch: reqIdByName(meta, CUT_REQ.materialBatch),
            plannedRuns: reqIdByAnyName(meta, CUT_PLANNED_RUNS_NAMES),   // #3242: «Кол-во резок план»
            duration: reqIdByName(meta, CUT_REQ.duration),
            timing: reqIdByName(meta, CUT_REQ.timing),
            length: reqIdByName(meta, CUT_REQ.length),
            planDate: reqIdByName(meta, CUT_REQ.planDate),
            status: reqIdByName(meta, CUT_REQ.status),
            notes: reqIdByName(meta, CUT_REQ.notes),
            sequence: reqIdByName(meta, CUT_REQ.sequence)
        };
        var duration = plannedCutDurationMinutes(runLength, d.plannedRuns, this.opTimes, d.isFoil); // #3606
        var timing = cutTimingDetails(runLength, d.plannedRuns, this.opTimes, d.isFoil);
        var cutMainState = { last: this.lastCutMainValue };
        var cutMainValue = nextCutMainValue(this.cuts, controllerNowMs(this), cutMainState);
        this.lastCutMainValue = cutMainState.last;
        var fields = buildFields(reqIds, {
            slitter: d.slitterId,
            materialBatch: d.materialBatchId,
            plannedRuns: d.plannedRuns,
            duration: duration > 0 ? Math.ceil(duration) : '',   // #3635 п.4: «Длительность, минут» сохраняем целой (вверх)
            timing: timing,
            length: runLength > 0 ? runLength : '',
            planDate: d.planDate,
            status: d.status,
            notes: d.notes,
            sequence: nextSequenceForCuts(this.cuts, d.slitterId, d.planDate)
        });
        fields = addMainValueField(meta, fields, cutMainValue);
        var requiredWriteKeys = ['plannedRuns'];
        if (selectedPositions.length) {
            requiredWriteKeys = requiredWriteKeys.concat(['duration', 'timing', 'length']);
        }
        var payloadDiagnostics = traceCutCreatePayload('createCut', meta, reqIds, fields, this, requiredWriteKeys);
        if (payloadDiagnostics.length) {
            this.notify('Не могу создать производственное задание: ' + cutWriteDiagnosticSummary(payloadDiagnostics), 'error');
            return;
        }

        function finishCreatedCut(id) {
            if (!id) throw new Error('Сервер не вернул id нового задания');
            // #3242: «Обеспечение» теперь ссылается на «Партию ГП», которой в ручном
            // создании резки ещё нет (состав добавляется отдельно). Поэтому здесь
            // обеспечения НЕ создаём — иначе вышли бы «сироты» без ссылки. Привязка
            // позиций к резке идёт через генерацию/планирование (создаёт Партии ГП).
            // Ручная привязка к позициям — отдельная доработка (#3242 PR3).
            console.log('[pp] 🔪 createCut: резка #' + id + ' создана (без обеспечений; выбрано позиций: ' + selectedPositions.length + ')');
            return self.reload().then(function() {
                return self.persistCutSetupColumns();   // #3698: активности переналадки новой резки
            }).then(function() {
                self.setBusy(false);
                self.draft = self.blankDraft();
                self.selectedCutId = String(id);
                self.closeForm();
                self.notify('Производственное задание #' + id + ' создано' +
                    (selectedPositions.length ? ' (привязка позиций — через планирование)' : ''), 'success');
                self.render();
            });
        }

        this.setBusy(true);
        // up=1 — корневой объект; `t{tableId}` выше задаёт главное значение записи.
        this.post('_m_new/' + meta.id + '?JSON&up=1', fields).then(function(res) {
            return finishCreatedCut(res && (res.obj || res.id || res.i));
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка создания производственного задания: ' + err.message, 'error');
        });
    };

    // ── Резка под одну позицию заказа (форма «Новая производственная резка») ──
    // Строит план резки под выбранную позицию и ручное кол-во рулонов (≤ необеспеченного):
    // раскладка через cut-layout (как при планировании), Партии ГП по ширинам, обеспечение
    // на qty (излишек той же ширины → склад), ближайшее свободное окно станка.
    // → Promise<plan | { error }>. plan.forKey = positionId|qty|slitterId (для проверки актуальности).
    AtexProductionPlanning.prototype.buildCutProspect = function(positionId, qtyRaw) {
        var self = this;
        var layoutCore = (typeof window !== 'undefined' && window.AtexCutLayout && window.AtexCutLayout.layout) || null;
        if (!layoutCore) return Promise.resolve({ error: 'Модуль раскладки (cut-layout) не загружен' });
        var posById = positionMap(this.genPositions);
        var position = posById[String(positionId)];
        if (!position) return Promise.resolve({ error: 'Выберите позицию заказа' });
        var remaining = remainingRollsForPosition(position, this.supplies);
        var qty = Math.floor(Number(qtyRaw) || 0);
        if (!(qty > 0)) return Promise.resolve({ error: 'Укажите количество рулонов больше 0' });
        if (qty > remaining) return Promise.resolve({ error: 'Количество больше необеспеченного остатка (' + remaining + ' рул.)' });
        // #3812: втулка 0.5″ — риббон у́же 55 мм не производим.
        if (position.producible === false) return Promise.resolve({ error: 'Втулка 0.5″: риббон шириной < 55 мм не производится' });
        var mat = String(position.materialId == null ? '' : position.materialId);
        var jw = this.jumboWidthByMaterial[mat];
        if (!jw) return Promise.resolve({ error: 'Не задана ширина джамбо для сырья позиции' });
        // #3812: резерв ширины джамбо под втулочные полосы 110 мм (см. annotatePositionsCutWidth).
        var coreCount = position.coreStripCount || 0;
        var coreWidth = position.coreStripWidth || 0;
        var coreReserve = coreCount > 0 && coreWidth > 0 ? round3(coreCount * coreWidth) : 0;
        var effJumbo = round3(jw - coreReserve);
        if (coreReserve > 0 && !(effJumbo >= (Number(position.width) || 0))) {
            return Promise.resolve({ error: 'Втулка ' + coreWidth + ' мм: не хватает ширины джамбо под втулочные полосы' });
        }
        var profile = groupPositionsByPlanningProfile([position])[0] ||
            { key: '', windDir: position.windDir, windLength: position.windLength };
        return this.loadPreferredWidths(mat, profile.windDir, profile.windLength).then(function(preferred) {
            var res = layoutCore.planLayouts({
                jumboWidth: effJumbo,
                positions: [{ id: position.id, width: position.width, qty: qty, dueKey: position.dueKey }],
                preferred: preferred || self.preferredByMaterial[profile.key] || [],
                options: { windowDays: WINDOW_DAYS, tolerance: self.resolveToleranceMm(mat) }
            });
            var layouts = (res && res.layouts) || [];
            if (!layouts.length) return { error: 'Не удалось построить раскладку для позиции' };
            var lay = layouts[0];
            lay.mat = mat; lay.windDir = profile.windDir; lay.windLength = profile.windLength;
            if (coreReserve > 0) appendCoreStrip(lay, coreWidth, coreCount); // #3812: втулочные полосы в раскрой
            // posForCalc — единственная позиция с УРЕЗАННЫМ до qty кол-вом (для проходов/обеспечения).
            var posForCalc = [{ id: position.id, width: position.width, qty: qty, length: position.length,
                sleeveId: position.sleeveId, sleeveReady: position.sleeveReady, dueKey: position.dueKey }];
            var runLength = layoutRunLength(lay, posForCalc);
            var plannedRuns = plannedRunsForLayout(lay, posForCalc);
            var batches = producedBatchesForLayout(lay, runLength);
            var posWidthKey = stripWidthKey(position.width);
            var posBatch = batches.filter(function(b) { return stripWidthKey(b.width) === posWidthKey; })[0] || null;
            var stripsPerPass = posBatch ? (Number(posBatch.strips) || 0) : 0;
            var producedPosRolls = round3(stripsPerPass * plannedRuns);
            var sleeveTasks = positionSleeveTasksForLayout(lay, posForCalc, plannedRuns);
            // Ножи проспекта (для оценки переналадки в расписании) — ширины полос ×их количество.
            var knifeWidths = [];
            (lay.strips || []).forEach(function(s) {
                var w = Number(s.width) || 0, q = Math.round(Number(s.qty) || 0);
                for (var i = 0; i < q; i++) knifeWidths.push(w);
            });
            return {
                forKey: String(positionId) + '|' + qty,
                positionId: String(position.id), position: position, qty: qty,
                materialId: mat, layout: lay, plannedRuns: plannedRuns, runLength: runLength,
                duration: plannedCutDurationMinutes(runLength, plannedRuns, self.opTimes, position.isFoil), // #3606
                timing: cutTimingDetails(runLength, plannedRuns, self.opTimes, position.isFoil),
                batches: batches, posWidth: position.width, stripsPerPass: stripsPerPass,
                producedPosRolls: producedPosRolls, supplyRolls: qty,
                stockRolls: round3(Math.max(0, producedPosRolls - qty)),
                sleeveTasks: sleeveTasks, multiLayout: layouts.length > 1,
                // scheduleCut — объект-резка для расчёта свободного окна на любом станке.
                scheduleCut: { id: '__new__', plannedRuns: plannedRuns, materialId: mat,
                    winding: profile.windDir, knifeWidths: knifeWidths, runLength: runLength }
            };
        });
    };

    // Ближайшее свободное окно станка для проспект-резки (повтор расписания очереди).
    // → { windowStartMin, startMin, finishMin, durationMin, setupMin, day, startTs, planBaseMidnightMs } | null.
    AtexProductionPlanning.prototype.freeSlotForCut = function(slitterId, prospect) {
        var self = this;
        var windPoints = windingPointsFromTimes(this.opTimes || {});
        var dayWindow = this.workingWindow();
        var grp = groupBySlitter(this.cuts).filter(function(g) { return String(g.slitter.id) === String(slitterId); })[0];
        var stationCuts = grp ? grp.cuts : [];
        var runLenByCut = {};
        stationCuts.forEach(function(c) { runLenByCut[String(c.id)] = cutRunLength(c, self.supplies, self.footageBySupply); });
        var slot = freeSlotForQueue(stationCuts, prospect, {
            windPoints: windPoints, times: this.changeTimes, runLengthByCut: runLenByCut,
            shiftStartMin: dayWindow.startMin, shiftEndMin: dayWindow.cutEndMin,
            lunchStartMin: dayWindow.lunchStartMin, lunchDurationMin: dayWindow.lunchDurationMin,
            firstCutSetup: true   // #3669 п.2: очередь учитывает настройку ножей первой задачи
        });
        if (!slot) return null;
        // День 0 = дата планирования из фильтра (.atex-pp-input), даже если в прошлом;
        // без даты — сегодня. Как в генерации (#3311), ре-планировании (#3312), очереди (#3316).
        var planBaseMidnightMs = planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this));
        slot.startTs = scheduleStartTimestamp(planBaseMidnightMs, slot.windowStartMin);
        slot.planBaseMidnightMs = planBaseMidnightMs;
        return slot;
    };

    // Гарантирует актуальный draft.prospect под текущие позицию+кол-во (асинхронно),
    // затем перерисовывает форму. Идемпотентна: не пересчитывает, если результат для тех
    // же параметров уже есть (в т.ч. ошибка) или расчёт уже идёт (_computingProspect).
    AtexProductionPlanning.prototype.refreshCutProspect = function() {
        var self = this, d = this.draft;
        var key = String(d.positionId) + '|' + (Math.floor(Number(d.qty) || 0));
        if (this._computingProspect === key) return;
        if (d.prospect && d.prospect.forKey === key) return;
        this._computingProspect = key;
        this.buildCutProspect(d.positionId, d.qty).then(function(pr) {
            self._computingProspect = null;
            if (pr && !pr.forKey) pr.forKey = key;   // пометить и ошибочный результат (не зациклить)
            d.prospect = pr;
            self.renderForm();
        }).catch(function(err) {
            self._computingProspect = null;
            d.prospect = { error: err.message, forKey: key };
            self.renderForm();
        });
    };

    // «Создать резку»: по выбранным позиции/кол-ву/станку создаёт резку → Партии ГП →
    // втулки → обеспечение (на qty рулонов; излишек той же ширины и прочие полосы — склад).
    // Время старта = свободное окно выбранного станка. Раскладку при необходимости пересчитывает.
    AtexProductionPlanning.prototype.createCutForPosition = function() {
        var self = this, d = this.draft;
        if (this.busy) return;
        if (!d.slitterId) { this.notify('Выберите станок', 'error'); return; }
        var cutMeta = this.meta.cut, fbMeta = this.meta.finishedBatch, supplyMeta = this.meta.supply;
        if (!cutMeta || !fbMeta || !supplyMeta) { this.notify('Нет метаданных таблиц задания/Партии ГП/Обеспечения', 'error'); return; }
        var key = String(d.positionId) + '|' + (Math.floor(Number(d.qty) || 0));
        var ensure = (d.prospect && !d.prospect.error && d.prospect.forKey === key)
            ? Promise.resolve(d.prospect)
            : this.buildCutProspect(d.positionId, d.qty);
        this.setBusy(true);
        ensure.then(function(plan) {
            if (!plan || plan.error) { self.setBusy(false); self.notify((plan && plan.error) || 'Не удалось рассчитать раскладку', 'error'); return null; }
            if (!plan.forKey) plan.forKey = key;
            d.prospect = plan;
            var slit = self.slitters.filter(function(s) { return String(s.id) === String(d.slitterId); })[0];
            if (slit && isMaterialBlocked(slit.stopMaterialIds || [], plan.materialId)) {
                self.setBusy(false); self.notify('Сырьё позиции запрещено на выбранном станке', 'error'); return null;
            }
            var slot = self.freeSlotForCut(d.slitterId, plan.scheduleCut);
            var planDayTs = slot && slot.startTs > 0 ? String(slot.startTs) : '';
            // #3569: лидер берём из покрываемой позиции (метку резолвим в id справочника).
            var leaderPos = (self.genPositions || []).filter(function(p) { return String(p.id) === String(d.positionId); })[0];
            var cutReqIds = {
                slitter: reqIdByName(cutMeta, CUT_REQ.slitter),
                plannedRuns: reqIdByAnyName(cutMeta, CUT_PLANNED_RUNS_NAMES),
                duration: reqIdByName(cutMeta, CUT_REQ.duration),
                timing: reqIdByName(cutMeta, CUT_REQ.timing),
                length: reqIdByName(cutMeta, CUT_REQ.length),
                winding: reqIdByName(cutMeta, CUT_REQ.winding),
                leader: reqIdByName(cutMeta, CUT_REQ.leader),   // #3569: ссылка «Лидер» (82519)
                material: reqIdByName(cutMeta, CUT_REQ.material), // #3688: ссылка «Вид сырья» (95358)
                active: activeReqId(cutMeta),
                notes: reqIdByName(cutMeta, CUT_REQ.notes),
                sequence: reqIdByName(cutMeta, CUT_REQ.sequence)
            };
            var cutMainState = { last: self.lastCutMainValue };
            var cutMainValue = (slot && slot.startTs > 0) ? slot.startTs : nextCutMainValue(self.cuts, controllerNowMs(self), cutMainState);
            self.lastCutMainValue = cutMainState.last;
            var fields = buildFields(cutReqIds, {
                slitter: d.slitterId,
                plannedRuns: plan.plannedRuns,
                duration: plan.duration > 0 ? Math.ceil(plan.duration) : '',   // #3635 п.4: «Длительность, минут» — целой (вверх)
                timing: plan.timing,
                length: plan.runLength > 0 ? plan.runLength : '',
                winding: normWinding(plan.layout && plan.layout.windDir),
                leader: self.resolveLeaderId(leaderPos && leaderPos.leader), // #3569: лидер позиции → id
                material: plan.materialId,   // #3688: «Вид сырья» проспект-резки
                active: (d.active === false) ? '0' : '1',
                notes: d.notes,
                sequence: nextSequenceForCuts(self.cuts, d.slitterId, planDayTs)
            });
            fields = addMainValueField(cutMeta, fields, cutMainValue);

            var sleeveMeta = self.meta.sleeveTask;
            var sleeveReqIds = self.sleeveTaskReqIds();

            return self.post('_m_new/' + cutMeta.id + '?JSON&up=1', fields).then(function(res) {
                var cutId = res && (res.obj || res.id || res.i);
                if (!cutId) throw new Error('Сервер не вернул id нового задания');
                var widthToBatchId = {};
                var chain = Promise.resolve();
                // 1) Партии ГП по ширинам (состав резки).
                plan.batches.forEach(function(b) {
                    chain = chain.then(function() {
                        // #3431/#3433: «Кол-во полос» = полос за проход (b.strips); «Кол-во
                        // план» = полосы × проходов; «Кол-во рулонов» = спрос: для ширины
                        // позиции — её рулоны (plan.qty) под этот заказ, прочие ширины (добор
                        // ходовыми) — в запас (спрос/заказ пусто).
                        var isPosWidth = stripWidthKey(b.width) === stripWidthKey(plan.posWidth);
                        var f = buildFinishedBatchFields(fbMeta, { width: b.width, strips: b.strips,
                            planned: finishedBatchRolls(b.strips, plan.plannedRuns),
                            rolls: isPosWidth && plan.qty > 0 ? plan.qty : '',
                            orderId: isPosWidth ? (plan.position && plan.position.orderId) || '' : '',
                            footage: b.length > 0 ? b.length : '', active: '1' });
                        return self.post('_m_new/' + fbMeta.id + '?JSON&up=' + encodeURIComponent(cutId), f).then(function(r) {
                            var bid = r && (r.obj || r.id || r.i);
                            if (bid) widthToBatchId[stripWidthKey(b.width)] = String(bid);
                        });
                    });
                });
                // 2) Задания на втулки (#3340: если таблица есть). Запланированный старт
                //    задания = плановое время старта резки (cutMainValue).
                if (sleeveMeta && sleeveReqIds) {
                    plan.sleeveTasks.forEach(function(task) {
                        chain = chain.then(function() {
                            var f = self.buildSleeveTaskFields(sleeveReqIds, task, cutMainValue);
                            return self.post('_m_new/' + sleeveMeta.id + '?JSON&up=' + encodeURIComponent(task.positionId), f);
                        });
                    });
                }
                // 3) Обеспечение позиции на qty рулонов (ссылается на Партию ГП ширины позиции).
                chain = chain.then(function() {
                    var batchId = widthToBatchId[stripWidthKey(plan.posWidth)];
                    if (!batchId) throw new Error('Не создана «Партия ГП» ширины позиции — обеспечение пропущено');
                    var f = buildSupplyFieldsForFinishedBatch(supplyMeta, {
                        finishedBatchId: batchId, rolls: plan.qty,
                        footage: plan.position.length > 0 ? plan.position.length : '',
                        active: '1', status: SUPPLY_STATUSES[0]
                    });
                    return self.post('_m_new/' + supplyMeta.id + '?JSON&up=' + encodeURIComponent(plan.positionId), f);
                });
                return chain.then(function() { return cutId; });
            }).then(function(cutId) {
                return self.reload().then(function() {
                    return self.persistCutSetupColumns();   // #3698: активности переналадки новой резки
                }).then(function() {
                    self.setBusy(false);
                    self.draft = self.blankDraft();
                    self.selectedCutId = String(cutId);
                    self.closeForm();
                    self.notify('Производственное задание #' + cutId + ' создано, позиция обеспечена (' + plan.qty + ' рул.)', 'success');
                    self.render();
                });
            });
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка создания производственного задания: ' + err.message, 'error');
        });
    };

    // Привязка самостоятельной резки к позиции заказа через «Обеспечение».
    AtexProductionPlanning.prototype.createSupply = function(opts) {
        var self = this;
        if (this.busy) return;
        var meta = this.meta.supply;
        if (!opts.positionId) { this.notify('Выберите позицию заказа', 'error'); return; }
        if (!opts.cutId) { this.notify('Не выбрано производственное задание', 'error'); return; }

        // #3242: «Обеспечение» теперь ссылается на «Партию ГП», а не на резку. Ручная
        // привязка «позиция → резка» без выбора конкретной Партии ГП создала бы
        // «сироту» без ссылки — поэтому временно заблокирована до доработки UI (#3242 PR3).
        if (!opts.finishedBatchId) {
            this.notify('Ручная привязка к производственному заданию временно недоступна: обеспечение теперь ссылается на «Партию ГП». Используйте планирование.', 'error');
            return;
        }
        var fields = buildSupplyFieldsForFinishedBatch(meta, {
            footage: opts.footage,
            finishedBatchId: opts.finishedBatchId,
            rolls: opts.rolls,
            active: opts.active === undefined ? '1' : (truthyFlag(opts.active) ? '1' : '0'),
            status: opts.status || SUPPLY_STATUSES[0]
        });

        this.setBusy(true);
        this.post('_m_new/' + meta.id + '?JSON&up=' + encodeURIComponent(opts.positionId), fields).then(function(res) {
            var id = res && (res.obj || res.id || res.i);
            if (!id) throw new Error('Сервер не вернул id обеспечения');
            return self.loadPlanning().then(function() {
                self.setBusy(false);
                self.notify('Обеспечение создано: позиция связана с производственным заданием', 'success');
                self.render();
            });
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка привязки: ' + err.message, 'error');
        });
    };

    // Удалить связь резки с позицией (#3116 п.4): удаляем запись «Обеспечения»
    // по клику «×» (без подтверждения — решение по задаче) и перечитываем очередь.
    AtexProductionPlanning.prototype.deleteSupply = function(supplyId) {
        var self = this;
        if (this.busy || !supplyId) return;
        this.setBusy(true);
        this.post('_m_del/' + encodeURIComponent(supplyId) + '?JSON', {}).then(function() {
            return self.loadPlanning().then(function() {
                self.setBusy(false);
                self.notify('Связь с позицией удалена', 'info');
                self.render();
                // #3318 п.2: если открыт редактор полос — переоткрыть, чтобы «Назначение»
                // полосы обновилось (Заказ→Склад) и удаление снова стало доступным.
                self.reopenStripsIfOpen();
            });
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка удаления связи: ' + err.message, 'error');
        });
    };

    // #3508 п.2/п.4: проставить/снять флаг «Зафиксировано» у набора заданий. Пишем булев
    // реквизит (t{id}='1'/'0') командой _m_set, затем перечитываем очередь — серая кайма/
    // блокировки (п.3/п.5) обновятся по источнику истины. #3562: плановый старт при фиксации
    // больше не «захватывается» — автогенерация вольна двигать задание по времени и очереди.
    AtexProductionPlanning.prototype.setCutsFixed = function(cutIds, value, opts) {
        var self = this;
        var o = opts || {};
        if (this.busy) return Promise.resolve(false);
        var ids = (cutIds || []).map(function(x) { return String(x); })
            .filter(function(id) { return id && id !== 'null'; });
        if (!ids.length) {
            if (!o.silent) self.notify(o.emptyMessage || 'Нет заданий для фиксации', 'info');
            return Promise.resolve(false);
        }
        var fixedReqId = reqIdByName(this.meta.cut, CUT_REQ.fixed);
        if (!fixedReqId) {
            self.notify('Реквизит «' + CUT_REQ.fixed + '» не найден в метаданных', 'error');
            return Promise.resolve(false);
        }
        var fieldKey = 't' + fixedReqId;
        var flag = value ? '1' : '0';
        // #3778: при ФИКСАЦИИ снимаем тайминг (Наладка ножей / Сырье-намотка / Резка и Лидер) в
        // запись тем же _m_set, что и флаг. Раньше «Зафиксировать» писала ТОЛЬКО флаг, и у
        // вручную созданных/зафиксированных заданий три поля оставались пустыми — гант пересчитывал
        // их на лету. Считаем те же значения и в том же порядке, что план на экране
        // (computeCutSetupUpdates), но пишем только для фиксируемых id. При снятии фиксации не трогаем.
        var setupRes = value ? self.computeCutSetupUpdates(ids) : { reqs: {}, updates: [] };
        var setupById = {};
        setupRes.updates.forEach(function(u) { setupById[String(u.cutId)] = u; });
        this.setBusy(true);
        this.showProgress((value ? 'Фиксация' : 'Снятие фиксации') + ' заданий…', ids.length);
        var done = 0;
        var chain = Promise.resolve();
        ids.forEach(function(id) {
            chain = chain.then(function() {
                var fields = {}; fields[fieldKey] = flag;
                var u = setupById[String(id)];   // #3778: дополняем флаг снимком тайминга
                if (u) {
                    var tf = setupTimingFields(setupRes.reqs, u);
                    Object.keys(tf).forEach(function(k) { fields[k] = tf[k]; });
                }
                return self.post('_m_set/' + encodeURIComponent(id) + '?JSON', fields)
                    .then(function() { self.updateProgress(++done); });
            });
        });
        return chain.then(function() {
            return self.reload();
        }).then(function() {
            self.hideProgress(); self.setBusy(false); self.render();
            if (!o.silent) {
                self.notify(o.successMessage ||
                    ((value ? 'Зафиксировано заданий: ' : 'Снята фиксация заданий: ') + ids.length), 'success');
            }
            return true;
        }).catch(function(err) {
            self.hideProgress(); self.setBusy(false);
            self.reload().then(function() { self.render(); }).catch(function() {});
            self.notify('Ошибка фиксации заданий: ' + (err && err.message || err), 'error');
            return false;
        });
    };

    // #3508 п.2: «Зафиксировать» — проставить флаг всем заданиям выбранного дня (все
    // станки). День берём из фильтра «Дата плана». Уже зафиксированные не трогаем.
    AtexProductionPlanning.prototype.fixDayTasks = function() {
        var self = this;
        if (this.busy) return;
        var fromStr = String(this.filter && this.filter.date || '').trim();
        if (fromStr === '') {
            this.notify('Выберите «Дату плана», чтобы зафиксировать задания дня', 'error');
            return;
        }
        var toStr = String(this.filter && this.filter.dateTo || '').trim();
        if (toStr === '') toStr = fromStr;
        // #3622: фиксируем задания всего ВИДИМОГО диапазона [С; По], а не одного дня (как и
        // удаление). Незавершённые/датированные — тот же набор, что в очереди (isCutVisible).
        var dayCuts = (this.cuts || []).filter(function(c) {
            return c && String(c.planDate || '').trim() !== '' && isCutVisible(c, fromStr, toStr);
        });
        var toFix = dayCuts.filter(function(c) { return !c.fixed; });
        var dateLabel = formatPlanDayRangeLabel(fromStr, toStr);
        if (!dayCuts.length) { this.notify('Нет заданий за ' + dateLabel + ' для фиксации', 'info'); return; }
        if (!toFix.length) { this.notify('Все задания за ' + dateLabel + ' уже зафиксированы', 'info'); return; }
        self.setCutsFixed(toFix.map(function(c) { return c.id; }), true, {
            successMessage: 'Зафиксированы задания за ' + dateLabel + ': ' + toFix.length
        });
    };

    // #3783/#3785: «Упорядочить» — пересобрать очередь видимого диапазона в оптимальный
    // порядок. Тот же autoSequenceQueue, но preserveOrder=false → реально пересобирает
    // (минимум переналадок группирует сырьё/набор ножей; при прочих равных больше полос
    // раньше). Перезаписывает ручные перестановки оператора (#3449), поэтому с подтверждением.
    // #3792: зафиксированные задания остаются на своих днях (не переносятся/не разбиваются) —
    // тот же замок на день, что и при генерации.
    AtexProductionPlanning.prototype.optimizeQueue = function(actionsEl) {
        var self = this;
        if (this.busy) return;
        if (!(this.cuts && this.cuts.length)) { this.notify('Нет заданий для упорядочивания', 'info'); return; }
        var host = actionsEl || (this.root && this.root.querySelector('.atex-pp-panel-actions'));
        var oldBar = host && host.querySelector && host.querySelector('.atex-pp-confirm-bar');
        if (oldBar && oldBar.parentNode) oldBar.parentNode.removeChild(oldBar);
        var msg = el('span', { class: 'atex-pp-confirm-msg', text:
            'Пересобрать очередь в оптимальный порядок: группировка по сырью (минимум переналадок), ' +
            'при прочих равных — больше полос раньше. Ручные перестановки заменятся; ' +
            'зафиксированные задания останутся на своих днях (#3792).' });
        this.confirmAction(msg, host, [
            { label: 'Упорядочить', inline: true, onConfirm: function() { self.runOptimizeQueue(); } }
        ]);
    };

    AtexProductionPlanning.prototype.runOptimizeQueue = function() {
        var self = this;
        if (this.busy) return;
        this.setBusy(true);
        this.autoSequenceQueue(PLANNING_STRATEGY_SETUP, false).then(function(changed) {
            self.setBusy(false);
            self.notify(changed ? 'Очередь упорядочена (минимум переналадок)' : 'Очередь уже оптимальна', 'success');
        }).catch(function(err) {
            self.setBusy(false);
            console.error('[pp] ⚙️ optimizeQueue: ОШИБКА', err && err.message, err && err.stack);
            self.notify('Ошибка упорядочивания: ' + (err && err.message ? err.message : err), 'error');
        });
    };

    // #3508 п.4: иконка «🔒» в карточке — переключить фиксацию одного задания
    // (зафиксировано ↔ снято), чтобы можно было и поставить, и снять флаг.
    AtexProductionPlanning.prototype.toggleCutFixed = function(cut) {
        if (!cut) return;
        var o = { successMessage: (cut.fixed ? 'Снята фиксация задания' : 'Задание зафиксировано') };
        this.setCutsFixed([cut.id], !cut.fixed, o);
    };

    // #3602: кнопка «🗓» (между «🔒» и «🗑») — модалка переноса задания на другой день.
    // #3631: день выбирается ПРОИЗВОЛЬНО (input type=date), а не из ограниченного списка
    // дней расписания. По умолчанию подставляем текущий день задания (иначе дату фильтра /
    // сегодня). Ещё спрашиваем положение «в начало/в конец дня» и галку «Зафиксировать»
    // (по умолчанию установлена).
    AtexProductionPlanning.prototype.openMoveCut = function(cut) {
        var self = this;
        if (!cut) return;
        if (!this.meta.cut) { this.notify('Нет метаданных таблицы «' + TABLE.cut + '»', 'error'); return; }

        // Значение по умолчанию — текущий день задания (по хранимой «Дате план»).
        var pd = String(cut.planDate == null ? '' : cut.planDate).trim();
        var defISO = '';
        if (/^\d{9,13}$/.test(pd)) { var n = Number(pd); defISO = isoDateFromMs(n >= 1e12 ? n : n * 1000); }
        else if (/^\d{4}-\d{2}-\d{2}/.test(pd)) { defISO = pd.slice(0, 10); }
        if (!defISO) defISO = String(this.filter && this.filter.date || '').trim() || todayISO();

        var dialog = el('div', { class: 'atex-pp-modal-dialog atex-pp-move-dialog' });
        var overlay = el('div', { class: 'atex-pp-modal atex-pp-move-modal is-open' }, [dialog]);
        function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
        overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
        var closeX = el('button', { class: 'atex-pp-modal-close', type: 'button', text: '×', title: 'Закрыть' });
        closeX.addEventListener('click', close);
        dialog.appendChild(closeX);

        var content = el('div', { class: 'atex-pp-move-content' });
        dialog.appendChild(content);
        content.appendChild(el('h2', { class: 'atex-pp-form-title', text: 'Перенести задание на другой день' }));
        content.appendChild(el('p', { class: 'atex-pp-hint',
            text: 'Задание № ' + (formatCutNumber(cut.number) || cut.id) + ' · ' +
                (cut.materialName || (cut.materialId ? '#' + cut.materialId : '—')) }));

        // #3631: произвольный день — обычный календарный input type=date (без ограничений).
        var dayInput = el('input', { type: 'date', class: 'atex-pp-input atex-pp-move-day', value: defISO });
        content.appendChild(el('label', { class: 'atex-pp-move-field' }, [
            el('span', { class: 'atex-pp-move-label', text: 'День' }), dayInput
        ]));

        // #3669 п.1: опционально — другой станок (по умолчанию текущий). Список из справочника;
        // если справочник пуст, селектор не показываем (станок не меняем).
        var curSid = String(cut.slitter && cut.slitter.id != null ? cut.slitter.id : '');
        var slitSelect = null;
        if ((this.slitters || []).length) {
            slitSelect = el('select', { class: 'atex-pp-input atex-pp-move-slitter', title: 'Станок' });
            this.slitters.forEach(function(s) {
                var opt = el('option', { value: String(s.id), text: s.label || ('#' + s.id) });
                if (String(s.id) === curSid) opt.setAttribute('selected', 'selected');
                slitSelect.appendChild(opt);
            });
            slitSelect.value = curSid;
            content.appendChild(el('label', { class: 'atex-pp-move-field' }, [
                el('span', { class: 'atex-pp-move-label', text: 'Станок' }), slitSelect
            ]));
        }

        // Положение в дне: в начало / в конец.
        var posStart = el('input', { type: 'radio', name: 'atex-pp-move-pos' });
        posStart.value = 'start'; posStart.checked = true;
        var posEnd = el('input', { type: 'radio', name: 'atex-pp-move-pos' });
        posEnd.value = 'end';
        content.appendChild(el('div', { class: 'atex-pp-move-field' }, [
            el('span', { class: 'atex-pp-move-label', text: 'Положение' }),
            el('div', { class: 'atex-pp-move-pos' }, [
                el('label', { class: 'atex-pp-move-radio' }, [posStart, el('span', { text: ' В начало дня' })]),
                el('label', { class: 'atex-pp-move-radio' }, [posEnd, el('span', { text: ' В конец дня' })])
            ])
        ]));

        // Зафиксировать — по умолчанию установлена.
        var fixCb = el('input', { type: 'checkbox' });
        fixCb.checked = true;
        content.appendChild(el('label', { class: 'atex-pp-move-fix' }, [
            fixCb, el('span', { text: ' Зафиксировать задание' })
        ]));

        var actions = el('div', { class: 'atex-pp-supply-actions' });
        var cancel = el('button', { class: 'atex-pp-btn', type: 'button', text: 'Отмена' });
        cancel.addEventListener('click', close);
        var ok = el('button', { class: 'atex-pp-btn atex-pp-btn-primary', type: 'button', text: 'Перенести' });
        ok.addEventListener('click', function() {
            if (self.busy) return;
            var dateStr = String(dayInput.value || '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { self.notify('Выберите день для переноса', 'error'); return; }
            var position = posEnd.checked ? 'end' : 'start';
            var fix = !!fixCb.checked;
            var targetSlitterId = slitSelect ? String(slitSelect.value || '') : '';   // #3669 п.1
            // #3876: целевой станок в отпуске в выбранный день — не переносим (станок без сырья
            // и ножей). Сообщаем, диалог не закрываем — пользователь меняет день/станок.
            var targetSid = targetSlitterId !== '' ? targetSlitterId
                : String(cut.slitter && cut.slitter.id != null ? cut.slitter.id : '');
            var targetMid = planBaseMidnightFrom(dateStr, controllerNowMs(self));
            if (targetSid !== '' && self.slitterOnVacationDay(targetSid, targetMid)) {
                var sl = (self.slitters || []).filter(function(s) { return String(s.id) === targetSid; })[0];
                self.notify('Станок ' + ((sl && sl.label) || ('#' + targetSid)) + ' в отпуске в этот день — перенос невозможен', 'error');
                return;
            }
            close();
            self.moveCutToDay(cut, dateStr, position, fix, targetSlitterId);
        });
        actions.appendChild(cancel);
        actions.appendChild(ok);
        content.appendChild(actions);

        this.root.appendChild(overlay);
    };

    // #3602/#3631: применить перенос на ПРОИЗВОЛЬНЫЙ день targetDateStr («ГГГГ-ММ-ДД»).
    // Перемещаемому заданию пишем «Дату план» (главное значение — DATETIME-колонка →
    // _m_save с t{tableId}, как в applySplitPlan; _m_set её НЕ задаёт, issue #775) на 08:00
    // целевого дня и «Очередность» в начало/конец дня, а прочим заданиям дня — пересчитанную
    // «Очередность» (только изменившиеся). Фиксация (если отмечена) пишется тем же _m_set.
    // Если цель вне фильтра [С; По] — расширяем диапазон (в нужную сторону), чтобы
    // перенесённое задание не исчезло из очереди. Перенос двигает и зафиксированные.
    AtexProductionPlanning.prototype.moveCutToDay = function(cut, targetDateStr, position, fix, targetSlitterId) {
        var self = this;
        if (this.busy) return Promise.resolve(false);
        if (!cut) return Promise.resolve(false);
        var cutMeta = this.meta.cut;
        if (!cutMeta) { this.notify('Нет метаданных таблицы «' + TABLE.cut + '»', 'error'); return Promise.resolve(false); }
        var seqReqId = reqIdByName(cutMeta, CUT_REQ.sequence);
        var fixedReqId = reqIdByName(cutMeta, CUT_REQ.fixed);
        var slitterReqId = reqIdByName(cutMeta, CUT_REQ.slitter);   // #3669 п.1: ссылка «Слиттер»
        var mainKey = cutMeta.id != null ? 't' + cutMeta.id : null;
        if (!seqReqId || !mainKey) {
            this.notify('Не найдены реквизиты резки («' + CUT_REQ.sequence + '»/дата)', 'error');
            return Promise.resolve(false);
        }
        var dateStr = String(targetDateStr || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { this.notify('Выберите день для переноса', 'error'); return Promise.resolve(false); }

        var win = this.workingWindow();
        var shiftStartMin = Number(win && win.startMin) || 0;
        var targetMidnightMs = planBaseMidnightFrom(dateStr, controllerNowMs(this));   // полночь целевого дня
        var targetTs = Math.floor(targetMidnightMs / 1000) + shiftStartMin * 60;       // 08:00 целевого дня
        var targetDayKey = planDateDayKey(targetTs);
        var dateLabel = formatPlanDayHeading(targetMidnightMs, 0);

        // #3669 п.1: целевой станок — выбранный в диалоге (по умолчанию текущий). Очередь и
        // соседи для пересчёта «Очередности» берём на станке-ПОЛУЧАТЕЛЕ; смену станка пишем
        // ссылкой «Слиттер» на самом задании (старый станок пересобирать не нужно — пропуск в
        // его «Очередности» безвреден, пересчитывается при следующей генерации).
        var curSidStr = String(cut.slitter && cut.slitter.id != null ? cut.slitter.id : '');
        var targetSidStr = String(targetSlitterId == null ? '' : targetSlitterId).trim();
        var sidStr = targetSidStr !== '' ? targetSidStr : curSidStr;
        var slitterChanged = !!slitterReqId && sidStr !== '' && sidStr !== curSidStr;
        // #3876: не переносить задание на станок, у которого в целевой день отпуск (станок без
        // сырья и ножей). Авторитетная проверка (диалог уже проверяет — но метод вызываем и иначе).
        if (sidStr !== '' && this.slitterOnVacationDay(sidStr, targetMidnightMs)) {
            var slv = (this.slitters || []).filter(function(s) { return String(s.id) === sidStr; })[0];
            this.notify('Станок ' + ((slv && slv.label) || ('#' + sidStr)) + ' в отпуске на ' + dateLabel + ' — перенос невозможен', 'error');
            return Promise.resolve(false);
        }
        // Задания станка-получателя на целевом дне (по хранимой «Дате план»), без перемещаемого.
        var dayCuts = (this.cuts || []).filter(function(c) {
            if (!c || String(c.id) === String(cut.id)) return false;
            var csid = c.slitter && c.slitter.id;
            if (String(csid == null ? '' : csid) !== sidStr) return false;
            return planDateDayKey(c.planDate) === targetDayKey;
        });
        var plan = planMoveSequences(cut.id, dayCuts, position);
        var seqByCut = plan.seqByCut;

        this.setBusy(true);
        this.showProgress('Перенос задания…', 1 + dayCuts.length);
        var done = 0;
        var fixFieldKey = (fix && fixedReqId) ? 't' + fixedReqId : null;
        var chain = Promise.resolve();
        // 1) Перемещаемое задание: «Дата план» (главное значение) → _m_save, затем
        //    «Очередность» (+ фиксация) → _m_set.
        chain = chain.then(function() {
            var mainFields = {}; mainFields[mainKey] = String(targetTs);
            return self.post('_m_save/' + encodeURIComponent(cut.id) + '?JSON', mainFields);
        }).then(function() {
            var fields = {};
            fields['t' + seqReqId] = String(seqByCut[String(cut.id)] || 1);
            if (fixFieldKey) fields[fixFieldKey] = '1';
            if (slitterChanged) fields['t' + slitterReqId] = sidStr;   // #3669 п.1: смена станка
            return self.post('_m_set/' + encodeURIComponent(cut.id) + '?JSON', fields);
        }).then(function() { self.updateProgress(++done); });
        // 2) Прочие задания целевого дня — пересчитанная «Очередность» (только изменившиеся).
        dayCuts.forEach(function(c) {
            var newSeq = seqByCut[String(c.id)];
            chain = chain.then(function() {
                if (Number(c.sequence) === Number(newSeq)) { self.updateProgress(++done); return; }
                var fields = {}; fields['t' + seqReqId] = String(newSeq);
                return self.post('_m_set/' + encodeURIComponent(c.id) + '?JSON', fields)
                    .then(function() { self.updateProgress(++done); });
            });
        });

        return chain.then(function() {
            return self.reload();
        }).then(function() {
            // Цель вне фильтра [С; По] → расширяем диапазон в нужную сторону, чтобы
            // перенесённое задание осталось видимым в очереди (пустой край не ограничивает).
            // Делаем ДО пересчёта (autoSequenceQueue ниже): и день-источник, и целевой день
            // должны попасть в scope перепланирования [С; По].
            var fromStr = String(self.filter && self.filter.date || '').trim();
            var toStr = String(self.filter && self.filter.dateTo || '').trim();
            if (fromStr !== '' && planDateDayKey(fromStr) > targetDayKey) self.filter.date = dateStr;
            if (toStr !== '' && planDateDayKey(toStr) < targetDayKey) self.filter.dateTo = dateStr;
            self.hideProgress(); self.setBusy(false); self.render();
            // #3669 п.1: если станок сменился — называем его в сообщении.
            var slitLabel = '';
            if (slitterChanged) {
                var ts = (self.slitters || []).filter(function(s) { return String(s.id) === sidStr; })[0];
                slitLabel = ' · станок ' + ((ts && ts.label) || ('#' + sidStr));
            }
            self.notify('Задание перенесено на ' + dateLabel +
                (position === 'end' ? ' (в конец дня)' : ' (в начало дня)') + slitLabel, 'success');
            // #3840: перенос менял «Дату план»/«Очередность» только переносимого задания и
            // целевого дня — день-ИСТОЧНИК оставался с прежним сохранённым planStart, и на месте
            // вынутой (срочной) резки висел простой (РМ «Диаграмма Ганта» рисует сохранённый
            // planStart). Пересобираем ВРЕМЯ старта затронутых дней, СОХРАНЯЯ ручной порядок
            // (preserveOrder, #3619): gapFill пакует встык → дыра схлопывается, фольга остаётся
            // в конце дня (#3717), замки зафиксированных (#3792) не нарушаются. autoSequenceQueue
            // пишет planStart/«Очередность» только изменившимся (идемпотентно, #3427) и сам делает
            // persistCutSetupColumns + reload/render — поэтому отдельный persistCutSetupColumns выше
            // убран. Терминальный шаг — как после генерации (runGenerateCuts).
            return self.autoSequenceQueue(PLANNING_STRATEGY_SETUP, true);
        }).catch(function(err) {
            self.hideProgress(); self.setBusy(false);
            self.reload().then(function() { self.render(); }).catch(function() {});
            self.notify('Ошибка переноса задания: ' + (err && err.message || err), 'error');
            return false;
        });
    };

    // #3475: «Удалить» — снести все задания выбранного дня. Показывает подтверждение
    // (сколько резок/обеспечений будет удалено), затем зовёт runDeleteDayTasks. День —
    // «Дата плана» из фильтра (this.filter.date); без даты удалять нечего (неоднозначно).
    AtexProductionPlanning.prototype.deleteDayTasks = function(actionsEl) {
        var self = this;
        if (this.busy) return;
        var dateStr = String(this.filter && this.filter.date || '').trim();
        if (dateStr === '') {
            this.notify('Выберите «Дату плана», чтобы удалить задания дня', 'error');
            return;
        }
        var targets = dayDeletionTargets(this.cuts, this.supplies, this.filter.date, this.filter.dateTo);
        var dateLabel = formatPlanDayRangeLabel(this.filter.date, this.filter.dateTo);
        if (!targets.cuts.length) {
            this.notify('Нет заданий за ' + dateLabel + ' для удаления', 'info');
            return;
        }
        // Снять прежнюю плашку подтверждения (генерации/удаления), если висит.
        var host = actionsEl || (this.root && this.root.querySelector('.atex-pp-panel-actions'));
        var oldBar = host && host.querySelector && host.querySelector('.atex-pp-confirm-bar');
        if (oldBar && oldBar.parentNode) oldBar.parentNode.removeChild(oldBar);

        var msg = el('span', { class: 'atex-pp-confirm-msg', text:
            'Удалить все задания за ' + dateLabel + '? Будет удалено: заданий — ' + targets.cuts.length +
            ', обеспечений — ' + targets.supplies.length + '. Действие необратимо.' });
        this.confirmAction(msg, host, [
            { label: 'Удалить', warning: true, inline: true, onConfirm: function() {
                self.runDeleteDayTasks(targets.cuts, targets.supplies, dateLabel);
            } }
        ]);
    };

    // #3475: последовательное удаление заданий дня. Порядок принципиален: сперва все
    // «Обеспечение» (они ссылаются на «Партии ГП» — подчинённые резки; пока ссылки живы,
    // _m_del резки вернёт 409, см. DeleteTreeRefsCount в index.php), затем сами резки —
    // backend каскадом (BatchDelete) сносит подчинённые Партии ГП/Полосы/Расход сырья.
    AtexProductionPlanning.prototype.runDeleteDayTasks = function(cuts, supplies, dateLabel) {
        var self = this;
        if (this.busy) return;
        var supplyIds = (supplies || []).map(function(s) { return String(s.id); })
            .filter(function(id) { return id && id !== 'null'; });
        var cutIds = (cuts || []).map(function(c) { return String(c.id); })
            .filter(function(id) { return id && id !== 'null'; });
        var total = supplyIds.length + cutIds.length;
        if (!total) { this.notify('Нечего удалять', 'info'); return; }

        this.setBusy(true);
        this.showProgress('Удаление заданий за ' + dateLabel + '…', total);
        var done = 0;
        function del(id) {
            return self.post('_m_del/' + encodeURIComponent(id) + '?JSON', {}).then(function() {
                self.updateProgress(++done);
            });
        }
        // Цепочка: сначала обеспечения, потом резки (см. комментарий выше).
        var chain = Promise.resolve();
        supplyIds.forEach(function(id) { chain = chain.then(function() { return del(id); }); });
        cutIds.forEach(function(id) { chain = chain.then(function() { return del(id); }); });

        chain.then(function() {
            return self.reload();
        }).then(function() {
            self.hideProgress();
            self.setBusy(false);
            self.selectedCutId = null;   // панель «Связанные позиции» больше не на удалённую резку
            self.render();
            self.notify('Удалены задания за ' + dateLabel + ': резок — ' + cutIds.length +
                ', обеспечений — ' + supplyIds.length, 'success');
        }).catch(function(err) {
            self.hideProgress();
            self.setBusy(false);
            // Часть записей могла удалиться — перечитываем очередь, чтобы UI не врал.
            self.reload().then(function() { self.render(); }).catch(function() {});
            self.notify('Ошибка удаления заданий дня: ' + (err && err.message || err), 'error');
        });
    };

    // #3486: подпись резки для подтверждения/тоста удаления. Берём сырьё и плановую
    // дату (если есть), иначе — id. Без обращения к сети.
    function cutTaskLabel(cut) {
        if (!cut) return '';
        var name = String(cut.materialName || '').trim();
        var day = formatPlanDayLabel(String(cut.planDate || '').trim());
        if (name && day) return name + ' · ' + day;
        return name || day || ('#' + cut.id);
    }

    // #3691: id всех «Обеспечений» резки — из УЖЕ ЗАГРУЖЕННЫХ this.supplies (cut_planning),
    // НЕ из отчёта 81463 (cut→fulfillment). Они ссылаются на «Партии ГП» резки; пока ссылки
    // живы, _m_del резки вернёт 409 (DeleteTreeRefsCount в index.php), поэтому удалять их нужно
    // ДО самой резки. Отчёт 81463 оказался ненадёжным (зависел от совпадения дат резки/Партии
    // ГП/Обеспечения и возвращал пусто) → резка падала на 409. Promise — для совместимости с
    // вызовом deleteCutTask (асинхронный контракт сохраняем).
    AtexProductionPlanning.prototype.loadCutFulfillments = function(cutId) {
        return Promise.resolve(cutFulfillmentIds(this.supplies || [], cutId));
    };

    // #3486: кнопка «🗑» в карточке резки. Сначала собираем id «Обеспечений» резки
    // (#3691: из this.supplies), показываем подтверждение с их числом, по согласию — удаляем.
    AtexProductionPlanning.prototype.deleteCutTask = function(cut, cardEl) {
        var self = this;
        if (this.busy || !cut) return;
        var cutId = String(cut.id);
        var label = cutTaskLabel(cut);
        this.setBusy(true);
        this.loadCutFulfillments(cutId).then(function(fulfillmentIds) {
            self.setBusy(false);
            var msg = el('span', { class: 'atex-pp-confirm-msg', text:
                'Удалить задание «' + label + '»? Будет удалено обеспечений — ' +
                fulfillmentIds.length + '. Действие необратимо.' });
            self.confirmAction(msg, cardEl, [
                { label: 'Удалить', warning: true, onConfirm: function() {
                    self.runDeleteCutTask(cutId, fulfillmentIds, label);
                } }
            ]);
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Не удалось получить обеспечения резки: ' + (err && err.message || err), 'error');
        });
    };

    // #3486: удаление одной резки. Порядок как у заданий дня (#3475): сперва все
    // «Обеспечение» (снимаем ссылки на «Партии ГП»), затем сама «Производственная
    // резка» — backend каскадом (BatchDelete) сносит подчинённые Партии ГП/Полосы/Расход.
    AtexProductionPlanning.prototype.runDeleteCutTask = function(cutId, fulfillmentIds, label) {
        var self = this;
        if (this.busy) return;
        var ids = (fulfillmentIds || []).map(function(x) { return String(x); })
            .filter(function(id) { return id && id !== 'null'; });
        var total = ids.length + 1;   // обеспечения + сама резка

        this.setBusy(true);
        this.showProgress('Удаление задания «' + label + '»…', total);
        var done = 0;
        function del(id) {
            return self.post('_m_del/' + encodeURIComponent(id) + '?JSON', {}).then(function() {
                self.updateProgress(++done);
            });
        }
        // Цепочка: сначала обеспечения, потом резка (см. комментарий выше).
        var chain = Promise.resolve();
        ids.forEach(function(id) { chain = chain.then(function() { return del(id); }); });
        chain = chain.then(function() { return del(cutId); });

        chain.then(function() {
            return self.reload();
        }).then(function() {
            self.hideProgress();
            self.setBusy(false);
            if (String(self.selectedCutId) === String(cutId)) self.selectedCutId = null;
            self.render();
            self.notify('Задание удалено: обеспечений — ' + ids.length, 'success');
            // #3840: удаление резки из середины дня оставляло простой на её месте — прочие резки
            // дня сохраняли прежний planStart (РМ «Диаграмма Ганта» рисует сохранённый planStart).
            // Пересобираем время старта дня, СОХРАНЯЯ порядок (preserveOrder, #3619): gapFill
            // пакует встык, дыра схлопывается. autoSequenceQueue сам пишет изменившееся
            // (planStart/«Очередность») + persistCutSetupColumns + reload/render. Терминальный
            // шаг — как после генерации (runGenerateCuts) и переноса (moveCutToDay).
            return self.autoSequenceQueue(PLANNING_STRATEGY_SETUP, true);
        }).catch(function(err) {
            self.hideProgress();
            self.setBusy(false);
            // Часть записей могла удалиться — перечитываем очередь, чтобы UI не врал.
            self.reload().then(function() { self.render(); }).catch(function() {});
            self.notify('Ошибка удаления задания: ' + (err && err.message || err), 'error');
        });
    };

    // #3318: после изменения связей переоткрыть панель полос (если была открыта) для
    // той же резки — render() пересобирает очередь и панель теряется; открываем заново
    // с обновлёнными данными (orderedBatchIds → «Назначение» полосы и доступность удаления).
    AtexProductionPlanning.prototype.reopenStripsIfOpen = function() {
        var editId = this.stripEditCutId;
        if (editId == null) return;
        var cut = (this.cuts || []).filter(function(c) { return String(c.id) === String(editId); })[0];
        var cardPanel = this.queueEl && this.queueEl.querySelector('.atex-pp-cut[data-cut-id="' + editId + '"]');
        this.stripEditCutId = null;   // сбросить, чтобы openStrips открыл, а не закрыл (toggle)
        if (cut && cardPanel) this.openStrips(cut, cardPanel);
    };

    // #3320: модалка «Обеспечить полосу». Перечисляет все необеспеченные позиции заказа
    // (в т.ч. частично обеспеченные — остаток > 0) для привязки к складской полосе через
    // «Обеспечение». Кол-во рулонов = рулоны полосы (Кол-во полос × проходов), но не больше
    // 110% от необеспеченного остатка позиции. Перед созданием — небольшое подтверждение.
    AtexProductionPlanning.prototype.openStripSupplyPicker = function(cut, strip, passes) {
        var self = this;
        if (!this.meta.supply) { this.notify('Нет метаданных таблицы «Обеспечение»', 'error'); return; }
        if (strip.id == null) { this.notify('Сначала сохраните полосу (нужна «Партия ГП»)', 'error'); return; }

        var stripRolls = round3((stripNum(strip.qty) || 0) * (stripNum(passes) > 0 ? stripNum(passes) : 1));
        var stripWidth = String(strip.width || '').trim() || '—';

        var posLabelById = {};
        (this.positions || []).forEach(function(p) { posLabelById[String(p.id)] = p.label; });
        var candidates = (this.genPositions || []).map(function(p) {
            var remaining = remainingRollsForPosition(p, self.supplies);
            return {
                id: String(p.id), position: p, remaining: remaining,
                rolls: stripSupplyRolls(stripRolls, remaining),
                label: posLabelById[String(p.id)] || ('Сырьё#' + (p.materialId || '?') + ' · ' + ((p.orderWidth != null ? p.orderWidth : p.width) || '?') + ' мм')
            };
        }).filter(function(c) { return c.remaining > 0 && c.rolls > 0; });
        candidates.sort(function(a, b) { return a.label < b.label ? -1 : a.label > b.label ? 1 : 0; });

        var dialog = el('div', { class: 'atex-pp-modal-dialog atex-pp-supply-dialog' });
        var overlay = el('div', { class: 'atex-pp-modal atex-pp-supply-modal is-open' }, [dialog]);
        function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
        overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
        var closeX = el('button', { class: 'atex-pp-modal-close', type: 'button', text: '×', title: 'Закрыть' });
        closeX.addEventListener('click', close);
        dialog.appendChild(closeX);
        var content = el('div', { class: 'atex-pp-supply-content' });
        dialog.appendChild(content);

        function confirmRow(label, value) {
            return el('div', { class: 'atex-pp-supply-confirm-row' }, [
                el('span', { class: 'atex-pp-supply-confirm-label', text: label }),
                el('span', { class: 'atex-pp-supply-confirm-value', text: String(value) })
            ]);
        }

        function renderList() {
            content.innerHTML = '';
            content.appendChild(el('h2', { class: 'atex-pp-form-title', text: 'Обеспечить полосу' }));
            content.appendChild(el('p', { class: 'atex-pp-hint',
                text: 'Полоса ' + stripWidth + ' мм · ' + round3(stripRolls) + ' рул. Выберите необеспеченную позицию заказа для привязки через «Обеспечение».' }));
            if (!candidates.length) {
                content.appendChild(el('p', { class: 'atex-pp-hint', text: 'Нет необеспеченных позиций заказа.' }));
                return;
            }
            var list = el('div', { class: 'atex-pp-supply-list' });
            candidates.forEach(function(c) {
                var item = el('button', { class: 'atex-pp-supply-item', type: 'button' }, [
                    el('span', { class: 'atex-pp-supply-item-label', text: c.label }),
                    el('span', { class: 'atex-pp-supply-item-meta',
                        text: 'ост. ' + round3(c.remaining) + ' рул. → ' + round3(c.rolls) + ' рул.' })
                ]);
                item.addEventListener('click', function() { renderConfirm(c); });
                list.appendChild(item);
            });
            content.appendChild(list);
        }

        function renderConfirm(c) {
            content.innerHTML = '';
            content.appendChild(el('h2', { class: 'atex-pp-form-title', text: 'Создать обеспечение?' }));
            var capped = round3(c.rolls) < round3(stripRolls);
            content.appendChild(el('div', { class: 'atex-pp-supply-confirm' }, [
                confirmRow('Позиция', c.label),
                confirmRow('Полоса', stripWidth + ' мм'),
                confirmRow('Рулонов полосы', round3(stripRolls)),
                confirmRow('Необеспеченный остаток', round3(c.remaining) + ' рул.'),
                confirmRow('Будет создано', round3(c.rolls) + ' рул.' + (capped ? ' (ограничено 110% остатка)' : ''))
            ]));
            var actions = el('div', { class: 'atex-pp-supply-actions' });
            var back = el('button', { class: 'atex-pp-btn', type: 'button', text: 'Назад' });
            back.addEventListener('click', renderList);
            var ok = el('button', { class: 'atex-pp-btn atex-pp-btn-primary', type: 'button', text: 'Создать обеспечение' });
            ok.addEventListener('click', function() {
                close();
                self.createStripSupply(strip, c, round3(c.rolls));
            });
            actions.appendChild(back);
            actions.appendChild(ok);
            content.appendChild(actions);
        }

        this.root.appendChild(overlay);
        renderList();
    };

    // #3320: создать запись «Обеспечения», привязав позицию заказа к складской полосе
    // (Партии ГП). После записи перечитывает план и переоткрывает редактор полос, чтобы
    // «Назначение» полосы обновилось (Склад → Заказ).
    AtexProductionPlanning.prototype.createStripSupply = function(strip, candidate, rolls) {
        var self = this;
        if (this.busy) return Promise.resolve();
        var meta = this.meta.supply;
        if (!meta) { this.notify('Нет метаданных таблицы «Обеспечение»', 'error'); return Promise.resolve(); }
        if (!strip || strip.id == null) { this.notify('Полоса не сохранена (нет «Партии ГП»)', 'error'); return Promise.resolve(); }
        if (!candidate || !candidate.id) { this.notify('Не выбрана позиция заказа', 'error'); return Promise.resolve(); }
        if (!(stripNum(rolls) > 0)) { this.notify('Нечего обеспечивать (0 рулонов)', 'error'); return Promise.resolve(); }
        var pos = candidate.position || {};
        var fields = buildSupplyFieldsForFinishedBatch(meta, {
            finishedBatchId: strip.id,
            rolls: rolls,
            footage: stripNum(pos.length) > 0 ? pos.length : '',
            active: '1',
            status: SUPPLY_STATUSES[0]
        });
        this.setBusy(true);
        return this.post('_m_new/' + meta.id + '?JSON&up=' + encodeURIComponent(candidate.id), fields).then(function(res) {
            var id = res && (res.obj || res.id || res.i);
            if (!id) throw new Error('Сервер не вернул id обеспечения');
            return self.loadPlanning();
        }).then(function() {
            self.setBusy(false);
            self.notify('Обеспечение создано: позиция привязана к полосе (' + round3(rolls) + ' рул.)', 'success');
            self.render();
            self.reopenStripsIfOpen();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка создания обеспечения: ' + err.message, 'error');
        });
    };

    AtexProductionPlanning.prototype.reload = function() {
        var self = this;
        // Полосы перечитываем перед очередью, чтобы knifeCount/knifeWidths влились в свежие резки.
        return this.loadCutStrips().then(function() { return self.loadPlanning(); })
            .then(function() { return self.loadSleeveBatches(); }) // #3340: обновляем партии втулок (FIFO)
            .then(function() { self.resolveCutMaterials(); });
    };

    // ── Встроенный редактор Полос резки (база cut-calc renderStrips/computeSummary/syncStrips) ──

    var STRIP_PURPOSES = ['Заказ', 'Склад', 'Отходы'];

    // Загрузка состава резки из «Партии ГП» (#3242; подчинённые: F_U = cutId).
    // Колонки JSON_OBJ резолвятся по имени. → [{id, width, qty=полос за проход}].
    // #3431: число полос берём из «Кол-во полос»; для старых записей (колонка пустая) —
    // фолбэк на «Кол-во рулонов» (раньше там хранилось число полос за проход).
    AtexProductionPlanning.prototype.loadStripsForCut = function(cutId) {
        var sm = this.meta.finishedBatch;
        var widthIdx = columnIndex(sm, FINISHED_BATCH_REQ.width);
        var stripsIdx = columnIndex(sm, FINISHED_BATCH_REQ.strips);
        var rollsIdx = columnIndex(sm, FINISHED_BATCH_REQ.rolls);
        var orderIdx = columnIndex(sm, FINISHED_BATCH_REQ.orderId);
        return this.getJson('object/' + sm.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(cutId) + '&LIMIT=0,500').then(function(rows) {
            return (rows || []).map(function(rec) {
                var r = rec.r || [];
                var stripsVal = (stripsIdx >= 0 && r[stripsIdx] != null) ? String(r[stripsIdx]) : '';
                var rollsVal = (rollsIdx >= 0 && r[rollsIdx] != null) ? String(r[rollsIdx]) : '';
                return {
                    id: String(rec.i),
                    width: (widthIdx >= 0 && r[widthIdx] != null) ? String(r[widthIdx]) : '',
                    qty: String(stripsVal).trim() !== '' ? stripsVal : rollsVal,
                    // #3433: «ID заказа» — копируется в записи-продолжения при дроблении по дням.
                    orderId: (orderIdx >= 0 && r[orderIdx] != null) ? String(r[orderIdx]) : ''
                };
            });
        });
    };

    // Открыть инлайн-панель редактора полос для резки. container — очередь (this.queueEl).
    // Одна панель за раз: повторный клик по той же резке закрывает; по другой — переключает.
    AtexProductionPlanning.prototype.openStrips = function(cut, container) {
        var self = this;
        if (!this.meta.finishedBatch) { this.notify('Не найдены метаданные таблицы «' + TABLE.finishedBatch + '»', 'error'); return; }

        // Удалить существующую панель (если открыта).
        var existing = container.querySelector('.atex-pp-strip-panel');
        var wasSame = existing && String(existing.getAttribute('data-cut-id')) === String(cut.id);
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        if (wasSame) { this.stripEditCutId = null; return; } // повторный клик — закрыть
        this.stripEditCutId = String(cut.id);

        var panel = el('div', { class: 'atex-pp-strip-panel', dataset: { cutId: String(cut.id) } });
        // #3326: любой клик внутри панели полос не должен её сворачивать — закрытие
        // только по .atex-pp-strip-close. Карточка резки (.atex-pp-cut) на клик делает
        // render() и пересобирает очередь, теряя панель; её обработчик пропускает клики,
        // чьё e.target.closest('.atex-pp-strip-panel') == panel. Но внутренние контролы
        // (удалить полосу, ходовая ширина, …) в своём обработчике вызывают renderRows()/
        // renderPreferred() и отцепляют нажатый узел — closest на нём даёт null, и клик
        // всё равно сворачивал панель (#3318 чинил так лишь кнопку удаления). Панель —
        // предок всех контролов в пути всплытия, поэтому stopPropagation здесь надёжно
        // гасит клик до карточки независимо от того, отцепился ли e.target.
        panel.addEventListener('click', function(e) {
            e.stopPropagation();
            // #3406 п.2: клик по панели полос выбирает её резку и обновляет
            // «Связанные позиции» справа (renderLink), не пересобирая очередь —
            // правки полос/обеспечения сразу отражаются без перезагрузки.
            self.selectCut(cut.id);
        });
        panel.appendChild(el('div', { class: 'atex-pp-strip-loading', text: 'Загрузка полос…' }));
        container.appendChild(panel);

        this.loadStripsForCut(cut.id).then(function(loaded) {
            // Если за время загрузки панель закрыли/переключили — ничего не рисуем.
            if (String(self.stripEditCutId) !== String(cut.id) || !panel.parentNode) return;
            // Глубокая копия исходного состава для диффа при сохранении (#3242: Партия ГП).
            var original = loaded.map(function(s) { return { id: s.id, width: s.width, qty: s.qty }; });
            var strips = loaded.map(function(s) { return { id: s.id, width: s.width, qty: s.qty }; });
            self.renderStripPanel(panel, cut, strips, original);
            if (cut.fixed) self.lockStripPanel(panel);   // #3508 п.3: зафиксированное — только просмотр
        }).catch(function(err) {
            if (panel.parentNode) {
                panel.innerHTML = '';
                panel.appendChild(el('div', { class: 'atex-pp-empty', text: 'Ошибка загрузки полос: ' + err.message }));
            }
        });
    };

    // #3508 п.3: панель полос зафиксированного задания — только просмотр. Глушим все
    // инпуты/кнопки, кроме крестика закрытия, и показываем пометку. Изменения состава
    // невозможны (как и удаление/перепланирование/смена очередности зафиксированного).
    AtexProductionPlanning.prototype.lockStripPanel = function(panel) {
        if (!panel) return;
        panel.classList.add('is-readonly');
        var nodes = panel.querySelectorAll('input, select, textarea, button');
        Array.prototype.forEach.call(nodes, function(n) {
            if (n.classList && n.classList.contains('atex-pp-strip-close')) return;
            n.disabled = true;
        });
        var note = el('div', { class: 'atex-pp-strip-locked-note', text: '🔒 Задание зафиксировано — изменение полос недоступно' });
        var header = panel.querySelector('.atex-pp-strip-header');
        if (header && header.parentNode) header.parentNode.insertBefore(note, header.nextSibling);
        else panel.appendChild(note);
    };

    // Рендер содержимого панели редактора полос (таблица + сводка + ходовые + кнопки).
    AtexProductionPlanning.prototype.renderStripPanel = function(panel, cut, strips, original) {
        var self = this;
        var jumbo = Number(this.jumboWidthByMaterial[String(cut.materialId)]) || 0;
        var prefWidths = [];   // загруженные ходовые ширины (#3128, фильтруются по остатку)
        panel.innerHTML = '';

        // Заголовок: сырьё + ширина джамбо, справа — иконка закрытия (#3127).
        var matLabel = (cut.materialBatch && cut.materialBatch.label) || cut.materialName || cut.materialId || '—';
        var closeIcon = el('button', { class: 'atex-pp-strip-close', type: 'button', title: 'Закрыть', text: '×' });
        closeIcon.addEventListener('click', function() {
            self.stripEditCutId = null;
            if (panel.parentNode) panel.parentNode.removeChild(panel);
        });
        panel.appendChild(el('div', { class: 'atex-pp-strip-header' }, [
            el('span', { class: 'atex-pp-strip-header-text', text: 'Сырьё: ' + matLabel + ', Джамбо: ' + (jumbo || '—') + ' мм' }),
            closeIcon
        ]));

        // Таблица полос.
        var table = el('div', { class: 'atex-pp-strip-table' });
        // #3253: редактируем «Кол-во полос» (за проход); «Рулонов» (полос × проходов) —
        // справочно, read-only. Геометрия (Занято/Остаток/Ножи) считается по полосам.
        var passes = stripNum(cut.plannedRuns) > 0 ? stripNum(cut.plannedRuns) : 1;
        // #3280: «Назначение» полосы — Заказ (на эту Партию ГП есть ссылка из Обеспечения)
        // или Склад (ссылки нет). Набор id Партий ГП, на которые ссылается Обеспечение.
        var orderedBatchIds = {};
        (self.supplies || []).forEach(function(s) {
            var b = s && s.finishedBatchId;
            if (b != null && String(b) !== '') orderedBatchIds[String(b)] = true;
        });
        table.appendChild(el('div', { class: 'atex-pp-strip-row atex-pp-strip-head' }, [
            el('span', { text: 'Ширина, мм' }),
            el('span', { text: 'Кол-во полос' }),
            el('span', { text: 'Рулонов (×' + passes + ')' }),
            el('span', { text: 'Назначение' }),
            el('span', { text: '' })
        ]));
        var body = el('div', { class: 'atex-pp-strip-body' });
        table.appendChild(body);
        panel.appendChild(table);

        var summaryEl = el('div', { class: 'atex-pp-strip-summary' });
        panel.appendChild(summaryEl);

        function recalc() {
            var used = planning.stripsUsedWidth(strips);
            var knives = planning.stripsTotalKnives(strips);
            // Живо обновить количество полос на кнопке «Полосы» этой карточки и в
            // дескрипторе резки, чтобы метка совпадала с редактором без перезагрузки (#3147).
            cut.knifeCount = knives;
            var card = panel.parentNode;
            var stripsBtn = card && card.querySelector('.atex-pp-strips');
            if (stripsBtn) stripsBtn.textContent = stripsButtonLabel(knives);
            summaryEl.innerHTML = '';
            // «Итого ножей» = число полос + 1 (крайний нож): N полос режутся N+1 ножом.
            // knives здесь — число полос (Σ qty), оно же метка кнопки «Полосы (N)».
            summaryEl.appendChild(metric('Итого ножей', knives > 0 ? knives + 1 : 0));
            summaryEl.appendChild(metric('Занято, мм', used));
            // Ширина джамбо неизвестна (нет вида сырья / ширины) → остаток посчитать
            // нельзя. Не показываем ложный отрицательный «вне допуска» (#3116 п.5),
            // а нейтрально сигналим, что джамбо не задан.
            if (!(jumbo > 0)) {
                summaryEl.appendChild(metric('Остаток, мм', '—'));
                summaryEl.appendChild(el('span', { class: 'atex-pp-strip-badge', text: 'ширина джамбо не задана' }));
                // #3706: джамбо не задан — снять подсветку «вне допуска» с кнопки.
                if (stripsBtn) { stripsBtn.classList.remove('is-warn'); stripsBtn.title = 'Полосы резки (количество полос)'; }
            } else {
                var rem = planning.stripsRemainder(jumbo, strips);
                var tol = self.resolveToleranceMm(cut.materialId);   // допуск вида сырья или дефолт 20
                var within = Math.abs(rem) <= Math.abs(tol);
                var remNode = metric('Остаток, мм', rem);
                if (within) remNode.classList.add('is-ok'); else remNode.classList.add('is-warn');
                summaryEl.appendChild(remNode);
                var badge = el('span', { class: 'atex-pp-strip-badge ' + (within ? 'is-ok' : 'is-warn'), text: within ? 'в допуске' : 'вне допуска' });
                summaryEl.appendChild(badge);
                // #3706: живо перекрасить кнопку «Полосы» этой карточки под текущий остаток.
                if (stripsBtn) {
                    if (within) { stripsBtn.classList.remove('is-warn'); stripsBtn.title = 'Полосы резки (количество полос)'; }
                    else { stripsBtn.classList.add('is-warn'); stripsBtn.title = 'Полосы резки — отход вне допуска'; }
                }
            }
            renderPreferred();   // #3128 — перефильтровать ходовые по текущему остатку
        }

        function metric(label, value) {
            return el('div', { class: 'atex-pp-strip-metric' }, [
                el('span', { class: 'atex-pp-strip-metric-label', text: label }),
                el('span', { class: 'atex-pp-strip-metric-value', text: String(value) })
            ]);
        }

        function renderRows() {
            body.innerHTML = '';
            strips.forEach(function(s, idx) {
                var row = el('div', { class: 'atex-pp-strip-row' });

                var w = el('input', { class: 'atex-pp-input', type: 'number', min: '0', step: 'any', placeholder: '0' });
                w.value = s.width;
                w.addEventListener('input', function() { s.width = w.value; recalc(); });
                w.addEventListener('change', function() { self.persistStrip(cut.id, s); });  // авто-сейв (#3127)
                row.appendChild(w);

                // #3253: read-only «Рулонов» = полос × проходов (справочно).
                var rollsCell = el('span', { class: 'atex-pp-strip-rolls', text: String(round3((stripNum(s.qty) || 0) * passes)) });

                var q = el('input', { class: 'atex-pp-input', type: 'number', min: '0', step: '1', placeholder: '0' });
                q.value = s.qty;
                var lastGoodQty = s.qty;   // #3445: откат при превышении «Максимального запаса»
                q.addEventListener('input', function() {
                    s.qty = q.value;
                    rollsCell.textContent = String(round3((stripNum(s.qty) || 0) * passes));
                    recalc();
                });
                q.addEventListener('change', function() {
                    // #3445: не дать ручным вводом превысить «Максимальный запас» (остаток + впрок).
                    var bad = self.stockLimitExceededForCut(cut, strips, passes, orderedBatchIds);
                    if (bad) {
                        s.qty = lastGoodQty; q.value = lastGoodQty;
                        rollsCell.textContent = String(round3((stripNum(s.qty) || 0) * passes));
                        recalc();
                        self.notify('Превышен «Максимальный запас» по ' + bad.width + ' мм: на складе ' + bad.current +
                            ' + впрок ' + bad.adding + ' = ' + bad.projected + ' > лимит ' + bad.limit + ' рул. Не сохранено.', 'error');
                        return;
                    }
                    lastGoodQty = s.qty;
                    self.persistStrip(cut.id, s);   // авто-сейв (#3127)
                });
                row.appendChild(q);

                row.appendChild(rollsCell);   // #3253: вычисляемое поле «Рулонов», read-only

                // #3280: «Назначение» — Заказ (на эту Партию ГП есть ссылка из Обеспечения) / Склад.
                // #3391: необеспеченная полоса идёт на «Склад», только если её номенклатуру
                // целесообразно хранить (есть в «Максимальном запасе»); иначе — «Отходы».
                var isOrdered = (s.id != null && orderedBatchIds[String(s.id)]);
                var purpose = isOrdered ? 'Заказ' : planning.stockStripPurpose(self.maxStockIndex, {
                    material: cut.materialId,
                    width: s.width,
                    length: cut.length,
                    winding: cut.winding
                });
                var purposeMod = isOrdered ? 'order' : (purpose === 'Отходы' ? 'waste' : 'stock');
                var purposeCell = el('div', { class: 'atex-pp-strip-purpose-cell' }, [
                    el('span', {
                        class: 'atex-pp-strip-purpose atex-pp-strip-purpose--' + purposeMod,
                        text: purpose
                    })
                ]);
                // #3320: правее «Склад» — значок «обеспечить»: привязать необеспеченную
                // позицию заказа к этой (уже сохранённой) полосе через «Обеспечение».
                if (!isOrdered && s.id != null) {
                    var supplyIcon = el('button', {
                        class: 'atex-pp-strip-supply',
                        type: 'button',
                        title: 'Обеспечить позицию заказа этой полосой',
                        text: '🔗'
                    });
                    supplyIcon.addEventListener('click', function(e) {
                        e.stopPropagation();
                        if (self.busy) return;
                        self.openStripSupplyPicker(cut, s, passes);
                    });
                    purposeCell.appendChild(supplyIcon);
                }
                row.appendChild(purposeCell);

                var del = el('button', {
                    class: 'atex-pp-btn atex-pp-strip-del' + (isOrdered ? ' is-disabled' : ''),
                    type: 'button',
                    title: isOrdered
                        ? 'Полоса зарезервирована в заказ. Чтобы удалить, отвяжите позиции на форме «Связанные позиции» справа — тогда полоса станет складской и её можно будет удалить.'
                        : 'Удалить полосу',
                    text: '×'
                });
                del.addEventListener('click', function(e) {
                    // #3318 п.1: не всплывать к обработчику карточки — иначе renderRows()
                    // отцепляет кнопку, closest('.atex-pp-strip-panel') возвращает null и
                    // self.render() закрывает панель полос.
                    e.stopPropagation();
                    // #3318 п.2: полосу «в заказ» (есть связи-обеспечения) удалить нельзя —
                    // кнопка неактивна; удаление — через отвязку позиций справа.
                    if (self.busy || isOrdered) return;
                    var removed = strips.splice(idx, 1)[0];
                    renderRows();
                    recalc();
                    // Уже сохранённую полосу (есть id) удаляем на сервере сразу (#3124):
                    // раньше _m_del уходил только по «Сохранить полосы», поэтому при
                    // обновлении страницы удалённые полосы возвращались. Убираем и из
                    // original, чтобы последующее «Сохранить» не пыталось удалить повторно.
                    if (removed && removed.id) {
                        for (var i = 0; i < original.length; i++) {
                            if (String(original[i].id) === String(removed.id)) { original.splice(i, 1); break; }
                        }
                        self.post('_m_del/' + encodeURIComponent(removed.id) + '?JSON', {}).then(function() {
                            self.notify('Полоса удалена', 'info');
                        }).catch(function(err) {
                            self.notify('Ошибка удаления полосы: ' + err.message, 'error');
                        });
                    }
                });
                row.appendChild(del);

                body.appendChild(row);
            });
        }

        // Кнопка «+ полоса».
        var addBtn = el('button', { class: 'atex-pp-btn atex-pp-strip-add', type: 'button', text: '+ полоса' });
        addBtn.addEventListener('click', function() {
            strips.push({ id: null, width: '', qty: '' });   // #3242: запись «Партии ГП»
            renderRows();
            recalc();
        });
        panel.appendChild(addBtn);

        // Панель ходовых ширин (#3128: 3 ряда со скроллом — в CSS; скрываем те,
        // что шире текущего остатка джамбо).
        var matKey = String(cut.materialId == null ? '' : cut.materialId);
        var prefKey = preferredWidthsKey(matKey, cut && cut.winding, cut && cut.length);
        var prefWrap = el('div', { class: 'atex-pp-strip-pref' });
        prefWrap.appendChild(el('div', { class: 'atex-pp-strip-pref-title', text: 'Ходовые ширины' }));
        var prefList = el('div', { class: 'atex-pp-strip-pref-list' });
        prefWrap.appendChild(prefList);
        panel.appendChild(prefWrap);
        var prefLoading = (matKey !== '');

        // Перерисовать ходовые с фильтром по текущему остатку (ширина ≤ остаток
        // джамбо, если он задан). Вызывается из recalc при каждом изменении полос.
        function renderPreferred() {
            prefList.innerHTML = '';
            if (prefLoading) { prefList.appendChild(el('div', { class: 'atex-pp-strip-loading', text: 'Загрузка ходовых…' })); return; }
            if (!prefWidths.length) { prefList.appendChild(el('div', { class: 'atex-pp-empty', text: 'Нет данных по ходовым ширинам.' })); return; }
            // #3391: добор предлагаем только из номенклатур, целесообразных к хранению
            // (есть в «Максимальном запасе»); прочие ширины ушли бы в отход, впрок не режем.
            var stockable = planning.filterStockableWidths(self.maxStockIndex, prefWidths, {
                material: cut.materialId, winding: cut.winding, length: cut.length
            });
            if (!stockable.length) {
                prefList.appendChild(el('div', { class: 'atex-pp-empty', text: 'Нет ходовых, целесообразных к хранению (не в «Максимальном запасе»).' }));
                return;
            }
            var rem = (jumbo > 0) ? (jumbo - planning.stripsUsedWidth(strips)) : null;
            var list = stockable.filter(function(p) { return rem == null || (Number(p.width) || 0) <= rem; });
            if (!list.length) { prefList.appendChild(el('div', { class: 'atex-pp-empty', text: 'Нет ходовых, помещающихся в остаток.' })); return; }
            list.forEach(function(p) {
                var b = el('button', { class: 'atex-pp-btn atex-pp-strip-pref-item', type: 'button',
                    text: p.width + ' мм · Популярность ' + p.popularity });
                b.addEventListener('click', function() {
                    var ns = { id: null, width: String(p.width), qty: '1' };   // #3242: «Партия ГП»
                    // #3445: не добирать ходовую, если она выведет склад за «Максимальный запас».
                    var bad = self.stockLimitExceededForCut(cut, strips.concat([ns]), passes, orderedBatchIds);
                    if (bad) {
                        self.notify('Нельзя добрать ' + p.width + ' мм: «Максимальный запас» будет превышен (на складе ' +
                            bad.current + ' + впрок ' + bad.adding + ' = ' + bad.projected + ' > лимит ' + bad.limit + ' рул.).', 'error');
                        return;
                    }
                    strips.push(ns);
                    renderRows();
                    recalc();
                    self.persistStrip(cut.id, ns);   // авто-сейв (#3127)
                });
                prefList.appendChild(b);
            });
        }

        if (matKey !== '' && this.preferredByMaterial[prefKey]) {
            prefWidths = this.preferredByMaterial[prefKey]; prefLoading = false;
        } else if (matKey !== '') {
            this.loadPreferredWidths(matKey, cut && cut.winding, cut && cut.length).then(function(list) {
                prefWidths = list || []; prefLoading = false;
                if (String(self.stripEditCutId) === String(cut.id) && panel.parentNode) renderPreferred();
            }).catch(function() {
                prefWidths = []; prefLoading = false;
                if (panel.parentNode) renderPreferred();
            });
        } else {
            prefLoading = false;
        }

        // Кнопка «Сохранить полосы» убрана (#3127): сохраняем по мере редактирования
        // (persistStrip на change полей + при вставке ходовой; удаление шлёт _m_del).
        // Закрытие — иконкой × в шапке панели.

        renderRows();
        recalc();
    };

    // #3431: число резок (повторов) резки по id — для «Кол-во рулонов» = полосы × проходов.
    AtexProductionPlanning.prototype.cutPlannedRunsById = function(cutId) {
        var c = (this.cuts || []).filter(function(x) { return String(x.id) === String(cutId); })[0];
        return c ? stripNum(c.plannedRuns) : 0;
    };

    // #3445: лимит запаса при ручном редактировании состава. Суммирует планируемые НА
    // СКЛАД рулоны этой резки по каждой номенклатуре (полосы не «Заказ» × проходов) и
    // сравнивает с лимитом «Максимального запаса» за вычетом текущего остатка склада.
    // null — всё в пределах; иначе { width, limit, current, adding, projected }.
    // Балансовый снимок грузится при старте РМ и не учитывает несохранённые правки этой
    // сессии — для свежесгенерированной резки это даёт корректную абсолютную проверку.
    AtexProductionPlanning.prototype.stockLimitExceededForCut = function(cut, strips, passes, orderedBatchIds) {
        var self = this;
        var runs = stripNum(passes);
        if (!(runs > 0) || !cut) return null;
        var addByKey = {}, nomByKey = {}, widthByKey = {};
        (strips || []).forEach(function(s) {
            if (s && s.id != null && orderedBatchIds && orderedBatchIds[String(s.id)]) return; // заказное покрытие — не запас
            var w = stripNum(s && s.width), qty = stripNum(s && s.qty);
            if (!(w > 0) || !(qty > 0)) return;
            var nom = { material: cut.materialId, width: w, length: cut.length, winding: cut.winding };
            if (planning.stockHeadroom(self.maxStockIndex, self.stockBalanceIndex, nom) == null) return; // нет количественного лимита
            var key = planning.maxStockKey(nom);
            addByKey[key] = round3((addByKey[key] || 0) + qty * runs);
            nomByKey[key] = nom; widthByKey[key] = w;
        });
        var bad = null;
        Object.keys(addByKey).forEach(function(key) {
            if (bad) return;
            var nom = nomByKey[key];
            var limit = planning.maxStockLimit(self.maxStockIndex, nom);
            if (limit == null) return;
            var current = planning.currentStock(self.stockBalanceIndex, nom);
            var projected = round3(current + addByKey[key]);
            if (projected > limit) bad = { width: widthByKey[key], limit: limit, current: current, adding: round3(addByKey[key]), projected: projected };
        });
        return bad;
    };

    // Авто-сейв одной полосы по мере редактирования (#3127). Есть id → _m_set;
    // нет id, но есть данные → _m_new (up=cutId), сохраняем выданный id в strip.id
    // (флаг _creating защищает от двойного создания при близких change-событиях).
    // Пустую новую полосу не создаём. Ошибки — тостом.
    AtexProductionPlanning.prototype.persistStrip = function(cutId, strip) {
        var self = this;
        var sm = this.meta.finishedBatch;   // #3242: состав резки = «Партия ГП»
        if (!sm || !strip) return Promise.resolve();
        // #3431/#3433: «Кол-во полос» = введённое число полос; «Кол-во план» = полосы ×
        // проходов резки. «Кол-во рулонов» (спрос) и «ID заказа» проставляются при
        // привязке «Обеспечения», поэтому здесь не пишутся (ручное редактирование состава).
        var fields = buildFinishedBatchFields(sm, { width: strip.width, strips: strip.qty,
            planned: finishedBatchRolls(strip.qty, this.cutPlannedRunsById(cutId)), active: '1' });
        if (strip.id) {
            return self.post('_m_set/' + strip.id + '?JSON', fields).catch(function(err) {
                self.notify('Ошибка сохранения полосы: ' + err.message, 'error');
            });
        }
        var hasData = String(strip.width).trim() !== '' || String(strip.qty).trim() !== '';
        if (!hasData || strip._creating) return Promise.resolve();
        strip._creating = true;
        return self.post('_m_new/' + sm.id + '?JSON&up=' + encodeURIComponent(cutId), fields).then(function(res) {
            var id = res && (res.obj || res.id || res.i);
            if (id) strip.id = String(id);
            strip._creating = false;
        }).catch(function(err) {
            strip._creating = false;
            self.notify('Ошибка сохранения полосы: ' + err.message, 'error');
        });
    };

    // Сохранить состав резки — дифф original↔strips (#3242: «Партия ГП»):
    //   нет id → _m_new (up=cutId); изменены width/qty → _m_set; удалённые id → _m_del.
    // Поля резолвятся по имени (FINISHED_BATCH_REQ). Возвращает Promise; setBusy/reload/notify.
    AtexProductionPlanning.prototype.saveStrips = function(cutId, strips, original) {
        var self = this;
        var sm = this.meta.finishedBatch;
        var runs = this.cutPlannedRunsById(cutId);   // #3431/#3433: «Кол-во план» = полосы × проходов

        // Карта исходных записей по id для сравнения.
        var origById = {};
        (original || []).forEach(function(s) { if (s.id) origById[String(s.id)] = s; });
        var keepIds = {};

        var ops = [];
        (strips || []).forEach(function(s) {
            var hasData = String(s.width).trim() !== '' || String(s.qty).trim() !== '';
            // #3431/#3433: «Кол-во полос» = введённое число полос; «Кол-во план» = полосы ×
            // проходов. «Кол-во рулонов» (спрос)/«ID заказа» — при привязке «Обеспечения».
            var fields = buildFinishedBatchFields(sm, { width: s.width, strips: s.qty,
                planned: finishedBatchRolls(s.qty, runs), active: '1' });
            if (s.id) {
                keepIds[String(s.id)] = true;
                var o = origById[String(s.id)];
                var changed = !o ||
                    String(o.width).trim() !== String(s.width).trim() ||
                    String(o.qty).trim() !== String(s.qty).trim();
                if (changed) {
                    ops.push(function() { return self.post('_m_set/' + s.id + '?JSON', fields); });
                }
            } else if (hasData) {
                ops.push(function() {
                    return self.post('_m_new/' + sm.id + '?JSON&up=' + encodeURIComponent(cutId), fields);
                });
            }
        });
        // Удалённые: исходные id, которых нет среди текущих полос.
        Object.keys(origById).forEach(function(id) {
            if (!keepIds[id]) ops.push(function() { return self.post('_m_del/' + id + '?JSON', {}); });
        });

        this.setBusy(true);
        var chain = ops.reduce(function(p, op) { return p.then(op); }, Promise.resolve());
        return chain.then(function() {
            self.stripEditCutId = null;
            return self.reload();
        }).then(function() {
            self.setBusy(false);
            self.render();
            self.notify('Полосы сохранены', 'success');
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка сохранения полос: ' + err.message, 'error');
        });
    };

    // Генерация резок под необеспеченные позиции через чистое ядро cut-layout
    // (window.AtexCutLayout.layout.planLayouts). Для каждого сырья строит раскладки
    // (Полосы Заказ/Склад), затем последовательно создаёт: Резку → её Полосы →
    // Обеспечения (по одному на покрытую позицию). Все реквизиты резолвятся по имени.
    AtexProductionPlanning.prototype.generateCuts = function(actionsEl) {
        var self = this;
        if (this.busy) return;
        console.log('[pp] ⚙️ generateCuts: начало генерации резок...');

        var layoutCore = (typeof window !== 'undefined' && window.AtexCutLayout && window.AtexCutLayout.layout) || null;
        if (!layoutCore || typeof layoutCore.planLayouts !== 'function') {
            console.error('[pp] ⚙️ generateCuts: модуль cut-layout не загружен');
            this.notify('Модуль раскладки cut-layout не загружен', 'error');
            return;
        }
        if (!this.meta.cut || !this.meta.supply || !this.meta.finishedBatch) {
            console.error('[pp] ⚙️ generateCuts: не найдены метаданные', {cut:!!this.meta.cut, supply:!!this.meta.supply, finishedBatch:!!this.meta.finishedBatch});
            this.notify('Не найдены метаданные таблиц (Задание/Обеспечение/Партия ГП)', 'error');
            return;
        }

        // #3444: перед планированием перезапросить позиции (report/positions_list) и
        // обеспечение/резки — в соседней вкладке могли загрузить новые заказы или сменить
        // дату, и по кэшу мы бы перепланировали старые позиции вместо генерации новых
        // резок. Прежнее подтверждение убираем и показываем заново на свежих данных.
        if (this._genRefreshing) return;
        var refreshHost = actionsEl || (this.root && this.root.querySelector('.atex-pp-panel-actions'));
        var oldBar = refreshHost && refreshHost.querySelector && refreshHost.querySelector('.atex-pp-confirm-bar');
        if (oldBar && oldBar.parentNode) oldBar.parentNode.removeChild(oldBar);
        this._genRefreshing = true;
        this.setGenBusy(true);
        // #3865: сразу показываем окно прогресса (этап подготовки неопределённый — без счётчика,
        // полоса «бежит»), чтобы по клику «Сгенерировать» было видно, что идёт работа, а не тишина
        // до подтверждения. Дальше планирование/генерация обновляют текст и счётчик.
        this.showProgress('Подготовка генерации…', 0);
        this.updateProgress(0, 'Обновление позиций, очереди и заправки станков…');
        // #3862: заправку станков (prev_cut_setup) тоже обновляем — она привязана к ДАТЕ окна
        // планирования (task_start<планБаза), а дату могли сменить после загрузки страницы; иначе
        // первая резка считалась бы от заправки на старую дату.
        Promise.all([this.loadPositions(), this.reload(), this.loadPrevCutSetup()]).then(function() {
            self._genRefreshing = false;
            self.setGenBusy(false);
            self.updateProgress(0, 'Планирование раскладок…');   // #3865
            // #3457: loadPositions() пересоздал genPositions с НОМИНАЛЬНОЙ шириной заказа —
            // заново проставляем фактическую ширину резки (#3372: справочник 66190), иначе
            // планирование/раскладка/Партии ГП пойдут по номиналу (60мм вместо 59мм).
            // Справочники (actualWidthIndex/jumboWidthByMaterial/nominalWidthByMaterial/sleeveInchesById) живут с start().
            self.annotatePositionsCutWidth();
            self.render();
            self.planAndConfirmCuts(actionsEl);
        }).catch(function(err) {
            self._genRefreshing = false;
            self.setGenBusy(false);
            self.hideProgress();   // #3865
            console.error('[pp] ⚙️ generateCuts: не удалось обновить данные перед планированием', err);
            self.notify('Не удалось обновить данные перед планированием: ' + (err && err.message || err), 'error');
        });
    };

    // #3444: планирование + подтверждение (вызывается после перезапроса позиций/обеспечения).
    AtexProductionPlanning.prototype.planAndConfirmCuts = function(actionsEl) {
        var self = this;
        var layoutCore = (typeof window !== 'undefined' && window.AtexCutLayout && window.AtexCutLayout.layout) || null;
        if (!layoutCore || typeof layoutCore.planLayouts !== 'function') { this.hideProgress(); return; }   // #3865

        // #(no-srok-when-on-time): срок учитываем (дробим позиции по окну) только если
        // есть просроченные относительно даты планирования. Если все позиции укладываются
        // в свой срок (dueKey ≥ planDateKey), окно не нужно — объединяем в один кластер.
        var planBaseMs = planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this));
        var pbmD = new Date(planBaseMs);
        var planDateKey = pbmD.getFullYear() * 10000 + (pbmD.getMonth() + 1) * 100 + pbmD.getDate();

        // Необеспеченные позиции, сгруппированные по совместимому профилю:
        // сырьё + направление намотки + длина намотки.
        // Только согласованные (order_approval_date или item_approval_date).
        var unsup = uncoveredPositions(this.genPositions, this.supplies).filter(function(p) { return p.approved; });
        // #3812: позиции на втулке 0.5″ у́же 55 мм не производятся — исключаем из планирования.
        var notProducible = [];
        unsup = unsup.filter(function(p) {
            if (p.producible === false) { notProducible.push(p); return false; }
            return true;
        });
        console.log('[pp] ⚙️ generateCuts: всего позиций:', this.genPositions.length, ', необеспеченных согласованных:', unsup.length);
        if (!unsup.length) {
            // #3792: вброс новых заданий пересобирает очередь по правилам (preserveOrder=false:
            // минимум переналадок — группировка сырья; при прочих равных — больше полос раньше).
            // Ручной порядок оператора переживает генерацию ТОЛЬКО через флаг «Зафиксировано» —
            // он держит задание на своём дне (не переносит/не разбивает), внутри дня переставлять
            // можно. Идемпотентно (#3427): если ничего не меняется — ничего не пишем.
            console.log('[pp] ⚙️ generateCuts: незапланированных позиций нет — пересобираю очередь по правилам');
            var npNote = notProducible.length ? ' Пропущено ' + notProducible.length + ' поз. (втулка 0.5″, ширина < 55 мм).' : '';
            this.hideProgress();   // #3865: дальше autoSequenceQueue покажет свой прогресс «Сохранение плана резок…»
            this.autoSequenceQueue(PLANNING_STRATEGY_SETUP, false).then(function(changed) {
                self.notify((changed ? 'Очередь пересобрана по правилам (зафиксированные задания — на своих днях)'
                                     : 'Нет незапланированных позиций; очередь уже оптимальна') + npNote, 'info');
            });
            return;
        }
        var profiles = groupPositionsByPlanningProfile(unsup);
        console.log('[pp] ⚙️ generateCuts: сгруппировано по сырью/намотке/метражу:', profiles.length,
            'профилей:', profiles.map(function(g) { return g.key; }));

        // Догрузить ходовые ширины для профиля, у которого их ещё нет в кеше.
        var preloads = [];
        profiles.forEach(function(group) {
            if (group.materialId !== '' && !self.preferredByMaterial[group.key]) {
                preloads.push(self.loadPreferredWidths(group.materialId, group.windDir, group.windLength));
            }
        });

        // На время запросов preferable_widths (preloads) деактивируем кнопку и
        // показываем крутилку (#3332), иначе клик «глохнет» без видимой реакции.
        self.setGenBusy(true);
        if (preloads.length) self.updateProgress(0, 'Загрузка ходовых ширин…');   // #3865
        Promise.all(preloads).then(function() {
            // Запросы завершены — крутилку убираем; далее идёт синхронная раскладка
            // и (при наличии) модалка подтверждения / runGenerateCuts со своим busy.
            self.setGenBusy(false);
            self.updateProgress(0, 'Планирование раскладок…');   // #3865
            // Построить раскладки по каждому профилю; собрать пропуски.
            var allLayouts = [];   // [{...layout, mat}]
            var skipped = [];      // [{positionId, reason}]
            // #3812: непроизводимые (втулка 0.5″, ширина < 55 мм) — в пропуски.
            notProducible.forEach(function(p) { skipped.push({ positionId: p.id, reason: 'втулка 0.5″: ширина < 55 мм не производится' }); });

            // #3872: дополнительные втулки 110 мм могут быть уже заказаны. Профили-носители
            // втулочных полос обрабатываем ПЕРВЫМИ: на каждую их раскладку «забираем» подходящие
            // позиции заказа 110 мм (тот же заказ, то же сырьё/намотка/длина) как реальные полосы
            // (coreFillerClaims), а уже потом планируем остальные профили — забранные 110-мм позиции
            // в свою отдельную резку не уходят. Не нашлось — добиваем синтетикой (#3812).
            var posById = positionMap(self.genPositions);
            var coreFillerClaims = {};   // positionId → true (позиция съедена носителем как полоса 110)
            var orderedProfiles = profiles.filter(function(g) { return g.coreStripCount > 0; })
                .concat(profiles.filter(function(g) { return !(g.coreStripCount > 0); }));

            orderedProfiles.forEach(function(group) {
                var mat = group.materialId;
                // #3872: позиции, уже забранные носителем как втулочные полосы, в этом профиле не планируем.
                var groupPositions = group.positions.filter(function(p) { return !coreFillerClaims[String(p.id)]; });
                if (!groupPositions.length) return;
                var jw = self.jumboWidthByMaterial[mat];
                if (!jw) {
                    groupPositions.forEach(function(p) { skipped.push({ positionId: p.id, reason: 'нет ширины джамбо' }); });
                    return;
                }
                layoutPositionGroups(groupPositions).forEach(function(positionGroup) {
                    // Нет просроченных позиций (всё в рамках срока) → окно срока не нужно,
                    // объединяем все позиции сырья (windowDays=Infinity); иначе дробим по WINDOW_DAYS.
                    var hasOverdue = positionGroup.some(function(p) {
                        return isFinite(p.dueKey) && p.dueKey < planDateKey;
                    });
                    // #3391: добор джамбо ходовыми — только из номенклатур, целесообразных
                    // к хранению (есть в «Максимальном запасе»); прочее уходит в отход, не впрок.
                    var stockablePreferred = planning.filterStockableWidths(
                        self.maxStockIndex, self.preferredByMaterial[group.key] || [],
                        { material: mat, winding: group.windDir, length: group.windLength });
                    // #3812: втулка 0.5″ шир. 110 мм — резервируем ширину джамбо под втулочные
                    // полосы 110 мм ДО укладки продукта (occupied width), полосы дописываем
                    // в каждый раскрой ниже. Профиль разбит по count, поэтому ширина едина.
                    var coreCount = group.coreStripCount || 0;
                    var coreWidth = group.coreStripWidth || 0;
                    var coreReserve = coreCount > 0 && coreWidth > 0 ? round3(coreCount * coreWidth) : 0;
                    var effJumbo = round3(jw - coreReserve);
                    if (coreReserve > 0) {
                        var maxProd = positionGroup.reduce(function(m, p) { var w = Number(p.width) || 0; return w > m ? w : m; }, 0);
                        if (!(effJumbo >= maxProd)) {
                            positionGroup.forEach(function(p) { skipped.push({ positionId: p.id, reason: 'втулка ' + coreWidth + ' мм: не хватает ширины джамбо под втулочные полосы' }); });
                            return;
                        }
                    }
                    var res = layoutCore.planLayouts({
                        jumboWidth: effJumbo,
                        positions: positionGroup.map(function(p) {
                            // #3423: запасные комбинации (есть в «Максимальном запасе») можно
                            // перепроизводить в запас; незапасные — резать ровно под заказ.
                            // #3684/#3706: orderId — для seed «1 заказ = 1 резка» (позиции
                            // одного заказа собираются в одну резку; одинаковая ширина РАЗНЫХ
                            // заказов не склеивается принудительно).
                            return { id: p.id, orderId: p.orderId, width: p.width, qty: p.qty, dueKey: p.dueKey,
                                stockable: planning.isStockableNomenclature(self.maxStockIndex, {
                                    material: mat, width: p.width,
                                    length: group.windLength, winding: group.windDir }) };
                        }),
                        preferred: stockablePreferred,
                        options: { windowDays: hasOverdue ? WINDOW_DAYS : Infinity, tolerance: self.resolveToleranceMm(mat) }
                    });
                    (res.layouts || []).forEach(function(lay) {
                        lay.mat = mat;
                        lay.windDir = group.windDir;
                        lay.windLength = group.windLength;
                        lay.leader = group.leader;   // #3569: лидер профиля — копируется в задание
                        lay.isFoil = !!group.isFoil; // #3599: фольга — раскладку в конец смены
                        if (coreReserve > 0) {
                            // #3872: привязать втулочные полосы к уже заказанным 110-мм позициям
                            // того же заказа (что покрывает раскладка). Найденные позиции — реальные
                            // полосы (обеспечение на произведённое); не нашлось — синтетика (#3812).
                            var coveredOrders = {};
                            (lay.positionsCovered || []).forEach(function(pid) {
                                var cp = posById[String(pid)];
                                if (cp && cp.orderId != null && String(cp.orderId) !== '') coveredOrders[String(cp.orderId)] = true;
                            });
                            var fillerIds = selectCoreStripFillers(unsup, group, coveredOrders, coreFillerClaims);
                            appendCoreStrip(lay, coreWidth, coreCount, fillerIds); // #3812/#3872
                        }
                        allLayouts.push(lay);
                    });
                    (res.skipped || []).forEach(function(s) { skipped.push(s); });
                });
            });

            console.log('[pp] ⚙️ generateCuts: раскладок построено:', allLayouts.length, ', пропущено:', skipped.length);
            if (skipped.length > 0) console.log('[pp] ⚙️ generateCuts: первые пропуски:', JSON.stringify(skipped.slice(0, 5)));

            if (!allLayouts.length) {
                console.log('[pp] ⚙️ generateCuts: нет раскладок, выход');
                self.hideProgress();   // #3865
                self.notify('Нет необеспеченных позиций для генерации (пропущено ' + skipped.length + ')', 'info');
                return;
            }

            // #3445: capping по «Максимальному запасу» — на склад по каждой номенклатуре
            // нельзя нарезать больше лимита (с учётом текущего остатка). Урезаем добор и
            // перепроизводство впрок; заказное покрытие не трогаем. Лишнее не нарезается.
            var capPosById = positionMap(self.genPositions);
            var capResult = capStockToHeadroom(allLayouts, {
                runsForLayout: function(lay) { return plannedRunsForLayout(lay, capPosById); },
                demandRollsForWidth: function(lay, w) {
                    var sum = 0;
                    (lay.positionsCovered || []).forEach(function(pid) {
                        var p = capPosById[String(pid)];
                        if (!p) return;
                        if (round3(Number(p.width) || 0) !== round3(Number(w) || 0)) return;
                        sum += Number(p.qty) || 0;
                    });
                    return sum;
                },
                headroomForNom: function(nom) { return stockHeadroom(self.maxStockIndex, self.stockBalanceIndex, nom); }
            });
            if (capResult.trimmed.length) {
                var cappedRolls = capResult.trimmed.reduce(function(a, t) { return a + (Number(t.droppedRolls) || 0); }, 0);
                console.log('[pp] ⚙️ generateCuts: #3445 capping — урезано впрок (рулонов):', round3(cappedRolls),
                    'позиций раскладки:', capResult.trimmed.length, capResult.trimmed.slice(0, 5));
            }

            var timingDiagnostics = cutGenerationTimingDiagnostics(allLayouts, self.genPositions, self.opTimes);
            if (timingDiagnostics.length) {
                console.error('[pp] ❌ generateCuts: ошибка подготовки полей резки — ' + cutWriteDiagnosticSummary(timingDiagnostics), {
                    diagnostics: timingDiagnostics,
                    layouts: allLayouts.slice(0, 5)
                });
                self.hideProgress();   // #3865
                self.notify('Ошибка подготовки заданий: ' + cutWriteDiagnosticSummary(timingDiagnostics.slice(0, 3)) +
                    (timingDiagnostics.length > 3 ? '; …' : ''), 'error');
                return;
            }

            // #3470: вопрос «Создать производственные задания?» — в конце, после «Пропущено N».
            var msg = el('span', { class: 'atex-pp-confirm-msg' });
            msg.appendChild(document.createTextNode(
                'Не обеспечено заданиями и складом позиций: ' + unsup.length + '. '));
            if (skipped.length) {
                var skipLink = el('a', { class: 'atex-pp-skipped-link', href: '#',
                    text: 'Пропущено ' + skipped.length,
                    title: 'Открыть список пропущенных позиций в новой вкладке' });
                skipLink.addEventListener('click', function(ev) {
                    ev.preventDefault();
                    self.openSkippedReport(skipped);
                });
                msg.appendChild(skipLink);
                msg.appendChild(document.createTextNode('. '));
            } else {
                msg.appendChild(document.createTextNode('Пропущено 0. '));
            }
            // #3445: отчёт об урезании впрок по «Максимальному запасу» (если было).
            if (capResult.trimmed.length) {
                var cappedTotal = capResult.trimmed.reduce(function(a, t) { return a + (Number(t.droppedRolls) || 0); }, 0);
                msg.appendChild(document.createTextNode(
                    'Урезано впрок по «Максимальному запасу»: ' + round3(cappedTotal) + ' рул. '));
            }
            // #3470: текст «Создать производственные задания?» (без счётчика, термин «задания»).
            msg.appendChild(document.createTextNode('Создать производственные задания?'));

            // Единая кнопка генерации. Очередь строим по минимуму переналадки (#3268)
            // с ножами по убыванию (#3130) — стратегия SETUP. Прежняя «сложные раньше»
            // (FATIGUE) по route-score давала ножи по ВОЗРАСТАНИЮ (6,16,16), вопреки
            // #3130 (ideav/crm#3421). inline:true — именованная inline-кнопка, без модалки.
            // #3865: прячем прогресс подготовки — показываем чистое подтверждение; на «Создать»
            // прогресс вернётся (runGenerateCuts).
            self.hideProgress();
            self.confirmAction(msg, actionsEl, [
                { label: 'Создать', primary: true, inline: true, onConfirm: function() {
                    self.runGenerateCuts(allLayouts, skipped, PLANNING_STRATEGY_SETUP);
                } }
            ]);
        }).catch(function(err) {
            self.setGenBusy(false);
            self.hideProgress();   // #3865
            self.notify('Ошибка подготовки генерации: ' + err.message, 'error');
        });
    };

    // Последовательное создание записей по подготовленным раскладкам (#3242):
    // Резка → Партии ГП (состав, по ширинам) → задания на втулки → Обеспечения
    // (ссылаются на «Партию ГП» нужной ширины). Излишек рулонов сверх обеспечений —
    // склад (та же Партия ГП без своего обеспечения). Зависимые _m_new не параллелятся.
    AtexProductionPlanning.prototype.runGenerateCuts = function(layouts, skipped, strategy) {
        var self = this;
        // #3865: окно прогресса показываем сразу по «Создать» — синхронная подготовка (раскладка
        // по дням, выравнивание загрузки станков) выполняется до первых запросов; ниже окно
        // сменится счётчиком «N из M». Без этого по «Создать» какое-то время не было индикатора.
        this.showProgress('Генерация заданий…', 0);
        this.updateProgress(0, 'Подготовка и выравнивание загрузки станков…');
        var cutMeta = this.meta.cut;
        var finishedBatchMeta = this.meta.finishedBatch;   // #3242: состав резки = «Партия ГП»
        var supplyMeta = this.meta.supply;
        var planOptions = makePlanningOptions(strategy, this.changeTimes);

        var cutReqIds = {
            slitter: reqIdByName(cutMeta, CUT_REQ.slitter),
            materialBatch: reqIdByName(cutMeta, CUT_REQ.materialBatch),
            plannedRuns: reqIdByAnyName(cutMeta, CUT_PLANNED_RUNS_NAMES),
            duration: reqIdByName(cutMeta, CUT_REQ.duration),
            timing: reqIdByName(cutMeta, CUT_REQ.timing),
            length: reqIdByName(cutMeta, CUT_REQ.length),
            winding: reqIdByName(cutMeta, CUT_REQ.winding),
            leader: reqIdByName(cutMeta, CUT_REQ.leader),   // #3569: ссылка «Лидер» (82519)
            material: reqIdByName(cutMeta, CUT_REQ.material), // #3688: ссылка «Вид сырья» (95358)
            status: reqIdByName(cutMeta, CUT_REQ.status),
            sequence: reqIdByName(cutMeta, CUT_REQ.sequence)
        };
        var sleeveMeta = this.meta.sleeveTask;
        var sleeveReqIds = this.sleeveTaskReqIds();
        // #3155: «Метраж, м» обеспечения = «Длина, м» покрываемой позиции (длина прогона).
        // Без него footageBySupply=0 → windingMinutes=0 → все резки «0 мин» в расписании.
        var posLength = positionLengthMap(this.genPositions);
        var posById = positionMap(this.genPositions);

        // Сид баланса станков из текущих резок (счётчик по slitterId).
        var loadBySlitterId = {};
        (this.cuts || []).forEach(function(c) {
            var sid = c && c.slitter && c.slitter.id;
            if (sid != null) loadBySlitterId[String(sid)] = (loadBySlitterId[String(sid)] || 0) + 1;
        });
        var setupGroupsByDay = {};
        (this.cuts || []).forEach(function(c) {
            var sid = c && c.slitter && c.slitter.id;
            if (sid == null) return;
            var day = cutPlanDayKey(c);
            if (!setupGroupsByDay[day]) setupGroupsByDay[day] = {};
            var key = String(sid);
            if (!setupGroupsByDay[day][key]) setupGroupsByDay[day][key] = [];
            setupGroupsByDay[day][key].push(c);
        });
        var sequenceCuts = (this.cuts || []).slice();
        var cutMainState = { last: this.lastCutMainValue };
        var batchRemainingById = {};
        (this.genBatches || []).forEach(function(b) {
            var id = b && b.id != null ? String(b.id) : '';
            var lin = Number(b && b.remainderLinear);
            if (id !== '' && isFinite(lin) && lin > 0) batchRemainingById[id] = lin;
        });

        var nStrips = 0;
        var nPositions = 0;
        var nSleeveTasks = 0;
        var nSleeves = 0;
        var nCuts = layouts.length;
        var doneCuts = 0;
        var timingDiagnostics = cutGenerationTimingDiagnostics(layouts, this.genPositions, this.opTimes);
        if (timingDiagnostics.length) {
            console.error('[pp] ❌ runGenerateCuts: ошибка подготовки полей резки — ' + cutWriteDiagnosticSummary(timingDiagnostics), {
                diagnostics: timingDiagnostics
            });
            this.notify('Ошибка подготовки заданий: ' + cutWriteDiagnosticSummary(timingDiagnostics.slice(0, 3)) +
                (timingDiagnostics.length > 3 ? '; …' : ''), 'error');
            return Promise.resolve();
        }

        var layoutPlans = [];
        // #3830: рабочая ёмкость дня станка (мин) — чтобы не сваливать резку на переполненный
        // станок, когда есть свободный. Окно резки минус обед (как в splitMachineQueue).
        var genWindow = self.workingWindow();
        var genDayCapacityMin = Math.max(0, (Number(genWindow.cutEndMin) || 0) - (Number(genWindow.startMin) || 0)
            - (Number(genWindow.lunchDurationMin) || 0));
        // #3876: станки в отпуске на день резки не выбираем (мемо по дню — vacations единичны).
        var genVacationByDay = {};
        function vacationSetForDay(dayKey, planDateSec) {
            if (!(dayKey in genVacationByDay)) {
                var d = new Date(Number(planDateSec) * 1000); d.setHours(0, 0, 0, 0);
                genVacationByDay[dayKey] = self.vacationSlitterIdsForDay(d.getTime());
            }
            return genVacationByDay[dayKey];
        }
        layouts.forEach(function(lay, layIdx) {
            var plannedRuns = plannedRunsForLayout(lay, posById);
            var runLength = layoutRunLength(lay, posById);
            var batchId = pickBatchFIFOForRun(self.genBatches, lay.mat, runLength, batchRemainingById);
            // #3453: нет партии сырья (нет активной «Партии сырья» этого вида с остатком) —
            // не создаём резку с пустой «Партией сырья», а помечаем позиции пропущенными.
            // pickBatchFIFOForRun при отсутствии партии возвращает null без списания остатка.
            if (!batchId) {
                console.warn('[pp] 🔧 runGenerateCuts: раскладка без партии сырья (сырьё ' + lay.mat + ') — пропущена');
                (lay.positionsCovered || []).forEach(function(pid) {
                    skipped.push({ positionId: pid, reason: 'нет партии сырья' });
                });
                return;
            }
            var cutMainValue = nextCutMainValue(sequenceCuts, controllerNowMs(self), cutMainState);
            var day = cutPlanDayKey({ planDate: cutMainValue });
            if (!setupGroupsByDay[day]) setupGroupsByDay[day] = {};
            var descriptor = {
                id: 'generated-' + layIdx,
                materialId: lay.mat,
                winding: lay.windDir,
                batchId: batchId,
                jumboRemainingM: 0,
                knifeCount: stripsTotalKnives(lay && lay.strips),
                knifeWidths: knifeWidthsForStrips(lay && lay.strips),
                isFoil: !!(lay && lay.isFoil),
                width: stripsUsedWidth(lay && lay.strips),
                rollerWidth: 0,
                planDate: cutMainValue,
                // #3830: рабочие минуты резки (намотка) — чтобы выбор станка учитывал ёмкость дня.
                duration: plannedCutDurationMinutes(runLength, plannedRuns, self.opTimes, !!(lay && lay.isFoil))
            };
            var slitterId = chooseSlitterBySetup(descriptor, self.slitters, setupGroupsByDay[day], loadBySlitterId, planOptions, genDayCapacityMin, vacationSetForDay(day, cutMainValue));
            if (slitterId != null) {
                slitterId = String(slitterId);
                if (!setupGroupsByDay[day][slitterId]) setupGroupsByDay[day][slitterId] = [];
                setupGroupsByDay[day][slitterId].push(descriptor);
                loadBySlitterId[slitterId] = (loadBySlitterId[slitterId] || 0) + 1;
            }
            layoutPlans.push({
                id: descriptor.id,
                materialId: descriptor.materialId,
                winding: descriptor.winding,
                batchId: descriptor.batchId,
                jumboRemainingM: descriptor.jumboRemainingM,
                knifeCount: descriptor.knifeCount,
                knifeWidths: descriptor.knifeWidths,
                isFoil: descriptor.isFoil,
                width: descriptor.width,
                rollerWidth: descriptor.rollerWidth,
                planDate: descriptor.planDate,
                plannedRuns: plannedRuns,
                runLength: runLength,
                duration: plannedCutDurationMinutes(runLength, plannedRuns, self.opTimes, descriptor.isFoil), // #3606
                timing: cutTimingDetails(runLength, plannedRuns, self.opTimes, descriptor.isFoil),
                slitterId: slitterId,
                cutMainValue: cutMainValue,
                sequence: '',
                index: layIdx
            });
        });
        if (layoutPlans.length) self.lastCutMainValue = cutMainState.last;
        nCuts = layoutPlans.length;   // #3453: раскладки без партии сырья отброшены — считаем по факту

        // #3848: ВЫРАВНИВАНИЕ ЗАГРУЗКИ СТАНКОВ — в памяти, по массиву layoutPlans (никаких
        // запросов в базу, #3857). Жадное chooseSlitterBySetup группирует одно сырьё/ножи на
        // ОДИН станок → он копит работу на 5 дней, пока соседний простаивает. Итеративно
        // переносим задания с перегруженного станка на менее загруженный (минимизируя макс.
        // число дней), пока есть прогресс; цикличные перестановки исключены (Set посещённых
        // комбинаций). Существующие резки держат базовую загрузку своих станков (fixedByMachine).
        // Журнал шагов — в консоль («панель отладки»). Меняем только plan.slitterId; всё
        // последующее (очередь, дробление по дням, запись) идёт по обновлённому назначению.
        (function rebalanceGeneratedLoad(){
            if (!(genDayCapacityMin > 0) || !self.slitters || self.slitters.length < 2) return;
            var fixedByMachine = {};
            (self.cuts || []).forEach(function(c){
                var sid = c && c.slitter && c.slitter.id;
                if (sid != null) (fixedByMachine[String(sid)] = fixedByMachine[String(sid)] || []).push(c);
            });
            var labelById = {};
            (self.slitters || []).forEach(function(s){ labelById[String(s.id)] = (s.label || ('#' + s.id)); });
            function fmt(load){
                return Object.keys(load || {}).map(function(id){
                    var l = load[id]; return (labelById[id] || id) + ':' + l.days + 'д/' + Math.round(l.minutes) + 'м';
                }).join('  ');
            }
            // #3881: «загруженность» = дата окончания с учётом отпуска. machineDayOff(id, dayOffset)
            // — нерабочий ли день-смещение от базы плана у станка (отпуск). Мемоизируем по дню.
            var rebBaseMidnightMs = planBaseMidnightFrom(self.filter && self.filter.date, controllerNowMs(self));
            var machineDayOffMemo = {};
            function machineDayOff(machineId, dayOffset){
                var k = machineId + ':' + dayOffset;
                if (k in machineDayOffMemo) return machineDayOffMemo[k];
                var v = self.slitterOnVacationDay(machineId, rebBaseMidnightMs + dayOffset * 86400000);
                machineDayOffMemo[k] = v;
                return v;
            }
            var res = rebalanceSlitterLoad(layoutPlans, self.slitters, {
                weights: planOptions, dayCapacityMin: genDayCapacityMin, fixedByMachine: fixedByMachine,
                machineDayOff: machineDayOff,   // #3881: дата окончания с учётом отпуска (span)
                // #3876: не переносить задание на станок, у которого в день задания (plan.planDate) отпуск.
                slitterDayBlocked: function(slitterId, plan){
                    var sec = Number(plan && plan.planDate);
                    if (!isFinite(sec) || sec <= 0) return false;
                    var d = new Date(sec * 1000); d.setHours(0, 0, 0, 0);
                    return self.slitterOnVacationDay(slitterId, d.getTime());
                },
                log: function(ev){
                    if (ev.event === 'start') console.log('[pp] ⚖ выравнивание загрузки — старт:', fmt(ev.load));
                    else if (ev.event === 'move') console.log('[pp] ⚖ #' + ev.step + ' ' + ev.cutId + ' ' + (labelById[ev.from] || ev.from) + '→' + (labelById[ev.to] || ev.to) + '  | ' + fmt(ev.load));
                    else if (ev.event === 'stop') console.log('[pp] ⚖ стоп (' + ev.reason + '), переносов ' + ev.iterations + ':', fmt(ev.load));
                }
            });
            if (res.moves.length) {
                var dB = Math.max.apply(null, Object.keys(res.loadBefore).map(function(k){ return res.loadBefore[k].days; }));
                var dA = Math.max.apply(null, Object.keys(res.loadAfter).map(function(k){ return res.loadAfter[k].days; }));
                console.log('[pp] ⚖ выравнивание: ' + res.moves.length + ' переносов; макс. дней станка ' + dB + '→' + dA);
            }
        })();

        // Create requests stay in layout order, but queue numbers for same-day
        // generated cuts follow the operator-selected planner (#3272).
        var sequenceGroups = {};
        var sequenceGroupOrder = [];
        layoutPlans.forEach(function(plan) {
            var slitterId = String(plan.slitterId == null ? '' : plan.slitterId);
            if (slitterId === '') return;
            var day = cutPlanDayKey({ planDate: plan.cutMainValue });
            var key = slitterId + '\u0000' + day;
            if (!sequenceGroups[key]) {
                sequenceGroups[key] = { slitterId: slitterId, planDate: plan.cutMainValue, plans: [] };
                sequenceGroupOrder.push(key);
            }
            sequenceGroups[key].plans.push(plan);
        });
        sequenceGroupOrder.forEach(function(key) {
            var group = sequenceGroups[key];
            var byIndex = {};
            group.plans.forEach(function(plan) { byIndex[String(plan.index)] = plan; });
            orderCuts(group.plans, planOptions).forEach(function(orderedPlan) {
                var plan = byIndex[String(orderedPlan.index)];
                if (!plan) return;
                plan.sequence = nextSequenceForCuts(sequenceCuts, group.slitterId, group.planDate);
                sequenceCuts.push({
                    id: plan.id,
                    number: plan.cutMainValue,
                    slitter: { id: group.slitterId, label: '' },
                    planDate: plan.cutMainValue,
                    sequence: plan.sequence,
                    materialId: plan.materialId,
                    winding: plan.winding,
                    batchId: plan.batchId,
                    jumboRemainingM: plan.jumboRemainingM,
                    knifeCount: plan.knifeCount,
                    knifeWidths: plan.knifeWidths,
                    isFoil: plan.isFoil,
                    width: plan.width,
                    rollerWidth: plan.rollerWidth
                });
            });
        });

        // #3280: дробление резок по дням НА УРОВНЕ ПРОХОДОВ + плановое время старта в
        // t1078. По каждому станку в порядке очерёдности раскладываем проходы по дням
        // (splitMachineQueue): резка, не влезающая до конца дня, режется — что успеваем
        // сегодня (запись-сегмент), остаток продолжается с 08:00 след. дня (ещё запись).
        // Каждый сегмент = отдельная запись «Производственной резки»: t1078 = начало окна,
        // «Кол-во план» = проходы сегмента; Полосы копируются (тот же раскрой за проход),
        // Обеспечение делится по проходам (splitSupplyShares). → segmentsByLayout[layIdx].
        var segmentsByLayout = {};
        (function() {
            var windPoints = windingPointsFromTimes(self.opTimes || {});
            var dayWindow = self.workingWindow();
            // #(gen-from-date): план строим от даты, выбранной в фильтре
            // (.atex-pp-input), даже если она в прошлом; без даты — от сегодня.
            var planBaseMidnightMs = planBaseMidnightFrom(self.filter && self.filter.date, controllerNowMs(self));
            var bySlitter = {};
            layoutPlans.forEach(function(plan) {
                var s = String(plan.slitterId == null ? '' : plan.slitterId);
                if (s === '') return;
                (bySlitter[s] = bySlitter[s] || []).push(plan);
            });
            var allSegs = [];
            Object.keys(bySlitter).forEach(function(s) {
                var plans = bySlitter[s].slice().sort(function(a, b) { return (Number(a.sequence) || 0) - (Number(b.sequence) || 0); });
                var perPassByCut = {}, runsByCut = {};
                plans.forEach(function(p) {
                    perPassByCut[String(p.id)] = windingMinutes(p.runLength, windPointsForCut(p.isFoil, windPoints)); // #3606
                    runsByCut[String(p.id)] = p.plannedRuns;
                });
                var segs = splitMachineQueue(plans, {
                    dayStartMin: dayWindow.startMin, dayEndMin: dayWindow.cutEndMin,
                    dayEndHourMin: dayWindow.endMin,   // #3847: DAY_END_HOUR для лимита нахлёста
                    maxOverworkCutsMin: dayWindow.maxOverworkCutsMin,   // #3847: макс. нахлёст резки
                    maxOverworkTuneMin: dayWindow.maxOverworkTuneMin,   // #3847: макс. нахлёст настройки
                    times: self.changeTimes, perPassByCut: perPassByCut, runsByCut: runsByCut,
                    lunchStartMin: dayWindow.lunchStartMin, lunchDurationMin: dayWindow.lunchDurationMin,
                    firstCutSetup: true,   // #3669 п.2: первая задача очереди — настройка ножей
                    blockedRanges: self.blockedRangesForSlitter(s, planBaseMidnightMs)   // #3764: окна «Отпуска» станка
                });
                var byPlanId = {};
                segs.forEach(function(sg) { (byPlanId[String(sg.cutId)] = byPlanId[String(sg.cutId)] || []).push(sg); });
                plans.forEach(function(p) {
                    var ps = byPlanId[String(p.id)];
                    if (!ps || !ps.length) ps = [{ runs: p.plannedRuns, windowStartMin: dayWindow.startMin }];
                    var segRunsAll = ps.map(function(x) { return x.runs; });
                    var perPass = perPassByCut[String(p.id)] || 0;
                    segmentsByLayout[p.index] = ps.map(function(sg, si) {
                        var ts = scheduleStartTimestamp(planBaseMidnightMs, sg.windowStartMin);
                        var unit = {
                            plannedRuns: sg.runs,
                            cutMainValue: ts > 0 ? ts : p.cutMainValue,
                            runLength: p.runLength,
                            duration: round3(perPass * sg.runs),
                            timing: cutTimingDetails(p.runLength, sg.runs, self.opTimes, p.isFoil), // #3606
                            batchId: p.batchId,
                            slitterId: p.slitterId,
                            fullPlannedRuns: p.plannedRuns,
                            segIndex: si,
                            segRunsAll: segRunsAll,
                            sequence: ''
                        };
                        allSegs.push({ slitterId: String(p.slitterId), dayKey: cutPlanDayKey({ planDate: unit.cutMainValue }), ts: unit.cutMainValue, unit: unit });
                        return unit;
                    });
                });
            });
            // Очерёдность 1..N в пределах (станок, день) по времени старта.
            var seqGroups = {};
            allSegs.forEach(function(a) { var k = a.slitterId + ' ' + a.dayKey; (seqGroups[k] = seqGroups[k] || []).push(a); });
            Object.keys(seqGroups).forEach(function(k) {
                seqGroups[k].sort(function(a, b) { return Number(a.ts) - Number(b.ts); })
                    .forEach(function(a, i) { a.unit.sequence = i + 1; });
            });
        })();

        this.setBusy(true);
        this.setGenBusy(true);
        // Окно прогресса (#3148): генерация идёт последовательными зависимыми
        // запросами, может занять заметное время.
        // #3280: записей-сегментов может быть больше, чем раскладок (резки длиннее дня дробятся).
        var nRecords = 0;
        Object.keys(segmentsByLayout).forEach(function(k) { nRecords += segmentsByLayout[k].length; });
        if (!nRecords) nRecords = nCuts;
        console.log('[pp] 🔧 runGenerateCuts: начало создания ' + nRecords + ' записей (' + nCuts + ' раскладок)...');
        this.showProgress('Генерация заданий…', nRecords);
        var chain = Promise.resolve();
        var startTime = Date.now();
        layouts.forEach(function(lay, layIdx) {
          var units = segmentsByLayout[layIdx] || [];
          units.forEach(function(unit) {
            chain = chain.then(function() {
                self.updateProgress(doneCuts, 'Создаётся задание ' + (doneCuts + 1) + ' из ' + nRecords + '…');
                var plannedRuns = unit.plannedRuns;
                var runLength = unit.runLength;
                var duration = unit.duration;
                var timing = unit.timing;
                var batchId = unit.batchId;
                var slitterId = unit.slitterId;
                var sequence = unit.sequence;
                var cutMainValue = unit.cutMainValue;
                var cutFields = buildFields(cutReqIds, {
                    status: CUT_STATUSES[0],
                    slitter: slitterId,
                    materialBatch: batchId,
                    plannedRuns: plannedRuns,
                    duration: duration > 0 ? Math.ceil(duration) : '',   // #3635 п.4: «Длительность, минут» сохраняем целой (вверх)
                    timing: timing,
                    length: runLength > 0 ? runLength : '',
                    winding: normWinding(lay && lay.windDir),
                    leader: self.resolveLeaderId(lay && lay.leader), // #3569: лидер позиции → id справочника
                    material: lay && lay.mat,   // #3688: «Вид сырья» резки = сырьё раскладки
                    sequence: sequence
                });
                cutFields = addMainValueField(cutMeta, cutFields, cutMainValue);
                var payloadDiagnostics = traceCutCreatePayload('runGenerateCuts', cutMeta, cutReqIds, cutFields, self, cutCreateRequiredKeys(plannedRuns));
                if (payloadDiagnostics.length) {
                    throw new Error('Неполный payload задания ' + (layIdx + 1) + ': ' + cutWriteDiagnosticSummary(payloadDiagnostics));
                }

                // #3242: состав резки — «Партия ГП» по каждой ширине. Запоминаем id по
                // ширине, чтобы обеспечения сослались на нужную партию.
                var widthToBatchId = {};
                // #3280/#3433: доля обеспечений ЭТОГО сегмента-дня по позициям (рулоны +
                // метраж). Считаем один раз и переиспользуем для спроса/заказа «Партии ГП»
                // (createFinishedBatches) и для самих обеспечений (createSupplies).
                var segSupplies = [];
                supplyPlanForLayout(lay, posById, unit.fullPlannedRuns, posLength).forEach(function(plan) {
                    var share = splitSupplyShares(plan.rolls, plan.footage, unit.segRunsAll)[unit.segIndex] || { rolls: 0, footage: 0 };
                    var pos = posById[String(plan.positionId)] || {};
                    segSupplies.push({ positionId: plan.positionId, width: plan.width,
                        rolls: share.rolls, footage: share.footage, orderId: pos.orderId || '' });
                });
                // Спрос (Σ рулонов сегмента) и заказы по ширине «Партии ГП».
                var demandByWidth = {};
                var ordersByWidth = {};
                segSupplies.forEach(function(s) {
                    if (!(s.rolls > 0)) return;
                    var key = stripWidthKey(s.width);
                    demandByWidth[key] = round3((demandByWidth[key] || 0) + s.rolls);
                    (ordersByWidth[key] = ordersByWidth[key] || []).push(s.orderId);
                });
                function createFinishedBatches(cutId) {
                    var batchChain = Promise.resolve();
                    producedBatchesForLayout(lay, runLength).forEach(function(batch) {
                        batchChain = batchChain.then(function() {
                            // #3431/#3433/#3435: «Кол-во полос» = полос за проход (batch.strips);
                            // «Кол-во план» = полосы × проходов сегмента; «Кол-во рулонов» =
                            // спрос обеспечений этой ширины; «ID заказа» = заказы покрытых
                            // позиций (несколько → через запятую; спроса нет → пусто = запас).
                            var key = stripWidthKey(batch.width);
                            var demand = demandByWidth[key];
                            var fields = buildFinishedBatchFields(finishedBatchMeta, {
                                width: batch.width,
                                strips: batch.strips,
                                planned: finishedBatchRolls(batch.strips, plannedRuns),
                                rolls: demand > 0 ? demand : '',
                                orderId: batchOrderId(ordersByWidth[key]),
                                footage: batch.length > 0 ? batch.length : '',
                                active: '1'
                            });
                            return self.post('_m_new/' + finishedBatchMeta.id + '?JSON&up=' + encodeURIComponent(cutId), fields)
                                .then(function(res) {
                                    var bid = res && (res.obj || res.id || res.i);
                                    if (bid) widthToBatchId[stripWidthKey(batch.width)] = String(bid);
                                    nStrips += 1;
                                });
                        });
                    });
                    return batchChain;
                }

                function createSleeveTasks() {
                    if (!sleeveMeta || !sleeveReqIds) return Promise.resolve();
                    var taskChain = Promise.resolve();
                    // #3340: запланированный старт задания = плановое время старта резки.
                    positionSleeveTasksForLayout(lay, posById, plannedRuns).forEach(function(task) {
                        taskChain = taskChain.then(function() {
                            var fields = self.buildSleeveTaskFields(sleeveReqIds, task, cutMainValue);
                            return self.post('_m_new/' + sleeveMeta.id + '?JSON&up=' + encodeURIComponent(task.positionId), fields)
                                .then(function() {
                                    nSleeveTasks += 1;
                                    nSleeves += Number(task.qty) || 0;
                                });
                        });
                    });
                    return taskChain;
                }

                // #3242: обеспечение ссылается на «Партию ГП» нужной ширины (не на резку).
                // Излишек рулонов сверх обеспечений остаётся складом той же Партией ГП.
                function createSupplies() {
                    var supChain = Promise.resolve();
                    // #3280/#3433: доли сегмента уже посчитаны (segSupplies). Каждое
                    // обеспечение ссылается на «Партию ГП» своей ширины.
                    segSupplies.forEach(function(s) {
                        if (!(s.rolls > 0) && !(s.footage > 0)) return;
                        supChain = supChain.then(function() {
                            var batchId = widthToBatchId[stripWidthKey(s.width)];
                            if (!batchId) {
                                console.error('[pp] ⚙️ runGenerateCuts: нет «Партии ГП» ширины ' + s.width +
                                    ' для позиции ' + s.positionId + ' — обеспечение не создаём (не сирота)');
                                return;
                            }
                            var fields = buildSupplyFieldsForFinishedBatch(supplyMeta, {
                                finishedBatchId: batchId,
                                footage: s.footage > 0 ? s.footage : '',
                                rolls: s.rolls,
                                active: '1',
                                status: SUPPLY_STATUSES[0]
                            });
                            return self.post('_m_new/' + supplyMeta.id + '?JSON&up=' + encodeURIComponent(s.positionId), fields)
                                .then(function() { nPositions += 1; });
                        });
                    });
                    return supChain;
                }

                // 1) корневая резка, 2) Партии ГП (состав), 3) втулки, 4) обеспечения→Партия ГП.
                return self.post('_m_new/' + cutMeta.id + '?JSON&up=1', cutFields).then(function(res) {
                    var cutId = res && (res.obj || res.id || res.i);
                    if (!cutId) throw new Error('Сервер не вернул id нового задания');
                    return createFinishedBatches(cutId)
                        .then(function() { return createSleeveTasks(); })
                        .then(function() { return createSupplies(); });
                }).then(function() {
                    // Резка со всеми полосами и обеспечениями готова → +1 к прогрессу.
                    doneCuts += 1;
                    self.updateProgress(doneCuts);
                });
            });
          });   // #3280: конец units.forEach (сегменты резки по дням)
        });

        var genStartTime = Date.now();
        return chain.then(function() {
            var elapsed = ((Date.now() - genStartTime) / 1000).toFixed(1);
            console.log('[pp] 🔧 runGenerateCuts: все записи созданы за ' + elapsed + 'с. загружаем свежие данные...');
            self.updateProgress(nRecords, 'Обновление очереди…');
            return self.reload();
        }).then(function() {
            var elapsed = ((Date.now() - genStartTime) / 1000).toFixed(1);
            console.log('[pp] 🔧 runGenerateCuts: данные загружены за ' + elapsed + 'с. рендерим...');
            self.hideProgress();
            self.setBusy(false);
            self.setGenBusy(false);
            var renderStart = Date.now();
            self.render();
            var renderMs = Date.now() - renderStart;
            console.log('[pp] 🔧 runGenerateCuts: render занял ' + renderMs + 'мс');
            var totalElapsed = ((Date.now() - genStartTime) / 1000).toFixed(1);
            var reasons = self.groupSkipReasons(skipped);
            var sleeveMin = sleeveMinutes(nSleeves, self.opTimes || {});
            console.log('[pp] 🔧 runGenerateCuts: ГОТОВО за ' + totalElapsed + 'с. резок:', layouts.length, 'полос:', nStrips, 'втулок:', nSleeveTasks, 'пропущено:', skipped.length);
            self.notify('Создано ' + nRecords + ' производственных заданий (' + planningStrategyLabel(planOptions.strategy) + '), заданий на втулки ' + nSleeveTasks +
                (sleeveMin > 0 ? ' (' + sleeveMin + ' мин)' : '') +
                ', пропущено ' + skipped.length + ' позиций' + (reasons ? ' (' + reasons + ')' : ''), 'success');
            // #3792: после создания заданий пересобираем очередь по правилам (preserveOrder=false):
            // минимум переналадок (группировка сырья), при прочих равных — больше полос раньше.
            // Под каждый день — своё «Задание в производство» + «Партия ГП» + «Обеспечение»,
            // рекурсивно. Зафиксированные задания остаются на своих днях (не переносятся, не
            // разбиваются), внутри дня переставляются. Идемпотентно (#3427) — повторный прогон без
            // изменений ничего не пишет. applySplitPlan сам делает reload+render.
            return self.autoSequenceQueue(PLANNING_STRATEGY_SETUP, false);
        }).catch(function(err) {
            self.hideProgress();
            self.setBusy(false);
            self.setGenBusy(false);
            console.error('[pp] 🔧 runGenerateCuts: ОШИБКА', err.message, err.stack);
            self.notify('Ошибка генерации заданий: ' + err.message, 'error');
        });
    };

    // Сгруппировать причины пропуска → «причина ×N, …» (для итогового уведомления).
    AtexProductionPlanning.prototype.groupSkipReasons = function(skipped) {
        var counts = {};
        var order = [];
        (skipped || []).forEach(function(s) {
            var r = (s && s.reason) || 'без причины';
            if (!counts[r]) { counts[r] = 0; order.push(r); }
            counts[r] += 1;
        });
        return order.map(function(r) { return r + ' ×' + counts[r]; }).join(', ');
    };

    // Открывает в новой вкладке отчёт по пропущенным позициям (для которых генератор
    // не смог построить раскладку). Данные считаются на клиенте при генерации.
    AtexProductionPlanning.prototype.openSkippedReport = function(skipped) {
        var posById = positionMap(this.genPositions);
        var matNames = this.materialNameById || {};   // #3608: карта materialId → название сырья
        var rows = (skipped || []).map(function(s) {
            var p = posById[String(s.positionId)] || {};
            var matId = p.materialId == null ? '' : String(p.materialId);
            return {
                id: s.positionId == null ? '' : s.positionId,
                material: matNames[matId] || (matId !== '' ? '#' + matId : ''),  // #3608: название сырья
                width: (p.orderWidth != null ? p.orderWidth : p.width) || '',  // #3372: заказанная ширина (не фактическая)
                qty: p.qty || '',
                length: p.length || '',
                reason: (s && s.reason) || 'без причины'
            };
        });
        function esc(v) {
            return String(v == null ? '' : v).replace(/[&<>"]/g, function(c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
            });
        }
        var base = '/' + encodeURIComponent(this.db) + '/edit_obj/';   // #3608: ссылка на форму правки (edit_obj), а не object/
        var trs = rows.map(function(r, i) {
            return '<tr><td>' + (i + 1) + '</td>' +
                '<td><a href="' + base + esc(r.id) + '" target="_blank" rel="noopener">' + esc(r.id) + '</a></td>' +
                '<td>' + esc(r.material) + '</td>' +
                '<td>' + esc(r.width) + '</td>' +
                '<td>' + esc(r.qty) + '</td>' +
                '<td>' + esc(r.length) + '</td>' +
                '<td>' + esc(r.reason) + '</td></tr>';
        }).join('');
        var html = '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
            '<title>Пропущенные позиции (' + rows.length + ')</title>' +
            '<style>body{font:14px/1.45 system-ui,Arial,sans-serif;margin:24px;color:#1a1a1a}' +
            'h1{font-size:18px;margin:0 0 4px}p{color:#666;margin:0 0 16px;max-width:760px}' +
            'table{border-collapse:collapse;width:100%;max-width:900px}' +
            'th,td{border:1px solid #ddd;padding:6px 10px;text-align:left}' +
            'th{background:#f4f6fa}tr:nth-child(even) td{background:#fafbfc}' +
            'a{color:#1283da}</style></head><body>' +
            '<h1>Пропущенные позиции — ' + rows.length + '</h1>' +
            '<p>Согласованные позиции заказов, для которых генератор не смог построить раскладку и не создал производственные задания. ' +
            'Проверьте параметры (ширина джамбо, сырьё) и повторите генерацию.</p>' +
            '<table><thead><tr><th>№</th><th>ID позиции</th><th>Сырьё</th><th>Ширина</th><th>Кол-во</th><th>Длина, м</th><th>Причина пропуска</th></tr></thead>' +
            '<tbody>' + (trs || '<tr><td colspan="7">Нет пропущенных позиций</td></tr>') + '</tbody></table></body></html>';
        var w = window.open('', '_blank');
        if (!w) { this.notify('Браузер заблокировал новую вкладку. Разрешите всплывающие окна для этого сайта.', 'error'); return; }
        w.document.open();
        w.document.write(html);
        w.document.close();
    };

    function normalizeConfirmActions(okLabel, onConfirm) {
        if (Array.isArray(okLabel)) {
            return okLabel.map(function(action, i) {
                var a = action || {};
                return {
                    label: a.label || a.text || 'Да',
                    // #3475: warning-кнопка (жёлтая) не должна одновременно быть primary.
                    warning: a.warning === true,
                    primary: a.warning !== true && (a.primary === true || i === 0),
                    inline: a.inline === true,
                    onConfirm: a.onConfirm || a.action || a.handler
                };
            }).filter(function(action) { return typeof action.onConfirm === 'function'; });
        }
        return [{ label: okLabel || 'Да', primary: true, onConfirm: onConfirm }];
    }

    // Подтверждение без native confirm. Single-action flow может использовать
    // mainAppController.showDeleteConfirmModal; multi-action выбор рендерится inline.
    AtexProductionPlanning.prototype.confirmAction = function(message, actionsEl, okLabel, onConfirm) {
        var actions = normalizeConfirmActions(okLabel, onConfirm);
        if (!actions.length) return;
        if (actions.length === 1 && !actions[0].inline && typeof window !== 'undefined' && window.mainAppController &&
            typeof window.mainAppController.showDeleteConfirmModal === 'function') {
            window.mainAppController.showDeleteConfirmModal(message).then(function(ok) {
                if (ok) actions[0].onConfirm();
            });
            return;
        }
        var host = actionsEl || (this.root && this.root.querySelector('.atex-pp-panel-actions')) || this.root;
        if (host && host.querySelector && host.querySelector('.atex-pp-confirm-bar')) return;
        var bar = el('div', { class: 'atex-pp-confirm-bar' });
        bar.appendChild((message && message.nodeType) ? message : el('span', { class: 'atex-pp-confirm-msg', text: message }));
        var cancelBtn = el('button', { class: 'atex-pp-btn', type: 'button', text: 'Отмена' });
        function removeBar() { if (bar.parentNode) bar.parentNode.removeChild(bar); }
        actions.forEach(function(action) {
            var cls = 'atex-pp-btn' + (action.warning ? ' atex-pp-btn-warning' : (action.primary ? ' atex-pp-btn-primary' : ''));
            var btn = el('button', { class: cls, type: 'button', text: action.label });
            btn.addEventListener('click', function() { removeBar(); action.onConfirm(); });
            bar.appendChild(btn);
        });
        cancelBtn.addEventListener('click', function() { removeBar(); });
        bar.appendChild(cancelBtn);
        if (host) {
            host.appendChild(bar);
        } else {
            actions[0].onConfirm();
        }
    };

    // #3698/#3700: пересчитать и сохранить расчётные минуты каждой резки — «Наладка ножей,
    // мин» (KNIFE), «Сырье/намотка, мин» (MATERIAL_WINDING) и «Резка и Лидер» (намотка + лидер) —
    // чтобы Гант (cut-gantt) и отчёты
    // брали готовые минуты, а не пересчитывали по соседям. Порядок исполнения — по
    // «Очередности» в пределах станка (как orderCutsInGroup Ганта); первая резка — от текущей
    // заправки станка (prev_cut_setup), нет данных → настройка ножей с нуля. Пишет только
    // изменившиеся (diff против отчётных значений), тихо и БЕЗ reload (свой экран РМ считает
    // наладку на лету). Колонок ещё нет в метаданных → no-op. Ошибки глотает: доп-колонки не
    // должны валить сохранение очереди/плана. Вызывается после сохранений порядка/плана.
    // #3778: тайминг-поля задания (t96067 «Наладка ножей, мин» / t96069 «Сырье/намотка, мин» /
    // t96778 «Резка и Лидер») одним набором реквизитов для _m_set. Отсутствующие reqId не пишем.
    function setupTimingFields(reqs, u) {
        var fields = {};
        if (reqs.knifeReq) fields['t' + reqs.knifeReq] = String(u.knife);
        if (reqs.matReq) fields['t' + reqs.matReq] = String(u.material);
        if (reqs.cutTimeReq) fields['t' + reqs.cutTimeReq] = String(u.cutTime);   // #3700
        return fields;
    }

    // #3778: вычислить тайминг-поля резок В ПОРЯДКЕ ПЛАНА и вернуть { reqs, updates } —
    // updates только для резок, чьи хранимые значения ПУСТЫ или разошлись с расчётом (пустое
    // хранимое всегда «изменилось» → force-write, отсюда наполняются «пустые опять» поля).
    // onlyIds (массив id) ограничивает НАБОР ЗАПИСИ (снимок при «Зафиксировать»), но порядок и
    // переналадка считаются по ВСЕЙ очереди станка — иначе у не-первой резки терялся предшественник.
    AtexProductionPlanning.prototype.computeCutSetupUpdates = function(onlyIds) {
        var meta = this.meta.cut;
        var reqs = { knifeReq: null, matReq: null, cutTimeReq: null };
        if (!meta) return { reqs: reqs, updates: [] };
        reqs.knifeReq = reqIdByName(meta, CUT_REQ.knifeSetupMin);
        reqs.matReq = reqIdByName(meta, CUT_REQ.materialWindingMin);
        reqs.cutTimeReq = reqIdByName(meta, CUT_REQ.cutAndLeader);   // #3700: «Резка и Лидер»
        if (!reqs.knifeReq && !reqs.matReq && !reqs.cutTimeReq) return { reqs: reqs, updates: [] };   // колонок ещё нет в таблице
        var onlySet = null;
        if (onlyIds) { onlySet = {}; (onlyIds || []).forEach(function(id) { onlySet[String(id)] = true; }); }
        // #3702: считаем теми же временами и в ТОМ ЖЕ порядке, что и план на экране, иначе
        // у задания заполнялась «Сырье/намотка», которой в плане нет.
        //  • this.changeTimes — структурированные веса переналадок (MATERIAL_WINDING / KNIFE /
        //    BETWEEN_CUTS). this.opTimes — это raw {КОД: мин} без этих ключей, поэтому
        //    setupBreakdown молча брал DEFAULT-веса (расхождение с планом).
        //  • Порядок — groupBySlitter (день плана → «Очередность» → ножи), как очередь станка в
        //    renderQueue. Прежний (sequence, planDate) перемешивал дни («Очередность» сбрасывается
        //    на день), и у НЕ-первой резки дня предшественником становилась резка другого дня —
        //    отсюда ложная «смена сырья».
        var times = this.changeTimes || DEFAULT_OP_TIMES;
        var betweenCuts = Number(times.BETWEEN_CUTS != null ? times.BETWEEN_CUTS : DEFAULT_OP_TIMES.BETWEEN_CUTS) || 0;
        // #3876: тот же источник заправки, что и план (splitMachineQueue): станок в отпуске на
        // день базы → заправка обнулена → первая резка после отпуска считает полную настройку.
        var planBaseMidnightMs = planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this));
        var prevBySlitter = this.planningPrevSetupBySlitter(planBaseMidnightMs);
        var updates = [];
        groupBySlitter(this.cuts || []).forEach(function(group) {
            var sid = group.slitter && group.slitter.id != null ? String(group.slitter.id) : '';
            var arr = group.cuts;   // уже упорядочены как очередь станка (день → «Очередность» → ножи)
            var carrySetup = prevBySlitter[sid];
            var carryPrevCut = (carrySetup && arr.length) ? carryOverPrevCut(carrySetup, arr[0]) : null;
            var cols = setupActivityColumns(arr, times, carryPrevCut);
            arr.forEach(function(c) {
                if (onlySet && !onlySet[String(c.id)]) return;   // снимок — только выбранные резки
                var want = cols[String(c.id)] || { knifeMin: 0, materialWindingMin: 0 };
                // #3715: пишем ЦЕЛЫЕ минуты (Math.round). Дробные значения (#3708) перестали
                // записываться — поля не приняли нецелое, _m_set падал и обрывал запись всех трёх
                // колонок («Наладка ножей»/«Сырье/намотка»/«Резка и Лидер») для всей очереди.
                // Налезание баров (#3708) убирает обрезка по старту следующего задания в Ганте
                // (cut-gantt.js), а не дробная длительность.
                var wantK = Math.round(want.knifeMin), wantM = Math.round(want.materialWindingMin);
                // #3700: «Резка и Лидер» = «Длительность, минут» + лидер (BETWEEN_CUTS × число резок
                // цуга, cutLeaderRuns). Зависит только от самой резки.
                var wantT = Math.round(stripNum(c.duration) + betweenCuts * cutLeaderRuns(c));
                // Колонку учитываем в diff только если она есть в метаданных (иначе её не пишем
                // и не считаем «изменившейся» — иначе были бы лишние записи на каждом сохранении).
                // Пустое хранимое (cur пуст) → всегда «изменилось» → force-write (#3778).
                function changed(req, cur, val) {
                    return req && (!(cur != null && cur !== '') || Math.round(stripNum(cur)) !== val);
                }
                if (changed(reqs.knifeReq, c.storedKnifeSetupMin, wantK)
                    || changed(reqs.matReq, c.storedMaterialWindingMin, wantM)
                    || changed(reqs.cutTimeReq, c.storedCutAndLeaderMin, wantT)) {
                    updates.push({ cutId: c.id, knife: wantK, material: wantM, cutTime: wantT });
                    c.storedKnifeSetupMin = String(wantK);        // локально — чтобы не переписывать дважды
                    c.storedMaterialWindingMin = String(wantM);
                    c.storedCutAndLeaderMin = String(wantT);
                }
            });
        });
        return { reqs: reqs, updates: updates };
    };

    AtexProductionPlanning.prototype.persistCutSetupColumns = function() {
        var self = this;
        var res = this.computeCutSetupUpdates(null);
        var reqs = res.reqs, updates = res.updates;
        if (!updates.length) return Promise.resolve();
        // «Время старта» (planStart) пишет splitMachineQueue/applySplitPlan — единственный
        // источник правды по дню/нахлёсту настройки (#3805, #3635 п.5). Здесь — только тайминг
        // (Наладка ножей / Сырьё-намотка / Резка и Лидер), planStart не трогаем.
        var chain = Promise.resolve();
        updates.forEach(function(u) {
            chain = chain.then(function() {
                var fields = setupTimingFields(reqs, u);
                if (!Object.keys(fields).length) return;
                return self.post('_m_set/' + u.cutId + '?JSON', fields);
            });
        });
        // #3778: ошибки записи тайминга больше НЕ глотаем молча — раньше тихий catch скрывал,
        // почему «Наладка ножей»/«Сырье/намотка»/«Резка и Лидер» оставались пустыми. Сохранение
        // самой очереди (старт/очередность) идёт отдельной цепочкой — его не валим.
        return chain.catch(function(err) {
            self.notify('Не удалось сохранить тайминг заданий (Наладка ножей / Сырье-намотка / '
                + 'Резка и Лидер): ' + (err && err.message || err), 'error');
        });
    };

    // DRY-метод сохранения изменённых «Очередностей» (ручная перестановка ↑↓).
    // pairs = [{cutId, sequence}]. opts.successMessage — если передан, показывается
    // после reload вместо дефолтного; opts.silent — не показывать уведомление.
    // Если pairs пуст — уведомляет и возвращает resolved Promise.
    AtexProductionPlanning.prototype.saveSequences = function(pairs, opts) {
        var self = this;
        var o = opts || {};
        if (!pairs || !pairs.length) {
            if (!o.silent) self.notify('Очередь не изменилась', 'info');
            return Promise.resolve(true);
        }

        var seqReqId = reqIdByName(this.meta.cut, CUT_REQ.sequence);
        if (!seqReqId) {
            self.notify('Реквизит «' + CUT_REQ.sequence + '» не найден в метаданных', 'error');
            return Promise.resolve(false);
        }

        this.setBusy(true);

        // Последовательное сохранение (чтобы не перегружать сервер).
        var fieldKey = 't' + seqReqId;
        // #3280: t1078 = главное значение «Производственной резки» (плановое время старта).
        // Пишется тем же _m_set (docs/kb/crud.md: _m_set задаёт любую колонку, включая первую).
        var mainKey = (this.meta.cut && this.meta.cut.id != null) ? 't' + this.meta.cut.id : null;
        var chain = Promise.resolve();
        pairs.forEach(function(p) {
            chain = chain.then(function() {
                var fields = {};
                if (p.sequence != null && p.sequence !== '') fields[fieldKey] = String(p.sequence);
                // #3280: плановое время старта (Unix-штамп) → t1078, если задано и валидно.
                var ts = Number(p.planStartTs);
                if (mainKey && isFinite(ts) && ts > 0) fields[mainKey] = String(ts);
                return self.post('_m_set/' + p.cutId + '?JSON', fields);
            });
        });

        return chain.then(function() {
            return self.reload();
        }).then(function() {
            return self.persistCutSetupColumns();   // #3698: пересчитать хранимые активности под новый порядок
        }).then(function() {
            self.setBusy(false);
            self.render();
            if (!o.silent) {
                self.notify(o.successMessage || 'Очередь сохранена', 'success');
            }
            return true;
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка сохранения очереди: ' + err.message, 'error');
            return false;
        });
    };

    // #3280: применить план разбиения резок по дням (planCutOperations):
    //   updates → _m_set (очередность + t1078 + плановые проходы сегодня);
    //   creates → _m_new запись-продолжение B (на след. день) + копия Полос (тот же
    //     per-pass раскрой) + Обеспечение долей сегмента (splitSupplyShares, пропорц. проходам);
    //   deletes → _m_del записей-продолжений прежних цепочек (mergeContinuationChains).
    // Обеспечение «сегодня» (A) уменьшается до своей доли. Последовательно (не грузим сервер).
    AtexProductionPlanning.prototype.applySplitPlan = function(ops) {
        var self = this;
        var cutMeta = this.meta.cut, fbMeta = this.meta.finishedBatch, supMeta = this.meta.supply;
        if (!cutMeta) { self.notify('Не найдены метаданные «' + TABLE.cut + '»', 'error'); return Promise.resolve(false); }
        var seqReqId = reqIdByName(cutMeta, CUT_REQ.sequence);
        var runsReqId = reqIdByAnyName(cutMeta, CUT_PLANNED_RUNS_NAMES);   // live: «Кол-во резок план»
        var mainKey = cutMeta.id != null ? 't' + cutMeta.id : null;
        // #3808: перед резолвом цепочек ЛЕЧИМ «Вид сырья» переходящих сегментов с пустым
        // материалом (станок|намотка|ножи → единственное непустое сырьё группы). Иначе пустой
        // материал продолжения рвёт continuationSignature → mergeContinuationChains не находит
        // голову → materialForCutId возвращает пусто → продолжение дня N+1 уходит без сырья.
        healContinuationMaterials(self.cuts || []);
        var cutsById = {}; (self.cuts || []).forEach(function(c) { cutsById[String(c.id)] = c; });
        var lengthReqId = reqIdByName(cutMeta, CUT_REQ.length);   // #3781: «Метраж, м» (длина прогона)
        var cutReqIds = {
            slitter: reqIdByName(cutMeta, CUT_REQ.slitter),
            materialBatch: reqIdByName(cutMeta, CUT_REQ.materialBatch),
            plannedRuns: runsReqId,
            status: reqIdByName(cutMeta, CUT_REQ.status),
            sequence: seqReqId,
            winding: reqIdByName(cutMeta, CUT_REQ.winding),
            leader: reqIdByName(cutMeta, CUT_REQ.leader),   // #3569: лидер копируется в запись-продолжение
            length: lengthReqId,   // #3781: «Метраж, м» — длина прогона (одинакова у всех сегментов цепочки)
            material: reqIdByName(cutMeta, CUT_REQ.material),   // #3795: «Вид сырья» — копируется в продолжение, иначе очередь следующего дня без сырья
            firstPart: reqIdByName(cutMeta, CUT_REQ.firstPart)   // #3892: «ID первой части» (голова цепочки) — на голову и все продолжения
        };
        var firstPartReqId = cutReqIds.firstPart;
        // #3781: длина прогона по id любой записи цепочки = длина прогона её ГОЛОВЫ. Записи-
        // продолжения дробления по дням раньше не получали «Метраж, м», и cutRunLength
        // откатывался к ПОДЕЛЁННОМУ метражу обеспечения (splitSupplyShares делит footage
        // пропорционально проходам) → в очереди мелькала заниженная длина (281.25 вместо 450).
        // Длина прогона одинакова у всех сегментов — берём её у головы и пишем во все сегменты.
        var chainHeadById = {};
        var splitChains = mergeContinuationChains(self.cuts || []).chainByLogical || {};
        Object.keys(splitChains).forEach(function(head) {
            (splitChains[head] || [head]).forEach(function(m) { chainHeadById[String(m)] = String(head); });
        });
        function runLenForCutId(cutId) {
            var head = chainHeadById[String(cutId)] || String(cutId);
            var hc = cutsById[head];
            return hc ? cutRunLength(hc, self.supplies, self.footageBySupply) : 0;
        }
        // #3795: «Вид сырья» цепочки = сырьё её ГОЛОВЫ (у всех сегментов одно сырьё). Берём
        // у головы, потому что у реюзнутого продолжения, созданного до фикса, поле пустое.
        function materialForCutId(cutId) {
            var head = chainHeadById[String(cutId)] || String(cutId);
            var hc = cutsById[head];
            return hc && hc.materialId != null && String(hc.materialId) !== '' ? String(hc.materialId) : '';
        }
        // buildFields ключ для проходов — по runsReqId (live «Кол-во резок план»).
        var createsByParent = {};
        (ops.creates || []).forEach(function(cr) { (createsByParent[cr.parentCutId] = createsByParent[cr.parentCutId] || []).push(cr); });
        var updateByCut = {};
        (ops.updates || []).forEach(function(u) { updateByCut[u.cutId] = u; });

        // #3635 п.3: сохранение плана резок (день-заполнение) пишет десятки записей —
        // показываем форму ожидания с прогрессом, а не «зависшую» заблокированную страницу.
        var splitTotal = (ops.updates || []).length + Object.keys(createsByParent).length + (ops.deletes || []).length;
        var splitDone = 0;
        function splitBump() { self.updateProgress(++splitDone); }
        this.setBusy(true);
        if (splitTotal > 0) this.showProgress('Сохранение плана резок…', splitTotal);
        var chain = Promise.resolve();

        // 1) Обновить существующие записи (первый сегмент каждой логической резки).
        // ⚠️ Первая колонка (плановое время старта) пишется ТОЛЬКО через _m_save (GUIDE
        // issue #775: _m_set первую колонку НЕ задаёт). Остальные реквизиты — _m_set.
        (ops.updates || []).forEach(function(u) {
            chain = chain.then(function() {
                var ts = Number(u.planStartTs);
                // DATETIME первая колонка: _m_save с t{tableId} (проверено на live: _m_set→403,
                // _m_save{val} не пишет datetime, _m_save{t1078}=штамп — работает).
                var mainFields = {}; if (mainKey) mainFields[mainKey] = String(ts);
                var saveMain = (mainKey && isFinite(ts) && ts > 0)
                    ? self.post('_m_save/' + u.cutId + '?JSON', mainFields)
                    : Promise.resolve();
                return saveMain.then(function() {
                    var fields = {};
                    if (u.sequence != null && seqReqId) fields['t' + seqReqId] = String(u.sequence);
                    if (u.plannedRuns != null && runsReqId) fields['t' + runsReqId] = String(u.plannedRuns);
                    // #3635 п.5: сегмент НАСТРОЙКИ (0 проходов) — обнуляем сохранённую
                    // «Длительность, минут», иначе остаётся старая (намотка целой резки) и
                    // расписание считает настройку длинной резкой, ломая раскладку по дням.
                    var durReqId = reqIdByName(cutMeta, CUT_REQ.duration);
                    if (Number(u.plannedRuns) === 0 && durReqId) fields['t' + durReqId] = '0';
                    // #3781: восстановить «Метраж, м» = длине прогона головы цепочки. Для головы
                    // это та же длина (запись no-op по значению), для реюзнутого продолжения —
                    // лечит ранее пустую длину (иначе очередь брала поделённый метраж обеспечения).
                    if (lengthReqId) {
                        var ulen = runLenForCutId(u.cutId);
                        if (ulen > 0) fields['t' + lengthReqId] = String(round3(ulen));
                    }
                    // #3795: восстановить «Вид сырья» = сырью головы цепочки. Для головы — no-op
                    // (то же сырьё); для реюзнутого продолжения, созданного до фикса с пустым
                    // «Вид сырья», лечит пустоту, иначе очередь следующего дня без сырья («—»).
                    var matReqId = reqIdByName(cutMeta, CUT_REQ.material);
                    if (matReqId) {
                        var umat = materialForCutId(u.cutId);
                        if (umat) fields['t' + matReqId] = umat;
                    }
                    // #3892: «ID первой части» — голова цепочки (для головы = собственный id).
                    // Проставляем явный маркер на существующие записи, чтобы цепочка опознавалась
                    // без эвристики; в planCutOperations firstPartId всегда задан.
                    if (firstPartReqId) {
                        var uHead = (u.firstPartId != null && u.firstPartId !== '')
                            ? String(u.firstPartId) : (chainHeadById[String(u.cutId)] || String(u.cutId));
                        if (uHead) fields['t' + firstPartReqId] = uHead;
                    }
                    if (!Object.keys(fields).length) return;
                    return self.post('_m_set/' + u.cutId + '?JSON', fields);
                });
            }).then(splitBump);
        });

        // 2) Создать записи-продолжения с копией Полос и долей Обеспечения.
        Object.keys(createsByParent).forEach(function(parentId) {
            var parentCut = cutsById[parentId];
            var crs = createsByParent[parentId];
            var upd = updateByCut[parentId];
            var parentRunLen = runLenForCutId(parentId);   // #3781: длина прогона цепочки (для «Метраж, м» продолжений)
            var parentMaterial = materialForCutId(parentId);   // #3795: «Вид сырья» цепочки (для продолжений)
            var aRuns = upd ? (Number(upd.plannedRuns) || 0) : 0;
            var segRuns = [aRuns].concat(crs.map(function(c) { return Number(c.plannedRuns) || 0; }));
            chain = chain.then(function() { return self.loadStripsForCut(parentId); }).then(function(parentStrips) {
                var parentSupplies = (self.supplies || []).filter(function(s) { return String(s.cutId) === String(parentId); });
                var shareBySupply = parentSupplies.map(function(s) { return { s: s, shares: splitSupplyShares(s.rolls, s.footage, segRuns) }; });
                // #3433: спрос на «Партию ГП» по сегментам (Σ долей обеспечений этой партии).
                // Ключ = id записи «Партии ГП» (= id полосы parentStrips, = supply.finishedBatchId).
                var demandByBatchSeg = {};
                shareBySupply.forEach(function(item) {
                    var bId = String(item.s.finishedBatchId);
                    var arr = demandByBatchSeg[bId] || (demandByBatchSeg[bId] = []);
                    (item.shares || []).forEach(function(sh, i) { arr[i] = round3((arr[i] || 0) + ((sh && sh.rolls) || 0)); });
                });
                var cChain = Promise.resolve();
                // 2a) уменьшить Обеспечение A до доли сегмента 0.
                shareBySupply.forEach(function(item) {
                    cChain = cChain.then(function() {
                        var sh = item.shares[0] || { rolls: 0, footage: 0 };
                        var f = buildSupplyFieldsForFinishedBatch(supMeta, {
                            finishedBatchId: item.s.finishedBatchId,
                            footage: sh.footage > 0 ? sh.footage : '', rolls: sh.rolls,
                            active: '1', status: SUPPLY_STATUSES[0]
                        });
                        return self.post('_m_set/' + item.s.id + '?JSON', f);
                    });
                });
                // 2a-bis) #3433: «Партии ГП» резки A пересчитать под сегмент 0 — «Кол-во
                // план» = полосы × проходов A (aRuns), «Кол-во рулонов» = спрос сегмента 0.
                (parentStrips || []).forEach(function(st) {
                    cChain = cChain.then(function() {
                        var seg0 = (demandByBatchSeg[String(st.id)] || [])[0] || 0;
                        var f = buildFinishedBatchFields(fbMeta, {
                            planned: finishedBatchRolls(st.qty, aRuns),
                            rolls: seg0 > 0 ? seg0 : ''
                        });
                        if (!Object.keys(f).length) return;
                        return self.post('_m_set/' + st.id + '?JSON', f);
                    });
                });
                // 2b) каждое продолжение B (сегменты 1..N).
                crs.forEach(function(cr, ci) {
                    var segIdx = ci + 1;
                    cChain = cChain.then(function() {
                        var cutFields = buildFields(cutReqIds, {
                            status: (parentCut && parentCut.status) || CUT_STATUSES[0],
                            slitter: parentCut && parentCut.slitter && parentCut.slitter.id,
                            materialBatch: parentCut && parentCut.batchId,
                            // #3795: «Вид сырья» цепочки → продолжение. Карточка очереди берёт сырьё
                            // из cut_material (своего реквизита резки), а обеспечения продолжения не
                            // привязаны к нему по «Заданию», поэтому materialByCut его не восстановит.
                            material: parentMaterial,
                            plannedRuns: cr.plannedRuns,
                            sequence: cr.sequence,
                            winding: normWinding(parentCut && parentCut.winding),
                            // #3569: лидер родителя (одна метка из cut_leader) → id справочника.
                            leader: self.resolveLeaderId(parentCut && parentCut.leaders && parentCut.leaders.length === 1 ? parentCut.leaders[0] : ''),
                            // #3781: «Метраж, м» = длина прогона цепочки. Без неё cutRunLength брал
                            // поделённый метраж обеспечения и показывал заниженную длину.
                            length: parentRunLen > 0 ? round3(parentRunLen) : '',
                            // #3892: «ID первой части» = id головы (parentId) — связывает продолжение
                            // с первой частью явно, без эвристики continuationSignature.
                            firstPart: (cr.firstPartId != null && cr.firstPartId !== '') ? String(cr.firstPartId) : String(parentId)
                        });
                        cutFields = addMainValueField(cutMeta, cutFields, cr.planStartTs);
                        return self.post('_m_new/' + cutMeta.id + '?JSON&up=1', cutFields).then(function(res) {
                            var bId = res && (res.obj || res.id || res.i);
                            if (!bId) throw new Error('Сервер не вернул id продолжения задания');
                            var stripMap = {};
                            // Главное значение B (плановое время старта) — _m_save с t{tableId}.
                            var bChain = Promise.resolve().then(function() {
                                var ts2 = Number(cr.planStartTs);
                                if (!mainKey || !(isFinite(ts2) && ts2 > 0)) return;
                                var mf = {}; mf[mainKey] = String(ts2);
                                return self.post('_m_save/' + bId + '?JSON', mf);
                            });
                            (parentStrips || []).forEach(function(st) {
                                bChain = bChain.then(function() {
                                    // #3431/#3433: st.qty — полос за проход; «Кол-во план»
                                    // продолжения = полосы × проходов сегмента (cr.plannedRuns);
                                    // «Кол-во рулонов» = спрос этого сегмента; «ID заказа»
                                    // копируется из родительской полосы.
                                    var segDemand = (demandByBatchSeg[String(st.id)] || [])[segIdx] || 0;
                                    var f = buildFinishedBatchFields(fbMeta, { width: st.width, strips: st.qty,
                                        planned: finishedBatchRolls(st.qty, cr.plannedRuns),
                                        rolls: segDemand > 0 ? segDemand : '',
                                        orderId: st.orderId || '', active: '1' });
                                    return self.post('_m_new/' + fbMeta.id + '?JSON&up=' + encodeURIComponent(bId), f).then(function(r2) {
                                        var nid = r2 && (r2.obj || r2.id || r2.i);
                                        if (nid) stripMap[String(st.id)] = String(nid);
                                    });
                                });
                            });
                            shareBySupply.forEach(function(item) {
                                bChain = bChain.then(function() {
                                    var sh = item.shares[segIdx] || { rolls: 0, footage: 0 };
                                    if (!(sh.rolls > 0) && !(sh.footage > 0)) return;
                                    if (item.s.positionId == null) return;
                                    var fb = stripMap[String(item.s.finishedBatchId)] || item.s.finishedBatchId;
                                    var f = buildSupplyFieldsForFinishedBatch(supMeta, {
                                        finishedBatchId: fb,
                                        footage: sh.footage > 0 ? sh.footage : '', rolls: sh.rolls,
                                        active: '1', status: SUPPLY_STATUSES[0]
                                    });
                                    return self.post('_m_new/' + supMeta.id + '?JSON&up=' + encodeURIComponent(item.s.positionId), f);
                                });
                            });
                            return bChain;
                        });
                    });
                });
                return cChain;
            }).then(splitBump);
        });

        // 3) Удалить записи-продолжения прежних цепочек (их Полосы/дети каскадятся).
        (ops.deletes || []).forEach(function(cutId) {
            chain = chain.then(function() {
                var supplies = self.supplies || [];
        
                // Партии ГП, подчинённые удаляемой резке
                var fbIds = {};
                supplies.forEach(function(s) {
                    if (s && String(s.cutId) === String(cutId) && s.finishedBatchId) {
                        fbIds[String(s.finishedBatchId)] = true;
                    }
                });
        
                // Обеспечения, привязанные к этим партиям ГП (могут не иметь cutId)
                var supplyIds = [];
                supplies.forEach(function(s) {
                    if (s && s.id && s.finishedBatchId && fbIds[String(s.finishedBatchId)]) {
                        supplyIds.push(String(s.id));
                    }
                });
        
                // 1) удаляем обеспечения
                var inner = Promise.resolve();
                supplyIds.forEach(function(sid) {
                    inner = inner.then(function() {
                        return self.post('_m_del/' + encodeURIComponent(sid) + '?JSON', {});
                    });
                });
                // 2) удаляем партии ГП
                Object.keys(fbIds).forEach(function(fbId) {
                    inner = inner.then(function() {
                        return self.post('_m_del/' + encodeURIComponent(fbId) + '?JSON', {});
                    });
                });
                // 3) удаляем саму резку
                inner = inner.then(function() {
                    return self.post('_m_del/' + encodeURIComponent(cutId) + '?JSON', {});
                });
                return inner;
            }).then(splitBump);
        });
        return chain.then(function() { return self.reload(); }).then(function() {
            return self.persistCutSetupColumns();   // #3698: активности переналадки по итогам план-разбиения
        }).then(function() {
            self.hideProgress(); self.setBusy(false); self.render(); return true;
        }).catch(function(err) {
            self.hideProgress(); self.setBusy(false);
            self.notify('Ошибка разбиения заданий: ' + err.message, 'error');
            return false;
        });
    };

    // Авто-перестройка «Очередности» загруженных резок (#3421). «Сгенерировать резки»
    // само планирует очередь — отдельной кнопки нет. Пересобирает порядок каждого
    // станко-дня (planCutOperations → orderCuts по реальным минутам переналадки #3268,
    // ножи по убыванию #3130), разбивает по дням (#3280) и сохраняет изменившуюся
    // «Очередность»/время старта/проходы через applySplitPlan. Тихая (без подтверждения
    // и без уведомления — их даёт вызывающая генерация). Ручную перестановку (↑↓)
    // оператор делает ПОСЛЕ генерации. Ничего не изменилось → Promise<false> без записи.
    // → Promise<boolean> (true, если что-то применилось).
    // #3619: preserveOrder=true — НЕ пересобирать очередь по стратегии, а только расщепить
    // задания, переходящие границу рабочего дня, на по-дневные сегменты, СОХРАНЯЯ текущий
    // порядок очереди. Без флага (legacy #3421) — полная пересборка «Очередности» по SETUP/FATIGUE.
    AtexProductionPlanning.prototype.autoSequenceQueue = function(strategy, preserveOrder) {
        var self = this;
        if (!(self.cuts && self.cuts.length)) return Promise.resolve(false);
        var planOptions = makePlanningOptions(strategy || PLANNING_STRATEGY_SETUP, self.changeTimes);

        // #3280: план разбиения по дням + плановое время старта (t1078). База — дата
        // из фильтра (.atex-pp-input), без неё — сегодня.
        var dayWindow = self.workingWindow();
        var planBaseMidnightMs = planBaseMidnightFrom(self.filter && self.filter.date, controllerNowMs(self));
        var windPoints = windingPointsFromTimes(self.opTimes || {});
        var perPassByCut = {};
        // #3658: якорь дня по «Дате план» каждого задания (смещение от базы=дня «С»). Без него
        // автозаполнение дней переписывало planStartTs истории: генерация с 4.06 утаскивала
        // задания 30.05 в 4.06. Привязываем каждое задание к ЕГО рабочему дню (может быть и
        // раньше базы → отрицательное смещение). Пустая «Дата план» — без якоря.
        var dayAnchorByCut = {};
        var dueKeyByCut = {};   // #3815: «Срок изготовления» задания = самый ранний срок обеспечиваемых позиций (EDD)
        self.cuts.forEach(function(c) {
            perPassByCut[String(c.id)] = windingMinutes(cutRunLength(c, self.supplies, self.footageBySupply), windPointsForCut(c.isFoil, windPoints)); // #3606
            var off = dayOffsetFromBase(c.planDate, planBaseMidnightMs);
            if (off != null) dayAnchorByCut[String(c.id)] = off;
            var dueKeys = cutDueKeys(c, self.supplies, self.genPositions);   // #3815
            if (dueKeys.length) dueKeyByCut[String(c.id)] = dueKeys[0];
        });
        // #3660: перепланируем ТОЛЬКО выбранный диапазон дат [С; По] — не лезем в другие даты.
        // Пустой край → null (без ограничения с этой стороны).
        var fromStr = String(self.filter && self.filter.date || '').trim();
        var toStr = String(self.filter && self.filter.dateTo || '').trim();
        var ops = planCutOperations(self.cuts, {
            weights: planOptions,
            times: self.changeTimes,
            dayStartMin: dayWindow.startMin,
            dayEndMin: dayWindow.cutEndMin,
            dayEndHourMin: dayWindow.endMin,   // #3847: DAY_END_HOUR (реальный конец смены) для лимита нахлёста
            maxOverworkCutsMin: dayWindow.maxOverworkCutsMin,   // #3847: макс. нахлёст резки за DAY_END_HOUR
            maxOverworkTuneMin: dayWindow.maxOverworkTuneMin,   // #3847: макс. нахлёст настройки за DAY_END_HOUR
            perPassByCut: perPassByCut,
            planBaseMidnightMs: planBaseMidnightMs,
            lunchStartMin: dayWindow.lunchStartMin,
            lunchDurationMin: dayWindow.lunchDurationMin,
            preserveOrder: preserveOrder,   // #3619: только заполнить дни, не пересобирая порядок
            dayAnchorByCut: dayAnchorByCut,   // #3658: привязка к дню «Даты план»
            dueKeyByCut: dueKeyByCut,   // #3815: EDD — задание с более ранним сроком на более ранний день
            scopeFromKey: fromStr === '' ? null : planDateDayKey(fromStr),   // #3660: scope = диапазон фильтра
            scopeToKey: toStr === '' ? null : planDateDayKey(toStr),
            firstCutSetup: true,   // #3669 п.2: первая задача очереди резервирует настройку ножей
            prevSetupBySlitter: self.planningPrevSetupBySlitter(planBaseMidnightMs),   // #3853/#3876: заправка станков; станок в отпуске обнулён → первая резка после отпуска считает настройку с нуля
            gapFill: true,   // #3739: не оставлять простоев в смене — тянуть будущие резки в хвост, нахлёст разрешён
            blockedRangesBySlitter: self.blockedRangesBySlitter(planBaseMidnightMs)   // #3764: окна «Отпуска» по станкам
        });

        // Родители разбиений нужны в updates всегда (для расчёта долей Обеспечения).
        var createParents = {};
        (ops.creates || []).forEach(function(cr) { createParents[String(cr.parentCutId)] = true; });
        var cutsById = {};
        self.cuts.forEach(function(c) { cutsById[String(c.id)] = c; });
        // Обновляем только то, что реально изменилось (очередность / время старта / проходы).
        var changedUpdates = (ops.updates || []).filter(function(u) {
            if (createParents[String(u.cutId)]) return true;
            var cut = cutsById[String(u.cutId)];
            if (!cut) return false;
            var seqChanged = Number(cut.sequence) !== u.sequence;
            var tsNew = Number(u.planStartTs);
            var tsOld = Number(cut.number);   // #3242: главное значение = плановая дата старта (t1078)
            var tsChanged = isFinite(tsNew) && tsNew > 0 && tsNew !== tsOld;
            var runsChanged = Number(cut.plannedRuns) !== Number(u.plannedRuns);
            return seqChanged || tsChanged || runsChanged;
        });

        if (!changedUpdates.length && !(ops.creates || []).length && !(ops.deletes || []).length) {
            return Promise.resolve(false);
        }
        return self.applySplitPlan({ updates: changedUpdates, creates: ops.creates, deletes: ops.deletes });
    };

    // ── Рендеринг ──

    AtexProductionPlanning.prototype.render = function() {
        // Защита от лавины рендеров (#3202): не более 10 вызовов за 1 секунду.
        var now = Date.now();
        if (!this._renderWindow || now - this._renderWindow.start > 1000) {
            this._renderWindow = { start: now, count: 0 };
        }
        this._renderWindow.count += 1;
        if (this._renderWindow.count > 10) {
            console.error('[pp] ⛔ render: лавина рендеров! ' + this._renderWindow.count + ' вызовов за ' + (now - this._renderWindow.start) + 'мс. Останавливаю.');
            return;
        }
        if (this._rendering) { console.warn('[pp] ⚠️ render: уже выполняется, пропускаю рекурсивный вызов'); return; }
        this._rendering = true;
        try {
            this.renderForm();
            this.renderQueue();
            this.renderLink();
        } finally {
            this._rendering = false;
        }
    };

    // #3354 п.2/п.3: лёгкий выбор резки без пересборки очереди. Полный render()
    // заново строит renderQueue → удаляет уже открытую панель полос (.atex-pp-strip-panel),
    // из-за чего раньше любой клик по карточке её сворачивал. Здесь только: запомнить
    // выбранную резку, переключить подсветку is-active по карточкам через DOM и обновить
    // боковую панель «Связанные позиции» (renderLink). Панель полос остаётся нетронутой —
    // её закрывает лишь собственный крестик .atex-pp-strip-close.
    AtexProductionPlanning.prototype.selectCut = function(cutId) {
        this.selectedCutId = cutId;
        if (this.queueEl) {
            var cards = this.queueEl.querySelectorAll('.atex-pp-cut');
            for (var i = 0; i < cards.length; i++) {
                var card = cards[i];
                var same = card.dataset && String(card.dataset.cutId) === String(cutId);
                card.classList.toggle('is-active', !!same);
            }
        }
        this.renderLink();
    };

    // #3638: применить deep-link из cut-gantt: выставить день (фильтр дат), активный
    // станок и сфокусировать задание (подсветка + прокрутка к карточке). Вызывается
    // после первичного рендера. Параметры — { cut, date, slitter } (строки, любой пуст).
    AtexProductionPlanning.prototype.applyDeepLink = function(params) {
        var p = params || {};
        if (!p.cut && !p.date && !p.slitter) return;
        if (p.date) { this.filter.date = p.date; this.filter.dateTo = p.date; }
        if (p.slitter) this.activeSlitter = String(p.slitter);
        this.renderQueue();   // пересобрать вкладки/очередь под новый день/станок
        if (p.cut) {
            this.selectCut(p.cut);
            var card = this.queueEl && this.queueEl.querySelector('.atex-pp-cut[data-cut-id="' + String(p.cut).replace(/"/g, '\\"') + '"]');
            if (card) {
                card.classList.add('is-deeplink');
                if (typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'center' });
            }
        }
        this.renderLink();
    };

    // Открыть модалку формы новой резки (#3116 п.1). Содержимое уже отрисовано
    // renderForm; здесь только показываем оверлей.
    AtexProductionPlanning.prototype.openForm = function() {
        this.renderForm();
        if (this.modalEl) this.modalEl.classList.add('is-open');
    };

    AtexProductionPlanning.prototype.closeForm = function() {
        if (this.modalEl) this.modalEl.classList.remove('is-open');
    };

    AtexProductionPlanning.prototype.openCutTiming = function(cut) {
        if (this.timingModalTitleEl) {
            this.timingModalTitleEl.textContent = cutTimingModalTitle(cut);
        }
        if (this.timingModalBodyEl) {
            var body = this.timingModalBodyEl;
            while (body.firstChild) body.removeChild(body.firstChild);
            // #3240: тайминг окна с разбивкой setup и жирным «Итого резка». Контекст
            // (старт/setup/нормы) собран в renderQueue; нет контекста → сохранённый текст.
            var ctx = this._timingByCut && this._timingByCut[String(cut && cut.id)];
            if (ctx) {
                cutTimingTimelineLines(ctx).forEach(function(ln, i) {
                    if (i > 0) body.appendChild(document.createTextNode('\n'));
                    if (ln.bold) body.appendChild(el('strong', { text: ln.text }));
                    else body.appendChild(document.createTextNode(ln.text));
                });
            } else {
                body.textContent = cutTimingModalText(cut);
            }
        }
        if (this.timingModalEl) this.timingModalEl.classList.add('is-open');
    };

    AtexProductionPlanning.prototype.closeCutTiming = function() {
        if (this.timingModalEl) this.timingModalEl.classList.remove('is-open');
    };

    // ── #3764: «Отпуск» (окна простоя станка) ──────────────────────────────────

    // Прочитать строки «Отпуска» одного станка (F_U=slitterId) → [{ id, start, end, notes }].
    AtexProductionPlanning.prototype.fetchDowntimeRows = function(slitterId) {
        var meta = this.meta.downtime;
        if (!meta) return Promise.resolve([]);
        var endIdx = columnIndex(meta, DOWNTIME_REQ.end);
        var notesIdx = columnIndex(meta, DOWNTIME_REQ.notes);
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(slitterId) + '&LIMIT=0,500')
            .then(function(rows) {
                return (rows || []).map(function(rec) {
                    var r = rec.r || [];
                    return {
                        id: String(rec.i),
                        start: (r[0] == null || r[0] === '') ? null : Number(r[0]),
                        end: (endIdx >= 0 && r[endIdx] != null && r[endIdx] !== '') ? Number(r[endIdx]) : null,
                        notes: (notesIdx >= 0 && r[notesIdx] != null) ? String(r[notesIdx]) : ''
                    };
                });
            });
    };

    // Перечитать окна простоя станка с сервера в кеш (откат UI после ошибки записи).
    AtexProductionPlanning.prototype.reloadDowntimesForSlitter = function(slitterId) {
        var self = this;
        return this.fetchDowntimeRows(slitterId).then(function(rows) {
            self.downtimesBySlitter[String(slitterId)] = rows;
            return rows;
        });
    };

    // #3764/#3844: построить модалку «Отпуск» (заголовок, тело-таблица, «×», «ОК»).
    // «×» и «ОК» (справа) закрывают окно; поля «Отпуска» сохраняются по change, поэтому
    // отдельного «Сохранить» нет. Та же механика оверлея, что у формы/тайминга (×/оверлей/Esc).
    AtexProductionPlanning.prototype.buildDowntimeModal = function() {
        var self = this;
        var dtTitle = el('h2', { class: 'atex-pp-form-title atex-pp-dt-title', text: 'Отпуск станка' });
        var dtBody = el('div', { class: 'atex-pp-dt-body' });
        var dtDialog = el('div', { class: 'atex-pp-modal-dialog atex-pp-dt-dialog' });
        var dtClose = el('button', { class: 'atex-pp-modal-close', type: 'button', text: '×', title: 'Закрыть' });
        dtClose.addEventListener('click', function() { self.closeDowntime(); });
        // #3844: «ОК» (справа) — закрывает окно (поля сохраняются по change, отдельного «Сохранить» нет).
        var dtOk = el('button', { class: 'atex-pp-btn atex-pp-btn-primary atex-pp-dt-ok', type: 'button', text: 'ОК', title: 'Закрыть' });
        dtOk.addEventListener('click', function() { self.closeDowntime(); });
        dtDialog.appendChild(dtClose);
        dtDialog.appendChild(dtTitle);
        dtDialog.appendChild(dtBody);
        dtDialog.appendChild(el('div', { class: 'atex-pp-supply-actions' }, [dtOk]));
        this.downtimeModalTitleEl = dtTitle;
        this.downtimeModalBodyEl = dtBody;
        this.downtimeModalEl = el('div', { class: 'atex-pp-modal atex-pp-dt-modal' }, [dtDialog]);
        this.downtimeModalEl.addEventListener('click', function(e) { if (e.target === self.downtimeModalEl) self.closeDowntime(); });
        this.root.appendChild(this.downtimeModalEl);
        return this.downtimeModalEl;
    };

    AtexProductionPlanning.prototype.openDowntime = function() {
        if (!this.meta.downtime) { this.notify('В метаданных нет таблицы «' + TABLE.downtime + '»', 'error'); return; }
        var act = this.downtimeActiveSlitter;
        if (!act || !act.id) { this.notify('Выберите станок (вкладку) для редактирования отпусков', 'error'); return; }
        if (this.downtimeModalTitleEl) this.downtimeModalTitleEl.textContent = 'Отпуск станка «' + (act.label || act.id) + '»';
        this.renderDowntimeTable();
        if (this.downtimeModalEl) this.downtimeModalEl.classList.add('is-open');
    };

    AtexProductionPlanning.prototype.closeDowntime = function() {
        if (this.downtimeModalEl) this.downtimeModalEl.classList.remove('is-open');
        // Очередь могла измениться (автоплан пропускает простой) — перерисуем расписание.
        try { this.renderQueue(); } catch (e) { /* очередь перерисуется при следующем render */ }
    };

    // Редактируемая таблица окон простоя активного станка: «Начало», «Окончание»,
    // «Примечания», удаление строки и кнопка «+ Отпуск». Поля сохраняются по change
    // (как полосы резки): начало — _m_save (главное значение DATETIME), реквизиты — _m_set.
    AtexProductionPlanning.prototype.renderDowntimeTable = function() {
        var self = this;
        var body = this.downtimeModalBodyEl;
        if (!body) return;
        while (body.firstChild) body.removeChild(body.firstChild);
        var act = this.downtimeActiveSlitter;
        if (!act || !act.id) return;
        var slitterId = act.id;
        var rows = this.downtimesBySlitter[slitterId] || (this.downtimesBySlitter[slitterId] = []);
        rows.sort(function(a, b) { return (Number(a.start) || 0) - (Number(b.start) || 0); });

        var table = el('div', { class: 'atex-pp-dt-table' });
        table.appendChild(el('div', { class: 'atex-pp-dt-row atex-pp-dt-head' }, [
            el('span', { text: 'Начало' }),
            el('span', { text: 'Окончание' }),
            el('span', { text: 'Примечания' }),
            el('span', { text: '' })
        ]));
        var tbody = el('div', { class: 'atex-pp-dt-tbody' });
        table.appendChild(tbody);

        function renderRows() {
            while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
            if (!rows.length) {
                tbody.appendChild(el('div', { class: 'atex-pp-dt-empty', text: 'Окон простоя нет. Добавьте отпуск кнопкой ниже.' }));
            }
            rows.forEach(function(row) {
                var rowEl = el('div', { class: 'atex-pp-dt-row' });
                var startInput = el('input', { class: 'atex-pp-input', type: 'datetime-local', step: '60' });
                startInput.value = unixToDatetimeLocal(row.start);
                startInput.addEventListener('change', function() {
                    row.start = datetimeLocalToUnix(startInput.value);
                    self.persistDowntimeRow(slitterId, row);
                });
                var endInput = el('input', { class: 'atex-pp-input', type: 'datetime-local', step: '60' });
                endInput.value = unixToDatetimeLocal(row.end);
                endInput.addEventListener('change', function() {
                    row.end = datetimeLocalToUnix(endInput.value);
                    self.persistDowntimeRow(slitterId, row);
                });
                var notesInput = el('input', { class: 'atex-pp-input', type: 'text', placeholder: 'причина (ТО и т.п.)' });
                notesInput.value = row.notes || '';
                notesInput.addEventListener('change', function() {
                    row.notes = notesInput.value;
                    self.persistDowntimeRow(slitterId, row);
                });
                var del = el('button', { class: 'atex-pp-btn atex-pp-dt-del', type: 'button', text: '×', title: 'Удалить отпуск' });
                del.addEventListener('click', function() {
                    self.deleteDowntimeRow(slitterId, row).then(function() {
                        var i = rows.indexOf(row);
                        if (i >= 0) rows.splice(i, 1);
                        renderRows();
                    }).catch(function() { /* отказ сервера — строку оставляем (deleteDowntimeRow уже уведомил) */ });
                });
                rowEl.appendChild(startInput);
                rowEl.appendChild(endInput);
                rowEl.appendChild(notesInput);
                rowEl.appendChild(del);
                tbody.appendChild(rowEl);
            });
        }
        renderRows();

        var addBtn = el('button', { class: 'atex-pp-btn atex-pp-dt-add', type: 'button', text: '+ Отпуск' });
        addBtn.addEventListener('click', function() {
            rows.push({ id: null, start: null, end: null, notes: '' });
            renderRows();
        });

        body.appendChild(table);
        body.appendChild(addBtn);
    };

    // Сохранить строку отпуска. Создаёт (нет id) или обновляет. Главное значение (начало,
    // DATETIME) пишется ТОЛЬКО через _m_save с t{tableId} (как плановый старт резки, #3280:
    // _m_set→403, _m_save{val} не пишет datetime); «Окончание»/«Примечания» — _m_set.
    // Записи одной строки СЕРИАЛИЗУЕМ цепочкой row._save: иначе быстрая правка нескольких
    // полей НОВОЙ строки (id ещё не пришёл) шлёт несколько _m_new и плодит дубли. Следующая
    // правка ждёт завершения предыдущей (id уже проставлен) и идёт как обновление.
    AtexProductionPlanning.prototype.persistDowntimeRow = function(slitterId, row) {
        var self = this;
        var meta = this.meta.downtime;
        if (!meta || !row) return Promise.resolve();
        var run = function() {
            // Без начала запись бессмысленна — создавать/обновлять нечего (ждём ввода).
            if (row.start == null) return Promise.resolve();
            if (row.end != null && row.end <= row.start) {
                self.notify('«Окончание» отпуска должно быть позже начала', 'error');
                return Promise.resolve();
            }
            var endReqId = reqIdByName(meta, DOWNTIME_REQ.end);
            var notesReqId = reqIdByName(meta, DOWNTIME_REQ.notes);
            var reqFields = buildFields(
                { end: endReqId, notes: notesReqId },
                { end: row.end != null ? String(row.end) : '', notes: row.notes }
            );
            var onErr = function(err) {
                self.notify('Не удалось сохранить отпуск: ' + (err && err.message || err), 'error');
                // Откат к серверному состоянию, чтобы UI не расходился с базой.
                self.reloadDowntimesForSlitter(slitterId).then(function() { self.renderDowntimeTable(); });
            };
            if (row.id) {
                var mainFields = {}; mainFields['t' + meta.id] = String(row.start);
                return self.post('_m_save/' + row.id + '?JSON', mainFields).then(function() {
                    if (Object.keys(reqFields).length) return self.post('_m_set/' + row.id + '?JSON', reqFields);
                }).catch(onErr);
            }
            var createFields = addMainValueField(meta, reqFields, String(row.start));
            return self.post('_m_new/' + meta.id + '?JSON&up=' + encodeURIComponent(slitterId), createFields).then(function(res) {
                var id = res && (res.obj || res.id || res.i);
                if (id) row.id = String(id);
                else throw new Error('сервер не вернул id записи');
            }).catch(onErr);
        };
        var prev = (row._save && typeof row._save.then === 'function') ? row._save : Promise.resolve();
        row._save = prev.then(run, run);
        return row._save;
    };

    // Удалить строку отпуска. Не сохранённая (id=null) — просто из UI; иначе _m_del.
    AtexProductionPlanning.prototype.deleteDowntimeRow = function(slitterId, row) {
        var self = this;
        if (!row || !row.id) return Promise.resolve();
        return this.post('_m_del/' + encodeURIComponent(row.id) + '?JSON', {}).catch(function(err) {
            self.notify('Не удалось удалить отпуск: ' + (err && err.message || err), 'error');
            throw err;   // не убираем строку из UI, раз сервер отказал
        });
    };

    function field(label, control) {
        return el('div', { class: 'atex-pp-field' }, [
            el('label', { class: 'atex-pp-label', text: label }),
            control
        ]);
    }

    AtexProductionPlanning.prototype.selectRef = function(items, value, placeholder, onChange, reqId, opts) {
        var self = this;
        var helper = (typeof window !== 'undefined' && window.AtexRefSearch) || null;
        opts = opts || {};
        if (helper && typeof helper.createSelect === 'function') {
            return helper.createSelect({
                classPrefix: 'atex-pp',
                inputClass: 'atex-pp-input',
                options: items || [],
                value: value,
                placeholder: placeholder || '— не выбрано —',
                reqId: reqId,
                cacheKey: opts.cacheKey,
                cache: this.refOptions,
                clearOnInput: opts.clearOnInput,
                loadOptions: reqId ? function(reqId, query, limit) { return self.loadRefOptions(reqId, query, limit); } : null,
                onChange: onChange
            });
        }

        var refSelect = el('select', { class: 'atex-pp-input' });
        refSelect.appendChild(el('option', { value: '', text: placeholder || '— не выбрано —' }));
        (items || []).forEach(function(it) {
            var o = el('option', { value: it.id, text: it.label });
            if (String(value) === String(it.id)) o.selected = true;
            refSelect.appendChild(o);
        });
        refSelect.addEventListener('change', function() { onChange(refSelect.value); });
        return refSelect;
    };

    AtexProductionPlanning.prototype.selectText = function(values, value, onChange) {
        var textSelect = el('select', { class: 'atex-pp-input' });
        values.forEach(function(v) {
            var o = el('option', { value: v, text: v });
            if (String(value) === String(v)) o.selected = true;
            textSelect.appendChild(o);
        });
        if (value && values.indexOf(value) === -1) {
            var extra = el('option', { value: value, text: value });
            extra.selected = true;
            textSelect.appendChild(extra);
        }
        textSelect.addEventListener('change', function() { onChange(textSelect.value); });
        return textSelect;
    };

    AtexProductionPlanning.prototype.renderForm = function() {
        var self = this;
        if (this._renderingForm) { console.warn('[pp] ⚠️ renderForm: уже выполняется, пропускаю рекурсивный вызов'); return; }
        this._renderingForm = true;
        try {
        var d = this.draft;
        var form = this.formEl;
        form.innerHTML = '';
        form.appendChild(el('h2', { class: 'atex-pp-form-title', text: 'Новое производственное задание' }));
        form.appendChild(el('p', { class: 'atex-pp-hint', text: 'Задание под одну позицию заказа: выберите позицию и кол-во рулонов (≤ необеспеченного), затем станок — в списке станков показано ближайшее свободное окно.' }));

        // Только согласованные, ещё не обеспеченные позиции с ненулевым остатком.
        var posLabelById = {};
        (this.positions || []).forEach(function(p) { posLabelById[String(p.id)] = p.label; });
        var unsup = uncoveredPositions(this.genPositions, this.supplies).filter(function(p) { return p.approved; });
        var options = unsup.map(function(p) {
            var remaining = remainingRollsForPosition(p, self.supplies);
            var base = posLabelById[String(p.id)] || ('Сырьё#' + (p.materialId || '?') + ' · ' + ((p.orderWidth != null ? p.orderWidth : p.width) || '?') + ' мм');
            return { id: String(p.id), remaining: remaining, width: (p.orderWidth != null ? p.orderWidth : p.width),  // #3372: заказанная ширина
                label: base + ' · ост. ' + round3(remaining) + ' рул.' };
        }).filter(function(o) { return o.remaining > 0; });

        if (!options.length) {
            form.appendChild(el('p', { class: 'atex-pp-hint', text: 'Нет согласованных необеспеченных позиций.' }));
            this._renderingForm = false;
            return;
        }

        // Заказанное количество — позиция заказа (один выбор).
        var posSelect = el('select', { class: 'atex-pp-input' });
        posSelect.appendChild(el('option', { value: '', text: '— выберите позицию —' }));
        options.forEach(function(o) {
            var op = el('option', { value: o.id, text: o.label });
            if (String(d.positionId) === o.id) op.selected = true;
            posSelect.appendChild(op);
        });
        posSelect.addEventListener('change', function() {
            d.positionId = posSelect.value;
            d.prospect = null;
            var sel = options.filter(function(o) { return o.id === d.positionId; })[0];
            d.qty = sel ? String(sel.remaining) : '';
            self.renderForm();
        });
        form.appendChild(field('Заказанное количество', posSelect));

        var selOpt = options.filter(function(o) { return o.id === String(d.positionId); })[0];
        var maxQty = selOpt ? selOpt.remaining : 0;

        // Кол-во рулонов (≤ необеспеченного остатка). Изменение пересчитывает свободные окна.
        var qtyInput = el('input', { class: 'atex-pp-input', type: 'number', min: '1', step: '1' });
        if (selOpt) qtyInput.max = String(maxQty);
        qtyInput.value = d.qty || '';
        qtyInput.disabled = !selOpt;
        qtyInput.addEventListener('input', function() { d.qty = qtyInput.value; });
        qtyInput.addEventListener('change', function() { d.qty = qtyInput.value; self.renderForm(); });
        form.appendChild(field('Кол-во рулонов' + (selOpt ? ' (≤ ' + round3(maxQty) + ')' : ''), qtyInput));

        // Раскладка (станок-независимая) считается автоматически по позиции+кол-ву.
        var qtyNum = Math.floor(Number(d.qty) || 0);
        var canPlan = !!selOpt && qtyNum > 0 && qtyNum <= maxQty;
        var key = String(d.positionId) + '|' + qtyNum;
        var prospectReady = !!(d.prospect && d.prospect.forKey === key && !d.prospect.error);
        var prospectErr = (d.prospect && d.prospect.forKey === key && d.prospect.error) ? d.prospect.error : '';
        if (canPlan && !prospectReady && !prospectErr) this.refreshCutProspect();

        // Станок — в каждой опции ближайшее свободное окно (нужна готовая раскладка).
        if (!canPlan) {
            form.appendChild(field('Станок', el('div', { class: 'atex-pp-hint', text: 'Сначала выберите позицию и кол-во рулонов.' })));
        } else if (prospectErr) {
            form.appendChild(field('Станок', el('div', { class: 'atex-pp-hint', text: prospectErr })));
        } else if (!prospectReady) {
            form.appendChild(field('Станок', el('div', { class: 'atex-pp-hint', text: 'Расчёт раскладки…' })));
        } else {
            var pr = d.prospect;
            var slitterSelect = el('select', { class: 'atex-pp-input' });
            slitterSelect.appendChild(el('option', { value: '', text: '— выберите станок —' }));
            this.slitters.forEach(function(s) {
                var blocked = isMaterialBlocked(s.stopMaterialIds || [], pr.materialId);
                var label = blocked ? (s.label + ' — сырьё запрещено')
                    : (s.label + ' — Свободное окно: ' + formatFreeSlot(self.freeSlotForCut(s.id, pr.scheduleCut)));
                var op = el('option', { value: String(s.id), text: label });
                if (blocked) op.disabled = true;
                if (String(d.slitterId) === String(s.id)) op.selected = true;
                slitterSelect.appendChild(op);
            });
            slitterSelect.addEventListener('change', function() { d.slitterId = slitterSelect.value; self.renderForm(); });
            form.appendChild(field('Станок', slitterSelect));
        }

        // У «Производственной резки» нет колонки «Статус» — есть флаг «В работе» (по умолчанию вкл).
        var activeInput = el('input', { type: 'checkbox' });
        activeInput.checked = d.active !== false;
        activeInput.addEventListener('change', function() { d.active = activeInput.checked; });
        form.appendChild(el('label', { class: 'atex-pp-checkbox-field' }, [
            activeInput,
            el('span', { text: 'В работе' })
        ]));

        var notes = el('textarea', { class: 'atex-pp-input atex-pp-textarea', rows: '2' });
        notes.value = d.notes || '';
        notes.addEventListener('input', function() { d.notes = notes.value; });
        form.appendChild(field('Примечания', notes));

        // Превью состава для выбранного станка + свободное окно.
        var chosenSlit = d.slitterId ? this.slitters.filter(function(s) { return String(s.id) === String(d.slitterId); })[0] : null;
        var chosenBlocked = !!(chosenSlit && prospectReady && isMaterialBlocked(chosenSlit.stopMaterialIds || [], d.prospect.materialId));
        var chosenSlot = (prospectReady && d.slitterId && !chosenBlocked) ? this.freeSlotForCut(d.slitterId, d.prospect.scheduleCut) : null;
        var canCreate = prospectReady && !!d.slitterId && !chosenBlocked;

        var previewBox = el('div', { class: 'atex-pp-cut-preview' });
        if (canCreate) {
            var pl = d.prospect;
            var lines = [
                'Свободное окно: ' + formatFreeSlot(chosenSlot),
                'Проходов: ' + round3(pl.plannedRuns) + ' · полос/проход (ширина ' + round3(pl.posWidth) + ' мм): ' + round3(pl.stripsPerPass),
                'Произведём этой ширины: ' + round3(pl.producedPosRolls) + ' рул. · обеспечим: ' + round3(pl.supplyRolls) + ' · склад: ' + round3(pl.stockRolls),
                'Длительность резки: ~' + round3(pl.duration) + ' мин'
            ];
            if (pl.multiLayout) lines.push('⚠️ Кол-ва хватает на несколько заданий — создаётся первое.');
            lines.forEach(function(txt) { previewBox.appendChild(el('div', { class: 'atex-pp-cut-preview-line', text: txt })); });
        } else {
            previewBox.appendChild(el('div', { class: 'atex-pp-hint',
                text: prospectReady ? 'Выберите станок — покажу состав задания.' : 'Заполните позицию и кол-во рулонов.' }));
        }
        form.appendChild(previewBox);

        var actions = el('div', { class: 'atex-pp-actions' });
        var createBtn = el('button', { class: 'atex-pp-btn atex-pp-btn-primary', type: 'button', text: 'Создать задание' });
        createBtn.disabled = !canCreate;
        createBtn.addEventListener('click', function() { self.createCutForPosition(); });
        actions.appendChild(createBtn);
        form.appendChild(actions);
        } finally {
            this._renderingForm = false;
        }
    };

    AtexProductionPlanning.prototype.renderQueue = function() {
        var self = this;
        if (this._renderingQueue) { console.warn('[pp] ⚠️ renderQueue: уже выполняется, пропускаю рекурсивный вызов'); return; }
        this._renderingQueue = true;
        try {
        var t0 = Date.now();
        var box = this.queueEl;
        // #3429: фокус и каретку поля поиска запоминаем ДО очистки DOM. box.innerHTML=''
        // удаляет сфокусированный input → браузер шлёт blur, который сбрасывал флаг
        // this._searchFocused раньше, чем мы успевали проверить его при восстановлении →
        // фокус терялся при каждом нажатии. Считываем состояние в локальные переменные
        // (источник истины — был ли input активным элементом), поэтому blur уже не мешает.
        var prevSearch = box.querySelector('.atex-pp-search');
        var searchHadFocus = !!(prevSearch && (this._searchFocused ||
            (typeof document !== 'undefined' && document.activeElement === prevSearch)));
        var searchCaret = null;
        if (prevSearch) { try { searchCaret = prevSearch.selectionStart; } catch (e) {} }
        box.innerHTML = '';

        // Панель фильтров. Фильтр по станку заменён закладками (#3116 п.2).
        var filters = el('div', { class: 'atex-pp-filters' });
        var statusFilter = this.selectText([''].concat(CUT_STATUSES), this.filter.status, function(v) { self.filter.status = v; self.renderQueue(); });
        // первый пункт статуса — «все»
        statusFilter.options[0].textContent = 'Все статусы';
        // #3599 п.2: дата плана ДИАПАЗОНОМ «С — По» (два поля, между ними дефис). Диапазон
        // фильтрует отображение очереди; «С» (filter.date) остаётся базой генерации/планирования.
        var dateFrom = el('input', { class: 'atex-pp-input atex-pp-date-input', type: 'date', value: this.filter.date || '', title: 'С (дата плана, от)' });
        var dateTo = el('input', { class: 'atex-pp-input atex-pp-date-input', type: 'date', value: this.filter.dateTo || '', title: 'По (дата плана, до)' });
        function applyDateRange() {
            self.selectedCutId = null;   // #3349: очищать панель «Связанные позиции»
            self.renderQueue();
            self.renderLink();
        }
        dateFrom.addEventListener('change', function() { self.filter.date = dateFrom.value; applyDateRange(); });
        dateTo.addEventListener('change', function() {
            self.filter.dateTo = dateTo.value;
            // При смене «По»: если «С» оказалась ПОЗЖЕ «По» — подтягиваем «С» к «По» (не
            // оставляем перевёрнутый диапазон). renderQueue перерисует поле «С» новым значением.
            var to = String(self.filter.dateTo || '').trim();
            var from = String(self.filter.date || '').trim();
            if (to !== '' && from !== '' && planDateDayKey(from) > planDateDayKey(to)) {
                self.filter.date = self.filter.dateTo;
            }
            applyDateRange();
        });
        // #3508 п.1 / #3599: стрелки ‹/› двигают ВЕСЬ диапазон на ±1 день (ширина окна сохраняется).
        function shiftFilterDate(delta) {
            self.filter.date = shiftPlanDate(self.filter.date || todayISO(), delta);
            self.filter.dateTo = shiftPlanDate(self.filter.dateTo || self.filter.date || todayISO(), delta);
            applyDateRange();
        }
        var datePrev = el('button', { class: 'atex-pp-date-nav', type: 'button', text: '‹', title: 'Сдвинуть диапазон на день назад' });
        var dateNext = el('button', { class: 'atex-pp-date-nav', type: 'button', text: '›', title: 'Сдвинуть диапазон на день вперёд' });
        datePrev.addEventListener('click', function() { if (!self.busy) shiftFilterDate(-1); });
        dateNext.addEventListener('click', function() { if (!self.busy) shiftFilterDate(1); });
        // #3713: иконка-ссылка «Диаграмма Ганта» рядом с выбором дат — открывает Гант на этом же
        // диапазоне (?from=..&to=..). href пересобирается при каждом renderQueue из текущего фильтра.
        var ganttLink = el('a', {
            class: 'atex-pp-gantt-link',
            href: ganttRangeLink(this.filter.date, this.filter.dateTo, ganttBaseFromLocation()),
            title: 'Открыть диаграмму Ганта на этом диапазоне дат',
            'aria-label': 'Диаграмма Ганта',
            html: GANTT_ICON_SVG
        });
        var dateNav = el('div', { class: 'atex-pp-date-field' }, [datePrev, dateFrom, el('span', { class: 'atex-pp-date-sep', text: '–' }), dateTo, dateNext, ganttLink]);
        // #3411: быстрый поиск между «Дата плана» и «Статус». Фильтрует карточки очереди
        // и пересчитывает счётчики на закладках станков (видно, в каком станке сколько
        // совпавших позиций). Поиск идёт по сырью/намотке/статусу и подписям связанных
        // позиций. Ввод не пересобирает всю страницу — только очередь; фокус и каретку
        // в поле восстанавливаем после перерисовки (см. ниже), чтобы печатать без сбоев.
        var searchInput = el('input', {
            class: 'atex-pp-input atex-pp-search',
            type: 'search',
            placeholder: 'Поиск по позициям…',
            value: this.filter.query || ''
        });
        searchInput.addEventListener('input', function() {
            self.filter.query = searchInput.value;
            self._searchFocused = true;
            self.renderQueue();
        });
        searchInput.addEventListener('focus', function() { self._searchFocused = true; });
        searchInput.addEventListener('blur', function() { self._searchFocused = false; });
        filters.appendChild(field('Дата плана', dateNav));
        filters.appendChild(field('Поиск', searchInput));
        filters.appendChild(field('Статус', statusFilter));
        box.appendChild(filters);

        // #3429: восстанавливаем фокус/каретку по состоянию, снятому ДО очистки DOM —
        // надёжно, даже если blur от innerHTML='' успел сбросить this._searchFocused.
        if (searchHadFocus) {
            searchInput.focus();
            var caret = (searchCaret == null) ? searchInput.value.length : searchCaret;
            try { searchInput.setSelectionRange(caret, caret); } catch (e) {}
        }

        // #3411: связанные позиции по резкам — для поиска (haystack) и счётчиков.
        var query = String(this.filter.query == null ? '' : this.filter.query).trim();
        var hasQuery = query !== '';
        var posLabelById = {};
        (this.positions || []).forEach(function(p) { posLabelById[String(p.id)] = p.label; });
        var linkedLabelsByCut = {};
        (this.supplies || []).forEach(function(s) {
            var cid = String(s.cutId);
            if (!linkedLabelsByCut[cid]) linkedLabelsByCut[cid] = [];
            // #3624: позиция вне активного positions_list — в haystack кладём «<заказ>/<позиция>»
            // из cut_planning.order_no, чтобы поиск по номеру заказа находил такие резки.
            linkedLabelsByCut[cid].push(posLabelById[String(s.positionId)] ||
                (s.orderNo ? (s.orderNo + '/' + s.positionId) : ('позиция #' + s.positionId)));
        });
        function cutMatchesSearch(c) {
            return cutMatchesQuery(c, query, linkedLabelsByCut[String(c.id)]);
        }
        function groupMatchCount(g) {
            if (!hasQuery) return g.cuts.length;
            return g.cuts.filter(cutMatchesSearch).length;
        }

        // Базовая видимость очереди: не «Завершён», дата плана = выбранной/пустая.
        var visible = (this.cuts || []).filter(function(c) { return isCutVisible(c, self.filter.date, self.filter.dateTo); });
        var filtered = filterCuts(visible, this.filter);
        var groups = groupBySlitter(filtered);

        // #3535: вкладку показываем для КАЖДОГО станка справочника — даже если в
        // этот день у него нет резок (счётчик 0, пустой список). Иначе вкладки
        // «съезжают», и человек принимает первую вкладку за первый станок, хотя
        // станка без резок в ней нет. Порядок вкладок = порядок справочника
        // станков (this.slitters); группы с резками без станка / с удалённым из
        // справочника станком дописываем в конце в порядке groupBySlitter,
        // чтобы не потерять задания. (Раньше вкладки всех станков показывались
        // только при полностью пустой очереди — #3168.)
        var tabGroups = mergeStationTabs(this.slitters, groups);

        if (!tabGroups.length) {
            // #3788: отображаемая дата — выходной/праздник → красным «Выходной день» перед подсказкой.
            if (!this.dayIsWorking(planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this)))) {
                box.appendChild(el('div', { class: 'atex-pp-dayoff-note', text: 'Выходной день' }));
            }
            box.appendChild(el('div', { class: 'atex-pp-empty', text: 'Заданий в очереди нет' }));
            return;
        }

        // Закладки по станкам (#3116 п.2): один таб на станок, контент — резки
        // только активного станка. Активный таб в this.activeSlitter (ключ как в
        // groupBySlitter); если выбранного среди вкладок нет — берём первую.
        function groupKey(g) { return g.slitter.id == null ? '\u0000none' : String(g.slitter.id); }
        var keys = tabGroups.map(groupKey);
        if (keys.indexOf(self.activeSlitter) === -1) self.activeSlitter = keys[0];

        var tabs = el('div', { class: 'atex-pp-tabs' });
        tabGroups.forEach(function(g) {
            var key = groupKey(g);
            // #3411: при активном поиске счётчик показывает число совпавших позиций станка.
            var count = groupMatchCount(g);
            var tab = el('button', { class: 'atex-pp-tab' + (key === self.activeSlitter ? ' is-active' : '') + (hasQuery && count === 0 ? ' is-empty-match' : ''), type: 'button' }, [
                el('span', { class: 'atex-pp-tab-label', text: g.slitter.label }),
                el('span', { class: 'atex-pp-tab-count', text: String(count) })
            ]);
            // #3411: переключение станка очищает панель «Связанные позиции».
            tab.addEventListener('click', function() { self.activeSlitter = key; self.selectedCutId = null; self.renderQueue(); self.renderLink(); });
            tabs.appendChild(tab);
        });
        box.appendChild(tabs);

        var activeGroup = tabGroups.filter(function(g) { return groupKey(g) === self.activeSlitter; })[0] || tabGroups[0];
        // #3764: подпись/доступность кнопки «Отпуск {станок}» — по активному станку. Группа
        // «Без слиттера» (id=null) станка не имеет → кнопку гасим (некуда писать простой).
        if (this.downtimeBtn) {
            // Кнопка видна только если таблица «Отпуск» есть в метаданных (фича включена).
            this.downtimeBtn.style.display = this.meta.downtime ? '' : 'none';
            var actSlitter = activeGroup && activeGroup.slitter;
            var actId = actSlitter && actSlitter.id != null ? String(actSlitter.id) : '';
            this.downtimeBtn.textContent = 'Отпуск' + (actId && actSlitter.label ? ' ' + actSlitter.label : '');
            this.downtimeBtn.disabled = !actId;
            this.downtimeActiveSlitter = actId ? { id: actId, label: actSlitter.label } : null;
        }
        var groupEl = el('div', { class: 'atex-pp-queue-group' });

        // Расписание активного станка: старт/финиш каждой резки от начала смены (08:00).
        // Длительность — намотка прогона (метраж обеспечений → windingMinutes), плюс
        // переналадки между резками (реальные минуты из таблицы «Время операции»);
        // в конце каждого рабочего дня — блок уборки CLEANUP_SHIFT (#3155).
        var windPoints = windingPointsFromTimes(self.opTimes || {});
        var runLenByCut = {};
        activeGroup.cuts.forEach(function(c) {
            runLenByCut[String(c.id)] = cutRunLength(c, self.supplies, self.footageBySupply);
        });
        var schedById = {};
        var dayWindow = self.workingWindow();
        // Полночь дня планирования (день 0 расписания) — для title даты+времени старта.
        // День 0 = дата фильтра (.atex-pp-input), на которую отфильтрована очередь, а не
        // «сегодня»; иначе title показывал текущую дату вместо плановой (напр. 10.06 вместо 01.06).
        var planBaseMidnightMs = planBaseMidnightFrom(self.filter && self.filter.date, controllerNowMs(self));
        // #3635 п.5: сегменты НАСТРОЙКИ (0 проходов + продолжение с проходами в цепочке) —
        // намотки нет, длительность в расписании 0, чтобы настройка встала в конце дня N, а
        // намотка — на день N+1. Карточка таких заданий показывает «Настройка ножей и сырья».
        var setupTaskIds = setupTaskIdSet(activeGroup.cuts);
        // #3688: текущая заправка активного станка (из prev_cut_setup) → синтетическая
        // «предыдущая резка» для МОДАЛКИ тайминга первой резки очереди (#3240): смена сырья +
        // ножи, если осталось другое. Нет данных → null + firstCutSetup (настройка ножей с нуля).
        var carrySlitterId = String(activeGroup.slitter && activeGroup.slitter.id);
        // #3876: станок в отпуске на день базы → заправка обнулена (как в плане/хранимых колонках):
        // первая резка после отпуска в модалке тоже показывает полную настройку (ножи + сырьё).
        var carrySetup = self.planningPrevSetupBySlitter(planBaseMidnightMs)[carrySlitterId];
        var carryPrevCut = (carrySetup && activeGroup.cuts.length)
            ? carryOverPrevCut(carrySetup, activeGroup.cuts[0]) : null;
        // #3846: НЕ пересчитываем расписание live (buildSchedule убран) — показываем СОХРАНЁННЫЙ
        // план (scheduleFromStored), тот же, что рисует РМ «Диаграмма Ганта» → времена и минуты
        // ВСЕГДА совпадают. Обед (#3342) уже учтён генерацией в сохранённых planStart; здесь он —
        // отдельный видимый блок (lunchByDay), чтобы зазор не выглядел необъяснённой «дырой».
        var schedule = scheduleFromStored(activeGroup.cuts, planBaseMidnightMs);
        schedule.forEach(function(sc) { schedById[sc.cutId] = sc; });
        var lunchByDay = {};   // #3846: { schedDay → { startMin, finishMin, durationMin } } обеда
        lunchBlocksFromSchedule(schedule, { lunchStartMin: dayWindow.lunchStartMin, lunchDurationMin: dayWindow.lunchDurationMin })
            .forEach(function(lb) { lunchByDay[lb.day] = lb; });
        self._timingByCut = {};   // #3240: пересобираем контекст тайминга модалки для активного станка
        function schedDay(sc) { return sc ? Math.floor((Number(sc.startMin) || 0) / 1440) : null; }
        // #3616: задания группируем и нумеруем по РАБОЧЕМУ ДНЮ РАСПИСАНИЯ (schedDay) —
        // тому же, что разделяет дни блоком уборки и датой-заголовком, — а НЕ по хранимой
        // «Дате план». Иначе резки одной хранимой даты, переехавшие расписанием на следующий
        // день (не влезли в текущий), продолжали сквозную нумерацию (№5 на новом дне вместо №1).
        function cutSchedDayKey(c) { var d = schedDay(schedById[String(c.id)]); return d == null ? ' ' : String(d); }
        var dayCutsBySched = {};
        activeGroup.cuts.forEach(function(c) {
            var key = cutSchedDayKey(c);
            if (!dayCutsBySched[key]) dayCutsBySched[key] = [];
            dayCutsBySched[key].push(c);
        });
        // Уборка в конце рабочего дня (#3155): блок после последней резки каждого дня.
        var cleanupByDay = {};
        dayCleanups(schedule, { cleanupMin: dayWindow.cleanupMin, shiftEndMin: dayWindow.endMin })   // #3599: уборка ПОСЛЕ DAY_END_HOUR
            .forEach(function(cl) { cleanupByDay[cl.day] = cl; });
        // #3743: суммарные рабочие минуты станка за каждый рабочий день — переналадка +
        // намотка + лидер по каждому заданию дня (всё, чем станок занят). Считаем по полному
        // расписанию (не по фильтру поиска), выводим в скобках после даты-заголовка. Уборка
        // (#3155) имеет собственную строку с минутами и в сумму заданий не входит.
        var dayMinutesBySched = {};
        schedule.forEach(function(sc) {
            var d = schedDay(sc);
            if (d == null) return;
            var m = (Number(sc.setupMin) || 0) + (Number(sc.durationMin) || 0) + (Number(sc.leaderMin) || 0);
            dayMinutesBySched[d] = (dayMinutesBySched[d] || 0) + m;
        });
        var lastDayDateRendered = null;   // #3616: дата-заголовок дня вставляется один раз на рабочий день

        activeGroup.cuts.forEach(function(c, idx) {
            // #3411: при поиске показываем только совпавшие карточки. Расписание/индексы
            // (idx, sameDayCuts) считаются по полной очереди станка, поэтому номера и
            // перестановки ↑/↓ остаются корректными — прячем лишь несовпавшие карточки.
            if (hasQuery && !cutMatchesSearch(c)) return;
            var active = String(self.selectedCutId) === String(c.id);
            var supplies = self.supplyCount(c.id);

            // Карточка-панель (#3120 п.1): div-панель вместо кнопки. Внутри —
            // информация и контролы (↑/↓/Полосы). Клик по всей панели = выбор резки
            // (#3149: раньше реагировала только строка .atex-pp-cut-info). Панель полос
            // (#3120 п.8) openStrips добавляет внутрь этой же карточки (контейнер —
            // cardPanel), а не внизу всей очереди — поэтому она строго одна на карточку.
            // #3120 п.4: подсветка резки, которую нечем обеспечить — нет подходящей
            // партии (Фаза 1a) ЛИБО есть потребность (метраж), но «Расход сырья» её не
            // покрывает (Фаза 1b: не удалось зарезервировать полностью).
            var unreserved = cutMissingBatch(c, self.genBatches);
            if (!unreserved) {
                var needLin = Number(runLenByCut[String(c.id)]) || 0;
                if (needLin > 0) {
                    var cons = (self.consumptionByCut && self.consumptionByCut[String(c.id)]) || [];
                    var resM2 = 0; cons.forEach(function(e) { resM2 += Number(e.m2) || 0; });
                    var wM = (Number(self.jumboWidthByMaterial[String(c.materialId)]) || 0) / 1000;
                    var resLin = wM > 0 ? resM2 / wM : 0;
                    if (resLin + 1e-6 < needLin) unreserved = true;
                }
            }
            // #3635 п.5: сегмент НАСТРОЙКИ (хвост дня N перед намоткой дня N+1) — карточка
            // без проходов, показывает «Настройка ножей и сырья», а не ошибку длительности.
            var isSetupTask = !!setupTaskIds[String(c.id)];
            // #3508 п.5: зафиксированное задание — класс is-fixed (серая кайма, видно, что менять нельзя).
            var cardPanel = el('div', { class: 'atex-pp-cut' + (active ? ' is-active' : '') + (unreserved ? ' is-unreserved' : '') + (c.fixed ? ' is-fixed' : '') + (isSetupTask ? ' is-setup' : ''), dataset: { cutId: String(c.id) } });

            var materialText = c.materialName || (c.materialId ? ('#' + c.materialId) : '—');
            var sc = schedById[String(c.id)];
            var runLengthForCut = runLenByCut[String(c.id)];
            // #3240: контекст тайминга резки для модалки (setup с предыдущей + нормы + старт).
            // #3688: для первой задачи очереди prev — заправка станка (carryPrevCut, из
            // prev_cut_setup): смена сырья + ножи, если осталось другое. Нет данных → null +
            // firstCutSetup (настройка ножей с нуля, #3669). Лидер показывается в конце резки.
            self._timingByCut[String(c.id)] = buildCutTimingCtx(
                c, idx > 0 ? activeGroup.cuts[idx - 1] : carryPrevCut, sc,
                runLengthForCut, windPoints, self.changeTimes, { firstCutSetup: true }
            );
            var cutNumberTitle = 'Задание № ' + (formatCutNumber(c.number) || c.id);
            // #3280: title — плановая дата+время старта до минут (sc есть); иначе номер резки.
            var cutNumTitle = formatCutStartTitle(sc, planBaseMidnightMs) || cutNumberTitle;

            // #3354 п.1: строка времени резки (старт–финиш окна от начала смены) теперь
            // живёт в первой строке карточки — между «номером по порядку» и сырьём, а не
            // отдельным рядом ниже. Клик открывает тайминг и (всплытием) выбирает резку.
            var timeEl = null;
            if (sc) {
                // #3635 п.5: для настройки показываем «⚙ Настройка ножей и сырья · N мин»
                // (окно = переналадка, минуты вверх), а не строку расписания резки.
                var scheduleText = isSetupTask
                    ? ('⚙ Настройка ножей и сырья · ' + Math.ceil(stripNum(sc.setupMin)) + ' мин')
                    : formatScheduleLine(sc, runLengthForCut, windPoints.length > 0);
                if (!isSetupTask && stripNum(sc.durationMin) <= 0 && typeof console !== 'undefined' && console.error) {
                    console.error('[pp] ❌ renderQueue: длительность резки не рассчитана', {
                        cutId: String(c.id),
                        plannedRuns: c.plannedRuns,
                        runLength: runLengthForCut,
                        storedDuration: c.duration,
                        windPoints: windPoints
                    });
                }
                timeEl = el('div', {
                    class: 'atex-pp-cut-time',
                    role: 'button',
                    tabindex: '0',
                    title: 'Показать тайминг резки',
                    text: scheduleText
                });
                timeEl.addEventListener('click', function() {
                    self.openCutTiming(c);
                });
                timeEl.addEventListener('keydown', function(e) {
                    if (e.key !== 'Enter' && e.key !== ' ' && e.keyCode !== 13 && e.keyCode !== 32) return;
                    if (e.preventDefault) e.preventDefault();
                    e.stopPropagation();
                    self.openCutTiming(c);
                });
            }

            // #3354 п.1: первая строка карточки —
            // {номер по порядку} {время} {название сырья} {тип намотки} — {длина} х {резок};
            // справа прижата сводка связей (.atex-pp-cut-supplies).
            // #3508 п.7 / #3616: «Очередность» в карточке = позиция задания в очереди станка
            // за РАБОЧИЙ ДЕНЬ РАСПИСАНИЯ (1..N по dayCutsBySched), а НЕ хранимое значение
            // «Очередности» (могли задвоиться) и не сквозной номер по хранимой дате. Нумерация
            // всегда начинается с 1 на каждый видимый день (тот же день, что у уборки/даты).
            var sameDayCuts = dayCutsBySched[cutSchedDayKey(c)] || activeGroup.cuts;
            var dayIdx = sameDayCuts.indexOf(c);
            var seqText = String((dayIdx >= 0 ? dayIdx : idx) + 1);
            var windingText = normWinding(c.winding) || String(c.winding == null ? '' : c.winding).trim() || '—';
            var infoChildren = [
                el('span', { class: 'atex-pp-cut-seq', title: cutNumTitle, text: '№ ' + seqText })
            ];
            if (timeEl) infoChildren.push(timeEl);
            infoChildren.push(el('span', { class: 'atex-pp-cut-name', title: materialText, text: materialText }));
            infoChildren.push(el('span', { class: 'atex-pp-cut-winding', text: windingText }));
            // #3406 п.3: дефис — отдельный элемент между намоткой и размерами, чтобы
            // он стоял по центру (равный flex-gap слева и справа): «MR194 IN — 600 х 7».
            infoChildren.push(el('span', { class: 'atex-pp-cut-dash', text: '—' }));
            // #3635 п.5: у настройки проходов нет — вместо «длина х 0 резок» показываем
            // число настраиваемых ножей (сама намотка с этими размерами идёт на след. дне).
            infoChildren.push(el('span', { class: 'atex-pp-cut-runs',
                text: isSetupTask ? ('ножей: ' + (Number(c.knifeCount) || 0)) : formatCutDimensions(c, runLengthForCut) }));
            // #3472: лидер резки — после размеров (перед связями, которые прижаты вправо).
            // Один лидер — обычная плашка; несколько (легаси-смешение до ограничения по
            // лидеру) — выделяем предупреждением.
            var cutLeaders = (c.leaders || []).filter(function(s) { return s; });
            if (cutLeaders.length) {
                var mixed = cutLeaders.length > 1;
                infoChildren.push(el('span', {
                    class: 'atex-pp-cut-leader' + (mixed ? ' atex-pp-cut-leader-mixed' : ''),
                    title: (mixed ? 'В резке смешаны разные лидеры: ' : 'Лидер: ') + cutLeaders.join(', '),
                    text: 'лидер: ' + cutLeaders.join(', ')
                }));
            }
            // #3738: втулка резки — сразу после лидера. Источник — cut_sleeve (имя
            // «Диаметр втулки» обеспеченной позиции). Одна втулка — обычная плашка;
            // несколько (легаси-смешение до разбивки по втулке) — предупреждение, как у лидера.
            var cutSleeves = (c.sleeves || []).filter(function(s) { return s; });
            if (cutSleeves.length) {
                var sleeveMixed = cutSleeves.length > 1;
                infoChildren.push(el('span', {
                    class: 'atex-pp-cut-sleeve' + (sleeveMixed ? ' atex-pp-cut-sleeve-mixed' : ''),
                    title: (sleeveMixed ? 'В резке смешаны разные втулки: ' : 'Втулка: ') + cutSleeves.join(', '),
                    text: 'втулка: ' + cutSleeves.join(', ')
                }));
            }
            infoChildren.push(el('span', { class: 'atex-pp-cut-supplies', text: supplies ? ('связей: ' + supplies) : 'нет связей' }));
            cardPanel.appendChild(el('div', { class: 'atex-pp-cut-info' }, infoChildren));

            // #3354 п.1: под первой строкой — сводка полос по ширинам. Контейнер
            // .atex-pp-cut-material содержит по одной строке .atex-pp-strip-row на ширину:
            // «{сырьё} {ширина} x {длина} {намотка} — {факт.ширина}мм х {резок} x {полос} = {мотков} шт.».
            var stripGroups = cutStripGroups(c);
            if (stripGroups.length) {
                // #3686: обратный резолв (факт→номинал) сверяет j= с «Номинальной шириной» рулона
                var jumboWidth = self.nominalWidthByMaterial ? self.nominalWidthByMaterial[String(c.materialId)] : null;
                // #3769: «Срок изготовления» обеспечиваемых позиций — в скобках в конце строки.
                // Срок один на задание (позиции резки кластеризованы по сроку), поэтому
                // показываем общий набор сроков и красим строку по самому раннему (срочному):
                // раньше «Даты план» → красный, дальше план+DAYS_FORECAST → жёлтый, в окне → как есть.
                var dueKeys = cutDueKeys(c, self.supplies, self.genPositions);
                var dueClass = dueKeys.length ? dueColorClass(dueKeys[0], planDateDayKey(c.planDate), self.daysForecast()) : '';
                var dueSuffix = '';
                if (dueKeys.length) {
                    var dueLabels = dueKeys.map(formatDayKey).filter(function(s) { return s; });
                    if (dueLabels.length) dueSuffix = ' (' + (dueLabels.length > 1 ? 'сроки: ' : 'срок: ') + dueLabels.join(', ') + ')';
                }
                var matRows = stripGroups.map(function(g) {
                    // #3408: полосы хранят ФАКТИЧЕСКУЮ ширину (#3372: p.width = факт.),
                    // поэтому g.width — это факт.ширина. В сводку выводим сначала номинал
                    // (обратный резолв по справочнику), а после тире — реальные мм.
                    var ctx = { jumbo: jumboWidth, inches: null };
                    var nominal = resolveNominalWidth(g.width, ctx, self.actualWidthIndex);
                    return el('div', { class: 'atex-pp-strip-row' + (dueClass ? ' ' + dueClass : ''),
                        text: formatStripSummaryLine(c, { width: nominal, count: g.count }, g.width, runLengthForCut) + dueSuffix });
                });
                cardPanel.appendChild(el('div', { class: 'atex-pp-cut-material' }, matRows));
            }

            // #3354 п.2/п.3: клик по ЛЮБОМУ месту карточки выбирает резку и обновляет
            // .atex-pp-link, НЕ пересобирая очередь (selectCut вместо render) — поэтому
            // открытая панель полос (.atex-pp-strip-panel) не сворачивается ни при клике
            // по этой карточке, ни при клике по другой (закрытие — только её крестиком
            // .atex-pp-strip-close). cutClickSelectsCut пропускает лишь клики внутри
            // самой панели полос (она и так гасит всплытие).
            cardPanel.addEventListener('click', function(e) {
                if (!cutClickSelectsCut(e.target)) return;
                self.selectCut(c.id);
            });

            var controls = el('div', { class: 'atex-pp-cut-controls' });
            var up = el('button', { class: 'atex-pp-move', type: 'button', text: '↑', title: 'Выше' });
            var down = el('button', { class: 'atex-pp-move', type: 'button', text: '↓', title: 'Ниже' });
            // sameDayCuts/dayIdx вычислены выше (для seqText #3508 п.7) — переиспользуем.
            // #3508 п.3: зафиксированное задание нельзя двигать по очереди (↑↓ заблокированы).
            if (dayIdx === 0 || c.fixed) up.disabled = true;
            if (dayIdx === sameDayCuts.length - 1 || c.fixed) down.disabled = true;
            up.addEventListener('click', function() {
                if (self.busy || c.fixed) return;
                var p = moveInQueue(sameDayCuts, dayIdx, -1);
                if (p.length) self.saveSequences(p);
            });
            down.addEventListener('click', function() {
                if (self.busy || c.fixed) return;
                var p = moveInQueue(sameDayCuts, dayIdx, 1);
                if (p.length) self.saveSequences(p);
            });
            // #3706: остаток резки вне допуска → кнопка «Полосы» светло-красная,
            // чтобы отход вне допуска был виден прямо в очереди, без открытия панели.
            var stripsWarn = self.cutRemainderStatus(c) === 'warn';
            var strips = el('button', {
                class: 'atex-pp-strips' + (stripsWarn ? ' is-warn' : ''),
                type: 'button',
                text: stripsButtonLabel(c.knifeCount),
                title: stripsWarn ? 'Полосы резки — отход вне допуска' : 'Полосы резки (количество полос)'
            });
            strips.addEventListener('click', function() {
                if (self.busy) return;
                self.openStrips(c, cardPanel);   // #3508 п.3: для зафиксированных панель полос открывается только на просмотр
            });
            // #3508 п.4: «🔒» — переключить фиксацию ОДНОГО задания (зафиксировать ↔ снять).
            // Левее «🗑». is-active — когда задание уже зафиксировано (визуальный замок).
            var fix = el('button', {
                class: 'atex-pp-cut-fix' + (c.fixed ? ' is-active' : ''),
                type: 'button',
                text: '🔒',
                title: c.fixed ? 'Снять фиксацию задания' : 'Зафиксировать задание'
            });
            fix.addEventListener('click', function(e) {
                if (e && e.stopPropagation) e.stopPropagation();
                if (self.busy) return;
                self.toggleCutFixed(c);
            });
            // #3602: «🗓» — перенести задание на другой день (между «🔒» и «🗑»). Открывает
            // модалку (день + в начало/конец + «Зафиксировать»). Перенос имеет наивысший
            // приоритет — доступен и для зафиксированного задания. stopPropagation, чтобы
            // клик по кнопке не выбирал карточку.
            var move = el('button', {
                class: 'atex-pp-cut-move',
                type: 'button',
                text: '🗓',
                title: 'Перенести задание на другой день'
            });
            move.addEventListener('click', function(e) {
                if (e && e.stopPropagation) e.stopPropagation();
                if (self.busy) return;
                self.openMoveCut(c);
            });
            // #3486: «🗑» — удалить задание (резку) с её «Обеспечениями». stopPropagation,
            // чтобы клик по кнопке не выбирал резку (см. #3149: клики по контролам не
            // выбирают карточку). Подтверждение и удаление — в deleteCutTask.
            // #3508 п.3: зафиксированное задание удалить нельзя — кнопка заблокирована.
            var del = el('button', {
                class: 'atex-pp-cut-del' + (c.fixed ? ' is-disabled' : ''),
                type: 'button',
                text: '🗑',
                title: c.fixed ? 'Зафиксированное задание удалить нельзя (снимите фиксацию)' : 'Удалить задание'
            });
            if (c.fixed) del.disabled = true;
            del.addEventListener('click', function(e) {
                if (e && e.stopPropagation) e.stopPropagation();
                if (self.busy || c.fixed) return;
                self.deleteCutTask(c, cardPanel);
            });
            controls.appendChild(up);
            controls.appendChild(down);
            controls.appendChild(strips);
            controls.appendChild(fix);
            controls.appendChild(move);   // #3602: «🗓» перенос на другой день — между «🔒» и «🗑»
            // #3540: кнопки ◀▶ ручного сдвига планового старта убраны — двигать время вручную
            // не требуется. #3562: пин планового старта тоже убран — автогенерация двигает
            // зафиксированное задание по времени в течение дня и меняет его очередность.
            controls.appendChild(del);
            cardPanel.appendChild(controls);

            // #3616: дата рабочего дня — заголовком перед первой (видимой) карточкой каждого
            // дня расписания. Для дней 2+ он встаёт сразу ПОСЛЕ блока уборки предыдущего дня
            // («дату после записи об уборке»); для первого дня — в начале очереди. Дата =
            // база планирования (день фильтра) + смещение дня расписания.
            var cardSchedDay = sc ? schedDay(sc) : null;
            if (cardSchedDay != null && cardSchedDay !== lastDayDateRendered) {
                // #3743: после даты — суммарные минуты заданий станка за этот день: «(456 мин)».
                var dayMins = Math.round(Number(dayMinutesBySched[cardSchedDay]) || 0);
                // #3788: день расписания пришёлся на выходной/праздник, но задания на него есть
                // (вручную или вытеснены) — помечаем дату красным фоном.
                var dayOff = !self.dayIsWorking(planBaseMidnightMs + cardSchedDay * 86400000);
                groupEl.appendChild(el('div', {
                    class: 'atex-pp-day-date' + (dayOff ? ' is-dayoff' : ''),
                    title: dayOff ? 'Выходной/праздничный день — заданий быть не должно' : ''
                }, [
                    formatPlanDayHeading(planBaseMidnightMs, cardSchedDay),
                    el('span', { class: 'atex-pp-day-mins', text: ' (' + dayMins + ' мин)' })
                ]));
                lastDayDateRendered = cardSchedDay;
            }

            // #3846: блок «Обед» (#3342, плавающий) перед карточкой, идущей сразу после обеденного
            // зазора. Обед уже сидит в сохранённых planStart (его вставила генерация) — на странице
            // планирования рисуем его явно, чтобы зазор не выглядел «дырой» и совпадал с Гантом.
            // Обед привязан к началу послеобеденной резки (lunchByDay[].finishMin == окно карточки),
            // поэтому матчим один раз — по совпадению с окном (startMin − setupMin) текущей карточки.
            if (sc && cardSchedDay != null) {
                var lb = lunchByDay[cardSchedDay];
                if (lb && !lb._rendered && Math.abs((sc.startMin - sc.setupMin) - lb.finishMin) <= 1) {
                    groupEl.appendChild(el('div', { class: 'atex-pp-lunch',
                        text: '🍽 Обед · ' + formatClock(lb.startMin) + ' – ' + formatClock(lb.finishMin) +
                              ' · ' + lb.durationMin + ' мин' }));
                    lb._rendered = true;
                }
            }

            groupEl.appendChild(cardPanel);

            // Уборка в конце КАЖДОГО рабочего дня (#3155, #3280) — служит разделителем дня.
            // Резки, не влезшие в день, buildSchedule переносит на день+1 → они рендерятся
            // ПОСЛЕ блока уборки текущего дня, т.е. визуально в следующем дне, а не в этом.
            var myDay = sc ? schedDay(sc) : null;
            var nextCut = activeGroup.cuts[idx + 1];
            var nextSc = nextCut ? schedById[String(nextCut.id)] : null;
            var nextDay = nextSc ? schedDay(nextSc) : null;
            // #3613: задание, не влезшее в рабочий день, нормально дробить по дням. На
            // первой и последней карточке такой цепочки — значок справа внизу: «←» начало
            // в предыдущем дне, «→» продолжение в следующем. Смежные сегменты опознаём по
            // идентичной конфигурации резки и единому номеру заказа (isDaySplitSibling),
            // взятые у соседей очереди через границу рабочего дня (по schedDay расписания —
            // тому же, что разделяет дни блоком уборки).
            var prevCut = activeGroup.cuts[idx - 1];
            var prevSc = prevCut ? schedById[String(prevCut.id)] : null;
            var prevDay = prevSc ? schedDay(prevSc) : null;
            // #3737: первая (нет prev) / последняя (нет next) карточка диапазона — подменяем
            // отсутствующего соседа через границу дня смежным сегментом из дня ВНЕ фильтра,
            // чтобы значок ←/→ рисовался и при выбранном одном дне. Синтетический день соседа
            // (myDay∓1) гарантирует переход через границу (prevDay/nextDay !== myDay).
            if (!prevCut && myDay != null) {
                var bPrev = boundaryDaySibling(self.cuts, c, -1);
                if (bPrev) { prevCut = bPrev; prevDay = myDay - 1; }
            }
            if (!nextCut && myDay != null) {
                var bNext = boundaryDaySibling(self.cuts, c, 1);
                if (bNext) { nextCut = bNext; nextDay = myDay + 1; }
            }
            var spans = daySplitBadges(prevCut, prevDay, c, myDay, nextCut, nextDay);
            // #3889: сегмент НАСТРОЙКИ (0 проходов) ВСЕГДА продолжается в следующем дне — его
            // создаёт только splitMachineQueue как разрыв «настройка в хвосте дня N → намотка с
            // дня N+1». Поэтому значок «→» форсируем по setupOnly, не полагаясь на совпадение
            // continuationSignature с соседом (у настройки сырьё/намотка могут быть пустыми —
            // тогда сигнатура не совпала бы и значок пропал, хотя продолжение есть).
            if (isSetupTask) spans.toNext = true;
            // #3889: пробрасываем признаки дробления в контекст тайминга — модалка поясняет,
            // что резка продолжится (toNext) или продолжает вчерашнюю (fromPrev).
            var timingCtx = self._timingByCut[String(c.id)];
            if (timingCtx) {
                timingCtx.continuesNextDay = !!spans.toNext;
                timingCtx.continuesFromPrevDay = !!spans.fromPrev;
            }
            if (spans.fromPrev || spans.toNext) {
                var spanBadges = [];
                if (spans.fromPrev) spanBadges.push(el('span', {
                    class: 'atex-pp-cut-span atex-pp-cut-span-prev',
                    title: 'Начало задания — в предыдущем рабочем дне' + (c.orderId ? ' (заказ ' + c.orderId + ')' : ''),
                    text: '←'
                }));
                if (spans.toNext) spanBadges.push(el('span', {
                    class: 'atex-pp-cut-span atex-pp-cut-span-next',
                    title: (isSetupTask
                        ? 'Только настройка станка — намотка продолжится в следующем рабочем дне'
                        : 'Задание продолжается в следующем рабочем дне') + (c.orderId ? ' (заказ ' + c.orderId + ')' : ''),
                    text: '→'
                }));
                cardPanel.appendChild(el('div', { class: 'atex-pp-cut-spans' }, spanBadges));
            }
            var lastOfDay = sc && (idx === activeGroup.cuts.length - 1 || (nextDay != null && nextDay !== myDay));
            if (lastOfDay) {
                var cl = cleanupByDay[myDay];
                if (cl) {
                    groupEl.appendChild(el('div', { class: 'atex-pp-cleanup',
                        text: '🧹 Уборка после смены · ' + formatClock(cl.startMin) + ' – ' + formatClock(cl.finishMin) +
                              ' · ' + cl.durationMin + ' мин' }));
                }
            }
        });
        // #3411: активный станок без совпадений по поиску — подсказка вместо пустоты
        // (счётчики на закладках подскажут, где совпадения есть).
        if (hasQuery && !groupEl.childNodes.length) {
            groupEl.appendChild(el('div', { class: 'atex-pp-empty', text: 'В этом станке нет позиций по запросу «' + query + '».' }));
        } else if (!groupEl.childNodes.length) {
            // #3788: отображаемая дата — выходной/праздник → красным «Выходной день» ПЕРЕД
            // «Заданий в очереди нет» (планирование такие дни пропускает).
            if (!self.dayIsWorking(planBaseMidnightMs)) {
                groupEl.appendChild(el('div', { class: 'atex-pp-dayoff-note', text: 'Выходной день' }));
            }
            // #3535: активный станок без резок в этот день — явная подсказка вместо пустоты.
            // #3787: если у станка есть отпуск(а), пересекающие отображаемую дату — дописываем
            // его детали: «Заданий в очереди нет, отпуск с … по …» (несколько — через запятую).
            var dtNote = downtimeRangeNote(
                (self.downtimesBySlitter || {})[String(activeGroup.slitter && activeGroup.slitter.id)],
                self.filter && self.filter.date, self.filter && self.filter.dateTo);
            groupEl.appendChild(el('div', { class: 'atex-pp-empty',
                text: 'Заданий в очереди нет' + (dtNote ? ', ' + dtNote : '') }));
        }
        box.appendChild(groupEl);
        console.log('[pp] 📊 renderQueue: отрисовано за ' + (Date.now() - t0) + 'мс. групп:', groups.length, 'резок:', self.cuts.length);
        } finally {
            this._renderingQueue = false;
        }
    };

    AtexProductionPlanning.prototype.renderLink = function() {
        var self = this;
        var box = this.linkEl;
        box.innerHTML = '';
        var cut = this.cuts.filter(function(c) { return String(c.id) === String(this.selectedCutId); }, this)[0];

        if (!cut) {
            box.appendChild(el('div', { class: 'atex-pp-empty', text: 'Выберите задание в очереди, чтобы увидеть связанные позиции.' }));
            return;
        }

        // Связанные позиции резки (только список; добавление/резерв — вне этой панели).
        var linked = this.supplies.filter(function(s) { return String(s.cutId) === String(cut.id); });
        var listWrap = el('div', { class: 'atex-pp-linked' });
        listWrap.appendChild(el('h3', { class: 'atex-pp-linked-title', text: 'Связанные позиции (' + linked.length + ')' }));
        if (!linked.length) {
            listWrap.appendChild(el('div', { class: 'atex-pp-empty', text: 'Пока нет связей.' }));
        } else {
            var posById = {};
            this.positions.forEach(function(p) { posById[p.id] = p; });
            // #3892: метраж берём по ВСЕЙ резке (длина прогона = «Метраж, м», одинакова у всех
            // сегментов цепочки, #3781), а НЕ из «Метраж, м» обеспечения этого сегмента. У
            // переходящей (дроблёной) резки обеспечение делится по дням (splitSupplyShares), и
            // raw-метраж сегмента — бессмысленная дробь (напр. 348.496 вместо 450). cutRunLength
            // стартует с cut.length (head) и игнорирует делёные доли → реальная длина прогона.
            var cutRunLen = cutRunLength(cut, self.supplies, self.footageBySupply);
            linked.forEach(function(s) {
                // #3406 п.1: подпись + «Количество» позиции заказа + рулоны/метраж.
                var foot = cutRunLen > 0 ? cutRunLen : supplyFootage(s, self.footageBySupply);
                var label = formatLinkedPositionLabel(posById[s.positionId], s.positionId, s.rolls, foot, s.orderNo, s.positionWidth, s.positionLength);
                var children = [el('span', { class: 'atex-pp-linked-label', text: label })];
                var del = el('button', { class: 'atex-pp-linked-del', type: 'button', text: '×', title: 'Убрать из задания' });
                del.addEventListener('click', function() { self.deleteSupply(s.id); });
                children.push(del);
                listWrap.appendChild(el('div', { class: 'atex-pp-linked-item' }, children));
            });
        }
        box.appendChild(listWrap);
    };

    // ── Служебное ──

    AtexProductionPlanning.prototype.setBusy = function(on) {
        this.busy = on;
        if (this.root) this.root.classList.toggle('is-busy', !!on);
    };

    // Деактивирует кнопку «Сгенерировать резки» и показывает крутилку слева от неё
    // на время запросов preferable_widths (generateCuts, #3332) и самой генерации
    // (runGenerateCuts). По завершении/ошибке — возвращает кнопку и прячет крутилку.
    AtexProductionPlanning.prototype.setGenBusy = function(on) {
        if (this.genBtn) this.genBtn.disabled = !!on;
        if (this.genSpinner) this.genSpinner.style.display = on ? '' : 'none';
    };

    // Уведомления без alert/confirm/prompt (раздел 8 гайда): встроенный тост,
    // либо общий MainAppController, если он доступен в main.html.
    AtexProductionPlanning.prototype.notify = function(message, kind) {
        if (kind === 'error' && typeof window !== 'undefined' && window.mainAppController &&
            typeof window.mainAppController.showErrorModal === 'function') {
            window.mainAppController.showErrorModal(message);
            return;
        }
        var toast = el('div', { class: 'atex-pp-toast atex-pp-toast-' + (kind || 'info'), text: message });
        (this.toastHost || document.body).appendChild(toast);
        setTimeout(function() { toast.classList.add('is-visible'); }, 10);
        setTimeout(function() {
            toast.classList.remove('is-visible');
            setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
        }, 3500);
    };

    // Окно прогресса длительной генерации резок (#3148). Модальный оверлей с
    // заголовком, полосой прогресса и счётчиком «N из M». Крепится к document.body,
    // чтобы не тускнеть под .atex-pp.is-busy (opacity .65) и быть поверх всего.
    // Без кнопок: операция неотменяема, окно — только индикатор хода.
    AtexProductionPlanning.prototype.showProgress = function(title, total) {
        this.hideProgress();
        this.progressTotal = Number(total) || 0;
        // #3865: total ≤ 0 → этап подготовки без счётчика, полоса «бежит» (is-indeterminate),
        // под ней показываем текст «что происходит» (updateProgress detail).
        var bar = el('div', { class: 'atex-pp-progress-bar' + (this.progressTotal > 0 ? '' : ' is-indeterminate') });
        var fill = el('div', { class: 'atex-pp-progress-fill' });
        bar.appendChild(fill);
        var counter = el('div', { class: 'atex-pp-progress-count', text: '' });
        var dialog = el('div', { class: 'atex-pp-progress-dialog' }, [
            el('div', { class: 'atex-pp-progress-title', text: title || 'Генерация заданий…' }),
            bar,
            counter
        ]);
        var overlay = el('div', { class: 'atex-pp-progress is-open' }, [dialog]);
        (document.body || this.root).appendChild(overlay);
        this.progressEl = overlay;
        this.progressFill = fill;
        this.progressCounter = counter;
        this.updateProgress(0);
    };

    // Обновить полосу/счётчик. done — сколько готово; detail — строка под полосой
    // (если не задана — «done из total»). Без открытого окна — ничего не делает.
    AtexProductionPlanning.prototype.updateProgress = function(done, detail) {
        if (!this.progressEl) return;
        var total = this.progressTotal || 0;
        var pct = planning.progressPercent(done, total);
        if (this.progressFill) this.progressFill.style.width = pct + '%';
        if (this.progressCounter) {
            this.progressCounter.textContent = detail != null
                ? detail
                : (total > 0 ? ((Number(done) || 0) + ' из ' + total + ' (' + pct + '%)') : '');
        }
    };

    AtexProductionPlanning.prototype.hideProgress = function() {
        if (this.progressEl && this.progressEl.parentNode) {
            this.progressEl.parentNode.removeChild(this.progressEl);
        }
        this.progressEl = null;
        this.progressFill = null;
        this.progressCounter = null;
        this.progressTotal = 0;
    };

    AtexProductionPlanning.prototype.fatal = function(message) {
        this.root.innerHTML = '';
        this.root.appendChild(el('div', { class: 'atex-pp-fatal', text: message }));
    };

    AtexProductionPlanning.prototype.start = function() {
        var self = this;
        this.root.innerHTML = '';
        var layout = el('div', { class: 'atex-pp-layout' });

        // Форма новой резки живёт в модалке (#3116 п.1), открывается кнопкой «+».
        this.formEl = el('section', { class: 'atex-pp-form', 'data-submit-scope': '' });

        // #3475: панель действий — под заголовком (.atex-pp-panel-head column в CSS).
        // Порядок: «Сгенерировать» (основная) → «Добавить вручную» (второстепенная) →
        // «Удалить» (warning, последняя). Названия укорочены, акценты переставлены.
        var queueActions = el('div', { class: 'atex-pp-panel-actions' });
        var genSpinner = el('span', { class: 'atex-pp-spinner atex-pp-gen-spinner', title: 'Идёт генерация заданий…' });
        genSpinner.style.display = 'none';
        // #3475: «Сгенерировать» — основная кнопка (atex-pp-btn-primary).
        var genBtn = el('button', { class: 'atex-pp-btn atex-pp-btn-primary atex-pp-gen-btn', type: 'button', text: 'Сгенерировать' });
        genBtn.addEventListener('click', function() { self.generateCuts(queueActions); });
        this.genBtn = genBtn;
        this.genSpinner = genSpinner;
        // «Сгенерировать резки» только создаёт резки для незапланированных позиций и
        // дописывает их в конец очереди (#3449); уже запланированные резки не трогает.
        // Перестановку очереди оператор делает вручную (↑↓).
        // #3475: «Добавить вручную» — второстепенная кнопка (без -primary).
        var addBtn = el('button', { class: 'atex-pp-btn atex-pp-add', type: 'button', text: 'Добавить вручную' });
        addBtn.addEventListener('click', function() { self.openForm(); });
        // #3783/#3785: «Упорядочить» — пересобрать очередь видимого диапазона в оптимальный
        // порядок (минимум переналадок: группировка сырья; при прочих равных больше полос
        // раньше). Перезаписывает ручной порядок (#3449) — поэтому через подтверждение.
        var orderBtn = el('button', { class: 'atex-pp-btn atex-pp-order-queue', type: 'button', text: 'Упорядочить',
            title: 'Пересобрать очередь: группировка по сырью, минимум переналадок (при прочих равных больше полос раньше)' });
        orderBtn.addEventListener('click', function() { self.optimizeQueue(queueActions); });
        // #3508 п.2: «Зафиксировать» — проставить флаг всем заданиям выбранного дня
        // (все станки). Между «Добавить вручную» и «Удалить».
        var fixBtn = el('button', { class: 'atex-pp-btn atex-pp-fix-day', type: 'button', text: 'Зафиксировать', title: 'Зафиксировать все задания этого дня' });
        fixBtn.addEventListener('click', function() { self.fixDayTasks(); });
        // #3475: «Удалить» (warning, жёлтая) — удаляет все задания выбранного дня:
        // сначала «Обеспечение» (снимаем ссылки на «Партии ГП»), затем «Производственную
        // резку» (BatchDelete каскадом снимет подчинённые Партии ГП/Полосы/Расход).
        var delBtn = el('button', { class: 'atex-pp-btn atex-pp-btn-warning atex-pp-del-day', type: 'button', text: 'Удалить' });
        delBtn.addEventListener('click', function() { self.deleteDayTasks(queueActions); });
        // #3764: «Отпуск {станок}» — правее «Удалить». Открывает редактор окон простоя активного
        // станка. Подпись/доступность/видимость проставляются в renderQueue (по активному станку
        // и наличию таблицы «Отпуск» в метаданных). До загрузки метаданных кнопка скрыта.
        var downtimeBtn = el('button', { class: 'atex-pp-btn atex-pp-dt-btn', type: 'button', text: 'Отпуск', title: 'Окна простоя станка (ТО и т.п.) — автогенерация их пропускает' });
        downtimeBtn.style.display = 'none';
        downtimeBtn.addEventListener('click', function() { self.openDowntime(); });
        this.downtimeBtn = downtimeBtn;
        queueActions.appendChild(genSpinner);
        queueActions.appendChild(genBtn);
        queueActions.appendChild(addBtn);
        queueActions.appendChild(orderBtn);
        queueActions.appendChild(fixBtn);
        queueActions.appendChild(delBtn);
        queueActions.appendChild(downtimeBtn);
        var queueHead = el('div', { class: 'atex-pp-panel-head' }, [
            el('h2', { class: 'atex-pp-form-title', text: 'Очередь заданий по станкам' }),
            queueActions
        ]);
        var queueWrap = el('section', { class: 'atex-pp-panel atex-pp-queue-panel' }, [queueHead]);
        this.queueEl = el('div', { class: 'atex-pp-queue' });
        queueWrap.appendChild(this.queueEl);
        this.linkEl = el('section', { class: 'atex-pp-panel atex-pp-link' });
        layout.appendChild(queueWrap);
        layout.appendChild(this.linkEl);
        this.root.appendChild(layout);

        // Модалка формы: оверлей + диалог с крестиком; закрытие по ×/оверлею/Esc.
        var dialog = el('div', { class: 'atex-pp-modal-dialog' });
        var closeX = el('button', { class: 'atex-pp-modal-close', type: 'button', text: '×', title: 'Закрыть' });
        closeX.addEventListener('click', function() { self.closeForm(); });
        dialog.appendChild(closeX);
        dialog.appendChild(this.formEl);
        this.modalEl = el('div', { class: 'atex-pp-modal' }, [dialog]);
        this.modalEl.addEventListener('click', function(e) { if (e.target === self.modalEl) self.closeForm(); });
        this.root.appendChild(this.modalEl);

        var timingTitle = el('h2', { class: 'atex-pp-form-title', text: 'Тайминг резки' });
        var timingBody = el('pre', { class: 'atex-pp-timing-body', text: '' });
        var timingDialog = el('div', { class: 'atex-pp-modal-dialog atex-pp-timing-dialog' });
        var timingClose = el('button', { class: 'atex-pp-modal-close', type: 'button', text: '×', title: 'Закрыть' });
        timingClose.addEventListener('click', function() { self.closeCutTiming(); });
        timingDialog.appendChild(timingClose);
        timingDialog.appendChild(timingTitle);
        timingDialog.appendChild(timingBody);
        this.timingModalTitleEl = timingTitle;
        this.timingModalBodyEl = timingBody;
        this.timingModalEl = el('div', { class: 'atex-pp-modal atex-pp-timing-modal' }, [timingDialog]);
        this.timingModalEl.addEventListener('click', function(e) { if (e.target === self.timingModalEl) self.closeCutTiming(); });
        this.root.appendChild(this.timingModalEl);

        // #3764/#3844: модалка «Отпуск» (окна простоя станка) — заголовок, редактируемая
        // таблица, кнопка «+ Отпуск» и «ОК»/«×» для закрытия. Скаффолд — buildDowntimeModal.
        this.buildDowntimeModal();

        if (typeof document !== 'undefined') {
            document.addEventListener('keydown', function(e) {
                if (e.key !== 'Escape' && e.keyCode !== 27) return;
                if (self.downtimeModalEl && self.downtimeModalEl.classList.contains('is-open')) {
                    self.closeDowntime();
                    return;
                }
                if (self.timingModalEl && self.timingModalEl.classList.contains('is-open')) {
                    self.closeCutTiming();
                    return;
                }
                if (self.modalEl && self.modalEl.classList.contains('is-open')) self.closeForm();
            });
        }
        this.toastHost = this.root;

        this.queueEl.appendChild(el('div', { class: 'atex-pp-loading', text: 'Загрузка…' }));

        return this.loadMetadata()
            .then(function() {
                return Promise.all([
                    self.loadSlittersWithStop().then(function(items) {
                        self.slitters = items;
                        // #3764: окна простоя после станков. #3862: заправку станков (prev_cut_setup)
                        // грузим ПОСЛЕ списка станков — по каждому свой фильтрованный запрос.
                        return Promise.all([self.loadDowntimes(), self.loadPrevCutSetup()]);
                    }),
                    self.loadMaterialBatches(),
                    self.loadMaxStock(),   // #3391: целесообразные к хранению номенклатуры (склад vs отход)
                    self.loadLeaders(),    // #3569: справочник «Лидер» — резолв метки лидера позиции в id для задания
                    self.loadPositions(),  // заполняет genPositions (с dueKey) тоже
                    // #3445: loadStockBalance после loadGenBatches — нужен batchMaterialById (сырьё резки).
                    self.loadGenBatches().then(function() { return self.loadStockBalance(); }),
                    self.loadJumboWidths(),// ширина джамбо по сырью (для cut-layout)
                    self.loadOperationTimes(), // времена переналадок (веса очереди)
                    self.loadDaySettings(),    // DAY_START_HOUR/DAY_END_HOUR для рабочего окна
                    self.loadCalendar(),       // #3788: праздничные/рабочие дни (пропуск выходных при планировании)
                    self.loadSupplyFootage(),  // метраж обеспечений (длительность/расписание)
                    self.loadConsumption(),    // расход сырья (FIFO-резерв, Фаза 1b)
                    self.loadSleeveBatches(),  // #3340: партии втулок «в работе» (FIFO) + втулкорез TC-20
                    self.loadActualWidths(),   // #3372: справочник фактической ширины резки (66190)
                    self.loadSleeveInches(),   // #3372: дюймы втулки по записи 8188 (контекст условия)
                    self.loadSleeveWidths(),   // #3812: ширина втулки (мм) по записи (57/110) — втулочные полосы
                    // #3862: loadPrevCutSetup перенесён в цепочку после loadSlittersWithStop (нужен список станков).
                    // Полосы перед очередью: knifeCount/knifeWidths вливаются в резки в loadPlanning.
                    self.loadCutStrips().then(function() { return self.loadPlanning(); })
                ]);
            })
            // #3372: фактическая ширина резки — после загрузки позиций/ширин джамбо/справочников.
            .then(function() { self.annotatePositionsCutWidth(); self.resolveCutMaterials(); self.render(); })
            .catch(function(err) { self.fatal('Ошибка инициализации: ' + err.message); });
    };

    function init() {
        if (typeof document === 'undefined') return;
        var root = document.getElementById('atex-production-planning');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        console.log('[pp] 🟢 init: запуск production-planning, db=', (root.getAttribute('data-db') || '?'));
        var controller = new AtexProductionPlanning(root);
        root._atexProductionPlanning = controller;
        // #3638: deep-link из cut-gantt (?cut=..&date=..&slitter=..) — после загрузки
        // данных открыть очередь на нужном дне/станке и подсветить задание.
        var deepLink = (typeof window !== 'undefined' && window.location)
            ? parseDeepLink(window.location.search) : null;
        var started = controller.start();
        if (deepLink && (deepLink.cut || deepLink.date || deepLink.slitter) && started && typeof started.then === 'function') {
            started.then(function() { controller.applyDeepLink(deepLink); });
        }
    }

    return { planning: planning, Controller: AtexProductionPlanning, init: init };
});

 
 
// @version 2026-06-29-issue-3865
