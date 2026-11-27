/* RFM и «кому написать»: матрица давность x частота, список с причинами, кампании против контрольной группы. */
(function () {
    'use strict';
    var P = window.Loy, C = P.core;
    var segPick = '';
    P.mount(function (host, M) {
        var rows = M.guests.map(function (g) {
            var s = M.st[g.name];
            return { name: g.name, consent: g.consent, birthday: g.birthday, segment: s.rfm.segment, R: s.rfm.R, F: s.rfm.F, M: s.rfm.M, days: s.rfm.days, balance: s.lots.balance, expiring14: s.lots.expiring(14), sum90: s.v.sum90, visits90: s.v.visits90, point: g.point };
        });
        var byName = P.map(rows, 'name');
        function draw() {
            host.innerHTML = '';
            host.appendChild(P.el('div', {}, P.head('Кому написать', 'Сегменты RFM по чекам за 90 дней на ' + C.toDmy(M.today) + '. Ушедших считаем после ' + M.program.lostDays + ' дней без визита (настройка программы).')));
            var cnt = {}; rows.forEach(function (r) { cnt[r.segment] = (cnt[r.segment] || 0) + 1; });
            host.appendChild(P.el('div', { 'class': 'loy-kpis' }, C.SEGMENTS.map(function (s) {
                var k = P.el('div', { 'class': 'loy-kpi loy-click' + (segPick === s ? ' loy-kpi-bad' : ''), onclick: function () { segPick = segPick === s ? '' : s; draw(); } }, [P.el('div', { 'class': 'loy-kpi-v', text: String(cnt[s] || 0) }), P.el('div', { 'class': 'loy-kpi-l', html: P.seg(s) })]);
                return k;
            })));
            var two = P.el('div', { 'class': 'loy-two' });
            two.appendChild(matrix(rows));
            two.appendChild(campaigns(M));
            host.appendChild(two);
            var list = C.whomToWrite(segPick ? rows.filter(function (r) { return r.segment === segPick; }) : rows, M.today);
            host.appendChild(P.el('div', { 'class': 'loy-bar' }, [P.el('h2', { text: 'Кому написать сегодня' + (segPick ? ': ' + segPick : '') + ' (' + list.length + ')', style: 'margin:0' }), P.el('span', { 'class': 'loy-grow' }),
                P.btn('Выгрузить для рассылки', function () {
                    P.download('кому-написать.csv', C.toCsv(list.map(function (x) { var g = M.guestBy[x.name] || {}; return { name: x.name, phone: g.phone || '', segment: x.segment, why: x.why.join('; ') }; }), [['name', 'Гость'], ['phone', 'Телефон'], ['segment', 'Сегмент'], ['why', 'Почему']]));
                })]));
            var segText = {}; M.segments.forEach(function (s) { segText[s.name] = s.text; });
            host.appendChild(P.table([
                { t: 'Гость', html: function (x) { return '<a href="' + P.nav('guest', 'g=' + encodeURIComponent(x.name)) + '">' + P.esc(x.name) + '</a>'; } }, { t: 'Сегмент', html: function (x) { return P.seg(x.segment); } },
                { t: 'Почему', html: function (x) { return x.why.map(function (w) { return P.esc(w); }).join('<br>'); } }, { t: 'Баланс', num: true, html: function (x) { return P.bonus(byName[x.name].balance); } },
                { t: 'Что написать', html: function (x) { return P.esc(segText[x.segment] || ''); } }
            ], list.slice(0, 80), { empty: 'Писать сегодня некому' }));
            host.appendChild(P.el('p', { 'class': 'loy-muted', text: 'Гости без согласия на рассылку в список не попадают. Отправка SMS и Telegram - опция по запросу, на демо - выгрузка.' }));
        }
        function matrix(rows) {
            var box = P.el('div', { 'class': 'loy-card' }, [P.el('h3', { text: 'Матрица: давность (R) x частота (F)' })]);
            var grid = P.el('div', { 'class': 'loy-rfm' });
            grid.appendChild(P.el('div', { 'class': 'loy-ax', text: 'R \\ F' }));
            [1, 2, 3, 4, 5].forEach(function (f) { grid.appendChild(P.el('div', { 'class': 'loy-ax', text: 'F' + f })); });
            [5, 4, 3, 2, 1].forEach(function (r) {
                grid.appendChild(P.el('div', { 'class': 'loy-ax', text: 'R' + r }));
                [1, 2, 3, 4, 5].forEach(function (f) {
                    var here = rows.filter(function (x) { return x.R === r && x.F === f; });
                    var seg = here.length ? here[0].segment : C.rfm({ last: C.addDays(M.today, -[0, 90, 45, 20, 10, 3][r]), visits90: [0, 1, 3, 8, 14, 30][f], sum90: 0 }, M.today, M.program.lostDays).segment;
                    grid.appendChild(P.el('div', { 'class': 'loy-cell loy-seg-' + P.segKey(seg), title: seg + ': ' + here.length, text: here.length ? String(here.length) : '·', onclick: function () { segPick = seg; draw(); } }));
                });
            });
            box.appendChild(grid);
            box.appendChild(P.el('p', { 'class': 'loy-muted', text: 'R5 - были за неделю, R1 - больше ' + M.program.lostDays * 2 + ' дней назад; F - визитов за 90 дней. Клик по клетке - список.' }));
            return box;
        }
        function campaigns(M) {
            var box = P.el('div', { 'class': 'loy-card' }, [P.el('h3', { text: 'Кампании против контрольной группы' })]);
            if (!M.campaigns) { box.appendChild(P.el('p', { 'class': 'loy-muted', text: 'Кампании видит маркетолог.' })); return box; }
            box.appendChild(P.table([
                { t: 'Кампания', html: function (c) { return P.esc(c.name) + '<br><small class="loy-muted">' + C.toDmy(c.date) + ', ' + P.esc(c.channel) + '</small>'; } }, { t: 'Сегмент', html: function (c) { return P.seg(c.segment); } },
                { t: 'Вернулись', num: true, html: function (c) { var u = C.uplift(c); return u.conv + '%'; } }, { t: 'Контроль', num: true, html: function (c) { var u = C.uplift(c); return u.noControl ? '—' : u.base + '%'; } },
                { t: 'Эффект', html: function (c) { var u = C.uplift(c); return u.noControl ? P.badge('нет контроля', 'mute') : u.effective ? P.badge('+' + u.pp + ' п.п., +' + u.extra + ' гостей', 'ok') : P.badge(u.pp + ' п.п.: вернулись бы и так', 'warn'); } }
            ], M.campaigns.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; })));
            box.appendChild(P.el('p', { 'class': 'loy-muted', text: 'Эффект = доля вернувшихся минус доля вернувшихся в контрольной группе (им не писали).' }));
            return box;
        }
        draw();
    });
})();
