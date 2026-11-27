/* Трекер: общий слой рабочих мест (данные, запись, модель, компоненты). Расчёты — в tracker-core.js. */
(function () {
    'use strict';
    var C = window.TrackerCore;
    var P = window.Trk = { core: C };
    var host = document.getElementById('trk-app');
    var ds = host ? host.dataset : {};
    P.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };
    P.TODAY = '2026-11-26'; /* дата демо */
    P.now = function () { var d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); };
    P.isBA = function () { return /Бизнес-администратор|^admin$/i.test(P.ctx.role) || P.ctx.user === P.ctx.db; };

    P.dec = function (s) { return typeof s === 'string' ? s.replace(/&comma;/g, ',') : s; };
    P.esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    P.url = function (p) { return '/' + P.ctx.db + '/' + p; };
    P.get = function (p) {
        return fetch(P.url(p), { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + p); return r.json(); });
    };
    P.post = function (p, fields) {
        var fd = new FormData();
        fd.append('_xsrf', P.ctx.xsrf);
        Object.keys(fields || {}).forEach(function (k) { var v = fields[k]; fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v); });
        return fetch(P.url(p), { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (j) { var e = Array.isArray(j) ? j[0] : j; if (e && e.error) throw new Error(e.error); return j; });
    };
    var metaP = null;
    P.meta = function () { return metaP || (metaP = P.get('metadata?JSON=1').then(function (m) { var by = {}; m.forEach(function (t) { by[t.val] = t; }); P.metaBy = by; return by; })); };
    P.tid = function (name) { return P.metaBy[name] && P.metaBy[name].id; };
    P.canWrite = function (name) { return !!(P.metaBy[name] && P.metaBy[name].granted === 'WRITE'); };
    function norm(o) {
        var r = { _id: String(o.id), _up: String(o.up) };
        Object.keys(o).forEach(function (k) {
            if (k === 'id' || k === 'up' || k === 'ord') return;
            var v = o[k];
            if (v && typeof v === 'object') { if (v.id !== undefined) r[k] = P.dec(v.val); return; }
            r[k] = v === null ? '' : P.dec(v);
        });
        return r;
    }
    P.rows = function (name, extra) {
        if (!P.metaBy[name]) return Promise.resolve([]);
        return P.get('object/' + P.tid(name) + '/?JSON_OBJ&NAMED&LIMIT=0,2000' + (extra || '')).then(function (j) { return Array.isArray(j) ? j.map(norm) : []; });
    };
    P.report = function (name) { return P.get('report/' + encodeURIComponent(name) + '?JSON_KV').then(function (j) { return Array.isArray(j) ? j : []; }).catch(function () { return []; }); };

    /* ---------- модель ---------- */
    var modelP = null;
    P.model = function () {
        if (modelP) return modelP;
        var names = ['Процесс', 'Подразделение', 'Сотрудник', 'Вид заявки', 'Шаг процесса', 'Пункт регламента', 'Заявка'];
        modelP = Promise.all(names.map(function (n) { return P.rows(n); }).concat([P.report('Журнал по заявкам'), P.report('Голоса сторон')])).then(function (r) {
            var M = { today: P.TODAY };
            M.process = (r[0][0] || {});
            M.depts = r[1].map(function (x) { return { name: x['Подразделение'], head: x['Руководитель подразделения'], login: x['Логин руководителя'] }; });
            M.emps = r[2].map(function (x) { return { name: x['Сотрудник'], dept: x['Подразделение'], pos: x['Должность'], login: x['Логин'] }; });
            M.empByLogin = {}; M.emps.forEach(function (e) { M.empByLogin[e.login] = e; });
            M.kinds = r[3].map(function (x) { return x['Вид заявки']; });
            M.steps = r[4].map(function (x) { return { id: x._id, name: x['Шаг процесса'], kind: x['Вид шага'], order: C.num(x['Порядок шага']), start: x['Стартовый шаг'] === '1' || x['Стартовый шаг'] === 'X', dept: x['Подразделение'], norm: C.num(x['Норматив, ч']), added: C.toIso(x['Шаг введён']), addedBy: x['Кто ввёл шаг'] }; });
            M.regs = r[5].map(function (x) { return { name: x['Пункт регламента'], step: x['Шаг процесса'], next: x['Рекомендуемый шаг'], text: x['Текст пункта'] }; });
            M.reqs = r[6].map(function (x) {
                var q = { id: x._id, code: x['Заявка'], title: x['Суть заявки'], kind: x['Вид заявки'], dept: x['Подразделение'], initiator: x['Инициатор'], sum: C.num(x['Сумма заявки']), step: x['Шаг процесса'], exec: x['Исполнитель'], login: x['Логин исполнителя'], received: C.toIso(x['Поступила']), due: C.toIso(x['Срок']), since: C.toIso(x['В шаге с']) };
                q.fields = { 'Сумма заявки': q.sum, 'Вид заявки': q.kind, 'Подразделение': q.dept };
                return q;
            });
            M.reqBy = {}; M.reqs.forEach(function (q) { M.reqBy[q.code] = q; });
            M.journal = r[7].map(function (x) { return { code: x['Событие'], req: x['Заявка'], step: x['Шаг'], kind: x['Вид'], date: C.toIso(x['Дата']), time: x['Время'], author: x['Автор'], why: x['Причина'], basis: x['Основание'], ver: x['Версия'], login: x['Логин автора'], reqSum: x['Сумма заявки'], reqKind: x['Вид заявки'] }; });
            M.votes = r[8].filter(function (x) { return x['Голос']; }).map(function (x) { return { proposal: x['Предложение'], code: x['Голос'], side: x['Сторона'], name: x['Голосующий'], login: x['Логин голосующего'], decision: x['Решение стороны'], version: C.num(x['Версия голоса']), counter: x['Контрпредложение'], date: C.toIso(x['Дата голоса']) }; });
            return Promise.all(M.steps.map(function (s) { return P.rows('Переход', '&F_U=' + s.id).then(function (t) { return t.map(function (x) { return { id: x._id, code: x['Переход'], from: s.name, fromId: s.id, to: x['Следующий шаг'], cond: x['Условие перехода'], status: x['Статус перехода'], since: C.toIso(x['Действует с']), req: x['Заявка'], version: C.num(x['Версия предложения']) || 1, by: x['Предложил'], why: x['Обоснование'] }; }); }); }))
                .then(function (tt) {
                    M.trans = [].concat.apply([], tt);
                    M.spec = C.buildSpec(M.steps, M.trans, M.votes, P.TODAY);
                    M.me = M.empByLogin[P.ctx.user] || { name: P.ctx.user, login: P.ctx.user };
                    M.ba = M.empByLogin[(M.emps.filter(function (e) { return /Бизнес-администратор/.test(e.pos); })[0] || {}).login] || { name: M.process['Владелец процесса'], login: '' };
                    P.cur = M; return M;
                });
        });
        return modelP;
    };
    P.reload = function () { modelP = null; return P.model(); };

    /* ---------- запись ---------- */
    P.create = function (table, fields, up) { return P.post('_m_new/' + P.tid(table) + '?JSON', { up: up || 1, fields: fields }); };
    P.update = function (id, fields) { return P.post('_m_set/' + id + '?JSON', { fields: fields }); };
    P.log = function (req, step, kind, why, basis) {
        var M = P.cur, code = C.nextCode(M.journal.map(function (e) { return e.code; }), 'Ж-', 4);
        return P.create('Событие журнала', { 'Событие журнала': code, 'Заявка': req.code, 'Шаг процесса': step, 'Вид записи': kind, 'Дата события': P.TODAY, 'Время события': P.now(),
            'Автор': M.me.name, 'Логин автора': P.ctx.user, 'Причина': why || '', 'Основание': basis || '', 'Версия правил': C.num(M.process['Версия спеки']) || 1 });
    };
    /* Передать заявку дальше: по правилу или исключением с причиной; заявка уходит в очередь следующего шага. */
    P.move = function (req, to, why) {
        var mk = C.moveKind(P.cur.spec, req, to);
        if (mk.kind === 'Исключение' && !String(why || '').trim()) return Promise.reject(new Error('Для исключения нужна причина'));
        return P.update(req.id, { 'Шаг процесса': to, 'В шаге с': P.TODAY, 'Логин исполнителя': '', 'Исполнитель': '' })
            .then(function () { return P.log(req, to, mk.kind, why || (mk.rule && mk.rule.why) || 'Сделано, передано дальше', mk.basis); });
    };
    P.take = function (req) {
        return P.update(req.id, { 'Логин исполнителя': P.ctx.user, 'Исполнитель': P.cur.empByLogin[P.ctx.user] ? P.cur.me.name : '' })
            .then(function () { return P.log(req, req.step, 'Назначение', 'Взял в работу', 'Очередь шага «' + req.step + '»'); });
    };
    P.bumpSpec = function (M) { return P.update(M.process._id, { 'Версия спеки': (C.num(M.process['Версия спеки']) || 1) + 1 }); };
    P.voteIds = function (tr) { return P.rows('Голос стороны', '&F_U=' + tr.id).then(function (v) { var m = {}; v.forEach(function (x) { m[x['Голос стороны']] = x._id; }); return m; }); };
})();
