/* PIM: сводка контент-менеджера. Готовность по площадкам, воронка статусов, чего не хватает чаще всего, очередь «почти готовых», журнал выгрузок. */
(function () {
    'use strict';
    var W = window.Pim, C = W.core;
    function kpi(v, label, sub, href) {
        var d = W.el('div', { 'class': 'pim-kpi' + (href ? ' pim-click' : ''), html: '<small>' + W.esc(label) + '</small><b>' + v + '</b><small>' + (sub || '') + '</small>' });
        if (href) d.addEventListener('click', function () { W.go('catalog', href); });
        return d;
    }
    W.mount(function (host) {
        return W.loadModel().then(function (M) {
            var cards = M.cards(), sum = C.summarize(cards, M.channels), tr = C.topReasons(sum, 7);
            var ready = sum.byStatus['Готово к выгрузке'] || 0;
            var fullAll = cards.filter(function (c) { return M.channels.every(function (ch) { return c.res[ch.name].pct >= 100; }); }).length;
            var lines = M.journalLines.filter(function (l) { return l['Результат']; }), rej = lines.filter(function (l) { return l['Результат'] === 'Отклонена'; }).length;
            host.innerHTML = '';
            host.appendChild(W.el('h1', { text: 'Сводка контент-менеджера' }));
            host.appendChild(W.el('p', { 'class': 'pim-sub', text: 'Данные на ' + W.dmy(W.TODAY) + '. Нажмите на показатель или строку, чтобы открыть нужные карточки.' }));
            host.appendChild(W.el('div', { 'class': 'pim-kpis' }, [
                kpi(sum.total, 'Карточек в мастере', M.categories ? Object.keys(M.categories).length + ' категорий' : '', ''),
                kpi(ready + ' <small>(' + Math.round(100 * ready / sum.total) + '%)</small>', 'Готово к выгрузке', 'статус «Готово к выгрузке»', 'status=' + encodeURIComponent('Готово к выгрузке')),
                kpi(fullAll, 'Полны на всех площадках', 'зелёные по всем четырём', ''),
                kpi(lines.length ? Math.round(100 * rej / lines.length) + '%' : '—', 'Отклонено при первой загрузке', rej + ' из ' + lines.length + ' строк в журнале', '')]));

            var left = W.el('div', { 'class': 'pim-card' }), right = W.el('div', { 'class': 'pim-card' });
            left.appendChild(W.el('h2', { text: 'Готовность по площадкам' }));
            left.appendChild(W.el('p', { 'class': 'pim-sub', text: 'Средняя полнота обязательных атрибутов и доля карточек со 100%.' }));
            M.channels.forEach(function (ch) {
                var o = sum.channels[ch.name], row = W.el('div', { 'class': 'pim-rowline', html: '<a class="pim-link">' + W.esc(W.short(ch.name)) + '</a>' + W.bar(o.avg) + '<b>' + o.avg + '%</b>' });
                row.querySelector('a').addEventListener('click', function () { W.go('catalog', 'chan=' + encodeURIComponent(ch.name)); });
                left.appendChild(row); left.appendChild(W.el('div', { 'class': 'pim-sub', style: 'margin:-4px 0 6px 160px', text: 'полностью готовы: ' + o.full + ' из ' + sum.total + ' (' + o.share + '%)' }));
            });
            left.appendChild(W.el('h2', { text: 'Воронка статусов' }));
            C.STATUSES.forEach(function (s) {
                var n = sum.byStatus[s] || 0, pct = Math.round(100 * n / sum.total), row = W.el('div', { 'class': 'pim-rowline', html: '<a class="pim-link">' + W.esc(s) + '</a><div class="pim-meter pim-meter-' + (s === 'Готово к выгрузке' ? 'ok' : s === 'На проверке' ? 'warn' : 'bad') + '"><span style="width:' + Math.max(2, pct) + '%"></span></div><b>' + n + '</b>' });
                row.querySelector('a').addEventListener('click', function () { W.go('catalog', 'status=' + encodeURIComponent(s)); });
                left.appendChild(row);
            });

            right.appendChild(W.el('h2', { text: 'Чего не хватает чаще всего' }));
            right.appendChild(W.table([{ k: 'label', t: 'Атрибут' }, { k: 'n', t: 'Карточек-площадок', num: true }, { t: 'Где', html: function (r) { return Object.keys(r.byCh).map(function (c) { return W.esc(W.short(c)) + ' ' + r.byCh[c]; }).join(' · '); } }], tr, { empty: 'Всё заполнено' }));
            var nearest = C.almostReady(cards, 'Ozon', 1).slice(0, 6);
            right.appendChild(W.el('h2', { text: 'Очередь: не хватает одного пункта для Ozon' }));
            right.appendChild(W.table([{ k: 'sku', t: 'Артикул' }, { t: 'Что осталось', html: function (r) { return W.esc(r.res['Ozon'].blockers[0].msg); } }, { k: 'status', t: 'Статус' }],
                nearest.map(function (c) { return { sku: c.p.sku, res: c.res, status: c.p.status, id: c.p.id }; }), { empty: 'Очередь пуста', onrow: function (r) { W.go('catalog', 'card=' + r.id); } }));

            host.appendChild(W.el('div', { 'class': 'pim-two' }, [left, right]));
            host.appendChild(W.el('h2', { text: 'Последние выгрузки' }));
            var ex = M.journal.slice().sort(function (a, b) { return W.iso(b['Дата выгрузки']) < W.iso(a['Дата выгрузки']) ? -1 : 1; }).slice(0, 6);
            host.appendChild(W.table([{ k: 'Выгрузка', t: 'Выгрузка' }, { k: 'Автор', t: 'Автор' }, { k: 'Строк', t: 'Строк', num: true }, { k: 'Ошибок', t: 'Ошибок', num: true }, { k: 'Получатель', t: 'Кому отдано' }], ex,
                { rowCls: function (r) { return C.num(r['Ошибок']) > 2 ? 'pim-row-warn' : ''; }, onrow: function () { W.go('feeds'); } }));
        });
    });
})();
