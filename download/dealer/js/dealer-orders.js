/* Заказы: статусы, состав, согласования, отгрузка и ТТН; склад двигает статусы, дилер повторяет заказ. */
(function () {
    'use strict';
    var P = window.Dealer, C = P.core;
    var TABS = [['all', 'Все'], ['appr', 'На согласовании'], ['work', 'В работе'], ['ship', 'Отгружены'], ['draft', 'Черновики'], ['rej', 'Отклонённые']];
    var IN = { appr: ['На согласовании'], work: ['Подтверждён', 'Собирается'], ship: ['Отгружен', 'Доставлен'], draft: ['Черновик'], rej: ['Отклонён'] };
    var tab = 'all', opened = false;
    function render(host, M) {
        var h = P.hash(), all = M.dealers.length > 1, d = P.dealer(M);
        var warehouse = P.canWrite('Отгрузка');
        if (!M.isDealer && !h.d) d = null; /* сотрудники по умолчанию видят заказы всех дилеров */
        host.innerHTML = '';
        var dsel = all ? P.select([['', 'Все дилеры']].concat(M.dealers.map(function (x) { return [x.id, x.name]; })), d ? d.id : '') : null;
        if (dsel) dsel.addEventListener('change', function () { var hh = P.hash(); hh.d = dsel.value; delete hh.o; P.setHash(hh); render(host, M); });
        host.appendChild(P.head(warehouse ? 'Заказы к сборке и отгрузке' : 'Заказы', warehouse ? 'Подтверждённые заказы собираются и отгружаются; дилер видит статус и ТТН у себя в кабинете сразу.' : 'Статусы, отгрузки и документы - без звонка менеджеру.', dsel ? P.el('label', { 'class': 'dl-pick' }, [P.el('span', { text: 'Дилер:' }), dsel]) : null));
        if (warehouse && tab === 'all' && !opened) tab = 'work';
        var list = M.orders.filter(function (o) { return (!d || o.dealer === d.name) && (tab === 'all' || IN[tab].indexOf(o.status) >= 0); });
        host.appendChild(P.tabs(TABS.map(function (t) { var n = M.orders.filter(function (o) { return (!d || o.dealer === d.name) && (t[0] === 'all' || IN[t[0]].indexOf(o.status) >= 0); }).length; return [t[0], t[1] + ' (' + n + ')']; }), tab, function (t) { tab = t; opened = true; render(host, M); }));
        var shipBy = {}; M.ships.forEach(function (s) { shipBy[s.order] = s; });
        var cols = [{ t: 'Заказ', html: function (o) { return '<b>' + P.esc(o.no) + '</b><span class="dl-rule">' + P.dmy(o.date) + '</span>'; } }];
        if (!d) cols.push({ t: 'Дилер', k: 'dealer' });
        cols.push({ t: 'Склад', k: 'wh' }, { t: 'Статус', html: function (o) { return P.badge(o.status, P.statusKind(o.status)) + (o.reason ? '<span class="dl-rule">' + P.esc(o.reason) + '</span>' : ''); } },
            { t: 'Отгрузка', html: function (o) { var s = shipBy[o.no]; return s ? P.esc(s.car) + '<span class="dl-rule">' + P.esc(s.ttn) + ' · ' + P.esc(s.st) + '</span>' : '-'; } },
            { t: 'Сумма', num: true, html: function (o) { return P.money(o.sum); } });
        host.appendChild(P.table(cols, list, { onrow: function (o) { var hh = P.hash(); hh.o = o.id; P.setHash(hh); details(host, M, o); }, empty: 'Заказов нет' }));
        if (h.o && M.orderById[h.o] && !opened) { opened = true; details(host, M, M.orderById[h.o]); }
    }
    function details(host, M, o) {
        opened = true;
        var body = P.el('div', {}, [P.el('p', { 'class': 'dl-muted', text: 'Загрузка состава...' })]);
        var btns = [{ text: 'Закрыть' }];
        var m = P.modal('Заказ ' + o.no + ' · ' + o.dealer, body, btns, true);
        P.lines(o.id).then(function (ls) {
            body.innerHTML = '';
            var ship = M.ships.filter(function (s) { return s.order === o.no; })[0], inv = M.invoices.filter(function (i) { return i.order === o.no; })[0];
            var apps = M.approvals.filter(function (a) { return a.order === o.no; });
            var dl = P.el('dl', { 'class': 'dl-dl' });
            [['Статус', P.badge(o.status, P.statusKind(o.status))], ['Дата', P.dmy(o.date)], ['Склад отгрузки', P.esc(o.wh)], ['Автор', P.esc(o.author)],
                ship ? ['Отгрузка', P.esc(ship.no + ' от ' + P.dmy(ship.date) + ', ' + ship.car + ', ' + ship.ttn + ' · ' + ship.st)] : null,
                inv ? ['Счёт', P.esc(inv.no + ' на ' + P.money(inv.sum) + ', оплатить до ' + P.dmy(inv.due) + ', оплачено ' + P.money(inv.paid))] : null,
                o.details ? ['Согласование', P.esc(o.details).replace(/\n/g, '<br>')] : null,
                o.comment ? ['Комментарий', P.esc(o.comment)] : null].filter(Boolean).forEach(function (r) { dl.appendChild(P.el('dt', { text: r[0] })); dl.appendChild(P.el('dd', { html: r[1] })); });
            body.appendChild(dl);
            body.appendChild(P.table([{ t: '№', k: 'n' }, { t: 'Товар', html: function (l) { return P.esc(l.product) + '<span class="dl-rule">' + P.esc(l.rule) + '</span>'; } },
                { t: 'Кол-во', num: true, k: 'qty' }, { t: 'Цена', num: true, html: function (l) { return P.money(l.price); } }, { t: 'Сумма', num: true, html: function (l) { return P.money(l.qty * l.price); } }],
                ls.map(function (l, i) { return Object.assign({ n: i + 1 }, l); })));
            if (apps.length) body.appendChild(P.table([{ t: 'Решение', html: function (a) { return P.badge(a.decision, a.decision === 'Одобрено' ? 'ok' : a.decision === 'Отклонено' ? 'bad' : 'warn'); } }, { t: 'Причина', k: 'reason' }, { t: 'Кто', k: 'who' }, { t: 'Когда', html: function (a) { return P.dmy(a.date); } }], apps));
            var foot = m.foot;
            var next = C.nextWarehouseStatus(o.status);
            if (P.canWrite('Отгрузка') && next) foot.insertBefore(P.btn(next === 'Собирается' ? 'Взять в сборку' : next === 'Отгружен' ? 'Отгрузить' : 'Доставлен', function () { advance(host, M, o, next, m); }, 'dl-primary'), foot.firstChild);
            if (P.canWrite('Заказ дилера') && !P.canWrite('Отгрузка') && o.status !== 'Черновик') foot.insertBefore(P.btn('Повторить заказ', function () { P.go('catalog', 'd=' + (M.dealerBy[o.dealer] || {}).id + '&repeat=' + o.id); }), foot.firstChild);
            if (P.canWrite('Заказ дилера') && o.status === 'Черновик') foot.insertBefore(P.btn('Открыть в корзине', function () { P.go('catalog', 'd=' + (M.dealerBy[o.dealer] || {}).id + '&draft=' + o.id); }, 'dl-primary'), foot.firstChild);
        }).catch(function (e) { body.innerHTML = ''; body.appendChild(P.note(e.message, 'bad')); });
    }
    /* Склад: сборка -> отгрузка (создаёт отгрузку с ТТН) -> доставка. */
    function advance(host, M, o, next, m) {
        var done = function () { P.toast('Заказ ' + o.no + ': ' + next.toLowerCase()); m.close(); P.remount(render); };
        var fail = function (e) { P.toast(e.message, true); };
        if (next === 'Собирается') return P.update(o.id, { 'Статус заказа': next }).then(done).catch(fail);
        if (next === 'Доставлен') {
            var s = M.ships.filter(function (x) { return x.order === o.no; })[0];
            return P.batch([{ op: 'set', id: o.id, fields: { 'Статус заказа': next } }].concat(s ? [{ op: 'set', id: s.id, fields: { 'Статус доставки': 'Доставлен' } }] : [])).then(done).catch(fail);
        }
        var ttn = P.input('text', 'ТТН ' + (10000 + Math.floor(Math.random() * 89999)) + '/11'), car = P.select(['ПЭК', 'Деловые Линии', 'Байкал Сервис', 'Свой транспорт'], 'ПЭК');
        P.modal('Отгрузка заказа ' + o.no, P.el('div', {}, [P.field('Номер ТТН', ttn), P.field('Перевозчик', car), P.el('p', { 'class': 'dl-muted', text: 'Дилер увидит ТТН и статус «В пути» у себя в кабинете.' })]), [{ text: 'Отмена' }, { text: 'Отгрузить', cls: 'dl-primary', fn: function (close) {
            var no = C.nextNumber(M.ships.map(function (x) { return x.no; }), 'ОТ-26-');
            P.batch([{ op: 'set', id: o.id, fields: { 'Статус заказа': 'Отгружен' } }, { op: 'new', id: 'Отгрузка', up: 1, fields: { 'Отгрузка': no, 'Заказ дилера': o.id, 'Дилер': (M.dealerBy[o.dealer] || {}).id, 'Склад': o.wh, 'Дата отгрузки': M.today, 'Номер ТТН': ttn.value, 'Перевозчик': car.value, 'Статус доставки': 'В пути' } }]).then(function () { close(); done(); }).catch(fail);
            return false;
        } }]);
    }
    P.mount(render);
})();
