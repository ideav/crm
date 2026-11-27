/* Консолидация: общий слой рабочих мест (данные, запись, модель группы). Расчёты и контроли - в consol-core.js. */
(function () {
    'use strict';
    var C = window.ConsolCore;
    var P = window.Consol = { core: C };
    var host = document.getElementById('consol-app');
    var ds = host ? host.dataset : {};
    P.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };
    /* «Сегодня» демо: данные собраны на 26.11.2026; просрочка сдачи считается от этой даты. */
    P.TODAY = '2026-11-26';

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
        return P.get('object/' + P.tid(name) + '/?JSON_OBJ&NAMED&LIMIT=0,5000').then(function (j) { if (!Array.isArray(j)) return []; return j.map(norm); }).catch(function () { return []; });
    };
    P.report = function (name) { return P.get('report/' + encodeURIComponent(name) + '?JSON_KV').then(function (j) { return Array.isArray(j) && !(j[0] && j[0].error) ? j : []; }).catch(function () { return []; }); };
    /* Дата-время платформы (unix-время или «ДД.ММ.ГГГГ ЧЧ:ММ:СС») -> «ДД.ММ.ГГГГ ЧЧ:ММ» по Москве. */
    P.dt = function (v) {
        if (!v) return '';
        if (/^\d{9,}$/.test(String(v))) { var d = new Date(+v * 1000 + 3 * 3600000), s = d.toISOString(); return s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) + ' ' + s.slice(11, 16); }
        return String(v).slice(0, 16);
    };
    P.d = function (v) { var i = C.isoDate(v); return i ? i.slice(8, 10) + '.' + i.slice(5, 7) + '.' + i.slice(0, 4) : ''; };
    P.nowStr = function () { var s = new Date(Date.now() + 3 * 3600000).toISOString(); return s.slice(0, 10) + ' ' + s.slice(11, 16); };
    P.fmt = C.fmt;
    P.mapBy = function (rows, key) { var m = {}; (rows || []).forEach(function (r) { m[r[key]] = r; }); return m; };

    /* ---------- модель группы ---------- */
    var modelP = null;
    var NAMES = ['Пользователь', 'Компания', 'Период', 'Статья группы', 'Вид корректировки', 'Контроль', 'Параметр', 'Счёт общества', 'Пакет', 'Строка пакета', 'Замечание', 'Корректировка', 'Проводка', 'Версия отчётности'];
    P.model = function () {
        if (modelP) return modelP;
        modelP = Promise.all(NAMES.map(function (n) { return P.rows(n); }).concat([P.report('Встречные ВГО')])).then(function (r) {
            var M = {}, u = r.shift().filter(function (x) { return x['Пользователь'] === P.ctx.user; })[0];
            M.userName = u && u['Имя'] ? u['Имя'] : P.ctx.user;
            M.cos = r[0].map(function (x) { return { id: x._id, name: x['Компания'], code: x['Код общества'], inn: x['ИНН'], city: x['Город'], share: C.num(x['Доля владения, %']), method: x['Метод консолидации'], role: x['Роль в группе'], acc: x['Бухгалтер общества'], login: x['Логин бухгалтера'], ord: C.num(x['Порядок общества']) }; })
                .sort(function (a, b) { return a.ord - b.ord; });
            M.coBy = P.mapBy(M.cos, 'code'); M.coByName = P.mapBy(M.cos, 'name');
            M.innTo = {}; M.cos.forEach(function (c) { M.innTo[c.inn] = c.code; });
            M.periods = r[1].map(function (x) { return { id: x._id, name: x['Период'], code: x['Код периода'], start: C.isoDate(x['Начало периода']), end: C.isoDate(x['Конец периода']), due: C.isoDate(x['Срок сдачи пакетов']), rep: C.isoDate(x['Срок отчётности']), status: x['Статус периода'], prev: x['Предыдущий период'] }; })
                .sort(function (a, b) { return a.start < b.start ? -1 : 1; });
            M.periodBy = P.mapBy(M.periods, 'name');
            M.periods.forEach(function (p) { p.short = p.code.slice(-1) + 'к' + p.code.slice(2, 4); });
            M.arts = r[2].map(function (x) { return { id: x._id, name: x['Статья группы'], code: x['Код статьи'], section: x['Раздел'], group: x['Строка отчёта'], ord: C.num(x['Порядок статьи']), other: x['Прочая статья'] === '1', ic: x['Статья ВГО'] === '1', counter: x['Встречная статья'], icTwin: x['Статья при ВГО'] }; })
                .sort(function (a, b) { return a.ord - b.ord; });
            M.artBy = P.mapBy(M.arts, 'code'); M.artByName = P.mapBy(M.arts, 'name');
            M.kinds = r[3].map(function (x) { return { id: x._id, name: x['Вид корректировки'], profit: x['Влияет на прибыль'] === '1', prefix: x['Префикс номера'], descr: x['Описание вида'] }; });
            M.kindBy = P.mapBy(M.kinds, 'name');
            M.rules = {}; M.controls = r[4].map(function (x) { var c = { id: x._id, name: x['Контроль'], code: x['Код контроля'], descr: x['Описание контроля'], threshold: C.num(x['Порог']), blocking: x['Блокирует отправку'] === '1', on: x['Включён'] === '1' }; M.rules[c.code] = c; return c; });
            M.params = {}; r[5].forEach(function (x) { M.params[x['Параметр']] = C.num(x['Значение параметра']); });
            M.icTol = Math.max(0.5, M.params['Допуск сверки ВГО, тыс. руб.'] || 0);
            M.mapping = {}; M.accRows = r[6].map(function (x) {
                var co = M.coByName[x['Компания']], a = M.artByName[x['Статья группы']], o = { id: x._id, acc: x['Счёт общества'], company: co ? co.code : '', name: x['Наименование счёта'], article: a ? a.code : '', by: x['Подтвердил'] };
                if (o.company) { (M.mapping[o.company] = M.mapping[o.company] || {})[o.acc] = o.article; }
                return o;
            });
            M.pkgs = r[7].map(function (x) { var co = M.coByName[x['Компания']]; return { id: x._id, name: x['Пакет'], company: co ? co.code : '', period: x['Период'], status: x['Статус пакета'] || 'Не начат', method: x['Способ ввода'], sent: P.dt(x['Отправлен']), accepted: P.dt(x['Принят']), by: x['Принял'], ver: C.num(x['Версия пакета']), login: x['Логин бухгалтера'] }; });
            M.pkgById = P.mapBy(M.pkgs, 'id');
            M.pkgOf = function (co, per) { return M.pkgs.filter(function (p) { return p.company === co && p.period === per; })[0] || null; };
            M.lines = r[8].map(function (x) {
                var pk = M.pkgById[x._ref['Пакет']], a = M.artByName[x['Статья группы']], cp = M.coByName[x['Контрагент группы']];
                return { id: x._id, pkg: pk ? pk.id : '', company: pk ? pk.company : x['Код общества'], period: pk ? pk.period : '', acc: x['Строка пакета'], name: x['Наименование счёта'], article: a ? a.code : '', cp: cp ? cp.code : '', open: C.num(x['Сальдо на начало']), amount: C.num(x['Сумма']), login: x['Логин бухгалтера'] };
            });
            M.remarks = r[9].map(function (x) { return { id: x._id, title: x['Замечание'], pkg: x._ref['Пакет'], text: x['Текст замечания'], author: x['Автор замечания'], when: P.dt(x['Когда']), status: x['Статус замечания'] }; });
            var ent = {};
            r[11].forEach(function (x) { var k = x._ref['Корректировка'], a = M.artByName[x['Статья группы']], co = M.coByName[x['Компания']]; (ent[k] = ent[k] || []).push({ id: x._id, article: a ? a.code : '', company: co ? co.code : '', amount: C.num(x['Сумма']) }); });
            M.adjs = r[10].map(function (x) {
                var k = M.kindBy[x['Вид корректировки']] || {};
                return { id: x._id, num: x['Корректировка'], period: x['Период'], kind: x['Вид корректировки'], profitKind: !!k.profit, title: x['Суть корректировки'], basis: x['Основание'], author: x['Автор корректировки'], created: P.dt(x['Создана']), status: x['Статус корректировки'] || 'Черновик',
                    approver: x['Утвердил'], approved: P.dt(x['Дата утверждения']), auto: x['Сформирована автоматически'] === '1', entries: ent[x._id] || [] };
            }).sort(function (a, b) { return a.num < b.num ? -1 : 1; });
            M.versions = r[12].map(function (x) { var s = {}; try { s = JSON.parse(x['Снимок'] || '{}'); } catch (e) { s = {}; }
                return { id: x._id, name: x['Версия отчётности'], period: x['Период'], n: C.num(x['Номер версии']), at: P.dt(x['Зафиксирована']), by: x['Зафиксировал'], reason: x['Причина версии'], to: x['Кому отправлена'], adjs: String(x['Корректировки в версии'] || '').split(/,\s*/).filter(Boolean), snap: s }; })
                .sort(function (a, b) { return a.period === b.period ? a.n - b.n : (M.periodBy[a.period] && M.periodBy[b.period] && M.periodBy[a.period].start < M.periodBy[b.period].start ? -1 : 1); });
            M.me = M.cos.filter(function (c) { return c.login === P.ctx.user; })[0] || null;
            /* встречные строки ВГО для бухгалтера общества (сам он видит только свои строки) */
            M.counterRep = r[13].map(function (x) { var a = M.artByName[x['Статья']], per = M.periods.filter(function (p) { return p.code === x['Период']; })[0]; return { company: x['Общество'], cp: M.me ? M.me.code : '', article: a ? a.code : '', amount: C.num(x['Сумма']), period: per ? per.name : '', acc: x['Счёт'] }; });
            var open = M.periods.filter(function (p) { return p.status !== 'Закрыт'; });
            M.cur = (open[open.length - 1] || M.periods[M.periods.length - 1] || {}).name;
            P.cur = M;
            return M;
        });
        return modelP;
    };
    P.myName = function (M) { return M.userName || P.ctx.user; };
    /* Базовая статья для статьи ВГО (обратная пара «Статья при ВГО»). */
    P.baseOf = function (M, code) { var a = M.artBy[code]; if (!a || !a.ic) return code; var b = M.arts.filter(function (x) { return x.icTwin === code; })[0]; return b ? b.code : code; };
    P.resetModel = function () { modelP = null; };
    P.reload = function (fn) { P.resetModel(); return P.model().then(fn); };
    P.create = function (table, fields) { return P.post('_m_new/' + P.tid(table) + '?JSON', { up: 1, fields: fields }); };
    P.update = function (id, fields) { return P.post('_m_set/' + id + '?JSON', { fields: fields }); };
    P.batch = function (ops) { return P.post('_m_batch?JSON', { ops: ops }); };

    /* ---------- производные ---------- */
    P.prevPeriod = function (M, per) { var p = M.periodBy[per]; return p ? M.periodBy[p.prev] || null : null; };
    /* Строки пакета со статусом сопоставления: без статьи - не сопоставлен; счёт не подтверждён в «Счёт общества» - подсказка. */
    P.pkgLines = function (M, pkg) {
        var map = M.mapping[pkg.company] || {};
        return M.lines.filter(function (l) { return l.pkg === pkg.id; }).map(function (l) { return Object.assign({}, l, { base: l.article ? (map[l.acc] || P.baseOf(M, l.article)) : '', status: !l.article ? 'unmapped' : map[l.acc] ? 'mapped' : 'suggested' }); });
    };
    P.periodLines = function (M, per) { return M.lines.filter(function (l) { return l.period === per && l.article; }); };
    /* Контроли пакета. lines - строки (сохранённые или только что загруженные). */
    P.controlsFor = function (M, pkg, lines) {
        var prevP = P.prevPeriod(M, pkg.period), prevPkg = prevP ? M.pkgOf(pkg.company, prevP.name) : null;
        var prev = prevPkg && prevPkg.status === 'Принят' ? M.lines.filter(function (l) { return l.pkg === prevPkg.id; }) : null;
        var counter = M.lines.filter(function (l) { return l.period === pkg.period && l.cp === pkg.company && l.company !== pkg.company; });
        if (!counter.length && M.counterRep.length) counter = M.counterRep.filter(function (l) { return l.period === pkg.period; });
        var cpPkg = {}; M.pkgs.filter(function (p) { return p.period === pkg.period; }).forEach(function (p) { cpPkg[p.company] = p.status; });
        var rules = {}; Object.keys(M.rules).forEach(function (k) { rules[k] = M.rules[k]; });
        return C.controls(lines || P.pkgLines(M, pkg), { byCode: M.artBy, self: pkg.company, prev: prev, counter: counter, cpPkg: cpPkg, rules: rules, icTol: M.icTol });
    };
    P.late = function (M, pkg) { var p = M.periodBy[pkg.period]; if (!p || ['Отправлен', 'Принят'].indexOf(pkg.status) >= 0) return 0; return C.workdaysLate(p.due, P.TODAY); };
    P.consFor = function (M, per, drafts) {
        return C.consolidate(P.periodLines(M, per), M.adjs.filter(function (a) { return a.period === per; }), M.arts, M.cos.map(function (c) { return c.code; }), { drafts: drafts });
    };
    P.pairsFor = function (M, per) { return C.icPairs(P.periodLines(M, per), M.artBy, M.icTol); };
    P.locked = function (M, per) { return C.periodLocked(M.periodBy[per]); };
    P.coName = function (M, code) { return M.coBy[code] ? M.coBy[code].name : code; };
})();
