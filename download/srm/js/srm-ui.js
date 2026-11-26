/* SRM: общие компоненты (DOM, окна, таблица, светофор допуска, маршрут согласования). */
(function () {
    'use strict';
    var P = window.Srm, C = P.core;
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
    P.btn = function (text, fn, cls) { return P.el('button', { type: 'button', 'class': 'srm-btn ' + (cls || ''), onclick: fn, text: text }); };
    P.toast = function (msg, bad) {
        var t = P.el('div', { 'class': 'srm-toast' + (bad ? ' srm-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 3000);
    };
    /* Модальное окно (не alert/confirm/prompt). buttons: [{text, fn(close) -> false оставляет окно, cls}] */
    P.modal = function (title, body, buttons, wide) {
        var back = P.el('div', { 'class': 'srm-modal-back' });
        function close() { back.remove(); }
        var foot = P.el('div', { 'class': 'srm-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            var bt = P.btn(b.text, function () { var r = b.fn ? b.fn(close, bt) : undefined; if (r !== false) close(); }, b.cls); return bt;
        }));
        var box = P.el('div', { 'class': 'srm-modal' + (wide ? ' srm-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [P.el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box };
    };
    P.field = function (label, input, hint) { return P.el('label', { 'class': 'srm-field' }, [P.el('span', { text: label }), input, hint ? P.el('small', { text: hint }) : null]); };
    P.select = function (opts, value) {
        var s = P.el('select', {}, opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return P.el('option', { value: v, text: t }); }));
        s.value = value === undefined ? '' : value; return s;
    };
    P.input = function (type, value, attrs) { var i = P.el(type === 'textarea' ? 'textarea' : 'input', Object.assign(type === 'textarea' ? {} : { type: type }, attrs || {})); i.value = value === undefined || value === null ? '' : value; return i; };
    P.badge = function (text, kind) { return '<span class="srm-badge srm-' + (kind || 'info') + '">' + P.esc(text) + '</span>'; };
    P.tabs = function (items, active, onpick) {
        return P.el('div', { 'class': 'srm-tabs', role: 'tablist' }, items.map(function (it) {
            return P.el('button', { type: 'button', role: 'tab', 'class': 'srm-tab' + (it[0] === active ? ' srm-tab-on' : ''), 'aria-selected': it[0] === active ? 'true' : 'false', onclick: function () { onpick(it[0]); }, text: it[1] });
        }));
    };
    /* Таблица: cols = [{k, t, num, cls(r), html(r)}] */
    P.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = P.el('thead', {}, [P.el('tr', {}, cols.map(function (c) { return P.el('th', { text: c.t, 'class': c.num ? 'srm-num' : '' }); }))]);
        var tbody = P.el('tbody', {}, rows.map(function (r) {
            return P.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' srm-click' : ''), onclick: opts.onrow ? function (e) { if (e.target.closest('button')) return; opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = P.el('td', { 'class': (c.num ? 'srm-num ' : '') + (c.cls ? c.cls(r) : '') });
                    if (c.node) { var n = c.node(r); if (n) td.appendChild(n); } else if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k];
                    return td;
                }));
        }));
        if (!rows.length) tbody.appendChild(P.el('tr', {}, [P.el('td', { colspan: cols.length, 'class': 'srm-empty', text: opts.empty || 'Нет данных' })]));
        return P.el('div', { 'class': 'srm-tablewrap' }, [P.el('table', { 'class': 'srm-table' }, [thead, tbody])]);
    };
    P.kpi = function (label, value, sub, kind) {
        return P.el('div', { 'class': 'srm-kpi' + (kind ? ' srm-kpi-' + kind : '') }, [P.el('div', { 'class': 'srm-kpi-v', html: value }), P.el('div', { 'class': 'srm-kpi-l', text: label }), sub ? P.el('div', { 'class': 'srm-kpi-s', text: sub }) : null]);
    };
    P.box = function (kind, text) { return P.el('div', { 'class': 'srm-warnbox srm-' + kind, text: text }); };
    P.fail = function (e) { P.host.innerHTML = ''; P.host.appendChild(P.el('div', { 'class': 'srm-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    P.mount = function (fn) {
        if (!P.host) return;
        P._render = fn;
        P.meta().then(function () { return P.model(); }).then(function (M) { P.host.innerHTML = ''; return fn(P.host, M); }).catch(P.fail);
    };
    P.nav = function (screen, hash) { return P.url(screen) + (hash ? '#' + hash : ''); };
    P.hash = function () { var o = {}; location.hash.replace(/^#/, '').split('&').forEach(function (p) { var a = p.split('='); if (a[0]) o[a[0]] = decodeURIComponent(a[1] || ''); }); return o; };
    P.head = function (title, sub) { return [P.el('h1', { text: title }), P.el('p', { 'class': 'srm-sub', text: sub })]; };

    /* ---------- предметные компоненты ---------- */
    var LIGHT = { green: ['допущен', 'ok'], amber: ['с условием', 'warn'], red: ['стоп', 'crit'] };
    P.admissionOf = function (M, supName) { var s = M.supBy[supName]; if (!s) return { ok: true, light: 'amber', reasons: [], warnings: ['Карточка поставщика недоступна'] }; return C.admission(s, M.docs[s.name] || [], M.today, M.rules); };
    P.light = function (M, supName) {
        var a = P.admissionOf(M, supName), s = M.supBy[supName] || {}, l = LIGHT[a.light];
        return '<span class="srm-light srm-light-' + a.light + '" title="' + P.esc(a.reasons.concat(a.warnings).join('; ') || s.level || '') + '"></span>' + P.badge(s.level || l[0], l[1]);
    };
    P.offersOf = function (M, reqNum) { return M.offers.filter(function (o) { return o.req === reqNum; }); };
    P.chosenOf = function (M, reqNum) { return P.offersOf(M, reqNum).filter(function (o) { return o.chosen; })[0] || null; };
    /* Сумма для маршрута: выбранное КП (с НДС и доставкой), до выбора - бюджет заявки. */
    P.routeAmount = function (M, q) { var ch = P.chosenOf(M, q.num); return ch ? C.normalizeOffer(ch, q.qty, M.rules).total : q.budget; };
    P.route = function (M, q) { var r = C.routeFor(P.routeAmount(M, q), M.thresholds); r.progress = C.routeProgress(r.steps, q.signed); r.amount = P.routeAmount(M, q); return r; };
    P.routeChips = function (M, q) {
        var r = P.route(M, q);
        return r.steps.map(function (s, i) { var d = i < r.progress.done.length, nx = s === r.progress.next; return '<span class="srm-step' + (d ? ' srm-step-done' : nx ? ' srm-step-next' : '') + '" title="' + P.esc(s) + '">' + (d ? '✓ ' : '') + P.esc(s.replace('Категорийный закупщик', 'Закупщик').replace('Директор по закупкам', 'Директор').replace('Закупочная комиссия', 'Комиссия')) + '</span>'; }).join('');
    };
    /* Блок маршрута с подписью следующего шага. */
    P.routeBox = function (M, q, onDone) {
        var r = P.route(M, q), wrap = P.el('div', { 'class': 'srm-card' });
        wrap.appendChild(P.el('h3', { text: 'Маршрут согласования' }));
        wrap.appendChild(P.el('p', { 'class': 'srm-muted', html: 'Сумма ' + P.money(r.amount) + (P.chosenOf(M, q.num) ? ' (выбранное КП с НДС и доставкой)' : ' (бюджет заявки, КП ещё не выбрано)') + ' попадает в порог <b>' + P.esc(r.threshold ? r.threshold.name : '-') + '</b>' + (r.commission ? ': нужна закупочная комиссия.' : '.') }));
        var list = P.el('ol', { 'class': 'srm-route' });
        r.steps.forEach(function (s, i) {
            var d = r.progress.done[i];
            list.appendChild(P.el('li', { 'class': d ? 'srm-route-done' : s === r.progress.next ? 'srm-route-next' : '' }, [P.el('b', { text: s }), P.el('span', { 'class': 'srm-muted', text: d ? ' - подписано ' + (d.who || '') + ', ' + P.d(d.date) : s === r.progress.next ? ' - ждёт подписи' : ' - после предыдущего шага' })]));
        });
        wrap.appendChild(list);
        if (r.progress.next && !P.chosenOf(M, q.num)) wrap.appendChild(P.el('p', { 'class': 'srm-muted', text: 'Подписи - после выбора поставщика: маршрут считается по сумме выбранного КП.' }));
        else if (r.progress.next && C.canSign(P.ctx.role, r.progress.next) && P.canWrite('Заявка на закупку')) {
            wrap.appendChild(P.btn('Подписать: ' + r.progress.next, function (e) {
                e.target.disabled = true;
                var s = C.addSign(q.signed, r.progress.next, P.ctx.user, P.TODAY);
                P.update(q.id, { 'Подписи согласования': s }).then(function () { return P.event(q, 'Подписано: ' + r.progress.next, 'Согласование'); })
                    .then(function () { P.toast('Подписано: ' + r.progress.next); if (onDone) onDone(); }).catch(function (er) { P.toast(er.message, true); e.target.disabled = false; });
            }, 'srm-primary'));
        } else if (r.progress.next) wrap.appendChild(P.el('p', { 'class': 'srm-muted', text: 'Подписать может роль «' + (r.progress.next === 'Закупочная комиссия' ? 'Директор по закупкам (секретарь комиссии)' : r.progress.next) + '».' }));
        else if (r.progress.complete) wrap.appendChild(P.box('g', 'Маршрут пройден.'));
        return wrap;
    };
    P.stageBadge = function (s) { var k = { 'Новая': 'info', 'Сбор КП': 'warn', 'Выбор и согласование': 'violet', 'Договор': 'ok', 'Исполнена': 'mute', 'Отменена': 'mute' }[s] || 'info'; return P.badge(s, k); };
    P.lastPrice = function (M, nom, before) { var h = C.priceHistory(M.contracts, nom, before); return h.length ? h[h.length - 1] : null; };
})();
