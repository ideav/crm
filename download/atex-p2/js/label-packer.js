// Рабочее место atex «Упаковка этикетки» (Оператор, планшет упаковочного места; ideav/crm#5348, шаг 10 Фазы 2).
//
// Упаковщик видит партии ГП этикетки «к упаковке», которые пульт высечки создаёт на каждый съём,
// и закрывает их: «Упаковано, рулонов», статус «упаковано», короб, склад НК и событие «Упаковка».
//   - упаковочное место — из записи планшета («Планшет → Упаковочное место», сторож pad-guard.js,
//     #4852): выбора места на экране нет;
//   - короб подбирается функциями Фазы 1 (packaging-size.js) по ширине и длине намотки рулона;
//     диаметр рулона считается из длины, толщины материала и диаметра втулки и показывается рядом.
//     Рулон не определён или короб не подошёл — упаковщик выбирает короб руками из справочника;
//   - неполный короб можно отправить «На склад НК» (и взять оттуда «Со склада НК»), как в Фазе 1 (#5086);
//     склад ведётся по артикулу позиции;
//   - этикетки на короб нет (решение по умолчанию #5348);
//   - журнал — «Событие смены высечки» типа «Упаковка» со ссылкой на задание; время — серверное
//     (заголовок Date), часы планшета не берутся.
// Чистые функции — label-packer-core.js; таблицы резолвятся по именам из /metadata; отчёты
// label_packer (docs/scripts/create_report_label_packer_5348.py) и pack_sizes (Фаза 1).

(function(root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') {
        window.AtexLabelPacker = api;
        var start = function() {
            var el = document.getElementById('atex-lp-app');
            if (el && !el.__atexLp) el.__atexLp = new api.AtexLabelPacker(el).start();
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
        else start();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
    'use strict';

    var CORE = (root && root.AtexLabelPackerCore) || (typeof require === 'function' ? require('./label-packer-core.js') : null);
    var P = CORE ? CORE.core : null;
    var PS = ((root && root.AtexPackagingSize) || (typeof require === 'function' ? require('../../atex/js/packaging-size.js') : null)).core;

    var DONE_LIMIT = 30;
    var AUTO_REFRESH_MS = 60 * 1000;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function kvRecords(json) {
        var reqs = (json && json.reqs) || {};
        return ((json && json.object) || []).map(function(o) {
            return { id: String(o.id), val: o.val == null ? '' : String(o.val), reqs: reqs[o.id] || {} };
        });
    }

    // ── Клиент Integram ──

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
    Client.prototype.serverNow = function() {
        return fetch(this.url('xsrf?JSON'), { credentials: 'same-origin', cache: 'no-store' }).then(function(resp) {
            var t = Date.parse(String(resp.headers.get('Date') || ''));
            if (!isFinite(t)) throw new Error('сервер не прислал время (заголовок Date)');
            return Math.floor(t / 1000);
        });
    };

    var SHELL = [
        '<div class="atex-lp-toolbar">',
        '<h1 class="atex-lp-title">Упаковка этикетки</h1>',
        '<span id="atex-lp-place" class="atex-lp-badge"></span>',
        '<button class="atex-lp-btn" type="button" data-act="refresh">Обновить</button>',
        '</div>',
        '<div id="atex-lp-message" class="atex-lp-message" hidden></div>',
        '<div id="atex-lp-list" class="atex-lp-list"></div>',
        '<div id="atex-lp-modal" class="atex-lp-modal" hidden>',
        '<div class="atex-lp-modal-box" role="dialog" aria-modal="true">',
        '<div id="atex-lp-modal-text"></div>',
        '<div id="atex-lp-modal-error" class="atex-lp-message is-error" hidden></div>',
        '<div class="atex-lp-modal-actions">',
        '<button id="atex-lp-modal-cancel" class="atex-lp-btn" type="button">Отмена</button>',
        '<button id="atex-lp-modal-ok" class="atex-lp-btn atex-lp-btn-primary" type="button">Упаковано</button>',
        '</div>',
        '</div>',
        '</div>'
    ].join('');

    function AtexLabelPacker(rootEl) {
        this.root = rootEl;
        this.client = new Client(rootEl.getAttribute('data-db') || '', rootEl.getAttribute('data-xsrf') || '');
        this.userId = rootEl.getAttribute('data-user-id') || '';
        this.state = null;
        this.busy = false;
        this.dialogOpen = false;
        this.showDone = false;
    }

    AtexLabelPacker.prototype.$ = function(id) { return document.getElementById(id); };

    AtexLabelPacker.prototype.message = function(text, kind) {
        var el = this.$('atex-lp-message');
        if (!el) return;
        el.hidden = !text;
        el.className = 'atex-lp-message' + (kind ? ' is-' + kind : '');
        el.textContent = text || '';
    };

    AtexLabelPacker.prototype.place = function() {
        return P.padPlace(typeof window !== 'undefined' ? window.atexPad : null);
    };

    AtexLabelPacker.prototype.start = function() {
        var self = this;
        this.root.innerHTML = SHELL;
        this.root.addEventListener('click', function(e) {
            var a = e.target.closest('[data-act]');
            if (!a || self.busy) return;
            var act = a.getAttribute('data-act');
            if (act === 'refresh') { self.message(''); self.reload(); }
            else if (act === 'pack') self.askPack(a.getAttribute('data-gp'));
            else if (act === 'toggleDone') { self.showDone = !self.showDone; self.render(); }
        });
        this.reload();
        // Планшет открыт днями, а партии появляются по ходу высечки: перечитываем сами.
        this.timer = setInterval(function() { if (!self.busy && !self.dialogOpen) self.reload(); }, AUTO_REFRESH_MS);
        return this;
    };

    AtexLabelPacker.prototype.reload = function() {
        var self = this, c = this.client;
        return c.getJson('metadata').then(function(meta) {
            var res = P.resolvePackTables(meta);
            if (res.fatal) throw new Error('в базе нет таблиц или полей упаковки: ' + res.missing.join('; ') + ' (docs/scripts/apply_label_packer_5348.py)');
            var report = function(name, hint) {
                return c.getJson('report/' + name + '?JSON_KV&LIMIT=0,100000').then(function(rows) {
                    if (!Array.isArray(rows)) throw new Error('нет отчёта ' + name + (hint ? ' (' + hint + ')' : ''));
                    return rows;
                });
            };
            return Promise.all([
                report('label_packer', 'docs/scripts/create_report_label_packer_5348.py'),
                report('pack_sizes').catch(function() { return []; }),
                c.getJson('object/' + res.tables.eventType.id + '/?JSON_KV&LIMIT=0,1000').then(kvRecords),
                c.serverNow()
            ]).then(function(r) {
                var typeId = '';
                r[2].forEach(function(t) { if (!typeId && P.norm(t.val) === P.norm(CORE.EVENT_TYPE_PACK)) typeId = t.id; });
                self.state = {
                    tables: res.tables,
                    missing: res.missing,
                    items: r[0].map(P.itemFromReportRow).filter(function(it) { return it.gpId; }),
                    sizes: PS.sizesFromReport(r[1]),
                    packTypeId: typeId,
                    now: r[3]
                };
                if (res.missing.length) self.message('Проверьте схему: ' + res.missing.join('; '), 'warn');
                else if (!typeId) self.message('В справочнике «Тип события высечки» нет значения «' + CORE.EVENT_TYPE_PACK + '» — событие в журнал писаться не будет.', 'warn');
                self.render();
            });
        }).catch(function(err) {
            console.error('[label-packer] ❌', err);
            self.message('Пульт не загрузился: ' + err.message, 'error');
        });
    };

    // ── Экран ──

    AtexLabelPacker.prototype.itemById = function(gpId) {
        var found = null;
        ((this.state && this.state.items) || []).forEach(function(it) { if (!found && it.gpId === String(gpId)) found = it; });
        return found;
    };

    AtexLabelPacker.prototype.render = function() {
        if (!this.state) return;
        var place = this.place();
        this.$('atex-lp-place').textContent = place ? 'Место ' + place.label : 'Место не назначено';
        var q = P.buildQueue(this.state.items);
        var self = this;
        var html = '';
        var groups = P.groupByOrder(q.todo);
        if (!groups.length) html += '<div class="atex-lp-empty">Партий к упаковке нет.</div>';
        groups.forEach(function(g) {
            html += '<section class="atex-lp-order">' +
                '<div class="atex-lp-order-head"><b class="atex-lp-order-no">' + (g.orderNo ? 'Заказ ' + esc(g.orderNo) : 'Без заказа') + '</b>' +
                (g.client ? ' <span class="atex-lp-muted">' + esc(g.client) + '</span>' : '') +
                (g.orderClient ? ' <span class="atex-lp-muted">· ' + esc(g.orderClient) + '</span>' : '') +
                '<span class="atex-lp-badge">к упаковке: ' + g.qty + ' рул.</span></div>' +
                g.items.map(function(it) { return self.cardHtml(it, false); }).join('') + '</section>';
        });
        if (q.done.length) {
            html += '<div class="atex-lp-done-head"><button class="atex-lp-btn" type="button" data-act="toggleDone">' +
                (this.showDone ? 'Скрыть упакованные' : 'Показать упакованные (' + q.done.length + ')') + '</button></div>';
            if (this.showDone) html += q.done.slice(0, DONE_LIMIT).map(function(it) { return self.cardHtml(it, true); }).join('');
        }
        this.$('atex-lp-list').innerHTML = html;
    };

    AtexLabelPacker.prototype.cardHtml = function(it, done) {
        var roll = P.rollParams(it);
        var size = it.sizeId ? this.state.sizes.filter(function(s) { return s.id === it.sizeId; })[0] : P.pickSize(this.state.sizes, it);
        var plan = P.packPlan(size, done ? it.packed : it.qty);
        var lines = [
            'Этикетка ' + (it.labelWidth || '?') + '×' + (it.labelLength || '?') + ' мм, ' + (it.perRoll || '?') + ' шт в рулоне' + (it.material ? ' · ' + esc(it.material) : ''),
            P.describeRoll(roll)
        ];
        var boxLine = size ? esc(PS.describeSize(size)) + (P.describePlan(plan) ? ' → ' + esc(P.describePlan(plan)) : '') : 'короб не подобран — выберите при упаковке';
        var nk = P.nkOf(it);
        return '<div class="atex-lp-card' + (done ? ' is-done' : '') + '">' +
            '<div class="atex-lp-card-main">' +
            '<div><b class="atex-lp-name">' + esc(it.name) + '</b>' + (it.art ? ' <span class="atex-lp-badge">арт. ' + esc(it.art) + '</span>' : '') + '</div>' +
            lines.map(function(l) { return '<div class="atex-lp-muted">' + l + '</div>'; }).join('') +
            '<div class="atex-lp-box">' + boxLine + '</div>' +
            (done && nk ? '<div class="atex-lp-muted">' + esc(P.nkNote(nk)) + '</div>' : '') +
            (done && it.notes ? '<div class="atex-lp-muted">' + esc(it.notes) + '</div>' : '') +
            '</div>' +
            '<div class="atex-lp-card-qty"><span class="atex-lp-qty">' + (done ? it.packed : it.qty) + '</span><span class="atex-lp-muted">рул.</span>' +
            '<button class="atex-lp-btn ' + (done ? '' : 'atex-lp-btn-primary atex-lp-btn-lg') + '" type="button" data-act="pack" data-gp="' + esc(it.gpId) + '">' + (done ? 'Исправить' : 'Упаковать') + '</button></div>' +
            '</div>';
    };

    // ── Диалог упаковки ──

    // Модалка с проверкой: «ОК» не закрывает окно, пока check() возвращает текст ошибки.
    AtexLabelPacker.prototype.dialog = function(html, okLabel, check) {
        var self = this;
        var modal = this.$('atex-lp-modal'), ok = this.$('atex-lp-modal-ok'), cancel = this.$('atex-lp-modal-cancel'), err = this.$('atex-lp-modal-error');
        this.$('atex-lp-modal-text').innerHTML = html;
        ok.textContent = okLabel;
        err.hidden = true;
        modal.hidden = false;
        this.dialogOpen = true;
        return new Promise(function(resolve) {
            var close = function(v) {
                modal.hidden = true;
                self.dialogOpen = false;
                ok.removeEventListener('click', yes);
                cancel.removeEventListener('click', no);
                resolve(v);
            };
            var yes = function() {
                var problem = check ? check() : '';
                if (problem) { err.textContent = problem; err.hidden = false; return; }
                close(true);
            };
            var no = function() { close(false); };
            ok.addEventListener('click', yes);
            cancel.addEventListener('click', no);
        });
    };

    AtexLabelPacker.prototype.field = function(name) {
        var el = this.root.querySelector('[data-f="' + name + '"]');
        return el ? el.value : '';
    };

    AtexLabelPacker.prototype.askPack = function(gpId) {
        var self = this, s = this.state, it = this.itemById(gpId);
        if (!it) return;
        var wasDone = P.norm(it.status) === P.norm(CORE.STATUS.PACKED);
        var suggested = wasDone ? it.packed : it.qty;
        var picked = it.sizeId ? s.sizes.filter(function(x) { return x.id === it.sizeId; })[0] : P.pickSize(s.sizes, it);
        var sp = P.splitSizes(s.sizes, it);
        var manual = sp.near.concat(sp.rest);
        var stock = P.nkStockByArt(s.items);
        var ownNk = P.nkOf(it);
        var hasArt = !!it.art;
        var roll = P.rollParams(it);
        var optionOf = function(z) {
            return '<option value="' + esc(z.id) + '"' + (picked && picked.id === z.id ? ' selected' : '') + '>' + esc(PS.describeSize(z)) + (z.name ? ' · ' + esc(z.name) : '') + '</option>';
        };
        var options = '<option value="">— выберите короб —</option>' +
            (sp.near.length ? '<optgroup label="Подходят по ширине рулона">' + sp.near.map(optionOf).join('') + '</optgroup>' : '') +
            (sp.rest.length ? '<optgroup label="Остальные">' + sp.rest.map(optionOf).join('') + '</optgroup>' : '');
        var html = '<h3>' + esc(it.name) + '</h3>' +
            '<div class="atex-lp-muted">' + esc(P.describeRoll(roll)) + '</div>' +
            '<label class="atex-lp-label">Упаковано, рулонов <input class="atex-lp-input" type="number" min="1" step="1" data-f="qty" value="' + esc(suggested) + '"></label>' +
            '<label class="atex-lp-label">Короб <select class="atex-lp-input" data-f="size">' + options + '</select></label>' +
            '<div id="atex-lp-plan" class="atex-lp-box"></div>' +
            (hasArt
                ? '<div class="atex-lp-nk"><label class="atex-lp-label">На склад НК, рул. <input class="atex-lp-input" type="number" min="1" step="1" data-f="nkTo" value="' + (ownNk > 0 ? ownNk : '') + '"></label>' +
                  '<label class="atex-lp-label">Со склада НК, рул. <input class="atex-lp-input" type="number" min="1" step="1" data-f="nkFrom" value="' + (ownNk < 0 ? -ownNk : '') + '"></label>' +
                  '<div class="atex-lp-muted">Склад НК, арт. ' + esc(it.art) + ': <b>' + (stock[it.art] || 0) + ' рул.</b></div></div>'
                : '<div class="atex-lp-muted">У позиции нет артикула — склад НК недоступен.</div>') +
            '<label class="atex-lp-label">Примечание <input class="atex-lp-input" type="text" data-f="note" value=""></label>';
        var updatePlan = function() {
            var z = manual.filter(function(x) { return x.id === self.field('size'); })[0];
            var qty = Math.floor(P.num(self.field('qty')));
            var plan = P.packPlan(z, qty);
            var el = self.$('atex-lp-plan');
            if (!el) return;
            el.textContent = z ? (P.describePlan(plan) || '') : 'Короб не выбран';
            // Неполный короб — подсказка про склад НК.
            if (z && plan.rest > 0 && hasArt) el.textContent += ' — неполный короб можно отправить на склад НК';
        };
        var onInput = function(e) { if (e.target && (e.target.getAttribute('data-f') === 'qty' || e.target.getAttribute('data-f') === 'size')) updatePlan(); };
        this.root.addEventListener('input', onInput);
        this.root.addEventListener('change', onInput);
        var nkOf = function() { return hasArt ? P.nkValue(self.field('nkTo'), self.field('nkFrom')) : 0; };
        var check = function() {
            var problem = '';
            if (hasArt) {
                problem = P.validateNk({ to: self.field('nkTo'), from: self.field('nkFrom'), available: (stock[it.art] || 0) - ownNk });
                if (problem) return problem;
            }
            problem = P.validatePack({ qty: self.field('qty'), suggested: suggested, nkFrom: P.num(self.field('nkFrom')), note: self.field('note') });
            if (problem) return problem;
            if (!self.field('size') && manual.length) return 'Выберите короб';
            return '';
        };
        setTimeout(updatePlan, 0);
        return this.dialog(html, wasDone ? 'Записать исправление' : 'Упаковано', check).then(function(ok) {
            self.root.removeEventListener('input', onInput);
            self.root.removeEventListener('change', onInput);
            if (!ok) return;
            var z = manual.filter(function(x) { return x.id === self.field('size'); })[0];
            var qty = Math.floor(P.num(self.field('qty')));
            var data = { qty: qty, sizeId: z ? z.id : '', box: z ? z.box : '', boxes: z ? P.packPlan(z, qty).boxes : 0,
                nk: hasArt ? nkOf() : null, note: self.field('note') };
            return self.writePack(it, data, wasDone);
        });
    };

    AtexLabelPacker.prototype.writePack = function(it, data, wasDone) {
        var self = this, s = this.state, t = s.tables;
        var place = this.place();
        var placeId = place && /^\d+$/.test(place.id) ? place.id : '';
        this.busy = true;
        var gpDone = false;
        return this.client.post('_m_set/' + encodeURIComponent(it.gpId) + '?JSON', P.gpFields(t.gp, {
            qty: data.qty, sizeId: data.sizeId, nk: data.nk, note: data.note, placeId: placeId
        })).then(function() {
            gpDone = true;
            if (!s.packTypeId || !t.event.reqs.type) return null;
            return self.client.serverNow().then(function(now) {
                var fields = P.eventFields(t.event, {
                    now: now, typeId: s.packTypeId, userId: self.userId, jobId: it.jobId, qty: data.qty,
                    box: data.box, boxes: data.boxes, nk: data.nk, place: place ? place.label : '',
                    note: (wasDone ? 'исправление; ' : '') + (data.note || '')
                });
                return self.client.post('_m_new/' + t.event.id + '?JSON&up=1', fields);
            });
        }).then(function() {
            self.message('Упаковано: ' + it.name + ' — ' + data.qty + ' рул.', 'ok');
        }).catch(function(err) {
            console.error('[label-packer] ❌', err);
            self.message(gpDone
                ? 'Партия записана, а событие в журнал — нет: ' + err.message
                : 'Не записано: ' + err.message, 'error');
        }).then(function() { return self.reload(); }).then(function() { self.busy = false; });
    };

    return { AtexLabelPacker: AtexLabelPacker, Client: Client };
});
