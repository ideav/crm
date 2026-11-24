/* PSA: Дашборд директора. Утилизация факт и прогноз, бенч и его стоимость, пулы, перегрузки, спрос и предложение по навыкам. */
(function () {
    'use strict';
    var P = window.Psa, C = P.core;
    var st = { pool: '' };

    function chart(past, fut, target) {
        var all = past.concat(fut), W = 760, H = 220, pad = 34, bw = (W - pad) / all.length - 4;
        var max = Math.max(100, Math.max.apply(null, all.map(function (x) { return x.v; })) + 5), y = function (v) { return H - 24 - v / max * (H - 44); };
        var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Утилизация по неделям: факт и прогноз">';
        [0, 25, 50, 75, 100].forEach(function (g) { s += '<line x1="' + pad + '" x2="' + W + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="currentColor" stroke-opacity=".12"/><text x="0" y="' + (y(g) + 4) + '" font-size="10" fill="currentColor" fill-opacity=".55">' + g + '%</text>'; });
        all.forEach(function (x, i) {
            var xx = pad + i * ((W - pad) / all.length) + 2, isF = i >= past.length;
            s += '<rect x="' + xx + '" y="' + y(x.v) + '" width="' + bw + '" height="' + (H - 24 - y(x.v)) + '" rx="3" fill="' + (isF ? 'rgba(37,99,235,.28)' : '#2563eb') + '"' + (isF ? ' stroke="#2563eb" stroke-dasharray="3 2"' : '') + '><title>' + C.toShort(x.w) + ': ' + x.v + '%' + (isF ? ' (прогноз по броням)' : ' (факт)') + '</title></rect>';
            if (i % 2 === 0 || all.length < 12) s += '<text x="' + (xx + bw / 2) + '" y="' + (H - 8) + '" font-size="9" text-anchor="middle" fill="currentColor" fill-opacity=".6">' + C.toShort(x.w) + '</text>';
        });
        s += '<line x1="' + pad + '" x2="' + W + '" y1="' + y(target) + '" y2="' + y(target) + '" stroke="#d97706" stroke-width="1.5" stroke-dasharray="6 4"/><text x="' + (W - 2) + '" y="' + (y(target) - 4) + '" font-size="10" text-anchor="end" fill="#d97706">цель ' + target + '%</text>';
        return s + '</svg>';
    }
    function render(host, M) {
        host.innerHTML = '';
        var emps = M.emps.filter(function (e) { return !st.pool || e.pool === st.pool; });
        var projs = M.projects;
        var pastW = C.weeksBetween(C.addDays(P.LAST_FACT_WEEK, -9 * 7), P.LAST_FACT_WEEK), futW = C.weeksFrom(P.TODAY, 8);
        var past = pastW.map(function (w) { return { w: w, v: C.utilization(emps, [w], M.ts, projs, M.hol, M.abs).billablePct }; });
        var fut = futW.map(function (w) {
            var plan = 0, cap = 0;
            emps.forEach(function (e) { var l = C.loadWeek(e, w, M.bookings, M.hol, M.abs[e.name] || [], { pending: false }); cap += l.cap; l.items.forEach(function (i) { if (P.billable(M, i.project)) plan += i.hours; }); });
            return { w: w, v: cap ? C.round1(plan / cap * 100) : 0 };
        });
        var u4 = C.utilization(emps, pastW.slice(-4), M.ts, projs, M.hol, M.abs);
        var b = C.bench(emps, C.weekStart(P.TODAY), M.bookings, M.hol, M.abs);
        var b4 = C.bench(emps, C.addDays(C.weekStart(P.TODAY), 7 * 10), M.bookings, M.hol, M.abs);
        var over = []; emps.forEach(function (e) { var o = C.overloadWeeks(e, P.weeks(), M.bookings, M.hol, M.abs[e.name] || [], M.rules); if (o.length) over.push({ e: e, o: o, max: Math.max.apply(null, o.map(function (x) { return x.pct; })) }); });
        over.sort(function (a, b) { return b.max - a.max; });
        var mon = M.canCost && M.canPrice;
        var proj = mon ? projs.filter(function (p) { return p.contract !== 'Внутренний'; }).map(function (p) { return { p: p, m: C.projectMargin(p, M.emps, M.rates, M.ts, M.bookings, M.hol, P.TODAY) }; }) : [];
        var risky = proj.filter(function (r) { return r.m.marginPlanPct !== null && r.m.marginPlanPct < M.rules.marginMin; });
        var unsent = M.ts.filter(function (t) { return t.status === 'Не сдан'; }).length;
        var queue = M.reqs.filter(function (r) { return r.status !== 'Закрыт'; });
        host.appendChild(P.el('h1', { text: 'Дашборд директора: утилизация' }));
        host.appendChild(P.el('p', { 'class': 'psa-sub', text: 'Деньги, которые лежат в бенче, и проекты, которые их не зарабатывают. Утилизация считается как оплачиваемые часы из таймшитов к ёмкости по календарю; справа от факта прогноз по подтверждённым броням.' }));
        var sel = P.select([['', 'Вся компания']].concat(M.pools.map(function (p) { return [p.name, p.name]; })), st.pool); sel.onchange = function () { st.pool = sel.value; render(host, M); };
        host.appendChild(P.el('div', { 'class': 'psa-bar' }, [P.field('Подразделение', sel)]));
        var k = [
            P.kpi('Утилизация оплачиваемая (4 нед.)', Math.round(u4.billablePct) + '%', 'цель ' + M.rules.utilTarget + '%, общая ' + Math.round(u4.totalPct) + '%', u4.billablePct < M.rules.utilTarget ? 'warn' : 'good'),
            P.kpi('Бенч сейчас', C.round1(b.fte) + ' FTE', mon ? 'стоит ' + P.money(b.cost * 4.33) + ' в месяц' : b.people.length + ' чел. загружены менее чем на 50%', b.fte > 6 ? 'bad' : ''),
            P.kpi('Бенч через 10 недель', C.round1(b4.fte) + ' FTE', 'если не закроем запросы', b4.fte > b.fte ? 'warn' : '')
        ];
        if (mon) k.push(P.kpi('Проекты ниже порога маржи', String(risky.length), risky.length ? risky.map(function (r) { return r.p.code; }).join(', ') : 'все выше ' + M.rules.marginMin + '%', risky.length ? 'bad' : 'good'));
        k.push(P.kpi('Перегружены', String(over.length), 'человек на горизонте 14 недель', over.length ? 'bad' : 'good'), P.kpi('Несданные таймшиты', String(unsent), 'искажают утилизацию', unsent ? 'warn' : 'good'));
        host.appendChild(P.el('div', { 'class': 'psa-kpis' }, k));
        host.appendChild(P.el('div', { 'class': 'psa-card' }, [P.el('h3', { text: 'Оплачиваемая утилизация по неделям: 10 недель факта и 8 недель прогноза' }), P.el('div', { html: chart(past, fut, M.rules.utilTarget) })]));
        // пулы
        host.appendChild(P.el('h2', { text: 'Утилизация по пулам' }));
        var prow = M.pools.map(function (pl) {
            var es = M.emps.filter(function (e) { return e.pool === pl.name; });
            var u = C.utilization(es, pastW.slice(-4), M.ts, projs, M.hol, M.abs);
            var plan = 0, cap = 0; C.weeksFrom(P.TODAY, 4).forEach(function (w) { es.forEach(function (e) { var l = C.loadWeek(e, w, M.bookings, M.hol, M.abs[e.name] || [], { pending: false }); plan += l.plan; cap += l.cap; }); });
            var bb = C.bench(es, C.weekStart(P.TODAY), M.bookings, M.hol, M.abs);
            return { pl: pl, n: es.length, u: u, next: cap ? Math.round(plan / cap * 100) : 0, bench: bb.fte };
        });
        host.appendChild(P.table([
            { t: 'Пул', html: function (r) { return '<b>' + P.esc(r.pl.name) + '</b><div class="psa-muted">' + r.n + ' чел., ' + P.esc(r.pl.head) + '</div>'; } },
            { t: 'Утилизация оплачиваемая', html: function (r) { return '<div class="psa-bar-track"><div class="psa-bar-fill ' + (r.u.billablePct >= M.rules.utilTarget ? 'psa-g' : r.u.billablePct >= M.rules.utilTarget - 10 ? 'psa-a' : 'psa-r') + '" style="width:' + Math.min(100, r.u.billablePct) + '%"></div></div><div class="psa-muted">' + Math.round(r.u.billablePct) + '% (общая ' + Math.round(r.u.totalPct) + '%)</div>'; } },
            { t: 'План на 4 недели', num: true, html: function (r) { return r.next + '%'; } },
            { t: 'Бенч, FTE', num: true, html: function (r) { return String(C.round1(r.bench)); } }
        ], prow, { onrow: function (r) { location.href = P.nav('load'); } }));
        // две колонки
        var two = P.el('div', { 'class': 'psa-two' });
        var left = P.el('div', {}), right = P.el('div', {});
        left.appendChild(P.el('h2', { text: 'Перегрузки: кого разгрузить в первую очередь' }));
        left.appendChild(P.table([{ t: 'Сотрудник', html: function (r) { return '<b>' + P.esc(r.e.name) + '</b><div class="psa-muted">' + P.esc(r.e.pool) + ', ' + P.esc(r.e.grade) + '</div>'; } }, { t: 'Пик', num: true, html: function (r) { return P.badge(Math.round(r.max) + '%', 'crit'); } }, { t: 'Недель выше 100%', num: true, html: function (r) { return String(r.o.length); } }], over.slice(0, 8), { empty: 'Перегрузок нет', onrow: function () { location.href = P.nav('load'); } }));
        var free = []; emps.forEach(function (e) { var l = C.loadWeek(e, C.addDays(C.weekStart(P.TODAY), 14), M.bookings, M.hol, M.abs[e.name] || [], { pending: false }); if (l.cap > 0 && l.pct < 50) free.push({ e: e, free: l.free }); });
        free.sort(function (a, b) { return b.free - a.free; });
        right.appendChild(P.el('h2', { text: 'Свободные через 2 недели' }));
        right.appendChild(P.table([{ t: 'Сотрудник', html: function (r) { return '<b>' + P.esc(r.e.name) + '</b><div class="psa-muted">' + P.esc(r.e.pool) + ', ' + P.esc(r.e.grade) + '</div>'; } }, { t: 'Свободно, ч', num: true, html: function (r) { return String(C.round1(r.free)); } }].concat(mon ? [{ t: 'Бенч в месяц', num: true, html: function (r) { return P.money(r.free * 4.33 * r.e.cost); } }] : []), free.slice(0, 8), { empty: 'Свободных нет', onrow: function () { location.href = P.nav('finder'); } }));
        two.appendChild(left); two.appendChild(right); host.appendChild(two);
        // спрос и предложение
        host.appendChild(P.el('h2', { text: 'Спрос и предложение по открытым запросам' }));
        var sd = queue.map(function (r) {
            var res = C.findCandidates(M.emps, M.skills, M.bookings, M.hol, M.abs, { skill: r.skill, minLevel: r.minLevel, minGrade: r.minGrade, from: r.from, to: r.to, hpw: r.hpw });
            var fit = res.filter(function (x) { return x.fits; }).length;
            return { r: r, fit: fit, any: res.length };
        });
        host.appendChild(P.table([{ t: 'Запрос', html: function (x) { return '<b>' + P.esc(x.r.code) + '</b> ' + P.esc(x.r.role) + '<div class="psa-muted">' + P.esc(x.r.project) + '</div>'; } }, { t: 'Нужно', html: function (x) { return x.r.hpw + ' ч/нед с ' + C.toShort(x.r.from); } }, { t: 'Приоритет', html: function (x) { return P.badge(x.r.priority, x.r.priority === 'Высокий' ? 'crit' : x.r.priority === 'Средний' ? 'warn' : 'mute'); } },
            { t: 'Внутри компании', html: function (x) { return x.fit ? P.badge('есть ' + x.fit + ' свободных', 'ok') : x.any ? P.badge('нет полностью свободных', 'warn') : P.badge('дефицит навыка: найм или подрядчик', 'crit'); } }], sd, { empty: 'Открытых запросов нет', onrow: function (x) { location.href = P.nav('finder', 'req=' + encodeURIComponent(x.r.code)); } }));
    }
    P.mount(render);
})();
