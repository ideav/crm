/* PSA: Таймшиты. Факт часов из таймшитов против плана из броней: по сотрудникам, проектам и несданные. */
(function () {
    'use strict';
    var P = window.Psa, C = P.core;
    var st = { tab: 'emps', weeks: 4, pool: '', project: '' };

    function tabs(M) { return [['emps', 'По сотрудникам'], ['projects', 'По проектам'], ['unsent', 'Несданные (' + unsent(M).length + ')']]; }
    function unsent(M) { return M.ts.filter(function (t) { return t.status === 'Не сдан'; }); }
    function periodWeeks() { var w = C.weeksBetween(C.addDays(P.LAST_FACT_WEEK, -7 * (st.weeks - 1)), P.LAST_FACT_WEEK); return w; }
    function pct(a, b) { return b ? Math.round((a / b - 1) * 100) : 0; }

    function empRows(M, weeks) {
        var inW = {}; weeks.forEach(function (w) { inW[w] = 1; });
        var rows = M.emps.filter(function (e) { return !st.pool || e.pool === st.pool; }).map(function (e) {
            var plan = 0, fact = 0, cap = 0, byProj = {};
            weeks.forEach(function (w) { var pf = C.planFact(e, w, st.project ? M.bookings.filter(function (b) { return b.project === st.project; }) : M.bookings, st.project ? M.ts.filter(function (t) { return t.project === st.project; }) : M.ts, M.hol); plan += pf.plan; fact += pf.fact; cap += C.capacityWeek(e, w, M.hol, M.abs[e.name] || []).cap; });
            M.ts.forEach(function (t) { if (t.emp === e.name && inW[t.week] && (!st.project || t.project === st.project)) byProj[t.project] = (byProj[t.project] || 0) + t.hours; });
            return { e: e, plan: C.round1(plan), fact: C.round1(fact), cap: C.round1(cap), diff: C.round1(fact - plan), dpct: pct(fact, plan), byProj: byProj };
        }).filter(function (r) { return r.plan > 0 || r.fact > 0; });
        return rows.sort(function (a, b) { return Math.abs(b.diff) - Math.abs(a.diff); });
    }
    function bar(v, max, cls) { return '<div class="psa-bar-track"><div class="psa-bar-fill ' + (cls || '') + '" style="width:' + Math.min(100, max ? v / max * 100 : 0) + '%"></div></div>'; }

    function render(host, M) {
        host.innerHTML = '';
        var weeks = periodWeeks();
        var rows = empRows(M, weeks);
        var plan = 0, fact = 0, over = 0, under = 0;
        rows.forEach(function (r) { plan += r.plan; fact += r.fact; if (r.dpct > M.rules.tolerance) over++; if (r.dpct < -M.rules.tolerance) under++; });
        host.appendChild(P.el('h1', { text: 'Таймшиты: факт против плана' }));
        host.appendChild(P.el('p', { 'class': 'psa-sub', text: 'План берётся из подтверждённых броней, факт из таймшитов за ' + weeks.length + ' нед. Расхождение выше допуска ' + M.rules.tolerance + '% подсвечено: это недосписанные часы (потерянная выручка по T&M) и перерасход по проектам.' }));
        host.appendChild(P.el('div', { 'class': 'psa-kpis' }, [
            P.kpi('Факт, часов', P.fmt(fact), 'план ' + P.fmt(plan), ''),
            P.kpi('Отклонение факта от плана', (pct(fact, plan) > 0 ? '+' : '') + pct(fact, plan) + '%', 'точность прогноза загрузки ' + (100 - Math.abs(pct(fact, plan))) + '%', Math.abs(pct(fact, plan)) > M.rules.tolerance ? 'bad' : 'good'),
            P.kpi('Списывают больше плана', String(over), 'сотрудников выше допуска', over ? 'warn' : ''),
            P.kpi('Списывают меньше плана', String(under), 'недосписанные часы', under ? 'warn' : ''),
            P.kpi('Несданных таймшитов', String(unsent(M).length), 'на прошлой неделе', unsent(M).length ? 'bad' : 'good')
        ]));
        var wsel = P.select([['2', '2 недели'], ['4', '4 недели'], ['8', '8 недель'], ['12', '12 недель']], String(st.weeks));
        var psel = P.select([['', 'Все пулы']].concat(M.pools.map(function (p) { return [p.name, p.name]; })), st.pool);
        var jsel = P.select([['', 'Все проекты']].concat(M.projects.filter(function (p) { return p.contract !== 'Внутренний'; }).map(function (p) { return [p.name, p.name]; })), st.project);
        function redraw() { st.weeks = +wsel.value; st.pool = psel.value; st.project = jsel.value; render(host, M); }
        [wsel, psel, jsel].forEach(function (c) { c.addEventListener('change', redraw); });
        host.appendChild(P.el('div', { 'class': 'psa-bar' }, [P.field('Период', wsel), P.field('Пул', psel), P.field('Проект', jsel), P.el('span', { 'class': 'psa-grow' }), P.btn('Выгрузить CSV', function () {
            P.download('psa-timesheets.csv', C.toCsv(rows.map(function (r) { return { n: r.e.name, p: r.e.pool, pl: r.plan, f: r.fact, d: r.diff, pc: r.dpct }; }), [['n', 'Сотрудник'], ['p', 'Пул'], ['pl', 'План, ч'], ['f', 'Факт, ч'], ['d', 'Разница, ч'], ['pc', 'Разница, %']]));
        })]));
        host.appendChild(P.tabs(tabs(M), st.tab, function (t) { st.tab = t; render(host, M); }));
        if (st.tab === 'emps') {
            var max = Math.max.apply(null, rows.map(function (r) { return Math.max(r.plan, r.fact); }).concat([1]));
            host.appendChild(P.table([
                { t: 'Сотрудник', html: function (r) { return '<b>' + P.esc(r.e.name) + '</b><div class="psa-muted">' + P.esc(r.e.pool) + ', ' + P.esc(r.e.grade) + '</div>'; } },
                { t: 'План, ч', num: true, html: function (r) { return P.fmt(r.plan); } },
                { t: 'Факт, ч', num: true, html: function (r) { return P.fmt(r.fact); } },
                { t: 'План / факт', html: function (r) { return bar(r.plan, max) + '<div style="height:3px"></div>' + bar(r.fact, max, Math.abs(r.dpct) > M.rules.tolerance ? (r.dpct > 0 ? 'psa-r' : 'psa-a') : 'psa-g'); } },
                { t: 'Разница', num: true, html: function (r) { return '<span class="psa-badge psa-' + (Math.abs(r.dpct) > M.rules.tolerance ? (r.dpct > 0 ? 'crit' : 'warn') : 'ok') + '">' + (r.diff > 0 ? '+' : '') + P.fmt(r.diff, 1) + ' ч, ' + (r.dpct > 0 ? '+' : '') + r.dpct + '%</span>'; } },
                { t: 'Ёмкость, ч', num: true, html: function (r) { return P.fmt(r.cap); } }
            ], rows, { onrow: function (r) { empModal(M, r.e, weeks); }, rowCls: function (r) { return Math.abs(r.dpct) > M.rules.tolerance * 1.6 ? 'psa-row-warn' : ''; }, empty: 'Нет данных за период' }));
        } else if (st.tab === 'projects') projectsTab(host, M, weeks);
        else unsentTab(host, M);
    }
    function projectsTab(host, M, weeks) {
        var inW = {}; weeks.forEach(function (w) { inW[w] = 1; });
        var rows = M.projects.filter(function (p) { return !st.project || p.name === st.project; }).map(function (p) {
            var fact = 0, plan = 0, total = 0;
            M.ts.forEach(function (t) { if (t.project === p.name) { total += t.hours; if (inW[t.week]) fact += t.hours; } });
            M.emps.forEach(function (e) { if (st.pool && e.pool !== st.pool) return; weeks.forEach(function (w) { plan += C.planFact(e, w, M.bookings.filter(function (b) { return b.project === p.name; }), [], M.hol).plan; }); });
            return { p: p, plan: C.round1(plan), fact: C.round1(fact), total: C.round1(total), dpct: pct(fact, plan) };
        }).filter(function (r) { return r.plan > 0 || r.fact > 0; }).sort(function (a, b) { return b.fact - a.fact; });
        host.appendChild(P.table([
            { t: 'Проект', html: function (r) { return '<b>' + P.esc(r.p.name) + '</b><div class="psa-muted">' + P.esc(r.p.code) + ', ' + P.esc(r.p.contract) + '</div>'; } },
            { t: 'План, ч', num: true, html: function (r) { return P.fmt(r.plan); } }, { t: 'Факт, ч', num: true, html: function (r) { return P.fmt(r.fact); } },
            { t: 'Разница', num: true, html: function (r) { return '<span class="psa-badge psa-' + (Math.abs(r.dpct) > M.rules.tolerance ? (r.dpct > 0 ? 'crit' : 'warn') : 'ok') + '">' + (r.dpct > 0 ? '+' : '') + r.dpct + '%</span>'; } },
            { t: 'Освоение бюджета часов', html: function (r) { var u = r.p.budgetHours ? r.total / r.p.budgetHours * 100 : 0; return bar(r.total, r.p.budgetHours || 1, u > 100 ? 'psa-r' : u > 80 ? 'psa-a' : '') + '<div class="psa-muted">' + P.fmt(r.total) + ' из ' + P.fmt(r.p.budgetHours) + ' ч (' + Math.round(u) + '%)</div>'; } }
        ], rows, { empty: 'Нет данных' }));
    }
    function unsentTab(host, M) {
        var rows = unsent(M).map(function (t) { var e = M.empBy[t.emp]; return { emp: t.emp, pool: e ? e.pool : '', project: t.project, week: C.toShort(t.week), head: e ? P.headOf(M, e) : '' }; });
        host.appendChild(P.table([{ t: 'Сотрудник', k: 'emp' }, { t: 'Пул', k: 'pool' }, { t: 'Проект', k: 'project' }, { t: 'Неделя с', k: 'week' }, { t: 'Кому напомнить', k: 'head' }], rows, { empty: 'Все таймшиты сданы' }));
        host.appendChild(P.el('p', { 'class': 'psa-muted', text: 'Таймшиты закрываются до 3-го числа: после этого часы идут в акты T&M и расчёт маржи.' }));
    }
    function empModal(M, e, weeks) {
        var rows = weeks.map(function (w) { var pf = C.planFact(e, w, M.bookings, M.ts, M.hol); return { w: w, pf: pf, cap: C.capacityWeek(e, w, M.hol, M.abs[e.name] || []).cap }; });
        var max = Math.max.apply(null, rows.map(function (r) { return Math.max(r.pf.plan, r.pf.fact, r.cap); }).concat([1]));
        var body = P.el('div', {});
        body.appendChild(P.table([{ t: 'Неделя с', html: function (r) { return C.toShort(r.w); } }, { t: 'Ёмкость', num: true, html: function (r) { return P.fmt(r.cap, 1); } }, { t: 'План', num: true, html: function (r) { return P.fmt(r.pf.plan, 1); } }, { t: 'Факт', num: true, html: function (r) { return P.fmt(r.pf.fact, 1); } }, { t: '', html: function (r) { return bar(r.pf.plan, max) + '<div style="height:3px"></div>' + bar(r.pf.fact, max, r.pf.fact > r.pf.plan * (1 + M.rules.tolerance / 100) ? 'psa-r' : 'psa-g'); } }], rows));
        var pr = {}; M.ts.forEach(function (t) { if (t.emp === e.name && weeks.indexOf(t.week) >= 0) pr[t.project] = (pr[t.project] || 0) + t.hours; });
        body.appendChild(P.el('p', { html: Object.keys(pr).map(function (k) { return '<span class="psa-chip">' + P.esc(k) + ': ' + P.fmt(pr[k], 1) + ' ч</span>'; }).join('') }));
        P.modal(e.name + ': план и факт по неделям', body, [{ text: 'Закрыть' }], true);
    }
    P.mount(render);
})();
