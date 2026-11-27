/* MDC: общий слой рабочих мест (данные, запись, окна, модель). Расчёты - в mdc-core.js. */
(function () {
    'use strict';
    var C = window.MdcCore;
    var P = window.Mdc = { core: C };
    var host = document.getElementById('mdc-app');
    var ds = host ? host.dataset : {};
    P.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };
    P.TODAY = '2026-11-26'; P.CLOCK = '10:40'; /* «сейчас» демо: данные шлюза выгружены до 10:40 */
    P.NOW = C.stamp(P.TODAY, P.CLOCK);
    P.WEEK_DAYS = 7.4; /* 19.11 00:00 - 26.11 10:40 */

    P.dec = function (s) { return typeof s === 'string' ? s.replace(/&comma;/g, ',') : s; };
    P.esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    P.url = function (p) { return '/' + P.ctx.db + '/' + p; };
    P.get = function (p) {
        return fetch(P.url(p), { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { /* no-store: после записи модель читается заново, а не из кэша браузера */
            if (r.status === 403) { var e = new Error('403'); e.denied = true; throw e; }
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + p);
            return r.json();
        });
    };
    P.post = function (p, fields) {
        var fd = new FormData();
        fd.append('_xsrf', P.ctx.xsrf);
        Object.keys(fields || {}).forEach(function (k) { var v = fields[k]; fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v); });
        return fetch(P.url(p), { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (s) {
            var j; try { j = JSON.parse(s); } catch (e) { throw new Error(s.slice(0, 200) || 'Пустой ответ'); }
            var e1 = Array.isArray(j) ? j[0] : j; if (e1 && e1.error) throw new Error(e1.error); return j;
        });
    };
    var metaP = null;
    P.meta = function () { return metaP || (metaP = P.get('metadata?JSON=1').then(function (m) { var by = {}; m.forEach(function (t) { by[t.val] = t; }); P.metaBy = by; return by; })); };
    P.tid = function (name) { return P.metaBy[name] && P.metaBy[name].id; };
    P.canWrite = function (name) { return !!(P.metaBy[name] && P.metaBy[name].granted === 'WRITE'); };

    function norm(o) {
        var r = { _id: String(o.id) };
        Object.keys(o).forEach(function (k) {
            if (k === 'id' || k === 'up' || k === 'ord') return;
            var v = o[k];
            if (v && typeof v === 'object') { if (v.id !== undefined) r[k] = P.dec(v.val); return; }
            r[k] = v === null ? '' : P.dec(v);
        });
        return r;
    }
    /* Таблица по имени; нет гранта (403) - null, экран показывает, что раздел закрыт ролью. */
    P.rows = function (name) {
        if (!P.metaBy[name]) return Promise.resolve(null);
        var id = P.tid(name), out = [], PAGE = 1000;
        function page(off) {
            return P.get('object/' + id + '/?JSON_OBJ&NAMED&LIMIT=' + off + ',' + PAGE).then(function (j) {
                if (!Array.isArray(j)) return null;
                j.forEach(function (o) { out.push(norm(o)); });
                return j.length < PAGE ? out : page(off + PAGE);
            });
        }
        return page(0).catch(function (e) { if (e.denied) return null; throw e; });
    };
    P.map = function (rows, key) { var m = {}; (rows || []).forEach(function (r) { m[r[key]] = r; }); return m; };
    P.num = C.num;
    P.fmt = function (x, d) { return C.num(x).toFixed(d || 0).replace('.', ','); };
    P.val = function (x) { var n = C.num(x); return String(Math.round(n * 10) / 10).replace('.', ','); };

    /* ---------- модель: все таблицы одним слоем ---------- */
    var modelP = null;
    P.model = function () {
        if (modelP) return modelP;
        var names = ['Участок', 'Оборудование', 'Датчик', 'Параметр', 'Правило тревоги', 'Причина простоя', 'Сотрудник', 'Дежурство', 'Инцидент', 'Заявка на ремонт', 'Отклонение параметра'];
        /* отклонения нужны прогону правил и имитации шлюза (у кого есть запись) */
        var needDev = P.ctx.screen === 'rules' || (P.ctx.screen === 'shift' && P.canWrite('Отклонение параметра'));
        modelP = Promise.all(names.map(function (n) { return n === 'Отклонение параметра' && !needDev ? Promise.resolve(null) : P.rows(n); })).then(function (r) {
            var M = {};
            M.sections = (r[0] || []).map(function (x) { return { name: x['Участок'], code: x['Код участка'], master: x['Мастер участка'] }; });
            M.secBy = P.map(M.sections, 'name');
            M.eqs = (r[1] || []).map(function (x) { return { id: x._id, name: x['Оборудование'], title: x['Наименование оборудования'], section: x['Участок'], model: x['Модель оборудования'], status: x['Статус оборудования'] || 'Работает', since: x['Время статуса'], sinceDate: C.toIso(x['Дата статуса']), topic: x['Топик шлюза'] }; });
            M.eqBy = P.map(M.eqs, 'name');
            M.params = (r[3] || []).map(function (x) { return { name: x['Параметр'], unit: x['Единица измерения'] }; });
            M.unitBy = {}; M.params.forEach(function (p) { M.unitBy[p.name] = p.unit; });
            M.sensors = (r[2] || []).map(function (x) { return { id: x._id, name: x['Датчик'], eq: x['Оборудование'], param: x['Параметр'], last: x['Последнее значение'], time: x['Время значения'] }; });
            M.sensorBy = P.map(M.sensors, 'name');
            M.rules = (r[4] || []).map(function (x) {
                return { id: x._id, name: x['Правило тревоги'], param: x['Параметр'], cond: x['Условие'] || '>', threshold: C.num(x['Порог']), minutes: C.num(x['Дольше, мин']), severity: x['Важность'], react: C.num(x['Срок реакции, мин']), escalate: C.num(x['Эскалация через, мин']), repair: x['Создавать заявку'] === '1', active: x['Правило активно'] === '1', text: x['Пояснение правила'], unit: M.unitBy[x['Параметр']] || '' };
            });
            M.ruleBy = P.map(M.rules, 'name');
            M.causes = (r[5] || []).map(function (x) { return { name: x['Причина простоя'], cat: x['Категория причины'], planned: x['Плановый простой'] === '1' }; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
            M.causeNames = M.causes.map(function (c) { return c.name; });
            M.emps = (r[6] || []).map(function (x) { return { name: x['Сотрудник'], position: x['Должность'], section: x['Участок'], login: x['Логин'], phone: x['Телефон'] }; });
            M.empBy = P.map(M.emps, 'name');
            M.duties = (r[7] || []).map(function (x) { return { date: C.toIso(x['Дежурство']), shift: x['Смена'], section: x['Участок'], emp: x['Сотрудник'] }; });
            M.incidents = (r[8] || []).map(function (x) {
                return { id: x._id, code: x['Инцидент'], eq: x['Оборудование'], section: x['Участок'], rule: x['Правило тревоги'], severity: x['Важность'], date: C.toIso(x['Дата начала']), time: x['Время начала'], peak: x['Пиковое значение'], status: x['Статус инцидента'] || 'Новый', resp: x['Ответственный'], acceptTime: x['Время принятия'], cause: x['Причина простоя'], closeDate: C.toIso(x['Дата закрытия']), closeTime: x['Время закрытия'], comment: x['Комментарий диспетчера'] };
            });
            M.incidents.forEach(function (i) { var ru = M.ruleBy[i.rule]; i.param = ru ? ru.param : ''; });
            M.incBy = P.map(M.incidents, 'code');
            M.repairs = r[9] === null ? null : (r[9] || []).map(function (x) {
                return { id: x._id, code: x['Заявка на ремонт'], incident: x['Инцидент'], eq: x['Оборудование'], section: x['Участок'], severity: x['Важность'], date: C.toIso(x['Дата заявки']), status: x['Статус заявки'] || 'Новая', worker: x['Исполнитель'], text: x['Описание неисправности'], done: x['Что сделано'], doneDate: C.toIso(x['Дата выполнения']) };
            });
            M.repairByInc = {}; (M.repairs || []).forEach(function (p) { if (p.incident) M.repairByInc[p.incident] = p; });
            M.devs = r[10] === null ? null : (r[10] || []).map(function (x) { var s = M.sensorBy[x['Датчик']] || {}; return { code: x['Отклонение параметра'], sensor: x['Датчик'], param: s.param, eq: s.eq, date: C.toIso(x['Дата отклонения']), time: x['Время начала'], minutes: C.num(x['Длительность, мин']), peak: C.num(x['Пиковое значение']) }; });
            M.me = M.emps.filter(function (e) { return e.login && e.login === P.ctx.user; })[0] || null;
            M.shift = C.shiftOf(P.TODAY, P.CLOCK);
            M.onDuty = function (section) { return C.onDuty(M.duties, section, P.TODAY, P.CLOCK); };
            P.cur = M;
            return M;
        });
        return modelP;
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
    P.btn = function (text, fn, cls) { return P.el('button', { type: 'button', 'class': 'mdc-btn ' + (cls || ''), onclick: fn, text: text }); };
    P.toast = function (msg, bad) {
        var t = P.el('div', { 'class': 'mdc-toast' + (bad ? ' mdc-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 3000);
    };
    /* Модальное окно (не alert/confirm/prompt). buttons: [{text, fn(close) -> false оставляет окно, cls}] */
    P.modal = function (title, body, buttons, wide) {
        var back = P.el('div', { 'class': 'mdc-modal-back' });
        function close() { back.remove(); }
        var foot = P.el('div', { 'class': 'mdc-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).filter(Boolean).map(function (b) {
            return P.btn(b.text, function () { if (!b.fn || b.fn(close) !== false) close(); }, b.cls);
        }));
        var box = P.el('div', { 'class': 'mdc-modal' + (wide ? ' mdc-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [P.el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box, foot: foot };
    };
    P.field = function (label, input, hint) { return P.el('label', { 'class': 'mdc-field' }, [P.el('span', { text: label }), input, hint ? P.el('small', { text: hint }) : null]); };
    P.select = function (opts, value) {
        var s = P.el('select', {}, opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return P.el('option', { value: v, text: t }); }));
        s.value = value === undefined ? '' : value; return s;
    };
    P.input = function (type, value, attrs) { var i = P.el('input', Object.assign({ type: type }, attrs || {})); i.value = value === undefined ? '' : value; return i; };
    P.badge = function (text, kind) { return '<span class="mdc-badge mdc-' + (kind || 'info') + '">' + P.esc(text) + '</span>'; };
    P.tabs = function (items, active, onpick) {
        return P.el('div', { 'class': 'mdc-tabs', role: 'tablist' }, items.map(function (it) {
            return P.el('button', { type: 'button', role: 'tab', 'class': 'mdc-tab' + (it[0] === active ? ' mdc-tab-on' : ''), 'aria-selected': it[0] === active ? 'true' : 'false', onclick: function () { onpick(it[0]); }, text: it[1] });
        }));
    };
    /* Таблица: cols = [{k, t, num, cls(r), html(r)}] */
    P.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = P.el('thead', {}, [P.el('tr', {}, cols.map(function (c) { return P.el('th', { text: c.t, 'class': c.num ? 'mdc-num' : '' }); }))]);
        var tbody = P.el('tbody', {}, rows.map(function (r) {
            return P.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' mdc-click' : ''), onclick: opts.onrow ? function () { opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = P.el('td', { 'class': (c.num ? 'mdc-num ' : '') + (c.cls ? c.cls(r) : '') });
                    if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k];
                    return td;
                }));
        }));
        if (!rows.length) tbody.appendChild(P.el('tr', {}, [P.el('td', { colspan: cols.length, 'class': 'mdc-empty', text: opts.empty || 'Нет данных' })]));
        return P.el('div', { 'class': 'mdc-tablewrap' }, [P.el('table', { 'class': 'mdc-table' }, [thead, tbody])]);
    };
    P.kpi = function (label, value, sub, kind) {
        return P.el('div', { 'class': 'mdc-kpi' + (kind ? ' mdc-kpi-' + kind : '') }, [P.el('div', { 'class': 'mdc-kpi-v', html: value }), P.el('div', { 'class': 'mdc-kpi-l', text: label }), sub ? P.el('div', { 'class': 'mdc-kpi-s', text: sub }) : null]);
    };
    P.fail = function (e) { host.innerHTML = ''; host.appendChild(P.el('div', { 'class': 'mdc-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    P.rerender = null;
    P.mount = function (fn) {
        if (!host) return;
        host.textContent = 'Загрузка...';
        P.rerender = function (M) { return fn(host, M); };
        P.meta().then(function () { return P.model(); }).then(function (M) { return fn(host, M); }).catch(P.fail);
    };
    /* После записи: модель заново, экран перерисовывается. */
    P.refresh = function () { P.resetModel(); return P.model().then(function (M) { if (P.rerender) P.rerender(M); }).catch(P.fail); };
    P.nav = function (screen, hash) { return P.url(screen) + (hash ? '#' + hash : ''); };
    P.hash = function () { var o = {}; location.hash.replace(/^#/, '').split('&').forEach(function (p) { var a = p.split('='); if (a[0]) o[a[0]] = decodeURIComponent(a[1] || ''); }); return o; };
    /* Создание и изменение записей (поля - по именам). */
    P.create = function (table, fields) { return P.post('_m_new/' + P.tid(table) + '?JSON', { up: 1, fields: fields }); };
    P.update = function (id, fields) { return P.post('_m_set/' + id + '?JSON', { fields: fields }); };
    P.head = function (title, sub) { return [P.el('h1', { text: title }), P.el('p', { 'class': 'mdc-sub', text: sub })]; };
})();
