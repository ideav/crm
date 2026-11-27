/* B2B-портал дилера: общий слой рабочих мест (данные, запись, модель, текущий дилер, компоненты). Расчёты - в dealer-core.js. */
(function () {
    'use strict';
    var C = window.DealerCore;
    var P = window.Dealer = { core: C };
    var host = document.getElementById('dealer-app');
    var ds = host ? host.dataset : {};
    P.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };
    P.TODAY = '2026-11-26'; /* дата демо */

    P.dec = function (s) { return typeof s === 'string' ? s.replace(/&comma;/g, ',') : s; };
    P.esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    P.url = function (p) { return '/' + P.ctx.db + '/' + p; };
    P.get = function (p) {
        return fetch(P.url(p), { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + p);
            return r.json();
        });
    };
    /* POST с XSRF; вложенные объекты уходят JSON-строкой. */
    P.post = function (p, fields) {
        var fd = new FormData();
        fd.append('_xsrf', P.ctx.xsrf);
        Object.keys(fields || {}).forEach(function (k) { var v = fields[k]; fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v); });
        return fetch(P.url(p), { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) { return r.text(); })
            .then(function (t) {
                var j; try { j = JSON.parse(t); } catch (e) { throw new Error(t.slice(0, 200) || 'Нет ответа сервера'); }
                var e1 = Array.isArray(j) ? j[0] : j; if (e1 && e1.error) throw new Error(e1.error);
                if (j && j.results) j.results.forEach(function (x) { if (x.ok === false) throw new Error(x.error || 'Операция пакета не выполнена'); });
                return j;
            });
    };
    var metaP = null;
    P.meta = function () { return metaP || (metaP = P.get('metadata?JSON=1').then(function (m) { var by = {}; m.forEach(function (t) { by[t.val] = t; }); P.metaBy = by; return by; })); };
    P.tid = function (name) { return P.metaBy[name] && P.metaBy[name].id; };
    P.canWrite = function (name) { return !!(P.metaBy[name] && P.metaBy[name].granted === 'WRITE'); };
    P.canRead = function (name) { var g = P.metaBy[name] && P.metaBy[name].granted; return g === 'READ' || g === 'WRITE'; };

    function norm(o) {
        var r = { _id: String(o.id), _up: String(o.up), _ref: {} };
        Object.keys(o).forEach(function (k) {
            if (k === 'id' || k === 'up' || k === 'ord') return;
            var v = o[k];
            if (Array.isArray(v)) { r[k] = v.map(function (x) { return P.dec(x.val); }); return; }
            if (v && typeof v === 'object') { if (v.id !== undefined) { r[k] = P.dec(v.val); r._ref[k] = String(v.id); } return; }
            r[k] = v === null ? '' : P.dec(v);
        });
        return r;
    }
    P.rows = function (name, extra) {
        if (!P.canRead(name)) return Promise.resolve(null);
        return P.get('object/' + P.tid(name) + '/?JSON_OBJ&NAMED&LIMIT=0,2000' + (extra || '')).then(function (j) { return Array.isArray(j) ? j.map(norm) : null; }).catch(function () { return null; });
    };
    P.lines = function (orderId) { return P.rows('Строка заказа', '&F_U=' + orderId).then(function (r) { return (r || []).map(function (x) { return { id: x._id, product: x['Товар'], qty: C.num(x['Количество']), price: C.num(x['Цена в заказе']), base: C.num(x['Базовая цена']), rule: x['Правило цены'] }; }); }); };
    P.map = function (rows, key) { var m = {}; (rows || []).forEach(function (r) { m[r[key]] = r; }); return m; };
    P.num = C.num;
    P.money = function (x) { var n = Math.round(C.num(x)); return (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; };
    P.int = function (x) { return String(Math.round(C.num(x))).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); };
    P.pct = function (x) { return x === null || x === undefined ? '-' : String(x).replace('.', ',') + '%'; };
    P.dmy = function (s) { return C.toDmy(s); };
    /* ---------- модель: все таблицы одним слоем ---------- */
    var modelP = null;
    P.model = function () {
        if (modelP) return modelP;
        var names = ['Склад', 'Товарная группа', 'Товар', 'Остаток', 'Уровень дилера', 'Дилер', 'Условие цены', 'Заказ дилера', 'Счёт дилеру', 'Отгрузка', 'Согласование', 'Отчёт дилера', 'Правило портала'];
        modelP = Promise.all(names.map(function (n) { return P.rows(n); })).then(function (r) {
            var M = { today: P.TODAY };
            M.whs = (r[0] || []).map(function (x) { return x['Склад']; }); M.whCode = {}; (r[0] || []).forEach(function (x) { M.whCode[x['Склад']] = x['Код склада'] || x['Склад']; });
            M.groups = (r[1] || []).sort(function (a, b) { return C.num(a['Порядок группы']) - C.num(b['Порядок группы']); }).map(function (x) { return x['Товарная группа']; });
            M.products = (r[2] || []).map(function (x) { return { id: x._id, name: x['Товар'], art: x['Артикул'], group: x['Товарная группа'], unit: x['Ед. изм.'], pack: C.num(x['Кратность']) || 1, base: C.num(x['Базовая цена']), cost: x['Себестоимость'] === undefined ? null : C.num(x['Себестоимость']) }; });
            M.canCost = M.products.length > 0 && M.products[0].cost !== null;
            M.prodBy = P.map(M.products, 'name');
            M.stocks = (r[3] || []).map(function (x) { return { id: x._id, product: x['Товар'], wh: x['Склад'], qty: C.num(x['В наличии']), reserve: C.num(x['В резерве']) }; });
            M.levels = {}; (r[4] || []).forEach(function (x) { M.levels[x['Уровень дилера']] = C.num(x['Скидка уровня']); });
            M.dealers = (r[5] || []).map(function (x) {
                return { id: x._id, name: x['Дилер'], inn: x['ИНН'], city: x['Город дилера'], level: x['Уровень дилера'], limit: x['Кредитный лимит'] === undefined ? null : C.num(x['Кредитный лимит']), delay: C.num(x['Отсрочка, дней']), wh: x['Склад'], groups: x['Группы каталога'] || [], mgr: x['Менеджер дилера'], login: x['Логин закупщика'] };
            });
            M.dealerBy = P.map(M.dealers, 'name'); M.dealerById = P.map(M.dealers, 'id');
            M.conds = (r[6] || []).map(function (x) { return { id: x._id, dealer: x['Дилер'], kind: x['Вид условия'], group: x['Товарная группа'], product: x['Товар'], pct: C.num(x['Скидка условия']), price: C.num(x['Спеццена']), until: C.toIso(x['Действует по']), approve: !!x['Согласовать цену'] && x['Согласовать цену'] !== '0' }; });
            M.orders = (r[7] || []).map(function (x) {
                return { id: x._id, no: x['Заказ дилера'], dealer: x['Дилер'], date: C.toIso(x['Дата заказа']), wh: x['Склад'], status: x['Статус заказа'], sum: C.num(x['Сумма заказа']), author: x['Автор заказа'], reason: x['Причина согласования'], details: x['Детали согласования'] || '', comment: x['Комментарий заказа'] || '' };
            }).sort(function (a, b) { return a.date === b.date ? (a.no < b.no ? 1 : -1) : a.date < b.date ? 1 : -1; });
            M.orderById = P.map(M.orders, 'id'); M.orderByNo = P.map(M.orders, 'no');
            M.invoices = (r[8] || []).map(function (x) { return { id: x._id, no: x['Счёт дилеру'], dealer: x['Дилер'], order: x['Заказ дилера'], date: C.toIso(x['Дата счёта']), sum: C.num(x['Сумма счёта']), due: C.toIso(x['Срок оплаты']), paid: C.num(x['Оплачено']) }; });
            M.canInvoices = !!r[8];
            M.ships = (r[9] || []).map(function (x) { return { id: x._id, no: x['Отгрузка'], order: x['Заказ дилера'], dealer: x['Дилер'], wh: x['Склад'], date: C.toIso(x['Дата отгрузки']), ttn: x['Номер ТТН'], car: x['Перевозчик'], st: x['Статус доставки'] }; });
            M.approvals = (r[10] || []).map(function (x) { return { id: x._id, no: x['Согласование'], order: x['Заказ дилера'], reason: x['Причина согласования'], detail: x['Детали согласования'], amount: C.num(x['Сумма к согласованию']), decision: x['Решение'], who: x['Согласовал'], date: C.toIso(x['Дата решения']) }; });
            M.reports = (r[11] || []).map(function (x) { return { id: x._id, dealer: x['Дилер'], period: x['Период отчёта'], product: x['Товар'], sold: C.num(x['Продано']), stock: C.num(x['Остаток у дилера']) }; });
            var rv = {}; (r[12] || []).forEach(function (x) { rv[x['Правило портала']] = x['Значение правила']; });
            M.rules = C.parseRules(rv);
            M.isDealer = M.dealers.length === 1 && !P.canWrite('Согласование') && !P.canRead('Согласование');
            P.cur = M;
            return M;
        });
        return modelP;
    };
    P.resetModel = function () { modelP = null; };

    /* ---------- текущий дилер: у закупщика свой, у сотрудников - выбор (переключение дилера) ---------- */
    P.hash = function () { var o = {}; location.hash.replace(/^#/, '').split('&').forEach(function (p) { var a = p.split('='); if (a[0]) o[a[0]] = decodeURIComponent(a[1] || ''); }); return o; };
    P.setHash = function (o) { var s = Object.keys(o).filter(function (k) { return o[k] !== '' && o[k] !== undefined; }).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&'); history.replaceState(null, '', '#' + s); };
    P.dealer = function (M) {
        if (M.dealers.length === 1) return M.dealers[0];
        var h = P.hash(), d = h.d && M.dealerById[h.d];
        if (!d) { try { d = M.dealerById[localStorage.getItem('dealer-cur')]; } catch (e) { d = null; } }
        return d || M.dealers[0];
    };
    P.pickDealer = function (M, d, onpick) {
        if (M.dealers.length < 2) return null;
        var s = P.select(M.dealers.map(function (x) { return [x.id, x.name + ' (' + x.city + ', ' + x.level + ')']; }), d.id);
        s.addEventListener('change', function () { try { localStorage.setItem('dealer-cur', s.value); } catch (e) { /* без хранилища */ } var h = P.hash(); h.d = s.value; P.setHash(h); onpick(M.dealerById[s.value]); });
        return P.el('label', { 'class': 'dl-pick' }, [P.el('span', { text: 'Дилер:' }), s]);
    };
    /* Цена товара для дилера и сводка дилера (долг, лимит) - общие для экранов. */
    P.price = function (M, d, p) { return C.priceFor(p, d, M.conds, M.levels[d.level] || 0, M.today); };
    P.dealerState = function (M, d) {
        var debt = C.debtSummary(M.invoices, d.name, M.today), open = C.openOrdersSum(M.orders, d.name);
        return { debt: debt, open: open, limit: d.limit === null ? null : C.limitState(d, debt.debt, open) };
    };
    P.statusKind = function (s) { return { 'Черновик': 'muted', 'На согласовании': 'warn', 'Подтверждён': 'info', 'Собирается': 'info', 'Отгружен': 'ok', 'Доставлен': 'ok', 'Отклонён': 'bad' }[s] || 'info'; };
    /* ---------- DOM ---------- */
    P.el = function (tag, attrs, kids) {
        var e = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) {
            if (k === 'text') e.textContent = attrs[k];
            else if (k === 'html') e.innerHTML = attrs[k];
            else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
            else if (attrs[k] !== false && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
        });
        [].concat(kids || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
        return e;
    };
    P.btn = function (text, fn, cls) { return P.el('button', { type: 'button', 'class': 'dl-btn ' + (cls || ''), onclick: fn, text: text }); };
    P.toast = function (msg, bad) {
        var t = P.el('div', { 'class': 'dl-toast' + (bad ? ' dl-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 3000);
    };
    /* Модальное окно (не alert/confirm/prompt). buttons: [{text, fn(close) -> false оставляет окно, cls}] */
    P.modal = function (title, body, buttons, wide) {
        var back = P.el('div', { 'class': 'dl-modal-back' });
        function close() { back.remove(); }
        var foot = P.el('div', { 'class': 'dl-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            return P.btn(b.text, function () { if (!b.fn || b.fn(close) !== false) close(); }, b.cls);
        }));
        var box = P.el('div', { 'class': 'dl-modal' + (wide ? ' dl-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [P.el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box, foot: foot };
    };
    P.field = function (label, input, hint) { return P.el('label', { 'class': 'dl-field' }, [P.el('span', { text: label }), input, hint ? P.el('small', { text: hint }) : null]); };
    P.select = function (opts, value) {
        var s = P.el('select', {}, opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return P.el('option', { value: v, text: t }); }));
        s.value = value === undefined ? '' : value; return s;
    };
    P.input = function (type, value, attrs) { var i = P.el('input', Object.assign({ type: type }, attrs || {})); i.value = value === undefined ? '' : value; return i; };
    P.badge = function (text, kind) { return '<span class="dl-badge dl-' + (kind || 'info') + '">' + P.esc(text) + '</span>'; };
    P.tabs = function (items, active, onpick) {
        return P.el('div', { 'class': 'dl-tabs', role: 'tablist' }, items.map(function (it) {
            return P.el('button', { type: 'button', role: 'tab', 'class': 'dl-tab' + (it[0] === active ? ' dl-tab-on' : ''), 'aria-selected': it[0] === active ? 'true' : 'false', onclick: function () { onpick(it[0]); }, text: it[1] });
        }));
    };
    /* Таблица: cols = [{k, t, num, cls(r), html(r)}] */
    P.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = P.el('thead', {}, [P.el('tr', {}, cols.map(function (c) { return P.el('th', { text: c.t, 'class': c.num ? 'dl-num' : '' }); }))]);
        var tbody = P.el('tbody', {}, rows.map(function (r) {
            return P.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' dl-click' : ''), onclick: opts.onrow ? function (ev) { if (!/INPUT|SELECT|BUTTON/.test(ev.target.tagName)) opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = P.el('td', { 'class': (c.num ? 'dl-num ' : '') + (c.cls ? c.cls(r) : '') });
                    if (c.node) td.appendChild(c.node(r)); else if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k];
                    return td;
                }));
        }));
        if (!rows.length) tbody.appendChild(P.el('tr', {}, [P.el('td', { colspan: cols.length, 'class': 'dl-empty', text: opts.empty || 'Нет данных' })]));
        return P.el('div', { 'class': 'dl-tablewrap' }, [P.el('table', { 'class': 'dl-table' }, [thead, tbody])]);
    };
    P.kpi = function (label, value, sub, kind) {
        return P.el('div', { 'class': 'dl-kpi' + (kind ? ' dl-kpi-' + kind : '') }, [P.el('div', { 'class': 'dl-kpi-v', html: value }), P.el('div', { 'class': 'dl-kpi-l', text: label }), sub ? P.el('div', { 'class': 'dl-kpi-s', text: sub }) : null]);
    };
    P.note = function (text, kind) { return P.el('div', { 'class': 'dl-note dl-note-' + (kind || 'info'), text: text }); };
    P.limitBar = function (st, extra) {
        if (!st) return null;
        var used = Math.min(100, st.limit > 0 ? st.used / st.limit * 100 : 0), add = Math.max(0, Math.min(100 - used, st.limit > 0 ? (extra || 0) / st.limit * 100 : 0)), over = st.used + (extra || 0) > st.limit;
        return P.el('div', { 'class': 'dl-bar' + (over ? ' dl-bar-over' : ''), title: 'Занято ' + P.money(st.used) + ' из ' + P.money(st.limit) }, [P.el('i', { style: 'width:' + used.toFixed(1) + '%' }), P.el('b', { style: 'width:' + add.toFixed(1) + '%' })]);
    };
    P.section = function (title, kids) { return P.el('section', { 'class': 'dl-card' }, [P.el('h2', { text: title })].concat(kids)); };
    P.head = function (title, sub, right) { return P.el('div', { 'class': 'dl-head' }, [P.el('div', {}, [P.el('h1', { text: title }), sub ? P.el('p', { 'class': 'dl-sub', text: sub }) : null]), right || null]); };
    P.fail = function (e) { host.innerHTML = ''; host.appendChild(P.el('div', { 'class': 'dl-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    P.mount = function (fn) {
        if (!host) return;
        host.textContent = 'Загрузка...';
        P.meta().then(function () { return P.model(); }).then(function (M) { host.innerHTML = ''; return fn(host, M); }).catch(P.fail);
    };
    P.remount = function (fn) { P.resetModel(); P.mount(fn); };
    P.go = function (screen, hash) { location.href = P.url(screen) + (hash ? '#' + hash : ''); };
    /* Запись по именам полей. */
    P.create = function (table, fields, up) { return P.post('_m_new/' + P.tid(table) + '?JSON', { up: up || 1, fields: fields }).then(function (r) { if (r && r.warning) throw new Error(r.warning + ': ' + (r.val || '')); return r; }); };
    P.update = function (id, fields) { return P.post('_m_set/' + id + '?JSON', { fields: fields }); };
    P.batch = function (ops) { return P.post('_m_batch?JSON', { ops: ops }); };
    P.newId = function (r) { var e = Array.isArray(r) ? r[0] : r; return e && (e.obj || e.id); };
})();
