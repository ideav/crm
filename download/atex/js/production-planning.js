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
    var LAYOUT_TOLERANCE = 0; // допуск остатка джамбо (мм) для бейджа «в допуске»

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
    // привязки. Подпись: «№<номер> · <ширина>мм» (ширина пропускается, если пустая).
    // Прежняя метка использовала колонку position_cut_type, удалённую в F2 (упразднён
    // «Тип резки») — теперь подпись строится из номера позиции и ширины.
    function rowsToPositions(rows) {
        return (rows || []).map(function(row) {
            var id = row.position_id == null ? '' : String(row.position_id);
            var no = row.position_no == null ? '' : String(row.position_no).trim();
            var width = row.position_width == null ? '' : String(row.position_width).trim();
            var label = '№' + no + (width !== '' ? ' · ' + width + 'мм' : '');
            return { id: id, label: label };
        });
    }

    // Строки отчёта positions_list (JSON_KV) → [{ id, materialId, width, qty, dueKey }]
    // для генерации резок. position_material_id (добавлен в отчёт), position_width,
    // position_qty → числа; пустые значения → 0/'' но объект всегда присутствует.
    // dueKey — числовой ключ «Срока изготовления» (position_due_date) через
    // batchDateKey (для оконного отбора по сроку при генерации); нет срока → Infinity.
    function rowsToGenPositions(rows) {
        return (rows || []).map(function(row) {
            return {
                id: row.position_id == null ? '' : String(row.position_id),
                materialId: row.position_material_id == null ? '' : String(row.position_material_id),
                width: Number(row.position_width) || 0,
                qty: Number(row.position_qty) || 0,
                dueKey: batchDateKey(row.position_due_date)
            };
        });
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

    // Приоритет планирования: правь эти числа (10..100), чтобы изменить важность.
    // Больше — тем дороже соответствующая переналадка. Сырьё>намотка>партия>остаток>ножи>ширина.
    var PLANNING_WEIGHTS = { material: 100, winding: 70, batch: 50, remainder: 40, knife: 25, width: 10 };
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

    // Стоимость перехода prev→next: взвешенная сумма нормированных компонент. weights по умолчанию PLANNING_WEIGHTS.
    function changeoverCost(prev, next, weights){
        var w = weights || PLANNING_WEIGHTS;
        var cost = 0;
        cost += (w.material || 0) * (String(prev.materialId) !== String(next.materialId) ? 1 : 0);
        cost += (w.winding || 0) * (normWinding(prev.winding) !== normWinding(next.winding) ? 1 : 0);
        var batchChange = String(prev.batchId) !== String(next.batchId);
        cost += (w.batch || 0) * (batchChange ? 1 : 0);
        cost += (w.remainder || 0) * ((batchChange && awkwardRemainder(prev.jumboRemainingM)) ? 1 : 0);
        var knifeDist = Math.abs((Number(prev.knifeCount) || 0) - (Number(next.knifeCount) || 0))
                      + widthSetDistance(prev.knifeWidths, next.knifeWidths);
        cost += (w.knife || 0) * Math.min(1, knifeDist / KNIFE_SCALE);
        var drop = Math.max(0, (Number(prev.rollerWidth) || 0) - (Number(next.rollerWidth) || 0));
        cost += (w.width || 0) * Math.min(1, drop / WIDTH_SCALE);
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
    // Упорядочить резки станка: не-Фольга жадно, затем Фольга жадно; проставить sequence; вход не мутировать.
    function orderCuts(cuts, weights){
        var rest = [], foil = [];
        (cuts || []).forEach(function(c){ (c && c.isFoil ? foil : rest).push(c); });
        var seq = greedySequence(rest, weights).concat(greedySequence(foil, weights));
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
        batchDateKey: batchDateKey,
        rowsToBatches: rowsToBatches,
        PLANNING_WEIGHTS: PLANNING_WEIGHTS,
        KNIFE_SCALE: KNIFE_SCALE,
        WIDTH_SCALE: WIDTH_SCALE,
        REMAINDER_OK_M: REMAINDER_OK_M,
        normWinding: normWinding,
        widthSetDistance: widthSetDistance,
        awkwardRemainder: awkwardRemainder,
        changeoverCost: changeoverCost,
        greedySequence: greedySequence,
        orderCuts: orderCuts,
        planQueues: planQueues,
        moveInQueue: moveInQueue,
        unsuppliedPositions: unsuppliedPositions,
        pickSlitter: pickSlitter,
        pickBatchFIFO: pickBatchFIFO,
        aggregateStrips: aggregateStrips
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
        this.busy = false;
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
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            self.genBatches = (rows || []).map(function(rec) {
                var r = rec.r || [];
                var mat = matIdx >= 0 ? parseRef(r[matIdx]) : { id: null };
                return {
                    id: String(rec.i),
                    materialId: mat.id ? String(mat.id) : '',
                    dateKey: dateIdx >= 0 ? batchDateKey(r[dateIdx]) : Infinity,
                    remainder: remIdx >= 0 ? (Number(r[remIdx]) || 0) : 0
                };
            });
        });
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
        if (!meta) { this.jumboWidthByMaterial = {}; return Promise.resolve(); }
        var widthIdx = columnIndex(meta, 'Ширина, мм');
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            var map = {};
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                map[String(rec.i)] = widthIdx >= 0 ? (Number(r[widthIdx]) || 0) : 0;
            });
            self.jumboWidthByMaterial = map;
        });
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

    AtexProductionPlanning.prototype.reload = function() {
        var self = this;
        // Полосы перечитываем перед очередью, чтобы knifeCount/knifeWidths влились в свежие резки.
        return this.loadCutStrips().then(function() { return self.loadPlanning(); });
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
                    options: { windowDays: WINDOW_DAYS, tolerance: LAYOUT_TOLERANCE }
                });
                (res.layouts || []).forEach(function(lay) { lay.mat = mat; allLayouts.push(lay); });
                (res.skipped || []).forEach(function(s) { skipped.push(s); });
            });

            if (!allLayouts.length) {
                self.notify('Нет необеспеченных позиций для генерации (пропущено ' + skipped.length + ')', 'info');
                return;
            }

            // Счётчики для подтверждения.
            var nCuts = allLayouts.length;
            var nStrips = 0;
            allLayouts.forEach(function(lay) {
                (lay.strips || []).forEach(function(s) { nStrips += (Number(s.qty) || 0); });
            });
            var msg = 'Создать ' + nCuts + ' резок под необеспеченные позиции (раскладок ' + nCuts +
                ', полос ' + nStrips + ')? Пропущено ' + skipped.length + '.';

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
            status: reqIdByName(supplyMeta, SUPPLY_REQ.status)
        };

        // Сид баланса станков из текущих резок (счётчик по slitterId).
        var loadBySlitterId = {};
        (this.cuts || []).forEach(function(c) {
            var sid = c && c.slitter && c.slitter.id;
            if (sid != null) loadBySlitterId[String(sid)] = (loadBySlitterId[String(sid)] || 0) + 1;
        });

        var nStrips = 0;
        var nPositions = 0;

        this.setBusy(true);
        var chain = Promise.resolve();
        layouts.forEach(function(lay) {
            chain = chain.then(function() {
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
                                var fields = buildFields(supplyReqIds, {
                                    cut: cutId,
                                    status: SUPPLY_STATUSES[0]
                                });
                                return self.post('_m_new/' + supplyMeta.id + '?JSON&up=' + encodeURIComponent(positionId), fields)
                                    .then(function() { nPositions += 1; });
                            });
                        });
                        return supChain;
                    });
                });
            });
        });

        chain.then(function() {
            return self.reload();
        }).then(function() {
            self.setBusy(false);
            self.render();
            var reasons = self.groupSkipReasons(skipped);
            self.notify('Создано ' + layouts.length + ' резок, полос ' + nStrips +
                ', пропущено ' + skipped.length + ' позиций' + (reasons ? ' (' + reasons + ')' : ''), 'success');
        }).catch(function(err) {
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
            var plan = planQueues(self.cuts);

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
        // Партии предзагружены отчётом material_batches (обогащённые подписи) —
        // статический клиентский список (как дропдаун позиций), без серверного
        // поиска, иначе при вводе подпись свелась бы к голому номеру.
        form.appendChild(field('Партия сырья', this.selectRef(this.materialBatches, d.materialBatchId, '— не выбрано —',
            function(v) { d.materialBatchId = v; }, null, { cacheKey: 'batches' })));

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

        // Панель фильтров.
        var filters = el('div', { class: 'atex-pp-filters' });
        var slitterFilter = this.selectRef(this.slitters, this.filter.slitter, 'Все станки',
            function(v) { self.filter.slitter = v; self.renderQueue(); },
            reqIdByName(this.meta.cut, CUT_REQ.slitter),
            { clearOnInput: false });
        var statusFilter = this.selectText([''].concat(CUT_STATUSES), this.filter.status, function(v) { self.filter.status = v; self.renderQueue(); });
        // первый пункт статуса — «все»
        statusFilter.options[0].textContent = 'Все статусы';
        var dateFilter = el('input', { class: 'atex-pp-input', type: 'date', value: this.filter.date || '' });
        dateFilter.addEventListener('change', function() { self.filter.date = dateFilter.value; self.renderQueue(); });
        filters.appendChild(field('Станок', slitterFilter));
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

        groups.forEach(function(g) {
            var groupEl = el('div', { class: 'atex-pp-queue-group' });
            groupEl.appendChild(el('div', { class: 'atex-pp-queue-head' }, [
                el('span', { class: 'atex-pp-queue-slitter', text: g.slitter.label }),
                el('span', { class: 'atex-pp-queue-count', text: g.cuts.length + ' рез.' })
            ]));
            g.cuts.forEach(function(c, idx) {
                var active = String(self.selectedCutId) === String(c.id);
                var supplies = self.supplyCount(c.id);
                var card = el('button', { class: 'atex-pp-cut' + (active ? ' is-active' : ''), type: 'button' }, [
                    el('span', { class: 'atex-pp-cut-num', text: '№ ' + (c.number || c.id) }),
                    el('span', { class: 'atex-pp-cut-seq', text: 'Очер.: ' + (c.sequence != null && !isNaN(c.sequence) ? c.sequence : '—') }),
                    el('span', { class: 'atex-pp-cut-batch', text: c.materialBatch.label || '' }),
                    el('span', { class: 'atex-pp-cut-date', text: c.planDate || '' }),
                    el('span', { class: 'atex-pp-cut-status', text: c.status || '' }),
                    el('span', { class: 'atex-pp-cut-supplies', text: supplies ? ('связей: ' + supplies) : 'нет связей' })
                ]);
                card.addEventListener('click', function() { self.selectedCutId = c.id; self.render(); });

                var row = el('div', { class: 'atex-pp-cut-row' });
                var up = el('button', { class: 'atex-pp-move', type: 'button', text: '↑' });
                var down = el('button', { class: 'atex-pp-move', type: 'button', text: '↓' });
                if (idx === 0) up.disabled = true;
                if (idx === g.cuts.length - 1) down.disabled = true;
                up.addEventListener('click', function() {
                    if (self.busy) return;
                    var p = moveInQueue(g.cuts, idx, -1);
                    if (p.length) self.saveSequences(p);
                });
                down.addEventListener('click', function() {
                    if (self.busy) return;
                    var p = moveInQueue(g.cuts, idx, 1);
                    if (p.length) self.saveSequences(p);
                });
                row.appendChild(up);
                row.appendChild(card);
                row.appendChild(down);
                groupEl.appendChild(row);
            });
            box.appendChild(groupEl);
        });
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
                listWrap.appendChild(el('div', { class: 'atex-pp-linked-item', text: posById[s.positionId] || ('позиция #' + s.positionId) }));
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

    AtexProductionPlanning.prototype.fatal = function(message) {
        this.root.innerHTML = '';
        this.root.appendChild(el('div', { class: 'atex-pp-fatal', text: message }));
    };

    AtexProductionPlanning.prototype.start = function() {
        var self = this;
        this.root.innerHTML = '';
        var layout = el('div', { class: 'atex-pp-layout' });
        this.formEl = el('section', { class: 'atex-pp-panel atex-pp-form' });
        var queueWrap = el('section', { class: 'atex-pp-panel atex-pp-queue-panel' }, [
            el('h2', { class: 'atex-pp-form-title', text: 'Очередь резок по станкам' })
        ]);
        this.queueEl = el('div', { class: 'atex-pp-queue' });
        queueWrap.appendChild(this.queueEl);
        this.linkEl = el('section', { class: 'atex-pp-panel atex-pp-link' });
        layout.appendChild(this.formEl);
        layout.appendChild(queueWrap);
        layout.appendChild(this.linkEl);
        this.root.appendChild(layout);
        this.toastHost = this.root;

        this.formEl.appendChild(el('div', { class: 'atex-pp-loading', text: 'Загрузка…' }));

        return this.loadMetadata()
            .then(function() {
                return Promise.all([
                    self.loadSlittersWithStop().then(function(items) { self.slitters = items; }),
                    self.loadMaterialBatches(),
                    self.loadBatchMaterialMap(),
                    self.loadPositions(),  // заполняет genPositions (с dueKey) тоже
                    self.loadGenBatches(), // FIFO-партии для генерации резок
                    self.loadJumboWidths(),// ширина джамбо по сырью (для cut-layout)
                    // Полосы перед очередью: knifeCount/knifeWidths вливаются в резки в loadPlanning.
                    self.loadCutStrips().then(function() { return self.loadPlanning(); })
                ]);
            })
            .then(function() { self.render(); })
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
