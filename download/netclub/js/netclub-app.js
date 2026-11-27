/* Бизнес-клуб: общий слой рабочих мест (данные, запись, окна, модель). Расчёты - в netclub-core.js. */
(function () {
    'use strict';
    var C = window.NetclubCore;
    var N = window.Netclub = { core: C };
    var host = document.getElementById('nc-app');
    var ds = host ? host.dataset : {};
    N.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };
    N.rk = C.roleKey(N.ctx.role);
    N.TODAY = '2026-11-26'; /* дата демо */

    N.dec = function (s) { return typeof s === 'string' ? s.replace(/&comma;/g, ',') : s; };
    N.esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    N.url = function (p) { return '/' + N.ctx.db + '/' + p; };
    N.get = function (p, init) {
        return fetch(N.url(p), Object.assign({ credentials: 'same-origin', cache: 'no-store' }, init || {})).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + p);
            return r.json();
        });
    };
    /* POST с XSRF; вложенные объекты уходят JSON-строкой. */
    N.post = function (p, fields) {
        var fd = new FormData();
        fd.append('_xsrf', N.ctx.xsrf);
        Object.keys(fields || {}).forEach(function (k) { var v = fields[k]; fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v); });
        return fetch(N.url(p), { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (j) { var e = Array.isArray(j) ? j[0] : j; if (e && e.error) throw new Error(e.error); return j; });
    };
    var metaP = null;
    N.meta = function () { return metaP || (metaP = N.get('metadata?JSON=1').then(function (m) { var by = {}; m.forEach(function (t) { by[t.val] = t; }); N.metaBy = by; return by; })); };
    N.tid = function (name) { return N.metaBy[name] && N.metaBy[name].id; };
    N.canRead = function (name) { return !!(N.metaBy[name] && N.metaBy[name].granted); };

    function norm(o) {
        var r = { _id: String(o.id), _ref: {} };
        Object.keys(o).forEach(function (k) {
            if (k === 'id' || k === 'up' || k === 'ord') return;
            var v = o[k];
            if (v && typeof v === 'object') { if (v.id !== undefined) { r[k] = N.dec(v.val); r._ref[k] = String(v.id); } return; }
            r[k] = v === null ? '' : N.dec(v);
        });
        return r;
    }
    /* Таблица целиком по именам полей; нет доступа - null (экран показывает только разрешённое роли). */
    N.rows = function (name) {
        if (!N.canRead(name)) return Promise.resolve(null);
        return N.get('object/' + N.tid(name) + '/?JSON_OBJ&NAMED&LIMIT=0,2000').then(function (j) {
            if (!Array.isArray(j)) throw new Error('Нет доступа к таблице «' + name + '»');
            return j.map(norm);
        }).catch(function (e) { if (/HTTP 403/.test(e.message)) return null; throw e; });
    };
    N.report = function (name) { return N.get('report/' + encodeURIComponent(name) + '?JSON_KV').catch(function () { return null; }); };
    var D = C.toIso, n = C.num;
    /* ---------- модель: все таблицы одним слоем ---------- */
    var modelP = null;
    N.model = function () {
        if (modelP) return modelP;
        var names = ['Тариф членства', 'Сфера деятельности', 'Площадка', 'Участник', 'Заявка на вступление', 'Взнос', 'Событие', 'Запись на событие', 'Рассылка', 'Запрос на знакомство', 'Настройка клуба'];
        modelP = Promise.all(names.map(N.rows).concat([N.report('Места на событиях')])).then(function (r) {
            var M = { today: N.TODAY, rk: N.rk };
            M.tariffs = (r[0] || []).map(function (x) { return { id: x._id, name: x['Тариф членства'], sum: n(x['Взнос за период']), months: n(x['Месяцев в периоде']) || 12, descr: x['Описание тарифа'] }; });
            M.tariffBy = N.map(M.tariffs, 'name');
            M.spheres = (r[1] || []).map(function (x) { return x['Сфера деятельности']; });
            M.venues = (r[2] || []).map(function (x) { return { name: x['Площадка'], address: x['Адрес площадки'], cap: n(x['Вместимость']) }; });
            M.members = (r[3] || []).map(function (x) {
                return { id: x._id, name: x['Участник'], company: x['Компания'], position: x['Должность'], sphere: x['Сфера деятельности'] || '', city: x['Город'], status: x['Статус участника'], tariff: x['Тариф членства'] || '',
                    joined: D(x['Дата вступления']), until: D(x['Членство до']), sponsor: x['Поручитель'] || '', phone: x['Телефон'] || '', email: x['Email'] || '', login: x['Логин участника'] || '',
                    does: x['Чем занимаюсь'] || '', seeks: x['Что ищу'] || '', offers: x['Чем могу помочь'] || '', left: D(x['Дата выхода']), leftReason: x['Причина выхода'] || '' };
            });
            M.memberBy = N.map(M.members, 'name'); M.memberById = N.map(M.members, 'id');
            M.apps = r[4] && r[4].map(function (x) {
                return { id: x._id, name: x['Заявка на вступление'], company: x['Компания'], position: x['Должность'], sphere: x['Сфера деятельности'] || '', city: x['Город'], tariff: x['Тариф членства'] || '', turnover: x['Оборот компании'] || '',
                    sponsor: x['Поручитель'] || '', source: x['Источник заявки'] || '', date: D(x['Дата заявки']), stage: x['Этап заявки'], interview: D(x['Дата интервью']), comment: x['Комментарий решения'] || '',
                    phone: x['Телефон'] || '', email: x['Email'] || '', does: x['Чем занимаюсь'] || '', seeks: x['Что ищу'] || '', offers: x['Чем могу помочь'] || '' };
            });
            M.fees = (r[5] || []).map(function (x) {
                return { id: x._id, no: x['Взнос'], member: x['Участник'], memberId: x._ref['Участник'], tariff: x['Тариф членства'] || '', sum: n(x['Сумма взноса']), from: D(x['Период с']), to: D(x['Период по']), due: D(x['Срок оплаты']),
                    paid: D(x['Дата оплаты']), status: x['Статус взноса'], method: x['Способ оплаты'] || '', login: x['Логин плательщика'] || '', rem: n(x['Напоминаний отправлено']) };
            });
            M.events = (r[6] || []).map(function (x) {
                return { id: x._id, name: x['Событие'], format: x['Формат события'], date: D(x['Дата события']), time: x['Время начала'] || '', venue: x['Площадка'] || '', limit: n(x['Лимит мест']), price: n(x['Стоимость участия']), status: x['Статус события'] || '', host: x['Ведущий'] || '', descr: x['Описание события'] || '' };
            }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
            M.eventBy = N.map(M.events, 'name');
            M.regs = (r[7] || []).map(function (x) { return { id: x._id, name: x['Запись на событие'], event: x['Событие'], member: x['Участник'], status: x['Статус записи'], date: D(x['Дата записи']), ord: n(x['Порядок записи']), login: x['Логин участника'] || '' }; });
            M.mailings = r[8] && r[8].map(function (x) { return { id: x._id, name: x['Рассылка'], segment: x['Сегмент рассылки'], channel: x['Канал рассылки'], event: x['Событие'] || '', text: x['Текст рассылки'] || '', date: D(x['Дата рассылки']), count: n(x['Получателей']), list: x['Список получателей'] || '', by: x['Отправил'] || '' }; });
            M.intros = (r[9] || []).map(function (x) { return { id: x._id, no: x['Запрос на знакомство'], from: x['Инициатор'], to: x['Кому знакомство'], reason: x['Повод знакомства'] || '', status: x['Статус знакомства'] || '', date: D(x['Дата запроса']), login: x['Логин участника'] || '' }; });
            var sv = {}; M.settingRows = {}; (r[10] || []).forEach(function (x) { sv[x['Настройка клуба']] = x['Значение настройки']; M.settingRows[x['Настройка клуба']] = x; });
            M.settings = C.parseSettings(sv);
            M.seatRows = r[11];
            M.me = M.members.filter(function (m) { return m.login && m.login === N.ctx.user; })[0] || null;
            N.cur = M;
            return M;
        });
        return modelP;
    };
    N.resetModel = function () { modelP = null; };
    N.map = function (rows, key) { var m = {}; (rows || []).forEach(function (r) { m[r[key]] = r; }); return m; };

    /* ---------- DOM ---------- */
    N.el = function (tag, attrs, kids) {
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
    N.btn = function (text, fn, cls) { return N.el('button', { type: 'button', 'class': 'nc-btn ' + (cls || ''), onclick: fn, text: text }); };
    N.toast = function (msg, bad) {
        var t = N.el('div', { 'class': 'nc-toast' + (bad ? ' nc-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 3500);
    };
    /* Модальное окно (не alert/confirm/prompt). Кнопка с fn, вернувшей промис, ждёт его и закрывает окно после успеха. */
    N.modal = function (title, body, buttons, wide) {
        var back = N.el('div', { 'class': 'nc-modal-back' });
        function close() { back.remove(); }
        var foot = N.el('div', { 'class': 'nc-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            var bt = N.btn(b.text, function () {
                if (!b.fn) return close();
                var r = b.fn(close);
                if (r && r.then) { bt.disabled = true; r.then(function (v) { if (v !== false) close(); else bt.disabled = false; }, function (e) { bt.disabled = false; N.toast(e.message || String(e), true); }); }
                else if (r !== false) close();
            }, b.cls);
            return bt;
        }));
        var box = N.el('div', { 'class': 'nc-modal' + (wide ? ' nc-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [N.el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box };
    };
    N.field = function (label, input, hint) { return N.el('label', { 'class': 'nc-field' }, [N.el('span', { text: label }), input, hint ? N.el('small', { text: hint }) : null]); };
    N.select = function (opts, value) {
        var s = N.el('select', {}, opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return N.el('option', { value: v, text: t }); }));
        s.value = value === undefined ? '' : value; return s;
    };
    N.input = function (type, value, attrs) { var i = N.el(type === 'textarea' ? 'textarea' : 'input', Object.assign(type === 'textarea' ? { rows: 4 } : { type: type }, attrs || {})); i.value = value === undefined ? '' : value; return i; };
    N.download = function (name, text) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
    };
    N.badge = function (text, kind) { return '<span class="nc-badge nc-' + (kind || 'info') + '">' + N.esc(text) + '</span>'; };
    N.tabs = function (items, active, onpick) {
        return N.el('div', { 'class': 'nc-tabs', role: 'tablist' }, items.map(function (it) {
            return N.el('button', { type: 'button', role: 'tab', 'class': 'nc-tab' + (it[0] === active ? ' nc-tab-on' : ''), 'aria-selected': it[0] === active ? 'true' : 'false', onclick: function () { onpick(it[0]); }, text: it[1] });
        }));
    };
    /* Таблица: cols = [{k, t, num, cls(r), html(r)}] */
    N.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = N.el('thead', {}, [N.el('tr', {}, cols.map(function (c) { return N.el('th', { text: c.t, 'class': c.num ? 'nc-num' : '' }); }))]);
        var tbody = N.el('tbody', {}, rows.map(function (r) {
            return N.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' nc-click' : ''), onclick: opts.onrow ? function (e) { if (e.target.closest('button')) return; opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = N.el('td', { 'class': (c.num ? 'nc-num ' : '') + (c.cls ? c.cls(r) : '') });
                    if (c.node) { var nd = c.node(r); if (nd) td.appendChild(nd); } else if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k];
                    return td;
                }));
        }));
        if (!rows.length) tbody.appendChild(N.el('tr', {}, [N.el('td', { colspan: cols.length, 'class': 'nc-empty', text: opts.empty || 'Нет данных' })]));
        return N.el('div', { 'class': 'nc-tablewrap' }, [N.el('table', { 'class': 'nc-table' }, [thead, tbody])]);
    };
    N.kpi = function (label, value, sub, kind, onclick) {
        return N.el(onclick ? 'button' : 'div', { type: onclick ? 'button' : undefined, onclick: onclick, 'class': 'nc-kpi' + (kind ? ' nc-kpi-' + kind : '') + (onclick ? ' nc-click' : '') }, [N.el('div', { 'class': 'nc-kpi-v', html: value }), N.el('div', { 'class': 'nc-kpi-l', text: label }), sub ? N.el('div', { 'class': 'nc-kpi-s', text: sub }) : null]);
    };
    N.fail = function (e) { host.innerHTML = ''; host.appendChild(N.el('div', { 'class': 'nc-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    var render = null;
    N.mount = function (fn) {
        if (!host) return;
        render = fn;
        host.textContent = 'Загрузка...';
        N.meta().then(function () { return N.model(); }).then(function (M) { host.innerHTML = ''; return fn(host, M); }).catch(N.fail);
    };
    /* Перерисовать экран со свежей моделью (после записи). */
    N.refresh = function () { N.resetModel(); return N.model().then(function (M) { host.innerHTML = ''; return render(host, M); }).catch(N.fail); };
    N.head = function (title, sub) { return [N.el('div', { 'class': 'nc-club', text: N.cur && N.cur.settings.club || '' }), N.el('h1', { text: title }), N.el('p', { 'class': 'nc-sub', text: sub })]; };
    N.dmy = C.toDmy; N.money = C.money;
    /* Создание и изменение записей (поля - по именам). */
    N.create = function (table, fields) {
        Object.keys(fields).forEach(function (k) { if (fields[k] === '' || fields[k] === undefined || fields[k] === null) delete fields[k]; });
        return N.post('_m_new/' + N.tid(table) + '?JSON', { up: 1, fields: fields });
    };
    N.update = function (id, fields) { return N.post('_m_set/' + id + '?JSON', { fields: fields }); };
    N.feeBadge = function (f) { var st = C.feeState(f, N.TODAY); return N.badge(C.feeLabel(st) + (st === 'overdue' ? ' ' + C.diffDays(f.due, N.TODAY) + ' дн.' : ''), { paid: 'ok', overdue: 'bad', due: 'warn', 'void': 'muted' }[st]); };
    N.statusBadge = function (s) { return N.badge(s, { 'Активен': 'ok', 'Принят': 'info', 'Приостановлен': 'warn', 'Вышел': 'muted' }[s] || 'info'); };
    /* Выставить счёт на продление по тарифу участника. */
    N.issueRenewal = function (M, m) {
        var t = M.tariffBy[m.tariff];
        if (!t) { N.toast('У участника не указан тариф', true); return Promise.resolve(false); }
        var inv = C.renewalInvoice(m, t, M.fees, N.TODAY);
        return N.create('Взнос', { 'Взнос': inv.no, 'Участник': m.id, 'Тариф членства': t.id, 'Сумма взноса': inv.sum, 'Период с': inv.from, 'Период по': inv.to, 'Срок оплаты': inv.due, 'Статус взноса': 'Выставлен', 'Логин плательщика': inv.login || C.loginFor(m.name), 'Напоминаний отправлено': 0 })
            .then(function () { N.toast('Счёт ' + inv.no + ' на ' + C.money(inv.sum) + ' выставлен: ' + m.name); N.refresh(); });
    };

    N.isStaff = function () { return N.rk !== 'member'; };
})();
