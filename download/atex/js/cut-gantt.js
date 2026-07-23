// Рабочее место atex «Диаграмма Ганта (задания)» (роли Руководитель, Диспетчер).
//
// Полноэкранная диаграмма Ганта по «Заданиям в производство»: ОДНА строка на
// задание, бар на горизонтальной шкале времени (день / 3 дня / неделя / месяц),
// цвет бара кодирует статус (запланировано / в работе / не завершено / в срок /
// с опозданием). Только чтение.
//
// Отличие от «Календаря занятости станков» (machine-calendar, #3339): там дорожка =
// станок, здесь строка = отдельное задание (классический task-Гант). Каждый бар —
// ссылка на рабочее место «Планирование производства» с зашитыми в URL датой,
// станком и заданием, чтобы открыть планировщик на нужном задании. Решение #3638.
//
// Данные — одним отчётом (минимум серверных запросов):
//   • GET /{db}/report/cut_planning?JSON_KV — задания с плановой датой, фактическими
//     стартом/финишем, станком, статусом, длительностью, лидером,
//     заказом и материалом (ссылки резолвятся сервером — доступ к справочникам
//     ролям не нужен, в т.ч. к «Лидер», ср. #3623).
//   • GET /{db}/object/{slitter}/?JSON_OBJ — справочник станков для фильтра (при
//     отсутствии прав станки берутся из самих заданий).
//   • GET /{db}/object/Календарь/?JSON_OBJ — #3875: нерабочие дни (выходные/праздники,
//     таблица #3788) для подсветки на оси; таблицы нет → подсветка выключена.
//
// Чистое ядро (разбор дат, интервалы, статусы, раскладка баров, сортировка строк,
// сборка ссылки на планировщик) вынесено в объект `gantt` и экспортируется через
// module.exports для модульных тестов (experiments/atex-cut-gantt.test.js).

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.AtexCutGantt = api;
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

    // ───────────────────────── Чистое ядро ─────────────────────────

    function stripNum(value) {
        if (typeof value === 'number') return isFinite(value) ? value : 0;
        var text = String(value == null ? '' : value).replace(/\s+/g, '').replace(',', '.');
        var n = parseFloat(text);
        return isFinite(n) ? n : 0;
    }

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

    function refSearchHelper() {
        if (typeof window !== 'undefined' && window.AtexRefSearch) return window.AtexRefSearch;
        if (typeof globalThis !== 'undefined' && globalThis.AtexRefSearch) return globalThis.AtexRefSearch;
        return null;
    }

    // Номер задания = плановая дата-штамп (DATETIME). Юникс-штамп → человекочитаемо.
    function isTimestampCutNumber(value) {
        var s = String(value == null ? '' : value).trim();
        if (!/^\d+$/.test(s)) return false;
        var n = Number(s);
        if (!isFinite(n) || n < 1000000000) return false;
        var d = new Date(n * 1000);
        return !isNaN(d.getTime());
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
        return s;
    }

    function formatDateTimeMinute(date) {
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        return pad(date.getDate()) + '.' + pad(date.getMonth() + 1) + '.' + date.getFullYear() +
            ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    }

    var GANTT_DAY_MS = 86400000;
    var GANTT_MODES = [
        { id: 'day', label: 'День', days: 1 },
        { id: 'three', label: '3 дня', days: 3 },
        { id: 'week', label: 'Неделя', days: 7 },
        { id: 'month', label: 'Месяц', days: 0 }
    ];

    var CUT_DURATION_COLUMNS = ['cut_duration', 'cut_duration_min', 'cut_duration_minutes'];
    // #3698: хранимые активности переналадки из cut_planning (пишет «Планирование
    // производства»). Если отчёт их отдаёт — берём готовые минуты вместо пересчёта.
    var CUT_KNIFE_SETUP_COLUMNS = ['cut_knife_setup_min', 'cut_knife_setup', 'cut_setup_knife_min'];
    var CUT_MATERIAL_WINDING_COLUMNS = ['cut_material_winding_min', 'cut_material_setup_min', 'cut_setup_material_min'];
    // #3700: хранимое «Резка и Лидер» (намотка + лидер) — в cut_planning поле cut_time.
    var CUT_TIME_COLUMNS = ['cut_time', 'cut_cut_leader_min', 'cut_run_leader_min'];

    // URL рабочего места «Планирование производства». Префикс пути = имя БД и
    // отличается между базами (на тест-базе /ateh/, в проде может быть иным), поэтому
    // по умолчанию вычисляем ссылку ОТНОСИТЕЛЬНО текущего РМ (соседний маршрут), а не
    // хардкодим. Может быть переопределён data-атрибутом корня (data-planning-url).
    var DEFAULT_PLANNING_URL = '/atex/production-planning';

    // База ссылки на планировщик из текущего пути: последний сегмент пути заменяем на
    // production-planning. /ateh/cut-gantt → /ateh/production-planning. Вне браузера —
    // DEFAULT_PLANNING_URL (для тестов; pure-функция planningLink принимает base явно).
    function planningBaseFromLocation() {
        if (typeof window === 'undefined' || !window.location || !window.location.pathname) return DEFAULT_PLANNING_URL;
        var path = String(window.location.pathname).replace(/\/+$/, '');
        var idx = path.lastIndexOf('/');
        return (idx >= 0 ? path.slice(0, idx) : '') + '/production-planning';
    }

    // Производные статусы задания — ключ → подпись (для фильтра и легенды).
    var STATUS_LABELS = {
        planned: 'Запланировано',
        running: 'В работе',
        unfinished: 'Не завершено',
        'on-time': 'В срок',
        done: 'Завершено',
        late: 'С опозданием',
        'late-start': 'Старт просрочен',
        unknown: 'Без даты'
    };

    function todayISO() {
        var d = new Date();
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function normalizeMode(mode) {
        var s = String(mode == null ? '' : mode).trim().toLowerCase();
        if (s === '3' || s === '3d' || s === '3days' || s === 'three-days') return 'three';
        for (var i = 0; i < GANTT_MODES.length; i++) {
            if (GANTT_MODES[i].id === s) return s;
        }
        return 'day';   // #3683: период по умолчанию — «День»
    }

    function localDateMs(year, month, day, hour, minute, second) {
        var d = new Date(Number(year), Number(month) - 1, Number(day),
            Number(hour) || 0, Number(minute) || 0, Number(second) || 0, 0);
        if (isNaN(d.getTime())) return null;
        if (d.getFullYear() !== Number(year) || d.getMonth() !== Number(month) - 1 || d.getDate() !== Number(day)) return null;
        return d.getTime();
    }

    function parseDateTimeMs(value) {
        var s = String(value == null ? '' : value).trim();
        if (s === '') return null;
        if (/^\d{9,13}$/.test(s)) {
            var num = Number(s);
            var ms = num >= 1e12 ? num : num * 1000;
            var stamp = new Date(ms);
            var year = stamp.getFullYear();
            if (!isNaN(stamp.getTime()) && year >= 2001 && year <= 2100) return ms;
        }
        var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
        if (iso) return localDateMs(iso[1], iso[2], iso[3], iso[4], iso[5], iso[6]);
        var dmy = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
        if (dmy) return localDateMs(dmy[3], dmy[2], dmy[1], dmy[4], dmy[5], dmy[6]);
        var parsed = Date.parse(s);
        return isNaN(parsed) ? null : parsed;
    }

    function localIsoDateFromMs(ms) {
        var d = new Date(ms);
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function startOfLocalDayMs(ms) {
        var d = new Date(ms);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
    }

    // #3904: «ЧЧ:ММ» (LUNCH_START из «Настройки») → минуты от полуночи. Мусор/пусто → NaN
    // (проверка времени обеда тогда пропускается — поведение как было).
    function parseLunchStartMinutes(val) {
        var m = /^(\d{1,2}):(\d{2})$/.exec(String(val == null ? '' : val).trim());
        if (!m) return NaN;
        var h = Number(m[1]), mi = Number(m[2]);
        if (!isFinite(h) || !isFinite(mi) || h > 23 || mi > 59) return NaN;
        return h * 60 + mi;
    }

    // #3875: «Календарь» (#3788) — пометка нерабочих дней (выходных/праздников) на оси Ганта.
    // Та же логика, что в «Планировании производства»: «Праздничный день» делает дату нерабочей
    // (даже будни), «Рабочий день» — рабочей (даже Сб/Вс); по умолчанию (нет записи) Сб/Вс — выходные.
    var DAY_TYPE_HOLIDAY = 'Праздничный день';
    var DAY_TYPE_WORKING = 'Рабочий день';

    // Ссылка «id:Метка» → метка (для значения «Тип дня»). Без двоеточия — значение как есть.
    function refLabel(raw) {
        var s = String(raw == null ? '' : raw);
        var i = s.indexOf(':');
        return i >= 0 ? s.slice(i + 1) : s;
    }

    // «ДД.ММ.ГГГГ» → числовой ключ дня ГГГГММДД (для карты календаря); мусор → null.
    function parseDmyKey(str) {
        var m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(str == null ? '' : str).trim());
        return m ? (Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1])) : null;
    }

    // Миллисекунды → ключ дня ГГГГММДД (локальный день).
    function dayKeyFromMs(ms) {
        var d = new Date(Number(ms));
        if (isNaN(d.getTime())) return null;
        return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    }

    // Рабочий ли день. calendarByDay: { ГГГГММДД: 'Праздничный день'|'Рабочий день' } (исключения);
    // dow — день недели (0=Вс … 6=Сб). «Рабочий день» делает выходной рабочим, «Праздничный день» —
    // будни нерабочим; иначе обычное правило (Сб/Вс — выходные).
    function dayTypeWorking(dayKey, dow, calendarByDay) {
        var t = calendarByDay && calendarByDay[dayKey];
        if (t === DAY_TYPE_WORKING) return true;
        if (t === DAY_TYPE_HOLIDAY) return false;
        return dow !== 0 && dow !== 6;
    }

    // Рабочий ли календарный день (по мс). Пустая/битая дата → считаем рабочим (не помечаем).
    function dayIsWorking(ms, calendarByDay) {
        var d = new Date(Number(ms));
        if (isNaN(d.getTime())) return true;
        return dayTypeWorking(dayKeyFromMs(d.getTime()), d.getDay(), calendarByDay);
    }

    function shiftIsoDate(iso, days) {
        var ms = parseDateTimeMs(iso);
        if (ms == null) ms = Date.now();
        var d = new Date(ms);
        return localIsoDateFromMs(new Date(d.getFullYear(), d.getMonth(), d.getDate() + Number(days || 0), 0, 0, 0, 0).getTime());
    }

    function formatDateShort(ms) {
        var d = new Date(ms);
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        return pad(d.getDate()) + '.' + pad(d.getMonth() + 1);
    }

    function formatDateFull(ms) {
        var d = new Date(ms);
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
    }

    function formatTime(ms) {
        var d = new Date(ms);
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        return pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function rangeLabel(startMs, endMs) {
        var lastMs = endMs - 1;
        if (localIsoDateFromMs(startMs) === localIsoDateFromMs(lastMs)) return formatDateFull(startMs);
        return formatDateFull(startMs) + ' - ' + formatDateFull(lastMs);
    }

    function ganttRange(anchorIso, mode) {
        var normalized = normalizeMode(mode);
        var anchorMs = parseDateTimeMs(anchorIso);
        if (anchorMs == null) anchorMs = startOfLocalDayMs(Date.now());
        var anchorDay = startOfLocalDayMs(anchorMs);
        var startMs, endMs;
        if (normalized === 'week') {
            var wd = new Date(anchorDay).getDay();
            var mondayOffset = (wd + 6) % 7;
            startMs = anchorDay - mondayOffset * GANTT_DAY_MS;
            endMs = startMs + 7 * GANTT_DAY_MS;
        } else if (normalized === 'month') {
            var m = new Date(anchorDay);
            startMs = new Date(m.getFullYear(), m.getMonth(), 1, 0, 0, 0, 0).getTime();
            endMs = new Date(m.getFullYear(), m.getMonth() + 1, 1, 0, 0, 0, 0).getTime();
        } else {
            var days = normalized === 'three' ? 3 : 1;
            startMs = anchorDay;
            endMs = startMs + days * GANTT_DAY_MS;
        }
        var outDays = [];
        for (var t = startMs; t < endMs; t += GANTT_DAY_MS) {
            outDays.push({
                iso: localIsoDateFromMs(t),
                label: formatDateShort(t),
                leftPct: round3(((t - startMs) / (endMs - startMs)) * 100)
            });
        }
        return {
            mode: normalized, startMs: startMs, endMs: endMs,
            startIso: localIsoDateFromMs(startMs), endIso: localIsoDateFromMs(endMs),
            label: rangeLabel(startMs, endMs), days: outDays
        };
    }

    function shiftAnchor(anchorIso, mode, direction) {
        var range = ganttRange(anchorIso, mode);
        var dir = Number(direction) || 0;
        if (range.mode === 'month') {
            var d = new Date(range.startMs);
            return localIsoDateFromMs(new Date(d.getFullYear(), d.getMonth() + dir, 1, 0, 0, 0, 0).getTime());
        }
        var step = range.mode === 'week' ? 7 : (range.mode === 'three' ? 3 : 1);
        return shiftIsoDate(range.startIso, dir * step);
    }

    // #3713: число дней между «С» и «По» включительно. Нужно для шага навигации и
    // оценки плотности (px/мин) произвольного диапазона.
    function rangeDaySpan(fromIso, toIso) {
        var f = parseDateTimeMs(fromIso);
        if (f == null) return 1;
        var t = parseDateTimeMs(toIso);
        if (t == null) t = f;
        var days = Math.round((startOfLocalDayMs(t) - startOfLocalDayMs(f)) / GANTT_DAY_MS) + 1;
        return days > 0 ? days : 1;
    }

    // #3713: режим (для px/мин и подсветки кнопки), наиболее подходящий диапазону в N дней.
    function daySpanToMode(fromIso, toIso) {
        var days = rangeDaySpan(fromIso, toIso);
        if (days <= 1) return 'day';
        if (days <= 3) return 'three';
        if (days <= 7) return 'week';
        return 'month';
    }

    // #3713: произвольный диапазон [С; По] (включительно по день «По») как период Ганта —
    // форма совпадает с ganttRange. Гант открывается этим диапазоном из «Планирования
    // производства» (deep-link ?from=..&to=..). mode подбирается по длине (px/мин, подсветка).
    function ganttRangeFromTo(fromIso, toIso) {
        var fromMs = parseDateTimeMs(fromIso);
        if (fromMs == null) fromMs = startOfLocalDayMs(Date.now());
        var startMs = startOfLocalDayMs(fromMs);
        var toMs = parseDateTimeMs(toIso);
        var endDayMs = toMs == null ? startMs : startOfLocalDayMs(toMs);
        if (endDayMs < startMs) endDayMs = startMs;
        var endMs = endDayMs + GANTT_DAY_MS;   // «По» включительно
        var outDays = [];
        for (var t = startMs; t < endMs; t += GANTT_DAY_MS) {
            outDays.push({
                iso: localIsoDateFromMs(t),
                label: formatDateShort(t),
                leftPct: round3(((t - startMs) / (endMs - startMs)) * 100)
            });
        }
        return {
            mode: daySpanToMode(localIsoDateFromMs(startMs), localIsoDateFromMs(endDayMs)),
            startMs: startMs, endMs: endMs,
            startIso: localIsoDateFromMs(startMs), endIso: localIsoDateFromMs(endMs),
            label: rangeLabel(startMs, endMs), days: outDays
        };
    }

    function cutDeadlineMs(cut) {
        var planMs = parseDateTimeMs(cut && cut.planDate);
        var duration = stripNum(cut && cut.duration);
        if (planMs == null || !(duration > 0)) return null;
        return planMs + duration * 60000;
    }

    function cutStatus(cut, nowMs) {
        var now = Number(nowMs);
        if (!isFinite(now)) now = Date.now();
        var planMs = parseDateTimeMs(cut && cut.planDate);
        var startMs = parseDateTimeMs(cut && cut.startDate);
        var endMs = parseDateTimeMs(cut && cut.endDate);
        var deadlineMs = cutDeadlineMs(cut);
        var unfinished = truthyFlag(cut && cut.status);
        if (endMs != null) {
            if (deadlineMs != null && endMs > deadlineMs) return { key: 'late', label: STATUS_LABELS.late };
            return deadlineMs != null ? { key: 'on-time', label: STATUS_LABELS['on-time'] } : { key: 'done', label: STATUS_LABELS.done };
        }
        if (deadlineMs != null && now > deadlineMs) return { key: 'late', label: STATUS_LABELS.late };
        if (unfinished) return { key: 'unfinished', label: STATUS_LABELS.unfinished };
        if (startMs != null) return { key: 'running', label: STATUS_LABELS.running };
        if (planMs != null && now > planMs) return { key: 'late-start', label: STATUS_LABELS['late-start'] };
        if (planMs != null) return { key: 'planned', label: STATUS_LABELS.planned };
        return { key: 'unknown', label: STATUS_LABELS.unknown };
    }

    // #4334: Гант — инструмент ПЛАНИРОВАНИЯ. Бар привязан к плановым таймингам (planDate +
    // плановая длительность); фактические старт/финиш НЕ двигают и не растягивают бар — они
    // только красят его (cutStatus) и видны в тултипе. Если оператор начал позже или выполнил
    // завтрашнее, план не съезжает автоматически: диспетчер переносит задание сам. План
    // отсутствует (легаси-данные без cut_plan_date) → фолбэк на фактический старт, чтобы
    // задание не пропало с дорожки.
    function cutTimeRange(cut) {
        var planMs = parseDateTimeMs(cut && cut.planDate);
        var startMs = parseDateTimeMs(cut && cut.startDate);
        var endMs = parseDateTimeMs(cut && cut.endDate);
        var visualStartMs = planMs != null ? planMs : startMs;
        if (visualStartMs == null) return null;
        var deadlineMs = cutDeadlineMs(cut);
        // Окно (endMs) — грубый фолбэк длительности для легаси-данных без cut_time (см.
        // cutBarMinutes): срок или +30 мин от планового старта. Фактический финиш сюда не идёт.
        var visualEndMs = deadlineMs != null && deadlineMs > visualStartMs ? deadlineMs : visualStartMs + 30 * 60000;
        return {
            startMs: visualStartMs, endMs: visualEndMs, planMs: planMs,
            actualStartMs: startMs, actualEndMs: endMs, deadlineMs: deadlineMs
        };
    }

    // #3668: бары размещаются по РЕАЛЬНОМУ времени (план/факт): позиция и ширина бара
    // считаются от начала видимого окна по часам, так разрывы между заданиями видны, а ось
    // совпадает с часами. Геометрия в px. Масштаб (px на минуту) зависит от режима: чем шире
    // период, тем мельче, чтобы общая ширина дорожки оставалась обозримой.
    var MODE_PX_PER_MIN = { day: 2, three: 1, week: 0.4, month: 0.08 };
    var GANTT_PX_PER_MIN = MODE_PX_PER_MIN.day;     // масштаб по умолчанию (режим «День»)
    var GANTT_MIN_BAR_PX = 8;   // минимальная видимая ширина бара (текст выходит за его рамки)
    var GANTT_DAY_START_HOUR = 8;   // рабочее окно — смена 08:00…
    var GANTT_DAY_END_HOUR = 18;    // …18:00
    var GANTT_SHIFT_TAIL_MIN = 30;  // #3747: получас уборки после смены — правый край рабочего окна 18:30
    // Часовая сетка: все деления одинаковым пунктиром; интервал в часах из набора
    // {1,2,4,6,8,12,24}, подбирается так, чтобы деления были не уже 50px (#3668 п.6).
    var GANTT_HOUR_STEPS = [1, 2, 4, 6, 8, 12, 24];
    var GANTT_TICK_MIN_PX = 50;
    var GANTT_HOUR_MS = 3600000;
    // #4131: бейдж дня «N (M мин)» в строке-заголовке станка — влезет ли подпись в колонку дня.
    // Ширину оцениваем по числу символов (как ширину меток оси — GANTT_TICK_MIN_PX): 12px-шрифт
    // базы неизвестен, поэтому берём с запасом к измеренным 6.7px на символ. Не влезло — подпись
    // усыхает до числа заданий, затем до пустой (минуты остаются в подсказке): обрезка по
    // overflow съедала бы текст с ОБЕИХ сторон (бейдж центрирован) — «4 (1298 ми».
    var GANTT_DAY_STAT_CHAR_PX = 7.5;   // ширина символа подписи (запас к 6.7px при 12px)
    var GANTT_DAY_STAT_PAD_PX = 10;     // поля бейджа (4+4) + рамка дня слева

    function pxPerMinForMode(mode) {
        var m = normalizeMode(mode);
        return MODE_PX_PER_MIN[m] > 0 ? MODE_PX_PER_MIN[m] : GANTT_PX_PER_MIN;
    }

    function floorToHourMs(ms) {
        var d = new Date(ms);
        d.setMinutes(0, 0, 0);
        return d.getTime();
    }
    function ceilToHourMs(ms) {
        var f = floorToHourMs(ms);
        return f === ms ? ms : f + GANTT_HOUR_MS;
    }

    // Видимое временнóе окно дорожки: от первого до последнего задания (по реальному
    // времени, снап до целого часа). Заданий нет — смена startHour…endHour дня периода.
    function ganttWindow(cuts, range, opts) {
        var o = opts || {};
        var startHour = o.startHour != null ? Number(o.startHour) : GANTT_DAY_START_HOUR;
        var endHour = o.endHour != null ? Number(o.endHour) : GANTT_DAY_END_HOUR;
        var minMs = null, maxMs = null;
        (cuts || []).forEach(function(cut) {
            var tr = cutTimeRange(cut);
            if (!tr) return;
            // #3675 п.3 / #3700: бар = [наладка][резка+лидер]; правый край = старт + (наладка +
            // резка/лидер) минут. Хранимый cut_time даёт точную длину сегмента резки+лидера
            // (фолбэк — окно cutTimeRange, тогда формула эквивалентна прежней tr.endMs + наладка).
            var barEndMs = tr.startMs + (cutBarMinutes(cut) + cutSetupMin(cut).total) * 60000;
            if (minMs == null || tr.startMs < minMs) minMs = tr.startMs;
            if (maxMs == null || barEndMs > maxMs) maxMs = barEndMs;
        });
        if (minMs == null || maxMs == null) {
            var dayMs = range && range.startMs != null ? startOfLocalDayMs(range.startMs) : startOfLocalDayMs(Date.now());
            minMs = dayMs + startHour * GANTT_HOUR_MS;
            maxMs = dayMs + endHour * GANTT_HOUR_MS;
        }
        var startMs = floorToHourMs(minMs);
        var endMs = ceilToHourMs(maxMs);
        if (!(endMs > startMs)) endMs = startMs + GANTT_HOUR_MS;
        return { startMs: startMs, endMs: endMs };
    }

    // Ширина дорожки = длительность окна × масштаб.
    function ganttTrackPx(win, pxPerMin) {
        var ppm = pxPerMin > 0 ? pxPerMin : GANTT_PX_PER_MIN;
        if (!win || win.endMs == null || win.startMs == null) return 1;
        return Math.max(round3((win.endMs - win.startMs) / 60000 * ppm), 1);
    }

    // #3747: правый край бара задания (мс) — старт + наладка + резка+лидер. Та же формула,
    // что в ganttWindow; нужна, чтобы рабочее окно дня покрывало захлёст бара за смену.
    function cutBarEndMs(cut) {
        var tr = cutTimeRange(cut);
        if (!tr) return null;
        return tr.startMs + (cutBarMinutes(cut) + cutSetupMin(cut).total) * 60000;
    }

    // #3846: маркеры «Обед» для Ганта. Обед (#3342) уже зашит ГЕНЕРАЦИЕЙ в planStart
    // послеобеденных резок: между концом окна одной резки и началом окна следующей в ТОМ ЖЕ
    // календарном дне образуется зазор ≈ длительности обеда (LUNCH_DURATION). Раньше Гант его
    // не подписывал → зазор выглядел необъяснённой «дырой в планировании» (#3842/#3846). Находим
    // такой зазор и отдаём маркер, привязанный к НАЧАЛУ послеобеденной резки (как блок обеда в
    // «Планировании производства», чтобы оба РМ показывали обед одинаково). lunchDurationMin ≤ 0
    // (обед выключен/настройка не загрузилась) → []. ordered — резки станка в порядке очереди;
    // scale — ось ganttScale (нерабочее время свёрнуто). → [{ beforeIndex, leftPx, widthPx,
    // startMs, endMs, durationMin }], по одному на день с обедом. #4035: если у дня зазор-обеда
    // нет (переходящий/непрерывный день, длинная резка через полдень), но окно резки накрывает
    // LUNCH_START — добавляем carrier-фолбэк ({ fallback:true, carrierIndex }, рисуется строкой
    // ПОСЛЕ несущей резки, без сдвига баров). Чистая — покрыта тестом.
    function ganttLunchMarkers(ordered, scale, lunchDurationMin, lunchStartMin) {
        var lunchDur = Number(lunchDurationMin) || 0;
        if (!(lunchDur > 0) || !ordered || !scale || typeof scale.toPx !== 'function') return [];
        var lunchStart = Number(lunchStartMin);   // #3904: минуты от полуночи; NaN = проверку времени пропускаем
        var out = [];
        var lunchByDay = {};
        for (var i = 1; i < ordered.length; i++) {
            var prevEnd = cutBarEndMs(ordered[i - 1]);
            var curTr = cutTimeRange(ordered[i]);
            if (prevEnd == null || !curTr) continue;
            var curStart = curTr.startMs;
            var day = startOfLocalDayMs(curStart);
            if (lunchByDay[day]) continue;                       // один обед на день
            if (startOfLocalDayMs(prevEnd) !== day) continue;    // зазор через ночь (стык дней) — не обед
            var gapMin = (curStart - prevEnd) / 60000;
            if (gapMin < lunchDur - 1) continue;                 // зазор меньше обеда — не обед (встык/мелкий простой)
            // #3904: зазор — обед, ТОЛЬКО если послеобеденная резка начинается у времени обеда
            // (≥ LUNCH_START). Иначе ПЕРВЫЙ большой зазор дня (утренний — настройка резки после
            // короткой переходящей резки) ошибочно помечался обедом. LUNCH_START неизвестен (нет
            // ключа/настройка не загрузилась) → проверку пропускаем (поведение как было).
            if (isFinite(lunchStart) && (curStart - day) / 60000 < lunchStart) continue;
            // #4121: и ТОЛЬКО если зазор идёт сразу за «несущим» обеда — заданием, начавшимся не
            // позже LUNCH_START (генерация вставляет обед именно после него). Иначе любой поздний
            // простой дня (второй «Отпуск» станка, окно ТО) забирал бы себе роль обеда: день
            // помечался «обед в плане есть», и сквозной обед переставал сдвигать бары (#4121).
            var prevTr = cutTimeRange(ordered[i - 1]);
            if (isFinite(lunchStart) && (!prevTr || (prevTr.startMs - day) / 60000 > lunchStart)) continue;
            // #3909: при известном LUNCH_START обед ФИКСИРУЕМ в 12:20 (а не в зазоре после задания,
            // куда генерация зашила +40). Зазор лежит сразу после «несущего» задания (ordered[i-1]),
            // чьё окно содержит 12:20 — его полосу растягиваем до старта послеобеденного задания
            // (carrierIndex/postStartMs, см. render), а обед рисуем ВНУТРИ этого пролёта. LUNCH_START
            // неизвестен → прежняя привязка к началу послеобеденной резки (зазор как есть).
            var fixed = isFinite(lunchStart);
            var startMs = fixed ? (day + lunchStart * 60000) : (curStart - lunchDur * 60000);
            var endMs = fixed ? (day + (lunchStart + lunchDur) * 60000) : curStart;
            out.push({
                beforeIndex: i,
                carrierIndex: fixed ? (i - 1) : null,   // #3909: задание, растягиваемое обедом (несущее 12:20)
                postStartMs: fixed ? curStart : null,   // #3909: старт послеобеденного задания (предел растяжки)
                startMs: startMs,
                endMs: endMs,
                leftPx: scale.toPx(startMs),
                widthPx: Math.max(round3(scale.toPx(endMs) - scale.toPx(startMs)), 1),
                durationMin: lunchDur
            });
            lunchByDay[day] = true;
        }
        // #4035: carrier-фолбэк обеда. Зазор-детектор выше находит обед лишь там, где генерация
        // оставила «дыру» ≈ LUNCH_DURATION между двумя резками дня. На днях БЕЗ такой дыры
        // (переходящие/непрерывные дни, одна длинная резка через полдень) обеденная строка
        // пропадала (#4035). Для каждого такого дня рисуем обед ВНУТРИ «несущей» резки — той, чьё
        // СОХРАНЁННОЕ окно (наладка+резка) накрывает LUNCH_START — как перерыв (#4007): отдельной
        // строкой-бэндом на оси, БЕЗ сдвига/растяжки баров (дыры нет — бар уже непрерывно накрывает
        // 12:20). Нужен известный LUNCH_START (иначе времени привязки нет → фолбэк не строим).
        if (isFinite(lunchStart)) {
            for (var j = 0; j < ordered.length; j++) {
                var trF = cutTimeRange(ordered[j]);
                if (!trF) continue;
                var dayF = startOfLocalDayMs(trF.startMs);
                if (lunchByDay[dayF]) continue;                  // на этот день обед уже есть (зазор/фолбэк)
                var startInDay = (trF.startMs - dayF) / 60000;
                var lenMin = cutBarMinutes(ordered[j]) + cutSetupMin(ordered[j]).total;   // как «несущее» у перерывов
                if (!(startInDay <= lunchStart && lunchStart < startInDay + lenMin)) continue;   // окно не накрывает 12:20
                var fbStartMs = dayF + lunchStart * 60000;
                var fbEndMs = dayF + (lunchStart + lunchDur) * 60000;
                out.push({
                    fallback: true,               // #4035: обед-бэнд без дыры — строкой ПОСЛЕ несущей резки
                    beforeIndex: null,
                    carrierIndex: j,
                    postStartMs: null,            // растяжка несущей не нужна (дыры нет)
                    startMs: fbStartMs,
                    endMs: fbEndMs,
                    leftPx: scale.toPx(fbStartMs),
                    widthPx: Math.max(round3(scale.toPx(fbEndMs) - scale.toPx(fbStartMs)), 1),
                    durationMin: lunchDur
                });
                lunchByDay[dayF] = true;
            }
        }
        return out;
    }

    // #4007 (ТЗ §5): маркеры коротких перерывов для Ганта. В отличие от обеда (его генерация
    // ЗАШИВАЕТ в planStart послеобеденных резок), перерывы (FIRST_INTERVAL 10:00 / SECCOND_INTERVAL
    // 15:00, по INTERVAL_DURATION_MN 10 мин) при планировании НЕ участвуют — их нет в сохранённых
    // стартах. Поэтому Гант дорисовывает их сам: перерыв попадает в задание, чьё СОХРАНЁННОЕ окно
    // (наладка+резка) его накрывает («несущее»); это задание визуально раздвигается на длительность
    // перерыва (см. растяжку в layoutGroups), а все ПОСЛЕДУЮЩИЕ задания того же дня сдвигаются
    // вправо на ту же длительность (shiftMinByIndex — накопительно по дням). Перерыв без несущего
    // задания (попал в простой или после последней резки дня) не рисуется и никого не сдвигает.
    // ordered — резки станка в порядке дорожки; scale — свёрнутая ось; opts.barStarts — старты
    // баров (dedupeBarStarts), opts.pxPerMin — масштаб. breaks — [{ startMin, durationMin, label }],
    // startMin — минуты от полуночи. #4121: opts.lunches — маркеры ganttLunchMarkers; обед-фолбэк
    // (#4035, fallback=true) в сохранённые старты НЕ зашит, поэтому сдвигает бары наравне с
    // перерывом; обед-зазор генерация уже вписала в planStart — он не сдвигает никого.
    // Чистая — покрыта тестом. → { markers: [{ carrierIndex,
    // beforeIndex, dayMs, startMs, endMs, leftPx, widthPx, durationMin, label }], shiftMinByIndex }.
    function ganttBreakMarkers(ordered, scale, breaks, opts) {
        var n = (ordered || []).length;
        var shiftMinByIndex = [];
        for (var z = 0; z < n; z++) shiftMinByIndex.push(0);
        var brks = (breaks || []).filter(function(b) {
            return b && Number(b.durationMin) > 0 && isFinite(Number(b.startMin));
        }).slice().sort(function(a, b) { return Number(a.startMin) - Number(b.startMin); });
        var o = opts || {};
        // #4121: обед-фолбэк (#4035) — обед, которого НЕТ в сохранённых стартах: генерация не
        // оставила под него зазор (день после «Отпуска» станка пакуется встык, см. #3764
        // shiftPlacementsPastDowntime). Станок в обед всё равно стоит, поэтому такой обед двигает
        // задания дня после несущего — как перерыв (#4114 п.1). Обед-зазор (fallback≠true) уже
        // зашит в planStart: он растягивает несущий бар, но никого не сдвигает (иначе двойной учёт).
        var lunches = (o.lunches || []).filter(function(l) {
            return l && l.fallback && l.carrierIndex != null && Number(l.durationMin) > 0;
        });
        if ((!brks.length && !lunches.length) || !n || !scale || typeof scale.toPx !== 'function') {
            return { markers: [], shiftMinByIndex: shiftMinByIndex };
        }
        var ppm = Number(o.pxPerMin) > 0 ? Number(o.pxPerMin)
            : (Number(scale.pxPerMin) > 0 ? Number(scale.pxPerMin) : GANTT_PX_PER_MIN);
        var barStarts = o.barStarts || [];
        // Окно каждого бара по СОХРАНЁННОМУ старту: день, старт-в-дне (мин), длина (наладка+резка).
        var bars = [];
        for (var i = 0; i < n; i++) {
            var tr = cutTimeRange(ordered[i]);
            var startMs = barStarts[i] != null ? barStarts[i] : (tr ? tr.startMs : null);
            if (startMs == null) { bars.push(null); continue; }
            var day = startOfLocalDayMs(startMs);
            bars.push({
                index: i, day: day,
                clockMin: (startMs - day) / 60000,
                lenMin: cutBarMinutes(ordered[i]) + cutSetupMin(ordered[i]).total
            });
        }
        // Индексы баров по дням (в порядке дорожки).
        var dayOrder = [], byDay = {};
        bars.forEach(function(b) {
            if (!b) return;
            if (!byDay[b.day]) { byDay[b.day] = []; dayOrder.push(b.day); }
            byDay[b.day].push(b);
        });
        var markers = [];
        dayOrder.forEach(function(day) {
            var dayBars = byDay[day];
            // #4121: события дня, которые двигают бары, — перерывы и обед-фолбэк. Обходим их в
            // хронологическом порядке: сдвиг накапливается (перерыв 10:00 → обед 12:20 → перерыв
            // 15:00). У перерыва несущего ищем по сохранённому окну, у обеда он уже известен
            // (ganttLunchMarkers). Маркер кладём только для перерыва — обед рисуется своим списком.
            var events = brks.map(function(B) {
                return { startMin: Number(B.startMin), durationMin: Number(B.durationMin), brk: B };
            });
            lunches.forEach(function(l) {
                if (startOfLocalDayMs(l.startMs) !== day) return;
                events.push({ startMin: (l.startMs - day) / 60000, durationMin: Number(l.durationMin), lunch: l });
            });
            events.sort(function(a, b) { return a.startMin - b.startMin; });
            // #4114 п.1: заказчик исключил обед/перерывы из «рисуй как есть» (#4099) — они
            // ЛЕГАЛЬНО двигают всё, что идёт после них в тот же день (реальный простой станка).
            // shiftDayMin — накопительный сдвиг ОТ ПРЕДЫДУЩИХ событий этого дня; несущий бар
            // сам не двигается (его раздвигает растяжка в layoutGroups), сдвигаются только
            // задания ПОСЛЕ него.
            var shiftDayMin = 0;
            events.forEach(function(E) {
                var dur = Math.round(E.durationMin);
                // Несущее задание — первое, чьё СОХРАНЁННОЕ окно накрывает время события. У обеда
                // несущий вычислен раньше (тем же правилом), берём его по индексу в дорожке.
                var carrier = null, carrierPos = -1;
                for (var k = 0; k < dayBars.length; k++) {
                    var cb = dayBars[k];
                    var hit = E.lunch ? (cb.index === E.lunch.carrierIndex)
                        : (cb.clockMin <= E.startMin && E.startMin < cb.clockMin + cb.lenMin);
                    if (hit) { carrier = cb; carrierPos = k; break; }
                }
                if (!carrier) return;   // перерыв в простое / после последней резки дня — не рисуем
                if (E.brk) {
                    // Позиция маркера — реальное время перерыва + сдвиг от предыдущих событий ЭТОГО
                    // дня (если несущий бар уже был отодвинут более ранним перерывом/обедом).
                    var baseLeftPx = scale.toPx(day + E.startMin * 60000) + round3(shiftDayMin * ppm);
                    markers.push({
                        carrierIndex: carrier.index,
                        beforeIndex: carrier.index + 1,
                        dayMs: day,
                        startMs: day + E.startMin * 60000,
                        endMs: day + (E.startMin + dur) * 60000,
                        leftPx: round3(baseLeftPx),
                        widthPx: Math.max(round3(dur * ppm), 1),
                        durationMin: dur,
                        label: E.brk.label || 'Перерыв'
                    });
                }
                shiftDayMin += dur;
                // Все последующие бары ЭТОГО дня (после несущего) сдвигаются на dur; несколько
                // событий в одном дне накапливаются (shiftDayMin растёт по мере обхода).
                for (var m = carrierPos + 1; m < dayBars.length; m++) {
                    shiftMinByIndex[dayBars[m].index] += dur;
                }
            });
        });
        return { markers: markers, shiftMinByIndex: shiftMinByIndex };
    }

    // #3747: рабочие отрезки дорожки — по одному на КАЛЕНДАРНЫЙ день с заданиями, окно
    // [DAY_START_HOUR; DAY_END_HOUR + получас уборки]. Нерабочее время (ночь между сменами)
    // на ось не попадает — отрезки идут встык (дни лесенкой). Бар, вышедший за смену (ранний
    // старт или захлёст резки за 18:30), РАСШИРЯЕТ окно своего дня, чтобы не наложиться на
    // соседний день. Заданий нет → одно окно-смена дня периода (как прежний ganttWindow).
    // → [{startMs, endMs}] по возрастанию. Чистая — покрыта тестом.
    function workingSegments(cuts, range, opts) {
        var o = opts || {};
        var startHour = o.startHour != null ? Number(o.startHour) : GANTT_DAY_START_HOUR;
        var endHour = o.endHour != null ? Number(o.endHour) : GANTT_DAY_END_HOUR;
        var tailMin = o.shiftTailMin != null ? Number(o.shiftTailMin) : GANTT_SHIFT_TAIL_MIN;
        // #4007: перерывы (ТЗ §5) сдвигают бары дня вправо на суммарную длительность перерывов,
        // а сами перерывы планированию прозрачны (в сохранённые старты не зашиты). Расширяем окно
        // каждого дня на этот буфер, чтобы сдвинутым барам/маркерам хватило места на оси.
        // #4121: буфер включает и обед (сквозной обед двигает бары дня, см. ganttBreakMarkers) и
        // добавляется к ЗАХЛЁСТУ тоже: на переполненном дне (#4099) правый край окна равен концу
        // последнего бара, и без запаса сдвинутый бар уехал бы в окно следующего дня (дни встык).
        var breakBuffer = Number(o.breakBufferMin) > 0 ? Number(o.breakBufferMin) : 0;
        var bufferMs = breakBuffer * 60000;
        var tailMs = (tailMin + breakBuffer) * 60000;
        var byDay = {}, order = [];
        (cuts || []).forEach(function(cut) {
            var tr = cutTimeRange(cut);
            if (!tr) return;
            var dayMs = startOfLocalDayMs(tr.startMs);
            var seg = byDay[dayMs];
            if (!seg) {
                seg = byDay[dayMs] = {
                    startMs: dayMs + startHour * GANTT_HOUR_MS,
                    endMs: dayMs + endHour * GANTT_HOUR_MS + tailMs
                };
                order.push(dayMs);
            }
            if (tr.startMs < seg.startMs) seg.startMs = tr.startMs;          // ранний старт
            var barEndMs = cutBarEndMs(cut);
            if (barEndMs != null && barEndMs + bufferMs > seg.endMs) seg.endMs = barEndMs + bufferMs; // захлёст за смену
        });
        // #4229: окна простоя станка («Отпуск») держат колонку КАЖДОГО своего дня на оси, даже если в
        // этот день нет ни одной резки (станок стоит — работы нет). Иначе серый бар отпуска клампился бы
        // (toPx) к краю оси. Спаны приходят уже обрезанными по видимому периоду (layoutGroups), окно дня —
        // стандартная смена [08:00;18:30]; резки того же дня расширяют его как обычно (порядок выше).
        (o.downtimeSpans || []).forEach(function(span) {
            if (!span || span.startMs == null || span.endMs == null || !(span.endMs >= span.startMs)) return;
            var d = startOfLocalDayMs(span.startMs), lastDay = startOfLocalDayMs(span.endMs), guard = 0;
            while (d <= lastDay && guard++ < 400) {
                if (!byDay[d]) {
                    byDay[d] = { startMs: d + startHour * GANTT_HOUR_MS, endMs: d + endHour * GANTT_HOUR_MS + tailMs };
                    order.push(d);
                }
                d = startOfLocalDayMs(d + GANTT_DAY_MS + 2 * GANTT_HOUR_MS);   // следующий день (устойчиво к переводу часов)
            }
        });
        if (!order.length) {
            var dayMs0 = range && range.startMs != null ? startOfLocalDayMs(range.startMs) : startOfLocalDayMs(Date.now());
            return [{ startMs: dayMs0 + startHour * GANTT_HOUR_MS, endMs: dayMs0 + endHour * GANTT_HOUR_MS + tailMs }];
        }
        return order.sort(function(a, b) { return a - b; }).map(function(d) { return byDay[d]; });
    }

    // #3747: масштаб «время → px» по рабочим отрезкам (нерабочее время свёрнуто). Отрезки
    // идут встык: leftPx накапливается, между днями px-разрыва нет. toPx(ms) клампит ms в
    // отрезки: до первого окна → его левый край; в окне → leftPx + (ms−start)×ppm; в ночном
    // разрыве → стык дней (левый край следующего окна). totalPx — сумма ширин окон.
    function ganttScale(segments, pxPerMin) {
        var ppm = pxPerMin > 0 ? pxPerMin : GANTT_PX_PER_MIN;
        var src = (segments || []).slice().sort(function(a, b) { return a.startMs - b.startMs; });
        var acc = 0;
        var segs = src.map(function(s) {
            var widthPx = round3((s.endMs - s.startMs) / 60000 * ppm);
            var seg = { startMs: s.startMs, endMs: s.endMs, leftPx: round3(acc), widthPx: widthPx };
            acc = round3(acc + widthPx);
            return seg;
        });
        function toPx(ms) {
            if (!segs.length) return 0;
            if (ms <= segs[0].startMs) return segs[0].leftPx;
            for (var i = 0; i < segs.length; i++) {
                if (ms <= segs[i].endMs) {
                    if (ms >= segs[i].startMs) return round3(segs[i].leftPx + (ms - segs[i].startMs) / 60000 * ppm);
                    return segs[i].leftPx;   // ночной разрыв перед окном i → стык дней
                }
            }
            var last = segs[segs.length - 1];
            return round3(last.leftPx + last.widthPx);
        }
        return { segments: segs, totalPx: Math.max(round3(acc), 1), pxPerMin: ppm, toPx: toPx };
    }

    // Интервал часовой сетки (в часах) для заданной плотности px/час: наименьший шаг из
    // {1,2,4,6,8,12,24}, дающий деления не уже minPx. Шире 150px бывает только при шаге 1 ч
    // и очень крупном масштабе — мельче часа не делим (#3668 п.6).
    function chooseHourStep(pxPerHour, opts) {
        var o = opts || {};
        var minPx = o.minPx > 0 ? o.minPx : GANTT_TICK_MIN_PX;
        var pph = Number(pxPerHour) || 0;
        for (var i = 0; i < GANTT_HOUR_STEPS.length; i++) {
            if (GANTT_HOUR_STEPS[i] * pph >= minPx) return GANTT_HOUR_STEPS[i];
        }
        return GANTT_HOUR_STEPS[GANTT_HOUR_STEPS.length - 1];
    }

    // #3747: деления часовой сетки — ТОЛЬКО внутри рабочих окон масштаба (нерабочее время не
    // показываем). По каждому окну: тик на левом крае окна с датой (начало смены/дня), далее по
    // сетке часов {1,2,4,…} до конца окна. Метка — «HH:00» (или фактическое начало окна при
    // раннем старте); дата — на первом тике каждого дня. Все деления одинаковым пунктиром.
    // #3756: дни идут встык, поэтому правый край окна — это тик-дата СЛЕДУЮЩЕГО дня. Часовой
    // тик впритык к нему (напр. 18:00 за 30 мин до 18:30) перекрывал бы дату «27.06». Поэтому
    // часовые тики ближе minPx к краю окна (к дате слева/справа) не ставим — дата приоритетнее.
    function hourTicks(scale, pxPerMin, opts) {
        var o = opts || {};
        if (!scale || !scale.segments || !scale.segments.length) return [];
        var ppm = pxPerMin > 0 ? pxPerMin : GANTT_PX_PER_MIN;
        var minPx = o.minPx > 0 ? o.minPx : GANTT_TICK_MIN_PX;   // #3756: зазор до тика-даты
        var stepMs = chooseHourStep(ppm * 60, o) * GANTT_HOUR_MS;
        var ticks = [];
        scale.segments.forEach(function(seg, si) {
            ticks.push({
                ms: seg.startMs,
                hour: new Date(seg.startMs).getHours(),
                leftPx: seg.leftPx,
                label: formatTime(seg.startMs),
                dateLabel: formatDateShort(seg.startMs),
                newDay: true
            });
            var segEndPx = seg.leftPx + seg.widthPx;
            // #3756: справа дата есть только если за окном следует другой день (стык окон);
            // у последнего окна правый край — конец дорожки, тик у края показываем.
            var hasNextDay = si < scale.segments.length - 1;
            for (var ms = floorToHourMs(seg.startMs) + stepMs; ms <= seg.endMs + 0.5; ms += stepMs) {
                if (ms <= seg.startMs) continue;
                var leftPx = scale.toPx(ms);
                // #3756: не ставим часовой тик впритык к дате дня — слева (дата своего окна,
                // напр. при раннем старте) и справа (дата следующего дня на стыке окон).
                if (leftPx - seg.leftPx < minPx || (hasNextDay && segEndPx - leftPx < minPx)) continue;
                ticks.push({
                    ms: ms,
                    hour: new Date(ms).getHours(),
                    leftPx: leftPx,
                    label: formatTime(ms),
                    dateLabel: '',
                    newDay: false
                });
            }
        });
        return ticks;
    }

    // #3675 п.3: минуты наладки ПЕРЕД резкой (для сегментов бара). #4334: бар всегда плановый,
    // поэтому наладка показывается по плану независимо от фактического старта/финиша.
    // { knife, material, total } в минутах; отрицательные/пустые входы → 0.
    function cutSetupMin(cut) {
        var knife = Math.max(0, stripNum(cut && cut.setupKnifeMin));
        var material = Math.max(0, stripNum(cut && cut.setupMaterialMin));
        return { knife: knife, material: material, total: round3(knife + material) };
    }

    // #3700: длительность сегмента «резка+лидер» бара, мин. Берём хранимое «Резка и Лидер»
    // (cut_time) — точную плановую сумму намотки и лидера; нет значения (легаси/до миграции) →
    // грубое окно cutTimeRange. #4334: длительность плановая и у начатых/завершённых — факт.
    // окно бар не растягивает (факт только красит бар). Чистая — тест.
    function cutBarMinutes(cut) {
        if (cut && cut.cutTimeMin != null) return Math.max(0, stripNum(cut.cutTimeMin));
        var tr = cutTimeRange(cut);
        var winMin = tr ? (tr.endMs - tr.startMs) / 60000 : 0;
        // #3705: cut_time не пришёл → намотка (окно cutTimeRange) + расчётный лидер «между резками»
        // (attachLeaderMinutes кладёт cut.leaderMin). Иначе бар короче плана ровно на лидер.
        return round3(winMin + Math.max(0, stripNum(cut && cut.leaderMin)));
    }

    // Текст бара (#3668 п.4): диапазон времени, например «11:19-11:23 (4 мин)».
    // #3680: подпись охватывает ВСЁ задание (наладка + резка), а не только резку.
    // Начало = левый край бара (tr.startMs, та же точка, что у строки .atex-cg-label-main);
    // setupMin раздвигает только правый край — добавляет к окну минуты наладки перед резкой.
    // #3770: окно подписи бара (наладка+резка) как {startMs, endMs, mins} — единый источник
    // и для текста бара (cutBarTime), и для суммы минут в заголовке станка (cutBarSpanMin),
    // чтобы они никогда не расходились. Геометрия — как раньше в cutBarTime.
    function cutBarWindow(cut, setupMin, maxEndMs, startMsOverride) {
        var tr = cutTimeRange(cut);
        if (!tr) return null;
        // #3705: правый край = старт + (резка+лидер) + наладка — ровно та же сумма минут, что у
        // ширины бара (cutBarSegments) и у окна планировщика. Раньше брали tr.endMs (намотка БЕЗ
        // лидера) + наладка → конец задания получался на лидер «между резками» короче плана.
        // #3887: startMsOverride — старт бара, сдвинутый встык при коллизии сохранённых planStart
        // (dedupeBarStarts); нужен, чтобы подпись времени совпала с позицией бара. Нет override —
        // берём сохранённый старт (поведение не меняется для корректных данных).
        var startMs = (startMsOverride != null && isFinite(Number(startMsOverride))) ? Number(startMsOverride) : tr.startMs;
        var endMs = startMs + (cutBarMinutes(cut) + (Number(setupMin) || 0)) * 60000;
        // #3708: не заходить за старт следующего задания того же станка. Длительности хранятся
        // округлёнными вверх (#3635 п.4), а cut_plan_date — по дробному времени, поэтому бар бывает
        // на доли минуты длиннее реального окна и налезал на следующий бар.
        var maxMs = Number(maxEndMs);
        if (maxEndMs != null && isFinite(maxMs) && maxMs > startMs && endMs > maxMs) endMs = maxMs;
        return { startMs: startMs, endMs: endMs, mins: Math.max(1, Math.round((endMs - startMs) / 60000)) };
    }

    function cutBarTime(cut, setupMin, maxEndMs, startMsOverride) {
        var w = cutBarWindow(cut, setupMin, maxEndMs, startMsOverride);
        if (!w) return '';
        return formatTime(w.startMs) + '-' + formatTime(w.endMs) + ' (' + w.mins + ' мин)';
    }

    // #3770: целое число минут, отображаемое в подписи бара (.atex-cg-bar-main). Заголовок
    // станка суммирует эти значения → «6 (262 мин)». Нет окна (нет времени) → 0.
    function cutBarSpanMin(cut, setupMin, maxEndMs, startMsOverride) {
        var w = cutBarWindow(cut, setupMin, maxEndMs, startMsOverride);
        return w ? w.mins : 0;
    }

    // #3675 п.3: ширины сегментов бара (px) при масштабе pxPerMin: [наладка ножей][смена сырья][резка].
    // Наладка слева (раньше по времени), резка справа (главный цвет статуса). Резка — floor до minPx
    // (виден бар и текст). Сегменты наладки с минутами > 0 — floor до 3px, чтобы тонкие были заметны.
    // Нет минут наладки (старый отчёт/начатая резка) → 0, сегменты не рисуются. Чистая — тест.
    function cutBarSegments(cut, pxPerMin, minPx) {
        var ppm = pxPerMin > 0 ? pxPerMin : GANTT_PX_PER_MIN;
        var floor = minPx > 0 ? minPx : GANTT_MIN_BAR_PX;
        var cutMin = cutBarMinutes(cut);   // #3700: намотка+лидер (cut_time) или окно cutTimeRange (фолбэк)
        var cutPx = Math.max(round3(cutMin * ppm), floor);
        var setup = cutSetupMin(cut);
        function segPx(min) { return min > 0 ? Math.max(round3(min * ppm), 3) : 0; }
        var knifePx = segPx(setup.knife);
        var materialPx = segPx(setup.material);
        return {
            knifePx: knifePx, materialPx: materialPx, cutPx: cutPx,
            totalPx: round3(knifePx + materialPx + cutPx),
            knifeMin: setup.knife, materialMin: setup.material, setupMin: setup.total
        };
    }

    // Задание попадает в видимый период (по плановой дате, иначе по фактическому старту)?
    function cutInRange(cut, range) {
        if (!range) return true;
        var ms = parseDateTimeMs(cut && cut.planDate);
        if (ms == null) ms = parseDateTimeMs(cut && cut.startDate);
        if (ms == null) return false;
        return ms >= range.startMs && ms < range.endMs;
    }

    // #4229: «Отпуск» станка — окно простоя { id, startMs, endMs, notes } (мс). Конец пустой/раньше
    // начала → окно длиной в рабочую смену дня начала (просто чтобы бар был видим).
    var DOWNTIME_NOTES_MAX = 10;   // #4238: подпись бара отпуска — диапазон + Примечание ≤10 симв.
    function downtimeEndMs(dt) {
        if (!dt || dt.startMs == null) return null;
        if (dt.endMs != null && dt.endMs > dt.startMs) return dt.endMs;
        // конца нет — считаем простой до конца смены дня начала (08:00→18:30)
        var day = startOfLocalDayMs(dt.startMs);
        return Math.max(dt.startMs, day + GANTT_DAY_END_HOUR * GANTT_HOUR_MS + GANTT_SHIFT_TAIL_MIN * 60000);
    }
    // Примечания, обрезанные до DOWNTIME_NOTES_MAX символов (#4229; #4238 — 10). Пусто → «Отпуск».
    function downtimeNotesText(notes) {
        var s = String(notes == null ? '' : notes).trim();
        if (!s) return 'Отпуск';
        return s.length > DOWNTIME_NOTES_MAX ? s.slice(0, DOWNTIME_NOTES_MAX) : s;
    }
    // Окно простоя пересекает видимый период?
    function downtimeInRange(dt, range) {
        if (!dt || dt.startMs == null) return false;
        if (!range) return true;
        return downtimeEndMs(dt) >= range.startMs && dt.startMs < range.endMs;
    }
    // Спан простоя, обрезанный по видимому периоду (для оси): { startMs, endMs } | null.
    function downtimeSpanClamped(dt, range) {
        if (!dt || dt.startMs == null) return null;
        var s = dt.startMs, e = downtimeEndMs(dt);
        if (range) {
            if (s < range.startMs) s = range.startMs;
            if (e > range.endMs - 1) e = range.endMs - 1;   // endMs период-эксклюзивен → держим в последнем дне
        }
        if (!(e >= s)) return null;
        return { startMs: s, endMs: e };
    }

    // #4238: строки станка — задания в СВОЁМ порядке, «Отпуск» ВСТАВЛЕН в хронологии по старту
    // (а не всегда внизу дня). Задания сохраняют относительный порядок; каждый отпуск встаёт ПЕРЕД
    // первым заданием, начинающимся позже него; отпуск без старта или позже всех заданий — в конец.
    // → [{ kind:'task', task, taskIdx } | { kind:'downtime', downtime }]. Чистая — покрыта тестом.
    function mergeGroupRows(tasks, downtimes) {
        var rows = [];
        var dts = (downtimes || []).filter(Boolean).slice().sort(function(a, b) {
            var am = a.startMs == null ? Infinity : a.startMs;
            var bm = b.startMs == null ? Infinity : b.startMs;
            return am - bm;
        });
        var di = 0;
        (tasks || []).forEach(function(t, taskIdx) {
            while (di < dts.length && dts[di].startMs != null && t && t.startMs != null && dts[di].startMs < t.startMs) {
                rows.push({ kind: 'downtime', downtime: dts[di] });
                di++;
            }
            rows.push({ kind: 'task', task: t, taskIdx: taskIdx });
        });
        while (di < dts.length) {
            rows.push({ kind: 'downtime', downtime: dts[di] });
            di++;
        }
        return rows;
    }

    // #4229: резолв таблицы/колонки из метаданных (как tableByName/columnIndex у «Планирования»).
    // Нужен, чтобы прочитать подчинённую станку таблицу «Отпуск» (id + индексы «Окончание»/«Примечания»).
    function ganttMatchesName(entry, name) {
        if (!entry) return false;
        var t = String(name == null ? '' : name).trim().toLowerCase();
        if (!t) return false;
        if (String(entry.val == null ? '' : entry.val).trim().toLowerCase() === t) return true;
        var alias = entry.alias;
        if (alias == null && entry.attrs) {
            try { var a = typeof entry.attrs === 'string' ? JSON.parse(entry.attrs) : entry.attrs; if (a && a.alias != null) alias = a.alias; }
            catch (e) { /* attrs не JSON */ }
        }
        return String(alias == null ? '' : alias).trim().toLowerCase() === t;
    }
    function ganttTableByName(list, name) {
        var arr = Array.isArray(list) ? list : (list == null ? [] : [list]);
        for (var i = 0; i < arr.length; i++) if (ganttMatchesName(arr[i], name)) return arr[i];
        return null;
    }
    // Индекс колонки реквизита в r[] (r[0] — главное значение, дальше реквизиты в порядке meta.reqs).
    function ganttColumnIndex(meta, reqName) {
        if (!meta) return -1;
        var order = [String(meta.id)].concat((meta.reqs || []).map(function(r) { return String(r.id); }));
        var req = ganttTableByName((meta && meta.reqs) || [], reqName);
        return req == null ? -1 : order.indexOf(String(req.id));
    }

    function cutBarTitle(cut, tr, status) {
        var lines = [];
        lines.push('Задание ' + (formatCutNumber(cut && cut.number) || ('#' + ((cut && cut.id) || ''))));
        if (cut && cut.orderNo) lines.push('Заказ: ' + cut.orderNo);
        if (cut && cut.slitter && cut.slitter.label) lines.push('Станок: ' + cut.slitter.label);
        if (cut && cut.materialName) lines.push('Сырьё: ' + cut.materialName);
        if (cut && cut.leader) lines.push('Лидер: ' + cut.leader);
        // #3675 п.3: наладка перед резкой (если отчёт отдал минуты).
        var setup = cutSetupMin(cut);
        if (setup.knife > 0) lines.push('Наладка ножей: ' + setup.knife + ' мин');
        if (setup.material > 0) lines.push('Смена сырья: ' + setup.material + ' мин');
        // #3700: суммарное «Резка и Лидер» (если отчёт отдал cut_time).
        if (cut && cut.cutTimeMin != null) lines.push('Резка и лидер: ' + Math.max(0, stripNum(cut.cutTimeMin)) + ' мин');
        if (tr.planMs != null) lines.push('План: ' + formatDateTimeMinute(new Date(tr.planMs)));
        if (tr.actualStartMs != null) lines.push('Старт факт: ' + formatDateTimeMinute(new Date(tr.actualStartMs)));
        if (tr.actualEndMs != null) lines.push('Финиш факт: ' + formatDateTimeMinute(new Date(tr.actualEndMs)));
        if (tr.deadlineMs != null) lines.push('Дедлайн: ' + formatDateTimeMinute(new Date(tr.deadlineMs)));
        lines.push('Статус: ' + status.label);
        lines.push('→ открыть в планировании');
        return lines.join('\n');
    }

    // #3675 п.2: сырьё в подписи строки обрезаем до первого пробела — длинные имена
    // («Фольга горячего тиснения МВ …») не влезают в колонку. Полное имя остаётся в
    // тултипе бара (cutBarTitle, «Сырьё: …»).
    function shortMaterialName(name) {
        var s = String(name == null ? '' : name).trim();
        var sp = s.indexOf(' ');
        return sp > 0 ? s.slice(0, sp) : s;
    }

    // Подпись строки в одну строку без слова «Заказ»: «{заказ} / {сырьё} · {намотка} · {метраж} x {резок}»,
    // например «3738 / MWR113L · OUT · 700 x 6» (#3668 п.2, #3675 п.1/п.2). Станок в подпись
    // не входит — он выводится заголовком группы. Сырьё обрезано до первого пробела; «x N» —
    // «Кол-во резок план» (cut_planned_runs), приписывается к метражу прохода.
    function cutRowLabel(cut) {
        var head = (cut && cut.orderNo) ? String(cut.orderNo) : (formatCutNumber(cut && cut.number) || ('#' + ((cut && cut.id) || '')));
        var s = head;
        if (cut && cut.materialName) s += ' / ' + shortMaterialName(cut.materialName);
        if (cut && cut.winding) s += ' · ' + cut.winding;
        if (cut && cut.length > 0) {
            var runs = stripNum(cut.plannedRuns);
            s += ' · ' + cut.length + (runs > 0 ? ' x ' + runs : '');
        }
        return s;
    }

    // Строки отчёта cut_planning → задания (dedup по cut_id). Несколько строк на
    // одно задание (join с обеспечением) схлопываются в одну.
    function rowsToCuts(rows) {
        var byId = {};
        var order = [];
        function str(v) { return v == null ? '' : String(v); }
        function durationOf(row) {
            for (var i = 0; i < CUT_DURATION_COLUMNS.length; i++) {
                var v = row && row[CUT_DURATION_COLUMNS[i]];
                if (v != null && v !== '') return stripNum(v);
            }
            return 0;
        }
        // #3698: хранимая активность (минуты) или null, если колонки нет/пусто — чтобы
        // отличить «сохранён 0» от «не сохранено» (фолбэк на пересчёт в attachSetupMinutes).
        function storedMin(row, cols) {
            for (var i = 0; i < cols.length; i++) {
                var v = row && row[cols[i]];
                if (v != null && v !== '') return stripNum(v);
            }
            return null;
        }
        (rows || []).forEach(function(row) {
            var id = str(row && row.cut_id);
            if (!id || byId[id]) return;
            byId[id] = {
                id: id,
                number: str(row.cut_plan_date),
                planDate: str(row.cut_plan_date),
                status: str(row.cut_status),
                startDate: str(row.cut_start_date),
                endDate: str(row.cut_end_date),
                duration: durationOf(row),
                length: stripNum(row.cut_length),
                plannedRuns: stripNum(row.cut_planned_runs),   // #3675 п.1: «Кол-во резок план» → «x N» в подписи
                // #3675 п.3: вход для расчёта наладки ПЕРЕД резкой (см. attachSetupMinutes).
                // rollerWidth — ширина ролика (сужение → смена ножей); knifeWidths/knifeCount —
                // раскладка ножей из cut_strips (attachStrips), нужна для knifeMoves.
                rollerWidth: stripNum(row.cut_roller_width),
                knifeWidths: [],
                knifeCount: 0,
                leader: str(row.cut_leader),
                orderNo: str(row.order_no),
                materialId: str(row.cut_material_id),
                materialName: str(row.cut_material),
                winding: str(row.cut_winding),
                // #3698: хранимые активности переналадки (если cut_planning их отдаёт) —
                // attachSetupMinutes предпочтёт их пересчёту по соседям. null → не сохранено.
                storedKnifeMin: storedMin(row, CUT_KNIFE_SETUP_COLUMNS),
                storedMaterialMin: storedMin(row, CUT_MATERIAL_WINDING_COLUMNS),
                // #3700: «Резка и Лидер» (cut_time) — намотка + лидер, мин; null → не сохранено.
                cutTimeMin: storedMin(row, CUT_TIME_COLUMNS),
                slitter: { id: row.cut_slitter_id ? String(row.cut_slitter_id) : null, label: str(row.cut_slitter) }
            };
            order.push(id);
        });
        return order.map(function(id) { return byId[id]; });
    }

    // Порядок заданий ВНУТРИ станка: по РЕАЛЬНОМУ времени старта (planDate/факт), затем id.
    // Мутирует переданный массив (он локальный в layoutGroups).
    // #3747/#3923: строки станка идут строго хронологически по времени старта (чистая лесенка
    // через дни) — planStart единственный источник порядка (как РМ «Планирование» и пульт
    // слиттера). id — только тай-брейк при равном старте. «Очередность» больше не хранится.
    function orderCutsInGroup(cuts) {
        cuts.sort(function(a, b) {
            var ta = cutTimeRange(a), tb = cutTimeRange(b);
            var ma = ta ? ta.startMs : Infinity, mb = tb ? tb.startMs : Infinity;
            if (ma !== mb) return ma - mb;
            return String(a.id).localeCompare(String(b.id));
        });
        return cuts;
    }

    // #3675 п.3: op-времена наладки по умолчанию (как в таблице «Время операции, мин»:
    // смена сырья 15 мин, смена ножей 30 мин). #3705: лидер «между резками» BETWEEN_CUTS = 2 мин
    // (как DEFAULT_OP_TIMES планировщика). loadOpTimes переопределяет из базы, если иные.
    var GANTT_OP_TIMES = { MATERIAL_WINDING: 15, KNIFE: 30, BETWEEN_CUTS: 2 };

    // #3705: число резок цуга для лидера (порт cutLeaderRuns планировщика) — «Кол-во план»,
    // округлённое; нет/0 → 1 (один лидер на резку без проходов). Лидер заправляют ПЕРЕД каждой.
    function ganttCutLeaderRuns(cut) {
        var r = stripNum(cut && cut.plannedRuns);
        return r > 0 ? Math.round(r) : 1;
    }

    // #3705: лидер «между резками» в минутах = BETWEEN_CUTS × число резок (как в планировщике).
    // Хранимое «Резка и Лидер» (cut_time) уже включает лидер; этот расчёт — фолбэк, когда отчёт
    // cut_time не отдал, чтобы конец бара совпадал с планом (раньше терялся на лидер). Чистая — тест.
    function ganttLeaderMin(cut, times) {
        var t = times || GANTT_OP_TIMES;
        var unit = Number(t.BETWEEN_CUTS != null ? t.BETWEEN_CUTS : GANTT_OP_TIMES.BETWEEN_CUTS) || 0;
        return round3(unit * ganttCutLeaderRuns(cut));
    }

    function ganttNormWinding(v) {
        var s = String(v == null ? '' : v).trim().toUpperCase();
        return (s === 'IN' || s === 'OUT') ? s : '';
    }

    // Число ножей к перестановке prev→next: нож одинаковой ширины сохраняется (не двигается);
    // moves = max(|prev|,|next|) − пересечение мультимножеств ширин (порт knifeMoves планировщика).
    function ganttKnifeMoves(a, b) {
        function tally(arr) { var m = {}; (arr || []).forEach(function(x) { var k = String(x); m[k] = (m[k] || 0) + 1; }); return m; }
        var ta = tally(a || []), tb = tally(b || []), inter = 0;
        Object.keys(ta).forEach(function(k) { if (tb[k]) inter += Math.min(ta[k], tb[k]); });
        return Math.max((a || []).length, (b || []).length) - inter;
    }

    // Ширины ножей резки для knifeMoves; если не развёрнуты по числу ножей — добиваем сентинелом.
    function ganttEffKnifeWidths(cut) {
        var w = (cut && cut.knifeWidths) || [];
        var keys = w.map(function(x) { return String(Number(x)); });
        var n = Number(cut && cut.knifeCount) || 0;
        while (keys.length < n) keys.push('·');
        return keys;
    }

    // #3675 п.3: минуты наладки перехода prev→next (порт changeoverParts планировщика, БЕЗ лидера):
    //   смена сырья ИЛИ намотки → MATERIAL_WINDING; смена набора ножей ИЛИ сужение ролика → KNIFE.
    //   prev=null (первая резка станка) → 0. Партию сырья не сравниваем (нет в cut_planning) —
    //   мелкое расхождение с планировщиком на «та же намотка, другая партия». → { knife, material } мин.
    function cutChangeoverMinutes(prev, next, times) {
        var t = times || GANTT_OP_TIMES;
        var matWind = Number(t.MATERIAL_WINDING != null ? t.MATERIAL_WINDING : GANTT_OP_TIMES.MATERIAL_WINDING) || 0;
        var knifeTime = Number(t.KNIFE != null ? t.KNIFE : GANTT_OP_TIMES.KNIFE) || 0;
        if (!prev || !next) return { knife: 0, material: 0 };
        var matChange = String(prev.materialId) !== String(next.materialId)
            || ganttNormWinding(prev.winding) !== ganttNormWinding(next.winding);
        var moves = ganttKnifeMoves(ganttEffKnifeWidths(prev), ganttEffKnifeWidths(next));
        var knifeChanged = moves > 0 || (Number(prev.rollerWidth) || 0) > (Number(next.rollerWidth) || 0);
        return {
            knife: knifeChanged && knifeTime > 0 ? round3(knifeTime) : 0,
            material: matChange && matWind > 0 ? round3(matWind) : 0
        };
    }

    // #3693: текущая заправка станка из отчёта prev_cut_setup → { materialId, winding,
    // knifeWidths, knifeCount } по верхней (последней по task_start) задаче станка. Порт
    // prevSetupFromRows планировщика (production-planning.js #3688). rows фильтруются по
    // slitterId; нет задач → null. Нужна для переналадки ПЕРВОЙ резки станка (см. attachSetupMinutes).
    function ganttPrevSetupFromRows(rows, slitterId) {
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
            if (rec.winding === '' && r.wind_dir) rec.winding = ganttNormWinding(r.wind_dir);
        });
        var top = null;
        Object.keys(byTask).forEach(function(tid) {
            if (top === null || byTask[tid].start > byTask[top].start) top = tid;
        });
        if (top === null) return null;
        var rec = byTask[top];
        return { materialId: rec.material, winding: rec.winding, knifeWidths: rec.widths.slice(), knifeCount: rec.widths.length };
    }

    // #3693: строки отчёта prev_cut_setup → карта { slitterId: заправка }. Чистая — тест.
    function ganttPrevSetupBySlitter(rows) {
        var bySlitter = {};
        (rows || []).forEach(function(r) {
            var sid = String(r && r.slitter_id == null ? '' : r.slitter_id);
            if (sid === '') return;
            (bySlitter[sid] = bySlitter[sid] || []).push(r);
        });
        var map = {};
        Object.keys(bySlitter).forEach(function(sid) {
            var setup = ganttPrevSetupFromRows(bySlitter[sid], sid);
            if (setup) map[sid] = setup;
        });
        return map;
    }

    // #3693: синтетическая «предыдущая резка» для первой резки станка от его текущей заправки
    // (порт carryOverPrevCut #3688). cutChangeoverMinutes сравнивает материал/намотку/ножи —
    // партию Гант не сравнивает (нет в cut_planning), поэтому её здесь не переносим. Нет заправки
    // (null) → пустой станок: материал/намотка/ножи отличны → полный сетап.
    function ganttCarryOverPrevCut(prevSetup) {
        if (!prevSetup) {
            return { materialId: ' none', winding: ' none', knifeWidths: [], knifeCount: 0, rollerWidth: 0 };
        }
        return { materialId: prevSetup.materialId, winding: prevSetup.winding,
                 knifeWidths: (prevSetup.knifeWidths || []).slice(),
                 knifeCount: (prevSetup.knifeWidths || []).length, rollerWidth: 0 };
    }

    // #3693: настройка ножей ПЕРВОЙ резки станка с нуля, когда заправка неизвестна (нет данных
    // prev_cut_setup) — порт firstSetupParts/firstSetupCost (#3669 п.2). Только ножи (KNIFE),
    // если у резки есть ножи; смена сырья при неизвестной заправке не бронируется. → минуты.
    function ganttFirstSetupKnifeMin(next, times) {
        var t = times || GANTT_OP_TIMES;
        var knifeTime = Number(t.KNIFE != null ? t.KNIFE : GANTT_OP_TIMES.KNIFE) || 0;
        if (!next || !(knifeTime > 0)) return 0;
        var hasKnives = (Number(next.knifeCount) || 0) > 0 || ((next.knifeWidths || []).length > 0);
        return hasKnives ? round3(knifeTime) : 0;
    }

    // #3675 п.3: раскладка ножей из строк отчёта cut_strips (queryId 8656, JSON_KV:
    // { cut_id, strip_width, strip_qty }) → knifeWidths (ширины, развёрнутые по числу ножей) и
    // knifeCount (Σ strip_qty) на каждое задание. Мутирует cuts. Чистая — покрывается тестами.
    function attachStrips(cuts, rows) {
        var byCut = {};
        (rows || []).forEach(function(row) {
            if (!row) return;
            var id = row.cut_id == null ? '' : String(row.cut_id);
            if (id === '') return;
            var width = stripNum(row.strip_width);
            var qty = Math.max(0, Math.round(stripNum(row.strip_qty)));
            var rec = byCut[id] || (byCut[id] = { widths: [], count: 0 });
            for (var i = 0; i < qty; i++) rec.widths.push(width);
            rec.count += qty;
        });
        (cuts || []).forEach(function(cut) {
            var rec = cut && byCut[String(cut.id)];
            if (rec) { cut.knifeWidths = rec.widths; cut.knifeCount = rec.count; }
        });
        return cuts;
    }

    // #3675 п.3: минуты наладки ПЕРЕД каждой резкой = переналадка с ПРЕДЫДУЩЕЙ резкой того же
    // станка (порядок — по очерёдности/старту, как orderCutsInGroup). Пишет cut.setupKnifeMin /
    // cut.setupMaterialMin. Мутирует cuts. Чистая — покрывается тестами.
    // #3693: ПЕРВАЯ резка станка тоже получает наладку (как в планировщике, #3688): если известна
    // текущая заправка станка (prevSetupBySlitter из отчёта prev_cut_setup) — переналадка от неё
    // (та же конфигурация → 0, другое сырьё/ножи → смена сырья/ножей); заправка неизвестна →
    // настройка ножей с нуля (firstSetup, #3669 п.2). Раньше первая резка ставила 0.
    function attachSetupMinutes(cuts, times, prevSetupBySlitter) {
        var prevMap = prevSetupBySlitter || {};
        var byMachine = {};
        (cuts || []).forEach(function(cut) {
            if (!cut) return;
            var sid = cut.slitter && cut.slitter.id != null ? String(cut.slitter.id) : '';
            (byMachine[sid] || (byMachine[sid] = [])).push(cut);
        });
        Object.keys(byMachine).forEach(function(sid) {
            var arr = orderCutsInGroup(byMachine[sid]);   // тот же порядок, что в дорожке станка
            var prev = null;
            arr.forEach(function(cut) {
                // #3698: если «Планирование производства» сохранило активности (отчёт отдаёт
                // cut_knife_setup_min / cut_material_winding_min) — берём готовые минуты как
                // источник истины и НЕ пересчитываем по соседям (план учитывает смену партии
                // сырья, которой нет в cut_planning). prev всё равно двигаем — для фолбэка
                // последующих несохранённых резок.
                if (cut.storedKnifeMin != null || cut.storedMaterialMin != null) {
                    cut.setupKnifeMin = Math.max(0, stripNum(cut.storedKnifeMin));
                    cut.setupMaterialMin = Math.max(0, stripNum(cut.storedMaterialMin));
                    prev = cut;
                    return;
                }
                var ch;
                if (!prev) {
                    // #3693: первая резка станка — от текущей заправки (prev_cut_setup), иначе ножи с нуля.
                    var setup = prevMap[sid];
                    ch = setup
                        ? cutChangeoverMinutes(ganttCarryOverPrevCut(setup), cut, times)
                        : { knife: ganttFirstSetupKnifeMin(cut, times), material: 0 };
                } else {
                    ch = cutChangeoverMinutes(prev, cut, times);
                }
                cut.setupKnifeMin = ch.knife;
                cut.setupMaterialMin = ch.material;
                prev = cut;
            });
        });
        return cuts;
    }

    // #3705: проставляет cut.leaderMin (лидер «между резками», BETWEEN_CUTS × «Кол-во план») каждому
    // заданию — фолбэк для cutBarMinutes, когда отчёт не отдал «Резка и Лидер» (cut_time). Лидер на
    // соседей не завязан, поэтому считается по одному заданию. Мутирует cuts. Чистая — тест.
    function attachLeaderMinutes(cuts, times) {
        (cuts || []).forEach(function(cut) {
            if (cut) cut.leaderMin = ganttLeaderMin(cut, times);
        });
        return cuts;
    }

    // Ссылка на «Планирование производства» с зашитыми заданием/датой/станком.
    // date — плановый день (YYYY-MM-DD) для фильтра очереди планировщика.
    function planningLink(cut, baseUrl) {
        var base = baseUrl || DEFAULT_PLANNING_URL;
        var params = [];
        if (cut && cut.id != null && cut.id !== '') params.push('cut=' + encodeURIComponent(String(cut.id)));
        var planMs = parseDateTimeMs(cut && cut.planDate);
        if (planMs != null) params.push('date=' + encodeURIComponent(localIsoDateFromMs(planMs)));
        var sid = cut && cut.slitter && cut.slitter.id;
        if (sid != null && String(sid) !== '') params.push('slitter=' + encodeURIComponent(String(sid)));
        return params.length ? base + '?' + params.join('&') : base;
    }

    // #3887: защита Ганта от испорченных сохранённых planStart — та же беда, что в очереди (#3885).
    // Очередь («Планирование производства») и Гант рисуют ОДИН сохранённый план (t1078). Если у
    // двух резок одного станка в один день старт совпал/пересёкся (след незавершённой пересборки
    // времени старта: перенос до #3840 не трогал planStart, пересборка #3660 идёт лишь в scope
    // фильтра), их бары встают в одну точку оси → наложение. scheduleFromStored (#3886) уже лечит
    // это в очереди; здесь — то же для дорожки Ганта. Раскладываем встык: старт ОКНА бара
    // (наладка+резка) не раньше конца окна предыдущей резки ТОГО ЖЕ дня. День берём по
    // СОХРАНЁННОМУ старту (ось/заголовки/окна дней не уезжают). Двигаем только ПЛАНОВЫЕ бары (без
    // факт. старта): у начатых/завершённых бар показывает реальное время, его не трогаем — но их
    // окно всё равно отодвигает следующий ПЛАНОВЫЙ бар. Непересекающиеся сохранённые старты (в т.ч.
    // обеденный зазор) не трогаем — display == сохранённое (философия #3846). ordered — резки
    // станка в порядке дорожки (orderCutsInGroup). → массив старта бара (мс) по индексу, null где
    // у резки нет времени. Чистая — покрыта тестом.
    // #4099: РИСУЕМ КАК ЕСТЬ. Раньше перекрытые сохранённые старты разносились встык (#3887) —
    // это превращало переполненный сохранённый план в непрерывный цуг до глубокой ночи и ПРЯТАЛО
    // саму суть (день забит на 2+ смены), а фикс-метки обеда/уборки уезжали «в параллель». Заказчик
    // (#4099): «нефиг их сжимать и растягивать — рисуй как есть, хоть будет понятно в чём суть».
    // Возвращаем СОХРАНЁННЫЙ старт каждого бара БЕЗ сдвига: перекрытия видны как есть (у Ганта
    // каждая резка — своя строка, поэтому наложенные по времени бары не «слипаются», а честно
    // показывают, что на дне стоит больше работы, чем влезает в смену).
    function dedupeBarStarts(ordered) {
        return (ordered || []).map(function(cut) {
            var tr = cutTimeRange(cut);
            return tr ? tr.startMs : null;
        });
    }

    // #3668: размещение баров по РЕАЛЬНОМУ времени. Группировка по станку (сортировка по
    // метке), внутри станка — порядок строк по очерёдности/старту; каждое задание = отдельная
    // строка, бар на общей шкале времени окна (left/width по плану-факту, разрывы видны).
    // Фильтры: видимый период, станок, производный статус.
    function layoutGroups(cuts, range, nowMs, filters, opts) {
        var f = filters || {};
        var o = opts || {};
        var statusFilter = String(f.status == null ? '' : f.status).trim();
        var slitterFilter = String(f.slitter == null ? '' : f.slitter).trim();

        var visible = (cuts || []).filter(function(cut) {
            var s = cut && cut.slitter || { id: null, label: '' };
            var sid = s.id == null ? '' : String(s.id);
            if (slitterFilter && sid !== slitterFilter) return false;
            if (!cutInRange(cut, range)) return false;
            if (statusFilter && cutStatus(cut, nowMs).key !== statusFilter) return false;
            return true;
        });

        // #4229: окна простоя станков («Отпуск»), пересекающие период (с учётом фильтра станка).
        // downtimesBySlitter: sid → [{ id, startMs, endMs, notes }] (мс). Спаны (обрезанные по периоду)
        // отдаём в ось (workingSegments) — колонка дня отпуска держится даже без резок в этот день.
        var downtimesBySlitter = o.downtimesBySlitter || {};
        var slitterLabels = o.slitterLabels || {};
        var visibleDowntimes = {};   // sid → [dt…]
        var downtimeSpans = [];
        Object.keys(downtimesBySlitter).forEach(function(sid) {
            if (slitterFilter && String(sid) !== slitterFilter) return;
            (downtimesBySlitter[sid] || []).forEach(function(dt) {
                if (!downtimeInRange(dt, range)) return;
                (visibleDowntimes[sid] = visibleDowntimes[sid] || []).push(dt);
                var span = downtimeSpanClamped(dt, range);
                if (span) downtimeSpans.push(span);
            });
        });
        o.downtimeSpans = downtimeSpans;

        var win = ganttWindow(visible, range, o);
        // #4007 (ТЗ §5): суммарная длительность перерывов дня — буфер к правому краю окна дня,
        // чтобы сдвинутым за перерывы барам хватило места (перерывы не зашиты в сохранённые старты).
        var totalBreakMin = (o.breaks || []).reduce(function(s, b) {
            return s + (b && Number(b.durationMin) > 0 ? Number(b.durationMin) : 0);
        }, 0);
        // #4121: сквозной обед (его нет в сохранённых стартах) двигает бары дня наравне с
        // перерывами — его длительность тоже должна поместиться в окно дня.
        var lunchBufferMin = Number(o.lunchDurationMin) > 0 ? Number(o.lunchDurationMin) : 0;
        o.breakBufferMin = totalBreakMin + lunchBufferMin;
        // #3747: ось — только рабочие окна дней [08:00;18:30], нерабочее время (ночь) свёрнуто
        // (ganttScale.toPx). Бар, вышедший за смену, расширяет окно своего дня (workingSegments).
        var segments = workingSegments(visible, range, o);
        // #3704: масштаб по горизонтали = базовый (по режиму) × зум кнопок. Снизу ограничен «вписать
        // в экран»: дорожка не уже видимой области (fitTrackPx) — кнопка «−» не сжимает её мельче.
        var basePxPerMin = o.pxPerMin > 0 ? o.pxPerMin : pxPerMinForMode(range && range.mode);
        var zoom = Number(o.zoom) > 0 ? Number(o.zoom) : 1;
        var pxPerMin = basePxPerMin * zoom;
        var workMin = segments.reduce(function(sum, s) { return sum + (s.endMs - s.startMs) / 60000; }, 0);
        if (o.fitTrackPx > 0 && workMin > 0) {
            var fitPxPerMin = o.fitTrackPx / workMin;
            if (pxPerMin < fitPxPerMin) pxPerMin = fitPxPerMin;
        }
        var minPx = o.minPx > 0 ? o.minPx : GANTT_MIN_BAR_PX;
        var scale = ganttScale(segments, pxPerMin);
        var trackPx = scale.totalPx;

        var groupsMap = {};
        var orderKeys = [];
        visible.forEach(function(cut) {
            var s = cut && cut.slitter || { id: null, label: '' };
            var sid = s.id == null ? '' : String(s.id);
            var key = sid === '' ? ' none' : sid;
            if (!groupsMap[key]) {
                groupsMap[key] = { slitter: { id: sid === '' ? null : sid, label: s.label || (sid === '' ? 'Без станка' : '#' + sid) }, cuts: [] };
                orderKeys.push(key);
            }
            groupsMap[key].cuts.push(cut);
        });

        // #4229: станок с отпуском, но без резок в периоде, всё равно нужен своей строкой отпуска.
        Object.keys(visibleDowntimes).forEach(function(sid) {
            var key = sid === '' ? ' none' : sid;
            if (groupsMap[key]) return;
            groupsMap[key] = { slitter: { id: sid === '' ? null : sid, label: slitterLabels[sid] || ('#' + sid) }, cuts: [] };
            orderKeys.push(key);
        });

        var groups = orderKeys.map(function(k) { return groupsMap[k]; }).sort(function(a, b) {
            if (a.slitter.id == null) return 1;
            if (b.slitter.id == null) return -1;
            return String(a.slitter.label).localeCompare(String(b.slitter.label), 'ru');
        });

        groups.forEach(function(g) {
            orderCutsInGroup(g.cuts);
            var ordered = g.cuts;
            // #4099: старт бара = СОХРАНЁННЫЙ planStart как есть (dedupeBarStarts больше не разносит
            // встык) — резки между собой не двигаем и не переупорядочиваем. #4114 п.1: заказчик явно
            // исключил обед/перерывы из «рисуй как есть» — это реальный простой станка, поэтому все
            // задания дня ПОСЛЕ обеда/перерыва визуально сдвигаются на его длительность
            // (brk.shiftMinByIndex, накопительно по дню); сам порядок и относительные старты резок
            // друг относительно друга при этом не меняются.
            var barStarts = dedupeBarStarts(ordered);
            // #4121: обед считаем ДО баров — обед-фолбэк (не зашитый в planStart) сдвигает бары дня
            // наравне с перерывами, поэтому он должен попасть в shiftMinByIndex.
            var lunches = ganttLunchMarkers(ordered, scale, o.lunchDurationMin, o.lunchStartMin);
            var brk = ganttBreakMarkers(ordered, scale, o.breaks,
                { pxPerMin: pxPerMin, barStarts: barStarts, lunches: lunches });
            g.tasks = ordered.map(function(cut, i) {
                var tr = cutTimeRange(cut) || { startMs: win.startMs, endMs: win.startMs };
                var startMs = barStarts[i] != null ? barStarts[i] : tr.startMs;   // #4099: сохранённый старт как есть
                var status = cutStatus(cut, nowMs);
                // #3675 п.3 / #3680: ширина бара = наладка + резка; подпись времени — ВСЁ окно задания
                // (от начала наладки до конца резки), а не только резка.
                var seg = cutBarSegments(cut, pxPerMin, minPx);
                // #3747: левый край бара — по СВЁРНУТОЙ оси (scale.toPx): нерабочее время не занимает
                // места, дни идут встык. #4099: ширина — РЕАЛЬНАЯ (наладка+резка), без обрезки по
                // старту следующего бара: перекрытие с соседней резкой видно как есть (у каждой резки
                // своя строка, бары не «слипаются»), а не прячется урезанием ширины (бывший #3708).
                // #4114 п.1: shiftMin — сдвиг ОТ ПРЕДЫДУЩИХ обедов/перерывов этого дня (0, если их не
                // было или задание идёт раньше их всех); двигает и позицию бара, и подпись времени.
                var shiftMin = (brk.shiftMinByIndex && brk.shiftMinByIndex[i]) || 0;
                var leftPx = round3(scale.toPx(startMs) + shiftMin * pxPerMin);
                var widthPx = seg.totalPx;
                var labelStartMs = startMs + shiftMin * 60000;
                return {
                    cut: cut, status: status,
                    leftPx: leftPx,
                    widthPx: widthPx,
                    startMs: labelStartMs,   // #4099: старт бара = сохранённый (для подписи/накладок)
                    segments: seg,
                    label: cutRowLabel(cut), barText: cutBarTime(cut, seg.setupMin, null, labelStartMs),
                    barMin: cutBarSpanMin(cut, seg.setupMin, null, labelStartMs),   // #3770: минуты подписи бара
                    title: cutBarTitle(cut, tr, status)
                };
            });
            // #3770: суммарные минуты всех баров станка — для подписи «N (Σ мин)» в заголовке.
            g.tasksMin = g.tasks.reduce(function(sum, t) { return sum + (t.barMin || 0); }, 0);
            // #4110: обед (#3342) и перерывы (#4007) — серые накладки ПОВЕРХ баров; несущий их бар
            // РАСШИРЯЕМ на длительность накладки, а саму накладку кладём НА бар (заказчик #4110:
            // «фрагмент, на который они попали, расширять на их длительность», сейчас обед «как будто
            // пририсован в конце»). #4099 сняла растяжку целиком, и накладка снова висела в зазоре
            // после бара. Возвращаем ТОЛЬКО локальную растяжку несущего (без сдвига соседних баров и
            // без анти-нахлёста #3708/#3887, снятых в #4099): день не «разъезжается», перекрытия по-
            // прежнему видны как есть — просто обед/перерыв честно лежит на своём баре, а бар длиннее
            // на его время (работа под накладкой не прячется — хвост компенсирует закрытые серым мин).
            g.lunches = lunches;
            g.breaks = brk.markers;
            // Несущее задание накладки: обед с известным LUNCH_START и перерыв несут carrierIndex;
            // обед-зазор (LUNCH_START неизвестен) привязан к резке ПЕРЕД зазором (beforeIndex − 1).
            function overlayCarrierIndex(m, isLunch) {
                if (m.carrierIndex != null) return m.carrierIndex;
                return (isLunch && m.beforeIndex != null) ? m.beforeIndex - 1 : null;
            }
            var bandsByCarrier = {};
            (g.lunches || []).forEach(function(l) {
                var ci = overlayCarrierIndex(l, true);
                if (ci != null && g.tasks[ci]) (bandsByCarrier[ci] = bandsByCarrier[ci] || []).push(l);
            });
            (g.breaks || []).forEach(function(mk) {
                var ci = overlayCarrierIndex(mk, false);
                if (ci != null && g.tasks[ci]) (bandsByCarrier[ci] = bandsByCarrier[ci] || []).push(mk);
            });
            Object.keys(bandsByCarrier).forEach(function(key) {
                var idx = Number(key);
                var task = g.tasks[idx];
                if (!task) return;
                var bands = bandsByCarrier[key].slice().sort(function(a, b) { return a.startMs - b.startMs; });
                // Растягиваем несущий бар на длительность накладок и вставляем каждую по её реальному
                // времени. Соседние бары НЕ трогаем и по ним удлинение НЕ обрезаем: если несущий за счёт
                // обеда/перерыва «наезжает» на следующую резку — перекрытие видно как есть (у Ганта каждая
                // резка на своей строке; #4099). Обрезка по соседу вернула бы «висящий» хвост накладки
                // (когда зазор до соседа меньше её длительности) — ровно то, на что жалуется #4110.
                var tail = round3(task.leftPx + task.widthPx);   // правый край работы (растёт по мере вставки)
                var addedPx = 0;
                // #4121: несущий бар мог сам уехать вправо за более ранние обеды/перерывы дня —
                // накладку кладём в то же смещение, иначе она вылезает ЛЕВЕЕ своего бара.
                var carrierShiftMin = (brk.shiftMinByIndex && brk.shiftMinByIndex[idx]) || 0;
                bands.forEach(function(m) {
                    var durPx = Math.max(round3(m.durationMin * pxPerMin), 1);
                    // Позиция накладки = её РЕАЛЬНОЕ время, сдвинутое за ранее вставленные накладки; но не
                    // оставляем зазор перед хвостом бара — иначе накладка «висит в конце» (#4110).
                    var realLeft = round3(scale.toPx(m.startMs) + carrierShiftMin * pxPerMin + addedPx);
                    var drawLeft = Math.min(Math.max(realLeft, task.leftPx), tail);
                    m.leftPx = drawLeft;
                    m.widthPx = durPx;
                    tail = round3(tail + durPx);   // вставка накладки двигает всё правее неё на её ширину
                    addedPx = round3(addedPx + durPx);
                });
                if (tail > round3(task.leftPx + task.widthPx)) {
                    task.widthPx = round3(tail - task.leftPx);
                    // #4114 п.2: конец подписи — по РЕАЛЬНЫМ минутам (task.barMin — уже чистое окно
                    // наладка+резка, см. cutBarWindow — плюс настоящая длительность накладок), а НЕ
                    // по ширине в px. cutBarSegments округляет короткие сегменты наладки вверх до
                    // минимальной видимой ширины (floor 3px/8px — чтобы их было видно на глаз), из-за
                    // этого widthPx/pxPerMin давал на пару минут больше настоящей длительности
                    // (пример из #4114: 14:50 + 20 мин работы + 10 мин перерыва отображались как
                    // 15:23 вместо 15:20 — «пол» короткого сегмента наладки добавлял лишние минуты
                    // при обратной конвертации ширины в минуты).
                    var realAddedMin = bands.reduce(function(sum, b) { return sum + (Number(b.durationMin) || 0); }, 0);
                    var spanMin = (task.barMin || 0) + realAddedMin;
                    var endMs = task.startMs + spanMin * 60000;
                    task.barText = formatTime(task.startMs) + '-' + formatTime(endMs) + ' (' + task.barMin + ' мин)';
                }
            });
            // #4229: бары отпуска станка — серые, по СВЁРНУТОЙ оси (scale.toPx учитывает свёрнутую ночь),
            // с примечаниями (≤100 симв.). Ширина = разность toPx концов (не минуты×ppm — иначе ночь
            // раздувала бы бар); минимум 1px, чтобы короткий простой был виден.
            g.downtimes = (visibleDowntimes[g.slitter.id == null ? '' : String(g.slitter.id)] || []).map(function(dt) {
                var span = downtimeSpanClamped(dt, range);
                if (!span) return null;
                var leftPx = round3(scale.toPx(span.startMs));
                var widthPx = Math.max(round3(scale.toPx(span.endMs) - leftPx), 1);
                // #4238: подпись бара — ДИАПАЗОН времени простоя, затем Примечание (≤10 симв.);
                // пустое примечание не дописываем (в метке слева и так «Отпуск»). notesFull — полный
                // текст примечания для тултипа (в подписи он обрезан).
                var note = downtimeNotesText(dt.notes);   // ≤10, пусто → «Отпуск»
                var notesFull = String(dt.notes == null ? '' : dt.notes).trim();
                var barText = formatTime(span.startMs) + '-' + formatTime(span.endMs)
                    + (note && note !== 'Отпуск' ? ' ' + note : '');
                return { id: dt.id, notes: note, notesFull: notesFull, barText: barText,
                         leftPx: leftPx, widthPx: widthPx, startMs: span.startMs, endMs: span.endMs };
            }).filter(Boolean);
            delete g.cuts;
        });
        return { groups: groups, trackPx: trackPx, window: win, scale: scale, pxPerMin: pxPerMin };
    }

    // #4131: число заданий и сумма их минут (barMin, те же минуты, что в подписи бара) ПО КАЖДОМУ
    // дню оси — для бейджей в строке-заголовке станка. Задание относится к календарному дню своего
    // старта: по нему же workingSegments строит колонку дня. Дни без заданий станка пропускаем.
    // → [{ dayMs, leftPx, widthPx, count, min }] в порядке колонок. Чистая — покрыта тестом.
    function machineDayStats(tasks, scale) {
        if (!scale || !scale.segments || !scale.segments.length) return [];
        var byDay = {};
        (tasks || []).forEach(function(t) {
            if (!t || t.startMs == null) return;
            var key = startOfLocalDayMs(t.startMs);
            var acc = byDay[key] || (byDay[key] = { count: 0, min: 0 });
            acc.count++;
            acc.min += Number(t.barMin) || 0;
        });
        var out = [];
        scale.segments.forEach(function(seg) {
            var dayMs = startOfLocalDayMs(seg.startMs);
            var acc = byDay[dayMs];
            if (!acc) return;
            out.push({ dayMs: dayMs, leftPx: seg.leftPx, widthPx: seg.widthPx, count: acc.count, min: acc.min });
        });
        return out;
    }

    // #4131: оценка ширины подписи бейджа дня в px (см. GANTT_DAY_STAT_*).
    function dayStatTextPx(text) {
        return GANTT_DAY_STAT_PAD_PX + String(text).length * GANTT_DAY_STAT_CHAR_PX;
    }

    // #4131: подпись бейджа дня — самая полная из влезающих в колонку этого дня: «N (M мин)» →
    // «N» → пусто (минуты читаются в подсказке). Чистая — покрыта тестом.
    function machineDayStatText(stat) {
        if (!stat || !(stat.count > 0)) return '';
        var widthPx = Number(stat.widthPx) || 0;
        var full = String(stat.count) + (stat.min > 0 ? ' (' + stat.min + ' мин)' : '');
        if (dayStatTextPx(full) <= widthPx) return full;
        var count = String(stat.count);
        return dayStatTextPx(count) <= widthPx ? count : '';
    }

    function slittersFromCuts(cuts) {
        var seen = {};
        var out = [];
        (cuts || []).forEach(function(cut) {
            var s = cut && cut.slitter;
            if (!s || s.id == null || String(s.id) === '') return;
            var key = String(s.id);
            if (seen[key]) return;
            seen[key] = true;
            out.push({ id: key, label: s.label || ('#' + key) });
        });
        return out;
    }

    // Разбор deep-link параметров (?cut=..&date=..&slitter=..) из строки запроса.
    // Используется и планировщиком (приём фокуса), и тестами. Вход — location.search
    // или полный URL.
    function parseDeepLink(search) {
        var s = String(search == null ? '' : search);
        var qm = s.indexOf('?');
        if (qm >= 0) s = s.slice(qm + 1);
        // #3713: from/to — диапазон дат из «Планирования производства» (иконка Ганта у фильтра дат).
        var out = { cut: '', date: '', slitter: '', from: '', to: '' };
        s.split('&').forEach(function(pair) {
            if (!pair) return;
            var eq = pair.indexOf('=');
            var key = eq >= 0 ? pair.slice(0, eq) : pair;
            var val = eq >= 0 ? pair.slice(eq + 1) : '';
            try { val = decodeURIComponent(val.replace(/\+/g, ' ')); } catch (e) {}
            if (key === 'cut' || key === 'date' || key === 'slitter' || key === 'from' || key === 'to') out[key] = val;
        });
        return out;
    }

    var gantt = {
        GANTT_MODES: GANTT_MODES,
        STATUS_LABELS: STATUS_LABELS,
        normalizeMode: normalizeMode,
        parseDateTimeMs: parseDateTimeMs,
        formatTime: formatTime,             // #3747 (тест свёрнутой оси)
        localIsoDateFromMs: localIsoDateFromMs,
        shiftIsoDate: shiftIsoDate,
        ganttRange: ganttRange,
        ganttRangeFromTo: ganttRangeFromTo,   // #3713
        daySpanToMode: daySpanToMode,         // #3713
        shiftAnchor: shiftAnchor,
        cutStatus: cutStatus,
        cutTimeRange: cutTimeRange,
        cutInRange: cutInRange,
        downtimeInRange: downtimeInRange,           // #4229
        downtimeEndMs: downtimeEndMs,               // #4229
        downtimeSpanClamped: downtimeSpanClamped,   // #4229
        downtimeNotesText: downtimeNotesText,       // #4229
        mergeGroupRows: mergeGroupRows,             // #4238
        cutRowLabel: cutRowLabel,
        cutBarTime: cutBarTime,
        cutBarSpanMin: cutBarSpanMin,   // #3770
        cutSetupMin: cutSetupMin,
        cutBarMinutes: cutBarMinutes,   // #3700
        cutBarSegments: cutBarSegments,
        ganttCutLeaderRuns: ganttCutLeaderRuns,   // #3705
        ganttLeaderMin: ganttLeaderMin,           // #3705
        attachLeaderMinutes: attachLeaderMinutes, // #3705
        cutChangeoverMinutes: cutChangeoverMinutes,
        ganttPrevSetupFromRows: ganttPrevSetupFromRows,
        ganttPrevSetupBySlitter: ganttPrevSetupBySlitter,
        ganttCarryOverPrevCut: ganttCarryOverPrevCut,
        ganttFirstSetupKnifeMin: ganttFirstSetupKnifeMin,
        attachStrips: attachStrips,
        attachSetupMinutes: attachSetupMinutes,
        rowsToCuts: rowsToCuts,
        orderCutsInGroup: orderCutsInGroup,
        dedupeBarStarts: dedupeBarStarts,   // #3887
        layoutGroups: layoutGroups,
        machineDayStats: machineDayStats,       // #4131
        machineDayStatText: machineDayStatText, // #4131
        ganttWindow: ganttWindow,
        ganttTrackPx: ganttTrackPx,
        cutBarEndMs: cutBarEndMs,           // #3747
        ganttLunchMarkers: ganttLunchMarkers,   // #3846: маркеры обеда из зазоров расписания
        ganttBreakMarkers: ganttBreakMarkers,   // #4007 (ТЗ §5): маркеры коротких перерывов + сдвиг баров
        workingSegments: workingSegments,   // #3747
        ganttScale: ganttScale,             // #3747
        chooseHourStep: chooseHourStep,
        hourTicks: hourTicks,
        pxPerMinForMode: pxPerMinForMode,
        planningLink: planningLink,
        slittersFromCuts: slittersFromCuts,
        parseDeepLink: parseDeepLink,
        formatCutNumber: formatCutNumber,
        todayISO: todayISO,
        refLabel: refLabel,                 // #3875
        parseDmyKey: parseDmyKey,           // #3875/#3788
        dayKeyFromMs: dayKeyFromMs,         // #3875/#3788
        dayTypeWorking: dayTypeWorking,     // #3875/#3788
        dayIsWorking: dayIsWorking          // #3875/#3788
    };

    // ───────────────────────── DOM-хелпер ─────────────────────────

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

    // ───────────────────────── Контроллер ─────────────────────────

    function AtexCutGantt(root) {
        this.root = root;
        this.db = (typeof window !== 'undefined' && window.db) || root.getAttribute('data-db') || '';
        this.slitterTable = root.getAttribute('data-slitter-table') || '1070';
        this.planningUrl = root.getAttribute('data-planning-url') || planningBaseFromLocation();
        this.busy = false;
        this.cuts = [];
        this.slitters = [];
        this.slitterLabels = {};          // #4229: sid → метка станка (строки отпуска без резок)
        this.downtimesBySlitter = {};     // #4229: sid → [{ id, startMs, endMs, notes }] окна простоя («Отпуск»)
        // #3875/#3788: карта нерабочих дней ГГГГММДД → 'Праздничный день'|'Рабочий день'.
        // Фича подсветки выходных включается наличием таблицы «Календарь» (calendarEnabled).
        this.calendarByDay = {};
        this.calendarEnabled = false;
        // #3683: дефолт — «День»; #3704: зум по горизонтали; #3713: fromIso/toIso — произвольный
        // диапазон из deep-link «Планирования» (если задан, период берётся из него, а не из mode).
        this.state = { mode: 'day', anchor: todayISO(), slitter: '', status: '', zoom: 1, fromIso: '', toIso: '' };
    }

    // #3704: шаг/границы зума горизонтального масштаба (множитель к px/мин режима).
    var GANTT_ZOOM_STEP = 1.5;
    var GANTT_ZOOM_MIN = 0.25;
    var GANTT_ZOOM_MAX = 16;

    AtexCutGantt.prototype.url = function(path) {
        return '/' + encodeURIComponent(this.db) + '/' + path;
    };

    AtexCutGantt.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                try { return JSON.parse(text); }
                catch (e) { throw new Error('Некорректный JSON: ' + text.slice(0, 200)); }
            });
        });
    };

    AtexCutGantt.prototype.nowMs = function() { return Date.now(); };

    AtexCutGantt.prototype.loadSlitters = function() {
        return this.getJson('object/' + encodeURIComponent(this.slitterTable) + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            return (rows || []).map(function(r) {
                return { id: String(r.i), label: (r.r && r.r[0]) || ('#' + r.i) };
            });
        }).catch(function() { return []; });
    };

    // #3675 п.3: раскладка ножей резок отчётом cut_strips (для расчёта смены ножей). Ошибка/нет
    // отчёта → пусто (наладка ножей деградирует до «сужение ролика», смена сырья считается всегда).
    AtexCutGantt.prototype.loadStrips = function() {
        return this.getJson('report/cut_strips?JSON_KV&LIMIT=0,20000').catch(function() { return []; });
    };

    // #3693: текущая заправка станков из отчёта prev_cut_setup (как у планировщика, #3688) — для
    // наладки ПЕРВОЙ резки станка. Ошибка/нет доступа → пусто (деградация к настройке ножей с нуля).
    AtexCutGantt.prototype.loadPrevCutSetup = function() {
        return this.getJson('report/prev_cut_setup?JSON_KV&LIMIT=0,5000').catch(function() { return []; });
    };

    // #3675 п.3: op-времена наладки из таблицы «Время операции, мин» (как у планировщика). Код
    // операции ищем по виду UPPER_SNAKE среди колонок (без метаданных), минуты — главное значение.
    // Ошибка/нет таблицы → дефолты GANTT_OP_TIMES (смена сырья 15, ножи 30).
    AtexCutGantt.prototype.loadOpTimes = function() {
        return this.getJson('object/' + encodeURIComponent('Время операции, мин') + '/?JSON_OBJ&LIMIT=0,200')
            .then(function(rows) {
                var raw = {};
                (rows || []).forEach(function(rec) {
                    var r = (rec && rec.r) || [];
                    var code = '';
                    for (var i = 0; i < r.length; i++) {
                        var v = String(r[i] == null ? '' : r[i]).trim();
                        if (/^[A-Z][A-Z0-9_]+$/.test(v)) { code = v; break; }
                    }
                    if (code) raw[code] = Number(r[0]) || 0;   // r[0] — главное значение = минуты
                });
                return {
                    MATERIAL_WINDING: raw.MATERIAL_WINDING != null ? raw.MATERIAL_WINDING : GANTT_OP_TIMES.MATERIAL_WINDING,
                    KNIFE: Math.max(Number(raw.KNIFE_220_59) || 0, Number(raw.KNIFE_LE_59) || 0) || GANTT_OP_TIMES.KNIFE,
                    BETWEEN_CUTS: raw.BETWEEN_CUTS != null ? raw.BETWEEN_CUTS : GANTT_OP_TIMES.BETWEEN_CUTS   // #3705: лидер «между резками»
                };
            })
            .catch(function() { return Object.assign({}, GANTT_OP_TIMES); });
    };

    // #3846: длительность обеда (LUNCH_DURATION, мин) из таблицы «Настройка» — тот же источник,
    // что и у «Планирования производства» (#3342), чтобы оба РМ одинаково опознавали обеденный
    // зазор. Берём значение с учётом области видимости (БД-скоуп: db-тип > ATEH > общий). Ошибка/
    // нет таблицы/нет ключа → 0 (маркеры обеда не рисуются — деградация без поломки Ганта).
    AtexCutGantt.prototype.loadLunchSettings = function() {
        var self = this;
        return this.getJson('object/' + encodeURIComponent('Настройка') + '/?JSON_OBJ&LIMIT=0,1000')
            .then(function(rows) {
                var dbKey = String(self.db || '').trim().toUpperCase();
                // #3846/#3904: \u043E\u0431\u0430 \u043A\u043B\u044E\u0447\u0430 \u0438\u0437 \u00AB\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438\u00BB \u0441 \u0443\u0447\u0451\u0442\u043E\u043C \u043E\u0431\u043B\u0430\u0441\u0442\u0438 \u0432\u0438\u0434\u0438\u043C\u043E\u0441\u0442\u0438 (db-\u0442\u0438\u043F > ATEH > \u043E\u0431\u0449\u0438\u0439).
                // #4007 (\u0422\u0417 \u00A75): \u043F\u043E\u043C\u0438\u043C\u043E \u043E\u0431\u0435\u0434\u0430 \u0447\u0438\u0442\u0430\u0435\u043C \u0434\u0432\u0430 \u043A\u043E\u0440\u043E\u0442\u043A\u0438\u0445 \u043F\u0435\u0440\u0435\u0440\u044B\u0432\u0430 (FIRST_INTERVAL/
                // SECCOND_INTERVAL, \u0432\u0440\u0435\u043C\u044F \u00AB\u0427\u0427:\u041C\u041C\u00BB) \u0438 \u0438\u0445 \u0434\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C (INTERVAL_DURATION_MN, \u043E\u0442\u043A\u0430\u0442
                // \u043D\u0430 INTERVAL_DURATION). \u041A\u043B\u044E\u0447 SECCOND_INTERVAL \u2014 \u043A\u0430\u043A \u0432 \u0422\u0417 (\u0441 \u043E\u043F\u0435\u0447\u0430\u0442\u043A\u043E\u0439), \u043F\u0440\u0438\u043D\u0438\u043C\u0430\u0435\u043C
                // \u0438 \u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u043E\u0435 SECOND_INTERVAL. \u041E\u0431\u043B\u0430\u0441\u0442\u044C \u0432\u0438\u0434\u0438\u043C\u043E\u0441\u0442\u0438 \u2014 \u043A\u0430\u043A \u0443 \u043E\u0431\u0435\u0434\u0430 (db-\u0442\u0438\u043F > ATEH > \u043E\u0431\u0449\u0438\u0439).
                var KEYS = ['LUNCH_DURATION', 'LUNCH_START', 'FIRST_INTERVAL', 'SECCOND_INTERVAL',
                            'SECOND_INTERVAL', 'INTERVAL_DURATION', 'INTERVAL_DURATION_MN'];
                var bestRank = {}, bestVal = {};
                KEYS.forEach(function(k) { bestRank[k] = -1; bestVal[k] = null; });
                (rows || []).forEach(function(rec) {
                    var r = (rec && rec.r) || [];
                    var key = String(r[0] == null ? '' : r[0]).replace(/^\uFEFF/, '').trim();
                    if (bestRank[key] === undefined) return;
                    var type = String(r[1] == null ? '' : r[1]).trim().toUpperCase();
                    var val = String(r[2] == null ? '' : r[2]).replace(',', '.').trim();
                    if (val === '') return;
                    var rank = 1;
                    if (dbKey && type === dbKey) rank = 3;
                    else if (type === 'ATEH') rank = 2;
                    if (rank >= bestRank[key]) { bestRank[key] = rank; bestVal[key] = val; }
                });
                var n = bestVal.LUNCH_DURATION == null ? 0 : Number(bestVal.LUNCH_DURATION);
                // #4007: \u0434\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C \u043F\u0435\u0440\u0435\u0440\u044B\u0432\u0430 \u2014 INTERVAL_DURATION_MN, \u0438\u043D\u0430\u0447\u0435 INTERVAL_DURATION, \u0438\u043D\u0430\u0447\u0435 10.
                var intervalDur = bestVal.INTERVAL_DURATION_MN != null ? Number(bestVal.INTERVAL_DURATION_MN)
                    : (bestVal.INTERVAL_DURATION != null ? Number(bestVal.INTERVAL_DURATION) : 10);
                if (!(isFinite(intervalDur) && intervalDur > 0)) intervalDur = 10;
                var breaks = [];
                var secondRaw = bestVal.SECCOND_INTERVAL != null ? bestVal.SECCOND_INTERVAL : bestVal.SECOND_INTERVAL;
                [bestVal.FIRST_INTERVAL, secondRaw].forEach(function(raw) {
                    var startMin = parseLunchStartMinutes(raw);   // \u00AB10:00\u00BB \u2192 600; \u0438\u043D\u0430\u0447\u0435 NaN \u2192 \u043F\u0435\u0440\u0435\u0440\u044B\u0432\u0430 \u043D\u0435\u0442
                    if (isFinite(startMin)) breaks.push({ startMin: startMin, durationMin: Math.round(intervalDur), label: '\u041F\u0435\u0440\u0435\u0440\u044B\u0432' });
                });
                breaks.sort(function(a, b) { return a.startMin - b.startMin; });
                return {
                    durationMin: isFinite(n) && n > 0 ? Math.round(n) : 0,
                    startMin: parseLunchStartMinutes(bestVal.LUNCH_START),   // #3904: \u00AB12:20\u00BB \u2192 740; \u043F\u0443\u0441\u0442\u043E \u2192 NaN
                    breaks: breaks   // #4007 (\u0422\u0417 \u00A75): \u043A\u043E\u0440\u043E\u0442\u043A\u0438\u0435 \u043F\u0435\u0440\u0435\u0440\u044B\u0432\u044B \u0434\u043B\u044F \u043E\u0442\u0440\u0438\u0441\u043E\u0432\u043A\u0438 \u043D\u0430 \u0413\u0430\u043D\u0442\u0435
                };
            })
            .catch(function() { return { durationMin: 0, startMin: NaN, breaks: [] }; });
    };

    // #3875: «Календарь» (#3788) — нерабочие дни (выходные/праздники). Читаем таблицу по имени
    // (главное значение — дата ДД.ММ.ГГГГ, реквизит «Тип дня» — ссылка). Таблицы нет в базе
    // (старое окружение) или ошибка чтения → фича выключена, разметка нерабочих дней не рисуется.
    AtexCutGantt.prototype.loadCalendar = function() {
        var self = this;
        this.calendarByDay = {};
        this.calendarEnabled = false;
        return this.getJson('object/' + encodeURIComponent('Календарь') + '/?JSON_OBJ&LIMIT=0,2000')
            .then(function(rows) {
                self.calendarEnabled = true;
                (rows || []).forEach(function(rec) {
                    var r = rec.r || [];
                    var key = parseDmyKey(r[0]);
                    if (key == null) return;
                    var typeLabel = refLabel(r[1]);   // «Тип дня» — единственный реквизит таблицы
                    if (typeLabel) self.calendarByDay[key] = typeLabel;
                });
            })
            .catch(function() { self.calendarByDay = {}; self.calendarEnabled = false; });
    };

    // #3875: рабочий ли день (по мс). Фича выключена (нет «Календаря») → всегда рабочий, чтобы
    // подсветка выходных не появлялась в старом окружении (как в Планировании, #3788).
    AtexCutGantt.prototype.dayIsWorking = function(ms) {
        if (!this.calendarEnabled) return true;
        return dayIsWorking(ms, this.calendarByDay);
    };

    // #3875: все ли дни выбранного интервала нерабочие (выходные/праздники). true — на пустом
    // интервале показываем «Выходной день»; смешанный интервал (есть рабочие дни) → false.
    // Без «Календаря» dayIsWorking всегда true → всегда false (строка не появляется).
    AtexCutGantt.prototype._rangeAllDaysOff = function(range) {
        var self = this;
        var days = (range && range.days) || [];
        if (!days.length) return false;
        return days.every(function(d) {
            var ms = parseDateTimeMs(d.iso);
            return ms != null && !self.dayIsWorking(ms);
        });
    };

    // #4229: окна простоя станков («Отпуск», подчинённая станку таблица #3764) — для серых строк
    // отпуска на Ганте. Таблица читается по метаданным (id + индексы «Окончание»/«Примечания»), затем
    // по каждому станку (F_U=slitterId, как в «Планировании», #3764). Метаданных/таблицы нет или ошибка
    // чтения → карта пустая, строки отпуска не рисуются (деградация без поломки Ганта — как «Календарь»).
    AtexCutGantt.prototype.loadDowntimes = function() {
        var self = this;
        this.downtimesBySlitter = {};
        var slitters = this.slitters || [];
        if (!slitters.length) return Promise.resolve();
        return this.getJson('metadata').then(function(all) {
            var meta = ganttTableByName(Array.isArray(all) ? all : [all], 'Отпуск');
            if (!meta) return;   // таблицы нет (старое окружение) → фича выключена
            var endIdx = ganttColumnIndex(meta, 'Окончание');
            var notesIdx = ganttColumnIndex(meta, 'Примечания');
            return Promise.all(slitters.map(function(s) {
                return self.getJson('object/' + encodeURIComponent(meta.id) + '/?JSON_OBJ&F_U=' + encodeURIComponent(s.id) + '&LIMIT=0,500')
                    .then(function(rows) {
                        var out = [];
                        (rows || []).forEach(function(rec) {
                            var r = (rec && rec.r) || [];
                            var startSec = (r[0] == null || r[0] === '') ? null : Number(r[0]);
                            if (startSec == null || !isFinite(startSec)) return;   // без начала — пропуск
                            var endSec = (endIdx >= 0 && r[endIdx] != null && r[endIdx] !== '') ? Number(r[endIdx]) : null;
                            out.push({
                                id: String(rec.i),
                                startMs: startSec * 1000,   // #3764: unix-сек → мс (Гант работает в мс)
                                endMs: (endSec != null && isFinite(endSec)) ? endSec * 1000 : null,
                                notes: (notesIdx >= 0 && r[notesIdx] != null) ? String(r[notesIdx]) : ''
                            });
                        });
                        self.downtimesBySlitter[String(s.id)] = out;
                    })
                    .catch(function() { self.downtimesBySlitter[String(s.id)] = []; });
            }));
        }).catch(function() { self.downtimesBySlitter = {}; });
    };

    AtexCutGantt.prototype.collect = function() {
        var self = this;
        return Promise.all([
            this.getJson('report/cut_planning?JSON_KV&LIMIT=0,5000'),
            this.loadSlitters(),
            this.loadStrips(),
            this.loadOpTimes(),
            this.loadPrevCutSetup(),   // #3693: текущая заправка станков для наладки первой резки
            this.loadLunchSettings(),  // #3846: длительность обеда для маркеров обеда
            this.loadCalendar()        // #3875: «Календарь» (#3788) — нерабочие дни для подсветки
        ]).then(function(res) {
            var lunchCfg = res[5] || {};   // #3846/#3904/#4007: { durationMin, startMin, breaks } из «Настройки»
            self.lunchDurationMin = lunchCfg.durationMin || 0;   // #3846: LUNCH_DURATION (мин), 0 = обед выключен
            self.lunchStartMin = lunchCfg.startMin;              // #3904: LUNCH_START (мин), NaN = неизвестно
            self.breaks = lunchCfg.breaks || [];                 // #4007 (ТЗ §5): короткие перерывы для Ганта
            self.cuts = rowsToCuts(res[0] || []);
            // #3675 п.3: раскладка ножей + минуты наладки по переналадке с предыдущей резкой станка.
            attachStrips(self.cuts, res[2] || []);
            self.opTimes = res[3] || GANTT_OP_TIMES;
            // #3693: первая резка станка — наладка от его текущей заправки (prev_cut_setup).
            self.prevSetupBySlitter = ganttPrevSetupBySlitter(res[4] || []);
            attachSetupMinutes(self.cuts, self.opTimes, self.prevSetupBySlitter);
            // #3705: лидер «между резками» — фолбэк для cutBarMinutes, когда нет cut_time в отчёте.
            attachLeaderMinutes(self.cuts, self.opTimes);
            var merged = {};
            var ordered = [];
            (res[1] || []).concat(slittersFromCuts(self.cuts)).forEach(function(s) {
                if (!s || s.id == null) return;
                var key = String(s.id);
                if (merged[key]) return;
                merged[key] = { id: key, label: s.label || ('#' + key) };
                ordered.push(merged[key]);
            });
            self.slitters = ordered;
            self.slitterLabels = {};   // #4229: sid → метка станка для строк отпуска без резок
            ordered.forEach(function(s) { self.slitterLabels[String(s.id)] = s.label; });
            return self.loadDowntimes();   // #4229: окна простоя («Отпуск») — после станков (нужны их id)
        });
    };

    // ── Рендеринг ──

    AtexCutGantt.prototype.render = function() {
        var self = this;
        var st = this.state;
        st.mode = normalizeMode(st.mode);
        // #3713: задан произвольный диапазон (deep-link из «Планирования») → период по нему;
        // иначе обычный режим день/3 дня/неделя/месяц от якоря.
        var range = st.fromIso
            ? ganttRangeFromTo(st.fromIso, st.toIso || st.fromIso)
            : ganttRange(st.anchor || todayISO(), st.mode);
        if (!st.anchor) st.anchor = range.startIso;
        var nowMs = this.nowMs();

        this.root.innerHTML = '';
        this.root.appendChild(this._buildToolbar(range));
        this.root.appendChild(this._buildLegend());

        var scroll = el('div', { class: 'atex-cg-scroll' });
        scroll.appendChild(this._buildBody(range, nowMs));
        this.root.appendChild(scroll);
    };

    AtexCutGantt.prototype._buildToolbar = function(range) {
        var self = this;
        var st = this.state;

        // #3713: при произвольном диапазоне (deep-link) ‹/› двигают весь диапазон на его длину;
        // в обычном режиме — на период. Выбор режима/даты сбрасывает диапазон в режим от якоря.
        function shiftPeriod(dir) {
            if (st.fromIso) {
                var span = rangeDaySpan(st.fromIso, st.toIso || st.fromIso);
                st.fromIso = shiftIsoDate(st.fromIso, dir * span);
                st.toIso = shiftIsoDate(st.toIso || st.fromIso, dir * span);
            } else {
                st.anchor = shiftAnchor(st.anchor || range.startIso, st.mode, dir);
            }
            self.render();
        }
        var prevBtn = el('button', { class: 'atex-cg-arrow', type: 'button', text: '‹', title: 'Предыдущий период' });
        var nextBtn = el('button', { class: 'atex-cg-arrow', type: 'button', text: '›', title: 'Следующий период' });
        prevBtn.addEventListener('click', function() { shiftPeriod(-1); });
        nextBtn.addEventListener('click', function() { shiftPeriod(1); });

        var activeMode = st.fromIso ? range.mode : st.mode;   // #3713: при диапазоне подсвечиваем подходящий режим
        var modeWrap = el('div', { class: 'atex-cg-modes', role: 'group', 'aria-label': 'Период' });
        GANTT_MODES.forEach(function(m) {
            var btn = el('button', { class: 'atex-cg-mode' + (m.id === activeMode ? ' is-active' : ''), type: 'button', text: m.label, title: m.label });
            btn.addEventListener('click', function() {
                if (st.fromIso) { st.anchor = range.startIso; st.fromIso = ''; st.toIso = ''; }   // #3713: выход из диапазона
                st.mode = m.id;
                self.render();
            });
            modeWrap.appendChild(btn);
        });

        var dateInput = el('input', { class: 'atex-cg-input atex-cg-date', type: 'date', value: st.fromIso || st.anchor || range.startIso, title: 'Дата периода' });
        dateInput.addEventListener('change', function() {
            if (dateInput.value) { st.anchor = dateInput.value; st.fromIso = ''; st.toIso = ''; self.render(); }   // #3713: дата → выход из диапазона
        });

        var slitterSelect = el('select', { class: 'atex-cg-input atex-cg-slitter', title: 'Станок' });
        slitterSelect.appendChild(el('option', { value: '', text: 'Все станки' }));
        this.slitters.forEach(function(s) {
            var opt = el('option', { value: s.id, text: s.label });
            if (String(st.slitter) === String(s.id)) opt.setAttribute('selected', 'selected');
            slitterSelect.appendChild(opt);
        });
        slitterSelect.value = st.slitter || '';
        slitterSelect.addEventListener('change', function() { st.slitter = slitterSelect.value || ''; self.render(); });

        var statusSelect = el('select', { class: 'atex-cg-input atex-cg-status', title: 'Статус' });
        statusSelect.appendChild(el('option', { value: '', text: 'Все статусы' }));
        ['planned', 'running', 'unfinished', 'on-time', 'late', 'late-start', 'done'].forEach(function(key) {
            var opt = el('option', { value: key, text: STATUS_LABELS[key] });
            if (st.status === key) opt.setAttribute('selected', 'selected');
            statusSelect.appendChild(opt);
        });
        statusSelect.value = st.status || '';
        statusSelect.addEventListener('change', function() { st.status = statusSelect.value || ''; self.render(); });

        // #3704: масштаб по горизонтали — «−» сжимает (но не уже экрана), «+» растягивает; средняя
        // кнопка показывает текущий зум и сбрасывает его в 100%.
        var zoom = Number(st.zoom) > 0 ? Number(st.zoom) : 1;
        var zoomOutBtn = el('button', { class: 'atex-cg-arrow', type: 'button', text: '−', title: 'Уменьшить масштаб (не уже экрана)' });
        var zoomResetBtn = el('button', { class: 'atex-cg-btn atex-cg-zoom-reset', type: 'button', text: Math.round(zoom * 100) + '%', title: 'Сбросить масштаб' });
        var zoomInBtn = el('button', { class: 'atex-cg-arrow', type: 'button', text: '+', title: 'Увеличить масштаб' });
        zoomOutBtn.addEventListener('click', function() { self.setZoom((Number(st.zoom) || 1) / GANTT_ZOOM_STEP); });
        zoomResetBtn.addEventListener('click', function() { self.setZoom(1); });
        zoomInBtn.addEventListener('click', function() { self.setZoom((Number(st.zoom) || 1) * GANTT_ZOOM_STEP); });
        var zoomWrap = el('div', { class: 'atex-cg-zoom', role: 'group', 'aria-label': 'Масштаб по горизонтали' }, [zoomOutBtn, zoomResetBtn, zoomInBtn]);

        var todayBtn = el('button', { class: 'atex-cg-btn', type: 'button', text: 'Сегодня', title: 'Перейти к текущей дате' });
        todayBtn.addEventListener('click', function() { st.anchor = todayISO(); st.fromIso = ''; st.toIso = ''; self.render(); });   // #3713: выход из диапазона
        var refreshBtn = el('button', { class: 'atex-cg-btn', type: 'button', text: 'Обновить', title: 'Перечитать данные' });
        refreshBtn.addEventListener('click', function() { self.refresh(); });

        return el('div', { class: 'atex-cg-toolbar' }, [
            el('div', { class: 'atex-cg-title', text: 'Диаграмма Ганта — задания в производство' }),
            el('div', { class: 'atex-cg-period' }, [prevBtn, el('span', { class: 'atex-cg-range', text: range.label }), nextBtn]),
            modeWrap,
            zoomWrap,
            el('div', { class: 'atex-cg-tools' }, [dateInput, slitterSelect, statusSelect, todayBtn, refreshBtn])
        ]);
    };

    AtexCutGantt.prototype._buildLegend = function() {
        return el('div', { class: 'atex-cg-legend' }, [
            el('span', { class: 'atex-cg-legend-item is-planned', text: STATUS_LABELS.planned }),
            el('span', { class: 'atex-cg-legend-item is-running', text: STATUS_LABELS.running }),
            el('span', { class: 'atex-cg-legend-item is-unfinished', text: STATUS_LABELS.unfinished }),
            el('span', { class: 'atex-cg-legend-item is-on-time', text: STATUS_LABELS['on-time'] }),
            el('span', { class: 'atex-cg-legend-item is-late', text: STATUS_LABELS.late }),
            // #4052: обед и перерывы — единый серый пункт легенды (рисуются накладками поверх баров).
            el('span', { class: 'atex-cg-legend-item is-break', text: 'Обед / перерыв' }),
            // #4229: отпуск станка — серый бар отдельной строкой.
            el('span', { class: 'atex-cg-legend-item is-downtime', text: 'Отпуск' })
        ]);
    };

    AtexCutGantt.prototype._buildBody = function(range, nowMs) {
        var self = this;
        var st = this.state;
        // #3668: задания размещаются по реальному времени на общей шкале окна.
        // #3704: зум по горизонтали + нижняя граница «вписать в экран» (дорожка не уже видимой области).
        var data = layoutGroups(this.cuts, range, nowMs, { status: st.status, slitter: st.slitter },
            { zoom: st.zoom, fitTrackPx: this._fitTrackPx(), lunchDurationMin: this.lunchDurationMin,
              lunchStartMin: this.lunchStartMin,   // #3904: время обеда — чтобы утренний зазор не помечался обедом
              breaks: this.breaks,   // #4007 (ТЗ §5): короткие перерывы 10:00/15:00 — рисуются на Ганте
              downtimesBySlitter: this.downtimesBySlitter,   // #4229: окна простоя («Отпуск») — серой строкой
              slitterLabels: this.slitterLabels });          // #4229: метки станков для строк отпуска без резок

        var body = el('div', { class: 'atex-cg-body' });
        if (!data.groups.length) {
            var emptyBox = el('div', { class: 'atex-cg-empty' });
            // #3875: если выбранный интервал — целиком нерабочие дни (выходные/праздники по
            // «Календарю»), пишем красным «Выходной день» перед сообщением о пустом интервале
            // (как пустая нерабочая дата в «Планировании», #3788). Гейтинг — через dayIsWorking
            // (без «Календаря» все дни «рабочие», строка не появляется).
            if (this._rangeAllDaysOff(range)) {
                emptyBox.appendChild(el('div', { class: 'atex-cg-dayoff-note', text: 'Выходной день' }));
            }
            emptyBox.appendChild(el('div', { text: 'На выбранном интервале заданий нет' }));
            body.appendChild(emptyBox);
            return body;
        }
        var trackPx = data.trackPx;
        var dayColumns = ((data.scale && data.scale.segments) || []).length;   // #4131
        body.style.minWidth = 'calc(var(--cg-label-w) + ' + trackPx + 'px)';

        // #3668 п.6: часовые деления одинаковым пунктиром, шаг подобран по плотности окна.
        var ticks = hourTicks(data.scale, data.pxPerMin);   // #3747: деления по свёрнутой оси (рабочие окна)

        // #3875: нерабочие дни (выходные/праздники по «Календарю» #3788) подсвечиваем полосой за
        // колонкой дня. На свёрнутой оси видны только дни с заданиями, поэтому полоса появляется
        // лишь когда на нерабочий день всё же попали задания («заданий быть не должно») — как
        // красная дата в «Планировании» (#3788). Каждый сегмент оси = рабочее окно одного дня.
        var dayoffBands = [];
        if (this.calendarEnabled) {
            ((data.scale && data.scale.segments) || []).forEach(function(seg) {
                if (!self.dayIsWorking(seg.startMs)) dayoffBands.push({ leftPx: seg.leftPx, widthPx: seg.widthPx });
            });
        }
        function appendDayoffBands(track) {
            dayoffBands.forEach(function(b) {
                var band = el('span', { class: 'atex-cg-dayoff-band' });
                band.style.left = b.leftPx + 'px';
                band.style.width = b.widthPx + 'px';
                track.appendChild(band);   // первым в треке → позади часовой сетки и баров
            });
        }
        function appendHours(track) {
            appendDayoffBands(track);
            ticks.forEach(function(t) {
                // #3747: на стыке дней (newDay) — сплошная линия-разделитель: ночь свёрнута,
                // дни идут встык, поэтому границу смены выделяем отдельно от часовой сетки.
                var node = el('span', { class: 'atex-cg-hour' + (t.newDay ? ' is-day' : '') });
                node.style.left = t.leftPx + 'px';
                track.appendChild(node);
            });
        }

        // #4052: обед/перерыв — серая накладка ПОВЕРХ несущего бара (отдельных строк больше нет).
        // Без текста; title = подпись + диапазон времени, напр. «Обед 12:20-13:00». m — маркер из
        // ganttLunchMarkers/ganttBreakMarkers (leftPx/widthPx/startMs/endMs); label — «Обед»/«Перерыв».
        function buildOverlayBand(m, label) {
            var title = label + ' ' + formatTime(m.startMs) + '-' + formatTime(m.endMs);
            var band = el('div', { class: 'atex-cg-brk', title: title });
            band.style.left = m.leftPx + 'px';
            band.style.width = m.widthPx + 'px';
            return band;
        }

        // Верхняя шкала времени: метки «HH:00», на первом тике суток — дата.
        var scaleRow = el('div', { class: 'atex-cg-row atex-cg-scale-row' });
        scaleRow.appendChild(el('div', { class: 'atex-cg-label atex-cg-label--scale', text: 'Время' }));
        var scaleTrack = el('div', { class: 'atex-cg-track atex-cg-scale' });
        scaleTrack.style.minWidth = trackPx + 'px';
        appendDayoffBands(scaleTrack);   // #3875: полоса нерабочего дня и под шапкой оси
        ticks.forEach(function(t) {
            // #3875: дату нерабочего дня (выходной/праздник с заданиями) помечаем красным.
            var dayoff = t.newDay && self.dayIsWorking && !self.dayIsWorking(t.ms);
            var lbl = el('span', { class: 'atex-cg-hour-label' + (t.newDay ? ' is-day' : '') + (dayoff ? ' is-dayoff' : '') });
            lbl.style.left = t.leftPx + 'px';
            if (t.dateLabel) lbl.appendChild(el('span', { class: 'atex-cg-hour-date', text: t.dateLabel }));
            lbl.appendChild(el('span', { class: 'atex-cg-hour-time', text: t.label }));
            scaleTrack.appendChild(lbl);
        });
        scaleRow.appendChild(scaleTrack);
        body.appendChild(scaleRow);

        data.groups.forEach(function(group) {
            // #3668 п.3/п.5: заголовок станка — строка-грид; первая ячейка (имя + число
            // заданий нежирным) фиксируется при горизонтальном скролле.
            // #3770: число заданий + сумма минут всех баров станка, например «6 (262 мин)».
            var countText = String(group.tasks.length)
                + (group.tasksMin > 0 ? ' (' + group.tasksMin + ' мин)' : '');
            var nameCell = el('div', { class: 'atex-cg-label atex-cg-machine-cell' }, [
                el('span', { class: 'atex-cg-machine-name', text: group.slitter.label }),
                el('span', { class: 'atex-cg-machine-count', text: countText })
            ]);
            var headTrack = el('div', { class: 'atex-cg-track atex-cg-machine-track' });
            headTrack.style.minWidth = trackPx + 'px';
            // #4131: в той же строке — число заданий и сумма минут КАЖДОГО дня, над его колонкой оси
            // (первая ячейка даёт только итог по всем дням). На одном дне бейдж повторял бы итог —
            // рисуем, лишь когда дней на оси больше одного.
            if (dayColumns > 1) {
                machineDayStats(group.tasks, data.scale).forEach(function(s) {
                    var title = formatDateShort(s.dayMs) + ' · заданий: ' + s.count + ' · ' + s.min + ' мин';
                    // Левая граница бейджа = граница дня; у бейджа на самом левом краю дорожки её
                    // рисует рамка закреплённой ячейки-метки (is-track-start снимает удвоение).
                    var badge = el('span', {
                        class: 'atex-cg-machine-day' + (s.leftPx > 0 ? '' : ' is-track-start'),
                        title: title, text: machineDayStatText(s) });
                    badge.style.left = s.leftPx + 'px';
                    badge.style.width = s.widthPx + 'px';
                    headTrack.appendChild(badge);
                });
            }
            body.appendChild(el('div', { class: 'atex-cg-row atex-cg-machine-head' }, [nameCell, headTrack]));

            // #4110: обед (#3342) и перерывы (#4007) — серые накладки ПОВЕРХ бара; несущий их бар в
            // layoutGroups уже РАСШИРЕН на их длительность, а leftPx/widthPx накладки пересчитаны так,
            // чтобы она легла НА бар (не «висела в конце», #4110). Кладём накладку на несущее задание:
            // обед с известным LUNCH_START и перерыв несут carrierIndex; зазор-обед (LUNCH_START
            // неизвестен) привязываем к резке ПЕРЕД зазором (beforeIndex − 1) — как в layoutGroups.
            var overlaysByTask = {};
            function pushOverlay(idx, band) {
                if (idx == null) return;
                (overlaysByTask[idx] = overlaysByTask[idx] || []).push(band);
            }
            (group.lunches || []).forEach(function(l) {
                var ci = l.carrierIndex != null ? l.carrierIndex : (l.beforeIndex != null ? l.beforeIndex - 1 : null);
                pushOverlay(ci, buildOverlayBand(l, 'Обед'));
            });
            (group.breaks || []).forEach(function(mk) {
                pushOverlay(mk.carrierIndex, buildOverlayBand(mk, mk.label || 'Перерыв'));
            });

            // #4238: задания и «Отпуск» станка — в ХРОНОЛОГИЧЕСКОМ порядке по старту (отпуск больше не
            // всегда внизу дня): задания сохраняют свой порядок, отпуск вставлен по времени начала.
            mergeGroupRows(group.tasks, group.downtimes).forEach(function(row) {
                // #4229/#4238: «Отпуск» — ОТДЕЛЬНОЙ строкой (не накладкой на баре), серым баром по
                // времени простоя; в метке слева «Отпуск», подпись бара — диапазон + Примечание (≤10).
                if (row.kind === 'downtime') {
                    var dt = row.downtime;
                    var dtTitle = 'Отпуск ' + formatTime(dt.startMs) + '–' + formatTime(dt.endMs)
                        + (dt.notesFull ? ' · ' + dt.notesFull : '');
                    var dtLabel = el('div', { class: 'atex-cg-label', title: 'Отпуск' }, [
                        el('span', { class: 'atex-cg-label-main', text: 'Отпуск' })
                    ]);
                    var dtTrack = el('div', { class: 'atex-cg-track atex-cg-downtime-track' });
                    dtTrack.style.minWidth = trackPx + 'px';
                    appendHours(dtTrack);
                    var dtBar = el('div', { class: 'atex-cg-bar atex-cg-bar--downtime', title: dtTitle }, [
                        el('span', { class: 'atex-cg-seg atex-cg-seg--cut' }),
                        el('span', { class: 'atex-cg-bar-main', text: dt.barText })
                    ]);
                    dtBar.style.left = dt.leftPx + 'px';
                    dtBar.style.width = dt.widthPx + 'px';
                    dtTrack.appendChild(dtBar);
                    body.appendChild(el('div', { class: 'atex-cg-row atex-cg-downtime-row' }, [dtLabel, dtTrack]));
                    return;
                }
                var t = row.task, taskIdx = row.taskIdx;
                var statusKey = t.status && t.status.key || 'unknown';
                var labelCell = el('div', { class: 'atex-cg-label', title: t.label }, [
                    el('span', { class: 'atex-cg-label-main', text: t.label })
                ]);
                var track = el('div', { class: 'atex-cg-track' });
                track.style.minWidth = trackPx + 'px';
                appendHours(track);   // #3668 п.6: часовая сетка под баром
                // #3675 п.3: бар-контейнер из сегментов [наладка ножей][смена сырья][резка] —
                // наладка слева и светлее, резка справа главным цветом статуса; границ между
                // сегментами нет (см. cut-gantt.css). Сегменты наладки рисуем, только если отчёт
                // отдал минуты (seg.*Px > 0). Текст времени резки — справа от всего бара.
                var seg = t.segments || {};
                var children = [];
                if (seg.knifePx > 0) {
                    var knifeSeg = el('span', { class: 'atex-cg-seg atex-cg-seg--knife' });
                    knifeSeg.style.width = seg.knifePx + 'px';
                    children.push(knifeSeg);
                }
                if (seg.materialPx > 0) {
                    var matSeg = el('span', { class: 'atex-cg-seg atex-cg-seg--material' });
                    matSeg.style.width = seg.materialPx + 'px';
                    children.push(matSeg);
                }
                var cutSeg = el('span', { class: 'atex-cg-seg atex-cg-seg--cut' });
                children.push(cutSeg);   // ширина резки — остаток (flex: 1)
                children.push(el('span', { class: 'atex-cg-bar-main', text: t.barText }));
                var barLink = el('a', {
                    class: 'atex-cg-bar is-' + statusKey,
                    href: planningLink(t.cut, self.planningUrl),
                    title: t.title,
                    dataset: { cutId: String(t.cut.id == null ? '' : t.cut.id) }
                }, children);
                barLink.style.left = t.leftPx + 'px';
                barLink.style.width = t.widthPx + 'px';
                track.appendChild(barLink);
                // #4052: накладки обеда/перерыва — поверх бара (после него в DOM → выше по z),
                // на позиции их времени; подпись только в title.
                (overlaysByTask[taskIdx] || []).forEach(function(band) { track.appendChild(band); });
                body.appendChild(el('div', { class: 'atex-cg-row' }, [labelCell, track]));
            });
        });

        return body;
    };

    // #3704: ширина видимой области дорожки (px) = ширина корня − поля − колонка-метка − рамки.
    // Нужна как нижняя граница масштаба, чтобы дорожка не была уже экрана. Вне браузера/без
    // размеров → 0 (ограничение не применяется).
    AtexCutGantt.prototype._fitTrackPx = function() {
        if (typeof window === 'undefined' || !this.root || !window.getComputedStyle) return 0;
        var w = this.root.clientWidth || window.innerWidth || 0;
        if (!(w > 0)) return 0;
        var cs = window.getComputedStyle(this.root);
        var pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
        var labelW = parseFloat(cs.getPropertyValue('--cg-label-w')) || 240;
        var px = w - pad - labelW - 4;   // 4px ≈ рамки тела и колонки-метки
        return px > 0 ? px : 0;
    };

    // #3704: установить зум горизонтального масштаба (в границах) и перерисовать.
    AtexCutGantt.prototype.setZoom = function(zoom) {
        var z = Number(zoom);
        if (!isFinite(z) || z <= 0) z = 1;
        z = Math.max(GANTT_ZOOM_MIN, Math.min(GANTT_ZOOM_MAX, z));
        this.state.zoom = round3(z);
        this.render();
    };

    AtexCutGantt.prototype.setBusy = function(on) {
        this.busy = on;
        if (this.root) this.root.classList.toggle('is-busy', !!on);
    };

    AtexCutGantt.prototype.fatal = function(message) {
        this.root.innerHTML = '';
        this.root.appendChild(el('div', { class: 'atex-cg-fatal', text: message }));
    };

    AtexCutGantt.prototype.refresh = function() {
        var self = this;
        if (this.busy) return Promise.resolve();
        this.setBusy(true);
        return this.collect().then(function() {
            self.render();
            self.setBusy(false);
        }).catch(function(err) {
            self.setBusy(false);
            self.fatal('Ошибка загрузки данных: ' + err.message);
        });
    };

    AtexCutGantt.prototype.start = function() {
        var self = this;
        this.root.innerHTML = '';
        this.root.appendChild(el('div', { class: 'atex-cg-loading', text: 'Загрузка диаграммы Ганта…' }));
        return this.refresh().catch(function(err) { self.fatal('Ошибка инициализации: ' + err.message); });
    };

    function init() {
        if (typeof document === 'undefined') return;
        var root = document.getElementById('atex-cut-gantt');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        var controller = new AtexCutGantt(root);
        root._atexCutGantt = controller;
        // #3713: deep-link из «Планирования производства» (иконка Ганта у фильтра дат):
        // ?from=ГГГГ-ММ-ДД&to=ГГГГ-ММ-ДД[&slitter=..] — открыть диаграмму на этом диапазоне.
        // Совместимо со старым ?date=ГГГГ-ММ-ДД (один день).
        var dl = (typeof window !== 'undefined' && window.location) ? parseDeepLink(window.location.search) : null;
        if (dl) {
            if (dl.from) { controller.state.fromIso = dl.from; controller.state.toIso = dl.to || dl.from; }
            else if (dl.date) { controller.state.anchor = dl.date; }
            if (dl.slitter) controller.state.slitter = String(dl.slitter);
        }
        controller.start();
    }

    return { gantt: gantt, Controller: AtexCutGantt, init: init };
});
