/* KPI: «Мой расчёт» - сотрудник видит свой расчёт по шагам и спидометр текущего месяца: факт, план, прогноз при текущем темпе, сколько до ступени. */
(function () {
    'use strict';
    var K = window.Kpi, C = K.core;
    var st = { emp: '' };
    function gauge(l, sc, p, vals) {
        var v = vals[l.ind.name] || {}, plan = C.num(v.plan), fact = C.num(v.fact);
        var box = K.el('div', { 'class': 'kpi-gauge' });
        if (l.ind.kind === C.BLOCK) {
            box.appendChild(K.el('div', { 'class': 'kpi-gauge-h', html: '<span>' + K.esc(l.ind.name) + '</span><span class="' + (fact > plan ? 'kpi-cell-bad' : 'kpi-cell-good') + '">' + C.fnum(fact, 0) + ' из допустимых ' + C.fnum(plan, 0) + '</span>' }));
            box.appendChild(K.el('div', { 'class': 'kpi-gauge-s', style: 'margin-top:0', text: fact > plan ? 'Превышено: премия за месяц не начисляется' : 'Блокирующий показатель: при превышении премия за месяц не начисляется' }));
            return box;
        }
        var less = l.ind.dir === C.LESS, pct = /%/.test(l.ind.unit) || less;
        var f = pct ? { fact: fact, ach: C.achievement(l.ind, plan, fact, sc.cap / 100) } : C.forecast(plan, fact, p.passed, p.days);
        var achNow = C.achievement(l.ind, plan, fact, sc.cap / 100);
        var max = 1.4, W = function (x) { return Math.max(0, Math.min(100, (x || 0) / max * 100)) + '%'; };
        var marks = [sc.threshold].concat(l.scale === 'Ступенчатая' ? sc.steps.map(function (s) { return s.from; }) : [100]);
        var track = K.el('div', { 'class': 'kpi-gauge-track' }, [K.el('div', { 'class': 'kpi-gauge-fc', style: 'width:' + W(f.ach) }), K.el('div', { 'class': 'kpi-gauge-fact', style: 'width:' + W(pct ? f.ach : achNow) })]
            .concat(marks.map(function (m) { return K.el('div', { 'class': 'kpi-gauge-mark', style: 'left:' + W(m / 100) }, [K.el('span', { text: m + ' %' })]); })));
        var nx = C.nextStep(f.ach, sc, l.scale), k = C.coefficient(f.ach, sc, l.scale);
        var need = '';
        if (nx && !pct && plan > 0) { var left = plan * nx.at / 100 - fact, days = p.days - p.passed; need = ' Чтобы выйти на ' + nx.at + ' %: ещё ' + C.fnum(left) + ' ' + l.ind.unit + (days > 0 ? ' за ' + days + ' раб. дн. (' + C.fnum(left / days) + ' в день)' : '') + '.'; }
        else if (nx) need = ' Следующая отметка - ' + nx.at + ' %.';
        box.appendChild(K.el('div', { 'class': 'kpi-gauge-h', html: '<span>' + K.esc(l.ind.name) + ' <span class="kpi-muted">вес ' + l.weight + ' %</span></span><span>' + C.fnum(fact) + ' из ' + C.fnum(plan) + ' ' + K.esc(l.ind.unit) + (pct ? '' : ' · прогноз ' + C.fnum(f.fact) + ' (' + C.pct(f.ach || 0) + ')') + '</span>' }));
        box.appendChild(track);
        box.appendChild(K.el('div', { 'class': 'kpi-gauge-s', text: (k.flag === 'below' ? 'Сейчас ниже порога ' + sc.threshold + ' % - доля не начисляется.' : 'При текущем темпе коэффициент ' + C.fnum(k.coef) + (k.flag === 'capped' ? ' (потолок)' : '') + '.') + need }));
        return box;
    }
    K.mount(function (host, M) {
        var mine = M.emps.filter(function (e) { return e.login === K.ctx.user; })[0];
        if (!mine && !st.emp && M.emps.length) st.emp = M.emps[0].name;
        var e = mine || M.empBy[st.emp];
        host.appendChild(K.el('div', {}, K.head('Мой расчёт', 'Из чего сложилась премия - по шагам и по правилам компании, без чужих сумм. Спидометр показывает текущий месяц: факт, прогноз при нынешнем темпе и сколько осталось до следующей ступени.')));
        if (!e) { host.appendChild(K.el('p', { 'class': 'kpi-muted', text: 'Нет данных по сотруднику' })); return; }
        if (!mine) {
            var s = K.select(M.emps.map(function (x) { return x.name; }), e.name);
            s.addEventListener('change', function () { st.emp = s.value; host.innerHTML = ''; K.render(host, M); });
            host.appendChild(K.el('div', { 'class': 'kpi-bar' }, [K.field('Сотрудник (просмотр глазами сотрудника)', s)]));
        }
        var sc = M.schemes[e.scheme];
        var nov = M.periods.filter(function (p) { return p.status === 'Идёт период'; })[0];
        if (nov && M.byPeriod[nov.name].vals[e.name]) {
            var vals = M.byPeriod[nov.name].vals[e.name];
            var share = nov.passed / nov.days, fvals = {};
            Object.keys(vals).forEach(function (k) { var i = M.inds[k], pct = i && (/%/.test(i.unit) || i.dir === C.LESS); fvals[k] = { plan: vals[k].plan, fact: pct ? vals[k].fact : C.num(vals[k].fact) / share }; });
            var proj = C.calcEmployee(e, sc, fvals, M.byPeriod[K.CUR].scores[e.name], null, null);
            host.appendChild(K.el('h2', { text: nov.name + ': спидометр (факт на ' + C.toDmy(nov.factAt) + ', ' + nov.passed + ' из ' + nov.days + ' раб. дн.)' }));
            host.appendChild(K.el('div', { 'class': 'kpi-tiles' }, [K.tile('Прогноз премии при текущем темпе', C.rub(proj.total), 'целевая ' + C.rub(proj.target) + ' (' + C.pct(proj.target ? proj.total / proj.target : 0) + ')', proj.blocked ? 'bad' : (proj.total >= proj.target ? 'good' : ''))]));
            host.appendChild(K.el('div', { 'class': 'kpi-cards', style: 'grid-template-columns:repeat(auto-fill,minmax(320px,1fr))' }, sc.lines.map(function (l) { return gauge(l, sc, nov, vals); })));
        }
        var b = M.byPeriod[K.CUR];
        if (b && b.vals[e.name]) {
            var r = C.calcEmployee(e, sc, b.vals[e.name], b.scores[e.name], b.ts[e.name], b.prem[e.name] ? { sum: b.prem[e.name].corr, reason: b.prem[e.name].reason } : null);
            var pr = b.prem[e.name] || {};
            host.appendChild(K.el('h2', { html: K.esc(K.CUR) + ': ' + C.rub(r.total) + ' ' + K.badge(pr.status || 'расчёт', pr.status === 'Согласовано' ? 'ok' : 'warn') }));
            host.appendChild(K.el('div', { 'class': 'kpi-formula' }, [K.el('p', { text: 'Оклад ' + C.rub(e.salary) + ' x целевая премия ' + e.targetPct + ' % = ' + C.rub(r.target) + '.' })]));
            host.appendChild(K.el('ol', { 'class': 'kpi-explain' }, r.lines.map(function (l) { return K.el('li', { 'class': l.flag === 'below' || l.flag === 'block' ? 'kpi-cell-bad' : '', text: C.explainLine(l, sc) }); }).concat([
                K.el('li', { text: 'Сумма коэффициентов: ' + C.pct(r.sumCoef) + ' целевой премии.' }),
                K.el('li', { text: r.avg === null ? 'Оценка руководителя ещё не поставлена - множитель 1.' : 'Оценка руководителя ' + C.fnum(r.avg) + ' из 5 - множитель ' + C.fnum(r.mult, 3) + '.' }),
                b.ts[e.name] ? K.el('li', { text: 'Отработано ' + b.ts[e.name].worked + ' из ' + b.ts[e.name].norm + ' дн. - ' + (sc.partMode === 'Пропорционально' ? 'x ' + C.fnum(r.partF, 3) : 'премия полная') + '.' }) : null,
                r.blocked ? K.el('li', { 'class': 'kpi-cell-bad', text: 'Премия не начисляется: ' + r.blockReason + '.' }) : null,
                r.corr ? K.el('li', { text: 'Корректировка руководителя ' + (r.corr > 0 ? '+' : '') + C.rub(r.corr) + ': ' + r.corrReason + '.' }) : null,
                K.el('li', { html: '<b>Итог: ' + C.rub(r.total) + '</b>' })])));
            var comps = b.scoreRows[e.name] || {};
            if (Object.keys(comps).length) host.appendChild(K.table([{ t: 'Компетенция', k: 'Компетенция' }, { t: 'Балл', num: true, k: 'Балл' }, { t: 'Комментарий руководителя', k: 'Комментарий оценки' }], Object.keys(comps).map(function (k) { return comps[k]; })));
        }
        var hist = M.periods.filter(function (p) { return M.byPeriod[p.name].prem[e.name] && p.name !== K.CUR; });
        if (hist.length) {
            host.appendChild(K.el('h2', { text: 'Прошлые периоды' }));
            host.appendChild(K.table([{ t: 'Период', k: 'name' }, { t: 'Итог', num: true, html: function (p) { return C.rub(M.byPeriod[p.name].prem[e.name].total); } }, { t: 'Статус', k: 'status' }], hist));
        }
        var j = M.journal.filter(function (x) { return x.emp === e.name; });
        if (j.length) { host.appendChild(K.el('h2', { text: 'Журнал по моей премии' })); host.appendChild(K.table([{ t: 'Когда', k: 'when' }, { t: 'Кто', k: 'who' }, { t: 'Что', k: 'text' }], j)); }
    });
})();
