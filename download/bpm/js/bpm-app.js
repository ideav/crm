/* BPM: общий слой рабочих мест (данные, запись, окна, модель, исполнение шага). Расчёты - в bpm-core.js. */
(function () {
    'use strict';
    var C = window.BpmCore;
    var P = window.Bpm = { core: C };
    var host = document.getElementById('bpm-app');
    var ds = host ? host.dataset : {};
    P.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };
    P.TODAY = '2026-11-26'; /* дата демо */

    P.dec = function (s) { return typeof s === 'string' ? s.replace(/&comma;/g, ',') : s; };
    P.esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    P.url = function (p) { return '/' + P.ctx.db + '/' + p; };
    P.get = function (p, init) {
        return fetch(P.url(p), Object.assign({ credentials: 'same-origin', cache: 'no-store' }, init || {})).then(function (r) {
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
    P.meta = function () { return metaP || (metaP = P.get('metadata?JSON=1').then(function (m) { var by = {}; m.forEach(function (t) { by[t.val] = t; }); P.metaBy = by; return by; })); };
    P.tid = function (name) { return P.metaBy[name] && P.metaBy[name].id; };
    P.canWrite = function (name) { return !!(P.metaBy[name] && P.metaBy[name].granted === 'WRITE'); };
    P.canRead = function (name) { return !!(P.metaBy[name] && P.metaBy[name].granted); };

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
    /* Таблица целиком (страницы по 1000); нет права - null. */
    P.rows = function (name) {
        if (!P.canRead(name)) return Promise.resolve(null);
        var id = P.tid(name), out = [], PAGE = 1000;
        function page(off) {
            return P.get('object/' + id + '/?JSON_OBJ&NAMED&LIMIT=' + off + ',' + PAGE).then(function (j) {
                if (!Array.isArray(j)) return out;
                j.forEach(function (o) { if (o && o.id) out.push(norm(o)); });
                return j.length < PAGE ? out : page(off + PAGE);
            }).catch(function () { return out.length ? out : null; });
        }
        return page(0);
    };
    P.map = function (rows, key) { var m = {}; (rows || []).forEach(function (r) { m[r[key]] = r; }); return m; };
    P.num = C.num;
    P.fmt = function (x, d) { return C.num(x).toFixed(d || 0).replace('.', ','); };
    P.money = function (x, cur) { var n = Math.round(C.num(x)); return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ' + ({ RUB: '₽', CNY: '¥', USD: '$', EUR: '€' }[cur || 'RUB'] || cur); };
    P.d = C.ruDate;
    var B = function (v) { return v === '1' || v === 1 || v === true; };

    /* ---------- модель: все таблицы одним слоем ---------- */
    var NAMES = ['Сотрудник', 'Процесс', 'Шаг процесса', 'Переход', 'Заявка', 'Задача заявки', 'Событие журнала', 'Неопределённость', 'Предложение правки', 'Одобрение правки', 'Интеграция', 'Вызов интеграции', 'Замещение'];
    var modelP = null;
    P.model = function () {
        if (modelP) return modelP;
        modelP = Promise.all(NAMES.map(function (n) { return P.rows(n); })).then(function (r) {
            var M = { today: P.TODAY, hol: { '2026-11-04': 1 } };
            M.emps = (r[0] || []).map(function (x) { return { id: x._id, name: x['Сотрудник'], login: x['Логин сотрудника'], pos: x['Должность'], dept: x['Подразделение'], absFrom: C.toIso(x['Отсутствует с']), absTo: C.toIso(x['Отсутствует по']) }; });
            M.empByLogin = P.map(M.emps, 'login');
            M.procs = (r[1] || []).map(function (x) { return { id: x._id, name: x['Процесс'], code: x['Код процесса'], owner: x['Владелец процесса'], version: C.num(x['Версия спецификации']), days: C.num(x['Регламент, дней']), desc: x['Описание процесса'] }; });
            M.procBy = P.map(M.procs, 'name');
            M.spec = { steps: {}, transitions: [] };
            M.stepList = (r[2] || []).map(function (x) {
                var s = { id: x._id, name: x['Шаг процесса'], proc: x['Процесс'], kind: x['Вид события'], exec: x['Исполнитель шага'], norm: C.num(x['Норма шага, ч']), order: C.num(x['Порядок шага']), form: x['Поля формы'], start: B(x['Начальный шаг']) };
                M.spec.steps[s.name] = s; return s;
            }).sort(function (a, b) { return a.order - b.order; });
            M.spec.transitions = (r[3] || []).map(function (x) { return { id: x._id, name: x['Переход'], proc: x['Процесс'], from: x['Из шага'], to: x['В шаг'], cond: x['Условие перехода'], source: x['Источник перехода'], since: C.toIso(x['Действует с']) }; });
            M.reqs = (r[4] || []).map(function (x) {
                return { id: x._id, n: x['Заявка'], proc: x['Процесс'], subj: x['Предмет заявки'], cp: x['Контрагент'], sum: C.num(x['Сумма заявки']), cur: x['Валюта'] || 'RUB', nonres: B(x['Нерезидент']), kind: x['Вид договора'], init: x['Инициатор'], at: x['Текущий шаг'], exec: x['Текущий исполнитель'], status: x['Статус заявки'], start: C.toIso(x['Дата запуска']), entered: C.toIso(x['Вошла в шаг']), due: C.toIso(x['Срок заявки']), done: C.toIso(x['Завершена']) };
            }).sort(function (a, b) { return a.n < b.n ? 1 : -1; });
            M.reqBy = P.map(M.reqs, 'n');
            M.tasks = (r[5] || []).map(function (x) { return { id: x._id, n: x['Задача заявки'], req: x['Заявка'], step: x['Шаг процесса'], who: x['Исполнитель'], from: C.toIso(x['Назначена']), to: C.toIso(x['Выполнена']), dec: x['Решение по задаче'], com: x['Комментарий задачи'], via: x['Замещал'] }; });
            M.events = (r[6] || []).map(function (x) { return { id: x._id, n: x['Событие журнала'], req: x['Заявка'], date: C.toIso(x['Дата события']), time: x['Время события'], code: x['Код события'], from: x['Шаг процесса'], to: x['В шаг'], who: x['Автор события'], why: x['Причина события'], off: B(x['Вне спецификации']) }; });
            M.uncs = (r[7] || []).map(function (x) { return { id: x._id, n: x['Неопределённость'], req: x['Заявка'], step: x['Шаг процесса'], found: C.toIso(x['Обнаружена']), feat: x['Признаки случая'], desc: x['Описание случая'], resp: x['Ответственный'], to: x['Выбранный шаг'], solved: C.toIso(x['Решена']), com: x['Комментарий решения'], state: x['Состояние неопределённости'] }; });
            M.props = (r[8] || []).map(function (x) { return { id: x._id, n: x['Предложение правки'], unc: x['Неопределённость'], proc: x['Процесс'], from: x['Из шага'], to: x['В шаг'], cond: x['Условие перехода'], transfer: B(x['Передача объекта']), author: x['Автор правки'], date: C.toIso(x['Предложена']), state: x['Состояние правки'], text: x['Суть правки'] }; });
            M.apprs = (r[9] || []).map(function (x) { return { id: x._id, n: x['Одобрение правки'], prop: x['Предложение правки'], side: x['Сторона'], who: x['Одобряет'], decision: x['Решение стороны'], date: C.toIso(x['Дата решения']), com: x['Комментарий стороны'] }; });
            M.integs = (r[10] || []).map(function (x) { return { id: x._id, name: x['Интеграция'], dir: x['Направление'], addr: x['Адрес вызова'], method: x['Метод вызова'], step: x['Шаг процесса'], max: C.num(x['Попыток не больше']), desc: x['Описание интеграции'] }; });
            M.calls = (r[11] || []).map(function (x) { return { id: x._id, n: x['Вызов интеграции'], integ: x['Интеграция'], req: x['Заявка'], date: C.toIso(x['Дата вызова']), time: x['Время вызова'], code: C.num(x['Код ответа']), att: C.num(x['Попытка']), res: x['Результат вызова'] }; });
            M.subs = (r[12] || []).map(function (x) { var e = M.emps.filter(function (m) { return m.name === x['Сотрудник']; })[0]; return { id: x._id, n: x['Замещение'], emp: e ? e.login : '', empName: x['Сотрудник'], sub: x['Замещающий'], from: C.toIso(x['Замещение с']), to: C.toIso(x['Замещение по']) }; });
            /* решённые неопределённости - база «похожих случаев»: простой и дошла ли заявка до конца */
            M.cases = M.uncs.filter(function (u) { return u.to; }).map(function (u) { var q = M.reqBy[u.req]; return { req: u.req, step: u.step, feat: u.feat, to: u.to, delay: C.workDays(u.found, u.solved || u.found, M.hol), finished: !!(q && q.status === 'Завершена') }; });
            M.ctx = { today: M.today, hol: M.hol, spec: M.spec, empByLogin: M.empByLogin, subs: M.subs };
            M.me = M.empByLogin[P.ctx.user] || null;
            M.isOwner = P.canWrite('Переход') && P.canWrite('Неопределённость');
            P.cur = M;
            return M;
        });
        return modelP;
    };
    P.resetModel = function () { modelP = null; };
    P.who = function (login) { var M = P.cur, e = M && M.empByLogin[login]; if (!login) return '—'; if (login === 'система') return 'Система'; return e ? short(e.name) : login; };
    function short(n) { var p = String(n).split(' '); return p.length >= 3 ? p[0] + ' ' + p[1][0] + '.' + p[2][0] + '.' : n; }
    P.short = short;
    P.ownerOf = function (proc) { var p = P.cur.procBy[proc]; return p ? p.owner : ''; };
    /* Следующий номер по маске «Т-0266» среди существующих. */
    P.nextNo = function (list, prefix, width) {
        var max = 0; list.forEach(function (x) { var m = new RegExp('^' + prefix + '(\\d+)$').exec(x); if (m) max = Math.max(max, +m[1]); });
        return prefix + String(max + 1).padStart(width, '0');
    };
    P.now = function () { var d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); };

    /* ---------- исполнение: запись пакетом ---------- */
    P.batch = function (ops) {
        return P.post('_m_batch?JSON', { ops: ops }).then(function (r) {
            var bad = (r.results || []).filter(function (x) { return !x.ok; });
            if (r.failed || bad.length) throw new Error((bad[0] && (bad[0].error || JSON.stringify(bad[0]))) || 'запись не прошла');
            P.resetModel(); return r;
        });
    };
    var clean = function (f) { var o = {}; Object.keys(f).forEach(function (k) { if (f[k] !== '' && f[k] !== undefined && f[k] !== null) o[k] = f[k]; }); return o; };
    var NEW = function (t, f) { return { op: 'new', id: t, up: 1, fields: clean(f) }; };
    var SET = function (id, f) { return { op: 'set', id: id, fields: f }; };
    P.NEW = NEW; P.SET = SET;
    P.execOf = function (step, req) { var s = P.cur.spec.steps[step]; if (!s) return ''; if (s.kind === 'Конечное') return ''; return s.exec === 'Инициатор' ? req.init : s.exec; };
    function evOp(M, req, code, from, to, why, off) {
        return NEW('Событие журнала', { 'Событие журнала': P.nextNo(M.events.map(function (e) { return e.n; }).concat(M._evNew || []), 'Ж-', 5), 'Заявка': req ? req.n : '', 'Дата события': M.today, 'Время события': P.now(), 'Код события': code, 'Шаг процесса': from, 'В шаг': to || '', 'Автор события': P.ctx.user, 'Причина события': why, 'Инициатор заявки': req ? req.init : '', 'Вне спецификации': off ? 1 : '' });
    }
    function evs(M, req, list) { M._evNew = []; return list.map(function (a) { var o = evOp(M, req, a[0], a[1], a[2], a[3], a[4]); M._evNew.push(o.fields['Событие журнала']); return o; }); }
    function moveFields(M, req, to) {
        var end = C.isEnd(M.spec, to);
        return { 'Текущий шаг': to, 'Текущий исполнитель': end ? '' : P.execOf(to, req), 'Статус заявки': end ? (/отклон/i.test(to) ? 'Отклонена' : 'Завершена') : 'В работе', 'Вошла в шаг': M.today, 'Завершена': end ? M.today : '' };
    }
    /* Решение по задаче шага: следующий шаг по спецификации или неопределённость к владельцу процесса. */
    P.decide = function (req, decision, comment) {
        var M = P.cur, step = req.at, h = C.holder(req.exec, M.empByLogin, M.subs, M.today), plan = C.plan(M.spec, req, step, decision);
        var err = C.checkDecision(decision, comment); if (err.length) return Promise.reject(new Error(err.join('; ')));
        var ops = [NEW('Задача заявки', { 'Задача заявки': P.nextNo(M.tasks.map(function (t) { return t.n; }), 'Т-', 4), 'Заявка': req.n, 'Шаг процесса': step, 'Исполнитель': P.ctx.user, 'Назначена': req.entered, 'Выполнена': M.today, 'Решение по задаче': decision, 'Комментарий задачи': comment, 'Инициатор заявки': req.init, 'Замещал': P.ctx.user !== req.exec ? req.exec : '' })];
        if (plan.to && !plan.stuck) {
            var m = plan.matches[0];
            ops.push(SET(req.id, moveFields(M, req, plan.to)));
            ops = ops.concat(evs(M, req, [['Переход', step, plan.to, 'Решение: ' + decision + (m && m.cond ? '; условие: ' + m.cond : '') + (comment ? '; ' + comment : '')]]));
        } else {
            var owner = P.ownerOf(req.proc), tried = (C.route(M.spec, step, C.attrsOf(req, decision)).tried || []).map(function (t) { return '«' + t.to + '»: ' + (t.cond || 'без условия'); }).join('; ');
            var desc = plan.manual ? 'Нестандартный случай на шаге «' + step + '»: ' + comment : 'После шага «' + step + '» решением «' + decision + '» ни один переход не подходит (' + tried + ').';
            ops.push(NEW('Неопределённость', { 'Неопределённость': P.nextNo(M.uncs.map(function (u) { return u.n; }), 'Н-', 4), 'Заявка': req.n, 'Шаг процесса': step, 'Обнаружена': M.today, 'Признаки случая': C.featuresOf(req), 'Описание случая': desc, 'Ответственный': owner, 'Состояние неопределённости': 'Открыта' }));
            ops.push(SET(req.id, { 'Статус заявки': 'Ждёт решения', 'Текущий исполнитель': owner, 'Вошла в шаг': M.today }));
            ops = ops.concat(evs(M, req, [['Неопределённость', step, '', desc + ' Заявка ждёт решения ответственного: ' + P.who(owner) + '.']]));
        }
        return P.batch(ops).then(function () { return plan; });
    };
    /* Ответственный выбирает вариант: заявка идёт дальше сразу, правка спецификации уходит сторонам. */
    P.resolve = function (unc, to, comment, propose) {
        var M = P.cur, req = M.reqBy[unc.req], n = 'П-' + String(M.props.reduce(function (mx, p) { return Math.max(mx, C.num(p.n.slice(2))); }, 0) + 1).padStart(4, '0');
        var pr = C.proposalFrom(unc, to), transfer = P.execOf(unc.step, req) !== P.execOf(to, req);
        var ops = [SET(unc.id, { 'Выбранный шаг': to, 'Решена': M.today, 'Комментарий решения': comment, 'Состояние неопределённости': 'Решена' }), SET(req.id, moveFields(M, req, to))];
        var list = [['Решение по неопределённости', unc.step, to, 'Ответственный выбрал «' + to + '»' + (comment ? ': ' + comment : '') + '. Заявка пошла дальше без разработчика.', 1]];
        if (propose) {
            ops.push(NEW('Предложение правки', { 'Предложение правки': n, 'Неопределённость': unc.n, 'Процесс': req.proc, 'Из шага': pr.from, 'В шаг': pr.to, 'Условие перехода': pr.cond, 'Передача объекта': transfer ? 1 : '', 'Автор правки': P.ctx.user, 'Предложена': M.today, 'Состояние правки': 'На одобрении', 'Суть правки': 'Добавить переход «' + pr.from + '» → «' + pr.to + '» при условии «' + pr.cond + '», чтобы такие заявки шли по спецификации сами (основание: ' + unc.n + ', ' + req.n + ').' }));
            var s = C.sides({ from: pr.from, to: pr.to, transfer: transfer }, { steps: stepExecs(M, req) }, P.ownerOf(req.proc)), k = M.apprs.reduce(function (mx, a) { return Math.max(mx, C.num(a.n.slice(2))); }, 0);
            s.forEach(function (x, i) { ops.push(NEW('Одобрение правки', { 'Одобрение правки': 'О-' + String(k + i + 1).padStart(4, '0'), 'Предложение правки': n, 'Сторона': x.side, 'Одобряет': x.who, 'Решение стороны': 'Ждёт' })); });
            list.push(['Правка предложена', unc.step, to, n + ': переход «' + pr.from + '» → «' + pr.to + '» при «' + pr.cond + '»; стороны: ' + s.map(function (x) { return x.side.toLowerCase() + ' — ' + P.who(x.who); }).join(', ') + '.']);
        }
        ops = ops.concat(evs(M, req, list));
        return P.batch(ops).then(function () { return { prop: propose ? n : '' }; });
    };
    function stepExecs(M, req) { var o = {}; Object.keys(M.spec.steps).forEach(function (k) { o[k] = { exec: P.execOf(k, req) || M.spec.steps[k].exec }; }); return o; }
    P.approve = function (a, decision, comment) {
        var M = P.cur, p = M.props.filter(function (x) { return x.n === a.prop; })[0], u = p && M.uncs.filter(function (x) { return x.n === p.unc; })[0], req = u ? M.reqBy[u.req] : null;
        var ops = [SET(a.id, { 'Решение стороны': decision, 'Дата решения': M.today, 'Комментарий стороны': comment || '' })];
        if (req) ops = ops.concat(evs(M, req, [['Одобрение правки', p.from, p.to, a.prop + ': ' + a.side.toLowerCase() + ' сторона (' + P.who(P.ctx.user) + ') — ' + decision.toLowerCase() + (comment ? ': ' + comment : '')]]));
        return P.batch(ops);
    };
    /* Внести одобренную правку: новый переход в спецификации, версия процесса +1. */
    P.applyProp = function (p) {
        var M = P.cur, pr = M.procBy[p.proc], u = M.uncs.filter(function (x) { return x.n === p.unc; })[0], req = u ? M.reqBy[u.req] : null;
        var ops = [NEW('Переход', { 'Переход': p.from + ' → ' + p.to, 'Процесс': p.proc, 'Из шага': p.from, 'В шаг': p.to, 'Условие перехода': p.cond, 'Источник перехода': 'Правка ' + p.n, 'Действует с': M.today }),
            SET(p.id, { 'Состояние правки': 'Внесена' }), SET(pr.id, { 'Версия спецификации': pr.version + 1 })];
        if (req) ops = ops.concat(evs(M, req, [['Правка внесена', p.from, p.to, p.n + ' внесена в спецификацию «' + p.proc + '», версия ' + (pr.version + 1) + '. Следующие такие заявки идут без исключения.']]));
        return P.batch(ops);
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
    P.btn = function (text, fn, cls) { return P.el('button', { type: 'button', 'class': 'bpm-btn ' + (cls || ''), onclick: fn, text: text }); };
    P.toast = function (msg, bad) {
        var t = P.el('div', { 'class': 'bpm-toast' + (bad ? ' bpm-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 7000 : 3500);
    };
    /* Модальное окно (не alert/confirm/prompt). */
    P.modal = function (title, body, buttons, wide) {
        var back = P.el('div', { 'class': 'bpm-modal-back' });
        function close() { back.remove(); }
        var foot = P.el('div', { 'class': 'bpm-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            return P.btn(b.text, function () { if (!b.fn || b.fn(close) !== false) { if (!b.keep) close(); } }, b.cls);
        }));
        var box = P.el('div', { 'class': 'bpm-modal' + (wide ? ' bpm-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [P.el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box };
    };
    P.field = function (label, input, hint) { return P.el('label', { 'class': 'bpm-field' }, [P.el('span', { text: label }), input, hint ? P.el('small', { text: hint }) : null]); };
    P.select = function (opts, value) {
        var s = P.el('select', {}, opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return P.el('option', { value: v, text: t }); }));
        s.value = value === undefined ? '' : value; return s;
    };
    P.input = function (type, value, attrs) { var i = P.el(type === 'textarea' ? 'textarea' : 'input', Object.assign(type === 'textarea' ? { rows: 3 } : { type: type }, attrs || {})); i.value = value === undefined ? '' : value; return i; };
    P.download = function (name, text) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
    };
    P.badge = function (text, kind) { return '<span class="bpm-badge bpm-' + (kind || 'info') + '">' + P.esc(text) + '</span>'; };
    P.statusBadge = function (s) { return P.badge(s, { 'В работе': 'info', 'Ждёт решения': 'crit', 'Ошибка интеграции': 'crit', 'Завершена': 'ok', 'Отклонена': 'mute' }[s] || 'mute'); };
    P.tabs = function (items, active, onpick) {
        return P.el('div', { 'class': 'bpm-tabs', role: 'tablist' }, items.map(function (it) {
            return P.el('button', { type: 'button', role: 'tab', 'class': 'bpm-tab' + (it[0] === active ? ' bpm-tab-on' : ''), 'aria-selected': it[0] === active ? 'true' : 'false', onclick: function () { onpick(it[0]); }, text: it[1] });
        }));
    };
    /* Таблица: cols = [{k, t, num, cls(r), html(r)}] */
    P.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = P.el('thead', {}, [P.el('tr', {}, cols.map(function (c) { return P.el('th', { text: c.t, 'class': c.num ? 'bpm-num' : '' }); }))]);
        var tbody = P.el('tbody', {}, rows.map(function (r) {
            return P.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' bpm-click' : ''), onclick: opts.onrow ? function () { opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = P.el('td', { 'class': (c.num ? 'bpm-num ' : '') + (c.cls ? c.cls(r) : '') });
                    if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k];
                    return td;
                }));
        }));
        if (!rows.length) tbody.appendChild(P.el('tr', {}, [P.el('td', { colspan: cols.length, 'class': 'bpm-empty', text: opts.empty || 'Нет данных' })]));
        return P.el('div', { 'class': 'bpm-tablewrap' }, [P.el('table', { 'class': 'bpm-table' }, [thead, tbody])]);
    };
    P.kpi = function (label, value, sub, kind) {
        return P.el('div', { 'class': 'bpm-kpi' + (kind ? ' bpm-kpi-' + kind : '') }, [P.el('div', { 'class': 'bpm-kpi-v', html: value }), P.el('div', { 'class': 'bpm-kpi-l', text: label }), sub ? P.el('div', { 'class': 'bpm-kpi-s', text: sub }) : null]);
    };
    P.fail = function (e) { host.innerHTML = ''; host.appendChild(P.el('div', { 'class': 'bpm-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    P.mount = function (fn) {
        if (!host) return;
        host.textContent = 'Загрузка...';
        P.meta().then(function () { return P.model(); }).then(function (M) { host.innerHTML = ''; return fn(host, M); }).catch(P.fail);
    };
    P.rerender = function (fn) { P.resetModel(); P.mount(fn); };
    P.nav = function (screen, hash) { return P.url(screen) + (hash ? '#' + hash : ''); };
    P.hash = function () { var o = {}; location.hash.replace(/^#/, '').split('&').forEach(function (p) { var a = p.split('='); if (a[0]) o[a[0]] = decodeURIComponent(a[1] || ''); }); return o; };
    P.head = function (title, sub) { return [P.el('h1', { text: title }), P.el('p', { 'class': 'bpm-sub', text: sub })]; };
    P.option = function (what, hours) { P.toast(what + ' — опция по запросу, подключаем за день (≈' + hours + ' ч).'); };
})();
