// Рабочее место atex «Пульт слиттера» (роль Оператор, планшет).
//
// По назначенной производственной резке оператор: меняет статус
// (Ожидает → Наладка → В работе → Завершён), вводит показания счётчика
// (нач./кон.), погонаж факт и брак; списывает расход сырья по партиям (FIFO),
// что уменьшает остаток партии; фиксирует события смены с датой/временем.
// Решение задачи ideav/crm#2915 (часть #2903). Правила разработки рабочих мест —
// docs/WORKSPACE_DEVELOPMENT_GUIDE.md, карта рабочих мест — docs/atex_workplaces.md §3.5.
//
// На этом этапе рабочее место обращается к данным напрямую командами `_m_*`
// (#2903): статус/счётчики/погонаж/брак — `_m_set/{резкаId}`; расход —
// `_m_new/{Расход сырья}` с `up={резкаId}` (и `_m_set` остатка партии); событие —
// `_m_new/{Событие смены}`; список резок строится из `object/{Задание в производство}/`
// с фильтром по выбранным слиттеру/дате. ID таблиц и реквизитов не хардкодятся: они
// берутся по именам из `GET /{db}/metadata` (WORKSPACE_DEVELOPMENT_GUIDE.md,
// разделы 3 и 6). Перевод чтений на защищённый слой `report/` — следующий этап и
// в объём этой задачи не входит.
//
// Чистое ядро (цепочка статусов, FIFO-подбор партий, списание остатка, погонаж
// из счётчиков, формат даты события) вынесено в объект `core` и экспортируется
// через module.exports для модульных тестов (experiments/atex-slitter.test.js).

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.AtexSlitter = api;
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
        consumption: 'Расход сырья',
        event: 'Событие смены',
        batch: 'Партия сырья',
        material: 'Вид сырья',
        slitter: 'Слиттер',
        finishedBatch: 'Партия ГП'   // #3433: состав резки — для записи факт. рулонов
    };
    // #3433: реквизиты «Партии ГП» (состав резки, up = резка), нужные слиттеру для
    // записи факта: «Кол-во полос» (за проход) и «Кол-во факт» (произведённые рулоны).
    var FINISHED_BATCH_REQ = { strips: 'Кол-во полос', actual: 'Кол-во факт' };
    // #3460: геометрия раскладки ножей берётся из «Партии ГП» (состав резки):
    // «Кол-во полос» — число ножей за проход, «Ширина, мм» — ширина полосы.
    var STRIP_REQ = { width: 'Ширина, мм', qty: 'Кол-во полос', purpose: 'Назначение' };
    var CUT_REQ = {
        slitter: 'Слиттер',
        batch: 'Партия сырья',
        planDate: 'Дата план',
        status: 'Статус',
        counterStart: 'Счётчик нач.',
        counterEnd: 'Счётчик кон.',
        meterage: 'Погонаж факт, м',
        defect: 'Брак, м²',
        defectM: 'Брак, м',
        defectPhoto: 'Фото брака',
        sequence: 'Очередность',
        plannedRuns: 'Кол-во план',
        runLength: 'Метраж, м',
        startedAt: 'Начато',
        notes: 'Примечания'
    };
    var CUT_PLANNED_RUNS_NAMES = ['Кол-во резок план', 'Кол-во план'];
    var CUT_RUN_LENGTH_NAMES = ['Метраж, м', 'Погонаж план, м', 'Длина, м'];
    var CUT_STARTED_NAMES = ['Начато', 'Дата начала', 'Старт', 'Время начала'];
    var CONS_REQ = { amount: 'Израсходовано, м²', batch: 'Партия сырья' };
    var EVENT_REQ = { type: 'Тип события', cut: 'Задание в производство', user: 'Пользователь', value: 'Значение', notes: 'Примечания' }; // #3504: реквизит «Событие смены» переименован вслед за таблицей
    var BATCH_REQ = {
        kind: 'Вид сырья',
        date: 'Дата прихода',
        received: 'Получено, м²',
        remainder: 'Остаток, м²',
        remainderM: 'Остаток, м',
        active: 'В работе',
        barcode: 'Штрих-код'
    };
    var MATERIAL_REQ = { width: 'Ширина, мм' };

    // Статусы резки по дизайн-спеке atex (§3.5): упрощённая цепочка (#3459).
    // Ожидает → В работе → Завершена (Наладка убрана, оператор запускает резку сразу).
    var STATUSES = ['Ожидает', 'В работе', 'Завершена'];
    var DONE_STATUSES = ['Завершена', 'Завершён', 'Готова'];
    var WAIT_STATUSES = ['Ожидает', 'Запланирована', 'В очереди'];
    // Типы событий смены (дизайн-спека atex, «Событие смены»).
    var EVENT_TYPES = ['Начало смены', 'Запуск резки', 'Пауза', 'Обед', 'Переналадка', 'Счётчик', 'Брак', 'Завершение резки', 'Пропуск', 'Отмена', 'Конец смены'];

    // ───────────────────────── Чистое ядро ─────────────────────────

    // Терпимый разбор числа: принимает запятую как десятичный разделитель,
    // отбрасывает пробелы; «пусто»/мусор → 0.
    function toNumber(value) {
        if (typeof value === 'number') return isFinite(value) ? value : 0;
        var text = String(value == null ? '' : value).replace(/\s+/g, '').replace(',', '.');
        var n = parseFloat(text);
        return isFinite(n) ? n : 0;
    }

    function round3(n) {
        return Math.round(n * 1000) / 1000;
    }

    // Приведение статуса к одному из известных; неизвестное возвращается как есть
    // (значение «Статус» — свободный текст, сохраняем без потерь).
    function normalizeStatus(status) {
        var s = String(status == null ? '' : status).trim();
        if (!s) return STATUSES[0];
        for (var i = 0; i < STATUSES.length; i++) {
            if (STATUSES[i].toLowerCase() === s.toLowerCase()) return STATUSES[i];
        }
        return s;
    }

    // Следующий статус в цепочке Ожидает → Наладка → В работе → Завершён.
    // На финальном (или неизвестном) статусе возвращает текущий — двигаться некуда.
    function nextStatus(status) {
        var s = normalizeStatus(status);
        var idx = STATUSES.indexOf(s);
        if (idx === -1 || idx === STATUSES.length - 1) return s;
        return STATUSES[idx + 1];
    }

    // Резка завершена?
    function isDone(status) {
        return statusIn(status, DONE_STATUSES);
    }

    // Погонаж из показаний счётчика: кон. − нач., не меньше нуля (счётчик не
    // мотает назад; при пустом/обратном вводе подсказка = 0).
    function meterageFromCounters(start, end) {
        return round3(Math.max(0, toNumber(end) - toNumber(start)));
    }

    // #3433: фактическое число проходов резки из погонажа факт ÷ метраж прогона
    // (округление до целого прохода). Нет данных по погонажу/метражу → фолбэк на план
    // (чтобы факт хотя бы не был нулём при завершении без замеров). Пусто → 0.
    function actualRunsFromMeterage(meterageFact, runLength, plannedRuns) {
        var m = toNumber(meterageFact);
        var rl = toNumber(runLength);
        if (m > 0 && rl > 0) return Math.round(m / rl);
        var pr = toNumber(plannedRuns);
        return pr > 0 ? pr : 0;
    }

    // #3433: фактически произведённые рулоны полосы = полос за проход × факт. проходов.
    // Пусто/0 полос или 0 проходов → '' (поле «Кол-во факт» не пишем).
    function actualRollsForStrip(stripsPerPass, actualRuns) {
        var s = toNumber(stripsPerPass);
        var runs = toNumber(actualRuns);
        if (!(s > 0) || !(runs > 0)) return '';
        return round3(s * runs);
    }

    // Сумма израсходованного по строкам расхода (для сводки по резке).
    function sumConsumption(rows) {
        var total = 0;
        (rows || []).forEach(function(r) { total += toNumber(r.amount); });
        return round3(total);
    }

    // Сортировка партий по дате прихода (FIFO: раньше пришло — раньше расходуем).
    // Стабильная: при равных датах сохраняет исходный порядок.
    function sortFifo(batches) {
        return (batches || []).map(function(b, i) { return { b: b, i: i }; })
            .sort(function(a, c) {
                var da = String(a.b.date || '');
                var dc = String(c.b.date || '');
                if (da < dc) return -1;
                if (da > dc) return 1;
                return a.i - c.i;
            })
            .map(function(x) { return x.b; });
    }

    // Партия по умолчанию для нового расхода: первая по FIFO с положительным
    // остатком. Если таких нет — null (нечего списывать).
    function pickFifoBatch(batches) {
        var ordered = sortFifo(batches);
        for (var i = 0; i < ordered.length; i++) {
            if (toNumber(ordered[i].remainder) > 0) return ordered[i];
        }
        return null;
    }

    // Новый остаток партии после списания: остаток − израсходовано, не ниже нуля.
    function applyConsumption(remainder, consumed) {
        return round3(Math.max(0, toNumber(remainder) - toNumber(consumed)));
    }

    // Возврат остатка при отмене/уменьшении расхода: остаток + возвращаемое.
    function restoreConsumption(remainder, restored) {
        return round3(toNumber(remainder) + toNumber(restored));
    }

    // Брак в м²: метры брака × ширина сырья (мм → м). Любой нуль → 0.
    function defectM2(defectMeters, widthMm) {
        var m = toNumber(defectMeters);
        var w = toNumber(widthMm);
        if (m <= 0 || w <= 0) return 0;
        return round3(m * (w / 1000));
    }

    // Ключ multipart-поля для файлового реквизита: 't' + reqId (или '' если нет).
    function photoFieldKey(reqId) {
        return reqId ? ('t' + reqId) : '';
    }

    function statusIn(status, list) {
        var s = normalizeStatus(status).toLowerCase();
        return (list || []).some(function(item) { return String(item).toLowerCase() === s; });
    }

    function isWaitingStatus(status) {
        return statusIn(status, WAIT_STATUSES);
    }

    function isPauseStatus(status) {
        var s = normalizeStatus(status).toLowerCase();
        return s === 'пауза' || s === 'на паузе';
    }

    function truthyFlag(value) {
        if (value === true) return true;
        if (value === false || value == null) return false;
        if (typeof value === 'number') return isFinite(value) && value !== 0;
        var s = String(value).trim().toLowerCase();
        if (!s) return false;
        return !(s === '0' || s === 'false' || s === 'нет' || s === 'no' || s === 'off' || s === 'неактивно');
    }

    function isActiveBatch(batch) {
        if (!batch || batch.active === undefined || batch.active === null || String(batch.active).trim() === '') return true;
        return truthyFlag(batch.active);
    }

    function pad2(n) {
        return (n < 10 ? '0' : '') + n;
    }

    function todayISO(date) {
        var d = date instanceof Date ? date : new Date();
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    // Календарный ключ YYYYMMDD: ISO, ДД.ММ.ГГГГ/ДД/ММ/ГГГГ, unix seconds/ms.
    function dateKey(value) {
        var s = String(value == null ? '' : value).trim();
        if (!s) return Infinity;
        var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return Number(iso[1]) * 10000 + Number(iso[2]) * 100 + Number(iso[3]);
        var dmy = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
        if (dmy) return Number(dmy[3]) * 10000 + Number(dmy[2]) * 100 + Number(dmy[1]);
        if (/^\d{9,13}$/.test(s)) {
            var num = Number(s);
            var ms = num >= 1e12 ? num : num * 1000;
            var d = new Date(ms);
            if (!isNaN(d.getTime()) && d.getFullYear() >= 2001 && d.getFullYear() <= 2100) {
                return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
            }
        }
        var parsed = Date.parse(s);
        if (!isNaN(parsed)) {
            var dt = new Date(parsed);
            return dt.getFullYear() * 10000 + (dt.getMonth() + 1) * 100 + dt.getDate();
        }
        return Infinity;
    }

    function cutSlitterId(cut) {
        if (!cut) return '';
        if (cut.slitterId != null) return String(cut.slitterId);
        if (cut.slitter && cut.slitter.id != null) return String(cut.slitter.id);
        return '';
    }

    function cutStartedValue(cut) {
        if (!cut) return '';
        return String(cut.startedAt || cut.started || cut.actualStart || '').trim();
    }

    function sequenceKey(cut) {
        var n = Number(cut && cut.sequence);
        return isFinite(n) ? n : Infinity;
    }

    function compareCutsForQueue(a, b) {
        var ad = isDone(a && a.status), bd = isDone(b && b.status);
        if (ad !== bd) return ad ? 1 : -1;
        var aw = isWaitingStatus(a && a.status) && !cutStartedValue(a);
        var bw = isWaitingStatus(b && b.status) && !cutStartedValue(b);
        if (aw !== bw) return aw ? -1 : 1;
        var as = sequenceKey(a), bs = sequenceKey(b);
        if (as !== bs) return as - bs;
        var ak = dateKey(a && a.planDate), bk = dateKey(b && b.planDate);
        if (ak !== bk) return ak - bk;
        return String((a && a.id) || '').localeCompare(String((b && b.id) || ''), 'ru');
    }

    function prepareCutQueue(cuts, opts) {
        var o = opts || {};
        var selectedSlitterId = o.slitterId == null ? '' : String(o.slitterId);
        var selectedDateKey = o.date ? dateKey(o.date) : Infinity;
        var list = (cuts || []).filter(function(cut) {
            if (selectedSlitterId && cutSlitterId(cut) !== selectedSlitterId) return false;
            if (selectedDateKey !== Infinity && dateKey(cut && cut.planDate) !== selectedDateKey) return false;
            if (!o.includeDone && isDone(cut && cut.status)) return false;
            return true;
        }).map(function(cut, i) { return { cut: cut, i: i }; }).sort(function(a, b) {
            return compareCutsForQueue(a.cut, b.cut) || a.i - b.i;
        }).map(function(x) { return x.cut; });

        var firstOpen = null;
        for (var i = 0; i < list.length; i++) {
            if (!isDone(list[i].status) && isWaitingStatus(list[i].status) && !cutStartedValue(list[i])) {
                firstOpen = list[i];
                break;
            }
        }
        if (!firstOpen) {
            for (var j = 0; j < list.length; j++) {
                if (!isDone(list[j].status)) { firstOpen = list[j]; break; }
            }
        }
        return { cuts: list, firstOpenCutId: firstOpen ? String(firstOpen.id) : null };
    }

    function eventUserId(event) {
        if (!event) return '';
        if (event.userId != null) return String(event.userId);
        if (event.user && event.user.id != null) return String(event.user.id);
        if (event.operatorId != null) return String(event.operatorId);
        if (event.userRef) return parseRef(event.userRef).id || '';
        return '';
    }

    function isShiftStartType(type) {
        var s = String(type == null ? '' : type).trim().toLowerCase();
        return s === 'начало смены' || s === 'открытие смены';
    }

    function isShiftEndType(type) {
        var s = String(type == null ? '' : type).trim().toLowerCase();
        return s === 'конец смены' || s === 'закрытие смены' || s === 'завершение смены';
    }

    function eventMatchesUser(event, userId) {
        var uid = String(userId == null ? '' : userId).trim();
        if (!uid) return true;
        return eventUserId(event) === uid;
    }

    function hasOpenShift(events, userId, date) {
        var targetDay = dateKey(date || todayISO());
        var last = null;
        (events || []).forEach(function(event, i) {
            if (!eventMatchesUser(event, userId)) return;
            if (dateKey(event.when) !== targetDay) return;
            if (!isShiftStartType(event.type) && !isShiftEndType(event.type)) return;
            var order = String(event.when || '') + '#' + i;
            if (!last || order > last.order) last = { event: event, order: order };
        });
        return !!(last && isShiftStartType(last.event.type));
    }

    function runLengthForCut(cut) {
        return coreToNumber(cut && (cut.runLength || cut.length || cut.plannedRunLength));
    }

    function plannedRunsForCut(cut) {
        var runs = coreToNumber(cut && (cut.plannedRuns || cut.runCount || cut.runs));
        return runs > 0 ? Math.ceil(runs) : 1;
    }

    // Internal alias to avoid function-hoisting surprises in minifiers and keep
    // these helpers readable before `core` is assembled.
    function coreToNumber(value) {
        return toNumber(value);
    }

    function normMaterial(value) {
        return String(value == null ? '' : value).trim().toLowerCase();
    }

    // #3460: партии из отчёта могут не иметь id вида сырья — тогда сверяем по
    // названию вида сырья (batch_material). Если у резки известен id — он в
    // приоритете; иначе сравниваем по названию. Нет ориентира → пропускаем.
    function batchMatchesCut(batch, cut) {
        var cutMat = String((cut && cut.materialId) || '').trim();
        var cutLabel = normMaterial(cut && cut.materialLabel);
        if (cutMat) {
            var bid = String((batch && batch.materialId) || '').trim();
            if (bid) return bid === cutMat;
            return cutLabel ? normMaterial(batch && batch.materialLabel) === cutLabel : true;
        }
        if (cutLabel) return normMaterial(batch && batch.materialLabel) === cutLabel;
        return true;
    }

    function batchPasses(batch, cut) {
        var runLength = runLengthForCut(cut);
        if (!(runLength > 0)) return 0;
        return Math.floor(coreToNumber(batch && batch.remainderM) / runLength);
    }

    function availableBatchesForCut(batches, cut) {
        var runLength = runLengthForCut(cut);
        return sortFifo((batches || []).filter(function(batch) {
            if (!isActiveBatch(batch)) return false;
            if (!batchMatchesCut(batch, cut)) return false;
            if (!(runLength > 0)) return coreToNumber(batch && (batch.remainderM || batch.remainder)) > 0;
            return batchPasses(batch, cut) >= 1;
        }));
    }

    function batchCoverage(batches, selectedIds, cut) {
        var ids = {};
        (selectedIds || []).forEach(function(id) { ids[String(id)] = true; });
        var runLength = runLengthForCut(cut);
        var neededRuns = plannedRunsForCut(cut);
        var selected = availableBatchesForCut(batches, cut).filter(function(batch) { return ids[String(batch.id)]; });
        var coveredRuns = 0;
        var details = selected.map(function(batch) {
            var passes = batchPasses(batch, cut);
            coveredRuns += passes;
            return { id: String(batch.id), passes: passes, meters: round3(passes * runLength) };
        });
        return {
            runLength: round3(runLength),
            neededRuns: neededRuns,
            neededMeters: round3(neededRuns * runLength),
            coveredRuns: coveredRuns,
            coveredMeters: round3(coveredRuns * runLength),
            complete: coveredRuns >= neededRuns,
            batches: details
        };
    }

    // Дата-время события смены в формате «YYYY-MM-DD HH:MM:SS» (хронология,
    // первая колонка «Событие смены»). Принимает Date — детерминируется в тестах.
    function formatDateTime(date) {
        var d = (date instanceof Date) ? date : new Date(date);
        function p(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
            ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }

    // #3460: «номер» резки на самом деле — плановое время старта в unix-секундах
    // (главное значение записи, см. #3242/#3352), а в UI выводился сырым числом.
    // Распознаём штамп так же, как production-planning.js/ref-search.js: только
    // цифры, n ≥ 1e9, год 2001–2100. Короткие id и обычный текст не трогаем.
    function isTimestampSeconds(value) {
        var s = String(value == null ? '' : value).trim();
        if (!/^\d+$/.test(s)) return false;
        var n = Number(s);
        if (!isFinite(n) || n < 1000000000) return false;
        var d = new Date(n * 1000);
        if (isNaN(d.getTime())) return false;
        var year = d.getFullYear();
        return year >= 2001 && year <= 2100;
    }

    // Штамп → «ЧЧ:ММ» (требование #3460). Не-штамп возвращается как есть.
    function formatClock(value) {
        var s = String(value == null ? '' : value).trim();
        if (!isTimestampSeconds(s)) return s;
        var d = new Date(Number(s) * 1000);
        return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }

    // Штамп → «ДД.ММ.ГГГГ». Не-штамп возвращается как есть.
    function formatDate(value) {
        var s = String(value == null ? '' : value).trim();
        if (!isTimestampSeconds(s)) return s;
        var d = new Date(Number(s) * 1000);
        return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();
    }

    // Заголовок резки: штамп показываем как «Резка ЧЧ:ММ», иначе «Резка №…»
    // (пустое значение → просто «Резка»).
    function cutTitle(value) {
        var s = String(value == null ? '' : value).trim();
        if (!s) return 'Резка';
        return isTimestampSeconds(s) ? ('Резка ' + formatClock(s)) : ('Резка №' + s);
    }

    // Любую дату-подпись приводим к читаемому виду: штамп → дата, иначе как есть.
    function humanizeLabel(value) {
        return isTimestampSeconds(value) ? formatDate(value) : String(value == null ? '' : value);
    }

    // ── #3460: чистое ядро раскладки ножей (порт из cut-map.js) ──
    // Карта раскроя слиттера: каждая «полоса» даёт `qty` ножей шириной `width`.

    // «Итого ножей» = полос за проход = Σ(кол-во полос).
    function totalKnives(strips) {
        return (strips || []).reduce(function(sum, s) { return sum + toNumber(s.qty); }, 0);
    }

    // Занятая полосами ширина — Σ(ширина × количество).
    function usedWidth(strips) {
        return round3((strips || []).reduce(function(sum, s) {
            return sum + toNumber(s.width) * toNumber(s.qty);
        }, 0));
    }

    // Разворачивает полосы в последовательность сегментов-ножей с накопленным
    // смещением слева (offset) — геометрия раскладки по ширине входа.
    function expandSegments(strips) {
        var segments = [];
        var offset = 0;
        (strips || []).forEach(function(s, stripIndex) {
            var width = round3(toNumber(s.width));
            var count = Math.max(0, Math.round(toNumber(s.qty)));
            for (var k = 0; k < count; k++) {
                segments.push({
                    stripIndex: stripIndex,
                    indexInStrip: k,
                    width: width,
                    purpose: s.purpose || '',
                    label: (s.name == null ? '' : String(s.name)),
                    offset: round3(offset)
                });
                offset = round3(offset + width);
            }
        });
        return segments;
    }

    // Полная раскладка резки: сегменты ножей, занятая ширина, остаток, флаги.
    function computeLayout(inputWidth, strips, tolerance) {
        var W = round3(toNumber(inputWidth));
        var segments = expandSegments(strips);
        var used = usedWidth(strips);
        var rem = round3(W - used);
        var tol = (tolerance === undefined || tolerance === null || tolerance === '')
            ? null : Math.abs(toNumber(tolerance));
        return {
            inputWidth: W,
            usedWidth: used,
            remainder: rem,
            totalKnives: totalKnives(strips),
            stripKinds: (strips || []).length,
            segments: segments,
            overflow: rem < 0,
            tolerance: tol,
            withinTolerance: tol === null ? null : Math.abs(rem) <= tol
        };
    }

    // Доля сегмента шириной `width` в общей шкале (max ширины входа и занятой).
    function widthPercent(width, layoutResult) {
        var scale = Math.max(toNumber(layoutResult && layoutResult.inputWidth),
            toNumber(layoutResult && layoutResult.usedWidth));
        if (scale <= 0) return 0;
        return round3(toNumber(width) / scale * 100);
    }

    // Класс назначения полосы → CSS-модификатор сегмента (цвет).
    function purposeKind(purpose) {
        var p = String(purpose || '').trim().toLowerCase();
        if (p.indexOf('заказ') === 0) return 'order';
        if (p.indexOf('склад') === 0) return 'stock';
        if (p.indexOf('отход') === 0) return 'waste';
        return 'other';
    }

    // ── #3460: разбор партий сырья из защищённого отчёта report/material_batches ──
    // Имена колонок отчёта берём из production-planning.js (rowsToBatches):
    // batch_id, batch_no, batch_material, batch_remainder_m(_m2). Поле склада в
    // отчёте называется не строго заданным образом — берём первое непустое из
    // набора кандидатов. Партии со складом «Атех» помечаем foreign (другой склад —
    // показываем, но выбрать нельзя).
    function firstField(row, keys) {
        for (var i = 0; i < (keys || []).length; i++) {
            var k = keys[i];
            if (row && row[k] != null && String(row[k]).trim() !== '') return String(row[k]).trim();
        }
        return '';
    }

    function batchWarehouse(row) {
        return firstField(row, ['batch_warehouse', 'warehouse', 'batch_store', 'store', 'batch_stock', 'склад', 'Склад']);
    }

    // Совпадает ли склад партии с «чужим» (по умолчанию «Атех»)? Сравниваем
    // регистронезависимо по вхождению подстроки (склад может писаться по-разному).
    function isForeignWarehouse(name, foreignNames) {
        var s = String(name == null ? '' : name).trim().toLowerCase();
        if (!s) return false;
        var list = (foreignNames && foreignNames.length) ? foreignNames : ['атех'];
        return list.some(function(fn) { return s.indexOf(String(fn).trim().toLowerCase()) >= 0; });
    }

    function rowsToActiveBatches(rows, opts) {
        var o = opts || {};
        var foreign = o.foreignWarehouses || ['Атех'];
        return (rows || []).map(function(row) {
            var wh = batchWarehouse(row);
            var matLabel = firstField(row, ['batch_material', 'material', 'Вид сырья']);
            var matId = firstField(row, ['batch_material_id', 'material_id']);
            var label = firstField(row, ['batch_no', 'batch_barcode', 'barcode', 'batch_name', 'name']);
            return {
                id: firstField(row, ['batch_id', 'id', 'i']),
                label: label || ('Партия ' + firstField(row, ['batch_id', 'id'])),
                // Отчёт уже отсортирован по FIFO; если есть дата прихода — сохраняем
                // её для sortFifo, иначе пустая дата оставит стабильный порядок отчёта.
                date: firstField(row, ['batch_date', 'batch_arrival', 'batch_arrival_date', 'date']),
                remainder: toNumber(firstField(row, ['batch_remainder_m2', 'remainder_m2', 'batch_remainder'])),
                remainderM: toNumber(firstField(row, ['batch_remainder_m', 'remainder_m'])),
                materialId: matId || null,
                materialLabel: matLabel,
                warehouse: wh,
                foreign: isForeignWarehouse(wh, foreign),
                active: firstField(row, ['is_active', 'batch_is_active', 'active']) || '1',
                barcode: firstField(row, ['batch_barcode', 'barcode', 'batch_no'])
            };
        });
    }

    var core = {
        STATUSES: STATUSES,
        EVENT_TYPES: EVENT_TYPES,
        toNumber: toNumber,
        round3: round3,
        normalizeStatus: normalizeStatus,
        nextStatus: nextStatus,
        isDone: isDone,
        meterageFromCounters: meterageFromCounters,
        actualRunsFromMeterage: actualRunsFromMeterage,
        actualRollsForStrip: actualRollsForStrip,
        sumConsumption: sumConsumption,
        sortFifo: sortFifo,
        pickFifoBatch: pickFifoBatch,
        applyConsumption: applyConsumption,
        restoreConsumption: restoreConsumption,
        formatDateTime: formatDateTime,
        defectM2: defectM2,
        photoFieldKey: photoFieldKey,
        isWaitingStatus: isWaitingStatus,
        isPauseStatus: isPauseStatus,
        isActiveBatch: isActiveBatch,
        todayISO: todayISO,
        dateKey: dateKey,
        prepareCutQueue: prepareCutQueue,
        hasOpenShift: hasOpenShift,
        runLengthForCut: runLengthForCut,
        plannedRunsForCut: plannedRunsForCut,
        batchPasses: batchPasses,
        batchMatchesCut: batchMatchesCut,
        availableBatchesForCut: availableBatchesForCut,
        batchCoverage: batchCoverage,
        // #3460: формат времени резки и разбор партий из отчёта
        isTimestampSeconds: isTimestampSeconds,
        formatClock: formatClock,
        formatDate: formatDate,
        cutTitle: cutTitle,
        humanizeLabel: humanizeLabel,
        rowsToActiveBatches: rowsToActiveBatches,
        isForeignWarehouse: isForeignWarehouse,
        // #3460: раскладка ножей (визуализация)
        totalKnives: totalKnives,
        usedWidth: usedWidth,
        expandSegments: expandSegments,
        computeLayout: computeLayout,
        widthPercent: widthPercent,
        purposeKind: purposeKind
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

    // Значение реквизита из метаданных по имени → его числовой id (t{id}).
    function reqIdByName(meta, name) {
        var found = (meta && meta.reqs || []).filter(function(r) {
            return String(r.val).trim().toLowerCase() === String(name).trim().toLowerCase();
        })[0];
        return found ? String(found.id) : null;
    }

    function reqIdByAnyName(meta, names) {
        for (var i = 0; i < (names || []).length; i++) {
            var rid = reqIdByName(meta, names[i]);
            if (rid) return rid;
        }
        return null;
    }

    // Индекс колонки JSON_OBJ по имени реквизита. Колонки идут в порядке
    // [главное значение, ...reqs по порядку метаданных].
    function colIndex(meta, reqName) {
        var order = [String(meta.id)].concat((meta.reqs || []).map(function(r) { return String(r.id); }));
        var rid = reqIdByName(meta, reqName);
        var idx = order.indexOf(String(rid));
        return idx >= 0 ? idx : -1;
    }

    function colIndexAny(meta, reqNames) {
        for (var i = 0; i < (reqNames || []).length; i++) {
            var idx = colIndex(meta, reqNames[i]);
            if (idx >= 0) return idx;
        }
        return -1;
    }

    // Разбор значения-ссылки из JSON_OBJ: «id:Подпись» → { id, label }.
    function parseRef(raw) {
        var s = String(raw == null ? '' : raw);
        var m = s.match(/^(\d+):([\s\S]*)$/);
        if (m) return { id: m[1], label: m[2] };
        if (/^\d+$/.test(s)) return { id: s, label: s };
        return { id: null, label: s };
    }

    function AtexSlitter(root) {
        this.root = root;
        this.db = window.db || root.getAttribute('data-db') || '';
        this.userId = root.getAttribute('data-user-id') || '';
        this.meta = { cut: null, consumption: null, event: null, batch: null, material: null, slitter: null, finishedBatch: null };
        this.slitters = [];
        this.batches = [];        // справочник партий сырья [{ id, label, date, remainder, materialId }]
        this.materialWidths = {}; // { materialId: widthMm }
        this.refOptions = {};     // кеш опций searchable reference inputs по reqId
        this.cuts = [];           // производственные резки [{ id, label, status, slitter }]
        // #3460: восстанавливаем выбор станка из localStorage при открытии формы.
        this.selectedSlitterId = this.loadStoredSlitter();
        this.selectedDate = core.todayISO();
        this.includeDone = false;
        this.currentCutId = null; // выбранная резка
        this.currentCut = null;   // полная запись выбранной резки
        this.currentStrips = [];  // #3460: полосы выбранной резки (раскладка ножей)
        this.consumptions = [];   // расход сырья выбранной резки
        this.events = [];         // события смены выбранной резки
        this.shiftEvents = [];    // события смены оператора за выбранную дату
        this.selectedBatchIds = [];
        this.busy = false;
    }

    AtexSlitter.prototype.url = function(path) {
        return '/' + encodeURIComponent(this.db) + '/' + path;
    };

    // #3460: запоминаем выбор станка в localStorage (ключ скоупится по БД, чтобы
    // разные базы не пересекались). Доступ к localStorage защищён try/catch —
    // приватный режим/отключённое хранилище не должны ломать пульт.
    AtexSlitter.prototype.storageKey = function() {
        return 'atex-sl:slitter:' + (this.db || '');
    };
    AtexSlitter.prototype.loadStoredSlitter = function() {
        try {
            return (typeof window !== 'undefined' && window.localStorage &&
                window.localStorage.getItem(this.storageKey())) || '';
        } catch (e) { return ''; }
    };
    AtexSlitter.prototype.storeSelectedSlitter = function() {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return;
            if (this.selectedSlitterId) window.localStorage.setItem(this.storageKey(), String(this.selectedSlitterId));
            else window.localStorage.removeItem(this.storageKey());
        } catch (e) { /* хранилище недоступно — молча игнорируем */ }
    };

    // GET → JSON. Бросает Error при сетевой/JSON-ошибке.
    AtexSlitter.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                try { return JSON.parse(text); }
                catch (e) { throw new Error('Некорректный JSON: ' + text.slice(0, 200)); }
            });
        });
    };

    AtexSlitter.prototype.loadRefOptions = function(reqId, query, limit) {
        return this.getJson(window.AtexRefSearch.buildRefOptionsPath(reqId, query, limit));
    };

    AtexSlitter.prototype.refSelect = function(opts) {
        var self = this;
        var helper = (typeof window !== 'undefined' && window.AtexRefSearch) || null;
        if (helper && typeof helper.createSelect === 'function') {
            return helper.createSelect({
                classPrefix: 'atex-sl',
                inputClass: 'atex-sl-input',
                options: opts.options || [],
                value: opts.value,
                placeholder: opts.placeholder,
                reqId: opts.reqId,
                cache: this.refOptions,
                loadOptions: function(reqId, query, limit) { return self.loadRefOptions(reqId, query, limit); },
                onChange: opts.onChange
            });
        }

        var nativeSelect = el('select', { class: 'atex-sl-input' });
        nativeSelect.appendChild(el('option', { value: '', text: opts.placeholder || '— не выбрано —' }));
        (opts.options || []).forEach(function(item) {
            var o = el('option', { value: item.id, text: item.label });
            if (String(opts.value) === String(item.id)) o.selected = true;
            nativeSelect.appendChild(o);
        });
        nativeSelect.addEventListener('change', function() { opts.onChange(nativeSelect.value); });
        return nativeSelect;
    };

    // POST команды `_m_*`. Токен XSRF подставляется обязательно (раздел 4 гайда).
    AtexSlitter.prototype.post = function(path, params) {
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
                try { result = JSON.parse(text); } catch (e) { throw new Error('Сервер вернул не JSON: ' + text.slice(0, 200)); }
                if (result && (result.error || result.err)) throw new Error(result.error || result.err);
                return result;
            });
        });
    };

    // Multipart-POST для файловых реквизитов (паттерн платформы, issue #1310):
    // тело FormData с _xsrf и t{reqId}=<File>. Возвращает разобранный JSON.
    AtexSlitter.prototype.postFile = function(path, reqKey, file) {
        var fd = new FormData();
        fd.append('_xsrf', (typeof window !== 'undefined' && window.xsrf) || this.root.getAttribute('data-xsrf') || '');
        if (reqKey && file) fd.append(reqKey, file);
        return fetch(this.url(path), { method: 'POST', credentials: 'same-origin', body: fd })
            .then(function(resp) {
                return resp.text().then(function(text) {
                    var result;
                    try { result = JSON.parse(text); } catch (e) { throw new Error('Сервер вернул не JSON: ' + text.slice(0, 200)); }
                    if (result && (result.error || result.err)) throw new Error(result.error || result.err);
                    return result;
                });
            });
    };

    // ── Загрузка метаданных и справочников ──

    AtexSlitter.prototype.loadMetadata = function() {
        var self = this;
        return this.getJson('metadata').then(function(all) {
            var list = Array.isArray(all) ? all : [all];
            function byName(name) {
                return list.filter(function(t) {
                    return String(t.val).trim().toLowerCase() === name.trim().toLowerCase();
                })[0] || null;
            }
            self.meta.cut = byName(TABLE.cut) || byName('Производственная резка'); // #3504: старое имя запасным
            self.meta.consumption = byName(TABLE.consumption);
            self.meta.event = byName(TABLE.event);
            self.meta.batch = byName(TABLE.batch);
            self.meta.material = byName(TABLE.material);
            self.meta.slitter = byName(TABLE.slitter);
            // #3433: необязательна (старое окружение без «Партии ГП» → факт не пишем).
            self.meta.finishedBatch = byName(TABLE.finishedBatch);
            if (!self.meta.cut) throw new Error('В метаданных не найдена таблица «' + TABLE.cut + '»');
            if (!self.meta.consumption) throw new Error('В метаданных не найдена таблица «' + TABLE.consumption + '»');
        });
    };

    AtexSlitter.prototype.loadSlitters = function() {
        var self = this;
        var meta = this.meta.slitter;
        if (!meta) { this.slitters = []; return Promise.resolve(); }
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            self.slitters = (rows || []).map(function(r) {
                var row = r.r || [];
                return { id: String(r.i), label: row[0] || ('Слиттер #' + r.i) };
            });
        });
    };

    // #3460: партии сырья грузим из защищённого отчёта `report/material_batches`
    // (раньше брали object/{Партия сырья} — поле «В работе» пустое, список выходил
    // пустым). Отчёт фильтруем по FR_is_active=% (только те, что в работе) и уже
    // отсортирован по FIFO. Партии со складом «Атех» помечаются foreign (другой
    // склад) — их показываем, но выбрать нельзя. На случай отсутствия отчёта в
    // сборке — тихий фолбэк на прямое чтение таблицы.
    AtexSlitter.prototype.loadBatches = function() {
        var self = this;
        return this.getJson('report/material_batches?JSON_KV&FR_is_active=%25&LIMIT=0,2000')
            .then(function(rows) {
                var list = Array.isArray(rows) ? rows : (rows && rows.rows) || [];
                self.batches = core.rowsToActiveBatches(list);
            })
            .catch(function() { return self.loadBatchesFromTable(); });
    };

    // Фолбэк #3460: прямое чтение таблицы «Партия сырья», если отчёт недоступен.
    AtexSlitter.prototype.loadBatchesFromTable = function() {
        var self = this;
        var meta = this.meta.batch;
        if (!meta) { this.batches = []; return Promise.resolve(); }
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            var dateIdx = colIndex(meta, BATCH_REQ.date);
            var remIdx = colIndex(meta, BATCH_REQ.remainder);
            var remMIdx = colIndex(meta, BATCH_REQ.remainderM);
            var kindIdx = colIndex(meta, BATCH_REQ.kind);
            var activeIdx = colIndexAny(meta, [BATCH_REQ.active, 'Активно', 'Активная', 'Действует']);
            var barcodeIdx = colIndex(meta, BATCH_REQ.barcode);
            self.batches = (rows || []).map(function(r) {
                var row = r.r || [];
                var matRef = kindIdx >= 0 ? parseRef(row[kindIdx]) : { id: null, label: '' };
                return {
                    id: String(r.i),
                    label: row[0] || ('Партия #' + r.i),
                    date: dateIdx >= 0 ? (row[dateIdx] || '') : '',
                    remainder: remIdx >= 0 ? core.toNumber(row[remIdx]) : 0,
                    remainderM: remMIdx >= 0 ? core.toNumber(row[remMIdx]) : 0,
                    materialId: matRef.id,
                    materialLabel: matRef.label,
                    warehouse: '',
                    foreign: false,
                    active: activeIdx >= 0 ? row[activeIdx] : '',
                    barcode: barcodeIdx >= 0 ? (row[barcodeIdx] || '') : ''
                };
            });
        });
    };

    // Карта ширин видов сырья: { id: Ширина,мм }. Для пересчёта брака,м → м².
    AtexSlitter.prototype.loadMaterialWidths = function() {
        var self = this;
        var meta = this.meta.material;
        if (!meta) { this.materialWidths = {}; return Promise.resolve(); }
        var wIdx = colIndex(meta, MATERIAL_REQ.width);
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            var map = {};
            (rows || []).forEach(function(r) {
                var row = r.r || [];
                map[String(r.i)] = wIdx >= 0 ? core.toNumber(row[wIdx]) : 0;
            });
            self.materialWidths = map;
        });
    };

    // Ширина сырья текущей резки: Партия сырья → Вид сырья → Ширина,мм.
    // Партия резки уже подгружена в `this.batches` (с materialId), отдельный
    // запрос не нужен — синхронно резолвим из карты ширин видов сырья.
    AtexSlitter.prototype.resolveCutWidth = function() {
        var cut = this.currentCut;
        if (!cut) return;
        var batch = cut.batchId ? this.findBatch(cut.batchId) : null;
        var matId = batch ? batch.materialId : null;
        cut.materialId = matId || cut.materialId || '';
        cut.materialWidthMm = cut.materialId ? (this.materialWidths[String(cut.materialId)] || 0) : 0;
    };

    AtexSlitter.prototype.loadCuts = function() {
        var self = this;
        var meta = this.meta.cut;
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            var statusIdx = colIndex(meta, CUT_REQ.status);
            var slitterIdx = colIndex(meta, CUT_REQ.slitter);
            var batchIdx = colIndex(meta, CUT_REQ.batch);
            var planDateIdx = colIndex(meta, CUT_REQ.planDate);
            var sequenceIdx = colIndex(meta, CUT_REQ.sequence);
            var plannedRunsIdx = colIndexAny(meta, CUT_PLANNED_RUNS_NAMES);
            var runLengthIdx = colIndexAny(meta, CUT_RUN_LENGTH_NAMES);
            var startedIdx = colIndexAny(meta, CUT_STARTED_NAMES);
            self.cuts = (rows || []).map(function(r) {
                var row = r.r || [];
                var slitterRef = slitterIdx >= 0 ? parseRef(row[slitterIdx]) : { id: null, label: '' };
                var batchRef = batchIdx >= 0 ? parseRef(row[batchIdx]) : { id: null, label: '' };
                return {
                    id: String(r.i),
                    // #3460: главное значение резки — плановое время старта (штамп);
                    // показываем «Резка ЧЧ:ММ», а не сырой номер.
                    label: core.cutTitle(row[0] || r.i),
                    status: statusIdx >= 0 ? core.normalizeStatus(row[statusIdx]) : STATUSES[0],
                    slitterId: slitterRef.id,
                    slitter: slitterRef.label,
                    batchId: batchRef.id,
                    batch: batchRef.label,
                    // #3352: главное значение резки (row[0]) = «Дата план»;
                    // если colIndex не нашёл реквизит — берём row[0], иначе
                    // prepareCutQueue отфильтрует все резки по пустой дате.
                    planDate: (planDateIdx >= 0 ? row[planDateIdx] : null) || row[0] || '',
                    sequence: sequenceIdx >= 0 ? row[sequenceIdx] : '',
                    plannedRuns: plannedRunsIdx >= 0 ? row[plannedRunsIdx] : '',
                    runLength: runLengthIdx >= 0 ? row[runLengthIdx] : '',
                    startedAt: startedIdx >= 0 ? (row[startedIdx] || '') : ''
                };
            });
        });
    };

    // Полная запись выбранной резки (значения полей для формы).
    AtexSlitter.prototype.loadCut = function(cutId) {
        var self = this;
        var meta = this.meta.cut;
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&F_I=' + encodeURIComponent(cutId) + '&LIMIT=0,1').then(function(rows) {
            var rec = (rows || [])[0];
            if (!rec) throw new Error('Резка не найдена');
            var row = rec.r || [];
            function val(name) { var i = colIndex(meta, name); return i >= 0 ? (row[i] || '') : ''; }
            function valAny(names) { var i = colIndexAny(meta, names); return i >= 0 ? (row[i] || '') : ''; }
            var slitterRef = parseRef(val(CUT_REQ.slitter));
            var batchRef = parseRef(val(CUT_REQ.batch));
            self.currentCut = {
                id: String(rec.i),
                number: row[0] || '',
                label: core.cutTitle(row[0] || rec.i),
                slitterId: slitterRef.id,
                slitter: slitterRef.label,
                batch: batchRef.label,
                batchId: batchRef.id,
                savedMeterage: core.toNumber(val(CUT_REQ.meterage)),
                planDate: val(CUT_REQ.planDate),
                status: core.normalizeStatus(val(CUT_REQ.status)),
                counterStart: val(CUT_REQ.counterStart),
                counterEnd: val(CUT_REQ.counterEnd),
                meterage: val(CUT_REQ.meterage),
                defect: val(CUT_REQ.defect),
                defectM: val(CUT_REQ.defectM),
                defectPhoto: val(CUT_REQ.defectPhoto),
                sequence: val(CUT_REQ.sequence),
                plannedRuns: valAny(CUT_PLANNED_RUNS_NAMES),
                runLength: valAny(CUT_RUN_LENGTH_NAMES),
                startedAt: valAny(CUT_STARTED_NAMES),
                notes: val(CUT_REQ.notes)
            };
        });
    };

    // #3460: состав резки — полосы (подчинённая «Партия ГП»). Нужны для метрик
    // (число полос/ножей) и цветной раскладки ножей. Ширину/кол-во/назначение
    // берём по именам реквизитов (как в cut-map.html).
    AtexSlitter.prototype.loadStrips = function(cutId) {
        var self = this;
        var meta = this.meta.finishedBatch;
        if (!meta) { this.currentStrips = []; return Promise.resolve(); }
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(cutId) + '&LIMIT=0,1000').then(function(rows) {
            var widthIdx = colIndex(meta, STRIP_REQ.width);
            var qtyIdx = colIndex(meta, STRIP_REQ.qty);
            var purposeIdx = colIndex(meta, STRIP_REQ.purpose);
            self.currentStrips = (rows || []).map(function(rec) {
                var r = rec.r || [];
                return {
                    id: String(rec.i),
                    name: r[0] || '',
                    width: widthIdx >= 0 ? (r[widthIdx] || '') : '',
                    qty: qtyIdx >= 0 ? (r[qtyIdx] || '') : '',
                    purpose: purposeIdx >= 0 ? (r[purposeIdx] || '') : ''
                };
            });
        }).catch(function() { self.currentStrips = []; });
    };

    // #3460: вид сырья резки для шапки. У резки нет прямого поля «Вид сырья» —
    // выводим из плановой партии: сперва из загруженного пула партий (findBatch),
    // иначе тихо дочитываем объект партии и берём ссылку «Вид сырья».
    AtexSlitter.prototype.loadCutMaterial = function() {
        var self = this;
        var cut = this.currentCut;
        if (!cut) return Promise.resolve();
        var batch = cut.batchId ? this.findBatch(cut.batchId) : null;
        if (batch) {
            cut.materialId = batch.materialId || cut.materialId || '';
            cut.material = batch.materialLabel || cut.material || cut.batch || '';
            return Promise.resolve();
        }
        if (!cut.material) cut.material = cut.batch || '';
        var batchMeta = this.meta.batch;
        if (!cut.batchId || !batchMeta) return Promise.resolve();
        return this.getJson('object/' + batchMeta.id + '/?JSON_OBJ&F_I=' + encodeURIComponent(cut.batchId) + '&LIMIT=0,1').then(function(rows) {
            var rec = (rows || [])[0];
            if (!rec) return;
            var kindIdx = colIndex(batchMeta, BATCH_REQ.kind);
            if (kindIdx < 0) return;
            var matRef = parseRef((rec.r || [])[kindIdx]);
            if (matRef.id) cut.materialId = matRef.id;
            if (matRef.label) cut.material = matRef.label;
        }).catch(function() {});
    };

    // ── Чтение расхода сырья (подчинён резке) ──

    AtexSlitter.prototype.loadConsumptions = function(cutId) {
        var self = this;
        var meta = this.meta.consumption;
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(cutId) + '&LIMIT=0,1000').then(function(rows) {
            var amountIdx = colIndex(meta, CONS_REQ.amount);
            var batchIdx = colIndex(meta, CONS_REQ.batch);
            self.consumptions = (rows || []).map(function(rec) {
                var r = rec.r || [];
                var batchRef = batchIdx >= 0 ? parseRef(r[batchIdx]) : { id: null };
                var amount = amountIdx >= 0 ? (r[amountIdx] || '') : '';
                return {
                    id: String(rec.i),
                    name: r[0] || '',
                    batchId: batchRef.id,
                    amount: amount,
                    savedAmount: core.toNumber(amount) // для дельты остатка при правке
                };
            });
        });
    };

    AtexSlitter.prototype.blankConsumption = function() {
        var fifo = core.availableBatchesForCut(this.batches, this.currentCut).filter(function(b) { return !b.foreign; })[0] || core.pickFifoBatch(this.batches);
        return { id: null, name: '', batchId: fifo ? fifo.id : null, amount: '', savedAmount: 0 };
    };

    // ── Чтение событий смены. В старой схеме событие ссылалось на резку, в
    // новой может быть подчинено ей; поэтому `cutId` берём либо из реквизита,
    // либо из родителя записи.

    AtexSlitter.prototype.parseEventRows = function(rows) {
        var meta = this.meta.event;
        if (!meta) return [];
        var typeIdx = colIndex(meta, EVENT_REQ.type);
        var cutIdx = colIndexAny(meta, [EVENT_REQ.cut, 'Производственная резка']); // #3504: старое имя запасным
        var userIdx = colIndex(meta, EVENT_REQ.user);
        var valIdx = colIndex(meta, EVENT_REQ.value);
        var notesIdx = colIndex(meta, EVENT_REQ.notes);
        return (rows || []).map(function(rec) {
            var r = rec.r || [];
            var cutId = cutIdx >= 0 ? parseRef(r[cutIdx]).id : null;
            if (!cutId && rec.u && String(rec.u) !== '1') cutId = String(rec.u);
            var userRef = userIdx >= 0 ? parseRef(r[userIdx]) : { id: null, label: '' };
            return {
                id: String(rec.i),
                when: r[0] || '',
                type: typeIdx >= 0 ? (parseRef(r[typeIdx]).label || '') : '',  // #3348: тип — ссылка «id:Начало смены»
                cutId: cutId || null,
                userId: userRef.id,
                user: userRef.label,
                value: valIdx >= 0 ? (r[valIdx] || '') : '',
                notes: notesIdx >= 0 ? (r[notesIdx] || '') : ''
            };
        }).sort(function(a, b) {
            return String(b.when).localeCompare(String(a.when)); // новые сверху
        });
    };

    AtexSlitter.prototype.filterShiftEvents = function(events) {
        var self = this;
        var targetDay = core.dateKey(this.selectedDate);
        return (events || []).filter(function(ev) {
            if (self.userId && String(ev.userId || '') !== String(self.userId)) return false;
            return core.dateKey(ev.when) === targetDay;
        });
    };

    AtexSlitter.prototype.loadShiftEvents = function() {
        var self = this;
        var meta = this.meta.event;
        if (!meta) { this.shiftEvents = []; this.events = []; return Promise.resolve(); }
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,2000').then(function(rows) {
            var all = self.parseEventRows(rows);
            self.shiftEvents = self.filterShiftEvents(all);
            self.events = self.currentCutId
                ? self.shiftEvents.filter(function(ev) { return String(ev.cutId || '') === String(self.currentCutId); })
                : [];
        });
    };

    AtexSlitter.prototype.loadEvents = function(cutId) {
        var self = this;
        this.currentCutId = cutId ? String(cutId) : this.currentCutId;
        return this.loadShiftEvents().then(function() {
            self.events = self.shiftEvents.filter(function(ev) {
                return String(ev.cutId || '') === String(cutId);
            });
        });
    };

    AtexSlitter.prototype.isShiftOpen = function() {
        return core.hasOpenShift(this.shiftEvents, this.userId, this.selectedDate);
    };

    AtexSlitter.prototype.eventDateTime = function() {
        var now = new Date();
        function p(n) { return (n < 10 ? '0' : '') + n; }
        var day = this.selectedDate || core.todayISO(now);
        return day + ' ' + p(now.getHours()) + ':' + p(now.getMinutes()) + ':' + p(now.getSeconds());
    };

    // ── Рендеринг ──

    AtexSlitter.prototype.render = function() {
        this.renderToolbar();
        this.renderCuts();
        this.renderMain();
    };

    AtexSlitter.prototype.slitterOptions = function() {
        if (this.slitters.length) return this.slitters;
        var map = {};
        this.cuts.forEach(function(cut) {
            if (cut.slitterId) map[String(cut.slitterId)] = cut.slitter || ('Слиттер #' + cut.slitterId);
        });
        return Object.keys(map).map(function(id) { return { id: id, label: map[id] }; });
    };

    AtexSlitter.prototype.selectedSlitterLabel = function() {
        var id = String(this.selectedSlitterId || '');
        return (this.slitterOptions().filter(function(item) { return String(item.id) === id; })[0] || {}).label || '';
    };

    AtexSlitter.prototype.currentQueue = function() {
        return core.prepareCutQueue(this.cuts, {
            slitterId: this.selectedSlitterId,
            date: this.selectedDate,
            includeDone: this.includeDone
        });
    };

    AtexSlitter.prototype.visibleCuts = function() {
        return this.currentQueue().cuts;
    };

    AtexSlitter.prototype.renderToolbar = function() {
        var self = this;
        var box = this.toolbarEl;
        if (!box) return;
        box.innerHTML = '';

        var dateInp = el('input', { class: 'atex-sl-input', type: 'date' });
        dateInp.value = this.selectedDate || core.todayISO();
        dateInp.addEventListener('change', function() {
            self.selectedDate = dateInp.value || core.todayISO();
            self.currentCutId = null;
            self.currentCut = null;
            self.selectedBatchIds = [];
            self.loadShiftEvents().then(function() { self.render(); });
        });

        var select = el('select', { class: 'atex-sl-input atex-sl-select' });
        select.appendChild(el('option', { value: '', text: 'Выберите станок' }));
        this.slitterOptions().forEach(function(item) {
            var opt = el('option', { value: item.id, text: item.label });
            if (String(item.id) === String(self.selectedSlitterId)) opt.selected = true;
            select.appendChild(opt);
        });
        select.addEventListener('change', function() {
            self.selectedSlitterId = select.value;
            self.storeSelectedSlitter(); // #3460: запоминаем выбор станка
            self.currentCutId = null;
            self.currentCut = null;
            self.selectedBatchIds = [];
            self.loadShiftEvents().then(function() { self.render(); });
        });

        box.appendChild(field('Дата', dateInp));
        box.appendChild(field('Станок', select));
    };

    AtexSlitter.prototype.renderCuts = function() {
        var self = this;
        var box = this.cutsEl;
        if (!box) return;
        box.innerHTML = '';
        if (!this.selectedSlitterId) {
            box.appendChild(el('div', { class: 'atex-sl-empty', text: 'Сначала выберите станок.' }));
            return;
        }
        if (!this.isShiftOpen()) {
            box.appendChild(el('div', { class: 'atex-sl-empty', text: 'Откройте смену, чтобы выбрать резку.' }));
            return;
        }
        var list = this.visibleCuts();
        if (!list.length) {
            box.appendChild(el('div', { class: 'atex-sl-empty', text: 'Резок пока нет' }));
            return;
        }
        var firstOpenId = this.currentQueue().firstOpenCutId;
        // #3459: только первая резка в «Ожидает» доступна; остальные disabled.
        // Резка в работе или на паузе остаётся доступной для своего оператора.
        list.forEach(function(cut) {
            var active = String(self.currentCutId) === String(cut.id);
            var isFirstOpen = firstOpenId && String(firstOpenId) === String(cut.id);
            var isWaiting = core.normalizeStatus(cut.status) === 'Ожидает';
            var isInProgress = core.normalizeStatus(cut.status) === 'В работе' || core.isPauseStatus(cut.status);
            // Блокируем «Ожидает»-резки кроме первой в очереди
            var disabled = isWaiting && !isFirstOpen && !active;
            var item = el('button', {
                class: 'atex-sl-cut-item' + (active ? ' is-active' : '') + (isFirstOpen && !active ? ' is-next' : '') + (disabled ? ' is-disabled' : ''),
                type: 'button',
                disabled: disabled ? 'disabled' : undefined
            }, [
                el('div', { class: 'atex-sl-cut-main' }, [
                    el('span', { class: 'atex-sl-cut-label', text: cut.label }),
                    el('span', { class: 'atex-sl-cut-sub', text: [
                        core.humanizeLabel(cut.batch),
                        cut.startedAt ? ('Начато: ' + core.humanizeLabel(cut.startedAt)) : 'Начато: —',
                        disabled ? 'ожидает предыдущую' : ''
                    ].filter(Boolean).join(' · ') })
                ]),
                el('span', { class: 'atex-sl-badge ' + badgeClass(cut.status), text: cut.status })
            ]);
            if (!disabled) {
                item.addEventListener('click', function() { self.openCut(cut.id); });
            }
            box.appendChild(item);
        });
    };

    function badgeClass(status) {
        if (core.isDone(status)) return 'atex-sl-badge-done';
        if (core.normalizeStatus(status) === 'В работе') return 'atex-sl-badge-run';
        if (core.isPauseStatus(status)) return 'atex-sl-badge-setup';
        return 'atex-sl-badge-wait';
    }

    AtexSlitter.prototype.renderMain = function() {
        var host = this.mainEl;
        if (!host) return;
        host.innerHTML = '';

        if (!this.selectedSlitterId) {
            host.appendChild(el('div', { class: 'atex-sl-placeholder', text: 'Выберите станок и дату.' }));
            return;
        }

        if (!this.isShiftOpen()) {
            host.appendChild(this.renderShiftGate());
            return;
        }

        if (!this.currentCutId || !this.currentCut) {
            host.appendChild(el('div', { class: 'atex-sl-placeholder', text: 'Выберите производственную резку слева.' }));
            return;
        }

        host.appendChild(this.renderHead());
        host.appendChild(this.renderCutMap());
        host.appendChild(this.renderStatusBar());
        host.appendChild(this.renderBatchSelection());
        host.appendChild(this.renderReadings());
        host.appendChild(this.renderConsumption());
        host.appendChild(this.renderEvents());
    };

    AtexSlitter.prototype.renderShiftGate = function() {
        var self = this;
        var section = el('section', { class: 'atex-sl-section atex-sl-shift-gate' }, [
            el('h3', { class: 'atex-sl-section-title', text: 'Смена не открыта' }),
            el('div', { class: 'atex-sl-muted', text: [this.selectedSlitterLabel(), this.selectedDate].filter(Boolean).join(' · ') })
        ]);
        var btn = el('button', { class: 'atex-sl-btn atex-sl-btn-primary', type: 'button', text: 'Открыть смену' });
        btn.addEventListener('click', function() { self.openShift(); });
        section.appendChild(el('div', { class: 'atex-sl-section-actions' }, [btn]));
        return section;
    };

    AtexSlitter.prototype.renderHead = function() {
        var cut = this.currentCut;
        var meta = [];
        if (cut.slitter) meta.push('Слиттер: ' + cut.slitter);
        if (cut.batch) meta.push('Партия: ' + core.humanizeLabel(cut.batch));
        if (cut.planDate) meta.push('План: ' + this.formatPlanDateTime(cut.planDate));
        var head = el('div', { class: 'atex-sl-head' }, [
            el('div', {}, [
                el('h2', { class: 'atex-sl-head-title', text: cut.label }),
                el('div', { class: 'atex-sl-head-meta', text: meta.join('   •   ') })
            ]),
            el('span', { class: 'atex-sl-badge ' + badgeClass(cut.status), text: cut.status })
        ]);
        var wrap = el('div');
        wrap.appendChild(head);
        wrap.appendChild(this.renderCutMetrics());
        return wrap;
    };

    // #3460: плановое время старта (штамп) → «ДД.ММ.ГГГГ ЧЧ:ММ»; иначе как есть.
    AtexSlitter.prototype.formatPlanDateTime = function(value) {
        if (!core.isTimestampSeconds(value)) return String(value == null ? '' : value);
        return core.formatDate(value) + ' ' + core.formatClock(value);
    };

    // #3460: сводка резки — название сырья, метраж, число полос/ножей и резок.
    // «Ножей» = «полос за проход» = Σ(кол-во полос) (см. cut-map/#3431); «Полос
    // всего» = ножей × резок; «Резок» = план. число проходов.
    AtexSlitter.prototype.renderCutMetrics = function() {
        var cut = this.currentCut;
        var strips = this.currentStrips || [];
        var knives = core.totalKnives(strips);
        var runs = core.plannedRunsForCut(cut);
        var runLength = core.runLengthForCut(cut);
        var material = cut.material || cut.materialLabel || cut.batch || '—';
        var cells = [
            ['Вид сырья', material || '—'],
            ['Метраж, м', runLength > 0 ? String(core.round3(runLength)) : '—'],
            ['Ножей (полос за проход)', knives > 0 ? String(knives) : '—'],
            ['Резок', String(runs)],
            ['Полос всего', knives > 0 ? String(core.round3(knives * runs)) : '—']
        ];
        var grid = el('div', { class: 'atex-sl-metrics' });
        cells.forEach(function(pair) {
            grid.appendChild(el('div', { class: 'atex-sl-metric' }, [
                el('span', { class: 'atex-sl-metric-label', text: pair[0] }),
                el('span', { class: 'atex-sl-metric-value', text: String(pair[1]) })
            ]));
        });
        return grid;
    };

    // #3460: цветная карта раскроя ножей с подписями ширин прямо на полосах
    // (как в cut-map.html, но в цвете). Ширина входа = ширина сырья текущей
    // резки; при отсутствии — fallback на занятую полосами ширину.
    AtexSlitter.prototype.renderCutMap = function() {
        var cut = this.currentCut;
        var strips = this.currentStrips || [];
        var section = el('section', { class: 'atex-sl-section' }, [
            el('h3', { class: 'atex-sl-section-title', text: 'Раскладка ножей' })
        ]);
        if (!strips.length) {
            section.appendChild(el('div', { class: 'atex-sl-empty', text: 'У резки нет полос — раскраивать нечего.' }));
            return section;
        }
        var inputWidth = core.toNumber(cut.materialWidthMm);
        if (!(inputWidth > 0)) inputWidth = core.usedWidth(strips);
        var lay = core.computeLayout(inputWidth, strips, null);

        section.appendChild(el('div', { class: 'atex-sl-cm-caption' }, [
            el('span', { text: 'Ширина входа: ' + lay.inputWidth + ' мм' }),
            el('span', { class: 'atex-sl-cm-caption-used', text: 'Занято: ' + lay.usedWidth + ' мм' })
        ]));

        var bar = el('div', { class: 'atex-sl-cm-bar' + (lay.overflow ? ' is-overflow' : '') });
        lay.segments.forEach(function(seg) {
            var pct = core.widthPercent(seg.width, lay);
            var kind = core.purposeKind(seg.purpose);
            var title = (seg.label ? seg.label + ' · ' : '') + seg.width + ' мм' + (seg.purpose ? ' · ' + seg.purpose : '');
            var segNode = el('div', {
                class: 'atex-sl-cm-seg atex-sl-cm-seg-' + kind,
                title: title,
                dataset: { width: String(seg.width) }
            });
            segNode.style.width = pct + '%';
            // Подпись ширины — прямо на полосе (требование #3460).
            if (pct >= 4) segNode.appendChild(el('span', { class: 'atex-sl-cm-seg-label', text: String(seg.width) }));
            bar.appendChild(segNode);
        });
        if (lay.remainder > 0) {
            var rpct = core.widthPercent(lay.remainder, lay);
            var rem = el('div', { class: 'atex-sl-cm-seg atex-sl-cm-seg-remainder', title: 'Остаток (обрезь): ' + lay.remainder + ' мм' });
            rem.style.width = rpct + '%';
            if (rpct >= 4) rem.appendChild(el('span', { class: 'atex-sl-cm-seg-label', text: String(lay.remainder) }));
            bar.appendChild(rem);
        }
        section.appendChild(bar);

        if (lay.overflow) {
            section.appendChild(el('div', { class: 'atex-sl-cm-warn', text: 'Полосы превышают ширину входа на ' + Math.abs(lay.remainder) + ' мм.' }));
        }

        // Легенда по видам полос (ширина · кол-во · назначение) с цветом.
        var legend = el('div', { class: 'atex-sl-cm-legend' });
        strips.forEach(function(s) {
            var kind = core.purposeKind(s.purpose);
            legend.appendChild(el('div', { class: 'atex-sl-cm-legend-item' }, [
                el('span', { class: 'atex-sl-cm-swatch atex-sl-cm-seg-' + kind }),
                el('span', { text: core.round3(core.toNumber(s.width)) + ' мм × ' + core.round3(core.toNumber(s.qty)) +
                    (s.purpose ? ' · ' + s.purpose : '') })
            ]));
        });
        section.appendChild(legend);
        return section;
    };

    // Полоса статусов: цепочка-степпер + кнопки действий по статусу (#3459).
    AtexSlitter.prototype.renderStatusBar = function() {
        var self = this;
        var cut = this.currentCut;
        var bar = el('section', { class: 'atex-sl-section' }, [
            el('h3', { class: 'atex-sl-section-title', text: 'Статус резки' })
        ]);

        // Степпер: визуальная цепочка Ожидает → В работе → Завершена
        var steps = el('div', { class: 'atex-sl-steps' });
        var curIdx = core.STATUSES.indexOf(core.normalizeStatus(cut.status));
        core.STATUSES.forEach(function(st, i) {
            var cls = 'atex-sl-step';
            if (i < curIdx) cls += ' is-past';
            else if (i === curIdx) cls += ' is-current';
            var btn = el('button', { class: cls, type: 'button', text: st });
            btn.addEventListener('click', function() { self.setStatus(st); });
            steps.appendChild(btn);
        });
        bar.appendChild(steps);

        var actions = el('div', { class: 'atex-sl-section-actions atex-sl-life-actions' });
        if (core.isDone(cut.status)) {
            actions.appendChild(el('span', { class: 'atex-sl-muted', text: 'Резка завершена' }));
        } else if (core.normalizeStatus(cut.status) === 'Ожидает') {
            // Ожидает → «В работу» / «Пропустить»
            var startBtn = el('button', { class: 'atex-sl-btn atex-sl-btn-primary', type: 'button', text: 'В работу' });
            startBtn.addEventListener('click', function() { self.setStatus('В работе', 'Запуск резки'); });
            actions.appendChild(startBtn);

            var skipBtn = el('button', { class: 'atex-sl-btn atex-sl-btn-secondary', type: 'button', text: 'Пропустить' });
            skipBtn.addEventListener('click', function() { self.skipCut(); });
            actions.appendChild(skipBtn);
        } else if (core.normalizeStatus(cut.status) === 'В работе') {
            // В работе → «Пауза» / «Завершить» / «Отменить»
            var pauseBtn = el('button', { class: 'atex-sl-btn atex-sl-btn-secondary', type: 'button', text: 'Пауза' });
            pauseBtn.addEventListener('click', function() { self.addQuickEvent('Пауза'); });
            actions.appendChild(pauseBtn);

            var doneBtn = el('button', { class: 'atex-sl-btn atex-sl-btn-advance', type: 'button', text: 'Завершить' });
            doneBtn.addEventListener('click', function() { self.finishCut(); });
            actions.appendChild(doneBtn);

            var cancelBtn = el('button', { class: 'atex-sl-btn atex-sl-btn-secondary', type: 'button', text: 'Отменить' });
            cancelBtn.addEventListener('click', function() { self.cancelCut(); });
            actions.appendChild(cancelBtn);
        } else if (core.isPauseStatus(cut.status)) {
            // Пауза → «Возобновить»
            var resumeBtn = el('button', { class: 'atex-sl-btn atex-sl-btn-primary', type: 'button', text: 'Возобновить' });
            resumeBtn.addEventListener('click', function() { self.setStatus('В работе', 'Запуск резки'); });
            actions.appendChild(resumeBtn);
        }
        bar.appendChild(actions);
        return bar;
    };

    AtexSlitter.prototype.syncInitialBatchSelection = function() {
        var cut = this.currentCut;
        if (!cut) return;
        // #3460: партии со склада «Атех» (foreign) — на другом складе, выбрать
        // их нельзя, поэтому из автоподбора по умолчанию исключаем.
        var available = core.availableBatchesForCut(this.batches, cut).filter(function(b) { return !b.foreign; });
        if (!available.length) { this.selectedBatchIds = []; return; }
        var preferred = cut.batchId && available.filter(function(batch) {
            return String(batch.id) === String(cut.batchId);
        })[0];
        var first = preferred || available[0];
        if (!this.selectedBatchIds.length) this.selectedBatchIds = [String(first.id)];
        if (!cut.batchId) {
            cut.batchId = String(first.id);
            cut.batch = first.label || cut.batch;
            cut.materialId = first.materialId || cut.materialId;
        }
        if (!cut.counterStart && first.remainderM > 0) cut.counterStart = String(core.round3(first.remainderM));
    };

    AtexSlitter.prototype.renderBatchSelection = function() {
        var self = this;
        var cut = this.currentCut;
        var section = el('section', { class: 'atex-sl-section' }, [
            el('h3', { class: 'atex-sl-section-title', text: 'Партии сырья' })
        ]);
        var available = core.availableBatchesForCut(this.batches, cut);
        var coverage = core.batchCoverage(this.batches, this.selectedBatchIds, cut);
        var summary = 'Покрыто: ' + coverage.coveredMeters + ' м';
        if (coverage.neededMeters > 0) summary += ' из ' + coverage.neededMeters + ' м';
        summary += ' · проходов: ' + coverage.coveredRuns + '/' + coverage.neededRuns;
        section.appendChild(el('div', {
            class: 'atex-sl-coverage' + (coverage.complete ? ' is-complete' : ''),
            text: summary
        }));

        if (!available.length) {
            section.appendChild(el('div', { class: 'atex-sl-empty', text: 'Нет партий в работе с остатком минимум на один проход.' }));
            return section;
        }

        var selected = {};
        this.selectedBatchIds.forEach(function(id) { selected[String(id)] = true; });
        var grid = el('div', { class: 'atex-sl-batch-grid' });
        available.forEach(function(batch) {
            var passes = core.batchPasses(batch, cut);
            // #3460: партии со склада «Атех» — на другом складе; показываем, но
            // выбрать нельзя (карточка неактивна).
            var foreign = !!batch.foreign;
            var cls = 'atex-sl-batch-card' +
                (selected[String(batch.id)] ? ' is-selected' : '') +
                (foreign ? ' is-disabled' : '');
            var cells = [
                el('span', { class: 'atex-sl-batch-title', text: batch.label }),
                el('span', { class: 'atex-sl-batch-meta', text: 'Приход: ' + (batch.date || '—') }),
                el('span', { class: 'atex-sl-batch-metric', text: 'Остаток, м: ' + core.round3(batch.remainderM || 0) }),
                el('span', { class: 'atex-sl-batch-meta', text: 'Штрих-код: ' + (batch.barcode || '—') }),
                el('span', { class: 'atex-sl-batch-meta', text: 'Проходов: ' + passes })
            ];
            if (foreign) {
                cells.push(el('span', { class: 'atex-sl-batch-warn', text: 'Склад «' + (batch.warehouse || 'Атех') + '» — другой склад' }));
            }
            var card = el('button', { class: cls, type: 'button' }, cells);
            if (foreign) {
                card.disabled = true;
            } else {
                card.addEventListener('click', function() {
                    var id = String(batch.id);
                    var idx = self.selectedBatchIds.indexOf(id);
                    if (idx >= 0) self.selectedBatchIds.splice(idx, 1);
                    else self.selectedBatchIds.push(id);
                    if (!cut.counterStart && batch.remainderM > 0) cut.counterStart = String(core.round3(batch.remainderM));
                    if (!cut.batchId) cut.batchId = id;
                    self.renderMain();
                });
            }
            grid.appendChild(card);
        });
        section.appendChild(grid);
        return section;
    };

    // #3459: Показания счётчика, погонаж (read-only, вычисляемый), брак, примечания.
    // Счётчик нач. заполняется из остатка партии. Погонаж факт = счётчик кон. − счётчик нач.
    AtexSlitter.prototype.renderReadings = function() {
        var self = this;
        var cut = this.currentCut;
        var section = el('section', { class: 'atex-sl-section' }, [
            el('h3', { class: 'atex-sl-section-title', text: 'Показания и выработка' })
        ]);

        var grid = el('div', { class: 'atex-sl-grid' });

        // Счётчик нач. — заполняется из остатка партии (batch.remainderM) при открытии резки
        var cStart = numInput(cut.counterStart, '0');
        cStart.addEventListener('input', function() { cut.counterStart = cStart.value; refreshMeterage(); });
        var cStartField = field('Счётчик нач.', cStart);
        var cStartHint = el('span', { class: 'atex-sl-hint', text: '' });
        cStartField.appendChild(cStartHint);
        grid.appendChild(cStartField);

        var cEnd = numInput(cut.counterEnd, '0');
        cEnd.addEventListener('input', function() { cut.counterEnd = cEnd.value; refreshMeterage(); });
        grid.appendChild(field('Счётчик кон.', cEnd));

        // #3459: Погонаж факт — вычисляемый (read-only), не сохраняется в БД отдельно
        var meterageDisplay = el('input', {
            class: 'atex-sl-input', type: 'text', readonly: 'readonly',
            placeholder: 'вычисляется из счётчиков',
            style: 'background:#f0f0f0;cursor:default'
        });
        var meterField = field('Погонаж факт, м (расчёт)', meterageDisplay);
        grid.appendChild(meterField);

        var defectM = numInput(cut.defectM, '0');
        var defectHint = el('div', { class: 'atex-sl-hint', text: '' });
        function refreshDefectM2() {
            var m2 = core.defectM2(cut.defectM, cut.materialWidthMm);
            cut.defect = m2 ? String(m2) : '';
            defectHint.textContent = (core.toNumber(cut.defectM) > 0 && cut.materialWidthMm > 0)
                ? ('= ' + m2 + ' м² (ширина ' + cut.materialWidthMm + ' мм)')
                : (cut.materialWidthMm > 0 ? '' : 'ширина сырья не определена — м² не посчитать');
        }
        defectM.addEventListener('input', function() { cut.defectM = defectM.value; refreshDefectM2(); });
        refreshDefectM2();
        var defectField = field('Брак, м', defectM);
        defectField.appendChild(defectHint);
        grid.appendChild(defectField);

        // Фото брака
        var photoInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
        var photoBtn = el('button', { class: 'atex-sl-btn atex-sl-btn-secondary', type: 'button', text: 'Фото брака' });
        var photoStatus = el('span', { class: 'atex-sl-hint', text: cut.defectPhoto ? 'фото загружено' : '' });
        photoBtn.addEventListener('click', function() { photoInput.click(); });
        photoInput.addEventListener('change', function() {
            var file = photoInput.files && photoInput.files[0];
            if (file) self.uploadDefectPhoto(file, photoStatus);
        });
        grid.appendChild(field('Фото брака', el('div', { class: 'atex-sl-photo' }, [photoBtn, photoStatus, photoInput])));

        section.appendChild(grid);

        var notes = el('textarea', { class: 'atex-sl-input atex-sl-textarea', rows: '2', placeholder: 'Примечания' });
        notes.value = cut.notes || '';
        notes.addEventListener('input', function() { cut.notes = notes.value; });
        section.appendChild(field('Примечания', notes));

        var actions = el('div', { class: 'atex-sl-section-actions' });
        var saveBtn = el('button', { class: 'atex-sl-btn atex-sl-btn-primary', type: 'button', text: 'Сохранить показания' });
        saveBtn.addEventListener('click', function() { self.saveReadings(); });
        actions.appendChild(saveBtn);
        section.appendChild(actions);

        refreshMeterage();
        return section;

        // Обновление подсказок: погонаж = кон. − нач.; остаток партии → счётчик нач.
        function refreshMeterage() {
            var suggested = core.meterageFromCounters(cut.counterStart, cut.counterEnd);
            cut.meterage = String(suggested);
            meterageDisplay.value = suggested;
            // Подсказка к счётчику нач.: откуда взято значение
            var batch = cut.batchId ? self.findBatch(cut.batchId) : null;
            cStartHint.textContent = batch && batch.remainderM > 0
                ? ' (остаток партии: ' + core.round3(batch.remainderM) + ' м)'
                : '';
        }
    };

    // Расход сырья: список строк, FIFO-подсказка партии, списание остатка.
    AtexSlitter.prototype.renderConsumption = function() {
        var self = this;
        var section = el('section', { class: 'atex-sl-section' }, [
            el('h3', { class: 'atex-sl-section-title', text: 'Расход сырья (FIFO)' })
        ]);

        var total = core.sumConsumption(this.consumptions);
        section.appendChild(el('div', { class: 'atex-sl-muted', text: 'Списано всего: ' + total + ' м²' }));

        var listWrap = el('div', { class: 'atex-sl-rows' });
        if (!this.consumptions.length) {
            listWrap.appendChild(el('div', { class: 'atex-sl-empty', text: 'Расхода пока нет — добавьте списание.' }));
        } else {
            this.consumptions.forEach(function(row, idx) { listWrap.appendChild(self.renderConsumptionRow(row, idx)); });
        }
        section.appendChild(listWrap);

        var addBtn = el('button', { class: 'atex-sl-btn atex-sl-btn-add', type: 'button', text: '+ Списать партию' });
        addBtn.addEventListener('click', function() { self.consumptions.push(self.blankConsumption()); self.renderMain(); });
        section.appendChild(addBtn);
        return section;
    };

    AtexSlitter.prototype.renderConsumptionRow = function(row, idx) {
        var self = this;
        var card = el('div', { class: 'atex-sl-row' });

        // #3460: партии склада «Атех» (foreign) списывать нельзя — на другом складе.
        var batchOptions = core.sortFifo(this.batches).filter(function(b) { return !b.foreign; }).map(function(b) {
            return { id: b.id, label: b.label + ' — остаток ' + core.round3(b.remainder) + ' м²' };
        });
        var batchRef = this.refSelect({
            options: batchOptions,
            value: row.batchId,
            placeholder: '— партия сырья —',
            reqId: reqIdByName(this.meta.consumption, CONS_REQ.batch),
            onChange: function(value) { row.batchId = value || null; }
        });
        card.appendChild(field('Партия сырья', batchRef));

        var amount = numInput(row.amount, '0');
        amount.addEventListener('input', function() { row.amount = amount.value; });
        card.appendChild(field('Израсходовано, м²', amount));

        var actions = el('div', { class: 'atex-sl-row-actions' });
        var saveBtn = el('button', { class: 'atex-sl-btn atex-sl-btn-primary', type: 'button', text: 'Списать' });
        saveBtn.addEventListener('click', function() { self.saveConsumption(row); });
        actions.appendChild(saveBtn);
        var delBtn = el('button', { class: 'atex-sl-btn atex-sl-btn-del', type: 'button', title: 'Удалить списание', text: '×' });
        delBtn.addEventListener('click', function() { self.deleteConsumption(row, idx); });
        actions.appendChild(delBtn);
        card.appendChild(actions);
        return card;
    };

    // #3459: События смены — только список событий + кнопки быстрых действий.
    // Поля ввода (значение, примечания) убраны — события пишутся без доп. полей.
    AtexSlitter.prototype.renderEvents = function() {
        var self = this;
        var section = el('section', { class: 'atex-sl-section' }, [
            el('h3', { class: 'atex-sl-section-title', text: 'События смены' })
        ]);

        // Кнопки быстрых событий (без полей ввода)
        var buttons = el('div', { class: 'atex-sl-event-buttons' });
        ['Обед', 'Переналадка', 'Счётчик', 'Брак'].forEach(function(type) {
            var btn = el('button', { class: 'atex-sl-btn atex-sl-btn-secondary', type: 'button', text: type });
            btn.addEventListener('click', function() { self.addQuickEvent(type); });
            buttons.appendChild(btn);
        });
        var closeBtn = el('button', { class: 'atex-sl-btn', type: 'button', text: 'Закрыть смену' });
        closeBtn.addEventListener('click', function() { self.closeShift(); });
        buttons.appendChild(closeBtn);
        section.appendChild(buttons);

        // Хронология событий смены
        var list = el('div', { class: 'atex-sl-events' });
        if (!this.shiftEvents.length) {
            list.appendChild(el('div', { class: 'atex-sl-empty', text: 'Событий смены ещё нет.' }));
        } else {
            this.shiftEvents.slice(0, 16).forEach(function(ev) {
                list.appendChild(el('div', { class: 'atex-sl-event' }, [
                    el('span', { class: 'atex-sl-event-when', text: ev.when }),
                    el('span', { class: 'atex-sl-event-type', text: ev.type }),
                    el('span', { class: 'atex-sl-event-val', text: ev.value !== '' ? String(ev.value) : (ev.cutId ? ('Резка ' + ev.cutId) : '') }),
                    el('span', { class: 'atex-sl-event-note', text: ev.notes || '' })
                ]));
            });
        }
        section.appendChild(list);
        return section;
    };

    // ── Действия / сохранение ──

    // Реквизиты резки в форме _m_set (t{reqId} по именам из метаданных).
    AtexSlitter.prototype.cutFields = function(cut) {
        var meta = this.meta.cut;
        var fields = {};
        function set(reqName, value) {
            var rid = reqIdByName(meta, reqName);
            if (rid) fields['t' + rid] = value;
        }
        function num(v) { return (v === '' || v == null) ? '' : core.toNumber(v); }
        set(CUT_REQ.status, core.normalizeStatus(cut.status));
        set(CUT_REQ.counterStart, num(cut.counterStart));
        set(CUT_REQ.counterEnd, num(cut.counterEnd));
        // #3459: погонаж вычисляемый, в БД не пишется
        set(CUT_REQ.defectM, num(cut.defectM));
        var defM2 = core.defectM2(cut.defectM, cut.materialWidthMm);
        if (defM2 > 0) set(CUT_REQ.defect, defM2);
        set(CUT_REQ.notes, cut.notes || '');
        return fields;
    };

    // #3433: при завершении резки зафиксировать фактически произведённые рулоны в её
    // «Партиях ГП»: «Кол-во факт» = «Кол-во полос» (за проход) × факт. проходов (погонаж
    // факт ÷ метраж прогона, фолбэк план). Без метаданных/реквизита «Партии ГП» —
    // тихо пропускаем; ошибка чтения/записи не валит смену статуса (факт уточнит склад).
    AtexSlitter.prototype.recordActualRolls = function(cut) {
        var self = this;
        var fb = this.meta.finishedBatch;
        if (!fb || !cut) return Promise.resolve();
        var actualReq = reqIdByName(fb, FINISHED_BATCH_REQ.actual);
        if (!actualReq) return Promise.resolve();
        var stripsIdx = colIndex(fb, FINISHED_BATCH_REQ.strips);
        var actualRuns = core.actualRunsFromMeterage(cut.meterage, cut.runLength, cut.plannedRuns);
        return this.getJson('object/' + fb.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(cut.id) + '&LIMIT=0,500').then(function(rows) {
            var chain = Promise.resolve();
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                var strips = stripsIdx >= 0 ? r[stripsIdx] : '';
                var rolls = core.actualRollsForStrip(strips, actualRuns);
                if (rolls === '') return;
                chain = chain.then(function() {
                    var f = {}; f['t' + actualReq] = rolls;
                    return self.post('_m_set/' + rec.i + '?JSON', f);
                });
            });
            return chain;
        }).catch(function(err) {
            console.warn('[slitter] recordActualRolls:', err && err.message);
        });
    };

    // #3459: Быстрое событие без дополнительных полей (Пауза, Обед, Переналадка...).
    AtexSlitter.prototype.addQuickEvent = function(type) {
        var self = this;
        if (this.busy || !this.currentCutId) return;
        this.setBusy(true);
        this.createEvent({ type: type }, this.currentCutId).then(function() {
            return self.loadEvents(self.currentCutId);
        }).then(function() {
            self.setBusy(false);
            self.notify('Событие «' + type + '» зафиксировано', 'success');
            self.renderMain();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Не удалось записать событие: ' + err.message, 'error');
        });
    };

    // #3459: Пропустить резку (Ожидает → остаётся Ожидает, пишется событие «Пропуск» с примечанием).
    AtexSlitter.prototype.skipCut = function() {
        var self = this;
        var cut = this.currentCut;
        if (this.busy || !cut) return;
        var reason = (typeof window !== 'undefined' && window.prompt)
            ? window.prompt('Причина пропуска (обязательно):', '')
            : '';
        if (!reason || !String(reason).trim()) {
            this.notify('Укажите причину пропуска', 'error');
            return;
        }
        this.setBusy(true);
        this.createEvent({ type: 'Пропуск', notes: String(reason).trim() }, cut.id).then(function() {
            return self.loadEvents(cut.id);
        }).then(function() {
            self.setBusy(false);
            self.notify('Резка пропущена: ' + reason, 'success');
            self.render();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка: ' + err.message, 'error');
        });
    };

    // #3459: Отменить резку (В работе → Ожидает, пишется событие «Отмена» с примечанием).
    AtexSlitter.prototype.cancelCut = function() {
        var self = this;
        var cut = this.currentCut;
        if (this.busy || !cut) return;
        var reason = (typeof window !== 'undefined' && window.prompt)
            ? window.prompt('Причина отмены (обязательно):', '')
            : '';
        if (!reason || !String(reason).trim()) {
            this.notify('Укажите причину отмены', 'error');
            return;
        }
        this.setBusy(true);
        var rid = reqIdByName(this.meta.cut, CUT_REQ.status);
        if (!rid) {
            this.setBusy(false);
            this.notify('Реквизит «Статус» не найден', 'error');
            return;
        }
        var fields = {};
        fields['t' + rid] = 'Ожидает';
        this.post('_m_set/' + cut.id + '?JSON', fields).then(function() {
            cut.status = 'Ожидает';
            self.cuts.forEach(function(c) {
                if (String(c.id) === String(cut.id)) c.status = 'Ожидает';
            });
            return self.createEvent({ type: 'Отмена', notes: String(reason).trim() }, cut.id);
        }).then(function() {
            return self.loadEvents(cut.id);
        }).then(function() {
            self.setBusy(false);
            self.notify('Резка отменена: ' + reason, 'success');
            self.render();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка отмены: ' + err.message, 'error');
        });
    };

    // #3459: Завершить резку с проверками и обновлением партии.
    // Проверяет: счётчик нач., счётчик кон., погонаж факт заполнены.
    // Счётчик кон. → «Остаток, м» партии. Ставит «Закончено», сбрасывает «В работе».
    AtexSlitter.prototype.finishCut = function() {
        var self = this;
        var cut = this.currentCut;
        if (this.busy || !cut) return;

        // Проверки заполнения
        var cStart = core.toNumber(cut.counterStart);
        var cEnd = core.toNumber(cut.counterEnd);
        var meterage = core.meterageFromCounters(cut.counterStart, cut.counterEnd);
        if (!(cStart > 0)) { this.notify('Заполните «Счётчик нач.» перед завершением', 'error'); return; }
        if (!(cEnd > 0)) { this.notify('Заполните «Счётчик кон.» перед завершением', 'error'); return; }
        if (meterage <= 0) { this.notify('Погонаж факт не может быть нулевым (счётчик кон. > счётчик нач.)', 'error'); return; }

        this.setBusy(true);

        // 1. Обновить статус резки на «Завершена» + заполнить погонаж и Закончено
        var meta = this.meta.cut;
        var statusRid = reqIdByName(meta, CUT_REQ.status);
        var meterageRid = reqIdByName(meta, CUT_REQ.meterage);
        var finishedReqName = 'Закончено';
        var finishedRid = reqIdByName(meta, finishedReqName) || reqIdByAnyName(meta, ['Закончено', 'Дата завершения', 'Завершено', 'finished_at']);
        var activeReqName = 'В работе';
        var activeRid = reqIdByAnyName(meta, [activeReqName, 'Активно', 'Действует']);

        var fields = {};
        if (statusRid) fields['t' + statusRid] = 'Завершена';
        if (meterageRid) fields['t' + meterageRid] = meterage;
        if (finishedRid) fields['t' + finishedRid] = this.eventDateTime();

        this.post('_m_set/' + cut.id + '?JSON', fields).then(function() {
            cut.status = 'Завершена';
            cut.meterage = String(meterage);
            self.cuts.forEach(function(c) {
                if (String(c.id) === String(cut.id)) {
                    c.status = 'Завершена';
                }
            });

            // 2. Счётчик кон. → «Остаток, м» партии сырья резки
            var batch = cut.batchId ? self.findBatch(cut.batchId) : null;
            var batchMeta = self.meta.batch;
            if (!batch || !batchMeta) return null;
            var remReq = reqIdByName(batchMeta, BATCH_REQ.remainderM);
            if (!remReq) return null;
            var newRem = cEnd; // счётчик кон. становится новым остатком, м
            var bf = {};
            bf['t' + remReq] = newRem;
            // Сброс флага «В работе» у партии
            if (activeRid && batchMeta) {
                var batchActiveReq = reqIdByAnyName(batchMeta, ['В работе', 'Активно', 'Активная', 'Действует']);
                if (batchActiveReq) bf['t' + batchActiveReq] = '';
            }
            return self.post('_m_set/' + batch.id + '?JSON', bf).then(function() {
                batch.remainderM = newRem;
                if (typeof batch.active !== 'undefined') batch.active = '';
            });
        }).then(function() {
            // 3. Событие «Завершение резки»
            return self.createEvent({ type: 'Завершение резки', value: String(meterage) }, cut.id);
        }).then(function() {
            return self.loadEvents(cut.id);
        }).then(function() {
            // #3433: зафиксировать факт рулонов в «Партиях ГП»
            return self.recordActualRolls(cut);
        }).then(function() {
            return self.loadBatches();
        }).then(function() {
            self.setBusy(false);
            self.notify('Резка завершена. Погонаж: ' + meterage + ' м. Остаток партии: ' + (cut.batchId ? self.findBatch(cut.batchId) : {}).remainderM + ' м', 'success');
            self.render();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка завершения: ' + err.message, 'error');
        });
    };

    // Установка статуса (не финального) — для переходов Ожидает→В работе и кликов по степперу.
    // Завершение резки — через finishCut() с проверками и обновлением партии (#3459).
    AtexSlitter.prototype.setStatus = function(status, eventType) {
        var self = this;
        var cut = this.currentCut;
        if (this.busy || !cut) return;
        var newStatus = core.normalizeStatus(status);
        // Финальный статус — только через finishCut
        if (core.isDone(newStatus)) {
            this.notify('Для завершения резки используйте кнопку «Завершить»', 'error');
            return;
        }
        cut.status = newStatus;
        this.setBusy(true);
        var rid = reqIdByName(this.meta.cut, CUT_REQ.status);
        if (!rid) {
            this.setBusy(false);
            this.notify('Реквизит «Статус» не найден', 'error');
            return;
        }
        var fields = {};
        fields['t' + rid] = cut.status;
        var startedReq = reqIdByAnyName(this.meta.cut, CUT_STARTED_NAMES);
        if (startedReq && cut.status === 'В работе' && !cut.startedAt) {
            cut.startedAt = this.eventDateTime();
            fields['t' + startedReq] = cut.startedAt;
        }
        this.post('_m_set/' + cut.id + '?JSON', fields).then(function() {
            self.cuts.forEach(function(c) {
                if (String(c.id) === String(cut.id)) {
                    c.status = cut.status;
                    if (cut.startedAt) c.startedAt = cut.startedAt;
                }
            });
            if (eventType) return self.createEvent({ type: eventType }, cut.id);
            return null;
        }).then(function() {
            return self.loadEvents(cut.id);
        }).then(function() {
            self.setBusy(false);
            self.notify('Статус: ' + cut.status, 'success');
            self.render();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Не удалось сменить статус: ' + err.message, 'error');
        });
    };

    // #3459: Сохраняет показания (счётчики, брак, примечания) в резку. Погонаж вычисляемый,
    // в БД не пишется. Остаток партии обновляется только при завершении резки (finishCut).
    AtexSlitter.prototype.saveReadings = function() {
        var self = this;
        var cut = this.currentCut;
        if (this.busy || !cut) return;
        this.setBusy(true);
        // Сохраняем поля резки (без meterage — он вычисляемый)
        this.post('_m_set/' + cut.id + '?JSON', this.cutFields(cut)).then(function() {
            self.setBusy(false);
            self.notify('Показания сохранены', 'success');
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка сохранения: ' + err.message, 'error');
        });
    };

    AtexSlitter.prototype.uploadDefectPhoto = function(file, statusEl) {
        var self = this;
        var cut = this.currentCut;
        if (this.busy || !cut) return;
        var reqId = reqIdByName(this.meta.cut, CUT_REQ.defectPhoto);
        var key = core.photoFieldKey(reqId);
        if (!key) { this.notify('Реквизит «Фото брака» не найден', 'error'); return; }
        this.setBusy(true);
        if (statusEl) statusEl.textContent = 'загрузка…';
        this.postFile('_m_set/' + cut.id + '?JSON', key, file).then(function() {
            self.setBusy(false);
            // флаг «фото есть» (серверное значение подтянется при следующей загрузке резки)
            cut.defectPhoto = '1';
            if (statusEl) statusEl.textContent = 'фото загружено';
            self.notify('Фото брака загружено', 'success');
        }).catch(function(err) {
            self.setBusy(false);
            if (statusEl) statusEl.textContent = 'ошибка';
            self.notify('Ошибка загрузки фото: ' + err.message, 'error');
        });
    };

    // Списание расхода: создаёт/обновляет «Расход сырья» и уменьшает остаток
    // партии на разницу (дельту) израсходованного — критерий приёмки §3.5.
    AtexSlitter.prototype.saveConsumption = function(row) {
        var self = this;
        if (this.busy) return;
        if (!this.currentCutId) { this.notify('Сначала выберите резку', 'error'); return; }
        if (!row.batchId) { this.notify('Выберите партию сырья', 'error'); return; }
        var amount = core.toNumber(row.amount);
        if (amount <= 0) { this.notify('Укажите израсходовано, м² (> 0)', 'error'); return; }

        var meta = this.meta.consumption;
        var batchMeta = this.meta.batch;
        var amountReq = reqIdByName(meta, CONS_REQ.amount);
        var batchReq = reqIdByName(meta, CONS_REQ.batch);
        var delta = amount - core.toNumber(row.savedAmount); // сколько ещё списать с остатка
        var batch = this.findBatch(row.batchId);

        this.setBusy(true);
        var fields = {};
        if (amountReq) fields['t' + amountReq] = amount;
        if (batchReq) fields['t' + batchReq] = row.batchId;

        var save;
        if (row.id) {
            save = this.post('_m_set/' + row.id + '?JSON', fields).then(function() { return row.id; });
        } else {
            var createParams = {};
            Object.keys(fields).forEach(function(k) { createParams[k] = fields[k]; });
            createParams['t' + meta.id] = 'Расход ' + (this.consumptions.indexOf(row) + 1);
            save = this.post('_m_new/' + meta.id + '?JSON&up=' + encodeURIComponent(this.currentCutId), createParams)
                .then(function(res) {
                    var id = res && (res.obj || res.id || res.i);
                    if (!id) throw new Error('Сервер не вернул id записи расхода');
                    row.id = String(id);
                    return row.id;
                });
        }

        save.then(function() {
            // Списываем дельту с остатка партии (если есть метаданные партии).
            if (!batch || !batchMeta || delta === 0) return null;
            var remReq = reqIdByName(batchMeta, BATCH_REQ.remainder);
            if (!remReq) return null;
            var newRem = delta > 0
                ? core.applyConsumption(batch.remainder, delta)
                : core.restoreConsumption(batch.remainder, -delta);
            var bf = {};
            bf['t' + remReq] = newRem;
            return self.post('_m_set/' + batch.id + '?JSON', bf).then(function() { batch.remainder = newRem; });
        }).then(function() {
            row.savedAmount = amount;
            return self.loadBatches();
        }).then(function() {
            self.setBusy(false);
            self.notify('Списано ' + amount + ' м²; остаток партии уменьшен', 'success');
            self.renderMain();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка списания: ' + err.message, 'error');
        });
    };

    AtexSlitter.prototype.deleteConsumption = function(row, idx) {
        var self = this;
        if (this.busy) return;
        // Новая (несохранённая) строка — просто убираем из формы.
        if (!row.id) { this.consumptions.splice(idx, 1); this.renderMain(); return; }

        var batchMeta = this.meta.batch;
        var batch = this.findBatch(row.batchId);
        var restore = core.toNumber(row.savedAmount); // вернуть на остаток
        this.setBusy(true);
        this.post('_m_del/' + row.id + '?JSON', {}).then(function() {
            // Возвращаем списанное на остаток партии.
            if (!batch || !batchMeta || restore <= 0) return null;
            var remReq = reqIdByName(batchMeta, BATCH_REQ.remainder);
            if (!remReq) return null;
            var newRem = core.restoreConsumption(batch.remainder, restore);
            var bf = {};
            bf['t' + remReq] = newRem;
            return self.post('_m_set/' + batch.id + '?JSON', bf).then(function() { batch.remainder = newRem; });
        }).then(function() {
            return Promise.all([self.loadConsumptions(self.currentCutId), self.loadBatches()]);
        }).then(function() {
            self.setBusy(false);
            self.notify('Списание отменено, остаток партии возвращён', 'success');
            self.renderMain();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка удаления: ' + err.message, 'error');
        });
    };

    AtexSlitter.prototype.findBatch = function(batchId) {
        return this.batches.filter(function(b) { return String(b.id) === String(batchId); })[0] || null;
    };

    // Событие смены: пишется с датой/временем (главное значение), типом,
    // оператором и, если применимо, ссылкой/родителем резки.
    AtexSlitter.prototype.createEvent = function(data, cutId) {
        var meta = this.meta.event;
        if (!meta) return Promise.reject(new Error('Таблица «' + TABLE.event + '» не найдена'));

        var when = this.eventDateTime();
        var params = {};
        params['t' + meta.id] = when; // главное значение — дата/время (хронология)
        var typeReq = reqIdByName(meta, EVENT_REQ.type);
        var cutReq = reqIdByAnyName(meta, [EVENT_REQ.cut, 'Производственная резка']); // #3504: старое имя запасным
        var userReq = reqIdByName(meta, EVENT_REQ.user);
        var valReq = reqIdByName(meta, EVENT_REQ.value);
        var notesReq = reqIdByName(meta, EVENT_REQ.notes);
        if (typeReq && data.type) params['t' + typeReq] = data.type;
        if (cutReq && cutId) params['t' + cutReq] = cutId;
        if (userReq && this.userId) params['t' + userReq] = this.userId;
        if (valReq && data.value !== '' && data.value != null) params['t' + valReq] = core.toNumber(data.value);
        if (notesReq && data.notes) params['t' + notesReq] = data.notes;
        return this.post('_m_new/' + meta.id + '?JSON&up=' + encodeURIComponent(cutId || 1), params);
    };

    AtexSlitter.prototype.addEvent = function(data) {
        var self = this;
        if (this.busy) return;
        if (!this.currentCutId) { this.notify('Сначала выберите резку', 'error'); return; }

        this.setBusy(true);
        this.createEvent(data, this.currentCutId).then(function() {
            return self.loadEvents(self.currentCutId);
        }).then(function() {
            self.setBusy(false);
            self.notify('Событие «' + (data.type || 'смены') + '» зафиксировано', 'success');
            self.renderMain();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Не удалось записать событие: ' + err.message, 'error');
        });
    };

    AtexSlitter.prototype.openShift = function() {
        var self = this;
        if (this.busy) return;
        if (!this.selectedSlitterId) { this.notify('Выберите станок', 'error'); return; }
        this.setBusy(true);
        this.createEvent({
            type: 'Начало смены',
            notes: [this.selectedSlitterLabel(), this.selectedDate].filter(Boolean).join(' · ')
        }, null).then(function() {
            return self.loadShiftEvents();
        }).then(function() {
            self.setBusy(false);
            self.notify('Смена открыта', 'success');
            self.render();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Не удалось открыть смену: ' + err.message, 'error');
        });
    };

    AtexSlitter.prototype.closeShift = function() {
        var self = this;
        if (this.busy) return;
        this.setBusy(true);
        this.createEvent({
            type: 'Конец смены',
            notes: [this.selectedSlitterLabel(), this.selectedDate].filter(Boolean).join(' · ')
        }, null).then(function() {
            self.currentCutId = null;
            self.currentCut = null;
            self.selectedBatchIds = [];
            return self.loadShiftEvents();
        }).then(function() {
            self.setBusy(false);
            self.notify('Смена закрыта', 'success');
            self.render();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Не удалось закрыть смену: ' + err.message, 'error');
        });
    };

    AtexSlitter.prototype.openCut = function(cutId) {
        var self = this;
        this.setBusy(true);
        this.currentCutId = String(cutId);
        this.loadCut(cutId)
            .then(function() {
                self.resolveCutWidth();
                self.selectedBatchIds = [];
                self.syncInitialBatchSelection();
                return Promise.all([
                    self.loadStrips(cutId),       // #3460: полосы для метрик и раскладки
                    self.loadCutMaterial(),       // #3460: вид сырья для шапки
                    self.loadConsumptions(cutId),
                    self.loadEvents(cutId)
                ]);
            }).then(function() {
                self.resolveCutWidth();  // #3460: уточнить ширину входа после loadCutMaterial
                self.setBusy(false);
                self.render();
            }).catch(function(err) {
                self.setBusy(false);
                self.notify('Не удалось открыть резку: ' + err.message, 'error');
            });
    };

    AtexSlitter.prototype.setBusy = function(on) {
        this.busy = on;
        if (this.root) this.root.classList.toggle('is-busy', !!on);
    };

    // Уведомления без alert/confirm/prompt (раздел 8 гайда): встроенный тост,
    // либо общий MainAppController, если он доступен в main.html.
    AtexSlitter.prototype.notify = function(message, kind) {
        if (kind === 'error' && typeof window !== 'undefined' && window.mainAppController &&
            typeof window.mainAppController.showErrorModal === 'function') {
            window.mainAppController.showErrorModal(message);
            return;
        }
        var toast = el('div', { class: 'atex-sl-toast atex-sl-toast-' + (kind || 'info'), text: message });
        (this.toastHost || document.body).appendChild(toast);
        setTimeout(function() { toast.classList.add('is-visible'); }, 10);
        setTimeout(function() {
            toast.classList.remove('is-visible');
            setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
        }, 3500);
    };

    AtexSlitter.prototype.fatal = function(message) {
        this.root.innerHTML = '';
        this.root.appendChild(el('div', { class: 'atex-sl-fatal', text: message }));
    };

    // #3460: восстановленный из localStorage станок мог исчезнуть из справочника —
    // тогда сбрасываем выбор, чтобы не показывать пустую очередь без объяснения.
    AtexSlitter.prototype.validateStoredSlitter = function() {
        if (!this.selectedSlitterId) return;
        var id = String(this.selectedSlitterId);
        var exists = this.slitterOptions().some(function(item) { return String(item.id) === id; });
        if (!exists) { this.selectedSlitterId = ''; this.storeSelectedSlitter(); }
    };

    AtexSlitter.prototype.start = function() {
        var self = this;
        this.root.innerHTML = '';
        this.toolbarEl = el('div', { class: 'atex-sl-toolbar' });
        this.root.appendChild(this.toolbarEl);
        var layout = el('div', { class: 'atex-sl-layout' });

        var aside = el('aside', { class: 'atex-sl-sidebar' });
        var head = el('div', { class: 'atex-sl-sidebar-head' }, [ el('h2', { text: 'Резки станка' }) ]);
        var filter = el('label', { class: 'atex-sl-filter' });
        var cb = el('input', { type: 'checkbox' });
        cb.addEventListener('change', function() { self.includeDone = cb.checked; self.renderCuts(); });
        filter.appendChild(cb);
        filter.appendChild(el('span', { text: 'Отобразить завершённые' }));
        head.appendChild(filter);
        aside.appendChild(head);
        this.cutsEl = el('div', { class: 'atex-sl-cuts' });
        aside.appendChild(this.cutsEl);

        this.mainEl = el('section', { class: 'atex-sl-main' });
        layout.appendChild(aside);
        layout.appendChild(this.mainEl);
        this.root.appendChild(layout);
        this.toastHost = this.root;

        this.cutsEl.appendChild(el('div', { class: 'atex-sl-loading', text: 'Загрузка…' }));
        this.mainEl.appendChild(el('div', { class: 'atex-sl-placeholder', text: 'Загрузка данных…' }));

        return this.loadMetadata()
            .then(function() { return Promise.all([self.loadSlitters(), self.loadBatches(), self.loadCuts(), self.loadMaterialWidths()]); })
            .then(function() { self.validateStoredSlitter(); return self.loadShiftEvents(); })
            .then(function() { self.render(); })
            .catch(function(err) { self.fatal('Ошибка инициализации: ' + err.message); });
    };

    function init() {
        if (typeof document === 'undefined') return;
        var root = document.getElementById('atex-slitter');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        var controller = new AtexSlitter(root);
        root._atexSlitter = controller;
        controller.start();
    }

    // Общие мелкие фабрики DOM, используемые в нескольких методах.
    function numInput(value, placeholder) {
        var inp = el('input', { class: 'atex-sl-input', type: 'number', min: '0', step: 'any', placeholder: placeholder || '0' });
        inp.value = value == null ? '' : value;
        return inp;
    }
    function field(label, control) {
        return el('label', { class: 'atex-sl-field' }, [
            el('span', { class: 'atex-sl-label', text: label }),
            control
        ]);
    }

    return { core: core, Controller: AtexSlitter, init: init };
});
