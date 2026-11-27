/* SRM: Сводка директора. Траты у поставщика по всем заводам, экономия по единой методике, дробление под порог, доля конкурентных закупок, цикл заявка - договор. */
(function () {
    'use strict';
    var P = window.Srm, C = P.core;
    var st = { base: 'budget', sup: 'ООО «Металлобаза Восток»' };

    function enrich(M) {
        return M.contracts.map(function (c) {
            var offers = P.offersOf(M, c.req), first = offers.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; })[0];
            var last = P.lastPrice(M, c.nom, c.date);
            return Object.assign({}, c, { firstOffer: first ? C.normalizeOffer(first, c.qty, M.rules).total : 0, lastPrice: last ? last.price : 0, offers: offers.length, cycle: C.cycleDays(c.reqDate, c.date) });
        });
    }
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('h1', { text: 'Сводка директора по закупкам' }));
        host.appendChild(P.el('p', { 'class': 'srm-sub', text: 'Цифры для совета по кнопке: сколько потрачено у поставщика по всем заводам, экономия по одной формуле для всех закупщиков, закупки, раздробленные под порог комиссии.' }));
        var cs = enrich(M), total = cs.reduce(function (x, c) { return x + c.sum; }, 0);
        var comp = cs.filter(function (c) { return c.offers >= 2; }), cyc = cs.filter(function (c) { return c.cycle !== null; });
        var limit = (M.thresholds.filter(function (t) { return /комисси/i.test(t.steps); })[0] || { from: 3000000 }).from;
        var splits = C.detectSplitting(M.reqs.filter(function (q) { return q.stage !== 'Отменена'; }).map(function (q) { var c = cs.filter(function (x) { return x.req === q.num; })[0]; return { id: q.num, plant: q.plant, nom: q.nom, date: q.date, amount: c ? c.sum : q.budget }; }), limit, M.rules);
        var sav = C.savingTotal(cs, st.base);
        host.appendChild(P.el('div', { 'class': 'srm-kpis' }, [
            P.kpi('Закуплено в 2026', P.mln(total), cs.length + ' договоров, 4 завода'),
            P.kpi('Экономия ' + C.SAVING_BASES[st.base], sav.pct === null ? '-' : String(sav.pct).replace('.', ',') + '%', P.money(sav.amount), sav.amount >= 0 ? 'good' : 'bad'),
            P.kpi('Конкурентные закупки', Math.round(comp.length / (cs.length || 1) * 100) + '%', (cs.length - comp.length) + ' договоров с одним КП', comp.length / (cs.length || 1) < 0.8 ? 'warn' : 'good'),
            P.kpi('Цикл заявка - договор', cyc.length ? Math.round(cyc.reduce(function (x, c) { return x + c.cycle; }, 0) / cyc.length) + ' дн.' : '-', 'в среднем по договорам 2026'),
            P.kpi('Похоже на дробление', String(splits.length), splits.length ? P.money(splits[0].sum) + ' мимо комиссии' : 'не найдено', splits.length ? 'bad' : 'good')
        ]));
        var bases = P.el('div', { 'class': 'srm-bar' }, [P.el('span', { 'class': 'srm-muted', text: 'База экономии (единая для всех):' }), P.tabs(Object.keys(C.SAVING_BASES).map(function (k) { return [k, C.SAVING_BASES[k]]; }), st.base, function (b) { st.base = b; render(host, M); })]);
        host.appendChild(bases);
        if (splits.length) {
            host.appendChild(P.el('h2', { text: 'Дробление под порог комиссии ' + P.money(limit) }));
            splits.forEach(function (g) {
                host.appendChild(P.el('div', { 'class': 'srm-card srm-bad', style: 'margin-bottom:10px' }, [P.el('b', { text: g.plant + ': ' + g.nom }), P.el('p', { text: g.items.length + ' заявки за ' + g.days + ' дн., каждая ниже порога, вместе ' + P.money(g.sum) + '. Комиссия не собиралась: ' + g.items.map(function (i) { return i.id + ' (' + P.money(i.amount) + ', ' + P.d(i.date) + ')'; }).join('; ') + '.' })]));
            });
        }
        var sups = C.spendBy(cs, 'supplier');
        var two = P.el('div', { 'class': 'srm-two' }), l = P.el('div', {}), r = P.el('div', {});
        l.appendChild(P.el('h2', { text: 'Траты по поставщикам, все заводы' }));
        l.appendChild(P.table([{ t: 'Поставщик', html: function (x) { return P.light(M, x.key) + ' ' + P.esc(x.key); } }, { t: 'Сумма', num: true, html: function (x) { return P.money(x.sum); } }, { t: 'Доля', num: true, html: function (x) { return '<div class="srm-bar-track"><div class="srm-bar-fill" style="width:' + Math.min(100, x.share * 2) + '%"></div></div>' + String(x.share).replace('.', ',') + '%'; } }], sups.slice(0, 10), { onrow: function (x) { st.sup = x.key; render(host, M); }, rowCls: function (x) { return x.key === st.sup ? 'srm-row-sel' : ''; } }));
        var m = C.spendMatrix(cs, st.sup), cats = C.spendBy(cs.filter(function (c) { return c.cat === ((M.supBy[st.sup] || {}).cats || [])[0]; }), 'supplier').filter(function (x) { return x.key === st.sup; })[0];
        r.appendChild(P.el('h2', { text: 'Потрачено у ' + st.sup }));
        r.appendChild(P.el('p', { html: '<b>' + P.money(m.total) + '</b> за 2026 по ' + m.count + ' договорам' + (cats ? '; доля в категории ' + P.esc((M.supBy[st.sup] || {}).cats[0]) + ': <b>' + String(cats.share).replace('.', ',') + '%</b>' + (cats.share > 40 ? ' ' + P.badge('зависимость от поставщика', 'warn') : '') : '') }));
        r.appendChild(P.table([{ t: 'Завод', k: 'key' }, { t: 'Сумма', num: true, html: function (x) { return P.money(x.sum); } }, { t: 'Доля', num: true, html: function (x) { return x.share + '%'; } }], m.byPlant));
        two.appendChild(l); two.appendChild(r); host.appendChild(two);
        host.appendChild(P.el('h2', { text: 'Экономия по договорам ' + C.SAVING_BASES[st.base] }));
        host.appendChild(P.table([
            { t: 'Договор', html: function (c) { return '<b>' + P.esc(c.num) + '</b><div class="srm-muted">' + P.d(c.date) + ', ' + P.esc(c.plant) + '</div>'; } },
            { t: 'Позиция', html: function (c) { return P.esc(c.nom); } },
            { t: 'Поставщик', k: 'sup' },
            { t: 'КП', num: true, html: function (c) { return c.offers >= 2 ? String(c.offers) : P.badge('1 источник', 'warn'); } },
            { t: 'Сумма', num: true, html: function (c) { return P.money(c.sum); } },
            { t: 'База', num: true, html: function (c) { var s = C.saving(c, st.base); return s.base ? P.money(s.base) : '-'; } },
            { t: 'Экономия', num: true, html: function (c) { var s = C.saving(c, st.base); return s.base ? P.badge(P.pct(s.pct), s.amount >= 0 ? 'ok' : 'crit') + '<div class="srm-muted">' + P.money(s.amount) + '</div>' : '-'; } }
        ], cs.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; })));
    }
    P.mount(render);
})();
