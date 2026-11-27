/* CPM: свод группы - юрлицо и ЦФО по столбцам, статьи по строкам, элиминация внутригрупповых услуг, сравнение версий. */
(function () {
    'use strict';
    var P = window.Cpm, C = P.core;
    function m1(x) { var v = C.num(x) / 1e6; return v ? (Math.round(v * 10) / 10).toFixed(1).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : ''; }
    function render(host, M) {
        var h = P.hash();
        var version = h.v && M.verBy[h.v] ? h.v : P.CUR, ver = M.verBy[version];
        var cmpName = h.c !== undefined && M.verBy[h.c] ? h.c : (ver.compare || P.PLAN);
        var fallback = ver.compare && M.verBy[ver.compare] && M.verBy[ver.compare].year === ver.year ? ver.compare : null;
        var s = C.consolidate(M.rows, version, fallback, M.cfos, M.articles);
        var cmpVer = M.verBy[cmpName], cmpFb = cmpVer && cmpVer.compare && M.verBy[cmpVer.compare] && M.verBy[cmpVer.compare].year === cmpVer.year ? cmpVer.compare : null;
        var b = C.consolidate(M.rows, cmpName, cmpFb, M.cfos, M.articles);
        var pn = C.pnl(s.group, M.articles), pb = C.pnl(b.group, M.articles);
        var camp = C.campaignSummary(C.campaign(M.budgets.filter(function (x) { return x.version === version; }), P.TODAY));
        host.innerHTML = '';
        P.head('Свод группы', 'Свод собирается в момент ввода: каждый сохранённый бюджет ЦФО сразу попадает сюда. Внутригрупповые услуги элиминируются, итог группы сверяется сам. Суммы в млн ₽.').forEach(function (n) { host.appendChild(n); });
        function go(v, c) { location.hash = 'v=' + encodeURIComponent(v) + '&c=' + encodeURIComponent(c); }
        var vs = P.select(M.versions.map(function (v) { return v.name; }), version); vs.addEventListener('change', function () { go(vs.value, M.verBy[vs.value].compare || P.PLAN); });
        var cs = P.select(M.versions.map(function (v) { return v.name; }), cmpName); cs.addEventListener('change', function () { go(version, cs.value); });
        host.appendChild(P.el('div', { 'class': 'cpm-toolbar' }, [P.field('Версия', vs), P.field('Сравнить с', cs), P.el('div', { 'class': 'cpm-grow' }), P.btn('Выгрузить в Excel', exportCsv)]));
        var dE = pn.ebitda - pb.ebitda;
        host.appendChild(P.el('div', { 'class': 'cpm-kpis' }, [
            P.kpi('Выручка группы', m1(pn.revenue), 'к «' + cmpName + '»: ' + P.pct(C.growthPct(pn.revenue, pb.revenue), true)),
            P.kpi('EBITDA группы', m1(pn.ebitda), 'рентабельность ' + P.pct(pn.margin), pn.ebitda > 0 ? 'good' : 'bad'),
            P.kpi('EBITDA к сравнению', (dE > 0 ? '+' : '') + m1(dE), cmpName, dE < 0 ? 'warn' : ''),
            P.kpi('ЦФО сдали', camp.done + ' из ' + camp.total, camp.late ? 'просрочено: ' + camp.late : 'без просрочек', camp.late ? 'bad' : ''),
            P.kpi('Элиминация', s.elim.ok ? 'сошлась' : m1(s.elim.diff), s.elim.ok ? 'внутригрупповые обороты равны' : 'расхождение, млн ₽', s.elim.ok ? 'good' : 'bad')
        ]));
        if (s.fallbackCfos.length) host.appendChild(P.el('div', { 'class': 'cpm-note', html: '<b>Не сдали в этом круге:</b> ' + P.esc(s.fallbackCfos.join(', ')) + '. В своде их цифры из «' + P.esc(fallback) + '», столбец помечен звёздочкой.' }));
        var el = s.elim, lines = el.lines.map(function (l) { return P.esc(l.cfo) + ': ' + (l.kind === 'Доход' ? 'доход ' : 'расход ') + m1(l.amount); }).join(' · ');
        host.appendChild(P.el('div', { 'class': 'cpm-note ' + (el.ok ? 'cpm-good' : 'cpm-bad'), html: el.ok ? '<b>Элиминация сошлась:</b> услуги УК ' + m1(el.income) + ' млн ₽ = расходы получателей. ' + lines
            : '<b>Свод не сходится на ' + m1(Math.abs(el.diff)) + ' млн ₽:</b> УК выставляет ' + m1(el.income) + ', получатели заложили ' + m1(el.expense) + '. ' + lines + '. Ищем не неделю: расхождение видно в столбцах ниже.' }));
        /* матрица статей */
        var cols = M.cfos.map(function (c) { return c.name; });
        var thead = P.el('tr', {}, [P.el('th', { text: 'Статья' })].concat(M.cfos.map(function (c) {
            var th = P.el('th', { 'class': 'cpm-num' });
            th.appendChild(P.el('a', { href: P.nav('form', 'cfo=' + encodeURIComponent(c.name) + '&v=' + encodeURIComponent(version)), text: c.name + (s.fallbackCfos.indexOf(c.name) >= 0 ? '*' : ''), title: c.entity + ': открыть форму ЦФО' }));
            th.appendChild(P.el('div', { style: 'font-weight:400;font-size:10px', text: (P.map(M.entities, 'name')[c.entity] || {}).role || '' }));
            return th;
        }), [P.el('th', { 'class': 'cpm-num', text: 'Элиминация' }), P.el('th', { 'class': 'cpm-num cpm-col-sel', text: 'Группа' }), P.el('th', { 'class': 'cpm-num', text: 'Сравнение' }), P.el('th', { 'class': 'cpm-num', text: 'Δ' })]));
        var tb = P.el('tbody');
        function line(label, valFn, elim, grp, cmp, cls) {
            var tr = P.el('tr', { 'class': cls || '' }, [P.el('td', { html: label })]);
            cols.forEach(function (c) { tr.appendChild(P.el('td', { 'class': 'cpm-num', text: m1(valFn(c)) })); });
            tr.appendChild(P.el('td', { 'class': 'cpm-num', text: elim ? m1(elim) : '' }));
            tr.appendChild(P.el('td', { 'class': 'cpm-num cpm-col-sel', html: '<b>' + m1(grp) + '</b>' }));
            tr.appendChild(P.el('td', { 'class': 'cpm-num', text: m1(cmp) }));
            var d = grp - cmp; tr.appendChild(P.el('td', { 'class': 'cpm-num', text: d ? (d > 0 ? '+' : '') + m1(d) : '' }));
            tb.appendChild(tr);
        }
        var pc = {}; cols.forEach(function (c) { pc[c] = C.pnl(s.byCfo[c], M.articles); });
        M.groups.forEach(function (gr) {
            var list = M.articles.filter(function (a) { return a.group === gr && cols.some(function (c) { return s.byCfo[c][a.name] || b.byCfo[c] && b.byCfo[c][a.name]; }); });
            list.forEach(function (a) {
                var tot = 0, bt = 0; cols.forEach(function (c) { tot += C.num(s.byCfo[c][a.name]); bt += C.num(b.byCfo[c] && b.byCfo[c][a.name]); });
                line('<span class="cpm-muted">' + P.esc(a.code) + '</span> ' + P.esc(a.name), function (c) { return s.byCfo[c][a.name]; }, a.intra ? -tot : 0, a.intra ? 0 : tot, a.intra ? 0 : bt);
            });
            if (gr === 'Себестоимость') line('<b>Валовая прибыль</b>', function (c) { return pc[c].gross; }, 0, pn.gross, pb.gross, 'cpm-row-sum');
        });
        line('<b>EBITDA</b>', function (c) { return pc[c].ebitda; }, -(el.income - el.expense), pn.ebitda, pb.ebitda, 'cpm-row-sum');
        host.appendChild(P.el('div', { 'class': 'cpm-tablewrap' }, [P.el('table', { 'class': 'cpm-table cpm-svod' }, [P.el('thead', {}, [thead]), tb])]));
        /* что изменилось */
        var diff = C.compare(s, b).slice(0, 8);
        host.appendChild(P.el('h2', { text: 'Что изменилось к «' + cmpName + '»' }));
        host.appendChild(P.table([{ t: 'ЦФО', k: 'cfo' }, { t: 'Статья', k: 'article' }, { t: 'Было', num: true, html: function (r) { return m1(r.before); } }, { t: 'Стало', num: true, html: function (r) { return m1(r.now); } },
            { t: 'Δ, млн ₽', num: true, html: function (r) { return (r.delta > 0 ? '+' : '') + m1(r.delta); } }, { t: 'Δ, %', num: true, html: function (r) { return P.pct(r.pct, true); } }], diff,
            { empty: 'Версии совпадают', onrow: function (r) { location.href = P.nav('form', 'cfo=' + encodeURIComponent(r.cfo) + '&v=' + encodeURIComponent(version)); } }));
        function exportCsv() {
            var head = ['Статья'].concat(cols, ['Группа']);
            var rows = M.articles.map(function (a) { var t = 0; var r = [a.name].concat(cols.map(function (c) { t += C.num(s.byCfo[c][a.name]); return String(C.num(s.byCfo[c][a.name]) / 1000).replace('.', ','); })); r.push(a.intra ? '0' : String(t / 1000).replace('.', ',')); return r; });
            P.download('Свод ' + version + ' (тыс. руб.).csv', C.toCsv(head, rows));
        }
    }
    P.mount(render);
    window.addEventListener('hashchange', function () { P.mount(render); });
})();
