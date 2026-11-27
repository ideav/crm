/* KPI: «Премия за месяц» - первый клик демо. Таблица по подразделениям, нарушения красным, «что если» по порогу и потолку. */
(function () {
    'use strict';
    var K = window.Kpi, C = K.core;
    var st = { period: K.CUR, dept: '', q: '', ovr: {} };
    function indCell(l, sc) {
        var u = l.ind.unit ? ' ' + l.ind.unit : '', cls = '', t;
        if (l.ind.kind === C.BLOCK) {
            if (l.fact === null) return '';
            cls = l.flag === 'block' ? 'kpi-cell-bad' : 'kpi-muted';
            return '<div class="kpi-ind ' + cls + '">' + K.esc(l.ind.name) + ': <b>' + C.fnum(l.fact, 1) + '</b>' + (l.flag === 'block' ? ' - блок' : '') + '</div>';
        }
        if (l.flag === 'below') cls = 'kpi-cell-bad'; else if (l.flag === 'capped') cls = 'kpi-cell-warn'; else if (l.flag) cls = 'kpi-cell-warn';
        t = l.ach === null ? (l.flag === 'noplan' ? 'нет плана' : 'нет факта') : C.pct(l.ach);
        return '<div class="kpi-ind ' + cls + '" title="' + K.esc(C.explainLine(l, sc)) + '">' + K.esc(l.ind.name) + ': <b>' + t + '</b> <small>' + C.fnum(l.fact === null ? 0 : l.fact) + ' из ' + C.fnum(l.plan) + u + ' · коэф. ' + C.fnum(l.coef) + ' x ' + l.weight + ' %</small></div>';
    }
    function details(M, r, pname) {
        var sc = Object.assign({}, M.schemes[r.emp.scheme], st.ovr[r.emp.scheme] || {});
        var b = M.byPeriod[pname], ts = b.ts[r.emp.name], pr = b.prem[r.emp.name];
        var list = K.el('ul', { 'class': 'kpi-explain' }, r.lines.map(function (l) { return K.el('li', { 'class': l.flag === 'below' || l.flag === 'block' ? 'kpi-cell-bad' : '', text: C.explainLine(l, sc) }); }));
        var j = M.journal.filter(function (x) { return x.emp === r.emp.name; });
        var body = K.el('div', {}, [
            K.el('p', { 'class': 'kpi-sub', text: r.emp.pos + ' · ' + r.emp.dept + ' · схема «' + r.emp.scheme + '» · оклад ' + C.rub(r.emp.salary) + ', целевая премия ' + r.emp.targetPct + ' % = ' + C.rub(r.target) }),
            list,
            K.el('div', { 'class': 'kpi-formula' }, [
                K.el('p', { text: 'Сумма коэффициентов x вес: ' + C.pct(r.sumCoef) }),
                K.el('p', { text: 'Оценка руководителя: ' + (r.avg === null ? 'ещё не поставлена (множитель 1)' : C.fnum(r.avg) + ' из 5, множитель ' + C.fnum(r.mult, 3)) }),
                ts ? K.el('p', { text: 'Отработано ' + ts.worked + ' из ' + ts.norm + ' дн. (' + ts.why + '): ' + (sc.partMode === 'Пропорционально' ? 'x ' + C.fnum(r.partF, 3) : 'по правилу схемы премия полная') }) : null,
                r.blocked ? K.el('p', { 'class': 'kpi-cell-bad', text: 'Премия не начисляется: ' + r.blockReason }) : null,
                K.el('p', { html: '<b>Расчёт: ' + C.rub(r.calc) + '</b>' + (r.corr ? ' · корректировка ' + (r.corr > 0 ? '+' : '') + C.rub(r.corr) + ' (' + K.esc(r.corrReason) + ')' : '') + ' · <b>итог ' + C.rub(r.total) + '</b>' }),
                pr ? K.el('p', { 'class': 'kpi-muted', text: 'Статус: ' + pr.status + (pr.by ? ', ' + pr.by + ' ' + C.toDmy(pr.at) : '') }) : null]),
            K.el('h3', { text: 'Журнал' }),
            j.length ? K.el('ul', { 'class': 'kpi-explain' }, j.map(function (x) { return K.el('li', { text: x.when + ' · ' + x.who + ': ' + x.text }); })) : K.el('p', { 'class': 'kpi-muted', text: 'Записей нет' })]);
        K.modal(r.emp.name + ' - ' + pname, body, null, true);
    }
    function whatIfPanel(M, ctx, rerender) {
        var box = K.el('div', { 'class': 'kpi-whatif' }, [K.el('h3', { text: '«Что если»: правило меняется в одном месте, пересчёт сразу' })]);
        var canApply = K.canWrite('Схема премии');
        Object.keys(M.schemes).forEach(function (name) {
            var s = M.schemes[name], o = st.ovr[name] || {};
            var th = K.input('number', o.threshold !== undefined ? o.threshold : s.threshold, { min: 0, max: 99, step: 5, 'aria-label': 'Порог ' + name, style: 'width:90px' });
            var cap = K.input('number', o.cap !== undefined ? o.cap : s.cap, { min: 100, max: 200, step: 5, 'aria-label': 'Потолок ' + name, style: 'width:90px' });
            function upd() {
                var v = { threshold: C.num(th.value), cap: C.num(cap.value) };
                if (v.threshold === s.threshold && v.cap === s.cap) delete st.ovr[name]; else st.ovr[name] = v;
                rerender();
            }
            th.addEventListener('change', upd); cap.addEventListener('change', upd);
            box.appendChild(K.el('div', { 'class': 'kpi-bar' }, [K.el('b', { text: name, style: 'min-width:90px' }), K.field('Порог, %', th), K.field('Потолок, %', cap),
                K.el('span', { 'class': 'kpi-muted', text: 'сейчас: порог ' + s.threshold + ' %, потолок ' + s.cap + ' % (версия ' + s.version + ')' })]));
        });
        if (Object.keys(st.ovr).length) {
            var w = C.whatIf(ctx, st.ovr);
            box.appendChild(K.el('p', { html: 'ФОТ премий: ' + C.rub(w.before) + ' -> <b>' + C.rub(w.after) + '</b> (<span class="' + (w.delta < 0 ? 'kpi-delta-down' : 'kpi-delta-up') + '">' + (w.delta > 0 ? '+' : '') + C.rub(w.delta) + '</span>), меняется у ' + w.changed.length + ' чел.: ' +
                w.changed.slice(0, 8).map(function (c) { return K.esc(c.emp.name.split(' ')[0]) + ' ' + (c.delta > 0 ? '+' : '') + C.rub(c.delta); }).join(', ') }));
            var acts = [K.btn('Сбросить', function () { st.ovr = {}; rerender(); })];
            if (canApply) acts.unshift(K.btn('Применить правило', function () { applyRules(M); }, 'kpi-primary'));
            else acts.push(K.el('span', { 'class': 'kpi-muted', text: 'Применить правило может специалист C&B - с записью в журнал' }));
            box.appendChild(K.el('div', { 'class': 'kpi-bar' }, acts));
        }
        return box;
    }
    function applyRules(M) {
        var names = Object.keys(st.ovr);
        var reason = K.input('text', '', { placeholder: 'Например: решение комдира от 26.11, протокол № 9' });
        K.modal('Применить новое правило', K.el('div', {}, [K.el('p', { text: names.map(function (n) { var s = M.schemes[n], o = st.ovr[n]; return '«' + n + '»: порог ' + s.threshold + ' -> ' + o.threshold + ' %, потолок ' + s.cap + ' -> ' + o.cap + ' %'; }).join('; ') }),
            K.field('Основание (в журнал и положение о премировании)', reason)]), [{ text: 'Отмена' }, { text: 'Применить', cls: 'kpi-primary', fn: function (close) {
            if (!reason.value.trim()) { K.toast('Укажите основание изменения', true); return false; }
            return Promise.all(names.map(function (n) {
                var s = M.schemes[n], o = st.ovr[n];
                return K.update(s.id, { 'Порог начисления, %': o.threshold, 'Потолок коэффициента, %': o.cap, 'Версия правил': s.version + 1, 'Правила изменены': K.now() + ' ' + K.ctx.user })
                    .then(function () { return K.log('Схема «' + n + '»: порог ' + s.threshold + ' -> ' + o.threshold + ' %, потолок ' + s.cap + ' -> ' + o.cap + ' % (версия ' + (s.version + 1) + '). Основание: ' + reason.value.trim()); });
            })).then(function () { close(); st.ovr = {}; K.toast('Правило применено, премии пересчитаны'); K.reload(); }).catch(function (e) { K.toast(e.message, true); });
        } }]);
    }
    function render(host, M) {
        var pname = st.period, period = K.period(M, pname);
        var ctx = K.calcCtx(M, pname);
        var calc = C.calcPeriod(ctx, st.ovr);
        var prev = K.prevTotals(M, pname), cmp = C.comparePrev(calc.rows, prev);
        var prevFot = prev ? Object.keys(prev).reduce(function (s, k) { return s + prev[k]; }, 0) : null;
        var b = M.byPeriod[pname];
        function rerender() { host.innerHTML = ''; render(host, M); }
        host.appendChild(K.el('div', {}, K.head('Премия за месяц', 'Расчёт по правилам компании: план/факт, вес, порог, шкала, потолок, блокирующий показатель, оценка руководителя. Красным - то, что срезало премию. Нажмите на строку - расчёт по шагам и журнал.')));
        var q = K.input('text', st.q, { placeholder: 'Поиск по ФИО', 'aria-label': 'Поиск' });
        q.addEventListener('input', function () { st.q = q.value; var pos = q.selectionStart; rerender(); var n = host.querySelector('input[aria-label="Поиск"]'); n.focus(); n.setSelectionRange(pos, pos); });
        var depts = M.depts.filter(function (d) { return calc.rows.some(function (r) { return r.emp.dept === d.name; }); });
        host.appendChild(K.el('div', { 'class': 'kpi-bar' }, [K.periodPicker(M, pname, function (v) { st.period = v; rerender(); }),
            K.field('Подразделение', (function () { var s = K.select([['', 'Все']].concat(depts.map(function (d) { return d.name; })), st.dept); s.addEventListener('change', function () { st.dept = s.value; rerender(); }); return s; })()),
            K.field('Сотрудник', q), K.el('div', { 'class': 'kpi-grow' }),
            K.btn('Экспорт в Excel (CSV)', function () { K.download('premiya-' + pname + '.csv', toCsv(calc.rows)); })]));
        var blocked = calc.rows.filter(function (r) { return r.blocked; }), below = calc.rows.filter(function (r) { return r.flags.indexOf('below') >= 0; });
        var prems = calc.rows.map(function (r) { return b.prem[r.emp.name] || { status: 'Нет записи' }; }), ap = C.approvalState(prems, period.deadline, K.TODAY);
        host.appendChild(K.el('div', { 'class': 'kpi-tiles' }, [
            K.tile('ФОТ премий', C.rub(calc.fot), 'целевая ' + C.rub(calc.target) + ' (' + C.pct(calc.target ? calc.fot / calc.target : 0) + ')'),
            K.tile('К прошлому месяцу', prevFot === null ? '-' : (calc.fot - prevFot > 0 ? '+' : '') + C.rub(calc.fot - prevFot), prevFot === null ? '' : 'было ' + C.rub(prevFot), prevFot !== null && calc.fot < prevFot ? 'warn' : ''),
            K.tile('Обнулено блокирующим', String(blocked.length), blocked.map(function (r) { return r.emp.name.split(' ')[0]; }).join(', '), blocked.length ? 'bad' : ''),
            K.tile('Показатель ниже порога', String(below.length) + ' чел.', 'по ним доля веса не начислена', below.length ? 'bad' : ''),
            K.tile('Согласовано', ap.done + ' из ' + ap.total, 'срок ' + C.toDmy(period.deadline) + (ap.overdue ? ' - просрочен' : ''), ap.overdue ? 'bad' : (ap.complete ? 'good' : ''))]));
        if (!K.isHead() && !K.isEmp()) host.appendChild(whatIfPanel(M, ctx, rerender));
        var rows = calc.rows.filter(function (r) { return (!st.dept || r.emp.dept === st.dept) && (!st.q || C.normName(r.emp.name).indexOf(C.normName(st.q)) >= 0); });
        M.depts.forEach(function (d) {
            var dr = rows.filter(function (r) { return r.emp.dept === d.name; });
            if (!dr.length) return;
            var dp = dr.map(function (r) { return b.prem[r.emp.name] || { status: '' }; }), das = C.approvalState(dp, period.deadline, K.TODAY);
            var fot = dr.reduce(function (s, r) { return s + r.total; }, 0);
            host.appendChild(K.el('h2', { html: K.esc(d.name) + ' · ' + C.rub(fot) + ' · <span class="kpi-muted">' + K.esc(d.head) + '</span> ' + (das.complete ? K.badge('Согласовано', 'ok') : K.badge('Согласовано ' + das.done + ' из ' + das.total + (das.overdue ? ', срок прошёл' : ''), das.overdue ? 'crit' : 'warn')) }));
            host.appendChild(K.table([
                { t: 'Сотрудник', html: function (r) { return '<b>' + K.esc(r.emp.name) + '</b><br><span class="kpi-muted">' + K.esc(r.emp.pos) + '</span>'; } },
                { t: 'Показатели: выполнение, коэффициент x вес', html: function (r) { var s = Object.assign({}, M.schemes[r.emp.scheme], st.ovr[r.emp.scheme] || {}); return r.lines.map(function (l) { return indCell(l, s); }).join(''); } },
                { t: 'Оценка', num: true, html: function (r) { return r.avg === null ? '<span class="kpi-muted">нет</span>' : C.fnum(r.avg) + '<br><small class="kpi-muted">x' + C.fnum(r.mult, 3) + '</small>'; } },
                { t: 'Целевая', num: true, html: function (r) { return C.rub(r.target); } },
                { t: 'Расчёт', num: true, html: function (r) { return '<span class="' + (r.blocked ? 'kpi-cell-bad' : '') + '">' + C.rub(r.calc) + '</span><br><small class="kpi-muted">' + C.pct(r.target ? r.calc / r.target : 0) + ' целевой</small>'; } },
                { t: 'Корр.', num: true, html: function (r) { return r.corr ? '<span title="' + K.esc(r.corrReason) + '">' + (r.corr > 0 ? '+' : '') + C.rub(r.corr) + '</span>' : ''; } },
                { t: 'Итог', num: true, html: function (r) { return '<b>' + C.rub(r.total) + '</b>'; } },
                { t: 'К прошлому', num: true, html: function (r) { var c = cmp[r.emp.name]; return c.prev === null ? '<span class="kpi-muted">-</span>' : '<span class="' + (c.delta < 0 ? 'kpi-delta-down' : 'kpi-delta-up') + '">' + (c.delta > 0 ? '+' : '') + C.rub(c.delta) + '</span>'; } },
                { t: 'Статус', html: function (r) { var p = b.prem[r.emp.name]; return p ? K.badge(p.status, p.status === 'Согласовано' ? 'ok' : 'warn') : ''; } },
                { t: 'Нарушения', html: function (r) { return K.flags(r); } }
            ], dr, { rowCls: function (r) { return r.blocked ? 'kpi-row-bad' : (r.flags.indexOf('below') >= 0 ? 'kpi-row-warn' : ''); }, onrow: function (r) { details(M, r, pname); } }));
        });
        if (!rows.length) host.appendChild(K.el('p', { 'class': 'kpi-muted', text: 'Нет сотрудников по фильтру' }));
    }
    function toCsv(rows) {
        var out = [['Табельный номер', 'Сотрудник', 'Подразделение', 'Целевая', 'Сумма коэффициентов', 'Оценка', 'Расчёт', 'Корректировка', 'Причина', 'Итог', 'Нарушения'].join(';')];
        rows.forEach(function (r) { out.push([r.emp.num, r.emp.name, r.emp.dept, r.target, C.fnum(r.sumCoef, 4), r.avg === null ? '' : C.fnum(r.avg), r.calc, r.corr, (r.corrReason || '').replace(/;/g, ','), r.total, r.flags.join(',')].join(';')); });
        return out.join('\r\n');
    }
    K.mount(render);
})();
