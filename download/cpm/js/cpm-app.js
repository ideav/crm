/* CPM: общий слой рабочих мест (данные, запись, окна, модель). Расчёты - в cpm-core.js. */
(function () {
    'use strict';
    var C = window.CpmCore;
    var P = window.Cpm = { core: C };
    var host = document.getElementById('cpm-app');
    var ds = host ? host.dataset : {};
    P.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };
    P.TODAY = '2026-11-26'; /* дата демо */
    P.dec = function (s) { return typeof s === 'string' ? s.replace(/&comma;/g, ',') : s; };
    P.esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    P.url = function (p) { return '/' + P.ctx.db + '/' + p; };
    P.get = function (p, init) {
        return fetch(P.url(p), Object.assign({ credentials: 'same-origin' }, init || {})).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + p);
            return r.json();
        });
    };
    /* POST с XSRF; вложенные объекты уходят JSON-строкой. */
    P.post = function (p, fields) {
        var fd = new FormData();
        fd.append('_xsrf', P.ctx.xsrf);
        Object.keys(fields || {}).forEach(function (k) { var v = fields[k]; fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v); });
        return fetch(P.url(p), { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (j) { var e = Array.isArray(j) ? j[0] : j; if (e && e.error) throw new Error(e.error); return j; });
    };
    var metaP = null;
    P.meta = function () { return metaP || (metaP = P.get('metadata?JSON=1').then(function (m) { var by = {}; m.forEach(function (t) { by[t.val] = t; }); P.metaBy = by; return by; })); };
    P.tid = function (name) { return P.metaBy[name] && P.metaBy[name].id; };
    P.canWrite = function (name) { return !!(P.metaBy[name] && P.metaBy[name].granted === 'WRITE'); };
    P.canRead = function (name) { return !!P.metaBy[name]; };

    function norm(o) {
        var r = { _id: String(o.id), _ref: {} };
        Object.keys(o).forEach(function (k) {
            if (k === 'id' || k === 'up' || k === 'ord') return;
            var v = o[k];
            if (v && typeof v === 'object') { if (v.id !== undefined) { r[k] = P.dec(v.val); r._ref[k] = String(v.id); } return; }
            r[k] = v === null ? '' : P.dec(v);
        });
        return r;
    }
    /* Страницы читаются пачками параллельно: большая таблица (таймшиты) грузится в разы быстрее. */
    P.rows = function (name) {
        if (!P.canRead(name)) return Promise.resolve(null);
        var id = P.tid(name), out = [], PAGE = 700, PAR = 4;
        function batch(off) {
            var ps = [];
            for (var i = 0; i < PAR; i++) ps.push(P.get('object/' + id + '/?JSON_OBJ&NAMED&LIMIT=' + (off + i * PAGE) + ',' + PAGE, { cache: 'no-store' }));
            return Promise.all(ps).then(function (pages) {
                var done = false;
                pages.forEach(function (j) {
                    if (!Array.isArray(j)) throw new Error('Нет доступа к таблице «' + name + '»');
                    if (done) return;
                    j.forEach(function (o) { out.push(norm(o)); });
                    if (j.length < PAGE) done = true;
                });
                return done ? out : batch(off + PAR * PAGE);
            });
        }
        return batch(0);
    };
    P.map = function (rows, key) { var m = {}; (rows || []).forEach(function (r) { m[r[key]] = r; }); return m; };
    P.num = C.num;
    P.fmt = function (x, d) { return C.num(x).toFixed(d || 0).replace('.', ','); };
    P.money = function (x) { var n = Math.round(C.num(x)); return (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; };
    P.mln = function (x) { return (C.num(x) / 1e6).toFixed(1).replace('.', ',') + ' млн'; };

    /* ---------- модель: все таблицы одним слоем ---------- */
    P.CUR = 'Бюджет 2027 · круг 2'; P.PREV = 'Бюджет 2027 · круг 1'; P.PLAN = 'Бюджет 2026'; P.FACT = 'Факт 2026';
    var modelP = null;
    P.model = function () {
        if (modelP) return modelP;
        var names = ['Юрлицо', 'ЦФО', 'Группа статей', 'Статья бюджета', 'Версия бюджета', 'Макропараметр', 'Правило контроля', 'Бюджет ЦФО', 'Строка бюджета', 'Пояснение отклонения', 'Заявка на оплату', 'Журнал изменений'];
        modelP = Promise.all(names.map(function (n) { return P.rows(n).catch(function () { return null; }); })).then(function (r) {
            var M = { today: P.TODAY };
            M.entities = (r[0] || []).map(function (x) { return { id: x._id, name: x['Юрлицо'], inn: x['ИНН юрлица'], role: x['Роль в группе'] }; });
            M.cfos = (r[1] || []).map(function (x) { return { id: x._id, name: x['ЦФО'], entity: x['Юрлицо'], head: x['Руководитель ЦФО'], kind: x['Вид ЦФО'], order: C.num(x['Порядок ЦФО']) }; }).sort(function (a, b) { return a.order - b.order; });
            var gOrder = {}; (r[2] || []).forEach(function (x) { gOrder[x['Группа статей']] = C.num(x['Порядок группы']); });
            M.groups = Object.keys(gOrder).sort(function (a, b) { return gOrder[a] - gOrder[b]; });
            M.articles = (r[3] || []).map(function (x) { return { id: x._id, name: x['Статья бюджета'], code: x['Код статьи'], group: x['Группа статей'], kind: x['Вид статьи'], intra: x['Внутригрупповая'] === '1', order: C.num(x['Порядок статьи']), owner: x['Ответственный за статью'] }; }).sort(function (a, b) { return a.order - b.order; });
            M.versions = (r[4] || []).map(function (x) { return { id: x._id, name: x['Версия бюджета'], kind: x['Вид версии'], year: C.num(x['Бюджетный год']), status: x['Статус версии'], approved: C.toIso(x['Утверждена']), locked: x['Замок версии'] === '1', compare: x['Сравнивать с'] }; });
            M.macros = (r[5] || []).map(function (x) { return { name: x['Макропараметр'], value: C.num(x['Значение параметра']), unit: x['Единица параметра'] }; });
            M.rules = (r[6] || []).map(function (x) { return { id: x._id, name: x['Правило контроля'], kind: x['Вид правила'], article: x['Статья бюджета'] || '', threshold: C.num(x['Порог правила']), message: x['Сообщение правила'], on: x['Правило включено'] === '1' }; });
            M.budgets = (r[7] || []).map(function (x) { return { id: x._id, name: x['Бюджет ЦФО'], cfo: x['ЦФО'], version: x['Версия бюджета'], status: x['Статус сдачи'], deadline: C.toIso(x['Срок сдачи']), submitted: C.toIso(x['Сдан']), comment: x['Комментарий финансиста'], reminders: C.num(x['Напоминаний']) }; });
            M.rows = (r[8] || []).map(function (x) { return { id: x._id, period: C.toIso(x['Строка бюджета']), cfo: x['ЦФО'], version: x['Версия бюджета'], article: x['Статья бюджета'], amount: C.num(x['Сумма строки']) }; });
            M.notes = (r[9] || []).map(function (x) { return { id: x._id, cfo: x['ЦФО'], article: x['Статья бюджета'], period: C.toIso(x['Период пояснения']), status: x['Статус пояснения'], due: C.toIso(x['Срок пояснения']), text: x['Текст пояснения'], author: x['Автор пояснения'] }; });
            M.requests = (r[10] || []).map(function (x) { return { id: x._id, num: x['Заявка на оплату'], cfo: x['ЦФО'], article: x['Статья бюджета'], counterparty: x['Контрагент'], amount: C.num(x['Сумма заявки']), date: C.toIso(x['Дата платежа']), status: x['Статус заявки'], author: x['Инициатор'], over: x['Сверх лимита'] === '1', decision: x['Решение ФД'] }; });
            M.journal = (r[11] || []).map(function (x) { return { id: x._id, text: x['Журнал изменений'], cfo: x['ЦФО'], version: x['Версия бюджета'], author: x['Автор изменения'], at: x['Момент изменения'] }; }).reverse();
            M.cfoBy = P.map(M.cfos, 'name'); M.artBy = P.map(M.articles, 'name'); M.verBy = P.map(M.versions, 'name');
            M.artIds = {}; M.articles.forEach(function (a) { M.artIds[a.name] = a.id; });
            /* роль - по правам, а не по названию: ЭПО пишет справочники, ФД пишет версии, руководитель ЦФО видит один ЦФО */
            M.isFD = P.canWrite('Версия бюджета');
            M.isFinance = M.isFD || P.canWrite('Статья бюджета');
            var seen = {}; M.budgets.forEach(function (b) { seen[b.cfo] = 1; });
            var mine = Object.keys(seen);
            M.isHead = !M.isFinance && P.canWrite('Строка бюджета') && mine.length === 1;
            M.myCfo = M.isHead ? mine[0] : null;
            M.readOnly = !M.isFinance && !M.isHead;
            M.cur = M.verBy[P.CUR] || null;
            P.cur = M;
            return M;
        });
        return modelP;
    };
    P.resetModel = function () { modelP = null; };
    P.batch = function (ops) {
        if (!ops.length) return Promise.resolve({ ok: 0, failed: 0 });
        return P.post('_m_batch?JSON', { ops: JSON.stringify(ops) }).then(function (r) {
            P.resetModel();
            if (r && r.failed) { var bad = (r.results || []).filter(function (x) { return !x.ok; })[0]; throw new Error('не записано ' + r.failed + ' из ' + (r.ok + r.failed) + (bad && bad.error ? ': ' + bad.error : '')); }
            return r;
        });
    };
    P.log = function (text, cfoName, version) {
        var M = P.cur, d = new Date(), pad = function (n) { return String(n).padStart(2, '0'); };
        var at = C.toIso(P.TODAY).split('-').reverse().join('.') + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        var f = { 'Журнал изменений': text, 'Автор изменения': P.ctx.user, 'Момент изменения': at };
        if (cfoName && M.cfoBy[cfoName]) f['ЦФО'] = M.cfoBy[cfoName].id;
        if (version && M.verBy[version]) f['Версия бюджета'] = M.verBy[version].id;
        return P.post('_m_new/' + P.tid('Журнал изменений') + '?JSON', { up: 1, fields: f }).catch(function () { return null; });
    };
    P.budgetOf = function (M, cfo, version) { return M.budgets.filter(function (b) { return b.cfo === cfo && b.version === version; })[0] || null; };
    P.shortDate = function (iso) { return iso ? C.toIso(iso).split('-').reverse().slice(0, 2).join('.') : ''; };
    P.date = function (iso) { return iso ? C.toIso(iso).split('-').reverse().join('.') : ''; };
    P.th = function (x) { return P.money(x).replace(' ₽', ''); };
    P.k = function (x) { var n = Math.round(C.num(x) / 1000); return (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); };
    P.pct = function (x, plus) { if (x === null || x === undefined || !isFinite(x)) return ''; var s = (Math.round(x * 10) / 10).toFixed(1).replace('.', ','); return (plus && x > 0 ? '+' : '') + s + '%'; };
    P.STATUS_KIND = { 'Утверждён': 'ok', 'Принят': 'ok', 'Сдан': 'info', 'Черновик': 'mute', 'Не начат': 'crit', 'Возвращён': 'warn' };
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
    P.btn = function (text, fn, cls) { return P.el('button', { type: 'button', 'class': 'cpm-btn ' + (cls || ''), onclick: fn, text: text }); };
    P.toast = function (msg, bad) {
        var t = P.el('div', { 'class': 'cpm-toast' + (bad ? ' cpm-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 2800);
    };
    /* Модальное окно (не alert/confirm/prompt). */
    P.modal = function (title, body, buttons, wide) {
        var back = P.el('div', { 'class': 'cpm-modal-back' });
        function close() { back.remove(); }
        var foot = P.el('div', { 'class': 'cpm-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            return P.btn(b.text, function () { if (!b.fn || b.fn(close) !== false) { if (!b.keep) close(); } }, b.cls);
        }));
        var box = P.el('div', { 'class': 'cpm-modal' + (wide ? ' cpm-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [P.el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box };
    };
    P.field = function (label, input, hint) { return P.el('label', { 'class': 'cpm-field' }, [P.el('span', { text: label }), input, hint ? P.el('small', { text: hint }) : null]); };
    P.select = function (opts, value) {
        var s = P.el('select', {}, opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return P.el('option', { value: v, text: t }); }));
        s.value = value === undefined ? '' : value; return s;
    };
    P.input = function (type, value, attrs) { var i = P.el('input', Object.assign({ type: type }, attrs || {})); i.value = value === undefined ? '' : value; return i; };
    P.download = function (name, text) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
    };
    P.badge = function (text, kind) { return '<span class="cpm-badge cpm-' + (kind || 'info') + '">' + P.esc(text) + '</span>'; };
    P.tabs = function (items, active, onpick) {
        return P.el('div', { 'class': 'cpm-tabs', role: 'tablist' }, items.map(function (it) {
            return P.el('button', { type: 'button', role: 'tab', 'class': 'cpm-tab' + (it[0] === active ? ' cpm-tab-on' : ''), 'aria-selected': it[0] === active ? 'true' : 'false', onclick: function () { onpick(it[0]); }, text: it[1] });
        }));
    };
    /* Таблица: cols = [{k, t, num, cls(r), html(r)}] */
    P.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = P.el('thead', {}, [P.el('tr', {}, cols.map(function (c) { return P.el('th', { text: c.t, 'class': c.num ? 'cpm-num' : '' }); }))]);
        var tbody = P.el('tbody', {}, rows.map(function (r) {
            return P.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' cpm-click' : ''), onclick: opts.onrow ? function () { opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = P.el('td', { 'class': (c.num ? 'cpm-num ' : '') + (c.cls ? c.cls(r) : '') });
                    if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k];
                    return td;
                }));
        }));
        if (!rows.length) tbody.appendChild(P.el('tr', {}, [P.el('td', { colspan: cols.length, 'class': 'cpm-empty', text: opts.empty || 'Нет данных' })]));
        return P.el('div', { 'class': 'cpm-tablewrap' }, [P.el('table', { 'class': 'cpm-table' }, [thead, tbody])]);
    };
    P.kpi = function (label, value, sub, kind) {
        return P.el('div', { 'class': 'cpm-kpi' + (kind ? ' cpm-kpi-' + kind : '') }, [P.el('div', { 'class': 'cpm-kpi-v', html: value }), P.el('div', { 'class': 'cpm-kpi-l', text: label }), sub ? P.el('div', { 'class': 'cpm-kpi-s', text: sub }) : null]);
    };
    P.fail = function (e) { host.innerHTML = ''; host.appendChild(P.el('div', { 'class': 'cpm-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    P.mount = function (fn) {
        if (!host) return;
        host.textContent = 'Загрузка...';
        P.meta().then(function () { return P.model(); }).then(function (M) { return fn(host, M); }).catch(P.fail);
    };
    P.nav = function (screen, hash) { return P.url(screen) + (hash ? '#' + hash : ''); };
    P.hash = function () { var o = {}; location.hash.replace(/^#/, '').split('&').forEach(function (p) { var a = p.split('='); if (a[0]) o[a[0]] = decodeURIComponent(a[1] || ''); }); return o; };
    /* Создание и изменение записей (поля - по именам). */
    P.create = function (table, fields) { return P.post('_m_new/' + P.tid(table) + '?JSON', { up: 1, fields: fields }).then(function (r) { P.resetModel(); return r; }); };
    P.update = function (id, fields) { return P.post('_m_set/' + id + '?JSON', { fields: fields }).then(function (r) { P.resetModel(); return r; }); };
    P.head = function (title, sub) { return [P.el('h1', { text: title }), P.el('p', { 'class': 'cpm-sub', text: sub })]; };
    P.who = function () { return P.ctx.user; };
})();
