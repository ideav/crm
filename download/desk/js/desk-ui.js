/* Service Desk: общие компоненты экранов (DOM, окна, таблица, таймер SLA, карточка заявки). */
(function () {
    'use strict';
    var P = window.Desk, C = P.core;
    var host = document.getElementById('desk-app');
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
    P.btn = function (text, fn, cls) { return P.el('button', { type: 'button', 'class': 'desk-btn ' + (cls || ''), onclick: fn, text: text }); };
    P.toast = function (msg, bad) {
        var t = P.el('div', { 'class': 'desk-toast' + (bad ? ' desk-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 3000);
    };
    /* Модальное окно (не alert/confirm/prompt). buttons: [{text, fn(close) -> false оставляет окно, cls}] */
    P.modal = function (title, body, buttons, wide) {
        var back = P.el('div', { 'class': 'desk-modal-back' });
        function close() { back.remove(); }
        var foot = P.el('div', { 'class': 'desk-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            var bt = P.btn(b.text, function () { var r = b.fn ? b.fn(close, bt) : true; if (r !== false) close(); }, b.cls); return bt;
        }));
        var box = P.el('div', { 'class': 'desk desk-modal' + (wide ? ' desk-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [P.el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box };
    };
    P.field = function (label, input, hint) { return P.el('label', { 'class': 'desk-field' }, [P.el('span', { text: label }), input, hint ? P.el('small', { text: hint }) : null]); };
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
    P.badge = function (text, kind) { return '<span class="desk-badge desk-' + (kind || 'info') + '">' + P.esc(text) + '</span>'; };
    P.tabs = function (items, active, onpick) {
        return P.el('div', { 'class': 'desk-tabs', role: 'tablist' }, items.map(function (it) {
            return P.el('button', { type: 'button', role: 'tab', 'class': 'desk-tab' + (it[0] === active ? ' desk-tab-on' : ''), 'aria-selected': it[0] === active ? 'true' : 'false', onclick: function () { onpick(it[0]); }, html: P.esc(it[1]) + (it[2] !== undefined ? ' <b>' + it[2] + '</b>' : '') });
        }));
    };
    /* Таблица: cols = [{k, t, num, cls(r), html(r)}] */
    P.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = P.el('thead', {}, [P.el('tr', {}, cols.map(function (c) { return P.el('th', { text: c.t, 'class': c.num ? 'desk-num' : '' }); }))]);
        var tbody = P.el('tbody', {}, rows.map(function (r) {
            return P.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' desk-click' : ''), onclick: opts.onrow ? function (e) { if (e.target.closest('button,input,select')) return; opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = P.el('td', { 'class': (c.num ? 'desk-num ' : '') + (c.cls ? c.cls(r) : '') });
                    if (c.node) td.appendChild(c.node(r)); else if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k];
                    return td;
                }));
        }));
        if (!rows.length) tbody.appendChild(P.el('tr', {}, [P.el('td', { colspan: cols.length, 'class': 'desk-empty', text: opts.empty || 'Нет данных' })]));
        return P.el('div', { 'class': 'desk-tablewrap' }, [P.el('table', { 'class': 'desk-table' }, [thead, tbody])]);
    };
    P.kpi = function (label, value, sub, kind) {
        return P.el('div', { 'class': 'desk-kpi' + (kind ? ' desk-kpi-' + kind : '') }, [P.el('div', { 'class': 'desk-kpi-v', html: value }), P.el('div', { 'class': 'desk-kpi-l', text: label }), sub ? P.el('div', { 'class': 'desk-kpi-s', text: sub }) : null]);
    };
    P.fail = function (e) { if (!host) return; host.innerHTML = ''; host.appendChild(P.el('div', { 'class': 'desk-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    P.mount = function (fn) {
        if (!host) return;
        host.textContent = 'Загрузка...';
        P.meta().then(function () { return P.model(); }).then(function (M) { host.innerHTML = ''; return fn(host, M); }).catch(P.fail);
    };
    P.head = function (title, sub) { return [P.el('h1', { text: title }), P.el('p', { 'class': 'desk-sub', text: sub })]; };
    P.hash = function () { var o = {}; location.hash.replace(/^#/, '').split('&').forEach(function (p) { var a = p.split('='); if (a[0]) o[a[0]] = decodeURIComponent(a[1] || ''); }); return o; };

    /* ---------- SLA и заявка ---------- */
    var SLA_TEXT = { ok: 'в срок', warn: 'скоро срок', breach: 'просрочена', paused: 'на паузе', met: 'решена в срок', missed: 'решена с просрочкой', stopped: 'остановлен' };
    var SLA_KIND = { ok: 'good', warn: 'warn', breach: 'bad', paused: 'info', met: 'good', missed: 'bad', stopped: 'info' };
    P.slaText = function (s) { return SLA_TEXT[s.state] || s.state; };
    /* Таймер: полоса доли израсходованного срока и подпись «осталось / просрочено». */
    P.timer = function (t) {
        var s = t.sla, w = Math.min(100, Math.max(2, s.pct));
        var label = s.state === 'met' || s.state === 'missed' ? P.slaText(s) : s.state === 'paused' ? 'пауза, ' + C.humanLeft(s.left) : C.humanLeft(s.left);
        return '<div class="desk-timer desk-t-' + s.state + '" title="Срок решения ' + P.esc(C.fmtShort(s.deadline)) + ', израсходовано ' + s.pct + '% рабочего времени"><i style="width:' + w + '%"></i><span>' + P.esc(label) + '</span></div>';
    };
    P.slaBadge = function (t) { return P.badge(P.slaText(t.sla), SLA_KIND[t.sla.state]); };
    P.statusBadge = function (M, t, human) {
        var st = M.statusBy[t.status], k = { 'Новая': 'info', 'На согласовании': 'violet', 'Ждём заявителя': 'warn', 'Решена': 'good', 'Закрыта': 'muted', 'Отклонена': 'bad' }[t.status] || 'info';
        return P.badge(human && st && st.human ? st.human : t.status, k);
    };
    P.timeline = function (M, num) {
        var ev = M.events.filter(function (e) { return e.num === num; });
        return P.el('ol', { 'class': 'desk-timeline' }, ev.map(function (e) { return P.el('li', {}, [P.el('time', { text: C.fmtShort(e.when) }), P.el('b', { text: e.who }), P.el('span', { text: e.text })]); }));
    };
    P.routeView = function (M, num) {
        var ap = M.approvals.filter(function (a) { return a.num === num; }).sort(function (a, b) { return a.step - b.step; });
        if (!ap.length) return null;
        return P.el('div', { 'class': 'desk-route' }, ap.map(function (a) {
            var k = a.decision === 'Согласовано' ? 'good' : a.decision === 'Отклонено' ? 'bad' : 'warn';
            return P.el('div', { 'class': 'desk-step desk-step-' + k, html: '<b>Шаг ' + a.step + '</b> ' + P.esc(a.who) + '<br><small>' + P.esc(a.decision ? a.decision + ' ' + C.fmtShort(a.date) : 'ждёт решения') + '</small>' });
        }));
    };
    /* Карточка заявки: суть, срок, маршрут, ход. extra - узлы действий. */
    P.ticketCard = function (M, t, extra) {
        var body = P.el('div', {}, [
            P.el('div', { 'class': 'desk-grid2' }, [
                P.el('div', { html: '<small class="desk-muted">Услуга</small><br>' + P.esc(t.service) + ' <span class="desk-muted">(' + P.esc(t.dept) + ')</span>' }),
                P.el('div', { html: '<small class="desk-muted">Заявитель</small><br>' + P.esc(t.emp) + (t.room ? ', пом. ' + P.esc(t.room) : '') }),
                P.el('div', { html: '<small class="desk-muted">Статус</small><br>' + P.statusBadge(M, t) + ' ' + P.slaBadge(t) }),
                P.el('div', { html: '<small class="desk-muted">Исполнитель</small><br>' + P.esc(t.exec || 'не назначен') }),
                P.el('div', { html: '<small class="desk-muted">Создана / срок решения</small><br>' + P.esc(C.fmtShort(t.created)) + ' / <b>' + P.esc(C.fmtShort(t.sla.deadline)) + '</b>' }),
                P.el('div', { html: '<small class="desk-muted">Приоритет, канал</small><br>' + P.esc(t.prio) + ', ' + P.esc(t.channel) })
            ]),
            P.el('div', { html: P.timer(t) }),
            P.el('pre', { 'class': 'desk-descr', text: t.descr || t.topic }),
            t.answer ? P.el('p', { html: '<b>Решение:</b> ' + P.esc(t.answer) }) : null,
            t.photo ? P.el('a', { href: t.photo, target: '_blank', rel: 'noopener', 'class': 'desk-photo' }, [P.el('img', { src: t.photo, alt: 'Фото результата' })]) : null,
            P.routeView(M, t.num),
            P.el('h3', { text: 'Ход заявки' }), P.timeline(M, t.num)
        ].concat(extra || []));
        return P.modal(t.num + ': ' + t.topic, body, null, true);
    };
})();
