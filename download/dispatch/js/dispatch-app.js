/* Диспетчеризация: общий слой рабочих мест (данные, запись, окна, модель). Расчёты - в dispatch-core.js. */
(function () {
    'use strict';
    var C = window.DispatchCore;
    var P = window.Dsp = { core: C };
    var host = document.getElementById('dispatch-app');
    var ds = host ? host.dataset : {};
    P.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };

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

    P.TODAY = '2026-11-26'; P.CLOCK = '10:40'; /* «сейчас» демо: данные регистраторов выгружены до 10:40 */
    P.NOW = C.stamp(P.TODAY, P.CLOCK);
    P.HEAD_POS = 'Руководитель службы качества';
    /* ---------- модель: все таблицы одним слоем ---------- */
    var modelP = null;
    P.model = function () {
        if (modelP) return modelP;
        var names = ['Режим хранения', 'Сотрудник', 'Объект мониторинга', 'Зона', 'Датчик', 'Дежурство', 'Тревога', 'Партия', 'Акт отклонения', 'Заявка на ремонт', 'Отклонение датчика'];
        var needDev = P.ctx.screen === 'modes' || P.ctx.screen === 'journal' || (P.ctx.screen === 'objects' && P.canWrite('Отклонение датчика'));
        modelP = Promise.all(names.map(function (n) { return n === 'Отклонение датчика' && !needDev ? Promise.resolve(null) : P.rows(n); })).then(function (r) {
            var M = {};
            M.modes = (r[0] || []).map(function (x) { return { id: x._id, name: x['Режим хранения'], min: C.num(x['Нижняя граница, °C']), max: C.num(x['Верхняя граница, °C']), warn: C.num(x['Предупреждение за, °C']), door: C.num(x['Допуск на открытую дверь, мин']), delay: C.num(x['Время до тревоги, мин']), react: C.num(x['Срок реакции, мин']), escalate: C.num(x['Эскалация через, мин']), steps: x['Что делать при тревоге'] || '' }; });
            M.modeBy = P.map(M.modes, 'name');
            M.emps = (r[1] || []).map(function (x) { return { name: x['Сотрудник'], position: x['Должность'], login: x['Логин'], phone: x['Телефон'] }; });
            M.empBy = P.map(M.emps, 'name');
            M.head = (M.emps.filter(function (e) { return e.position === P.HEAD_POS; })[0] || {}).name || '';
            M.objs = (r[2] || []).map(function (x) { return { id: x._id, name: x['Объект мониторинга'], type: x['Тип объекта'], address: x['Адрес объекта'], hours: x['Часы работы'], resp: x['Ответственный объекта'], phone: x['Телефон объекта'] }; });
            M.objBy = P.map(M.objs, 'name');
            M.zones = (r[3] || []).map(function (x) { return { id: x._id, name: x['Зона'], obj: x['Объект мониторинга'], mode: x['Режим хранения'], title: x['Назначение зоны'] }; });
            M.zoneBy = P.map(M.zones, 'name');
            M.sensors = (r[4] || []).map(function (x) { return { id: x._id, name: x['Датчик'], zone: x['Зона'], serial: x['Серийный номер'], last: x['Последнее значение, °C'], time: x['Время значения'], check: C.toIso(x['Поверка до']) }; });
            M.sensorBy = P.map(M.sensors, 'name');
            M.duties = (r[5] || []).map(function (x) { return { date: C.toIso(x['Дежурство']), shift: x['Смена'], line: x['Линия дежурства'], emp: x['Сотрудник'] }; });
            M.alarms = (r[6] || []).map(function (x) {
                return { id: x._id, code: x['Тревога'], obj: x['Объект мониторинга'], zone: x['Зона'], sensor: x['Датчик'], cls: x['Класс события'], date: C.toIso(x['Дата начала']), time: x['Время начала'], minutes: C.num(x['Длительность, мин']), peak: x['Пиковое значение, °C'], status: x['Статус тревоги'] || 'Новая', resp: x['Ответственный'], acceptTime: x['Время принятия'], moved: x['Товар перенесён'] === '1', done: x['Что сделано'], closeDate: C.toIso(x['Дата закрытия']), closeTime: x['Время закрытия'] };
            });
            M.alarmBy = P.map(M.alarms, 'code');
            M.batches = (r[7] || []).map(function (x) { return { id: x._id, name: x['Партия'], drug: x['Препарат'], maker: x['Производитель'], qty: x['Количество, уп'], obj: x['Объект мониторинга'], zone: x['Зона'], inDate: C.toIso(x['Дата поступления']), outDate: C.toIso(x['Дата выбытия']), exp: C.toIso(x['Годен до']) }; });
            M.batchBy = P.map(M.batches, 'name');
            M.acts = r[8] === null ? null : (r[8] || []).map(function (x) { return { id: x._id, code: x['Акт отклонения'], alarm: x['Тревога'], obj: x['Объект мониторинга'], date: C.toIso(x['Дата акта']), cause: x['Причина отклонения'] || '', status: x['Статус акта'] || 'Черновик', signer: x['Подписал'], signTime: x['Время подписи'] }; });
            M.actByAlarm = {}; (M.acts || []).forEach(function (a) { M.actByAlarm[a.alarm] = a; });
            M.repairs = r[9] === null ? null : (r[9] || []).map(function (x) { return { id: x._id, code: x['Заявка на ремонт'], alarm: x['Тревога'], obj: x['Объект мониторинга'], zone: x['Зона'], date: C.toIso(x['Дата заявки']), text: x['Описание неисправности'], org: x['Сервисная организация'], status: x['Статус заявки'] || 'Новая', done: x['Что сделано'], doneDate: C.toIso(x['Дата выполнения']) }; });
            M.repairByAlarm = {}; (M.repairs || []).forEach(function (p) { if (p.alarm) M.repairByAlarm[p.alarm] = p; });
            M.devs = r[10] === null ? null : (r[10] || []).map(function (x) { var s = M.sensorBy[x['Датчик']] || {}; return { code: x['Отклонение датчика'], sensor: x['Датчик'], zone: s.zone, date: C.toIso(x['Дата отклонения']), time: x['Время начала'], minutes: C.num(x['Длительность, мин']), peak: C.num(x['Пиковое значение, °C']), door: x['Дверь открыта'] === '1' }; });
            M.modeOfZone = function (z) { var zz = M.zoneBy[z]; return zz ? M.modeBy[zz.mode] : null; };
            M.objOfZone = function (z) { var zz = M.zoneBy[z]; return zz ? M.objBy[zz.obj] : null; };
            M.chainOf = function (a) { return C.route(M.objBy[a.obj], M.duties, a.date, a.time, M.head); };
            M.esc = function (a) { return C.escalation(a, M.modeOfZone(a.zone) || {}, M.chainOf(a), P.NOW); };
            M.me = M.emps.filter(function (e) { return e.login && e.login === P.ctx.user; })[0] || null;
            M.shift = C.shiftOf(P.TODAY, P.CLOCK);
            P.cur = M;
            return M;
        });
        return modelP;
    };

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
    P.btn = function (text, fn, cls) { return P.el('button', { type: 'button', 'class': 'dsp-btn ' + (cls || ''), onclick: fn, text: text }); };
    P.toast = function (msg, bad) {
        var t = P.el('div', { 'class': 'dsp-toast' + (bad ? ' dsp-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 3000);
    };
    /* Модальное окно (не alert/confirm/prompt). buttons: [{text, fn(close) -> false оставляет окно, cls}] */
    P.modal = function (title, body, buttons, wide) {
        var back = P.el('div', { 'class': 'dsp-modal-back' });
        function close() { back.remove(); }
        var foot = P.el('div', { 'class': 'dsp-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).filter(Boolean).map(function (b) {
            return P.btn(b.text, function () { if (!b.fn || b.fn(close) !== false) close(); }, b.cls);
        }));
        var box = P.el('div', { 'class': 'dsp-modal' + (wide ? ' dsp-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [P.el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box, foot: foot };
    };
    P.field = function (label, input, hint) { return P.el('label', { 'class': 'dsp-field' }, [P.el('span', { text: label }), input, hint ? P.el('small', { text: hint }) : null]); };
    P.select = function (opts, value) {
        var s = P.el('select', {}, opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return P.el('option', { value: v, text: t }); }));
        s.value = value === undefined ? '' : value; return s;
    };
    P.input = function (type, value, attrs) { var i = P.el('input', Object.assign({ type: type }, attrs || {})); i.value = value === undefined ? '' : value; return i; };
    P.badge = function (text, kind) { return '<span class="dsp-badge dsp-' + (kind || 'info') + '">' + P.esc(text) + '</span>'; };
    P.tabs = function (items, active, onpick) {
        return P.el('div', { 'class': 'dsp-tabs', role: 'tablist' }, items.map(function (it) {
            return P.el('button', { type: 'button', role: 'tab', 'class': 'dsp-tab' + (it[0] === active ? ' dsp-tab-on' : ''), 'aria-selected': it[0] === active ? 'true' : 'false', onclick: function () { onpick(it[0]); }, text: it[1] });
        }));
    };
    /* Таблица: cols = [{k, t, num, cls(r), html(r)}] */
    P.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = P.el('thead', {}, [P.el('tr', {}, cols.map(function (c) { return P.el('th', { text: c.t, 'class': c.num ? 'dsp-num' : '' }); }))]);
        var tbody = P.el('tbody', {}, rows.map(function (r) {
            return P.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' dsp-click' : ''), onclick: opts.onrow ? function () { opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = P.el('td', { 'class': (c.num ? 'dsp-num ' : '') + (c.cls ? c.cls(r) : '') });
                    if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k];
                    return td;
                }));
        }));
        if (!rows.length) tbody.appendChild(P.el('tr', {}, [P.el('td', { colspan: cols.length, 'class': 'dsp-empty', text: opts.empty || 'Нет данных' })]));
        return P.el('div', { 'class': 'dsp-tablewrap' }, [P.el('table', { 'class': 'dsp-table' }, [thead, tbody])]);
    };
    P.kpi = function (label, value, sub, kind) {
        return P.el('div', { 'class': 'dsp-kpi' + (kind ? ' dsp-kpi-' + kind : '') }, [P.el('div', { 'class': 'dsp-kpi-v', html: value }), P.el('div', { 'class': 'dsp-kpi-l', text: label }), sub ? P.el('div', { 'class': 'dsp-kpi-s', text: sub }) : null]);
    };
    P.fail = function (e) { host.innerHTML = ''; host.appendChild(P.el('div', { 'class': 'dsp-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    P.rerender = null;
    P.mount = function (fn) {
        if (!host) return;
        host.textContent = 'Загрузка...';
        P.rerender = function (M) { return fn(host, M); };
        P.meta().then(function () { return P.model(); }).then(function (M) { return fn(host, M); }).catch(P.fail);
    };
    /* После записи: модель заново, экран перерисовывается. */
    P.resetModel = function () { modelP = null; };
    P.refresh = function () { P.resetModel(); return P.model().then(function (M) { if (P.rerender) P.rerender(M); }).catch(P.fail); };
    P.nav = function (screen, hash) { return P.url(screen) + (hash ? '#' + hash : ''); };
    P.hash = function () { var o = {}; location.hash.replace(/^#/, '').split('&').forEach(function (p) { var a = p.split('='); if (a[0]) o[a[0]] = decodeURIComponent(a[1] || ''); }); return o; };
    /* Создание и изменение записей (поля - по именам). */
    P.create = function (table, fields, up) { return P.post('_m_new/' + P.tid(table) + '?JSON', { up: up || 1, fields: fields }); };
    P.newId = function (j) { var x = Array.isArray(j) ? j[0] : j; return x && (x.id || x.obj); };
    P.update = function (id, fields) { return P.post('_m_set/' + id + '?JSON', { fields: fields }); };
    P.head = function (title, sub) { return [P.el('h1', { text: title }), P.el('p', { 'class': 'dsp-sub', text: sub })]; };
})();
