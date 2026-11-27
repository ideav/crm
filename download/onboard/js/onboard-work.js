/* Адаптация персонала: «Мои шаги». Заявки ИТ/АХО/СБ к выходу новичков, задачи руководителя, встречи наставника; отметка «сделано»; у наставника - экран подопечных. */
(function () {
    'use strict';
    var P = window.Onb, C = P.core;
    var st = { who: null };
    var GROUPS = [['overdue', 'Просрочено'], ['today', 'Сегодня'], ['week', 'На этой неделе'], ['later', 'Позже']];

    function mark(host, M, s) {
        var n = M.nbBy[s.nbId] || { id: s.nbId, name: s.nb, partial: true }, cm = P.input('text', '');
        P.modal('Сделано: ' + s.name, P.el('div', {}, [P.el('p', { text: n.name + ', срок ' + C.fmtD(s.due) }), P.field('Комментарий (необязательно)', cm, 'например, номер пропуска или логин')]), [{ text: 'Отмена' }, { text: 'Отметить', cls: 'ob-primary', fn: function (close) {
            P.markDone(M, n, s, cm.value.trim()).then(function () { close(); P.reload(function (M2) { render(host, M2); P.toast('Отмечено: ' + s.name + ' - ' + n.name); }); }).catch(function (e) { P.toast(e.message, true); });
            return false;
        } }]);
    }
    function render(host, M) {
        host.innerHTML = '';
        var me = P.ctx.user, execs = {};
        M.steps.forEach(function (s) { if (s.execLogin && s.execLogin !== 'нет') execs[s.execLogin] = s.exec; });
        if (st.who === null) st.who = execs[me] ? me : Object.keys(execs).length === 1 ? Object.keys(execs)[0] : '';
        host.appendChild(P.el('h1', { text: 'Мои шаги' }));
        host.appendChild(P.el('p', { 'class': 'ob-sub', text: 'Шаги адаптации, где исполнитель - вы: заявки к выходу новичка, встречи, контрольные точки. Срок «до выхода» значит, что в день выхода всё должно быть готово. Дата демо ' + C.fmtD(M.today) + '.' }));
        var logins = Object.keys(execs);
        if (logins.length > 1) {
            var sel = P.select([['', 'Все исполнители']].concat(logins.sort(function (a, b) { return execs[a].localeCompare(execs[b]); }).map(function (l) { return [l, execs[l]]; })), st.who);
            sel.onchange = function () { st.who = sel.value; render(host, M); };
            host.appendChild(P.el('div', { 'class': 'ob-bar' }, [P.field('Исполнитель', sel)]));
        }
        var mine = M.steps.filter(function (s) { return (!st.who || s.execLogin === st.who) && s.execLogin !== 'нет'; });
        var plan = C.todayPlan(mine, M.today);
        host.appendChild(P.el('div', { 'class': 'ob-kpis' }, [
            P.kpi('Просрочено', String(plan.overdue.length), plan.overdue.length ? 'новичок ждёт' : 'нет', plan.overdue.length ? 'bad' : 'good'),
            P.kpi('Сегодня', String(plan.today.length), ''), P.kpi('На неделе', String(plan.week.length), ''), P.kpi('Сделано', String(plan.done.length), 'всего шагов ' + mine.length, 'good')]));
        var canW = P.canWrite('Шаг новичка');
        GROUPS.forEach(function (g) {
            var list = plan[g[0]]; if (!list.length) return;
            host.appendChild(P.el('h2', { text: g[1] + ' (' + list.length + ')' }));
            host.appendChild(P.table([
                { t: 'Шаг', html: function (s) { return '<b>' + P.esc(s.name) + '</b><br><small class="ob-muted">' + P.esc(s.role) + ' · ' + P.esc(s.type) + (st.who ? '' : ' · ' + P.esc(s.exec)) + '</small>'; } },
                { t: 'Новичок', html: function (s) { var n = M.nbBy[s.nbId]; return P.esc(s.nb) + (n && !n.partial ? '<br><small class="ob-muted">' + P.esc(n.pos) + ', выход ' + C.fmtDM(n.start) + '</small>' : ''); } },
                { t: 'Срок', html: function (s) { var d = M.today - s.due; return '<b class="' + (d > 0 ? 'ob-red' : '') + '">' + C.fmtD(s.due) + '</b> ' + C.wd(s.due) + (d > 0 ? '<br><small class="ob-red">просрочено ' + C.plural(d, 'день', 'дня', 'дней') + '</small>' : ''); } },
                { t: '', node: function (s) { return canW ? P.btn('Сделано', function () { mark(host, M, s); }, 'ob-small ob-primary') : P.el('span', {}); } }
            ], list, { rowCls: function (s) { return s.due < M.today ? 'ob-r-red' : s.due === M.today ? 'ob-r-yellow' : ''; }, onrow: function (s) { var n = M.nbBy[s.nbId]; if (n && !n.partial) P.newbieCard(M, n, [], function () { P.reload(function (M2) { render(host, M2); }); }); } }));
        });
        if (!mine.length) host.appendChild(P.el('p', { 'class': 'ob-muted', text: 'Шагов на вас нет.' }));
        /* наставник: подопечные */
        var wards = M.newbies.filter(function (n) { return n.mentorLogin === me && n.bucket !== 'archive'; });
        if (wards.length) {
            host.appendChild(P.el('h2', { text: 'Мои подопечные (' + wards.length + ')' }));
            host.appendChild(P.table([
                { t: 'Новичок', html: function (n) { return '<b>' + P.esc(n.name) + '</b><br><small class="ob-muted">' + P.esc(n.pos) + ', ' + P.esc(P.probText(n)) + '</small>'; } },
                { t: 'Шаги', html: function (n) { return P.pbar(n.prog.pct, n.light.color === 'red'); } },
                { t: 'Светофор', html: function (n) { return P.lightHtml(n); } },
                { t: 'Следующее', html: function (n) { var x = n.steps.filter(function (s) { return s.done === null; }).sort(function (a, b) { return a.due - b.due; })[0]; return x ? P.esc(x.name) + '<br><small class="ob-muted">' + C.fmtDM(x.due) + ', ' + P.esc(x.exec) + '</small>' : 'всё сделано'; } },
                { t: 'Телефон', k: 'phone' }
            ], wards, { onrow: function (n) { P.newbieCard(M, n, [], function () { P.reload(function (M2) { render(host, M2); }); }); }, rowCls: function (n) { return 'ob-r-' + n.light.color; } }));
        }
    }
    P.mount(render);
})();
