/* Сверка данных: общий слой рабочих мест (данные, запись, окна, модель). Расчёты - в reconcile-core.js. */
(function () {
    'use strict';
    var C = window.ReconCore;
    var P = window.Rc = { core: C };
    var host = document.getElementById('rc-app');
    var ds = host ? host.dataset : {};
    P.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };
    P.TODAY = '2026-11-26'; /* дата демо */
    P.role = C.roleKey(P.ctx.role);

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
        var r = { _id: String(o.id), _up: String(o.up), _ref: {} };
        Object.keys(o).forEach(function (k) {
            if (k === 'id' || k === 'up' || k === 'ord') return;
            var v = o[k];
            if (v && typeof v === 'object') { if (v.id !== undefined) { r[k] = P.dec(v.val); r._ref[k] = String(v.id); } return; }
            r[k] = v === null ? '' : P.dec(v);
        });
        return r;
    }
    /* Страницы читаются пачками параллельно. */
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
    P.num = C.num;
    P.money = C.money;
    P.short = function (x) { var v = Math.abs(C.num(x)); return (C.num(x) < 0 ? '-' : '') + (v >= 1e6 ? (v / 1e6).toFixed(2).replace('.', ',') + ' млн ₽' : v >= 1e3 ? Math.round(v / 1e3) + ' тыс. ₽' : Math.round(v) + ' ₽'); };
    P.dmy = C.toDmy;

    /* ---------- модель ---------- */
    var NEED = {
        sverka: ['Загрузка файла'],
        queue: ['Расхождение'],
        today: ['Расхождение', 'Прогон сверки'],
        audit: ['Расхождение', 'Прогон сверки', 'Журнал сверки', 'Загрузка файла'],
        formats: ['Загрузка файла']
    };
    /* Выборка по значению поля (F_<id реквизита>): на большой таблице читаем только нужное. */
    P.rowsWhere = function (name, field, value) {
        if (!P.canRead(name)) return Promise.resolve([]);
        var t = P.metaBy[name], q = (t.reqs || []).filter(function (r) { return r.val === field; })[0];
        return P.get('object/' + t.id + '/?JSON_OBJ&NAMED&LIMIT=0,5000&F_' + q.id + '=' + encodeURIComponent(value), { cache: 'no-store' }).then(function (j) { return (Array.isArray(j) ? j : []).map(norm); });
    };
    var modelP = null;
    P.model = function () {
        if (modelP) return modelP;
        var base = ['Пара сверки', 'Формат загрузки', 'Правило сопоставления', 'Причина расхождения', 'Период сверки'];
        var names = base.concat(NEED[P.ctx.screen] || []);
        var extra = P.ctx.screen === 'queue' ? Promise.all([P.rowsWhere('Запись сверки', 'Статус сопоставления', 'Расхождение'), P.rowsWhere('Запись сверки', 'Статус сопоставления', 'Сопоставлено вручную')]).then(function (a) { return a[0].concat(a[1]); }) : Promise.resolve(null);
        modelP = Promise.all(names.map(function (n) { return P.rows(n); }).concat([extra])).then(function (r) {
            if (r[names.length]) names = names.concat(['Запись сверки']);
            var t = {}; names.forEach(function (n, i) { t[n] = r[i] || []; });
            /* подчинённая таблица читается только с родителем (F_U) */
            return Promise.all(t['Формат загрузки'].map(function (f) { return P.canRead('Колонка формата') ? P.get('object/' + P.tid('Колонка формата') + '/?JSON_OBJ&NAMED&F_U=' + f._id, { cache: 'no-store' }) : []; })).then(function (cs) {
            t['Колонка формата'] = []; cs.forEach(function (l) { (Array.isArray(l) ? l : []).forEach(function (o) { t['Колонка формата'].push(norm(o)); }); });
            var M = { today: P.TODAY, role: P.role, user: P.ctx.user };
            M.pairs = t['Пара сверки'].map(function (x) { return { id: x._id, name: x['Пара сверки'], acc: x['Банковский счёт'], led: x['Счёт учёта'], fb: x['Формат банка'], fl: x['Формат учёта'], resp: x['Ответственный'], respId: x._ref['Ответственный'], sla: C.num(x['Срок разбора, дн.']) || 3 }; });
            var cols = {}; t['Колонка формата'].forEach(function (x) { (cols[x._up] = cols[x._up] || []).push({ id: x._id, label: x['Колонка формата'], field: x['Поле сверки'], header: x['Заголовок в файле'], required: x['Обязательная колонка'] === '1' }); });
            M.formats = t['Формат загрузки'].map(function (x) { return { id: x._id, name: x['Формат загрузки'], side: x['Сторона сверки'], sys: x['Система-источник'], delim: x['Разделитель'], dateFmt: x['Формат даты'], dec: x['Десятичный знак'], skip: C.num(x['Пропустить строк']), enc: x['Кодировка файла'], cols: cols[x._id] || [] }; });
            M.fmtBy = {}; M.formats.forEach(function (f) { M.fmtBy[f.name] = f; });
            M.ruleRows = t['Правило сопоставления'].map(function (x) { return { id: x._id, name: x['Правило сопоставления'], order: x['Порядок правила'], kind: x['Вид правила'], keys: x['Ключи сопоставления'], amtTol: x['Допуск суммы, ₽'], dayTol: x['Допуск дней'], maxK: x['Максимум в группе'], on: x['Правило включено'] === '1' }; });
            M.rules = C.rulesFrom(M.ruleRows);
            M.reasons = t['Причина расхождения'].map(function (x) { return { id: x._id, name: x['Причина расхождения'], check: x['Что проверить'], action: x['Действие по умолчанию'], order: C.num(x['Порядок причины']) }; });
            M.periods = t['Период сверки'].map(function (x) { return { id: x._id, name: x['Период сверки'], from: C.toIso(x['Начало периода']), to: C.toIso(x['Конец периода']), status: x['Статус периода'], closedBy: x['Закрыл период'], closedAt: C.toIso(x['Дата закрытия периода']) }; });
            M.discs = (t['Расхождение'] || []).map(function (x) {
                return { id: x._id, code: x['Расхождение'], pair: x['Пара сверки'], reason: x['Причина расхождения'], run: x['Прогон сверки'], cp: x['Контрагент'], date: C.toIso(x['Дата операции']), amount: C.num(x['Сумма операции']), diff: C.num(x['Сумма расхождения']),
                    recA: String(x['Записи банка'] || '').split(/,\s*/).filter(Boolean), recB: String(x['Записи учёта'] || '').split(/,\s*/).filter(Boolean), found: C.toIso(x['Дата выявления']), due: C.toIso(x['Срок разбора']), resp: x['Ответственный'], respId: x._ref['Ответственный'],
                    status: x['Статус разбора'], basis: x['Основание закрытия'], closedBy: x['Закрыл'], closedAt: C.toIso(x['Дата закрытия']), checkedBy: x['Проверил'], checkedAt: C.toIso(x['Дата проверки']) };
            });
            M.recs = (t['Запись сверки'] || []).map(function (x) { return { id: x._id, code: x['Запись сверки'], pair: x['Пара сверки'], side: x['Сторона сверки'], date: C.toIso(x['Дата операции']), amount: C.num(x['Сумма операции']), cp: x['Контрагент'], inn: x['ИНН контрагента'], doc: x['Номер документа'], purpose: x['Назначение платежа'], status: x['Статус сопоставления'], group: x['Группа сопоставления'], rule: x['Правило сопоставления'], load: x['Загрузка файла'] }; });
            M.recBy = {}; M.recs.forEach(function (r) { M.recBy[r.code] = r; });
            M.runs = (t['Прогон сверки'] || []).map(function (x) { return { id: x._id, code: x['Прогон сверки'], pair: x['Пара сверки'], period: x['Период сверки'], date: C.toIso(x['Дата прогона']), time: x['Время прогона'], fileB: x['Файл банка'], fileL: x['Файл учёта'], rowsB: C.num(x['Строк банка']), rowsL: C.num(x['Строк учёта']), matched: C.num(x['Сопоставлено строк']), unmatched: C.num(x['Не сопоставлено строк']), pct: C.num(x['Сошлось, %']), ms: C.num(x['Длительность, мс']), by: x['Запустил'], status: x['Статус прогона'], approvedBy: x['Утвердил'] }; });
            M.journal = (t['Журнал сверки'] || []).map(function (x) { return { id: x._id, code: x['Журнал сверки'], date: C.toIso(x['Дата события']), time: x['Время события'], who: x['Кто'], action: x['Действие'], obj: x['Объект журнала'], details: x['Подробности'] }; });
            M.loads = (t['Загрузка файла'] || []).map(function (x) { return { id: x._id, name: x['Загрузка файла'], format: x['Формат загрузки'], pair: x['Пара сверки'], date: C.toIso(x['Дата загрузки']), time: x['Время загрузки'], by: x['Загрузил'], rows: C.num(x['Строк в файле']), errors: C.num(x['Строк с ошибкой']), hash: x['Хэш файла'] }; });
            P.cur = M;
            return M;
            });
        });
        return modelP;
    };
    P.resetModel = function () { modelP = null; };

    /* ---------- запись ---------- */
    P.create = function (table, fields, up) { return P.post('_m_new/' + P.tid(table) + '?JSON', { up: up || 1, fields: fields }).then(function (r) { P.resetModel(); return r; }); };
    P.update = function (id, fields) { return P.post('_m_set/' + id + '?JSON', { fields: fields }).then(function (r) { P.resetModel(); return r; }); };
    /* Пакет операций по 100; ответы собираются в один список, onStep(сделано, всего) - для прогресса. */
    P.batch = function (ops, onStep) {
        var out = [], i = 0;
        function next() {
            if (i >= ops.length) { P.resetModel(); return Promise.resolve(out); }
            var part = ops.slice(i, i + 100); i += 100;
            return P.post('_m_batch', { ops: part }).then(function (j) { out = out.concat((j && j.results) || []); if (onStep) onStep(Math.min(i, ops.length), ops.length); return next(); });
        }
        return next();
    };
    P.now = function () { var d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); };
    P.uid = function (pre) { return pre + '-' + P.TODAY.replace(/-/g, '').slice(2) + '-' + Date.now().toString(36).slice(-5) + Math.floor(Math.random() * 90 + 10); };
    /* Запись в журнал сверки: кто, что и по какому объекту. */
    P.logOp = function (action, obj, details) {
        return { op: 'new', id: P.tid('Журнал сверки'), up: 1, fields: { 'Журнал сверки': P.uid('Ж'), 'Дата события': P.TODAY, 'Время события': P.now(), 'Кто': P.ctx.user, 'Действие': action, 'Объект журнала': obj, 'Подробности': details } };
    };
    P.log = function (action, obj, details) { if (!P.canWrite('Журнал сверки')) return Promise.resolve(); return P.batch([P.logOp(action, obj, details)]).catch(function () { }); };

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
    P.btn = function (text, fn, cls) { return P.el('button', { type: 'button', 'class': 'rc-btn ' + (cls || ''), onclick: fn, text: text }); };
    P.toast = function (msg, bad) {
        var t = P.el('div', { 'class': 'rc-toast' + (bad ? ' rc-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 2800);
    };
    /* Модальное окно (не alert/confirm/prompt). */
    P.modal = function (title, body, buttons, wide) {
        var back = P.el('div', { 'class': 'rc-modal-back' });
        function close() { back.remove(); }
        var foot = P.el('div', { 'class': 'rc-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            return P.btn(b.text, function () { if (!b.fn || b.fn(close) !== false) { if (!b.keep) close(); } }, b.cls);
        }));
        var box = P.el('div', { 'class': 'rc-modal' + (wide ? ' rc-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [P.el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box };
    };
    P.field = function (label, input, hint) { return P.el('label', { 'class': 'rc-field' }, [P.el('span', { text: label }), input, hint ? P.el('small', { text: hint }) : null]); };
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
    P.badge = function (text, kind) { return '<span class="rc-badge rc-' + (kind || 'info') + '">' + P.esc(text) + '</span>'; };
    P.tabs = function (items, active, onpick) {
        return P.el('div', { 'class': 'rc-tabs', role: 'tablist' }, items.map(function (it) {
            return P.el('button', { type: 'button', role: 'tab', 'class': 'rc-tab' + (it[0] === active ? ' rc-tab-on' : ''), 'aria-selected': it[0] === active ? 'true' : 'false', onclick: function () { onpick(it[0]); }, text: it[1] });
        }));
    };
    /* Таблица: cols = [{k, t, num, cls(r), html(r)}] */
    P.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = P.el('thead', {}, [P.el('tr', {}, cols.map(function (c) { return P.el('th', { text: c.t, 'class': c.num ? 'rc-num' : '' }); }))]);
        var tbody = P.el('tbody', {}, rows.map(function (r) {
            return P.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' rc-click' : ''), onclick: opts.onrow ? function () { opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = P.el('td', { 'class': (c.num ? 'rc-num ' : '') + (c.cls ? c.cls(r) : '') });
                    if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k];
                    return td;
                }));
        }));
        if (!rows.length) tbody.appendChild(P.el('tr', {}, [P.el('td', { colspan: cols.length, 'class': 'rc-empty', text: opts.empty || 'Нет данных' })]));
        return P.el('div', { 'class': 'rc-tablewrap' }, [P.el('table', { 'class': 'rc-table' }, [thead, tbody])]);
    };
    P.kpi = function (label, value, sub, kind) {
        return P.el('div', { 'class': 'rc-kpi' + (kind ? ' rc-kpi-' + kind : '') }, [P.el('div', { 'class': 'rc-kpi-v', html: value }), P.el('div', { 'class': 'rc-kpi-l', text: label }), sub ? P.el('div', { 'class': 'rc-kpi-s', text: sub }) : null]);
    };
    P.fail = function (e) { host.innerHTML = ''; host.appendChild(P.el('div', { 'class': 'rc-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    P.mount = function (fn) {
        if (!host) return;
        host.textContent = 'Загрузка...';
        P.meta().then(function () { return P.model(); }).then(function (M) { return fn(host, M); }).catch(P.fail);
    };
    P.nav = function (screen, hash) { return P.url(screen) + (hash ? '#' + hash : ''); };
    P.hash = function () { var o = {}; location.hash.replace(/^#/, '').split('&').forEach(function (p) { var a = p.split('='); if (a[0]) o[a[0]] = decodeURIComponent(a[1] || ''); }); return o; };
    P.head = function (title, sub) { return [P.el('h1', { text: title }), P.el('p', { 'class': 'rc-sub', text: sub })]; };
})();
