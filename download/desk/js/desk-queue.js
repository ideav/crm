/* Service Desk: очередь диспетчера. Просрочено, скоро срок, без исполнителя, ждут заявителя, на согласовании; назначение в один клик; повторные заявки. */
(function () {
    'use strict';
    var P = window.Desk, C = P.core;
    var st = { tab: '', dept: '' };
    var TABS = [['overdue', 'Просрочено'], ['soon', 'Скоро срок'], ['unassigned', 'Без исполнителя'], ['waiting', 'Ждут заявителя'], ['approval', 'На согласовании'], ['inwork', 'В работе'], ['all', 'Все открытые']];

    function assign(host, M, t, execName) {
        var ex = M.execBy[execName]; if (!ex) return;
        var f = { 'Исполнитель': ex.id, 'Логин исполнителя': ex.login };
        if (t.status === 'Новая') f['Статус заявки'] = 'Назначена';
        P.batch([{ op: 'set', id: t.id, fields: f }, P.evOp(t.num, (M.me ? M.me.name : P.ctx.user) + ' (диспетчер)', 'Назначен исполнитель: ' + ex.name + (ex.type === 'Подрядчик' ? ' (подрядчик)' : ''), t.empLogin)])
            .then(function () { P.reload(function (M2) { render(host, M2); P.toast(t.num + ': назначен ' + ex.name); }); }).catch(function (er) { P.toast(er.message, true); });
    }
    function waitInfo(M, t) {
        var ap = M.approvals.filter(function (a) { return a.num === t.num && !a.decision; }).sort(function (a, b) { return a.step - b.step; })[0];
        if (!ap) return '';
        var prev = M.approvals.filter(function (a) { return a.num === t.num && a.step < ap.step && a.date; }).map(function (a) { return a.date; });
        var since = prev.length ? Math.max.apply(null, prev) : t.created, h = Math.round(C.workBetween(since, M.now, M.cal) / 6) / 10;
        return 'ждёт: ' + ap.who + ', ' + String(h).replace('.', ',') + ' раб. ч';
    }
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('h1', { text: 'Очередь службы' }));
        host.appendChild(P.el('p', { 'class': 'desk-sub', text: 'Таймер считает рабочие часы службы (Пн-Пт ' + M.rules.dayStart + ':00-' + M.rules.dayEnd + ':00, без праздников) и стоит, пока заявка ждёт заявителя или согласования. Сейчас ' + C.fmtShort(M.now) + '.' }));
        var list = M.tickets.filter(function (t) { return C.isOpen(t) && (!st.dept || t.dept === st.dept); });
        var b = C.buckets(list);
        var dept = P.select([['', 'Все службы']].concat(M.services.map(function (s) { return [s.name, s.name]; })), st.dept);
        dept.onchange = function () { st.dept = dept.value; render(host, M); };
        host.appendChild(P.el('div', { 'class': 'desk-bar' }, [P.field('Служба', dept)]));
        var today = C.isoOf(M.now), phone = list.concat(M.tickets.filter(function (t) { return !C.isOpen(t); })).filter(function (t) { return t.channel !== 'Портал' && C.isoOf(t.created) === today; }).length;
        host.appendChild(P.el('div', { 'class': 'desk-kpis' }, [
            P.kpi('Открыто', String(list.length), 'на согласовании ' + b.approval.length),
            P.kpi('Просрочено', String(b.overdue.length), b.overdue.length ? 'нужна эскалация' : 'нет', b.overdue.length ? 'bad' : 'good'),
            P.kpi('Скоро срок', String(b.soon.length), 'израсходовано больше ' + M.rules.warnPct + '% срока', b.soon.length ? 'warn' : ''),
            P.kpi('Без исполнителя', String(b.unassigned.length), phone ? 'из них звонками мимо портала сегодня: ' + phone : '', b.unassigned.length ? 'warn' : '')
        ]));
        if (!st.tab) st.tab = b.overdue.length ? 'overdue' : 'unassigned';
        host.appendChild(P.tabs(TABS.map(function (x) { return [x[0], x[1], x[0] === 'all' ? list.length : b[x[0]].length]; }), st.tab, function (k) { st.tab = k; render(host, M); }));
        var rows = (st.tab === 'all' ? list : b[st.tab]).slice().sort(function (x, y) { return x.sla.left - y.sla.left; });
        var canW = P.canWrite('Заявка');
        host.appendChild(P.table([
            { t: 'Номер', html: function (t) { return '<b>' + P.esc(t.num) + '</b><br><small class="desk-muted">' + P.esc(t.prio) + (t.channel !== 'Портал' ? ' · ' + P.esc(t.channel.toLowerCase()) : '') + '</small>'; } },
            { t: 'Заявка', html: function (t) { return P.esc(t.topic) + '<br><small class="desk-muted">' + P.esc(t.service) + (t.room ? ' · пом. ' + P.esc(t.room) : '') + '</small>'; } },
            { t: 'Заявитель', html: function (t) { return P.esc(t.emp) + '<br><small class="desk-muted">' + P.esc(t.empDept) + '</small>'; } },
            { t: 'Срок SLA', html: function (t) { return P.timer(t) + (t.bucket === 'approval' ? '<small class="desk-muted">' + P.esc(waitInfo(M, t)) + '</small>' : ''); } },
            { t: 'Статус', html: function (t) { return P.statusBadge(M, t); } },
            { t: 'Исполнитель', node: function (t) {
                if (!canW || t.bucket === 'approval') return P.el('span', { text: t.exec || '-' });
                var opts = M.execs.filter(function (e) { return e.service === t.dept; });
                var sel = P.select([['', t.exec ? t.exec : 'Назначить…']].concat(opts.map(function (e) { return [e.name, e.name + (e.type === 'Подрядчик' ? ' (подрядчик)' : '') + (e.name === t.svc.exec ? ' - по услуге' : '')]; })), '');
                sel.onchange = function () { if (sel.value && sel.value !== t.exec) assign(host, M, t, sel.value); };
                var w = P.el('div', { 'class': 'desk-acts' }, [sel]);
                if (!t.exec && t.svc.exec) w.appendChild(P.btn('→ ' + t.svc.exec.replace(/ .*$/, ''), function () { assign(host, M, t, t.svc.exec); }, 'desk-small desk-primary'));
                return w;
            } }
        ], rows, { onrow: function (t) { P.ticketCard(M, t); }, rowCls: function (t) { return 'desk-r-' + t.sla.state; }, empty: 'Пусто - так и должно быть' }));
        /* повторы */
        var rep = C.repeats(M.tickets.filter(function (t) { return t.created >= M.now - 45 * 1440; }), 30);
        if (rep.length) {
            host.appendChild(P.el('h2', { text: 'Повторные заявки: одна и та же беда в одном месте' }));
            host.appendChild(P.table([
                { t: 'Помещение', k: 'room' }, { t: 'Услуга', k: 'service' }, { t: 'Раз за 45 дней', num: true, html: function (r) { return '<b>' + r.items.length + '</b>'; } },
                { t: 'Заявки', html: function (r) { return r.items.map(function (t) { return P.esc(t.num + ' ' + C.fmtShort(t.created).slice(0, 5) + ' ' + (t.exec || '')); }).join('<br>'); } }
            ], rep.slice(0, 5)));
            host.appendChild(P.el('p', { 'class': 'desk-muted', text: 'Повтор - повод разобрать причину с подрядчиком, а не закрывать заявку ещё раз.' }));
        }
    }
    P.mount(render);
})();
