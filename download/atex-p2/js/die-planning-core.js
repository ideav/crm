// Планирование высечки — ядро (ideav/crm#5320, Фаза 2 atex, шаг 7).
//
// Чистые функции рабочего места «Планирование высечки»; экран — die-planning.js.
//   - нормы («Настройка», DIE_*): смена вала, смена ножа на том же валу, смена втулки при том же
//     ноже, скорость вырубки (короткие ролики — своя), начало и ёмкость смены, горизонт плана;
//     значения по умолчанию — в DEFAULTS (нормы — лист «План» заказчика, ideav/crm#5346);
//   - календарь: рабочий день с DIE_DAY_START_MIN, ёмкость DIE_DAY_CAPACITY_MN, будни; задание,
//     не поместившееся в день, продолжается на следующем рабочем дне без повторной наладки;
//   - очередь по станкам: начатые задания неподвижны, остальные идут по сроку; к текущей группе
//     вал → нож → сырьё подтягивается следующее задание, если от этого никто не уходит в
//     просрочку (просрочка свята); станок допустим по «Допустимым валам» и «Стоп-листу сырья»;
//   - блокировки (нет ножа, нож списан), предупреждения «ресурс ножа» и «нет МР нужного формата»;
//   - покрытие заданий мастер-рулонами и план резерва (правила склада — master-rolls-core.js);
//   - загрузка ножей и валов, полосы Ганта; формирование заданий из позиций заказов этикетки;
//   - задачи на втулки под позицией (без дублей, не начатые приводятся к плану).
// Таблицы и реквизиты — по именам из /metadata, id в коде нет.
// Покрыто experiments/atex-p2-5320-die-planning.test.js, experiments/atex-p2-5346-die-setup-norms.test.js.

(function(root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.AtexDiePlanning = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
    'use strict';

    var LP = ((root && root.AtexLabelProduction) || (typeof require === 'function' ? require('../../atex/js/label-production.js') : null)).core;
    var LO = ((root && root.AtexLabelOrders) || (typeof require === 'function' ? require('./label-orders.js') : null)).core;
    var JC = ((root && root.AtexJumboCutMap) || (typeof require === 'function' ? require('./jumbo-cut-map.js') : null)).core;
    var MR = ((root && root.AtexMasterRolls) || (typeof require === 'function' ? require('./master-rolls-core.js') : null)).core;

    var JOB_STATUS = { PLANNED: 'Запланировано', RUNNING: 'В работе', DONE: 'Выполнено', CANCELLED: 'Отменено' };
    var FINAL_STATUSES = ['выполнено', 'отменено', 'закрыто'];

    // Настройки: ключ в «Настройке» → [поле, значение по умолчанию, допустимо ли 0].
    var SETTING_KEYS = {
        // Смена вала (меняется вместе с ножом): обычный станок — 60 мин; станок с туррелью — 120 (запуск туррели, полная наладка).
        cylinderChange: ['DIE_CYLINDER_CHANGE_MN', 60, true],
        turretCylinderChange: ['DIE_TURRET_CYLINDER_CHANGE_MN', 120, true],
        knifeChange: ['DIE_KNIFE_CHANGE_MN', 30, true],
        // Смена втулки: втулки надевают на 3 револьверных вала, пока идёт намотка.
        sleeveChange: ['DIE_SLEEVE_CHANGE_MN', 12, true],
        speed: ['DIE_SPEED_M_MIN', 44, false],
        shortRollSpeed: ['DIE_SPEED_SHORT_M_MIN', 28, false],
        shortRollM: ['DIE_SHORT_ROLL_M', 50, true],
        dayStartMin: ['DIE_DAY_START_MIN', 480, true],
        dayCapacityMin: ['DIE_DAY_CAPACITY_MN', 455, false],
        horizonDays: ['DIE_HORIZON_DAYS', 14, false],
        mrLength: ['LABEL_MASTER_ROLL_M', 2000, false],
        // Допуск размера ножа к этикетке, мм (#5569): тот же, что у «Заказов этикетки»; 0 — точный подбор.
        dieSizeTolerance: ['LABEL_DIE_SIZE_TOLERANCE_MM', 0, true],
        tolerance: ['JUMBO_FORMAT_TOLERANCE_MM', 15, true],
        // Ресурс ножа без марки, об (один оборот = один раппорт вала): медиана пробега списанных ножей из 1С.
        dieResource: ['DIE_RESOURCE_DEFAULT_REV', 300000, false],
        // Простой туррели, рабочих минут: её очередь пуста столько — она берёт обычные задания (#5376).
        turretIdle: ['TURREL_IDLE_MN', 455, true]
    };
    var DEFAULTS = { tzOffsetMin: 180 };
    Object.keys(SETTING_KEYS).forEach(function(k) { DEFAULTS[k] = SETTING_KEYS[k][1]; });

    function norm(s) { return String(s == null ? '' : s).replace(/^\s*\d+:/, '').trim().toLowerCase(); }
    function num(v) {
        var n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
        return isFinite(n) ? n : 0;
    }
    function round1(n) { return Math.round(n * 10) / 10; }
    function round2(n) { return Math.round(n * 100) / 100; }

    // rows — [{ key, type, value }] (строки «Настройки»); db — код базы (тип записи).
    function readSettings(rows, db) {
        var out = Object.assign({}, DEFAULTS);
        Object.keys(SETTING_KEYS).forEach(function(k) {
            var spec = SETTING_KEYS[k];
            var raw = LO.settingValue(rows || [], spec[0], db);
            if (raw === '') return;
            var n = parseFloat(String(raw).replace(/\s/g, '').replace(',', '.'));
            if (!isFinite(n) || n < 0 || (n === 0 && !spec[2])) return;
            out[k] = n;
        });
        return out;
    }
    function withDefaults(s) {
        var out = Object.assign({}, DEFAULTS);
        Object.keys(s || {}).forEach(function(k) { if (s[k] != null) out[k] = s[k]; });
        return out;
    }

    // ── Задания ─────────────────────────────────────────────────────────────

    function isDone(job) { return norm(job && job.status) === 'выполнено'; }
    function isFinal(job) { return FINAL_STATUSES.indexOf(norm(job && job.status)) >= 0; }
    function isStarted(job) { return norm(job && job.status) === 'в работе' || num(job && job.pullsFact) > 0; }
    function isMovable(job) {
        var st = norm(job && job.status);
        return !isStarted(job) && (st === '' || st === 'запланировано');
    }

    // «06.10.2026» или «2026-10-06» → unix начала следующих суток по Москве (срок — до конца дня).
    function dueEnd(text, tz) {
        var s = String(text == null ? '' : text).trim(), m;
        var y, mo, d;
        if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
        else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
        else return 0;
        return Date.UTC(y, mo - 1, d + 1) / 1000 - (tz == null ? DEFAULTS.tzOffsetMin : tz) * 60;
    }

    // Значение BOOLEAN из базы: пусто, 0, «нет», false — выключено.
    function flagOn(v) {
        var t = String(v == null ? '' : v).trim().toLowerCase();
        return t !== '' && t !== '0' && t !== '-1' && t !== 'нет' && t !== 'false';   // #5475: "-1" = нет (#5442)
    }
    // Строки отчёта die_planning → задания (fixed — «Зафиксировано», #5376).
    function buildJobs(rows, tz) {
        return (rows || []).map(function(r) {
            var minF = num(r.min_format);
            return {
                id: String(r.job_id), start: num(r.job_start), status: String(r.job_status || '').trim(),
                pullsPlan: num(r.pulls_plan), pullsFact: num(r.pulls_fact), footage: num(r.footage), duration: num(r.duration), setup: num(r.setup),
                machineId: String(r.machine_id || ''), machine: String(r.machine || ''),
                dieId: String(r.die_id || ''), dieNo: String(r.die_no || ''), streams: num(r.die_streams),
                cylinderId: String(r.cylinder_id || ''), cylinder: String(r.cylinder || ''),
                masterRollId: String(r.master_roll_id || ''), masterRoll: String(r.master_roll || ''),
                minFormat: minF, optFormat: num(r.opt_format), usedFormat: num(r.used_format),
                positionId: String(r.position_id || ''), orderNo: String(r.order_no || ''),
                due: dueEnd(r.due, tz), dueText: String(r.due || ''), rolls: num(r.rolls),
                sleeveId: String(r.sleeve_id || ''), sleeve: String(r.sleeve || ''), sleeveWidth: num(r.sleeve_width),
                materialId: String(r.material_id || ''), material: String(r.material || ''),
                baseId: String(r.material_base_id || ''), base: String(r.material_base || ''),
                article: String(r.article || '').trim(),
                shaftId: String(r.shaft_id || ''), shaftNo: String(r.shaft_no || ''),
                fixed: flagOn(r.fixed)
            };
        });
    }

    // ── Нормы и допустимость станка ─────────────────────────────────────────

    function sameCylinder(a, b) {
        if (a.cylinderId && b.cylinderId) return String(a.cylinderId) === String(b.cylinderId);
        if (a.cylinder && b.cylinder) return String(a.cylinder) === String(b.cylinder);
        return false;
    }
    function sameKnife(a, b) {
        if (a.dieId && b.dieId) return String(a.dieId) === String(b.dieId);
        if (a.dieNo && b.dieNo) return String(a.dieNo) === String(b.dieNo);
        return false;
    }
    // Втулка — диаметр сердечника (76/40/25): по id справочника, без id — по диаметру из названия.
    // Втулка не указана у одного из заданий — смены втулки нет.
    function differentSleeve(a, b) {
        if (a.sleeveId && b.sleeveId) return String(a.sleeveId) !== String(b.sleeveId);
        var da = sleeveDiameterMm(a.sleeve), db = sleeveDiameterMm(b.sleeve);
        if (da > 0 && db > 0) return da !== db;
        var na = norm(a.sleeve), nb = norm(b.sleeve);
        return !!(na && nb && na !== nb);
    }
    // 'cylinder' — смена вала, 'knife' — смена ножа на том же валу, 'sleeve' — тот же вал и нож,
    // другая втулка, 'none'. Станок пуст — полная наладка.
    function setupKind(prev, next) {
        if (!prev || !sameCylinder(prev, next)) return 'cylinder';
        if (!sameKnife(prev, next)) return 'knife';
        return differentSleeve(prev, next) ? 'sleeve' : 'none';
    }
    // machine — станок: смена вала на туррели — DIE_TURRET_CYLINDER_CHANGE_MN, на обычном — DIE_CYLINDER_CHANGE_MN.
    function cylinderChangeOf(s, machine) { return machine && machine.turret ? s.turretCylinderChange : s.cylinderChange; }
    function setupMinutesOfKind(kind, s, machine) {
        return kind === 'cylinder' ? cylinderChangeOf(s, machine) : kind === 'knife' ? s.knifeChange : kind === 'sleeve' ? s.sleeveChange : 0;
    }
    function setupMinutes(prev, next, settings, machine) {
        var s = withDefaults(settings);
        return setupMinutesOfKind(setupKind(prev, next), s, machine);
    }
    // Вид наладки по записанным минутам (задание уже стоит): норма, равная минутам, иначе самая
    // дорогая норма, которой хватает (нормы станка machine).
    function kindOfSetup(setup, s, machine) {
        if (!(setup > 0)) return 'none';
        var norms = [['cylinder', cylinderChangeOf(s, machine)], ['knife', s.knifeChange], ['sleeve', s.sleeveChange]], i, best = null;
        for (i = 0; i < norms.length; i++) if (norms[i][1] === setup) return norms[i][0];
        for (i = 0; i < norms.length; i++) if (norms[i][1] <= setup && (!best || norms[i][1] > best[1])) best = norms[i];
        return best ? best[0] : 'sleeve';
    }
    // Длина одного ролика, м: метраж × ручьи / рулонов (раппорт ножа уже включает зазор).
    function rollLengthM(job) {
        var f = num(job && job.footage), st = num(job && job.streams), r = num(job && job.rolls);
        return f > 0 && st > 0 && r > 0 ? f * st / r : 0;
    }
    // Скорость вырубки: короткие ролики (< DIE_SHORT_ROLL_M) — DIE_SPEED_SHORT_M_MIN; порог 0 — одна скорость.
    function speedFor(rollM, s) {
        return s.shortRollM > 0 && rollM > 0 && rollM < s.shortRollM ? s.shortRollSpeed : s.speed;
    }
    // footage — метраж, м; rollM — длина ролика, м (необязательно; без неё — обычная скорость).
    function runMinutes(footage, settings, rollM) {
        var s = withDefaults(settings), m = num(footage);
        return m > 0 ? Math.ceil(m / speedFor(num(rollM), s) - 1e-9) : 0;
    }
    function jobRunMinutes(job, s) { return runMinutes(job.footage, s, rollLengthM(job)); }

    // Ограничения станка — реквизиты станка высечки, у каждого станка свои (#5428); 0/пусто — нет ограничения.
    // machine — { id, name, active, turret, stopMaterials: [id сырья], stopBases: [id основы сырья],
    //   minCylinder, maxCylinder (зубьев, границы включены), minSeriesM (м), maxRollM (м), sleeveNotNarrower }.
    // seriesM — метраж серии задания (seriesFootage); без него — метраж самого задания.
    function cylinderInRange(machine, teeth) {
        var lo = num(machine && machine.minCylinder), hi = num(machine && machine.maxCylinder), t = num(teeth);
        return !(t > 0) || (!(lo > 0 && t < lo) && !(hi > 0 && t > hi));
    }
    function cylinderRangeText(machine) {
        var lo = num(machine && machine.minCylinder), hi = num(machine && machine.maxCylinder);
        return lo > 0 && hi > 0 ? lo + '–' + hi : lo > 0 ? 'от ' + lo : hi > 0 ? 'до ' + hi : 'любой';
    }
    // Правила серии, ролика и втулки: '' — задание проходит, иначе причина.
    function runRulesFail(machine, job, seriesM) {
        var minS = num(machine && machine.minSeriesM), maxR = num(machine && machine.maxRollM);
        if (machine && machine.sleeveNotNarrower) {
            var d = sleeveDiameterMm(job && job.sleeve), w = num(job && job.sleeveWidth);
            if (!(d > 0)) return 'диаметр втулки не указан';
            if (w < d) return 'ширина втулки ' + (w || '—') + ' мм меньше её диаметра (' + d + ' мм)';
        }
        if (maxR > 0) {
            var roll = rollLengthM(job);
            if (roll > maxR) return 'намотка ролика ' + Math.round(roll) + ' м больше ' + maxR + ' м';
        }
        if (minS > 0) {
            var m = Math.max(num(seriesM), num(job && job.footage));
            if (m < minS) return 'серия ' + Math.round(m) + ' м меньше ' + minS + ' м';
        }
        return '';
    }
    function machineAllows(machine, job, settings, seriesM) {
        if (machine.active === false) return { ok: false, reason: 'станок не работает' };
        // Вал без числа не режется.
        if (!cylinderInRange(machine, job.cylinder))
            return { ok: false, reason: 'вал ' + num(job.cylinder) + ' вне валов станка (' + cylinderRangeText(machine) + ')' };
        if (job.materialId && (machine.stopMaterials || []).indexOf(String(job.materialId)) >= 0)
            return { ok: false, reason: 'сырьё «' + (job.material || job.materialId) + '» в стоп-листе станка' };
        if (job.baseId && (machine.stopBases || []).indexOf(String(job.baseId)) >= 0)
            return { ok: false, reason: 'основа «' + (job.base || job.baseId) + '» в стоп-листе станка' };
        // Задание, записанное на станок диспетчером, остаётся допустимым (ручное решение; на туррели её отцепляют).
        var fail = String(job.machineId || '') === String(machine.id) ? '' : runRulesFail(machine, job, seriesM);
        if (fail) return { ok: false, reason: (machine.turret ? 'туррель: ' : '') + fail };
        return { ok: true };
    }
    // Задание подходит туррели machine: проходит её правила серии, ролика и втулки.
    function turretFits(job, machine, seriesM) {
        return !runRulesFail(machine, job, seriesM);
    }
    // Серия — задания одного артикула (полностью одинаковая номенклатура): метраж серии — сумма их
    // метражей. Задание без артикула — серия из себя самого. → { id задания: метраж серии, м }.
    function seriesFootage(jobs) {
        var byArt = {}, out = {};
        (jobs || []).forEach(function(j) { if (j.article) byArt[j.article] = (byArt[j.article] || 0) + num(j.footage); });
        (jobs || []).forEach(function(j) { out[j.id] = j.article ? byArt[j.article] : num(j.footage); });
        return out;
    }

    // ── Календарь ───────────────────────────────────────────────────────────

    // Курсор { day, used }: номер суток по Москве и занятые минуты смены.
    function createCalendar(settings) {
        var s = withDefaults(settings), tz = s.tzOffsetMin, start = s.dayStartMin, cap = s.dayCapacityMin;
        function dayOf(ts) { return Math.floor((ts + tz * 60) / 86400); }
        function isWork(day) { var wd = (((day + 4) % 7) + 7) % 7; return wd >= 1 && wd <= 5; }
        function dayTs(day, min) { return day * 86400 + min * 60 - tz * 60; }
        function normalize(c) {
            var d = c.day, u = c.used;
            if (u >= cap) { d++; u = 0; }
            while (!isWork(d)) { d++; u = 0; }
            return { day: d, used: u };
        }
        function cursorAt(ts) {
            var day = dayOf(ts);
            if (!isWork(day)) return normalize({ day: day, used: 0 });
            var m = (ts + tz * 60 - day * 86400) / 60;
            var used = Math.min(cap, Math.max(0, Math.ceil(m - start - 1e-9)));
            return normalize({ day: day, used: used });
        }
        // minutes минут работы подряд; в конце смены переходит на следующий рабочий день.
        function advance(c, minutes, kind) {
            c = normalize(c);
            var segs = [], rem = minutes;
            if (!(rem > 0)) {
                var t0 = dayTs(c.day, start + c.used);
                return { segments: [{ day: c.day, from: c.used, minutes: 0, start: t0, end: t0, kind: kind }], cursor: c };
            }
            while (rem > 1e-9) {
                c = normalize(c);
                var take = Math.min(cap - c.used, rem);
                segs.push({ day: c.day, from: c.used, minutes: take, start: dayTs(c.day, start + c.used), end: dayTs(c.day, start + c.used + take), kind: kind });
                c = { day: c.day, used: c.used + take };
                rem -= take;
            }
            return { segments: segs, cursor: c };
        }
        return { dayOf: dayOf, isWork: isWork, dayTs: dayTs, normalize: normalize, cursorAt: cursorAt, advance: advance, settings: s };
    }
    function curKey(c) { return c.day * 100000 + c.used; }

    // ── Очередь ─────────────────────────────────────────────────────────────

    function compareJobs(a, b) {
        var da = a.due > 0 ? a.due : Infinity, db = b.due > 0 ? b.due : Infinity;
        if (da !== db) return da < db ? -1 : 1;
        // записанный старт — результат плана, а не вход: при равных сроках порядок по номеру задания
        return (num(a.id) - num(b.id)) || String(a.id).localeCompare(String(b.id));
    }
    // Близость двух заданий: 3 — тот же вал, нож и сырьё, 2 — вал и нож, 1 — вал, 0 — ничего общего.
    function affinity(a, b) {
        if (!sameCylinder(a, b)) return 0;
        if (!sameKnife(a, b)) return 1;
        return a.materialId && a.materialId === b.materialId ? 3 : 2;
    }

    // Ключ вала задания: id записи «Вал» (номер вала = число зубьев), без id — номер.
    function shaftKey(job) {
        if (job && job.cylinderId) return 'id:' + job.cylinderId;
        return job && num(job.cylinder) > 0 ? 'n:' + num(job.cylinder) : '';
    }
    // Время для журнала планирования: «дд.мм чч:мм» по часовому поясу настроек.
    function traceTime(ts, s) {
        if (!(ts > 0)) return '—';
        var d = new Date((ts + s.tzOffsetMin * 60) * 1000), p = function(n) { return (n < 10 ? '0' : '') + n; };
        return p(d.getUTCDate()) + '.' + p(d.getUTCMonth() + 1) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
    }
    function traceLabel(j) {
        return 'задание ' + j.id + (j.orderNo ? ' (заказ ' + j.orderNo + ')' : '') + ' вал ' + (j.cylinder || '—') + ' нож ' + (j.dieNo || '—') +
            (j.due > 0 ? ' срок ' + (j.dueText || '') : '');
    }

    // inp.trace(rec) — журнал решений (#5720): rec = { jobId, machineId, text }; без функции журнал не ведётся.
    // inp.shafts — физические валы [{ id, no, cylinderId }] («Серийный номер вала» → «Вал»). Вал не стоит
    // на двух станках одновременно: задание берёт свободный в это время вал своего типоразмера, а если
    // все заняты — ждёт ближайший освободившийся (#5720). У типоразмера нет серийных — считается один вал.
    // sh.off — «Не ставить в работу» (#5726): вал в реестре, но новым заданиям не достаётся; уже записанный
    // в начатое задание вал за ним остаётся. Все валы типоразмера off — задание ставится с пометкой noShaft.
    function orderQueue(inp) {
        var s = withDefaults(inp.settings), cal = createCalendar(s);
        var from = inp.from, blocked = inp.blocked || {}, jobs = inp.jobs || [], machines = inp.machines || [];
        var trace = typeof inp.trace === 'function' ? inp.trace : null;
        var st = {}, order = [], jobById = {}, poolByCyl = {}, offByCyl = {};
        machines.forEach(function(m) {
            st[m.id] = { machine: m, cursor0: cal.cursorAt(from), prev0: null, fixed: [], seq: [], cursor: null, prev: null };
            order.push(m.id);
        });
        jobs.forEach(function(j) { jobById[j.id] = j; });
        (inp.shafts || []).forEach(function(sh) {
            if (!sh || !sh.cylinderId) return;
            var to = sh.off ? offByCyl : poolByCyl;
            (to[String(sh.cylinderId)] = to[String(sh.cylinderId)] || []).push({ id: String(sh.id), no: String(sh.no == null ? '' : sh.no), off: !!sh.off });
        });
        function say(j, machineId, text) { if (trace) trace({ jobId: j ? String(j.id) : '', machineId: machineId ? String(machineId) : '', text: text }); }
        function mName(id) { return (st[id] && st[id].machine.name) || String(id); }
        function tt(ts) { return traceTime(ts, s); }
        function curTs(c) { c = cal.normalize(c); return cal.dayTs(c.day, s.dayStartMin + c.used); }

        // Валы типоразмера задания: серийные из inp.shafts, без них — один вал типоразмера.
        function poolOf(j) {
            var k = shaftKey(j);
            if (!k) return [];
            if (poolByCyl[String(j.cylinderId)]) return poolByCyl[String(j.cylinderId)];
            return offByCyl[String(j.cylinderId)] ? [] : [{ id: k, no: '', virtual: true }];
        }
        // все серийные валы типоразмера сняты с работы (#5726)
        function noWorkingShaft(j) { return !!(shaftKey(j) && !poolByCyl[String(j.cylinderId)] && offByCyl[String(j.cylinderId)]); }
        function shaftNoText(sh) { return sh && sh.no ? ' №' + sh.no : ''; }
        // Занятость физических валов: { id вала: [{ start, end, machineId, jobId }] }; null — валы не
        // проверяются (перестановки внутри станка в improve), иначе place() выбирает свободный вал.
        var shafts = null, shaftOfJob = {};
        function shaftAdd(j, item, machineId) {
            var k = item.shaftKey || item.shaftId;
            if (!shafts || !k) return;
            (shafts[k] = shafts[k] || []).push({ start: item.start, end: item.end, machineId: String(machineId), jobId: String(j.id) });
            shaftOfJob[j.id] = k;
        }
        function busyOn(shId, machineId, jobId, a, b) {
            return (shafts[shId] || []).filter(function(i) { return i.machineId !== String(machineId) && i.jobId !== String(jobId) && i.start < b && i.end > a; });
        }
        // Уже стоящие задания (начатые, выполненные сегодня): записанный вал, иначе свободный в их время.
        function shaftReset() {
            shafts = {}; shaftOfJob = {};
            order.forEach(function(id) {
                st[id].fixed.forEach(function(it) {
                    var j = jobById[it.jobId], pool = j ? poolOf(j) : [];
                    var own = j ? (offByCyl[String(j.cylinderId)] || []).filter(function(p) { return p.id === String(j.shaftId || ''); })[0] : null;
                    if (own) pool = [own].concat(pool);
                    if (!pool.length) return;
                    var sh = pool.filter(function(p) { return p.id === String(j.shaftId || ''); })[0] ||
                        pool.filter(function(p) { return !busyOn(p.id, id, j.id, it.start, it.end).length; })[0] || pool[0];
                    it.shaftId = sh.virtual ? '' : sh.id; it.shaftNo = sh.no; it.shaftKey = sh.id;
                    shaftAdd(j, it, id);
                });
            });
        }
        function buildItem(job, segs, setup, kind, run, fixed) {
            var last = segs[segs.length - 1];
            return { jobId: job.id, machineId: '', start: segs[0].start, end: last.end, setup: setup, setupKind: kind, run: run,
                due: job.due || 0, late: job.due > 0 && last.end > job.due, fixed: !!fixed, segments: segs };
        }
        function tagSegs(segs, jobId) { segs.forEach(function(g) { g.jobId = jobId; }); return segs; }

        // Размещение задания после prev с курсора cur. Валы проверяются: из валов типоразмера берётся тот,
        // на котором задание закончится раньше (при равенстве — уже стоящий на станке); занятый на другом
        // станке вал ждут. Другой физический вал или вал, побывавший на другом станке после prev, — смена вала.
        function place(cur, prev, job, machine) {
            var pool = shafts ? poolOf(job) : [];
            if (!pool.length) {
                var raw = placeRaw(cur, prev, job, machine, false);
                if (shafts && noWorkingShaft(job)) raw.item.noShaft = true;
                return raw;
            }
            var mounted = prev ? shaftOfJob[prev.id] : '', t0 = curTs(cur), best = null;
            pool.forEach(function(sh) {
                var c = cur, wait = null;
                var remount = !!(prev && sameCylinder(prev, job) && mounted && mounted !== sh.id);
                var r = placeRaw(c, prev, job, machine, remount);
                for (var g = 0; g < 2000; g++) {
                    if (!remount && prev && r.item.setupKind !== 'cylinder' && busyOn(sh.id, machine.id, job.id, t0, r.item.start).length) {
                        remount = true; r = placeRaw(c, prev, job, machine, true); continue;
                    }
                    var list = busyOn(sh.id, machine.id, job.id, r.item.start, r.item.end);
                    if (!list.length) break;
                    wait = list.sort(function(x, y) { return x.end - y.end; })[0];
                    c = floorCur(c, cal.cursorAt(wait.end));
                    r = placeRaw(c, prev, job, machine, remount);
                }
                var better = !best || r.item.end < best.r.item.end || (r.item.end === best.r.item.end && sh.id === mounted && best.sh.id !== mounted);
                if (better) best = { sh: sh, r: r, wait: wait, remount: remount };
            });
            var r = best.r;
            r.item.shaftId = best.sh.virtual ? '' : best.sh.id; r.item.shaftNo = best.sh.no;
            r.item.shaftKey = best.sh.id;
            if (best.wait) r.item.shaftWait = { until: best.wait.end, machineId: best.wait.machineId, jobId: best.wait.jobId, cylinder: String(job.cylinder || ''), no: best.sh.no };
            if (best.remount && prev && sameCylinder(prev, job)) r.item.remount = true;
            return r;
        }
        function placeRaw(cur, prev, job, machine, forceCylinder) {
            var kind = forceCylinder ? 'cylinder' : setupKind(prev, job), setup = setupMinutesOfKind(kind, s, machine), run = jobRunMinutes(job, s), segs = [], c = cur;
            if (setup > 0) { var a = cal.advance(c, setup, 'setup-' + kind); segs = segs.concat(a.segments); c = a.cursor; }
            if (run > 0 || !segs.length) { var b = cal.advance(c, run, 'run'); segs = segs.concat(b.segments); c = b.cursor; }
            tagSegs(segs, job.id);
            var item = buildItem(job, segs, setup, kind, run, false);
            return { item: item, cursor: c };
        }
        // Задание, которое уже стоит: со своего старта и своей наладкой.
        function layoutFixed(job, machine) {
            var setup = num(job.setup), run = num(job.duration) > 0 ? num(job.duration) : jobRunMinutes(job, s);
            var kind = kindOfSetup(setup, s, machine);
            var c = cal.cursorAt(job.start), segs = [];
            if (setup > 0) { var a = cal.advance(c, setup, 'setup-' + kind); segs = segs.concat(a.segments); c = a.cursor; }
            var b = cal.advance(c, run, 'run'); segs = segs.concat(b.segments); c = b.cursor;
            tagSegs(segs, job.id);
            var item = buildItem(job, segs, setup, kind, run, true);
            return { item: item, cursor: c };
        }

        // Что уже стоит на станках: начатые неподвижны, выполненные — память о наладке.
        var hist = {};
        jobs.forEach(function(j) {
            if (!j.machineId || !st[j.machineId]) return;
            if (isStarted(j) && !isDone(j) && !isFinal(j) || isDone(j)) (hist[j.machineId] = hist[j.machineId] || []).push(j);
        });
        var todayStart = cal.dayTs(cal.dayOf(from), 0);
        order.forEach(function(id) {
            var h = (hist[id] || []).sort(function(a, b) { return a.start - b.start; }), x = st[id], prev = null;
            h.forEach(function(j) {
                if (isDone(j)) {
                    if (j.start >= todayStart) { var f = layoutFixed(j, x.machine); f.item.machineId = id; f.item.done = true; x.fixed.push(f.item); }
                    if (j.start <= from) prev = j;
                } else {
                    var r = layoutFixed(j, x.machine); r.item.machineId = id; x.fixed.push(r.item);
                    if (curKey(r.cursor) > curKey(x.cursor0)) x.cursor0 = r.cursor;
                    prev = j;
                }
            });
            x.prev0 = prev; x.cursor = x.cursor0; x.prev = prev;
        });

        // Размещаемые задания.
        var unplaced = [];
        var cands = [];
        jobs.forEach(function(j) {
            if (!isMovable(j)) return;
            if (blocked[j.id] && blocked[j.id].length) { unplaced.push({ jobId: j.id, reasons: blocked[j.id].slice() }); return; }
            cands.push(j);
        });
        cands.sort(compareJobs);
        // Метраж серии (задания одного артикула) — для «Мин. метража серии» станка (#5428).
        var series = seriesFootage(cands);

        // Зафиксированные диспетчером («Зафиксировано», #5376) — как 🔒 Фазы 1: где зафиксировали, там и
        // стоят. Задание держит станок и день своего план-старта и место в дне: свободные задания в его
        // день перед ним не встают, кроме тех, что стояли перед ним в записанном плане того же станка и
        // дня (они идут перед ним в записанном порядке — «ведомые»); порядок 🔒 дня не меняется.
        // День без смен (выходной) — 🔒 уходит на ближайший рабочий. Без станка признак не действует.
        var anchorDay = {}, byMachineAnchored = {};
        var lockedSet = {};
        cands.forEach(function(j) {
            if (!j.fixed || !st[j.machineId]) return;
            var chk = machineAllows(st[j.machineId].machine, j, s, series[j.id]);
            if (!chk.ok) { unplaced.push({ jobId: j.id, reasons: ['зафиксировано на «' + (st[j.machineId].machine.name || j.machineId) + '»: ' + chk.reason] }); lockedSet[j.id] = 'drop'; return; }
            lockedSet[j.id] = 'fixed';
        });
        var byRecorded = function(a, b) { return (num(a.start) || 0) - (num(b.start) || 0) || (num(a.id) - num(b.id)); };
        order.forEach(function(id) {
            var x = st[id];
            var fixedHere = cands.filter(function(j) { return lockedSet[j.id] === 'fixed' && String(j.machineId) === String(id); }).sort(byRecorded);
            var list = [];
            fixedHere.forEach(function(f, k) {
                var day = num(f.start) > 0 ? cal.dayOf(num(f.start)) : null;
                var prevF = k > 0 ? fixedHere[k - 1] : null;
                var dc = day == null ? x.cursor0 : cal.normalize({ day: day, used: 0 });
                // ведомые: стояли на этом станке в тот же день перед 🔒 (после предыдущего 🔒 дня)
                if (day != null) cands.filter(function(j) {
                    return !lockedSet[j.id] && String(j.machineId) === String(id) && num(j.start) > 0 && cal.dayOf(num(j.start)) === day &&
                        byRecorded(j, f) < 0 && (!prevF || byRecorded(prevF, j) < 0) && machineAllows(x.machine, j, s, series[j.id]).ok;
                }).sort(byRecorded).forEach(function(j) { lockedSet[j.id] = 'lead'; anchorDay[j.id] = dc; list.push(j); });
                anchorDay[f.id] = dc; list.push(f);
            });
            byMachineAnchored[id] = list;
            x.pend = list.slice();
        });
        cands = cands.filter(function(j) { return !lockedSet[j.id]; });
        function isAnchored(j) { return !!anchorDay[j.id]; }
        function floorCur(cur, c) { return c && curKey(c) > curKey(cur) ? c : cur; }

        // Туррель берёт неподходящие ей задания только как обычный станок: когда её очередь
        // (подходящие туррели задания) пуста TURREL_IDLE_MN рабочих минут (#5376).
        // Проход 1 — туррель только под свою очередь; проход 2 — её очередь остаётся как есть,
        // остальные задания раскладываются заново, туррель открыта им с конца очереди + простой.
        // Появились задания туррели — при следующем «Упорядочить» очередь растёт, обычные уходят.
        var turrets = order.filter(function(id) { return st[id].machine.turret; });

        // Закреплённые, чей день наступил, встают раньше свободных.
        function settle(x) {
            while (x.pend.length && curKey(x.cursor) >= curKey(anchorDay[x.pend[0].id])) {
                var j = x.pend.shift(), t = place(floorCur(x.cursor, anchorDay[j.id]), x.prev, j, x.machine);
                shaftAdd(j, t.item, x.machine.id);
                x.seq.push(j); x.cursor = t.cursor; x.prev = j;
            }
        }
        // Проба свободного задания на станке с курсора cur: если оно залезает в день очередного 🔒,
        // сначала встают закреплённые этого дня, потом задание. → { t, flush, prev }.
        function tryOn(x, j, cur) {
            var c = cur, prev = x.prev, k = 0;
            for (;;) {
                var t = place(c, prev, j, x.machine), nx = x.pend[k];
                if (!nx || curKey(t.cursor) <= curKey(anchorDay[nx.id])) return { t: t, flush: k };
                var d = anchorDay[nx.id];
                while (k < x.pend.length && curKey(anchorDay[x.pend[k].id]) <= curKey(floorCur(c, d))) {
                    var a = x.pend[k], ta = place(floorCur(c, anchorDay[a.id]), prev, a, x.machine);
                    c = ta.cursor; prev = a; k++;
                }
                if (curKey(cur) > curKey(c)) c = cur;
            }
        }
        function commitOn(x, j, r) {
            for (var i = 0; i < r.flush; i++) {
                var a = x.pend.shift(), ta = place(floorCur(x.cursor, anchorDay[a.id]), x.prev, a, x.machine);
                shaftAdd(a, ta.item, x.machine.id);
                x.seq.push(a); x.cursor = ta.cursor; x.prev = a;
            }
            shaftAdd(j, r.t.item, x.machine.id);
            x.seq.push(j); x.cursor = r.t.cursor; x.prev = j;
            settle(x);
        }
        shaftReset();
        order.forEach(function(id) { settle(st[id]); });

        // open — { id туррели: курсор, с которого она берёт неподходящие задания } (проход 2) или null.
        function assignOne(j, open, sink) {
            var best = null, turret = null, reasons = [], tried = [], fits = turrets.some(function(id) { return turretFits(j, st[id].machine, series[j.id]); });
            // записанное на туррель неподходящее задание остаётся на ней, если туррель свободна сразу
            var pinned = open ? turrets.filter(function(id) {
                return !fits && String(j.machineId || '') === String(id) && curKey(open[id]) <= curKey(st[id].cursor);
            })[0] : null;
            order.forEach(function(id) {
                if (pinned && id !== pinned) return;
                var x = st[id], m = x.machine, cur = x.cursor, chk;
                if (m.turret && open && fits) return;   // подходящее туррели решено в проходе 1
                if (m.turret && !fits) {
                    // туррель как обычный станок (ограничения туррели снимаются: её отцепляют)
                    chk = machineAllows(m, Object.assign({}, j, { machineId: open ? m.id : '' }), s, series[j.id]);
                    if (open && chk.ok) cur = floorCur(cur, open[id]);
                } else chk = machineAllows(m, j, s, series[j.id]);
                if (!chk.ok) { reasons.push((m.name || id) + ': ' + chk.reason); tried.push({ name: m.name || id, reason: chk.reason }); return; }
                var r = tryOn(x, j, cur), t = r.t;
                tried.push({ name: m.name || id, end: t.item.end, setup: t.item.setup, wait: t.item.shaftWait });
                var better = !best || t.item.end < best.r.t.item.end || (t.item.end === best.r.t.item.end && t.item.setup < best.r.t.item.setup);
                if (better) best = { id: id, r: r };
                if (m.turret && (!turret || t.item.end < turret.r.t.item.end)) turret = { id: id, r: r };
            });
            // подходящее туррели — на туррель, если там оно не уходит в просрочку (или и так опаздывает везде)
            var why = 'раньше всех заканчивается';
            if (turret && best && turret.id !== best.id && fits) {
                var due = num(j.due);
                if (!(due > 0) || turret.r.t.item.end <= due || best.r.t.item.end > due) { best = turret; why = 'подходит туррели и не уходит на ней в просрочку'; }
            }
            if (trace) {
                var head = traceLabel(j) + (open ? ' [проход 2]' : '') + (fits ? ' — подходит туррели' : '') + (pinned ? ' — записано на туррель, она свободна' : '');
                say(j, best ? best.id : '', head + ': ' + tried.map(function(c) {
                    return c.reason ? c.name + ' — нельзя: ' + c.reason : c.name + ' — конец ' + tt(c.end) + ' (наладка ' + c.setup + ' мин' +
                        (c.wait ? ', ждёт вал ' + c.wait.cylinder + shaftNoText({ no: c.wait.no }) + ' до ' + tt(c.wait.until) + ' с «' + mName(c.wait.machineId) + '»' : '') + ')';
                }).join('; ') + (best ? ' → «' + mName(best.id) + '»: ' + why : ' → не размещено'));
            }
            if (!best) { sink.push({ jobId: j.id, reasons: reasons.length ? reasons : ['нет станков'] }); return; }
            commitOn(st[best.id], j, best.r);
        }
        var pass1 = [];
        cands.forEach(function(j) { assignOne(j, null, turrets.length ? pass1 : unplaced); });
        if (turrets.length) {
            var open = {}, queued = {};
            turrets.forEach(function(id) {
                var x = st[id], last = null, its = runSeq(x, x.seq).items;
                its.forEach(function(it, i) { if (turretFits(x.seq[i], x.machine, series[x.seq[i].id])) last = cal.cursorAt(it.end); });
                if (!last) (hist[id] || []).forEach(function(j) {
                    if (!turretFits(j, x.machine, series[j.id])) return;
                    var c = layoutFixed(j, x.machine).cursor;
                    if (!last || curKey(c) > curKey(last)) last = c;
                });
                // очереди туррели не было — она простаивает давно, открыта сразу
                open[id] = last ? (s.turretIdle > 0 ? cal.advance(last, s.turretIdle, 'idle').cursor : cal.normalize(last)) : x.cursor0;
                x.openAt = open[id];
                x.queue = x.seq.filter(function(j) { return !isAnchored(j); });
                x.queueIds = {};
                x.queue.forEach(function(j) { queued[j.id] = true; x.queueIds[j.id] = true; });
            });
            shaftReset();
            order.forEach(function(id) { var x = st[id]; x.seq = []; x.cursor = x.cursor0; x.prev = x.prev0; x.pend = byMachineAnchored[id].slice(); settle(x); });
            turrets.forEach(function(id) {
                var x = st[id];
                x.queue.forEach(function(j) { commitOn(x, j, tryOn(x, j, x.cursor)); });
            });
            cands.forEach(function(j) { if (!queued[j.id]) assignOne(j, open, unplaced); });
        }
        // Закреплённые, до дня которых свободные задания не дошли.
        order.forEach(function(id) {
            var x = st[id];
            while (x.pend.length) {
                var a = x.pend.shift(), ta = place(floorCur(x.cursor, anchorDay[a.id]), x.prev, a, x.machine);
                shaftAdd(a, ta.item, x.machine.id);
                x.seq.push(a); x.cursor = ta.cursor; x.prev = a;
            }
        });

        function runSeq(x, seq) {
            var cur = x.cursor0, prev = x.prev0, items = [], setupTotal = 0, open = x.openAt;
            seq.forEach(function(j) {
                if (isAnchored(j)) cur = floorCur(cur, anchorDay[j.id]);
                // обычное задание на туррели — не раньше, чем она открыта (конец очереди + простой)
                else if (open && x.queueIds && !x.queueIds[j.id]) cur = floorCur(cur, open);
                var t = place(cur, prev, j, x.machine);
                t.item.machineId = x.machine.id;
                if (lockedSet[j.id] === 'fixed') t.item.locked = true;
                items.push(t.item); setupTotal += t.item.setup; cur = t.cursor; prev = j;
            });
            return { items: items, setupTotal: setupTotal };
        }
        // Минуты просрочки заданий со сроком: Σ max(0, конец − срок).
        function lateMinutes(items) {
            return Math.round(items.reduce(function(a, i) { return a + (i.due > 0 && i.end > i.due ? i.end - i.due : 0); }, 0) / 60);
        }
        // Группировка вал → нож → сырьё без новой просрочки. Переставляются только свободные задания
        // внутри участков между закреплёнными; у туррели — только её очередь. 🔒 не меняет день.
        function improve(x) {
            var seq = x.seq.slice(), base = runSeq(x, seq);
            var movable = function(j) { return !isAnchored(j) && (!x.queueIds || !!x.queueIds[j.id]); };
            var dayOfItems = function(r) { var d = {}; r.items.forEach(function(i) { if (anchorDay[i.jobId]) d[i.jobId] = cal.dayOf(i.start); }); return d; };
            var baseDays = dayOfItems(base);
            for (var p = 0; p < seq.length - 1; p++) {
                if (!movable(seq[p]) || !movable(seq[p + 1])) continue;
                var cur = seq[p], bestQ = -1, bestR = affinity(cur, seq[p + 1]);
                for (var q = p + 2; q < seq.length && movable(seq[q]); q++) {
                    var r = affinity(cur, seq[q]);
                    if (r > bestR) { bestR = r; bestQ = q; }
                }
                if (bestQ < 0) continue;
                var trial = seq.slice(), moved = trial.splice(bestQ, 1)[0];
                trial.splice(p + 1, 0, moved);
                var t = runSeq(x, trial);
                var what = 'группировка: после ' + traceLabel(cur) + ' поставить ' + traceLabel(moved) + ' вместо ' + traceLabel(seq[p + 1]);
                if (t.setupTotal >= base.setupTotal) { say(moved, x.machine.id, what + ' — нет: наладка не уменьшается (' + t.setupTotal + ' ≥ ' + base.setupTotal + ' мин)'); continue; }
                // Задание в срок не уходит за срок. Просроченное группировка задерживать может, если
                // суммарная просрочка участка не растёт (#5720).
                var ends = {}, worse = null, delayed = [];
                base.items.forEach(function(i) { ends[i.jobId] = i.end; });
                var ok = t.items.every(function(i) {
                    if (!(i.due > 0) || i.end <= ends[i.jobId]) return true;
                    if (ends[i.jobId] > i.due) { delayed.push(i); return true; }
                    if (i.end <= i.due) return true;
                    worse = i; return false;
                });
                var lateBase = lateMinutes(base.items), lateTrial = lateMinutes(t.items);
                if (ok && delayed.length && lateTrial > lateBase) ok = false;
                var days = dayOfItems(t), shifted = null;
                if (ok) ok = Object.keys(days).every(function(k) { if (days[k] <= baseDays[k]) return true; shifted = k; return false; });
                var lateText = ' суммарная просрочка ' + lateBase + ' → ' + lateTrial + ' мин';
                if (ok) {
                    say(moved, x.machine.id, what + ' — да: наладка ' + base.setupTotal + ' → ' + t.setupTotal + ' мин' +
                        (delayed.length ? '; просроченные позже: ' + delayed.map(function(i) { return 'задание ' + i.jobId + ' на ' + Math.round((i.end - ends[i.jobId]) / 60) + ' мин'; }).join(', ') + ',' + lateText : ''));
                    seq = trial; base = t; baseDays = days;
                } else if (worse) say(moved, x.machine.id, what + ' — нет: ' + traceLabel(jobById[worse.jobId] || { id: worse.jobId }) + ' уйдёт за срок: закончится ' + tt(worse.end) +
                    ', срок ' + tt(worse.due) + ' (наладка сэкономила бы ' + (base.setupTotal - t.setupTotal) + ' мин)');
                else if (shifted) say(moved, x.machine.id, what + ' — нет: 🔒 задание ' + shifted + ' сдвинется на другой день');
                else say(moved, x.machine.id, what + ' — нет: просроченное ' + traceLabel(jobById[delayed[0].jobId] || { id: delayed[0].jobId }) + ' закончится позже на ' +
                    Math.round((delayed[0].end - ends[delayed[0].jobId]) / 60) + ' мин, а' + lateText + ' (наладка сэкономила бы ' + (base.setupTotal - t.setupTotal) + ' мин)');
            }
            x.seq = seq;
            return base;
        }

        // Порядок на станке — improve без учёта валов; затем раскладка всех станков сразу по времени:
        // очередное задание того станка, что начинает раньше, ждёт свой вал, если он на другом станке.
        function layoutAll() {
            shaftReset();
            var lanes = order.map(function(id) { var x = st[id]; return { x: x, i: 0, cur: x.cursor0, prev: x.prev0, items: [] }; });
            for (;;) {
                var pick = null;
                lanes.forEach(function(L) {
                    if (L.i >= L.x.seq.length) return;
                    var j = L.x.seq[L.i], cur = L.cur;
                    if (isAnchored(j)) cur = floorCur(cur, anchorDay[j.id]);
                    else if (L.x.openAt && L.x.queueIds && !L.x.queueIds[j.id]) cur = floorCur(cur, L.x.openAt);
                    var t = place(cur, L.prev, j, L.x.machine);
                    if (!pick || t.item.start < pick.t.item.start) pick = { L: L, j: j, t: t };
                });
                if (!pick) break;
                var L = pick.L, it = pick.t.item;
                it.machineId = L.x.machine.id;
                if (lockedSet[pick.j.id] === 'fixed') it.locked = true;
                if (it.noShaft) say(pick.j, it.machineId, traceLabel(pick.j) + ': нет рабочего вала ' + String(pick.j.cylinder || '') + ' — все валы типоразмера «Не ставить в работу»');
                if (it.shaftWait) say(pick.j, it.machineId, traceLabel(pick.j) + ' на «' + mName(it.machineId) + '» ждёт вал ' + it.shaftWait.cylinder + shaftNoText({ no: it.shaftWait.no }) + ' до ' + tt(it.shaftWait.until) +
                    ': он на «' + mName(it.shaftWait.machineId) + '» (задание ' + it.shaftWait.jobId + ')');
                if (it.remount) say(pick.j, it.machineId, traceLabel(pick.j) + ' на «' + mName(it.machineId) + '»: вал побывал на другом станке — снова смена вала');
                shaftAdd(pick.j, it, it.machineId);
                L.items.push(it); L.cur = pick.t.cursor; L.prev = pick.j; L.i++;
            }
            var res = {};
            lanes.forEach(function(L) { res[L.x.machine.id] = L.items; });
            return res;
        }
        shafts = null;
        order.forEach(function(id) { improve(st[id]); });
        var laid = layoutAll();

        var out = {}, summary = { jobs: 0, late: 0, setupMinutes: 0, cylinderChanges: 0 };
        order.forEach(function(id) {
            var x = st[id];
            var items = x.fixed.concat(laid[id]).sort(function(a, b) { return a.start - b.start; });
            out[id] = { items: items };
            items.forEach(function(i) {
                if (i.done) return;
                if (i.late) summary.late++;
                if (!i.fixed) {
                    summary.jobs++; summary.setupMinutes += i.setup;
                    if (i.setupKind === 'cylinder') summary.cylinderChanges++;
                }
            });
        });
        return { machines: out, unplaced: unplaced, summary: summary, from: from };
    }

    // ── Блокировки и предупреждения ─────────────────────────────────────────

    // ctx — { dies: { id ножа: { state, mileage, resource } } (пробег и ресурс — в оборотах),
    //         openRevs: { id ножа: обороты открытых заданий },
    //         cover: { id задания: { deficit } } }.
    function jobFlags(job, ctx) {
        var c = ctx || {}, blocks = [], warnings = [];
        var die = job.dieId ? (c.dies || {})[job.dieId] : null;
        if (!job.dieId) blocks.push('нет ножа');
        else if (die) {
            var st = LP.dieStateOf(die.state);
            if (st === LP.DIE_STATE.WRITTEN_OFF) blocks.push('нож списан');
            else if (st && st !== LP.DIE_STATE.WORKING) warnings.push('нож в состоянии «' + st + '»');
            var res = num(die.resource);
            if (res > 0) {
                var forecast = num(die.mileage) + num((c.openRevs || {})[job.dieId]);
                if (forecast >= res * 0.9) warnings.push('ресурс ножа: прогноз пробега ' + Math.round(forecast / res * 100) + ' % ресурса');
            }
        }
        var cv = (c.cover || {})[job.id];
        // Нет МР — не блокировка: станок и день назначаются, нехватка МР видна предупреждением и во вкладке «Дефицит форматов» (#5553).
        if (cv && num(cv.deficit) > 0) warnings.push('нет МР нужного формата');
        return { blocks: blocks, warnings: warnings };
    }

    // Обороты задания: метраж × 1000 / раппорт вала задания (job.repeatMm); раппорт неизвестен — 0.
    function jobRevs(job) {
        var r = LP.revsFromMeters(num(job && job.footage), job && job.repeatMm);
        return isFinite(r) ? r : 0;
    }

    // Обороты ножа, которые ему предстоят: сумма оборотов незавершённых заданий ножа.
    function openRevsByDie(jobs) {
        var out = {};
        (jobs || []).forEach(function(j) { if (!isFinal(j) && j.dieId) out[j.dieId] = (out[j.dieId] || 0) + jobRevs(j); });
        return out;
    }

    // ── Мастер-рулоны ───────────────────────────────────────────────────────

    // Порядок, в котором задания берут склад МР, — порядок построения плана: начатые (уже стоят на станке)
    // по своему старту, затем остальные так, как их раскладывает orderQueue (compareJobs: срок, номер
    // задания). От записанного план-старта свободных заданий он не зависит: «Применить» не перекладывает
    // рулоны, и повторное «Упорядочить» даёт тот же план.
    function coverOrder(a, b) {
        var sa = isMovable(a) ? 1 : 0, sb = isMovable(b) ? 1 : 0;
        if (sa !== sb) return sa - sb;
        if (!sa) return (num(a.start) - num(b.start)) || (num(a.id) - num(b.id));
        return compareJobs(a, b);
    }

    // Покрытие заданий мастер-рулонами — одна мера для блокировки «нет МР нужного формата» и вкладки
    // «Дефицит форматов»; «Зарезервировать МР» показывает тот же расчёт у заданий с нехваткой.
    // Задания идут в порядке построения плана (coverOrder):
    //   нужно    = метраж задания − уже вырубленное (расход журнала по заданию);
    //   резерв   = свои рулоны на складе: резерв у рулона на это задание или поле «Мастер-рулон» задания;
    //   остатки  = метры, которые никому не нужны: свободные початые рулоны и у рулона, за которым стоит
    //              другое открытое задание (резерв или вырубка), — его остаток сверх потребности этого
    //              задания; остатки берутся первыми;
    //   целые    = свободные целые рулоны склада (их берёт «Зарезервировать МР»);
    //   в резке  = очередь первичной резки; дефицит — что не покрыто.
    // Склад считается в метрах: один рулон может покрыть несколько заданий. Рулон за заданием, которого
    // нет в списке заданий склада (потребность неизвестна), отдаёт 0 м.
    // rolls — рулоны склада МР ({ id, format, materialId, rest, status, reserveTaskId });
    // queue — источники JC.queueSupply; opts — { tasks: задания склада МР (MR.buildTasks), moves: журнал }.
    function jobDemand(jobs, rolls, tolerance, opts) {
        var o = opts || {}, moves = o.moves || [], idx = {}, byJob = {};
        (o.tasks || []).forEach(function(t) { idx[t.id] = t; });
        var list = (jobs || []).filter(function(j) { return num(j.minFormat) || num(j.usedFormat) || num(j.optFormat); })
            .sort(coverOrder);
        list.forEach(function(j) { byJob[j.id] = j; });
        var stockRolls = (rolls || []).filter(function(r) { return MR.onStock(r); });
        var consumed = function(id) {
            var c = 0;
            moves.forEach(function(m) { if (m.kind === MR.MOVE_KIND.OUT && String(m.taskId) === String(id)) c -= num(m.delta); });
            return c;
        };
        var needOf = function(id) { var j = byJob[id] || idx[id]; return j ? Math.max(0, round1(num(j.footage) - consumed(id))) : Infinity; };
        // за кем стоит рулон: резерв (своё задание или открытое чужое; неизвестное — держит), поле
        // «Мастер-рулон» задания, вырубка открытым заданием
        var holderOf = {};
        stockRolls.forEach(function(r) {
            var rt = r.reserveTaskId ? String(r.reserveTaskId) : '';
            if (rt && (byJob[rt] || !idx[rt] || idx[rt].open)) holderOf[r.id] = rt;
        });
        list.forEach(function(j) { if (j.masterRollId && !holderOf[j.masterRollId]) holderOf[j.masterRollId] = j.id; });
        stockRolls.forEach(function(r) { if (!holderOf[r.id]) { var h = MR.holder(r, idx, moves); if (h) holderOf[r.id] = String(h); } });
        // потребность держателя ложится на его рулоны (старые первыми), остальное — остаток
        var held = {}, spare = {}, ownCover = {};
        stockRolls.forEach(function(r) { var h = holderOf[r.id]; if (h) (held[h] = held[h] || []).push(r); });
        Object.keys(held).forEach(function(h) {
            var left = needOf(h);
            held[h].sort(function(a, b) { return num(a.id) - num(b.id); }).forEach(function(r) {
                var use = Math.min(left, num(r.rest));
                left -= use;
                ownCover[h] = round1((ownCover[h] || 0) + use);
                spare[r.id] = Math.max(0, round1(num(r.rest) - use));
            });
        });
        var pool = [];
        stockRolls.forEach(function(r) {
            var whole = norm(r.status) === MR.ROLL_STATUS.STOCK;
            if (holderOf[r.id]) { if (spare[r.id] > 0) pool.push({ id: String(r.id), materialId: String(r.materialId), format: num(r.format), left: spare[r.id], kind: 'leftover' }); }
            else pool.push({ id: String(r.id), materialId: String(r.materialId), format: num(r.format), left: num(r.rest), kind: whole ? 'whole' : 'leftover' });
        });
        pool.sort(function(a, b) { return (a.kind === b.kind ? 0 : a.kind === 'leftover' ? -1 : 1) || a.format - b.format || num(a.id) - num(b.id); });
        var demand = list.map(function(j) {
            var min = num(j.minFormat) || num(j.usedFormat) || num(j.optFormat), range = JC.formatRange(min, j.optFormat, tolerance);
            var need = needOf(j.id), reserved = Math.min(need, ownCover[j.id] || 0);
            return { key: j.id, jobId: j.id, materialId: String(j.materialId), material: j.material, min: range.min, max: range.max,
                need: need, reserved: round1(reserved), meters: Math.max(0, round1(need - reserved)), due: num(j.start) };
        });
        return { demand: demand, pool: pool };
    }

    // Склад в метрах (остатки, затем целые; формат в [мин. формат ножа, + допуск], как у резерва),
    // затем очередь первичной резки (JC.coverDemand).
    function coverAll(jobs, rolls, queue, tolerance, opts) {
        var d = jobDemand(jobs, rolls, tolerance, opts);
        var rest = d.demand.map(function(g) {
            var left = g.meters, got = { whole: 0, leftover: 0 }, hi = g.min + num(tolerance);
            d.pool.forEach(function(s) {
                if (!(left > 0) || !(s.left > 0)) return;
                if (s.materialId !== g.materialId || s.format < g.min || s.format > hi) return;
                var m = Math.min(left, s.left);
                s.left -= m; left -= m; got[s.kind] += m;
            });
            return Object.assign({}, g, { meters: Math.max(0, round1(left)), whole: round1(got.whole), leftover: round1(got.leftover) });
        });
        var covered = JC.coverDemand(rest, [], queue || []).map(function(c) { return Object.assign(c, { stock: round1(c.whole + c.leftover) }); });
        return { demand: d, covered: covered };
    }

    // → { id задания: { need, reserved, stock, whole, leftover, planned, deficit, late } }.
    function coverJobs(jobs, rolls, queue, tolerance, opts) {
        var out = {};
        coverAll(jobs, rolls, queue, tolerance, opts).covered.forEach(function(g) {
            out[g.jobId] = { need: g.need, reserved: g.reserved, stock: g.stock, whole: g.whole, leftover: g.leftover, planned: g.planned, deficit: g.deficit, late: g.late };
        });
        return out;
    }

    // Вкладка «Дефицит форматов»: та же мера, сложенная по сырью и диапазону формата.
    // → [{ key, materialId, material, min, max, meters (нужно), reserved, stock, whole, leftover, planned, deficit, due, late, jobs }].
    function coverGroups(jobs, rolls, queue, tolerance, opts) {
        var by = {}, order = [];
        coverAll(jobs, rolls, queue, tolerance, opts).covered.forEach(function(c) {
            var key = c.materialId + '|' + c.min + '|' + c.max;
            var g = by[key];
            if (!g) { g = by[key] = { key: key, materialId: c.materialId, material: c.material, min: c.min, max: c.max, meters: 0, reserved: 0, stock: 0, whole: 0, leftover: 0, planned: 0, deficit: 0, due: 0, late: false, jobs: [] }; order.push(key); }
            ['reserved', 'stock', 'whole', 'leftover', 'planned', 'deficit'].forEach(function(k) { g[k] = round1(g[k] + c[k]); });
            g.meters = round1(g.meters + c.need);
            if (c.late) g.late = true;
            if (c.due > 0 && (!g.due || c.due < g.due)) g.due = c.due;
            g.jobs.push(c.jobId);
        });
        return order.map(function(k) { return by[k]; });
    }

    // Резерв по заданиям (задания высечки в виде задач склада MR.buildTasks): рулоны подбираются
    // правилами склада (целые, формат в допуске, не чужие), один рулон — одному заданию.
    // Задания берут рулоны в порядке покрытия (coverOrder), если даны jobs — задания высечки; иначе по старту.
    // → [{ taskId, rollIds, deficit, need }] по заданиям с дефицитом.
    function planReservations(tasks, rolls, moves, tolerance, jobs) {
        var copy = (rolls || []).map(function(r) { return Object.assign({}, r); });
        var rank = {};
        (jobs || []).slice().sort(coverOrder).forEach(function(j, i) { rank[j.id] = i; });
        var rankOf = function(t) { return rank[t.id] != null ? rank[t.id] : Infinity; };
        var open = (tasks || []).filter(function(t) {
            var st = norm(t.status);
            return t.open && (st === '' || st === 'запланировано') && !t.currentRollId;
        }).sort(function(a, b) { var ra = rankOf(a), rb = rankOf(b); return (ra !== rb ? (ra < rb ? -1 : 1) : 0) || a.start - b.start || (num(a.id) - num(b.id)); });
        var out = [];
        open.forEach(function(t) {
            var need = MR.taskNeeds([t], copy, moves, tolerance)[0];
            if (!need || !(need.deficit > 0)) return;
            var pick = MR.autoPick(t, copy, moves, tolerance, need.deficit, tasks);
            copy.forEach(function(r) { if (pick.indexOf(String(r.id)) >= 0) r.reserveTaskId = t.id; });
            var got = round1(copy.filter(function(r) { return pick.indexOf(String(r.id)) >= 0; }).reduce(function(a, r) { return a + num(r.rest); }, 0));
            out.push({ taskId: t.id, rollIds: pick, need: need.need, deficit: Math.max(0, round1(need.deficit - got)) });
        });
        return out;
    }

    // ── Загрузка ножей и валов, Гант ────────────────────────────────────────

    function toolLoad(inp) {
        var s = withDefaults(inp.settings), until = inp.from + s.horizonDays * 86400;
        var byJob = {};
        (inp.jobs || []).forEach(function(j) { byJob[j.id] = j; });
        var knives = {}, cyls = {};
        function add(j, minutes, it, unplaced) {
            var kk = j.dieId || ('№' + j.dieNo);
            var k = knives[kk] || (knives[kk] = { dieId: j.dieId, dieNo: j.dieNo, jobs: 0, minutes: 0, meters: 0, planned: 0, plannedRevs: 0, unplaced: 0 });
            k.jobs++; k.minutes += minutes; k.meters = round1(k.meters + num(j.footage));
            if (!it || !it.fixed) { k.planned = round1(k.planned + num(j.footage)); k.plannedRevs += jobRevs(j); }
            var ck = j.cylinderId || j.cylinder;
            var c = cyls[ck] || (cyls[ck] = { cylinderId: j.cylinderId, cylinder: j.cylinder, jobs: 0, minutes: 0, changes: 0, unplaced: 0 });
            c.jobs++; c.minutes += minutes;
            if (it && it.setupKind === 'cylinder') c.changes++;
            if (unplaced) { k.unplaced++; c.unplaced++; }
        }
        Object.keys(inp.plan.machines).forEach(function(mid) {
            inp.plan.machines[mid].items.forEach(function(it) {
                var j = byJob[it.jobId];
                if (!j || it.done || it.start >= until) return;
                add(j, it.setup + it.run, it, false);
            });
        });
        // не размещённые «Упорядочить» (блокировка, нет станка) — нож и вал им всё равно нужны;
        // минуты — только вырубка, без наладки и без дня
        (inp.plan.unplaced || []).forEach(function(u) {
            var j = byJob[u.jobId];
            if (j) add(j, jobRunMinutes(j, s), null, true);
        });
        var dies = inp.dies || {};
        var kl = Object.keys(knives).map(function(k) {
            var x = knives[k], d = dies[x.dieId] || {}, res = num(d.resource), mil = num(d.mileage);
            x.mileage = mil; x.mileageAfter = mil + x.plannedRevs; x.resource = res;
            x.level = LP.dieWearLevel(x.mileageAfter, res);
            return x;
        }).sort(function(a, b) { return b.minutes - a.minutes; });
        var cl = Object.keys(cyls).map(function(k) { return cyls[k]; }).sort(function(a, b) { return b.minutes - a.minutes; });
        return { knives: kl, cylinders: cl, until: until };
    }

    // Записанный план (без «Упорядочить»): у каждого станка — записанные на него задания, кроме
    // выполненных и отменённых, по записанному старту, с записанной наладкой и длительностью.
    // Станок делает одно задание за раз: задание не начинается раньше конца предыдущего, записанные
    // пересечения раскладываются подряд (item.shifted — сдвиг от записанного старта, мин).
    // Задание без старта идёт за предыдущим или с from. Задания без станка в план не входят.
    function recordedPlan(jobs, machines, settings, from) {
        var s = withDefaults(settings), cal = createCalendar(s), out = {}, summary = { jobs: 0, late: 0, setupMinutes: 0, cylinderChanges: 0 };
        (machines || []).forEach(function(m) {
            var list = (jobs || []).filter(function(j) { return !isFinal(j) && String(j.machineId || '') === String(m.id); })
                .sort(function(a, b) { return (num(a.start) || Infinity) - (num(b.start) || Infinity) || (num(a.id) - num(b.id)); });
            var cur = null, items = [];
            list.forEach(function(j) {
                var setup = num(j.setup), run = num(j.duration) > 0 ? num(j.duration) : jobRunMinutes(j, s);
                var kind = kindOfSetup(setup, s, m);
                var c = num(j.start) > 0 ? cal.cursorAt(num(j.start)) : (cur || cal.cursorAt(num(from)));
                if (cur && curKey(cur) > curKey(c)) c = cur;
                var segs = [];
                if (setup > 0) { var a = cal.advance(c, setup, 'setup-' + kind); segs = segs.concat(a.segments); c = a.cursor; }
                if (run > 0 || !segs.length) { var b = cal.advance(c, run, 'run'); segs = segs.concat(b.segments); c = b.cursor; }
                cur = c;
                tagSegs(segs, j.id);
                var last = segs[segs.length - 1];
                var item = { jobId: j.id, machineId: m.id, start: segs[0].start, end: last.end, setup: setup, setupKind: kind, run: run,
                    due: j.due || 0, late: j.due > 0 && last.end > j.due, fixed: isStarted(j), segments: segs,
                    shifted: num(j.start) > 0 ? Math.max(0, Math.round((segs[0].start - num(j.start)) / 60)) : 0 };
                items.push(item);
                summary.jobs++; summary.setupMinutes += setup;
                if (item.late) summary.late++;
                if (kind === 'cylinder') summary.cylinderChanges++;
            });
            out[m.id] = { items: items };
        });
        return { machines: out, unplaced: [], summary: summary, from: from };
    }
    function tagSegs(segs, jobId) { segs.forEach(function(g) { g.jobId = jobId; }); return segs; }

    // Область записи «Применить» / «Задачи на втулки»: items — [{ jobId, machineId, start }];
    // scope — { all } | { machineId?, fromDay?, toDay? } | { jobIds }. Пустая область — ничего.
    function inScope(items, scope, settings) {
        var sc = scope || {}, cal = createCalendar(withDefaults(settings));
        if (sc.all) return (items || []).slice();
        if (Array.isArray(sc.jobIds)) return (items || []).filter(function(i) { return sc.jobIds.indexOf(String(i.jobId)) >= 0; });
        if (!sc.machineId && sc.fromDay == null && sc.toDay == null) return [];
        return (items || []).filter(function(i) {
            if (sc.machineId && String(i.machineId) !== String(sc.machineId)) return false;
            var d = cal.dayOf(num(i.start));
            if (sc.fromDay != null && d < sc.fromDay) return false;
            if (sc.toDay != null && d > sc.toDay) return false;
            return true;
        });
    }

    // Полосы дня по станкам: наладка вала, наладка ножа, вырубка; занято и свободно.
    // Выполненные задания не рисуются.
    function ganttDay(planMachines, machines, day, settings) {
        var s = withDefaults(settings), rows = [];
        (machines || []).forEach(function(m) {
            var bars = [], used = 0;
            ((planMachines[m.id] || { items: [] }).items).forEach(function(it) {
                if (it.done) return;
                it.segments.forEach(function(g) {
                    if (g.day !== day || !(g.minutes > 0)) return;
                    bars.push({ jobId: it.jobId, kind: it.fixed && g.kind === 'run' ? 'run' : g.kind, from: g.from, minutes: g.minutes, fixed: it.fixed, done: !!it.done });
                    used += g.minutes;
                });
            });
            bars.sort(function(a, b) { return a.from - b.from; });
            rows.push({ machineId: m.id, name: m.name || m.id, bars: bars, used: used, free: Math.max(0, s.dayCapacityMin - used) });
        });
        return { day: day, capacity: s.dayCapacityMin, rows: rows };
    }

    // Очередь колонками «станок × день»: колонка у каждого станка справочника (и без заданий),
    // в колонке — дни горизонта; в дне — задания дня по порядку, сумма минут и ёмкость смены.
    // Задание, перешедшее на следующий день, там — продолжение без наладки. Выполненные не показываются.
    function queueGrid(planMachines, machines, days, settings) {
        var s = withDefaults(settings);
        var columns = (machines || []).map(function(m) {
            var byDay = {};
            (days || []).forEach(function(d) { byDay[d] = { day: d, capacity: s.dayCapacityMin, minutes: 0, items: [] }; });
            (((planMachines || {})[m.id] || { items: [] }).items).forEach(function(it) {
                if (it.done) return;
                var firstDay = null;
                (it.segments || []).forEach(function(g) { if (firstDay == null || g.day < firstDay) firstDay = g.day; });
                var per = {};
                (it.segments || []).forEach(function(g) {
                    if (!byDay[g.day]) return;
                    var p = per[g.day] = per[g.day] || { setup: 0, run: 0, from: g.from };
                    if (/^setup/.test(g.kind)) p.setup += g.minutes; else p.run += g.minutes;
                    if (g.from < p.from) p.from = g.from;
                });
                Object.keys(per).forEach(function(k) {
                    var d = byDay[k], p = per[k], cont = Number(k) !== firstDay;
                    d.items.push({ jobId: it.jobId, from: p.from, setup: p.setup, run: p.run, minutes: p.setup + p.run,
                        setupKind: p.setup > 0 ? it.setupKind : 'none', continuation: cont, fixed: !!it.fixed, late: !!it.late, start: it.start });
                    d.minutes += p.setup + p.run;
                });
            });
            return { machineId: m.id, name: m.name || m.id, active: m.active !== false, status: m.status || '',
                days: (days || []).map(function(d) { var x = byDay[d]; x.items.sort(function(a, b) { return a.from - b.from; }); return x; }) };
        });
        return { columns: columns, capacity: s.dayCapacityMin };
    }

    // ── Формирование заданий ────────────────────────────────────────────────

    // positions — LO.positionFromRow; dies — LO.buildDies (+ cylinderId); jobs — buildJobs.
    function formJobs(inp) {
        var s = withDefaults(inp.settings), create = [], skipped = [];
        var mrLength = num(inp.mrLength) > 0 ? num(inp.mrLength) : s.mrLength;
        var lim = { mrLength: mrLength, dieSizeTolerance: s.dieSizeTolerance };
        var has = {};
        (inp.jobs || []).forEach(function(j) { if (norm(j.status) !== 'отменено' && j.positionId) has[j.positionId] = j.id; });
        (inp.positions || []).forEach(function(pos) {
            if (has[pos.id]) { skipped.push({ positionId: pos.id, reason: 'уже есть задание ' + has[pos.id] }); return; }
            var plan = LO.planPosition(pos, inp.dies || [], lim);
            if (!plan.flags.ready) { skipped.push({ positionId: pos.id, reason: plan.flags.blocks.join('; ') }); return; }
            if (!plan.demand.ok) { skipped.push({ positionId: pos.id, reason: plan.demand.error }); return; }
            var die = plan.die.die, meters = plan.demand.meters;
            // нож подбирает планирование и пишет в позицию (источник истины — позиция, #5340 D9):
            // те же поля, что пишет «Заказы этикетки», если записанное в позиции отличается
            var positionWrite = LO.writeDiffers(pos, plan.write) ? Object.assign({}, plan.write) : null;
            create.push({
                positionWrite: positionWrite,
                positionId: pos.id, orderNo: pos.orderNo || '', dieId: String(die.id), dieNo: String(die.no || ''), cylinderId: String(die.cylinderId || ''),
                footage: meters, pullsPlan: plan.demand.masterRolls || Math.ceil(meters / mrLength - 1e-9), duration: runMinutes(meters, s, rollLengthM({ footage: meters, streams: die.streams, rolls: pos.rolls })), rolls: num(pos.rolls),
                warnings: plan.flags.warnings.slice()
            });
        });
        return { create: create, skipped: skipped };
    }

    // Поля позиции («Заказанное количество») из LO.planPosition().write: нож, «Подбор ножа», мин. партия, ИТС.
    function positionPickFields(t, write) {
        var r = (t.position && t.position.reqs) || {}, f = {};
        Object.keys(write || {}).forEach(function(k) { if (r[k]) f['t' + r[k]] = String(write[k] == null ? '' : write[k]); });
        return f;
    }
    function jobCreateFields(t, p) {
        var j = t.dieJob, r = j.reqs, f = {};
        f['t' + j.id] = String(p.start);
        if (r.position) f['t' + r.position] = String(p.positionId);
        if (r.die) f['t' + r.die] = String(p.dieId);
        if (r.cylinder && p.cylinderId) f['t' + r.cylinder] = String(p.cylinderId);
        if (r.pullsPlan) f['t' + r.pullsPlan] = String(p.pullsPlan);
        if (r.footage) f['t' + r.footage] = String(round2(p.footage));
        if (r.duration) f['t' + r.duration] = String(p.duration);
        if (r.status) f['t' + r.status] = JOB_STATUS.PLANNED;
        return f;
    }
    // План: старт, станок, вал, наладка, длительность. Статус, нож и позиция не трогаются.
    function jobPlanFields(t, p) {
        var j = t.dieJob, r = j.reqs, f = {};
        f['t' + j.id] = String(p.start);
        if (r.machine && p.machineId) f['t' + r.machine] = String(p.machineId);
        if (r.cylinder && p.cylinderId) f['t' + r.cylinder] = String(p.cylinderId);
        if (r.shaft && p.shaftId) f['t' + r.shaft] = String(p.shaftId);   // физический вал (#5720)
        if (r.setup) f['t' + r.setup] = String(p.setup);
        if (r.duration) f['t' + r.duration] = String(p.duration);
        return f;
    }

    // Перенос задания на день day (номер суток) станка machine (окно «Перенести», как 🗓 Фазы 1):
    // position — 'weight' (по весу: место в дне с наименьшей добавкой наладки; при равенстве — позже),
    // 'start' (в начало дня), 'end' (в конец дня). Место задаётся план-стартом между записанными стартами
    // соседей того же станка и дня — по нему «Упорядочить» ставит зафиксированное задание и его ведомых.
    // → { start, index, neighbours: [id заданий дня по порядку без переносимого] }.
    function movePlacement(inp) {
        var s = withDefaults(inp.settings), cal = createCalendar(s), job = inp.job, m = inp.machine, day = inp.day;
        var on = (inp.jobs || []).filter(function(j) { return String(j.id) !== String(job.id) && !isFinal(j) && String(j.machineId || '') === String(m.id) && num(j.start) > 0; })
            .sort(function(a, b) { return num(a.start) - num(b.start) || (num(a.id) - num(b.id)); });
        var dayJobs = on.filter(function(j) { return cal.dayOf(num(j.start)) === day; });
        var before = on.filter(function(j) { return cal.dayOf(num(j.start)) < day; });
        var dayFrom = cal.dayTs(day, 0), shift = cal.dayTs(day, s.dayStartMin), n = dayJobs.length;
        var startAt = function(k) {
            if (!n) return shift;
            if (k <= 0) return Math.max(dayFrom, Math.min(shift, num(dayJobs[0].start) - 60));
            if (k >= n) return num(dayJobs[n - 1].start) + 60;
            var a = num(dayJobs[k - 1].start), b = num(dayJobs[k].start);
            return b - a > 1 ? a + Math.floor((b - a) / 2) : a + 1;
        };
        var k = inp.position === 'start' ? 0 : n;
        if (inp.position === 'weight' && n) {
            var prev0 = before.length ? before[before.length - 1] : null, best = Infinity;
            for (var i = 0; i <= n; i++) {
                var p = i ? dayJobs[i - 1] : prev0, q = i < n ? dayJobs[i] : null;
                var cost = setupMinutes(p, job, s, m) + (q ? setupMinutes(job, q, s, m) - setupMinutes(p, q, s, m) : 0);
                if (cost <= best) { best = cost; k = i; }
            }
        }
        return { start: startAt(k), index: k, neighbours: dayJobs.map(function(j) { return j.id; }) };
    }

    // «Зафиксировано» задания: fixedReq — id реквизита (его нет в базе — пусто). BOOLEAN снимается пустым значением.
    function jobFixedFields(fixedReq, on) {
        var f = {};
        if (fixedReq) f['t' + fixedReq] = on ? '1' : '';
        return f;
    }

    // ── Задачи на втулки ────────────────────────────────────────────────────

    // Диаметр втулки, мм (целый, как номинал в справочнике): «(76мм/5мм/…)» или дюймы (1" = 25).
    function sleeveDiameterMm(name) {
        var s = String(name == null ? '' : name), m = /\((\d+(?:[.,]\d+)?)\s*мм/i.exec(s);
        if (m) return Math.floor(num(m[1]) + 1e-9);
        m = /(\d+(?:[.,]\d+)?)\s*\\?"/.exec(s);
        if (m) return Math.floor(num(m[1]) * 25.4 + 1e-9);
        return 0;
    }
    // Карточка задания (#5720): размер ножа и этикетки, сырьё, втулка, намотка внутрь.
    // pos — позиция (label-orders positionFromRow), die — нож (buildDieIndex). Круглый — тип с «D»
    // в начале: «D 52 (80)», «D х 40 (76)», «D51».
    function jobFacts(job, pos, die) {
        var size = function(w, l, round) {
            w = num(w); l = num(l);
            if (!(w > 0)) return '';
            return round ? 'D' + round1(w) : l > 0 ? round1(w) + '×' + round1(l) : String(round1(w));
        };
        var isRound = function(text) { return /^\s*[DdДд]\s*(?:[хХxX×*]\s*)?\d/.test(String(text || '')); };
        var winding = String((pos && pos.winding) || '').trim();
        var d = sleeveDiameterMm(job && job.sleeve), w = num(job && job.sleeveWidth);
        return {
            dieSize: die ? size(die.width, die.length, isRound(die.typeName)) : '',
            labelSize: pos ? size(pos.width, pos.length, isRound(pos.knifeType)) : '',
            material: String((job && job.material) || (pos && pos.material) || ''),
            sleeve: d > 0 ? 'Ø' + d + (w > 0 ? ' · ' + round1(w) + ' мм' : '') : w > 0 ? round1(w) + ' мм' : '',
            winding: winding,
            windingIn: /внутр/i.test(winding)
        };
    }
    // Туррели и задание: [{ machineId, name, ok, reason }] — проходит ли задание правила туррели
    // без записи диспетчера (что «Упорядочить» решает само).
    function turretVerdicts(job, machines, settings, seriesM) {
        return (machines || []).filter(function(m) { return m.turret; }).map(function(m) {
            var chk = machineAllows(m, Object.assign({}, job, { machineId: '' }), withDefaults(settings), seriesM);
            return { machineId: m.id, name: m.name || m.id, ok: chk.ok, reason: chk.ok ? '' : String(chk.reason || '').replace(/^туррель: /, '') };
        });
    }
    function pickCutter(cutters, diameter) {
        var d = num(diameter);
        if (!(d > 0)) return null;
        var list = (cutters || []).slice().sort(function(a, b) { return a.min - b.min; });
        for (var i = 0; i < list.length; i++) if (d >= list[i].min && d <= list[i].max) return list[i];
        return null;
    }

    // tasks — { id позиции: [{ id, start, qty, cutterId, touched }] }; cutters — [{ id, name, min, max }].
    // → { ops: [{ op: create|update, positionId, taskId, jobId, start, qty, cutterId }], skipped, warnings }.
    function sleevePlan(inp) {
        var ops = [], skipped = [], warnings = [], seen = {};
        var jobs = (inp.jobs || []).filter(function(j) { return j.positionId && !isFinal(j); }).sort(compareJobs);
        jobs.forEach(function(j) {
            if (seen[j.positionId]) return;
            seen[j.positionId] = true;
            var rolls = Math.round(num(j.rolls));
            if (!(rolls > 0)) { skipped.push({ positionId: j.positionId, reason: 'у позиции нет рулонов' }); return; }
            var cutter = pickCutter(inp.cutters, sleeveDiameterMm(j.sleeve)), cutterId = cutter ? cutter.id : '';
            var have = (inp.tasks || {})[j.positionId] || [];
            // Пульт втулкореза читает задачи с фильтром по своему станку: задачу без втулкореза не увидит никто.
            if (!cutter && !have.length) {
                skipped.push({ positionId: j.positionId, reason: 'втулкорез не подобран (втулка «' + (j.sleeve || 'не указана') + '»)' });
                return;
            }
            var touched = have.filter(function(x) { return x.touched; }), free = have.filter(function(x) { return !x.touched; });
            var target = rolls - touched.reduce(function(a, x) { return a + num(x.qty); }, 0);
            if (target <= 0) { skipped.push({ positionId: j.positionId, reason: 'задача на втулки уже начата, вся партия в работе' }); return; }
            if (!free.length) {
                ops.push({ op: 'create', positionId: j.positionId, jobId: j.id, start: j.start, qty: target, cutterId: cutterId });
                return;
            }
            var t = free[0];
            if (free.length > 1) warnings.push('позиция ' + j.positionId + ': несколько не начатых задач на втулки (' + free.map(function(x) { return x.id; }).join(', ') + '), приведена первая');
            var differs = num(t.start) !== num(j.start) || num(t.qty) !== target || (cutterId && String(t.cutterId) !== String(cutterId));
            if (differs) ops.push({ op: 'update', positionId: j.positionId, taskId: t.id, jobId: j.id, start: j.start, qty: target, cutterId: cutterId || String(t.cutterId || '') });
        });
        return { ops: ops, skipped: skipped, warnings: warnings };
    }

    function sleeveCreateFields(t, p) {
        var s = t.sleeveTask, r = s.reqs, f = {};
        f['t' + s.id] = String(p.start);
        if (r.qty) f['t' + r.qty] = String(p.qty);
        if (r.cutter && p.cutterId) f['t' + r.cutter] = String(p.cutterId);
        return f;
    }
    function sleeveUpdateFields(t, p) { return sleeveCreateFields(t, p); }

    // ── Записи базы → модель (для экрана) ───────────────────────────────────

    function refIds(rec, reqId) {
        var raw = rec && rec.reqs && reqId ? rec.reqs['ref_' + reqId] : '';
        if (raw == null || String(raw).trim() === '') return [];
        var s = String(raw), i = s.indexOf(':');
        return (i >= 0 ? s.slice(i + 1) : s).split(',').map(function(x) { return x.trim(); }).filter(Boolean);
    }
    var INACTIVE_RE = /останов|ремонт|не работ|выведен|неисправ/i;
    // opts — id реквизитов станка, если они есть в базе: turretReq «Туррель» (BOOLEAN), minCylinderReq
    // «Мин. вал», maxCylinderReq «Макс. вал» (зубьев), stopBasesReq «Стоп-лист основы» (ref «Основа сырья»,
    // несколько), minSeriesReq «Мин. метраж серии, м», maxRollReq «Макс. намотка ролика, м»,
    // sleeveReq «Втулка не уже диаметра» (BOOLEAN) — #5428.
    function machinesFromRecords(recs, t, opts) {
        var r = (t.machine && t.machine.reqs) || {}, o = opts || {};
        return (recs || []).map(function(m) {
            var v = function(req) { return req ? (m.reqs || {})[req] : ''; };
            var status = String(v(r.status) || '');
            return { id: m.id, name: m.val, stopMaterials: refIds(m, r.stopMaterials), status: status, active: !INACTIVE_RE.test(status),
                turret: flagOn(v(o.turretReq)), minCylinder: num(v(o.minCylinderReq)), maxCylinder: num(v(o.maxCylinderReq)),
                stopBases: o.stopBasesReq ? refIds(m, o.stopBasesReq) : [], minSeriesM: num(v(o.minSeriesReq)),
                maxRollM: num(v(o.maxRollReq)), sleeveNotNarrower: flagOn(v(o.sleeveReq)) };
        }).sort(function(a, b) { return (num(a.id) - num(b.id)); });
    }
    // Ножи для подбора и планирования: LO.buildDies + вал (id), формат, марка.
    function buildDieIndex(dieRecs, t, selectable, cylinders, mileage) {
        var base = LO.buildDies(dieRecs, t, selectable, cylinders, mileage), r = (t.die && t.die.reqs) || {}, byId = {};
        (dieRecs || []).forEach(function(d) { byId[d.id] = d; });
        return base.map(function(d) {
            var rec = byId[d.id];
            d.cylinderId = (refIds(rec, r.cylinder)[0]) || '';
            d.brandId = (refIds(rec, r.brand)[0]) || '';
            d.minFormat = num(LO.kvRecords && rec && rec.reqs ? rec.reqs[r.minFormat] : 0);
            return d;
        });
    }
    // Сведения о ножах для флагов и загрузки: { id: { state, mileage, resource } } — пробег и ресурс в оборотах.
    function dieInfo(dies, brandResources, defaultResource) {
        var out = {};
        (dies || []).forEach(function(d) {
            var res = LP.dieResource((brandResources || {})[d.brandId], defaultResource).revs;
            out[d.id] = { state: d.state, mileage: num(d.revs), resource: isFinite(res) ? res : 0, no: d.no };
        });
        return out;
    }
    // Задача на втулки: имена колонок.
    var SLEEVE_REQS = { cutter: 'Втулкорез', qty: 'Кол-во', started: 'Начато', finished: 'Закончено', fact: 'Кол-во факт' };
    function resolveSleeveTask(meta) {
        var list = Array.isArray(meta) ? meta : [];
        for (var i = 0; i < list.length; i++) {
            if (norm(list[i].val) !== 'задача на втулки') continue;
            var reqs = {};
            Object.keys(SLEEVE_REQS).forEach(function(k) {
                var found = (list[i].reqs || []).filter(function(r) { return norm(r.val) === norm(SLEEVE_REQS[k]) || norm((r.alias || (r.field_attrs && r.field_attrs.alias)) || '') === norm(SLEEVE_REQS[k]); })[0];
                if (found) reqs[k] = String(found.id);
            });
            return { id: String(list[i].id), reqs: reqs };
        }
        return null;
    }

    return {
        core: {
            JOB_STATUS: JOB_STATUS, DEFAULTS: DEFAULTS, SETTING_KEYS: SETTING_KEYS,
            num: num, norm: norm, readSettings: readSettings, isDone: isDone, isFinal: isFinal, isStarted: isStarted, isMovable: isMovable,
            dueEnd: dueEnd, buildJobs: buildJobs, setupKind: setupKind, setupMinutes: setupMinutes, runMinutes: runMinutes, jobFixedFields: jobFixedFields, flagOn: flagOn, movePlacement: movePlacement, rollLengthM: rollLengthM, kindOfSetup: kindOfSetup,
            machineAllows: machineAllows, createCalendar: createCalendar, orderQueue: orderQueue, compareJobs: compareJobs,
            jobFlags: jobFlags, jobRevs: jobRevs, openRevsByDie: openRevsByDie, coverJobs: coverJobs, coverOrder: coverOrder, planReservations: planReservations,
            toolLoad: toolLoad, ganttDay: ganttDay, recordedPlan: recordedPlan, inScope: inScope, coverGroups: coverGroups, positionPickFields: positionPickFields, queueGrid: queueGrid, turretFits: turretFits, seriesFootage: seriesFootage, cylinderInRange: cylinderInRange, cylinderRangeText: cylinderRangeText, formJobs: formJobs, jobCreateFields: jobCreateFields, jobPlanFields: jobPlanFields,
            sleeveDiameterMm: sleeveDiameterMm, pickCutter: pickCutter, sleevePlan: sleevePlan,
            jobFacts: jobFacts, turretVerdicts: turretVerdicts, shaftKey: shaftKey,
            sleeveCreateFields: sleeveCreateFields, sleeveUpdateFields: sleeveUpdateFields,
            refIds: refIds, machinesFromRecords: machinesFromRecords, buildDieIndex: buildDieIndex, dieInfo: dieInfo, resolveSleeveTask: resolveSleeveTask
        }
    };
});
