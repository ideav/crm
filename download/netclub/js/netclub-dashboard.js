/* Бизнес-клуб: дашборд организатора - активные, ушедшие, продления, должники, явка; «Напомнить всем должникам». */
(function () {
    'use strict';
    var N = window.Netclub, C = N.core;

    /* Рассылка-напоминание всем должникам: запись в «Рассылка» + счётчик напоминаний у каждого счёта. */
    function remindAll(M, d) {
        var lines = d.list.map(function (f) { return C.debtReminder(f, M.settings.club); });
        var txt = N.input('textarea', 'Добрый день! Напоминаем об оплате членского взноса. Реквизиты — в счёте, ответьте на это сообщение, если уже оплатили.', { rows: 3 });
        var ch = N.select(['Telegram', 'Email', 'SMS'], 'Telegram');
        var body = N.el('div', {}, [
            N.el('p', { text: 'Получателей: ' + d.people + ' (' + d.list.length + ' ' + C.plural(d.list.length, 'счёт', 'счёта', 'счетов') + ' на ' + C.money(d.sum) + '). Каждому уйдёт его сумма и срок:' }),
            N.el('ul', { 'class': 'nc-list' }, lines.map(function (l) { return N.el('li', { text: l }); })),
            N.field('Канал', ch), N.field('Текст', txt)]);
        N.modal('Напомнить всем должникам', body, [{ text: 'Отмена' }, { text: 'Отправить напоминания', cls: 'nc-primary', fn: function () {
            return N.create('Рассылка', { 'Рассылка': 'Напоминание об оплате взноса ' + C.toDmy(N.TODAY), 'Сегмент рассылки': 'Должники', 'Канал рассылки': ch.value, 'Текст рассылки': txt.value,
                'Дата рассылки': N.TODAY, 'Получателей': d.people, 'Список получателей': lines.join('\n'), 'Отправил': N.ctx.user })
                .then(function () { return Promise.all(d.list.map(function (f) { return N.update(f.id, { 'Напоминаний отправлено': f.rem + 1 }); })); })
                .then(function () { N.toast('Напоминания поставлены в рассылку: ' + d.people + ' ' + C.plural(d.people, 'участник', 'участника', 'участников')); N.refresh(); });
        } }], true);
    }
    N.mount(function (host, M) {
        var S = C.dashboard(M.members, M.fees, M.events, M.regs, N.TODAY, M.settings), d = S.debt;
        N.head('Дашборд клуба', 'Сегодня ' + C.toDmy(N.TODAY) + '. Кто продлевается, кто не заплатил, как ходят на встречи.').forEach(function (x) { host.appendChild(x); });
        host.appendChild(N.el('div', { 'class': 'nc-kpis' }, [
            N.kpi('Активных участников', String(S.active), S.accepted ? '+' + S.accepted + ' приняты, ждём первый взнос' : '', 'ok'),
            N.kpi('Должники', String(d.people), C.money(d.sum) + ' просрочено', d.people ? 'bad' : 'ok', function () { document.getElementById('nc-debt').scrollIntoView({ behavior: 'smooth' }); }),
            N.kpi('Продления за ' + M.settings.renewDays + ' дней', String(S.renew.length), S.renewNeed ? S.renewNeed + ' без выставленного счёта' : 'все счета выставлены', S.renewNeed ? 'warn' : 'ok'),
            N.kpi('Явка на события', S.attendance.rate + '%', 'пришли из записавшихся, ' + S.attendance.rows.length + ' прошедших', S.attendance.rate < 70 ? 'warn' : 'ok'),
            N.kpi('Ушли за 12 месяцев', String(S.left), 'отток ' + S.churn + '%, приостановлено ' + S.suspended, S.churn > 15 ? 'warn' : '')]));
        /* должники */
        var dh = N.el('div', { 'class': 'nc-bar', id: 'nc-debt' }, [N.el('h2', { 'class': 'nc-grow', text: 'Не оплатили взнос' }),
            d.list.length ? N.btn('Напомнить всем должникам (' + d.people + ')', function () { remindAll(M, d); }, 'nc-primary') : null]);
        host.appendChild(dh);
        host.appendChild(N.table([
            { t: 'Участник', html: function (f) { var m = M.memberBy[f.member]; return N.esc(f.member) + (m ? '<div class="nc-muted">' + N.esc(m.company) + '</div>' : ''); } },
            { t: 'Статус', html: function (f) { var m = M.memberBy[f.member]; return m ? N.statusBadge(m.status) : ''; } },
            { t: 'Счёт', k: 'no' }, { t: 'Сумма', num: 1, html: function (f) { return C.money(f.sum); } },
            { t: 'Срок', html: function (f) { return C.toDmy(f.due); } }, { t: 'Просрочка', num: 1, html: function (f) { return N.badge(f.days + ' дн.', f.days > 30 ? 'bad' : 'warn'); } },
            { t: 'Напоминаний', num: 1, k: 'rem' }], d.list, { empty: 'Долгов нет' }));
        if (S.suspend.length) host.appendChild(N.el('p', { 'class': 'nc-warnline', text: 'Без оплаты дольше льготного периода (' + M.settings.graceDays + ' дн.) — кандидаты на приостановку: ' + S.suspend.map(function (m) { return m.name; }).join(', ') }));
        /* продления */
        host.appendChild(N.el('h2', { text: 'Продления в ближайшие ' + M.settings.renewDays + ' дней' }));
        host.appendChild(N.table([
            { t: 'Участник', html: function (r) { return N.esc(r.member.name) + '<div class="nc-muted">' + N.esc(r.member.company) + '</div>'; } },
            { t: 'Тариф', html: function (r) { return N.esc(r.member.tariff); } },
            { t: 'Членство до', html: function (r) { return C.toDmy(r.until) + ' <span class="nc-muted">через ' + r.days + ' дн.</span>'; } },
            { t: 'Продление', html: function (r) { return r.state === 'paid' ? N.badge('Оплачено', 'ok') : r.state === 'issued' ? N.badge('Счёт ' + r.fee.no + ' выставлен', 'info') : N.badge('Счёт не выставлен', 'warn'); } },
            { t: '', node: function (r) { return r.state === 'need' ? N.btn('Выставить счёт', function (e) { e.target.disabled = true; N.issueRenewal(M, r.member); }, 'nc-small') : null; } }], S.renew, { empty: 'В ближайшие дни продлений нет' }));
        /* явка */
        host.appendChild(N.el('h2', { text: 'Явка по событиям' }));
        host.appendChild(N.el('div', { 'class': 'nc-bars' }, S.attendance.rows.map(function (r) {
            return N.el('div', { 'class': 'nc-barrow' }, [N.el('div', { 'class': 'nc-barlabel', html: N.esc(r.event.name) + ' <span class="nc-muted">' + C.toDmy(r.event.date) + '</span>' }),
                N.el('div', { 'class': 'nc-bartrack', title: r.came + ' из ' + r.reg }, [N.el('div', { 'class': 'nc-barfill' + (r.rate < 60 ? ' nc-barbad' : r.rate < 80 ? ' nc-barwarn' : ''), style: 'width:' + r.rate + '%' })]),
                N.el('div', { 'class': 'nc-barval', text: r.came + '/' + r.reg + ' · ' + r.rate + '%' })]);
        })));
    });
})();
