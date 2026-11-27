/* BI-сводка: раскрытие цифры. Итог → источник → подразделение → документы источника, у каждого документа — загрузка, из которой он пришёл. */
(function () {
    'use strict';
    var B = window.Bisys, C = B.core;
    var LIMIT = 300;

    function state() {
        var h = B.hash(), p = h.p || (h.from ? '' : 'yesterday');
        var per = p ? C.period(p, B.TODAY) : { kind: '', from: h.from, to: h.to || h.from, label: h.from === (h.to || h.from) ? C.toDmy(h.from) : C.toDmy(h.from) + '–' + C.toDmy(h.to) };
        return { p: p, per: per, m: h.m || 'revenue', source: h.source || '', sub: h.sub || '' };
    }
    function go(st, patch) {
        var o = Object.assign({}, st, patch), hh = {};
        if (o.p) hh.p = o.p; else { hh.from = o.per.from; hh.to = o.per.to; }
        if (o.m !== 'revenue') hh.m = o.m;
        if (o.source) hh.source = o.source;
        if (o.sub) hh.sub = o.sub;
        location.hash = Object.keys(hh).map(function (k) { return k + '=' + encodeURIComponent(hh[k]); }).join('&');
    }
    function val(t, m) { return m === 'gp' ? t.gp : t.revenue; }

    function loadInfo(M, name) {
        var l = M.loadByName[name];
        if (!l) return;
        var body = B.el('div', {}, [
            B.el('div', { 'class': 'bi-kv', html: '<span>Источник</span><b>' + B.esc(l.source) + '</b>' }),
            B.el('div', { 'class': 'bi-kv', html: '<span>Загружено</span><b>' + C.toDmy(l.date) + ' ' + B.esc(l.time) + ', ' + B.esc(l.who) + '</b>' }),
            B.el('div', { 'class': 'bi-kv', html: '<span>Данные за</span><b>' + C.toDmy(l.dataFor) + '</b>' }),
            B.el('div', { 'class': 'bi-kv', html: '<span>Файл</span><b>' + B.esc(l.file) + '</b>' }),
            B.el('div', { 'class': 'bi-kv', html: '<span>Строк: принято / отвергнуто</span><b>' + l.acc + ' / ' + l.rej + '</b>' }),
            B.el('p', { 'class': 'bi-muted', html: 'Журнал и отвергнутые строки — на экране <a href="' + B.esc(B.nav('loads', { load: l.name })) + '">Загрузки</a>.' })
        ]);
        B.modal('Загрузка ' + l.name, body);
    }

    function render(host, M) {
        var st = state(), names = {}; M.mySubs.forEach(function (s) { names[s.name] = 1; });
        var all = M.docs.filter(function (d) { return names[d.sub]; });
        var docs = C.filterDocs(all, { from: st.per.from, to: st.per.to });
        var T = C.totals(docs);
        host.appendChild(B.el('h1', { text: 'Раскрытие цифры' }));
        host.appendChild(B.el('p', { 'class': 'bi-sub', text: 'Итог сводки раскладывается по источникам, подразделениям и документам. Сумма строк всегда равна цифре на сводке: её можно проверить до чека, заказа или отправления.' }));
        host.appendChild(B.freshBar(M));
        host.appendChild(B.tabs([['yesterday', 'Вчера'], ['week', '7 дней'], ['month', 'Месяц']], st.p, function (k) { go(st, { p: k }); }));
        host.appendChild(B.el('div', { 'class': 'bi-bar' }, [B.tabs([['revenue', 'Выручка'], ['gp', 'Валовая прибыль']], st.m, function (k) { go(st, { m: k }); })]));
        var crumbs = [B.el('a', { href: '#', onclick: function (e) { e.preventDefault(); go(st, { source: '', sub: '' }); }, text: (st.m === 'gp' ? 'Валовая прибыль' : 'Выручка') + ' за ' + st.per.label + ': ' + B.money(val(T, st.m)) })];
        if (st.source) crumbs.push(' › ', B.el('a', { href: '#', onclick: function (e) { e.preventDefault(); go(st, { sub: '' }); }, text: st.source }));
        if (st.sub) crumbs.push(' › ', B.el('b', { text: st.sub }));
        host.appendChild(B.el('div', { 'class': 'bi-crumbs' }, crumbs));
        var level = st.sub ? 'docs' : st.source ? 'sub' : 'source';
        var sel = C.filterDocs(docs, { source: st.source, sub: st.sub });
        if (level !== 'docs') {
            var key = level === 'source' ? 'source' : 'sub';
            var groups = C.groupBy(sel, key), tot = val(C.totals(sel), st.m);
            if (level === 'source') M.fresh.stale.forEach(function (s) { if (!groups.some(function (g) { return g.key === s.name; }) && M.docs.some(function (d) { return d.source === s.name && names[d.sub]; })) groups.push(Object.assign(C.totals([]), { key: s.name, empty: true })); });
            host.appendChild(B.table([
                { t: level === 'source' ? 'Источник' : 'Подразделение', html: function (g) { var f = level === 'source' ? M.fresh.list.filter(function (x) { return x.name === g.key; })[0] : null; return '<b>' + B.esc(g.key) + '</b>' + (f && !f.fresh ? ' ' + B.badge('нет данных с ' + C.toDmy(C.addDays(f.dataFor, 1)), 'crit') : ''); } },
                { t: st.m === 'gp' ? 'Валовая прибыль' : 'Выручка', num: true, html: function (g) { return B.money(val(g, st.m)); } },
                { t: 'Доля', num: true, html: function (g) { return tot ? B.pct(val(g, st.m) / tot * 100) : '—'; } },
                { t: 'Документов', num: true, html: function (g) { return String(g.docs); } },
                { t: 'Возвратов', num: true, html: function (g) { return String(g.returns); } },
                { t: 'Маржа', num: true, html: function (g) { return B.pct(g.margin); } }
            ], groups, { onrow: function (g) { if (!g.empty) go(st, level === 'source' ? { source: g.key } : { sub: g.key }); }, empty: 'За период документов нет' }));
            host.appendChild(B.el('p', { 'class': 'bi-muted', text: 'Нажмите на строку, чтобы раскрыть дальше.' }));
            return;
        }
        sel.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : a.no < b.no ? 1 : -1; });
        var t = C.totals(sel);
        host.appendChild(B.el('div', { 'class': 'bi-kpis bi-kpis-sm' }, [
            B.el('div', { 'class': 'bi-kpi' }, [B.el('div', { 'class': 'bi-kpi-l', text: 'Выручка' }), B.el('div', { 'class': 'bi-kpi-v', text: B.money(t.revenue) })]),
            B.el('div', { 'class': 'bi-kpi' }, [B.el('div', { 'class': 'bi-kpi-l', text: 'Валовая прибыль' }), B.el('div', { 'class': 'bi-kpi-v', text: B.money(t.gp) })]),
            B.el('div', { 'class': 'bi-kpi' }, [B.el('div', { 'class': 'bi-kpi-l', text: 'Документов / возвратов' }), B.el('div', { 'class': 'bi-kpi-v', text: t.docs + ' / ' + t.returns })])
        ]));
        host.appendChild(B.table([
            { t: 'Документ', html: function (d) { return '<b>' + B.esc(d.no) + '</b><div class="bi-muted">' + B.esc(d.kind) + ', ' + d.pos + ' поз.</div>'; } },
            { t: 'Дата', html: function (d) { return C.toDmy(d.date); } },
            { t: 'Сумма', num: true, html: function (d) { return B.money(d.sum); } },
            { t: 'Себестоимость', num: true, html: function (d) { return B.money(d.cost); } },
            { t: 'Валовая прибыль', num: true, html: function (d) { return B.money(d.sum - d.cost); } },
            { t: 'Загрузка', html: function (d) { return '<span class="bi-link">' + B.esc(d.load) + '</span>'; } }
        ], sel.slice(0, LIMIT), { rowCls: function (d) { return d.kind === C.RETURN ? 'bi-row-warn' : ''; }, onrow: function (d) { loadInfo(M, d.load); } }));
        if (sel.length > LIMIT) host.appendChild(B.el('p', { 'class': 'bi-muted', text: 'Показаны последние ' + LIMIT + ' из ' + sel.length + ' документов; итоги выше — по всем.' }));
    }
    window.addEventListener('hashchange', function () { B.render(); });
    B.mount(render);
})();
