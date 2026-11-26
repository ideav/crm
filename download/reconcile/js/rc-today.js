/* Сверка: «что не сошлось сегодня». Итог последних прогонов, возраст открытых расхождений, просрочка по ответственным, напоминание. */
(function () {
    'use strict';
    var P = window.Rc, C = P.core;
    var host, M;
    function sum(a) { return a.reduce(function (s, d) { return s + Math.abs(d.diff); }, 0); }
    function spark(runs) {
        var wrap = P.el('div', { 'class': 'rc-spark', role: 'img', 'aria-label': 'Доля сошедшихся строк по дням' });
        runs.forEach(function (r) {
            var h = Math.max(4, (r.pct - 85) / 15 * 100), cls = r.pct < 93 ? 'rc-r' : r.pct < 96 ? 'rc-a' : 'rc-g';
            wrap.appendChild(P.el('div', { title: C.toDmy(r.date) + ': сошлось ' + r.pct + '% (' + r.matched + ' из ' + (r.matched + r.unmatched) + ')' }, [P.el('span', { text: String(Math.round(r.pct)) }), P.el('div', { 'class': 'rc-col rc-bar-fill ' + cls, style: 'height:' + h + '%' }), P.el('small', { text: r.date.slice(8, 10) })]));
        });
        return wrap;
    }
    function render() {
        host.innerHTML = '';
        P.head('Что не сошлось сегодня', 'Сводка на ' + C.toDmy(P.TODAY) + ': доля сошедшихся строк по последним прогонам, открытые расхождения по возрасту и ответственным. Просроченное - сверху.').forEach(function (n) { host.appendChild(n); });
        var act = M.discs.filter(function (d) { return d.status !== C.ST.DONE; }), open = act.filter(function (d) { return d.status === C.ST.OPEN; }), over = act.filter(function (d) { return C.isOverdue(d, P.TODAY); });
        var last = M.pairs.map(function (p) { var rs = M.runs.filter(function (r) { return r.pair === p.name; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }); return { p: p, runs: rs, last: rs[rs.length - 1] }; });
        var k = last.map(function (x) { return P.kpi(x.p.name.split(' ↔ ')[0], x.last ? String(x.last.pct).replace('.', ',') + '%' : 'нет', x.last ? 'последний прогон ' + C.toDmy(x.last.date) + ', не сошлось ' + x.last.unmatched + ' строк' : '', x.last && x.last.pct < 95 ? 'warn' : 'good'); });
        k.push(P.kpi('Открыто расхождений', String(open.length), 'на ' + P.short(sum(open)) + ', на проверке ' + (act.length - open.length), open.length ? 'warn' : 'good'));
        k.push(P.kpi('Просрочено', String(over.length), over.length ? 'на ' + P.short(sum(over)) : 'всё в срок', over.length ? 'bad' : 'good'));
        host.appendChild(P.el('div', { 'class': 'rc-kpis' }, k));
        host.appendChild(P.el('h2', { text: 'Возраст незакрытых расхождений' }));
        host.appendChild(P.el('div', { 'class': 'rc-ages' }, C.BUCKETS.map(function (b) {
            var l = act.filter(function (d) { return C.ageBucket(C.ageDays(d.found, P.TODAY)) === b; });
            return P.el('div', {}, [P.el('span', { 'class': 'rc-muted', text: b }), P.el('b', { text: String(l.length), style: b === 'больше 15 дн.' && l.length ? 'color:var(--p-red)' : '' }), P.el('span', { 'class': 'rc-muted', text: P.short(sum(l)) })]);
        })));
        host.appendChild(P.el('h2', { text: 'Сошлось по дням, %' }));
        host.appendChild(P.el('div', { 'class': 'rc-two' }, last.map(function (x) { return P.el('div', { 'class': 'rc-card' }, [P.el('h3', { text: x.p.name }), spark(x.runs.slice(-18))]); })));
        host.appendChild(P.el('h2', { text: 'По ответственным' }));
        var by = {}; act.forEach(function (d) { (by[d.resp] = by[d.resp] || []).push(d); });
        var rows = Object.keys(by).map(function (r) { var l = by[r]; return { resp: r, n: l.length, open: l.filter(function (d) { return d.status === C.ST.OPEN; }).length, over: l.filter(function (d) { return C.isOverdue(d, P.TODAY); }), oldest: Math.max.apply(null, l.map(function (d) { return C.ageDays(d.found, P.TODAY); })), sum: sum(l) }; });
        host.appendChild(P.table([
            { t: 'Ответственный', k: 'resp' }, { t: 'Незакрыто', k: 'n', num: 1 }, { t: 'Открыто', k: 'open', num: 1 },
            { t: 'Просрочено', num: 1, html: function (r) { return r.over.length ? '<b style="color:var(--p-red)">' + r.over.length + '</b>' : '0'; } },
            { t: 'Старшее, дн.', k: 'oldest', num: 1 }, { t: 'Сумма', num: 1, html: function (r) { return P.money(r.sum); } },
            { t: '', html: function () { return ''; } }
        ], rows, { empty: 'Незакрытых расхождений нет' }));
        if (P.canWrite('Журнал сверки') && P.role !== 'auditor') {
            var tb = host.querySelectorAll('.rc-table tbody tr');
            rows.forEach(function (r, i) {
                var td = tb[i] && tb[i].lastChild; if (!td) return;
                td.appendChild(P.btn('Напомнить', function () {
                    P.log('Напоминание', r.resp, 'Незакрыто ' + r.n + ', просрочено ' + r.over.length + ' (' + r.over.map(function (d) { return d.code; }).join(', ') + ')').then(function () { P.toast('Напоминание для ' + r.resp + ' записано в журнал: ' + r.n + ' расхождений, просрочено ' + r.over.length); });
                }, 'rc-small'));
            });
        }
        host.appendChild(P.el('h2', { text: 'Просроченные: разобрать первыми' }));
        host.appendChild(P.table([{ t: 'Код', k: 'code' }, { t: 'Причина', k: 'reason' }, { t: 'Контрагент', k: 'cp' }, { t: 'Разница', num: 1, html: function (d) { return P.money(d.diff); } }, { t: 'Возраст, дн.', num: 1, html: function (d) { return String(C.ageDays(d.found, P.TODAY)); } }, { t: 'Ответственный', k: 'resp' }],
            over.sort(function (a, b) { return Math.abs(b.diff) - Math.abs(a.diff); }).slice(0, 8), { onrow: function (d) { location.href = P.nav('queue', 'd=' + encodeURIComponent(d.code)); }, empty: 'Просроченных нет' }));
    }
    P.mount(function (h, m) { host = h; M = m; render(); });
})();
