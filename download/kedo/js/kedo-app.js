/* КЭДО: общий слой рабочих мест (данные, запись, окна, модель). Расчёты - в kedo-core.js. */
(function () {
    'use strict';
    var C = window.KedoCore;
    var P = window.Kedo = { core: C };
    var host = document.getElementById('kedo-app');
    var ds = host ? host.dataset : {};
    P.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };
    P.TODAY = '2026-11-26'; /* дата демо */
    P.rk = C.roleKey(P.ctx.role);

    P.dec = function (s) { return typeof s === 'string' ? s.replace(/&comma;/g, ',') : s; };
    P.esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    P.url = function (p) { return '/' + P.ctx.db + '/' + p; };
    P.get = function (p, init) {
        return fetch(P.url(p), Object.assign({ credentials: 'same-origin', cache: 'no-store' }, init || {})).then(function (r) {
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
    P.meta = function () {
        return metaP || (metaP = P.get('metadata?JSON=1').then(function (m) {
            var by = {};
            m.forEach(function (t) { by[t.val] = t; (t.reqs || []).forEach(function (q) { if (q.arr_id && !by[q.val]) by[q.val] = { id: q.arr_id, val: q.val, granted: q.granted || t.granted, child: true }; }); });
            P.metaBy = by; return by;
        }));
    };
    P.tid = function (name) { return P.metaBy[name] && P.metaBy[name].id; };
    P.canWrite = function (name) { return !!(P.metaBy[name] && P.metaBy[name].granted === 'WRITE'); };
    P.canRead = function (name) { return !!P.metaBy[name]; };

    function norm(o) {
        var r = { _id: String(o.id), _up: String(o.up || ''), _ref: {} };
        Object.keys(o).forEach(function (k) {
            if (k === 'id' || k === 'up' || k === 'ord') return;
            var v = o[k];
            if (v && typeof v === 'object') { if (v.id !== undefined) { r[k] = P.dec(v.val); r._ref[k] = String(v.id); } return; }
            r[k] = v === null ? '' : P.dec(v);
        });
        return r;
    }
    P.rows = function (name, extra) {
        if (!P.canRead(name)) return Promise.resolve(null);
        var id = P.tid(name), out = [], PAGE = 500;
        function page(off) {
            return P.get('object/' + id + '/?JSON_OBJ&NAMED&LIMIT=' + off + ',' + PAGE + (extra || '')).then(function (j) {
                if (!Array.isArray(j)) throw new Error('Нет доступа к таблице «' + name + '»');
                j.forEach(function (o) { out.push(norm(o)); });
                return j.length < PAGE ? out : page(off + PAGE);
            });
        }
        return page(0).catch(function (e) { if (/HTTP 403/.test(e.message)) return null; throw e; });
    };
    P.map = function (rows, key) { var m = {}; (rows || []).forEach(function (r) { m[r[key]] = r; }); return m; };

    /* ---------- модель ---------- */
    var modelP = null;
    var NAMES = ['Подразделение', 'Вид подписи', 'Статус подписи', 'Сотрудник', 'Маршрут подписания', 'Шаг маршрута', 'Тип документа', 'Кадровый документ', 'Правило КЭДО', 'Нерабочий день', 'Соответствие статусов', 'Юрлицо'];
    P.model = function () {
        if (modelP) return modelP;
        modelP = Promise.all(NAMES.map(function (n) { return P.rows(n, n === 'Шаг маршрута' ? '&F_U=0' : ''); })).then(function (r) {
            var M = { today: P.TODAY };
            M.depts = (r[0] || []).map(function (x) { return { id: x._id, name: x['Подразделение'], org: x['Юрлицо'], head: x['Руководитель подразделения'], login: x['Логин руководителя'] }; });
            M.signKinds = (r[1] || []).sort(function (a, b) { return C.num(a['Порядок подписи']) - C.num(b['Порядок подписи']); }).map(function (x) { return { id: x._id, name: x['Вид подписи'], who: x['Кто выпускает'] }; });
            M.statuses = (r[2] || []).map(function (x) { return { name: x['Статус подписи'], color: x['Цвет статуса'] }; });
            M.emps = (r[3] || []).map(function (x) { return { id: x._id, name: x['Сотрудник'], tab: x['Табельный номер'], dept: x['Подразделение'], position: x['Должность'], hire: C.toIso(x['Дата приёма']), sign: x['Вид подписи'], phone: x['Телефон'], login: x['Логин сотрудника'], consent: x['Согласие на КЭДО'] }; });
            M.empBy = P.map(M.emps, 'name'); M.empTab = {}; M.emps.forEach(function (e) { M.empTab[e.tab] = e.name; });
            M.routes = (r[4] || []).map(function (x) { return { id: x._id, name: x['Маршрут подписания'], descr: x['Описание маршрута'], steps: [] }; });
            var rb = {}; M.routes.forEach(function (x) { rb[x.id] = x; });
            (r[5] || []).forEach(function (x) { var rt = rb[x._up]; if (rt) rt.steps.push({ id: x._id, label: x['Шаг маршрута'], order: C.num(x['Порядок шага']), who: x['Подписант'], sign: x['Вид подписи'], days: C.num(x['Срок шага, раб. дней']), onRefuse: x['При отказе'] }); });
            M.routes.forEach(function (x) { x.steps = C.routeSteps(x.steps); });
            M.routeBy = P.map(M.routes, 'name');
            M.types = (r[6] || []).map(function (x) { return { id: x._id, name: x['Тип документа'], zupKind: x['Вид документа ЗУП'], route: x['Маршрут подписания'], limit: C.num(x['Срок подписания, раб. дней']), group: x['Группа документов'] }; });
            M.typeBy = P.map(M.types, 'name');
            M.rules = C.rulesFrom((r[8] || []).map(function (x) { return { name: x['Правило КЭДО'], value: x['Значение правила'] }; }));
            M.hol = {}; (r[9] || []).forEach(function (x) { M.hol[C.toIso(x['Нерабочий день'])] = 1; });
            M.statusMap = {}; (r[10] || []).forEach(function (x) { M.statusMap[x['Соответствие статусов']] = x['Статус подписи']; });
            M.orgs = (r[11] || []).map(function (x) { return { name: x['Юрлицо'], signer: x['Подписант юрлица'] }; });
            var deptBy = P.map(M.depts, 'name');
            M.docs = (r[7] || []).map(function (x) {
                var t = M.typeBy[x['Тип документа']] || {}, e = M.empBy[x['Сотрудник']] || {};
                return { id: x._id, number: x['Кадровый документ'], type: x['Тип документа'], zupKind: t.zupKind || '', route: t.route || '', limit: t.limit || 0, emp: x['Сотрудник'], tab: e.tab || '', dept: x['Подразделение'] || e.dept || '',
                    org: (deptBy[x['Подразделение'] || e.dept] || {}).org || '', date: C.toIso(x['Дата документа']), sent: C.toIso(x['Дата отправки']), status: x['Статус подписи'] || C.PREPARED, signed: C.toIso(x['Дата подписания']),
                    sign: x['Вид подписи'], file: x['Файл с подписью'], opId: x['ID у оператора'], zup: x['Статус в ЗУП'] || '', back: C.toIso(x['Дата возврата в ЗУП']), error: x['Ошибка передачи'], reason: x['Причина отказа'], kadr: x['Кадровик'] };
            }).sort(function (a, b) { return a.number < b.number ? 1 : -1; });
            M.docs.forEach(function (d) { d.st = C.docState(d, P.TODAY, M.hol, M.rules); });
            M.docById = P.map(M.docs, 'id');
            M.myDept = M.depts.filter(function (d) { return d.login && d.login === P.ctx.user; })[0] || null;
            M.me = M.emps.filter(function (e) { return e.login && e.login === P.ctx.user; })[0] || null;
            P.cur = M;
            return M;
        });
        return modelP;
    };
    P.resetModel = function () { modelP = null; };
    P.events = function (doc) {
        return P.rows('Событие документа', '&F_U=' + doc.id).then(function (rows) {
            return (rows || []).filter(function (x) { return x._up === doc.id; }).map(function (x) { return { text: x['Событие документа'], date: C.toIso(x['Дата события']), time: x['Время события'] || '', who: x['Автор события'], kind: x['Вид события'] }; })
                .sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? -1 : 1; });
        });
    };
    P.now = function () { var d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); };
    P.addEvent = function (doc, text, kind) { return P.post('_m_new/' + P.tid('Событие документа') + '?JSON', { up: doc.id, fields: { 'Событие документа': text, 'Дата события': P.TODAY, 'Время события': P.now(), 'Автор события': P.ctx.user, 'Вид события': kind || 'Действие' } }); };
    /* Повтор передачи в ЗУП (демо: ответ ЗУП моделирует kedo-core.retryOutcome). */
    P.retryZup = function (doc) {
        var res = C.retryOutcome(doc);
        if (!res.ok) return P.addEvent(doc, 'Повторная передача в ЗУП отклонена: ' + res.error, 'Ошибка').then(function () { P.resetModel(); return res; });
        return P.post('_m_set/' + doc.id + '?JSON', { fields: { 'Статус в ЗУП': C.ZUP_OK, 'Дата возврата в ЗУП': P.TODAY, 'Ошибка передачи': '' } })
            .then(function () { return P.addEvent(doc, 'Повторная передача: файл с подписью принят в ЗУП, личное дело обновлено', 'ЗУП'); })
            .then(function () { P.resetModel(); return res; });
    };
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
    P.btn = function (text, fn, cls) { return P.el('button', { type: 'button', 'class': 'kedo-btn ' + (cls || ''), onclick: fn, text: text }); };
    P.toast = function (msg, bad) {
        var t = P.el('div', { 'class': 'kedo-toast' + (bad ? ' kedo-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 2800);
    };
    /* Модальное окно (не alert/confirm/prompt). */
    P.modal = function (title, body, buttons, wide) {
        var back = P.el('div', { 'class': 'kedo-modal-back' });
        function close() { back.remove(); }
        var foot = P.el('div', { 'class': 'kedo-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            return P.btn(b.text, function () { if (!b.fn || b.fn(close) !== false) { if (!b.keep) close(); } }, b.cls);
        }));
        var box = P.el('div', { 'class': 'kedo-modal' + (wide ? ' kedo-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [P.el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box };
    };
    P.field = function (label, input, hint) { return P.el('label', { 'class': 'kedo-field' }, [P.el('span', { text: label }), input, hint ? P.el('small', { text: hint }) : null]); };
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
    P.badge = function (text, kind) { return '<span class="kedo-badge kedo-' + (kind || 'info') + '">' + P.esc(text) + '</span>'; };
    P.tabs = function (items, active, onpick) {
        return P.el('div', { 'class': 'kedo-tabs', role: 'tablist' }, items.map(function (it) {
            return P.el('button', { type: 'button', role: 'tab', 'class': 'kedo-tab' + (it[0] === active ? ' kedo-tab-on' : ''), 'aria-selected': it[0] === active ? 'true' : 'false', onclick: function () { onpick(it[0]); }, text: it[1] });
        }));
    };
    /* Таблица: cols = [{k, t, num, cls(r), html(r)}] */
    P.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = P.el('thead', {}, [P.el('tr', {}, cols.map(function (c) { return P.el('th', { text: c.t, 'class': c.num ? 'kedo-num' : '' }); }))]);
        var tbody = P.el('tbody', {}, rows.map(function (r) {
            return P.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' kedo-click' : ''), onclick: opts.onrow ? function () { opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = P.el('td', { 'class': (c.num ? 'kedo-num ' : '') + (c.cls ? c.cls(r) : '') });
                    if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k];
                    return td;
                }));
        }));
        if (!rows.length) tbody.appendChild(P.el('tr', {}, [P.el('td', { colspan: cols.length, 'class': 'kedo-empty', text: opts.empty || 'Нет данных' })]));
        return P.el('div', { 'class': 'kedo-tablewrap' }, [P.el('table', { 'class': 'kedo-table' }, [thead, tbody])]);
    };
    P.kpi = function (label, value, sub, kind) {
        return P.el('div', { 'class': 'kedo-kpi' + (kind ? ' kedo-kpi-' + kind : '') }, [P.el('div', { 'class': 'kedo-kpi-v', html: value }), P.el('div', { 'class': 'kedo-kpi-l', text: label }), sub ? P.el('div', { 'class': 'kedo-kpi-s', text: sub }) : null]);
    };
    P.fail = function (e) { host.innerHTML = ''; host.appendChild(P.el('div', { 'class': 'kedo-error', text: 'Ошибка: ' + (e && e.message || e) })); };
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
    P.head = function (title, sub) { return [P.el('h1', { text: title }), P.el('p', { 'class': 'kedo-sub', text: sub })]; };
    P.who = function () { return P.ctx.user; };
})();
