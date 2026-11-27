/* PSA: общий слой рабочих мест (данные, запись, окна, модель). Расчёты - в loy-core.js. */
(function () {
    'use strict';
    var C = window.LoyaltyCore;
    var P = window.Loy = { core: C };
    var host = document.getElementById('loy-app');
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
    P.canRead = function (name) { return !!(P.metaBy[name] && P.metaBy[name].granted); };

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
    /* Страницы читаются пачками параллельно: большая таблица (журнал операций) грузится в разы быстрее. */
    P.rows = function (name) {
        if (!P.canRead(name)) return Promise.resolve(null);
        var id = P.tid(name), out = [], PAGE = 700, PAR = 4;
        function batch(off) {
            var ps = [];
            for (var i = 0; i < PAR; i++) ps.push(P.get('object/' + id + '/?JSON_OBJ&NAMED&LIMIT=' + (off + i * PAGE) + ',' + PAGE, null));
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
    P.report = function (name) {
        return P.get('report/' + encodeURIComponent(name) + '?JSON_KV').then(function (j) {
            if (!Array.isArray(j)) throw new Error('Нет доступа к отчёту «' + name + '»');
            return j.map(function (o) { var r = {}; Object.keys(o).forEach(function (k) { r[k] = P.dec(o[k] === null ? '' : o[k]); }); return r; });
        });
    };
    P.bonus = function (x) { var n = Math.round(C.num(x)); return (n < 0 ? '−' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); };
    P.segKey = function (s) { return String(s || '').split(' ')[0]; };
    P.seg = function (s) { return '<span class="loy-badge loy-seg-' + P.segKey(s) + '">' + P.esc(s) + '</span>'; };

    /* ---------- модель: справочники таблицами, чеки и операции - отчётами (баланс гостя сетевой, у кассира журнал своей точки) ---------- */
    var modelP = null;
    P.model = function () {
        if (modelP) return modelP;
        var names = ['Программа лояльности', 'Механика', 'Точка', 'Вид операции', 'Акция', 'Сегмент RFM', 'Участник', 'Кампания'];
        modelP = Promise.all(names.map(function (n) { return P.rows(n).catch(function () { return null; }); }).concat([P.report('Операции участников'), P.report('Чеки участников')])).then(function (r) {
            var M = { today: P.TODAY };
            var pr = (r[0] || [])[0] || {};
            M.mechs = (r[1] || []).map(function (x) { return { id: x._id, name: x['Механика'], key: C.mechKey(x['Механика']), built: x['В базовой коробке'] === '1', desc: x['Описание механики'] }; });
            M.program = {
                id: pr._id, name: pr['Программа лояльности'] || 'Программа', mechName: pr['Механика'] || 'Кэшбэк бонусами', mech: C.mechKey(pr['Механика']),
                percent: C.num(pr['Процент начисления']) || 5, limit: C.num(pr['Лимит списания']) || 30, life: C.num(pr['Срок жизни бонусов']) || 90, nth: C.num(pr['Каждая N-я в подарок']) || 6,
                giftPrice: C.num(pr['Цена подарка']) || 220, welcome: C.num(pr['Приветственный бонус']), bonusOnPromo: pr['Бонусы на акции'] === '1', manualMax: C.num(pr['Порог ручной операции']) || 300, lostDays: C.num(pr['Дней до ухода']) || 30
            };
            M.points = (r[2] || []).map(function (x) { return x['Точка']; });
            M.kinds = {}; (r[3] || []).forEach(function (x) { M.kinds[x['Вид операции']] = { manual: x['Ручная операция'] === '1', sign: C.num(x['Знак операции']) || 1 }; });
            M.promos = (r[4] || []).map(function (x) { return { id: x._id, name: x['Акция'], from: C.toIso(x['Начало акции']), to: C.toIso(x['Конец акции']), discount: C.num(x['Скидка акции']), bonusAllowed: x['Бонусы в акцию'] === '1', cond: x['Условие акции'] }; });
            M.promoBy = P.map(M.promos, 'name');
            M.segments = (r[5] || []).map(function (x) { return { name: x['Сегмент RFM'], text: x['Что написать'], ord: C.num(x['Порядок сегмента']) }; }).sort(function (a, b) { return a.ord - b.ord; });
            M.canGuests = !!r[6];
            M.guests = (r[6] || []).map(function (x) {
                return { id: x._id, name: x['Участник'], card: x['Номер карты'], phone: x['Телефон'], birthday: C.toIso(x['Дата рождения']), reg: C.toIso(x['Дата регистрации участника']), point: x['Точка'], consent: x['Согласие на рассылку'] === '1',
                    percent: C.num(x['Личный процент начисления']), limit: C.num(x['Личный лимит списания']), rule: x['Правило участника'] || '' };
            });
            M.guestBy = P.map(M.guests, 'name');
            M.campaigns = r[7] ? r[7].map(function (x) { return { id: x._id, name: x['Кампания'], segment: x['Сегмент RFM'], date: C.toIso(x['Дата кампании']), channel: x['Канал'], sent: x['Отправлено'], back: x['Вернулись'], control: x['Контрольная группа'], controlBack: x['Вернулись из контроля'], text: x['Текст кампании'] }; }) : null;
            M.ops = r[8].map(function (x) {
                var k = M.kinds[x['Вид операции']] || {};
                return { num: x['Операция'], guest: x['Участник'], date: C.toIso(x['Дата операции']), kind: x['Вид операции'], bonus: C.num(x['Бонусы']), expires: C.toIso(x['Сгорает']), point: x['Точка'], reason: x['Причина'], author: x['Автор'], manual: !!k.manual };
            });
            M.checks = r[9].map(function (x) { return { num: x['Чек'], guest: x['Участник'], date: C.toIso(x['Дата чека']), time: x['Время'], point: x['Точка'], sum: C.num(x['Сумма']), drinks: C.num(x['Напитков']), paidBonus: C.num(x['Оплачено бонусами']), promo: x['Акция'], cashier: x['Кассир'] }; });
            P.stats(M);
            P.cur = M;
            return M;
        });
        return modelP;
    };
    /* Баланс, партии, визиты и RFM каждого гостя. */
    P.stats = function (M) {
        var opsBy = {}, chBy = {}, from90 = C.addDays(M.today, -90);
        M.ops.forEach(function (o) { (opsBy[o.guest] = opsBy[o.guest] || []).push(o); });
        M.checks.forEach(function (c) { (chBy[c.guest] = chBy[c.guest] || []).push(c); });
        M.opsBy = opsBy; M.chBy = chBy; M.st = {};
        var names = M.guests.length ? M.guests.map(function (g) { return g.name; }) : Object.keys(opsBy);
        names.forEach(function (n) {
            var ch = (chBy[n] || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
            var v = { last: ch.length ? ch[ch.length - 1].date : '', first: ch.length ? ch[0].date : '', visits90: 0, sum90: 0, visits: ch.length, sum: 0, drinks: 0 };
            ch.forEach(function (c) { v.sum += c.sum; v.drinks += c.drinks; if (c.date > from90) { v.visits90++; v.sum90 += c.sum; } });
            var L = C.lots((opsBy[n] || []).map(function (o) { return { date: o.date, bonus: o.bonus, expires: o.expires }; }), M.today);
            var g = M.guestBy[n] || {};
            M.st[n] = { v: v, lots: L, rfm: C.rfm(v, M.today, M.program.lostDays), point: g.point || (ch[0] && ch[0].point) || '' };
        });
    };
    P.resetModel = function () { modelP = null; };

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
    P.btn = function (text, fn, cls) { return P.el('button', { type: 'button', 'class': 'loy-btn ' + (cls || ''), onclick: fn, text: text }); };
    P.toast = function (msg, bad) {
        var t = P.el('div', { 'class': 'loy-toast' + (bad ? ' loy-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 2800);
    };
    /* Модальное окно (не alert/confirm/prompt). */
    P.modal = function (title, body, buttons, wide) {
        var back = P.el('div', { 'class': 'loy-modal-back' });
        function close() { back.remove(); }
        var foot = P.el('div', { 'class': 'loy-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            return P.btn(b.text, function () { if (!b.fn || b.fn(close) !== false) { if (!b.keep) close(); } }, b.cls);
        }));
        var box = P.el('div', { 'class': 'loy-modal' + (wide ? ' loy-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [P.el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box };
    };
    P.field = function (label, input, hint) { return P.el('label', { 'class': 'loy-field' }, [P.el('span', { text: label }), input, hint ? P.el('small', { text: hint }) : null]); };
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
    P.badge = function (text, kind) { return '<span class="loy-badge loy-' + (kind || 'info') + '">' + P.esc(text) + '</span>'; };
    P.tabs = function (items, active, onpick) {
        return P.el('div', { 'class': 'loy-tabs', role: 'tablist' }, items.map(function (it) {
            return P.el('button', { type: 'button', role: 'tab', 'class': 'loy-tab' + (it[0] === active ? ' loy-tab-on' : ''), 'aria-selected': it[0] === active ? 'true' : 'false', onclick: function () { onpick(it[0]); }, text: it[1] });
        }));
    };
    /* Таблица: cols = [{k, t, num, cls(r), html(r)}] */
    P.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = P.el('thead', {}, [P.el('tr', {}, cols.map(function (c) { return P.el('th', { text: c.t, 'class': c.num ? 'loy-num' : '' }); }))]);
        var tbody = P.el('tbody', {}, rows.map(function (r) {
            return P.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' loy-click' : ''), onclick: opts.onrow ? function () { opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = P.el('td', { 'class': (c.num ? 'loy-num ' : '') + (c.cls ? c.cls(r) : '') });
                    if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k];
                    return td;
                }));
        }));
        if (!rows.length) tbody.appendChild(P.el('tr', {}, [P.el('td', { colspan: cols.length, 'class': 'loy-empty', text: opts.empty || 'Нет данных' })]));
        return P.el('div', { 'class': 'loy-tablewrap' }, [P.el('table', { 'class': 'loy-table' }, [thead, tbody])]);
    };
    P.kpi = function (label, value, sub, kind) {
        return P.el('div', { 'class': 'loy-kpi' + (kind ? ' loy-kpi-' + kind : '') }, [P.el('div', { 'class': 'loy-kpi-v', html: value }), P.el('div', { 'class': 'loy-kpi-l', text: label }), sub ? P.el('div', { 'class': 'loy-kpi-s', text: sub }) : null]);
    };
    P.fail = function (e) { host.innerHTML = ''; host.appendChild(P.el('div', { 'class': 'loy-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    P.mount = function (fn) {
        if (!host) return;
        host.textContent = 'Загрузка...';
        P.meta().then(function () { return P.model(); }).then(function (M) { host.innerHTML = ''; return fn(host, M); }).catch(P.fail);
    };
    P.nav = function (screen, hash) { return P.url(screen) + (hash ? '#' + hash : ''); };
    P.hash = function () { var o = {}; location.hash.replace(/^#/, '').split('&').forEach(function (p) { var a = p.split('='); if (a[0]) o[a[0]] = decodeURIComponent(a[1] || ''); }); return o; };
    /* Создание и изменение записей (поля - по именам). */
    P.create = function (table, fields) { return P.post('_m_new/' + P.tid(table) + '?JSON', { up: 1, fields: fields }).then(function (r) { P.resetModel(); return r; }); };
    P.update = function (id, fields) { return P.post('_m_set/' + id + '?JSON', { fields: fields }).then(function (r) { P.resetModel(); return r; }); };
    /* Пакет записей одним запросом; ошибка любой операции - исключение с текстом. */
    P.batch = function (ops) { return P.post('_m_batch?JSON', { ops: ops }).then(function (r) { P.resetModel(); var bad = (r.results || []).filter(function (x) { return !x.ok; }); if (bad.length) throw new Error(bad[0].error || 'Операция не прошла'); return r; }); };
    /* Точка кассира - из названия его роли («Кассир Покровка»). */
    P.myPoint = function (M) { return M.points.filter(function (p) { return P.ctx.role.indexOf(p) >= 0; })[0] || ''; };
    P.nextNum = function (list, prefix) { var m = 0; list.forEach(function (x) { var n = parseInt(String(x.num || '').replace(/\D/g, ''), 10); if (n > m) m = n; }); return prefix + ('00000' + (m + 1)).slice(-6); };
    P.now = function () { var d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); };
    P.head = function (title, sub) { return [P.el('h1', { text: title }), P.el('p', { 'class': 'loy-sub', text: sub })]; };
    P.who = function () { return P.ctx.user; };
})();
