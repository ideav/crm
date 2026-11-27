/* CPM: план-факт - отклонение больше порога без пояснения автоматически становится запросом ответственному. */
(function () {
    'use strict';
    var P = window.Cpm, C = P.core;
    var PCT = 5, ABS = 300000;
    function m(x) { return P.k(x); }
    function render(host, M) {
        var h = P.hash();
        var sel = h.m === undefined ? '9' : h.m, all = h.all === '1';
        var months = sel === 'ytd' ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] : [+sel];
        var pf = C.planFact(M.rows, P.PLAN, P.FACT, months, { pct: PCT, abs: ABS, year: 2026 }, M.articles, M.notes);
        var over = pf.filter(function (x) { return x.over; }), need = over.filter(function (x) { return x.needNote; });
        var toAsk = need.filter(function (x) { return !x.note; });
        var late = need.filter(function (x) { return x.note && x.note.status === 'Запрошено' && x.note.due && x.note.due < P.TODAY; });
        host.innerHTML = '';
        P.head('План-факт', 'Утверждённый бюджет 2026 против факта из учётной системы (загружен по 31.10.2026). Отклонение больше ' + PCT + '% и больше ' + P.k(ABS) + ' тыс. ₽ требует пояснения: ответственный получает запрос со сроком, комитет видит, кто не ответил. Суммы в тыс. ₽.').forEach(function (n) { host.appendChild(n); });
        var ms = P.select([['ytd', 'С начала года (янв-окт)']].concat(C.MONTHS.slice(0, 10).map(function (x, i) { return [String(i), x + ' 2026']; })), sel);
        ms.addEventListener('change', function () { location.hash = 'm=' + ms.value + (all ? '&all=1' : ''); });
        var cb = P.input('checkbox', '', {}); cb.checked = all; cb.addEventListener('change', function () { location.hash = 'm=' + sel + (cb.checked ? '&all=1' : ''); });
        var bar = P.el('div', { 'class': 'cpm-toolbar' }, [P.field('Период', ms), P.el('label', { 'class': 'cpm-muted' }, [cb, ' показать все статьи']), P.el('div', { 'class': 'cpm-grow' })]);
        if (M.isFinance && toAsk.length) bar.appendChild(P.btn('Запросить пояснения (' + toAsk.length + ')', ask, 'cpm-primary'));
        host.appendChild(bar);
        var tp = 0, tf = 0; pf.forEach(function (x) { if (!x.income) { tp += x.plan; tf += x.fact; } });
        host.appendChild(P.el('div', { 'class': 'cpm-kpis' }, [
            P.kpi('Отклонений выше порога', String(over.length), PCT + '% и ' + P.k(ABS) + ' тыс. ₽', over.length ? 'warn' : 'good'),
            P.kpi('Без пояснения', String(need.length), toAsk.length ? 'запрос ещё не отправлен: ' + toAsk.length : 'запросы отправлены', need.length ? 'bad' : 'good'),
            P.kpi('Пояснение просрочено', String(late.length), 'срок ответа прошёл', late.length ? 'bad' : ''),
            P.kpi('Расходы: факт к плану', P.pct(C.growthPct(tf, tp), true), m(tf) + ' из ' + m(tp))
        ]));
        var rows = all ? pf : over;
        host.appendChild(P.table([
            { t: 'ЦФО', k: 'cfo' }, { t: 'Статья', k: 'article' },
            { t: 'План', num: true, html: function (r) { return m(r.plan); } }, { t: 'Факт', num: true, html: function (r) { return m(r.fact); } },
            { t: 'Отклонение', num: true, html: function (r) { return (r.dev > 0 ? '+' : '') + m(r.dev); }, cls: function (r) { return r.over ? (r.bad ? 'cpm-up' : 'cpm-down') : ''; } },
            { t: '%', num: true, html: function (r) { return P.pct(r.pct, true); }, cls: function (r) { return r.over ? (r.bad ? 'cpm-up' : 'cpm-down') : ''; } },
            { t: 'Пояснение', html: function (r) {
                if (!r.over) return '<span class="cpm-muted">в пределах порога</span>';
                var n = r.note;
                if (n && n.status === 'Дано') return P.badge('дано', 'ok') + ' ' + P.esc(n.text) + ' <span class="cpm-muted">(' + P.esc(n.author) + ')</span>';
                if (n) return P.badge('запрошено, срок ' + P.date(n.due), n.due < P.TODAY ? 'crit' : 'warn') + ' <span class="cpm-muted">ответственный: ' + P.esc((M.cfoBy[r.cfo] || {}).head || '') + '</span>';
                return P.badge('нет пояснения', 'crit');
            } },
            { t: '', html: function () { return ''; } }
        ], rows, { empty: 'Отклонений выше порога нет', rowCls: function (r) { return r.needNote ? 'cpm-row-bad' : ''; } }));
        var trs = host.querySelectorAll('.cpm-table tbody tr');
        rows.forEach(function (r, i) {
            if (!trs[i] || !r.needNote) return;
            if (M.isHead && r.cfo === M.myCfo || M.isFinance) trs[i].lastChild.appendChild(P.btn('Дать пояснение', function () { explain(r); }, 'cpm-small'));
        });
        function ask() {
            var ops = toAsk.map(function (r) {
                return { op: 'new', id: 'Пояснение отклонения', up: 1, fields: { 'Пояснение отклонения': r.cfo + ' · ' + r.article + ' · ' + r.period.slice(5, 7) + '.' + r.period.slice(0, 4), 'ЦФО': M.cfoBy[r.cfo].id, 'Статья бюджета': M.artIds[r.article], 'Период пояснения': r.period, 'Статус пояснения': 'Запрошено', 'Срок пояснения': C.addDays(P.TODAY, 3) } };
            });
            P.batch(ops).then(function () { return P.log('План-факт: запрошено пояснений ' + ops.length + ' (срок ' + P.date(C.addDays(P.TODAY, 3)) + ')'); })
                .then(function () { P.toast('Запросы отправлены ответственным: ' + ops.length); P.mount(render); }).catch(function (e) { P.toast(e.message, true); });
        }
        function explain(r) {
            var ta = P.el('textarea', { rows: 3, style: 'width:100%' });
            P.modal(r.cfo + ': ' + r.article, P.el('div', {}, [P.el('p', { text: 'План ' + m(r.plan) + ', факт ' + m(r.fact) + ' тыс. ₽ (' + P.pct(r.pct, true) + '). Причина и мера:' }), ta]), [{ text: 'Отмена' }, { text: 'Сохранить', cls: 'cpm-primary', fn: function () {
                var t = ta.value.trim(); if (!t) { P.toast('Напишите пояснение', true); return false; }
                var f = { 'Статус пояснения': 'Дано', 'Текст пояснения': t, 'Автор пояснения': P.ctx.user };
                var p = r.note ? P.update(r.note.id, f) : P.create('Пояснение отклонения', Object.assign({ 'Пояснение отклонения': r.cfo + ' · ' + r.article + ' · ' + r.period.slice(5, 7) + '.' + r.period.slice(0, 4), 'ЦФО': M.cfoBy[r.cfo].id, 'Статья бюджета': M.artIds[r.article], 'Период пояснения': r.period, 'Срок пояснения': P.TODAY }, f));
                p.then(function () { P.toast('Пояснение сохранено'); P.mount(render); }).catch(function (e) { P.toast(e.message, true); });
            } }]);
        }
    }
    P.mount(render);
    window.addEventListener('hashchange', function () { P.mount(render); });
})();
