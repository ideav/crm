// Рабочее место atex «Планирование производства» (роль Диспетчер).
//
// Создание производственной резки (слиттер, тип резки, партия сырья, дата
// плана, статус), очередь резок по слиттерам и привязка резки к позициям заказа
// через подчинённую таблицу «Обеспечение». Решение задачи ideav/crm#2913
// (часть #2903). Правила разработки рабочих мест — docs/WORKSPACE_DEVELOPMENT_GUIDE.md.
// 
//  Чтения очереди резок и их обеспечения берутся одним отчётом защищённого слоя
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

    // #3914: диагностическая трассировка планирования дня. По умолчанию МОЛЧИТ
    // (в Node/тестах window нет). Включить в браузере одним из способов:
    //   • в консоли:  window.PP_TRACE = true   (потом нажать «Сгенерировать»)
    //   • в адресе:   ...production-planning?pptrace=1
    // Тогда splitMachineQueue печатает каждый шаг раскладки по дням, applyDowntime —
    // сдвиги за «Отпуск»/выходной, а бейдж «(N мин)» — из чего складывается сумма дня
    // и какой день превысил ёмкость (WARN). Это диагностика причины «520 мин» (#3914).
    function ppTraceOn() {
        try {
            if (typeof window === 'undefined') return false;
            if (window.PP_TRACE) return true;
            return /[?&]pptrace=1\b/.test(String((window.location && window.location.search) || ''));
        } catch (e) { return false; }
    }
    function ppTrace() {
        if (!ppTraceOn()) return;
        try { console.log.apply(console, ['[pp-trace]'].concat([].slice.call(arguments))); } catch (e) {}
    }
    function ppTraceWarn() {
        if (!ppTraceOn()) return;
        try { console.warn.apply(console, ['[pp-trace] ⚠️'].concat([].slice.call(arguments))); } catch (e) {}
    }
    // #4095: трассировка СЛОЯ РАЗМЕЩЕНИЯ (#3985/#4085) — отдельный, БОЛЕЕ ГРОМКИЙ канал, чем ppTrace.
    // По умолчанию ВКЛючён в браузере (заказчик #4095: «включи и не отключай пока не скажу»), чтобы лог
    // выбора слота печатался на «Сгенерировать»/«Упорядочить» без ручного тумблера. Выключить:
    //   • в консоли:  window.PP_TRACE_PLACEMENT = false
    // В Node/тестах МОЛЧИТ, кроме явного форса globalThis.PP_TRACE_PLACEMENT = true (чтобы тест видел лог).
    function slotTraceOn() {
        try {
            if (typeof globalThis !== 'undefined' && globalThis.PP_TRACE_PLACEMENT === true) return true;
            if (typeof window === 'undefined') return false;
            if (window.PP_TRACE_PLACEMENT === false) return false;
            return true;
        } catch (e) { return false; }
    }
    function slotTrace() {
        if (!slotTraceOn()) return;
        try { console.log.apply(console, ['[pp-slot]'].concat([].slice.call(arguments))); } catch (e) {}
    }
    // Мин от полуночи → «ЧЧ:ММ» (для читаемого лога; отрицательные/дробные допустимы).
    function ppClock(min) {
        var m = Math.round(Number(min) || 0);
        var d = Math.floor(m / 1440); m -= d * 1440;
        var hh = Math.floor(m / 60), mm = m % 60;
        var s = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
        return d ? (s + '(+' + d + 'д)') : s;
    }
    // Свод рабочих минут (setup+намотка) по ДНЮ из сегментов splitMachineQueue или
    // строк расписания; печатает WARN на днях, превысивших бюджет (cutEnd−dayStart
    // −обед+нахлёст). Общий помощник для трассировки генерации и бейджа.
    function ppTraceDaySummary(label, items, getWork, opts) {
        if (!ppTraceOn()) return;
        opts = opts || {};
        var budget = null;
        if (opts.dayEndMin != null && opts.dayStartMin != null) {
            budget = (Number(opts.dayEndMin) - Number(opts.dayStartMin))
                - (Number(opts.lunchDurationMin) || 0)
                + (Number(opts.maxOverworkTuneMin) || 0);
        }
        var byDay = {};
        (items || []).forEach(function(it) {
            var d = opts.dayOf ? opts.dayOf(it) : it.day;
            if (d == null) return;
            byDay[d] = (byDay[d] || 0) + (Number(getWork(it)) || 0);
        });
        var days = Object.keys(byDay).map(Number).sort(function(a, b) { return a - b; });
        ppTrace(label + ': минут по дням' + (budget != null ? (' (бюджет ≈ ' + Math.round(budget) + ')') : ''));
        days.forEach(function(d) {
            var work = Math.round(byDay[d]);
            var over = (budget != null && work > budget + 1e-6);
            (over ? ppTraceWarn : ppTrace)('  день ' + d + ': ' + work + ' мин' + (over ? ' — ПРЕВЫШЕНИЕ на ' + Math.round(work - budget) : ''));
        });
    }

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
        calendar: 'Календарь',           // #3788: таблица «Календарь» (123162) — праздничные/рабочие дни (исключения)
        freeze: 'Заморозка'              // #4326: таблица «Заморозка» (633483) — «замок дня»: планирование не трогает эти дни
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
    // #4326: «Заморозка» (633483, главное значение — DATE ДД.ММ.ГГГГ, unique). Реквизит
    // «Примечание» (633484) — причина фиксации дня, показывается title-подсказкой замка. Наличие
    // записи на день ⇒ день заморожен: планирование не трогает его задания и не кладёт на него новых.
    var FREEZE_REQ = { notes: 'Примечание' };
    // #3788: горизонт расчёта нерабочих дней расписания (дней вперёд от базы). Покрывает
    // годовой набор праздников; дальше плановой очереди не бывает.
    var CALENDAR_HORIZON_DAYS = 366;
    // #3898: отпуск станка длиной НЕ БОЛЕЕ этого числа КАЛЕНДАРНЫХ дней НЕ сбрасывает заправку
    // (сырьё/ножи) — первая резка после такого короткого простоя наследует прежнюю настройку,
    // а не пересчитывает её с нуля (#3876). Длиннее порога → заправка обнуляется (полная
    // настройка после отпуска). Менять здесь, если порог «короткого» отпуска нужно сдвинуть.
    var DOWNTIME_KEEP_SETUP_MAX_DAYS = 2;
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
        plannedRuns: 'Кол-во план',
        duration: 'Длительность, минут',
        timing: 'Тайминг',
        actualRuns: 'Кол-во факт',
        length: 'Метраж, м',
        winding: 'Тип намотки',
        leader: 'Лидер',         // #3569: ссылка на «Лидер» (82519); при планировании копируется из позиции
        material: 'Вид сырья',   // #3688: ссылка на «Вид сырья» (95358→1069); пишется при планировании — по ней сверяется заправка станка
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
    // #4051: «Срок изготовления» обеспечиваемой позиции прямо из cut_planning — чтобы плашка
    // срока показывалась и для позиции вне активного positions_list (заказ закрыт/выполнен),
    // как #3633 сделал для габаритов. Колонка due_date отчёта = «Заказанное количество →
    // Срок изготовления». Нет колонки → пусто → Infinity → фолбэк на genPositions (как было).
    var SUPPLY_DUE_DATE_COLUMNS = ['due_date', 'position_due_date', 'supply_due_date', 'supply_position_due_date'];
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
        return {
            id: String(record && record.i),
            number: r[0] == null ? '' : String(r[0]),
            slitter: ref(CUT_REQ.slitter),
            materialBatch: ref(CUT_REQ.materialBatch),
            planDate: val(CUT_REQ.planDate),
            status: val(CUT_REQ.status),
            // #3923: «Очередность» больше не хранится — порядок задаёт planStart (planDate).
            // Поле оставлено (=null) как in-memory ординал генерации (orderCuts заполняет копии).
            sequence: null
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
        // #3923: сортировка резок внутри группы — день плана, затем сохранённый planStart
        // (planDate, возр.; пусто/NaN — в конец), затем ножи по убыванию как fallback для
        // резок без planStart. planStart — единственный источник порядка (совпадает с РМ
        // «Диаграмма Ганта» и очередью станка), «Очередность» больше не хранится.
        function planStartKey(c) { var v = c && c.planDate; var n = Number(v); return (v == null || v === '' || !isFinite(n)) ? Infinity : n; }
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
                        || (planStartKey(a.c) - planStartKey(b.c))
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
            // #4298: ширины полос (ножей) резки — чтобы поиск по ширине (напр. «110») находил резку
            // по её СОБСТВЕННОЙ геометрии, а не только по подписи связанной позиции. Подписи позиций
            // строятся из обеспечений/this.positions, которые после ручного переноса+пересчёта могут
            // временно устареть (карточка при этом показывает «110мм» из knifeWidths) → поиск «110»
            // не находил резки станка. Матч по своей ширине устойчив к этому. Дубли ширин схлопываем.
            var seenW = {};
            (cut.knifeWidths || []).forEach(function(w) {
                var s = String(w == null ? '' : w).trim();
                if (s !== '' && s !== 'null' && !seenW[s]) { seenW[s] = 1; parts.push(s); }
            });
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

    // #4050: «Срок изготовления» (dueKey, YYYYMMDD из cutDueKeys) → индекс дня раскладки от базы
    // «С» (planBaseMidnightMs) — как dayOffsetFromBase для «Даты план». Нужен, чтобы сравнивать срок
    // с днём размещения (day-индекс splitMachineQueue) в §8-штрафе (DEADLINE/EXACT). Отрицательный
    // = срок раньше базы (просрочено). Невалидный ключ → null (штраф не применяется).
    function dueDayOffsetFromBase(dueKey, baseMidnightMs) {
        var base = Number(baseMidnightMs);
        if (!isFinite(base)) return null;
        var dt = dayKeyToDate(dueKey);
        if (!dt) return null;
        return Math.round((dt.getTime() - base) / 86400000);
    }

    // #4085 (ТЗ §8): ОБРАТНОЕ к dueDayOffsetFromBase — индекс дня раскладки от базы «С»
    // (planBaseMidnightMs) → ключ дня YYYYMMDD. Слой размещения (15-slot-placement) оценивает день
    // приземления слота (prefixDayOffset) и через этот хелпер получает placementDayKey, чтобы
    // transitionCost сравнил его со сроком next.dueKey (день>срока → DEADLINE, день=сроку → EXACT).
    // Считаем по компонентам даты (устойчиво к переводу часов), формат совпадает с dueKey.
    function dayKeyFromOffset(baseMidnightMs, dayOffset) {
        var base = Number(baseMidnightMs), off = Number(dayOffset);
        if (!isFinite(base) || !isFinite(off)) return null;
        var b = new Date(base);
        if (isNaN(b.getTime())) return null;
        var d = new Date(b.getFullYear(), b.getMonth(), b.getDate() + Math.round(off), 0, 0, 0, 0);
        return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
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
            if (cutIsStarted(c)) return false;   // #4381: начатые неприкосновенны — «Удалить» день их не сносит
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
                    // #4346: фактические отметки исполнения из cut_planning («Начато»/«Закончено»
                    // резки — их же читает Гант, cut-gantt.js). Пустое «Закончено» = задание не
                    // выполнено; на этой паре плана и факта стоит детектор отклонений
                    // (deviationGroups) кнопки «Отклонения N/M».
                    startDate: str(row.cut_start_date),
                    endDate: str(row.cut_end_date),
                    sequence: null,   // #3923: порядок задаёт planStart; поле — in-memory ординал генерации
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
                    // #4051: «Срок изготовления» позиции прямо из cut_planning (due_date) —
                    // YYYYMMDD-ключ через batchDateKey (тот же формат, что genPositions.dueKey).
                    // Нужен фолбэком в cutDueKeys, когда позиция выпала из активного positions_list.
                    // Нет колонки/пусто → Infinity.
                    dueKey: batchDateKey(rowValue(row, SUPPLY_DUE_DATE_COLUMNS)),
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

    // #4064: на сколько ДНЕЙ размещение (placementDayKey, YYYYMMDD) позже срока (dueKey, YYYYMMDD).
    // В срок/заранее или нет данных → 0. База метрики опоздания плана для выбора кандидата «Упорядочить».
    function lateDaysOf(placementDayKey, dueKey) {
        var plan = dayKeyToDate(placementDayKey), due = dayKeyToDate(dueKey);
        if (!plan || !due) return 0;
        var diff = Math.round((plan.getTime() - due.getTime()) / 86400000);
        return diff > 0 ? diff : 0;
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
    // #4051: includeSupplyFallback — когда позиция выпала из активного positions_list
    // (genPositions её не содержит) или у неё там нет срока, берём «Срок изготовления»
    // прямо из обеспечения (supply.dueKey из cut_planning.due_date). Так плашка срока
    // показывается и для заданий с закрытым/выполненным заказом. Флаг ВЫКЛючён у #4050
    // (штраф дня размещения в selectByConfig): просроченный срок неактивной позиции не
    // должен молча менять раскладку — это отдельное решение, не задача #4051.
    // Без фолбэка (флаг off) поведение прежнее: позиции без срока/вне positions_list пропускаются.
    function cutDueKeys(cut, supplies, genPositions, includeSupplyFallback) {
        var posMap = positionMap(genPositions);
        var seen = {}, keys = [];
        (supplies || []).forEach(function(s) {
            if (!cut || !s || String(s.cutId) !== String(cut.id)) return;
            var p = s.positionId != null ? posMap[String(s.positionId)] : null;
            var k = p && p.dueKey;
            if (includeSupplyFallback && (k == null || !isFinite(k) || k === Infinity)) k = s.dueKey;
            if (k == null || !isFinite(k) || k === Infinity) return;
            if (!seen[k]) { seen[k] = true; keys.push(k); }
        });
        return keys.sort(function(a, b) { return a - b; });
    }

    // #4230: ключи ширин полос резки, идущих В ЗАКАЗ. Полоса резки идёт «в заказ», если её
    // ширина совпадает с шириной обеспечиваемой позиции заказа (supply.positionId → позиция →
    // width). Всё остальное этой резки (лишние полосы добора джамбо, #3391) идёт на склад или в
    // отходы — их подпись в карточке красится и вместо срока пишет «Склад»/«Отходы» (stockStripPurpose).
    // Ширина берётся из позиции активного positions_list, фолбэк — из самого cut_planning
    // (supply.positionWidth), когда позиция выпала из активного списка (#4051-подобно, как в cutDueKeys).
    // Чистая (DOM не трогает) — покрыта тестом. → { stripWidthKey(width): true }.
    function cutOrderedWidthKeys(cut, supplies, genPositions) {
        var posMap = positionMap(genPositions);
        var keys = {};
        (supplies || []).forEach(function(s) {
            if (!cut || !s || String(s.cutId) !== String(cut.id)) return;
            var p = s.positionId != null ? posMap[String(s.positionId)] : null;
            var w = p ? stripNum(p.width) : 0;
            if (!(w > 0) && s.positionWidth != null) w = stripNum(s.positionWidth);
            if (w > 0) keys[stripWidthKey(w)] = true;
        });
        return keys;
    }

    // #4161: сколько заданий ПРОСРОЧЕНО в окне [scopeFromKey; scopeToKey] — плановый день задания
    // (planDateDayKey) позже самого раннего «Срока изготовления» обеспечиваемых позиций. Правило
    // просрочки — dueColorClass → 'is-overdue' (то же, что красит строку карточки #3769/#4051).
    // Окно — тот же предикат, что storedSetupTotals «всего заданий» (dk >= lo && dk <= hi), чтобы
    // «просрочено» не превышало показанное число заданий. includeSupplyFallback=true — срок и из
    // cut_planning для позиций вне активного positions_list (#4051). Чистая — покрыта тестом. → N.
    function countOverdueCuts(cuts, supplies, genPositions, opts) {
        var o = opts || {};
        var lo = o.scopeFromKey != null ? Number(o.scopeFromKey) : -Infinity;
        var hi = o.scopeToKey != null ? Number(o.scopeToKey) : Infinity;
        var n = 0;
        (cuts || []).forEach(function(c) {
            var dk = planDateDayKey(c && c.planDate);
            if (!(dk >= lo && dk <= hi)) return;
            var dueKeys = cutDueKeys(c, supplies, genPositions, true);
            if (dueKeys.length && dueColorClass(dueKeys[0], dk, o.forecastDays) === 'is-overdue') n++;
        });
        return n;
    }

    // #4346: «Дата план» / «Закончено» (unix-штамп в секундах или мс, либо дата-строка) → unix-штамп
    // в СЕКУНДАХ — единицах главного значения резки (planStart, оно же cut_plan_date). Не распознали
    // (пусто, «ДД.ММ.ГГГГ» без времени и т.п.) → null. Чистая — покрыта тестом.
    function planTsSeconds(value) {
        var s = String(value == null ? '' : value).trim();
        if (s === '') return null;
        if (/^\d{9,13}$/.test(s)) {
            var num = Number(s);
            if (!isFinite(num)) return null;
            return Math.floor(num >= 1e12 ? num / 1000 : num);
        }
        var t = Date.parse(s);
        return isNaN(t) ? null : Math.floor(t / 1000);
    }

    // #4381: задание НАЧАТО — заполнено «Начато» (реквизит 1161, колонка cut_start_date отчёта
    // cut_planning; ставит его пульт слиттера). Начатые НЕПРИКОСНОВЕННЫ, даже если не
    // зафиксированы (🔒): их нельзя перетаскивать, двигать по очереди ↑↓, фиксировать, переносить
    // на другой день и удалять; пересборка очереди тоже держит их на своём дне. Чистая — покрыта тестом.
    function cutIsStarted(cut) {
        return planTsSeconds(cut && cut.startDate) != null;
    }

    // #4346: отклонения ФАКТА от плана — вход кнопки «Отклонения N/M». Две группы (ТЗ issue #4346):
    //   overdue («просрочено», N)          — плановый день РАНЬШЕ текущего, а «Закончено» пусто;
    //   early («выполнено досрочно», M)    — плановый день СЕГОДНЯ или позже, а «Закончено» РАНЬШЕ текущего дня.
    // Дни сравниваем календарными ключами YYYYMMDD (planDateDayKey — он одинаково берёт и unix-штамп,
    // и «ГГГГ-ММ-ДД»), поэтому час старта/завершения на попадание в группу не влияет. Задание без
    // «Даты план» (ещё не запланировано, ключ Infinity) не отклонение — пропускаем; выполненное в свой
    // день — тоже (обе группы требуют расхождения). Внутри групп — по плановому времени по возрастанию,
    // чтобы порядок заданий («Порядок заданий остается прежним») и список в форме были детерминированы.
    // Чистая (DOM не трогает) — покрыта тестом. → { overdue: [cut], early: [cut] }.
    function deviationGroups(cuts, todayKey) {
        var today = Number(todayKey);
        var res = { overdue: [], early: [] };
        if (!isFinite(today)) return res;
        (cuts || []).forEach(function(c) {
            var pk = planDateDayKey(c && c.planDate);
            if (!isFinite(pk)) return;
            var ek = planDateDayKey(c && c.endDate);
            if (!isFinite(ek)) {          // не выполнено
                if (pk < today) res.overdue.push(c);
                return;
            }
            if (pk >= today && ek < today) res.early.push(c);
        });
        function byPlan(a, b) {
            var av = planTsSeconds(a && a.planDate), bv = planTsSeconds(b && b.planDate);
            return (av == null ? Infinity : av) - (bv == null ? Infinity : bv);
        }
        res.overdue.sort(byPlan);
        res.early.sort(byPlan);
        return res;
    }

    // #4346: id станка задания как ключ группировки («» — задание без станка).
    function cutSlitterKey(cut) {
        return String(cut && cut.slitter && cut.slitter.id != null ? cut.slitter.id : '');
    }

    // #4346: «Урегулировать» — что записать в «Дату план» каждому отклонившемуся заданию. Правила ТЗ:
    //   • выполненные ДОСРОЧНО — в день фактического выполнения: пишем сам момент «Закончено», он же
    //     ставит задание на правильное место внутри того дня;
    //   • ПРОСРОЧЕННЫЕ — перед СЛЕДУЮЩИМ заданием своего станка («вместо него»), в какой бы день оно
    //     ни стояло; взаимный порядок просроченных сохраняется. «Следующее» = самое раннее
    //     НЕвыполненное задание этого станка, не из группы просроченных (такое всегда стоит сегодня
    //     или позже: незавершённое задание прошлого дня по определению само просрочено);
    //   • следующего задания у станка НЕТ → ближайший рабочий незамороженный день (freeDayMsFor).
    // Пишем ПЛЕЙСХОЛДЕР: важны не сами значения, а ПОРЯДОК — сдвиг всех последующих делает пересборка
    // очереди (autoSequenceQueue preserveOrder, «общие правила»), как и на пути ручного переноса.
    // Шаг плейсхолдера — минута назад от «следующего» (смена начинается в 08:00, так что запаса
    // до полуночи хватает на любое реальное число просроченных заданий станка).
    // Чистая (DOM/сеть не трогает; календарь приходит колбэком freeDayMsFor) — покрыта тестом.
    // → [{ id, planStart (unix-секунды), reason: 'early' | 'before-next' | 'free-day' }]
    function deviationSettlePlan(cuts, groups, opts) {
        var o = opts || {};
        var today = Number(o.todayKey);
        var shiftStartMin = Number(o.shiftStartMin) || 0;
        var g = groups || {};
        var plan = [];
        (g.early || []).forEach(function(c) {
            var ts = planTsSeconds(c && c.endDate);
            if (ts == null || !c || c.id == null) return;
            plan.push({ id: String(c.id), planStart: ts, reason: 'early' });
        });
        var overdueSet = {};
        (g.overdue || []).forEach(function(c) { if (c && c.id != null) overdueSet[String(c.id)] = true; });
        var bySlitter = {}, sids = [];
        (g.overdue || []).forEach(function(c) {
            if (!c || c.id == null) return;
            // #4381: НАЧАТОЕ задание неприкосновенно — «Урегулировать» его не двигает. В группе
            // «просрочено» «Закончено» пусто по построению, поэтому здесь cutIsStarted = «в работе
            // прямо сейчас». В списке формы оно остаётся (диспетчер должен его видеть), но переноса
            // не получает. Досрочных это НЕ касается: они завершены, и перенос в день фактического
            // выполнения — как раз фиксация факта (#4346), а не вмешательство в работу.
            if (cutIsStarted(c)) return;
            var sid = cutSlitterKey(c);
            if (!bySlitter[sid]) { bySlitter[sid] = []; sids.push(sid); }
            bySlitter[sid].push(c);
        });
        sids.forEach(function(sid) {
            var queue = bySlitter[sid];
            var anchorTs = null;
            (cuts || []).forEach(function(c) {
                if (!c || c.id == null || overdueSet[String(c.id)]) return;
                if (cutSlitterKey(c) !== sid) return;
                if (planTsSeconds(c.endDate) != null) return;   // уже выполненное «следующим» не считаем
                if (cutIsStarted(c)) return;   // #4381: перед начатым не встаём — это сдвинуло бы его
                var pk = planDateDayKey(c.planDate);
                if (!isFinite(pk) || !isFinite(today) || pk < today) return;
                var ts = planTsSeconds(c.planDate);
                if (ts == null) return;
                if (anchorTs == null || ts < anchorTs) anchorTs = ts;
            });
            if (anchorTs != null) {
                queue.forEach(function(c, i) {
                    plan.push({ id: String(c.id), planStart: anchorTs - (queue.length - i) * 60, reason: 'before-next' });
                });
                return;
            }
            var dayMs = typeof o.freeDayMsFor === 'function' ? o.freeDayMsFor(sid) : null;
            if (dayMs == null || !isFinite(Number(dayMs))) return;
            var base = Math.floor(Number(dayMs) / 1000) + shiftStartMin * 60;
            queue.forEach(function(c, i) {
                plan.push({ id: String(c.id), planStart: base + i * 60, reason: 'free-day' });
            });
        });
        return plan;
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

