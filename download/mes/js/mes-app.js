/* MES: общий слой рабочих мест (данные, запись, компоненты). Расчёты - в mes-core.js. */
(function () {
    'use strict';
    var C = window.MesCore;
    var P = window.Mes = { core: C };
    var host = document.getElementById('mes-app');
    var ds = host ? host.dataset : {};
    P.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };
    P.TODAY = '2026-11-26'; /* дата демо */
    P.MONTH_FROM = '2026-11-01';

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
    P.canRead = function (name) { return !!(P.metaBy[name] && P.metaBy[name].granted); };
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
        if (!P.canRead(name)) return Promise.resolve(null);
        var id = P.tid(name), out = [], PAGE = 500;
        function page(off) {
            return P.get('object/' + id + '/?JSON_OBJ&NAMED&LIMIT=' + off + ',' + PAGE).then(function (j) {
                if (!Array.isArray(j)) throw new Error('Нет доступа к таблице «' + name + '»');
                j.forEach(function (o) { out.push(norm(o)); });
                return j.length < PAGE ? out : page(off + PAGE);
            });
        }
        return page(0);
    };
    P.map = function (rows, key) { var m = {}; (rows || []).forEach(function (r) { m[r[key]] = r; }); return m; };
    P.fmt = function (x, d) { return C.num(x).toFixed(d || 0).replace('.', ','); };
    P.money = function (x) { var n = Math.round(C.num(x)); return (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; };
    P.hours = function (min) { return P.fmt(C.num(min) / 60, 1) + ' ч'; };

    var TABLES = ['Участок', 'Операция', 'Изделие', 'Шаг маршрута', 'Расценка', 'Рабочий', 'Причина простоя', 'Правило цеха', 'Заказ на производство', 'Сменное задание', 'Отметка выработки', 'Простой', 'Выгрузка в 1С'];
    var modelP = null;
    P.model = function () {
        if (modelP) return modelP;
        modelP = Promise.all(TABLES.map(function (n) { return P.rows(n); })).then(function (r) {
            var M = { today: P.TODAY };
            M.sections = (r[0] || []).map(function (x) { return { id: x._id, name: x['Участок'], master: x['Мастер участка'], login: x['Логин мастера'], order: C.num(x['Порядок участка']) }; }).sort(function (a, b) { return a.order - b.order; });
            M.ops = (r[1] || []).map(function (x) { return { id: x._id, name: x['Операция'], section: x['Участок'], code: x['Код операции'], order: C.num(x['Порядок операции']) }; }).sort(function (a, b) { return a.order - b.order; });
            M.opSection = {}; M.ops.forEach(function (o) { M.opSection[o.name] = o.section; });
            M.products = (r[2] || []).map(function (x) { return { id: x._id, name: x['Изделие'], art: x['Артикул'], code1c: x['Код 1С изделия'], group: x['Группа изделий'] }; });
            M.steps = (r[3] || []).map(function (x) { return { id: x._id, name: x['Шаг маршрута'], product: x['Изделие'], op: x['Операция'], step: C.num(x['Номер шага']), norm: C.num(x['Норма, мин/шт']) }; });
            M.rates = (r[4] || []).map(function (x) { return { id: x._id, name: x['Расценка'], op: x['Операция'], product: x['Изделие'], price: C.num(x['Цена за штуку']), from: C.toIso(x['Действует с']) }; });
            M.workers = (r[5] || []).map(function (x) { return { id: x._id, name: x['Рабочий'], num: x['Табельный номер'], section: x['Участок'], grade: C.num(x['Разряд']), tariff: C.num(x['Тарифная ставка, ч']), login: x['Логин рабочего'] }; });
            M.reasons = (r[6] || []).map(function (x) { return { id: x._id, name: x['Причина простоя'], kind: x['Вид причины'], code: x['Код причины'] }; });
            M.reasonKind = {}; M.reasons.forEach(function (x) { M.reasonKind[x.name] = x.kind; });
            M.ruleRows = (r[7] || []).map(function (x) { return { id: x._id, name: x['Правило цеха'], value: x['Значение правила'], note: x['Пояснение правила'] }; });
            M.rules = C.parseRules(M.ruleRows);
            M.orders = (r[8] || []).map(function (x) { return { id: x._id, no: x['Заказ на производство'], product: x['Изделие'], cust: x['Покупатель'], qty: C.num(x['Количество']), due: C.toIso(x['Срок готовности']), from: C.toIso(x['Дата из 1С']), so: x['Заказ покупателя 1С'], state: x['Состояние заказа'], routed: C.toIso(x['Маршрут создан']) }; });
            M.orderBy = P.map(M.orders, 'no');
            var stepNorm = {}; M.steps.forEach(function (s) { stepNorm[s.product + '|' + s.op] = s.norm; });
            M.tasks = (r[9] || []).map(function (x) {
                var o = M.orderBy[x['Заказ на производство']] || {};
                return { id: x._id, no: x['Сменное задание'], order: x['Заказ на производство'], product: o.product || '', due: o.due || '', op: x['Операция'], section: x['Участок'], step: C.num(x['Номер шага']), plan: C.num(x['План, шт']), queue: C.num(x['Очередь']), state: x['Состояние задания'] || C.STATE.wait, worker: x['Рабочий'], started: x['Начато в'], good: C.num(x['Сделано годных']), bad: C.num(x['Сделано брака']), norm: stepNorm[(o.product || '') + '|' + x['Операция']] || 0 };
            });
            M.taskBy = P.map(M.tasks, 'no');
            M.marks = (r[10] || []).map(function (x) { return { id: x._id, no: x['Отметка выработки'], task: x['Сменное задание'], worker: x['Рабочий'], section: x['Участок'], date: C.toIso(x['Дата смены']), at: x['Время отметки'], good: C.num(x['Годных, шт']), bad: C.num(x['Брак, шт']), culprit: x['Виновник брака'], accept: x['Приёмка мастером'] }; });
            M.downs = (r[11] || []).map(function (x) { return { id: x._id, no: x['Простой'], worker: x['Рабочий'], section: x['Участок'], reason: x['Причина простоя'], date: C.toIso(x['Дата смены']), at: x['Время отметки'], mins: C.num(x['Минут простоя']) }; });
            M.exports = r[12] ? r[12].map(function (x) { return { id: x._id, no: x['Выгрузка в 1С'], order: x['Заказ на производство'], doc: x['Документ 1С'], date: C.toIso(x['Дата смены']), res: x['Результат обмена'], who: x['Кто выгрузил'] }; }) : null;
            /* факт по заданию — счётчики самого задания: рабочий видит только свои отметки, а доступность операции считается по всем */
            M.prog = {}; M.tasks.forEach(function (t) { M.prog[t.no] = { good: t.good, bad: t.bad }; });
            M.rem = C.remainMinutes(M.tasks, M.prog);
            M.cap = {}; M.sections.forEach(function (s) { M.cap[s.name] = C.capacity(M.workers.filter(function (w) { return w.section === s.name; }).length, M.rules); });
            M.me = M.workers.filter(function (w) { return w.login && w.login === P.ctx.user; })[0] || null;
            M.mySection = M.me ? M.me.section : ((M.sections.filter(function (s) { return s.login === P.ctx.user; })[0] || {}).name || '');
            P.cur = M;
            return M;
        });
        return modelP;
    };
    P.reload = function () { modelP = null; return P.model(); };
    /* Задания заказа по шагам и предыдущее задание. */
    P.orderTasks = function (M, no) { return M.tasks.filter(function (t) { return t.order === no; }).sort(function (a, b) { return a.step - b.step; }); };
    P.prevTask = function (M, t) { return M.tasks.filter(function (x) { return x.order === t.order && x.step === t.step - 1; })[0] || null; };
    P.avail = function (M, t) { return C.available(t, P.prevTask(M, t), M.prog); };
    /* Прогноз заказа по видимым заданиям: шаги начиная с первого незакрытого видимого. */
    P.forecast = function (M, no) {
        var o = M.orderBy[no]; if (!o) return null;
        var ts = P.orderTasks(M, no), byStep = {}; ts.forEach(function (t) { byStep[t.step] = t; });
        var open = ts.filter(function (t) { return t.state !== C.STATE.done; }); if (!open.length) return null;
        var from = open[0].step;
        var steps = C.routeOf(M.steps, o.product).filter(function (s) { return s.step >= from; }).map(function (s) {
            var t = byStep[s.step];
            return t ? { section: t.section, no: t.no, queue: t.queue, step: s.step, qty: t.plan, norm: t.norm, done: t.state === C.STATE.done } : { section: M.opSection[s.op], step: s.step, qty: o.qty, norm: s.norm, done: false };
        });
        return C.forecast({ order: no, today: M.today, due: o.due, steps: steps, tasks: M.tasks.filter(function (x) { return x.state !== C.STATE.done; }), rem: M.rem, cap: M.cap });
    };
    P.isHot = function (M, o) { var done = o.state === 'Выпущен' || o.state === 'Передан в 1С'; return C.isHot(o.due, M.today, M.rules, done); };
    P.nowHHMM = function () { var d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    P.nextNo = function (list, prefix, width) { var max = 0; list.forEach(function (x) { var n = parseInt(String(x.no).replace(/\D/g, ''), 10); if (n > max) max = n; }); return prefix + String(max + 1).padStart(width, '0'); };
    P.create = function (table, fields) { return P.post('_m_new/' + P.tid(table) + '?JSON', { up: 1, fields: fields }); };
    P.update = function (id, fields) { return P.post('_m_set/' + id + '?JSON', { fields: fields }); };
    P.batch = function (ops) { return P.post('_m_batch?JSON', { ops: ops }).then(function (r) { var bad = (r.results || []).filter(function (x) { return x.ok === false; }); if (bad.length) throw new Error(bad[0].error || 'Ошибка записи'); return r; }); };
})();
