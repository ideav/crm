/* Согласования: очередь коммерческого директора (сверх лимита, при просрочке, цена ниже маржи), решение в один клик, журнал. */
(function () {
    'use strict';
    var P = window.Dealer, C = P.core;
    function render(host, M) {
        host.innerHTML = '';
        var queue = M.orders.filter(function (o) { return o.status === 'На согласовании'; });
        host.appendChild(P.head('Согласования', 'Нестандартные заказы: сверх кредитного лимита, при просрочке оплаты, по цене ниже порога маржи (' + M.rules.marginMin + '%). Решение сразу меняет статус заказа у дилера и на складе.'));
        var can = P.canWrite('Согласование');
        if (!can) host.appendChild(P.note('Решения принимает коммерческий директор; у этой роли очередь только для просмотра.', 'info'));
        if (!queue.length) host.appendChild(P.note('Очередь пуста: все заказы согласованы.', 'ok'));
        var wrap = P.el('div', {}); host.appendChild(wrap);
        queue.forEach(function (o) { wrap.appendChild(card(host, M, o, can)); });
        var log = M.approvals.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
        host.appendChild(P.section('Журнал решений', [P.table([{ t: 'Номер', k: 'no' }, { t: 'Заказ', k: 'order' }, { t: 'Причина', k: 'reason' }, { t: 'Решение', html: function (a) { return P.badge(a.decision, a.decision === 'Одобрено' ? 'ok' : 'bad'); } }, { t: 'Кто', k: 'who' }, { t: 'Дата', html: function (a) { return P.dmy(a.date); } }, { t: 'Детали', k: 'detail' }], log, { empty: 'Решений ещё нет' })]));
    }
    function card(host, M, o, can) {
        var d = M.dealerBy[o.dealer] || { name: o.dealer }, S = P.dealerState(M, d), ex = C.openOrdersSum(M.orders, d.name, o.id);
        var st = S.limit ? C.limitState(d, S.debt.debt, ex) : null;
        var reasons = (o.reason || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        var box = P.el('section', { 'class': 'dl-card' });
        box.appendChild(P.el('div', { 'class': 'dl-head' }, [P.el('div', {}, [P.el('h2', { html: P.esc(o.no) + ' · ' + P.esc(o.dealer) + ' · ' + P.money(o.sum) }), P.el('div', { html: reasons.map(function (r) { return P.badge(r, 'warn'); }).join(' ') + ' <span class="dl-muted">от ' + P.dmy(o.date) + ', уровень «' + P.esc(d.level || '') + '»</span>' })])]));
        var k = P.el('div', { 'class': 'dl-kpis' });
        if (st) k.appendChild(P.kpi('Лимит / с заказом', P.money(st.limit), 'занято без заказа ' + P.money(st.used) + ', с заказом ' + P.money(st.used + o.sum), st.used + o.sum > st.limit ? 'bad' : 'ok'));
        k.appendChild(P.kpi('Просрочено', P.money(S.debt.overdue), S.debt.overdueDays ? S.debt.overdueDays + ' дн.' : 'нет', S.debt.overdue > 0 ? 'bad' : 'ok'));
        k.appendChild(P.kpi('Долг всего', P.money(S.debt.debt), 'отсрочка ' + (d.delay || 0) + ' дн.'));
        box.appendChild(k);
        if (o.details) box.appendChild(P.el('div', { 'class': 'dl-note dl-note-warn', html: P.esc(o.details).replace(/\n/g, '<br>') }));
        var lineBox = P.el('div', {}, [P.el('p', { 'class': 'dl-muted', text: 'Состав заказа загружается...' })]);
        box.appendChild(lineBox);
        P.lines(o.id).then(function (ls) {
            lineBox.innerHTML = '';
            var cols = [{ t: 'Товар', html: function (l) { return P.esc(l.product) + '<span class="dl-rule">' + P.esc(l.rule) + '</span>'; } }, { t: 'Кол-во', num: true, k: 'qty' }, { t: 'Цена', num: true, html: function (l) { return P.money(l.price); } }];
            if (M.canCost) cols.push({ t: 'Маржа', num: true, html: function (l) { var p = M.prodBy[l.product], m = p ? C.marginPct(l.price, p.cost) : null; return m !== null && m < M.rules.marginMin ? '<span class="dl-red">' + P.pct(m) + '</span>' : P.pct(m); } });
            cols.push({ t: 'Сумма', num: true, html: function (l) { return P.money(l.qty * l.price); } });
            lineBox.appendChild(P.table(cols, ls));
        });
        if (can) {
            var note = P.input('text', '', { placeholder: 'Комментарий дилеру (необязательно)' });
            box.appendChild(P.el('div', { 'class': 'dl-actions' }, [P.el('div', { 'class': 'dl-grow' }, [note]),
                P.btn('Одобрить', function () { decide(M, o, reasons, 'Одобрено', note.value); }, 'dl-ok-btn'),
                P.btn('Отклонить', function () { decide(M, o, reasons, 'Отклонено', note.value); }, 'dl-danger')]));
        }
        return box;
    }
    /* Решение: запись в журнал по каждой причине и новый статус заказа. */
    function decide(M, o, reasons, decision, comment) {
        var nos = M.approvals.map(function (a) { return a.no; }), ops = [], apps = [];
        (reasons.length ? reasons : ['Согласование']).forEach(function (r) {
            var no = C.nextNumber(nos, 'СГ-26-'); nos.push(no);
            apps.push({ decision: decision });
            ops.push({ op: 'new', id: 'Согласование', up: 1, fields: { 'Согласование': no, 'Заказ дилера': o.id, 'Причина согласования': r, 'Детали согласования': (o.details || '') + (comment ? '\nКомментарий: ' + comment : ''), 'Решение': decision, 'Согласовал': P.ctx.user, 'Дата решения': M.today } });
        });
        var status = C.statusByDecisions(apps);
        ops.push({ op: 'set', id: o.id, fields: Object.assign({ 'Статус заказа': status }, comment ? { 'Комментарий заказа': comment } : {}) });
        P.batch(ops).then(function () { P.toast('Заказ ' + o.no + ': ' + (status === 'Подтверждён' ? 'одобрен и передан на склад' : 'отклонён')); P.remount(render); }).catch(function (e) { P.toast(e.message, true); });
    }
    P.mount(render);
})();
