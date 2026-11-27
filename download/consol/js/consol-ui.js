/* Service Consol: общие компоненты экранов (DOM, окна, таблица, таймер SLA, карточка заявки). */
(function () {
    'use strict';
    var P = window.Consol, C = P.core;
    var host = document.getElementById('consol-app');
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
    P.btn = function (text, fn, cls) { return P.el('button', { type: 'button', 'class': 'consol-btn ' + (cls || ''), onclick: fn, text: text }); };
    P.toast = function (msg, bad) {
        var t = P.el('div', { 'class': 'consol-toast' + (bad ? ' consol-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 3000);
    };
    /* Модальное окно (не alert/confirm/prompt). buttons: [{text, fn(close) -> false оставляет окно, cls}] */
    P.modal = function (title, body, buttons, wide) {
        var back = P.el('div', { 'class': 'consol-modal-back' });
        function close() { back.remove(); }
        var foot = P.el('div', { 'class': 'consol-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            var bt = P.btn(b.text, function () { var r = b.fn ? b.fn(close, bt) : true; if (r !== false) close(); }, b.cls); return bt;
        }));
        var box = P.el('div', { 'class': 'consol consol-modal' + (wide ? ' consol-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [P.el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box };
    };
    P.field = function (label, input, hint) { return P.el('label', { 'class': 'consol-field' }, [P.el('span', { text: label }), input, hint ? P.el('small', { text: hint }) : null]); };
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
    P.badge = function (text, kind) { return '<span class="consol-badge consol-' + (kind || 'info') + '">' + P.esc(text) + '</span>'; };
    P.tabs = function (items, active, onpick) {
        return P.el('div', { 'class': 'consol-tabs', role: 'tablist' }, items.map(function (it) {
            return P.el('button', { type: 'button', role: 'tab', 'class': 'consol-tab' + (it[0] === active ? ' consol-tab-on' : ''), 'aria-selected': it[0] === active ? 'true' : 'false', onclick: function () { onpick(it[0]); }, html: P.esc(it[1]) + (it[2] !== undefined ? ' <b>' + it[2] + '</b>' : '') });
        }));
    };
    /* Таблица: cols = [{k, t, num, cls(r), html(r)}] */
    P.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = P.el('thead', {}, [P.el('tr', {}, cols.map(function (c) { return P.el('th', { text: c.t, 'class': c.num ? 'consol-num' : '' }); }))]);
        var tbody = P.el('tbody', {}, rows.map(function (r) {
            return P.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' consol-click' : ''), onclick: opts.onrow ? function (e) { if (e.target.closest('button,input,select')) return; opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = P.el('td', { 'class': (c.num ? 'consol-num ' : '') + (c.cls ? c.cls(r) : '') });
                    if (c.node) td.appendChild(c.node(r)); else if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k];
                    return td;
                }));
        }));
        if (!rows.length) tbody.appendChild(P.el('tr', {}, [P.el('td', { colspan: cols.length, 'class': 'consol-empty', text: opts.empty || 'Нет данных' })]));
        return P.el('div', { 'class': 'consol-tablewrap' }, [P.el('table', { 'class': 'consol-table' }, [thead, tbody])]);
    };
    P.kpi = function (label, value, sub, kind) {
        return P.el('div', { 'class': 'consol-kpi' + (kind ? ' consol-kpi-' + kind : '') }, [P.el('div', { 'class': 'consol-kpi-v', html: value }), P.el('div', { 'class': 'consol-kpi-l', text: label }), sub ? P.el('div', { 'class': 'consol-kpi-s', text: sub }) : null]);
    };
    P.fail = function (e) { if (!host) return; host.innerHTML = ''; host.appendChild(P.el('div', { 'class': 'consol-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    P.mount = function (fn) {
        if (!host) return;
        host.textContent = 'Загрузка...';
        P.meta().then(function () { return P.model(); }).then(function (M) { host.innerHTML = ''; return fn(host, M); }).catch(P.fail);
    };
    P.head = function (title, sub) { return [P.el('h1', { text: title }), P.el('p', { 'class': 'consol-sub', text: sub })]; };
    P.hash = function () { var o = {}; location.hash.replace(/^#/, '').split('&').forEach(function (p) { var a = p.split('='); if (a[0]) o[a[0]] = decodeURIComponent(a[1] || ''); }); return o; };

})();
