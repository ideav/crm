/* Взыскание: модель данных рабочих мест. Читает таблицы, строит реестр (старение, ступень, следующее действие, решение о стоп-отгрузке). Расчёты - в collect-core.js. */
(function () {
    'use strict';
    var W = window.Dbt, C = W.core;
    var M = W.M = { loaded: null };
    var BASIS = { 'Неустойка по договору': 'contract', 'Ст. 395 ГК': '395', 'Без пеней': 'none' };
    W.STAGE_ORDER = ['before', 'remind', 'call', 'stop', 'claim', 'court', 'restructuring'];
    W.stageKind = function (color) { return color || 'info'; };
    function safe(name) { return W.canRead(name) ? W.rows(name).catch(function () { return []; }) : Promise.resolve([]); }
    function truthy(v) { return !!v && v !== '0'; }
    W.short = function (s) { return String(s || '').replace(/^[^:]+:\s*/, ''); };
    W.shortFio = function (f) { var p = String(f || '').split(' '); return p.length > 2 ? p[0] + ' ' + p[1].charAt(0) + '.' + p[2].charAt(0) + '.' : f; };

    W.loadModel = function () {
        if (M.loaded) return M.loaded;
        var names = ['Правило', 'Ступень', 'Ключевая ставка', 'Менеджер', 'Шаблон письма', 'Клиент', 'Договор', 'Отгрузка', 'Оплата', 'Обещание', 'Претензия', 'Дело', 'График реструктуризации', 'Задача по долгу', 'Контакт', 'Запрос разблокировки'];
        M.loaded = W.all2(names).then(function (d) {
            M.raw = d;
            M.build();
            return Promise.all((M.raw['График реструктуризации'] || []).map(function (s) {
                return W.canRead('Платёж графика') ? W.rows('Платёж графика', s._id).catch(function () { return []; }).then(function (rows) { s.pay = rows; }) : (s.pay = [], null);
            }));
        }).then(function () { M.compute(); return M; });
        return M.loaded;
    };
    W.all2 = function (names) {
        return Promise.all(names.map(safe)).then(function (rs) { var o = {}; names.forEach(function (n, i) { o[n] = rs[i]; }); return o; });
    };
    M.reload = function () { M.loaded = null; return W.loadModel(); };

    M.build = function () {
        var R = M.raw, m = {};
        R['Правило'].forEach(function (r) { m[r['Правило']] = C.num(r['Значение правила']); });
        M.rules = { stopDays: m['Порог стоп-отгрузки по просрочке, дн'], stopSum: m['Порог стоп-отгрузки по сумме просрочки'], byLimit: m['Стоп-отгрузка по лимиту долга'] === 1,
            claimDays: m['Претензионный срок по умолчанию, дн'] || 30, grace: m['Льготные дни графика реструктуризации'] || 0, dsoDays: m['Окно расчёта DSO, дн'] || 90 };
        M.ruleRows = R['Правило'];
        M.stages = R['Ступень'].map(function (r) {
            return { id: r._id, code: r['Код'], name: r['Ступень'], from: C.num(r['С дня просрочки']), byAge: truthy(r['По возрасту долга']), action: r['Действие'], owner: r['Исполнитель'], color: r['Цвет'] || 'info' };
        });
        M.stageBy = {}; M.stages.forEach(function (s) { M.stageBy[s.code] = s; });
        M.stageByName = {}; M.stages.forEach(function (s) { M.stageByName[s.name] = s; });
        M.rates = R['Ключевая ставка'].map(function (r) { return { from: C.toIso(r['Ключевая ставка']), rate: C.num(r['Ставка']), note: r['Основание'] }; }).sort(function (a, b) { return a.from < b.from ? -1 : 1; });
        M.managers = R['Менеджер'];
        M.me = null;
        R['Менеджер'].forEach(function (x) { if (x['Логин'] && x['Логин'] === W.ctx.user) M.me = x['Менеджер']; });
        M.templates = {}; R['Шаблон письма'].forEach(function (t) { M.templates[t['Ступень']] = t; });
        M.clients = {};
        R['Клиент'].forEach(function (r) {
            if (!r['Менеджер'] && !r['ИНН']) return;
            M.clients[r['Клиент']] = { id: r._id, name: r['Клиент'], inn: r['ИНН'], mgr: r['Менеджер'], ind: r['Отрасль'], city: r['Город'], key: truthy(r['Ключевой клиент']), limit: C.num(r['Лимит долга']),
                stop: truthy(r['Стоп-отгрузка']), stopReason: r['Причина стопа'], stopDate: C.toIso(r['Дата стопа']), stopBy: r['Кто поставил стоп'] };
        });
        M.contracts = {}; M.contractByClient = {};
        R['Договор'].forEach(function (r) {
            var k = { id: r._id, no: r['Договор'], client: r['Клиент'], date: C.toIso(r['Дата договора']), delay: C.num(r['Отсрочка, дн']), basis: BASIS[r['Способ расчёта пеней']] || 'none', basisName: r['Способ расчёта пеней'],
                rate: C.num(r['Неустойка, % в день']), cap: C.num(r['Потолок неустойки, %']), claimDays: C.num(r['Претензионный срок, дн']) || M.rules.claimDays, court: r['Подсудность'] };
            M.contracts[k.no] = k; if (!M.contractByClient[k.client]) M.contractByClient[k.client] = k;
        });
        M.docs = R['Отгрузка'].map(function (r) { return { id: r['Отгрузка'], rid: r._id, client: r['Клиент'], contract: r['Договор'], mgr: r['Менеджер'], number: r['Отгрузка'], date: C.toIso(r['Дата отгрузки']), due: C.toIso(r['Срок оплаты']), amount: C.num(r['Сумма']) }; });
        M.pays = R['Оплата'].map(function (r) { return { id: r['Оплата'], doc: r['Отгрузка'], client: r['Клиент'], date: C.toIso(r['Дата оплаты']), amount: C.num(r['Сумма оплаты']) }; });
        M.promises = R['Обещание'].map(function (r) { return { id: r._id, date: C.toIso(r['Обещание']), client: r['Клиент'], mgr: r['Менеджер'], wrote: C.toIso(r['Дата записи']), sum: C.num(r['Сумма обещания']), status: r['Статус обещания'], comment: r['Комментарий'] }; });
        M.claims = R['Претензия'].map(function (r) { return { id: r._id, no: r['Претензия'], client: r['Клиент'], contract: r['Договор'], mgr: r['Менеджер'], date: C.toIso(r['Дата претензии']), sent: C.toIso(r['Дата отправки']), principal: C.num(r['Основной долг']), pen: C.num(r['Пени']), way: r['Способ расчёта'], status: r['Статус претензии'], track: r['Трек-номер'], text: r['Текст претензии'] }; });
        M.cases = R['Дело'].map(function (r) { return { id: r._id, no: r['Дело'], client: r['Клиент'], claim: r['Претензия'], lawyer: r['Юрист'], status: r['Статус дела'], sum: C.num(r['Сумма иска']), filed: C.toIso(r['Дата подачи']), hearing: C.toIso(r['Ближайшее заседание']), court: r['Суд'], comment: r['Комментарий'] }; });
        M.schedules = R['График реструктуризации'];
        M.tasks = R['Задача по долгу'].map(function (r) { return { id: r._id, date: C.toIso(r['Задача по долгу']), client: r['Клиент'], mgr: r['Менеджер'], type: r['Тип задачи'], desc: r['Описание'], status: r['Статус работы'], stage: r['Ступень'] }; });
        M.contacts = R['Контакт'].map(function (r) { return { id: r._id, date: C.toIso(r['Контакт']), client: r['Клиент'], mgr: r['Менеджер'], ch: r['Канал контакта'], author: r['Автор'], theme: r['Тема'], res: r['Итог'] }; });
        M.requests = R['Запрос разблокировки'].map(function (r) { return { id: r._id, date: C.toIso(r['Запрос разблокировки']), client: r['Клиент'], mgr: r['Менеджер'], comment: r['Комментарий'], decision: r['Решение'], status: r['Статус запроса'] }; });
    };

    function schedFor(client) {
        var found = null;
        (M.schedules || []).forEach(function (s) { if (s['Клиент'] === client && s['Статус графика'] !== 'График: исполнен') found = s; });
        return found;
    }
    M.scheduleCheck = function (s) {
        return C.restructureCheck((s.pay || []).map(function (p) { return { date: C.toIso(p['Платёж графика']), amount: C.num(p['Сумма платежа']), paid: C.num(p['Оплачено']) }; }), W.TODAY, M.rules.grace);
    };
    /* Пересчёт реестра: вызывается после загрузки и после правки правил/данных. */
    M.compute = function () {
        var T = W.TODAY, led = C.ledger(M.docs, M.pays, T);
        M.ledger = led;
        M.rows = led.rows.filter(function (r) { return M.clients[r.client]; }).map(function (r) {
            var cl = M.clients[r.client], sched = schedFor(r.client), chk = sched ? M.scheduleCheck(sched) : null;
            var cases = M.cases.filter(function (c) { return c.client === r.client && c.status !== 'Дело: закрыто'; });
            var claims = M.claims.filter(function (c) { return c.client === r.client && c.status !== 'Претензия: черновик'; }).sort(function (a, b) { return a.sent < b.sent ? 1 : -1; });
            var promises = M.promises.filter(function (p) { return p.client === r.client; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
            var flags = { court: cases.length > 0, restructuring: !!(sched && chk && !chk.violated) };
            var cs = C.clientStage(r.maxDays, M.stages, flags), st = cs.stage;
            var dec = C.stopDecision({ limit: cl.limit, key: cl.key }, { maxDays: r.maxDays, overdue: r.overdue, debt: r.debt }, M.rules, { restructOk: flags.restructuring });
            var lastClaim = claims[0], term = lastClaim ? C.claimTerm(lastClaim.sent, (M.contractByClient[r.client] || {}).claimDays, T) : null;
            var prom = promises[0], action = st.action, owner = st.owner, hot = '';
            if (cs.override === 'restructuring') { action = chk && chk.next ? 'Контроль графика: ближайший платёж ' + C.toDmy(chk.next.date) : 'Контроль графика платежей'; }
            else if (cs.override === 'court') { action = 'Дело ' + cases[0].no + ': ' + W.short(cases[0].status).toLowerCase(); }
            else if (r.maxDays > 0) {
                if (prom && prom.status === 'Обещание: ждём' && prom.date >= T) { action = 'Ждём обещанный платёж ' + C.toDmy(prom.date); owner = 'Менеджер'; }
                else if (prom && prom.status === 'Обещание: нарушено') { action = 'Обещание нарушено ' + C.toDmy(prom.date) + ': повторный звонок'; owner = 'Менеджер'; hot = 'crit'; }
                else if (term && !term.canSue) { action = 'Ждём срок по претензии ' + lastClaim.no + ' до ' + C.toDmy(term.last); owner = 'Кредитный контролёр'; }
                else if (term && term.canSue) { action = 'Срок по претензии истёк: пакет юристу, иск'; owner = 'Юрист'; hot = 'crit'; }
                else if (st.code === 'claim') { action = 'Сформировать претензию с расчётом пеней'; }
            }
            return { name: r.client, id: cl.id, mgr: cl.mgr, key: cl.key, limit: cl.limit, debt: r.debt, overdue: r.overdue, maxDays: r.maxDays, aging: r.aging, docs: r.docs,
                stage: st, stageCode: st.code, override: cs.override, action: action, owner: owner, hot: hot, stop: cl.stop, dec: dec, sched: sched, schedCheck: chk, claim: lastClaim, term: term, caseRec: cases[0] || null, promise: prom };
        });
        M.byName = {}; M.rows.forEach(function (r) { M.byName[r.name] = r; });
    };
    /* Строки с учётом выбранного менеджера (для ролей с масками реестр уже ограничен правами). */
    M.visible = function (mgr) { return M.rows.filter(function (r) { return !mgr || r.mgr === mgr; }); };
    M.funnel = function (rows) {
        var f = {}; W.STAGE_ORDER.forEach(function (c) { f[c] = { code: c, n: 0, sum: 0, overdue: 0 }; });
        rows.forEach(function (r) { var x = f[r.stageCode] || (f[r.stageCode] = { code: r.stageCode, n: 0, sum: 0, overdue: 0 }); x.n++; x.sum += r.debt; x.overdue += r.overdue; });
        return W.STAGE_ORDER.map(function (c) { return f[c]; });
    };
    M.totals = function (rows) {
        var t = { cur: 0, b30: 0, b60: 0, b90: 0, b90p: 0, total: 0, overdue: 0 };
        rows.forEach(function (r) { Object.keys(t).forEach(function (k) { t[k] = C.round2(t[k] + r.aging[k]); }); });
        return t;
    };
    /* ---------- запись ---------- */
    M.create = function (table, fields) { return W.post('_m_new/' + W.tid(table) + '?JSON', { up: 1, fields: fields }); };
    M.set = function (id, fields) { return W.post('_m_set/' + id + '?JSON', { fields: fields }); };
    M.myManager = function () { return M.me || ''; };
})();
