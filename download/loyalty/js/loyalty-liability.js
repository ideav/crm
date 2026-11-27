/* Обязательства перед участниками: сколько бонусов сеть должна гостям, что и когда сгорит, по точкам, крупнейшие счета. */
(function () {
    'use strict';
    var P = window.Loy, C = P.core;
    P.mount(function (host, M) {
        var byGuest = {};
        Object.keys(M.st).forEach(function (n) { byGuest[n] = { lots: M.st[n].lots.lots, point: M.st[n].point }; });
        var L = C.liabilities(byGuest, M.today, 1);
        var from30 = C.addDays(M.today, -30), acc30 = 0, spent30 = 0, burn30 = 0;
        M.ops.forEach(function (o) { if (o.date <= from30) return; if (o.bonus > 0) acc30 += o.bonus; else if (o.kind === 'Сгорание бонусов') burn30 -= o.bonus; else spent30 -= o.bonus; });
        host.appendChild(P.el('div', {}, P.head('Обязательства перед участниками', 'На ' + C.toDmy(M.today) + ': неиспользованные бонусы - долг сети перед гостями (1 бонус = 1 ₽ скидки). Партии сгорают через ' + M.program.life + ' дней.')));
        host.appendChild(P.el('div', { 'class': 'loy-kpis' }, [
            P.kpi('должны участникам', P.money(L.rub), L.guests + ' гостей с живыми бонусами', ''),
            P.kpi('сгорит за 14 дней', P.money(L.d14), 'повод написать до ' + C.toDmy(C.addDays(M.today, 14)), L.d14 ? 'warn' : ''),
            P.kpi('сгорит за 30 дней', P.money(L.d30), '', ''),
            P.kpi('за 30 дней: начислено / списано', P.bonus(acc30) + ' / ' + P.bonus(spent30), 'сгорело ' + P.bonus(burn30), '')]));
        var two = P.el('div', { 'class': 'loy-two' });
        var max = Math.max.apply(null, L.months.map(function (m) { return m.rub; }).concat([1]));
        var mBox = P.el('div', { 'class': 'loy-card' }, [P.el('h3', { text: 'Когда сгорит' })]);
        var MN = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
        L.months.forEach(function (m) {
            var label = m.month.length === 7 ? MN[+m.month.slice(5) - 1] + ' ' + m.month.slice(0, 4) : m.month;
            mBox.appendChild(P.el('div', { 'class': 'loy-hbar' }, [P.el('span', { text: label }), P.el('div', { 'class': 'loy-bar-track' }, [P.el('div', { 'class': 'loy-bar-fill' + (m.month === M.today.slice(0, 7) ? ' loy-r' : ''), style: 'width:' + Math.round(m.rub / max * 100) + '%' })]), P.el('span', { 'class': 'loy-num', text: P.money(m.rub) })]));
        });
        two.appendChild(mBox);
        var pBox = P.el('div', { 'class': 'loy-card' }, [P.el('h3', { text: 'По точкам регистрации гостя' })]);
        pBox.appendChild(P.table([{ t: 'Точка', k: 'point' }, { t: 'Бонусов', num: true, html: function (r) { return P.bonus(r.bonus); } }, { t: 'Доля', num: true, html: function (r) { return L.total ? Math.round(r.bonus / L.total * 100) + '%' : '—'; } }], L.points));
        two.appendChild(pBox);
        host.appendChild(two);
        var top = Object.keys(M.st).map(function (n) { var s = M.st[n]; return { name: n, bal: s.lots.balance, soon: s.lots.expiring(14), seg: s.rfm.segment, last: s.v.last }; })
            .filter(function (x) { return x.bal > 0; }).sort(function (a, b) { return b.bal - a.bal; });
        host.appendChild(P.el('div', { 'class': 'loy-bar' }, [P.el('h2', { text: 'Крупнейшие счета', style: 'margin:0' }), P.el('span', { 'class': 'loy-grow' }),
            P.btn('Выгрузить CSV', function () { P.download('обязательства.csv', C.toCsv(top.map(function (x) { return { name: x.name, bal: x.bal, soon: x.soon, seg: x.seg, last: C.toDmy(x.last) }; }), [['name', 'Гость'], ['bal', 'Бонусов'], ['soon', 'Сгорит за 14 дн.'], ['seg', 'Сегмент'], ['last', 'Последний визит']])); })]));
        host.appendChild(P.table([
            { t: 'Гость', html: function (x) { return '<a href="' + P.nav('guest', 'g=' + encodeURIComponent(x.name)) + '">' + P.esc(x.name) + '</a>'; } }, { t: 'Бонусов', num: true, html: function (x) { return P.bonus(x.bal); } },
            { t: 'Сгорит за 14 дн.', num: true, html: function (x) { return x.soon ? P.bonus(x.soon) : ''; } }, { t: 'Сегмент', html: function (x) { return P.seg(x.seg); } }, { t: 'Последний визит', html: function (x) { return C.toDmy(x.last); } }
        ], top.slice(0, 15)));
    });
})();
