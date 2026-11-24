/* PSA: Проекты и маржа. Портфель с освоением часов; ставки себестоимости и продажи, маржа план-факт и «занятость x ФОТ» по проекту. */
(function () {
    'use strict';
    var P = window.Psa, C = P.core;
    var st = { contract: '', mine: null, q: '' };

    function money(M) { return M.canCost && M.canPrice; }
    function marginBadge(M, v) { if (v === null || v === undefined) return '<span class="psa-muted">-</span>'; return P.badge(String(v).replace('.', ',') + '%', v < M.rules.marginMin ? 'crit' : v < M.rules.marginMin + 10 ? 'warn' : 'ok'); }
    function calc(M) { return M.projects.map(function (p) { return { p: p, m: C.projectMargin(p, M.emps, M.rates, M.ts, M.bookings, M.hol, P.TODAY) }; }); }
    function bar(v, max, cls) { return '<div class="psa-bar-track"><div class="psa-bar-fill ' + (cls || '') + '" style="width:' + Math.min(100, max ? v / max * 100 : 0) + '%"></div></div>'; }

    function render(host, M) {
        host.innerHTML = '';
        if (st.mine === null) st.mine = M.myProjects.length > 0;
        var all = calc(M), mon = money(M);
        var rows = all.filter(function (r) {
            if (st.contract && r.p.contract !== st.contract) return false;
            if (st.mine && M.myProjects.length && M.myProjects.indexOf(r.p) < 0) return false;
            if (st.q && (r.p.name + ' ' + r.p.cust + ' ' + r.p.code).toLowerCase().indexOf(st.q.toLowerCase()) < 0) return false;
            return r.p.contract !== 'Внутренний' || !mon;
        });
        var revPlan = 0, costPlan = 0, risk = 0, over = 0;
        rows.forEach(function (r) { if (r.p.contract === 'Внутренний') return; revPlan += r.m.revPlan; costPlan += r.m.costPlan; if (r.m.marginPlanPct !== null && r.m.marginPlanPct < M.rules.marginMin) risk++; if (r.m.overrunPct > 10) over++; });
        host.appendChild(P.el('h1', { text: 'Проекты и маржа' }));
        host.appendChild(P.el('p', { 'class': 'psa-sub', text: mon ? 'Маржа считается по себестоимости часа каждого человека и ставкам продажи: T&M по часам и грейдам, фиксированная цена по готовности, поддержка по абонплате. Прогноз берёт остаток из подтверждённых броней.' : 'Ваша роль видит часы и бюджеты в часах. Ставки, себестоимость и выручка скрыты политикой доступа: их видят директор, PMO и финансы.' }));
        var kp = [P.kpi('Проектов в работе', String(rows.filter(function (r) { return r.p.contract !== 'Внутренний'; }).length), 'в выборке', '')];
        if (mon) kp.push(P.kpi('Прогноз маржи портфеля', revPlan ? C.round1((revPlan - costPlan) / revPlan * 100).toString().replace('.', ',') + '%' : '-', 'выручка ' + P.mln(revPlan), ''), P.kpi('Проектов ниже порога маржи', String(risk), 'порог ' + M.rules.marginMin + '%', risk ? 'bad' : 'good'));
        kp.push(P.kpi('Перерасход часов более 10%', String(over), 'прогноз к бюджету часов', over ? 'warn' : 'good'));
        host.appendChild(P.el('div', { 'class': 'psa-kpis' }, kp));
        var ct = P.select([['', 'Все договоры'], ['FP', 'FP'], ['T&M', 'T&M'], ['Поддержка', 'Поддержка']].concat(mon ? [['Внутренний', 'Внутренний']] : []), st.contract);
        var q = P.input('text', st.q, { placeholder: 'Проект или заказчик' });
        var mine = P.el('input', { type: 'checkbox' }); mine.checked = !!st.mine;
        ct.onchange = function () { st.contract = ct.value; render(host, M); }; q.onchange = function () { st.q = q.value; render(host, M); }; mine.onchange = function () { st.mine = mine.checked; render(host, M); };
        host.appendChild(P.el('div', { 'class': 'psa-bar' }, [P.field('Договор', ct), P.field('Поиск', q), M.myProjects.length ? P.el('label', { 'class': 'psa-field', style: 'flex-direction:row;gap:6px;align-items:center;color:inherit' }, [mine, P.el('span', { text: 'Только мои проекты' })]) : null]));
        var cols = [
            { t: 'Проект', html: function (r) { return '<b>' + P.esc(r.p.name) + '</b><div class="psa-muted">' + P.esc(r.p.code) + ', ' + P.esc(r.p.cust) + ', РП ' + P.esc(r.p.pm) + '</div>'; } },
            { t: 'Договор', html: function (r) { return P.badge(r.p.contract, r.p.contract === 'FP' ? 'info' : r.p.contract === 'T&M' ? 'ok' : 'mute'); } },
            { t: 'Часы: факт / прогноз / бюджет', html: function (r) { var u = r.p.budgetHours ? r.m.forecastHours / r.p.budgetHours * 100 : 0; return bar(r.m.factHours, r.p.budgetHours, '') + '<div class="psa-muted">' + P.fmt(r.m.factHours) + ' / ' + P.fmt(r.m.forecastHours) + ' / ' + P.fmt(r.p.budgetHours) + (r.m.overrunPct > 10 ? ' ' + P.badge('+' + Math.round(r.m.overrunPct) + '%', 'crit') : '') + '</div>'; } }
        ];
        if (mon) cols.push({ t: 'Выручка по плану', num: true, html: function (r) { return r.p.contract === 'Внутренний' ? '-' : P.mln(r.m.revPlan); } }, { t: 'Маржа факт', num: true, html: function (r) { return marginBadge(M, r.m.marginFactPct); } }, { t: 'Маржа прогноз', num: true, html: function (r) { return marginBadge(M, r.m.marginPlanPct); } });
        cols.push({ t: 'Готовность', num: true, html: function (r) { return r.p.contract === 'FP' ? r.p.ready + '%' : '-'; } });
        host.appendChild(P.table(cols, rows, { onrow: function (r) { card(M, r); }, rowCls: function (r) { return mon && r.m.marginPlanPct !== null && r.m.marginPlanPct < M.rules.marginMin ? 'psa-row-bad' : ''; }, empty: 'Проектов нет' }));
    }
    function card(M, r) {
        var p = r.p, m = r.m, mon = money(M), body = P.el('div', {});
        var team = M.bookings.filter(function (b) { return b.project === p.name && b.status === 'Подтверждена' && b.to >= P.TODAY; }), byEmp = {};
        team.forEach(function (b) { byEmp[b.emp] = (byEmp[b.emp] || 0) + b.hpw; });
        var monthCost = 0; Object.keys(byEmp).forEach(function (n) { monthCost += byEmp[n] * 4.33 * M.empBy[n].cost; });
        var info = '<div class="psa-kv"><span>Заказчик</span><b>' + P.esc(p.cust) + '</b></div><div class="psa-kv"><span>Срок</span><b>' + C.toDmy(p.from) + ' - ' + C.toDmy(p.to) + '</b></div><div class="psa-kv"><span>Команда сейчас</span><b>' + Object.keys(byEmp).length + ' чел., ' + P.fmt(Object.keys(byEmp).reduce(function (a, k) { return a + byEmp[k]; }, 0)) + ' ч/нед</b></div>';
        if (mon) info += '<div class="psa-kv"><span>Стоимость команды в месяц (занятость x ФОТ)</span><b>' + P.money(monthCost) + '</b></div>' +
            '<div class="psa-kv"><span>Выручка: факт / по плану</span><b>' + P.mln(m.revFact) + ' / ' + P.mln(m.revPlan) + '</b></div><div class="psa-kv"><span>Себестоимость: факт / по плану</span><b>' + P.mln(m.costFact) + ' / ' + P.mln(m.costPlan) + '</b></div>' +
            '<div class="psa-kv"><span>Маржа: факт / прогноз</span><span>' + marginBadge(M, m.marginFactPct) + ' ' + marginBadge(M, m.marginPlanPct) + '</span></div>';
        body.appendChild(P.el('div', { html: info }));
        if (mon && m.marginPlanPct !== null && m.marginPlanPct < M.rules.marginMin) body.appendChild(P.el('div', { 'class': 'psa-warnbox psa-e', text: 'Прогноз маржи ' + String(m.marginPlanPct).replace('.', ',') + '% ниже порога ' + M.rules.marginMin + '%. Часы идут выше бюджета на ' + Math.round(m.overrunPct) + '%: пересмотрите команду или цену этапа.' }));
        body.appendChild(P.el('h2', { text: mon ? 'Маржа по людям (разложение)' : 'Часы по людям' }));
        var cols = [{ t: 'Сотрудник', html: function (x) { return P.esc(x.emp) + '<div class="psa-muted">' + P.esc(x.grade) + '</div>'; } }, { t: 'Часов факт', num: true, html: function (x) { return P.fmt(x.hours); } }];
        if (mon) cols.push({ t: 'Себестоимость', num: true, html: function (x) { return P.money(x.cost); } }, { t: 'Выручка', num: true, html: function (x) { return p.contract === 'T&M' ? P.money(x.rev) : '-'; } }, { t: 'Маржа', num: true, html: function (x) { return p.contract === 'T&M' ? P.money(x.margin) : '-'; } });
        body.appendChild(P.table(cols, m.people.slice(0, 15), { empty: 'Фактических часов пока нет' }));
        if (mon && p.contract !== 'T&M' && p.contract !== 'Внутренний') body.appendChild(P.el('p', { 'class': 'psa-muted', text: 'Для ' + p.contract + ' выручка признаётся по готовности или по абонплате, поэтому маржа считается по проекту целиком, а не по строкам людей.' }));
        P.modal(p.code + ' ' + p.name, body, [{ text: 'Закрыть' }], true);
    }
    P.mount(render);
})();
