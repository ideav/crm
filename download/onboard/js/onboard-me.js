/* Адаптация персонала: «Мой план» - кабинет новичка в телефоне. Шаги на сегодня и на неделю, кто контакт по какому вопросу. Скрытые шаги (СБ, пропуск) новичку не показываются. */
(function () {
    'use strict';
    var P = window.Onb, C = P.core;
    var st = { nb: '' };

    function contact(M, label, name, why) {
        var s = M.staffBy[name]; if (!name) return null;
        return P.el('li', {}, [P.el('b', { text: label + ': ' }), name, s && s.phone ? P.el('div', {}, [P.el('a', { href: 'tel:' + s.phone.replace(/[^+\d]/g, ''), text: s.phone })]) : null, why ? P.el('small', { 'class': 'ob-muted', text: why }) : null]);
    }
    function section(M, n, title, list, kind) {
        if (!list.length) return null;
        return P.el('div', { 'class': 'ob-card' }, [P.el('h3', { html: P.esc(title) + ' <small class="ob-muted">' + list.length + '</small>' }),
            P.el('ul', { 'class': 'ob-chk' }, list.map(function (s) {
                var r = M.rstepBy[s.stepId], li = P.stepLi(M, n, s, null);
                if (r && r.hint) li.children[1].appendChild(P.el('div', { 'class': 'ob-muted', text: r.hint }));
                if (kind === 'wait' && s.role !== 'Новичок') li.children[1].appendChild(P.el('div', { 'class': 'ob-red', text: 'ждём от: ' + s.exec + ' - HR уже видит' }));
                return li;
            }))]);
    }
    function render(host, M) {
        host.innerHTML = '';
        var mine = M.newbies.filter(function (n) { return n.login === P.ctx.user; });
        var pool = mine.length ? mine : M.newbies.filter(function (n) { return n.steps.length && n.bucket !== 'archive'; });
        if (!pool.length) { host.appendChild(P.el('p', { text: 'Плана адаптации пока нет - его запустит HR после оффера.' })); return; }
        if (!st.nb || !M.nbBy[st.nb]) st.nb = pool[0].id;
        var wrap = P.el('div', { 'class': 'ob-phone' });
        host.appendChild(wrap);
        function add(x) { if (x) wrap.appendChild(x); }
        if (!mine.length) {
            var sel = P.select(pool.map(function (n) { return [n.id, n.name]; }), st.nb);
            sel.onchange = function () { st.nb = sel.value; render(host, M); };
            wrap.appendChild(P.el('div', { 'class': 'ob-note' }, [P.field('Как видит новичок (просмотр для HR)', sel)]));
        }
        var n = M.nbBy[st.nb], vis = n.steps.filter(function (s) { return !s.hidden; }), plan = C.todayPlan(vis, M.today), d = M.deptBy[n.dept] || {};
        wrap.appendChild(P.el('h1', { text: 'Привет, ' + n.name.split(' ')[1] + '!' }));
        wrap.appendChild(P.el('p', { 'class': 'ob-sub ob-big', text: n.pos + ', ' + n.dept + '. ' + (n.prob.before ? 'Выход ' + C.fmtD(n.start) + ' (' + C.wd(n.start) + ').' : 'Сегодня ' + P.probText(n) + ' испытательного срока.') }));
        wrap.appendChild(P.el('div', { 'class': 'ob-card', html: '<b>Пройдено ' + C.progress(vis).done + ' из ' + vis.length + ' шагов</b>' + P.pbar(C.progress(vis).pct, false) }));
        add(section(M, n, 'Сегодня, ' + C.fmtDM(M.today), plan.today, ''));
        add(section(M, n, 'Ждём (срок прошёл)', plan.overdue, 'wait'));
        add(section(M, n, 'На этой неделе', plan.week, ''));
        if (!plan.today.length && !plan.overdue.length && !plan.week.length) wrap.appendChild(P.el('p', { 'class': 'ob-muted', text: 'На этой неделе шагов нет.' }));
        wrap.appendChild(P.el('div', { 'class': 'ob-card' }, [P.el('h3', { text: 'Кому писать' }), P.el('ul', { 'class': 'ob-contacts' }, [
            contact(M, 'Наставник', n.mentor, 'как работать, где что лежит'), contact(M, 'Руководитель', d.head, 'задачи и график'),
            contact(M, 'HR', M.roleBy['HR'] && M.roleBy['HR'].exec, 'документы, пропуск, любые вопросы'), contact(M, 'Доступы и техника', M.roleBy['ИТ'] && M.roleBy['ИТ'].exec, 'логины, ТСД, ноутбук')])]));
        if (plan.later.length) wrap.appendChild(P.el('p', { 'class': 'ob-muted', text: 'Дальше по плану: ' + plan.later.map(function (s) { return s.name + ' (' + C.fmtDM(s.due) + ')'; }).slice(0, 4).join('; ') }));
    }
    P.mount(render);
})();
