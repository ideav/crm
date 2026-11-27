/* Журнал бонусных операций: ручные операции на проверку, конфликт акций и бонусов в чеках, весь журнал с фильтрами. Журнал не правится: исправление - встречной операцией с причиной. */
(function () {
    'use strict';
    var P = window.Loy, C = P.core;
    var tab = 'check', flt = { point: '', kind: '', q: '' };
    P.mount(function (host, M) {
        var mine = P.myPoint(M);
        var ops = mine ? M.ops.filter(function (o) { return o.point === mine; }) : M.ops;
        var checks = mine ? M.checks.filter(function (c) { return c.point === mine; }) : M.checks;
        var from30 = C.addDays(M.today, -30);
        var sus = C.suspicious(ops, M.today, M.program);
        var conf = C.checkConflicts(checks, M.promoBy, M.program).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
        var lost = conf.reduce(function (s, c) { return s + c.paidBonus; }, 0);
        function draw() {
            host.innerHTML = '';
            host.appendChild(P.el('div', {}, P.head('Журнал операций', (mine ? 'Точка «' + mine + '». ' : 'Вся сеть. ') + 'Каждое начисление и списание - запись с автором и причиной; касса отдаёт баланс, история живёт здесь.')));
            host.appendChild(P.el('div', { 'class': 'loy-kpis' }, [
                P.kpi('операций за 30 дней', String(ops.filter(function (o) { return o.date > from30; }).length), 'начисления, списания, сгорание'),
                P.kpi('ручных за 30 дней', String(ops.filter(function (o) { return o.manual && o.date > from30; }).length), 'только с причиной', ''),
                P.kpi('на проверку', String(sus.length), 'без причины, сверх ' + M.program.manualMax + ' или серия одному гостю', sus.length ? 'bad' : 'good'),
                P.kpi('конфликт акции и бонусов', String(conf.length), 'чеков: скидка и списание вместе, ' + P.bonus(lost) + ' бонусов', conf.length ? 'warn' : 'good')]));
            host.appendChild(P.tabs([['check', 'На проверку (' + sus.length + ')'], ['conf', 'Конфликт акций (' + conf.length + ')'], ['all', 'Весь журнал']], tab, function (t) { tab = t; draw(); }));
            if (tab === 'check') {
                host.appendChild(P.table([
                    { t: 'Дата', html: function (o) { return C.toDmy(o.date); } }, { t: 'Гость', html: function (o) { return '<a href="' + P.nav('guest', 'g=' + encodeURIComponent(o.guest)) + '">' + P.esc(o.guest) + '</a>'; } },
                    { t: 'Бонусы', num: true, html: function (o) { return (o.bonus > 0 ? '+' : '') + P.bonus(o.bonus); } }, { t: 'Точка', k: 'point' }, { t: 'Кто', k: 'author' },
                    { t: 'Причина', html: function (o) { return o.reason ? P.esc(o.reason) : P.badge('нет причины', 'crit'); } }, { t: 'Почему на проверке', html: function (o) { return o.why.map(function (w) { return P.badge(w, 'warn'); }).join(' '); } }
                ], sus, { empty: 'Подозрительных ручных операций нет' }));
                host.appendChild(P.el('p', { 'class': 'loy-muted', text: 'Новые ручные операции без причины не проводятся (проверка при вводе). Эти записи пришли из кассы до включения правила.' }));
            } else if (tab === 'conf') {
                host.appendChild(P.table([
                    { t: 'Чек', k: 'num' }, { t: 'Дата', html: function (c) { return C.toDmy(c.date) + ' ' + P.esc(c.time); } }, { t: 'Гость', html: function (c) { return '<a href="' + P.nav('guest', 'g=' + encodeURIComponent(c.guest)) + '">' + P.esc(c.guest) + '</a>'; } },
                    { t: 'Акция', k: 'promo' }, { t: 'Сумма', num: true, html: function (c) { return P.money(c.sum); } }, { t: 'Списано бонусами', num: true, html: function (c) { return P.bonus(c.paidBonus); } }, { t: 'Точка', k: 'point' }, { t: 'Кассир', k: 'cashier' }
                ], conf, { empty: 'Конфликтов нет' }));
                host.appendChild(P.el('p', { 'class': 'loy-muted', text: 'Правило программы: в акции без бонусов списание не проводится. Тестовый чек в карточке гостя показывает это кассиру до оплаты.' }));
            } else {
                var kinds = Object.keys(M.kinds);
                var pSel = P.select([['', 'все точки']].concat(M.points), flt.point), kSel = P.select([['', 'все операции']].concat(kinds), flt.kind), q = P.input('search', flt.q, { placeholder: 'гость или номер' });
                if (mine) pSel.disabled = true;
                pSel.onchange = function () { flt.point = pSel.value; draw(); }; kSel.onchange = function () { flt.kind = kSel.value; draw(); };
                q.addEventListener('change', function () { flt.q = q.value; draw(); });
                var list = ops.filter(function (o) { return (!flt.point || o.point === flt.point) && (!flt.kind || o.kind === flt.kind) && (!flt.q || (o.guest + o.num).toLowerCase().indexOf(flt.q.toLowerCase()) >= 0); })
                    .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.num < b.num ? 1 : -1); });
                host.appendChild(P.el('div', { 'class': 'loy-bar' }, [P.field('Точка', pSel), P.field('Операция', kSel), P.field('Поиск', q), P.el('span', { 'class': 'loy-grow' }),
                    P.btn('Выгрузить CSV', function () { P.download('журнал-операций.csv', C.toCsv(list.map(function (o) { return Object.assign({}, o, { date: C.toDmy(o.date), expires: C.toDmy(o.expires) }); }), [['num', 'Операция'], ['date', 'Дата'], ['guest', 'Гость'], ['kind', 'Вид'], ['bonus', 'Бонусы'], ['expires', 'Сгорает'], ['point', 'Точка'], ['reason', 'Причина'], ['author', 'Автор']])); })]));
                host.appendChild(P.table([
                    { t: '№', k: 'num' }, { t: 'Дата', html: function (o) { return C.toDmy(o.date); } }, { t: 'Гость', html: function (o) { return '<a href="' + P.nav('guest', 'g=' + encodeURIComponent(o.guest)) + '">' + P.esc(o.guest) + '</a>'; } },
                    { t: 'Операция', k: 'kind' }, { t: 'Бонусы', num: true, html: function (o) { return (o.bonus > 0 ? '+' : '') + P.bonus(o.bonus); } }, { t: 'Сгорает', html: function (o) { return C.toDmy(o.expires); } },
                    { t: 'Точка', k: 'point' }, { t: 'Причина', k: 'reason' }, { t: 'Кто', k: 'author' }
                ], list.slice(0, 200), { rowCls: function (o) { return o.manual && !o.reason ? 'loy-row-bad' : ''; } }));
                host.appendChild(P.el('p', { 'class': 'loy-muted', text: 'Показано ' + Math.min(200, list.length) + ' из ' + list.length + ' (полностью - в CSV).' }));
            }
        }
        draw();
    });
})();
