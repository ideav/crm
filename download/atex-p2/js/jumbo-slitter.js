// Рабочее место atex «Пульт большого слиттера» (Оператор, планшет; ideav/crm#5315, шаг 6 Фазы 2).
//
// Оператор видит очередь заданий первичной резки и текущее задание: партию джамбо, карту
// раскроя (та же, что у диспетчера в «Раскрое джамбо», правится только там), съёмы по длине.
//   - «Начать резку» — статус задания «В работе»;
//   - «Съём N выполнен — принять мастер-рулоны» — по рулону на полосу: номер МР-NNNN, формат,
//     длина съёма (правится по факту), сырьё и склад партии, ссылка на задание; рулон, отмеченный
//     браком, получает статус «брак» и нулевой остаток. Остаток партии джамбо пересчитывается
//     от длины партии и принятых съёмов (повтор не вычитает дважды);
//   - после последнего съёма задание «Выполнено».
// Прогресс считается по уже принятым рулонам задания (pullProgress): если запись оборвалась,
// повтор приёмки дописывает недостающие рулоны съёма, а не начинает его заново.
// Ядро — jumbo-cut-map.js; таблицы резолвятся по именам из /metadata.

(function(root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') {
        window.AtexJumboSlitter = api;
        var start = function() {
            var el = document.getElementById('atex-js-app');
            if (el && !el.__atexJs) el.__atexJs = new api.AtexJumboSlitter(el).start();
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
        else start();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
    'use strict';

    var LP = (root && root.AtexLabelProduction) || (typeof require === 'function' ? require('../../atex/js/label-production.js') : null);
    var JM = (root && root.AtexJumboCutMap) || (typeof require === 'function' ? require('./jumbo-cut-map.js') : null);
    var lp = LP ? LP.core : null;
    var jc = JM ? JM.core : null;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // Остаток партии после принятых съёмов: длина партии минус длины завершённых съёмов.
    function batchRestAfter(length, pulls, completedPulls) {
        var used = 0;
        for (var i = 0; i < completedPulls && i < pulls.length; i++) used += pulls[i];
        return Math.max(0, Math.round((length - used) * 10) / 10);
    }

    // Сетка «полоса × съём» для экрана: рулоны задания по порядку приёмки.
    function rollGrid(job) {
        var plan = jc.releasePlan(job.strips, job.pulls);
        var perPull = job.progress.perPull;
        var rows = [];
        for (var s = 0; s < perPull; s++) rows.push({ slot: s + 1, format: plan[s] ? plan[s].format : 0, purpose: plan[s] ? plan[s].purpose : '', cells: [] });
        plan.forEach(function(p, i) {
            var row = rows[p.slot - 1];
            if (row) row.cells[p.pull] = job.rolls[i] || null;
        });
        return rows;
    }

    function AtexJumboSlitter(rootEl) {
        this.root = rootEl;
        this.client = new JM.Client(rootEl.getAttribute('data-db') || '', rootEl.getAttribute('data-xsrf') || '');
        this.state = null;
        this.selectedId = '';
        this.busy = false;
    }

    AtexJumboSlitter.prototype.$ = function(id) { return document.getElementById(id); };

    AtexJumboSlitter.prototype.message = function(text, kind) {
        var el = this.$('atex-js-message');
        if (!el) return;
        el.hidden = !text;
        el.className = 'atex-jb-message' + (kind ? ' is-' + kind : '');
        el.textContent = text || '';
    };

    AtexJumboSlitter.prototype.start = function() {
        var self = this;
        this.root.addEventListener('click', function(e) {
            var j = e.target.closest('[data-job-id]');
            if (j) { self.selectedId = j.getAttribute('data-job-id'); return self.render(); }
            var a = e.target.closest('[data-act]');
            if (!a) return;
            var act = a.getAttribute('data-act');
            if (act === 'begin') self.begin();
            else if (act === 'accept') self.askAccept();
            else if (act === 'close') self.close();
            else if (act === 'refresh') { self.message(''); self.reload(); }
        });
        this.reload();
        return this;
    };

    AtexJumboSlitter.prototype.reload = function() {
        var self = this;
        return JM.loadState(this.client, lp, {}).then(function(state) {
            self.state = state;
            var warn = state.missing.concat(state.settings.errors);
            // Пусто — сообщение последнего действия («записано», «не записано») остаётся.
            if (warn.length) self.message('Проверьте настройку и схему: ' + warn.join('; '), 'warn');
            if (!state.openJobs.some(function(j) { return j.id === self.selectedId; })) {
                var running = state.openJobs.filter(function(j) { return j.status === jc.JOB_STATUS.RUNNING; })[0];
                self.selectedId = (running || state.openJobs[0] || {}).id || '';
            }
            self.render();
        }).catch(function(err) {
            console.error('[jumbo-slitter] ❌', err);
            self.message('Пульт не загрузился: ' + err.message, 'error');
        });
    };

    AtexJumboSlitter.prototype.current = function() {
        var id = this.selectedId;
        return this.state ? this.state.openJobs.filter(function(j) { return j.id === id; })[0] || null : null;
    };

    AtexJumboSlitter.prototype.render = function() {
        this.renderList();
        this.renderJob();
    };

    AtexJumboSlitter.prototype.renderList = function() {
        var sel = this.selectedId;
        var jobs = this.state.openJobs;
        this.$('atex-js-list').innerHTML = jobs.length ? jobs.map(function(j) {
            var b = j.batch || {};
            var pr = j.progress;
            var when = j.status === jc.JOB_STATUS.RUNNING ? 'в работе' : jc.fmtTime(j.start);
            return '<div class="atex-jb-job' + (j.id === sel ? ' is-picked' : '') + '" data-job-id="' + esc(j.id) + '"><div class="atex-jb-job-top"><span class="atex-jb-job-no">' +
                esc(b.no || 'без партии') + '</span><span class="atex-jb-job-time">' + esc(when) + '</span></div><div class="atex-jb-job-meta">' + esc(b.material || '') +
                '</div><div class="atex-jb-job-meta">' + esc(jc.mapLabel(j.strips)) + (pr.total ? ' · съём ' + Math.min(pr.pullIndex + 1, pr.pulls) + ' из ' + pr.pulls : '') + '</div></div>';
        }).join('') : '<div class="atex-jb-empty">Заданий первичной резки нет.</div>';
    };

    AtexJumboSlitter.prototype.renderJob = function() {
        var el = this.$('atex-js-job');
        var j = this.current();
        if (!j) { el.innerHTML = '<div class="atex-jb-empty">Выберите задание слева.</div>'; return; }
        var b = j.batch || { geometry: {} };
        var g = b.geometry || {};
        var pr = j.progress;
        var running = j.status === jc.JOB_STATUS.RUNNING;
        var html = '<div class="atex-jb-pad-head"><div class="atex-jb-pad-order">' + esc(b.no || '—') + '</div>' +
            '<div class="atex-jb-pad-sub">' + (pr.total ? 'Съём по длине <b>' + Math.min(pr.pullIndex + 1, pr.pulls) + '</b> из ' + pr.pulls : 'нет полос') + '</div>' +
            '<span class="atex-jb-badge is-info">' + esc((g.width || '—') + ' мм × ' + jc.fmtNum(g.length) + ' м') + '</span></div>' +
            '<p class="atex-jb-muted">' + esc(b.material || '') + ' · план-старт ' + esc(jc.fmtTime(j.start)) + ' · кромка по карте ' + esc(j.edge) + ' мм</p>';
        if (!j.strips.length || !j.pulls.length) {
            html += '<div class="atex-jb-message is-error">' + esc(!j.strips.length ? 'У задания нет полос раскроя — карту задаёт диспетчер в «Раскрое джамбо».' : 'У партии не задана длина — съёмы не посчитать.') + '</div>';
            el.innerHTML = html;
            return;
        }
        var steps = ['Задание получено', 'Резка начата'];
        j.pulls.forEach(function(len, i) { steps.push('Съём ' + (i + 1) + ' · ' + jc.fmtNum(len) + ' м'); });
        steps.push('Мастер-рулоны приняты');
        var now = !running ? 1 : 2 + pr.pullIndex;
        html += '<div class="atex-jb-steps">' + steps.map(function(s, i) {
            return '<span class="atex-jb-step' + (i < now ? ' is-done' : (i === now ? ' is-now' : '')) + '">' + esc(s) + '</span>';
        }).join('') + '</div>';
        html += '<div class="atex-jb-toolbar">';
        if (!running) html += '<button class="atex-jb-btn atex-jb-btn-primary atex-jb-btn-lg" type="button" data-act="begin">Начать резку</button>';
        else if (!pr.done) html += '<button class="atex-jb-btn atex-jb-btn-ok atex-jb-btn-lg" type="button" data-act="accept">Съём ' + (pr.pullIndex + 1) + ' выполнен — принять мастер-рулоны' + (pr.inPull ? ' (осталось ' + (pr.perPull - pr.inPull) + ')' : '') + '</button>';
        else html += '<button class="atex-jb-btn atex-jb-btn-primary atex-jb-btn-lg" type="button" data-act="close">Закрыть задание</button>';
        html += '<button class="atex-jb-btn atex-jb-btn-lg" type="button" data-act="refresh">Обновить</button></div>';

        html += '<h2 class="atex-jb-panel-title">Карта раскроя — что стоит на валу</h2>';
        html += webHtml(j, g.width);
        var grid = rollGrid(j);
        html += '<table class="atex-jb-table"><thead><tr><th>Полоса</th><th class="num">Формат</th><th>Назначение</th>' +
            j.pulls.map(function(len, i) { return '<th>Съём ' + (i + 1) + ' (' + jc.fmtNum(len) + ' м)</th>'; }).join('') + '</tr></thead><tbody>' +
            grid.map(function(r) {
                return '<tr><td>' + r.slot + '</td><td class="num">' + esc(r.format) + '</td><td>' + esc(r.purpose) + '</td>' + j.pulls.map(function(len, p) {
                    var m = r.cells[p];
                    if (!m) return '<td><span class="atex-jb-badge">ожидает</span></td>';
                    var scrap = jc.norm(m.status) === jc.ROLL_STATUS.SCRAP;
                    return '<td><b>' + esc(m.no) + '</b> <span class="atex-jb-badge ' + (scrap ? 'is-bad' : 'is-ok') + '">' + esc(scrap ? 'брак' : 'принят') + '</span>' +
                        (m.length && m.length !== len ? ' <span class="atex-jb-muted">' + jc.fmtNum(m.length) + ' м</span>' : '') + '</td>';
                }).join('') + '</tr>';
            }).join('') + '</tbody></table>';
        var scrapN = j.rolls.filter(function(m) { return jc.norm(m.status) === jc.ROLL_STATUS.SCRAP; }).length;
        html += '<h2 class="atex-jb-panel-title">Отход</h2><table class="atex-jb-table">' +
            '<tr><td>Кромка по карте</td><td class="num">' + esc(j.edge) + ' мм</td></tr>' +
            '<tr><td>Метров кромки</td><td class="num">' + jc.fmtNum(g.length) + '</td></tr>' +
            '<tr><td>Доля от ширины джамбо</td><td class="num">' + (g.width ? Math.round(j.edge / g.width * 1000) / 10 : '—') + ' %</td></tr>' +
            '<tr><td>Мастер-рулонов в брак</td><td class="num">' + scrapN + '</td></tr></table>';
        el.innerHTML = html;
    };

    function webHtml(job, W) {
        var strips = [];
        var n = 0;
        job.strips.forEach(function(s) {
            for (var i = 0; i < s.count; i++) {
                n++;
                strips.push('<div class="atex-jb-web-strip' + (s.purpose === jc.PURPOSE.STOCK ? ' is-stock' : '') + '" style="flex:' + s.format + ' 0 0">' + esc(s.format) + '<small>полоса ' + n + '</small></div>');
            }
        });
        if (job.edge > 0) strips.push('<div class="atex-jb-web-strip atex-jb-web-edge" style="flex:' + job.edge + ' 0 0">кромка<small>' + esc(job.edge) + '</small></div>');
        return '<div class="atex-jb-web" title="ширина партии ' + esc(W) + ' мм">' + strips.join('') + '</div>';
    }

    AtexJumboSlitter.prototype.modal = function(html) {
        var modal = this.$('atex-js-modal');
        var ok = this.$('atex-js-modal-ok');
        var cancel = this.$('atex-js-modal-cancel');
        this.$('atex-js-modal-text').innerHTML = html;
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

    AtexJumboSlitter.prototype.setStatus = function(j, status) {
        var t = this.state.tables;
        var p = {};
        p['t' + t.jumboJob.reqs.status] = status;
        return this.client.post('_m_set/' + encodeURIComponent(j.id) + '?JSON', p);
    };

    AtexJumboSlitter.prototype.begin = function() {
        var self = this;
        var j = this.current();
        if (!j || this.busy) return;
        this.busy = true;
        this.setStatus(j, jc.JOB_STATUS.RUNNING).then(function() {
            self.message('Резка начата: партия ' + (j.batch ? j.batch.no : '') + '.', 'ok');
            return self.reload();
        }).catch(function(err) { self.message('Не записано: ' + err.message, 'error'); })
            .then(function() { self.busy = false; });
    };

    AtexJumboSlitter.prototype.askAccept = function() {
        var self = this;
        var j = this.current();
        if (!j || this.busy) return;
        var todo = jc.pullRolls(j.strips, j.pulls, j.created);
        if (!todo.length) return;
        var nos = jc.nextRollNumbers(this.state.rolls.map(function(m) { return m.no; }), todo.length);
        var html = '<p>Съём ' + (todo[0].pull + 1) + ' из ' + j.pulls.length + ', партия <b>' + esc(j.batch ? j.batch.no : '') + '</b>. Длина — по факту съёма; рулон с дефектом отметьте браком.</p>' +
            '<table class="atex-jb-table"><thead><tr><th>Номер</th><th class="num">Полоса</th><th class="num">Формат</th><th>Длина, м</th><th>Брак</th></tr></thead><tbody>' +
            todo.map(function(r, i) {
                return '<tr><td><b>' + esc(nos[i]) + '</b></td><td class="num">' + r.slot + '</td><td class="num">' + esc(r.format) + '</td>' +
                    '<td><input class="atex-jb-input atex-jb-input-sm" type="number" min="0" step="0.1" data-roll-len="' + i + '" value="' + esc(r.length) + '"></td>' +
                    '<td><input type="checkbox" data-roll-scrap="' + i + '"></td></tr>';
            }).join('') + '</tbody></table>';
        this.modal(html).then(function(yes) {
            if (!yes) return;
            var rows = todo.map(function(r, i) {
                var lenEl = self.root.querySelector('[data-roll-len="' + i + '"]');
                var scrapEl = self.root.querySelector('[data-roll-scrap="' + i + '"]');
                var len = jc.num(lenEl ? lenEl.value : r.length);
                return { no: nos[i], format: r.format, length: len > 0 ? len : r.length, scrap: !!(scrapEl && scrapEl.checked) };
            });
            return self.accept(j, todo[0].pull, rows);
        });
    };

    // Рулоны по одному (номер, формат, длина, сырьё, задание, остаток, статус, склад), затем
    // остаток партии; после последнего съёма — статус задания «Выполнено».
    AtexJumboSlitter.prototype.accept = function(j, pull, rows) {
        var self = this;
        var t = this.state.tables;
        var r = t.masterRoll.reqs;
        var b = j.batch;
        this.busy = true;
        var made = 0;
        var chain = Promise.resolve();
        rows.forEach(function(row) {
            chain = chain.then(function() {
                var p = {};
                p['t' + t.masterRoll.id] = row.no;
                if (r.format) p['t' + r.format] = String(row.format);
                if (r.length) p['t' + r.length] = String(row.length);
                if (r.material && b.materialId) p['t' + r.material] = b.materialId;
                if (r.jumboJob) p['t' + r.jumboJob] = j.id;
                if (r.rest) p['t' + r.rest] = row.scrap ? '0' : String(row.length);
                if (r.status) p['t' + r.status] = row.scrap ? jc.ROLL_STATUS.SCRAP : jc.ROLL_STATUS.STOCK;
                if (r.warehouse && b.warehouseId) p['t' + r.warehouse] = b.warehouseId;
                return self.client.post('_m_new/' + t.masterRoll.id + '?JSON&up=1', p).then(function() { made++; });
            });
        });
        return chain.then(function() {
            var completed = jc.pullProgress(j.strips, j.pulls, j.created + made).pullIndex;
            var p = {};
            p['t' + t.jumboBatch.reqs.rest] = String(batchRestAfter(b.geometry.length, j.pulls, completed));
            return self.client.post('_m_set/' + encodeURIComponent(b.id) + '?JSON', p);
        }).then(function() {
            var done = jc.pullProgress(j.strips, j.pulls, j.created + made).done;
            return done ? self.setStatus(j, jc.JOB_STATUS.DONE).then(function() { return true; }) : false;
        }).then(function(done) {
            self.message('Принято мастер-рулонов: ' + made + ' (' + rows[0].no + ' … ' + rows[rows.length - 1].no + ')' + (done ? '. Задание выполнено.' : '.'), 'ok');
            return self.reload();
        }).catch(function(err) {
            console.error('[jumbo-slitter] ❌ приёмка', err);
            self.message('Приёмка прервана после ' + made + ' рулонов: ' + err.message + '. Нажмите кнопку снова — допишутся только недостающие.', 'error');
            return self.reload();
        }).then(function() { self.busy = false; });
    };

    AtexJumboSlitter.prototype.close = function() {
        var self = this;
        var j = this.current();
        if (!j || this.busy || !j.progress.done) return;
        this.busy = true;
        var t = this.state.tables;
        var p = {};
        p['t' + t.jumboBatch.reqs.rest] = String(batchRestAfter(j.batch.geometry.length, j.pulls, j.pulls.length));
        this.client.post('_m_set/' + encodeURIComponent(j.batch.id) + '?JSON', p).then(function() {
            return self.setStatus(j, jc.JOB_STATUS.DONE);
        }).then(function() {
            self.message('Задание закрыто.', 'ok');
            return self.reload();
        }).catch(function(err) { self.message('Не записано: ' + err.message, 'error'); })
            .then(function() { self.busy = false; });
    };

    return { AtexJumboSlitter: AtexJumboSlitter, core: { batchRestAfter: batchRestAfter, rollGrid: rollGrid } };
});
