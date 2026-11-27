/* Service Desk: общий слой рабочих мест (данные, запись, модель, часы демо). Расчёты - в desk-core.js. */
(function () {
    'use strict';
    var C = window.DeskCore;
    var P = window.Desk = { core: C };
    var host = document.getElementById('desk-app');
    var ds = host ? host.dataset : {};
    P.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };
    /* Часы демо: данные собраны на 26.11.2026 11:30. В этот день в рабочее время идут живые часы, в другие дни часы стоят. */
    P.DEMO_NOW = '2026-11-26 11:30';
    P.now = function () {
        var msk = new Date(Date.now() + 3 * 3600000), iso = msk.toISOString();
        var h = msk.getUTCHours();
        if (iso.slice(0, 10) === P.DEMO_NOW.slice(0, 10) && h >= 9 && h < 18 && iso.slice(11, 16) > P.DEMO_NOW.slice(11)) return C.parseDt(iso.slice(0, 10) + ' ' + iso.slice(11, 16));
        return C.parseDt(P.DEMO_NOW);
    };

    P.dec = function (s) { return typeof s === 'string' ? s.replace(/&comma;/g, ',') : s; };
    P.esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    P.url = function (p) { return '/' + P.ctx.db + '/' + p; };
    P.get = function (p) {
        return fetch(P.url(p), { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + p);
            return r.json();
        });
    };
    /* POST с XSRF; вложенные объекты уходят JSON-строкой. */
    P.post = function (p, fields) {
        var fd = new FormData();
        fd.append('_xsrf', P.ctx.xsrf);
        Object.keys(fields || {}).forEach(function (k) { var v = fields[k]; fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v); });
        return fetch(P.url(p), { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) { return r.json().catch(function () { return { error: 'Нет прав на это действие' }; }); })
            .then(function (j) {
                var e = Array.isArray(j) ? j[0] : j; if (e && e.error) throw new Error(e.error);
                (j && j.results || []).forEach(function (x) {
                    if (x.ok === false || x.error) throw new Error(x.error || x.message || 'Операция не выполнена');
                    /* справочник уникален: «уже существует» значит, что новая запись не создана */
                    if (x.op === 'new' && /уже существует/.test(String(x.warnings || ''))) throw new Error('Запись уже существует - обновите страницу и повторите');
                });
                return j;
            });
    };
    var metaP = null;
    P.meta = function () { return metaP || (metaP = P.get('metadata?JSON=1').then(function (m) { var by = {}; m.forEach(function (t) { by[t.val] = t; }); P.metaBy = by; return by; })); };
    P.tid = function (name) { return P.metaBy[name] && P.metaBy[name].id; };
    P.canWrite = function (name) { return !!(P.metaBy[name] && P.metaBy[name].granted === 'WRITE'); };
    P.canRead = function (name) { return !!P.metaBy[name]; };

    function norm(o) {
        var r = { _id: String(o.id), _ref: {} };
        Object.keys(o).forEach(function (k) {
            if (k === 'id' || k === 'up' || k === 'ord') return;
            var v = o[k];
            if (v && typeof v === 'object') { if (v.id !== undefined) { r[k] = P.dec(v.val); r._ref[k] = String(v.id); } return; }
            r[k] = v === null ? '' : P.dec(v);
        });
        return r;
    }
    P.rows = function (name) {
        if (!P.canRead(name)) return Promise.resolve([]);
        return P.get('object/' + P.tid(name) + '/?JSON_OBJ&NAMED&LIMIT=0,5000').then(function (j) { if (!Array.isArray(j)) throw new Error('Нет доступа к таблице «' + name + '»'); return j.map(norm); });
    };
    P.num = C.num;
    P.dt = function (v) { return C.parseDt(v); };
    P.wr = function (min) { return min === null || min === undefined ? '' : C.fmtDt(min) + ':00'; };
    P.mapBy = function (rows, key) { var m = {}; (rows || []).forEach(function (r) { m[r[key]] = r; }); return m; };

    /* ---------- модель ---------- */
    var modelP = null;
    var NAMES = ['Служба', 'Приоритет', 'Помещение', 'Сотрудник', 'Исполнитель', 'Статус заявки', 'Услуга', 'Нерабочий день', 'Параметр SLA', 'Заявка', 'Согласование', 'Ход заявки'];
    P.model = function () {
        if (modelP) return modelP;
        modelP = Promise.all(NAMES.map(function (n) { return P.rows(n); })).then(function (r) {
            var M = { now: P.now() };
            M.services = r[0].map(function (x) { return { id: x._id, name: x['Служба'], head: x['Руководитель службы'], headLogin: x['Логин руководителя службы'], ord: C.num(x['Порядок службы']) }; }).sort(function (a, b) { return a.ord - b.ord; });
            M.serviceBy = P.mapBy(M.services, 'name');
            M.prios = r[1].map(function (x) { return { id: x._id, name: x['Приоритет'], mult: C.num(x['Множитель срока']) || 1, ord: C.num(x['Порядок приоритета']) }; }).sort(function (a, b) { return a.ord - b.ord; });
            M.prioBy = P.mapBy(M.prios, 'name');
            M.rooms = r[2].map(function (x) { return { id: x._id, name: x['Помещение'], site: x['Площадка'], floor: x['Этаж'], purpose: x['Назначение помещения'] }; });
            M.roomBy = P.mapBy(M.rooms, 'name');
            M.emps = r[3].map(function (x) { return { id: x._id, name: x['Сотрудник'], login: x['Логин сотрудника'], position: x['Должность сотрудника'], dept: x['Отдел'], room: x['Рабочее место'], manager: x['Руководитель сотрудника'], managerLogin: x['Логин руководителя'], phone: x['Телефон сотрудника'] }; });
            M.empBy = P.mapBy(M.emps, 'name'); M.empByLogin = P.mapBy(M.emps, 'login');
            M.execs = r[4].map(function (x) { return { id: x._id, name: x['Исполнитель'], service: x['Служба'], type: x['Тип исполнителя'], org: x['Организация'], login: x['Логин исполнителя'] }; });
            M.execBy = P.mapBy(M.execs, 'name');
            M.statuses = r[5].map(function (x) { return { id: x._id, name: x['Статус заявки'], ord: C.num(x['Порядок статуса']), timer: x['Таймер SLA'], human: x['Для заявителя'] }; }).sort(function (a, b) { return a.ord - b.ord; });
            M.statusBy = P.mapBy(M.statuses, 'name');
            M.catalog = r[6].map(function (x) {
                return { id: x._id, name: x['Услуга'], service: x['Служба'], group: x['Группа услуг'], descr: x['Описание услуги'], keywords: x['Ключевые слова'], form: x['Поля формы'], route: x['Маршрут согласования'], exec: x['Исполнитель'], prio: x['Приоритет'], reactH: C.num(x['Реакция, ч']), solveH: C.num(x['Решение, ч']), published: x['Опубликована'] === '1' };
            });
            M.svcBy = P.mapBy(M.catalog, 'name');
            M.hol = {}; r[7].forEach(function (x) { var d = C.parseDt(x['Нерабочий день']); if (d !== null) M.hol[C.isoOf(d)] = x['Праздник'] || 1; });
            var pv = {}; M.paramRows = {}; r[8].forEach(function (x) { pv[x['Параметр SLA']] = C.num(x['Значение параметра']); M.paramRows[x['Параметр SLA']] = x; });
            M.rules = { dayStart: pv['Начало рабочего дня'] || 9, dayEnd: pv['Конец рабочего дня'] || 18, warnPct: pv['Порог предупреждения, %'] || 80, autoCloseDays: pv['Автозакрытие, раб. дней'] || 3, target: pv['Цель SLA, %'] || 90 };
            M.cal = C.calendar(M.rules, M.hol);
            M.tickets = r[9].map(function (x) { return P.ticket(M, x); });
            M.ticketBy = P.mapBy(M.tickets, 'num');
            M.approvals = r[10].map(function (x) { return { id: x._id, num: x['Заявка'], step: C.num(x['Шаг согласования']), who: x['Согласующий'], login: x['Логин согласующего'], decision: x['Решение согласования'], date: C.parseDt(x['Дата решения']), comment: x['Комментарий согласующего'] }; });
            M.events = r[11].map(function (x) { return { id: x._id, num: x['Заявка'], when: C.parseDt(x['Когда']), who: x['Автор события'], text: x['Событие'] }; }).sort(function (a, b) { return a.when - b.when; });
            M.me = M.empByLogin[P.ctx.user] || null;
            M.meExec = M.execs.filter(function (e) { return e.login === P.ctx.user; })[0] || null;
            P.cur = M;
            return M;
        });
        return modelP;
    };
    /* Запись «Заявка» -> объект с таймером SLA. */
    P.ticket = function (M, x) {
        var t = { id: x._id, num: x['Заявка'], service: x['Услуга'], emp: x['Заявитель'], empLogin: x['Логин заявителя'], room: x['Помещение'], topic: x['Тема заявки'], descr: x['Описание заявки'],
            prio: x['Приоритет'], status: x['Статус заявки'], exec: x['Исполнитель'], execLogin: x['Логин исполнителя'], channel: x['Канал'], created: C.parseDt(x['Создана']),
            reactDl: C.parseDt(x['Срок реакции']), solveDl: C.parseDt(x['Срок решения']), taken: C.parseDt(x['Взята в работу']), resolved: C.parseDt(x['Решена']), closed: C.parseDt(x['Закрыта']),
            pausedFrom: C.parseDt(x['Пауза с']), pauseMin: C.num(x['Пауза, мин']), answer: x['Решение заявки'] };
        var ph = /href="([^"]+)"/.exec(x['Фото решения'] || ''); t.photo = ph && /^\/download\//.test(ph[1]) ? ph[1] : '';
        var svc = M.svcBy[t.service] || { reactH: 8, solveH: 8 }, b = C.budget(svc, M.prioBy[t.prio]);
        t.svc = svc; t.dept = svc.service || '';
        t.reactBudget = b.react; t.solveBudget = b.solve;
        var st = M.statusBy[t.status];
        t.timer = st ? st.timer : 'идёт';
        t.sla = C.slaState({ created: t.created, solveBudget: b.solve, pauseMin: t.pauseMin, pausedFrom: t.pausedFrom, resolved: t.resolved, timer: t.timer }, M.now, M.cal, M.rules.warnPct);
        t.reactOk = C.reactionMet(t, M.cal);
        t.bucket = C.bucketOf(t);
        var e = M.empBy[t.emp]; t.empDept = e ? e.dept : '';
        return t;
    };
    P.resetModel = function () { modelP = null; };
    P.reload = function (fn) { P.resetModel(); return P.model().then(fn); };
    P.create = function (table, fields) { return P.post('_m_new/' + P.tid(table) + '?JSON', { up: 1, fields: fields }); };
    P.update = function (id, fields) { return P.post('_m_set/' + id + '?JSON', { fields: fields }); };
    P.batch = function (ops) { return P.post('_m_batch?JSON', { ops: ops }); };
    /* Событие в ходе заявки (операция пакета). */
    P.evOp = function (num, who, text, login) { return { op: 'new', id: 'Ход заявки', up: 1, fields: { 'Заявка': num, 'Когда': P.wr(P.now()), 'Автор события': who, 'Событие': text, 'Логин заявителя': login } }; };
    /* Номер новой заявки: заявитель видит только свои заявки, поэтому последний номер берётся из отчёта по всем. */
    P.nextNum = function (M) {
        return P.get('report/' + encodeURIComponent('Последний номер заявки') + '?JSON_KV').then(function (j) {
            return C.nextNumber(M.tickets.concat(Array.isArray(j) && j[0] ? [{ num: j[0]['Номер'] }] : []));
        }).catch(function () { return C.nextNumber(M.tickets); });
    };
    P.myName = function (M) { return M.me ? M.me.name : M.meExec ? M.meExec.name : P.ctx.user; };
})();
