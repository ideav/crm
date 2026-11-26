/* BI-сводка: общий слой рабочих мест (данные, запись, окна, модель). Расчёты - в bisys-core.js. */
(function () {
    'use strict';
    var C = window.BisysCore;
    var B = window.Bisys = { core: C };
    var host = document.getElementById('bisys-app');
    var ds = host ? host.dataset : {};
    B.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };
    B.TODAY = '2026-11-26'; /* дата демо */

    B.dec = function (s) { return typeof s === 'string' ? s.replace(/&comma;/g, ',') : s; };
    B.esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    B.url = function (p) { return '/' + B.ctx.db + '/' + p; };
    B.get = function (p) {
        return fetch(B.url(p), { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + p);
            return r.json();
        });
    };
    /* POST с XSRF; вложенные объекты уходят JSON-строкой. */
    B.post = function (p, fields) {
        var fd = new FormData();
        fd.append('_xsrf', B.ctx.xsrf);
        Object.keys(fields || {}).forEach(function (k) { var v = fields[k]; fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v); });
        return fetch(B.url(p), { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (j) { var e = Array.isArray(j) ? j[0] : j; if (e && e.error) throw new Error(e.error); return j; });
    };
    var metaP = null;
    B.meta = function () { return metaP || (metaP = B.get('metadata?JSON=1').then(function (m) { var by = {}; m.forEach(function (t) { by[t.val] = t; }); B.metaBy = by; return by; })); };
    B.tid = function (name) { return B.metaBy[name] && B.metaBy[name].id; };
    B.canWrite = function (name) { return !!(B.metaBy[name] && B.metaBy[name].granted === 'WRITE'); };
    B.canRead = function (name) { return !!B.metaBy[name]; };

    function norm(o) {
        var r = { _id: String(o.id), _ref: {} };
        Object.keys(o).forEach(function (k) {
            if (k === 'id' || k === 'up' || k === 'ord') return;
            var v = o[k];
            if (v && typeof v === 'object') { if (v.id !== undefined) { r[k] = B.dec(v.val); r._ref[k] = String(v.id); } return; }
            r[k] = v === null ? '' : B.dec(v);
        });
        return r;
    }
    /* Таблица целиком: страницы по 250 строк читаются по 10 параллельно (NAMED на больших страницах заметно медленнее). Нет гранта — null; сбой чтения — ошибка на экране, а не пустые цифры. */
    B.rows = function (name, extra) {
        if (!B.canRead(name)) return Promise.resolve(null);
        var id = B.tid(name), out = [], PAGE = 250, PAR = 10;
        function batch(off) {
            var ps = [];
            for (var i = 0; i < PAR; i++) ps.push(B.get('object/' + id + '/?JSON_OBJ&NAMED' + (extra || '') + '&LIMIT=' + (off + i * PAGE) + ',' + PAGE));
            return Promise.all(ps).then(function (pages) {
                var done = false;
                pages.forEach(function (j) {
                    if (!Array.isArray(j)) throw new Error('Таблица «' + name + '» не прочитана: сводка без неё была бы неверной');
                    if (done) return;
                    j.forEach(function (o) { out.push(norm(o)); });
                    if (j.length < PAGE) done = true;
                });
                return done ? out : batch(off + PAR * PAGE);
            });
        }
        return batch(0);
    };
    B.num = C.num;
    B.money = function (x) { var n = Math.round(C.num(x)); return (n < 0 ? '−' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; };
    B.mln = function (x) { var n = C.num(x); return Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2).replace('.', ',') + ' млн ₽' : Math.round(n / 1000) + ' тыс. ₽'; };
    B.pct = function (x, sign) { if (x === null || x === undefined) return '—'; return (sign && x > 0 ? '+' : '') + String(C.round1(x)).replace('.', ',').replace('-', '−') + '%'; };

    /* ---------- модель: все таблицы одним слоем ---------- */
    var modelP = null;
    var NAMES = ['Подразделение', 'Источник данных', 'Формат загрузки', 'Загрузка', 'Документ источника', 'План продаж', 'Метрика', 'Отклонение', 'Подписка', 'Сигнал', 'Лид источника'];
    B.model = function () {
        if (modelP) return modelP;
        var needLeads = B.ctx.screen === 'recon';
        modelP = Promise.all(NAMES.map(function (n) { return n === 'Лид источника' && !needLeads ? Promise.resolve(null) : B.rows(n); })).then(function (r) {
            var M = { today: B.TODAY };
            M.subs = (r[0] || []).map(function (x) { return { id: x._id, name: x['Подразделение'], type: x['Тип подразделения'], city: x['Город'], manager: x['Управляющий подразделения'] }; });
            M.sources = (r[1] || []).map(function (x) { return { id: x._id, name: x['Источник данных'], sys: x['Система источника'], format: x['Формат загрузки'], way: x['Способ загрузки'], freq: x['Частота загрузки'], at: x['Расписание загрузки'], owner: x['Ответственный за источник'] }; });
            M.formats = (r[2] || []).map(function (x) { return { id: x._id, name: x['Формат загрузки'], delim: x['Разделитель'] || ';', cols: x['Колонки формата'], rules: x['Правила проверки'] }; });
            M.loads = (r[3] || []).map(function (x) { return { rid: x._id, name: x['Загрузка'], source: x['Источник данных'], date: C.toIso(x['Дата загрузки']), time: x['Время загрузки'] || '', dataFor: C.toIso(x['Данные за']), file: x['Имя файла'], rows: C.num(x['Строк в файле']), acc: C.num(x['Принято строк']), rej: C.num(x['Отвергнуто строк']), status: x['Статус загрузки'], who: x['Кто загрузил'] }; });
            M.loadByName = {}; M.loads.forEach(function (l) { M.loadByName[l.name] = l; });
            M.docs = (r[4] || []).map(function (x) { return { rid: x._id, no: x['Документ источника'], date: C.toIso(x['Дата документа']), sub: x['Подразделение'], source: x['Источник данных'], load: x['Загрузка'], loadRid: x._ref['Загрузка'] || '', kind: x['Вид документа'], sum: C.num(x['Сумма документа']), cost: C.num(x['Себестоимость документа']), pos: C.num(x['Позиций в документе']) }; });
            M.plans = (r[5] || []).map(function (x) { return { rid: x._id, code: x['План продаж'], sub: x['Подразделение'], month: C.toIso(x['Месяц плана']), revenue: C.num(x['План выручки']), gp: C.num(x['План валовой прибыли']) }; });
            M.metrics = (r[6] || []).map(function (x) { return { rid: x._id, name: x['Метрика'], def: x['Определение метрики'], formula: x['Формула метрики'], unit: x['Единица метрики'], owner: x['Владелец метрики'], approved: C.toIso(x['Определение утверждено']), thr: C.num(x['Порог отклонения, %']) }; });
            M.thr = {}; M.metrics.forEach(function (m) { M.thr[m.name] = m.thr; });
            M.cards = (r[7] || []).map(function (x) { return { rid: x._id, code: x['Отклонение'], sub: x['Подразделение'], metric: x['Метрика'], date: C.toIso(x['Дата отклонения']), fact: C.num(x['Факт отклонения']), plan: C.num(x['План отклонения']), dev: C.num(x['Отклонение, %']), status: x['Статус отклонения'] || 'Новое', comment: x['Комментарий отклонения'] || '', author: x['Автор комментария'] || '', due: C.toIso(x['Срок решения']) }; });
            M.subscr = (r[8] || []).map(function (x) { return { rid: x._id, name: x['Подписка'], who: x['Получатель подписки'], ch: x['Канал подписки'], at: x['Время рассылки'], thr: C.num(x['Порог сигнала, %']), what: x['Состав подписки'] }; });
            M.signals = (r[9] || []).map(function (x) { return { rid: x._id, code: x['Сигнал'], sub: x['Подписка'], card: x['Отклонение'], date: C.toIso(x['Дата сигнала']), time: x['Время сигнала'], text: x['Текст сигнала'], status: x['Статус сигнала'] }; });
            M.leads = r[10] ? r[10].map(function (x) { return { rid: x._id, id: x['Лид источника'], source: x['Источник данных'], date: C.toIso(x['Дата лида']), phone: x['Телефон лида'], channel: x['Канал лида'], comment: x['Комментарий лида'] }; }) : null;
            /* видимость: у роли с маской документов и плана меньше — значит, сводка по «своим» подразделениям */
            var seen = {}; M.docs.forEach(function (d) { seen[d.sub] = 1; }); M.plans.forEach(function (p) { seen[p.sub] = 1; });
            M.mySubs = M.subs.filter(function (s) { return seen[s.name]; });
            M.scoped = M.mySubs.length < M.subs.length;
            M.fresh = C.freshness(M.sources, M.loads, B.TODAY);
            B.cur = M;
            return M;
        });
        return modelP;
    };
    B.resetModel = function () { modelP = null; };

    /* ---------- DOM ---------- */
    B.el = function (tag, attrs, kids) {
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
    B.btn = function (text, fn, cls) { return B.el('button', { type: 'button', 'class': 'bi-btn ' + (cls || ''), onclick: fn, text: text }); };
    B.toast = function (msg, bad) {
        var t = B.el('div', { 'class': 'bi-toast' + (bad ? ' bi-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 3000);
    };
    /* Модальное окно (не alert/confirm/prompt). */
    B.modal = function (title, body, buttons, wide) {
        var back = B.el('div', { 'class': 'bi-modal-back' });
        function close() { back.remove(); }
        var foot = B.el('div', { 'class': 'bi-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            return B.btn(b.text, function () { if (!b.fn || b.fn(close) !== false) close(); }, b.cls);
        }));
        var box = B.el('div', { 'class': 'bi-modal' + (wide ? ' bi-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [B.el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box, foot: foot };
    };
    B.field = function (label, input, hint) { return B.el('label', { 'class': 'bi-field' }, [B.el('span', { text: label }), input, hint ? B.el('small', { text: hint }) : null]); };
    B.select = function (opts, value) {
        var s = B.el('select', {}, opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return B.el('option', { value: v, text: t }); }));
        s.value = value === undefined ? '' : value; return s;
    };
    B.badge = function (text, kind) { return '<span class="bi-badge bi-' + (kind || 'info') + '">' + B.esc(text) + '</span>'; };
    B.tabs = function (items, active, onpick) {
        return B.el('div', { 'class': 'bi-tabs', role: 'tablist' }, items.map(function (it) {
            return B.el('button', { type: 'button', role: 'tab', 'class': 'bi-tab' + (it[0] === active ? ' bi-tab-on' : ''), 'aria-selected': it[0] === active ? 'true' : 'false', onclick: function () { onpick(it[0]); }, text: it[1] });
        }));
    };
    /* Таблица: cols = [{k, t, num, html(r)}] */
    B.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = B.el('thead', {}, [B.el('tr', {}, cols.map(function (c) { return B.el('th', { text: c.t, 'class': c.num ? 'bi-num' : '' }); }))]);
        var tbody = B.el('tbody', {}, rows.map(function (r) {
            return B.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' bi-click' : ''), onclick: opts.onrow ? function () { opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = B.el('td', { 'class': c.num ? 'bi-num' : '' });
                    if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k];
                    return td;
                }));
        }));
        if (!rows.length) tbody.appendChild(B.el('tr', {}, [B.el('td', { colspan: cols.length, 'class': 'bi-empty', text: opts.empty || 'Нет данных' })]));
        return B.el('div', { 'class': 'bi-tablewrap' }, [B.el('table', { 'class': 'bi-table' }, [thead, tbody])]);
    };
    B.fail = function (e) { host.innerHTML = ''; host.appendChild(B.el('div', { 'class': 'bi-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    B.mount = function (fn) {
        if (!host) return;
        host.textContent = 'Загрузка...';
        B.render = function () { B.meta().then(function () { return B.model(); }).then(function (M) { host.innerHTML = ''; return fn(host, M); }).catch(B.fail); };
        B.render();
    };
    B.reload = function () { B.resetModel(); B.render(); };
    B.nav = function (screen, hash) { return B.url(screen) + (hash ? '#' + Object.keys(hash).map(function (k) { return k + '=' + encodeURIComponent(hash[k]); }).join('&') : ''); };
    B.hash = function () { var o = {}; location.hash.replace(/^#/, '').split('&').forEach(function (p) { var a = p.split('='); if (a[0]) o[a[0]] = decodeURIComponent(a[1] || ''); }); return o; };
    B.batch = function (ops) { return B.post('_m_batch?JSON', { ops: ops }).then(function (r) { B.resetModel(); return r; }); };
    B.create = function (table, fields) { return B.post('_m_new/' + B.tid(table) + '?JSON', { up: 1, fields: fields }).then(function (r) { B.resetModel(); return r; }); };
    B.update = function (id, fields) { return B.post('_m_set/' + id + '?JSON', { fields: fields }).then(function (r) { B.resetModel(); return r; }); };
    /* Плашка свежести: «Данные на 07:40 · 3 из 4 источников» */
    B.freshBar = function (M) {
        var f = M.fresh, bad = f.stale.length;
        var txt = 'Данные на ' + (f.asOf || '—') + ' ' + C.toDmy(B.TODAY) + ' · ' + f.fresh + ' из ' + f.total + ' источников';
        var det = bad ? ' · не загружен: ' + f.stale.map(function (s) { return s.name + ' (данные по ' + C.toDmy(s.dataFor) + ')'; }).join(', ') : ' · все источники свежие';
        return B.el('a', { 'class': 'bi-fresh ' + (bad ? 'bi-fresh-bad' : 'bi-fresh-ok'), href: B.nav('loads'), title: 'Журнал загрузок' }, [B.el('b', { text: txt }), B.el('span', { text: det })]);
    };
})();
