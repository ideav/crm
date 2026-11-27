/* Адаптация персонала: общий слой рабочих мест (данные, запись, модель, дата демо). Расчёты - в onboard-core.js. */
(function () {
    'use strict';
    var C = window.OnboardCore;
    var P = window.Onb = { core: C };
    var host = document.getElementById('onboard-app');
    var ds = host ? host.dataset : {};
    P.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };
    /* Дата демо: данные собраны на четверг 26.11.2026, светофор и сроки считаются от неё. */
    P.DEMO_TODAY = '2026-11-26';
    P.today = function () { return C.fromIso(P.DEMO_TODAY); };
    P.EXTEND_DAYS = 30;

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
        return P.get('object/' + P.tid(name) + '/?JSON_OBJ&NAMED&LIMIT=0,5000').then(function (j) { return Array.isArray(j) ? j.map(norm) : []; });
    };
    P.mapBy = function (rows, key) { var m = {}; (rows || []).forEach(function (r) { m[r[key]] = r; }); return m; };
    P.d = function (d) { return C.fmtD(d); };

    /* ---------- модель ---------- */
    var modelP = null;
    var NAMES = ['Подразделение', 'Роль шага', 'Маршрут адаптации', 'Шаг маршрута', 'Должность', 'Сотрудник', 'Статус новичка', 'Причина ухода', 'Параметр адаптации', 'Новичок', 'Шаг новичка', 'Ход адаптации'];
    P.model = function () {
        if (modelP) return modelP;
        modelP = Promise.all(NAMES.map(function (n) { return P.rows(n); })).then(function (r) {
            var M = { today: P.today() }, num = C.num;
            M.depts = r[0].map(function (x) { return { id: x._id, name: x['Подразделение'], kind: x['Тип площадки'], head: x['Руководитель подразделения'], headLogin: x['Логин руководителя'], ord: num(x['Порядок подразделения']) }; }).sort(function (a, b) { return a.ord - b.ord; });
            M.deptBy = P.mapBy(M.depts, 'name');
            M.roles = r[1].map(function (x) { return { id: x._id, name: x['Роль шага'], exec: x['Исполнитель по умолчанию'], login: x['Логин исполнителя роли'] === 'нет' ? '' : x['Логин исполнителя роли'], ord: num(x['Порядок роли']), group: x['Служба роли'] }; }).sort(function (a, b) { return a.ord - b.ord; });
            M.roleBy = P.mapBy(M.roles, 'name');
            M.routes = r[2].map(function (x) { return { id: x._id, name: x['Маршрут адаптации'], descr: x['Описание маршрута'], prob: num(x['Испытательный срок, дн']) || 90, steps: [] }; });
            M.routeBy = P.mapBy(M.routes, 'name');
            M.rsteps = r[3].map(function (x) {
                return { id: x._id, name: x['Шаг маршрута'], route: x['Маршрут адаптации'], role: x['Роль шага'], basis: x['Отсчёт шага'] || 'от выхода', offset: num(x['Смещение, дн']), order: num(x['Порядок шага']), type: x['Тип шага'] || 'Задача', hidden: x['Скрыт от новичка'] === '1', hint: x['Подсказка шага'] };
            });
            M.rsteps.forEach(function (s) { var rt = M.routeBy[s.route]; if (rt) rt.steps.push(s); });
            M.routes.forEach(function (rt) { rt.steps.sort(function (a, b) { return a.order - b.order; }); });
            M.rstepBy = P.mapBy(M.rsteps, 'id');
            M.positions = r[4].map(function (x) { return { id: x._id, name: x['Должность'], dept: x['Подразделение'], route: x['Маршрут адаптации'] }; });
            M.posBy = P.mapBy(M.positions, 'name');
            M.staff = r[5].map(function (x) { return { id: x._id, name: x['Сотрудник'], login: x['Логин сотрудника'], position: x['Должность сотрудника'], dept: x['Подразделение'], phone: x['Телефон сотрудника'], mentor: x['Может быть наставником'] === '1' }; });
            M.staffBy = P.mapBy(M.staff, 'name'); M.staffByLogin = P.mapBy(M.staff, 'login');
            M.statuses = r[6].map(function (x) { return { id: x._id, name: x['Статус новичка'], ord: num(x['Порядок статуса']), stage: x['Этап статуса'] }; }).sort(function (a, b) { return a.ord - b.ord; });
            M.reasons = r[7].map(function (x) { return { id: x._id, name: x['Причина ухода'], group: x['Группа причин'] }; });
            var pv = {}; M.paramRows = {}; r[8].forEach(function (x) { pv[x['Параметр адаптации']] = num(x['Значение параметра']); M.paramRows[x['Параметр адаптации']] = x; });
            M.rules = { warn: pv['Предупреждать за, дн'] === undefined ? 2 : pv['Предупреждать за, дн'], finish: pv['Завершают: дней до конца срока'] || 14, notify: pv['Уведомить руководителя за, дн до выхода'] || 5 };
            M.steps = r[10].map(function (x) {
                return { id: x._id, name: x['Шаг новичка'], nb: x['Новичок'], nbId: x._ref['Новичок'], stepId: x._ref['Шаг маршрута'] || '', role: x['Роль шага'], exec: x['Исполнитель шага'], execLogin: x['Логин исполнителя'],
                    type: x['Тип шага'] || 'Задача', order: num(x['Порядок шага']), due: C.parseD(x['Срок шага']), done: C.parseD(x['Дата выполнения']), comment: x['Комментарий шага'], seen: x['Видит новичок'], hidden: x['Видит новичок'] === 'нет',
                    mentorLogin: x['Логин наставника'], managerLogin: x['Логин руководителя'] };
            });
            var stepsOf = {}; M.steps.forEach(function (s) { (stepsOf[s.nbId] = stepsOf[s.nbId] || []).push(s); });
            M.newbies = r[9].map(function (x) { return P.newbie(M, x, stepsOf[x._id] || []); });
            /* исполнитель службы не видит карточки новичков - собираем их из его шагов */
            if (!M.newbies.length && M.steps.length) {
                var seen = {}; M.steps.forEach(function (s) { if (!seen[s.nbId]) { seen[s.nbId] = 1; M.newbies.push(P.newbie(M, { _id: s.nbId, _ref: {}, 'Новичок': s.nb, partial: true }, stepsOf[s.nbId])); } });
            }
            M.nbBy = P.mapBy(M.newbies, 'id');
            M.events = r[11].map(function (x) { return { id: x._id, nbId: x._ref['Новичок'], when: x['Когда'], who: x['Автор события'], text: x['Событие'] }; }).sort(function (a, b) { return String(b.when).localeCompare(String(a.when)); });
            M.me = M.staffByLogin[P.ctx.user] || null;
            P.cur = M;
            return M;
        });
        return modelP;
    };
    /* Запись «Новичок» -> объект со светофором, днём испытательного и корзиной панели. */
    P.newbie = function (M, x, steps) {
        var pos = M.posBy[x['Должность']] || {}, rt = M.routeBy[pos.route] || null;
        var n = { id: x._id, name: x['Новичок'], pos: x['Должность'] || '', dept: x['Подразделение'] || pos.dept || '', status: x['Статус новичка'] || '', offer: C.parseD(x['Дата оффера']), start: C.parseD(x['Дата выхода']),
            mentor: x['Наставник'] || '', mentorLogin: x['Логин наставника'] || 'нет', managerLogin: x['Логин руководителя'] || 'нет', login: x['Логин новичка'] || 'нет', phone: x['Телефон новичка'] || '',
            source: x['Источник оффера'] || '', decision: x['Решение по испытательному'] || '', reason: x['Причина ухода'] || '', comment: x['Комментарий решения'] || '', ddate: C.parseD(x['Дата решения']),
            route: rt, partial: !!x.partial };
        n.steps = (steps || []).slice().sort(function (a, b) { return a.order - b.order; });
        var len = (rt ? rt.prob : 90) + (n.status === 'Продлён испытательный' ? P.EXTEND_DAYS : 0);
        n.prob = C.probation(n.start, M.today, len);
        n.light = C.light(n.steps, M.today, M.rules.warn);
        n.prog = C.progress(n.steps);
        n.bucket = C.bucketOf(n, n.light, n.prob);
        if (n.bucket === 'going' && n.prob.left !== null && n.prob.left <= M.rules.finish) n.bucket = 'finishing';
        return n;
    };
    P.resetModel = function () { modelP = null; };
    P.reload = function (fn) { P.resetModel(); return P.model().then(fn); };
    P.update = function (id, fields) { return P.post('_m_set/' + id + '?JSON', { fields: fields }); };
    P.batch = function (ops) { return P.post('_m_batch?JSON', { ops: ops }); };
    P.when = function () { var d = new Date(Date.now() + 3 * 3600000).toISOString(); return P.DEMO_TODAY + ' ' + d.slice(11, 16) + ':00'; };
    /* Событие хода адаптации (операция пакета). */
    P.evOp = function (nb, who, text) { return { op: 'new', id: 'Ход адаптации', up: 1, fields: { 'Ход адаптации': text.slice(0, 60), 'Новичок': nb.id, 'Когда': P.when(), 'Автор события': who, 'Событие': text, 'Логин наставника': nb.mentorLogin || 'нет', 'Логин руководителя': nb.managerLogin || 'нет' } }; };
    P.myName = function (M) { return M.me ? M.me.name : P.ctx.user; };
})();
