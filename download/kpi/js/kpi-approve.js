/* KPI: «Согласование» - руководитель с телефона оценивает команду по шкале с примерами поведения, корректирует с причиной и согласует. */
(function () {
    'use strict';
    var K = window.Kpi, C = K.core;
    var pname = K.CUR;
    function myName(M) { var d = M.depts.filter(function (x) { return x.login === K.ctx.user; })[0]; return d ? d.head : K.ctx.user; }
    function personModal(M, r) {
        var b = M.byPeriod[pname], pr = b.prem[r.emp.name] || {}, have = b.scoreRows[r.emp.name] || {};
        var canScore = K.canWrite('Оценка компетенции'), canPrem = K.canWrite('Премия') && !!pr.id;
        var score = {}, body = K.el('div');
        body.appendChild(K.el('p', { 'class': 'kpi-sub', text: r.emp.pos + ' · расчёт ' + C.rub(r.calc) + ' из целевых ' + C.rub(r.target) }));
        body.appendChild(K.el('ul', { 'class': 'kpi-explain' }, r.lines.map(function (l) { return K.el('li', { 'class': l.flag === 'below' || l.flag === 'block' ? 'kpi-cell-bad' : '', text: C.explainLine(l, M.schemes[r.emp.scheme]) }); })));
        body.appendChild(K.el('h3', { text: 'Оценка по компетенциям (3 = норма)' }));
        M.comps.forEach(function (c) {
            var cur = have[c.name] ? C.num(have[c.name]['Балл']) : 0; score[c.name] = cur;
            var btns = K.el('div', { 'class': 'kpi-score', role: 'group', 'aria-label': c.name }, [1, 2, 3, 4, 5].map(function (n) {
                return K.el('button', { type: 'button', 'class': n === cur ? 'kpi-on' : '', text: String(n), disabled: canScore ? null : 'disabled', onclick: function (ev) {
                    score[c.name] = n; [].forEach.call(ev.target.parentNode.children, function (x) { x.className = x === ev.target ? 'kpi-on' : ''; }); upd(); } });
            }));
            body.appendChild(K.el('div', { 'class': 'kpi-comp' }, [K.el('b', { text: c.name }), K.el('div', { 'class': 'kpi-comp-ex', html: '1 - ' + K.esc(c.ex1) + '<br>3 - ' + K.esc(c.ex3) + '<br>5 - ' + K.esc(c.ex5) }), btns]));
        });
        var corr = K.input('number', pr.corr || '', { step: 500, placeholder: '0' }), reason = K.input('text', pr.reason || '', { placeholder: 'Обязательно, если сумма меняется' });
        var info = K.el('div');
        body.appendChild(K.el('div', { 'class': 'kpi-grid2' }, [K.field('Корректировка, ₽ (минус - снижение)', corr), K.field('Причина', reason)]));
        body.appendChild(info);
        function calcNow() {
            var sc = M.comps.map(function (c) { return score[c.name]; }).filter(function (x) { return x > 0; });
            var vals = b.vals[r.emp.name], ts = b.ts[r.emp.name];
            return C.calcEmployee(r.emp, M.schemes[r.emp.scheme], vals, sc, ts, { sum: C.num(corr.value), reason: reason.value });
        }
        function upd() {
            var x = calcNow(), chk = C.checkCorrection(x.calc, corr.value, reason.value);
            info.innerHTML = '';
            info.appendChild(K.el('div', { 'class': 'kpi-warnbox kpi-g', html: 'Оценка ' + (x.avg === null ? '-' : C.fnum(x.avg)) + ' (x' + C.fnum(x.mult, 3) + ') · расчёт ' + C.rub(x.calc) + ' · <b>итог ' + C.rub(x.total) + '</b>' }));
            chk.errors.forEach(function (e) { info.appendChild(K.el('div', { 'class': 'kpi-warnbox kpi-e', text: e })); });
            chk.warnings.forEach(function (e) { info.appendChild(K.el('div', { 'class': 'kpi-warnbox kpi-w', text: e })); });
            return chk;
        }
        corr.addEventListener('input', upd); reason.addEventListener('input', upd); upd();
        function save(approve, close) {
            var chk = upd(); if (chk.errors.length) { K.toast(chk.errors[0], true); return; }
            var x = calcNow(), ops = [];
            if (approve && M.comps.some(function (c) { return !score[c.name]; })) { K.toast('Поставьте оценку по всем компетенциям', true); return; }
            M.comps.forEach(function (c) {
                var ex = have[c.name], v = score[c.name];
                if (!v || (ex && C.num(ex['Балл']) === v)) return;
                if (ex) ops.push(K.update(ex._id, { 'Балл': v }));
                else ops.push(K.create('Оценка компетенции', { 'Оценка компетенции': '2026-10 ' + r.emp.num + ' ' + c.name, 'Период премии': pname, 'Сотрудник': r.emp.name, 'Компетенция': c.name, 'Балл': v, 'Логин сотрудника': r.emp.login, 'Логин руководителя': r.emp.headLogin }));
            });
            var f = { 'Расчётная премия': x.calc, 'Корректировка': C.num(corr.value), 'Причина корректировки': reason.value.trim(), 'Итог премии': x.total };
            if (approve) { f['Статус согласования'] = 'Согласовано'; f['Согласовал'] = myName(M); f['Дата согласования'] = K.TODAY; }
            if (canPrem) ops.push(K.update(pr.id, f));
            var changed = C.num(corr.value) !== (pr.corr || 0);
            Promise.all(ops).then(function () {
                var t = [];
                if (changed) t.push('Корректировка ' + (C.num(corr.value) > 0 ? '+' : '') + C.rub(C.num(corr.value)) + ': ' + reason.value.trim());
                if (approve) t.push('Премия за ' + pname + ' согласована: ' + C.rub(x.total));
                if (!t.length) return null;
                return K.log(t.join('. '), { emp: r.emp.name, period: pname, before: x.calc, after: x.total });
            }).then(function () { close(); K.toast(approve ? 'Согласовано' : 'Сохранено'); K.reload(); }).catch(function (e) { K.toast(e.message, true); });
            return true;
        }
        var buttons = [{ text: 'Закрыть' }];
        if (canScore || canPrem) buttons.push({ text: 'Сохранить', fn: function (close) { return save(false, close) ? Promise.resolve() : false; } });
        if (canPrem && pr.status !== 'Согласовано') buttons.push({ text: 'Согласовать', cls: 'kpi-primary', fn: function (close) { return save(true, close) ? Promise.resolve() : false; } });
        K.modal(r.emp.name, body, buttons, true);
    }
    K.mount(function (host, M) {
        var p = K.period(M, pname), b = M.byPeriod[pname];
        var calc = C.calcPeriod(K.calcCtx(M, pname));
        host.appendChild(K.el('div', {}, K.head('Согласование премии - ' + pname, K.isHead() ? 'Ваша команда. Нажмите на сотрудника: оценка по шкале с примерами поведения, корректировка с причиной (попадёт в журнал и в расчёт сотрудника), согласование. Работает с телефона.' : 'Ход согласования по подразделениям. Руководители оценивают и согласуют свою команду; срок - ' + C.toDmy(p.deadline) + '.')));
        M.depts.forEach(function (d) {
            var rows = calc.rows.filter(function (r) { return r.emp.dept === d.name; });
            if (!rows.length) return;
            var ap = C.approvalState(rows.map(function (r) { return b.prem[r.emp.name] || {}; }), p.deadline, K.TODAY);
            var rated = rows.filter(function (r) { return r.avg !== null; }).length;
            host.appendChild(K.el('h2', { html: K.esc(d.name) + ' <span class="kpi-muted">' + K.esc(d.head) + '</span> ' + (ap.complete ? K.badge('Согласовано', 'ok') : K.badge(ap.done + ' из ' + ap.total + (ap.overdue ? ', срок ' + C.toDmy(p.deadline) + ' прошёл' : ''), ap.overdue ? 'crit' : 'warn')) + ' ' + K.badge('оценено ' + rated + ' из ' + rows.length, rated === rows.length ? 'ok' : 'mute') }));
            host.appendChild(K.el('div', { 'class': 'kpi-people' }, rows.map(function (r) {
                var pr = b.prem[r.emp.name] || {};
                return K.el('div', { 'class': 'kpi-person' + (r.blocked ? ' kpi-crit-b' : ''), role: 'button', tabindex: '0', onclick: function () { personModal(M, r); }, onkeydown: function (e) { if (e.key === 'Enter') personModal(M, r); } }, [
                    K.el('div', { html: '<b>' + K.esc(r.emp.name) + '</b><br><span class="kpi-muted">' + K.esc(r.emp.pos) + '</span>' }),
                    K.el('div', { 'class': 'kpi-person-sum', html: C.rub(r.total) + (r.corr ? ' <small class="kpi-muted">корр. ' + (r.corr > 0 ? '+' : '') + C.rub(r.corr) + '</small>' : '') }),
                    K.el('div', { html: K.badge(pr.status || 'нет записи', pr.status === 'Согласовано' ? 'ok' : 'warn') + ' ' + (r.avg === null ? K.badge('нет оценки', 'mute') : K.badge('оценка ' + C.fnum(r.avg), 'info')) + ' ' + K.flags(r) })]);
            })));
        });
        if (K.canWrite('Период премии')) {
            var all = C.approvalState(calc.rows.map(function (r) { return b.prem[r.emp.name] || {}; }), p.deadline, K.TODAY);
            host.appendChild(K.el('div', { 'class': 'kpi-bar' }, [K.btn(all.complete ? 'Утвердить период' : 'Утвердить период (согласовано ' + all.done + ' из ' + all.total + ')', function () {
                if (!all.complete) return K.toast('Сначала все руководители должны согласовать свою команду', true);
                K.update(p.id, { 'Статус периода': 'Утверждён' }).then(function () { return K.log('Период ' + pname + ' утверждён: ' + C.rub(calc.fot), { period: pname }); }).then(function () { K.toast('Период утверждён'); K.reload(); }).catch(function (e) { K.toast(e.message, true); });
            }, all.complete ? 'kpi-primary' : '')]));
        }
    });
})();
