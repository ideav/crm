/* SRM: слой данных рабочих мест (чтение, запись, модель). Расчёты - в srm-core.js, компоненты - в srm-ui.js. */
(function () {
    'use strict';
    var C = window.SrmCore;
    var P = window.Srm = { core: C };
    var host = document.getElementById('srm-app');
    var ds = host ? host.dataset : {};
    P.host = host;
    P.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };
    P.TODAY = '2026-11-26'; /* дата демо */
    P.rules = C.DEFAULT_RULES;

    P.dec = function (s) { return typeof s === 'string' ? s.replace(/&comma;/g, ',') : s; };
    P.esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    P.url = function (p) { return '/' + P.ctx.db + '/' + p; };
    P.get = function (p) {
        return fetch(P.url(p), { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
            if (r.status === 403) return null;
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + p);
            return r.json();
        });
    };
    /* POST с XSRF; вложенные объекты уходят JSON-строкой. */
    P.post = function (p, fields) {
        var fd = new FormData();
        fd.append('_xsrf', P.ctx.xsrf);
        Object.keys(fields || {}).forEach(function (k) { var v = fields[k]; fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v); });
        return fetch(P.url(p), { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (j) { var e = Array.isArray(j) ? j[0] : j; if (e && e.error) throw new Error(e.error); return j; });
    };
    var metaP = null;
    P.meta = function () { return metaP || (metaP = P.get('metadata?JSON=1').then(function (m) { var by = {}; (m || []).forEach(function (t) { by[t.val] = t; }); P.metaBy = by; return by; })); };
    P.tid = function (name) { return P.metaBy[name] && P.metaBy[name].id; };
    P.canWrite = function (name) { return !!(P.metaBy[name] && P.metaBy[name].granted === 'WRITE') || C.roleKey(P.ctx.role) === 'admin'; };
    P.isRole = function (re) { return re.test(C.roleKey(P.ctx.role)) || C.roleKey(P.ctx.role) === 'admin'; };

    function norm(o) {
        var r = { _id: String(o.id), _up: String(o.up), _ref: {} };
        Object.keys(o).forEach(function (k) {
            if (k === 'id' || k === 'up' || k === 'ord') return;
            var v = o[k];
            if (Array.isArray(v)) { r[k] = v.map(function (x) { return P.dec(x.val); }); return; }
            if (v && typeof v === 'object') { if (v.id !== undefined) { r[k] = P.dec(v.val); r._ref[k] = String(v.id); } else if (v.count !== undefined) r[k] = v.count; return; }
            r[k] = v === null ? '' : P.dec(v);
        });
        return r;
    }
    /* Записи таблицы по именам; нет доступа - null (экран показывает то, что роли разрешено). */
    P.rows = function (name, extra) {
        var id = P.tid(name); if (!id) return Promise.resolve(null);
        return P.get('object/' + id + '/?JSON_OBJ&NAMED&LIMIT=0,2000' + (extra || '')).then(function (j) { return Array.isArray(j) ? j.map(norm) : null; });
    };
    P.report = function (name) { return P.get('report/' + encodeURIComponent(name) + '?JSON_KV&LIMIT=0,5000').then(function (j) { return Array.isArray(j) && (!j.length || j[0].ids === undefined) ? j : null; }); };
    P.num = C.num;
    P.money = function (x) { var n = Math.round(C.num(x)); return (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; };
    P.mln = function (x) { return (C.num(x) / 1e6).toFixed(2).replace('.', ',') + ' млн ₽'; };
    P.fmt = function (x, d) { var s = C.num(x).toFixed(d || 0).split('.'); return s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (s[1] ? ',' + s[1] : ''); };
    P.pct = function (x) { return x === null || x === undefined ? '-' : (x > 0 ? '+' : '') + String(C.round2(x)).replace('.', ',') + '%'; };
    P.d = function (s) { return C.toDmy(s); };

    /* ---------- модель ---------- */
    var modelP = null;
    P.model = function () {
        if (modelP) return modelP;
        var names = ['Завод', 'Категория закупок', 'Номенклатура', 'Уровень допуска', 'Поставщик', 'Порог согласования', 'Стадия заявки', 'Заявка на закупку', 'Приглашение', 'Предложение', 'Договор'];
        var reps = ['srm_stages', 'srm_docs', 'srm_decisions'];
        var portal = P.ctx.screen === 'portal';
        modelP = Promise.all(names.map(function (n) { return portal && !/Приглашение|Предложение/.test(n) ? Promise.resolve(null) : P.rows(n); }).concat(reps.map(function (n) { return portal ? Promise.resolve(null) : P.report(n).catch(function () { return null; }); }))).then(function (r) {
            var M = { today: P.TODAY, rules: P.rules };
            M.plants = (r[0] || []).map(function (x) { return x['Завод']; });
            M.cats = (r[1] || []).map(function (x) { return { name: x['Категория закупок'], manager: x['Категорийный менеджер'], login: x['Логин менеджера'] }; });
            M.noms = {}; (r[2] || []).forEach(function (x) { M.noms[x['Номенклатура']] = { name: x['Номенклатура'], cat: x['Категория закупок'], unit: x['Ед. изм.'] }; });
            M.levels = {}; (r[3] || []).forEach(function (x) { M.levels[x['Уровень допуска']] = { name: x['Уровень допуска'], color: x['Цвет допуска'], order: C.num(x['Порядок допуска']), id: x._id }; });
            M.sups = (r[4] || []).map(function (x) {
                var lv = M.levels[x['Уровень допуска']] || {};
                return { id: x._id, name: x['Поставщик'], inn: x['ИНН'], city: x['Город поставщика'], cats: x['Категория закупок'] || [], level: x['Уровень допуска'], color: lv.color || 'amber', until: C.toIso(x['Допуск до']), reason: x['Причина ограничения'], email: x['Почта поставщика'], contact: x['Контактное лицо'] };
            });
            M.supBy = {}; M.sups.forEach(function (s) { M.supBy[s.name] = s; });
            M.thresholds = (r[5] || []).map(function (x) { return { id: x._id, name: x['Порог согласования'], from: C.num(x['Сумма от']), to: x['Сумма до'] === '' ? '' : C.num(x['Сумма до']), steps: x['Шаги маршрута'] }; }).sort(function (a, b) { return a.from - b.from; });
            M.stages = (r[6] || []).sort(function (a, b) { return C.num(a['Порядок стадии']) - C.num(b['Порядок стадии']); }).map(function (x) { return x['Стадия заявки']; });
            M.reqs = (r[7] || []).map(function (x) {
                return { id: x._id, num: x['Заявка на закупку'], plant: x['Завод'], nom: x['Номенклатура'], cat: x['Категория закупок'], qty: C.num(x['Количество']), budget: C.num(x['Бюджет заявки']), date: C.toIso(x['Дата заявки']), need: C.toIso(x['Нужно к дате']), initiator: x['Инициатор'], stage: x['Стадия заявки'], method: x['Способ закупки'], signed: x['Подписи согласования'] || '', why: x['Обоснование заявки'], events: x['Событие процедуры'] || 0 };
            }).sort(function (a, b) { return a.num < b.num ? 1 : -1; });
            M.reqBy = {}; M.reqById = {}; M.reqs.forEach(function (q) { M.reqBy[q.num] = q; M.reqById[q.id] = q; });
            M.invs = (r[8] || []).map(function (x) { return { id: x._id, code: x['Приглашение'], req: x['Заявка на закупку'], reqId: x._ref['Заявка на закупку'], sup: x['Поставщик'], supId: x._ref['Поставщик'], lot: x['Лот'], sent: C.toIso(x['Отправлено']), due: C.toIso(x['Ответить до']) }; });
            M.invById = {}; M.invs.forEach(function (i) { M.invById[i.id] = i; });
            M.offers = (r[9] || []).map(function (x) {
                var inv = M.invById[x._ref['Приглашение']] || {};
                return { id: x._id, num: x['Предложение'], invId: x._ref['Приглашение'], req: inv.req, sup: inv.sup, price: C.num(x['Цена за ед.']), vatIncluded: C.bool(x['Цена включает НДС']), vatRate: x['Ставка НДС'] === '' ? '' : C.num(x['Ставка НДС']), delivery: C.num(x['Доставка']), deferral: C.num(x['Отсрочка, дней']), prepay: C.num(x['Предоплата, %']), lead: C.num(x['Срок поставки, дней']), valid: C.toIso(x['КП действует до']), date: C.toIso(x['Дата КП']), channel: x['Канал КП'], comment: x['Комментарий поставщика'], chosen: C.bool(x['Выбрано']) };
            });
            M.contracts = (r[10] || []).map(function (x) {
                var q = M.reqBy[x['Заявка на закупку']] || {};
                return { id: x._id, num: x['Договор'], req: x['Заявка на закупку'], sup: x['Поставщик'], sum: C.num(x['Сумма договора']), unitPrice: C.num(x['Цена за ед. договора']), date: C.toIso(x['Дата договора']), state: x['Состояние договора'], nom: q.nom, plant: q.plant, qty: q.qty, budget: q.budget, cat: q.cat, reqDate: q.date, supplier: x['Поставщик'] };
            });
            M.stagesList = (r[11] || []).map(function (x) { return { contract: x['Договор'], sup: x['Поставщик'], name: x['Этап'], plan: C.toIso(x['План']), fact: C.toIso(x['Факт']), qty: C.num(x['Кол']), accepted: C.num(x['Принято']) }; });
            M.docs = {}; (r[12] || []).forEach(function (x) { (M.docs[x['Поставщик']] = M.docs[x['Поставщик']] || []).push({ name: x['Документ'], until: C.toIso(x['До']), checked: C.bool(x['Проверен']) }); });
            M.decisions = {}; (r[13] || []).forEach(function (x) { (M.decisions[x['Поставщик']] = M.decisions[x['Поставщик']] || []).push({ name: x['Решение'], date: C.toIso(x['Дата']), who: x['Кто'], level: x['Уровень'], why: x['Обоснование'] }); });
            M.hasDocs = !!r[12];
            P.cur = M;
            return M;
        });
        return modelP;
    };
    P.resetModel = function () { modelP = null; };
    P.reload = function () { P.resetModel(); P.mount(P._render); };
    /* Создание и изменение записей (поля - по именам). */
    P.create = function (table, fields, up) { return P.post('_m_new/' + P.tid(table) + '?JSON', { up: up || 1, fields: fields }); };
    P.update = function (id, fields) { return P.post('_m_set/' + id + '?JSON', { fields: fields }); };
    P.batch = function (ops) {
        return P.post('_m_batch?JSON', { ops: ops }).then(function (j) { var bad = (j.results || []).filter(function (x) { return !x.ok; }); if (bad.length) throw new Error(bad[0].error || 'ошибка записи'); return j; });
    };
    P.event = function (req, text, kind) { return P.create('Событие процедуры', { 'Событие процедуры': text, 'Дата события': P.TODAY, 'Автор события': P.ctx.user, 'Вид события': kind || 'Действие' }, req.id).catch(function () { return null; }); };
    P.eventsOf = function (req) { return P.rows('Событие процедуры', '&F_U=' + req.id).then(function (r) { return (r || []).map(function (x) { return { text: x['Событие процедуры'], date: C.toIso(x['Дата события']), who: x['Автор события'], kind: x['Вид события'] }; }); }); };
})();
