/* ТОиР: DOM-компоненты (элемент, кнопка, окно, таблица, показатель, график истории). */
(function () {
    'use strict';
    var T = window.Toir, C = T.core;
    T.el = function (tag, attrs, kids) {
        var e = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) {
            if (k === 'text') e.textContent = attrs[k];
            else if (k === 'html') e.innerHTML = attrs[k];
            else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
            else if (attrs[k] !== false && attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
        });
        [].concat(kids || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
        return e;
    };
    var el = T.el;
    T.btn = function (text, fn, cls, attrs) { return el('button', Object.assign({ type: 'button', 'class': 'toir-btn ' + (cls || ''), onclick: fn, text: text }, attrs || {})); };
    T.toast = function (msg, bad) {
        var t = el('div', { 'class': 'toir-toast' + (bad ? ' toir-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 3200);
    };
    /* Модальное окно (не alert/confirm/prompt). buttons: [{text, fn(close) -> false|Promise, cls}] */
    T.modal = function (title, body, buttons, wide) {
        var back = el('div', { 'class': 'toir-modal-back toir' });
        function close() { back.remove(); }
        var foot = el('div', { 'class': 'toir-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            var bt = T.btn(b.text, function () {
                if (!b.fn) return close();
                var r = b.fn(close);
                if (r && r.then) { bt.disabled = true; r.then(function (v) { if (v !== false) close(); else bt.disabled = false; }, function (e) { bt.disabled = false; T.toast(e.message || String(e), true); }); }
                else if (r !== false) close();
            }, b.cls);
            return bt;
        }));
        var box = el('div', { 'class': 'toir-modal' + (wide ? ' toir-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box };
    };
    T.field = function (label, input, hint) { return el('label', { 'class': 'toir-field' }, [el('span', { text: label }), input, hint ? el('small', { text: hint }) : null]); };
    T.select = function (opts, value) {
        var s = el('select', {}, opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return el('option', { value: v, text: t }); }));
        s.value = value === undefined ? '' : value; return s;
    };
    T.input = function (type, value, attrs) { var i = el(type === 'textarea' ? 'textarea' : 'input', Object.assign(type === 'textarea' ? {} : { type: type }, attrs || {})); i.value = value === undefined ? '' : value; return i; };
    T.badge = function (text, kind) { return '<span class="toir-badge toir-' + (kind || 'info') + '">' + T.esc(text) + '</span>'; };
    T.critKind = function (c) { return { 'Аварийная': 'crit', 'Высокая': 'crit', 'Средняя': 'warn', 'Низкая': 'mute' }[c] || 'info'; };
    T.statusKind = function (s) { return { 'Новый': 'warn', 'Принят': 'info', 'В ведомости': 'info', 'В ремонте': 'violet', 'Устранён': 'ok', 'Отклонён': 'mute', 'Выполнен': 'ok', 'В работе': 'violet', 'Запланирован': 'info', 'Назначен': 'info', 'Пропущен': 'crit', 'На согласовании': 'warn', 'Согласован': 'ok', 'Проведён': 'mute', 'План': 'info' }[s] || 'mute'; };
    T.download = function (name, text) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
    };
    T.tabs = function (items, active, onpick) {
        return el('div', { 'class': 'toir-tabs', role: 'tablist' }, items.map(function (it) {
            return el('button', { type: 'button', role: 'tab', 'class': 'toir-tab' + (it[0] === active ? ' toir-tab-on' : ''), 'aria-selected': it[0] === active ? 'true' : 'false', onclick: function () { onpick(it[0]); }, text: it[1] });
        }));
    };
    /* Таблица: cols = [{k, t, num, cls(r), html(r)}] */
    T.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = el('thead', {}, [el('tr', {}, cols.map(function (c) { return el('th', { text: c.t, 'class': c.num ? 'toir-num' : '' }); }))]);
        var tbody = el('tbody', {}, rows.map(function (r) {
            return el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' toir-click' : ''), onclick: opts.onrow ? function (ev) { if (ev.target.closest('button,a,input,select')) return; opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = el('td', { 'class': (c.num ? 'toir-num ' : '') + (c.cls ? c.cls(r) : ''), 'data-label': c.t });
                    if (c.node) { var n = c.node(r); if (n) td.appendChild(n); } else if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k];
                    return td;
                }));
        }));
        if (!rows.length) tbody.appendChild(el('tr', {}, [el('td', { colspan: cols.length, 'class': 'toir-empty', text: opts.empty || 'Нет данных' })]));
        return el('div', { 'class': 'toir-tablewrap' }, [el('table', { 'class': 'toir-table' + (opts.cls ? ' ' + opts.cls : '') }, [thead, tbody])]);
    };
    T.kpi = function (label, value, sub, kind) {
        return el('div', { 'class': 'toir-kpi' + (kind ? ' toir-kpi-' + kind : '') }, [el('div', { 'class': 'toir-kpi-v', html: value }), el('div', { 'class': 'toir-kpi-l', text: label }), sub ? el('div', { 'class': 'toir-kpi-s', text: sub }) : null]);
    };
    T.head = function (title, sub) { return [el('h1', { text: title }), sub ? el('p', { 'class': 'toir-sub', text: sub }) : null]; };
    /* График истории показаний: линия по точкам и пунктир верхней границы. */
    T.spark = function (vals, hi, lo, w, h) {
        w = w || 260; h = h || 64;
        var v = vals.map(C.num); if (!v.length) return el('span', { 'class': 'toir-muted', text: 'истории нет' });
        var top = Math.max.apply(null, v.concat([C.has(hi) ? C.num(hi) * 1.1 : 0])), bot = Math.min.apply(null, v.concat([C.has(lo) && C.num(lo) > 0 ? C.num(lo) * 0.9 : Math.min.apply(null, v) * 0.8]));
        var span = top - bot || 1, x = function (i) { return v.length === 1 ? w / 2 : 4 + i * (w - 8) / (v.length - 1); }, y = function (n) { return h - 4 - (n - bot) / span * (h - 8); };
        var pts = v.map(function (n, i) { return x(i).toFixed(1) + ',' + y(n).toFixed(1); }).join(' ');
        var lim = C.has(hi) ? '<line x1="0" x2="' + w + '" y1="' + y(C.num(hi)).toFixed(1) + '" y2="' + y(C.num(hi)).toFixed(1) + '" class="toir-spark-lim"/>' : '';
        var dots = v.map(function (n, i) { var bad = C.has(hi) && n > C.num(hi); return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(n).toFixed(1) + '" r="' + (bad ? 3.5 : 2) + '" class="' + (bad ? 'toir-spark-bad' : 'toir-spark-dot') + '"/>'; }).join('');
        return el('span', { 'class': 'toir-spark', html: '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" aria-label="история показаний">' + lim + '<polyline points="' + pts + '" class="toir-spark-line"/>' + dots + '</svg>' });
    };
    /* Карточка узла: дефекты, наряды, простои, последние показания. */
    T.eqCard = function (M, name) {
        var e = M.eqBy[name] || { name: name };
        var defs = M.defects.filter(function (d) { return d.eq === name; }).sort(function (a, b) { return b.found.localeCompare(a.found); });
        var ords = M.orders.filter(function (o) { return o.eq === name; }).sort(function (a, b) { return (b.done || b.plan).localeCompare(a.done || a.plan); });
        var body = el('div', { 'class': 'toir-eqcard' }, [
            el('p', { 'class': 'toir-sub', text: [e.inv, e.shop, e.line, e.type, e.cls ? 'класс ' + e.cls : '', e.code ? 'код 1С ' + e.code : ''].filter(Boolean).join(' · ') }),
            el('h4', { text: 'Показания по обходам' }),
            el('div', { 'class': 'toir-sparks' }, (M.items[e.type] || []).filter(function (i) { return i.kind === 'Показание'; }).map(function (i) {
                var hs = T.history(M, name, i.name);
                return el('div', { 'class': 'toir-sparkbox' }, [el('div', { 'class': 'toir-muted', text: i.name + ', ' + i.unit + ' (норма ' + (C.num(i.lo) > 0 ? i.lo + '–' : 'до ') + i.hi + ')' }), T.spark(hs.map(function (m) { return m.value; }), i.hi, i.lo)]);
            })),
            el('h4', { text: 'Дефекты' }),
            T.table([{ k: 'name', t: '№' }, { t: 'Обнаружен', html: function (d) { return C.ru(d.found); } }, { k: 'text', t: 'Описание' }, { t: 'Статус', html: function (d) { return T.badge(d.status, T.statusKind(d.status)); } }], defs.slice(0, 8)),
            el('h4', { text: 'Наряды' }),
            T.table([{ k: 'name', t: '№' }, { k: 'work', t: 'Работа' }, { t: 'Дата', html: function (o) { return C.ru(o.done || o.plan); } }, { t: 'Статус', html: function (o) { return T.badge(o.status, T.statusKind(o.status)); } }], ords.slice(0, 8))
        ]);
        T.modal(name, body, null, true);
    };
    T.eqLink = function (M, name) { return el('button', { type: 'button', 'class': 'toir-link', text: name, onclick: function () { T.eqCard(M, name); } }); };
})();
