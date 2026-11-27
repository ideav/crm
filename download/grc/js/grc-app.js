/* GRC: общий слой рабочих мест (данные, запись, окна, модель). Расчёты - в grc-core.js. */
(function () {
    'use strict';
    var C = window.GrcCore;
    var P = window.Grc = { core: C };
    var host = document.getElementById('grc-app');
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
    /* POST с XSRF; вложенные объекты уходят JSON-строкой, File - файлом. */
    P.post = function (p, fields) {
        var fd = new FormData();
        fd.append('_xsrf', P.ctx.xsrf);
        Object.keys(fields || {}).forEach(function (k) {
            var v = fields[k];
            if (v && typeof File !== 'undefined' && v instanceof File) fd.append(k, v, v.name);
            else fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v);
        });
        return fetch(P.url(p), { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (j) {
                var e = Array.isArray(j) ? j[0] : j;
                if (!r.ok || (e && e.error)) throw new Error((e && e.error) || ('HTTP ' + r.status));
                return j;
            });
        });
    };
    var metaP = null;
    P.meta = function () { return metaP || (metaP = P.get('metadata?JSON=1').then(function (m) { var by = {}; m.forEach(function (t) { by[t.val] = t; }); P.metaBy = by; return by; })); };
    P.tid = function (name) { return P.metaBy[name] && P.metaBy[name].id; };
    P.fid = function (table, field) { var t = P.metaBy[table]; var r = t && (t.reqs || []).filter(function (x) { return x.val === field || x.alias === field; })[0]; return r && r.id; };
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
    P.rows = function (name) {
        if (!P.canRead(name)) return Promise.resolve([]);
        return P.get('object/' + P.tid(name) + '/?JSON_OBJ&NAMED&LIMIT=0,5000').then(function (j) {
            if (!Array.isArray(j)) throw new Error('Нет доступа к таблице «' + name + '»');
            return j.map(norm);
        });
    };
    /* Ссылка FILE приходит HTML-ссылкой: достаём адрес и имя. */
    P.fileOf = function (html) {
        var m = /href="([^"]+)"[^>]*>([^<]*)</.exec(html || '');
        return m ? { url: m[1], name: m[2] } : null;
    };
    P.num = C.num;
    P.pct = function (x) { return Math.round(x) + '%'; };
    P.dmy = function (s) { return C.toDmy(s); };

    /* ---------- модель ---------- */
    var NAMES = ['Уровень вероятности', 'Уровень влияния', 'Зона риска', 'Категория риска', 'Подразделение', 'Бизнес-процесс', 'Сотрудник', 'Периодичность', 'Риск', 'Контроль', 'Кампания подтверждения', 'Запрос подтверждения', 'Журнал подтверждений'];
    var modelP = null;
    P.model = function () {
        if (modelP) return modelP;
        var needJournal = /^(audit|campaign|confirm)$/.test(P.ctx.screen);
        modelP = Promise.all(NAMES.map(function (n) { return n === 'Журнал подтверждений' && !needJournal ? Promise.resolve([]) : P.rows(n); })).then(function (r) {
            var M = { today: P.TODAY };
            M.probs = r[0].map(function (x) { return { name: x['Уровень вероятности'], score: C.num(x['Балл вероятности']), text: x['Частота события'] }; }).sort(function (a, b) { return a.score - b.score; });
            M.impacts = r[1].map(function (x) { return { name: x['Уровень влияния'], score: C.num(x['Балл влияния']), text: x['Критерий влияния'] }; }).sort(function (a, b) { return a.score - b.score; });
            M.zones = r[2].map(function (x) { return { id: x._id, name: x['Зона риска'], from: C.num(x['Балл зоны от']), to: C.num(x['Балл зоны до']), color: x['Цвет зоны'], action: x['Реакция на риск'] }; }).sort(function (a, b) { return a.from - b.from; });
            var pBy = {}, iBy = {}; M.probs.forEach(function (x) { pBy[x.name] = x.score; }); M.impacts.forEach(function (x) { iBy[x.name] = x.score; });
            M.cats = r[3].map(function (x) { return x['Категория риска']; });
            M.depts = r[4].map(function (x) { return { name: x['Подразделение'], entity: x['Юрлицо'], head: x['Руководитель подразделения'] }; });
            M.procs = r[5].map(function (x) { return { name: x['Бизнес-процесс'], dept: x['Подразделение'] }; });
            M.emps = r[6].map(function (x) { return { id: x._id, name: x['Сотрудник'], login: x['Логин сотрудника'], position: x['Должность сотрудника'], dept: x['Подразделение'], messenger: x['Мессенджер'] }; });
            M.empBy = {}; M.empByLogin = {}; M.emps.forEach(function (e) { M.empBy[e.name] = e; if (e.login) M.empByLogin[e.login] = e; });
            M.periods = r[7].map(function (x) { return x['Периодичность']; });
            M.risks = r[8].map(function (x) { return { id: x._id, code: x['Риск'], name: x['Название риска'], cat: x['Категория риска'], process: x['Бизнес-процесс'], pName: x['Уровень вероятности'], iName: x['Уровень влияния'], p: pBy[x['Уровень вероятности']] || 0, i: iBy[x['Уровень влияния']] || 0, owner: x['Владелец риска'] }; })
                .sort(function (a, b) { return a.code < b.code ? -1 : 1; });
            M.riskBy = {}; M.risks.forEach(function (x) { M.riskBy[x.code] = x; });
            M.ctrls = r[9].map(function (x) { return { id: x._id, code: x['Контроль'], name: x['Название контроля'], risk: x['Риск'], owner: x['Владелец контроля'], ownerLogin: x['Логин владельца'], period: x['Периодичность'], kind: x['Вид контроля'], method: x['Способ контроля'], key: x['Ключевой контроль'] === '1', evidence: x['Что приложить'] }; })
                .sort(function (a, b) { return a.code < b.code ? -1 : 1; });
            M.ctrlBy = {}; M.ctrls.forEach(function (x) { M.ctrlBy[x.code] = x; });
            M.camps = r[10].map(function (x) { return { id: x._id, name: x['Кампания подтверждения'], start: C.toIso(x['Период с']), end: C.toIso(x['Период по']), due: C.toIso(x['Срок ответа']), launch: C.toIso(x['Дата запуска']), status: x['Статус кампании'], by: x['Кто запустил'] }; })
                .sort(function (a, b) { return a.launch < b.launch ? 1 : -1; });
            M.campBy = {}; M.camps.forEach(function (x) { M.campBy[x.name] = x; });
            M.current = M.camps.filter(function (c) { return c.status === 'Идёт'; })[0] || M.camps[0] || null;
            M.reqs = r[11].map(function (x) {
                var f = P.fileOf(x['Файл подтверждения']), e = M.empByLogin[x['Логин владельца']];
                return { id: x._id, code: x['Запрос подтверждения'], campaign: x['Кампания подтверждения'], control: x['Контроль'], owner: x['Логин владельца'], ownerName: e ? e.name : x['Логин владельца'],
                    result: x['Результат контроля'], reason: x['Причина невыполнения'], file: f ? f.url : '', fileName: f ? f.name : '', answered: C.toIso(x['Дата ответа']), time: x['Время ответа'],
                    reminders: C.num(x['Напоминаний']), lastReminder: C.toIso(x['Последнее напоминание']) };
            });
            M.journal = r[12].map(function (x) { return { id: x._id, code: x['Журнал подтверждений'], request: x['Запрос подтверждения'], owner: x['Логин владельца'], action: x['Действие журнала'], author: x['Автор записи'], date: C.toIso(x['Дата записи']), time: x['Время записи'], content: x['Содержание записи'], fp: x['Отпечаток'] }; })
                .sort(function (a, b) { return a.code < b.code ? -1 : 1; });
            P.cur = M;
            return M;
        });
        return modelP;
    };
    P.resetModel = function () { modelP = null; };
    P.campReqs = function (M, camp) { return M.reqs.filter(function (r) { return camp && r.campaign === camp.name; }); };
    P.lastReq = function (M) { var m = {}; P.campReqs(M, M.current).forEach(function (r) { m[r.control] = r; }); return m; };
    P.state = function (M, r) { return C.requestState(r, M.campBy[r.campaign], M.today); };
    P.zone = function (M, score) { return C.zoneOf(score, M.zones); };

    /* ---------- запись ---------- */
    P.create = function (table, fields) { return P.post('_m_new/' + P.tid(table) + '?JSON', { up: 1, fields: fields }); };
    P.update = function (id, fields) { return P.post('_m_set/' + id + '?JSON', { fields: fields }); };
    P.batch = function (ops) {
        return P.post('_m_batch?JSON', { ops: ops }).then(function (j) {
            var res = j && (j.results || j);
            (Array.isArray(res) ? res : []).forEach(function (x) { if (x.ok === false || x.error) throw new Error(x.error || 'Ошибка пакета'); });
            return res;
        });
    };
    P.upload = function (id, table, field, file) { var f = {}; f['t' + P.fid(table, field)] = file; return P.post('_m_set/' + id + '?JSON=1', f); };
    P.now = function () { var d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); };
    /* Запись журнала: отпечаток по своей цепочке владельца; seq держит порядок записей одной секунды. */
    var seq = 0;
    P.journalEntry = function (M, req, action, content) {
        var e = { code: C.journalCode(M.today, P.now() + ('0' + new Date().getSeconds()).slice(-2), seq++), request: req.code, owner: req.owner, action: action, author: P.ctx.user, date: M.today, time: P.now(), content: content || '' };
        e = C.appendEntry(M.journal, e); M.journal.push(e);
        return { 'Журнал подтверждений': e.code, 'Запрос подтверждения': req.id || req.code, 'Логин владельца': e.owner, 'Действие журнала': e.action, 'Автор записи': e.author, 'Дата записи': e.date, 'Время записи': e.time, 'Содержание записи': e.content, 'Отпечаток': e.fp };
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
    P.btn = function (text, fn, cls) { return P.el('button', { type: 'button', 'class': 'grc-btn ' + (cls || ''), onclick: fn, text: text }); };
    P.toast = function (msg, bad) {
        var t = P.el('div', { 'class': 'grc-toast' + (bad ? ' grc-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 2800);
    };
    /* Модальное окно (не alert/confirm/prompt). */
    P.modal = function (title, body, buttons, wide) {
        var back = P.el('div', { 'class': 'grc-modal-back grc' });
        function close() { back.remove(); }
        var foot = P.el('div', { 'class': 'grc-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            return P.btn(b.text, function () { if (!b.fn || b.fn(close) !== false) { if (!b.keep) close(); } }, b.cls);
        }));
        var box = P.el('div', { 'class': 'grc-modal' + (wide ? ' grc-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [P.el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box };
    };
    P.field = function (label, input, hint) { return P.el('label', { 'class': 'grc-field' }, [P.el('span', { text: label }), input, hint ? P.el('small', { text: hint }) : null]); };
    P.select = function (opts, value) {
        var s = P.el('select', {}, opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return P.el('option', { value: v, text: t }); }));
        s.value = value === undefined ? '' : value; return s;
    };
    P.input = function (type, value, attrs) { var i = P.el('input', Object.assign({ type: type }, attrs || {})); i.value = value === undefined ? '' : value; return i; };
    P.download = function (name, text, type) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: type || 'text/csv;charset=utf-8' })); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
    };
    P.badge = function (text, kind) { return '<span class="grc-badge grc-' + (kind || 'info') + '">' + P.esc(text) + '</span>'; };
    P.tabs = function (items, active, onpick) {
        return P.el('div', { 'class': 'grc-tabs', role: 'tablist' }, items.map(function (it) {
            return P.el('button', { type: 'button', role: 'tab', 'class': 'grc-tab' + (it[0] === active ? ' grc-tab-on' : ''), 'aria-selected': it[0] === active ? 'true' : 'false', onclick: function () { onpick(it[0]); }, text: it[1] });
        }));
    };
    /* Таблица: cols = [{k, t, num, cls(r), html(r)}] */
    P.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = P.el('thead', {}, [P.el('tr', {}, cols.map(function (c) { return P.el('th', { text: c.t, 'class': c.num ? 'grc-num' : '' }); }))]);
        var tbody = P.el('tbody', {}, rows.map(function (r) {
            return P.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' grc-click' : ''), onclick: opts.onrow ? function () { opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = P.el('td', { 'class': (c.num ? 'grc-num ' : '') + (c.cls ? c.cls(r) : '') });
                    if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k];
                    return td;
                }));
        }));
        if (!rows.length) tbody.appendChild(P.el('tr', {}, [P.el('td', { colspan: cols.length, 'class': 'grc-empty', text: opts.empty || 'Нет данных' })]));
        return P.el('div', { 'class': 'grc-tablewrap' }, [P.el('table', { 'class': 'grc-table' }, [thead, tbody])]);
    };
    P.kpi = function (label, value, sub, kind) {
        return P.el('div', { 'class': 'grc-kpi' + (kind ? ' grc-kpi-' + kind : '') }, [P.el('div', { 'class': 'grc-kpi-v', html: value }), P.el('div', { 'class': 'grc-kpi-l', text: label }), sub ? P.el('div', { 'class': 'grc-kpi-s', text: sub }) : null]);
    };
    P.head = function (title, sub) { return [P.el('h1', { text: title }), P.el('p', { 'class': 'grc-sub', text: sub })]; };
    P.fail = function (e) { host.innerHTML = ''; host.appendChild(P.el('div', { 'class': 'grc-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    P.mount = function (fn) {
        if (!host) return;
        host.textContent = 'Загрузка...';
        var run = function () { P.resetModel(); return P.model().then(function (M) { host.innerHTML = ''; return fn(host, M, run); }); };
        P.meta().then(run).catch(P.fail);
    };
    P.nav = function (screen, hash) { return P.url(screen) + (hash ? '#' + hash : ''); };
    P.hash = function () { var o = {}; location.hash.replace(/^#/, '').split('&').forEach(function (p) { var a = p.split('='); if (a[0]) o[a[0]] = decodeURIComponent(a[1] || ''); }); return o; };
})();
