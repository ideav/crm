/* Дилеры и дебиторка: лимит, долг, просрочка и старение долга по всем дилерам; директор правит лимит и отсрочку. */
(function () {
    'use strict';
    var P = window.Dealer, C = P.core;
    var sortKey = 'overdue';
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.head('Дилеры и дебиторка', 'Сводка на ' + P.dmy(M.today) + ': кредитный лимит, долг по счетам, просрочка и заказы в работе. Красные строки - заказ дилера уйдёт на согласование или не будет принят.'));
        var ag = C.aging(M.invoices, M.today), rows = M.dealers.map(function (d) {
            var S = P.dealerState(M, d), last = M.orders.filter(function (o) { return o.dealer === d.name && o.status !== 'Черновик'; })[0];
            var turn = M.orders.filter(function (o) { return o.dealer === d.name && C.diffDays(o.date, M.today) <= 90 && ['Отгружен', 'Доставлен'].indexOf(o.status) >= 0; }).reduce(function (s, o) { return s + o.sum; }, 0);
            return { d: d, debt: S.debt.debt, overdue: S.debt.overdue, days: S.debt.overdueDays, open: S.open, limit: S.limit, free: S.limit ? S.limit.free : 0, pct: S.limit ? S.limit.pct : 0, last: last ? last.date : '', turn: turn };
        });
        var k = P.el('div', { 'class': 'dl-kpis' });
        k.appendChild(P.kpi('Дебиторка всего', P.money(ag.current + ag.d15 + ag.d30 + ag.over30), M.dealers.length + ' дилеров'));
        k.appendChild(P.kpi('Срок не наступил', P.money(ag.current), '', 'ok'));
        k.appendChild(P.kpi('Просрочка 1-15 дн.', P.money(ag.d15), '', ag.d15 ? 'warn' : ''));
        k.appendChild(P.kpi('Просрочка 16-30 дн.', P.money(ag.d30), '', ag.d30 ? 'warn' : ''));
        k.appendChild(P.kpi('Просрочка больше 30 дн.', P.money(ag.over30), 'заказы не принимаются', ag.over30 ? 'bad' : ''));
        host.appendChild(k);
        var sorts = { overdue: function (a, b) { return b.days - a.days || b.overdue - a.overdue; }, free: function (a, b) { return a.free - b.free; }, turn: function (a, b) { return b.turn - a.turn; } };
        rows.sort(sorts[sortKey]);
        host.appendChild(P.tabs([['overdue', 'По просрочке'], ['free', 'По свободному лимиту'], ['turn', 'По обороту за 90 дн.']], sortKey, function (s) { sortKey = s; render(host, M); }));
        var canEdit = P.canWrite('Дилер');
        var cols = [
            { t: 'Дилер', html: function (r) { return '<b>' + P.esc(r.d.name) + '</b><span class="dl-rule">' + P.esc(r.d.city + ' · ' + r.d.level + ' · ' + (r.d.mgr || '')) + '</span>'; } },
            { t: 'Лимит', num: true, html: function (r) { return r.limit ? P.money(r.limit.limit) + '<span class="dl-rule">занято ' + r.pct + '%</span>' : '-'; } },
            { t: 'Свободно', num: true, html: function (r) { return r.limit ? (r.free < 0 ? '<span class="dl-red">' + P.money(r.free) + '</span>' : P.money(r.free)) : '-'; } },
            { t: 'Долг', num: true, html: function (r) { return P.money(r.debt); } },
            { t: 'Просрочено', num: true, html: function (r) { return r.overdue > 0 ? '<span class="dl-red">' + P.money(r.overdue) + '</span><span class="dl-rule">' + r.days + ' дн.</span>' : '-'; } },
            { t: 'В работе', num: true, html: function (r) { return P.money(r.open); } },
            { t: 'Оборот 90 дн.', num: true, html: function (r) { return P.money(r.turn); } },
            { t: 'Последний заказ', html: function (r) { return r.last ? P.dmy(r.last) : '-'; } },
            { t: 'Заказ', html: function (r) { return r.days >= M.rules.blockOverdue ? P.badge('блок', 'bad') : r.days >= M.rules.approveOverdue || r.free <= 0 ? P.badge('согласование', 'warn') : P.badge('сразу', 'ok'); } }
        ];
        host.appendChild(P.table(cols, rows, { rowCls: function (r) { return r.days >= M.rules.approveOverdue || r.free < 0 ? 'dl-row-bad' : ''; }, onrow: function (r) { open(host, M, r, canEdit); } }));
        host.appendChild(P.el('p', { 'class': 'dl-muted', text: 'Правила: согласование при просрочке от ' + M.rules.approveOverdue + ' дн., блок заказа от ' + M.rules.blockOverdue + ' дн., порог маржи ' + M.rules.marginMin + '%, допуск сверх лимита ' + M.rules.limitTolerance + '%. Меняются в таблице «Правило портала».' }));
    }
    function open(host, M, r, canEdit) {
        var d = r.d, lim = P.input('number', d.limit || 0, { min: 0, step: 50000 }), del = P.input('number', d.delay, { min: 0, max: 120 });
        var body = P.el('div', {}, [P.el('p', { 'class': 'dl-muted', text: d.name + ', ИНН ' + d.inn + ', склад отгрузки «' + d.wh + '», группы: ' + (d.groups.length ? d.groups.join(', ') : 'все') }),
            canEdit ? P.el('div', { 'class': 'dl-grid' }, [P.field('Кредитный лимит, ₽', lim), P.field('Отсрочка, дней', del)]) : null]);
        var b = [{ text: 'Кабинет дилера', fn: function () { P.go('cabinet', 'd=' + d.id); } }, { text: 'Заказы', fn: function () { P.go('orders', 'd=' + d.id); } }];
        if (canEdit) b.push({ text: 'Сохранить условия', cls: 'dl-primary', fn: function (close) { P.update(d.id, { 'Кредитный лимит': C.num(lim.value), 'Отсрочка, дней': C.num(del.value) }).then(function () { close(); P.toast('Условия дилера сохранены'); P.remount(render); }).catch(function (e) { P.toast(e.message, true); }); return false; } });
        b.push({ text: 'Закрыть' });
        P.modal(d.name, body, b);
    }
    P.mount(render);
})();
