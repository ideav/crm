/* KPI: общий слой рабочих мест (данные, запись, окна, модель). Расчёты - в kpi-core.js. */
(function () {
    'use strict';
    var C = window.KpiCore;
    var K = window.Kpi = { core: C };
    var host = document.getElementById('kpi-app');
    var ds = host ? host.dataset : {};
    K.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };
    K.TODAY = '2026-11-26'; /* дата демо */
    K.CUR = 'Октябрь 2026'; /* период, который сейчас считают и согласуют */

    K.dec = function (s) { return typeof s === 'string' ? s.replace(/&comma;/g, ',') : s; };
    K.esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    K.url = function (p) { return '/' + K.ctx.db + '/' + p; };
    K.get = function (p) {
        return fetch(K.url(p), { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + p);
            return r.json();
        });
    };
    K.post = function (p, fields) {
        var fd = new FormData();
        fd.append('_xsrf', K.ctx.xsrf);
        Object.keys(fields || {}).forEach(function (k) { var v = fields[k]; fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v); });
        return fetch(K.url(p), { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (j) {
                var e = Array.isArray(j) ? j[0] : j;
                if (!r.ok || (e && e.error)) throw new Error((e && e.error) || ('HTTP ' + r.status));
                return j;
            });
        });
    };
    var metaP = null;
    K.meta = function () { return metaP || (metaP = K.get('metadata?JSON=1').then(function (m) { var by = {}; m.forEach(function (t) { by[t.val] = t; }); K.metaBy = by; return by; })); };
    K.tid = function (name) { return K.metaBy[name] && K.metaBy[name].id; };
    K.canWrite = function (name) { return !!(K.metaBy[name] && K.metaBy[name].granted === 'WRITE'); };
    K.canRead = function (name) { return !!K.metaBy[name]; };
    function norm(o) {
        var r = { _id: String(o.id), _ref: {} };
        Object.keys(o).forEach(function (k) {
            if (k === 'id' || k === 'up' || k === 'ord') return;
            var v = o[k];
            if (v && typeof v === 'object') { if (v.id !== undefined) { r[k] = K.dec(v.val); r._ref[k] = String(v.id); } return; }
            r[k] = v === null ? '' : K.dec(v);
        });
        return r;
    }
    K.rows = function (name) {
        if (!K.canRead(name)) return Promise.resolve([]);
        return K.get('object/' + K.tid(name) + '/?JSON_OBJ&NAMED&LIMIT=0,5000').then(function (j) {
            if (!Array.isArray(j)) throw new Error('Нет доступа к таблице «' + name + '»');
            return j.map(norm);
        });
    };
    K.num = C.num; K.rub = C.rub; K.pct = C.pct;

    /* ---------- модель ---------- */
    var NAMES = ['Подразделение', 'Схема премии', 'Показатель KPI', 'Показатель схемы', 'Ступень шкалы', 'Период премии', 'Сотрудник', 'Значение KPI', 'Табель периода', 'Компетенция', 'Оценка компетенции', 'Премия', 'Журнал премии', 'Выгрузка ЗУП', 'Параметр расчёта'];
    var modelP = null;
    K.model = function () {
        if (modelP) return modelP;
        modelP = Promise.all(NAMES.map(function (n) { return K.rows(n); })).then(function (r) {
            var M = { raw: {} };
            NAMES.forEach(function (n, i) { M.raw[n] = r[i]; });
            M.depts = r[0].map(function (x) { return { id: x._id, name: x['Подразделение'], head: x['Руководитель подразделения'], login: x['Логин руководителя'] }; });
            M.inds = {}; r[2].forEach(function (x) { M.inds[x['Показатель KPI']] = { id: x._id, name: x['Показатель KPI'], unit: x['Единица измерения'], dir: x['Направление показателя'], kind: x['Вид показателя'], src: x['Источник данных'], syn: x['Синонимы показателя'] }; });
            M.schemes = {}; M.schemeRows = {};
            r[1].forEach(function (x) {
                M.schemeRows[x['Схема премии']] = x;
                M.schemes[x['Схема премии']] = { id: x._id, name: x['Схема премии'], threshold: C.num(x['Порог начисления, %']), cap: C.num(x['Потолок коэффициента, %']), ratingStep: C.num(x['Шаг множителя оценки, %']), partMode: x['Неполный месяц'], version: C.num(x['Версия правил']), changed: x['Правила изменены'], steps: [], lines: [] };
            });
            r[3].forEach(function (x) { var s = M.schemes[x['Схема премии']], i = M.inds[x['Показатель KPI']]; if (s && i) s.lines.push({ id: x._id, ind: i, weight: C.num(x['Вес, %']), scale: x['Шкала показателя'] }); });
            r[4].forEach(function (x) { var s = M.schemes[x['Схема премии']]; if (s) s.steps.push({ id: x._id, from: C.num(x['Выполнение от, %']), coef: C.num(x['Коэффициент ступени']) }); });
            M.periods = r[5].map(function (x) { return { id: x._id, name: x['Период премии'], start: C.toIso(x['Начало периода']), status: x['Статус периода'], deadline: C.toIso(x['Срок согласования']), days: C.num(x['Рабочих дней']), factAt: C.toIso(x['Факт на дату']), passed: C.num(x['Прошло рабочих дней']) }; })
                .sort(function (a, b) { return a.start < b.start ? -1 : 1; });
            M.emps = r[6].map(function (x) { return { id: x._id, name: x['Сотрудник'], num: x['Табельный номер'], dept: x['Подразделение'], pos: x['Должность сотрудника'], scheme: x['Схема премии'], salary: C.num(x['Оклад']), targetPct: C.num(x['Целевая премия, %']), login: x['Логин сотрудника'], headLogin: x['Логин руководителя'] }; });
            M.empBy = {}; M.emps.forEach(function (e) { M.empBy[e.name] = e; });
            M.comps = r[9].map(function (x) { return { id: x._id, name: x['Компетенция'], what: x['Что оценивает'], ex1: x['Пример на 1'], ex3: x['Пример на 3'], ex5: x['Пример на 5'], ord: C.num(x['Порядок компетенции']) }; }).sort(function (a, b) { return a.ord - b.ord; });
            M.params = {}; r[14].forEach(function (x) { M.params[x['Параметр расчёта']] = x['Значение параметра']; });
            M.journal = r[12].map(function (x) { return { id: x._id, when: x['Когда записи'], who: x['Автор записи'], period: x['Период премии'], emp: x['Сотрудник'], text: x['Событие журнала'], before: x['Было, ₽'], after: x['Стало, ₽'] }; })
                .sort(function (a, b) { return a.when < b.when ? 1 : -1; });
            M.exports = r[13].map(function (x) { return { id: x._id, code: x['Выгрузка ЗУП'], period: x['Период премии'], when: x['Когда записи'], who: x['Автор записи'], count: C.num(x['Строк выгрузки']), sum: C.num(x['Сумма выгрузки']) }; });
            M.byPeriod = {};
            M.periods.forEach(function (p) { M.byPeriod[p.name] = { vals: {}, valRows: {}, scores: {}, scoreRows: {}, ts: {}, prem: {} }; });
            r[7].forEach(function (x) { var b = M.byPeriod[x['Период премии']]; if (!b) return; (b.vals[x['Сотрудник']] = b.vals[x['Сотрудник']] || {})[x['Показатель KPI']] = { plan: x['План'], fact: x['Факт'] }; (b.valRows[x['Сотрудник']] = b.valRows[x['Сотрудник']] || {})[x['Показатель KPI']] = x; });
            r[8].forEach(function (x) { var b = M.byPeriod[x['Период премии']]; if (b) b.ts[x['Сотрудник']] = { norm: C.num(x['Норма дней']), worked: C.num(x['Отработано дней']), why: x['Причина отсутствия'] }; });
            r[10].forEach(function (x) { var b = M.byPeriod[x['Период премии']]; if (!b) return; (b.scores[x['Сотрудник']] = b.scores[x['Сотрудник']] || []).push(C.num(x['Балл'])); (b.scoreRows[x['Сотрудник']] = b.scoreRows[x['Сотрудник']] || {})[x['Компетенция']] = x; });
            r[11].forEach(function (x) { var b = M.byPeriod[x['Период премии']]; if (b) b.prem[x['Сотрудник']] = { id: x._id, code: x['Премия'], calc: C.num(x['Расчётная премия']), corr: C.num(x['Корректировка']), reason: x['Причина корректировки'], total: C.num(x['Итог премии']), status: x['Статус согласования'], by: x['Согласовал'], at: x['Дата согласования'] }; });
            K.cur = M;
            return M;
        });
        return modelP;
    };
    K.resetModel = function () { modelP = null; };
    K.period = function (M, name) { return M.periods.filter(function (p) { return p.name === name; })[0]; };
    K.prevPeriod = function (M, name) { var i = M.periods.map(function (p) { return p.name; }).indexOf(name); return i > 0 ? M.periods[i - 1] : null; };
    /* Контекст расчёта периода для kpi-core. Корректировки - из записей «Премия». */
    K.calcCtx = function (M, pname) {
        var b = M.byPeriod[pname] || { vals: {}, scores: {}, ts: {}, prem: {} }, corr = {};
        Object.keys(b.prem).forEach(function (n) { corr[n] = { sum: b.prem[n].corr, reason: b.prem[n].reason }; });
        return { emps: M.emps.filter(function (e) { return b.vals[e.name]; }), schemes: M.schemes, vals: b.vals, scores: b.scores, ts: b.ts, corr: corr };
    };
    K.prevTotals = function (M, pname) {
        var p = K.prevPeriod(M, pname), out = {};
        if (!p) return null;
        var b = M.byPeriod[p.name];
        Object.keys(b.prem).forEach(function (n) { out[n] = b.prem[n].total; });
        return out;
    };

    /* ---------- DOM ---------- */
    K.el = function (tag, attrs, kids) {
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
    K.btn = function (text, fn, cls) { return K.el('button', { type: 'button', 'class': 'kpi-btn ' + (cls || ''), onclick: fn, text: text }); };
    K.toast = function (msg, bad) {
        var t = K.el('div', { 'class': 'kpi-toast' + (bad ? ' kpi-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 2800);
    };
    /* Модальное окно (не alert/confirm/prompt). fn вернул false - окно остаётся; вернул промис - окно закрывает сам fn. */
    K.modal = function (title, body, buttons, wide) {
        var back = K.el('div', { 'class': 'kpi-modal-back' });
        function close() { back.remove(); }
        var foot = K.el('div', { 'class': 'kpi-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            return K.btn(b.text, function () { var r = b.fn ? b.fn(close) : undefined; if (r && r.then) return; if (r !== false) close(); }, b.cls);
        }));
        var box = K.el('div', { 'class': 'kpi kpi-modal' + (wide ? ' kpi-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [K.el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box };
    };
    K.field = function (label, input, hint) { return K.el('label', { 'class': 'kpi-field' }, [K.el('span', { text: label }), input, hint ? K.el('small', { text: hint }) : null]); };
    K.select = function (opts, value) {
        var s = K.el('select', {}, opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return K.el('option', { value: v, text: t }); }));
        s.value = value === undefined ? '' : value; return s;
    };
    K.input = function (type, value, attrs) { var i = K.el('input', Object.assign({ type: type }, attrs || {})); i.value = value === undefined || value === null ? '' : value; return i; };
    K.download = function (name, text) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([String.fromCharCode(65279) + text], { type: 'text/csv;charset=utf-8' })); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
    };
    K.badge = function (text, kind) { return '<span class="kpi-badge kpi-' + (kind || 'info') + '">' + K.esc(text) + '</span>'; };
    /* Таблица: cols = [{k, t, num, cls(r), html(r)}] */
    K.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = K.el('thead', {}, [K.el('tr', {}, cols.map(function (c) { return K.el('th', { text: c.t, 'class': c.num ? 'kpi-num' : '', title: c.title }); }))]);
        var tbody = K.el('tbody', {}, rows.map(function (r) {
            return K.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' kpi-click' : ''), onclick: opts.onrow ? function () { opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = K.el('td', { 'class': (c.num ? 'kpi-num ' : '') + (c.cls ? c.cls(r) : ''), 'data-label': c.t });
                    if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k];
                    return td;
                }));
        }));
        if (!rows.length) tbody.appendChild(K.el('tr', {}, [K.el('td', { colspan: cols.length, 'class': 'kpi-empty', text: opts.empty || 'Нет данных' })]));
        return K.el('div', { 'class': 'kpi-tablewrap' }, [K.el('table', { 'class': 'kpi-table' + (opts.cls ? ' ' + opts.cls : '') }, [thead, tbody])]);
    };
    K.tile = function (label, value, sub, kind) {
        return K.el('div', { 'class': 'kpi-tile' + (kind ? ' kpi-tile-' + kind : '') }, [K.el('div', { 'class': 'kpi-tile-v', html: value }), K.el('div', { 'class': 'kpi-tile-l', text: label }), sub ? K.el('div', { 'class': 'kpi-tile-s', text: sub }) : null]);
    };
    K.fail = function (e) { host.innerHTML = ''; host.appendChild(K.el('div', { 'class': 'kpi-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    K.mount = function (fn) {
        if (!host) return;
        K.render = fn;
        host.textContent = 'Загрузка...';
        K.meta().then(function () { return K.model(); }).then(function (M) { host.innerHTML = ''; return fn(host, M); }).catch(K.fail);
    };
    K.reload = function () { K.resetModel(); K.mount(K.render); };
    K.head = function (title, sub) { return [K.el('h1', { text: title }), K.el('p', { 'class': 'kpi-sub', text: sub })]; };
    K.create = function (table, fields) { return K.post('_m_new/' + K.tid(table) + '?JSON', { up: 1, fields: fields }); };
    K.update = function (id, fields) { return K.post('_m_set/' + id + '?JSON', { fields: fields }); };
    K.now = function () { var d = new Date(); return K.TODAY + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); };
    /* Запись в журнал премии: кто, когда, что, было/стало. Логины маски заполнены всегда. */
    K.log = function (text, o) {
        o = o || {};
        var e = o.emp && K.cur && K.cur.empBy[o.emp];
        var f = { 'Журнал премии': text.slice(0, 60), 'Когда записи': K.now(), 'Автор записи': K.ctx.user, 'Событие журнала': text,
            'Логин сотрудника': e ? e.login : '-', 'Логин руководителя': e ? e.headLogin : (o.headLogin || '-') };
        if (o.period) f['Период премии'] = o.period;
        if (o.emp) f['Сотрудник'] = o.emp;
        if (o.before !== undefined) f['Было, ₽'] = o.before;
        if (o.after !== undefined) f['Стало, ₽'] = o.after;
        return K.create('Журнал премии', f);
    };
    /* Подсветка флагов расчёта */
    K.FLAG = { block: ['Блокирующий показатель', 'crit'], below: ['Ниже порога', 'crit'], capped: ['Потолок', 'warn'], part: ['Неполный месяц', 'info'], noplan: ['Нет плана', 'warn'], nofact: ['Нет факта', 'warn'] };
    K.flags = function (r) { return r.flags.filter(function (f, i) { return !(f === 'capped' && r.blocked) && r.flags.indexOf(f) === i; }).map(function (f) { return K.badge(K.FLAG[f][0], K.FLAG[f][1]); }).join(' '); };
    K.periodPicker = function (M, value, onchange, filter) {
        var s = K.select(M.periods.filter(filter || function () { return true; }).map(function (p) { return [p.name, p.name + ' - ' + p.status]; }), value);
        s.addEventListener('change', function () { onchange(s.value); });
        return K.field('Период', s);
    };
    K.isHead = function () { return /Руководитель подразделения/i.test(K.ctx.role); };
    K.isEmp = function () { return /^Сотрудник$/i.test(K.ctx.role); };
})();
