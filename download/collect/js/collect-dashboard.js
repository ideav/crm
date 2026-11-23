/* Взыскание: дашборд финансового директора - DSO, просрочка по менеджерам и ступеням, прогноз поступлений на 4 недели. */
(function () {
    'use strict';
    var W = window.Dbt, C = W.core, M = W.M;
    var PROB = { before: 0.9, remind: 0.7, call: 0.5, stop: 0.35, claim: 0.2, court: 0.1, restructuring: 0.5 };
    var SEG = [['due', 'Срок наступает по графику отгрузок', '#2563eb'], ['promised', 'Обещания клиентов', '#15803d'], ['scheduled', 'Платежи реструктуризации', '#0f766e'], ['overdue', 'Просрочка (оценка по ступени)', '#d97706']];

    function kpi(label, value, sub, cls) {
        return W.el('div', { 'class': 'dbt-kpi ' + (cls || '') }, [W.el('div', { 'class': 'dbt-kpi-v', text: value }), W.el('div', { 'class': 'dbt-kpi-l', text: label }), W.el('div', { 'class': 'dbt-kpi-s', text: sub || '' })]);
    }
    function bars(rows, key, max, cls) {
        return W.el('div', { 'class': 'dbt-bars' }, rows.map(function (r) {
            return W.el('div', { 'class': 'dbt-barrow' }, [W.el('div', { text: r.label, title: r.label }), W.el('div', { 'class': 'dbt-bartrack' }, [W.el('div', { 'class': 'dbt-barfill ' + (r.cls || cls || ''), style: 'width:' + (max ? Math.max(1, r[key] / max * 100) : 0).toFixed(1) + '%' })]), W.el('div', { 'class': 'dbt-num', html: W.money(r[key]) + ' ₽' + (r.note ? ' <span class="dbt-mini">' + r.note + '</span>' : '') })]);
        }));
    }
    function render(host) {
        host.innerHTML = '';
        var rows = M.rows, T = W.TODAY, tot = M.totals(rows);
        var window_ = M.rules.dsoDays || 90, rev = C.revenueFor(M.docs, T, window_), dso = C.dso(tot.total, rev, window_);
        var collected = M.pays.filter(function (p) { return p.date > C.addDays(T, -30) && p.date <= T; }).reduce(function (s, p) { return s + p.amount; }, 0);
        var share = tot.total ? tot.overdue / tot.total * 100 : 0;
        host.appendChild(W.el('h1', { text: 'Дашборд финансового директора' }));
        host.appendChild(W.el('p', { 'class': 'dbt-sub', text: 'Состояние дебиторки на ' + C.toDmy(T) + '. DSO считается как дебиторка / выручка за ' + window_ + ' дн. × ' + window_ + '.' }));
        host.appendChild(W.el('div', { 'class': 'dbt-kpis' }, [
            kpi('DSO, дней', String(dso).replace('.', ','), 'выручка за ' + window_ + ' дн.: ' + W.money(rev) + ' ₽'),
            kpi('Дебиторка', W.money(tot.total) + ' ₽', rows.length + ' клиентов'),
            kpi('Просрочено', share.toFixed(1).replace('.', ',') + '%', W.money(tot.overdue) + ' ₽', share > 15 ? 'dbt-kpi-bad' : ''),
            kpi('Собрано за 30 дней', W.money(collected) + ' ₽', 'оплаты по отгрузкам')
        ]));
        // менеджеры
        var mg = C.byManager(rows.map(function (r) { return { manager: r.mgr, debt: r.debt, overdue: r.overdue, maxDays: r.maxDays }; }));
        var maxO = mg.length ? mg[0].overdue : 0;
        var left = W.el('div', {}, [W.el('h2', { text: 'Просрочка по менеджерам' }), bars(mg.map(function (m) { return { label: W.shortFio(m.manager), overdue: m.overdue, note: m.share.toFixed(0) + '% своей дебиторки', cls: m.share > 20 ? 'dbt-barfill-bad' : m.share > 10 ? 'dbt-barfill-warn' : '' }; }), 'overdue', maxO)]);
        // ступени
        var fun = M.funnel(rows).filter(function (f) { return f.code !== 'before'; });
        var maxF = Math.max.apply(null, fun.map(function (f) { return f.overdue; }).concat([0]));
        var right = W.el('div', {}, [W.el('h2', { text: 'Просрочка по ступеням воронки' }), bars(fun.map(function (f) { var st = M.stageBy[f.code]; return { label: st ? st.name : f.code, overdue: f.overdue, note: f.n + ' кл.', cls: f.code === 'court' || f.code === 'claim' ? 'dbt-barfill-bad' : f.code === 'stop' ? 'dbt-barfill-warn' : '' }; }), 'overdue', maxF)]);
        host.appendChild(W.el('div', { 'class': 'dbt-split' }, [left, right]));
        // прогноз
        var upcoming = M.ledger.items.filter(function (i) { return i.days <= 0; });
        var promises = M.promises.filter(function (p) { return p.status === 'Обещание: ждём' && p.date > T; }).map(function (p) { return { client: p.client, date: p.date, amount: p.sum }; });
        var sch = []; M.schedules.forEach(function (s) { if (s['Статус графика'] === 'График: исполнен') return; (s.pay || []).forEach(function (p) { sch.push({ client: s['Клиент'], date: C.toIso(p['Платёж графика']), amount: C.num(p['Сумма платежа']), paid: C.num(p['Оплачено']) }); }); });
        var wk = C.forecast(T, 4, upcoming, promises, sch, rows.map(function (r) { return { client: r.name, overdue: r.overdue, stageCode: r.stageCode }; }), PROB);
        var mx = Math.max.apply(null, wk.map(function (w) { return w.total; }).concat([1]));
        host.appendChild(W.el('h2', { text: 'Прогноз поступлений на 4 недели' }));
        host.appendChild(W.el('div', { 'class': 'dbt-weeks' }, wk.map(function (w) {
            return W.el('div', { 'class': 'dbt-week' }, [W.el('div', { text: W.money(w.total) + ' ₽' }), W.el('div', { 'class': 'dbt-week-stack', style: 'height:' + (w.total / mx * 130).toFixed(0) + 'px' }, SEG.map(function (s) { return W.el('div', { style: 'background:' + s[2] + ';height:' + (w.total ? w[s[0]] / w.total * 100 : 0).toFixed(1) + '%', title: s[1] + ': ' + W.money(w[s[0]]) + ' ₽' }); })), W.el('div', { 'class': 'dbt-mini', text: C.toDmy(w.from).slice(0, 5) + ' – ' + C.toDmy(w.to).slice(0, 5) })]);
        })));
        host.appendChild(W.el('div', { 'class': 'dbt-legend' }, SEG.map(function (s) { return W.el('span', { html: '<i class="dbt-dot" style="background:' + s[2] + '"></i>' + W.esc(s[1]) }); })));
        host.appendChild(W.el('p', { 'class': 'dbt-mini', text: 'Оценка грубая: поступления по сроку ×0,85, обещания ×0,8, график ×0,9, просрочка без обещания — по вероятности ступени.' }));
        // топ
        host.appendChild(W.el('h2', { text: 'Крупнейшие просрочки' }));
        host.appendChild(W.table([
            { t: 'Клиент', html: function (r) { return (r.key ? '<span class="dbt-key">★</span> ' : '') + '<b>' + W.esc(r.name) + '</b>'; } }, { t: 'Менеджер', html: function (r) { return W.esc(W.shortFio(r.mgr)); } },
            { t: 'Просрочено, ₽', num: true, html: function (r) { return W.money(r.overdue); } }, { t: 'Дней', num: true, html: function (r) { return r.maxDays || ''; } },
            { t: 'Ступень', html: function (r) { return W.badge(r.stage.name, r.stage.color); } }, { t: 'Следующее действие', html: function (r) { return W.esc(r.action); } }],
        rows.slice().sort(function (a, b) { return b.overdue - a.overdue; }).slice(0, 10), { onrow: function (r) { location.href = W.url('registry') + '#client=' + encodeURIComponent(r.name); } }));
    }
    W.mount(function (host) { return W.loadModel().then(function () { render(host); }); });
})();
