/* Service Desk: согласования руководителя. Заявка ждёт моего решения - согласовать или отклонить в один клик; после последнего шага запускается таймер SLA. */
(function () {
    'use strict';
    var P = window.Desk, C = P.core;
    var st = { tab: 'wait' };

    function decide(host, M, a, ok, comment) {
        var t = M.ticketBy[a.num]; if (!t) return;
        var now = P.wr(M.now), who = a.who || P.ctx.user;
        var ops = [{ op: 'set', id: a.id, fields: { 'Решение согласования': ok ? 'Согласовано' : 'Отклонено', 'Дата решения': now, 'Комментарий согласующего': comment || '' } }];
        var rest = M.approvals.filter(function (x) { return x.num === a.num && x.step > a.step && !x.decision; });
        var add = t.pausedFrom !== null ? C.workBetween(t.pausedFrom, M.now, M.cal) : 0;
        if (!ok) ops.push({ op: 'set', id: t.id, fields: { 'Статус заявки': 'Отклонена', 'Закрыта': now, 'Пауза с': '' } });
        else if (!rest.length) {
            var pause = t.pauseMin + add, dl = C.addWork(t.created, t.solveBudget + pause, M.cal);
            ops.push({ op: 'set', id: t.id, fields: { 'Статус заявки': t.exec ? 'Назначена' : 'Новая', 'Пауза с': '', 'Пауза, мин': pause, 'Срок решения': P.wr(dl) } });
        }
        ops.push(P.evOp(a.num, who, (ok ? 'Согласовано' : 'Отклонено') + ' (шаг ' + a.step + ')' + (comment ? ': ' + comment : '') + (ok && !rest.length ? '. Маршрут пройден, таймер SLA запущен' : ''), t.empLogin));
        P.batch(ops).then(function () { P.reload(function (M2) { render(host, M2); P.toast(a.num + (ok ? ': согласовано' : ': отклонено')); }); }).catch(function (er) { P.toast(er.message, true); });
    }
    function reject(host, M, a) {
        var c = P.input('text', '', { placeholder: 'Причина - её увидит заявитель' });
        P.modal('Отклонить ' + a.num, P.field('Причина', c), [{ text: 'Отмена' }, { text: 'Отклонить', cls: 'desk-danger', fn: function () { if (!c.value.trim()) return false; decide(host, M, a, false, c.value.trim()); } }]);
    }
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('h1', { text: 'Согласования' }));
        host.appendChild(P.el('p', { 'class': 'desk-sub', text: 'Заявки, которые ждут вашего решения. Пока заявка на согласовании, срок службы не идёт - но заявитель ждёт: время ожидания видно в каждой строке.' }));
        var mine = M.approvals.filter(function (a) { return a.login === P.ctx.user || P.ctx.role === 'admin'; });
        var wait = mine.filter(function (a) {
            if (a.decision) return false;
            var cur = C.routeProgress(M.approvals.filter(function (x) { return x.num === a.num; })).current;
            return cur && cur.id === a.id && M.ticketBy[a.num] && M.ticketBy[a.num].status === 'На согласовании';
        });
        var doneList = mine.filter(function (a) { return a.decision; }).sort(function (a, b) { return b.date - a.date; });
        var since = function (a) {
            var prev = M.approvals.filter(function (x) { return x.num === a.num && x.step < a.step && x.date; }).map(function (x) { return x.date; });
            var t = M.ticketBy[a.num]; return C.workBetween(prev.length ? Math.max.apply(null, prev) : t.created, M.now, M.cal);
        };
        var stuck = wait.filter(function (a) { return since(a) >= 9 * 60; }).length;
        host.appendChild(P.el('div', { 'class': 'desk-kpis' }, [
            P.kpi('Ждут решения', String(wait.length), stuck ? stuck + ' ждут дольше рабочего дня' : '', stuck ? 'bad' : wait.length ? 'warn' : 'good'),
            P.kpi('Решено мной', String(doneList.length), '')
        ]));
        host.appendChild(P.tabs([['wait', 'Ждут меня', wait.length], ['done', 'Решённые', doneList.length]], st.tab, function (k) { st.tab = k; render(host, M); }));
        var canW = P.canWrite('Согласование');
        host.appendChild(P.table([
            { t: 'Заявка', html: function (a) { var t = M.ticketBy[a.num]; return '<b>' + P.esc(a.num) + '</b> ' + P.esc(t ? t.topic : '') + '<br><small class="desk-muted">' + P.esc(t ? t.service : '') + '</small>'; } },
            { t: 'Заявитель', html: function (a) { var t = M.ticketBy[a.num]; return P.esc(t ? t.emp : '') + '<br><small class="desk-muted">' + P.esc(t ? t.empDept : '') + '</small>'; } },
            { t: 'Шаг', html: function (a) { var n = M.approvals.filter(function (x) { return x.num === a.num; }).length; return a.step + ' из ' + n; } },
            { t: st.tab === 'wait' ? 'Ждёт' : 'Решение', html: function (a) {
                if (a.decision) return P.badge(a.decision, a.decision === 'Согласовано' ? 'good' : 'bad') + ' <small class="desk-muted">' + P.esc(C.fmtShort(a.date)) + '</small>';
                var m = since(a), h = Math.round(m / 6) / 10; return P.badge(String(h).replace('.', ',') + ' раб. ч', m >= 540 ? 'bad' : 'warn');
            } },
            { t: '', node: function (a) {
                var w = P.el('div', { 'class': 'desk-acts' }); if (a.decision || !canW) return w;
                w.appendChild(P.btn('Согласовать', function () { decide(host, M, a, true, ''); }, 'desk-small desk-primary'));
                w.appendChild(P.btn('Отклонить', function () { reject(host, M, a); }, 'desk-small desk-danger'));
                return w;
            } }
        ], st.tab === 'wait' ? wait : doneList, { onrow: function (a) { var t = M.ticketBy[a.num]; if (t) P.ticketCard(M, t); }, empty: 'Ничего не ждёт вашего решения' }));
    }
    P.mount(render);
})();
