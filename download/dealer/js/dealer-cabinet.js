/* Кабинет дилера: цены уровня и договора, лимит, долг и просрочка, последние заказы и счета. Первый клик демо. */
(function () {
    'use strict';
    var P = window.Dealer, C = P.core;
    function render(host, M) {
        var d = P.dealer(M), S = P.dealerState(M, d), dbt = S.debt;
        host.innerHTML = '';
        var lvl = M.levels[d.level] || 0;
        host.appendChild(P.head(d.name, d.city + ' · уровень «' + d.level + '»' + (lvl ? ' (скидка ' + lvl + '% от базового прайса)' : '') + ' · отсрочка ' + d.delay + ' дн. · менеджер ' + (d.mgr || '-'),
            P.pickDealer(M, d, function () { render(host, M); })));
        /* главная боль: просрочка и лимит видны до оформления заказа */
        if (dbt.overdueDays >= M.rules.blockOverdue) host.appendChild(P.note('Просрочка оплаты ' + dbt.overdueDays + ' дн. (' + P.money(dbt.overdue) + '): новые заказы не принимаются, пока счёт не оплачен. Порог - ' + M.rules.blockOverdue + ' дн.', 'bad'));
        else if (dbt.overdueDays >= M.rules.approveOverdue) host.appendChild(P.note('Просрочка оплаты ' + dbt.overdueDays + ' дн. (' + P.money(dbt.overdue) + '): новый заказ уйдёт на согласование коммерческому директору. С ' + M.rules.blockOverdue + ' дн. просрочки заказ не принимается.', 'warn'));
        var k = P.el('div', { 'class': 'dl-kpis' });
        if (S.limit) {
            k.appendChild(P.kpi('Свободный лимит', P.money(S.limit.free), 'лимит ' + P.money(S.limit.limit) + ', занято ' + S.limit.pct + '%', S.limit.free <= 0 ? 'bad' : S.limit.pct >= 85 ? 'warn' : 'ok'));
        }
        k.appendChild(P.kpi('Долг по счетам', P.money(dbt.debt), dbt.nextDue ? 'ближайший срок ' + P.dmy(dbt.nextDue) : 'нет счетов к оплате'));
        k.appendChild(P.kpi('Просрочено', P.money(dbt.overdue), dbt.overdueDays ? 'максимум ' + dbt.overdueDays + ' дн.' : 'просрочки нет', dbt.overdue > 0 ? 'bad' : 'ok'));
        k.appendChild(P.kpi('Заказы в работе', P.money(S.open), 'заняли лимит, счёта ещё нет'));
        host.appendChild(k);
        if (S.limit) host.appendChild(P.el('div', { 'class': 'dl-card' }, [P.el('div', { 'class': 'dl-muted', text: 'Кредитный лимит: синим - долг и заказы в работе' }), P.limitBar(S.limit, 0),
            P.el('div', { 'class': 'dl-actions' }, [P.btn('Собрать заказ из прайса', function () { P.go('catalog', 'd=' + d.id); }, 'dl-primary'), P.btn('Все заказы', function () { P.go('orders', 'd=' + d.id); })])]));
        var grid = P.el('div', { 'class': 'dl-grid' });
        var my = M.orders.filter(function (o) { return o.dealer === d.name; }).slice(0, 8);
        var shipBy = {}; M.ships.forEach(function (s) { shipBy[s.order] = s; });
        grid.appendChild(P.section('Последние заказы', [P.table([
            { t: 'Заказ', html: function (o) { return '<b>' + P.esc(o.no) + '</b><span class="dl-rule">' + P.dmy(o.date) + '</span>'; } },
            { t: 'Статус', html: function (o) { return P.badge(o.status, P.statusKind(o.status)); } },
            { t: 'Отгрузка', html: function (o) { var s = shipBy[o.no]; return s ? P.esc(s.car) + '<span class="dl-rule">' + P.esc(s.ttn) + ' · ' + P.esc(s.st) + '</span>' : '<span class="dl-muted">-</span>'; } },
            { t: 'Сумма', num: true, html: function (o) { return P.money(o.sum); } }
        ], my, { onrow: function (o) { P.go('orders', 'd=' + d.id + '&o=' + o.id); }, empty: 'Заказов нет' })]));
        grid.appendChild(P.section('Счета к оплате', [M.canInvoices ? P.table([
            { t: 'Счёт', html: function (i) { return '<b>' + P.esc(i.no) + '</b><span class="dl-rule">по заказу ' + P.esc(i.order) + '</span>'; } },
            { t: 'Срок оплаты', html: function (i) { return P.dmy(i.due) + (i.late ? ' ' + P.badge('просрочка ' + i.late + ' дн.', 'bad') : ''); } },
            { t: 'К оплате', num: true, html: function (i) { return P.money(i.rest); } }
        ], dbt.open, { rowCls: function (i) { return i.late ? 'dl-row-bad' : ''; }, empty: 'Долга нет' }) : P.note('Счета этой роли не видны', 'info')]));
        host.appendChild(grid);
        /* «почему не та цена»: условия договора с датами, истёкшие - тоже */
        var conds = M.conds.filter(function (c) { return c.dealer === d.name; });
        var rows = [{ what: 'Все товары', rule: 'Скидка уровня «' + d.level + '»', val: lvl + '%', until: '', live: true }].concat(conds.map(function (c) {
            return { what: c.kind === 'Спеццена' ? c.product : 'Группа «' + c.group + '»', rule: c.kind, val: c.kind === 'Спеццена' ? P.money(c.price) + ' (база ' + P.money((M.prodBy[c.product] || {}).base) + ')' : c.pct + '%', until: c.until, live: !c.until || c.until >= M.today };
        }));
        host.appendChild(P.section('Ваши условия цены', [P.el('p', { 'class': 'dl-muted', text: 'Цена в каталоге считается по этим условиям в момент заказа: спеццена сильнее скидок, из скидки уровня и договорной скидки на группу берётся большая. Истёкшее условие не действует - цена возвращается к скидке уровня.' }),
            P.table([{ t: 'На что', k: 'what' }, { t: 'Условие', k: 'rule' }, { t: 'Размер', k: 'val', num: true },
                { t: 'Действует', html: function (r) { return r.until ? (r.live ? 'до ' + P.dmy(r.until) : P.badge('истекло ' + P.dmy(r.until), 'bad')) : 'бессрочно'; } }], rows, { rowCls: function (r) { return r.live ? '' : 'dl-row-bad'; } })]));
        if (!M.isDealer) host.appendChild(P.note('Это кабинет глазами закупщика. Переключите дилера вверху: цены, каталог, лимит и долг меняются. Сам закупщик видит только своего дилера (маска роли).', 'info'));
    }
    P.mount(render);
})();
