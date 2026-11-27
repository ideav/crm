/* СУОТ: общий слой рабочих мест (данные, запись, окна, модель). Расчёты - в suot-core.js. */
(function () {
    'use strict';
    var C = window.SuotCore;
    var A = window.Suot = { core: C };
    var host = document.getElementById('suot-app');
    var ds = host ? host.dataset : {};
    A.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };
    A.TODAY = '2026-11-26'; /* дата демо */
    A.rk = C.roleKey(A.ctx.role);

    A.dec = function (s) { return typeof s === 'string' ? s.replace(/&comma;/g, ',') : s; };
    A.esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    A.url = function (p) { return '/' + A.ctx.db + '/' + p; };
    A.get = function (p) {
        return fetch(A.url(p), { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + p);
            return r.json();
        });
    };
    /* POST с XSRF; вложенные объекты уходят JSON-строкой. */
    A.post = function (p, fields) {
        var fd = new FormData();
        fd.append('_xsrf', A.ctx.xsrf);
        Object.keys(fields || {}).forEach(function (k) { var v = fields[k]; fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v); });
        return fetch(A.url(p), { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (j) { var e = Array.isArray(j) ? j[0] : j; if (e && e.error) throw new Error(e.error); return j; });
    };
    var metaP = null;
    A.meta = function () { return metaP || (metaP = A.get('metadata?JSON=1').then(function (m) { var by = {}; m.forEach(function (t) { by[t.val] = t; }); A.metaBy = by; return by; })); };
    A.tid = function (name) { return A.metaBy[name] && A.metaBy[name].id; };
    A.canWrite = function (name) { return !!(A.metaBy[name] && A.metaBy[name].granted === 'WRITE'); };
    A.canRead = function (name) { return !!A.metaBy[name]; };

    function norm(o) {
        var r = { _id: String(o.id), _ref: {} };
        Object.keys(o).forEach(function (k) {
            if (k === 'id' || k === 'up' || k === 'ord') return;
            var v = o[k];
            if (v && typeof v === 'object') { if (v.id !== undefined) { r[k] = A.dec(v.val); r._ref[k] = String(v.id); } return; }
            r[k] = v === null ? '' : A.dec(v);
        });
        return r;
    }
    /* Таблица целиком; нет гранта или 403 - null (экран показывает, чего роль не видит). */
    A.rows = function (name) {
        if (!A.canRead(name)) return Promise.resolve(null);
        var id = A.tid(name), out = [], PAGE = 500;
        function page(off) {
            return A.get('object/' + id + '/?JSON_OBJ&NAMED&LIMIT=' + off + ',' + PAGE).then(function (j) {
                if (!Array.isArray(j)) return null;
                j.forEach(function (o) { out.push(norm(o)); });
                return j.length < PAGE ? out : page(off + PAGE);
            }, function () { return null; });
        }
        return page(0);
    };
    var NAMES = ['Подразделение', 'Вредный фактор', 'Вид работ', 'Должность', 'СИЗ', 'Норма выдачи', 'Работник', 'Вид обучения', 'Требование к работам', 'Запись обучения', 'Медосмотр', 'Партия СИЗ', 'Выдача СИЗ', 'Наряд-допуск', 'Исполнитель наряда', 'Правило ОТ', 'Статус наряда'];
    var modelP = null;
    A.model = function () {
        if (modelP) return modelP;
        modelP = Promise.all(NAMES.map(A.rows)).then(function (r) {
            var t = {}; NAMES.forEach(function (n, i) { t[n] = r[i]; });
            var M = { today: A.TODAY, can: {} };
            /* таблица, закрытая роли маской строк, приходит пустой: «видит» = есть строки или право записи */
            NAMES.forEach(function (n) { M.can[n] = t[n] !== null && (t[n].length > 0 || A.canWrite(n)); t[n] = t[n] || []; });
            M.rules = C.parseRules(t['Правило ОТ'].map(function (x) { return { name: x['Правило ОТ'], value: x['Значение правила'] }; }));
            M.ruleRows = t['Правило ОТ'];
            M.deptRows = t['Подразделение']; M.depts = M.deptRows.map(function (x) { return x['Подразделение']; });
            M.positions = {}; t['Должность'].forEach(function (x) { M.positions[x['Должность']] = { name: x['Должность'], point: x['Пункт ЕТН'], works: C.list(x['Работы повышенной опасности']), factors: C.list(x['Вредные факторы']) }; });
            M.factorBy = {}; t['Вредный фактор'].forEach(function (x) { M.factorBy[x['Вредный фактор']] = { name: x['Вредный фактор'], months: C.num(x['Периодичность медосмотра, мес']) }; });
            M.workTypes = t['Вид работ'].map(function (x) { return x['Вид работ']; });
            M.kinds = t['Вид обучения'].map(function (x) { return { id: x._id, name: x['Вид обучения'], cat: x['Категория обучения'], months: C.num(x['Периодичность, мес']), all: x['Для всех'] === '1', once: x['Однократно'] === '1', basis: x['Основание обучения'] }; });
            M.kindBy = {}; M.kinds.forEach(function (k) { M.kindBy[k.name] = k; });
            M.reqs = t['Требование к работам'].map(function (x) { return { work: x['Вид работ'], kind: x['Вид обучения'] }; });
            M.ppe = t['СИЗ'].map(function (x) { return { id: x._id, name: x['СИЗ'], kind: x['Вид СИЗ'], code: x['Штрихкод СИЗ'], cert: x['Сертификат или декларация'], unit: x['Единица СИЗ'] }; });
            M.ppeBy = {}; M.ppe.forEach(function (p) { M.ppeBy[p.name] = p; });
            M.norms = t['Норма выдачи'].map(function (x) { return { id: x._id, pos: x['Должность'], ppe: x['СИЗ'], qty: C.num(x['Количество на срок']), months: C.num(x['Срок носки, мес']), point: x['Пункт норм'], basis: x['Основание нормы'], work: x['Для работ'] || '' }; });
            M.workers = t['Работник'].map(function (x) {
                return { id: x._id, name: x['Работник'], tab: x['Табельный номер'], dept: x['Подразделение'], pos: x['Должность'], hire: C.toIso(x['Дата приёма']), birth: C.toIso(x['Дата рождения']), sizes: { clothes: x['Размер одежды'], shoes: x['Размер обуви'], head: x['Размер головного убора'], gloves: x['Размер перчаток'] } };
            }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
            M.workerBy = {}; M.workers.forEach(function (w) { M.workerBy[w.name] = w; });
            M.trainings = t['Запись обучения'].map(function (x) { return { id: x._id, code: x['Запись обучения'], worker: x['Работник'], kind: x['Вид обучения'], date: C.toIso(x['Дата проведения']), by: x['Провёл'], result: x['Результат обучения'], protocol: x['Номер протокола'] }; });
            M.exams = t['Медосмотр'].map(function (x) { return { id: x._id, worker: x['Работник'], date: C.toIso(x['Дата медосмотра']), type: x['Вид медосмотра'], verdict: x['Заключение медосмотра'], clinic: x['Медорганизация'], num: x['Номер заключения'] }; });
            M.issues = t['Выдача СИЗ'].map(function (x) { return { id: x._id, code: x['Выдача СИЗ'], worker: x['Работник'], ppe: x['СИЗ'], date: C.toIso(x['Дата выдачи']), qty: C.num(x['Количество выдано']), size: x['Размер выдачи'], batch: x['Партия выдачи'], by: x['Выдал'], sign: x['Подтверждение получения'], reason: x['Причина внеплановой выдачи'] }; });
            M.batches = t['Партия СИЗ'].map(function (x) { return { id: x._id, code: x['Партия СИЗ'], ppe: x['СИЗ'], size: x['Размер партии'] === 'универсальный' ? '' : x['Размер партии'], qty: C.num(x['Остаток партии']), expires: C.toIso(x['Срок годности']), store: x['Склад СИЗ'] }; });
            var ex = {}; t['Исполнитель наряда'].forEach(function (x) { (ex[x['Наряд-допуск']] = ex[x['Наряд-допуск']] || []).push(x['Работник']); });
            M.execRows = t['Исполнитель наряда'].map(function (x) { return { id: x._id, permit: x['Наряд-допуск'], worker: x['Работник'] }; });
            M.permits = t['Наряд-допуск'].map(function (x) {
                return { id: x._id, num: x['Наряд-допуск'], dept: x['Подразделение'], work: x['Вид работ'], works: x['Вид работ'] ? [x['Вид работ']] : [], what: x['Содержание работ'], place: x['Место работ'], date: C.toIso(x['Дата работ']), from: x['Время начала'], to: x['Время окончания'], head: x['Ответственный руководитель'], doer: x['Производитель работ'], status: x['Статус наряда'] || 'Черновик', log: x['Журнал подписей'] || '', author: x['Составил'], executors: (ex[x['Наряд-допуск']] || []).filter(function (n) { return M.workerBy[n]; }) };
            }).sort(function (a, b) { return a.num < b.num ? 1 : -1; });
            A.cur = M;
            return M;
        });
        return modelP;
    };
    A.resetModel = function () { modelP = null; };
    A.create = function (table, fields) { return A.post('_m_new/' + A.tid(table) + '?JSON', { up: 1, fields: fields }).then(function (r) { A.resetModel(); return r; }); };
    A.update = function (id, fields) { return A.post('_m_set/' + id + '?JSON', { fields: fields }).then(function (r) { A.resetModel(); return r; }); };

    /* ---------- DOM ---------- */
    A.el = function (tag, attrs, kids) {
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
    A.btn = function (text, fn, cls) { return A.el('button', { type: 'button', 'class': 'suot-btn ' + (cls || ''), onclick: fn, text: text }); };
    A.toast = function (msg, bad) {
        var t = A.el('div', { 'class': 'suot-toast' + (bad ? ' suot-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 7000 : 3000);
    };
    /* Модальное окно (не alert/confirm/prompt). */
    A.modal = function (title, body, buttons, wide) {
        var back = A.el('div', { 'class': 'suot-modal-back' });
        function close() { back.remove(); }
        var foot = A.el('div', { 'class': 'suot-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            var x = A.btn(b.text, function () { if (!b.fn || b.fn(close) !== false) { if (!b.keep) close(); } }, b.cls); if (b.disabled) x.disabled = true; return x;
        }));
        var box = A.el('div', { 'class': 'suot suot-modal' + (wide ? ' suot-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [A.el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box };
    };
    A.field = function (label, input, hint) { return A.el('label', { 'class': 'suot-field' }, [A.el('span', { text: label }), input, hint ? A.el('small', { text: hint }) : null]); };
    A.select = function (opts, value) {
        var s = A.el('select', {}, opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return A.el('option', { value: v, text: t }); }));
        s.value = value === undefined ? '' : value; return s;
    };
    A.input = function (type, value, attrs) { var i = A.el('input', Object.assign({ type: type }, attrs || {})); i.value = value === undefined ? '' : value; return i; };
    A.download = function (name, text) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
    };
    var KIND = { over: 'crit', none: 'crit', soon: 'warn', ok: 'ok', wear: 'ok', na: 'info' };
    A.badge = function (text, kind) { return '<span class="suot-badge suot-' + (kind || 'info') + '">' + A.esc(text) + '</span>'; };
    A.stateBadge = function (st, due) {
        var t = st === 'over' && due ? 'просрочено ' + C.toDmy(due) : st === 'soon' && due ? 'до ' + C.toDmy(due) : st === 'none' ? 'не выдано / нет записи' : C.STATE_TEXT[st];
        return A.badge(t, KIND[st]);
    };
    A.kindOf = function (st) { return KIND[st] || 'info'; };
    /* Таблица: cols = [{k, t, num, cls(r), html(r)}] */
    A.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = A.el('thead', {}, [A.el('tr', {}, cols.map(function (c) { return A.el('th', { text: c.t, 'class': c.num ? 'suot-num' : '' }); }))]);
        var tbody = A.el('tbody', {}, rows.map(function (r) {
            return A.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' suot-click' : ''), onclick: opts.onrow ? function () { opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = A.el('td', { 'class': (c.num ? 'suot-num ' : '') + (c.cls ? c.cls(r) : '') });
                    if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k];
                    return td;
                }));
        }));
        if (!rows.length) tbody.appendChild(A.el('tr', {}, [A.el('td', { colspan: cols.length, 'class': 'suot-empty', text: opts.empty || 'Нет данных' })]));
        return A.el('div', { 'class': 'suot-tablewrap' }, [A.el('table', { 'class': 'suot-table' }, [thead, tbody])]);
    };
    A.kpi = function (label, value, sub, kind) {
        return A.el('div', { 'class': 'suot-kpi' + (kind ? ' suot-kpi-' + kind : '') }, [A.el('div', { 'class': 'suot-kpi-v', html: value }), A.el('div', { 'class': 'suot-kpi-l', text: label }), sub ? A.el('div', { 'class': 'suot-kpi-s', text: sub }) : null]);
    };
    A.head = function (title, sub) { return [A.el('h1', { text: title }), A.el('p', { 'class': 'suot-sub', text: sub })]; };
    A.fail = function (e) { host.innerHTML = ''; host.appendChild(A.el('div', { 'class': 'suot-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    A.mount = function (fn) {
        if (!host) return;
        A.render = function () { host.textContent = 'Загрузка...'; return A.model().then(function (M) { host.innerHTML = ''; return fn(host, M); }).catch(A.fail); };
        A.meta().then(A.render).catch(A.fail);
    };
    A.nav = function (screen, hash) { return A.url(screen) + (hash ? '#' + hash : ''); };
    A.hash = function () { var o = {}; location.hash.replace(/^#/, '').split('&').forEach(function (p) { var a = p.split('='); if (a[0]) o[a[0]] = decodeURIComponent(a[1] || ''); }); return o; };
    /* Время подписи: дата демо + текущее время суток (строкой ЧЧ:ММ). */
    A.stamp = function () { var d = new Date(); return C.toDmy(A.TODAY) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); };
    A.short = function (fio) { var p = String(fio || '').split(' '); return p[0] + (p[1] ? ' ' + p[1][0] + '.' : '') + (p[2] ? p[2][0] + '.' : ''); };
    /* Выбор работника (с поиском по ФИО и табельному). */
    A.workerSelect = function (M, value, list) {
        return A.select((list || M.workers).map(function (w) { return [w.name, w.name + ' · ' + w.tab + ' · ' + w.pos]; }), value);
    };
    /* Запись в журнал инструктажей/обучения (общая для карточки и календаря). */
    /* ФИО демо-учёток для подписей и журналов */
    A.FIO = { 'ot.lebedeva': 'Лебедева Ольга Николаевна', 'master.tikhonov': 'Тихонов Павел Андреевич', 'sklad.ivanova': 'Иванова Галина Сергеевна', 'nach.kovalev': 'Ковалёв Дмитрий Юрьевич' };
    A.markTraining = function (M, w, kind) {
        var date = A.input('date', M.today), by = A.input('text', A.FIO[A.ctx.user] || ''), prot = A.input('text', '');
        var k = M.kindBy[kind] || {};
        A.modal('Отметить: ' + kind, A.el('div', {}, [A.el('p', { 'class': 'suot-muted', text: w.name + ' · ' + w.pos + (k.basis ? ' · ' + k.basis : '') }), A.field('Дата проведения', date), A.field('Провёл', by), k.cat !== 'Инструктаж' ? A.field('Номер протокола', prot) : null]), [{ text: 'Отмена' }, { text: 'Записать в журнал', cls: 'suot-primary', keep: 1, fn: function (close) {
            var n = M.trainings.reduce(function (m, t) { var x = parseInt(String(t.code).replace(/\D/g, ''), 10) || 0; return Math.max(m, x); }, 0) + 1;
            A.create('Запись обучения', { 'Запись обучения': 'Ж-' + ('000' + n).slice(-4), 'Работник': w.name, 'Вид обучения': kind, 'Дата проведения': C.toDmy(date.value), 'Провёл': by.value, 'Результат обучения': k.cat === 'Инструктаж' ? 'Проведён' : 'Сдал', 'Номер протокола': prot.value })
                .then(function () { close(); A.toast('Записано в журнал: ' + kind); A.render(); }, function (e) { A.toast(e.message, 1); });
        } }]);
    };
})();
