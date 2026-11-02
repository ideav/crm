// Рабочее место atex «Пульт высечки» (Оператор, планшет; ideav/crm#5326, шаг 8 Фазы 2).
//
// Оператор выбирает станок высечки и видит очередь его заданий и текущее задание: позицию
// заказа, сырьё (мастер-рулон и его остаток) и оснастку (нож, вал), план и факт съёмов.
//   - «Съём выполнен» / «Съёмы пачкой» — на каждый съём движение пробега ножа («вырубка»,
//     метры съёма, задание, оператор) и партия ГП этикетки в упаковку; затем остаток
//     мастер-рулона и «Съёмов факт» задания. Первый съём ставит заданию «В работе»;
//   - «Смена ножа» / «Смена вала» — событие смены высечки («старое → новое») и новая
//     оснастка в задании; ножи — того же размера этикетки, валы — не больше «Макс. вала» станка;
//   - «Брак» — событие «Брак» с фото и примечанием;
//   - «Чек-лист ИТС» — отметки пунктов справочника «Пункт чек-листа ИТС» в задании;
//   - «Вызов ИТС» — запись «Вызов ИТС» (станок, задание, оператор, причина, статус «открыт»);
//   - «Готово» — статус задания «Выполнено»;
//   - «Открыть смену» / «Закрыть смену» — события «Начало смены»/«Конец смены» станка (#5330);
//     при закрытой смене задания видно, но пишущих кнопок нет;
//   - «Наладка» / «Наладка завершена» — наладка задания событиями; её начинают и смена ножа
//     или вала, минуты пишутся в «Наладка завершена», незакрытую наладку закрывает съём (#5330).
//   - «Простой» — событие «Простой» с длительностью в минутах (числовое поле «Длительность, мин»);
//   - «Смена мастер-рулона» — выбор следующего рулона: пишется в задание, резерв рулона и событие (#5339);
//     без мастер-рулона съём не открывается молча: пульт берёт рулон, зарезервированный под задание
//     (ссылка «Задание высечки» у рулона), иначе предлагает выбрать рулон или явно продолжить без него.
//     Время на смену рулона не нормируется — входит в вырубку.
// Партия ГП за съём: ручьи ножа × floor(метраж съёма / длина ролика) (#5339).
// «Событие смены высечки» — самостоятельная таблица со ссылками на задание и станок.
// Пробег меняется только движением, привязанным к съёму (§1.1 состава решения). Счётчик
// съёмов — движения «вырубка» задания (отчёт die_cutter_runs): если запись оборвалась,
// следующее действие дописывает недостающие партии ГП, остаток рулона и «Съёмов факт», а
// движений не дублирует. Время событий — серверное (заголовок Date), часы планшета не берутся.
// Таблицы резолвятся по именам из /metadata (label-production.js и ITS_TABLES ниже).

(function(root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') {
        window.AtexDieCutter = api;
        var start = function() {
            var el = document.getElementById('atex-dc-app');
            if (el && !el.__atexDc) el.__atexDc = new api.AtexDieCutter(el).start();
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
        else start();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
    'use strict';

    var LP = (root && root.AtexLabelProduction) || (typeof require === 'function' ? require('../../atex/js/label-production.js') : null);
    var lp = LP ? LP.core : null;

    var JOB_STATUS = { PLANNED: 'Запланировано', RUNNING: 'В работе', DONE: 'Выполнено' };
    var CALL_STATUS = { OPEN: 'открыт', TAKEN: 'принят', CLOSED: 'закрыт' };
    var EVENT = {
        CYLINDER: 'Смена вала', DIE: 'Смена ножа', ROLL: 'Смена мастер-рулона', SCRAP: 'Брак', IDLE: 'Простой',
        // #5330: смена станка — как «Начало смены»/«Конец смены» Фазы 1; наладка — событиями.
        SHIFT_START: 'Начало смены', SHIFT_END: 'Конец смены', SETUP: 'Наладка', SETUP_DONE: 'Наладка завершена'
    };
    // Наладку начинают смена оснастки и кнопка «Наладка», заканчивает «Наладка завершена».
    var SETUP_STARTS = [EVENT.DIE, EVENT.CYLINDER, EVENT.SETUP];
    // Действия пульта, которые пишут данные: при закрытой смене их нет (#5330).
    var WRITE_ACTIONS = ['pull', 'pulls', 'sync', 'die', 'cylinder', 'roll', 'idle', 'setup', 'setupDone', 'scrap', 'checklist', 'call', 'done'];
    // Допуск формата мастер-рулона над минимальным форматом ножа, мм (настройка JUMBO_FORMAT_TOLERANCE_MM склада).
    var FORMAT_TOLERANCE_MM = 15;
    var ROLL_OFF = ['израсходован', 'брак', 'списан'];
    var GP_STATUS_NEW = 'к упаковке';
    var ROLL_STATUS = { OPENED: 'початый', USED: 'израсходован' };
    var DIE_STATE_OFF = ['списан'];
    // Ресурс ножа без марки (настройка DIE_RESOURCE_DEFAULT_M; то же умолчание у планирования высечки).
    var RESOURCE_KEY = 'DIE_RESOURCE_DEFAULT_M';
    var RESOURCE_DEFAULT_M = 300000;
    var MAX_BATCH = 50;

    // Таблицы ИТС пульта (docs/atex_p2_die_cutter_schema_5326.json).
    var ITS_TABLES = {
        checkItem: { name: 'Пункт чек-листа ИТС', reqs: {} },
        checkMark: { name: 'Отметка чек-листа ИТС', reqs: { item: 'Пункт чек-листа ИТС', operator: 'Оператор' } },
        itsCall: { name: 'Вызов ИТС', reqs: {
            machine: 'Станок высечки', job: 'Задание высечки', operator: 'Оператор',
            reason: 'Причина', status: 'Статус вызова ИТС'
        } }
    };

    function norm(s) {
        return String(s == null ? '' : s).replace(/^\s*\d+:/, '').trim().toLowerCase();
    }

    function num(v) {
        var n = Number(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
        return isFinite(n) ? n : 0;
    }

    function round1(n) { return Math.round(n * 10) / 10; }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // Ответ object/{t}/?JSON_KV → [{ id, val, up, reqs }] (главные значения — в `object[]`).
    function kvRecords(json) {
        var reqs = (json && json.reqs) || {};
        return ((json && json.object) || []).map(function(o) {
            return { id: String(o.id), val: o.val == null ? '' : String(o.val), up: String(o.up == null ? '' : o.up), reqs: reqs[o.id] || {} };
        });
    }

    function reqVal(rec, reqId) {
        var v = rec && rec.reqs && reqId ? rec.reqs[reqId] : null;
        return v == null ? '' : String(v);
    }

    // id записей по ссылке: `ref_{reqId}` = «таблица:id,id».
    function refIds(rec, reqId) {
        var raw = rec && rec.reqs && reqId ? rec.reqs['ref_' + reqId] : null;
        if (raw == null || String(raw).trim() === '') return [];
        return String(raw).replace(/^\s*\d+:/, '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    }

    function refId(rec, reqId) { return refIds(rec, reqId)[0] || ''; }

    // Таблицы ИТС по метаданным (поиск — как resolveProductionTables: псевдоним, затем имя).
    function aliasOf(e) {
        if (!e) return '';
        if (e.field_attrs && e.field_attrs.alias) return String(e.field_attrs.alias);
        if (e.alias) return String(e.alias);
        if (e.attrs) { try { var a = JSON.parse(e.attrs); if (a && a.alias) return String(a.alias); } catch (x) { /* не JSON */ } }
        return '';
    }
    function findByName(list, name) {
        var t = norm(name);
        var arr = Array.isArray(list) ? list : [];
        for (var i = 0; i < arr.length; i++) if (norm(aliasOf(arr[i])) === t) return arr[i];
        for (var j = 0; j < arr.length; j++) if (norm(arr[j] && arr[j].val) === t) return arr[j];
        return null;
    }
    // Колонка «Оператор» — ссылка на «Пользователь» под псевдонимом; без псевдонима — по имени типа.
    var REQ_FALLBACK = { 'Оператор': 'Пользователь' };
    function resolveItsTables(metadata) {
        var meta = Array.isArray(metadata) ? metadata : [];
        var tables = {}, missing = [];
        Object.keys(ITS_TABLES).forEach(function(key) {
            var spec = ITS_TABLES[key];
            var t = findByName(meta, spec.name);
            if (!t) { missing.push(spec.name); return; }
            var reqs = {};
            Object.keys(spec.reqs).forEach(function(rk) {
                var name = spec.reqs[rk];
                var r = findByName(t.reqs, name) || (REQ_FALLBACK[name] ? findByName(t.reqs, REQ_FALLBACK[name]) : null);
                if (r) reqs[rk] = String(r.id); else missing.push(spec.name + ' → ' + name);
            });
            tables[key] = { id: String(t.id), name: spec.name, reqs: reqs };
        });
        return { tables: tables, missing: missing };
    }

    // Строки отчёта die_cutter_jobs → задания высечки.
    function jobsFromReport(rows) {
        return (rows || []).map(function(r) {
            return {
                id: String(r.job_id || ''),
                start: num(r.job_start),
                status: String(r.job_status || ''),
                pullsPlan: num(r.pulls_plan),
                pullsFact: num(r.pulls_fact),
                footage: num(r.footage),
                setup: num(r.setup),
                machineId: String(r.machine_id || ''),
                machine: String(r.machine || ''),
                dieId: String(r.die_id || ''),
                dieNo: String(r.die_no || ''),
                streams: num(r.die_streams),
                cylinderId: String(r.cylinder_id || ''),
                cylinder: String(r.cylinder || ''),
                rollId: String(r.master_roll_id || ''),
                roll: String(r.master_roll || ''),
                rollLength: num(r.roll_length),
                rollRest: String(r.roll_rest == null ? '' : r.roll_rest),
                rollFormat: num(r.roll_format),
                positionId: String(r.position_id || ''),
                order: String(r.order_no || ''),
                labelWidth: num(r.label_width),
                labelLength: num(r.label_length),
                labelsPerRoll: num(r.labels_per_roll),
                material: String(r.material || '')
            };
        }).filter(function(j) { return j.id !== ''; });
    }

    // Строки отчёта die_cutter_runs → движения пробега всех ножей.
    function runsFromReport(rows) {
        return (rows || []).map(function(r) {
            return { id: String(r.run_id || ''), date: num(r.run_date), meters: num(r.meters), kind: String(r.kind || ''), jobId: String(r.job_id || ''), dieId: String(r.die_id || '') };
        }).filter(function(r) { return r.id !== ''; });
    }

    function isDone(status) { return norm(status) === norm(JOB_STATUS.DONE); }

    // Очередь станка: незакрытые задания по план-старту; закрытые сегодня — в конце списка.
    function machineQueue(jobs, machineId, dayStart) {
        var mine = (jobs || []).filter(function(j) { return machineId && j.machineId === machineId; });
        var open = mine.filter(function(j) { return !isDone(j.status); }).sort(function(a, b) { return a.start - b.start || Number(a.id) - Number(b.id); });
        var doneToday = mine.filter(function(j) { return isDone(j.status) && j.start >= (dayStart || 0); }).sort(function(a, b) { return a.start - b.start; });
        var running = open.filter(function(j) { return norm(j.status) === norm(JOB_STATUS.RUNNING); })[0];
        var current = running || open[0] || null;
        var next = open.filter(function(j) { return j !== current; })[0] || null;
        return { open: open, doneToday: doneToday, current: current, next: next };
    }

    // Метры одного съёма: метраж задания / план съёмов.
    function metersPerPull(job) {
        return job && job.pullsPlan > 0 && job.footage > 0 ? round1(job.footage / job.pullsPlan) : 0;
    }

    function cutRuns(runs, jobId) {
        return (runs || []).filter(function(r) { return r.jobId === jobId && lp.runKindOf(r.kind) === lp.RUN_KIND.CUT; });
    }

    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function gpName(jobId, k) { return 'ГПЭ-' + jobId + '-' + pad2(k); }

    // Остаток мастер-рулона после съёмов: текущий остаток минус метры новых съёмов, не ниже
    // нуля. Остаток рулона меняют и другие рабочие места (склад мастер-рулонов), поэтому он
    // не пересчитывается заново от длины. Остаток не задан — null: вычитать не из чего.
    function rollRest(job, extraMeters) {
        if (!job || !job.rollId || String(job.rollRest).trim() === '') return null;
        return Math.max(0, round1(num(job.rollRest) - (num(extraMeters) || 0)));
    }

    // Прогресс задания: съёмы = движения «вырубка» задания; хвосты — то, что после съёма не
    // дописалось (партии ГП, «Съёмов факт»).
    // gps — [{ id, val, jobId }] партий ГП этикетки.
    function jobProgress(job, runs, gps) {
        var done = cutRuns(runs, job.id).length;
        var names = {};
        (gps || []).forEach(function(g) { if (g.jobId === job.id) names[g.val] = true; });
        var gpMissing = [];
        for (var k = 1; k <= done; k++) if (!names[gpName(job.id, k)]) gpMissing.push(k);
        return {
            done: done,
            plan: job.pullsPlan,
            left: Math.max(0, job.pullsPlan - done),
            gpMissing: gpMissing,
            factStale: job.pullsFact !== done,
            complete: job.pullsPlan > 0 && done >= job.pullsPlan
        };
    }

    // Длина одного ролика, м: этикеток в рулоне × шаг этикетки (раппорт вала / этикеток на раппорте) / 1000.
    // Нет любого из трёх чисел — 0 (данных нет).
    function rollLengthM(labelsPerRoll, repeatMm, labelsPerRepeat) {
        var n = num(labelsPerRoll), r = num(repeatMm), p = num(labelsPerRepeat);
        return n > 0 && r > 0 && p > 0 ? Math.round(n * (r / p) / 1000 * 100) / 100 : 0;
    }

    // Длина ролика задания: раппорт вала задания (нет — вала ножа), этикеток на раппорте — у ножа.
    function jobRollLength(job, dies, cylinders) {
        var die = (dies || []).filter(function(d) { return d.id === job.dieId; })[0];
        var cylId = job.cylinderId || (die && die.cylinderId) || '';
        var cyl = (cylinders || []).filter(function(c) { return c.id === cylId; })[0];
        return rollLengthM(job.labelsPerRoll, cyl && cyl.repeat, die && die.labelsPerRepeat);
    }

    // Рулонов в партии ГП за съём метражом `meters`: ручьи × floor(метраж / длина ролика).
    // Нет длины ролика или метраж меньше ролика — прежнее число (ручьи) и предупреждение.
    function rollsPerPull(job, meters) {
        var streams = job.streams > 0 ? job.streams : 1;
        var len = num(job.rollLenM), m = num(meters);
        if (!(len > 0)) return { rolls: streams, warn: 'нет данных для расчёта рулонов по метражу (раппорт вала, этикеток на раппорте или в рулоне) — в партию ГП записано по числу ручьёв' };
        if (!(m > 0)) return { rolls: streams, warn: 'метраж съёма не задан — в партию ГП записано по числу ручьёв' };
        var n = Math.floor(m / len + 1e-9);
        if (n < 1) return { rolls: streams, warn: 'метраж съёма ' + fmtM(m) + ' м меньше ролика ' + fmtM(len) + ' м — в партию ГП записано по числу ручьёв' };
        return { rolls: streams * n, warn: '' };
    }

    // План записи n съёмов (n = 0 — только дописать хвосты).
    // → { ok, runs: [метры], gps: [{ k, name, rolls }], fact, status, rest } | { ok: false, error }.
    function takeoffPlan(job, jobs, runs, gps, n, meters) {
        n = Math.floor(num(n));
        var m = num(meters);
        if (n < 0 || n > MAX_BATCH) return { ok: false, error: 'число съёмов — от 1 до ' + MAX_BATCH };
        if (n > 0 && !(m > 0)) return { ok: false, error: 'метраж съёма должен быть больше нуля' };
        if (n > 0 && !job.dieId) return { ok: false, error: 'в задании не указан нож — пробег некуда записать' };
        if (isDone(job.status)) return { ok: false, error: 'задание уже выполнено' };
        var pr = jobProgress(job, runs, gps);
        var runsNew = [];
        for (var i = 0; i < n; i++) runsNew.push(m);
        var total = pr.done + n;
        var gpsNew = pr.gpMissing.slice();
        for (var k = pr.done + 1; k <= total; k++) gpsNew.push(k);
        // Рулонов партии — от метража СВОЕГО съёма: записанные раньше — по их движению пробега.
        var written = cutRuns(runs, job.id);
        var warnings = [];
        var gpList = gpsNew.map(function(k) {
            var mk = k <= pr.done && written[k - 1] && written[k - 1].meters > 0 ? written[k - 1].meters : (m > 0 ? m : metersPerPull(job));
            var rp = rollsPerPull(job, mk);
            if (rp.warn && warnings.indexOf(rp.warn) < 0) warnings.push(rp.warn);
            return { k: k, name: gpName(job.id, k), rolls: rp.rolls };
        });
        return {
            ok: true,
            runs: runsNew,
            gps: gpList,
            warnings: warnings,
            fact: total,
            status: norm(job.status) === norm(JOB_STATUS.RUNNING) ? '' : JOB_STATUS.RUNNING,
            rest: n > 0 ? rollRest(job, m * n) : null
        };
    }

    // Пробег ножа: всего (dieMileage) и за смену — с начала суток по серверу.
    function dieMileageNow(dieId, runs, dayStart) {
        var mine = (runs || []).filter(function(r) { return r.dieId === dieId; });
        var total = lp.dieMileage(mine);
        var today = 0;
        mine.forEach(function(r) { if (r.date >= dayStart && lp.runKindOf(r.kind) === lp.RUN_KIND.CUT) today += r.meters; });
        return { meters: total.meters, today: round1(today), start: round1(total.meters - today), errors: total.errors };
    }

    // Сколько метров задания ещё вырубить: метраж задания − движения «вырубка» по заданию.
    function jobRemainingMeters(job, runs) {
        var cut = 0;
        cutRuns(runs, job && job.id).forEach(function(r) { cut += num(r.meters); });
        return Math.max(0, round1(num(job && job.footage) - cut));
    }

    // #5366: у предела ресурса нож может перестать выбивать все этикетки — оператору
    // предупреждение. meters — пробег сейчас, remaining — оставшийся метраж задания,
    // resource — ресурс ножа, м. Уровни — dieWearLevel (от 90 % — «у ресурса», от 100 % —
    // «выработан»); «у ресурса» ставится и тогда, когда до 90 % пробег дойдёт за это задание.
    // → null | { level: 'near' | 'over', share (% сейчас), after (% после задания), text }.
    function dieWearNotice(meters, remaining, resource) {
        var res = num(resource);
        if (!(res > 0)) return null;
        var m = num(meters), end = m + Math.max(0, num(remaining));
        var now = lp.dieWearLevel(m, res), then = lp.dieWearLevel(end, res);
        var pct = function(x) { return Math.floor(x / res * 100); };
        var head = 'пробег ' + fmtM(m) + ' м — ' + pct(m) + ' % ресурса (' + fmtM(res) + ' м)';
        var after = end > m ? '; после задания станет ' + fmtM(end) + ' м — ' + pct(end) + ' %' : '';
        if (now === 'over') {
            return { level: 'over', share: pct(m), after: pct(end), text: 'Нож выработал ресурс: ' + head + after +
                '. Будьте внимательнее: нож может выбивать не все этикетки — проверяйте вырубку на каждом съёме; если не выбивает — «Брак» и вызов ИТС.' };
        }
        if (now === 'near' || then === 'near' || then === 'over') {
            return { level: 'near', share: pct(m), after: pct(end), text: 'Нож у предела ресурса: ' + head + after +
                '. Будьте внимательнее: нож может перестать выбивать все этикетки — проверяйте вырубку на каждом съёме.' };
        }
        return null;
    }

    // Плашку ресурса оператор скрывает на заказ (владелец, #5366): ключ — заказ задания (без
    // заказа — задание) и нож; другой заказ или смена ножа показывают плашку снова.
    function wearHideKey(job) {
        if (!job) return '';
        return (job.order ? 'o' + job.order : 'j' + job.id) + ':' + (job.dieId || '');
    }
    var WEAR_HIDDEN_KEY = 'atex-dc-wear-hidden';
    var WEAR_HIDDEN_MAX = 200;
    function wearHidden() {
        try { var a = JSON.parse(window.localStorage.getItem(WEAR_HIDDEN_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    }
    function hideWear(job) {
        var k = wearHideKey(job), a = wearHidden().filter(function(x) { return x !== k; });
        a.push(k);
        try { window.localStorage.setItem(WEAR_HIDDEN_KEY, JSON.stringify(a.slice(-WEAR_HIDDEN_MAX))); } catch (e) { /* хранилище недоступно */ }
    }

    // Значение настройки: строка с типом базы важнее строки «ATEH», та — важнее общей
    // (порядок loadDaySettings планирования). recs — [{ key, type, value }].
    function settingValue(recs, key, db) {
        var dbKey = String(db || '').trim().toUpperCase(), best = '', rank = 0;
        (recs || []).forEach(function(r) {
            var v = String(r.value == null ? '' : r.value).trim();
            if (String(r.key || '').replace(/^﻿/, '').trim() !== key || v === '') return;
            var type = String(r.type || '').trim().toUpperCase();
            var k = dbKey && type === dbKey ? 3 : (type === 'ATEH' ? 2 : 1);
            if (k >= rank) { best = v; rank = k; }
        });
        return best;
    }

    // Ножи для смены: того же размера этикетки, кроме текущего и списанных.
    // dies — [{ id, val, width, length, state, cylinderId }].
    function compatibleDies(job, dies) {
        return (dies || []).filter(function(d) {
            return d.id !== job.dieId && DIE_STATE_OFF.indexOf(norm(d.state)) < 0 &&
                (!(job.labelWidth > 0) || d.width === job.labelWidth) && (!(job.labelLength > 0) || d.length === job.labelLength);
        });
    }

    // Валы для смены: не больше «Макс. вала» станка (пусто или 0 — любой), кроме текущего (#5366).
    function compatibleCylinders(job, cylinders, machine) {
        var max = num(machine && machine.maxCylinder);
        return (cylinders || []).filter(function(c) {
            return c.id !== job.cylinderId && !(max > 0 && num(c.val) > max);
        });
    }

    function changeNote(from, to) { return (from || '—') + ' → ' + (to || '—'); }

    // Чек-лист задания: пункты справочника и последние отметки по ним.
    // items — [{ id, val }], marks — [{ id, date, itemId, operator }].
    function checklist(items, marks) {
        var last = {};
        (marks || []).forEach(function(m) { if (!last[m.itemId] || m.date > last[m.itemId].date) last[m.itemId] = m; });
        var rows = (items || []).map(function(it) {
            var m = last[it.id];
            return { id: it.id, name: it.val, checked: !!m, at: m ? m.date : 0, operator: m ? m.operator : '' };
        });
        return { rows: rows, complete: rows.length > 0 && rows.every(function(r) { return r.checked; }) };
    }

    // ── Мастер-рулон задания (#5339) ─────────────────────────────────────────

    function rollUsable(r) {
        return ROLL_OFF.indexOf(norm(r.status)) < 0 && num(r.rest) > 0;
    }

    // Задание без «Мастер-рулон» берёт рулон, зарезервированный под него (ссылка «Задание высечки»
    // у рулона); при нескольких — младший по id. Остальные поля рулона берутся из него, rollSource
    // = 'reserve' — при первой записи рулон запишется и в задание.
    // rolls — [{ id, no, format, length, rest, status, reserveTaskId }].
    function applyReservedRolls(jobs, rolls) {
        return (jobs || []).map(function(j) {
            if (j.rollId) return j;
            var mine = (rolls || []).filter(function(r) { return r.reserveTaskId === j.id && rollUsable(r); })
                .sort(function(a, b) { return num(a.id) - num(b.id); });
            if (!mine.length) return j;
            var r = mine[0], o = {};
            Object.keys(j).forEach(function(k) { o[k] = j[k]; });
            o.rollId = r.id; o.roll = r.no; o.rollLength = num(r.length); o.rollRest = String(r.rest); o.rollFormat = num(r.format);
            o.rollSource = 'reserve';
            return o;
        });
    }

    function needsRoll(job) { return !job || !job.rollId; }

    // Рулоны для выбора: свои резервы, затем свободные того же сырья и формата в [мин, мин + допуск] ножа
    // (у ножа нет минимального формата — формат не фильтруется); чужие резервы, пустые, брак и текущий — нет.
    function rollCandidates(job, rolls, die, tolerance) {
        var min = num(die && die.minFormat), tol = tolerance == null ? FORMAT_TOLERANCE_MM : num(tolerance);
        return (rolls || []).filter(function(r) {
            if (r.id === job.rollId || !rollUsable(r)) return false;
            if (r.reserveTaskId && r.reserveTaskId !== job.id) return false;
            if (r.reserveTaskId === job.id) return true;
            if (job.material && r.material && norm(job.material) !== norm(r.material)) return false;
            return !(min > 0) || (num(r.format) >= min && num(r.format) <= min + tol);
        }).sort(function(a, b) {
            var ra = a.reserveTaskId === job.id ? 0 : 1, rb = b.reserveTaskId === job.id ? 0 : 1;
            return ra - rb || num(a.format) - num(b.format) || num(a.id) - num(b.id);
        });
    }

    // Поля записи выбора рулона: { job: поля задания, roll: поля рулона }.
    function rollAssignFields(t, job, roll) {
        var f = { job: {}, roll: {} };
        var jr = (t.dieJob && t.dieJob.reqs) || {}, rr = (t.masterRoll && t.masterRoll.reqs) || {};
        if (jr.masterRoll) f.job['t' + jr.masterRoll] = String(roll.id);
        if (rr.reserveTask) f.roll['t' + rr.reserveTask] = String(job.id);
        return f;
    }

    // Простой (#5339): минуты — целые, мусор и ноль → 0.
    function idleMinutes(v) { return Math.max(0, Math.round(num(v))); }

    // Простой задания — сумма «Длительности» событий «Простой». events — [{ jobId, type, duration }].
    function idleState(events, jobId) {
        var sum = 0;
        (events || []).forEach(function(e) { if (jobId && e.jobId === jobId && isType(e, EVENT.IDLE)) sum += num(e.duration); });
        return { minutes: sum };
    }

    // Строка «Партия ГП: N рул.» для окна съёма; предупреждение — если считать по метражу нечем.
    function rollsInfo(job, meters) {
        var rp = rollsPerPull(job, meters);
        return 'Партия ГП на съём: ' + rp.rolls + ' рул.' + (rp.warn ? ' (' + rp.warn + ')' : '');
    }

    // Пункты, которые надо отметить: выбраны и ещё не отмечены.
    function checklistToMark(list, pickedIds) {
        var picked = {};
        (pickedIds || []).forEach(function(id) { picked[String(id)] = true; });
        return list.rows.filter(function(r) { return picked[r.id] && !r.checked; }).map(function(r) { return r.id; });
    }

    // Незакрытые вызовы ИТС станка. calls — [{ id, date, machineId, status, reason }].
    function openCalls(calls, machineId) {
        return (calls || []).filter(function(c) { return c.machineId === machineId && norm(c.status) !== norm(CALL_STATUS.CLOSED); })
            .sort(function(a, b) { return b.date - a.date; });
    }

    function isType(e, label) { return norm(e && e.type) === norm(label); }

    // Хронология событий: время, при равном — id записи.
    function byTime(a, b) { return a.date - b.date || Number(a.id) - Number(b.id); }

    // Смена станка (#5330, как hasOpenShift Фазы 1): открыта, если последнее из событий
    // «Начало смены»/«Конец смены» этого станка — «Начало смены». День и оператор не важны:
    // смена принадлежит станку. events — [{ id, date, type, machineId }].
    function shiftState(events, machineId) {
        var mine = (events || []).filter(function(e) {
            return machineId && e.machineId === machineId && (isType(e, EVENT.SHIFT_START) || isType(e, EVENT.SHIFT_END));
        }).sort(byTime);
        var last = mine[mine.length - 1];
        var open = !!last && isType(last, EVENT.SHIFT_START);
        return { open: open, since: open ? last.date : 0 };
    }

    // Наладка задания (#5330): начинается сменой ножа/вала или «Наладкой», заканчивается
    // «Наладкой завершена»; повторная смена оснастки во время наладки её начало не сдвигает.
    // Факт — сумма минут «Наладка завершена» задания. events — [{ id, date, type, jobId, minutes }].
    function setupState(events, jobId) {
        var open = false, since = 0, fact = 0;
        (events || []).filter(function(e) { return jobId && e.jobId === jobId; }).sort(byTime).forEach(function(e) {
            if (isType(e, EVENT.SETUP_DONE)) { open = false; since = 0; fact += num(e.minutes); return; }
            if (!open && SETUP_STARTS.some(function(t) { return isType(e, t); })) { open = true; since = e.date; }
        });
        return { open: open, since: since, fact: round1(fact) };
    }

    // Минуты наладки по серверному времени, целые (поле NUMBER — целое, как «Наладка, мин»);
    // время назад — ноль.
    function setupMinutes(since, now) {
        return Math.max(0, Math.round((num(now) - num(since)) / 60));
    }

    // Незакрытую наладку закрывает первый съём: → { minutes, notes } или null.
    function setupCloseOnPull(events, jobId, now) {
        var st = setupState(events, jobId);
        if (!st.open) return null;
        return { minutes: setupMinutes(st.since, now), notes: 'закрыта съёмом' };
    }

    // Кнопки задания. o — { done, shiftOpen, setupOpen, stale (хвосты съёмов) }.
    // Смена закрыта — задание видно, но пишущих действий нет.
    function jobActions(o) {
        if (!o || !o.shiftOpen) return ['refresh'];
        var acts = [];
        if (!o.done) acts.push('pull', 'pulls', 'die', 'cylinder', 'roll', o.setupOpen ? 'setupDone' : 'setup', 'idle', 'scrap');
        if (o.stale) acts.push('sync');
        acts.push('checklist', 'call');
        if (!o.done) acts.push('done');
        acts.push('refresh');
        return acts;
    }

    // Поля записи «Событие смены высечки» (_m_new, up=1). t — { id, reqs } таблицы событий;
    // o — { now, typeId, userId, notes, jobId, machineId, minutes (наладка), duration (простой) }.
    function eventParams(t, o) {
        var r = (t && t.reqs) || {}, p = {};
        p['t' + t.id] = String(o.now);
        if (r.type && o.typeId) p['t' + r.type] = String(o.typeId);
        if (r.operator && o.userId) p['t' + r.operator] = String(o.userId);
        if (r.notes && o.notes) p['t' + r.notes] = String(o.notes);
        if (r.job && o.jobId) p['t' + r.job] = String(o.jobId);
        if (r.machine && o.machineId) p['t' + r.machine] = String(o.machineId);
        if (r.setupMinutes && o.minutes != null) p['t' + r.setupMinutes] = String(o.minutes);
        if (r.duration && o.duration != null) p['t' + r.duration] = String(o.duration);
        return p;
    }

    // Начало суток по Москве (UTC+3) для серверного unix-времени.
    function moscowDayStart(unix) {
        var t = num(unix) + 3 * 3600;
        return t - (t % 86400) - 3 * 3600;
    }

    function fmtTime(unix, withDate) {
        var t = num(unix);
        if (!(t > 0)) return '—';
        var d = new Date((t + 3 * 3600) * 1000);
        return (withDate ? pad2(d.getUTCDate()) + '.' + pad2(d.getUTCMonth() + 1) + ' ' : '') + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
    }

    function fmtNum(n) {
        return String(Math.round(num(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    }

    // Метраж в одном формате везде: пробел тысяч, до десятых через запятую («1 418», «1 418,5»).
    function fmtM(n) {
        var v = round1(num(n));
        var parts = String(Math.abs(v)).split('.');
        var whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        return (v < 0 ? '-' : '') + whole + (parts[1] ? ',' + parts[1] : '');
    }

    // «Съём 3 из 5»; без «Съёмов план» — «Съём 3» (не «из 0»).
    function pullsCaption(pr, done) {
        var fin = done || pr.complete;
        return (fin ? 'Съёмов <b>' + pr.done + '</b>' : 'Съём <b>' + (pr.done + 1) + '</b>') + (pr.plan > 0 ? ' из ' + pr.plan : '');
    }
    function pullsCount(pr) {
        return 'съёмов ' + pr.done + (pr.plan > 0 ? ' из ' + pr.plan : '');
    }

    // Окно «Закрыть задание?»: «Съёмов 2 из 5. План не выполнен.»; без плана — «Съёмов 3.» (#5355).
    function finishSummary(pr) {
        if (!(pr.plan > 0)) return 'Съёмов ' + pr.done + '.';
        return 'Съёмов ' + pr.done + ' из ' + pr.plan + '.' + (pr.done < pr.plan ? ' <b>План не выполнен.</b>' : '');
    }

    // ── Клиент Integram (браузер) ───────────────────────────────────────────

    function Client(db, xsrf) { this.db = db; this.xsrf = xsrf || ''; }
    Client.prototype.url = function(path) { return '/' + encodeURIComponent(this.db) + '/' + path; };
    Client.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            if (!resp.ok) throw new Error(path + ': HTTP ' + resp.status);
            return resp.json();
        });
    };
    Client.prototype.token = function() { return (typeof window !== 'undefined' && window.xsrf) || this.xsrf; };
    function parseAnswer(resp) {
        return resp.text().then(function(text) {
            var result;
            try { result = JSON.parse(text); } catch (e) { throw new Error('Сервер вернул не JSON: ' + text.slice(0, 200)); }
            var err = result && (result.error || result.err || (Array.isArray(result) && result[0] && result[0].error));
            if (err) throw new Error(err);
            return result;
        });
    }
    Client.prototype.post = function(path, params) {
        var body = new URLSearchParams();
        body.set('_xsrf', this.token());
        Object.keys(params || {}).forEach(function(k) { if (params[k] != null) body.set(k, params[k]); });
        return fetch(this.url(path), {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
        }).then(parseAnswer);
    };
    // Файловый реквизит — multipart с _xsrf и t{reqId}=<File> (паттерн платформы, issue #1310).
    Client.prototype.postFile = function(path, key, file) {
        var fd = new FormData();
        fd.append('_xsrf', this.token());
        fd.append(key, file);
        return fetch(this.url(path), { method: 'POST', credentials: 'same-origin', body: fd }).then(parseAnswer);
    };
    Client.prototype.create = function(tableId, up, fields) {
        return this.post('_m_new/' + tableId + '?JSON&up=' + encodeURIComponent(up || 1), fields).then(function(res) {
            var id = res && (res.id || res.obj);
            if (!id) throw new Error('_m_new/' + tableId + ': нет id записи в ответе');
            return String(id);
        });
    };
    // Серверное «сейчас» — заголовок Date ответа; часы планшета не подставляются.
    Client.prototype.serverNow = function() {
        return fetch(this.url('xsrf?JSON'), { credentials: 'same-origin', cache: 'no-store' }).then(function(resp) {
            var t = Date.parse(String(resp.headers.get('Date') || ''));
            if (!isFinite(t)) throw new Error('сервер не прислал время (заголовок Date)');
            return Math.floor(t / 1000);
        });
    };

    var NEED = ['dieJob', 'dieEvent', 'dieRun', 'die', 'cylinder', 'machine', 'finishedBatch', 'dieEventType', 'runKind'];

    // ── Экран ────────────────────────────────────────────────────────────────

    var MACHINE_KEY = 'atex-dc-machine';

    // Каркас пульта. Корень делит со сторожем планшета (pad-guard.js пишет в него свои
    // экраны), поэтому каркас рисует start(), а не шаблон.
    var SHELL = [
        '<div class="atex-dc-toolbar">',
        '<h1 class="atex-dc-title">Пульт высечки</h1>',
        '<div id="atex-dc-machines"></div>',
        '</div>',
        '<div id="atex-dc-message" class="atex-dc-message" hidden></div>',
        '<div class="atex-dc-pad">',
        '<aside class="atex-dc-panel">',
        '<h2 class="atex-dc-panel-title">Задания станка</h2>',
        '<div id="atex-dc-list"></div>',
        '</aside>',
        '<section id="atex-dc-job" class="atex-dc-panel"></section>',
        '</div>',
        '<div id="atex-dc-modal" class="atex-dc-modal" hidden>',
        '<div class="atex-dc-modal-box" role="dialog" aria-modal="true">',
        '<div id="atex-dc-modal-text"></div>',
        '<div class="atex-dc-modal-actions">',
        '<button id="atex-dc-modal-cancel" class="atex-dc-btn" type="button">Отмена</button>',
        '<button id="atex-dc-modal-ok" class="atex-dc-btn atex-dc-btn-primary" type="button">Подтвердить</button>',
        '</div>',
        '</div>',
        '</div>'
    ].join('');


    // #5330: станок из настройки планшета (pad-guard.js, колонка «Станок высечки»),
    // сведённый со справочником станков: ссылкой по id или по названию. Настройки нет
    // или такого станка нет — пусто, остаётся выбор, запомненный на планшете.
    function padMachineId(machines, pad, guard) {
        var obj = pad && pad.config && pad.config.dieCutter;
        if (!obj || !guard || typeof guard.matchPadObject !== 'function') return '';
        return guard.matchPadObject((machines || []).map(function(m) { return { id: m.id, label: m.val }; }), obj);
    }

    function AtexDieCutter(rootEl) {
        this.root = rootEl;
        this.client = new Client(rootEl.getAttribute('data-db') || '', rootEl.getAttribute('data-xsrf') || '');
        this.userId = rootEl.getAttribute('data-user-id') || '';
        this.state = null;
        this.machineId = '';
        this.selectedId = '';
        this.busy = false;
        this.noRollOk = {};
        try { this.machineId = window.localStorage.getItem(MACHINE_KEY) || ''; } catch (e) { /* хранилище недоступно */ }
    }

    AtexDieCutter.prototype.$ = function(id) { return document.getElementById(id); };

    AtexDieCutter.prototype.message = function(text, kind) {
        var el = this.$('atex-dc-message');
        if (!el) return;
        el.hidden = !text;
        el.className = 'atex-dc-message' + (kind ? ' is-' + kind : '');
        el.textContent = text || '';
    };

    AtexDieCutter.prototype.start = function() {
        var self = this;
        this.root.innerHTML = SHELL;
        this.root.addEventListener('click', function(e) {
            var j = e.target.closest('[data-job-id]');
            if (j) { self.selectedId = j.getAttribute('data-job-id'); self.loadJob().then(function() { self.render(); }); return; }
            var a = e.target.closest('[data-act]');
            if (!a || self.busy) return;
            var act = a.getAttribute('data-act');
            var h = {
                shiftOpen: function() { self.writeShift(true); },
                shiftClose: function() { self.writeShift(false); },
                setup: function() { self.startSetup(); },
                setupDone: function() { self.finishSetup(); },
                pull: function() { self.askPull(1); },
                pulls: function() { self.askPull(0); },
                sync: function() { self.writePulls(self.current(), 0, 0); },
                die: function() { self.askChange('die'); },
                cylinder: function() { self.askChange('cylinder'); },
                roll: function() { self.askRoll(self.current(), null); },
                idle: function() { self.askIdle(); },
                scrap: function() { self.askScrap(); },
                checklist: function() { self.askChecklist(); },
                call: function() { self.askCall(); },
                done: function() { self.finish(); },
                refresh: function() { self.message(''); self.reload(); },
                wearHide: function() { hideWear(self.current()); self.renderJob(); }
            }[act];
            if (h) h();
        });
        // Число рулонов партии ГП пересчитывается при вводе метража съёма.
        this.root.addEventListener('input', function(e) {
            if (!e.target || e.target.getAttribute('data-f') !== 'm') return;
            var info = self.root.querySelector('[data-f="rolls"]'), j = self.current();
            if (info && j) info.textContent = rollsInfo(j, num(e.target.value));
        });
        this.root.addEventListener('change', function(e) {
            if (e.target && e.target.id === 'atex-dc-machine') {
                self.machineId = e.target.value;
                self.selectedId = '';
                try { window.localStorage.setItem(MACHINE_KEY, self.machineId); } catch (x) { /* хранилище недоступно */ }
                self.storePadMachine();
                self.pickCurrent();
                self.loadJob().then(function() { self.render(); });
            }
        });
        this.reload();
        return this;
    };

    AtexDieCutter.prototype.reload = function() {
        var self = this;
        var c = this.client;
        return c.getJson('metadata').then(function(meta) {
            self.meta = meta;
            var res = lp.resolveProductionTables(meta, lp.PRODUCT_KIND.LABEL);
            var lost = NEED.filter(function(k) { return !res.tables[k]; });
            if (lost.length) throw new Error('в базе нет таблиц: ' + lost.map(function(k) { return lp.PRODUCTION_CONFIGS[lp.PRODUCT_KIND.LABEL].tables[k].name; }).join(', '));
            var t = res.tables;
            var its = resolveItsTables(meta);
            var all = function(tid) { return tid ? c.getJson('object/' + tid + '/?JSON_KV&LIMIT=0,100000').then(kvRecords) : Promise.resolve([]); };
            var report = function(name) {
                return c.getJson('report/' + name + '?JSON_KV&LIMIT=0,100000').then(function(rows) {
                    if (!Array.isArray(rows)) throw new Error('нет отчёта ' + name + ' (docs/scripts/apply_die_cutter_5326.py)');
                    return rows;
                });
            };
            return Promise.all([
                report('die_cutter_jobs'), report('die_cutter_runs'), all(t.machine.id), all(t.die.id), all(t.cylinder.id),
                all(t.finishedBatch.id), all(t.dieEventType.id), all(t.runKind.id),
                all(its.tables.checkItem && its.tables.checkItem.id), all(its.tables.itsCall && its.tables.itsCall.id),
                c.serverNow(), all(t.masterRoll && t.masterRoll.id),
                // #5366: ресурс ножа — марка и настройка; прав на чтение нет — ресурс по умолчанию.
                all(t.dieBrand && t.dieBrand.id).catch(function() { return []; }),
                self.loadSettings(meta).catch(function() { return []; })
            ]).then(function(r) {
                var dr = t.die.reqs, gr = t.finishedBatch.reqs;
                // Колонки, которых нет в общем описании таблиц (label-production.js): ищутся по имени.
                var extraReq = function(tb, name) {
                    var meta0 = tb ? (meta || []).filter(function(x) { return String(x.id) === String(tb.id); })[0] : null;
                    var hit = meta0 ? findByName(meta0.reqs, name) : null;
                    return hit ? String(hit.id) : '';
                };
                if (t.dieEvent) t.dieEvent.reqs.duration = extraReq(t.dieEvent, 'Длительность, мин');
                if (t.masterRoll) t.masterRoll.reqs.reserveTask = extraReq(t.masterRoll, 'Задание высечки');
                var rr = (t.masterRoll && t.masterRoll.reqs) || {}, cr = (t.cylinder && t.cylinder.reqs) || {};
                var brandCol = t.dieBrand && t.dieBrand.reqs ? t.dieBrand.reqs.resource : '';
                var brandRes = {};
                r[12].forEach(function(b) { brandRes[b.id] = reqVal(b, brandCol); });
                var defaultRes = settingValue(r[13], RESOURCE_KEY, self.db) || RESOURCE_DEFAULT_M;
                var dies = r[3].map(function(d) {
                    var res = lp.dieResource(brandRes[refId(d, dr.brand)], defaultRes).meters;
                    return { id: d.id, val: d.val, width: num(reqVal(d, dr.labelWidth)), length: num(reqVal(d, dr.labelLength)), state: reqVal(d, dr.state), cylinderId: refId(d, dr.cylinder), labelsPerRepeat: num(reqVal(d, dr.labelsPerRepeat)), minFormat: num(reqVal(d, dr.minFormat)), resource: isFinite(res) ? res : 0 };
                });
                var cylinders = r[4].map(function(x) { return { id: x.id, val: x.val, repeat: num(reqVal(x, cr.repeat)) }; });
                var rolls = t.masterRoll ? r[11].map(function(m) {
                    return { id: m.id, no: m.val, format: num(reqVal(m, rr.format)), length: num(reqVal(m, rr.length)), rest: num(reqVal(m, rr.rest)),
                        status: reqVal(m, rr.status), material: reqVal(m, rr.material), reserveTaskId: refId(m, rr.reserveTask) };
                }) : [];
                // #5339: рулон, зарезервированный под задание, — рулон задания; длина ролика — для рулонов партии ГП.
                var jobs = applyReservedRolls(jobsFromReport(r[0]), rolls);
                jobs.forEach(function(j) { j.rollLenM = jobRollLength(j, dies, cylinders); });
                var machineMeta = (meta || []).filter(function(x) { return String(x.id) === String(t.machine.id); })[0];
                var maxReq = ((machineMeta && machineMeta.reqs) || []).filter(function(x) { return String(x.val).trim() === 'Макс. вал'; })[0];
                maxReq = maxReq ? String(maxReq.id) : '';
                var ic = its.tables.itsCall;
                self.state = {
                    tables: t,
                    its: its.tables,
                    missing: res.missing.filter(function(m) { return /^(Задание высечки|Событие смены высечки|Движение пробега|Нож|Партия ГП этикетки|Мастер-рулон) →/.test(m); }).concat(its.missing),
                    jobs: jobs,
                    rolls: rolls,
                    runs: runsFromReport(r[1]),
                    machines: r[2].map(function(m) { return { id: m.id, val: m.val, maxCylinder: maxReq ? num(reqVal(m, maxReq)) : 0 }; }),
                    dies: dies,
                    cylinders: cylinders,
                    gps: r[5].map(function(g) { return { id: g.id, val: g.val, jobId: refId(g, gr.job) }; }),
                    eventTypes: r[6], runKinds: r[7],
                    checkItems: r[8],
                    calls: ic ? r[9].map(function(x) { return { id: x.id, date: num(x.val), machineId: refId(x, ic.reqs.machine), status: reqVal(x, ic.reqs.status), reason: reqVal(x, ic.reqs.reason) }; }) : [],
                    now: r[10],
                    dayStart: moscowDayStart(r[10]),
                    events: [], shiftEvents: [], marks: []
                };
                if (self.state.missing.length) self.message('Проверьте схему: ' + self.state.missing.join('; '), 'warn');
                var fromPad = padMachineId(self.state.machines, window.atexPad, window.AtexPadGuard);
                if (fromPad) self.machineId = fromPad;
                if (!self.state.machines.some(function(m) { return m.id === self.machineId; })) self.machineId = '';
                self.pickCurrent();
                return self.loadJob();
            }).then(function() { self.render(); });
        }).catch(function(err) {
            console.error('[die-cutter] ❌', err);
            self.message('Пульт не загрузился: ' + err.message, 'error');
        });
    };

    // Записи «Настройки» → [{ key, type, value }] (колонки «Тип» и «Значение» — по имени).
    AtexDieCutter.prototype.loadSettings = function(meta) {
        var st = (meta || []).filter(function(x) { return String(x.val).trim() === 'Настройка'; })[0];
        if (!st) return Promise.resolve([]);
        var col = function(name) { var h = (st.reqs || []).filter(function(x) { return String(x.val).trim() === name; })[0]; return h ? String(h.id) : ''; };
        var typeReq = col('Тип'), valReq = col('Значение');
        return this.client.getJson('object/' + st.id + '/?JSON_KV&LIMIT=0,1000').then(function(json) {
            return kvRecords(json).map(function(x) { return { key: x.val, type: typeReq ? reqVal(x, typeReq) : '', value: valReq ? reqVal(x, valReq) : '' }; });
        });
    };

    // #5330: выбранный станок — в настройку планшета (её же читает pad-home.js). Прав на
    // запись в «Планшет» нет (оператор) — сторож молча не пишет, выбор живёт в localStorage.
    AtexDieCutter.prototype.storePadMachine = function() {
        var pad = window.atexPad;
        if (!pad || typeof pad.setObject !== 'function' || !this.machineId) return;
        var id = this.machineId;
        var m = (this.state ? this.state.machines : []).filter(function(x) { return x.id === id; })[0];
        pad.setObject('dieCutter', { id: id, label: m ? m.val : '' }).catch(function(err) {
            console.warn('[die-cutter] станок в «Планшет» не записан:', err && err.message);
        });
    };

    AtexDieCutter.prototype.queue = function() {
        return machineQueue(this.state ? this.state.jobs : [], this.machineId, this.state ? this.state.dayStart : 0);
    };

    AtexDieCutter.prototype.pickCurrent = function() {
        var q = this.queue();
        var id = this.selectedId;
        var known = q.open.concat(q.doneToday).some(function(j) { return j.id === id; });
        if (!known) this.selectedId = q.current ? q.current.id : '';
    };

    AtexDieCutter.prototype.current = function() {
        var id = this.selectedId;
        return this.state ? this.state.jobs.filter(function(j) { return j.id === id; })[0] || null : null;
    };

    // #5330: «Событие смены высечки» — самостоятельная таблица. События задания — по ссылке
    // «Задание высечки», смена станка — «Начало смены»/«Конец смены» по ссылке «Станок высечки».
    // Отметки чек-листа — подчинённые заданию записи (F_U).
    AtexDieCutter.prototype.loadJob = function() {
        var self = this, s = this.state, j = this.current();
        if (!s) return Promise.resolve();
        var c = this.client, t = s.tables.dieEvent, er = t.reqs, cm = s.its.checkMark;
        // Фильтр по ссылке — по id записи: `F_{реквизит}=@{id}` (без `@` сравнивается подпись).
        var list = function(q) { return c.getJson('object/' + t.id + '/?JSON_KV&LIMIT=0,100000' + q).then(kvRecords); };
        var toEvent = function(e) {
            return { id: e.id, date: num(e.val), type: reqVal(e, er.type), operator: reqVal(e, er.operator), notes: reqVal(e, er.notes),
                photo: reqVal(e, er.photo), jobId: refId(e, er.job), machineId: refId(e, er.machine), minutes: num(reqVal(e, er.setupMinutes)), duration: num(reqVal(e, er.duration)) };
        };
        var shiftTypes = [EVENT.SHIFT_START, EVENT.SHIFT_END].map(function(l) { return self.refByLabel(s.eventTypes, l); }).filter(Boolean);
        var shift = this.machineId && er.machine && er.type
            ? Promise.all(shiftTypes.map(function(tid) { return list('&F_' + er.machine + '=@' + encodeURIComponent(self.machineId) + '&F_' + er.type + '=@' + encodeURIComponent(tid)); }))
            : Promise.resolve([]);
        var jobEvents = j && er.job ? list('&F_' + er.job + '=@' + encodeURIComponent(j.id)) : Promise.resolve([]);
        var marks = j && cm ? c.getJson('object/' + cm.id + '/?JSON_KV&LIMIT=0,1000&F_U=' + encodeURIComponent(j.id)).then(kvRecords) : Promise.resolve([]);
        return Promise.all([shift, jobEvents, marks]).then(function(r) {
            s.shiftEvents = [].concat.apply([], r[0]).map(toEvent);
            s.events = r[1].map(toEvent).sort(function(a, b) { return b.date - a.date || Number(b.id) - Number(a.id); });
            s.marks = cm ? r[2].map(function(m) { return { id: m.id, date: num(m.val), itemId: refId(m, cm.reqs.item), operator: reqVal(m, cm.reqs.operator) }; }) : [];
        }).catch(function(err) { self.message('События не прочитаны: ' + err.message, 'error'); });
    };

    AtexDieCutter.prototype.shift = function() {
        return shiftState(this.state ? this.state.shiftEvents : [], this.machineId);
    };

    AtexDieCutter.prototype.render = function() {
        if (!this.state) return;
        var self = this;
        this.$('atex-dc-machines').innerHTML = '<label class="atex-dc-muted" for="atex-dc-machine">Станок</label> <select id="atex-dc-machine" class="atex-dc-input"><option value="">— выберите станок —</option>' +
            this.state.machines.map(function(m) { return '<option value="' + esc(m.id) + '"' + (m.id === self.machineId ? ' selected' : '') + '>' + esc(m.val) + '</option>'; }).join('') + '</select>';
        if (this.machineId) {
            var sh = this.shift();
            this.$('atex-dc-machines').innerHTML += ' <span class="atex-dc-badge' + (sh.open ? ' is-ok' : '') + '">' +
                esc(sh.open ? 'Смена открыта с ' + fmtTime(sh.since, true) : 'Смена закрыта') + '</span> ' +
                '<button class="atex-dc-btn' + (sh.open ? '' : ' atex-dc-btn-primary') + '" type="button" data-act="' + (sh.open ? 'shiftClose' : 'shiftOpen') + '">' +
                (sh.open ? 'Закрыть смену' : 'Открыть смену') + '</button>';
        }
        this.renderList();
        this.renderJob();
    };

    AtexDieCutter.prototype.renderList = function() {
        var self = this, s = this.state;
        var q = this.queue();
        var el = this.$('atex-dc-list');
        if (!this.machineId) { el.innerHTML = '<div class="atex-dc-empty">Выберите станок высечки.</div>'; return; }
        var card = function(j) {
            var pr = jobProgress(j, s.runs, s.gps);
            var tag = j === q.next ? ' <span class="atex-dc-badge is-info">следующее</span>' : (norm(j.status) === norm(JOB_STATUS.RUNNING) ? ' <span class="atex-dc-badge is-ok">в работе</span>' : '');
            return '<div class="atex-dc-job' + (j.id === self.selectedId ? ' is-picked' : '') + (isDone(j.status) ? ' is-done' : '') + '" data-job-id="' + esc(j.id) + '">' +
                '<div class="atex-dc-job-top"><span class="atex-dc-job-no">' + esc(j.order ? 'Заказ ' + j.order : 'Задание ' + j.id) + '</span><span class="atex-dc-muted">' + esc(fmtTime(j.start, true)) + '</span></div>' +
                '<div class="atex-dc-muted">' + esc(j.labelWidth + '×' + j.labelLength + ' мм · нож ' + (j.dieNo || '—') + ' · вал ' + (j.cylinder || '—')) + '</div>' +
                '<div class="atex-dc-muted">' + pullsCount(pr) + tag + '</div></div>';
        };
        el.innerHTML = (q.open.length ? q.open.map(card).join('') : '<div class="atex-dc-empty">Открытых заданий нет.</div>') +
            (q.doneToday.length ? '<h3 class="atex-dc-sub">Выполнено сегодня</h3>' + q.doneToday.map(card).join('') : '');
    };

    AtexDieCutter.prototype.renderJob = function() {
        var el = this.$('atex-dc-job');
        var s = this.state, j = this.current();
        if (!j) { el.innerHTML = '<div class="atex-dc-empty">' + (this.machineId ? 'Выберите задание слева.' : '') + '</div>'; return; }
        var pr = jobProgress(j, s.runs, s.gps);
        var done = isDone(j.status);
        var rest = rollRest(j, 0);
        var mile = j.dieId ? dieMileageNow(j.dieId, s.runs, s.dayStart) : null;
        var cl = checklist(s.checkItems, s.marks);
        var calls = openCalls(s.calls, this.machineId);
        var setup = setupState(s.events, j.id);
        var idle = idleState(s.events, j.id);
        var acts = jobActions({ done: done, shiftOpen: this.shift().open, setupOpen: setup.open, stale: !!(pr.gpMissing.length || pr.factStale) });
        var has = function(a) { return acts.indexOf(a) >= 0; };
        var html = '<div class="atex-dc-head"><div class="atex-dc-order">' + esc(j.order ? 'Заказ ' + j.order : 'Задание ' + j.id) + '</div>' +
            '<div class="atex-dc-pulls">' + pullsCaption(pr, done) + '</div>' +
            '<span class="atex-dc-badge' + (done ? ' is-ok' : '') + '">' + esc(j.status || JOB_STATUS.PLANNED) + '</span></div>';
        html += '<div class="atex-dc-grid">' +
            cell('Этикетка', j.labelWidth + ' × ' + j.labelLength + ' мм' + (j.labelsPerRoll ? ' · ' + fmtNum(j.labelsPerRoll) + ' в рулоне' : '')) +
            cell('Нож', (j.dieNo || '—') + (j.streams ? ' · ' + j.streams + ' руч.' : '')) +
            cell('Вал', j.cylinder || '—') +
            cell('Сырьё', j.material || '—') +
            cell('Мастер-рулон', needsRoll(j) ? 'не выбран' : (j.roll || '—') + (j.rollFormat ? ' · ' + j.rollFormat + ' мм' : '') + (j.rollSource === 'reserve' ? ' · резерв' : '')) +
            cell('Остаток рулона', rest == null ? (String(j.rollRest).trim() === '' ? '—' : fmtM(j.rollRest) + ' м') : fmtM(rest) + ' м') +
            cell('Метраж задания', fmtM(j.footage) + ' м · съём ' + fmtM(metersPerPull(j)) + ' м') +
            cell('Наладка', (j.setup ? 'план ' + j.setup + ' мин' : 'план —') + ' · факт ' + setup.fact + ' мин' + (setup.open ? ' · идёт с ' + fmtTime(setup.since) : '')) +
            (idle.minutes > 0 ? cell('Простой', idle.minutes + ' мин') : '') + '</div>';
        if (needsRoll(j) && !done) {
            html += '<div class="atex-dc-message is-warn">У задания нет мастер-рулона: ни в задании, ни в резерве рулона.' +
                (has('roll') ? ' Нажмите «Выбрать мастер-рулон»; без рулона остаток не спишется.' : '') + '</div>';
        }
        if (!done && !(num(j.rollLenM) > 0)) {
            html += '<div class="atex-dc-message is-warn">Рулоны партии ГП считаются по числу ручьёв: ' + esc(rollsPerPull(j, 0).warn) + '</div>';
        }
        var die = j.dieId ? s.dies.filter(function(d) { return d.id === j.dieId; })[0] : null;
        var wear = mile && die && !done && wearHidden().indexOf(wearHideKey(j)) < 0 ? dieWearNotice(mile.meters, jobRemainingMeters(j, s.runs), die.resource) : null;
        // Оранжевая плашка на обоих уровнях: заметно, но не тревога (#5366).
        if (wear) html += '<div class="atex-dc-message atex-dc-wear"><span>⚠ ' + esc(wear.text) + '</span>' +
            '<button class="atex-dc-btn" type="button" data-act="wearHide" title="Скрыть для этого заказа">Скрыть</button></div>';
        if (!this.shift().open) html += '<div class="atex-dc-message is-warn">Смена закрыта — откройте смену, чтобы работать с заданием.</div>';
        if (pr.gpMissing.length || pr.factStale) {
            html += '<div class="atex-dc-message is-warn">Съёмы записаны не до конца (' + (pr.gpMissing.length ? 'партий ГП не хватает: ' + pr.gpMissing.length : '«Съёмов факт» отстаёт') +
                ').' + (has('sync') ? ' <button class="atex-dc-btn" type="button" data-act="sync">Дописать</button>' : '') + '</div>';
        }
        var LABELS = {
            pull: ['Съём выполнен', 'atex-dc-btn-ok atex-dc-btn-lg'], pulls: ['Съёмы пачкой', 'atex-dc-btn-lg'],
            die: ['🔪 Смена ножа', ''], cylinder: ['🔩 Смена вала', ''], setup: ['🛠 Наладка', ''],
            roll: [needsRoll(j) ? '🧻 Выбрать мастер-рулон' : '🧻 Смена мастер-рулона', needsRoll(j) ? 'atex-dc-btn-primary' : ''], idle: ['⏸ Простой', ''],
            setupDone: ['✅ Наладка завершена', 'atex-dc-btn-primary'], scrap: ['Брак', 'atex-dc-btn-bad'],
            checklist: ['Чек-лист ИТС' + (cl.rows.length ? ' (' + cl.rows.filter(function(r) { return r.checked; }).length + '/' + cl.rows.length + ')' : ''), ''],
            call: ['📣 Вызов ИТС', ''], done: ['Готово', 'atex-dc-btn-primary'], refresh: ['Обновить', '']
        };
        html += '<div class="atex-dc-toolbar">' + acts.filter(function(a) { return LABELS[a] && a !== 'sync'; }).map(function(a) { return btn(a, LABELS[a][0], LABELS[a][1]); }).join('') + '</div>';
        if (calls.length) {
            html += '<div class="atex-dc-message is-warn">Вызов ИТС: ' + calls.map(function(c) { return esc(fmtTime(c.date) + ' · ' + c.status + (c.reason ? ' · ' + c.reason : '')); }).join('; ') + '</div>';
        }
        html += '<div class="atex-dc-cols"><div><h2 class="atex-dc-panel-title">События смены</h2>';
        html += s.events.length ? '<table class="atex-dc-table"><thead><tr><th>Время</th><th>Событие</th><th>Подробности</th></tr></thead><tbody>' +
            s.events.map(function(e) { return '<tr><td>' + esc(fmtTime(e.date, true)) + '</td><td>' + esc(e.type) + '</td><td>' + esc((isType(e, EVENT.IDLE) && e.duration > 0 ? e.duration + ' мин' + (e.notes ? ' · ' : '') : '') + e.notes) + (e.photo ? ' 📷' : '') + '</td></tr>'; }).join('') + '</tbody></table>'
            : '<div class="atex-dc-empty">Событий нет.</div>';
        html += '</div><div><h2 class="atex-dc-panel-title">Пробег ножа ' + esc(j.dieNo || '') + '</h2>';
        html += mile ? '<table class="atex-dc-table">' +
            '<tr><td>На начало смены</td><td class="num">' + fmtM(mile.start) + ' м</td></tr>' +
            '<tr><td>Прибавили сегодня</td><td class="num">' + fmtM(mile.today) + ' м</td></tr>' +
            '<tr><td>Сейчас</td><td class="num"><b>' + fmtM(mile.meters) + ' м</b></td></tr>' +
            (die && die.resource > 0 ? '<tr><td>Ресурс</td><td class="num">' + fmtM(die.resource) + ' м · ' + Math.floor(mile.meters / die.resource * 100) + ' %</td></tr>' : '') + '</table>' +
            (mile.errors.length ? '<div class="atex-dc-message is-warn">' + esc(mile.errors.join('; ')) + '</div>' : '')
            : '<div class="atex-dc-empty">Нож не указан.</div>';
        html += '</div></div>';
        el.innerHTML = html;

        function cell(k, v) { return '<div class="atex-dc-cell"><span class="atex-dc-muted">' + esc(k) + '</span><b>' + esc(v) + '</b></div>'; }
        function btn(act, label, cls) { return '<button class="atex-dc-btn ' + cls + '" type="button" data-act="' + act + '">' + esc(label) + '</button>'; }
    };

    AtexDieCutter.prototype.modal = function(html, okLabel) {
        var modal = this.$('atex-dc-modal');
        var ok = this.$('atex-dc-modal-ok');
        var cancel = this.$('atex-dc-modal-cancel');
        this.$('atex-dc-modal-text').innerHTML = html;
        ok.textContent = okLabel || 'Подтвердить';
        modal.hidden = false;
        return new Promise(function(resolve) {
            var done = function(v) {
                modal.hidden = true;
                ok.removeEventListener('click', yes);
                cancel.removeEventListener('click', no);
                resolve(v);
            };
            var yes = function() { done(true); };
            var no = function() { done(false); };
            ok.addEventListener('click', yes);
            cancel.addEventListener('click', no);
        });
    };

    AtexDieCutter.prototype.field = function(sel) {
        var el = this.root.querySelector(sel);
        return el ? el.value : '';
    };

    // okText — текст об успехе; без него текст возвращает сама работа (writePulls).
    AtexDieCutter.prototype.run = function(work, okText) {
        var self = this;
        var result = { text: '', kind: 'ok' };
        this.busy = true;
        this.message('Записываю…', '');
        // Сообщение об успехе — после перечитывания данных: к этому моменту кнопки задания
        // уже обновлены («Наладка» → «Наладка завершена» без «Обновить», #5339).
        return Promise.resolve().then(work).then(function(text) {
            // Работа может вернуть { text, kind } — например, «Задание закрыто, но статусы не записаны» (#5358).
            if (okText == null && text && typeof text === 'object') result = { text: String(text.text || ''), kind: text.kind || 'ok' };
            else result = { text: okText != null ? okText : String(text || ''), kind: 'ok' };
        }).catch(function(err) {
            console.error('[die-cutter] ❌', err);
            result = { text: 'Не записано: ' + err.message, kind: 'error' };
        }).then(function() { return self.reload(); }).then(function() {
            self.message(result.text, result.kind);
            self.busy = false;
        });
    };

    AtexDieCutter.prototype.refByLabel = function(rows, label) {
        var hit = (rows || []).filter(function(r) { return norm(r.val) === norm(label); })[0];
        return hit ? hit.id : '';
    };

    AtexDieCutter.prototype.askPull = function(n) {
        var self = this, j = this.current();
        if (!j) return;
        // Без мастер-рулона съём молча не открывается: берётся рулон резерва (уже подставлен) или выбор рулона.
        if (needsRoll(j) && !this.noRollOk[j.id]) { this.askRoll(j, n); return; }
        var pr = jobProgress(j, this.state.runs, this.state.gps);
        var m = metersPerPull(j);
        var html = '<p>Задание ' + esc(j.order ? 'заказа ' + j.order : j.id) + ': выполнено ' + pr.done + (pr.plan > 0 ? ' из ' + pr.plan : '') + ' съёмов.</p>' +
            '<label class="atex-dc-label">Съёмов <input class="atex-dc-input" type="number" min="1" max="' + MAX_BATCH + '" data-f="n" value="' + (n || Math.max(1, pr.left)) + '"' + (n ? ' readonly' : '') + '></label>' +
            '<label class="atex-dc-label">Метраж одного съёма, м <input class="atex-dc-input" type="number" min="0" step="0.1" data-f="m" value="' + esc(m || '') + '"></label>' +
            '<p class="atex-dc-muted">Пробег ножа ' + esc(j.dieNo) + ' вырастет на метраж съёмов; на каждый съём — партия ГП в упаковку.</p>' +
            '<p class="atex-dc-muted" data-f="rolls">' + esc(rollsInfo(j, m)) + '</p>' +
            (needsRoll(j) ? '<p class="atex-dc-muted">Мастер-рулон не выбран: его остаток не спишется.</p>' : '');
        this.modal(html, 'Записать').then(function(yes) {
            if (!yes) return;
            self.writePulls(j, num(self.field('[data-f="n"]')), num(self.field('[data-f="m"]')));
        });
    };

    // Движения пробега → партии ГП → остаток рулона → «Съёмов факт» → статус.
    AtexDieCutter.prototype.writePulls = function(j, n, meters) {
        var self = this, s = this.state;
        if (!j) return;
        var plan = takeoffPlan(j, s.jobs, s.runs, s.gps, n, meters);
        if (!plan.ok) { this.message(plan.error, 'error'); return; }
        var t = s.tables;
        var made = 0;
        return this.run(function() {
            return self.client.serverNow().then(function(now) {
                // #5330: незакрытую наладку закрывает первый съём.
                var close = n > 0 ? setupCloseOnPull(s.events, j.id, now) : null;
                var chain = close ? self.writeEvent(j, EVENT.SETUP_DONE, close.minutes + ' мин · ' + close.notes, null, close.minutes) : Promise.resolve();
                var kind = self.refByLabel(s.runKinds, lp.RUN_KIND.CUT);
                if (plan.runs.length && !kind) throw new Error('в справочнике «Вид движения пробега» нет «' + lp.RUN_KIND.CUT + '»');
                plan.runs.forEach(function(m) {
                    chain = chain.then(function() {
                        var r = t.dieRun.reqs, p = {};
                        p['t' + t.dieRun.id] = String(now);
                        if (r.job) p['t' + r.job] = j.id;
                        if (r.meters) p['t' + r.meters] = String(m);
                        if (r.kind) p['t' + r.kind] = kind;
                        if (r.operator && self.userId) p['t' + r.operator] = self.userId;
                        return self.client.create(t.dieRun.id, j.dieId, p).then(function() { made++; });
                    });
                });
                plan.gps.forEach(function(g) {
                    chain = chain.then(function() {
                        var r = t.finishedBatch.reqs, p = {};
                        p['t' + t.finishedBatch.id] = g.name;
                        if (r.job) p['t' + r.job] = j.id;
                        if (r.qty) p['t' + r.qty] = String(g.rolls);
                        if (r.packStatus) p['t' + r.packStatus] = GP_STATUS_NEW;
                        return self.client.create(t.finishedBatch.id, 1, p);
                    });
                });
                return chain.then(function() {
                    if (plan.rest == null || !t.masterRoll || !t.masterRoll.reqs.rest) return null;
                    var p = {};
                    p['t' + t.masterRoll.reqs.rest] = String(plan.rest);
                    if (t.masterRoll.reqs.status) p['t' + t.masterRoll.reqs.status] = plan.rest > 0 ? ROLL_STATUS.OPENED : ROLL_STATUS.USED;
                    return self.client.post('_m_set/' + encodeURIComponent(j.rollId) + '?JSON', p);
                }).then(function() {
                    var r = t.dieJob.reqs, p = {};
                    if (r.pullsFact) p['t' + r.pullsFact] = String(plan.fact);
                    if (plan.status && r.status) p['t' + r.status] = plan.status;
                    // Рулон взят из резерва — запоминается и в самом задании (#5339).
                    if (j.rollSource === 'reserve' && j.rollId && r.masterRoll) p['t' + r.masterRoll] = j.rollId;
                    return self.client.post('_m_set/' + encodeURIComponent(j.id) + '?JSON', p);
                }).then(function() {
                    var warn = plan.warnings && plan.warnings.length ? ' Внимание: ' + plan.warnings.join('; ') + '.' : '';
                    return (n > 0 ? 'Записано съёмов: ' + n + ' (всего ' + plan.fact + (j.pullsPlan > 0 ? ' из ' + j.pullsPlan : '') + ').' : 'Хвосты дописаны.') + warn;
                });
            });
        }).then(function() {
            if (made < plan.runs.length) self.message('Записано съёмов: ' + made + ' из ' + plan.runs.length + '. Повторите — дубли не появятся.', 'error');
        });
    };

    // Событие смены высечки — корневая запись (up=1) со ссылками на задание (j; у событий смены
    // станка его нет) и станок. minutes — только у «Наладка завершена».
    AtexDieCutter.prototype.writeEvent = function(j, typeLabel, notes, file, minutes, duration) {
        var s = this.state, t = s.tables, self = this;
        var typeId = this.refByLabel(s.eventTypes, typeLabel);
        if (!typeId) return Promise.reject(new Error('в справочнике «Тип события высечки» нет «' + typeLabel + '»'));
        return this.client.serverNow().then(function(now) {
            var p = eventParams(t.dieEvent, { now: now, typeId: typeId, userId: self.userId, notes: notes,
                jobId: j ? j.id : '', machineId: (j && j.machineId) || self.machineId, minutes: minutes, duration: duration });
            return self.client.create(t.dieEvent.id, 1, p);
        }).then(function(id) {
            if (!file || !t.dieEvent.reqs.photo) return id;
            return self.client.postFile('_m_set/' + id + '?JSON', 't' + t.dieEvent.reqs.photo, file).then(function() { return id; });
        });
    };

    // #5330: «Открыть смену» / «Закрыть смену» — событие станка без задания.
    AtexDieCutter.prototype.writeShift = function(open) {
        var self = this;
        if (!this.machineId) { this.message('Выберите станок.', 'warn'); return; }
        this.run(function() { return self.writeEvent(null, open ? EVENT.SHIFT_START : EVENT.SHIFT_END, ''); },
            open ? 'Смена открыта.' : 'Смена закрыта.');
    };

    // #5330: «Наладка» без смены оснастки.
    AtexDieCutter.prototype.startSetup = function() {
        var self = this, j = this.current();
        if (!j) return;
        this.run(function() { return self.writeEvent(j, EVENT.SETUP, ''); }, 'Наладка начата.');
    };

    // #5330: «Наладка завершена» — минуты от начала наладки по серверному времени.
    AtexDieCutter.prototype.finishSetup = function() {
        var self = this, j = this.current();
        if (!j) return;
        var st = setupState(this.state.events, j.id);
        if (!st.open) return;
        this.run(function() {
            return self.client.serverNow().then(function(now) {
                var minutes = setupMinutes(st.since, now);
                return self.writeEvent(j, EVENT.SETUP_DONE, minutes + ' мин', null, minutes).then(function() { return 'Наладка завершена: ' + minutes + ' мин.'; });
            });
        });
    };

    // Выбор мастер-рулона (#5339): «Смена мастер-рулона» или обязательный шаг перед съёмом без рулона.
    // Выбранный рулон пишется в задание («Мастер-рулон»), в резерв рулона («Задание высечки») и в
    // событие «Смена мастер-рулона». Оператора не блокируют: «продолжить без рулона» — явный выбор.
    // afterPull — число съёмов окна, которое открыть после выбора (null — просто смена рулона).
    AtexDieCutter.prototype.askRoll = function(j, afterPull) {
        var self = this, s = this.state;
        if (!j) return;
        var forced = needsRoll(j);
        var die = s.dies.filter(function(d) { return d.id === j.dieId; })[0];
        var list = rollCandidates(j, s.rolls || [], die);
        if (!forced && !list.length) { this.message('Смена мастер-рулона: подходящих свободных рулонов нет.', 'warn'); return; }
        var info = function(r) {
            return r.no + ' · ' + r.format + ' мм · остаток ' + fmtM(r.rest) + ' м' + (r.reserveTaskId === j.id ? ' · резерв задания' : '');
        };
        var html = '<h3>' + (forced ? 'Выберите мастер-рулон' : 'Смена мастер-рулона') + '</h3>' +
            '<p>Сейчас: <b>' + esc(forced ? 'не выбран' : j.roll) + '</b></p>';
        if (list.length) {
            html += '<label class="atex-dc-label">Мастер-рулон <select class="atex-dc-input" data-f="to">' +
                list.map(function(r) { return '<option value="' + esc(r.id) + '">' + esc(info(r)) + '</option>'; }).join('') + '</select></label>' +
                '<label class="atex-dc-label">Примечание <input class="atex-dc-input" type="text" data-f="note"></label>';
        } else {
            html += '<p class="atex-dc-muted">Подходящих свободных рулонов (сырьё «' + esc(j.material || '—') + '», формат ножа) на складе нет.</p>';
        }
        if (forced && list.length) html += '<label class="atex-dc-check"><input type="checkbox" data-f="norole"> Продолжить без мастер-рулона (остаток не спишется)</label>';
        this.modal(html, list.length ? 'Записать' : 'Продолжить без рулона').then(function(yes) {
            if (!yes) return;
            var withoutRoll = !list.length || (forced && self.root.querySelector('[data-f="norole"]:checked'));
            if (withoutRoll) {
                self.noRollOk[j.id] = true;
                self.message('Мастер-рулон не выбран: остаток рулона не спишется.', 'warn');
                if (afterPull != null) self.askPull(afterPull);
                return;
            }
            var toId = self.field('[data-f="to"]');
            var to = list.filter(function(x) { return x.id === toId; })[0];
            if (!to) return;
            var note = changeNote(forced ? '' : j.roll, to.no) + (self.field('[data-f="note"]') ? ' · ' + self.field('[data-f="note"]') : '');
            var f = rollAssignFields(s.tables, j, to);
            self.run(function() {
                var chain = Promise.resolve();
                if (Object.keys(f.job).length) chain = chain.then(function() { return self.client.post('_m_set/' + encodeURIComponent(j.id) + '?JSON', f.job); });
                if (Object.keys(f.roll).length) chain = chain.then(function() { return self.client.post('_m_set/' + encodeURIComponent(to.id) + '?JSON', f.roll); });
                return chain.then(function() { return self.writeEvent(j, EVENT.ROLL, note); });
            }, 'Мастер-рулон: ' + note + '.').then(function() {
                if (afterPull != null && !self.busy) self.askPull(afterPull);
            });
        });
    };

    // «Простой» (#5339): минуты — в числовое поле события «Длительность, мин».
    AtexDieCutter.prototype.askIdle = function() {
        var self = this, j = this.current();
        if (!j) return;
        var html = '<h3>Простой</h3>' +
            '<label class="atex-dc-label">Длительность, мин <input class="atex-dc-input" type="number" min="1" step="1" data-f="minutes"></label>' +
            '<label class="atex-dc-label">Причина <input class="atex-dc-input" type="text" data-f="note" placeholder="например: ждём рулон"></label>';
        this.modal(html, 'Записать').then(function(yes) {
            if (!yes) return;
            var minutes = idleMinutes(self.field('[data-f="minutes"]'));
            if (!(minutes > 0)) { self.message('Простой: укажите длительность в минутах.', 'warn'); return; }
            var reason = self.field('[data-f="note"]').trim();
            var hasField = !!(self.state.tables.dieEvent.reqs.duration);
            // Поля «Длительность, мин» в базе нет — минуты остаются хотя бы в примечании.
            var note = hasField ? reason : (minutes + ' мин' + (reason ? ' · ' + reason : ''));
            self.run(function() { return self.writeEvent(j, EVENT.IDLE, note, null, null, minutes); },
                'Простой записан: ' + minutes + ' мин.' + (hasField ? '' : ' В базе нет поля «Длительность, мин» — минуты только в примечании.'));
        });
    };

    AtexDieCutter.prototype.askChange = function(what) {
        var self = this, s = this.state, j = this.current();
        if (!j) return;
        var machine = s.machines.filter(function(m) { return m.id === j.machineId; })[0];
        var list = what === 'die' ? compatibleDies(j, s.dies) : compatibleCylinders(j, s.cylinders, machine);
        var title = what === 'die' ? 'Смена ножа' : 'Смена вала';
        if (!list.length) { this.message(title + ': ' + (what === 'die' ? 'других ножей размера ' + j.labelWidth + '×' + j.labelLength + ' нет' : 'других валов для станка нет'), 'warn'); return; }
        var html = '<h3>' + title + '</h3><p>Сейчас: <b>' + esc(what === 'die' ? j.dieNo : j.cylinder) + '</b></p>' +
            '<label class="atex-dc-label">Новый ' + (what === 'die' ? 'нож' : 'вал') + ' <select class="atex-dc-input" data-f="to">' +
            list.map(function(x) { return '<option value="' + esc(x.id) + '">' + esc(x.val) + (x.state ? ' · ' + esc(norm(x.state)) : '') + '</option>'; }).join('') + '</select></label>' +
            '<label class="atex-dc-label">Примечание <input class="atex-dc-input" type="text" data-f="note"></label>';
        this.modal(html, 'Записать').then(function(yes) {
            if (!yes) return;
            var toId = self.field('[data-f="to"]');
            var to = list.filter(function(x) { return x.id === toId; })[0];
            if (!to) return;
            var note = changeNote(what === 'die' ? j.dieNo : j.cylinder, to.val) + (self.field('[data-f="note"]') ? ' · ' + self.field('[data-f="note"]') : '');
            self.run(function() {
                return self.writeEvent(j, what === 'die' ? EVENT.DIE : EVENT.CYLINDER, note).then(function() {
                    var p = {};
                    p['t' + s.tables.dieJob.reqs[what === 'die' ? 'die' : 'cylinder']] = to.id;
                    return self.client.post('_m_set/' + encodeURIComponent(j.id) + '?JSON', p);
                });
            }, title + ': ' + note + '.');
        });
    };

    AtexDieCutter.prototype.askScrap = function() {
        var self = this, j = this.current();
        if (!j) return;
        var html = '<h3>Брак</h3><label class="atex-dc-label">Этикеток в брак <input class="atex-dc-input" type="number" min="0" data-f="qty"></label>' +
            '<label class="atex-dc-label">Фото брака <input class="atex-dc-input" type="file" accept="image/*" capture="environment" data-f="photo"></label>' +
            '<label class="atex-dc-label">Причина <input class="atex-dc-input" type="text" data-f="note"></label>';
        this.modal(html, 'Записать').then(function(yes) {
            if (!yes) return;
            var qty = num(self.field('[data-f="qty"]'));
            var note = (qty > 0 ? qty + ' эт.' : '') + (self.field('[data-f="note"]') ? (qty > 0 ? ' · ' : '') + self.field('[data-f="note"]') : '');
            var input = self.root.querySelector('[data-f="photo"]');
            var file = input && input.files && input.files[0] ? input.files[0] : null;
            if (!note && !file) { self.message('Брак: укажите количество, причину или фото.', 'warn'); return; }
            self.run(function() { return self.writeEvent(j, EVENT.SCRAP, note, file); }, 'Брак записан' + (file ? ' с фото.' : '.'));
        });
    };

    AtexDieCutter.prototype.askChecklist = function() {
        var self = this, s = this.state, j = this.current();
        if (!j) return;
        var cm = s.its.checkMark;
        if (!cm || !s.its.checkItem) { this.message('В базе нет таблиц чек-листа ИТС (docs/scripts/apply_die_cutter_5326.py).', 'error'); return; }
        var list = checklist(s.checkItems, s.marks);
        if (!list.rows.length) { this.message('Пункты чек-листа ИТС не заведены — справочник «Пункт чек-листа ИТС».', 'warn'); return; }
        var html = '<h3>Чек-лист ИТС</h3>' + list.rows.map(function(r) {
            return '<label class="atex-dc-check"><input type="checkbox" data-check="' + esc(r.id) + '"' + (r.checked ? ' checked disabled' : '') + '> ' + esc(r.name) +
                (r.checked ? ' <span class="atex-dc-muted">' + esc(fmtTime(r.at, true) + ' · ' + r.operator) + '</span>' : '') + '</label>';
        }).join('');
        this.modal(html, 'Отметить').then(function(yes) {
            if (!yes) return;
            var picked = Array.prototype.map.call(self.root.querySelectorAll('[data-check]:checked'), function(x) { return x.getAttribute('data-check'); });
            var todo = checklistToMark(list, picked);
            if (!todo.length) return;
            self.run(function() {
                return self.client.serverNow().then(function(now) {
                    var chain = Promise.resolve();
                    todo.forEach(function(itemId) {
                        chain = chain.then(function() {
                            var p = {};
                            p['t' + cm.id] = String(now);
                            if (cm.reqs.item) p['t' + cm.reqs.item] = itemId;
                            if (cm.reqs.operator && self.userId) p['t' + cm.reqs.operator] = self.userId;
                            return self.client.create(cm.id, j.id, p);
                        });
                    });
                    return chain;
                });
            }, 'Отмечено пунктов чек-листа: ' + todo.length + '.');
        });
    };

    AtexDieCutter.prototype.askCall = function() {
        var self = this, s = this.state, j = this.current();
        var ic = s.its.itsCall;
        if (!ic) { this.message('В базе нет таблицы «Вызов ИТС» (docs/scripts/apply_die_cutter_5326.py).', 'error'); return; }
        if (!this.machineId) { this.message('Выберите станок.', 'warn'); return; }
        var html = '<h3>Вызов ИТС</h3><label class="atex-dc-label">Причина <input class="atex-dc-input" type="text" data-f="reason" placeholder="например: нож не пробивает подложку"></label>';
        this.modal(html, 'Вызвать').then(function(yes) {
            if (!yes) return;
            var reason = self.field('[data-f="reason"]').trim();
            if (!reason) { self.message('Вызов ИТС: укажите причину.', 'warn'); return; }
            self.run(function() {
                return self.client.serverNow().then(function(now) {
                    var r = ic.reqs, p = {};
                    p['t' + ic.id] = String(now);
                    if (r.machine) p['t' + r.machine] = self.machineId;
                    if (r.job && j) p['t' + r.job] = j.id;
                    if (r.operator && self.userId) p['t' + r.operator] = self.userId;
                    if (r.reason) p['t' + r.reason] = reason;
                    if (r.status) p['t' + r.status] = CALL_STATUS.OPEN;
                    return self.client.create(ic.id, 1, p);
                });
            }, 'Вызов ИТС записан.');
        });
    };

    AtexDieCutter.prototype.finish = function() {
        var self = this, s = this.state, j = this.current();
        if (!j) return;
        var pr = jobProgress(j, s.runs, s.gps);
        var html = '<h3>Закрыть задание?</h3><p>' + finishSummary(pr) + '</p>';
        this.modal(html, 'Готово').then(function(yes) {
            if (!yes) return;
            self.run(function() {
                var tail = pr.gpMissing.length || pr.factStale ? self.writePullsSilent(j) : Promise.resolve();
                return tail.then(function() {
                    var p = {};
                    p['t' + s.tables.dieJob.reqs.status] = JOB_STATUS.DONE;
                    return self.client.post('_m_set/' + encodeURIComponent(j.id) + '?JSON', p);
                }).then(function() { return self.afterJobDone(j.id); });
            });
        });
    };

    // Задание стало «Выполнено» → статусы позиции и заказа этикетки (label-status-core.js, #5341/#5358).
    // Ошибка здесь не откатывает закрытие задания: → { text, kind: 'ok' | 'warn' } для run().
    AtexDieCutter.prototype.afterJobDone = function(jobId) {
        var closed = 'Задание закрыто.';
        var st = this.labelStatus || (root && root.AtexLabelStatus);
        if (!st || typeof st.completeAfterJob !== 'function') {
            return Promise.resolve({ text: closed + ' Статусы позиции и заказа не обновлены: не загружен label-status-core.js.', kind: 'warn' });
        }
        return Promise.resolve().then(function() { return st.completeAfterJob(this.client, this.meta, jobId); }.bind(this)).then(function(plan) {
            plan = plan || {};
            var n = (plan.positionsDone || []).length;
            var text = closed + (n === 1 ? ' Позиция выполнена.' : n > 1 ? ' Позиции выполнены (' + n + ').' : '') + (plan.orderDone ? ' Заказ выполнен.' : '');
            var skipped = plan.skipped || [];
            if (skipped.length) return { text: text + ' Статусы обновлены не полностью: ' + skipped.join('; ') + '.', kind: 'warn' };
            return { text: text, kind: 'ok' };
        }, function(err) {
            console.error('[die-cutter] статусы позиции/заказа', err);
            return { text: closed + ' Статусы позиции и заказа не обновлены: ' + (err && err.message || err) + '.', kind: 'warn' };
        });
    };

    // Хвосты (партии ГП, остаток, «Съёмов факт») без новых съёмов — перед закрытием.
    AtexDieCutter.prototype.writePullsSilent = function(j) {
        var s = this.state, t = s.tables, self = this;
        var plan = takeoffPlan(j, s.jobs, s.runs, s.gps, 0, 0);
        if (!plan.ok) return Promise.reject(new Error(plan.error));
        var chain = Promise.resolve();
        plan.gps.forEach(function(g) {
            chain = chain.then(function() {
                var r = t.finishedBatch.reqs, p = {};
                p['t' + t.finishedBatch.id] = g.name;
                if (r.job) p['t' + r.job] = j.id;
                if (r.qty) p['t' + r.qty] = String(g.rolls);
                if (r.packStatus) p['t' + r.packStatus] = GP_STATUS_NEW;
                return self.client.create(t.finishedBatch.id, 1, p);
            });
        });
        return chain.then(function() {
            var p = {};
            p['t' + t.dieJob.reqs.pullsFact] = String(plan.fact);
            if (j.rollSource === 'reserve' && j.rollId && t.dieJob.reqs.masterRoll) p['t' + t.dieJob.reqs.masterRoll] = j.rollId;
            return self.client.post('_m_set/' + encodeURIComponent(j.id) + '?JSON', p);
        });
    };

    return {
        AtexDieCutter: AtexDieCutter,
        Client: Client,
        core: {
            JOB_STATUS: JOB_STATUS,
            CALL_STATUS: CALL_STATUS,
            EVENT: EVENT,
            ITS_TABLES: ITS_TABLES,
            MAX_BATCH: MAX_BATCH,
            kvRecords: kvRecords,
            refIds: refIds,
            resolveItsTables: resolveItsTables,
            jobsFromReport: jobsFromReport,
            runsFromReport: runsFromReport,
            machineQueue: machineQueue,
            padMachineId: padMachineId,
            shiftState: shiftState,
            setupState: setupState,
            setupMinutes: setupMinutes,
            setupCloseOnPull: setupCloseOnPull,
            jobActions: jobActions,
            eventParams: eventParams,
            WRITE_ACTIONS: WRITE_ACTIONS,
            metersPerPull: metersPerPull,
            fmtM: fmtM,
            pullsCaption: pullsCaption,
            finishSummary: finishSummary,
            pullsCount: pullsCount,
            rollLengthM: rollLengthM,
            jobRollLength: jobRollLength,
            rollsPerPull: rollsPerPull,
            applyReservedRolls: applyReservedRolls,
            needsRoll: needsRoll,
            rollCandidates: rollCandidates,
            rollAssignFields: rollAssignFields,
            idleMinutes: idleMinutes,
            idleState: idleState,
            gpName: gpName,
            rollRest: rollRest,
            jobProgress: jobProgress,
            takeoffPlan: takeoffPlan,
            dieMileageNow: dieMileageNow,
            compatibleDies: compatibleDies,
            jobRemainingMeters: jobRemainingMeters,
            dieWearNotice: dieWearNotice,
            wearHideKey: wearHideKey,
            settingValue: settingValue,
            compatibleCylinders: compatibleCylinders,
            changeNote: changeNote,
            checklist: checklist,
            checklistToMark: checklistToMark,
            openCalls: openCalls,
            moscowDayStart: moscowDayStart,
            fmtTime: fmtTime
        }
    };
});
