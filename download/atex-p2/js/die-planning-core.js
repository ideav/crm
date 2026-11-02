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
//   - блокировки (нет ножа, нож списан, нет МР нужного формата) и предупреждение «ресурс ножа»;
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
        cylinderChange: ['DIE_CYLINDER_CHANGE_MN', 90, true],
        knifeChange: ['DIE_KNIFE_CHANGE_MN', 20, true],
        sleeveChange: ['DIE_SLEEVE_CHANGE_MN', 20, true],
        speed: ['DIE_SPEED_M_MIN', 44, false],
        shortRollSpeed: ['DIE_SPEED_SHORT_M_MIN', 28, false],
        shortRollM: ['DIE_SHORT_ROLL_M', 50, true],
        dayStartMin: ['DIE_DAY_START_MIN', 480, true],
        dayCapacityMin: ['DIE_DAY_CAPACITY_MN', 455, false],
        horizonDays: ['DIE_HORIZON_DAYS', 14, false],
        mrLength: ['LABEL_MASTER_ROLL_M', 2000, false],
        tolerance: ['JUMBO_FORMAT_TOLERANCE_MM', 15, true],
        dieResource: ['DIE_RESOURCE_DEFAULT_M', 300000, false],
        // Туррель — для длинных заданий: метраж от порога (по плану заказчика — от 12,6 км; 0 — без порога).
        turretLongM: ['DIE_TURRET_LONG_M', 12600, true]
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

    // Строки отчёта die_planning → задания.
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
                materialId: String(r.material_id || ''), material: String(r.material || '')
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
    function setupMinutesOfKind(kind, s) {
        return kind === 'cylinder' ? s.cylinderChange : kind === 'knife' ? s.knifeChange : kind === 'sleeve' ? s.sleeveChange : 0;
    }
    function setupMinutes(prev, next, settings) {
        var s = withDefaults(settings);
        return setupMinutesOfKind(setupKind(prev, next), s);
    }
    // Вид наладки по записанным минутам (задание уже стоит): самая дорогая норма, которой хватает.
    function kindOfSetup(setup, s) {
        if (!(setup > 0)) return 'none';
        if (setup >= s.cylinderChange) return 'cylinder';
        if (setup >= s.knifeChange) return 'knife';
        return 'sleeve';
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

    // machine — { id, name, stopMaterials: [id сырья], active, turret, maxCylinder }.
    // Валы станка задаёт одно число — «Макс. вал» (зубьев); списка допустимых валов нет (#5366).
    // settings — для порога туррели (DIE_TURRET_LONG_M); без них — умолчания.
    function machineAllows(machine, job, settings) {
        if (machine.active === false) return { ok: false, reason: 'станок не работает' };
        // «Макс. вал» станка (зубьев): вал больше на станок не встаёт; 0/пусто — не ограничен, вал без числа — не режется.
        var maxCyl = num(machine.maxCylinder), teeth = num(job.cylinder);
        if (maxCyl > 0 && teeth > maxCyl)
            return { ok: false, reason: 'вал ' + teeth + ' больше «Макс. вала» станка (' + maxCyl + ')' };
        if (job.materialId && (machine.stopMaterials || []).indexOf(String(job.materialId)) >= 0)
            return { ok: false, reason: 'сырьё «' + (job.material || job.materialId) + '» в стоп-листе станка' };
        // Туррель: центрифуга роняет втулку на бок и выравнивает для подачи в жёлоб — нужна ширина ≥ 2× диаметра.
        // Задание, записанное на станок диспетчером, остаётся допустимым (ручное решение).
        if (machine.turret && !turretFits(job, settings) && String(job.machineId || '') !== String(machine.id)) {
            if (!turretSleeveFits(job)) {
                var d = sleeveDiameterMm(job.sleeve);
                return { ok: false, reason: 'туррель: ширина втулки ' + (num(job.sleeveWidth) || '—') + ' мм меньше 2× диаметра' + (d ? ' (' + 2 * d + ' мм)' : ' (диаметр втулки не указан)') };
            }
            return { ok: false, reason: 'туррель: задание короче ' + withDefaults(settings).turretLongM + ' м (метраж ' + (num(job.footage) || 0) + ' м)' };
        }
        return { ok: true };
    }
    // Задание подходит туррели: длинное (метраж ≥ DIE_TURRET_LONG_M, #5366) и на широкой втулке.
    function turretFits(job, settings) {
        var long = withDefaults(settings).turretLongM;
        return turretSleeveFits(job) && !(long > 0 && num(job && job.footage) < long);
    }
    // Широкая втулка: ширина ≥ 2× её диаметра (диаметр — из названия втулки).
    function turretSleeveFits(job) {
        var d = sleeveDiameterMm(job && job.sleeve), w = num(job && job.sleeveWidth);
        return d > 0 && w >= 2 * d;
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

    function orderQueue(inp) {
        var s = withDefaults(inp.settings), cal = createCalendar(s);
        var from = inp.from, blocked = inp.blocked || {}, jobs = inp.jobs || [], machines = inp.machines || [];
        var st = {}, order = [];
        machines.forEach(function(m) {
            st[m.id] = { machine: m, cursor0: cal.cursorAt(from), prev0: null, fixed: [], seq: [], cursor: null, prev: null };
            order.push(m.id);
        });

        function buildItem(job, segs, setup, kind, run, fixed) {
            var last = segs[segs.length - 1];
            return { jobId: job.id, machineId: '', start: segs[0].start, end: last.end, setup: setup, setupKind: kind, run: run,
                due: job.due || 0, late: job.due > 0 && last.end > job.due, fixed: !!fixed, segments: segs };
        }
        function tagSegs(segs, jobId) { segs.forEach(function(g) { g.jobId = jobId; }); return segs; }

        // Размещение задания после prev с курсора cur.
        function place(cur, prev, job) {
            var kind = setupKind(prev, job), setup = setupMinutes(prev, job, s), run = jobRunMinutes(job, s), segs = [], c = cur;
            if (setup > 0) { var a = cal.advance(c, setup, 'setup-' + kind); segs = segs.concat(a.segments); c = a.cursor; }
            if (run > 0 || !segs.length) { var b = cal.advance(c, run, 'run'); segs = segs.concat(b.segments); c = b.cursor; }
            tagSegs(segs, job.id);
            var item = buildItem(job, segs, setup, kind, run, false);
            return { item: item, cursor: c };
        }
        // Задание, которое уже стоит: со своего старта и своей наладкой.
        function layoutFixed(job) {
            var setup = num(job.setup), run = num(job.duration) > 0 ? num(job.duration) : jobRunMinutes(job, s);
            var kind = kindOfSetup(setup, s);
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
                    if (j.start >= todayStart) { var f = layoutFixed(j); f.item.machineId = id; f.item.done = true; x.fixed.push(f.item); }
                    if (j.start <= from) prev = j;
                } else {
                    var r = layoutFixed(j); r.item.machineId = id; x.fixed.push(r.item);
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
        cands.forEach(function(j) {
            var best = null, turret = null, reasons = [];
            // записанное диспетчером на туррель задание, которое ей не подходит, со станка не снимается
            var pinned = order.filter(function(id) { return st[id].machine.turret && String(j.machineId || '') === String(id) && !turretFits(j, s); })[0];
            order.forEach(function(id, idx) {
                if (pinned && id !== pinned) return;
                var x = st[id], chk = machineAllows(x.machine, j, s);
                if (!chk.ok) { reasons.push((x.machine.name || id) + ': ' + chk.reason); return; }
                var t = place(x.cursor, x.prev, j);
                var better = !best || t.item.end < best.t.item.end || (t.item.end === best.t.item.end && t.item.setup < best.t.item.setup);
                if (better) best = { id: id, t: t };
                if (x.machine.turret && (!turret || t.item.end < turret.t.item.end)) turret = { id: id, t: t };
            });
            // подходящее туррели — на туррель, если там оно не уходит в просрочку (или и так опаздывает везде)
            if (turret && best && turret.id !== best.id && turretFits(j, s)) {
                var due = num(j.due);
                if (!(due > 0) || turret.t.item.end <= due || best.t.item.end > due) best = turret;
            }
            if (!best) { unplaced.push({ jobId: j.id, reasons: reasons.length ? reasons : ['нет станков'] }); return; }
            var x = st[best.id];
            x.seq.push(j); x.cursor = best.t.cursor; x.prev = j;
        });

        function runSeq(x, seq) {
            var cur = x.cursor0, prev = x.prev0, items = [], setupTotal = 0;
            seq.forEach(function(j) {
                var t = place(cur, prev, j);
                t.item.machineId = x.machine.id;
                items.push(t.item); setupTotal += t.item.setup; cur = t.cursor; prev = j;
            });
            return { items: items, setupTotal: setupTotal };
        }
        // Группировка вал → нож → сырьё без новой просрочки.
        function improve(x) {
            var seq = x.seq.slice(), base = runSeq(x, seq);
            for (var p = 0; p < seq.length - 1; p++) {
                var cur = seq[p], bestQ = -1, bestR = affinity(cur, seq[p + 1]);
                for (var q = p + 2; q < seq.length; q++) {
                    var r = affinity(cur, seq[q]);
                    if (r > bestR) { bestR = r; bestQ = q; }
                }
                if (bestQ < 0) continue;
                var trial = seq.slice(), moved = trial.splice(bestQ, 1)[0];
                trial.splice(p + 1, 0, moved);
                var t = runSeq(x, trial);
                if (t.setupTotal >= base.setupTotal) continue;
                var ends = {};
                base.items.forEach(function(i) { ends[i.jobId] = i.end; });
                var ok = t.items.every(function(i) {
                    if (!(i.due > 0)) return true;
                    return i.end <= Math.max(ends[i.jobId], i.due);
                });
                if (ok) { seq = trial; base = t; }
            }
            x.seq = seq;
            return base;
        }

        var out = {}, summary = { jobs: 0, late: 0, setupMinutes: 0, cylinderChanges: 0 };
        order.forEach(function(id) {
            var x = st[id], planned = improve(x);
            var items = x.fixed.concat(planned.items).sort(function(a, b) { return a.start - b.start; });
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

    // ctx — { dies: { id ножа: { state, mileage, resource } }, openMeters: { id ножа: метры открытых заданий },
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
                var forecast = num(die.mileage) + num((c.openMeters || {})[job.dieId]);
                if (forecast >= res * 0.9) warnings.push('ресурс ножа: прогноз пробега ' + Math.round(forecast / res * 100) + ' % ресурса');
            }
        }
        var cv = (c.cover || {})[job.id];
        if (cv && num(cv.deficit) > 0) blocks.push('нет МР нужного формата');
        return { blocks: blocks, warnings: warnings };
    }

    function openMetersByDie(jobs) {
        var out = {};
        (jobs || []).forEach(function(j) { if (!isFinal(j) && j.dieId) out[j.dieId] = round1((out[j.dieId] || 0) + num(j.footage)); });
        return out;
    }

    // ── Мастер-рулоны ───────────────────────────────────────────────────────

    // Покрытие заданий мастер-рулонами — одна мера для блокировки «нет МР нужного формата» и вкладки
    // «Дефицит форматов»; «Зарезервировать МР» показывает тот же расчёт у заданий с нехваткой.
    // Задания идут по план-старту:
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
            .sort(function(a, b) { return a.start - b.start || (num(a.id) - num(b.id)); });
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
    // → [{ taskId, rollIds, deficit, need }] по заданиям с дефицитом.
    function planReservations(tasks, rolls, moves, tolerance) {
        var copy = (rolls || []).map(function(r) { return Object.assign({}, r); });
        var open = (tasks || []).filter(function(t) {
            var st = norm(t.status);
            return t.open && (st === '' || st === 'запланировано') && !t.currentRollId;
        }).sort(function(a, b) { return a.start - b.start || (num(a.id) - num(b.id)); });
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
            var k = knives[kk] || (knives[kk] = { dieId: j.dieId, dieNo: j.dieNo, jobs: 0, minutes: 0, meters: 0, planned: 0, unplaced: 0 });
            k.jobs++; k.minutes += minutes; k.meters = round1(k.meters + num(j.footage));
            if (!it || !it.fixed) k.planned = round1(k.planned + num(j.footage));
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
            x.mileage = mil; x.mileageAfter = round1(mil + x.planned); x.resource = res;
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
                var kind = kindOfSetup(setup, s);
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
        var lim = { mrLength: mrLength };
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
        if (r.setup) f['t' + r.setup] = String(p.setup);
        if (r.duration) f['t' + r.duration] = String(p.duration);
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
    // opts.turretReq — id реквизита «Туррель» станка (BOOLEAN), opts.maxCylinderReq — «Макс. вал» (зубьев),
    // если они есть в базе.
    function machinesFromRecords(recs, t, opts) {
        var r = (t.machine && t.machine.reqs) || {}, tr = opts && opts.turretReq, mx = opts && opts.maxCylinderReq;
        return (recs || []).map(function(m) {
            var status = String((m.reqs || {})[r.status] || '');
            var tv = tr ? String((m.reqs || {})[tr] == null ? '' : (m.reqs || {})[tr]).trim().toLowerCase() : '';
            return { id: m.id, name: m.val, stopMaterials: refIds(m, r.stopMaterials), status: status, active: !INACTIVE_RE.test(status),
                turret: tv !== '' && tv !== '0' && tv !== 'нет' && tv !== 'false',
                maxCylinder: mx ? num((m.reqs || {})[mx]) : 0 };
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
    // Сведения о ножах для флагов и загрузки: { id: { state, mileage, resource } }.
    function dieInfo(dies, brandResources, defaultResource) {
        var out = {};
        (dies || []).forEach(function(d) {
            var res = LP.dieResource((brandResources || {})[d.brandId], defaultResource).meters;
            out[d.id] = { state: d.state, mileage: num(d.meters), resource: isFinite(res) ? res : 0, no: d.no };
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
            dueEnd: dueEnd, buildJobs: buildJobs, setupKind: setupKind, setupMinutes: setupMinutes, runMinutes: runMinutes, rollLengthM: rollLengthM, kindOfSetup: kindOfSetup,
            machineAllows: machineAllows, createCalendar: createCalendar, orderQueue: orderQueue, compareJobs: compareJobs,
            jobFlags: jobFlags, openMetersByDie: openMetersByDie, coverJobs: coverJobs, planReservations: planReservations,
            toolLoad: toolLoad, ganttDay: ganttDay, recordedPlan: recordedPlan, inScope: inScope, coverGroups: coverGroups, positionPickFields: positionPickFields, queueGrid: queueGrid, turretFits: turretFits, formJobs: formJobs, jobCreateFields: jobCreateFields, jobPlanFields: jobPlanFields,
            sleeveDiameterMm: sleeveDiameterMm, pickCutter: pickCutter, sleevePlan: sleevePlan,
            sleeveCreateFields: sleeveCreateFields, sleeveUpdateFields: sleeveUpdateFields,
            refIds: refIds, machinesFromRecords: machinesFromRecords, buildDieIndex: buildDieIndex, dieInfo: dieInfo, resolveSleeveTask: resolveSleeveTask
        }
    };
});
