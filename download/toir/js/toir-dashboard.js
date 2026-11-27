/* ТОиР: показатели главного механика — аварийные простои, простои из-за запчастей, дефекты и ППР в срок. */
(function () {
    'use strict';
    var T = window.Toir, C = T.core, el = T.el;
    var MONTHS = [['2026-09', 'Сентябрь'], ['2026-10', 'Октябрь'], ['2026-11', 'Ноябрь']];
    T.mount(function (h, M) {
        h.appendChild(el('div', {}, T.head('Показатели ТОиР', 'Сентябрь–ноябрь 2026, ноябрь — по ' + C.ru(T.TODAY) + '. Простои, дефекты и ППР считаются по записям обходов, дефектов и нарядов — без ручной сводки.')));
        var bm = C.downtimeByMonth(M.downs), g = function (m, c) { return (bm[m] || {})[c] || 0; };
        var nov = M.downs.filter(function (d) { return C.month(d.date) === '2026-11'; });
        var lossA = C.downtimeCost(nov, M.eqCost, 'Авария'), lossP = C.downtimeCost(nov, M.eqCost, 'Нет запчасти');
        var since = '2026-09-01';
        var defOT = C.onTime(M.defects.filter(function (d) { return d.done && d.done >= since; }).map(function (d) { return { due: d.due, done: d.done }; }));
        var pprOT = C.onTime(M.orders.filter(function (o) { return o.ppr && o.done && o.done >= since; }).map(function (o) { return { due: o.plan, done: o.done }; }));
        var r30 = M.rounds.filter(function (r) { return r.date < T.TODAY && r.date >= C.addDays(T.TODAY, -30) && r.status !== 'Назначен'; });
        var rDone = r30.filter(function (r) { return r.status === 'Выполнен'; }).length;
        var missed = C.missedWarnings(M.downs, M.marks, M.defects);
        var free = C.remarksWithoutDefect(M.marks.filter(function (m) { return m.date >= C.addDays(T.TODAY, -30); }), M.defects);
        var trendA = g('2026-11', 'Авария') - g('2026-10', 'Авария');
        h.appendChild(el('div', { 'class': 'toir-kpis' }, [
            T.kpi('аварийные простои, ноябрь', T.h(g('2026-11', 'Авария')), (trendA >= 0 ? '+' : '') + T.fmt(trendA, 1) + ' ч к октябрю · потери ' + T.money(lossA), trendA > 0 ? 'bad' : 'good'),
            T.kpi('простой из-за запчастей, ноябрь', T.h(g('2026-11', 'Нет запчасти')), 'потери ' + T.money(lossP), g('2026-11', 'Нет запчасти') ? 'bad' : 'good'),
            T.kpi('дефекты закрыты в срок', defOT.pct === null ? '—' : defOT.pct + '%', defOT.ok + ' из ' + defOT.n + ' с сентября', defOT.pct < 80 ? 'warn' : 'good'),
            T.kpi('ППР в срок', pprOT.pct === null ? '—' : pprOT.pct + '%', pprOT.ok + ' из ' + pprOT.n + ' нарядов ППР', pprOT.pct < 90 ? 'warn' : 'good'),
            T.kpi('обходы выполнены, 30 дней', r30.length ? Math.round(rDone / r30.length * 100) + '%' : '—', rDone + ' из ' + r30.length),
            T.kpi('замечаний без дефекта', String(free.length), 'за 30 дней', free.length ? 'warn' : 'good')]));
        var max = Math.max.apply(null, MONTHS.map(function (m) { return g(m[0], 'Авария') + g(m[0], 'Нет запчасти') + g(m[0], 'Плановый ремонт'); }).concat([1]));
        var px = function (v) { return Math.round(v / max * 140) + 'px'; };
        h.appendChild(el('div', { 'class': 'toir-card' }, [el('h3', { text: 'Простои по месяцам, ч' }),
            el('div', { 'class': 'toir-bars', role: 'img', 'aria-label': 'простои по месяцам' }, MONTHS.map(function (m) {
                var a = g(m[0], 'Авария'), p = g(m[0], 'Нет запчасти'), pl = g(m[0], 'Плановый ремонт');
                return el('div', { 'class': 'toir-barcol', title: m[1] + ': авария ' + a + ' ч, запчасти ' + p + ' ч, плановые ' + pl + ' ч' }, [
                    el('b', { text: T.fmt(a + p, 1) + ' ч' }),
                    el('div', { 'class': 'toir-barstack' }, [el('div', { 'class': 'toir-bar-a', style: 'height:' + px(a) }), el('div', { 'class': 'toir-bar-p', style: 'height:' + px(p) }), el('div', { 'class': 'toir-bar-pl', style: 'height:' + px(pl) })]),
                    el('span', { 'class': 'toir-muted', text: m[1] })]);
            })),
            el('div', { 'class': 'toir-legend', html: '<span><i class="toir-bar-a"></i>авария</span><span><i class="toir-bar-p"></i>нет запчасти</span><span><i class="toir-bar-pl"></i>плановый ремонт (не в итоге)</span>' })]));
        if (missed.length) h.appendChild(el('div', { 'class': 'toir-card toir-card-bad' }, [el('h3', { text: 'Аварии, о которых предупреждал обход' }),
            T.table([{ t: 'Авария', html: function (x) { return C.ru(x.down.date) + ' · ' + T.h(x.down.hours) + '<br><small class="toir-muted">' + T.esc(x.down.note) + '</small>'; } },
                { t: 'Узел', node: function (x) { return T.eqLink(M, x.down.eq); } },
                { t: 'Замечание обхода', html: function (x) { return C.ru(x.mark.date) + ', ' + T.esc(x.mark.walker) + ': «' + T.esc(x.mark.note || x.mark.item) + '»<br><small class="toir-red">за ' + x.days + ' дн. до аварии, дефект не заведён</small>'; } },
                { t: 'Потери', num: true, html: function (x) { return T.money(x.down.hours * (M.eqCost[x.down.eq] || 0)); } }], missed, { cls: 'toir-stack' }),
            el('p', { 'class': 'toir-muted', text: 'Теперь замечание с телефона сразу становится дефектом со сроком, а ведомость на останов показывает замечания, которые ещё не взяты в работу.' })]));
        var byEq = {}; M.downs.filter(function (d) { return d.cause !== 'Плановый ремонт'; }).forEach(function (d) { var x = byEq[d.eq] = byEq[d.eq] || { eq: d.eq, a: 0, p: 0, n: 0 }; x.n++; if (d.cause === 'Авария') x.a += d.hours; else x.p += d.hours; });
        h.appendChild(el('h2', { text: 'Внеплановые простои по узлам с сентября' }));
        h.appendChild(T.table([{ t: 'Узел', node: function (x) { return T.eqLink(M, x.eq); } }, { t: 'Случаев', num: true, k: 'n' }, { t: 'Авария', num: true, html: function (x) { return T.h(x.a); } }, { t: 'Нет запчасти', num: true, html: function (x) { return x.p ? '<span class="toir-red">' + T.h(x.p) + '</span>' : '—'; } }, { t: 'Потери', num: true, html: function (x) { return T.money((x.a + x.p) * (M.eqCost[x.eq] || 0)); } }],
            Object.keys(byEq).map(function (k) { return byEq[k]; }).sort(function (a, b) { return (b.a + b.p) - (a.a + a.p); }), { cls: 'toir-stack' }));
        h.appendChild(el('h2', { text: 'Журнал простоев' }));
        h.appendChild(T.table([{ k: 'name', t: '№' }, { t: 'Дата', html: function (d) { return C.ru(d.date); } }, { t: 'Узел', node: function (d) { return T.eqLink(M, d.eq); } }, { t: 'Причина', html: function (d) { return T.badge(d.cause, d.cause === 'Авария' ? 'crit' : d.cause === 'Нет запчасти' ? 'warn' : 'info'); } }, { t: 'Часов', num: true, html: function (d) { return T.fmt(d.hours, 1); } }, { k: 'note', t: 'Комментарий' }],
            M.downs.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }), { cls: 'toir-stack' }));
    });
})();
