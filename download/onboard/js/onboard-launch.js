/* Адаптация персонала: «Запуск маршрута» из статуса «Оффер принят». План шагов со сроками от оффера и выхода, заявки ИТ/АХО/СБ до выхода, групповой заезд. */
(function () {
    'use strict';
    var P = window.Onb, C = P.core;
    var st = { pick: {}, mentor: {} };

    function ctxOf(M, n) {
        var d = M.deptBy[n.dept] || {}, ment = M.staffBy[st.mentor[n.id] || ''] || null;
        return { newbie: { name: n.name, login: n.login, offer: n.offer, start: n.start }, roles: M.roleBy, mentor: ment ? { name: ment.name, login: ment.login } : null, manager: { name: d.head, login: d.headLogin } };
    }
    function planOf(M, n) { return n.route ? C.planSteps(n.route.steps, ctxOf(M, n)) : []; }
    function mentorsFor(M, n) { return M.staff.filter(function (s) { return s.mentor && s.dept === n.dept; }); }
    function load(M) { var c = {}; M.newbies.forEach(function (n) { if (n.mentorLogin !== 'нет' && n.bucket !== 'archive') c[n.mentor] = (c[n.mentor] || 0) + 1; }); return c; }

    function launch(host, M, list) {
        var ops = [];
        list.forEach(function (n) {
            var plan = planOf(M, n), ctx = ctxOf(M, n);
            plan.forEach(function (s) {
                ops.push({ op: 'new', id: 'Шаг новичка', up: 1, fields: { 'Шаг новичка': s.name, 'Новичок': n.id, 'Шаг маршрута': s.stepId, 'Роль шага': s.role, 'Исполнитель шага': s.exec, 'Логин исполнителя': s.execLogin,
                    'Тип шага': s.type, 'Порядок шага': s.order, 'Срок шага': C.fmtD(s.due), 'Видит новичок': s.seen, 'Логин наставника': s.mentorLogin, 'Логин руководителя': s.managerLogin } });
            });
            ops.push({ op: 'set', id: n.id, fields: { 'Статус новичка': 'Подготовка к выходу', 'Наставник': ctx.mentor.name, 'Логин наставника': ctx.mentor.login, 'Логин руководителя': ctx.manager.login || 'нет' } });
            var nb = Object.assign({}, n, { mentorLogin: ctx.mentor.login, managerLogin: ctx.manager.login });
            ops.push(P.evOp(nb, P.myName(M) + ' (HR)', 'Маршрут «' + n.route.name + '» запущен из статуса «Оффер принят»: ' + plan.length + ' шагов, заявки ИТ, АХО и СБ со сроком до выхода ' + C.fmtD(n.start) + '. Наставник: ' + ctx.mentor.name + '.'));
        });
        return P.batch(ops);
    }
    function preview(M, n) {
        var plan = planOf(M, n), w = C.missing(plan), late = plan.filter(function (s) { return s.due < M.today; });
        var box = P.el('div', { 'class': 'ob-card' }, [P.el('h3', { text: n.name + ': ' + (n.route ? n.route.name : 'маршрут не задан для должности') }),
            P.el('p', { 'class': 'ob-muted', text: n.pos + ', ' + n.dept + '. Оффер ' + C.fmtD(n.offer) + ', выход ' + C.fmtD(n.start) + ' (' + C.wd(n.start) + '). Испытательный ' + (n.route ? n.route.prob : '-') + ' дн.' })]);
        if (late.length) box.appendChild(P.el('div', { 'class': 'ob-warnbox ob-e', text: 'Поздний запуск: у ' + C.plural(late.length, 'шага', 'шагов', 'шагов') + ' срок уже прошёл - исполнители получат их просроченными.' }));
        w.forEach(function (x) { box.appendChild(P.el('div', { 'class': 'ob-warnbox ob-warn', text: x })); });
        box.appendChild(P.table([
            { t: '№', num: true, k: 'order' },
            { t: 'Шаг', html: function (s) { return P.esc(s.name) + (s.hidden ? ' <span class="ob-hidden">скрыт от новичка</span>' : ''); } },
            { t: 'Роль', k: 'role' }, { t: 'Исполнитель', html: function (s) { return s.exec ? P.esc(s.exec) : '<span class="ob-red">не назначен</span>'; } },
            { t: 'Срок', html: function (s) { var d = s.due - n.start; return '<b>' + C.fmtDM(s.due) + '</b> ' + C.wd(s.due) + '<br><small class="ob-muted">' + (d < 0 ? 'за ' + C.plural(-d, 'день', 'дня', 'дней') + ' до выхода' : d === 0 ? 'день выхода' : C.plural(d, 'день', 'дня', 'дней') + ' после выхода') + '</small>'; } }
        ], plan, { rowCls: function (s) { return s.due < M.today ? 'ob-r-red' : s.type === 'Заявка' ? 'ob-r-yellow' : ''; } }));
        return box;
    }
    function newOffer(host, M) {
        var name = P.input('text', ''), pos = P.select(M.positions.map(function (p) { return [p.name, p.name + ' - ' + p.dept]; }), M.positions[0] && M.positions[0].name);
        var off = P.input('date', C.isoOf(M.today)), start = P.input('date', C.isoOf(M.today + 7)), err = P.el('div', {});
        P.modal('Оффер принят', P.el('div', {}, [P.el('p', { 'class': 'ob-sub', text: 'В работе эту запись создаёт система подбора (Хантфлоу, Поток) по статусу «Оффер принят». На демо - вручную.' }),
            P.field('ФИО', name), P.field('Должность', pos), P.field('Дата оффера', off), P.field('Дата выхода', start), err]), [{ text: 'Отмена' }, { text: 'Создать', cls: 'ob-primary', fn: function (close) {
            var nm = name.value.trim().replace(/\s+/g, ' ');
            var e = !nm ? 'Укажите ФИО' : M.newbies.some(function (n) { return n.name === nm; }) ? 'Новичок с таким ФИО уже есть' : !start.value || start.value < off.value ? 'Дата выхода раньше оффера' : '';
            if (e) { err.innerHTML = '<div class="ob-warnbox ob-e">' + P.esc(e) + '</div>'; return false; }
            var p = M.posBy[pos.value], d = M.deptBy[p.dept] || {};
            P.batch([{ op: 'new', id: 'Новичок', up: 1, fields: { 'Новичок': nm, 'Должность': p.name, 'Подразделение': p.dept, 'Статус новичка': 'Оффер принят', 'Дата оффера': C.fmtD(C.fromIso(off.value)), 'Дата выхода': C.fmtD(C.fromIso(start.value)),
                'Источник оффера': 'Вручную', 'Логин новичка': 'нет', 'Логин наставника': 'нет', 'Логин руководителя': d.headLogin || 'нет' } }])
                .then(function () { close(); P.reload(function (M2) { render(host, M2); P.toast('Оффер добавлен: ' + nm); }); }).catch(function (x) { P.toast(x.message, true); });
            return false;
        } }]);
    }
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('h1', { text: 'Запуск маршрута' }));
        host.appendChild(P.el('p', { 'class': 'ob-sub', text: 'Офферы, по которым маршрут ещё не запущен. Запуск создаёт шаги по маршруту должности: заявки ИТ, АХО и СБ со сроком до выхода, задачи руководителю и наставнику, контрольные точки 1 неделя / 1 месяц / конец испытательного. Несколько офферов с одной датой выхода запускаются заездом.' }));
        var offers = M.newbies.filter(function (n) { return n.bucket === 'offer'; }).sort(function (a, b) { return a.start - b.start; });
        var cnt = load(M), canW = P.canWrite('Шаг новичка') && P.canWrite('Новичок');
        var h = P.hash(); if (h.nb && M.nbBy[h.nb]) { st.pick = {}; st.pick[h.nb] = 1; history.replaceState(null, '', location.pathname); }
        offers.forEach(function (n) { if (!st.mentor[n.id]) { var c = mentorsFor(M, n).sort(function (a, b) { return (cnt[a.name] || 0) - (cnt[b.name] || 0); })[0]; st.mentor[n.id] = c ? c.name : ''; } });
        if (!Object.keys(st.pick).length && offers[0]) st.pick[offers[0].id] = 1;
        var bar = P.el('div', { 'class': 'ob-bar' }, [canW ? P.btn('+ Оффер принят', function () { newOffer(host, M); }) : null]);
        host.appendChild(bar);
        host.appendChild(P.table([
            { t: '', node: function (n) { var c = P.el('input', { type: 'checkbox', 'aria-label': 'Выбрать ' + n.name }); c.checked = !!st.pick[n.id]; c.onchange = function () { if (c.checked) st.pick[n.id] = 1; else delete st.pick[n.id]; render(host, M); }; return c; } },
            { t: 'Новичок', html: function (n) { return '<b>' + P.esc(n.name) + '</b><br><small class="ob-muted">' + P.esc(n.pos) + ', ' + P.esc(n.dept) + '</small>'; } },
            { t: 'Оффер', html: function (n) { return C.fmtDM(n.offer) + '<br><small class="ob-muted">' + P.esc(n.source) + '</small>'; } },
            { t: 'Выход', html: function (n) { var d = n.start - M.today; return '<b>' + C.fmtDM(n.start) + '</b> ' + C.wd(n.start) + '<br><small class="' + (d <= M.rules.notify ? 'ob-red' : 'ob-muted') + '">через ' + C.plural(d, 'день', 'дня', 'дней') + '</small>'; } },
            { t: 'Наставник', node: function (n) {
                var s = P.select([['', 'Выберите…']].concat(mentorsFor(M, n).map(function (m) { return [m.name, m.name + ' (подопечных: ' + (cnt[m.name] || 0) + ')']; })), st.mentor[n.id]);
                s.onchange = function () { st.mentor[n.id] = s.value; render(host, M); }; return P.el('div', { 'class': 'ob-acts' }, [s]);
            } }
        ], offers, { empty: 'Все офферы запущены' }));
        var sel = offers.filter(function (n) { return st.pick[n.id]; });
        if (!sel.length) return;
        var noMentor = sel.filter(function (n) { return !st.mentor[n.id]; });
        var go = P.btn(sel.length > 1 ? 'Запустить заезд: ' + sel.length + ' чел.' : 'Запустить маршрут: ' + sel[0].name, function () {
            go.disabled = true;
            launch(host, M, sel).then(function () { st.pick = {}; P.reload(function (M2) { render(host, M2); P.toast('Маршрут запущен: ' + sel.map(function (n) { return n.name; }).join(', ') + '. Заявки ушли исполнителям.'); }); })
                .catch(function (e) { go.disabled = false; P.toast(e.message, true); });
        }, 'ob-primary');
        if (!canW || noMentor.length || sel.some(function (n) { return !n.route; })) go.disabled = true;
        host.appendChild(P.el('div', { 'class': 'ob-bar' }, [go, noMentor.length ? P.el('span', { 'class': 'ob-red', text: 'Выберите наставника: ' + noMentor.map(function (n) { return n.name; }).join(', ') }) : null,
            !canW ? P.el('span', { 'class': 'ob-muted', text: 'Запуск доступен HR' }) : null]));
        sel.forEach(function (n) { host.appendChild(preview(M, n)); });
    }
    P.mount(render);
})();
