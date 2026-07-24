// Рабочее место atex «Пульт слиттера» (роль Оператор, планшет).
//
// По назначенной производственной резке оператор: меняет статус
// (Ожидает → Наладка → В работе → Завершён), вводит показания счётчика
// (нач./кон., счётчик мотает назад — остаток рулона), погонаж факт и брак; списывает расход сырья по партиям (FIFO),
// что уменьшает остаток партии; фиксирует события смены с датой/временем.
// Решение задачи ideav/crm#2915 (часть #2903). Правила разработки рабочих мест —
// docs/WORKSPACE_DEVELOPMENT_GUIDE.md, карта рабочих мест — docs/atex_workplaces.md §3.5.
//
// Запись данных идёт напрямую командами `_m_*` (#2903): статус/счётчики/погонаж/брак
// — `_m_set/{резкаId}`; событие — `_m_new/{Событие смены}`. ID таблиц и реквизитов не
// хардкодятся: берутся по именам из `GET /{db}/metadata` (WORKSPACE_DEVELOPMENT_GUIDE.md,
// разделы 3 и 6).
// #3674: чтения переведены на защищённый слой `report/` — slitter_cuts (очередь
// станка, FR_cut_slitter_id), slitter_shift_events (события), slitters_list (станки);
// партии — material_batches (#3460). Разбор строк отчётов — чистые core.rowsTo*. На
// случай отсутствия отчёта в сборке у каждого чтения тихий фолбэк на `object/`
// (loadCutsFromTable / loadShiftEventsFromTable / loadSlittersFromTable). Отчёты
// заводит docs/scripts/create_slitter_reports.py.
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
        rashod: 'Расход сырья',  // #3861: расход сырья, погонные метры (накопл. по резке)
        defect: 'Брак, м²',
        defectM: 'Брак, м',
        defectPhoto: 'Фото брака',
        plannedRuns: 'Кол-во план',
        runLength: 'Метраж, м',
        startedAt: 'Начато',
        inWork: 'В работе',      // #3557: булев реквизит (1162) — резка открыта/занимает станок
        finishedAt: 'Закончено',  // #3557: DATETIME (16411) — момент завершения
        notes: 'Примечания',
        winding: 'Тип намотки',  // #3566 #2: направление намотки (28144)
        leader: 'Лидер'          // #3566 #2: лидер (82519, ссылка) — реквизит задания
    };
    var CUT_PLANNED_RUNS_NAMES = ['Кол-во резок план', 'Кол-во план'];
    var CUT_RUN_LENGTH_NAMES = ['Метраж, м', 'Погонаж план, м', 'Длина, м'];
    var CUT_STARTED_NAMES = ['Начато', 'Дата начала', 'Старт', 'Время начала'];
    // #3504: реквизит «Событие смены» переименован вслед за таблицей.
    // #4359: slitter — ссылка на станок («Слиттер», ref на справочник слиттеров): станок события
    // хранится ссылкой, а не только текстовой меткой в «Примечаниях».
    var EVENT_REQ ={ type: 'Тип события', cut: 'Задание в производство', user: 'Пользователь', value: 'Значение', notes: 'Примечания', slitter: 'Слиттер' };
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

    // Статусы резки. Базовая цепочка для очереди (Ожидает → В работе → Завершена);
    // фактический статус резки выводится из последнего события смены (#3557).
    var STATUSES = ['Ожидает', 'В работе', 'Завершена'];
    var DONE_STATUSES = ['Завершена', 'Завершён', 'Готова', 'Пропущена']; // #3646: «Пропущена» — терминальный (вышло из активной очереди, можно «Возобновить»)
    var WAIT_STATUSES = ['Ожидает', 'Запланирована', 'В очереди'];
    // #3557: типы событий, управляющие статусом резки (справочник «Тип события», 1193).
    var EV = {
        startCut: 'Начало резки', setup: 'Наладка', brk: 'Перерыв',
        resume: 'Возобновить', finish: 'Завершить', abort: 'Прекратить',
        shiftStart: 'Начало смены', shiftEnd: 'Конец смены',
        pass: 'Резка',  // #3583: отметка выполненного прохода (значение справочника «Тип события» 1193)
        skip: 'Пропуск', // #3646: пропуск задания (значение справочника «Тип события» 1193, id 89834)
        cleanup: 'Уборка завершена' // #3861: уборка по завершении всех резок (значение справочника «Тип события» 1193, id 176076)
    };
    // Типы событий смены (справочник «Тип события» базы ateh, 1193).
    var EVENT_TYPES = [EV.shiftStart, EV.startCut, EV.setup, EV.brk, EV.resume, EV.pass, EV.skip, EV.finish, EV.abort, EV.cleanup, EV.shiftEnd];

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

    // #4321: счётчик станка показывает, СКОЛЬКО СЫРЬЯ ОСТАЛОСЬ В РУЛОНЕ, и мотает НАЗАД:
    // «Счётчик нач.» = остаток партии перед резкой, «Счётчик кон.» = остаток после неё.
    // Погонаж = нач. − кон. (раньше считали наоборот, кон. − нач., и подставляли растущее
    // значение «Счётчика кон.» — issue #4321). Направление строгое: обратный ввод (кон. > нач.)
    // даёт 0, и завершение резки его не пропустит. Записи с прежней формулой заказчик чистит.
    function meterageFromCounters(start, end) {
        return round3(Math.max(0, toNumber(start) - toNumber(end)));
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

    // #3861: взаимный пересчёт остатка партии по номинальной ширине рулона (мм).
    // Основная мера — погонные метры; площадь (м²) досчитывается из метров и наоборот.
    //   L(м)  = S(м²) × 1000 / W(мм)
    //   S(м²) = L(м)  × W(мм) / 1000
    // Ширина ≤ 0 (неизвестна) → 0 (пересчёт невозможен).
    function metersFromArea(areaM2, widthMm) {
        var w = toNumber(widthMm);
        return w > 0 ? round3(toNumber(areaM2) * 1000 / w) : 0;
    }
    function areaFromMeters(meters, widthMm) {
        var w = toNumber(widthMm);
        return w > 0 ? round3(toNumber(meters) * w / 1000) : 0;
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

    // #3923: полный штамп planStart (не срезанный к дню, в отличие от dateKey) — задаёт порядок
    // резок внутри дня. Принимает unix-штамп (сек/мс) и ISO/строку; пусто/невалид → в конец.
    function planStartMs(value) {
        var s = String(value == null ? '' : value).trim();
        if (!s) return Infinity;
        if (/^\d{9,13}$/.test(s)) { var num = Number(s); return num >= 1e12 ? num : num * 1000; }
        var parsed = Date.parse(s);
        return isNaN(parsed) ? Infinity : parsed;
    }

    // #3923: порядок резок — строго по сохранённому planStart (planDate), как на РМ
    // «Планирование производства» и «Диаграмма Ганта» (единый источник порядка; «Очередность»
    // больше не хранится). Факт старта список не тасует.
    // #3646: завершённые БОЛЬШЕ НЕ уходят в конец — остаются на своих местах по времени
    // (видны в общем порядке вместе с активными).
    function compareCutsForQueue(a, b) {
        var ak = planStartMs(a && a.planDate), bk = planStartMs(b && b.planDate);
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
            // #3646: завершённые НЕ скрываем — показываем всегда (галка «Отобразить
            // завершённые» убрана, они видны в общем порядке очереди).
            return true;
        }).map(function(cut, i) { return { cut: cut, i: i }; }).sort(function(a, b) {
            return compareCutsForQueue(a.cut, b.cut) || a.i - b.i;
        }).map(function(x) { return x.cut; });

        // #3579: «первая открытая» в очереди = первая НЕ завершённая резка. Пока она не
        // завершена (в работе/наладке/перерыве/ожидает), все следующие «Ожидает» заблокированы
        // (isCutLocked) — нельзя запускать следующее задание, пока предыдущее не завершено.
        var firstOpen = null;
        for (var i = 0; i < list.length; i++) {
            if (!isDone(list[i].status)) { firstOpen = list[i]; break; }
        }
        return { cuts: list, firstOpenCutId: firstOpen ? String(firstOpen.id) : null };
    }

    // #4332 п.4: по завершении всех заданий выбранного дня показываем ОДНО следующее задание
    // из БУДУЩИХ дней — самое раннее НЕзавершённое задание этого станка со строго более поздним
    // календарным днём (dateKey > afterDateKey). Порядок — тот же, что в очереди (день→planStart).
    // Уже НАЧАТОЕ (в работе/наладке) будущее задание тоже вернётся (не завершено) → видно при
    // обновлении формы. Завершённые/пропущенные (isDone) и без «Дата план» — пропускаем.
    function nextFutureCut(cuts, opts) {
        return futureCutPool(cuts, opts).next;
    }

    // #4332 п.4 / #4365: задания станка в БУДУЩИХ днях (dateKey > afterDateKey, дата валидна)
    // → { pool, next }: весь набор в порядке очереди (день → planStart) и ближайшее
    // НЕзавершённое из него («следующее задание»).
    function futureCutPool(cuts, opts) {
        var o = opts || {};
        var sid = o.slitterId == null ? '' : String(o.slitterId);
        var after = Number(o.afterDateKey);
        var pool = (cuts || []).filter(function(cut) {
            if (sid && cutSlitterId(cut) !== sid) return false;
            var dk = dateKey(cut && cut.planDate);
            return isFinite(dk) && dk > after;   // только строго будущие дни с валидной датой
        }).map(function(cut, i) { return { cut: cut, i: i }; }).sort(function(a, b) {
            return compareCutsForQueue(a.cut, b.cut) || a.i - b.i;
        }).map(function(x) { return x.cut; });
        var next = null;
        pool.forEach(function(cut) { if (!next && !isDone(cut.status)) next = cut; });
        return { pool: pool, next: next };
    }

    // #4365: что показывать в секции «Следующее задание» сайдбара. Выполненные задания
    // будущих дней НЕ пропадают — оператор видит, что он уже сделал (раньше секция знала
    // только ближайшее НЕзавершённое, и по завершении задание исчезало вместе с секцией).
    // Ожидающее следующее по-прежнему предлагается ОДНО (#4332 п.4) и только когда в
    // выбранном дне не осталось открытых заданий — за это отвечает opts.withNext.
    // → { cuts: [...], nextId, nextDayKey } в порядке очереди (день → planStart).
    function futureCutsVisible(cuts, opts) {
        var o = opts || {};
        var res = futureCutPool(cuts, o);
        var withNext = o.withNext !== false;
        var next = withNext ? res.next : null;
        var list = res.pool.filter(function(cut) { return isDone(cut.status) || cut === next; });
        return {
            cuts: list,
            nextId: next ? String(next.id) : null,
            nextDayKey: next ? dateKey(next.planDate) : null
        };
    }

    // #3609: канонический ключ раскладки ножей резки (полосы «ширина×кол-во», порядок-
    // независимо; пустые 0×0 отбрасываем). Совпадение ключей = одинаковая конфигурация ножей.
    function knifeLayoutKey(strips) {
        return (strips || []).map(function(s) {
            return round3(toNumber(s.width)) + 'x' + Math.round(toNumber(s.qty) || 0);
        }).filter(function(x) { return x !== '0x0'; }).sort().join('|');
    }

    // #3737: набор ШИРИН полос резки как порядко-независимый ключ — без «Кол-ва полос».
    // Отчёт next_cut_setup отдаёт по строке на «Партию ГП» (ширина), без количества; полосы
    // резки (fetchStrips/cut_strips) тоже идут по записи на «Партию ГП», поэтому ключи
    // сравнимы. Совпадение = тот же набор ножей. Принимает строки полос {width} или числа.
    // Пустые/нулевые ширины отбрасываем.
    function widthSetKey(items) {
        return (items || []).map(function(s) {
            return round3(toNumber(s != null && typeof s === 'object' ? s.width : s));
        }).filter(function(w) { return w > 0; }).sort(function(a, b) { return a - b; }).join('|');
    }

    // #3737: начало КАЛЕНДАРНОГО дня «Даты план» резки как unix-штамп (секунды) — нижняя
    // граница FR_task_start для отчёта next_cut_setup. Полночь берём в локальной зоне (как
    // dateKey), чтобы сравнение дня было согласовано. Пусто/не штамп → null.
    function dayStartTimestamp(value) {
        var s = String(value == null ? '' : value).trim();
        if (!/^\d{9,13}$/.test(s)) return null;
        var num = Number(s);
        var ms = num >= 1e12 ? num : num * 1000;
        var d = new Date(ms);
        if (isNaN(d.getTime())) return null;
        return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime() / 1000);
    }

    // #3737: конфигурация первой резки СЛЕДУЮЩЕГО календарного дня (после curDayKey) для
    // станка из строк отчёта next_cut_setup (93371). Отчёт идёт по расписанию (task_start ↑),
    // по строке на «Партию ГП»: ширина (width), сырьё (material_id), намотка (wind_dir). Берём
    // задание с наименьшим task_start в дне позже текущего и собираем все его полосы.
    // → { taskId, taskStart, widthKey, materialId } | null. Чистая → покрыта тестом.
    function nextDaySetupConfig(rows, curDayKey) {
        var sorted = (rows || []).slice().sort(function(a, b) {
            return (toNumber(a.task_start) - toNumber(b.task_start)) ||
                   (toNumber(a.batch_ord) - toNumber(b.batch_ord));
        });
        var firstId = null, firstStart = null;
        for (var i = 0; i < sorted.length; i++) {
            var dk = dateKey(sorted[i].task_start);
            if (dk !== Infinity && dk > curDayKey) {
                firstId = String(sorted[i].task_id);
                firstStart = String(sorted[i].task_start);
                break;
            }
        }
        if (firstId == null) return null;
        var widths = [], materialId = '';
        sorted.forEach(function(r) {
            if (String(r.task_id) === firstId && String(r.task_start) === firstStart) {
                widths.push(r.width);
                if (!materialId) materialId = String(r.material_id == null ? '' : r.material_id);
            }
        });
        return { taskId: firstId, taskStart: firstStart, widthKey: widthSetKey(widths), materialId: materialId };
    }

    // #3609: для выбранной резки — последняя ли она в смене (день+станок) и первая резка
    // СЛЕДУЮЩЕГО дня на этом же станке (ближайший день с резками > текущего). Порядок
    // внутри дня — по planStart (#3923), затем id. → { isLast, nextCut|null }.
    function shiftContinuation(cuts, cut) {
        var out = { isLast: false, nextCut: null };
        if (!cut) return out;
        var sl = cutSlitterId(cut), dk = dateKey(cut.planDate);
        function ord(a, b) {
            return (planStartMs(a && a.planDate) - planStartMs(b && b.planDate)) || String((a && a.id) || '').localeCompare(String((b && b.id) || ''), 'ru');
        }
        var same = (cuts || []).filter(function(c) { return cutSlitterId(c) === sl; });
        var today = same.filter(function(c) { return dateKey(c.planDate) === dk; }).slice().sort(ord);
        out.isLast = today.length > 0 && String(today[today.length - 1].id) === String(cut.id);
        var nextDk = Infinity;
        same.forEach(function(c) { var k = dateKey(c.planDate); if (k > dk && k < nextDk) nextDk = k; });
        if (nextDk !== Infinity) {
            var nd = same.filter(function(c) { return dateKey(c.planDate) === nextDk; }).slice().sort(ord);
            out.nextCut = nd[0] || null;
        }
        return out;
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

    // #3522: станок события смены. «Начало/Конец смены» пишут «Примечания» вида
    // «{станок} · {дата}» — станок = первый сегмент до « · ». Пусто, если метки нет.
    // #4359: это ЗАПАСНОЙ путь — для событий, записанных до появления ссылки «Слиттер».
    function shiftEventSlitterLabel(event) {
        var notes = String(event && event.notes != null ? event.notes : '').trim();
        if (!notes) return '';
        return notes.split('·')[0].trim();
    }

    // #4359: станок события — по ссылке «Слиттер» (реквизит события; в отчёте
    // slitter_shift_events это поле slitter_id). Сверяем id с id — подпись станка может
    // измениться в справочнике, ссылка при этом остаётся верной. У событий, записанных до
    // появления реквизита, ссылки нет — для них остаётся метка в «Примечаниях» (#3522).
    // Фильтр не задан (ни id, ни подписи) — событие подходит.
    function shiftEventMatchesSlitter(event, slitterId, slitterLabel) {
        var wantId = String(slitterId == null ? '' : slitterId).trim();
        var wantLabel = String(slitterLabel == null ? '' : slitterLabel).trim();
        if (!wantId && !wantLabel) return true;
        var haveId = String(event && event.slitterId != null ? event.slitterId : '').trim();
        if (wantId && haveId) return haveId === wantId;
        if (!wantLabel) return false;
        return shiftEventSlitterLabel(event) === wantLabel;
    }

    // #3522: смена считается ОТДЕЛЬНО для каждого станка. Если станок задан — учитываем
    // только события смены этого станка; без него фильтр по станку не применяется.
    // #4359: станок берём из ссылки «Слиттер» события (slitterId), подпись — запасной путь
    // для старых событий (см. shiftEventMatchesSlitter).
    // #4332 п.2: открытость смены определяется по ПОСЛЕДНЕМУ событию «Начало смены»/
    // «Конец смены» этого станка НЕЗАВИСИМО от дня (фильтр по выбранному дню снят). Так
    // оператор под одной открытой сменой может выполнять задания будущих дней (#4332 п.4).
    // Параметр date оставлен для совместимости сигнатуры, но на выбор смены не влияет.
    function hasOpenShift(events, userId, date, slitterLabel, slitterId) {
        var last = null, lastKey = -Infinity, lastIdx = -1;
        (events || []).forEach(function(event, i) {
            if (!eventMatchesUser(event, userId)) return;
            if (!isShiftStartType(event.type) && !isShiftEndType(event.type)) return;
            if (!shiftEventMatchesSlitter(event, slitterId, slitterLabel)) return;
            // #4332: порядок между днями — по хронологии (unix-сек), тай-брейк по индексу.
            var key = eventWhenSeconds(event.when);
            if (!isFinite(key)) key = -Infinity;   // невалидное время — не должно вытеснять валидные
            if (key > lastKey || (key === lastKey && i > lastIdx)) { last = event; lastKey = key; lastIdx = i; }
        });
        return !!(last && isShiftStartType(last.type));
    }

    function runLengthForCut(cut) {
        return coreToNumber(cut && (cut.runLength || cut.length || cut.plannedRunLength));
    }

    function plannedRunsForCut(cut) {
        var runs = coreToNumber(cut && (cut.plannedRuns || cut.runCount || cut.runs));
        return runs > 0 ? Math.ceil(runs) : 1;
    }

    // #3635 п.5: задание-«настройка» — хвост дня N перед намоткой дня N+1. Это запись с
    // «Кол-во резок план» ЯВНО «0» (день-разрыв оставил настройку ножей/сырья в конце дня).
    // Намотки у неё нет; в пульте показываем «Настройка ножей и сырья», оператор отмечает
    // «Наладка» → «Готово» (обычный статус-флоу, без проходов/обязательной партии).
    // Реальные резки всегда с проходами >0, поэтому явный «0» однозначно опознаёт настройку.
    function isSetupTask(cut) {
        return String(cut && cut.plannedRuns == null ? '' : cut.plannedRuns).trim() === '0';
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

    // #3646: вторая строка карточки списка — время начала–окончания резки. Фактические
    // «Начато»–«Закончено» (завершённая → «8:08 – 8:55»); начата, но не завершена →
    // «8:08 – …»; не начата → плановый старт (planDate) без конца. Пусто → ''.
    function cutQueueTime(cut) {
        if (!cut) return '';
        var startStr = formatClock(cut.startedAt || cut.planDate || '');
        if (!startStr) return '';
        var endStr = cut.finishedAt ? formatClock(cut.finishedAt) : '';
        if (endStr) return startStr + ' – ' + endStr;
        if (cut.startedAt) return startStr + ' – …';
        return startStr;
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
                // #3861: номинальная ширина рулона из отчёта — для взаимопересчёта остатка м↔м².
                widthMm: toNumber(firstField(row, ['width_mm', 'batch_width_mm', 'material_width_mm'])),
                materialId: matId || null,
                materialLabel: matLabel,
                warehouse: wh,
                foreign: isForeignWarehouse(wh, foreign),
                active: firstField(row, ['is_active', 'batch_is_active', 'active']) || '1',
                barcode: firstField(row, ['batch_barcode', 'barcode', 'batch_no'])
            };
        });
    }

    // #3674: разбор защищённых отчётов слиттера (взамен сырых object/ + клиентских
    // джойнов). Имена колонок — из report/slitter_cuts (80981), slitter_shift_events
    // (91520), slitters_list (81051). DATETIME-поля приходят unix-штампом (секунды) —
    // их понимают cutTitle/humanizeLabel/cutQueueTime/dateKey/eventWhenSeconds.

    // Станки: report/slitters_list → { id, label } (как старый object/Слиттер).
    // Дедуп по id: отчёт джойнит стоп-лист сырья (N:M) и размножает строки станка.
    function rowsToSlitters(rows) {
        var seen = {};
        var out = [];
        (rows || []).forEach(function(row) {
            var id = firstField(row, ['slitter_id', 'id', 'i']);
            if (!id || seen[id]) return;
            seen[id] = true;
            out.push({ id: id, label: firstField(row, ['slitter_name', 'name']) || ('Слиттер #' + id) });
        });
        return out;
    }

    // Резки: report/slitter_cuts → дескриптор резки той же формы, что давал
    // object/-разбор loadCuts. Дополнительно из отчёта берём материал и ширину
    // (cut_material*/cut_material_width) — раньше резолвились через findBatch/materialWidths.
    function rowsToCuts(rows) {
        return (rows || []).map(function(row) {
            var id = firstField(row, ['cut_id', 'id']);
            var planDate = firstField(row, ['cut_plan_date']);
            return {
                id: id,
                label: cutTitle(planDate || id),
                status: STATUSES[0], // фактический статус доберётся из событий (applyEventStatuses)
                inWork: firstField(row, ['cut_in_work']),
                finishedAt: firstField(row, ['cut_finished']),
                slitterId: firstField(row, ['cut_slitter_id']) || null,
                slitter: firstField(row, ['cut_slitter']),
                batchId: firstField(row, ['cut_batch_id']) || null,
                batch: firstField(row, ['cut_batch']),
                planDate: planDate,
                plannedRuns: firstField(row, ['cut_planned_runs']),
                runLength: firstField(row, ['cut_run_length']),
                startedAt: firstField(row, ['cut_started']),
                winding: firstField(row, ['cut_winding']),
                materialId: firstField(row, ['cut_material_id']) || null,
                material: firstField(row, ['cut_material']),
                materialWidthMm: toNumber(firstField(row, ['cut_material_width']))
            };
        }).filter(function(c) { return c.id; });
    }

    // События смены: report/slitter_shift_events → та же форма, что parseEventRows
    // (новые сверху). cutId — из event_cut_id (ref на задание, 16415).
    // #4359: slitterId — из slitter_id (ref «Слиттер» события): станок события задан ссылкой.
    function rowsToShiftEvents(rows) {
        return (rows || []).map(function(row) {
            return {
                id: firstField(row, ['event_id', 'id']),
                when: firstField(row, ['event_when', 'when']),
                type: firstField(row, ['event_type']),
                cutId: firstField(row, ['event_cut_id']) || null,
                userId: firstField(row, ['event_user_id']) || null,
                user: firstField(row, ['event_user']),
                value: firstField(row, ['event_value']),
                notes: firstField(row, ['event_notes']),
                slitterId: firstField(row, ['slitter_id', 'event_slitter_id']) || null
            };
        }).sort(function(a, b) {
            return String(b.when).localeCompare(String(a.when)); // новые сверху
        });
    }

    // #3557: статус резки выводится из последнего её события смены (приоритет) и
    // подкрепляется атрибутами «Начато»/«В работе»(bool)/«Закончено». Возвращает
    // один из: Ожидает | В работе | Наладка | Перерыв | Завершена.
    function deriveCutStatus(lastEventType, attrs) {
        var t = String(lastEventType == null ? '' : lastEventType).trim();
        var a = attrs || {};
        if (t === EV.finish || t === EV.abort) return 'Завершена';
        if (t === EV.skip) return 'Пропущена'; // #3646: пропущенное задание — отдельный терминальный статус
        if (t === EV.setup) return 'Наладка';
        if (t === EV.brk) return 'Перерыв';
        if (t === EV.startCut || t === EV.resume) return 'В работе';
        // Нет решающего события — опираемся на атрибуты резки.
        if (a.finishedAt && String(a.finishedAt).trim() !== '') return 'Завершена';
        if (truthyFlag(a.inWork) || (a.startedAt && String(a.startedAt).trim() !== '')) return 'В работе';
        return 'Ожидает';
    }

    // #3557: «when» события — unix-секунды (тип DATETIME отдаётся числом) → секунды.
    function eventWhenSeconds(value) {
        var s = String(value == null ? '' : value).trim();
        if (isTimestampSeconds(s)) return Number(s);
        var p = Date.parse(s.replace(' ', 'T'));
        return isNaN(p) ? NaN : Math.round(p / 1000);
    }

    // #3557: «when» события → «ДД.ММ.ГГГГ ЧЧ:ММ» (а не сырой таймштамп).
    function formatEventWhen(value) {
        var s = String(value == null ? '' : value).trim();
        if (isTimestampSeconds(s)) return formatDate(s) + ' ' + formatClock(s);
        var m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
        if (m) return m[3] + '.' + m[2] + '.' + m[1] + ' ' + m[4] + ':' + m[5];
        return s;
    }

    // #3557: длительность (секунды) → «Ч ч М мин» / «М мин». Пусто/отрицательно → ''.
    function formatDuration(seconds) {
        var s = Number(seconds);
        if (!isFinite(s) || s < 0) return '';
        var m = Math.round(s / 60);
        if (m < 1) return 'меньше минуты';
        if (m < 60) return m + ' мин';
        var h = Math.floor(m / 60), mm = m % 60;
        return h + ' ч' + (mm ? ' ' + mm + ' мин' : '');
    }

    var core = {
        STATUSES: STATUSES,
        EVENT_TYPES: EVENT_TYPES,
        EV: EV,
        deriveCutStatus: deriveCutStatus,
        eventWhenSeconds: eventWhenSeconds,
        formatEventWhen: formatEventWhen,
        formatDuration: formatDuration,
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
        metersFromArea: metersFromArea,   // #3861
        areaFromMeters: areaFromMeters,   // #3861
        formatDateTime: formatDateTime,
        defectM2: defectM2,
        photoFieldKey: photoFieldKey,
        isWaitingStatus: isWaitingStatus,
        isPauseStatus: isPauseStatus,
        isActiveBatch: isActiveBatch,
        todayISO: todayISO,
        dateKey: dateKey,
        prepareCutQueue: prepareCutQueue,
        nextFutureCut: nextFutureCut,   // #4332 п.4: следующее задание будущих дней
        futureCutsVisible: futureCutsVisible,   // #4365: секция будущих дней (выполненные не пропадают)
        knifeLayoutKey: knifeLayoutKey,
        widthSetKey: widthSetKey,             // #3737
        dayStartTimestamp: dayStartTimestamp, // #3737
        nextDaySetupConfig: nextDaySetupConfig, // #3737
        shiftContinuation: shiftContinuation,
        hasOpenShift: hasOpenShift,
        shiftEventSlitterLabel: shiftEventSlitterLabel,
        shiftEventMatchesSlitter: shiftEventMatchesSlitter,
        runLengthForCut: runLengthForCut,
        plannedRunsForCut: plannedRunsForCut,
        isSetupTask: isSetupTask,   // #3635 п.5
        batchPasses: batchPasses,
        batchMatchesCut: batchMatchesCut,
        availableBatchesForCut: availableBatchesForCut,
        batchCoverage: batchCoverage,
        // #3460: формат времени резки и разбор партий из отчёта
        isTimestampSeconds: isTimestampSeconds,
        formatClock: formatClock,
        cutQueueTime: cutQueueTime,   // #3646
        formatDate: formatDate,
        cutTitle: cutTitle,
        humanizeLabel: humanizeLabel,
        rowsToActiveBatches: rowsToActiveBatches,
        rowsToSlitters: rowsToSlitters,     // #3674
        rowsToCuts: rowsToCuts,             // #3674
        rowsToShiftEvents: rowsToShiftEvents, // #3674
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
            // null/undefined → атрибут не ставим: иначе setAttribute('disabled', undefined)
            // даёт disabled="undefined" (булев атрибут блокирует элемент). #3553
            if (attrs[k] == null) return;
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
        this.meta = { cut: null, event: null, batch: null, material: null, slitter: null, finishedBatch: null };
        this.slitters = [];
        this.batches = [];        // справочник партий сырья [{ id, label, date, remainder, materialId }]
        this.materialWidths = {}; // { materialId: widthMm }
        this.refOptions = {};     // кеш опций searchable reference inputs по reqId
        this.cuts = [];           // производственные резки [{ id, label, status, slitter }]
        // #3460: восстанавливаем выбор станка из localStorage при открытии формы.
        this.selectedSlitterId = this.loadStoredSlitter();
        this.selectedDate = core.todayISO();
        // #3646: this.includeDone убран — завершённые задания видны всегда.
        this.currentCutId = null; // выбранная резка
        this.currentCut = null;   // полная запись выбранной резки
        this.currentStrips = [];  // #3460: полосы выбранной резки (раскладка ножей)
        this.events = [];         // события смены выбранной резки
        this.shiftEvents = [];    // #4359: события смены оператора (все дни — смена сквозная, #4332)
        this.selectedBatchIds = [];
        this.seamlessNotice = null; // #3609: подсказка «бесшовное продолжение» ВЫБРАННОЙ резки
        this.busy = false;
    }

    // #4370: сброс всего, что относится к ВЫБРАННОЙ резке. Вызывается при смене станка и даты:
    // раньше сбрасывались только currentCut/currentCutId/selectedBatchIds, а подсказка
    // «бесшовное продолжение» (.atex-sl-seamless) и полосы оставались от прежней резки —
    // под списком другого станка висело неактуальное предупреждение про ножи и сырьё.
    AtexSlitter.prototype.clearCutSelection = function() {
        this.currentCutId = null;
        this.currentCut = null;
        this.currentStrips = [];
        this.events = [];
        this.selectedBatchIds = [];
        this.seamlessNotice = null;
    };

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
    // #4366: ПУСТОЕ значение = «очистить реквизит», и оно обязано доехать до сервера:
    // `_m_set` с `t{req}=` снимает галку BOOLEAN и стирает DATETIME (проверено на 1078:
    // «В работе» 1162 BOOLEAN, «Закончено» 16411 DATETIME). Раньше пустые значения
    // выбрасывались из тела запроса, и ЛЮБАЯ очистка была немой: завершение резки писало
    // «Закончено», а галка «В работе» оставалась стоять. Не пишем только undefined/null —
    // это «реквизит не трогаем».
    AtexSlitter.prototype.post = function(path, params) {
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
            self.meta.event = byName(TABLE.event);
            self.meta.batch = byName(TABLE.batch);
            self.meta.material = byName(TABLE.material);
            self.meta.slitter = byName(TABLE.slitter);
            // #3433: необязательна (старое окружение без «Партии ГП» → факт не пишем).
            self.meta.finishedBatch = byName(TABLE.finishedBatch);
            if (!self.meta.cut) throw new Error('В метаданных не найдена таблица «' + TABLE.cut + '»');
        });
    };

    // #3674: станки из защищённого отчёта report/slitters_list (81051) вместо
    // сырого object/Слиттер. Тихий фолбэк на прямое чтение, если отчёта нет в сборке.
    AtexSlitter.prototype.loadSlitters = function() {
        var self = this;
        return this.getJson('report/slitters_list?JSON_KV&LIMIT=0,1000').then(function(rows) {
            self.slitters = core.rowsToSlitters(Array.isArray(rows) ? rows : (rows && rows.rows) || []);
        }).catch(function() { return self.loadSlittersFromTable(); });
    };

    AtexSlitter.prototype.loadSlittersFromTable = function() {
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
    // #4317: досчёт «Остатка, м» — ЧАСТЬ загрузки, а не отдельный шаг инициализации. У большинства
    // партий «Остаток, м» в базе пуст (приход заводят в м², метры появляются только после первого
    // списания расходом): в отчёте `batch_remainder_m` = '' → remainderM = 0 → batchPasses = 0 →
    // availableBatchesForCut отбрасывает партию → панель «Партии сырья» пишет «Нет партий в работе».
    // Перезагрузка страницы всё чинила, потому что fillBatchRemainderM звался ТОЛЬКО в start(), а
    // перечитывание партий после «Готово»/«Готовы все» (finishCut) шло без него — партии «терялись»
    // до F5 (issue #4317; на боевой ateh это 56 партий из 62). Хвост общий для обеих веток загрузки.
    AtexSlitter.prototype.loadBatches = function() {
        var self = this;
        return this.getJson('report/material_batches?JSON_KV&FR_is_active=%25&LIMIT=0,2000')
            .then(function(rows) {
                var list = Array.isArray(rows) ? rows : (rows && rows.rows) || [];
                self.batches = core.rowsToActiveBatches(list);
            })
            .catch(function() { return self.loadBatchesFromTable(); })
            .then(function() { self.fillBatchRemainderM(); });
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

    // #3566 #5 / #3861: остаток в метрах — основная мера; площадь (м²) с ним
    // взаимовычисляема по номинальной ширине. Если отчёт отдал только одно из
    // значений — досчитываем второе. Ширина: сперва из отчёта (width_mm),
    // иначе из справочника «Вид сырья». Вызывается после загрузки партий и ширин.
    AtexSlitter.prototype.fillBatchRemainderM = function() {
        var widths = this.materialWidths || {};
        (this.batches || []).forEach(function(b) {
            var width = core.toNumber(b.widthMm) || core.toNumber(widths[String(b.materialId)]);
            var hasM = core.toNumber(b.remainderM) > 0;
            var hasArea = core.toNumber(b.remainder) > 0;
            if (width <= 0) return;
            if (!hasM && hasArea) b.remainderM = core.metersFromArea(b.remainder, width);
            else if (hasM && !hasArea) b.remainder = core.areaFromMeters(b.remainderM, width);
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

    // #3674: очередь станка из защищённого отчёта report/slitter_cuts (80981) вместо
    // сырого object/. Отчёт фильтруем по станку (FR_cut_slitter_id) — он рассчитан на
    // этот фильтр (без него тяжёлый), а список и так станко-зависим (visibleCuts). Без
    // выбранного станка резки не нужны (renderCuts просит выбрать станок). Материал и
    // ширину отдаёт сам отчёт (cut_material*/cut_material_width). На отсутствие отчёта
    // — тихий фолбэк на прямое чтение таблицы (loadCutsFromTable).
    AtexSlitter.prototype.loadCuts = function() {
        var self = this;
        var sid = this.selectedSlitterId;
        if (!sid) { this.cuts = []; return Promise.resolve(); }
        return this.getJson('report/slitter_cuts?JSON_KV&FR_cut_slitter_id=' + encodeURIComponent(sid) + '&LIMIT=0,2000')
            .then(function(rows) {
                self.cuts = core.rowsToCuts(Array.isArray(rows) ? rows : (rows && rows.rows) || []);
            })
            .catch(function() { return self.loadCutsFromTable(); });
    };

    AtexSlitter.prototype.loadCutsFromTable = function() {
        var self = this;
        var meta = this.meta.cut;
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            var slitterIdx = colIndex(meta, CUT_REQ.slitter);
            var batchIdx = colIndex(meta, CUT_REQ.batch);
            var planDateIdx = colIndex(meta, CUT_REQ.planDate);
            var plannedRunsIdx = colIndexAny(meta, CUT_PLANNED_RUNS_NAMES);
            var runLengthIdx = colIndexAny(meta, CUT_RUN_LENGTH_NAMES);
            var startedIdx = colIndexAny(meta, CUT_STARTED_NAMES);
            var inWorkIdx = colIndex(meta, CUT_REQ.inWork);      // #3557
            var finishedIdx = colIndex(meta, CUT_REQ.finishedAt); // #3557
            var windingIdx = colIndex(meta, CUT_REQ.winding);    // #3646: «Тип намотки» в карточке списка
            self.cuts = (rows || []).map(function(r) {
                var row = r.r || [];
                var slitterRef = slitterIdx >= 0 ? parseRef(row[slitterIdx]) : { id: null, label: '' };
                var batchRef = batchIdx >= 0 ? parseRef(row[batchIdx]) : { id: null, label: '' };
                return {
                    id: String(r.i),
                    // #3460: главное значение резки — плановое время старта (штамп);
                    // показываем «Резка ЧЧ:ММ», а не сырой номер.
                    label: core.cutTitle(row[0] || r.i),
                    // #3557: статус выводится из событий (applyEventStatuses); до их
                    // загрузки — из атрибутов через deriveCutStatus.
                    status: STATUSES[0],
                    inWork: inWorkIdx >= 0 ? (row[inWorkIdx] || '') : '',
                    finishedAt: finishedIdx >= 0 ? (row[finishedIdx] || '') : '',
                    slitterId: slitterRef.id,
                    slitter: slitterRef.label,
                    batchId: batchRef.id,
                    batch: batchRef.label,
                    // #3352: главное значение резки (row[0]) = «Дата план»;
                    // если colIndex не нашёл реквизит — берём row[0], иначе
                    // prepareCutQueue отфильтрует все резки по пустой дате.
                    planDate: (planDateIdx >= 0 ? row[planDateIdx] : null) || row[0] || '',
                    plannedRuns: plannedRunsIdx >= 0 ? row[plannedRunsIdx] : '',
                    runLength: runLengthIdx >= 0 ? row[runLengthIdx] : '',
                    startedAt: startedIdx >= 0 ? (row[startedIdx] || '') : '',
                    winding: windingIdx >= 0 ? (row[windingIdx] || '') : '' // #3646
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
                // #3352 / #4353: «Дата план» — ГЛАВНОЕ значение записи (row[0]), отдельного
                // реквизита с таким именем в таблице нет. Без фолбэка на row[0] дата открытой
                // резки всегда пуста, и задание выглядит «не из очереди выбранного дня».
                planDate: val(CUT_REQ.planDate) || row[0] || '',
                counterStart: val(CUT_REQ.counterStart),
                counterEnd: val(CUT_REQ.counterEnd),
                meterage: val(CUT_REQ.meterage),
                defect: val(CUT_REQ.defect),
                defectM: val(CUT_REQ.defectM),
                defectPhoto: val(CUT_REQ.defectPhoto),
                plannedRuns: valAny(CUT_PLANNED_RUNS_NAMES),
                runLength: valAny(CUT_RUN_LENGTH_NAMES),
                startedAt: valAny(CUT_STARTED_NAMES),
                inWork: val(CUT_REQ.inWork),         // #3557: булев «В работе» (1162)
                finishedAt: val(CUT_REQ.finishedAt), // #3557: «Закончено» (16411)
                status: STATUSES[0],
                notes: val(CUT_REQ.notes),
                winding: val(CUT_REQ.winding), // #3566 #2: направление (тип) намотки
                leader: parseRef(val(CUT_REQ.leader)).label // #3566 #2: лидер (ссылка)
            };
        });
    };

    // #3460: состав резки — полосы (подчинённая «Партия ГП»). Нужны для метрик
    // (число полос/ножей) и цветной раскладки ножей. Ширину/кол-во/назначение
    // берём по именам реквизитов (как в cut-map.html).
    // #3609: чтение полос (раскладки ножей) ЛЮБОЙ резки без затирания currentStrips —
    // нужно для сравнения с первой резкой следующего дня. → Promise<strips[]>.
    AtexSlitter.prototype.fetchStrips = function(cutId) {
        var meta = this.meta.finishedBatch;
        if (!meta) return Promise.resolve([]);
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(cutId) + '&LIMIT=0,1000').then(function(rows) {
            var widthIdx = colIndex(meta, STRIP_REQ.width);
            var qtyIdx = colIndex(meta, STRIP_REQ.qty);
            var purposeIdx = colIndex(meta, STRIP_REQ.purpose);
            return (rows || []).map(function(rec) {
                var r = rec.r || [];
                return {
                    id: String(rec.i),
                    name: r[0] || '',
                    width: widthIdx >= 0 ? (r[widthIdx] || '') : '',
                    qty: qtyIdx >= 0 ? (r[qtyIdx] || '') : '',
                    purpose: purposeIdx >= 0 ? (r[purposeIdx] || '') : ''
                };
            });
        }).catch(function() { return []; });
    };

    AtexSlitter.prototype.loadStrips = function(cutId) {
        var self = this;
        return this.fetchStrips(cutId).then(function(strips) { self.currentStrips = strips; });
    };

    // #3609: если выбранная резка — последняя в смене, а первая резка следующего дня
    // на этом станке совпадает по ножам и/или сырью — предупреждаем оператора (не убирать
    // сырьё / не трогать ножи). Результат в this.seamlessNotice, рендерит renderSeamless.
    // #3737: конфигурацию первой резки СЛЕДУЮЩЕГО дня берём из защищённого отчёта
    // next_cut_setup (93371) по станку, начиная с полуночи текущего дня. Отчёт отдаёт ширины
    // полос и сырьё каждой предстоящей резки в порядке расписания (task_start) — поэтому
    // «оставить конфигурацию» определяется даже когда резка следующего дня не загружена в
    // очередь пульта (тот же случай, что один выбранный день в планировании). Сравниваем по
    // НАБОРУ ШИРИН (widthSetKey: отчёт без «Кол-ва полос») и по сырью.
    // #4370: точка отсчёта — ТЕКУЩЕЕ (открытое) задание: его станок, его «Дата план» и его
    // полосы. Под одной сменой оператор выполняет задания будущих дней (#4332 п.4), поэтому
    // «следующий день» считается от дня ОТКРЫТОГО задания, а не от выбранного в тулбаре дня и
    // не от последнего задания прошедшего дня: делая задание 24-го, оператор сравнивается с
    // первым заданием 25-го.
    AtexSlitter.prototype.computeSeamless = function() {
        var self = this;
        this.seamlessNotice = null;
        var cut = this.currentCut;
        if (!cut) return Promise.resolve();
        var cont = core.shiftContinuation(this.cuts, cut);
        if (!cont.isLast) return Promise.resolve();   // предупреждение только у последней резки смены
        var sid = String(cut.slitterId || self.selectedSlitterId || '');
        var curDayKey = core.dateKey(cut.planDate);
        var dayStartTs = core.dayStartTimestamp(cut.planDate);
        if (!sid || dayStartTs == null) return Promise.resolve();
        var params = ['JSON_KV', 'FR_slitter_id=' + encodeURIComponent(sid),
                      'FR_task_start=' + encodeURIComponent('>' + dayStartTs)];
        var curMatId = String(cut.materialId || '');
        return this.getJson('report/next_cut_setup?' + params.join('&') + '&LIMIT=0,2000').then(function(rows) {
            var next = core.nextDaySetupConfig(rows, curDayKey);
            if (!next) return;
            var curKey = core.widthSetKey(self.currentStrips);
            var sameKnives = curKey !== '' && curKey === next.widthKey;
            var sameMaterial = curMatId !== '' && curMatId === String(next.materialId || '');
            if (!sameKnives && !sameMaterial) return;
            self.seamlessNotice = {
                // #4370: подсказка принадлежит КОНКРЕТНОЙ резке и станку — renderSeamless
                // рисует её, только пока эта резка открыта (иначе она переживала смену
                // станка/дня и оставалась неактуальной).
                cutId: String(cut.id), slitterId: sid,
                nextCut: { id: next.taskId, label: core.cutTitle(next.taskStart) },
                sameKnives: sameKnives, sameMaterial: sameMaterial
            };
        }).catch(function() {});
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
        var slitterIdx = colIndex(meta, EVENT_REQ.slitter);   // #4359: ссылка «Слиттер»
        return (rows || []).map(function(rec) {
            var r = rec.r || [];
            var cutId = cutIdx >= 0 ? parseRef(r[cutIdx]).id : null;
            if (!cutId && rec.u && String(rec.u) !== '1') cutId = String(rec.u);
            var userRef = userIdx >= 0 ? parseRef(r[userIdx]) : { id: null, label: '' };
            var slitterRef = slitterIdx >= 0 ? parseRef(r[slitterIdx]) : { id: null, label: '' };
            return {
                id: String(rec.i),
                when: r[0] || '',
                type: typeIdx >= 0 ? (parseRef(r[typeIdx]).label || '') : '',  // #3348: тип — ссылка «id:Начало смены»
                cutId: cutId || null,
                userId: userRef.id,
                user: userRef.label,
                value: valIdx >= 0 ? (r[valIdx] || '') : '',
                notes: notesIdx >= 0 ? (r[notesIdx] || '') : '',
                slitterId: slitterRef.id || null,   // #4359
                slitter: slitterRef.label || ''
            };
        }).sort(function(a, b) {
            return String(b.when).localeCompare(String(a.when)); // новые сверху
        });
    };

    // События смены текущего оператора. #4359: БЕЗ отсечки по выбранному дню — смена сквозная
    // по дням (#4332 п.2: открытость определяется последним событием «Начало/Конец смены» этого
    // станка, в каком дне оно записано — неважно). Отсечка по дню тут делала фильтр по дню
    // внутри hasOpenShift бессмысленным: список ей приходил уже урезанным. С #4348 события
    // пишутся ТЕКУЩИМ моментом, поэтому у оператора, работающего не сегодняшний день, событие
    // «Начало смены» вылетало сразу после записи — тост «Смена открыта» был, а смена закрыта.
    // По той же причине терялись отметки проходов у заданий будущих дней (#4332 п.4).
    AtexSlitter.prototype.filterShiftEvents = function(events) {
        var self = this;
        return (events || []).filter(function(ev) {
            if (self.userId && String(ev.userId || '') !== String(self.userId)) return false;
            return true;
        });
    };

    // #3674: события смены из защищённого отчёта report/slitter_shift_events (91520)
    // вместо сырого object/. Разобранные события раскладываем общим хвостом
    // applyLoadedEvents. Тихий фолбэк на прямое чтение (loadShiftEventsFromTable).
    AtexSlitter.prototype.loadShiftEvents = function() {
        var self = this;
        return this.getJson('report/slitter_shift_events?JSON_KV&LIMIT=0,5000').then(function(rows) {
            var list = core.rowsToShiftEvents(Array.isArray(rows) ? rows : (rows && rows.rows) || []);
            if (list.length) { self.applyLoadedEvents(list); return; }
            // #4359: пустой отчёт — НЕ доказательство, что событий нет: сломанный или
            // недогранченный report/ отдаёт [] со статусом 200, и пульт молча считает смену
            // закрытой (кнопки в задании не появляются). Перепроверяем прямым чтением таблицы;
            // если события там ЕСТЬ — отчёт врёт, и об этом надо орать, а не чинить молча.
            return self.loadShiftEventsFromTable().then(function() {
                if (!(self.allEvents || []).length) return;
                console.error('atex-slitter: report/slitter_shift_events отдал пусто, а в таблице «'
                    + TABLE.event + '» события есть — отчёт сломан или не выдан роли');
                self.notify('Отчёт событий смены пуст — события прочитаны напрямую из таблицы', 'error');
            }).catch(function() { self.applyLoadedEvents([]); });
        }).catch(function() { return self.loadShiftEventsFromTable(); });
    };

    // Общий хвост: разложить разобранные события (всё/за смену/текущей резки) и
    // пересчитать статусы резок.
    AtexSlitter.prototype.applyLoadedEvents = function(all) {
        var self = this;
        self.allEvents = all; // #3557: все события (для вывода статуса резок)
        self.shiftEvents = self.filterShiftEvents(all);
        self.events = self.currentCutId
            ? self.shiftEvents.filter(function(ev) { return String(ev.cutId || '') === String(self.currentCutId); })
            : [];
        self.applyEventStatuses();
    };

    AtexSlitter.prototype.loadShiftEventsFromTable = function() {
        var self = this;
        var meta = this.meta.event;
        if (!meta) { this.shiftEvents = []; this.events = []; this.allEvents = []; return Promise.resolve(); }
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,2000').then(function(rows) {
            self.applyLoadedEvents(self.parseEventRows(rows));
        });
    };

    // #3557: статус каждой резки = из последнего её события смены (+ атрибуты).
    // parseEventRows уже отсортировал события по убыванию времени, поэтому первое
    // событие резки в списке — самое свежее.
    AtexSlitter.prototype.applyEventStatuses = function() {
        var lastType = {};
        (this.allEvents || []).forEach(function(ev) {
            var cid = String(ev.cutId || '');
            if (!cid) return;
            if (!(cid in lastType)) lastType[cid] = ev.type; // первое = самое свежее
        });
        (this.cuts || []).forEach(function(cut) {
            cut.status = core.deriveCutStatus(lastType[String(cut.id)], cut);
        });
        if (this.currentCut) {
            this.currentCut.status = core.deriveCutStatus(lastType[String(this.currentCut.id)], this.currentCut);
        }
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
        // #3522: смена — на конкретный станок. Без выбранного станка смены нет.
        if (!this.selectedSlitterId) return false;
        // #4359: станок смены — по ссылке «Слиттер» события; подпись остаётся запасным путём
        // для событий, записанных до появления реквизита.
        return core.hasOpenShift(this.shiftEvents, this.userId, this.selectedDate,
            this.selectedSlitterLabel(), this.selectedSlitterId);
    };

    // #4348: событие смены и атрибуты резки (Начато/Закончено) фиксируем ТЕКУЩИМ моментом —
    // реальными датой и временем, а НЕ выбранным в пульте днём. Под одной открытой сменой
    // (#4332) оператор выполняет задания будущих дней; «Закончено» должно нести фактическую
    // дату завершения, а не плановую дату задания (иначе завершение уезжает в будущее и ломает
    // хронологию событий смены).
    AtexSlitter.prototype.eventDateTime = function() {
        var now = new Date();
        function p(n) { return (n < 10 ? '0' : '') + n; }
        var day = core.todayISO(now);
        return day + ' ' + p(now.getHours()) + ':' + p(now.getMinutes()) + ':' + p(now.getSeconds());
    };

    // ── Рендеринг ──

    AtexSlitter.prototype.render = function() {
        this.renderToolbar();
        this.renderCuts();
        this.renderSeamless();  // #3609: предупреждения о бесшовном продолжении смены
        this.renderMain();
    };

    // #3609: предупреждения под списком резок (.atex-sl-sidebar). Показываются, когда
    // выбранная резка — последняя в смене, а первая резка следующего дня на этом станке
    // совпадает по сырью и/или ножам (см. computeSeamless).
    AtexSlitter.prototype.renderSeamless = function() {
        var box = this.seamlessEl;
        if (!box) return;
        box.innerHTML = '';
        var n = this.seamlessNotice;
        if (!n) return;
        // #4370: подсказка живёт только вместе со «своей» резкой и своим станком.
        var cut = this.currentCut;
        if (!cut || String(cut.id) !== String(n.cutId)) return;
        if (n.slitterId && this.selectedSlitterId && String(n.slitterId) !== String(this.selectedSlitterId)) return;
        var nextLabel = (n.nextCut && (n.nextCut.label || n.nextCut.id)) || '';
        if (n.sameMaterial) {
            box.appendChild(el('div', { class: 'atex-sl-warn-note', text:
                '⚠ Сырьё совпадает с первой резкой следующего дня (' + nextLabel + ') — не убирайте сырьё.' }));
        }
        if (n.sameKnives) {
            box.appendChild(el('div', { class: 'atex-sl-warn-note', text:
                '⚠ Конфигурация ножей совпадает с первой резкой следующего дня (' + nextLabel + ') — не трогайте ножи.' }));
        }
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
            date: this.selectedDate
            // #3646: includeDone убран — завершённые показываем всегда.
        });
    };

    AtexSlitter.prototype.visibleCuts = function() {
        return this.currentQueue().cuts;
    };

    // #4332 п.4: следующее задание БУДУЩИХ дней этого станка (одно, ближайшее незавершённое)
    // — признак того, что смене есть что делать дальше (allCutsDone).
    AtexSlitter.prototype.futureCut = function() {
        return core.nextFutureCut(this.cuts, {
            slitterId: this.selectedSlitterId,
            afterDateKey: core.dateKey(this.selectedDate)
        });
    };

    // #4365: содержимое секции будущих дней — выполненные задания будущих дней (не пропадают)
    // плюс ОДНО ближайшее ожидающее. Ожидающее предлагаем только когда в выбранном дне не
    // осталось открытых заданий (#4332 п.4); выполненные показываем всегда.
    AtexSlitter.prototype.futureCutsVisible = function() {
        return core.futureCutsVisible(this.cuts, {
            slitterId: this.selectedSlitterId,
            afterDateKey: core.dateKey(this.selectedDate),
            withNext: !this.currentQueue().firstOpenCutId
        });
    };

    // #3861: работа смены окончена — резки выбранного дня выполнены (список непуст, первой
    // открытой нет) при открытой смене; скрывает кнопки проходов ✓ Готово / ✓✓ Готовы все.
    // #4362: смена сквозная (#4332 п.2) и продолжается заданием будущего дня (#4332 п.4) —
    // пока такое задание есть, работа НЕ окончена: его проходы отмечают теми же кнопками.
    AtexSlitter.prototype.allCutsDone = function() {
        if (!this.isShiftOpen()) return false;
        var q = this.currentQueue();
        if (!q.cuts.length || q.firstOpenCutId) return false;
        return !this.futureCut();
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
            self.clearCutSelection();   // #4370: вместе с резкой уходит и её подсказка о бесшовной смене
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
            self.clearCutSelection();   // #4370: подсказка о бесшовной смене принадлежит резке прежнего станка
            // #3674: report/slitter_cuts фильтруется по станку → при смене станка
            // перезагружаем резки (раньше грузились один раз, фильтровал visibleCuts).
            self.loadCuts().then(function() { return self.loadShiftEvents(); }).then(function() { self.render(); });
        });

        box.appendChild(field('Дата', dateInp));
        box.appendChild(field('Станок', select));

        // #4332 п.1/п.3: смена управляется из тулбара и всегда доступна при выбранном станке.
        // Смена закрыта → «Открыть смену»; открыта → «Закрыть смену» (пишет «Конец смены»).
        // Список заданий и детали резки видны всегда (в т.ч. при закрытой смене, только просмотр);
        // управляющие кнопки гейтятся отдельно (renderCutControls/renderPassButtons).
        if (this.selectedSlitterId) {
            if (this.isShiftOpen()) {
                var closeBtn = el('button', { class: 'atex-sl-btn atex-sl-btn-secondary atex-sl-toolbar-close', type: 'button', text: 'Закрыть смену' });
                closeBtn.addEventListener('click', function() { self.closeShift(); });
                box.appendChild(closeBtn);
            } else {
                var openBtn = el('button', { class: 'atex-sl-btn atex-sl-btn-primary atex-sl-toolbar-open', type: 'button', text: 'Открыть смену' });
                openBtn.addEventListener('click', function() { self.openShift(); });
                box.appendChild(openBtn);
            }
        }
    };

    AtexSlitter.prototype.renderCuts = function() {
        var self = this;
        var box = this.cutsEl;
        if (!box) return;
        box.innerHTML = '';
        if (!this.selectedSlitterId) {
            this.updateSidebarTitle(null);
            box.appendChild(el('div', { class: 'atex-sl-empty', text: 'Сначала выберите станок.' }));
            return;
        }
        // #4332 п.1: список заданий виден ВСЕГДА — в т.ч. при закрытой смене (только просмотр);
        // управляющие кнопки гейтятся отдельно (renderCutControls/renderPassButtons).
        var list = this.visibleCuts();
        this.updateSidebarTitle(list.length);
        if (!list.length) {
            box.appendChild(el('div', { class: 'atex-sl-empty', text: 'Резок пока нет' }));
            this.renderFutureCuts(box);   // #4332 п.4 / #4365: задания будущих дней
            return;
        }
        var firstOpenId = this.currentQueue().firstOpenCutId;
        // #3459: только первая резка в «Ожидает» доступна для управления; остальные
        // «Ожидает» заблокированы очередью. #3557 #8: заблокированную резку всё
        // равно можно открыть и посмотреть детали, но кнопки в ней деактивированы.
        list.forEach(function(cut, idx) {
            var active = String(self.currentCutId) === String(cut.id);
            var isFirstOpen = firstOpenId && String(firstOpenId) === String(cut.id);
            var locked = self.isCutLocked(cut);
            // #3646: карточка списка — № + «Вид сырья / Намотка / Метраж м * Резок» (стр. 1)
            // и время начала–окончания (стр. 2). Вид сырья — из «Партии сырья» (Вид сырья).
            var batch = self.findBatch(cut.batchId);
            var material = (batch && batch.materialLabel) || cut.material || cut.batch || '—'; // #3674: cut.material из отчёта
            var runLen = core.toNumber(cut.runLength);
            var runsN = core.toNumber(cut.plannedRuns);
            var dims = (runLen > 0 ? core.round3(runLen) + 'м' : '—') + (runsN > 0 ? ' * ' + runsN : '');
            var spec = [material, cut.winding || '—', dims].join(' / ');
            var cutMain = [
                el('div', { class: 'atex-sl-cut-line1' }, [
                    el('span', { class: 'atex-sl-cut-num', text: String(idx + 1) }),
                    el('span', { class: 'atex-sl-cut-spec', text: spec })
                ])
            ];
            var timeTxt = core.cutQueueTime(cut);
            if (timeTxt) cutMain.push(el('div', { class: 'atex-sl-cut-time', text: timeTxt }));
            if (locked) cutMain.push(el('span', { class: 'atex-sl-cut-sub', text: 'ожидает предыдущую' }));
            var item = el('button', {
                class: 'atex-sl-cut-item' + (active ? ' is-active' : '') + (isFirstOpen && !active ? ' is-next' : '') + (locked ? ' is-disabled' : ''),
                type: 'button'
            }, [
                el('div', { class: 'atex-sl-cut-main' }, cutMain),
                el('span', { class: 'atex-sl-badge ' + badgeClass(cut.status), text: cut.status })
            ]);
            // #3557 #8: клик доступен всегда (просмотр деталей даже у заблокированной).
            item.addEventListener('click', function() { self.openCut(cut.id); });
            box.appendChild(item);
        });
        this.renderFutureCuts(box);   // #4332 п.4 / #4365: задания будущих дней — после списка дня
    };

    // #4332 п.4 / #4365: секция будущих дней под очередью выбранного дня. Показываем ВСЕ уже
    // выполненные задания будущих дней (оператор их сделал — из списка они не пропадают) и ОДНО
    // ближайшее ожидающее, которое можно начать. Ожидающее предлагаем, только когда в выбранном
    // дне открытых заданий не осталось (#4332 п.4); выполненные видны всегда, в т.ч. при закрытой
    // смене (#4332 п.1 — задания видно всегда). Задания сгруппированы по дню, у каждой группы —
    // заголовок с датой.
    AtexSlitter.prototype.renderFutureCuts = function(box) {
        var self = this;
        if (!box) return;
        var res = this.futureCutsVisible();
        if (!res.cuts.length) return;
        var lastDayKey = null;
        res.cuts.forEach(function(cut) {
            var dayKey = core.dateKey(cut.planDate);
            if (dayKey !== lastDayKey) {
                lastDayKey = dayKey;
                var isNextDay = res.nextDayKey != null && dayKey === res.nextDayKey;
                box.appendChild(el('div', { class: 'atex-sl-future-head',
                    text: (isNextDay ? 'Следующее задание · ' : 'Задания · ') + core.formatDate(cut.planDate) }));
            }
            box.appendChild(self.futureCutCard(cut, res.nextId));
        });
    };

    // #4365: карточка задания будущего дня. Маркер «→» у следующего (его можно начать),
    // «✓» у выполненного. Клик открывает детали, как у заданий дня.
    AtexSlitter.prototype.futureCutCard = function(cut, nextId) {
        var self = this;
        var active = String(this.currentCutId) === String(cut.id);
        var isNext = nextId != null && String(nextId) === String(cut.id);
        var batch = this.findBatch(cut.batchId);
        var material = (batch && batch.materialLabel) || cut.material || cut.batch || '—';
        var runLen = core.toNumber(cut.runLength), runsN = core.toNumber(cut.plannedRuns);
        var dims = (runLen > 0 ? core.round3(runLen) + 'м' : '—') + (runsN > 0 ? ' * ' + runsN : '');
        var spec = [material, cut.winding || '—', dims].join(' / ');
        var main = [el('div', { class: 'atex-sl-cut-line1' }, [
            el('span', { class: 'atex-sl-cut-num', text: isNext ? '→' : '✓' }),
            el('span', { class: 'atex-sl-cut-spec', text: spec })
        ])];
        var timeTxt = core.cutQueueTime(cut);
        if (timeTxt) main.push(el('div', { class: 'atex-sl-cut-time', text: timeTxt }));
        var card = el('button', {
            class: 'atex-sl-cut-item atex-sl-cut-future' + (active ? ' is-active' : '') + (isNext ? '' : ' is-past'),
            type: 'button'
        }, [
            el('div', { class: 'atex-sl-cut-main' }, main),
            el('span', { class: 'atex-sl-badge ' + badgeClass(cut.status), text: cut.status })
        ]);
        card.addEventListener('click', function() { self.openCut(cut.id); });
        return card;
    };

    // #3565 #1: «Задание в производство (N)» — N резок в списке; null → без счётчика.
    AtexSlitter.prototype.updateSidebarTitle = function(count) {
        if (!this.sidebarTitleEl) return;
        this.sidebarTitleEl.textContent = 'Задание в производство' + (count == null ? '' : ' (' + count + ')');
    };

    // #3557: резка заблокирована очередью, если она «Ожидает» и НЕ первая открытая
    // в очереди станка. Такую можно открыть для просмотра, но не управлять (#8).
    AtexSlitter.prototype.isCutLocked = function(cut) {
        if (!cut) return false;
        if (core.normalizeStatus(cut.status) !== 'Ожидает') return false;
        var q = this.currentQueue();
        var id = String(cut.id);
        // #4332 п.4: задание БУДУЩЕГО дня очередью выбранного дня не блокируется — оно вынесено
        // отдельной секцией как единственное «следующее», его можно начать. #4353: принадлежность
        // очереди дня определяем по её СОСТАВУ (id), а не сравнением «Даты план» с выбранным днём:
        // у открытой резки дата может быть пустой, и сравнение снимало блокировку с любого
        // ожидающего задания (кнопки были доступны, пока предыдущее не закрыто).
        var inQueue = (q.cuts || []).some(function(c) { return String(c.id) === id; });
        if (!inQueue) return false;
        return !(q.firstOpenCutId && String(q.firstOpenCutId) === id);
    };

    function badgeClass(status) {
        if (core.isDone(status)) return 'atex-sl-badge-done';
        var s = String(status == null ? '' : status).trim();
        if (s === 'В работе') return 'atex-sl-badge-run';
        if (s === 'Наладка' || s === 'Перерыв' || core.isPauseStatus(status)) return 'atex-sl-badge-setup';
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

        // #4332 п.1: детали резки видны ВСЕГДА (в т.ч. при закрытой смене — просмотр). Управление
        // (Наладка/Перерыв/Прекратить/Пропуск, отметки проходов) гейтится по открытости смены
        // в renderCutControls/renderPassButtons; открыть смену — из тулбара («Открыть смену»).
        if (!this.currentCutId || !this.currentCut) {
            host.appendChild(el('div', { class: 'atex-sl-placeholder',
                text: this.isShiftOpen() ? 'Выберите производственную резку слева.' : 'Откройте смену и выберите резку. Задания можно просматривать и при закрытой смене.' }));
            return;
        }

        // #3557: статус и кнопки управления — в шапке (renderHead); секции «Статус резки» больше нет.
        host.appendChild(this.renderHead());
        host.appendChild(this.renderCutMap());
        host.appendChild(this.renderBatchSelection());
        host.appendChild(this.renderReadings());
        host.appendChild(this.renderEvents());
    };


    AtexSlitter.prototype.renderHead = function() {
        var cut = this.currentCut;
        // #3566 #1: «Резка N из M» — проход N из M проходов ТЕКУЩЕГО задания (а не
        // позиция задания в очереди). M = «Кол-во резок план».
        // #3621: N (текущий проход) выводим из числа отметок «Готово» — событий
        // «Резка» этой резки + 1, в пределах [1, M] (раньше — из метража, #3566).
        // #3635 п.5: задание-«настройка» (хвост дня N) — заголовок «Настройка ножей и сырья»
        // вместо «Резка N из M». Кнопки статуса (Наладка) и «Готово/Готовы все» остаются —
        // оператор отмечает наладку обычным статус-флоу, событие пишется как у резки.
        var setup = core.isSetupTask(cut);
        var total = core.plannedRunsForCut(cut);
        var pass = Math.min(this.donePassCount(cut) + 1, total);
        if (pass < 1) pass = 1;
        var title = setup ? '⚙ Настройка ножей и сырья' : ('Резка ' + pass + ' из ' + total);
        // #3557 #5: строку .atex-sl-head-meta убрали (Слиттер/Партия/План видно в тулбаре/метриках).
        var head = el('div', { class: 'atex-sl-head' }, [
            el('div', { class: 'atex-sl-head-main' }, [
                el('h2', { class: 'atex-sl-head-title', text: title }),
                this.renderPassButtons(cut),  // #3583: «Готово» / «Готовы все» правее заголовка
                el('span', { class: 'atex-sl-badge ' + badgeClass(cut.status), text: cut.status })
            ]),
            this.renderCutControls(cut)
        ]);
        var wrap = el('div');
        wrap.appendChild(head);
        // #3889: задание-«настройка» (последняя резка смены, не успевшая начаться) — поясняем
        // оператору последовательность: сейчас только ПОЛНАЯ настройка (ножи + сырьё), без
        // намотки; намотку начнёт следующая смена как продолжение того же задания.
        if (setup) wrap.appendChild(this.renderSetupOnlyNote());
        wrap.appendChild(this.renderCutMetrics());
        return wrap;
    };

    // #3889: инструкция оператору для задания-«настройки» (0 проходов) — что делать и в
    // какой последовательности с последней резкой смены, которая не до конца (см. issue #3889).
    AtexSlitter.prototype.renderSetupOnlyNote = function() {
        return el('div', { class: 'atex-sl-setup-note', text:
            '⚙ Это последняя резка смены — она не успевает начаться сегодня. '
            + 'Выполните только НАСТРОЙКУ станка под это задание: установите ножи по раскладке '
            + 'и заправьте сырьё (вид сырья — в метриках ниже). '
            + 'Намотку (резку) НЕ начинайте — её продолжит следующая смена, это то же задание. '
            + 'Установленные ножи и заправленное сырьё со станка не снимайте.' });
    };

    // #3621: число выполненных проходов текущей резки = число событий «Резка»
    // (EV.pass) среди событий смены этой резки. Источник номера прохода в шапке —
    // надёжнее метража: каждое «Готово» пишет одно событие «Резка».
    AtexSlitter.prototype.donePassCount = function(cut) {
        var cutId = cut ? String(cut.id) : '';
        if (!cutId) return 0;
        return (this.shiftEvents || []).filter(function(ev) {
            return ev.type === EV.pass && String(ev.cutId || '') === cutId;
        }).length;
    };

    // #3583: кнопки отметки проходов правее .atex-sl-head-title. «Готово» — один
    // проход, «Готовы все» — все (с подтверждением). Доступны на активной резке
    // (не заблокированной очередью и не завершённой).
    // #3670: у заблокированной очередью резки («ожидает предыдущую») кнопки проходов
    // не показываем вовсе (раньше показывали деактивированными) — возвращаем пустой слот.
    AtexSlitter.prototype.renderPassButtons = function(cut) {
        var self = this;
        if (!this.isShiftOpen()) return el('div', { class: 'atex-sl-head-pass' });   // #4332 п.3: отметки проходов — только при открытой смене
        if (this.isCutLocked(cut)) return el('div', { class: 'atex-sl-head-pass' });
        // #3861: когда работа смены окончена — кнопки ✓ Готово / ✓✓ Готовы все убираем вовсе
        // (резку можно открыть для просмотра деталей). #4362: задание будущего дня (#4332 п.4)
        // работу смены продолжает — у него кнопки проходов есть (allCutsDone его учитывает).
        if (this.allCutsDone()) return el('div', { class: 'atex-sl-head-pass' });
        var canMark = !core.isDone(cut.status);
        var one = el('button', { class: 'atex-sl-btn atex-sl-btn-pass', type: 'button', text: '✓ Готово',
            title: 'Отметить один проход выполненным: номер прохода +1, пересчитать «Счётчик кон.» и «Погонаж факт»' });
        var all = el('button', { class: 'atex-sl-btn atex-sl-btn-pass atex-sl-btn-pass-all', type: 'button', text: '✓✓ Готовы все',
            title: 'Отметить все проходы выполненными и завершить задание (с подтверждением)' });
        if (canMark) {
            one.addEventListener('click', function() { self.markPassDone(false); });
            all.addEventListener('click', function() { self.markPassDone(true); });
        } else { one.disabled = true; all.disabled = true; }
        return el('div', { class: 'atex-sl-head-pass' }, [one, all]);
    };

    // #3557 #4: кнопки управления статусом — в шапке (вместо секции «Статус резки»).
    // Доступные кнопки зависят от текущего (выведенного из событий) статуса.
    // #3621: кнопка «Завершить» убрана — завершение теперь через зелёные кнопки
    // «Готово»/«Готовы все» (markPassDone → finishCut на последнем проходе).
    // #3670: у заблокированной очередью резки («ожидает предыдущую») кнопки управления
    // не показываем вовсе (раньше — показывали деактивированными), остаётся пояснение.
    AtexSlitter.prototype.renderCutControls = function(cut) {
        var self = this;
        var actions = el('div', { class: 'atex-sl-section-actions atex-sl-life-actions' });
        // #4332 п.3: Наладка/Перерыв/Прекратить/Пропуск — только при ОТКРЫТОЙ смене. Смена закрыта →
        // резку видно (просмотр), но управлять нельзя; открыть смену — из тулбара.
        if (!this.isShiftOpen()) {
            actions.appendChild(el('span', { class: 'atex-sl-muted', text: 'Смена закрыта — откройте смену, чтобы управлять резкой' }));
            return actions;
        }
        if (this.isCutLocked(cut)) {
            actions.appendChild(el('span', { class: 'atex-sl-muted', text: 'Резка ожидает предыдущую в очереди' }));
            return actions;
        }
        // Текущий (выведенный из событий) статус: 'Ожидает'|'В работе'|'Наладка'|'Перерыв'|'Завершена'.
        var s = String(cut.status == null ? '' : cut.status).trim();
        var defs;
        // #3640: «Начать» убрана — старт резки идёт через «Наладку» (setupCut ставит «Начато»
        // + «В работе»). Для активной резки в ЛЮБОМ статусе показываем все три кнопки
        // «Наладка / Перерыв / Прекратить» (каждая пишет событие смены). «Возобновить»
        // оставлена только для завершённой резки — переоткрыть (снять «Закончено»).
        if (core.isDone(s)) {
            defs = [['Возобновить', 'secondary', function() { self.resumeCut(); }]];
        } else {
            defs = [
                ['Наладка', 'primary', function() { self.setupCut(); }],
                ['Перерыв', 'secondary', function() { self.breakCut(); }],
                ['Прекратить', 'secondary', function() { self.abortCut(); }],
                ['Пропуск', 'secondary', function() { self.skipCut(); }] // #3646: пропустить задание
            ];
        }
        defs.forEach(function(def) {
            var btn = el('button', { class: 'atex-sl-btn atex-sl-btn-' + def[1], type: 'button', text: def[0] });
            btn.addEventListener('click', def[2]);
            actions.appendChild(btn);
        });
        return actions;
    };


    // #3460: сводка резки — вид сырья, метраж, число резок (проходов) и направление
    // намотки. #3566 #3: метрики «Полос»/«Полос всего» убраны — число полос теперь
    // в заголовке секции «Раскладка ножей». #3566 #2: добавлено направление намотки.
    AtexSlitter.prototype.renderCutMetrics = function() {
        var cut = this.currentCut;
        var runs = core.plannedRunsForCut(cut);
        var runLength = core.runLengthForCut(cut);
        var material = cut.material || cut.materialLabel || cut.batch || '—';
        var cells = [
            ['Вид сырья', material || '—'],
            ['Метраж, м', runLength > 0 ? String(core.round3(runLength)) : '—'],
            ['Резок', String(runs)],
            ['Намотка', cut.winding || '—'],
            ['Лидер', cut.leader || '—']
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
        // #3566 #4: число полос (Σ кол-во) — в заголовке «Раскладка ножей (K полос)».
        var knives = core.totalKnives(strips);
        var section = el('section', { class: 'atex-sl-section' }, [
            el('h3', { class: 'atex-sl-section-title', text: 'Раскладка ножей' + (knives > 0 ? ' (' + knives + ' полос)' : '') })
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
            // Подпись ширины — прямо на полосе для всех полос, без порога (#3555).
            // Узкие сегменты обрезаются по ширине ячейки (overflow:hidden);
            // полную ширину дублируют title-подсказка и легенда ниже.
            segNode.appendChild(el('span', { class: 'atex-sl-cm-seg-label', text: String(seg.width) }));
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

        // #3639: «Остаток, мм» — сколько ширины входа уйдёт в отходы (обрезь). При
        // переполнении (полосы шире входа) отхода нет → 0.
        var wasteMm = lay.remainder > 0 ? core.round3(lay.remainder) : 0;
        var waste = el('div', { class: 'atex-sl-cm-waste', title: 'Сколько ширины входа уйдёт в отходы (обрезь)' }, [
            el('span', { class: 'atex-sl-cm-waste-label', text: 'Остаток, мм: ' }),
            el('span', { class: 'atex-sl-cm-waste-value', text: String(wasteMm) })
        ]);
        // #3643: легенда и «Остаток, мм» — в ОДНОМ ряду (легенда слева, остаток справа).
        section.appendChild(el('div', { class: 'atex-sl-cm-legend-row' }, [legend, waste]));

        return section;
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
        // #3609: блок «Покрыто … м · проходов» (.atex-sl-coverage) убран по требованию.

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
                // Заголовок партии = «Дата прихода» (DATETIME-штамп) → «ДД.ММ.ГГГГ ЧЧ:ММ»,
                // а не сырой таймштамп. Не-штамп (штрих-код/имя) остаётся как есть.
                el('span', { class: 'atex-sl-batch-title', text: core.formatEventWhen(batch.label) }),
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
    // #4321: счётчик мотает НАЗАД (остаток сырья в рулоне): «Счётчик нач.» = остаток партии перед
    // резкой, «Счётчик кон.» = остаток после неё, погонаж факт = счётчик нач. − счётчик кон.
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
        var meterField = field('Погонаж факт, м', meterageDisplay);   // #4321: без « (расчёт)» — подпись ломала вёрстку
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

        // Обновление подсказок: погонаж = нач. − кон. (#4321); остаток партии → счётчик нач.
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

    // #3557 #2: события смены выбранного станка. Возвращает по убыванию времени, с
    // длительностью до следующего (более позднего) события этого станка.
    // #4359: станок события — из его ссылки «Слиттер». У событий без ссылки (записаны до
    // появления реквизита) остаются прежние пути: событие резки — через слиттер резки,
    // событие смены — через метку станка в «Примечаниях».
    AtexSlitter.prototype.eventsForSelectedSlitter = function() {
        var slLabel = this.selectedSlitterLabel();
        var slId = String(this.selectedSlitterId || '');
        var cutSlitter = {};
        (this.cuts || []).forEach(function(c) { cutSlitter[String(c.id)] = String(c.slitterId || ''); });
        var list = (this.shiftEvents || []).filter(function(ev) {
            if (ev.slitterId) return String(ev.slitterId) === slId;   // #4359
            if (ev.cutId) return cutSlitter[String(ev.cutId)] === slId;
            return core.shiftEventSlitterLabel(ev) === slLabel;
        });
        var asc = list.slice().sort(function(a, b) { return core.eventWhenSeconds(a.when) - core.eventWhenSeconds(b.when); });
        var durById = {};
        for (var i = 0; i < asc.length; i++) {
            var cur = core.eventWhenSeconds(asc[i].when);
            var nxt = i + 1 < asc.length ? core.eventWhenSeconds(asc[i + 1].when) : NaN;
            durById[asc[i].id] = (isFinite(nxt) && isFinite(cur)) ? (nxt - cur) : NaN;
        }
        return list.slice()
            .sort(function(a, b) { return core.eventWhenSeconds(b.when) - core.eventWhenSeconds(a.when); })
            .map(function(ev) { return { ev: ev, durationSec: durById[ev.id] }; });
    };

    // #3557 #1: только список событий (быстрые кнопки и «Закрыть смену» убраны —
    // закрытие смены перенесено в тулбар). #2: время — дата+время; примечание —
    // длительность до следующего события станка (без дублирования даты/станка).
    AtexSlitter.prototype.renderEvents = function() {
        var section = el('section', { class: 'atex-sl-section' }, [
            el('h3', { class: 'atex-sl-section-title', text: 'События смены' })
        ]);
        var rows = this.eventsForSelectedSlitter();
        var list = el('div', { class: 'atex-sl-events' });
        if (!rows.length) {
            list.appendChild(el('div', { class: 'atex-sl-empty', text: 'Событий смены ещё нет.' }));
        } else {
            rows.slice(0, 16).forEach(function(row) {
                var ev = row.ev;
                var dur = core.formatDuration(row.durationSec);
                list.appendChild(el('div', { class: 'atex-sl-event' }, [
                    el('span', { class: 'atex-sl-event-when', text: core.formatEventWhen(ev.when) }),
                    el('span', { class: 'atex-sl-event-type', text: ev.type }),
                    el('span', { class: 'atex-sl-event-val', text: ev.value !== '' && ev.value != null ? String(ev.value) : '' }),
                    el('span', { class: 'atex-sl-event-note', text: dur ? ('длительность: ' + dur) : 'идёт' })
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
        // #3557: статус резки не хранится отдельным реквизитом — выводится из событий.
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
    // #3557: общее действие управления статусом — записать атрибуты резки
    // (Начато/В работе/Закончено) и зафиксировать событие смены. Статус резки
    // после перезагрузки событий выводится из последнего события (applyEventStatuses).
    //   opts.setStarted   — проставить «Начато»=now, если ещё пусто
    //   opts.setInWork    — true: «В работе»=1; false: «В работе»=0 (#4366: снять галку)
    //   opts.setFinished  — проставить «Закончено»=now
    //   opts.clearFinished— очистить «Закончено» (пустым значением, #4366)
    AtexSlitter.prototype.cutAction = function(eventType, opts) {
        var self = this;
        var cut = this.currentCut;
        if (this.busy || !cut) return Promise.resolve();
        if (this.isCutLocked(cut)) { this.notify('Резка заблокирована очередью', 'error'); return Promise.resolve(); }
        opts = opts || {};
        this.setBusy(true);
        var meta = this.meta.cut;
        var startedRid = reqIdByAnyName(meta, CUT_STARTED_NAMES);
        var inWorkRid = reqIdByName(meta, CUT_REQ.inWork);
        var finishedRid = reqIdByAnyName(meta, ['Закончено', 'Дата завершения', 'Завершено', 'finished_at']);
        var when = this.eventDateTime();
        var fields = {};
        if (opts.setStarted && startedRid && !cut.startedAt) { cut.startedAt = when; fields['t' + startedRid] = when; }
        if (opts.setInWork === true && inWorkRid) { cut.inWork = '1'; fields['t' + inWorkRid] = '1'; }
        // #4366: булев реквизит снимаем нулём (как «Зафиксировано» в планировании, #3508).
        if (opts.setInWork === false && inWorkRid) { cut.inWork = ''; fields['t' + inWorkRid] = '0'; }
        if (opts.setFinished && finishedRid) { cut.finishedAt = when; fields['t' + finishedRid] = when; }
        if (opts.clearFinished && finishedRid) { cut.finishedAt = ''; fields['t' + finishedRid] = ''; }
        var write = Object.keys(fields).length ? this.post('_m_set/' + cut.id + '?JSON', fields) : Promise.resolve();
        return write.then(function() {
            return self.createEvent({ type: eventType, value: opts.value, notes: opts.notes }, cut.id);
        }).then(function() {
            return self.loadEvents(cut.id); // статус резки переустановится из событий
        }).then(function() {
            return self.loadCuts(); // обновить атрибуты резок в списке (Начато/В работе/Закончено)
        }).then(function() {
            self.applyEventStatuses();
            return opts.after ? opts.after() : null;
        }).then(function() {
            self.setBusy(false);
            self.notify(opts.message || ('Событие «' + eventType + '» зафиксировано'), 'success');
            self.render();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка: ' + err.message, 'error');
        });
    };

    // #3557: Начать резку (Ожидает → В работе): «Начато»=now, «В работе»=1.
    AtexSlitter.prototype.startCut = function() {
        return this.cutAction(EV.startCut, { setStarted: true, setInWork: true, message: 'Резка запущена' });
    };
    // #3557: Наладка — открывает резку (если ещё не начата) и переводит в «Наладка».
    // Флаг «В работе» не снимается (снимается только при завершении).
    AtexSlitter.prototype.setupCut = function() {
        return this.cutAction(EV.setup, { setStarted: true, setInWork: true, message: 'Наладка' });
    };
    // #3557: Перерыв — статус «Перерыв», флаг «В работе» остаётся.
    AtexSlitter.prototype.breakCut = function() {
        return this.cutAction(EV.brk, { message: 'Перерыв' });
    };
    // #3557: Возобновить — вернуть в «В работе» (в т.ч. из «Завершена»: снять «Закончено»).
    AtexSlitter.prototype.resumeCut = function() {
        return this.cutAction(EV.resume, { setStarted: true, setInWork: true, clearFinished: true, message: 'Резка возобновлена' });
    };
    // #3557: Прекратить — досрочно завершить: «Закончено»=now, «В работе»=0.
    AtexSlitter.prototype.abortCut = function() {
        return this.cutAction(EV.abort, { setFinished: true, setInWork: false, message: 'Резка прекращена' });
    };
    // #3646: Пропуск — пропустить задание (его не режем): событие «Пропуск», «Закончено»=now,
    // «В работе»=0 → статус «Пропущена» (терминальный, очередь идёт дальше; можно «Возобновить»).
    AtexSlitter.prototype.skipCut = function() {
        return this.cutAction(EV.skip, { setFinished: true, setInWork: false, message: 'Задание пропущено' });
    };

    // #3861: списать расход (погонные метры) с остатка партии сырья резки. Основной
    // остаток — «Остаток, м» = max(0, прежний − расход); «Остаток, м²» пересчитываем
    // из метров по номинальной ширине (взаимовычисляемые) — пишем оба. finishMode —
    // резка завершена: дополнительно снимаем у партии флаг «В работе».
    AtexSlitter.prototype.applyBatchConsumption = function(cut, consumedM, finishMode) {
        var batch = cut && cut.batchId ? this.findBatch(cut.batchId) : null;
        var batchMeta = this.meta.batch;
        if (!batch || !batchMeta) return Promise.resolve(null);
        var remMReq = reqIdByName(batchMeta, BATCH_REQ.remainderM);
        var remAreaReq = reqIdByName(batchMeta, BATCH_REQ.remainder);
        var width = core.toNumber(batch.widthMm) || core.toNumber((this.materialWidths || {})[String(batch.materialId)]);
        var newRemM = core.applyConsumption(batch.remainderM, consumedM);
        var newRemArea = width > 0 ? core.areaFromMeters(newRemM, width) : core.toNumber(batch.remainder);
        var bf = {};
        if (remMReq) bf['t' + remMReq] = newRemM;
        if (remAreaReq) bf['t' + remAreaReq] = newRemArea;
        // #4374: «В работе» у партии сырья означает «партия в обороте»: склад ставит флаг при
        // оприходовании и снимает, когда партия ИСЧЕРПАНА (warehouse.js, batchExhaustedByProvision).
        // Завершение резки само по себе партию из оборота не выводит — на рулоне остаются метры,
        // и он нужен следующим заданиям. Снимаем флаг только когда остаток ушёл в ноль.
        // (До #4366 снятие вообще не доезжало до сервера, поэтому промах не был виден.)
        var retire = finishMode && !(newRemM > 0);
        if (retire) {
            // #4366: «В работе» партии — булев реквизит (1074/16427), снимаем нулём.
            var batchActiveReq = reqIdByAnyName(batchMeta, ['В работе', 'Активно', 'Активная', 'Действует']);
            if (batchActiveReq) bf['t' + batchActiveReq] = '0';
        }
        if (!Object.keys(bf).length) return Promise.resolve(null);
        return this.post('_m_set/' + batch.id + '?JSON', bf).then(function() {
            batch.remainderM = newRemM;
            batch.remainder = newRemArea;
            if (retire && typeof batch.active !== 'undefined') batch.active = '';
        });
    };

    // #3557: Завершить резку — проверки счётчиков, «Закончено»=now, «В работе»=0,
    // событие «Завершить», фиксация факта рулонов в «Партиях ГП» (#3433). #3861:
    // остаток партии списывается расходом в markPassDone (applyBatchConsumption).
    AtexSlitter.prototype.finishCut = function() {
        var self = this;
        var cut = this.currentCut;
        if (this.busy || !cut) return;
        if (this.isCutLocked(cut)) { this.notify('Резка заблокирована очередью', 'error'); return; }

        // Проверки заполнения
        var cStart = core.toNumber(cut.counterStart);
        // #4321: счётчик мотает назад, поэтому «Счётчик кон.» = 0 — законное показание (рулон
        // домотали в ноль). Пустоту от нуля отличаем по самой строке, а не по числу.
        var cEndFilled = String(cut.counterEnd == null ? '' : cut.counterEnd).trim() !== '';
        var meterage = core.meterageFromCounters(cut.counterStart, cut.counterEnd);
        if (!(cStart > 0)) { this.notify('Заполните «Счётчик нач.» перед завершением', 'error'); return; }
        if (!cEndFilled) { this.notify('Заполните «Счётчик кон.» перед завершением', 'error'); return; }
        if (meterage <= 0) { this.notify('Погонаж факт не может быть нулевым (счётчик кон. < счётчик нач. — счётчик мотает назад)', 'error'); return; }

        this.setBusy(true);

        // 1. Погонаж + «Закончено»=now + снять галку «В работе» (#4366: нулём, и пустые
        //    значения теперь доезжают до сервера — см. post)
        var meta = this.meta.cut;
        var meterageRid = reqIdByName(meta, CUT_REQ.meterage);
        var rashodRid = reqIdByName(meta, CUT_REQ.rashod);
        var finishedRid = reqIdByAnyName(meta, ['Закончено', 'Дата завершения', 'Завершено', 'finished_at']);
        var inWorkRid = reqIdByName(meta, CUT_REQ.inWork);

        var fields = {};
        if (meterageRid) fields['t' + meterageRid] = meterage;
        if (rashodRid) fields['t' + rashodRid] = meterage; // #3861: расход сырья, погонные метры
        if (finishedRid) { cut.finishedAt = this.eventDateTime(); fields['t' + finishedRid] = cut.finishedAt; }
        if (inWorkRid) { cut.inWork = ''; fields['t' + inWorkRid] = '0'; }

        this.post('_m_set/' + cut.id + '?JSON', fields).then(function() {
            cut.meterage = String(meterage);
            cut.status = 'Завершена';
            // #3861: остаток партии (Остаток,м + Остаток,м²) уже списан расходом в
            // markPassDone (applyBatchConsumption) перед вызовом finishCut — здесь не трогаем.
        }).then(function() {
            // 3. Событие «Завершить»
            return self.createEvent({ type: EV.finish, value: String(meterage) }, cut.id);
        }).then(function() {
            return self.loadEvents(cut.id);
        }).then(function() {
            // #3433: зафиксировать факт рулонов в «Партиях ГП»
            return self.recordActualRolls(cut);
        }).then(function() {
            return self.loadBatches();
        }).then(function() {
            return self.loadCuts(); // #3557: обновить атрибуты резок в списке
        }).then(function() {
            self.applyEventStatuses();
            self.setBusy(false);
            // #4374: партии может уже не быть в пуле (report material_batches отдаёт только
            // партии «В работе»). Обращение к null роняло ПОСЛЕДНИЙ шаг: запись в БД прошла,
            // а форма оставалась со старым статусом и показывала «Ошибка завершения».
            var batch = cut.batchId ? self.findBatch(cut.batchId) : null;
            self.notify('Резка завершена. Погонаж: ' + meterage + ' м'
                + (batch ? '. Остаток партии: ' + core.round3(batch.remainderM || 0) + ' м' : ''), 'success');
            self.advanceToNextCut(); // #3583: переключить на следующее задание
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка завершения: ' + err.message, 'error');
            self.render();   // #4374: часть записей могла пройти — показываем актуальное состояние
        });
    };

    // #3583: отметить выполненные проходы. «Готово» (markAll=false) — один проход,
    // «Готовы все» (markAll=true) — все (с подтверждением). Увеличивает номер прохода,
    // пересчитывает «Счётчик кон.» = «Счётчик нач.» − проходы×метраж (#4321: счётчик мотает назад) и «Погонаж факт»,
    // пишет событие «Резка» (значение = номер прохода). Когда отмечены все проходы —
    // завершает задание (finishCut) и переключает на следующее.
    AtexSlitter.prototype.markPassDone = function(markAll) {
        var self = this;
        var cut = this.currentCut;
        if (this.busy || !cut) return;
        if (this.isCutLocked(cut)) { this.notify('Резка заблокирована очередью', 'error'); return; }
        if (core.isDone(cut.status)) { this.notify('Задание уже завершено', 'info'); return; }
        var runLength = core.runLengthForCut(cut);
        if (!(runLength > 0)) { this.notify('У задания не задан «Метраж, м» — не могу пересчитать проходы', 'error'); return; }
        var total = core.plannedRunsForCut(cut);
        // #4351: число уже отмеченных проходов — из событий «Резка» (#3621, тот же источник,
        // что у заголовка «Резка N из M»), а НЕ из «Погонаж факт»: у не начатой резки погонаж
        // равен «Счётчик нач.» = остаток партии (пред-заполнение, #4321 счётчик мотает назад),
        // и floor(остаток / метраж) ложно давал «все проходы уже отмечены».
        var done = this.donePassCount(cut);
        var target = markAll ? total : Math.min(done + 1, total);
        if (target <= done) { this.notify('Все проходы уже отмечены', 'info'); return; }

        var run = function() {
            // Завершение задания требует «Счётчик нач.» (как finishCut) — проверяем до записи.
            if (target >= total && !(core.toNumber(cut.counterStart) > 0)) {
                self.notify('Заполните «Счётчик нач.» перед завершением задания', 'error');
                return;
            }
            self.setBusy(true);
            var meterage = core.round3(target * runLength);
            // #3861: расход сырья этого нажатия (погонные метры) = новые проходы × «Метраж, м».
            var consumedM = core.round3(Math.max(0, target - done) * runLength);
            // #4321: счётчик мотает НАЗАД (остаток сырья в рулоне) — «Счётчик кон.» = «Счётчик нач.»
            // МИНУС отмотанный погонаж. Совпадает с остатком партии после списания (applyBatchConsumption
            // ниже вычитает те же метры). Уходит в минус — сырья на план не хватило: рулон кончится
            // раньше, оператор поставит новый и поправит показание (прятать это нулём нельзя).
            var counterEnd = core.round3(core.toNumber(cut.counterStart) - meterage);
            cut.meterage = String(meterage);
            cut.counterEnd = String(counterEnd);
            var meta = self.meta.cut;
            var fields = {};
            var meterageRid = reqIdByName(meta, CUT_REQ.meterage);
            var counterEndRid = reqIdByName(meta, CUT_REQ.counterEnd);
            var rashodRid = reqIdByName(meta, CUT_REQ.rashod);
            var startedRid = reqIdByAnyName(meta, CUT_STARTED_NAMES);
            var inWorkRid = reqIdByName(meta, CUT_REQ.inWork);
            if (meterageRid) fields['t' + meterageRid] = meterage;
            if (counterEndRid) fields['t' + counterEndRid] = counterEnd;
            if (rashodRid) fields['t' + rashodRid] = meterage; // #3861: расход сырья, погонные метры (накопл. по резке)
            if (startedRid && !cut.startedAt) { cut.startedAt = self.eventDateTime(); fields['t' + startedRid] = cut.startedAt; }
            if (inWorkRid) { cut.inWork = '1'; fields['t' + inWorkRid] = '1'; }
            self.post('_m_set/' + cut.id + '?JSON', fields)
                .then(function() { return self.createEvent({ type: EV.pass, value: String(target) }, cut.id); })
                // #3861: списать расход с остатка партии (Остаток,м + Остаток,м²) после каждого
                // нажатия ✓ Готово / ✓✓ Готовы все. На последнем проходе — finishMode (снять «В работе»).
                .then(function() { return self.applyBatchConsumption(cut, consumedM, target >= total); })
                .then(function() {
                    if (target >= total) { self.setBusy(false); self.finishCut(); return null; }
                    return self.loadEvents(cut.id)
                        .then(function() { return self.loadCuts(); })
                        .then(function() {
                            self.applyEventStatuses();
                            self.setBusy(false);
                            self.notify('Отмечен проход ' + target + ' из ' + total, 'success');
                            self.render();
                        });
                }).catch(function(err) {
                    self.setBusy(false);
                    self.notify('Ошибка отметки прохода: ' + err.message, 'error');
                });
        };

        if (markAll) {
            this.confirmModal('Отметить все ' + total + ' проходов выполненными и завершить задание?', run);
        } else {
            run();
        }
    };

    // #3583: переключить на следующее задание в очереди (первое незавершённое после
    // завершения текущего). Нет следующего — просто перерисовать.
    AtexSlitter.prototype.advanceToNextCut = function() {
        var nextId = this.currentQueue().firstOpenCutId;
        if (nextId && String(nextId) !== String(this.currentCutId)) this.openCut(nextId);
        else this.render();
    };

    // #3583: подтверждение без confirm() (раздел 8 гайда) — встроенная модалка.
    AtexSlitter.prototype.confirmModal = function(message, onYes) {
        var overlay = el('div', { class: 'atex-sl-confirm-overlay' });
        var yes = el('button', { class: 'atex-sl-btn atex-sl-btn-primary', type: 'button', text: 'Да, завершить' });
        var no = el('button', { class: 'atex-sl-btn atex-sl-btn-secondary', type: 'button', text: 'Отмена' });
        function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
        yes.addEventListener('click', function() { close(); onYes(); });
        no.addEventListener('click', close);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
        overlay.appendChild(el('div', { class: 'atex-sl-confirm' }, [
            el('div', { class: 'atex-sl-confirm-msg', text: message }),
            el('div', { class: 'atex-sl-confirm-actions' }, [no, yes])
        ]));
        (this.root || document.body).appendChild(overlay);
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

    AtexSlitter.prototype.findBatch = function(batchId) {
        return this.batches.filter(function(b) { return String(b.id) === String(batchId); })[0] || null;
    };

    // Событие смены: пишется с датой/временем (главное значение), типом,
    // оператором и ссылкой на резку (реквизит «Задание в производство»).
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
        var slitterReq = reqIdByName(meta, EVENT_REQ.slitter);   // #4359
        if (typeReq && data.type) params['t' + typeReq] = data.type;
        if (cutReq && cutId) params['t' + cutReq] = cutId;
        if (userReq && this.userId) params['t' + userReq] = this.userId;
        if (valReq && data.value !== '' && data.value != null) params['t' + valReq] = core.toNumber(data.value);
        if (notesReq && data.notes) params['t' + notesReq] = data.notes;
        // #4359: станок пишем ССЫЛКОЙ «Слиттер» — id записи справочника, а не подпись
        // (ref-поле принимает id, см. docs/kb/crud.md). Пишем у ВСЕХ событий — и смены,
        // и резки: по ней потом определяется, к какому станку событие относится.
        var slitterId = data.slitterId || this.selectedSlitterId;
        if (slitterReq && slitterId) params['t' + slitterReq] = slitterId;
        // #3560: «Событие смены» — корневой объект (up=1). Резку НЕ ставим
        // родителем: роль Оператора не имеет доступа на запись в поддерево
        // объекта-резки, и Integram отвечает «нет доступа к реквизиту объекта…
        // или его родителю». Связь с резкой держится реквизитом cutReq (выше);
        // чтение выбирает события по нему же (parseEventRows → cutId).
        return this.post('_m_new/' + meta.id + '?JSON&up=1', params);
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

    // #4332 п.3: «Закрыть смену» — пишет событие смены «Конец смены» (EV.shiftEnd) для
    // выбранного станка и закрывает смену (по последнему событию, hasOpenShift). Заменила
    // «Уборка завершена» (#3861) в этом РМ. Доступна, пока смена открыта (см. renderToolbar).
    AtexSlitter.prototype.closeShift = function() {
        var self = this;
        if (this.busy) return;
        if (!this.selectedSlitterId) { this.notify('Выберите станок', 'error'); return; }
        this.setBusy(true);
        this.createEvent({
            type: EV.shiftEnd,   // «Конец смены»
            notes: [this.selectedSlitterLabel(), this.selectedDate].filter(Boolean).join(' · ')
        }, null).then(function() {
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
                    self.loadEvents(cutId)
                ]);
            }).then(function() {
                self.resolveCutWidth();  // #3460: уточнить ширину входа после loadCutMaterial
                return self.computeSeamless();  // #3609: бесшовное продолжение смены
            }).then(function() {
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
        // #3565 #1: счётчик резок в заголовке обновляется в renderCuts (updateSidebarTitle).
        this.sidebarTitleEl = el('h2', { text: 'Задание в производство' });
        // #3646: галка «Отобразить завершённые» убрана — завершённые видны всегда,
        // на своих местах по очереди.
        var head = el('div', { class: 'atex-sl-sidebar-head' }, [ this.sidebarTitleEl ]);
        aside.appendChild(head);
        this.cutsEl = el('div', { class: 'atex-sl-cuts' });
        aside.appendChild(this.cutsEl);
        this.seamlessEl = el('div', { class: 'atex-sl-seamless' }); // #3609: предупреждения «бесшовная смена» под списком резок
        aside.appendChild(this.seamlessEl);

        this.mainEl = el('section', { class: 'atex-sl-main' });
        layout.appendChild(aside);
        layout.appendChild(this.mainEl);
        this.root.appendChild(layout);
        this.toastHost = this.root;

        this.cutsEl.appendChild(el('div', { class: 'atex-sl-loading', text: 'Загрузка…' }));
        this.mainEl.appendChild(el('div', { class: 'atex-sl-placeholder', text: 'Загрузка данных…' }));

        return this.loadMetadata()
            .then(function() { return Promise.all([self.loadSlitters(), self.loadBatches(), self.loadCuts(), self.loadMaterialWidths()]); })
            // #4317: loadBatches досчитывает остаток сам, но здесь он идёт ПАРАЛЛЕЛЬНО с
            // loadMaterialWidths — партиям без `width_mm` в отчёте ширины тогда ещё нет. Повторяем
            // досчёт, когда справочник ширин уже загружен (fillBatchRemainderM идемпотентен).
            .then(function() { self.fillBatchRemainderM(); self.validateStoredSlitter(); return self.loadShiftEvents(); })
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
