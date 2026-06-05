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
// `_m_new/{Производственная резка}` (Номер не задаётся, у таблицы `unique=1` —
// сервер сам считает автонумер), обеспечение — `_m_new/{Обеспечение}` с
// `up={позицияId}` и ссылкой `t{Производственная резка}`, правки — `_m_set`. ID
// таблиц и реквизитов для записи не хардкодятся: берутся по именам из
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
        strip: 'Полоса'
    };
    // Реквизиты подчинённой «Полосы» (up = резка). Резолв по имени.
    var STRIP_REQ = {
        width: 'Ширина, мм',
        qty: 'Количество',
        purpose: 'Назначение'
    };
    // Реквизиты «Производственной резки» (Номер — главное значение, автонумер).
    var CUT_REQ = {
        slitter: 'Слиттер',
        materialBatch: 'Партия сырья',
        planDate: 'Дата план',
        status: 'Статус',
        notes: 'Примечания',
        sequence: 'Очередность'
    };
    // Реквизиты подчинённого «Обеспечения» (up = позиция заказа).
    var SUPPLY_REQ = {
        footage: 'Метраж, м',
        cut: 'Производственная резка',
        finishedBatch: 'Партия ГП',
        status: 'Статус'
    };
    // Статусы — свободный текст (тип 3); фиксируем разумные наборы по дизайн-спеке.
    var CUT_STATUSES = ['Запланирована', 'В очереди', 'В работе', 'Готова', 'Отменена'];
    var SUPPLY_STATUSES = ['Зарезервировано', 'Выполнено', 'Отменено'];
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

    // Значение реквизита из метаданных по имени → его числовой id.
    function reqIdByName(meta, name) {
        var found = (meta && meta.reqs || []).filter(function(r) {
            return String(r.val).trim().toLowerCase() === String(name).trim().toLowerCase();
        })[0];
        return found ? String(found.id) : null;
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
        // Сортировка резок внутри каждой группы по sequence (возр., null/NaN — в конец, стабильно).
        function seqKey(c) { var s = c && c.sequence; var n = Number(s); return (s == null || isNaN(n)) ? Infinity : n; }
        Object.keys(groups).forEach(function(k) {
            groups[k].cuts = groups[k].cuts.map(function(c, i) { return { c: c, i: i }; })
                .sort(function(a, b) { return seqKey(a.c) - seqKey(b.c) || a.i - b.i; })
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
    //  2) заказ резки согласован — «Дата согласования» заказа не пустая
    //     (orderApprovalDate из отчёта cut_planning, через Позиция→Заказ);
    //  3) «Дата план» совпадает с выбранной датой ИЛИ пустая (ещё не запланирована —
    //     напр. только что сгенерированная резка). selectedDate пустая → дата не фильтрует.
    // Форматы дат разные («ДД.ММ.ГГГГ» из отчёта, «ГГГГ-ММ-ДД» из <input type=date>) —
    // нормализуем общим batchDateKey.
    function isCutVisible(cut, selectedDate) {
        if (!cut) return false;
        if (String(cut.status || '').trim() === 'Завершён') return false;
        if (!String(cut.orderApprovalDate || '').trim()) return false;
        var pd = String(cut.planDate || '').trim();
        if (pd === '') return true;
        var sd = String(selectedDate == null ? '' : selectedDate).trim();
        if (sd === '') return true;
        return batchDateKey(pd) === batchDateKey(sd);
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

    // Плоские строки отчёта cut_planning (JSON_KV) → { cuts, supplies }.
    // Одна резка с N обеспечениями даёт N строк (LEFT JOIN) — резки dedup по
    // `cut_id`; обеспечения собираются из строк с непустым `supply_id`. Резки без
    // обеспечения (пустой `supply_id`) остаются в очереди и фантомных связей не
    // создают. Формы записей совпадают с прежними mapCutRecord/loadSupplies:
    // резка — { id, number, slitter:{id,label},
    // materialBatch:{id,label}, planDate, status }; обеспечение —
    // { id, positionId, cutId }.
    function rowsToPlanning(rows) {
        var cutsById = {};
        var order = [];
        var supplies = [];
        function str(v) { return v == null ? '' : String(v); }
        (rows || []).forEach(function(row) {
            var cutId = str(row.cut_id);
            if (cutId && !cutsById[cutId]) {
                var seqVal = row.cut_sequence;
                cutsById[cutId] = {
                    id: cutId,
                    number: str(row.cut_no),
                    slitter: { id: row.cut_slitter_id ? String(row.cut_slitter_id) : null, label: str(row.cut_slitter) },
                    materialBatch: { id: null, label: str(row.cut_material_batch) },
                    planDate: str(row.cut_plan_date),
                    status: str(row.cut_status),
                    sequence: (seqVal == null || seqVal === '') ? null : Number(seqVal),
                    materialId: str(row.cut_material_id),
                    materialName: str(row.cut_material),
                    batchId: str(row.cut_batch_id),
                    jumboRemainingM: (row.cut_jumbo_remaining == null || row.cut_jumbo_remaining === '') ? 0 : Number(row.cut_jumbo_remaining),
                    knifeCount: (row.cut_knives == null || row.cut_knives === '') ? 0 : Number(row.cut_knives),
                    knifeWidths: [],
                    winding: normWinding(row.cut_winding),
                    rollerWidth: (row.cut_roller_width == null || row.cut_roller_width === '') ? 0 : Number(row.cut_roller_width),
                    isFoil: /фольг/i.test(str(row.cut_material)),
                    orderId: str(row.order_id),
                    orderApprovalDate: str(row.order_approval_date)
                };
                order.push(cutId);
            }
            var supplyId = str(row.supply_id);
            if (supplyId) {
                supplies.push({
                    id: supplyId,
                    positionId: row.supply_position_id ? String(row.supply_position_id) : null,
                    cutId: cutId
                });
            }
        });
        return { cuts: order.map(function(id) { return cutsById[id]; }), supplies: supplies };
    }

    // Строки отчёта positions_list (JSON_KV) → [{ id, label }] для дропдауна
    // привязки и плашек «Связанные позиции». Подпись: «<номер заказа>/<номер
    // позиции> · <ширина> мм» (#3116 п.3). Номер заказа берётся из колонки
    // `order_no` отчёта; если её нет (старый отчёт) — деградирует до «№<номер>».
    // Ширина пропускается, если пустая.
    function rowsToPositions(rows) {
        return (rows || []).map(function(row) {
            var id = row.position_id == null ? '' : String(row.position_id);
            var orderNo = row.order_no == null ? '' : String(row.order_no).trim();
            var no = row.position_no == null ? '' : String(row.position_no).trim();
            var width = row.position_width == null ? '' : String(row.position_width).trim();
            var head = orderNo !== '' ? orderNo + '/' + no : '№' + no;
            var label = head + (width !== '' ? ' · ' + width + ' мм' : '');
            return { id: id, label: label };
        });
    }

    // Строки отчёта positions_list (JSON_KV) → [{ id, materialId, width, qty, length, dueKey }]
    // для генерации резок. position_material_id (добавлен в отчёт), position_width,
    // position_qty, position_length → числа; пустые значения → 0/'' но объект всегда
    // присутствует. length — «Длина, м» позиции (длина прогона джамбо = «Метраж, м»
    // создаваемого обеспечения, #3155); нет колонки в отчёте → 0 (длительность намотки 0).
    // dueKey — числовой ключ «Срока изготовления» (position_due_date) через
    // batchDateKey (для оконного отбора по сроку при генерации); нет срока → Infinity.
    function rowsToGenPositions(rows) {
        return (rows || []).map(function(row) {
            return {
                id: row.position_id == null ? '' : String(row.position_id),
                materialId: row.position_material_id == null ? '' : String(row.position_material_id),
                width: Number(row.position_width) || 0,
                qty: Number(row.position_qty) || 0,
                length: Number(row.position_length) || 0,
                dueKey: batchDateKey(row.position_due_date)
            };
        });
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

    // Преобразование «Дата прихода» в числовой ключ для FIFO-сортировки.
    // ISO YYYY-MM-DD → YYYYMMDD; D.M.Y / D/M/Y → YYYYMMDD; пустое → Infinity.
    function batchDateKey(value) {
        var s = String(value == null ? '' : value).trim();
        if (!s) return Infinity;
        var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return Number(iso[1]) * 10000 + Number(iso[2]) * 100 + Number(iso[3]);
        var dmy = s.match(/^(\d{1,2})[.\\/](\d{1,2})[.\\/](\d{4})/);
        if (dmy) return Number(dmy[3]) * 10000 + Number(dmy[2]) * 100 + Number(dmy[1]);
        var t = Date.parse(s);
        return isNaN(t) ? Infinity : t;
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
            var rem = fmtRemainder(row.batch_remainder_m2);
            var parts = [];
            if (material) parts.push(material);
            if (rem) parts.push('ост. ' + rem + ' м²');
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

    // Стоимость перехода prev→next в МИНУТАХ переналадки (times по кодам, иначе дефолт):
    //   смена сырья ИЛИ намотки ИЛИ партии → MATERIAL_WINDING (одна операция «смена
    //   сырья/намотки»; неудобный остаток — её же частный случай, отдельно не считаем);
    //   смена набора ножей ИЛИ сужение ролика → KNIFE. Минуты суммируются (две операции —
    //   обе вычитают время смены). Бинарно (изменилось/нет), без нормировок.
    function changeoverCost(prev, next, times){
        var t = times || DEFAULT_OP_TIMES;
        var matWind = Number(t.MATERIAL_WINDING != null ? t.MATERIAL_WINDING : DEFAULT_OP_TIMES.MATERIAL_WINDING) || 0;
        var knife = Number(t.KNIFE != null ? t.KNIFE : DEFAULT_OP_TIMES.KNIFE) || 0;
        var cost = 0;
        var matWindChange = String(prev.materialId) !== String(next.materialId)
            || normWinding(prev.winding) !== normWinding(next.winding)
            || String(prev.batchId) !== String(next.batchId);
        if (matWindChange) cost += matWind;
        var knifeChange = (Number(prev.knifeCount) || 0) !== (Number(next.knifeCount) || 0)
            || widthSetDistance(prev.knifeWidths, next.knifeWidths) > 0
            || (Number(prev.rollerWidth) || 0) > (Number(next.rollerWidth) || 0);   // сужение ролика
        if (knifeChange) cost += knife;
        return cost;
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

    var SHIFT_START_MIN = 8 * 60;        // начало смены 08:00 (минут от полуночи)
    var SHIFT_END_MIN = 16 * 60 + 30;    // конец рабочего времени 16:30 (далее 30 мин уборки до 17:00)

    // Расписание очереди (по порядку): для каждой резки — старт/финиш в минутах от
    // полуночи дня 0 (через сутки — следующий рабочий день). setup перед резкой = лидер
    // (BETWEEN_CUTS) + переналадка с предыдущей (changeoverCost, мин); длительность =
    // намотка прогона (windingMinutes по метражу). Рабочее окно дня — [shiftStartMin,
    // shiftEndMin] (08:00–16:30); резка, не влезающая до конца окна, переносится на
    // 08:00 следующего дня. opts: { windPoints, times, shiftStartMin, shiftEndMin,
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
            var dur = windingMinutes(Number(runLen[String(c.id)]) || 0, wind);
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

    // Минуты от полуночи → «ЧЧ:ММ» (с «+Nд», если перевалило за сутки). Терпимо к числам.
    function formatClock(min){
        var m = Math.round(Number(min) || 0);
        var day = Math.floor(m / 1440);
        var hm = ((m % 1440) + 1440) % 1440;
        var h = Math.floor(hm / 60), mm = hm % 60;
        var s = (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
        return day > 0 ? s + ' +' + day + 'д' : s;
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

    // Позиции, не имеющие ни одной записи обеспечения. supplies — [{positionId}].
    function unsuppliedPositions(positions, supplies){
        var sup = {}; (supplies || []).forEach(function(s){ if (s && s.positionId != null) sup[String(s.positionId)] = true; });
        return (positions || []).filter(function(p){ return !sup[String(p.id)]; });
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

    // FIFO-партия: среди партий нужного сырья с остатком > 0 выбрать с наименьшим dateKey.
    // batches — [{id, materialId, dateKey (число), remainder}]. null если нет подходящей.
    function pickBatchFIFO(batches, materialId){
        var mat = String(materialId == null ? '' : materialId);
        var avail = (batches || []).filter(function(b){ return String(b.materialId) === mat && (Number(b.remainder) || 0) > 0; });
        if (!avail.length) return null;
        avail.sort(function(a, b){ return (Number(a.dateKey) || 0) - (Number(b.dateKey) || 0) || (String(a.id) < String(b.id) ? -1 : 1); });
        return String(avail[0].id);
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
        return (genBatches || []).filter(function(b){ return String(b.materialId) === mat; }).map(function(b){
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

    // Упорядочить резки станка: не-Фольга, затем Фольга; внутри каждой группы — жадно
    // (переналадки), затем по убыванию ножей (#3130); проставить sequence; вход не мутировать.
    function orderCuts(cuts, weights){
        var rest = [], foil = [];
        (cuts || []).forEach(function(c){ (c && c.isFoil ? foil : rest).push(c); });
        var seq = byKnifeCountDesc(greedySequence(rest, weights)).concat(byKnifeCountDesc(greedySequence(foil, weights)));
        return seq.map(function(c, i){
            var copy = {}; for (var k in c){ if (Object.prototype.hasOwnProperty.call(c, k)) copy[k] = c[k]; }
            copy.sequence = i + 1;
            return copy;
        });
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

    // Сгруппировать резки по станкам, упорядочить каждую группу через orderCuts,
    // пронумеровать 1..N. Резки без станка (slitter.id == null) пропускаются.
    // Возвращает плоский массив [{cutId, slitterId, sequence}].
    function planQueues(cuts, weights) {
        var groups = {};
        var order = [];
        (cuts || []).forEach(function(c) {
            var sid = c && c.slitter && c.slitter.id;
            if (sid == null) return; // пропускаем «без станка»
            var key = String(sid);
            if (!groups[key]) { groups[key] = []; order.push(key); }
            groups[key].push(c);
        });
        var result = [];
        order.forEach(function(sid) {
            var ordered = orderCuts(groups[sid], weights);
            ordered.forEach(function(c) {
                result.push({ cutId: c.id, slitterId: sid, sequence: c.sequence });
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
        reqIdByName: reqIdByName,
        columnIndex: columnIndex,
        mapCutRecord: mapCutRecord,
        groupBySlitter: groupBySlitter,
        filterCuts: filterCuts,
        isCutVisible: isCutVisible,
        buildFields: buildFields,
        rowsToPlanning: rowsToPlanning,
        rowsToPositions: rowsToPositions,
        rowsToGenPositions: rowsToGenPositions,
        positionLengthMap: positionLengthMap,
        batchDateKey: batchDateKey,
        rowsToBatches: rowsToBatches,
        DEFAULT_OP_TIMES: DEFAULT_OP_TIMES,
        KNIFE_SCALE: KNIFE_SCALE,
        WIDTH_SCALE: WIDTH_SCALE,
        REMAINDER_OK_M: REMAINDER_OK_M,
        normWinding: normWinding,
        widthSetDistance: widthSetDistance,
        awkwardRemainder: awkwardRemainder,
        changeoverCost: changeoverCost,
        greedySequence: greedySequence,
        orderCuts: orderCuts,
        byKnifeCountDesc: byKnifeCountDesc,
        planQueues: planQueues,
        moveInQueue: moveInQueue,
        unsuppliedPositions: unsuppliedPositions,
        pickSlitter: pickSlitter,
        pickBatchFIFO: pickBatchFIFO,
        cutMissingBatch: cutMissingBatch,
        requiredRunLengthM: requiredRunLengthM,
        reserveFifo: reserveFifo,
        fifoBatchesForMaterial: fifoBatchesForMaterial,
        materialByCut: materialByCut,
        windingPointsFromTimes: windingPointsFromTimes,
        windingMinutes: windingMinutes,
        buildSchedule: buildSchedule,
        dayCleanups: dayCleanups,
        formatClock: formatClock,
        SHIFT_START_MIN: SHIFT_START_MIN,
        SHIFT_END_MIN: SHIFT_END_MIN,
        aggregateStrips: aggregateStrips,
        stripsUsedWidth: stripsUsedWidth,
        stripsTotalKnives: stripsTotalKnives,
        stripsRemainder: stripsRemainder,
        progressPercent: progressPercent,
        stripsButtonLabel: stripsButtonLabel,
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
        this.meta = { cut: null, supply: null, slitter: null, materialBatch: null, strip: null };
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
        this.preferredByMaterial = {};  // кеш ходовых ширин по сырью: materialId → [{width, popularity}]
        this.draft = this.blankDraft();
        this.filter = { slitter: '', status: '', date: todayISO() };  // дата плана по умолчанию — сегодня
        this.selectedCutId = null; // выбранная резка для привязки обеспечения
        this.stripEditCutId = null; // резка с открытым инлайн-редактором полос (одна за раз)
        this.busy = false;
        this.progressEl = null;     // окно прогресса генерации резок (#3148)
        this.progressTotal = 0;
    }

    AtexProductionPlanning.prototype.blankDraft = function() {
        return { slitterId: '', materialBatchId: '', planDate: '', status: CUT_STATUSES[0], notes: '' };
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
                return list.filter(function(t) {
                    return String(t.val).trim().toLowerCase() === name.trim().toLowerCase();
                })[0] || null;
            }
            self.meta.cut = byName(TABLE.cut);
            self.meta.supply = byName(TABLE.supply);
            self.meta.slitter = byName(TABLE.slitter);
            self.meta.materialBatch = byName(TABLE.materialBatch);
            self.meta.strip = byName(TABLE.strip); // подчинённая «Производственной резки» (Task 3)
            if (!self.meta.cut) throw new Error('В метаданных не найдена таблица «' + TABLE.cut + '»');
            if (!self.meta.supply) throw new Error('В метаданных не найдена таблица «' + TABLE.supply + '»');
        });
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

    // Карта «партия сырья → вид сырья» (object/), только для проверки стоп-листа.
    // Дропдаун партий сырья по-прежнему берётся из отчёта material_batches — не меняем.
    AtexProductionPlanning.prototype.loadBatchMaterialMap = function() {
        var self = this;
        var meta = this.meta.materialBatch;
        if (!meta) { this.batchMaterialById = {}; return Promise.resolve(); }
        var matIdx = columnIndex(meta, 'Вид сырья');
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            var map = {};
            (rows || []).forEach(function(r) {
                var ref = (matIdx >= 0 && r.r) ? parseRef(r.r[matIdx]) : { id: null };
                map[String(r.i)] = ref.id ? String(ref.id) : '';
            });
            self.batchMaterialById = map;
        });
    };

    // Справочник позиций заказа отчётом positions_list (JSON_KV). Позиция
    // подчинённая — прямое object/-чтение её не отдаёт, отчёт возвращает все.
    // Параллельно строит this.genPositions = [{ id, materialId, width, qty }]
    // для генерации резок: использует те же строки, не нужен доп. запрос.
    AtexProductionPlanning.prototype.loadPositions = function() {
        var self = this;
        return this.getJson('report/positions_list?JSON_KV&LIMIT=0,2000').then(function(rows) {
            self.positions = rowsToPositions(rows || []);
            self.genPositions = rowsToGenPositions(rows || []);
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
    AtexProductionPlanning.prototype.loadGenBatches = function() {
        var self = this;
        var meta = this.meta.materialBatch;
        if (!meta) { this.genBatches = []; return Promise.resolve(); }
        var matIdx = columnIndex(meta, 'Вид сырья');
        var dateIdx = columnIndex(meta, 'Дата прихода');
        var remIdx = columnIndex(meta, 'Остаток, м²');
        var remLinIdx = columnIndex(meta, 'Остаток, м');   // погонный остаток — для FIFO-резерва (Фаза 1b)
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            self.genBatches = (rows || []).map(function(rec) {
                var r = rec.r || [];
                var mat = matIdx >= 0 ? parseRef(r[matIdx]) : { id: null };
                return {
                    id: String(rec.i),
                    label: r[0] == null ? '' : String(r[0]),
                    materialId: mat.id ? String(mat.id) : '',
                    dateKey: dateIdx >= 0 ? batchDateKey(r[dateIdx]) : Infinity,
                    remainder: remIdx >= 0 ? (Number(r[remIdx]) || 0) : 0,
                    remainderLinear: remLinIdx >= 0 ? (Number(r[remLinIdx]) || 0) : 0
                };
            });
        });
    };

    // Расход сырья (1079, подчинён резке): this.consumptionByCut = {cutId:[{id,batchId,m2}]},
    // this.reservedM2ByBatch = {batchId: Σ Израсходовано, м²}. Источник «зарезервированного»
    // сырья для FIFO-резерва (Фаза 1b) и подсветки. Таблица резолвится по имени из _metaAll.
    AtexProductionPlanning.prototype.loadConsumption = function() {
        var self = this;
        var list = this._metaAll || [];
        var meta = list.filter(function(t) {
            return String(t.val).trim().toLowerCase() === 'расход сырья';
        })[0] || null;
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
        var foot = [];
        (this.supplies || []).forEach(function(s) {
            if (String(s.cutId) === String(cut.id)) foot.push(Number(self.footageBySupply && self.footageBySupply[String(s.id)]) || 0);
        });
        var requiredLin = requiredRunLengthM(foot);
        // свободный остаток без учёта собственных прежних резервов этой резки (их перезапишем)
        var existing = (this.consumptionByCut && this.consumptionByCut[String(cut.id)]) || [];
        var reservedExcl = {};
        for (var k in this.reservedM2ByBatch) { if (Object.prototype.hasOwnProperty.call(this.reservedM2ByBatch, k)) reservedExcl[k] = this.reservedM2ByBatch[k]; }
        existing.forEach(function(e) { if (e.batchId) reservedExcl[e.batchId] = (reservedExcl[e.batchId] || 0) - e.m2; });
        var batches = fifoBatchesForMaterial(this.genBatches, reservedExcl, materialId, widthM);
        var plan = reserveFifo(batches, requiredLin, widthM);
        var reqBatch = reqIdByName(meta, 'Партия сырья');
        var reqM2 = reqIdByName(meta, 'Израсходовано, м²');
        var ops = [];
        existing.forEach(function(e) { ops.push(function() { return self.post('_m_del/' + e.id + '?JSON', {}); }); });
        plan.allocations.forEach(function(a) {
            var fields = {};
            if (reqBatch) fields['t' + reqBatch] = a.batchId;
            if (reqM2) fields['t' + reqM2] = a.m2;
            ops.push(function() { return self.post('_m_new/' + meta.id + '?JSON&up=' + encodeURIComponent(cut.id), fields); });
        });
        this.setBusy(true);
        return ops.reduce(function(p, op) { return p.then(op); }, Promise.resolve())
            .then(function() { return self.loadConsumption(); })
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
    // Читаем object/ напрямую — колонка отчёта cut_planning поле подчинённой таблицы не
    // подтянула (reverse-join), а object/ по «Обеспечение» отдаёт «Метраж, м» штатно.
    AtexProductionPlanning.prototype.loadSupplyFootage = function() {
        var self = this;
        var meta = this.meta.supply;
        if (!meta) { this.footageBySupply = {}; return Promise.resolve(); }
        var footIdx = columnIndex(meta, SUPPLY_REQ.footage);
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            var map = {};
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                map[String(rec.i)] = footIdx >= 0 ? (Number(r[footIdx]) || 0) : 0;
            });
            self.footageBySupply = map;
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
        var meta = list.filter(function(t) {
            return String(t.val).trim().toLowerCase() === 'вид сырья';
        })[0] || null;
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
        var meta = list.filter(function(t) {
            return String(t.val).trim().toLowerCase() === 'время операции, мин';
        })[0] || null;
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

    // Ходовые ширины для сырья отчётом preferable_widths (JSON_KV, фильтр по сырью).
    // → [{ width:Number(position_width_mm), popularity:Number(position_qty_sum) }];
    // кешируется в this.preferredByMaterial[materialId]. Ленивая загрузка по сырью
    // (Task 3/4 — генерация и панель ходовых). Возвращает Promise с массивом.
    AtexProductionPlanning.prototype.loadPreferredWidths = function(materialId) {
        var self = this;
        var mat = String(materialId == null ? '' : materialId);
        if (mat === '') return Promise.resolve([]);
        if (this.preferredByMaterial[mat]) return Promise.resolve(this.preferredByMaterial[mat]);
        return this.getJson('report/preferable_widths?JSON_KV&FR_position_material_id=' + encodeURIComponent(mat)).then(function(rows) {
            var list = (rows || []).map(function(row) {
                return {
                    width: Number(row.position_width_mm) || 0,
                    popularity: Number(row.position_qty_sum) || 0
                };
            });
            self.preferredByMaterial[mat] = list;
            return list;
        });
    };

    // Очередь резок и их обеспечение одним отчётом cut_planning (JSON_KV).
    // Заполняет this.cuts и this.supplies из плоских строк отчёта; вливает
    // knifeCount/knifeWidths из this.stripAgg (cut_strips) в каждую резку.
    AtexProductionPlanning.prototype.loadPlanning = function() {
        var self = this;
        return this.getJson('report/cut_planning?JSON_KV&LIMIT=0,5000').then(function(rows) {
            var p = rowsToPlanning(rows || []);
            var agg = self.stripAgg || {};
            p.cuts.forEach(function(cut) {
                var a = agg[String(cut.id)] || {};
                cut.knifeCount = a.knifeCount || 0;
                cut.knifeWidths = a.knifeWidths || [];
            });
            self.cuts = p.cuts;
            self.supplies = p.supplies;
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

    // Создание производственной резки. Номер не задаётся (unique сам считает).
    AtexProductionPlanning.prototype.createCut = function() {
        var self = this;
        if (this.busy) return;
        var meta = this.meta.cut;
        var d = this.draft;
        if (!d.slitterId) { this.notify('Выберите станок', 'error'); return; }

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
            planDate: reqIdByName(meta, CUT_REQ.planDate),
            status: reqIdByName(meta, CUT_REQ.status),
            notes: reqIdByName(meta, CUT_REQ.notes)
        };
        var fields = buildFields(reqIds, {
            slitter: d.slitterId,
            materialBatch: d.materialBatchId,
            planDate: d.planDate,
            status: d.status,
            notes: d.notes
        });

        this.setBusy(true);
        // up=1 — корневой объект; full=1 — на случай длинных примечаний.
        this.post('_m_new/' + meta.id + '?JSON&up=1&full=1', fields).then(function(res) {
            var id = res && (res.obj || res.id || res.i);
            if (!id) throw new Error('Сервер не вернул id новой резки');
            return self.reload().then(function() {
                self.setBusy(false);
                self.draft = self.blankDraft();
                self.selectedCutId = String(id);
                self.closeForm();
                self.notify('Производственная резка создана', 'success');
                self.render();
            });
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка создания резки: ' + err.message, 'error');
        });
    };

    // Привязка резки к позиции заказа через «Обеспечение»
    // (_m_new/{Обеспечение} с up={позицияId} и ссылкой на резку).
    AtexProductionPlanning.prototype.createSupply = function(opts) {
        var self = this;
        if (this.busy) return;
        var meta = this.meta.supply;
        if (!opts.positionId) { this.notify('Выберите позицию заказа', 'error'); return; }
        if (!opts.cutId) { this.notify('Не выбрана резка', 'error'); return; }

        var reqIds = {
            footage: reqIdByName(meta, SUPPLY_REQ.footage),
            cut: reqIdByName(meta, SUPPLY_REQ.cut),
            status: reqIdByName(meta, SUPPLY_REQ.status)
        };
        var fields = buildFields(reqIds, {
            footage: opts.footage,
            cut: opts.cutId,
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

    // Загрузка текущих полос резки из object/ (подчинённые: F_U = cutId).
    // Колонки JSON_OBJ резолвятся по имени (columnIndex). → [{id, width, qty, purpose}].
    AtexProductionPlanning.prototype.loadStripsForCut = function(cutId) {
        var sm = this.meta.strip;
        var widthIdx = columnIndex(sm, STRIP_REQ.width);
        var qtyIdx = columnIndex(sm, STRIP_REQ.qty);
        var purposeIdx = columnIndex(sm, STRIP_REQ.purpose);
        return this.getJson('object/' + sm.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(cutId) + '&LIMIT=0,500').then(function(rows) {
            return (rows || []).map(function(rec) {
                var r = rec.r || [];
                return {
                    id: String(rec.i),
                    width: (widthIdx >= 0 && r[widthIdx] != null) ? String(r[widthIdx]) : '',
                    qty: (qtyIdx >= 0 && r[qtyIdx] != null) ? String(r[qtyIdx]) : '',
                    purpose: (purposeIdx >= 0 && r[purposeIdx] != null) ? String(r[purposeIdx]) : ''
                };
            });
        });
    };

    // Открыть инлайн-панель редактора полос для резки. container — очередь (this.queueEl).
    // Одна панель за раз: повторный клик по той же резке закрывает; по другой — переключает.
    AtexProductionPlanning.prototype.openStrips = function(cut, container) {
        var self = this;
        if (!this.meta.strip) { this.notify('Не найдены метаданные таблицы «' + TABLE.strip + '»', 'error'); return; }

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
            // Глубокая копия исходных полос для диффа при сохранении.
            var original = loaded.map(function(s) { return { id: s.id, width: s.width, qty: s.qty, purpose: s.purpose }; });
            var strips = loaded.map(function(s) { return { id: s.id, width: s.width, qty: s.qty, purpose: s.purpose }; });
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
        table.appendChild(el('div', { class: 'atex-pp-strip-row atex-pp-strip-head' }, [
            el('span', { text: 'Ширина, мм' }),
            el('span', { text: 'Количество' }),
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

                var q = el('input', { class: 'atex-pp-input', type: 'number', min: '0', step: '1', placeholder: '0' });
                q.value = s.qty;
                q.addEventListener('input', function() { s.qty = q.value; recalc(); });
                q.addEventListener('change', function() { self.persistStrip(cut.id, s); });  // авто-сейв (#3127)
                row.appendChild(q);

                row.appendChild(self.selectText(STRIP_PURPOSES, s.purpose, function(v) { s.purpose = v; self.persistStrip(cut.id, s); }));

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
            strips.push({ id: null, width: '', qty: '', purpose: STRIP_PURPOSES[0] });
            renderRows();
            recalc();
        });
        panel.appendChild(addBtn);

        // Панель ходовых ширин (#3128: 3 ряда со скроллом — в CSS; скрываем те,
        // что шире текущего остатка джамбо).
        var matKey = String(cut.materialId == null ? '' : cut.materialId);
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
                    var ns = { id: null, width: String(p.width), qty: '1', purpose: 'Склад' };
                    strips.push(ns);
                    renderRows();
                    recalc();
                    self.persistStrip(cut.id, ns);   // авто-сейв (#3127)
                });
                prefList.appendChild(b);
            });
        }

        if (matKey !== '' && this.preferredByMaterial[matKey]) {
            prefWidths = this.preferredByMaterial[matKey]; prefLoading = false;
        } else if (matKey !== '') {
            this.loadPreferredWidths(matKey).then(function(list) {
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
        var sm = this.meta.strip;
        if (!sm || !strip) return Promise.resolve();
        var reqIds = {
            width: reqIdByName(sm, STRIP_REQ.width),
            qty: reqIdByName(sm, STRIP_REQ.qty),
            purpose: reqIdByName(sm, STRIP_REQ.purpose)
        };
        var fields = buildFields(reqIds, { width: strip.width, qty: strip.qty, purpose: strip.purpose });
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

    // Сохранить полосы резки — дифф original↔strips (зеркало cut-calc syncStrips):
    //   нет id → _m_new (up=cutId); изменены width/qty/purpose → _m_set; удалённые id → _m_del.
    // Реквизиты резолвятся по имени (STRIP_REQ). Возвращает Promise; setBusy/reload/notify.
    AtexProductionPlanning.prototype.saveStrips = function(cutId, strips, original) {
        var self = this;
        var sm = this.meta.strip;
        var reqIds = {
            width: reqIdByName(sm, STRIP_REQ.width),
            qty: reqIdByName(sm, STRIP_REQ.qty),
            purpose: reqIdByName(sm, STRIP_REQ.purpose)
        };

        // Карта исходных полос по id для сравнения.
        var origById = {};
        (original || []).forEach(function(s) { if (s.id) origById[String(s.id)] = s; });
        var keepIds = {};

        var ops = [];
        (strips || []).forEach(function(s) {
            var hasData = String(s.width).trim() !== '' || String(s.qty).trim() !== '';
            var fields = buildFields(reqIds, { width: s.width, qty: s.qty, purpose: s.purpose });
            if (s.id) {
                keepIds[String(s.id)] = true;
                var o = origById[String(s.id)];
                var changed = !o ||
                    String(o.width).trim() !== String(s.width).trim() ||
                    String(o.qty).trim() !== String(s.qty).trim() ||
                    String(o.purpose).trim() !== String(s.purpose).trim();
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

        var layoutCore = (typeof window !== 'undefined' && window.AtexCutLayout && window.AtexCutLayout.layout) || null;
        if (!layoutCore || typeof layoutCore.planLayouts !== 'function') {
            this.notify('Модуль раскладки cut-layout не загружен', 'error');
            return;
        }
        if (!this.meta.cut || !this.meta.supply || !this.meta.strip) {
            this.notify('Не найдены метаданные таблиц (Резка/Обеспечение/Полоса)', 'error');
            return;
        }

        // Необеспеченные позиции, сгруппированные по сырью.
        var unsup = unsuppliedPositions(this.genPositions, this.supplies);
        if (!unsup.length) {
            this.notify('Нет необеспеченных позиций для генерации', 'info');
            return;
        }
        var byMaterial = {};
        var matOrder = [];
        unsup.forEach(function(p) {
            var mat = String(p.materialId == null ? '' : p.materialId);
            if (!byMaterial[mat]) { byMaterial[mat] = []; matOrder.push(mat); }
            byMaterial[mat].push(p);
        });

        // Догрузить ходовые ширины для сырья, у которого их ещё нет в кеше.
        var preloads = [];
        matOrder.forEach(function(mat) {
            if (mat !== '' && !self.preferredByMaterial[mat]) {
                preloads.push(self.loadPreferredWidths(mat));
            }
        });

        Promise.all(preloads).then(function() {
            // Построить раскладки по каждому сырью; собрать пропуски.
            var allLayouts = [];   // [{...layout, mat}]
            var skipped = [];      // [{positionId, reason}]
            matOrder.forEach(function(mat) {
                var matPositions = byMaterial[mat];
                var jw = self.jumboWidthByMaterial[mat];
                if (!jw) {
                    matPositions.forEach(function(p) { skipped.push({ positionId: p.id, reason: 'нет ширины джамбо' }); });
                    return;
                }
                var res = layoutCore.planLayouts({
                    jumboWidth: jw,
                    positions: matPositions.map(function(p) {
                        return { id: p.id, width: p.width, qty: p.qty, dueKey: p.dueKey };
                    }),
                    preferred: self.preferredByMaterial[mat] || [],
                    options: { windowDays: WINDOW_DAYS, tolerance: self.resolveToleranceMm(mat) }
                });
                (res.layouts || []).forEach(function(lay) { lay.mat = mat; allLayouts.push(lay); });
                (res.skipped || []).forEach(function(s) { skipped.push(s); });
            });

            if (!allLayouts.length) {
                self.notify('Нет необеспеченных позиций для генерации (пропущено ' + skipped.length + ')', 'info');
                return;
            }

            // Счётчики для подтверждения: полос = число записей «Полоса» (как в итоговой
            // нотификации), ножей = суммарное Количество (Σ qty).
            var nCuts = allLayouts.length;
            var nStrips = 0, nKnives = 0;
            allLayouts.forEach(function(lay) {
                (lay.strips || []).forEach(function(s) { nStrips += 1; nKnives += (Number(s.qty) || 0); });
            });
            var msg = 'Создать ' + nCuts + ' резок под необеспеченные позиции (полос ' + nStrips +
                ', ножей ' + nKnives + ')? Пропущено ' + skipped.length + '.';

            self.confirmAction(msg, actionsEl, 'Да, создать', function() {
                self.runGenerateCuts(allLayouts, skipped);
            });
        }).catch(function(err) {
            self.notify('Ошибка подготовки генерации: ' + err.message, 'error');
        });
    };

    // Последовательное создание записей по подготовленным раскладкам.
    // На каждую раскладку: Резка → её Полосы → Обеспечения (по покрытым позициям).
    // Зависимые _m_new не запускаются параллельно (Полосе/Обеспечению нужен cutId).
    AtexProductionPlanning.prototype.runGenerateCuts = function(layouts, skipped) {
        var self = this;
        var cutMeta = this.meta.cut;
        var stripMeta = this.meta.strip;
        var supplyMeta = this.meta.supply;

        var cutReqIds = {
            slitter: reqIdByName(cutMeta, CUT_REQ.slitter),
            materialBatch: reqIdByName(cutMeta, CUT_REQ.materialBatch),
            status: reqIdByName(cutMeta, CUT_REQ.status)
        };
        var stripReqIds = {
            width: reqIdByName(stripMeta, STRIP_REQ.width),
            qty: reqIdByName(stripMeta, STRIP_REQ.qty),
            purpose: reqIdByName(stripMeta, STRIP_REQ.purpose)
        };
        var supplyReqIds = {
            cut: reqIdByName(supplyMeta, SUPPLY_REQ.cut),
            footage: reqIdByName(supplyMeta, SUPPLY_REQ.footage),
            status: reqIdByName(supplyMeta, SUPPLY_REQ.status)
        };
        // #3155: «Метраж, м» обеспечения = «Длина, м» покрываемой позиции (длина прогона).
        // Без него footageBySupply=0 → windingMinutes=0 → все резки «0 мин» в расписании.
        var posLength = positionLengthMap(this.genPositions);

        // Сид баланса станков из текущих резок (счётчик по slitterId).
        var loadBySlitterId = {};
        (this.cuts || []).forEach(function(c) {
            var sid = c && c.slitter && c.slitter.id;
            if (sid != null) loadBySlitterId[String(sid)] = (loadBySlitterId[String(sid)] || 0) + 1;
        });

        var nStrips = 0;
        var nPositions = 0;
        var nCuts = layouts.length;
        var doneCuts = 0;

        this.setBusy(true);
        // Окно прогресса (#3148): генерация идёт последовательными запросами
        // (Резка → Полосы → Обеспечения), может занять заметное время.
        this.showProgress('Генерация резок…', nCuts);
        var chain = Promise.resolve();
        layouts.forEach(function(lay, layIdx) {
            chain = chain.then(function() {
                self.updateProgress(doneCuts, 'Создаётся резка ' + (layIdx + 1) + ' из ' + nCuts + '…');
                // 1) Резка (корневой объект): статус + станок (баланс) + партия (FIFO).
                var slitterId = pickSlitter(self.slitters, lay.mat, loadBySlitterId);
                if (slitterId != null) loadBySlitterId[String(slitterId)] = (loadBySlitterId[String(slitterId)] || 0) + 1;
                var batchId = pickBatchFIFO(self.genBatches, lay.mat);
                var cutFields = buildFields(cutReqIds, {
                    status: CUT_STATUSES[0],
                    slitter: slitterId,
                    materialBatch: batchId
                });
                return self.post('_m_new/' + cutMeta.id + '?JSON&up=1&full=1', cutFields).then(function(res) {
                    var cutId = res && (res.obj || res.id || res.i);
                    if (!cutId) throw new Error('Сервер не вернул id новой резки');

                    // 2) Полосы резки (up = cutId), последовательно.
                    var stripChain = Promise.resolve();
                    (lay.strips || []).forEach(function(strip) {
                        stripChain = stripChain.then(function() {
                            var fields = buildFields(stripReqIds, {
                                width: strip.width,
                                qty: strip.qty,
                                purpose: strip.purpose
                            });
                            return self.post('_m_new/' + stripMeta.id + '?JSON&up=' + encodeURIComponent(cutId), fields)
                                .then(function() { nStrips += 1; });
                        });
                    });

                    // 3) Обеспечения (up = positionId, ссылка на резку), последовательно.
                    return stripChain.then(function() {
                        var supChain = Promise.resolve();
                        (lay.positionsCovered || []).forEach(function(positionId) {
                            supChain = supChain.then(function() {
                                var len = Number(posLength[String(positionId)]) || 0;
                                var fields = buildFields(supplyReqIds, {
                                    cut: cutId,
                                    footage: len > 0 ? len : '',
                                    status: SUPPLY_STATUSES[0]
                                });
                                return self.post('_m_new/' + supplyMeta.id + '?JSON&up=' + encodeURIComponent(positionId), fields)
                                    .then(function() { nPositions += 1; });
                            });
                        });
                        return supChain;
                    });
                }).then(function() {
                    // Резка со всеми полосами и обеспечениями готова → +1 к прогрессу.
                    doneCuts += 1;
                    self.updateProgress(doneCuts);
                });
            });
        });

        chain.then(function() {
            self.updateProgress(nCuts, 'Обновление очереди…');
            return self.reload();
        }).then(function() {
            self.hideProgress();
            self.setBusy(false);
            self.render();
            var reasons = self.groupSkipReasons(skipped);
            self.notify('Создано ' + layouts.length + ' резок, полос ' + nStrips +
                ', пропущено ' + skipped.length + ' позиций' + (reasons ? ' (' + reasons + ')' : ''), 'success');
        }).catch(function(err) {
            self.hideProgress();
            self.setBusy(false);
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

    // Подтверждение без native confirm. Mirror логики runPlanning:
    // mainAppController.showDeleteConfirmModal (Promise) либо inline-блок в actionsEl.
    AtexProductionPlanning.prototype.confirmAction = function(message, actionsEl, okLabel, onConfirm) {
        if (typeof window !== 'undefined' && window.mainAppController &&
            typeof window.mainAppController.showDeleteConfirmModal === 'function') {
            window.mainAppController.showDeleteConfirmModal(message).then(function(ok) {
                if (ok) onConfirm();
            });
            return;
        }
        if (actionsEl && actionsEl.querySelector('.atex-pp-confirm-bar')) return;
        var bar = el('div', { class: 'atex-pp-confirm-bar' });
        bar.appendChild(el('span', { class: 'atex-pp-confirm-msg', text: message }));
        var okBtn = el('button', { class: 'atex-pp-btn atex-pp-btn-primary', type: 'button', text: okLabel || 'Да' });
        var cancelBtn = el('button', { class: 'atex-pp-btn', type: 'button', text: 'Отмена' });
        function removeBar() { if (bar.parentNode) bar.parentNode.removeChild(bar); }
        okBtn.addEventListener('click', function() { removeBar(); onConfirm(); });
        cancelBtn.addEventListener('click', function() { removeBar(); });
        bar.appendChild(okBtn);
        bar.appendChild(cancelBtn);
        if (actionsEl) {
            actionsEl.appendChild(bar);
        } else {
            onConfirm();
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
        var chain = Promise.resolve();
        pairs.forEach(function(p) {
            chain = chain.then(function() {
                var fields = {};
                fields[fieldKey] = String(p.sequence);
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

    // Авто-планирование: запускает planQueues на текущих резках, сохраняет
    // изменившиеся значения «Очередности» через saveSequences, затем перезагружает
    // очередь. Подтверждение реализуется без native confirm(): если доступен
    // window.mainAppController.showDeleteConfirmModal — использует его (Promise);
    // иначе вставляет inline-блок подтверждения в переданный actionsEl.
    AtexProductionPlanning.prototype.runPlanning = function(actionsEl) {
        var self = this;
        if (this.busy) return;

        var MSG_CONFIRM = 'Перезаписать очередь автопланированием?';

        function doRun() {
            var plan = planQueues(self.cuts, self.changeTimes);

            // Отбираем резки с изменившейся очерёдностью.
            var cutsById = {};
            self.cuts.forEach(function(c) { cutsById[String(c.id)] = c; });
            var changed = plan.filter(function(p) {
                var cut = cutsById[String(p.cutId)];
                return cut && Number(cut.sequence) !== p.sequence;
            });

            if (!changed.length) {
                self.notify('Очередь уже оптимальна, изменений нет', 'info');
                return;
            }

            self.saveSequences(changed, { silent: true }).then(function(ok) {
                // saveSequences уже вызвал reload+render; добавляем итоговое уведомление только при успехе.
                if (ok) self.notify('Запланировано: ' + plan.length + ' резок (изменено ' + changed.length + ')', 'success');
            });
        }

        // Подтверждение без native confirm (общий хелпер confirmAction).
        self.confirmAction(MSG_CONFIRM, actionsEl, 'Да, перезаписать', doRun);
    };

    // ── Рендеринг ──

    AtexProductionPlanning.prototype.render = function() {
        this.renderForm();
        this.renderQueue();
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
        var d = this.draft;
        var form = this.formEl;
        form.innerHTML = '';
        form.appendChild(el('h2', { class: 'atex-pp-form-title', text: 'Новая производственная резка' }));
        form.appendChild(el('p', { class: 'atex-pp-hint', text: 'Номер присваивается автоматически при сохранении.' }));

        form.appendChild(field('Станок', this.selectRef(this.slitters, d.slitterId, '— выберите станок —',
            function(v) { d.slitterId = v; }, reqIdByName(this.meta.cut, CUT_REQ.slitter))));
        // Поле «Партия сырья» убрано (#3120 Фаза 2): материал/сырьё резки определяются
        // по обеспечиваемым позициям (resolveCutMaterials), а расход — записями
        // «Расход сырья» (FIFO-резерв). Прямая ссылка на партию в форме больше не нужна.

        var dateInput = el('input', { class: 'atex-pp-input', type: 'date' });
        dateInput.value = d.planDate || '';
        dateInput.addEventListener('input', function() { d.planDate = dateInput.value; });
        form.appendChild(field('Дата плана', dateInput));

        form.appendChild(field('Статус', this.selectText(CUT_STATUSES, d.status, function(v) { d.status = v; })));

        var notes = el('textarea', { class: 'atex-pp-input atex-pp-textarea', rows: '2' });
        notes.value = d.notes || '';
        notes.addEventListener('input', function() { d.notes = notes.value; });
        form.appendChild(field('Примечания', notes));

        var actions = el('div', { class: 'atex-pp-actions' });
        var createBtn = el('button', { class: 'atex-pp-btn atex-pp-btn-primary', type: 'button', text: 'Создать резку' });
        createBtn.addEventListener('click', function() { self.createCut(); });
        actions.appendChild(createBtn);

        var planBtn = el('button', { class: 'atex-pp-btn', type: 'button', text: 'Запланировать' });
        planBtn.addEventListener('click', function() { self.runPlanning(actions); });
        actions.appendChild(planBtn);

        var genBtn = el('button', { class: 'atex-pp-btn', type: 'button', text: 'Сгенерировать резки' });
        genBtn.addEventListener('click', function() { self.generateCuts(actions); });
        actions.appendChild(genBtn);

        form.appendChild(actions);
    };

    AtexProductionPlanning.prototype.renderQueue = function() {
        var self = this;
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

        // Базовая видимость очереди: не «Завершён», заказ согласован, дата плана = выбранной/пустая.
        var visible = (this.cuts || []).filter(function(c) { return isCutVisible(c, self.filter.date); });
        var filtered = filterCuts(visible, this.filter);
        var groups = groupBySlitter(filtered);

        if (!groups.length) {
            box.appendChild(el('div', { class: 'atex-pp-empty', text: 'Резок в очереди нет' }));
            return;
        }

        // Закладки по станкам (#3116 п.2): один таб на станок, контент — резки
        // только активного станка. Активный таб в this.activeSlitter (ключ как в
        // groupBySlitter); если выбранного среди групп нет — берём первый.
        function groupKey(g) { return g.slitter.id == null ? ' none' : String(g.slitter.id); }
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
            var maxF = 0;
            (self.supplies || []).forEach(function(s) {
                if (String(s.cutId) === String(c.id)) {
                    var f = Number(self.footageBySupply && self.footageBySupply[String(s.id)]) || 0;
                    if (f > maxF) maxF = f;
                }
            });
            runLenByCut[String(c.id)] = maxF;
        });
        var schedById = {};
        var schedule = buildSchedule(activeGroup.cuts, { windPoints: windPoints, times: self.changeTimes, runLengthByCut: runLenByCut });
        schedule.forEach(function(sc) { schedById[sc.cutId] = sc; });
        // Уборка в конце рабочего дня (#3155): блок после последней резки каждого дня.
        var cleanupByDay = {};
        dayCleanups(schedule, { cleanupMin: self.changeTimes && self.changeTimes.CLEANUP_SHIFT })
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

            var info = el('div', { class: 'atex-pp-cut-info' }, [
                el('span', { class: 'atex-pp-cut-num', text: '№ ' + (c.number || c.id) }),
                el('span', { class: 'atex-pp-cut-seq', text: 'Очер.: ' + (c.sequence != null && !isNaN(c.sequence) ? c.sequence : '—') }),
                el('span', { class: 'atex-pp-cut-batch', text: c.materialBatch.label || '' }),
                el('span', { class: 'atex-pp-cut-date', text: c.planDate || '' }),
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
            var sc = schedById[String(c.id)];
            if (sc) {
                cardPanel.appendChild(el('div', { class: 'atex-pp-cut-time',
                    text: '⏱ ' + formatClock(sc.startMin) + ' – ' + formatClock(sc.finishMin) +
                          ' · ' + sc.durationMin + ' мин' }));
            }

            var controls = el('div', { class: 'atex-pp-cut-controls' });
            var up = el('button', { class: 'atex-pp-move', type: 'button', text: '↑', title: 'Выше' });
            var down = el('button', { class: 'atex-pp-move', type: 'button', text: '↓', title: 'Ниже' });
            if (idx === 0) up.disabled = true;
            if (idx === activeGroup.cuts.length - 1) down.disabled = true;
            up.addEventListener('click', function() {
                if (self.busy) return;
                var p = moveInQueue(activeGroup.cuts, idx, -1);
                if (p.length) self.saveSequences(p);
            });
            down.addEventListener('click', function() {
                if (self.busy) return;
                var p = moveInQueue(activeGroup.cuts, idx, 1);
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

            // Уборка в конце дня (#3155): после последней резки дня (день следующей резки
            // отличается либо это последняя резка очереди) — строка-маркер уборки.
            var nextSc = schedById[String((activeGroup.cuts[idx + 1] || {}).id)];
            var thisDay = schedDay(sc);
            if (sc && thisDay != null && (idx === activeGroup.cuts.length - 1 || schedDay(nextSc) !== thisDay)) {
                var cl = cleanupByDay[thisDay];
                if (cl) {
                    groupEl.appendChild(el('div', { class: 'atex-pp-cleanup',
                        text: '🧹 Уборка после смены · ' + formatClock(cl.startMin) + ' – ' + formatClock(cl.finishMin) +
                              ' · ' + cl.durationMin + ' мин' }));
                }
            }
        });
        box.appendChild(groupEl);
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

        box.appendChild(el('p', { class: 'atex-pp-hint', text: 'Резка № ' + (cut.number || cut.id) + ' · ' + ((cut.materialBatch && cut.materialBatch.label) || '') }));

        var draft = { positionId: '', footage: '', status: SUPPLY_STATUSES[0] };

        box.appendChild(field('Позиция заказа', this.selectRef(this.positions, '', '— выберите позицию —',
            function(v) { draft.positionId = v; }, null, { cacheKey: 'positions' })));

        var footage = el('input', { class: 'atex-pp-input', type: 'number', min: '0', step: 'any', placeholder: 'например, 1200' });
        footage.addEventListener('input', function() { draft.footage = footage.value; });
        box.appendChild(field('Метраж, м', footage));

        box.appendChild(field('Статус обеспечения', this.selectText(SUPPLY_STATUSES, draft.status, function(v) { draft.status = v; })));

        var actions = el('div', { class: 'atex-pp-actions' });
        var linkBtn = el('button', { class: 'atex-pp-btn atex-pp-btn-primary', type: 'button', text: 'Привязать к резке' });
        linkBtn.addEventListener('click', function() {
            self.createSupply({ positionId: draft.positionId, cutId: cut.id, footage: draft.footage, status: draft.status });
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
                var del = el('button', { class: 'atex-pp-linked-del', type: 'button', text: '×', title: 'Убрать из резки' });
                del.addEventListener('click', function() { self.deleteSupply(s.id); });
                listWrap.appendChild(el('div', { class: 'atex-pp-linked-item' }, [
                    el('span', { class: 'atex-pp-linked-label', text: posById[s.positionId] || ('позиция #' + s.positionId) }),
                    del
                ]));
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

        // Шапка очереди: заголовок слева + кнопка «+ Новая резка» справа вверху.
        var addBtn = el('button', { class: 'atex-pp-btn atex-pp-btn-primary atex-pp-add', type: 'button', text: '+ Новая резка' });
        addBtn.addEventListener('click', function() { self.openForm(); });
        var queueHead = el('div', { class: 'atex-pp-panel-head' }, [
            el('h2', { class: 'atex-pp-form-title', text: 'Очередь резок по станкам' }),
            addBtn
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
        if (typeof document !== 'undefined') {
            document.addEventListener('keydown', function(e) {
                if ((e.key === 'Escape' || e.keyCode === 27) && self.modalEl && self.modalEl.classList.contains('is-open')) self.closeForm();
            });
        }
        this.toastHost = this.root;

        this.queueEl.appendChild(el('div', { class: 'atex-pp-loading', text: 'Загрузка…' }));

        return this.loadMetadata()
            .then(function() {
                return Promise.all([
                    self.loadSlittersWithStop().then(function(items) { self.slitters = items; }),
                    self.loadMaterialBatches(),
                    self.loadBatchMaterialMap(),
                    self.loadPositions(),  // заполняет genPositions (с dueKey) тоже
                    self.loadGenBatches(), // FIFO-партии для генерации резок
                    self.loadJumboWidths(),// ширина джамбо по сырью (для cut-layout)
                    self.loadOperationTimes(), // времена переналадок (веса очереди)
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
        var controller = new AtexProductionPlanning(root);
        root._atexProductionPlanning = controller;
        controller.start();
    }

    return { planning: planning, Controller: AtexProductionPlanning, init: init };
});
