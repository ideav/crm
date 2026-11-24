/* CPQ: общий слой рабочих мест (данные, запись, окна, таблицы). Расчёты - в cpq-core.js. */
(function () {
    'use strict';
    var Core = window.CpqCore;
    var W = window.Cpq = { core: Core };
    var host = document.getElementById('cpq-app');
    var ds = host ? host.dataset : {};
    W.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };
    W.TODAY = '2026-11-23'; /* дата демо */

    W.dec = function (s) { return typeof s === 'string' ? s.replace(/&comma;/g, ',') : s; };
    W.esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    W.url = function (p) { return '/' + W.ctx.db + '/' + p; };
    W.get = function (p) {
        return fetch(W.url(p), { credentials: 'same-origin' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + p);
            return r.json();
        });
    };
    /* POST с XSRF; fields - объект значений, вложенные объекты уходят JSON-строкой. */
    W.post = function (p, fields) {
        var fd = new FormData();
        fd.append('_xsrf', W.ctx.xsrf);
        Object.keys(fields || {}).forEach(function (k) {
            var v = fields[k]; fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v);
        });
        return fetch(W.url(p), { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (j) {
                var e = Array.isArray(j) ? j[0] : j;
                if (e && e.error) throw new Error(e.error);
                return j;
            });
    };
    var metaP = null;
    W.meta = function () { return metaP || (metaP = W.get('metadata?JSON=1').then(function (m) { var by = {}; m.forEach(function (t) { by[t.val] = t; }); W.metaBy = by; return by; })); };
    W.tid = function (name) { return W.metaBy[name] && W.metaBy[name].id; };
    W.canWrite = function (name) { return !!(W.metaBy[name] && W.metaBy[name].granted === 'WRITE'); };
    W.canRead = function (name) { return !!W.metaBy[name]; };

    /* Запись NAMED -> плоский объект: ссылки как строка значения, id ссылок в _ref, счётчики подчинённых пропускаются. */
    function norm(o) {
        var r = { _id: String(o.id), _up: String(o.up), _ref: {} };
        Object.keys(o).forEach(function (k) {
            if (k === 'id' || k === 'up' || k === 'ord') return;
            var v = o[k];
            if (v && typeof v === 'object') { if (v.id !== undefined) { r[k] = W.dec(v.val); r._ref[k] = String(v.id); } return; }
            r[k] = v === null ? '' : W.dec(v);
        });
        return r;
    }
    W.rows = function (name, up) {
        var id = W.tid(name), out = [], PAGE = 2000;
        function page(off) {
            return W.get('object/' + id + '/?JSON_OBJ&NAMED&LIMIT=' + off + ',' + PAGE + (up ? '&F_U=' + up : '')).then(function (j) {
                if (!Array.isArray(j)) throw new Error('Нет доступа к таблице «' + name + '»');
                j.forEach(function (o) { out.push(norm(o)); });
                return j.length < PAGE ? out : page(off + PAGE);
            });
        }
        return page(0);
    };
    W.report = function (name, query) {
        return W.get('report/' + encodeURIComponent(name) + '?JSON_KV' + (query || '')).then(function (j) { return Array.isArray(j) ? j : []; });
    };
    W.all = function (names) { return Promise.all(names.map(function (n) { return W.rows(n); })); };
    W.map = function (rows, key) { var m = {}; rows.forEach(function (r) { m[r[key]] = r; }); return m; };
    W.num = Core.num;
    W.money = Core.money;
    W.right = function (x) { return Core.money(x); };


    /* ---------- DOM ---------- */
    W.el = function (tag, attrs, kids) {
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
    W.btn = function (text, fn, cls) { return W.el('button', { type: 'button', 'class': 'cpq-btn ' + (cls || ''), onclick: fn, text: text }); };
    W.toast = function (msg, bad) {
        var t = W.el('div', { 'class': 'cpq-toast' + (bad ? ' cpq-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 2500);
    };
    /* Модальное окно (не alert/confirm/prompt). body - узел, buttons - [{text, fn, cls}]. */
    W.modal = function (title, body, buttons) {
        var back = W.el('div', { 'class': 'cpq-modal-back' });
        function close() { back.remove(); }
        var foot = W.el('div', { 'class': 'cpq-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            return W.btn(b.text, function () { if (!b.fn || b.fn(close) !== false) { if (!b.keep) close(); } }, b.cls);
        }));
        var box = W.el('div', { 'class': 'cpq-modal', role: 'dialog', 'aria-label': title }, [W.el('h3', { text: title }), body, foot]);
        back.appendChild(box); document.body.appendChild(back);
        var f = box.querySelector('input,select,textarea'); if (f) f.focus();
        return { close: close, box: box };
    };
    W.field = function (label, input) { return W.el('label', { 'class': 'cpq-field' }, [W.el('span', { text: label }), input]); };
    W.select = function (opts, value) {
        var s = W.el('select', {}, opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return W.el('option', { value: v, text: t }); }));
        s.value = value === undefined ? '' : value; return s;
    };
    W.download = function (name, text) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
    };
    /* Таблица: cols = [{k, t, num, cls(r), html(r)}], rows = [{...}] */
    W.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = W.el('thead', {}, [W.el('tr', {}, cols.map(function (c) { return W.el('th', { text: c.t, 'class': c.num ? 'cpq-num' : '' }); }))]);
        var tbody = W.el('tbody', {}, rows.map(function (r) {
            var tr = W.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' cpq-click' : ''), onclick: opts.onrow ? function () { opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = W.el('td', { 'class': (c.num ? 'cpq-num ' : '') + (c.cls ? c.cls(r) : '') });
                    if (c.html) td.innerHTML = c.html(r); else td.textContent = c.num ? W.right(r[c.k]) : (r[c.k] === undefined ? '' : r[c.k]);
                    return td;
                }));
            return tr;
        }));
        if (!rows.length) tbody.appendChild(W.el('tr', {}, [W.el('td', { colspan: cols.length, 'class': 'cpq-empty', text: opts.empty || 'Нет данных' })]));
        return W.el('div', { 'class': 'cpq-tablewrap' }, [W.el('table', { 'class': 'cpq-table' }, [thead, tbody])]);
    };
    W.badge = function (text, kind) { return '<span class="cpq-badge cpq-' + (kind || 'info') + '">' + W.esc(text) + '</span>'; };
    W.tabs = function (items, active, onpick) {
        return W.el('div', { 'class': 'cpq-tabs', role: 'tablist' }, items.map(function (it) {
            return W.el('button', { type: 'button', role: 'tab', 'class': 'cpq-tab' + (it[0] === active ? ' cpq-tab-on' : ''), 'aria-selected': it[0] === active ? 'true' : 'false', onclick: function () { onpick(it[0]); }, text: it[1] });
        }));
    };
    W.fail = function (e) { host.innerHTML = ''; host.appendChild(W.el('div', { 'class': 'cpq-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    W.mount = function (fn) {
        if (!host) return;
        host.textContent = 'Загрузка...';
        W.meta().then(function () { return fn(host); }).catch(W.fail);
    };
    W.host = host;
    W.monthOf = function (d) { return d.slice(0, 7); };
})();
