/* Адаптация персонала: экран «Новички». Светофор, кто и где застрял, панель «Застряли / Идут / Завершают», карточка с чек-листом по ролям, решение по испытательному. */
(function () {
    'use strict';
    var P = window.Onb, C = P.core;
    var st = { tab: '', dept: '' };
    var TABS = [['stuck', 'Застряли'], ['going', 'Идут'], ['finishing', 'Завершают'], ['prep', 'Готовим к выходу'], ['offer', 'Ждут запуска маршрута'], ['archive', 'История']];

    function decide(host, M, n) {
        var crit = P.el('ul', {}, [
            P.el('li', { text: 'Выполнено шагов: ' + n.prog.done + ' из ' + n.prog.total + ' (' + n.prog.pct + '%)' }),
            P.el('li', { text: 'Просрочено сейчас: ' + n.light.reasons.reduce(function (s, r) { return s + r.count; }, 0) }),
            P.el('li', { text: 'Контрольные точки: ' + n.steps.filter(function (s) { return s.type === 'Контрольная точка' && s.done !== null; }).length + ' из ' + n.steps.filter(function (s) { return s.type === 'Контрольная точка'; }).length + ' пройдено' }),
            P.el('li', { text: 'Испытательный: ' + P.probText(n) + ', конец ' + C.fmtD(n.prob.end) })]);
        var dec = P.select([['', 'Выберите…'], ['Оставить', 'Оставить: прошёл испытательный'], ['Продлить', 'Продлить на ' + P.EXTEND_DAYS + ' дней'], ['Расстаться', 'Расстаться']], '');
        var rs = P.select([['', '-']].concat(M.reasons.map(function (r) { return [r.name, r.name + ' (' + r.group.toLowerCase() + ')']; })), '');
        var cm = P.input('textarea', '');
        var err = P.el('div', {});
        P.modal('Решение по испытательному: ' + n.name, P.el('div', {}, [P.el('p', { 'class': 'ob-sub', text: 'Критерии из маршрута - чтобы решение «оставить или нет» не принималось по ощущению.' }), crit,
            P.field('Решение', dec), P.field('Причина ухода', rs, 'обязательно для «Расстаться» - попадает в отчёт по текучести'), P.field('Комментарий', cm, 'для «Продлить» - что должен успеть за продление'), err]), [
            { text: 'Отмена' },
            { text: 'Сохранить решение', cls: 'ob-primary', fn: function (close) {
                var e = C.decisionErrors(dec.value, rs.value, cm.value);
                if (e.length) { err.innerHTML = e.map(function (x) { return '<div class="ob-warnbox ob-e">' + P.esc(x) + '</div>'; }).join(''); return false; }
                var f = { 'Решение по испытательному': dec.value, 'Статус новичка': C.statusAfter(dec.value), 'Дата решения': C.fmtD(M.today), 'Комментарий решения': cm.value };
                if (rs.value) f['Причина ухода'] = rs.value;
                var ops = [{ op: 'set', id: n.id, fields: f }];
                n.steps.filter(function (s) { return /испытательному/.test(s.name) && s.done === null; }).forEach(function (s) { ops.push({ op: 'set', id: s.id, fields: { 'Дата выполнения': C.fmtD(M.today) } }); });
                ops.push(P.evOp(n, P.myName(M) + ' (руководитель)', 'Решение по испытательному: ' + dec.value + (rs.value ? ', причина: ' + rs.value : '') + (cm.value ? '. ' + cm.value : '')));
                P.batch(ops).then(function () { close(); P.reload(function (M2) { render(host, M2); P.toast(n.name + ': ' + dec.value.toLowerCase()); }); }).catch(function (x) { P.toast(x.message, true); });
                return false;
            } }]);
    }
    function open(host, M, n) {
        var acts = [], live = n.bucket !== 'archive' && n.bucket !== 'offer' && n.bucket !== 'prep';
        if (live && P.canWrite('Новичок') && (P.ctx.role === 'admin' || n.managerLogin === P.ctx.user || /HR/i.test(P.ctx.role))) acts.push(P.btn('Решение по испытательному', function () { m.close(); decide(host, M, n); }, 'ob-primary'));
        if (n.bucket === 'offer' && P.canWrite('Шаг новичка') && P.canWrite('Новичок')) acts.push(P.btn('Запустить маршрут', function () { location.href = P.url('launch') + '#nb=' + n.id; }, 'ob-primary'));
        var m = P.newbieCard(M, n, acts.length ? [P.el('div', { 'class': 'ob-modal-foot' }, acts)] : [], function () { P.reload(function (M2) { render(host, M2); }); });
    }
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('h1', { text: 'Новички' }));
        host.appendChild(P.el('p', { 'class': 'ob-sub', text: 'Кто вышел, кто выходит и где застрял. Светофор считается по срокам шагов маршрута: красный - просрочка, жёлтый - срок через ' + M.rules.warn + ' дн. Дата демо ' + C.fmtD(M.today) + ', ' + C.wd(M.today) + '.' }));
        var all = M.newbies.filter(function (n) { return !st.dept || n.dept === st.dept; });
        var b = C.buckets(all), active = all.filter(function (n) { return ['stuck', 'going', 'finishing'].indexOf(n.bucket) >= 0; });
        var dept = P.select([['', 'Все подразделения']].concat(M.depts.map(function (d) { return [d.name, d.name]; })), st.dept);
        dept.onchange = function () { st.dept = dept.value; render(host, M); };
        if (M.depts.length > 1 && all.length) host.appendChild(P.el('div', { 'class': 'ob-bar' }, [P.field('Подразделение', dept)]));
        var svcLate = [], notify = all.filter(function (n) { return n.start !== null && n.start >= M.today && n.start - M.today <= M.rules.notify && n.bucket !== 'archive'; });
        all.forEach(function (n) { n.steps.forEach(function (s) { if (C.SERVICE_ROLES[s.role] && C.stepState(s, M.today, M.rules.warn) === 'overdue') svcLate.push({ n: n, s: s }); }); });
        host.appendChild(P.el('div', { 'class': 'ob-kpis' }, [
            P.kpi('На испытательном', String(active.length), 'завершают ' + b.finishing.length),
            P.kpi('Застряли', String(b.stuck.length), b.stuck.length ? 'есть просроченные шаги' : 'нет', b.stuck.length ? 'bad' : 'good'),
            P.kpi('Заявки служб просрочены', String(svcLate.length), svcLate.length ? 'новичок пришёл, а доступа или пропуска нет' : 'всё готово к выходу', svcLate.length ? 'bad' : 'good'),
            P.kpi('Выходят в ближайшие ' + M.rules.notify + ' дн', String(notify.length), b.offer.length ? 'маршрут не запущен: ' + b.offer.length : 'маршруты запущены', b.offer.length ? 'warn' : '')
        ]));
        if (!st.tab) st.tab = b.stuck.length ? 'stuck' : 'going';
        host.appendChild(P.tabs(TABS.map(function (x) { return [x[0], x[1], b[x[0]].length]; }), st.tab, function (k) { st.tab = k; render(host, M); }));
        var rows = b[st.tab].slice().sort(function (x, y) {
            var rx = x.light.reasons[0], ry = y.light.reasons[0];
            return (ry ? ry.days : -1) - (rx ? rx.days : -1) || (x.prob.left === null ? 999 : x.prob.left) - (y.prob.left === null ? 999 : y.prob.left);
        });
        host.appendChild(P.table([
            { t: 'Новичок', html: function (n) { return '<b>' + P.esc(n.name) + '</b><br><small class="ob-muted">' + P.esc(n.pos) + '</small>'; } },
            { t: 'Подразделение', html: function (n) { return P.esc(n.dept) + (n.mentor ? '<br><small class="ob-muted">наставник ' + P.esc(n.mentor.replace(/ (\S)\S* (\S)\S*$/, ' $1.$2.')) + '</small>' : ''); } },
            { t: 'Испытательный', html: function (n) { return st.tab === 'archive' ? P.statusBadge(n.status) : P.esc(n.bucket === 'offer' ? 'оффер ' + C.fmtDM(n.offer) + ', выход ' + C.fmtDM(n.start) : P.probText(n)); } },
            { t: 'Шаги', html: function (n) { return n.steps.length ? P.pbar(n.prog.pct, n.light.color === 'red') + '<small class="ob-muted">' + n.prog.done + ' из ' + n.prog.total + '</small>' : '<span class="ob-muted">маршрут не запущен</span>'; } },
            { t: 'Светофор', html: function (n) { return st.tab === 'archive' ? P.esc(n.reason || n.decision) : P.lightHtml(n); } }
        ], rows, { onrow: function (n) { open(host, M, n); }, rowCls: function (n) { return st.tab === 'archive' ? '' : 'ob-r-' + n.light.color; }, empty: 'Пусто' }));
        if (svcLate.length) {
            host.appendChild(P.el('h2', { text: 'Где застряли доступы и подготовка' }));
            host.appendChild(P.table([
                { t: 'Исполнитель', html: function (x) { return P.esc(x.s.exec) + '<br><small class="ob-muted">' + P.esc(x.s.role) + '</small>'; } },
                { t: 'Заявка', k: 'x', html: function (x) { return P.esc(x.s.name); } },
                { t: 'Новичок', html: function (x) { return P.esc(x.n.name) + '<br><small class="ob-muted">' + (x.n.start > M.today ? 'выход ' : 'вышел ') + C.fmtD(x.n.start) + '</small>'; } },
                { t: 'Просрочено', num: true, html: function (x) { return '<b class="ob-red">' + C.plural(M.today - x.s.due, 'день', 'дня', 'дней') + '</b>'; } }
            ], svcLate.sort(function (a, c) { return a.s.due - c.s.due; }), { onrow: function (x) { open(host, M, x.n); } }));
        }
        var h = P.hash(); if (h.nb && M.nbBy[h.nb]) { history.replaceState(null, '', location.pathname); open(host, M, M.nbBy[h.nb]); }
    }
    P.mount(render);
})();
