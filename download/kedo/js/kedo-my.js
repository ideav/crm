/* КЭДО: экран сотрудника «Мои документы» — что подписать, что подписано, что принято в учёте. */
(function () {
    'use strict';
    var P = window.Kedo, C = P.core;
    P.mount(function (host, M) {
        var me = M.me && P.rk === 'employee' ? M.me : (M.emps.filter(function (e) { return e.login === 'employee'; })[0] || M.me);
        if (!me) { host.innerHTML = ''; host.appendChild(P.el('div', { 'class': 'kedo-error', text: 'Учётная запись не привязана к карточке сотрудника' })); return; }
        var docs = M.docs.filter(function (d) { return d.emp === me.name && d.status !== C.PREPARED; });
        var todo = docs.filter(function (d) { return d.st.waiting; }), rest = docs.filter(function (d) { return !d.st.waiting; });
        host.innerHTML = '';
        P.head('Мои документы', me.name + ', ' + me.position + ' (' + me.dept + '). Подпись: ' + (me.sign || '—') + '.' + (P.rk === 'employee' ? '' : ' Просмотр от имени сотрудника.')).forEach(function (n) { host.appendChild(n); });
        host.appendChild(P.el('h2', { text: todo.length ? 'Нужно подписать: ' + todo.length : 'Подписывать сейчас нечего' }));
        function card(d) {
            var box = P.el('div', { 'class': 'kedo-doc' + (d.st.overdue ? ' kedo-bad' : '') }, [
                P.el('div', { 'class': 'kedo-doc-h' }, [P.el('b', { text: d.type }), P.el('span', { html: P.statusBadge(d) })]),
                P.el('div', { 'class': 'kedo-muted', text: 'Документ от ' + C.toDmy(d.date) + (d.sent ? ', прислан ' + C.toDmy(d.sent) : '') }),
                P.el('p', { text: C.employeeHint(d, P.TODAY, M.hol, M.rules), style: 'margin:6px 0' })]);
            if (d.st.waiting) box.appendChild(P.el('div', { 'class': 'kedo-actions' }, [P.btn('Открыть и подписать', function () { P.toast('Подписание — в приложении оператора КЭДО или на Госуслугах (' + (me.sign || 'УНЭП') + '). После подписи статус обновится здесь.'); }, 'kedo-primary'),
                P.btn('Не согласен', function () { P.toast('Отказ оформляется у оператора с указанием причины; кадровик увидит его в очереди.'); })]));
            return box;
        }
        todo.forEach(function (d) { host.appendChild(card(d)); });
        host.appendChild(P.el('h2', { text: 'Подписанные и прочие' }));
        rest.forEach(function (d) { host.appendChild(card(d)); });
        host.appendChild(P.el('div', { 'class': 'kedo-border', text: 'Документ, где вас просят согласиться на нарушение закона, силы не имеет. Если непонятно, что подписываете, — спросите кадровика до подписи.' }));
    });
})();
