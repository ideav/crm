/* PSA: Подбор специалиста. Кто владеет навыком на нужном уровне и свободен на период с учётом отпусков и праздников. */
(function () {
    'use strict';
    var P = window.Psa, C = P.core;
    var q = null;

    function init(M) {
        var h = P.hash(), req = h.req ? M.reqs.filter(function (r) { return r.code === h.req; })[0] : null;
        var from = h.from || C.weekStart(C.addDays(P.TODAY, 14));
        q = { skill: M.skillList.indexOf('Java') >= 0 ? 'Java' : M.skillList[0], minLevel: 3, minGrade: 'middle', pool: '', from: from, to: C.addDays(from, 12 * 7 + 4), hpw: 20, req: req, project: '' };
        if (h.pool) q.pool = h.pool; if (h.grade) q.minGrade = h.grade;
        if (req) { q.skill = req.skill; q.minLevel = req.minLevel; q.minGrade = req.minGrade; q.from = req.from; q.to = req.to; q.hpw = req.hpw; q.project = req.project; }
    }
    function render(host, M) {
        if (!q) init(M);
        host.innerHTML = '';
        host.appendChild(P.el('h1', { text: 'Подбор свободного специалиста' }));
        host.appendChild(P.el('p', { 'class': 'psa-sub', text: 'Выберите навык, грейд и период: система покажет, кто подходит и сколько часов в неделю у него реально свободно с учётом броней, отпусков и праздников.' }));
        if (q.req) host.appendChild(P.el('div', { 'class': 'psa-warnbox psa-g', html: 'Запрос <b>' + P.esc(q.req.code) + '</b>: ' + P.esc(q.req.role) + ', проект «' + P.esc(q.req.project) + '», приоритет ' + P.esc(q.req.priority) }));
        var skill = P.select(M.skillList.map(function (s) { return [s, s]; }), q.skill);
        var lvl = P.select([['1', 'от 1'], ['2', 'от 2'], ['3', 'от 3'], ['4', 'от 4'], ['5', '5']], String(q.minLevel));
        var grade = P.select([['', 'Любой']].concat(M.gradeList.map(function (g) { return [g, 'от ' + g]; })), q.minGrade);
        var pool = P.select([['', 'Все пулы']].concat(M.pools.map(function (p) { return [p.name, p.name]; })), q.pool);
        var from = P.input('date', q.from), to = P.input('date', q.to), hpw = P.input('number', q.hpw, { min: 1, max: 60, step: 1, style: 'width:90px' });
        function go() { q.skill = skill.value; q.minLevel = +lvl.value; q.minGrade = grade.value; q.pool = pool.value; q.from = from.value; q.to = to.value; q.hpw = C.num(hpw.value); renderResults(host, M, out); }
        [skill, lvl, grade, pool, from, to, hpw].forEach(function (c) { c.addEventListener('change', go); });
        host.appendChild(P.el('div', { 'class': 'psa-bar' }, [P.field('Навык', skill), P.field('Уровень навыка', lvl), P.field('Грейд', grade), P.field('Пул', pool), P.field('С', from), P.field('По', to), P.field('Часов в неделю', hpw), P.btn('Показать', go, 'psa-primary')]));
        var out = P.el('div', {}); host.appendChild(out);
        renderResults(host, M, out);
    }
    function renderResults(host, M, out) {
        out.innerHTML = '';
        if (!q.from || !q.to || q.to < q.from) { out.appendChild(P.el('p', { 'class': 'psa-empty', text: 'Укажите период' })); return; }
        var res = C.findCandidates(M.emps, M.skills, M.bookings, M.hol, M.abs, { skill: q.skill, minLevel: q.minLevel, minGrade: q.minGrade, pool: q.pool, from: q.from, to: q.to, hpw: q.hpw });
        var fit = res.filter(function (r) { return r.fits; }).length, part = res.filter(function (r) { return !r.fits && r.avgFits; }).length;
        out.appendChild(P.el('div', { 'class': 'psa-kpis' }, [P.kpi('Подходят полностью', String(fit), 'свободно ' + q.hpw + ' ч/нед весь период', fit ? 'good' : 'bad'), P.kpi('Подходят частично', String(part), 'в среднем свободно, но есть занятые недели', part ? 'warn' : ''), P.kpi('Нашлось по навыку и грейду', String(res.length), q.skill + ' от ' + q.minLevel)]));
        if (!res.length) { out.appendChild(P.el('p', { 'class': 'psa-empty', text: 'Никого не нашли: понизьте грейд или уровень навыка. Дефицит по этому навыку стоит отправить на найм или в запрос подрядчику.' })); return; }
        var ws = C.weeksBetween(q.from, q.to).slice(0, 12);
        var tbl = P.el('table', { 'class': 'psa-table' }, [P.el('thead', {}, [P.el('tr', {}, ['Сотрудник', 'Навык', 'Свободно, ч/нед', 'Загрузка по неделям (после брони)', 'Вывод', ''].map(function (t) { return P.el('th', { text: t }); }))])]);
        var tb = P.el('tbody', {});
        res.slice(0, 25).forEach(function (r) {
            var e = r.emp, newB = { id: 'cand', emp: e.name, project: '', kind: 'Мягкая', status: 'Запрошена', from: q.from, to: q.to, hpw: q.hpw };
            var tr = P.el('tr', {}, [
                P.el('td', { html: '<b>' + P.esc(e.name) + '</b><div class="psa-muted">' + P.esc(e.pool) + ', ' + P.esc(e.grade) + (e.fte < 1 ? ', ставка ' + e.fte : '') + '</div>' }),
                P.el('td', { html: P.esc(q.skill) + ' <span class="psa-lvl">' + new Array(r.level + 1).join('★') + '</span>' + new Array(6 - r.level).join('☆') + '<div class="psa-muted">' + ((M.skills[e.name] || []).filter(function (s) { return s.skill !== q.skill; }).map(function (s) { return P.esc(s.skill) + ' ' + s.level; }).join(', ') || '&nbsp;') + '</div>' }),
                P.el('td', { 'class': 'psa-num', html: '<b>' + r.avgFree + '</b><div class="psa-muted">мин. ' + r.minFree + '</div>' }),
                P.el('td', {}, [P.loadStrip(M, e, M.bookings.concat([newB]), ws)]),
                P.el('td', { html: (r.fits ? P.badge('подходит', 'ok') : r.avgFree >= q.hpw / 2 ? P.badge('частично', 'warn') : P.badge('занят', 'crit')) + (r.absentDays ? '<div class="psa-muted">отпуск ' + r.absentDays + ' дн.</div>' : '') }),
                P.el('td', {}, [P.canWrite('Бронь') ? P.btn('Забронировать', function () { book(host, M, e); }, r.fits ? 'psa-primary psa-small' : 'psa-small') : null])
            ]);
            tb.appendChild(tr);
        });
        tbl.appendChild(tb);
        out.appendChild(P.el('div', { 'class': 'psa-tablewrap' }, [tbl]));
        if (res.length > 25) out.appendChild(P.el('p', { 'class': 'psa-muted', text: 'Показаны 25 лучших из ' + res.length }));
    }
    function book(host, M, e) {
        P.bookingForm(M, { emp: e.name, project: q.project || undefined, from: q.from, to: q.to, hpw: q.hpw, role: q.skill + ' ' + e.grade, title: 'Бронь: ' + e.name,
            onSaved: function () {
                if (q.req && P.canWrite('Запрос ресурса')) P.update(q.req.id, { 'Статус запроса': 'Предложено', 'Предложенный сотрудник': e.name }).then(function () { P.resetModel(); location.href = P.nav('booking'); });
                else location.href = P.nav('booking');
            } });
    }
    P.mount(render);
})();
