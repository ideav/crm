// Рабочее место atex «Планирование высечки» (роль Диспетчер; ideav/crm#5320, шаг 7 Фазы 2).
//
// Вкладки: «Очередь» (задания по станкам и дням), «Дефицит форматов» (нужно / на складе / в резке /
// дефицит / к дате), «Гант» (полосы станков за день), «Загрузка ножей и валов».
// Кнопки: «Сформировать задания» (из позиций заказов этикетки), «Упорядочить» (показывает план) →
// «Применить» (пишет план-старт, станок, вал, наладку и длительность), «Зарезервировать МР»
// (резерв по правилам склада мастер-рулонов), «Задачи на втулки» (под позицией, для втулкореза).
// Ядро — die-planning-core.js (покрыто experiments/atex-p2-5320-die-planning.test.js).

(function(root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') {
        window.AtexDiePlanningApp = api;
        var start = function() {
            var el = document.getElementById('atex-dp-app');
            if (el && !el.__atexDp) el.__atexDp = new api.AtexDiePlanningApp(el).start();
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
        else start();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
    'use strict';

    var DP = (root && root.AtexDiePlanning) || (typeof require === 'function' ? require('./die-planning-core.js') : null);
    var C = DP ? DP.core : null;
    var MRA = (root && root.AtexMasterRolls) || (typeof require === 'function' ? require('./master-rolls-core.js') : null);
    var MR = MRA ? MRA.core : null;
    var JCA = (root && root.AtexJumboCutMap) || (typeof require === 'function' ? require('./jumbo-cut-map.js') : null);
    var JC = JCA ? JCA.core : null;
    var LPA = (root && root.AtexLabelProduction) || (typeof require === 'function' ? require('../../atex/js/label-production.js') : null);
    var LP = LPA ? LPA.core : null;
    var LO = ((root && root.AtexLabelOrders) || (typeof require === 'function' ? require('./label-orders.js') : null)).core;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function fmtNum(n) {
        var v = Math.round(C.num(n) * 10) / 10, p = String(Math.abs(v)).split('.');
        return (v < 0 ? '−' : '') + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (p[1] ? ',' + p[1] : '');
    }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    // Unix-секунды → «ДД.ММ ЧЧ:ММ» по Москве (время в РМ серверное, московское).
    function fmtTime(unix) {
        var t = C.num(unix);
        if (!(t > 0)) return '—';
        var d = new Date((t + 3 * 3600) * 1000);
        return pad(d.getUTCDate()) + '.' + pad(d.getUTCMonth() + 1) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
    }
    function fmtDate(unix) {
        var d = new Date((C.num(unix) + 3 * 3600) * 1000);
        return pad(d.getUTCDate()) + '.' + pad(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear();
    }
    var WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    function fmtClock(min) { return pad(Math.floor(min / 60)) + ':' + pad(Math.round(min % 60)); }

    var WEAR = { ok: ['', 'в норме'], near: ['is-warn', 'от 90 % ресурса'], over: ['is-bad', 'ресурс выработан'], '': ['', 'ресурс не задан'] };
    var SETUP_LABEL = { cylinder: 'смена вала', knife: 'смена ножа', none: '—' };

    function AtexDiePlanningApp(el) {
        this.el = el;
        this.client = new MRA.Client(el.getAttribute('data-db'), el.getAttribute('data-xsrf'));
        this.db = el.getAttribute('data-db');
        this.state = null;
        this.plan = null;
        this.tab = 'queue';
        this.ganttDay = null;
        this.busy = false;
    }

    AtexDiePlanningApp.prototype.$ = function(id) { return this.el.querySelector('#' + id); };

    AtexDiePlanningApp.prototype.start = function() {
        var self = this;
        this.el.addEventListener('click', function(e) { self.onClick(e); });
        this.el.addEventListener('change', function(e) { self.onChange(e); });
        this.$('atex-dp-modal-cancel').addEventListener('click', function() { self.closeModal(); });
        this.$('atex-dp-modal-ok').addEventListener('click', function() { if (self.modalOk) self.modalOk(); });
        this.reload();
        return this;
    };

    AtexDiePlanningApp.prototype.message = function(text, kind) {
        var m = this.$('atex-dp-message');
        if (!text) { m.hidden = true; return; }
        m.hidden = false;
        m.className = 'atex-dp-message' + (kind ? ' is-' + kind : '');
        m.textContent = text;
    };

    // ── Загрузка ────────────────────────────────────────────────────────────

    AtexDiePlanningApp.prototype.reload = function(note) {
        var self = this, c = this.client;
        this.message('Загрузка…');
        var optional = function(p) { return p.catch(function(err) { console.warn('[die-planning] ' + err.message); return null; }); };
        return c.getJson('metadata').then(function(meta) {
            var res = LP.resolveProductionTables(meta, LP.PRODUCT_KIND.LABEL), t = res.tables;
            var lost = ['dieJob', 'die', 'cylinder', 'machine', 'material', 'dieState'].filter(function(k) { return !t[k]; });
            if (lost.length) throw new Error('в базе нет таблиц: ' + lost.join(', '));
            var settingsTable = meta.filter(function(x) { return String(x.val).trim() === 'Настройка'; })[0] || null;
            var sreq = function(tb, name) { var r = ((tb && tb.reqs) || []).filter(function(x) { return String(x.val).trim() === name; })[0]; return r ? String(r.id) : ''; };
            var cutterTable = meta.filter(function(x) { return String(x.val).trim() === 'Втулкорез'; })[0] || null;
            var kv = function(tid) { return tid ? c.getJson('object/' + tid + '/?JSON_KV&LIMIT=0,100000').then(LO.kvRecords) : Promise.resolve([]); };
            return Promise.all([
                c.getJson('report/die_planning?JSON_KV&LIMIT=0,100000'),
                c.getJson('report/label_positions?JSON_KV&LIMIT=0,10000'),
                kv(t.die.id), kv(t.cylinder.id), kv(t.dieState.id), kv(t.material.id), kv(t.machine.id),
                t.dieBrand ? kv(t.dieBrand.id) : Promise.resolve([]),
                settingsTable ? kv(settingsTable.id) : Promise.resolve([]),
                cutterTable ? kv(cutterTable.id) : Promise.resolve([]),
                optional(c.getJson('report/die_runs?JSON_KV&LIMIT=0,100000')),
                optional(c.getJson('report/die_planning_sleeves?JSON_KV&LIMIT=0,100000')),
                MRA.loadState(c),
                optional(JCA.loadState(c, LP, {})),
                c.serverNow()
            ]).then(function(r) {
                self.build(meta, res, { settingsTable: settingsTable, cutterTable: cutterTable, sreq: sreq }, r);
                var missing = res.missing.filter(function(m) { return /^(Задание высечки|Нож|Станок высечки|Вал)/.test(m); });
                if (missing.length) self.message('Не найдено в базе: ' + missing.join('; ') + '. Часть данных не показана.', 'warn');
                else self.message(note || '', note ? 'ok' : '');
                self.render();
            });
        }).catch(function(err) {
            console.error('[die-planning] ❌ загрузка', err);
            self.message('Не удалось загрузить планирование высечки: ' + err.message, 'error');
        });
    };

    AtexDiePlanningApp.prototype.build = function(meta, res, extra, r) {
        var t = res.tables, kvRep = function(x) { return Array.isArray(x) ? x : []; };
        var typeReq = extra.sreq(extra.settingsTable, 'Тип'), valReq = extra.sreq(extra.settingsTable, 'Значение');
        var settings = C.readSettings(r[8].map(function(s) {
            return { key: s.val, type: typeReq ? (s.reqs[typeReq] || '') : '', value: valReq ? (s.reqs[valReq] || '') : '' };
        }), this.db);
        var rows = kvRep(r[0]);
        var selectable = {};
        r[4].forEach(function(s) { if (LO.bool(s.reqs[t.dieState.reqs.selectable])) selectable[s.id] = true; });
        var cylinders = LO.cylinderRepeats(r[3], t);
        var mileage = Array.isArray(r[10]) ? LO.mileageByDie(r[10]) : null;
        var dies = C.buildDieIndex(r[2], t, selectable, cylinders, mileage);
        var brandRes = {};
        r[7].forEach(function(b) { brandRes[b.id] = (b.reqs[t.dieBrand.reqs.resource] || ''); });
        var mr = r[12], jc = r[13];
        var jobs = C.buildJobs(rows);
        var dieById = {};
        dies.forEach(function(d) { dieById[d.id] = d; });
        // вал задания пуст — берётся из ножа (его запишет «Применить»)
        jobs.forEach(function(j) {
            var d = dieById[j.dieId];
            if (!j.cylinderId && d && d.cylinderId) { j.cylinderId = d.cylinderId; j.cylinder = String(d.cylinder || ''); j.cylinderMissing = true; }
        });
        var machines = C.machinesFromRecords(r[6], t);
        var diInfo = C.dieInfo(dies, brandRes, settings.dieResource);
        var rolls = mr.rolls.map(function(x) { return { id: x.id, no: x.no, format: x.format, materialId: x.materialId, rest: x.rest, status: x.status }; });
        var queue = jc && jc.openJobs ? JC.queueSupply(jc.openJobs, settings.mrLength) : [];
        var openJobs = jobs.filter(function(j) { return C.isMovable(j); });
        var cover = C.coverJobs(openJobs, rolls, queue, settings.tolerance);
        var groups = JC.coverDemand(JC.demandGroups(rows, { tolerance: settings.tolerance }), JC.stockSupply(rolls), queue);
        var materials = LO.materialIndex(r[5], t);
        var positions = kvRep(r[1]).map(function(x) { return LO.positionFromRow(x, materials); });
        var cutters = r[9].map(function(x) {
            var tb = extra.cutterTable, lo = extra.sreq(tb, 'Диаметр min, мм'), hi = extra.sreq(tb, 'Диаметр max, мм');
            return { id: x.id, name: x.val, min: C.num(x.reqs[lo]), max: C.num(x.reqs[hi]) };
        });
        var sleeveTasks = {};
        var st = C.resolveSleeveTask(meta);
        kvRep(r[11]).forEach(function(x) {
            var pid = String(x.position_id || '');
            if (!pid) return;
            (sleeveTasks[pid] = sleeveTasks[pid] || []).push({ id: String(x.task_id), start: C.num(x.task_start), qty: C.num(x.qty), cutterId: String(x.cutter_id || ''),
                touched: !!(String(x.started || '').trim() || String(x.finished || '').trim() || String(x.fact || '').trim()) });
        });
        this.state = {
            tables: t, settings: settings, rows: rows, jobs: jobs, machines: machines, dies: dies, dieInfo: diInfo, mr: mr, rolls: rolls, queue: queue,
            cover: cover, groups: groups, positions: positions, cutters: cutters, sleeveTasks: sleeveTasks, sleeveTable: st,
            sleeveReport: Array.isArray(r[11]), now: r[14], jobById: {}
        };
        var s = this.state;
        jobs.forEach(function(j) { s.jobById[j.id] = j; });
        s.openMeters = C.openMetersByDie(jobs);
        s.flags = {};
        jobs.forEach(function(j) { if (!C.isFinal(j)) s.flags[j.id] = C.jobFlags(j, { dies: diInfo, openMeters: s.openMeters, cover: cover }); });
        this.plan = null;
        this.cur = null;
    };

    AtexDiePlanningApp.prototype.blockedMap = function() {
        var out = {}, f = this.state.flags;
        Object.keys(f).forEach(function(id) { if (f[id].blocks.length) out[id] = f[id].blocks; });
        return out;
    };

    // ── Отрисовка ───────────────────────────────────────────────────────────

    AtexDiePlanningApp.prototype.render = function() {
        var s = this.state;
        if (!s) return;
        var self = this;
        var open = s.jobs.filter(function(j) { return !C.isFinal(j); });
        var blocks = 0, warns = 0;
        open.forEach(function(j) { var f = s.flags[j.id]; if (f.blocks.length) blocks++; if (f.warnings.length) warns++; });
        var deficit = s.groups.filter(function(g) { return g.deficit > 0; }).length;
        var tile = function(v, label, cls) { return '<div class="atex-dp-kpi-tile ' + (cls || '') + '"><div class="atex-dp-kpi-value">' + esc(v) + '</div><div class="atex-dp-kpi-label">' + esc(label) + '</div></div>'; };
        this.$('atex-dp-kpi').innerHTML = tile(open.length, 'заданий высечки в очереди') + tile(blocks, 'с блокировками', blocks ? 'is-bad' : '') +
            tile(warns, 'с предупреждениями', warns ? 'is-warn' : '') + tile(deficit, 'форматов с дефицитом МР', deficit ? 'is-bad' : '') +
            tile(this.plan ? this.plan.summary.late : '—', 'просрочек в плане', this.plan && this.plan.summary.late ? 'is-bad' : '');
        Array.prototype.forEach.call(this.el.querySelectorAll('.atex-dp-tab'), function(b) { b.classList.toggle('is-active', b.getAttribute('data-tab') === self.tab); });
        this.$('atex-dp-apply').disabled = !this.plan || !this.changedItems().length;
        var body = this.$('atex-dp-body');
        if (this.tab === 'deficit') body.innerHTML = this.renderDeficit();
        else if (this.tab === 'gantt') body.innerHTML = this.renderGantt();
        else if (this.tab === 'load') body.innerHTML = this.renderLoad();
        else body.innerHTML = this.renderQueue();
    };

    AtexDiePlanningApp.prototype.badges = function(job) {
        var f = this.state.flags[job.id] || { blocks: [], warnings: [] };
        return f.blocks.map(function(b) { return '<span class="atex-dp-badge is-bad">' + esc(b) + '</span>'; }).join(' ') +
            f.warnings.map(function(w) { return ' <span class="atex-dp-badge is-warn">' + esc(w) + '</span>'; }).join('');
    };

    AtexDiePlanningApp.prototype.jobCells = function(j, it, stored) {
        var plan = it ? it : null;
        var changed = function(a, b) { return plan && String(a) !== String(b) ? ' is-changed' : ''; };
        var start = plan ? plan.start : j.start, setup = plan ? plan.setup : j.setup, dur = plan ? plan.run : j.duration;
        var late = plan && plan.late;
        return '<td>' + esc(j.id) + '<div class="atex-dp-muted">' + esc(j.orderNo ? 'заказ ' + j.orderNo : 'поз. ' + j.positionId) + '</div></td>' +
            '<td>' + esc(j.dieNo || '—') + '<div class="atex-dp-muted">вал ' + esc(j.cylinder || '—') + '</div></td>' +
            '<td>' + esc(j.material) + '</td><td class="num">' + fmtNum(j.footage) + '</td>' +
            '<td class="num' + changed(setup, j.setup) + '">' + fmtNum(setup) + (plan && plan.setupKind !== 'none' ? '<div class="atex-dp-muted">' + SETUP_LABEL[plan.setupKind] + '</div>' : '') + '</td>' +
            '<td class="num' + changed(dur, j.duration) + '">' + fmtNum(dur) + '</td>' +
            '<td class="num' + changed(start, j.start) + '">' + esc(fmtTime(start)) + '</td>' +
            '<td class="num' + (late ? ' is-late' : '') + '">' + (j.due > 0 ? esc(j.dueText) : '—') + (late ? '<div class="atex-dp-badge is-bad">просрочка</div>' : '') + '</td>' +
            '<td>' + (stored ? '<span class="atex-dp-badge ' + (/работ/i.test(j.status) ? 'is-info' : '') + '">' + esc(j.status || '—') + '</span> ' : '') + this.badges(j) + '</td>';
    };

    AtexDiePlanningApp.prototype.renderQueue = function() {
        var s = this.state, self = this, head = '<thead><tr><th>Задание</th><th>Нож, вал</th><th>Сырьё</th><th class="num">Метраж, м</th><th class="num">Наладка, мин</th><th class="num">Длит., мин</th><th class="num">Старт</th><th class="num">Срок</th><th>Состояние</th></tr></thead>';
        var html = [];
        var machines = s.machines;
        if (this.plan) {
            machines.forEach(function(m) {
                var items = (self.plan.machines[m.id] || { items: [] }).items.filter(function(i) { return !i.done; });
                html.push(self.machineBlock(m, items.map(function(i) { return '<tr class="' + (i.fixed ? 'is-fixed' : '') + '">' + self.jobCells(s.jobById[i.jobId], i, true) + '</tr>'; }), head, items.length));
            });
            if (this.plan.unplaced.length) {
                html.push('<h3 class="atex-dp-h">Не размещены (' + this.plan.unplaced.length + ')</h3><table class="atex-dp-table"><thead><tr><th>Задание</th><th>Нож, вал</th><th>Сырьё</th><th>Причина</th></tr></thead><tbody>' +
                    this.plan.unplaced.map(function(u) {
                        var j = s.jobById[u.jobId];
                        return '<tr class="is-deficit"><td>' + esc(u.jobId) + '</td><td>' + esc(j.dieNo || '—') + ' / ' + esc(j.cylinder || '—') + '</td><td>' + esc(j.material) + '</td><td>' + esc(u.reasons.join('; ')) + '</td></tr>';
                    }).join('') + '</tbody></table>');
            }
            html.unshift('<p class="atex-dp-muted">План не записан: ' + this.changedItems().length + ' заданий изменятся. Наладок — ' + this.plan.summary.setupMinutes + ' мин, смен вала — ' + this.plan.summary.cylinderChanges + '. Изменённые значения подсвечены. Кнопка «Применить» записывает план.</p>');
        } else {
            var by = {};
            s.jobs.filter(function(j) { return !C.isFinal(j); }).sort(function(a, b) { return a.start - b.start; }).forEach(function(j) {
                (by[j.machineId || ''] = by[j.machineId || ''] || []).push(j);
            });
            machines.forEach(function(m) {
                var list = by[m.id] || [];
                html.push(self.machineBlock(m, list.map(function(j) { return '<tr>' + self.jobCells(j, null, true) + '</tr>'; }), head, list.length));
            });
            var free = by[''] || [];
            if (free.length) html.push(this.machineBlock({ id: '', name: 'Станок не назначен' }, free.map(function(j) { return '<tr>' + self.jobCells(j, null, true) + '</tr>'; }), head, free.length));
            if (!s.jobs.filter(function(j) { return !C.isFinal(j); }).length) return '<div class="atex-dp-empty">Открытых заданий высечки нет. «Сформировать задания» создаёт их из позиций заказов этикетки.</div>';
        }
        return html.join('');
    };

    AtexDiePlanningApp.prototype.machineBlock = function(m, rows, head, n) {
        return '<h3 class="atex-dp-h">' + esc(m.name || m.id) + ' <span class="atex-dp-muted">' + n + ' зад.' + (m.active === false ? ' · ' + esc(m.status) : '') + '</span></h3>' +
            (n ? '<table class="atex-dp-table">' + head + '<tbody>' + rows.join('') + '</tbody></table>' : '<div class="atex-dp-empty">Заданий нет.</div>');
    };

    AtexDiePlanningApp.prototype.renderDeficit = function() {
        var s = this.state;
        if (!s.groups.length) return '<div class="atex-dp-empty">Заданий без мастер-рулона нет — потребности в МР нет.</div>';
        var rows = s.groups.map(function(g) {
            return '<tr class="' + (g.deficit > 0 ? 'is-deficit' : '') + '"><td class="num">' + g.min + '–' + g.max + '</td><td>' + esc(g.material) + '</td>' +
                '<td class="num">' + fmtNum(g.meters) + '</td><td class="num">' + fmtNum(g.stock) + '</td><td class="num">' + fmtNum(g.planned) + '</td>' +
                '<td class="num">' + (g.deficit > 0 ? '<b>' + fmtNum(g.deficit) + '</b>' : '—') + '</td>' +
                '<td class="num">' + esc(g.due > 0 ? fmtDate(g.due) : '—') + (g.late ? ' <span class="atex-dp-badge is-bad">резка позже</span>' : '') + '</td>' +
                '<td>' + g.jobs.map(esc).join(', ') + '</td></tr>';
        });
        return '<table class="atex-dp-table"><thead><tr><th class="num">Формат, мм</th><th>Сырьё</th><th class="num">Нужно, м</th><th class="num">На складе, м</th><th class="num">В резке, м</th><th class="num">Дефицит, м</th><th class="num">К дате</th><th>Задания</th></tr></thead><tbody>' +
            rows.join('') + '</tbody></table><p class="atex-dp-muted">Нужно — метраж заданий без мастер-рулона по сроку; на складе — рулоны подходящего сырья и формата; в резке — рулоны открытых заданий первичной резки. «К дате» — ближайший плановый старт группы. Расчёт — тот же, что у раскроя джамбо.</p>';
    };

    AtexDiePlanningApp.prototype.ganttDays = function() {
        var s = this.state, cal = C.createCalendar(s.settings), first = cal.dayOf(s.now), days = [];
        for (var d = first, n = 0; n < s.settings.horizonDays + 14 && days.length < s.settings.horizonDays; d++, n++) if (cal.isWork(d)) days.push(d);
        return days;
    };

    AtexDiePlanningApp.prototype.renderGantt = function() {
        var s = this.state, cal = C.createCalendar(s.settings);
        var days = this.ganttDays();
        if (this.ganttDay == null || days.indexOf(this.ganttDay) < 0) this.ganttDay = this.plan && this.plan.firstDay != null && days.indexOf(this.plan.firstDay) >= 0 ? this.plan.firstDay : days[0];
        // без плана — Гант текущей записи: задания со станком, расчёт от их старта
        var source = this.plan || this.currentPlan();
        var g = C.ganttDay(source.machines, s.machines, this.ganttDay, s.settings);
        var opts = days.map(function(d) {
            var ts = cal.dayTs(d, 0);
            return '<option value="' + d + '"' + (d === this.ganttDay ? ' selected' : '') + '>' + WEEKDAYS[new Date((ts + 3 * 3600) * 1000).getUTCDay()] + ' ' + fmtDate(ts) + '</option>';
        }, this).join('');
        var hours = [];
        for (var m = 0; m <= g.capacity; m += 60) hours.push('<span style="left:' + (m / g.capacity * 100) + '%">' + fmtClock(s.settings.dayStartMin + m) + '</span>');
        var rows = g.rows.map(function(r) {
            var bars = r.bars.map(function(b) {
                var cls = b.done ? 'is-done' : b.fixed ? 'is-fixed' : b.kind;
                var j = s.jobById[b.jobId] || {};
                var label = b.kind === 'run' ? esc(b.jobId) : b.kind === 'setup-cylinder' ? 'вал' : 'нож';
                var title = (b.kind === 'run' ? 'Вырубка' : b.kind === 'setup-cylinder' ? 'Смена вала' : 'Смена ножа') + ' · задание ' + b.jobId + ' · нож ' + (j.dieNo || '—') + ' · ' +
                    fmtClock(s.settings.dayStartMin + b.from) + '–' + fmtClock(s.settings.dayStartMin + b.from + b.minutes) + ' · ' + fmtNum(b.minutes) + ' мин';
                return '<div class="atex-dp-bar ' + cls + '" style="left:' + (b.from / g.capacity * 100) + '%;width:' + (b.minutes / g.capacity * 100) + '%" title="' + esc(title) + '">' + label + '</div>';
            }).join('');
            return '<div class="atex-dp-gantt-row"><div class="atex-dp-gantt-name">' + esc(r.name) + '<div class="atex-dp-muted">занято ' + fmtNum(r.used) + ' · свободно ' + fmtNum(r.free) + ' мин</div></div><div class="atex-dp-gantt-track">' + bars + '</div></div>';
        }).join('');
        return '<div class="atex-dp-filters"><label>День <select class="atex-dp-input" data-gantt-day>' + opts + '</select></label>' +
            '<span class="atex-dp-legend"><i class="atex-dp-bar setup-cylinder"></i>смена вала <i class="atex-dp-bar setup-knife"></i>смена ножа <i class="atex-dp-bar run"></i>вырубка <i class="atex-dp-bar is-fixed"></i>начато / стоит <i class="atex-dp-bar is-free"></i>свободно</span></div>' +
            '<div class="atex-dp-gantt"><div class="atex-dp-gantt-row"><div class="atex-dp-gantt-name"></div><div class="atex-dp-gantt-track atex-dp-gantt-scale">' + hours.join('') + '</div></div>' + rows + '</div>' +
            '<p class="atex-dp-muted">' + (this.plan ? 'Показан план (не записан).' : 'Показан записанный план: задания со станком, считая от их плановых стартов.') + ' Смена с ' + fmtClock(s.settings.dayStartMin) + ', ' + s.settings.dayCapacityMin + ' мин.</p>';
    };

    // Записанное положение дел в виде плана (для Ганта и загрузки без «Упорядочить»).
    AtexDiePlanningApp.prototype.currentPlan = function() {
        var s = this.state;
        if (this.cur) return this.cur;
        var jobs = s.jobs.map(function(j) { return Object.assign({}, j, { status: j.machineId && C.isMovable(j) ? 'В работе' : j.status }); });
        this.cur = C.orderQueue({ jobs: jobs, machines: s.machines, from: 0, settings: s.settings });
        return this.cur;
    };

    AtexDiePlanningApp.prototype.renderLoad = function() {
        var s = this.state, plan = this.plan;
        if (!plan) return '<div class="atex-dp-empty">Нажмите «Упорядочить» — загрузка считается по плану на ' + s.settings.horizonDays + ' дн.</div>';
        var L = C.toolLoad({ plan: plan, jobs: s.jobs, from: s.now, settings: s.settings, dies: s.dieInfo });
        var kn = L.knives.map(function(k) {
            var w = WEAR[k.level] || WEAR[''];
            return '<tr><td>' + esc(k.dieNo || k.dieId) + '</td><td class="num">' + k.jobs + '</td><td class="num">' + fmtNum(k.minutes) + '</td><td class="num">' + fmtNum(k.meters) + '</td>' +
                '<td class="num">' + fmtNum(k.mileage) + '</td><td class="num">' + fmtNum(k.mileageAfter) + '</td><td class="num">' + (k.resource ? fmtNum(k.resource) : '—') + '</td>' +
                '<td><span class="atex-dp-badge ' + w[0] + '">' + w[1] + '</span></td></tr>';
        }).join('');
        var cy = L.cylinders.map(function(c) {
            return '<tr><td>' + esc(c.cylinder || c.cylinderId) + '</td><td class="num">' + c.jobs + '</td><td class="num">' + fmtNum(c.minutes) + '</td><td class="num">' + c.changes + '</td></tr>';
        }).join('');
        return '<h3 class="atex-dp-h">Ножи <span class="atex-dp-muted">горизонт ' + s.settings.horizonDays + ' дн. с ' + esc(fmtDate(s.now)) + '</span></h3>' +
            (kn ? '<table class="atex-dp-table"><thead><tr><th>Нож</th><th class="num">Заданий</th><th class="num">Минут</th><th class="num">Метров</th><th class="num">Пробег сейчас, м</th><th class="num">Пробег после плана, м</th><th class="num">Ресурс, м</th><th>Износ</th></tr></thead><tbody>' + kn + '</tbody></table>' : '<div class="atex-dp-empty">В горизонте плана заданий нет.</div>') +
            '<h3 class="atex-dp-h">Валы</h3>' +
            (cy ? '<table class="atex-dp-table"><thead><tr><th>Вал</th><th class="num">Заданий</th><th class="num">Минут (с наладкой)</th><th class="num">Смен вала</th></tr></thead><tbody>' + cy + '</tbody></table>' : '<div class="atex-dp-empty">Нет данных.</div>');
    };

    // ── События ─────────────────────────────────────────────────────────────

    AtexDiePlanningApp.prototype.onClick = function(e) {
        var tab = e.target.closest('[data-tab]');
        if (tab && this.el.contains(tab)) { this.tab = tab.getAttribute('data-tab'); this.render(); return; }
        var b = e.target.closest('[data-act]');
        if (!b || !this.el.contains(b) || b.disabled || this.busy) return;
        var act = b.getAttribute('data-act');
        if (act === 'refresh') { this.reload(); return; }
        if (!this.state) return;
        if (act === 'form') this.openForm();
        else if (act === 'order') this.doOrder();
        else if (act === 'apply') this.openApply();
        else if (act === 'reserve') this.openReserve();
        else if (act === 'sleeves') this.openSleeves();
    };
    AtexDiePlanningApp.prototype.onChange = function(e) {
        if (e.target.hasAttribute && e.target.hasAttribute('data-gantt-day')) { this.ganttDay = parseInt(e.target.value, 10); this.render(); }
    };

    // ── Модальное окно и запись ─────────────────────────────────────────────

    AtexDiePlanningApp.prototype.openModal = function(html, okText, onOk) {
        this.$('atex-dp-modal-text').innerHTML = html;
        this.$('atex-dp-modal-error').textContent = '';
        var ok = this.$('atex-dp-modal-ok');
        ok.textContent = okText || 'Подтвердить';
        ok.disabled = !onOk;
        ok.hidden = !onOk;
        this.modalOk = onOk;
        this.$('atex-dp-modal').hidden = false;
    };
    AtexDiePlanningApp.prototype.closeModal = function() { this.$('atex-dp-modal').hidden = true; this.modalOk = null; };

    // Первая колонка записи (план-старт, дата задачи) меняется только через _m_save, _m_set её не пишет.
    // Последовательная запись: ошибка останавливает цепочку, записанное остаётся и видно после перечитки.
    AtexDiePlanningApp.prototype.run = function(steps, doneText) {
        var self = this, done = 0;
        if (this.busy) return;
        this.busy = true;
        this.$('atex-dp-modal-ok').disabled = true;
        steps.reduce(function(p, step) { return p.then(function() { return step().then(function() { done++; }); }); }, Promise.resolve()).then(function() {
            self.busy = false;
            self.closeModal();
            self.reload(doneText);
        }).catch(function(err) {
            console.error('[die-planning] ❌ запись', err);
            self.busy = false;
            self.$('atex-dp-modal-ok').disabled = false;
            self.$('atex-dp-modal-error').textContent = 'Ошибка записи (выполнено шагов: ' + done + ' из ' + steps.length + '): ' + err.message;
            if (done) self.reload();
        });
    };

    function listHtml(items, max) {
        if (!items.length) return '';
        return '<ul class="atex-dp-list">' + items.slice(0, max || 12).map(function(x) { return '<li>' + x + '</li>'; }).join('') + (items.length > (max || 12) ? '<li>… и ещё ' + (items.length - (max || 12)) + '</li>' : '') + '</ul>';
    }

    // Сформировать задания из позиций.
    AtexDiePlanningApp.prototype.openForm = function() {
        var self = this, s = this.state;
        var f = C.formJobs({ positions: s.positions, dies: s.dies, jobs: s.jobs, settings: s.settings, mrLength: s.settings.mrLength, itsMin: s.settings.itsMin, itsMax: s.settings.itsMax });
        var skipped = f.skipped.filter(function(x) { return !/уже есть задание/.test(x.reason); });
        var html = '<h3>Сформировать задания высечки</h3>' +
            (f.create.length ? '<p>Будет создано заданий: <b>' + f.create.length + '</b> (по одному на позицию; нож подобран, ИТС не ждёт).</p>' +
                listHtml(f.create.map(function(x) { return 'заказ ' + esc(x.orderNo) + ', нож ' + esc(x.dieNo) + ': ' + fmtNum(x.footage) + ' м, МР ' + x.pullsPlan + ', ' + x.duration + ' мин'; }), 15)
                : '<p>Позиций, готовых к планированию и без задания, нет.</p>') +
            (skipped.length ? '<p class="atex-dp-muted">Не идут в планирование (' + skipped.length + '):</p>' + listHtml(skipped.map(function(x) { return 'позиция ' + esc(x.positionId) + ' — ' + esc(x.reason); }), 8) : '');
        this.openModal(html, 'Создать', f.create.length ? function() {
            var t = s.tables, now = s.now;
            self.run(f.create.map(function(p, i) {
                return function() { return self.client.post('_m_new/' + t.dieJob.id + '?JSON&up=1', C.jobCreateFields(t, Object.assign({ start: now + i }, p))).then(function(res) {
                    if (!(res && (res.id || res.obj))) throw new Error('сервер не вернул id задания для позиции ' + p.positionId);
                }); };
            }), 'Создано заданий: ' + f.create.length + '.');
        } : null);
    };

    // Упорядочить: показать план.
    AtexDiePlanningApp.prototype.doOrder = function() {
        var s = this.state;
        this.plan = C.orderQueue({ jobs: s.jobs, machines: s.machines, from: s.now, settings: s.settings, blocked: this.blockedMap() });
        var cal = C.createCalendar(s.settings), first = null;
        Object.keys(this.plan.machines).forEach(function(id) {
            this.plan.machines[id].items.forEach(function(i) { if (!i.done && !i.fixed && (first == null || i.start < first)) first = i.start; });
        }, this);
        this.plan.firstDay = first == null ? null : cal.dayOf(first);
        this.tab = 'queue';
        var n = this.changedItems().length;
        this.message('План построен: заданий ' + this.plan.summary.jobs + ', изменится ' + n + ', не размещено ' + this.plan.unplaced.length + ', просрочек ' + this.plan.summary.late + '. Проверьте и нажмите «Применить».', this.plan.unplaced.length || this.plan.summary.late ? 'warn' : 'ok');
        this.render();
    };

    AtexDiePlanningApp.prototype.changedItems = function() {
        var s = this.state, out = [];
        if (!this.plan) return out;
        Object.keys(this.plan.machines).forEach(function(mid) {
            this.plan.machines[mid].items.forEach(function(i) {
                if (i.fixed || i.done) return;
                var j = s.jobById[i.jobId], m = s.machines.filter(function(x) { return x.id === mid; })[0];
                if (j.start !== i.start || j.machineId !== mid || C.num(j.setup) !== i.setup || C.num(j.duration) !== i.run || j.cylinderMissing) out.push({ item: i, job: j, machine: m });
            });
        }, this);
        return out;
    };

    AtexDiePlanningApp.prototype.openApply = function() {
        var self = this, s = this.state, list = this.changedItems();
        if (!list.length) { this.message('Записанный план совпадает с расчётным — писать нечего.', 'ok'); return; }
        var html = '<h3>Применить план</h3><p>Будет записано заданий: <b>' + list.length + '</b> — план-старт, станок, вал, наладка и длительность. Начатые и выполненные задания не меняются.</p>' +
            listHtml(list.map(function(x) { return 'задание ' + esc(x.job.id) + ' → ' + esc(x.machine.name) + ', ' + esc(fmtTime(x.item.start)) + ', наладка ' + x.item.setup + ' мин, ' + x.item.run + ' мин'; }), 12);
        this.openModal(html, 'Записать план', function() {
            var t = s.tables;
            self.run(list.map(function(x) {
                return function() { return self.client.post('_m_save/' + encodeURIComponent(x.job.id) + '?JSON', C.jobPlanFields(t, { start: x.item.start, machineId: x.machine.id, cylinderId: x.job.cylinderId, setup: x.item.setup, duration: x.item.run })); };
            }), 'План записан: ' + list.length + ' заданий.');
        });
    };

    // Зарезервировать МР.
    AtexDiePlanningApp.prototype.openReserve = function() {
        var self = this, s = this.state, tol = s.settings.tolerance;
        var plan = C.planReservations(s.mr.tasks, s.mr.rolls, s.mr.moves, tol);
        var picks = plan.filter(function(p) { return p.rollIds.length; }), short = plan.filter(function(p) { return p.deficit > 0; });
        var rollById = {};
        s.mr.rolls.forEach(function(r) { rollById[r.id] = r; });
        var html = '<h3>Зарезервировать мастер-рулоны</h3>' +
            (picks.length ? '<p>Подобрано целых рулонов со склада: <b>' + picks.reduce(function(a, p) { return a + p.rollIds.length; }, 0) + '</b> для заданий: ' + picks.length + '. Правила — как у склада мастер-рулонов: только целые рулоны, формат в допуске ' + tol + ' мм.</p>' +
                listHtml(picks.map(function(p) { return 'задание ' + esc(p.taskId) + ': ' + p.rollIds.map(function(id) { return esc(rollById[id].no) + ' (' + rollById[id].format + ' мм)'; }).join(', '); }), 15)
                : '<p>Подходящих свободных рулонов нет.</p>') +
            (short.length ? '<p class="atex-dp-muted">Дефицит остаётся у заданий: ' + short.map(function(p) { return esc(p.taskId) + ' (' + fmtNum(p.deficit) + ' м)'; }).join(', ') + '.</p>' : '');
        this.openModal(html, 'Зарезервировать', picks.length ? function() {
            var steps = [];
            picks.forEach(function(p) {
                p.rollIds.forEach(function(id) {
                    steps.push(function() { return self.client.post('_m_set/' + encodeURIComponent(id) + '?JSON', MR.rollUpdateFields(s.mr.tables, { reserveTaskId: p.taskId })); });
                });
            });
            self.run(steps, 'Зарезервировано рулонов: ' + steps.length + ' под заданий ' + picks.length + '.');
        } : null);
    };

    // Задачи на втулки.
    AtexDiePlanningApp.prototype.openSleeves = function() {
        var self = this, s = this.state;
        if (!s.sleeveTable || !s.sleeveTable.reqs.qty) { this.message('В базе нет таблицы «Задача на втулки» с колонкой «Кол-во».', 'error'); return; }
        if (!s.sleeveReport) { this.message('Не прочитан отчёт die_planning_sleeves — задачи могли бы задублироваться, запись остановлена.', 'error'); return; }
        var sp = C.sleevePlan({ jobs: s.jobs, tasks: s.sleeveTasks, cutters: s.cutters });
        var html = '<h3>Задачи на втулки</h3>' +
            (sp.ops.length ? '<p>Создать: <b>' + sp.ops.filter(function(o) { return o.op === 'create'; }).length + '</b>, привести к плану: <b>' + sp.ops.filter(function(o) { return o.op === 'update'; }).length + '</b>. Количество — рулоны позиции, дата — план-старт задания высечки.</p>' +
                listHtml(sp.ops.map(function(o) { var c = s.cutters.filter(function(x) { return x.id === o.cutterId; })[0]; return (o.op === 'create' ? 'новая' : 'задача ' + esc(o.taskId)) + ': позиция ' + esc(o.positionId) + ', ' + o.qty + ' шт, ' + esc(c ? c.name : 'втулкорез не подобран') + ', ' + esc(fmtTime(o.start)); }), 15)
                : '<p>Все задачи на втулки уже соответствуют плану.</p>') +
            (sp.skipped.length ? '<p class="atex-dp-muted">Пропущено: ' + sp.skipped.map(function(x) { return 'позиция ' + esc(x.positionId) + ' — ' + esc(x.reason); }).join('; ') + '.</p>' : '') +
            (sp.warnings.length ? '<p class="atex-dp-muted">' + sp.warnings.map(esc).join('<br>') + '</p>' : '');
        this.openModal(html, 'Записать', sp.ops.length ? function() {
            var t = { sleeveTask: s.sleeveTable };
            self.run(sp.ops.map(function(o) {
                if (o.op === 'create') return function() { return self.client.post('_m_new/' + t.sleeveTask.id + '?JSON&up=' + encodeURIComponent(o.positionId), C.sleeveCreateFields(t, o)); };
                return function() { return self.client.post('_m_save/' + encodeURIComponent(o.taskId) + '?JSON', C.sleeveUpdateFields(t, o)); };
            }), 'Задачи на втулки записаны: ' + sp.ops.length + '.');
        } : null);
    };

    return { AtexDiePlanningApp: AtexDiePlanningApp, fmtTime: fmtTime, fmtNum: fmtNum };
});
