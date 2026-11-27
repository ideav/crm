/* Service Desk: портал заявителя. «Мне нужно…» -> услуга из каталога -> форма со своими полями -> сразу маршрут, ответственный и срок. Ниже - мои заявки. */
(function () {
    'use strict';
    var P = window.Desk, C = P.core;
    var st = { q: '', as: '' };

    function requester(M) { return M.me || M.empByLogin[st.as] || null; }
    function preview(M, svc, emp, prioName) {
        var srv = M.serviceBy[svc.service] || {}, steps = C.routeSteps(svc, emp, srv), prio = M.prioBy[prioName || svc.prio];
        var dl = C.deadlines(M.now, svc, prio, M.cal, 0), b = dl.budget;
        var lines = [];
        lines.push('<b>Маршрут:</b> ' + (steps.length ? steps.map(function (s) { return P.esc(s.role + ' - ' + (s.who || 'не указан')); }).join(' → ') + ' → ' : '') + 'служба ' + P.esc(svc.service) + ' (руководитель ' + P.esc(srv.head || '') + ') → исполнитель ' + P.esc(svc.exec || 'назначит диспетчер'));
        lines.push('<b>Срок:</b> реакция до ' + P.esc(C.fmtShort(dl.react)) + ', решение до <b>' + P.esc(C.fmtShort(dl.solve)) + '</b> (' + Math.round(b.solve / 6) / 10 + ' рабочих ч, Пн-Пт ' + M.rules.dayStart + ':00-' + M.rules.dayEnd + ':00, приоритет «' + P.esc(prio ? prio.name : '') + '»)' + (steps.length ? '; часы SLA идут после согласования' : ''));
        return { html: lines.join('<br>'), steps: steps, dl: dl };
    }
    function openForm(host, M, svc, text) {
        var emp = requester(M);
        var fields = C.parseForm(svc.form), inputs = {};
        var roomGuess = C.findRoom(text, M.rooms) || (emp ? M.roomBy[emp.room] : null);
        var form = P.el('div', { 'class': 'desk-grid2' });
        fields.forEach(function (f) {
            var inp;
            if (f.name === 'Помещение') inp = P.select([['', '-']].concat(M.rooms.map(function (r) { return [r.name, r.name + ' - ' + r.purpose + ' (' + r.site + ')']; })), roomGuess ? roomGuess.name : '');
            else if (f.type === 'select') inp = P.select([['', '-']].concat(f.options), '');
            else inp = P.input(f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text', '');
            inputs[f.name] = inp;
            form.appendChild(P.field(f.name + (f.req ? ' *' : ''), inp));
        });
        var descr = P.input('textarea', text || '', { placeholder: 'Опишите, что случилось' });
        var prio = P.select(M.prios.map(function (p) { return p.name; }), svc.prio);
        var pv = P.el('div', { 'class': 'desk-note' }), errs = P.el('div', {});
        function refresh() { pv.innerHTML = preview(M, svc, emp, prio.value).html; }
        prio.onchange = refresh; refresh();
        var body = P.el('div', {}, [
            P.el('p', { 'class': 'desk-muted', text: svc.descr }),
            P.el('p', { html: 'Заявитель: <b>' + P.esc(emp ? emp.name : '-') + '</b>' + (emp ? ', ' + P.esc(emp.dept) + ', пом. ' + P.esc(emp.room) + ', ' + P.esc(emp.phone) : '') }),
            form, P.field('Описание', descr), P.field('Срочность', prio, 'Критичный - работа отдела стоит'), pv, errs
        ]);
        P.modal(svc.name, body, [{ text: 'Отмена' }, { text: 'Отправить заявку', cls: 'desk-primary', fn: function (close, bt) {
            var vals = {}; Object.keys(inputs).forEach(function (k) { vals[k] = inputs[k].value; });
            var e = C.validateForm(fields, vals); if (!emp) e.unshift('Выберите заявителя');
            errs.innerHTML = ''; e.forEach(function (x) { errs.appendChild(P.el('div', { 'class': 'desk-warnbox desk-e', text: x })); });
            if (e.length) return false;
            bt.disabled = true;
            var p = preview(M, svc, emp, prio.value), now = P.wr(M.now), num = '';
            P.nextNum(M).then(function (n) {
            num = n;
            var topic = (descr.value.split(/\n/)[0] || svc.name).slice(0, 90);
            var f = { 'Заявка': num, 'Услуга': svc.id, 'Заявитель': M.empBy[emp.name].id, 'Логин заявителя': emp.login, 'Тема заявки': topic, 'Описание заявки': C.formText(fields, vals, descr.value),
                'Приоритет': prio.value, 'Статус заявки': p.steps.length ? 'На согласовании' : 'Новая', 'Канал': 'Портал', 'Создана': now, 'Срок реакции': P.wr(p.dl.react), 'Срок решения': P.wr(p.dl.solve) };
            if (vals['Помещение'] && M.roomBy[vals['Помещение']]) f['Помещение'] = M.roomBy[vals['Помещение']].id;
            if (p.steps.length) f['Пауза с'] = now;
            var ops = [{ op: 'new', id: 'Заявка', up: 1, fields: f }];
            p.steps.forEach(function (s) { ops.push({ op: 'new', id: 'Согласование', up: 1, fields: { 'Заявка': ':id0', 'Шаг согласования': s.step, 'Согласующий': s.who, 'Логин согласующего': s.login, 'Логин заявителя': emp.login } }); });
            ops.push(P.evOp(':id0', emp.name, 'Заявка создана (портал)' + (p.steps.length ? '; маршрут: ' + p.steps.map(function (s) { return s.role + ' - ' + s.who; }).join(', ') : ''), emp.login));
            ops[ops.length - 1].fields['Когда'] = now;
            return P.batch(ops);
            }).then(function () {
                close();
                P.reload(function (M2) { render(host, M2); var t = M2.ticketBy[num]; if (t) P.ticketCard(M2, t); P.toast('Заявка ' + num + ' принята. Срок решения - ' + C.fmtShort(p.dl.solve)); });
            }).catch(function (er) { bt.disabled = false; P.toast(er.message, true); });
            return false;
        } }], true);
    }
    function act(host, M, t, kind) {
        var emp = requester(M), now = P.wr(M.now), ops;
        if (kind === 'confirm') ops = [{ op: 'set', id: t.id, fields: { 'Статус заявки': 'Закрыта', 'Закрыта': now } }, P.evOp(t.num, emp.name, 'Заявитель подтвердил решение, заявка закрыта', emp.login)];
        else if (kind === 'reopen') ops = [{ op: 'set', id: t.id, fields: { 'Статус заявки': 'В работе', 'Решена': '' } }, P.evOp(t.num, emp.name, 'Заявитель вернул заявку в работу: не решено', emp.login)];
        else {
            var txt = P.input('textarea', '', { placeholder: 'Ваш ответ исполнителю' });
            P.modal('Ответ по ' + t.num, P.field('Ответ', txt), [{ text: 'Отмена' }, { text: 'Отправить', cls: 'desk-primary', fn: function () {
                var add = t.pausedFrom !== null ? C.workBetween(t.pausedFrom, M.now, M.cal) : 0;
                P.batch([{ op: 'set', id: t.id, fields: { 'Статус заявки': 'В работе', 'Пауза с': '', 'Пауза, мин': t.pauseMin + add } }, P.evOp(t.num, emp.name, 'Заявитель ответил: ' + (txt.value || '-') + '. Таймер продолжен', emp.login)])
                    .then(function () { P.reload(function (M2) { render(host, M2); P.toast('Ответ отправлен, таймер SLA продолжен'); }); }).catch(function (er) { P.toast(er.message, true); });
            } }]);
            return;
        }
        P.batch(ops).then(function () { P.reload(function (M2) { render(host, M2); P.toast(kind === 'confirm' ? 'Спасибо! Заявка закрыта' : 'Заявка возвращена исполнителю'); }); }).catch(function (er) { P.toast(er.message, true); });
    }
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('h1', { text: 'Мне нужно…' }));
        host.appendChild(P.el('p', { 'class': 'desk-sub', text: 'Единое окно ИТ, АХО и кадров. Напишите своими словами - подскажем услугу, покажем маршрут и срок. Звонить не нужно.' }));
        var emp = requester(M);
        if (!M.me) {
            var who = P.select([['', 'Выберите заявителя (вы вошли не как сотрудник)']].concat(M.emps.map(function (e) { return [e.login, e.name + ', ' + e.dept]; })), st.as);
            who.onchange = function () { st.as = who.value; render(host, M); };
            host.appendChild(P.el('div', { 'class': 'desk-bar' }, [P.field('Заявитель', who)]));
        }
        var q = P.input('search', st.q, { placeholder: 'Например: не открывается дверь в 304', 'class': 'desk-search', 'aria-label': 'Что случилось' });
        var hint = P.el('div', { 'class': 'desk-suggest' });
        function suggest() {
            st.q = q.value; hint.innerHTML = '';
            var found = C.matchServices(q.value, M.catalog.filter(function (s) { return s.published; }), 4), room = C.findRoom(q.value, M.rooms);
            if (!q.value.trim()) return;
            if (!found.length) { hint.appendChild(P.el('div', { 'class': 'desk-muted', text: 'Похожей услуги нет - выберите в каталоге ниже или «Другое» у нужной службы.' })); return; }
            found.forEach(function (r, i) {
                hint.appendChild(P.el('button', { type: 'button', 'class': 'desk-sugg' + (i === 0 ? ' desk-sugg-top' : ''), onclick: function () { openForm(host, M, r.svc, q.value); },
                    html: '<b>' + P.esc(r.svc.name) + '</b><span>' + P.esc(r.svc.service) + ' · решение за ' + r.svc.solveH + ' раб. ч' + (r.svc.route ? ' · с согласованием' : '') + (i === 0 && room ? ' · помещение ' + P.esc(room.name) + ' подставим' : '') + '</span>' }));
            });
        }
        q.addEventListener('input', suggest);
        q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var f = C.matchServices(q.value, M.catalog, 1); if (f.length) openForm(host, M, f[0].svc, q.value); } });
        host.appendChild(P.el('div', { 'class': 'desk-hero' }, [q, hint]));
        suggest();
        /* каталог */
        var cat = P.el('div', { 'class': 'desk-cat' });
        M.services.forEach(function (srv) {
            var list = M.catalog.filter(function (s) { return s.service === srv.name && s.published; });
            if (!list.length) return;
            cat.appendChild(P.el('section', { 'class': 'desk-cat-col' }, [P.el('h2', { text: srv.name })].concat(list.map(function (s) {
                return P.el('button', { type: 'button', 'class': 'desk-svc', onclick: function () { openForm(host, M, s, ''); }, html: '<b>' + P.esc(s.name) + '</b><span>' + P.esc(s.descr) + '</span><small>решение за ' + s.solveH + ' раб. ч' + (s.route ? ' · согласует: ' + P.esc(s.route) : '') + '</small>' });
            }))));
        });
        host.appendChild(cat);
        /* мои заявки */
        host.appendChild(P.el('h2', { text: 'Мои заявки' }));
        if (!emp) { host.appendChild(P.el('p', { 'class': 'desk-muted', text: 'Выберите заявителя, чтобы увидеть его заявки.' })); return; }
        var mine = M.tickets.filter(function (t) { return t.empLogin === emp.login; }).sort(function (a, b) { return b.created - a.created; });
        var auto = M.rules.autoCloseDays;
        host.appendChild(P.table([
            { t: 'Номер', k: 'num' }, { t: 'Что', html: function (t) { return P.esc(t.topic) + '<br><small class="desk-muted">' + P.esc(t.service) + '</small>'; } },
            { t: 'Статус', html: function (t) { return P.statusBadge(M, t, true); } },
            { t: 'Срок', html: function (t) { return C.isOpen(t) ? P.timer(t) : P.slaBadge(t); } },
            { t: 'Исполнитель', html: function (t) { return P.esc(t.exec || '-'); } },
            { t: '', node: function (t) {
                var w = P.el('div', { 'class': 'desk-acts' });
                if (t.status === 'Решена') {
                    w.appendChild(P.btn('Подтвердить', function () { act(host, M, t, 'confirm'); }, 'desk-primary desk-small'));
                    w.appendChild(P.btn('Не решено', function () { act(host, M, t, 'reopen'); }, 'desk-small'));
                    w.appendChild(P.el('small', { 'class': 'desk-muted', text: 'закроется сама через ' + auto + ' раб. дн.' }));
                }
                if (t.status === 'Ждём заявителя') w.appendChild(P.btn('Ответить', function () { act(host, M, t, 'answer'); }, 'desk-primary desk-small'));
                return w;
            } }
        ], mine, { onrow: function (t) { P.ticketCard(M, t); }, empty: 'Заявок пока нет', rowCls: function (t) { return t.status === 'Решена' || t.status === 'Ждём заявителя' ? 'desk-row-hl' : ''; } }));
    }
    P.mount(render);
})();
