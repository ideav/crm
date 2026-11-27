/* BI-сводка: сводка руководителя. Выручка вчера/неделя/месяц к плану, маржа, свежесть источников, главные отклонения; каждая цифра раскрывается до документа. */
(function () {
    'use strict';
    var B = window.Bisys, C = B.core;

    function chart(series, planDay, miss) {
        var W = 760, H = 200, pad = 40, n = series.length, bw = (W - pad) / n - 3;
        var max = Math.max(planDay * 1.3, Math.max.apply(null, series.map(function (x) { return x.v; }))), y = function (v) { return H - 22 - v / max * (H - 40); };
        var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Выручка по дням месяца и дневной план">';
        [0, 0.5, 1].forEach(function (g) { var v = max * g; s += '<line x1="' + pad + '" x2="' + W + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="currentColor" stroke-opacity=".1"/><text x="0" y="' + (y(v) + 4) + '" font-size="10" fill="currentColor" fill-opacity=".55">' + Math.round(v / 1000) + 'К</text>'; });
        series.forEach(function (x, i) {
            var xx = pad + i * ((W - pad) / n) + 1, last = i === n - 1 && !!miss;
            s += '<a href="' + B.esc(B.nav('drill', { from: x.d, to: x.d })) + '"><rect x="' + xx + '" y="' + y(x.v) + '" width="' + bw + '" height="' + Math.max(1, H - 22 - y(x.v)) + '" rx="3" fill="' + (last ? 'var(--b-red)' : 'var(--b-blue)') + '"><title>' + C.toDmy(x.d) + ': ' + B.money(x.v) + (last ? ' (неполный день: ' + miss + ')' : '') + '</title></rect></a>';
            if (i % 3 === 0 || i === n - 1) s += '<text x="' + (xx + bw / 2) + '" y="' + (H - 6) + '" font-size="10" text-anchor="middle" fill="currentColor" fill-opacity=".6">' + C.toShort(x.d) + '</text>';
        });
        s += '<line x1="' + pad + '" x2="' + W + '" y1="' + y(planDay) + '" y2="' + y(planDay) + '" stroke="var(--b-red)" stroke-width="1.5" stroke-dasharray="6 4"/><text x="' + (W - 2) + '" y="' + (y(planDay) - 5) + '" font-size="10" text-anchor="end" fill="var(--b-red)">план в день ' + Math.round(planDay / 1000) + 'К</text>';
        return s + '</svg>';
    }
    function kpi(label, value, sub, kind, href, extra) {
        return B.el('a', { 'class': 'bi-kpi' + (kind ? ' bi-kpi-' + kind : ''), href: href, title: 'Раскрыть до документов' }, [
            B.el('div', { 'class': 'bi-kpi-l', text: label }), B.el('div', { 'class': 'bi-kpi-v', html: value }), sub ? B.el('div', { 'class': 'bi-kpi-s', html: sub }) : null, extra || null]);
    }
    function kindOf(dev, thr) { return dev === null ? '' : dev <= -thr ? 'bad' : dev < 0 ? 'warn' : 'good'; }

    function render(host, M) {
        var subs = M.mySubs, names = {}; subs.forEach(function (s) { names[s.name] = 1; });
        var docs = M.docs.filter(function (d) { return names[d.sub]; }), plans = M.plans.filter(function (p) { return names[p.sub]; });
        var thr = M.thr['Выручка'] || 5;
        var P = { y: C.period('yesterday', B.TODAY), w: C.period('week', B.TODAY), m: C.period('month', B.TODAY) };
        var T = {}, PL = {};
        Object.keys(P).forEach(function (k) { T[k] = C.totals(C.filterDocs(docs, P[k])); PL[k] = C.planFor(plans, P[k].from, P[k].to); });
        host.appendChild(B.el('h1', { text: M.scoped ? 'Сводка: ' + subs.map(function (s) { return s.name; }).join(', ') : 'Сводка руководителя' }));
        host.appendChild(B.el('p', { 'class': 'bi-sub', text: (M.scoped ? 'Вы видите только своё подразделение. ' : 'Сеть «Дом и Лён»: 6 магазинов, интернет-магазин и Ozon. ') + 'Четыре источника сведены в одну выручку: чеки 1С:Розницы, заказы Битрикс24, отправления Ozon, план из Excel. Нажмите на цифру — откроются документы, из которых она сложена.' }));
        host.appendChild(B.freshBar(M));
        var staleSubs = []; M.fresh.stale.forEach(function (s) { subs.forEach(function (x) { if (C.lastDataDay(docs, x.name) && C.lastDataDay(docs, x.name) < P.y.to && C.filterDocs(docs, { sub: x.name, source: s.name }).length) staleSubs.push(x.name); }); });
        var miss = staleSubs.length ? B.el('div', { 'class': 'bi-kpi-miss', text: 'без ' + staleSubs.join(', ') + ': нет данных за ' + C.toDmy(P.y.to) }) : null;
        var dY = C.devPct(T.y.revenue, PL.y.revenue), dW = C.devPct(T.w.revenue, PL.w.revenue), dM = C.devPct(T.m.revenue, PL.m.revenue), dG = C.devPct(T.m.gp, PL.m.gp);
        var fc = C.forecastMonth(T.m.revenue, B.TODAY), planMonth = C.planFor(plans, P.m.from, C.addDays(P.m.from, C.daysInMonth(P.m.from) - 1)).revenue;
        host.appendChild(B.el('div', { 'class': 'bi-kpis' }, [
            kpi('Выручка ' + P.y.label, B.mln(T.y.revenue), 'к плану ' + B.pct(dY, true) + ' · план ' + B.mln(PL.y.revenue), kindOf(dY, thr), B.nav('drill', { p: 'yesterday' }), miss),
            kpi('Выручка за ' + P.w.label, B.mln(T.w.revenue), 'к плану ' + B.pct(dW, true), kindOf(dW, thr), B.nav('drill', { p: 'week' })),
            kpi('Выручка за ' + P.m.label, B.mln(T.m.revenue), 'к плану ' + B.pct(dM, true) + ' · прогноз месяца ' + B.mln(fc) + ' из ' + B.mln(planMonth), kindOf(dM, thr), B.nav('drill', { p: 'month' })),
            kpi('Валовая прибыль за месяц', B.mln(T.m.gp), 'маржа ' + B.pct(T.m.margin) + ' · к плану ' + B.pct(dG, true), kindOf(dG, M.thr['Валовая прибыль'] || 5), B.nav('drill', { p: 'month', m: 'gp' })),
            kpi('Средний чек за месяц', B.money(T.m.avgCheck), T.m.sales + ' продаж, ' + T.m.returns + ' возвратов', '', B.nav('drill', { p: 'month' }))
        ]));
        var pf = C.planFact(subs, docs, plans, P.m.from, P.m.to, M.thr), top = C.topDeviations(pf, M.cards, 3);
        host.appendChild(B.el('h2', { text: 'Главные отклонения месяца' }));
        host.appendChild(top.length ? B.el('div', { 'class': 'bi-devs' }, top.map(function (d) {
            return B.el('a', { 'class': 'bi-dev', href: B.nav('plan', { sub: d.sub, m: d.metric }) }, [
                B.el('div', { 'class': 'bi-dev-v', text: B.pct(d.dev, true) }),
                B.el('div', {}, [B.el('b', { text: d.sub }), B.el('div', { 'class': 'bi-muted', text: d.metric + ': ' + B.mln(d.fact) + ' при плане ' + B.mln(d.plan) + (d.missingFrom ? ' · нет данных с ' + C.toDmy(d.missingFrom) : '') }),
                    B.el('div', { html: d.commented ? B.badge('причина: ' + d.card.comment.slice(0, 70) + (d.card.comment.length > 70 ? '…' : ''), 'ok') : B.badge('нет комментария', 'crit') })])
            ]);
        })) : B.el('p', { 'class': 'bi-muted', text: 'Отклонений больше порога нет.' }));
        var series = C.daily(docs, P.m.from, P.m.to), planDay = C.planFor(plans, P.y.to, P.y.to).revenue;
        host.appendChild(B.el('div', { 'class': 'bi-card' }, [B.el('h3', { text: 'Выручка по дням: ' + P.m.label }), B.el('div', { html: chart(series, planDay, staleSubs.length ? 'нет данных ' + staleSubs.join(', ') : '') }), B.el('div', { 'class': 'bi-muted', text: 'Пунктир — дневной план (месячный план поровну на дни). Красный столбец — день с незагруженным источником. Нажмите на столбец — документы этого дня.' })]));
        if (subs.length > 1) {
            host.appendChild(B.el('h2', { text: 'Подразделения: месяц к плану' }));
            host.appendChild(B.table([
                { t: 'Подразделение', html: function (r) { return '<b>' + B.esc(r.sub) + '</b><div class="bi-muted">' + B.esc(r.type) + (r.missingFrom ? ' · нет данных с ' + C.toDmy(r.missingFrom) : '') + '</div>'; } },
                { t: 'Факт', num: true, html: function (r) { return B.mln(r.fact); } },
                { t: 'План', num: true, html: function (r) { return B.mln(r.plan); } },
                { t: 'К плану', num: true, html: function (r) { return B.badge(B.pct(r.dev, true), kindOf(r.dev, thr) === 'bad' ? 'crit' : kindOf(r.dev, thr) === 'warn' ? 'warn' : 'ok'); } },
                { t: 'Маржа', num: true, html: function (r) { return B.pct(r.margin); } }
            ], pf, { onrow: function (r) { location.href = B.nav('drill', { p: 'month', sub: r.sub }); } }));
        }
    }
    B.mount(render);
})();
