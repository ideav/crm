/* PSA: общий слой рабочих мест (данные, запись, окна, модель). Расчёты - в psa-core.js. */
(function () {
    'use strict';
    var C = window.PsaCore;
    var P = window.Psa = { core: C };
    var host = document.getElementById('psa-app');
    var ds = host ? host.dataset : {};
    P.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };
    P.TODAY = '2026-11-23'; /* дата демо */
    P.LAST_FACT_WEEK = '2026-11-16'; /* последняя неделя с фактом */
    P.HORIZON = 14; /* недель вперёд на тепловой карте */

    P.dec = function (s) { return typeof s === 'string' ? s.replace(/&comma;/g, ',') : s; };
    P.esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    P.url = function (p) { return '/' + P.ctx.db + '/' + p; };
    P.get = function (p) {
        return fetch(P.url(p), { credentials: 'same-origin' }).then(function (r) {
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
            for (var i = 0; i < PAR; i++) ps.push(P.get('object/' + id + '/?JSON_OBJ&NAMED&LIMIT=' + (off + i * PAGE) + ',' + PAGE));
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
    var modelP = null;
    P.model = function () {
        if (modelP) return modelP;
        var names = ['Пул', 'Правило', 'Нерабочий день', 'Сотрудник', 'Навык сотрудника', 'Отсутствие', 'Проект', 'Ставка продажи', 'Запрос ресурса', 'Бронь', 'Неделя таймшита', 'Навык', 'Грейд'];
        var needTs = /^(dashboard|timesheets|projects)$/.test(P.ctx.screen);
        modelP = Promise.all(names.map(function (n) { if (n === 'Неделя таймшита' && !needTs) return Promise.resolve([]); return n === 'Ставка продажи' ? P.rows(n).catch(function () { return null; }) : P.rows(n); })).then(function (r) {
            var M = { today: P.TODAY, hasRates: !!r[7], canCost: false };
            M.pools = (r[0] || []).map(function (x) { return { name: x['Пул'], head: x['Руководитель пула'], login: x['Логин руководителя'] }; });
            var rl = {}; (r[1] || []).forEach(function (x) { rl[x['Правило']] = C.num(x['Значение правила']); });
            M.rules = { limit: rl['Лимит загрузки'] || 100, overbook: rl['Допустимый овербукинг'] || 110, overbookWeeks: rl['Овербукинг не дольше'] || 2, softDays: rl['Срок жизни мягкой брони'] || 14, utilTarget: rl['Целевая утилизация'] || 80, marginMin: rl['Порог маржи проекта'] || 20, dayHours: rl['Рабочих часов в день'] || 8, tolerance: rl['Допуск план-факт'] || 15 };
            M.hol = {}; (r[2] || []).forEach(function (x) { M.hol[C.toIso(x['Нерабочий день'])] = C.num(x['Рабочих часов']); });
            M.emps = (r[3] || []).map(function (x) {
                return { id: x._id, name: x['Сотрудник'], num: x['Табельный номер'], pool: x['Пул'], position: x['Должность'], grade: x['Грейд'], fte: C.num(x['Ставка занятости']) || 1, cost: x['Себестоимость часа'] === undefined ? null : C.num(x['Себестоимость часа']), hire: C.toIso(x['Дата приёма']), type: x['Тип занятости'] };
            });
            M.canCost = M.emps.length > 0 && M.emps[0].cost !== null;
            M.emps.forEach(function (e) { if (e.cost === null) e.cost = 0; });
            M.empBy = P.map(M.emps, 'name'); M.empById = P.map(M.emps, 'id');
            M.skills = {}; (r[4] || []).forEach(function (x) { (M.skills[x['Сотрудник']] = M.skills[x['Сотрудник']] || []).push({ skill: x['Навык'], level: C.num(x['Уровень навыка']) }); });
            M.abs = {}; M.absList = (r[5] || []).map(function (x) { return { id: x._id, emp: x['Сотрудник'], from: C.toIso(x['Отсутствие']), to: C.toIso(x['Конец отсутствия']), kind: x['Вид отсутствия'] }; });
            M.absList.forEach(function (a) { (M.abs[a.emp] = M.abs[a.emp] || []).push(a); });
            M.projects = (r[6] || []).map(function (x) {
                return { id: x._id, name: x['Проект'], code: x['Код проекта'], cust: x['Заказчик'], contract: x['Тип договора'], pm: x['Руководитель проекта'], pmLogin: x['Логин РП'], status: x['Статус проекта'], from: C.toIso(x['Начало проекта']), to: C.toIso(x['Окончание проекта']), budgetHours: C.num(x['Бюджет часов']), price: x['Выручка по договору'] === undefined ? null : C.num(x['Выручка по договору']), ready: C.num(x['Готовность, %']) };
            });
            M.projBy = P.map(M.projects, 'name'); M.projById = P.map(M.projects, 'id');
            M.canPrice = M.projects.length > 0 && M.projects[0].price !== null;
            M.projects.forEach(function (p) { if (p.price === null) p.price = 0; });
            M.rates = {}; (r[7] || []).forEach(function (x) { M.rates[x['Проект'] + '|' + x['Грейд']] = C.num(x['Ставка продажи за час']); });
            M.reqs = (r[8] || []).map(function (x) {
                return { id: x._id, code: x['Запрос ресурса'], project: x['Проект'], role: x['Роль на проекте'], skill: x['Навык'], minGrade: x['Мин. грейд'], minLevel: C.num(x['Мин. уровень навыка']) || 1, from: C.toIso(x['Нужно с']), to: C.toIso(x['Нужно по']), hpw: C.num(x['Часов в неделю']), priority: x['Приоритет запроса'], status: x['Статус запроса'], suggested: x['Предложенный сотрудник'] || '' };
            });
            M.bookings = (r[9] || []).map(function (x) {
                return { id: x['Бронь'], rid: x._id, project: x['Проект'], emp: x['Сотрудник'], role: x['Роль на проекте'], kind: x['Вид брони'], status: x['Статус брони'], from: C.toIso(x['Бронь с']), to: C.toIso(x['Бронь по']), hpw: C.num(x['Часов в неделю']), expires: C.toIso(x['Истекает']), requester: x['Заявитель'], approver: x['Согласующий'], decision: x['Решение'], decDate: C.toIso(x['Дата решения']) };
            });
            M.ts = (r[10] || []).map(function (x) { return { id: x._id, week: C.toIso(x['Неделя таймшита']), emp: x['Сотрудник'], project: x['Проект'], hours: C.num(x['Часов факт']), status: x['Статус таймшита'] }; });
            M.skillList = (r[11] || []).map(function (x) { return x['Навык']; });
            M.gradeList = (r[12] || []).sort(function (a, b) { return C.num(a['Порядок грейда']) - C.num(b['Порядок грейда']); }).map(function (x) { return x['Грейд']; });
            M.me = M.pools.filter(function (p) { return p.login === P.ctx.user; })[0] || null;
            M.myProjects = M.projects.filter(function (p) { return p.pmLogin === P.ctx.user; });
            return M;
        });
        return modelP;
    };
    P.resetModel = function () { modelP = null; };
    P.billable = function (M, name) { var p = M.projBy[name]; return !!p && p.contract !== 'Внутренний'; };

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
    P.btn = function (text, fn, cls) { return P.el('button', { type: 'button', 'class': 'psa-btn ' + (cls || ''), onclick: fn, text: text }); };
    P.toast = function (msg, bad) {
        var t = P.el('div', { 'class': 'psa-toast' + (bad ? ' psa-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 2800);
    };
    /* Модальное окно (не alert/confirm/prompt). */
    P.modal = function (title, body, buttons, wide) {
        var back = P.el('div', { 'class': 'psa-modal-back' });
        function close() { back.remove(); }
        var foot = P.el('div', { 'class': 'psa-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            return P.btn(b.text, function () { if (!b.fn || b.fn(close) !== false) { if (!b.keep) close(); } }, b.cls);
        }));
        var box = P.el('div', { 'class': 'psa-modal' + (wide ? ' psa-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [P.el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box };
    };
    P.field = function (label, input, hint) { return P.el('label', { 'class': 'psa-field' }, [P.el('span', { text: label }), input, hint ? P.el('small', { text: hint }) : null]); };
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
    P.badge = function (text, kind) { return '<span class="psa-badge psa-' + (kind || 'info') + '">' + P.esc(text) + '</span>'; };
    P.tabs = function (items, active, onpick) {
        return P.el('div', { 'class': 'psa-tabs', role: 'tablist' }, items.map(function (it) {
            return P.el('button', { type: 'button', role: 'tab', 'class': 'psa-tab' + (it[0] === active ? ' psa-tab-on' : ''), 'aria-selected': it[0] === active ? 'true' : 'false', onclick: function () { onpick(it[0]); }, text: it[1] });
        }));
    };
    /* Таблица: cols = [{k, t, num, cls(r), html(r)}] */
    P.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = P.el('thead', {}, [P.el('tr', {}, cols.map(function (c) { return P.el('th', { text: c.t, 'class': c.num ? 'psa-num' : '' }); }))]);
        var tbody = P.el('tbody', {}, rows.map(function (r) {
            return P.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' psa-click' : ''), onclick: opts.onrow ? function () { opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = P.el('td', { 'class': (c.num ? 'psa-num ' : '') + (c.cls ? c.cls(r) : '') });
                    if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k];
                    return td;
                }));
        }));
        if (!rows.length) tbody.appendChild(P.el('tr', {}, [P.el('td', { colspan: cols.length, 'class': 'psa-empty', text: opts.empty || 'Нет данных' })]));
        return P.el('div', { 'class': 'psa-tablewrap' }, [P.el('table', { 'class': 'psa-table' }, [thead, tbody])]);
    };
    P.kpi = function (label, value, sub, kind) {
        return P.el('div', { 'class': 'psa-kpi' + (kind ? ' psa-kpi-' + kind : '') }, [P.el('div', { 'class': 'psa-kpi-v', html: value }), P.el('div', { 'class': 'psa-kpi-l', text: label }), sub ? P.el('div', { 'class': 'psa-kpi-s', text: sub }) : null]);
    };
    P.fail = function (e) { host.innerHTML = ''; host.appendChild(P.el('div', { 'class': 'psa-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    P.mount = function (fn) {
        if (!host) return;
        host.textContent = 'Загрузка...';
        P.meta().then(function () { return P.model(); }).then(function (M) { return fn(host, M); }).catch(P.fail);
    };
    P.nav = function (screen, hash) { return P.url(screen) + (hash ? '#' + hash : ''); };
    P.hash = function () { var o = {}; location.hash.replace(/^#/, '').split('&').forEach(function (p) { var a = p.split('='); if (a[0]) o[a[0]] = decodeURIComponent(a[1] || ''); }); return o; };
    P.weeks = function (n) { return C.weeksFrom(P.TODAY, n || P.HORIZON); };
    /* Создание и изменение записей (поля - по именам). */
    P.create = function (table, fields) { return P.post('_m_new/' + P.tid(table) + '?JSON', { up: 1, fields: fields }).then(function (r) { P.resetModel(); return r; }); };
    P.update = function (id, fields) { return P.post('_m_set/' + id + '?JSON', { fields: fields }).then(function (r) { P.resetModel(); return r; }); };
    P.head = function (title, sub) { return [P.el('h1', { text: title }), P.el('p', { 'class': 'psa-sub', text: sub })]; };
    P.who = function () { return P.ctx.user; };
})();
