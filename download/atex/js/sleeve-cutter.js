// Рабочее место atex «Пульт втулкореза» (роль Оператор, планшет).
//
// Оператор выбирает втулкорез и ДАТУ, на которую смотрит задания на втулки, и
// ведёт их выполнение: ✓ Готово / Пропустить / ✓✓ Закрыть все. Задания
// планируются на конкретную дату (плановый старт) и подчинены позиции заказа.
// В списке остаются только незакрытые задания; выполненные и пропущенные показывает
// переключатель «показать выполненные» в сводке. № задания — его место в ПЛАНЕ дня:
// оно не меняется ни от закрытия соседей, ни от скрытия выполненных (#4612).
// Решение ideav/crm#2916 (часть #2903); перестройка по образцу пульта слиттера
// (#3869); выравнивание под БОЕВУЮ схему ateh + выбор даты. Правила разработки —
// docs/WORKSPACE_DEVELOPMENT_GUIDE.md, карта рабочих мест — docs/atex_workplaces.md §3.6.
//
// БОЕВАЯ СХЕМА (live ateh): «Задание на втулки» — подчинённая таблица позиции, её
// ГЛАВНОЕ ЗНАЧЕНИЕ (первая колонка) — это ДАТА/ВРЕМЯ планового старта (Unix), а не
// количество. Реквизиты: «Втулкорез» (ссылка), «Кол-во» (план), «Кол-во факт»,
// «Начато» и «Закончено» (обе — дата/время). Отдельного поля «Статус» НЕТ — статус
// задания выводится из заполненности «Начато»/«Закончено»/«Кол-во факт»:
//   Закончено + факт>0 → Готово;  Закончено + факт=0 → Пропущена;
//   Начато (без Закончено) → В работе;  иначе → Ожидает.
//
// Подчинённую таблицу нельзя прочитать плоско (`object/{задание}` отдаёт 0 строк),
// поэтому задания читаются отчётом `sleeve_tasks` (master = таблица задания), а сам
// отчёт фильтруется СЕРВЕРНО по втулкорезу (`FR_cutter_id`) и по диапазону планового
// старта выбранного дня (`FR_task_date`/`TO_task_date`, границы — локальная полночь).
// Действия пишутся напрямую `_m_set/{заданиеId}` (Закончено + Кол-во факт); в партию
// сырья ничего не пишем (#3869). ID таблиц/реквизитов не хардкодятся — берутся по
// именам из `GET /{db}/metadata` (WORKSPACE_DEVELOPMENT_GUIDE.md, разделы 3 и 6).
//
// Чистое ядро (статусы, сводка, разбор строк отчёта, дата-хелперы) вынесено в объект
// `core` и экспортируется через module.exports для модульных тестов
// (experiments/atex-sleeve-cutter.test.js).

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.AtexSleeveCutter = api;
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

    // Имена таблиц и реквизитов схемы atex. По именам рабочее место находит
    // конкретные числовые id в метаданных текущей сборки (а не хардкодит их).
    var TABLE = { task: 'Задание на втулки', cutter: 'Втулкорез' };
    // Реквизиты задания на втулки (боевая схема). Плановая дата — это главное
    // значение таблицы (первая колонка), поэтому в списке реквизитов её нет.
    var TASK_REQ = {
        cutter: 'Втулкорез',
        qty: 'Кол-во',            // плановое количество втулок
        factQty: 'Кол-во факт',
        started: 'Начато',        // дата/время старта
        finished: 'Закончено'     // дата/время завершения
    };
    var CUTTER_REQ = { diaMin: 'Диаметр min, мм', diaMax: 'Диаметр max, мм' };

    // Отчёт по заданиям на втулки и имена его колонок (см. docs/atex_workplaces.md §3.6).
    var REPORT = 'sleeve_tasks';
    var COL = {
        id: 'task_id',
        date: 'task_date',     // главное значение — Unix плановой даты
        cutter: 'cutter',
        cutterId: 'cutter_id',
        qty: 'qty',
        fact: 'fact',
        started: 'started',
        finished: 'finished',
        // #4786: ЧТО ИМЕННО РЕЖЕТ ВТУЛКОРЕЗ. Прежде карточка несла только «старт · план ·
        // факт»: по ней нельзя ни найти заказ, ни понять, какая это втулка, ни прикинуть,
        // сколько метровых палок брать со склада. Четыре колонки отчёта (добавлены в `ateh`
        // и `ateh1` 18.08.2026, см. docs/integram-reports.md §14) дают ровно это.
        orderNo: 'order_no',            // 1075 Заказ (главное значение) — номер заказа
        sleeve: 'sleeve',               // 8194 Позиция → Диаметр втулки — название втулки
        width: 'position_width',        // 1141 Позиция → Ширина, мм — ширина рулона (по ней режут палку)
        sleeveReady: 'sleeve_ready'     // 35567 Диаметр втулки → Готовые (X/пусто)
    };

    // Статусы задания (выводятся из полей; отдельного поля «Статус» на бою нет).
    var STATUSES = ['Ожидает', 'В работе', 'Готово'];
    var SKIPPED = 'Пропущена';

    // ───────────────────────── Чистое ядро ─────────────────────────

    // Терпимый разбор числа: принимает запятую как десятичный разделитель,
    // отбрасывает пробелы; «пусто»/мусор → 0.
    function toNumber(value) {
        if (typeof value === 'number') return isFinite(value) ? value : 0;
        var text = String(value == null ? '' : value).replace(/\s+/g, '').replace(',', '.');
        var n = parseFloat(text);
        return isFinite(n) ? n : 0;
    }

    function round3(n) { return Math.round(n * 1000) / 1000; }
    function str(value) { return value == null ? '' : String(value); }
    function pad2(n) { var s = String(n); return s.length < 2 ? '0' + s : s; }

    // Значение поля строки отчёта: JSON_KV отдаёт либо строку, либо {val,id}.
    function kvVal(v) {
        if (v != null && typeof v === 'object') return v.val != null ? v.val : (v.id != null ? v.id : '');
        return v == null ? '' : v;
    }
    function isFilled(v) { return !(v === '' || v == null); }

    // ── Дата/время: Unix ↔ локальная дата (конвенция cut-gantt.js — локальный TZ) ──

    // Unix (сек или мс) → миллисекунды; 0/мусор → 0.
    function unixToMs(value) {
        var n = toNumber(value);
        if (!n) return 0;
        return n >= 1e12 ? n : n * 1000;
    }
    function localIsoFromMs(ms) {
        var d = new Date(ms);
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
    // Unix → 'YYYY-MM-DD' по локальному времени; пусто → ''.
    function unixToLocalIso(value) {
        var ms = unixToMs(value);
        return ms ? localIsoFromMs(ms) : '';
    }
    // Unix → 'HH:MM' по локальному времени; пусто → ''.
    function unixToLocalTime(value) {
        var ms = unixToMs(value);
        if (!ms) return '';
        var d = new Date(ms);
        return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
    function todayLocalIso() { return localIsoFromMs(Date.now()); }

    function isoParts(iso) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso == null ? '' : iso));
        return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
    }
    // Границы дня в Unix-секундах: [локальная полночь, следующая локальная полночь).
    // Используются как серверный фильтр отчёта по плановому старту (FR_/TO_).
    function dayBoundsUnix(iso) {
        var p = isoParts(iso);
        if (!p) return null;
        var start = new Date(p.y, p.mo - 1, p.d, 0, 0, 0, 0).getTime();
        var end = new Date(p.y, p.mo - 1, p.d + 1, 0, 0, 0, 0).getTime();
        return { start: Math.floor(start / 1000), end: Math.floor(end / 1000) };
    }
    // 'YYYY-MM-DD' → 'DD.MM.YYYY' (для подписи); нераспознанное — как есть.
    function formatRuDate(iso) {
        var p = isoParts(iso);
        return p ? pad2(p.d) + '.' + pad2(p.mo) + '.' + p.y : String(iso == null ? '' : iso);
    }

    // ── Статус задания из полей ──

    // Выводит статус из заполненности «Начато»/«Закончено»/«Кол-во факт».
    function statusFromFields(task) {
        var t = task || {};
        if (isFilled(t.finished)) return toNumber(t.factQty) > 0 ? STATUSES[2] : SKIPPED;
        if (isFilled(t.started)) return STATUSES[1];
        return STATUSES[0];
    }
    function eqStatus(a, b) {
        return String(a == null ? '' : a).trim().toLowerCase() === String(b).toLowerCase();
    }
    function isDone(status) { return eqStatus(status, STATUSES[2]); }
    function isSkipped(status) { return eqStatus(status, SKIPPED); }
    function isTerminal(status) { return isDone(status) || isSkipped(status); }

    // ── Разбор строк отчёта sleeve_tasks → задания ──

    // #4786: булев реквизит в JSON_KV приходит буквой «X» (пусто = снят). Терпим к
    // другим написаниям — база могла бы отдать 1/да/true, и молчаливое «не готовые»
    // отправило бы втулкореза резать то, что и так лежит готовым.
    function isChecked(value) {
        var v = str(value).trim().toLowerCase();
        return v === 'x' || v === '1' || v === 'да' || v === 'true' || v === '+';
    }

    // #4786: СКОЛЬКО МЕТРОВЫХ ПАЛОК НУЖНО НА ЗАДАНИЕ (решение заказчика 18.08.2026):
    // план × ширина рулона × 1.1 / 1000, вверх до целой палки. Ширина — «Ширина, мм»
    // ПОЗИЦИИ: палку длиной 1000 мм режут именно по ней, а 1.1 — десятипроцентный запас
    // на рез и брак. Плана или ширины нет → null: выдуманное число хуже пустого места.
    function sticksNeeded(planQty, widthMm) {
        var plan = toNumber(planQty), width = toNumber(widthMm);
        if (!(plan > 0) || !(width > 0)) return null;
        return Math.ceil(plan * width * 1.1 / 1000);
    }

    // #4786: втулку надо НАРЕЗАТЬ из метровых палок, если у её записи «Диаметр втулки»
    // снята галка «Готовые». Колонки в отчёте нет вовсе (старая сборка отчёта) → null:
    // «не знаю» отличается от «не готовые», и пульт об этом говорит вслух, а не считает
    // палки по умолчанию для всего подряд.
    function needsCutting(task) {
        if (!task || !task.hasSleeveReadyCol) return null;
        return !task.sleeveReady;
    }

    // #4786: сколько палок нужно ПОКАЗАТЬ на карточке. Втулка готовая (или неизвестно) →
    // null, палки не считаем.
    function taskSticks(task) {
        if (!task || needsCutting(task) !== true) return null;
        return sticksNeeded(task.planQty, task.widthMm);
    }

    function taskFromReportRow(row) {
        var r = row || {};
        var dateUnix = toNumber(kvVal(r[COL.date]));
        var has = function(key) { return Object.prototype.hasOwnProperty.call(r, key); };
        var task = {
            id: str(kvVal(r[COL.id])) || null,
            dateUnix: dateUnix,
            dateIso: dateUnix ? unixToLocalIso(dateUnix) : '',
            cutterId: str(kvVal(r[COL.cutterId])) || null,
            cutterLabel: str(kvVal(r[COL.cutter])),
            planQty: kvVal(r[COL.qty]),
            factQty: kvVal(r[COL.fact]),
            started: kvVal(r[COL.started]),
            finished: kvVal(r[COL.finished]),
            // #4786: что режем — заказ, втулка, ширина рулона и признак «Готовые».
            orderNo: str(kvVal(r[COL.orderNo])),
            sleeve: str(kvVal(r[COL.sleeve])),
            widthMm: toNumber(kvVal(r[COL.width])),
            sleeveReady: isChecked(kvVal(r[COL.sleeveReady])),
            // Колонка есть в отчёте? Пустое значение — это «галка снята», отсутствие
            // колонки — «отчёт старый»; путать их нельзя (#4774).
            hasSleeveReadyCol: has(COL.sleeveReady)
        };
        task.status = statusFromFields(task);
        return task;
    }

    // #4786: каких колонок «что режем» в отчёте нет — по ПЕРВОЙ строке (набор ключей у
    // всех строк один). Пульт называет их вслух: молчаливая карточка без заказа читается
    // как «данных нет в базе», хотя дело в сборке отчёта (грабли #4774).
    function missingReportColumns(rows) {
        var first = (rows || [])[0];
        if (!first) return [];
        return [COL.orderNo, COL.sleeve, COL.width, COL.sleeveReady].filter(function(key) {
            return !Object.prototype.hasOwnProperty.call(first, key);
        });
    }

    // Порядок дня — ПЛАНОВЫЙ: по времени планового старта, раньше — выше. Он же даёт
    // № задания: `seq` проставляется один раз на весь день, поэтому номер не меняется
    // ни от выполнения соседей, ни от скрытия выполненных (#4612). Поле пишется в само
    // задание, чтобы номер пережил перерисовку (карточки держат те же объекты, что и
    // `tasks`). Сорт стабилен (V8): задания с одинаковым стартом сохраняют порядок отчёта.
    function numberTasks(tasks) {
        var byPlan = (tasks || []).slice().sort(function(a, b) {
            return toNumber(a.dateUnix) - toNumber(b.dateUnix);
        });
        byPlan.forEach(function(t, i) { t.seq = i + 1; });
        return byPlan;
    }

    // Все задания выбранного втулкореза на выбранную дату (защитный клиентский фильтр —
    // отчёт уже отфильтрован серверно). Пустой cutterId → []. Порядок — плановый,
    // с постоянными номерами.
    function dayTasks(tasks, cutterId, iso) {
        var cid = str(cutterId);
        if (!cid) return [];
        var dayIso = str(iso);
        var list = (tasks || []).filter(function(t) {
            if (str(t.cutterId) !== cid) return false;
            if (dayIso && str(t.dateIso) !== dayIso) return false;
            return true;
        });
        return numberTasks(list);
    }

    // Что показываем в списке: выполненные и пропущенные задания скрыты, пока не
    // включён переключатель «показать выполненные» (#4612). Включили — они встают НА
    // СВОИ МЕСТА в плановом порядке, между соседями, а не сваливаются в конец списка:
    // оператор ищет задание там, где оно стояло. Номера у всех прежние.
    function visibleTasks(tasks, cutterId, iso, showDone) {
        var list = dayTasks(tasks, cutterId, iso);
        return showDone ? list : list.filter(function(t) { return !isTerminal(t.status); });
    }

    // Сколько заданий дня уже завершено или пропущено (столько прячет переключатель).
    function terminalCount(tasks) {
        return (tasks || []).filter(function(t) { return isTerminal(t.status); }).length;
    }

    // Есть ли незавершённые задания (для кнопки «Закрыть все»).
    function hasActiveTasks(tasks, cutterId, iso) {
        return dayTasks(tasks, cutterId, iso).some(function(t) { return !isTerminal(t.status); });
    }

    // Сводка по заданиям: план/факт суммарно, сколько готово, % выполнения по факту.
    function summarize(tasks) {
        var list = tasks || [];
        var plan = 0, fact = 0, done = 0;
        list.forEach(function(t) {
            plan += toNumber(t.planQty);
            fact += toNumber(t.factQty);
            if (isDone(t.status)) done++;
        });
        return {
            total: list.length,
            done: done,
            planQty: round3(plan),
            factQty: round3(fact),
            percent: plan > 0 ? Math.min(100, Math.round((fact / plan) * 100)) : 0
        };
    }

    // ── Поиск сущностей метаданных по имени (val/alias) ──

    function aliasOf(entry) {
        if (!entry) return '';
        if (entry.alias != null && entry.alias !== '') return String(entry.alias);
        if (entry.attrs) {
            try {
                var a = JSON.parse(entry.attrs);
                if (a && a.alias != null) return String(a.alias);
            } catch (e) { /* attrs не JSON */ }
        }
        return '';
    }
    function matchesName(entry, name) {
        if (!entry) return false;
        var target = String(name == null ? '' : name).trim().toLowerCase();
        if (!target) return false;
        if (String(entry.val == null ? '' : entry.val).trim().toLowerCase() === target) return true;
        return aliasOf(entry).trim().toLowerCase() === target;
    }
    function tableByName(list, name) {
        var arr = Array.isArray(list) ? list : (list == null ? [] : [list]);
        var names = Array.isArray(name) ? name : [name];
        for (var i = 0; i < arr.length; i++) {
            for (var j = 0; j < names.length; j++) {
                if (matchesName(arr[i], names[j])) return arr[i];
            }
        }
        return null;
    }
    function reqIdByName(meta, name) {
        var found = (meta && meta.reqs || []).filter(function(r) { return matchesName(r, name); })[0];
        return found ? String(found.id) : null;
    }
    function colIndex(meta, reqName) {
        var order = [String(meta.id)].concat((meta.reqs || []).map(function(r) { return String(r.id); }));
        var rid = reqIdByName(meta, reqName);
        var idx = order.indexOf(String(rid));
        return idx >= 0 ? idx : -1;
    }

    // Подпись диапазона диаметров втулкореза: «20–25 мм», «от 20 мм», «до 76 мм» или ''.
    function formatRange(min, max) {
        var hasMin = isFilled(min), hasMax = isFilled(max);
        if (hasMin && hasMax) return toNumber(min) + '–' + toNumber(max) + ' мм';
        if (hasMin) return 'от ' + toNumber(min) + ' мм';
        if (hasMax) return 'до ' + toNumber(max) + ' мм';
        return '';
    }

    var core = {
        STATUSES: STATUSES,
        SKIPPED: SKIPPED,
        toNumber: toNumber,
        statusFromFields: statusFromFields,
        isDone: isDone,
        isSkipped: isSkipped,
        isTerminal: isTerminal,
        unixToLocalIso: unixToLocalIso,
        unixToLocalTime: unixToLocalTime,
        todayLocalIso: todayLocalIso,
        dayBoundsUnix: dayBoundsUnix,
        formatRuDate: formatRuDate,
        taskFromReportRow: taskFromReportRow,
        isChecked: isChecked,                     // #4786
        sticksNeeded: sticksNeeded,               // #4786
        needsCutting: needsCutting,               // #4786
        taskSticks: taskSticks,                   // #4786
        missingReportColumns: missingReportColumns,   // #4786
        numberTasks: numberTasks,
        dayTasks: dayTasks,
        visibleTasks: visibleTasks,
        terminalCount: terminalCount,
        hasActiveTasks: hasActiveTasks,
        summarize: summarize,
        formatRange: formatRange,
        aliasOf: aliasOf,
        matchesName: matchesName,
        tableByName: tableByName,
        reqIdByName: reqIdByName,
        colIndex: colIndex
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

    function AtexSleeveCutter(root) {
        this.root = root;
        this.db = window.db || root.getAttribute('data-db') || '';
        this.meta = { task: null, cutter: null };
        this.cutters = [];             // справочник втулкорезов [{ id, label, diaMin, diaMax }]
        this.tasks = [];               // задания выбранного втулкореза на выбранную дату
        this.selectedCutterId = null;  // выбранный втулкорез (localStorage)
        this.selectedDate = core.todayLocalIso(); // выбранная дата (localStorage), по умолчанию сегодня
        this.showDone = false;         // показывать выполненные/пропущенные (localStorage)
        this.missingCols = [];         // #4786: колонки «что режем», которых нет в отчёте
        this.busy = false;
    }

    AtexSleeveCutter.prototype.url = function(path) {
        return '/' + encodeURIComponent(this.db) + '/' + path;
    };

    // GET → JSON. Бросает Error при сетевой/JSON-ошибке.
    AtexSleeveCutter.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                try { return JSON.parse(text); }
                catch (e) { throw new Error('Некорректный JSON: ' + text.slice(0, 200)); }
            });
        });
    };

    // POST команды `_m_*`. Токен XSRF подставляется обязательно (раздел 4 гайда).
    AtexSleeveCutter.prototype.post = function(path, params) {
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

    // ── Загрузка метаданных и справочников ──

    AtexSleeveCutter.prototype.loadMetadata = function() {
        var self = this;
        return this.getJson('metadata').then(function(all) {
            var list = Array.isArray(all) ? all : [all];
            self.meta.task = core.tableByName(list, TABLE.task);
            self.meta.cutter = core.tableByName(list, TABLE.cutter);
            if (!self.meta.task) throw new Error('В метаданных не найдена таблица «' + TABLE.task + '»');
            if (!self.meta.cutter) throw new Error('В метаданных не найдена таблица «' + TABLE.cutter + '»');
        });
    };

    AtexSleeveCutter.prototype.loadCutters = function() {
        var self = this;
        if (!this.meta.cutter) { this.cutters = []; return Promise.resolve(); }
        var meta = this.meta.cutter;
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            var minIdx = core.colIndex(meta, CUTTER_REQ.diaMin);
            var maxIdx = core.colIndex(meta, CUTTER_REQ.diaMax);
            self.cutters = (rows || []).map(function(r) {
                var row = r.r || [];
                return {
                    id: String(r.i),
                    label: row[0] || ('#' + r.i),
                    diaMin: minIdx >= 0 ? (row[minIdx] || '') : '',
                    diaMax: maxIdx >= 0 ? (row[maxIdx] || '') : ''
                };
            });
        });
    };

    // Опции выпадающего списка втулкорезов с подписью диапазона.
    AtexSleeveCutter.prototype.cutterOptions = function() {
        return (this.cutters || []).map(function(c) {
            var range = core.formatRange(c.diaMin, c.diaMax);
            return { id: c.id, label: range ? (c.label + ' (' + range + ')') : c.label };
        });
    };

    // ── Чтение заданий на втулки (отчёт sleeve_tasks, серверный фильтр) ──

    // Задания выбранного втулкореза на выбранную дату. Без выбранного втулкореза —
    // ничего не грузим. Отчёт фильтруется серверно по cutter_id и диапазону даты дня.
    AtexSleeveCutter.prototype.loadTasks = function() {
        var self = this;
        if (!this.selectedCutterId) { this.tasks = []; return Promise.resolve(); }
        var path = 'report/' + REPORT + '?JSON_KV&LIMIT=0,5000' +
            '&FR_' + COL.cutterId + '=' + encodeURIComponent(this.selectedCutterId);
        var bounds = core.dayBoundsUnix(this.selectedDate);
        if (bounds) {
            path += '&FR_' + COL.date + '=' + bounds.start + '&TO_' + COL.date + '=' + bounds.end;
        }
        return this.getJson(path).then(function(rows) {
            var list = Array.isArray(rows) ? rows : [];
            self.tasks = list.map(function(row) { return core.taskFromReportRow(row); });
            // #4786: отчёт старой сборки — карточки останутся без заказа/втулки, а палки
            // не посчитаются. Говорим об этом вслух (и в консоль, и плашкой в списке):
            // молчание читалось бы как «в базе пусто».
            self.missingCols = core.missingReportColumns(list);
            if (self.missingCols.length) {
                console.error('[sc] #4786: в отчёте «' + REPORT + '» нет колонок: '
                    + self.missingCols.join(', ') + ' — карточка покажет меньше, чем должна.');
            }
        });
    };

    // Все задания дня (с постоянными номерами) — для сводки, «Закрыть все» и счётчика
    // скрытых; список на экране — visibleTasks (без выполненных, пока не включён показ).
    AtexSleeveCutter.prototype.dayTasks = function() {
        return core.dayTasks(this.tasks, this.selectedCutterId, this.selectedDate);
    };

    AtexSleeveCutter.prototype.visibleTasks = function() {
        return core.visibleTasks(this.tasks, this.selectedCutterId, this.selectedDate, this.showDone);
    };

    // ── Запоминание выбора втулкореза, даты и показа выполненных (localStorage) ──

    AtexSleeveCutter.prototype.storeCutter = function() {
        try { if (window.localStorage) window.localStorage.setItem('atex-sc-cutter', this.selectedCutterId || ''); } catch (e) {}
    };
    AtexSleeveCutter.prototype.restoreCutter = function() {
        try {
            var id = window.localStorage && window.localStorage.getItem('atex-sc-cutter');
            if (id && (this.cutters || []).some(function(c) { return String(c.id) === String(id); })) this.selectedCutterId = String(id);
        } catch (e) {}
        // #4789: втулкорез, на который настроен ПЛАНШЕТ (таблица «Планшет»), сильнее
        // памяти браузера — пульт открывается сразу на своём станке.
        var padId = this.padCutterId();
        if (padId) { this.selectedCutterId = padId; this.storeCutter(); }
    };

    // #4789: втулкорез из настройки планшета, сведённый со справочником пульта (в
    // «Планшете» он лежит ссылкой или названием). Сводим по СЫРОМУ справочнику: в
    // cutterOptions к названию приписан диапазон диаметров, по нему совпадения не будет.
    AtexSleeveCutter.prototype.padCutterId = function() {
        var pad = window.atexPad || null;
        var guard = window.AtexPadGuard || null;
        var obj = pad && pad.config && pad.config.cutter;
        if (!obj || !guard || typeof guard.matchPadObject !== 'function') return '';
        return guard.matchPadObject(this.cutters || [], obj);
    };

    // #4789: выбранный втулкорез уходит в запись планшета — так диспетчер настраивает
    // планшет прямо из пульта. Прав на запись нет (оператор) — тихо ничего не пишем.
    AtexSleeveCutter.prototype.savePadCutter = function() {
        var self = this;
        var pad = window.atexPad || null;
        if (!pad || typeof pad.setObject !== 'function' || !this.selectedCutterId) return;
        var id = String(this.selectedCutterId);
        var cutter = (this.cutters || []).filter(function(c) { return String(c.id) === id; })[0];
        pad.setObject('cutter', { id: id, label: (cutter && cutter.label) || '' }).then(function(res) {
            if (res && res.saved) self.notify('Планшет настроен на втулкорез ' + ((cutter && cutter.label) || id), 'success');
        }).catch(function(err) {
            self.notify('Планшет не настроен: ' + (err && err.message ? err.message : err), 'error');
        });
    };
    AtexSleeveCutter.prototype.storeDate = function() {
        try { if (window.localStorage) window.localStorage.setItem('atex-sc-date', this.selectedDate || ''); } catch (e) {}
    };
    AtexSleeveCutter.prototype.restoreDate = function() {
        try {
            var d = window.localStorage && window.localStorage.getItem('atex-sc-date');
            if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) this.selectedDate = d;
        } catch (e) {}
    };
    AtexSleeveCutter.prototype.storeShowDone = function() {
        try { if (window.localStorage) window.localStorage.setItem('atex-sc-show-done', this.showDone ? '1' : '0'); } catch (e) {}
    };
    AtexSleeveCutter.prototype.restoreShowDone = function() {
        try {
            var v = window.localStorage && window.localStorage.getItem('atex-sc-show-done');
            if (v != null) this.showDone = v === '1';
        } catch (e) {}
    };

    // Перезагрузить задания под текущий втулкорез/дату и перерисовать.
    AtexSleeveCutter.prototype.refresh = function() {
        var self = this;
        this.setBusy(true);
        return this.loadTasks().then(function() {
            self.setBusy(false);
            self.render();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка загрузки заданий: ' + err.message, 'error');
            self.tasks = [];
            self.render();
        });
    };

    // ── Рендеринг (втулкорез + дата → список заданий) ──

    AtexSleeveCutter.prototype.render = function() {
        this.renderToolbar();
        this.renderTasks();
    };

    // Тулбар: выбор втулкореза + выбор даты + «Закрыть все» (если есть активные).
    AtexSleeveCutter.prototype.renderToolbar = function() {
        var self = this;
        var box = this.toolbarEl;
        if (!box) return;
        box.innerHTML = '';

        var select = el('select', { class: 'atex-sc-input' });
        select.appendChild(el('option', { value: '', text: 'Выберите втулкорез' }));
        this.cutterOptions().forEach(function(c) {
            var opt = el('option', { value: c.id, text: c.label });
            if (String(c.id) === String(self.selectedCutterId)) opt.selected = true;
            select.appendChild(opt);
        });
        select.addEventListener('change', function() {
            self.selectedCutterId = select.value || null;
            self.storeCutter();
            self.savePadCutter();   // #4789: и настраиваем сам планшет
            self.refresh();
        });
        box.appendChild(this.field('Втулкорез', select));

        var date = el('input', { type: 'date', class: 'atex-sc-input', value: this.selectedDate || '' });
        date.addEventListener('change', function() {
            self.selectedDate = date.value || core.todayLocalIso();
            self.storeDate();
            self.refresh();
        });
        box.appendChild(this.field('Дата', date, 'atex-sc-field-date'));

        if (this.selectedCutterId && core.hasActiveTasks(this.tasks, this.selectedCutterId, this.selectedDate)) {
            var allBtn = el('button', { class: 'atex-sc-btn atex-sc-btn-advance atex-sc-toolbar-all', type: 'button', text: '✓✓ Закрыть все' });
            allBtn.addEventListener('click', function() { self.closeAll(); });
            box.appendChild(allBtn);
        }
    };

    // Обёртка «подпись + контрол» для тулбара.
    AtexSleeveCutter.prototype.field = function(label, control, extraClass) {
        return el('label', { class: 'atex-sc-field' + (extraClass ? ' ' + extraClass : '') }, [
            el('span', { class: 'atex-sc-label', text: label }),
            control
        ]);
    };

    AtexSleeveCutter.prototype.renderTasks = function() {
        var self = this;
        var host = this.tasksEl;
        if (!host) return;
        host.innerHTML = '';

        if (!this.selectedCutterId) {
            host.appendChild(el('div', { class: 'atex-sc-placeholder', text: 'Выберите втулкорез, чтобы увидеть задания на втулки.' }));
            return;
        }

        host.appendChild(el('div', { class: 'atex-sc-caption', text: 'Задания на ' + core.formatRuDate(this.selectedDate) }));

        // #4786: отчёт без колонок «что режем» — пульт показывает меньше, чем должен, и
        // называет причину. Иначе пустая карточка выглядит как «в базе ничего нет».
        if ((this.missingCols || []).length) {
            host.appendChild(el('div', {
                class: 'atex-sc-note',
                text: 'В отчёте «' + REPORT + '» нет колонок: ' + this.missingCols.join(', ')
                    + '. Карточки показаны без заказа/втулки, метровые палки не посчитаны.'
            }));
        }

        // Сводка и номера — по ВСЕМ заданиям дня, независимо от того, что скрыто.
        var tasks = this.dayTasks();
        if (!tasks.length) {
            host.appendChild(el('div', { class: 'atex-sc-empty', text: 'На эту дату заданий для этого втулкореза нет.' }));
            return;
        }

        var s = core.summarize(tasks);
        var hidden = core.terminalCount(tasks);
        host.appendChild(el('div', { class: 'atex-sc-summary' }, [
            metric('Заданий', s.total),
            metric('Готово', s.done + ' / ' + s.total),
            metric('План, шт', s.planQty),
            this.showDoneToggle(hidden)
        ]));

        var shown = this.visibleTasks();
        if (!shown.length) {
            host.appendChild(el('div', { class: 'atex-sc-empty', text: 'Все задания на эту дату закрыты — включите «Показать выполненные», чтобы их увидеть.' }));
            return;
        }

        var listWrap = el('div', { class: 'atex-sc-tasks' });
        shown.forEach(function(task) { listWrap.appendChild(self.renderTaskRow(task)); });
        host.appendChild(listWrap);

        function metric(label, value) {
            return el('div', { class: 'atex-sc-metric' }, [
                el('span', { class: 'atex-sc-metric-label', text: label }),
                el('span', { class: 'atex-sc-metric-value', text: String(value) })
            ]);
        }
    };

    // Переключатель «показать выполненные» в сводке: со счётчиком того, сколько
    // заданий дня он прячет (#4612). Выбор запоминается в localStorage.
    AtexSleeveCutter.prototype.showDoneToggle = function(hidden) {
        var self = this;
        var box = el('input', { type: 'checkbox' });
        box.checked = !!this.showDone;
        box.addEventListener('change', function() {
            self.showDone = !!box.checked;
            self.storeShowDone();
            self.renderTasks();
        });
        return el('label', { class: 'atex-sc-toggle' }, [
            box,
            el('span', { text: 'Показать выполненные' + (hidden ? ' (' + hidden + ')' : '') })
        ]);
    };

    // Карточка задания одной строкой: слева № (постоянный, по плану дня) и
    // старт / план / факт, посередине — кнопки ✓ Готово / Пропустить, справа — бейдж
    // статуса. У завершённого или пропущенного кнопок нет, середина пустует (#4612).
    AtexSleeveCutter.prototype.renderTaskRow = function(task) {
        var self = this;
        var terminal = core.isTerminal(task.status);
        var skipped = core.isSkipped(task.status);
        var card = el('div', { class: 'atex-sc-card' + (terminal ? ' is-done' : '') + (skipped ? ' is-skipped' : '') });

        var startTime = core.unixToLocalTime(task.dateUnix);
        var fact = core.toNumber(task.factQty);
        // #4786: ГЛАВНАЯ СТРОКА КАРТОЧКИ — ЧТО РЕЖЕМ: номер заказа, втулка, план. Их
        // втулкорез читает с планшета стоя, поэтому они идут крупно и первыми; служебное
        // (старт смены, уже набранный факт) уходит второй строкой помельче.
        var head = [];
        if (task.orderNo) head.push('заказ ' + task.orderNo);
        if (task.sleeve) head.push(task.sleeve);
        // Метровые заготовки — в той же строке, что и «что режем»: их считают со склада
        // ДО начала работы. Плановое количество втулок стои́т бейджем справа («К-во»).
        var sticks = core.taskSticks(task);
        if (sticks != null) head.push('заготовок: ' + sticks);

        var sub = [];
        if (startTime) sub.push('старт ' + startTime);
        if (fact) sub.push('факт ' + fact + ' шт');
        if (core.toNumber(task.widthMm) > 0) sub.push('ширина ' + core.toNumber(task.widthMm) + ' мм');

        var main = el('div', { class: 'atex-sc-card-main' }, [
            el('span', { class: 'atex-sc-card-num', text: '№ ' + task.seq }),
            el('div', { class: 'atex-sc-card-text' }, [
                el('span', { class: 'atex-sc-card-info', text: head.join(' · ') })
            ].concat(sub.length ? [el('span', { class: 'atex-sc-card-sub', text: sub.join(' · ') })] : []))
        ]);
        card.appendChild(main);

        var actions = el('div', { class: 'atex-sc-card-actions' });
        if (!terminal) {
            var doneBtn = el('button', { class: 'atex-sc-btn atex-sc-btn-advance', type: 'button', text: '✓ Готово' });
            doneBtn.addEventListener('click', function() { self.markTaskDone(task); });
            var skipBtn = el('button', { class: 'atex-sc-btn', type: 'button', text: 'Пропустить' });
            skipBtn.addEventListener('click', function() { self.skipTask(task); });
            actions.appendChild(doneBtn);
            actions.appendChild(skipBtn);
        }
        card.appendChild(actions);
        // #4786 п.2/п.3: у ЖИВОГО задания бейджа статуса больше нет — состояние и так видно
        // по кнопкам «Готово»/«Пропустить». Справа стои́т ПЛАНОВОЕ количество втулок
        // («К-во»), а у закрытого задания перед ним — бейдж «Готово»/«Пропущена»: кнопок
        // там нет, и иначе непонятно, чем оно кончилось.
        var badges = el('div', { class: 'atex-sc-card-badges' });
        if (terminal) {
            badges.appendChild(el('span', {
                class: 'atex-sc-badge' + (core.isDone(task.status) ? ' atex-sc-badge-done' : ''),
                text: task.status
            }));
        }
        var plan = core.toNumber(task.planQty);
        if (plan > 0) {
            badges.appendChild(el('span', {
                class: 'atex-sc-badge atex-sc-badge-qty',
                title: 'Запланировано втулок: ' + plan + ' шт'
                    + (sticks != null ? ' (метровых заготовок под них: ' + sticks + ')' : ''),
                text: 'К-во: ' + plan
            }));
        }
        if (badges.childNodes.length) card.appendChild(badges);
        return card;
    };

    // ── Действия по заданию (только «Закончено»/«Кол-во факт»; в партию не пишем) ──

    // Завершить задание: пишем «Закончено» = сейчас. Для «Готово» — ещё и
    // «Кол-во факт» = «Кол-во» (план). Для «Пропустить» факт не трогаем (остаётся
    // пустым/0 → статус выводится как «Пропущена»). Обновляет задание в памяти.
    AtexSleeveCutter.prototype.writeCompletion = function(task, withFact) {
        if (!task || !task.id) return Promise.resolve();
        var meta = this.meta.task;
        var fields = {};
        var nowUnix = Math.floor(Date.now() / 1000);
        var finRid = core.reqIdByName(meta, TASK_REQ.finished);
        if (finRid) fields['t' + finRid] = nowUnix;
        var planVal = core.toNumber(task.planQty);
        if (withFact && planVal > 0) {
            var factRid = core.reqIdByName(meta, TASK_REQ.factQty);
            if (factRid) fields['t' + factRid] = planVal;
        }
        return this.post('_m_set/' + task.id + '?JSON', fields).then(function() {
            task.finished = nowUnix;
            if (withFact && planVal > 0) task.factQty = planVal;
            task.status = core.statusFromFields(task);
        });
    };

    AtexSleeveCutter.prototype.markTaskDone = function(task) {
        var self = this;
        if (this.busy) return;
        this.setBusy(true);
        this.writeCompletion(task, true).then(function() {
            self.setBusy(false);
            self.notify('Задание отмечено «Готово»', 'success');
            self.render();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка: ' + err.message, 'error');
        });
    };

    AtexSleeveCutter.prototype.skipTask = function(task) {
        var self = this;
        if (this.busy) return;
        this.setBusy(true);
        this.writeCompletion(task, false).then(function() {
            self.setBusy(false);
            self.notify('Задание пропущено', 'info');
            self.render();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка: ' + err.message, 'error');
        });
    };

    // «Закрыть все» — пометить все незавершённые задания «Готово» (с подтверждением);
    // последовательная запись, затем перерисовка.
    AtexSleeveCutter.prototype.closeAll = function() {
        var self = this;
        if (this.busy) return;
        // Закрываем все незавершённые задания дня — независимо от того, что сейчас показано.
        var pending = this.dayTasks().filter(function(t) { return !core.isTerminal(t.status) && t.id; });
        if (!pending.length) { this.notify('Нет незавершённых заданий', 'info'); return; }
        this.confirmModal('Отметить все ' + pending.length + ' заданий «Готово»?', function() {
            self.setBusy(true);
            var chain = Promise.resolve();
            pending.forEach(function(t) { chain = chain.then(function() { return self.writeCompletion(t, true); }); });
            chain.then(function() {
                self.setBusy(false);
                self.notify('Все задания отмечены «Готово»', 'success');
                self.render();
            }).catch(function(err) {
                self.setBusy(false);
                self.notify('Ошибка: ' + err.message, 'error');
                self.render();
            });
        });
    };

    // Подтверждение без confirm() — встроенная модалка (как в слиттере).
    AtexSleeveCutter.prototype.confirmModal = function(message, onYes) {
        var overlay = el('div', { class: 'atex-sc-confirm-overlay' });
        var yes = el('button', { class: 'atex-sc-btn atex-sc-btn-primary', type: 'button', text: 'Да' });
        var no = el('button', { class: 'atex-sc-btn', type: 'button', text: 'Отмена' });
        function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
        yes.addEventListener('click', function() { close(); onYes(); });
        no.addEventListener('click', close);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
        overlay.appendChild(el('div', { class: 'atex-sc-confirm' }, [
            el('div', { class: 'atex-sc-confirm-msg', text: message }),
            el('div', { class: 'atex-sc-confirm-actions' }, [no, yes])
        ]));
        (this.root || document.body).appendChild(overlay);
    };

    AtexSleeveCutter.prototype.setBusy = function(on) {
        this.busy = on;
        if (this.root) this.root.classList.toggle('is-busy', !!on);
    };

    // Уведомления без alert/confirm/prompt (раздел 8 гайда): встроенный тост,
    // либо общий MainAppController, если он доступен в main.html.
    AtexSleeveCutter.prototype.notify = function(message, kind) {
        if (kind === 'error' && typeof window !== 'undefined' && window.mainAppController &&
            typeof window.mainAppController.showErrorModal === 'function') {
            window.mainAppController.showErrorModal(message);
            return;
        }
        var toast = el('div', { class: 'atex-sc-toast atex-sc-toast-' + (kind || 'info'), text: message });
        (this.toastHost || document.body).appendChild(toast);
        setTimeout(function() { toast.classList.add('is-visible'); }, 10);
        setTimeout(function() {
            toast.classList.remove('is-visible');
            setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
        }, 3500);
    };

    AtexSleeveCutter.prototype.fatal = function(message) {
        this.root.innerHTML = '';
        this.root.appendChild(el('div', { class: 'atex-sc-fatal', text: message }));
    };

    AtexSleeveCutter.prototype.start = function() {
        var self = this;
        this.root.innerHTML = '';
        // Сверху — тулбар (втулкорез + дата + «Закрыть все»), ниже — список заданий.
        var layout = el('div', { class: 'atex-sc-layout' });
        this.toolbarEl = el('div', { class: 'atex-sc-toolbar' });
        this.tasksEl = el('section', { class: 'atex-sc-main' });
        layout.appendChild(this.toolbarEl);
        layout.appendChild(this.tasksEl);
        this.root.appendChild(layout);
        this.toastHost = this.root;

        this.tasksEl.appendChild(el('div', { class: 'atex-sc-placeholder', text: 'Загрузка данных…' }));

        return this.loadMetadata()
            .then(function() { return self.loadCutters(); })
            .then(function() {
                self.restoreCutter();
                self.restoreDate();
                self.restoreShowDone();
                return self.loadTasks();
            })
            .then(function() { self.render(); })
            .catch(function(err) { self.fatal('Ошибка инициализации: ' + err.message); });
    };

    function init() {
        if (typeof document === 'undefined') return;
        var root = document.getElementById('atex-sleeve-cutter');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        var controller = new AtexSleeveCutter(root);
        root._atexSleeveCutter = controller;
        controller.start();
    }

    return { core: core, Controller: AtexSleeveCutter, init: init };
});
