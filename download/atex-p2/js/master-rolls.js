// Рабочее место atex «Склад мастер-рулонов» (роль Кладовщик; ideav/crm#5325, шаг 5 Фазы 2).
//
// Вкладки:
//   - остатки по форматам × сырью: рулонов (початых), остаток, в резерве, свободно;
//   - рулоны: фильтры, статус, резерв, «Списать»;
//   - резерв под задания высечки: потребность (метраж − израсходовано), резерв, дефицит,
//     «Зарезервировать» (автоподбор целых рулонов, початые — явной галкой), снятие резерва;
//   - движение: журнал «Движение мастер-рулона» + приход рулонов по заданиям первичной резки.
// Действия: «Приход» (рулоны не из резки), «Инвентаризация» (акт по рулонам на складе), «Списать».
// Расход пишет только вырубка (пульт высечки, consumePlan ядра) — ручного расхода здесь нет.
// Ядро — master-rolls-core.js (покрыто experiments/atex-p2-5325-master-rolls.test.js).

(function(root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') {
        window.AtexMasterRollsApp = api;
        var start = function() {
            var el = document.getElementById('atex-mr-app');
            if (el && !el.__atexMr) el.__atexMr = new api.AtexMasterRollsApp(el).start();
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
        else start();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
    'use strict';

    var MR = (root && root.AtexMasterRolls) || (typeof require === 'function' ? require('./master-rolls-core.js') : null);
    var C = MR ? MR.core : null;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function fmtNum(n) {
        var v = Math.round(C.num(n) * 10) / 10;
        var s = String(Math.abs(v)).split('.');
        return (v < 0 ? '−' : '') + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (s[1] ? ',' + s[1] : '');
    }
    // Unix-секунды → «ДД.ММ.ГГГГ ЧЧ:ММ» по Москве: время в РМ — серверное, московское.
    function fmtTime(unix) {
        var t = C.num(unix);
        if (!(t > 0)) return '—';
        var d = new Date((t + 3 * 3600) * 1000);
        var p = function(n) { return (n < 10 ? '0' : '') + n; };
        return p(d.getUTCDate()) + '.' + p(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
    }

    var STATUS_BADGE = { 'на складе': 'is-ok', 'початый': 'is-warn', 'израсходован': '', 'брак': 'is-bad', 'списан': 'is-bad' };

    function AtexMasterRollsApp(el) {
        this.el = el;
        this.client = new MR.Client(el.getAttribute('data-db'), el.getAttribute('data-xsrf'));
        this.userId = el.getAttribute('data-user-id') || '';
        this.state = null;
        this.tab = 'stock';
        this.filter = { format: '', status: 'stock', q: '' };
        this.busy = false;
    }

    AtexMasterRollsApp.prototype.$ = function(id) { return this.el.querySelector('#' + id); };

    AtexMasterRollsApp.prototype.start = function() {
        var self = this;
        this.el.addEventListener('click', function(e) { self.onClick(e); });
        this.el.addEventListener('input', function(e) { self.onInput(e); });
        this.el.addEventListener('change', function(e) { self.onInput(e); });
        this.$('atex-mr-modal-cancel').addEventListener('click', function() { self.closeModal(); });
        this.$('atex-mr-modal-ok').addEventListener('click', function() { if (self.modalOk) self.modalOk(); });
        this.reload();
        return this;
    };

    AtexMasterRollsApp.prototype.message = function(text, kind) {
        var m = this.$('atex-mr-message');
        if (!text) { m.hidden = true; return; }
        m.hidden = false;
        m.className = 'atex-mr-message' + (kind ? ' is-' + kind : '');
        m.textContent = text;
    };

    AtexMasterRollsApp.prototype.reload = function(note) {
        var self = this;
        this.message('Загрузка…');
        return MR.loadState(this.client).then(function(state) {
            self.state = state;
            self.rollById = {};
            state.rolls.forEach(function(r) { self.rollById[r.id] = r; });
            self.taskById = {};
            state.tasks.forEach(function(t) { self.taskById[t.id] = t; });
            if (state.missing.length) self.message('Не найдено в базе: ' + state.missing.join('; ') + '. Часть данных не показана.', 'warn');
            else self.message(note || '', note ? 'ok' : '');
            self.render();
        }).catch(function(err) {
            self.message('Не удалось загрузить склад: ' + err.message, 'error');
        });
    };

    // ── Отрисовка ───────────────────────────────────────────────────────────

    AtexMasterRollsApp.prototype.render = function() {
        var s = this.state;
        if (!s) return;
        this.needs = C.taskNeeds(s.tasks, s.rolls, s.moves, s.settings.tolerance);
        this.stock = C.stockByFormat(s.rolls, s.tasks);
        var onStock = s.rolls.filter(C.onStock);
        var rest = onStock.reduce(function(a, r) { return a + r.rest; }, 0);
        var opened = onStock.filter(function(r) { return r.status === C.ROLL_STATUS.OPENED; }).length;
        var deficit = this.needs.filter(function(n) { return n.deficit > 0; });
        this.$('atex-mr-kpi').innerHTML = [
            [onStock.length, 'мастер-рулонов на складе', ''],
            [fmtNum(rest) + ' м', 'общий остаток', ''],
            [opened, 'початых (остаток меньше длины)', opened ? 'is-warn' : ''],
            [deficit.length, 'заданий высечки с дефицитом', deficit.length ? 'is-bad' : '']
        ].map(function(k) {
            return '<div class="atex-mr-kpi-tile ' + k[2] + '"><div class="atex-mr-kpi-value">' + esc(k[0]) + '</div><div class="atex-mr-kpi-label">' + esc(k[1]) + '</div></div>';
        }).join('');
        var self = this;
        Array.prototype.forEach.call(this.el.querySelectorAll('.atex-mr-tab'), function(b) {
            b.classList.toggle('is-active', b.getAttribute('data-tab') === self.tab);
        });
        var body = this.$('atex-mr-body');
        if (this.tab === 'rolls') body.innerHTML = this.renderRolls();
        else if (this.tab === 'reserve') body.innerHTML = this.renderReserve();
        else if (this.tab === 'moves') body.innerHTML = this.renderMoves();
        else body.innerHTML = this.renderStock();
    };

    AtexMasterRollsApp.prototype.renderStock = function() {
        if (!this.stock.length) return '<div class="atex-mr-empty">На складе нет мастер-рулонов.</div>';
        var tot = { rolls: 0, rest: 0, reserved: 0, free: 0 };
        var rows = this.stock.map(function(g) {
            tot.rolls += g.rolls; tot.rest += g.rest; tot.reserved += g.reserved; tot.free += g.free;
            return '<tr><td class="num">' + g.format + '</td><td>' + esc(g.material) + '</td>' +
                '<td class="num">' + g.rolls + (g.opened ? ' <span class="atex-mr-badge is-warn">' + g.opened + ' почат.</span>' : '') + '</td>' +
                '<td class="num">' + fmtNum(g.rest) + '</td><td class="num">' + fmtNum(g.reserved) + '</td><td class="num">' + fmtNum(g.free) + '</td></tr>';
        });
        rows.push('<tr class="is-total"><td colspan="2">Итого</td><td class="num">' + tot.rolls + '</td><td class="num">' + fmtNum(tot.rest) +
            '</td><td class="num">' + fmtNum(tot.reserved) + '</td><td class="num">' + fmtNum(tot.free) + '</td></tr>');
        return '<table class="atex-mr-table"><thead><tr><th class="num">Формат, мм</th><th>Сырьё</th><th class="num">Рулонов</th>' +
            '<th class="num">Остаток, м</th><th class="num">В резерве, м</th><th class="num">Свободно, м</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>' +
            '<p class="atex-mr-muted">В резерве — рулоны, закреплённые за открытыми заданиями высечки. Брак, списанные и израсходованные рулоны в остаток не входят.</p>';
    };

    AtexMasterRollsApp.prototype.rollTag = function(r) {
        var t = r.reserveTaskId && this.taskById[r.reserveTaskId];
        if (!t || !t.open) return '';
        var work = /работ/i.test(t.status);
        return ' <span class="atex-mr-badge ' + (work ? 'is-info' : '') + '">' + (work ? 'в работе' : 'резерв') + ' · задание ' + esc(t.id) + '</span>';
    };

    AtexMasterRollsApp.prototype.filteredRolls = function() {
        var f = this.filter, q = C.norm(f.q);
        return this.state.rolls.filter(function(r) {
            if (f.format && String(r.format) !== f.format) return false;
            if (f.status === 'stock' && !C.onStock(r)) return false;
            if (f.status && f.status !== 'stock' && f.status !== 'all' && r.status !== f.status) return false;
            if (q && C.norm(r.no + ' ' + r.material + ' ' + r.warehouse).indexOf(q) < 0) return false;
            return true;
        });
    };

    AtexMasterRollsApp.prototype.renderRolls = function() {
        var self = this, f = this.filter;
        var formats = {};
        this.state.rolls.forEach(function(r) { formats[r.format] = true; });
        var fOpts = ['<option value="">все форматы</option>'].concat(Object.keys(formats).sort(function(a, b) { return a - b; }).map(function(x) {
            return '<option value="' + esc(x) + '"' + (f.format === x ? ' selected' : '') + '>' + esc(x) + '</option>';
        }));
        var statuses = [['stock', 'на складе и початые'], ['all', 'все']].concat(Object.keys(C.ROLL_STATUS).map(function(k) { return [C.ROLL_STATUS[k], C.ROLL_STATUS[k]]; }));
        var sOpts = statuses.map(function(s) { return '<option value="' + esc(s[0]) + '"' + (f.status === s[0] ? ' selected' : '') + '>' + esc(s[1]) + '</option>'; });
        var list = this.filteredRolls();
        var head = '<div class="atex-mr-filters">' +
            '<select class="atex-mr-input" data-filter="format">' + fOpts.join('') + '</select>' +
            '<select class="atex-mr-input" data-filter="status">' + sOpts.join('') + '</select>' +
            '<input class="atex-mr-input" data-filter="q" placeholder="Поиск: номер, сырьё, склад" value="' + esc(f.q) + '">' +
            '<span class="atex-mr-muted">' + list.length + ' рулонов</span></div>';
        if (!list.length) return head + '<div class="atex-mr-empty">Нет рулонов под фильтр.</div>';
        var rows = list.map(function(r) {
            var can = r.status !== C.ROLL_STATUS.WRITTEN_OFF;
            return '<tr><td>' + esc(r.no) + '</td><td class="num">' + r.format + '</td><td>' + esc(r.material) + '</td>' +
                '<td class="num">' + fmtNum(r.length) + '</td><td class="num">' + fmtNum(r.rest) + '</td>' +
                '<td>' + (r.jumboJobId ? 'резка ' + esc(r.jumboJobId) : '<span class="atex-mr-muted">приход</span>') + '</td><td>' + esc(r.warehouse) + '</td>' +
                '<td><span class="atex-mr-badge ' + (STATUS_BADGE[r.status] || '') + '">' + esc(r.status) + '</span>' + self.rollTag(r) + '</td>' +
                '<td>' + (can ? '<button class="atex-mr-btn atex-mr-btn-sm" type="button" data-act="writeoff" data-roll="' + esc(r.id) + '">Списать</button>' : '') + '</td></tr>';
        });
        return head + '<table class="atex-mr-table"><thead><tr><th>Рулон</th><th class="num">Формат</th><th>Сырьё</th><th class="num">Длина, м</th>' +
            '<th class="num">Остаток, м</th><th>Откуда</th><th>Склад</th><th>Статус</th><th></th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
    };

    AtexMasterRollsApp.prototype.renderReserve = function() {
        if (this.state.missing.indexOf('отчёт die_tasks') >= 0) return '<div class="atex-mr-empty">Нет отчёта die_tasks — задания высечки не прочитаны.</div>';
        if (!this.needs.length) return '<div class="atex-mr-empty">Открытых заданий высечки нет.</div>';
        var rows = this.needs.map(function(n) {
            var t = n.task;
            var chips = n.rolls.map(function(r) {
                return '<span class="atex-mr-chip">' + esc(r.no) + ' · ' + r.format + ' · ' + fmtNum(r.rest) + ' м' +
                    '<button type="button" title="Снять резерв" data-act="unreserve" data-roll="' + esc(r.id) + '">×</button></span>';
            }).join('');
            return '<tr class="' + (n.deficit > 0 ? 'is-deficit' : '') + '"><td>' + esc(t.id) + '<div class="atex-mr-muted">' + esc(fmtTime(t.start)) + '</div></td>' +
                '<td>' + esc(t.machine || 'станок не назначен') + '<div class="atex-mr-muted">нож ' + esc(t.dieNo) + ' · ' + esc(t.status || 'без статуса') + '</div></td>' +
                '<td>' + esc(t.material) + '</td><td class="num">' + t.minFormat + '–' + t.maxFormat + '</td>' +
                '<td class="num">' + fmtNum(n.need) + (n.consumed ? '<div class="atex-mr-muted">израсх. ' + fmtNum(n.consumed) + '</div>' : '') + '</td>' +
                '<td class="num">' + fmtNum(n.reserved) + '</td><td class="num">' + (n.deficit > 0 ? fmtNum(n.deficit) : '—') + '</td>' +
                '<td class="num">' + fmtNum(n.available) + '</td>' +
                '<td><button class="atex-mr-btn atex-mr-btn-sm" type="button" data-act="reserve" data-task="' + esc(t.id) + '"' + (n.available > 0 ? '' : ' disabled') + '>Зарезервировать</button>' +
                (chips ? '<div class="atex-mr-chips">' + chips + '</div>' : '') + '</td></tr>';
        });
        return '<table class="atex-mr-table"><thead><tr><th>Задание</th><th>Станок, нож</th><th>Сырьё</th><th class="num">Формат, мм</th>' +
            '<th class="num">Нужно, м</th><th class="num">В резерве, м</th><th class="num">Дефицит, м</th><th class="num">Подходит на складе, м</th><th>Рулоны</th></tr></thead><tbody>' +
            rows.join('') + '</tbody></table>' +
            '<p class="atex-mr-muted">Нужно — метраж задания минус расход по журналу. Формат — от минимального формата ножа до минимального + ' +
            esc(this.state.settings.tolerance) + ' мм (настройка JUMBO_FORMAT_TOLERANCE_MM). Рулон, из которого задание уже вырубало, с резерва не снимается.</p>';
    };

    AtexMasterRollsApp.prototype.renderMoves = function() {
        var self = this;
        var list = C.journal(this.state.rolls, this.state.moves);
        if (!list.length) return '<div class="atex-mr-empty">Движений нет.</div>';
        var rows = list.slice(0, 1000).map(function(m) {
            var r = self.rollById[m.rollId] || {};
            var doc = [m.taskId ? 'задание ' + m.taskId : '', m.basis].filter(Boolean).join(' · ');
            return '<tr><td>' + esc(fmtTime(m.time)) + '</td><td>' + esc(m.kind) + (m.derived ? ' <span class="atex-mr-muted">(по резке)</span>' : '') + '</td>' +
                '<td>' + esc(r.no || m.rollId) + '</td><td class="num">' + esc(r.format || '') + '</td>' +
                '<td class="num ' + (m.delta > 0 ? 'atex-mr-plus' : m.delta < 0 ? 'atex-mr-minus' : '') + '">' + (m.delta > 0 ? '+' : '') + fmtNum(m.delta) + '</td>' +
                '<td>' + esc(doc) + '</td><td>' + esc(m.operator || '') + '</td></tr>';
        });
        return '<table class="atex-mr-table"><thead><tr><th>Дата</th><th>Операция</th><th>Рулон</th><th class="num">Формат</th><th class="num">Метры</th>' +
            '<th>Документ</th><th>Кто</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>' +
            (list.length > 1000 ? '<p class="atex-mr-muted">Показаны последние 1000 из ' + list.length + '.</p>' : '');
    };

    // ── События ─────────────────────────────────────────────────────────────

    AtexMasterRollsApp.prototype.onClick = function(e) {
        var tab = e.target.closest('[data-tab]');
        if (tab && this.el.contains(tab)) { this.tab = tab.getAttribute('data-tab'); this.render(); return; }
        var b = e.target.closest('[data-act]');
        if (!b || !this.el.contains(b) || b.disabled) return;
        var act = b.getAttribute('data-act');
        if (act === 'refresh') this.reload();
        else if (!this.state) return;
        else if (act === 'receipt') this.openReceipt();
        else if (act === 'inventory') this.openInventory();
        else if (act === 'writeoff') this.openWriteOff(this.rollById[b.getAttribute('data-roll')]);
        else if (act === 'reserve') this.openReserve(this.taskById[b.getAttribute('data-task')]);
        else if (act === 'unreserve') this.openUnreserve(this.rollById[b.getAttribute('data-roll')]);
    };

    AtexMasterRollsApp.prototype.onInput = function(e) {
        var f = e.target.getAttribute && e.target.getAttribute('data-filter');
        if (!f) return;
        this.filter[f] = e.target.value;
        if (f === 'q' && e.type === 'input') {
            var pos = e.target.selectionStart;
            this.render();
            var inp = this.el.querySelector('[data-filter="q"]');
            if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch (x) { /* не текстовое поле */ } }
            return;
        }
        if (e.type === 'change') this.render();
    };

    // ── Модальное окно ──────────────────────────────────────────────────────

    AtexMasterRollsApp.prototype.openModal = function(html, okText, onOk) {
        this.$('atex-mr-modal-text').innerHTML = html;
        this.$('atex-mr-modal-error').textContent = '';
        var ok = this.$('atex-mr-modal-ok');
        ok.textContent = okText || 'Подтвердить';
        ok.disabled = false;
        this.modalOk = onOk;
        this.$('atex-mr-modal').hidden = false;
    };
    AtexMasterRollsApp.prototype.closeModal = function() { this.$('atex-mr-modal').hidden = true; this.modalOk = null; };
    AtexMasterRollsApp.prototype.modalError = function(text) { this.$('atex-mr-modal-error').textContent = text || ''; };
    AtexMasterRollsApp.prototype.modalVal = function(name) {
        var x = this.$('atex-mr-modal-text').querySelector('[name="' + name + '"]');
        return x ? x.value : '';
    };

    // Последовательная запись: ошибка останавливает цепочку, уже записанное остаётся и видно после перечитки.
    AtexMasterRollsApp.prototype.run = function(steps, doneText) {
        var self = this;
        if (this.busy) return;
        this.busy = true;
        this.$('atex-mr-modal-ok').disabled = true;
        var done = 0;
        var chain = steps.reduce(function(p, step) { return p.then(function() { return step().then(function() { done++; }); }); }, Promise.resolve());
        chain.then(function() {
            self.busy = false;
            self.closeModal();
            self.reload(doneText);
        }).catch(function(err) {
            self.busy = false;
            self.$('atex-mr-modal-ok').disabled = false;
            self.modalError('Ошибка записи (выполнено шагов: ' + done + ' из ' + steps.length + '): ' + err.message);
            if (done) self.reload();
        });
    };

    AtexMasterRollsApp.prototype.writeMove = function(now, p) {
        var t = this.state.tables;
        var kindId = this.state.kindIds[p.kind];
        if (!kindId) return Promise.reject(new Error('в справочнике «Вид движения мастер-рулона» нет «' + p.kind + '»'));
        var f = C.moveFields(t, { time: now, rollId: p.rollId, kindId: kindId, delta: p.delta, rest: p.rest, taskId: p.taskId, basis: p.basis, userId: this.userId });
        return this.client.post('_m_new/' + t.rollMove.id + '?JSON&up=1', f);
    };
    AtexMasterRollsApp.prototype.setRoll = function(rollId, p) {
        return this.client.post('_m_set/' + encodeURIComponent(rollId) + '?JSON', C.rollUpdateFields(this.state.tables, p));
    };

    // ── Приход ──────────────────────────────────────────────────────────────

    AtexMasterRollsApp.prototype.openReceipt = function() {
        var self = this, s = this.state;
        var mats = s.materials.map(function(m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('');
        var whs = ['<option value="">—</option>'].concat(s.warehouses.map(function(w) { return '<option value="' + esc(w.id) + '">' + esc(w.name) + '</option>'; })).join('');
        this.openModal('<h3>Приход мастер-рулонов</h3>' +
            '<p class="atex-mr-muted">Рулоны из заданий первичной резки приходуются пультом большого слиттера. Здесь — начальные остатки и рулоны со стороны.</p>' +
            '<div class="atex-mr-grid">' +
            '<label class="atex-mr-field">Сырьё<select class="atex-mr-input" name="material">' + mats + '</select></label>' +
            '<label class="atex-mr-field">Формат, мм<input class="atex-mr-input" name="format" inputmode="numeric"></label>' +
            '<label class="atex-mr-field">Длина, м<input class="atex-mr-input" name="length" inputmode="decimal" value="' + esc(s.settings.rollLength) + '"></label>' +
            '<label class="atex-mr-field">Рулонов<input class="atex-mr-input" name="count" inputmode="numeric" value="1"></label>' +
            '<label class="atex-mr-field">Склад<select class="atex-mr-input" name="warehouse">' + whs + '</select></label>' +
            '</div><label class="atex-mr-field">Основание (документ прихода)<input class="atex-mr-input" name="basis"></label>',
        'Оприходовать', function() {
            var p = { materialId: self.modalVal('material'), format: self.modalVal('format'), length: self.modalVal('length'),
                count: self.modalVal('count'), warehouseId: self.modalVal('warehouse'), basis: self.modalVal('basis').trim() };
            var chk = C.receiptCheck(p);
            if (!chk.ok) { self.modalError(chk.error); return; }
            var t = s.tables, count = C.num(p.count);
            var nos = C.nextRollNumbers(s.rolls.map(function(r) { return r.no; }), count);
            var now = 0;
            var steps = [function() { return self.client.serverNow().then(function(x) { now = x; }); }];
            nos.forEach(function(no) {
                steps.push(function() {
                    return self.client.post('_m_new/' + t.masterRoll.id + '?JSON&up=1', C.newRollFields(t, { no: no, format: p.format, length: p.length, materialId: p.materialId, warehouseId: p.warehouseId }))
                        .then(function(res) {
                            var id = res && (res.id || res.obj);
                            if (!id) throw new Error('сервер не вернул id рулона ' + no);
                            return self.writeMove(now, { kind: C.MOVE_KIND.IN, rollId: id, delta: C.num(p.length), rest: C.num(p.length), basis: p.basis });
                        });
                });
            });
            self.run(steps, 'Оприходовано: ' + nos.join(', '));
        });
    };

    // ── Инвентаризация ──────────────────────────────────────────────────────

    AtexMasterRollsApp.prototype.openInventory = function() {
        var self = this;
        var list = this.state.rolls.filter(C.onStock).filter(function(r) { return !self.filter.format || String(r.format) === self.filter.format; });
        if (!list.length) { this.message('На складе нет рулонов для инвентаризации.', 'warn'); return; }
        var rows = list.map(function(r) {
            return '<tr data-roll="' + esc(r.id) + '"><td>' + esc(r.no) + '</td><td class="num">' + r.format + '</td><td>' + esc(r.material) + '</td>' +
                '<td class="num">' + fmtNum(r.rest) + '</td><td class="num"><input class="atex-mr-input atex-mr-input-num" name="fact-' + esc(r.id) + '" inputmode="decimal" value="' + esc(r.rest) + '"></td></tr>';
        }).join('');
        this.openModal('<h3>Инвентаризация' + (this.filter.format ? ' — формат ' + esc(this.filter.format) : '') + '</h3>' +
            '<p class="atex-mr-muted">Впишите фактический остаток. Записываются только расхождения: движение «инвентаризация» и новый остаток рулона. Рулон не найден — факт 0.</p>' +
            '<label class="atex-mr-field">Основание (номер и дата акта)<input class="atex-mr-input" name="basis"></label>' +
            '<table class="atex-mr-table"><thead><tr><th>Рулон</th><th class="num">Формат</th><th>Сырьё</th><th class="num">Учёт, м</th><th class="num">Факт, м</th></tr></thead><tbody>' + rows + '</tbody></table>',
        'Провести акт', function() {
            var basis = self.modalVal('basis').trim();
            var plans = [], errors = [];
            list.forEach(function(r) {
                var pl = C.inventoryPlan(r, self.modalVal('fact-' + r.id), basis);
                if (!pl.ok) errors.push(r.no + ': ' + pl.error);
                else if (pl.changed) plans.push({ roll: r, plan: pl });
            });
            if (!basis) { self.modalError('Укажите основание (номер акта).'); return; }
            if (errors.length) { self.modalError(errors.slice(0, 5).join('; ')); return; }
            if (!plans.length) { self.closeModal(); self.message('Расхождений нет — акт без изменений.', 'ok'); return; }
            var now = 0;
            var steps = [function() { return self.client.serverNow().then(function(x) { now = x; }); }];
            plans.forEach(function(x) {
                steps.push(function() {
                    return self.writeMove(now, { kind: C.MOVE_KIND.COUNT, rollId: x.roll.id, delta: x.plan.delta, rest: x.plan.rest, basis: basis })
                        .then(function() { return self.setRoll(x.roll.id, { rest: x.plan.rest, status: x.plan.status }); });
                });
            });
            self.run(steps, 'Акт проведён: изменён остаток ' + plans.length + ' рулонов.');
        });
        this.$('atex-mr-modal-text').addEventListener('input', function(e) {
            var tr = e.target.closest('tr[data-roll]');
            if (!tr) return;
            var r = self.rollById[tr.getAttribute('data-roll')];
            tr.classList.toggle('is-changed', r && C.num(e.target.value) !== r.rest);
        });
    };

    // ── Списание ────────────────────────────────────────────────────────────

    AtexMasterRollsApp.prototype.openWriteOff = function(r) {
        var self = this;
        if (!r) return;
        var t = r.reserveTaskId && this.taskById[r.reserveTaskId];
        this.openModal('<h3>Списать ' + esc(r.no) + '</h3>' +
            '<p>Формат ' + r.format + ' мм, ' + esc(r.material) + ', остаток ' + fmtNum(r.rest) + ' м.</p>' +
            (t && t.open ? '<p class="atex-mr-message is-warn">Рулон в резерве задания ' + esc(t.id) + ' — резерв снимется.</p>' : '') +
            '<label class="atex-mr-field">Причина списания<input class="atex-mr-input" name="reason"></label>',
        'Списать', function() {
            var reason = self.modalVal('reason');
            var pl = C.writeOffPlan(r, reason);
            if (!pl.ok) { self.modalError(pl.error); return; }
            var now = 0;
            self.run([
                function() { return self.client.serverNow().then(function(x) { now = x; }); },
                function() { return self.writeMove(now, { kind: C.MOVE_KIND.OFF, rollId: r.id, delta: pl.delta, rest: 0, basis: reason.trim() }); },
                function() { return self.setRoll(r.id, { rest: 0, status: pl.status, clearReserve: pl.clearReserve }); }
            ], r.no + ' списан.');
        });
    };

    // ── Резерв ──────────────────────────────────────────────────────────────

    AtexMasterRollsApp.prototype.openReserve = function(task) {
        var self = this, s = this.state;
        if (!task) return;
        var need = (this.needs || []).filter(function(n) { return n.task.id === task.id; })[0];
        var cands = s.rolls.filter(function(r) { return r.reserveTaskId !== task.id && C.reserveCheck(r, task, s.settings.tolerance, s.moves, s.tasks).ok; })
            .sort(function(a, b) { return a.format - b.format || C.num(a.id) - C.num(b.id); });
        var pick = C.autoPick(task, s.rolls, s.moves, s.settings.tolerance, need ? need.deficit : 0, s.tasks);
        var rows = cands.map(function(r) {
            var opened = r.status === C.ROLL_STATUS.OPENED;
            return '<tr><td><input type="checkbox" name="pick" value="' + esc(r.id) + '"' + (pick.indexOf(r.id) >= 0 ? ' checked' : '') + '></td>' +
                '<td>' + esc(r.no) + '</td><td class="num">' + r.format + '</td><td class="num">' + fmtNum(r.rest) + '</td>' +
                '<td><span class="atex-mr-badge ' + (STATUS_BADGE[r.status] || '') + '">' + esc(r.status) + '</span>' + (opened ? ' <span class="atex-mr-muted">только явным выбором</span>' : '') + '</td></tr>';
        }).join('');
        this.openModal('<h3>Резерв под задание ' + esc(task.id) + '</h3>' +
            '<p>' + esc([task.machine, task.dieNo ? 'нож ' + task.dieNo : '', task.material, 'формат ' + task.minFormat + '–' + task.maxFormat + ' мм'].filter(Boolean).join(', ')) + '. ' +
            'Нужно ' + fmtNum(need ? need.need : task.footage) + ' м, в резерве ' + fmtNum(need ? need.reserved : 0) + ' м, дефицит ' + fmtNum(need ? need.deficit : 0) + ' м.</p>' +
            '<p class="atex-mr-muted">Отмечены целые рулоны ближайшего формата под дефицит. Початые подставляются только вашей галкой.</p>' +
            (rows ? '<table class="atex-mr-table"><thead><tr><th></th><th>Рулон</th><th class="num">Формат</th><th class="num">Остаток, м</th><th>Статус</th></tr></thead><tbody>' + rows + '</tbody></table>'
                : '<div class="atex-mr-empty">Подходящих свободных рулонов нет.</div>'),
        'Зарезервировать', function() {
            var ids = Array.prototype.map.call(self.$('atex-mr-modal-text').querySelectorAll('input[name="pick"]:checked'), function(x) { return x.value; });
            if (!ids.length) { self.modalError('Отметьте рулоны.'); return; }
            var bad = ids.map(function(id) { var c = C.reserveCheck(self.rollById[id], task, s.settings.tolerance, s.moves, s.tasks); return c.ok ? '' : self.rollById[id].no + ': ' + c.error; }).filter(Boolean);
            if (bad.length) { self.modalError(bad.join('; ')); return; }
            self.run(ids.map(function(id) { return function() { return self.setRoll(id, { reserveTaskId: task.id }); }; }),
                'Зарезервировано под задание ' + task.id + ': ' + ids.length + ' рулонов.');
        });
    };

    AtexMasterRollsApp.prototype.openUnreserve = function(r) {
        var self = this;
        if (!r) return;
        var chk = C.unreserveCheck(r, this.state.moves);
        if (!chk.ok) { this.message(chk.error, 'warn'); return; }
        this.openModal('<h3>Снять резерв</h3><p>Рулон ' + esc(r.no) + ' (формат ' + r.format + ', ' + fmtNum(r.rest) + ' м) освободится от задания ' + esc(r.reserveTaskId) + '.</p>',
            'Снять резерв', function() {
                self.run([function() { return self.setRoll(r.id, { clearReserve: true }); }], 'Резерв с ' + r.no + ' снят.');
            });
    };

    return { AtexMasterRollsApp: AtexMasterRollsApp, fmtNum: fmtNum, fmtTime: fmtTime };
});
