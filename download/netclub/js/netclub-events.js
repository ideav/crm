/* Бизнес-клуб: события - запись с лимитом мест, лист ожидания, отметка «пришёл»; участник записывается сам. */
(function () {
    'use strict';
    var N = window.Netclub, C = N.core;
    var REG_KIND = { 'Записан': 'info', 'Пришёл': 'ok', 'Не пришёл': 'bad', 'Лист ожидания': 'warn', 'Отменил': 'muted' };
    function regName(ev, who) { return ev.name.replace(/^Бизнес-завтрак /, 'Завтрак ').replace(/^Нетворкинг-вечер /, 'Вечер ') + ' · ' + who.split(' ').slice(0, 2).join(' '); }
    function seatText(s) { return s.taken + ' из ' + s.limit + (s.free === 0 ? ' · мест нет' : ' · свободно ' + s.free); }
    function seatBar(s, wait) {
        var pct = s.limit ? Math.min(100, Math.round(s.taken * 100 / s.limit)) : 0;
        return N.el('div', { 'class': 'nc-seat' }, [N.el('div', { 'class': 'nc-bartrack' }, [N.el('div', { 'class': 'nc-barfill' + (s.free === 0 ? ' nc-barwarn' : ''), style: 'width:' + pct + '%' })]),
            N.el('span', { 'class': 'nc-muted', text: seatText(s) + (wait ? ' · лист ожидания ' + wait : '') })]);
    }
    function evHead(ev) {
        return N.el('div', { 'class': 'nc-evhead' }, [N.el('b', { text: ev.name }), N.el('div', { 'class': 'nc-muted', text: C.toDmy(ev.date) + ' ' + ev.time + ' · ' + ev.venue + (ev.price ? ' · ' + C.money(ev.price) : ' · бесплатно для резидентов') + (ev.host ? ' · ведёт ' + ev.host : '') })]);
    }

    /* ---------- сотрудники клуба ---------- */
    function staffEvent(host, M, ev) {
        var s = C.seats(ev, M.regs), past = ev.date < N.TODAY;
        host.appendChild(N.el('p', {}, [N.el('a', { href: '#', onclick: function (e) { e.preventDefault(); location.hash = ''; N.refresh(); }, text: '← Все события' })]));
        host.appendChild(evHead(ev)); host.appendChild(N.el('p', { 'class': 'nc-sub', text: ev.descr }));
        host.appendChild(seatBar(s, s.wait.length));
        if (s.free > 0 && s.wait.length && !past) host.appendChild(N.el('div', { 'class': 'nc-warnline' }, ['Освободилось мест: ' + s.free + ', в листе ожидания ' + s.wait.length + '. ',
            N.btn('Перевести из листа ожидания', function () { var up = s.wait.slice(0, s.free); Promise.all(up.map(function (r) { return N.update(r.id, { 'Статус записи': 'Записан' }); })).then(function () { N.toast('Переведены: ' + up.map(function (r) { return r.member; }).join(', ')); N.refresh(); }); }, 'nc-small nc-primary')]));
        var bar = N.el('div', { 'class': 'nc-bar' });
        if (!past) {
            var have = {}; s.regs.forEach(function (r) { if (r.status !== 'Отменил') have[r.member] = 1; });
            var who = N.select([['', 'Выберите участника']].concat(M.members.filter(function (m) { return (m.status === 'Активен' || m.status === 'Принят') && !have[m.name]; }).map(function (m) { return [m.id, m.name]; })), '');
            bar.appendChild(N.field('Записать участника', who));
            bar.appendChild(N.btn('Записать', function () {
                var m = M.memberById[who.value]; if (!m) return N.toast('Выберите участника', true);
                var d; try { d = C.registerDecision(ev, M.regs, m.name, N.TODAY); } catch (e) { return N.toast(e.message, true); }
                N.create('Запись на событие', { 'Запись на событие': regName(ev, m.name), 'Событие': ev.id, 'Участник': m.id, 'Статус записи': d.status, 'Дата записи': N.TODAY, 'Порядок записи': d.ord, 'Логин участника': m.login || C.loginFor(m.name) })
                    .then(function () { N.toast(m.name + (d.status === 'Записан' ? ': записан(а)' : ': мест нет, лист ожидания №' + d.waitPos)); N.refresh(); }, function (e) { N.toast(e.message, true); });
            }, 'nc-primary'));
        }
        bar.appendChild(N.btn('Выгрузить список', function () { N.download('zapis.csv', C.toCsv(s.regs.map(function (r) { var m = M.memberBy[r.member] || {}; return { member: r.member, company: m.company, phone: m.phone, status: r.status }; }), [['member', 'Участник'], ['company', 'Компания'], ['phone', 'Телефон'], ['status', 'Статус']])); }));
        host.appendChild(bar);
        var order = { 'Пришёл': 0, 'Не пришёл': 0, 'Записан': 0, 'Лист ожидания': 1, 'Отменил': 2 };
        var list = s.regs.slice().sort(function (a, b) { return order[a.status] - order[b.status] || a.ord - b.ord; });
        var wpos = {}; s.wait.forEach(function (r, i) { wpos[r.id] = i + 1; });
        host.appendChild(N.table([{ t: '№', num: 1, k: 'ord' }, { t: 'Участник', html: function (r) { var m = M.memberBy[r.member]; return N.esc(r.member) + (m ? '<div class="nc-muted">' + N.esc(m.company) + '</div>' : ''); } },
            { t: 'Статус', html: function (r) { return N.badge(r.status + (wpos[r.id] ? ' №' + wpos[r.id] : ''), REG_KIND[r.status]); } }, { t: 'Записан', html: function (r) { return C.toDmy(r.date); } },
            { t: 'Действия', node: function (r) {
                var box = N.el('div', { 'class': 'nc-actions' });
                if (r.status === 'Записан' || r.status === 'Пришёл' || r.status === 'Не пришёл') {
                    if (ev.date <= N.TODAY) {
                        box.appendChild(N.btn('Пришёл', function () { setReg(r, 'Пришёл'); }, 'nc-small' + (r.status === 'Пришёл' ? ' nc-primary' : '')));
                        box.appendChild(N.btn('Не пришёл', function () { setReg(r, 'Не пришёл'); }, 'nc-small' + (r.status === 'Не пришёл' ? ' nc-danger' : '')));
                    }
                }
                if (!past && r.status !== 'Отменил' && r.status !== 'Пришёл') box.appendChild(N.btn('Отменить', function () { cancel(M, ev, r); }, 'nc-small'));
                return box;
            } }], list, { empty: 'Записей нет' }));
    }
    function setReg(r, st) { N.update(r.id, { 'Статус записи': st }).then(function () { N.toast(r.member + ': ' + st.toLowerCase()); N.refresh(); }, function (e) { N.toast(e.message, true); }); }
    function cancel(M, ev, r) {
        var ch = C.cancelChanges(ev, M.regs, r.id, M.settings.autoPromote);
        Promise.all(ch.map(function (c) { return N.update(c.id, { 'Статус записи': c.status }); })).then(function () {
            N.toast(r.member + ': запись отменена' + (ch[1] ? '. Место получил(а) ' + ch[1].promoted + ' из листа ожидания' : '')); N.refresh();
        }, function (e) { N.toast(e.message, true); });
    }
    function staffList(host, M) {
        var up = M.events.filter(function (e) { return e.date >= N.TODAY; }), past = M.events.filter(function (e) { return e.date < N.TODAY; }).reverse();
        var att = C.attendance(M.events, M.regs, N.TODAY), attBy = {}; att.rows.forEach(function (r) { attBy[r.event.name] = r; });
        function grid(list) {
            return N.el('div', { 'class': 'nc-cards' }, list.map(function (ev) {
                var s = C.seats(ev, M.regs), a = attBy[ev.name];
                return N.el('button', { type: 'button', 'class': 'nc-card', onclick: function () { location.hash = 'ev=' + ev.id; N.refresh(); } }, [evHead(ev), seatBar(s, s.wait.length),
                    a ? N.el('div', { html: 'Явка ' + N.badge(a.came + ' из ' + a.reg + ' · ' + a.rate + '%', a.rate < 60 ? 'bad' : a.rate < 80 ? 'warn' : 'ok') }) : null]);
            }));
        }
        host.appendChild(N.el('h2', { text: 'Ближайшие' })); host.appendChild(grid(up));
        host.appendChild(N.el('h2', { text: 'Прошедшие' })); host.appendChild(grid(past));
    }

    /* ---------- участник ---------- */
    function memberList(host, M) {
        var me = M.me;
        if (!me) { host.appendChild(N.el('p', { 'class': 'nc-warnline', text: 'Ваша учётная запись не связана с карточкой участника — обратитесь к менеджеру клуба.' })); }
        M.events.filter(function (e) { return e.date >= N.TODAY; }).forEach(function (ev) {
            var s = C.seatsFromReport(ev, M.seatRows), mine = M.regs.filter(function (r) { return r.event === ev.name && r.status !== 'Отменил'; })[0];
            var act = N.el('div', { 'class': 'nc-actions' });
            if (mine) {
                act.appendChild(N.el('span', { html: N.badge(mine.status === 'Лист ожидания' ? 'Вы в листе ожидания' : 'Вы записаны', REG_KIND[mine.status]) }));
                if (ev.date > N.TODAY) act.appendChild(N.btn('Отменить запись', function () { N.update(mine.id, { 'Статус записи': 'Отменил' }).then(function () { N.toast('Запись отменена'); N.refresh(); }, function (e) { N.toast(e.message, true); }); }, 'nc-small'));
            } else if (me && ev.date > N.TODAY) {
                act.appendChild(N.btn(s.free > 0 ? 'Записаться' : 'В лист ожидания', function () {
                    var st = s.free > 0 ? 'Записан' : 'Лист ожидания';
                    N.create('Запись на событие', { 'Запись на событие': regName(ev, me.name), 'Событие': ev.id, 'Участник': me.id, 'Статус записи': st, 'Дата записи': N.TODAY, 'Порядок записи': s.taken + s.waitCount + 1, 'Логин участника': N.ctx.user })
                        .then(function () { N.toast(st === 'Записан' ? 'Вы записаны: ' + ev.name : 'Мест нет — вы в листе ожидания, место придёт при отмене'); N.refresh(); }, function (e) { N.toast(e.message, true); });
                }, 'nc-primary'));
            }
            host.appendChild(N.el('div', { 'class': 'nc-card nc-card-static' }, [evHead(ev), N.el('p', { 'class': 'nc-sub', text: ev.descr }), seatBar(s, s.waitCount), act]));
        });
        var hist = M.regs.filter(function (r) { var e = M.eventBy[r.event]; return e && e.date < N.TODAY; });
        host.appendChild(N.el('h2', { text: 'Мои прошедшие события' }));
        host.appendChild(N.table([{ t: 'Событие', k: 'event' }, { t: 'Дата', html: function (r) { return C.toDmy(M.eventBy[r.event].date); } }, { t: 'Статус', html: function (r) { return N.badge(r.status, REG_KIND[r.status]); } }], hist, { empty: 'Пока не было' }));
    }

    N.mount(function (host, M) {
        N.head('События клуба', N.isStaff() ? 'Бизнес-завтраки, вечера, ужины. Лимит мест, лист ожидания по порядку записи, отметка явки в день события.' : 'Запишитесь на встречу. Если мест нет — встаньте в лист ожидания: при отмене место придёт по порядку.').forEach(function (x) { host.appendChild(x); });
        if (!N.isStaff()) return memberList(host, M);
        var id = (location.hash.match(/ev=(\d+)/) || [])[1], ev = id && M.events.filter(function (e) { return e.id === id; })[0];
        return ev ? staffEvent(host, M, ev) : staffList(host, M);
    });
})();
