/* Service Desk: мои заявки исполнителя (штатный инженер или подрядчик). Взять в работу, спросить заявителя (таймер на паузе), решить с фото. */
(function () {
    'use strict';
    var P = window.Desk, C = P.core;
    var st = { tab: 'open', as: '' };

    function me(M) { return M.meExec || M.execBy[st.as] || null; }
    function photoReq() { var t = P.metaBy['Заявка']; var r = t && (t.reqs || []).filter(function (q) { return q.val === 'Фото решения'; })[0]; return r ? r.id : null; }
    function upload(id, file) {
        var rq = photoReq(); if (!file || !rq) return Promise.resolve();
        var fd = new FormData(); fd.append('_xsrf', P.ctx.xsrf); fd.append('t' + rq, file, file.name);
        return fetch(P.url('_m_set/' + id + '?JSON=1'), { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('Фото не загрузилось: HTTP ' + r.status); });
    }
    function done(host, msg) { P.reload(function (M2) { render(host, M2); P.toast(msg); }); }
    function take(host, M, t) {
        var ex = me(M);
        P.batch([{ op: 'set', id: t.id, fields: { 'Статус заявки': 'В работе', 'Взята в работу': P.wr(M.now) } }, P.evOp(t.num, ex.name, 'Взята в работу', t.empLogin)])
            .then(function () { done(host, t.num + ' в работе'); }).catch(function (er) { P.toast(er.message, true); });
    }
    function ask(host, M, t) {
        var ex = me(M), q = P.input('textarea', '', { placeholder: 'Что нужно уточнить у заявителя' });
        P.modal('Вопрос заявителю: ' + t.num, P.el('div', {}, [P.field('Вопрос', q), P.el('p', { 'class': 'desk-muted', text: 'Пока заявитель не ответит, таймер SLA стоит: время ожидания не считается просрочкой исполнителя.' })]),
            [{ text: 'Отмена' }, { text: 'Отправить и поставить на паузу', cls: 'desk-primary', fn: function () {
                if (!q.value.trim()) return false;
                P.batch([{ op: 'set', id: t.id, fields: { 'Статус заявки': 'Ждём заявителя', 'Пауза с': P.wr(M.now) } }, P.evOp(t.num, ex.name, 'Ждём заявителя: ' + q.value.trim(), t.empLogin)])
                    .then(function () { done(host, 'Вопрос отправлен, таймер на паузе'); }).catch(function (er) { P.toast(er.message, true); });
            } }]);
    }
    function solve(host, M, t) {
        var ex = me(M), a = P.input('textarea', '', { placeholder: 'Что сделано' }), f = P.el('input', { type: 'file', accept: 'image/*' });
        P.modal('Решить: ' + t.num, P.el('div', {}, [P.field('Решение', a), P.field('Фото результата', f, 'Заявитель увидит фото и подтвердит одним кликом'), P.el('div', { html: P.timer(t) })]),
            [{ text: 'Отмена' }, { text: 'Решено', cls: 'desk-primary', fn: function (close, bt) {
                if (!a.value.trim()) return false;
                bt.disabled = true;
                var fields = { 'Статус заявки': 'Решена', 'Решена': P.wr(M.now), 'Решение заявки': a.value.trim() };
                if (!t.taken) fields['Взята в работу'] = P.wr(M.now);
                P.batch([{ op: 'set', id: t.id, fields: fields }, P.evOp(t.num, ex.name, 'Решена: ' + a.value.trim() + (f.files[0] ? ' (фото приложено)' : ''), t.empLogin)])
                    .then(function () { return upload(t.id, f.files[0]); })
                    .then(function () { close(); done(host, t.num + ' решена, заявителю ушло «подтвердите»'); }).catch(function (er) { bt.disabled = false; P.toast(er.message, true); });
                return false;
            } }]);
    }
    function render(host, M) {
        host.innerHTML = '';
        var ex = me(M);
        host.appendChild(P.el('h1', { text: 'Мои заявки' }));
        host.appendChild(P.el('p', { 'class': 'desk-sub', text: ex ? ex.name + (ex.type === 'Подрядчик' ? ' - подрядчик службы ' + ex.service + ': вы видите только назначенные вам заявки.' : ', служба ' + ex.service + '.') : 'Экран исполнителя.' }));
        if (!M.meExec) {
            var sel = P.select([['', 'Выберите исполнителя (вы вошли не как исполнитель)']].concat(M.execs.map(function (e) { return [e.name, e.name + ' (' + e.service + ')']; })), st.as);
            sel.onchange = function () { st.as = sel.value; render(host, M); };
            host.appendChild(P.el('div', { 'class': 'desk-bar' }, [P.field('Исполнитель', sel)]));
            if (!ex) return;
        }
        var mine = M.tickets.filter(function (t) { return t.exec === ex.name; });
        var open = mine.filter(function (t) { return C.isOpen(t); }).sort(function (a, b) { return a.sla.left - b.sla.left; });
        var closed = mine.filter(function (t) { return !C.isOpen(t); }).sort(function (a, b) { return b.created - a.created; });
        var from = M.now - 30 * 1440, rep = C.slaReport(mine, function () { return 'я'; }, from, M.now + 1)[0];
        host.appendChild(P.el('div', { 'class': 'desk-kpis' }, [
            P.kpi('В работе', String(open.length), open.filter(function (t) { return t.sla.state === 'breach'; }).length + ' просрочено', open.some(function (t) { return t.sla.state === 'breach'; }) ? 'bad' : ''),
            P.kpi('Мой SLA за 30 дней', rep && rep.pct !== null ? String(rep.pct).replace('.', ',') + '%' : '-', rep ? rep.inTime + ' из ' + rep.total + ' в срок' : '', rep && rep.pct !== null && rep.pct < M.rules.target ? 'bad' : 'good')
        ]));
        host.appendChild(P.tabs([['open', 'Открытые', open.length], ['closed', 'Решённые', closed.length]], st.tab, function (k) { st.tab = k; render(host, M); }));
        var canW = P.canWrite('Заявка');
        host.appendChild(P.table([
            { t: 'Номер', k: 'num' }, { t: 'Заявка', html: function (t) { return P.esc(t.topic) + '<br><small class="desk-muted">' + P.esc(t.service) + (t.room ? ' · пом. ' + P.esc(t.room) : '') + '</small>'; } },
            { t: 'Заявитель', html: function (t) { var e = M.empBy[t.emp]; return P.esc(t.emp) + (e ? '<br><small class="desk-muted">' + P.esc(e.phone) + '</small>' : ''); } },
            { t: 'Срок', html: function (t) { return P.timer(t); } }, { t: 'Статус', html: function (t) { return P.statusBadge(M, t); } },
            { t: '', node: function (t) {
                var w = P.el('div', { 'class': 'desk-acts' }); if (!canW || !C.isOpen(t)) return w;
                if (t.status === 'Назначена' || t.status === 'Новая') w.appendChild(P.btn('Взять в работу', function () { take(host, M, t); }, 'desk-small desk-primary'));
                if (t.status !== 'Ждём заявителя') w.appendChild(P.btn('Спросить', function () { ask(host, M, t); }, 'desk-small'));
                w.appendChild(P.btn('Решить', function () { solve(host, M, t); }, 'desk-small' + (t.status === 'В работе' ? ' desk-primary' : '')));
                return w;
            } }
        ], st.tab === 'open' ? open : closed, { onrow: function (t) { P.ticketCard(M, t); }, rowCls: function (t) { return 'desk-r-' + t.sla.state; }, empty: 'Нет заявок' }));
    }
    P.mount(render);
})();
