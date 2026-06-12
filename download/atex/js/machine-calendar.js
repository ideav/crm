// Рабочее место atex «Календарь занятости станков» (роли Руководитель, Диспетчер).
//
// Полноэкранный календарь занятости станков (слиттеров): по каждому станку —
// дорожка с резками на выбранном интервале (день / 3 дня / неделя / месяц), цвет
// резки кодирует статус (запланировано / в работе / не завершено / в срок / с
// опозданием). Только чтение.
//
// Решение ideav/crm#3339. Календарь раньше был встроен в «Планирование
// производства» (#3334/#3335), затем откатан (#3338) и по #3339 вынесен в
// отдельное полноэкранное рабочее место. Правила РМ — docs/WORKSPACE_DEVELOPMENT_GUIDE.md.
//
// Данные — одним отчётом (минимум серверных запросов, docs/integram-reports.md):
//   • `GET /{db}/report/cut_planning?JSON_KV` — Производственная резка → Обеспечение;
//     отсюда берутся резки с плановой датой, фактическими стартом/финишем, станком,
//     статусом и длительностью (для дедлайна).
//   • `GET /{db}/object/{slitter}/?JSON_OBJ` — справочник станков (чтобы показать и
//     простаивающие станки без резок). При отсутствии прав станки берутся из резок.
//
// Чистое ядро (разбор дат, интервалы, статусы, раскладка резок по дорожкам)
// вынесено в объект `calendar` и экспортируется через module.exports для модульных
// тестов (experiments/atex-machine-calendar.test.js).

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.AtexMachineCalendar = api;
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

    // Терпимый разбор числа: запятая как десятичный разделитель, пробелы-разделители.
    function stripNum(value) {
        if (typeof value === 'number') return isFinite(value) ? value : 0;
        var text = String(value == null ? '' : value).replace(/\s+/g, '').replace(',', '.');
        var n = parseFloat(text);
        return isFinite(n) ? n : 0;
    }

    function round3(n) { return Math.round(n * 1000) / 1000; }

    // Непустой флаг: «1»/«true»/«да» → true; «0»/«false»/«нет»/'' → false.
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

    // Номер резки = плановая дата-штамп (DATETIME). Юникс-штамп → человекочитаемо.
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

    var CALENDAR_DAY_MS = 86400000;
    var CALENDAR_MODES = [
        { id: 'day', label: 'День', days: 1 },
        { id: 'three', label: '3 дня', days: 3 },
        { id: 'week', label: 'Неделя', days: 7 },
        { id: 'month', label: 'Месяц', days: 0 }
    ];

    // Колонки отчёта, в которых может прийти длительность резки (минуты).
    var CUT_DURATION_COLUMNS = ['cut_duration', 'cut_duration_min', 'cut_duration_minutes'];

    function todayISO() {
        var d = new Date();
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function normalizeCalendarMode(mode) {
        var s = String(mode == null ? '' : mode).trim().toLowerCase();
        if (s === '3' || s === '3d' || s === '3days' || s === 'three-days') return 'three';
        for (var i = 0; i < CALENDAR_MODES.length; i++) {
            if (CALENDAR_MODES[i].id === s) return s;
        }
        return 'week';
    }

    function localDateMs(year, month, day, hour, minute, second) {
        var d = new Date(Number(year), Number(month) - 1, Number(day),
            Number(hour) || 0, Number(minute) || 0, Number(second) || 0, 0);
        if (isNaN(d.getTime())) return null;
        if (d.getFullYear() !== Number(year) || d.getMonth() !== Number(month) - 1 || d.getDate() !== Number(day)) return null;
        return d.getTime();
    }

    function parseCalendarDateTimeMs(value) {
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

    // Сдвиг ISO-даты на N календарных дней (через компоненты — корректно через
    // границы месяцев и переходы летнего времени).
    function shiftIsoDate(iso, days) {
        var ms = parseCalendarDateTimeMs(iso);
        if (ms == null) ms = Date.now();
        var d = new Date(ms);
        return localIsoDateFromMs(new Date(d.getFullYear(), d.getMonth(), d.getDate() + Number(days || 0), 0, 0, 0, 0).getTime());
    }

    function formatCalendarDateShort(ms) {
        var d = new Date(ms);
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        return pad(d.getDate()) + '.' + pad(d.getMonth() + 1);
    }

    function formatCalendarDateFull(ms) {
        var d = new Date(ms);
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
    }

    function formatCalendarTime(ms) {
        var d = new Date(ms);
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        return pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function calendarRangeLabel(startMs, endMs) {
        var lastMs = endMs - 1;
        if (localIsoDateFromMs(startMs) === localIsoDateFromMs(lastMs)) return formatCalendarDateFull(startMs);
        return formatCalendarDateFull(startMs) + ' - ' + formatCalendarDateFull(lastMs);
    }

    function calendarRange(anchorIso, mode) {
        var normalized = normalizeCalendarMode(mode);
        var anchorMs = parseCalendarDateTimeMs(anchorIso);
        if (anchorMs == null) anchorMs = startOfLocalDayMs(Date.now());
        var anchorDay = startOfLocalDayMs(anchorMs);
        var startMs, endMs;
        if (normalized === 'week') {
            var wd = new Date(anchorDay).getDay();
            var mondayOffset = (wd + 6) % 7;
            startMs = anchorDay - mondayOffset * CALENDAR_DAY_MS;
            endMs = startMs + 7 * CALENDAR_DAY_MS;
        } else if (normalized === 'month') {
            var m = new Date(anchorDay);
            startMs = new Date(m.getFullYear(), m.getMonth(), 1, 0, 0, 0, 0).getTime();
            endMs = new Date(m.getFullYear(), m.getMonth() + 1, 1, 0, 0, 0, 0).getTime();
        } else {
            var days = normalized === 'three' ? 3 : 1;
            startMs = anchorDay;
            endMs = startMs + days * CALENDAR_DAY_MS;
        }
        var outDays = [];
        for (var t = startMs; t < endMs; t += CALENDAR_DAY_MS) {
            outDays.push({
                iso: localIsoDateFromMs(t),
                label: formatCalendarDateShort(t),
                leftPct: round3(((t - startMs) / (endMs - startMs)) * 100)
            });
        }
        return {
            mode: normalized,
            startMs: startMs,
            endMs: endMs,
            startIso: localIsoDateFromMs(startMs),
            endIso: localIsoDateFromMs(endMs),
            label: calendarRangeLabel(startMs, endMs),
            days: outDays
        };
    }

    function shiftCalendarAnchor(anchorIso, mode, direction) {
        var range = calendarRange(anchorIso, mode);
        var dir = Number(direction) || 0;
        var normalized = range.mode;
        if (normalized === 'month') {
            var d = new Date(range.startMs);
            return localIsoDateFromMs(new Date(d.getFullYear(), d.getMonth() + dir, 1, 0, 0, 0, 0).getTime());
        }
        var step = normalized === 'week' ? 7 : (normalized === 'three' ? 3 : 1);
        return shiftIsoDate(range.startIso, dir * step);
    }

    function cutCalendarDeadlineMs(cut) {
        var planMs = parseCalendarDateTimeMs(cut && cut.planDate);
        var duration = stripNum(cut && cut.duration);
        if (planMs == null || !(duration > 0)) return null;
        return planMs + duration * 60000;
    }

    function cutCalendarStatus(cut, nowMs) {
        var now = Number(nowMs);
        if (!isFinite(now)) now = Date.now();
        var planMs = parseCalendarDateTimeMs(cut && cut.planDate);
        var startMs = parseCalendarDateTimeMs(cut && cut.startDate);
        var endMs = parseCalendarDateTimeMs(cut && cut.endDate);
        var deadlineMs = cutCalendarDeadlineMs(cut);
        var unfinished = truthyFlag(cut && cut.status);
        if (endMs != null) {
            if (deadlineMs != null && endMs > deadlineMs) return { key: 'late', label: 'С опозданием' };
            return deadlineMs != null ? { key: 'on-time', label: 'В срок' } : { key: 'done', label: 'Завершено' };
        }
        if (deadlineMs != null && now > deadlineMs) return { key: 'late', label: 'С опозданием' };
        if (unfinished) return { key: 'unfinished', label: 'Не завершено' };
        if (startMs != null) return { key: 'running', label: 'В работе' };
        if (planMs != null && now > planMs) return { key: 'late-start', label: 'Старт просрочен' };
        if (planMs != null) return { key: 'planned', label: 'Запланировано' };
        return { key: 'unknown', label: 'Без даты' };
    }

    function cutCalendarTimeRange(cut) {
        var planMs = parseCalendarDateTimeMs(cut && cut.planDate);
        var startMs = parseCalendarDateTimeMs(cut && cut.startDate);
        var endMs = parseCalendarDateTimeMs(cut && cut.endDate);
        var visualStartMs = startMs != null ? startMs : planMs;
        if (visualStartMs == null) return null;
        var deadlineMs = cutCalendarDeadlineMs(cut);
        var visualEndMs = endMs != null ? endMs : (deadlineMs != null ? deadlineMs : visualStartMs + 30 * 60000);
        if (!(visualEndMs > visualStartMs)) visualEndMs = visualStartMs + 30 * 60000;
        return {
            startMs: visualStartMs,
            endMs: visualEndMs,
            planMs: planMs,
            actualStartMs: startMs,
            actualEndMs: endMs,
            deadlineMs: deadlineMs
        };
    }

    function cutCalendarItemLabel(cut, range) {
        var name = formatCutNumber(cut && cut.number) || String((cut && cut.id) || '');
        var material = String((cut && cut.materialName) || '').trim();
        var text = formatCalendarTime(range.startMs) + '-' + formatCalendarTime(range.endMs);
        if (name) text += ' · ' + name;
        if (material) text += ' · ' + material;
        return text;
    }

    function cutCalendarItemTitle(cut, range, status) {
        var lines = [];
        lines.push('Резка ' + (formatCutNumber(cut && cut.number) || ('#' + ((cut && cut.id) || ''))));
        var slitter = cut && cut.slitter && cut.slitter.label;
        if (slitter) lines.push('Станок: ' + slitter);
        if (range.planMs != null) lines.push('План: ' + formatDateTimeMinute(new Date(range.planMs)));
        if (range.actualStartMs != null) lines.push('Старт факт: ' + formatDateTimeMinute(new Date(range.actualStartMs)));
        if (range.actualEndMs != null) lines.push('Финиш факт: ' + formatDateTimeMinute(new Date(range.actualEndMs)));
        if (range.deadlineMs != null) lines.push('Дедлайн: ' + formatDateTimeMinute(new Date(range.deadlineMs)));
        lines.push('Статус: ' + status.label);
        return lines.join('\n');
    }

    function cutCalendarItem(cut, range, nowMs) {
        if (!cut || !range || !(range.endMs > range.startMs)) return null;
        var timeRange = cutCalendarTimeRange(cut);
        if (!timeRange) return null;
        if (timeRange.endMs <= range.startMs || timeRange.startMs >= range.endMs) return null;
        var clippedStartMs = Math.max(timeRange.startMs, range.startMs);
        var clippedEndMs = Math.min(timeRange.endMs, range.endMs);
        var spanMs = range.endMs - range.startMs;
        var status = cutCalendarStatus(cut, nowMs);
        return {
            cut: cut,
            cutId: String(cut.id == null ? '' : cut.id),
            startMs: timeRange.startMs,
            endMs: timeRange.endMs,
            clippedStartMs: clippedStartMs,
            clippedEndMs: clippedEndMs,
            leftPct: round3(((clippedStartMs - range.startMs) / spanMs) * 100),
            widthPct: round3(Math.max(((clippedEndMs - clippedStartMs) / spanMs) * 100, 0.4)),
            lane: 0,
            status: status,
            label: cutCalendarItemLabel(cut, timeRange),
            title: cutCalendarItemTitle(cut, timeRange, status)
        };
    }

    function assignCalendarLanes(items) {
        var laneEnds = [];
        return (items || []).slice().sort(function(a, b) {
            return (a.startMs - b.startMs) || (a.endMs - b.endMs) || String(a.cutId).localeCompare(String(b.cutId));
        }).map(function(item) {
            var lane = 0;
            while (lane < laneEnds.length && item.startMs < laneEnds[lane]) lane++;
            laneEnds[lane] = item.endMs;
            var copy = {};
            Object.keys(item).forEach(function(k) { copy[k] = item[k]; });
            copy.lane = lane;
            return copy;
        });
    }

    function calendarItemsForRange(cuts, range, nowMs) {
        var items = [];
        (cuts || []).forEach(function(cut) {
            var item = cutCalendarItem(cut, range, nowMs);
            if (item) items.push(item);
        });
        return assignCalendarLanes(items);
    }

    function machineCalendarGroups(cuts, slitters, range, nowMs, filters) {
        var f = filters || {};
        var status = String(f.status == null ? '' : f.status).trim();
        var slitterFilter = String(f.slitter == null ? '' : f.slitter).trim();
        var groups = {};
        var order = [];
        function ensure(slitter) {
            var s = slitter || { id: null, label: '' };
            var key = s.id == null || String(s.id) === '' ? ' none' : String(s.id);
            if (!groups[key]) {
                groups[key] = {
                    key: key,
                    slitter: { id: s.id == null || String(s.id) === '' ? null : String(s.id), label: s.label || (s.id == null || String(s.id) === '' ? 'Без станка' : '#' + s.id) },
                    cuts: [],
                    items: [],
                    laneCount: 0
                };
                order.push(key);
            }
            return groups[key];
        }
        (slitters || []).forEach(function(s) {
            if (slitterFilter && String(s && s.id) !== slitterFilter) return;
            ensure(s);
        });
        (cuts || []).forEach(function(cut) {
            if (status && String(cut && cut.status || '').trim() !== status) return;
            var s = cut && cut.slitter || { id: null, label: '' };
            if (slitterFilter && String(s.id == null ? '' : s.id) !== slitterFilter) return;
            ensure(s).cuts.push(cut);
        });
        order.forEach(function(key) {
            var group = groups[key];
            group.items = calendarItemsForRange(group.cuts, range, nowMs);
            group.laneCount = group.items.reduce(function(max, item) { return Math.max(max, item.lane + 1); }, 0);
        });
        return order.map(function(key) { return groups[key]; }).sort(function(a, b) {
            if (a.slitter.id == null) return 1;
            if (b.slitter.id == null) return -1;
            return String(a.slitter.label).localeCompare(String(b.slitter.label), 'ru');
        });
    }

    // Строки отчёта cut_planning → резки для календаря (dedup по cut_id; берём только
    // поля, нужные календарю). Несколько строк на одну резку (join с обеспечением)
    // схлопываются в одну.
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
                materialId: str(row.cut_material_id),
                materialName: str(row.cut_material),
                slitter: { id: row.cut_slitter_id ? String(row.cut_slitter_id) : null, label: str(row.cut_slitter) }
            };
            order.push(id);
        });
        return order.map(function(id) { return byId[id]; });
    }

    // Уникальные станки, встреченные в резках (резерв, если справочник недоступен).
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

    var calendar = {
        CALENDAR_MODES: CALENDAR_MODES,
        normalizeCalendarMode: normalizeCalendarMode,
        parseCalendarDateTimeMs: parseCalendarDateTimeMs,
        shiftIsoDate: shiftIsoDate,
        calendarRange: calendarRange,
        shiftCalendarAnchor: shiftCalendarAnchor,
        cutCalendarStatus: cutCalendarStatus,
        cutCalendarTimeRange: cutCalendarTimeRange,
        cutCalendarItem: cutCalendarItem,
        calendarItemsForRange: calendarItemsForRange,
        assignCalendarLanes: assignCalendarLanes,
        machineCalendarGroups: machineCalendarGroups,
        rowsToCuts: rowsToCuts,
        slittersFromCuts: slittersFromCuts,
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

    function AtexMachineCalendar(root) {
        this.root = root;
        this.db = (typeof window !== 'undefined' && window.db) || root.getAttribute('data-db') || '';
        this.slitterTable = root.getAttribute('data-slitter-table') || '1070';
        this.busy = false;
        this.cuts = [];
        this.slitters = [];
        this.selectedCutId = null;
        this.state = {
            mode: 'week',
            anchor: todayISO(),
            slitter: '',
            status: ''
        };
    }

    AtexMachineCalendar.prototype.url = function(path) {
        return '/' + encodeURIComponent(this.db) + '/' + path;
    };

    AtexMachineCalendar.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                try { return JSON.parse(text); }
                catch (e) { throw new Error('Некорректный JSON: ' + text.slice(0, 200)); }
            });
        });
    };

    AtexMachineCalendar.prototype.nowMs = function() { return Date.now(); };

    // Справочник станков: object/{slitter}?JSON_OBJ. При ошибке прав — пусто,
    // станки будут взяты из самих резок (slittersFromCuts).
    AtexMachineCalendar.prototype.loadSlitters = function() {
        return this.getJson('object/' + encodeURIComponent(this.slitterTable) + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            return (rows || []).map(function(r) {
                return { id: String(r.i), label: (r.r && r.r[0]) || ('#' + r.i) };
            });
        }).catch(function() { return []; });
    };

    AtexMachineCalendar.prototype.collect = function() {
        var self = this;
        return Promise.all([
            this.getJson('report/cut_planning?JSON_KV&LIMIT=0,5000'),
            this.loadSlitters()
        ]).then(function(res) {
            self.cuts = rowsToCuts(res[0] || []);
            var refSlitters = res[1] || [];
            // Объединяем справочник станков и станки из резок (на случай неполного справочника).
            var merged = {};
            var ordered = [];
            refSlitters.concat(slittersFromCuts(self.cuts)).forEach(function(s) {
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

    AtexMachineCalendar.prototype.render = function() {
        var self = this;
        var st = this.state;
        st.mode = normalizeCalendarMode(st.mode);
        var range = calendarRange(st.anchor || todayISO(), st.mode);
        if (!st.anchor) st.anchor = range.startIso;
        var nowMs = this.nowMs();

        this.root.innerHTML = '';

        // ── Тулбар: заголовок · период · режимы · дата · фильтр станка · обновить ──
        var prevBtn = el('button', { class: 'atex-pp-cal-arrow', type: 'button', text: '‹', title: 'Предыдущий период' });
        var nextBtn = el('button', { class: 'atex-pp-cal-arrow', type: 'button', text: '›', title: 'Следующий период' });
        prevBtn.addEventListener('click', function() {
            st.anchor = shiftCalendarAnchor(st.anchor || range.startIso, st.mode, -1);
            self.render();
        });
        nextBtn.addEventListener('click', function() {
            st.anchor = shiftCalendarAnchor(st.anchor || range.startIso, st.mode, 1);
            self.render();
        });

        var modeWrap = el('div', { class: 'atex-pp-cal-modes', role: 'group', 'aria-label': 'Период календаря' });
        CALENDAR_MODES.forEach(function(m) {
            var btn = el('button', {
                class: 'atex-pp-cal-mode' + (m.id === st.mode ? ' is-active' : ''),
                type: 'button', text: m.label, title: m.label
            });
            btn.addEventListener('click', function() { st.mode = m.id; self.render(); });
            modeWrap.appendChild(btn);
        });

        var dateInput = el('input', {
            class: 'atex-mc-input atex-pp-cal-date', type: 'date',
            value: st.anchor || range.startIso, title: 'Дата периода'
        });
        dateInput.addEventListener('change', function() {
            if (!dateInput.value) return;
            st.anchor = dateInput.value;
            self.render();
        });

        // Фильтр по станку.
        var slitterSelect = el('select', { class: 'atex-mc-input atex-mc-slitter', title: 'Станок' });
        slitterSelect.appendChild(el('option', { value: '', text: 'Все станки' }));
        this.slitters.forEach(function(s) {
            var opt = el('option', { value: s.id, text: s.label });
            if (String(st.slitter) === String(s.id)) opt.setAttribute('selected', 'selected');
            slitterSelect.appendChild(opt);
        });
        slitterSelect.value = st.slitter || '';
        slitterSelect.addEventListener('change', function() { st.slitter = slitterSelect.value || ''; self.render(); });

        var todayBtn = el('button', { class: 'atex-mc-btn', type: 'button', text: 'Сегодня', title: 'Перейти к текущей дате' });
        todayBtn.addEventListener('click', function() { st.anchor = todayISO(); self.render(); });

        var refreshBtn = el('button', { class: 'atex-mc-btn', type: 'button', text: 'Обновить', title: 'Перечитать данные' });
        refreshBtn.addEventListener('click', function() { self.refresh(); });

        var head = el('div', { class: 'atex-mc-toolbar atex-pp-cal-head' }, [
            el('div', { class: 'atex-pp-cal-title', text: 'Календарь занятости станков' }),
            el('div', { class: 'atex-pp-cal-period' }, [prevBtn, el('span', { class: 'atex-pp-cal-range', text: range.label }), nextBtn]),
            modeWrap,
            el('div', { class: 'atex-mc-tools' }, [dateInput, slitterSelect, todayBtn, refreshBtn])
        ]);
        this.root.appendChild(head);

        // ── Легенда ──
        this.root.appendChild(el('div', { class: 'atex-pp-cal-legend' }, [
            el('span', { class: 'atex-pp-cal-legend-item is-planned', text: 'Запланировано' }),
            el('span', { class: 'atex-pp-cal-legend-item is-unfinished', text: 'Не завершено' }),
            el('span', { class: 'atex-pp-cal-legend-item is-on-time', text: 'В срок' }),
            el('span', { class: 'atex-pp-cal-legend-item is-late', text: 'С опозданием' })
        ]));

        // ── Тело: компактная сетка недель (day/three → тайминг; week/month → сетка) ──
        // #3347: режимы week и month показывают компактную сетку дней по неделям;
        // режим day — подробный тайминг. Клик по ячейке дня переключает в day-режим.
        var scroll = el('div', { class: 'atex-pp-cal-scroll atex-mc-scroll' });
        if (st.mode === 'day' || st.mode === 'three') {
            scroll.appendChild(this._buildTimelineBody(range, nowMs));
        } else {
            scroll.appendChild(this._buildWeekGrid(range, nowMs));
        }
        this.root.appendChild(scroll);
    };

    // Горизонтальный тайминг (day / three): станки строками, время по горизонтали.
    AtexMachineCalendar.prototype._buildTimelineBody = function(range, nowMs) {
        var self = this;
        var st = this.state;
        var groups = machineCalendarGroups(this.cuts, this.slitters, range, nowMs, {
            status: st.status, slitter: st.slitter
        });
        var totalItems = groups.reduce(function(total, group) { return total + group.items.length; }, 0);

        function appendTicks(track, scale) {
            range.days.forEach(function(day, idx) {
                var tick = el('span', { class: 'atex-pp-cal-tick' + (scale ? ' is-scale' : '') });
                tick.style.left = day.leftPct + '%';
                if (scale) {
                    var label = el('span', { class: 'atex-pp-cal-tick-label', text: day.label });
                    if (range.mode === 'month' && idx % 2 !== 0) label.className += ' is-minor';
                    tick.appendChild(label);
                }
                track.appendChild(tick);
            });
            var endTick = el('span', { class: 'atex-pp-cal-tick is-end' + (scale ? ' is-scale' : '') });
            endTick.style.left = '100%';
            track.appendChild(endTick);
        }

        var body = el('div', { class: 'atex-pp-cal-body atex-pp-cal-body--' + range.mode });
        var scaleRow = el('div', { class: 'atex-pp-cal-row atex-pp-cal-scale-row' });
        scaleRow.appendChild(el('div', { class: 'atex-pp-cal-machine atex-pp-cal-machine--scale', text: 'Станок' }));
        var scaleTrack = el('div', { class: 'atex-pp-cal-track atex-pp-cal-scale' });
        appendTicks(scaleTrack, true);
        scaleRow.appendChild(scaleTrack);
        body.appendChild(scaleRow);

        if (!groups.length) {
            body.appendChild(el('div', { class: 'atex-pp-cal-empty', text: 'Нет станков для календаря' }));
        } else {
            groups.forEach(function(group) {
                var row = el('div', { class: 'atex-pp-cal-row' });
                row.appendChild(el('div', { class: 'atex-pp-cal-machine', text: group.slitter.label }));
                var track = el('div', { class: 'atex-pp-cal-track' });
                var laneCount = Math.max(group.laneCount, group.items.length ? 1 : 0);
                track.style.minHeight = Math.max(38, laneCount * 30 + 10) + 'px';
                appendTicks(track, false);
                if (!group.items.length) {
                    track.appendChild(el('span', { class: 'atex-pp-cal-row-empty', text: 'Нет резок' }));
                }
                group.items.forEach(function(item) {
                    var active = String(self.selectedCutId) === String(item.cutId);
                    var statusKey = item.status && item.status.key || 'unknown';
                    var btn = el('button', {
                        class: 'atex-pp-cal-item is-' + statusKey + (active ? ' is-active' : ''),
                        type: 'button', title: item.title, dataset: { cutId: item.cutId }
                    }, [
                        el('span', { class: 'atex-pp-cal-item-main', text: item.label }),
                        el('span', { class: 'atex-pp-cal-item-status', text: item.status.label })
                    ]);
                    btn.style.left = item.leftPct + '%';
                    btn.style.width = item.widthPct + '%';
                    btn.style.top = (item.lane * 30 + 5) + 'px';
                    btn.addEventListener('click', function() {
                        self.selectedCutId = (String(self.selectedCutId) === String(item.cutId)) ? null : item.cutId;
                        self.render();
                    });
                    track.appendChild(btn);
                });
                row.appendChild(track);
                body.appendChild(row);
            });
        }

        if (!totalItems) {
            body.appendChild(el('div', { class: 'atex-pp-cal-note', text: 'На выбранном интервале резок нет' }));
        }
        return body;
    };

    // #3347: Компактная сетка недель: строки = недели, ячейки = дни.
    // Все станки в одной ячейке; резки — цветные блоки без подписей (подпись в title).
    // Клик по дню → переключение в day-режим с тайм-линией для этого дня.
    AtexMachineCalendar.prototype._buildWeekGrid = function(range, nowMs) {
        var self = this;
        var st = this.state;
        var todayIso = todayISO();

        // Все группы без фильтра статуса, с фильтром станка если выбран.
        var groups = machineCalendarGroups(this.cuts, this.slitters, range, nowMs, { slitter: st.slitter });

        // Карта: isoDay → [{cut, slitter}] — все резки, захватывающие данный день.
        var dayCutsMap = {};
        groups.forEach(function(group) {
            group.cuts.forEach(function(cut) {
                var tr = cutCalendarTimeRange(cut);
                if (!tr) return;
                range.days.forEach(function(day) {
                    var dayMs = parseCalendarDateTimeMs(day.iso);
                    if (dayMs == null) return;
                    if (tr.endMs > dayMs && tr.startMs < dayMs + CALENDAR_DAY_MS) {
                        if (!dayCutsMap[day.iso]) dayCutsMap[day.iso] = [];
                        dayCutsMap[day.iso].push({ cut: cut, slitter: group.slitter });
                    }
                });
            });
        });

        // Разбить дни на недели ≤7.
        var days = range.days;
        var weeks = [];
        for (var i = 0; i < days.length; i += 7) {
            weeks.push(days.slice(i, Math.min(i + 7, days.length)));
        }

        var grid = el('div', { class: 'atex-mc-grid' });

        // Заголовок дней недели — только если показываем полные недели.
        if (range.mode === 'week' || range.mode === 'month') {
            var DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
            var labelsRow = el('div', { class: 'atex-mc-week-labels' });
            DOW.forEach(function(d) { labelsRow.appendChild(el('div', { class: 'atex-mc-day-label', text: d })); });
            grid.appendChild(labelsRow);
        }

        weeks.forEach(function(week) {
            var weekEl = el('div', { class: 'atex-mc-week' });
            week.forEach(function(day) {
                var entries = dayCutsMap[day.iso] || [];
                var cls = 'atex-mc-day';
                if (day.iso === todayIso) cls += ' is-today';
                if (entries.length) cls += ' has-cuts';
                var dayEl = el('div', { class: cls });
                dayEl.appendChild(el('div', { class: 'atex-mc-day-num', text: day.label }));
                if (entries.length) {
                    var cutsEl = el('div', { class: 'atex-mc-day-cuts' });
                    entries.forEach(function(entry) {
                        var tr = cutCalendarTimeRange(entry.cut);
                        var status = cutCalendarStatus(entry.cut, nowMs);
                        var titleText = entry.slitter.label + '\n' + cutCalendarItemTitle(entry.cut, tr || {}, status);
                        cutsEl.appendChild(el('span', { class: 'atex-mc-cut-block is-' + status.key, title: titleText }));
                    });
                    dayEl.appendChild(cutsEl);
                }
                dayEl.addEventListener('click', function() {
                    self.state.anchor = day.iso;
                    self.state.mode = 'day';
                    self.render();
                });
                weekEl.appendChild(dayEl);
            });
            // Добиваем неполные недели до 7 пустыми ячейками.
            for (var p = week.length; p < 7; p++) {
                weekEl.appendChild(el('div', { class: 'atex-mc-day atex-mc-day--empty' }));
            }
            grid.appendChild(weekEl);
        });

        return grid;
    };

    AtexMachineCalendar.prototype.setBusy = function(on) {
        this.busy = on;
        if (this.root) this.root.classList.toggle('is-busy', !!on);
    };

    AtexMachineCalendar.prototype.fatal = function(message) {
        this.root.innerHTML = '';
        this.root.appendChild(el('div', { class: 'atex-mc-fatal', text: message }));
    };

    AtexMachineCalendar.prototype.refresh = function() {
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

    AtexMachineCalendar.prototype.start = function() {
        var self = this;
        this.root.innerHTML = '';
        this.root.appendChild(el('div', { class: 'atex-mc-loading', text: 'Загрузка календаря занятости станков…' }));
        return this.refresh()
            .catch(function(err) { self.fatal('Ошибка инициализации: ' + err.message); });
    };

    function init() {
        if (typeof document === 'undefined') return;
        var root = document.getElementById('atex-machine-calendar');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        var controller = new AtexMachineCalendar(root);
        root._atexMachineCalendar = controller;
        controller.start();
    }

    return { calendar: calendar, Controller: AtexMachineCalendar, init: init };
});

//
//
// @version 2026-06-12-issue-3347
