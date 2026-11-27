/* Адаптация персонала: общие компоненты экранов (DOM, окна, таблица, вкладки, светофор, карточка новичка с чек-листом по ролям). */
(function () {
    'use strict';
    var P = window.Onb, C = P.core;
    var host = document.getElementById('onboard-app');
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
    P.btn = function (text, fn, cls) { return P.el('button', { type: 'button', 'class': 'ob-btn ' + (cls || ''), onclick: fn, text: text }); };
    P.toast = function (msg, bad) {
        var t = P.el('div', { 'class': 'ob-toast' + (bad ? ' ob-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 3000);
    };
    /* Модальное окно (не alert/confirm/prompt). buttons: [{text, fn(close) -> false оставляет окно, cls}] */
    P.modal = function (title, body, buttons, wide) {
        var back = P.el('div', { 'class': 'ob-modal-back' });
        function close() { back.remove(); }
        var foot = P.el('div', { 'class': 'ob-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            var bt = P.btn(b.text, function () { var r = b.fn ? b.fn(close, bt) : true; if (r !== false) close(); }, b.cls); return bt;
        }));
        var box = P.el('div', { 'class': 'ob ob-modal' + (wide ? ' ob-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [P.el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box };
    };
    P.field = function (label, input, hint) { return P.el('label', { 'class': 'ob-field' }, [P.el('span', { text: label }), input, hint ? P.el('small', { text: hint }) : null]); };
    P.select = function (opts, value) {
        var s = P.el('select', {}, opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return P.el('option', { value: v, text: t }); }));
        s.value = value === undefined ? '' : value; return s;
    };
    P.input = function (type, value, attrs) { var i = P.el(type === 'textarea' ? 'textarea' : 'input', Object.assign(type === 'textarea' ? { rows: 3 } : { type: type }, attrs || {})); i.value = value === undefined ? '' : value; return i; };
    P.download = function (name, text) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
    };
    P.badge = function (text, kind) { return '<span class="ob-badge ob-' + (kind || 'info') + '">' + P.esc(text) + '</span>'; };
    P.tabs = function (items, active, onpick) {
        return P.el('div', { 'class': 'ob-tabs', role: 'tablist' }, items.map(function (it) {
            return P.el('button', { type: 'button', role: 'tab', 'class': 'ob-tab' + (it[0] === active ? ' ob-tab-on' : ''), 'aria-selected': it[0] === active ? 'true' : 'false', onclick: function () { onpick(it[0]); }, html: P.esc(it[1]) + (it[2] !== undefined ? ' <b>' + it[2] + '</b>' : '') });
        }));
    };
    /* Таблица: cols = [{k, t, num, cls(r), html(r)}] */
    P.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = P.el('thead', {}, [P.el('tr', {}, cols.map(function (c) { return P.el('th', { text: c.t, 'class': c.num ? 'ob-num' : '' }); }))]);
        var tbody = P.el('tbody', {}, rows.map(function (r) {
            return P.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' ob-click' : ''), onclick: opts.onrow ? function (e) { if (e.target.closest('button,input,select')) return; opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = P.el('td', { 'class': (c.num ? 'ob-num ' : '') + (c.cls ? c.cls(r) : '') });
                    if (c.node) td.appendChild(c.node(r)); else if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k];
                    return td;
                }));
        }));
        if (!rows.length) tbody.appendChild(P.el('tr', {}, [P.el('td', { colspan: cols.length, 'class': 'ob-empty', text: opts.empty || 'Нет данных' })]));
        return P.el('div', { 'class': 'ob-tablewrap' }, [P.el('table', { 'class': 'ob-table' }, [thead, tbody])]);
    };
    P.kpi = function (label, value, sub, kind) {
        return P.el('div', { 'class': 'ob-kpi' + (kind ? ' ob-kpi-' + kind : '') }, [P.el('div', { 'class': 'ob-kpi-v', html: value }), P.el('div', { 'class': 'ob-kpi-l', text: label }), sub ? P.el('div', { 'class': 'ob-kpi-s', text: sub }) : null]);
    };
    P.fail = function (e) { if (!host) return; host.innerHTML = ''; host.appendChild(P.el('div', { 'class': 'ob-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    P.mount = function (fn) {
        if (!host) return;
        host.textContent = 'Загрузка...';
        P.meta().then(function () { return P.model(); }).then(function (M) { host.innerHTML = ''; return fn(host, M); }).catch(P.fail);
    };
    P.head = function (title, sub) { return [P.el('h1', { text: title }), P.el('p', { 'class': 'ob-sub', text: sub })]; };
    P.hash = function () { var o = {}; location.hash.replace(/^#/, '').split('&').forEach(function (p) { var a = p.split('='); if (a[0]) o[a[0]] = decodeURIComponent(a[1] || ''); }); return o; };

    /* ---------- светофор и карточка новичка ---------- */
    var LIGHT = { red: 'застрял', yellow: 'срок на носу', green: 'в графике' };
    P.lightHtml = function (n) {
        var l = n.light, h = '<span class="ob-light ob-light-' + l.color + '" title="' + LIGHT[l.color] + '"></span>';
        if (l.reasons.length) h += l.reasons.slice(0, 2).map(function (r) { return '<span class="ob-why">' + P.esc(r.text) + ' (' + C.plural(r.days, 'день', 'дня', 'дней') + ')</span>'; }).join('');
        else if (l.soon.length) h += '<span class="ob-why ob-why-soon">скоро: ' + P.esc(l.soon[0].name) + ' до ' + C.fmtDM(l.soon[0].due) + '</span>';
        else h += '<span class="ob-muted">' + LIGHT[l.color] + '</span>';
        return h;
    };
    P.probText = function (n) {
        var p = n.prob;
        if (p.day === null) return '';
        if (p.before) return 'выход через ' + C.plural(-p.day, 'день', 'дня', 'дней');
        return 'день ' + p.day + ' из ' + p.len + (n.status === 'Продлён испытательный' ? ' (продлён)' : '');
    };
    P.pbar = function (pct, bad) { return '<div class="ob-pbar' + (bad ? ' ob-pbar-bad' : '') + '"><i style="width:' + Math.max(2, pct) + '%"></i><span>' + pct + '%</span></div>'; };
    P.statusBadge = function (s) {
        var k = { 'Оффер принят': 'violet', 'Подготовка к выходу': 'info', 'Испытательный срок': 'info', 'Продлён испытательный': 'warn', 'Прошёл испытательный': 'good', 'Ушёл на испытательном': 'bad', 'Отказался до выхода': 'muted' }[s] || 'info';
        return P.badge(s, k);
    };
    var ST_TEXT = { done: 'сделано', late: 'сделано с опозданием', overdue: 'просрочено', soon: 'скоро срок', wait: 'по плану' };
    /* Может ли текущий пользователь отметить шаг: запись разрешена и шаг его (HR и администратор отмечают любой). */
    P.canMark = function (s) { return P.canWrite('Шаг новичка') && !(s.done !== null && s.done !== undefined) && (s.execLogin === P.ctx.user || P.ctx.role === 'admin' || /^hr/i.test(P.ctx.role)); };
    P.markDone = function (M, n, s, comment) {
        var f = { 'Дата выполнения': C.fmtD(M.today) }; if (comment) f['Комментарий шага'] = comment;
        var ops = [{ op: 'set', id: s.id, fields: f }];
        if (P.canWrite('Ход адаптации') && !n.partial) ops.push(P.evOp(n, P.myName(M), 'Сделано: ' + s.name + (comment ? ' - ' + comment : '')));
        return P.batch(ops);
    };
    P.stepLi = function (M, n, s, onDone) {
        var st = C.stepState(s, M.today, M.rules.warn);
        var right = P.el('span', { 'class': 'ob-due', text: s.done !== null && s.done !== undefined ? 'сделано ' + C.fmtDM(s.done) : 'до ' + C.fmtDM(s.due) + ' ' + C.wd(s.due) });
        var li = P.el('li', { 'class': 'ob-st-' + st, title: ST_TEXT[st] }, [P.el('span', { 'class': 'ob-mark' }),
            P.el('div', {}, [P.el('div', { text: s.name }), P.el('small', { 'class': 'ob-muted', text: s.exec + (s.comment ? ' · ' + s.comment : '') }), s.hidden ? P.el('div', { 'class': 'ob-hidden', text: 'новичок не видит' }) : null]),
            P.el('div', { 'class': 'ob-acts' }, [right, onDone && P.canMark(s) ? P.btn('Сделано', function () { onDone(s); }, 'ob-small') : null])]);
        return li;
    };
    /* Чек-лист по ролям: HR, кадры, ИТ, АХО, СБ, руководитель, наставник, новичок. */
    P.checklist = function (M, n, onDone) {
        var by = {}; n.steps.forEach(function (s) { (by[s.role] = by[s.role] || []).push(s); });
        return P.el('div', { 'class': 'ob-roles' }, M.roles.filter(function (r) { return by[r.name]; }).map(function (r) {
            var list = by[r.name], d = list.filter(function (s) { return s.done !== null; }).length, bad = list.some(function (s) { return C.stepState(s, M.today, M.rules.warn) === 'overdue'; });
            return P.el('div', { 'class': 'ob-role' }, [P.el('h4', { html: P.esc(r.name) + ' <small class="' + (bad ? 'ob-red' : '') + '">' + d + ' из ' + list.length + '</small>' }),
                P.el('ul', { 'class': 'ob-chk' }, list.map(function (s) { return P.stepLi(M, n, s, onDone); }))]);
        }));
    };
    P.timeline = function (M, n) {
        var ev = M.events.filter(function (e) { return e.nbId === n.id; });
        if (!ev.length) return null;
        return P.el('ol', { 'class': 'ob-timeline' }, ev.map(function (e) { return P.el('li', {}, [P.el('time', { text: String(e.when).slice(0, 16) }), P.el('b', { text: e.who }), P.el('span', { text: e.text })]); }));
    };
    P.newbieCard = function (M, n, extra, onChange) {
        var m;
        function done(s) { P.markDone(M, n, s).then(function () { m.close(); P.toast('Отмечено: ' + s.name); if (onChange) onChange(); }).catch(function (e) { P.toast(e.message, true); }); }
        var body = P.el('div', {}, [
            P.el('div', { 'class': 'ob-grid2' }, [
                P.el('div', { html: '<small class="ob-muted">Должность, подразделение</small><br>' + P.esc(n.pos) + ', ' + P.esc(n.dept) }),
                P.el('div', { html: '<small class="ob-muted">Статус</small><br>' + P.statusBadge(n.status) + ' ' + P.esc(P.probText(n)) }),
                P.el('div', { html: '<small class="ob-muted">Оффер / выход</small><br>' + P.esc(C.fmtD(n.offer)) + ' / <b>' + P.esc(C.fmtD(n.start)) + '</b>' }),
                P.el('div', { html: '<small class="ob-muted">Наставник</small><br>' + P.esc(n.mentor || 'не назначен') }),
                P.el('div', { html: '<small class="ob-muted">Маршрут</small><br>' + P.esc(n.route ? n.route.name : '-') }),
                P.el('div', { html: '<small class="ob-muted">Выполнено шагов</small><br>' + P.pbar(n.prog.pct, n.light.color === 'red') })
            ]),
            P.el('div', { html: P.lightHtml(n) }),
            n.decision ? P.el('p', { html: '<b>Решение: ' + P.esc(n.decision) + '</b> ' + P.esc(C.fmtD(n.ddate)) + (n.reason ? ', причина: ' + P.esc(n.reason) : '') + (n.comment ? '<br>' + P.esc(n.comment) : '') }) : null,
            n.steps.length ? P.checklist(M, n, done) : P.el('p', { 'class': 'ob-note', text: 'Маршрут ещё не запущен: шагов нет.' }),
            P.timeline(M, n) ? P.el('h3', { text: 'Ход адаптации' }) : null, P.timeline(M, n)
        ].concat(extra || []));
        m = P.modal(n.name, body, null, true);
        return m;
    };
})();
