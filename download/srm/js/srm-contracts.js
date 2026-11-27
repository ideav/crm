/* SRM: Договоры и поставки. Этапы и календарь поставок, просрочки, исполнение «вовремя и полностью» по поставщикам, отметка приёмки. */
(function () {
    'use strict';
    var P = window.Srm, C = P.core;
    var st = { c: P.hash().c || '' };
    var STATE = { otif: ['вовремя и полностью', 'ok'], late: ['с опозданием', 'warn'], short: ['недопоставка', 'warn'], overdue: ['просрочен', 'crit'], wait: ['ожидается', 'info'] };

    function accept(M, c, s) {
        var fact = P.input('date', P.TODAY), qty = P.input('number', s.qty, { step: 'any' });
        P.modal('Приёмка: ' + c.num + ', ' + s.name, P.el('div', {}, [P.field('Дата поставки', fact), P.field('Принято, ' + ((M.noms[c.nom] || {}).unit || ''), qty, 'План: ' + s.qty + ' к ' + P.d(s.plan))]), [{ text: 'Отмена' }, { text: 'Записать приёмку', cls: 'srm-primary', fn: function (close, b) {
            b.disabled = true;
            P.rows('Этап поставки', '&F_U=' + c.id).then(function (list) {
                var row = (list || []).filter(function (x) { return x['Этап поставки'] === s.name; })[0]; if (!row) throw new Error('Этап не найден');
                return P.update(row._id, { 'Фактическая дата': fact.value, 'Принято по этапу': C.num(qty.value) });
            }).then(function () { P.toast('Приёмка записана'); close(); P.reload(); }).catch(function (e) { P.toast(e.message, true); b.disabled = false; });
            return false;
        } }]);
    }
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('h1', { text: 'Договоры и поставки' }));
        host.appendChild(P.el('p', { 'class': 'srm-sub', text: 'Договор рождается из выбранного КП вместе с этапами поставки. Здесь видно, что едет на заводы в ближайшие недели, что просрочено и кто из поставщиков возит вовремя и полностью.' }));
        var cBy = {}; M.contracts.forEach(function (c) { cBy[c.num] = c; });
        var stg = M.stagesList.map(function (s) { var c = cBy[s.contract] || {}; return Object.assign({}, s, { c: c, state: C.stageState(s, M.today) }); });
        var o = C.otif(stg, M.today), soon = stg.filter(function (s) { return s.state === 'wait' && C.diffDays(M.today, s.plan) <= 21; }).sort(function (a, b) { return a.plan < b.plan ? -1 : 1; });
        var active = M.contracts.filter(function (c) { return c.state !== 'Исполнен'; });
        host.appendChild(P.el('div', { 'class': 'srm-kpis' }, [
            P.kpi('Договоры в исполнении', String(active.length), P.mln(active.reduce(function (x, c) { return x + c.sum; }, 0))),
            P.kpi('Вовремя и полностью (OTIF)', o.pct === null ? '-' : o.pct + '%', o.good + ' из ' + o.done + ' поставок 2026', o.pct >= 85 ? 'good' : 'warn'),
            P.kpi('Просрочены сейчас', String(o.overdue.length), o.overdue.map(function (s) { return s.contract; }).join(', ') || 'нет', o.overdue.length ? 'bad' : 'good'),
            P.kpi('Поставки на 3 недели', String(soon.length), soon.length ? 'ближайшая ' + P.d(soon[0].plan) : '')
        ]));
        if (o.overdue.length) {
            host.appendChild(P.el('h2', { text: 'Просроченные поставки' }));
            host.appendChild(P.table([{ t: 'Договор', html: function (s) { return '<b>' + P.esc(s.contract) + '</b> ' + P.esc(s.name); } }, { t: 'Поставщик', k: 'sup' }, { t: 'Завод', html: function (s) { return P.esc(s.c.plant || ''); } }, { t: 'Позиция', html: function (s) { return P.esc((s.c.nom || '') + ', ' + s.qty); } }, { t: 'План', html: function (s) { return P.d(s.plan) + ' ' + P.badge('+' + C.diffDays(s.plan, M.today) + ' дн.', 'crit'); } },
                { t: '', node: function (s) { return P.canWrite('Этап поставки') ? P.btn('Приёмка', function () { accept(M, s.c, s); }, 'srm-small') : null; } }], stg.filter(function (s) { return s.state === 'overdue'; }), { rowCls: function () { return 'srm-row-bad'; } }));
        }
        var two = P.el('div', { 'class': 'srm-two' }), l = P.el('div', {}), r = P.el('div', {});
        l.appendChild(P.el('h2', { text: 'Календарь поставок: 3 недели' }));
        l.appendChild(P.table([{ t: 'Дата', html: function (s) { return '<b>' + P.d(s.plan) + '</b>'; } }, { t: 'Что', html: function (s) { return P.esc((s.c.nom || '') + ', ' + s.qty + ' ' + ((M.noms[s.c.nom] || {}).unit || '')) + '<div class="srm-muted">' + P.esc(s.contract + ' ' + s.name + ', ' + s.sup) + '</div>'; } }, { t: 'Завод', html: function (s) { return P.esc(s.c.plant || ''); } },
            { t: '', node: function (s) { return P.canWrite('Этап поставки') ? P.btn('Приёмка', function () { accept(M, s.c, s); }, 'srm-small') : null; } }], soon, { empty: 'Поставок в ближайшие недели нет' }));
        var bySup = {}; stg.forEach(function (s) { (bySup[s.sup] = bySup[s.sup] || []).push(s); });
        var sr = Object.keys(bySup).map(function (k) { var x = C.otif(bySup[k], M.today); return { sup: k, o: x }; }).filter(function (x) { return x.o.done; }).sort(function (a, b) { return a.o.pct - b.o.pct; });
        r.appendChild(P.el('h2', { text: 'Исполнение по поставщикам' }));
        r.appendChild(P.table([{ t: 'Поставщик', k: 'sup' }, { t: 'OTIF', num: true, html: function (x) { return P.badge(x.o.pct + '%', x.o.pct >= 85 ? 'ok' : x.o.pct >= 60 ? 'warn' : 'crit'); } }, { t: 'Поставок', num: true, html: function (x) { return x.o.good + ' из ' + x.o.done; } }, { t: 'Просрочено', num: true, html: function (x) { return String(x.o.overdue.length); } }], sr));
        two.appendChild(l); two.appendChild(r); host.appendChild(two);
        host.appendChild(P.el('h2', { text: 'Реестр договоров' }));
        var list = M.contracts.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
        host.appendChild(P.table([
            { t: 'Договор', html: function (c) { return '<b>' + P.esc(c.num) + '</b><div class="srm-muted">' + P.d(c.date) + ', ' + P.esc(c.req) + '</div>'; } },
            { t: 'Поставщик', html: function (c) { return P.light(M, c.sup) + ' ' + P.esc(c.sup); } },
            { t: 'Завод', k: 'plant' },
            { t: 'Позиция', html: function (c) { return P.esc((c.nom || '') + ', ' + c.qty + ' ' + ((M.noms[c.nom] || {}).unit || '')); } },
            { t: 'Сумма', num: true, html: function (c) { return P.money(c.sum); } },
            { t: 'Этапы', html: function (c) { return stg.filter(function (s) { return s.contract === c.num; }).map(function (s) { var x = STATE[s.state]; return '<span title="' + P.esc(s.name + ': план ' + P.d(s.plan) + (s.fact ? ', факт ' + P.d(s.fact) : '') + ', ' + x[0]) + '">' + P.badge(P.d(s.plan).slice(0, 5), x[1]) + '</span>'; }).join(' '); } },
            { t: 'Состояние', html: function (c) { return P.badge(c.state, c.state === 'Исполнен' ? 'mute' : 'info'); } }
        ], list, { rowCls: function (c) { return c.num === st.c ? 'srm-row-sel' : ''; } }));
    }
    P.mount(render);
})();
