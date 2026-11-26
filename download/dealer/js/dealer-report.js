/* Отчёт дилера по единой форме: продажи и остаток у дилера за месяц. Дилер сдаёт, менеджер видит, кто не сдал. */
(function () {
    'use strict';
    var P = window.Dealer, C = P.core;
    var PERIODS = ['2026-11', '2026-10', '2026-09'];
    function render(host, M) {
        host.innerHTML = '';
        if (M.isDealer) return dealerForm(host, M, M.dealers[0]);
        var period = P.hash().p || '2026-10';
        host.appendChild(P.head('Отчёты дилеров', 'Единая форма: продажи и остаток у дилера по товарам за месяц, срок сдачи - 5-е число следующего месяца.'));
        var ps = P.select(PERIODS, period);
        ps.addEventListener('change', function () { P.setHash({ p: ps.value }); render(host, M); });
        host.appendChild(P.el('div', { 'class': 'dl-bar-row' }, [P.field('Период', ps)]));
        var miss = C.missingReports(M.dealers, M.reports, period), due = C.reportDue(period);
        host.appendChild(P.note(miss.length ? 'Срок сдачи ' + P.dmy(due) + (due < M.today ? ' прошёл' : '') + '. Не сдали (' + miss.length + ' из ' + M.dealers.length + '): ' + miss.join(', ') : 'Все дилеры сдали отчёт за ' + period, miss.length && due < M.today ? 'warn' : 'info'));
        var rows = M.reports.filter(function (r) { return r.period === period; });
        var by = {}; rows.forEach(function (r) { var k = r.product; by[k] = by[k] || { product: k, sold: 0, stock: 0, n: 0 }; by[k].sold += r.sold; by[k].stock += r.stock; by[k].n++; });
        var grid = P.el('div', { 'class': 'dl-grid' });
        grid.appendChild(P.section('Продажи дилеров по товарам', [P.table([{ t: 'Товар', k: 'product' }, { t: 'Продано', num: true, k: 'sold' }, { t: 'Остаток у дилеров', num: true, k: 'stock' }, { t: 'Дилеров', num: true, k: 'n' }], Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.sold - a.sold; }))]));
        grid.appendChild(P.section('Строки отчётов', [P.table([{ t: 'Дилер', k: 'dealer' }, { t: 'Товар', k: 'product' }, { t: 'Продано', num: true, k: 'sold' }, { t: 'Остаток', num: true, k: 'stock' }], rows)]));
        host.appendChild(grid);
    }
    function dealerForm(host, M, d) {
        var period = '2026-11', due = C.reportDue(period), mine = M.reports.filter(function (r) { return r.dealer === d.name; });
        var done = mine.some(function (r) { return r.period === period; });
        host.appendChild(P.head('Отчёт дилера', d.name + ': продажи и остаток у вас на складе по нашим товарам за месяц. Срок сдачи за ' + period + ' - ' + P.dmy(due) + '.'));
        host.appendChild(P.note(done ? 'Отчёт за ' + period + ' сдан. Можно дополнить строками.' : 'Отчёт за ' + period + ' ещё не сдан.', done ? 'ok' : 'warn'));
        var cat = C.catalogFor(M.products, d), tbody = P.el('div', {}), lines = [];
        function addLine(pr) {
            var s = P.select([['', 'Выберите товар']].concat(cat.map(function (p) { return [p.name, p.art + ' ' + p.name]; })), pr || ''), sold = P.input('number', '', { min: 0 }), stock = P.input('number', '', { min: 0 });
            var row = P.el('div', { 'class': 'dl-bar-row' }, [P.el('div', { 'class': 'dl-grow' }, [P.field('Товар', s)]), P.field('Продано', sold), P.field('Остаток у вас', stock)]);
            lines.push({ s: s, sold: sold, stock: stock }); tbody.appendChild(row);
        }
        /* подсказка: товары из прошлого отчёта - первыми строками формы */
        var bought = [];
        mine.filter(function (r) { return r.period === '2026-10'; }).slice(0, 3).forEach(function (r) { bought.push(r.product); });
        (bought.length ? bought : [cat[0].name]).forEach(addLine);
        var form = P.section('Строки отчёта за ' + period, [tbody, P.el('div', { 'class': 'dl-actions' }, [P.btn('+ строка', function () { addLine(); }), P.btn('Сдать отчёт', submit, 'dl-primary')])]);
        host.appendChild(form);
        function submit() {
            var ops = [], errs = [];
            lines.forEach(function (l) {
                if (!l.s.value && !l.sold.value) return;
                var r = { period: period, product: l.s.value, sold: l.sold.value, stock: l.stock.value }, e = C.checkReportRow(r);
                if (e.length) { errs.push((l.s.value || 'строка') + ': ' + e.join(', ')); return; }
                var p = M.prodBy[l.s.value];
                ops.push({ op: 'new', id: 'Отчёт дилера', up: 1, fields: { 'Отчёт дилера': d.name.replace(/^ООО |«|»/g, '') + ' / ' + period + ' / ' + p.art, 'Дилер': d.id, 'Период отчёта': period, 'Товар': p.id, 'Продано': C.num(l.sold.value), 'Остаток у дилера': C.num(l.stock.value) } });
            });
            if (errs.length) return P.toast(errs.join('; '), true);
            if (!ops.length) return P.toast('Заполните хотя бы одну строку', true);
            P.batch(ops).then(function () { P.toast('Отчёт за ' + period + ' сдан: ' + ops.length + ' строк'); P.remount(render); }).catch(function (e) { P.toast(e.message, true); });
        }
        var prev = mine.filter(function (r) { return r.period !== period || done; });
        host.appendChild(P.section('Сданные отчёты', [P.table([{ t: 'Период', k: 'period' }, { t: 'Товар', k: 'product' }, { t: 'Продано', num: true, k: 'sold' }, { t: 'Остаток у вас', num: true, k: 'stock' }], prev, { empty: 'Отчётов ещё не было' })]));
    }
    P.mount(render);
})();
