/* Бизнес-клуб: воронка вступления - анкета, интервью, решение; «Принять» создаёт участника и счёт на взнос. */
(function () {
    'use strict';
    var N = window.Netclub, C = N.core;
    var OPEN = ['Новая', 'Интервью', 'Решение'];

    function accept(M, a) {
        var t = M.tariffBy[a.tariff];
        var r = C.acceptApplication(a, t, M.fees, N.TODAY, M.settings, { logins: M.members.map(function (m) { return m.login; }) });
        var mf = { 'Участник': r.member.name, 'Компания': r.member.company, 'Должность': r.member.position, 'Сфера деятельности': a.sphere ? a.sphere : '', 'Город': r.member.city, 'Статус участника': 'Принят', 'Тариф членства': t.id,
            'Дата вступления': r.member.joined, 'Членство до': r.member.until, 'Поручитель': r.member.sponsor, 'Телефон': r.member.phone, 'Email': r.member.email, 'Логин участника': r.member.login, 'Чем занимаюсь': r.member.does, 'Что ищу': r.member.seeks, 'Чем могу помочь': r.member.offers };
        return N.create('Участник', mf).then(function (res) {
            var mid = res && (res.id || res.obj);
            return N.create('Взнос', { 'Взнос': r.fee.no, 'Участник': mid, 'Тариф членства': t.id, 'Сумма взноса': r.fee.sum, 'Период с': r.fee.from, 'Период по': r.fee.to, 'Срок оплаты': r.fee.due, 'Статус взноса': 'Выставлен', 'Логин плательщика': r.fee.login, 'Напоминаний отправлено': 0 });
        }).then(function () {
            return N.update(a.id, { 'Этап заявки': 'Принята', 'Комментарий решения': (a.comment ? a.comment + '\n' : '') + 'Принят ' + C.toDmy(N.TODAY) + ' (' + N.ctx.user + '), счёт ' + r.fee.no + '.' });
        }).then(function () {
            N.toast(a.name + ' — в реестре со статусом «Принят» до ' + C.toDmy(r.member.until) + '. Счёт ' + r.fee.no + ' на ' + C.money(r.fee.sum) + ', оплатить до ' + C.toDmy(r.fee.due) + '.');
            N.refresh();
        });
    }
    function move(a, to, extra) {
        return N.update(a.id, Object.assign({ 'Этап заявки': to }, extra || {})).then(function () { N.toast(a.name + ': ' + to.toLowerCase()); N.refresh(); });
    }
    function card(M, a) {
        var rows = [['Компания', a.company], ['Должность', a.position], ['Сфера', a.sphere], ['Город', a.city], ['Оборот', a.turnover], ['Тариф', a.tariff], ['Поручитель', a.sponsor || '— нет'],
            ['Источник', a.source], ['Дата заявки', C.toDmy(a.date) + ' (' + C.appAge(a, N.TODAY) + ' дн. назад)'], ['Интервью', a.interview ? C.toDmy(a.interview) : '— не назначено'], ['Телефон', a.phone], ['Email', a.email],
            ['Чем занимаюсь', a.does], ['Что ищу', a.seeks], ['Чем могу помочь', a.offers], ['Комментарий', a.comment]];
        var sp = a.sponsor && M.memberBy[a.sponsor];
        var body = N.el('div', {}, [N.el('dl', { 'class': 'nc-dl' }, [].concat.apply([], rows.filter(function (x) { return x[1]; }).map(function (x) { return [N.el('dt', { text: x[0] }), N.el('dd', { text: x[1] })]; }))),
            a.sponsor ? N.el('p', { 'class': sp && sp.status === 'Активен' ? 'nc-okline' : 'nc-warnline', text: sp ? 'Поручитель в клубе: ' + sp.name + ', ' + sp.status.toLowerCase() + ', с ' + C.toDmy(sp.joined) : 'Поручителя нет в реестре клуба' }) : null]);
        var bt = [{ text: 'Закрыть' }];
        if (OPEN.indexOf(a.stage) >= 0) {
            bt.push({ text: 'Отклонить', cls: 'nc-danger', fn: function () { return move(a, 'Отклонена', { 'Комментарий решения': (a.comment ? a.comment + '\n' : '') + 'Отклонено ' + C.toDmy(N.TODAY) + '.' }); } });
            if (a.stage === 'Новая') bt.push({ text: 'Назначить интервью', cls: 'nc-primary', fn: function (close) { close(); interview(a); return false; } });
            if (a.stage === 'Интервью') bt.push({ text: 'Передать на решение', cls: 'nc-primary', fn: function () { return move(a, 'Решение'); } });
            if (a.stage === 'Решение') bt.push(C.canMove('Решение', 'Принята', N.rk) ? { text: 'Принять в клуб', cls: 'nc-primary', fn: function () { return accept(M, a); } } : { text: 'Решение принимает организатор', fn: function () { return false; } });
        }
        N.modal(a.name, body, bt, true);
    }
    function interview(a) {
        var d = N.input('date', C.addDays(N.TODAY, 3));
        N.modal('Интервью: ' + a.name, N.field('Дата интервью', d), [{ text: 'Отмена' }, { text: 'Назначить', cls: 'nc-primary', fn: function () { return move(a, 'Интервью', { 'Дата интервью': d.value }); } }]);
    }

    N.mount(function (host, M) {
        if (!M.apps) { host.appendChild(N.el('p', { text: 'Заявки видят организатор и менеджер клуба.' })); return; }
        N.head('Заявки на вступление', 'Анкета → интервью → решение. «Принять» заводит участника в реестр со сроком членства и выставляет счёт на взнос.').forEach(function (x) { host.appendChild(x); });
        var stale = M.apps.filter(function (a) { return OPEN.indexOf(a.stage) >= 0 && C.appAge(a, N.TODAY) > 14; });
        if (stale.length) host.appendChild(N.el('p', { 'class': 'nc-warnline', text: 'Ждут решения дольше двух недель: ' + stale.map(function (a) { return a.name + ' (' + C.appAge(a, N.TODAY) + ' дн.)'; }).join(', ') + '. Кандидат остывает.' }));
        var board = N.el('div', { 'class': 'nc-board' });
        OPEN.forEach(function (st) {
            var list = M.apps.filter(function (a) { return a.stage === st; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
            board.appendChild(N.el('section', { 'class': 'nc-col' }, [N.el('h2', { html: N.esc(st) + ' <span class="nc-muted">' + list.length + '</span>' })].concat(list.map(function (a) {
                var age = C.appAge(a, N.TODAY);
                return N.el('button', { type: 'button', 'class': 'nc-card' + (age > 14 ? ' nc-card-late' : ''), onclick: function () { card(M, a); } }, [
                    N.el('b', { text: a.name }), N.el('div', { 'class': 'nc-muted', text: a.company }),
                    N.el('div', { html: N.badge(a.sphere || '—', 'info') + ' ' + N.badge(age + ' дн.', age > 14 ? 'bad' : age > 7 ? 'warn' : 'muted') + (a.sponsor ? ' ' + N.badge('поручитель', 'ok') : '') }),
                    a.interview ? N.el('div', { 'class': 'nc-muted', text: 'Интервью ' + C.toDmy(a.interview) }) : null]);
            }))));
        });
        host.appendChild(board);
        var done = M.apps.filter(function (a) { return OPEN.indexOf(a.stage) < 0; });
        host.appendChild(N.el('h2', { text: 'Решённые заявки' }));
        host.appendChild(N.table([{ t: 'Кандидат', k: 'name' }, { t: 'Компания', k: 'company' }, { t: 'Решение', html: function (a) { return N.badge(a.stage, a.stage === 'Принята' ? 'ok' : 'muted'); } },
            { t: 'Дата заявки', html: function (a) { return C.toDmy(a.date); } }, { t: 'Комментарий', k: 'comment' }], done, { onrow: function (a) { card(M, a); } }));
    });
})();
