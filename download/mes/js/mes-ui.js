/* MES: общие компоненты экранов (DOM, окна, таблица, плитки). */
(function () {
    'use strict';
    var P = window.Mes, C = P.core;
    var host = document.getElementById('mes-app');
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
    P.btn = function (text, fn, cls, attrs) { return P.el('button', Object.assign({ type: 'button', 'class': 'mes-btn ' + (cls || ''), onclick: fn, text: text }, attrs || {})); };
    P.toast = function (msg, bad) {
        var t = P.el('div', { 'class': 'mes-toast' + (bad ? ' mes-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 2800);
    };
    /* Модальное окно (не alert/confirm/prompt). buttons: [{text, fn(close) -> false оставляет окно, cls}] */
    P.modal = function (title, body, buttons, wide) {
        var back = P.el('div', { 'class': 'mes-modal-back' });
        function close() { back.remove(); }
        var foot = P.el('div', { 'class': 'mes-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            return P.btn(b.text, function () { if (!b.fn || b.fn(close) !== false) close(); }, b.cls);
        }));
        var box = P.el('div', { 'class': 'mes-modal' + (wide ? ' mes-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [P.el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box };
    };
    P.field = function (label, input, hint) { return P.el('label', { 'class': 'mes-field' }, [P.el('span', { text: label }), input, hint ? P.el('small', { text: hint }) : null]); };
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
    P.badge = function (text, kind) { return '<span class="mes-badge mes-' + (kind || 'info') + '">' + P.esc(text) + '</span>'; };
    P.stateBadge = function (s) { return P.badge(s, { 'Ожидает': 'mute', 'В работе': 'info', 'Пауза': 'warn', 'Выполнено': 'ok' }[s] || 'mute'); };
    P.tabs = function (items, active, onpick) {
        return P.el('div', { 'class': 'mes-tabs', role: 'tablist' }, items.map(function (it) {
            return P.el('button', { type: 'button', role: 'tab', 'class': 'mes-tab' + (it[0] === active ? ' mes-tab-on' : ''), 'aria-selected': it[0] === active ? 'true' : 'false', onclick: function () { onpick(it[0]); }, text: it[1] });
        }));
    };
    /* Таблица: cols = [{k, t, num, cls(r), html(r), node(r)}] */
    P.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = P.el('thead', {}, [P.el('tr', {}, cols.map(function (c) { return P.el('th', { text: c.t, 'class': c.num ? 'mes-num' : '' }); }))]);
        var tbody = P.el('tbody', {}, rows.map(function (r) {
            return P.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' mes-click' : ''), onclick: opts.onrow ? function (e) { if (e.target.closest('button,input,select')) return; opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = P.el('td', { 'class': (c.num ? 'mes-num ' : '') + (c.cls ? c.cls(r) : '') });
                    if (c.node) { var n = c.node(r); if (n) td.appendChild(n); } else if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k];
                    return td;
                }));
        }));
        if (!rows.length) tbody.appendChild(P.el('tr', {}, [P.el('td', { colspan: cols.length, 'class': 'mes-empty', text: opts.empty || 'Нет данных' })]));
        return P.el('div', { 'class': 'mes-tablewrap' }, [P.el('table', { 'class': 'mes-table' }, [thead, tbody])]);
    };
    P.kpi = function (label, value, sub, kind) {
        return P.el('div', { 'class': 'mes-kpi' + (kind ? ' mes-kpi-' + kind : '') }, [P.el('div', { 'class': 'mes-kpi-v', html: value }), P.el('div', { 'class': 'mes-kpi-l', text: label }), sub ? P.el('div', { 'class': 'mes-kpi-s', text: sub }) : null]);
    };
    P.note = function (text, kind) { return P.el('div', { 'class': 'mes-note mes-note-' + (kind || 'info') }, [P.el('span', { 'class': 'mes-note-t', html: text })]); };
    P.head = function (title, sub) { return [P.el('h1', { text: title }), P.el('p', { 'class': 'mes-sub', text: sub })]; };
    P.fail = function (e) { host.innerHTML = ''; host.appendChild(P.el('div', { 'class': 'mes-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    /* Монтаж экрана: fn(host, M); P.redraw() перечитывает данные и рисует заново. */
    P.mount = function (fn) {
        if (!host) return;
        host.textContent = 'Загрузка...';
        P.redraw = function () { return P.reload().then(function (M) { host.innerHTML = ''; return fn(host, M); }).catch(P.fail); };
        P.meta().then(function () { return P.model(); }).then(function (M) { host.innerHTML = ''; return fn(host, M); }).catch(P.fail);
    };
    P.hash = function () { var o = {}; location.hash.replace(/^#/, '').split('&').forEach(function (p) { var a = p.split('='); if (a[0]) o[a[0]] = decodeURIComponent(a[1] || ''); }); return o; };
    P.nav = function (screen, hash) { return P.url(screen) + (hash ? '#' + hash : ''); };
    P.C = C;
})();
