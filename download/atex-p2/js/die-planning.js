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
        var machineTable = meta.filter(function(x) { return String(x.id) === String(t.machine.id); })[0];
        var machines = C.machinesFromRecords(r[6], t, { turretReq: extra.sreq(machineTable, 'Туррель') });
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
            sleeveReport: Array.isArray(r[11]), now: r[14], jobById: {}, cylinderNames: (r[3] || []).reduce(function(a, c) { a[c.id] = c.val; return a; }, {})
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
        Array.prototype.forEach.call(this.el.querySelectorAll('.atex-dp-tab'), function(b) { b.classList.toggle('is-active', b.getAttribute('data-tab') === self.tab); });
        this.$('atex-dp-apply').disabled = !this.plan || !this.changedItems().length;
        var body = this.$('atex-dp-body');
        if (this.tab === 'deficit') body.innerHTML = this.renderDeficit();
        else if (this.tab === 'gantt') body.innerHTML = this.renderGantt();
        else if (this.tab === 'load') body.innerHTML = this.renderLoad();
        else body.innerHTML = this.renderQueue();
        this.renderSide();
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

    // Очередь как в планировании Фазы 1 (#5340): вкладки всех станков справочника с числом заданий,
    // период дат ‹ ›, «Качество плана», дни с суммой минут, карточки наладки и заданий, справа —
    // выбранное задание. Без «Упорядочить» — записанный план (задания, записанные на станок).
    AtexDiePlanningApp.prototype.queueGrid = function() {
        var s = this.state, source = this.plan || this.currentPlan();
        var grid = C.queueGrid(source.machines, s.machines, this.ganttDays(), s.settings);
        if (!this.plan) {
            grid.columns.forEach(function(col) {
                col.days.forEach(function(d) {
                    d.items = d.items.filter(function(i) { var j = s.jobById[i.jobId]; return j && j.machineId === col.machineId; });
                    d.minutes = d.items.reduce(function(a, i) { return a + i.minutes; }, 0);
                });
            });
        }
        return grid;
    };

    AtexDiePlanningApp.prototype.renderQueue = function() {
        var s = this.state, self = this, cal = C.createCalendar(s.settings), html = [];
        var grid = this.queueGrid(), days = this.ganttDays();
        if (!grid.columns.length) return '<div class="atex-dp-empty">В справочнике «Станок высечки» нет станков.</div>';
        if (this.rangeFrom == null || days.indexOf(this.rangeFrom) < 0) this.rangeFrom = days[0];
        if (this.rangeTo == null || this.rangeTo < this.rangeFrom) this.rangeTo = days[Math.min(days.length - 1, days.indexOf(this.rangeFrom) + 4)];
        if (!this.machineTab || !grid.columns.some(function(c) { return c.machineId === self.machineTab; })) this.machineTab = grid.columns[0].machineId;
        var inRange = function(d) { return d.day >= self.rangeFrom && d.day <= self.rangeTo; };
        var dayIso = function(d) { var t = new Date((cal.dayTs(d, 0) + 3 * 3600) * 1000); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()); };
        html.push('<div class="atex-pp-filters"><div class="atex-pp-field"><label class="atex-pp-label">Дата плана</label><div class="atex-pp-date-field">' +
            '<button class="atex-pp-date-nav" type="button" data-range="-1" title="Сдвинуть диапазон на рабочий день назад">‹</button>' +
            '<input class="atex-pp-input atex-pp-date-input" type="date" data-range-from value="' + dayIso(this.rangeFrom) + '" title="С (дата плана, от)">' +
            '<span class="atex-pp-date-sep">–</span>' +
            '<input class="atex-pp-input atex-pp-date-input" type="date" data-range-to value="' + dayIso(this.rangeTo) + '" title="По (дата плана, до)">' +
            '<button class="atex-pp-date-nav" type="button" data-range="1" title="Сдвинуть диапазон на рабочий день вперёд">›</button></div></div></div>');
        html.push('<div class="atex-pp-tabs">' + grid.columns.map(function(c) {
            var n = c.days.filter(inRange).reduce(function(a, d) { return a + d.items.filter(function(i) { return !i.continuation; }).length; }, 0);
            return '<button class="atex-pp-tab' + (c.machineId === self.machineTab ? ' is-active' : '') + '" type="button" data-machine-tab="' + esc(c.machineId) + '" title="' + esc(c.name + self.machineHint(c.machineId)) + '">' +
                '<span class="atex-pp-tab-label">' + esc(c.name) + (self.state.machines.some(function(x) { return x.id === c.machineId && x.turret; }) ? ' ⟳' : '') + '</span><span class="atex-pp-tab-count">' + n + '</span></button>';
        }).join('') + '</div>');
        html.push(this.qualityLine(grid));
        if (this.plan) html.push('<p class="atex-dp-muted">План не записан: изменятся ' + this.changedItems().length + ' заданий, изменённые подсвечены. «Применить» записывает план.</p>');
        var col = grid.columns.filter(function(c) { return c.machineId === self.machineTab; })[0];
        if (!col.active) html.push('<p class="atex-dp-muted">Станок: ' + esc(col.status) + '.</p>');
        var shown = col.days.filter(inRange), seq = 0;
        if (!shown.some(function(d) { return d.items.length; })) html.push('<div class="atex-pp-queue-group"><div class="atex-dp-muted" style="padding:12px 14px">Заданий в очереди нет</div></div>');
        else shown.forEach(function(d) {
            var ts = cal.dayTs(d.day, 0), over = d.minutes > d.capacity;
            html.push('<div class="atex-pp-queue-group"><div class="atex-pp-day-date">' + WEEKDAYS[new Date((ts + 3 * 3600) * 1000).getUTCDay()].replace(/^./, function(x) { return x.toUpperCase(); }) + ', ' + esc(fmtDate(ts)) +
                '<span class="atex-pp-day-mins' + (over ? ' is-late' : '') + '"> (' + d.minutes + ' из ' + d.capacity + ' мин)</span></div>' +
                d.items.map(function(i) { if (!i.continuation) seq++; return self.jobCards(s.jobById[i.jobId], i, d.day, seq); }).join('') + '</div>');
        });
        if (this.plan) {
            if (this.plan.unplaced.length) {
                html.push('<h3 class="atex-dp-h">Не размещены (' + this.plan.unplaced.length + ')</h3><table class="atex-dp-table"><thead><tr><th>Задание</th><th>Нож, вал</th><th>Сырьё</th><th>Причина</th></tr></thead><tbody>' +
                    this.plan.unplaced.map(function(u) {
                        var j = s.jobById[u.jobId];
                        return '<tr class="is-deficit"><td>' + esc(u.jobId) + '</td><td>' + esc(j.dieNo || '—') + ' / ' + esc(j.cylinder || '—') + '</td><td>' + esc(j.material) + '</td><td>' + esc(u.reasons.join('; ')) + '</td></tr>';
                    }).join('') + '</tbody></table>');
            }
        } else {
            var free = s.jobs.filter(function(j) { return !C.isFinal(j) && !j.machineId; });
            if (free.length) html.push('<div class="atex-pp-queue-group"><div class="atex-pp-day-date">Станок не назначен<span class="atex-pp-day-mins"> (' + free.length + ' — «Упорядочить» поставит на станки)</span></div>' +
                free.map(function(j) { return self.jobCards(j, null, null, '—'); }).join('') + '</div>');
        }
        return html.join('');
    };

    // «Качество плана» — как у Фазы 1: заданий, переналадки, смены вала / ножа, блокировки, просрочки.
    AtexDiePlanningApp.prototype.qualityLine = function(grid) {
        var s = this.state, jobs = 0, cyl = 0, cylMin = 0, kn = 0, knMin = 0, late = 0, blocked = 0, warned = 0;
        grid.columns.forEach(function(c) {
            c.days.forEach(function(d) {
                d.items.forEach(function(i) {
                    if (i.continuation) return;
                    jobs++;
                    if (i.late) late++;
                    if (i.setupKind === 'cylinder') { cyl++; cylMin += i.setup; } else if (i.setupKind === 'knife') { kn++; knMin += i.setup; }
                    var f = s.flags[i.jobId] || { blocks: [], warnings: [] };
                    if (f.blocks.length) blocked++;
                    if (f.warnings.length) warned++;
                });
            });
        });
        var deficit = s.groups.filter(function(g) { return g.deficit > 0; }).length;
        var unplaced = this.plan ? this.plan.unplaced.length : s.jobs.filter(function(j) { return !C.isFinal(j) && !j.machineId; }).length;
        return '<div class="atex-pp-quality atex-dp-quality" title="За весь горизонт плана (' + s.settings.horizonDays + ' раб. дн.), по всем станкам.">' +
            '<span style="font-weight:600;">Качество плана</span><span style="opacity:.75;">всего заданий: ' + jobs + '</span>' +
            '<span>переналадки: ' + (cyl + kn) + ' (' + (cylMin + knMin) + ' мин)</span>' +
            '<span style="opacity:.85;">смены вала: ' + cyl + ' (' + cylMin + ' мин)</span><span style="opacity:.85;">смены ножа: ' + kn + ' (' + knMin + ' мин)</span>' +
            (late ? '<span class="is-late">просрочек: ' + late + '</span>' : '<span style="opacity:.75;">просрочек: 0</span>') +
            (unplaced ? '<span class="is-late">без станка: ' + unplaced + '</span>' : '') +
            (blocked ? '<span class="is-late">с блокировками: ' + blocked + '</span>' : '') +
            (warned ? '<span style="opacity:.85;">с предупреждениями: ' + warned + '</span>' : '') +
            (deficit ? '<span class="is-late">форматов с дефицитом МР: ' + deficit + '</span>' : '') + '</div>';
    };

    // Карточки задания в дне — как у Фазы 1: перед заданием — карточка наладки (🔩 вал / 🔪 нож),
    // затем «№ n ⏱ 08:00 – 09:30 · N мин · заказ · нож — вал · метраж». Продолжение с прошлого дня — без наладки.
    AtexDiePlanningApp.prototype.jobCards = function(j, it, day, seq) {
        if (!j) return '';
        var s = this.state, cal = C.createCalendar(s.settings), out = '';
        var clock = function(min) { return fmtClock(s.settings.dayStartMin + min); };
        var f = s.flags[j.id] || { blocks: [], warnings: [] };
        if (it && it.setup > 0 && !it.continuation) {
            var prevCyl = it.setupKind === 'cylinder' ? 'Смена вала → ' + (j.cylinder || '—') : 'Смена ножа → ' + (j.dieNo || '—');
            out += '<div class="atex-pp-cut is-setup"><div class="atex-pp-cut-info"><div class="atex-pp-cut-time">⏱ ' + clock(it.from) + ' – ' + clock(it.from + it.setup) + ' · ' + it.setup + ' мин</div>' +
                '<span class="atex-pp-cut-name">' + (it.setupKind === 'cylinder' ? '🔩 ' : '🔪 ') + esc(prevCyl) + '</span></div></div>';
        }
        var changed = this.plan && it && !it.continuation && (String(it.start) !== String(j.start) || String(this.planMachineOf(j.id)) !== String(j.machineId || ''));
        var cls = 'atex-pp-cut' + (it && it.fixed ? ' is-fixed' : '') + (f.blocks.length ? ' is-unreserved' : '') + (this.selected === j.id ? ' is-active' : '') + (changed ? ' atex-dp-changed' : '');
        var runFrom = it ? it.from + it.setup : 0;
        var time = it ? '⏱ ' + clock(runFrom) + ' – ' + clock(runFrom + it.run) + ' · ' + it.run + ' мин' : '⏱ ' + fmtNum(j.duration) + ' мин';
        out += '<div class="' + cls + '" data-job-id="' + esc(j.id) + '"><div class="atex-pp-cut-info">' +
            '<a class="atex-pp-cut-seq" href="/' + esc(this.db) + '/edit_obj/' + esc(j.id) + '" target="_blank" rel="noopener" title="Открыть карточку задания (id ' + esc(j.id) + ')">№ ' + esc(seq) + '</a>' +
            '<div class="atex-pp-cut-time">' + time + '</div>' +
            '<span class="atex-pp-cut-name">' + esc(j.orderNo ? 'заказ ' + j.orderNo : 'поз. ' + j.positionId) + '</span>' +
            '<span class="atex-pp-cut-winding">нож ' + esc(j.dieNo || '—') + '</span><span class="atex-pp-cut-dash">—</span>' +
            '<span class="atex-pp-cut-runs">вал ' + esc(j.cylinder || '—') + ' · ' + fmtNum(j.footage) + ' м · ' + esc(j.material || '') + '</span></div>' +
            '<div class="atex-dp-cut-line">' + (j.pullsPlan ? 'съёмов ' + fmtNum(j.pullsPlan) + ' · ' : '') + (j.rolls ? fmtNum(j.rolls) + ' рул. · ' : '') +
            'формат ' + fmtNum(j.usedFormat || j.minFormat || 0) + ' мм' + (j.due > 0 ? ' · срок ' + esc(j.dueText) : '') + (j.masterRoll ? ' · МР ' + esc(j.masterRoll) : '') + '</div>' +
            ((it && it.late) || /работ/i.test(j.status) || f.blocks.length || f.warnings.length ? '<div class="atex-dp-cut-line">' + (it && it.late ? '<span class="atex-dp-badge is-bad">просрочка</span> ' : '') +
                (/работ/i.test(j.status) ? '<span class="atex-dp-badge is-info">в работе</span> ' : '') + this.badges(j) + '</div>' : '') +
            (it && it.continuation ? '<div class="atex-dp-cut-line atex-dp-muted">ℹ продолжение задания, начатого ' + esc(fmtDate(j.start || it.start)) + '</div>' : '') +
            '</div>';
        return out;
    };

    // Правая панель — выбранное задание (как «Связанные позиции» у Фазы 1).
    AtexDiePlanningApp.prototype.renderSide = function() {
        var s = this.state, el = this.$('atex-dp-side');
        if (!el) return;
        var j = this.selected && s.jobById[this.selected];
        if (!j) { el.innerHTML = '<p class="atex-dp-muted" style="padding:20px 14px">Выберите задание в очереди, чтобы увидеть позицию, нож, вал и мастер-рулон.</p>'; return; }
        var di = s.dieInfo[j.dieId] || {}, f = s.flags[j.id] || { blocks: [], warnings: [] };
        var it = null, pm = (this.plan || this.currentPlan()).machines;
        Object.keys(pm).forEach(function(mid) { pm[mid].items.forEach(function(i) { if (i.jobId === j.id) it = i; }); });
        var after = di.mileage + C.num(j.footage), res = di.resource;
        var row = function(k, v) { return '<tr><th>' + esc(k) + '</th><td>' + v + '</td></tr>'; };
        var m = s.machines.filter(function(x) { return x.id === (it ? it.machineId : j.machineId); })[0];
        el.innerHTML = '<h3 class="atex-dp-h" style="margin-top:0">Задание ' + esc(j.id) + (j.orderNo ? ' · заказ ' + esc(j.orderNo) : '') + '</h3>' +
            '<table class="atex-dp-table atex-dp-side-table">' +
            row('Станок', esc(m ? m.name : '—')) + row('План-старт', esc(fmtTime(it ? it.start : j.start))) +
            row('Наладка', it ? esc(it.setup + ' мин' + (it.setupKind !== 'none' ? ' · ' + SETUP_LABEL[it.setupKind] : '')) : esc(fmtNum(j.setup) + ' мин')) +
            row('Вырубка', esc(it ? it.run + ' мин' : fmtNum(j.duration) + ' мин') + ' · ' + esc(fmtNum(j.footage)) + ' м') +
            row('Срок', j.due > 0 ? esc(j.dueText) + (it && it.late ? ' <span class="atex-dp-badge is-bad">просрочка</span>' : '') : '—') +
            row('Позиция', esc(j.positionId) + (j.rolls ? ' · ' + esc(fmtNum(j.rolls)) + ' рул.' : '')) +
            row('Сырьё', esc(j.material || '—')) + row('Формат', esc(fmtNum(j.usedFormat || j.minFormat || 0)) + ' мм') +
            row('Нож', esc(j.dieNo || '—') + (di.state ? ' · ' + esc(di.state) : '') + (j.streams ? ' · ' + esc(j.streams) + ' руч.' : '')) +
            row('Пробег ножа', esc(fmtNum(di.mileage || 0)) + ' → ' + esc(fmtNum(after)) + ' м' + (res ? ' из ' + esc(fmtNum(res)) : '')) +
            row('Вал', esc(j.cylinder || '—')) + row('Втулка', esc(j.sleeve || '—') + (j.sleeveWidth ? ' · ' + esc(fmtNum(j.sleeveWidth)) + ' мм' : '')) +
            row('Мастер-рулон', esc(j.masterRoll || '—')) + row('Статус', esc(j.status || '—')) + '</table>' +
            (f.blocks.length || f.warnings.length ? '<div style="margin-top:8px">' + this.badges(j) + '</div>' : '') +
            '<p class="atex-dp-muted">Пробег пишет только пульт высечки движениями; здесь — прогноз.</p>';
    };

    // Подсказка к станку: допустимые валы и стоп-лист.
    AtexDiePlanningApp.prototype.machineHint = function(id) {
        var m = this.state.machines.filter(function(x) { return x.id === id; })[0];
        if (!m) return '';
        var names = this.state.cylinderNames || {};
        var cyl = m.cylinders.length ? ' · валы ' + m.cylinders.map(function(c) { return names[c] || c; }).join(', ') : ' · любой вал';
        return esc(cyl) + (m.stopMaterials.length ? ' · стоп-лист: ' + m.stopMaterials.length : '') + (m.turret ? ' · туррель: втулка ≥ 2× диаметра' : '');
    };

    AtexDiePlanningApp.prototype.planMachineOf = function(jobId) {
        var pm = this.plan ? this.plan.machines : {}, found = '';
        Object.keys(pm).forEach(function(mid) { pm[mid].items.forEach(function(i) { if (i.jobId === jobId) found = mid; }); });
        return found;
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
        var mt = e.target.closest('[data-machine-tab]');
        if (mt && this.el.contains(mt)) { this.machineTab = mt.getAttribute('data-machine-tab'); this.render(); return; }
        var nav = e.target.closest('[data-range]');
        if (nav && this.el.contains(nav)) { this.shiftRange(parseInt(nav.getAttribute('data-range'), 10)); return; }
        var card = e.target.closest('[data-job-id]');
        if (card && this.el.contains(card) && !e.target.closest('a')) { this.selected = card.getAttribute('data-job-id'); this.render(); return; }
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
        if (e.target.hasAttribute && e.target.hasAttribute('data-gantt-day')) { this.ganttDay = parseInt(e.target.value, 10); this.render(); return; }
        if (e.target.hasAttribute && (e.target.hasAttribute('data-range-from') || e.target.hasAttribute('data-range-to')) && e.target.value) {
            var p = e.target.value.split('-'), cal = C.createCalendar(this.state.settings);
            var day = cal.dayOf(Date.UTC(+p[0], +p[1] - 1, +p[2], 12) / 1000);
            if (e.target.hasAttribute('data-range-from')) { this.rangeFrom = day; if (this.rangeTo < day) this.rangeTo = day; }
            else { this.rangeTo = day; if (this.rangeFrom > day) this.rangeFrom = day; }
            this.render();
        }
    };

    // Сдвиг периода дат на рабочий день (‹ ›), длина периода сохраняется.
    AtexDiePlanningApp.prototype.shiftRange = function(dir) {
        var cal = C.createCalendar(this.state.settings), step = function(d) { do { d += dir; } while (!cal.isWork(d)); return d; };
        this.rangeFrom = step(this.rangeFrom); this.rangeTo = step(this.rangeTo);
        this.render();
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
