/* Service Desk: отчёт «Соблюдение SLA, %» по услугам, службам, исполнителям и отделам; из строки - список просрочек; выгрузка CSV. */
(function () {
    'use strict';
    var P = window.Desk, C = P.core;
    var st = { by: 'exec', period: '30', pick: '' };
    var BY = [['service', 'Услуги', function (t) { return t.service; }], ['dept', 'Службы', function (t) { return t.dept; }], ['exec', 'Исполнители', function (t) { return t.exec; }], ['empDept', 'Отделы заявителей', function (t) { return t.empDept; }]];
    var PERIODS = [['30', 'Последние 30 дней'], ['nov', 'Ноябрь 2026'], ['oct', 'Октябрь 2026'], ['all', 'Всё время']];

    function range(M) {
        if (st.period === 'nov') return [C.parseDt('2026-11-01'), C.parseDt('2026-12-01')];
        if (st.period === 'oct') return [C.parseDt('2026-10-01'), C.parseDt('2026-11-01')];
        if (st.period === 'all') return [0, M.now + 1];
        return [M.now - 30 * 1440, M.now + 1];
    }
    function pct(x) { return x === null ? '-' : String(x).replace('.', ',') + '%'; }
    function bar(x, target) { if (x === null) return '-'; return '<div class="desk-pbar' + (x < target ? ' desk-pbar-bad' : '') + '"><i style="width:' + x + '%"></i><span>' + pct(x) + '</span></div>'; }
    function trend(M) {
        var weeks = [], end = C.parseDt(C.isoOf(M.now)) - (C.dow(M.now) - 1) * 1440;
        for (var i = 7; i >= 0; i--) weeks.push(end - i * 7 * 1440);
        var W = 640, H = 150, bw = W / weeks.length - 10, tg = M.rules.target;
        var y = function (v) { return H - 22 - v / 100 * (H - 34); };
        var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Доля заявок, решённых в срок, по неделям">';
        weeks.forEach(function (w, i) {
            var r = C.slaReport(M.tickets, function () { return 'all'; }, w, w + 7 * 1440)[0], v = r && r.pct !== null ? r.pct : 0, x = i * (W / weeks.length) + 5;
            s += '<rect x="' + x + '" y="' + y(v) + '" width="' + bw + '" height="' + (H - 22 - y(v)) + '" rx="3" fill="' + (v < tg ? '#dc2626' : '#2563eb') + '" fill-opacity=".8"><title>' + C.fmtShort(w).slice(0, 5) + ': ' + v + '% (' + (r ? r.total : 0) + ' заявок)</title></rect>';
            s += '<text x="' + (x + bw / 2) + '" y="' + (y(v) - 4) + '" font-size="10" text-anchor="middle" fill="currentColor">' + Math.round(v) + '%</text>';
            s += '<text x="' + (x + bw / 2) + '" y="' + (H - 6) + '" font-size="10" text-anchor="middle" fill="currentColor" fill-opacity=".6">' + C.fmtShort(w).slice(0, 5) + '</text>';
        });
        s += '<line x1="0" x2="' + W + '" y1="' + y(tg) + '" y2="' + y(tg) + '" stroke="#d97706" stroke-dasharray="6 4"/><text x="' + (W - 2) + '" y="' + (y(tg) - 4) + '" font-size="10" text-anchor="end" fill="#d97706">цель ' + tg + '%</text>';
        return s + '</svg>';
    }
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('h1', { text: 'Соблюдение SLA' }));
        host.appendChild(P.el('p', { 'class': 'desk-sub', text: 'Доля заявок, решённых в срок по рабочему календарю службы (пауза «ждём заявителя» и время согласования не считаются). Нажмите на строку - откроется список просрочек.' }));
        var rg = range(M), by = BY.filter(function (b) { return b[0] === st.by; })[0];
        var per = P.select(PERIODS, st.period); per.onchange = function () { st.period = per.value; st.pick = ''; render(host, M); };
        host.appendChild(P.el('div', { 'class': 'desk-bar' }, [P.field('Период', per), P.el('span', { 'class': 'desk-grow' }),
            P.btn('Выгрузить CSV', function () {
                var rows = C.slaReport(M.tickets, by[2], rg[0], rg[1]).map(function (r) { return { k: r.key, n: r.total, ok: r.inTime, p: r.pct, rp: r.reactPct, o: r.open, b: r.breachOpen }; });
                P.download('sla-' + st.by + '.csv', C.toCsv(rows, [['k', by[1]], ['n', 'Решено'], ['ok', 'В срок'], ['p', 'SLA, %'], ['rp', 'Реакция в срок, %'], ['o', 'Открыто'], ['b', 'Просрочено открытых']]));
            })]));
        var tot = C.slaReport(M.tickets, function () { return 'all'; }, rg[0], rg[1])[0] || { pct: null, total: 0, inTime: 0, reactPct: null, breachOpen: 0, open: 0 };
        var inPeriod = M.tickets.filter(function (t) { return t.created >= rg[0] && t.created < rg[1]; });
        var bypass = inPeriod.filter(function (t) { return t.channel !== 'Портал'; }).length;
        host.appendChild(P.el('div', { 'class': 'desk-kpis' }, [
            P.kpi('SLA решения', pct(tot.pct), tot.inTime + ' из ' + tot.total + ' в срок, цель ' + M.rules.target + '%', tot.pct !== null && tot.pct < M.rules.target ? 'bad' : 'good'),
            P.kpi('Реакция в срок', pct(tot.reactPct), 'взяли в работу вовремя'),
            P.kpi('Открытых с просрочкой', String(tot.breachOpen), 'из ' + tot.open + ' открытых', tot.breachOpen ? 'bad' : 'good'),
            P.kpi('Мимо портала', inPeriod.length ? Math.round(bypass / inPeriod.length * 100) + '%' : '-', bypass + ' заявок звонком или письмом', bypass ? 'warn' : '')
        ]));
        host.appendChild(P.el('div', { 'class': 'desk-card', html: '<h3>По неделям</h3>' + trend(M) }));
        host.appendChild(P.tabs(BY.map(function (b) { return [b[0], b[1]]; }), st.by, function (k) { st.by = k; st.pick = ''; render(host, M); }));
        var rows = C.slaReport(M.tickets, by[2], rg[0], rg[1]);
        host.appendChild(P.table([
            { t: by[1], html: function (r) { var e = M.execBy[r.key]; return '<b>' + P.esc(r.key) + '</b>' + (e && e.type === 'Подрядчик' ? ' ' + P.badge('подрядчик', 'violet') : ''); } },
            { t: 'Решено', k: 'total', num: true }, { t: 'В срок', k: 'inTime', num: true },
            { t: 'SLA, %', html: function (r) { return bar(r.pct, M.rules.target); } },
            { t: 'Реакция в срок', num: true, html: function (r) { return pct(r.reactPct); } },
            { t: 'Открыто / просрочено', num: true, html: function (r) { return r.open + (r.breachOpen ? ' / <b class="desk-red">' + r.breachOpen + '</b>' : ''); } }
        ], rows, { onrow: function (r) { st.pick = r.key; render(host, M); }, rowCls: function (r) { return r.key === st.pick ? 'desk-row-hl' : ''; } }));
        if (st.pick) {
            var miss = M.tickets.filter(function (t) { return by[2](t) === st.pick && ((t.resolved !== null && t.resolved >= rg[0] && t.resolved < rg[1] && t.sla.state === 'missed') || t.sla.state === 'breach'); })
                .sort(function (a, b) { return a.sla.left - b.sla.left; });
            host.appendChild(P.el('h2', { text: 'Просрочки: ' + st.pick + ' (' + miss.length + ')' }));
            host.appendChild(P.table([
                { t: 'Номер', k: 'num' }, { t: 'Заявка', html: function (t) { return P.esc(t.topic) + '<br><small class="desk-muted">' + P.esc(t.service) + '</small>'; } },
                { t: 'Создана', html: function (t) { return P.esc(C.fmtShort(t.created)); } }, { t: 'Срок', html: function (t) { return P.esc(C.fmtShort(t.sla.deadline)); } },
                { t: 'Решена', html: function (t) { return t.resolved !== null ? P.esc(C.fmtShort(t.resolved)) : P.badge('открыта', 'bad'); } },
                { t: 'Сверх срока', num: true, html: function (t) { return P.esc(C.humanLeft(t.sla.left).replace('просрочено на ', '')); } }, { t: 'Исполнитель', k: 'exec' }
            ], miss, { onrow: function (t) { P.ticketCard(M, t); }, empty: 'Просрочек нет' }));
        }
    }
    P.mount(render);
})();
