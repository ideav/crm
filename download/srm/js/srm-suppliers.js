/* SRM: Поставщики и допуск. Светофор, документы со сроками, журнал решений СБ, траты у поставщика по всем заводам. */
(function () {
    'use strict';
    var P = window.Srm, C = P.core;
    var st = { f: 'all' };

    function decide(M, s) {
        var lvl = P.select(Object.keys(M.levels), s.level), until = P.input('date', s.until || '2027-06-30'), why = P.input('textarea', '');
        P.modal('Решение по допуску: ' + s.name, P.el('div', {}, [P.field('Уровень допуска', lvl), P.field('Допуск до', until), P.field('Обоснование', why)]), [{ text: 'Отмена' }, { text: 'Записать решение', cls: 'srm-primary', fn: function (close, b) {
            if (why.value.trim().length < 10) { P.toast('Нужно обоснование', true); return false; }
            b.disabled = true;
            P.batch([{ op: 'new', id: 'Решение по допуску', up: s.id, fields: { 'Решение по допуску': lvl.value, 'Дата решения': P.TODAY, 'Кто решил': P.ctx.user, 'Уровень допуска': lvl.value, 'Обоснование решения': why.value } },
                { op: 'set', id: s.id, fields: { 'Уровень допуска': lvl.value, 'Допуск до': until.value, 'Причина ограничения': M.levels[lvl.value] && M.levels[lvl.value].color === 'green' ? '' : why.value } }])
                .then(function () { P.toast('Решение записано'); close(); P.reload(); }).catch(function (e) { P.toast(e.message, true); b.disabled = false; });
            return false;
        } }]);
    }
    function cardOf(M, s) {
        var a = P.admissionOf(M, s.name), spend = C.spendMatrix(M.contracts, s.name), docs = M.docs[s.name] || [], dec = (M.decisions[s.name] || []).slice().sort(function (x, y) { return x.date < y.date ? 1 : -1; });
        var body = P.el('div', {}, [
            P.el('div', { 'class': 'srm-kv' }, [P.el('span', { text: 'ИНН / город' }), P.el('span', { text: s.inn + ' / ' + s.city })]),
            P.el('div', { 'class': 'srm-kv' }, [P.el('span', { text: 'Контакт' }), P.el('span', { text: s.contact + ', ' + s.email })]),
            P.el('div', { 'class': 'srm-kv' }, [P.el('span', { text: 'Категории' }), P.el('span', { text: s.cats.join(', ') })]),
            P.el('div', { 'class': 'srm-kv' }, [P.el('span', { text: 'Допуск' }), P.el('span', { html: P.light(M, s.name) + (s.until ? ' до ' + P.d(s.until) : '') })])
        ].concat(a.reasons.map(function (r) { return P.box('e', r); })).concat(a.warnings.map(function (r) { return P.box('w', r); })));
        body.appendChild(P.el('h4', { text: 'Документы' }));
        body.appendChild(P.table([{ t: 'Документ', k: 'name' }, { t: 'Действует до', html: function (d) { var x = C.docStatus(d, M.today, M.rules); return (d.until ? P.d(d.until) : 'нет') + ' ' + (x === 'expired' ? P.badge('просрочен', 'crit') : x === 'soon' ? P.badge('истекает', 'warn') : x === 'none' ? P.badge('не предоставлен', 'crit') : P.badge('в порядке', 'ok')); } }], docs, { empty: 'Документы не получены' }));
        body.appendChild(P.el('h4', { text: 'Журнал решений СБ' }));
        body.appendChild(P.el('ul', { 'class': 'srm-journal' }, dec.map(function (d) { return P.el('li', {}, [P.el('b', { text: d.level + ': ' }), d.why || d.name, P.el('small', { text: P.d(d.date) + ' - ' + d.who + ' - ' + d.name })]); })));
        if (spend.count) {
            body.appendChild(P.el('h4', { text: 'Потрачено у поставщика в 2026: ' + P.money(spend.total) + ' (' + spend.count + ' договоров)' }));
            body.appendChild(P.table([{ t: 'Завод', k: 'key' }, { t: 'Сумма', num: true, html: function (x) { return P.money(x.sum); } }, { t: 'Доля', num: true, html: function (x) { return x.share + '%'; } }], spend.byPlant));
        }
        var btns = [{ text: 'Закрыть' }];
        if (P.canWrite('Решение по допуску')) btns.unshift({ text: 'Решение по допуску', cls: 'srm-primary', fn: function () { decide(M, s); } });
        P.modal(s.name, body, btns, true);
    }
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('h1', { text: 'Поставщики и допуск' }));
        host.appendChild(P.el('p', { 'class': 'srm-sub', text: 'Одна карточка поставщика на все заводы: допуск со сроком, документы, решения службы безопасности и траты. Красная зона не даёт заключить договор, пока СБ не примет решение с обоснованием.' }));
        var rows = M.sups.map(function (s) { var a = P.admissionOf(M, s.name), docs = M.docs[s.name] || []; return { s: s, a: a, exp: docs.filter(function (d) { return C.docStatus(d, M.today, M.rules) === 'expired' || !d.until; }).length, soon: docs.filter(function (d) { return C.docStatus(d, M.today, M.rules) === 'soon'; }).length, spend: C.spendMatrix(M.contracts, s.name).total }; });
        var red = rows.filter(function (r) { return r.a.light === 'red'; }), amber = rows.filter(function (r) { return r.a.light === 'amber'; });
        host.appendChild(P.el('div', { 'class': 'srm-kpis' }, [
            P.kpi('Допущены', String(rows.length - red.length - amber.length), 'без замечаний', 'good'),
            P.kpi('С условием или с замечаниями', String(amber.length), 'документы истекают или допуск с условием', amber.length ? 'warn' : ''),
            P.kpi('Стоп: красная зона', String(red.length), red.map(function (r) { return r.s.name; }).join(', '), red.length ? 'bad' : 'good'),
            P.kpi('Документы истекают за ' + M.rules.docSoon + ' дн.', String(rows.reduce(function (x, r) { return x + r.soon; }, 0)), 'просрочено или нет: ' + rows.reduce(function (x, r) { return x + r.exp; }, 0), 'warn')
        ]));
        host.appendChild(P.el('div', { 'class': 'srm-bar' }, [P.tabs([['all', 'Все'], ['red', 'Красная зона'], ['amber', 'С замечаниями'], ['green', 'Допущены']], st.f, function (f) { st.f = f; render(host, M); })]));
        var list = rows.filter(function (r) { return st.f === 'all' || r.a.light === st.f; }).sort(function (a, b) { var o = { red: 0, amber: 1, green: 2 }; return o[a.a.light] - o[b.a.light] || b.spend - a.spend; });
        host.appendChild(P.table([
            { t: 'Поставщик', html: function (r) { return '<b>' + P.esc(r.s.name) + '</b><div class="srm-muted">ИНН ' + P.esc(r.s.inn) + ', ' + P.esc(r.s.city) + '</div>'; } },
            { t: 'Допуск', html: function (r) { return P.light(M, r.s.name) + (r.s.until ? '<div class="srm-muted">до ' + P.d(r.s.until) + '</div>' : ''); } },
            { t: 'Причина / замечания', html: function (r) { return P.esc(r.a.reasons.concat(r.a.warnings).join('; ') || r.s.reason || ''); } },
            { t: 'Категории', html: function (r) { return P.esc(r.s.cats.join(', ')); } },
            { t: 'Документы', html: function (r) { return M.hasDocs ? (r.exp ? P.badge(r.exp + ' просрочено', 'crit') + ' ' : '') + (r.soon ? P.badge(r.soon + ' истекает', 'warn') : '') + (!r.exp && !r.soon ? P.badge('в порядке', 'ok') : '') : '-'; } },
            { t: 'Траты 2026', num: true, html: function (r) { return r.spend ? P.money(r.spend) : '-'; } }
        ], list, { onrow: function (r) { cardOf(M, r.s); }, rowCls: function (r) { return r.a.light === 'red' ? 'srm-row-bad' : ''; } }));
    }
    P.mount(render);
})();
