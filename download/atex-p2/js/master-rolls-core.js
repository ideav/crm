// Склад мастер-рулонов — ядро (ideav/crm#5325, Фаза 2 atex, шаг 5).
//
// Чистые функции склада и загрузка данных; экран — master-rolls.js.
//   - статус рулона по остатку: на складе / початый / израсходован; «брак» и «списан» окончательные;
//   - резерв под задание высечки: то же сырьё, формат в [мин. формат ножа, мин. + допуск];
//     рулон, из которого вырубает открытое задание, за ним и остаётся (рулон не переназначается
//     под другой заказ, §9.5 состава решения);
//   - расход — только вырубкой (consumePlan для пульта высечки), инвентаризация — по акту,
//     списание — с причиной;
//   - остатки по форматам × сырью, потребность открытых заданий, автоподбор резерва, журнал.
// Таблицы и реквизиты — по именам из /metadata (resolveTables), id в коде нет.
// Покрыто experiments/atex-p2-5325-master-rolls.test.js.

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.AtexMasterRolls = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    'use strict';

    var ROLL_STATUS = { STOCK: 'на складе', OPENED: 'початый', USED: 'израсходован', SCRAP: 'брак', WRITTEN_OFF: 'списан' };
    var MOVE_KIND = { IN: 'приход', OUT: 'расход', COUNT: 'инвентаризация', OFF: 'списание' };
    var DONE_TASK = ['выполнено', 'отменено', 'закрыто'];
    var SETTINGS = { tolerance: ['JUMBO_FORMAT_TOLERANCE_MM', 15], rollLength: ['MASTER_ROLL_LENGTH_M', 2000] };

    // Таблицы склада: ключ → { name, reqs: { ключ: имя колонки } }.
    var TABLES = {
        material: { name: 'Сырьё этикетки', reqs: {} },
        warehouse: { name: 'Склад', reqs: {} },
        jumboJob: { name: 'Задание первичной резки', reqs: {} },
        masterRoll: { name: 'Мастер-рулон', reqs: {
            format: 'Формат, мм', length: 'Длина, м', material: 'Сырьё этикетки', jumboJob: 'Задание первичной резки',
            rest: 'Остаток, м', status: 'Статус мастер-рулона', warehouse: 'Склад', reserveTask: 'Задание высечки'
        } },
        rollMove: { name: 'Движение мастер-рулона', reqs: {
            roll: 'Мастер-рулон', kind: 'Вид движения мастер-рулона', delta: 'Изменение, м', rest: 'Остаток, м',
            task: 'Задание высечки', basis: 'Основание', operator: 'Оператор'
        } },
        moveKind: { name: 'Вид движения мастер-рулона', reqs: {} }
    };

    function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
    function num(v) {
        var n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
        return isFinite(n) ? n : 0;
    }
    function round1(n) { return Math.round(n * 10) / 10; }

    function aliasOf(e) {
        if (!e) return '';
        if (e.alias != null && e.alias !== '') return String(e.alias);
        if (e.field_attrs && e.field_attrs.alias != null) return String(e.field_attrs.alias);
        if (e.attrs) {
            try {
                var attrs = typeof e.attrs === 'string' ? JSON.parse(e.attrs) : e.attrs;
                if (attrs && attrs.alias != null) return String(attrs.alias);
            } catch (x) { /* attrs — не JSON: псевдонима нет */ }
        }
        return '';
    }
    function findByName(list, name) {
        var target = norm(name), arr = Array.isArray(list) ? list : [];
        for (var i = 0; i < arr.length; i++) if (norm(aliasOf(arr[i])) === target) return arr[i];
        for (var j = 0; j < arr.length; j++) if (norm(arr[j] && arr[j].val) === target) return arr[j];
        return null;
    }

    // → { tables: { ключ: { id, name, reqs: { ключ: id } } }, missing: [«Таблица» | «Таблица → колонка»] }.
    function resolveTables(metadata) {
        var meta = Array.isArray(metadata) ? metadata : (metadata == null ? [] : [metadata]);
        var tables = {}, missing = [];
        Object.keys(TABLES).forEach(function(key) {
            var spec = TABLES[key], t = findByName(meta, spec.name);
            if (!t) { missing.push(spec.name); return; }
            var reqs = {};
            Object.keys(spec.reqs).forEach(function(rk) {
                var r = findByName(t.reqs, spec.reqs[rk]);
                if (r) reqs[rk] = String(r.id); else missing.push(spec.name + ' → ' + spec.reqs[rk]);
            });
            tables[key] = { id: String(t.id), name: spec.name, reqs: reqs };
        });
        return { tables: tables, missing: missing };
    }

    // ── Статусы ─────────────────────────────────────────────────────────────

    function isFinal(status) { var s = norm(status); return s === ROLL_STATUS.SCRAP || s === ROLL_STATUS.WRITTEN_OFF; }

    function stockStatus(rest, length, prevStatus) {
        if (isFinal(prevStatus)) return norm(prevStatus);
        rest = num(rest); length = num(length);
        if (rest <= 0) return ROLL_STATUS.USED;
        if (length > 0 && rest < length) return ROLL_STATUS.OPENED;
        return ROLL_STATUS.STOCK;
    }

    function onStock(roll) { return !isFinal(roll.status) && num(roll.rest) > 0; }

    function isOpenStatus(status) { return DONE_TASK.indexOf(norm(status)) < 0; }

    // Строки отчёта die_tasks → задания высечки.
    function buildTasks(rows, tolerance) {
        var tol = num(tolerance);
        return (rows || []).map(function(r) {
            var min = num(r.min_format);
            return {
                id: String(r.job_id), start: num(r.job_start), status: String(r.job_status || '').trim(),
                open: isOpenStatus(r.job_status), footage: num(r.footage), minFormat: min, maxFormat: min + tol,
                optFormat: num(r.opt_format), materialId: String(r.material_id || ''), material: String(r.material || ''),
                dieNo: String(r.die_no || ''), machine: String(r.machine || ''), currentRollId: String(r.master_roll_id || '')
            };
        });
    }

    function taskIndex(tasks) { var o = {}; (tasks || []).forEach(function(t) { o[t.id] = t; }); return o; }

    // Задания, которые уже вырубали из рулона (по журналу).
    function consumers(rollId, moves) {
        var out = [];
        (moves || []).forEach(function(m) {
            if (String(m.rollId) === String(rollId) && m.kind === MOVE_KIND.OUT && m.taskId && out.indexOf(String(m.taskId)) < 0) out.push(String(m.taskId));
        });
        return out;
    }

    // Открытое задание, за которым рулон держится: резерв открытого задания или вырубка открытым заданием.
    function holder(roll, tasksById, moves) {
        var rt = roll.reserveTaskId && tasksById[roll.reserveTaskId];
        if (rt && rt.open) return rt.id;
        var c = consumers(roll.id, moves).filter(function(id) { return tasksById[id] && tasksById[id].open; });
        return c.length ? c[0] : '';
    }

    function fits(roll, task) {
        if (String(roll.materialId) !== String(task.materialId)) return 'другое сырьё: у рулона «' + (roll.material || roll.materialId) + '», заданию нужно «' + (task.material || task.materialId) + '»';
        var f = num(roll.format);
        if (f < task.minFormat || f > task.maxFormat) return 'формат ' + f + ' мм вне диапазона ножа ' + task.minFormat + '–' + task.maxFormat + ' мм';
        return '';
    }

    // ── Резерв ──────────────────────────────────────────────────────────────

    // allTasks — все задания (открытость чужого резерва и чужой вырубки); задание, которого
    // в списке нет, считается открытым.
    function reserveCheck(roll, task, tolerance, moves, allTasks) {
        if (!roll || !task) return { ok: false, error: 'нет рулона или задания' };
        if (!task.open) return { ok: false, error: 'задание ' + task.id + ' закрыто (' + task.status + ')' };
        if (!onStock(roll)) return { ok: false, error: 'рулон ' + roll.no + ' не на складе (' + (roll.status || 'остаток 0') + ')' };
        var idx = taskIndex(allTasks);
        idx[task.id] = task;
        // Резерв / вырубка другого задания: без списка заданий его открытость неизвестна —
        // считаем открытым, кроме явно закрытых (резерв под задание, которого нет в idx).
        var other = '';
        if (roll.reserveTaskId && roll.reserveTaskId !== task.id) {
            var rt = idx[roll.reserveTaskId];
            if (!rt || rt.open) other = 'рулон в резерве задания ' + roll.reserveTaskId;
        }
        if (!other) {
            consumers(roll.id, moves).forEach(function(id) {
                if (other || id === task.id) return;
                var ct = idx[id];
                if (!ct || ct.open) other = 'из рулона вырубает задание ' + id + ' — рулон не переназначается под другой заказ';
            });
        }
        if (other) return { ok: false, error: other };
        var why = fits(roll, task);
        return why ? { ok: false, error: why } : { ok: true };
    }

    function unreserveCheck(roll, moves) {
        if (!roll.reserveTaskId) return { ok: false, error: 'рулон не в резерве' };
        if (consumers(roll.id, moves).indexOf(String(roll.reserveTaskId)) >= 0)
            return { ok: false, error: 'задание ' + roll.reserveTaskId + ' уже вырубало из рулона ' + roll.no + ' (расход) — рулон остаётся за ним' };
        return { ok: true };
    }

    // ── Операции ────────────────────────────────────────────────────────────

    // Расход вырубкой (пульт высечки): из рулона своего резерва или свободного подходящего.
    function consumePlan(roll, meters, task, tolerance, moves, allTasks) {
        var m = num(meters);
        if (!(m > 0)) return { ok: false, error: 'расход должен быть больше нуля' };
        if (!task || !task.open) return { ok: false, error: 'расход только вырубкой открытого задания' };
        if (roll.reserveTaskId !== task.id) {
            var chk = reserveCheck(roll, task, tolerance, moves, allTasks);
            if (!chk.ok) return chk;
        } else if (!onStock(roll)) {
            return { ok: false, error: 'рулон ' + roll.no + ' не на складе' };
        }
        if (m > num(roll.rest) + 1e-9) return { ok: false, error: 'расход ' + m + ' м больше остатка ' + num(roll.rest) + ' м' };
        var rest = round1(num(roll.rest) - m);
        return { ok: true, delta: -m, rest: rest, status: stockStatus(rest, roll.length, roll.status), reserveTaskId: task.id };
    }

    function inventoryPlan(roll, fact, basis) {
        if (isFinal(roll.status)) return { ok: false, error: 'рулон ' + roll.no + ' — «' + roll.status + '», в остаток не возвращается' };
        if (!String(basis || '').trim()) return { ok: false, error: 'укажите основание (номер акта)' };
        var s = String(fact == null ? '' : fact).replace(/\s/g, '').replace(',', '.');
        if (!/^-?\d+(\.\d+)?$/.test(s)) return { ok: false, error: 'факт — число метров' };
        var f = parseFloat(s), len = num(roll.length);
        if (f < 0) return { ok: false, error: 'факт не может быть меньше нуля' };
        if (len > 0 && f > len) return { ok: false, error: 'факт ' + f + ' м больше длины рулона ' + len + ' м' };
        var delta = round1(f - num(roll.rest));
        return { ok: true, delta: delta, rest: f, changed: delta !== 0, status: stockStatus(f, len, roll.status) };
    }

    function writeOffPlan(roll, reason) {
        if (norm(roll.status) === ROLL_STATUS.WRITTEN_OFF) return { ok: false, error: 'рулон ' + roll.no + ' уже списан' };
        if (!String(reason || '').trim()) return { ok: false, error: 'укажите причину списания' };
        return { ok: true, delta: -num(roll.rest), rest: 0, status: ROLL_STATUS.WRITTEN_OFF, clearReserve: !!roll.reserveTaskId };
    }

    // ── Сводки ──────────────────────────────────────────────────────────────

    function stockByFormat(rolls, tasks) {
        var idx = taskIndex(tasks), groups = {};
        (rolls || []).forEach(function(r) {
            if (!onStock(r)) return;
            var key = num(r.format) + '|' + r.materialId;
            var g = groups[key] || (groups[key] = { key: key, format: num(r.format), materialId: String(r.materialId), material: r.material, rolls: 0, opened: 0, rest: 0, reserved: 0, free: 0 });
            var rest = num(r.rest), rt = r.reserveTaskId && idx[r.reserveTaskId];
            g.rolls++; g.rest += rest;
            if (norm(r.status) === ROLL_STATUS.OPENED) g.opened++;
            if (rt && rt.open) g.reserved += rest; else g.free += rest;
        });
        return Object.keys(groups).map(function(k) {
            var g = groups[k];
            g.rest = round1(g.rest); g.reserved = round1(g.reserved); g.free = round1(g.free);
            return g;
        }).sort(function(a, b) { return a.format - b.format || String(a.material).localeCompare(String(b.material), 'ru'); });
    }

    function freeFor(task, rolls, moves, tolerance, tasks) {
        return (rolls || []).filter(function(r) { return r.reserveTaskId !== task.id && reserveCheck(r, task, tolerance, moves, tasks).ok; });
    }

    // Потребность открытых заданий: метраж − израсходовано, резерв, дефицит, подходящее свободное.
    function taskNeeds(tasks, rolls, moves, tolerance) {
        return (tasks || []).filter(function(t) { return t.open; }).map(function(t) {
            var consumed = 0;
            (moves || []).forEach(function(m) { if (m.kind === MOVE_KIND.OUT && String(m.taskId) === t.id) consumed -= num(m.delta); });
            var mine = (rolls || []).filter(function(r) { return r.reserveTaskId === t.id && onStock(r); });
            var reserved = round1(mine.reduce(function(a, r) { return a + num(r.rest); }, 0));
            var need = Math.max(0, round1(t.footage - consumed));
            var free = freeFor(t, rolls, moves, tolerance, tasks);
            return {
                task: t, consumed: round1(consumed), need: need, reserved: reserved, rolls: mine,
                deficit: Math.max(0, round1(need - reserved)),
                available: round1(free.reduce(function(a, r) { return a + num(r.rest); }, 0))
            };
        }).sort(function(a, b) { return a.task.start - b.task.start || a.task.id.localeCompare(b.task.id); });
    }

    // Автоподбор под дефицит: целые свободные рулоны, ближайший к мин. формату первым, старые первыми.
    function autoPick(task, rolls, moves, tolerance, deficit, tasks) {
        var left = num(deficit), out = [];
        if (!(left > 0)) return out;
        freeFor(task, rolls, moves, tolerance, tasks).filter(function(r) { return norm(r.status) === ROLL_STATUS.STOCK; })
            .sort(function(a, b) { return num(a.format) - num(b.format) || num(a.id) - num(b.id); })
            .forEach(function(r) { if (left > 0) { out.push(String(r.id)); left -= num(r.rest); } });
        return out;
    }

    // Журнал: записи + приход рулона по заданию первичной резки, если записи прихода нет.
    function journal(rolls, moves) {
        var hasIn = {};
        (moves || []).forEach(function(m) { if (m.kind === MOVE_KIND.IN) hasIn[m.rollId] = true; });
        var out = (moves || []).slice();
        (rolls || []).forEach(function(r) {
            if (hasIn[r.id] || !r.jumboJobId) return;
            out.push({ id: 'in-' + r.id, time: num(r.jumboStart), rollId: String(r.id), kind: MOVE_KIND.IN, delta: num(r.length),
                basis: 'задание первичной резки ' + r.jumboJobId, derived: true });
        });
        return out.sort(function(a, b) { return num(b.time) - num(a.time) || String(b.id).localeCompare(String(a.id)); });
    }

    function nextRollNumbers(existing, count) {
        var max = 0;
        (existing || []).forEach(function(v) {
            var m = /^\s*МР-(\d+)\s*$/i.exec(String(v == null ? '' : v));
            if (m) max = Math.max(max, parseInt(m[1], 10));
        });
        var out = [];
        for (var i = 1; i <= count; i++) { var s = String(max + i); while (s.length < 4) s = '0' + s; out.push('МР-' + s); }
        return out;
    }

    // ── Поля записей ────────────────────────────────────────────────────────

    function moveFields(t, p) {
        var r = t.rollMove.reqs, f = {};
        f['t' + t.rollMove.id] = String(p.time);
        if (r.roll) f['t' + r.roll] = String(p.rollId);
        if (r.kind && p.kindId) f['t' + r.kind] = String(p.kindId);
        if (r.delta) f['t' + r.delta] = String(round1(num(p.delta)));
        if (r.rest) f['t' + r.rest] = String(round1(num(p.rest)));
        if (r.task && p.taskId) f['t' + r.task] = String(p.taskId);
        if (r.basis && p.basis) f['t' + r.basis] = String(p.basis);
        if (r.operator && p.userId) f['t' + r.operator] = String(p.userId);
        return f;
    }

    // Остаток, статус, резерв. Формат, длина и сырьё рулона после прихода не меняются.
    function rollUpdateFields(t, p) {
        var r = t.masterRoll.reqs, f = {};
        if (r.rest && p.rest != null) f['t' + r.rest] = String(round1(num(p.rest)));
        if (r.status && p.status) f['t' + r.status] = p.status;
        if (r.reserveTask) {
            if (p.clearReserve) f['t' + r.reserveTask] = '';
            else if (p.reserveTaskId) f['t' + r.reserveTask] = String(p.reserveTaskId);
        }
        return f;
    }

    function newRollFields(t, p) {
        var r = t.masterRoll.reqs, f = {};
        f['t' + t.masterRoll.id] = p.no;
        if (r.format) f['t' + r.format] = String(num(p.format));
        if (r.length) f['t' + r.length] = String(num(p.length));
        if (r.rest) f['t' + r.rest] = String(num(p.length));
        if (r.material) f['t' + r.material] = String(p.materialId);
        if (r.status) f['t' + r.status] = ROLL_STATUS.STOCK;
        if (r.warehouse && p.warehouseId) f['t' + r.warehouse] = String(p.warehouseId);
        return f;
    }

    function receiptCheck(p) {
        if (!(num(p.format) > 0)) return { ok: false, error: 'укажите формат, мм' };
        if (!(num(p.length) > 0)) return { ok: false, error: 'укажите длину, м' };
        if (!p.materialId) return { ok: false, error: 'выберите сырьё' };
        var n = num(p.count);
        if (!(n >= 1 && n <= 100 && Math.floor(n) === n)) return { ok: false, error: 'количество рулонов — от 1 до 100' };
        if (!String(p.basis || '').trim()) return { ok: false, error: 'укажите основание прихода' };
        return { ok: true };
    }

    // ── Записи базы → модель ────────────────────────────────────────────────

    // object/{id}?JSON_KV → [{ id, val, reqs }].
    function kvRecords(d) {
        var reqs = (d && d.reqs) || {};
        return ((d && d.object) || []).map(function(o) { return { id: String(o.id), val: o.val, up: String(o.up), reqs: reqs[String(o.id)] || {} }; });
    }
    function reqVal(rec, id) { var v = id && rec.reqs ? rec.reqs[id] : ''; return v == null ? '' : String(v); }
    function refId(rec, id) {
        var v = id && rec.reqs ? rec.reqs['ref_' + id] : '';
        if (v == null || v === '') return '';
        var s = String(v), i = s.indexOf(':');
        return i >= 0 ? s.slice(i + 1) : s;
    }

    function readSettings(rows) {
        var out = {};
        Object.keys(SETTINGS).forEach(function(k) {
            var name = SETTINGS[k][0], row = (rows || []).filter(function(r) { return String(r.key).trim() === name; })[0];
            var v = row ? parseFloat(String(row.value).replace(',', '.')) : NaN;
            out[k] = isFinite(v) && v >= 0 ? v : SETTINGS[k][1];
        });
        return out;
    }

    // raw — { rolls, moves, jumboJobs, materials, warehouses, kinds } (kvRecords) + dieRows (die_tasks).
    function buildState(raw, t, settings) {
        var R = function(k) { return (t[k] && t[k].reqs) || {}; };
        var jobStart = {};
        (raw.jumboJobs || []).forEach(function(j) { jobStart[j.id] = num(j.val); });
        var rr = R('masterRoll');
        var rolls = (raw.rolls || []).map(function(m) {
            var jid = refId(m, rr.jumboJob);
            return {
                id: m.id, no: String(m.val || ''), format: num(reqVal(m, rr.format)), length: num(reqVal(m, rr.length)),
                materialId: refId(m, rr.material), material: reqVal(m, rr.material), jumboJobId: jid, jumboStart: jobStart[jid] || 0,
                rest: num(reqVal(m, rr.rest)), status: norm(reqVal(m, rr.status)), warehouseId: refId(m, rr.warehouse),
                warehouse: reqVal(m, rr.warehouse), reserveTaskId: refId(m, rr.reserveTask)
            };
        }).sort(function(a, b) { return num(a.id) - num(b.id); });
        rolls.forEach(function(r) { if (!r.status) r.status = stockStatus(r.rest, r.length, ''); });
        var kinds = {};
        (raw.kinds || []).forEach(function(k) { kinds[k.id] = norm(k.val); });
        var mr = R('rollMove');
        var moves = (raw.moves || []).map(function(m) {
            var kid = refId(m, mr.kind);
            return {
                id: m.id, time: num(m.val), rollId: refId(m, mr.roll), kind: kinds[kid] || norm(reqVal(m, mr.kind)),
                delta: num(reqVal(m, mr.delta)), rest: num(reqVal(m, mr.rest)), taskId: refId(m, mr.task),
                basis: reqVal(m, mr.basis), operator: reqVal(m, mr.operator)
            };
        });
        var tasks = buildTasks(raw.dieRows, settings.tolerance);
        var kindIds = {};
        Object.keys(kinds).forEach(function(id) { kindIds[kinds[id]] = id; });
        return {
            rolls: rolls, moves: moves, tasks: tasks, kindIds: kindIds, settings: settings,
            materials: (raw.materials || []).map(function(m) { return { id: m.id, name: String(m.val || '') }; }),
            warehouses: (raw.warehouses || []).map(function(m) { return { id: m.id, name: String(m.val || '') }; })
        };
    }

    // ── Клиент (браузер) ────────────────────────────────────────────────────

    function Client(db, xsrf) { this.db = db; this.xsrf = xsrf || ''; }
    Client.prototype.url = function(path) { return '/' + encodeURIComponent(this.db) + '/' + path; };
    Client.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            if (!resp.ok) throw new Error(path + ': HTTP ' + resp.status);
            return resp.json();
        });
    };
    Client.prototype.post = function(path, params) {
        var body = new URLSearchParams();
        body.set('_xsrf', (typeof window !== 'undefined' && window.xsrf) || this.xsrf);
        Object.keys(params || {}).forEach(function(k) { if (params[k] != null) body.set(k, params[k]); });
        return fetch(this.url(path), {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
        }).then(function(resp) {
            return resp.text().then(function(text) {
                var result;
                try { result = JSON.parse(text); } catch (e) { throw new Error('Сервер вернул не JSON: ' + text.slice(0, 200)); }
                var err = result && (result.error || result.err || (Array.isArray(result) && result[0] && result[0].error));
                if (err) throw new Error(err);
                return result;
            });
        });
    };
    // Серверное «сейчас» (заголовок Date): часы планшетов и ПК не подставляются.
    Client.prototype.serverNow = function() {
        return fetch(this.url('xsrf?JSON'), { credentials: 'same-origin', cache: 'no-store' }).then(function(resp) {
            var t = Date.parse(String(resp.headers.get('Date') || ''));
            if (!isFinite(t)) throw new Error('сервер не прислал время (заголовок Date)');
            return Math.floor(t / 1000);
        });
    };

    var NEED = ['masterRoll', 'rollMove', 'moveKind', 'material'];

    function loadState(client) {
        return client.getJson('metadata').then(function(meta) {
            var res = resolveTables(meta), t = res.tables;
            var lost = NEED.filter(function(k) { return !t[k]; });
            if (lost.length) throw new Error('в базе нет таблиц: ' + lost.map(function(k) { return TABLES[k].name; }).join(', '));
            var settingsTable = findByName(meta, 'Настройка');
            var sreq = function(name) { var r = findByName((settingsTable && settingsTable.reqs) || [], name); return r ? String(r.id) : ''; };
            var all = function(tb) { return tb ? client.getJson('object/' + tb.id + '/?JSON_KV&LIMIT=0,100000').then(kvRecords) : Promise.resolve([]); };
            return Promise.all([
                all(t.masterRoll), all(t.rollMove), all(t.jumboJob), all(t.material), all(t.warehouse), all(t.moveKind),
                client.getJson('report/die_tasks?JSON_KV&LIMIT=0,100000').catch(function() { return null; }),
                settingsTable ? all({ id: settingsTable.id }) : Promise.resolve([])
            ]).then(function(r) {
                var va = sreq('Значение');
                var settings = readSettings(r[7].map(function(s) { return { key: s.val, value: va ? reqVal(s, va) : '' }; }));
                var state = buildState({ rolls: r[0], moves: r[1], jumboJobs: r[2], materials: r[3], warehouses: r[4], kinds: r[5],
                    dieRows: Array.isArray(r[6]) ? r[6] : [] }, t, settings);
                state.tables = t;
                state.missing = res.missing.slice();
                if (!Array.isArray(r[6])) state.missing.push('отчёт die_tasks');
                return state;
            });
        });
    }

    return {
        Client: Client,
        loadState: loadState,
        core: {
            ROLL_STATUS: ROLL_STATUS, MOVE_KIND: MOVE_KIND, TABLES: TABLES, SETTINGS: SETTINGS,
            num: num, norm: norm, resolveTables: resolveTables, stockStatus: stockStatus, isFinal: isFinal, onStock: onStock,
            buildTasks: buildTasks, reserveCheck: reserveCheck, unreserveCheck: unreserveCheck, consumePlan: consumePlan,
            inventoryPlan: inventoryPlan, writeOffPlan: writeOffPlan, stockByFormat: stockByFormat, taskNeeds: taskNeeds,
            autoPick: autoPick, journal: journal, nextRollNumbers: nextRollNumbers, holder: holder,
            moveFields: moveFields, rollUpdateFields: rollUpdateFields, newRollFields: newRollFields, receiptCheck: receiptCheck,
            kvRecords: kvRecords, reqVal: reqVal, refId: refId, readSettings: readSettings, buildState: buildState
        }
    };
});
