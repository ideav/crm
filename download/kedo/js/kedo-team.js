/* КЭДО: руководитель подразделения — кто из моих не подписал. */
(function () {
    'use strict';
    var P = window.Kedo, C = P.core;
    P.mount(function (host, M) {
        var my = P.rk === 'manager' ? M.myDept : null, depts = M.depts.map(function (d) { return d.name; }), st = { dept: my ? my.name : (P.hash().dept || depts[0]) };
        function draw() {
            host.innerHTML = '';
            P.head('Мои сотрудники: кто не подписал', (my ? my.name + ', ' + my.org + '. ' : '') + 'Документы ваших сотрудников, которые ждут подписи или вернулись с отказом. Просрочка дольше ' + M.rules.escalateDays + ' раб. дн. приходит вам эскалацией.').forEach(function (n) { host.appendChild(n); });
            if (!my) {
                var sel = P.select(depts, st.dept); sel.addEventListener('change', function () { st.dept = sel.value; draw(); });
                host.appendChild(P.el('div', { 'class': 'kedo-bar' }, [P.field('Подразделение (просмотр от имени руководителя)', sel)]));
            }
            var docs = M.docs.filter(function (d) { return d.dept === st.dept; }), emps = M.emps.filter(function (e) { return e.dept === st.dept; });
            var open = docs.filter(function (d) { return d.st.waiting || d.st.refused; }), L = C.lights(docs, P.TODAY, M.hol, M.rules);
            host.appendChild(P.el('div', { 'class': 'kedo-kpis' }, [P.kpi('сотрудников', String(emps.length)), P.kpi('ждут подписи', String(L.waiting), '', L.waiting ? 'warn' : 'good'),
                P.kpi('просрочено', String(L.overdue), L.escalate ? L.escalate + ' уже эскалированы вам' : '', L.overdue ? 'bad' : 'good'), P.kpi('отказы', String(L.refused), '', L.refused ? 'bad' : 'good'),
                P.kpi('подписано и в учёте', L.donePct + '%', L.done + ' из ' + L.total, 'good')]));
            var by = {}; open.forEach(function (d) { (by[d.emp] = by[d.emp] || []).push(d); });
            var rows = Object.keys(by).map(function (n) { var e = M.empBy[n] || {}; return { name: n, position: e.position || '', phone: e.phone || '', sign: e.sign || '', docs: by[n], worst: Math.max.apply(null, by[n].map(function (d) { return d.st.refused ? 99 : d.st.wd; })) }; })
                .sort(function (a, b) { return b.worst - a.worst; });
            host.appendChild(P.table([{ k: 'name', t: 'Сотрудник' }, { k: 'position', t: 'Должность' }, { k: 'sign', t: 'Подпись' },
                { t: 'Что не подписано', html: function (r) { return r.docs.map(function (d) { return P.statusBadge(d) + ' ' + P.esc(d.type) + (d.st.waiting ? ' <small class="kedo-muted">' + d.st.wd + ' р.д.</small>' : '') + (d.reason ? ' <small class="kedo-muted">«' + P.esc(d.reason) + '»</small>' : ''); }).join('<br>'); } }],
                rows, { onrow: function (r) { P.docCard(M, r.docs[0], reload); }, rowCls: function (r) { return r.worst > M.rules.overdueDays ? 'kedo-row-warn' : ''; }, empty: 'Все сотрудники подразделения всё подписали' }));
            host.appendChild(P.el('p', { 'class': 'kedo-muted', text: 'Клик по строке — документ, история напоминаний и кнопка «Напомнить». Сотрудник подписывает в приложении оператора или на Госуслугах.' }));
        }
        function reload() { P.model().then(function (m) { M = m; draw(); }); }
        draw();
    });
})();
