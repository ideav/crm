/* Консолидация: «Отчётность группы» - консолидированный баланс и ОПУ по обществам, корректировкам и элиминациям; любая цифра раскрывается до строки пакета и проводки. */
(function () {
    'use strict';
    var P = window.Consol, C = P.core;
    var st = { per: '', part: 'bal', drafts: false };

    function drill(M, r, co, cons) {
        var art = M.artBy[r.code], nodes = [];
        var src = r.src.filter(function (l) { return !co || co === '*' || l.company === co; });
        if (co !== 'adj' && src.length) {
            nodes.push(P.el('h3', { text: 'Строки пакетов' }));
            nodes.push(P.table([{ t: 'Общество', k: 'company' }, { t: 'Счёт', k: 'acc' }, { t: 'Наименование', k: 'name' }, { t: 'Контрагент', k: 'cp' },
                { t: 'Пакет', html: function (l) { var p = M.pkgById[l.pkg]; return p ? P.badge(p.status, C.statusKind(p.status)) : ''; } },
                { t: 'Сумма', num: true, html: function (l) { return P.fmt(C.disp(art, l.amount)); } }], src));
        }
        if (co === 'adj' || co === '*') {
            nodes.push(P.el('h3', { text: 'Корректировки и элиминации' }));
            nodes.push(P.table([{ t: 'Номер', k: 'num' }, { t: 'Вид', k: 'kind' }, { t: 'Суть', k: 'title' }, { t: 'Общество', k: 'company' },
                { t: 'Статус', html: function (e) { return P.badge(e.status, e.status === 'Утверждена' ? 'good' : 'warn'); } },
                { t: 'Сумма', num: true, html: function (e) { return P.fmt(C.disp(art, e.amount)); } }], r.adjSrc, { empty: 'Корректировок по статье нет' }));
        }
        var val = co === 'adj' ? r.adj : co === '*' ? r.total : r.byCo[co] || 0;
        P.modal(r.code + ' ' + r.name + (co === '*' ? ': группа' : co === 'adj' ? ': корректировки' : ': ' + P.coName(M, co)), P.el('div', {}, [P.el('p', { html: 'Итого: <b>' + P.fmt(C.disp(art, val)) + '</b> тыс. руб.' })].concat(nodes)), null, true);
    }
    function render(host, M) {
        host.innerHTML = '';
        st.per = st.per || P.hash().per || M.cur;
        host.appendChild(P.el('h1', { text: 'Консолидированная отчётность' }));
        host.appendChild(P.el('p', { 'class': 'consol-sub', text: 'Сумма пакетов обществ плюс утверждённые корректировки и элиминации, тыс. руб. Нажмите на цифру - увидите, из каких строк пакетов и проводок она сложилась.' }));
        var sel = P.select(M.periods.map(function (p) { return p.name; }), st.per); sel.onchange = function () { st.per = sel.value; render(host, M); };
        var dr = P.el('input', { type: 'checkbox' }); dr.checked = st.drafts; dr.onchange = function () { st.drafts = dr.checked; render(host, M); };
        var cons = P.consFor(M, st.per, st.drafts), cos = M.cos.map(function (c) { return c.code; });
        var csv = P.btn('Выгрузить CSV', function () {
            var rows = cons.rows.map(function (r) { var o = { code: r.code, name: r.name, adj: C.disp(r, r.adj), total: r.value }; cos.forEach(function (c) { o[c] = C.disp(r, r.byCo[c] || 0); }); return o; });
            P.download('consol-' + M.periodBy[st.per].code + '.csv', C.toCsv(rows, [['code', 'Код'], ['name', 'Статья']].concat(cos.map(function (c) { return [c, c]; }), [['adj', 'Корректировки'], ['total', 'Группа']])));
        });
        host.appendChild(P.el('div', { 'class': 'consol-bar' }, [P.field('Период', sel), P.el('label', { 'class': 'consol-check' }, [dr, ' учесть черновики корректировок']), P.el('span', { 'class': 'consol-grow' }), csv]));
        var notAcc = M.cos.filter(function (c) { var p = M.pkgOf(c.code, st.per); return !p || p.status !== 'Принят'; });
        if (notAcc.length) host.appendChild(P.el('div', { 'class': 'consol-note', html: 'Пакеты не приняты: ' + notAcc.map(function (c) { var p = M.pkgOf(c.code, st.per); return '<b>' + P.esc(c.code) + '</b> (' + P.esc(p ? p.status.toLowerCase() : 'нет') + ')'; }).join(', ') + '. Их строки уже в отчёте, но цифры могут измениться.' }));
        host.appendChild(P.el('div', { 'class': 'consol-kpis' }, [
            P.kpi('Активы группы', P.fmt(cons.assets), 'тыс. руб.'), P.kpi('Капитал и обязательства', P.fmt(cons.liab), 'тыс. руб.'),
            P.kpi('Прибыль группы', P.fmt(cons.profit), 'за период, тыс. руб.', cons.profit < 0 ? 'bad' : 'good'),
            P.kpi('Баланс', Math.abs(cons.check) < 0.5 ? 'сходится' : P.fmt(cons.check), Math.abs(cons.check) < 0.5 ? 'актив = пассив' : 'актив - пассив: есть несопоставленные строки', Math.abs(cons.check) < 0.5 ? 'good' : 'bad')
        ]));
        host.appendChild(P.tabs([['bal', 'Баланс'], ['pnl', 'Отчёт о прибылях и убытках']], st.part, function (k) { st.part = k; render(host, M); }));
        var sect = st.part === 'bal' ? ['А', 'П'] : ['ОПУ'];
        var head = '<tr><th>Статья</th>' + cos.map(function (c) { var p = M.pkgOf(c, st.per); return '<th class="consol-num" title="' + P.esc(P.coName(M, c) + ': ' + (p ? p.status : 'нет пакета')) + '">' + P.esc(c) + (p && p.status !== 'Принят' ? ' <span class="consol-dot"></span>' : '') + '</th>'; }).join('') + '<th class="consol-num">Корректировки</th><th class="consol-num">Группа</th></tr>';
        var tb = P.el('tbody'), grp = '';
        var cellBtn = function (r, co, v) { return P.el('td', { 'class': 'consol-num' }, [v ? P.el('button', { type: 'button', 'class': 'consol-amt', text: P.fmt(C.disp(r, v)), onclick: function () { drill(M, r, co, cons); } }) : '']); };
        var subtotal = function (label, f, cls) {
            var rs = cons.rows.filter(f), tr = P.el('tr', { 'class': cls || 'consol-sum' }, [P.el('td', { text: label })]);
            var s = function (g) { return rs.reduce(function (x, r) { return x + C.disp(r, g(r)); }, 0); };
            cos.forEach(function (c) { tr.appendChild(P.el('td', { 'class': 'consol-num', text: P.fmt(s(function (r) { return r.byCo[c] || 0; })) })); });
            tr.appendChild(P.el('td', { 'class': 'consol-num', text: P.fmt(s(function (r) { return r.adj; })) })); tr.appendChild(P.el('td', { 'class': 'consol-num', text: P.fmt(s(function (r) { return r.total; })) }));
            tb.appendChild(tr);
        };
        var rows = cons.rows.filter(function (r) { return sect.indexOf(r.section) >= 0 && (r.total || r.pkg || r.adj); });
        rows.forEach(function (r, i) {
            if (r.group !== grp) { grp = r.group; tb.appendChild(P.el('tr', { 'class': 'consol-grp' }, [P.el('td', { colspan: cos.length + 3, text: grp })])); }
            var tr = P.el('tr', { 'class': r.ic && Math.abs(r.total) > 0.5 ? 'consol-row-hl' : '' }, [P.el('td', { html: '<small class="consol-muted">' + P.esc(r.code) + '</small> ' + P.esc(r.name) + (r.ic && Math.abs(r.total) > 0.5 ? ' ' + P.badge('не элиминировано ' + P.fmt(Math.abs(r.total)), 'warn') : '') })]);
            cos.forEach(function (c) { tr.appendChild(cellBtn(r, c, r.byCo[c] || 0)); });
            tr.appendChild(cellBtn(r, 'adj', r.adj));
            var tt = cellBtn(r, '*', r.total); tt.className += ' consol-tot'; tr.appendChild(tt);
            tb.appendChild(tr);
            var next = rows[i + 1];
            if (st.part === 'bal' && (!next || next.section !== r.section)) subtotal(r.section === 'А' ? 'Итого активы' : 'Итого капитал и обязательства', function (x) { return x.section === r.section; }, 'consol-sum consol-sum2');
        });
        if (st.part === 'pnl') subtotal('Прибыль (убыток) за период', function (x) { return x.section === 'ОПУ'; }, 'consol-sum consol-sum2');
        host.appendChild(P.el('div', { 'class': 'consol-tablewrap' }, [P.el('table', { 'class': 'consol-table consol-rep', html: '<thead>' + head + '</thead>' }, [tb])]));
        host.appendChild(P.el('p', { 'class': 'consol-muted', html: '<span class="consol-dot"></span> пакет общества ещё не принят методологом. Строки «(ВГО)» в итоге группы должны обнулиться элиминацией; остаток подсвечен.' }));
    }
    P.mount(render);
})();
