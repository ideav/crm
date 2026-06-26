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
//     стартом/финишем, станком, статусом, длительностью, очередностью, лидером,
//     заказом и материалом (ссылки резолвятся сервером — доступ к справочникам
//     ролям не нужен, в т.ч. к «Лидер», ср. #3623).
//   • GET /{db}/object/{slitter}/?JSON_OBJ — справочник станков для фильтра (при
//     отсутствии прав станки берутся из самих заданий).
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

    function cutTimeRange(cut) {
        var planMs = parseDateTimeMs(cut && cut.planDate);
        var startMs = parseDateTimeMs(cut && cut.startDate);
        var endMs = parseDateTimeMs(cut && cut.endDate);
        var visualStartMs = startMs != null ? startMs : planMs;
        if (visualStartMs == null) return null;
        var deadlineMs = cutDeadlineMs(cut);
        var visualEndMs = endMs != null ? endMs : (deadlineMs != null ? deadlineMs : visualStartMs + 30 * 60000);
        if (!(visualEndMs > visualStartMs)) visualEndMs = visualStartMs + 30 * 60000;
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
        var byDay = {}, order = [];
        (cuts || []).forEach(function(cut) {
            var tr = cutTimeRange(cut);
            if (!tr) return;
            var dayMs = startOfLocalDayMs(tr.startMs);
            var seg = byDay[dayMs];
            if (!seg) {
                seg = byDay[dayMs] = {
                    startMs: dayMs + startHour * GANTT_HOUR_MS,
                    endMs: dayMs + endHour * GANTT_HOUR_MS + tailMin * 60000
                };
                order.push(dayMs);
            }
            if (tr.startMs < seg.startMs) seg.startMs = tr.startMs;          // ранний старт
            var barEndMs = cutBarEndMs(cut);
            if (barEndMs != null && barEndMs > seg.endMs) seg.endMs = barEndMs; // захлёст за смену
        });
        if (!order.length) {
            var dayMs0 = range && range.startMs != null ? startOfLocalDayMs(range.startMs) : startOfLocalDayMs(Date.now());
            return [{ startMs: dayMs0 + startHour * GANTT_HOUR_MS, endMs: dayMs0 + endHour * GANTT_HOUR_MS + tailMin * 60000 }];
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
    function hourTicks(scale, pxPerMin, opts) {
        var o = opts || {};
        if (!scale || !scale.segments || !scale.segments.length) return [];
        var ppm = pxPerMin > 0 ? pxPerMin : GANTT_PX_PER_MIN;
        var stepMs = chooseHourStep(ppm * 60, o) * GANTT_HOUR_MS;
        var ticks = [];
        scale.segments.forEach(function(seg) {
            ticks.push({
                ms: seg.startMs,
                hour: new Date(seg.startMs).getHours(),
                leftPx: seg.leftPx,
                label: formatTime(seg.startMs),
                dateLabel: formatDateShort(seg.startMs),
                newDay: true
            });
            for (var ms = floorToHourMs(seg.startMs) + stepMs; ms <= seg.endMs + 0.5; ms += stepMs) {
                if (ms <= seg.startMs) continue;
                ticks.push({
                    ms: ms,
                    hour: new Date(ms).getHours(),
                    leftPx: scale.toPx(ms),
                    label: formatTime(ms),
                    dateLabel: '',
                    newDay: false
                });
            }
        });
        return ticks;
    }

    // #3675 п.3: минуты наладки ПЕРЕД резкой (для сегментов бара). Только для запланированных
    // (без фактического старта) — у начатых/завершённых наладка уже позади, показываем факт.
    // { knife, material, total } в минутах; отрицательные/пустые входы → 0.
    function cutSetupMin(cut) {
        var tr = cutTimeRange(cut);
        if (tr && tr.actualStartMs != null) return { knife: 0, material: 0, total: 0 };
        var knife = Math.max(0, stripNum(cut && cut.setupKnifeMin));
        var material = Math.max(0, stripNum(cut && cut.setupMaterialMin));
        return { knife: knife, material: material, total: round3(knife + material) };
    }

    // #3700: длительность сегмента «резка+лидер» бара, мин. У ЗАПЛАНИРОВАННЫХ резок берём
    // хранимое «Резка и Лидер» (cut_time) — точную сумму намотки и лидера; нет значения
    // (легаси/до миграции) → грубое окно cutTimeRange (как раньше). Начатые/завершённые —
    // всегда фактическое окно (план уже не показываем, как и наладку в cutSetupMin). Чистая — тест.
    function cutBarMinutes(cut) {
        var tr = cutTimeRange(cut);
        var winMin = tr ? (tr.endMs - tr.startMs) / 60000 : 0;
        if (tr && tr.actualStartMs != null) return winMin;
        if (cut && cut.cutTimeMin != null) return Math.max(0, stripNum(cut.cutTimeMin));
        // #3705: cut_time не пришёл → намотка (окно cutTimeRange) + расчётный лидер «между резками»
        // (attachLeaderMinutes кладёт cut.leaderMin). Иначе бар короче плана ровно на лидер.
        return round3(winMin + Math.max(0, stripNum(cut && cut.leaderMin)));
    }

    // Текст бара (#3668 п.4): диапазон времени, например «11:19-11:23 (4 мин)».
    // #3680: подпись охватывает ВСЁ задание (наладка + резка), а не только резку.
    // Начало = левый край бара (tr.startMs, та же точка, что у строки .atex-cg-label-main);
    // setupMin раздвигает только правый край — добавляет к окну минуты наладки перед резкой.
    function cutBarTime(cut, setupMin, maxEndMs) {
        var tr = cutTimeRange(cut);
        if (!tr) return '';
        // #3705: правый край = старт + (резка+лидер) + наладка — ровно та же сумма минут, что у
        // ширины бара (cutBarSegments) и у окна планировщика. Раньше брали tr.endMs (намотка БЕЗ
        // лидера) + наладка → конец задания получался на лидер «между резками» короче плана.
        var startMs = tr.startMs;
        var endMs = startMs + (cutBarMinutes(cut) + (Number(setupMin) || 0)) * 60000;
        // #3708: не заходить за старт следующего задания того же станка. Длительности хранятся
        // округлёнными вверх (#3635 п.4), а cut_plan_date — по дробному времени, поэтому бар бывает
        // на доли минуты длиннее реального окна и налезал на следующий бар.
        var maxMs = Number(maxEndMs);
        if (maxEndMs != null && isFinite(maxMs) && maxMs > startMs && endMs > maxMs) endMs = maxMs;
        var mins = Math.max(1, Math.round((endMs - startMs) / 60000));
        return formatTime(startMs) + '-' + formatTime(endMs) + ' (' + mins + ' мин)';
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
                sequence: row.cut_sequence == null || row.cut_sequence === '' ? null : stripNum(row.cut_sequence),
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

    // Порядок заданий ВНУТРИ станка: по очередности (пусто — в конец), затем по
    // визуальному старту, затем по id. Мутирует переданный массив (он локальный в layoutGroups).
    // #3747: порядок строк станка — по РЕАЛЬНОМУ времени старта (planDate/факт), а НЕ по
    // «Очередности»: она сбрасывается на каждый день (1..N), поэтому сортировка по ней первой
    // перемешивала дни (день2-очередь1 вставал над днём1-очередь2) — бары прыгали между днями,
    // «не лесенкой». По времени старта строки идут строго хронологически (чистая лесенка через
    // дни). «Очередность» и id — только тай-брейк при равном старте.
    function orderCutsInGroup(cuts) {
        cuts.sort(function(a, b) {
            var ta = cutTimeRange(a), tb = cutTimeRange(b);
            var ma = ta ? ta.startMs : Infinity, mb = tb ? tb.startMs : Infinity;
            if (ma !== mb) return ma - mb;
            var qa = a.sequence == null ? Infinity : a.sequence;
            var qb = b.sequence == null ? Infinity : b.sequence;
            if (qa !== qb) return qa - qb;
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

        var win = ganttWindow(visible, range, o);
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

        var groups = orderKeys.map(function(k) { return groupsMap[k]; }).sort(function(a, b) {
            if (a.slitter.id == null) return 1;
            if (b.slitter.id == null) return -1;
            return String(a.slitter.label).localeCompare(String(b.slitter.label), 'ru');
        });

        groups.forEach(function(g) {
            orderCutsInGroup(g.cuts);
            var ordered = g.cuts;
            g.tasks = ordered.map(function(cut, i) {
                var tr = cutTimeRange(cut) || { startMs: win.startMs, endMs: win.startMs };
                var status = cutStatus(cut, nowMs);
                // #3675 п.3 / #3680: ширина бара = наладка + резка; подпись времени — ВСЁ окно задания
                // (от начала наладки до конца резки), а не только резка.
                var seg = cutBarSegments(cut, pxPerMin, minPx);
                // #3747: левый край бара — по СВЁРНУТОЙ оси (scale.toPx): нерабочее время не
                // занимает места, дни идут встык. Ширина — по минутам (наладка+резка), как и раньше.
                var leftPx = scale.toPx(tr.startMs);
                var widthPx = seg.totalPx;
                // #3708: бар не должен заходить за старт следующего задания того же станка —
                // длительности хранятся вверх (#3635 п.4), а старты по дробному времени, поэтому бар
                // бывал длиннее реального окна. Завершённые (есть факт. финиш) не режем — реальную
                // длительность показываем как есть (конфликт виден). #3747: ширину-границу тоже
                // считаем по свёрнутой оси, чтобы стык дней резал захлёст по краю рабочего окна.
                var nextStartMs = null;
                if (tr.actualEndMs == null && i + 1 < ordered.length) {
                    var ntr = cutTimeRange(ordered[i + 1]);
                    if (ntr && ntr.startMs > tr.startMs) nextStartMs = ntr.startMs;
                }
                if (nextStartMs != null) {
                    var maxWidthPx = round3(scale.toPx(nextStartMs) - leftPx);
                    if (maxWidthPx > 0 && widthPx > maxWidthPx) widthPx = maxWidthPx;
                }
                return {
                    cut: cut, status: status,
                    leftPx: leftPx,
                    widthPx: widthPx,
                    segments: seg,
                    label: cutRowLabel(cut), barText: cutBarTime(cut, seg.setupMin, nextStartMs),
                    title: cutBarTitle(cut, tr, status)
                };
            });
            delete g.cuts;
        });
        return { groups: groups, trackPx: trackPx, window: win, scale: scale, pxPerMin: pxPerMin };
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
        cutRowLabel: cutRowLabel,
        cutBarTime: cutBarTime,
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
        layoutGroups: layoutGroups,
        ganttWindow: ganttWindow,
        ganttTrackPx: ganttTrackPx,
        cutBarEndMs: cutBarEndMs,           // #3747
        workingSegments: workingSegments,   // #3747
        ganttScale: ganttScale,             // #3747
        chooseHourStep: chooseHourStep,
        hourTicks: hourTicks,
        pxPerMinForMode: pxPerMinForMode,
        planningLink: planningLink,
        slittersFromCuts: slittersFromCuts,
        parseDeepLink: parseDeepLink,
        formatCutNumber: formatCutNumber,
        todayISO: todayISO
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

    AtexCutGantt.prototype.collect = function() {
        var self = this;
        return Promise.all([
            this.getJson('report/cut_planning?JSON_KV&LIMIT=0,5000'),
            this.loadSlitters(),
            this.loadStrips(),
            this.loadOpTimes(),
            this.loadPrevCutSetup()   // #3693: текущая заправка станков для наладки первой резки
        ]).then(function(res) {
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
            el('span', { class: 'atex-cg-legend-item is-late', text: STATUS_LABELS.late })
        ]);
    };

    AtexCutGantt.prototype._buildBody = function(range, nowMs) {
        var self = this;
        var st = this.state;
        // #3668: задания размещаются по реальному времени на общей шкале окна.
        // #3704: зум по горизонтали + нижняя граница «вписать в экран» (дорожка не уже видимой области).
        var data = layoutGroups(this.cuts, range, nowMs, { status: st.status, slitter: st.slitter },
            { zoom: st.zoom, fitTrackPx: this._fitTrackPx() });

        var body = el('div', { class: 'atex-cg-body' });
        if (!data.groups.length) {
            body.appendChild(el('div', { class: 'atex-cg-empty', text: 'На выбранном интервале заданий нет' }));
            return body;
        }
        var trackPx = data.trackPx;
        body.style.minWidth = 'calc(var(--cg-label-w) + ' + trackPx + 'px)';

        // #3668 п.6: часовые деления одинаковым пунктиром, шаг подобран по плотности окна.
        var ticks = hourTicks(data.scale, data.pxPerMin);   // #3747: деления по свёрнутой оси (рабочие окна)
        function appendHours(track) {
            ticks.forEach(function(t) {
                // #3747: на стыке дней (newDay) — сплошная линия-разделитель: ночь свёрнута,
                // дни идут встык, поэтому границу смены выделяем отдельно от часовой сетки.
                var node = el('span', { class: 'atex-cg-hour' + (t.newDay ? ' is-day' : '') });
                node.style.left = t.leftPx + 'px';
                track.appendChild(node);
            });
        }

        // Верхняя шкала времени: метки «HH:00», на первом тике суток — дата.
        var scaleRow = el('div', { class: 'atex-cg-row atex-cg-scale-row' });
        scaleRow.appendChild(el('div', { class: 'atex-cg-label atex-cg-label--scale', text: 'Время' }));
        var scaleTrack = el('div', { class: 'atex-cg-track atex-cg-scale' });
        scaleTrack.style.minWidth = trackPx + 'px';
        ticks.forEach(function(t) {
            var lbl = el('span', { class: 'atex-cg-hour-label' + (t.newDay ? ' is-day' : '') });
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
            var nameCell = el('div', { class: 'atex-cg-label atex-cg-machine-cell' }, [
                el('span', { class: 'atex-cg-machine-name', text: group.slitter.label }),
                el('span', { class: 'atex-cg-machine-count', text: String(group.tasks.length) })
            ]);
            var headTrack = el('div', { class: 'atex-cg-track atex-cg-machine-track' });
            headTrack.style.minWidth = trackPx + 'px';
            body.appendChild(el('div', { class: 'atex-cg-row atex-cg-machine-head' }, [nameCell, headTrack]));

            group.tasks.forEach(function(t) {
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
