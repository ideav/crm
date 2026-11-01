// Рабочее место atex «Импорт из 1С» (роли Администратор, Диспетчер; ideav/crm#5308).
//
// Две вкладки — выгрузки 1С в .xlsx:
//   - «Заказы этикетки» — «Выгруженные заказы этикетка.xlsx»: заказ = «Заказ клиента», позиция =
//     пара «Заказ клиента» + артикул (вид продукции «этикетка»);
//   - «База ножей» — книга с листом «Ножи» (номер ножа — ключ) и, если есть, листом «План»:
//     пробег ножа — колонка «Пробег» листа «Ножи», а пустая — «Суммарный пробег ножа» листа «План».
// Файл читается SheetJS (/js/xlsx0.18.5.full.min.js) в браузере, сверка и план — модуль
// label-import-core.js. Предпросмотр: новые / обновятся / без изменений и дубли / ошибки строк;
// запись — только по «Записать» → «Подтвердить», пакетами _m_batch. После записи план
// пересчитывается по базе: повторный импорт того же файла показывает 0 новых.

(function(root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') {
        window.AtexLabelImportApp = api;
        var start = function() {
            var el = document.getElementById('atex-limp-app');
            if (el && !el.__atexLimp) el.__atexLimp = new api.AtexLabelImport(el).start();
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
        else start();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
    'use strict';

    var LI = (root && root.AtexLabelImport) ||
        (typeof require === 'function' ? require('./label-import-core.js') : null);

    var RUNS_REPORT = 'die_runs';
    var CONCURRENCY = 5;        // ТЗ atex §15: не больше 5 запросов разом
    var BATCH_SIZE = 500;       // предел ядра — 1000 операций и 300 с на пакет

    var STATUS = {
        new: { label: 'создать', cls: 'is-new' },
        update: { label: 'обновить', cls: 'is-update' },
        same: { label: 'без изменений', cls: 'is-same' },
        duplicate: { label: 'дубль — пропуск', cls: 'is-same' },
        error: { label: 'ошибка — не пишется', cls: 'is-error' }
    };

    var HINTS = {
        orders: 'Выгрузка «Выгруженные заказы этикетка» (.xlsx). Ключ сверки — «Заказ клиента» + артикул: ' +
            'существующая позиция обновляется, новая создаётся в заказе. Примечание и статус позиции пишутся только при создании. ' +
            'Сырьё подбирается по обозначению в номенклатуре («П/Гл», «П/П») и клею, срок = дата поступления + ' + LI.DUE_DAYS_DEFAULT +
            ' дн. (настройка ' + LI.DUE_DAYS_KEY + '); у существующей позиции они заполняются, только если пусты.',
        knives: 'Книга с листом «Ножи» (и «План» — оттуда берётся «Суммарный пробег ножа»). Ключ — «Номер ножа». ' +
            'Пробег пишется одной записью «начальный остаток»: повторный импорт её перезаписывает, вырубку не трогает. ' +
            'Пустое значение в файле поле не стирает; состояние ножа пишется только при создании.'
    };

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // Пул: не больше `limit` запросов разом.
    function pool(items, limit, fn) {
        var out = new Array(items.length), i = 0;
        function next() {
            if (i >= items.length) return Promise.resolve();
            var k = i++;
            return Promise.resolve(fn(items[k], k)).then(function(r) { out[k] = r; return next(); });
        }
        var workers = [];
        for (var w = 0; w < Math.min(limit, items.length); w++) workers.push(next());
        return Promise.all(workers).then(function() { return out; });
    }

    // Индикатор загрузки предпросмотра: полоса со счётчиком секунд (чтение базы ножей занимает 7-10 с).
    function loadingHtml(text, seconds) {
        return '<span class="atex-limp-spinner" aria-hidden="true"></span>' + esc(text) + (seconds > 0 ? ' · ' + seconds + ' с' : '');
    }

    // Предупреждения по типам: раскрываемый список со счётчиком (до `limit` строк в каждом типе).
    function warningGroupsHtml(rows, limit) {
        var groups = LI.groupWarnings(rows);
        if (!groups.length) return '';
        var max = limit || 100;
        return '<div class="atex-limp-groups"><div class="atex-limp-groups-title">Предупреждения по типам (' + groups.length + ')</div>' +
            groups.map(function(g) {
                return '<details class="atex-limp-group"><summary><b>' + g.count + '</b> × ' + esc(g.type) + '</summary><ul>' +
                    g.rows.slice(0, max).map(function(x) { return '<li>строка ' + x.row + (x.key ? ' (' + esc(x.key) + ')' : '') + ': ' + esc(x.text) + '</li>'; }).join('') +
                    (g.rows.length > max ? '<li>… и ещё ' + (g.rows.length - max) + '</li>' : '') + '</ul></details>';
            }).join('') + '</div>';
    }

    function sheetGrid(XLSX, wb, name) {
        var ws = wb.Sheets[name];
        return ws ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) : null;
    }

    function findSheet(wb, name) {
        var want = String(name).trim().toLowerCase();
        return wb.SheetNames.filter(function(n) { return String(n).trim().toLowerCase() === want; })[0] || null;
    }

    function AtexLabelImport(rootEl) {
        this.root = rootEl;
        this.db = rootEl.getAttribute('data-db') || '';
        this.tab = 'orders';
        this.tables = null;
        this.resolved = null;
        this.parsed = { orders: null, knives: null };
        this.files = { orders: '', knives: '' };
        this.plan = { orders: null, knives: null };
        this.filter = '';
        this.busy = false;
        this.loading = '';
        this.loadingSince = 0;
        this.loadingTimer = null;
    }

    // Начать/закончить показ индикатора загрузки в таблице предпросмотра.
    AtexLabelImport.prototype.setLoading = function(text) {
        var self = this;
        this.loading = text || '';
        this.loadingSince = text ? Date.now() : 0;
        if (this.loadingTimer) { clearInterval(this.loadingTimer); this.loadingTimer = null; }
        if (text) this.loadingTimer = setInterval(function() { self.renderLoading(); }, 500);
        this.render();
    };

    AtexLabelImport.prototype.renderLoading = function() {
        var el = this.$('atex-limp-loading');
        if (el && this.loading) el.innerHTML = loadingHtml(this.loading, Math.floor((Date.now() - this.loadingSince) / 1000));
    };

    AtexLabelImport.prototype.$ = function(id) { return document.getElementById(id); };
    AtexLabelImport.prototype.url = function(path) { return '/' + encodeURIComponent(this.db) + '/' + path; };

    AtexLabelImport.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            if (!resp.ok) throw new Error(path + ': HTTP ' + resp.status);
            return resp.json();
        });
    };

    AtexLabelImport.prototype.post = function(path, params) {
        var body = new URLSearchParams();
        body.set('_xsrf', (typeof window !== 'undefined' && window.xsrf) || this.root.getAttribute('data-xsrf') || '');
        Object.keys(params || {}).forEach(function(k) { body.set(k, params[k]); });
        return fetch(this.url(path), {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        }).then(function(resp) {
            return resp.text().then(function(text) {
                var result;
                try { result = JSON.parse(text); } catch (e) { throw new Error('Сервер вернул не JSON (HTTP ' + resp.status + '): ' + text.slice(0, 160)); }
                if (Array.isArray(result) && result[0] && result[0].error) throw new Error(result[0].error);
                if (result && result.error) throw new Error(result.error);
                return result;
            });
        });
    };

    // Пакет _m_batch. ?JSON=1 в адресе обязателен: без него ядро ideav.ru при авторизации
    // cookie/заголовком отдаёт HTML главной страницы (ideav/crm#5335).
    AtexLabelImport.prototype.sendBatch = function(ops) {
        return this.post('_m_batch?JSON=1', { ops: JSON.stringify(ops) });
    };

    AtexLabelImport.prototype.message = function(text, kind) {
        var el = this.$('atex-limp-message');
        if (!el) return;
        el.hidden = !text;
        el.className = 'atex-limp-message' + (kind ? ' is-' + kind : '');
        el.textContent = text || '';
    };

    AtexLabelImport.prototype.progress = function(done, total, text) {
        var el = this.$('atex-limp-progress');
        if (!el) return;
        el.hidden = total == null;
        if (total == null) return;
        el.querySelector('.atex-limp-progress-bar').style.width = (total ? Math.round(done / total * 100) : 0) + '%';
        el.querySelector('span').textContent = text || '';
    };

    AtexLabelImport.prototype.start = function() {
        var self = this;
        this.root.addEventListener('click', function(e) {
            var tab = e.target.closest('[data-tab]');
            if (tab) return self.showTab(tab.getAttribute('data-tab'));
            var f = e.target.closest('[data-filter]');
            if (f) { self.filter = self.filter === f.getAttribute('data-filter') ? '' : f.getAttribute('data-filter'); return self.render(); }
        });
        this.$('atex-limp-file').addEventListener('change', function(e) {
            var file = e.target.files && e.target.files[0];
            e.target.value = '';
            if (file) self.loadFile(file);
        });
        this.$('atex-limp-write').addEventListener('click', function() { self.write(); });
        this.getJson('metadata').then(function(meta) {
            self.resolved = LI.resolveImportTables(meta);
            self.tables = self.resolved.tables;
            self.render();
        }).catch(function(err) {
            console.error('[label-import] ❌', err);
            self.message('Рабочее место не загрузилось: ' + err.message, 'error');
        });
        this.render();
        return this;
    };

    AtexLabelImport.prototype.showTab = function(tab) {
        if (this.busy) return;
        this.tab = tab;
        this.filter = '';
        var nodes = this.root.querySelectorAll('[data-tab]');
        for (var i = 0; i < nodes.length; i++) nodes[i].classList.toggle('is-active', nodes[i].getAttribute('data-tab') === tab);
        this.message('');
        this.render();
    };

    AtexLabelImport.prototype.withXlsx = function() {
        if (root.XLSX) return Promise.resolve(root.XLSX);
        return new Promise(function(resolve, reject) {
            var s = document.createElement('script');
            s.src = '/js/xlsx0.18.5.full.min.js';
            s.onload = function() { resolve(root.XLSX); };
            s.onerror = function() { reject(new Error('не загрузилась библиотека чтения xlsx')); };
            document.head.appendChild(s);
        });
    };

    AtexLabelImport.prototype.loadFile = function(file) {
        var self = this, tab = this.tab;
        if (this.busy) return;
        this.message('Читаю «' + file.name + '»…');
        this.plan[tab] = null;
        this.setLoading('Читаю «' + file.name + '»');
        return Promise.all([this.withXlsx(), file.arrayBuffer()]).then(function(r) {
            var XLSX = r[0];
            var wb = XLSX.read(new Uint8Array(r[1]), { type: 'array' });
            var parsed;
            if (tab === 'knives') {
                var sheet = findSheet(wb, 'Ножи');
                if (!sheet) throw new Error('в книге нет листа «Ножи» (листы: ' + wb.SheetNames.join(', ') + ')');
                var plan = findSheet(wb, 'План');
                parsed = LI.parseKnifeSheet(sheetGrid(XLSX, wb, sheet), plan ? sheetGrid(XLSX, wb, plan) : null);
                parsed.planSheet = !!plan;
            } else {
                parsed = null;
                for (var i = 0; i < wb.SheetNames.length && !(parsed && parsed.ok); i++) parsed = LI.parseOrderSheet(sheetGrid(XLSX, wb, wb.SheetNames[i]));
            }
            if (!parsed.ok) throw new Error(parsed.error);
            self.parsed[tab] = parsed;
            self.files[tab] = file.name;
            self.setLoading('Сверяю с базой' + (tab === 'knives' ? ' (база ножей — до 10 с)' : ''));
            return self.replan(tab);
        }).catch(function(err) {
            console.error('[label-import] ❌', err);
            self.message('Файл не разобран: ' + err.message, 'error');
        }).then(function() { self.setLoading(''); });
    };

    AtexLabelImport.prototype.checkTables = function(tab) {
        if (!this.resolved) throw new Error('метаданные базы ещё не загружены');
        var lost = LI.missingFor(this.resolved, tab);
        if (lost.length) throw new Error('в базе нет: ' + lost.join('; '));
    };

    // Сверка с базой: читает, что нужно для ключей файла, и строит план.
    AtexLabelImport.prototype.replan = function(tab) {
        var self = this;
        this.checkTables(tab);
        this.message('Сверяю с базой…');
        var t0 = Date.now();
        var load = tab === 'knives' ? this.loadKnifeContext() : this.loadOrderContext(this.parsed.orders);
        return load.then(function(ctx) {
            var plan = tab === 'knives' ? LI.planKnives(self.parsed.knives, ctx, {}) : LI.planOrders(self.parsed.orders, ctx, {});
            self.plan[tab] = plan;
            self.message('Сверено за ' + ((Date.now() - t0) / 1000).toFixed(1) + ' с. Проверьте предпросмотр и нажмите «Записать».');
            self.render();
            return plan;
        });
    };

    AtexLabelImport.prototype.objects = function(key, extra) {
        return this.getJson('object/' + this.tables[key].id + '/?JSON_KV&LIMIT=0,100000' + (extra || '')).then(LI.kvRecords);
    };

    AtexLabelImport.prototype.loadKnifeContext = function() {
        var self = this;
        return Promise.all([
            this.objects('die'), this.getJson('report/' + RUNS_REPORT + '?JSON_KV&LIMIT=0,1000000'),
            this.objects('cylinder'), this.objects('base'), this.objects('brand'), this.objects('state'), this.objects('runKind')
        ]).then(function(r) {
            var runs = Array.isArray(r[1]) ? r[1] : [];
            var runsCol = self.tables.die.reqs && self.tables.dieRun ? self.tables.dieRun.id : '';
            var withRuns = r[0].filter(function(d) { return Number(d.reqs[runsCol]) > 0; }).length;
            if (!runs.length && withRuns) {
                throw new Error('отчёт «' + RUNS_REPORT + '» вернул 0 движений, а у ' + withRuns + ' ножей они есть — повторный импорт задвоил бы пробег');
            }
            return LI.knifeContext(self.tables, {
                dies: r[0], runs: runs, cylinders: r[2], bases: r[3], brands: r[4], states: r[5], runKinds: r[6]
            });
        });
    };

    AtexLabelImport.prototype.loadOrderContext = function(parsed) {
        var self = this;
        var opt = function(key) { return self.tables[key] ? self.objects(key) : Promise.resolve([]); };
        return Promise.all([
            this.objects('order'), this.objects('client'), this.objects('article'), this.objects('productKind'),
            opt('orderStatus'), opt('positionStatus'), opt('core'), opt('unit'), opt('material'), opt('setting')
        ]).then(function(r) {
            var numbers = {};
            (parsed.items || []).forEach(function(i) { numbers[i.order] = true; });
            var hit = r[0].filter(function(o) { return numbers[String(o.val).trim()]; });
            return pool(hit, CONCURRENCY, function(o) { return self.objects('position', '&F_U=' + encodeURIComponent(o.id)); }).then(function(lists) {
                var positions = [];
                lists.forEach(function(list, i) { (list || []).forEach(function(p) { p.up = hit[i].id; positions.push(p); }); });
                return LI.orderContext(self.tables, {
                    orders: r[0], positions: positions, clients: r[1], articles: r[2], productKinds: r[3],
                    orderStatuses: r[4], positionStatuses: r[5], cores: r[6], units: r[7], materials: r[8], settings: r[9], db: self.db
                });
            });
        });
    };

    AtexLabelImport.prototype.confirm = function(text) {
        var modal = this.$('atex-limp-modal'), ok = this.$('atex-limp-modal-ok'), cancel = this.$('atex-limp-modal-cancel');
        this.$('atex-limp-modal-text').textContent = text;
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

    AtexLabelImport.prototype.write = function() {
        var self = this, tab = this.tab, plan = this.plan[tab];
        if (this.busy || !plan || !plan.ops.length) return;
        var c = plan.counts;
        var what = tab === 'knives' ? 'ножей' : 'позиций';
        var text = 'Записать в базу «' + this.db + '»: создать ' + c.new + ' ' + what + ', обновить ' + c.update +
            (tab === 'orders' ? ' (новых заказов ' + c.ordersNew + ')' : '') + '. Операций: ' + plan.ops.length +
            '. Строки с ошибками (' + c.error + ') и дубли (' + c.duplicate + ') не пишутся.';
        return this.confirm(text).then(function(yes) {
            if (!yes) return;
            self.busy = true;
            self.render();
            self.progress(0, plan.ops.length, 'Запись…');
            return LI.runBatches(plan.ops, function(ops) { return self.sendBatch(ops); }, {
                batchSize: BATCH_SIZE,
                onProgress: function(p) { self.progress(p.done, p.total, 'Пакет ' + p.batch + ' из ' + p.batches + ': ' + p.done + ' / ' + p.total + ' операций'); }
            }).then(function(res) {
                var sec = (res.ms / 1000).toFixed(1);
                console.log('[label-import] ✅ запись ' + tab + ': ' + plan.ops.length + ' операций, ' + res.batches + ' пакетов, ' + sec + ' с, ошибок ' + res.failed.length);
                if (res.failed.length) console.error('[label-import] ❌ не записано', res.failed);
                return self.replan(tab).then(function(after) {
                    var a = after.counts;
                    self.message('Записано за ' + sec + ' с (' + res.batches + ' пакет.)' +
                        (res.failed.length ? '; не записано операций: ' + res.failed.length + ' — первая: ' + res.failed[0].error : '') +
                        '. Повторная сверка: новых ' + a.new + ', обновится ' + a.update + ', без изменений ' + a.same + '.',
                        res.failed.length ? 'error' : 'ok');
                });
            });
        }).catch(function(err) {
            console.error('[label-import] ❌', err);
            self.message('Запись прервана: ' + err.message + '. Перечитайте файл — сверка покажет, что уже записано.', 'error');
        }).then(function() {
            self.busy = false;
            self.progress(0, null);
            self.render();
        });
    };

    AtexLabelImport.prototype.render = function() {
        var tab = this.tab, plan = this.plan[tab], parsed = this.parsed[tab];
        this.$('atex-limp-hint').textContent = HINTS[tab];
        this.$('atex-limp-file-name').textContent = this.files[tab] ? this.files[tab] : '';
        var btn = this.$('atex-limp-write');
        btn.disabled = this.busy || !plan || !plan.ops.length;
        btn.querySelector('span').textContent = plan && plan.ops.length ? 'Записать (' + plan.ops.length + ' операций)' : 'Записать';

        var kpi = this.$('atex-limp-kpi');
        if (!plan) { kpi.innerHTML = ''; }
        else {
            var c = plan.counts, f = this.filter;
            var tile = function(key, label, n, cls) {
                return '<button type="button" class="atex-limp-tile ' + (cls || '') + (f === key ? ' is-active' : '') + '" data-filter="' + key + '">' +
                    '<b>' + n + '</b><span>' + esc(label) + '</span></button>';
            };
            var html = '';
            if (tab === 'orders') html += '<div class="atex-limp-tile is-static"><b>' + c.ordersNew + '</b><span>новых заказов</span></div>';
            html += tile('new', tab === 'orders' ? 'новых позиций' : 'новых ножей', c.new, 'is-new') +
                tile('update', 'обновится', c.update, 'is-update') +
                tile('skip', 'пропущено: без изменений и дубли', c.same + c.duplicate, 'is-same') +
                tile('error', 'ошибок строк — не пишутся', c.error, 'is-error') +
                tile('warn', 'с предупреждениями', c.warnings, 'is-warn');
            if (tab === 'knives' && parsed) {
                html += '<div class="atex-limp-tile is-static"><b>' + parsed.empty + '</b><span>пустых строк листа</span></div>';
                var withMileage = parsed.items.filter(function(i) { return i.mileage != null; }).length;
                html += '<div class="atex-limp-tile is-static"><b>' + withMileage + '</b><span>с пробегом' + (parsed.planSheet ? ' (лист «План»)' : '') + '</span></div>';
            }
            kpi.innerHTML = html;
        }

        var groupsEl = this.$('atex-limp-groups');
        if (groupsEl) groupsEl.innerHTML = plan ? warningGroupsHtml(plan.rows) : '';

        var body = this.$('atex-limp-rows');
        if (!plan && this.loading) {
            body.innerHTML = '<tr><td colspan="5" class="atex-limp-empty" id="atex-limp-loading">' +
                loadingHtml(this.loading, Math.floor((Date.now() - this.loadingSince) / 1000)) + '</td></tr>';
            return;
        }
        if (!plan) {
            body.innerHTML = '<tr><td colspan="5" class="atex-limp-empty">Выберите выгрузку 1С — здесь появится предпросмотр. Без «Записать» в базу ничего не пишется.</td></tr>';
            return;
        }
        var flt = this.filter;
        var rows = plan.rows.filter(function(r) {
            if (!flt) return true;
            if (flt === 'skip') return r.status === 'same' || r.status === 'duplicate';
            if (flt === 'warn') return r.warnings.length > 0;
            return r.status === flt;
        });
        var LIMIT = 1500;
        body.innerHTML = rows.slice(0, LIMIT).map(function(r) {
            var st = STATUS[r.status] || { label: r.status, cls: '' };
            var notes = [];
            r.changes.forEach(function(ch) { notes.push('<div class="atex-limp-change">' + esc(ch.field) + ': ' + esc(ch.from) + ' → <b>' + esc(ch.to) + '</b></div>'); });
            r.errors.forEach(function(e) { notes.push('<div class="atex-limp-err">' + esc(e) + '</div>'); });
            r.warnings.forEach(function(w) { notes.push('<div class="atex-limp-warn">' + esc(w) + '</div>'); });
            var summary = esc(r.summary || '');
            if (r.mileage != null) summary += (summary ? '; ' : '') + 'пробег ' + esc(r.mileage) + ' м' + (r.mileageSource ? ' (' + esc(r.mileageSource) + ')' : '');
            return '<tr><td>' + r.row + '</td><td>' + esc(r.key || '—') + '</td><td>' + summary + '</td>' +
                '<td><span class="atex-limp-badge ' + st.cls + '">' + esc(st.label) + '</span></td><td>' + notes.join('') + '</td></tr>';
        }).join('') + (rows.length > LIMIT ? '<tr><td colspan="5" class="atex-limp-empty">Показано ' + LIMIT + ' из ' + rows.length + ' — сузьте фильтром.</td></tr>' : '') +
            (!rows.length ? '<tr><td colspan="5" class="atex-limp-empty">Нет строк.</td></tr>' : '');
    };

    return { AtexLabelImport: AtexLabelImport, pool: pool, loadingHtml: loadingHtml, warningGroupsHtml: warningGroupsHtml };
});
