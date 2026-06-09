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
// `GET /{db}/report/positions_list?JSON_KV` (`rowsToPositions`): Позиция заказа —
// подчинённая таблица, прямое `object/`-чтение её не отдаёт. Партии сырья для
// формы создания резки берутся отчётом `report/material_batches?JSON_KV`
// (`rowsToBatches`). Справочник станков читается по имени из метаданных
// (`object/{table}?JSON_OBJ`, записей мало).
//
// Запись идёт прямыми командами `_m_*` (#2903): создание резки —
// `_m_new/{Производственная резка}` с главным значением `t{tableId}` (#3225).
// Резка снова является самостоятельной таблицей (#3185), а «Обеспечение»
// ссылается на неё реквизитом «Производственная резка».
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
        cut: 'Производственная резка',
        supply: 'Обеспечение',
        slitter: 'Слиттер',
        materialBatch: 'Партия сырья',
        strip: 'Полоса',
        finishedBatch: 'Партия ГП',
        sleeveTask: 'Задание на втулки',
        settings: 'Настройка'
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
        winding: 'Тип намотки'
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
        winding: CUT_REQ.winding
    };
    // Реквизиты «Обеспечения» (up = позиция заказа).
    var SUPPLY_REQ = {
        footage: 'Метраж, м',
        cut: 'Производственная резка',
        finishedBatch: 'Партия ГП',
        rolls: 'Кол-во рулонов',
        active: 'В работе',   // #3242: «Активно» переименовано в «В работе»
        status: 'Статус'
    };
    // Реквизиты «Партии ГП» (#3242: состав резки, up = резка). Резолв по имени.
    var FINISHED_BATCH_REQ = {
        width: 'Ширина, мм',
        rolls: 'Кол-во рулонов',
        footage: 'Метраж, м',
        active: 'В работе'
    };
    // #3242: «Кол-во план» переименовано в «Кол-во резок план» (fallback на старое имя).
    var CUT_PLANNED_RUNS_NAMES = ['Кол-во резок план', 'Кол-во план'];
    var SLEEVE_TASK_REQ = {
        diameter: 'Диаметр, мм',
        actualQty: 'Кол-во факт',
        cutter: 'Втулкорез',
        status: 'Статус'
    };
    // Статусы — свободный текст (тип 3); фиксируем разумные наборы по дизайн-спеке.
    var CUT_STATUSES = ['Запланирована', 'В очереди', 'В работе', 'Готова', 'Отменена'];
    var SUPPLY_STATUSES = ['Зарезервировано', 'Выполнено', 'Отменено'];
    var SLEEVE_TASK_STATUS = 'Ожидает';
    // Параметры раскладки cut-layout при генерации резок.
    var WINDOW_DAYS = 3;      // окно по сроку изготовления — позиции группируются в кластеры
    var DEFAULT_TOLERANCE_MM = 20; // допуск остатка джамбо по умолчанию (мм), если у «Вида сырья» «Допуск, мм» не задан

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
        var req = reqByName(supplyMeta, SUPPLY_REQ.cut);
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

    // #3242: поля записи «Партия ГП» (состав резки): Ширина, Кол-во рулонов, Метраж, «В работе».
    function buildFinishedBatchFields(finishedBatchMeta, values) {
        var reqIds = {
            width: reqIdByName(finishedBatchMeta, FINISHED_BATCH_REQ.width),
            rolls: reqIdByName(finishedBatchMeta, FINISHED_BATCH_REQ.rolls),
            footage: reqIdByName(finishedBatchMeta, FINISHED_BATCH_REQ.footage),
            active: activeReqId(finishedBatchMeta)
        };
        return buildFields(reqIds, {
            width: values && values.width,
            rolls: values && values.rolls,
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
        return [list];
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

    function isCutVisible(cut, selectedDate) {
        if (!cut) return false;
        if (String(cut.status || '').trim() === 'Завершён') return false;
        var pd = String(cut.planDate || '').trim();
        if (pd === '') return true;
        var sd = String(selectedDate == null ? '' : selectedDate).trim();
        if (sd === '') return true;
        // #3249: сравниваем по календарному дню (planDate — unix-штамп DATETIME,
        // selectedDate — «ГГГГ-ММ-ДД»); раньше batchDateKey давал несравнимые шкалы.
        return planDateDayKey(pd) === planDateDayKey(sd);
    }

    // Текущая дата как «ГГГГ-ММ-ДД» для <input type=date> (только браузер).
    function todayISO() {
        var d = new Date();
        var m = String(d.getMonth() + 1); if (m.length < 2) m = '0' + m;
        var day = String(d.getDate()); if (day.length < 2) day = '0' + day;
        return d.getFullYear() + '-' + m + '-' + day;
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
                    isFoil: /фольг/i.test(str(row.cut_material)),
                    orderId: str(row.order_id),
                    orderApprovalDate: str(row.order_approval_date || row.item_approval_date)
                };
                order.push(cutId);
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
            var head = orderNo !== '' ? orderNo + '/' + no : '№' + no;
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

    function sleeveDiameterFromRow(row) {
        var raw = row && row.position_sleeve != null ? row.position_sleeve : '';
        var ref = parseRef(raw);
        var label = ref.label || raw;
        var n = stripNum(label);
        return n > 0 ? n : 0;
    }

    // Строки отчёта positions_list (JSON_KV) → [{ id, materialId, width, qty, length, sleeveDiameter, dueKey }]
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
                sleeveDiameter: sleeveDiameterFromRow(row),
                dueKey: batchDateKey(row.position_due_date),
                approved: orderApproved || itemApproved
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

    function groupPositionsByPlanningProfile(positions) {
        var groups = {};
        var order = [];
        (positions || []).forEach(function(p) {
            var key = preferredWidthsKey(p && p.materialId, p && p.windDir, p && p.windLength);
            if (!groups[key]) {
                groups[key] = {
                    key: key,
                    materialId: p && p.materialId != null ? String(p.materialId) : '',
                    windDir: normWinding(p && p.windDir),
                    windLength: windLengthValue(p && p.windLength),
                    positions: []
                };
                order.push(key);
            }
            groups[key].positions.push(p);
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
                    message: 'Не рассчитано поле «' + CUT_REQ.plannedRuns + '» для резки ' + layoutNo
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
                    message: 'Не рассчитано поле «' + CUT_REQ.length + '» для резки ' + layoutNo +
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
                    message: 'Не рассчитано поле «' + CUT_REQ.duration + '» для резки ' + layoutNo +
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
    //   KNIFE — смена ножей / сужение ролика; BETWEEN_CUTS — лидер между резками (база);
    //   CLEANUP_SHIFT — уборка в конце рабочего дня (#3155, ставится после последней резки дня).
    // Так нож (30) дороже смены сырья (15) — приоритет «беречь ножи» (ideav/crm#3130).
    var DEFAULT_OP_TIMES = { MATERIAL_WINDING: 15, KNIFE: 30, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
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

    // Неудобный остаток джамбо: 0 < m < REMAINDER_OK_M (не дорезан до ≈0 и не оставлен крупным).
    function awkwardRemainder(m){ var x = Number(m); return !isNaN(x) && x > 1e-6 && x < REMAINDER_OK_M; }

    // Компоненты переналадки prev→next (МИНУТЫ, БЕЗ лидера BETWEEN_CUTS) — те операции,
    // что реально применились, для расшифровки тайминга (#3240):
    //   смена сырья ИЛИ намотки ИЛИ партии → MATERIAL_WINDING (одна операция «смена
    //   сырья/намотки»; неудобный остаток — её же частный случай, отдельно не считаем);
    //   смена набора ножей ИЛИ сужение ролика → KNIFE. Бинарно (изменилось/нет), без
    //   нормировок. prev/next отсутствует → [] (первой резке переналадка не нужна).
    //   → [{ code, label, minutes }] (только применившиеся, с minutes > 0).
    function changeoverParts(prev, next, times){
        var t = times || DEFAULT_OP_TIMES;
        var matWind = Number(t.MATERIAL_WINDING != null ? t.MATERIAL_WINDING : DEFAULT_OP_TIMES.MATERIAL_WINDING) || 0;
        var knife = Number(t.KNIFE != null ? t.KNIFE : DEFAULT_OP_TIMES.KNIFE) || 0;
        var parts = [];
        if (!prev || !next) return parts;
        var matWindChange = String(prev.materialId) !== String(next.materialId)
            || normWinding(prev.winding) !== normWinding(next.winding)
            || String(prev.batchId) !== String(next.batchId);
        if (matWindChange && matWind > 0) parts.push({ code: 'MATERIAL_WINDING', label: 'смена сырья / намотки / партии', minutes: round3(matWind) });
        var knifeChange = (Number(prev.knifeCount) || 0) !== (Number(next.knifeCount) || 0)
            || widthSetDistance(prev.knifeWidths, next.knifeWidths) > 0
            || (Number(prev.rollerWidth) || 0) > (Number(next.rollerWidth) || 0);   // сужение ролика
        if (knifeChange && knife > 0) parts.push({ code: 'KNIFE', label: 'смена ножей / сужение ролика', minutes: round3(knife) });
        return parts;
    }

    // Стоимость перехода prev→next в МИНУТАХ переналадки (Σ компонентов changeoverParts;
    // две операции — обе вычитают время смены).
    function changeoverCost(prev, next, times){
        return round3(changeoverParts(prev, next, times).reduce(function(sum, p){ return sum + (Number(p.minutes) || 0); }, 0));
    }

    // Полный setup перед резкой (#3240): лидер между резками (BETWEEN_CUTS, база) +
    // переналадка с предыдущей (changeoverParts). prev=null (первая резка очереди/дня) →
    // только лидер. Σ minutes == setupMin расписания buildSchedule. → [{ code, label, minutes }].
    function setupBreakdown(prev, next, times){
        var t = times || DEFAULT_OP_TIMES;
        var leader = Number(t.BETWEEN_CUTS != null ? t.BETWEEN_CUTS : DEFAULT_OP_TIMES.BETWEEN_CUTS) || 0;
        var parts = [];
        if (leader > 0) parts.push({ code: 'BETWEEN_CUTS', label: 'лидер между резками', minutes: round3(leader) });
        Array.prototype.push.apply(parts, changeoverParts(prev, next, times));
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
    // cut_id — abn «Производственной резки»; strip_width — Полоса «Ширина, мм»;
    // strip_qty — Полоса «Количество». Группировка по cut_id:
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

    function nonStockStripQtyForWidth(layout, width) {
        var key = stripWidthKey(width);
        return (layout && layout.strips || []).reduce(function(sum, s) {
            if (isStockStrip(s)) return sum;
            return stripWidthKey(s.width) === key ? sum + (Number(s.qty) || 0) : sum;
        }, 0);
    }

    function plannedRunsForLayout(layout, positions) {
        var direct = Number(layout && (layout.plannedRuns || layout.runCount || layout.runs));
        if (isFinite(direct) && direct > 0) return Math.ceil(direct);
        var byId = positionMap(positions);
        var demandByWidth = {};
        (layout && layout.positionsCovered || []).forEach(function(pid) {
            var p = byId[String(pid)];
            if (!p) return;
            var w = Number(p.width) || 0;
            var qty = Number(p.qty) || 0;
            if (w <= 0 || qty <= 0) return;
            var key = stripWidthKey(w);
            demandByWidth[key] = (demandByWidth[key] || 0) + qty;
        });
        var runs = 1;
        Object.keys(demandByWidth).forEach(function(key) {
            var out = nonStockStripQtyForWidth(layout, key);
            if (out > 0) runs = Math.max(runs, Math.ceil(demandByWidth[key] / out));
        });
        return runs;
    }

    function supplyRollsForPosition(layout, position, plannedRuns) {
        if (!position) return 0;
        var runs = Number(plannedRuns) || 0;
        if (runs <= 0) runs = plannedRunsForLayout(layout, [position]);
        var strips = nonStockStripQtyForWidth(layout, position.width);
        return round3(runs * strips);
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

    function positionSleeveTasksForLayout(layout, positions, plannedRuns) {
        var byId = positionMap(positions);
        var out = [];
        (layout && layout.positionsCovered || []).forEach(function(pid) {
            var positionId = String(pid);
            var p = byId[positionId];
            if (!p) return;
            var dia = Number(p.sleeveDiameter) || 0;
            if (dia <= 0) return;
            var qty = supplyRollsForPosition(layout, p, plannedRuns);
            if (qty <= 0) return;
            out.push({ positionId: positionId, diameter: dia, qty: qty });
        });
        return out;
    }

    function sleeveTasksForLayout(layout, positions, plannedRuns) {
        var out = [];
        var byDia = {};
        positionSleeveTasksForLayout(layout, positions, plannedRuns).forEach(function(task) {
            var dia = task.diameter;
            var key = String(dia);
            if (byDia[key] == null) {
                byDia[key] = out.length;
                out.push({ diameter: dia, qty: 0 });
            }
            out[byDia[key]].qty = round3(out[byDia[key]].qty + task.qty);
        });
        return out;
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
        return pts;
    }

    // Время намотки runMeters (мин) по точкам — кусочно-линейно: ниже первой точки —
    // пропорционально от 0; между точками — линейно; выше последней — экстраполяция по
    // последнему отрезку (при одной точке — клампим). Нет точек / runMeters≤0 → 0.
    function windingMinutes(runMeters, points){
        var x = Number(runMeters) || 0;
        var p = (points || []).slice().sort(function(a, b){ return a.m - b.m; });
        if (!p.length || x <= 0) return 0;
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

    function plannedCutDurationMinutes(runMeters, plannedRuns, opTimes) {
        var runs = Number(plannedRuns) || 0;
        if (runs <= 0) return 0;
        return round3(windingMinutes(runMeters, windingPointsFromTimes(opTimes || {})) * runs);
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
        var items = (norms || []).map(function(n){ return 'WIND_' + formatTimingNumber(n.m) + '=' + formatTimingNumber(n.min) + ' мин'; });
        if (!items.length) return '';
        if (items.length === 1) return 'Норма намотки: ' + items[0];
        return 'Нормы намотки: ' + items.join('; ') + ' (интерполяция)';
    }

    function formatTimingNumber(value) {
        return String(round3(Number(value) || 0));
    }

    function cutTimingDetails(runMeters, plannedRuns, opTimes) {
        var length = stripNum(runMeters);
        var runs = stripNum(plannedRuns);
        if (!(length > 0) || !(runs > 0)) return '';
        var points = windingPointsFromTimes(opTimes || {});
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
        var lines = [];
        lines.push({ text: 'Метраж прохода: ' + formatTimingNumber(length) + ' м' });
        lines.push({ text: 'Плановых проходов: ' + formatTimingNumber(runs) });
        lines.push({ text: 'Намотка 1 прохода: ' + formatTimingNumber(oneRun) + ' мин' });
        var normLine = formatWindingNorms(ctx.norms);
        if (normLine) lines.push({ text: normLine });
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
        lines.push({
            text: cutPrefix + 'Итого резка: ' + formatTimingNumber(oneRun) + ' * ' + formatTimingNumber(runs) + ' = ' + formatTimingNumber(total) + ' мин',
            bold: true
        });
        if (ctx.finishMin != null && isFinite(Number(ctx.finishMin))) {
            lines.push({ text: formatClock(ctx.finishMin) + ' · готово' });
        }
        return lines;
    }

    // Контекст тайминга одной резки для модалки (#3240): метраж/проходы/намотка, разбивка
    // setup (prevCut — предыдущая резка очереди или null для первой), релевантные нормы и
    // старт/финиш из расписания sc. → объект для cutTimingTimelineLines.
    function buildCutTimingCtx(cut, prevCut, sc, runMeters, windPoints, times) {
        var length = stripNum(runMeters);
        var runs = stripNum(cut && cut.plannedRuns);
        var oneRun = windingMinutes(length, windPoints || []);
        var total = runs > 0 ? round3(oneRun * runs) : oneRun;
        return {
            length: length,
            runs: runs,
            oneRun: round3(oneRun),
            total: round3(total),
            setupParts: setupBreakdown(prevCut, cut, times),
            norms: relevantWindingNorms(length, windPoints || []),
            startMin: sc ? sc.startMin : null,
            finishMin: sc ? sc.finishMin : null
        };
    }

    function scheduleDurationMinutes(cut, runMeters, windPoints) {
        var oneRun = windingMinutes(runMeters, windPoints || []);
        var runs = stripNum(cut && cut.plannedRuns);
        var computed = runs > 0 ? round3(oneRun * runs) : oneRun;
        if (computed > 0) return computed;
        var stored = stripNum(cut && cut.duration);
        return stored > 0 ? round3(stored) : 0;
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

    function resolveWorkingWindow(settings, cleanupMin) {
        var cfg = settings || {};
        var start = parseClockMinutes(cfg.DAY_START_HOUR, DAY_START_MIN);
        var end = parseClockMinutes(cfg.DAY_END_HOUR, DAY_END_MIN);
        if (end <= start) end = DAY_END_MIN > start ? DAY_END_MIN : start + 1;
        var cleanup = Number(cleanupMin != null ? cleanupMin : DEFAULT_OP_TIMES.CLEANUP_SHIFT);
        if (!isFinite(cleanup) || cleanup < 0) cleanup = DEFAULT_OP_TIMES.CLEANUP_SHIFT;
        var cutEnd = end - cleanup;
        if (cutEnd < start) cutEnd = start;
        return {
            startMin: round3(start),
            endMin: round3(end),
            cutEndMin: round3(cutEnd),
            cleanupMin: round3(cleanup)
        };
    }

    // Расписание очереди (по порядку): для каждой резки — старт/финиш в минутах от
    // полуночи дня 0 (через сутки — следующий рабочий день). setup перед резкой = лидер
    // (BETWEEN_CUTS) + переналадка с предыдущей (changeoverCost, мин); длительность =
    // намотка прогона × «Кол-во план» либо сохранённая «Длительность, минут» как
    // fallback. Рабочее окно дня — [shiftStartMin, shiftEndMin] (08:00–16:30);
    // резка, не влезающая до конца окна, переносится на 08:00 следующего дня.
    // opts: { windPoints, times, shiftStartMin, shiftEndMin,
    // runLengthByCut:{cutId:метры} }. Вход не мутирует.
    function buildSchedule(cuts, opts){
        opts = opts || {};
        var wind = opts.windPoints || [];
        var times = opts.times || DEFAULT_OP_TIMES;
        var leader = Number(times.BETWEEN_CUTS != null ? times.BETWEEN_CUTS : DEFAULT_OP_TIMES.BETWEEN_CUTS) || 0;
        var runLen = opts.runLengthByCut || {};
        var shiftStart = Number(opts.shiftStartMin != null ? opts.shiftStartMin : SHIFT_START_MIN) || 0;
        var shiftEnd = Number(opts.shiftEndMin != null ? opts.shiftEndMin : SHIFT_END_MIN) || 0;
        var hasWindow = shiftEnd > shiftStart;
        var t = shiftStart;   // день 0, начало смены
        var out = [];
        (cuts || []).forEach(function(c, i){
            var setup = leader + (i > 0 ? changeoverCost(cuts[i-1], c, times) : 0);
            var dur = scheduleDurationMinutes(c, Number(runLen[String(c.id)]) || 0, wind);
            var start = t + setup;
            var day = Math.floor(start / 1440);
            if (start < day * 1440 + shiftStart) start = day * 1440 + shiftStart;   // до 08:00 → ждём открытия
            // не влезает до конца рабочего окна (16:30) → переносим на 08:00 след. дня
            if (hasWindow && start + dur > day * 1440 + shiftEnd) {
                day += 1;
                start = day * 1440 + shiftStart + setup;
            }
            var finish = start + dur;
            out.push({ cutId: String(c.id), startMin: round3(start), finishMin: round3(finish), setupMin: round3(setup), durationMin: dur });
            t = finish;
        });
        return out;
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
        var segments = [];
        var day = 0, clock = 0;                      // clock — минут занято в текущем дне (от dayStart)
        var prevPhysical = null;                     // предыдущая ФИЗИЧЕСКАЯ резка (для переналадки)
        (orderedCuts || []).forEach(function(c){
            var cid = c && c.id;
            var runs = Math.round(Number(runsByCut[String(cid)] != null ? runsByCut[String(cid)] : c && c.plannedRuns) || 0);
            var perPass = Number(perPassByCut[String(cid)] != null ? perPassByCut[String(cid)] : 0) || 0;
            var remaining = runs;
            var isCont = false;
            // Резка без проходов/длительности — один сегментик без раскладки по проходам.
            if (!(runs > 0) || !(perPass > 0) || !hasWindow) {
                var setup0 = leader + (prevPhysical ? changeoverCost(prevPhysical, c, times) : 0);
                var ws0 = day * 1440 + dayStart + clock;
                segments.push({ cutId: String(cid), dayOffset: day, runs: runs, windowStartMin: round3(ws0),
                    startMin: round3(ws0 + setup0), setupMin: round3(setup0),
                    durationMin: round3((runs > 0 && perPass > 0) ? runs * perPass : 0),
                    isContinuation: false, parentCutId: null });
                clock += setup0 + ((runs > 0 && perPass > 0) ? runs * perPass : 0);
                prevPhysical = c;
                return;
            }
            while (remaining > 0) {
                var setup = isCont ? 0 : (leader + (prevPhysical ? changeoverCost(prevPhysical, c, times) : 0));
                var avail = capacity - clock;
                var maxPasses = Math.floor((avail - setup) / perPass);
                if (maxPasses < 1) {
                    if (clock > 0) { day += 1; clock = 0; continue; }   // переносим на чистый след. день
                    maxPasses = 1;   // целый день не вмещает даже setup+1 проход — кладём 1 (переполнение)
                }
                var passesNow = Math.min(remaining, maxPasses);
                var windowStart = day * 1440 + dayStart + clock;
                var segDur = passesNow * perPass;
                segments.push({ cutId: String(cid), dayOffset: day, runs: passesNow,
                    windowStartMin: round3(windowStart), startMin: round3(windowStart + setup),
                    setupMin: round3(setup), durationMin: round3(segDur),
                    isContinuation: isCont, parentCutId: isCont ? String(cid) : null });
                clock += setup + segDur;
                remaining -= passesNow;
                prevPhysical = c;
                isCont = true;   // дальнейшие сегменты этой резки — продолжения (ножи остаются)
            }
        });
        return segments;
    }

    // #3280: минуты расписания (от полуночи дня планирования) → Unix-штамп (секунды).
    // dayMidnightMs — полночь дня планирования (мс); windowStartMin — минуты окна резки.
    function scheduleStartTimestamp(dayMidnightMs, windowStartMin){
        var base = Number(dayMidnightMs);
        var min = Number(windowStartMin);
        if (!isFinite(base) || !isFinite(min)) return 0;
        return Math.floor((base + min * 60000) / 1000);
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
                shiftEndMin: opts.dayEndMin
            });
            sched.forEach(function(sc){
                var windowStart = stripNum(sc.startMin) - stripNum(sc.setupMin);
                out[String(sc.cutId)] = scheduleStartTimestamp(base, windowStart);
            });
        });
        return out;
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

    // #3280: слить записи-продолжения обратно в логические резки перед пере-разбиением.
    // Эвристика (без маркера): одинаковая сигнатура continuationSignature + смежные
    // календарные дни (разница 1) → одна цепочка; выживает самая ранняя запись (её id),
    // её «Кол-во план» = сумма проходов цепочки; остальные записи — в deletes.
    // → { cuts:[логические резки], deletes:[id записей-продолжений], chainByLogical:{logicalId:[id…]} }.
    // Вход не мутирует.
    function mergeContinuationChains(cuts){
        var groups = {}, order = [];
        (cuts || []).forEach(function(c){
            var s = continuationSignature(c);
            if (!groups[s]) { groups[s] = []; order.push(s); }
            groups[s].push(c);
        });
        var logical = [], deletes = [], chainByLogical = {};
        order.forEach(function(s){
            var arr = groups[s].slice().sort(function(a, b){
                var da = planDayNumber(a), db = planDayNumber(b);
                if (da == null && db == null) return 0;
                if (da == null) return 1;
                if (db == null) return -1;
                return da - db;
            });
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
                var head = chain[0];
                var lg = {};
                for (var k in head) { if (Object.prototype.hasOwnProperty.call(head, k)) lg[k] = head[k]; }
                lg.plannedRuns = chain.reduce(function(sum, c){ return sum + (Number(c.plannedRuns) || 0); }, 0);
                logical.push(lg);
                chainByLogical[String(head.id)] = chain.map(function(c){ return String(c.id); });
                for (var m = 1; m < chain.length; m++) deletes.push(String(chain[m].id));
                i = j;
            }
        });
        return { cuts: logical, deletes: deletes, chainByLogical: chainByLogical };
    }

    // #3280: план операций физического разбиения резок по дням. Сливает цепочки-продолжения
    // (mergeContinuationChains), упорядочивает очередь каждого станка (orderCuts) и
    // раскладывает по дням на уровне проходов (splitMachineQueue). →
    //   { updates:[{cutId, sequence, planStartTs, plannedRuns}],            // первый сегмент → существующая запись
    //     creates:[{parentCutId, sequence, planStartTs, plannedRuns}],       // продолжения → новые записи
    //     deletes:[cutId…] }                                                 // записи-продолжения прежних цепочек
    // Деление Обеспечения и копию Полос на продолжения выполняет аппликатор (нужны id новых
    // записей и метаданные ссылок) — здесь только очередь/время/проходы. Вход не мутирует.
    function planCutOperations(cuts, opts){
        opts = opts || {};
        var base = Number(opts.planBaseMidnightMs);
        var merged = mergeContinuationChains(cuts);
        var perPass = opts.perPassByCut || {};
        var byMachine = {}, mOrder = [];
        merged.cuts.forEach(function(c){
            var sid = c && c.slitter && c.slitter.id;
            if (sid == null) return;
            var key = String(sid);
            if (!byMachine[key]) { byMachine[key] = []; mOrder.push(key); }
            byMachine[key].push(c);
        });
        var updates = [], creates = [];
        mOrder.forEach(function(key){
            var ordered = orderCuts(byMachine[key], opts.weights);
            var runsByCut = {};
            ordered.forEach(function(c){ runsByCut[String(c.id)] = Number(c.plannedRuns) || 0; });
            var segs = splitMachineQueue(ordered, {
                dayStartMin: opts.dayStartMin, dayEndMin: opts.dayEndMin,
                leader: opts.leader, times: opts.times,
                perPassByCut: perPass, runsByCut: runsByCut
            });
            segs.forEach(function(seg, idx){
                var ts = scheduleStartTimestamp(base, seg.windowStartMin);
                if (!seg.isContinuation) {
                    updates.push({ cutId: String(seg.cutId), sequence: idx + 1, planStartTs: ts, plannedRuns: seg.runs });
                } else {
                    creates.push({ parentCutId: String(seg.parentCutId), sequence: idx + 1, planStartTs: ts, plannedRuns: seg.runs });
                }
            });
        });
        return { updates: updates, creates: creates, deletes: merged.deletes };
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
        // #3262: показываем всё ОКНО (setup + резка), как «Тайминг окна» в модалке —
        // старт = начало setup (startMin − setupMin), длительность = setup + резка
        // (диапазон совпадает с числом минут, как у блока уборки). Так начало в карточке
        // равно первому шагу тайминга окна, а не старту самой резки.
        var setup = stripNum(sc.setupMin);
        var windowStart = stripNum(sc.startMin) - setup;
        return '⏱ ' + formatClock(windowStart) + ' – ' + formatClock(sc.finishMin) + ' · ' + round3(setup + dur) + ' мин';
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

    function startKey(c){ return [Number(c.rollerWidth) || 0, -(Number(c.knifeCount) || 0), String(c.id)]; }
    function cmpKey(a, b){ for (var i = 0; i < a.length; i++){ if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; }

    function fatigueComplexityKey(c, machineWidth){
        var width = fatigueJobWidth(c);
        return [
            -estimatedKnifeCount(c, machineWidth),
            width > 0 ? width : Number.MAX_VALUE
        ];
    }

    // Жадная последовательность: старт — argmin startKey (узкая/много-ножевая); далее argmin changeoverCost, tie-break startKey.
    function greedySequence(cuts, weights){
        var pool = (cuts || []).slice();
        if (!pool.length) return [];
        pool.sort(function(a, b){ return cmpKey(startKey(a), startKey(b)); });
        var result = [pool.shift()];
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
        return greedySequence(cuts, planningChangeTimes(opts));
    }

    // Упорядочить резки станка: не-Фольга, затем Фольга; внутри каждой группы —
    // выбранный оператором вариант (#3272). По умолчанию — реальные минуты
    // переналадки (#3268); fatigue-вариант ставит сложные резки раньше.
    // Проставить sequence; вход не мутировать.
    function orderCuts(cuts, weights){
        var rest = [], foil = [];
        (cuts || []).forEach(function(c){ (c && c.isFoil ? foil : rest).push(c); });
        var opts = makePlanningOptions(weights);
        var seq = sequenceForStrategy(rest, opts).concat(sequenceForStrategy(foil, opts));
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
    // Пустой станок выигрывает у несовместимого занятого (delta меньше), но при
    // равном delta предпочитаем уже занятый setup-совместимый станок, а не
    // разбрасываем одинаковые профили только ради баланса.
    function chooseSlitterBySetup(cut, slitters, groupsBySlitterId, loadBySlitterId, weights) {
        var groups = groupsBySlitterId || {};
        var load = loadBySlitterId || {};
        var allowed = (slitters || []).filter(function(s){ return !isMaterialBlocked(s.stopMaterialIds, cut && cut.materialId); });
        if (!allowed.length) return null;
        function cmpNumber(a, b) {
            if (a === b) return 0;
            if (a === Infinity) return 1;
            if (b === Infinity) return -1;
            return a - b;
        }
        var candidates = allowed.map(function(s) {
            var id = String(s.id);
            var group = groups[id] || [];
            var before = orderedChangeoverCost(group, weights);
            var after = orderedChangeoverCost(group.concat([cut]), weights);
            return {
                id: id,
                delta: round3(after - before),
                affinity: bestExistingTransitionCost(group, cut, weights),
                load: Number(load[id]) || 0
            };
        });
        candidates.sort(function(a, b) {
            return cmpNumber(a.delta, b.delta)
                || cmpNumber(a.affinity, b.affinity)
                || cmpNumber(a.load, b.load)
                || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        });
        return candidates[0].id;
    }

    // Переставить резку в очереди станка: swap с соседом (dir -1 вверх / +1 вниз) +
    // нормализация «Очередности» 1..N по новому порядку. → изменённые [{cutId, sequence}].
    // На границе → []. Вход не мутирует.
    function moveInQueue(orderedCuts, index, dir){
        var arr = (orderedCuts || []).slice();
        var target = index + dir;
        if (index < 0 || index >= arr.length || target < 0 || target >= arr.length) return [];
        var tmp = arr[index]; arr[index] = arr[target]; arr[target] = tmp;
        var changed = [];
        arr.forEach(function(c, i){ var seq = i + 1; if (Number(c.sequence) !== seq) changed.push({ cutId: c.id, sequence: seq }); });
        return changed;
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

    var planning = {
        parseRef: parseRef,
        parseMultiRefIds: parseMultiRefIds,
        isMaterialBlocked: isMaterialBlocked,
        aliasOf: aliasOf,
        matchesName: matchesName,
        tableByName: tableByName,
        reqIdByName: reqIdByName,
        columnIndex: columnIndex,
        mapCutRecord: mapCutRecord,
        groupBySlitter: groupBySlitter,
        filterCuts: filterCuts,
        isCutVisible: isCutVisible,
        planDateDayKey: planDateDayKey,
        buildFields: buildFields,
        maxNumericCutNumber: maxNumericCutNumber,
        nextCutMainValue: nextCutMainValue,
        splitMachineQueue: splitMachineQueue,
        scheduleStartTimestamp: scheduleStartTimestamp,
        planStartTimestamps: planStartTimestamps,
        continuationSignature: continuationSignature,
        mergeContinuationChains: mergeContinuationChains,
        planCutOperations: planCutOperations,
        splitSupplyShares: splitSupplyShares,
        addMainValueField: addMainValueField,
        cutWriteDiagnostics: cutWriteDiagnostics,
        cutGenerationTimingDiagnostics: cutGenerationTimingDiagnostics,
        supplyCutRelation: supplyCutRelation,
        buildSupplyFieldsForCut: buildSupplyFieldsForCut,
        buildSupplyFieldsForFinishedBatch: buildSupplyFieldsForFinishedBatch,
        buildFinishedBatchFields: buildFinishedBatchFields,
        layoutPositionGroups: layoutPositionGroups,
        rowsToPlanning: rowsToPlanning,
        cutPlanningReportDiagnostics: cutPlanningReportDiagnostics,
        rowsToPositions: rowsToPositions,
        positionDimensionsLabel: positionDimensionsLabel,
        remainingRollsForPosition: remainingRollsForPosition,
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
        awkwardRemainder: awkwardRemainder,
        changeoverParts: changeoverParts,
        changeoverCost: changeoverCost,
        setupBreakdown: setupBreakdown,
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
        byKnifeCountDesc: byKnifeCountDesc,
        planQueues: planQueues,
        moveInQueue: moveInQueue,
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
        plannedRunsForLayout: plannedRunsForLayout,
        supplyRollsForPosition: supplyRollsForPosition,
        layoutRunLength: layoutRunLength,
        finishedBatchesForLayout: finishedBatchesForLayout,
        producedBatchesForLayout: producedBatchesForLayout,
        supplyPlanForLayout: supplyPlanForLayout,
        positionSleeveTasksForLayout: positionSleeveTasksForLayout,
        sleeveTasksForLayout: sleeveTasksForLayout,
        sleeveMinutes: sleeveMinutes,
        cutMissingBatch: cutMissingBatch,
        requiredRunLengthM: requiredRunLengthM,
        supplyFootage: supplyFootage,
        cutRunLength: cutRunLength,
        reserveFifo: reserveFifo,
        fifoBatchesForMaterial: fifoBatchesForMaterial,
        materialByCut: materialByCut,
        windingPointsFromTimes: windingPointsFromTimes,
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
        parseClockMinutes: parseClockMinutes,
        resolveWorkingWindow: resolveWorkingWindow,
        buildSchedule: buildSchedule,
        dayCleanups: dayCleanups,
        formatClock: formatClock,
        formatClockHHMM: formatClockHHMM,
        formatCutStartTime: formatCutStartTime,
        formatCutStartTitle: formatCutStartTitle,
        cutStartWindowMin: cutStartWindowMin,
        formatCutWindingLabel: formatCutWindingLabel,
        formatScheduleLine: formatScheduleLine,
        DAY_START_MIN: DAY_START_MIN,
        DAY_END_MIN: DAY_END_MIN,
        SHIFT_START_MIN: SHIFT_START_MIN,
        SHIFT_END_MIN: SHIFT_END_MIN,
        aggregateStrips: aggregateStrips,
        stripsUsedWidth: stripsUsedWidth,
        stripsTotalKnives: stripsTotalKnives,
        knifeWidthsForStrips: knifeWidthsForStrips,
        stripsRemainder: stripsRemainder,
        progressPercent: progressPercent,
        stripsButtonLabel: stripsButtonLabel,
        formatCutRuns: formatCutRuns,
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
            settings: null
        };
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
        this.jumboWidthByMaterial = {}; // карта materialId → ширина джамбо «Вид сырья»
        this.preferredByMaterial = {};  // кеш ходовых ширин: materialId|windDir|windLength → [{width, popularity}]
        this.draft = this.blankDraft();
        this.filter = { slitter: '', status: '', date: todayISO() };  // дата плана по умолчанию — сегодня
        this.selectedCutId = null; // выбранная резка для привязки обеспечения
        this.stripEditCutId = null; // резка с открытым инлайн-редактором полос (одна за раз)
        this.lastCutMainValue = 0;  // последний t{Производственная резка}, выданный клиентом
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
        return { positionId: '', footage: '', slitterId: '', materialBatchId: '', plannedRuns: '1', planDate: '', status: CUT_STATUSES[0], notes: '', selectedPositions: [] };
    };

    AtexProductionPlanning.prototype.url = function(path) {
        return '/' + encodeURIComponent(this.db) + '/' + path;
    };

    AtexProductionPlanning.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                try { return text ? JSON.parse(text) : null; }
                catch (e) { throw new Error('Некорректный JSON: ' + text.slice(0, 200)); }
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
                try { result = text ? JSON.parse(text) : {}; } catch (e) { throw new Error('Сервер вернул не JSON: ' + text.slice(0, 200)); }
                if (result && (result.error || result.err)) throw new Error(result.error || result.err);
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
            self.meta.cut = byName(TABLE.cut);
            self.meta.supply = byName(TABLE.supply);
            self.meta.slitter = byName(TABLE.slitter);
            self.meta.materialBatch = byName(TABLE.materialBatch);
            self.meta.strip = byName(TABLE.strip); // подчинённая «Производственной резки» (Task 3)
            self.meta.finishedBatch = byName(TABLE.finishedBatch);
            self.meta.sleeveTask = byName(TABLE.sleeveTask);
            self.meta.settings = byName(TABLE.settings);
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
                if (key !== 'DAY_START_HOUR' && key !== 'DAY_END_HOUR') return;
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
        if (materialId === '') { this.notify('У резки не задано сырьё — резерв невозможен', 'error'); return Promise.resolve(); }
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

    // Прямая карта очередности из object/ «Производственная резка». Нужна как источник
    // истины после _m_set: отчёт cut_planning может отставать или отдать старый alias.
    AtexProductionPlanning.prototype.loadCutSequences = function() {
        var meta = this.meta.cut;
        if (!meta) return Promise.resolve({});
        var seqIdx = columnIndex(meta, CUT_REQ.sequence);
        if (seqIdx < 0) return Promise.resolve({});
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            var map = {};
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                var raw = r[seqIdx];
                if (raw == null || String(raw).trim() === '') return;
                var n = Number(raw);
                map[String(rec.i)] = isFinite(n) ? n : String(raw);
            });
            return map;
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
        if (!meta) { this.jumboWidthByMaterial = {}; this.toleranceByMaterial = {}; return Promise.resolve(); }
        var widthIdx = columnIndex(meta, 'Ширина, мм');
        var tolIdx = columnIndex(meta, 'Допуск, мм');   // #3120: допуск по виду сырья (иначе дефолт)
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            var map = {}, tol = {}, names = {};
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                map[String(rec.i)] = widthIdx >= 0 ? (Number(r[widthIdx]) || 0) : 0;
                // сырое значение допуска (пустое — если не задано): resolveTolerance даст дефолт
                tol[String(rec.i)] = tolIdx >= 0 ? r[tolIdx] : '';
                names[String(rec.i)] = r[0] == null ? '' : String(r[0]);   // имя вида сырья (для подписи)
            });
            self.jumboWidthByMaterial = map;
            self.toleranceByMaterial = tol;
            self.materialNameById = names;
        });
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
                BETWEEN_CUTS: raw.BETWEEN_CUTS != null ? raw.BETWEEN_CUTS : DEFAULT_OP_TIMES.BETWEEN_CUTS,
                CLEANUP_SHIFT: raw.CLEANUP_SHIFT != null ? raw.CLEANUP_SHIFT : DEFAULT_OP_TIMES.CLEANUP_SHIFT
            };
        });
    };

    // Допуск остатка для вида сырья: «Допуск, мм» из справочника, иначе DEFAULT_TOLERANCE_MM.
    AtexProductionPlanning.prototype.resolveToleranceMm = function(materialId) {
        var raw = this.toleranceByMaterial ? this.toleranceByMaterial[String(materialId)] : '';
        return resolveTolerance(raw, DEFAULT_TOLERANCE_MM);
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
            var sequenceByCut = results[1] || {};
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
        var duration = plannedCutDurationMinutes(runLength, d.plannedRuns, this.opTimes);
        var timing = cutTimingDetails(runLength, d.plannedRuns, this.opTimes);
        var cutMainState = { last: this.lastCutMainValue };
        var cutMainValue = nextCutMainValue(this.cuts, controllerNowMs(this), cutMainState);
        this.lastCutMainValue = cutMainState.last;
        var fields = buildFields(reqIds, {
            slitter: d.slitterId,
            materialBatch: d.materialBatchId,
            plannedRuns: d.plannedRuns,
            duration: duration > 0 ? duration : '',
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
            this.notify('Не могу создать резку: ' + cutWriteDiagnosticSummary(payloadDiagnostics), 'error');
            return;
        }

        function finishCreatedCut(id) {
            if (!id) throw new Error('Сервер не вернул id новой резки');
            // #3242: «Обеспечение» теперь ссылается на «Партию ГП», которой в ручном
            // создании резки ещё нет (состав добавляется отдельно). Поэтому здесь
            // обеспечения НЕ создаём — иначе вышли бы «сироты» без ссылки. Привязка
            // позиций к резке идёт через генерацию/планирование (создаёт Партии ГП).
            // Ручная привязка к позициям — отдельная доработка (#3242 PR3).
            console.log('[pp] 🔪 createCut: резка #' + id + ' создана (без обеспечений; выбрано позиций: ' + selectedPositions.length + ')');
            return self.reload().then(function() {
                self.setBusy(false);
                self.draft = self.blankDraft();
                self.selectedCutId = String(id);
                self.closeForm();
                self.notify('Производственная резка #' + id + ' создана' +
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
            self.notify('Ошибка создания резки: ' + err.message, 'error');
        });
    };

    // Привязка самостоятельной резки к позиции заказа через «Обеспечение».
    AtexProductionPlanning.prototype.createSupply = function(opts) {
        var self = this;
        if (this.busy) return;
        var meta = this.meta.supply;
        if (!opts.positionId) { this.notify('Выберите позицию заказа', 'error'); return; }
        if (!opts.cutId) { this.notify('Не выбрана резка', 'error'); return; }

        // #3242: «Обеспечение» теперь ссылается на «Партию ГП», а не на резку. Ручная
        // привязка «позиция → резка» без выбора конкретной Партии ГП создала бы
        // «сироту» без ссылки — поэтому временно заблокирована до доработки UI (#3242 PR3).
        if (!opts.finishedBatchId) {
            this.notify('Ручная привязка к резке временно недоступна: обеспечение теперь ссылается на «Партию ГП». Используйте планирование.', 'error');
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
                self.notify('Обеспечение создано: позиция связана с резкой', 'success');
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
            });
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка удаления связи: ' + err.message, 'error');
        });
    };

    AtexProductionPlanning.prototype.reload = function() {
        var self = this;
        // Полосы перечитываем перед очередью, чтобы knifeCount/knifeWidths влились в свежие резки.
        return this.loadCutStrips().then(function() { return self.loadPlanning(); })
            .then(function() { self.resolveCutMaterials(); });
    };

    // ── Встроенный редактор Полос резки (база cut-calc renderStrips/computeSummary/syncStrips) ──

    var STRIP_PURPOSES = ['Заказ', 'Склад', 'Отходы'];

    // Загрузка состава резки из «Партии ГП» (#3242; подчинённые: F_U = cutId).
    // Колонки JSON_OBJ резолвятся по имени. → [{id, width, qty=Кол-во рулонов}].
    AtexProductionPlanning.prototype.loadStripsForCut = function(cutId) {
        var sm = this.meta.finishedBatch;
        var widthIdx = columnIndex(sm, FINISHED_BATCH_REQ.width);
        var qtyIdx = columnIndex(sm, FINISHED_BATCH_REQ.rolls);
        return this.getJson('object/' + sm.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(cutId) + '&LIMIT=0,500').then(function(rows) {
            return (rows || []).map(function(rec) {
                var r = rec.r || [];
                return {
                    id: String(rec.i),
                    width: (widthIdx >= 0 && r[widthIdx] != null) ? String(r[widthIdx]) : '',
                    qty: (qtyIdx >= 0 && r[qtyIdx] != null) ? String(r[qtyIdx]) : ''
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
        panel.appendChild(el('div', { class: 'atex-pp-strip-loading', text: 'Загрузка полос…' }));
        container.appendChild(panel);

        this.loadStripsForCut(cut.id).then(function(loaded) {
            // Если за время загрузки панель закрыли/переключили — ничего не рисуем.
            if (String(self.stripEditCutId) !== String(cut.id) || !panel.parentNode) return;
            // Глубокая копия исходного состава для диффа при сохранении (#3242: Партия ГП).
            var original = loaded.map(function(s) { return { id: s.id, width: s.width, qty: s.qty }; });
            var strips = loaded.map(function(s) { return { id: s.id, width: s.width, qty: s.qty }; });
            self.renderStripPanel(panel, cut, strips, original);
        }).catch(function(err) {
            if (panel.parentNode) {
                panel.innerHTML = '';
                panel.appendChild(el('div', { class: 'atex-pp-empty', text: 'Ошибка загрузки полос: ' + err.message }));
            }
        });
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
            summaryEl.appendChild(metric('Итого ножей', knives));
            summaryEl.appendChild(metric('Занято, мм', used));
            // Ширина джамбо неизвестна (нет вида сырья / ширины) → остаток посчитать
            // нельзя. Не показываем ложный отрицательный «вне допуска» (#3116 п.5),
            // а нейтрально сигналим, что джамбо не задан.
            if (!(jumbo > 0)) {
                summaryEl.appendChild(metric('Остаток, мм', '—'));
                summaryEl.appendChild(el('span', { class: 'atex-pp-strip-badge', text: 'ширина джамбо не задана' }));
            } else {
                var rem = planning.stripsRemainder(jumbo, strips);
                var tol = self.resolveToleranceMm(cut.materialId);   // допуск вида сырья или дефолт 20
                var within = Math.abs(rem) <= Math.abs(tol);
                var remNode = metric('Остаток, мм', rem);
                if (within) remNode.classList.add('is-ok'); else remNode.classList.add('is-warn');
                summaryEl.appendChild(remNode);
                var badge = el('span', { class: 'atex-pp-strip-badge ' + (within ? 'is-ok' : 'is-warn'), text: within ? 'в допуске' : 'вне допуска' });
                summaryEl.appendChild(badge);
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
                q.addEventListener('input', function() {
                    s.qty = q.value;
                    rollsCell.textContent = String(round3((stripNum(s.qty) || 0) * passes));
                    recalc();
                });
                q.addEventListener('change', function() { self.persistStrip(cut.id, s); });  // авто-сейв (#3127)
                row.appendChild(q);

                row.appendChild(rollsCell);   // #3253: вычисляемое поле «Рулонов», read-only

                // #3280: «Назначение» — Заказ (на эту Партию ГП есть ссылка из Обеспечения) / Склад.
                var purpose = (s.id != null && orderedBatchIds[String(s.id)]) ? 'Заказ' : 'Склад';
                row.appendChild(el('span', {
                    class: 'atex-pp-strip-purpose atex-pp-strip-purpose--' + (purpose === 'Заказ' ? 'order' : 'stock'),
                    text: purpose
                }));

                var del = el('button', { class: 'atex-pp-btn atex-pp-strip-del', type: 'button', title: 'Удалить полосу', text: '×' });
                del.addEventListener('click', function() {
                    if (self.busy) return;
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
            var rem = (jumbo > 0) ? (jumbo - planning.stripsUsedWidth(strips)) : null;
            var list = prefWidths.filter(function(p) { return rem == null || (Number(p.width) || 0) <= rem; });
            if (!list.length) { prefList.appendChild(el('div', { class: 'atex-pp-empty', text: 'Нет ходовых, помещающихся в остаток.' })); return; }
            list.forEach(function(p) {
                var b = el('button', { class: 'atex-pp-btn atex-pp-strip-pref-item', type: 'button',
                    text: p.width + ' мм · Популярность ' + p.popularity });
                b.addEventListener('click', function() {
                    var ns = { id: null, width: String(p.width), qty: '1' };   // #3242: «Партия ГП»
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

    // Авто-сейв одной полосы по мере редактирования (#3127). Есть id → _m_set;
    // нет id, но есть данные → _m_new (up=cutId), сохраняем выданный id в strip.id
    // (флаг _creating защищает от двойного создания при близких change-событиях).
    // Пустую новую полосу не создаём. Ошибки — тостом.
    AtexProductionPlanning.prototype.persistStrip = function(cutId, strip) {
        var self = this;
        var sm = this.meta.finishedBatch;   // #3242: состав резки = «Партия ГП»
        if (!sm || !strip) return Promise.resolve();
        var fields = buildFinishedBatchFields(sm, { width: strip.width, rolls: strip.qty, active: '1' });
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

        // Карта исходных записей по id для сравнения.
        var origById = {};
        (original || []).forEach(function(s) { if (s.id) origById[String(s.id)] = s; });
        var keepIds = {};

        var ops = [];
        (strips || []).forEach(function(s) {
            var hasData = String(s.width).trim() !== '' || String(s.qty).trim() !== '';
            var fields = buildFinishedBatchFields(sm, { width: s.width, rolls: s.qty, active: '1' });
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
            this.notify('Не найдены метаданные таблиц (Резка/Обеспечение/Партия ГП)', 'error');
            return;
        }

        // Необеспеченные позиции, сгруппированные по совместимому профилю:
        // сырьё + направление намотки + длина намотки.
        // Только согласованные (order_approval_date или item_approval_date).
        var unsup = uncoveredPositions(this.genPositions, this.supplies).filter(function(p) { return p.approved; });
        console.log('[pp] ⚙️ generateCuts: всего позиций:', this.genPositions.length, ', необеспеченных согласованных:', unsup.length);
        if (!unsup.length) {
            this.notify('Нет необеспеченных позиций для генерации', 'info');
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

        Promise.all(preloads).then(function() {
            // Построить раскладки по каждому профилю; собрать пропуски.
            var allLayouts = [];   // [{...layout, mat}]
            var skipped = [];      // [{positionId, reason}]
            profiles.forEach(function(group) {
                var mat = group.materialId;
                var jw = self.jumboWidthByMaterial[mat];
                if (!jw) {
                    group.positions.forEach(function(p) { skipped.push({ positionId: p.id, reason: 'нет ширины джамбо' }); });
                    return;
                }
                layoutPositionGroups(group.positions).forEach(function(positionGroup) {
                    var res = layoutCore.planLayouts({
                        jumboWidth: jw,
                        positions: positionGroup.map(function(p) {
                            return { id: p.id, width: p.width, qty: p.qty, dueKey: p.dueKey };
                        }),
                        preferred: self.preferredByMaterial[group.key] || [],
                        options: { windowDays: WINDOW_DAYS, tolerance: self.resolveToleranceMm(mat) }
                    });
                    (res.layouts || []).forEach(function(lay) {
                        lay.mat = mat;
                        lay.windDir = group.windDir;
                        lay.windLength = group.windLength;
                        allLayouts.push(lay);
                    });
                    (res.skipped || []).forEach(function(s) { skipped.push(s); });
                });
            });

            console.log('[pp] ⚙️ generateCuts: раскладок построено:', allLayouts.length, ', пропущено:', skipped.length);
            if (skipped.length > 0) console.log('[pp] ⚙️ generateCuts: первые пропуски:', JSON.stringify(skipped.slice(0, 5)));

            if (!allLayouts.length) {
                console.log('[pp] ⚙️ generateCuts: нет раскладок, выход');
                self.notify('Нет необеспеченных позиций для генерации (пропущено ' + skipped.length + ')', 'info');
                return;
            }
            var timingDiagnostics = cutGenerationTimingDiagnostics(allLayouts, self.genPositions, self.opTimes);
            if (timingDiagnostics.length) {
                console.error('[pp] ❌ generateCuts: ошибка подготовки полей резки — ' + cutWriteDiagnosticSummary(timingDiagnostics), {
                    diagnostics: timingDiagnostics,
                    layouts: allLayouts.slice(0, 5)
                });
                self.notify('Ошибка подготовки резок: ' + cutWriteDiagnosticSummary(timingDiagnostics.slice(0, 3)) +
                    (timingDiagnostics.length > 3 ? '; …' : ''), 'error');
                return;
            }

            // #3253: в подтверждении не считаем полосы/ножи — только число резок.
            var nCuts = allLayouts.length;
            var msg = 'Не обеспечено резками и складом позиций: ' + unsup.length +
                '. Создать ' + nCuts + ' резок? Пропущено ' + skipped.length + '.';

            self.confirmAction(msg, actionsEl, [
                { label: 'Создать: мин. переналадок', primary: true, onConfirm: function() {
                    self.runGenerateCuts(allLayouts, skipped, PLANNING_STRATEGY_SETUP);
                } },
                { label: 'Создать: сложные раньше', onConfirm: function() {
                    self.runGenerateCuts(allLayouts, skipped, PLANNING_STRATEGY_FATIGUE);
                } }
            ]);
        }).catch(function(err) {
            self.notify('Ошибка подготовки генерации: ' + err.message, 'error');
        });
    };

    // Последовательное создание записей по подготовленным раскладкам (#3242):
    // Резка → Партии ГП (состав, по ширинам) → задания на втулки → Обеспечения
    // (ссылаются на «Партию ГП» нужной ширины). Излишек рулонов сверх обеспечений —
    // склад (та же Партия ГП без своего обеспечения). Зависимые _m_new не параллелятся.
    AtexProductionPlanning.prototype.runGenerateCuts = function(layouts, skipped, strategy) {
        var self = this;
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
            status: reqIdByName(cutMeta, CUT_REQ.status),
            sequence: reqIdByName(cutMeta, CUT_REQ.sequence)
        };
        var sleeveMeta = this.meta.sleeveTask;
        var sleeveReqIds = sleeveMeta ? {
            diameter: reqIdByName(sleeveMeta, SLEEVE_TASK_REQ.diameter),
            actualQty: reqIdByName(sleeveMeta, SLEEVE_TASK_REQ.actualQty),
            status: reqIdByName(sleeveMeta, SLEEVE_TASK_REQ.status)
        } : {};
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
            this.notify('Ошибка подготовки резок: ' + cutWriteDiagnosticSummary(timingDiagnostics.slice(0, 3)) +
                (timingDiagnostics.length > 3 ? '; …' : ''), 'error');
            return Promise.resolve();
        }

        var layoutPlans = [];
        layouts.forEach(function(lay, layIdx) {
            var plannedRuns = plannedRunsForLayout(lay, posById);
            var runLength = layoutRunLength(lay, posById);
            var batchId = pickBatchFIFOForRun(self.genBatches, lay.mat, runLength, batchRemainingById);
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
                planDate: cutMainValue
            };
            var slitterId = chooseSlitterBySetup(descriptor, self.slitters, setupGroupsByDay[day], loadBySlitterId, planOptions);
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
                duration: plannedCutDurationMinutes(runLength, plannedRuns, self.opTimes),
                timing: cutTimingDetails(runLength, plannedRuns, self.opTimes),
                slitterId: slitterId,
                cutMainValue: cutMainValue,
                sequence: '',
                index: layIdx
            });
        });
        if (layoutPlans.length) self.lastCutMainValue = cutMainState.last;

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

        this.setBusy(true);
        // Окно прогресса (#3148): генерация идёт последовательными зависимыми
        // запросами, может занять заметное время.
        console.log('[pp] 🔧 runGenerateCuts: начало создания ' + nCuts + ' резок...');
        this.showProgress('Генерация резок…', nCuts);
        var chain = Promise.resolve();
        var startTime = Date.now();
        layouts.forEach(function(lay, layIdx) {
            chain = chain.then(function() {
                self.updateProgress(doneCuts, 'Создаётся резка ' + (layIdx + 1) + ' из ' + nCuts + '…');
                var layoutPlan = layoutPlans[layIdx];
                var plannedRuns = layoutPlan.plannedRuns;
                var runLength = layoutPlan.runLength;
                var duration = layoutPlan.duration;
                var timing = layoutPlan.timing;
                var batchId = layoutPlan.batchId;
                var slitterId = layoutPlan.slitterId;
                var sequence = layoutPlan.sequence;
                var cutMainValue = layoutPlan.cutMainValue;
                var cutFields = buildFields(cutReqIds, {
                    status: CUT_STATUSES[0],
                    slitter: slitterId,
                    materialBatch: batchId,
                    plannedRuns: plannedRuns,
                    duration: duration > 0 ? duration : '',
                    timing: timing,
                    length: runLength > 0 ? runLength : '',
                    winding: normWinding(lay && lay.windDir),
                    sequence: sequence
                });
                cutFields = addMainValueField(cutMeta, cutFields, cutMainValue);
                var payloadDiagnostics = traceCutCreatePayload('runGenerateCuts', cutMeta, cutReqIds, cutFields, self, ['plannedRuns', 'duration', 'timing', 'length']);
                if (payloadDiagnostics.length) {
                    throw new Error('Неполный payload резки ' + (layIdx + 1) + ': ' + cutWriteDiagnosticSummary(payloadDiagnostics));
                }

                // #3242: состав резки — «Партия ГП» по каждой ширине (Σ рулонов × прогоны).
                // Запоминаем id по ширине, чтобы обеспечения сослались на нужную партию.
                var widthToBatchId = {};
                function createFinishedBatches(cutId) {
                    var batchChain = Promise.resolve();
                    producedBatchesForLayout(lay, runLength).forEach(function(batch) {
                        batchChain = batchChain.then(function() {
                            // #3253: «Кол-во рулонов» «Партии ГП» = число полос за проход (без ×проходов).
                            var fields = buildFinishedBatchFields(finishedBatchMeta, {
                                width: batch.width,
                                rolls: batch.strips,
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
                    if (!sleeveMeta) return Promise.resolve();
                    var taskChain = Promise.resolve();
                    positionSleeveTasksForLayout(lay, posById, plannedRuns).forEach(function(task) {
                        taskChain = taskChain.then(function() {
                            var fields = buildFields(sleeveReqIds, {
                                diameter: task.diameter,
                                actualQty: 0,
                                status: SLEEVE_TASK_STATUS
                            });
                            fields['t' + sleeveMeta.id] = task.qty;
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
                    supplyPlanForLayout(lay, posById, plannedRuns, posLength).forEach(function(plan) {
                        supChain = supChain.then(function() {
                            var batchId = widthToBatchId[stripWidthKey(plan.width)];
                            if (!batchId) {
                                console.error('[pp] ⚙️ runGenerateCuts: нет «Партии ГП» ширины ' + plan.width +
                                    ' для позиции ' + plan.positionId + ' — обеспечение не создаём (не сирота)');
                                return;
                            }
                            var fields = buildSupplyFieldsForFinishedBatch(supplyMeta, {
                                finishedBatchId: batchId,
                                footage: plan.footage > 0 ? plan.footage : '',
                                rolls: plan.rolls,
                                active: '1',
                                status: SUPPLY_STATUSES[0]
                            });
                            return self.post('_m_new/' + supplyMeta.id + '?JSON&up=' + encodeURIComponent(plan.positionId), fields)
                                .then(function() { nPositions += 1; });
                        });
                    });
                    return supChain;
                }

                // 1) корневая резка, 2) Партии ГП (состав), 3) втулки, 4) обеспечения→Партия ГП.
                return self.post('_m_new/' + cutMeta.id + '?JSON&up=1', cutFields).then(function(res) {
                    var cutId = res && (res.obj || res.id || res.i);
                    if (!cutId) throw new Error('Сервер не вернул id новой резки');
                    return createFinishedBatches(cutId)
                        .then(function() { return createSleeveTasks(); })
                        .then(function() { return createSupplies(); });
                }).then(function() {
                    // Резка со всеми полосами и обеспечениями готова → +1 к прогрессу.
                    doneCuts += 1;
                    self.updateProgress(doneCuts);
                });
            });
        });

        var genStartTime = Date.now();
        return chain.then(function() {
            var elapsed = ((Date.now() - genStartTime) / 1000).toFixed(1);
            console.log('[pp] 🔧 runGenerateCuts: все записи созданы за ' + elapsed + 'с. загружаем свежие данные...');
            self.updateProgress(nCuts, 'Обновление очереди…');
            return self.reload();
        }).then(function() {
            var elapsed = ((Date.now() - genStartTime) / 1000).toFixed(1);
            console.log('[pp] 🔧 runGenerateCuts: данные загружены за ' + elapsed + 'с. рендерим...');
            self.hideProgress();
            self.setBusy(false);
            var renderStart = Date.now();
            self.render();
            var renderMs = Date.now() - renderStart;
            console.log('[pp] 🔧 runGenerateCuts: render занял ' + renderMs + 'мс');
            var totalElapsed = ((Date.now() - genStartTime) / 1000).toFixed(1);
            var reasons = self.groupSkipReasons(skipped);
            var sleeveMin = sleeveMinutes(nSleeves, self.opTimes || {});
            console.log('[pp] 🔧 runGenerateCuts: ГОТОВО за ' + totalElapsed + 'с. резок:', layouts.length, 'полос:', nStrips, 'втулок:', nSleeveTasks, 'пропущено:', skipped.length);
            self.notify('Создано ' + layouts.length + ' резок (' + planningStrategyLabel(planOptions.strategy) + '), полос ' + nStrips +
                ', заданий на втулки ' + nSleeveTasks +
                (sleeveMin > 0 ? ' (' + sleeveMin + ' мин)' : '') +
                ', пропущено ' + skipped.length + ' позиций' + (reasons ? ' (' + reasons + ')' : ''), 'success');
        }).catch(function(err) {
            self.hideProgress();
            self.setBusy(false);
            console.error('[pp] 🔧 runGenerateCuts: ОШИБКА', err.message, err.stack);
            self.notify('Ошибка генерации резок: ' + err.message, 'error');
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

    function normalizeConfirmActions(okLabel, onConfirm) {
        if (Array.isArray(okLabel)) {
            return okLabel.map(function(action, i) {
                var a = action || {};
                return {
                    label: a.label || a.text || 'Да',
                    primary: a.primary === true || i === 0,
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
        if (actions.length === 1 && typeof window !== 'undefined' && window.mainAppController &&
            typeof window.mainAppController.showDeleteConfirmModal === 'function') {
            window.mainAppController.showDeleteConfirmModal(message).then(function(ok) {
                if (ok) actions[0].onConfirm();
            });
            return;
        }
        var host = actionsEl || (this.root && this.root.querySelector('.atex-pp-panel-actions')) || this.root;
        if (host && host.querySelector && host.querySelector('.atex-pp-confirm-bar')) return;
        var bar = el('div', { class: 'atex-pp-confirm-bar' });
        bar.appendChild(el('span', { class: 'atex-pp-confirm-msg', text: message }));
        var cancelBtn = el('button', { class: 'atex-pp-btn', type: 'button', text: 'Отмена' });
        function removeBar() { if (bar.parentNode) bar.parentNode.removeChild(bar); }
        actions.forEach(function(action) {
            var cls = 'atex-pp-btn' + (action.primary ? ' atex-pp-btn-primary' : '');
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

    // DRY-метод сохранения изменённых «Очередностей». pairs = [{cutId, sequence}].
    // opts.successMessage — если передан, показывается после reload вместо дефолтного;
    // opts.silent — не показывать уведомление (runPlanning добавит своё).
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
        var cutsById = {}; (self.cuts || []).forEach(function(c) { cutsById[String(c.id)] = c; });
        var cutReqIds = {
            slitter: reqIdByName(cutMeta, CUT_REQ.slitter),
            materialBatch: reqIdByName(cutMeta, CUT_REQ.materialBatch),
            plannedRuns: runsReqId,
            status: reqIdByName(cutMeta, CUT_REQ.status),
            sequence: seqReqId,
            winding: reqIdByName(cutMeta, CUT_REQ.winding)
        };
        // buildFields ключ для проходов — по runsReqId (live «Кол-во резок план»).
        var createsByParent = {};
        (ops.creates || []).forEach(function(cr) { (createsByParent[cr.parentCutId] = createsByParent[cr.parentCutId] || []).push(cr); });
        var updateByCut = {};
        (ops.updates || []).forEach(function(u) { updateByCut[u.cutId] = u; });

        this.setBusy(true);
        var chain = Promise.resolve();

        // 1) Обновить существующие записи (первый сегмент каждой логической резки).
        (ops.updates || []).forEach(function(u) {
            chain = chain.then(function() {
                var fields = {};
                if (u.sequence != null && seqReqId) fields['t' + seqReqId] = String(u.sequence);
                var ts = Number(u.planStartTs);
                if (mainKey && isFinite(ts) && ts > 0) fields[mainKey] = String(ts);
                if (u.plannedRuns != null && runsReqId) fields['t' + runsReqId] = String(u.plannedRuns);
                return self.post('_m_set/' + u.cutId + '?JSON', fields);
            });
        });

        // 2) Создать записи-продолжения с копией Полос и долей Обеспечения.
        Object.keys(createsByParent).forEach(function(parentId) {
            var parentCut = cutsById[parentId];
            var crs = createsByParent[parentId];
            var upd = updateByCut[parentId];
            var aRuns = upd ? (Number(upd.plannedRuns) || 0) : 0;
            var segRuns = [aRuns].concat(crs.map(function(c) { return Number(c.plannedRuns) || 0; }));
            chain = chain.then(function() { return self.loadStripsForCut(parentId); }).then(function(parentStrips) {
                var parentSupplies = (self.supplies || []).filter(function(s) { return String(s.cutId) === String(parentId); });
                var shareBySupply = parentSupplies.map(function(s) { return { s: s, shares: splitSupplyShares(s.rolls, s.footage, segRuns) }; });
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
                // 2b) каждое продолжение B (сегменты 1..N).
                crs.forEach(function(cr, ci) {
                    var segIdx = ci + 1;
                    cChain = cChain.then(function() {
                        var cutFields = buildFields(cutReqIds, {
                            status: (parentCut && parentCut.status) || CUT_STATUSES[0],
                            slitter: parentCut && parentCut.slitter && parentCut.slitter.id,
                            materialBatch: parentCut && parentCut.batchId,
                            plannedRuns: cr.plannedRuns,
                            sequence: cr.sequence,
                            winding: normWinding(parentCut && parentCut.winding)
                        });
                        cutFields = addMainValueField(cutMeta, cutFields, cr.planStartTs);
                        return self.post('_m_new/' + cutMeta.id + '?JSON&up=1', cutFields).then(function(res) {
                            var bId = res && (res.obj || res.id || res.i);
                            if (!bId) throw new Error('Сервер не вернул id продолжения резки');
                            var stripMap = {};
                            var bChain = Promise.resolve();
                            (parentStrips || []).forEach(function(st) {
                                bChain = bChain.then(function() {
                                    var f = buildFinishedBatchFields(fbMeta, { width: st.width, rolls: st.qty, active: '1' });
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
            });
        });

        // 3) Удалить записи-продолжения прежних цепочек (их Полосы/дети каскадятся).
        (ops.deletes || []).forEach(function(id) {
            chain = chain.then(function() { return self.post('_m_del/' + encodeURIComponent(id) + '?JSON', {}); });
        });

        return chain.then(function() { return self.reload(); }).then(function() {
            self.setBusy(false); self.render(); return true;
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка разбиения резок: ' + err.message, 'error');
            return false;
        });
    };

    // Авто-планирование: запускает planQueues на текущих резках, сохраняет
    // изменившиеся значения «Очередности» через saveSequences, затем перезагружает
    // очередь. Подтверждение реализуется без native confirm(): если доступен
    // window.mainAppController.showDeleteConfirmModal — использует его (Promise);
    // иначе вставляет inline-блок подтверждения в переданный actionsEl.
    AtexProductionPlanning.prototype.runPlanning = function(actionsEl, strategy) {
        var self = this;
        if (this.busy) return;

        var MSG_CONFIRM = 'Перезаписать очередь автопланированием?';

        function doRun(selectedStrategy) {
            var planOptions = makePlanningOptions(selectedStrategy, self.changeTimes);

            // #3280: план разбиения по дням + плановое время старта (t1078).
            var dayWindow = self.workingWindow();
            var nowD = new Date(controllerNowMs(self));
            var planBaseMidnightMs = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate(), 0, 0, 0, 0).getTime();
            var windPoints = windingPointsFromTimes(self.opTimes || {});
            var perPassByCut = {};
            self.cuts.forEach(function(c) {
                perPassByCut[String(c.id)] = windingMinutes(cutRunLength(c, self.supplies, self.footageBySupply), windPoints);
            });
            var ops = planCutOperations(self.cuts, {
                weights: planOptions,
                times: self.changeTimes,
                dayStartMin: dayWindow.startMin,
                dayEndMin: dayWindow.cutEndMin,
                perPassByCut: perPassByCut,
                planBaseMidnightMs: planBaseMidnightMs
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
                self.notify('Очередь уже оптимальна, изменений нет', 'info');
                return;
            }

            self.applySplitPlan({ updates: changedUpdates, creates: ops.creates, deletes: ops.deletes }).then(function(ok) {
                if (!ok) return;   // applySplitPlan уже сделал reload+render и (при ошибке) уведомил
                var total = (ops.updates || []).length + (ops.creates || []).length;
                var extra = [];
                if ((ops.creates || []).length) extra.push('перенесено на след. день: ' + ops.creates.length);
                if ((ops.deletes || []).length) extra.push('слито продолжений: ' + ops.deletes.length);
                self.notify('Запланировано (' + planningStrategyLabel(planOptions.strategy) + '): ' + total + ' резок' + (extra.length ? ' (' + extra.join('; ') + ')' : ''), 'success');
            });
        }

        // Подтверждение без native confirm (общий хелпер confirmAction).
        if (strategy != null && String(strategy).trim() !== '') {
            self.confirmAction(MSG_CONFIRM, actionsEl, 'Да, перезаписать', function() { doRun(strategy); });
            return;
        }
        self.confirmAction(MSG_CONFIRM, actionsEl, [
            { label: 'Мин. переналадок', primary: true, onConfirm: function() { doRun(PLANNING_STRATEGY_SETUP); } },
            { label: 'Сложные раньше', onConfirm: function() { doRun(PLANNING_STRATEGY_FATIGUE); } }
        ]);
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
        console.log('[pp] 📝 renderForm: отрисовка формы. позиций доступно:', this.genPositions.length);
        form.appendChild(el('h2', { class: 'atex-pp-form-title', text: 'Новая производственная резка' }));
        form.appendChild(el('p', { class: 'atex-pp-hint', text: 'Номер присваивается автоматически при сохранении.' }));

        form.appendChild(field('Станок', this.selectRef(this.slitters, d.slitterId, '— выберите станок —',
            function(v) { d.slitterId = v; }, reqIdByName(this.meta.cut, CUT_REQ.slitter))));
        // Поле «Партия сырья» убрано (#3120 Фаза 2): материал/сырьё резки определяются
        // по обеспечиваемым позициям (resolveCutMaterials), а расход — записями
        // «Расход сырья» (FIFO-резерв). Прямая ссылка на партию в форме больше не нужна.

        // Выбор позиций заказа для обеспечения (#3194) — только согласованные,
        // ещё не обеспеченные позиции, сгруппированные по виду сырья и ширине.
        var unsup = uncoveredPositions(this.genPositions, this.supplies);
        // Только согласованные: заказ (order_approval_date) или позиция (item_approval_date)
        var approvedOnly = unsup.filter(function(p) { return p.approved; });
        // Группировка по сырью для компактного отображения
        var byMat = {};
        approvedOnly.forEach(function(p) {
            var key = (p.materialId || '?') + '|' + (p.width || 0);
            if (!byMat[key]) byMat[key] = [];
            byMat[key].push(p);
        });
        var posOptions = Object.keys(byMat).sort().map(function(key) {
            var items = byMat[key];
            var first = items[0];
            var label = 'Сырьё#' + (first.materialId || '?') + ' · ' + (first.width || '?') + ' мм · ' + items.length + ' поз. · ' + items.reduce(function(s,p){return s+(p.qty||0);},0) + ' рул.';
            return { id: key, label: label, count: items.length, positionIds: items.map(function(p){return p.id;}) };
        });
        console.log('[pp] 📝 renderForm: позиций для выбора (согласованные, необеспеченные):', approvedOnly.length, ', групп:', posOptions.length);

        if (posOptions.length > 0) {
            var posContainer = el('div', { class: 'atex-pp-positions-select' });
            posContainer.appendChild(el('label', { class: 'atex-pp-field-label', text: 'Обеспечиваемые позиции (' + approvedOnly.length + ' доступно)' }));
            // Кнопки выбора всех / сброса
            var toggleBar = el('div', { class: 'atex-pp-toggle-bar' });
            var selectAllBtn = el('button', { class: 'atex-pp-btn atex-pp-btn-sm', type: 'button', text: 'Выбрать все' });
            selectAllBtn.addEventListener('click', function() {
                d.selectedPositions = approvedOnly.map(function(p) { return p.id; });
                self.renderForm();
            });
            toggleBar.appendChild(selectAllBtn);
            var clearBtn = el('button', { class: 'atex-pp-btn atex-pp-btn-sm', type: 'button', text: 'Сбросить' });
            clearBtn.addEventListener('click', function() {
                d.selectedPositions = [];
                self.renderForm();
            });
            toggleBar.appendChild(clearBtn);
            posContainer.appendChild(toggleBar);
            // Группы позиций
            var listEl = el('div', { class: 'atex-pp-positions-list' });
            posOptions.forEach(function(opt) {
                var allSelected = opt.positionIds.every(function(pid) { return d.selectedPositions.indexOf(pid) >= 0; });
                var row = el('label', { class: 'atex-pp-positions-row' });
                var cb = el('input', { type: 'checkbox' });
                cb.checked = allSelected;
                cb.addEventListener('change', function() {
                    if (cb.checked) {
                        opt.positionIds.forEach(function(pid) { if (d.selectedPositions.indexOf(pid) < 0) d.selectedPositions.push(pid); });
                    } else {
                        d.selectedPositions = d.selectedPositions.filter(function(pid) { return opt.positionIds.indexOf(pid) < 0; });
                    }
                });
                row.appendChild(cb);
                row.appendChild(el('span', { class: 'atex-pp-positions-label', text: opt.label }));
                listEl.appendChild(row);
            });
            posContainer.appendChild(listEl);
            form.appendChild(posContainer);
        } else {
            form.appendChild(el('p', { class: 'atex-pp-hint', text: 'Нет согласованных необеспеченных позиций.' }));
        }

        var plannedRunsInput = el('input', { class: 'atex-pp-input', type: 'number', min: '1', step: '1' });
        plannedRunsInput.value = d.plannedRuns || '1';
        plannedRunsInput.addEventListener('input', function() { d.plannedRuns = plannedRunsInput.value; });
        form.appendChild(field('Кол-во план', plannedRunsInput));

        var dateInput = el('input', { class: 'atex-pp-input', type: 'date' });
        dateInput.value = d.planDate || '';
        dateInput.addEventListener('input', function() { d.planDate = dateInput.value; });
        form.appendChild(field('Дата плана', dateInput));

        form.appendChild(field('Статус', this.selectText(CUT_STATUSES, d.status, function(v) { d.status = v; })));

        var notes = el('textarea', { class: 'atex-pp-input atex-pp-textarea', rows: '2' });
        notes.value = d.notes || '';
        notes.addEventListener('input', function() { d.notes = notes.value; });
        form.appendChild(field('Примечания', notes));

        var selInfo = el('span', { class: 'atex-pp-selection-info', text: 'Выбрано позиций: ' + (d.selectedPositions||[]).length });
        form.appendChild(selInfo);

        var actions = el('div', { class: 'atex-pp-actions' });
        var createBtn = el('button', { class: 'atex-pp-btn atex-pp-btn-primary', type: 'button', text: 'Создать резку' });
        createBtn.addEventListener('click', function() { self.createCut(); });
        actions.appendChild(createBtn);

        var planBtn = el('button', { class: 'atex-pp-btn', type: 'button', text: 'Запланировать' });
        planBtn.addEventListener('click', function() { self.runPlanning(actions); });
        actions.appendChild(planBtn);

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
        box.innerHTML = '';

        // Панель фильтров. Фильтр по станку заменён закладками (#3116 п.2).
        var filters = el('div', { class: 'atex-pp-filters' });
        var statusFilter = this.selectText([''].concat(CUT_STATUSES), this.filter.status, function(v) { self.filter.status = v; self.renderQueue(); });
        // первый пункт статуса — «все»
        statusFilter.options[0].textContent = 'Все статусы';
        var dateFilter = el('input', { class: 'atex-pp-input', type: 'date', value: this.filter.date || '' });
        dateFilter.addEventListener('change', function() { self.filter.date = dateFilter.value; self.renderQueue(); });
        filters.appendChild(field('Дата плана', dateFilter));
        filters.appendChild(field('Статус', statusFilter));
        box.appendChild(filters);

        // Базовая видимость очереди: не «Завершён», дата плана = выбранной/пустая.
        var visible = (this.cuts || []).filter(function(c) { return isCutVisible(c, self.filter.date); });
        var filtered = filterCuts(visible, this.filter);
        var groups = groupBySlitter(filtered);

        if (!groups.length) {
            // Показываем вкладки всех станков, даже если резок нет (#3168).
            if (this.slitters.length) {
                var allKeys = this.slitters.map(function(s) { return String(s.id); });
                if (allKeys.indexOf(self.activeSlitter) === -1) self.activeSlitter = allKeys[0];
                var tabs = el('div', { class: 'atex-pp-tabs' });
                this.slitters.forEach(function(s) {
                    var key = String(s.id);
                    var tab = el('button', { class: 'atex-pp-tab' + (key === self.activeSlitter ? ' is-active' : ''), type: 'button' }, [
                        el('span', { class: 'atex-pp-tab-label', text: s.label }),
                        el('span', { class: 'atex-pp-tab-count', text: '0' })
                    ]);
                    tab.addEventListener('click', function() { self.activeSlitter = key; self.renderQueue(); });
                    tabs.appendChild(tab);
                });
                box.appendChild(tabs);
                box.appendChild(el('div', { class: 'atex-pp-empty', text: 'Резок в очереди нет' }));
            } else {
                box.appendChild(el('div', { class: 'atex-pp-empty', text: 'Резок в очереди нет' }));
            }
            return;
        }

        // Закладки по станкам (#3116 п.2): один таб на станок, контент — резки
        // только активного станка. Активный таб в this.activeSlitter (ключ как в
        // groupBySlitter); если выбранного среди групп нет — берём первый.
        function groupKey(g) { return g.slitter.id == null ? '\u0000none' : String(g.slitter.id); }
        var keys = groups.map(groupKey);
        if (keys.indexOf(self.activeSlitter) === -1) self.activeSlitter = keys[0];

        var tabs = el('div', { class: 'atex-pp-tabs' });
        groups.forEach(function(g) {
            var key = groupKey(g);
            var tab = el('button', { class: 'atex-pp-tab' + (key === self.activeSlitter ? ' is-active' : ''), type: 'button' }, [
                el('span', { class: 'atex-pp-tab-label', text: g.slitter.label }),
                el('span', { class: 'atex-pp-tab-count', text: String(g.cuts.length) })
            ]);
            tab.addEventListener('click', function() { self.activeSlitter = key; self.renderQueue(); });
            tabs.appendChild(tab);
        });
        box.appendChild(tabs);

        var activeGroup = groups.filter(function(g) { return groupKey(g) === self.activeSlitter; })[0] || groups[0];
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
        // #3280: полночь дня планирования (день 0 расписания) — для title даты+времени старта.
        var nowD = new Date(controllerNowMs(self));
        var planBaseMidnightMs = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate(), 0, 0, 0, 0).getTime();
        var schedule = buildSchedule(activeGroup.cuts, {
            windPoints: windPoints,
            times: self.changeTimes,
            runLengthByCut: runLenByCut,
            shiftStartMin: dayWindow.startMin,
            shiftEndMin: dayWindow.cutEndMin
        });
        schedule.forEach(function(sc) { schedById[sc.cutId] = sc; });
        self._timingByCut = {};   // #3240: пересобираем контекст тайминга модалки для активного станка
        var dayCutsByKey = {};
        activeGroup.cuts.forEach(function(c) {
            var key = cutPlanDayKey(c);
            if (!dayCutsByKey[key]) dayCutsByKey[key] = [];
            dayCutsByKey[key].push(c);
        });
        // Уборка в конце рабочего дня (#3155): блок после последней резки каждого дня.
        var cleanupByDay = {};
        dayCleanups(schedule, { cleanupMin: dayWindow.cleanupMin, shiftEndMin: dayWindow.cutEndMin })
            .forEach(function(cl) { cleanupByDay[cl.day] = cl; });
        function schedDay(sc) { return sc ? Math.floor((Number(sc.startMin) || 0) / 1440) : null; }

        activeGroup.cuts.forEach(function(c, idx) {
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
            var cardPanel = el('div', { class: 'atex-pp-cut' + (active ? ' is-active' : '') + (unreserved ? ' is-unreserved' : ''), dataset: { cutId: String(c.id) } });

            var materialText = c.materialName || (c.materialId ? ('#' + c.materialId) : '—');
            var sc = schedById[String(c.id)];
            // #3240: контекст тайминга резки для модалки (setup с предыдущей + нормы + старт).
            self._timingByCut[String(c.id)] = buildCutTimingCtx(
                c, idx > 0 ? activeGroup.cuts[idx - 1] : null, sc,
                runLenByCut[String(c.id)], windPoints, self.changeTimes
            );
            var cutNumberTitle = 'Резка № ' + (formatCutNumber(c.number) || c.id);
            // #3280: title — плановая дата+время старта до минут (sc есть); иначе номер резки.
            var cutNumTitle = formatCutStartTitle(sc, planBaseMidnightMs) || cutNumberTitle;
            var info = el('div', { class: 'atex-pp-cut-info' }, [
                el('span', { class: 'atex-pp-cut-num', title: cutNumTitle, text: formatCutStartTime(sc) }),
                el('span', { class: 'atex-pp-cut-seq', text: 'Очер.: ' + (c.sequence != null && !isNaN(c.sequence) ? c.sequence : '—') }),
                el('span', { class: 'atex-pp-cut-material', title: materialText, text: 'Сырьё: ' + materialText }),
                el('span', { class: 'atex-pp-cut-winding', text: formatCutWindingLabel(c) }),
                el('span', { class: 'atex-pp-cut-runs', text: formatCutRuns(c.plannedRuns, runLenByCut[String(c.id)]) }),
                el('span', { class: 'atex-pp-cut-batch', title: c.materialBatch.label || '', text: c.materialBatch.label || '' }),
                el('span', { class: 'atex-pp-cut-status', text: c.status || '' }),
                el('span', { class: 'atex-pp-cut-supplies', text: supplies ? ('связей: ' + supplies) : 'нет связей' })
            ]);
            cardPanel.appendChild(info);
            // Выбор резки кликом по всей карточке (#3149), а не только по .atex-pp-cut-info.
            // Клики по контролам (↑/↓/Полосы) и панели полос не считаем выбором: их
            // перерисовка очереди закрыла бы только что открытую панель полос.
            cardPanel.addEventListener('click', function(e) {
                if (e.target.closest('.atex-pp-cut-controls') ||
                    e.target.closest('.atex-pp-strip-panel')) return;
                self.selectedCutId = c.id;
                self.render();
            });

            // Строка времени: старт–финиш (длительность) от начала смены 08:00.
            if (sc) {
                var runLengthForCut = runLenByCut[String(c.id)];
                var scheduleText = formatScheduleLine(sc, runLengthForCut, windPoints.length > 0);
                if (stripNum(sc.durationMin) <= 0 && typeof console !== 'undefined' && console.error) {
                    console.error('[pp] ❌ renderQueue: длительность резки не рассчитана', {
                        cutId: String(c.id),
                        plannedRuns: c.plannedRuns,
                        runLength: runLengthForCut,
                        storedDuration: c.duration,
                        windPoints: windPoints
                    });
                }
                var timeEl = el('div', {
                    class: 'atex-pp-cut-time',
                    role: 'button',
                    tabindex: '0',
                    title: 'Показать тайминг резки',
                    text: scheduleText
                });
                timeEl.addEventListener('click', function(e) {
                    e.stopPropagation();
                    self.openCutTiming(c);
                });
                timeEl.addEventListener('keydown', function(e) {
                    if (e.key !== 'Enter' && e.key !== ' ' && e.keyCode !== 13 && e.keyCode !== 32) return;
                    if (e.preventDefault) e.preventDefault();
                    e.stopPropagation();
                    self.openCutTiming(c);
                });
                cardPanel.appendChild(timeEl);
            }

            var controls = el('div', { class: 'atex-pp-cut-controls' });
            var up = el('button', { class: 'atex-pp-move', type: 'button', text: '↑', title: 'Выше' });
            var down = el('button', { class: 'atex-pp-move', type: 'button', text: '↓', title: 'Ниже' });
            var sameDayCuts = dayCutsByKey[cutPlanDayKey(c)] || activeGroup.cuts;
            var dayIdx = sameDayCuts.indexOf(c);
            if (dayIdx === 0) up.disabled = true;
            if (dayIdx === sameDayCuts.length - 1) down.disabled = true;
            up.addEventListener('click', function() {
                if (self.busy) return;
                var p = moveInQueue(sameDayCuts, dayIdx, -1);
                if (p.length) self.saveSequences(p);
            });
            down.addEventListener('click', function() {
                if (self.busy) return;
                var p = moveInQueue(sameDayCuts, dayIdx, 1);
                if (p.length) self.saveSequences(p);
            });
            var strips = el('button', { class: 'atex-pp-strips', type: 'button', text: stripsButtonLabel(c.knifeCount), title: 'Полосы резки (количество полос)' });
            strips.addEventListener('click', function() {
                if (self.busy) return;
                self.openStrips(c, cardPanel);
            });
            controls.appendChild(up);
            controls.appendChild(down);
            controls.appendChild(strips);
            cardPanel.appendChild(controls);

            groupEl.appendChild(cardPanel);

            // Уборка в конце дня (#3155, #3276): один блок после последней резки очереди.
            if (sc && idx === activeGroup.cuts.length - 1) {
                var cl = cleanupByDay[schedDay(sc)];
                if (cl) {
                    groupEl.appendChild(el('div', { class: 'atex-pp-cleanup',
                        text: '🧹 Уборка после смены · ' + formatClock(cl.startMin) + ' – ' + formatClock(cl.finishMin) +
                              ' · ' + cl.durationMin + ' мин' }));
                }
            }
        });
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

        box.appendChild(el('h2', { class: 'atex-pp-form-title', text: 'Обеспечение позиций заказа' }));
        if (!cut) {
            box.appendChild(el('div', { class: 'atex-pp-empty', text: 'Выберите резку в очереди, чтобы привязать её к позиции заказа.' }));
            return;
        }

        box.appendChild(el('p', { class: 'atex-pp-hint', text: 'Резка № ' + (formatCutNumber(cut.number) || cut.id) + ' · ' + ((cut.materialBatch && cut.materialBatch.label) || '') }));

        var positionsById = positionMap(this.positions);
        var genPositionsById = positionMap(this.genPositions);
        function selectedPosition(id) {
            var key = String(id == null ? '' : id);
            return positionsById[key] || genPositionsById[key] || { id: key, qty: 0, length: 0 };
        }

        // #3242: обеспечение ссылается на «Партию ГП» резки — её и выбираем.
        var draft = { positionId: '', footage: '', rolls: '', active: true, status: SUPPLY_STATUSES[0], finishedBatchId: '' };
        var rollsInput;
        var batchSelect;
        var cutBatches = [];   // [{id, width, qty}] состав выбранной резки (Партии ГП)
        function applyPositionDefaults(positionId) {
            draft.positionId = positionId;
            var position = selectedPosition(positionId);
            var length = stripNum(position.length);
            draft.footage = length > 0 ? length : '';
            draft.rolls = remainingRollsForPosition(position, self.supplies);
            if (rollsInput) rollsInput.value = draft.rolls;
            // Автовыбор Партии ГП по ширине позиции (если состав уже загружен).
            var match = cutBatches.filter(function(b) { return stripWidthKey(b.width) === stripWidthKey(position.width); })[0];
            if (match && batchSelect) { batchSelect.value = String(match.id); draft.finishedBatchId = String(match.id); }
        }

        box.appendChild(field('Позиция заказа', this.selectRef(this.positions, '', '— выберите позицию —',
            function(v) { applyPositionDefaults(v); }, null, { cacheKey: 'positions' })));

        // #3242: селектор «Партии ГП» резки (обеспечение ссылается на конкретную партию).
        batchSelect = el('select', { class: 'atex-pp-select' });
        batchSelect.appendChild(el('option', { value: '', text: 'Загрузка Партий ГП…' }));
        batchSelect.addEventListener('change', function() { draft.finishedBatchId = batchSelect.value; });
        box.appendChild(field('Партия ГП', batchSelect));
        this.loadStripsForCut(cut.id).then(function(batches) {
            if (String(self.selectedCutId) !== String(cut.id) || !batchSelect.parentNode) return;
            cutBatches = batches || [];
            batchSelect.innerHTML = '';
            if (!cutBatches.length) {
                batchSelect.appendChild(el('option', { value: '', text: 'нет Партий ГП — добавьте состав резки' }));
                return;
            }
            batchSelect.appendChild(el('option', { value: '', text: '— выберите Партию ГП —' }));
            cutBatches.forEach(function(b) {
                batchSelect.appendChild(el('option', { value: String(b.id), text: b.width + ' мм · ' + b.qty + ' рул.' }));
            });
            if (draft.positionId) applyPositionDefaults(draft.positionId);   // авто-подбор по ширине
        }).catch(function() {
            if (!batchSelect.parentNode) return;
            batchSelect.innerHTML = '';
            batchSelect.appendChild(el('option', { value: '', text: 'ошибка загрузки Партий ГП' }));
        });

        rollsInput = el('input', { class: 'atex-pp-input', type: 'number', min: '0', step: 'any', placeholder: '0' });
        rollsInput.addEventListener('input', function() { draft.rolls = rollsInput.value; });
        box.appendChild(field('Кол-во рулонов', rollsInput));

        var activeInput = el('input', { type: 'checkbox' });
        activeInput.checked = draft.active;
        activeInput.addEventListener('change', function() { draft.active = activeInput.checked; });
        box.appendChild(el('label', { class: 'atex-pp-checkbox-field' }, [
            activeInput,
            el('span', { text: 'В работе' })   // #3242: «Активно» → «В работе»
        ]));

        var actions = el('div', { class: 'atex-pp-actions' });
        var linkBtn = el('button', { class: 'atex-pp-btn atex-pp-btn-primary', type: 'button', text: 'Привязать к резке' });
        linkBtn.addEventListener('click', function() {
            self.createSupply({
                positionId: draft.positionId,
                cutId: cut.id,
                finishedBatchId: draft.finishedBatchId,   // #3242: ссылка на «Партию ГП»
                footage: draft.footage,
                rolls: draft.rolls,
                active: draft.active,
                status: draft.status
            });
        });
        actions.appendChild(linkBtn);

        // FIFO-резерв сырья резки в «Расход сырья» (Фаза 1b): подобрать партии по приходу
        // под требуемый прогон и записать расход. Идемпотентно (перезапишет прежние).
        var reserveBtn = el('button', { class: 'atex-pp-btn', type: 'button', text: 'Зарезервировать сырьё' });
        reserveBtn.addEventListener('click', function() {
            if (self.busy) return;
            self.reserveCutMaterial(cut);
        });
        actions.appendChild(reserveBtn);
        box.appendChild(actions);

        // Уже привязанные позиции.
        var linked = this.supplies.filter(function(s) { return String(s.cutId) === String(cut.id); });
        var listWrap = el('div', { class: 'atex-pp-linked' });
        listWrap.appendChild(el('h3', { class: 'atex-pp-linked-title', text: 'Связанные позиции (' + linked.length + ')' }));
        if (!linked.length) {
            listWrap.appendChild(el('div', { class: 'atex-pp-empty', text: 'Пока нет связей.' }));
        } else {
            var posById = {};
            this.positions.forEach(function(p) { posById[p.id] = p.label; });
            linked.forEach(function(s) {
                var label = posById[s.positionId] || ('позиция #' + s.positionId);
                var rolls = stripNum(s.rolls);
                var foot = supplyFootage(s, self.footageBySupply);
                if (rolls > 0) label += ' · ' + round3(rolls) + ' рул.';
                else if (foot > 0 && label.indexOf(String(round3(foot)) + 'м') < 0) label += ' · ' + foot + ' м';
                var children = [el('span', { class: 'atex-pp-linked-label', text: label })];
                var del = el('button', { class: 'atex-pp-linked-del', type: 'button', text: '×', title: 'Убрать из резки' });
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
        var bar = el('div', { class: 'atex-pp-progress-bar' });
        var fill = el('div', { class: 'atex-pp-progress-fill' });
        bar.appendChild(fill);
        var counter = el('div', { class: 'atex-pp-progress-count', text: '' });
        var dialog = el('div', { class: 'atex-pp-progress-dialog' }, [
            el('div', { class: 'atex-pp-progress-title', text: title || 'Генерация резок…' }),
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
                : ((Number(done) || 0) + ' из ' + total + ' (' + pct + '%)');
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

        // Шапка очереди: заголовок слева, затем кнопка «Сгенерировать резки» и «+ Новая резка» справа вверху.
        var queueActions = el('div', { class: 'atex-pp-panel-actions' });
        var genBtn = el('button', { class: 'atex-pp-btn', type: 'button', text: 'Сгенерировать резки' });
        genBtn.addEventListener('click', function() { self.generateCuts(queueActions); });
        var addBtn = el('button', { class: 'atex-pp-btn atex-pp-btn-primary atex-pp-add', type: 'button', text: '+ Новая резка' });
        addBtn.addEventListener('click', function() { self.openForm(); });
        queueActions.appendChild(genBtn);
        queueActions.appendChild(addBtn);
        var queueHead = el('div', { class: 'atex-pp-panel-head' }, [
            el('h2', { class: 'atex-pp-form-title', text: 'Очередь резок по станкам' }),
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
        if (typeof document !== 'undefined') {
            document.addEventListener('keydown', function(e) {
                if (e.key !== 'Escape' && e.keyCode !== 27) return;
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
                    self.loadSlittersWithStop().then(function(items) { self.slitters = items; }),
                    self.loadMaterialBatches(),
                    self.loadPositions(),  // заполняет genPositions (с dueKey) тоже
                    self.loadGenBatches(), // FIFO-партии для генерации резок + карта batchMaterialById (стоп-лист)
                    self.loadJumboWidths(),// ширина джамбо по сырью (для cut-layout)
                    self.loadOperationTimes(), // времена переналадок (веса очереди)
                    self.loadDaySettings(),    // DAY_START_HOUR/DAY_END_HOUR для рабочего окна
                    self.loadSupplyFootage(),  // метраж обеспечений (длительность/расписание)
                    self.loadConsumption(),    // расход сырья (FIFO-резерв, Фаза 1b)
                    // Полосы перед очередью: knifeCount/knifeWidths вливаются в резки в loadPlanning.
                    self.loadCutStrips().then(function() { return self.loadPlanning(); })
                ]);
            })
            .then(function() { self.resolveCutMaterials(); self.render(); })
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
        controller.start();
    }

    return { planning: planning, Controller: AtexProductionPlanning, init: init };
});

 
 
// @version 2026-06-07-issue-3219
