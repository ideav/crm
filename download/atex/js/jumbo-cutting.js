// Рабочее место atex «Раскрой джамбо» (роль Диспетчер; ideav/crm#5315, шаг 6 Фазы 2).
//
// Очередь большого слиттера и подбор карты раскроя партии джамбо:
//   - потребность в форматах — отчёт die_tasks (открытые задания высечки без мастер-рулона),
//     покрытие складом мастер-рулонов и очередью резки, дефицит и «не успевает»;
//   - партии джамбо к резке (остаток > 0, не стоят в открытом задании);
//   - «Подобрать» — варианты карты по фактической ширине партии (минимальный отход /
//     закрыть дефицит / компромисс), полосы под дефицит своего сырья и ходовые ширины в запас;
//     «Задать вручную» — свои полосы, та же проверка;
//   - «Создать задание» — запись «Задания первичной резки» с полосами раскроя после проверки
//     жёсткого правила: сумма полос + кромка = ширина партии (checkCutMap).
// Ядро — jumbo-cut-map.js (чистые функции, покрыты experiments/atex-p2-5315-jumbo-cut-map.test.js).
// Таблицы и реквизиты резолвятся по именам из /metadata (label-production.js), id в коде нет.

(function(root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') {
        window.AtexJumboCutting = api;
        var start = function() {
            var el = document.getElementById('atex-jc-app');
            if (el && !el.__atexJc) el.__atexJc = new api.AtexJumboCutting(el).start();
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
        else start();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
    'use strict';

    var LP = (root && root.AtexLabelProduction) || (typeof require === 'function' ? require('./label-production.js') : null);
    var JM = (root && root.AtexJumboCutMap) || (typeof require === 'function' ? require('./jumbo-cut-map.js') : null);
    var lp = LP ? LP.core : null;
    var jc = JM ? JM.core : null;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // Unix ↔ значение <input type="datetime-local"> по Москве.
    function toInput(unix) {
        return new Date((unix + 3 * 3600) * 1000).toISOString().slice(0, 16);
    }
    function fromInput(v) {
        var t = Date.parse(String(v || '') + ':00Z');
        return isFinite(t) ? Math.floor(t / 1000) - 3 * 3600 : NaN;
    }

    // Назначение полос ручной карты: формат в диапазоне дефицита своего сырья — «под дефицит».
    function manualVariant(batch, strips, demand, minEdge) {
        var W = batch.geometry.width;
        var sum = strips.reduce(function(a, s) { return a + s.format * s.count; }, 0);
        var edge = Math.round((W - sum) * 10) / 10;
        var check = jc.checkCutMap(W, strips, edge, minEdge);
        if (!check.ok) return { ok: false, error: check.error };
        var left = {};
        demand.forEach(function(g) { left[g.key] = g.deficit; });
        var covered = {}, coveredTotal = 0, stockMeters = 0;
        var L = batch.geometry.length;
        var out = strips.map(function(s) {
            var g = demand.filter(function(x) {
                return String(x.materialId) === String(batch.materialId) && s.format >= x.min && s.format <= x.max && left[x.key] > 0;
            })[0];
            var meters = s.count * L;
            if (!g) { stockMeters += meters; return { format: s.format, count: s.count, purpose: jc.PURPOSE.STOCK }; }
            var c = Math.min(meters, left[g.key]);
            left[g.key] -= c;
            covered[g.key] = (covered[g.key] || 0) + c;
            coveredTotal += c;
            stockMeters += meters - c;
            return { format: s.format, count: s.count, purpose: jc.PURPOSE.DEFICIT, groupKey: g.key };
        });
        return { ok: true, variant: { kind: 'manual', kinds: ['manual'], label: 'вручную', strips: out, edge: edge,
            edgePct: Math.round(edge / W * 1000) / 10, covered: covered, coveredTotal: coveredTotal, stockMeters: stockMeters, length: L, width: W } };
    }

    function AtexJumboCutting(rootEl) {
        this.root = rootEl;
        this.client = new JM.Client(rootEl.getAttribute('data-db') || '', rootEl.getAttribute('data-xsrf') || '');
        this.state = null;
        this.groups = [];
        this.selectedBatchId = '';
        this.variants = [];
        this.picked = -1;
        this.busy = false;
    }

    AtexJumboCutting.prototype.$ = function(id) { return document.getElementById(id); };

    AtexJumboCutting.prototype.message = function(text, kind) {
        var el = this.$('atex-jc-message');
        if (!el) return;
        el.hidden = !text;
        el.className = 'atex-jb-message' + (kind ? ' is-' + kind : '');
        el.textContent = text || '';
    };

    AtexJumboCutting.prototype.start = function() {
        var self = this;
        this.root.addEventListener('click', function(e) {
            var b = e.target.closest('[data-batch-id]');
            if (b) return self.selectBatch(b.getAttribute('data-batch-id'));
            var v = e.target.closest('[data-variant]');
            if (v) { self.picked = Number(v.getAttribute('data-variant')); return self.renderPicker(); }
            var a = e.target.closest('[data-act]');
            if (!a) return;
            var act = a.getAttribute('data-act');
            if (act === 'pick') self.pick();
            else if (act === 'manual') self.manual();
            else if (act === 'create') self.askCreate();
            else if (act === 'delete') self.askDelete(a.getAttribute('data-job-id'));
            else if (act === 'refresh') { self.message(''); self.reload(); }
        });
        this.reload();
        return this;
    };

    AtexJumboCutting.prototype.reload = function() {
        var self = this;
        return JM.loadState(this.client, lp, { demand: true }).then(function(state) {
            self.state = state;
            var s = state.settings;
            var groups = jc.demandGroups(state.dieRows, { tolerance: s.tolerance });
            self.skipped = jc.demandGroups.lastSkipped || [];
            var stock = jc.stockSupply(state.rolls);
            var queue = jc.queueSupply(state.openJobs, s.rollLength);
            self.groups = jc.coverDemand(groups, stock, queue);
            var warn = state.missing.concat(s.errors);
            // Пусто — сообщение последнего действия («записано», «не записано») остаётся.
            if (warn.length) self.message('Проверьте настройку и схему: ' + warn.join('; '), 'warn');
            if (self.selectedBatchId && !state.batchesToCut.some(function(b) { return b.id === self.selectedBatchId; })) {
                self.selectedBatchId = '';
                self.variants = [];
            }
            self.render();
        }).catch(function(err) {
            console.error('[jumbo-cutting] ❌', err);
            self.message('Рабочее место не загрузилось: ' + err.message, 'error');
        });
    };

    AtexJumboCutting.prototype.render = function() {
        this.renderKpi();
        this.renderQueue();
        this.renderDemand();
        this.renderBatches();
        this.renderSettings();
        this.renderPicker();
    };

    AtexJumboCutting.prototype.renderKpi = function() {
        var g = this.groups;
        var def = g.filter(function(x) { return x.deficit > 0; });
        var late = g.filter(function(x) { return x.late; });
        var deficitM = def.reduce(function(a, x) { return a + x.deficit; }, 0);
        var tile = function(v, l, cls) {
            return '<div class="atex-jb-kpi-tile' + (cls ? ' ' + cls : '') + '"><div class="atex-jb-kpi-value">' + esc(v) + '</div><div class="atex-jb-kpi-label">' + esc(l) + '</div></div>';
        };
        this.$('atex-jc-kpi').innerHTML =
            tile(this.state.openJobs.length, 'заданий в очереди большого слиттера') +
            tile(def.length, 'форматов в дефиците', def.length ? 'is-bad' : 'is-ok') +
            tile(jc.fmtNum(deficitM) + ' м', 'дефицит, метров') +
            tile(late.length, 'не успевают к высечке', late.length ? 'is-warn' : '') +
            tile(this.state.batchesToCut.length, 'партий джамбо к резке');
    };

    AtexJumboCutting.prototype.renderQueue = function() {
        var jobs = this.state.openJobs;
        var el = this.$('atex-jc-queue');
        if (!jobs.length) { el.innerHTML = '<div class="atex-jb-empty">Очередь пуста: открытых заданий первичной резки нет.</div>'; return; }
        el.innerHTML = '<table class="atex-jb-table"><thead><tr><th>План-старт</th><th>Партия</th><th>Сырьё</th><th class="num">Ширина факт</th><th>Карта раскроя</th>' +
            '<th class="num">Кромка</th><th>Рулоны готовы</th><th class="num">Принято</th><th>Статус</th><th></th></tr></thead><tbody>' +
            jobs.map(function(j) {
                var b = j.batch || {};
                var W = b.geometry ? b.geometry.width : 0;
                var canDel = j.status === jc.JOB_STATUS.PLANNED && j.created === 0;
                return '<tr><td>' + esc(jc.fmtTime(j.start)) + '</td><td>' + esc(b.no || '—') + '</td><td>' + esc(b.material || '') +
                    '</td><td class="num">' + esc(W ? W + ' мм' : '—') + '</td><td>' + esc(jc.mapLabel(j.strips) || '— полос нет') +
                    '</td><td class="num">' + esc(j.edge + ' мм' + (W ? ' · ' + (Math.round(j.edge / W * 1000) / 10) + ' %' : '')) +
                    '</td><td>' + esc(jc.fmtTime(j.start + j.minutes * 60)) + '</td><td class="num">' + j.created + ' / ' + j.progress.total +
                    '</td><td><span class="atex-jb-badge' + (j.status === jc.JOB_STATUS.RUNNING ? ' is-info' : '') + '">' + esc(j.status) + '</span></td><td>' +
                    (canDel ? '<button class="atex-jb-btn atex-jb-btn-sm" type="button" data-act="delete" data-job-id="' + esc(j.id) + '">Снять</button>' : '') + '</td></tr>';
            }).join('') + '</tbody></table>';
    };

    AtexJumboCutting.prototype.renderDemand = function() {
        var el = this.$('atex-jc-demand');
        var html = '';
        if (!this.groups.length) html = '<div class="atex-jb-empty">Потребности нет: у открытых заданий высечки мастер-рулоны назначены или заданий нет.</div>';
        else {
            html = '<table class="atex-jb-table"><thead><tr><th>Сырьё</th><th>Формат, мм</th><th class="num">Нужно, м</th><th class="num">Склад</th>' +
                '<th class="num">Очередь резки</th><th class="num">Дефицит</th><th>Нужен к</th><th>Резка даст</th><th></th></tr></thead><tbody>' +
                this.groups.map(function(g) {
                    var badge = g.deficit > 0 ? '<span class="atex-jb-badge is-bad">нужен джамбо</span>' :
                        (g.late ? '<span class="atex-jb-badge is-warn">не успевает</span>' : '<span class="atex-jb-badge is-ok">покрыто</span>');
                    return '<tr class="' + (g.deficit > 0 ? 'is-deficit' : (g.late ? 'is-late' : '')) + '" title="Задания высечки: ' + esc(g.jobs.join(', ')) + '"><td>' + esc(g.material) +
                        '</td><td>' + esc(g.min + '–' + g.max) + ' <span class="atex-jb-muted">опт ' + esc(g.opt) + '</span></td><td class="num">' + jc.fmtNum(g.meters) +
                        '</td><td class="num">' + jc.fmtNum(g.stock) + '</td><td class="num">' + jc.fmtNum(g.planned) + '</td><td class="num"><b>' + jc.fmtNum(g.deficit) +
                        '</b></td><td>' + esc(jc.fmtTime(g.due)) + '</td><td>' + esc(g.planned ? jc.fmtTime(g.readyAt) : (g.deficit > 0 ? 'джамбо не назначено' : 'со склада')) +
                        '</td><td>' + badge + '</td></tr>';
                }).join('') + '</tbody></table>';
        }
        if (this.skipped && this.skipped.length) {
            html += '<div class="atex-jb-message is-warn">Не вошли в потребность: ' + esc(this.skipped.map(function(s) { return 'задание ' + s.jobId + ' — ' + s.reason; }).join('; ')) + '</div>';
        }
        el.innerHTML = html;
    };

    AtexJumboCutting.prototype.renderBatches = function() {
        var el = this.$('atex-jc-batches');
        var list = this.state.batchesToCut;
        var sel = this.selectedBatchId;
        if (!list.length) { el.innerHTML = '<div class="atex-jb-empty">Партий джамбо с остатком нет.</div>'; return; }
        el.innerHTML = '<table class="atex-jb-table"><thead><tr><th>Партия</th><th>Сырьё</th><th class="num">Ширина</th><th class="num">Остаток</th></tr></thead><tbody>' +
            list.map(function(b) {
                var g = b.geometry;
                var off = g.nominalWidth && g.width !== g.nominalWidth;
                return '<tr class="atex-jb-pick' + (b.id === sel ? ' is-picked' : '') + '" data-batch-id="' + esc(b.id) + '"><td><b>' + esc(b.no) + '</b></td><td>' + esc(b.material) +
                    '</td><td class="num"' + (off ? ' title="по справочнику ' + esc(g.nominalWidth) + ' мм"' : '') + '>' + esc(g.width || '—') + (off ? ' *' : '') +
                    '</td><td class="num">' + jc.fmtNum(g.rest) + ' м</td></tr>';
            }).join('') + '</tbody></table>';
    };

    AtexJumboCutting.prototype.renderSettings = function() {
        var s = this.state.settings;
        var K = jc.SETTINGS;
        var row = function(k, v) { return '<tr><td><code>' + esc(k) + '</code></td><td class="num">' + esc(v) + '</td></tr>'; };
        this.$('atex-jc-settings').innerHTML = '<table class="atex-jb-table">' +
            row(K.RUNNING_WIDTHS.key, s.runningWidths.length ? s.runningWidths.map(function(r) { return r.min === r.max ? r.min : r.min + '–' + r.max; }).join('; ') : 'не заданы') +
            row(K.FORMAT_TOLERANCE.key, '+' + s.tolerance + ' мм к мин. формату') +
            row(K.MIN_EDGE.key, s.minEdge + ' мм') +
            row(K.ROLL_LENGTH.key, jc.fmtNum(s.rollLength) + ' м') +
            row(K.JOB_MINUTES.key, s.jobMinutes + ' мин') + '</table>';
    };

    AtexJumboCutting.prototype.currentBatch = function() {
        var id = this.selectedBatchId;
        return this.state ? this.state.batchesToCut.filter(function(b) { return b.id === id; })[0] || null : null;
    };

    AtexJumboCutting.prototype.selectBatch = function(id) {
        this.selectedBatchId = String(id);
        this.variants = [];
        this.picked = -1;
        this.renderBatches();
        this.pick();
    };

    AtexJumboCutting.prototype.demandForPicker = function() {
        return this.groups.filter(function(g) { return g.deficit > 0; }).map(function(g) {
            return { key: g.key, materialId: g.materialId, min: g.min, max: g.max, opt: g.opt, deficit: g.deficit, due: g.due };
        });
    };

    AtexJumboCutting.prototype.pick = function() {
        var b = this.currentBatch();
        if (!b) return;
        var s = this.state.settings;
        var res = jc.cutMapVariants({ width: b.geometry.width, length: b.geometry.length, materialId: b.materialId },
            this.demandForPicker(), s.runningWidths, { minEdge: s.minEdge });
        this.variants = res.variants;
        this.pickReason = res.reason;
        var balance = -1;
        res.variants.forEach(function(v, i) { if (balance < 0 && v.kinds.indexOf('balance') !== -1) balance = i; });
        this.picked = res.variants.length ? Math.max(0, balance) : -1;
        this.renderPicker();
    };

    AtexJumboCutting.prototype.manual = function() {
        var b = this.currentBatch();
        if (!b) return;
        var input = this.$('atex-jc-manual');
        var parsed = jc.parseStripsText(input ? input.value : '');
        if (!parsed.ok) { this.message(parsed.error, 'error'); return; }
        var res = manualVariant(b, parsed.strips, this.demandForPicker(), this.state.settings.minEdge);
        if (!res.ok) { this.message('Карта не принята: ' + res.error, 'error'); return; }
        this.message('');
        this.variants = this.variants.filter(function(v) { return v.kind !== 'manual'; }).concat([res.variant]);
        this.picked = this.variants.length - 1;
        this.renderPicker();
    };

    // Срок готовности новой резки, если поставить её в конец очереди.
    AtexJumboCutting.prototype.defaultStart = function(now) {
        var end = now;
        this.state.openJobs.forEach(function(j) { end = Math.max(end, j.start + j.minutes * 60); });
        return Math.ceil(end / 300) * 300;
    };

    function webHtml(v, W) {
        var colors = {};
        var palette = ['#134174', '#1d5596', '#2e6db3', '#4a86c8', '#0f6e5b', '#6a4c93'];
        var n = 0;
        var strips = [];
        v.strips.forEach(function(s) {
            var key = s.format + s.purpose;
            if (!colors[key]) colors[key] = palette[n++ % palette.length];
            for (var i = 0; i < s.count; i++) strips.push('<div class="atex-jb-web-strip" style="flex:' + s.format + ' 0 0;background:' + colors[key] + '">' + esc(s.format) + '<small>' + esc(s.purpose) + '</small></div>');
        });
        if (v.edge > 0) strips.push('<div class="atex-jb-web-strip atex-jb-web-edge" style="flex:' + v.edge + ' 0 0">кромка<small>' + esc(v.edge) + '</small></div>');
        return '<div class="atex-jb-web" title="ширина партии ' + esc(W) + ' мм">' + strips.join('') + '</div>';
    }
    AtexJumboCutting.webHtml = webHtml;

    AtexJumboCutting.prototype.renderPicker = function() {
        var el = this.$('atex-jc-picker');
        var b = this.currentBatch();
        if (!b) { el.innerHTML = '<div class="atex-jb-empty">Выберите партию джамбо справа — здесь появятся варианты карты раскроя.</div>'; return; }
        var g = b.geometry;
        var deficitAll = this.groups.filter(function(x) { return x.deficit > 0 && x.materialId === b.materialId; });
        var deficitM = deficitAll.reduce(function(a, x) { return a + x.deficit; }, 0);
        var html = '<h2 class="atex-jb-panel-title">Партия ' + esc(b.no) + ' · ' + esc(b.material) + ' · ' + esc(g.width) + ' мм × ' + jc.fmtNum(g.length) + ' м</h2>';
        if (g.nominalWidth && g.nominalWidth !== g.width) html += '<p class="atex-jb-muted">Ширина по справочнику сырья ' + esc(g.nominalWidth) + ' мм, раскрой — по факту партии.</p>';
        html += '<p class="atex-jb-muted">Дефицит этого сырья: ' + (deficitAll.length ? deficitAll.map(function(x) { return x.min + '–' + x.max + ' мм — ' + jc.fmtNum(x.deficit) + ' м'; }).join('; ') : 'нет') + '</p>';
        html += '<div class="atex-jb-toolbar"><button class="atex-jb-btn" type="button" data-act="pick">Подобрать заново</button>' +
            '<input id="atex-jc-manual" class="atex-jb-input" type="text" placeholder="вручную: 270 × 3 + 325 × 2" value="' + esc(this.manualText || '') + '">' +
            '<button class="atex-jb-btn" type="button" data-act="manual">Проверить полосы</button></div>';
        if (!this.variants.length) {
            html += '<div class="atex-jb-empty">' + esc(this.pickReason ? 'Подбор пуст: ' + this.pickReason : 'Нажмите «Подобрать».') + '</div>';
            el.innerHTML = html;
            return;
        }
        var self = this;
        html += '<table class="atex-jb-table"><thead><tr><th>Вариант</th><th>Полосы</th><th class="num">Кромка</th><th class="num">Закрывает дефицит</th><th class="num">В запас</th><th class="num">Мастер-рулонов</th></tr></thead><tbody>' +
            this.variants.map(function(v, i) {
                var rolls = jc.releasePlan(v.strips, jc.pullLengths(v.length, self.state.settings.rollLength)).length;
                return '<tr class="atex-jb-pick' + (i === self.picked ? ' is-picked' : '') + '" data-variant="' + i + '"><td><b>' + esc(v.label) + '</b></td><td>' + esc(jc.mapLabel(v.strips)) +
                    '</td><td class="num">' + esc(v.edge + ' мм · ' + v.edgePct + ' %') + '</td><td class="num">' + jc.fmtNum(v.coveredTotal) + ' из ' + jc.fmtNum(deficitM) +
                    ' м</td><td class="num">' + jc.fmtNum(v.stockMeters) + ' м</td><td class="num">' + rolls + '</td></tr>';
            }).join('') + '</tbody></table>';
        var v = this.variants[this.picked];
        if (v) {
            html += webHtml(v, g.width);
            html += '<table class="atex-jb-table"><thead><tr><th>Формат</th><th class="num">Полос</th><th class="num">Метров</th><th>Назначение</th></tr></thead><tbody>' +
                v.strips.map(function(s) {
                    var grp = s.groupKey ? self.groups.filter(function(x) { return x.key === s.groupKey; })[0] : null;
                    return '<tr><td><b>' + esc(s.format) + ' мм</b></td><td class="num">' + s.count + '</td><td class="num">' + jc.fmtNum(s.count * v.length) + '</td><td>' + esc(s.purpose) +
                        (grp ? ' · заказы на ' + esc(grp.min + '–' + grp.max) + ' мм, задания ' + esc(grp.jobs.join(', ')) + ', нужен к ' + esc(jc.fmtTime(grp.due)) : '') + '</td></tr>';
                }).join('') +
                '<tr><td>кромка</td><td class="num">—</td><td class="num">—</td><td>' + esc(v.edge) + ' мм в отход (' + esc(v.edgePct) + ' %)</td></tr>' +
                '<tr class="is-total"><td>Итого</td><td class="num">' + v.strips.reduce(function(a, s) { return a + s.count; }, 0) + '</td><td class="num">' +
                jc.fmtNum(v.strips.reduce(function(a, s) { return a + s.count * v.length; }, 0)) + '</td><td>' +
                esc((g.width - v.edge) + ' + ' + v.edge + ' = ' + g.width + ' мм') + '</td></tr></tbody></table>';
            html += '<div class="atex-jb-toolbar"><button class="atex-jb-btn atex-jb-btn-primary" type="button" data-act="create">Создать задание первичной резки</button></div>';
        }
        el.innerHTML = html;
        var input = this.$('atex-jc-manual');
        if (input) input.addEventListener('input', function() { self.manualText = input.value; });
    };

    // Модалка рабочего места (alert/confirm запрещены гайдом); html — содержимое, → Promise<bool>.
    AtexJumboCutting.prototype.modal = function(html) {
        var modal = this.$('atex-jc-modal');
        var ok = this.$('atex-jc-modal-ok');
        var cancel = this.$('atex-jc-modal-cancel');
        this.$('atex-jc-modal-text').innerHTML = html;
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

    AtexJumboCutting.prototype.askCreate = function() {
        var self = this;
        var b = this.currentBatch();
        var v = this.variants[this.picked];
        if (!b || !v || this.busy) return;
        var check = jc.checkCutMap(b.geometry.width, v.strips, v.edge, this.state.settings.minEdge);
        if (!check.ok) { this.message('Карта не принята: ' + check.error, 'error'); return; }
        this.client.serverNow().then(function(now) {
            var start = self.defaultStart(now);
            var minutes = self.state.settings.jobMinutes;
            var late = self.groups.filter(function(g) { return v.covered[g.key] > 0 && g.due && start + minutes * 60 > g.due; });
            return self.modal('<p>Партия <b>' + esc(b.no) + '</b>: ' + esc(jc.mapLabel(v.strips)) + ', кромка ' + esc(v.edge) + ' мм.</p>' +
                '<label class="atex-jb-field">План-старт (МСК) <input id="atex-jc-start" class="atex-jb-input" type="datetime-local" value="' + esc(toInput(start)) + '"></label>' +
                '<p class="atex-jb-muted">Длительность ' + esc(minutes) + ' мин. Мастер-рулонов на выходе: ' +
                jc.releasePlan(v.strips, jc.pullLengths(v.length, self.state.settings.rollLength)).length + '.</p>' +
                (late.length ? '<p class="atex-jb-message is-warn">Не успеет к высечке: ' + esc(late.map(function(g) { return g.min + '–' + g.max + ' мм нужен к ' + jc.fmtTime(g.due); }).join('; ')) + '</p>' : '')
            ).then(function(yes) {
                if (!yes) return;
                var t = fromInput((self.$('atex-jc-start') || {}).value);
                return self.create(b, v, isFinite(t) ? t : start, minutes);
            });
        }).catch(function(err) { self.message('Не записано: ' + err.message, 'error'); });
    };

    // Задание, затем полосы. Если полоса не записалась — задание удаляется: карта без полос
    // или с частью полос нарушила бы правило «сумма полос + кромка = ширина».
    AtexJumboCutting.prototype.create = function(b, v, start, minutes) {
        var self = this;
        var t = this.state.tables;
        this.busy = true;
        var jobId = '';
        return this.client.post('_m_new/' + t.jumboJob.id + '?JSON&up=1', jc.jobFields(t, { start: start, batchId: b.id, minutes: minutes, edge: v.edge }))
            .then(function(res) {
                jobId = String((res && (res.id || res.obj)) || '');
                if (!jobId) throw new Error('сервер не вернул id задания');
                var chain = Promise.resolve();
                v.strips.forEach(function(s) {
                    chain = chain.then(function() {
                        var p = {};
                        p['t' + t.jumboStrip.id] = String(s.format);
                        if (t.jumboStrip.reqs.count) p['t' + t.jumboStrip.reqs.count] = String(s.count);
                        if (t.jumboStrip.reqs.purpose) p['t' + t.jumboStrip.reqs.purpose] = s.purpose;
                        return self.client.post('_m_new/' + t.jumboStrip.id + '?JSON&up=' + encodeURIComponent(jobId), p);
                    });
                });
                return chain;
            }).then(function() {
                self.message('Задание первичной резки записано: партия ' + b.no + ', ' + jc.mapLabel(v.strips) + '.', 'ok');
                self.selectedBatchId = '';
                self.variants = [];
                return self.reload();
            }).catch(function(err) {
                console.error('[jumbo-cutting] ❌ запись задания', err);
                var undo = jobId ? self.client.post('_m_del/' + encodeURIComponent(jobId) + '?JSON', {}).catch(function() {}) : Promise.resolve();
                return undo.then(function() {
                    self.message('Задание не записано: ' + err.message + (jobId ? ' (частично записанное задание удалено)' : ''), 'error');
                    return self.reload();
                });
            }).then(function() { self.busy = false; });
    };

    AtexJumboCutting.prototype.askDelete = function(jobId) {
        var self = this;
        var j = this.state.openJobs.filter(function(x) { return x.id === jobId; })[0];
        if (!j || this.busy) return;
        if (j.created > 0 || j.status !== jc.JOB_STATUS.PLANNED) { this.message('Задание уже в работе — снять нельзя.', 'error'); return; }
        this.modal('<p>Снять задание первичной резки от ' + esc(jc.fmtTime(j.start)) + ' (партия ' + esc(j.batch ? j.batch.no : '—') + ', ' + esc(jc.mapLabel(j.strips)) + ')? Партия вернётся в список к резке.</p>')
            .then(function(yes) {
                if (!yes) return;
                self.busy = true;
                return self.client.post('_m_del/' + encodeURIComponent(jobId) + '?JSON', {}).then(function() {
                    self.message('Задание снято.', 'ok');
                    return self.reload();
                }).catch(function(err) { self.message('Не снято: ' + err.message, 'error'); })
                    .then(function() { self.busy = false; });
            });
    };

    return { AtexJumboCutting: AtexJumboCutting, core: { manualVariant: manualVariant, toInput: toInput, fromInput: fromInput } };
});
