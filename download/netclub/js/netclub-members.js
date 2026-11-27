/* Бизнес-клуб: реестр участников со статусами и взносы (отметка оплаты, продление); участнику - его взносы. */
(function () {
    'use strict';
    var N = window.Netclub, C = N.core;
    var STATUSES = ['Принят', 'Активен', 'Приостановлен', 'Вышел'];

    function markPaid(f) {
        var d = N.input('date', N.TODAY), how = N.select(['Счёт (безнал)', 'СБП', 'Карта', 'Наличные'], 'Счёт (безнал)');
        N.modal('Оплата ' + f.no + ': ' + f.member, N.el('div', {}, [N.el('p', { text: C.money(f.sum) + ' за период ' + C.toDmy(f.from) + ' — ' + C.toDmy(f.to) }), N.field('Дата оплаты', d), N.field('Способ', how)]),
            [{ text: 'Отмена' }, { text: 'Отметить оплату', cls: 'nc-primary', fn: function () {
                var M = N.cur, m = M.memberById[f.memberId] || M.memberBy[f.member];
                return N.update(f.id, { 'Статус взноса': 'Оплачен', 'Дата оплаты': d.value, 'Способ оплаты': how.value }).then(function () {
                    /* первый взнос или продление: участник активен, членство до конца оплаченного периода */
                    if (!m) return null;
                    var upd = {}; if (m.status !== 'Активен') upd['Статус участника'] = 'Активен'; if (!m.until || f.to > m.until) upd['Членство до'] = f.to;
                    return Object.keys(upd).length ? N.update(m.id, upd) : null;
                }).then(function () { N.toast('Оплата отмечена: ' + f.member + ', членство до ' + C.toDmy(f.to)); N.refresh(); });
            } }]);
    }
    function memberCard(M, m) {
        var fees = M.fees.filter(function (f) { return f.member === m.name; }).sort(function (a, b) { return a.from < b.from ? 1 : -1; });
        var regs = M.regs.filter(function (r) { return r.member === m.name; });
        var came = regs.filter(function (r) { return r.status === 'Пришёл'; }).length;
        var rows = [['Компания', m.company], ['Должность', m.position], ['Сфера', m.sphere], ['Город', m.city], ['Тариф', m.tariff], ['В клубе с', C.toDmy(m.joined)], ['Членство до', C.toDmy(m.until)], ['Поручитель', m.sponsor],
            ['Телефон', m.phone], ['Email', m.email], ['Чем занимаюсь', m.does], ['Что ищу', m.seeks], ['Чем могу помочь', m.offers], ['Вышел', m.left ? C.toDmy(m.left) + ' — ' + m.leftReason : ''], ['События', regs.length ? 'пришёл на ' + came + ' из ' + regs.length + ' записей' : '']];
        var status = N.select(STATUSES, m.status);
        var body = N.el('div', {}, [N.el('dl', { 'class': 'nc-dl' }, [].concat.apply([], rows.filter(function (x) { return x[1]; }).map(function (x) { return [N.el('dt', { text: x[0] }), N.el('dd', { text: x[1] })]; }))),
            N.el('h3', { text: 'Взносы' }), N.table([{ t: 'Счёт', k: 'no' }, { t: 'Период', html: function (f) { return C.toDmy(f.from) + ' — ' + C.toDmy(f.to); } }, { t: 'Сумма', num: 1, html: function (f) { return C.money(f.sum); } }, { t: 'Статус', html: N.feeBadge }], fees),
            N.field('Статус участника', status)]);
        N.modal(m.name, body, [{ text: 'Закрыть' }, { text: 'Выставить продление', fn: function () { return N.issueRenewal(M, m); } }, { text: 'Сохранить статус', cls: 'nc-primary', fn: function () {
            if (status.value === m.status) return true;
            var f = { 'Статус участника': status.value }; if (status.value === 'Вышел') f['Дата выхода'] = N.TODAY;
            return N.update(m.id, f).then(function () { N.toast(m.name + ': ' + status.value.toLowerCase()); N.refresh(); });
        } }], true);
    }
    var feeCols = function (M, withMember) {
        return [withMember ? { t: 'Участник', html: function (f) { var m = M.memberBy[f.member]; return N.esc(f.member) + (m ? ' ' + N.statusBadge(m.status) : ''); } } : null, { t: 'Счёт', k: 'no' }, { t: 'Тариф', k: 'tariff' },
            { t: 'Период', html: function (f) { return C.toDmy(f.from) + ' — ' + C.toDmy(f.to); } }, { t: 'Сумма', num: 1, html: function (f) { return C.money(f.sum); } },
            { t: 'Срок оплаты', html: function (f) { return C.toDmy(f.due); } }, { t: 'Статус', html: N.feeBadge }, { t: 'Оплачен', html: function (f) { return f.paid ? C.toDmy(f.paid) + ' · ' + N.esc(f.method) : ''; } },
            withMember ? { t: '', node: function (f) { return C.feeState(f, N.TODAY) === 'paid' ? null : N.btn('Отметить оплату', function () { markPaid(f); }, 'nc-small'); } } : null].filter(Boolean);
    };

    function mine(host, M) {
        N.head('Мои взносы', 'Счета клуба и срок вашего членства. Оплатить можно по реквизитам из счёта; оплату отмечает менеджер клуба.').forEach(function (x) { host.appendChild(x); });
        var open = M.fees.filter(function (f) { return C.feeState(f, N.TODAY) !== 'paid'; });
        var last = M.fees.filter(function (f) { return C.feeState(f, N.TODAY) === 'paid'; }).sort(function (a, b) { return a.to < b.to ? 1 : -1; })[0];
        host.appendChild(N.el('div', { 'class': 'nc-kpis' }, [N.kpi('Членство оплачено до', last ? C.toDmy(last.to) : '—', M.me ? M.me.name : N.ctx.user, 'ok'),
            N.kpi('К оплате', C.money(open.reduce(function (s, f) { return s + f.sum; }, 0)), open.length ? 'счёт ' + open.map(function (f) { return f.no + ' до ' + C.toDmy(f.due); }).join(', ') : 'долгов нет', open.length ? 'warn' : 'ok')]));
        host.appendChild(N.table(feeCols(M, false), M.fees.slice().sort(function (a, b) { return a.from < b.from ? 1 : -1; }), { empty: 'Счетов нет' }));
    }

    N.mount(function (host, M) {
        if (!N.isStaff()) return mine(host, M);
        var tab = (location.hash.match(/tab=(\w+)/) || [])[1] || 'reg';
        N.head('Участники и взносы', 'Реестр со статусами (кандидаты — в «Заявках»), сроки членства и счета. Оплату отмечает менеджер; оплаченный первый взнос делает участника активным.').forEach(function (x) { host.appendChild(x); });
        host.appendChild(N.tabs([['reg', 'Реестр (' + M.members.length + ')'], ['fees', 'Взносы (' + M.fees.length + ')']], tab, function (t) { location.hash = 'tab=' + t; N.refresh(); }));
        var bar = N.el('div', { 'class': 'nc-bar' }), q = N.input('text', '', { placeholder: 'Поиск по имени или компании' }), out = N.el('div');
        if (tab === 'reg') {
            var st = N.select([['', 'Все статусы']].concat(STATUSES), 'Активен');
            var draw = function () {
                var s = q.value.toLowerCase();
                var list = M.members.filter(function (m) { return (!st.value || m.status === st.value) && (!s || (m.name + ' ' + m.company).toLowerCase().indexOf(s) >= 0); });
                out.innerHTML = '';
                out.appendChild(N.table([{ t: 'Участник', html: function (m) { return N.esc(m.name) + '<div class="nc-muted">' + N.esc(m.company) + '</div>'; } }, { t: 'Сфера', k: 'sphere' },
                    { t: 'Статус', html: function (m) { return N.statusBadge(m.status); } }, { t: 'Тариф', k: 'tariff' }, { t: 'В клубе с', html: function (m) { return C.toDmy(m.joined); } },
                    { t: 'Членство до', html: function (m) { var d = m.until ? C.diffDays(N.TODAY, m.until) : null; return C.toDmy(m.until) + (m.status === 'Вышел' || d === null ? '' : d < 0 ? ' ' + N.badge('истекло', 'bad') : d <= M.settings.renewDays ? ' ' + N.badge(d + ' дн.', 'warn') : ''); } },
                    { t: 'Поручитель', k: 'sponsor' }], list, { onrow: function (m) { memberCard(M, m); } }));
            };
            [N.field('Статус', st), N.field('Поиск', q)].forEach(function (x) { bar.appendChild(x); });
            st.onchange = draw; q.oninput = draw; host.appendChild(bar); host.appendChild(out); draw();
        } else {
            var fs = N.select([['open', 'Не оплачены'], ['overdue', 'Просрочены'], ['', 'Все']], 'open');
            var drawF = function () {
                var s = q.value.toLowerCase();
                var list = M.fees.filter(function (f) { var x = C.feeState(f, N.TODAY); return (!fs.value || (fs.value === 'open' ? x !== 'paid' : x === fs.value)) && (!s || (f.member + ' ' + f.no).toLowerCase().indexOf(s) >= 0); })
                    .sort(function (a, b) { return a.due < b.due ? -1 : 1; });
                out.innerHTML = '';
                out.appendChild(N.el('p', { 'class': 'nc-muted', text: list.length + ' ' + C.plural(list.length, 'счёт', 'счёта', 'счетов') + ' на ' + C.money(list.reduce(function (t, f) { return t + f.sum; }, 0)) }));
                out.appendChild(N.table(feeCols(M, true), list));
            };
            [N.field('Показать', fs), N.field('Поиск', q), N.btn('Выгрузить CSV', function () {
                N.download('vznosy.csv', C.toCsv(M.fees.map(function (f) { return Object.assign({}, f, { state: C.feeLabel(C.feeState(f, N.TODAY)), from: C.toDmy(f.from), to: C.toDmy(f.to), due: C.toDmy(f.due), paid: C.toDmy(f.paid) }); }),
                    [['no', 'Счёт'], ['member', 'Участник'], ['tariff', 'Тариф'], ['sum', 'Сумма'], ['from', 'Период с'], ['to', 'Период по'], ['due', 'Срок оплаты'], ['state', 'Статус'], ['paid', 'Дата оплаты']]));
            })].forEach(function (x) { bar.appendChild(x); });
            fs.onchange = drawF; q.oninput = drawF; host.appendChild(bar); host.appendChild(out); drawF();
        }
    });
})();
