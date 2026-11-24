/* PSA: Загрузка. Тепловая карта сотрудник x неделя: план из броней против ёмкости по календарю (праздники, отпуска). */
(function () {
    'use strict';
    var P = window.Psa, C = P.core;
    var st = { pool: '', grade: '', skill: '', q: '', over: false, pending: true };

    function loads(M, e, weeks) {
        return weeks.map(function (w) { return C.loadWeek(e, w, M.bookings, M.hol, M.abs[e.name] || [], { pending: st.pending }); });
    }
    function render(host, M) {
        host.innerHTML = '';
        var weeks = P.weeks();
        var all = M.emps.map(function (e) { return { e: e, l: loads(M, e, weeks) }; });
        var overN = 0, freeFte = 0, near = weeks.slice(0, 4), planNear = 0, capNear = 0;
        all.forEach(function (r) {
            var bad = r.l.some(function (l) { return l.base > 0 && (l.cap === 0 ? l.plan > 0 : l.pct > M.rules.limit); });
            r.over = bad; if (bad) overN++;
            r.l.slice(0, 4).forEach(function (l) { planNear += l.plan; capNear += l.cap; freeFte += l.free / 40 / 4; });
        });
        var queue = M.reqs.filter(function (r) { return r.status === 'Новый' || r.status === 'В подборе' || r.status === 'Предложено'; }).length;
        var pend = M.bookings.filter(function (b) { return b.status === 'Запрошена'; }).length;
        host.appendChild(P.el('h1', { text: 'Загрузка людей по проектам' }));
        host.appendChild(P.el('p', { 'class': 'psa-sub', text: 'План из броней против ёмкости в часах: праздники, сокращённые дни, отпуска и доля ставки уже учтены. Нажмите на ячейку, чтобы увидеть разложение по проектам и изменить загрузку: перегрузка видна при вводе, а не в отчёте.' }));
        host.appendChild(P.el('div', { 'class': 'psa-kpis' }, [
            P.kpi('Загрузка на 4 недели вперёд', Math.round(capNear ? planNear / capNear * 100 : 0) + '%', 'цель ' + M.rules.utilTarget + '% оплачиваемых', capNear && planNear / capNear * 100 > M.rules.limit ? 'bad' : ''),
            P.kpi('Сотрудников с перегрузкой', String(overN), 'в горизонте ' + weeks.length + ' нед.', overN ? 'bad' : 'good'),
            P.kpi('Свободно, FTE (4 нед.)', String(C.round1(freeFte)), 'можно закрыть запросы без найма', 'good'),
            P.kpi('Очередь запросов', String(queue), pend + ' броней ждут согласования', queue ? 'warn' : '')
        ]));
        var pools = [['', 'Все пулы']].concat(M.pools.map(function (p) { return [p.name, p.name]; }));
        var grades = [['', 'Все грейды']].concat(M.gradeList.map(function (g) { return [g, g]; }));
        var skills = [['', 'Любой навык']].concat(M.skillList.map(function (g) { return [g, g]; }));
        var sPool = P.select(pools, st.pool), sGrade = P.select(grades, st.grade), sSkill = P.select(skills, st.skill);
        var q = P.input('text', st.q, { placeholder: 'Поиск по фамилии' });
        var over = P.el('input', { type: 'checkbox', id: 'psa-over' }); over.checked = st.over;
        var pnd = P.el('input', { type: 'checkbox', id: 'psa-pend' }); pnd.checked = st.pending;
        function redraw() { st.pool = sPool.value; st.grade = sGrade.value; st.skill = sSkill.value; st.q = q.value; st.over = over.checked; st.pending = pnd.checked; render(host, M); }
        [sPool, sGrade, sSkill, over, pnd].forEach(function (c) { c.addEventListener('change', redraw); });
        q.addEventListener('change', redraw);
        host.appendChild(P.el('div', { 'class': 'psa-bar' }, [P.field('Пул', sPool), P.field('Грейд', sGrade), P.field('Навык', sSkill), P.field('Поиск', q),
            P.el('label', { 'class': 'psa-field', style: 'flex-direction:row;align-items:center;gap:6px;color:inherit' }, [over, P.el('span', { text: 'Только перегруженные' })]),
            P.el('label', { 'class': 'psa-field', style: 'flex-direction:row;align-items:center;gap:6px;color:inherit' }, [pnd, P.el('span', { text: 'Считать брони на согласовании' })]),
            P.el('span', { 'class': 'psa-grow' }),
            P.canWrite('Бронь') ? P.btn('Новая бронь', function () { P.bookingForm(M, { onSaved: function () { reload(host); } }); }, 'psa-primary') : null,
            P.btn('Выгрузить CSV', function () { exportCsv(M, all, weeks); })]));
        host.appendChild(P.legend());
        var rows = all.filter(function (r) {
            if (st.pool && r.e.pool !== st.pool) return false;
            if (st.grade && r.e.grade !== st.grade) return false;
            if (st.q && r.e.name.toLowerCase().indexOf(st.q.toLowerCase()) < 0) return false;
            if (st.skill && !(M.skills[r.e.name] || []).some(function (s) { return s.skill === st.skill; })) return false;
            if (st.over && !r.over) return false;
            return true;
        });
        var table = P.el('table', { 'class': 'psa-heat' });
        var hr = P.el('tr', {}, [P.el('th', { 'class': 'psa-name', text: 'Сотрудник' })]);
        weeks.forEach(function (w, i) { hr.appendChild(P.el('th', { 'class': i === 0 ? 'psa-today' : '', html: C.toShort(w) + '<small>' + (i === 0 ? 'эта неделя' : 'нед. ' + (i + 1)) + '</small>' })); });
        table.appendChild(P.el('thead', {}, [hr]));
        var tb = P.el('tbody', {});
        M.pools.forEach(function (pool) {
            var pr = rows.filter(function (r) { return r.e.pool === pool.name; });
            if (!pr.length) return;
            var g = P.el('tr', { 'class': 'psa-grp' }, [P.el('td', { html: P.esc(pool.name) + ' <span class="psa-av">' + pr.length + ' чел.</span>' })]);
            weeks.forEach(function (w, i) {
                var plan = 0, cap = 0; pr.forEach(function (r) { plan += r.l[i].plan; cap += r.l[i].cap; });
                g.appendChild(P.el('td', { 'class': 'psa-gv', text: cap ? (P.unit() === 'hours' ? C.round1(plan) + ' ч' : Math.round(plan / cap * 100) + '%') : '–' }));
            });
            tb.appendChild(g);
            pr.forEach(function (r) {
                var tr = P.el('tr', {}, [P.el('td', { 'class': 'psa-name', title: r.e.position + ', ' + r.e.grade, html: P.esc(r.e.name) + '<span class="psa-av">' + P.esc(r.e.grade) + (r.e.fte < 1 ? ', ' + r.e.fte : '') + '</span>' })]);
                r.l.forEach(function (l, i) {
                    var cls = C.loadClass(l, M.rules), pendCell = l.items.some(function (x) { return x.status === 'Запрошена'; });
                    var b = P.el('button', { type: 'button', 'class': 'psa-hc psa-h-' + cls + (pendCell && st.pending ? ' psa-h-pend' : ''), title: P.cellTitle(r.e, l), 'data-emp': r.e.name, 'data-week': l.week, text: P.cellText(l), onclick: function () { cellModal(host, M, r.e, l); } });
                    tr.appendChild(P.el('td', {}, [b]));
                });
                tb.appendChild(tr);
            });
        });
        table.appendChild(tb);
        host.appendChild(P.el('div', { 'class': 'psa-heatwrap' }, [table]));
        if (!rows.length) host.appendChild(P.el('p', { 'class': 'psa-empty', text: 'Никого не нашли: смягчите фильтры' }));
    }
    function reload(host) { P.resetModel(); P.model().then(function (M) { render(host, M); }).catch(P.fail); }

    function cellModal(host, M, e, l) {
        var body = P.el('div', {});
        var items = l.items.map(function (i) { return M.bookings.filter(function (b) { return b.id === i.id; })[0]; }).filter(Boolean);
        var inputs = {}, unit = M.rules.unit;
        function hrs(id) { return C.fromInput(e, inputs[id].value, unit); }
        var info = P.el('div', {}), strip = P.el('div', {}), res = P.el('div', {});
        var absn = (M.abs[e.name] || []).filter(function (a) { return a.to >= l.week && a.from <= C.addDays(l.week, 6); });
        info.innerHTML = '<div class="psa-kv"><span>Ёмкость недели</span><b>' + C.round1(l.cap) + ' ч</b></div><div class="psa-kv"><span>План (брони)</span><b>' + C.round1(l.plan) + ' ч</b></div>' +
            (absn.length ? '<div class="psa-kv"><span>Отсутствие</span><b>' + absn.map(function (a) { return P.esc(a.kind) + ' ' + C.toShort(a.from) + '-' + C.toShort(a.to); }).join(', ') + '</b></div>' : '') +
            (l.base === 0 ? '<div class="psa-kv"><span>Неделя</span><b>нерабочая по календарю</b></div>' : '');
        body.appendChild(info);
        var canEdit = P.canWrite('Бронь');
        var tb = P.el('div', { 'class': 'psa-tablewrap', style: 'margin:10px 0' });
        var tbl = P.el('table', { 'class': 'psa-table' }, [P.el('thead', {}, [P.el('tr', {}, ['Проект', 'Вид', 'Статус', 'Срок', unit === 'pct' ? '% ставки' : 'Часов в нед.'].map(function (t) { return P.el('th', { text: t }); }))])]);
        var tbd = P.el('tbody', {});
        items.forEach(function (b) {
            var inp = P.input('number', C.toInput(e, b.hpw, unit), { min: 0, max: unit === 'pct' ? 200 : 60, step: 1, style: 'width:72px' }); inputs[b.id] = inp;
            inp.disabled = !canEdit || b.status !== 'Подтверждена' && b.status !== 'Запрошена';
            inp.addEventListener('input', recalc);
            tbd.appendChild(P.el('tr', {}, [P.el('td', { text: P.projLabel(b.project) }), P.el('td', { html: P.badge(b.kind, b.kind === 'Жёсткая' ? 'info' : 'mute') }), P.el('td', { html: P.badge(b.status, b.status === 'Запрошена' ? 'warn' : 'ok') }), P.el('td', { text: C.toShort(b.from) + ' - ' + C.toShort(b.to) }), P.el('td', {}, [inp])]));
        });
        if (!items.length) tbd.appendChild(P.el('tr', {}, [P.el('td', { colspan: 5, 'class': 'psa-empty', text: 'На этой неделе броней нет' })]));
        tbl.appendChild(tbd); tb.appendChild(tbl); body.appendChild(tb);
        body.appendChild(strip); body.appendChild(res);
        function modified() {
            return M.bookings.map(function (b) { if (!inputs[b.id]) return b; var c = Object.assign({}, b); c.hpw = hrs(b.id); return c; });
        }
        var worst = null;
        function recalc() {
            var list = modified(); strip.innerHTML = ''; res.innerHTML = '';
            var ws = C.weeksFrom(l.week, 8);
            strip.appendChild(P.el('div', { 'class': 'psa-muted', text: 'Загрузка ' + e.name + ' на 8 недель при новых значениях' }));
            strip.appendChild(P.loadStrip(M, e, list, ws));
            var ov = C.overloadWeeks(e, ws, list, M.hol, M.abs[e.name] || [], M.rules);
            var tooBig = ov.some(function (x) { return x.pct > M.rules.overbook; });
            res.appendChild(P.el('div', { 'class': 'psa-warnbox ' + (tooBig ? 'psa-e' : ov.length ? 'psa-w' : 'psa-g'), text: ov.length ? 'Выше ' + M.rules.limit + '% на ' + ov.length + ' нед. из 8, максимум ' + Math.round(Math.max.apply(null, ov.map(function (x) { return x.pct; }))) + '%' : 'Перегрузки нет' }));
            worst = tooBig; if (saveBtn) saveBtn.disabled = false;
        }
        var saveBtn = canEdit && items.length ? P.btn('Сохранить загрузку', function () {
            var ch = items.filter(function (b) { return Number(inputs[b.id].value) !== C.toInput(e, b.hpw, unit); });
            if (!ch.length) return;
            var chk = C.checkBooking(e, Object.assign({}, ch[0], { hpw: hrs(ch[0].id) }), modified().filter(function (b) { return b.id !== ch[0].id; }), M.hol, M.abs[e.name] || [], M.rules);
            if (!chk.ok) { P.toast(chk.errors[0], true); return false; }
            Promise.all(ch.map(function (b) { return P.update(b.rid, { 'Часов в неделю': hrs(b.id) }); })).then(function () { ch.forEach(function (b) { b.hpw = hrs(b.id); }); P.toast('Загрузка обновлена'); m.close(); render(host, M); }).catch(function (er) { P.toast(er.message, true); });
            return false;
        }, 'psa-primary') : null;
        var m = P.modal(e.name + ': неделя с ' + C.toShort(l.week), body, [{ text: 'Закрыть' }], true);
        if (saveBtn) m.box.querySelector('.psa-modal-foot').appendChild(saveBtn);
        m.box.querySelector('.psa-modal-foot').appendChild(P.btn('Подобрать замену', function () { location.href = P.nav('finder', 'from=' + l.week + '&pool=' + encodeURIComponent(e.pool) + '&grade=' + e.grade); }));
        recalc();
    }
    function exportCsv(M, all, weeks) {
        var cols = [['name', 'Сотрудник'], ['pool', 'Пул'], ['grade', 'Грейд']].concat(weeks.map(function (w) { return [w, 'Загрузка % ' + C.toShort(w)]; }));
        var rows = all.map(function (r) { var o = { name: r.e.name, pool: r.e.pool, grade: r.e.grade }; r.l.forEach(function (l, i) { o[weeks[i]] = l.pct === null ? '' : Math.round(l.pct); }); return o; });
        P.download('psa-load.csv', C.toCsv(rows, cols));
    }
    P.mount(render);
})();
